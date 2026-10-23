import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useSession } from "../App";
import { api, useResource } from "../lib/api";
import { dateTime, fmt, period, timeOnly, tonnes, METRIC_LABEL, METRIC_UNIT } from "../lib/format";
import { FACILITY_COLOR } from "../lib/domain";
import { Badge, BatchStatus, Card, Drawer, Empty, Hash, Loading, PageHead, RiskBadge, SeverityBadge, Stat, useToast } from "../components/ui";
import { RiskLegend, RiskStrip } from "../components/charts";
import { IconCheck, IconLock, IconVerify } from "../components/icons";

const STATUSES = [
  { id: "all", label: "All" },
  { id: "review", label: "Needs review" },
  { id: "anchored", label: "Pending" },
  { id: "verified", label: "Verified" },
  { id: "rejected", label: "Rejected" },
];

export function Ledger() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { user } = useSession();
  const toast = useToast();
  const [status, setStatus] = useState("all");
  const [facility, setFacility] = useState(params.get("facility") ?? "");
  const [busy, setBusy] = useState(false);
  const { data: batches, error, reload } = useResource<any[]>(`/api/batches?status=${status}${facility ? `&facilityId=${facility}` : ""}&limit=300`, ["batch"], 1500);
  const { data: ov } = useResource<any>("/api/overview", ["batch"], 3000);
  const { data: cfg } = useResource<any>("/api/public/config");

  const lowRisk = (batches ?? []).filter((b) => b.status === "anchored" && b.risk < 0.3).length;
  const attestAll = async () => {
    setBusy(true);
    try {
      const r = await api("/api/batches/attest-low-risk", { body: { maxRisk: 0.3, ...(facility ? { facilityId: facility } : {}) } });
      toast("good", `${r.attested} low-risk windows attested on-chain.`);
      await reload();
    } catch (e) {
      toast("critical", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const b = ov?.totals?.batches;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead
        eyebrow="MRVLedger smart contract"
        title="MRV ledger"
        lede="Every 6-hour reporting window is sealed into a Merkle tree over its signed readings and anchored with its emission totals and AI risk score. The contract refuses overlapping windows, so no hour of emissions can be reported twice, and only the accredited verifier can move a window to Verified or Rejected."
        actions={
          user?.role === "verifier" && lowRisk > 0 ? (
            <button className="btn primary" onClick={attestAll} disabled={busy}>
              <IconCheck size={14} /> Attest {lowRisk} low-risk window{lowRisk > 1 ? "s" : ""}
            </button>
          ) : null
        }
      />
      {b && (
        <div className="stats">
          <Stat label="Windows anchored" value={fmt(b.total - (b.queued ?? 0))} note={b.queued ? `${b.queued} sealed, waiting for the chain` : "None waiting"} />
          <Stat label="Verified" value={fmt(b.verified)} note="Usable as certificate backing" />
          <Stat label="Waiting for verifier" value={fmt(b.anchored)} note={`${ov.facilities.reduce((s: number, f: any) => s + f.needsReview, 0)} with elevated risk`} />
          <Stat label="Rejected" value={fmt(b.rejected)} note="Data cannot back any CBAM claim" />
        </div>
      )}

      <div className="spread">
        <div className="seg" role="group" aria-label="Status filter">
          {STATUSES.map((s) => (
            <button key={s.id} aria-pressed={status === s.id} onClick={() => setStatus(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="row">
          {cfg?.contracts?.MRVLedger && (
            <span className="small muted row">
              MRVLedger <Hash value={cfg.contracts.MRVLedger} />
            </span>
          )}
          <select className="select" style={{ width: 230 }} value={facility} onChange={(e) => setFacility(e.target.value)} aria-label="Installation">
            <option value="">All installations</option>
            <option value="TR-CEM-01">Ege Clinker & Cement</option>
            <option value="TR-STL-01">Anadolu EAF Steel</option>
            <option value="TR-ALU-01">Marmara Aluminium Remelt</option>
          </select>
        </div>
      </div>

      <Card pad={false}>
        {!batches ? (
          <Loading error={error} />
        ) : batches.length === 0 ? (
          <Empty>No windows match this filter.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>On-chain #</th>
                  <th>Installation</th>
                  <th>Window</th>
                  <th className="num">Readings</th>
                  <th className="num">Production</th>
                  <th className="num">t CO₂e</th>
                  <th>AI risk</th>
                  <th>Status</th>
                  <th>Anchor tx</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((x) => (
                  <tr key={x.id} className={`link ${String(x.id) === id ? "sel" : ""}`} onClick={() => nav(`/ledger/${x.id}`)}>
                    <td className="mono">{x.onchain_id ?? "–"}</td>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        <i className="key-box" style={{ background: FACILITY_COLOR[x.facility_id], width: 8, height: 8 }} />
                        {x.facility_id}
                      </span>
                    </td>
                    <td className="nowrap small">
                      {dateTime(x.period_start)} – {timeOnly(x.period_end)}
                    </td>
                    <td className="num">
                      {x.reading_count}
                      {x.reading_count < x.expected_count && <span className="delta-bad"> / {x.expected_count}</span>}
                    </td>
                    <td className="num">{tonnes(x.production_kg / 1000)}</td>
                    <td className="num">{fmt((x.direct_kg + x.indirect_kg) / 1000, 1)}</td>
                    <td>
                      <RiskBadge risk={x.risk} />
                    </td>
                    <td>
                      <BatchStatus status={x.status} risk={x.risk} />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Hash value={x.anchor_tx} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {id && <BatchDrawer id={Number(id)} onClose={() => nav(facility ? `/ledger?facility=${facility}` : "/ledger")} onChanged={reload} />}
    </div>
  );
}

function BatchDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const { data: b, error, reload } = useResource<any>(`/api/batches/${id}`, ["batch"], 1500);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const attest = async (approved: boolean) => {
    setBusy(true);
    try {
      const r = await api(`/api/batches/${id}/attest`, { body: { approved, note } });
      toast(approved ? "good" : "critical", `Window ${approved ? "verified" : "rejected"} on-chain · tx ${r.tx.slice(0, 10)}…`);
      await reload();
      onChanged();
    } catch (e) {
      toast("critical", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canAttest = user?.role === "verifier" && b?.status === "anchored";
  return (
    <Drawer
      open
      onClose={onClose}
      title={b ? `Window #${b.onchain_id ?? "–"} · ${b.facility_id}` : "Window"}
      sub={b ? period(b.period_start, b.period_end) : undefined}
      foot={
        canAttest ? (
          <>
            <button className="btn danger" disabled={busy} onClick={() => attest(false)}>
              Reject window
            </button>
            <button className="btn primary" disabled={busy} onClick={() => attest(true)}>
              <IconCheck size={14} /> Sign as verified
            </button>
          </>
        ) : null
      }
    >
      {!b ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="row wrap">
            <BatchStatus status={b.status} risk={b.risk} />
            <RiskBadge risk={b.risk} />
            <Badge>
              {b.reading_count} / {b.expected_count} readings
            </Badge>
          </div>

          <div className="grid g3">
            <div>
              <div className="small muted">Production</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{tonnes(b.production_kg / 1000)}</div>
              <div className="tiny muted">{tonnes(b.allocated_kg / 1000)} already certified</div>
            </div>
            <div>
              <div className="small muted">Direct emissions</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{fmt(b.direct_kg / 1000, 1)} t</div>
            </div>
            <div>
              <div className="small muted">Electricity emissions</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{fmt(b.indirect_kg / 1000, 1)} t</div>
            </div>
          </div>

          <div>
            <div className="spread" style={{ marginBottom: 6 }}>
              <h3>Interval risk</h3>
              <RiskLegend />
            </div>
            <RiskStrip values={b.intervals.map((i: any) => ({ t: i.ts, risk: i.risk }))} title={(t, r) => `${dateTime(t)} · ${Math.round(r * 100)}%`} />
          </div>

          {b.incidents.length > 0 && (
            <div>
              <h3 style={{ marginBottom: 6 }}>Findings in this window</h3>
              <table className="t">
                <tbody>
                  {b.incidents.map((i: any) => (
                    <tr key={i.id} className="link" onClick={() => nav(`/integrity/${i.id}`)}>
                      <td>
                        <SeverityBadge severity={i.severity} />
                      </td>
                      <td>{i.title}</td>
                      <td>{i.status === "open" ? <Badge tone="warning">Open</Badge> : i.status === "confirmed" ? <Badge tone="critical">Confirmed</Badge> : <Badge tone="good">Dismissed</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <h3 style={{ marginBottom: 8 }}>On-chain record</h3>
            <dl className="kv">
              <dt>Merkle root</dt>
              <dd><Hash value={b.merkle_root} head={14} tail={10} /></dd>
              <dt>Evidence hash</dt>
              <dd><Hash value={b.evidence_hash} head={14} tail={10} /></dd>
              <dt>Anchor tx</dt>
              <dd><Hash value={b.anchor_tx} href={b.explorer?.anchor} /> {b.anchor_block != null && <span className="small muted">block {b.anchor_block}</span>}</dd>
              <dt>Attestation</dt>
              <dd>
                {b.attest_tx ? (
                  <>
                    <Hash value={b.attest_tx} href={b.explorer?.attest} /> <span className="small muted">by {b.attested_by}</span>
                    <div className="small muted">report hash <Hash value={b.attestation_hash} /></div>
                  </>
                ) : (
                  <span className="muted">Not attested yet</span>
                )}
              </dd>
              {b.attestation?.note && (
                <>
                  <dt>Verifier note</dt>
                  <dd>{b.attestation.note}</dd>
                </>
              )}
              <dt>Audit log head</dt>
              <dd className="small">entry #{b.manifest.auditHead.seq} · <Hash value={b.manifest.auditHead.hash} /></dd>
            </dl>
          </div>

          <div>
            <h3 style={{ marginBottom: 8 }}>Metered totals</h3>
            <table className="t">
              <tbody>
                {Object.entries(b.manifest.totals).map(([k, v]) => (
                  <tr key={k}>
                    <td>{METRIC_LABEL[k] ?? k}</td>
                    <td className="num">
                      {fmt(v as number, 0)} <span className="muted">{METRIC_UNIT[k]}</span>
                    </td>
                  </tr>
                ))}
                {b.manifest.emissions.sources.map((s: any) => (
                  <tr key={s.source}>
                    <td className="ink2">→ {s.source}</td>
                    <td className="num">{fmt(s.kg / 1000, 2)} t CO₂e</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <div className="spread" style={{ marginBottom: 6 }}>
              <h3>Signed readings in this tree</h3>
              <span className="small muted">Pick any one and verify it yourself</span>
            </div>
            <div className="table-wrap" style={{ maxHeight: 280, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
              <table className="t">
                <thead>
                  <tr>
                    <th className="num">Leaf</th>
                    <th>Meter</th>
                    <th>Time</th>
                    <th className="num">Value</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {b.readings.map((r: any) => (
                    <tr key={r.id}>
                      <td className="num mono">{r.leaf_index}</td>
                      <td className="mono">{r.device_id.split(":")[1]}</td>
                      <td className="small">{timeOnly(r.ts)}</td>
                      <td className="num">
                        {fmt(r.value_milli / 1000, 0)} <span className="muted">{METRIC_UNIT[r.metric]}</span>
                      </td>
                      <td className="right">
                        <Link className="btn sm ghost" to={`/verify/reading/${r.id}`}>
                          <IconVerify size={13} /> Verify
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {canAttest ? (
            <div className="field">
              <label htmlFor="bnote">Verification report note</label>
              <textarea id="bnote" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Scope of checks, findings reviewed, conclusion" />
              <span className="hint">The full report (decision, findings reviewed, your note) is hashed and the hash is written on-chain with your signature.</span>
            </div>
          ) : (
            b.status === "anchored" && (
              <div className="callout">
                <IconLock size={14} />
                <span className="small">Only the accredited verifier's key can attest this window on-chain.</span>
              </div>
            )
          )}
        </>
      )}
    </Drawer>
  );
}
