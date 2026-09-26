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
