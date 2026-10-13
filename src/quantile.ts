/** Quantiles of sorted numbers, shared by the statistics that need them (`BoxStats`, `Density`). */

/** The p-th quantile of ascending `v`, by the inclusive rule (rank p(n-1)) or the exclusive one (rank p(n+1)-1, held to the ends). */
export function quantile(v: ArrayLike<number>, p: number, method: 'inclusive' | 'exclusive' = 'inclusive'): number {
  const n = v.length;
  if (n === 0) return NaN;
  const h = method === 'exclusive' ? Math.min(n - 1, Math.max(0, p * (n + 1) - 1)) : p * (n - 1);
  const lo = Math.floor(h), hi = Math.ceil(h);
  // oxlint-disable-next-line typescript/no-non-null-assertion -- in range: the index comes from a loop bound or a length checked in the same function
  return v[lo]! + (h - lo) * (v[hi]! - v[lo]!);
}
