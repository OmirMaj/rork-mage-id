/**
 * UX wave, Lane B (on-site operations) — PHONE GOLDEN.
 *
 * Recorded FIRST, on the untouched Lane B files (base a102ff73, Lane 0
 * committed), before a line of Lane B was written. Each case mounts a real
 * route inside the real app (the provider stack, the populated fixture world)
 * at 390 x 844 iOS and records a line-per-host-node dump's length and sha256
 * (the w6c-field-phone harness, copied). Every <Modal> renders its content,
 * open or not, so each screen's sheets are in its golden.
 *
 * Lane B changes these screens on purpose (the crew sheet, the punch Add bar,
 * the RFI answer box, the lineup's texts, "It's here now", the code-check
 * doors). A case that changes is a DELTA the lane report names, proven by a
 * line diff of the dumps written to $W6C_DUMP_DIR — never an `-u`.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';
import { PROJECT_ID, ESTIMATE_ID, world } from '@/__tests__/fixtures/world';
import type { Project, ProjectSchedule, ScheduleTask } from '@/types';

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

// useIsDesktopWeb(): the app's own answer everywhere (false on iOS/Android),
// unless a desktop-web case below forces it. RN-web itself cannot run inside
// this native harness (expo-router reads window.location on web), so the
// desktop-web cases keep Platform.OS native and force only this switch.
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

// Two clocks, both pinned.
//  - NOW: this realm's Date.now, read by code that runs with no fake timers.
//  - GOLDEN_CLOCK: the FAKE clock renderRouter installs. Its jest.useFakeTimers()
//    has no `now`, so @jest/fake-timers starts it at Date.now() of ITS OWN
//    realm — the outer node realm, not this test's global — i.e. the real
//    wall clock, which the NOW spy never reached. Every `new Date()` on a
//    mounted route (today's date in a form, "Overdue 36 days", the date
//    picker's today) therefore followed the calendar, and 12 goldens broke at
//    midnight on 2026-09-25 (integration review r1). The goldens were recorded
//    at 2026-09-24 16:22 America/New_York; with the fake clock pinned there,
//    all 41 pass on that tree unchanged (verified with a probe config setting
//    fakeTimers.now), so none was regenerated.
const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-24T20:22:00.000Z').getTime();
/** The outer realm's Date — the one @jest/fake-timers reads. A node core
 *  module is shared with that realm (jest's `process` copy and this realm's
 *  Date are not), so its functions' Function constructor builds there. */
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
// A whole-app tree is far too big for a literal snapshot (pretty-format ran
// past V8's string limit), so each render is reduced to one line per host
// node — type, every style FLATTENED (a `false` left by `isDesktop && …`
// renders nothing), every primitive or small-object prop, handlers dropped —
// and the snapshot stores that dump's line count and sha256. The dump itself
// is written to $W6C_DUMP_DIR/<case>.txt when set, so a mismatch can be
// diffed line by line.
const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;
const KNOWN_IDS = new Set([PROJECT_ID, ESTIMATE_ID]);
// Ids minted at render time (Date.now()+random) are not layout: normalise them.
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
    // screenId is react-navigation's per-mount nanoid: not layout.
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
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

async function phoneRoute(url: string, before?: () => Promise<void>) {
  env('ios', 390, 844);
  await primeWorld('populated');
  if (before) await before();
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

const P = `projectId=${PROJECT_ID}`;

describe('UX lane B — the phone golden (390 x 844 iOS)', () => {
  jest.setTimeout(120000);

  const ROUTES: Array<[string, string]> = [
    ['time-tracking', `/time-tracking?${P}`],
    ['time-tracking (no job)', '/time-tracking'],
    ['punch-list', `/punch-list?${P}`],
    ['rfi (open rfi-2)', `/rfi?${P}&rfiId=rfi-2`],
    ['rfi (answered rfi-1)', `/rfi?${P}&rfiId=rfi-1`],
    ['rfi (new)', `/rfi?${P}`],
    ['deliveries', `/deliveries?${P}`],
    ['scan', `/scan?${P}`],
    ['tomorrow-lineup', `/tomorrow-lineup?${P}`],
    ['construction-ai (Tools entry)', '/construction-ai'],
    ['construction-ai (from the job)', `/construction-ai?${P}&source=project`],
    ['project-detail (code checks card)', `/project-detail?id=${PROJECT_ID}`],
  ];

  it.each(ROUTES)('%s', async (name, url) => {
    const tree = await phoneRoute(url);
    expect(fingerprint(name, tree.toJSON())).toMatchSnapshot();
  });
});

// ── TodayView lives on the classic schedule tab (tablet / desktop branch —
//    the phone's schedule tab is MobileScheduleScreen). A dated schedule:
//    Monday 2026-09-14, so the golden clock (Thu 09-24) is working day 9.
const PID = 'p-henderson-b';
const task = (o: Partial<ScheduleTask> & { id: string; title: string; startDay: number; durationDays: number }): ScheduleTask => ({
  phase: 'Interior', progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started', ...o,
} as ScheduleTask);
const TASKS: ScheduleTask[] = [
  task({ id: 't1', title: 'Demo', phase: 'Demolition', startDay: 1, durationDays: 3, status: 'done', progress: 100, crew: 'Demo crew' }),
  task({ id: 't2', title: 'Framing', phase: 'Framing', startDay: 4, durationDays: 4, dependencies: ['t1'], status: 'in_progress', progress: 50, crew: 'Framers' }),
  task({ id: 't3', title: 'Rough-in electrical', phase: 'MEP', startDay: 8, durationDays: 3, dependencies: ['t2'], crew: 'Sparks' }),
  task({ id: 't4', title: 'Cabinets', phase: 'Interior', startDay: 11, durationDays: 4, dependencies: ['t3'] }),
];
const SCHEDULE = {
  id: `${PID}-s`, name: 'Henderson schedule', projectId: PID,
  startDate: '2026-09-14', workingDaysPerWeek: 5, bufferDays: 0,
  tasks: TASKS, totalDurationDays: 15, criticalPathDays: 15, laborAlignmentScore: 0, riskItems: [],
} as unknown as ProjectSchedule;
const henderson = { ...(world.project as Project), id: PID, name: 'Henderson', schedule: SCHEDULE } as unknown as Project;
async function seedHenderson() {
  const raw = await AsyncStorage.getItem('mageid_projects');
  const parsed = raw ? JSON.parse(raw) : [];
  const list: Project[] = Array.isArray(parsed) ? parsed : parsed?.data ?? [];
  const next = [...list.filter((p) => p.id !== PID), henderson];
  await AsyncStorage.setItem('mageid_projects', JSON.stringify(Array.isArray(parsed) ? next : { ...parsed, data: next }));
}

describe('UX lane B — TodayView on the classic tab (820 tablet branch)', () => {
  jest.setTimeout(120000);
  it('Today view', async () => {
    env('android', 820, 1180);
    await primeWorld('populated');
    await seedHenderson();
    const tree = await mountRouteChecked(`/schedule?projectId=${PID}&focus=golden1`);
    await pump();
    expect(fingerprint('laneb-tablet820-today', tree.toJSON())).toMatchSnapshot();
  });
});

// Unused-import guard for the copied harness (AsyncStorage/fireEvent/render/
// SafeAreaProvider/ThemeProvider/View/screen are used by the source file's
// cases, not by this one's).
void fireEvent; void render; void SafeAreaProvider; void ThemeProvider; void View; void screen;
