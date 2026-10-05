/**
 * __tests__/helpers/mountRoute.tsx — mount one route inside the REAL app.
 *
 * The load-bearing decision from the spec:
 *
 *   "Do not mock the 31 providers. They run for real and hydrate from the
 *    fixture. ... Mocking providers would test the mocks — the render paths
 *    that actually break are the ones where a real context returns a real (or
 *    missing) value and a screen dereferences it."
 *
 * So this does NOT rebuild the provider stack in a test wrapper. It hands
 * expo-router the real `app/` directory, which means the real
 * `app/_layout.tsx` mounts with its real 16 providers in their real order, and
 * the target route renders inside it exactly as it does on a device. There is
 * no second copy of the stack to drift out of sync — if someone adds a 17th
 * provider tomorrow, the suite picks it up with no edit here.
 *
 * The only things standing in for reality are the network/native edge mocks in
 * __tests__/setup/edge-mocks.js and __tests__/mocks/supabase.ts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderRouter, act, getMockContext } from 'expo-router/testing-library';
// The same module instance renderRouter renders with (it require()s it).
import { render } from '@testing-library/react-native';
import type { MockContextConfig } from 'expo-router/testing-library';
import { ExpoRoot } from 'expo-router/build/ExpoRoot';
import { store as routerStore } from 'expo-router/build/global-state/router-store';
import * as Sentry from '@sentry/react-native';
import * as reactQuery from '@tanstack/react-query';
import { AI_CONSENT_STORAGE_KEY } from '@/utils/aiConsentCore';
import { CODE_ACK_STORAGE_KEY, serializeCodeAck } from '@/utils/codeAckCore';
import type { QueryClient } from '@tanstack/react-query';
import { __setSmokeSession } from '@/__tests__/mocks/supabase';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { seedWorld, clearWorld, SMOKE_USER } from '@/__tests__/fixtures/world';

export type WorldState = 'empty' | 'populated';

/**
 * A Supabase-shaped session for the fixture's contractor.
 *
 * AuthContext reads `supabase.auth.getSession()` on mount and gates
 * `isAuthenticated` on it; ProjectContext's `canSync` and every per-user
 * AsyncStorage namespace hang off `user.id`.
 */
function smokeSession() {
  return {
    access_token: 'smoke-access-token',
    refresh_token: 'smoke-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: SMOKE_USER.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: SMOKE_USER.email,
      email_confirmed_at: '2026-01-01T00:00:00.000Z',
      phone: '',
      confirmed_at: '2026-01-01T00:00:00.000Z',
      last_sign_in_at: '2026-08-15T00:00:00.000Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { full_name: SMOKE_USER.name, company_name: SMOKE_USER.company },
      identities: [],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-08-15T00:00:00.000Z',
    },
  };
}

/**
 * Empty every QueryClient the app has constructed.
 *
 * app/_layout.tsx builds its client at module scope, so within a jest worker
 * ONE client outlives every mount. Without this, the second state to run is
 * served the first state's cached rows — observed: after the populated mount
 * seeded a project, the empty mount rendered that project. AsyncStorage was
 * being cleared correctly; react-query simply never re-read it.
 */
function resetQueryCache(): void {
  const getClients = (reactQuery as unknown as { __getQueryClients?: () => QueryClient[] })
    .__getQueryClients;
  if (!getClients) return;
  for (const client of getClients()) {
    client.clear();
  }
}

/**
 * Put the world in the requested state BEFORE the tree mounts.
 *
 * Both states are signed in — see the comment on __setSmokeSession in
 * __tests__/mocks/supabase.ts for why "empty" does not mean "logged out".
 *
 * `mageid_onboarding_complete` + `mageid_user_role` are seeded in BOTH states
 * because RootLayoutNav redirects to /onboarding or /persona-select without
 * them, which would mean every route in the suite mounted the onboarding
 * screen and reported a false pass.
 */
export async function primeWorld(state: WorldState): Promise<void> {
  await clearWorld();
  resetQueryCache();
  __setSmokeSession(smokeSession());

  // First-run gates — cleared in both states. These are not "data", they are
  // the difference between the app showing you a screen and showing you a
  // funnel.
  await AsyncStorage.setItem('mageid_onboarding_complete', 'true');
  await AsyncStorage.setItem('mageid_user_role', 'contractor');

  // Subscription tier — also a gate, not data, and also seeded in both states.
  //
  // Measured, not assumed: with the tier left at free, /rfi and /punch-list
  // rendered "Upgrade Required" and passed without executing one line of
  // either screen. Roughly half the app sits behind hooks/useTierAccess.ts, so
  // a free-tier run is a suite that mostly tests the paywall component.
  //
  // It goes through the AsyncStorage mirror (`mageid_subscription_tier`)
  // rather than through the RevenueCat mock, because RevenueCat never
  // configures under test — there is no EXPO_PUBLIC_REVENUECAT_* key in the
  // jest environment, so `rcConfigured` is false and the entitlements path is
  // skipped entirely. Since wave 5 (#2) SubscriptionContext treats the
  // server's subscriptions row as the truth (a "no row" answer is a definitive
  // Free) and reads the mirror only while the server has not answered — so
  // the tier reaches the app through the MOCKED subscriptions row
  // (__tests__/mocks/supabase.ts subscriptionRow), which mirrors this key.
  //
  // Cost: the locked branches are not covered. Accepted — /paywall and
  // /onboarding-paywall are themselves routes the suite mounts directly.
  await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');

  // AI data-sharing consent (utils/aiConsent, App Store 5.1.2(i)) — a gate, not
  // data, seeded in both states. On a phone the first AI request with no stored
  // answer waits on a system alert, and under jest nobody answers it: a suite
  // that taps an AI button (ai-weekly-summary, plan-sweep) would hang on the
  // question, or record the question instead of the screen. 'granted' is the
  // state a contractor who uses AI is in. The unanswered state is covered where
  // it is the subject: __tests__/smoke/appset-phone.test.tsx removes this key
  // and records Settings → AI features as it reads before any answer.
  await AsyncStorage.setItem(AI_CONSENT_STORAGE_KEY, 'granted');

  // "Before you rely on a code answer" (utils/codeAck): a one-time notice in
  // front of the first building-code AI request, seeded as acknowledged for
  // the same reason as the consent above (nobody taps a system alert under
  // jest). The unacknowledged state is covered where it is the subject:
  // __tests__/guards/code-ack.test.ts.
  await AsyncStorage.setItem(CODE_ACK_STORAGE_KEY, serializeCodeAck(SMOKE_USER.id, new Date('2026-10-04T12:00:00.000Z')));

  if (state === 'populated') {
    await seedWorld();
  }
}

/**
 * Signed out, nothing on disk. The state a brand-new install is in.
 *
 * Needed because both smoke states are signed in, which means RootLayoutNav
 * bounces /login and /signup straight to home and the two screens every single
 * user sees first are the two the route suite never renders. Found by the
 * landing assertion, which is exactly the sort of hole it exists to expose.
 */
export async function primeSignedOut(): Promise<void> {
  await clearWorld();
  resetQueryCache();
  __setSmokeSession(null);
}

export type MountResult = ReturnType<typeof renderRouter>;

/**
 * Mount options. `now` (epoch ms) pins the clock the FIRST render reads.
 *
 * Why it has to be an option: renderRouter calls a bare `jest.useFakeTimers()`
 * before it renders (expo-router/build/testing-library/index.js), and jest seeds
 * that clock from the real time. So a `jest.useFakeTimers({ now })` or
 * `pinDateOnly()` at module scope is thrown away by every mount, and a screen
 * that decides "today" at mount reads the real day. With `now` set, the mount
 * runs renderRouter's own steps with `jest.useFakeTimers({ now, doNotFake: [] })`
 * in place of the bare call. Use `jest.setSystemTime` after mount only to MOVE
 * time within a test. See __tests__/helpers/testClock.ts.
 */
export interface MountOpts {
  now?: number;
}

/**
 * renderRouter, step for step (expo-router 6.0.24
 * build/testing-library/index.js renderRouter), except the fake clock starts at
 * `now`. Used only when a caller pins the clock; the default path still calls
 * renderRouter itself.
 */
function renderRouterAt(
  context: MockContextConfig,
  initialUrl: string,
  now: number
): MountResult {
  jest.useFakeTimers({ now, doNotFake: [] });
  const mockContext = getMockContext(context);
  // Force the render to be synchronous (as renderRouter does).
  process.env.EXPO_ROUTER_IMPORT_MODE = 'sync';
  const result = render(<ExpoRoot context={mockContext} location={initialUrl} />);
  return Object.assign(result, {
    getPathname() {
      return routerStore.getRouteInfo().pathname;
    },
    getSegments() {
      return routerStore.getRouteInfo().segments;
    },
    getSearchParams() {
      return routerStore.getRouteInfo().params;
    },
    getPathnameWithParams() {
      return routerStore.getRouteInfo().pathnameWithParams;
    },
    getRouterState() {
      return routerStore.state;
    },
  }) as MountResult;
}

/**
 * Mount `url` in the real app tree. Raw — does not check for a swallowed
 * crash. Use `mountRouteChecked` unless you specifically want the raw tree.
 */
export function mountRoute(url: string, opts?: MountOpts): MountResult {
  if (opts?.now != null) return renderRouterAt('app', url, opts.now);
  return renderRouter('app', { initialUrl: url });
}

/**
 * Mount a synthetic route injected into the real `app/` tree.
 *
 * Used to prove the crash detector against the app's REAL ErrorBoundary
 * without editing an app file. The injected screen sits under the real
 * app/_layout.tsx, so it is caught by the same boundary that catches a real
 * screen — which is the only thing worth proving.
 */
export function mountInjectedRoute(
  routeName: string,
  Component: () => React.ReactElement | null,
  opts?: MountOpts
): MountResult {
  // Under SMOKE_STRICT the React "The above error occurred in <...>" log that
  // an intentional crash produces would fail the very test proving the crash
  // was detected. Declared here rather than pattern-matched, because the
  // pattern would also swallow the real ones.
  allowConsoleErrors();
  const context = { appDir: 'app', overrides: { [`./${routeName}.tsx`]: Component } };
  if (opts?.now != null) return renderRouterAt(context, `/${routeName}`, opts.now);
  return renderRouter(context, { initialUrl: `/${routeName}` });
}

/**
 * The single most important line of this harness:
 *
 *   app/_layout.tsx wraps the ENTIRE app in <ErrorBoundary>.
 *
 * Which means a screen that throws on mount does NOT make `render()` throw.
 * React hands the error to the boundary, the boundary renders "Something went
 * wrong", and a naive `expect(render).not.toThrow()` passes. Verified, not
 * assumed: the first Stage-2 run mounted `/` with the fixture seeded, the home
 * screen died with "Cannot read properties of undefined (reading 'charAt')",
 * and the test reported PASS.
 *
 * A suite that green-lights a crashed screen is worse than no suite. So every
 * mount is inspected afterwards for evidence that the boundary fired.
 *
 * Two independent detectors, because either alone can miss:
 *  1. Sentry.captureException — ErrorBoundary.componentDidCatch forwards there,
 *     and our mock records the ORIGINAL Error, stack included. This is the good
 *     path: the report gets the real message and the real stack.
 *  2. The `error-boundary-retry` testID in the rendered output — a backstop for
 *     the case where getDerivedStateFromError fires but componentDidCatch has
 *     not flushed yet. Text-scraped, so lower fidelity, but it cannot be
 *     fooled by mock bookkeeping.
 */
function findSwallowedCrash(tree: MountResult): Error | null {
  const captured = (Sentry.captureException as jest.Mock).mock?.calls ?? [];
  for (const [err] of captured) {
    if (err instanceof Error) return err;
    if (err) return new Error(String(err));
  }

  if (tree.queryByTestId('error-boundary-retry')) {
    // Scrape whatever the fallback is showing so the report is not just
    // "something went wrong".
    const texts = collectText(tree.toJSON());
    const detail = texts.find(
      (t) => t !== 'This screen hit an error' && t !== 'Try again' && t.length > 3
    );
    return new Error(detail ?? 'ErrorBoundary rendered its fallback');
  }

  return null;
}

function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collectText(n, out));
    return out;
  }
  const children = (node as { children?: unknown }).children;
  if (children) collectText(children, out);
  return out;
}

/**
 * Mount `url`, let the providers hydrate, and fail if anything threw — whether
 * the throw escaped or was caught by the app's ErrorBoundary.
 *
 * The thrown message is one line, prefixed with the route, per the spec:
 * "Mount failures report the route and the thrown message on one line, so a
 * run with twelve failures is readable without scrolling."
 */
export async function mountRouteChecked(
  url: string,
  /** Optional synthetic screen to inject at `url` (used to prove the detector
   *  and by probe suites), or the mount options when nothing is injected. */
  injectedOrOpts?: (() => React.ReactElement | null) | MountOpts,
  /** Mount options when a screen is injected. */
  opts?: MountOpts
): Promise<MountResult> {
  const injected = typeof injectedOrOpts === 'function' ? injectedOrOpts : undefined;
  const mountOpts = typeof injectedOrOpts === 'function' ? opts : (injectedOrOpts ?? opts);
  // Detector 1 reads accumulated calls; make sure they are this mount's.
  (Sentry.captureException as jest.Mock).mockClear();

  let tree: MountResult;
  try {
    tree = injected
      ? mountInjectedRoute(url.replace(/^\//, ''), injected, mountOpts)
      : mountRoute(url, mountOpts);
  } catch (err) {
    // An escaped throw — i.e. one from above the ErrorBoundary, or from route
    // resolution itself. Re-thrown with the route attached rather than
    // swallowed, per "a screen that throws is a failure, not a skip".
    throw new Error(`${url} — ${(err as Error)?.message ?? String(err)}`, { cause: err });
  }

  await settle();

  const crash = findSwallowedCrash(tree);
  if (crash) {
    const wrapped = new Error(`${url} — ${crash.message}`);
    // Keep the app's stack frames, not this helper's — the useful frame is the
    // screen, and jest renders a code frame from it. The header line is
    // rewritten to carry the route so the printed failure is self-describing
    // even when read out of context.
    if (crash.stack) {
      const frames = crash.stack.split('\n').slice(1).join('\n');
      wrapped.stack = `${wrapped.message}\n${frames}`;
    }
    throw wrapped;
  }

  return tree;
}

/**
 * Let the providers finish their first hydration pass.
 *
 * Every context in this app hydrates asynchronously (react-query + AsyncStorage
 * reads), so the interesting render — the one with data in it — is the SECOND
 * one, after those promises settle. Mounting and immediately asserting would
 * only ever exercise the loading state, which is the one state that never
 * crashes.
 *
 * renderRouter installs fake timers, so both the microtask queue and any
 * setTimeout-based debounce have to be pumped explicitly.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
  });
  await act(async () => {
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
  });
}
