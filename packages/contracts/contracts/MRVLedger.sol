// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {MizanRegistry} from "./MizanRegistry.sol";

/// @title MRVLedger
/// @notice Monitoring, Reporting and Verification ledger. Each reporting window of each installation is
///         anchored here as a Merkle root over its signed meter readings, with the emissions and production
///         totals computed from those readings.
/// @dev Guarantees enforced on-chain:
///      1. Windows of one facility never overlap, so the same hour of emissions cannot be reported twice.
///      2. Any single reading can be proven to belong to an anchored window (verifyReading).
///      3. Only an accredited verifier moves a window to Verified or Rejected, and only once.
///      4. Production of a window can back certificates only up to what was measured.
contract MRVLedger is AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant CERTIFIER_ROLE = keccak256("CERTIFIER_ROLE");

    enum Status {
        None,
        Pending,
        Verified,
        Rejected
    }

    struct AnchorInput {
        bytes32 facilityId;
        uint64 periodStart; // unix seconds, inclusive
        uint64 periodEnd; // unix seconds, exclusive
        bytes32 merkleRoot;
        uint32 readingCount;
        uint64 directEmissionsKg; // scope 1, kg CO2e
        uint64 indirectEmissionsKg; // scope 2 (electricity), kg CO2e
        uint64 productionKg; // CBAM good produced in the window
        uint16 riskScoreBps; // AI integrity risk, 0..10000
        bytes32 evidenceHash; // sha256 of the off-chain batch manifest
    }

    struct Batch {
        bytes32 facilityId;
        uint64 periodStart;
        uint64 periodEnd;
        bytes32 merkleRoot;
        uint32 readingCount;
        uint64 directEmissionsKg;
        uint64 indirectEmissionsKg;
        uint64 productionKg;
        uint64 productionAllocatedKg;
        uint16 riskScoreBps;
        Status status;
        uint64 anchoredAt;
        address attestedBy;
        uint64 attestedAt;
        bytes32 evidenceHash;
        bytes32 attestationHash;
    }

    MizanRegistry public immutable registry;
    uint256 public batchCount;
    mapping(uint256 => Batch) private _batches;
    mapping(bytes32 => uint64) public lastPeriodEnd;

    event BatchAnchored(
        uint256 indexed batchId,
        bytes32 indexed facilityId,
        uint64 periodStart,
        uint64 periodEnd,
        bytes32 merkleRoot,
        uint64 directEmissionsKg,
        uint64 indirectEmissionsKg,
        uint64 productionKg,
        uint16 riskScoreBps
    );
    event BatchAttested(uint256 indexed batchId, address indexed verifier, bool approved, bytes32 attestationHash);
    event ProductionAllocated(uint256 indexed batchId, uint64 amountKg, uint64 totalAllocatedKg);

    error FacilityNotActive(bytes32 facilityId);
    error InvalidPeriod(uint64 start, uint64 end);
    error OverlappingPeriod(bytes32 facilityId, uint64 start, uint64 lastEnd);
    error EmptyBatch();
    error RiskOutOfRange(uint16 risk);
    error UnknownBatch(uint256 batchId);
    error NotPending(uint256 batchId, Status status);
    error NotVerified(uint256 batchId, Status status);
    error ProductionExceeded(uint256 batchId, uint64 requestedKg, uint64 availableKg);

    constructor(address admin, MizanRegistry registry_) {
        registry = registry_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function anchorBatch(AnchorInput calldata a) external onlyRole(ORACLE_ROLE) returns (uint256 batchId) {
        if (!registry.isFacilityActive(a.facilityId)) revert FacilityNotActive(a.facilityId);
        if (a.periodEnd <= a.periodStart) revert InvalidPeriod(a.periodStart, a.periodEnd);
        uint64 last = lastPeriodEnd[a.facilityId];
        if (a.periodStart < last) revert OverlappingPeriod(a.facilityId, a.periodStart, last);
        if (a.readingCount == 0 || a.merkleRoot == bytes32(0)) revert EmptyBatch();
        if (a.riskScoreBps > 10_000) revert RiskOutOfRange(a.riskScoreBps);

        lastPeriodEnd[a.facilityId] = a.periodEnd;
        batchId = ++batchCount;
        Batch storage b = _batches[batchId];
        b.facilityId = a.facilityId;
        b.periodStart = a.periodStart;
        b.periodEnd = a.periodEnd;
        b.merkleRoot = a.merkleRoot;
        b.readingCount = a.readingCount;
        b.directEmissionsKg = a.directEmissionsKg;
        b.indirectEmissionsKg = a.indirectEmissionsKg;
        b.productionKg = a.productionKg;
        b.riskScoreBps = a.riskScoreBps;
        b.status = Status.Pending;
        b.anchoredAt = uint64(block.timestamp);
        b.evidenceHash = a.evidenceHash;

        emit BatchAnchored(
            batchId,
            a.facilityId,
            a.periodStart,
            a.periodEnd,
            a.merkleRoot,
            a.directEmissionsKg,
            a.indirectEmissionsKg,
            a.productionKg,
            a.riskScoreBps
        );
    }

    /// @notice Verifier decision on a window. `attestationHash` commits to the signed verification report.
    function attest(uint256 batchId, bool approved, bytes32 attestationHash) external onlyRole(VERIFIER_ROLE) {
        Batch storage b = _batches[batchId];
        if (b.status == Status.None) revert UnknownBatch(batchId);
        if (b.status != Status.Pending) revert NotPending(batchId, b.status);
        b.status = approved ? Status.Verified : Status.Rejected;
        b.attestedBy = msg.sender;
        b.attestedAt = uint64(block.timestamp);
        b.attestationHash = attestationHash;
        emit BatchAttested(batchId, msg.sender, approved, attestationHash);
    }

    /// @notice Called by the certificate contract when production of a verified window is sold.
    function allocateProduction(uint256 batchId, uint64 amountKg) external onlyRole(CERTIFIER_ROLE) {
        Batch storage b = _batches[batchId];
        if (b.status != Status.Verified) revert NotVerified(batchId, b.status);
        uint64 available = b.productionKg - b.productionAllocatedKg;
        if (amountKg == 0 || amountKg > available) revert ProductionExceeded(batchId, amountKg, available);
        b.productionAllocatedKg += amountKg;
        emit ProductionAllocated(batchId, amountKg, b.productionAllocatedKg);
    }

    /// @notice Leaf format shared with the off-chain Merkle builder (double hashed against second-preimage attacks).
    function leafOf(bytes32 payloadHash, bytes32 signatureHash) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(payloadHash, signatureHash))));
    }

    /// @notice Proves that one signed meter reading belongs to an anchored window.
    function verifyReading(
        uint256 batchId,
        bytes32 payloadHash,
        bytes32 signatureHash,
        bytes32[] calldata proof
    ) external view returns (bool) {
        Batch storage b = _batches[batchId];
        if (b.status == Status.None) return false;
        return MerkleProof.verifyCalldata(proof, b.merkleRoot, leafOf(payloadHash, signatureHash));
    }

    function getBatch(uint256 batchId) external view returns (Batch memory) {
        return _batches[batchId];
    }

    function statusOf(uint256 batchId) external view returns (Status) {
        return _batches[batchId].status;
    }
}
