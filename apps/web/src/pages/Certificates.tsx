import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSession } from "../App";
import { ApiError, api, useResource } from "../lib/api";
import { dateOnly, dateTime, eur, fmt, period, tonnes } from "../lib/format";
import { FACILITY_COLOR } from "../lib/domain";
import { Badge, BatchStatus, Card, Drawer, Empty, Hash, Loading, PageHead, Stat, useToast } from "../components/ui";
import { IconAlert, IconCertificate, IconCheck, IconVerify } from "../components/icons";

const FACILITIES = [
  { id: "TR-CEM-01", name: "Ege Clinker & Cement", port: "Aliağa → Hamburg" },
  { id: "TR-STL-01", name: "Anadolu EAF Steel", port: "İskenderun → Rotterdam" },
  { id: "TR-ALU-01", name: "Marmara Aluminium Remelt", port: "Dilovası → Koper" },
];

export function Certificates() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useSession();
  const { data: certs, error, reload } = useResource<any[]>("/api/certificates", ["certificate"], 1000);

  const totals = (certs ?? []).reduce(
    (a, c) => ({ t: a.t + c.quantity_kg / 1000, e: a.e + c.embedded_kg / 1000, eur: a.eur + c.carbon_price_eur, claimed: a.claimed + (c.claimed_at ? 1 : 0) }),
    { t: 0, e: 0, eur: 0, claimed: 0 },
  );

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead
        eyebrow="EmissionsCertificate · ERC-721"
        title={user?.role === "importer" ? "Your certificates" : "Certificates"}
        lede="One certificate per export shipment. The contract computes embedded emissions itself from verified windows, allocates each measured tonne once, allocates carbon price paid in Türkiye once, and lets the holder claim a CBAM deduction exactly once, even after resale."
      />
      <div className="stats">
        <Stat label="Certificates" value={fmt(certs?.length ?? 0)} note={`${totals.claimed} claimed in a CBAM declaration`} />
        <Stat label="Goods certified" value={tonnes(totals.t, 1).split(" ")[0]} unit={tonnes(totals.t, 1).split(" ")[1]} note="Backed tonne-for-tonne by verified production" />
        <Stat label="Embedded emissions" value={fmt(totals.e, 0)} unit="t CO₂e" note={totals.t ? `${fmt(totals.e / totals.t, 3)} t CO₂e per t on average` : "–"} />
        <Stat label="Deductible carbon price" value={eur(totals.eur)} note="Already paid under the Turkish ETS pilot" />
      </div>

      {user?.role === "operator" && <IssueForm onIssued={(c) => { void reload(); nav(`/certificates/${c.id}`); }} />}

      <Card title="Issued certificates" pad={false}>
        {!certs ? (
          <Loading error={error} />
        ) : certs.length === 0 ? (
          <Empty>No certificates yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Shipment</th>
                  <th>Installation</th>
                  <th className="num">Quantity</th>
                  <th className="num">t CO₂e / t</th>
                  <th className="num">Embedded</th>
                  <th className="num">Deductible</th>
                  <th>CBAM claim</th>
                </tr>
              </thead>
              <tbody>
                {certs.map((c) => (
                  <tr key={c.id} className={`link ${String(c.id) === id ? "sel" : ""}`} onClick={() => nav(`/certificates/${c.id}`)}>
                    <td className="mono">MZN-{String(c.id).padStart(4, "0")}</td>
                    <td style={{ maxWidth: 300 }}>
                      <div className="small" style={{ fontWeight: 500 }}>{c.shipment_ref.split(" · ")[0]}</div>
                      <div className="tiny muted">{c.shipment_ref.split(" · ").slice(1).join(" · ")}</div>
                    </td>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        <i className="key-box" style={{ background: FACILITY_COLOR[c.facility_id], width: 8, height: 8 }} />
                        {c.facilityName}
                      </span>
                    </td>
                    <td className="num">{tonnes(c.quantity_kg / 1000)}</td>
                    <td className="num">{fmt(c.seeT, 3)}</td>
                    <td className="num">{fmt(c.embedded_kg / 1000, 0)} t</td>
                    <td className="num">{eur(c.carbon_price_eur)}</td>
                    <td>{c.claimed_at ? <Badge tone="good">Claimed</Badge> : <Badge tone="info">Unclaimed</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {id && <CertificateDrawer id={Number(id)} onClose={() => nav("/certificates")} onChanged={reload} />}
    </div>
  );
}

function IssueForm({ onIssued }: { onIssued: (c: any) => void }) {
  const toast = useToast();
  const { data: importers } = useResource<any[]>("/api/importers");
  const [facilityId, setFacilityId] = useState("TR-CEM-01");
  const [importerId, setImporterId] = useState("imp-hanna");
  const [quantity, setQuantity] = useState("2500");
  const [ref, setRef] = useState(() => `INV-2026-${Math.floor(1000 + Math.random() * 9000)}`);
  const [plan, setPlan] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const fac = FACILITIES.find((f) => f.id === facilityId)!;

  useEffect(() => {
    const q = Number(quantity);
    if (!(q > 0)) return setPlan(null);
    const t = setTimeout(() => {
      api(`/api/facilities/${facilityId}/allocations?quantityT=${q}`).then(setPlan).catch(() => setPlan(null));
    }, 250);
    return () => clearTimeout(t);
  }, [facilityId, quantity]);

  const issue = async () => {
    setBusy(true);
    try {
      const c = await api("/api/certificates", { body: { facilityId, importerId, quantityT: Number(quantity), shipmentRef: `${ref} · ${fac.port}` } });
      toast("good", `Certificate MZN-${String(c.id).padStart(4, "0")} minted to ${c.importer?.org}.`);
      setRef(`INV-2026-${Math.floor(1000 + Math.random() * 9000)}`);
      onIssued(c);
    } catch (e) {
      toast("critical", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Certify a shipment" sub="Allocates verified production oldest-first. The contract recomputes embedded emissions and refuses anything already sold.">
      <div className="grid g4" style={{ alignItems: "end" }}>
        <div className="field">
          <label htmlFor="fac">Installation</label>
          <select id="fac" className="select" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
            {FACILITIES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="imp">EU importer</label>
          <select id="imp" className="select" value={importerId} onChange={(e) => setImporterId(e.target.value)}>
            {(importers ?? []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.org} ({i.country})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="qty">Quantity (t)</label>
          <input id="qty" className="input num" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^0-9.]/g, ""))} />
        </div>
        <div className="field">
          <label htmlFor="ref">Invoice / customs reference</label>
          <input id="ref" className="input" value={ref} onChange={(e) => setRef(e.target.value)} />
        </div>
      </div>
      <div className="spread" style={{ marginTop: 14 }}>
        <div className="small ink2">
          {plan ? (
            plan.shortfallKg > 0 ? (
              <span className="row">
                <IconAlert size={14} style={{ color: "var(--critical)" }} /> Only {tonnes(plan.availableKg / 1000)} of verified, unallocated production is available.
              </span>
            ) : (
              <>
                Backed by {plan.plan.length} verified window{plan.plan.length > 1 ? "s" : ""} · {tonnes(plan.availableKg / 1000)} certifiable at this plant
              </>
            )
          ) : (
            "Enter a quantity"
          )}
        </div>
        <button className="btn primary" disabled={busy || !plan || plan.shortfallKg > 0 || ref.trim().length < 3} onClick={issue}>
          <IconCertificate size={14} /> {busy ? "Minting…" : "Mint certificate"}
        </button>
      </div>
    </Card>
  );
}

function CertificateDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const { data: c, error, reload } = useResource<any>(`/api/certificates/${id}`, ["certificate"], 800);
  const { data: importers } = useResource<any[]>("/api/importers");
  const [decl, setDecl] = useState(() => `DE-CBAM-2026-Q4-${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);

  const isHolder = user?.role === "importer" && c?.importer?.id === user.id;
  const claim = async () => {
    setBusy(true);
    setBlocked(null);
    try {
      await api(`/api/certificates/${id}/claim`, { body: { declarationRef: decl } });
      toast("good", "Deduction claimed on-chain. This certificate can never be claimed again.");
      await reload();
      onChanged();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setBlocked(msg);
      toast("critical", msg);
    } finally {
      setBusy(false);
    }
  };
  const transfer = async (to: string) => {
    setBusy(true);
    try {
      await api(`/api/certificates/${id}/transfer`, { body: { toImporterId: to } });
      toast("neutral", "Certificate transferred on-chain.");
      await reload();
      onChanged();
    } catch (e) {
      toast("critical", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open onClose={onClose} title={`Certificate MZN-${String(id).padStart(4, "0")}`} sub={c ? `Issued ${dateTime(c.issued_at)} · ERC-721 token #${id}` : undefined}
      foot={<Link to={`/verify/certificate/${id}`} className="btn"><IconVerify size={14} /> Verify independently</Link>}>
      {!c ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="card" style={{ padding: 18, background: "var(--surface-2)" }}>
            <div className="spread" style={{ alignItems: "flex-start" }}>
              <div>
                <div className="tiny muted">EMBEDDED EMISSIONS CERTIFICATE</div>
                <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{c.facility.product.name}</div>
                <div className="small ink2">CN {c.facility.product.cnLabel}</div>
              </div>
              {c.claimed_at ? <Badge tone="good">Deduction claimed</Badge> : <Badge tone="info">Deduction available</Badge>}
            </div>
            <div className="grid g3" style={{ marginTop: 16 }}>
              <div>
                <div className="small muted">Quantity</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>{tonnes(c.quantity_kg / 1000)}</div>
              </div>
              <div>
                <div className="small muted">Specific embedded emissions</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>{fmt(c.seeT, 3)} <span className="small ink2">t CO₂e/t</span></div>
              </div>
              <div>
                <div className="small muted">Total embedded</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>{fmt(c.embedded_kg / 1000, 1)} <span className="small ink2">t CO₂e</span></div>
              </div>
            </div>
            <div className="divider" style={{ margin: "14px 0" }} />
            <dl className="kv">
              <dt>Installation</dt>
              <dd>{c.facility.name}, {c.facility.city}</dd>
              <dt>Holder</dt>
              <dd>{c.importer ? `${c.importer.org} (${c.importer.country})` : "–"} <Hash value={c.importer_address} /></dd>
              <dt>Shipment</dt>
              <dd>{c.shipment_ref}<div><Hash value={c.shipment_hash} /></div></dd>
              <dt>Carbon price paid at origin</dt>
              <dd>{c.priced_kg > 0 ? `${eur(c.carbon_price_eur, false)} on ${fmt(c.priced_kg / 1000, 1)} t CO₂e (TR-ETS)` : "None allocated"}</dd>
              <dt>Mint tx</dt>
              <dd><Hash value={c.issue_tx} /></dd>
              {c.claimed_at && (
                <>
                  <dt>Claimed in</dt>
                  <dd>{c.declaration_ref} · {dateOnly(c.claimed_at)} <Hash value={c.claim_tx} /></dd>
                </>
              )}
            </dl>
          </div>

          <div>
            <h3 style={{ marginBottom: 6 }}>Backing windows</h3>
            <table className="t">
              <thead>
                <tr><th>Window</th><th>Period</th><th className="num">Allocated</th><th>Status</th></tr>
              </thead>
              <tbody>
                {c.allocations.map((a: any) => (
                  <tr key={a.batchId}>
                    <td className="mono"><Link to={`/ledger/${a.batchId}`}>#{a.onchainId}</Link></td>
                    <td className="small">{a.batch ? period(a.batch.period_start, a.batch.period_end) : "–"}</td>
                    <td className="num">{tonnes(a.productionKg / 1000)}</td>
                    <td>{a.batch && <BatchStatus status={a.batch.status} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isHolder && (
            <div className="card" style={{ padding: 16 }}>
              <h3>Use in a CBAM declaration</h3>
              <p className="small ink2" style={{ margin: "4px 0 12px" }}>
                Claiming writes your declaration reference on-chain and locks the deduction. The contract decides, not this server: try claiming twice.
              </p>
              <div className="row">
                <input className="input mono" value={decl} onChange={(e) => setDecl(e.target.value)} aria-label="Declaration reference" />
                <button className={`btn ${c.claimed_at ? "danger" : "primary"}`} disabled={busy || decl.trim().length < 3} onClick={claim}>
                  {c.claimed_at ? "Try to claim again" : <><IconCheck size={14} /> Claim deduction</>}
                </button>
              </div>
              {blocked && (
                <div className="callout critical" style={{ marginTop: 12 }}>
                  <IconAlert size={16} style={{ color: "var(--critical)" }} />
                  <div>
                    <strong>Double counting prevented.</strong> {blocked}
                  </div>
                </div>
              )}
              <div className="divider" style={{ margin: "14px 0" }} />
              <div className="spread">
                <span className="small ink2">Sell or transfer the certificate. A claim stays attached to the token.</span>
                {(importers ?? [])
                  .filter((i) => i.id !== user?.id)
                  .map((i) => (
                    <button key={i.id} className="btn sm" disabled={busy} onClick={() => transfer(i.id)}>
                      Transfer to {i.org}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
