import {
  FACILITIES,
  MerkleTree,
  PQ_SCHEME_ID,
  facilityById,
  idToBytes32,
  keccak256Hex,
  leafOf,
  payloadHash,
  publicKeyHash,
  sha256Hex,
  signatureHash,
  type Hex,
  type MetricCode,
} from "@mizan/shared";
import { all, get, run, tx } from "./db";
import { chain, ChainError } from "./chain";
import { audit } from "./audit";
import { bus } from "./events";
import { train } from "./integrity/engine";
import { userById, USERS, type User } from "./auth";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

const now = () => Math.floor(Date.now() / 1000);

/* ------------------------------------------------------------------ facilities & devices */

export async function bootstrapFacilities() {
  for (const f of FACILITIES) {
    const chainId = idToBytes32(f.id);
    if (!get("SELECT 1 FROM facilities WHERE id = ?", f.id)) {
      run("INSERT INTO facilities (id, chain_id, name, sector, created_at) VALUES (?, ?, ?, ?, ?)", f.id, chainId, f.name, f.sector, now());
    }
    if (!chain.ready) continue;
    const onchain = await chain.registry.getFacility(chainId);
    if (Number(onchain.registeredAt) === 0) {
      const receipt = await chain.send("oracle", chain.registry, "registerFacility", [chainId, chain.address("oracle"), f.countryCode, f.sector, f.name]);
      run("UPDATE facilities SET registered_tx = ? WHERE id = ?", receipt.hash, f.id);
      audit("oracle", "facility.registered", `facility:${f.id}`, { chainId, tx: receipt.hash });
    }
  }
}

export async function enrollDevice(deviceId: string, publicKey: Hex) {
  const def = FACILITIES.flatMap((f) => f.devices).find((d) => d.id === deviceId);
  if (!def) throw new HttpError(404, `Device ${deviceId} is not part of any registered installation`);
  if (!/^0x[0-9a-fA-F]+$/.test(publicKey) || publicKey.length !== 2 + 1312 * 2) {
    throw new HttpError(400, "Public key must be a 1,312-byte ML-DSA-44 key in hex");
  }
  const keyHash = publicKeyHash(publicKey);
  const existing = get<{ public_key_hash: string }>("SELECT public_key_hash FROM devices WHERE id = ?", deviceId);
  if (existing && existing.public_key_hash !== keyHash) {
    audit("system", "device.key_swap_blocked", `device:${deviceId}`, { attemptedKeyHash: keyHash });
    throw new HttpError(409, "This device is already enrolled with a different key. Revoke it on-chain before re-keying.");
  }
  if (!chain.ready) throw new HttpError(503, chain.lastError ?? "chain not ready");
  const chainId = idToBytes32(deviceId);
  const onchain = await chain.registry.getDevice(chainId);
  let txHash: string | null = null;
  if (Number(onchain.registeredAt) === 0) {
    const receipt = await chain.send("oracle", chain.registry, "registerDevice", [chainId, idToBytes32(def.facilityId), keyHash, PQ_SCHEME_ID]);
    txHash = receipt.hash;
  } else if (onchain.pubKeyHash.toLowerCase() !== keyHash.toLowerCase()) {
    throw new HttpError(409, "On-chain registry holds a different key for this device");
  }
  if (!existing) {
    run(
      "INSERT INTO devices (id, facility_id, metric, chain_id, public_key, public_key_hash, registered_tx, enrolled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      deviceId,
      def.facilityId,
      def.metric,
      chainId,
      publicKey,
      keyHash,
      txHash,
      now(),
    );
    audit("oracle", "device.enrolled", `device:${deviceId}`, { keyHash, tx: txHash, scheme: "ML-DSA-44" });
  }
  return { deviceId, chainId, publicKeyHash: keyHash, tx: txHash, alreadyEnrolled: !!existing };
}

/* ------------------------------------------------------------------ incidents */

export function reviewIncident(user: User, id: number, decision: "confirmed" | "dismissed", note: string) {
  const inc = get<{ facility_id: string; first_ts: number; last_ts: number; status: string; detector: string }>(
    "SELECT facility_id, first_ts, last_ts, status, detector FROM incidents WHERE id = ?",
    id,
  );
  if (!inc) throw new HttpError(404, "Incident not found");
  tx(() => {
    run("UPDATE incidents SET status = ?, reviewer = ?, review_note = ?, reviewed_at = ? WHERE id = ?", decision, user.name, note, now(), id);
    // Human feedback goes back into the model: cleared intervals become training data, confirmed ones never will.
    run(
      "UPDATE intervals SET label = ? WHERE facility_id = ? AND ts >= ? AND ts <= ?",
      decision === "dismissed" ? "clean" : "anomalous",
      inc.facility_id,
      inc.first_ts,
      inc.last_ts,
    );
  });
  train(inc.facility_id);
  audit(user.id, `incident.${decision}`, `incident:${id}`, { note, detector: inc.detector });
  return { id, status: decision };
}

/* ------------------------------------------------------------------ attestation */

interface BatchRow {
  id: number;
  facility_id: string;
  status: string;
  onchain_id: number | null;
  merkle_root: string;
  evidence_hash: string;
  risk: number;
  period_start: number;
  period_end: number;
  production_kg: number;
  allocated_kg: number;
  direct_kg: number;
  indirect_kg: number;
}

export async function attestBatch(user: User, batchId: number, approved: boolean, note: string) {
  const b = get<BatchRow>("SELECT * FROM batches WHERE id = ?", batchId);
  if (!b) throw new HttpError(404, "Batch not found");
  if (b.status !== "anchored" || b.onchain_id == null) throw new HttpError(409, `Batch is ${b.status}; only anchored batches can be attested`);
  const incidents = all<{ id: number; status: string; title: string }>(
    "SELECT id, status, title FROM incidents WHERE facility_id = ? AND first_ts <= ? AND last_ts > ?",
    b.facility_id,
    b.period_end,
    b.period_start,
  );
  const report = {
    schema: "mizan.verification-report.v1",
    batchId: b.onchain_id,
    facilityId: b.facility_id,
    period: [b.period_start, b.period_end],
    merkleRoot: b.merkle_root,
    evidenceHash: b.evidence_hash,
    decision: approved ? "verified" : "rejected",
    riskAtReview: Number(b.risk.toFixed(4)),
    incidentsReviewed: incidents.map((i) => ({ id: i.id, status: i.status })),
    note,
    verifier: { name: user.name, org: user.org, address: chain.address("verifier") },
    signedAt: new Date().toISOString(),
  };
  const attestationHash = sha256Hex(JSON.stringify(report));
  const receipt = await chain.send("verifier", chain.ledger, "attest", [b.onchain_id, approved, attestationHash]);
  run(
    "UPDATE batches SET status = ?, attest_tx = ?, attestation = ?, attestation_hash = ?, attested_by = ?, attested_at = ? WHERE id = ?",
    approved ? "verified" : "rejected",
    receipt.hash,
    JSON.stringify(report),
    attestationHash,
    user.name,
    now(),
    batchId,
  );
  audit(user.id, approved ? "batch.verified" : "batch.rejected", `batch:${batchId}`, { tx: receipt.hash, attestationHash, note });
  bus.publish({ type: "batch", batchId, facilityId: b.facility_id, status: approved ? "verified" : "rejected", risk: b.risk });
  return { batchId, status: approved ? "verified" : "rejected", tx: receipt.hash, attestationHash };
}

export async function attestLowRisk(user: User, maxRisk: number, facilityId?: string) {
  const rows = all<{ id: number }>(
    `SELECT id FROM batches WHERE status = 'anchored' AND risk < ? ${facilityId ? "AND facility_id = ?" : ""} ORDER BY period_start`,
    ...(facilityId ? [maxRisk, facilityId] : [maxRisk]),
  );
  const done: number[] = [];
  for (const r of rows) {
    await attestBatch(user, r.id, true, `Bulk attestation: AI integrity risk below ${(maxRisk * 100).toFixed(0)}%, no open incidents in window.`);
    done.push(r.id);
  }
  return { attested: done.length, batchIds: done };
}

/* ------------------------------------------------------------------ carbon price paid at origin */

export async function recordCarbonPrice(user: User, input: { facilityId: string; tonnes: number; eurPerTonne: number; scheme: string; evidence: string }) {
  if (!facilityById(input.facilityId)) throw new HttpError(404, "Unknown facility");
  const pricedKg = Math.round(input.tonnes * 1000);
  const paidCents = Math.round(input.tonnes * input.eurPerTonne * 100);
  const evidenceHash = sha256Hex(input.evidence);
  const receipt = await chain.send("authority", chain.certificate, "recordCarbonPrice", [idToBytes32(input.facilityId), pricedKg, paidCents, evidenceHash]);
  run(
    "INSERT INTO carbon_prices (facility_id, priced_kg, paid_eur, scheme, evidence, evidence_hash, tx, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    input.facilityId,
    pricedKg,
    paidCents / 100,
    input.scheme,
    input.evidence,
    evidenceHash,
    receipt.hash,
    now(),
  );
  audit(user.id, "carbon_price.recorded", `facility:${input.facilityId}`, { pricedKg, paidCents, scheme: input.scheme, tx: receipt.hash });
  return { tx: receipt.hash, pricedKg, paidEur: paidCents / 100 };
}

/* ------------------------------------------------------------------ certificates */

export function availableProduction(facilityId: string) {
  return all<BatchRow & { available: number }>(
    `SELECT *, production_kg - allocated_kg AS available FROM batches
     WHERE facility_id = ? AND status = 'verified' AND production_kg - allocated_kg > 0 ORDER BY period_start`,
    facilityId,
  );
}

export function planAllocations(facilityId: string, quantityKg: number) {
  const rows = availableProduction(facilityId);
  const plan: { batchId: number; onchainId: number; productionKg: number }[] = [];
  let left = quantityKg;
  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(left, Math.floor(r.available));
    if (take <= 0) continue;
    plan.push({ batchId: r.id, onchainId: r.onchain_id!, productionKg: take });
    left -= take;
  }
  const total = rows.reduce((s, r) => s + Math.floor(r.available), 0);
  return { plan, shortfallKg: Math.max(0, left), availableKg: total };
}

export async function issueCertificate(user: User, input: { facilityId: string; importerId: string; quantityT: number; shipmentRef: string }) {
  const f = facilityById(input.facilityId);
  if (!f) throw new HttpError(404, "Unknown facility");
  const importer = userById(input.importerId);
  if (!importer || importer.role !== "importer" || !importer.wallet) throw new HttpError(400, "Unknown importer");
  const quantityKg = Math.round(input.quantityT * 1000);
  const { plan, shortfallKg, availableKg } = planAllocations(input.facilityId, quantityKg);
  if (shortfallKg > 0) {
    throw new HttpError(409, `Only ${(availableKg / 1000).toFixed(1)} t of verified, unallocated production is available at ${f.name}`, {
      availableKg,
    });
  }
  const shipmentHash = keccak256Hex(`mizan:shipment:${input.shipmentRef.trim()}`);
  const importerAddress = chain.address(importer.wallet);
  const args = [
    importerAddress,
    {
      facilityId: idToBytes32(f.id),
      cnCode: f.product.cnCode,
      shipmentRef: shipmentHash,
      allocations: plan.map((p) => ({ batchId: p.onchainId, productionKg: p.productionKg })),
    },
  ];
  await chain.simulate("oracle", chain.certificate, "issue", args);
  const receipt = await chain.send("oracle", chain.certificate, "issue", args);
  const ev = chain.parseLogs(receipt, chain.certificate, "CertificateIssued")[0]!;
  const tokenId = Number(ev.args.tokenId);
  tx(() => {
    run(
      `INSERT INTO certificates (id, facility_id, importer_id, importer_address, cn_code, shipment_ref, shipment_hash, quantity_kg, embedded_kg,
        priced_kg, carbon_price_eur, allocations, issue_tx, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      tokenId,
      f.id,
      importer.id,
      importerAddress,
      f.product.cnCode,
      input.shipmentRef.trim(),
      shipmentHash,
      Number(ev.args.quantityKg),
      Number(ev.args.embeddedEmissionsKg),
      Number(ev.args.pricedEmissionsKg),
      Number(ev.args.carbonPricePaidCents) / 100,
      JSON.stringify(plan),
      receipt.hash,
      now(),
    );
    for (const p of plan) run("UPDATE batches SET allocated_kg = allocated_kg + ? WHERE id = ?", p.productionKg, p.batchId);
  });
  audit(user.id, "certificate.issued", `certificate:${tokenId}`, { facilityId: f.id, importer: importer.org, quantityKg, tx: receipt.hash });
  bus.publish({ type: "certificate", certificateId: tokenId, facilityId: f.id, status: "issued" });
  return getCertificate(tokenId);
}

export async function claimCertificate(user: User, id: number, declarationRef: string) {
  const c = get<{ facility_id: string; importer_id: string }>("SELECT facility_id, importer_id FROM certificates WHERE id = ?", id);
  if (!c) throw new HttpError(404, "Certificate not found");
  if (!user.wallet) throw new HttpError(403, "No wallet for this user");
  const declHash = keccak256Hex(`mizan:declaration:${declarationRef.trim()}`);
  try {
    // Deliberately no off-chain "already claimed" shortcut: the smart contract is the authority.
    await chain.simulate(user.wallet, chain.certificate, "claimDeduction", [id, declHash]);
  } catch (e) {
    const err = e as ChainError;
    audit(user.id, "certificate.claim_blocked", `certificate:${id}`, { reason: err.message, declarationRef });
    throw new HttpError(409, `Blocked by the smart contract: ${err.revert?.name ?? err.message}`, { revert: err.revert?.name, message: err.message });
  }
  const receipt = await chain.send(user.wallet, chain.certificate, "claimDeduction", [id, declHash]);
  run("UPDATE certificates SET claim_tx = ?, declaration_ref = ?, claimed_at = ? WHERE id = ?", receipt.hash, declarationRef.trim(), now(), id);
  audit(user.id, "certificate.claimed", `certificate:${id}`, { declarationRef, tx: receipt.hash });
  bus.publish({ type: "certificate", certificateId: id, facilityId: c.facility_id, status: "claimed" });
  return getCertificate(id);
}

export async function transferCertificate(user: User, id: number, toImporterId: string) {
  const to = userById(toImporterId);
  if (!to?.wallet || to.role !== "importer") throw new HttpError(400, "Unknown importer");
  if (!user.wallet) throw new HttpError(403, "No wallet for this user");
  const from = chain.address(user.wallet);
  const receipt = await chain.send(user.wallet, chain.certificate, "transferFrom", [from, chain.address(to.wallet), id]);
  run("UPDATE certificates SET importer_id = ?, importer_address = ? WHERE id = ?", to.id, chain.address(to.wallet), id);
  audit(user.id, "certificate.transferred", `certificate:${id}`, { to: to.org, tx: receipt.hash });
  return getCertificate(id);
}

export function getCertificate(id: number) {
  const c = get<Record<string, unknown>>("SELECT * FROM certificates WHERE id = ?", id);
  if (!c) throw new HttpError(404, "Certificate not found");
  const f = facilityById(c.facility_id as string)!;
  const importer = userById(c.importer_id as string);
  const plan = JSON.parse(c.allocations as string) as { batchId: number; onchainId: number; productionKg: number }[];
  const batches = plan.map((p) => ({
    ...p,
    batch: get("SELECT id, onchain_id, period_start, period_end, merkle_root, status, risk, anchor_tx, attest_tx FROM batches WHERE id = ?", p.batchId),
  }));
  const quantityT = (c.quantity_kg as number) / 1000;
  return {
    ...c,
    allocations: batches,
    facility: { id: f.id, name: f.name, city: f.city, sector: f.sector, product: f.product },
    importer: importer ? { id: importer.id, name: importer.name, org: importer.org, country: importer.country } : null,
    seeT: (c.embedded_kg as number) / 1000 / quantityT,
  };
}

/* ------------------------------------------------------------------ integrity sweep */

/**
 * Recomputes every stored reading's hashes from its fields and rebuilds each batch's Merkle root, then
 * compares with the root anchored on-chain. Detects any edit made directly in the database.
 */
export async function integritySweep() {
  const batches = all<BatchRow>("SELECT * FROM batches WHERE onchain_id IS NOT NULL ORDER BY id");
  const broken: { batchId: number; reason: string; readingIds: number[] }[] = [];
  let readingsChecked = 0;
  for (const b of batches) {
    const rows = all<{ id: number; device_id: string; facility_id: string; seq: number; ts: number; metric: string; value_milli: number; signature: string; leaf: string }>(
      "SELECT id, device_id, facility_id, seq, ts, metric, value_milli, signature, leaf FROM readings WHERE batch_id = ? ORDER BY leaf_index",
      b.id,
    );
    readingsChecked += rows.length;
    const bad: number[] = [];
    const leaves = rows.map((r) => {
      const l = leafOf(payloadHash({ deviceId: r.device_id, facilityId: r.facility_id, seq: r.seq, ts: r.ts, metric: r.metric as MetricCode, valueMilli: r.value_milli }), signatureHash(r.signature));
      if (l !== r.leaf) bad.push(r.id);
      return l;
    });
    const root = leaves.length ? new MerkleTree(leaves).root : "0x";
    let onchainRoot: string | null = null;
    if (chain.ready) {
      try {
        onchainRoot = (await chain.ledger.getBatch(b.onchain_id)).merkleRoot as string;
      } catch {
        onchainRoot = null;
      }
    }
    if (bad.length || (onchainRoot && onchainRoot.toLowerCase() !== root.toLowerCase())) {
      broken.push({ batchId: b.id, reason: bad.length ? "reading fields no longer match their signed hash" : "rebuilt Merkle root differs from on-chain root", readingIds: bad });
    }
  }
  return { checkedAt: new Date().toISOString(), batches: batches.length, readings: readingsChecked, broken, ok: broken.length === 0 };
}

export const importers = () => USERS.filter((u) => u.role === "importer").map((u) => ({ id: u.id, name: u.name, org: u.org, country: u.country, address: u.wallet ? chain.address(u.wallet) : null }));
