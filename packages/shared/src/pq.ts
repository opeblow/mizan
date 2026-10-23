import { ml_dsa44 } from "@noble/post-quantum/ml-dsa";
import { randomBytes } from "@noble/hashes/utils";
import { fromHex, keccak256Hex, toHex, type Hex } from "./hash";
import { canonicalBytes, type Reading, type SignedReading } from "./reading";

/**
 * ML-DSA-44 (NIST FIPS 204, CRYSTALS-Dilithium lineage). Security category 2.
 * Public key 1,312 bytes, signature 2,420 bytes. Chosen for meters because verification is fast and
 * the scheme stays secure against an adversary with a large quantum computer, so readings signed today
 * cannot be forged retroactively when CBAM disputes are reopened years later.
 */
export const PQ_SCHEME = "ML-DSA-44";
export const PQ_SCHEME_ID = 1; // matches MizanRegistry.SIG_ML_DSA_44

export interface PqKeyPair {
  publicKey: Hex;
  secretKey: Hex;
}

export function generateKeyPair(seed?: Uint8Array): PqKeyPair {
  const keys = ml_dsa44.keygen(seed ?? randomBytes(32));
  return { publicKey: toHex(keys.publicKey), secretKey: toHex(keys.secretKey) };
}

/** On-chain commitment to a device key, stored in MizanRegistry. */
export const publicKeyHash = (publicKey: Hex): Hex => keccak256Hex(fromHex(publicKey));

export function signReading(reading: Reading, secretKey: Hex): SignedReading {
  const sig = ml_dsa44.sign(fromHex(secretKey), canonicalBytes(reading));
  return { ...reading, signature: toHex(sig) };
}

export function verifyReadingSignature(reading: SignedReading, publicKey: Hex): boolean {
  try {
    return ml_dsa44.verify(fromHex(publicKey), canonicalBytes(reading), fromHex(reading.signature));
  } catch {
    return false;
  }
}

export function signBytes(message: Uint8Array, secretKey: Hex): Hex {
  return toHex(ml_dsa44.sign(fromHex(secretKey), message));
}

export function verifyBytes(message: Uint8Array, signature: Hex, publicKey: Hex): boolean {
  try {
    return ml_dsa44.verify(fromHex(publicKey), message, fromHex(signature));
  } catch {
    return false;
  }
}
