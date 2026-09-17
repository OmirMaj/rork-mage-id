// scheduleAudit — append-only log of every schedule mutation.
//
// Closes the gap that P6's audit famously misses: dependency / logic
// changes. Every CPM-affecting edit lands here with timestamp + user +
// before/after.
//
// Storage, two copies:
//   * AsyncStorage (key `mageid_schedule_audit::<projectId>`) — the fast,
//     offline copy, capped at 500 entries per project (FIFO). It is under the
//     `mageid_` prefix, so the sign-out sweep removes it: it is a CACHE.
//   * public.schedule_audit_log (supabase/migrations/20260917100000_schedule_
//     audit_log.sql) — the record. Every append is upserted there through the
//     offline queue; nothing trims it. Delay events point into this log
//     ({kind: 'schedule_audit', id}), and a delay claim is argued months later
//     from exactly these rows, so a pointer must resolve on any device and
//     after any sign-out — which the device copy alone could never promise.
//
// The field `ProjectSchedule.auditLog` used to exist for "ride-with-
// the-schedule" persistence, but nothing ever populated it and v2.1
// removed it.

import { calendarDayOf } from '@/utils/calendarDate';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ScheduleAuditEntry } from '@/types';

const STORAGE_KEY_PREFIX = 'mageid_schedule_audit::';
const MAX_ENTRIES = 500;

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildAuditEntry(
  partial: Omit<ScheduleAuditEntry, 'id' | 'at'>,
): ScheduleAuditEntry {
  return { ...partial, id: generateId(), at: new Date().toISOString() };
}

/**
 * Append an entry to a schedule's existing audit log, capped at
 * MAX_ENTRIES (FIFO eviction). Returns the new array — caller persists
 * via updateProject. Pure function; no side effects.
 */
export function appendAuditEntry(
  existing: ScheduleAuditEntry[] | undefined,
  partial: Omit<ScheduleAuditEntry, 'id' | 'at'>,
): ScheduleAuditEntry[] {
  const entry = buildAuditEntry(partial);
  const next = [entry, ...(existing ?? [])].slice(0, MAX_ENTRIES);
  return next;
}

/**
 * Diff helper: given a "before" task and an "after" task, return a
 * brief one-line summary describing what changed. Used by the audit
 * UI so a row says "Drywall: duration 5d → 7d, started" rather than
 * dumping the whole task object.
 */
export function summarizeTaskDiff(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): string {
  if (!before || !after) return 'edited';
  const parts: string[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (before[k] === after[k]) continue;
    if (k === 'progress') parts.push(`progress ${before[k] ?? 0}% → ${after[k] ?? 0}%`);
    else if (k === 'durationDays') parts.push(`duration ${before[k]}d → ${after[k]}d`);
    else if (k === 'startDay') parts.push(`start day ${before[k]} → ${after[k]}`);
    else if (k === 'crew') parts.push(`crew → ${after[k] || '(none)'}`);
    else if (k === 'status') parts.push(`status → ${after[k]}`);
    else if (k === 'dependencies') parts.push('dependencies changed');
    else parts.push(`${k} changed`);
  }
  return parts.length === 0 ? 'edited' : parts.join(' · ');
}

// ─────────────────────────────────────────────
// AsyncStorage side-channel (the device copy)
// ─────────────────────────────────────────────

function asyncKey(projectId: string): string {
  return `${STORAGE_KEY_PREFIX}${projectId}`;
}

// Every read-modify-write of one project's device copy runs through this
// chain. Two appends a tick apart (a task edit and the reflow it causes) used
// to race: both read the same array and the second write erased the first
// entry. The cloud hydrate below writes the same key, which made the race
// likelier, so it serialises here too.
const projectWriteChains = new Map<string, Promise<unknown>>();
function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = projectWriteChains.get(projectId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  projectWriteChains.set(projectId, tail);
  void tail.then(() => {
    if (projectWriteChains.get(projectId) === tail) projectWriteChains.delete(projectId);
  });
  return run;
}

/** The DEVICE copy only (newest first, ≤ 500). Screens that show the log to a
 *  person should use loadScheduleAudit, which also reads the server copy. */
export async function loadAuditFromAsyncStorage(projectId: string): Promise<ScheduleAuditEntry[]> {
  if (!projectId) return [];
  try {
    const raw = await AsyncStorage.getItem(asyncKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ScheduleAuditEntry[]) : [];
  } catch { return []; }
}

/**
 * Record one entry: onto the device copy first (so History shows it at once,
 * offline included), then upserted to public.schedule_audit_log through the
 * offline queue.
 *
 * The name predates the server copy and is kept because three files call it
 * (schedule-pro, the phone schedule, ProjectContext's CO reflow) — each of them
 * gets the sync without changing a line. Callers `void` it; it never throws.
 */
export async function appendAuditToAsyncStorage(
  projectId: string,
  entry: ScheduleAuditEntry,
): Promise<void> {
  if (!projectId) return;
  await withProjectLock(projectId, async () => {
    try {
      const existing = await loadAuditFromAsyncStorage(projectId);
      const next = [entry, ...existing.filter((e) => e?.id !== entry.id)].slice(0, MAX_ENTRIES);
      await AsyncStorage.setItem(asyncKey(projectId), JSON.stringify(next));
    } catch (e) { console.warn('[audit] async save failed', e); }
  });
  await pushAuditEntry(projectId, entry);
}

// ─────────────────────────────────────────────
// Server copy — public.schedule_audit_log
// ─────────────────────────────────────────────
//
// The rules the mirror lives or dies by, pinned by
// scripts/validate-schedule-audit-sync.ts:
//
//   1. ONE ROW PER ENTRY. The row id IS the entry id and every write is an
//      upsert, so a queue replay, a backfill racing a live push, or two
//      devices sending the same entry all land on one row. The table keeps the
//      first-written content (a BEFORE UPDATE trigger), so a replay can never
//      rewrite history either.
//   2. THE SERVER COPY WINS, EXCEPT OVER A WRITE THAT HAS NOT LANDED. An entry
//      whose upsert is still in the offline queue (or in flight from this
//      session) keeps its device copy — and is kept even when the device copy
//      is gone, which is the same-user re-auth case: the sign-in sweep emptied
//      the cache but kept the queue, so the queued row is the only copy.
//   3. NOTHING IS DROPPED. A device entry the server has never seen is kept
//      and sent up (the backfill that rescues history recorded before the table
//      existed); entries are de-duplicated by id and never deleted.
//
// offlineQueue and lib/supabase are required lazily: both pull in
// react-native, which crashes bun, and the pure functions below (and
// summarizeTaskDiff, used by validate-schedule-verdict) must stay importable
// from a validator.

export const SCHEDULE_AUDIT_TABLE = 'schedule_audit_log';
/** Newest rows read per project in one load. Also PostgREST's usual max-rows,
 *  so asking for more would not return more. Older entries stay on the server
 *  and are fetched by id when a delay event points at one. */
export const SCHEDULE_AUDIT_CLOUD_READ_LIMIT = 1000;

export interface AuditRowWrite { id: string; row: Record<string, unknown> }

/** An entry the table can hold: an id, a real timestamp, a kind. Anything else
 *  would be a TERMINAL write error (invalid timestamptz / NOT NULL), which the
 *  queue answers with a "Couldn't save" toast — so it stays on the device. */
export function isSyncableAuditEntry(e: ScheduleAuditEntry | null | undefined): e is ScheduleAuditEntry {
  return !!e
    && typeof e.id === 'string' && e.id.length > 0
    && typeof e.at === 'string' && Number.isFinite(Date.parse(e.at))
    && typeof e.kind === 'string' && e.kind.length > 0;
}

export function auditEntryToRow(projectId: string, userId: string, e: ScheduleAuditEntry): Record<string, unknown> {
  return {
    id: e.id,
    user_id: userId,
    project_id: projectId,
    at: e.at,
    actor: typeof e.user === 'string' ? e.user : '',
    kind: e.kind,
    task_id: e.taskId ?? null,
    task_title: e.taskTitle ?? null,
    change_order_id: e.changeOrderId ?? null,
    summary: typeof e.summary === 'string' ? e.summary : '',
    before: e.before ?? null,
    after: e.after ?? null,
  };
}

const nonEmpty = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const jsonObject = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/** A server (or queued) row back into an entry; null when it has no id or no
 *  readable time. timestamptz comes back as `…+00:00`; normalised to the `…Z`
 *  the device writes, so a round-tripped entry reads identically. */
export function rowToAuditEntry(r: Record<string, unknown>): ScheduleAuditEntry | null {
  const id = nonEmpty(r.id);
  const atRaw = nonEmpty(r.at);
  const ms = atRaw ? Date.parse(atRaw) : NaN;
  if (!id || !Number.isFinite(ms)) return null;
  const entry: ScheduleAuditEntry = {
    id,
    at: new Date(ms).toISOString(),
    user: typeof r.actor === 'string' ? r.actor : '',
    kind: (nonEmpty(r.kind) ?? 'task_edit') as ScheduleAuditEntry['kind'],
    summary: typeof r.summary === 'string' ? r.summary : '',
  };
  const taskId = nonEmpty(r.task_id);
  const taskTitle = nonEmpty(r.task_title);
  const changeOrderId = nonEmpty(r.change_order_id);
  const before = jsonObject(r.before);
  const after = jsonObject(r.after);
  if (taskId) entry.taskId = taskId;
  if (taskTitle) entry.taskTitle = taskTitle;
  if (changeOrderId) entry.changeOrderId = changeOrderId;
  if (before) entry.before = before;
  if (after) entry.after = after;
  return entry;
}

/** Newest first by the time the change happened. Stable, so entries stamped in
 *  the same millisecond keep the order they were recorded in; an entry with an
 *  unreadable time sinks to the bottom rather than vanishing. */
export function sortAuditNewestFirst(entries: ScheduleAuditEntry[]): ScheduleAuditEntry[] {
  const t = (e: ScheduleAuditEntry) => {
    const ms = Date.parse(e.at);
    return Number.isFinite(ms) ? ms : -Infinity;
  };
  return [...entries].sort((a, b) => t(b) - t(a));
}

/**
 * Reconcile one project's device copy with the server's rows (rules 2 and 3
 * above). `pending` maps entry id → the row of an upsert that has not landed
 * (the offline queue, plus this session's in-flight pushes). Returns every
 * entry, newest first and de-duplicated by id, plus the device entries the
 * server has never seen, which the caller sends up.
 */
export function mergeAuditWithCloud(
  local: readonly ScheduleAuditEntry[],
  cloudRows: readonly Record<string, unknown>[],
  pending: ReadonlyMap<string, Record<string, unknown>>,
  projectId: string,
  userId: string,
): { entries: ScheduleAuditEntry[]; backfill: AuditRowWrite[] } {
  const cloudById = new Map<string, ScheduleAuditEntry>();
  for (const r of cloudRows) {
    // The read filters by project; this is the second lock on the same door,
    // so another job's history can never be filed under this one.
    if (r.project_id !== projectId) continue;
    const e = rowToAuditEntry(r);
    if (e && !cloudById.has(e.id)) cloudById.set(e.id, e);
  }

  const merged = new Map<string, ScheduleAuditEntry>();
  const backfill: AuditRowWrite[] = [];
  for (const e of local) {
    if (!e || typeof e.id !== 'string' || e.id.length === 0 || merged.has(e.id)) continue;
    if (pending.has(e.id)) { merged.set(e.id, e); continue; }
    const remote = cloudById.get(e.id);
    if (remote) { merged.set(e.id, remote); continue; }
    merged.set(e.id, e);
    if (isSyncableAuditEntry(e)) backfill.push({ id: e.id, row: auditEntryToRow(projectId, userId, e) });
  }
  // Queued writes the device copy no longer holds (the re-auth case).
  for (const [id, row] of pending) {
    if (merged.has(id) || row.project_id !== projectId) continue;
    const e = rowToAuditEntry(row);
    if (e) merged.set(id, e);
  }
  for (const [id, e] of cloudById) {
    if (!merged.has(id)) merged.set(id, e);
  }
  return { entries: sortAuditNewestFirst(Array.from(merged.values())), backfill };
}

/** Ids safe to splice into a PostgREST `in.(…)` filter. supabase-js does not
 *  escape list values, so an id holding `,` `(` `)` or a quote would rewrite
 *  the filter. Entry ids are uuids or `aud_<ts>_<rand>`; nothing else is sent. */
export function isQueryableAuditId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

// ── I/O ──────────────────────────────────────

type OfflineQueueModule = typeof import('@/utils/offlineQueue');
type SupabaseModule = typeof import('@/lib/supabase');

function cloudModules(): { queue: OfflineQueueModule; sb: SupabaseModule } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const queue = require('@/utils/offlineQueue') as OfflineQueueModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sb = require('@/lib/supabase') as SupabaseModule;
    return sb.isSupabaseConfigured ? { queue, sb } : null;
  } catch {
    return null;
  }
}

// Rows this session has handed to the queue's write path and not yet heard
// back about. A load that starts mid-push must treat them as pending (rule 2),
// or it would take the server's "never heard of it" as the truth.
const inFlightRows = new Map<string, Record<string, unknown>>();

async function pushAuditEntry(projectId: string, entry: ScheduleAuditEntry): Promise<void> {
  if (!isSyncableAuditEntry(entry)) return;
  const mods = cloudModules();
  if (!mods) return;
  try {
    const userId = await mods.queue.currentSessionUserId();
    // Signed out: it stays on the device, and the next signed-in load offers it
    // up as backfill.
    if (!userId) return;
    const row = auditEntryToRow(projectId, userId, entry);
    inFlightRows.set(entry.id, row);
    try {
      await mods.queue.supabaseWriteDetailed(SCHEDULE_AUDIT_TABLE, 'upsert', row);
    } finally {
      inFlightRows.delete(entry.id);
    }
  } catch (e) {
    console.warn('[audit] cloud push failed; entry stays on this device', e);
  }
}

/** Where the entries a screen is showing came from. 'local-only' means the
 *  server copy could not be read (offline, signed out, table not migrated yet,
 *  offline queue unreadable) — a screen must say so rather than present the
 *  device's partial history as the whole record. */
export type ScheduleAuditSource = 'cloud' | 'local-only';

export interface ScheduleAuditLoad {
  entries: ScheduleAuditEntry[];
  source: ScheduleAuditSource;
  /** The server returned a full page: older entries exist beyond what is shown. */
  truncated: boolean;
}

const backfillingProjects = new Set<string>();

/**
 * The log as a person should see it: the device copy merged with the server
 * copy (see the rules above). Refreshes the device cache with the merge and
 * sends up anything the server is missing in the background. Never throws;
 * when the server cannot be read it returns the device copy, labelled.
 */
export async function loadScheduleAudit(projectId: string): Promise<ScheduleAuditLoad> {
  const local = await loadAuditFromAsyncStorage(projectId);
  const localOnly: ScheduleAuditLoad = { entries: local, source: 'local-only', truncated: false };
  if (!projectId) return localOnly;
  const mods = cloudModules();
  if (!mods) return localOnly;
  try {
    const userId = await mods.queue.currentSessionUserId();
    if (!userId) return localOnly;
    const { data, error } = await mods.sb.supabase
      .from(SCHEDULE_AUDIT_TABLE)
      .select('*')
      .eq('project_id', projectId)
      .order('at', { ascending: false })
      .limit(SCHEDULE_AUDIT_CLOUD_READ_LIMIT);
    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    // Unreadable queue = unknown pending work. Letting the server win blind
    // could present a queued entry as never having happened.
    const queued = await mods.queue.getOwnOfflineQueueDetailed();
    if (queued.readFailed) throw new Error('offline queue unreadable');
    const pending = new Map<string, Record<string, unknown>>();
    for (const m of queued.entries) {
      if (m.table === SCHEDULE_AUDIT_TABLE && typeof m.data?.id === 'string') pending.set(m.data.id, m.data);
    }
    for (const [id, row] of inFlightRows) pending.set(id, row);

    let result: { entries: ScheduleAuditEntry[]; backfill: AuditRowWrite[] } | null = null;
    await withProjectLock(projectId, async () => {
      // Re-read under the lock: an append that landed since the first read is
      // part of the merge, not overwritten by it.
      const latest = await loadAuditFromAsyncStorage(projectId);
      result = mergeAuditWithCloud(latest, rows, pending, projectId, userId);
      // A sign-out while the read was on the wire has already swept this key;
      // writing the merge back would restore the previous tenant's history.
      if ((await mods.queue.currentSessionUserId()) !== userId) return;
      try {
        await AsyncStorage.setItem(asyncKey(projectId), JSON.stringify(result.entries.slice(0, MAX_ENTRIES)));
      } catch (err) {
        console.warn('[audit] cache write after cloud merge failed', err);
      }
    });
    const merged = result as { entries: ScheduleAuditEntry[]; backfill: AuditRowWrite[] } | null;
    if (!merged) return localOnly;
    if (merged.backfill.length > 0 && !backfillingProjects.has(projectId)) {
      backfillingProjects.add(projectId);
      void (async () => {
        try {
          for (const w of merged.backfill) {
            const outcome = await mods.queue.supabaseWriteDetailed(SCHEDULE_AUDIT_TABLE, 'upsert', w.row);
            // Hundreds of rows against a server that stopped answering would
            // flood the FIFO-capped offline queue and push out someone's daily
            // report. Stop; the rest stay on the device for the next load.
            if (outcome !== 'synced') break;
          }
        } catch (err) {
          console.warn('[audit] backfill stopped', err);
        } finally {
          backfillingProjects.delete(projectId);
        }
      })();
    }
    return { entries: merged.entries, source: 'cloud', truncated: rows.length >= SCHEDULE_AUDIT_CLOUD_READ_LIMIT };
  } catch (err) {
    console.warn('[audit] server copy unavailable, showing this device only', err);
    return localOnly;
  }
}

/**
 * Resolve specific entries by id — for a delay event whose evidence points at
 * an entry older than the newest SCHEDULE_AUDIT_CLOUD_READ_LIMIT, or recorded on
 * another device. `source: 'local-only'` means the server could not be asked,
 * so "not found" is NOT a verdict.
 */
export async function findScheduleAuditEntries(
  projectId: string,
  ids: readonly string[],
): Promise<{ found: ScheduleAuditEntry[]; source: ScheduleAuditSource }> {
  const local = await loadAuditFromAsyncStorage(projectId);
  const wanted = new Set(ids);
  const fromDevice = local.filter((e) => wanted.has(e.id));
  const mods = cloudModules();
  if (!projectId || !mods) return { found: fromDevice, source: 'local-only' };
  // Signed out, RLS answers every lookup with nothing — an empty answer that
  // would read as "this entry does not exist".
  let userId: string | null = null;
  try { userId = await mods.queue.currentSessionUserId(); } catch { userId = null; }
  if (!userId) return { found: fromDevice, source: 'local-only' };
  const queryable = Array.from(wanted).filter(isQueryableAuditId);
  try {
    const found = new Map<string, ScheduleAuditEntry>(fromDevice.map((e) => [e.id, e]));
    for (let i = 0; i < queryable.length; i += 100) {
      const chunk = queryable.slice(i, i + 100);
      const { data, error } = await mods.sb.supabase
        .from(SCHEDULE_AUDIT_TABLE)
        .select('*')
        .eq('project_id', projectId)
        .in('id', chunk);
      if (error) throw error;
      for (const r of (data ?? []) as Record<string, unknown>[]) {
        const e = rowToAuditEntry(r);
        if (e) found.set(e.id, e);
      }
    }
    return { found: Array.from(found.values()), source: 'cloud' };
  } catch (err) {
    console.warn('[audit] could not look entries up on the server', err);
    return { found: fromDevice, source: 'local-only' };
  }
}

/** UI helper — group entries by day for the audit viewer. */
export function groupAuditByDay(entries: ScheduleAuditEntry[]): { day: string; entries: ScheduleAuditEntry[] }[] {
  const map = new Map<string, ScheduleAuditEntry[]>();
  for (const e of entries) {
    // The LOCAL day the edit happened on — `at` is a UTC instant, and its date
    // part put a US evening edit under tomorrow.
    const day = calendarDayOf(e.at) ?? e.at.split('T')[0];
    const arr = map.get(day) ?? [];
    arr.push(e);
    map.set(day, arr);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, entries]) => ({ day, entries }));
}
