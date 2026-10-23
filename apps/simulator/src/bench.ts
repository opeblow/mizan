import { generateKeyPair, signReading, verifyReadingSignature, PQ_SCHEME, type Reading } from "@mizan/shared";

/** Measures ML-DSA-44 key generation, signing and verification speed on this machine. */
const n = Number(process.argv[2] ?? 200);
const t0 = performance.now();
const keys = generateKeyPair();
const tKey = performance.now() - t0;
const r: Reading = { deviceId: "TR-CEM-01:GRID", facilityId: "TR-CEM-01", seq: 1, ts: 1761000000, metric: "electricity_kwh", valueMilli: 3465123 };
const signed = [];
const t1 = performance.now();
for (let i = 0; i < n; i++) signed.push(signReading({ ...r, seq: i }, keys.secretKey));
const tSign = performance.now() - t1;
const t2 = performance.now();
let ok = 0;
for (const s of signed) if (verifyReadingSignature(s, keys.publicKey)) ok++;
const tVerify = performance.now() - t2;
console.log(`${PQ_SCHEME}: keygen ${tKey.toFixed(1)} ms | sign ${(tSign / n).toFixed(2)} ms/op | verify ${(tVerify / n).toFixed(2)} ms/op | ${ok}/${n} valid`);
console.log(`public key ${(keys.publicKey.length - 2) / 2} B, signature ${(signed[0].signature.length - 2) / 2} B`);
