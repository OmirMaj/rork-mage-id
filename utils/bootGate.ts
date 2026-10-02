// utils/bootGate.ts — when the launch curtain may lift, and when the root
// layout may route (lane INSTANTOPEN, M3). Pure: no react-native, no React.
//
// Two separate questions that used to share one answer:
//
//   routingReady  — are the ROUTING facts known? The session (auth), the
//                   onboarding flag, the persona and the first settings read.
//                   The routing effect in app/_layout.tsx decides /login,
//                   /persona-select and /onboarding from these alone; it never
//                   read the project list. While any of them is loading this is
//                   false, so nothing routes on a half-loaded account (a tenant
//                   switch never routes the new account with the old persona).
//
//   bootstrapping — must the curtain (BrandSplash / BootShell / the reload
//                   veil) still stand? Always while routing is not ready. Past
//                   that, it waits for the project list too UNLESS the app is
//                   landing on Home: Home has its own skeleton cards and keeps
//                   them up until the list loads. A cold start deep-linked
//                   anywhere else (e.g. /project-detail?id=…) still waits, so no
//                   screen ever says "project not found" for a project that is
//                   still loading.
//
// The curtain lifting earlier is NOT a claim the data is there: Home's skeleton
// stays until the list arrives, and markFirstUseful('home') is still the honest
// "first useful screen" number (utils/startupTiming.ts).

/**
 * usePathname() on a cold start that lands on Home. The home tab lives at
 * app/(tabs)/(home)/index.tsx, whose pathname is '/' (groups are not part of a
 * pathname) on a phone and on desktop web alike.
 */
export const HOME_LANDING_PATHS: readonly string[] = ['/'];

export interface BootGateInput {
  /** AuthContext isLoading: the session read + the tenant handoff check. */
  authLoading: boolean;
  /** ProjectContext bootGateLoading: settings first read ∪ onboarding ∪ persona. */
  routingLoading: boolean;
  /** ProjectContext projectsLoading: the project list query. */
  projectsLoading: boolean;
  /** null until the onboarding read has settled. */
  hasSeenOnboarding: boolean | null;
  /** The pathname the app landed on at cold start. app/_layout.tsx captures it
   *  ONCE (first render) and passes that same value on every later render, so
   *  a later reload (an account switch) keeps the cold start's rule: after a
   *  Home landing it does not wait for the new list (Home's skeleton covers
   *  it); after a deep-link landing it does. null means "not Home": full wait. */
  landingPath: string | null;
}

export interface BootGate {
  bootstrapping: boolean;
  routingReady: boolean;
}

export function isHomeLanding(landingPath: string | null): boolean {
  return landingPath !== null && HOME_LANDING_PATHS.includes(landingPath);
}

export function bootGate(i: BootGateInput): BootGate {
  const routingReady = !i.authLoading && !i.routingLoading && i.hasSeenOnboarding !== null;
  const bootstrapping = !routingReady || (i.projectsLoading && !isHomeLanding(i.landingPath));
  return { bootstrapping, routingReady };
}

// ── Boot phase marks (M1) ────────────────────────────────────────────────────
// The pure half of utils/startupTiming.ts markBootPhase: the phase names, the
// first-wins record and the one-line summary. Kept here (no react-native) so
// scripts/validate-boot-gate.ts can table-test it under bun; startupTiming
// re-exports every name below.

/** Display order of the [boot] line (the order a healthy launch reaches them). */
export const BOOT_PHASES = [
  'auth_resolved',
  'routing_resolved',
  'settings_resolved',
  'projects_resolved',
  'fonts_ready',
  'native_splash_hidden',
  'boot_ready',
  'splash_done',
  'first_useful',
] as const;

export type BootPhase = typeof BOOT_PHASES[number];
export type BootPhaseMarks = Partial<Record<BootPhase, number>>;

/** Same three labels as utils/startupTiming.ts TimingBasis. */
export type BootPhaseBasis = 'bundle_start' | 'js_module' | 'navigation_start';

const PHASE_LABEL: Record<BootPhase, string> = {
  auth_resolved: 'auth',
  routing_resolved: 'routing',
  settings_resolved: 'settings',
  projects_resolved: 'projects',
  fonts_ready: 'fonts',
  native_splash_hidden: 'native_splash_hidden',
  boot_ready: 'boot_ready',
  splash_done: 'splash_done',
  first_useful: 'first_useful',
};

/**
 * Records `ms` for `phase` unless the phase already has a number this launch
 * (first call wins). A number that is not finite or is negative is refused —
 * a phase is either measured or absent, never made up. Returns whether it was
 * recorded.
 */
export function recordBootPhase(marks: BootPhaseMarks, phase: BootPhase, ms: number): boolean {
  if (!(BOOT_PHASES as readonly string[]).includes(phase)) return false;
  if (marks[phase] !== undefined) return false;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return false;
  marks[phase] = Math.round(ms);
  return true;
}

/** Only the phases that happened, as a fresh plain object (for the event). */
export function bootPhasesSnapshot(marks: BootPhaseMarks): BootPhaseMarks {
  const out: BootPhaseMarks = {};
  for (const phase of BOOT_PHASES) {
    const ms = marks[phase];
    if (typeof ms === 'number' && Number.isFinite(ms)) out[phase] = ms;
  }
  return out;
}

/**
 * The phases as FLAT event properties — `phase_<phase>: ms`, only the phases
 * that happened. utils/analytics' event properties are scalars (string |
 * number | boolean), so the phases ride the ONE app_first_screen event as
 * flat numbers rather than a nested object.
 */
export function bootPhaseProps(marks: BootPhaseMarks): Record<string, number> {
  const out: Record<string, number> = {};
  const snap = bootPhasesSnapshot(marks);
  for (const phase of BOOT_PHASES) {
    const ms = snap[phase];
    if (ms !== undefined) out[`phase_${phase}`] = ms;
  }
  return out;
}

/**
 * One line, numbers and phase names only (no PII), e.g.
 *   auth 120 · routing 340 · settings 410 · projects 1630 · boot_ready 420 · first_useful 1700 (basis bundle_start)
 * A phase that did not happen is left out (never printed as 0).
 */
export function summarizeBootPhases(marks: BootPhaseMarks, basis: BootPhaseBasis): string {
  const parts: string[] = [];
  for (const phase of BOOT_PHASES) {
    const ms = marks[phase];
    if (typeof ms === 'number' && Number.isFinite(ms)) parts.push(`${PHASE_LABEL[phase]} ${ms}`);
  }
  const body = parts.length > 0 ? parts.join(' · ') : 'no phases recorded';
  return `${body} (basis ${basis})`;
}
