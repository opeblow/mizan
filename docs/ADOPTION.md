# Implementation, adoption and scalability

## 1. Who uses Mizan, and why they would pay

| User | Job to be done | What Mizan gives them | Who pays |
|---|---|---|---|
| Turkish exporter of cement, steel, aluminium, fertiliser (the operator) | Prove actual embedded emissions to EU customers every quarter; avoid default values | Continuous, verifier-ready evidence; certificates per shipment; CBAM cost planning | Exporter, per installation per year |
| Accredited verifier | Verify annual emissions reports at reasonable cost | Risk-ranked windows, explained anomalies, one-click attestation of clean data, on-chain signature | Verifier licence, or bundled in the operator fee |
| EU importer (authorised CBAM declarant) | File declarations backed by trustworthy supplier data; avoid penalties | Certificates they can verify themselves; deduction claimed once, provably | Free (network effect), premium API for ERP integration |
| National ETS authority | Know which installations paid what, avoid double use of carbon price | Carbon price registry entries that are allocated once across exports | Public sector licence |
| Customs, NGOs, researchers | Check claims | Public verifier, open data on anchored windows | Free |

Why now: CBAM's definitive period started on 1 January 2026; the first annual declarations (for 2026 imports) are due 30 September 2027; certificates are bought from February 2027; the Turkish ETS pilot runs 2026–2027. Exporters need evidence systems in 2026, not 2028.

## 2. Implementation path for one installation (about 6 weeks)

| Week | Step |
|---|---|
| 1 | Data inventory: map revenue meters, weighbridges, fuel feeders to Mizan metrics; agree emission factors with the verifier (monitoring plan) |
| 2 | Install a signing gateway per site (industrial PC or the existing historian server) that reads Modbus/OPC UA/MQTT and signs with ML-DSA; keys generated in a TPM or HSM |
| 3 | Enrol devices on-chain; backfill 12 months of historian data marked "unsigned historical" so the AI has a baseline |
| 4 | Parallel run with the existing monthly report; tune physics envelopes to the plant's BREF values |
| 5 | Verifier onboarding: review UI, attestation keys, report template |
| 6 | First certificates to one EU customer |

Integration points already in the code: `POST /api/devices/enroll`, `POST /api/ingest` (batch of signed readings, any language that can produce the canonical string and an ML-DSA signature), public read API, contract events for ERP/registry integration.

## 3. Go-to-market
1. **Chambers first.** The Istanbul Chamber of Industry and Istanbul Chamber of Commerce represent the exporters most exposed to CBAM (cement, steel, aluminium). A chamber-hosted Mizan instance lowers cost per member.
2. **Verifier partnership.** One accredited verification body using Mizan makes it the default evidence format for its clients.
3. **Importer pull.** EU importers can require Mizan certificates in supply contracts because checking them costs them nothing.
4. **Regulator alignment.** Map the certificate data model to the CBAM Registry's installation and emissions fields and to the Turkish ETS MRV templates; offer the carbon-price allocation contract as a public good.

## 4. Scalability

| Dimension | Today | Production path |
|---|---|---|
| Meters | 11 meters, 15-minute intervals | 50 meters per plant × 1,000 plants = 4.8 M readings/day. Signature verification ~1 ms per reading on one core; ingestion is stateless per device and shards by facility |
| Storage | SQLite (WAL) | PostgreSQL with partitioning by facility and month; object storage for raw signed payloads |
| Chain cost | 1 transaction per plant per 6 hours (~1,460/year/plant) | On Polygon PoS or an L2 a window anchor costs well under one cent; batching several plants' roots into one tx cuts it further |
| AI | Per-plant isolation forest in-process | Same model family, trained per plant in a worker pool; drift monitoring per sector |
| Interop | EVM, ERC-721 | Same contracts on any EVM chain; roots can be dual-anchored to a public chain and a permissioned consortium chain run by chambers and verifiers |

## 5. Sustainability of the system itself
- Proof-of-stake chains only; anchoring frequency is fixed by windows, not by readings, so chain footprint does not grow with meter count.
- 1,460 anchor transactions per plant per year on a PoS chain is negligible next to the tonnes of CO₂ under management.

## 6. Roadmap

| Horizon | Item |
|---|---|
| 0–3 months | External smart-contract audit; Foundry invariant tests; OIDC login; wallet signing for verifiers and importers; PostgreSQL |
| 3–6 months | OPC UA / Modbus gateway with TPM-held ML-DSA keys; CBAM Registry XML export; precursor emissions for complex goods (steel products) |
| 6–12 months | Salted commitments for confidential totals; ML-DSA account abstraction for PQ-secure transactions; fertiliser and hydrogen sectors |
| 12+ months | Mutual recognition: link TR-ETS allowance surrender records directly; extend to other CBAM-exposed exporters (Ukraine, India, Egypt, Morocco) |
