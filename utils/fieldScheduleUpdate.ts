// fieldScheduleUpdate.ts — how a FIELD collaborator's schedule progress gets
// saved (audit round 2, account-data-security #25).
//
// THE BUG. The field role is sold as "Schedule & field work — no costs or
// margins", and Home's Quick Field Update, Schedule Pro and the daily report's
// delay ripple all let a field user change the schedule. Every one of those
// went through updateProject → a PATCH of the whole projects row, which
// projects_update only admits for the owner or an editor. PostgREST answers an
// RLS-refused UPDATE with 200 and zero rows, the offline queue deliberately
// does not count rows, so the foreman saw "Framing → 60%", nothing reached the
// server, and his next reload put 0% back. Nothing told him.
//
// THE FIX. Field users write through ONE server function,
// public.field_update_schedule_tasks (migration 20260917160000), which merges
// only these keys onto projects.schedule.tasks by id and refuses anything else.
// Widening projects_update instead would have let a foreman rewrite the
// project's status and collaborator list, which ride in the same row PATCH.
//
// Dates, durations, dependencies and adding/removing tasks stay editor work:
// a field user's change to those is reported back as `blocked` so the screen
// can say it was not saved, rather than letting it vanish on the next reload.
//
// Pure except sendFieldTaskPatches, which takes the Supabase client as an
// argument so this module never imports lib/supabase. Pinned by
// scripts/validate-field-schedule-update.ts.

import type { ScheduleTask } from '@/types';

/** The task keys a field collaborator may write. Must match v_allowed in the
 *  migration — the validator reads both and fails if they drift. */
export const FIELD_TASK_PATCH_KEYS = [
  'progress', 'status', 'notes',
  'actualStartDate', 'actualEndDate', 'actualStartDay', 'actualEndDay',
] as const;
export type FieldTaskPatchKey = (typeof FIELD_TASK_PATCH_KEYS)[number];
export type FieldTaskPatch = { id: string } & Partial<Pick<ScheduleTask, FieldTaskPatchKey>>;

/** Server function name — one spelling for every caller and the validator. */
export const FIELD_SCHEDULE_RPC = 'field_update_schedule_tasks';

/** Keys the app writes onto tasks by itself (engine stamps, derived rollups).
 *  A difference in these is not something the field user did, so it is neither
 *  sent nor reported as a blocked edit. */
const DERIVED_TASK_KEYS = new Set<string>(['isCriticalPath', 'wbsCode', 'collapsed', 'fieldEditedAt']);

// ─────────────────────────────────────────────────────────────────────────────
// THE SECOND WRITER (#25, integration round). The RPC closed the foreman's
// direction: his progress now reaches the server. The owner's direction was
// still open — every owner/editor project write PATCHed the WHOLE schedule from
// that device's local copy, which on iOS is usually hours old, so a DFR, a
// status change or a geocode at 15:00 put the 07:00 "Framing 0%" back over the
// foreman's 10:00 "60%". Two layers close it:
//
//   • per-task, per-key stamps. `task.fieldEditedAt[key]` is when that
//     field-owned value was last SET — by the RPC (server clock) or by an
//     owner/editor edit (stampFieldEdits, below). A copy whose stamp for a key
//     is missing or older than the server's never saw the latest value, so its
//     value for that key is stale, not an edit;
//   • the BEFORE UPDATE trigger in migration 20260917160000
//     (projects_keep_newer_field_progress) applies exactly that rule on the
//     server, for every writer and every build — the layer that cannot be
//     bypassed. stampFieldEdits applies it locally too, so the owner's screen
//     shows what the server will keep instead of a value that silently flips
//     on the next load.
// ─────────────────────────────────────────────────────────────────────────────

/** The per-task stamp map. Must match the key the migration's RPC writes and
 *  its trigger reads — the validator reads both. */
export const FIELD_EDIT_STAMPS = 'fieldEditedAt';
type Stamps = Record<string, string>;

function stampsOf(t: unknown): Stamps {
  const v = (t as Record<string, unknown> | null | undefined)?.[FIELD_EDIT_STAMPS];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Stamps) : {};
}
function stampMs(s: string | undefined): number | null {
  if (typeof s !== 'string') return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

// ── This device's own stamps ────────────────────────────────────────────────
// A stamp this JS runtime minted (in stampFieldEdits' EDIT branch) is not news
// to this device, so a working copy that lacks it is NOT stale. Without this,
// a GC's SECOND change to the same task — or an undo of his first — was built
// from a screen copy that never received the stamp his first write earned (no
// realtime echo, no refetch yet), read as "older than the server's", and was
// silently thrown away (fix round 1 review). Only a stamp someone ELSE set
// (the field RPC, another device) can make this device's copy stale. In
// memory on purpose: after a reload every screen copy is built from the
// loaded row and carries the stamps anyway. Bounded so a long session can't
// grow it without limit.
const OWN_STAMPS = new Set<string>();
const OWN_STAMPS_MAX = 5000;
const ownKey = (taskId: string, key: string, stamp: string) => JSON.stringify([taskId, key, stamp]);
function rememberOwnStamp(taskId: string, key: string, stamp: string): void {
  if (OWN_STAMPS.size >= OWN_STAMPS_MAX) {
    const oldest = OWN_STAMPS.values().next().value;
    if (oldest !== undefined) OWN_STAMPS.delete(oldest);
  }
  OWN_STAMPS.add(ownKey(taskId, key, stamp));
}

/** Whether `after`'s value for field key `k` is a stale copy of `before`'s:
 *  `before` holds a stamp someone else set, and `after`'s stamp is missing or
 *  older — the copy never saw that write. The trigger in 20260917160000 keeps
 *  the server's value in exactly this case, so the client must not show the
 *  edit as saved. */
function isStaleFieldValue(taskId: string, pS: Stamps, tS: Stamps, k: string): boolean {
  const pMs = stampMs(pS[k]);
  if (pMs == null) return false;
  const tMs = stampMs(tS[k]);
  if (tMs != null && tMs >= pMs) return false;
  return !OWN_STAMPS.has(ownKey(taskId, k, pS[k]));
}

/** A field-owned value an owner/editor edit carried that the server will not
 *  take, because someone set a newer one (usually the foreman) that the
 *  edited copy never saw. */
export interface FieldEditRefusal {
  taskId: string;
  key: FieldTaskPatchKey;
  /** The kept value's stamp — when it was set. */
  fieldEditedAt: string;
}

/**
 * The field-owned values in `after` that stampFieldEdits will put back to
 * `before`'s, with no side effects — so a screen can say so (and reset its
 * working copy) instead of showing a change the server is about to refuse.
 */
export function staleFieldEdits(
  before: readonly ScheduleTask[] | null | undefined,
  after: readonly ScheduleTask[],
): FieldEditRefusal[] {
  const prevById = new Map((before ?? []).map(t => [t.id, t] as const));
  const out: FieldEditRefusal[] = [];
  for (const t of after) {
    const p = prevById.get(t.id);
    if (!p) continue;
    const pS = stampsOf(p);
    const tS = stampsOf(t);
    const pr = p as unknown as Record<string, unknown>;
    const tr = t as unknown as Record<string, unknown>;
    for (const k of FIELD_TASK_PATCH_KEYS) {
      if (same(pr[k], tr[k])) continue;
      if (isStaleFieldValue(t.id, pS, tS, k)) out.push({ taskId: t.id, key: k, fieldEditedAt: pS[k] });
    }
  }
  return out;
}

/**
 * The task list an owner/editor write should carry, given the freshest local
 * copy (`before` — projectsRef, which a refetch keeps current) and the edited
 * list (`after` — often built from a screen's working copy loaded hours ago).
 *
 * Per field-owned key of a task present in both:
 *   • unchanged → kept, with the freshest stamp either copy holds;
 *   • changed, and `after`'s stamp is missing or OLDER than a stamp someone
 *     else set on `before` → the edited copy predates the latest field write:
 *     STALE. `before`'s value and stamp are kept (the server trigger would
 *     keep them anyway; staleFieldEdits lets a screen report it);
 *   • changed otherwise → an EDIT: stamped later than any stamp either copy
 *     holds (and no earlier than `nowISO`), so the trigger lets it through
 *     even when this device's clock runs behind the server's. The stamp is
 *     remembered as this device's own.
 * Added tasks, non-field keys and removed tasks are left alone — structure is
 * the editor's.
 */
export function stampFieldEdits(
  before: readonly ScheduleTask[] | null | undefined,
  after: readonly ScheduleTask[],
  nowISO: string,
): ScheduleTask[] {
  const prevById = new Map((before ?? []).map(t => [t.id, t] as const));
  const nowMs = stampMs(nowISO) ?? 0;
  return after.map((t) => {
    const p = prevById.get(t.id);
    if (!p) return t;
    const pS = stampsOf(p);
    const tS = stampsOf(t);
    const pr = p as unknown as Record<string, unknown>;
    const next = { ...(t as unknown as Record<string, unknown>) };
    const stamps: Stamps = { ...tS };
    let touched = false;
    for (const k of FIELD_TASK_PATCH_KEYS) {
      const pMs = stampMs(pS[k]);
      const tMs = stampMs(tS[k]);
      if (same(pr[k], next[k])) {
        // Same value: carry the freshest stamp (a rebuilt task may have lost it).
        if (pMs != null && (tMs == null || pMs > tMs)) { stamps[k] = pS[k]; touched = true; }
        continue;
      }
      if (isStaleFieldValue(t.id, pS, tS, k)) {
        if (k in pr) next[k] = pr[k]; else delete next[k];
        stamps[k] = pS[k];
      } else {
        stamps[k] = new Date(Math.max(nowMs, (pMs ?? -1) + 1, (tMs ?? -1) + 1)).toISOString();
        rememberOwnStamp(t.id, k, stamps[k]);
      }
      touched = true;
    }
    if (!touched) return t;
    next[FIELD_EDIT_STAMPS] = stamps;
    return next as unknown as ScheduleTask;
  });
}

/** Same task content, ignoring the keys the app writes by itself (stamps,
 *  critical-path flags, outline state) and key order. */
function sameTaskContent(a: ScheduleTask, b: ScheduleTask): boolean {
  const ar = a as unknown as Record<string, unknown>;
  const br = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(ar), ...Object.keys(br)]);
  for (const k of keys) {
    if (DERIVED_TASK_KEYS.has(k)) continue;
    if (!same(ar[k], br[k])) return false;
  }
  return true;
}

/**
 * Fold a server copy of the tasks that arrived by REALTIME into the app's
 * shared project copy (ProjectContext `projects` / projectsRef) — the stamping
 * base every owner write is judged against (integration round 1, field).
 *
 * THE BUG. Schedule Pro folded a peer's write into its working copy (`hist`)
 * only. `projects` kept the older copy, so a foreman's 60% the GC's screen had
 * absorbed looked, to stampFieldEdits, like the GC's own EDIT of that task —
 * and his next save of ANY task minted a fresh owner stamp for it, which the
 * trigger accepted over the foreman's later 80% that had not reached the tab
 * yet. On a field phone the same gap reported a task only the GC had moved as
 * "Not saved: changes to Drywall" and reset it. The base must be at least as
 * fresh as the working copy; this keeps it so.
 *
 * `serverPrev` is the last server copy the app saw for this project (the load,
 * or the previous realtime event); `local` is `projects`' copy, which may hold
 * this device's own edit still on its way to the server. Per task, per key:
 *   • field keys (stamped): the value with the NEWER stamp wins, whichever
 *     copy holds it — order-proof, so an older echo arriving late can never
 *     take back a newer value. No stamp on either side: 3-way, like below;
 *   • every other key: 3-way against `serverPrev` — the local value where
 *     this device changed it (a pending edit of his own), else the server's;
 *   • a task the server added appears; one it deleted goes unless it was
 *     edited here; one added here and not yet on the server stays; one
 *     deleted here stays deleted.
 * Server order is taken, with local-only additions after it.
 */
export function absorbServerScheduleTasks(
  serverPrev: readonly ScheduleTask[] | null | undefined,
  incoming: readonly ScheduleTask[],
  local: readonly ScheduleTask[],
): ScheduleTask[] {
  const baseById = new Map((serverPrev ?? local).map(t => [t.id, t] as const));
  const localById = new Map(local.map(t => [t.id, t] as const));
  const incIds = new Set(incoming.map(t => t.id));
  const fieldKeys = new Set<string>(FIELD_TASK_PATCH_KEYS);
  const out: ScheduleTask[] = [];
  for (const inc of incoming) {
    const loc = localById.get(inc.id);
    const base = baseById.get(inc.id);
    if (!loc) {
      // Deleted here, not saved yet → stays deleted. New on the server → in.
      if (!base) out.push(inc);
      continue;
    }
    const ir = inc as unknown as Record<string, unknown>;
    const lr = loc as unknown as Record<string, unknown>;
    const br = base as unknown as Record<string, unknown> | undefined;
    const iS = stampsOf(inc);
    const lS = stampsOf(loc);
    const next: Record<string, unknown> = {};
    const stamps: Stamps = {};
    const take = (k: string, from: Record<string, unknown>) => { if (k in from) next[k] = from[k]; };
    // Where local and base agree, this device did not change it → server's.
    const threeWay = (k: string) => (br && same(lr[k], br[k]) ? ir : lr);
    const keys = new Set([...Object.keys(ir), ...Object.keys(lr)]);
    keys.delete(FIELD_EDIT_STAMPS);
    for (const k of keys) {
      if (!fieldKeys.has(k)) { take(k, threeWay(k)); continue; }
      const iMs = stampMs(iS[k]);
      const lMs = stampMs(lS[k]);
      const src = iMs != null && (lMs == null || iMs >= lMs) ? ir
        : lMs != null ? lr
        : threeWay(k);
      take(k, src);
      const s = src === ir ? iS[k] : src === lr ? lS[k] : undefined;
      if (s !== undefined) stamps[k] = s;
    }
    // A stamp for a key neither copy holds a value for still dates the unset.
    for (const k of FIELD_TASK_PATCH_KEYS) {
      if (stamps[k] !== undefined) continue;
      const iMs = stampMs(iS[k]);
      const lMs = stampMs(lS[k]);
      if (iMs != null && (lMs == null || iMs >= lMs)) stamps[k] = iS[k];
      else if (lMs != null) stamps[k] = lS[k];
    }
    if (Object.keys(stamps).length > 0) next[FIELD_EDIT_STAMPS] = stamps;
    out.push(next as unknown as ScheduleTask);
  }
  for (const loc of local) {
    if (incIds.has(loc.id)) continue;
    const base = baseById.get(loc.id);
    // Added here and not on the server yet → keep. Deleted on the server →
    // keep only if edited here (the owner's save decides), else it goes.
    if (!base || !sameTaskContent(loc, base)) out.push(loc);
  }
  return out;
}

/**
 * Whether a debounced project sync carries `schedule`. `changedKeys` is the
 * update's own keys (updateProject passes Object.keys(updates)); undefined —
 * a caller that does not say — keeps the old send-everything behaviour. A
 * pending sync this one replaces inside the debounce window that WAS carrying
 * the schedule keeps carrying it, or a status toggle 300 ms after a schedule
 * edit would drop the edit.
 */
export function projectSyncSendsSchedule(
  changedKeys: readonly string[] | undefined,
  pendingSendsSchedule = false,
): boolean {
  return pendingSendsSchedule || changedKeys === undefined || changedKeys.includes('schedule');
}

/** Where a role's schedule writes must go. `null` (still resolving, or the
 *  collaborator read failed) keeps the owner/editor path: the owner never sees
 *  a read-only flash, and a field user's edit made in that window is still
 *  refused by the database rather than written. */
export type ScheduleWritePath = 'row' | 'field_rpc' | 'none';
export function scheduleWritePathForRole(role: string | null | undefined): ScheduleWritePath {
  if (role === 'viewer') return 'none';
  if (role === 'field') return 'field_rpc';
  return 'row';
}

/**
 * What the phone task sheet can save on the caller's access (#139), said
 * INSIDE the sheet before he taps. The screen above already prints FIELD_SCHEDULE_HINT, but the
 * sheet itself offered every control and refused most of them only after the
 * tap ("Not saved: changes to Framing…"). The field RPC merges progress,
 * status, notes and actual start/finish ONLY (FIELD_TASK_PATCH_KEYS), so:
 *   'field_rpc' — status, % complete and notes stay live; start, duration,
 *                 milestone, name, crew, the checklist and delete are disabled
 *                 with this reason. Checklist ticks are not a field key yet
 *                 (it needs a migration that accepts done-flags on existing
 *                 items only — waiting on the founder's call).
 *   'none'      — view-only: everything is disabled.
 * Used by components/schedule/mobile/TaskDetailSheet.tsx.
 */
export const TASK_SHEET_FIELD_REASON =
  'Field access saves status, % complete and notes here. Dates, duration, milestone, name, crew, checklist ticks and deleting need editor access from the project owner.';
export const TASK_SHEET_VIEWER_REASON =
  'You have view-only access to this project, so nothing in this sheet is saved. Ask the project owner for field or editor access.';
export function taskSheetLocks(writePath: ScheduleWritePath | undefined): {
  reason: string | null;
  plan: boolean;     // start, duration, milestone, name, crew, checklist, delete
  progress: boolean; // status, % complete, notes
} {
  if (writePath === 'field_rpc') return { reason: TASK_SHEET_FIELD_REASON, plan: true, progress: false };
  if (writePath === 'none') return { reason: TASK_SHEET_VIEWER_REASON, plan: true, progress: true };
  return { reason: null, plan: false, progress: false };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface FieldTaskDiff {
  /** What the field role may save, one patch per changed task. */
  patches: FieldTaskPatch[];
  /** Titles of tasks with a change the field role may NOT save (dates,
   *  duration, links, crew, title…), plus added/removed tasks. */
  blocked: string[];
}

/** Split an edit of the task list into what field access saves and what it
 *  refuses. `before` is the schedule as last loaded; `after` the edited copy. */
export function fieldTaskDiff(before: readonly ScheduleTask[], after: readonly ScheduleTask[]): FieldTaskDiff {
  const allowed = new Set<string>(FIELD_TASK_PATCH_KEYS);
  const prevById = new Map(before.map(t => [t.id, t] as const));
  const nextIds = new Set(after.map(t => t.id));
  const patches: FieldTaskPatch[] = [];
  const blocked: string[] = [];
  for (const t of after) {
    const prev = prevById.get(t.id);
    if (!prev) { blocked.push(t.title || 'New task'); continue; }
    const patch: Record<string, unknown> = {};
    let blockedHere = false;
    const keys = new Set([...Object.keys(prev), ...Object.keys(t)]);
    for (const k of keys) {
      const a = (prev as unknown as Record<string, unknown>)[k];
      const b = (t as unknown as Record<string, unknown>)[k];
      if (same(a, b)) continue;
      if (allowed.has(k)) patch[k] = b === undefined ? null : b;
      else if (!DERIVED_TASK_KEYS.has(k)) blockedHere = true;
    }
    if (Object.keys(patch).length > 0) patches.push({ id: t.id, ...patch } as FieldTaskPatch);
    if (blockedHere) blocked.push(t.title || t.id);
  }
  for (const t of before) if (!nextIds.has(t.id)) blocked.push(t.title || t.id);
  return { patches, blocked };
}

/** Schedule-level settings a user sets on purpose. The field RPC writes none
 *  of them, so a change here is reported as not saved. Derived scalars the
 *  engine recomputes on every persist (totals, critical-path days, updatedAt)
 *  are deliberately NOT listed — they change on a plain progress edit. */
export const FIELD_BLOCKED_SCHEDULE_KEYS = [
  'name', 'startDate', 'workingDaysPerWeek', 'nonWorkingDates', 'baselines', 'baseline',
  'criticalFloatThresholdDays', 'weatherDelayLog', 'startDayBasis', 'resourceCalendars',
  // Which baseline "behind plan" measures from (#137) — a plan setting, like
  // the baselines themselves.
  'activeBaselineId',
] as const;

export function fieldScheduleSettingsChanged(before: object | null | undefined, after: object | null | undefined): boolean {
  if (!before || !after) return false;
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  // Only keys the update actually carries: a partial schedule that omits one
  // did not change it.
  // An absent list and an empty one are the same setting: the persist path
  // writes `baselines: []` onto a schedule that never had the key, and that
  // must not read as a foreman editing baselines.
  const norm = (v: unknown) => (Array.isArray(v) && v.length === 0 ? null : v);
  return FIELD_BLOCKED_SCHEDULE_KEYS.some(k => k in b && !same(norm(a[k]), norm(b[k])));
}

/** The task list as the server will hold it once `patches` land — for the
 *  local copy, so the screen shows what was saved and nothing more. */
export function applyFieldTaskPatches(tasks: readonly ScheduleTask[], patches: readonly FieldTaskPatch[]): ScheduleTask[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const p of patches) {
    const { id, ...rest } = p;
    byId.set(id, { ...(byId.get(id) ?? {}), ...rest });
  }
  return tasks.map(t => {
    const patch = byId.get(t.id);
    if (!patch) return t;
    const next = { ...t } as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (!(FIELD_TASK_PATCH_KEYS as readonly string[]).includes(k)) continue;
      if (v === null) delete next[k]; else next[k] = v;
    }
    return next as unknown as ScheduleTask;
  });
}

export type FieldSendResult =
  | { ok: true; missing: string[] }
  | { ok: false; message: string; offline: boolean; retryable: boolean };

interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

/** What the foreman reads when his update did not save — never "synced". */
export function fieldSendFailureMessage(err: { message?: string; code?: string } | null | undefined): string {
  const msg = (err?.message ?? '').toLowerCase();
  const code = err?.code ?? '';
  if (code === '42501') return 'Not saved — your access to this project no longer allows schedule updates. Ask the project owner.';
  if (code === 'PGRST202' || code === '42883' || msg.includes('could not find the function')) {
    return 'Not saved — progress updates on field access are not switched on for this account yet. Tell the project owner.';
  }
  if (code === '22023') return `Not saved — ${err?.message?.replace(/^field_update_schedule_tasks:\s*/, '') ?? 'that change is not a field update'}.`;
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('offline') || msg.includes('timed out')) {
    return 'Not saved — no connection. Progress updates on field access need a signal; try again when you are back online.';
  }
  return 'Not saved — the server did not accept the update. Try again, or ask the project owner.';
}

/**
 * What kind of failure this was, for the screen's Retry (#138). `offline`: no
 * connection — the same patches will very likely land once there is signal, so
 * the screen re-sends them by itself while it is open. `retryable`: worth a
 * Retry button at all. A refusal (42501 access revoked, 22023 not a field
 * update) or a function that is not deployed (PGRST202) will be refused again
 * however often it is sent, so it gets no Retry — only the reason.
 */
export function classifyFieldSendFailure(err: { message?: string; code?: string } | null | undefined): { offline: boolean; retryable: boolean } {
  const msg = (err?.message ?? '').toLowerCase();
  const code = err?.code ?? '';
  if (code === '42501' || code === '22023' || code === 'PGRST202' || code === '42883' || msg.includes('could not find the function')) {
    return { offline: false, retryable: false };
  }
  const offline = msg.includes('network') || msg.includes('fetch') || msg.includes('offline') || msg.includes('timed out');
  return { offline, retryable: true };
}

// ── A send that did not land (#138) ─────────────────────────────────────────
// The foreman in a basement taps 60%; the RPC cannot be reached. The update is
// NOT queued — the offline queue has no RPC path, and this RPC stamps each key
// with the SERVER's clock when it lands, so a queued patch flushed hours later
// would overwrite whatever the GC set in between (the per-key trigger orders by
// those stamps, and the late flush would carry the newest one). Instead the
// screen keeps the failed patches IN MEMORY while it is open, re-sends them
// when signal is likely back, and only re-sends a key whose value ON THE
// SERVER is still the one this device held when the send failed. That check
// is made against a FRESH READ of the row (planFieldRetry), never this
// device's copy: a phone that had no signal cannot have received the GC's
// newer edit, so its own copy would wave the stale value through and the RPC
// would stamp it newest. No read, no send.

/** A failed field send, kept by the screen for Retry. */
export interface FieldSendFailure {
  projectId: string;
  /** What the foreman reads — fieldSendFailureMessage's wording. */
  message: string;
  offline: boolean;
  retryable: boolean;
  /** The patches that did not land (later entries win, key by key). */
  patches: FieldTaskPatch[];
  /** Per task id: each patched key's value and stamp on this device when the
   *  send failed. A retry re-sends a key only while both are unchanged. */
  before: Record<string, Record<string, { value: unknown; stamp: string | null }>>;
}

/** Record a failed send against the task list it was diffed from. */
export function captureFieldSendFailure(
  projectId: string,
  baseTasks: readonly ScheduleTask[],
  patches: readonly FieldTaskPatch[],
  sent: { message: string; offline: boolean; retryable: boolean },
): FieldSendFailure {
  const byId = new Map(baseTasks.map(t => [t.id, t] as const));
  const before: FieldSendFailure['before'] = {};
  for (const p of patches) {
    const t = byId.get(p.id) as unknown as Record<string, unknown> | undefined;
    const stamps = stampsOf(t);
    const row = before[p.id] ?? (before[p.id] = {});
    for (const k of Object.keys(p)) {
      if (k === 'id' || k in row) continue;
      row[k] = { value: t ? t[k] ?? null : null, stamp: stamps[k] ?? null };
    }
  }
  return { projectId, message: sent.message, offline: sent.offline, retryable: sent.retryable, patches: patches.map(p => ({ ...p })), before };
}

/** A second failure on the same project folds into the first, so Retry sends
 *  everything that is still unsaved; the newest failure's wording and kind win.
 *  A different project's failure replaces it (the screen switched projects). */
export function mergeFieldSendFailure(prev: FieldSendFailure | null, next: FieldSendFailure): FieldSendFailure {
  if (!prev || prev.projectId !== next.projectId) return next;
  const before: FieldSendFailure['before'] = {};
  for (const src of [next.before, prev.before]) {
    for (const [id, row] of Object.entries(src)) {
      before[id] = { ...(before[id] ?? {}) };
      // The OLDER failure's "before" wins: it is the value the device held
      // before any of the unsaved taps.
      for (const [k, v] of Object.entries(row)) before[id][k] = v;
    }
  }
  return { ...next, patches: [...prev.patches, ...next.patches], before };
}

/**
 * The patches a retry may still send, given a task list — the SERVER's, just
 * read, when deciding a re-send (planFieldRetry); this device's copy only for
 * whether the banner still has anything waiting. Per
 * key, only while the task's value AND stamp are what they were when the send
 * failed. A key that changed since (the GC's edit arrived, or a later tap of
 * his own saved) is dropped. A task deleted meanwhile is dropped.
 */
export function pendingFieldRetryPatches(failure: FieldSendFailure | null, currentTasks: readonly ScheduleTask[]): FieldTaskPatch[] {
  if (!failure) return [];
  const byId = new Map(currentTasks.map(t => [t.id, t] as const));
  const merged = new Map<string, Record<string, unknown>>();
  for (const p of failure.patches) {
    const { id, ...rest } = p;
    merged.set(id, { ...(merged.get(id) ?? {}), ...rest });
  }
  const out: FieldTaskPatch[] = [];
  for (const [id, keys] of merged) {
    const t = byId.get(id) as unknown as Record<string, unknown> | undefined;
    if (!t) continue;
    const stamps = stampsOf(t);
    const patch: Record<string, unknown> = { id };
    let any = false;
    for (const [k, v] of Object.entries(keys)) {
      const was = failure.before[id]?.[k];
      if (!was) continue;
      if (!same(t[k] ?? null, was.value) || (stamps[k] ?? null) !== was.stamp) continue;
      if (same(t[k] ?? null, v ?? null)) continue; // already holds it
      patch[k] = v;
      any = true;
    }
    if (any) out.push(patch as FieldTaskPatch);
  }
  return out;
}

/** What a retry may send, decided against the server's CURRENT tasks. */
export type FieldRetryPlan =
  | { read: false }
  | {
    read: true;
    /** The row's tasks as just read — the base the retry is diffed against. */
    serverTasks: ScheduleTask[];
    patches: FieldTaskPatch[];
    /** Titles of tasks where a failed value was NOT sent because the server
     *  now holds a different one (changed elsewhere while he had no signal). */
    superseded: string[];
  };

/**
 * Plan a re-send of a failed field update (#138): read the row first, then
 * keep only the keys whose SERVER value and stamp are still what this device
 * held when the send failed. The RPC stamps each key with the server clock on
 * arrival and merges without comparing, so a late re-send decided on this
 * device's copy alone would overwrite the GC's newer edit (he set 80% at
 * 11:00, the phone re-sends the foreman's 9:00 60% at noon). A read that
 * fails or returns nothing sends nothing — the failure stays for the next try.
 */
export async function planFieldRetry(
  failure: FieldSendFailure,
  readServerTasks: () => Promise<ScheduleTask[] | null>,
): Promise<FieldRetryPlan> {
  let serverTasks: ScheduleTask[] | null = null;
  try { serverTasks = await readServerTasks(); } catch { serverTasks = null; }
  if (!Array.isArray(serverTasks)) return { read: false };
  const patches = pendingFieldRetryPatches(failure, serverTasks);
  const sent = new Set<string>();
  for (const p of patches) for (const k of Object.keys(p)) if (k !== 'id') sent.add(`${p.id}\u0000${k}`);
  const byId = new Map(serverTasks.map(t => [t.id, t] as const));
  const superseded: string[] = [];
  // Later taps win key by key — the value he last meant, as the send would.
  const intended = new Map<string, Record<string, unknown>>();
  for (const { id, ...rest } of failure.patches) intended.set(id, { ...(intended.get(id) ?? {}), ...rest });
  for (const [id, keys] of intended) {
    const t = byId.get(id) as unknown as Record<string, unknown> | undefined;
    if (!t) continue;
    const title = typeof t.title === 'string' && t.title ? t.title : 'A task';
    for (const [k, v] of Object.entries(keys)) {
      if (sent.has(`${id}\u0000${k}`)) continue;
      if (same(t[k] ?? null, v ?? null)) continue; // the server already holds his value
      if (!superseded.includes(title)) superseded.push(title);
    }
  }
  return { read: true, serverTasks, patches, superseded };
}

/** The foreman's notice when a held value was not re-sent because a newer one
 *  reached the server first. Plain about what happened, and what he sees now. */
export function fieldRetrySupersededMessage(titles: readonly string[]): string {
  const names = titles.length <= 2 ? titles.join(' and ') : `${titles.slice(0, 2).join(', ')} and ${titles.length - 2} more`;
  return `Your unsent change to ${names} was not sent: it was changed elsewhere while you had no signal. It now shows the newer value — change it again if yours is right.`;
}

/** That notice as a banner entry: nothing left to send, so no Retry — only the
 *  reason, until he dismisses it (the screens show a non-retryable failure). */
export function fieldRetrySupersededNotice(projectId: string, titles: readonly string[]): FieldSendFailure {
  return { projectId, message: fieldRetrySupersededMessage(titles), offline: false, retryable: false, patches: [], before: {} };
}

/** Wait before the Nth automatic re-send of an offline failure: 5 s, doubling,
 *  capped at a minute — the offline queue's own backoff shape, shorter cap
 *  because the screen is open and he is waiting to see it land. */
export function fieldAutoRetryDelayMs(attempt: number): number {
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(5_000 * 2 ** Math.min(n, 10), 60_000);
}

/** Send patches through the field RPC. Never queues: the offline queue has no
 *  RPC path, and a "queued" that the database later refuses is the silent loss
 *  this module exists to end, so a failure is returned for the screen to show. */
export async function sendFieldTaskPatches(
  client: RpcClient,
  projectId: string,
  patches: readonly FieldTaskPatch[],
): Promise<FieldSendResult> {
  if (patches.length === 0) return { ok: true, missing: [] };
  try {
    const { data, error } = await client.rpc(FIELD_SCHEDULE_RPC, {
      p_project_id: projectId,
      p_task_patches: patches,
    });
    if (error) return { ok: false, message: fieldSendFailureMessage(error), ...classifyFieldSendFailure(error) };
    const missing = Array.isArray((data as { missing?: unknown } | null)?.missing)
      ? ((data as { missing: unknown[] }).missing.filter((x): x is string => typeof x === 'string'))
      : [];
    return { ok: true, missing };
  } catch (e) {
    const err = { message: e instanceof Error ? e.message : String(e) };
    return { ok: false, message: fieldSendFailureMessage(err), ...classifyFieldSendFailure(err) };
  }
}
