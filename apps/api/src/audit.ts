import { sha256Hex } from "@mizan/shared";
import { all, get, run } from "./db";
import { userById } from "./auth";

/**
 * Append-only, hash-chained audit log. Every entry commits to the previous one, so deleting or editing any
 * past entry breaks every hash after it. The head hash is written into every batch manifest, which is
 * anchored on-chain, so the log is periodically notarised as well.
 */
const GENESIS = "0x" + "0".repeat(64);

interface AuditRow {
  seq: number;
  ts: number;
  actor: string;
  action: string;
  subject: string;
  data: string;
  prev_hash: string;
  hash: string;
}

const entryHash = (prev: string, seq: number, ts: number, actor: string, action: string, subject: string, data: string) =>
  sha256Hex([prev, seq, ts, actor, action, subject, data].join("\u001f"));

export function audit(actor: string, action: string, subject: string, data: unknown = {}) {
  const last = get<AuditRow>("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1");
  const seq = (last?.seq ?? 0) + 1;
  const prev = last?.hash ?? GENESIS;
  const ts = Math.floor(Date.now() / 1000);
  const json = JSON.stringify(data);
  const hash = entryHash(prev, seq, ts, actor, action, subject, json);
  run(
    "INSERT INTO audit_log (seq, ts, actor, action, subject, data, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    seq, ts, actor, action, subject, json, prev, hash,
  );
  return { seq, hash };
}

export const auditHead = () => get<AuditRow>("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1") ?? { seq: 0, hash: GENESIS };

export function verifyAuditChain(): { ok: boolean; entries: number; brokenAt: number | null } {
  const rows = all<AuditRow>("SELECT * FROM audit_log ORDER BY seq ASC");
  let prev = GENESIS;
  for (const r of rows) {
    const expect = entryHash(prev, r.seq, r.ts, r.actor, r.action, r.subject, r.data);
    if (r.prev_hash !== prev || r.hash !== expect) return { ok: false, entries: rows.length, brokenAt: r.seq };
    prev = r.hash;
  }
  return { ok: true, entries: rows.length, brokenAt: null };
}

export const listAudit = (limit = 100, before?: number) =>
  all<AuditRow>(
    before ? "SELECT * FROM audit_log WHERE seq < ? ORDER BY seq DESC LIMIT ?" : "SELECT * FROM audit_log ORDER BY seq DESC LIMIT ?",
    ...(before ? [before, limit] : [limit]),
  ).map((r) => ({ ...r, actorName: userById(r.actor)?.name ?? r.actor, data: JSON.parse(r.data) }));
