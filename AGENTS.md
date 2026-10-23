# AGENTS.md — working on Mizan

For AI coding agents and new contributors. Read this before changing code.

## Layout
| Path | What |
|---|---|
| `packages/contracts` | Solidity 0.8.24: `MizanRegistry`, `MRVLedger`, `EmissionsCertificate`. Hardhat 2.22 tests in `test/` |
| `packages/shared` | Canonical reading encoding, hashes, Merkle tree, ML-DSA-44, catalogue, emission factors, CBAM maths. Used by meters, API **and browser** |
| `apps/api` | Fastify 5 + `node:sqlite`. `ingest.ts` (gate), `integrity/` (AI), `batcher.ts` (seal + anchor), `services.ts` (workflows), `queries.ts` (reads), `chain.ts` |
| `apps/simulator` | Meter fleet (`main.ts backfill|live`), plant physics, `seed.ts` workflows |
| `apps/web` | React 18 + Vite. Pages in `src/pages`, charts hand-built in `src/components/charts.tsx` |
| `production/product-launch-film` | Film pipeline (Python + Playwright + FFmpeg) |

## Commands
`pnpm demo` (everything) · `pnpm --filter @mizan/contracts test` · `pnpm --filter @mizan/shared test` · `pnpm typecheck` · `pnpm tamper`

## Invariants — never break these
1. The canonical reading string (`packages/shared/src/reading.ts`) and `leafOf` must stay byte-identical across meter, API, browser and `MRVLedger.leafOf`. Changing them invalidates every signature and proof.
2. Signed values are integers (milli-units). No floats in signed payloads.
3. The smart contract is the authority for double counting. Never add an off-chain shortcut that skips the contract check (e.g. claims).
4. Windows are anchored in period order per facility; the contract rejects overlaps.
5. `node:sqlite` binds JS numbers as REAL: cast integer division in SQL (`CAST(x / ? AS INTEGER)`).
6. ethers `JsonRpcProvider` must keep `cacheTimeout: -1`, or back-to-back transactions reuse nonces.
7. Status colours (good/warning/serious/critical) are for state only and always ship with an icon and a label.

## Conventions
TypeScript strict, ESM. Integers for kg and euro cents on-chain. Explanations for every AI finding are user-facing copy: plain language, include the numbers. Run contract tests and typecheck before committing.
