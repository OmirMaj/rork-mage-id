/**
 * Stage 2 — one screen inside the REAL provider stack.
 *
 * The second control. one-screen.test.tsx proves jest can render a component;
 * this proves the app's own 16-provider tree in app/_layout.tsx boots under
 * test, with only the network/native edge mocked.
 *
 * If every-route.*.test.tsx goes uniformly red, the question is answered here:
 *   - this file green  -> the stack is fine, the screens are broken
 *   - this file red    -> the stack or a mock is broken, ignore the route list
 *
 * It also pins the three behaviours the route suite silently depends on, each
 * of which was wrong in the first draft and each of which would have made the
 * whole suite pass vacuously:
 *   1. the mounted route is the route we asked for (not /login)
 *   2. the tier gate is open (not the paywall)
 *   3. a swallowed ErrorBoundary crash is detected (not reported as a pass)
 */

import {
  mountInjectedRoute,
  mountRouteChecked,
  primeWorld,
  settle,
} from '@/__tests__/helpers/mountRoute';

function textOf(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => textOf(n, out));
    return out;
  }
  const children = (node as { children?: unknown }).children;
  if (children) textOf(children, out);
  return out;
}

describe('real provider stack', () => {
  it('boots app/_layout.tsx and lands on the requested route', async () => {
    await primeWorld('empty');
    const tree = await mountRouteChecked('/permits');
    expect(tree.getPathname()).toBe('/permits');
  });

  it('does not bounce a protected route to /login', async () => {
    // RootLayoutNav redirects unauthenticated traffic to /login. If the smoke
    // session ever stops working, ~180 routes would quietly render the login
    // screen and the suite would report a clean run over nothing.
    await primeWorld('empty');
    const tree = await mountRouteChecked('/budget-dashboard');
    expect(tree.getPathname()).toBe('/budget-dashboard');
  });

  it('is past the tier gate, so gated screens run their real body', async () => {
    // /rfi requires Business. With the tier at free this renders the paywall
    // and passes without executing a line of the RFI screen — which is exactly
    // what the first draft of this harness did.
    await primeWorld('empty');
    const tree = await mountRouteChecked('/rfi');
    expect(textOf(tree.toJSON())).not.toContain('Upgrade Required');
  });

  it('hydrates the fixture into the real ProjectContext', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked('/punch-list');
    const text = textOf(tree.toJSON()).join(' ');
    // Proof the providers ran for real and read the seeded world, rather than
    // a mocked context handing back a canned value.
    expect(text).toContain('Harlow Residence');
  });

  it('a throwing screen is caught by the app ErrorBoundary, not by render()', async () => {
    // This is the fact that makes the next test necessary, so it is asserted
    // rather than described. A screen that throws does NOT make render()
    // throw — the boundary in app/_layout.tsx eats it and shows a fallback.
    // Any smoke suite that does not know this reports crashed screens as
    // passes. Ours did, for about twenty minutes.
    await primeWorld('empty');

    const tree = mountInjectedRoute('smoke-canary-control', () => {
      throw new Error('smoke-canary-control-throw');
    });
    await settle();

    expect(textOf(tree.toJSON())).toContain('Something went wrong');
  });

  it('detects a crash the ErrorBoundary swallowed, and names the route', async () => {
    // The guard that makes every other assertion in the suite meaningful.
    // Same throwing screen, same real boundary — this time through the
    // checked path, which must surface it.
    await primeWorld('empty');

    await expect(
      mountRouteChecked('/smoke-canary-control', () => {
        throw new Error('smoke-canary-control-throw');
      })
    ).rejects.toThrow(/smoke-canary-control — .*smoke-canary-control-throw/);
  });
});
