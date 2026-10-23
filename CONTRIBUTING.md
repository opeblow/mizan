# Contributing to Mizan

Thank you for helping make emissions data verifiable. This guide explains how to propose changes and what we expect from every contribution.

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md). Security issues must **not** be reported in public issues; see [SECURITY.md](SECURITY.md).

## Table of contents
- [Ways to contribute](#ways-to-contribute)
- [Development setup](#development-setup)
- [Branching and commits](#branching-and-commits)
- [Pull requests](#pull-requests)
- [Quality bar](#quality-bar)
- [Protocol invariants](#protocol-invariants)
- [Style guide](#style-guide)
- [Documentation](#documentation)

## Ways to contribute
- **Report a bug** with the bug report template. Include steps to reproduce, expected and actual behaviour, and logs.
- **Propose a feature** with the feature request template. Explain the user problem first, then the proposal.
- **Improve documentation**: typos, clarity, diagrams and examples are always welcome.
- **Write code**: pick an issue labelled `good first issue` or `help wanted`, and comment that you are taking it.

## Development setup
Requirements: Node.js 22.13+, pnpm 9+, Git.

```bash
git clone https://github.com/opeblow/mizan.git
cd mizan
pnpm install
pnpm demo
```

Full instructions, environment variables and troubleshooting: [docs/SETUP.md](docs/SETUP.md). Code layout and conventions for humans and coding agents: [AGENTS.md](AGENTS.md).

## Branching and commits
- Branch from `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`, `chore/<short-name>`.
- Write commit messages in the imperative mood, one logical change per commit: `Add replay window to ingestion gate`, not `fixed stuff`.
- Reference issues in the body: `Fixes #42`.
- Never commit secrets, private keys, `.env` files, local databases or meter key files. The `.gitignore` covers these; do not override it.

## Pull requests
1. Keep pull requests focused. Large changes should start as an issue or design note.
2. Fill in the pull request template, including how you tested.
3. All CI checks must pass: contract tests, shared library tests, typecheck and web build.
4. At least one maintainer review is required. Changes to `packages/contracts` or `packages/shared/src/{reading,merkle,pq}.ts` require a second reviewer.
5. Squash or rebase onto `main`; no merge commits.

## Quality bar
Run these before opening a pull request:

```bash
pnpm --filter @mizan/contracts test   # smart-contract tests
pnpm --filter @mizan/shared test      # crypto, Merkle and CBAM maths tests
pnpm typecheck                        # TypeScript across all packages
pnpm --filter @mizan/web build        # production web build
```

- New contract behaviour needs a Hardhat test, including the failure path (custom error).
- New detectors in the integrity engine need a plain-language explanation and evidence fields; a finding a verifier cannot understand is a bug.
- UI changes must work in light and dark themes, at 375 px width, and must not use status colours (good, warning, serious, critical) for anything other than state.

## Protocol invariants
These protect every signature and proof ever produced. A pull request that breaks one will not be merged:
1. The canonical reading encoding and the Merkle leaf format must stay byte-identical across meters, API, browser and `MRVLedger.leafOf`.
2. Signed payloads contain integers only.
3. The smart contracts are the authority for double counting; no off-chain shortcut may skip a contract check.
4. Reporting windows are anchored in period order per facility and never overlap.

## Style guide
- TypeScript strict mode, ES modules, no `any` in new public APIs.
- Solidity: 0.8.24, custom errors, integer units (kg, euro cents, basis points), NatSpec on public functions.
- Comments explain *why*, not *what*. User-facing copy is plain English and includes the numbers behind a claim.
- Prefer small, pure functions. Keep shared logic in `packages/shared` so meters, server and browser compute the same results.

## Documentation
Update the relevant document in the same pull request:
- behaviour or API: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- threat model or controls: [docs/SECURITY_ASSESSMENT.md](docs/SECURITY_ASSESSMENT.md)
- setup or configuration: [docs/SETUP.md](docs/SETUP.md)
- notable changes: [CHANGELOG.md](CHANGELOG.md)
