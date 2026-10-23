# Security and data integrity assessment

Scope: the Mizan reference implementation in this repository (meters, ingestion API, integrity engine, smart contracts, web app). Written for reviewers who want to know what is protected, how, and what is not.

## 1. Assets and the questions an attacker wants to change

| Asset | Why it matters |
|---|---|
| Meter readings (energy, fuel, production) | Embedded emissions, and therefore money under CBAM, are computed from them |
| Window totals and Merkle roots | They are what certificates are built from |
| Verifier attestations | They turn data into evidence an EU importer can rely on |
| Certificates, allocations, claims | They carry a monetary deduction; double use is fraud |
| Carbon price paid at origin | Deductible once; over-allocation is fraud |
| Audit trail | It shows who did what |

The dominant attacker in MRV is **not an outsider**. It is an operator with an incentive to under-report, an insider with database access, or a compromised meter. The design assumes the Mizan server itself may be dishonest.

## 2. Controls

### 2.1 Data origin: post-quantum signatures at the meter
- Every reading is signed at the source with **ML-DSA-44** (NIST FIPS 204, the standardised form of CRYSTALS-Dilithium). Security category 2; public key 1,312 bytes, signature 2,420 bytes. Implementation: `@noble/post-quantum` (audited-style, pure TypeScript, constant-time where it matters).
- **Why post-quantum here.** CBAM declarations, verification reports and the readings behind them must be kept and may be disputed for years. A signature made today with ECDSA could be forged retroactively once a cryptographically relevant quantum computer exists, which would let someone rewrite historic emissions with valid-looking signatures. ML-DSA removes that risk at the layer where the long-lived evidence is created. It is lattice-based (Module-LWE / Module-SIS); signing is deterministic in our use (hedged randomness can be enabled).
- **Signed payload.** Integers only (milli-units), fixed field order, domain separation string `mizan.reading.v1`, delimiter injection rejected (`packages/shared/src/reading.ts`). The bytes are identical in any language.
- **Key binding.** `keccak256(publicKey)` is registered on-chain in `MizanRegistry` with the scheme id. Anyone can fetch the full key from the API and check its hash against the chain, so the API cannot substitute keys unnoticed. Re-enrolling a device with a different key is refused (`device.key_swap_blocked` in the audit log) unless the device is first revoked on-chain.
- **Private keys never leave the meter process** (`apps/simulator/.keys`, mode 600). In production they live in the meter's secure element or an HSM-backed gateway.

### 2.2 Ingestion gate
Each message is checked in this order (`apps/api/src/ingest.ts`): device enrolled, device active, facility and metric match the registration, sequence strictly increasing (replay and cloned-device protection, exact replays are identified), timestamp strictly increasing, ML-DSA signature valid, window not already sealed. Rejections are stored with the full payload and become security incidents. There is no user authentication on `/api/ingest`: the signature is the authentication.

### 2.3 Integrity engine (AI)
Five detectors score every complete 15-minute interval: physical envelopes per tonne of product (energy and mass balance), missing inputs while output continues, robust z-scores against the plant's own history, an isolation forest over the joint feature vector, and frozen sensors. Scores are fused with a noisy-OR. Each finding carries a plain-language explanation, the evidence values and an estimate of the CO₂ it would hide.
- Training data excludes intervals with risk ≥ 0.3 and intervals inside incidents a verifier confirmed; incidents a verifier dismissed are added back as clean data. This prevents an attacker from slowly "teaching" the model that manipulated data is normal, unless the verifier approves it.
- The model is deterministic (seeded) so a decision can be reproduced in a dispute.
- The AI does not decide. It ranks and explains; the accredited verifier signs.

### 2.4 Commitment: Merkle roots on-chain
Every 6-hour window is sealed: readings are ordered (`ts`, `deviceId`), each leaf is `keccak256(keccak256(payloadHash ‖ signatureHash))` (double hashing prevents second-preimage attacks on the tree), pairs are hashed in sorted order (OpenZeppelin `MerkleProof` compatible). The root, totals, risk and a hash of the full manifest are anchored by `MRVLedger.anchorBatch`.
- **Overlapping windows are refused on-chain**, so the same hour of emissions cannot be reported twice, even by the oracle.
- `MRVLedger.verifyReading` lets anyone prove a single reading belongs to an anchored window.
- Editing any stored reading changes its leaf, and the rebuilt root no longer matches the chain. `pnpm tamper` demonstrates this; the Audit page sweep and the public verifier both catch it.

### 2.5 Attestation
Only `VERIFIER_ROLE` can attest, once per window, Pending → Verified or Rejected. The attestation hash commits to a JSON report (decision, findings reviewed, note, verifier identity). Rejected windows can never back a certificate.

### 2.6 Double counting (the economic core)
`EmissionsCertificate`:
1. Computes embedded emissions **on-chain** from the windows' anchored totals, applying the CBAM Annex II rule (indirect emissions only for cement and fertilisers), rounding up so a certificate can never understate.
2. Calls `MRVLedger.allocateProduction`, which refuses to allocate more production than a verified window measured: each tonne backs one certificate.
3. Allocates carbon price paid at origin once across all certificates of the facility.
4. Refuses a second certificate for the same shipment reference.
5. `claimDeduction` can succeed once per token; the claim survives transfers, so a resold certificate cannot be deducted again. The API deliberately has no off-chain "already claimed" shortcut: the contract is the authority, as the demo shows.

### 2.7 Audit trail
Append-only, hash-chained (`apps/api/src/audit.ts`). The head is embedded in every batch manifest, whose hash is anchored, so the log is notarised on-chain every window.

### 2.8 Independent verification
The public verifier (`/verify`) runs in the browser: it fetches evidence from the API (treated as untrusted), verifies the ML-DSA signature locally, checks the key hash against the registry, rebuilds the Merkle path, reads roots, statuses and certificates directly from the chain over JSON-RPC, and recomputes certificate emissions from on-chain data.

## 3. STRIDE

| Threat | Example | Control | Residual risk |
|---|---|---|---|
| **S**poofing | Fake meter injects readings | Enrolled keys only, signature check, registry hash | Enrolment token theft could enrol a rogue device; enrolment is audited and on-chain |
| **T**ampering | Operator edits DB to lower emissions | Signatures, Merkle roots on-chain, sweep, public verifier | Tampering *before* signing (physical meter manipulation) is caught only statistically by the AI and by site audits |
| **T**ampering | CT ratio altered at the meter | Physics envelopes, z-scores, isolation forest | Small, slow drift within noise may evade detection; mitigated by periodic calibration evidence |
| **R**epudiation | Verifier denies approving | Attestation tx from the verifier's key + report hash | Key custody is the verifier's responsibility |
| **I**nformation disclosure | Competitors read production data | Only hashes and window totals on-chain; readings stay off-chain | Window totals reveal throughput; a production deployment can anchor commitments only (see §5) |
| **D**enial of service | Flood `/api/ingest` | Signature check before any write; body limits | Signature verification costs CPU; rate limiting per device recommended |
| **E**levation of privilege | Oracle issues certificate from rejected data | Contract checks status and allocation itself | Oracle key compromise allows anchoring false windows, but they still need a verifier signature |

## 4. Smart-contract risk review
- Roles separated: registrar, oracle, verifier, certifier (contract-to-contract), issuer, authority. Admin can grant roles; in production the admin is a multisig with a timelock.
- No external calls to untrusted contracts; `_safeMint` targets known importer wallets. Checks-effects order respected in `issue` and `claimDeduction`.
- Integer arithmetic in kg and cents, `uint64`/`uint128`, Solidity 0.8 overflow checks.
- Custom errors give precise revert reasons the UI shows to users.
- 15 Hardhat tests cover every guarantee in §2.4–2.6 (`packages/contracts/test/Mizan.test.ts`).
- Not done in the hackathon: external audit, fuzzing (Echidna/Foundry invariant tests), formal verification of the allocation invariant (Σ allocated ≤ measured). These are first on the roadmap.

## 5. Known limitations, stated plainly
1. **Hybrid post-quantum.** Data is PQ-signed at the source; the blockchain layer (EVM, ECDSA accounts) is not post-quantum. A future quantum attacker could forge chain transactions, but not meter evidence. Migration path: account abstraction with ML-DSA verification (precompile proposals) or anchoring the same roots on a PQ-secure ledger; registry already stores a scheme id.
2. **On-chain ML-DSA verification is not done.** Too expensive on today's EVM; signatures are verified off-chain by the API and by any browser, and bound to the chain through the leaf hash.
3. **Demo custody.** For a one-command demo the API holds the oracle, verifier, authority and importer keys (Hardhat development accounts). In production each party signs with its own wallet; the API's verifier and importer endpoints become transaction builders.
4. **Demo login** is password-less role selection (`DEMO_MODE=true`). Production: SSO/OIDC per organisation, set `DEMO_MODE=false`.
5. **Simulated meters.** The physics follow published sector intensities; real deployments connect existing revenue meters and SCADA through a signing gateway.
6. **Privacy.** Window totals are public on-chain. Where that is commercially sensitive, anchor salted commitments and disclose totals to the verifier and importer only.
