// utils/costTruth.ts
//
// Cost Truth — compares a contractor's learned rate for a trade+unit against the
// cross-contractor regional benchmark (public.cost_benchmark_stats RPC). Pure +
// tested; the network/DB lives in hooks/useCostBenchmark.
//
// The benchmark is real paid rates, not catalog averages — and it's k-anonymized
// (median only when >= 5 contributors), so this engine models the "still building"
// state honestly instead of faking a number.

export const BENCHMARK_FLOOR = 5;

export type BenchmarkVerdict = 'below' | 'in_range' | 'above' | 'insufficient';

export interface BenchmarkStats {
  median: number | null;
  p25: number | null;
  p75: number | null;
  n: number;
}

export interface BenchmarkComparison {
  verdict: BenchmarkVerdict;
  /** Your rate vs the median, signed fraction (0.12 = 12% above). null when insufficient. */
  deltaPct: number | null;
  median: number | null;
  n: number;
  /** Contributors still needed to unlock the benchmark (0 once unlocked). */
  needed: number;
}

/**
 * Compare your learned unit rate to the regional benchmark.
 *  - below     : cheaper than the middle half of the market (< p25)
 *  - in_range  : within the middle half (p25..p75)
 *  - above     : pricier than the middle half (> p75) — worth a look
 *  - insufficient : fewer than BENCHMARK_FLOOR contributors; median withheld
 */
export function compareToBenchmark(yourRate: number, stats: BenchmarkStats): BenchmarkComparison {
  const n = stats?.n ?? 0;
  if (stats?.median == null || n < BENCHMARK_FLOOR) {
    return { verdict: 'insufficient', deltaPct: null, median: null, n, needed: Math.max(0, BENCHMARK_FLOOR - n) };
  }
  const median = stats.median;
  const p25 = stats.p25 ?? median;
  const p75 = stats.p75 ?? median;
  const deltaPct = median > 0 ? (yourRate - median) / median : 0;
  const verdict: BenchmarkVerdict = yourRate < p25 ? 'below' : yourRate > p75 ? 'above' : 'in_range';
  return { verdict, deltaPct, median, n, needed: 0 };
}

/** Short human label, e.g. "+12% vs regional median" or "building · 3 of 5". */
export function benchmarkLabel(c: BenchmarkComparison): string {
  if (c.verdict === 'insufficient') {
    return `Benchmark building · ${c.n} of ${BENCHMARK_FLOOR}`;
  }
  const pct = Math.round((c.deltaPct ?? 0) * 100);
  if (Math.abs(pct) < 1) return `On the regional median · ${c.n} pros`;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct}% vs regional median · ${c.n} pros`;
}
