import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/* Hand-built SVG charts. Rules: one y-axis, 2px lines, recessive grid, a crosshair on line charts and
   per-column hover on bars, legends whenever there are two or more series, tooltip values lead. */

export interface Series {
  key: string;
  label: string;
  color: string;
}

/** Width of the chart container. A callback ref re-attaches the observer whenever the element changes
    (e.g. from the empty state to the plotted chart). */
function useWidth<T extends HTMLElement>() {
  const [w, setW] = useState(600);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    ro.current?.disconnect();
    if (!node) return;
    setW(Math.max(240, Math.floor(node.getBoundingClientRect().width)));
    ro.current = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.current.observe(node);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  return [ref, w] as const;
}

function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Number(v.toPrecision(12)));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export function Legend({ series, kind = "line" }: { series: Series[]; kind?: "line" | "box" }) {
  if (series.length < 2) return null;
  return (
    <div className="legend">
      {series.map((s) => (
        <span key={s.key}>
          <i className={kind === "line" ? "key-line" : "key-box"} style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function Tip({ x, y, width, title, rows }: { x: number; y: number; width: number; title: ReactNode; rows: { color: string; label: string; value: string }[] }) {
  const left = x > width - 190 ? x - 180 : x + 14;
  return (
    <div className="tip" style={{ left, top: Math.max(0, y) }}>
      <div className="tip-title">{title}</div>
      {rows.map((r) => (
        <div className="tip-row" key={r.label}>
          <i className="key-line" style={{ background: r.color }} />
          <strong>{r.value}</strong>
          <span className="lbl">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- line chart */

export function LineChart({
  data,
  x,
  series,
  height = 220,
  yFormat = (v) => String(v),
  xFormat = (v) => String(v),
  tipTitle,
  markers,
  band,
  refLines,
}: {
  data: Record<string, number>[];
  x: string;
  series: Series[];
  height?: number;
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  tipTitle?: (v: number) => ReactNode;
  markers?: { at: number; label: string }[];
  band?: { from: number; to: number; label?: string }[];
  refLines?: { value: number; label: string; tone?: "critical" | "muted" }[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 52, r: 12, t: 10, b: 24 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const xs = data.map((d) => d[x]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const ymax = Math.max(1e-9, ...data.flatMap((d) => series.map((s) => (Number.isFinite(d[s.key]) ? d[s.key] : 0))), ...(refLines ?? []).map((r) => r.value));
  const ticks = niceTicks(ymax);
  const top = ticks[ticks.length - 1];
  const sx = (v: number) => m.l + (x1 === x0 ? iw / 2 : ((v - x0) / (x1 - x0)) * iw);
  const sy = (v: number) => m.t + ih - (v / top) * ih;
  const xTicks = useMemo(() => {
    if (!data.length) return [];
    const n = Math.max(2, Math.min(7, Math.floor(iw / 110)));
    return Array.from({ length: n }, (_, i) => data[Math.round((i * (data.length - 1)) / (n - 1))][x]);
  }, [data, iw, x]);

  if (!data.length) return <div className="chart empty" ref={ref}>No data yet</div>;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    data.forEach((d, i) => {
      const dd = Math.abs(sx(d[x]) - px);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    setHover(best);
  };

  const h = hover != null ? data[hover] : null;
  return (
    <div className="chart" ref={ref}>
      <svg height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={series.map((s) => s.label).join(", ")}>
        {band?.map((b, i) => (
          <rect key={i} x={sx(Math.max(b.from, x0))} y={m.t} width={Math.max(2, sx(Math.min(b.to, x1)) - sx(Math.max(b.from, x0)))} height={ih} fill="var(--critical-wash)" />
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "baseline" : "gridline"} x1={m.l} x2={width - m.r} y1={sy(t)} y2={sy(t)} />
            <text className="axis-label" x={m.l - 8} y={sy(t) + 4} textAnchor="end">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} className="axis-label" x={sx(t)} y={height - 6} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>
            {xFormat(t)}
          </text>
        ))}
        {refLines?.map((rl) => (
          <g key={rl.label}>
            <line x1={m.l} x2={width - m.r} y1={sy(rl.value)} y2={sy(rl.value)} stroke={rl.tone === "critical" ? "var(--critical)" : "var(--ink-2)"} strokeWidth={1} strokeDasharray="4 4" />
            <text x={width - m.r - 4} y={sy(rl.value) - 5} textAnchor="end" className="axis-label" style={{ fill: rl.tone === "critical" ? "var(--critical-text)" : "var(--ink-2)" }}>
              {rl.label}
            </text>
          </g>
        ))}
        {markers?.map((mk, i) => (
          <g key={i}>
            <line x1={sx(mk.at)} x2={sx(mk.at)} y1={m.t} y2={m.t + ih} stroke="var(--critical)" strokeWidth={1} strokeDasharray="3 3" />
          </g>
        ))}
        {series.map((s) => (
          <path
            key={s.key}
            d={data
              .map((d, i) => {
                const v = d[s.key];
                if (v == null || !Number.isFinite(v)) return "";
                const prev = i > 0 ? data[i - 1][s.key] : null;
                const move = i === 0 || prev == null || !Number.isFinite(prev);
                return `${move ? "M" : "L"}${sx(d[x]).toFixed(1)},${sy(v).toFixed(1)}`;
              })
              .join("")}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {h && (
          <g>
            <line className="crosshair" x1={sx(h[x])} x2={sx(h[x])} y1={m.t} y2={m.t + ih} />
            {series
              .filter((s) => Number.isFinite(h[s.key]))
              .map((s) => (
                <circle key={s.key} cx={sx(h[x])} cy={sy(h[s.key])} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
          </g>
        )}
      </svg>
      {h && (
        <Tip
          x={sx(h[x])}
          y={m.t}
          width={width}
          title={tipTitle ? tipTitle(h[x]) : xFormat(h[x])}
          rows={series.map((s) => ({ color: s.color, label: s.label, value: Number.isFinite(h[s.key]) ? yFormat(h[s.key]) : "no output" }))}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- bar chart (stacked or grouped) */

export function BarChart({
  data,
  x,
  series,
  height = 220,
  mode = "stacked",
  yFormat = (v) => String(v),
  xFormat = (v) => String(v),
  tipTitle,
  highlight,
}: {
  data: Record<string, number>[];
  x: string;
  series: Series[];
  height?: number;
  mode?: "stacked" | "grouped";
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  tipTitle?: (v: number) => ReactNode;
  highlight?: (d: Record<string, number>) => boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 52, r: 8, t: 10, b: 24 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const totals = data.map((d) => (mode === "stacked" ? series.reduce((s, se) => s + Math.max(0, d[se.key] ?? 0), 0) : Math.max(...series.map((se) => d[se.key] ?? 0))));
  const ticks = niceTicks(Math.max(1e-9, ...totals));
  const top = ticks[ticks.length - 1];
  const sy = (v: number) => m.t + ih - (v / top) * ih;
  const slot = iw / Math.max(1, data.length);
  const gap = Math.min(10, slot * 0.25);
  const bw = Math.max(2, slot - gap);
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(iw / 64))));

  if (!data.length) return <div className="chart empty" ref={ref}>No data yet</div>;

  return (
    <div className="chart" ref={ref}>
      <svg height={height} onPointerLeave={() => setHover(null)} role="img" aria-label={series.map((s) => s.label).join(", ")}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "baseline" : "gridline"} x1={m.l} x2={width - m.r} y1={sy(t)} y2={sy(t)} />
            <text className="axis-label" x={m.l - 8} y={sy(t) + 4} textAnchor="end">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = m.l + i * slot + gap / 2;
          const dim = highlight && !highlight(d) ? 0.45 : 1;
          let acc = 0;
          const bars =
            mode === "stacked"
              ? series.map((s, k) => {
                  const v = Math.max(0, d[s.key] ?? 0);
                  const y = sy(acc + v);
                  const hgt = sy(acc) - y;
                  acc += v;
                  const topMost = k === series.length - 1 || series.slice(k + 1).every((n) => !(d[n.key] > 0));
                  return hgt > 0 ? (
                    <rect key={s.key} x={x0} y={y} width={bw} height={Math.max(0, hgt - (k > 0 ? 0 : 0) - (topMost ? 0 : 2))} rx={topMost ? Math.min(3, bw / 2) : 0} fill={s.color} opacity={dim} />
                  ) : null;
                })
              : series.map((s, k) => {
                  const w = (bw - 2 * (series.length - 1)) / series.length;
                  const v = Math.max(0, d[s.key] ?? 0);
                  return <rect key={s.key} x={x0 + k * (w + 2)} y={sy(v)} width={Math.max(1, w)} height={sy(0) - sy(v)} rx={Math.min(3, w / 2)} fill={s.color} opacity={dim} />;
                });
          return (
            <g key={i}>
              {hover === i && <rect x={m.l + i * slot} y={m.t} width={slot} height={ih} fill="var(--surface-2)" />}
              {bars}
              <rect
                x={m.l + i * slot}
                y={m.t}
                width={slot}
                height={ih}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                tabIndex={-1}
              />
              {i % labelEvery === 0 && (
                <text className="axis-label" x={x0 + bw / 2} y={height - 6} textAnchor="middle">
                  {xFormat(d[x])}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <Tip
          x={m.l + hover * slot + slot / 2}
          y={m.t}
          width={width}
          title={tipTitle ? tipTitle(data[hover][x]) : xFormat(data[hover][x])}
          rows={[...series].reverse().map((s) => ({ color: s.color, label: s.label, value: yFormat(data[hover][s.key] ?? 0) }))}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- risk strip */

const riskColor = (r: number) => (r >= 0.75 ? "var(--critical)" : r >= 0.5 ? "var(--serious)" : r >= 0.3 ? "var(--warning)" : r > 0.05 ? "color-mix(in srgb, var(--good) 45%, var(--surface-3))" : "var(--surface-3)");

export function RiskStrip({ values, title }: { values: { t: number; risk: number }[]; title: (t: number, r: number) => string }) {
  return (
    <div className="risk-strip" role="img" aria-label="Integrity risk per interval">
      {values.map((v) => (
        <i key={v.t} style={{ background: riskColor(v.risk) }} title={title(v.t, v.risk)} />
      ))}
    </div>
  );
}

export function RiskLegend() {
  return (
    <div className="legend tiny">
      <span><i className="key-box" style={{ background: "var(--surface-3)" }} />Clean</span>
      <span><i className="key-box" style={{ background: "var(--warning)" }} />Elevated ≥30%</span>
      <span><i className="key-box" style={{ background: "var(--serious)" }} />High ≥50%</span>
      <span><i className="key-box" style={{ background: "var(--critical)" }} />Critical ≥75%</span>
    </div>
  );
}
