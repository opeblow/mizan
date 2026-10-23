import { ethers, network, artifacts } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys the three Mizan contracts, wires roles and writes deployments/<chainId>.json, which the API reads.
 *
 * Role holders (override with env vars on public networks):
 *   ORACLE_ADDRESS    Mizan platform signer: anchors windows, issues certificates
 *   VERIFIER_ADDRESS  accredited verification body
 *   AUTHORITY_ADDRESS registry of carbon price paid at origin (e.g. the national ETS authority)
 * On localhost they default to Hardhat accounts #1, #2 and #0.
 */
async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const isLocal = network.name === "localhost" || network.name === "hardhat";
  const pick = (env: string | undefined, localIndex: number) =>
    env || (isLocal ? signers[localIndex].address : deployer.address);

  const oracle = pick(process.env.ORACLE_ADDRESS, 1);
  const verifier = pick(process.env.VERIFIER_ADDRESS, 2);
  const authority = pick(process.env.AUTHORITY_ADDRESS, 0);
  const { chainId } = await ethers.provider.getNetwork();

  console.log(`Deploying Mizan to ${network.name} (chain ${chainId}) from ${deployer.address}`);

  const registry = await ethers.deployContract("MizanRegistry", [deployer.address]);
  await registry.waitForDeployment();
  const ledger = await ethers.deployContract("MRVLedger", [deployer.address, await registry.getAddress()]);
  await ledger.waitForDeployment();
  const cert = await ethers.deployContract("EmissionsCertificate", [
    deployer.address,
    await registry.getAddress(),
    await ledger.getAddress(),
  ]);
  await cert.waitForDeployment();

  const grant = async (label: string, tx: Promise<{ wait: () => Promise<unknown> }>) => {
    await (await tx).wait();
    console.log(`  granted ${label}`);
  };
  await grant("registry REGISTRAR -> oracle", registry.grantRole(await registry.REGISTRAR_ROLE(), oracle));
  await grant("ledger ORACLE -> oracle", ledger.grantRole(await ledger.ORACLE_ROLE(), oracle));
  await grant("ledger VERIFIER -> verifier", ledger.grantRole(await ledger.VERIFIER_ROLE(), verifier));
  await grant("ledger CERTIFIER -> certificate contract", ledger.grantRole(await ledger.CERTIFIER_ROLE(), await cert.getAddress()));
  await grant("certificate ISSUER -> oracle", cert.grantRole(await cert.ISSUER_ROLE(), oracle));
  await grant("certificate AUTHORITY -> authority", cert.grantRole(await cert.AUTHORITY_ROLE(), authority));

  const abi = async (name: string) => (await artifacts.readArtifact(name)).abi;
  const out = {
    network: network.name,
    chainId: Number(chainId),
    deployedAt: new Date().toISOString(),
    deployBlock: await ethers.provider.getBlockNumber(),
    roles: { admin: deployer.address, oracle, verifier, authority },
    contracts: {
      MizanRegistry: { address: await registry.getAddress(), abi: await abi("MizanRegistry") },
      MRVLedger: { address: await ledger.getAddress(), abi: await abi("MRVLedger") },
      EmissionsCertificate: { address: await cert.getAddress(), abi: await abi("EmissionsCertificate") },
    },
  };
  const dir = path.resolve(__dirname, "../deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${chainId}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`MizanRegistry        ${out.contracts.MizanRegistry.address}`);
  console.log(`MRVLedger            ${out.contracts.MRVLedger.address}`);
  console.log(`EmissionsCertificate ${out.contracts.EmissionsCertificate.address}`);
  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
