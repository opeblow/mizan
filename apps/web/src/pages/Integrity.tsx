import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSession } from "../App";
import { api, useResource } from "../lib/api";
import { dateTime, fmt, timeOnly, tonnes } from "../lib/format";
import { CATEGORY_LABEL, DETECTOR_LABEL, FACILITY_COLOR, REJECT_LABEL } from "../lib/domain";
import { Badge, BatchStatus, Card, Drawer, Empty, Loading, PageHead, RiskBadge, SeverityBadge, Stat, useToast } from "../components/ui";
import { LineChart } from "../components/charts";
import { IconLock } from "../components/icons";

const FILTERS = [
  { id: "open", label: "Open" },
  { id: "confirmed", label: "Confirmed" },
  { id: "dismissed", label: "Dismissed" },
  { id: "all", label: "All" },
];

export function Integrity() {
  const { id } = useParams();
  const nav = useNavigate();
  const [status, setStatus] = useState("open");
  const [facility, setFacility] = useState("");
  const { data: incidents, error, reload } = useResource<any[]>(`/api/incidents?status=${status}${facility ? `&facilityId=${facility}` : ""}`, ["incident"], 1500);
  const { data: all } = useResource<any[]>(`/api/incidents?status=all`, ["incident"], 3000);
  const { data: rejections } = useResource<any[]>(`/api/rejections`, ["rejection"], 2000);

  const stats = useMemo(() => {
    const xs = all ?? [];
    return {
      open: xs.filter((i) => i.status === "open").length,
      severe: xs.filter((i) => i.status === "open" && (i.severity === "critical" || i.severity === "high")).length,
      understated: xs.filter((i) => i.status !== "dismissed").reduce((s, i) => s + i.est_understatement_kg, 0) / 1000,
      confirmed: xs.filter((i) => i.status === "confirmed").length,
      dismissed: xs.filter((i) => i.status === "dismissed").length,
    };
  }, [all]);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead
        eyebrow="AI integrity engine"
        title="Integrity"
        lede="Five independent detectors score every 15-minute interval: physics envelopes, mass balance, robust statistics, a per-plant isolation forest and frozen-sensor checks. Cryptographic checks reject forged and replayed messages before they reach the ledger. Every finding comes with its reasoning, and a verifier's decision is fed back into training."
      />
      <div className="stats">
        <Stat label="Open incidents" value={fmt(stats.open)} note={`${stats.severe} high or critical`} />
        <Stat label="Possible understatement caught" value={fmt(stats.understated, 0)} unit="t CO₂e" note="Estimated from the physical gap, confirmed and open incidents" />
        <Stat label="Verifier decisions" value={fmt(stats.confirmed + stats.dismissed)} note={`${stats.confirmed} confirmed · ${stats.dismissed} dismissed and fed back to the model`} />
        <Stat label="Messages rejected at the gate" value={fmt(rejections?.length ?? 0)} note="Bad signatures, replays, unknown devices" />
      </div>

      <div className="spread">
        <div className="seg" role="group" aria-label="Status filter">
          {FILTERS.map((f) => (
            <button key={f.id} aria-pressed={status === f.id} onClick={() => setStatus(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <select className="select" style={{ width: 240 }} value={facility} onChange={(e) => setFacility(e.target.value)} aria-label="Installation">
          <option value="">All installations</option>
          <option value="TR-CEM-01">Ege Clinker & Cement</option>
          <option value="TR-STL-01">Anadolu EAF Steel</option>
          <option value="TR-ALU-01">Marmara Aluminium Remelt</option>
        </select>
      </div>

      <Card pad={false}>
        {!incidents ? (
          <Loading error={error} />
        ) : incidents.length === 0 ? (
          <Empty>No {status === "all" ? "" : status} incidents. The plants look clean.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Finding</th>
                  <th>Detector</th>
                  <th>When</th>
                  <th className="num">Intervals</th>
                  <th className="num">Possible understatement</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((i) => (
                  <tr key={i.id} className={`link ${String(i.id) === id ? "sel" : ""}`} onClick={() => nav(`/integrity/${i.id}`)}>
                    <td>
                      <SeverityBadge severity={i.severity} />
                    </td>
                    <td style={{ minWidth: 280 }}>
                      <div style={{ fontWeight: 500 }}>{i.title}</div>
                      <div className="tiny muted row" style={{ gap: 6 }}>
                        <i className="key-box" style={{ background: FACILITY_COLOR[i.facility_id], width: 8, height: 8 }} />
                        {i.facility_id} · {CATEGORY_LABEL[i.category]}
                      </div>
                    </td>
                    <td className="small">{DETECTOR_LABEL[i.detector] ?? i.detector}</td>
                    <td className="small nowrap">
                      {dateTime(i.first_ts)}
                      {i.last_ts !== i.first_ts && <span className="muted"> → {timeOnly(i.last_ts)}</span>}
                    </td>
                    <td className="num">{i.occurrences}</td>
                    <td className="num">{i.est_understatement_kg > 0 ? tonnes(i.est_understatement_kg / 1000) : "–"}</td>
                    <td>
                      {i.status === "open" ? <Badge tone="warning">Open</Badge> : i.status === "confirmed" ? <Badge tone="critical">Confirmed</Badge> : <Badge tone="good">Dismissed</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Rejected at the gate" sub="Messages that never entered the ledger. The signature is the device's identity: no valid ML-DSA signature, no data." pad={false}>
        {!rejections?.length ? (
          <Empty>No messages rejected yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Reason</th>
                  <th>Device</th>
                  <th className="num">Seq</th>
                  <th>Plant time</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {rejections.slice(0, 20).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Badge tone="critical">{REJECT_LABEL[r.reason] ?? r.reason}</Badge>
                    </td>
                    <td className="mono">{r.device_id}</td>
                    <td className="num">{r.seq}</td>
                    <td className="small nowrap">{r.ts ? dateTime(r.ts) : "–"}</td>
                    <td className="small ink2">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {id && <IncidentDrawer id={Number(id)} onClose={() => nav("/integrity")} onChanged={reload} />}
    </div>
  );
}

function IncidentDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const { data: inc, error, reload } = useResource<any>(`/api/incidents/${id}`, ["incident"], 2000);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const decide = async (decision: "confirmed" | "dismissed") => {
    setBusy(true);
    try {
      await api(`/api/incidents/${id}/review`, { body: { decision, note } });
      toast("good", decision === "confirmed" ? "Incident confirmed. Its intervals are excluded from model training." : "Incident dismissed. Its intervals now count as clean training data.");
      await reload();
      onChanged();
    } catch (e) {
      toast("critical", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ratioChart = useMemo(() => {
    if (!inc) return null;
    const ev = inc.evidence ?? {};
    const pts = (inc.context ?? []).map((c: any) => {
      let v: number = c.risk;
      if (ev.ratio !== undefined && inc.key) {
        // reconstruct the flagged ratio from raw metrics when the finding is about a ratio
        const m = c.metrics;
        const pair = guessRatio(inc.key);
        if (pair && m[pair[1]] > 0) v = m[pair[0]] / m[pair[1]];
        else if (pair) v = NaN;
      }
      return { t: c.ts, v, risk: c.risk };
    });
    return { pts, isRatio: ev.ratio !== undefined && !!guessRatio(inc.key), ev };
  }, [inc]);

  return (
    <Drawer
      open
      onClose={onClose}
      title={inc?.title ?? "Incident"}
      sub={inc ? `#${inc.id} · ${inc.facility_id} · ${DETECTOR_LABEL[inc.detector] ?? inc.detector}` : undefined}
      foot={
        inc && user?.role === "verifier" && inc.status === "open" ? (
          <>
            <button className="btn" disabled={busy} onClick={() => decide("dismissed")}>
              Dismiss, explained
            </button>
            <button className="btn danger" disabled={busy} onClick={() => decide("confirmed")}>
              Confirm finding
            </button>
          </>
        ) : null
      }
    >
      {!inc ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="row wrap">
            <SeverityBadge severity={inc.severity} />
            <Badge>{CATEGORY_LABEL[inc.category]}</Badge>
            <RiskBadge risk={inc.score} />
            {inc.status !== "open" && (inc.status === "confirmed" ? <Badge tone="critical">Confirmed by {inc.reviewer}</Badge> : <Badge tone="good">Dismissed by {inc.reviewer}</Badge>)}
          </div>
          <div>
            <h3 style={{ marginBottom: 6 }}>Why this was flagged</h3>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55 }}>{inc.explanation}</p>
          </div>
          {ratioChart && ratioChart.pts.length > 1 && (
            <div>
              <h3 style={{ marginBottom: 8 }}>{ratioChart.isRatio ? inc.key : "Interval risk"} around the incident</h3>
              <LineChart
                data={ratioChart.pts}
                x="t"
                series={[{ key: "v", label: ratioChart.isRatio ? inc.key : "Risk", color: FACILITY_COLOR[inc.facility_id] }]}
                height={190}
                yFormat={(v) => (ratioChart.isRatio ? fmt(v, 3) : `${Math.round(v * 100)}%`)}
                xFormat={(v) => timeOnly(v)}
                tipTitle={(v) => dateTime(v)}
                band={[{ from: inc.first_ts - 900, to: inc.last_ts }]}
                refLines={
                  ratioChart.isRatio && ratioChart.ev.min
                    ? [
                        { value: ratioChart.ev.min, label: `physical floor ${fmt(ratioChart.ev.min, 3)}`, tone: "critical" as const },
                        ...(ratioChart.ev.typical ? [{ value: ratioChart.ev.typical, label: `typical ${fmt(ratioChart.ev.typical, 3)}`, tone: "muted" as const }] : []),
                      ]
                    : ratioChart.isRatio && ratioChart.ev.median
                      ? [{ value: ratioChart.ev.median, label: `plant median ${fmt(ratioChart.ev.median, 3)}`, tone: "muted" as const }]
                      : undefined
                }
              />
            </div>
          )}
          <dl className="kv">
            <dt>Installation</dt>
            <dd>{inc.facility_id}</dd>
            <dt>Period</dt>
            <dd>
              {dateTime(inc.first_ts)} → {dateTime(inc.last_ts)} ({inc.occurrences} interval{inc.occurrences > 1 ? "s" : ""})
            </dd>
            {inc.device_id && (
              <>
                <dt>Device</dt>
                <dd className="mono">{inc.device_id}</dd>
              </>
            )}
            <dt>Possible understatement</dt>
            <dd>{inc.est_understatement_kg > 0 ? `${fmt(inc.est_understatement_kg / 1000, 1)} t CO₂e` : "Not quantifiable from this detector"}</dd>
            <dt>Evidence</dt>
            <dd className="mono" style={{ fontSize: 11.5 }}>
              {Object.entries(inc.evidence)
                .filter(([, v]) => typeof v !== "object")
                .map(([k, v]) => `${k}=${typeof v === "number" ? (Number.isInteger(v) ? v : (v as number).toFixed(4)) : v}`)
                .join("  ·  ")}
            </dd>
            {inc.review_note && (
              <>
                <dt>Verifier note</dt>
                <dd>{inc.review_note}</dd>
              </>
            )}
          </dl>
          {inc.batches?.length > 0 && (
            <div>
              <h3 style={{ marginBottom: 6 }}>Affected reporting windows</h3>
              <table className="t">
                <tbody>
                  {inc.batches.map((b: any) => (
                    <tr key={b.id} className="link" onClick={() => nav(`/ledger/${b.id}`)}>
                      <td className="mono">#{b.onchain_id ?? b.id}</td>
                      <td className="small">{dateTime(b.period_start)}</td>
                      <td>
                        <RiskBadge risk={b.risk} />
                      </td>
                      <td>
                        <BatchStatus status={b.status} risk={b.risk} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {user?.role === "verifier" && inc.status === "open" ? (
            <div className="field">
              <label htmlFor="note">Verifier note</label>
              <textarea id="note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you check? Shift log, calibration certificate, site visit…" />
              <span className="hint">Dismissing marks these intervals as clean training data. Confirming excludes them from training forever.</span>
            </div>
          ) : (
            inc.status === "open" && (
              <div className="callout">
                <IconLock size={14} />
                <span className="small">Only the accredited verifier can confirm or dismiss findings. Sign in as Kerem Aydın to review.</span>
              </div>
            )
          )}
        </>
      )}
    </Drawer>
  );
}

const RATIO_KEYS: Record<string, [string, string]> = {
  "Kiln fuel per t clinker": ["petcoke_kg", "clinker_output_kg"],
  "Electricity per t cement": ["electricity_kwh", "cement_output_kg"],
  "Clinker-to-cement ratio": ["clinker_output_kg", "cement_output_kg"],
  "Electricity per t steel": ["electricity_kwh", "steel_output_kg"],
  "Natural gas per t steel": ["natural_gas_nm3", "steel_output_kg"],
  "Charge carbon per t steel": ["charge_carbon_kg", "steel_output_kg"],
  "Natural gas per t aluminium": ["natural_gas_nm3", "aluminium_output_kg"],
  "Electricity per t aluminium": ["electricity_kwh", "aluminium_output_kg"],
};
const guessRatio = (key: string) => RATIO_KEYS[key] ?? null;
