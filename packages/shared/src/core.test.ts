import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MerkleTree,
  verifyProof,
  leafOf,
  generateKeyPair,
  signReading,
  verifyReadingSignature,
  payloadHash,
  signatureHash,
  readingLeaf,
  canonicalReading,
  computeEmissions,
  cbamRelevantKg,
  cbamExposure,
  Sector,
  sha256Hex,
  type Reading,
} from "./index";

const reading: Reading = { deviceId: "TR-CEM-01:GRID", facilityId: "TR-CEM-01", seq: 7, ts: 1761000000, metric: "electricity_kwh", valueMilli: 3_465_123 };

test("canonical encoding is domain separated and rejects delimiter injection", () => {
  assert.equal(canonicalReading(reading), "mizan.reading.v1|TR-CEM-01:GRID|TR-CEM-01|7|1761000000|electricity_kwh|3465123");
  assert.throws(() => canonicalReading({ ...reading, deviceId: "A|B" }));
  assert.throws(() => canonicalReading({ ...reading, valueMilli: 1.5 }));
});

test("ML-DSA-44 signatures verify and fail on any change", () => {
  const keys = generateKeyPair();
  const signed = signReading(reading, keys.secretKey);
  assert.equal((signed.signature.length - 2) / 2, 2420);
  assert.equal(verifyReadingSignature(signed, keys.publicKey), true);
  assert.equal(verifyReadingSignature({ ...signed, valueMilli: signed.valueMilli - 1 }, keys.publicKey), false);
  assert.equal(verifyReadingSignature({ ...signed, seq: 8 }, keys.publicKey), false);
  const other = generateKeyPair();
  assert.equal(verifyReadingSignature(signed, other.publicKey), false);
});

test("Merkle proofs verify for every leaf, odd sizes included", () => {
  for (const n of [1, 2, 3, 7, 8, 13, 96]) {
    const leaves = Array.from({ length: n }, (_, i) => leafOf(sha256Hex(`p${i}`), sha256Hex(`s${i}`)));
    const tree = new MerkleTree(leaves);
    leaves.forEach((l, i) => assert.equal(verifyProof(l, tree.proof(i), tree.root), true, `n=${n} i=${i}`));
    assert.equal(verifyProof(leafOf(sha256Hex("x"), sha256Hex("y")), tree.proof(0), tree.root), false);
  }
});

test("reading leaf binds payload and signature", () => {
  const keys = generateKeyPair();
  const signed = signReading(reading, keys.secretKey);
  assert.equal(readingLeaf(signed), leafOf(payloadHash(signed), signatureHash(signed.signature)));
});

test("emissions follow sector rules", () => {
  const cement = computeEmissions(Sector.Cement, { clinker_output_kg: 1000, petcoke_kg: 102, electricity_kwh: 140, cement_output_kg: 1316 });
  assert.ok(Math.abs(cement.directKg - (1000 * 0.525 + 102 * 3.169)) < 1e-6);
  assert.ok(Math.abs(cement.indirectKg - 140 * 0.442) < 1e-6);
  assert.equal(cbamRelevantKg(Sector.Cement, cement), cement.directKg + cement.indirectKg);
  const steel = computeEmissions(Sector.IronSteel, { steel_output_kg: 1000, electricity_kwh: 430, natural_gas_nm3: 25, charge_carbon_kg: 12 });
  assert.equal(cbamRelevantKg(Sector.IronSteel, steel), steel.directKg);
});

test("CBAM exposure applies phase-in and caps the origin deduction", () => {
  const r = cbamExposure({ year: 2026, exportsT: 1000, seeT: 0.7, euaPrice: 80, originCarbonPricePerT: 200 });
  assert.equal(r.phaseIn, 0.025);
  assert.ok(Math.abs(r.chargedT - 17.5) < 1e-9);
  assert.equal(r.netEur, 0);
  const full = cbamExposure({ year: 2034, exportsT: 1000, seeT: 0.7, euaPrice: 80, originCarbonPricePerT: 10 });
  assert.ok(Math.abs(full.netEur - (700 * 80 - 700 * 10)) < 1e-6);
});
