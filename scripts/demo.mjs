#!/usr/bin/env node
/**
 * One command to run the whole Mizan stack locally:
 *   1. local EVM chain (Hardhat node)        logs -> .demo-logs/chain.log
 *   2. deploy MizanRegistry, MRVLedger, EmissionsCertificate
 *   3. API (Fastify + SQLite)                 http://127.0.0.1:8787
 *   4. meter fleet backfills signed history (ML-DSA-44), integrity engine scores it, windows are anchored
 *   5. seed walks the history through verifier, ETS authority, operator and importer workflows
 *   6. live meters + web app                  http://127.0.0.1:5173
 *
 * Flags: --keep (reuse the existing database; only valid if the chain is still running)
 *        --fast (5 days of history instead of 10)
 */
import { spawn, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOGS = path.join(ROOT, ".demo-logs");
const args = new Set(process.argv.slice(2));
const isWin = process.platform === "win32";
fs.mkdirSync(LOGS, { recursive: true });

const C = { dim: "\x1b[2m", reset: "\x1b[0m", bold: "\x1b[1m", red: "\x1b[31m", green: "\x1b[32m" };
const COLORS = { chain: "\x1b[90m", api: "\x1b[34m", meters: "\x1b[33m", seed: "\x1b[35m", web: "\x1b[36m", deploy: "\x1b[32m", demo: "\x1b[1m" };
const say = (name, line) => process.stdout.write(`${COLORS[name] ?? ""}${name.padEnd(6)}${C.reset} ${line}\n`);

const children = [];
function launch(name, cmd, cmdArgs, { logFile, env } = {}) {
  const child = spawn(cmd, cmdArgs, { cwd: ROOT, shell: isWin, env: { ...process.env, FORCE_COLOR: "0", ...env } });
  children.push(child);
  const sink = logFile ? fs.createWriteStream(path.join(LOGS, logFile)) : null;
  const pipe = (stream) => {
    let buf = "";
    stream.on("data", (d) => {
      if (sink) return sink.write(d);
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) say(name, l);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  return child;
}

const once = (name, cmd, cmdArgs, opts) =>
  new Promise((resolve, reject) => {
    const child = launch(name, cmd, cmdArgs, opts);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${name} exited with code ${code}`))));
  });

async function waitFor(label, check, timeoutMs = 120_000) {
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

const rpcUp = async () => {
  const res = await fetch("http://127.0.0.1:8545", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  return res.ok;
};

function shutdown(code = 0) {
  for (const c of children) {
    if (c.exitCode !== null) continue;
    try {
      if (isWin) execSync(`taskkill /pid ${c.pid} /T /F`, { stdio: "ignore" });
      else c.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  const keep = args.has("--keep");
  const days = args.has("--fast") ? "5" : process.env.BACKFILL_DAYS ?? "10";

  if (await rpcUp().catch(() => false)) {
    say("demo", `${C.red}Port 8545 is already in use. Stop the other chain first (or run with --keep to reuse it).${C.reset}`);
    if (!keep) return shutdown(1);
  } else {
    say("demo", "starting local chain (logs in .demo-logs/chain.log)");
    launch("chain", "pnpm", ["--filter", "@mizan/contracts", "chain"], { logFile: "chain.log" });
    await waitFor("chain", rpcUp, 180_000);
  }

  if (!keep) {
    say("demo", "deploying contracts");
    await once("deploy", "pnpm", ["--filter", "@mizan/contracts", "deploy:local"]);
    fs.rmSync(path.join(ROOT, "apps/api/data"), { recursive: true, force: true });
    fs.rmSync(path.join(ROOT, "apps/simulator/.keys/state.json"), { force: true });
  }

  say("demo", "starting API");
  launch("api", "pnpm", ["--filter", "@mizan/api", "start"]);
  await waitFor("API", async () => (await fetch("http://127.0.0.1:8787/api/health")).ok);

  if (!keep) {
    say("demo", `backfilling ${days} days of signed meter history`);
    await once("meters", "pnpm", ["--filter", "@mizan/simulator", "backfill"], { env: { BACKFILL_DAYS: days } });
    say("demo", "walking history through verifier, authority, operator and importer workflows");
    await once("seed", "pnpm", ["--filter", "@mizan/simulator", "seed"]);
  }

  launch("meters", "pnpm", ["--filter", "@mizan/simulator", "start"]);
  if (!args.has("--no-web")) launch("web", "pnpm", ["--filter", "@mizan/web", "dev"], { logFile: "web.log" });
  await waitFor("web", async () => (await fetch("http://127.0.0.1:5173")).ok, 120_000).catch(() => undefined);

  process.stdout.write(
    `\n${C.bold}Mizan is running${C.reset}\n` +
      `  Web app          http://127.0.0.1:5173\n` +
      `  Public verifier  http://127.0.0.1:5173/verify\n` +
      `  API              http://127.0.0.1:8787/api/health\n` +
      `  Chain (RPC)      http://127.0.0.1:8545  chain id 31337\n` +
      `${C.dim}  Insider attack: in a second terminal run "pnpm tamper", then use the Audit page sweep.${C.reset}\n` +
      `${C.dim}  Ctrl+C stops everything.${C.reset}\n\n`,
  );
}

main().catch((e) => {
  say("demo", `${C.red}${e.message}${C.reset}`);
  shutdown(1);
});
