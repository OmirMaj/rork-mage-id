/**
 * Wave 6c, lane DC — Summary ("Morning Briefing") on desktop web.
 *
 * The founder: "the website app... really isn't utilizing the space a computer
 * screen gives you". At 1512 the Summary was one long column: 32 task rows
 * pushed Money and Needs You off the screen, a task click landed on the job
 * page instead of the task, and 'Budget' added unsold bids. Lane DC gives it
 * two columns on desktop, groups Today by job, and fixes the two honesty
 * defects (C2: BUDGET -> CONTRACT + pipeline, active = in-progress jobs).
 *
 *  1. GOLDEN — recorded FIRST, on the untouched base (bdd5daee), before a
 *     single line of this lane was written. The phone keeps today's single
 *     column in today's order. The ONLY phone delta allowed is C2's string
 *     change (MoneyStrip BUDGET -> CONTRACT with a '+$X pipeline' line when
 *     there is pipeline, 'across all jobs' -> 'jobs in progress', and the
 *     'N active' pill counting in-progress jobs only); those snapshots were
 *     re-recorded once, in that separate step, with a string-only dump diff.
 *
 *  2. DESKTOP (1512 × 945, forced layout; Platform stays native — expo-router
 *     cannot run RN-web inside jest, so useIsDesktopWeb() is forced) — the two
 *     columns, NeedsYou's cap, no Tools button, and the task tap contract.
 *
 *  3. F7 GUARD — a cold mount of /summary through the real app/_layout at the
 *     forced desktop layout renders a Summary testID.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, ESTIMATE_ID, world } from '@/__tests__/fixtures/world';
import type { Project, ProjectSchedule, ScheduleTask } from '@/types';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';

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

// The attention feed: the REAL hook (null) for the goldens; a desktop case
// forces nine items to see NeedsYou's cap.
let mockBrainItems: unknown[] | null = null;
jest.mock('@/hooks/useBrainWatch', () => {
  const actual = jest.requireActual('@/hooks/useBrainWatch');
  return {
    ...actual,
    useBrainWatch: () => (mockBrainItems
      ? { items: mockBrainItems, total: mockBrainItems.length, byKind: {}, sourceFailed: false }
      : actual.useBrainWatch()),
  };
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
  mockBrainItems = null;
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
  restoreOS?.();
  restoreOS = null;
});

// ── What a snapshot records ────────────────────────────────────────────────
const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;
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
  json = stripSanctioned(json);
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

// ── A second, dated job with work on site today (golden clock Thu 09-24 is
//    working day 9 of a 2026-09-14 start): three tasks today, one critical.
const PID = 'p-henderson';
const task = (o: Partial<ScheduleTask> & { id: string; title: string; startDay: number; durationDays: number }): ScheduleTask => ({
  phase: 'Interior', progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started', ...o,
} as ScheduleTask);
const TASKS: ScheduleTask[] = [
  task({ id: 't1', title: 'Demo', startDay: 1, durationDays: 3, status: 'done', progress: 100 }),
  task({ id: 't2', title: 'Framing', startDay: 4, durationDays: 7, crew: 'Framers', isCriticalPath: true }),
  task({ id: 't3', title: 'Rough-in electrical', startDay: 8, durationDays: 3, crew: 'Sparks' }),
  task({ id: 't4', title: 'Rough-in plumbing', startDay: 9, durationDays: 2, crew: 'Framers' }),
  task({ id: 't5', title: 'Cabinets', startDay: 12, durationDays: 4 }),
];
const henderson: Project = {
  ...(world.project as Project),
  id: PID,
  name: 'Henderson',
  status: 'in_progress',
  schedule: {
    id: `${PID}-s`, name: 'Henderson schedule', projectId: PID,
    startDate: '2026-09-14', workingDaysPerWeek: 5, bufferDays: 0,
    tasks: TASKS, totalDurationDays: 15, criticalPathDays: 15, laborAlignmentScore: 0, riskItems: [],
  } as unknown as ProjectSchedule,
} as unknown as Project;

async function seedHenderson() {
  const raw = await AsyncStorage.getItem('mageid_projects');
  const parsed = raw ? JSON.parse(raw) : [];
  const list: Project[] = Array.isArray(parsed) ? parsed : parsed?.data ?? [];
  const next = [...list.filter((p) => p.id !== PID), henderson];
  await AsyncStorage.setItem('mageid_projects', JSON.stringify(Array.isArray(parsed) ? next : { ...parsed, data: next }));
}

async function summaryAt(os: 'ios' | 'web', width: number, height: number, withJob: boolean) {
  env(os, width, height);
  await primeWorld('populated');
  if (withJob) await seedHenderson();
  const tree = await mountRouteChecked('/summary');
  await pump();
  return tree;
}

// ── 1. GOLDEN, phone ───────────────────────────────────────────────────────
describe('lane DC — Summary on the phone (golden, 390 × 844 iOS)', () => {
  jest.setTimeout(120000);
  it('/(tabs)/summary, the fixture world', async () => {
    const tree = await summaryAt('ios', 390, 844, false);
    expect(fingerprint('phone-summary', tree.toJSON())).toMatchSnapshot();
  });
  it('/(tabs)/summary, with a job on site today', async () => {
    const tree = await summaryAt('ios', 390, 844, true);
    expect(screen.getByTestId('summary-today-row-0')).toBeTruthy();
    expect(fingerprint('phone-summary-today', tree.toJSON())).toMatchSnapshot();
  });
});

// ── 2. DESKTOP 1512 × 945 (forced layout) ──────────────────────────────────
const flatOf = (node: { props: { style?: unknown } }) => flat(node.props.style);
const attn = (i: number) => ({
  id: `a${i}`, projectId: PROJECT_ID, projectName: 'Harlow', kind: 'invoice', severity: i % 2 ? 'high' : 'medium',
  message: `Attention item ${i}`, route: { pathname: '/project-detail', params: { id: PROJECT_ID } },
});

describe('lane DC — Summary at 1512 (desktop)', () => {
  jest.setTimeout(120000);

  it('two columns: today grouped by job on the left, a 340–440 right column; no Tools button', async () => {
    const tree = await summaryAt('ios', 1512, 945, true);
    void tree;
    expect(flatOf(screen.getByTestId('summary-columns')).flexDirection).toBe('row');
    const right = flatOf(screen.getByTestId('summary-right-column'));
    expect(right.minWidth).toBe(340);
    expect(right.maxWidth).toBe(440);
    expect(flatOf(screen.getByTestId('summary-left-column')).flex).toBe(2);
    expect(screen.queryByTestId('summary-tools-button')).toBeNull();
    // Grouped: one job card with its crews, the tasks under it.
    expect(screen.getByTestId('summary-today-jobs')).toBeTruthy();
    expect(screen.getByTestId(`summary-today-job-${PID}`)).toBeTruthy();
    expect(screen.getByText(/3 tasks · 1 crit · Framers · Sparks/)).toBeTruthy();
    // The right column holds Money and the week, flush with its edges.
    const money = flatOf(screen.getByTestId('summary-money'));
    expect(money.marginHorizontal ?? money.marginLeft).toBe(0);
    expect(screen.getByTestId('summary-week')).toBeTruthy();
  });

  it('NeedsYou shows at most 6 rows and a \'See all 9\' row', async () => {
    mockBrainItems = Array.from({ length: 9 }, (_, i) => attn(i + 1));
    await summaryAt('ios', 1512, 945, true);
    const rows = screen.queryAllByTestId(/^summary-needs-a\d+$/);
    expect(rows).toHaveLength(6);
    expect(screen.getByText('See all 9 →')).toBeTruthy();
  });

  it('the phone (390) still lists every NeedsYou row and keeps the Tools button', async () => {
    mockBrainItems = Array.from({ length: 9 }, (_, i) => attn(i + 1));
    await summaryAt('ios', 390, 844, true);
    expect(screen.queryAllByTestId(/^summary-needs-a\d+$/)).toHaveLength(9);
    expect(screen.queryByTestId('summary-needs-see-all')).toBeNull();
    expect(screen.getByTestId('summary-tools-button')).toBeTruthy();
  });

  it('desktop web, Pro tier: a task tap lands on Schedule Pro with that task', async () => {
    mockForceDesktopWeb = true;
    const tree = await summaryAt('ios', 1512, 945, true);
    fireEvent.press(screen.getByTestId(`summary-today-job-row-${PID}-0`));
    await pump(4);
    expect(tree.getPathname()).toBe('/schedule-pro');
    const params = tree.getSearchParams();
    expect(params.projectId).toBe(PID);
    expect(['t2', 't3', 't4']).toContain(params.taskId);
  });

  // Fix round 1: in a 960 browser window Pro's grid does not fit beside its
  // rail, so Pro would only show its narrow gate — the tap opens the classic
  // tab (desktop from 900 on the web) with the task's detail, and stays there.
  it('desktop web at 960, Pro tier: a task tap lands on the classic tab with that task\'s detail open, not Pro\'s narrow gate', async () => {
    mockForceDesktopWeb = true;
    env('ios', 960, 945);
    mockWeb = true;
    await primeWorld('populated');
    await seedHenderson();
    const tree = await mountRouteChecked('/summary');
    await pump();
    fireEvent.press(screen.getByTestId(`summary-today-job-row-${PID}-0`));
    await pump(8);
    expect(tree.getPathname()).toBe('/schedule');
    expect(tree.getSearchParams().taskId).toBeTruthy();
    expect(screen.getByTestId('schedule-detail-progress')).toBeTruthy();
  });

  it('desktop web, free tier: a task tap lands on the classic tab with that task\'s detail open', async () => {
    mockForceDesktopWeb = true;
    env('ios', 1512, 945);
    await primeWorld('populated');
    await seedHenderson();
    await AsyncStorage.setItem('mageid_subscription_tier', 'free');
    const tree = await mountRouteChecked('/summary');
    await pump();
    fireEvent.press(screen.getByTestId(`summary-today-job-row-${PID}-0`));
    await pump(8);
    expect(tree.getPathname()).toBe('/schedule');
    expect(tree.getSearchParams().taskId).toBeTruthy();
    // The Modal mock renders every sheet's frame; the detail's CONTENT (its
    // progress control) renders only when a task is open.
    expect(screen.getByTestId('schedule-detail-progress')).toBeTruthy();
  });
});

// ── 3. F7 guard: a cold mount of /summary at the desktop layout renders ────
describe('lane DC — F7: /summary is never blank on a cold desktop mount', () => {
  jest.setTimeout(120000);
  it('mounts through the real app/_layout at 1512 and renders a Summary testID', async () => {
    env('ios', 1512, 945);
    await primeWorld('populated');
    const tree = await mountRouteChecked('/summary');
    await pump();
    expect(tree.getPathname()).toBe('/summary');
    expect(screen.getByTestId('summary-today')).toBeTruthy();
    expect(screen.queryByText('No projects yet')).toBeNull();
  });
});
