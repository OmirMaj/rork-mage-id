// hooks/useBackcharges.ts — the backcharge list: on this device AND on the
// account (public.backcharges, 20260928160000).
//
// Before this, the list lived only under BACKCHARGES_KEY (a mageid_ key), so
// the sign-out sweep deleted money the sub owed and the web app never saw a
// backcharge made on the phone.
//
// Now:
//   • The device list stays the instant, offline copy (same key, same shared
//     in-memory list). Every read and write of storage is wrapped — storage can
//     throw (private window, blocked site data) and the screen must still work.
//   • Every add / update / applyToInvoice / voidOne ALSO sends the row through
//     utils/offlineQueue (supabaseWriteDetailed 'upsert' of toRow — never
//     user_id, see utils/backchargeRows.ts).
//   • Signed in, a read of the account's rows (react-query key
//     ['backcharges', userId]) merges into the shared list: server rows win,
//     except an id with a write still pending on this device (its own queue,
//     read like hooks/usePortalThread.ts does, or on the wire now) or refused
//     (the Not saved list). A device row the account does not return is never
//     deleted: it is sent up once (the rows made before this update).
//   • A refused write is left to the queue's own Not saved handling (the ledger
//     and its toast); the row stays on the device and reads "Not saved".
//   • Signed out: exactly as before, device only.
//
// One shared in-memory copy: the section and every invoice's deduction card
// mount this hook, and "Apply to this bill" on a card must move the item in
// the section on the same frame.
//
// PUBLIC API: list, loaded, add, update, applyToInvoice, voidOne are unchanged
// (app/punch-list.tsx and app/sub-portal-setup.tsx use them). statusOf,
// signedIn, retryNotSaved and complete are additions.
//
// `complete` (integration round 2): signed in, the list is only the whole
// record once the account's read came back for THIS user in this session.
// Until then `list` can be [] with backcharges on the account — the web app, a
// second phone, the first launch after a sign-in, offline, a failed read — and
// a scorecard must pass undefined ("not counted"), never [] ("no backcharges").

import { useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  supabaseWriteDetailed, getOwnOfflineQueueDetailed, recordIdOf, onQueueChanged, onQueueFlushed,
  type WriteOutcome,
} from '@/utils/offlineQueue';
import { onSyncLedgerChanged, ownUnsavedWrites, retryUnsavedWrite, unsavedWriteIds } from '@/utils/syncLedger';
import { BACKCHARGES_KEY, markApplied, parseBackcharges, type Backcharge } from '@/utils/backcharges';
import {
  BACKCHARGES_ACCOUNT_KEY, BACKCHARGES_TABLE, fetchAccountBackcharges, mergeBackcharges, parseAccountMeta,
  backchargesComplete, saveStateOf, toRow, type BackchargeSaveState,
} from '@/utils/backchargeRows';

// ── Shared module state ─────────────────────────────────────────────────────
let shared: Backcharge[] = [];
let sharedLoaded = false;
/** The account the in-memory list was loaded or written under (null = signed out). */
let sharedOwner: string | null = null;
/** The account whose read of public.backcharges came back this session (set
 *  only by syncWithAccount; cleared when the list is published under anyone
 *  else). Drives `complete`. */
let accountReadFor: string | null = null;
/** Bumped on every publish: a storage read that started before a newer
 *  in-memory change must not overwrite it. */
let version = 0;
const listeners = new Set<() => void>();

/** Ids the account has confirmed (read back, or a write that landed). */
let savedIds = new Set<string>();
/** Ids with a write in this device's own queue. */
let queuedIds = new Set<string>();
/** The own-queue read failed: every device row is treated as waiting. */
let queueUnreadable = false;
/** Ids whose write the account refused (the Not saved list). */
let unsavedIds = new Set<string>();
/** Writes on the wire right now, and when each id was last written. */
const inFlight = new Map<string, number>();
const touchedAt = new Map<string, number>();
/** Ids sent up by adoption this session, for this account. */
let adopted = new Set<string>();
let adoptedFor: string | null = null;

function notify() {
  listeners.forEach(l => l());
}

function publish(next: Backcharge[], owner: string | null) {
  // A list published under another account (or signed out) is not the read.
  if (owner !== accountReadFor) accountReadFor = null;
  shared = next;
  sharedLoaded = true;
  sharedOwner = owner;
  version++;
  notify();
}

/** null when storage threw — the caller keeps the in-memory list rather than
 *  wiping this session's edits. */
async function readAll(): Promise<Backcharge[] | null> {
  try {
    return parseBackcharges(await AsyncStorage.getItem(BACKCHARGES_KEY));
  } catch {
    return null;
  }
}

async function readMeta() {
  try {
    return parseAccountMeta(await AsyncStorage.getItem(BACKCHARGES_ACCOUNT_KEY));
  } catch {
    return parseAccountMeta(null);
  }
}

async function writeAll(list: Backcharge[], owner: string | null): Promise<void> {
  try {
    await AsyncStorage.setItem(BACKCHARGES_KEY, JSON.stringify(list));
  } catch {
    // Device-local; the in-memory list still shows what was done this session.
  }
  await writeMeta(owner);
}

async function writeMeta(owner: string | null): Promise<void> {
  try {
    const ids = new Set(shared.map(b => b.id));
    await AsyncStorage.setItem(
      BACKCHARGES_ACCOUNT_KEY,
      JSON.stringify({ userId: owner, savedIds: [...savedIds].filter(id => ids.has(id)) }),
    );
  } catch {
    // Best effort: without it the states read "waiting" until the next read.
  }
}

/** The list as this session may see it: rows loaded or written under another
 *  account are never shown to, or edited by, this one. */
function currentFor(owner: string | null): Backcharge[] {
  return sharedOwner != null && sharedOwner !== owner ? [] : shared;
}

function commit(next: Backcharge[], owner: string | null) {
  publish(next, owner);
  void writeAll(next, owner);
}

// ── Where each write is ─────────────────────────────────────────────────────

async function refreshQueued(): Promise<void> {
  try {
    const read = await getOwnOfflineQueueDetailed();
    const ids = new Set<string>();
    for (const m of read.entries) {
      if (m.table !== BACKCHARGES_TABLE) continue;
      const id = recordIdOf(m.table, m.data);
      if (id) ids.add(id);
    }
    queuedIds = ids;
    queueUnreadable = read.readFailed;
  } catch {
    queueUnreadable = true;
  }
  notify();
}

async function refreshUnsaved(): Promise<void> {
  try {
    unsavedIds = await unsavedWriteIds(BACKCHARGES_TABLE);
  } catch {
    // Keep the last answer.
  }
  notify();
}

function pendingNow(): Set<string> {
  const ids = new Set<string>(queuedIds);
  for (const id of inFlight.keys()) ids.add(id);
  if (queueUnreadable) for (const b of shared) ids.add(b.id);
  return ids;
}

/** Send one backcharge to the account through the offline queue. */
function send(b: Backcharge, owner: string | null): void {
  if (!owner || !isSupabaseConfigured) return;
  inFlight.set(b.id, (inFlight.get(b.id) ?? 0) + 1);
  touchedAt.set(b.id, Date.now());
  savedIds.delete(b.id);
  notify();
  supabaseWriteDetailed(BACKCHARGES_TABLE, 'upsert', toRow(b) as unknown as Record<string, unknown>)
    .catch((): WriteOutcome => 'failed')
    .then((outcome) => {
      const left = (inFlight.get(b.id) ?? 1) - 1;
      if (left > 0) inFlight.set(b.id, left); else inFlight.delete(b.id);
      if (outcome === 'synced' && !inFlight.has(b.id)) savedIds.add(b.id);
      void writeMeta(owner);
      void refreshQueued();
      void refreshUnsaved();
    });
}

/** Read the account and merge it into the shared list. false (and nothing
 *  changed) when the read failed — offline, or the table not there yet. */
async function syncWithAccount(userId: string): Promise<boolean> {
  const startedAt = Date.now();
  const server = await fetchAccountBackcharges();
  if (!server) return false;
  await Promise.all([refreshQueued(), refreshUnsaved()]);
  const meta = await readMeta();
  if (adoptedFor !== userId) { adopted = new Set(); adoptedFor = userId; }
  // Read the device side AFTER the round trip: a backcharge saved while the
  // read was in flight must survive the merge. Rows written under ANOTHER
  // account (the sweep failed, or no remount since a switch) are never sent up
  // under this one.
  let device: Backcharge[];
  let deviceIsThisUsers: boolean;
  if (sharedLoaded && sharedOwner === userId) {
    device = shared;
    deviceIsThisUsers = true;
  } else if (sharedLoaded && sharedOwner == null) {
    device = shared;
    deviceIsThisUsers = meta.userId == null || meta.userId === userId;
  } else {
    device = (await readAll()) ?? [];
    deviceIsThisUsers = meta.userId == null || meta.userId === userId;
  }
  const pending = pendingNow();
  // Written while the read was in flight: the device copy is newer than what
  // the account answered.
  for (const [id, at] of touchedAt) if (at >= startedAt) pending.add(id);
  const { merged, toAdopt, serverIds } = mergeBackcharges({
    device,
    server,
    pendingIds: pending,
    unsavedIds,
    adoptedIds: adopted,
    deviceIsThisUsers,
  });
  const nextSaved = new Set<string>();
  for (const id of savedIds) if (merged.some(b => b.id === id)) nextSaved.add(id);
  for (const id of meta.userId === userId ? meta.savedIds : []) nextSaved.add(id);
  for (const id of serverIds) nextSaved.add(id);
  savedIds = nextSaved;
  // Before commit: its notify must already see the list as complete.
  accountReadFor = userId;
  commit(merged, userId);
  for (const b of toAdopt) {
    adopted.add(b.id);
    send(b, userId);
  }
  return true;
}

// Screens outside a QueryClientProvider (component tests) still get a client.
let fallbackClient: QueryClient | null = null;
function clientFallback(): QueryClient {
  if (!fallbackClient) fallbackClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return fallbackClient;
}

export function useBackcharges(): {
  list: Backcharge[];
  loaded: boolean;
  add: (b: Backcharge) => void;
  update: (id: string, patch: Partial<Backcharge>) => void;
  applyToInvoice: (ids: string[], invoiceId: string) => void;
  voidOne: (id: string) => void;
  /** Where one backcharge is kept: saved / waiting / not_saved / device. */
  statusOf: (id: string) => BackchargeSaveState;
  /** A signed-in session with a configured account: writes go to the account. */
  signedIn: boolean;
  /** Resend the refused writes of these backcharges (the Not saved Retry). */
  retryNotSaved: (ids: readonly string[]) => void;
  /** The list is the whole record: signed out, the device copy is read;
   *  signed in, the account's read came back for this user this session.
   *  A scorecard passes backchargesForScorecard(list, complete). */
  complete: boolean;
} {
  const [, setTick] = useState(0);
  // useAuth() is undefined outside AuthProvider (component tests): signed out.
  const userId = useAuth()?.user?.id ?? null;
  const signedIn = !!userId && isSupabaseConfigured;
  const owner = signedIn ? userId : null;
  const queryClient = useContext(QueryClientContext) ?? clientFallback();

  useEffect(() => {
    let alive = true;
    const l = () => { if (alive) setTick(t => t + 1); };
    listeners.add(l);
    const at = version;
    void Promise.all([readAll(), readMeta()]).then(([list, meta]) => {
      if (!alive) return;
      // What the account confirmed last time, so a saved row does not read
      // "waiting" while the first read of this session is in flight.
      if (owner && meta.userId === owner) for (const id of meta.savedIds) savedIds.add(id);
      // A newer in-memory change (a merge, an add) wins over this older read.
      // The list is labelled with the account it was written under.
      if (list && version === at) publish(list, meta.userId ?? owner);
      else if (!sharedLoaded) publish(shared, owner);
    });
    return () => { alive = false; listeners.delete(l); };
  }, [owner]);

  // Which writes are waiting or refused, kept current.
  useEffect(() => {
    if (!signedIn) return;
    void refreshQueued();
    void refreshUnsaved();
    const offQueue = onQueueChanged(() => { void refreshQueued(); });
    const offLedger = onSyncLedgerChanged(() => { void refreshUnsaved(); });
    const offFlush = onQueueFlushed((tables) => {
      if (!tables.has(BACKCHARGES_TABLE)) return;
      void refreshQueued();
      void queryClient.invalidateQueries({ queryKey: ['backcharges', userId] });
    });
    return () => { offQueue(); offLedger(); offFlush(); };
  }, [signedIn, userId, queryClient]);

  useQuery({
    queryKey: ['backcharges', userId],
    enabled: signedIn,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => (userId ? syncWithAccount(userId) : false),
  }, queryClient);

  const add = useCallback((b: Backcharge) => {
    commit([...currentFor(owner).filter(x => x.id !== b.id), b], owner);
    send(b, owner);
  }, [owner]);
  const update = useCallback((id: string, patch: Partial<Backcharge>) => {
    const next = currentFor(owner).map(b => (b.id === id ? { ...b, ...patch, id: b.id } : b));
    commit(next, owner);
    const changed = next.find(b => b.id === id);
    if (changed) send(changed, owner);
  }, [owner]);
  const applyToInvoice = useCallback((ids: string[], invoiceId: string) => {
    const before = currentFor(owner);
    const next = markApplied(before, ids, invoiceId, new Date().toISOString());
    commit(next, owner);
    next.forEach((b, i) => { if (b !== before[i]) send(b, owner); });
  }, [owner]);
  const voidOne = useCallback((id: string) => {
    const before = currentFor(owner);
    const next = before.map(b => (b.id === id && b.status === 'open' ? { ...b, status: 'void' as const } : b));
    commit(next, owner);
    next.forEach((b, i) => { if (b !== before[i]) send(b, owner); });
  }, [owner]);

  // Only what the device's own queue reports is "waiting" (the back-online
  // line); a write on the wire, or a row the account has not confirmed yet,
  // reads unconfirmed. pendingNow() (queue + in flight + unreadable) is still
  // what the merge protects.
  const stateInput = { signedIn, unsavedIds, pendingIds: queuedIds, savedIds, queueUnreadable };
  const statusOf = (id: string) => saveStateOf(id, stateInput);

  const retryNotSaved = useCallback((ids: readonly string[]) => {
    const want = new Set(ids);
    void (async () => {
      const own = await ownUnsavedWrites();
      const seen = new Set<string>();
      for (const f of own) {
        if (f.table !== BACKCHARGES_TABLE || !f.recordId || !want.has(f.recordId) || seen.has(f.recordId)) continue;
        // One Retry per record: it replays that record's writes oldest first.
        seen.add(f.recordId);
        await retryUnsavedWrite(f.id).catch(() => 'failed' as const);
      }
      await Promise.all([refreshQueued(), refreshUnsaved()]);
    })();
  }, []);

  const complete = backchargesComplete({
    signedIn, userId: owner, deviceLoaded: sharedLoaded, listOwner: sharedOwner, accountReadFor,
  });

  return {
    list: currentFor(owner), loaded: sharedLoaded, add, update, applyToInvoice, voidOne, statusOf, signedIn, retryNotSaved,
    complete,
  };
}
