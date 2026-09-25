/**
 * Wave 6c, lane DC — the classic Schedule tab, the ways into the schedule, and
 * the schedule tool sheets.
 *
 * The founder, on a 1512 × 945 MacBook: "when doing the schedules or picking a
 * subtab the boxes are so stretched out and it looks terrible". Lane DC gives
 * the classic tab a desktop header (project switcher, segmented view tabs, a
 * '+ Task' button), a two-column Today, tiled Lookahead and Board, framed
 * sheets; routes every schedule link to Pro for a Pro tier on desktop web; and
 * frames the 13 tool sheets Pro's menus open. Every one of those edits is
 * `isDesktop && …`, a sheet frame whose phone branch is null, a desktop-only
 * branch, or a `useIsDesktopWeb()` switch — so on the iPhone NOTHING may
 * change. This file is the proof.
 *
 *  1. GOLDEN — recorded FIRST, on the untouched base (bdd5daee), before a
 *     single line of this lane was written, and never regenerated. Each case
 *     mounts a real route inside the real app (the 16-provider stack, the
 *     populated fixture world plus a dated 'Henderson' schedule) at 390 × 844
 *     iOS, or mounts a tool sheet on its own, and records the whole rendered
 *     tree. EVERY <Modal> RENDERS ITS CONTENT, open or not (see the Modal mock
 *     below), so the classic tab's 12 sheets are all in its snapshot.
 *
 *  2. 820 WIDE — the non-desktop tablet branch of the classic tab (isPhone
 *     false, isDesktop false; Android, since the real app/_layout cannot
 *     mount with Platform 'web' here): each of its four view modes. TodayView,
 *     LookaheadView and GanttChart receive their new props only from the
 *     desktop branch, so this must not move either.
 *
 *  3. DESKTOP (1512 × 945, forced layout; Platform stays native because
 *     expo-router cannot run RN-web inside jest — useIsDesktopWeb() is forced
 *     instead) — behaviour and rendered styles, no snapshots.
 *
 * What a snapshot records: every style prop FLATTENED (a `false` left by
 * `isDesktop && …` renders nothing), handler props dropped, undefined props
 * dropped, and the dump reduced to its line count and sha256 (a whole-app
 * tree is past pretty-format's limit). Set W6C_DUMP_DIR to write the dumps.
 * Both clocks are pinned (the GOLDEN_CLOCK pattern from w6c-field-phone).
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, ESTIMATE_ID, world } from '@/__tests__/fixtures/world';
import type { ChangeOrder, Project, ProjectSchedule, ScheduleTask } from '@/types';
import { stashDraft } from '@/utils/autoScheduleFromEstimate';
import { runCpm } from '@/utils/cpm';
import { buildCriticalPathExplanation } from '@/utils/floatExplain';
import { computeScheduleHealthScore } from '@/utils/scheduleHealthScore';

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

// useIsDesktopWeb(): the app's own answer (false on iOS/Android) unless a
// desktop-web case forces it (see the header, section 3).
let mockForceDesktopWeb = false;
jest.mock('@/components/ui/desktop', () => {
  const actual = jest.requireActual('@/components/ui/desktop');
  return { ...actual, useIsDesktopWeb: () => (mockForceDesktopWeb ? actual.useIsDesktop() : actual.useIsDesktopWeb()) };
});

// Every Modal renders its content, open or closed (see the header).
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
    return ReactActual.createElement(
      RNView,
      {
        testID: 'w6c-modal',
        accessibilityHint: JSON.stringify({ visible: visible ?? null, transparent: transparent ?? null, animationType: animationType ?? null, presentationStyle: presentationStyle ?? null }),
      },
      ReactActual.createElement(Boundary, null, children),
    );
  }
  return { __esModule: true, default: Modal };
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

// Two clocks, both pinned (see w6c-field-phone.test.tsx for why the OUTER
// realm's Date.now must be pinned too: renderRouter's fake clock reads it).
const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-24T20:22:00.000Z').getTime();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const outerFs = require('node:fs') as { readFileSync: { constructor: FunctionConstructor } };
const OuterDate = outerFs.readFileSync.constructor('return Date')() as DateConstructor;
let nowSpy: jest.SpyInstance | null = null;
let outerNowSpy: jest.SpyInstance | null = null;
beforeEach(() => {
  jest.useRealTimers();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  outerNowSpy = OuterDate === Date ? null : jest.spyOn(OuterDate, 'now').mockReturnValue(GOLDEN_CLOCK);
  allowConsoleErrors();
});
afterEach(() => {
  mockForceDesktopWeb = false;
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
  restoreOS?.();
  restoreOS = null;
});

// ── What a snapshot records ────────────────────────────────────────────────
const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;
const PID = 'p-henderson';
const KNOWN_IDS = new Set([PROJECT_ID, ESTIMATE_ID]);
const volatile = (s: string) => s
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, (m) => (KNOWN_IDS.has(m) ? m : '<uuid>'))
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
function fingerprint(name: string, json: unknown): { lines: number; sha256: string } {
  const out: string[] = [];
  dumpLines(json, 0, out);
  const text = out.join('\n');
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

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

// ── A dated schedule: Monday 2026-09-14, so the golden clock (Thu 09-24) is
//    working day 9 — one task done, one overdue, one active, two coming up.
const task = (o: Partial<ScheduleTask> & { id: string; title: string; startDay: number; durationDays: number }): ScheduleTask => ({
  phase: 'Interior', progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started', ...o,
} as ScheduleTask);
const TASKS: ScheduleTask[] = [
  task({ id: 't1', title: 'Demo', phase: 'Demolition', startDay: 1, durationDays: 3, status: 'done', progress: 100, crew: 'Demo crew' }),
  task({ id: 't2', title: 'Framing', phase: 'Framing', startDay: 4, durationDays: 4, dependencies: ['t1'], status: 'in_progress', progress: 50, crew: 'Framers' }),
  task({ id: 't3', title: 'Rough-in electrical', phase: 'MEP', startDay: 8, durationDays: 3, dependencies: ['t2'], crew: 'Sparks' }),
  task({ id: 't4', title: 'Cabinets', phase: 'Interior', startDay: 11, durationDays: 4, dependencies: ['t3'] }),
  task({ id: 't5', title: 'Final walk', phase: 'Closeout', startDay: 15, durationDays: 0, dependencies: ['t4'], isMilestone: true }),
];
const SCHEDULE = {
  id: `${PID}-s`, name: 'Henderson schedule', projectId: PID,
  startDate: '2026-09-14', workingDaysPerWeek: 5, bufferDays: 0,
  tasks: TASKS, totalDurationDays: 15, criticalPathDays: 15, laborAlignmentScore: 0, riskItems: [],
} as unknown as ProjectSchedule;
const henderson: Project = {
  ...(world.project as Project),
  id: PID,
  name: 'Henderson',
  schedule: SCHEDULE,
} as unknown as Project;

async function seedHenderson() {
  const raw = await AsyncStorage.getItem('mageid_projects');
  const parsed = raw ? JSON.parse(raw) : [];
  const list: Project[] = Array.isArray(parsed) ? parsed : parsed?.data ?? [];
  const next = [...list.filter((p) => p.id !== PID), henderson];
  await AsyncStorage.setItem('mageid_projects', JSON.stringify(Array.isArray(parsed) ? next : { ...parsed, data: next }));
}

async function route(os: 'ios' | 'android', width: number, height: number, url: string, before?: () => Promise<void>) {
  env(os, width, height);
  await primeWorld('populated');
  await seedHenderson();
  if (before) await before();
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

const SCHED = `/schedule?projectId=${PID}&focus=golden1`;

// ── 1. GOLDEN, phone ───────────────────────────────────────────────────────
describe('lane DC — the phone is unchanged (golden, 390 × 844 iOS)', () => {
  jest.setTimeout(120000);

  it('/(tabs)/schedule (MobileScheduleScreen)', async () => {
    const tree = await route('ios', 390, 844, SCHED);
    expect(fingerprint('phone-schedule', tree.toJSON())).toMatchSnapshot();
  });

  it('/(tabs)/discover/schedule', async () => {
    const tree = await route('ios', 390, 844, '/discover/schedule');
    expect(fingerprint('phone-discover-schedule', tree.toJSON())).toMatchSnapshot();
  });

  it('/schedule-review with a draft', async () => {
    const tree = await route('ios', 390, 844, `/schedule-review?projectId=${PID}`, async () => {
      stashDraft({ schedule: SCHEDULE, tasks: TASKS.map((t) => ({ ...t, rationale: `Why ${t.title}` })), linkedItemCount: 3 });
    });
    expect(fingerprint('phone-schedule-review', tree.toJSON())).toMatchSnapshot();
  });

  it('/schedule-wizard', async () => {
    const tree = await route('ios', 390, 844, `/schedule-wizard?projectId=${PID}`);
    expect(fingerprint('phone-schedule-wizard', tree.toJSON())).toMatchSnapshot();
  });

  it('/copilot-hub', async () => {
    const tree = await route('ios', 390, 844, '/copilot-hub');
    expect(fingerprint('phone-copilot-hub', tree.toJSON())).toMatchSnapshot();
  });
});

// ── The tool sheets, mounted on their own (open) ────────────────────────────
describe('lane DC — the schedule tool sheets (golden, 390 phone)', () => {
  const METRICS = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
  };
  const Wrap = ({ children }: { children: React.ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider><View>{children}</View></ThemeProvider></SafeAreaProvider>
  );
  const noop = () => {};
  const cpm = () => runCpm(TASKS);

  // [name, element factory] — each sheet open, with the smallest real props.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const SHEETS: [string, () => React.ReactElement][] = [
    ['AddTaskModal', () => {
      const { AddTaskModal } = require('@/components/schedule/AddTaskModal');
      return <AddTaskModal visible onCancel={noop} onCreate={noop} tasks={TASKS} />;
    }],
    ['ScheduleAuditModal', () => {
      const { ScheduleAuditModal } = require('@/components/schedule/ScheduleAuditModal');
      return <ScheduleAuditModal visible projectId={PID} onClose={noop} />;
    }],
    ['BaselineManagerModal', () => {
      const BaselineManagerModal = require('@/components/schedule/BaselineManagerModal').default;
      return <BaselineManagerModal visible onClose={noop} baselines={[]} workingTasks={TASKS} onBaselinesChange={noop} onActivate={noop} />;
    }],
    ['ClosuresModal', () => {
      const ClosuresModal = require('@/components/schedule/ClosuresModal').default;
      return <ClosuresModal visible value={['2026-09-18']} scheduleStartIso="2026-09-14" workingDaysPerWeek={5} onClose={noop} onApply={noop} />;
    }],
    ['CriticalPathPanel', () => {
      const { CriticalPathPanel } = require('@/components/schedule/CriticalPathPanel');
      return <CriticalPathPanel visible explanation={buildCriticalPathExplanation(cpm(), TASKS)} onClose={noop} projectStartDate={new Date(2026, 8, 14)} />;
    }],
    ['COScheduleReflowPreviewModal', () => {
      const { COScheduleReflowPreviewModal } = require('@/components/schedule/COScheduleReflowPreviewModal');
      const co = { id: 'co-1', number: 1, status: 'pending', amount: 8400, createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', lineItems: [], projectId: PID, scheduleImpactDays: 3, description: 'Add pantry cabinets' } as unknown as ChangeOrder;
      return <COScheduleReflowPreviewModal visible changeOrder={co} schedule={SCHEDULE} onConfirm={noop} onClose={noop} />;
    }],
    ['ExportSheet', () => {
      const { ExportSheet } = require('@/components/schedule/ExportSheet');
      return <ExportSheet visible onClose={noop} onExportPdf={noop} onExportCsv={noop} onShareLink={noop} onExportIcal={noop} onAirPrint={noop} />;
    }],
    ['QuickBuildModal', () => {
      const QuickBuildModal = require('@/components/schedule/QuickBuildModal').default;
      return <QuickBuildModal visible onClose={noop} onTemplateSelect={noop} />;
    }],
    ['LevelingPreviewModal', () => {
      const { LevelingPreviewModal } = require('@/components/schedule/LevelingPreviewModal');
      const summary = { shiftedCount: 1, maxShiftDays: 2, totalShiftDays: 2, shifts: [{ id: 't4', title: 'Cabinets', fromDay: 11, toDay: 13, deltaDays: 2, pushesFinish: true }] };
      return <LevelingPreviewModal visible summary={summary} projectFinishDelta={2} onApply={noop} onClose={noop} />;
    }],
    ['PredecessorPicker', () => {
      const PredecessorPicker = require('@/components/schedule/PredecessorPicker').default;
      const candidates = TASKS.slice(0, 3).map((t, i) => ({ id: t.id, label: `${i + 1}. ${t.title}`, phase: t.phase }));
      return <PredecessorPicker taskLabel="Cabinets" candidates={candidates} value={[{ taskId: 't3', type: 'FS', lagDays: 0 }]} onChange={noop} onClose={noop} />;
    }],
    ['ScheduleSettingsMenu', () => {
      const ScheduleSettingsMenu = require('@/components/schedule/ScheduleSettingsMenu').default;
      return <ScheduleSettingsMenu visible criticalFloatThresholdDays={0} workingDaysPerWeek={5} startDate="2026-09-14" onClose={noop} onApply={noop} />;
    }],
    ['ScheduleHealthDetail', () => {
      const { ScheduleHealthDetail } = require('@/components/schedule/ScheduleHealthScore');
      const result = computeScheduleHealthScore({ tasks: TASKS, cpm: cpm() } as never);
      return <ScheduleHealthDetail visible onClose={noop} result={result} />;
    }],
  ];
  /* eslint-enable @typescript-eslint/no-require-imports */

  it.each(SHEETS)('%s, open', async (name, make) => {
    env('ios', 390, 844);
    // A sheet mounted on its own has no renderRouter clock: pin this realm's
    // Date (month grids, "today" chips) to the golden clock.
    jest.useFakeTimers({ now: GOLDEN_CLOCK });
    const r = render(<Wrap>{make()}</Wrap>);
    await act(async () => { for (let k = 0; k < 20; k++) await Promise.resolve(); });
    expect(fingerprint(`sheet-${name}`, r.toJSON())).toMatchSnapshot();
  });
});

// ── 2. The non-desktop tablet branch (820 wide) ────────────────────────────
// Android at 820: isPhone false, isDesktop false — the classic ScheduleScreen's
// non-desktop branch, the one web 820 renders. (Platform 'web' cannot mount
// the real app/_layout here: it reads window.location.) ScenariosModal is in
// this tree (the Modal mock renders every sheet), which is its golden: on its
// own it needs the SubscriptionProvider.
describe('lane DC — the classic tab at 820 (tablet branch, golden)', () => {
  jest.setTimeout(120000);
  it.each([['Today', null], ['Lookahead', 'Lookahead'], ['Board', 'Board'], ['Gantt', 'Gantt']] as const)(
    '%s view',
    async (name, tab) => {
      const tree = await route('android', 820, 1180, SCHED);
      if (tab) {
        const hits = screen.queryAllByText(tab);
        expect(hits.length).toBeGreaterThan(0);
        fireEvent.press(hits[0]);
        await pump();
      }
      expect(fingerprint(`tablet820-${name}`, tree.toJSON())).toMatchSnapshot();
    },
  );
});

// ── 3. DESKTOP 1512 × 945 (forced layout) — behaviour and styles ───────────
// isDesktop is true at 1512 on any platform; useIsDesktopWeb() is forced on
// where a case needs the browser half (the redirect, the '+ Task' Button's
// desktop box). Arrivals carry ?classic=<focus> to stay on the classic tab.
const flatOf = (node: { props: { style?: unknown } }) => flat(node.props.style);
/** A host/composite node of the rendered tree (react-test-renderer's own type
 *  ships no .d.ts here). */
type ReactTestInstance = ReturnType<typeof screen.getByTestId>;
// A second job whose Interior phase has six cards (the Board's rows of three).
const PID_D = 'p-desk';
const deskTasks: ScheduleTask[] = [
  ...['Base cabinets', 'Upper cabinets', 'Countertops', 'Backsplash', 'Trim', 'Paint'].map((title, i) =>
    task({ id: `d${i + 1}`, title, phase: 'Interior', startDay: 1 + i * 2, durationDays: 2 })),
];
const deskProject: Project = {
  ...(world.project as Project),
  id: PID_D,
  name: 'Desk job',
  schedule: { ...SCHEDULE, id: `${PID_D}-s`, projectId: PID_D, tasks: deskTasks, totalDurationDays: 12, criticalPathDays: 12 } as ProjectSchedule,
} as unknown as Project;
async function seedDesk() {
  const raw = await AsyncStorage.getItem('mageid_projects');
  const parsed = raw ? JSON.parse(raw) : [];
  const list: Project[] = Array.isArray(parsed) ? parsed : parsed?.data ?? [];
  await AsyncStorage.setItem('mageid_projects', JSON.stringify([...list.filter((p) => p.id !== PID_D), deskProject]));
}
async function desktopAt(
  url: string,
  opts: { web?: boolean; tier?: string; desk?: boolean; raw?: boolean; width?: number; myRole?: Project['myRole'] } = {},
) {
  env('ios', opts.width ?? 1512, 945);
  // A browser window: the desktop layout from 900 (the app's own web rule),
  // not only from 1024 — so a 960 window is desktop web, as in a browser.
  if (opts.web) mockWeb = true;
  mockForceDesktopWeb = opts.web ?? false;
  await primeWorld('populated');
  await seedHenderson();
  if (opts.myRole) {
    const raw = await AsyncStorage.getItem('mageid_projects');
    const parsed = raw ? JSON.parse(raw) : [];
    const list: Project[] = Array.isArray(parsed) ? parsed : parsed?.data ?? [];
    const next = list.map((p) => (p.id === PID ? { ...p, myRole: opts.myRole } : p));
    await AsyncStorage.setItem('mageid_projects', JSON.stringify(Array.isArray(parsed) ? next : { ...parsed, data: next }));
  }
  if (opts.desk) await seedDesk();
  if (opts.tier) await AsyncStorage.setItem('mageid_subscription_tier', opts.tier);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tree = opts.raw ? require('@/__tests__/helpers/mountRoute').mountRoute(url) : await mountRouteChecked(url);
  await pump(8);
  return tree as Awaited<ReturnType<typeof mountRouteChecked>>;
}

describe('lane DC — the classic tab at 1512 (desktop)', () => {
  jest.setTimeout(120000);

  it('header: a 200–360 × 36 project switcher, segmented view tabs, a 40 px \'+ Task\', no 56 px FAB', async () => {
    const tree = await desktopAt(`/schedule?projectId=${PID}&focus=h1&classic=h1`, { web: true });
    const sw = flatOf(screen.getByTestId('schedule-project-switcher'));
    expect(sw.minWidth).toBe(200);
    expect(sw.maxWidth).toBe(360);
    expect(sw.height).toBe(36);
    expect(screen.getByTestId('schedule-view-tabs')).toBeTruthy();
    for (const label of ['Today', 'Lookahead', 'Board', 'Gantt']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    const add = flatOf(screen.getByTestId('schedule-add-task'));
    expect(add.height).toBe(40);
    expect(screen.getByText('+ Task')).toBeTruthy();
    const fabs: unknown[] = [];
    const walk = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      const el = n as { props?: { style?: unknown }; children?: unknown };
      const st = flat(el.props?.style);
      if (st.width === 56 && st.height === 56 && st.borderRadius === 28) fabs.push(el);
      walk(el.children);
    };
    walk(tree.toJSON());
    expect(fabs).toHaveLength(0);
    // The switcher opens Select Project, framed as a 440 dialog.
    fireEvent.press(screen.getByTestId('schedule-project-switcher'));
    await pump(2);
    expect(flatOf(screen.getByTestId('schedule-project-picker')).maxWidth).toBe(440);
  });

  it('Today: a main column capped at 760 and a 360 rail', async () => {
    await desktopAt(`/schedule?projectId=${PID}&focus=t1&classic=t1`);
    expect(flatOf(screen.getByTestId('today-desktop')).flexDirection).toBe('row');
    expect(flatOf(screen.getByTestId('today-main')).maxWidth).toBe(760);
    expect(flatOf(screen.getByTestId('today-rail')).width).toBe(360);
    expect(screen.queryByText('Swipe right on a task to update progress')).toBeNull();
  });

  it('?taskId opens that task\'s detail as a 560 sheet; Edit Task is a 560 sheet with Duration ≤ 120', async () => {
    await desktopAt(`/schedule?projectId=${PID}&focus=k1&classic=k1&taskId=t3`);
    const sheet = screen.getByTestId('schedule-task-detail-sheet');
    expect(flatOf(sheet).maxWidth).toBe(560);
    // …and its Modal is the one open.
    type Up = { props: { testID?: string; accessibilityHint?: string }; parent: unknown } | null;
    let m = sheet as unknown as Up;
    while (m && m.props.testID !== 'w6c-modal') m = m.parent as Up;
    expect(JSON.parse(m?.props.accessibilityHint ?? '{}').visible).toBe(true);
    expect(screen.getAllByText('Rough-in electrical').length).toBeGreaterThan(0);
    expect(screen.getByTestId('schedule-detail-progress')).toBeTruthy();
    fireEvent.press(screen.getAllByText('Edit Task')[0]);
    await pump(2);
    // The Edit Task card: the ancestor of its title with the frame's cap.
    let node: { props: { style?: unknown }; parent: unknown } | null = screen.getAllByText('Edit Task').map((t) => t as unknown as { props: { style?: unknown }; parent: unknown }).pop() ?? null;
    let card: { props: { style?: unknown } } | null = null;
    while (node) { if (flatOf(node).maxWidth === 560) { card = node; break; } node = node.parent as typeof node; }
    expect(card).not.toBeNull();
    const numberInputs = screen.UNSAFE_root.findAll((n: ReactTestInstance) => n.props?.keyboardType === 'number-pad' && typeof n.type !== 'string' && flat(n.props.style).maxWidth === 120);
    expect(numberInputs.length).toBeGreaterThanOrEqual(2);
  });

  it('an unknown ?taskId is ignored: the schedule opens, no sheet', async () => {
    await desktopAt(`/schedule?projectId=${PID}&focus=u1&classic=u1&taskId=nope`);
    expect(screen.getByTestId('schedule-view-tabs')).toBeTruthy();
    // (Every Modal's frame renders under this file's Modal mock; the sheet's
    // CONTENT renders only when a task is open.)
    expect(screen.queryByTestId('schedule-detail-progress')).toBeNull();
  });

  it('Lookahead: weeks tile three across (320–440 each) at 1,232', async () => {
    await desktopAt(`/schedule?projectId=${PID}&focus=l1&classic=l1`);
    fireEvent(screen.getByTestId('schedule-view-tabs'), 'layout', { nativeEvent: { layout: { width: 400 } } });
    fireEvent.press(screen.getAllByText('Lookahead')[0]);
    await pump(2);
    const grid = screen.getByTestId('lookahead-week-grid');
    fireEvent(grid, 'layout', { nativeEvent: { layout: { width: 1232 } } });
    await pump(1);
    const tiles = (screen.getByTestId('lookahead-week-grid').children as { props: { style?: unknown } }[]);
    expect(tiles.length).toBe(3);
    for (const t of tiles) {
      const w = flatOf(t).width as number;
      expect(w).toBeGreaterThanOrEqual(320);
      expect(w).toBeLessThanOrEqual(440);
    }
  });

  it('Board: one phase\'s cards in rows of three at 1,232', async () => {
    await desktopAt(`/schedule?projectId=${PID_D}&focus=b1&classic=b1`, { desk: true });
    fireEvent(screen.getByTestId('schedule-main-panel'), 'layout', { nativeEvent: { layout: { width: 1232 } } });
    fireEvent.press(screen.getAllByText('Board')[0]);
    await pump(2);
    const titles = ['Base cabinets', 'Upper cabinets', 'Countertops', 'Backsplash', 'Trim', 'Paint'];
    for (const t of titles) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    // Six Interior cards → two TileGrid rows of three.
    const rows = screen.UNSAFE_root.findAll((n: ReactTestInstance) => typeof n.type !== 'string' && (n.type as { name?: string }).name === 'TileGrid');
    const counts = rows.map((r: ReactTestInstance) => React.Children.count(r.props.children));
    expect(counts).toEqual([3, 3]);
  });

  it('the Gantt is sized to the measured panel (px/day clamped 8–24)', async () => {
    await desktopAt(`/schedule?projectId=${PID}&focus=g1&classic=g1`);
    fireEvent(screen.getByTestId('schedule-main-panel'), 'layout', { nativeEvent: { layout: { width: 1232 } } });
    fireEvent.press(screen.getAllByText('Gantt')[0]);
    await pump(2);
    const charts = screen.UNSAFE_root.findAll((n: ReactTestInstance) => typeof n.type !== 'string' && (n.type as { name?: string }).name === 'GanttChart');
    expect(charts.length).toBeGreaterThan(0);
    expect(charts[0].props.viewportWidth).toBe(1200);
  });

  it('a desktop-web Pro arrival (?projectId&focus) is handed to Schedule Pro, taskId passed through', async () => {
    const tree = await desktopAt(`/schedule?projectId=${PID}&focus=r1&taskId=t3`, { web: true, raw: true });
    expect(tree.getPathname()).toBe('/schedule-pro');
    expect(tree.getSearchParams()).toMatchObject({ projectId: PID, taskId: 't3', focus: 'r1' });
  });

  it('?classic=<same focus> stays on the classic tab', async () => {
    const tree = await desktopAt(`/schedule?projectId=${PID}&focus=r2&classic=r2`, { web: true, raw: true });
    expect(tree.getPathname()).toBe('/schedule');
  });

  it('a free tier on desktop web stays on the classic tab (with its Pro teaser)', async () => {
    const tree = await desktopAt(`/schedule?projectId=${PID}&focus=r3`, { web: true, tier: 'free', raw: true });
    expect(tree.getPathname()).toBe('/schedule');
  });

  // Fix round 1: Pro's grid needs GRID_BREAKPOINT (900) beside its 64 px rail.
  // In a 960 browser window Pro would show its narrow gate, whose "Open
  // classic schedule" button lands back here with a fresh focus and no
  // ?classic — redirecting that arrival to Pro again was a loop.
  it('a desktop-web Pro arrival in a 960 window (Pro\'s grid does not fit) stays on the classic tab', async () => {
    const tree = await desktopAt(`/schedule?projectId=${PID}&focus=r5&taskId=t3`, { web: true, raw: true, width: 960 });
    expect(tree.getPathname()).toBe('/schedule');
    // …and the classic tab takes the arrival: the routed task's detail opens.
    expect(screen.getByTestId('schedule-detail-progress')).toBeTruthy();
  });

  it('…while a 1000 window (936 beside the rail) still hands it to Pro', async () => {
    const tree = await desktopAt(`/schedule?projectId=${PID}&focus=r6`, { web: true, raw: true, width: 1000 });
    expect(tree.getPathname()).toBe('/schedule-pro');
  });

  it('a free account invited to the job as field crew is handed to Pro, as Pro\'s own gate admits him (#91)', async () => {
    const tree = await desktopAt(`/schedule?projectId=${PID}&focus=r7`, { web: true, tier: 'free', raw: true, myRole: 'field' });
    expect(tree.getPathname()).toBe('/schedule-pro');
  });

  it('native at 1512 (not a browser) never redirects', async () => {
    const tree = await desktopAt(`/schedule?projectId=${PID}&focus=r4`, { web: false, raw: true });
    expect(tree.getPathname()).toBe('/schedule');
  });
});
