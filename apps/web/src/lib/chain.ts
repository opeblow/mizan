import { Contract, JsonRpcProvider } from "ethers";

/** Minimal read-only ABIs. The browser talks to the chain directly, never through the Mizan API. */
export const REGISTRY_ABI = [
  "function getDevice(bytes32) view returns (tuple(bytes32 facilityId, bytes32 pubKeyHash, uint8 sigScheme, bool active, uint64 registeredAt, uint64 revokedAt))",
  "function getFacility(bytes32) view returns (tuple(address operator, uint16 countryCode, uint8 sector, bool active, uint64 registeredAt, string name))",
];
export const LEDGER_ABI = [
  "function getBatch(uint256) view returns (tuple(bytes32 facilityId, uint64 periodStart, uint64 periodEnd, bytes32 merkleRoot, uint32 readingCount, uint64 directEmissionsKg, uint64 indirectEmissionsKg, uint64 productionKg, uint64 productionAllocatedKg, uint16 riskScoreBps, uint8 status, uint64 anchoredAt, address attestedBy, uint64 attestedAt, bytes32 evidenceHash, bytes32 attestationHash))",
  "function verifyReading(uint256 batchId, bytes32 payloadHash, bytes32 signatureHash, bytes32[] proof) view returns (bool)",
];
export const CERT_ABI = [
  "function getCertificate(uint256) view returns (tuple(bytes32 facilityId, uint32 cnCode, bytes32 shipmentRef, uint64 quantityKg, uint64 embeddedEmissionsKg, uint64 pricedEmissionsKg, uint64 carbonPricePaidCents, uint64 issuedAt, bool deductionClaimed, address claimedBy, uint64 claimedAt, bytes32 declarationRef))",
  "function getAllocations(uint256) view returns (tuple(uint256 batchId, uint64 productionKg)[])",
  "function ownerOf(uint256) view returns (address)",
];

export const STATUS = ["None", "Pending", "Verified", "Rejected"] as const;

export interface ChainConfig {
  chainId: number;
  rpcUrl: string;
  contracts: { MizanRegistry: string; MRVLedger: string; EmissionsCertificate: string };
}

let cached: { key: string; provider: JsonRpcProvider } | null = null;

export function contracts(cfg: ChainConfig, rpcOverride?: string) {
  const url = rpcOverride || cfg.rpcUrl;
  if (!cached || cached.key !== url) cached = { key: url, provider: new JsonRpcProvider(url, cfg.chainId, { staticNetwork: true }) };
  const p = cached.provider;
  return {
    provider: p,
    registry: new Contract(cfg.contracts.MizanRegistry, REGISTRY_ABI, p),
    ledger: new Contract(cfg.contracts.MRVLedger, LEDGER_ABI, p),
    certificate: new Contract(cfg.contracts.EmissionsCertificate, CERT_ABI, p),
  };
}
