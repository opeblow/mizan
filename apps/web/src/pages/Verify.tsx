import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  canonicalReading,
  leafOf,
  payloadHash,
  publicKeyHash,
  signatureHash,
  verifyProof,
  verifyReadingSignature,
  type Hex,
  type SignedReading,
} from "@mizan/shared";
import { api } from "../lib/api";
import { contracts, STATUS, type ChainConfig } from "../lib/chain";
import { dateTime, fmt, short, tonnes, METRIC_UNIT } from "../lib/format";
import { Badge, Card, Hash, PageHead } from "../components/ui";
import { IconAlert, IconCheck, IconVerify, IconX } from "../components/icons";

type StepState = "wait" | "run" | "ok" | "fail" | "warn" | "info";
interface Step {
  title: string;
  state: StepState;
  detail?: ReactNode;
  ms?: number;
}

function useConfig() {
  const [cfg, setCfg] = useState<ChainConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<ChainConfig>("/api/public/config")
      .then((c) => (c.contracts?.MRVLedger ? setCfg(c) : setErr("The API has no contract deployment loaded.")))
      .catch((e) => setErr(e.message));
  }, []);
  return { cfg, err };
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={i} className={`step ${s.state === "ok" ? "ok" : s.state === "fail" ? "fail" : s.state === "run" ? "run" : ""}`}>
          <span className="step-icon" aria-label={s.state}>
            {s.state === "ok" ? <IconCheck size={13} /> : s.state === "fail" ? <IconX size={13} /> : s.state === "run" ? <span className="spinner" /> : s.state === "warn" ? <IconAlert size={13} style={{ color: "var(--serious)" }} /> : s.state === "info" ? <span className="tiny" style={{ fontWeight: 600 }}>i</span> : <span className="tiny muted">{i + 1}</span>}
          </span>
          <div>
            <div className="spread">
              <span className="step-title">{s.title}</span>
              {s.ms != null && <span className="tiny muted num">{s.ms.toFixed(1)} ms</span>}
            </div>
            {s.detail && <div className="step-detail">{s.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---------------------------------------------------------------- reading verification core */

interface ReadingCheck {
  ok: boolean;
  steps: Step[];
  reading?: SignedReading;
  batchStatus?: string;
}

async function verifyReadingIndependently(cfg: ChainConfig, readingId: number, onStep: (steps: Step[]) => void): Promise<ReadingCheck> {
  const steps: Step[] = [
    { title: "Fetch the evidence package (untrusted)", state: "wait" },
    { title: "Meter key is registered on-chain", state: "wait" },
    { title: "Post-quantum signature is valid (ML-DSA-44, FIPS 204)", state: "wait" },
    { title: "Reading is inside the anchored Merkle root", state: "wait" },
    { title: "Smart contract confirms the proof", state: "wait" },
    { title: "Reporting window status on-chain", state: "wait" },
  ];
  const emit = () => onStep(steps.map((s) => ({ ...s })));
  const run = async (i: number, fn: () => Promise<{ ok: boolean | "warn"; detail: ReactNode }>) => {
    steps[i].state = "run";
    emit();
    const t0 = performance.now();
    try {
      const r = await fn();
      steps[i] = { ...steps[i], state: r.ok === "warn" ? "warn" : r.ok ? "ok" : "fail", detail: r.detail, ms: performance.now() - t0 };
    } catch (e) {
      steps[i] = { ...steps[i], state: "fail", detail: (e as Error).message, ms: performance.now() - t0 };
    }
    emit();
    return steps[i].state !== "fail";
  };
  const c = contracts(cfg);
  let pkg: any;
  let reading: SignedReading | undefined;

  if (
    !(await run(0, async () => {
      pkg = await api(`/api/public/readings/${readingId}`);
      reading = pkg.reading;
      return {
        ok: true,
        detail: (
          <>
            {pkg.reading.deviceId} · seq {pkg.reading.seq} · {fmt(pkg.reading.valueMilli / 1000, 3)} {METRIC_UNIT[pkg.reading.metric]} at {dateTime(pkg.reading.ts)}. Everything below re-derives
            trust from this data and the chain alone.
          </>
        ),
      };
    }))
  )
    return { ok: false, steps };

  const deviceOk = await run(1, async () => {
    const localHash = publicKeyHash(pkg.device.publicKey as Hex);
    const d = await c.registry.getDevice(pkg.device.chainId);
    const match = d.pubKeyHash.toLowerCase() === localHash.toLowerCase();
    return {
      ok: match && d.active,
      detail: (
        <>
          keccak256(public key) = <span className="mono">{short(localHash, 10, 8)}</span>, registry holds <span className="mono">{short(d.pubKeyHash, 10, 8)}</span>
          {match ? "" : ". Mismatch: the API served a different key."} {d.active ? "" : "Device revoked."}
        </>
      ),
    };
  });

  const sigOk = await run(2, async () => {
    const ok = verifyReadingSignature(reading!, pkg.device.publicKey as Hex);
    return {
      ok,
      detail: (
        <>
          Signed bytes: <span className="mono" style={{ wordBreak: "break-all" }}>{canonicalReading(reading!)}</span>
          <br />
          {ok ? "Signature verifies against the registered key (2,420-byte signature, 1,312-byte key)." : "Signature does NOT match these values. The stored reading was altered after it was signed."}
        </>
      ),
    };
  });

  let localRoot = "";
  let leaf = "";
  const ph = payloadHash(reading!);
  const sh = signatureHash(reading!.signature);
  const merkleOk = await run(3, async () => {
    if (!pkg.batch?.onchainId) return { ok: false, detail: "This reading is not in an anchored window yet." };
    leaf = leafOf(ph, sh);
    const b = await c.ledger.getBatch(pkg.batch.onchainId);
    localRoot = b.merkleRoot;
    const ok = verifyProof(leaf as Hex, pkg.proof, b.merkleRoot as Hex);
    return {
      ok,
      detail: (
        <>
          Leaf <span className="mono">{short(leaf, 10, 6)}</span> + {pkg.proof.length} sibling hashes → {ok ? "matches" : "does NOT match"} on-chain root{" "}
          <span className="mono">{short(b.merkleRoot, 10, 6)}</span> of window #{pkg.batch.onchainId}.
        </>
      ),
    };
  });

  const contractOk = await run(4, async () => {
    if (!pkg.batch?.onchainId) return { ok: false, detail: "No anchored window." };
    const ok = await c.ledger.verifyReading(pkg.batch.onchainId, ph, sh, pkg.proof);
    return { ok, detail: <>MRVLedger.verifyReading(…) returned <strong>{String(ok)}</strong>, computed by the contract at {short(cfg.contracts.MRVLedger)}.</> };
  });

  let batchStatus = "";
  await run(5, async () => {
    if (!pkg.batch?.onchainId) return { ok: false, detail: "No anchored window." };
    const b = await c.ledger.getBatch(pkg.batch.onchainId);
    batchStatus = STATUS[Number(b.status)];
    return {
      ok: batchStatus === "Verified" ? true : batchStatus === "Rejected" ? false : "warn",
      detail: (
        <>
          {batchStatus === "Verified"
            ? `Attested by accredited verifier ${short(b.attestedBy)}. Report hash ${short(b.attestationHash)}.`
            : batchStatus === "Rejected"
              ? "The verifier rejected this window. Its data cannot back a CBAM claim."
              : "Anchored, waiting for the verifier's attestation."}{" "}
          AI risk at anchoring: {(Number(b.riskScoreBps) / 100).toFixed(0)}%.
        </>
      ),
    };
  });

  return { ok: deviceOk && sigOk && merkleOk && contractOk, steps, reading, batchStatus };
}

/* ---------------------------------------------------------------- pages */

export function Verify() {
  return (
    <Routes>
      <Route index element={<VerifyHome />} />
      <Route path="reading/:id" element={<VerifyReading />} />
      <Route path="certificate/:id" element={<VerifyCertificate />} />
    </Routes>
  );
}

function Header({ children }: { children?: ReactNode }) {
  return (
    <PageHead
      eyebrow="No account needed"
      title="Public verifier"
      lede="Customs officers, EU importers, auditors and NGOs can check any Mizan certificate or meter reading here. Your browser fetches the evidence, verifies the post-quantum signatures itself and reads the smart contracts directly from the chain. The Mizan server is treated as untrusted."
      actions={children}
    />
  );
}

function ChainBanner({ cfg, err }: { cfg: ChainConfig | null; err: string | null }) {
  if (err) return <div className="callout critical"><IconAlert size={16} style={{ color: "var(--critical)" }} /> {err}</div>;
  if (!cfg) return null;
  return (
    <div className="callout small">
      <IconVerify size={14} />
      <span>
        Reading chain <strong>{cfg.chainId}</strong> via <span className="mono">{cfg.rpcUrl}</span> · MRVLedger <Hash value={cfg.contracts.MRVLedger} /> · EmissionsCertificate <Hash value={cfg.contracts.EmissionsCertificate} />
      </span>
    </div>
  );
}

function VerifyHome() {
  const nav = useNavigate();
  const { cfg, err } = useConfig();
  const [cert, setCert] = useState("1");
  const [reading, setReading] = useState("");
  const [samples, setSamples] = useState<any[]>([]);
  useEffect(() => {
    api<any[]>("/api/public/readings?limit=6").then(setSamples).catch(() => undefined);
  }, []);
  return (
    <div className="stack" style={{ gap: 20 }}>
      <Header />
      <ChainBanner cfg={cfg} err={err} />
      <div className="grid g2">
        <Card title="Verify a certificate" sub="Re-derives embedded emissions from on-chain windows and spot-checks signed readings behind them">
          <form className="row" onSubmit={(e) => { e.preventDefault(); nav(`/verify/certificate/${Number(cert.replace(/\D/g, ""))}`); }}>
            <input className="input mono" value={cert} onChange={(e) => setCert(e.target.value)} placeholder="Certificate number, e.g. 1 or MZN-0001" aria-label="Certificate number" />
            <button className="btn primary" type="submit">Verify</button>
          </form>
        </Card>
        <Card title="Verify a single meter reading" sub="Signature, key registry, Merkle inclusion and on-chain proof">
          <form className="row" onSubmit={(e) => { e.preventDefault(); nav(`/verify/reading/${Number(reading.replace(/\D/g, ""))}`); }}>
            <input className="input mono" value={reading} onChange={(e) => setReading(e.target.value)} placeholder="Reading id" aria-label="Reading id" />
            <button className="btn primary" type="submit" disabled={!reading}>Verify</button>
          </form>
          {samples.length > 0 && (
            <div className="row wrap small" style={{ marginTop: 10 }}>
              <span className="muted">Recent:</span>
              {samples.map((s) => (
                <Link key={s.id} to={`/verify/reading/${s.id}`} className="btn sm ghost mono">#{s.id}</Link>
              ))}
            </div>
          )}
        </Card>
      </div>
      <Card title="What is checked, and why it holds">
        <div className="grid g3 small">
          <div>
            <h3>Identity</h3>
            <p className="ink2">Each meter signs at the source with ML-DSA-44, a NIST post-quantum signature. The hash of its public key is registered on-chain, so the API cannot swap keys without it showing.</p>
          </div>
          <div>
            <h3>Immutability</h3>
            <p className="ink2">Readings are committed in 6-hour Merkle roots on MRVLedger. Editing a single value in the database changes its hash, breaks the proof and is caught here.</p>
          </div>
          <div>
            <h3>No double counting</h3>
            <p className="ink2">EmissionsCertificate computes embedded emissions from verified windows, sells each measured tonne once, and accepts one CBAM deduction claim per certificate, for ever.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function VerifyReading() {
  const { id = "0" } = useParams();
  const { cfg, err } = useConfig();
  const [steps, setSteps] = useState<Step[]>([]);
  const [result, setResult] = useState<ReadingCheck | null>(null);
  const start = useCallback(() => {
    if (!cfg) return;
    setResult(null);
    verifyReadingIndependently(cfg, Number(id), setSteps).then(setResult);
  }, [cfg, id]);
  useEffect(start, [start]);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Header>
        <Link to="/verify" className="btn">New check</Link>
        <button className="btn" onClick={start}>Run again</button>
      </Header>
      <ChainBanner cfg={cfg} err={err} />
      <Verdict result={result} label={`Reading #${id}`} />
      <Card title={`Reading #${id}`} sub="Each step runs in your browser">
        <Steps steps={steps} />
      </Card>
    </div>
  );
}

function Verdict({ result, label, kind = "reading" }: { result: { ok: boolean } | null; label: string; kind?: "reading" | "certificate" }) {
  if (!result) return null;
  return result.ok ? (
    <div className="callout good" style={{ fontSize: 14 }}>
      <IconCheck size={18} style={{ color: "var(--good-text)" }} />
      <div>
        <strong>{label} is authentic.</strong>{" "}
        {kind === "certificate"
          ? "It exists on-chain, is backed only by verifier-approved windows, its embedded emissions recompute exactly from on-chain data, and the signed readings sampled behind it are genuine."
          : "It was signed by a registered meter, has not been changed since, and is part of a window anchored on-chain."}
      </div>
    </div>
  ) : (
    <div className="callout critical" style={{ fontSize: 14 }}>
      <IconAlert size={18} style={{ color: "var(--critical)" }} />
      <div>
        <strong>{label} failed verification.</strong> The data served does not match what was signed and anchored. Treat it as tampered.
      </div>
    </div>
  );
}

function VerifyCertificate() {
  const { id = "0" } = useParams();
  const { cfg, err } = useConfig();
  const [steps, setSteps] = useState<Step[]>([]);
  const [spot, setSpot] = useState<{ id: number; ok: boolean | null; steps: Step[] }[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [verdict, setVerdict] = useState<{ ok: boolean } | null>(null);

  const start = useCallback(async () => {
    if (!cfg) return;
    setVerdict(null);
    setSpot([]);
    const st: Step[] = [
      { title: "Read the certificate from the chain", state: "wait" },
      { title: "Compare with the copy served by the Mizan API", state: "wait" },
      { title: "Every backing window is Verified on-chain", state: "wait" },
      { title: "Recompute embedded emissions from on-chain window data", state: "wait" },
      { title: "CBAM deduction claim status", state: "wait" },
    ];
    const emit = () => setSteps(st.map((s) => ({ ...s })));
    const c = contracts(cfg);
    const run = async (i: number, fn: () => Promise<{ ok: boolean | "warn" | "info"; detail: ReactNode }>) => {
      st[i].state = "run";
      emit();
      const t0 = performance.now();
      try {
        const r = await fn();
        st[i] = { ...st[i], state: r.ok === "warn" ? "warn" : r.ok === "info" ? "info" : r.ok ? "ok" : "fail", detail: r.detail, ms: performance.now() - t0 };
      } catch (e) {
        st[i] = { ...st[i], state: "fail", detail: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message, ms: performance.now() - t0 };
      }
      emit();
      return st[i].state !== "fail";
    };

    let onchain: any;
    let owner = "";
    let allocations: any[] = [];
    let fac: any;
    const ok0 = await run(0, async () => {
      onchain = await c.certificate.getCertificate(Number(id));
      owner = await c.certificate.ownerOf(Number(id));
      fac = await c.registry.getFacility(onchain.facilityId);
      allocations = await c.certificate.getAllocations(Number(id));
      const q = Number(onchain.quantityKg) / 1000;
      const e = Number(onchain.embeddedEmissionsKg) / 1000;
      setSummary({ q, e, see: e / q, owner, facility: fac.name, cn: Number(onchain.cnCode), claimed: onchain.deductionClaimed, priced: Number(onchain.pricedEmissionsKg) / 1000, eur: Number(onchain.carbonPricePaidCents) / 100 });
      return { ok: true, detail: <>{fac.name} · {tonnes(q)} · {fmt(e, 1)} t CO₂e · held by <span className="mono">{short(owner)}</span></> };
    });
    if (!ok0) return setVerdict({ ok: false });

    const ok1 = await run(1, async () => {
      try {
        const served = await api(`/api/public/certificates/${id}`);
        const same = served.quantity_kg === Number(onchain.quantityKg) && served.embedded_kg === Number(onchain.embeddedEmissionsKg);
        return { ok: same, detail: same ? "Quantity and embedded emissions match the chain exactly." : `API says ${served.embedded_kg} kg, chain says ${onchain.embeddedEmissionsKg} kg. Trust the chain.` };
      } catch {
        return { ok: "warn", detail: "The API does not know this certificate. The chain record above stands on its own." };
      }
    });

    let batches: any[] = [];
    const ok2 = await run(2, async () => {
      batches = await Promise.all(allocations.map((a: any) => c.ledger.getBatch(a.batchId)));
      const statuses = batches.map((b) => STATUS[Number(b.status)]);
      const all = statuses.every((s) => s === "Verified");
      return { ok: all, detail: `${allocations.length} window${allocations.length > 1 ? "s" : ""}, ${statuses.filter((s) => s === "Verified").length} Verified: ${allocations.slice(0, 6).map((a: any) => `#${a.batchId}`).join(", ")}${allocations.length > 6 ? ` and ${allocations.length - 6} more` : ""}` };
    });

    const ok3 = await run(3, async () => {
      const countIndirect = Number(fac.sector) === 0 || Number(fac.sector) === 3;
      let kg = 0n;
      allocations.forEach((a: any, i: number) => {
        const b = batches[i];
        const relevant = BigInt(b.directEmissionsKg) + (countIndirect ? BigInt(b.indirectEmissionsKg) : 0n);
        const p = BigInt(a.productionKg);
        const prod = BigInt(b.productionKg);
        kg += (relevant * p + prod - 1n) / prod;
      });
      const match = kg === BigInt(onchain.embeddedEmissionsKg);
      return {
        ok: match,
        detail: (
          <>
            Σ (window CBAM emissions × allocated share) = {fmt(Number(kg) / 1000, 3)} t CO₂e {match ? "= certificate" : "≠ certificate"}. {countIndirect ? "Cement: direct and electricity emissions count." : "Steel and aluminium: direct emissions only."}
          </>
        ),
      };
    });

    await run(4, async () => ({
      ok: "info",
      detail: onchain.deductionClaimed ? (
        <>Already claimed by <span className="mono">{short(onchain.claimedBy)}</span> on {dateTime(Number(onchain.claimedAt))}. Any further claim is rejected by the contract.</>
      ) : (
        <>Not claimed yet. Carbon price paid at origin attached: €{fmt(Number(onchain.carbonPricePaidCents) / 100, 0)} on {fmt(Number(onchain.pricedEmissionsKg) / 1000, 1)} t.</>
      ),
    }));

    // spot-check three signed readings from the backing windows
    let spotOk = true;
    try {
      const firstLocal = await api(`/api/public/certificates/${id}`).catch(() => null);
      const localBatchIds: number[] = firstLocal ? firstLocal.allocations.map((a: any) => a.batchId) : [];
      const pool: any[] = [];
      for (const b of localBatchIds.slice(0, 3)) pool.push(...(await api<any[]>(`/api/public/readings?batchId=${b}&limit=60`)));
      const picks = pool.sort(() => Math.random() - 0.5).slice(0, 3);
      const state = picks.map((p) => ({ id: p.id, ok: null as boolean | null, steps: [] as Step[] }));
      setSpot(state.map((s) => ({ ...s })));
      for (let i = 0; i < picks.length; i++) {
        const r = await verifyReadingIndependently(cfg, picks[i].id, (s) => {
          state[i].steps = s;
          setSpot(state.map((x) => ({ ...x })));
        });
        state[i].ok = r.ok;
        spotOk = spotOk && r.ok;
        setSpot(state.map((x) => ({ ...x })));
      }
    } catch {
      spotOk = false;
    }
    setVerdict({ ok: ok0 && ok1 !== false && ok2 && ok3 && spotOk });
  }, [cfg, id]);

  useEffect(() => {
    void start();
  }, [start]);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Header>
        <Link to="/verify" className="btn">New check</Link>
        <button className="btn" onClick={() => void start()}>Run again</button>
      </Header>
      <ChainBanner cfg={cfg} err={err} />
      <Verdict result={verdict} kind="certificate" label={`Certificate MZN-${String(id).padStart(4, "0")}`} />
      {summary && (
        <div className="stats">
          <div className="stat"><div className="stat-label">Installation</div><div className="stat-value" style={{ fontSize: 18 }}>{summary.facility}</div><div className="stat-note">CN {summary.cn}</div></div>
          <div className="stat"><div className="stat-label">Quantity</div><div className="stat-value">{tonnes(summary.q)}</div></div>
          <div className="stat"><div className="stat-label">Embedded emissions</div><div className="stat-value">{fmt(summary.see, 3)}<span className="stat-unit">t CO₂e / t</span></div><div className="stat-note">{fmt(summary.e, 1)} t in total</div></div>
          <div className="stat"><div className="stat-label">Deduction</div><div className="stat-value" style={{ fontSize: 20 }}>{summary.claimed ? <Badge tone="good">Claimed</Badge> : <Badge tone="info">Available</Badge>}</div><div className="stat-note">€{fmt(summary.eur, 0)} paid at origin</div></div>
        </div>
      )}
      <div className="grid g2" style={{ alignItems: "start" }}>
        <Card title="Certificate checks" sub="Read directly from EmissionsCertificate and MRVLedger">
          <Steps steps={steps} />
        </Card>
        <Card title="Spot check: signed readings behind it" sub="Three random readings from the backing windows, verified end to end">
          {spot.length === 0 ? (
            <div className="small muted">Waiting for certificate checks…</div>
          ) : (
            <div className="stack-sm">
              {spot.map((s) => (
                <details key={s.id} className="card" style={{ padding: "10px 12px" }}>
                  <summary className="spread" style={{ cursor: "pointer" }}>
                    <span className="mono">Reading #{s.id}</span>
                    {s.ok == null ? <span className="spinner" /> : s.ok ? <Badge tone="good">Authentic</Badge> : <Badge tone="critical">Failed</Badge>}
                  </summary>
                  <Steps steps={s.steps} />
                </details>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
