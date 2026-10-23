import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

/**
 * Walks the demo history through the real workflows, each step by the party who owns it:
 *   verifier   reviews historical incidents, attests clean windows, rejects manipulated ones
 *   authority  records carbon price paid under the Turkish ETS pilot
 *   operator   issues embedded-emissions certificates for three export shipments
 *   importer   claims one certificate in a CBAM declaration
 * Leaves recent windows and one incident open so there is something to do in a live demo.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../../.env") });
const API = process.env.API_URL ?? "http://127.0.0.1:8787";
const log = (...a: unknown[]) => console.log("[seed]", ...a);

async function call<T = any>(method: string, p: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(data)}`);
  return data as T;
}

const login = async (userId: string) => (await call<{ token: string }>("POST", "/api/auth/login", undefined, { userId })).token;

async function waitForAnchoring() {
  const op = await login("op-elif");
  for (let i = 0; i < 120; i++) {
    const queued = await call<unknown[]>("GET", "/api/batches?status=queued", op);
    if (queued.length === 0) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("batches still queued after 2 minutes; is the chain running?");
}

async function main() {
  await waitForAnchoring();
  const verifier = await login("ver-kerem");
  const operator = await login("op-elif");
  const authority = await login("auth-ets");
  const hanna = await login("imp-hanna");

  // 1. verifier reviews the historical incidents
  const incidents = await call<any[]>("GET", "/api/incidents?status=open", verifier);
  const newest = Math.max(...incidents.map((i) => i.last_ts));
  for (const inc of incidents) {
    if (inc.last_ts > newest - 86400) continue; // leave the last day for the live demo
    const confirm = inc.category === "security" || inc.category === "manipulation";
    await call("POST", `/api/incidents/${inc.id}/review`, verifier, {
      decision: confirm ? "confirmed" : "dismissed",
      note: confirm
        ? "Confirmed on site visit: meter data inconsistent with process records. Window rejected; operator must resubmit with corrected metering or apply default values."
        : "Checked against shift log and maintenance records: sensor fault, emissions unaffected.",
    });
  }
  log(`reviewed ${incidents.filter((i) => i.last_ts <= newest - 86400).length} historical incidents`);

  // 2. clean windows get attested in bulk; manipulated windows are rejected one by one
  const bulk = await call<{ attested: number }>("POST", "/api/batches/attest-low-risk", verifier, { maxRisk: 0.3 });
  log(`attested ${bulk.attested} low-risk windows`);
  const risky = await call<any[]>("GET", "/api/batches?status=review", verifier);
  const latest = Math.max(...risky.map((b) => b.period_end), 0);
  for (const b of risky) {
    if (b.period_end > latest - 86400) continue;
    const detail = await call<any>("GET", `/api/batches/${b.id}`, verifier);
    const manipulated = detail.incidents.some((i: any) => i.status === "confirmed");
    await call("POST", `/api/batches/${b.id}/attest`, verifier, {
      approved: !manipulated,
      note: manipulated
        ? "Rejected: confirmed metering manipulation in this window. Data cannot support embedded-emissions claims."
        : "Verified after review: flagged readings explained by documented sensor maintenance.",
    });
  }
  log(`decided ${risky.filter((b) => b.period_end <= latest - 86400).length} high-risk windows`);

  // 3. carbon price paid at origin (Turkish ETS pilot)
  await call("POST", "/api/carbon-prices", authority, {
    facilityId: "TR-CEM-01",
    tonnes: 18000,
    eurPerTonne: 14.5,
    scheme: "TR-ETS pilot phase",
    evidence: "TR-ETS pilot allowance surrender, compliance year 2026, registry ref TR-ETS-2026-CEM-01-0007",
  });
  await call("POST", "/api/carbon-prices", authority, {
    facilityId: "TR-STL-01",
    tonnes: 3500,
    eurPerTonne: 14.5,
    scheme: "TR-ETS pilot phase",
    evidence: "TR-ETS pilot allowance surrender, compliance year 2026, registry ref TR-ETS-2026-STL-01-0003",
  });
  log("recorded carbon price paid at origin");

  // 4. certificates for export shipments
  const c1 = await call<any>("POST", "/api/certificates", operator, {
    facilityId: "TR-CEM-01",
    importerId: "imp-hanna",
    quantityT: 12000,
    shipmentRef: "INV-2026-ALI-0412 · Aliağa → Hamburg · MV Ege Star",
  });
  await call("POST", "/api/certificates", operator, {
    facilityId: "TR-STL-01",
    importerId: "imp-joost",
    quantityT: 5500,
    shipmentRef: "INV-2026-ISK-0388 · İskenderun → Rotterdam · MV Hatay Bridge",
  });
  await call("POST", "/api/certificates", operator, {
    facilityId: "TR-ALU-01",
    importerId: "imp-hanna",
    quantityT: 850,
    shipmentRef: "INV-2026-DIL-0091 · Dilovası → Koper · rail + sea",
  });
  log("issued 3 certificates");

  // 5. importer claims the first one in a CBAM declaration
  await call("POST", `/api/certificates/${c1.id}/claim`, hanna, { declarationRef: "DE-CBAM-2026-Q3-000117" });
  log("importer claimed certificate #" + c1.id);
}

main().catch((e) => {
  console.error("[seed] failed:", e.message);
  process.exit(1);
});
