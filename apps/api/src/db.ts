import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";
import { config, ensureDataDir } from "./config";

ensureDataDir();
export const DB_PATH = path.join(config.dataDir, "mizan.db");
export const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS facilities (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sector INTEGER NOT NULL,
  registered_tx TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  metric TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  public_key_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_seq INTEGER NOT NULL DEFAULT -1,
  last_ts INTEGER NOT NULL DEFAULT 0,
  last_value REAL,
  readings_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  registered_tx TEXT,
  enrolled_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES devices(id),
  facility_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  metric TEXT NOT NULL,
  value_milli INTEGER NOT NULL,
  signature TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  signature_hash TEXT NOT NULL,
  leaf TEXT NOT NULL,
  batch_id INTEGER,
  leaf_index INTEGER,
  received_at INTEGER NOT NULL,
  UNIQUE (device_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_readings_fac_ts ON readings(facility_id, ts);
CREATE INDEX IF NOT EXISTS idx_readings_batch ON readings(batch_id, leaf_index);

CREATE TABLE IF NOT EXISTS rejections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT,
  facility_id TEXT,
  seq INTEGER,
  ts INTEGER,
  reason TEXT NOT NULL,
  detail TEXT,
  payload TEXT,
  received_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS intervals (
  facility_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  metrics TEXT NOT NULL,
  complete INTEGER NOT NULL DEFAULT 0,
  direct_kg REAL NOT NULL DEFAULT 0,
  indirect_kg REAL NOT NULL DEFAULT 0,
  production_kg REAL NOT NULL DEFAULT 0,
  risk REAL NOT NULL DEFAULT 0,
  iforest REAL,
  flags TEXT NOT NULL DEFAULT '[]',
  evaluated INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  PRIMARY KEY (facility_id, ts)
);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  facility_id TEXT NOT NULL,
  device_id TEXT,
  detector TEXT NOT NULL,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  severity TEXT NOT NULL,
  score REAL NOT NULL,
  title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '{}',
  first_ts INTEGER NOT NULL,
  last_ts INTEGER NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1,
  est_understatement_kg REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  reviewer TEXT,
  review_note TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incidents_open ON incidents(facility_id, detector, key, status, last_ts);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  facility_id TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  merkle_root TEXT NOT NULL,
  reading_count INTEGER NOT NULL,
  expected_count INTEGER NOT NULL,
  direct_kg REAL NOT NULL,
  indirect_kg REAL NOT NULL,
  production_kg REAL NOT NULL,
  risk REAL NOT NULL,
  manifest TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  onchain_id INTEGER,
  anchor_tx TEXT,
  anchor_block INTEGER,
  anchored_at INTEGER,
  attest_tx TEXT,
  attestation TEXT,
  attestation_hash TEXT,
  attested_by TEXT,
  attested_at INTEGER,
  allocated_kg REAL NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (facility_id, period_start)
);

CREATE TABLE IF NOT EXISTS carbon_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  facility_id TEXT NOT NULL,
  priced_kg REAL NOT NULL,
  paid_eur REAL NOT NULL,
  scheme TEXT NOT NULL,
  evidence TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  tx TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY,
  facility_id TEXT NOT NULL,
  importer_id TEXT NOT NULL,
  importer_address TEXT NOT NULL,
  cn_code INTEGER NOT NULL,
  shipment_ref TEXT NOT NULL,
  shipment_hash TEXT NOT NULL,
  quantity_kg REAL NOT NULL,
  embedded_kg REAL NOT NULL,
  priced_kg REAL NOT NULL,
  carbon_price_eur REAL NOT NULL,
  allocations TEXT NOT NULL,
  issue_tx TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  claim_tx TEXT,
  declaration_ref TEXT,
  claimed_at INTEGER
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  subject TEXT NOT NULL,
  data TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
`);

export const getMeta = (key: string): string | undefined =>
  (db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;

export const setMeta = (key: string, value: string) =>
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export type Row = Record<string, unknown>;
export const all = <T = Row>(sql: string, ...params: unknown[]): T[] =>
  db.prepare(sql).all(...(params as never[])) as T[];
export const get = <T = Row>(sql: string, ...params: unknown[]): T | undefined =>
  db.prepare(sql).get(...(params as never[])) as T | undefined;
export const run = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...(params as never[]));
