// utils/startupTiming.ts — how fast the app opens, and the "first screen is up"
// signal the less important providers wait for (IDEAS-1 · SPEED S2 + S3).
//
// Imported FIRST by app/_layout.tsx (handoff patch SPEED-2), so the module's
// own evaluation time is as early as JS can record. Nothing here may import a
// heavy module: analytics and Sentry are both already in the root bundle.
//
// ── The first-screen signal ──────────────────────────────────────────────────
// The ONE module-level signal lives in hooks/useAfterFirstScreen.ts (it must not
// import react-native — see there). This module shares it: it registers
// InteractionManager.runAfterInteractions as the signal's after-interactions
// scheduler the moment it loads, and markFirstUseful releases it. The signal
// flips on the first of markFirstUseful, after interactions, or the
// FIRST_SCREEN_CAP_MS cap, and can never stay false forever.
//
// ── What the number measures (honest labels) ─────────────────────────────────
//   basis 'bundle_start'     — iOS/Android: from Metro's prelude stamp
//       `__BUNDLE_START_TIME__ = nativePerformanceNow()` (node_modules/metro/src/
//       lib/getPreludeCode.js), i.e. from the moment the JS bundle began
//       executing, read on the same clock. It does NOT include the native
//       launch before JS (process start, splash, Hermes load) — so it is not
//       "cold start from tap".
//   basis 'navigation_start' — web: performance.now(), the time since the
//       page's navigation started (includes download + parse of the bundle).
//   basis 'js_module'        — fallback when neither exists: from this
//       module's own evaluation.
import { InteractionManager, Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { track } from '@/utils/analytics';
import {
  FIRST_SCREEN_CAP_MS, isFirstScreenShown, subscribeFirstScreen, releaseFirstScreen,
  setAfterInteractionsScheduler, __resetFirstScreenSignalForTests,
} from '@/hooks/useAfterFirstScreen';
import {
  recordBootPhase, bootPhaseProps, summarizeBootPhases,
  type BootPhase, type BootPhaseMarks,
} from '@/utils/bootGate';

export { FIRST_SCREEN_CAP_MS, isFirstScreenShown, subscribeFirstScreen };
export { BOOT_PHASES, summarizeBootPhases, bootPhasesSnapshot, bootPhaseProps } from '@/utils/bootGate';
export type { BootPhase, BootPhaseMarks } from '@/utils/bootGate';

/**
 * The owned contexts whose FIRST load waits for the first-screen signal.
 * scripts/validate-startup-deferral.ts checks that exactly these import
 * useAfterFirstScreen, and that the core contexts do not.
 *   BidsContext      — the public bid feed (public_bids + get_bid_contacts RPC).
 *   CompaniesContext — the companies directory (companies select).
 * Not deferred (the first screen reads them, or they load nothing at mount):
 *   SafetyContext (Home's BrainWatchCard via useBrainWatch), NotificationContext
 *   (Home's MorningBriefCard reads pushToken), PropertyContext
 *   (PropertyManagerHome IS Home for that persona), HireContext (every query is
 *   `enabled: QUERIES_ENABLED`, off while HIRE_ENABLED is false — nothing loads),
 *   MaterialCartContext (a local read only; deferring it would widen the window
 *   in which an add-to-cart is overwritten by its own hydrate).
 */
export const DEFERRED_CONTEXTS = ['BidsContext', 'CompaniesContext'] as const;

export type TimingBasis = 'bundle_start' | 'js_module' | 'navigation_start';

// ── JS start (module evaluation) ─────────────────────────────────────────────
const moduleLoadedAt = Date.now();

type Globals = {
  __BUNDLE_START_TIME__?: unknown;
  nativePerformanceNow?: unknown;
  performance?: { now?: () => number };
};

/** Where "zero" is and what "now" is, on this platform. Pure given its inputs. */
export function readStartupClock(env: {
  os: string;
  bundleStart: unknown;
  nativeNow: (() => number) | null;
  perfNow: (() => number) | null;
  dateNow: () => number;
  moduleLoadedAt: number;
}): { basis: TimingBasis; start: number; now: number } {
  if (env.os === 'web' && env.perfNow) {
    return { basis: 'navigation_start', start: 0, now: env.perfNow() };
  }
  if (env.os !== 'web' && typeof env.bundleStart === 'number' && Number.isFinite(env.bundleStart)) {
    // The prelude used nativePerformanceNow when it existed, else Date.now —
    // read "now" on the same clock.
    const now = env.nativeNow ? env.nativeNow() : env.dateNow();
    return { basis: 'bundle_start', start: env.bundleStart, now };
  }
  return { basis: 'js_module', start: env.moduleLoadedAt, now: env.dateNow() };
}

function currentClock(): { basis: TimingBasis; start: number; now: number } {
  const g = globalThis as unknown as Globals;
  const nativeNow = typeof g.nativePerformanceNow === 'function' ? (g.nativePerformanceNow as () => number) : null;
  const perfNow = g.performance && typeof g.performance.now === 'function'
    ? () => (g.performance as { now: () => number }).now()
    : null;
  return readStartupClock({
    os: Platform.OS,
    bundleStart: g.__BUNDLE_START_TIME__,
    nativeNow,
    perfNow,
    dateNow: Date.now,
    moduleLoadedAt,
  });
}

// ── The signal's after-interactions path (registered at module load) ────────
setAfterInteractionsScheduler((fn) => {
  InteractionManager.runAfterInteractions(() => fn());
});

// ── Restored-from-device note (set by components/QueryCachePersist) ──────────
let restoredQueryCount = 0;
/** QueryCachePersist records how many queries it hydrated from the device this launch. */
export function noteRestoredFromDevice(count: number): void {
  restoredQueryCount += Math.max(0, count);
}
export function restoredFromDeviceThisLaunch(): boolean {
  return restoredQueryCount > 0;
}

// ── Boot phase marks (lane INSTANTOPEN M1) ───────────────────────────────────
// Where the launch spends its time, per phase, on the same clock and basis as
// the first-screen number. app/_layout.tsx marks auth / routing / settings /
// projects / fonts / native splash / boot_ready / splash_done; markFirstUseful
// marks first_useful. First call per phase per launch wins. A phase that did
// not happen this launch is absent from the event, never 0.
const bootMarks: BootPhaseMarks = {};

function webPerformanceMark(phase: BootPhase): void {
  if (Platform.OS !== 'web') return;
  try {
    const perf = (globalThis as unknown as { performance?: { mark?: (name: string) => unknown } }).performance;
    if (perf && typeof perf.mark === 'function') perf.mark(`mage:boot:${phase}`);
  } catch { /* a missing or throwing User Timing API never breaks the launch */ }
}

/** Records how long after the clock's zero this phase was reached. Once per phase per launch. */
export function markBootPhase(phase: BootPhase): void {
  if (bootMarks[phase] !== undefined) return;
  try {
    const clock = currentClock();
    if (!recordBootPhase(bootMarks, phase, Math.max(0, Math.round(clock.now - clock.start)))) return;
  } catch {
    return; // no clock, no number — absent, never made up
  }
  webPerformanceMark(phase);
}

// ── The measurement ──────────────────────────────────────────────────────────
export const FIRST_SCREEN_EVENT = 'app_first_screen';
let firstUsefulRecorded = false;

/**
 * Home calls this ONCE, when the project list (or its empty state) first
 * renders with data. Releases the deferred loads and sends ONE analytics
 * event per launch. No PII: the screen name, a number, the platform, flags.
 * Without the Home patch (SPEED-3) this is never called and no timing is
 * reported — an honest missing number beats a made-up one.
 */
export function markFirstUseful(screen: string, opts?: { restoredFromDevice?: boolean }): void {
  releaseFirstScreen();
  if (firstUsefulRecorded) return;
  firstUsefulRecorded = true;
  const clock = currentClock();
  const ms = Math.max(0, Math.round(clock.now - clock.start));
  const restored = opts?.restoredFromDevice ?? restoredFromDeviceThisLaunch();
  if (recordBootPhase(bootMarks, 'first_useful', ms)) webPerformanceMark('first_useful');
  const props = {
    ms,
    basis: clock.basis,
    platform: Platform.OS,
    screen,
    restored_from_device: restored,
    deferred_count: DEFERRED_CONTEXTS.length,
    // phase_<phase>: ms for each boot phase reached so far (flat: the event's
    // properties are scalars). An absent phase is absent, never 0.
    ...bootPhaseProps(bootMarks),
  };
  track(FIRST_SCREEN_EVENT, props);
  // One line a --no-dev Metro run (or the browser console) shows: phase names
  // and numbers only, no PII.
  console.info(`[boot] ${summarizeBootPhases(bootMarks, clock.basis)}`);
  try {
    if (typeof Sentry.addBreadcrumb === 'function') {
      Sentry.addBreadcrumb({ category: 'startup', message: FIRST_SCREEN_EVENT, level: 'info', data: props });
    }
  } catch { /* never let telemetry break the first screen */ }
}

/** Test-only: put the module back to a fresh launch. */
export function __resetStartupTimingForTests(): void {
  __resetFirstScreenSignalForTests();
  restoredQueryCount = 0;
  firstUsefulRecorded = false;
  for (const k of Object.keys(bootMarks)) delete bootMarks[k as BootPhase];
}
