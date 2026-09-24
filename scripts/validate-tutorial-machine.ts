// validate-tutorial-machine.ts — table tests for the tutorial step machine and
// the pure rules around it (practice pass, stats, handoff, offers, sandbox).
//
// WHAT IT PINS (spec §3, §11, §12). The machine is the only thing standing
// between "the user did the real thing" and "the coach moved on", so every
// rule a user can feel is exercised here against the REAL wave-A defs:
//   • a signal from any project but the sandbox is ignored;
//   • the current step, or skip-ahead to a later one, completes on the real
//     signal — never on a tap on the coach; NEXT moves look steps only;
//   • success → celebrate → CELEBRATION_DONE → next;
//   • skipIf auto-skips (no sample plan → no pin steps); SKIP_STEP always works;
//   • leaving the step's route pauses, returning resumes; a background or
//     restored pause is only lifted by RESUME (nothing auto-resumes);
//   • RESTORE refuses a stale version, a save over 24 h old or a missing
//     sample, and restores PAUSED at a checkpoint;
//   • the practice pass opens exactly: the sandbox + a listed feature + a live
//     run (or 1.5 s of grace) — nothing else.
//
// Run: bun run scripts/validate-tutorial-machine.ts

import {
  IDLE,
  autoExitReason,
  cardAffordances,
  checkpointIndexAtOrBefore,
  coachView,
  currentStep,
  fillCopy,
  reduceTutorial,
  resumeTarget,
  stepCopy,
  successCopy,
  toSavedActive,
  OFFROUTE_EXIT_MS,
  BACKGROUND_EXIT_MS,
  RESTORE_MAX_AGE_MS,
  OFFLINE_SUCCESS_SUB,
} from '../utils/tutorial/machine';
import { TUTORIAL_DEFS } from '../utils/tutorial/defs';
import { practiceAllows, practiceFeatures, PRACTICE_GRACE_MS, TUTORIAL_PRACTICE_PASS } from '../utils/tutorial/practicePass';
import { formatDuration, statLine } from '../utils/tutorial/stats';
import { handoffFor } from '../utils/tutorial/handoff';
import { shouldOfferChip, tutorialsForUser, tutorialCardStatus, EMPTY_PROGRESS } from '../utils/tutorial/offers';
import { isFieldOnlyUser, newestRealProject, pickSandboxProject, sandboxStillValid, tutorialReportDay } from '../utils/tutorial/sandboxCore';
import { getActiveTutorialId, setActiveTutorialId } from '../utils/tutorial/activeRun';
import type {
  CoachEnv,
  CopyCtx,
  RunState,
  RunningState,
  SignalName,
  SignalPayload,
  TutorialEvent,
  TutorialId,
  TutorialProgress,
} from '../utils/tutorial/types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const SB = 'sample-1';
const OTHER = 'real-9';
const defs = TUTORIAL_DEFS;
const T0 = 1_000_000;

function run(state: RunState, ...events: TutorialEvent[]): RunState {
  return events.reduce((s, e) => reduceTutorial(s, e, defs), state);
}
function R(s: RunState): RunningState {
  if (s.status !== 'running') throw new Error(`expected running, got ${s.status}`);
  return s;
}
function sig<N extends SignalName>(name: N, payload: Omit<SignalPayload<N>, 'projectId'> & { projectId?: string }, now: number): TutorialEvent {
  return { type: 'SIGNAL', name, payload: { projectId: SB, ...payload } as SignalPayload<N>, now } as TutorialEvent;
}
const route = (pathname: string, params: Record<string, string>, now: number): TutorialEvent => ({ type: 'ROUTE', pathname, params, now });
const DFR_ROUTE = route('/daily-report', { projectId: SB }, T0 + 5);
const WALK_ROUTE = route('/punch-walk', { projectId: SB }, T0 + 5);
const INV_ROUTE = route('/invoice', { projectId: SB, type: 'progress' }, T0 + 5);
const HUB_ROUTE = (now: number) => route('/project-detail', { id: SB }, now);

function start(id: TutorialId, flags = { samplePlan: true, mic: true }, r: TutorialEvent = DFR_ROUTE): RunState {
  return run(
    IDLE,
    { type: 'START', tutorialId: id, sandboxProjectId: SB, entry: 'hub', now: T0 },
    r,
    { type: 'BOOTED', flags, now: T0 + 10 },
  );
}
const stepId = (s: RunState) => currentStep(s, defs)?.id ?? null;
const pauseReason = (s: RunState) => { const p = R(s).paused; return p ? p.reason : false; };

// ── start / boot ────────────────────────────────────────────────────────────
console.log('start and boot');
{
  const booting = run(IDLE, { type: 'START', tutorialId: 'daily-report-voice', sandboxProjectId: SB, entry: 'onboarding', now: T0 });
  eq('START → running/boot', [booting.status, R(booting).phase], ['running', 'boot']);
  const s = start('daily-report-voice');
  eq('BOOTED → step 0 (dfr-voice)', [R(s).phase, stepId(s)], ['step', 'dfr-voice']);
  eq('first do step starts the clock', R(s).firstActionAt, T0 + 10);
  eq('on-route → not paused', R(s).paused, false);
  const again = reduceTutorial(s, { type: 'START', tutorialId: 'punch-walk', sandboxProjectId: SB, entry: 'hub', now: T0 + 20 }, defs);
  ok('START while running is ignored (double tap is not a replay)', again === s);
  const unknown = reduceTutorial(IDLE, { type: 'START', tutorialId: 'first-bid-coach', sandboxProjectId: SB, entry: 'hub', now: T0 }, defs);
  ok('START of a tutorial this build does not ship stays idle', unknown === IDLE);
  const offroute = run(IDLE, { type: 'START', tutorialId: 'daily-report-voice', sandboxProjectId: SB, entry: 'hub', now: T0 }, route('/', {}, T0 + 1), { type: 'BOOTED', flags: { samplePlan: true, mic: true }, now: T0 + 2 });
  eq('BOOTED before the push lands → paused offroute', R(offroute).paused, { reason: 'offroute', at: T0 + 2 });
  const landed = reduceTutorial(offroute, route('/daily-report', { projectId: SB }, T0 + 3), defs);
  eq('…and the route arriving resumes it', R(landed).paused, false);
}

// ── rule a: foreign project / idle / paused signals are ignored ─────────────
console.log('signals only count on the sandbox');
{
  const s = start('daily-report-voice');
  const foreign = reduceTutorial(s, sig('dfr.voice.applied', { fields: ['manpower'], source: 'mic', projectId: OTHER }, T0 + 50), defs);
  ok('a real job\'s signal is ignored (same state object)', foreign === s);
  const idle = reduceTutorial(IDLE, sig('dfr.saved', { reportId: 'r', status: 'draft' }, T0), defs);
  ok('a signal while idle is a no-op', idle === IDLE);
  const bg = reduceTutorial(s, { type: 'PAUSE', reason: 'background', now: T0 + 60 }, defs);
  const whileBg = reduceTutorial(bg, sig('dfr.voice.applied', { fields: ['a'], source: 'sample' }, T0 + 70), defs);
  ok('a signal while paused for background is ignored', whileBg === bg);
  const off = reduceTutorial(s, route('/', {}, T0 + 60), defs);
  const offForeign = reduceTutorial(off, sig('dfr.voice.applied', { fields: ['a'], source: 'mic', projectId: OTHER }, T0 + 70), defs);
  ok('offroute: a real job\'s signal is still ignored', offForeign === off);
}

// Review round 2: a save handler may navigate BEFORE its signal lands
// (goBack() then the signal). The offroute pause must not drop the sandbox
// signal, or the run sits paused on a save he really made.
console.log('rule a exception: a sandbox signal counts under an offroute pause');
{
  let s = start('daily-report-voice');
  s = run(s, sig('dfr.voice.applied', { fields: ['a'], source: 'sample' }, T0 + 100), { type: 'NEXT', now: T0 + 200 });
  eq('on the save step', stepId(s), 'dfr-save');
  s = reduceTutorial(s, HUB_ROUTE(T0 + 300), defs);
  eq('goBack() lands first → paused offroute on the save step', [stepId(s), pauseReason(s)], ['dfr-save', 'offroute']);
  s = reduceTutorial(s, sig('dfr.saved', { reportId: 'r1', status: 'draft' }, T0 + 320), defs);
  eq('…then dfr.saved still completes it → celebrate, unpaused', [R(s).phase, R(s).celebrate?.stepId, R(s).paused], ['celebrate', 'dfr-save', false]);
  s = reduceTutorial(s, { type: 'CELEBRATION_DONE', now: T0 + 1720 }, defs);
  eq('…and CELEBRATION_DONE lands on the hub result, unpaused', [stepId(s), R(s).paused], ['dfr-result', false]);

  // No success stamp on the completed step: the next step re-derives its
  // own pause (fresh `at`) against the route he is on.
  let w = start('punch-walk', { samplePlan: false, mic: true }, WALK_ROUTE);
  w = run(w, sig('punch.photo.added', { source: 'sample' }, T0 + 100), route('/', {}, T0 + 150));
  eq('walk: photo taken then left for Home → paused on the description step', [stepId(w), pauseReason(w)], ['punch-describe', 'offroute']);
  w = reduceTutorial(w, sig('punch.description.filled', { chars: 30 }, T0 + 400), defs);
  eq('…a late description signal completes it; the save step re-pauses offroute at now', [stepId(w), R(w).paused], ['punch-save', { reason: 'offroute', at: T0 + 400 }]);
}

// ── rule b/c/d: completion, skip-ahead, NEXT, celebrate ─────────────────────
console.log('completion, skip-ahead, NEXT, celebrate');
{
  let s = start('daily-report-voice');
  const nextOnDo = reduceTutorial(s, { type: 'NEXT', now: T0 + 20 }, defs);
  ok('NEXT on a do step is ignored — only the real action advances it', nextOnDo === s);
  s = reduceTutorial(s, sig('dfr.voice.applied', { fields: ['manpower', 'workPerformed', 'issuesAndDelays'], source: 'sample' }, T0 + 1000), defs);
  eq('dfr.voice.applied completes step 0 → look step', stepId(s), 'dfr-preview');
  eq('log records via signal and time on step', R(s).log[0], { stepId: 'dfr-voice', stepIndex: 0, via: 'signal', ms: 990, at: T0 + 1000 });
  const dup = reduceTutorial(s, sig('dfr.voice.applied', { fields: ['x'], source: 'sample' }, T0 + 1100), defs);
  // Idempotent for PROGRESS: it never advances, re-logs or re-times. The one
  // thing it may do is refresh the payload the look step right after it
  // quotes (so "$X due" is the amount on screen now, not the first digit).
  ok('the same signal again never advances, re-logs or re-times (idempotent)',
    stepId(dup) === stepId(s) && R(dup).phase === R(s).phase && R(dup).log === R(s).log && R(dup).signalAt === R(s).signalAt && R(dup).stepIndex === R(s).stepIndex);
  eq('…it only refreshes the payload the look step quotes', (R(dup).payloads['dfr.voice.applied'] as { fields: string[] }).fields, ['x']);
  const later = reduceTutorial(s, { type: 'NEXT', now: T0 + 1200 }, defs);
  const twoOn = reduceTutorial(later, sig('dfr.voice.applied', { fields: ['y'], source: 'sample' }, T0 + 1300), defs);
  ok('…and only while that look step is current (two steps on, it is ignored outright)', twoOn === later);
  // The integration-review case: '1', a pause past the debounce, then '15'.
  let inv = run(start('invoice-to-self', undefined, INV_ROUTE), sig('invoice.amount.set', { total: 4224 }, T0 + 100));
  inv = reduceTutorial(inv, sig('invoice.amount.set', { total: 63360 }, T0 + 900), defs);
  const totalsStep = defs['invoice-to-self']!.steps[R(inv).stepIndex]!;
  const photoStep = defs['punch-walk']!.steps.find(x => x.id === 'punch-photo')!;
  eq('punch: with no sample plan the camera step says the pin is skipped',
    stepCopy(photoStep, { pointerFine: false, web: false, freeTier: true, payloads: {}, samplePlan: false }).detail,
    "The sample plan didn't load — we'll skip the pin.");
  eq('…and the normal detail when the plan loaded', stepCopy(photoStep, { pointerFine: false, web: false, freeTier: true, payloads: {}, samplePlan: true }).detail,
    'The sample photo skips the camera prompt.');
  eq('invoice: a later amount refreshes the totals look copy (not the first digit)',
    [totalsStep.id, stepCopy(totalsStep, { pointerFine: false, web: false, freeTier: true, payloads: R(inv).payloads }).text],
    ['invoice-totals', '$63,360 due — tax and terms come from the job.']);
  s = reduceTutorial(s, { type: 'NEXT', now: T0 + 3000 }, defs);
  eq('NEXT on the look step advances', stepId(s), 'dfr-save');
  s = reduceTutorial(s, sig('dfr.saved', { reportId: 'r1', status: 'draft', crew: 3 }, T0 + 9000), defs);
  eq('success step → celebrate', [R(s).phase, R(s).celebrate?.stepId], ['celebrate', 'dfr-save']);
  const late = reduceTutorial(s, sig('dfr.saved', { reportId: 'r2', status: 'draft' }, T0 + 9100), defs);
  ok('signals during the celebration are ignored', late === s);
  s = reduceTutorial(s, { type: 'CELEBRATION_DONE', now: T0 + 10_400 }, defs);
  eq('CELEBRATION_DONE → the result look step', [R(s).phase, stepId(s)], ['step', 'dfr-result']);
  eq('…which pauses until the screen lands on the hub', pauseReason(s), 'offroute');
  s = reduceTutorial(s, HUB_ROUTE(T0 + 10_600), defs);
  eq('landing on the sample hub resumes', R(s).paused, false);
  s = reduceTutorial(s, { type: 'NEXT', now: T0 + 12_000 }, defs);
  eq('past the last step → finale', R(s).phase, 'finale');
  const card = successCopy(defs['daily-report-voice']!.steps[2], { pointerFine: false, web: false, freeTier: true, payloads: R(s).payloads, reportDayLabel: 'Tue Sep 23' });
  eq('stamp subline is built from the real payloads', card?.sub, 'Tue Sep 23 · 3 crew · 3 sections from one note');
  eq('stat line is measured: first action → dfr.saved', statLine(defs['daily-report-voice']!, R(s)), 'Report filed in 9 s · 3 sections from one note');
  const fin = reduceTutorial(s, { type: 'FINISH', now: T0 + 13_000 }, defs);
  eq('FINISH → finished/completed', fin.status === 'finished' ? [fin.outcome, fin.atStepId] : null, ['completed', 'finale']);
  const closedX = reduceTutorial(s, { type: 'EXIT', reason: 'skip', now: T0 + 13_000 }, defs);
  eq('EXIT from the finale (the X) is a completion, not an abandonment', closedX.status === 'finished' ? [closedX.outcome, closedX.atStepId, 'reason' in closedX] : null, ['completed', 'finale', false]);
}
{
  let s = start('daily-report-voice');
  s = reduceTutorial(s, sig('dfr.saved', { reportId: 'r1', status: 'draft' }, T0 + 4000), defs);
  eq('skip-ahead: Save Draft first jumps to the save step and celebrates', [R(s).phase, R(s).celebrate?.stepId], ['celebrate', 'dfr-save']);
  eq('…recording the jumped steps', R(s).skipped, ['dfr-voice', 'dfr-preview']);
  eq('…and via skip_ahead', R(s).log.at(-1)?.via, 'skip_ahead');
  eq('stat has no invented extras when the voice step was skipped', statLine(defs['daily-report-voice']!, R(s)), 'Report filed in 4 s');
}
{
  // An earlier step's signal after moving on is ignored.
  let s = start('daily-report-voice');
  s = run(s, sig('dfr.voice.applied', { fields: ['a'], source: 'sample' }, T0 + 100), { type: 'NEXT', now: T0 + 200 });
  const before = s;
  s = reduceTutorial(s, sig('dfr.voice.applied', { fields: ['b'], source: 'mic' }, T0 + 300), defs);
  ok('an EARLIER step\'s signal is ignored', s === before);
}

// ── rule f: skipIf + SKIP_STEP ──────────────────────────────────────────────
console.log('skipIf and SKIP_STEP');
{
  let s = start('punch-walk', { samplePlan: false, mic: true }, WALK_ROUTE);
  s = reduceTutorial(s, sig('punch.photo.added', { source: 'sample' }, T0 + 500), defs);
  eq('no sample plan → both pin steps auto-skip to describe', stepId(s), 'punch-describe');
  eq('…and are recorded as skipped', R(s).skipped, ['punch-pin', 'punch-pin-next']);
  const skipped = reduceTutorial(s, { type: 'SKIP_STEP', now: T0 + 600 }, defs);
  eq('SKIP_STEP moves on from a do step', [stepId(skipped), R(skipped).log.at(-1)?.via], ['punch-save', 'skip_step']);
}
{
  let s = start('punch-walk', { samplePlan: true, mic: true }, WALK_ROUTE);
  s = reduceTutorial(s, sig('punch.photo.added', { source: 'camera' }, T0 + 500), defs);
  eq('with the plan → the pin step', stepId(s), 'punch-pin');
  const tm = reduceTutorial(s, { type: 'TARGET', id: 'punch.pinMarker', mounted: true, now: T0 + 900 }, defs);
  eq('{mounted: punch.pinMarker} completes the drop-pin step', stepId(tm), 'punch-pin-next');
  const skip = reduceTutorial(s, sig('punch.pin.decided', { pinned: false }, T0 + 900), defs);
  eq('Skip in the pin sheet (pin.decided) skips ahead past the drop', [stepId(skip), R(skip).skipped], ['punch-describe', ['punch-pin']]);
  // Marker already mounted when the step is entered → completes on entry.
  let pre = start('punch-walk', { samplePlan: true, mic: true }, WALK_ROUTE);
  pre = reduceTutorial(pre, { type: 'TARGET', id: 'punch.pinMarker', mounted: true, now: T0 + 400 }, defs);
  eq('a marker mounted early is a skip-ahead, not a stall', stepId(pre), 'punch-pin-next');
}

// ── route completions and pause ─────────────────────────────────────────────
console.log('routes: completion, pause and resume');
{
  let s = start('punch-walk', { samplePlan: true, mic: true }, WALK_ROUTE);
  const earlyHub = reduceTutorial(s, HUB_ROUTE(T0 + 300), defs);
  eq('leaving the walk before saving PAUSES — route goals never skip ahead', [stepId(earlyHub), pauseReason(earlyHub)], ['punch-photo', 'offroute']);
  const back = reduceTutorial(earlyHub, route('/punch-walk', { projectId: SB }, T0 + 400), defs);
  eq('…and coming back resumes on the same step', [stepId(back), R(back).paused], ['punch-photo', false]);
  const otherJob = reduceTutorial(s, route('/punch-walk', { projectId: OTHER }, T0 + 300), defs);
  eq('the same screen on a REAL job pauses too', pauseReason(otherJob), 'offroute');
  s = run(
    s,
    sig('punch.photo.added', { source: 'sample' }, T0 + 1000),
    { type: 'TARGET', id: 'punch.pinMarker', mounted: true, now: T0 + 2000 },
    sig('punch.pin.decided', { pinned: true }, T0 + 3000),
    sig('punch.description.filled', {}, T0 + 4000),
    sig('punch.saved', { itemId: 'p1', location: 'Kitchen', trade: 'Electrical', pinned: true, sheet: 'A-101' }, T0 + 43_000),
    { type: 'CELEBRATION_DONE', now: T0 + 44_400 },
    { type: 'NEXT', now: T0 + 46_000 },
  );
  eq('after the session look → the back step', stepId(s), 'punch-back');
  const bg = run(s, { type: 'PAUSE', reason: 'background', now: T0 + 47_000 }, HUB_ROUTE(T0 + 47_500));
  eq('a route goal does not complete while paused for another reason', [stepId(bg), pauseReason(bg)], ['punch-back', 'background']);
  s = reduceTutorial(s, HUB_ROUTE(T0 + 48_000), defs);
  eq('{route: hub} completes the back step → the result look step, unpaused', [stepId(s), R(s).paused], ['punch-result', false]);
  const def = defs['punch-walk']!;
  eq('punch stat line', statLine(def, R(s)), '1 item in 43 s · photo, pin and trade');
  const sub = successCopy(def.steps[4], { pointerFine: false, web: false, freeTier: true, payloads: R(s).payloads });
  eq('punch stamp subline', sub?.sub, 'Kitchen · Electrical · pinned on A-101');
  const offline = successCopy(def.steps[4], { pointerFine: false, web: false, freeTier: true, payloads: R(s).payloads, offline: true });
  eq('offline: the local save is the success, and the subline says so', offline?.sub, OFFLINE_SUCCESS_SUB);
}
// Back to the job at the natural "I'm done" moment (review round 1): a route
// goal may skip ahead across LOOK steps only, never across a do step.
{
  const saved = run(
    start('punch-walk', { samplePlan: false, mic: true }, WALK_ROUTE),
    sig('punch.photo.added', { source: 'sample' }, T0 + 1000),
    sig('punch.description.filled', {}, T0 + 2000),
    sig('punch.saved', { itemId: 'p1', location: 'Kitchen', trade: 'Electrical', pinned: false }, T0 + 30_000),
  );
  eq('(setup) the save celebrates', [R(saved).phase, R(saved).celebrate?.stepId], ['celebrate', 'punch-save']);
  const onSession = reduceTutorial(saved, { type: 'CELEBRATION_DONE', now: T0 + 31_400 }, defs);
  eq('(setup) then the session look step', stepId(onSession), 'punch-session');
  const backFromSession = reduceTutorial(onSession, HUB_ROUTE(T0 + 32_000), defs);
  eq('back from the session look → the result look step, unpaused', [stepId(backFromSession), R(backFromSession).paused], ['punch-result', false]);
  eq('…the look it walked past is recorded, the back step completed', [R(backFromSession).skipped, R(backFromSession).log.at(-1)?.stepId], [['punch-pin', 'punch-pin-next', 'punch-session'], 'punch-back']);
  const duringStamp = reduceTutorial(saved, HUB_ROUTE(T0 + 30_500), defs);
  eq('back DURING the stamp just records the route (the stamp keeps playing)', [R(duringStamp).phase, R(duringStamp).paused], ['celebrate', false]);
  const afterStamp = reduceTutorial(duringStamp, { type: 'CELEBRATION_DONE', now: T0 + 31_400 }, defs);
  eq('…and CELEBRATION_DONE lands on the result, unpaused', [stepId(afterStamp), R(afterStamp).paused], ['punch-result', false]);
  const bgOnSession = run(onSession, { type: 'PAUSE', reason: 'background', now: T0 + 32_000 }, HUB_ROUTE(T0 + 33_000));
  eq('backgrounded on the session look, back on the hub: still paused', [stepId(bgOnSession), pauseReason(bgOnSession)], ['punch-session', 'background']);
  const resumed = reduceTutorial(bgOnSession, { type: 'RESUME', now: T0 + 40_000 }, defs);
  eq('…RESUME settles on the route he is on → the result, unpaused', [stepId(resumed), R(resumed).paused], ['punch-result', false]);
  const beforeSave = run(
    start('punch-walk', { samplePlan: false, mic: true }, WALK_ROUTE),
    sig('punch.photo.added', { source: 'sample' }, T0 + 1000),
    sig('punch.description.filled', {}, T0 + 2000),
  );
  eq('(setup) on the save step', stepId(beforeSave), 'punch-save');
  const leftUnsaved = reduceTutorial(beforeSave, HUB_ROUTE(T0 + 3000), defs);
  eq('back from the SAVE step still pauses — never skips a do step', [stepId(leftUnsaved), pauseReason(leftUnsaved), R(leftUnsaved).skipped], ['punch-save', 'offroute', ['punch-pin', 'punch-pin-next']]);
}
{
  let s = start('daily-report-voice');
  s = reduceTutorial(s, { type: 'PAUSE', reason: 'background', now: T0 + 100 }, defs);
  const r = reduceTutorial(s, DFR_ROUTE, defs);
  eq('a background pause is NOT lifted by a route event', pauseReason(r), 'background');
  const res = reduceTutorial(s, { type: 'RESUME', now: T0 + 200 }, defs);
  eq('RESUME lifts it (on route → running)', R(res).paused, false);
  eq('autoExitReason: background ≥ 60 min', autoExitReason(s, T0 + 100 + BACKGROUND_EXIT_MS), 'background');
  eq('autoExitReason: background < 60 min', autoExitReason(s, T0 + 100 + BACKGROUND_EXIT_MS - 1), null);
  const off = reduceTutorial(start('daily-report-voice'), route('/', {}, T0 + 100), defs);
  eq('autoExitReason: offroute ≥ 10 min', autoExitReason(off, T0 + 100 + OFFROUTE_EXIT_MS), 'offroute_timeout');
  eq('autoExitReason: running unpaused → null', autoExitReason(start('daily-report-voice'), T0 + 10 * OFFROUTE_EXIT_MS), null);
}

// ── rule h: EXIT reasons ────────────────────────────────────────────────────
console.log('EXIT');
for (const reason of ['skip', 'esc', 'offroute_timeout', 'background', 'sample_gone', 'signed_out', 'persona_changed', 'boot_failed'] as const) {
  const s = reduceTutorial(start('daily-report-voice'), { type: 'EXIT', reason, now: T0 + 50 }, defs);
  eq(`EXIT ${reason} → finished/exited at the current step`, s.status === 'finished' ? [s.outcome, s.reason, s.atStepId, s.sandboxProjectId] : null, ['exited', reason, 'dfr-voice', SB]);
}
ok('EXIT while idle is a no-op', reduceTutorial(IDLE, { type: 'EXIT', reason: 'esc', now: T0 }, defs) === IDLE);
ok('FINISH before the finale is ignored', (() => { const s = start('daily-report-voice'); return reduceTutorial(s, { type: 'FINISH', now: T0 + 1 }, defs) === s; })());

// ── rule j: RESTORE ─────────────────────────────────────────────────────────
console.log('RESTORE');
{
  const saved = { tutorialId: 'punch-walk' as const, version: defs['punch-walk']!.version, stepIndex: 4, sandboxProjectId: SB, entry: 'hub' as const, savedAt: T0 };
  eq('version mismatch → idle', reduceTutorial(IDLE, { type: 'RESTORE', saved: { ...saved, version: 999 }, sampleExists: true, now: T0 + 1000 }, defs), IDLE);
  eq('older than 24 h → idle', reduceTutorial(IDLE, { type: 'RESTORE', saved, sampleExists: true, now: T0 + RESTORE_MAX_AGE_MS }, defs), IDLE);
  eq('sample gone → idle', reduceTutorial(IDLE, { type: 'RESTORE', saved, sampleExists: false, now: T0 + 1000 }, defs), IDLE);
  const r = reduceTutorial(IDLE, { type: 'RESTORE', saved, sampleExists: true, now: T0 + 1000 }, defs);
  eq('valid → running, PAUSED (restored) at the checkpoint ≤ saved step', [R(r).phase, pauseReason(r), stepId(r)], ['step', 'restored', 'punch-photo']);
  const walked = reduceTutorial(r, WALK_ROUTE, defs);
  eq('landing on the step route does NOT resume a restored run', pauseReason(walked), 'restored');
  const resumed = reduceTutorial(walked, { type: 'RESUME', now: T0 + 2000 }, defs);
  eq('only RESUME (the user) does', R(resumed).paused, false);
  eq('the stat clock restarts at Resume (measured from here, not stitched)', R(resumed).firstActionAt, T0 + 2000);
  const sig1 = reduceTutorial(r, sig('punch.photo.added', { source: 'camera' }, T0 + 1500), defs);
  ok('a signal before RESUME does nothing', sig1 === r);
  eq('autoExitReason never ends a restored run', autoExitReason(r, T0 + 10 * BACKGROUND_EXIT_MS), null);
  eq('checkpointIndexAtOrBefore clamps to a checkpoint', checkpointIndexAtOrBefore(defs['punch-walk']!, 99), 0);
  const mid = run(start('invoice-to-self', undefined, INV_ROUTE), sig('invoice.amount.set', { total: 63360 }, T0 + 100));
  eq('toSavedActive saves the checkpoint index, not the live step', toSavedActive(mid, defs, T0 + 200)?.stepIndex, 0);
  eq('toSavedActive: nothing to save while booting', toSavedActive(run(IDLE, { type: 'START', tutorialId: 'punch-walk', sandboxProjectId: SB, entry: 'hub', now: T0 }), defs, T0), null);
  ok('RESTORE while running is ignored', reduceTutorial(mid, { type: 'RESTORE', saved, sampleExists: true, now: T0 + 1000 }, defs) === mid);
}

// ── invoice: contiguous completion + failure ────────────────────────────────
console.log('invoice: send → sheet, and a failed send');
{
  let s = start('invoice-to-self', undefined, INV_ROUTE);
  s = run(s, sig('invoice.amount.set', { total: 63360 }, T0 + 2000), { type: 'NEXT', now: T0 + 4000 });
  eq('amount set → totals look → send step', stepId(s), 'invoice-send');
  const failed = reduceTutorial(s, sig('invoice.send.failed', { reason: 'No internet connection' }, T0 + 5000), defs);
  eq('invoice.send.failed keeps the step and records the real reason', [stepId(failed), R(failed).failure?.reason], ['invoice-send', 'No internet connection']);
  // Review round 1: skipping the send must not land on the invisible sheet
  // wait step (it draws nothing) — the whole same-completion block goes.
  const skippedSend = run(failed, { type: 'STUCK', now: T0 + 20_000 }, { type: 'SKIP_STEP', now: T0 + 21_000 });
  eq('SKIP_STEP from the send skips the sheet wait with it → the result look', stepId(skippedSend), 'invoice-result');
  eq('…both logged skip_step and recorded as skipped', [R(skippedSend).log.slice(-2).map(l => [l.stepId, l.via]), R(skippedSend).skipped], [[['invoice-send', 'skip_step'], ['invoice-sheet', 'skip_step']], ['invoice-send', 'invoice-sheet']]);
  eq('…with no failure carried onto the next step', R(skippedSend).failure, undefined);
  const view = coachView(failed, env({ 'invoice.send': { x: 10, y: 700, w: 300, h: 48 } }), defs);
  eq('…and the coach shows it as a card', view.kind === 'card' ? view.reason : view.kind, 'failed');
  s = reduceTutorial(failed, sig('invoice.sent', { invoiceId: 'i3', number: 3, total: 63360, to: 'gc@example.com' }, T0 + 38_000), defs);
  eq('invoice.sent at the do step completes the wait step too → celebrate', [R(s).phase, R(s).celebrate?.stepId, R(s).failure], ['celebrate', 'invoice-sheet', undefined]);
  eq('…with no step recorded as skipped (same completion)', R(s).skipped, []);
  eq('…and both logged via signal', R(s).log.slice(-2).map(l => [l.stepId, l.via]), [['invoice-send', 'signal'], ['invoice-sheet', 'signal']]);
  const stamp = successCopy(defs['invoice-to-self']!.steps[3], { pointerFine: false, web: false, freeTier: true, payloads: R(s).payloads });
  eq('stamp title / sub from the payload', [stamp?.title, stamp?.sub], ['Invoice #3 sent to you', '$63,360 · check gc@example.com']);
  eq('invoice stat', statLine(defs['invoice-to-self']!, R(s)), "Invoice out in 38 s · the client's copy went to your inbox");
}

// ── assists + affordances ───────────────────────────────────────────────────
console.log('assists and card affordances');
{
  let s = start('daily-report-voice');
  eq('fresh do step: no Next, no Skip, no assist', cardAffordances(s, defs, { screenReader: false }), { next: false, skip: false, assist: null, stepNumber: 1, stepCount: 4 });
  s = reduceTutorial(s, { type: 'STUCK', now: T0 + 15_000 }, defs);
  eq('after STUCK: Skip + Do it for me', cardAffordances(s, defs, { screenReader: false }), { next: false, skip: true, assist: 'dfr.useSampleNote', stepNumber: 1, stepCount: 4 });
  const sr = start('daily-report-voice');
  eq('screen reader: Skip and assist from step 1', cardAffordances(sr, defs, { screenReader: true }).assist, 'dfr.useSampleNote');
  const wrong = reduceTutorial(s, { type: 'ASSIST', assistId: 'invoice.fillPercent', now: T0 + 15_100 }, defs);
  ok('an assist the step does not declare is ignored', wrong === s);
  s = run(s, { type: 'ASSIST', assistId: 'dfr.useSampleNote', now: T0 + 15_100 }, sig('dfr.voice.applied', { fields: ['a'], source: 'sample' }, T0 + 15_200));
  eq('a step completed after its assist logs via assist', R(s).log.at(-1)?.via, 'assist');
  eq('look step: Next offered', cardAffordances(s, defs, { screenReader: false }).next, true);
  const stuckLook = reduceTutorial(s, { type: 'STUCK', now: T0 + 40_000 }, defs);
  ok('STUCK does not fire on a look step', stuckLook === s);
}

// ── coachView ───────────────────────────────────────────────────────────────
console.log('coachView');
function env(rects: CoachEnv['rects'], extra: Partial<CoachEnv> = {}): CoachEnv {
  return { rects, viewport: { w: 390, h: 844 }, mountedLayers: ['root'], screenReader: false, keyboardH: 0, now: T0, ...extra };
}
{
  eq('idle → hidden', coachView(IDLE, env({}), defs), { kind: 'hidden' });
  const boot = run(IDLE, { type: 'START', tutorialId: 'daily-report-voice', sandboxProjectId: SB, entry: 'hub', now: T0 });
  eq('boot → hidden', coachView(boot, env({}), defs).kind, 'hidden');
  const s = start('daily-report-voice');
  const rect = { x: 16, y: 400, w: 358, h: 64 };
  eq('mounted + on screen → spotlight', coachView(s, env({ 'dfr.voice': rect }), defs), { kind: 'spotlight', layer: 'root', stepId: 'dfr-voice', targetId: 'dfr.voice', rect });
  eq('unmounted → hidden until the 4 s timeout', coachView(s, env({}), defs).kind, 'hidden');
  const tm = reduceTutorial(s, { type: 'TARGET_TIMEOUT', now: T0 + 4000 }, defs);
  const missing = coachView(tm, env({}), defs);
  eq('…then card(missing)', missing.kind === 'card' ? missing.reason : missing.kind, 'missing');
  const below = coachView(s, env({ 'dfr.voice': { x: 16, y: 1400, w: 358, h: 64 } }), defs);
  eq('off the bottom → card(offscreen, scroll down)', below.kind === 'card' ? [below.reason, below.scroll] : below.kind, ['offscreen', 'down']);
  const kb = coachView(s, env({ 'dfr.voice': { x: 16, y: 600, w: 358, h: 64 } }, { keyboardH: 320 }), defs);
  eq('under the keyboard → card(offscreen)', kb.kind === 'card' ? kb.reason : kb.kind, 'offscreen');
  const srv = coachView(s, env({ 'dfr.voice': rect }, { screenReader: true }), defs);
  eq('screen reader → card, no dims', srv.kind === 'card' ? srv.reason : srv.kind, 'screenreader');
  eq('another modal layer up → hidden (no dim under a modal)', coachView(s, env({ 'dfr.voice': rect }, { mountedLayers: ['root', 'planPin'] }), defs).kind, 'hidden');
  const look = reduceTutorial(s, sig('dfr.voice.applied', { fields: ['a'], source: 'sample' }, T0 + 100), defs);
  const fb = coachView(look, env({ 'dfr.workPerformed': rect }), defs);
  eq('fallback chain: the first MOUNTED id wins', fb.kind === 'spotlight' ? fb.targetId : fb.kind, 'dfr.workPerformed');
  const ctx: CopyCtx = { pointerFine: false, web: false, freeTier: false, payloads: {} };
  eq('textByTarget is used for the fallback target', stepCopy(defs['daily-report-voice']!.steps[3], ctx, 'hub.group.field').text, "Today's report is filed under Field Ops.");
  const paused = reduceTutorial(s, route('/project-detail', { id: SB }, T0 + 50), defs);
  eq('paused on a sample screen → paused pill there', coachView(paused, env({}), defs), { kind: 'paused', reason: 'offroute', onSample: true });
  const pausedHome = reduceTutorial(s, route('/', {}, T0 + 50), defs);
  eq('paused elsewhere → pill not on this screen', coachView(pausedHome, env({}), defs), { kind: 'paused', reason: 'offroute', onSample: false });
  // planPin layer
  let p = start('punch-walk', { samplePlan: true, mic: true }, WALK_ROUTE);
  p = reduceTutorial(p, sig('punch.photo.added', { source: 'sample' }, T0 + 100), defs);
  eq('planPin step with its modal not up yet → hidden', coachView(p, env({ 'punch.planImage': rect }), defs).kind, 'hidden');
  const pv = coachView(p, env({ 'punch.planImage': rect }, { mountedLayers: ['root', 'planPin'] }), defs);
  eq('planPin step inside its layer → spotlight on planPin', pv.kind === 'spotlight' ? pv.layer : pv.kind, 'planPin');
  // wait step
  const w = run(start('invoice-to-self', undefined, INV_ROUTE));
  const wait: RunState = { ...R(w), stepIndex: 3 };
  eq('wait step → hidden (the engine just listens)', coachView(wait, env({}), defs).kind, 'hidden');
  const cel = run(start('daily-report-voice'), sig('dfr.saved', { reportId: 'r', status: 'draft' }, T0 + 100));
  eq('celebrate draws on the top layer', coachView(cel, env({}, { mountedLayers: ['root', 'planPin'] }), defs), { kind: 'celebrate', layer: 'planPin', stepId: 'dfr-save' });
}

// ── blocker sentinels (review round 2) ──────────────────────────────────────
// A layer-less RN Modal (the send sheet, the voice capture sheet…) draws
// ABOVE the root layer on iOS. While one is up the coach must draw nothing,
// yet nothing may advance or strand.
console.log('blocker sentinels: nothing draws under a layer-less modal');
{
  const tgt = (id: string, mounted: boolean, now: number): TutorialEvent => ({ type: 'TARGET', id, mounted, now });
  const sendRect = { 'invoice.send': { x: 10, y: 700, w: 300, h: 48 } };
  let s = start('invoice-to-self', undefined, INV_ROUTE);
  s = run(s, sig('invoice.amount.set', { total: 63360 }, T0 + 2000), { type: 'NEXT', now: T0 + 4000 });
  eq('on the send step: spotlight on Send to me', coachView(s, env(sendRect), defs).kind, 'spotlight');
  const up = reduceTutorial(s, tgt('invoice.modalUp', true, T0 + 5000), defs);
  eq('the send sheet opens (blocker mounted) → hidden, not a spotlight behind it', coachView(up, env(sendRect), defs), { kind: 'hidden' });
  eq('…the step itself does not move (the sheet is not a goal)', stepId(up), 'invoice-send');
  const stuckUp = reduceTutorial(up, { type: 'STUCK', now: T0 + 20_000 }, defs);
  eq('…15 s in the sheet: still hidden (no Skip card he cannot touch)', coachView(stuckUp, env(sendRect), defs).kind, 'hidden');
  const cancelled = reduceTutorial(up, tgt('invoice.modalUp', false, T0 + 9000), defs);
  eq('cancel the sheet (blocker unmounts) → the spotlight comes straight back', coachView(cancelled, env(sendRect), defs).kind, 'spotlight');
  const failedUp = reduceTutorial(up, sig('invoice.send.failed', { reason: 'No internet connection' }, T0 + 6000), defs);
  eq('a failure while a modal is up → hidden too (no card under the sheet)', coachView(failedUp, env(sendRect), defs).kind, 'hidden');
  const failedDown = reduceTutorial(failedUp, tgt('invoice.modalUp', false, T0 + 6500), defs);
  eq('…and the failed card shows once it closes', (v => (v.kind === 'card' ? v.reason : v.kind))(coachView(failedDown, env(sendRect), defs)), 'failed');
  const sent = reduceTutorial(up, sig('invoice.sent', { invoiceId: 'i3', number: 3, total: 63360, to: 'gc@example.com' }, T0 + 7000), defs);
  eq('invoice.sent with a blocker still mounted → celebrate', [R(sent).phase, R(sent).celebrate?.stepId], ['celebrate', 'invoice-sheet']);
  eq('…and the stamp is NOT hidden by it (the success moment always plays)', coachView(sent, env({}), defs).kind, 'celebrate');
  // Paused and finale views hide too.
  const pausedUp = reduceTutorial(up, { type: 'PAUSE', reason: 'background', now: T0 + 5100 }, defs);
  eq('paused with a modal up → hidden (no pill under it)', coachView(pausedUp, env({}), defs).kind, 'hidden');
  let d = start('daily-report-voice');
  d = reduceTutorial(d, tgt('voice.modalUp', true, T0 + 100), defs);
  eq('dfr-voice: the iPhone voice capture sheet is up → hidden', coachView(d, env({ 'dfr.voice': { x: 16, y: 400, w: 358, h: 64 } }), defs).kind, 'hidden');
  d = run(d, tgt('voice.modalUp', false, T0 + 9000), sig('dfr.voice.applied', { fields: ['a'], source: 'mic' }, T0 + 9500));
  eq('…the mic fill completes the step as usual', stepId(d), 'dfr-preview');
  let f = run(start('daily-report-voice'), sig('dfr.saved', { reportId: 'r', status: 'draft' }, T0 + 100), { type: 'CELEBRATION_DONE', now: T0 + 1500 }, HUB_ROUTE(T0 + 1600), { type: 'NEXT', now: T0 + 2000 });
  eq('finale reached', R(f).phase, 'finale');
  f = reduceTutorial(f, tgt('hub.modalUp', true, T0 + 2100), defs);
  eq('finale with a hub section modal up → hidden', coachView(f, env({}), defs).kind, 'hidden');
  const notBlocker = reduceTutorial(s, tgt('dfr.voicePreview', true, T0 + 5000), defs);
  eq('an ordinary target mounting does not hide anything', coachView(notBlocker, env(sendRect), defs).kind, 'spotlight');
}

// ── resumeTarget (review round 2) ───────────────────────────────────────────
// RESUME never navigates, so the pill's Resume needs to know where to go.
console.log('resumeTarget: where the paused pill takes him');
{
  const sctx = { today: '2026-09-23', reportDay: '2026-09-23' };
  let s = start('invoice-to-self', undefined, INV_ROUTE);
  s = run(s, sig('invoice.amount.set', { total: 63360 }, T0 + 2000), { type: 'NEXT', now: T0 + 4000 }, { type: 'STUCK', now: T0 + 20_000 }, { type: 'SKIP_STEP', now: T0 + 21_000 });
  eq('SKIP_STEP from the send, still on /invoice → paused offroute on the hub result', [stepId(s), pauseReason(s)], ['invoice-result', 'offroute']);
  eq('…resumeTarget = the sample hub', resumeTarget(s, defs, sctx), { pathname: '/project-detail', params: { id: SB } });
  const resumedInPlace = reduceTutorial(s, { type: 'RESUME', now: T0 + 22_000 }, defs);
  eq('…RESUME alone cannot lift it (he is still on /invoice)', pauseReason(resumedInPlace), 'offroute');
  const landed = reduceTutorial(s, HUB_ROUTE(T0 + 22_500), defs);
  eq('…the pushed route lands → unpaused, resumeTarget null', [R(landed).paused, resumeTarget(landed, defs, sctx)], [false, null]);
  eq('running unpaused → null', resumeTarget(start('invoice-to-self', undefined, INV_ROUTE), defs, sctx), null);
  eq('idle → null', resumeTarget(IDLE, defs, sctx), null);
  const saved = { tutorialId: 'invoice-to-self' as const, version: defs['invoice-to-self']!.version, stepIndex: 2, sandboxProjectId: SB, entry: 'hub' as const, savedAt: T0 };
  const restored = reduceTutorial(IDLE, { type: 'RESTORE', saved, sampleExists: true, now: T0 + 1000 }, defs);
  eq('restored at the start checkpoint → the start screen with the start params', resumeTarget(restored, defs, sctx), { pathname: '/invoice', params: { projectId: SB, type: 'progress' } });
  const dSaved = { tutorialId: 'daily-report-voice' as const, version: defs['daily-report-voice']!.version, stepIndex: 0, sandboxProjectId: SB, entry: 'hub' as const, savedAt: T0 };
  const dRestored = reduceTutorial(IDLE, { type: 'RESTORE', saved: dSaved, sampleExists: true, now: T0 + 1000 }, defs);
  eq('restored DFR → the report day from the start params', resumeTarget(dRestored, defs, { today: '2026-09-23', reportDay: '2026-09-22' }), { pathname: '/daily-report', params: { projectId: SB, date: '2026-09-22' } });
  const dOn = reduceTutorial(dRestored, DFR_ROUTE, defs);
  eq('restored but already on the step screen → null (RESUME alone)', resumeTarget(dOn, defs, sctx), null);
}

// ── copy ────────────────────────────────────────────────────────────────────
console.log('copy tokens');
eq('{Tap} on touch', fillCopy('{Tap} Save Draft — then {tap} Next', false), 'Tap Save Draft — then tap Next');
eq('{Tap} with a fine pointer', fillCopy('{Tap} Save Draft — then {tap} Next', true), 'Click Save Draft — then click Next');
eq('web copy variant is used on web', stepCopy(defs['daily-report-voice']!.steps[0], { pointerFine: true, web: true, freeTier: true, payloads: {} }).text, 'Click the sample voice note');
eq('the Free meter line is real copy on iPhone', stepCopy(defs['daily-report-voice']!.steps[0], { pointerFine: false, web: false, freeTier: true, payloads: {} }).detail, 'Sample — no AI credits used. The mic uses 1 of your 3 free voice fills.');

// ── practice pass ───────────────────────────────────────────────────────────
console.log('practice pass');
{
  ok('the founder default is ON', TUTORIAL_PRACTICE_PASS === true);
  const p = start('punch-walk', undefined, WALK_ROUTE);
  ok('running + sandbox + listed feature → allowed', practiceAllows(p, SB, 'punch_list_closeout', T0 + 100));
  ok('another project → refused', !practiceAllows(p, OTHER, 'punch_list_closeout', T0 + 100));
  ok('a feature the def does not list → refused', !practiceAllows(p, SB, 'change_orders_invoicing', T0 + 100));
  ok('a feature outside the allowed four → refused', !practiceAllows(p, SB, 'cost_xray', T0 + 100));
  const paused = reduceTutorial(p, { type: 'PAUSE', reason: 'background', now: T0 + 200 }, defs);
  ok('paused → still allowed (he comes back to the same screen)', practiceAllows(paused, SB, 'punch_list_closeout', T0 + 300));
  const ended = reduceTutorial(p, { type: 'EXIT', reason: 'esc', now: T0 + 1000 }, defs);
  ok('ended < 1.5 s ago → allowed (grace for the pop)', practiceAllows(ended, SB, 'punch_list_closeout', T0 + 1000 + PRACTICE_GRACE_MS - 1));
  ok('ended ≥ 1.5 s ago → refused', !practiceAllows(ended, SB, 'punch_list_closeout', T0 + 1000 + PRACTICE_GRACE_MS));
  ok('idle → refused', !practiceAllows(IDLE, SB, 'punch_list_closeout', T0));
  ok('no project → refused', !practiceAllows(p, null, 'punch_list_closeout', T0));
  eq('daily report opens nothing (it is free)', practiceFeatures(start('daily-report-voice'), SB, T0), []);
  eq('invoice opens only invoicing', practiceFeatures(start('invoice-to-self', undefined, INV_ROUTE), SB, T0), ['change_orders_invoicing']);
  // A restored run (brought back paused at launch, never auto-resumed) carries
  // NO pass: otherwise the pass outlives the tutorial for the whole session.
  const savedRun = { tutorialId: 'invoice-to-self' as const, version: defs['invoice-to-self']!.version, stepIndex: 0, sandboxProjectId: SB, entry: 'hub' as const, savedAt: T0 };
  const restored = reduceTutorial(IDLE, { type: 'RESTORE', saved: savedRun, sampleExists: true, now: T0 + 1000 }, defs);
  eq('restored (paused, not resumed) → refused', practiceFeatures(restored, SB, T0 + 1000 + 6 * 3600_000), []);
  const restoredThenResumed = reduceTutorial(restored, { type: 'RESUME', now: T0 + 2000 }, defs);
  ok('restored then RESUME → allowed again', practiceAllows(restoredThenResumed, SB, 'change_orders_invoicing', T0 + 2100));
  const offroute = reduceTutorial(start('invoice-to-self', undefined, INV_ROUTE), { type: 'PAUSE', reason: 'offroute', now: T0 + 200 }, defs);
  ok('offroute-paused → still allowed', practiceAllows(offroute, SB, 'change_orders_invoicing', T0 + 300));
}

// ── stats ───────────────────────────────────────────────────────────────────
console.log('stats');
eq('formatDuration 34 s', formatDuration(34_400), '34 s');
eq('formatDuration 2 m 14 s', formatDuration(134_000), '2 m 14 s');
eq('formatDuration never 0 s', formatDuration(10), '1 s');
eq('no stat without a measured start', statLine(defs['daily-report-voice']!, { firstActionAt: undefined, signalAt: { 'dfr.saved': T0 }, payloads: {} }), null);
eq('no stat without the success signal', statLine(defs['daily-report-voice']!, { firstActionAt: T0, signalAt: {}, payloads: {} }), null);

// ── handoff ─────────────────────────────────────────────────────────────────
console.log('handoff');
{
  const projects = [
    { id: 's', name: "Sample — Sarah's Place", ownerUserId: 'u', createdAt: '2026-09-01', updatedAt: '2026-09-22' },
    { id: 'old', name: 'Maple St', ownerUserId: 'u', createdAt: '2026-01-01', updatedAt: '2026-02-01' },
    { id: 'new', name: 'Henderson Residence Kitchen And Primary Bath Remodel', ownerUserId: 'u', createdAt: '2026-03-01', updatedAt: '2026-09-20' },
    { id: 'shared', name: 'GC Job', ownerUserId: 'g', myRole: 'viewer' as const, createdAt: '2026-09-21', updatedAt: '2026-09-23' },
  ];
  const all = () => true;
  const none = () => false;
  const dfr = handoffFor(defs['daily-report-voice']!, { projects, userId: 'u', canAccess: all, stripeConnected: true, fieldOnly: false }, defs);
  eq('real job: his newest non-sample, viewer jobs excluded', [dfr.primary?.destination, dfr.primary?.route?.params.projectId], ['real_job', 'new']);
  ok('job name shortened to one line', (dfr.primary?.label.length ?? 99) <= 60, dfr.primary?.label);
  eq('chain offer to punch', dfr.chain?.tutorialId, 'punch-walk');
  const none1 = handoffFor(defs['daily-report-voice']!, { projects: [projects[0]], userId: 'u', canAccess: all, stripeConnected: true, fieldOnly: false }, defs);
  eq('no real job → Start your first job (/?openCreate=1)', [none1.primary?.destination, none1.primary?.route?.pathname, none1.primary?.route?.params.openCreate], ['create_job', '/', '1']);
  const punchFree = handoffFor(defs['punch-walk']!, { projects, userId: 'u', canAccess: none, stripeConnected: false, fieldOnly: false }, defs);
  eq('practised a feature he lacks → paywall, source tutorial_handoff', [punchFree.primary?.destination, punchFree.primary?.feature, punchFree.primary?.paywallSource, punchFree.primary?.label], ['paywall', 'punch_list_closeout', 'tutorial_handoff', 'Punch walk comes with Business — see plans']);
  const inv = handoffFor(defs['invoice-to-self']!, { projects, userId: 'u', canAccess: all, stripeConnected: false, fieldOnly: false }, defs);
  eq('invoicing owner without Stripe → Connect Stripe secondary', [inv.primary?.destination, inv.secondary?.destination, inv.secondary?.route?.pathname], ['real_job', 'stripe', '/payments-setup']);
  const invFree = handoffFor(defs['invoice-to-self']!, { projects, userId: 'u', canAccess: none, stripeConnected: false, fieldOnly: false }, defs);
  eq('…but no Stripe nag for someone who cannot invoice yet', invFree.secondary, null);
  const fieldPunch = handoffFor(defs['punch-walk']!, { projects, userId: 'u', canAccess: all, stripeConnected: true, fieldOnly: true }, defs);
  eq('field seat: no chain offer to invoicing', fieldPunch.chain, null);
  const fieldNoJob = handoffFor(defs['daily-report-voice']!, { projects: [projects[0]], userId: 'u', canAccess: all, stripeConnected: true, fieldOnly: true }, defs);
  eq('field seat with no reachable job: no create-job button (only Done)', fieldNoJob.primary, null);
  // Review round 1: access is per JOB. On a job shared with him it follows the
  // owner's plan (resolveProjectAccess, as hooks/useProjectAccess does).
  const gcJob = { id: 'gc', name: 'Oak Ridge Addition', ownerUserId: 'g', myRole: 'field' as const, createdAt: '2026-09-10', updatedAt: '2026-09-21' };
  const foreman = handoffFor(defs['punch-walk']!, { projects: [projects[0], gcJob], userId: 'u', canAccess: none, stripeConnected: false, fieldOnly: true }, defs);
  eq('field seat on a Free plan, GC job shared as field → walk the GC job, not a paywall', [foreman.primary?.destination, foreman.primary?.route?.params.projectId], ['real_job', 'gc']);
  const mixed = handoffFor(defs['punch-walk']!, { projects: [...projects, gcJob], userId: 'u', canAccess: none, stripeConnected: false, fieldOnly: false }, defs);
  eq('Free owner of his own jobs + a shared field job → the shared job (his own jobs need his plan)', [mixed.primary?.destination, mixed.primary?.route?.params.projectId], ['real_job', 'gc']);
  const ownerOnlyFeature = handoffFor(defs['invoice-to-self']!, { projects, userId: 'u', canAccess: none, stripeConnected: false, fieldOnly: false }, defs);
  eq('Free owner, only his own jobs → still the paywall', ownerOnlyFeature.primary?.destination, 'paywall');
}

// ── offers ──────────────────────────────────────────────────────────────────
console.log('offers');
{
  const base = { tutorialId: 'daily-report-voice' as const, persona: 'contractor' as const, fieldOnly: false, projectIsSample: false, screenOpened: true, midDraft: false, keyboardUp: false, runActive: false, today: '2026-09-23' };
  ok('fresh real screen → chip', shouldOfferChip(EMPTY_PROGRESS, base));
  ok('never on a sample', !shouldOfferChip(EMPTY_PROGRESS, { ...base, projectIsSample: true }));
  ok('never mid-draft', !shouldOfferChip(EMPTY_PROGRESS, { ...base, midDraft: true }));
  ok('never with the keyboard up', !shouldOfferChip(EMPTY_PROGRESS, { ...base, keyboardUp: true }));
  ok('never during a run', !shouldOfferChip(EMPTY_PROGRESS, { ...base, runActive: true }));
  ok('never when the screen was paywalled', !shouldOfferChip(EMPTY_PROGRESS, { ...base, screenOpened: false }));
  const p = (x: Partial<TutorialProgress>): TutorialProgress => ({ ...EMPTY_PROGRESS, ...x });
  ok('× is forever', !shouldOfferChip(p({ chips: { 'daily-report-voice': { dismissedAt: '2026-09-01' } } }), base));
  ok('shown once per tutorial', !shouldOfferChip(p({ chips: { 'daily-report-voice': { shownAt: '2026-09-01' } } }), base));
  ok('one chip per day across the app', !shouldOfferChip(p({ lastChipDay: '2026-09-23' }), base));
  ok('practised → never', !shouldOfferChip(p({ byId: { 'daily-report-voice': { status: 'practised', version: 1 } } }), base));
  ok('exited → never', !shouldOfferChip(p({ byId: { 'daily-report-voice': { status: 'exited', version: 1 } } }), base));
  ok('field seat never offered invoicing', !shouldOfferChip(EMPTY_PROGRESS, { ...base, tutorialId: 'invoice-to-self', fieldOnly: true }));
  eq('contractor sees all three', tutorialsForUser('contractor', false).map(d => d.id), ['daily-report-voice', 'punch-walk', 'invoice-to-self']);
  eq('field seat: daily report and punch only', tutorialsForUser('contractor', true).map(d => d.id), ['daily-report-voice', 'punch-walk']);
  eq('client persona: none', tutorialsForUser('client', false), []);
  eq('property manager: none', tutorialsForUser('property_manager', false), []);
  const def = defs['punch-walk']!;
  eq('hub pill: Continue at the saved checkpoint', tutorialCardStatus(p({ active: { tutorialId: 'punch-walk', version: def.version, stepIndex: 2, sandboxProjectId: SB, entry: 'hub', savedAt: T0 } }), def).label, `Continue · step 3 of ${def.steps.length}`);
  eq('hub pill: Practised · Replay', tutorialCardStatus(p({ byId: { 'punch-walk': { status: 'practised', version: 1 } } }), def).label, 'Practised · Replay');
  eq('hub pill: stale saved version → New', tutorialCardStatus(p({ active: { tutorialId: 'punch-walk', version: 999, stepIndex: 2, sandboxProjectId: SB, entry: 'hub', savedAt: T0 } }), def).label, 'New');
}

// ── sandbox ─────────────────────────────────────────────────────────────────
console.log('sandbox');
{
  const name = "Sample — Sarah's Place";
  const ps = [
    { id: 'a', name, ownerUserId: 'u', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' },
    { id: 'b', name, ownerUserId: 'u', createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z' },
    { id: 'c', name, ownerUserId: 'g', myRole: 'editor' as const, createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z' },
    { id: 'd', name: "Sarah's Place", ownerUserId: 'u', createdAt: '2026-09-22T00:00:00Z', updatedAt: '2026-09-22T00:00:00Z' },
  ];
  eq('pickSandboxProject: newest OWNED exact-name sample', pickSandboxProject(ps, 'u', name)?.id, 'b');
  eq('…never a real name, even if asked', pickSandboxProject(ps, 'u', "Sarah's Place"), null);
  eq('…never another contractor\'s sample', pickSandboxProject(ps.filter(p => p.id === 'c'), 'u', name), null);
  ok('renamed out of the prefix → no longer a sandbox', !sandboxStillValid([{ ...ps[1], name: 'Kitchen job' }], 'u', 'b'));
  ok('deleted → no longer a sandbox', !sandboxStillValid(ps, 'u', 'zzz'));
  ok('still there → valid', sandboxStillValid(ps, 'u', 'b'));
  eq('newestRealProject skips samples', newestRealProject(ps, 'u')?.id, 'd');
  eq('report day: today when free', tutorialReportDay([{ projectId: 's', date: '2026-09-22' }], 's', '2026-09-23'), '2026-09-23');
  eq('report day: replay takes the latest free day', tutorialReportDay([{ projectId: 's', date: '2026-09-23T10:00:00' }, { projectId: 's', date: '2026-09-22' }, { projectId: 'x', date: '2026-09-21' }], 's', '2026-09-23'), '2026-09-21');
  eq('report day crosses a month boundary', tutorialReportDay([{ projectId: 's', date: '2026-10-01' }], 's', '2026-10-01'), '2026-09-30');
  ok('field-only: every real job is a field seat', isFieldOnlyUser([{ name: 'GC job', ownerUserId: 'g', myRole: 'field' }, { name, ownerUserId: 'u' }], 'u'));
  ok('not field-only once he owns a real job', !isFieldOnlyUser([{ name: 'GC job', ownerUserId: 'g', myRole: 'field' }, { name: 'Mine', ownerUserId: 'u' }], 'u'));
  ok('not field-only with no jobs at all (a new GC)', !isFieldOnlyUser([], 'u'));
}

// ── activeRun ───────────────────────────────────────────────────────────────
console.log('activeRun');
setActiveTutorialId('punch-walk');
eq('set / get', getActiveTutorialId(), 'punch-walk');
setActiveTutorialId(null);
eq('cleared', getActiveTutorialId(), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
