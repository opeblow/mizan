/**
 * Isolation Forest (Liu, Ting & Zhou, ICDM 2008). Anomalies are few and different, so random axis-aligned
 * splits isolate them in fewer steps than normal points. Score s(x) = 2^(-E[h(x)] / c(psi)), in (0, 1];
 * values well above 0.5 indicate anomalies.
 * Deterministic: a seeded PRNG makes the same training data produce the same model, which matters when a
 * verifier asks why a window was flagged months later.
 */

type Node =
  | { kind: "leaf"; size: number }
  | { kind: "split"; feature: number; threshold: number; left: Node; right: Node };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EULER = 0.5772156649;
/** Average path length of an unsuccessful BST search over n points. */
export function cFactor(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + EULER) - (2 * (n - 1)) / n;
}

export class IsolationForest {
  private trees: Node[] = [];
  private psi = 0;
  readonly trainedOn: number;

  constructor(
    data: number[][],
    readonly nTrees = 100,
    sampleSize = 256,
    seed = 42,
  ) {
    if (data.length < 2) throw new Error("IsolationForest needs at least 2 samples");
    const rand = mulberry32(seed);
    this.psi = Math.min(sampleSize, data.length);
    this.trainedOn = data.length;
    const heightLimit = Math.ceil(Math.log2(this.psi));
    for (let t = 0; t < nTrees; t++) {
      const sample: number[][] = [];
      for (let i = 0; i < this.psi; i++) sample.push(data[Math.floor(rand() * data.length)]);
      this.trees.push(this.build(sample, 0, heightLimit, rand));
    }
  }

  private build(points: number[][], depth: number, limit: number, rand: () => number): Node {
    if (depth >= limit || points.length <= 1) return { kind: "leaf", size: points.length };
    const dims = points[0].length;
    // choose a feature that actually varies in this node
    const order = Array.from({ length: dims }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const feature of order) {
      let min = Infinity;
      let max = -Infinity;
      for (const p of points) {
        if (p[feature] < min) min = p[feature];
        if (p[feature] > max) max = p[feature];
      }
      if (max - min < 1e-12) continue;
      const threshold = min + rand() * (max - min);
      const left: number[][] = [];
      const right: number[][] = [];
      for (const p of points) (p[feature] < threshold ? left : right).push(p);
      return {
        kind: "split",
        feature,
        threshold,
        left: this.build(left, depth + 1, limit, rand),
        right: this.build(right, depth + 1, limit, rand),
      };
    }
    return { kind: "leaf", size: points.length };
  }

  private pathLength(x: number[], node: Node, depth: number): number {
    if (node.kind === "leaf") return depth + cFactor(node.size);
    return this.pathLength(x, x[node.feature] < node.threshold ? node.left : node.right, depth + 1);
  }

  score(x: number[]): number {
    let total = 0;
    for (const t of this.trees) total += this.pathLength(x, t, 0);
    const mean = total / this.trees.length;
    return Math.pow(2, -mean / cFactor(this.psi));
  }
}
