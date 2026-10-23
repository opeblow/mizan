import { FACTORS, INTENSITY_BOUNDS, METRICS, facilityById, type FacilityDef, type MetricCode, type MetricTotals } from "@mizan/shared";
import { all, get, run } from "../db";
import { bus } from "../events";
import { config } from "../config";
import { IsolationForest } from "./iforest";
import { mad, median, noisyOr, robustZ } from "./stats";

/**
 * Integrity engine. Runs on every completed metering interval and combines five independent detectors:
 *
 *   physics     physical plausibility envelopes per tonne of product (mass and energy balance)
 *   statistical robust z-score of each intensity ratio against the facility's own recent history
 *   iforest     Isolation Forest over the joint feature vector, catches combinations no single rule sees
 *   stuck       a meter that repeats the exact same value while the plant is producing
 *   missing     an input that reads zero while product keeps coming out
 *
 * Detector scores are fused with a noisy-OR into an interval risk in [0, 1]. Consecutive hits of the same
 * detector on the same ratio or device are merged into one incident a verifier reviews once.
 */

export type Severity = "low" | "medium" | "high" | "critical";
export type Category = "data-quality" | "manipulation" | "security";

export interface Flag {
  detector: "physics" | "statistical" | "iforest" | "stuck" | "missing";
  key: string;
  score: number;
  severity: Severity;
  category: Category;
  title: string;
  explanation: string;
  evidence: Record<string, unknown>;
  understatementKg: number;
  deviceId?: string;
}

/** kg CO2e attributable to one unit of each metric (used to size the possible understatement). */
const EF_BY_METRIC: Partial<Record<MetricCode, number>> = {
  electricity_kwh: FACTORS.gridKgPerKwh,
  natural_gas_nm3: FACTORS.naturalGasKgPerNm3,
  petcoke_kg: FACTORS.petcokeKgPerKg,
  charge_carbon_kg: FACTORS.chargeCarbonKgPerKg,
  clinker_output_kg: FACTORS.clinkerCalcinationKgPerKg,
};

const severityOf = (s: number): Severity => (s >= 0.9 ? "critical" : s >= 0.75 ? "high" : s >= 0.5 ? "medium" : "low");
const fmt = (x: number, d = 3) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(d));
const hourOf = (ts: number) => (new Date(ts * 1000).getUTCHours() + 3) % 24; // Türkiye is UTC+3 all year

interface Model {
  forest: IsolationForest | null;
  ratioStats: { med: number; mad: number }[];
  featureStats: { med: number; mad: number }[];
  prodMedian: number;
  trainedAt: number;
  samples: number;
  sinceTrain: number;
}

const models = new Map<string, Model>();
const MIN_TRAIN = 192; // two days of 15-minute intervals
const RETRAIN_EVERY = 96;
export const IFOREST_THRESHOLD = 0.6;

interface IntervalRow {
  facility_id: string;
  ts: number;
  metrics: string;
  production_kg: number;
  risk: number;
  label: string | null;
}

function ratiosOf(f: FacilityDef, m: MetricTotals): number[] {
  return INTENSITY_BOUNDS[f.sector].map((b) => {
    const den = m[b.denominator] ?? 0;
    return den > 0 ? (m[b.numerator] ?? 0) / den : NaN;
  });
}

function featuresOf(f: FacilityDef, m: MetricTotals, ts: number, prodMedian: number): number[] {
  const bounds = INTENSITY_BOUNDS[f.sector];
  const ratios = ratiosOf(f, m).map((r, i) => r / bounds[i].typical);
  const prod = (m[f.productionMetric] ?? 0) / (prodMedian || 1);
  const h = (hourOf(ts) / 24) * 2 * Math.PI;
  return [...ratios, prod, Math.sin(h) * 0.25, Math.cos(h) * 0.25];
}

/** Trains (or retrains) the per-facility model on recent intervals that are clean or were cleared by a verifier. */
export function train(facilityId: string): Model | null {
  const f = facilityById(facilityId);
  if (!f) return null;
  const rows = all<IntervalRow>(
    `SELECT facility_id, ts, metrics, production_kg, risk, label FROM intervals
     WHERE facility_id = ? AND complete = 1 AND evaluated = 1
       AND ((risk < 0.3 AND label IS NULL) OR label = 'clean')
     ORDER BY ts DESC LIMIT 2000`,
    facilityId,
  );
  const producing = rows.filter((r) => r.production_kg > 0);
  const prodMedian = median(producing.map((r) => r.production_kg));
  const usable = producing.filter((r) => r.production_kg > 0.4 * prodMedian);
  const model: Model = {
    forest: null,
    ratioStats: [],
    featureStats: [],
    prodMedian: Number.isFinite(prodMedian) ? prodMedian : 0,
    trainedAt: Date.now(),
    samples: usable.length,
    sinceTrain: 0,
  };
  if (usable.length >= 24) {
    const ratioCols = usable.map((r) => ratiosOf(f, JSON.parse(r.metrics)));
    model.ratioStats = INTENSITY_BOUNDS[f.sector].map((_, i) => {
      const col = ratioCols.map((c) => c[i]).filter(Number.isFinite);
      const med = median(col);
      return { med, mad: mad(col, med) };
    });
  }
  if (usable.length >= MIN_TRAIN) {
    const X = usable.map((r) => featuresOf(f, JSON.parse(r.metrics), r.ts, model.prodMedian));
    model.featureStats = X[0].map((_, j) => {
      const col = X.map((x) => x[j]);
      const med = median(col);
      return { med, mad: mad(col, med) };
    });
    model.forest = new IsolationForest(X, 120, 256, hashSeed(facilityId));
  }
  models.set(facilityId, model);
  return model;
}

const hashSeed = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

export function modelInfo(facilityId: string) {
  const m = models.get(facilityId);
  return m
    ? { trained: !!m.forest, samples: m.samples, trainedAt: m.trainedAt, trees: m.forest?.nTrees ?? 0, threshold: IFOREST_THRESHOLD }
    : { trained: false, samples: 0, trainedAt: null, trees: 0, threshold: IFOREST_THRESHOLD };
}

function getModel(facilityId: string): Model | null {
  let m = models.get(facilityId);
  if (!m || (!m.forest && m.sinceTrain >= 24) || m.sinceTrain >= RETRAIN_EVERY) m = train(facilityId) ?? undefined;
  return m ?? null;
}

export function detect(f: FacilityDef, ts: number, m: MetricTotals): { flags: Flag[]; iforest: number | null } {
  const flags: Flag[] = [];
  const model = getModel(f.id);
  if (model) model.sinceTrain++;
  const bounds = INTENSITY_BOUNDS[f.sector];
  const production = m[f.productionMetric] ?? 0;
  const prodMedian = model?.prodMedian || production;
  const producing = production > 0.15 * prodMedian && production > 0;

  // missing: an input reads zero while product keeps coming out
  if (producing) {
    for (const b of bounds) {
      if (METRICS[b.numerator].role === "input" && (m[b.numerator] ?? 0) === 0 && (m[b.denominator] ?? 0) > 0) {
        const expected = b.typical * (m[b.denominator] ?? 0);
        flags.push({
          detector: "missing",
          key: b.numerator,
          score: 0.9,
          severity: "critical",
          category: "manipulation",
          title: `${METRICS[b.numerator].label} reads zero while production continues`,
          explanation: `${fmt((m[b.denominator] ?? 0) / 1000, 1)} t of ${METRICS[b.denominator].label.toLowerCase()} were recorded with no ${METRICS[b.numerator].label.toLowerCase()}. That breaks the mass and energy balance of the process: the input meter is offline, bypassed or its data is being withheld.`,
          evidence: { [b.numerator]: 0, [b.denominator]: m[b.denominator], expected },
          understatementKg: expected * (EF_BY_METRIC[b.numerator] ?? 0),
        });
      }
    }
  }

  const ratios = ratiosOf(f, m);
  if (producing) {
    bounds.forEach((b, i) => {
      const r = ratios[i];
      if (!Number.isFinite(r) || flags.some((x) => x.key === b.numerator && x.detector === "missing")) return;
      const den = m[b.denominator] ?? 0;
      const ef = EF_BY_METRIC[b.numerator] ?? 0;
      const gapKg = Math.max(0, (b.typical - r) * den * ef);

      // physics: outside what the process can physically do
      if (r < b.min || r > b.max) {
        const edge = r < b.min ? b.min : b.max;
        const dist = Math.abs(r - edge) / edge;
        const score = Math.min(0.97, 0.62 + dist * 1.4);
        const below = r < b.min;
        flags.push({
          detector: "physics",
          key: b.ratio,
          score,
          severity: severityOf(score),
          category: below ? "manipulation" : "data-quality",
          title: `${b.ratio} ${below ? "below" : "above"} the physical envelope`,
          explanation: below
            ? `Measured ${fmt(r)} ${b.unit} against a physical minimum of ${fmt(b.min)} ${b.unit} for this process (typical ${fmt(b.typical)}). Either the ${METRICS[b.numerator].label.toLowerCase()} meter under-reports or the ${METRICS[b.denominator].label.toLowerCase()} meter over-reports. Both make the product look cleaner than it is.`
            : `Measured ${fmt(r)} ${b.unit} against a physical maximum of ${fmt(b.max)} ${b.unit} (typical ${fmt(b.typical)}). Likely a calibration fault, unit error or a production meter that stopped counting.`,
          evidence: { ratio: r, min: b.min, max: b.max, typical: b.typical, numerator: m[b.numerator], denominator: den },
          understatementKg: below ? gapKg : 0,
        });
        return;
      }

      // statistical: inside physics, but far from this facility's own normal
      const st = model?.ratioStats[i];
      if (st && Number.isFinite(st.med)) {
        const z = robustZ(r, st.med, Math.max(st.mad, st.med * 0.01));
        if (Math.abs(z) > 4.5) {
          const score = Math.min(0.85, 0.42 + (Math.abs(z) - 4.5) / 12);
          flags.push({
            detector: "statistical",
            key: b.ratio,
            score,
            severity: severityOf(score),
            category: z < 0 ? "manipulation" : "data-quality",
            title: `${b.ratio} ${z < 0 ? "far below" : "far above"} this plant's normal`,
            explanation: `${fmt(r)} ${b.unit} is ${fmt(Math.abs(z), 1)} robust standard deviations ${z < 0 ? "below" : "above"} the median of ${fmt(st.med)} ${b.unit} measured at this installation over recent verified windows. It is still physically possible, so a verifier should check the shift log before accepting it.`,
            evidence: { ratio: r, median: st.med, mad: st.mad, z },
            understatementKg: z < 0 ? Math.max(0, (st.med - r) * den * ef) : 0,
          });
        }
      }
    });
  }

  // iforest: unusual joint behaviour
  let iforest: number | null = null;
  if (producing && model?.forest) {
    const x = featuresOf(f, m, ts, model.prodMedian);
    if (x.every(Number.isFinite)) {
      iforest = model.forest.score(x);
      if (iforest > IFOREST_THRESHOLD && !flags.some((fl) => fl.detector === "physics" || fl.detector === "missing")) {
        const names = [...bounds.map((b) => b.ratio), "Production rate", "Hour of day (sin)", "Hour of day (cos)"];
        const drivers = x
          .map((v, j) => ({ name: names[j], z: robustZ(v, model.featureStats[j].med, Math.max(model.featureStats[j].mad, 1e-3)) }))
          .slice(0, bounds.length + 1)
          .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
          .slice(0, 2);
        const score = Math.min(0.8, 0.15 + (iforest - IFOREST_THRESHOLD) * 2.5);
        flags.push({
          detector: "iforest",
          key: "joint",
          score,
          severity: severityOf(score),
          category: "data-quality",
          title: "Unusual combination of process readings",
          explanation: `The Isolation Forest trained on ${model.samples} clean intervals of this plant isolates this interval unusually fast (score ${iforest.toFixed(2)}, threshold ${IFOREST_THRESHOLD}). Main drivers: ${drivers.map((d) => `${d.name.toLowerCase()} ${d.z >= 0 ? "+" : "−"}${Math.abs(d.z).toFixed(1)}σ`).join(", ")}.`,
          evidence: { score: iforest, threshold: IFOREST_THRESHOLD, drivers },
          understatementKg: 0,
        });
      }
    }
  }

  // stuck: a meter repeating the exact same value while the plant produces
  if (producing) {
    for (const d of f.devices) {
      const last = all<{ value_milli: number }>(
        "SELECT value_milli FROM readings WHERE device_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 4",
        d.id,
        ts,
      );
      if (last.length === 4 && last.every((r) => r.value_milli === last[0].value_milli) && last[0].value_milli > 0) {
        flags.push({
          detector: "stuck",
          key: d.id,
          deviceId: d.id,
          score: 0.6,
          severity: "medium",
          category: "data-quality",
          title: `${d.label} repeats the same value`,
          explanation: `Four consecutive readings of exactly ${fmt(last[0].value_milli / 1000, 1)} ${METRICS[d.metric].unit}. Real process meters always show noise, so the sensor is frozen, disconnected from its transducer or replaying a fixed value.`,
          evidence: { value: last[0].value_milli / 1000, repeats: 4 },
          understatementKg: 0,
        });
      }
    }
  }

  return { flags, iforest };
}

interface IncidentRow {
  id: number;
  occurrences: number;
  score: number;
  est_understatement_kg: number;
}

/** Merges a flag into an open incident (same facility, detector and key, contiguous in time) or opens a new one. */
export function recordFlag(facilityId: string, ts: number, flag: Flag | (Omit<Flag, "detector"> & { detector: string })) {
  const gap = config.intervalSeconds * 3;
  const open = get<IncidentRow>(
    `SELECT id, occurrences, score, est_understatement_kg FROM incidents
     WHERE facility_id = ? AND detector = ? AND key = ? AND status = 'open' AND last_ts >= ?
     ORDER BY id DESC LIMIT 1`,
    facilityId,
    flag.detector,
    flag.key,
    ts - gap,
  );
  const now = Math.floor(Date.now() / 1000);
  if (open) {
    const score = Math.max(open.score, flag.score);
    run(
      `UPDATE incidents SET last_ts = MAX(last_ts, ?), occurrences = occurrences + 1, score = ?, severity = ?,
       est_understatement_kg = est_understatement_kg + ?, explanation = ?, evidence = ? WHERE id = ?`,
      ts,
      score,
      severityOf(score),
      flag.understatementKg,
      flag.explanation,
      JSON.stringify(flag.evidence),
      open.id,
    );
    bus.publish({ type: "incident", incidentId: open.id, facilityId, severity: severityOf(score), title: flag.title, isNew: false });
    return open.id;
  }
  const res = run(
    `INSERT INTO incidents (facility_id, device_id, detector, category, key, severity, score, title, explanation, evidence,
       first_ts, last_ts, est_understatement_kg, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    facilityId,
    flag.deviceId ?? null,
    flag.detector,
    flag.category,
    flag.key,
    flag.severity,
    flag.score,
    flag.title,
    flag.explanation,
    JSON.stringify(flag.evidence),
    ts,
    ts,
    flag.understatementKg,
    now,
  );
  const id = Number(res.lastInsertRowid);
  bus.publish({ type: "incident", incidentId: id, facilityId, severity: flag.severity, title: flag.title, isNew: true });
  return id;
}

export const fuseRisk = (flags: { score: number }[]) => noisyOr(flags.map((f) => f.score));
