import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../App";
import { api } from "../lib/api";
import { initials } from "../lib/format";
import { IconArrowRight, IconVerify, Logo } from "../components/icons";
import { Spinner } from "../components/ui";

interface Persona {
  id: string;
  name: string;
  role: string;
  title: string;
  org: string;
  country: string;
}

const ROLE_COPY: Record<string, string> = {
  operator: "Runs three export plants. Sees live emissions, issues certificates per shipment.",
  verifier: "Accredited verifier. Reviews AI findings and signs windows on-chain.",
  importer: "Files CBAM declarations in the EU. Holds and claims certificates.",
  authority: "Records carbon price already paid under the Turkish ETS.",
};

export function Login() {
  const { user, signIn } = useSession();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [people, setPeople] = useState<Persona[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<Persona[]>("/api/auth/users")
      .then(setPeople)
      .catch((e) => setErr(`The Mizan API is not reachable (${e.message}). Start it with "pnpm demo".`));
  }, []);
  useEffect(() => {
    if (user) nav(loc.state?.from ?? "/", { replace: true });
  }, [user, nav, loc.state]);

  const pick = async (id: string) => {
    setBusy(id);
    setErr(null);
    try {
      await signIn(id);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="login">
      <section className="login-story">
        <div className="row" style={{ gap: 12 }}>
          <Logo size={34} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 19 }}>Mizan</div>
            <div className="small muted">Turkish for balance, the scales of account</div>
          </div>
        </div>
        <div>
          <h1 style={{ fontSize: 30, maxWidth: 560 }}>Emissions data an EU customs officer can check without trusting anyone.</h1>
          <p className="lede" style={{ fontSize: 15 }}>
            Since 1 January 2026, every tonne of cement, steel and aluminium entering the EU carries a carbon price under CBAM. Türkiye supplies close to a third of
            the EU's imported cement. Exporters that cannot prove their real emissions pay on punitive default values. Mizan makes that proof cheap, continuous and tamper-evident.
          </p>
        </div>
        <div className="flow">
          <div>
            <div className="flow-n">01 · Measure</div>
            <div style={{ fontWeight: 500, marginTop: 4 }}>Post-quantum signed meters</div>
            <div className="small ink2" style={{ marginTop: 4 }}>Every reading is signed at the meter with ML-DSA-44 (FIPS 204).</div>
          </div>
          <div>
            <div className="flow-n">02 · Detect</div>
            <div style={{ fontWeight: 500, marginTop: 4 }}>AI integrity engine</div>
            <div className="small ink2" style={{ marginTop: 4 }}>Physics, statistics and an isolation forest flag tampering, with reasons.</div>
          </div>
          <div>
            <div className="flow-n">03 · Anchor</div>
            <div style={{ fontWeight: 500, marginTop: 4 }}>On-chain MRV ledger</div>
            <div className="small ink2" style={{ marginTop: 4 }}>6-hour Merkle roots, non-overlapping, attested by an accredited verifier.</div>
          </div>
          <div>
            <div className="flow-n">04 · Certify</div>
            <div style={{ fontWeight: 500, marginTop: 4 }}>Double-claim-proof certificates</div>
            <div className="small ink2" style={{ marginTop: 4 }}>One NFT per shipment. Tonnes and carbon price can be claimed once.</div>
          </div>
        </div>
        <div className="row small muted" style={{ marginTop: "auto" }}>
          IEEE ClimateChain Global Hackathon 2026 · Carbon Markets & Emissions Transparency track · All companies shown are fictional.
        </div>
      </section>

      <section className="login-pick">
        <div>
          <h2 style={{ fontSize: 18 }}>Choose a role</h2>
          <p className="small ink2" style={{ margin: "4px 0 10px" }}>Each role signs with its own on-chain key. Switch any time from the sidebar.</p>
        </div>
        {err && <div className="callout critical">{err}</div>}
        {!people && !err && (
          <div className="row muted">
            <Spinner /> Connecting
          </div>
        )}
        {people?.map((p) => (
          <button key={p.id} className="persona" onClick={() => pick(p.id)} disabled={!!busy}>
            <span className="avatar">{initials(p.name)}</span>
            <span>
              <span style={{ fontWeight: 500 }}>{p.name}</span>
              <span className="small muted"> · {p.title}</span>
              <span className="small ink2" style={{ display: "block" }}>
                {p.org} ({p.country})
              </span>
              <span className="tiny muted" style={{ display: "block", marginTop: 2 }}>{ROLE_COPY[p.role]}</span>
            </span>
            {busy === p.id ? <Spinner /> : <IconArrowRight />}
          </button>
        ))}
        <Link to="/verify" className="btn ghost" style={{ alignSelf: "flex-start", marginTop: 6 }}>
          <IconVerify /> Verify a certificate without signing in
        </Link>
      </section>
    </div>
  );
}
