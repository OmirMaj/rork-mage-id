/**
 * Smoothness pass, lane 3 — the Today / Lookahead progress cards.
 *
 * 4a (a data-loss bug): the swipe PanResponder is created once, so it used to
 * capture the FIRST render's task and onProgressUpdate. A swipe then rebuilt
 * the schedule from the task list as it was when the card mounted, silently
 * reverting every other task edited since. The card must now call the LATEST
 * callback with the LATEST task.
 * 4b: feedback first — the haptic fires on the gesture / tap itself, the write
 * a frame later (requestAnimationFrame).
 * 4c: the card says `{ silent: true }`, so the screen's live path does not
 * fire a second haptic.
 */

import React from 'react';
import { PanResponder, type PanResponderCallbacks, type PanResponderGestureState, type GestureResponderEvent } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';
import type { ProjectSchedule, ScheduleTask } from '@/types';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});

jest.mock('@/utils/weatherService', () => ({
  ...jest.requireActual('@/utils/weatherService'),
  getForecastWithFallback: () => Promise.resolve([]),
}));

const events: string[] = [];
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => { events.push('haptic'); return Promise.resolve(); }),
  notificationAsync: jest.fn(() => { events.push('haptic'); return Promise.resolve(); }),
  selectionAsync: jest.fn(() => { events.push('haptic'); return Promise.resolve(); }),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// Capture every PanResponder config the cards create, so the test can drive
// the gesture callbacks directly (the touch-history plumbing is not the point).
const configs: PanResponderCallbacks[] = [];
const realCreate = PanResponder.create;
jest.spyOn(PanResponder, 'create').mockImplementation((cfg: PanResponderCallbacks) => {
  configs.push(cfg);
  return realCreate(cfg);
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TodayView = require('@/components/schedule/TodayView').default as React.ComponentType<Record<string, unknown>>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LookaheadView = require('@/components/schedule/LookaheadView').default as React.ComponentType<Record<string, unknown>>;

// Thursday 2026-09-24, 10:00 local.
const NOW = new Date(2026, 8, 24, 10, 0, 0);
const START = new Date(2026, 8, 21, 8, 0, 0);

function task(progress: number, extra: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id: 't-frame', title: 'Frame walls', phase: 'Framing', durationDays: 20, startDay: 1, progress,
    crew: 'Framers', dependencies: [], notes: '', status: 'in_progress', ...extra,
  } as ScheduleTask;
}
const schedule = (tasks: ScheduleTask[]) => ({ id: 's1', name: 'S', tasks, workingDaysPerWeek: 5, nonWorkingDates: [], totalDurationDays: 30 } as unknown as ProjectSchedule);

const gs = (dx: number) => ({ dx, dy: 0, vx: 0, vy: 0, moveX: 0, moveY: 0, x0: 0, y0: 0, numberActiveTouches: 1, stateID: 1 }) as unknown as PanResponderGestureState;
const ev = {} as GestureResponderEvent;

async function settle() {
  for (let i = 0; i < 4; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  events.length = 0;
  configs.length = 0;
});
afterEach(() => {
  jest.useRealTimers();
});

const VIEWS: Array<[string, React.ComponentType<Record<string, unknown>>, Record<string, unknown>]> = [
  ['TodayView', TodayView, { onPhotoAdded: () => {}, healthScore: 90, daysRemaining: 12 }],
  ['LookaheadView', LookaheadView, {}],
];

describe.each(VIEWS)('%s progress card', (_name, View, extra) => {
  function el(t: ScheduleTask, cb: jest.Mock) {
    return <View tasks={[t]} schedule={schedule([t])} projectStartDate={START} onProgressUpdate={cb} onTaskPress={() => {}} {...extra} />;
  }

  it('a swipe after a re-render writes through the LATEST callback with the LATEST task (4a)', async () => {
    const first = jest.fn((..._a: unknown[]) => { events.push('write'); });
    const second = jest.fn((..._a: unknown[]) => { events.push('write'); });
    const r = render(el(task(10), first));
    await settle();
    expect(configs.length).toBeGreaterThan(0);
    const pan = configs[configs.length - 1];
    // Another edit lands: a new task object and a new screen callback.
    r.rerender(el(task(40, { notes: 'edited' }), second));
    await settle();

    act(() => { pan.onPanResponderGrant?.(ev, gs(0)); });
    act(() => { pan.onPanResponderRelease?.(ev, gs(80)); });

    // Feedback first: the haptic is out, the write has not happened yet.
    expect(events).toEqual(['haptic']);
    expect(second).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(20); });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    const [written, value, opts] = second.mock.calls[0] as [ScheduleTask, number, { silent?: boolean }];
    expect(written.progress).toBe(40);
    expect(written.notes).toBe('edited');
    expect(value).toBe(75); // 40 + 25, rounded up to the next quarter
    expect(opts).toEqual({ silent: true });
    expect(events).toEqual(['haptic', 'write']);
  });

  it('a short swipe writes nothing and fires no haptic', async () => {
    const cb = jest.fn();
    render(el(task(10), cb));
    await settle();
    const pan = configs[configs.length - 1];
    act(() => { pan.onPanResponderGrant?.(ev, gs(0)); pan.onPanResponderRelease?.(ev, gs(20)); });
    act(() => { jest.advanceTimersByTime(20); });
    expect(cb).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('the + tap: one haptic now, the write a frame later, silent', async () => {
    const cb = jest.fn((..._a: unknown[]) => { events.push('write'); });
    const r = render(el(task(30), cb));
    await settle();
    const plus = r.queryByText('+10%') ?? r.getAllByLabelText('Add')[0];
    fireEvent.press(plus);
    expect(events).toEqual(['haptic']);
    expect(cb).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(20); });
    expect(cb).toHaveBeenCalledTimes(1);
    const [written, value, opts] = cb.mock.calls[0] as [ScheduleTask, number, { silent?: boolean }];
    expect(written.id).toBe('t-frame');
    expect(value).toBe(_name === 'TodayView' ? 40 : 55);
    expect(opts).toEqual({ silent: true });
    expect(events).toEqual(['haptic', 'write']);
  });
});
