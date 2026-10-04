// utils/whoson/heartbeat.ts — when the one root timer speaks, and when it
// stays quiet. Pure: no react, no timers, no network. The beacon
// (components/whoson/ProjectPresenceBeacon.tsx) owns the timer and asks this
// file what to do; scripts/validate-whoson.ts runs the truth tables.
//
// The rules (whoson spec 3.1, 3.3):
//   - One request a minute while a signed-in person has a screen of a SHARED
//     project in front, the app is in the foreground and (web) there was input
//     in the last five minutes. It is a mark ('open') only for a person who
//     said yes; for everyone else it is a read.
//   - An owner alone with an invite out reads every two minutes (that is how
//     he sees his sub appear). An owner alone with nothing pending never ticks.
//   - No answer (a transport error): wait 60 s, then 120 s, then 300 s, and
//     stay there; the first answer resets it.
//   - The server said no (5xx, permission, missing function): every project
//     stops for ten minutes.
//   - Zero rows (no access, or not on the server yet), or rows this build
//     cannot use (no row for the viewer, not exactly one owner): that project
//     stops until the route changes. Second lock: with such an answer cached,
//     a read never follows the last request by less than a minute.
//   - A MARK is counted from the last MARK, not from the last request. Plain
//     reads (a screen opening the Team section, a saved choice, a roster
//     change) must never push the next mark out, or a person who has the
//     project open and is using it would lose the dot after 150 seconds.
//   - A leave is sent once when the route leaves the project, when the app
//     reaches the background, and when the web idle limit is reached.
//     `inactive` is ignored: iOS reports it for Face ID, Control Centre and
//     call banners, and a leave there would flap the dot.

import { WHOSON } from './people';

export type TickAction = 'mark' | 'read' | 'none';

/** What the last read of the route's project told this device. null = nothing read yet. */
export interface CachedPeopleFacts {
  /** The read answered with rows this viewer may see. */
  known: boolean;
  /** Somebody other than the owner is on the project. */
  shared: boolean;
  viewerIsOwner: boolean;
  /** The viewer's own choice: true, false, or null = not asked yet. */
  choice: boolean | null;
}

export interface TickInput {
  userId: string | null;
  routeProjectId: string | null;
  /** The app is in front (`inactive` counts as in front). */
  foreground: boolean;
  /** Web only: no input for WEB_IDLE_MS. Always false on native. */
  webIdle: boolean;
  cached: CachedPeopleFacts | null;
  /** The owner's own roster holds an invite nobody has accepted yet. */
  ownerHasPending: boolean;
  inFlight: boolean;
  backoffLevel: number;
  pausedUntilMs: number;
  /** Zero rows, or rows nobody can use, came back for this project; nothing
   *  more until the route changes. */
  stopped?: boolean;
  /** This device has already marked this project open since it came to the front. */
  marked?: boolean;
  nowMs: number;
}

export interface Tick {
  action: TickAction;
  /** How long to wait: a mark after the last MARK, a read after the last
   *  request of any kind (dueInMs does the counting). */
  delayMs: number;
}

const NONE: Tick = { action: 'none', delayMs: 0 };

/** 0 = no back-off; level 1, 2, 3+ = 60 s, 120 s, 300 s. */
export function backoffDelayMs(level: number): number {
  if (!(level > 0)) return 0;
  const steps = WHOSON.BACKOFF_MS;
  return steps[Math.min(Math.floor(level), steps.length) - 1];
}

/** The next thing the timer does, and how long after the last request. */
export function nextTick(i: TickInput): Tick {
  if (!i.userId || !i.routeProjectId) return NONE;
  if (!i.foreground || i.webIdle || i.inFlight) return NONE;
  if (i.nowMs < i.pausedUntilMs) return NONE;
  if (i.stopped) return NONE;
  const backoff = backoffDelayMs(i.backoffLevel);
  // Nothing read yet for this project: one read tells shared / choice.
  if (!i.cached) return { action: 'read', delayMs: backoff };
  // A read answered and nothing in it was usable. The client stops the project
  // for that (`stopped`, above); the route came back to it, so it may be asked
  // again, but never in a loop: a minute after the last request at the soonest.
  if (!i.cached.known) return { action: 'read', delayMs: Math.max(WHOSON.TICK_MS, backoff) };
  if (i.cached.shared) {
    if (i.cached.choice === true) {
      // The first mark goes within seconds of the project coming to the front.
      const base = i.marked ? WHOSON.TICK_MS : WHOSON.MIN_GAP_MS;
      return { action: 'mark', delayMs: Math.max(base, backoff) };
    }
    // Said no, or not asked yet: nothing is stored, the rows still come back.
    return { action: 'read', delayMs: Math.max(WHOSON.TICK_MS, backoff) };
  }
  // Nobody has joined. Only an owner waiting on an invite keeps looking.
  if (i.cached.viewerIsOwner && i.ownerHasPending) {
    return { action: 'read', delayMs: Math.max(WHOSON.SLOW_TICK_MS, backoff) };
  }
  return NONE;
}

/**
 * Milliseconds from now until a tick may be sent.
 *
 * The floor under everything: MIN_GAP_MS, and the back-off, after the last
 * request of ANY kind (`lastSentMs`).
 *   'event':  an "immediate" tick (route change, back to active, first input
 *             after idle, the choice saved, the roster changed): the floor and
 *             nothing more.
 *   'result': the periodic case.
 *             A MARK is `tick.delayMs` after the last MARK (`lastMarkMs`), so
 *             a plain read in between never pushes it out. With no mark sent
 *             yet for this project it is counted from the last request.
 *             A READ is `tick.delayMs` after the last request of any kind:
 *             whatever was read then is as fresh as a tick would have made it.
 */
export function dueInMs(a: {
  tick: Tick;
  reason: 'result' | 'event';
  /** When anything was last sent (a read, a mark, a leave). */
  lastSentMs: number | null;
  /** When a mark was last sent for the route's project. null = none since it came to the front. */
  lastMarkMs?: number | null;
  backoffLevel: number;
  nowMs: number;
}): number {
  if (a.tick.action === 'none') return 0;
  // Nothing has been sent yet in this session: an event goes at once.
  if (a.lastSentMs === null) return a.reason === 'event' ? 0 : a.tick.delayMs;
  const sinceSent = Math.max(0, a.nowMs - a.lastSentMs);
  const floor = Math.max(WHOSON.MIN_GAP_MS, backoffDelayMs(a.backoffLevel)) - sinceSent;
  if (a.reason === 'event') return Math.max(0, floor);
  const markAt = a.tick.action === 'mark' && typeof a.lastMarkMs === 'number' ? a.lastMarkMs : null;
  const sincePeriod = markAt === null ? sinceSent : Math.max(0, a.nowMs - markAt);
  return Math.max(0, floor, a.tick.delayMs - sincePeriod);
}

// ── Leave ────────────────────────────────────────────────────────────────────

export type PresenceAppState = 'active' | 'inactive' | 'background';

export interface PresenceSituation {
  userId: string | null;
  /** The project the focused route names. */
  projectId: string | null;
  appState: PresenceAppState;
  webIdle: boolean;
}

/**
 * The project to send one 'closed' for, or null. `markedProjectId` is the
 * project this device last marked open and has not left yet; with nothing
 * marked there is nothing to leave. The caller clears it once the leave is
 * sent, which is what makes each of these one leave and not a stream.
 */
export function leaveNeeded(
  prev: PresenceSituation & { markedProjectId: string | null },
  next: PresenceSituation,
): string | null {
  const marked = prev.markedProjectId;
  if (!marked || !prev.userId) return null;
  // Another account (or nobody) is signed in now: there is no one to speak as.
  if (next.userId !== prev.userId) return null;
  if (next.projectId !== marked) return marked;
  if (next.appState === 'background' && prev.appState !== 'background') return marked;
  if (next.webIdle && !prev.webIdle) return marked;
  return null;
}

// ── Results ──────────────────────────────────────────────────────────────────

/** How a call ended, as the beacon needs it. */
export type PeopleOutcome =
  /** Rows came back. */
  | 'ok'
  /** The server answered with zero rows (no access, or no such project), or
   *  with rows this build cannot use (no row for the viewer, not exactly one owner). */
  | 'empty'
  /** A transport error or a timeout: it may or may not have reached the server. */
  | 'unknown'
  /** The server answered with an error. */
  | 'server'
  /** Web, offline at the call: nothing was sent. Not a failure. */
  | 'offline'
  /** Not sent, or the answer was thrown away (another account signed in, the flag is off, paused). */
  | 'dropped';

export interface HeartbeatState {
  backoffLevel: number;
  /** No request for any project before this time. */
  pausedUntilMs: number;
  /** The project that answered zero rows, or nothing usable. Cleared when the route changes. */
  stoppedProjectId: string | null;
}

export const HEARTBEAT_START: HeartbeatState = Object.freeze({ backoffLevel: 0, pausedUntilMs: 0, stoppedProjectId: null });

export function afterResult(
  state: HeartbeatState,
  result: { outcome: PeopleOutcome; projectId: string; nowMs: number },
): HeartbeatState {
  switch (result.outcome) {
    case 'ok':
      return {
        backoffLevel: 0,
        pausedUntilMs: state.pausedUntilMs,
        stoppedProjectId: state.stoppedProjectId === result.projectId ? null : state.stoppedProjectId,
      };
    case 'empty':
      return { backoffLevel: 0, pausedUntilMs: state.pausedUntilMs, stoppedProjectId: result.projectId };
    case 'unknown':
      return { ...state, backoffLevel: Math.min(state.backoffLevel + 1, WHOSON.BACKOFF_MS.length) };
    case 'server':
      return { ...state, pausedUntilMs: result.nowMs + WHOSON.SERVER_PAUSE_MS };
    case 'offline':
    case 'dropped':
    default:
      return state;
  }
}

/** The route names another project (or none): a stopped project may be asked again later. */
export function afterRouteChange(state: HeartbeatState): HeartbeatState {
  return state.stoppedProjectId === null ? state : { ...state, stoppedProjectId: null };
}

/** Web: has the input gone quiet for the idle limit? Native never idles (spec 3.1). */
export function isWebIdle(a: { isWeb: boolean; lastInputMs: number; nowMs: number }): boolean {
  if (!a.isWeb) return false;
  return a.nowMs - a.lastInputMs >= WHOSON.WEB_IDLE_MS;
}
