import { Sector, type FacilityDef, type MetricCode } from "@mizan/shared";

/**
 * Process models for the three demo installations. Each interval's values come from published sector
 * intensities with realistic operating patterns:
 *  - Turkish industrial time-of-use tariffs make EAFs and cement mills shift load away from the 17:00-22:00 peak
 *  - the EAF stops for maintenance on Sunday mornings
 *  - the remelter runs reduced weekend shifts
 * Noise is deterministic (seeded) so a reset demo reproduces the same history.
 */

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => {
    const u = Math.max(next(), 1e-12);
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { next, gauss };
}

const localHour = (ts: number) => (new Date(ts * 1000).getUTCHours() + 3) % 24;
const localDay = (ts: number) => new Date((ts + 3 * 3600) * 1000).getUTCDay(); // 0 = Sunday

export type Values = Partial<Record<MetricCode, number>>;

export function simulateInterval(f: FacilityDef, ts: number, intervalSeconds: number, r: ReturnType<typeof rng>): Values {
  const h = intervalSeconds / 3600;
  const hour = localHour(ts);
  const day = localDay(ts);
  const n = (sd: number) => 1 + r.gauss() * sd;
  const peak = hour >= 17 && hour < 22;
  const night = hour >= 22 || hour < 6;

  if (f.sector === Sector.Cement) {
    // kiln runs continuously; cement mills shift to night tariff
    const clinkerT = 100 * h * n(0.025);
    const millFactor = peak ? 0.86 : night ? 1.1 : 1.0;
    const cementT = (clinkerT / 0.76) * millFactor * n(0.03);
    return {
      clinker_output_kg: clinkerT * 1000,
      petcoke_kg: clinkerT * 1000 * 0.102 * n(0.02),
      cement_output_kg: cementT * 1000,
      electricity_kwh: cementT * 1000 * 0.105 * n(0.03),
    };
  }

  if (f.sector === Sector.IronSteel) {
    const maintenance = day === 0 && hour >= 6 && hour < 14;
    if (maintenance) {
      return { steel_output_kg: 0, electricity_kwh: 1800 * h * n(0.05), natural_gas_nm3: 40 * h * n(0.1), charge_carbon_kg: 0 };
    }
    const load = peak ? 0.42 : night ? 1.08 : 1.0;
    const steelT = 92 * h * load * n(0.07);
    return {
      steel_output_kg: steelT * 1000,
      electricity_kwh: steelT * 1000 * 0.43 * n(0.035),
      natural_gas_nm3: steelT * 1000 * 0.025 * n(0.05),
      charge_carbon_kg: steelT * 1000 * 0.012 * n(0.07),
    };
  }

  // secondary aluminium remelt
  const weekend = day === 0 || day === 6;
  const load = weekend ? 0.55 : night ? 0.8 : 1.0;
  const alT = 17 * h * load * n(0.05);
  return {
    aluminium_output_kg: alT * 1000,
    natural_gas_nm3: alT * 1000 * 0.075 * n(0.04),
    electricity_kwh: alT * 1000 * 0.26 * n(0.04),
  };
}

/** Rounds to integer milli-units for signing. */
export const toMilli = (v: number) => Math.max(0, Math.round(v * 1000));
