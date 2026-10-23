// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title MizanRegistry
/// @notice Source of truth for which installations exist and which meter keys may sign data for them.
/// @dev Meters sign readings off-chain with ML-DSA-44 (FIPS 204, post-quantum). ML-DSA public keys are
///      1,312 bytes, so only their keccak256 hash is stored here. Anyone can fetch the full key from the
///      Mizan API, hash it and compare it with this registry before trusting a signature.
contract MizanRegistry is AccessControl {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    /// @dev CBAM Annex I sectors. The sector decides which emissions count toward a certificate.
    enum Sector {
        Cement,
        IronSteel,
        Aluminium,
        Fertilisers,
        Hydrogen,
        Electricity
    }

    /// @dev 1 = ML-DSA-44 (FIPS 204). Leaves room for ML-DSA-65/87 or SLH-DSA without a migration.
    uint8 public constant SIG_ML_DSA_44 = 1;

    struct Facility {
        address operator;
        uint16 countryCode; // ISO 3166-1 numeric, e.g. 792 = Türkiye
        Sector sector;
        bool active;
        uint64 registeredAt;
        string name;
    }

    struct Device {
        bytes32 facilityId;
        bytes32 pubKeyHash;
        uint8 sigScheme;
        bool active;
        uint64 registeredAt;
        uint64 revokedAt;
    }

    mapping(bytes32 => Facility) private _facilities;
    mapping(bytes32 => Device) private _devices;
    bytes32[] public facilityIds;

    event FacilityRegistered(bytes32 indexed facilityId, address indexed operator, Sector sector, uint16 countryCode, string name);
    event FacilityStatusChanged(bytes32 indexed facilityId, bool active);
    event DeviceRegistered(bytes32 indexed deviceId, bytes32 indexed facilityId, bytes32 pubKeyHash, uint8 sigScheme);
    event DeviceRevoked(bytes32 indexed deviceId, bytes32 indexed facilityId, uint64 revokedAt);

    error FacilityExists(bytes32 facilityId);
    error UnknownFacility(bytes32 facilityId);
    error FacilityInactive(bytes32 facilityId);
    error DeviceExists(bytes32 deviceId);
    error UnknownDevice(bytes32 deviceId);
    error UnsupportedScheme(uint8 scheme);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, admin);
    }

    function registerFacility(
        bytes32 facilityId,
        address operator,
        uint16 countryCode,
        Sector sector,
        string calldata name
    ) external onlyRole(REGISTRAR_ROLE) {
        if (_facilities[facilityId].registeredAt != 0) revert FacilityExists(facilityId);
        _facilities[facilityId] = Facility({
            operator: operator,
            countryCode: countryCode,
            sector: sector,
            active: true,
            registeredAt: uint64(block.timestamp),
            name: name
        });
        facilityIds.push(facilityId);
        emit FacilityRegistered(facilityId, operator, sector, countryCode, name);
    }

    function setFacilityActive(bytes32 facilityId, bool active) external onlyRole(REGISTRAR_ROLE) {
        if (_facilities[facilityId].registeredAt == 0) revert UnknownFacility(facilityId);
        _facilities[facilityId].active = active;
        emit FacilityStatusChanged(facilityId, active);
    }

    function registerDevice(
        bytes32 deviceId,
        bytes32 facilityId,
        bytes32 pubKeyHash,
        uint8 sigScheme
    ) external onlyRole(REGISTRAR_ROLE) {
        Facility storage f = _facilities[facilityId];
        if (f.registeredAt == 0) revert UnknownFacility(facilityId);
        if (!f.active) revert FacilityInactive(facilityId);
        if (_devices[deviceId].registeredAt != 0) revert DeviceExists(deviceId);
        if (sigScheme != SIG_ML_DSA_44) revert UnsupportedScheme(sigScheme);
        _devices[deviceId] = Device({
            facilityId: facilityId,
            pubKeyHash: pubKeyHash,
            sigScheme: sigScheme,
            active: true,
            registeredAt: uint64(block.timestamp),
            revokedAt: 0
        });
        emit DeviceRegistered(deviceId, facilityId, pubKeyHash, sigScheme);
    }

    /// @notice Revoke a meter key (compromise, replacement, failed calibration). Readings signed after
    ///         `revokedAt` must be rejected by anyone verifying them.
    function revokeDevice(bytes32 deviceId) external onlyRole(REGISTRAR_ROLE) {
        Device storage d = _devices[deviceId];
        if (d.registeredAt == 0) revert UnknownDevice(deviceId);
        d.active = false;
        d.revokedAt = uint64(block.timestamp);
        emit DeviceRevoked(deviceId, d.facilityId, d.revokedAt);
    }

    function getFacility(bytes32 facilityId) external view returns (Facility memory) {
        return _facilities[facilityId];
    }

    function getDevice(bytes32 deviceId) external view returns (Device memory) {
        return _devices[deviceId];
    }

    function isFacilityActive(bytes32 facilityId) external view returns (bool) {
        return _facilities[facilityId].active;
    }

    function sectorOf(bytes32 facilityId) external view returns (Sector) {
        if (_facilities[facilityId].registeredAt == 0) revert UnknownFacility(facilityId);
        return _facilities[facilityId].sector;
    }

    function facilityCount() external view returns (uint256) {
        return facilityIds.length;
    }
}
