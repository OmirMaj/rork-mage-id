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
import { renderRouter, act } from 'expo-router/testing-library';
import * as Sentry from '@sentry/react-native';
import * as reactQuery from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { __setSmokeSession } from '@/__tests__/mocks/supabase';
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
  // It goes through the AsyncStorage mirror (`mageid_subscription_tier`, read
  // by SubscriptionContext's localTierQuery) rather than through the
  // RevenueCat mock, because RevenueCat never configures under test — there is
  // no EXPO_PUBLIC_REVENUECAT_* key in the jest environment, so `rcConfigured`
  // is false and the entitlements path is skipped entirely. The mirror is the
  // app's own documented fallback for exactly that case.
  //
  // Cost: the locked branches are not covered. Accepted — /paywall and
  // /onboarding-paywall are themselves routes the suite mounts directly.
  await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');

  if (state === 'populated') {
    await seedWorld();
  }
}

export type MountResult = ReturnType<typeof renderRouter>;

/**
 * Mount `url` in the real app tree. Raw — does not check for a swallowed
 * crash. Use `mountRouteChecked` unless you specifically want the raw tree.
 */
export function mountRoute(url: string): MountResult {
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
  Component: () => React.ReactElement | null
): MountResult {
  return renderRouter(
    { appDir: 'app', overrides: { [`./${routeName}.tsx`]: Component } },
    { initialUrl: `/${routeName}` }
  );
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
      (t) => t !== 'Something went wrong' && t !== 'Try Again' && t.length > 3
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
  /** Optional synthetic screen to inject at `url` — used only to prove the
   *  detector itself, never by the route suite. */
  injected?: () => React.ReactElement | null
): Promise<MountResult> {
  // Detector 1 reads accumulated calls; make sure they are this mount's.
  (Sentry.captureException as jest.Mock).mockClear();

  let tree: MountResult;
  try {
    tree = injected
      ? mountInjectedRoute(url.replace(/^\//, ''), injected)
      : mountRoute(url);
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
    // Keep the app's stack, not this helper's: the useful frame is the screen.
    if (crash.stack) wrapped.stack = crash.stack;
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
