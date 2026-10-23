import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const id = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(`mizan:id:${s}`));
const CEMENT = 0;
const STEEL = 1;
const PENDING = 1n;
const VERIFIED = 2n;
const REJECTED = 3n;

// Off-chain Merkle builder identical to packages/shared/src/merkle.ts
function leafOf(payloadHash: string, sigHash: string) {
  return ethers.keccak256(ethers.keccak256(ethers.concat([payloadHash, sigHash])));
}
function hashPair(a: string, b: string) {
  return BigInt(a) <= BigInt(b) ? ethers.keccak256(ethers.concat([a, b])) : ethers.keccak256(ethers.concat([b, a]));
}
function buildTree(leaves: string[]) {
  const layers = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const l = layers[layers.length - 1];
    const next: string[] = [];
    for (let i = 0; i < l.length; i += 2) next.push(i + 1 < l.length ? hashPair(l[i], l[i + 1]) : l[i]);
    layers.push(next);
  }
  const proof = (index: number) => {
    const p: string[] = [];
    let i = index;
    for (let k = 0; k < layers.length - 1; k++) {
      const s = i % 2 === 0 ? i + 1 : i - 1;
      if (s < layers[k].length) p.push(layers[k][s]);
      i = Math.floor(i / 2);
    }
    return p;
  };
  return { root: layers[layers.length - 1][0], proof };
}

describe("Mizan protocol", () => {
  async function deploy() {
    const [admin, oracle, verifier, importerA, importerB, stranger] = await ethers.getSigners();
    const registry = await ethers.deployContract("MizanRegistry", [admin.address]);
    const ledger = await ethers.deployContract("MRVLedger", [admin.address, await registry.getAddress()]);
    const cert = await ethers.deployContract("EmissionsCertificate", [
      admin.address,
      await registry.getAddress(),
      await ledger.getAddress(),
    ]);
    await ledger.grantRole(await ledger.ORACLE_ROLE(), oracle.address);
    await ledger.grantRole(await ledger.VERIFIER_ROLE(), verifier.address);
    await ledger.grantRole(await ledger.CERTIFIER_ROLE(), await cert.getAddress());
    await cert.grantRole(await cert.ISSUER_ROLE(), oracle.address);
    await cert.grantRole(await cert.AUTHORITY_ROLE(), admin.address);

    await registry.registerFacility(id("TR-CEM-01"), admin.address, 792, CEMENT, "Ege Clinker & Cement");
    await registry.registerFacility(id("TR-STL-01"), admin.address, 792, STEEL, "Anadolu EAF Steel");

    const leaves = Array.from({ length: 7 }, (_, i) =>
      leafOf(ethers.sha256(ethers.toUtf8Bytes(`payload-${i}`)), ethers.sha256(ethers.toUtf8Bytes(`sig-${i}`))),
    );
    const tree = buildTree(leaves);

    const anchor = (facility: string, start: number, end: number, opts: Partial<Record<string, bigint | number>> = {}) =>
      ledger.connect(oracle).anchorBatch({
        facilityId: id(facility),
        periodStart: start,
        periodEnd: end,
        merkleRoot: tree.root,
        readingCount: 7,
        directEmissionsKg: opts.direct ?? 600_000n,
        indirectEmissionsKg: opts.indirect ?? 40_000n,
        productionKg: opts.production ?? 1_000_000n,
        riskScoreBps: opts.risk ?? 1200,
        evidenceHash: ethers.ZeroHash,
      });

    return { registry, ledger, cert, admin, oracle, verifier, importerA, importerB, stranger, tree, anchor };
  }

  describe("MizanRegistry", () => {
    it("registers ML-DSA device keys and rejects duplicates", async () => {
      const { registry } = await loadFixture(deploy);
      const keyHash = ethers.keccak256("0x1234");
      await expect(registry.registerDevice(id("TR-CEM-01:GRID"), id("TR-CEM-01"), keyHash, 1))
        .to.emit(registry, "DeviceRegistered")
        .withArgs(id("TR-CEM-01:GRID"), id("TR-CEM-01"), keyHash, 1);
      await expect(registry.registerDevice(id("TR-CEM-01:GRID"), id("TR-CEM-01"), keyHash, 1)).to.be.revertedWithCustomError(
        registry,
        "DeviceExists",
      );
      const d = await registry.getDevice(id("TR-CEM-01:GRID"));
      expect(d.pubKeyHash).to.equal(keyHash);
      expect(d.active).to.equal(true);
    });

    it("rejects unsupported signature schemes and unknown facilities", async () => {
      const { registry } = await loadFixture(deploy);
      await expect(registry.registerDevice(id("X"), id("TR-CEM-01"), ethers.ZeroHash, 9)).to.be.revertedWithCustomError(
        registry,
        "UnsupportedScheme",
      );
      await expect(registry.registerDevice(id("X"), id("NOPE"), ethers.ZeroHash, 1)).to.be.revertedWithCustomError(
        registry,
        "UnknownFacility",
      );
    });

    it("revokes compromised keys and blocks non-registrars", async () => {
      const { registry, stranger } = await loadFixture(deploy);
      await registry.registerDevice(id("D1"), id("TR-CEM-01"), ethers.ZeroHash, 1);
      await registry.revokeDevice(id("D1"));
      expect((await registry.getDevice(id("D1"))).active).to.equal(false);
      await expect(
        registry.connect(stranger).registerFacility(id("EVIL"), stranger.address, 792, CEMENT, "x"),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("MRVLedger", () => {
    it("anchors a window and proves every reading inside it on-chain", async () => {
      const { ledger, anchor, tree } = await loadFixture(deploy);
      await expect(anchor("TR-CEM-01", 1000, 2000)).to.emit(ledger, "BatchAnchored");
      for (let i = 0; i < 7; i++) {
        const payload = ethers.sha256(ethers.toUtf8Bytes(`payload-${i}`));
        const sig = ethers.sha256(ethers.toUtf8Bytes(`sig-${i}`));
        expect(await ledger.verifyReading(1, payload, sig, tree.proof(i))).to.equal(true);
      }
    });

    it("detects a tampered reading", async () => {
      const { ledger, anchor, tree } = await loadFixture(deploy);
      await anchor("TR-CEM-01", 1000, 2000);
      const forged = ethers.sha256(ethers.toUtf8Bytes("payload-3-edited"));
      const sig = ethers.sha256(ethers.toUtf8Bytes("sig-3"));
      expect(await ledger.verifyReading(1, forged, sig, tree.proof(3))).to.equal(false);
    });

    it("refuses overlapping windows so emissions cannot be reported twice", async () => {
      const { ledger, anchor } = await loadFixture(deploy);
      await anchor("TR-CEM-01", 1000, 2000);
      await expect(anchor("TR-CEM-01", 1500, 2500)).to.be.revertedWithCustomError(ledger, "OverlappingPeriod");
      await expect(anchor("TR-CEM-01", 2000, 3000)).to.emit(ledger, "BatchAnchored");
      // other facilities keep their own timeline
      await expect(anchor("TR-STL-01", 1000, 2000)).to.emit(ledger, "BatchAnchored");
    });

    it("only the oracle anchors and only a verifier attests, exactly once", async () => {
      const { ledger, anchor, verifier, stranger } = await loadFixture(deploy);
      await anchor("TR-CEM-01", 1000, 2000);
      expect(await ledger.statusOf(1)).to.equal(PENDING);
      await expect(ledger.connect(stranger).attest(1, true, ethers.ZeroHash)).to.be.revertedWithCustomError(
        ledger,
        "AccessControlUnauthorizedAccount",
      );
      await expect(ledger.connect(verifier).attest(1, true, ethers.id("report")))
        .to.emit(ledger, "BatchAttested")
        .withArgs(1, verifier.address, true, ethers.id("report"));
      expect(await ledger.statusOf(1)).to.equal(VERIFIED);
      await expect(ledger.connect(verifier).attest(1, false, ethers.ZeroHash)).to.be.revertedWithCustomError(
        ledger,
        "NotPending",
      );
    });

    it("rejects risk scores above 100%", async () => {
      const { ledger, anchor } = await loadFixture(deploy);
      await expect(anchor("TR-CEM-01", 1, 2, { risk: 10_001 })).to.be.revertedWithCustomError(ledger, "RiskOutOfRange");
    });
  });

  describe("EmissionsCertificate", () => {
    async function verifiedWindows() {
      const f = await loadFixture(deploy);
      await f.anchor("TR-CEM-01", 1000, 2000); // batch 1: 600 t direct, 40 t indirect, 1000 t cement
      await f.anchor("TR-STL-01", 1000, 2000, { direct: 90_000n, indirect: 185_000n, production: 1_000_000n }); // batch 2
      await f.anchor("TR-CEM-01", 2000, 3000); // batch 3, will be rejected
      await f.ledger.connect(f.verifier).attest(1, true, ethers.ZeroHash);
      await f.ledger.connect(f.verifier).attest(2, true, ethers.ZeroHash);
      await f.ledger.connect(f.verifier).attest(3, false, ethers.ZeroHash);
      return f;
    }

    const issueInput = (facility: string, ship: string, allocations: { batchId: number; productionKg: bigint }[]) => ({
      facilityId: id(facility),
      cnCode: 25232900,
      shipmentRef: ethers.id(ship),
      allocations,
    });

    it("computes embedded emissions on-chain, counting indirect emissions for cement only", async () => {
      const { cert, oracle, importerA } = await verifiedWindows();
      await cert.connect(oracle).issue(importerA.address, issueInput("TR-CEM-01", "S1", [{ batchId: 1, productionKg: 250_000n }]));
      const c1 = await cert.getCertificate(1);
      expect(c1.quantityKg).to.equal(250_000n);
      expect(c1.embeddedEmissionsKg).to.equal(160_000n); // (600 + 40) t * 25%

      await cert.connect(oracle).issue(importerA.address, issueInput("TR-STL-01", "S2", [{ batchId: 2, productionKg: 500_000n }]));
      const c2 = await cert.getCertificate(2);
      expect(c2.embeddedEmissionsKg).to.equal(45_000n); // steel: direct only, 90 t * 50%
      expect(await cert.ownerOf(2)).to.equal(importerA.address);
    });

    it("never sells the same measured tonne twice", async () => {
      const { cert, ledger, oracle, importerA, importerB } = await verifiedWindows();
      await cert.connect(oracle).issue(importerA.address, issueInput("TR-CEM-01", "S1", [{ batchId: 1, productionKg: 800_000n }]));
      await expect(
        cert.connect(oracle).issue(importerB.address, issueInput("TR-CEM-01", "S2", [{ batchId: 1, productionKg: 300_000n }])),
      ).to.be.revertedWithCustomError(ledger, "ProductionExceeded");
    });

    it("refuses certificates backed by rejected or foreign windows, and duplicate shipments", async () => {
      const { cert, ledger, oracle, importerA } = await verifiedWindows();
      await expect(
        cert.connect(oracle).issue(importerA.address, issueInput("TR-CEM-01", "S1", [{ batchId: 3, productionKg: 1n }])),
      ).to.be.revertedWithCustomError(ledger, "NotVerified");
      await expect(
        cert.connect(oracle).issue(importerA.address, issueInput("TR-CEM-01", "S1", [{ batchId: 2, productionKg: 1n }])),
      ).to.be.revertedWithCustomError(cert, "WrongFacility");
      await cert.connect(oracle).issue(importerA.address, issueInput("TR-CEM-01", "S1", [{ batchId: 1, productionKg: 1000n }]));
      await expect(
        cert.connect(oracle).issue(importerA.address, issueInput("TR-CEM-01", "S1", [{ batchId: 1, productionKg: 1000n }])),
      ).to.be.revertedWithCustomError(cert, "DuplicateShipment");
    });

    it("allocates carbon price paid at origin once across all certificates", async () => {
      const { cert, admin, oracle, importerA, importerB } = await verifiedWindows();
      // 200 t priced at origin for EUR 2,400 (EUR 12/t)
      await cert.connect(admin).recordCarbonPrice(id("TR-CEM-01"), 200_000n, 240_000n, ethers.id("TR-ETS receipt"));
      await cert.connect(oracle).issue(importerA.address, issueInput("TR-CEM-01", "S1", [{ batchId: 1, productionKg: 250_000n }]));
      await cert.connect(oracle).issue(importerB.address, issueInput("TR-CEM-01", "S2", [{ batchId: 1, productionKg: 250_000n }]));
      const c1 = await cert.getCertificate(1);
      const c2 = await cert.getCertificate(2);
      expect(c1.pricedEmissionsKg).to.equal(160_000n);
      expect(c1.carbonPricePaidCents).to.equal(192_000n);
      expect(c2.pricedEmissionsKg).to.equal(40_000n); // only the remainder is left
      expect(c2.carbonPricePaidCents).to.equal(48_000n);
      const acc = await cert.carbonPrice(id("TR-CEM-01"));
      expect(acc.allocatedKg).to.equal(acc.pricedKg);
    });

    it("lets the holder claim a CBAM deduction exactly once, even after resale", async () => {
      const { cert, oracle, importerA, importerB, stranger } = await verifiedWindows();
      await cert.connect(oracle).issue(importerA.address, issueInput("TR-CEM-01", "S1", [{ batchId: 1, productionKg: 100_000n }]));
      await expect(cert.connect(stranger).claimDeduction(1, ethers.id("DECL-X"))).to.be.revertedWithCustomError(cert, "NotHolder");
      await expect(cert.connect(importerA).claimDeduction(1, ethers.id("DE-2026-001")))
        .to.emit(cert, "DeductionClaimed")
        .withArgs(1, importerA.address, ethers.id("DE-2026-001"));
      await expect(cert.connect(importerA).claimDeduction(1, ethers.id("DE-2026-002"))).to.be.revertedWithCustomError(
        cert,
        "AlreadyClaimed",
      );
      await cert.connect(importerA).transferFrom(importerA.address, importerB.address, 1);
      await expect(cert.connect(importerB).claimDeduction(1, ethers.id("NL-2026-777"))).to.be.revertedWithCustomError(
        cert,
        "AlreadyClaimed",
      );
    });
  });
});
