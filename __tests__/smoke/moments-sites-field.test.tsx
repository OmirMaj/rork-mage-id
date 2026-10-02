/**
 * Moments, lane MOMFIELD (wave-next W2): the field and closeout sites, mounted
 * inside the real app (the 16-provider stack, the populated fixture world,
 * 390 x 844 iOS).
 *
 * THE PROMISES THIS PROVES
 *   C1  Clocking out your own shift opens a sheet whose slide is the md size
 *       (64% wide), and the out time is taken at RELEASE: the clock moves
 *       five minutes between opening the sheet and confirming, and the row the
 *       server gets carries the later time.
 *   C1  Queued honesty: a write kept on this phone (the queue accepted it)
 *       reads "Clocked out on this phone · sends when online", never the
 *       confirmed "Clocked out · …", and plays no success haptic.
 *   C3  The punch list's close slide is disabled with "Close every punch item
 *       first." while an item is open (the fixture has open items).
 *   C5  With no saved period the lock slide is disabled with its reason; with
 *       a saved one it locks, and the lock is a NEUTRAL result (ink, the lock
 *       icon): "Period locked · Sep 2026", no success haptic.
 *
 * Driven through the screen-reader path (one button, then Confirm): the same
 * state machine the drag feeds (the drag itself is proven in
 * moments-capsule.test.tsx). Every Modal renders its content open or closed
 * (the w6c-field-phone mock), so a sheet's footer is in the tree.
 */

import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, configure, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, SMOKE_USER } from '@/__tests__/fixtures/world';
import * as offlineQueue from '@/utils/offlineQueue';
import { momentHaptic } from '@/utils/moments/haptics';
import * as fieldCopy from '@/utils/moments/sites/fieldCopy';
import { computeWipRow, computeWipPortfolio } from '@/utils/wip';

// The capsule's decorative text (label, result) is hidden from the
// accessibility tree on purpose; query it anyway.
configure({ defaultIncludeHiddenElements: true });

jest.mock('@/components/moments/core/useScreenReaderMode', () => ({ useScreenReaderMode: () => true }));
jest.mock('@/utils/moments/haptics', () => ({ momentHaptic: jest.fn(), announce: jest.fn() }));

let mockWidth = 390;
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => ({
    screenSize: 'phone', isPhone: true, isTablet: false, isDesktop: false,
    width: mockWidth, height: 844, contentMaxWidth: mockWidth, sidebarWidth: 0, showSidebar: false, ganttRowHeight: 32,
  }),
}));

// Every Modal renders its content, open or closed (see the header).
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const ReactActual = jest.requireActual('react');
  const { View: RNView } = jest.requireActual('react-native');
  function Modal(props: Record<string, unknown> & { children?: React.ReactNode }) {
    return ReactActual.createElement(RNView, { testID: 'field-modal' }, props.children);
  }
  return { __esModule: true, default: Modal };
});

// The clock-out screen decides "today's shift" at mount, before setClock can pin
// the fake clock, so the shift is dated from the real current day (a fixed date
// passed only on the day it was written). NOW is 3 pm LOCAL on that day, not the
// real minute: with the real minute, a run between 00:00 and 08:12 put the
// 8h 12m clock-in on the previous day and the summary rendered empty.
const NOW = (() => { const d = new Date(); d.setHours(15, 0, 0, 0); return d.getTime(); })();
const NOW_DAY = (() => {
  const d = new Date(NOW);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

/**
 * renderRouter installs jest's fake timers on mount; their clock is the one
 * every Date.now() / new Date() on the mounted route reads. Pin it (and move
 * it) through setSystemTime, after the mount.
 */
function setClock(ms: number) {
  jest.setSystemTime(ms);
}

beforeEach(() => {
  mockWidth = 390;
  jest.useRealTimers();
  allowConsoleErrors();
  (momentHaptic as jest.Mock).mockClear();
  Dimensions.set({ window: { width: 390, height: 844, scale: 2, fontScale: 1 }, screen: { width: 390, height: 844, scale: 2, fontScale: 1 } });
});
afterEach(() => {
  jest.restoreAllMocks();
});

async function pump(n = 8) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

/** Screen reader on: the track is one button; activate, then Confirm. The
 *  capsule commits only once its rail has been measured (onLayout), which the
 *  test renderer never fires on its own. */
async function confirmSlide(testID: string, width = 250) {
  const height = testID === 'clock-out-slide' ? 52 : 64;
  fireEvent(screen.getByTestId(`${testID}-track`), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height } } });
  await pump(1);
  await act(async () => {
    fireEvent(screen.getByTestId(`${testID}-rail`), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
  });
  await pump(2);
  fireEvent.press(screen.getByTestId(`${testID}-confirm`));
  // The result pill shows after the busy ring, then the sheet closes in
  // onDone after the hold: read the result the moment it appears.
  for (let i = 0; i < 20; i++) {
    await pump(1);
    const el = screen.queryByTestId(`${testID}-result`);
    if (el) return textOf(`${testID}-result`);
  }
  return null;
}

function textOf(id: string): string {
  const el = screen.getByTestId(id);
  const kids = el.props.children;
  return Array.isArray(kids) ? kids.join('') : String(kids);
}
const hapticKinds = () => (momentHaptic as jest.Mock).mock.calls.map((c) => c[0]);

/** The <Sheet> element itself (its onClose is every dismiss: backdrop, back, the close button). */
function sheetOf(testID: string) {
  const el = screen.UNSAFE_getAllByProps({ testID }).find((n) => typeof n.props.onClose === 'function' && 'dismissOnBackdrop' in n.props);
  if (!el) throw new Error(`no <Sheet testID="${testID}">`);
  return el;
}

/**
 * W2 integration (critic 2, issue 6): during the result hold the sheet cannot
 * be dismissed (a dismiss there unmounted the slide, so onDone never ran). Try
 * every dismiss while the result shows; the slide must still be there. Then
 * the hold ends and onDone closes the sheet itself.
 */
async function expectHeldThroughResult(sheetID: string, slideID: string) {
  expect(sheetOf(sheetID).props.dismissOnBackdrop).toBe(false);
  await act(async () => { sheetOf(sheetID).props.onClose(); });
  expect(screen.queryByTestId(slideID)).toBeTruthy();
  for (let i = 0; i < 30 && screen.queryByTestId(slideID); i++) await pump(1);
  expect(screen.queryByTestId(slideID)).toBeNull();
}

const P = `projectId=${PROJECT_ID}`;

describe('moments C1: clocking out', () => {
  jest.setTimeout(120000);

  // 8h 12m on the clock, no break, on the fixture project.
  const CLOCK_IN = new Date(NOW - (8 * 60 + 12) * 60_000).toISOString();
  async function seedShift() {
    await AsyncStorage.setItem('mageid_time_entries', JSON.stringify([{
      id: 'shift-jose', projectId: PROJECT_ID, projectName: 'Smoke project', workerId: 'self', workerName: 'Jose Ramirez',
      trade: 'Carpentry', clockIn: CLOCK_IN, breakMinutes: 0, totalHours: 0, overtimeHours: 0, status: 'clocked_in',
      date: NOW_DAY,
    }]));
  }

  async function openClockOut() {
    await primeWorld('populated');
    await seedShift();
    await mountRouteChecked(`/time-tracking?${P}`);
    setClock(NOW);
    await pump();
    const buttons = screen.getAllByText('Clock out');
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.press(buttons[0]);
    await pump(3);
  }

  it('opens a sheet with the summary sentence and the md slide (64% wide)', async () => {
    await openClockOut();
    expect(textOf('clock-out-summary')).toBe(fieldCopy.clockOutSummary('Jose Ramirez', '8h 12m', '8.20'));
    const root = StyleSheet.flatten(screen.getByTestId('clock-out-slide').props.style) as Record<string, unknown>;
    expect(root.width).toBe('64%');
    expect(root.minWidth).toBe(220);
    expect(textOf('clock-out-slide-label')).toBe(fieldCopy.clockOutSlideLabel());
  });

  it('takes the out time at release, and a queued write reads honestly with no success haptic', async () => {
    const write = jest.spyOn(offlineQueue, 'supabaseWriteDetailed').mockResolvedValue('queued');
    await openClockOut();
    // Five minutes pass with the sheet open, then the slide commits.
    setClock(NOW + 5 * 60_000);
    const result = await confirmSlide('clock-out-slide');
    const call = write.mock.calls.find((c) => c[0] === 'time_entries');
    expect(call).toBeTruthy();
    const row = call![2] as Record<string, unknown>;
    // The release instant (the slide's own settle takes under two seconds),
    // never the moment the sheet opened.
    const out = Date.parse(String(row.clock_out));
    expect(out).toBeGreaterThanOrEqual(NOW + 5 * 60_000);
    expect(out).toBeLessThan(NOW + 5 * 60_000 + 5_000);
    expect(row.total_hours).toBeCloseTo(8.28, 2);
    // Queued: the honest words, never the confirmed title, never success.
    expect(result).toBe(fieldCopy.clockOutQueued());
    expect(result).not.toMatch(/^Clocked out · /);
    expect(hapticKinds()).not.toContain('success');
    // Kept on this phone plays a hold too: the sheet holds until onDone.
    await expectHeldThroughResult('clock-out-sheet', 'clock-out-slide');
  });
});

describe('moments C3: closing the project from the punch list', () => {
  jest.setTimeout(120000);
  it('the close slide is disabled with its reason while a punch item is open', async () => {
    await primeWorld('populated');
    await mountRouteChecked(`/punch-list?${P}`);
    await pump();
    expect(textOf('punch-close-project-slide-label')).toBe(fieldCopy.closeProjectBlocked());
    // Screen reader on: the one button speaks the reason as its hint.
    expect(screen.getByTestId('punch-close-project-slide-rail').props.accessibilityHint).toBe(fieldCopy.closeProjectBlocked());
  });
});

describe('moments C5: locking a WIP period', () => {
  jest.setTimeout(120000);

  async function seedPeriod(lockedAt?: string) {
    const input = { originalContract: 10000000, approvedChangeOrders: 0, totalEstimatedCost: 8000000, costToDate: 4000000, billedToDate: 5000000 };
    const row = { projectId: 'wip-smoke-period-row', projectName: 'Smoke row', input, output: computeWipRow(input as never) };
    await AsyncStorage.setItem(`mageid_wip_periods_${SMOKE_USER.id}`, JSON.stringify([{
      id: 'wip-period-sep', periodEndDate: '2026-09-30', createdAt: '2026-09-28T12:00:00.000Z',
      rows: [row], portfolioTotals: computeWipPortfolio([row as never]), ...(lockedAt ? { lockedAt } : {}),
    }]));
  }
  async function openLock() {
    await mountRouteChecked('/wip-report');
    await pump();
    const lock = screen.getAllByText('Lock');
    fireEvent.press(lock[lock.length - 1]);
    await pump(3);
  }

  it('an already-locked period: the lock slide is disabled with the reason', async () => {
    await primeWorld('populated');
    await seedPeriod('2026-09-28T13:00:00.000Z');
    await openLock();
    // A reason this long wraps whole under the track (never cut to one line).
    expect(textOf('wip-lock-slide-disabled-reason')).toBe(fieldCopy.wipAlreadyLockedReason());
    expect(screen.getByTestId('wip-lock-slide-rail').props.accessibilityHint).toBe(fieldCopy.wipAlreadyLockedReason());
  });

  it('a saved period locks as a neutral result: ink, the lock icon, "Period locked · Sep 2026"', async () => {
    const write = jest.spyOn(offlineQueue, 'supabaseWriteDetailed').mockResolvedValue('synced');
    await primeWorld('populated');
    await seedPeriod();
    await openLock();
    expect(textOf('wip-lock-slide-label')).toBe(fieldCopy.wipLockSlideLabel('September 2026'));
    const result = await confirmSlide('wip-lock-slide');
    expect(write.mock.calls.some((c) => c[0] === 'wip_periods')).toBe(true);
    expect(result).toBe(fieldCopy.wipLockedTitle('Sep 2026'));
    expect(hapticKinds()).not.toContain('success');
    // The confirmed lock holds its sheet through the result; onDone closes it.
    await expectHeldThroughResult('wip-lock-sheet', 'wip-lock-slide');
  });
});
