/**
 * Wave 6d restore (d6r), lane Z1 — the phone proof for the print-fit roots.
 *
 * Lane Z1 gives the Schedule Pro Gantt tab (components/schedule/tabs/GanttTab)
 * and the classic GanttChart a `ref` and a print spread on their root View
 * (hooks/usePrintFit), so Cmd+P on desktop web zooms a Gantt wider than the
 * sheet to fit it. On iOS / Android the hook returns `{}` props and registers
 * no listener, and a ref adds nothing to the rendered tree — so NOTHING here
 * may change.
 *
 * GOLDEN — recorded FIRST, on a pristine copy of the untouched base (6a77feee,
 * the d6r phase-A integration commit), before a line of lane Z1 was written,
 * and never regenerated:
 *   - GanttTab at iOS 390 (the phone branch: InteractiveGantt mode="phone");
 *   - GanttTab at web 820 (the tablet split with its local layout bar);
 *   - GanttTab at Android 1000 × 700 (the native tablet);
 *   - GanttTab at native 1512 (isDesktop on a device that is not a browser:
 *     the Pro canvas — controlled split, compact rows — measured at 1448);
 *   - GanttChart at iOS 390, Android 820 and native 1512 (viewportWidth 1200).
 * The components are mounted ALONE (the w6c-schedule-canvas / -classic
 * fixtures): no route whose screen another lane edits is snapshotted.
 *
 * What a snapshot records: one line per host node — type, every style
 * FLATTENED, every primitive or small-object prop, handlers dropped — reduced
 * to its line count and sha256. Set Z1_DUMP_DIR to write the dumps for a line
 * diff.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ProjectSchedule, ScheduleTask } from '@/types';
import { runCpmForCalendar } from '@/utils/cpm';
import { SchedulerProvider } from '@/components/schedule/SchedulerContext';
import { GanttTab } from '@/components/schedule/tabs/GanttTab';
import GanttChart from '@/components/schedule/GanttChart';

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

// The real light palette without ThemeProvider's AsyncStorage hydrate.
jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
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

// Pin the clock (Date only — timers stay real) so the today line and the
// header ticks do not move between the recording and the check.
const NOW = new Date(2026, 8, 16, 10, 0, 0); // Wed 16 Sep 2026, local
// jest's `window` has no event target; GridPane's web paste listener needs one.
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
function small(v: unknown): string | null {
  try {
    const j = JSON.stringify(v);
    return j !== undefined && j.length <= 600 ? j : null;
  } catch { return null; }
}
function dumpLines(node: unknown, depth: number, out: string[]): void {
  if (node == null) return;
  if (Array.isArray(node)) { for (const n of node) dumpLines(n, depth, out); return; }
  const pad = ' '.repeat(Math.min(depth, 200));
  if (typeof node !== 'object') { out.push(`${pad}"${String(node)}"`); return; }
  const el = node as { type: string; props: Record<string, unknown>; children: unknown };
  const parts: string[] = [];
  for (const k of Object.keys(el.props ?? {}).sort()) {
    const v = el.props[k];
    if (v === undefined || typeof v === 'function' || k === 'children') continue;
    if (/style$/i.test(k) && v != null && typeof v === 'object') { parts.push(`${k}=${small(flat(v)) ?? '<big>'}`); continue; }
    if (typeof v === 'string') { parts.push(`${k}=${JSON.stringify(v)}`); continue; }
    if (typeof v !== 'object' || v === null) { parts.push(`${k}=${String(v)}`); continue; }
    parts.push(`${k}=${small(v) ?? '<obj>'}`);
  }
  out.push(`${pad}<${el.type} ${parts.join(' ')}>`);
  dumpLines(el.children, depth + 1, out);
}
function fingerprint(name: string, json: unknown): { lines: number; sha256: string } {
  const out: string[] = [];
  dumpLines(json, 0, out);
  const text = out.join('\n');
  const dir = process.env.Z1_DUMP_DIR;
  if (dir) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/${name.replace(/[^a-z0-9]+/gi, '_')}.txt`, text);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sha256 = require('node:crypto').createHash('sha256').update(text).digest('hex');
  return { lines: out.length, sha256 };
}

// ── Fixture: Henderson, a small real job (the w6c-schedule-canvas one) ─────
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

/** Let the mount's AsyncStorage reads (grid width, colour mode) land. */
async function settle() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

function ganttTab(pro: boolean) {
  return (
    <Wrap>
      <SchedulerProvider schedule={SCHEDULE} cpm={contextCpm}>
        <GanttTab
          projectStartDate={startDate}
          workingDaysPerWeek={5}
          nonWorkingDates={[]}
          cpm={utilsCpm}
          onEdit={noop}
          onAddTask={noop}
          onDeleteTask={noop}
          {...(pro ? { layout: 'split' as const, density: 'compact' as const } : null)}
        />
      </SchedulerProvider>
    </Wrap>
  );
}

// ═══ GOLDEN — recorded on the untouched base ═══════════════════════════════
describe('lane Z1 — golden: the Schedule Pro Gantt tab (GanttTab)', () => {
  jest.setTimeout(120000);

  it.each([
    ['iOS 390 (phone branch)', 'ios', 390, 844, false],
    ['web 820 (tablet split, local layout bar)', 'web', 820, 900, false],
    ['Android 1000 x 700 (native tablet)', 'android', 1000, 700, false],
    ['native 1512 (the Pro canvas on a device that is not a browser)', 'ios', 1512, 945, true],
  ] as const)('%s renders exactly as before', async (name, os, w, h, pro) => {
    env(os, w, h);
    const r = render(ganttTab(pro));
    await settle();
    const root = r.queryByTestId('gantt-tab-root');
    if (root) {
      await act(async () => {
        fireEvent(root, 'layout', { nativeEvent: { layout: { width: 1448, height: 800, x: 0, y: 0 } } });
      });
      await settle();
    }
    expect(fingerprint(`gantt-tab-${name}`, r.toJSON())).toMatchSnapshot();
    r.unmount();
  });
});

describe('lane Z1 — golden: the classic GanttChart', () => {
  jest.setTimeout(120000);

  it.each([
    ['iOS 390', 'ios', 390, 844, undefined],
    ['Android 820', 'android', 820, 1180, undefined],
    ['native 1512 (viewportWidth 1200)', 'ios', 1512, 945, 1200],
  ] as const)('%s renders exactly as before', async (name, os, w, h, viewportWidth) => {
    env(os, w, h);
    const r = render(
      <Wrap>
        <View style={{ width: w, height: h }}>
          <GanttChart
            schedule={SCHEDULE}
            tasks={TASKS}
            projectStartDate={startDate}
            onTaskPress={noop}
            showBaseline={false}
            {...(viewportWidth ? { viewportWidth } : null)}
          />
        </View>
      </Wrap>,
    );
    await settle();
    expect(fingerprint(`gantt-chart-${name}`, r.toJSON())).toMatchSnapshot();
    r.unmount();
  });
});
