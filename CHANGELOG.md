# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-23

### Added
- `MizanRegistry`, `MRVLedger` and `EmissionsCertificate` smart contracts with 13 tests covering every double-counting guarantee.
- ML-DSA-44 (NIST FIPS 204) signed meter readings with a canonical, domain-separated encoding.
- Ingestion gate with device, sequence, timestamp, signature and replay checks.
- AI integrity engine: physics envelopes, mass balance, robust statistics, isolation forest and frozen-sensor detectors, with plain-language explanations and verifier feedback.
- Six-hour Merkle windows anchored on-chain with emissions totals and AI risk.
- Per-shipment ERC-721 embedded-emissions certificates with one-time CBAM deduction claims.
- Browser-side public verifier for readings and certificates.
- CBAM exposure and decarbonisation planner, 2026 to 2034.
- Hash-chained audit log and database-against-chain integrity sweep.
- Meter fleet simulator with realistic process models and six attack scenarios.
- One-command demo, CI workflow, and project documentation.
