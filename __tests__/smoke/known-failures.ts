/**
 * __tests__/smoke/known-failures.ts
 *
 * THIS FILE IS A BUG LIST. It is not configuration and it is not a suppression
 * mechanism to be topped up when the suite is inconvenient.
 *
 * Every entry is a route that crashes on mount today, with the actual thrown
 * message recorded next to it. The suite stays green on this known state so
 * that a NEW breakage stands out immediately — a red run means someone broke
 * something this week, not that the repo has been red since August.
 *
 * Rules, and they matter:
 *
 *  1. An entry must carry the real error. "flaky" is not an error.
 *  2. Fixing a route means DELETING its entry. The suite enforces this: a route
 *     listed here that mounts cleanly fails the run as UNEXPECTED PASS. The
 *     list cannot rot into a graveyard of long-fixed routes.
 *  3. Adding an entry is a decision to ship a broken screen. Say so in the PR.
 *
 * The list shrinking over time is the entire point.
 */

export type KnownFailure = {
  /** The href as produced by __tests__/helpers/routes.ts. */
  href: string;
  /** Which world state fails. Some routes crash only with data. */
  states: ('empty' | 'populated')[];
  /** The actual thrown message, trimmed. Regex-matched, so keep it specific. */
  error: string;
  /** Where it throws, for whoever picks it up. */
  where: string;
};

export const KNOWN_FAILURES: KnownFailure[] = [];

export function knownFailureFor(
  href: string,
  state: 'empty' | 'populated'
): KnownFailure | undefined {
  return KNOWN_FAILURES.find((f) => f.href === href && f.states.includes(state));
}
