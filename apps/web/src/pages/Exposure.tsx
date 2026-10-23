import { useMemo, useState } from "react";
import { CBAM_PHASE_IN, ILLUSTRATIVE_DEFAULT_SEE, DEFAULT_VALUE_MARKUP, cbamExposure } from "@mizan/shared";
import { useResource } from "../lib/api";
import { eur, fmt, pct, tonnes } from "../lib/format";
import { CBAM_INDIRECT_NOTE, FACILITY_COLOR } from "../lib/domain";
import { Card, Loading, PageHead, Stat } from "../components/ui";
import { BarChart, Legend } from "../components/charts";

const YEARS = Object.keys(CBAM_PHASE_IN).map(Number);
/** Share of direct emissions that comes from fuel combustion (the rest is process CO2, e.g. calcination). */
const COMBUSTION_SHARE: Record<number, number> = { 0: 0.38, 1: 0.52, 2: 1 };

interface Levers {
  eua: number;
  euaGrowth: number;
  origin: number;
  renewables: number;
  fuel: number;
  clinker: number;
  efficiency: number;
}

function Slider({ label, value, min, max, step, onChange, format, hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string; hint?: string }) {
  return (
    <div className="field">
      <div className="spread">
        <label>{label}</label>
        <span className="num" style={{ fontWeight: 600 }}>{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Exposure() {
  const { data: ov, error } = useResource<any>("/api/overview", ["batch"], 10000);
  const [fid, setFid] = useState("TR-CEM-01");
  const [lv, setLv] = useState<Levers>({ eua: 75, euaGrowth: 0.04, origin: 14.5, renewables: 0.4, fuel: 0.25, clinker: 0.7, efficiency: 0.015 });
  const set = (k: keyof Levers) => (v: number) => setLv((x) => ({ ...x, [k]: v }));

  const f = ov?.facilities?.find((x: any) => x.id === fid);
  const model = useMemo(() => {
    if (!f || !(f.last30d.productionT > 0)) return null;
    const days = Math.max(1, f.last30d.days);
    const productionYear = (f.last30d.productionT / days) * 365;
    const exportsT = productionYear * f.euExportShare;
    const direct = f.last30d.directT / f.last30d.productionT;
    const indirect = f.last30d.indirectT / f.last30d.productionT;
    const countsIndirect = f.sector === 0;
    const comb = COMBUSTION_SHARE[f.sector] ?? 1;
    const rows = YEARS.map((y) => {
      const ramp = Math.min(1, (y - 2026) / 4); // levers phase in by 2030
      const eff = Math.pow(1 - lv.efficiency, y - 2026);
      const clinkerFactor = f.sector === 0 ? 1 - ramp * (1 - lv.clinker / 0.76) : 1;
      const sDirect = direct * clinkerFactor * (1 - comb * lv.fuel * ramp) * eff;
      const sIndirect = indirect * (1 - lv.renewables * ramp) * eff;
      const price = lv.eua * Math.pow(1 + lv.euaGrowth, y - 2026);
      const seeBase = direct + (countsIndirect ? indirect : 0);
      const seeScen = sDirect + (countsIndirect ? sIndirect : 0);
      const base = cbamExposure({ year: y, exportsT, seeT: seeBase, euaPrice: price, originCarbonPricePerT: lv.origin });
      const scen = cbamExposure({ year: y, exportsT, seeT: seeScen, euaPrice: price, originCarbonPricePerT: lv.origin });
      const markup = DEFAULT_VALUE_MARKUP[y] ?? 0.3;
      const defaultSee = (ILLUSTRATIVE_DEFAULT_SEE[f.sector] ?? seeBase) * (1 + markup);
      const unverified = cbamExposure({ year: y, exportsT, seeT: Math.max(defaultSee, seeBase), euaPrice: price, originCarbonPricePerT: lv.origin });
      return {
        year: y,
        price,
        phaseIn: base.phaseIn,
        seeBase,
        seeScen,
        baseline: base.netEur / 1e6,
        scenario: scen.netEur / 1e6,
        unverified: unverified.netEur / 1e6,
        deduction: scen.deductionEur / 1e6,
        avoidedT: productionYear * (direct + indirect - sDirect - sIndirect),
      };
    });
    const sum = (k: "baseline" | "scenario" | "unverified" | "avoidedT") => rows.reduce((s, r) => s + r[k], 0);
    return { rows, exportsT, productionYear, direct, indirect, countsIndirect, totals: { baseline: sum("baseline"), scenario: sum("scenario"), unverified: sum("unverified"), avoidedT: sum("avoidedT") } };
  }, [f, lv]);

  if (!ov) return <Loading error={error} />;
  const series = [
    { key: "baseline", label: "Current intensity", color: "var(--s2)" },
    { key: "scenario", label: "With selected measures", color: "var(--s1)" },
  ];
  const last = model?.rows[model.rows.length - 1];

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead
        eyebrow="Decision support"
        title="CBAM exposure and decarbonisation"
        lede="Projected net CBAM cost of EU-bound exports, 2026–2034, from this plant's own verified intensity. Move the levers to see what decarbonisation is worth, and what unverified data costs."
        actions={
          <div className="seg" role="group" aria-label="Installation">
            {ov.facilities.map((x: any) => (
              <button key={x.id} aria-pressed={fid === x.id} onClick={() => setFid(x.id)}>
                <span className="row" style={{ gap: 6 }}>
                  <i className="key-box" style={{ background: FACILITY_COLOR[x.id], width: 8, height: 8 }} />
                  {x.name.split(" ")[0]}
                </span>
              </button>
            ))}
          </div>
        }
      />

      {!model ? (
        <Loading />
      ) : (
        <>
          <div className="stats">
            <Stat label="Net CBAM cost 2026–2034, as is" value={eur(model.totals.baseline * 1e6)} note={`${tonnes(model.exportsT)} exported to the EU per year`} />
            <Stat label="With selected measures" value={eur(model.totals.scenario * 1e6)} note={<span className="delta-good">{eur((model.totals.baseline - model.totals.scenario) * 1e6)} saved</span>} />
            <Stat label="Emissions avoided 2026–2034" value={fmt(model.totals.avoidedT / 1000, 0)} unit="kt CO₂e" note="All output, all scopes, not only exports" />
            <Stat label="Cost of unverified data" value={eur((model.totals.unverified - model.totals.baseline) * 1e6)} note="Extra paid on default values instead of verified actuals" />
          </div>

          <div className="grid" style={{ gridTemplateColumns: "minmax(260px, 340px) minmax(0, 1fr)" }}>
            <Card title="Assumptions and levers" sub="Measures phase in linearly to 2030">
              <div className="stack">
                <Slider label="EU allowance price 2026" value={lv.eua} min={40} max={150} step={1} onChange={set("eua")} format={(v) => `€${v}`} />
                <Slider label="Allowance price growth" value={lv.euaGrowth} min={0} max={0.1} step={0.005} onChange={set("euaGrowth")} format={(v) => `${pct(v, 1)} / yr`} />
                <Slider label="Carbon price paid in Türkiye" value={lv.origin} min={0} max={60} step={0.5} onChange={set("origin")} format={(v) => `€${fmt(v, 1)} / t`} hint="Deductible under CBAM Art. 9" />
                <div className="divider" />
                <Slider
                  label="Renewable electricity (PPA, on-site solar)"
                  value={lv.renewables}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={set("renewables")}
                  format={(v) => pct(v)}
                  hint={model.countsIndirect ? "Lowers embedded emissions of cement directly." : "Lowers scope 2. " + CBAM_INDIRECT_NOTE}
                />
                <Slider label="Fuel switch (biomass, alternative fuels, H₂ burners)" value={lv.fuel} min={0} max={0.8} step={0.05} onChange={set("fuel")} format={(v) => pct(v)} hint="Share of combustion emissions removed" />
                {f.sector === 0 && <Slider label="Clinker-to-cement ratio" value={lv.clinker} min={0.6} max={0.76} step={0.01} onChange={set("clinker")} format={(v) => fmt(v, 2)} hint="Calcined clay and limestone blends (LC³) lower it" />}
                <Slider label="Energy efficiency gain" value={lv.efficiency} min={0} max={0.05} step={0.005} onChange={set("efficiency")} format={(v) => `${pct(v, 1)} / yr`} />
              </div>
            </Card>

            <div className="stack">
              <Card title="Net CBAM cost per year" sub="€ million, after deducting carbon price paid in Türkiye" action={<Legend series={series} kind="box" />}>
                <BarChart data={model.rows} x="year" series={series} mode="grouped" height={260} yFormat={(v) => `€${fmt(v, v < 10 ? 1 : 0)}m`} xFormat={(v) => String(v)} />
              </Card>
              <Card pad={false}>
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>Year</th>
                        <th className="num">CBAM phase-in</th>
                        <th className="num">EUA price</th>
                        <th className="num">t CO₂e / t today</th>
                        <th className="num">with measures</th>
                        <th className="num">Net cost today</th>
                        <th className="num">with measures</th>
                        <th className="num">on default values</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.rows.map((r) => (
                        <tr key={r.year}>
                          <td>{r.year}</td>
                          <td className="num">{pct(r.phaseIn, 1)}</td>
                          <td className="num">€{fmt(r.price, 0)}</td>
                          <td className="num">{fmt(r.seeBase, 3)}</td>
                          <td className="num">{fmt(r.seeScen, 3)}</td>
                          <td className="num">{eur(r.baseline * 1e6)}</td>
                          <td className="num">{eur(r.scenario * 1e6)}</td>
                          <td className="num">{eur(r.unverified * 1e6)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Method: net cost = phase-in share × embedded emissions × EUA price − carbon price paid at origin (capped). Intensity is the 30-day verified average of this installation
            ({fmt(model.direct, 3)} t direct and {fmt(model.indirect, 3)} t electricity per t). Default values are illustrative ({fmt(ILLUSTRATIVE_DEFAULT_SEE[f.sector], 2)} t CO₂e/t plus the
            Commission mark-up) and should be replaced with the published values for the country of origin. In 2034 the projected intensity is {last ? fmt(last.seeScen, 3) : "–"} t CO₂e/t.
          </p>
        </>
      )}
    </div>
  );
}
