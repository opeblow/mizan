export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation, scaled to be consistent with the standard deviation for normal data. */
export function mad(xs: number[], med = median(xs)): number {
  return 1.4826 * median(xs.map((x) => Math.abs(x - med)));
}

/** Robust z-score: how many "robust standard deviations" x is away from the median. */
export function robustZ(x: number, med: number, madValue: number): number {
  if (!Number.isFinite(madValue) || madValue < 1e-12) return 0;
  return (x - med) / madValue;
}

/** Noisy-OR: probability that at least one independent detector is right. */
export const noisyOr = (scores: number[]): number => 1 - scores.reduce((p, s) => p * (1 - Math.max(0, Math.min(1, s))), 1);
