import {
  FACILITIES,
  INTENSITY_BOUNDS,
  METRICS,
  PQ_SCHEME,
  SECTOR_LABEL,
  cbamRelevantKg,
  facilityById,
  type FacilityDef,
} from "@mizan/shared";
import { all, get } from "./db";
import { config } from "./config";
import { chain } from "./chain";
import { batchTree } from "./batcher";
import { modelInfo } from "./integrity/engine";
import { HttpError } from "./services";

const latestTs = (facilityId?: string) =>
  get<{ ts: number | null }>(
    `SELECT MAX(ts) AS ts FROM intervals WHERE complete = 1 ${facilityId ? "AND facility_id = ?" : ""}`,
    ...(facilityId ? [facilityId] : []),
  )?.ts ?? 0;

function windowTotals(facilityId: string, from: number, to: number) {
  return (
    get<{ direct: number; indirect: number; production: number; n: number; risk: number }>(
      `SELECT COALESCE(SUM(direct_kg),0) AS direct, COALESCE(SUM(indirect_kg),0) AS indirect, COALESCE(SUM(production_kg),0) AS production,
              COUNT(*) AS n, COALESCE(AVG(risk),0) AS risk
       FROM intervals WHERE facility_id = ? AND complete = 1 AND ts > ? AND ts <= ?`,
      facilityId,
      from,
      to,
    ) ?? { direct: 0, indirect: 0, production: 0, n: 0, risk: 0 }
  );
}

function facilitySummary(f: FacilityDef) {
  const now = latestTs(f.id);
  const day = windowTotals(f.id, now - 86400, now);
  const prevDay = windowTotals(f.id, now - 2 * 86400, now - 86400);
  const month = windowTotals(f.id, now - 30 * 86400, now);
  const cbamDay = cbamRelevantKg(f.sector, { directKg: day.direct, indirectKg: day.indirect });
  const cbamMonth = cbamRelevantKg(f.sector, { directKg: month.direct, indirectKg: month.indirect });
  const batches = all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM batches WHERE facility_id = ? GROUP BY status", f.id);
  const openIncidents = get<{ n: number }>("SELECT COUNT(*) AS n FROM incidents WHERE facility_id = ? AND status = 'open'", f.id)!.n;
  const review = get<{ n: number }>("SELECT COUNT(*) AS n FROM batches WHERE facility_id = ? AND status = 'anchored' AND risk >= 0.3", f.id)!.n;
  const carbon = get<{ priced: number; paid: number }>(
    "SELECT COALESCE(SUM(priced_kg),0) AS priced, COALESCE(SUM(paid_eur),0) AS paid FROM carbon_prices WHERE facility_id = ?",
    f.id,
  )!;
  const available = get<{ kg: number }>(
    "SELECT COALESCE(SUM(production_kg - allocated_kg),0) AS kg FROM batches WHERE facility_id = ? AND status = 'verified'",
    f.id,
  )!.kg;
  return {
    id: f.id,
    name: f.name,
    legalName: f.legalName,
    city: f.city,
    region: f.region,
    sector: f.sector,
    sectorLabel: SECTOR_LABEL[f.sector],
    process: f.process,
    product: f.product,
    annualCapacityT: f.annualCapacityT,
    euExportShare: config.euExportShare[f.id] ?? 0.4,
    latestTs: now,
    last24h: {
      directT: day.direct / 1000,
      indirectT: day.indirect / 1000,
      productionT: day.production / 1000,
      seeT: day.production > 0 ? cbamDay / day.production : 0,
      prevSeeT: prevDay.production > 0 ? cbamRelevantKg(f.sector, { directKg: prevDay.direct, indirectKg: prevDay.indirect }) / prevDay.production : 0,
      avgRisk: day.risk,
    },
    last30d: {
      directT: month.direct / 1000,
      indirectT: month.indirect / 1000,
      productionT: month.production / 1000,
      seeT: month.production > 0 ? cbamMonth / month.production : 0,
      days: month.n / (86400 / config.intervalSeconds),
    },
    batches: Object.fromEntries(batches.map((b) => [b.status, b.n])),
    needsReview: review,
    openIncidents,
    carbonPrice: { pricedT: carbon.priced / 1000, paidEur: carbon.paid, eurPerT: carbon.priced > 0 ? carbon.paid / (carbon.priced / 1000) : 0 },
    availableForCertificatesT: available / 1000,
    model: modelInfo(f.id),
    devices: f.devices.length,
  };
}

export async function overview() {
  const facilities = FACILITIES.map(facilitySummary);
  const totals = get<{ readings: number }>("SELECT COUNT(*) AS readings FROM readings")!;
  const rejected = get<{ n: number }>("SELECT COUNT(*) AS n FROM rejections")!.n;
  const batchStats = get<{ total: number; verified: number; anchored: number; rejected: number; queued: number }>(
    `SELECT COUNT(*) AS total, SUM(status='verified') AS verified, SUM(status='anchored') AS anchored,
            SUM(status='rejected') AS rejected, SUM(status IN ('queued','error')) AS queued FROM batches`,
  )!;
  const certs = get<{ n: number; t: number; e: number; claimed: number }>(
    "SELECT COUNT(*) AS n, COALESCE(SUM(quantity_kg),0)/1000 AS t, COALESCE(SUM(embedded_kg),0)/1000 AS e, SUM(claimed_at IS NOT NULL) AS claimed FROM certificates",
  )!;
  const incidents = get<{ open: number; critical: number; understated: number }>(
    `SELECT SUM(status='open') AS open, SUM(status='open' AND severity IN ('critical','high')) AS critical,
            COALESCE(SUM(CASE WHEN status != 'dismissed' THEN est_understatement_kg ELSE 0 END),0) AS understated FROM incidents`,
  )!;
  return {
    facilities,
    totals: {
      readings: totals.readings,
      rejected,
      batches: batchStats,
      certificates: { count: certs.n, tonnes: certs.t, embeddedT: certs.e, claimed: certs.claimed ?? 0 },
      incidents: { open: incidents.open ?? 0, critical: incidents.critical ?? 0, understatedT: (incidents.understated ?? 0) / 1000 },
    },
    chain: await chain.status(),
    latestTs: latestTs(),
  };
}

export function facilityDetail(id: string) {
  const f = facilityById(id);
  if (!f) throw new HttpError(404, "Unknown facility");
  const devices = all<Record<string, unknown>>(
    "SELECT id, metric, chain_id, public_key_hash, status, last_seq, last_ts, last_value, readings_count, rejected_count, registered_tx, enrolled_at FROM devices WHERE facility_id = ?",
    id,
  );
  return {
    ...facilitySummary(f),
    bounds: INTENSITY_BOUNDS[f.sector],
    devices: f.devices.map((d) => {
      const row = devices.find((r) => r.id === d.id);
      return { ...d, unit: METRICS[d.metric].unit, scheme: PQ_SCHEME, enrolled: !!row, ...(row ?? {}) };
    }),
  };
}

export function series(facilityId: string, hours: number, bucketMinutes: number) {
  const end = latestTs(facilityId);
  const start = end - hours * 3600;
  const bucket = bucketMinutes * 60;
  return all<Record<string, number>>(
    `SELECT CAST(ts / ? AS INTEGER) * ? AS t, SUM(direct_kg) AS direct, SUM(indirect_kg) AS indirect, SUM(production_kg) AS production,
            MAX(risk) AS risk, COUNT(*) AS n
     FROM intervals WHERE facility_id = ? AND complete = 1 AND ts > ? AND ts <= ? GROUP BY t ORDER BY t`,
    bucket,
    bucket,
    facilityId,
    start,
    end,
  );
}

/** Intensity ratios (e.g. kWh per kg steel) per time bucket, the signal tampering distorts first. */
export function ratioSeries(facilityId: string, hours: number, bucketMinutes: number) {
  const f = facilityById(facilityId);
  if (!f) throw new HttpError(404, "Unknown facility");
  const end = latestTs(facilityId);
  const bucket = bucketMinutes * 60;
  const rows = all<{ ts: number; metrics: string }>(
    "SELECT ts, metrics FROM intervals WHERE facility_id = ? AND complete = 1 AND ts > ? AND ts <= ? ORDER BY ts",
    facilityId,
    end - hours * 3600,
    end,
  );
  const bounds = INTENSITY_BOUNDS[f.sector];
  const buckets = new Map<number, Record<string, number>>();
  for (const r of rows) {
    const t = Math.floor(r.ts / bucket) * bucket;
    const acc = buckets.get(t) ?? {};
    const m = JSON.parse(r.metrics) as Record<string, number>;
    for (const [k, v] of Object.entries(m)) acc[k] = (acc[k] ?? 0) + v;
    buckets.set(t, acc);
  }
  return {
    bounds,
    points: [...buckets.entries()].map(([t, m]) => {
      const p: Record<string, number> = { t };
      bounds.forEach((b, i) => {
        const den = m[b.denominator] ?? 0;
        p[`r${i}`] = den > 0 ? (m[b.numerator] ?? 0) / den : NaN; // NaN -> null in JSON: a gap, not a zero
      });
      return p;
    }),
  };
}

export function intervalsFor(facilityId: string, from: number, to: number) {
  return all<Record<string, unknown>>(
    "SELECT ts, metrics, direct_kg, indirect_kg, production_kg, risk, iforest, flags, label FROM intervals WHERE facility_id = ? AND ts > ? AND ts <= ? ORDER BY ts",
    facilityId,
    from,
    to,
  ).map((r) => ({ ...r, metrics: JSON.parse(r.metrics as string), flags: JSON.parse(r.flags as string) }));
}

export function listIncidents(status?: string, facilityId?: string, limit = 200) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (status && status !== "all") {
    where.push("status = ?");
    params.push(status);
  }
  if (facilityId) {
    where.push("facility_id = ?");
    params.push(facilityId);
  }
  return all<Record<string, unknown>>(
    `SELECT * FROM incidents ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY
      CASE status WHEN 'open' THEN 0 ELSE 1 END, last_ts DESC LIMIT ?`,
    ...params,
    limit,
  ).map((r) => ({ ...r, evidence: JSON.parse(r.evidence as string) }));
}

export function incidentDetail(id: number) {
  const inc = get<Record<string, unknown>>("SELECT * FROM incidents WHERE id = ?", id);
  if (!inc) throw new HttpError(404, "Incident not found");
  const pad = 6 * 3600;
  return {
    ...inc,
    evidence: JSON.parse(inc.evidence as string),
    context: intervalsFor(inc.facility_id as string, (inc.first_ts as number) - pad, (inc.last_ts as number) + pad),
    batches: all("SELECT id, onchain_id, status, risk, period_start, period_end FROM batches WHERE facility_id = ? AND period_start < ? AND period_end >= ?", inc.facility_id, inc.last_ts, inc.first_ts),
  };
}

export function listBatches(q: { facilityId?: string; status?: string; limit?: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.facilityId) {
    where.push("facility_id = ?");
    params.push(q.facilityId);
  }
  if (q.status === "review") where.push("status = 'anchored' AND risk >= 0.3");
  else if (q.status && q.status !== "all") {
    where.push("status = ?");
    params.push(q.status);
  }
  return all<Record<string, unknown>>(
    `SELECT id, facility_id, period_start, period_end, merkle_root, reading_count, expected_count, direct_kg, indirect_kg, production_kg,
            allocated_kg, risk, status, onchain_id, anchor_tx, anchor_block, attest_tx, attested_by, attested_at, error, evidence_hash
     FROM batches ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY period_start DESC, id DESC LIMIT ?`,
    ...params,
    q.limit ?? 200,
  );
}

export function batchDetail(id: number) {
  const b = get<Record<string, unknown>>("SELECT * FROM batches WHERE id = ?", id);
  if (!b) throw new HttpError(404, "Batch not found");
  const incidents = all<Record<string, unknown>>(
    "SELECT id, detector, category, severity, score, title, status, first_ts, last_ts, est_understatement_kg FROM incidents WHERE facility_id = ? AND first_ts <= ? AND last_ts > ? ORDER BY score DESC",
    b.facility_id,
    b.period_end,
    b.period_start,
  );
  const readings = all<Record<string, unknown>>(
    "SELECT id, device_id, seq, ts, metric, value_milli, payload_hash, leaf, leaf_index FROM readings WHERE batch_id = ? ORDER BY leaf_index LIMIT 400",
    id,
  );
  return {
    ...b,
    manifest: JSON.parse(b.manifest as string),
    attestation: b.attestation ? JSON.parse(b.attestation as string) : null,
    incidents,
    intervals: intervalsFor(b.facility_id as string, b.period_start as number, b.period_end as number),
    readings,
    explorer: { anchor: chain.explorerTx(b.anchor_tx as string), attest: chain.explorerTx(b.attest_tx as string) },
  };
}

/** Everything a third party needs to verify one reading without trusting Mizan. */
export function readingProof(id: number) {
  const r = get<Record<string, unknown>>(
    `SELECT r.*, d.public_key, d.public_key_hash, d.chain_id AS device_chain_id, b.onchain_id, b.merkle_root, b.status AS batch_status, b.anchor_tx
     FROM readings r JOIN devices d ON d.id = r.device_id LEFT JOIN batches b ON b.id = r.batch_id WHERE r.id = ?`,
    id,
  );
  if (!r) throw new HttpError(404, "Reading not found");
  const tree = r.batch_id ? batchTree(r.batch_id as number) : null;
  return {
    reading: {
      id: r.id,
      deviceId: r.device_id,
      facilityId: r.facility_id,
      seq: r.seq,
      ts: r.ts,
      metric: r.metric,
      valueMilli: r.value_milli,
      signature: r.signature,
    },
    device: { publicKey: r.public_key, publicKeyHash: r.public_key_hash, chainId: r.device_chain_id, scheme: PQ_SCHEME },
    batch: r.batch_id
      ? { id: r.batch_id, onchainId: r.onchain_id, merkleRoot: r.merkle_root, status: r.batch_status, anchorTx: r.anchor_tx, leafIndex: r.leaf_index }
      : null,
    proof: tree && r.leaf_index != null ? tree.proof(r.leaf_index as number) : [],
  };
}

export function sampleReadings(q: { batchId?: number; facilityId?: string; limit?: number }) {
  if (q.batchId) {
    return all("SELECT id, device_id, metric, value_milli, ts, seq FROM readings WHERE batch_id = ? ORDER BY leaf_index LIMIT ?", q.batchId, q.limit ?? 50);
  }
  return all(
    `SELECT id, device_id, metric, value_milli, ts, seq FROM readings WHERE batch_id IS NOT NULL ${q.facilityId ? "AND facility_id = ?" : ""}
     ORDER BY id DESC LIMIT ?`,
    ...(q.facilityId ? [q.facilityId, q.limit ?? 50] : [q.limit ?? 50]),
  );
}

export function listCertificates(importerId?: string) {
  return all<Record<string, unknown>>(
    `SELECT * FROM certificates ${importerId ? "WHERE importer_id = ?" : ""} ORDER BY id DESC`,
    ...(importerId ? [importerId] : []),
  ).map((c) => ({
    ...c,
    allocations: JSON.parse(c.allocations as string),
    facilityName: facilityById(c.facility_id as string)?.name,
    seeT: (c.embedded_kg as number) / (c.quantity_kg as number),
  }));
}

export const listRejections = (limit = 100) =>
  all("SELECT id, device_id, facility_id, seq, ts, reason, detail, received_at FROM rejections ORDER BY id DESC LIMIT ?", limit);

export const listCarbonPrices = () => all("SELECT * FROM carbon_prices ORDER BY id DESC");
