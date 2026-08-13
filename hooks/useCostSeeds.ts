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
// ── MIGRATION STATE — READ THIS BEFORE DEBUGGING AN EMPTY SYNC ─────────────
// public.cost_seeds (20260805120000_cost_seeds.sql) IS APPLIED in production.
// Its follow-up, 20260812093000_cost_seeds_soft_delete.sql, adds the
// deleted_at column the tombstone merge below writes — the founder applies it;
// migrations are deliberately not auto-run.
//
// Until deleted_at exists, an upsert carrying it hits a PostgREST schema-cache
// miss, which utils/offlineQueue.ts classifies as TRANSIENT and re-queues
// UNCHANGED without burning the retry budget. Net effect: deletes take effect
// on-device immediately and reach the server once the column lands — nothing
// is lost, and there is nothing to migrate by hand. The same was true of the
// whole table before 20260805120000 landed.
//
// Writes go through supabaseWrite (utils/offlineQueue), never supabase.from()
// directly — that is the app-wide rule, and it is what makes the pre-migration
// window safe. Reads use supabase.from().select() directly, the same
// server-first-then-local shape as the delay-events query in ProjectContext.
//
// ── HOW LOCAL AND SERVER ARE MERGED ────────────────────────────────────────
// A UNION, last-written-wins — never a server-wins replace, because an edit
// still sitting in the offline queue would visibly revert. Three rules make
// that union actually converge:
//
//   * A DELETE IS A TOMBSTONE (deleted_at), not a removal. A union cannot
//     express absence: a hard-deleted row came straight back from whichever
//     side had not heard about it — first from the server copy the queued
//     delete had not reached, then, once it had, from the local copy the
//     backfill pushed back up. costSeedCore.activeSeeds hides tombstones from
//     consumers; pruneTombstones drops them after 180 days.
//   * THE SERVER CLOCK OUTRANKS THE CLIENT'S. created_at is whatever the
//     writing device's clock said; updated_at is stamped by the DB trigger.
//     costSeedCore.seedStamp prefers updated_at and discards any stamp in the
//     future, so a phone set a year fast cannot pin a stale rate forever.
//   * THE BACKFILL COMPARES VALUES, not merely whether the key exists
//     server-side. Presence alone skipped exactly the rows whose local copy
//     had WON the merge, so a correction whose queued write was dropped never
//     reached the server at all.
//
// ── IDS ────────────────────────────────────────────────────────────────────
// SeededRate ids are deterministic from trade+unit (costSeedCore.seedId), so a
// re-imported spreadsheet corrects rather than duplicates. That survives the
// round-trip: writes are 'upsert' keyed on the table's (user_id, id) PK, and
// costSeedCore.rowToSeed re-derives the id if a row somehow lacks one. The id
// is NOT globally unique — every framing contractor produces 'seed-framing-sf'
// — which is exactly why the PK is composite; see the migration header.

import { useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWrite } from '@/utils/offlineQueue';
import {
  activeSeeds,
  dedupeSeeds,
  isPersistableSeed,
  mergeSeeds,
  normalizeSeed,
  pruneTombstones,
  reconcileSeeds,
  rowToSeed,
  sameSeedValue,
  seedKey,
  seedToRow,
  tombstoneSeed,
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
    // The cache is the one input nobody validates on the way in — it outlives
    // app versions and half-written writes. normalizeSeed drops what could
    // never price a line AND repairs unreadable timestamps, which matters
    // because an unparseable stamp used to make a stale row win every merge.
    return pruneTombstones(
      parsed.map(normalizeSeed).filter((s): s is SeededRate => s !== null),
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
        const next = pruneTombstones(reconcileSeeds(local, fromServer));
        // Only write when reconcile actually changed something. A steady-state
        // refetch (remount, tenant switch, invalidation) should cost nothing.
        if (!sameSeedSet(local, next)) await persist(next);

        // BACKFILL. A local row the server does not have — or has a DIFFERENT
        // version of — is a rate still one reinstall from being lost. Three
        // ordinary ways to get one: seeds entered in app/onboarding before the
        // auth session hydrated (canSync was false, so no write was attempted),
        // rows whose queued write was dropped at the offline queue's
        // 1,000-entry cap, and an edit that WON the reconcile while the server
        // still holds the copy it beat.
        //
        // That last case is why this compares values instead of asking "is the
        // key present server-side". Presence alone skipped exactly the rows
        // whose local version was the newer one, so a correction whose queued
        // write was dropped never reached the server at all.
        if (userId) {
          const serverByKey = new Map(fromServer.map(s => [seedKey(s.trade, s.unit), s]));
          for (const s of next) {
            const theirs = serverByKey.get(seedKey(s.trade, s.unit));
            if (theirs && sameSeedValue(theirs, s)) continue;
            if (!isPersistableSeed(s)) continue;
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
  const addSeeds = useCallback((rawIncoming: SeededRate[]): SeedMergeResult => {
    // Collapse the batch first: two rows that canonicalize to the same trade+
    // unit share one deterministic id, so without this they enqueue two writes
    // for one primary key. mergeSeeds already collapses them locally — this
    // makes the wire agree with the cache.
    const incoming = dedupeSeeds(rawIncoming);
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
          if (!isPersistableSeed(s)) continue;
          void supabaseWrite(TABLE, 'upsert', seedToRow(s, userId) as unknown as Record<string, unknown>);
        }
      }
    }
    return result;
  }, [save, current, canSync, userId]);

  /**
   * Remove a rate.
   *
   * A TOMBSTONE, not a hard delete. The read path unions local and server, and
   * a union cannot express absence: a hard-deleted row simply came back from
   * whichever side had not heard about it yet — first from the server copy the
   * queued delete had not reached, then, once it had, from the local copy the
   * backfill pushed back up. The rate returned forever. A tombstone is a row,
   * so it can win the merge and stay won.
   */
  const deleteSeed = useCallback((id: string) => {
    const now = new Date().toISOString();
    const gone = current().map(s => (s.id === id ? tombstoneSeed(s, now) : s));
    save.mutate(gone);
    if (canSync && userId) {
      const dead = gone.find(s => s.id === id);
      if (dead) {
        void supabaseWrite(TABLE, 'upsert', seedToRow(dead, userId) as unknown as Record<string, unknown>);
      }
    }
  }, [save, current, canSync, userId]);

  // Edits go through addSeeds: seed ids are deterministic from trade+unit, so
  // re-adding an edited row merges over the old one. A trade/unit RENAME moves
  // the id — app/cost-seed's MANUAL edit path deletes the row the id moved off
  // (it tracks editingId, so it knows). The PASTE path cannot: a re-import that
  // renames a trade carries no signal that the new row supersedes an old one,
  // so it leaves the old rate in place rather than guessing which of the
  // contractor's rates to delete. Both then price takeoff lines; removing the
  // stale one is a manual step on this screen.
  const visible = useMemo(() => activeSeeds(seeds), [seeds]);
  return { seeds: visible, isLoading, addSeeds, deleteSeed };
}

/** Cheap set equality for the gate above — same keys, same values. */
function sameSeedSet(a: SeededRate[], b: SeededRate[]): boolean {
  if (a.length !== b.length) return false;
  const byKey = new Map(a.map(s => [seedKey(s.trade, s.unit), s]));
  for (const s of b) {
    const mine = byKey.get(seedKey(s.trade, s.unit));
    if (!mine || !sameSeedValue(mine, s)) return false;
  }
  return true;
}

export default useCostSeeds;
