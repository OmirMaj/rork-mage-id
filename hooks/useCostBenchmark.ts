// hooks/useCostBenchmark.ts
//
// Powers Cost Truth: (a) contributes the contractor's own MEASURED rates to the
// cross-contractor benchmark (fire-and-forget upsert — one row per trade+unit;
// a rate he merely stated is never published, see isPublishableRate),
// and (b) fetches the k-anonymized aggregate stats via the cost_benchmark_stats
// RPC. The pure compare logic lives in utils/costTruth.
//
// Contributing your rate is how the flywheel turns — every contractor sharpens
// everyone's benchmark. Reads are aggregate-only (RLS blocks raw cross-tenant
// rows), so no one ever sees another contractor's prices.

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

export function useCostBenchmark(entries: BenchmarkInput[]): {
  statsFor: (trade: string, unit: string) => BenchmarkStats | null;
  loading: boolean;
  /** Whether this contractor publishes to the PUBLIC Price Index. Null while loading. */
  publicOptIn: boolean | null;
  /** Opt in/out of the public index. Applies to all of this user's rows. */
  setPublicOptIn: (next: boolean) => Promise<void>;
} {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [stats, setStats] = useState<Record<string, BenchmarkStats>>({});
  const [loading, setLoading] = useState(false);
  const [publicOptIn, setPublicOptInState] = useState<boolean | null>(null);

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
      // (a) Contribute my own MEASURED rates — one row per (trade, unit,
      //     region). Upsert so it's my current rate, not a growing log.
      //     Fire-and-forget. A rate I merely stated never goes on the wire:
      //     see isPublishableRate.
      try {
        const rows = contributions.map((k) => ({
          user_id: userId,
          category: k.trade,
          unit: k.unit,
          region: 'US',
          unit_price: k.personalRate,
          updated_at: new Date().toISOString(),
        }));
        if (rows.length > 0) {
          void supabase.from('cost_benchmark_samples').upsert(rows, { onConflict: 'user_id,category,unit,region' });
        }
      } catch {
        // non-critical
      }

      // (b) Fetch aggregate stats per key (numeric comes back as string).
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
            const num = (v: unknown) => (v == null ? null : Number(v));
            return {
              key: `${k.trade}|${k.unit}`,
              stats: {
                median: num(row.median),
                p25: num(row.p25),
                p75: num(row.p75),
                n: Number(row.n ?? 0),
              } as BenchmarkStats,
            };
          }),
        );
        if (cancelled) return;
        const next: Record<string, BenchmarkStats> = {};
        for (const r of results) if (r) next[r.key] = r.stats;
        setStats(next);
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

  // Current public-index opt-in state (default false server-side, so a user
  // with no rows yet reads as opted out).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('cost_benchmark_samples')
          .select('public_index_opt_in')
          .limit(1);
        if (cancelled) return;
        const row = Array.isArray(data) ? data[0] : null;
        setPublicOptInState(row ? !!(row as { public_index_opt_in?: boolean }).public_index_opt_in : false);
      } catch {
        if (!cancelled) setPublicOptInState(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const setPublicOptIn = async (next: boolean): Promise<void> => {
    if (!userId) return;
    setPublicOptInState(next); // optimistic
    try {
      const { error } = await supabase
        .from('cost_benchmark_samples')
        .update({ public_index_opt_in: next })
        .eq('user_id', userId);
      if (error) setPublicOptInState(!next); // revert on failure
    } catch {
      setPublicOptInState(!next);
    }
  };

  const statsFor = (trade: string, unit: string): BenchmarkStats | null => {
    const key = `${(trade || '').trim().toLowerCase()}|${(unit || '').trim().toLowerCase()}`;
    return stats[key] ?? null;
  };

  return { statsFor, loading, publicOptIn, setPublicOptIn };
}
