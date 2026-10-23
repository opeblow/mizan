# Mizan — Balance, proven.

**Emissions data an EU customs officer can check without trusting anyone.**

Since 1 January 2026, every tonne of cement, steel and aluminium entering the EU carries a carbon price under CBAM. Türkiye supplies close to a third of the EU's imported cement. Exporters who cannot prove their real emissions pay on punitive default values, and carbon already paid at home can be claimed twice. Mizan (Turkish for *balance*) turns factory meters into evidence anyone can verify and no one can quietly change.

**Track:** Carbon Markets & Emissions Transparency · IEEE ClimateChain Global Hackathon 2026

🎬 **Demo film:** [`production/product-launch-film/mizan-launch-film.mp4`](production/product-launch-film/mizan-launch-film.mp4) (4:06)

## How it works
| Step | What happens | Tech |
|---|---|---|
| **01 Measure** | Every meter signs each 15-minute reading at the source | **ML-DSA-44 (NIST FIPS 204), post-quantum** |
| **02 Detect** | Five detectors score every interval and explain findings in plain language; a verifier's decision retrains the model | Physics envelopes, mass balance, robust z-scores, **isolation forest (own implementation)**, frozen-sensor check |
| **03 Anchor** | 6-hour windows sealed into Merkle trees, anchored with emissions and AI risk; verifier attests on-chain | `MRVLedger` — overlapping windows impossible |
| **04 Certify** | One ERC-721 certificate per shipment; the contract computes embedded emissions itself | `EmissionsCertificate` — each tonne, each paid carbon price and each CBAM deduction usable **once** |
| **05 Verify** | Anyone checks signatures and proofs in their own browser, straight from the chain | Public verifier, no login |
| **06 Plan** | CBAM cost 2026–2034 and decarbonisation levers from verified data | Exposure planner |

## Verified end to end
- 13/13 smart-contract tests, 6/6 crypto & maths tests, all packages typecheck.
- Full run: 10,560 PQ-signed readings, 120+ windows anchored on-chain, verifier decisions, carbon price recorded, certificates minted and claimed.
- Live grid-meter tampering caught within one interval (physics detector, 0.297 vs 0.330 kWh/kg floor).
- Forged signature and replayed message rejected at the gate.
- Second CBAM deduction claim refused by the contract (`AlreadyClaimed`).
- A database edit by an insider fails public verification (signature, Merkle and on-chain proof).

## Run it
```bash
pnpm install
pnpm demo        # chain + contracts + API + signed history + live meters + web
```
Open http://127.0.0.1:5173. Full instructions: [SETUP.md](SETUP.md).

## Docs
[PLAN.md](PLAN.md) strategy & judging map · [SETUP.md](SETUP.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/SECURITY.md](docs/SECURITY.md) security & data-integrity assessment · [docs/ADOPTION.md](docs/ADOPTION.md) adoption & scalability

All companies shown are fictional; process data follow published sector intensities. MIT licence.
