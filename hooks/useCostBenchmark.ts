// hooks/useCostBenchmark.ts
//
// Powers Cost Truth: (a) contributes the contractor's own learned rates to the
// cross-contractor benchmark (fire-and-forget upsert — one row per trade+unit),
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
}

const MAX_KEYS = 40; // cap RPC fan-out on very large price books

export function useCostBenchmark(entries: BenchmarkInput[]): {
  statsFor: (trade: string, unit: string) => BenchmarkStats | null;
  loading: boolean;
} {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [stats, setStats] = useState<Record<string, BenchmarkStats>>({});
  const [loading, setLoading] = useState(false);

  const keys = useMemo(() => {
    const m = new Map<string, BenchmarkInput>();
    for (const e of entries) {
      const trade = (e.trade || '').trim().toLowerCase();
      const unit = (e.unit || '').trim().toLowerCase();
      if (!trade || !unit || !(e.personalRate > 0)) continue;
      m.set(`${trade}|${unit}`, { trade, unit, personalRate: e.personalRate });
    }
    return [...m.values()].slice(0, MAX_KEYS);
  }, [entries]);

  const keySig = keys.map((k) => `${k.trade}|${k.unit}`).join(',');

  useEffect(() => {
    if (!userId || keys.length === 0) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      // (a) Contribute my own rates — one row per (trade, unit, region). Upsert
      //     so it's my current rate, not a growing log. Fire-and-forget.
      try {
        const rows = keys.map((k) => ({
          user_id: userId,
          category: k.trade,
          unit: k.unit,
          region: 'US',
          unit_price: k.personalRate,
          updated_at: new Date().toISOString(),
        }));
        void supabase.from('cost_benchmark_samples').upsert(rows, { onConflict: 'user_id,category,unit,region' });
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
  }, [userId, keySig]);

  const statsFor = (trade: string, unit: string): BenchmarkStats | null => {
    const key = `${(trade || '').trim().toLowerCase()}|${(unit || '').trim().toLowerCase()}`;
    return stats[key] ?? null;
  };

  return { statsFor, loading };
}
