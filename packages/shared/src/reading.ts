import { fromHex, sha256Hex, toHex, sha256, utf8, type Hex } from "./hash";
import { leafOf } from "./merkle";

/**
 * A single meter reading. Values are integers in milli-units so the signed bytes are identical in every
 * language and on every platform (no floating point in signed payloads).
 */
export interface Reading {
  deviceId: string;
  facilityId: string;
  seq: number; // strictly increasing per device, blocks replay
  ts: number; // unix seconds, end of the measurement interval
  metric: MetricCode;
  valueMilli: number; // value * 1000, integer
}

export interface SignedReading extends Reading {
  signature: Hex; // ML-DSA-44 signature over canonicalReading(reading)
}

export type MetricCode =
  | "electricity_kwh"
  | "natural_gas_nm3"
  | "charge_carbon_kg"
  | "steel_output_kg"
  | "petcoke_kg"
  | "clinker_output_kg"
  | "cement_output_kg"
  | "aluminium_output_kg";

export const READING_DOMAIN = "mizan.reading.v1";

/** Domain-separated, delimiter-safe encoding. Ids are validated to contain no '|'. */
export function canonicalReading(r: Reading): string {
  for (const v of [r.deviceId, r.facilityId, r.metric]) {
    if (v.includes("|")) throw new Error(`invalid character in "${v}"`);
  }
  if (!Number.isSafeInteger(r.seq) || r.seq < 0) throw new Error("seq must be a non-negative integer");
  if (!Number.isSafeInteger(r.ts) || r.ts <= 0) throw new Error("ts must be a positive integer");
  if (!Number.isSafeInteger(r.valueMilli)) throw new Error("valueMilli must be an integer");
  return [READING_DOMAIN, r.deviceId, r.facilityId, r.seq, r.ts, r.metric, r.valueMilli].join("|");
}

export const canonicalBytes = (r: Reading): Uint8Array => utf8(canonicalReading(r));

export const payloadHash = (r: Reading): Hex => sha256Hex(canonicalReading(r));

export const signatureHash = (signatureHex: Hex | string): Hex => toHex(sha256(fromHex(signatureHex)));

export const readingLeaf = (r: SignedReading): Hex => leafOf(payloadHash(r), signatureHash(r.signature));
