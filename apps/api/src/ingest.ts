import {
  computeEmissions,
  facilityById,
  leafOf,
  payloadHash,
  signatureHash,
  verifyReadingSignature,
  type Hex,
  type MetricTotals,
  type SignedReading,
} from "@mizan/shared";
import { db, get, run, tx } from "./db";
import { bus } from "./events";
import { detect, fuseRisk, recordFlag } from "./integrity/engine";
import { isWindowSealed, sealClosedWindows } from "./batcher";

const INCIDENT_MIN_IFOREST = 0.45;

export type RejectReason =
  | "unknown-device"
  | "revoked-device"
  | "device-mismatch"
  | "bad-signature"
  | "replay"
  | "sequence-regression"
  | "stale-timestamp"
  | "window-sealed";

interface DeviceRow {
  id: string;
  facility_id: string;
  metric: string;
  public_key: string;
  status: string;
  last_seq: number;
  last_ts: number;
}

const SECURITY_INCIDENT: Partial<Record<RejectReason, { title: string; score: number; explain: (r: SignedReading, d?: string) => string }>> = {
  "bad-signature": {
    title: "Forged or altered reading rejected",
    score: 0.95,
    explain: (r) =>
      `A reading claiming to come from ${r.deviceId} (seq ${r.seq}) carried an ML-DSA-44 signature that does not verify against the meter's registered public key. The payload was altered in transit or produced by someone without the meter's private key. It was rejected and never entered the ledger.`,
  },
  replay: {
    title: "Replayed meter message blocked",
    score: 0.85,
    explain: (r) =>
      `A message identical to an already accepted reading of ${r.deviceId} (seq ${r.seq}) was sent again. Replays are how an attacker re-uses genuine signed data to fill a period with clean-looking numbers. Blocked by the per-device sequence check.`,
  },
  "sequence-regression": {
    title: "Out-of-sequence meter message blocked",
    score: 0.75,
    explain: (r, d) => `${r.deviceId} sent seq ${r.seq} after seq ${d}. Sequence numbers only move forward, so this message is either a replay of older data or a cloned device.`,
  },
  "unknown-device": {
    title: "Message from an unregistered device",
    score: 0.8,
    explain: (r) => `A reading arrived from "${r.deviceId}", which is not enrolled in the on-chain registry. Unknown devices cannot contribute data.`,
  },
  "revoked-device": {
    title: "Message from a revoked meter key",
    score: 0.9,
    explain: (r) => `${r.deviceId} was revoked in the registry, yet it is still sending data. The key may be compromised.`,
  },
};

export interface IngestOutcome {
  accepted: number;
  rejected: { index: number; deviceId: string; seq: number; reason: RejectReason; detail: string }[];
  sealedBatches: number[];
}

function reject(r: SignedReading, reason: RejectReason, detail: string, facilityId: string | null) {
  run(
    "INSERT INTO rejections (device_id, facility_id, seq, ts, reason, detail, payload, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    r.deviceId,
    facilityId,
    r.seq,
    r.ts,
    reason,
    detail,
    JSON.stringify(r),
    Math.floor(Date.now() / 1000),
  );
  if (facilityId) run("UPDATE devices SET rejected_count = rejected_count + 1 WHERE id = ?", r.deviceId);
  const sec = SECURITY_INCIDENT[reason];
  if (sec && facilityId) {
    recordFlag(facilityId, r.ts, {
      detector: reason,
      key: r.deviceId,
      deviceId: r.deviceId,
      score: sec.score,
      severity: sec.score >= 0.9 ? "critical" : "high",
      category: "security",
      title: sec.title,
      explanation: sec.explain(r, detail),
      evidence: { deviceId: r.deviceId, seq: r.seq, ts: r.ts, metric: r.metric, valueMilli: r.valueMilli, reason },
      understatementKg: 0,
    });
  }
  bus.publish({ type: "rejection", facilityId, deviceId: r.deviceId, reason, detail });
}

export function ingestReadings(readings: SignedReading[]): IngestOutcome {
  const out: IngestOutcome = { accepted: 0, rejected: [], sealedBatches: [] };
  const touched = new Map<string, Set<number>>();
  const insert = db.prepare(
    `INSERT INTO readings (device_id, facility_id, seq, ts, metric, value_milli, signature, payload_hash, signature_hash, leaf, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = Math.floor(Date.now() / 1000);

  tx(() => {
    readings.forEach((r, index) => {
      const d = get<DeviceRow>("SELECT * FROM devices WHERE id = ?", r.deviceId);
      const fail = (reason: RejectReason, detail: string, facilityId: string | null) => {
        reject(r, reason, detail, facilityId);
        out.rejected.push({ index, deviceId: r.deviceId, seq: r.seq, reason, detail });
      };
      if (!d) {
        const guess = r.facilityId && facilityById(r.facilityId) ? r.facilityId : null;
        return fail("unknown-device", "device not enrolled", guess);
      }
      if (d.status !== "active") return fail("revoked-device", `device status ${d.status}`, d.facility_id);
      if (r.facilityId !== d.facility_id || r.metric !== d.metric) {
        return fail("device-mismatch", `registered for ${d.facility_id}/${d.metric}`, d.facility_id);
      }
      const ph = payloadHash(r);
      if (r.seq <= d.last_seq) {
        const dup = get("SELECT 1 FROM readings WHERE device_id = ? AND payload_hash = ?", r.deviceId, ph);
        return dup ? fail("replay", `seq ${r.seq} already accepted`, d.facility_id) : fail("sequence-regression", String(d.last_seq), d.facility_id);
      }
      if (r.ts <= d.last_ts) return fail("stale-timestamp", `ts ${r.ts} <= last ${d.last_ts}`, d.facility_id);
      if (!verifyReadingSignature(r, d.public_key as Hex)) return fail("bad-signature", "ML-DSA-44 verification failed", d.facility_id);
      if (isWindowSealed(d.facility_id, r.ts)) return fail("window-sealed", "reporting window already sealed and anchored", d.facility_id);

      const sh = signatureHash(r.signature);
      const res = insert.run(r.deviceId, r.facilityId, r.seq, r.ts, r.metric, r.valueMilli, r.signature, ph, sh, leafOf(ph, sh), now);
      run(
        "UPDATE devices SET last_seq = ?, last_ts = ?, last_value = ?, readings_count = readings_count + 1 WHERE id = ?",
        r.seq,
        r.ts,
        r.valueMilli / 1000,
        r.deviceId,
      );
      mergeInterval(r);
      out.accepted++;
      if (!touched.has(r.facilityId)) touched.set(r.facilityId, new Set());
      touched.get(r.facilityId)!.add(r.ts);
      bus.publish({
        type: "reading",
        facilityId: r.facilityId,
        deviceId: r.deviceId,
        metric: r.metric,
        ts: r.ts,
        value: r.valueMilli / 1000,
        readingId: Number(res.lastInsertRowid),
      });
    });

    for (const [facilityId, tsSet] of touched) {
      for (const ts of [...tsSet].sort((a, b) => a - b)) {
        if (evaluateIfComplete(facilityId, ts)) out.sealedBatches.push(...sealClosedWindows(facilityId, ts));
      }
    }
  });
  return out;
}

function mergeInterval(r: SignedReading) {
  const row = get<{ metrics: string }>("SELECT metrics FROM intervals WHERE facility_id = ? AND ts = ?", r.facilityId, r.ts);
  const metrics: MetricTotals = row ? JSON.parse(row.metrics) : {};
  metrics[r.metric] = r.valueMilli / 1000;
  if (row) run("UPDATE intervals SET metrics = ? WHERE facility_id = ? AND ts = ?", JSON.stringify(metrics), r.facilityId, r.ts);
  else run("INSERT INTO intervals (facility_id, ts, metrics) VALUES (?, ?, ?)", r.facilityId, r.ts, JSON.stringify(metrics));
}

/** Runs the integrity engine once every meter of the facility has reported for this interval. */
function evaluateIfComplete(facilityId: string, ts: number): boolean {
  const f = facilityById(facilityId);
  if (!f) return false;
  const row = get<{ metrics: string; evaluated: number }>("SELECT metrics, evaluated FROM intervals WHERE facility_id = ? AND ts = ?", facilityId, ts);
  if (!row || row.evaluated) return false;
  const metrics: MetricTotals = JSON.parse(row.metrics);
  if (!f.devices.every((d) => metrics[d.metric] !== undefined)) return false;

  const e = computeEmissions(f.sector, metrics);
  const { flags, iforest } = detect(f, ts, metrics);
  const risk = fuseRisk(flags);
  run(
    `UPDATE intervals SET complete = 1, evaluated = 1, direct_kg = ?, indirect_kg = ?, production_kg = ?, risk = ?, iforest = ?, flags = ?
     WHERE facility_id = ? AND ts = ?`,
    e.directKg,
    e.indirectKg,
    e.productionKg,
    risk,
    iforest,
    JSON.stringify(flags.map((x) => ({ detector: x.detector, key: x.key, score: Number(x.score.toFixed(3)), title: x.title }))),
    facilityId,
    ts,
  );
  // Weak isolation-forest hits still raise the interval's risk, but only open a verifier incident when the
  // model is reasonably confident, so the review queue is not flooded with noise.
  for (const fl of flags) if (fl.detector !== "iforest" || fl.score >= INCIDENT_MIN_IFOREST) recordFlag(facilityId, ts, fl);
  bus.publish({ type: "interval", facilityId, ts, risk, directKg: e.directKg, indirectKg: e.indirectKg, productionKg: e.productionKg });
  return true;
}
