/**
 * Code Thread — the I/O half of the saved-code-check cloud sync.
 *
 * public.code_checks (20260926180000) holds one row per saved check. Writes go
 * through utils/offlineQueue supabaseWriteDetailed (never supabase.from(…)
 * .upsert directly); reads are merged with the device copy by the pure
 * utils/codeThread/syncMerge.ts. The offline queue and the supabase client are
 * required lazily (the house pattern, utils/syncLedger queueModule), so the
 * store — which requires this module after every local write — stays
 * importable by the bun validators.
 *
 * WHO MAY PUSH: RLS inserts/updates code_checks at can_access_project(…,
 * 'field') — owner, editor or field seat. The seat is registered by
 * hooks/useCodeChecks (setCodeCheckSeat) from useProjectRoleState with the
 * owner fallback (effectivePlanRole). Until it is known, nothing is pushed;
 * the hook's sync runs once it is, and the merge re-pushes anything
 * local-only or local-newer — a skipped push is picked up, never lost.
 *
 * STATE per job (what the caption says):
 *   local   — can't sync here (no backend, signed out, sample / unsynced job);
 *   seat    — this seat can't write code checks (viewer);
 *   syncing — the read is in flight, or the seat is still unknown;
 *   synced  — the account read succeeded AND every push returned 'synced';
 *   offline — a push was queued, or the read never reached the server;
 *   failed  — the read was answered with an error;
 *   refused — a push was refused for good. It holds until a later sync ends
 *             with no refused push.
 */
import { nextPushStamp, seatCanWrite, stampMs, type SeatReadStatus, type SyncSeatRole } from '@/utils/syncSeat';
import { isTransportError } from '@/utils/networkErrors';
import type { WriteOutcome } from '@/utils/offlineQueue';
import { notifyCodeChecks, replaceProjectChecks } from './store';
import { codeCheckRow, mergeCodeCheckLists, recordFromRow } from './syncMerge';
import type { CodeCheckRecord } from './types';

export type CodeCheckSyncState = 'local' | 'seat' | 'syncing' | 'synced' | 'offline' | 'failed' | 'refused';
export type CodeCheckSyncVerdict = 'ok' | 'local' | 'seat' | 'seat_unknown';

/** Where the saved checks are, by sync state (ProjectCodeChecksCard re-exports it).
 *  'Saved to your account' ONLY in 'synced': the account read and every push
 *  for this job succeeded. */
export const CODE_CHECKS_CAPTION: Record<CodeCheckSyncState, string> = {
  local: 'Saved on this device until you sign out.',
  seat: 'Saved on this device — your seat on this job can’t save code checks to the account.',
  syncing: 'Saved on this device — checking your account…',
  synced: 'Saved to your account — on every device you sign in to.',
  offline: 'Saved on this device — it syncs to your account when you’re back online.',
  failed: 'Saved on this device — couldn’t reach your account, so it may not be on your other devices yet.',
  refused: 'Saved on this device only — your account didn’t accept this save, so it isn’t on your other devices.',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OfflineQueueModule = typeof import('@/utils/offlineQueue');
type SupabaseModule = typeof import('@/lib/supabase');

function cloudModules(): { queue: OfflineQueueModule; sb: SupabaseModule } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sb = require('@/lib/supabase') as SupabaseModule;
    if (!sb.isSupabaseConfigured) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const queue = require('@/utils/offlineQueue') as OfflineQueueModule;
    return { queue, sb };
  } catch {
    return null;
  }
}

// ── seat registry ───────────────────────────────────────────────────────────
export interface SeatEntry { role: SyncSeatRole; sample: boolean; readStatus: SeatReadStatus }
const seats = new Map<string, SeatEntry>();

/** May this registered seat push code checks? (A sample job never does.) */
const seatWrites = (e: SeatEntry): boolean => !e.sample && seatCanWrite(e.role, 'field') === true;

/**
 * Is a re-sync owed on this seat change? Yes only on a TRANSITION into a
 * writable seat — from role null (a failed / offline / loading role read) or a
 * read-only seat — for a job whose sync has already run this session. The
 * first sync is useCodeChecks' own (once per mount per job); after it, a role
 * read that fails and then recovers would otherwise leave the caption on
 * 'failed' until a remount or the next save. One sync per transition: a seat
 * that stays writable owes nothing, and syncCodeChecksForProject never starts
 * a second sync while one is in flight for the job.
 */
export function codeCheckResyncOwed(prev: SeatEntry | undefined, next: SeatEntry, syncedBefore: boolean): boolean {
  if (!prev || !syncedBefore) return false;
  return !seatWrites(prev) && seatWrites(next);
}

/**
 * hooks/useCodeChecks registers the job's seat (effectivePlanRole) whenever it
 * changes, with WHY it is null when it is (seatReadStatus: #90 — a failed,
 * offline or settled-no-access read never reads as "checking…").
 */
export function setCodeCheckSeat(
  projectId: string,
  role: SyncSeatRole,
  opts?: { sample?: boolean; readStatus?: SeatReadStatus },
): void {
  if (!projectId) return;
  const prev = seats.get(projectId);
  const next: SeatEntry = { role, sample: !!opts?.sample, readStatus: opts?.readStatus ?? 'loading' };
  seats.set(projectId, next);
  if (!prev || prev.role !== next.role || prev.sample !== next.sample || prev.readStatus !== next.readStatus) {
    // A seat that became readable-only (or unknown) must not keep a stale caption.
    const quick = quickVerdictState(projectId);
    if (next.role === null || quick === 'seat' || quick === 'local') setState(projectId, quick);
    // …and one that became writable again re-syncs once, saying 'syncing'
    // (never over a 'refused' the sync itself keeps until it ends clean).
    if (quick === 'syncing' && codeCheckResyncOwed(prev, next, syncAttempted.has(projectId))) {
      if (states.get(projectId) !== 'refused') setState(projectId, 'syncing');
      void syncCodeChecksForProject(projectId).catch(() => { /* the state says why */ });
    }
  }
}

/** The caption for a seat whose role is null, by why it is null. */
export function unknownSeatState(readStatus: SeatReadStatus | undefined): CodeCheckSyncState {
  if (readStatus === 'failed') return 'failed';
  if (readStatus === 'offline') return 'offline';
  if (readStatus === 'none') return 'seat';
  return 'syncing';
}

// ── state ───────────────────────────────────────────────────────────────────
const states = new Map<string, CodeCheckSyncState>();

function setState(projectId: string, s: CodeCheckSyncState): void {
  // Compared with what a reader sees NOW (the stored state or the quick
  // verdict), so confirming the obvious wakes no one.
  const shown = getCodeCheckSyncState(projectId);
  states.set(projectId, s);
  if (shown !== s) notifyCodeChecks();
}

/** What can be said without a round trip (used before the first sync lands). */
function quickVerdictState(projectId: string): CodeCheckSyncState {
  if (!UUID_RE.test(projectId) || !cloudModules()) return 'local';
  const seat = seats.get(projectId);
  if (seat?.sample) return 'local';
  if (seat && seat.role === null) return unknownSeatState(seat.readStatus);
  if (seat && seatCanWrite(seat.role, 'field') === false) return 'seat';
  return 'syncing';
}

export function getCodeCheckSyncState(projectId: string | null | undefined): CodeCheckSyncState {
  if (!projectId) return 'local';
  return states.get(projectId) ?? quickVerdictState(projectId);
}

const stateForVerdict = (projectId: string, v: Exclude<CodeCheckSyncVerdict, 'ok'>): CodeCheckSyncState =>
  v === 'seat_unknown' ? unknownSeatState(seats.get(projectId)?.readStatus) : v;

// ── the gate ────────────────────────────────────────────────────────────────
async function verdictWithUser(projectId: string): Promise<{ verdict: CodeCheckSyncVerdict; userId: string | null }> {
  const cloud = cloudModules();
  if (!cloud || !UUID_RE.test(projectId)) return { verdict: 'local', userId: null };
  let userId: string | null = null;
  try {
    userId = await cloud.queue.currentSessionUserId();
  } catch {
    userId = null;
  }
  if (!userId) return { verdict: 'local', userId: null };
  const seat = seats.get(projectId);
  if (seat?.sample) return { verdict: 'local', userId };
  if (!seat || seat.role === null) return { verdict: 'seat_unknown', userId };
  if (seatCanWrite(seat.role, 'field') === false) return { verdict: 'seat', userId };
  return { verdict: 'ok', userId };
}

export async function canSyncCodeChecks(projectId: string): Promise<CodeCheckSyncVerdict> {
  return (await verdictWithUser(projectId)).verdict;
}

// ── server stamps ───────────────────────────────────────────────────────────
// The newest updated_at we have seen on the server per check id, filled by
// every successful read and push. A push stamps past it (nextPushStamp), so a
// device whose clock runs behind never has its newer edit ignored by the
// server's keep-newest trigger.
const lastServerMs = new Map<string, number>();

function noteServerMs(id: string, ms: number | null): void {
  if (ms == null) return;
  const had = lastServerMs.get(id);
  if (had == null || ms > had) lastServerMs.set(id, ms);
}

// ── push ────────────────────────────────────────────────────────────────────
async function pushOne(
  rec: CodeCheckRecord,
  userId: string,
  cloud: { queue: OfflineQueueModule },
): Promise<WriteOutcome> {
  const stamp = nextPushStamp(Date.now(), lastServerMs.get(rec.id) ?? null);
  if (stamp !== rec.updatedAt) {
    // Write the pushed stamp into the device copy so the next merge compares
    // the same instant on both sides. Skipped when the record moved on
    // meanwhile (its own push carries the newer copy).
    await replaceProjectChecks(rec.projectId, (cur) => {
      const idx = cur.findIndex((r) => r.id === rec.id);
      if (idx < 0 || cur[idx].updatedAt !== rec.updatedAt) return cur;
      const next = [...cur];
      next[idx] = { ...cur[idx], updatedAt: stamp };
      return next;
    });
  }
  let outcome: WriteOutcome;
  try {
    outcome = await cloud.queue.supabaseWriteDetailed('code_checks', 'upsert', { ...codeCheckRow(rec, userId, stamp) });
  } catch {
    outcome = 'failed';
  }
  if (outcome === 'synced') noteServerMs(rec.id, stampMs(stamp));
  return outcome;
}

/**
 * Push one record (the store calls this after every successful local write).
 * Only an 'ok' verdict pushes; anything else returns 'skipped' and the next
 * syncCodeChecksForProject picks the record up.
 */
export async function pushCodeCheck(rec: CodeCheckRecord): Promise<WriteOutcome | 'skipped'> {
  if (!rec?.id || !rec.projectId) return 'skipped';
  const cloud = cloudModules();
  const { verdict, userId } = await verdictWithUser(rec.projectId);
  if (verdict !== 'ok' || !cloud || !userId) {
    setState(rec.projectId, stateForVerdict(rec.projectId, verdict === 'ok' ? 'local' : verdict));
    return 'skipped';
  }
  const outcome = await pushOne(rec, userId, cloud);
  // 'synced' leaves the state alone: it reads 'synced' only if the job already
  // did (a full sync proved the rest). 'queued' → offline, 'failed' → refused.
  const cur = getCodeCheckSyncState(rec.projectId);
  if (outcome === 'failed') setState(rec.projectId, 'refused');
  else if (outcome === 'queued' && cur !== 'refused') setState(rec.projectId, 'offline');
  return outcome;
}

// ── the full sync (read → merge → write → push) ─────────────────────────────
const inFlight = new Map<string, Promise<CodeCheckSyncState>>();
// Jobs whose sync has been asked for this session (setCodeCheckSeat re-syncs
// only these: before the first sync, useCodeChecks runs it).
const syncAttempted = new Set<string>();

export function syncCodeChecksForProject(projectId: string): Promise<CodeCheckSyncState> {
  syncAttempted.add(projectId);
  const running = inFlight.get(projectId);
  if (running) return running;
  const p = runSync(projectId).finally(() => { inFlight.delete(projectId); });
  inFlight.set(projectId, p);
  return p;
}

async function runSync(projectId: string): Promise<CodeCheckSyncState> {
  const cloud = cloudModules();
  const { verdict, userId } = await verdictWithUser(projectId);
  if (verdict !== 'ok' || !cloud || !userId) {
    const s = stateForVerdict(projectId, verdict === 'ok' ? 'local' : verdict);
    setState(projectId, s);
    return s;
  }
  const wasRefused = states.get(projectId) === 'refused';
  if (!wasRefused) setState(projectId, 'syncing');

  // 1. the account copy
  let rows: unknown[];
  try {
    const res = await cloud.sb.supabase
      .from('code_checks')
      .select('id, project_id, record, updated_at')
      .eq('project_id', projectId);
    if (res.error) {
      const s: CodeCheckSyncState = isTransportError(res.error) ? 'offline' : 'failed';
      setState(projectId, wasRefused ? 'refused' : s);
      return s;
    }
    rows = Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    const s: CodeCheckSyncState = isTransportError(err) ? 'offline' : 'failed';
    setState(projectId, wasRefused ? 'refused' : s);
    return s;
  }
  const server: CodeCheckRecord[] = [];
  for (const row of rows) {
    const parsed = recordFromRow(row);
    if (!parsed) continue;
    noteServerMs(parsed.rec.id, parsed.serverMs);
    server.push(parsed.rec);
  }

  // 2 + 3. merge with what the device holds NOW (under the store lock), write when it differs
  let push: CodeCheckRecord[] = [];
  const wrote = await replaceProjectChecks(projectId, (cur) => {
    const m = mergeCodeCheckLists(cur, server);
    push = m.push;
    let same = false;
    try { same = JSON.stringify(m.merged) === JSON.stringify(cur); } catch { same = false; }
    return same ? cur : m.merged;
  });
  if (!wrote) {
    // The device blob is unreadable (or refused the write): never push a
    // merge that could not be saved here. The card says it couldn't read.
    setState(projectId, 'failed');
    return 'failed';
  }

  // 4. push what the merge asked for
  const outcomes = await Promise.all(push.map((rec) => pushOne(rec, userId, cloud)));
  let s: CodeCheckSyncState = 'synced';
  if (outcomes.includes('queued')) s = 'offline';
  if (outcomes.includes('failed')) s = 'refused';
  setState(projectId, s);
  return s;
}
