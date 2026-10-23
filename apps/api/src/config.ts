import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
export const API_ROOT = path.resolve(here, "..");
export const REPO_ROOT = path.resolve(API_ROOT, "../..");
loadEnv({ path: path.join(REPO_ROOT, ".env") });

const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));

/** Hardhat's public development mnemonic. Never used outside a local chain. */
const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";

export const config = {
  port: num(process.env.API_PORT, 8787),
  host: process.env.API_HOST ?? "127.0.0.1",
  dataDir: path.resolve(REPO_ROOT, process.env.DATA_DIR ?? "apps/api/data"),
  rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
  /** RPC the browser should use for independent verification (may differ from the server's). */
  publicRpcUrl: process.env.PUBLIC_RPC_URL ?? process.env.RPC_URL ?? "http://127.0.0.1:8545",
  chainId: num(process.env.CHAIN_ID, 31337),
  explorerUrl: process.env.EXPLORER_URL ?? "",
  mnemonic: process.env.MNEMONIC ?? HARDHAT_MNEMONIC,
  keys: {
    oracle: process.env.ORACLE_PRIVATE_KEY,
    verifier: process.env.VERIFIER_PRIVATE_KEY,
    authority: process.env.AUTHORITY_PRIVATE_KEY,
    importerA: process.env.IMPORTER_A_PRIVATE_KEY,
    importerB: process.env.IMPORTER_B_PRIVATE_KEY,
  },
  sessionSecret: process.env.SESSION_SECRET ?? "mizan-dev-session-secret-change-me",
  enrollToken: process.env.DEVICE_ENROLL_TOKEN ?? "mizan-dev-enroll-token",
  simulatorControlUrl: process.env.SIMULATOR_CONTROL_URL ?? "http://127.0.0.1:8799",
  /** Reporting window anchored on-chain, seconds. */
  windowSeconds: num(process.env.WINDOW_SECONDS, 6 * 3600),
  /** Metering interval, seconds. */
  intervalSeconds: num(process.env.INTERVAL_SECONDS, 15 * 60),
  /** Share of each facility's output shipped to the EU, used for CBAM exposure. */
  euExportShare: { "TR-CEM-01": 0.38, "TR-STL-01": 0.45, "TR-ALU-01": 0.62 } as Record<string, number>,
  demoMode: (process.env.DEMO_MODE ?? "true") === "true",
};

export function deploymentFile(chainId = config.chainId): string {
  return path.join(REPO_ROOT, "packages/contracts/deployments", `${chainId}.json`);
}

export function ensureDataDir() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}
