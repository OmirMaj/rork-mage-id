// components/tutorial/TutorialHost.tsx — the tutorial engine's one mount.
//
// Mounted in app/_layout.tsx right after <BrainSurface/> and before
// <AlertHost/>, <NailItToastHost/> and <ConfettiHost/>, inside every provider
// (it reads auth, the plan, projects and the router). It renders the ROOT
// <TutorialLayer host="root" /> and owns everything that is not pure:
//
//   • the boot sequence: resolve or seed the sample, top it up for the
//     tutorial's needs, push the sample hub and the start screen, BOOTED;
//   • feeding the machine: ROUTE on every navigation, TARGET timeouts, STUCK,
//     the celebration timer, background PAUSE, the lifecycle EXITs (sign-out,
//     persona switch, the sample deleted, 10 min paused / 60 min backgrounded);
//   • measuring: target.measureInWindow − layer.measureInWindow, on step entry
//     then every 250 ms while a spotlight shows, and on keyboard / resize /
//     scroll; scroll-into-view on step entry;
//   • turning (state, measurements, platform facts) into the presentation
//     the layers draw, and wiring the card's buttons;
//   • persistence of progress (checkpoints and terminal states only);
//   • web: while the coach is on screen, Esc exits (the first Esc only blurs
//     a focused field) and Enter is Next on look steps only; focus moves to
//     the target on do steps and to the card's Next on look steps.
//
// IDLE COST (spec §16). With no run: the layer renders null, no timer or
// listener runs, and the only work is the data bridge mirroring a few values
// into a ref. Everything live is created when a run starts and torn down when
// it ends.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  Dimensions,
  Keyboard,
  Platform,
  type AppStateStatus,
} from 'react-native';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { REQUIRED_TIER } from '@/utils/featureTiers';
import { Tokens } from '@/constants/designTokens';
import { resolveStripeAccount } from '@/utils/stripeConnect';
import { showAlert } from '@/utils/alert';
import { track } from '@/utils/analytics';
import type {
  BootFlags,
  CoachEnv,
  CopyCtx,
  ExitReason,
  FeatureKey,
  LayerId,
  Rect,
  RouteParams,
  RunState,
  RunningState,
  SignalName,
  StartCtx,
  TutorialDef,
  TutorialId,
  TutorialPathname,
} from '@/utils/tutorial/types';
import {
  BACKGROUND_EXIT_MS,
  CELEBRATE_MS,
  OFFROUTE_EXIT_MS,
  STUCK_MS,
  TARGET_TIMEOUT_MS,
  autoExitReason,
  cardAffordances,
  coachView,
  currentStep,
  resumeTarget,
  routeMatches,
  stepCopy,
  successCopy,
  targetChain,
  toSavedActive,
} from '@/utils/tutorial/machine';
import { isBlockerTarget } from '@/utils/tutorial/registry';
import { SCROLL_MARGIN, holeRect, rectVisibleIn, scrollOffsetFor } from '@/utils/tutorial/placement';
import { handoffFor, type Handoff, type HandoffAction } from '@/utils/tutorial/handoff';
import { measuredMs, statLine } from '@/utils/tutorial/stats';
import { ensureTutorialSample, type SandboxDeps } from '@/utils/tutorial/sandbox';
import { TUTORIAL_PRACTICE_PASS } from '@/utils/tutorial/practicePass';
import {
  isFieldOnlyUser,
  localDay,
  sandboxStillValid,
  tutorialReportDay,
} from '@/utils/tutorial/sandboxCore';
import {
  EMPTY_PRESENTATION,
  dispatchTutorial,
  getTutorialDefs,
  getTutorialLayer,
  getTutorialPresentation,
  getTutorialStartCtx,
  getTutorialState,
  getTutorialTarget,
  getTutorialSandboxHandlers,
  hasTutorialAssist,
  mountedTutorialLayers,
  mountedTutorialTargetIds,
  registerTutorialHost,
  runTutorialAssist,
  setTutorialHostFacts,
  setTutorialPresentation,
  setTutorialStartCtx,
  setTutorialUiActions,
  subscribeTutorialLayers,
  subscribeTutorialTargetTouch,
  subscribeTutorialTransitions,
  androidAwayIsPause,
  exitMarksExited,
  screenReaderFrom,
  tutorialCoachVisible,
  tutorialWebKeyAction,
  webFocusMove,
  useTutorialRun,
  type FinalePresentation,
  type MeasurableNode,
  type StartTutorialOpts,
  type TutorialPresentation,
} from '@/utils/tutorial/store';
import {
  getTutorialProgress,
  loadTutorialProgress,
  resetTutorialProgressCache,
  updateTutorialProgress,
  withCheckpoint,
  withExited,
  withInterrupted,
  withPractised,
  withStarted,
  withoutActive,
} from '@/utils/tutorial/progress';
import { TutorialLayer } from './TutorialLayer';

// ── Constants ───────────────────────────────────────────────────────────────

const POLL_MS = 250;
/** One measurement's budget per node. It MUST stay below POLL_MS: a node that
 *  never answers measureInWindow (an unmounting native node) used to hold a
 *  measurement past the next poll tick, which superseded it, forever — the
 *  coach froze on the previous step and never reached 'Can't find it'. With
 *  the chain measured in parallel, a whole measurement ends inside this. */
const MEASURE_TIMEOUT_MS = 180;
const HAND_HIDE_MS = 4000;
const EXIT_TOAST_MS = 2600;
const EXIT_TOAST = 'Tutorial closed — replay it from Help → Tutorials';
const HOLE_RADIUS = Tokens.radius.md + 4;
/** Routes a new user is still inside while onboarding finishes; the boot
 *  waits for the navigator to leave them before pushing the sample. */
const FUNNEL_PATHS = new Set(['/onboarding', '/persona-select', '/login', '/signup']);
/** The only paths the host ever navigates to from a string it did not write
 *  (returnTo). Parsing into this typed set keeps every push cast-free. */
const KNOWN_PATHS: readonly TutorialPathname[] = ['/daily-report', '/punch-walk', '/invoice', '/project-detail', '/payments-setup', '/tutorials', '/'];

/** Paywall wording for a feature the practice pass opened (the Paywall takes
 *  a display name; featureTiers has no label table). */
const FEATURE_LABEL: Partial<Record<FeatureKey, string>> = {
  punch_list_closeout: 'Punch List & Closeout',
  change_orders_invoicing: 'Invoicing',
  client_portal: 'Client Portal',
  schedule_gantt_pdf: 'Schedule Pro',
};

type ProjectsApi = ReturnType<typeof useProjects>;

/** What the data bridge mirrors for the (non-React) controller. */
interface HostData {
  projects: ProjectsApi['projects'];
  projectsLoaded: boolean;
  userRole: ProjectsApi['userRole'];
  dailyReports: ProjectsApi['dailyReports'];
  api: ProjectsApi | null;
  userId: string | null;
  userEmail: string | null;
  isFree: boolean;
  tier: string | null;
  canAccess: (f: FeatureKey) => boolean;
}

const hostData: HostData = {
  projects: [],
  projectsLoaded: false,
  userRole: null,
  dailyReports: [],
  api: null,
  userId: null,
  userEmail: null,
  isFree: true,
  tier: null,
  canAccess: () => false,
};

// ── Small helpers ───────────────────────────────────────────────────────────

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function measureNode(node: MeasurableNode | null | undefined): Promise<Rect | null> {
  return new Promise(resolve => {
    if (!node || typeof node.measureInWindow !== 'function') { resolve(null); return; }
    let done = false;
    // measureInWindow on an unmounting native node may never call back.
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, MEASURE_TIMEOUT_MS);
    try {
      node.measureInWindow((x, y, w, h) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(Number.isFinite(x) && Number.isFinite(y) ? { x, y, w, h } : null);
      });
    } catch {
      done = true;
      clearTimeout(t);
      resolve(null);
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (cond()) return true;
    await sleep(60);
  }
  return cond();
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}

/** 'Tue Sep 23' from YYYY-MM-DD, in the device's zone. */
function dayLabel(ymd: string | null | undefined): string | null {
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  const wd = dt.toLocaleDateString('en-US', { weekday: 'short' });
  const md = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${wd} ${md}`;
}

function pointerIsFine(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try { return window.matchMedia('(pointer: fine)').matches; } catch { return false; }
}

/** returnTo is an href string the caller captured. Parse it into one of the
 *  typed paths the host knows; anything else is not navigated to. */
function parseReturnTo(href: string | null | undefined): { pathname: TutorialPathname; params: Record<string, string> } | null {
  if (!href) return null;
  const [path, query = ''] = href.split('?');
  const pathname = KNOWN_PATHS.find(p => p === path);
  if (!pathname) return null;
  const params: Record<string, string> = {};
  for (const part of query.split('&')) {
    if (!part) continue;
    const [k, v = ''] = part.split('=');
    try { params[decodeURIComponent(k)] = decodeURIComponent(v); } catch { /* skip a malformed pair */ }
  }
  return { pathname, params };
}

/** On the web, a View host instance IS the DOM element. */
function domElement(node: MeasurableNode | null | undefined): HTMLElement | null {
  if (Platform.OS !== 'web' || !node) return null;
  const el = node as unknown as { scrollIntoView?: unknown; querySelector?: unknown };
  return typeof el.scrollIntoView === 'function' && typeof el.querySelector === 'function' ? (node as unknown as HTMLElement) : null;
}

function isTextField(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable === true;
}

/** RNW renders testID as data-testid; the card is 'tutorial-coach-card'. */
function inCoachCard(el: Element | null): boolean {
  if (!el || typeof (el as HTMLElement).closest !== 'function') return false;
  return (el as HTMLElement).closest('[data-testid="tutorial-coach-card"]') !== null;
}

/** Focus an element with a ring that survives the browser's :focus-visible
 *  heuristic (a programmatic focus after a mouse click often draws none).
 *  currentColor keeps it on the element's own themed colour — no hex here.
 *  The ring comes off on blur, so it never lingers on a real control. */
function focusWithRing(el: HTMLElement | null): void {
  if (!el) return;
  try {
    el.focus({ preventScroll: true });
    const prevOutline = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = '2px solid currentColor';
    el.style.outlineOffset = '2px';
    el.addEventListener('blur', () => { el.style.outline = prevOutline; el.style.outlineOffset = prevOffset; }, { once: true });
  } catch { /* focus is a nicety */ }
}

// ── The component ───────────────────────────────────────────────────────────

export function TutorialHost() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const running = useTutorialRun(s => s.status === 'running');
  const [paywall, setPaywall] = useState<FeatureKey | null>(null);

  // The latest router / route for the controller (it outlives renders).
  const routerRef = useRef(router);
  routerRef.current = router;
  const paramsKey = JSON.stringify(params);
  const routeRef = useRef<{ pathname: string; params: RouteParams }>({ pathname, params });

  useEffect(() => {
    routeRef.current = { pathname, params: params as RouteParams };
    if (getTutorialState().status === 'running') {
      dispatchTutorial({ type: 'ROUTE', pathname, params: params as RouteParams, now: Date.now() });
    }
  }, [pathname, paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps -- paramsKey stands for params

  // ── Presentation state that is not in the run ─────────────────────────────
  const ui = useRef({
    screenReader: false,
    reduceMotion: false,
    keyboardH: 0,
    pointerFine: pointerIsFine(),
    handHiddenUntil: 0,
    nudge: 0,
    toast: null as string | null,
    rects: {} as Partial<Record<string, Rect>>,
    measureSeq: 0,
    /** The seq of the measurement in flight, or 0. The poll skips a tick
     *  while one is running so it can never supersede it forever. */
    measureInFlight: 0,
    missingSince: null as number | null,
    scrolledStepKey: null as string | null,
    announcedStepKey: null as string | null,
    focusedStepKey: null as string | null,
    handoff: null as Handoff | null,
    handoffRunKey: null as string | null,
    stripeConnected: true,
    offeredChainKey: null as string | null,
    booting: false,
  }).current;

  const publish = useCallback(() => {
    setTutorialPresentation(buildPresentation(getTutorialState(), ui));
  }, [ui]);

  // ── Exit / resume / finale actions ────────────────────────────────────────

  const showToast = useCallback((text: string) => {
    ui.toast = text;
    publish();
    setTimeout(() => {
      if (ui.toast === text) { ui.toast = null; publish(); }
    }, EXIT_TOAST_MS);
  }, [ui, publish]);

  const exit = useCallback((reason: ExitReason) => {
    const s = getTutorialState();
    if (s.status !== 'running') return;
    const def = getTutorialDefs()[s.tutorialId];
    // Pop a practice-gated screen BEFORE the pass clears (it holds for the
    // 1.5 s grace), so the screen never re-renders into its Paywall. Not on
    // sign-out: the auth gate is replacing the whole stack already.
    if (def && s.phase !== 'finale' && reason !== 'signed_out' && TUTORIAL_PRACTICE_PASS && def.practiceFeatures.length > 0) {
      const r = routeRef.current;
      const gated = r.pathname === def.start.pathname && firstParam(r.params.projectId ?? r.params.id) === s.sandboxProjectId;
      if (gated) {
        const nav = routerRef.current;
        if (nav.canGoBack()) nav.back();
        else nav.replace({ pathname: '/project-detail', params: { id: s.sandboxProjectId } });
      }
    }
    const wasFinale = s.phase === 'finale';
    dispatchTutorial({ type: 'EXIT', reason, now: Date.now() });
    if (!wasFinale && (reason === 'skip' || reason === 'esc')) showToast(EXIT_TOAST);
  }, [showToast]);

  const resume = useCallback(() => {
    const s = getTutorialState();
    if (s.status !== 'running' || !s.paused) return;
    const today = localDay(new Date());
    const ctx: StartCtx = getTutorialStartCtx() ?? { today, reportDay: tutorialReportDay(hostData.dailyReports, s.sandboxProjectId, today) };
    const target = resumeTarget(s, getTutorialDefs(), ctx);
    if (target) {
      const nav = routerRef.current;
      const def = getTutorialDefs()[s.tutorialId];
      // The sample hub is usually already in the stack under the step's
      // screen: dismiss back to it instead of stacking a second copy.
      if (target.pathname === '/project-detail') nav.dismissTo({ pathname: '/project-detail', params: target.params });
      else {
        // 'Continue' from the hub (or anywhere off the sample): stack the
        // sample hub underneath first, exactly as start() does. Otherwise the
        // screen's own goBack() after the save lands on /tutorials, the result
        // look step (on /project-detail) pauses off-route, and — the pill only
        // drawing on sample screens — he is stranded with no pill.
        const onHub = routeMatches(routeRef.current, { pathname: '/project-detail', projectParam: 'id' }, s.sandboxProjectId);
        if (def?.start.stackUnder && !onHub) nav.push({ pathname: '/project-detail', params: def.start.stackUnder.params(s.sandboxProjectId) });
        nav.push({ pathname: target.pathname, params: target.params });
      }
    }
    // The ROUTE that lands settles any offroute pause the machine re-derives.
    dispatchTutorial({ type: 'RESUME', now: Date.now() });
  }, []);

  const startRef = useRef<(id: TutorialId, opts: StartTutorialOpts) => Promise<boolean>>(async () => false);

  const finaleAction = useCallback((key: string) => {
    const s = getTutorialState();
    if (s.status !== 'running' || s.phase !== 'finale') return;
    const h = ui.handoff;
    const action: HandoffAction | null =
      key === 'primary' ? h?.primary ?? null : key === 'secondary' ? h?.secondary ?? null : key === 'chain' ? h?.chain ?? null : null;
    if (action) track('tutorial_handoff_clicked', { tutorial_id: s.tutorialId, destination: action.destination });

    if (action?.destination === 'chain' && action.tutorialId) {
      // START replaces a finale (machine rule); no FINISH first, so the chain
      // is one continuous hand-off on the same sample.
      void startRef.current(action.tutorialId, { entry: 'chain', sandboxProjectId: s.sandboxProjectId, returnTo: s.returnTo ?? null });
      return;
    }
    const returnTo = s.returnTo ?? null;
    dispatchTutorial({ type: 'FINISH', now: Date.now() });
    const nav = routerRef.current;
    if (action?.destination === 'paywall' && action.feature) {
      setPaywall(action.feature);
      return;
    }
    if (action?.route) {
      nav.push({ pathname: action.route.pathname, params: action.route.params });
      return;
    }
    // Done: back to where a chip started him, if we can name it.
    const back = parseReturnTo(returnTo);
    if (back) nav.dismissTo({ pathname: back.pathname, params: back.params });
  }, [ui]);

  // ── Boot ─────────────────────────────────────────────────────────────────

  const start = useCallback(async (id: TutorialId, opts: StartTutorialOpts): Promise<boolean> => {
    const def = getTutorialDefs()[id];
    if (!def) return false;
    // A start while another is still booting (a double tap during navigation)
    // is dropped FIRST: checked after the EXIT below, it killed the booting
    // run and then refused itself, so neither ran and one was marked exited.
    if (ui.booting) return false;
    const cur = getTutorialState();
    if (cur.status === 'running') {
      // 'Continue' on the same tutorial: resume the paused run, never restart.
      if (cur.tutorialId === id && cur.paused && cur.phase === 'step') { resume(); return true; }
      // Replaying or switching: the live run ends first (no toast — he chose).
      if (cur.phase !== 'finale') dispatchTutorial({ type: 'EXIT', reason: 'skip', now: Date.now() });
    }
    ui.booting = true;
    try {
      // Sample first, then START: the run's sandbox id is fixed at START, and
      // the machine drops every signal that names another project.
      const sandbox = await bootSandbox(def, opts.sandboxProjectId ?? null);
      if (!sandbox) {
        showAlert('Could not open the sample job', 'Something went wrong loading the sample. Try again in a moment.');
        return false;
      }
      const sandboxId = sandbox.id;
      const flags = sandbox.flags;
      const today = localDay(new Date());
      const reportDay = tutorialReportDay(hostData.dailyReports, sandboxId, today);
      const startCtx: StartCtx = { today, reportDay };
      setTutorialStartCtx(startCtx);
      dispatchTutorial({ type: 'START', tutorialId: id, sandboxProjectId: sandboxId, entry: opts.entry, returnTo: opts.returnTo ?? null, now: Date.now() });
      const started = getTutorialState();
      if (started.status !== 'running' || started.tutorialId !== id || started.phase !== 'boot') return false;
      // The machine needs the route it starts on (START clears it).
      dispatchTutorial({ type: 'ROUTE', pathname: routeRef.current.pathname, params: routeRef.current.params, now: Date.now() });

      if (opts.entry === 'onboarding') {
        // handleTourSample replaced to the tab shell just before calling us;
        // pushing while the funnel route is still on top would land the
        // sample UNDER it.
        await waitFor(() => !FUNNEL_PATHS.has(routeRef.current.pathname), 4000);
      }
      const nav = routerRef.current;
      const startParams = def.start.params(sandboxId, startCtx);
      const startRoute = def.steps[0]?.route ?? { pathname: def.start.pathname, projectParam: 'projectId' as const };
      const onStart = () => routeMatches(routeRef.current, startRoute, sandboxId) && routeRef.current.pathname === def.start.pathname;
      if (!onStart()) {
        const onHub = routeMatches(routeRef.current, { pathname: '/project-detail', projectParam: 'id' }, sandboxId);
        if (def.start.stackUnder && !onHub) nav.push({ pathname: '/project-detail', params: def.start.stackUnder.params(sandboxId) });
        nav.push({ pathname: def.start.pathname, params: startParams });
      }
      await waitFor(onStart, 5000);
      const now = getTutorialState();
      if (now.status !== 'running' || now.tutorialId !== id || now.phase !== 'boot') return false;
      dispatchTutorial({ type: 'BOOTED', flags, mounted: mountedTutorialTargetIds(), now: Date.now() });
      return true;
    } catch (err) {
      console.warn('[tutorial] boot failed', err);
      const s = getTutorialState();
      if (s.status === 'running' && s.tutorialId === id && s.phase === 'boot') {
        dispatchTutorial({ type: 'EXIT', reason: 'boot_failed', now: Date.now() });
      }
      return false;
    } finally {
      ui.booting = false;
    }
  }, [ui, resume]);
  startRef.current = start;

  // The screen-facing startTutorial / endTutorial go through here.
  useEffect(() => registerTutorialHost((id, opts) => startRef.current(id, opts), reason => exit(reason)), [exit]);

  useEffect(() => {
    setTutorialUiActions({
      next: () => dispatchTutorial({ type: 'NEXT', now: Date.now() }),
      skipStep: () => dispatchTutorial({ type: 'SKIP_STEP', now: Date.now() }),
      assist: () => {
        const s = getTutorialState();
        const step = currentStep(s, getTutorialDefs());
        if (step?.assist) runTutorialAssist(step.assist);
      },
      exit,
      celebrationDone: () => dispatchTutorial({ type: 'CELEBRATION_DONE', now: Date.now() }),
      dimPressed: () => {
        ui.nudge += 1;
        ui.handHiddenUntil = 0;
        publish();
      },
      resume,
      finaleAction,
    });
    return () => setTutorialUiActions(null);
  }, [exit, resume, finaleAction, publish, ui]);

  // ── Progress persistence (checkpoints and terminal states only) ──────────
  useEffect(() => subscribeTutorialTransitions((prev, next, event) => {
    const defs = getTutorialDefs();
    const iso = new Date().toISOString();
    if (event.type === 'RESTORE' && next.status === 'running') {
      // RESTORE starts with no route, and the ROUTE effect above only fires
      // on navigation: without this the paused pill would not know he is
      // already on a sample screen until he moved. Deferred, not nested: a
      // dispatch inside a transition listener would hand the listeners after
      // this one a stale (prev, next).
      setTimeout(() => {
        const r = routeRef.current;
        if (getTutorialState().status === 'running') dispatchTutorial({ type: 'ROUTE', pathname: r.pathname, params: r.params, now: Date.now() });
      }, 0);
    }
    if (next.status === 'running') {
      const def = defs[next.tutorialId];
      if (!def) return;
      const newRun = prev.status !== 'running' || prev.tutorialId !== next.tutorialId || prev.startedAt !== next.startedAt;
      if (newRun && next.phase === 'boot') void updateTutorialProgress(p => withStarted(p, next.tutorialId, next.version, iso));
      const enteredStep = next.phase === 'step' && (newRun || prev.status !== 'running' || prev.stepIndex !== next.stepIndex || prev.phase !== 'step');
      const step = def.steps[next.stepIndex];
      if (enteredStep && step?.checkpoint && !(next.paused && next.paused.reason === 'restored')) {
        const saved = toSavedActive(next, defs, Date.now());
        if (saved) void updateTutorialProgress(p => withCheckpoint(p, saved, step.id));
      }
      if (prev.status === 'running' && prev.phase !== 'finale' && next.phase === 'finale') {
        void updateTutorialProgress(p => withPractised(p, next.tutorialId, next.version, iso, measuredMs(def, next)));
      }
      return;
    }
    if (next.status === 'finished' && prev.status === 'running' && next.outcome === 'exited') {
      const def = defs[next.tutorialId];
      // Only a walk-out he chose means 'never offer again'; an offline boot
      // failure or a vanished sample just drops the saved run.
      if (exitMarksExited(next.reason)) void updateTutorialProgress(p => withExited(p, next.tutorialId, def?.version ?? prev.version, iso));
      else void updateTutorialProgress(p => withInterrupted(p, next.tutorialId));
    }
  }), []);

  // ── The live controller: everything that runs only while a run is live ───
  useEffect(() => {
    if (!running) {
      ui.rects = {};
      ui.missingSince = null;
      publish();
      return;
    }

    let disposed = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => { timers.delete(t); if (!disposed) fn(); }, ms);
      timers.add(t);
      return t;
    };

    // Measure the current step's targets against its layer, then publish.
    const measureAndPublish = async () => {
      const s = getTutorialState();
      const defs = getTutorialDefs();
      const step = currentStep(s, defs);
      if (s.status !== 'running' || s.phase !== 'step' || s.paused || !step || step.kind === 'wait') {
        ui.rects = {};
        publish();
        return;
      }
      const layerId: LayerId = step.layer ?? 'root';
      const layer = getTutorialLayer(layerId);
      const seq = ++ui.measureSeq;
      ui.measureInFlight = seq;
      const rects: Partial<Record<string, Rect>> = {};
      // The layer and every target in the fallback chain are measured in
      // PARALLEL, so one silent node costs one MEASURE_TIMEOUT_MS, not one per
      // link, and degrades to 'missing' → TARGET_TIMEOUT → Skip.
      const chain = targetChain(step);
      const [origin, ...measured] = await Promise.all([
        measureNode(layer?.node),
        ...chain.map(id => measureNode(getTutorialTarget(id)?.node)),
      ]);
      if (ui.measureInFlight === seq) ui.measureInFlight = 0;
      if (origin) {
        chain.forEach((id, i) => {
          const r = measured[i];
          if (r && r.w > 0 && r.h > 0) rects[id] = { x: r.x - origin.x, y: r.y - origin.y, w: r.w, h: r.h };
        });
      }
      if (disposed || seq !== ui.measureSeq) return;
      ui.rects = rects;
      afterMeasure(s, step.id);
      publish();
    };

    // Missing-target timeout, scroll-into-view, web focus and announcements —
    // the per-step side effects that need a measurement first.
    const afterMeasure = (s: RunningState, stepId: string) => {
      const defs = getTutorialDefs();
      const step = currentStep(s, defs);
      if (!step || step.id !== stepId) return;
      const stepKey = `${s.tutorialId}:${s.startedAt}:${s.stepIndex}:${s.stepEnteredAt}`;
      const blocked = s.mounted.some(isBlockerTarget);
      const chain = targetChain(step);
      const found = chain.find(id => ui.rects[id]);
      const layerMissing = (step.layer ?? 'root') !== 'root' && !mountedTutorialLayers().includes(step.layer ?? 'root');
      const now = Date.now();
      if (!blocked && (chain.length > 0 || layerMissing) && (!found || layerMissing)) {
        if (ui.missingSince === null) ui.missingSince = now;
        if (now - ui.missingSince >= TARGET_TIMEOUT_MS && !s.targetMissing) {
          dispatchTutorial({ type: 'TARGET_TIMEOUT', now });
        }
      } else {
        ui.missingSince = null;
      }
      if (!found) return;
      const rect = ui.rects[found]!;
      const layer = getTutorialLayer(step.layer ?? 'root');
      const viewport = layer?.size ?? { w: Dimensions.get('window').width, h: Dimensions.get('window').height };
      if (ui.scrolledStepKey !== stepKey) {
        ui.scrolledStepKey = stepKey;
        const vis = rectVisibleIn(rect, { x: 0, y: 0, w: viewport.w, h: Math.max(0, viewport.h - ui.keyboardH) }, SCROLL_MARGIN);
        if (!vis.visible) scrollIntoView(found, viewport.h);
      }
      if (Platform.OS === 'web' && ui.focusedStepKey !== stepKey) {
        // Decided ONCE per step (the key is set even when we leave focus
        // alone), so a later 250 ms re-measure never steals focus after he
        // finishes typing and clicks somewhere of his own choosing.
        ui.focusedStepKey = stepKey;
        const typing = () => isTextField(typeof document === 'undefined' ? null : document.activeElement);
        // webFocusMove (pinned by validate-tutorial-store): never move focus
        // out of a text field he is typing in — a debounced typing signal
        // starts the next step mid-word, and his next key would land on it.
        const move = webFocusMove({ stepKind: step.kind, textFieldFocused: typing() });
        if (move === 'next') {
          // A look step's action is Next, so Next gets the focus. Focusing the
          // target (a hub tile's Pressable) made Enter open the real tile:
          // RNW's PressResponder stops Enter before the window listener sees it.
          // The card renders after this publish; focus it on the next frame,
          // re-checking the same rule then (he may have clicked into a field).
          later(() => {
            const cur = getTutorialState();
            if (cur.status !== 'running' || currentStep(cur, getTutorialDefs())?.id !== stepId) return;
            if (typeof document === 'undefined') return;
            if (webFocusMove({ stepKind: 'look', textFieldFocused: typing() }) !== 'next') return;
            focusWithRing(document.querySelector<HTMLElement>('[data-testid="tutorial-next"]'));
          }, 60);
        } else if (move === 'target') {
          // A do step: the real control, so Enter / Space does the real thing.
          const el = domElement(getTutorialTarget(found)?.node);
          focusWithRing(el?.querySelector<HTMLElement>('button, [role="button"], input, textarea, select, [tabindex]:not([tabindex="-1"])') ?? null);
        }
      }
    };

    const scrollIntoView = (id: string, viewportH: number) => {
      const t = getTutorialTarget(id);
      if (!t?.node) return;
      const el = domElement(t.node);
      if (el) {
        try { el.scrollIntoView({ block: 'center', behavior: ui.reduceMotion ? 'auto' : 'smooth' }); } catch { /* old browsers */ }
        return;
      }
      const anchor = t.anchor;
      if (!anchor?.content || typeof t.node.measureLayout !== 'function') return;
      try {
        t.node.measureLayout(anchor.content, (_x, y) => anchor.scrollTo(scrollOffsetFor(y, viewportH)), () => {});
      } catch { /* the card says which way to scroll instead */ }
    };

    // React to every run transition: timers keyed to the step.
    let lastStepKey: string | null = null;
    let lastPhase: string | null = null;
    const onState = () => {
      const s = getTutorialState();
      if (s.status !== 'running') return;
      const defs = getTutorialDefs();
      const step = currentStep(s, defs);
      const stepKey = `${s.tutorialId}:${s.startedAt}:${s.stepIndex}:${s.stepEnteredAt}:${s.phase}:${s.paused ? s.paused.reason : ''}`;
      if (stepKey !== lastStepKey) {
        lastStepKey = stepKey;
        ui.missingSince = null;
        // STUCK: 15 s on a do / wait step without the real action.
        if (s.phase === 'step' && !s.paused && step && step.kind !== 'look') {
          const entered = s.stepEnteredAt;
          const idx = s.stepIndex;
          later(() => {
            const cur = getTutorialState();
            if (cur.status === 'running' && cur.phase === 'step' && cur.stepIndex === idx && cur.stepEnteredAt === entered && !cur.paused) {
              dispatchTutorial({ type: 'STUCK', now: Date.now() });
            }
          }, Math.max(0, STUCK_MS - (Date.now() - entered)));
        }
        // Announce each new step (screen readers read it; others no-op).
        if (s.phase === 'step' && !s.paused && step && step.kind !== 'wait') {
          const annKey = `${s.tutorialId}:${s.startedAt}:${s.stepIndex}`;
          if (ui.announcedStepKey !== annKey) {
            ui.announcedStepKey = annKey;
            const copy = stepCopy(step, copyCtxFor(s, ui), null);
            AccessibilityInfo.announceForAccessibility([copy.text, copy.detail].filter(Boolean).join('. '));
          }
        }
      }
      if (s.phase !== lastPhase) {
        const was = lastPhase;
        lastPhase = s.phase;
        if (s.phase === 'celebrate') {
          const at = s.celebrate?.at;
          later(() => {
            const cur = getTutorialState();
            if (cur.status === 'running' && cur.phase === 'celebrate' && cur.celebrate?.at === at) {
              dispatchTutorial({ type: 'CELEBRATION_DONE', now: Date.now() });
            }
          }, CELEBRATE_MS);
        }
        if (s.phase === 'finale' && was !== 'finale') void prepareFinale(s);
      }
      void measureAndPublish();
    };

    const prepareFinale = async (s: RunningState) => {
      const def = getTutorialDefs()[s.tutorialId];
      if (!def) return;
      ui.stripeConnected = true;
      computeHandoff(s, def);
      publish();
      if (def.handoff.offerStripe && hostData.userId) {
        // Unreachable reads as connected: never tell him he has not connected
        // Stripe on the strength of a failed request (billingFlowCore #36).
        const acct = await withTimeout(resolveStripeAccount(hostData.userId), 6000, { kind: 'unreachable' as const, error: 'timeout' });
        if (disposed) return;
        ui.stripeConnected = acct.kind !== 'not_connected';
        const cur = getTutorialState();
        if (cur.status === 'running' && cur.phase === 'finale' && cur.startedAt === s.startedAt) {
          computeHandoff(cur, def);
          publish();
        }
      }
    };

    const computeHandoff = (s: RunningState, def: TutorialDef) => {
      ui.handoff = handoffFor(
        def,
        {
          projects: hostData.projects,
          userId: hostData.userId,
          canAccess: hostData.canAccess,
          stripeConnected: ui.stripeConnected,
          fieldOnly: isFieldOnlyUser(hostData.projects, hostData.userId),
        },
        getTutorialDefs(),
      );
      ui.handoffRunKey = `${s.tutorialId}:${s.startedAt}`;
      const chain = ui.handoff.chain;
      if (chain?.tutorialId && ui.offeredChainKey !== ui.handoffRunKey) {
        ui.offeredChainKey = ui.handoffRunKey;
        track('tutorial_offered', { tutorial_id: chain.tutorialId, entry: 'chain' });
      }
    };

    const unsubState = subscribeStore(onState);
    const unsubLayers = subscribeTutorialLayers(() => { void measureAndPublish(); });
    const unsubTouch = subscribeTutorialTargetTouch(() => {
      ui.handHiddenUntil = Date.now() + HAND_HIDE_MS;
      publish();
      later(publish, HAND_HIDE_MS + 20);
    });

    // Poll only while something is being measured: a spotlight is up, or a
    // target is being waited for. Hidden / paused / card / background: idle.
    const poll = setInterval(() => {
      if (disposed || (AppState.currentState !== 'active' && Platform.OS !== 'web')) return;
      // Never supersede a measurement still in flight (see MEASURE_TIMEOUT_MS).
      if (ui.measureInFlight !== 0) return;
      const v = getTutorialPresentation().view;
      const s = getTutorialState();
      const waiting = s.status === 'running' && s.phase === 'step' && !s.paused && ui.missingSince !== null;
      // An off-screen target needs the poll too: native has no global scroll
      // event, so this is how the card turns back into a spotlight.
      if (v.kind === 'spotlight' || waiting || (v.kind === 'card' && v.reason === 'offscreen')) {
        void measureAndPublish();
      }
    }, POLL_MS);

    // Auto-exit: 10 min paused off-route, 60 min backgrounded.
    const exitPoll = setInterval(() => {
      const reason = autoExitReason(getTutorialState(), Date.now());
      if (reason) exit(reason);
    }, Math.min(OFFROUTE_EXIT_MS, BACKGROUND_EXIT_MS, 5000));

    // Platform facts.
    let srSub: { remove(): void } | null = null;
    let rmSub: { remove(): void } | null = null;
    // react-native-web's isScreenReaderEnabled() always resolves true, so the
    // web never asks (screenReaderFrom pins it off); it would lose every
    // spotlight to card mode.
    if (Platform.OS !== 'web') {
      void AccessibilityInfo.isScreenReaderEnabled().then(v => { ui.screenReader = screenReaderFrom(Platform.OS, !!v); publish(); }).catch(() => {});
      srSub = AccessibilityInfo.addEventListener('screenReaderChanged', v => { ui.screenReader = screenReaderFrom(Platform.OS, !!v); publish(); });
    } else {
      ui.screenReader = false;
    }
    // Unlike the splash, nothing here waits on the answer: motion is assumed
    // until the (unbounded) native query lands, then corrected.
    void AccessibilityInfo.isReduceMotionEnabled().then(v => { ui.reduceMotion = !!v; publish(); }).catch(() => {});
    rmSub = AccessibilityInfo.addEventListener('reduceMotionChanged', v => { ui.reduceMotion = !!v; publish(); });

    const kbShow = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', e => {
      ui.keyboardH = e.endCoordinates?.height ?? 0;
      void measureAndPublish();
    });
    const kbHide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      ui.keyboardH = 0;
      void measureAndPublish();
    });
    const dimSub = Dimensions.addEventListener('change', () => { void measureAndPublish(); });

    let androidAwayAt: number | null = null;
    const appSub = AppState.addEventListener('change', (st: AppStateStatus) => {
      // Native only: on the web a hidden tab is him checking the sample
      // invoice in his inbox — part of the tutorial, not leaving it.
      if (Platform.OS === 'web') return;
      if (Platform.OS === 'android') {
        // The camera / photo library are separate activities on Android and
        // background the app; pausing then drops the punch.photo.added the
        // step waits for. Judge the trip when he is BACK instead, dated from
        // when he left (androidAwayIsPause, pinned by validate-tutorial-store).
        if (st === 'background') { if (androidAwayAt === null) androidAwayAt = Date.now(); return; }
        if (st === 'active' && androidAwayAt !== null) {
          const leftAt = androidAwayAt;
          androidAwayAt = null;
          if (androidAwayIsPause(getTutorialState(), getTutorialDefs(), Date.now() - leftAt)) {
            dispatchTutorial({ type: 'PAUSE', reason: 'background', now: leftAt });
          }
        }
        return;
      }
      if (st === 'background') {
        const s = getTutorialState();
        if (s.status === 'running' && s.phase !== 'finale' && !(s.paused && s.paused.reason !== 'offroute')) {
          dispatchTutorial({ type: 'PAUSE', reason: 'background', now: Date.now() });
        }
      }
    });

    // Web: Esc / Enter, and re-measure on scroll anywhere (capture).
    let removeWeb: (() => void) | null = null;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape' && e.key !== 'Enter') return;
        const s = getTutorialState();
        if (s.status !== 'running') return;
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        const pres = getTutorialPresentation();
        const v = pres.view;
        const step = currentStep(s, getTutorialDefs());
        // The rules (coach on screen only; the card's own button answers its
        // Enter) live in tutorialWebKeyAction, pinned by validate-tutorial-store.
        const action = tutorialWebKeyAction({
          key: e.key,
          coachVisible: tutorialCoachVisible(pres),
          textFieldFocused: isTextField(active),
          focusInCoach: inCoachCard(active),
          defaultPrevented: e.defaultPrevented,
          lookStepLive: s.phase === 'step' && !s.paused && step?.kind === 'look' && (v.kind === 'spotlight' || v.kind === 'card'),
        });
        if (action === 'blur') (active as HTMLElement).blur();
        else if (action === 'exit') exit('esc');
        else if (action === 'next') {
          e.preventDefault();
          dispatchTutorial({ type: 'NEXT', now: Date.now() });
        }
      };
      const onScroll = () => { void measureAndPublish(); };
      window.addEventListener('keydown', onKey);
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onScroll);
      removeWeb = () => {
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onScroll);
      };
    }

    onState();

    return () => {
      disposed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      clearInterval(poll);
      clearInterval(exitPoll);
      unsubState();
      unsubLayers();
      unsubTouch();
      srSub?.remove();
      rmSub?.remove();
      kbShow.remove();
      kbHide.remove();
      dimSub.remove();
      appSub.remove();
      removeWeb?.();
      ui.rects = {};
      ui.keyboardH = 0;
      ui.handoff = null;
      publish();
    };
  }, [running, exit, publish, ui]);

  return (
    <>
      <TutorialDataBridge onExit={exit} />
      <TutorialLayer host="root" />
      {paywall ? (
        <Paywall
          visible
          onClose={() => setPaywall(null)}
          feature={FEATURE_LABEL[paywall] ?? 'This feature'}
          requiredTier={REQUIRED_TIER[paywall]}
          source="tutorial_handoff"
        />
      ) : null}
    </>
  );
}

// ── Store subscription for the controller (non-hook) ────────────────────────

function subscribeStore(fn: () => void): () => void {
  let last: RunState = getTutorialState();
  return subscribeTutorialTransitions((_prev, next) => {
    if (next === last) return;
    last = next;
    fn();
  });
}

// ── Sandbox: resolve / seed, then the tutorial's needs ─────────────────────

/** utils/tutorial/sandbox's deps, read through GETTERS: the seed writes, then
 *  the plan step reads the lists again seconds later, and a captured array
 *  would be the render from before the seed. hostData is re-mirrored by the
 *  data bridge on every render, so reading it late is reading it fresh. */
const SANDBOX_DEPS: SandboxDeps = {
  getWorld: () => ({
    projects: hostData.projects,
    planSheets: hostData.api?.planSheets ?? [],
    userId: hostData.userId,
  }),
  getActions: () => {
    const api = hostData.api;
    if (!api) throw new Error('projects not ready');
    return {
      addProject: api.addProject,
      addInvoice: api.addInvoice,
      addDailyReport: api.addDailyReport,
      addPunchItem: api.addPunchItem,
      addProjectPhoto: api.addProjectPhoto,
      addRFI: api.addRFI,
      addChangeOrder: api.addChangeOrder,
      updateProject: api.updateProject,
      addPlanSheet: api.addPlanSheet,
      updatePlanSheet: api.updatePlanSheet,
    };
  },
};

/** Seed + plan budget: a seed is local-first (fast); the plan upload has its
 *  own 8 s budget inside ensureTutorialSample. Past this the boot fails. */
const SANDBOX_BOOT_MS = 15_000;

/**
 * Resolve (or seed) the tutorial's sample and top it up for def.needs, before
 * step 1. Returns null when there is no sample to run on (the boot fails).
 *
 * Sarah's Place goes through utils/tutorial/sandbox.ensureTutorialSample — the
 * one place that seeds, patches the estimate lines onto an old sample and puts
 * the A-101 plan on it through the real addFloorPlan. A later wave's sample
 * (the schedule example) registers its own handlers instead.
 */
async function bootSandbox(def: TutorialDef, given: string | null): Promise<{ id: string; flags: BootFlags } | null> {
  const flags: BootFlags = { samplePlan: true, mic: Platform.OS !== 'web' };
  const custom = getTutorialSandboxHandlers();
  if (custom.resolveSample || custom.ensureNeeds) {
    const id = given ?? (custom.resolveSample ? await withTimeout(custom.resolveSample({ def, projects: hostData.api }), 10000, null) : null);
    if (!id) return null;
    if (custom.ensureNeeds && def.needs.length > 0) {
      const got = await withTimeout(custom.ensureNeeds({ def, sandboxProjectId: id, projects: hostData.api }), 9000, { samplePlan: false });
      return { id, flags: { ...flags, ...got } };
    }
    return { id, flags };
  }
  if (def.sandbox !== 'sarahs-place' || !hostData.api) return given ? { id: given, flags } : null;

  if (given) {
    // An explicit id (onboarding seeded it a moment ago) is trusted, but the
    // top-ups pick the sample BY NAME: wait for the list to carry it, or a
    // stale list would make ensureTutorialSample seed a second sample.
    if (def.needs.length === 0) return { id: given, flags };
    const seen = await waitFor(() => hostData.projects.some(p => p.id === given), 4000);
    if (!seen) {
      // Can't top up safely; run on it as it is (the pin steps skip without
      // a plan, and a fresh small seed already carries its estimate lines).
      const plan = hostData.api?.getPlanSheetsForProject(given) ?? [];
      return { id: given, flags: { ...flags, samplePlan: !def.needs.includes('plan') || plan.length > 0 } };
    }
  }

  const res = await withTimeout(ensureTutorialSample(def.needs, SANDBOX_DEPS), SANDBOX_BOOT_MS, null);
  if (!res || !res.ok) return given ? { id: given, flags: { ...flags, samplePlan: !def.needs.includes('plan') } } : null;
  return { id: res.sandboxProjectId, flags: { ...flags, samplePlan: res.flags.samplePlan } };
}

// ── Copy context and the presentation ──────────────────────────────────────

interface UiFacts {
  screenReader: boolean;
  reduceMotion: boolean;
  keyboardH: number;
  pointerFine: boolean;
  handHiddenUntil: number;
  nudge: number;
  toast: string | null;
  rects: Partial<Record<string, Rect>>;
  handoff: Handoff | null;
}

function copyCtxFor(s: RunningState, ui: UiFacts, signal?: SignalName | null): CopyCtx {
  const payload = signal ? (s.payloads[signal] as { offline?: boolean } | undefined) : undefined;
  return {
    pointerFine: ui.pointerFine,
    web: Platform.OS === 'web',
    freeTier: hostData.isFree,
    payloads: s.payloads,
    userEmail: hostData.userEmail,
    offline: payload?.offline === true,
    reportDayLabel: dayLabel(getTutorialStartCtx()?.reportDay),
    samplePlan: s.flags?.samplePlan,
  };
}

function buildPresentation(s: RunState, ui: UiFacts): TutorialPresentation {
  const base: TutorialPresentation = {
    ...EMPTY_PRESENTATION,
    screenReader: ui.screenReader,
    reduceMotion: ui.reduceMotion,
    keyboardH: ui.keyboardH,
    pointerFine: ui.pointerFine,
    web: Platform.OS === 'web',
    handHiddenUntil: ui.handHiddenUntil,
    nudge: ui.nudge,
    toast: ui.toast,
  };
  if (s.status !== 'running') return base;
  const defs = getTutorialDefs();
  const def = defs[s.tutorialId];
  if (!def) return base;
  const step = currentStep(s, defs);
  const layerId: LayerId = step?.layer ?? 'root';
  const layer = getTutorialLayer(layerId);
  const viewport = layer?.size ?? { w: Dimensions.get('window').width, h: Dimensions.get('window').height };
  const env: CoachEnv = {
    rects: ui.rects,
    viewport,
    mountedLayers: mountedTutorialLayers(),
    screenReader: ui.screenReader,
    keyboardH: ui.keyboardH,
    now: Date.now(),
  };
  const view = coachView(s, env, defs);
  const out: TutorialPresentation = { ...base, view };

  if (view.kind === 'finale') {
    const h = ui.handoff;
    const finale: FinalePresentation = {
      title: def.title,
      stat: statLine(def, s),
      primary: h?.primary ? { key: 'primary', label: h.primary.label } : null,
      secondary: h?.secondary ? { key: 'secondary', label: h.secondary.label } : null,
      chain: h?.chain ? { key: 'chain', label: h.chain.label } : null,
    };
    return { ...out, finale };
  }
  if (!step) return out;
  out.stepId = step.id;
  out.stepKind = step.kind;

  if (view.kind === 'celebrate') {
    const sig = s.celebrate?.signal ?? null;
    const copy = successCopy(step, copyCtxFor(s, ui, sig));
    return { ...out, celebrate: copy ?? { title: 'Done', sub: '' } };
  }

  const usedTarget = view.kind === 'spotlight' ? view.targetId : view.kind === 'card' ? view.targetId ?? null : null;
  const copy = stepCopy(step, copyCtxFor(s, ui), usedTarget);
  const aff = cardAffordances(s, defs, { screenReader: ui.screenReader });
  const assist = aff.assist && hasTutorialAssist(aff.assist) ? aff.assist : null;
  out.text = copy.text;
  out.detail = copy.detail;
  out.stepNumber = aff.stepNumber;
  out.stepCount = aff.stepCount;
  out.next = aff.next;
  // 'Can't find it — Skip step' shows with the missing card itself.
  out.skip = aff.skip || (view.kind === 'card' && view.reason === 'missing');
  out.assist = assist;
  out.gesture = step.gesture ?? 'none';
  out.point = step.point ?? null;
  if (s.failure) {
    out.failureReason = s.failure.reason.trim() || "It didn't go through. Check your connection and try again.";
  }
  if (view.kind === 'spotlight') {
    out.targetRect = view.rect;
    out.hole = holeRect(view.rect, viewport);
    out.holeRadius = HOLE_RADIUS;
  }
  return out;
}

// ── The data bridge: projects, auth, plan → hostData; lifecycle exits ─────

function TutorialDataBridge({ onExit }: { onExit: (reason: ExitReason) => void }) {
  const api = useProjects();
  const { user } = useAuth();
  const { tier, isFree, canAccess } = useTierAccess();
  const userId = user?.id ?? null;

  hostData.api = api;
  hostData.projects = api.projects;
  hostData.projectsLoaded = api.projectsLoaded;
  hostData.userRole = api.userRole;
  hostData.dailyReports = api.dailyReports;
  hostData.userId = userId;
  hostData.userEmail = user?.email ?? null;
  hostData.isFree = isFree;
  hostData.tier = tier;
  hostData.canAccess = canAccess;

  useEffect(() => {
    setTutorialHostFacts({ platform: Platform.OS, persona: api.userRole ?? null, tier: tier ?? null });
  }, [api.userRole, tier]);

  const restored = useRef(false);

  // Sign-out / account switch: end the run, forget the previous tenant's
  // progress (the storage sweep removes the key; this drops the cache).
  const prevUser = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const was = prevUser.current;
    prevUser.current = userId;
    if (was === undefined || was === userId) return;
    if (getTutorialState().status === 'running') onExit('signed_out');
    resetTutorialProgressCache();
    restored.current = false;
  }, [userId, onExit]);

  // Persona switch ends the run (the tutorial was chosen for the old one).
  const prevRole = useRef(api.userRole);
  useEffect(() => {
    const was = prevRole.current;
    prevRole.current = api.userRole;
    if (was && api.userRole && was !== api.userRole && getTutorialState().status === 'running') onExit('persona_changed');
  }, [api.userRole, onExit]);

  // The sample deleted or renamed out of the prefix mid-run.
  const s = useTutorialRun(st => (st.status === 'running' && st.phase !== 'boot' ? st.sandboxProjectId : null));
  useEffect(() => {
    if (!s || !api.projectsLoaded) return;
    if (!sandboxStillValid(api.projects, userId, s)) onExit('sample_gone');
  }, [s, api.projects, api.projectsLoaded, userId, onExit]);

  // A saved run comes back PAUSED once per session (never resumed by itself):
  // the hub shows 'Continue', the sample's screens show the paused pill.
  useEffect(() => {
    if (restored.current || !userId || !api.projectsLoaded) return;
    restored.current = true;
    void (async () => {
      const progress = await loadTutorialProgress();
      const saved = progress.active;
      if (!saved || getTutorialState().status === 'running') return;
      const sampleExists = sandboxStillValid(hostData.projects, hostData.userId, saved.sandboxProjectId);
      const next = dispatchTutorial({ type: 'RESTORE', saved, sampleExists, now: Date.now() });
      if (next.status !== 'running' && getTutorialProgress().active) {
        void updateTutorialProgress(withoutActive);
      }
    })();
  }, [userId, api.projectsLoaded]);

  return null;
}

export default TutorialHost;
