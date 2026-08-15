/**
 * Stage 4 — every discovered route, EMPTY state.
 *
 * Spec: "Empty — contexts hydrate from nothing. Exercises empty states and the
 * missing-param paths, which is exactly the dead-end class the history shows."
 *
 * One `it` per route so a failure names the route in the reporter output
 * without anyone having to read a stack trace, and so twelve failures read as
 * twelve lines. The route list comes from the filesystem walk, so a screen
 * added next month is covered with no edit here.
 *
 * "Empty" means no DATA. The user is still signed in, still onboarded, still
 * subscribed — see primeWorld() for why all three are non-negotiable (without
 * them the app renders /login, /onboarding, or a paywall instead of the screen,
 * and the whole suite passes over nothing).
 *
 * Routes in known-failures.ts are inverted, not skipped: they must still fail,
 * with the recorded error. Fix one and this file tells you to delete its entry.
 */

import { discoverRoutes } from '@/__tests__/helpers/routes';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { knownFailureFor } from '@/__tests__/smoke/known-failures';

const routes = discoverRoutes();

describe('every route mounts — empty state', () => {
  it.each(routes.map((r) => [r.href, r.file]))('%s', async (href, file) => {
    await primeWorld('empty');

    const known = knownFailureFor(href, 'empty');

    if (!known) {
      // The assertion. mountRouteChecked throws on any crash, including one
      // the app's ErrorBoundary swallowed, with the route name on the front of
      // the message.
      await mountRouteChecked(href);
      return;
    }

    // Inverted: this route is a recorded bug. It has to still be broken, and
    // broken in the recorded way. If it starts passing, the entry is stale and
    // this fails so someone deletes it.
    let thrown: Error | null = null;
    try {
      await mountRouteChecked(href);
    } catch (err) {
      thrown = err as Error;
    }

    if (!thrown) {
      throw new Error(
        `UNEXPECTED PASS: ${href} (${file}) is listed in known-failures.ts but mounts `
          + `cleanly now. Delete its entry — the allowlist is a bug list, not a config file.`
      );
    }
    expect(thrown.message).toMatch(new RegExp(known.error));
  });
});
