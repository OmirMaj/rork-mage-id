/**
 * __tests__/smoke/clock-shift-env.test.ts — proves the shifted-clock detector and
 * the clock pins it exists to check.
 *
 * In a normal run (no MAGE_CLOCK_SHIFT_DAYS) it checks that nothing is shifted and
 * that the pins work. Under the detector:
 *   MAGE_CLOCK_SHIFT_DAYS=40 npx jest -w 1 --config jest.config.js \
 *     --testEnvironment ./__tests__/setup/clock-shift-env.native.js \
 *     __tests__/smoke/clock-shift-env.test.ts
 * it also checks the clock really is that many days ahead everywhere a test can
 * read it — and that a pin still wins. The shifted checks skip themselves when the
 * variable is unset, so the file stays green in ship-check.
 *
 * Reference time is jest.getRealSystemTime(): it reads jest's own realm, which
 * the detector does not touch.
 */
import React from 'react';
import { Text } from 'react-native';
import { mountInjectedRoute, mountRoute, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { pinDateOnly, localDayIso, DATE_ONLY_DO_NOT_FAKE } from '@/__tests__/helpers/testClock';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const RAW = process.env.MAGE_CLOCK_SHIFT_DAYS;
const SHIFT_DAYS = RAW && /^[+-]?\d+$/.test(RAW.trim()) ? parseInt(RAW, 10) : 0;
// The detector moves whole LOCAL calendar days, so across a DST change the gap
// is a day count plus or minus one hour; allow that and a minute of run time.
const SLACK_MS = HOUR_MS + 60_000;

// MAGE_CLOCK_DATE / MAGE_CLOCK_AT move the clock by more than whole days, so the
// day-count checks below only run for a pure MAGE_CLOCK_SHIFT_DAYS run.
const OTHER_KNOBS = Boolean(process.env.MAGE_CLOCK_DATE?.trim() || process.env.MAGE_CLOCK_AT?.trim());
const shiftedIt = SHIFT_DAYS !== 0 && !OTHER_KNOBS ? it : it.skip;

function expectShifted(readMs: number) {
  const gap = readMs - jest.getRealSystemTime();
  expect(Math.round(gap / DAY_MS)).toBe(SHIFT_DAYS);
  expect(Math.abs(gap - SHIFT_DAYS * DAY_MS)).toBeLessThanOrEqual(SLACK_MS);
}

/**
 * An injected screen that records the clock it read on its FIRST render (the
 * render a screen that decides "today" at mount would use) and prints it.
 */
let firstRead: string | null = null;
function ClockProbe() {
  const [read] = React.useState(() => new Date().toISOString());
  if (firstRead == null) firstRead = read;
  return React.createElement(Text, { testID: 'clock-probe' }, read);
}
async function mountProbe(opts?: { now?: number }): Promise<number> {
  firstRead = null;
  await primeWorld('empty');
  const tree = mountInjectedRoute('smoke-clock-probe', ClockProbe, opts);
  await settle();
  const shown = tree.getByTestId('clock-probe').props.children as string;
  expect(shown).toBe(firstRead);
  return Date.parse(shown);
}

jest.setTimeout(120_000);

afterEach(() => {
  jest.useRealTimers();
});

describe('the detector is a no-op unless asked', () => {
  const unsetIt = SHIFT_DAYS === 0 && !OTHER_KNOBS ? it : it.skip;
  unsetIt('with MAGE_CLOCK_SHIFT_DAYS unset (or 0), Date.now() is the real time (within 5 s)', () => {
    expect(Math.abs(Date.now() - jest.getRealSystemTime())).toBeLessThan(5_000);
    expect(Math.abs(new Date().getTime() - jest.getRealSystemTime())).toBeLessThan(5_000);
  });
});

describe('under the detector the clock is shifted everywhere a test reads it', () => {
  shiftedIt('with real timers: Date.now() and new Date()', () => {
    expectShifted(Date.now());
    expectShifted(new Date().getTime());
    // A date written in the fixture is not moved.
    expect(new Date('2026-09-28T15:00:00Z').toISOString()).toBe('2026-09-28T15:00:00.000Z');
    expect(new Date(2026, 8, 28).getDate()).toBe(28);
    // Called without `new` it still returns the (shifted) date string.
    expect(typeof Date()).toBe('string');
    expect(new Date() instanceof Date).toBe(true);
  });

  shiftedIt('after jest.useFakeTimers() with no `now`', () => {
    jest.useFakeTimers();
    expectShifted(Date.now());
    expectShifted(new Date().getTime());
  });

  shiftedIt('after jest.useRealTimers()', () => {
    jest.useFakeTimers();
    jest.useRealTimers();
    expectShifted(Date.now());
    expectShifted(new Date().getTime());
  });

  shiftedIt('inside a route mounted through mountInjectedRoute (renderRouter fakes timers)', async () => {
    expectShifted(await mountProbe());
  });
});

describe('a pin wins over the real clock and over the detector', () => {
  it('jest.useFakeTimers({ now }) is honoured exactly', () => {
    const pinned = new Date('2026-09-28T15:00:00').getTime();
    jest.useFakeTimers({ now: pinned });
    expect(Date.now()).toBe(pinned);
  });

  it('the GOLDEN_CLOCK pin (a spy on the outer realm Date.now) seeds a bare useFakeTimers()', () => {
    const GOLDEN_CLOCK = new Date('2026-09-25T16:00:00.000Z').getTime();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const outerFs = require('node:fs') as { readFileSync: { constructor: FunctionConstructor } };
    const OuterDate = outerFs.readFileSync.constructor('return Date')() as DateConstructor;
    expect(OuterDate).not.toBe(Date);
    const spy = jest.spyOn(OuterDate, 'now').mockReturnValue(GOLDEN_CLOCK);
    try {
      jest.useFakeTimers();
      expect(Date.now()).toBe(GOLDEN_CLOCK);
    } finally {
      spy.mockRestore();
    }
  });

  it('pinDateOnly fakes Date at 3 pm local on the fixture day and leaves timers real', () => {
    pinDateOnly('2026-09-28');
    expect(localDayIso(Date.now())).toBe('2026-09-28');
    expect(new Date().getHours()).toBe(15);
    expect(new Date().getMinutes()).toBe(0);
    // Timers stay real: a fake setTimeout would make this count non-zero.
    setTimeout(() => {}, 10_000);
    expect(jest.getTimerCount()).toBe(0);
    expect(DATE_ONLY_DO_NOT_FAKE).not.toContain('Date');
  });

  it('pinDateOnly takes a time of day', () => {
    pinDateOnly('2026-12-31', '23:30');
    expect(localDayIso(Date.now())).toBe('2026-12-31');
    expect(localDayIso(Date.now(), 1)).toBe('2027-01-01');
  });

  it('mountInjectedRoute(..., { now }) renders the pinned day on the first render', async () => {
    const now = new Date('2026-09-28T15:00:00').getTime();
    const read = await mountProbe({ now });
    expect(new Date(read).toISOString().slice(0, 10)).toBe('2026-09-28');
    expect(localDayIso(read)).toBe('2026-09-28');
    // The first render read the pin itself (settle() only advances 6 s after it).
    expect(read).toBeGreaterThanOrEqual(now);
    expect(read - now).toBeLessThanOrEqual(6_000);
  });

  it('mountRoute(url, { now }) starts the fake clock at `now` and still routes', async () => {
    await primeWorld('empty');
    const now = new Date('2026-09-28T15:00:00').getTime();
    const tree = mountRoute('/not-a-real-route-for-the-clock-test', { now });
    expect(Date.now()).toBe(now);
    expect(typeof tree.getPathname()).toBe('string');
  });
});
