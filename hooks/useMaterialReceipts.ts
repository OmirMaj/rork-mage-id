// useMaterialReceipts — snapped supplier invoices, on the device AND the account.
//
// V1 kept these only in AsyncStorage (`mageid_material_receipts`). That key is
// under the `mageid_` prefix, so the sign-out sweep deleted it, and nothing
// ever reached the server: the $3,412.57 lumber invoice snapped on the iPhone
// never counted on the web budget dashboard or job costing, and one sign-out
// erased it for good (audit #25).
//
// Now every add / edit / delete ALSO goes through the offline queue as an
// upsert into public.material_receipts (20260923150000; the whole receipt in
// `payload`, a delete is a tombstone in `deleted_at`, so another device learns
// about it instead of resurrecting the row). The device copy is a cache:
//   • `receipts` comes from the cache first — milliseconds, no network — so
//     every costing screen that reads this hook is never held on a round trip.
//   • a background sync (once per user per few minutes, deduped by react-query
//     across the ~20 screens that mount this hook) reads the account copy and
//     merges it with the cache: newest updatedAt wins per id, a row still
//     waiting in the offline queue keeps its local copy, a tombstone removes
//     the receipt, and a receipt only on this device (snapped before sync
//     existed) is pushed up.
// qbo-* ids are deterministic, so an upsert of a re-materialized QuickBooks
// line is idempotent. The receipt image stays whatever the screen stored — this
// hook adds no upload path.
//
// RETURN SHAPE IS FROZEN (app/copilot.tsx, app/budget-dashboard.tsx,
// app/job-costing.tsx and ~20 others read it): { receipts, isLoading,
// addReceipt, addReceipts, updateReceipt, deleteReceipt, getReceiptsForProject }.
// addReceipt now RESOLVES to the write outcome so the save confirmation can say
// honestly where the receipt is; callers that ignore it are unaffected.

import { useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { MaterialReceipt } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { supabaseWriteDetailed, getOwnOfflineQueueDetailed, type WriteOutcome } from '@/utils/offlineQueue';

const RECEIPTS_KEY = 'mageid_material_receipts';
/** Which account the cached array belongs to. The sign-out sweep removes both
 *  keys; this is the belt to that brace, so a cache left by another account is
 *  never pushed up under this one. */
const RECEIPTS_OWNER_KEY = 'mageid_material_receipts_owner';
export const MATERIAL_RECEIPTS_TABLE = 'material_receipts';
const QUERY_ROOT = 'material-receipts';
const SYNC_ROOT = 'material-receipts-sync';
/** How long one account read serves every screen that mounts the hook. */
const SYNC_STALE_MS = 5 * 60 * 1000;

/** Where a save landed: on the account ('synced'), waiting in the offline queue
 *  ('queued'), or only on this device ('failed' — refused, or no session). */
export type MaterialReceiptSaveOutcome = WriteOutcome;

/**
 * The save confirmation, by where the receipt actually landed (audit #25). It
 * used to say only "Saved" while the receipt lived on this phone alone: the
 * web budget and job costing never counted it and a sign-out erased it.
 * Rendered by app/material-receipt.tsx; pinned by
 * scripts/validate-w5-coi-subs-receipts.ts.
 */
export function receiptSavedMessage(outcome: 'saving' | MaterialReceiptSaveOutcome): string {
  switch (outcome) {
    case 'saving':
      return 'Saving…';
    case 'synced':
      return 'Saved to your account — it counts on the web and your other devices. The prices fed your Cost Database; snap another or head back.';
    case 'queued':
      return "Saved on this phone — it uploads to your account when you're back online. Signing out before then removes it.";
    case 'failed':
    default:
      return "Saved on this phone only — it won't show on the web or other devices yet, and signing out removes it.";
  }
}

// ─── Pure half (pinned by scripts/validate-w5-coi-subs-receipts.ts) ─────────

export interface MaterialReceiptRow {
  id: string;
  user_id: string;
  project_id: string | null;
  commitment_id: string | null;
  payload: MaterialReceipt;
  updated_at: string;
  deleted_at: string | null;
}

/** The row an add / edit / delete upserts. `deletedAt` makes it a tombstone. */
export function materialReceiptToRow(r: MaterialReceipt, userId: string, deletedAt: string | null = null): MaterialReceiptRow {
  return {
    id: r.id,
    user_id: userId,
    project_id: r.projectId || null,
    commitment_id: r.commitmentId || null,
    payload: r,
    updated_at: deletedAt ?? r.updatedAt ?? new Date().toISOString(),
    deleted_at: deletedAt,
  };
}

const ms = (v: unknown): number => {
  if (typeof v !== 'string' || !v) return NaN;
  return Date.parse(v);
};

export interface MergeMaterialReceiptsInput {
  /** What this device holds (the cache / in-memory list). */
  local: readonly MaterialReceipt[];
  /** Every account row for this user, tombstones included. */
  serverRows: readonly Partial<MaterialReceiptRow>[];
  /** Ids with a queued upsert that is still a live receipt. */
  pendingIds: ReadonlySet<string>;
  /** Ids with a queued tombstone (a delete made offline). */
  pendingDeleteIds: ReadonlySet<string>;
  /** False when the cache was written for ANOTHER account: its device-only
   *  rows are dropped instead of pushed up under this one. */
  cacheIsThisUsers: boolean;
}

export interface MergeMaterialReceiptsResult {
  merged: MaterialReceipt[];
  /** Device-only receipts to push up (snapped before sync, or never sent). */
  toBackfill: MaterialReceipt[];
}

/**
 * Newest wins per id; a queued edit keeps its local copy; a tombstone (server
 * or queued) removes the receipt; a device-only receipt is kept and pushed up.
 * Newest-created first, the order the screens have always shown.
 */
export function mergeMaterialReceipts(input: MergeMaterialReceiptsInput): MergeMaterialReceiptsResult {
  const live = new Map<string, MaterialReceipt>();
  const tombstoned = new Set<string>();
  for (const row of input.serverRows) {
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id) continue;
    if (row.deleted_at) { tombstoned.add(id); continue; }
    const p = row.payload as MaterialReceipt | undefined;
    if (!p || typeof p !== 'object') continue;
    live.set(id, { ...p, id });
  }

  const out = new Map<string, MaterialReceipt>();
  const toBackfill: MaterialReceipt[] = [];
  const localIds = new Set<string>();
  for (const l of input.local) {
    if (!l?.id) continue;
    localIds.add(l.id);
    if (input.pendingDeleteIds.has(l.id)) continue;
    if (input.pendingIds.has(l.id)) { out.set(l.id, l); continue; }
    if (tombstoned.has(l.id)) continue;
    const s = live.get(l.id);
    if (s) {
      // Ties go to the account copy — it is what every other device sees.
      out.set(l.id, ms(l.updatedAt) > ms(s.updatedAt) ? l : s);
      if (ms(l.updatedAt) > ms(s.updatedAt)) toBackfill.push(l);
      continue;
    }
    if (!input.cacheIsThisUsers) continue;
    out.set(l.id, l);
    toBackfill.push(l);
  }
  for (const [id, s] of live) {
    if (localIds.has(id) || input.pendingDeleteIds.has(id)) continue;
    out.set(id, s);
  }
  const merged = [...out.values()].sort((a, b) => {
    const d = (ms(b.createdAt) || 0) - (ms(a.createdAt) || 0);
    return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return { merged, toBackfill };
}

// ─── Device cache ────────────────────────────────────────────────────────────

async function load(): Promise<MaterialReceipt[]> {
  try {
    const raw = await AsyncStorage.getItem(RECEIPTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MaterialReceipt[]) : [];
  } catch {
    return [];
  }
}

async function persist(receipts: MaterialReceipt[], userId: string | null): Promise<void> {
  try {
    await AsyncStorage.setItem(RECEIPTS_KEY, JSON.stringify(receipts));
    if (userId) await AsyncStorage.setItem(RECEIPTS_OWNER_KEY, userId);
  } catch (err) {
    console.log('[materialReceipts] persist failed:', err);
  }
}

async function readCacheOwner(): Promise<string | null> {
  try { return await AsyncStorage.getItem(RECEIPTS_OWNER_KEY); } catch { return null; }
}

// ─── Account half ────────────────────────────────────────────────────────────

function writeRow(row: MaterialReceiptRow): Promise<WriteOutcome> {
  return supabaseWriteDetailed(MATERIAL_RECEIPTS_TABLE, 'upsert', row as unknown as Record<string, unknown>)
    .catch(() => 'failed' as const);
}

/** Read the account copy and merge it into the cache. Returns false (and
 *  changes nothing) when the read fails — offline, or the table not migrated
 *  yet — so a failed read never empties a real list. */
async function syncWithAccount(
  userId: string,
  getLocal: () => MaterialReceipt[] | undefined,
  publish: (next: MaterialReceipt[]) => void,
): Promise<boolean> {
  try {
    const res = await supabase
      .from(MATERIAL_RECEIPTS_TABLE)
      .select('id, user_id, project_id, commitment_id, payload, updated_at, deleted_at')
      .eq('user_id', userId);
    if (res.error) return false;
    const queue = await getOwnOfflineQueueDetailed();
    const pendingIds = new Set<string>();
    const pendingDeleteIds = new Set<string>();
    for (const m of queue.entries) {
      if (m.table !== MATERIAL_RECEIPTS_TABLE) continue;
      const id = typeof m.data?.id === 'string' ? m.data.id : '';
      if (!id) continue;
      if (m.data?.deleted_at) pendingDeleteIds.add(id); else pendingIds.add(id);
    }
    const owner = await readCacheOwner();
    // Read the device side AFTER the round trip: a receipt saved while the
    // read was in flight must survive the merge.
    const local = getLocal() ?? await load();
    // An unreadable queue means "we could not look": keep every local copy.
    const pending = queue.readFailed ? new Set(local.map(r => r.id)) : pendingIds;
    const { merged, toBackfill } = mergeMaterialReceipts({
      local,
      serverRows: (res.data ?? []) as Partial<MaterialReceiptRow>[],
      pendingIds: pending,
      pendingDeleteIds,
      cacheIsThisUsers: owner == null || owner === userId,
    });
    publish(merged);
    await persist(merged, userId);
    for (const r of toBackfill) void writeRow(materialReceiptToRow(r, userId));
    return true;
  } catch {
    return false;
  }
}

export function useMaterialReceipts() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // Keyed by user: the in-memory cache must never hand one account's receipts
  // to the next on a shared device.
  const queryKey = useMemo(() => [QUERY_ROOT, userId] as const, [userId]);

  const { data: receipts = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => queryClient.getQueryData<MaterialReceipt[]>(queryKey) ?? load(),
    staleTime: Infinity,
  });

  // Background account sync — never on the path to `receipts`.
  useQuery({
    queryKey: [SYNC_ROOT, userId],
    enabled: !!userId,
    staleTime: SYNC_STALE_MS,
    queryFn: async () => {
      if (!userId) return false;
      return syncWithAccount(
        userId,
        () => queryClient.getQueryData<MaterialReceipt[]>(queryKey),
        next => queryClient.setQueryData(queryKey, next),
      );
    },
  });

  const save = useMutation({
    mutationFn: async (next: MaterialReceipt[]) => { await persist(next, userId); return next; },
    onSuccess: (next) => { queryClient.setQueryData(queryKey, next); },
  });

  const current = useCallback(
    () => (queryClient.getQueryData<MaterialReceipt[]>(queryKey) ?? receipts),
    [queryClient, queryKey, receipts],
  );

  // Publish synchronously as well as through the mutation, so two writes in
  // one tick (a save, then an immediate edit) both see the first one.
  const commit = useCallback((next: MaterialReceipt[]) => {
    queryClient.setQueryData(queryKey, next);
    save.mutate(next);
  }, [queryClient, queryKey, save]);

  const push = useCallback((r: MaterialReceipt, deletedAt: string | null = null): Promise<WriteOutcome> => {
    // No session: the receipt is on this device only, and the caller says so.
    if (!userId) return Promise.resolve('failed');
    return writeRow(materialReceiptToRow(r, userId, deletedAt));
  }, [userId]);

  const addReceipt = useCallback((r: MaterialReceipt): Promise<MaterialReceiptSaveOutcome> => {
    commit([r, ...current().filter(x => x.id !== r.id)]);
    return push(r);
  }, [commit, current, push]);

  // Atomic multi-add. Looping addReceipt races itself: each mutate snapshots
  // current() BEFORE the previous onSuccess lands, so later calls clobber
  // earlier ones. Used by the QBO confirm queue's bulk confirm and its
  // re-materialization sweep (F6). Ids already present are skipped, which
  // also makes deterministic-id replays (qbo-*) idempotent.
  const addReceipts = useCallback((rs: MaterialReceipt[]) => {
    if (rs.length === 0) return;
    const existing = current();
    const have = new Set(existing.map(r => r.id));
    const fresh = rs.filter(r => !have.has(r.id));
    if (fresh.length === 0) return;
    commit([...fresh, ...existing]);
    for (const r of fresh) void push(r);
  }, [commit, current, push]);

  const updateReceipt = useCallback((id: string, updates: Partial<MaterialReceipt>) => {
    const now = new Date().toISOString();
    let changed: MaterialReceipt | undefined;
    const next = current().map(r => {
      if (r.id !== id) return r;
      changed = { ...r, ...updates, updatedAt: now };
      return changed;
    });
    commit(next);
    if (changed) void push(changed);
  }, [commit, current, push]);

  const deleteReceipt = useCallback((id: string) => {
    const gone = current().find(r => r.id === id);
    commit(current().filter(r => r.id !== id));
    // A tombstone, not a hard delete: another device holding this receipt
    // learns it was removed instead of pushing it back up as device-only.
    if (gone) void push(gone, new Date().toISOString());
  }, [commit, current, push]);

  const getReceiptsForProject = useCallback(
    (projectId: string) => receipts.filter(r => r.projectId === projectId),
    [receipts],
  );

  return { receipts, isLoading, addReceipt, addReceipts, updateReceipt, deleteReceipt, getReceiptsForProject };
}
