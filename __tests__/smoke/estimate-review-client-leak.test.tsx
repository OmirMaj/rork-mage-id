/**
 * Render coverage — the CLIENT-MODE ESTIMATE LEAK, mounted for real.
 *
 * The gap this closes: the populated fixture never seeded `mageid_material_cart`,
 * so `useMaterialCart()` hydrated an EMPTY cart on every mount. With an empty
 * cart, app/(tabs)/estimate/review.tsx renders only its "No line items yet"
 * branch — the Contractor/Client toggle and the whole client-mode subtree
 * (EstimateClientView, the share button, the client-safe projection) live
 * INSIDE the `cart.length > 0` branch and therefore rendered in ZERO tests. The
 * 402-test suite "found 0 bugs" partly because this firewall never mounted.
 *
 * world.ts now seeds a non-empty cart, so this test can:
 *   1. mount the real review screen inside the real 16-provider stack,
 *   2. press the Client toggle (testID 'review-mode-client'),
 *   3. assert the rendered client subtree carries NO markup/% leak — the ONLY
 *      surviving /markup/i string is the intentional lock copy
 *      "Costs, markups & margin are hidden in client view".
 *
 * This is the leak the code comment in review.tsx calls the "CLIENT-VIEW
 * FIREWALL (hero band)": the hero eyebrow used to inline `{globalMarkup}% MARKUP`
 * in BOTH modes. This test PASSES on current main (the eyebrow is gated on
 * `mode`) and would FAIL the moment that leak returned — which is exactly the
 * regression 402 mounted-nothing tests could not have caught.
 */

import { fireEvent } from 'expo-router/testing-library';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';

/** Flatten every string node in the rendered tree. */
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

// The one intentional /markup/i string on the client surface — the lock copy in
// components/estimate/EstimateClientView.tsx. Everything else mentioning markup
// is a leak.
const INTENTIONAL_MARKUP_COPY = 'Costs, markups & margin are hidden in client view';

describe('estimate review — client mode does not leak markup', () => {
  it('the fixture seeds a non-empty cart, so the toggle actually renders', async () => {
    // Premise guard. If the cart is empty the toggle never mounts and every
    // assertion below passes vacuously — which is the exact failure mode this
    // whole file exists to end.
    await primeWorld('populated');
    const tree = await mountRouteChecked('/estimate/review');
    expect(tree.getByTestId('review-mode-contractor')).toBeTruthy();
    expect(tree.getByTestId('review-mode-client')).toBeTruthy();
  });

  it('contractor mode DOES show the markup (proving the leak string exists to be gated)', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked('/estimate/review');
    // The hero eyebrow inlines the global markup in contractor mode. If this
    // string is NOT here, the test below is guarding nothing.
    const eyebrow = tree.getByTestId('review-hero-eyebrow');
    expect(collectText(eyebrow.props.children ?? eyebrow).join(' ')).toMatch(/markup/i);
  });

  it('client mode leaks no markup except the intentional lock copy', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked('/estimate/review');

    // Flip to client view and let the client-safe projection settle.
    await settle();
    fireEvent.press(tree.getByTestId('review-mode-client'));
    await settle();

    // The client subtree is now mounted (EstimateClientView + share button).
    // Proof it actually rendered, not the empty branch:
    expect(tree.getByTestId('review-share-proposal')).toBeTruthy();
    expect(collectText(tree.toJSON())).toContain('PROJECT TOTAL');

    // The hero eyebrow must have dropped its "% MARKUP" — in client mode it is
    // the bare word "ESTIMATE".
    const eyebrow = tree.getByTestId('review-hero-eyebrow');
    expect(collectText(eyebrow.props.children ?? eyebrow).join(' ')).not.toMatch(/markup/i);

    // Sweep the ENTIRE rendered client tree. Every /markup/i hit must be the one
    // intentional lock line — a stray "18% markup" anywhere else is the leak.
    const leaks = collectText(tree.toJSON())
      .filter((s) => /markup/i.test(s))
      .filter((s) => s !== INTENTIONAL_MARKUP_COPY);
    expect(leaks).toEqual([]);

    // And the contractor's actual markup percentages must not appear anywhere on
    // the client surface. The fixture cart uses 18% and 22% markups; neither the
    // number-with-% nor a "% MARKUP" eyebrow may survive the flip.
    const allText = collectText(tree.toJSON()).join(' ');
    expect(allText).not.toMatch(/\d+\s*%\s*markup/i);
  });
});
