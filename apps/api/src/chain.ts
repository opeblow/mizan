import * as fs from "node:fs";
import { Contract, HDNodeWallet, JsonRpcProvider, Wallet, type InterfaceAbi, type TransactionReceipt, type Log } from "ethers";
import { config, deploymentFile } from "./config";

export interface Deployment {
  network: string;
  chainId: number;
  deployedAt: string;
  deployBlock: number;
  roles: Record<string, string>;
  contracts: Record<"MizanRegistry" | "MRVLedger" | "EmissionsCertificate", { address: string; abi: InterfaceAbi }>;
}

export type Role = "oracle" | "verifier" | "authority" | "importerA" | "importerB";
const HD_INDEX: Record<Role, number> = { authority: 0, oracle: 1, verifier: 2, importerA: 3, importerB: 4 };

export class ChainError extends Error {
  constructor(
    message: string,
    readonly revert?: { name: string; args: unknown[] },
  ) {
    super(message);
  }
}

/** Serialises transactions per wallet so nonces never collide. */
class TxQueue {
  private tail: Promise<unknown> = Promise.resolve();
  push<T>(job: () => Promise<T>): Promise<T> {
    const next = this.tail.then(job, job);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

class Chain {
  provider: JsonRpcProvider;
  deployment: Deployment | null = null;
  wallets = {} as Record<Role, Wallet | HDNodeWallet>;
  queues = {} as Record<Role, TxQueue>;
  registry!: Contract;
  ledger!: Contract;
  certificate!: Contract;
  ready = false;
  lastError: string | null = null;

  constructor() {
    this.provider = new JsonRpcProvider(config.rpcUrl, config.chainId, {
      staticNetwork: true,
      pollingInterval: 1000,
      // ethers caches identical RPC calls for 250 ms by default, which hands back a stale nonce
      // when two transactions from one wallet are sent within that window
      cacheTimeout: -1,
    });
    for (const role of Object.keys(HD_INDEX) as Role[]) {
      const key = config.keys[role];
      const w = key
        ? new Wallet(key, this.provider)
        : HDNodeWallet.fromPhrase(config.mnemonic, undefined, `m/44'/60'/0'/0/${HD_INDEX[role]}`).connect(this.provider);
      this.wallets[role] = w;
      this.queues[role] = new TxQueue();
    }
  }

  /** Loads the deployment file and checks the contracts really exist on the RPC (catches a restarted dev chain). */
  async init(): Promise<boolean> {
    const file = deploymentFile();
    if (!fs.existsSync(file)) {
      this.lastError = `No deployment found at ${file}. Run "pnpm deploy:local".`;
      this.ready = false;
      return false;
    }
    try {
      const dep = JSON.parse(fs.readFileSync(file, "utf8")) as Deployment;
      const code = await this.provider.getCode(dep.contracts.MRVLedger.address);
      if (code === "0x") {
        this.lastError = "Contracts not found on the chain. The local chain was probably restarted: run \"pnpm demo\" again.";
        this.ready = false;
        return false;
      }
      this.deployment = dep;
      this.registry = new Contract(dep.contracts.MizanRegistry.address, dep.contracts.MizanRegistry.abi, this.provider);
      this.ledger = new Contract(dep.contracts.MRVLedger.address, dep.contracts.MRVLedger.abi, this.provider);
      this.certificate = new Contract(dep.contracts.EmissionsCertificate.address, dep.contracts.EmissionsCertificate.abi, this.provider);
      this.ready = true;
      this.lastError = null;
      return true;
    } catch (e) {
      this.lastError = `Chain unreachable at ${config.rpcUrl}: ${(e as Error).message}`;
      this.ready = false;
      return false;
    }
  }

  address(role: Role) {
    return this.wallets[role].address;
  }

  private decode(e: unknown): ChainError {
    const err = e as { revert?: { name: string; args: unknown[] }; data?: string; info?: { error?: { data?: string } }; shortMessage?: string; message?: string };
    if (err.revert) return new ChainError(`${err.revert.name}(${err.revert.args.map(String).join(", ")})`, err.revert);
    const data = err.data ?? err.info?.error?.data;
    if (typeof data === "string" && data.length >= 10) {
      for (const c of [this.ledger, this.certificate, this.registry]) {
        try {
          const parsed = c.interface.parseError(data);
          if (parsed) return new ChainError(`${parsed.name}(${parsed.args.map(String).join(", ")})`, { name: parsed.name, args: [...parsed.args] });
        } catch {
          /* try next */
        }
      }
    }
    return new ChainError(err.shortMessage ?? err.message ?? String(e));
  }

  /** Sends a contract call from a role wallet, waits for one confirmation and returns the receipt. */
  async send(role: Role, contract: Contract, method: string, args: unknown[]): Promise<TransactionReceipt> {
    if (!this.ready) throw new ChainError(this.lastError ?? "chain not ready");
    return this.queues[role].push(async () => {
      const c = contract.connect(this.wallets[role]) as Contract;
      try {
        const txr = await c.getFunction(method).send(...args);
        const receipt = await txr.wait(1);
        if (!receipt || receipt.status !== 1) throw new ChainError(`transaction ${txr.hash} failed`);
        return receipt;
      } catch (e) {
        if (e instanceof ChainError) throw e;
        throw this.decode(e);
      }
    });
  }

  /** Dry-runs a call to surface the revert reason without spending gas. */
  async simulate(role: Role, contract: Contract, method: string, args: unknown[]): Promise<void> {
    const c = contract.connect(this.wallets[role]) as Contract;
    try {
      await c.getFunction(method).staticCall(...args);
    } catch (e) {
      throw this.decode(e);
    }
  }

  parseLogs(receipt: TransactionReceipt, contract: Contract, eventName: string) {
    return receipt.logs
      .filter((l: Log) => l.address.toLowerCase() === (contract.target as string).toLowerCase())
      .map((l: Log) => {
        try {
          return contract.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .filter((p) => p && p.name === eventName);
  }

  async status() {
    try {
      const block = await this.provider.getBlockNumber();
      return { connected: true, ready: this.ready, block, chainId: config.chainId, error: this.lastError };
    } catch (e) {
      return { connected: false, ready: false, block: null, chainId: config.chainId, error: (e as Error).message };
    }
  }

  explorerTx(hash: string | null | undefined) {
    return hash && config.explorerUrl ? `${config.explorerUrl.replace(/\/$/, "")}/tx/${hash}` : null;
  }
}

export const chain = new Chain();
