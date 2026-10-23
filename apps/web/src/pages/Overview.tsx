import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../App";
import { api, useLive, useResource, type LiveEvent } from "../lib/api";
import { dayHour, dateTime, fmt, tonnes, pct } from "../lib/format";
import { FACILITY_COLOR, REJECT_LABEL } from "../lib/domain";
import { Badge, Card, Loading, PageHead, Stat } from "../components/ui";
import { BarChart, Legend, RiskLegend, RiskStrip } from "../components/charts";
import { IconAlert, IconCertificate, IconLedger, IconShield } from "../components/icons";

const LEDE: Record<string, string> = {
  operator: "Live embedded emissions across your export plants, what the integrity engine is flagging, and what is ready to certify.",
  verifier: "Windows waiting for your signature and the anomalies behind them. Low-risk windows can be attested in bulk.",
  importer: "The installations behind your imports, how their data is verified, and the certificates you hold.",
  authority: "Installations reporting under the Turkish ETS and the carbon price recorded against them.",
};

export function Overview() {
  const { user } = useSession();
  const { data, error } = useResource<any>("/api/overview", ["interval", "batch", "incident", "certificate"], 2500);
  const [series, setSeries] = useState<Record<string, any[]>>({});
  const [strips, setStrips] = useState<Record<string, any[]>>({});

  const loadSeries = async () => {
    if (!data) return;
    const out: Record<string, any[]> = {};
    const st: Record<string, any[]> = {};
    await Promise.all(
      data.facilities.map(async (f: any) => {
        out[f.id] = await api(`/api/facilities/${f.id}/series?hours=72&bucket=60`);
        st[f.id] = await api(`/api/facilities/${f.id}/series?hours=24&bucket=15`);
      }),
    );
    setSeries(out);
    setStrips(st);
  };
  useEffect(() => {
    void loadSeries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.latestTs]);

  const hourly = useMemo(() => {
    const ids = Object.keys(series);
    if (!ids.length) return [];
    const map = new Map<number, Record<string, number>>();
    for (const id of ids) {
      for (const p of series[id]) {
        const row: Record<string, number> = map.get(p.t) ?? { t: p.t };
        row[id] = (p.direct + p.indirect) / 1000;
        map.set(p.t, row);
      }
    }
    return [...map.values()].sort((a, b) => a.t - b.t);
  }, [series]);

  if (!data) return <Loading error={error} />;
  const t = data.totals;
  const facilities = data.facilities as any[];
  const emissions24 = facilities.reduce((s, f) => s + f.last24h.directT + f.last24h.indirectT, 0);
  const cbam24 = facilities.reduce((s, f) => s + f.last24h.seeT * f.last24h.productionT, 0);
  const facSeries = facilities.map((f) => ({ key: f.id, label: f.name, color: FACILITY_COLOR[f.id] }));

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead eyebrow={user?.org} title="Overview" lede={LEDE[user?.role ?? "operator"]} />

      {!data.chain.ready && (
        <div className="callout critical">
          <IconAlert size={16} style={{ color: "var(--critical)" }} />
          <div>
            <strong>Not connected to the chain.</strong> {data.chain.error}
          </div>
        </div>
      )}

      <div className="stats">
        <Stat
          label="Emissions, last 24 h"
          value={fmt(emissions24, 0)}
          unit="t CO₂e"
          note={`${fmt(cbam24, 0)} t embedded in CBAM goods`}
        />
        <Stat
          icon={<IconShield size={14} />}
          label="Open integrity incidents"
          value={fmt(t.incidents.open)}
          note={
            t.incidents.critical > 0 ? (
              <span className="delta-bad">{t.incidents.critical} high or critical</span>
            ) : (
              "None high or critical"
            )
          }
        />
        <Stat
          icon={<IconLedger size={14} />}
          label="Windows anchored on-chain"
          value={fmt(t.batches.total - (t.batches.queued ?? 0))}
          note={`${fmt(t.batches.verified)} verified · ${fmt(t.batches.rejected)} rejected · ${fmt(t.batches.anchored)} pending`}
        />
        <Stat
          icon={<IconCertificate size={14} />}
          label="Certified exports"
          value={tonnes(t.certificates.tonnes, 1).replace(/ (t|kt|Mt)$/, "")}
          unit={tonnes(t.certificates.tonnes, 1).split(" ")[1]}
          note={`${t.certificates.count} certificates · ${t.certificates.claimed} claimed in CBAM declarations`}
        />
      </div>

      <div className="grid g3">
        {facilities.map((f) => {
          const delta = f.last24h.prevSeeT > 0 ? f.last24h.seeT / f.last24h.prevSeeT - 1 : 0;
          return (
            <Link key={f.id} to={`/facilities/${f.id}`} className="card" style={{ textDecoration: "none", display: "block" }}>
              <div className="card-head" style={{ alignItems: "flex-start" }}>
                <div>
                  <div className="row">
                    <i className="key-box" style={{ background: FACILITY_COLOR[f.id] }} />
                    <h2>{f.name}</h2>
                  </div>
                  <div className="sub">
                    {f.city} · {f.product.name}
                  </div>
                </div>
                {f.openIncidents > 0 ? <Badge tone="critical">{f.openIncidents} open</Badge> : <Badge tone="good">Clean</Badge>}
              </div>
              <div className="card-body stack-sm">
                <div className="row" style={{ alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>{fmt(f.last24h.seeT, 3)}</span>
                  <span className="small ink2">t CO₂e per t, embedded (24 h)</span>
                </div>
                <div className="small ink2">
                  {f.last24h.prevSeeT > 0 && (
                    <span className={Math.abs(delta) < 0.005 ? "" : delta < 0 ? "delta-good" : "delta-bad"}>
                      {delta > 0 ? "▲" : delta < 0 ? "▼" : ""} {pct(Math.abs(delta), 1)} vs previous day
                    </span>
                  )}
                  <span className="muted"> · {tonnes(f.last24h.productionT, 0)} produced</span>
                </div>
                <div style={{ marginTop: 6 }}>
                  <div className="spread tiny muted" style={{ marginBottom: 4 }}>
                    <span>Integrity, last 24 h</span>
                    <span>{f.needsReview > 0 ? `${f.needsReview} window${f.needsReview > 1 ? "s" : ""} need review` : "No windows waiting"}</span>
                  </div>
                  <RiskStrip values={(strips[f.id] ?? []).map((p) => ({ t: p.t, risk: p.risk }))} title={(ts, r) => `${dateTime(ts)} · risk ${Math.round(r * 100)}%`} />
                </div>
              </div>
              <div className="card-foot spread">
                <span>{f.devices} signed meters · model {f.model.trained ? `trained on ${fmt(f.model.samples)} intervals` : "warming up"}</span>
                <span className="num">{tonnes(f.availableForCertificatesT, 0)} certifiable</span>
              </div>
            </Link>
          );
        })}
      </div>
      <RiskLegend />

      <div className="grid g-main">
        <Card title="Hourly emissions by installation" sub="t CO₂e, scope 1 + 2, last 72 hours" action={<Legend series={facSeries} kind="box" />}>
          <BarChart data={hourly} x="t" series={facSeries} height={250} yFormat={(v) => fmt(v, 0)} xFormat={(v) => dayHour(v)} tipTitle={(v) => dateTime(v)} />
        </Card>
        <ActivityFeed />
      </div>
    </div>
  );
}

function ActivityFeed() {
  const { data } = useResource<any>("/api/audit?limit=14", []);
  const [items, setItems] = useState<{ key: string; text: string; sub: string; tone?: "critical" | "good" }[]>([]);
  const [rate, setRate] = useState(0);

  useEffect(() => {
    if (!data) return;
    setItems(
      data.entries.map((e: any) => ({
        key: `a${e.seq}`,
        text: auditText(e),
        sub: `${dateTime(e.ts)} · ${e.actorName ?? e.actor}`,
        tone: /rejected|blocked|failed|confirmed/.test(e.action) ? "critical" : /verified|claimed|issued/.test(e.action) ? "good" : undefined,
      })),
    );
  }, [data]);

  useLive((events: LiveEvent[]) => {
    const readings = events.filter((e) => e.type === "reading").length;
    if (readings) setRate(readings);
    const fresh = events.flatMap((e): { key: string; text: string; sub: string; tone?: "critical" | "good" }[] => {
      if (e.type === "rejection") return [{ key: `r${Math.random()}`, text: `Rejected: ${REJECT_LABEL[e.reason] ?? e.reason}`, sub: `${e.deviceId ?? "unknown device"}`, tone: "critical" }];
      if (e.type === "incident" && e.isNew) return [{ key: `i${e.incidentId}`, text: e.title, sub: `${e.facilityId} · incident #${e.incidentId}`, tone: "critical" }];
      if (e.type === "batch") return [{ key: `b${e.batchId}${e.status}`, text: `Window #${e.batchId} ${e.status === "queued" ? "sealed" : e.status}`, sub: `${e.facilityId} · risk ${Math.round(e.risk * 100)}%`, tone: e.status === "verified" ? "good" : e.status === "rejected" ? "critical" : undefined }];
      if (e.type === "certificate") return [{ key: `c${e.certificateId}${e.status}`, text: `Certificate #${e.certificateId} ${e.status}`, sub: e.facilityId, tone: "good" }];
      return [];
    });
    if (fresh.length) setItems((xs) => [...fresh.reverse(), ...xs].slice(0, 14));
  });

  return (
    <Card title="Activity" sub={rate ? `${rate} signed readings in the last frame` : "Live from the ledger and the audit trail"} pad={false}>
      <ul style={{ listStyle: "none", margin: 0, padding: "4px 0" }}>
        {items.map((it) => (
          <li key={it.key} style={{ padding: "8px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 10 }}>
            <span style={{ marginTop: 6 }}>
              <span className="live-dot" style={{ background: it.tone === "critical" ? "var(--critical)" : it.tone === "good" ? "var(--good)" : "var(--axis)" }} />
            </span>
            <span className="grow">
              <span style={{ display: "block" }}>{it.text}</span>
              <span className="tiny muted">{it.sub}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function auditText(e: any): string {
  const [kind, verb] = e.action.split(".");
  const subj = e.subject.replace(":", " #");
  const map: Record<string, string> = {
    "batch.sealed": `Window ${subj.replace("batch ", "")} sealed`,
    "batch.anchored": `Window ${subj.replace("batch ", "")} anchored on-chain`,
    "batch.verified": `Window ${subj.replace("batch ", "")} verified`,
    "batch.rejected": `Window ${subj.replace("batch ", "")} rejected by verifier`,
    "certificate.issued": `Certificate ${subj.replace("certificate ", "")} issued`,
    "certificate.claimed": `Certificate ${subj.replace("certificate ", "")} claimed in a CBAM declaration`,
    "certificate.claim_blocked": `Double claim on certificate ${subj.replace("certificate ", "")} blocked by contract`,
    "incident.confirmed": `Incident ${subj.replace("incident ", "")} confirmed`,
    "incident.dismissed": `Incident ${subj.replace("incident ", "")} dismissed`,
    "carbon_price.recorded": `Carbon price recorded for ${e.subject.split(":")[1]}`,
    "device.enrolled": `Meter ${e.subject.split(":").slice(1).join(":")} enrolled`,
    "session.started": `${e.actorName ?? e.actor} signed in`,
    "demo.scenario": `Scenario started: ${e.subject.split(":")[1]}`,
  };
  return map[e.action] ?? `${kind} ${verb ?? ""} ${subj}`;
}
