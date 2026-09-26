/**
 * Wave 6d, lane V3 — /attention on the iPhone must not change when the
 * desktop-only loading branch lands (runtime fix C6).
 *
 * On desktop, /attention?view=bill says 'Loading…' until changeOrdersLoaded and
 * ?view=logs until dailyReportsLoaded, with no count on the segment. That
 * branch is `isDesktop && …`, so on a 390 px iPhone the deep-link render must
 * be the SAME tree with the loaded flags false as with them true, and the same
 * tree it was before the lane touched the file.
 *
 * GOLDEN — recorded FIRST, on the untouched base (c1086c0c), before a single
 * line of this lane was written. The screen is rendered directly (no app
 * stack): ProjectContext, useBrainWatch, the router and the layout gate are
 * mocked, the clock is pinned, and each case records a fingerprint (line count
 * + sha256) of the whole rendered tree — every style prop flattened, handler
 * and undefined props dropped (the w6c-home recipe).
 */

import React from 'react';
import { Dimensions, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import type { ChangeOrder, DailyFieldReport, Project } from '@/types';

// ── The layout gate: the phone (390 iOS) ────────────────────────────────────
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => ({
    screenSize: 'phone', isPhone: true, isTablet: false, isDesktop: false,
    width: 390, height: 844, contentMaxWidth: 390, sidebarWidth: 0, showSidebar: false, ganttRowHeight: 32,
  }),
}));

let mockView = 'bill';
const mockRouter = { push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), back: jest.fn(), setParams: jest.fn(), canGoBack: () => false };
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ view: mockView }),
    Stack: { ...actual.Stack, Screen: () => null },
  };
});

jest.mock('@/hooks/useBrainWatch', () => ({ useBrainWatch: () => ({ items: [], sourceFailed: false }) }));

let mockLoaded = true;
let mockData: Record<string, unknown> = {};
jest.mock('@/contexts/ProjectContext', () => ({
  useProjects: () => ({
    ...mockData,
    projectsLoaded: true,
    changeOrdersLoaded: mockLoaded,
    dailyReportsLoaded: mockLoaded,
    invoicesLoaded: mockLoaded,
    punchItemsLoaded: mockLoaded,
  }),
}));

// eslint-disable-next-line import/first
import AttentionScreen from '@/app/(tabs)/(home)/attention';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';

// ── A small world, dated against a pinned clock ─────────────────────────────
const NOW = new Date('2026-09-16T15:00:00.000Z');
const P1 = 'p-henderson';
const P2 = 'p-oak';
const project = (id: string, name: string): Project => ({
  id, name, status: 'in_progress', createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-01T12:00:00.000Z',
} as unknown as Project);
const co = (id: string, projectId: string, number: number, amount: number, createdAt: string): ChangeOrder => ({
  id, projectId, number, status: 'draft', changeAmount: amount, description: `CO ${number}`, createdAt, date: createdAt,
} as unknown as ChangeOrder);
const report = (id: string, projectId: string, date: string): DailyFieldReport => ({
  id, projectId, date, status: 'sent', manpower: [], workPerformed: 'Framing', materialsDelivered: [], issuesAndDelays: '', photos: [],
  weather: { temperature: '', conditions: '', wind: '' },
} as unknown as DailyFieldReport);

function world() {
  return {
    projects: [project(P1, 'Henderson Remodel'), project(P2, 'Oak Street Addition')],
    rfis: [],
    submittals: [],
    changeOrders: [co('co-1', P1, 3, 4200, '2026-09-10T12:00:00.000Z'), co('co-2', P2, 1, 950, '2026-09-14T12:00:00.000Z')],
    dailyReports: [report('dr-1', P1, '2026-09-08'), report('dr-2', P2, '2026-09-15')],
    settings: {},
  };
}

beforeEach(() => {
  // Only the clock is faked: React's act queue still needs real timers.
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
      'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'],
  });
  Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale: 1 }, screen: { width: 390, height: 844, scale: 3, fontScale: 1 } });
  mockData = world();
});
afterEach(() => {
  jest.useRealTimers();
  mockLoaded = true;
});

// ── What a snapshot records (the w6c-home fingerprint) ──────────────────────
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
function dump(json: unknown): string {
  const out: string[] = [];
  dumpLines(json, 0, out);
  return out.join('\n');
}
function fingerprint(text: string): { lines: number; sha256: string } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sha256 = require('node:crypto').createHash('sha256').update(text).digest('hex');
  return { lines: text.split('\n').length, sha256 };
}

function mount(name: string): string {
  const tree = render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <ThemeProvider>
        <AttentionScreen />
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  const text = dump(stripSanctioned(tree.toJSON()));
  const dir = process.env.W6D_DUMP_DIR;
  if (dir) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/${name}.txt`, text);
  }
  return text;
}

// One render per test (RNTL cannot mount twice in one test here); the loaded
// text is kept so the not-loaded case can be compared with it byte for byte.
const loadedText: Record<string, string> = {};

describe('lane V3 — /attention on the phone (390 iOS), loaded flags false and true', () => {
  for (const view of ['bill', 'logs'] as const) {
    it(`?view=${view}: the loaded render is the golden`, () => {
      mockView = view;
      mockLoaded = true;
      const text = mount(`${view}-loaded`);
      loadedText[view] = text;
      // The fixture is not empty: the view draws its rows (cards on the phone).
      expect(text).not.toMatch(/attention-(bill|logs)-empty/);
      expect(text).toMatch(view === 'bill' ? /Henderson Remodel · CO #3/ : /Henderson Remodel/);
      expect(text).not.toMatch(/Loading/);
      expect(fingerprint(text)).toMatchSnapshot();
    });

    it(`?view=${view}: the NOT-loaded render is byte-identical on the phone`, () => {
      mockView = view;
      mockLoaded = false;
      const text = mount(`${view}-unloaded`);
      expect(text).toBe(loadedText[view]);
      expect(fingerprint(text)).toMatchSnapshot();
    });
  }
});
