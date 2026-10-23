import { Sector } from "./catalog";

/**
 * Share of embedded emissions that carries a CBAM charge each year, mirroring the phase-out of EU ETS free
 * allocation for CBAM sectors (Directive 2003/87/EC Art. 10a(1a) as amended by Directive (EU) 2023/959).
 */
export const CBAM_PHASE_IN: Record<number, number> = {
  2026: 0.025,
  2027: 0.05,
  2028: 0.1,
  2029: 0.225,
  2030: 0.485,
  2031: 0.61,
  2032: 0.735,
  2033: 0.86,
  2034: 1.0,
};

export const CBAM_YEARS = Object.keys(CBAM_PHASE_IN).map(Number);

/** Default EU allowance price assumption, EUR per t CO2e. Overridable everywhere it is used. */
export const DEFAULT_EUA_PRICE = 75;

/**
 * Illustrative default specific embedded emissions (t CO2e per t) an importer falls back to when actual
 * data is missing or failed verification. Replace with the values in the Commission implementing act for the
 * country of origin; the point they make in the product is that unverified data is expensive.
 */
export const ILLUSTRATIVE_DEFAULT_SEE: Record<number, number> = {
  [Sector.Cement]: 0.89,
  [Sector.IronSteel]: 1.92,
  [Sector.Aluminium]: 1.65,
};

/** Mark-up the Commission applies on default values to reward real data (illustrative schedule). */
export const DEFAULT_VALUE_MARKUP: Record<number, number> = { 2026: 0.1, 2027: 0.2, 2028: 0.3 };

export interface ExposureInput {
  year: number;
  exportsT: number; // tonnes of product shipped to the EU in the year
  seeT: number; // specific embedded emissions, t CO2e per t product
  euaPrice: number; // EUR per t
  originCarbonPricePerT: number; // EUR per t CO2e effectively paid at origin
}

export interface ExposureResult {
  year: number;
  phaseIn: number;
  embeddedT: number;
  chargedT: number;
  grossEur: number;
  deductionEur: number;
  netEur: number;
}

/**
 * Simplified CBAM cost: charged emissions = phase-in share x embedded emissions. Deduction for carbon price
 * paid at origin is capped at the gross obligation. Ignores benchmark-specific free allocation adjustments,
 * which are installation and product specific.
 */
export function cbamExposure(i: ExposureInput): ExposureResult {
  const phaseIn = CBAM_PHASE_IN[i.year] ?? (i.year > 2034 ? 1 : 0);
  const embeddedT = i.exportsT * i.seeT;
  const chargedT = embeddedT * phaseIn;
  const grossEur = chargedT * i.euaPrice;
  const deductionEur = Math.min(grossEur, chargedT * Math.min(i.originCarbonPricePerT, i.euaPrice));
  return { year: i.year, phaseIn, embeddedT, chargedT, grossEur, deductionEur, netEur: grossEur - deductionEur };
}
