# Setup

Everything you need to run Mizan locally, run the tests, deploy the contracts to a public testnet and record the demo. Tested on Windows 11 with Node 24 and pnpm 11; works the same on macOS and Linux (see §1.3).

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | 22.13 or newer (uses the built-in `node:sqlite`) | `node --version` |
| pnpm | 9 or newer | `pnpm --version` (install: `npm i -g pnpm`) |
| Git | any | `git --version` |
| A browser | Chrome, Edge, Firefox or Safari | |

No database server, no Docker, no API keys are needed for the local demo.

### 1.1 Install
```bash
git clone <your-repo-url> mizan
cd mizan
pnpm install
```
First install downloads Hardhat's engine (~25 MB) and, on first compile, the Solidity 0.8.24 compiler (~8 MB).

### 1.2 Optional settings
Copy `.env.example` to `.env` only if you want to change ports, keys or point at a testnet. Defaults work out of the box.

### 1.3 macOS / Linux
`pnpm-workspace.yaml` removes Hardhat's engine binaries for every OS except Windows, to keep installs small on slow connections. **Delete the `overrides:` line for your platform** (for example `@nomicfoundation/edr-darwin-arm64` on Apple Silicon, `@nomicfoundation/edr-linux-x64-gnu` on most Linux) and run `pnpm install` again.

## 2. Run the whole thing (one command)
```bash
pnpm demo
```
What happens, in order (about 3–4 minutes the first time):
1. A local EVM chain starts on `127.0.0.1:8545` (Hardhat node, chain id 31337). Logs: `.demo-logs/chain.log`.
2. `MizanRegistry`, `MRVLedger` and `EmissionsCertificate` are deployed; roles are granted.
3. The API starts on `127.0.0.1:8787` with a fresh SQLite database (`apps/api/data/`).
4. Eleven simulated meters on three plants generate keys, enrol on-chain, and sign 10 days of 15-minute history with ML-DSA-44, including six attack and fault episodes. The integrity engine scores every interval; every 6-hour window is sealed and anchored.
5. A seed script plays the other roles: the verifier reviews old incidents and attests windows, the ETS authority records carbon price paid, the operator issues three certificates, an importer claims one.
6. Meters go live: the last 3 days replay at 450× speed (one 15-minute interval every 2 s), then real time. The web app starts.

Open **http://127.0.0.1:5173** and pick a role. `Ctrl+C` stops everything.

Flags: `pnpm demo --fast` (5 days of history), `pnpm demo --no-web`, `pnpm demo --keep` (reuse a running chain and the existing database).

### 2.1 A five-minute tour
1. **Elif Demir (operator)** → Overview → open *Anadolu EAF Steel*. Note the intensity chart and its physical floor.
2. Sidebar → **Attack simulator** → *Tamper EAF grid meter*. Within one interval a critical toast appears and the line drops below the floor.
3. Sign out (sidebar icon) → **Kerem Aydın (verifier)** → Integrity → open the new incident and read the explanation → Confirm. MRV ledger → *Needs review* → open the window → Reject.
4. **Elif** → Certificates → mint a shipment certificate.
5. **Hanna Weber (importer)** → open it → Claim deduction → then *Try to claim again*: the smart contract refuses.
6. **Public verifier** (no login): `/verify/certificate/1`. Everything is checked in your browser against the chain.
7. In a second terminal: `pnpm tamper`. Open the printed `/verify/reading/<id>` link: verification fails. Audit trail → *Run full integrity sweep* shows the broken window.
8. **CBAM exposure**: move the levers.

## 3. Run parts separately
```bash
pnpm chain              # terminal 1: local chain
pnpm deploy:local       # terminal 2: deploy contracts (writes packages/contracts/deployments/31337.json)
pnpm api                # terminal 2: API with auto-reload
pnpm --filter @mizan/simulator backfill   # terminal 3: history
pnpm --filter @mizan/simulator seed       #            workflows
pnpm simulate           # terminal 3: live meters
pnpm web                # terminal 4: web app
```
If you restart the chain you must redeploy and delete `apps/api/data/` and `apps/simulator/.keys/state.json` (the database refers to the old chain). `pnpm demo` does all of this for you.

## 4. Tests and checks
```bash
pnpm --filter @mizan/contracts test    # 13 Hardhat tests: registry, ledger, certificates, double counting
pnpm --filter @mizan/shared test       # ML-DSA, Merkle, canonical encoding, emissions, CBAM maths
pnpm typecheck                         # TypeScript across all packages
pnpm --filter @mizan/simulator bench   # ML-DSA-44 speed on your machine
REPORT_GAS=true pnpm --filter @mizan/contracts test   # gas report
```

## 5. Deploy the contracts to a public testnet (optional, recommended for judging)
Polygon Amoy (chain 80002) is cheap and fast.
1. Create a fresh wallet (never reuse a personal key). Get test POL from a faucet (search "Polygon Amoy faucet").
2. In `.env`:
   ```
   DEPLOYER_PRIVATE_KEY=0x...
   AMOY_RPC_URL=https://rpc-amoy.polygon.technology
   ```
3. `pnpm --filter @mizan/contracts deploy:amoy` → writes `packages/contracts/deployments/80002.json`, and grants every role to the deployer by default (set `ORACLE_ADDRESS`, `VERIFIER_ADDRESS`, `AUTHORITY_ADDRESS` to separate them).
4. Point the API at it in `.env`:
   ```
   RPC_URL=https://rpc-amoy.polygon.technology
   CHAIN_ID=80002
   EXPLORER_URL=https://amoy.polygonscan.com
   ORACLE_PRIVATE_KEY=0x...      # same key as the deployer unless you separated roles
   VERIFIER_PRIVATE_KEY=0x...
   AUTHORITY_PRIVATE_KEY=0x...
   IMPORTER_A_PRIVATE_KEY=0x...  # any funded test wallets
   IMPORTER_B_PRIVATE_KEY=0x...
   ```
5. Start the API, then the simulator with `REPLAY_DAYS=0 BACKFILL_DAYS=1` to keep transaction count low (one anchor per plant per 6 hours of data). Put the contract addresses and explorer links in the README.

## 6. Environment variables
| Variable | Default | Purpose |
|---|---|---|
| `API_PORT`, `API_HOST` | 8787, 127.0.0.1 | API bind |
| `RPC_URL`, `CHAIN_ID` | http://127.0.0.1:8545, 31337 | Chain the API writes to |
| `PUBLIC_RPC_URL` | = RPC_URL | RPC the browser verifier reads from |
| `EXPLORER_URL` | empty | Adds explorer links to tx hashes |
| `MNEMONIC` | Hardhat test mnemonic | Role wallets on a local chain |
| `*_PRIVATE_KEY` | unset | Role wallets on a public chain |
| `DEVICE_ENROLL_TOKEN` | mizan-dev-enroll-token | Shared secret for meter enrolment |
| `SESSION_SECRET` | dev value | HMAC key for session tokens. **Change it** outside a demo |
| `DEMO_MODE` | true | Password-less role login and the attack simulator |
| `WINDOW_SECONDS`, `INTERVAL_SECONDS` | 21600, 900 | Reporting window and metering interval |
| `BACKFILL_DAYS`, `REPLAY_DAYS`, `SIM_SPEED` | 10, 3, 450 | Simulator history and speed |

## 7. Troubleshooting
| Symptom | Fix |
|---|---|
| `Port 8545 is already in use` | Another chain is running. Stop it, or `pnpm demo --keep` |
| Banner "Not connected to the chain" | The chain restarted under a running API. Run `pnpm demo` again |
| `Enrollment ... different key` | Old keys with a new chain and old database: delete `apps/api/data/` |
| Web shows "API not reachable" | API not running on 8787; check the `api` lines in the terminal |
| Slow `pnpm install` | Large binaries; the workspace already limits them to your OS. Retry; downloads resume from the pnpm store |
| Public verifier can't reach the chain | It reads `PUBLIC_RPC_URL` directly from the browser; it must be reachable from the browser's machine |

