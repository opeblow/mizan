import { MerkleTree, computeEmissions, facilityById, idToBytes32, sha256Hex, FACTORS, type Hex, type MetricTotals } from "@mizan/shared";
import { all, db, get, run } from "./db";
import { config } from "./config";
import { auditHead, audit } from "./audit";
import { bus } from "./events";
import { chain } from "./chain";
import { noisyOr } from "./integrity/stats";

/**
 * Seals reporting windows. When the first interval of a new window completes, every earlier open window of
 * that facility is sealed: its readings are ordered, hashed into a Merkle tree, totalled into emissions and
 * scored for risk. The manifest is hashed and the batch is queued for anchoring on-chain.
 */

export const windowIndex = (ts: number) => Math.floor((ts - 1) / config.windowSeconds);

interface ReadingRow {
  id: number;
  device_id: string;
  ts: number;
  metric: string;
  value_milli: number;
  leaf: string;
}

export function sealClosedWindows(facilityId: string, currentTs: number): number[] {
  const W = config.windowSeconds;
  const cur = windowIndex(currentTs);
  const open = all<{ idx: number }>(
    // node:sqlite binds JS numbers as REAL, so the division must be cast back to an integer window index
    "SELECT DISTINCT CAST((ts - 1) / ? AS INTEGER) AS idx FROM readings WHERE facility_id = ? AND batch_id IS NULL AND ts <= ? ORDER BY idx",
    W,
    facilityId,
    cur * W,
  );
  return open.map((o) => sealWindow(facilityId, Number(o.idx))).filter((id): id is number => id !== null);
}

export const isWindowSealed = (facilityId: string, ts: number) =>
  !!get("SELECT 1 FROM batches WHERE facility_id = ? AND period_start = ?", facilityId, windowIndex(ts) * config.windowSeconds);

function sealWindow(facilityId: string, idx: number): number | null {
  const f = facilityById(facilityId)!;
  const W = config.windowSeconds;
  const start = idx * W;
  const end = start + W;
  const readings = all<ReadingRow>(
    "SELECT id, device_id, ts, metric, value_milli, leaf FROM readings WHERE facility_id = ? AND ts > ? AND ts <= ? AND batch_id IS NULL ORDER BY ts, device_id",
    facilityId,
    start,
    end,
  );
  if (readings.length === 0) return null;
  const tree = new MerkleTree(readings.map((r) => r.leaf as Hex));
  const totals: MetricTotals = {};
  for (const r of readings) totals[r.metric as keyof MetricTotals] = (totals[r.metric as keyof MetricTotals] ?? 0) + r.value_milli / 1000;
  const e = computeEmissions(f.sector, totals);
  const expected = f.devices.length * Math.round(W / config.intervalSeconds);

  const intervalRisk = get<{ r: number | null }>(
    "SELECT MAX(risk) AS r FROM intervals WHERE facility_id = ? AND ts > ? AND ts <= ?",
    facilityId,
    start,
    end,
  )?.r ?? 0;
  const rejections = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM rejections WHERE facility_id = ? AND ts > ? AND ts <= ?",
    facilityId,
    start,
    end,
  )!.n;
  const completeness = readings.length / expected;
  const securityScore = rejections > 0 ? Math.min(0.9, 0.35 + 0.15 * rejections) : 0;
  const gapScore = completeness < 0.98 ? Math.min(0.8, (1 - completeness) * 2) : 0;
  const risk = noisyOr([intervalRisk, securityScore, gapScore]);
  const incidents = all<{ id: number }>(
    "SELECT id FROM incidents WHERE facility_id = ? AND first_ts <= ? AND last_ts > ? ORDER BY id",
    facilityId,
    end,
    start,
  ).map((r) => r.id);

  const head = auditHead();
  const manifest = {
    schema: "mizan.batch-manifest.v1",
    facilityId,
    facilityChainId: idToBytes32(facilityId),
    periodStart: start,
    periodEnd: end,
    merkleRoot: tree.root,
    leafOrder: "ts asc, deviceId asc",
    readingCount: readings.length,
    expectedCount: expected,
    completeness: Number(completeness.toFixed(4)),
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Number(v.toFixed(3))])),
    emissions: {
      directKg: Math.round(e.directKg),
      indirectKg: Math.round(e.indirectKg),
      productionKg: Math.round(e.productionKg),
      sources: e.sources.map((s) => ({ source: s.source, kg: Math.round(s.kg) })),
    },
    emissionFactors: FACTORS,
    risk: { score: Number(risk.toFixed(4)), maxIntervalRisk: Number(intervalRisk.toFixed(4)), rejections, gapScore: Number(gapScore.toFixed(4)) },
    incidents,
    auditHead: head,
  };
  const evidenceHash = sha256Hex(JSON.stringify(manifest));

  const res = run(
    `INSERT INTO batches (facility_id, period_start, period_end, merkle_root, reading_count, expected_count, direct_kg, indirect_kg,
       production_kg, risk, manifest, evidence_hash, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    facilityId,
    start,
    end,
    tree.root,
    readings.length,
    expected,
    Math.round(e.directKg),
    Math.round(e.indirectKg),
    Math.round(e.productionKg),
    risk,
    JSON.stringify(manifest),
    evidenceHash,
    Math.floor(Date.now() / 1000),
  );
  const batchId = Number(res.lastInsertRowid);
  const assign = db.prepare("UPDATE readings SET batch_id = ?, leaf_index = ? WHERE id = ?");
  readings.forEach((r, i) => assign.run(batchId, i, r.id));
  audit("system", "batch.sealed", `batch:${batchId}`, { facilityId, start, end, root: tree.root, evidenceHash, risk: manifest.risk.score });
  bus.publish({ type: "batch", batchId, facilityId, status: "queued", risk });
  return batchId;
}

interface QueuedBatch {
  id: number;
  facility_id: string;
  period_start: number;
  period_end: number;
  merkle_root: string;
  reading_count: number;
  direct_kg: number;
  indirect_kg: number;
  production_kg: number;
  risk: number;
  evidence_hash: string;
}

let anchoring = false;

/** Sends queued batches to MRVLedger in period order. Safe to call repeatedly. */
export async function anchorQueued(): Promise<void> {
  if (anchoring || !chain.ready) return;
  anchoring = true;
  try {
    for (;;) {
      const rows = all<QueuedBatch>("SELECT * FROM batches WHERE status = 'queued' ORDER BY period_start, id LIMIT 25");
      if (rows.length === 0) break;
      for (const b of rows) {
        try {
          const receipt = await chain.send("oracle", chain.ledger, "anchorBatch", [
            {
              facilityId: idToBytes32(b.facility_id),
              periodStart: b.period_start,
              periodEnd: b.period_end,
              merkleRoot: b.merkle_root,
              readingCount: b.reading_count,
              directEmissionsKg: Math.round(b.direct_kg),
              indirectEmissionsKg: Math.round(b.indirect_kg),
              productionKg: Math.round(b.production_kg),
              riskScoreBps: Math.min(10000, Math.round(b.risk * 10000)),
              evidenceHash: b.evidence_hash,
            },
          ]);
          const ev = chain.parseLogs(receipt, chain.ledger, "BatchAnchored")[0];
          const onchainId = Number(ev!.args.batchId);
          run(
            "UPDATE batches SET status = 'anchored', onchain_id = ?, anchor_tx = ?, anchor_block = ?, anchored_at = ?, error = NULL WHERE id = ?",
            onchainId,
            receipt.hash,
            receipt.blockNumber,
            Math.floor(Date.now() / 1000),
            b.id,
          );
          audit("oracle", "batch.anchored", `batch:${b.id}`, { onchainId, tx: receipt.hash, block: receipt.blockNumber });
          bus.publish({ type: "batch", batchId: b.id, facilityId: b.facility_id, status: "anchored", risk: b.risk });
        } catch (e) {
          const msg = (e as Error).message;
          run("UPDATE batches SET status = 'error', error = ? WHERE id = ?", msg, b.id);
          audit("oracle", "batch.anchor_failed", `batch:${b.id}`, { error: msg });
          bus.publish({ type: "chain", status: "error", message: `Anchoring batch ${b.id} failed: ${msg}` });
        }
      }
    }
  } finally {
    anchoring = false;
  }
}

/** Rebuilds the Merkle tree of a batch from stored leaves. */
export function batchTree(batchId: number): MerkleTree | null {
  const leaves = all<{ leaf: string }>("SELECT leaf FROM readings WHERE batch_id = ? ORDER BY leaf_index", batchId);
  return leaves.length ? new MerkleTree(leaves.map((l) => l.leaf as Hex)) : null;
}
