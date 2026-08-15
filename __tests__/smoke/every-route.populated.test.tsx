/**
 * Stage 5 — every discovered route, POPULATED state.
 *
 * Spec: "Populated — contexts hydrate from the fixture. Exercises list
 * rendering, the populated branches, and anything that only appears with data."
 *
 * Deliberately a separate FILE from the empty run, not a second describe block.
 * Two reasons, one of them load-bearing:
 *
 *  1. app/_layout.tsx builds its QueryClient at module scope, so a jest worker
 *     has exactly one. Keeping each file to a single world state means the
 *     cache is always consistent with the data on disk. (primeWorld also
 *     clears it — belt and braces, because this is the failure that silently
 *     makes one state test the other.)
 *  2. Jest gives each file its own worker, so the two states run in parallel.
 *
 * Project-scoped routes are given `?projectId=`. Without it every screen that
 * belongs to a project renders its "pick a project" chrome and the populated
 * run is a near-copy of the empty one — which would be a lot of runtime for no
 * additional coverage. The id is the fixture's real project, so screens
 * resolve real data rather than dereferencing a dangling reference (a bogus id
 * would manufacture crashes that no real user could reach).
 */

import { discoverRoutes } from '@/__tests__/helpers/routes';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { knownFailureFor } from '@/__tests__/smoke/known-failures';
import { expectedRedirectFor } from '@/__tests__/smoke/expected-redirects';
import { PROJECT_ID, ESTIMATE_ID, PORTAL_TOKEN } from '@/__tests__/fixtures/world';

const routes = discoverRoutes();

/**
 * Params handed to every route in the populated state.
 *
 * All three resolve to real fixture records. A screen that does not read a
 * given param ignores it, so one bag for every route is safe and keeps the run
 * honest — no per-route special-casing that could quietly steer a screen away
 * from the branch it is meant to exercise.
 */
const POPULATED_PARAMS = new URLSearchParams({
  // 64 screens read `projectId`.
  projectId: PROJECT_ID,
  // 10 screens read a bare `id`. On four of them (project-detail,
  // project-scope, client-portal-setup, client-messages) it IS the project id,
  // and project-detail is one of the largest screens in the app — without this
  // it renders "Project not found" and ~2,000 lines go unexercised.
  //
  // On the other six (bid-detail, company-detail, job-detail, worker-detail,
  // messages, public-profile-setup) it is an id of a different kind, so they
  // see an id that resolves to nothing. That is deliberate and it is REAL: a
  // deep link to a record that has since been deleted is an everyday
  // occurrence, and the app already has stale-id handling elsewhere
  // (ToolProjectPicker's staleProjectId). If one of those screens crashes on
  // it, that is a finding, not a fixture artifact.
  id: PROJECT_ID,
  estimateId: ESTIMATE_ID,
  // Read-only client/sub share viewers (/shared-schedule, /shared-photos,
  // /shared-estimate) take the token as `t`.
  t: PORTAL_TOKEN,
}).toString();

describe('every route mounts — populated state', () => {
  it.each(routes.map((r) => [r.href, r.file]))('%s', async (href, file) => {
    await primeWorld('populated');

    const known = knownFailureFor(href, 'populated');
    const url = `${href}?${POPULATED_PARAMS}`;

    if (!known) {
      const tree = await mountRouteChecked(url);

      // Landing check — see expected-redirects.ts. Without it, an auth
      // regression that bounced everything to /login would read as 183 passes.
      const landed = tree.getPathname();
      const redirect = expectedRedirectFor(href, 'populated');
      expect(landed).toBe(redirect ? redirect.to : href);
      return;
    }

    let thrown: Error | null = null;
    try {
      await mountRouteChecked(url);
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
