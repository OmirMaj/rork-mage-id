/**
 * Wave 6c, lane DB — the Schedule Pro screen and its AI pane.
 *
 * The founder, on a 1512 × 945 MacBook: "the scheduler does not work well";
 * "when doing the schedules or picking a subtab the boxes are so stretched out
 * and it looks terrible". Lane DB rebuilds app/schedule-pro.tsx's DESKTOP tree
 * (two toolbar rows, a 0-or-40 px signals row, lane DA's canvas, a docked
 * Change / Ask / Task pane) and gives the schedule sheets their desktop frame.
 * Every one of those edits is `isDesktop ? <desktop/> : <today's JSX>`, a
 * sheet frame whose phone branch is null, or a new prop that defaults to
 * today's behaviour — so on the iPhone NOTHING may change. Part 1 is the
 * proof.
 *
 *  1. GOLDEN — recorded FIRST, on the untouched base (bdd5daee), before a
 *     single line of this lane was written, and never regenerated:
 *       - /schedule-pro?projectId at 390 iOS (the narrow gate);
 *       - /schedule at 390 with the "Tell me what to change" sheet open
 *         (the real ScheduleEditPanel, presentation defaulting to 'modal');
 *       - /copilot?capabilityId=schedule at 390 (CopilotShell, no autoSubmitSeed);
 *       - the SubUpdates / Weather / EV cards, their sheets, the weather
 *         reschedule preview and ScheduleShareSheet, mounted alone at 390;
 *       - /schedule-pro at native 1000 × 700 (the legacy branch, which the
 *         iPhone cannot reach but an Android tablet can).
 *     Component cases render every <Modal>'s content open or not (so each
 *     sheet is in the tree in its phone styles, with its handle and slide
 *     literal); route cases render only the visible ones.
 *
 *  2. DESKTOP — the new tree at 1512 × 945 and 1366 × 768 (Platform stays
 *     native: expo-router reads window.location on web, so the desktop-web
 *     switch is forced, as w6c-field-phone does).
 *
 * What a snapshot records: one line per host node — type, every style
 * FLATTENED, every primitive or small-object prop, handlers dropped — reduced
 * to its line count and sha256 (a whole-app tree is too big for a literal).
 * Set W6C_DUMP_DIR to write the dumps for a line diff.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { world } from '@/__tests__/fixtures/world';
import type { Project, ScheduleTask, SubScheduleUpdate } from '@/types';
import type { ScheduleEvSnapshot } from '@/utils/scheduleEarnedValue';
import type { DayForecast } from '@/utils/weatherService';
import type { WeatherRescheduleResult } from '@/utils/weatherReschedule';

// ── The layout gate: a width + a web flag, exactly like the app's hook ──────
let mockWidth = 390;
let mockHeight = 844;
let mockWeb = false;
let mockSidebar = 240;
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
      sidebarWidth: isDesktop ? mockSidebar : 0,
      showSidebar: isDesktop,
      ganttRowHeight: isDesktop ? 40 : isTablet ? 36 : 32,
    };
  },
}));

// useIsDesktopWeb(): the app's own answer (false on iOS/Android) unless a
// desktop case forces it.
let mockForceDesktopWeb = false;
jest.mock('@/components/ui/desktop', () => {
  const actual = jest.requireActual('@/components/ui/desktop');
  return { ...actual, useIsDesktopWeb: () => (mockForceDesktopWeb ? actual.useIsDesktop() : actual.useIsDesktopWeb()) };
});

// <Modal>: records visible / transparent / animationType / presentationStyle.
// With mockModalAll its content renders open or closed (component goldens);
// otherwise only an open Modal renders its content (route goldens).
let mockModalAll = false;
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const ReactActual = jest.requireActual('react');
  const { View: RNView, Text: RNText } = jest.requireActual('react-native');
  class Boundary extends ReactActual.Component<{ children?: React.ReactNode }, { threw: boolean }> {
    state = { threw: false };
    static getDerivedStateFromError() { return { threw: true }; }
    componentDidCatch() { /* recorded as a placeholder; identical before and after */ }
    render() {
      return this.state.threw
        ? ReactActual.createElement(RNText, { testID: 'modal-body-threw' }, 'modal-body-threw')
        : this.props.children;
    }
  }
  function Modal(props: Record<string, unknown> & { children?: React.ReactNode }) {
    const { children, visible, transparent, animationType, presentationStyle } = props;
    const show = mockModalAll || visible !== false;
    return ReactActual.createElement(
      RNView,
      {
        testID: 'w6c-modal',
        accessibilityHint: JSON.stringify({ visible: visible ?? null, transparent: transparent ?? null, animationType: animationType ?? null, presentationStyle: presentationStyle ?? null }),
      },
      show ? ReactActual.createElement(Boundary, null, children) : null,
    );
  }
  return { __esModule: true, default: Modal };
});

// The AI edge: the desktop cases drive the real editor / assistant through
// it. Default: no answer (nothing on the phone mounts calls it).
const mockMageAI = jest.fn(async (..._a: unknown[]): Promise<unknown> => ({ success: false, error: 'no AI in this test' }));
jest.mock('@/utils/mageAI', () => ({ mageAI: (...a: unknown[]) => mockMageAI(...a) }));
jest.mock('@/utils/aiRateLimiter', () => ({
  ...jest.requireActual('@/utils/aiRateLimiter'),
  checkAILimit: jest.fn(async () => ({ allowed: true })),
  recordAIUsage: jest.fn(async () => undefined),
}));

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

// Both clocks pinned (see w6c-field-phone: renderRouter's fake clock starts
// from the OUTER realm's Date.now, which this realm's spy never reaches).
const NOW = new Date('2026-09-16T14:00:00.000Z').getTime(); // Wed 16 Sep 2026
// eslint-disable-next-line @typescript-eslint/no-require-imports
const outerFs = require('node:fs') as { readFileSync: { constructor: FunctionConstructor } };
const OuterDate = outerFs.readFileSync.constructor('return Date')() as DateConstructor;
let nowSpy: jest.SpyInstance | null = null;
let outerNowSpy: jest.SpyInstance | null = null;
beforeEach(() => {
  jest.useRealTimers();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  outerNowSpy = OuterDate === Date ? null : jest.spyOn(OuterDate, 'now').mockReturnValue(NOW);
  allowConsoleErrors();
});
afterEach(() => {
  mockForceDesktopWeb = false;
  mockModalAll = false;
  mockSidebar = 240;
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
  restoreOS?.();
  restoreOS = null;
});

// ── What a snapshot records ────────────────────────────────────────────────
const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;
const volatile = (s: string) => s
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, (m) => (m === world.project.id ? m : '<uuid>'))
  .replace(/\b\d{13}[a-z0-9]{0,12}\b/g, '<ts-id>');
function small(v: unknown): string | null {
  try {
    const j = JSON.stringify(v);
    return j !== undefined && j.length <= 600 ? volatile(j) : null;
  } catch { return null; }
}
function dumpLines(node: unknown, depth: number, out: string[]): void {
  if (node == null) return;
  if (Array.isArray(node)) { for (const n of node) dumpLines(n, depth, out); return; }
  const pad = ' '.repeat(Math.min(depth, 200));
  if (typeof node !== 'object') { out.push(`${pad}"${volatile(String(node))}"`); return; }
  const el = node as { type: string; props: Record<string, unknown>; children: unknown };
  const parts: string[] = [];
  for (const k of Object.keys(el.props ?? {}).sort()) {
    const v = el.props[k];
    if (v === undefined || typeof v === 'function' || k === 'children' || k === 'screenId') continue;
    if (/style$/i.test(k) && v != null && typeof v === 'object') { parts.push(`${k}=${small(flat(v)) ?? '<big>'}`); continue; }
    if (typeof v === 'string') { parts.push(`${k}=${JSON.stringify(volatile(v))}`); continue; }
    if (typeof v !== 'object' || v === null) { parts.push(`${k}=${String(v)}`); continue; }
    parts.push(`${k}=${small(v) ?? '<obj>'}`);
  }
  out.push(`${pad}<${el.type} ${parts.join(' ')}>`);
  dumpLines(el.children, depth + 1, out);
}
/** `undo`: text replacements applied to the dump BEFORE hashing — how a case
 *  whose spec names a delta proves it is identical apart from that delta,
 *  against the golden recorded on the untouched base (never regenerated). */
function fingerprint(name: string, json: unknown, undo?: Array<[string, string]>): { lines: number; sha256: string } {
  const out: string[] = [];
  dumpLines(json, 0, out);
  let text = out.join('\n');
  lastDump = text;
  for (const [from, to] of undo ?? []) text = text.split(from).join(to);
  const dir = process.env.W6C_DUMP_DIR;
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

let lastDump = '';

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

// ── Fixture: Henderson, a dated 8-task job with an EV budget ───────────────
const PID = 'p-henderson';
const START = '2026-09-07'; // a Monday
const task = (o: Partial<ScheduleTask> & { id: string; title: string; startDay: number; durationDays: number }): ScheduleTask => ({
  phase: 'Interior', progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started', ...o,
} as ScheduleTask);
const TASKS: ScheduleTask[] = [
  task({ id: 't1', title: 'Demo', startDay: 1, durationDays: 3, phase: 'Demo', status: 'done', progress: 100 }),
  task({ id: 't2', title: 'Framing', startDay: 4, durationDays: 5, dependencies: ['t1'], phase: 'Framing', status: 'in_progress', progress: 40 }),
  task({ id: 't3', title: 'Rough-in electrical', startDay: 9, durationDays: 4, dependencies: ['t2'], phase: 'MEP', crew: 'Sparky Co' }),
  task({ id: 't4', title: 'Rough inspection', startDay: 13, durationDays: 0, dependencies: ['t3'], isMilestone: true, phase: 'Inspections' }),
  task({ id: 't5', title: 'Pour garage slab', startDay: 13, durationDays: 2, dependencies: ['t4'], phase: 'Sitework', isWeatherSensitive: true }),
  task({ id: 't6', title: 'Drywall', startDay: 15, durationDays: 5, dependencies: ['t5'] }),
  task({ id: 't7', title: 'Prime and paint', startDay: 20, durationDays: 3, dependencies: ['t6'], phase: 'Finishes' }),
  task({ id: 't8', title: 'Punch walk', startDay: 23, durationDays: 1, dependencies: ['t7'], phase: 'Closeout' }),
];
const henderson: Project = {
  ...(world.project as Project),
  id: PID,
  name: 'Henderson',
  schedule: {
    id: `${PID}-s`, name: 'Henderson schedule', projectId: PID,
    startDate: START, workingDaysPerWeek: 5, bufferDays: 0,
    tasks: TASKS, totalDurationDays: 23, criticalPathDays: 23, laborAlignmentScore: 0, riskItems: [],
  },
} as unknown as Project;

async function seedHenderson() {
  await primeWorld('empty');
  await AsyncStorage.setItem('mageid_projects', JSON.stringify([henderson]));
}

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const Wrap = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{children}</ThemeProvider></SafeAreaProvider>
);

// Component fixtures.
const SUB_UPDATES: SubScheduleUpdate[] = [
  { id: 'su1', projectId: PID, taskId: 't3', subName: 'Sparky Co', forDate: '2026-09-16', progressPercent: 60, hoursWorked: 8, crewCount: 3, notes: 'Panel set, homeruns pulled.', blocker: 'Waiting on the inspector window.', postedAt: '2026-09-16T12:00:00.000Z' } as SubScheduleUpdate,
  { id: 'su2', projectId: PID, taskId: 't2', subName: 'Framers LLC', forDate: '2026-09-15', progressPercent: 80, postedAt: '2026-09-15T20:00:00.000Z' } as SubScheduleUpdate,
];
const RAIN = (date: string): DayForecast => ({ date, condition: 'rain', tempHigh: 58, tempLow: 49, precipChance: 90, windSpeed: 14, isWorkable: false, icon: '🌧️', source: 'live' });
const CLEAR = (date: string): DayForecast => ({ date, condition: 'clear', tempHigh: 70, tempLow: 52, precipChance: 0, windSpeed: 4, isWorkable: true, icon: '☀️', source: 'live' });
// t5 (startDay 13 → Sat 19 Sep on a plain date add) — rain on 19 and 20.
const FORECAST: DayForecast[] = ['2026-09-17', '2026-09-18'].map(CLEAR)
  .concat(['2026-09-19', '2026-09-20'].map(RAIN))
  .concat(['2026-09-21', '2026-09-22', '2026-09-23'].map(CLEAR));
const EV: ScheduleEvSnapshot = {
  perTask: new Map([
    ['t2', { taskId: 't2', budgetedCost: 24000, earnedValue: 9600, items: [{ id: 'e1', description: 'Framing labor', carry: 24000 }] }],
    ['t3', { taskId: 't3', budgetedCost: 12000, earnedValue: 0, items: [{ id: 'e2', description: 'Electrical rough', carry: 12000 }] }],
  ]),
  totalBudget: 36000,
  totalEarnedValue: 9600,
  totalPlannedValue: 10400,
  spi: 0.92,
  cpi: 1.04,
  actualCost: 9230,
  costBasis: { grounded: true, reason: 'grounded' },
  collectedToDate: 0,
  dayCursor: 10,
} as unknown as ScheduleEvSnapshot;
const WEATHER_RESULT = {
  tasks: TASKS,
  impacts: [
    { taskId: 't5', title: 'Pour garage slab', phase: 'Sitework', directlyHit: true, worstCondition: 'rain', badDates: ['2026-09-19', '2026-09-20'], originalStartDay: 13, newStartDay: 15, startSlipDays: 2, weatherDelayDays: 2 },
    { taskId: 't6', title: 'Drywall', phase: 'Interior', directlyHit: false, badDates: [], originalStartDay: 15, newStartDay: 17, startSlipDays: 2, weatherDelayDays: 0 },
  ],
  projectSlipDays: 2,
  directHitCount: 1,
  cascadedCount: 1,
  affectedDates: ['2026-09-19', '2026-09-20'],
  liveAffectedDates: ['2026-09-19', '2026-09-20'],
  simulatedAffectedDates: [],
  forecastSource: 'live',
} as unknown as WeatherRescheduleResult;

// ═══ 1. GOLDEN — the phone (and the legacy native-tablet branch) ═══════════
describe('lane DB — golden (recorded on the untouched base)', () => {
  jest.setTimeout(120000);

  it('/schedule-pro?projectId at 390 iOS: the narrow gate', async () => {
    env('ios', 390, 844);
    await seedHenderson();
    const tree = await mountRouteChecked(`/schedule-pro?projectId=${PID}`);
    await pump();
    expect(screen.getByTestId('schedule-pro-open-classic')).toBeTruthy();
    expect(fingerprint('schedule-pro-390', tree.toJSON())).toMatchSnapshot();
  });

  it('/schedule at 390 with the "Tell me what to change" sheet open (ScheduleEditPanel, modal)', async () => {
    env('ios', 390, 844);
    await seedHenderson();
    const seed = 'Add a drywall inspection after drywall';
    const tree = await mountRouteChecked(`/schedule?projectId=${PID}&focus=golden1&editSeed=${encodeURIComponent(seed)}`);
    await pump();
    expect(screen.getByTestId('mobile-schedule-copilot-bar')).toBeTruthy();
    expect(screen.getByTestId('schedule-edit-sheet')).toBeTruthy();
    expect(fingerprint('mobile-schedule-edit-sheet-390', tree.toJSON())).toMatchSnapshot();
  });

  it('/copilot?capabilityId=schedule at 390 (CopilotShell, no autoSubmitSeed)', async () => {
    env('ios', 390, 844);
    await seedHenderson();
    const tree = await mountRouteChecked(`/copilot?capabilityId=schedule&projectId=${PID}`);
    await pump();
    expect(screen.getByTestId('copilot-compose')).toBeTruthy();
    expect(fingerprint('copilot-schedule-390', tree.toJSON())).toMatchSnapshot();
  });

  it('/schedule-pro at native 1000 × 700 (the legacy branch)', async () => {
    env('android', 1000, 700);
    await seedHenderson();
    const tree = await mountRouteChecked(`/schedule-pro?projectId=${PID}`);
    await pump();
    expect(screen.queryByTestId('schedule-pro-open-classic')).toBeNull();
    expect(screen.getByText('Tell me what to change')).toBeTruthy();
    // THE ONE NAMED DELTA (spec D2 d: "It applies to both branches"): the
    // SchedulerHeader / Overview finish. cpm.projectFinish (calendar index 32
    // from Mon Sep 7 = Thu Oct 8) used to be handed over raw and counted as 32
    // WORKING days — Oct 20, "32 days". It is now the working ordinal 24.
    // Undo exactly that text and the tree must hash to the untouched golden.
    const fp = fingerprint('schedule-pro-native-1000', tree.toJSON(), [
      ['On track to finish about Oct 8, 2026', 'On track to finish about Oct 20, 2026'],
      ['"Oct 8, 2026"', '"Oct 20, 2026"'],
      ['"24 days"', '"32 days"'],
    ]);
    expect(lastDump).toContain('"Oct 8, 2026"');
    expect(lastDump).toContain('"24 days"');
    expect(lastDump).not.toContain('Oct 20, 2026');
    expect(fp).toMatchSnapshot();
  });

  describe('components at 390 (every sheet rendered)', () => {
    beforeEach(() => { env('ios', 390, 844); mockModalAll = true; });

    it('SubUpdatesPanel card + its sheet', async () => {
      await AsyncStorage.setItem(`mageid_sub_updates::${PID}`, JSON.stringify(SUB_UPDATES));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SubUpdatesPanel } = require('@/components/schedule/SubUpdatesPanel');
      const r = render(<Wrap><View><SubUpdatesPanel projectId={PID} tasks={TASKS} /></View></Wrap>);
      await pump(3);
      expect(r.getByTestId('sub-updates-tile')).toBeTruthy();
      expect(fingerprint('sub-updates-390', r.toJSON())).toMatchSnapshot();
    });

    it('WeatherReschedulePrompt banner + its sheet', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { WeatherReschedulePrompt } = require('@/components/schedule/WeatherReschedulePrompt');
      const r = render(<Wrap><View><WeatherReschedulePrompt tasks={TASKS} forecasts={FORECAST} projectStartDate={new Date(2026, 8, 7)} onPushTasks={() => {}} /></View></Wrap>);
      await pump(2);
      expect(r.getByText(/weather-sensitive task/)).toBeTruthy();
      expect(fingerprint('weather-prompt-390', r.toJSON())).toMatchSnapshot();
    });

    it('EarnedValuePanel card + its sheet', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { EarnedValuePanel } = require('@/components/schedule/EarnedValuePanel');
      const r = render(<Wrap><View><EarnedValuePanel snapshot={EV} tasks={TASKS} /></View></Wrap>);
      await pump(2);
      expect(r.getByTestId('ev-panel-open')).toBeTruthy();
      expect(fingerprint('ev-panel-390', r.toJSON())).toMatchSnapshot();
    });

    it('WeatherRescheduleModal, open', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const WeatherRescheduleModal = require('@/components/schedule/WeatherRescheduleModal').default;
      const r = render(<Wrap><View><WeatherRescheduleModal visible result={WEATHER_RESULT} projectStartDate={new Date(2026, 8, 7)} onClose={() => {}} onApply={() => {}} /></View></Wrap>);
      await pump(2);
      expect(r.getByText('Apply reschedule')).toBeTruthy();
      expect(fingerprint('weather-reschedule-modal-390', r.toJSON())).toMatchSnapshot();
    });

    it('ScheduleShareSheet, open (full and by trade)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ScheduleShareSheet = require('@/components/schedule/ScheduleShareSheet').default;
      const r = render(
        <Wrap><View><ScheduleShareSheet visible onClose={() => {}} schedule={henderson.schedule} tasks={TASKS} projectStartDate={new Date(2026, 8, 7)} projectName="Henderson" companyName="Harlow Build" /></View></Wrap>,
      );
      await pump(2);
      expect(fingerprint('share-sheet-full-390', r.toJSON())).toMatchSnapshot();
      fireEvent.press(r.getByText('By Trade'));
      await pump(2);
      expect(fingerprint('share-sheet-trade-390', r.toJSON())).toMatchSnapshot();
    });
  });
});

// ═══ 2. DESKTOP — web 1512 × 945 (Platform native: see the header) ═══════════
type Styled = { props: { style?: unknown; children?: unknown } };
const styleOf = (el: Styled) => flat(el.props.style);
async function layoutRow(width: number) {
  await act(async () => {
    fireEvent(screen.getByTestId('schedule-pro-work-row'), 'layout', { nativeEvent: { layout: { width, height: 760, x: 0, y: 0 } } });
    fireEvent(screen.getByTestId('gantt-tab-root'), 'layout', { nativeEvent: { layout: { width, height: 760, x: 0, y: 0 } } });
  });
  await pump(2);
}
async function desktop(w: number, h: number) {
  env('ios', w, h);
  mockWeb = true;
  mockSidebar = 64; // /schedule-pro defaults to the 64 px rail
  mockForceDesktopWeb = true;
  await seedHenderson();
  await mountRouteChecked(`/schedule-pro?projectId=${PID}`);
  await pump();
}
async function command(text: string) {
  const field = screen.getByTestId('schedule-command-field');
  await act(async () => { fireEvent.changeText(field, text); });
  await act(async () => { fireEvent(screen.getByTestId('schedule-command-field'), 'submitEditing'); });
  await pump();
}
const ADD_INSPECTION = { ops: [{ op: 'addTask', title: 'Drywall inspection', durationDays: 1, after: 't6' }] };

describe('lane DB — desktop 1512 × 945', () => {
  jest.setTimeout(120000);
  beforeEach(() => { mockMageAI.mockClear(); });

  it('two toolbar rows (48 + 40), no menu-bar band, no SchedulerHeader, no 720 pill', async () => {
    await desktop(1512, 945);
    expect(screen.getByTestId('schedule-pro-desktop')).toBeTruthy();
    expect(styleOf(screen.getByTestId('schedule-toolbar-row1') as unknown as Styled).height).toBe(48);
    expect(styleOf(screen.getByTestId('schedule-toolbar-row2') as unknown as Styled).height).toBe(40);
    // The command field: flex, 200–360 wide, 32 high.
    const cmd = styleOf(screen.getByTestId('schedule-command-field') as unknown as Styled);
    expect(cmd).toMatchObject({ minWidth: 200, maxWidth: 360, height: 32 });
    expect(screen.queryByText('BASELINE')).toBeNull(); // SchedulerHeader's KPI strip
    expect(screen.queryByText('Tell me what to change')).toBeNull();
    // Plan ▾ Track ▾ Share ▾ live once, inside Row 2.
    expect(screen.getAllByText(/^Plan/)).toHaveLength(1);
    // The finish in Row 1 is the engine's own date: calendar index 32 from Mon Sep 7 = Thu Oct 8.
    expect(screen.getByText('8 tasks · 8 critical · finish Thu Oct 8')).toBeTruthy();
    // Henderson has no signal to show: the signals row is 0 px.
    expect(styleOf(screen.getByTestId('schedule-signals-empty') as unknown as Styled).height).toBe(0);
  });

  it('the work row has exactly 2 children; grid 520 with the pane closed', async () => {
    await desktop(1512, 945);
    const row = screen.getByTestId('schedule-pro-work-row') as unknown as Styled;
    expect(React.Children.count(row.props.children as React.ReactNode)).toBe(2);
    await layoutRow(1448);
    expect(styleOf(screen.getByTestId('gantt-split-grid') as unknown as Styled).width).toBe(520);
    expect(screen.queryByTestId('gantt-pane-slot')).toBeNull();
    expect(screen.queryByTestId('schedule-pro-pane')).toBeNull();
  });

  it('a change in the command field docks the pane (400 | 600 | 440), draws the proposal, and Apply clears it', async () => {
    mockMageAI.mockImplementation(async () => ({ success: true, data: ADD_INSPECTION }));
    await desktop(1512, 945);
    await layoutRow(1448);
    await command('add a drywall inspection after drywall');
    // Docked over the Gantt's slot: grid 400, Gantt 600, pane 440, no Modal.
    expect(styleOf(screen.getByTestId('gantt-split-grid') as unknown as Styled).width).toBe(400);
    expect(styleOf(screen.getByTestId('gantt-split-timeline') as unknown as Styled).width).toBe(600);
    expect(styleOf(screen.getByTestId('gantt-pane-slot') as unknown as Styled).width).toBe(440);
    const pane = screen.getByTestId('schedule-pro-pane') as unknown as Styled;
    expect(styleOf(pane)).toMatchObject({ position: 'absolute', right: 0, width: 440 });
    expect(screen.getByTestId('schedule-edit-docked')).toBeTruthy();
    expect(screen.queryByTestId('schedule-edit-sheet')).toBeNull();
    // Sent at once (autoSubmitSeed): the review is up and drawn on the Gantt.
    expect(mockMageAI).toHaveBeenCalled();
    expect(screen.getByTestId('schedule-edit-understood')).toBeTruthy();
    expect(screen.getAllByTestId(/^gantt-preview-added-/).length).toBe(1);
    expect(screen.getByTestId('gantt-preview-finish')).toBeTruthy();
    // Apply: the proposal leaves the Gantt, the row lands.
    await act(async () => { fireEvent.press(screen.getByTestId('schedule-edit-apply')); });
    await pump();
    expect(screen.getByTestId('copilot-landed')).toBeTruthy();
    expect(screen.queryAllByTestId(/^gantt-preview-/)).toHaveLength(0);
    // The row landed in the grid, and the landed card names it.
    expect(screen.getAllByText(/Drywall inspection/).length).toBeGreaterThanOrEqual(2);
  });

  it('closing the pane (Discard) removes every preview mark', async () => {
    mockMageAI.mockImplementation(async () => ({ success: true, data: ADD_INSPECTION }));
    await desktop(1512, 945);
    await layoutRow(1448);
    await command('add a drywall inspection after drywall');
    expect(screen.getAllByTestId(/^gantt-preview-/).length).toBeGreaterThan(0);
    await act(async () => { fireEvent.press(screen.getByTestId('schedule-pro-pane-close')); });
    await pump();
    expect(screen.queryByTestId('schedule-pro-pane')).toBeNull();
    expect(screen.queryAllByTestId(/^gantt-preview-/)).toHaveLength(0);
    expect(styleOf(screen.getByTestId('gantt-split-grid') as unknown as Styled).width).toBe(520);
  });

  it("a question opens the Ask tab and asks it (the scheduled start in the prompt)", async () => {
    mockMageAI.mockImplementation(async () => ({ success: true, data: 'Prime and paint drives the finish.' }));
    await desktop(1512, 945);
    await layoutRow(1448);
    await command("what's driving the finish?");
    expect(screen.getByTestId('ai-assistant-embedded')).toBeTruthy();
    expect(screen.getByText('Prime and paint drives the finish.')).toBeTruthy();
    const prompt = String((mockMageAI.mock.calls.at(-1)?.[0] as { prompt?: string } | undefined)?.prompt ?? '');
    expect(prompt).toContain("Question: what's driving the finish?");
    expect(prompt).toContain('start = scheduled working day');
  });
});

describe('lane DB — desktop 1366 × 768 and the narrow gate', () => {
  jest.setTimeout(120000);

  it('1366: the pane still docks (W 1302 ≥ 1288): grid 360, Gantt ≥ 480, pane 440', async () => {
    mockMageAI.mockImplementation(async () => ({ success: true, data: ADD_INSPECTION }));
    await desktop(1366, 768);
    await layoutRow(1302);
    await command('add a drywall inspection after drywall');
    expect(styleOf(screen.getByTestId('gantt-split-grid') as unknown as Styled).width).toBe(360);
    expect(Number(styleOf(screen.getByTestId('gantt-split-timeline') as unknown as Styled).width)).toBeGreaterThanOrEqual(480);
    expect(styleOf(screen.getByTestId('gantt-pane-slot') as unknown as Styled).width).toBe(440);
  });

  it.each([
    ['768 (web tablet width)', 768, 1024],
    ['390 (phone width)', 390, 844],
  ])('%s shows the narrow gate', async (_n, w, h) => {
    env('ios', w, h);
    mockWeb = true;
    await seedHenderson();
    await mountRouteChecked(`/schedule-pro?projectId=${PID}`);
    await pump();
    expect(screen.getByTestId('schedule-pro-open-classic')).toBeTruthy();
    expect(screen.queryByTestId('schedule-pro-desktop')).toBeNull();
  });
});

// ═══ 3. The pure rules the pane and the signals row run on ═══════════════════
describe('lane DB — the pane / signals rules', () => {
  it('a task click opens Task only when the pane is closed or already on Task', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { paneTabOnTaskSelect, schedulePaneTabs } = require('@/components/schedule/desktop/ScheduleAiPane');
    expect(paneTabOnTaskSelect(false, 'change')).toBe('task');
    expect(paneTabOnTaskSelect(false, 'ask')).toBe('task');
    expect(paneTabOnTaskSelect(true, 'task')).toBe('task');
    // An AI review in flight on Change / Ask is never yanked away.
    expect(paneTabOnTaskSelect(true, 'change')).toBeNull();
    expect(paneTabOnTaskSelect(true, 'ask')).toBeNull();
    expect(schedulePaneTabs(false).map((t: { key: string }) => t.key)).toEqual(['change', 'ask']);
    expect(schedulePaneTabs(true).map((t: { key: string }) => t.key)).toEqual(['change', 'ask', 'task']);
  });

  it('the signals row is 0 px unless a chip has something to say', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { signalsPresent } = require('@/components/schedule/desktop/ScheduleSignals');
    const none = { totalBudget: 0, staleRefCount: 0, conflictCount: 0, subPresent: false, weatherPresent: false };
    expect(signalsPresent(none)).toBe(false);
    for (const k of Object.keys(none) as Array<keyof typeof none>) {
      const one = { ...none, [k]: typeof none[k] === 'number' ? 1 : true };
      expect([k, signalsPresent(one)]).toEqual([k, true]);
    }
  });

  it('zoom works on the Split and Gantt views only', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { zoomEnabledFor } = require('@/components/schedule/desktop/ScheduleProToolbar');
    expect(['split', 'gantt', 'list', 'board', 'overview'].map((v) => zoomEnabledFor(v))).toEqual([true, true, false, false, false]);
  });

  it('a preview is handed over when what it SAYS changes, not when an added id is re-minted', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { previewSignature } = require('@/components/copilot/ScheduleDiffView');
    const base = { moved: [{ id: 't7', fromEs: 20, fromEf: 23, toEs: 21, toEf: 24 }], added: [{ id: 'n1', title: 'Drywall inspection', es: 20, ef: 21, isMilestone: false, afterIndex: 5 }], removedIds: [], finishBefore: 32, finishAfter: 33, finishDeltaDays: 1 };
    expect(previewSignature({ ...base, added: [{ ...base.added[0], id: 'n2' }] })).toBe(previewSignature(base));
    expect(previewSignature({ ...base, added: [{ ...base.added[0], es: 21 }] })).not.toBe(previewSignature(base));
    expect(previewSignature({ ...base, moved: [{ ...base.moved[0], toEs: 22 }] })).not.toBe(previewSignature(base));
    expect(previewSignature({ ...base, finishAfter: 34 })).not.toBe(previewSignature(base));
  });

  it('ScheduleSignals: the EV chip "SPI 0.92 · CPI 1.04" when there is a budget, 32 high', async () => {
    env('ios', 1512, 945);
    mockWeb = true;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ScheduleSignals } = require('@/components/schedule/desktop/ScheduleSignals');
    const props = {
      projectId: PID, tasks: TASKS, staleRefCount: 0, onCleanupStaleRefs: () => {}, conflicts: [], onFocusTask: () => {},
      weather: { forecasts: [], projectStartDate: new Date(2026, 8, 7), onPushTasks: () => {} },
      subPresent: false, weatherPresent: false, onSubPresence: () => {}, onWeatherPresence: () => {},
    };
    const r = render(<Wrap><ScheduleSignals {...props} evSnapshot={EV} /></Wrap>);
    await pump(2);
    expect(r.getByTestId('schedule-signals')).toBeTruthy();
    expect(r.getByText('SPI 0.92 · CPI 1.04')).toBeTruthy();
    expect(styleOf(r.getByTestId('ev-chip') as unknown as Styled)).toMatchObject({ height: 32 });
    r.rerender(<Wrap><ScheduleSignals {...props} evSnapshot={{ ...EV, totalBudget: 0 }} /></Wrap>);
    await pump(1);
    expect(styleOf(r.getByTestId('schedule-signals-empty') as unknown as Styled).height).toBe(0);
    expect(r.queryByTestId('ev-chip')).toBeNull();
  });
});
