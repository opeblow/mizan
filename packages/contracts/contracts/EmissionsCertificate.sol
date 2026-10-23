// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {MizanRegistry} from "./MizanRegistry.sol";
import {MRVLedger} from "./MRVLedger.sol";

/// @title EmissionsCertificate
/// @notice One NFT per export shipment of a CBAM good. It carries the shipment's embedded emissions, computed
///         on-chain from verified MRV windows, and the share of carbon price already paid at origin (for example
///         under the Turkish ETS) that the EU importer may deduct in its CBAM declaration.
/// @dev Double counting is blocked in three places:
///      - production: a tonne measured in a window can back only one certificate (MRVLedger.allocateProduction)
///      - carbon price: tonnes priced at origin are allocated once across all certificates of a facility
///      - deduction: each certificate can be claimed in exactly one CBAM declaration, by its current holder
contract EmissionsCertificate is ERC721, AccessControl {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant AUTHORITY_ROLE = keccak256("AUTHORITY_ROLE");

    struct Allocation {
        uint256 batchId;
        uint64 productionKg;
    }

    struct IssueInput {
        bytes32 facilityId;
        uint32 cnCode; // EU Combined Nomenclature code, e.g. 25232900 Portland cement
        bytes32 shipmentRef; // hash of the commercial invoice / customs reference
        Allocation[] allocations;
    }

    struct Certificate {
        bytes32 facilityId;
        uint32 cnCode;
        bytes32 shipmentRef;
        uint64 quantityKg;
        uint64 embeddedEmissionsKg;
        uint64 pricedEmissionsKg;
        uint64 carbonPricePaidCents; // EUR cents
        uint64 issuedAt;
        bool deductionClaimed;
        address claimedBy;
        uint64 claimedAt;
        bytes32 declarationRef;
    }

    struct CarbonPriceAccount {
        uint128 pricedKg; // CO2e on which a carbon price was effectively paid (kg)
        uint128 allocatedKg;
        uint128 paidCents; // total paid, EUR cents
        uint128 allocatedCents;
    }

    MizanRegistry public immutable registry;
    MRVLedger public immutable ledger;
    uint256 public totalIssued;

    mapping(uint256 => Certificate) private _certs;
    mapping(uint256 => Allocation[]) private _allocations;
    mapping(bytes32 => uint256) public certificateOfShipment;
    mapping(bytes32 => CarbonPriceAccount) public carbonPrice;

    event CarbonPriceRecorded(bytes32 indexed facilityId, uint128 pricedKg, uint128 paidCents, bytes32 evidenceHash);
    event CertificateIssued(
        uint256 indexed tokenId,
        bytes32 indexed facilityId,
        address indexed importer,
        uint32 cnCode,
        uint64 quantityKg,
        uint64 embeddedEmissionsKg,
        uint64 pricedEmissionsKg,
        uint64 carbonPricePaidCents
    );
    event DeductionClaimed(uint256 indexed tokenId, address indexed importer, bytes32 declarationRef);

    error NoAllocations();
    error DuplicateShipment(bytes32 shipmentRef, uint256 existingTokenId);
    error WrongFacility(uint256 batchId);
    error ZeroProduction(uint256 batchId);
    error NotHolder(uint256 tokenId, address caller);
    error AlreadyClaimed(uint256 tokenId, address claimedBy, bytes32 declarationRef);
    error UnknownCertificate(uint256 tokenId);

    constructor(address admin, MizanRegistry registry_, MRVLedger ledger_)
        ERC721("Mizan Embedded Emissions Certificate", "MZN-EEC")
    {
        registry = registry_;
        ledger = ledger_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Record carbon price effectively paid at origin (ETS allowances surrendered or a carbon tax).
    function recordCarbonPrice(bytes32 facilityId, uint128 pricedKg, uint128 paidCents, bytes32 evidenceHash)
        external
        onlyRole(AUTHORITY_ROLE)
    {
        registry.sectorOf(facilityId); // reverts for unknown facilities
        CarbonPriceAccount storage acc = carbonPrice[facilityId];
        acc.pricedKg += pricedKg;
        acc.paidCents += paidCents;
        emit CarbonPriceRecorded(facilityId, pricedKg, paidCents, evidenceHash);
    }

    function issue(address importer, IssueInput calldata input) external onlyRole(ISSUER_ROLE) returns (uint256 tokenId) {
        uint256 n = input.allocations.length;
        if (n == 0) revert NoAllocations();
        if (certificateOfShipment[input.shipmentRef] != 0) {
            revert DuplicateShipment(input.shipmentRef, certificateOfShipment[input.shipmentRef]);
        }

        // CBAM Annex II: indirect emissions count for cement and fertilisers only.
        MizanRegistry.Sector sector = registry.sectorOf(input.facilityId);
        bool countIndirect = sector == MizanRegistry.Sector.Cement || sector == MizanRegistry.Sector.Fertilisers;

        tokenId = ++totalIssued;
        uint64 quantityKg;
        uint256 emissionsKg;
        for (uint256 i = 0; i < n; i++) {
            Allocation calldata al = input.allocations[i];
            MRVLedger.Batch memory b = ledger.getBatch(al.batchId);
            if (b.facilityId != input.facilityId) revert WrongFacility(al.batchId);
            if (b.productionKg == 0) revert ZeroProduction(al.batchId);
            ledger.allocateProduction(al.batchId, al.productionKg); // reverts unless Verified and available
            uint256 relevant = uint256(b.directEmissionsKg) + (countIndirect ? uint256(b.indirectEmissionsKg) : 0);
            // Round up: a certificate may overstate embedded emissions by < 1 kg per window, never understate them.
            emissionsKg += (relevant * al.productionKg + b.productionKg - 1) / b.productionKg;
            quantityKg += al.productionKg;
            _allocations[tokenId].push(al);
        }

        CarbonPriceAccount storage acc = carbonPrice[input.facilityId];
        uint128 availablePriced = acc.pricedKg - acc.allocatedKg;
        uint128 pricedKg = emissionsKg < availablePriced ? uint128(emissionsKg) : availablePriced;
        uint128 cents = 0;
        if (pricedKg > 0) {
            cents = uint128((uint256(acc.paidCents) * pricedKg) / acc.pricedKg);
            acc.allocatedKg += pricedKg;
            acc.allocatedCents += cents;
        }

        _certs[tokenId] = Certificate({
            facilityId: input.facilityId,
            cnCode: input.cnCode,
            shipmentRef: input.shipmentRef,
            quantityKg: quantityKg,
            embeddedEmissionsKg: uint64(emissionsKg),
            pricedEmissionsKg: uint64(pricedKg),
            carbonPricePaidCents: uint64(cents),
            issuedAt: uint64(block.timestamp),
            deductionClaimed: false,
            claimedBy: address(0),
            claimedAt: 0,
            declarationRef: bytes32(0)
        });
        certificateOfShipment[input.shipmentRef] = tokenId;
        _safeMint(importer, tokenId);

        emit CertificateIssued(
            tokenId, input.facilityId, importer, input.cnCode, quantityKg, uint64(emissionsKg), uint64(pricedKg), uint64(cents)
        );
    }

    /// @notice The importer uses the certificate in exactly one CBAM declaration. The claim survives transfers,
    ///         so a resold certificate can never be deducted twice.
    function claimDeduction(uint256 tokenId, bytes32 declarationRef) external {
        Certificate storage c = _certs[tokenId];
        if (c.issuedAt == 0) revert UnknownCertificate(tokenId);
        if (ownerOf(tokenId) != msg.sender) revert NotHolder(tokenId, msg.sender);
        if (c.deductionClaimed) revert AlreadyClaimed(tokenId, c.claimedBy, c.declarationRef);
        c.deductionClaimed = true;
        c.claimedBy = msg.sender;
        c.claimedAt = uint64(block.timestamp);
        c.declarationRef = declarationRef;
        emit DeductionClaimed(tokenId, msg.sender, declarationRef);
    }

    function getCertificate(uint256 tokenId) external view returns (Certificate memory) {
        if (_certs[tokenId].issuedAt == 0) revert UnknownCertificate(tokenId);
        return _certs[tokenId];
    }

    function getAllocations(uint256 tokenId) external view returns (Allocation[] memory) {
        return _allocations[tokenId];
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
