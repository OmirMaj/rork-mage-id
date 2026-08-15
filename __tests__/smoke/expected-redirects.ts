/**
 * __tests__/smoke/expected-redirects.ts
 *
 * Routes that deliberately send the smoke user somewhere else, and where to.
 *
 * This table exists to close a hole that would otherwise make the whole suite
 * untrustworthy. "The route mounted without throwing" is only meaningful if the
 * route that mounted is the route we asked for. RootLayoutNav redirects on
 * auth, persona and onboarding state — so if the smoke session ever silently
 * stops working, all 183 routes would render /login, throw nothing, and report
 * a perfectly green run over a single screen.
 *
 * Asserting the landing pathname turns that from an invisible failure into a
 * loud one: 179 unexpected redirects instead of 179 passes.
 *
 * Measured, not guessed — these are the only routes that moved across a full
 * run of both states.
 */

export type ExpectedRedirect = {
  from: string;
  to: string;
  why: string;
  /** Which world states redirect. Some only redirect when a param is missing. */
  states: ('empty' | 'populated')[];
};

export const EXPECTED_REDIRECTS: ExpectedRedirect[] = [
  {
    from: '/login',
    to: '/',
    why:
      'RootLayoutNav bounces an authenticated user off the auth screens '
      + '("Already authenticated — redirecting to home"). Both smoke states are '
      + 'signed in, so /login is covered by signed-out.test.tsx instead.',
    states: ['empty', 'populated'],
  },
  {
    from: '/signup',
    to: '/',
    why: 'Same auth bounce as /login. Covered by signed-out.test.tsx.',
    states: ['empty', 'populated'],
  },
  {
    from: '/dev-seeder',
    to: '/',
    why: 'Developer-only sample-data tool; it navigates home once it has run.',
    states: ['empty', 'populated'],
  },
  {
    from: '/dev-flagship-seeder',
    to: '/',
    why: 'Developer-only sample-data tool; it navigates home once it has run.',
    states: ['empty', 'populated'],
  },
  {
    from: '/project-files',
    to: '/',
    why:
      'Per-project drive with no project to show. This is the "dead-end without '
      + 'a projectId" class the spec cites, handled correctly — it sends you '
      + 'somewhere useful instead of rendering an empty shell. Only in the empty '
      + 'state; with ?projectId= it stays put.',
    states: ['empty'],
  },
];

export function expectedRedirectFor(
  href: string,
  state: 'empty' | 'populated'
): ExpectedRedirect | undefined {
  return EXPECTED_REDIRECTS.find((r) => r.from === href && r.states.includes(state));
}
