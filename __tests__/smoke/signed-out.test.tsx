/**
 * The signed-out entry points.
 *
 * Not a third world state in the spec's sense — it exists to close a hole the
 * landing assertion exposed. Both smoke states are authenticated (they have to
 * be; see primeWorld), so RootLayoutNav bounces /login and /signup home and the
 * every-route suite never renders either of them. Those are the first two
 * screens every user of this app will ever see.
 *
 * Scope is deliberately narrow: the auth screens and the public token-linked
 * destinations RootLayoutNav explicitly allows through unauthenticated
 * (reset-password, prequal-form, accept-invite, claim-crew, and the read-only
 * share viewers). Everything else legitimately redirects when signed out, and
 * asserting that here would just be re-testing the redirect.
 */

import { mountRouteChecked, primeSignedOut } from '@/__tests__/helpers/mountRoute';

/**
 * The unauthenticated allow-list from RootLayoutNav in app/_layout.tsx, plus
 * the two auth screens themselves. Each of these is reachable from an email
 * link by someone with no MAGE account, which is why auth-walling them was a
 * bug the git history records fixing.
 */
const PUBLIC_ROUTES = [
  '/login',
  '/signup',
  '/reset-password',
  '/prequal-form',
  '/accept-invite',
  '/claim-crew',
  '/shared-schedule',
  '/shared-photos',
  '/shared-estimate',
];

describe('signed-out entry points', () => {
  it.each(PUBLIC_ROUTES)('%s mounts with no session', async (href) => {
    await primeSignedOut();
    const tree = await mountRouteChecked(href);
    // Must NOT be bounced. A public destination that redirects to /login is a
    // dead link in someone's inbox — the exact failure the allow-list in
    // RootLayoutNav exists to prevent.
    expect(tree.getPathname()).toBe(href);
  });
});
