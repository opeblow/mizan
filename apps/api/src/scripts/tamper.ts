import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";
import { config } from "../config";

/**
 * Plays a malicious insider: edits one electricity reading of a verified steel window straight in the
 * database to make the plant look cleaner. Nothing in the app is told. Then try:
 *   - Audit trail > Run full integrity sweep
 *   - Public verifier > the reading id printed below
 * Both detect it, because the anchored Merkle root and the meter's ML-DSA signature no longer match.
 */
const db = new DatabaseSync(path.join(config.dataDir, "mizan.db"));
const target = db
  .prepare(
    `SELECT r.id, r.device_id, r.value_milli, r.batch_id, b.onchain_id FROM readings r JOIN batches b ON b.id = r.batch_id
     WHERE r.metric = 'electricity_kwh' AND r.facility_id = 'TR-STL-01' AND b.status = 'verified' ORDER BY r.id DESC LIMIT 1`,
  )
  .get() as { id: number; device_id: string; value_milli: number; batch_id: number; onchain_id: number } | undefined;

if (!target) {
  console.error("No verified steel window yet. Run the demo first.");
  process.exit(1);
}
const lowered = Math.round(target.value_milli * 0.6);
db.prepare("UPDATE readings SET value_milli = ? WHERE id = ?").run(lowered, target.id);
console.log(`Tampered reading #${target.id} (${target.device_id}) in on-chain window #${target.onchain_id}:`);
console.log(`  ${(target.value_milli / 1000).toFixed(1)} kWh  ->  ${(lowered / 1000).toFixed(1)} kWh  (40% less electricity, 40% less scope 2)`);
console.log(`Now open http://127.0.0.1:5173/verify/reading/${target.id} or run the integrity sweep on the Audit page.`);
