/**
 * Wave 6c, lane DA — the Schedule Pro canvas components.
 *
 * The founder, on a 1512 × 945 MacBook: "the scheduler does not work well";
 * "when doing the schedules or picking a subtab the boxes are so stretched out
 * and it looks terrible". Lane DA rebuilds the components behind the Pro
 * canvas (GanttTab, GridPane, InteractiveGantt, SchedulerTabShell, the menus)
 * behind NEW, OPTIONAL, default-off props; lane DB wires them into
 * app/schedule-pro.tsx. So there are two kinds of proof here.
 *
 *  1. GOLDEN — recorded FIRST, on the untouched base (38733f08), before a
 *     single line of this lane was written, and never regenerated except for
 *     the one delta the spec names (DashboardTab's content cap:
 *     ContentWidth.reading 1040 → Layout.page.dashboard 1280). They mount:
 *       - app/shared-schedule.tsx from a token at 390 native and 390 web (the
 *         phone list), and at 1000 native (InteractiveGantt's own default
 *         path: 56 / 56 / 26 rows, its toolbar, 240 px gutter);
 *       - ScheduleRowMenu visible at 390 on iOS (plus the ActionSheetIOS call
 *         the hook fires) and on Android (the bottom sheet);
 *       - SchedulerTabShell on each of Timeline / List / Overview / Board at
 *         native 1000 × 700 (the Android-tablet legacy path lane DB keeps
 *         verbatim) and at web 820.
 *     Every new prop defaults to today's value, so every one must still match.
 *
 *  2. DESKTOP at web 1512 × 945 — the new props, asserted on rendered styles.
 *
 * What a snapshot records: every style prop FLATTENED (a `false` left by
 * `isDesktop && …` renders nothing), handler props dropped (a handler is
 * behaviour, not pixels — and a fresh closure every render), undefined props
 * dropped. Date is pinned so the today line and the header ticks are stable.
 */

import React from 'react';
import { ActionSheetIOS, Dimensions, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ProjectSchedule, ScheduleTask } from '@/types';
import { runCpmForCalendar } from '@/utils/cpm';
import { buildSharePayload, encodeShareToken } from '@/utils/scheduleOps';
import { SchedulerTabShell, type SchedulerTabShellProps } from '@/components/schedule/SchedulerTabShell';
import { ScheduleRowMenu, useScheduleRowMenu, type RowMenuAction } from '@/components/schedule/ScheduleRowMenu';
import { SchedulerMenuBar } from '@/components/schedule/SchedulerMenuBar';
import type { GanttTabHandle } from '@/components/schedule/tabs/GanttTab';
import { buildSchedulePreviewOverlay } from '@/utils/schedulePreviewOverlay';
import SharedScheduleScreen from '@/app/shared-schedule';

// ── The layout gate: a width + a web flag, exactly like the app's hook ──────
let mockWidth = 390;
let mockHeight = 844;
let mockWeb = false;
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => {
    const isDesktop = mockWidth >= 1024 || (mockWeb && mockWidth >= 900);
    const isTablet = !isDesktop && mockWidth >= 768;
    return {
      screenSize: isDesktop ? 'desktop' : isTablet ? 'tablet' : 'phone',
      isPhone: !isDesktop && !isTablet,
      isTablet,
      isDesktop,
      width: mockWidth,
      height: mockHeight,
      contentMaxWidth: isDesktop ? 1280 : isTablet ? 900 : mockWidth,
      sidebarWidth: isDesktop ? 240 : 0,
      showSidebar: isDesktop,
      ganttRowHeight: isDesktop ? 40 : isTablet ? 36 : 32,
    };
  },
}));

// The real light palette without ThemeProvider's AsyncStorage hydrate (an
// async setState between renders trips "overlapping act() calls").
jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});

// shared-schedule reads its token from the route and draws a Stack header.
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    useLocalSearchParams: () => mockParams,
    useRouter: () => ({ back: () => {}, push: () => {}, replace: () => {}, canGoBack: () => false }),
    Stack: { Screen: () => null },
  };
});

// ── Environment ────────────────────────────────────────────────────────────
let restoreOS: (() => void) | null = null;
function env(os: 'ios' | 'android' | 'web', width: number, height: number) {
  restoreOS?.();
  restoreOS = os === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', os).restore;
  mockWidth = width;
  mockHeight = height;
  mockWeb = os === 'web';
  Dimensions.set({
    window: { width, height, scale: 2, fontScale: 1 },
    screen: { width, height, scale: 2, fontScale: 1 },
  });
}

// Pin the clock (Date only — timers stay real) so "today", the today line and
// the header's day ticks do not move between the recording and the check.
const NOW = new Date(2026, 8, 16, 10, 0, 0); // Wed 16 Sep 2026, local
// jest's `window` has no event target; GridPane's web paste listener and the
// sidebar-inset resize listener need one. Installed only where missing.
const win = globalThis as unknown as { window?: Record<string, unknown> };
const addedListeners: string[] = [];
beforeAll(() => {
  if (win.window && typeof win.window.addEventListener !== 'function') {
    win.window.addEventListener = () => {};
    win.window.removeEventListener = () => {};
    addedListeners.push('addEventListener', 'removeEventListener');
  }
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate',
      'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
    ],
  });
});
afterAll(() => {
  jest.useRealTimers();
  for (const k of addedListeners) delete win.window?.[k];
});
afterEach(() => {
  restoreOS?.();
  restoreOS = null;
});

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const Wrap = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
);

// ── What a snapshot records ────────────────────────────────────────────────
const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;
function seen(node: unknown): unknown {
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(seen);
  const el = node as { type: string; props: Record<string, unknown>; children: unknown };
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(el.props ?? {})) {
    if (v === undefined || typeof v === 'function') continue;
    props[k] = /style$/i.test(k) && v != null && typeof v === 'object' ? flat(v) : v;
  }
  return { type: el.type, props, children: seen(el.children) };
}

// ── Fixture: a small real job (6 tasks, a milestone, a deadline) ───────────
const START = '2026-09-07'; // a Monday
const task = (o: Partial<ScheduleTask> & { id: string; title: string; startDay: number; durationDays: number }): ScheduleTask => ({
  phase: 'Framing', progress: 0, crew: 'Crew A', dependencies: [], notes: '', status: 'not_started', ...o,
} as ScheduleTask);
const TASKS: ScheduleTask[] = [
  task({ id: 't1', title: 'Demo', startDay: 1, durationDays: 3, phase: 'Demo', status: 'done', progress: 100 }),
  task({ id: 't2', title: 'Framing', startDay: 4, durationDays: 5, dependencies: ['t1'], status: 'in_progress', progress: 40 }),
  task({ id: 't3', title: 'Rough-in electrical', startDay: 9, durationDays: 4, dependencies: ['t2'], phase: 'MEP', crew: 'Sparky Co' }),
  task({ id: 't4', title: 'Rough inspection', startDay: 13, durationDays: 0, dependencies: ['t3'], isMilestone: true, phase: 'Inspections' }),
  task({ id: 't5', title: 'Drywall', startDay: 13, durationDays: 5, dependencies: ['t4'], phase: 'Interior', deadline: '2026-10-09' }),
  task({ id: 't6', title: 'Prime and paint', startDay: 18, durationDays: 3, dependencies: ['t5'], phase: 'Finishes' }),
];
const startDate = new Date(2026, 8, 7);
const utilsCpm = runCpmForCalendar(TASKS, startDate, 5, []);
const SCHEDULE: ProjectSchedule = {
  id: 's1', name: 'Henderson schedule', projectId: 'p1', startDate: START,
  workingDaysPerWeek: 5, bufferDays: 0, tasks: TASKS,
  totalDurationDays: 20, criticalPathDays: 20, laborAlignmentScore: 0, riskItems: [],
} as unknown as ProjectSchedule;
const contextCpm = {
  criticalPathDays: 20,
  slipDaysVsBaseline: null,
  criticalTaskIds: [...utilsCpm.perTask.entries()].filter(([, r]) => r.isCritical).map(([id]) => id),
};
const noop = () => {};
const ACTIONS = {
  onAddTask: noop, onImport: noop, onReflow: noop, onClosures: noop,
  onCriticalPath: noop, onBaseline: noop, onWeather: noop, onLevelResources: noop, onHistory: noop,
  onExport: noop, onShare: noop, onAI: noop,
};
function shellProps(extra: Partial<SchedulerTabShellProps> = {}): SchedulerTabShellProps {
  return {
    schedule: SCHEDULE,
    contextCpm,
    projectName: 'Henderson',
    onExportPress: noop,
    onBaselinePress: noop,
    actions: ACTIONS,
    projectStartDate: startDate,
    workingDaysPerWeek: 5,
    nonWorkingDates: [],
    utilsCpm,
    onEdit: noop,
    onAddTask: noop,
    onAddTasks: () => [],
    onDeleteTask: noop,
    onBulkDelete: noop,
    onBulkShiftDays: noop,
    ...extra,
  };
}

/** Let the mount's AsyncStorage reads (column widths, colour mode) land. */
async function settle() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

// ═══ 1. GOLDEN — phone and legacy paths ════════════════════════════════════

describe('golden: shared-schedule (InteractiveGantt\'s only non-Pro consumer)', () => {
  const token = encodeShareToken(buildSharePayload('Henderson', startDate, TASKS, { workingDaysPerWeek: 5 }));

  it.each([
    ['390 native (iOS)', 'ios', 390, 844],
    ['390 web', 'web', 390, 844],
    ['1000 native (Android tablet: the full Gantt, toolbar, 240 gutter)', 'android', 1000, 700],
  ] as const)('%s renders exactly as before', async (_name, os, w, h) => {
    env(os, w, h);
    mockParams = { t: token };
    const r = render(<Wrap><SharedScheduleScreen /></Wrap>);
    await settle();
    expect(seen(r.toJSON())).toMatchSnapshot();
  });
});

describe('golden: ScheduleRowMenu at 390', () => {
  const ACTS: RowMenuAction[] = [
    { key: 'indent', label: 'Indent', onPress: noop },
    { key: 'del', label: 'Delete', destructive: true, onPress: noop },
  ];

  it('iOS: the hook fires ActionSheetIOS with the same options', () => {
    env('ios', 390, 844);
    const spy = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
    let handled: boolean | null = null;
    function Probe() {
      const present = useScheduleRowMenu();
      handled = present('Framing', ACTS);
      return null;
    }
    render(<Wrap><Probe /></Wrap>);
    expect(handled).toBe(true);
    expect(spy.mock.calls[0][0]).toMatchSnapshot();
    spy.mockRestore();
  });

  it.each([['iOS', 'ios'], ['Android', 'android']] as const)('%s: the modal sheet renders exactly as before', async (_n, os) => {
    env(os, 390, 844);
    const r = render(<Wrap><ScheduleRowMenu visible title="Framing" actions={ACTS} onClose={noop} /></Wrap>);
    await settle();
    expect(seen(r.toJSON())).toMatchSnapshot();
  });
});

describe('golden: SchedulerTabShell legacy chrome', () => {
  // Which menu holds each tab, as SchedulerMenuBar draws them.
  const NAV: Record<string, [string, string] | null> = {
    overview: null,
    timeline: ['Plan ▾', 'Timeline'],
    list: ['Plan ▾', 'List'],
    board: ['Plan ▾', 'Board'],
  };
  const ENVS = [
    ['native 1000x700 (Android tablet)', 'android', 1000, 700],
    ['web 820', 'web', 820, 900],
  ] as const;
  const cases = ENVS.flatMap(([envName, os, w, h]) =>
    Object.keys(NAV).map((tab) => [`${tab} at ${envName}`, os, w, h, tab] as const));

  it.each(cases)('%s renders exactly as before', async (_name, os, w, h, tab) => {
    env(os, w, h);
    const r = render(<Wrap><View style={{ width: w, height: h }}><SchedulerTabShell {...shellProps()} /></View></Wrap>);
    await settle();
    const nav = NAV[tab];
    if (nav) {
      fireEvent.press(r.getByText(nav[0]));
      fireEvent.press(r.getByText(nav[1]));
      await settle();
    }
    expect(seen(r.toJSON())).toMatchSnapshot();
  });
});

// ═══ 2. DESKTOP — web 1512 × 945, the new props ════════════════════════════

type Inst = { type: unknown; props: Record<string, unknown>; children: (Inst | string)[] };
/** The text of every host <Text> under an instance, outermost first, in order. */
function textsOf(node: Inst | string, out: string[] = []): string[] {
  if (typeof node === 'string') return out;
  if (node.type === 'Text') {
    const collect = (n: Inst | string): string => (typeof n === 'string' ? n : n.children.map(collect).join(''));
    out.push(node.children.map(collect).join(''));
    return out;
  }
  node.children.forEach(c => textsOf(c, out));
  return out;
}
const styleOf = (el: { props: Record<string, unknown> }) => flat(el.props.style);
async function layoutRow(r: ReturnType<typeof render>, width: number) {
  await act(async () => {
    fireEvent(r.getByTestId('gantt-tab-root'), 'layout', { nativeEvent: { layout: { width, height: 800, x: 0, y: 0 } } });
  });
}
const PRO = { desktopChrome: 'toolbar' as const, view: 'split' as const, density: 'compact' as const };

describe('desktop 1512 × 945 web: the wave-6c canvas props', () => {
  beforeEach(() => env('web', 1512, 945));

  it("desktopChrome 'toolbar' renders neither SchedulerMenuBar nor SchedulerHeader", async () => {
    const r = render(<Wrap><SchedulerTabShell {...shellProps()} /></Wrap>);
    await settle();
    expect(r.queryByText('Plan ▾')).not.toBeNull();
    expect(r.queryByText('BASELINE')).not.toBeNull();

    r.rerender(<Wrap><SchedulerTabShell {...shellProps(PRO)} /></Wrap>);
    await settle();
    expect(r.queryByText('Plan ▾')).toBeNull();
    expect(r.queryByText('Track ▾')).toBeNull();
    expect(r.queryByText('BASELINE')).toBeNull();
    // The controlled view is the Timeline split, with no local layout bar and
    // no Gantt toolbar (its zoom / Fit / Today come through ganttRef).
    expect(r.queryByTestId('gantt-split-grid')).not.toBeNull();
    expect(r.queryByText('Living Plan')).toBeNull();
    expect(r.queryByText('Fit')).toBeNull();
    // The colour toggle moved to the 24 px footer strip.
    expect(r.queryByTestId('gantt-colormode-trade')).not.toBeNull();
  });

  it('the split grid is 520 with the pane closed and 400 | 600 | 440 with it open (W = 1448)', async () => {
    const r = render(<Wrap><SchedulerTabShell {...shellProps(PRO)} /></Wrap>);
    await settle();
    await layoutRow(r, 1448);
    expect(styleOf(r.getByTestId('gantt-split-grid')).width).toBe(520);
    expect(r.queryByTestId('gantt-pane-slot')).toBeNull();

    r.rerender(<Wrap><SchedulerTabShell {...shellProps({ ...PRO, paneOpen: true })} /></Wrap>);
    await settle();
    expect(styleOf(r.getByTestId('gantt-split-grid')).width).toBe(400);
    expect(styleOf(r.getByTestId('gantt-split-timeline')).width).toBe(600);
    expect(styleOf(r.getByTestId('gantt-pane-slot')).width).toBe(440);
    expect(styleOf(r.getByTestId('gantt-split-divider')).width).toBe(8);
  });

  it("GridPane's first visible header texts are Task Name · Dur. · Start · Finish ('#' leads from 440)", async () => {
    const r = render(<Wrap><SchedulerTabShell {...shellProps({ ...PRO, paneOpen: true })} /></Wrap>);
    await settle();
    await layoutRow(r, 1448);
    const header = () => textsOf(r.getByTestId('gantt-split-grid') as unknown as Inst);
    expect(header().slice(0, 4)).toEqual(['Task Name', 'Dur.', 'Start', 'Finish']);

    r.rerender(<Wrap><SchedulerTabShell {...shellProps(PRO)} /></Wrap>);
    await settle();
    expect(header().slice(0, 5)).toEqual(['#', 'Task Name', 'Dur.', 'Start', 'Finish']);
  });

  it('compact density: 32 px rows under a 48 px header, in the grid and the Gantt alike', async () => {
    const r = render(<Wrap><SchedulerTabShell {...shellProps(PRO)} /></Wrap>);
    await settle();
    await layoutRow(r, 1448);
    expect(styleOf(r.getByTestId('grid-row-0')).height).toBe(32);
    expect(styleOf(r.getByTestId('grid-row-5')).height).toBe(32);
    r.rerender(<Wrap><SchedulerTabShell {...shellProps({ ...PRO, density: 'comfortable' })} /></Wrap>);
    await settle();
    expect(styleOf(r.getByTestId('grid-row-0')).height).toBe(40);
  });

  it('the TODAY pill and line paint above the sticky day header they share a stacking parent with', async () => {
    const r = render(<Wrap><SchedulerTabShell {...shellProps(PRO)} /></Wrap>);
    await settle();
    await layoutRow(r, 1448);
    type Node = { type: unknown; props: Record<string, unknown>; parent: Node | null };
    const hostParent = (n: Node) => { let p = n.parent; while (p && typeof p.type !== 'string') p = p.parent; return p; };
    const hosts = (r.UNSAFE_root as unknown as { findAll: (f: (n: Node) => boolean) => Node[] })
      .findAll((n) => typeof n.type === 'string');
    // The pill: the host View around the 'TODAY' text (a full-height line sits beside it).
    const pill = hostParent(r.getByText('TODAY') as unknown as Node)!;
    const canvas = hostParent(pill);
    const line = hosts.find((n) => hostParent(n) === canvas && flat(n.props.style).bottom === 0 && flat(n.props.style).width === 1.5)!;
    // The Gantt's day header: the one sticky child of that same stacking parent.
    const sticky = hosts.filter((n) => hostParent(n) === canvas && (flat(n.props.style) as Record<string, unknown>).position === 'sticky');
    expect(sticky).toHaveLength(1);
    expect(line).toBeDefined();
    const headerZ = Number(flat(sticky[0].props.style).zIndex);
    expect(Number(flat(pill.props.style).zIndex)).toBeGreaterThan(headerZ);
    expect(Number(flat(line.props.style).zIndex)).toBeGreaterThan(headerZ);
    // The bars (2, focused 10, dragged 20) stay under it: they scroll beneath the dates.
    expect(headerZ).toBeGreaterThan(20);
  });

  it('grid and Gantt reach the same bottom: Gantt content = 48 + rows + 16, beside a 40 px ghost row', async () => {
    const r = render(<Wrap><SchedulerTabShell {...shellProps(PRO)} /></Wrap>);
    await settle();
    await layoutRow(r, 1448);
    // Grid max scrollTop = rows + 40 − (pane − 2 − 48); Gantt max = 48 + rows +
    // tail − (pane − 2 − 24). Equal only with a 16 px tail (utils/scheduleProLayout).
    expect(styleOf(r.getByTestId('grid-ghost-row')).height).toBe(40);
    const heights = r.UNSAFE_getAllByType(ScrollView)
      .map(sv => flat(sv.props.contentContainerStyle as StyleProp<ViewStyle>).height)
      .filter((h): h is number => typeof h === 'number');
    expect(heights).toContain(48 + TASKS.length * 32 + 16);
  });

  it('a preview renders gantt-preview-* marks and a Proposed grid row, all in row slots', async () => {
    const after: ScheduleTask[] = [
      ...TASKS.map(t => (t.id === 't3' ? { ...t, durationDays: 6 } : t)),
      task({ id: 'n1', title: 'Punch walk', startDay: 21, durationDays: 1, dependencies: ['t6'], phase: 'Closeout' }),
    ];
    const cpmAfter = runCpmForCalendar(after, startDate, 5, []);
    const preview = buildSchedulePreviewOverlay(TASKS, after, utilsCpm, cpmAfter);
    expect(preview.moved.map(m => m.id)).toContain('t3');
    expect(preview.finishDeltaDays).toBeGreaterThan(0);

    const r = render(<Wrap><SchedulerTabShell {...shellProps({ ...PRO, preview })} /></Wrap>);
    await settle();
    await layoutRow(r, 1448);
    // Every rippled bar gets a dashed outline at its NEW span, in its own row
    // (t3 is row 2: 48 header + 2 × 32 + 6), labelled "proposed".
    const moved = r.getByTestId('gantt-preview-moved-t3');
    expect(styleOf(moved).top).toBe(48 + 2 * 32 + 6);
    const m3 = preview.moved.find(m => m.id === 't3')!;
    expect(m3.toEf).toBeGreaterThan(m3.fromEf);
    expect(r.getAllByText('proposed')).toHaveLength(preview.moved.length);
    const added = r.getByTestId('gantt-preview-added-n1');
    // The first row under the 6 task rows: 48 header + 6 × 32 + (32 − 20) / 2.
    expect(styleOf(added).top).toBe(48 + 6 * 32 + 6);
    expect(r.getByText('+ Punch walk')).toBeTruthy();
    expect(r.getByTestId('gantt-preview-finish')).toBeTruthy();
    expect(r.getByText(`Finish +${preview.finishDeltaDays}d`)).toBeTruthy();
    expect(r.getByTestId('grid-preview-row-0')).toBeTruthy();
    expect(r.getByText('Proposed · Punch walk')).toBeTruthy();
  });

  it('ganttRef exposes zoomIn / zoomOut / fit / today / scrollToTask', async () => {
    const ref = React.createRef<GanttTabHandle>();
    const r = render(<Wrap><SchedulerTabShell {...shellProps({ ...PRO, ganttRef: ref })} /></Wrap>);
    await settle();
    expect(ref.current).not.toBeNull();
    for (const k of ['zoomIn', 'zoomOut', 'fit', 'today', 'scrollToTask'] as const) expect(typeof ref.current?.[k]).toBe('function');
    await act(async () => { ref.current?.zoomIn(); ref.current?.fit(); ref.current?.today(); ref.current?.scrollToTask('t2'); });
    expect(r.queryByTestId('gantt-split-grid')).not.toBeNull();
  });

  it('the Overview drops the "link a budget" EV card only when hasBudget is false', async () => {
    const r = render(<Wrap><SchedulerTabShell {...shellProps({ desktopChrome: 'toolbar', view: 'overview', hasBudget: false })} /></Wrap>);
    await settle();
    expect(r.queryByText('Earned Value')).toBeNull();
    expect(r.queryByText('Tasks by Status')).not.toBeNull();
    r.rerender(<Wrap><SchedulerTabShell {...shellProps({ desktopChrome: 'toolbar', view: 'overview' })} /></Wrap>);
    await settle();
    expect(r.queryByText('Earned Value')).not.toBeNull();
  });

  it('a right-click menu opens at the pointer as a 220-280 px popover, pulled inside the window', async () => {
    const ACTS: RowMenuAction[] = [
      { key: 'indent', label: 'Indent', onPress: noop },
      { key: 'del', label: 'Delete', destructive: true, onPress: noop },
    ];
    const r = render(<Wrap><ScheduleRowMenu visible title="Framing" actions={ACTS} onClose={noop} anchor={{ x: 1400, y: 900 }} /></Wrap>);
    await settle();
    const pop = styleOf(r.getByTestId('schedule-row-menu-popover'));
    expect(pop.minWidth).toBe(220);
    expect(pop.maxWidth).toBe(280);
    expect(pop.left).toBe(1512 - 280 - 8);
    expect(pop.top).toBeLessThanOrEqual(945 - 8 - 2 * 34);
    // No anchor (a long-press): today's sheet.
    r.rerender(<Wrap><ScheduleRowMenu visible title="Framing" actions={ACTS} onClose={noop} /></Wrap>);
    await settle();
    expect(r.queryByTestId('schedule-row-menu-popover')).toBeNull();
  });

  it("SchedulerMenuBar: actionsOnly drops the views; Share lists the classic view only when it is wired", async () => {
    const withClassic = { ...ACTIONS, openClassic: noop };
    const r = render(<Wrap><SchedulerMenuBar active="timeline" onSelectView={noop} actions={withClassic} actionsOnly /></Wrap>);
    await settle();
    fireEvent.press(r.getByText('Plan ▾'));
    await settle();
    expect(r.queryByText('Timeline')).toBeNull();
    expect(r.queryByText('Add task')).not.toBeNull();
    fireEvent.press(r.getByText('Share ▾'));
    await settle();
    expect(r.queryByText('Today & lookahead (classic)')).not.toBeNull();
  });

  it('SchedulerMenuBar: no openClassic, no classic item; the views stay without actionsOnly', async () => {
    const r = render(<Wrap><SchedulerMenuBar active="timeline" onSelectView={noop} actions={ACTIONS} /></Wrap>);
    await settle();
    fireEvent.press(r.getByText('Share ▾'));
    await settle();
    expect(r.queryByText('Today & lookahead (classic)')).toBeNull();
    fireEvent.press(r.getByText('Plan ▾'));
    await settle();
    expect(r.queryByText('Timeline')).not.toBeNull();
  });
});
