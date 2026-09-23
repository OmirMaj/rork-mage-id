// hooks/useCostBenchmark.ts
//
// Powers Cost Truth: (a) contributes the contractor's own MEASURED rates to the
// cross-contractor benchmark (fire-and-forget, one call per trade+unit through
// the contribute_benchmark_rate RPC; a rate he merely stated is never
// sent, see isPublishableRate), and (b) would fetch the aggregate stats via
// the cost_benchmark_stats RPC — see MARKET_BENCHMARK_PUBLISHED: today it does
// not. The pure compare logic lives in utils/costTruth.
//
// WHAT THE SERVER ENFORCES (20260923180000) — and no more than that:
//   • clients cannot write cost_benchmark_samples; the RPC stamps the row as
//     the caller's, region 'US', a lower-cased key and a price in 0..1,000,000;
//   • raw rows are readable only by their owner (RLS SELECT-own);
//   • NO AGGREGATE IS PUBLISHED. cost_benchmark_stats and public_cost_index
//     return no rows. Every market figure computed from rates contractors
//     POST can be probed by the poster: k-anonymity fell to one extra
//     account, and a 5% rounding grid fell to a threshold search (move your
//     own rate until a published quartile flips; the flip point solves a
//     neighbour's price to the cent). So nothing of anyone's leaves the
//     server — that is the one rule that holds while signup is open.
// What it gives up: the "vs the market" chip and the public index stay empty
// until a later wave derives each rate on the server from recorded job-cost
// actuals (not a posted number). Contributions and the opt-in are still
// stored so that wave starts from the contractor's recorded choice.
//
// Public Price Index opt-in (#79): stored ONCE per account and read / written
// through RPCs that return the stored value, so the switch shows what the
// server kept — never an optimistic flip over an update that matched 0 rows.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { BenchmarkStats } from '@/utils/costTruth';

export interface BenchmarkInput {
  trade: string;
  unit: string;
  personalRate: number;
  /**
   * Provenance of the rate (utils/costDatabase CostBookEntry). ONLY 'earned'
   * is ever published — see isPublishableRate below. Optional so a caller
   * that only wants to READ the benchmark can omit it; such a caller
   * contributes nothing, which is the safe default.
   */
  provenance?: 'earned' | 'seeded' | 'mixed';
  /** Distinct measured jobs behind the rate. Zero means nothing measured it. */
  jobCount?: number;
}

/**
 * May this rate leave the tenant and be aggregated into the cross-contractor
 * index?
 *
 * THE BREACH THIS CLOSES. app/cost-database built its inputs from db.entries
 * with no provenance filter, and the upsert below is unconditional, so a
 * contractor who opted into the Public Price Index published rates he had
 * merely TYPED (utils/costSeedCore seeds) as if they were paid rates — into an
 * index utils/costTruth describes as "real paid rates, not catalog averages"
 * and every other contractor reads back as a benchmark. The seed firewall is
 * enforced at every surface that DISPLAYS a rate; this is the one path where
 * the breach leaves the device and cannot be taken back. It is checked here as
 * well as at the call site on purpose: a future screen that forgets the filter
 * must not be able to leak.
 */
function isPublishableRate(e: BenchmarkInput): boolean {
  if (!(e.personalRate > 0)) return false;
  // An input with no provenance stamp is not provably measured. Refuse it.
  if (e.provenance !== 'earned') return false;
  return (e.jobCount ?? 0) >= 1;
}

const MAX_KEYS = 40; // cap RPC fan-out on very large price books

/**
 * Is a cross-contractor market figure published at all? FALSE, and it must
 * stay false while the only source is rates contractors post: the server
 * returns no rows (20260923180000, #84), so asking would be up to 40 wasted
 * round trips per open that can only come back empty. Flip it only together
 * with a server that derives rates from recorded actuals.
 */
export const MARKET_BENCHMARK_PUBLISHED: boolean = false;

/** The one line the price book shows instead of a market chip (#84). */
export const MARKET_BENCHMARK_WITHHELD_COPY =
  "Market comparison isn't shown yet. A market rate built from numbers contractors post can be worked back to one contractor's exact price, so MAGE ID publishes none until rates are computed from logged job costs on our servers.";

/** What the account's Public Price Index switch reads, as the SERVER stored it. */
export interface PublicIndexState {
  optIn: boolean;
  /** Measured rates this account has on file in the benchmark (0 = nothing to publish yet). */
  ratesOnFile: number;
}

/** Parse the jsonb that get_/set_benchmark_public_opt_in return. Null when it is not that shape. */
export function parsePublicIndexState(data: unknown): PublicIndexState | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as { public_index_opt_in?: unknown; rates_on_file?: unknown };
  if (typeof d.public_index_opt_in !== 'boolean') return null;
  const n = Number(d.rates_on_file);
  return { optIn: d.public_index_opt_in, ratesOnFile: Number.isFinite(n) && n >= 0 ? n : 0 };
}

/**
 * One cost_benchmark_stats row → the chip's stats, or null.
 *
 * Unused while MARKET_BENCHMARK_PUBLISHED is false (the server returns no
 * rows). Kept for the day it reopens: a row whose median or n is NULL means
 * "withheld", never "0 of N" — CostTruthChip would print the count as fact.
 */
export function benchmarkStatsFromRow(row: unknown): BenchmarkStats | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as { median?: unknown; p25?: unknown; p75?: unknown; n?: unknown };
  if (r.median == null || r.n == null) return null;
  const num = (v: unknown) => (v == null ? null : Number(v));
  return { median: num(r.median), p25: num(r.p25), p75: num(r.p75), n: Number(r.n) };
}

/**
 * The Public Price Index card's sentence. Pure; app/cost-database renders it and
 * scripts/validate-w5-benchmark-financing-client.ts pins it.
 *
 * "On" with nothing on file must not read as contributing (#79), and no state
 * may say or imply that anything is published: nothing is (#84) — the index
 * and the in-app market figure both wait for server-derived rates.
 */
export function publicIndexCopy(a: {
  publicOptIn: boolean | null;
  unreadable: boolean;
  ratesOnFile: number | null;
  publishableCount: number;
}): string {
  if (a.publicOptIn === null) {
    return a.unreadable
      ? "Couldn't load your Public Price Index setting — check your connection. The switch unlocks once it loads. Nothing is published either way: the index isn't live yet."
      : 'Loading your Public Price Index setting…';
  }
  if (!a.publicOptIn) {
    return "Off. Your rates stay private. The public price index isn't published yet — MAGE ID will publish it only once rates are computed on our servers from logged job costs. Turn this on to have your measured rates count toward it then; it will never show your name.";
  }
  if ((a.ratesOnFile ?? 0) === 0 && a.publishableCount === 0) {
    return "On — nothing to count yet. Your measured rates are kept for the index once you log actuals on a job. The index isn't published yet, so nothing of yours is shown to anyone.";
  }
  return "On. Your measured rates are kept for the public price index. It isn't published yet — MAGE ID publishes it only once rates are computed on our servers from logged job costs — so nothing of yours is shown to anyone today.";
}

export function useCostBenchmark(entries: BenchmarkInput[]): {
  statsFor: (trade: string, unit: string) => BenchmarkStats | null;
  /** True when a published benchmark withheld this key. Always false while MARKET_BENCHMARK_PUBLISHED is false. */
  isBuilding: (trade: string, unit: string) => boolean;
  loading: boolean;
  /** Whether this account publishes to the PUBLIC Price Index, as stored. Null while loading / unreadable. */
  publicOptIn: boolean | null;
  /** Measured rates on file in the benchmark, as the server counts them. Null until read. */
  ratesOnFile: number | null;
  /** The stored choice could not be read (offline / server error) — say so, don't show Off. */
  publicOptInUnreadable: boolean;
  /** Measured rates on THIS device that qualify to publish (isPublishableRate). */
  publishableCount: number;
  /** Opt in/out for the whole account. Resolves with what the server stored, or why it failed. */
  setPublicOptIn: (next: boolean) => Promise<{ ok: true; optIn: boolean } | { ok: false; message: string }>;
} {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [stats, setStats] = useState<Record<string, BenchmarkStats>>({});
  const [building, setBuilding] = useState<Record<string, true>>({});
  const [loading, setLoading] = useState(false);
  const [indexState, setIndexState] = useState<PublicIndexState | null>(null);
  const [indexUnreadable, setIndexUnreadable] = useState(false);

  const keys = useMemo(() => {
    const m = new Map<string, BenchmarkInput>();
    for (const e of entries) {
      const trade = (e.trade || '').trim().toLowerCase();
      const unit = (e.unit || '').trim().toLowerCase();
      if (!trade || !unit || !(e.personalRate > 0)) continue;
      m.set(`${trade}|${unit}`, { ...e, trade, unit });
    }
    return [...m.values()].slice(0, MAX_KEYS);
  }, [entries]);

  // READ every key (comparing a rate you SET against the market is useful and
  // leaks nothing); CONTRIBUTE only the measured ones.
  const contributions = useMemo(() => keys.filter(isPublishableRate), [keys]);

  const keySig = keys.map((k) => `${k.trade}|${k.unit}`).join(',');
  const contribSig = contributions.map((k) => `${k.trade}|${k.unit}`).join(',');

  useEffect(() => {
    if (!userId || keys.length === 0) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      // (a) Contribute my own MEASURED rates through the RPC — the server
      //     stamps owner, region and key, and refuses an out-of-band price.
      //     One row per (trade, unit): it's my current rate, not a growing
      //     log. Best-effort: a benchmark contribution that misses this open
      //     goes on the next one, and nothing on screen depends on it. The
      //     opt-in is NOT sent — the server copies the account's choice, so
      //     this effect can never race the opt-in read and publish (or hide)
      //     a row by accident. A rate I merely stated never goes on the wire:
      //     see isPublishableRate.
      try {
        const rows = contributions.map((k) => ({
          p_category: k.trade,
          p_unit: k.unit,
          p_unit_price: k.personalRate,
        }));
        for (const args of rows) {
          void supabase.rpc('contribute_benchmark_rate', args).then(
            ({ error }) => { if (error) console.warn('[useCostBenchmark] contribution refused:', error.message); },
            () => { /* offline — the next open retries */ },
          );
        }
      } catch {
        // non-critical
      }

      // (b) Fetch aggregate stats per key (numeric comes back as string) —
      //     only once a market figure is published at all (it is not: see
      //     MARKET_BENCHMARK_PUBLISHED). Until then the chip shows nothing
      //     and the screen says why once, rather than per row.
      if (!MARKET_BENCHMARK_PUBLISHED) {
        if (!cancelled) { setStats({}); setBuilding({}); setLoading(false); }
        return;
      }
      try {
        const results = await Promise.all(
          keys.map(async (k) => {
            const { data, error } = await supabase.rpc('cost_benchmark_stats', {
              p_category: k.trade,
              p_unit: k.unit,
              p_region: 'US',
            });
            const row = Array.isArray(data) ? data[0] : data;
            if (error || !row) return null;
            return { key: `${k.trade}|${k.unit}`, stats: benchmarkStatsFromRow(row) };
          }),
        );
        if (cancelled) return;
        const next: Record<string, BenchmarkStats> = {};
        const nextBuilding: Record<string, true> = {};
        for (const r of results) {
          if (!r) continue;
          if (r.stats) next[r.key] = r.stats;
          else nextBuilding[r.key] = true;
        }
        setStats(next);
        setBuilding(nextBuilding);
      } catch {
        // leave stats empty — the chip shows nothing rather than a wrong number
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, keySig, contribSig]);

  // The account's public-index choice, as stored (default Off server-side).
  // An unreadable answer stays null — the switch is disabled with a reason,
  // not shown as Off.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('get_benchmark_public_opt_in');
        if (cancelled) return;
        const parsed = error ? null : parsePublicIndexState(data);
        setIndexState(parsed);
        setIndexUnreadable(parsed === null);
      } catch {
        if (!cancelled) { setIndexState(null); setIndexUnreadable(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const setPublicOptIn = async (
    next: boolean,
  ): Promise<{ ok: true; optIn: boolean } | { ok: false; message: string }> => {
    if (!userId) return { ok: false, message: 'Sign in to change this.' };
    // No optimistic flip: the switch moves only to what the server returns.
    try {
      const { data, error } = await supabase.rpc('set_benchmark_public_opt_in', { p_on: next });
      const stored = error ? null : parsePublicIndexState(data);
      if (!stored) {
        return {
          ok: false,
          message: "Couldn't save your Public Price Index choice. Check your connection and try again — nothing changed.",
        };
      }
      setIndexState(stored);
      setIndexUnreadable(false);
      return { ok: true, optIn: stored.optIn };
    } catch {
      return {
        ok: false,
        message: "Couldn't reach MAGE ID to save your Public Price Index choice. Nothing changed — try again when you're online.",
      };
    }
  };

  const keyOf = (trade: string, unit: string) =>
    `${(trade || '').trim().toLowerCase()}|${(unit || '').trim().toLowerCase()}`;
  const statsFor = (trade: string, unit: string): BenchmarkStats | null => stats[keyOf(trade, unit)] ?? null;
  const isBuilding = (trade: string, unit: string): boolean => building[keyOf(trade, unit)] === true;

  return {
    statsFor,
    isBuilding,
    loading,
    publicOptIn: indexState ? indexState.optIn : null,
    ratesOnFile: indexState ? indexState.ratesOnFile : null,
    publicOptInUnreadable: indexUnreadable,
    publishableCount: contributions.length,
    setPublicOptIn,
  };
}
