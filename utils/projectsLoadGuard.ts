// utils/projectsLoadGuard.ts — a projects load must not undo a write made
// while it was in flight (integration round 1, field).
//
// THE BUG. The projects loader is three sequential SELECTs — seconds on job-
// site LTE — and ProjectContext then replaced `projects` wholesale with what
// it read (and saved that over the device cache). The foreground refetch
// checked for pending writes only when it STARTED, so a drag made on Schedule
// Pro while the load was out was overwritten by the pre-drag row; the screen's
// rebase then copied that into the working copy, the drag vanished, and the
// next persist sent the reverted dates. useProjectsFocusRefetch opened that
// window on every return to the app after 30 s.
//
// THE FIX. Every local project write takes a sequence number
// (ProjectContext.noteProjectWrite). A load remembers the number it started
// at; when it lands, any project written since keeps the device copy — or
// stays deleted, or keeps a project created meanwhile that the read could not
// have seen. The next load, with nothing written in between, takes the
// server's. Pure; pinned by scripts/validate-schedule-concurrency.ts.
//
// HOTFIX (post-ship review, 2026-09-18) — three holes in that rule:
//   #6  the guard state outlived the ACCOUNT. A's written ids were kept on
//       B's empty load, so B saw (and cached) A's projects. The provider now
//       resets the log's ids on a user change; the log's `seq` stays
//       monotonic (resetProjectWriteLog) so a load already out keeps a
//       comparable `since`.
//   #8  "written since the load began" missed a write made BEFORE it that had
//       not landed yet — in the 800 ms window, on the wire, or queued offline.
//       `pending` (the ids unconfirmed when the load started) keeps the whole
//       device row too.
//   #96 keeping the whole device row for a project merely EDITED during the
//       load threw away everything else the load read — the foreman's
//       progress the refetch exists to show. `fold` merges the server's
//       schedule into the kept copy instead (foldServerSchedule).

import type { ScheduleTask } from '../types';
import { absorbServerScheduleTasks } from './fieldScheduleUpdate';

export interface ProjectWriteLog {
  /** The newest sequence number handed out. */
  seq: number;
  /** Per project, the sequence number of its latest local write. */
  byId: Map<string, number>;
}

export function newProjectWriteLog(): ProjectWriteLog {
  return { seq: 0, byId: new Map() };
}

/**
 * The log for a different account (#6): no project ids carried over, the
 * sequence number carried forward. A load started under the old account read
 * `seq` as its `since`; restarting at 0 would make the new account's first
 * writes look older than that load, and it would take the server copy over
 * them.
 */
export function resetProjectWriteLog(log: ProjectWriteLog): ProjectWriteLog {
  return { seq: log.seq, byId: new Map() };
}

/** Record a local write of `projectId`; returns its sequence number. */
export function noteProjectWrite(log: ProjectWriteLog, projectId: string): number {
  log.seq += 1;
  log.byId.set(projectId, log.seq);
  return log.seq;
}

/**
 * `loaded` as the device should hold it, given the load started at sequence
 * `since` and `local` is the device's current list. Untouched projects are the
 * server's; a project written after `since` is the local copy — or absent when
 * it was deleted locally meanwhile; one created locally meanwhile is added at
 * the front (new projects are listed first).
 *
 * `opts.pending` (#8): ids whose write had not reached the server when the
 * load STARTED — a debounced sync waiting or on the wire, or a queued
 * projects / project_financials write. The SELECT may have read the row from
 * before that write, so the whole device row is kept, money included. Taken
 * once, before the first SELECT, and never rebuilt at landing: a write that
 * lands while the SELECT is out leaves both the map and the queue, yet the
 * row the SELECT read may still predate it.
 *
 * `opts.fold` (#96): for a project written during the load but NOT pending
 * when it began, a merge of the server row into the device copy; `null`
 * keeps the device copy whole.
 */
export interface ProjectsLoadKeepOptions<P> {
  pending?: ReadonlySet<string>;
  fold?: (mine: P, server: P) => P | null;
}

export interface ProjectsLoadPlan<P> {
  projects: P[];
  /** Loaded ids whose server row was NOT taken: the device copy was kept
   *  whole (or it stays deleted). The load owes a re-read for these. */
  keptWhole: Set<string>;
  /** Loaded ids whose device copy absorbed the server's schedule. */
  folded: Set<string>;
}

export function planProjectsLoad<P extends { id: string }>(
  loaded: readonly P[],
  local: readonly P[],
  log: ProjectWriteLog,
  since: number,
  opts?: ProjectsLoadKeepOptions<P>,
): ProjectsLoadPlan<P> {
  const pending = opts?.pending ?? new Set<string>();
  const written = new Set<string>();
  for (const [id, s] of log.byId) if (s > since) written.add(id);
  const keptWhole = new Set<string>();
  const folded = new Set<string>();
  if (written.size === 0 && pending.size === 0) return { projects: [...loaded], keptWhole, folded };
  const localById = new Map(local.map(p => [p.id, p] as const));
  const loadedIds = new Set(loaded.map(p => p.id));
  const out: P[] = [];
  for (const p of local) {
    if ((written.has(p.id) || pending.has(p.id)) && !loadedIds.has(p.id)) out.push(p);
  }
  for (const p of loaded) {
    const isPending = pending.has(p.id);
    if (!isPending && !written.has(p.id)) { out.push(p); continue; }
    const mine = localById.get(p.id);
    if (!isPending && mine && opts?.fold) {
      const merged = opts.fold(mine, p);
      if (merged) { out.push(merged); folded.add(p.id); continue; }
    }
    keptWhole.add(p.id);
    if (mine) out.push(mine);
  }
  return { projects: out, keptWhole, folded };
}

export function keepProjectsWrittenSince<P extends { id: string }>(
  loaded: readonly P[],
  local: readonly P[],
  log: ProjectWriteLog,
  since: number,
  opts?: ProjectsLoadKeepOptions<P>,
): P[] {
  return planProjectsLoad(loaded, local, log, since, opts).projects;
}

/**
 * The `local` to plan a load against before this account's list has been
 * hydrated (review round 2). The rule above reads "pending or written, but not
 * in `local`" as "deleted on this device" — true once `local` IS the device's
 * list, false before: on an iOS cold launch the session usually restores
 * before the signed-out pass's cache read lands, so the in-memory list is
 * still [] when the first load plans, and every project with a queued write
 * (offline edits, offline creates) vanished from Home and from the cache.
 * Until then the device's copy is `device` (the cache the loader read, or the
 * rows the loader chose, for the hydration pass): its rows the list lacks are
 * added — except one written since `since` and gone from the list, which is
 * a delete made meanwhile. A delete made earlier took the row out of the
 * cache too, so a queued delete still stays absent.
 */
export function withDeviceCopies<P extends { id: string }>(
  local: readonly P[],
  device: readonly P[],
  log: ProjectWriteLog,
  since: number,
): P[] {
  const have = new Set(local.map(p => p.id));
  const out = [...local];
  for (const p of device) {
    if (have.has(p.id)) continue;
    const s = log.byId.get(p.id);
    if (s !== undefined && s > since) continue;
    have.add(p.id);
    out.push(p);
  }
  return out;
}

type WithSchedule = { id: string; schedule?: { tasks?: ScheduleTask[] } | null };

/**
 * The #96 fold. `base` is the server schedule the device had absorbed when the
 * load STARTED (read before the load overwrites it — a realtime echo that moves
 * it during the load must not make a stale SELECT look like a server change);
 * `serverTasks`, when given, overrides the row's tasks (the hydration pass
 * folds against the tasks the load read, not the row, which may be a local
 * cache write). No base, or no schedule on either side, keeps the device copy
 * whole: without a base a 3-way merge would read every local edit as "the
 * server changed it" and take the server's value over the edit.
 */
export function foldServerSchedule<P extends WithSchedule>(
  base: ReadonlyMap<string, readonly ScheduleTask[]>,
  serverTasks?: ReadonlyMap<string, readonly ScheduleTask[]>,
): (mine: P, server: P) => P | null {
  return (mine, server) => {
    const prev = base.get(mine.id);
    const incoming = serverTasks ? serverTasks.get(mine.id) : server.schedule?.tasks;
    if (!prev || !incoming || !mine.schedule || !server.schedule) return null;
    const tasks = absorbServerScheduleTasks(prev, incoming, mine.schedule.tasks ?? []);
    return { ...mine, schedule: { ...mine.schedule, tasks } };
  };
}

/**
 * Project ids with a write still in the offline queue (#8): the projects row
 * itself (by `id`, any operation — a queued delete must keep the device's
 * absence), and the money leg (project_financials is keyed by `project_id`,
 * which pendingIdsForTable cannot see).
 */
export function pendingProjectIdsInQueue(
  queue: readonly { table: string; userId?: string | null; data?: Record<string, unknown> | null }[],
  session?: { userId: string; marker: string | null },
): Set<string> {
  const ids = new Set<string>();
  for (const e of queue) {
    // Review round 1: only THIS session's entries. The queue survives a
    // session expiry and the pre-session wipe (AuthContext PRE_SESSION_WIPE),
    // so B's first load could find A's queued edit on a1, keep A's a1 as
    // "pending and absent from the load", and save it into B's device cache
    // for good. Same ownership rule as offlineQueue adoptUntaggedForSession /
    // partitionQueueForSession: tagged for this user, or untagged with the
    // device's last-user marker naming this user.
    if (session && !(e.userId === session.userId || (!e.userId && session.marker === session.userId))) continue;
    const d = e.data ?? {};
    const id = e.table === 'projects' ? d.id
      : e.table === 'project_financials' ? (d.project_id ?? d.id)
      : undefined;
    if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

/**
 * #8 (review round 1): every project with a debounced sync not yet reported —
 * one still waiting on its timer (in `waiting`, the debounce map) and one
 * whose write is on the wire (in `inFlight`, entry → project id). The two are
 * kept apart because the map alone was not the truth: flushPendingProjectSyncs
 * used to take a fired entry out of the map before its write went out, and a
 * newer edit replaces an in-flight entry in the map, so a write could be on
 * the wire with no map entry and no queue entry (supabaseWrite queues only
 * after a failure) — and a load starting then read the pre-write row.
 */
export function unconfirmedProjectSyncIds(
  waiting: ReadonlyMap<string, unknown>,
  inFlight: ReadonlyMap<unknown, string>,
): Set<string> {
  const ids = new Set<string>(waiting.keys());
  for (const id of inFlight.values()) ids.add(id);
  return ids;
}

/**
 * #7: an owner upsert leaves the schedule out only for a row the server is
 * KNOWN to hold. Before this, "known" was an in-memory set filled by a load
 * that returned rows — empty on a launch whose SELECT failed (or had not
 * settled yet), so every status change, portal toggle and payment-terms stamp
 * that launch re-sent the phone's cached schedule and undid schedule work done
 * on another device. The set is now also persisted (serializeServerConfirmedIds),
 * so a cache-fallback launch still knows. A project never confirmed (created
 * offline, merged in local-only) still carries it: that upsert is the INSERT.
 */
export function ownerUpsertCarriesSchedule(sendsSchedule: boolean, shared: boolean, serverHasRow: boolean): boolean {
  return sendsSchedule || (!shared && !serverHasRow);
}

/** Persisted form of the server-confirmed project ids, stamped with the
 *  account so a copy left by another account is never read as this one's. */
export function serializeServerConfirmedIds(userId: string, ids: Iterable<string>): string {
  return JSON.stringify({ userId, ids: [...ids] });
}

export function parseServerConfirmedIds(raw: string | null | undefined, userId: string | null): Set<string> {
  if (!raw || !userId) return new Set();
  try {
    const v = JSON.parse(raw) as { userId?: unknown; ids?: unknown };
    if (v?.userId !== userId || !Array.isArray(v.ids)) return new Set();
    return new Set(v.ids.filter((x): x is string => typeof x === 'string' && x.length > 0));
  } catch {
    return new Set();
  }
}

export type ProjectWriteOp = 'upsert' | 'update' | 'delete';
type SendProjectWrite = (table: string, op: ProjectWriteOp, data: Record<string, unknown>) => Promise<boolean>;
type EnqueueProjectWrite = (m: { table: string; operation: ProjectWriteOp; data: Record<string, unknown> }) => Promise<void>;

/**
 * Hotfix #8, the data-loss half: a project write that must not overtake one
 * already in the offline queue. An offline edit waits there as a whole-row
 * write, and the queue drains only on launch, foreground and a backoff that
 * grows to 5 min — so a new edit sent straight to the server landed first and
 * the drain then replayed the OLDER row over it. `behindQueue` — this project
 * has a write queued (ProjectContext reads ownQueuedProjectIds): the new write
 * joins the queue behind it, FIFO keeps the order, and it reports not landed
 * (like a write that queued after a failure). Otherwise it is sent as before.
 */
export function orderedProjectWriter(
  behindQueue: boolean,
  send: SendProjectWrite,
  enqueue: EnqueueProjectWrite,
): SendProjectWrite {
  return async (table, op, data) => {
    if (!behindQueue) return send(table, op, data);
    try { await enqueue({ table, operation: op, data }); } catch { /* the queue reports its own failure */ }
    return false;
  };
}
