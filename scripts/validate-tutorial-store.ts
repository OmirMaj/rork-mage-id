// validate-tutorial-store.ts — the tutorial store (utils/tutorial/store.ts) and
// the progress blob (utils/tutorial/progress.ts), run under bun.
//
// WHAT IT PINS, and why each matters to a user:
//   • idle costs nothing: tutorialSignal / target registration while idle do
//     not change state or fire analytics (screens call these on every save);
//   • analytics come from the TRANSITION, never the event: a foreign-project
//     signal or NEXT on a do step fires no tutorial_step_completed;
//     tutorial_started fires once per START, not on RESTORE; tutorial_exited
//     only for a real walk-out (closing the finale is 'completed');
//   • activeRun (the in_tutorial tag on every PostHog event) is set while a
//     run is live, and NOT while a restored run waits on the pill — a day of
//     real work must not be tagged as practice;
//   • the practice pass through the store: sandbox + listed feature + live
//     run (or 1.5 s of grace) only;
//   • targets: registering while a run is live emits TARGET (that is how the
//     planPin 'until mounted' step completes), and the last registration of a
//     duplicated id wins without a phantom unmount;
//   • progress: garbage parses to EMPTY; a practised tutorial stays practised
//     on replay or exit; bestMs keeps the fastest MEASURED run; the saved run
//     is dropped at the finale and at exit.
//
// Run: bun run scripts/validate-tutorial-store.ts

import {
  __resetTutorialStoreForTest,
  dispatchTutorial,
  endTutorial,
  getTutorialState,
  isTutorialActive,
  mountedTutorialTargetIds,
  registerTutorialTarget,
  runTutorialAssist,
  startTutorial,
  tutorialPracticeAllows,
  tutorialSignal,
  tutorialStepActive,
  unregisterTutorialTarget,
  getTutorialDefs,
  tutorialCoachVisible,
  EMPTY_PRESENTATION,
  screenReaderFrom,
  tutorialWebKeyAction,
  webFocusMove,
  exitMarksExited,
  androidAwayIsPause,
  ANDROID_BACKGROUND_GRACE_MS,
} from '../utils/tutorial/store';
import {
  parseTutorialProgress,
  withCheckpoint,
  withChipDismissed,
  withChipShown,
  withExited,
  withInterrupted,
  withPractised,
  withStarted,
  withoutActive,
} from '../utils/tutorial/progress';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EMPTY_PROGRESS, shouldOfferChip } from '../utils/tutorial/offers';
import { IDLE } from '../utils/tutorial/machine';
import { getActiveTutorialId } from '../utils/tutorial/activeRun';
import { setAnalyticsProvider } from '../utils/analytics';
import type { RunState, RunningState, SavedActiveRun, TutorialEvent, TutorialProgress } from '../utils/tutorial/types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const events: { name: string; props: Record<string, unknown> }[] = [];
setAnalyticsProvider({ track: (name, props) => { events.push({ name, props: (props ?? {}) as Record<string, unknown> }); } });
const named = (n: string) => events.filter(e => e.name === n);
const clearEvents = () => { events.length = 0; };

const SB = 'sample-1';
const OTHER = 'real-9';

function R(s: RunState): RunningState {
  if (s.status !== 'running') throw new Error(`expected running, got ${s.status}`);
  return s;
}
function d(e: TutorialEvent): RunState {
  return dispatchTutorial(e);
}
const now = () => Date.now();

function bootDfr(): void {
  d({ type: 'START', tutorialId: 'daily-report-voice', sandboxProjectId: SB, entry: 'hub', now: now() });
  d({ type: 'ROUTE', pathname: '/daily-report', params: { projectId: SB }, now: now() });
  d({ type: 'BOOTED', flags: { samplePlan: true, mic: true }, mounted: [], now: now() });
}

// ── 1. Idle costs nothing ───────────────────────────────────────────────────
console.log('\nidle:');
__resetTutorialStoreForTest();
clearEvents();
tutorialSignal('dfr.saved', { projectId: SB, reportId: 'r1', status: 'draft' });
ok('a signal while idle leaves the store idle', getTutorialState().status === 'idle');
const tok = {};
registerTutorialTarget('dfr.saveDraft', tok, null, null);
ok('registering a target while idle changes no state', getTutorialState().status === 'idle');
ok('…but the target is known (BOOTED snapshots it later)', mountedTutorialTargetIds().includes('dfr.saveDraft'));
unregisterTutorialTarget('dfr.saveDraft', tok);
eq('idle fires no analytics', events.length, 0);
ok('isTutorialActive() is false while idle', !isTutorialActive());
ok('activeRun is null while idle', getActiveTutorialId() === null);
ok('no pass while idle', !tutorialPracticeAllows(SB, 'punch_list_closeout'));

// ── 2. Host seams ───────────────────────────────────────────────────────────
console.log('\nhost seams:');
await (async () => {
  const r = await startTutorial('daily-report-voice', { entry: 'hub' });
  ok('startTutorial with no host mounted resolves false (nothing half-starts)', r === false && getTutorialState().status === 'idle');
})();
ok('runTutorialAssist with nothing registered does nothing', runTutorialAssist('dfr.useSampleNote') === false && getTutorialState().status === 'idle');

// ── 3. A full DFR run through the store: analytics from transitions ────────
console.log('\na run through the store:');
__resetTutorialStoreForTest();
clearEvents();
bootDfr();
eq('tutorial_started fires once', named('tutorial_started').length, 1);
eq('tutorial_started carries the entry and tutorial', [named('tutorial_started')[0]?.props.tutorial_id, named('tutorial_started')[0]?.props.entry], ['daily-report-voice', 'hub']);
ok('activeRun names the live run', getActiveTutorialId() === 'daily-report-voice');
ok('isTutorialActive() while running', isTutorialActive());
ok('the sample chip step is active on step 0', tutorialStepActive(getTutorialState(), getTutorialDefs(), 'dfr-voice'));
ok('a later step is not active yet', !tutorialStepActive(getTutorialState(), getTutorialDefs(), 'dfr-save'));

// A signal on a REAL job is ignored — and fires nothing.
clearEvents();
tutorialSignal('dfr.voice.applied', { projectId: OTHER, fields: ['workPerformed'], source: 'mic' });
eq('a foreign-project signal fires no analytics', events.length, 0);
eq('…and does not move the run', R(getTutorialState()).stepIndex, 0);

// NEXT on a DO step is ignored — and fires nothing.
d({ type: 'NEXT', now: now() });
eq('NEXT on a do step fires no analytics', events.length, 0);

tutorialSignal('dfr.voice.applied', { projectId: SB, fields: ['manpower', 'workPerformed', 'issuesAndDelays'], source: 'sample' });
eq('the real signal logs one tutorial_step_completed', named('tutorial_step_completed').length, 1);
eq('…via signal, for dfr-voice', [named('tutorial_step_completed')[0]?.props.step_id, named('tutorial_step_completed')[0]?.props.via], ['dfr-voice', 'signal']);
d({ type: 'NEXT', now: now() });
eq('NEXT on the look step logs via next', named('tutorial_step_completed')[1]?.props.via, 'next');

// Target registration while live emits TARGET.
const tokA = {};
const tokB = {};
registerTutorialTarget('dfr.saveDraft', tokA, null, null);
ok('registering while live records the mount', R(getTutorialState()).mounted.includes('dfr.saveDraft'));
const beforeDup = getTutorialState();
registerTutorialTarget('dfr.saveDraft', tokB, null, null);
// A duplicate mount (a re-render remounting the wrapper) is not a NEW mount:
// re-emitting TARGET would re-run 'until mounted' completions on it.
ok('a duplicate registration emits no second TARGET', getTutorialState() === beforeDup);
unregisterTutorialTarget('dfr.saveDraft', tokA);
ok('a stale duplicate unregistering does not unmount the live one', R(getTutorialState()).mounted.includes('dfr.saveDraft'));
unregisterTutorialTarget('dfr.saveDraft', tokB);
ok('the live one unregistering records the unmount', !R(getTutorialState()).mounted.includes('dfr.saveDraft'));

tutorialSignal('dfr.saved', { projectId: SB, reportId: 'r1', status: 'draft', crew: 3 });
ok('the save celebrates', R(getTutorialState()).phase === 'celebrate');
d({ type: 'CELEBRATION_DONE', now: now() });
d({ type: 'ROUTE', pathname: '/project-detail', params: { id: SB }, now: now() });
d({ type: 'NEXT', now: now() });
ok('past the last step: finale', R(getTutorialState()).phase === 'finale');
eq('tutorial_completed fires once at the finale', named('tutorial_completed').length, 1);
eq('…with 0 skipped steps', named('tutorial_completed')[0]?.props.skipped_steps, 0);
clearEvents();
endTutorial('skip');
ok('closing the finale finishes the run', getTutorialState().status === 'finished');
ok('…as completed, not exited', (() => { const s = getTutorialState(); return s.status === 'finished' && s.outcome === 'completed'; })());
eq('…and fires no tutorial_exited', named('tutorial_exited').length, 0);
ok('activeRun clears when the run ends', getActiveTutorialId() === null);
ok('isTutorialActive() is false once finished', !isTutorialActive());

// ── 4. Walking out ──────────────────────────────────────────────────────────
console.log('\nwalking out:');
__resetTutorialStoreForTest();
bootDfr();
clearEvents();
endTutorial('esc');
eq('endTutorial with no host exits directly, once', named('tutorial_exited').length, 1);
eq('…with the reason and the step', [named('tutorial_exited')[0]?.props.reason, named('tutorial_exited')[0]?.props.step_id], ['esc', 'dfr-voice']);
clearEvents();
endTutorial('skip');
eq('ending twice fires nothing more', events.length, 0);

// ── 5. RESTORE: not a start, not tagged ─────────────────────────────────────
console.log('\nrestore:');
__resetTutorialStoreForTest();
clearEvents();
const saved: SavedActiveRun = { tutorialId: 'punch-walk', version: 1, stepIndex: 0, sandboxProjectId: SB, entry: 'hub', savedAt: now() - 1000 };
d({ type: 'RESTORE', saved, sampleExists: true, now: now() });
ok('a restored run is running and paused', (() => { const s = getTutorialState(); return s.status === 'running' && !!s.paused && s.paused.reason === 'restored'; })());
eq('RESTORE fires no tutorial_started', named('tutorial_started').length, 0);
ok('a restored, paused run does NOT tag analytics as in_tutorial', getActiveTutorialId() === null);
ok('…and its sample chip is not active (signals would be dropped)', !tutorialStepActive(getTutorialState(), getTutorialDefs(), 'punch-photo'));
// A restored run carries NO pass (integration review): it never auto-resumes
// and never times out, so a pass here kept Business / Pro screens open on the
// sample all session with no tutorial on screen. The pill's Resume pushes the
// step's screen and dispatches RESUME in the same tick, so the pass is back
// before that screen renders — no Paywall flash.
ok('a restored run carries no practice pass (only Resume brings it back)', !tutorialPracticeAllows(SB, 'punch_list_closeout'));
d({ type: 'RESUME', now: now() });
ok('RESUME tags the run again', getActiveTutorialId() === 'punch-walk');
ok('…and brings the pass back', tutorialPracticeAllows(SB, 'punch_list_closeout'));

// ── 6. The practice pass through the store ──────────────────────────────────
console.log('\npractice pass:');
__resetTutorialStoreForTest();
d({ type: 'START', tutorialId: 'punch-walk', sandboxProjectId: SB, entry: 'paywall', now: now() });
ok('opens the listed feature on the sandbox', tutorialPracticeAllows(SB, 'punch_list_closeout'));
ok('never on another project', !tutorialPracticeAllows(OTHER, 'punch_list_closeout'));
ok('never a feature the def does not list', !tutorialPracticeAllows(SB, 'change_orders_invoicing'));
d({ type: 'EXIT', reason: 'skip', now: now() });
ok('holds through the 1.5 s grace after the run ends', tutorialPracticeAllows(SB, 'punch_list_closeout'));
__resetTutorialStoreForTest();
d({ type: 'START', tutorialId: 'punch-walk', sandboxProjectId: SB, entry: 'paywall', now: now() - 5000 });
d({ type: 'EXIT', reason: 'skip', now: now() - 2000 });
ok('gone once the grace has passed', !tutorialPracticeAllows(SB, 'punch_list_closeout'));
__resetTutorialStoreForTest();
d({ type: 'START', tutorialId: 'daily-report-voice', sandboxProjectId: SB, entry: 'hub', now: now() });
ok('a free tutorial opens nothing', !tutorialPracticeAllows(SB, 'punch_list_closeout') && !tutorialPracticeAllows(SB, 'change_orders_invoicing'));
__resetTutorialStoreForTest();

// ── 7. Progress blob ────────────────────────────────────────────────────────
console.log('\nprogress:');
eq('garbage string parses to EMPTY', parseTutorialProgress('{not json'), EMPTY_PROGRESS);
eq('null parses to EMPTY', parseTutorialProgress(null), EMPTY_PROGRESS);
eq('a wrong version parses to EMPTY', parseTutorialProgress({ v: 2, byId: {}, chips: {} }), EMPTY_PROGRESS);
eq('a bad status parses to EMPTY', parseTutorialProgress({ v: 1, byId: { 'punch-walk': { status: 'done', version: 1 } }, chips: {} }), EMPTY_PROGRESS);
const good: TutorialProgress = {
  v: 1,
  byId: { 'punch-walk': { status: 'practised', version: 1, bestMs: 42000 } },
  chips: { 'invoice-to-self': { dismissedAt: '2026-09-23T00:00:00.000Z' } },
  active: { tutorialId: 'invoice-to-self', version: 1, stepIndex: 0, sandboxProjectId: SB, entry: 'chip', returnTo: '/invoice?projectId=real-9', savedAt: 5 },
  lastChipDay: '2026-09-23',
};
eq('a valid blob round-trips through JSON', parseTutorialProgress(JSON.stringify(good)), good);
const withUnknown = { ...good, byId: { ...good.byId, 'gone-tutorial': { status: 'practised', version: 1 } } };
eq('an id this build does not know is dropped, the rest kept', parseTutorialProgress(withUnknown).byId, good.byId);
eq('a saved run naming an unknown tutorial is refused', parseTutorialProgress({ ...good, active: { ...good.active, tutorialId: 'gone-tutorial' } }), EMPTY_PROGRESS);

const iso = '2026-09-23T12:00:00.000Z';
let p = withStarted(EMPTY_PROGRESS, 'daily-report-voice', 1, iso);
eq('start marks in_progress', p.byId['daily-report-voice']?.status, 'in_progress');
const act: SavedActiveRun = { tutorialId: 'daily-report-voice', version: 1, stepIndex: 0, sandboxProjectId: SB, entry: 'onboarding', savedAt: 1 };
p = withCheckpoint(p, act, 'dfr-voice');
ok('a checkpoint saves the run and the step', p.active?.tutorialId === 'daily-report-voice' && p.byId['daily-report-voice']?.checkpointStepId === 'dfr-voice');
p = withPractised(p, 'daily-report-voice', 1, iso, 34000);
ok('the finale marks practised and drops the saved run', p.byId['daily-report-voice']?.status === 'practised' && p.active === undefined);
eq('…with the measured bestMs', p.byId['daily-report-voice']?.bestMs, 34000);
ok('…and no stale checkpoint', p.byId['daily-report-voice']?.checkpointStepId === undefined);
p = withPractised(p, 'daily-report-voice', 1, iso, 50000);
eq('a slower replay keeps the best time', p.byId['daily-report-voice']?.bestMs, 34000);
p = withPractised(p, 'daily-report-voice', 1, iso, null);
eq('an unmeasured replay leaves the best time', p.byId['daily-report-voice']?.bestMs, 34000);
p = withStarted(p, 'daily-report-voice', 1, iso);
eq('replaying a practised tutorial keeps it practised', p.byId['daily-report-voice']?.status, 'practised');
p = withExited(p, 'daily-report-voice', 1, iso);
eq('exiting a replay keeps it practised', p.byId['daily-report-voice']?.status, 'practised');
let q = withStarted(EMPTY_PROGRESS, 'punch-walk', 1, iso);
q = withCheckpoint(q, { ...act, tutorialId: 'punch-walk' }, 'punch-photo');
q = withExited(q, 'punch-walk', 1, iso);
ok('walking out of a new tutorial marks it exited and drops its saved run', q.byId['punch-walk']?.status === 'exited' && q.active === undefined);
const other = withCheckpoint(EMPTY_PROGRESS, { ...act, tutorialId: 'invoice-to-self' }, 'invoice-percent');
ok('exiting one tutorial keeps ANOTHER tutorial\'s saved run', withExited(other, 'punch-walk', 1, iso).active?.tutorialId === 'invoice-to-self');
ok('withoutActive drops the saved run', withoutActive(other).active === undefined);
const chipCtx = { tutorialId: 'punch-walk' as const, persona: 'contractor' as const, fieldOnly: false, projectIsSample: false, screenOpened: true, midDraft: false, keyboardUp: false, runActive: false, today: '2026-09-23' };
ok('a fresh user is offered the chip', shouldOfferChip(EMPTY_PROGRESS, chipCtx));
ok('an exited tutorial is never chip-offered again', !shouldOfferChip(q, chipCtx));
ok('a shown chip is not shown again', !shouldOfferChip(withChipShown(EMPTY_PROGRESS, 'punch-walk', iso, '2026-09-22'), chipCtx));
ok('one chip per day across the app', !shouldOfferChip(withChipShown(EMPTY_PROGRESS, 'invoice-to-self', iso, '2026-09-23'), chipCtx));
ok('× is forever', !shouldOfferChip(withChipDismissed(EMPTY_PROGRESS, 'punch-walk', iso), { ...chipCtx, today: '2027-01-01' }));

// Coach visibility (the Brain FAB and offer chips hide on it, spec §16).
const pres = (view: typeof EMPTY_PRESENTATION.view) => ({ ...EMPTY_PRESENTATION, view });
ok('the FAB may show while the coach is hidden', !tutorialCoachVisible(pres({ kind: 'hidden' })));
ok('…and under the paused pill (he is doing his own thing)', !tutorialCoachVisible(pres({ kind: 'paused', reason: 'offroute', onSample: true })));
ok('the coach hides the FAB for a spotlight, a card, the stamp and the finale', [
  pres({ kind: 'spotlight', layer: 'root', stepId: 's', targetId: 't', rect: { x: 0, y: 0, w: 1, h: 1 } }),
  pres({ kind: 'card', reason: 'missing', layer: 'root', stepId: 's' }),
  pres({ kind: 'celebrate', layer: 'root', stepId: 's' }),
  pres({ kind: 'finale' }),
].every(tutorialCoachVisible));

// ── Host rules (review round 1) ─────────────────────────────────────────────
console.log('\nhost rules:');
// react-native-web's isScreenReaderEnabled() always resolves true.
ok('the web never reads as a screen reader (RNW always says true)', screenReaderFrom('web', true) === false);
ok('iOS / Android keep the real answer', screenReaderFrom('ios', true) === true && screenReaderFrom('android', false) === false);

const key = (over: Partial<Parameters<typeof tutorialWebKeyAction>[0]>) =>
  tutorialWebKeyAction({ key: 'Escape', coachVisible: true, textFieldFocused: false, focusInCoach: false, defaultPrevented: false, lookStepLive: false, ...over });
eq('Esc exits while the coach is on screen', key({}), 'exit');
eq('Esc with a field focused only blurs it', key({ textFieldFocused: true }), 'blur');
eq('Esc under a hidden wait step (the send sheet) does nothing — Esc is closing THAT sheet', key({ coachVisible: false }), null);
eq('…nor with a field focused while hidden', key({ coachVisible: false, textFieldFocused: true }), null);
eq('Enter is Next on a live look step', key({ key: 'Enter', lookStepLive: true }), 'next');
eq('Enter never fakes a do step', key({ key: 'Enter', lookStepLive: false }), null);
eq('Enter inside the card is the card\'s own (no double Next)', key({ key: 'Enter', lookStepLive: true, focusInCoach: true }), null);
eq('Enter in a text field is typing', key({ key: 'Enter', lookStepLive: true, textFieldFocused: true }), null);
eq('Enter already handled is left alone', key({ key: 'Enter', lookStepLive: true, defaultPrevented: true }), null);
eq('Enter while paused / hidden does nothing', key({ key: 'Enter', lookStepLive: true, coachVisible: false }), null);
eq('other keys do nothing', key({ key: 'a' }), null);
// Round 2: a debounced typing signal (punch.description.filled, invoice.amount.set)
// starts the next step mid-word; focus must not leave the field he types in.
console.log('\nweb focus on step entry:');
eq('look step, nothing typed → focus Next', webFocusMove({ stepKind: 'look', textFieldFocused: false }), 'next');
eq('do step, nothing typed → focus the real control', webFocusMove({ stepKind: 'do', textFieldFocused: false }), 'target');
eq('typing, then a do step (punch.save after the description) → focus stays in the field', webFocusMove({ stepKind: 'do', textFieldFocused: true }), null);
eq('typing, then a look step (invoice.totals after the %) → focus stays in the field', webFocusMove({ stepKind: 'look', textFieldFocused: true }), null);
eq('typing, then a wait step → focus stays in the field', webFocusMove({ stepKind: 'wait', textFieldFocused: true }), null);
{
  // Source pin: the host's only two focusWithRing(...) moves are both behind webFocusMove.
  const host = readFileSync(join(__dirname, '..', 'components', 'tutorial', 'TutorialHost.tsx'), 'utf8');
  const calls = host.split('focusWithRing(').length - 1 - 1; // minus the definition
  ok('(host) exactly two focus moves', calls === 2, `found ${calls}`);
  ok('(host) the step-entry focus is decided by webFocusMove', /const move = webFocusMove\(\{ stepKind: step\.kind, textFieldFocused: typing\(\) \}\)/.test(host));
  ok('(host) the do-step focus only runs when move === \'target\'', /else if \(move === 'target'\) \{[\s\S]{0,400}?focusWithRing\(/.test(host));
  // Measurement liveness (integration review): a node that never answers
  // measureInWindow held a sequential chain past the next poll tick, which
  // superseded it forever — the coach froze on the previous step.
  const pollMs = Number(/const POLL_MS = (\d+);/.exec(host)?.[1]);
  const measureMs = Number(/const MEASURE_TIMEOUT_MS = (\d+);/.exec(host)?.[1]);
  ok('(host) one node\'s measure budget is below the poll interval', measureMs > 0 && pollMs > 0 && measureMs < pollMs, `measure ${measureMs} poll ${pollMs}`);
  ok('(host) measureNode uses that budget', /resolve\(null\); \} \}, MEASURE_TIMEOUT_MS\);/.test(host));
  ok('(host) the layer and the whole target chain are measured in parallel', /await Promise\.all\(\[\s*measureNode\(layer\?\.node\),\s*\.\.\.chain\.map\(id => measureNode\(getTutorialTarget\(id\)\?\.node\)\),\s*\]\)/.test(host)
    && !/for \(const id of targetChain\(step\)\) \{\s*const t = getTutorialTarget\(id\);\s*const r = await/.test(host));
  ok('(host) the poll never supersedes a measurement in flight', /if \(ui\.measureInFlight !== 0\) return;/.test(host));
  ok('(host) the finale\'s handoff Paywall reports source tutorial_handoff', /<Paywall[\s\S]{0,300}?requiredTier=\{REQUIRED_TIER\[paywall\]\}\s*source="tutorial_handoff"/.test(host));
  ok('(host) the deferred Next focus re-checks the rule', /webFocusMove\(\{ stepKind: 'look', textFieldFocused: typing\(\) \}\) !== 'next'\) return;\s*focusWithRing\(/.test(host));
}
// The paused and hidden presentations are exactly the ones the host feeds as coachVisible:false.
ok('the paused pill is not "coach on screen" for Esc', !tutorialCoachVisible(pres({ kind: 'paused', reason: 'restored', onSample: false })));

ok('X / Skip marks a tutorial exited', exitMarksExited('skip'));
ok('Esc marks a tutorial exited', exitMarksExited('esc'));
ok('no involuntary exit marks it exited', (['boot_failed', 'sample_gone', 'offroute_timeout', 'background', 'persona_changed', 'signed_out'] as const).every(r => !exitMarksExited(r)));
ok('no reason is not a walk-out', !exitMarksExited(undefined));
let ip = withStarted(EMPTY_PROGRESS, 'punch-walk', 1, iso);
ip = withCheckpoint(ip, { ...act, tutorialId: 'punch-walk' }, 'punch-photo');
ip = withInterrupted(ip, 'punch-walk');
ok('an interrupted run drops its saved run and checkpoint but is NOT exited', ip.active === undefined && ip.byId['punch-walk']?.status === 'in_progress' && ip.byId['punch-walk']?.checkpointStepId === undefined);
ok('…so its chip is still offered', shouldOfferChip(ip, chipCtx));
ok('interrupting one tutorial keeps another\'s saved run', withInterrupted(other, 'punch-walk').active?.tutorialId === 'invoice-to-self');

// Android: the camera is an out-of-process activity that backgrounds the app.
__resetTutorialStoreForTest();
d({ type: 'START', tutorialId: 'punch-walk', sandboxProjectId: SB, entry: 'hub', now: now() });
d({ type: 'ROUTE', pathname: '/punch-walk', params: { projectId: SB }, now: now() });
d({ type: 'BOOTED', flags: { samplePlan: true, mic: true }, mounted: [], now: now() });
const onPhoto = getTutorialState();
ok('(setup) the punch run waits on the photo step', R(onPhoto).stepIndex === 0 && R(onPhoto).phase === 'step');
ok('Android: an hour in the camera on the photo step is not a pause', !androidAwayIsPause(onPhoto, getTutorialDefs(), 60 * 60_000));
tutorialSignal('punch.photo.added', { projectId: SB, source: 'camera' });
ok('…and the photo that comes back completes the step', R(getTutorialState()).stepIndex > 0);
const pastPhoto = getTutorialState();
ok('Android: a short trip away is not a pause', !androidAwayIsPause(pastPhoto, getTutorialDefs(), ANDROID_BACKGROUND_GRACE_MS - 1));
ok('Android: a long trip away on a non-media step is a pause', androidAwayIsPause(pastPhoto, getTutorialDefs(), ANDROID_BACKGROUND_GRACE_MS));
ok('Android: idle is never a pause', !androidAwayIsPause(IDLE, getTutorialDefs(), 10 * ANDROID_BACKGROUND_GRACE_MS));
__resetTutorialStoreForTest();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
