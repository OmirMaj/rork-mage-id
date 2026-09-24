// utils/tutorial/store.ts — the live tutorial run, as a module store.
//
// WHY A MODULE STORE AND NOT A CONTEXT. Screens all over the app call
// tutorialSignal() from their save handlers and wrap controls in
// <TutorialTarget>, and a PlanPinStep modal renders its own layer. A context
// would have to sit above all of them in app/_layout.tsx's 16-provider stack,
// and a provider in the wrong place fails at runtime ("must be used within").
// A module store has no position: React 19's useSyncExternalStore reads it
// from anywhere, and only the components that subscribe re-render. The same
// reasoning (and pattern) as components/brain/brainFabState.ts.
//
// WHAT LIVES HERE
//   • the RunState and dispatch() → machine.reduceTutorial, plus the
//     analytics that fall out of a transition (tutorial_* events) and the
//     activeRun id analytics.ts tags every event with;
//   • the screen-facing API: tutorialSignal, useTutorialPractice,
//     useTutorialStepActive, useTutorialAssist, isTutorialActive,
//     startTutorial / endTutorial (delegated to the mounted host);
//   • the registries the host measures from: targets, layers, scroll anchors;
//   • the presentation snapshot the host computes and the layers draw.
//
// IDLE COST. When no run is live, tutorialSignal returns at once, a target
// registration is one Map write, and nothing here starts a timer.
//
// No react-native import: this file (and machine / practicePass beneath it)
// runs under bun in scripts/validate-tutorial-store.ts.

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { useProjects } from '@/contexts/ProjectContext';
import type {
  AssistId,
  BootFlags,
  CoachView,
  ExitReason,
  FeatureKey,
  Gesture,
  LayerId,
  Rect,
  RunState,
  SignalName,
  SignalPayload,
  Size,
  StartCtx,
  StepKind,
  TargetId,
  TutorialDef,
  TutorialDefs,
  TutorialEntry,
  TutorialEvent,
  TutorialId,
} from './types';
import { IDLE, currentStep, reduceTutorial, signalEvent, targetChain } from './machine';
import { TUTORIAL_DEFS } from './defs';
import { TUTORIAL_PRACTICE_PASS, PRACTICE_GRACE_MS, practiceFeatures } from './practicePass';
import { setActiveTutorialId } from './activeRun';
import { measuredMs } from './stats';
import { track } from '@/utils/analytics';

// ── Run state ───────────────────────────────────────────────────────────────

let state: RunState = IDLE;
let defs: TutorialDefs = TUTORIAL_DEFS;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of Array.from(listeners)) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

export function getTutorialState(): RunState {
  return state;
}

export function getTutorialDefs(): TutorialDefs {
  return defs;
}

/** Facts the host knows and the store does not (it has no React / RN).
 *  Only tutorial_started reads them. */
export interface TutorialHostFacts {
  platform: string;
  persona: string | null;
  tier: string | null;
}
let hostFacts: TutorialHostFacts = { platform: 'unknown', persona: null, tier: null };
export function setTutorialHostFacts(f: TutorialHostFacts): void {
  hostFacts = f;
}

/** Called after every state change (host-registered: progress persistence).
 *  Kept out of the store so the store stays storage-free under bun. */
type TransitionListener = (prev: RunState, next: RunState, event: TutorialEvent) => void;
const transitionListeners = new Set<TransitionListener>();
export function subscribeTutorialTransitions(fn: TransitionListener): () => void {
  transitionListeners.add(fn);
  return () => { transitionListeners.delete(fn); };
}

let graceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The one way state changes. Reduces, then derives the side effects of the
 * transition by DIFFING prev and next — never from the event alone, so an
 * event the machine ignored (a foreign-project signal, NEXT on a do step)
 * produces no analytics at all.
 */
export function dispatchTutorial(event: TutorialEvent): RunState {
  const prev = state;
  const next = reduceTutorial(prev, event, defs);
  if (next === prev) return prev;
  state = next;
  // analytics.ts tags every event with the live tutorial. A RESTORED run is
  // a saved run waiting on the pill, not one he is doing — tagging a day of
  // real work 'in_tutorial' would poison the Activation funnel.
  setActiveTutorialId(next.status === 'running' && !(next.paused && next.paused.reason === 'restored') ? next.tutorialId : null);
  try {
    trackTransition(prev, next, event);
  } catch (err) {
    // Analytics must never break a run.
    console.warn('[tutorial] analytics failed', err);
  }
  for (const fn of Array.from(transitionListeners)) {
    try { fn(prev, next, event); } catch (err) { console.warn('[tutorial] transition listener failed', err); }
  }
  // After a run ends the practice pass holds for PRACTICE_GRACE_MS (the host
  // pops the gated screen inside it). Nothing else changes state when the
  // grace runs out, so wake the subscribers once it has, or a screen would
  // keep the pass until its next unrelated re-render.
  if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
  if (next.status === 'finished') {
    graceTimer = setTimeout(() => { graceTimer = null; emit(); }, PRACTICE_GRACE_MS + 20);
  }
  emit();
  return next;
}

// A plain boolean, not a `next is RunningState` guard: a guard's false branch
// would narrow `next` to never-running, and the step analytics below read it.
function isNewRun(prev: RunState, next: RunState): boolean {
  if (next.status !== 'running') return false;
  if (prev.status !== 'running') return true;
  return prev.tutorialId !== next.tutorialId || prev.startedAt !== next.startedAt;
}

function trackTransition(prev: RunState, next: RunState, event: TutorialEvent): void {
  if (next.status === 'running' && isNewRun(prev, next)) {
    const def = defs[next.tutorialId];
    if (event.type === 'START') {
      track('tutorial_started', {
        tutorial_id: next.tutorialId,
        version: next.version,
        entry: next.entry,
        platform: hostFacts.platform,
        persona: hostFacts.persona ?? undefined,
        tier: hostFacts.tier ?? undefined,
        practice_pass: TUTORIAL_PRACTICE_PASS && !!def && def.practiceFeatures.length > 0,
      });
    }
    // A RESTORE is not a start — it is a saved run coming back paused.
    return;
  }

  if (next.status === 'running' && prev.status === 'running') {
    // Every newly logged completion, whatever event produced it (a signal, a
    // NEXT, a skip, or a RESUME that settled on a route goal).
    for (let i = prev.log.length; i < next.log.length; i += 1) {
      const e = next.log[i];
      track('tutorial_step_completed', {
        tutorial_id: next.tutorialId,
        step_id: e.stepId,
        step_index: e.stepIndex,
        ms: e.ms,
        via: e.via,
      });
    }
    const step = currentStep(next, defs);
    if (!prev.stuck && next.stuck && step) {
      track('tutorial_stuck', { tutorial_id: next.tutorialId, step_id: step.id });
    }
    if (!prev.targetMissing && next.targetMissing && step) {
      track('tutorial_target_missing', {
        tutorial_id: next.tutorialId,
        step_id: step.id,
        target_id: targetChain(step)[0] ?? step.layer ?? 'none',
      });
    }
    if (next.assists.length > prev.assists.length) {
      const a = next.assists[next.assists.length - 1];
      track('tutorial_assist_used', { tutorial_id: next.tutorialId, step_id: a.stepId, assist_id: a.assistId });
    }
    if (prev.phase !== 'finale' && next.phase === 'finale') {
      const def = defs[next.tutorialId];
      const stat = def ? measuredMs(def, next) : null;
      track('tutorial_completed', {
        tutorial_id: next.tutorialId,
        ms: stat ?? Math.max(0, (next.finaleAt ?? event.now) - next.startedAt),
        skipped_steps: next.skipped.length,
      });
    }
    return;
  }

  // tutorial_exited only for a run he walked out of. The finale's X records
  // 'completed' (machine EXIT rule) and tutorial_completed already fired.
  if (prev.status === 'running' && next.status === 'finished' && next.outcome === 'exited') {
    track('tutorial_exited', {
      tutorial_id: next.tutorialId,
      step_id: next.atStepId ?? undefined,
      reason: next.reason,
    });
  }
}

/** Test seam: swap the defs and reset to idle. Never called by the app. */
export function __resetTutorialStoreForTest(testDefs: TutorialDefs = TUTORIAL_DEFS): void {
  defs = testDefs;
  state = IDLE;
  setActiveTutorialId(null);
  if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
  startCtx = null;
  emit();
}

// ── Sandbox handlers (the data lane plugs in here) ─────────────────────────
// The host resolves the sample by name and seeds Sarah's Place itself. What
// needs real side effects beyond that — uploading the bundled A-101 plan
// through utils/addFloorPlan, patching the estimate lines onto an old sample,
// seeding the schedule example — lives in utils/tutorial/sandbox.ts, which
// registers here so the host does not depend on its exact exports.

type ProjectsApi = ReturnType<typeof useProjects>;

export interface TutorialSandboxHandlers {
  /** Return the sandbox project id (resolving or seeding it), or null to fall
   *  back to the host's own resolve-by-name / seed. */
  resolveSample?: (args: { def: TutorialDef; projects: ProjectsApi | null }) => Promise<string | null>;
  /** Top the sample up for def.needs. samplePlan:false auto-skips the pin
   *  steps. Budget: 9 s, after which the host assumes samplePlan:false. */
  ensureNeeds?: (args: { def: TutorialDef; sandboxProjectId: string; projects: ProjectsApi | null }) => Promise<Partial<BootFlags>>;
}

let sandboxHandlers: TutorialSandboxHandlers = {};
export function setTutorialSandboxHandlers(h: TutorialSandboxHandlers): void {
  sandboxHandlers = { ...sandboxHandlers, ...h };
}
export function getTutorialSandboxHandlers(): TutorialSandboxHandlers {
  return sandboxHandlers;
}

// ── Per-run facts the host resolved at start ────────────────────────────────

let startCtx: StartCtx | null = null;
/** The report day etc. the host resolved when it booted this run; the copy
 *  (stamp's 'Tue Sep 23') and the paused pill's Resume read it. */
export function setTutorialStartCtx(ctx: StartCtx | null): void {
  startCtx = ctx;
}
export function getTutorialStartCtx(): StartCtx | null {
  return startCtx;
}

// ── Screen-facing API ───────────────────────────────────────────────────────

/** True while a run is live (running, including paused and the finale). */
export function isTutorialActive(): boolean {
  return state.status === 'running';
}

/**
 * A screen's success point, reported. Call it in the SCREEN handler right
 * after the real success (never from a ProjectContext setter — the demo seed
 * calls those). A no-op when idle; the machine ignores it unless it names the
 * run's sandbox project and matches the current or a later step.
 */
export function tutorialSignal<N extends SignalName>(name: N, payload: SignalPayload<N>): void {
  if (state.status !== 'running') return;
  dispatchTutorial(signalEvent(name, payload, Date.now()));
}

export interface StartTutorialOpts {
  entry: TutorialEntry;
  /** The sample to run on. Omitted → the host resolves (or seeds) it. */
  sandboxProjectId?: string | null;
  /** Where Done / exit returns to (the chip's real screen). */
  returnTo?: string | null;
}

type Starter = (id: TutorialId, opts: StartTutorialOpts) => Promise<boolean>;
type Ender = (reason: ExitReason) => void;
let starter: Starter | null = null;
let ender: Ender | null = null;

/** Host-only: TutorialHost owns navigation, seeding and the boot sequence. */
export function registerTutorialHost(s: Starter, e: Ender): () => void {
  starter = s;
  ender = e;
  return () => {
    if (starter === s) starter = null;
    if (ender === e) ender = null;
  };
}

/** Start (or, for a paused run of the same tutorial, resume) a tutorial.
 *  Resolves false when no host is mounted or the boot failed. */
export function startTutorial(id: TutorialId, opts: StartTutorialOpts): Promise<boolean> {
  if (!starter) return Promise.resolve(false);
  return starter(id, opts);
}

/** End the live run. The host pops any practice-gated screen first so no
 *  Paywall flashes as the pass clears. */
export function endTutorial(reason: ExitReason = 'skip'): void {
  if (state.status !== 'running') return;
  if (ender) ender(reason);
  else dispatchTutorial({ type: 'EXIT', reason, now: Date.now() });
}

/**
 * Read a slice of the run. `selector` should return a primitive or a value
 * derived only from the state object: the result is cached per state
 * identity, so an unchanged run never re-renders the caller.
 */
export function useTutorialRun<T>(selector: (s: RunState) => T): T {
  const cache = useRef<{ s: RunState; sel: (s: RunState) => T; v: T } | null>(null);
  const get = useCallback(() => {
    const c = cache.current;
    if (c && c.s === state && c.sel === selector) return c.v;
    const v = selector(state);
    cache.current = { s: state, sel: selector, v };
    return v;
  }, [selector]);
  return useSyncExternalStore(subscribe, get, get);
}

/** The features the practice pass opens on `projectId` right now (spec §11).
 *  Empty when idle, on any other project, or with the pass switched off. */
export function useTutorialPractice(projectId: string | null | undefined): Set<FeatureKey> {
  const get = useCallback(() => practiceFeatures(state, projectId, Date.now(), defs).join(','), [projectId]);
  const key = useSyncExternalStore(subscribe, get, get);
  return useMemo(() => new Set((key ? key.split(',') : []) as FeatureKey[]), [key]);
}

/** Non-hook read of the same rule, for handlers. */
export function tutorialPracticeAllows(projectId: string | null | undefined, feature: FeatureKey): boolean {
  return practiceFeatures(state, projectId, Date.now(), defs).includes(feature);
}

/** True while `stepId` is the current step and signals would count — so a
 *  screen shows its sample chip only during that step. */
export function tutorialStepActive(s: RunState, d: TutorialDefs, stepId: string): boolean {
  if (s.status !== 'running' || s.phase !== 'step') return false;
  if (s.paused && s.paused.reason !== 'offroute') return false;
  return currentStep(s, d)?.id === stepId;
}

export function useTutorialStepActive(stepId: string): boolean {
  const get = useCallback(() => tutorialStepActive(state, defs, stepId), [stepId]);
  return useSyncExternalStore(subscribe, get, get);
}

/** The sandbox project of the live run, or null. */
export function useTutorialSandboxId(): string | null {
  const get = useCallback(() => (state.status === 'running' ? state.sandboxProjectId : null), []);
  return useSyncExternalStore(subscribe, get, get);
}

// ── Assists ('Do it for me') ───────────────────────────────────────────────

const assists = new Map<AssistId, () => void>();

/**
 * Register a screen-owned helper for 'Do it for me': fill an input, pick the
 * bundled media, drop the pin. It NEVER presses Save, Send or Apply — the
 * real action stays the user's, and the step still completes on the real
 * signal. The latest `fn` is always the one run.
 */
export function useTutorialAssist(id: AssistId, fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const call = () => ref.current();
    assists.set(id, call);
    return () => { if (assists.get(id) === call) assists.delete(id); };
  }, [id]);
}

export function hasTutorialAssist(id: AssistId): boolean {
  return assists.has(id);
}

/** Host / card: record the assist, then run it. */
export function runTutorialAssist(id: AssistId): boolean {
  const fn = assists.get(id);
  if (!fn) return false;
  dispatchTutorial({ type: 'ASSIST', assistId: id, now: Date.now() });
  try { fn(); } catch (err) { console.warn('[tutorial] assist failed', id, err); }
  return true;
}

// ── Target, layer and scroll-anchor registries ─────────────────────────────
// Refs, not state: registering causes no re-render anywhere. The host reads
// them when it measures.

/** Anything with the host-component measuring API (a View ref on native, the
 *  DOM-backed host instance on react-native-web). */
export interface MeasurableNode {
  measureInWindow(cb: (x: number, y: number, w: number, h: number) => void): void;
  measureLayout?: (
    relativeTo: MeasurableNode | number,
    onSuccess: (x: number, y: number, w: number, h: number) => void,
    onFail?: () => void,
  ) => void;
}

export interface ScrollAnchorEntry {
  /** The ScrollView (or FlatList) ref: scrollTo({ y }). */
  scrollTo: (y: number) => void;
  /** The content View the anchor renders: measureLayout target. */
  content: MeasurableNode | null;
}

interface TargetEntry {
  node: MeasurableNode | null;
  anchor: ScrollAnchorEntry | null;
  token: object;
}

const targets = new Map<string, TargetEntry>();

/**
 * Register a mounted <TutorialTarget>. Emits TARGET mounted while a run is
 * live (idle: a Map write, nothing else). One instance per id: a duplicate
 * warns in dev and the last registration wins.
 */
export function registerTutorialTarget(id: TargetId, token: object, node: MeasurableNode | null, anchor: ScrollAnchorEntry | null): void {
  const had = targets.get(id);
  if (had && had.token !== token && typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn(`[tutorial] two <TutorialTarget id="${id}"> are mounted; the last one wins.`);
  }
  targets.set(id, { node, anchor, token });
  if (!had && state.status === 'running') dispatchTutorial({ type: 'TARGET', id, mounted: true, now: Date.now() });
}

export function unregisterTutorialTarget(id: TargetId, token: object): void {
  const had = targets.get(id);
  if (!had || had.token !== token) return;
  targets.delete(id);
  if (state.status === 'running') dispatchTutorial({ type: 'TARGET', id, mounted: false, now: Date.now() });
}

export function getTutorialTarget(id: string): { node: MeasurableNode | null; anchor: ScrollAnchorEntry | null } | null {
  return targets.get(id) ?? null;
}

/** Every mounted target id (BOOTED takes this snapshot, sentinels included). */
export function mountedTutorialTargetIds(): string[] {
  return Array.from(targets.keys());
}

// Touching the real control hides the hand for 4 s.
const touchListeners = new Set<(id: string) => void>();
export function noteTutorialTargetTouch(id: string): void {
  if (state.status !== 'running') return;
  for (const l of Array.from(touchListeners)) l(id);
}
export function subscribeTutorialTargetTouch(fn: (id: string) => void): () => void {
  touchListeners.add(fn);
  return () => { touchListeners.delete(fn); };
}

const layers = new Map<LayerId, { node: MeasurableNode | null; size: Size | null; token: object }>();
const layerListeners = new Set<() => void>();
let layersSnapshot: readonly LayerId[] = ['root'];

function publishLayers(): void {
  const ids = Array.from(layers.keys());
  if (!ids.includes('root')) ids.unshift('root');
  const same = ids.length === layersSnapshot.length && ids.every(id => layersSnapshot.includes(id));
  if (!same) layersSnapshot = ids;
  for (const l of Array.from(layerListeners)) l();
}

/** A <TutorialLayer> mounted (host 'root' in the app root, the others inside
 *  their modals). `node` is null until the layer's fill view renders. */
export function registerTutorialLayer(host: LayerId, token: object, node: MeasurableNode | null, size: Size | null): void {
  const had = layers.get(host);
  if (had && had.token !== token && typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn(`[tutorial] two <TutorialLayer host="${host}"> are mounted; the last one wins.`);
  }
  layers.set(host, { node, size, token });
  publishLayers();
}

export function unregisterTutorialLayer(host: LayerId, token: object): void {
  const had = layers.get(host);
  if (!had || had.token !== token) return;
  layers.delete(host);
  publishLayers();
}

export function getTutorialLayer(host: LayerId): { node: MeasurableNode | null; size: Size | null } | null {
  return layers.get(host) ?? null;
}

/** Mounted layers ('root' always counts: its host is the app root). */
export function mountedTutorialLayers(): readonly LayerId[] {
  return layersSnapshot;
}

export function subscribeTutorialLayers(fn: () => void): () => void {
  layerListeners.add(fn);
  return () => { layerListeners.delete(fn); };
}

// ── Presentation (host → layers) ────────────────────────────────────────────
// The host turns (state, measurements, platform facts) into ONE snapshot; each
// layer draws only what names it. Separate from the run state because it
// changes on measurement (every 250 ms while a spotlight shows) and only the
// layers care.

export interface CelebratePresentation {
  title: string;
  sub: string;
}

export interface FinaleAction {
  key: string;
  label: string;
}

export interface FinalePresentation {
  title: string;
  stat: string | null;
  primary: FinaleAction | null;
  secondary: FinaleAction | null;
  chain: FinaleAction | null;
}

export interface TutorialPresentation {
  view: CoachView;
  stepId: string | null;
  stepKind: StepKind | null;
  text: string;
  detail: string;
  stepNumber: number;
  stepCount: number;
  next: boolean;
  skip: boolean;
  assist: AssistId | null;
  failureReason: string | null;
  gesture: Gesture;
  point: { x: number; y: number } | null;
  /** The target in layer coordinates (unpadded). */
  targetRect: Rect | null;
  /** Padded, clamped hole (placement.holeRect). */
  hole: Rect | null;
  holeRadius: number;
  keyboardH: number;
  screenReader: boolean;
  reduceMotion: boolean;
  pointerFine: boolean;
  web: boolean;
  celebrate: CelebratePresentation | null;
  finale: FinalePresentation | null;
  /** Epoch ms until which the hand stays hidden (a touch in the target). */
  handHiddenUntil: number;
  /** Bumped on a tap on the dim: the card shakes, the hand replays. */
  nudge: number;
  /** A short-lived line in the root layer ('Tutorial closed — …'). */
  toast: string | null;
}

export const EMPTY_PRESENTATION: TutorialPresentation = {
  view: { kind: 'hidden' },
  stepId: null,
  stepKind: null,
  text: '',
  detail: '',
  stepNumber: 0,
  stepCount: 0,
  next: false,
  skip: false,
  assist: null,
  failureReason: null,
  gesture: 'none',
  point: null,
  targetRect: null,
  hole: null,
  holeRadius: 14,
  keyboardH: 0,
  screenReader: false,
  reduceMotion: false,
  pointerFine: false,
  web: false,
  celebrate: null,
  finale: null,
  handHiddenUntil: 0,
  nudge: 0,
  toast: null,
};

let presentation: TutorialPresentation = EMPTY_PRESENTATION;
const presentationListeners = new Set<() => void>();

export function setTutorialPresentation(p: TutorialPresentation): void {
  if (p === presentation) return;
  presentation = p;
  for (const l of Array.from(presentationListeners)) l();
}

export function getTutorialPresentation(): TutorialPresentation {
  return presentation;
}

function subscribePresentation(fn: () => void): () => void {
  presentationListeners.add(fn);
  return () => { presentationListeners.delete(fn); };
}

export function useTutorialPresentation(): TutorialPresentation {
  return useSyncExternalStore(subscribePresentation, getTutorialPresentation, getTutorialPresentation);
}

/** True while the coach draws something he must read or reach — a spotlight,
 *  a card, the stamp or the finale (spec §16). The Brain FAB and the offer
 *  chips hide on it, so nothing competes with the one instruction on screen.
 *  A hidden view (a wait step, a modal up) and the paused pill do not count. */
export function tutorialCoachVisible(p: TutorialPresentation): boolean {
  const k = p.view.kind;
  return k === 'spotlight' || k === 'card' || k === 'celebrate' || k === 'finale';
}

const getCoachVisible = () => tutorialCoachVisible(presentation);

export function useTutorialCoachVisible(): boolean {
  return useSyncExternalStore(subscribePresentation, getCoachVisible, getCoachVisible);
}

// ── Host rules (pure; the host calls them, validate-tutorial-store pins them) ─

/** Whether to treat a screen reader as on. react-native-web's
 *  AccessibilityInfo.isScreenReaderEnabled() ALWAYS resolves true (a browser
 *  cannot tell), and trusting it put every web step into dim-less card mode:
 *  no hole, no ring, no hand, skip + assist from step 1. The web reads as off;
 *  its card is still a polite live region, so a real reader hears each step. */
export function screenReaderFrom(platform: string, reported: boolean): boolean {
  return platform === 'web' ? false : reported;
}

export type TutorialWebKeyAction = 'blur' | 'exit' | 'next' | null;

/**
 * What a window keydown means to the tutorial on the web.
 * - Only while the coach is ON SCREEN (spotlight, card, stamp, finale). A
 *   hidden wait step is him working in a sheet (Esc closes THAT sheet), and a
 *   paused or restored run has its own End on the pill: an Esc there must not
 *   silently end a saved tutorial and mark it never-offer-again.
 * - Esc with a text field focused only blurs it (he was dismissing typing).
 * - Enter is Next on a live look step only — never a fake action — and never
 *   when focus is in a field or inside the card itself (the card's own button
 *   answers Enter; handling it here too would skip TWO look steps).
 */
export function tutorialWebKeyAction(k: {
  key: string;
  coachVisible: boolean;
  textFieldFocused: boolean;
  focusInCoach: boolean;
  defaultPrevented: boolean;
  lookStepLive: boolean;
}): TutorialWebKeyAction {
  if (!k.coachVisible) return null;
  if (k.key === 'Escape') return k.textFieldFocused ? 'blur' : 'exit';
  if (k.key === 'Enter') {
    if (k.defaultPrevented || k.textFieldFocused || k.focusInCoach) return null;
    return k.lookStepLive ? 'next' : null;
  }
  return null;
}

/**
 * Where keyboard focus goes when a web step starts. One rule, no exceptions:
 * if he is typing in a text field, focus stays put.
 * Why: steps like punch.description and invoice.percent complete on a
 * DEBOUNCED typing signal, so the next step starts while his hands are still
 * on the keys. Moving focus then sent his next keystroke to the new control:
 * a Space on the focused walk-save "button" (RNW's PressResponder presses a
 * buttonish element on Space) really saved a truncated punch item, and the
 * '5' of "15" went to the Next button and the invoice billed 1 %. The ring and
 * card still move; only the caret stays where he is. (Deliberately not
 * "unless the field is inside the new target": the target's first focusable
 * can be a sibling chip, so that exception reopens the same hole.)
 * - look step → the card's Next (Enter on a focused tile would open it)
 * - do / wait step → the real control, so Enter / Space does the real thing
 */
export type TutorialWebFocusMove = 'next' | 'target' | null;
export function webFocusMove(k: { stepKind: 'do' | 'look' | 'wait'; textFieldFocused: boolean }): TutorialWebFocusMove {
  if (k.textFieldFocused) return null;
  return k.stepKind === 'look' ? 'next' : 'target';
}

/** Only a walk-out he chose (X / Skip, Esc) marks a tutorial 'exited', which
 *  means never chip-offered again. A failed offline boot, the sample vanishing,
 *  a timeout, a persona switch or sign-out just drop the saved run. */
export function exitMarksExited(reason: ExitReason | undefined): boolean {
  return reason === 'skip' || reason === 'esc';
}

/** Signals that arrive from an OUT-OF-PROCESS activity on Android (the camera
 *  / photo library background the app while they are up). */
export const MEDIA_SIGNALS: readonly SignalName[] = ['punch.photo.added'];
/** An Android trip out of the app shorter than this is not a pause. */
export const ANDROID_BACKGROUND_GRACE_MS = 2 * 60_000;

/**
 * Android, judged when the app comes BACK: should the time away count as a
 * background pause? Launching the camera or photo picker backgrounds the app
 * on Android (not on iOS, where they are presented in-process), and a pause
 * would drop the very punch.photo.added the step waits for. So: never while a
 * do step waits on a media signal, and never for a short trip. A long trip
 * becomes a pause dated from when he left, so the 60-minute auto-exit still
 * counts real abandonment.
 */
export function androidAwayIsPause(s: RunState, d: TutorialDefs, awayMs: number): boolean {
  if (s.status !== 'running' || s.phase === 'finale') return false;
  if (s.paused && s.paused.reason !== 'offroute') return false;
  const step = currentStep(s, d);
  const until = step?.until;
  if (s.phase === 'step' && step?.kind === 'do' && until && 'signal' in until && MEDIA_SIGNALS.includes(until.signal)) return false;
  return awayMs >= ANDROID_BACKGROUND_GRACE_MS;
}

/** The card / layer buttons, wired by the host. Plain functions so a layer in
 *  a modal can call them without a context above it. */
export interface TutorialUiActions {
  next(): void;
  skipStep(): void;
  assist(): void;
  exit(reason: ExitReason): void;
  celebrationDone(): void;
  dimPressed(): void;
  resume(): void;
  finaleAction(key: string): void;
}

const NOOP_ACTIONS: TutorialUiActions = {
  next: () => dispatchTutorial({ type: 'NEXT', now: Date.now() }),
  skipStep: () => dispatchTutorial({ type: 'SKIP_STEP', now: Date.now() }),
  assist: () => {},
  exit: reason => endTutorial(reason),
  celebrationDone: () => dispatchTutorial({ type: 'CELEBRATION_DONE', now: Date.now() }),
  dimPressed: () => {},
  resume: () => dispatchTutorial({ type: 'RESUME', now: Date.now() }),
  finaleAction: () => dispatchTutorial({ type: 'FINISH', now: Date.now() }),
};

let uiActions: TutorialUiActions = NOOP_ACTIONS;
export function setTutorialUiActions(a: TutorialUiActions | null): void {
  uiActions = a ?? NOOP_ACTIONS;
}
export function tutorialUi(): TutorialUiActions {
  return uiActions;
}
