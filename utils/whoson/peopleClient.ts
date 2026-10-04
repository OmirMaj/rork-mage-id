// utils/whoson/peopleClient.ts — the ONE file that calls project_people().
//
// scripts/validate-whoson.ts fails if the function's name is called, or its
// mark argument is named, in any other source file, and if this file imports a
// queueing write.
//
// How a call goes out (whoson spec 3.4):
//   - A READ (mark 'none') is called directly with a 10 s abort, the way
//     contexts/CrewContext.tsx reads project_crew_roster.
//   - A MARK ('open' / 'closed') goes through utils/offlineQueue.ts by its
//     online-only door, supabaseRpcOnline. That door never enqueues, never
//     writes the Not-saved ledger and never toasts: a heartbeat replayed an
//     hour late would say "has it open" about a phone in a pocket.
//   - 'open' / 'closed' are sent only for an account KNOWN to have said yes.
//     The choice is remembered here in memory, per user id, never on disk.
//     Not asked, said no, or not known yet: the call is a plain read.
//   - Single flight per (user, project): the hook's read and the beacon's
//     tick share one in-flight promise, so opening a project costs one
//     request. A leave waits for whatever is in flight, then goes.
//   - A request that went out BEFORE this account saved its choice is a
//     picture from before the save. Its answer never overwrites the saved
//     choice (the question would come back for someone who just answered it),
//     and a caller who asks after the save does not join it: it waits for it,
//     then asks again.
//   - An answer with rows this build cannot use (no row for the viewer, not
//     exactly one owner) is treated exactly like zero rows: nothing is drawn
//     and the project is not asked again until the route changes. Reading it
//     again would return the same rows.
//   - The answer is stamped with when the request was SENT, so a response
//     that took 40 s does not extend any dot.
//   - The answer is thrown away if the signed-in account changed while the
//     request was in flight.
//   - A server refusal (5xx, permission, missing function) stops EVERY call
//     for ten minutes, the hook's reads included: one Supabase incident is
//     one report, not one per project visit.
//   - With WHOS_ON_ENABLED false nothing is ever sent.

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseRpcOnline, currentSessionUserId } from '@/utils/offlineQueue';
import { isTransportError } from '@/utils/networkErrors';
import { isOfflineNow } from '@/hooks/useOnline';
import { WHOS_ON_ENABLED } from '@/constants/featureFlags';
import type { ProjectPerson } from '@/types';
import { WHOSON, mapPeopleRows, peopleUsable } from './people';
import { HEARTBEAT_START, afterResult, afterRouteChange, type HeartbeatState, type PeopleOutcome } from './heartbeat';

export type PeopleMark = 'none' | 'open' | 'closed';

/** What the query cache holds for ['project_people', userId, projectId].
 *  `people: []` = the server answered zero rows (no access, or no such
 *  project) or nothing this build can use: unknown, and every screen draws
 *  nothing for it. A non-empty `people` always holds exactly one owner row and
 *  exactly one row for the viewer. */
export interface PeopleRead {
  people: ProjectPerson[];
  /** When the request that produced this was SENT. */
  fetchedAtMs: number;
}

export type PeopleResult =
  | { outcome: 'ok'; people: ProjectPerson[]; fetchedAtMs: number; marked: boolean }
  | { outcome: 'empty'; fetchedAtMs: number }
  | { outcome: Exclude<PeopleOutcome, 'ok' | 'empty'> };

const DROPPED: PeopleResult = { outcome: 'dropped' };

// ── Module state: memory only ────────────────────────────────────────────────
// Nothing here is written to disk. Choices are keyed by user id, so a second
// account on the same device never reads the first one's answer.
const choices = new Map<string, boolean | null>();
/** When this session last SAVED a choice for an account (the save's answer time). */
const choiceSavedAtMs = new Map<string, number>();
const inFlight = new Map<string, { promise: Promise<PeopleResult>; startedAtMs: number }>();
let heartbeat: HeartbeatState = HEARTBEAT_START;
let lastSentMs: number | null = null;
let reportedUnusable = false;

export type PeopleListener = (userId: string, projectId: string, result: PeopleResult) => void;
const resultListeners = new Set<PeopleListener>();
const kickListeners = new Set<() => void>();

/** Every answered call (leaves excepted), so the beacon can write the cache and re-plan. */
export function subscribePeopleResults(fn: PeopleListener): () => void {
  resultListeners.add(fn);
  return () => { resultListeners.delete(fn); };
}

/** "Tick now" requests from outside the beacon: the choice was saved. */
export function subscribePresenceKick(fn: () => void): () => void {
  kickListeners.add(fn);
  return () => { kickListeners.delete(fn); };
}
export function kickPresence(): void {
  for (const fn of [...kickListeners]) {
    try { fn(); } catch { /* a listener must never break a save */ }
  }
}

/** The account's own choice as this session last heard it. undefined = not known yet. */
export function knownChoice(userId: string | null | undefined): boolean | null | undefined {
  return userId ? choices.get(userId) : undefined;
}
/**
 * A choice learned from a READ. `sentAtMs` is when that read was sent: a read
 * that went out before this session saved a choice is a picture from before
 * the save, and is ignored.
 */
export function rememberChoice(userId: string, choice: boolean | null, sentAtMs?: number): void {
  if (!userId) return;
  if (typeof sentAtMs === 'number' && sentAtMs < (choiceSavedAtMs.get(userId) ?? 0)) return;
  choices.set(userId, choice);
}
/** The choice this session just SAVED (the server has answered the save). */
export function rememberSavedChoice(userId: string, choice: boolean): void {
  if (!userId) return;
  choiceSavedAtMs.set(userId, Date.now());
  choices.set(userId, choice);
}

export function heartbeatState(): HeartbeatState {
  return heartbeat;
}
export function lastPeopleSentMs(): number | null {
  return lastSentMs;
}
export function peopleInFlight(userId: string | null, projectId: string | null): boolean {
  return !!userId && !!projectId && inFlight.has(flightKey(userId, projectId));
}
/** The route names another project: a project that answered zero rows may be asked again. */
export function notePeopleRouteChange(): void {
  heartbeat = afterRouteChange(heartbeat);
}

function flightKey(userId: string, projectId: string): string {
  return `${userId}:${projectId}`;
}

function reportReadRefusal(message: string, code: string | undefined): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/react-native');
    Sentry.captureMessage(`[WhosOn] people read refused${code ? ` (${code})` : ''}: ${message.slice(0, 120)}`, 'warning');
  } catch {/* ignore */}
}

/** Once a session: the server sent rows this build dropped or could not use. Counts only, no names. */
function reportUnusable(received: number, understood: number, usable: boolean): void {
  if (reportedUnusable) return;
  reportedUnusable = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/react-native');
    Sentry.captureMessage(`[WhosOn] people answer ${usable ? 'had rows dropped' : 'not usable'}: ${received} rows, ${understood} understood`, 'warning');
  } catch {/* ignore */}
}

async function sessionIs(userId: string): Promise<boolean> {
  try { return (await currentSessionUserId()) === userId; } catch { return false; }
}

function fromRows(userId: string, rows: unknown, sentAtMs: number, mark: PeopleMark): PeopleResult {
  const mapped = mapPeopleRows(rows);
  const received = Array.isArray(rows) ? rows.length : 0;
  const usable = peopleUsable(mapped);
  if (received > mapped.length || (received > 0 && !usable)) reportUnusable(received, mapped.length, usable);
  // Zero rows, or rows nobody can draw from (the viewer's own row is missing,
  // or there is not exactly one owner): one answer, 'empty'. The heartbeat
  // stops this project until the route changes; asking again would return the
  // same rows.
  if (!usable) return { outcome: 'empty', fetchedAtMs: sentAtMs };
  let people = mapped;
  if (sentAtMs < (choiceSavedAtMs.get(userId) ?? 0)) {
    // Sent before this account saved its choice: what it says about the choice
    // is from before the save. Keep what was saved.
    const saved = choices.get(userId);
    if (saved !== undefined) people = mapped.map(p => (p.isSelf ? { ...p, sharesPresence: saved } : p));
  } else {
    const self = mapped.find(p => p.isSelf);
    if (self) choices.set(userId, self.sharesPresence);
  }
  return { outcome: 'ok', people, fetchedAtMs: sentAtMs, marked: mark === 'open' };
}

async function sendRead(userId: string, projectId: string): Promise<PeopleResult> {
  // Web, offline: nothing is sent, so nothing can be wrong. Not a failure.
  if (isOfflineNow()) return { outcome: 'offline' };
  if (!(await sessionIs(userId))) return DROPPED;
  const sentAtMs = Date.now();
  lastSentMs = sentAtMs;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, WHOSON.READ_TIMEOUT_MS);
  try {
    const res = await supabase.rpc('project_people', { p_project_id: projectId, p_mark: 'none' }).abortSignal(ctrl.signal);
    if (!(await sessionIs(userId))) return DROPPED;
    if (res.error) {
      if (timedOut || isTransportError(res.error)) return { outcome: 'unknown' };
      reportReadRefusal(res.error.message ?? 'error', (res.error as { code?: string }).code);
      return { outcome: 'server' };
    }
    return fromRows(userId, res.data, sentAtMs, 'none');
  } catch (err) {
    if (timedOut || isTransportError(err)) return { outcome: 'unknown' };
    reportReadRefusal(err instanceof Error ? err.message : String(err), undefined);
    return { outcome: 'server' };
  } finally {
    clearTimeout(timer);
  }
}

async function sendMark(userId: string, projectId: string, mark: 'open' | 'closed'): Promise<PeopleResult> {
  // The door sends as whoever is signed in: make sure that is still this account.
  if (!(await sessionIs(userId))) return DROPPED;
  const sentAtMs = Date.now();
  lastSentMs = sentAtMs;
  const res = await supabaseRpcOnline<unknown>('project_people', { p_project_id: projectId, p_mark: mark });
  if (!(await sessionIs(userId))) return DROPPED;
  if (res.status === 'synced') return fromRows(userId, res.data, sentAtMs, mark);
  if (res.status === 'unknown') return { outcome: 'unknown' };
  if (res.code === 'offline') return { outcome: 'offline' };
  // The door has already reported a server refusal to Sentry.
  if (res.code === 'server') return { outcome: 'server' };
  return DROPPED; // session_changed, not_configured: nothing was sent
}

async function send(userId: string, projectId: string, asked: PeopleMark): Promise<PeopleResult> {
  const saidYes = choices.get(userId) === true;
  const mark: PeopleMark = asked !== 'none' && saidYes ? asked : 'none';
  // Nothing was ever stored for an account that has not said yes: no leave to send.
  if (asked === 'closed' && mark !== 'closed') return DROPPED;
  if (Date.now() < heartbeat.pausedUntilMs) return DROPPED;
  let result: PeopleResult;
  try {
    result = mark === 'none' ? await sendRead(userId, projectId) : await sendMark(userId, projectId, mark);
  } catch {
    // The door and the read both answer rather than throw; this is the last net.
    result = { outcome: 'unknown' };
  }
  const nowMs = Date.now();
  if (asked === 'closed') {
    // A leave is best-effort. Only a server refusal counts: it starts the pause.
    if (result.outcome === 'server') heartbeat = afterResult(heartbeat, { outcome: 'server', projectId, nowMs });
    return result;
  }
  heartbeat = afterResult(heartbeat, { outcome: result.outcome, projectId, nowMs });
  return result;
}

function tell(userId: string, projectId: string, result: PeopleResult): void {
  for (const fn of [...resultListeners]) {
    try { fn(userId, projectId, result); } catch { /* a listener must never break a read */ }
  }
}

/**
 * Read the people on a project and, for an account that said yes, say whether
 * it has the project open ('open') or has left it ('closed').
 */
export function callPeople(userId: string | null | undefined, projectId: string | null | undefined, mark: PeopleMark): Promise<PeopleResult> {
  if (!WHOS_ON_ENABLED || !isSupabaseConfigured || !userId || !projectId) return Promise.resolve(DROPPED);
  const key = flightKey(userId, projectId);
  const running = inFlight.get(key);
  if (mark === 'closed') {
    const go = () => send(userId, projectId, 'closed');
    return running ? running.promise.then(go, go) : go();
  }
  if (running) {
    // In flight since before this account saved its choice: its answer is a
    // picture from before the save. Wait for it, then ask again.
    if (running.startedAtMs < (choiceSavedAtMs.get(userId) ?? 0)) {
      const again = () => callPeople(userId, projectId, mark);
      return running.promise.then(again, again);
    }
    return running.promise;
  }
  const p: Promise<PeopleResult> = send(userId, projectId, mark)
    .catch((): PeopleResult => ({ outcome: 'unknown' }))
    .then((result) => {
      // Free the slot BEFORE telling anyone: a listener that plans the next
      // tick must not find this request still in flight.
      if (inFlight.get(key)?.promise === p) inFlight.delete(key);
      tell(userId, projectId, result);
      return result;
    });
  inFlight.set(key, { promise: p, startedAtMs: Date.now() });
  return p;
}

/** A result as the query cache keeps it, or null when there is nothing to keep. */
export function readOf(result: PeopleResult): PeopleRead | null {
  if (result.outcome === 'ok') return { people: result.people, fetchedAtMs: result.fetchedAtMs };
  if (result.outcome === 'empty') return { people: [], fetchedAtMs: result.fetchedAtMs };
  return null;
}

/** Tests only: forget everything this module remembers. */
export function __resetPeopleClientForTest(): void {
  choices.clear();
  choiceSavedAtMs.clear();
  reportedUnusable = false;
  inFlight.clear();
  heartbeat = HEARTBEAT_START;
  lastSentMs = null;
  resultListeners.clear();
  kickListeners.clear();
}
