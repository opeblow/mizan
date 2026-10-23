import { concat, fromHex, keccak256, toHex, type Hex } from "./hash";

/**
 * Merkle tree compatible with OpenZeppelin's MerkleProof.verify:
 * - pairs are hashed in sorted order (commutative keccak256)
 * - an odd node at the end of a layer is promoted unchanged
 * - leaves are built by MRVLedger.leafOf (double hashed)
 */

function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
  return compare(a, b) <= 0 ? keccak256(concat(a, b)) : keccak256(concat(b, a));
}

/** Mirrors MRVLedger.leafOf: keccak256(bytes.concat(keccak256(abi.encode(payloadHash, signatureHash)))) */
export function leafOf(payloadHash: Hex, signatureHash: Hex): Hex {
  const encoded = concat(fromHex(payloadHash), fromHex(signatureHash)); // abi.encode(bytes32, bytes32)
  return toHex(keccak256(keccak256(encoded)));
}

export class MerkleTree {
  readonly layers: Uint8Array[][];

  constructor(leaves: Hex[]) {
    if (leaves.length === 0) throw new Error("MerkleTree needs at least one leaf");
    const first = leaves.map(fromHex);
    this.layers = [first];
    let layer = first;
    while (layer.length > 1) {
      const next: Uint8Array[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        next.push(i + 1 < layer.length ? hashPair(layer[i], layer[i + 1]) : layer[i]);
      }
      this.layers.push(next);
      layer = next;
    }
  }

  get root(): Hex {
    return toHex(this.layers[this.layers.length - 1][0]);
  }

  proof(index: number): Hex[] {
    if (index < 0 || index >= this.layers[0].length) throw new RangeError(`leaf index ${index} out of range`);
    const proof: Hex[] = [];
    let i = index;
    for (let l = 0; l < this.layers.length - 1; l++) {
      const layer = this.layers[l];
      const sibling = i % 2 === 0 ? i + 1 : i - 1;
      if (sibling < layer.length) proof.push(toHex(layer[sibling]));
      i = Math.floor(i / 2);
    }
    return proof;
  }
}

export function verifyProof(leaf: Hex, proof: Hex[], root: Hex): boolean {
  let node = fromHex(leaf);
  for (const p of proof) node = hashPair(node, fromHex(p));
  return toHex(node).toLowerCase() === root.toLowerCase();
}
