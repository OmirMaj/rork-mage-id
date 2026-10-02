/**
 * Lane INSTANTOPEN — the boot gate (utils/bootGate.ts) inside the REAL app.
 *
 * The launch curtain used to wait for the network project list on every cold
 * start. It now lifts as soon as the ROUTING facts (session, onboarding,
 * persona, first settings read) are known — but only when the app is landing
 * on Home, which has its own skeleton cards. A deep link to a job still waits,
 * and nothing routes while the routing facts load.
 *
 * Each case mounts the real app/_layout.tsx (16 providers, the fixture world)
 * through __tests__/helpers/mountRoute and holds chosen Supabase reads open
 * with a spy on supabase.from, so "still loading" is a fact of the run, not a
 * mock of a context.
 *
 *   1. Cold start to '/' with the project list held: Home's skeleton, not the
 *      boot loader; after the list lands the skeleton goes, and the ONE
 *      app_first_screen event carries the phase_<phase> numbers.
 *   2. Cold start deep-linked to /project-detail with the list held: the loader
 *      stays until the list lands.
 *   3. Signed-out cold start (list held): still lands on /login.
 *   4. Account switch while the new account's persona is loading (C3): the
 *      loader stands and no redirect fires until the read resolves; then the
 *      new account (no persona) is sent to /persona-select.
 *   5. Cold start where the persona read is the LAST routing read to land: the
 *      routing effect must not see the persona's state copy before it catches
 *      up (ProjectContext routingFactsLag) — no /persona-select bounce for a
 *      user who has a persona.
 *   6. markBootPhase: the first call per phase wins.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act } from '@testing-library/react-native';
import { mountRouteChecked, primeSignedOut, primeWorld, settle, type MountResult } from '@/__tests__/helpers/mountRoute';
import { __setSmokeSession } from '@/__tests__/mocks/supabase';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import { supabase } from '@/lib/supabase';
import { SkeletonCard } from '@/components/Skeleton';
import { __resetLaunchCurtainForTests } from '@/components/launch/launchCurtain';
import * as Sentry from '@sentry/react-native';
import {
  FIRST_SCREEN_EVENT, markBootPhase, markFirstUseful, __resetStartupTimingForTests,
} from '@/utils/startupTiming';

// ── Holding Supabase reads open ──────────────────────────────────────────────
type HoldRule = { table: string; select?: string };
let holdRules: HoldRule[] = [];
let releaseHeld: () => void = () => {};
let heldGate: Promise<void> = Promise.resolve();

function hold(rules: HoldRule[]): void {
  holdRules = rules;
  heldGate = new Promise<void>((resolve) => { releaseHeld = resolve; });
}

/** Wrap a postgrest-like builder so awaiting it waits for the gate first. */
function wrapHeld(target: any, matches: (selectArg: string | null) => boolean, selectArg: string | null = null): any {
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'then') {
        if (!matches(selectArg)) return t.then.bind(t);
        const gate = heldGate;
        return (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => gate.then(() => t.then(onF, onR));
      }
      const v = t[prop as string];
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        const out = v.apply(t, args);
        const nextSelect = prop === 'select' ? String(args[0] ?? '*') : selectArg;
        return out && (typeof out === 'object' || typeof out === 'function') ? wrapHeld(out, matches, nextSelect) : out;
      };
    },
  });
}

const realFrom = supabase.from;
let fromSpy: jest.SpyInstance | null = null;

function installHoldSpy(): void {
  fromSpy = jest.spyOn(supabase, 'from').mockImplementation((table: string) => {
    const builder = realFrom.call(supabase, table);
    const rules = holdRules.filter((r) => r.table === table);
    if (rules.length === 0) return builder;
    return wrapHeld(builder, (selectArg) =>
      rules.some((r) => r.select === undefined || (selectArg !== null && selectArg.includes(r.select))));
  });
}

async function release(): Promise<void> {
  holdRules = [];
  // Time passes while the read is on the wire (so "before" is measurable).
  await act(async () => { jest.advanceTimersByTime(500); await Promise.resolve(); });
  await act(async () => { releaseHeld(); await Promise.resolve(); });
  await settle();
  await settle();
}

// ── Probes ───────────────────────────────────────────────────────────────────
const loaderShowing = (tree: MountResult) =>
  !!tree.queryByTestId('boot-shell') || !!tree.queryByTestId('screen-loader');
const skeletonCards = (tree: MountResult) => tree.UNSAFE_queryAllByType(SkeletonCard).length;

let layoutLogs: string[] = [];
let logSpy: jest.SpyInstance | null = null;
let infoSpy: jest.SpyInstance | null = null;

const SESSION_B_ID = '99999999-9999-4999-8999-999999999999';
function sessionFor(id: string, email: string) {
  return {
    access_token: `smoke-access-${id}`,
    refresh_token: `smoke-refresh-${id}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id, aud: 'authenticated', role: 'authenticated', email,
      email_confirmed_at: '2026-01-01T00:00:00.000Z', phone: '',
      confirmed_at: '2026-01-01T00:00:00.000Z', last_sign_in_at: '2026-08-15T00:00:00.000Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { full_name: 'Second Account', company_name: 'Second Co' },
      identities: [], created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-08-15T00:00:00.000Z',
    },
  };
}

/**
 * The ONE app_first_screen event, read from the breadcrumb markFirstUseful
 * leaves beside track() (same props). The analytics provider itself is the
 * app's own (utils/posthog's initAnalytics replaces any test provider once the
 * real layout mounts), so the Sentry mock is the stable place to read it.
 */
function firstScreenEvents(): { name: string; props?: Record<string, unknown> }[] {
  const calls = (Sentry.addBreadcrumb as unknown as jest.Mock).mock.calls as [{ message?: string; data?: Record<string, unknown> }][];
  return calls
    .filter(([crumb]) => crumb?.message === FIRST_SCREEN_EVENT)
    .map(([crumb]) => ({ name: FIRST_SCREEN_EVENT, props: crumb.data }));
}
/** The flat phase_<phase> numbers on the event, keyed by phase. */
function phasesOf(props: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(props)) if (k.startsWith('phase_')) out[k.slice('phase_'.length)] = v as number;
  return out;
}

beforeEach(() => {
  __resetLaunchCurtainForTests();
  __resetStartupTimingForTests();
  (Sentry.addBreadcrumb as unknown as jest.Mock).mockClear();
  holdRules = [];
  installHoldSpy();
  layoutLogs = [];
  const collect = (...args: unknown[]) => {
    const first = typeof args[0] === 'string' ? args[0] : '';
    if (first.startsWith('[Layout]') || first.startsWith('[boot]')) layoutLogs.push(first);
  };
  logSpy = jest.spyOn(console, 'log').mockImplementation(collect);
  infoSpy = jest.spyOn(console, 'info').mockImplementation(collect);
});

afterEach(() => {
  releaseHeld();
  holdRules = [];
  fromSpy?.mockRestore();
  logSpy?.mockRestore();
  infoSpy?.mockRestore();
});

describe('the boot gate in the real app', () => {
  it('a cold start to Home lifts the curtain to Home\'s skeleton while the project list loads', async () => {
    await primeWorld('populated');
    hold([{ table: 'projects' }]);
    const tree = await mountRouteChecked('/');

    expect(tree.getPathname()).toBe('/');
    expect(loaderShowing(tree)).toBe(false);
    expect(skeletonCards(tree)).toBeGreaterThanOrEqual(3);
    expect(firstScreenEvents()).toHaveLength(0);

    await release();
    expect(skeletonCards(tree)).toBe(0);
    expect(loaderShowing(tree)).toBe(false);
    expect(tree.getPathname()).toBe('/');

    const sent = firstScreenEvents();
    expect(sent).toHaveLength(1);
    const phases = phasesOf(sent[0].props!);
    expect(typeof phases.boot_ready).toBe('number');
    expect(typeof phases.routing_resolved).toBe('number');
    expect(typeof phases.projects_resolved).toBe('number');
    expect(phases.first_useful).toBe(sent[0].props!.ms);
    // The curtain lifted BEFORE the list landed: that is the whole point.
    expect(phases.boot_ready).toBeLessThan(phases.projects_resolved);
    expect(phases.projects_resolved).toBeLessThanOrEqual(phases.first_useful);
    // Review fix round 1: the list and settings numbers are the signed-in
    // account's, never the signed-out pass that runs before auth resolves.
    expect(phases.projects_resolved).toBeGreaterThanOrEqual(phases.auth_resolved);
    expect(typeof phases.settings_resolved).toBe('number');
    expect(phases.settings_resolved).toBeGreaterThanOrEqual(phases.auth_resolved);
    // Only phases that happened, and only numbers.
    for (const v of Object.values(phases)) expect(Number.isInteger(v)).toBe(true);
    expect(layoutLogs.filter((l) => l.startsWith('[boot] '))).toHaveLength(1);
    expect(layoutLogs.find((l) => l.startsWith('[boot] '))).toMatch(/\(basis (bundle_start|js_module|navigation_start)\)$/);
  });

  it('a cold start deep-linked to /project-detail keeps the loader until the project list lands', async () => {
    await primeWorld('populated');
    hold([{ table: 'projects' }]);
    const tree = await mountRouteChecked(`/project-detail?id=${PROJECT_ID}`);

    expect(loaderShowing(tree)).toBe(true);

    await release();
    expect(loaderShowing(tree)).toBe(false);
    expect(tree.getPathname()).toBe('/project-detail');
  });

  it('a signed-out cold start still lands on /login', async () => {
    await primeSignedOut();
    hold([{ table: 'projects' }]);
    const tree = await mountRouteChecked('/');
    expect(tree.getPathname()).toBe('/login');
    expect(layoutLogs).toContain('[Layout] Not authenticated — redirecting to login');
  });

  it('an account switch never routes the new account until its persona has loaded (C3)', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked('/');
    expect(tree.getPathname()).toBe('/');
    expect(loaderShowing(tree)).toBe(false);

    // The pre-session wipe removes the previous tenant's routing mirrors
    // (contexts/AuthContext wipeLocalUserCache); the new account's profile
    // reads are still on the wire.
    await AsyncStorage.multiRemove(['mageid_user_role', 'mageid_onboarding_complete']);
    hold([{ table: 'profiles' }]);
    layoutLogs = [];
    await act(async () => { __setSmokeSession(sessionFor(SESSION_B_ID, 'second@example.invalid')); });
    await settle();
    await settle();

    // The loader stands over the switch and NOTHING has routed: no persona or
    // onboarding redirect was decided on the previous account's persona.
    expect(loaderShowing(tree)).toBe(true);
    expect(tree.getPathname()).toBe('/');
    expect(layoutLogs.filter((l) => l.startsWith('[Layout]'))).toEqual([]);

    await release();
    // B has no persona: now, and only now, the gate sends him to pick one.
    expect(tree.getPathname()).toBe('/persona-select');
    expect(layoutLogs).toContain('[Layout] No persona set — redirecting to /persona-select');
  });

  it('a persona read that lands last never bounces a user who has a persona to /persona-select', async () => {
    await primeWorld('populated');
    hold([{ table: 'profiles', select: 'user_role' }]);
    const tree = await mountRouteChecked('/');
    expect(loaderShowing(tree)).toBe(true);

    await release();
    expect(tree.getPathname()).toBe('/');
    expect(loaderShowing(tree)).toBe(false);
    expect(layoutLogs.filter((l) => l.includes('persona-select'))).toEqual([]);
  });

  it('the list and settings numbers belong to the signed-in account, not the signed-out pass before auth resolves', async () => {
    await primeWorld('populated');
    // Hold the session read (a cold start whose access token must refresh):
    // ProjectContext's signed-out pass (['projects', null], settings owner
    // 'signed-out') settles from the device while auth is still loading.
    let releaseAuth: () => void = () => {};
    const authGate = new Promise<void>((resolve) => { releaseAuth = resolve; });
    const realGetSession = supabase.auth.getSession.bind(supabase.auth);
    const authSpy = jest.spyOn(supabase.auth, 'getSession').mockImplementation(async () => {
      await authGate;
      return realGetSession();
    });
    try {
      const tree = await mountRouteChecked('/');
      await act(async () => { jest.advanceTimersByTime(500); await Promise.resolve(); });
      await settle();
      await act(async () => { releaseAuth(); await Promise.resolve(); });
      await settle();
      await settle();
      expect(tree.getPathname()).toBe('/');

      const sent = firstScreenEvents();
      expect(sent).toHaveLength(1);
      const phases = phasesOf(sent[0].props!);
      expect(typeof phases.auth_resolved).toBe('number');
      expect(phases.auth_resolved).toBeGreaterThanOrEqual(500);
      expect(phases.projects_resolved).toBeGreaterThanOrEqual(phases.auth_resolved);
      expect(phases.settings_resolved).toBeGreaterThanOrEqual(phases.auth_resolved);
    } finally {
      releaseAuth();
      authSpy.mockRestore();
    }
  });

  it('markBootPhase keeps the first ms of a phase', async () => {
    jest.useFakeTimers();
    const t0 = Date.now();
    jest.setSystemTime(t0 + 1000);
    markBootPhase('fonts_ready');
    jest.setSystemTime(t0 + 6000);
    markBootPhase('fonts_ready');
    markFirstUseful('home', { restoredFromDevice: false });
    const sent = firstScreenEvents();
    expect(sent).toHaveLength(1);
    const phases = phasesOf(sent[0].props!);
    expect(phases.first_useful - phases.fonts_ready).toBe(5000);
    expect(Object.keys(phases).sort()).toEqual(['first_useful', 'fonts_ready']);
    jest.useRealTimers();
  });
});
