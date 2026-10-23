# PLAN.md — Mizan for the IEEE ClimateChain Global Hackathon 2026

> Strategy, research and delivery plan. For running the code see [SETUP.md](SETUP.md); for working on the code see [AGENTS.md](AGENTS.md).

**Deadline:** 25 October 2026, 07:00 PDT (14:00 UTC; the organisers' site says 23:59 UTC, the Devpost clock is the one that counts).
**Track:** Carbon Markets & Emissions Transparency.
**One line:** Mizan turns factory meters into post-quantum-signed, AI-checked, on-chain evidence, so Turkish exporters can prove the real embedded emissions of every CBAM shipment and no tonne or carbon price is ever counted twice.

---

## 1. What the hackathon actually rewards

### 1.1 The brief
Organised by the IEEE Blockchain Türkiye Group with the IEEE Blockchain Technical Committee, IEEE Orange County, IEEE Türkiye Section, the Istanbul Chamber of Commerce and the AI Ecosystem Association of Türkiye. Explicit goal: "support the goals of UN COP 31". Winners are announced **at COP31 (Antalya, Türkiye, November 2026)**.

The Carbon Markets track lists four builds, and Mizan covers all four:

| Track asks for | Mizan |
|---|---|
| Blockchain-based carbon credit verification | Per-shipment embedded-emissions certificates (ERC-721) computed on-chain from verified MRV windows |
| Real-time emissions tracking | Signed meter readings every 15 minutes, live dashboard and stream |
| Smart contracts to prevent double counting | Three on-chain guarantees: no overlapping windows, each measured tonne sold once, carbon price and CBAM deduction claimed once |
| Transparent carbon trading platforms | Certificates are transferable tokens; a claim stays attached through resale; anyone can verify in the browser |

### 1.2 Scoring
Devpost criteria (unweighted): Climate Impact · Innovation & Creativity · Technical Execution · Practical Usefulness · Presentation & Storytelling.

The organisers' own page (cmte.ieee.org/turkiye-blockchain/hackatlon) adds weights and deliverables most teams will never read:

| Weighted criterion | Weight | Where Mizan scores |
|---|---|---|
| Climate impact & environmental benefit | 30% | Catches under-reporting, puts a price on unverified data, decarbonisation planner with avoided-tonne projections ([docs/IMPACT.md](docs/IMPACT.md)) |
| Technical innovation & blockchain implementation | 30% | Three contracts, 15 tests, on-chain Merkle verification, on-chain emissions arithmetic, PQ signatures, isolation forest from scratch |
| Feasibility & implementation quality | 10% | Runs end to end with one command, real workflows for five roles |
| **Data security & transparency** | 10% | ML-DSA-44, replay and key-swap protection, hash-chained audit log, public verifier, STRIDE assessment ([docs/SECURITY.md](docs/SECURITY.md)) |
| **User experience & design** | 10% | Purpose-built UI, validated colour-blind-safe palette, light and dark, explanations for every AI finding |
| Scalability & sustainability | 10% | [docs/ADOPTION.md](docs/ADOPTION.md) |

Required extra deliverables on that page, all produced: architecture diagram and technical spec ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)), **security and data integrity assessment** ([docs/SECURITY.md](docs/SECURITY.md)), problem statement ≤ 2 pages ([docs/SUBMISSION.md](docs/SUBMISSION.md)), climate impact assessment with carbon reduction projections ([docs/IMPACT.md](docs/IMPACT.md)), implementation and adoption strategy and scalability roadmap ([docs/ADOPTION.md](docs/ADOPTION.md)), demo video.

### 1.3 The judges, and what each will look for
| Judge | Background | What lands with them | Where it is in Mizan |
|---|---|---|---|
| Prof. Şeref Sağıroğlu | Gazi Univ., AI, big data, cybersecurity, blockchain; group chair | AI that is explainable and secure | Integrity engine with reasons; security assessment |
| Dr. Güven Fidan | Hackathon lead; ran the "Blockchain and AI for Climate Change" session | Blockchain and AI genuinely combined | AI risk score is anchored on-chain with every window and gates certification |
| Prof. Sedat Akleylek | Post-quantum cryptography, IoT security (Tartu); supervises "quantum-secure protocols for blockchain" | PQ crypto used correctly, honest threat model | ML-DSA-44 (FIPS 204) at the meter; hybrid model and its limits stated in SECURITY.md |
| Dr. Kübra Seyhan | Lattice-based PQ protocols (PhD with Akleylek) | Lattice-based scheme, correct parameter choice | ML-DSA is lattice-based (Module-LWE/SIS); sizes and rationale documented |
| Dr. Mubashar Iqbal | Security risk management of blockchain applications (Tartu) | Risk analysis of the chain layer itself | STRIDE table, smart-contract risks, role separation |
| Prof. Gora Datta | HL7 Fellow, standards and interoperability | Standards alignment | CBAM CN codes, Annex II rules, ERC-721, FIPS 204, IPCC factors, data model mapping |
| Pradyumna Kodgi | Principal PM, Oracle | Real users, clear workflows, adoption path | Five roles with real jobs; ADOPTION.md |
| Dr. Elvan Duman, Dr. Ahmet Soran, Assoc. Prof. Saadin Oyucu, Venkatesh Mohanram, Revanth Reddy Airre | IEEE Blockchain community, engineering | Working software, clarity | One-command demo, tests, docs |

Training sessions signalled the same: Session 2 "AI and Cyber Security Issues for Climate Change" (trust, privacy, security of connected climate tech), Session 3 "Blockchain and AI for Climate Change".

### 1.4 Why this idea beats the field
Most of ~1,000 entrants will build a generic carbon-credit marketplace or a P2P energy token. Mizan is different on four axes:
1. **A real, dated, local problem.** CBAM's definitive period started on 1 January 2026; Türkiye published its ETS secondary regulation on 27 August 2026; Türkiye supplies about 30% of the EU's imported cement and 9% of its imported iron and steel; COP31 is in Antalya. The sponsor is the Istanbul Chamber of Commerce, whose members are these exporters.
2. **A double-counting problem nobody else will model:** carbon price paid in Türkiye is deductible from CBAM, and the same paid tonnes could be claimed by several EU importers. Mizan's contract allocates them once.
3. **Post-quantum signatures at the meter.** Two judges research exactly this.
4. **Verify-don't-trust.** The public verifier re-derives everything in the browser from the chain. Judges can test it themselves.

### 1.5 Previous editions
Searches found no earlier ClimateChain hackathon or winner list (this is the first edition). The organisers' earlier events are summits and workshops (IEEE Blockchain Summit İstanbul 2024/2025, Workshop Ankara 2026), which favour academically sound, security-aware work over flashy demos. We optimise for rigour plus a clear story.

---

## 2. Product scope (built)

| Layer | What exists |
|---|---|
| Contracts | `MizanRegistry`, `MRVLedger`, `EmissionsCertificate` (Solidity 0.8.24, OpenZeppelin 5), 15 Hardhat tests |
| Meters | 11 simulated meters on 3 plants, each with its own ML-DSA-44 key; realistic process physics; 6 attack scenarios |
| API | Fastify + SQLite (node:sqlite), ingestion gate, integrity engine, window sealing and anchoring, attestation, certificates, carbon price, audit log, SSE |
| AI | Physics envelopes, mass balance, robust z-scores, isolation forest (own implementation), frozen-sensor detector, noisy-OR fusion, human feedback loop |
| Web | Overview, installation detail, integrity queue, MRV ledger, certificates, CBAM exposure planner, public verifier, audit trail; five roles; light and dark |
| Docs | README, SETUP, AGENTS, PLAN, ARCHITECTURE, SECURITY, IMPACT, ADOPTION, SUBMISSION, DEMO_SCRIPT |
| Film | `production/product-launch-film/` |

## 3. Remaining timeline

| When | Task | Owner |
|---|---|---|
| Day 1 (22 Oct) | Build everything above, run end to end, fix | Claude |
| Day 1–2 | Render the launch film | Claude |
| Day 2 (23 Oct) | Run `pnpm demo` on your machine, click through every page, read the docs, push to a **public** GitHub repo | You |
| Day 2 | Optional: deploy contracts to Polygon Amoy (SETUP.md §5) and put the addresses in the README | You |
| Day 3 (24 Oct) | Upload video to YouTube (unlisted is fine, public is better), fill Devpost from docs/SUBMISSION.md, submit | You |
| Day 3 | Buffer. Submit at least 12 hours before the deadline. | You |

## 4. Submission checklist
- [ ] Public GitHub repo with this README at the root
- [ ] Track stated: Carbon Markets & Emissions Transparency
- [ ] Devpost text pasted from [docs/SUBMISSION.md](docs/SUBMISSION.md)
- [ ] Demo video link (YouTube/Vimeo), 3–5 min, from `production/product-launch-film/`
- [ ] Screenshots uploaded to the Devpost gallery (`production/product-launch-film/captures/`)
- [ ] "Try it out" link: the repo, plus the testnet contract addresses if deployed
- [ ] Built-with tags: solidity, hardhat, openzeppelin, ethereum, typescript, react, vite, fastify, sqlite, node.js, post-quantum-cryptography, machine-learning
- [ ] Team members added on Devpost; eligibility (student, age of majority) confirmed

## 5. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Judges cannot run it | Video shows every workflow; SETUP.md is one command; testnet deployment optional |
| "Simulated data" critique | Physics from published sector intensities, stated openly; ingestion API is the real integration point for meters/SCADA (ADOPTION.md) |
| CBAM simplifications challenged | Every simplification listed in IMPACT.md with the regulation reference |
| PQ claims challenged | SECURITY.md states the hybrid model: PQ at the data source, ECDSA on the chain, and the migration path |
