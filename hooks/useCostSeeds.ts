// useCostSeeds — local-first, cloud-backed store for the contractor's SEEDED rates.
//
// A seed is a rate the contractor stated (pasted from a spreadsheet or typed
// on app/cost-seed) before they had closed-job history inside MAGE. It flows
// into utils/costDatabase as a quantity-1, `seed:`-prefixed CostSample so the
// estimate wizard has something real to price from on day one — see
// utils/costSeedCore for why that keeps "you told me" separate from
// "I watched this happen".
//
// ── STORAGE ────────────────────────────────────────────────────────────────
// AsyncStorage under `mageid_cost_seeds` (registered in LOCAL_USER_CACHE_KEYS
// in contexts/AuthContext.tsx, so it wipes on tenant switch) is the LOCAL
// CACHE, shared across screens via the react-query cache. Postgres
// `public.cost_seeds` is the durable copy.
//
// V1 was AsyncStorage-only, and that was the hole: the data the entire cost
// moat rests on did not survive a reinstall and never reached a second device.
// A contractor who typed forty rates and then reinstalled lost all forty,
// silently — worse than never having them, because by then they had stopped
// double-checking the numbers.
//
// ── PRE-MIGRATION BEHAVIOUR — READ THIS BEFORE DEBUGGING AN EMPTY SYNC ──────
// public.cost_seeds does not exist until
// supabase/migrations/20260805120000_cost_seeds.sql is applied (the founder
// applies it; it is deliberately not auto-run). Until then the select below
// errors, the catch falls through to AsyncStorage, and every write hits a
// PostgREST schema-cache miss that utils/offlineQueue.ts classifies as
// TRANSIENT — re-queued UNCHANGED, without burning the retry budget. Net
// effect before the migration: seeding works fully on-device and syncs
// nothing, losing nothing. After it lands the queue drains on the next
// foreground and the same rows appear server-side. Nothing to migrate by hand.
//
// Writes go through supabaseWrite (utils/offlineQueue), never supabase.from()
// directly — that is the app-wide rule, and it is what makes the pre-migration
// window safe. Reads use supabase.from().select() directly, the same
// server-first-then-local shape as the delay-events query in ProjectContext.
//
// ── IDS ────────────────────────────────────────────────────────────────────
// SeededRate ids are deterministic from trade+unit (costSeedCore.seedId), so a
// re-imported spreadsheet corrects rather than duplicates. That survives the
// round-trip: writes are 'upsert' keyed on the table's (user_id, id) PK, and
// costSeedCore.rowToSeed re-derives the id if a row somehow lacks one. The id
// is NOT globally unique — every framing contractor produces 'seed-framing-sf'
// — which is exactly why the PK is composite; see the migration header.

import { useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWrite } from '@/utils/offlineQueue';
import {
  mergeSeeds,
  reconcileSeeds,
  rowToSeed,
  seedKey,
  seedToRow,
  type SeededRate,
  type SeedMergeResult,
} from '@/utils/costSeedCore';

const SEEDS_KEY = 'mageid_cost_seeds';
const TABLE = 'cost_seeds';

async function load(): Promise<SeededRate[]> {
  try {
    const raw = await AsyncStorage.getItem(SEEDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: a hand-edited / half-written cache must not poison the book
    // with NaN rates. Anything without a usable trade+unit+rate is dropped.
    return (parsed as SeededRate[]).filter(
      s => s && typeof s.trade === 'string' && typeof s.unit === 'string' &&
        Number.isFinite(s.rate) && s.rate > 0,
    );
  } catch {
    return [];
  }
}

async function persist(seeds: SeededRate[]): Promise<void> {
  try {
    await AsyncStorage.setItem(SEEDS_KEY, JSON.stringify(seeds));
  } catch (err) {
    console.log('[costSeeds] persist failed:', err);
  }
}

export function useCostSeeds() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const canSync = isSupabaseConfigured && !!userId;

  // userId is in the key so a tenant switch refetches instead of showing the
  // previous contractor's rates out of a stale cache.
  const QUERY_KEY = ['cost-seeds', userId] as const;

  const { data: seeds = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const local = await load();
      if (!canSync) return local;
      try {
        const { data, error } = await supabase.from(TABLE).select('*');
        if (error || !data) return local;
        const fromServer = data
          .map(rowToSeed)
          .filter((s): s is SeededRate => s !== null);
        // Union, last-stated-wins. NOT a server-wins replace: an edit still
        // sitting in the offline queue would otherwise visibly revert.
        const next = reconcileSeeds(local, fromServer);
        await persist(next);

        // BACKFILL. A local row the server has never seen is a rate that is
        // still one reinstall from being lost, and there are two ordinary ways
        // to get one: seeds entered in app/onboarding before the auth session
        // hydrated (canSync was false, so no write was ever attempted), and
        // rows whose queued write was dropped when the offline queue hit its
        // 1,000-entry cap during the pre-migration window. Re-upserting them
        // is idempotent — the deterministic id means a row that IS already
        // there is simply rewritten with the same values.
        if (userId) {
          const onServer = new Set(fromServer.map(s => seedKey(s.trade, s.unit)));
          for (const s of next) {
            if (onServer.has(seedKey(s.trade, s.unit))) continue;
            void supabaseWrite(TABLE, 'upsert', seedToRow(s, userId) as unknown as Record<string, unknown>);
          }
        }
        return next;
      } catch {
        // Table not created yet, or offline — the cache is the answer.
        return local;
      }
    },
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: async (next: SeededRate[]) => { await persist(next); return next; },
    onSuccess: (next) => { queryClient.setQueryData(QUERY_KEY, next); },
  });

  // Read through the cache, not the render-time snapshot — looping mutations
  // otherwise clobber each other (same reason useMaterialReceipts does it).
  const current = useCallback(
    () => (queryClient.getQueryData<SeededRate[]>(QUERY_KEY) ?? seeds),
    [queryClient, seeds, userId], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** Commit a parsed batch. Same trade+unit merges into one row (incoming
   *  wins), so re-importing an updated spreadsheet corrects rather than
   *  duplicates. Returns the merge counts for the confirmation copy. */
  const addSeeds = useCallback((incoming: SeededRate[]): SeedMergeResult => {
    const result = mergeSeeds(current(), incoming);
    if (incoming.length > 0) {
      save.mutate(result.merged);
      // One upsert per row rather than one bulk write: the offline queue keys
      // its ordering groups on `table:data.id`, so per-row writes for different
      // trades replay concurrently and a failure on one rate never strands the
      // rest. 'upsert' (not 'insert') because the id is deterministic — a
      // correction to a rate already on the server is a duplicate-key violation
      // as an insert, which the queue classifies TERMINAL and discards.
      if (canSync && userId) {
        for (const s of incoming) {
          void supabaseWrite(TABLE, 'upsert', seedToRow(s, userId) as unknown as Record<string, unknown>);
        }
      }
    }
    return result;
  }, [save, current, canSync, userId]);

  const deleteSeed = useCallback((id: string) => {
    save.mutate(current().filter(s => s.id !== id));
    // RLS scopes the `.eq('id', …)` to this user's row — see the delete policy
    // in the migration. Without it, one GC deleting 'seed-framing-sf' would
    // delete every GC's.
    if (canSync) void supabaseWrite(TABLE, 'delete', { id });
  }, [save, current, canSync]);

  // Edits go through addSeeds: seed ids are deterministic from trade+unit, so
  // re-adding an edited row merges over the old one. A trade/unit RENAME moves
  // the id, which is why app/cost-seed deletes the old row on that path.
  return { seeds, isLoading, addSeeds, deleteSeed };
}

export default useCostSeeds;
