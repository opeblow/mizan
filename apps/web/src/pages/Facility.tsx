import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useResource } from "../lib/api";
import { dayHour, dateTime, fmt, tonnes, METRIC_UNIT } from "../lib/format";
import { CBAM_INDIRECT_NOTE, FACILITY_COLOR, SCOPE_SERIES } from "../lib/domain";
import { Badge, BatchStatus, Card, Hash, Loading, PageHead, RiskBadge, Stat } from "../components/ui";
import { BarChart, Legend, LineChart, RiskLegend, RiskStrip } from "../components/charts";
import { IconKey } from "../components/icons";

const RANGES = [
  { h: 24, b: 15, label: "24 h" },
  { h: 72, b: 60, label: "3 d" },
  { h: 168, b: 120, label: "7 d" },
  { h: 336, b: 240, label: "14 d" },
];

export function Facility() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [range, setRange] = useState(RANGES[1]);
  const [ratioIdx, setRatioIdx] = useState(0);
  const { data: f, error } = useResource<any>(`/api/facilities/${id}`, ["batch", "incident", "reading"], 3000);
  const { data: series } = useResource<any[]>(`/api/facilities/${id}/series?hours=${range.h}&bucket=${range.b}`, ["interval"], 3000);
  const { data: ratios } = useResource<any>(`/api/facilities/${id}/ratios?hours=${range.h}&bucket=${range.b}`, ["interval"], 3000);
  const { data: batches } = useResource<any[]>(`/api/batches?facilityId=${id}&limit=8`, ["batch"], 2000);

  if (!f) return <Loading error={error} />;
  const chartData = (series ?? []).map((p) => ({ t: p.t, direct: p.direct / 1000, indirect: p.indirect / 1000, risk: p.risk }));
  const bound = ratios?.bounds?.[ratioIdx];
  const flaggedBands = (series ?? []).filter((p) => p.risk >= 0.5).map((p) => ({ from: p.t, to: p.t + range.b * 60 }));

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead
        eyebrow={
          <span className="row">
            <i className="key-box" style={{ background: FACILITY_COLOR[f.id] }} /> {f.id} · {f.legalName}
          </span>
        }
        title={f.name}
        lede={`${f.process} in ${f.city}. Exports ${f.product.name.toLowerCase()} (CN ${f.product.cnLabel}). Roughly ${Math.round(f.euExportShare * 100)}% of output ships to the EU.`}
        actions={
          <>
            <Badge>{f.sectorLabel}</Badge>
            <Badge tone="info">{f.devices.length} ML-DSA-44 meters</Badge>
          </>
        }
      />

      <div className="stats">
        <Stat label="Embedded emissions (CBAM)" value={fmt(f.last24h.seeT, 3)} unit="t CO₂e / t" note={`30-day average ${fmt(f.last30d.seeT, 3)}`} />
        <Stat label="Production, last 24 h" value={fmt(f.last24h.productionT, 0)} unit="t" note={`${fmt((f.last24h.productionT / (f.annualCapacityT / 365)) * 100, 0)}% of nameplate capacity`} />
        <Stat
          label="Emissions, last 24 h"
          value={fmt(f.last24h.directT + f.last24h.indirectT, 0)}
          unit="t CO₂e"
          note={`${fmt(f.last24h.directT, 0)} direct · ${fmt(f.last24h.indirectT, 0)} from electricity`}
        />
        <Stat
          label="Carbon price paid at origin"
          value={f.carbonPrice.pricedT > 0 ? `€${fmt(f.carbonPrice.eurPerT, 1)}` : "–"}
          unit={f.carbonPrice.pricedT > 0 ? "/ t" : undefined}
          note={f.carbonPrice.pricedT > 0 ? `${tonnes(f.carbonPrice.pricedT)} priced under TR-ETS` : "Nothing recorded yet"}
        />
      </div>

      <div className="spread">
        <div className="seg" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r.label} aria-pressed={r.label === range.label} onClick={() => setRange(r)}>
              {r.label}
            </button>
          ))}
        </div>
        <span className="small muted">{f.latestTs ? `Latest interval ${dateTime(f.latestTs)}` : ""}</span>
      </div>

      <div className="grid g2">
        <Card title="Emissions by scope" sub={`t CO₂e per ${range.b >= 60 ? `${range.b / 60} h` : `${range.b} min`}. ${f.sector === 0 ? "Both scopes are embedded under CBAM for cement." : CBAM_INDIRECT_NOTE}`} action={<Legend series={SCOPE_SERIES} kind="box" />}>
          <BarChart data={chartData} x="t" series={SCOPE_SERIES} height={230} yFormat={(v) => fmt(v, v < 10 ? 1 : 0)} xFormat={(v) => dayHour(v)} tipTitle={(v) => dateTime(v)} />
        </Card>
        <Card
          title="Process intensity against physics"
          sub="Under-reporting an input pushes this line below the physical floor. Shaded: windows the AI scored high risk."
          action={
            <select className="select" style={{ width: "auto", height: 28 }} value={ratioIdx} onChange={(e) => setRatioIdx(Number(e.target.value))} aria-label="Ratio">
              {(ratios?.bounds ?? []).map((b: any, i: number) => (
                <option key={b.ratio} value={i}>
                  {b.ratio}
                </option>
              ))}
            </select>
          }
        >
          {bound && (
            <LineChart
              data={ratios.points}
              x="t"
              series={[{ key: `r${ratioIdx}`, label: `${bound.ratio} (${bound.unit})`, color: FACILITY_COLOR[f.id] }]}
              height={230}
              yFormat={(v) => fmt(v, v < 1 ? 3 : 1)}
              xFormat={(v) => dayHour(v)}
              tipTitle={(v) => dateTime(v)}
              band={flaggedBands}
              refLines={[
                { value: bound.min, label: `physical floor ${fmt(bound.min, 3)}`, tone: "critical" },
                { value: bound.typical, label: `sector typical ${fmt(bound.typical, 3)}`, tone: "muted" },
              ]}
            />
          )}
        </Card>
      </div>

      <Card title="Integrity per interval" sub="Fused score of five detectors for every 15-minute interval in the selected range" action={<RiskLegend />}>
        <RiskStrip values={(series ?? []).map((p) => ({ t: p.t, risk: p.risk }))} title={(t, r) => `${dateTime(t)} · max risk ${Math.round(r * 100)}%`} />
        <div className="spread tiny muted" style={{ marginTop: 6 }}>
          <span>{series?.[0] ? dateTime(series[0].t) : ""}</span>
          <span>
            Model: Isolation Forest, {f.model.trees} trees, {f.model.trained ? `trained on ${fmt(f.model.samples)} clean or verifier-cleared intervals` : "collecting training data"}
          </span>
          <span>{series?.length ? dateTime(series[series.length - 1].t) : ""}</span>
        </div>
      </Card>

      <Card title="Signed meters" sub="Each meter holds its own ML-DSA-44 private key. Only the hash of its public key is stored on-chain." pad={false}>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Meter</th>
                <th>Hardware</th>
                <th className="num">Last value</th>
                <th>Last reading</th>
                <th className="num">Accepted</th>
                <th className="num">Rejected</th>
                <th>Key hash (on-chain)</th>
                <th>Enrolment tx</th>
              </tr>
            </thead>
            <tbody>
              {f.devices.map((d: any) => (
                <tr key={d.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{d.label}</div>
                    <div className="mono muted">{d.id}</div>
                  </td>
                  <td className="small ink2">
                    {d.hardware}
                    <div className="tiny muted">class {d.accuracyClass}</div>
                  </td>
                  <td className="num">
                    {d.last_value != null ? fmt(d.last_value, 0) : "–"} <span className="muted">{METRIC_UNIT[d.metric]}</span>
                  </td>
                  <td className="small nowrap">{d.last_ts ? dateTime(d.last_ts) : "–"}</td>
                  <td className="num">{fmt(d.readings_count)}</td>
                  <td className="num">{d.rejected_count ? <span className="delta-bad">{fmt(d.rejected_count)}</span> : "0"}</td>
                  <td>
                    <span className="row" style={{ gap: 4 }}>
                      <IconKey size={12} style={{ color: "var(--muted)" }} />
                      <Hash value={d.public_key_hash} />
                    </span>
                  </td>
                  <td>
                    <Hash value={d.registered_tx} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Recent reporting windows"
        sub="6-hour windows sealed into a Merkle tree and anchored on MRVLedger"
        action={
          <Link to={`/ledger?facility=${f.id}`} className="btn sm">
            Open ledger
          </Link>
        }
        pad={false}
      >
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>#</th>
                <th>Window</th>
                <th className="num">Production</th>
                <th className="num">Direct t CO₂e</th>
                <th className="num">Indirect t CO₂e</th>
                <th>Risk</th>
                <th>Status</th>
                <th>Merkle root</th>
              </tr>
            </thead>
            <tbody>
              {(batches ?? []).map((b) => (
                <tr key={b.id} className="link" onClick={() => nav(`/ledger/${b.id}`)}>
                  <td className="mono">{b.onchain_id ?? "–"}</td>
                  <td className="nowrap">{dateTime(b.period_start)}</td>
                  <td className="num">{tonnes(b.production_kg / 1000)}</td>
                  <td className="num">{fmt(b.direct_kg / 1000, 1)}</td>
                  <td className="num">{fmt(b.indirect_kg / 1000, 1)}</td>
                  <td>
                    <RiskBadge risk={b.risk} />
                  </td>
                  <td>
                    <BatchStatus status={b.status} risk={b.risk} />
                  </td>
                  <td>
                    <Hash value={b.merkle_root} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
