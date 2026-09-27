// utils/takeoff/takeoffDocMerge.ts — the pure half of the desktop takeoff's
// cloud sync: this browser's TakeoffDoc merged with the account's copy
// (public.takeoff_docs, ONE doc per job, 20260926180000). No React, no
// storage, no network (scripts/validate-takeoff-conditions.ts requires every
// file in utils/takeoff/ to stay that way) — scripts/validate-cloud-sync.ts
// executes it. The I/O is utils/takeoffCloudSync.ts; the wiring is
// hooks/useTakeoffConditions.ts.
//
// Every stamp comparison goes through stampMs: PostgREST answers
// '…:00.12+00:00' for the '…:00.120Z' the client wrote.
//
// THE RULES (mergeTakeoffDocs), in order:
//   1. no server doc        → keep local; push when local holds anything;
//   2. local clean          → the server's doc (nothing unsynced to lose);
//   3. the server stamp is OUR last push (meta.pendingStamp) → that write
//      landed (e.g. an unmount flush that finished after the hook was gone):
//      local is clean, the server doc is kept — unless this browser was edited
//      AFTER that push went out (localEditedAt later than the stamp; the tab
//      closed inside the push debounce), then local wins and is pushed;
//   4. local dirty, and the server unchanged since we last synced → local
//      wins and is pushed;
//   5. local dirty AND the server changed since → CONFLICT: the newer side is
//      the base (a tie → the server); what the other side ADDED since the last
//      sync is carried over by id; the merged doc is pushed. When the server
//      is the base, this browser's copy is backed up so it can be restored.

import { AI_DISMISSED_CAP, parseTakeoffDoc, type TakeoffDoc } from './conditions';
import { stampMs } from '@/utils/syncSeat';

export interface TakeoffSyncMeta {
  /** This device's clock at the last local edit not yet confirmed on the server. */
  localEditedAt: string | null;
  /** The EXACT updated_at the last push wrote; set when sent (queued or synced), cleared once confirmed. */
  pendingStamp: string | null;
  /** The server row's updated_at we last read or confirmed. */
  lastSyncedAt: string | null;
  /** This device's clock when that happened. */
  lastSyncedLocalAt: string | null;
}

export const EMPTY_TAKEOFF_SYNC_META: TakeoffSyncMeta = Object.freeze({
  localEditedAt: null, pendingStamp: null, lastSyncedAt: null, lastSyncedLocalAt: null,
}) as TakeoffSyncMeta;

export const TAKEOFF_CONFLICT_NOTICE_SERVER =
  'This takeoff was also changed on another device. The newer copy was kept and what you added here was carried over.';
export const TAKEOFF_CONFLICT_NOTICE_LOCAL =
  'This takeoff was also changed on another device. Your newer copy was kept and what was added there was carried over.';

/** aiDismissed (lane TK-b's optional string[]) is capped at this many ids —
 *  ONE constant, owned by the parser in ./conditions, so the two never drift. */
export { AI_DISMISSED_CAP };

export interface TakeoffDocRow {
  id: string;
  project_id: string;
  user_id: string;
  doc: TakeoffDoc;
  updated_at: string;
}

/** The row a push writes: one per job, id = the project id. */
export function takeoffDocRow(projectId: string, userId: string, doc: TakeoffDoc, stamp: string): TakeoffDocRow {
  return { id: projectId, project_id: projectId, user_id: userId, doc, updated_at: stamp };
}

export interface TakeoffMergeInput {
  local: TakeoffDoc;
  meta: TakeoffSyncMeta;
  server: { doc: unknown; updatedAt: string } | null;
}

export interface TakeoffMergeResult {
  doc: TakeoffDoc;
  /** Push `doc` to the account. */
  push: boolean;
  /** The result is based on the server's doc. */
  keptServer: boolean;
  /** Save this browser's pre-merge doc as the conflict copy (rule 5, server base). */
  backupLocal: boolean;
  /** Rule 5's sentence; null otherwise. */
  notice: string | null;
  /** The server stamp this merge accounts for (→ meta.lastSyncedAt); null when there is no server doc. */
  syncedAt: string | null;
  /** Which rule decided (1–5), for the validator and the logs. */
  rule: 1 | 2 | 3 | 4 | 5;
}

/** Round-trip through the parser: a malformed doc can never enter the hook. */
function clean(doc: unknown): TakeoffDoc {
  let json: string | null = null;
  try { json = JSON.stringify(doc ?? null); } catch { json = null; }
  return parseTakeoffDoc(json);
}

function hasContent(d: TakeoffDoc): boolean {
  return d.conditions.length > 0 || d.measurements.length > 0 || Object.keys(d.pushed ?? {}).length > 0;
}

const msOr = (s: string | null | undefined): number => stampMs(s) ?? Number.NEGATIVE_INFINITY;

type Loose = Record<string, unknown>;

function dismissedOf(d: TakeoffDoc): string[] | null {
  const v = (d as unknown as Loose).aiDismissed;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
}

/** Rule 5: `base` whole, plus what `other` ADDED since the last sync. */
function carryOver(base: TakeoffDoc, other: TakeoffDoc, sinceMs: number | null): TakeoffDoc {
  const fresh = (createdAt: string): boolean => sinceMs == null || (stampMs(createdAt) ?? Number.NEGATIVE_INFINITY) > sinceMs;

  const conditions = [...base.conditions];
  const condIds = new Set(conditions.map((c) => c.id));
  for (const c of other.conditions) {
    if (condIds.has(c.id) || !fresh(c.createdAt)) continue;
    conditions.push(c); // the object whole: lane TK-b's extra fields ride along
    condIds.add(c.id);
  }

  const measurements = [...base.measurements];
  const measIds = new Set(measurements.map((m) => m.id));
  for (const m of other.measurements) {
    if (measIds.has(m.id) || !condIds.has(m.conditionId) || !fresh(m.createdAt)) continue;
    measurements.push(m);
    measIds.add(m.id);
  }

  const pushed: Record<string, string> = { ...(other.pushed ?? {}), ...(base.pushed ?? {}) };

  const out: TakeoffDoc = { ...base, conditions, measurements, pushed };
  const lpA = base.lastPush;
  const lpB = other.lastPush;
  if (lpA && lpB) out.lastPush = msOr(lpB.at) > msOr(lpA.at) ? lpB : lpA;
  else if (lpA || lpB) out.lastPush = (lpA ?? lpB)!;

  const dA = dismissedOf(base);
  const dB = dismissedOf(other);
  if (dA || dB) {
    const seen = new Set<string>();
    const union: string[] = [];
    for (const id of [...(dA ?? []), ...(dB ?? [])]) {
      if (seen.has(id)) continue;
      seen.add(id);
      union.push(id);
    }
    // The newest (last) ids are kept, the way parseTakeoffDoc normalizes the list.
    (out as unknown as Loose).aiDismissed = union.slice(-AI_DISMISSED_CAP);
  }
  return out;
}

export function mergeTakeoffDocs({ local: localIn, meta, server }: TakeoffMergeInput): TakeoffMergeResult {
  const local = clean(localIn);

  // 1. nothing on the account yet
  if (!server) {
    return { doc: local, push: hasContent(local), keptServer: false, backupLocal: false, notice: null, syncedAt: null, rule: 1 };
  }
  const serverDoc = clean(server.doc);
  const serverMs = stampMs(server.updatedAt);
  const kept = (rule: 2 | 3): TakeoffMergeResult => ({
    doc: serverDoc, push: false, keptServer: true, backupLocal: false, notice: null, syncedAt: server.updatedAt, rule,
  });
  const localWins = (rule: 3 | 4): TakeoffMergeResult => ({
    doc: local, push: true, keptServer: false, backupLocal: false, notice: null, syncedAt: server.updatedAt, rule,
  });

  // 2. nothing unsynced here
  if (meta.localEditedAt == null) return kept(2);

  // 3. the server holds OUR last push
  const pendingMs = stampMs(meta.pendingStamp);
  if (pendingMs != null && serverMs != null && serverMs === pendingMs) {
    const editedMs = stampMs(meta.localEditedAt);
    return editedMs != null && editedMs > pendingMs ? localWins(3) : kept(3);
  }

  // 4. the server has not moved since we last synced
  const lastMs = stampMs(meta.lastSyncedAt);
  if (lastMs != null && serverMs != null && serverMs <= lastMs) return localWins(4);

  // 5. both changed
  const serverIsBase = msOr(server.updatedAt) >= msOr(meta.localEditedAt);
  const since = stampMs(meta.lastSyncedLocalAt);
  const merged = serverIsBase ? carryOver(serverDoc, local, since) : carryOver(local, serverDoc, since);
  return {
    doc: clean(merged),
    push: true,
    keptServer: serverIsBase,
    backupLocal: serverIsBase,
    notice: serverIsBase ? TAKEOFF_CONFLICT_NOTICE_SERVER : TAKEOFF_CONFLICT_NOTICE_LOCAL,
    syncedAt: server.updatedAt,
    rule: 5,
  };
}

// ── one queued write per job (the offline hold) ─────────────────────────────
// utils/offlineQueue appends and never coalesces a record, so every debounced
// push made while offline used to park ANOTHER full copy of the takeoff in the
// queue (on web: localStorage, ~5 MB shared with the Supabase session). Now,
// while this job's last push still sits in the queue, a new push is HELD: the
// edit stays on this browser, the hold is marked, and ONE push of the latest
// doc goes out once that write has left the queue (a queue signal) or at the
// next edit after it has. The queue replays a record's writes oldest-first, so
// the latest doc is always the last write.

/** The push this browser left in the offline queue for a job. */
export interface TakeoffQueuedPush {
  /** The updated_at it carries (meta.pendingStamp when it was sent). */
  stamp: string;
  /** This device's clock when it was sent (→ lastSyncedLocalAt once it lands). */
  sentAt: string;
  /** The hook's edit count when its doc was taken. */
  seq: number;
  /** A later push was held behind it: the takeoff owes one more push. */
  held: boolean;
}

/**
 * Before a push. 'hold' while this job's queued push is still in the queue;
 * 'settle' once it has left (verify what landed, then push); 'push' when
 * nothing is queued. An unreadable queue (null) never holds: a second queued
 * copy is safe (replayed oldest-first), a save that never goes out is not.
 */
export function takeoffPushGate(queued: TakeoffQueuedPush | null, stillQueued: boolean | null): 'push' | 'hold' | 'settle' {
  if (!queued) return 'push';
  if (stillQueued === true) return 'hold';
  if (stillQueued === false) return 'settle';
  return 'push';
}

/** A queue signal (a flush, a drop, a clear): settle only once the write has left. */
export function takeoffQueueSignal(queued: TakeoffQueuedPush | null, stillQueued: boolean | null): 'settle' | 'wait' {
  return queued && stillQueued === false ? 'settle' : 'wait';
}

/**
 * The queued push has left the queue: what landed? `server` is the row's
 * updated_at read back (null: no row; 'error' / 'offline': the read failed).
 *   'synced' — the account holds exactly that push, and nothing is owed;
 *   'push'   — it holds that push, and the takeoff changed since: push the
 *              latest now (straight after the verify, never through rule 3,
 *              whose clock comparison could call a held edit older);
 *   'merge'  — anything else (another device wrote after it, the write was
 *              dropped, the read failed): fetch + merge, which pushes what the
 *              account lacks. The hold never decides the account copy alone.
 */
export function takeoffLandedAction(stamp: string, server: string | null, dirty: boolean): 'synced' | 'push' | 'merge' {
  const sMs = stampMs(stamp);
  const vMs = server == null ? null : stampMs(server);
  if (sMs != null && vMs != null && sMs === vMs) return dirty ? 'push' : 'synced';
  return 'merge';
}

/** Is this offline-queue entry a takeoff_docs write for the job? (id === project_id === the job.) */
export function isTakeoffWriteFor(m: { table?: unknown; data?: unknown } | null | undefined, projectId: string): boolean {
  if (!m || m.table !== 'takeoff_docs' || !projectId) return false;
  const d = m.data as { id?: unknown; project_id?: unknown } | null | undefined;
  return !!d && (d.id === projectId || d.project_id === projectId);
}

/**
 * meta.localEditedAt for an edit made while a push is held behind a queued
 * write: now, or 1 ms past that write's stamp, whichever is later. The stamp
 * can run ahead of this device's clock (nextPushStamp steps past the server's
 * newest), and rule 3 keeps the server's copy unless the edit is LATER than
 * the stamp — so a held edit must always read as later, or a reload before
 * the hold is released would drop it.
 */
export function takeoffHeldEditedAt(nowMs: number, queuedStamp: string): string {
  const q = stampMs(queuedStamp);
  return new Date(q == null ? nowMs : Math.max(nowMs, q + 1)).toISOString();
}
