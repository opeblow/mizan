const nf = (d: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d });

export const fmt = (n: number | null | undefined, d = 0) => (n == null || !Number.isFinite(n) ? "–" : nf(d).format(n));

/** Compact tonnes: 1,234 t / 12.3 kt / 1.2 Mt */
export function tonnes(t: number | null | undefined, d = 1) {
  if (t == null || !Number.isFinite(t)) return "–";
  const a = Math.abs(t);
  if (a >= 1e6) return `${fmt(t / 1e6, d)} Mt`;
  if (a >= 1e4) return `${fmt(t / 1e3, d)} kt`;
  if (a >= 100) return `${fmt(t, 0)} t`;
  return `${fmt(t, d)} t`;
}

export function eur(v: number | null | undefined, compact = true) {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  if (compact && a >= 1e6) return `€${fmt(v / 1e6, 2)}m`;
  if (compact && a >= 1e4) return `€${fmt(v / 1e3, 0)}k`;
  return `€${fmt(v, 0)}`;
}

export const pct = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "–" : `${fmt(v * 100, d)}%`);

const TZ = "Europe/Istanbul";
export const dateTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString("en-GB", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
export const dateOnly = (ts: number) => new Date(ts * 1000).toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" });
export const timeOnly = (ts: number) => new Date(ts * 1000).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
export const dayHour = (ts: number) => new Date(ts * 1000).toLocaleString("en-GB", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit" }) + "h";

export function period(start: number, end: number) {
  return `${dateTime(start)} – ${timeOnly(end)}`;
}

export function ago(ts: number | null | undefined) {
  if (!ts) return "–";
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return `${Math.max(0, s)} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const short = (h: string | null | undefined, head = 8, tail = 6) => (!h ? "–" : h.length <= head + tail + 3 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`);

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

export const METRIC_UNIT: Record<string, string> = {
  electricity_kwh: "kWh",
  natural_gas_nm3: "Nm³",
  charge_carbon_kg: "kg",
  petcoke_kg: "kg",
  clinker_output_kg: "kg",
  steel_output_kg: "kg",
  cement_output_kg: "kg",
  aluminium_output_kg: "kg",
};
export const METRIC_LABEL: Record<string, string> = {
  electricity_kwh: "Electricity",
  natural_gas_nm3: "Natural gas",
  charge_carbon_kg: "Charge carbon",
  petcoke_kg: "Petcoke",
  clinker_output_kg: "Clinker",
  steel_output_kg: "Liquid steel",
  cement_output_kg: "Cement",
  aluminium_output_kg: "Aluminium",
};
