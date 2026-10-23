import type { MetricCode } from "./reading";

/** Same order as MizanRegistry.Sector on-chain. */
export enum Sector {
  Cement = 0,
  IronSteel = 1,
  Aluminium = 2,
  Fertilisers = 3,
  Hydrogen = 4,
  Electricity = 5,
}

export const SECTOR_LABEL: Record<Sector, string> = {
  [Sector.Cement]: "Cement",
  [Sector.IronSteel]: "Iron & steel",
  [Sector.Aluminium]: "Aluminium",
  [Sector.Fertilisers]: "Fertilisers",
  [Sector.Hydrogen]: "Hydrogen",
  [Sector.Electricity]: "Electricity",
};

export interface MetricDef {
  code: MetricCode;
  label: string;
  unit: string;
  role: "input" | "output" | "intermediate";
}

export const METRICS: Record<MetricCode, MetricDef> = {
  electricity_kwh: { code: "electricity_kwh", label: "Grid electricity", unit: "kWh", role: "input" },
  natural_gas_nm3: { code: "natural_gas_nm3", label: "Natural gas", unit: "Nm³", role: "input" },
  charge_carbon_kg: { code: "charge_carbon_kg", label: "Charge carbon", unit: "kg", role: "input" },
  petcoke_kg: { code: "petcoke_kg", label: "Petroleum coke", unit: "kg", role: "input" },
  clinker_output_kg: { code: "clinker_output_kg", label: "Clinker produced", unit: "kg", role: "intermediate" },
  steel_output_kg: { code: "steel_output_kg", label: "Liquid steel", unit: "kg", role: "output" },
  cement_output_kg: { code: "cement_output_kg", label: "Cement dispatched", unit: "kg", role: "output" },
  aluminium_output_kg: { code: "aluminium_output_kg", label: "Aluminium cast", unit: "kg", role: "output" },
};

export interface DeviceDef {
  id: string;
  facilityId: string;
  metric: MetricCode;
  label: string;
  hardware: string;
  accuracyClass: string;
}

export interface FacilityDef {
  id: string;
  name: string;
  legalName: string;
  city: string;
  region: string;
  countryCode: number; // ISO 3166-1 numeric
  sector: Sector;
  process: string;
  product: { name: string; cnCode: number; cnLabel: string };
  productionMetric: MetricCode;
  annualCapacityT: number;
  devices: DeviceDef[];
}

const dev = (
  facilityId: string,
  n: string,
  metric: MetricCode,
  label: string,
  hardware: string,
  accuracyClass: string,
): DeviceDef => ({ id: `${facilityId}:${n}`, facilityId, metric, label, hardware, accuracyClass });

/**
 * Demo tenants. Companies are fictional; process data follow published sector averages so the
 * numbers a judge sees are physically plausible.
 */
export const FACILITIES: FacilityDef[] = [
  {
    id: "TR-CEM-01",
    name: "Ege Clinker & Cement",
    legalName: "Ege Klinker ve Çimento A.Ş. (fictional)",
    city: "Aliağa, İzmir",
    region: "Aegean",
    countryCode: 792,
    sector: Sector.Cement,
    process: "Dry-process rotary kiln with 5-stage preheater",
    product: { name: "Portland-composite cement CEM II/B", cnCode: 25232900, cnLabel: "2523 29 00 · Portland cement" },
    productionMetric: "cement_output_kg",
    annualCapacityT: 1_150_000,
    devices: [
      dev("TR-CEM-01", "KILN-FEED", "petcoke_kg", "Kiln fuel feeder (petcoke)", "Loss-in-weight gravimetric feeder", "±0.5%"),
      dev("TR-CEM-01", "CLINKER", "clinker_output_kg", "Clinker belt scale", "Belt weigher, 4 load cells", "±0.5%"),
      dev("TR-CEM-01", "DISPATCH", "cement_output_kg", "Dispatch weighbridge", "OIML R76 weighbridge", "III"),
      dev("TR-CEM-01", "GRID", "electricity_kwh", "Main incomer meter", "IEC 62053-22 revenue meter", "0.2S"),
    ],
  },
  {
    id: "TR-STL-01",
    name: "Anadolu EAF Steel",
    legalName: "Anadolu Elektrik Ark Çelik A.Ş. (fictional)",
    city: "İskenderun, Hatay",
    region: "Mediterranean",
    countryCode: 792,
    sector: Sector.IronSteel,
    process: "Scrap-based electric arc furnace with ladle furnace",
    product: { name: "Steel billets", cnCode: 72071114, cnLabel: "7207 11 14 · Semi-finished steel, square section" },
    productionMetric: "steel_output_kg",
    annualCapacityT: 720_000,
    devices: [
      dev("TR-STL-01", "EAF-GRID", "electricity_kwh", "EAF transformer meter", "IEC 62053-22 revenue meter", "0.2S"),
      dev("TR-STL-01", "NG-FLOW", "natural_gas_nm3", "Burner natural gas flow", "Ultrasonic gas meter", "±1.0%"),
      dev("TR-STL-01", "CARBON", "charge_carbon_kg", "Charge carbon injector", "Pneumatic dosing scale", "±1.0%"),
      dev("TR-STL-01", "CASTER", "steel_output_kg", "Caster billet scale", "Crane scale, OIML R76", "III"),
    ],
  },
  {
    id: "TR-ALU-01",
    name: "Marmara Aluminium Remelt",
    legalName: "Marmara Alüminyum Döküm A.Ş. (fictional)",
    city: "Dilovası, Kocaeli",
    region: "Marmara",
    countryCode: 792,
    sector: Sector.Aluminium,
    process: "Secondary remelting, gas-fired reverberatory furnaces",
    product: { name: "Unwrought aluminium alloy ingots", cnCode: 76012020, cnLabel: "7601 20 20 · Unwrought aluminium alloys" },
    productionMetric: "aluminium_output_kg",
    annualCapacityT: 140_000,
    devices: [
      dev("TR-ALU-01", "NG-FLOW", "natural_gas_nm3", "Furnace natural gas flow", "Ultrasonic gas meter", "±1.0%"),
      dev("TR-ALU-01", "GRID", "electricity_kwh", "Plant incomer meter", "IEC 62053-22 revenue meter", "0.5S"),
      dev("TR-ALU-01", "CASTING", "aluminium_output_kg", "Ingot casting scale", "Platform scale, OIML R76", "III"),
    ],
  },
];

export const facilityById = (id: string): FacilityDef | undefined => FACILITIES.find((f) => f.id === id);
