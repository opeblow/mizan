import { Sector } from "./catalog";
import type { MetricCode } from "./reading";

/**
 * Emission factors. Every factor is configurable per deployment; the defaults below are the values used
 * in the demo and their sources are listed in docs/IMPACT.md.
 */
export const FACTORS = {
  /** Türkiye national grid, combined margin, kg CO2 per kWh. */
  gridKgPerKwh: 0.442,
  /** IPCC 2006: 56.1 t CO2/TJ x NCV 34.0 MJ/Nm3. */
  naturalGasKgPerNm3: 1.907,
  /** IPCC 2006: 97.5 t CO2/TJ x NCV 32.5 GJ/t. */
  petcokeKgPerKg: 3.169,
  /** Stoichiometric 44/12 for injected carbon, conservative 100% carbon content. */
  chargeCarbonKgPerKg: 3.664,
  /** WBCSD-CSI default process emissions from calcination, per kg clinker. */
  clinkerCalcinationKgPerKg: 0.525,
} as const;

export type MetricTotals = Partial<Record<MetricCode, number>>;

export interface EmissionsResult {
  directKg: number;
  indirectKg: number;
  productionKg: number;
  /** Direct breakdown by source, kg CO2e. */
  sources: { source: string; kg: number }[];
}

export const productionMetricFor = (sector: Sector): MetricCode =>
  sector === Sector.Cement ? "cement_output_kg" : sector === Sector.IronSteel ? "steel_output_kg" : "aluminium_output_kg";

/** Emissions of one interval or one window from metered totals (values in natural units, not milli). */
export function computeEmissions(sector: Sector, t: MetricTotals): EmissionsResult {
  const sources: { source: string; kg: number }[] = [];
  const add = (source: string, kg: number) => {
    if (kg > 0) sources.push({ source, kg });
  };
  add("Natural gas combustion", (t.natural_gas_nm3 ?? 0) * FACTORS.naturalGasKgPerNm3);
  add("Petcoke combustion", (t.petcoke_kg ?? 0) * FACTORS.petcokeKgPerKg);
  add("Charge carbon oxidation", (t.charge_carbon_kg ?? 0) * FACTORS.chargeCarbonKgPerKg);
  add("Clinker calcination", (t.clinker_output_kg ?? 0) * FACTORS.clinkerCalcinationKgPerKg);
  const directKg = sources.reduce((s, x) => s + x.kg, 0);
  const indirectKg = (t.electricity_kwh ?? 0) * FACTORS.gridKgPerKwh;
  const productionKg = t[productionMetricFor(sector)] ?? 0;
  return { directKg, indirectKg, productionKg, sources };
}

/** CBAM Annex II: indirect emissions are part of embedded emissions for cement and fertilisers only. */
export const cbamCountsIndirect = (sector: Sector): boolean =>
  sector === Sector.Cement || sector === Sector.Fertilisers;

export const cbamRelevantKg = (sector: Sector, e: { directKg: number; indirectKg: number }): number =>
  e.directKg + (cbamCountsIndirect(sector) ? e.indirectKg : 0);

/**
 * Physical plausibility envelopes per tonne of product. Values outside them are physically impossible or
 * point to a broken or manipulated meter. Derived from BREF documents and sector benchmarks.
 */
export interface IntensityBound {
  ratio: string;
  numerator: MetricCode;
  denominator: MetricCode;
  min: number;
  max: number;
  typical: number;
  unit: string;
}

export const INTENSITY_BOUNDS: Record<number, IntensityBound[]> = {
  [Sector.Cement]: [
    { ratio: "Kiln fuel per t clinker", numerator: "petcoke_kg", denominator: "clinker_output_kg", min: 0.085, max: 0.13, typical: 0.102, unit: "kg/kg" },
    { ratio: "Electricity per t cement", numerator: "electricity_kwh", denominator: "cement_output_kg", min: 0.08, max: 0.14, typical: 0.105, unit: "kWh/kg" },
    { ratio: "Clinker-to-cement ratio", numerator: "clinker_output_kg", denominator: "cement_output_kg", min: 0.55, max: 1.08, typical: 0.76, unit: "kg/kg" },
  ],
  [Sector.IronSteel]: [
    { ratio: "Electricity per t steel", numerator: "electricity_kwh", denominator: "steel_output_kg", min: 0.33, max: 0.65, typical: 0.43, unit: "kWh/kg" },
    { ratio: "Natural gas per t steel", numerator: "natural_gas_nm3", denominator: "steel_output_kg", min: 0.012, max: 0.06, typical: 0.025, unit: "Nm³/kg" },
    { ratio: "Charge carbon per t steel", numerator: "charge_carbon_kg", denominator: "steel_output_kg", min: 0.005, max: 0.025, typical: 0.012, unit: "kg/kg" },
  ],
  [Sector.Aluminium]: [
    { ratio: "Natural gas per t aluminium", numerator: "natural_gas_nm3", denominator: "aluminium_output_kg", min: 0.05, max: 0.12, typical: 0.075, unit: "Nm³/kg" },
    { ratio: "Electricity per t aluminium", numerator: "electricity_kwh", denominator: "aluminium_output_kg", min: 0.15, max: 0.45, typical: 0.26, unit: "kWh/kg" },
  ],
};
