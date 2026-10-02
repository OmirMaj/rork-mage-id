/**
 * __tests__/helpers/testClock.ts — pin the clock for a test whose fixtures carry a date.
 *
 * The rule: a test with a dated fixture pins the clock to the day the fixture (and
 * any golden) was written for. Otherwise it passes on that day and fails on every
 * other one — CI went red twice on 2026-09-30 for this alone.
 *
 *   render() suites:  pinDateOnly('2026-09-28') at module scope.
 *   route suites:     mountRoute(url, { now }) / mountRouteChecked(url, { now })
 *                     (see mountRoute.tsx: renderRouter re-installs fake timers on
 *                     every mount, so a module-scope pin does not survive it).
 *   dates relative to whatever "today" is: localDayIso(Date.now(), n).
 *
 * Check a suite with `bash scripts/run-smoke-shifted.sh` (the shifted-clock detector).
 *
 * This module must stay importable by bun (scripts/validate-test-clock.ts): it only
 * touches `jest` inside pinDateOnly's body, never at import time.
 */

/**
 * Every fakeable API except Date. Passed as `doNotFake`, so a pin fakes the clock
 * and nothing else: timers, animation frames, microtasks and performance keep
 * running for real, and the screen under test behaves as it does on a device.
 * (Copied verbatim from __tests__/smoke/es-tools-chrome.test.tsx, the first pin.)
 */
export const DATE_ONLY_DO_NOT_FAKE: readonly string[] = Object.freeze([
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'nextTick',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'hrtime',
  'performance',
]);

/** The modern (non-legacy) arm of jest.useFakeTimers' config: the one with doNotFake. */
type ModernFakeTimersConfig = Extract<
  NonNullable<Parameters<typeof jest.useFakeTimers>[0]>,
  { doNotFake?: unknown }
>;

/**
 * Fake Date only, pinned to `isoDay` at `hhmm` LOCAL time (default 15:00 — mid
 * afternoon, so a timezone or a "within the last 8 hours" rule cannot tip the
 * fixture onto the day before or after).
 */
export function pinDateOnly(isoDay: string, hhmm?: string): void {
  jest.useFakeTimers({
    now: new Date(`${isoDay}T${hhmm ?? '15:00'}:00`),
    // jest's type wants its own FakeableAPI union; the list above is exactly
    // those names minus 'Date'.
    doNotFake: DATE_ONLY_DO_NOT_FAKE as unknown as ModernFakeTimersConfig['doNotFake'],
  });
}

/**
 * The LOCAL calendar day of `ms` as YYYY-MM-DD, moved `offsetDays` calendar days
 * (negative = earlier). Local, not UTC: at 23:30 in New York the UTC date is
 * already tomorrow, and the app shows the local one.
 */
export function localDayIso(ms: number, offsetDays?: number): string {
  const d = new Date(ms);
  if (offsetDays) d.setDate(d.getDate() + offsetDays);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
