# Security Policy

Mizan produces evidence that carries money under the EU Carbon Border Adjustment Mechanism. We take vulnerabilities seriously and appreciate responsible disclosure.

## Supported versions
| Version | Supported |
|---|---|
| `main` | Yes |
| Older commits | No |

## Reporting a vulnerability
**Do not open a public issue.** Report privately through GitHub's private vulnerability reporting:

https://github.com/opeblow/mizan/security/advisories/new

Please include:
- the component (`packages/contracts`, `packages/shared`, `apps/api`, `apps/web`, `apps/simulator`)
- a description of the issue and its impact
- steps to reproduce or a proof of concept
- any suggested fix

## What to expect
| Step | Target |
|---|---|
| Acknowledgement | within 3 business days |
| Initial assessment and severity | within 7 days |
| Fix or mitigation plan | within 30 days for high and critical issues |
| Public disclosure | coordinated with the reporter after a fix is available |

## Scope
In scope:
- Smart contracts: access control, double counting, allocation and claim logic, Merkle verification
- Signature, encoding and Merkle code in `packages/shared` (forgery, malleability, encoding ambiguity)
- Ingestion gate bypasses: replay, spoofing, key swap
- Public verifier: any way to make tampered data appear authentic
- Authentication and authorisation in the API

Out of scope:
- The demo configuration's intentionally public development keys (Hardhat test mnemonic) and password-less demo login (`DEMO_MODE=true`)
- Findings that require a compromised operating system or physical access to a meter
- Denial of service through volumetric traffic

## Safe harbour
We will not pursue legal action against researchers who act in good faith, avoid privacy violations and service disruption, and give us reasonable time to fix an issue before disclosure.

## Threat model
The full security and data integrity assessment, including STRIDE analysis, smart-contract risk review and known limitations, is in [docs/SECURITY_ASSESSMENT.md](docs/SECURITY_ASSESSMENT.md).
