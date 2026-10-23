import { sha256 as nobleSha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, concatBytes, hexToBytes as nobleHexToBytes, utf8ToBytes } from "@noble/hashes/utils";

export type Hex = `0x${string}`;

export const toHex = (bytes: Uint8Array): Hex => `0x${bytesToHex(bytes)}`;

export const fromHex = (hex: string): Uint8Array => nobleHexToBytes(hex.startsWith("0x") ? hex.slice(2) : hex);

export const utf8 = (s: string): Uint8Array => utf8ToBytes(s);

export const sha256 = (data: Uint8Array | string): Uint8Array =>
  nobleSha256(typeof data === "string" ? utf8ToBytes(data) : data);

export const keccak256 = (data: Uint8Array | string): Uint8Array =>
  keccak_256(typeof data === "string" ? utf8ToBytes(data) : data);

export const sha256Hex = (data: Uint8Array | string): Hex => toHex(sha256(data));
export const keccak256Hex = (data: Uint8Array | string): Hex => toHex(keccak256(data));

export const concat = (...parts: Uint8Array[]): Uint8Array => concatBytes(...parts);

/** Compare two byte strings without early exit. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Deterministic bytes32 id from a human readable id, e.g. "TR-STL-01" -> keccak256("TR-STL-01"). */
export const idToBytes32 = (id: string): Hex => keccak256Hex(`mizan:id:${id}`);

/** Short fingerprint for display: first 8 + last 6 hex chars. */
export const shortHash = (h: string, head = 10, tail = 6): string =>
  h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;
