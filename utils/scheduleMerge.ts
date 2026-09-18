// utils/scheduleMerge.ts
//
// Which schedule copy Schedule Pro may show, and when. Pure + unit-tested
// (scripts/validate-schedule-live-merge.ts replays the cases).
//
// THE RULE (post-ship hotfix, integration round 1 — the "simple, provable"
// fallback). While this screen has an edit it has not written, a write it has
// not seen come back, or a write still leaving (the 500 ms persist debounce,
// ProjectContext's 800 ms sync debounce or its request on the wire, the
// offline queue, a field RPC out), it IGNORES every server copy arriving
// from elsewhere: no merge, no rebase. Once it is quiet it ADOPTS the server's
// copy WHOLE — which holds its own writes and anyone else's. (A copy another
// writer on THIS device put in the store is newer than all of that, and is
// taken sooner — see THE STORE COPY below.)
//
// WHY NOT A MERGE. 357d0a34 merged every realtime event into the working copy
// against a baseline it moved to its own save; the echo of the save before
// (saves ~1 s apart) then read as a peer's change and the GC's drag snapped
// back. Three review rounds of a 3-way merge with an own-echo tracker each
// closed one case and opened another (the last one: a colleague's change the
// socket missed was ignored by the refetch and then overwritten). This rule
// has no baseline to get wrong. What it gives up is the merge: a colleague's
// change to a NON-field key (a date, a duration, a row) that lands while this
// screen is busy is overwritten by this screen's next save — last write wins,
// as before Phase 2. Field-owned values (progress, status, notes, actuals) are
// still protected on the server by projects_keep_newer_field_progress.
//
// HOW A COPY IS PLACED IN TIME. Every row save of the screen carries a unique
// `schedule.updatedAt` (the "stamp", minted in saveAsRow). The server keeps it:
// the keep-newer trigger rewrites tasks only, the offline queue replays the
// same payload, and the field RPC mints its own. Realtime delivers events in
// commit order, so for an EVENT:
//   - my stamp, older than my latest save → an older save of mine: ignore;
//   - my latest stamp → my last save as the server holds it: adopt when quiet;
//   - any other stamp, arriving BEFORE my latest save came back → committed
//     before it, so already overwritten by it: ignore;
//   - any other stamp, arriving AFTER → newer than everything I wrote: adopt
//     when quiet.
// "Adopt when quiet" while busy means PARK: the copy is adopted the moment the
// screen goes quiet, unless the screen writes again first (a newer own save
// makes it old). A copy from OUTSIDE the screen — the foreground refetch, the
// post-queue re-pull, the mount / reconnect re-read — is read from the server after
// everything I wrote had landed, so while quiet it is adopted whole, and —
// except the mount re-read, on a channel that dropped nothing — it also
// stands in for any echo of mine the socket dropped (ScheduleSyncGate
// rereadForGap has why the mount read must not). A re-read answered after a
// copy was adopted in its round trip is not adopted: it is read again.
//
// THE STORE COPY (integration round 3). ProjectContext's project.schedule is
// never older than anything this DEVICE wrote: every local write lands there
// first, and its loader keeps the device row of a project with a write
// waiting, out or queued. So a new copy there that is not this screen's own
// save is either a server read taken while everything had settled, or ANOTHER
// writer on this device (a CO reflow, a schedule accepted on a screen pushed
// over this one) — newer than the working copy either way. It is ignored only
// while the SCREEN has an edit not yet handed over (the persist debounce, a
// field RPC out) — parked meanwhile, dropped by the save that follows — and
// otherwise adopted at once, even with a sync of the project still out:
// waiting for that sync to report used to DROP the other writer's copy, and
// the GC's next drag then overwrote it (takeStoreScheduleCopy).
//
// WHAT A HELD COPY ALREADY HOLDS. A copy read while quiet, or taken from the
// store, contains every save of mine made before it was adopted. The echo of one of
// those saves arriving later is older than what the screen shows — seen, not
// adopted (ScheduleSyncGate.heldThrough) — or a colleague's change the mount
// re-read had shown would vanish until its own echo came back, and a drag in
// between would overwrite it.

import type { ScheduleTask } from '@/types';

/** A schedule as it arrives: its tasks and the save stamp it carries. */
export interface ScheduleCopy {
  tasks: ScheduleTask[];
  /** `schedule.updatedAt` of the row — null when the writer set none. */
  stamp: string | null;
  /** `schedule.baselines` as the copy holds them, when it carries the whole
   *  schedule (an event, a re-read, the store). Adopted with the tasks: the
   *  screen writes its own list back on every save, so a baseline captured
   *  elsewhere (a CO's "Pre-CO" snapshot) would otherwise be deleted by the
   *  next drag. */
  baselines?: readonly unknown[];
}

/** Where a copy came from. `echo` — a realtime event (ordered). `outside` —
 *  project.schedule as ProjectContext holds it after a server read, or the
 *  screen's own reconnect re-read; its time is "now", not the event order. */
export type ScheduleCopySource = 'echo' | 'outside';

/** Own save stamps kept per project, oldest dropped first. Bounded memory
 *  with no change of answer: a dropped stamp belongs to a save older than my
 *  latest, so its echo — read as foreign — arrives before my latest one comes
 *  back (commit order) and is ignored as "committed before it" all the same. */
export const MAX_OWN_SCHEDULE_STAMPS = 256;

interface OwnStamps {
  /** This device's save stamps for the project, oldest first. */
  stamps: string[];
  /** Index in `stamps` of the newest one seen back (an echo, or implied by an
   *  outside copy read while quiet); -1 when none. */
  seen: number;
}

/** Per project, module scope: a remount (leaving the screen and coming back
 *  within the sync debounce, a page with a write in flight) keeps knowing its
 *  saves. They are this device's, whichever mount wrote them. */
const ownStampsByProject = new Map<string, OwnStamps>();

export interface ScheduleSyncGate {
  own: OwnStamps;
  /** Stamp of the copy the working copy is based on (the load, my last save,
   *  the last adopted copy). The store copy of any of them is not news. */
  held: string | null;
  /** My newest save stamp at the last adoption: the adopted copy already
   *  holds that save and every one before it, so their echoes are old news.
   *  Null before any adoption (or when I had saved nothing). */
  heldThrough: string | null;
  /** A copy to adopt as soon as the screen is quiet. */
  parked: ScheduleCopy | null;
  /** The parked copy is a store copy (it holds every save of mine so far). */
  parkedHoldsMine: boolean;
  /** Re-read the row once quiet (beginScheduleReread / answerScheduleReread;
   *  the caller does the read). Owed from the start: the screen opens on
   *  ProjectContext's copy, which can be stale (a change made on his phone
   *  while this tab stayed visible — no foreground refetch), and the live
   *  channel only hears events from its join on. Owed again whenever the
   *  socket re-subscribes: events in the gap are gone. A row save of this
   *  screen settles it instead: the save is the whole row, and its own echo
   *  brings back the server's copy of it. */
  rereadOwed: boolean;
  /** The owed re-read follows a socket gap, so an echo of mine may be gone
   *  for good and the answer must stand in for it (mark my saves seen). A
   *  mount re-read must NOT: on a live channel my last save's echo is still
   *  coming, and a colleague's event committed before that save can arrive
   *  after the read — marked "seen", it would be adopted over my drag. */
  rereadForGap: boolean;
  /** Saves this mount has sent (row or field), and row saves alone. A re-read
   *  issued before a save and answered after it is older than that save. */
  saves: number;
  rowSaves: number;
  /** Copies this gate has adopted. A re-read answered after an adoption it
   *  did not include (a colleague's event landing inside its round trip) may
   *  be OLDER than what the screen now shows — it must not be adopted over
   *  that copy; it is read again instead. */
  adoptions: number;
}

/** The screen loaded `projectId` (mount or project switch). */
export function openScheduleSyncGate(projectId: string | undefined, loadedStamp: string | null): ScheduleSyncGate {
  let own: OwnStamps = { stamps: [], seen: -1 };
  if (projectId) {
    own = ownStampsByProject.get(projectId) ?? own;
    ownStampsByProject.set(projectId, own);
  }
  return { own, held: loadedStamp, heldThrough: null, parked: null, parkedHoldsMine: false, rereadOwed: true, rereadForGap: false, saves: 0, rowSaves: 0, adoptions: 0 };
}

/** A stamp strictly after every own stamp so far — two saves in one
 *  millisecond (the unmount flush right behind a persist) must not share one. */
export function nextOwnScheduleStamp(gate: ScheduleSyncGate, nowMs: number = Date.now()): string {
  const last = gate.own.stamps[gate.own.stamps.length - 1];
  const lastMs = last ? Date.parse(last) : NaN;
  const ms = Number.isFinite(lastMs) && lastMs >= nowMs ? lastMs + 1 : nowMs;
  return new Date(ms).toISOString();
}

/** Call right BEFORE a row save is handed to updateProject. */
export function noteOwnScheduleSave(gate: ScheduleSyncGate, stamp: string): void {
  const own = gate.own;
  own.stamps.push(stamp);
  if (own.stamps.length > MAX_OWN_SCHEDULE_STAMPS) {
    const drop = own.stamps.length - MAX_OWN_SCHEDULE_STAMPS;
    own.stamps.splice(0, drop);
    own.seen = Math.max(-1, own.seen - drop);
  }
  gate.held = stamp;
  gate.saves += 1;
  gate.rowSaves += 1;
  // Anything parked was committed before this save: it is overwritten by it.
  gate.parked = null;
  // An owed re-read is settled by this save (see rereadOwed): anything it
  // could still find is overwritten by the whole row, and the save's echo
  // carries what the server keeps (field values the trigger protected).
  gate.rereadOwed = false;
  gate.rereadForGap = false;
}

/** A field save (the RPC) is leaving: whatever is parked predates it. Its own
 *  echo carries a stamp the server minted, so it arrives as foreign — after
 *  every row save of mine — and is adopted once the RPC has answered. */
export function noteFieldScheduleSave(gate: ScheduleSyncGate): void {
  gate.saves += 1;
  gate.parked = null;
}

/** Saves of this project still in the offline queue from before this mount
 *  (a page reload offline), oldest first: they are mine when they replay. */
export function seedQueuedScheduleStamps(gate: ScheduleSyncGate, queued: readonly string[]): void {
  const own = gate.own;
  const fresh = queued.filter((s) => !own.stamps.includes(s));
  if (fresh.length === 0) return;
  own.stamps.unshift(...fresh);
  if (own.seen >= 0) own.seen += fresh.length;
  if (own.stamps.length > MAX_OWN_SCHEDULE_STAMPS) {
    const drop = own.stamps.length - MAX_OWN_SCHEDULE_STAMPS;
    own.stamps.splice(0, drop);
    own.seen = Math.max(-1, own.seen - drop);
  }
}

/** The `schedule.updatedAt` stamps of this project's writes waiting in the
 *  offline queue (utils/offlineQueue.ts getOwnOfflineQueue), oldest first. */
export function queuedScheduleStamps(
  queue: readonly { table: string; data: Record<string, unknown> }[],
  projectId: string,
): string[] {
  const out: string[] = [];
  for (const m of queue) {
    if (m.table !== 'projects' || m.data?.id !== projectId) continue;
    const stamp = (m.data.schedule as { updatedAt?: unknown } | null | undefined)?.updatedAt;
    if (typeof stamp === 'string') out.push(stamp);
  }
  return out;
}

/** Whether this project has a write in the offline queue. */
export function projectWriteQueued(
  queue: readonly { table: string; data: Record<string, unknown> }[],
  projectId: string,
): boolean {
  return queue.some((m) => m.table === 'projects' && m.data?.id === projectId);
}

/** `holdsMine` — the copy is known to contain every save of mine so far (a
 *  quiet read, or the store copy); not said of an event, whose place after my
 *  latest save may rest on a gap re-read standing in for an echo still on its
 *  way, so my own echo arriving next must still be taken. */
function adopt(gate: ScheduleSyncGate, copy: ScheduleCopy, holdsMine: boolean): ScheduleCopy {
  gate.held = copy.stamp;
  if (holdsMine) gate.heldThrough = gate.own.stamps[gate.own.stamps.length - 1] ?? null;
  gate.parked = null;
  gate.parkedHoldsMine = false;
  gate.adoptions += 1;
  return copy;
}

/**
 * A copy arrived. Returns the copy to adopt NOW (whole), or null (ignored, or
 * parked for when the screen is quiet). `busy` — the screen has an unwritten
 * edit or a write that has not settled (see the header).
 */
export function takeScheduleCopy(
  gate: ScheduleSyncGate,
  copy: ScheduleCopy,
  source: ScheduleCopySource,
  busy: boolean,
  /** 'outside' only: the copy may stand in for echoes of mine the socket
   *  dropped. True for ProjectContext's reads (a foreground refetch follows a
   *  suspended socket); false for a mount re-read on a live channel. */
  echoesMayBeLost = true,
): ScheduleCopy | null {
  const own = gate.own;
  const latest = own.stamps.length - 1;
  const i = copy.stamp !== null ? own.stamps.lastIndexOf(copy.stamp) : -1;

  if (source === 'outside') {
    // The version the working copy is already based on: my own write as the
    // store took it, or a copy this gate adopted (ProjectContext stores it with
    // its stamp). Not news — and my own write is not a server copy. Quiet, my
    // latest stamp here is the server's copy of that save (the refetch after
    // the socket dropped its echo): it has come back.
    if (copy.stamp !== null && copy.stamp === gate.held) {
      if (!busy && echoesMayBeLost && i === latest && i >= 0) own.seen = latest;
      return null;
    }
    if (busy) return null;
    // Quiet: every save of mine has landed (or been refused), so a read of the
    // row now is at least as new as all of them, and stands in for any echo
    // of mine the socket dropped.
    if (echoesMayBeLost) own.seen = latest;
    return adopt(gate, copy, true);
  }

  if (i >= 0) {
    own.seen = Math.max(own.seen, i);
    if (i < latest) return null; // an older save of mine
    // My latest save, but the copy the screen holds was adopted after it and
    // already contains it (see WHAT A HELD COPY ALREADY HOLDS): older news.
    if (gate.heldThrough !== null && i <= own.stamps.lastIndexOf(gate.heldThrough)) return null;
  } else if (own.seen < latest) {
    // Committed before my latest save (it has not come back yet, and events
    // arrive in commit order): that save overwrote it.
    return null;
  }
  if (busy) {
    gate.parked = copy;
    gate.parkedHoldsMine = false;
    return null;
  }
  return adopt(gate, copy, false);
}

/**
 * project.schedule changed in ProjectContext (see THE STORE COPY). Returns the
 * copy to adopt now, or null (not news, or parked while the screen edits).
 *  - `editing` — the screen has an edit not yet handed to the store (the
 *    persist debounce) or a field RPC out;
 *  - `settled` — nothing of this project is waiting, out or queued: the copy
 *    is then the server's, and stands in for any echo of mine the socket
 *    dropped. Unsettled, it is this device's newest copy but not (yet) the
 *    server's: the caller shows it without calling it the server's.
 */
export function takeStoreScheduleCopy(
  gate: ScheduleSyncGate,
  copy: ScheduleCopy,
  editing: boolean,
  settled: boolean,
): ScheduleCopy | null {
  const own = gate.own;
  const latest = own.stamps.length - 1;
  const i = copy.stamp !== null ? own.stamps.lastIndexOf(copy.stamp) : -1;
  // My own save as the store took it (or the copy the gate already holds).
  // Not news — but settled, my latest one here is the server's copy of it
  // (the refetch after the socket dropped its echo): it has come back.
  if (i >= 0 || (copy.stamp !== null && copy.stamp === gate.held)) {
    if (settled && i === latest && i >= 0) own.seen = latest;
    return null;
  }
  if (editing) {
    // The save that follows is built on the working copy without it and
    // drops it (noteOwnScheduleSave); a field RPC answering leaves it to
    // settleScheduleSyncGate.
    gate.parked = copy;
    gate.parkedHoldsMine = true;
    return null;
  }
  if (settled) own.seen = latest;
  return adopt(gate, copy, true);
}

/** The screen may have gone quiet (a save settled, the queue drained, a field
 *  RPC answered). Returns the parked copy to adopt now, if any. */
export function settleScheduleSyncGate(gate: ScheduleSyncGate, busy: boolean): ScheduleCopy | null {
  if (busy || !gate.parked) return null;
  return adopt(gate, gate.parked, gate.parkedHoldsMine);
}

/** The realtime channel (re)subscribed after a gap. */
export function noteScheduleSocketGap(gate: ScheduleSyncGate): void {
  gate.rereadOwed = true;
  gate.rereadForGap = true;
}

/** What a re-read was issued against (beginScheduleReread). */
export interface ScheduleReread { saves: number; rowSaves: number; adoptions: number; forGap: boolean }

/** The screen is quiet: start the owed re-read, if one is owed. The caller
 *  reads the row and hands the answer to answerScheduleReread. */
export function beginScheduleReread(gate: ScheduleSyncGate): ScheduleReread | null {
  if (!gate.rereadOwed) return null;
  const read = { saves: gate.saves, rowSaves: gate.rowSaves, adoptions: gate.adoptions, forGap: gate.rereadForGap };
  gate.rereadOwed = false;
  gate.rereadForGap = false;
  return read;
}

function oweReread(gate: ScheduleSyncGate, forGap: boolean): void {
  gate.rereadOwed = true;
  gate.rereadForGap = gate.rereadForGap || forGap;
}

/**
 * The re-read answered (`answer` null: it failed). `adopt` — the copy to take
 * now; `readAgain` — owe it and re-read at once (the screen is still quiet).
 *  - failed → owed for the next quiet moment;
 *  - a ROW save left meanwhile → settled by that save (see rereadOwed);
 *  - a field save left meanwhile → the read predates it: owed again;
 *  - a copy was adopted meanwhile → the read may predate it: read again;
 *  - otherwise the gate decides, as an outside copy.
 */
export function answerScheduleReread(
  gate: ScheduleSyncGate,
  read: ScheduleReread,
  answer: ScheduleCopy | null,
  busy: boolean,
): { adopt: ScheduleCopy | null; readAgain: boolean } {
  if (!answer) { oweReread(gate, read.forGap); return { adopt: null, readAgain: false }; }
  if (gate.rowSaves !== read.rowSaves) return { adopt: null, readAgain: false };
  if (gate.saves !== read.saves) { oweReread(gate, read.forGap); return { adopt: null, readAgain: false }; }
  if (gate.adoptions !== read.adoptions) { oweReread(gate, read.forGap); return { adopt: null, readAgain: true }; }
  const copy = takeScheduleCopy(gate, answer, 'outside', busy, read.forGap);
  if (!copy && busy) oweReread(gate, read.forGap);
  return { adopt: copy, readAgain: false };
}

/**
 * `incoming`'s tasks — every one, exactly as the server holds it — in the
 * working copy's row order. Adoption is whole in content, not in order: every
 * save goes out re-sorted by start day (buildScheduleFromTasks), so taking the
 * echo's order made the row he just dragged jump to another place in the grid
 * a second after he let go. Rows only the server has go after the row they
 * follow there. The next save sorts again, so this is display only.
 */
export function inLocalOrder(incoming: readonly ScheduleTask[], local: readonly ScheduleTask[]): ScheduleTask[] {
  const byId = new Map(incoming.map((t) => [t.id, t] as const));
  const out = local.filter((t) => byId.has(t.id)).map((t) => byId.get(t.id)!);
  if (out.length === incoming.length) return out;
  const placed = new Set(out.map((t) => t.id));
  incoming.forEach((t, i) => {
    if (placed.has(t.id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((o) => o.id === incoming[j].id);
      if (k >= 0) { at = k + 1; break; }
    }
    out.splice(at, 0, t);
    placed.add(t.id);
  });
  return out;
}

/** Test hook: forget every project's own stamps (a fresh JS runtime). */
export function resetScheduleSyncGatesForTest(): void {
  ownStampsByProject.clear();
}
