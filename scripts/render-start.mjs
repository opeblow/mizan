#!/usr/bin/env node
/**
 * Start command for hosting the backend on Render (or any single Linux container).
 * Runs the same stack as `pnpm demo`, without the web app:
 *   1. local Hardhat chain on 127.0.0.1:8545 (private to the container)
 *   2. deploy the contracts
 *   3. API on $PORT (public)
 *   4. backfill signed meter history, seed workflows, then keep meters running live
 *
 * The chain lives in memory, so every restart starts from a fresh, re-seeded demo.
 * Browsers read the chain through the API's read-only /api/rpc proxy (RPC_PROXY=true).
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT ?? process.env.API_PORT ?? "8787";
const API_URL = `http://127.0.0.1:${PORT}`;
const DAYS = process.env.BACKFILL_DAYS ?? "5";

const env = {
  ...process.env,
  FORCE_COLOR: "0",
  API_HOST: process.env.API_HOST ?? "0.0.0.0",
  API_URL,
  RPC_URL: "http://127.0.0.1:8545",
  CHAIN_ID: "31337",
  RPC_PROXY: process.env.RPC_PROXY ?? "true",
};

const children = [];
const log = (msg) => console.log(`[render] ${msg}`);

/** Runs a package's local binary directly (no pnpm wrapper, to save memory). */
function run(name, pkgDir, bin, args, extraEnv = {}) {
  const cwd = path.join(ROOT, pkgDir);
  const child = spawn(bin, args, { cwd, env: { ...env, ...extraEnv }, stdio: ["ignore", "inherit", "inherit"] });
  children.push(child);
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) log(`${name} exited with code ${code}`);
  });
  return child;
}
const tsx = (pkgDir, file, args = [], extraEnv) => run(file, pkgDir, process.execPath, ["--import", "tsx", file, ...args], extraEnv);
const done = (child, name) =>
  new Promise((resolve, reject) => child.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`${name} failed (exit ${c})`)))));

async function waitFor(label, check, timeoutMs = 180_000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`${label} did not come up within ${timeoutMs / 1000}s`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function shutdown(code) {
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  const hardhatCli = path.join(ROOT, "packages/contracts/node_modules/hardhat/internal/cli/cli.js");
  const hardhat = (name, args) => run(name, "packages/contracts", process.execPath, [hardhatCli, ...args]);

  log("starting local chain");
  const chain = hardhat("chain", ["node", "--hostname", "127.0.0.1"]);
  chain.on("exit", () => {
    log("chain stopped, exiting so Render restarts the service");
    shutdown(1);
  });
  await waitFor("chain", async () => {
    const res = await fetch(env.RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return res.ok;
  });

  log("deploying contracts");
  await done(hardhat("deploy", ["run", "scripts/deploy.ts", "--network", "localhost"]), "deploy");
  fs.rmSync(path.join(ROOT, "apps/api/data"), { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, "apps/simulator/.keys/state.json"), { force: true });

  log(`starting API on port ${PORT}`);
  const api = tsx("apps/api", "src/server.ts");
  api.on("exit", () => {
    log("API stopped, exiting so Render restarts the service");
    shutdown(1);
  });
  await waitFor("API", async () => (await fetch(`${API_URL}/api/health`)).ok);

  log(`backfilling ${DAYS} days of signed meter history (this takes a few minutes)`);
  await done(tsx("apps/simulator", "src/main.ts", ["backfill"], { BACKFILL_DAYS: DAYS }), "backfill");
  log("seeding verifier, authority, operator and importer workflows");
  await done(tsx("apps/simulator", "src/seed.ts"), "seed");

  log("starting live meters");
  tsx("apps/simulator", "src/main.ts", ["live"]);
  log("Mizan backend is up");
}

main().catch((e) => {
  log(e.message);
  shutdown(1);
});
