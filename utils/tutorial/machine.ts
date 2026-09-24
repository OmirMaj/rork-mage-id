// utils/tutorial/machine.ts — the tutorial step machine, pure.
//
// One reducer, reduceTutorial(state, event, defs), and the selectors the host
// reads. No react / react-native imports, no clock reads (every event carries
// `now`), no randomness — scripts/validate-tutorial-machine.ts table-tests it
// under bun.
//
// THE RULES THAT MATTER (spec §3), and why:
//   a. A completion (SIGNAL / ROUTE / TARGET) counts only while running, in
//      phase 'step', not paused, and on the SANDBOX project. Anything else is
//      ignored — which makes signals idempotent and means a real job's save
//      can never tick a tutorial step. ONE exception: a sandbox SIGNAL still
//      counts under an OFFROUTE pause. A save handler may navigate before its
//      signal lands (goBack() then an async save finishing), and the signal
//      carries the sample's id, so it can only come from a sample screen;
//      dropping it would strand the run paused on a save he really made.
//      A background / restored pause still drops it (only RESUME lifts those).
//   b. A signal or mounted-target completion that matches the current step OR
//      A LATER one jumps there (skip-ahead). A GC who does things in his own
//      order is never stuck. ROUTE completions do NOT skip ahead: leaving the
//      punch walk before saving would otherwise "complete" the back-to-the-job
//      step and jump over the save he never made; a route change that is not
//      the current step's goal pauses instead.
//   c. A completed step with `success` celebrates; CELEBRATION_DONE advances.
//   d. NEXT only moves a look step. Only the real action moves a do/wait step.
//   e. SKIP_STEP is always legal (the UI decides when to OFFER it).
//   f. skipIf auto-skips on step entry, from the BOOTED flags.
//   g. Past the last step → 'finale'; FINISH → finished/completed.
//   h. EXIT → finished/exited.
//   i. Leaving the step's route pauses; coming back resumes. A pause for any
//      other reason (background, restored) is only lifted by RESUME.
//   j. RESTORE rebuilds a PAUSED run at the last checkpoint. It never resumes
//      by itself.

import type {
  AssistId,
  BootFlags,
  CoachEnv,
  CoachView,
  CopyCtx,
  Copy,
  CurrentRoute,
  ExitReason,
  LayerId,
  PauseReason,
  RouteParams,
  RunState,
  RunningState,
  SavedActiveRun,
  SignalName,
  SignalPayload,
  StartCtx,
  StepUntil,
  StepVia,
  TargetId,
  TutorialDef,
  TutorialDefs,
  TutorialEvent,
  TutorialPathname,
  TutorialStep,
} from './types';
import { LAYER_ORDER, isBlockerTarget } from './registry';

// ── Timings (the host owns the timers; the numbers live here so the copy,
//    the host and the validator agree) ──────────────────────────────────────

export const CELEBRATE_MS = 1400;
export const STUCK_MS = 15_000;
export const TARGET_TIMEOUT_MS = 4_000;
export const OFFROUTE_EXIT_MS = 10 * 60_000;
export const BACKGROUND_EXIT_MS = 60 * 60_000;
export const RESTORE_MAX_AGE_MS = 24 * 60 * 60_000;

export const IDLE: RunState = { status: 'idle' };

const DEFAULT_FLAGS: BootFlags = { samplePlan: true, mic: true };

// ── Small pure helpers ──────────────────────────────────────────────────────

export function defFor(state: RunState, defs: TutorialDefs): TutorialDef | null {
  if (state.status === 'idle') return null;
  return defs[state.tutorialId] ?? null;
}

export function currentStep(state: RunState, defs: TutorialDefs): TutorialStep | null {
  if (state.status !== 'running') return null;
  const def = defs[state.tutorialId];
  if (!def) return null;
  return def.steps[state.stepIndex] ?? null;
}

export function targetChain(step: TutorialStep | null | undefined): readonly TargetId[] {
  if (!step?.target) return [];
  return typeof step.target === 'string' ? [step.target as TargetId] : (step.target as readonly TargetId[]);
}

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function normPath(p: string): string {
  if (p.length > 1 && p.endsWith('/')) return p.slice(0, -1);
  return p;
}

/** The project the run's completions must name: the sample, or the real job
 *  in current-real mode (the opt-in first-bid coach). */
export function expectedProjectId(state: RunningState, def: TutorialDef): string | null {
  if (def.sandbox === 'current-real') return state.realProjectId ?? null;
  return state.sandboxProjectId;
}

export function routeMatches(
  route: { pathname: string; params: RouteParams } | null,
  want: { pathname: string; projectParam: string },
  projectId: string | null,
): boolean {
  if (!route || !projectId) return false;
  if (normPath(route.pathname) !== normPath(want.pathname)) return false;
  return firstParam(route.params[want.projectParam]) === projectId;
}

function untilKey(u: StepUntil | undefined): string | null {
  if (!u) return null;
  if ('signal' in u) return `signal:${u.signal}`;
  if ('mounted' in u) return `mounted:${u.mounted}`;
  return `route:${u.route.pathname}:${u.route.projectParam}`;
}

function flagSkips(step: TutorialStep, flags: BootFlags): boolean {
  if (step.skipIf === 'noSamplePlan') return flags.samplePlan === false;
  if (step.skipIf === 'noMicOnPlatform') return flags.mic === false;
  return false;
}

// ── Step entry / completion ─────────────────────────────────────────────────

/**
 * A route goal satisfied by the current route, searched forward from `from`
 * across LOOK steps only. The one rule, kept deliberately simple so it can be
 * proved by table test:
 *   • a look step asks nothing of him, so walking past it is never a skip of
 *     real work — "back to the job" pressed during the save stamp or on the
 *     '1 item logged' card completes 'back' and lands on the result;
 *   • a do / wait step that does not itself match stops the search, so leaving
 *     the walk BEFORE saving still pauses instead of jumping over the save.
 * Extended over the contiguous steps that share that completion (completeRun).
 */
function routeCompletionAcrossLooks(s: RunningState, def: TutorialDef, from: number): { from: number; to: number } | null {
  const pid = expectedProjectId(s, def);
  for (let i = from; i < def.steps.length; i += 1) {
    const st = def.steps[i];
    const u = st.until;
    if (u && 'route' in u && routeMatches(s.route, u.route, pid)) {
      let j = i;
      const key = untilKey(u);
      while (j + 1 < def.steps.length && untilKey(def.steps[j + 1].until) === key) j += 1;
      return { from, to: j };
    }
    if (st.kind !== 'look') return null;
  }
  return null;
}

/** Complete through a route goal he has already reached, else re-derive the
 *  offroute pause. The ROUTE, RESUME and step-entry paths all settle here, so
 *  a pause is never raised on a route that is itself the next goal. */
function settleOnRoute(s: RunningState, def: TutorialDef, now: number): RunningState {
  if (s.phase !== 'step') return s;
  if (s.paused && s.paused.reason !== 'offroute') return s;
  const hit = routeCompletionAcrossLooks(s, def, s.stepIndex);
  if (hit) return completeRun(s, def, hit.from, hit.to, 'signal', now);
  return withRoutePause(s, def, now);
}

/** Recompute the pause against the current route. An offroute pause is the
 *  only kind the route can lift; background / restored wait for RESUME. */
function withRoutePause(s: RunningState, def: TutorialDef, now: number): RunningState {
  if (s.phase !== 'step') return s;
  if (s.paused && s.paused.reason !== 'offroute') return s;
  const step = def.steps[s.stepIndex];
  if (!step || !s.route) return s;
  const onRoute = routeMatches(s.route, step.route, expectedProjectId(s, def));
  if (onRoute) return s.paused ? { ...s, paused: false } : s;
  if (s.paused && s.paused.reason === 'offroute') return s;
  return { ...s, paused: { reason: 'offroute', at: now } };
}

function enterStep(s0: RunningState, def: TutorialDef, index: number, now: number): RunningState {
  let s = s0;
  let i = index;
  // Loop, not recursion, for skipIf runs; completion-on-entry recurses via
  // completeRun, which always moves the index forward, so it terminates.
  for (;;) {
    if (i >= def.steps.length) {
      return { ...s, phase: 'finale', stepIndex: def.steps.length - 1, finaleAt: now, celebrate: undefined, failure: undefined, paused: s.paused && s.paused.reason !== 'offroute' ? s.paused : false };
    }
    const step = def.steps[i];
    if (flagSkips(step, s.flags)) {
      s = { ...s, skipped: [...s.skipped, step.id], log: [...s.log, { stepId: step.id, stepIndex: i, via: 'skip_step', ms: 0, at: now }] };
      i += 1;
      continue;
    }
    break;
  }
  const step = def.steps[i];
  s = {
    ...s,
    phase: 'step',
    stepIndex: i,
    stepEnteredAt: now,
    targetMissing: false,
    stuck: false,
    failure: undefined,
    celebrate: undefined,
    firstActionAt: s.firstActionAt ?? (step.kind === 'do' ? now : undefined),
  };
  const blocked = s.paused && s.paused.reason !== 'offroute';
  if (!blocked) {
    // Already satisfied on entry: the awaited target is already mounted, or
    // the route he is on IS the goal — of this step, or of a later one
    // reachable across look steps only (he went back to the job while the
    // stamp or a look card was up). Complete now instead of waiting for an
    // event that already happened.
    const u = step.until;
    if (u && 'mounted' in u && s.mounted.includes(u.mounted)) {
      return completeRun(s, def, i, i, 'signal', now);
    }
  }
  return settleOnRoute(s, def, now);
}

/**
 * Complete step `to`, starting from the current step `from`. Steps strictly
 * between them that wait on the SAME completion (the invoice's do "Send to me"
 * and its wait-for-the-sheet step both end on invoice.sent) completed
 * naturally; any other step jumped over is recorded as skipped.
 */
function completeRun(s: RunningState, def: TutorialDef, from: number, to: number, via: StepVia, now: number): RunningState {
  const target = def.steps[to];
  const key = untilKey(target.until);
  const skipped = [...s.skipped];
  const log = [...s.log];
  let natural = true;
  for (let k = from; k < to; k += 1) {
    const st = def.steps[k];
    if (key !== null && untilKey(st.until) === key) {
      log.push({ stepId: st.id, stepIndex: k, via, ms: k === from ? now - s.stepEnteredAt : 0, at: now });
    } else {
      natural = false;
      skipped.push(st.id);
    }
  }
  const usedAssist = s.assists.some(a => a.stepId === target.id || a.stepId === def.steps[from]?.id);
  const finalVia: StepVia = !natural ? 'skip_ahead' : via === 'signal' && usedAssist ? 'assist' : via;
  log.push({ stepId: target.id, stepIndex: to, via: finalVia, ms: from === to ? now - s.stepEnteredAt : 0, at: now });
  const next: RunningState = { ...s, skipped, log, failure: undefined, stuck: false, targetMissing: false };
  if (target.success) {
    return { ...next, phase: 'celebrate', stepIndex: to, celebrate: { stepId: target.id, signal: target.until && 'signal' in target.until ? target.until.signal : null, at: now } };
  }
  return enterStep(next, def, to + 1, now);
}

/** First step at or after `from` whose until matches, extended over the
 *  contiguous steps that share that same completion (see completeRun). */
function findCompletion(def: TutorialDef, from: number, matches: (u: StepUntil) => boolean, allowAhead: boolean): { from: number; to: number } | null {
  const last = allowAhead ? def.steps.length - 1 : from;
  for (let i = from; i <= last; i += 1) {
    const u = def.steps[i]?.until;
    if (!u || !matches(u)) continue;
    let j = i;
    const key = untilKey(u);
    while (j + 1 < def.steps.length && untilKey(def.steps[j + 1].until) === key) j += 1;
    return { from, to: j };
  }
  return null;
}

// ── The reducer ─────────────────────────────────────────────────────────────

export function reduceTutorial(state: RunState, event: TutorialEvent, defs: TutorialDefs): RunState {
  switch (event.type) {
    case 'START': {
      // A second START while a run is live is a double tap, not a replay: the
      // hub EXITs first to replay. The finale is the one live phase a START
      // may replace (the chain offer).
      if (state.status === 'running' && state.phase !== 'finale') return state;
      const def = defs[event.tutorialId];
      if (!def) return state;
      return {
        status: 'running',
        tutorialId: def.id,
        version: def.version,
        sandboxProjectId: event.sandboxProjectId,
        realProjectId: event.realProjectId ?? null,
        entry: event.entry,
        returnTo: event.returnTo ?? null,
        phase: 'boot',
        stepIndex: 0,
        stepEnteredAt: event.now,
        startedAt: event.now,
        paused: false,
        targetMissing: false,
        stuck: false,
        skipped: [],
        assists: [],
        payloads: {},
        signalAt: {},
        flags: DEFAULT_FLAGS,
        route: null,
        mounted: [],
        log: [],
      };
    }

    case 'RESTORE': {
      if (state.status === 'running') return state;
      const saved = event.saved;
      const def = defs[saved.tutorialId];
      const fresh = event.now - saved.savedAt >= 0 && event.now - saved.savedAt < RESTORE_MAX_AGE_MS;
      if (!def || def.version !== saved.version || !fresh || !event.sampleExists) return IDLE;
      const idx = checkpointIndexAtOrBefore(def, saved.stepIndex);
      return {
        status: 'running',
        tutorialId: def.id,
        version: def.version,
        sandboxProjectId: saved.sandboxProjectId,
        realProjectId: null,
        entry: saved.entry,
        returnTo: saved.returnTo ?? null,
        phase: 'step',
        stepIndex: idx,
        stepEnteredAt: event.now,
        startedAt: event.now,
        paused: { reason: 'restored', at: event.now },
        targetMissing: false,
        stuck: false,
        skipped: [],
        assists: [],
        payloads: {},
        signalAt: {},
        flags: DEFAULT_FLAGS,
        route: null,
        mounted: [],
        log: [],
      };
    }

    default:
      break;
  }

  if (state.status !== 'running') return state;
  const def = defs[state.tutorialId];
  if (!def) return state;
  const s = state;
  const now = event.now;

  switch (event.type) {
    case 'BOOTED': {
      if (s.phase !== 'boot') return s;
      const booted: RunningState = { ...s, flags: event.flags, mounted: event.mounted ? Array.from(new Set(event.mounted)) : s.mounted };
      return enterStep(booted, def, 0, now);
    }

    case 'ROUTE': {
      const route: CurrentRoute = { pathname: event.pathname, params: event.params };
      const withRoute: RunningState = { ...s, route };
      if (s.phase !== 'step') return withRoute;
      if (s.paused && s.paused.reason !== 'offroute') return withRoute;
      // Skip-ahead for a route goal crosses look steps only (see
      // routeCompletionAcrossLooks): never over a do step he hasn't done.
      return settleOnRoute(withRoute, def, now);
    }

    case 'TARGET': {
      const set = new Set(s.mounted);
      if (event.mounted) set.add(event.id);
      else set.delete(event.id);
      let next: RunningState = { ...s, mounted: Array.from(set) };
      if (s.phase !== 'step' || s.paused) return next;
      const step = def.steps[s.stepIndex];
      if (event.mounted && targetChain(step).includes(event.id as TargetId)) next = { ...next, targetMissing: false };
      if (!event.mounted) return next;
      const hit = findCompletion(def, s.stepIndex, u => 'mounted' in u && u.mounted === event.id, true);
      if (hit) return completeRun(next, def, hit.from, hit.to, 'signal', now);
      return next;
    }

    case 'TARGET_TIMEOUT':
      return s.phase === 'step' ? { ...s, targetMissing: true } : s;

    case 'STUCK': {
      if (s.phase !== 'step') return s;
      const step = def.steps[s.stepIndex];
      return step && step.kind !== 'look' ? { ...s, stuck: true } : s;
    }

    case 'SIGNAL': {
      if (s.phase !== 'step') return s;
      // Rule (a)'s one exception: an OFFROUTE pause does not drop a sandbox
      // signal (see the header). Any other pause does.
      if (s.paused && s.paused.reason !== 'offroute') return s;
      if (event.payload.projectId !== expectedProjectId(s, def)) return s;
      const step = def.steps[s.stepIndex];
      if (step?.failOn === event.name) {
        const reason = (event.payload as { reason?: unknown }).reason;
        return { ...s, failure: { stepId: step.id, signal: event.name, reason: typeof reason === 'string' ? reason : '', at: now } };
      }
      const name: SignalName = event.name;
      const hit = findCompletion(def, s.stepIndex, u => 'signal' in u && u.signal === name, true);
      if (!hit) {
        // A LOOK step that reads the signal that just completed the step
        // before it ("$63,360 due" reads invoice.amount.set) must quote what
        // the screen shows NOW. The amount signal is debounced, so a pause
        // between '1' and '5' completed the step on '1' and the look quoted
        // $4,224 over a 15 % invoice. A repeat of that one signal refreshes
        // its payload — copy only: it never advances, never re-stamps, and
        // its timing (signalAt, the measured stat) stays the first one.
        const prev = def.steps[s.stepIndex - 1];
        if (step?.kind === 'look' && prev?.until && 'signal' in prev.until && prev.until.signal === name) {
          return { ...s, payloads: { ...s.payloads, [name]: event.payload } };
        }
        return s;
      }
      const recorded: RunningState = {
        ...s,
        payloads: { ...s.payloads, [name]: event.payload },
        signalAt: { ...s.signalAt, [name]: now },
        // The offroute pause belonged to the step just completed; the next
        // step re-derives its own against the route (fresh `at`), and a
        // celebration always plays.
        paused: false,
      };
      return completeRun(recorded, def, hit.from, hit.to, 'signal', now);
    }

    case 'NEXT': {
      if (s.phase !== 'step' || s.paused) return s;
      const step = def.steps[s.stepIndex];
      if (!step || step.kind !== 'look') return s;
      const log = [...s.log, { stepId: step.id, stepIndex: s.stepIndex, via: 'next' as const, ms: now - s.stepEnteredAt, at: now }];
      return enterStep({ ...s, log }, def, s.stepIndex + 1, now);
    }

    case 'SKIP_STEP': {
      if (s.phase !== 'step') return s;
      const step = def.steps[s.stepIndex];
      if (!step) return s;
      // Skip the whole block of contiguous steps that wait on the SAME
      // completion, exactly as a signal completes them together. Skipping
      // 'Send to me' must not land on the invisible wait-for-the-sheet step,
      // which draws nothing and would strand him in a live, coach-less run.
      const key = untilKey(step.until);
      let end = s.stepIndex;
      while (key !== null && end + 1 < def.steps.length && untilKey(def.steps[end + 1].until) === key) end += 1;
      const skipped = [...s.skipped];
      const log = [...s.log];
      for (let k = s.stepIndex; k <= end; k += 1) {
        skipped.push(def.steps[k].id);
        log.push({ stepId: def.steps[k].id, stepIndex: k, via: 'skip_step', ms: k === s.stepIndex ? now - s.stepEnteredAt : 0, at: now });
      }
      const cleared: RunningState = {
        ...s,
        skipped,
        log,
        // A skip is a deliberate act on the card, so an offroute pause is
        // re-derived for the next step rather than carried over.
        paused: s.paused && s.paused.reason === 'offroute' ? false : s.paused,
      };
      return enterStep(cleared, def, end + 1, now);
    }

    case 'ASSIST': {
      if (s.phase !== 'step') return s;
      const step = def.steps[s.stepIndex];
      if (!step || step.assist !== event.assistId) return s;
      return { ...s, assists: [...s.assists, { stepId: step.id, assistId: event.assistId as AssistId, at: now }] };
    }

    case 'CELEBRATION_DONE':
      if (s.phase !== 'celebrate') return s;
      return enterStep({ ...s, celebrate: undefined }, def, s.stepIndex + 1, now);

    case 'FINISH':
      if (s.phase !== 'finale') return s;
      return finish(s, 'completed', undefined, now, def);

    case 'PAUSE':
      if (s.phase === 'finale') return s;
      return { ...s, paused: { reason: event.reason, at: now } };

    case 'RESUME': {
      if (!s.paused) return s;
      const fresh = s.paused.reason !== 'offroute';
      const step = def.steps[s.stepIndex];
      // A restored run lost its clock with the old session; start it again at
      // the user's Resume so the finale's stat is still a MEASURED time (from
      // here), never one stitched across a relaunch.
      const firstActionAt = s.firstActionAt ?? (step?.kind === 'do' && s.phase === 'step' ? now : undefined);
      const unpaused: RunningState = { ...s, paused: false, stepEnteredAt: fresh ? now : s.stepEnteredAt, stuck: false, firstActionAt };
      // Settle, not just re-pause: routes seen while backgrounded were only
      // recorded, and the one he came back on may already be the next goal.
      return settleOnRoute(unpaused, def, now);
    }

    case 'EXIT':
      // The finale is only reached past the last step, and tutorial_completed
      // has already fired there: closing it with the X (or signing out on it)
      // is not abandoning the tutorial, so it records 'completed' like Done.
      if (s.phase === 'finale') return finish(s, 'completed', undefined, now, def);
      return finish(s, 'exited', event.reason, now, def);

    default:
      return s;
  }
}

function finish(s: RunningState, outcome: 'completed' | 'exited', reason: ExitReason | undefined, now: number, def: TutorialDef): RunState {
  const step = def.steps[s.stepIndex];
  return {
    status: 'finished',
    tutorialId: s.tutorialId,
    outcome,
    ...(reason ? { reason } : {}),
    atStepId: s.phase === 'finale' ? 'finale' : step?.id ?? null,
    endedAt: now,
    sandboxProjectId: s.sandboxProjectId,
    startedAt: s.startedAt,
  };
}

// ── Checkpoints and persistence ─────────────────────────────────────────────

export function checkpointIndexAtOrBefore(def: TutorialDef, index: number): number {
  const top = Math.min(Math.max(index, 0), def.steps.length - 1);
  for (let i = top; i >= 0; i -= 1) if (def.steps[i].checkpoint) return i;
  return 0;
}

/** The `active` slot to persist for a running state, or null when there is
 *  nothing worth resuming (boot, finale). Always a checkpoint index. */
export function toSavedActive(state: RunState, defs: TutorialDefs, now: number): SavedActiveRun | null {
  if (state.status !== 'running' || state.phase === 'boot' || state.phase === 'finale') return null;
  const def = defs[state.tutorialId];
  if (!def) return null;
  return {
    tutorialId: state.tutorialId,
    version: state.version,
    stepIndex: checkpointIndexAtOrBefore(def, state.stepIndex),
    sandboxProjectId: state.sandboxProjectId,
    entry: state.entry,
    returnTo: state.returnTo ?? null,
    savedAt: now,
  };
}

/** The host polls this; a non-null answer means dispatch EXIT with it. A
 *  restored pause never times out: it is a saved run the hub offers as
 *  'Continue', not a live one. */
export function autoExitReason(state: RunState, now: number): ExitReason | null {
  if (state.status !== 'running' || !state.paused) return null;
  const age = now - state.paused.at;
  if (state.paused.reason === 'offroute' && age >= OFFROUTE_EXIT_MS) return 'offroute_timeout';
  if (state.paused.reason === 'background' && age >= BACKGROUND_EXIT_MS) return 'background';
  return null;
}

// ── Coach view ──────────────────────────────────────────────────────────────

/** The layer drawn on top among the mounted ones (a modal layer beats root). */
export function topLayer(mounted: readonly LayerId[]): LayerId {
  let best: LayerId = 'root';
  for (const l of LAYER_ORDER) if (mounted.includes(l)) best = l;
  return best;
}

/** Where a rect sits relative to the usable area: its centre must be inside
 *  (the hole is clamped anyway), otherwise the card says which way to scroll. */
function offscreenDirection(rect: { y: number; h: number }, viewportH: number, keyboardH: number): 'up' | 'down' | null {
  const cy = rect.y + rect.h / 2;
  const bottom = viewportH - Math.max(0, keyboardH);
  if (cy < 0) return 'up';
  if (cy > bottom) return 'down';
  return null;
}

export function coachView(state: RunState, env: CoachEnv, defs: TutorialDefs): CoachView {
  if (state.status !== 'running') return { kind: 'hidden' };
  const def = defs[state.tutorialId];
  if (!def) return { kind: 'hidden' };
  if (state.phase === 'boot') return { kind: 'hidden' };
  // A layer-less modal is up (a blocker sentinel is mounted — registry
  // BLOCKER_TARGETS): on iOS it draws ABOVE the root layer, so the coach
  // draws NOTHING — no dim, ring, hand or card behind a sheet he is using,
  // and no card he could not reach. Everything but the stamp: a celebration
  // starts from a save pressed on the screen itself (the send sheet closes
  // before the send runs), and hiding it would swallow the success moment.
  // Nothing advances or strands here: completions still count, and closing
  // the modal unmounts the sentinel and brings the view straight back.
  if (state.phase !== 'celebrate' && state.mounted.some(isBlockerTarget)) return { kind: 'hidden' };
  if (state.phase === 'finale') return { kind: 'finale' };
  const step = def.steps[state.stepIndex];
  if (!step) return { kind: 'hidden' };
  if (state.phase === 'celebrate') return { kind: 'celebrate', layer: topLayer(env.mountedLayers), stepId: step.id };
  if (state.paused) {
    const pid = expectedProjectId(state, def);
    const onSample = !!state.route && !!pid && (firstParam(state.route.params.projectId) === pid || firstParam(state.route.params.id) === pid);
    return { kind: 'paused', reason: state.paused.reason, onSample };
  }
  const layer: LayerId = step.layer ?? 'root';
  if (state.failure) return { kind: 'card', reason: 'failed', layer: topLayer(env.mountedLayers), stepId: step.id };
  if (step.kind === 'wait') return { kind: 'hidden' };
  // A modal layer other than the step's own is up: nothing draws, so no dim
  // ever appears under (or over) a modal the step doesn't own.
  if (env.mountedLayers.some(l => l !== 'root' && l !== layer)) return { kind: 'hidden' };
  if (layer !== 'root' && !env.mountedLayers.includes(layer)) {
    return state.targetMissing ? { kind: 'card', reason: 'missing', layer: 'root', stepId: step.id } : { kind: 'hidden' };
  }
  if (env.screenReader) return { kind: 'card', reason: 'screenreader', layer, stepId: step.id };
  const chain = targetChain(step);
  if (chain.length === 0) return { kind: 'card', reason: 'untargeted', layer, stepId: step.id };
  let targetId: string | null = null;
  let rect = null as CoachEnv['rects'][string] | null;
  for (const id of chain) {
    const r = env.rects[id];
    if (r && r.w > 0 && r.h > 0) { targetId = id; rect = r; break; }
  }
  if (!targetId || !rect) {
    return state.targetMissing ? { kind: 'card', reason: 'missing', layer, stepId: step.id } : { kind: 'hidden' };
  }
  const dir = offscreenDirection(rect, env.viewport.h, env.keyboardH);
  if (dir) return { kind: 'card', reason: 'offscreen', layer, stepId: step.id, scroll: dir, targetId };
  return { kind: 'spotlight', layer, stepId: step.id, targetId, rect };
}

/** What the card offers. Skip only after STUCK / TARGET_TIMEOUT (or at once
 *  with a screen reader); 'Do it for me' only when the step has an assist and
 *  the user is stuck or on a screen reader; Next only on look steps. */
export function cardAffordances(state: RunState, defs: TutorialDefs, opts: { screenReader: boolean }): {
  next: boolean;
  skip: boolean;
  assist: AssistId | null;
  stepNumber: number;
  stepCount: number;
} {
  const step = currentStep(state, defs);
  const def = defFor(state, defs);
  if (!step || !def || state.status !== 'running' || state.phase !== 'step') {
    return { next: false, skip: false, assist: null, stepNumber: 0, stepCount: def?.steps.length ?? 0 };
  }
  const late = state.stuck || state.targetMissing || opts.screenReader;
  return {
    next: step.kind === 'look',
    skip: late,
    assist: step.assist && (state.stuck || opts.screenReader) ? step.assist : null,
    stepNumber: state.stepIndex + 1,
    stepCount: def.steps.length,
  };
}

// ── Copy ────────────────────────────────────────────────────────────────────

/** 'Tap' on touch devices, 'Click' with a fine pointer (web mouse). */
export function verb(pointerFine: boolean): 'Tap' | 'Click' {
  return pointerFine ? 'Click' : 'Tap';
}

/** Resolve {Tap}/{tap}. A copy string never hard-codes the verb, so web gets
 *  'Click' wording without a second copy deck. */
export function fillCopy(template: string, pointerFine: boolean): string {
  const v = verb(pointerFine);
  return template.replace(/\{Tap\}/g, v).replace(/\{tap\}/g, v.toLowerCase());
}

export function resolveCopy(copy: Copy | undefined, ctx: CopyCtx): string {
  if (copy === undefined) return '';
  const raw = typeof copy === 'function' ? copy(ctx) : copy;
  return fillCopy(raw, ctx.pointerFine);
}

/** The card's instruction and detail for a step, honouring textWeb and the
 *  override for a fallback target. */
export function stepCopy(step: TutorialStep, ctx: CopyCtx, usedTargetId?: string | null): { text: string; detail: string } {
  let text: Copy = step.text;
  if (ctx.web && step.textWeb !== undefined) text = step.textWeb;
  const chain = targetChain(step);
  if (usedTargetId && chain[0] !== usedTargetId && step.textByTarget) {
    const o = step.textByTarget[usedTargetId as TargetId];
    if (o !== undefined) text = o;
  }
  return { text: resolveCopy(text, ctx), detail: resolveCopy(step.detail, ctx) };
}

export const OFFLINE_SUCCESS_SUB = "Saved on this phone — syncs when you're back online";

/** The stamp's title and subline. Offline, the local save IS the success,
 *  and the subline says so instead of implying it reached the server. */
export function successCopy(step: TutorialStep, ctx: CopyCtx): { title: string; sub: string } | null {
  if (!step.success) return null;
  const title = resolveCopy(step.success.title, ctx);
  const sub = ctx.offline ? OFFLINE_SUCCESS_SUB : resolveCopy(step.success.sub, ctx);
  return { title, sub };
}

/** Typed helper for callers that build a SIGNAL event. */
export function signalEvent<N extends SignalName>(name: N, payload: SignalPayload<N>, now: number): TutorialEvent {
  return { type: 'SIGNAL', name, payload, now } as TutorialEvent;
}

/**
 * Where the paused pill's Resume must TAKE him, or null when RESUME alone is
 * enough (he is already on the step's screen). RESUME never navigates, and an
 * offroute pause is re-derived from the route, so without this a pause on a
 * step whose screen he left — e.g. SKIP_STEP from 'Send to me' lands on the
 * hub result step while he is still on /invoice — could never be resumed from
 * the pill. The host pushes this (dismissTo when it is the stacked hub), then
 * dispatches RESUME; the ROUTE that lands settles the pause.
 * On the def's start screen the start params are reused (type=progress, the
 * report day), so a resumed checkpoint opens exactly what START opened.
 */
export function resumeTarget(
  state: RunState,
  defs: TutorialDefs,
  startCtx: StartCtx,
): { pathname: TutorialPathname; params: Record<string, string> } | null {
  if (state.status !== 'running' || state.phase !== 'step' || !state.paused) return null;
  const def = defs[state.tutorialId];
  if (!def) return null;
  const step = def.steps[state.stepIndex];
  const pid = expectedProjectId(state, def);
  if (!step || !pid) return null;
  if (routeMatches(state.route, step.route, pid)) return null;
  const params =
    step.route.pathname === def.start.pathname
      ? { ...def.start.params(pid, startCtx), [step.route.projectParam]: pid }
      : { [step.route.projectParam]: pid };
  return { pathname: step.route.pathname, params };
}

/** Re-export for hosts that want to label the pause. */
export type { PauseReason };
