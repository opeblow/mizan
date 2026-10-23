import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { FACILITIES, generateKeyPair, signReading, type FacilityDef, type Hex, type Reading, type SignedReading } from "@mizan/shared";
import { rng, simulateInterval, toMilli, type Values } from "./plant";

/**
 * Meter fleet simulator. Every meter owns an ML-DSA-44 key pair that never leaves this process (in a real
 * deployment it lives in the meter's secure element). Commands:
 *   backfill  enroll meters, then generate signed history up to REPLAY_DAYS ago, with recorded incidents
 *   live      replay the last REPLAY_DAYS at SPEED x real time, then continue in real time;
 *             exposes a control port so the dashboard can trigger attack scenarios on demand
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
loadEnv({ path: path.resolve(ROOT, "../../.env") });

const API = process.env.API_URL ?? "http://127.0.0.1:8787";
const ENROLL_TOKEN = process.env.DEVICE_ENROLL_TOKEN ?? "mizan-dev-enroll-token";
const INTERVAL = Number(process.env.INTERVAL_SECONDS ?? 900);
const BACKFILL_DAYS = Number(process.env.BACKFILL_DAYS ?? 10);
const REPLAY_DAYS = Number(process.env.REPLAY_DAYS ?? 3);
const SPEED = Number(process.env.SIM_SPEED ?? 450);
const CONTROL_PORT = Number(process.env.SIMULATOR_PORT ?? 8799);
const KEY_DIR = path.join(ROOT, ".keys");
const STATE_FILE = path.join(KEY_DIR, "state.json");

interface DeviceState {
  seq: number;
  lastValueMilli: number;
  lastSigned?: SignedReading;
}
interface State {
  lastTs: number;
  devices: Record<string, DeviceState>;
}

const log = (...a: unknown[]) => console.log("[meters]", ...a);

/* ---------------------------------------------------------------- keys & state */

function loadKeys(): Record<string, { publicKey: Hex; secretKey: Hex }> {
  fs.mkdirSync(KEY_DIR, { recursive: true });
  const keys: Record<string, { publicKey: Hex; secretKey: Hex }> = {};
  for (const f of FACILITIES) {
    for (const d of f.devices) {
      const file = path.join(KEY_DIR, `${d.id.replace(/[:]/g, "_")}.json`);
      if (fs.existsSync(file)) keys[d.id] = JSON.parse(fs.readFileSync(file, "utf8"));
      else {
        keys[d.id] = generateKeyPair();
        fs.writeFileSync(file, JSON.stringify(keys[d.id]), { mode: 0o600 });
      }
    }
  }
  return keys;
}

const loadState = (): State =>
  fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : { lastTs: 0, devices: {} };
const saveState = (s: State) => {
  const slim = { lastTs: s.lastTs, devices: Object.fromEntries(Object.entries(s.devices).map(([k, v]) => [k, { seq: v.seq, lastValueMilli: v.lastValueMilli }])) };
  fs.writeFileSync(STATE_FILE, JSON.stringify(slim));
};

/* ---------------------------------------------------------------- API */

async function post(pathname: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: any }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${API}${pathname}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    } catch (e) {
      if (attempt >= 30) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function enrollAll(keys: Record<string, { publicKey: Hex }>) {
  for (const f of FACILITIES) {
    for (const d of f.devices) {
      const res = await post("/api/devices/enroll", { deviceId: d.id, publicKey: keys[d.id].publicKey }, { "x-enroll-token": ENROLL_TOKEN });
      if (res.status !== 200) throw new Error(`Enrollment of ${d.id} failed: ${JSON.stringify(res.data)}`);
      if (!res.data.alreadyEnrolled) log(`enrolled ${d.id} (ML-DSA-44 key ${String(res.data.publicKeyHash).slice(0, 12)}…)`);
    }
  }
}

/* ---------------------------------------------------------------- scenarios */

type ScenarioName = "meter-tamper" | "meter-tamper-subtle" | "replay" | "forged-signature" | "stuck-sensor" | "fuel-bypass";
interface ActiveScenario {
  name: ScenarioName;
  facilityId: string;
  remaining: number;
}

const DEFAULT_TARGET: Record<ScenarioName, string> = {
  "meter-tamper": "TR-STL-01",
  "meter-tamper-subtle": "TR-STL-01",
  replay: "TR-STL-01",
  "forged-signature": "TR-CEM-01",
  "stuck-sensor": "TR-ALU-01",
  "fuel-bypass": "TR-CEM-01",
};
const DURATION: Record<ScenarioName, number> = {
  "meter-tamper": 24,
  "meter-tamper-subtle": 24,
  replay: 1,
  "forged-signature": 1,
  "stuck-sensor": 10,
  "fuel-bypass": 8,
};

/** Applies manipulation to the true process values, the way a dishonest operator or a broken meter would. */
function manipulate(f: FacilityDef, v: Values, active: ActiveScenario[], state: State): Values {
  const out = { ...v };
  for (const s of active) {
    if (s.facilityId !== f.id) continue;
    if (s.name === "meter-tamper") {
      // grid meter CT ratio altered: reports 68% of the real consumption
      if (out.electricity_kwh !== undefined) out.electricity_kwh *= 0.68;
    }
    if (s.name === "meter-tamper-subtle") {
      if (out.electricity_kwh !== undefined) out.electricity_kwh *= 0.86;
    }
    if (s.name === "fuel-bypass") {
      // fuel fed through an unmetered bypass line
      if (out.petcoke_kg !== undefined) out.petcoke_kg = 0;
      if (out.natural_gas_nm3 !== undefined) out.natural_gas_nm3 = 0;
    }
    if (s.name === "stuck-sensor") {
      const dev = f.devices.find((d) => d.metric === "natural_gas_nm3") ?? f.devices[0];
      const last = state.devices[dev.id]?.lastValueMilli;
      if (last) out[dev.metric] = last / 1000;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- generator */

function buildInterval(
  ts: number,
  keys: Record<string, { secretKey: Hex }>,
  state: State,
  active: ActiveScenario[],
  r: ReturnType<typeof rng>,
): SignedReading[] {
  const out: SignedReading[] = [];
  for (const f of FACILITIES) {
    const truth = simulateInterval(f, ts, INTERVAL, r);
    const reported = manipulate(f, truth, active, state);
    const attacks = active.filter((s) => s.facilityId === f.id);
    for (const d of f.devices) {
      const ds = (state.devices[d.id] ??= { seq: -1, lastValueMilli: 0 });
      const reading: Reading = {
        deviceId: d.id,
        facilityId: f.id,
        seq: ds.seq + 1,
        ts,
        metric: d.metric,
        valueMilli: toMilli(reported[d.metric] ?? 0),
      };
      const signed = signReading(reading, keys[d.id].secretKey);

      // attacker injects a copy with a lowered value but the original signature
      if (attacks.some((a) => a.name === "forged-signature") && d.metric === f.devices[0].metric) {
        out.push({ ...signed, valueMilli: Math.round(signed.valueMilli * 0.55) });
      }
      out.push(signed);
      // attacker re-sends an older genuine message to pad the record
      if (attacks.some((a) => a.name === "replay") && d === f.devices[0] && ds.lastSigned) out.push(ds.lastSigned);

      ds.seq = reading.seq;
      ds.lastValueMilli = reading.valueMilli;
      ds.lastSigned = signed;
    }
  }
  for (const s of active) s.remaining--;
  return out;
}

async function send(readings: SignedReading[]) {
  const res = await post("/api/ingest", { readings });
  if (res.status !== 200) throw new Error(`ingest failed (${res.status}): ${JSON.stringify(res.data)}`);
  return res.data as { accepted: number; rejected: { reason: string; deviceId: string }[]; sealedBatches: number[] };
}

/* ---------------------------------------------------------------- backfill */

/** Incidents baked into history so the verifier queue and the ledger have a past. Days are relative to backfill end. */
const HISTORY: { dayOffset: number; hour: number; name: ScenarioName; facilityId?: string; intervals?: number }[] = [
  { dayOffset: -9, hour: 2, name: "fuel-bypass", intervals: 8 },
  { dayOffset: -8, hour: 0, name: "meter-tamper-subtle", intervals: 24 },
  { dayOffset: -6, hour: 9, name: "stuck-sensor", intervals: 10 },
  { dayOffset: -4, hour: 23, name: "meter-tamper", intervals: 20 },
  { dayOffset: -2, hour: 14, name: "replay" },
  { dayOffset: -2, hour: 15, name: "forged-signature" },
];

async function backfill() {
  const keys = loadKeys();
  await enrollAll(keys);
  const state: State = { lastTs: 0, devices: {} };
  const end = Math.floor(Date.now() / 1000 / INTERVAL) * INTERVAL - REPLAY_DAYS * 86400;
  const start = end - BACKFILL_DAYS * 86400;
  const r = rng(20261025);
  const active: ActiveScenario[] = [];
  const startAt = Date.now();
  let buffer: SignedReading[] = [];
  let accepted = 0;
  let rejected = 0;
  let batches = 0;
  const total = (end - start) / INTERVAL;

  log(`backfilling ${BACKFILL_DAYS} days (${total} intervals x ${FACILITIES.reduce((s, f) => s + f.devices.length, 0)} meters), signing every reading with ML-DSA-44`);
  for (let ts = start + INTERVAL, i = 0; ts <= end; ts += INTERVAL, i++) {
    for (const h of HISTORY) {
      const at = end + h.dayOffset * 86400;
      const atTs = Math.floor(at / 86400) * 86400 + (h.hour - 3) * 3600; // local hour -> UTC
      if (ts === atTs || (ts > atTs && ts - INTERVAL < atTs)) {
        active.push({ name: h.name, facilityId: h.facilityId ?? DEFAULT_TARGET[h.name], remaining: h.intervals ?? DURATION[h.name] });
      }
    }
    buffer.push(...buildInterval(ts, keys, state, active, r));
    for (let k = active.length - 1; k >= 0; k--) if (active[k].remaining <= 0) active.splice(k, 1);
    if (buffer.length >= 120 || ts + INTERVAL > end) {
      const res = await send(buffer);
      accepted += res.accepted;
      rejected += res.rejected.length;
      batches += res.sealedBatches.length;
      buffer = [];
    }
    if (i % 96 === 0) log(`  day ${Math.round(i / 96) + 1}/${BACKFILL_DAYS}  accepted ${accepted}  rejected ${rejected}  windows sealed ${batches}`);
  }
  state.lastTs = end;
  saveState(state);
  log(`backfill done in ${((Date.now() - startAt) / 1000).toFixed(1)} s: ${accepted} readings accepted, ${rejected} rejected, ${batches} windows sealed`);
}

/* ---------------------------------------------------------------- live */

async function live() {
  const keys = loadKeys();
  await enrollAll(keys);
  const state = loadState();
  if (!state.lastTs) {
    state.lastTs = Math.floor(Date.now() / 1000 / INTERVAL) * INTERVAL - REPLAY_DAYS * 86400;
    log("no backfill state found, starting fresh");
  }
  const r = rng(state.lastTs);
  const active: ActiveScenario[] = [];
  let mode: "catch-up" | "real-time" = "catch-up";
  const stats = { sent: 0, accepted: 0, rejected: 0, sealed: 0, lastError: null as string | null };

  const server = http.createServer(async (req, res) => {
    const reply = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/status") {
      return reply(200, { running: true, mode, simTs: state.lastTs, speed: mode === "catch-up" ? SPEED : 1, active, stats });
    }
    if (req.method === "POST" && req.url === "/scenario") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const { scenario, facilityId } = JSON.parse(raw || "{}") as { scenario: string; facilityId?: string };
      if (scenario === "clear") {
        active.splice(0, active.length);
        log("scenarios cleared");
        return reply(200, { ok: true, active });
      }
      if (!(scenario in DURATION)) return reply(400, { error: `unknown scenario ${scenario}` });
      const name = scenario as ScenarioName;
      const target = facilityId && FACILITIES.some((f) => f.id === facilityId) ? facilityId : DEFAULT_TARGET[name];
      active.push({ name, facilityId: target, remaining: DURATION[name] });
      log(`scenario started: ${name} at ${target} for ${DURATION[name]} intervals`);
      return reply(200, { ok: true, scenario: name, facilityId: target, intervals: DURATION[name], active });
    }
    reply(404, { error: "not found" });
  });
  server.listen(CONTROL_PORT, "127.0.0.1", () => log(`control port http://127.0.0.1:${CONTROL_PORT}`));

  const tickMs = (INTERVAL * 1000) / SPEED;
  log(`live: replaying from ${new Date(state.lastTs * 1000).toISOString()} at ${SPEED}x (one 15-min interval every ${(tickMs / 1000).toFixed(1)} s), then real time`);

  for (;;) {
    const next = state.lastTs + INTERVAL;
    const nowS = Date.now() / 1000;
    if (next > nowS) {
      if (mode === "catch-up") log("caught up with the wall clock, continuing in real time");
      mode = "real-time";
      await new Promise((res) => setTimeout(res, Math.min(60_000, (next - nowS) * 1000)));
      if (state.lastTs + INTERVAL > Date.now() / 1000) continue;
    }
    const t0 = Date.now();
    const batch = buildInterval(next, keys, state, active, r);
    for (let k = active.length - 1; k >= 0; k--) if (active[k].remaining <= 0) active.splice(k, 1);
    try {
      const res = await send(batch);
      stats.sent += batch.length;
      stats.accepted += res.accepted;
      stats.rejected += res.rejected.length;
      stats.sealed += res.sealedBatches.length;
      stats.lastError = null;
      for (const rj of res.rejected) log(`  rejected ${rj.deviceId}: ${rj.reason}`);
      if (res.sealedBatches.length) log(`  sealed windows ${res.sealedBatches.join(", ")}`);
    } catch (e) {
      stats.lastError = (e as Error).message;
      log("send failed:", stats.lastError);
    }
    state.lastTs = next;
    saveState(state);
    if (mode === "catch-up") await new Promise((res) => setTimeout(res, Math.max(0, tickMs - (Date.now() - t0))));
  }
}

const cmd = process.argv[2] ?? "live";
(cmd === "backfill" ? backfill() : live()).catch((e) => {
  console.error("[meters] fatal:", e);
  process.exit(1);
});
