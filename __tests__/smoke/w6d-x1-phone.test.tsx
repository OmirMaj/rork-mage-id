/**
 * Wave 6d restore (d6r), lane X1 — the classic schedule tab's sheets and the
 * shared dialogs become centred desktop cards. PHONE PROOF.
 *
 * Lane X1 puts useSheetFrame on four sheets of the classic schedule tab
 * (ripple confirm, dependency picker, templates, start date — sheet batch D)
 * and on sixteen shared dialogs (batches A1 and A2), and gives the punch
 * export's header button a desktop-web label. Every edit is a frame style
 * appended LAST (null on a phone), `animationType={f.animationType}` (the
 * caller's own literal on a phone), `{f.showHandle && …}` (true on a phone),
 * SheetOverlay (a Fragment on a phone), a dialog-scope / primary hotkey
 * (registers nothing off desktop web) or a useIsDesktopWeb() ternary (false
 * on a phone). So on the iPhone NOTHING may change. This file is the proof.
 *
 * GOLDEN — recorded FIRST, on a pristine archive of the untouched base
 * (6a77feee), before a line of this lane was written, and never regenerated
 * (run with --ci).
 *
 *  D   /(tabs)/schedule?projectId at ANDROID 800 × 1280: ScheduleScreen's
 *      non-desktop branch (an iPhone renders MobileScheduleScreen, which
 *      w6c-schedule-classic covers). The whole app tree.
 *  A1  / A2  each component alone at iOS 390 × 844, visible, light AND dark.
 *      Components that read only the theme mount in SafeAreaProvider +
 *      ThemeProvider; those that read the auth / projects / properties /
 *      subscription / router contexts mount inside the real app (an injected
 *      route under app/_layout.tsx) and only their own subtree is recorded.
 *  PX  PunchExportHeaderButton ALONE at iOS 390 (not the /punch-list route,
 *      which list round 3 edits): its phone label stays 'Export'.
 *
 * What a snapshot records (the w6c-field-phone harness): every style
 * FLATTENED, handler props dropped, undefined props dropped, and every <Modal>
 * rendered — open or closed — with its visible / transparent / animationType /
 * presentationStyle recorded on a host View; each render is stored as a line
 * count, a sha256 and the number of Modals in it. Set W6C_DUMP_DIR to write
 * the dumps. Clocks are pinned.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, cleanup, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { setColorTheme } from '@/constants/colors';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';
import { PROJECT_ID, ESTIMATE_ID, world } from '@/__tests__/fixtures/world';
import type { Lead, Project, ProjectSchedule, PunchItem, ScheduleTask, TakeoffFieldVerification } from '@/types';

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

// useIsDesktopWeb(): the app's own answer (false on iOS/Android), unless a
// desktop-web case below forces it (behaviour only — never a golden).
let mockForceDesktopWeb = false;
jest.mock('@/components/ui/desktop', () => {
  const actual = jest.requireActual('@/components/ui/desktop');
  return { ...actual, useIsDesktopWeb: () => (mockForceDesktopWeb ? actual.useIsDesktop() : actual.useIsDesktopWeb()) };
});

// OfflineSyncPill renders nothing while nothing is unsaved: its case forces a
// failed sync state (a red badge with two unsaved rows) so the sheet is in the
// tree. Every other case reads the app's own hook.
let mockSyncOverride: Record<string, unknown> | null = null;
jest.mock('@/hooks/useSyncStatus', () => {
  const actual = jest.requireActual('@/hooks/useSyncStatus');
  return { ...actual, useSyncStatus: () => (mockSyncOverride ?? actual.useSyncStatus()) };
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

// Two clocks, both pinned (see w6c-field-phone): this realm's Date.now, and
// the outer realm's, which the fake clock renderRouter installs reads.
const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-24T20:22:00.000Z').getTime();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const outerFs = require('node:fs') as { readFileSync: { constructor: FunctionConstructor } };
const OuterDate = outerFs.readFileSync.constructor('return Date')() as DateConstructor;
let nowSpy: jest.SpyInstance | null = null;
let randomSpy: jest.SpyInstance | null = null;
let outerNowSpy: jest.SpyInstance | null = null;
function pinRouterClocks() {
  jest.useRealTimers();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  outerNowSpy = OuterDate === Date ? null : jest.spyOn(OuterDate, 'now').mockReturnValue(GOLDEN_CLOCK);
}
beforeEach(() => {
  allowConsoleErrors();
});
afterEach(() => {
  mockForceDesktopWeb = false;
  mockSyncOverride = null;
  randomSpy?.mockRestore();
  randomSpy = null;
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
  jest.useRealTimers();
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
function countModals(node: unknown): number {
  if (node == null || typeof node !== 'object') return 0;
  if (Array.isArray(node)) return node.reduce((n: number, c) => n + countModals(c), 0);
  const el = node as { props?: Record<string, unknown>; children?: unknown };
  return (el.props?.testID === 'w6c-modal' ? 1 : 0) + countModals(el.children);
}
function fingerprint(name: string, json: unknown): { lines: number; sha256: string; modalCount: number } {
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
  return { lines: out.length, sha256, modalCount: countModals(json) };
}
/** The subtree under the host View with `testID` (an injected in-app mount). */
function subtree(node: unknown, testID: string): unknown {
  if (node == null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const c of node) { const hit = subtree(c, testID); if (hit) return hit; }
    return null;
  }
  const el = node as { props?: Record<string, unknown>; children?: unknown };
  if (el.props?.testID === testID) return el;
  return subtree(el.children, testID);
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

type Scheme = 'light' | 'dark';
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** A theme-only component, alone: SafeAreaProvider + ThemeProvider. */
async function mountAlone(node: React.ReactElement, scheme: Scheme, width = 390, height = 844) {
  env('ios', width, height);
  jest.useFakeTimers({ now: new Date(GOLDEN_CLOCK) });
  // EstimateLoadingOverlay opens on a random fun fact: pin it.
  randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.37);
  await AsyncStorage.setItem('mageid_theme', scheme);
  // The static Colors mirror is module state the provider only updates in an
  // effect — set it first so a light case never inherits a dark one's colours.
  setColorTheme(scheme);
  const r = render(
    <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider><View>{node}</View></ThemeProvider></SafeAreaProvider>,
  );
  await pump();
  return r.toJSON();
}

/** An in-app mount at desktop web 1512 × 945; the whole tree is returned. */
async function mountInAppDesktop(node: React.ReactElement) {
  env('ios', 1512, 945);
  mockForceDesktopWeb = true;
  pinRouterClocks();
  await primeWorld('populated');
  await seedHenderson();
  const Host = () => <View testID="x1-host">{node}</View>;
  injectSeq += 1;
  const tree = await mountRouteChecked(`/x1-host-${injectSeq}`, Host);
  await pump();
  return subtree(tree.toJSON(), 'x1-host');
}

/** A component that reads app contexts: mounted inside the real app (an
 *  injected route under app/_layout.tsx); only its own subtree is returned. */
let injectSeq = 0;
async function mountInApp(node: React.ReactElement, scheme: Scheme, before?: () => Promise<void>) {
  env('ios', 390, 844);
  pinRouterClocks();
  await primeWorld('populated');
  // A job with a schedule (QuickFieldUpdate renders nothing without one).
  await seedHenderson();
  if (before) await before();
  await AsyncStorage.setItem('mageid_theme', scheme);
  setColorTheme(scheme);
  const Host = () => <View testID="x1-host">{node}</View>;
  injectSeq += 1;
  const tree = await mountRouteChecked(`/x1-host-${injectSeq}`, Host);
  await pump();
  const sub = subtree(tree.toJSON(), 'x1-host');
  expect(sub).toBeTruthy();
  return sub;
}

const noop = () => {};
const ISO = '2026-09-20T14:00:00.000Z';

// ── Fixtures ───────────────────────────────────────────────────────────────
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
const PID = 'p-x1-classic';
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

const LEAD: Lead = {
  id: 'lead-x1', name: 'Dana Whitfield', phone: '555-0144', email: 'dana@whitfield.test', address: '12 Elm St, Montclair NJ',
  projectType: 'Kitchen remodel', scope: 'Full gut kitchen, new cabinets and island', budgetMin: 60000, budgetMax: 85000,
  timeline: 'Spring', source: 'website', stage: 'new', receivedAt: ISO, createdAt: ISO, updatedAt: ISO,
} as Lead;
const VERIFICATION: TakeoffFieldVerification = {
  id: 'v1', rowKey: 'materials:m1', photoUri: 'file:///tmp/v1.jpg', note: 'Measured on site', measuredQuantity: 412, capturedAt: ISO,
};
const PUNCH: PunchItem[] = world.punchItems as PunchItem[];

// eslint-disable-next-line @typescript-eslint/no-require-imports
const req = (p: string) => require(p);

// ── D. The classic tab, non-desktop branch ─────────────────────────────────
describe('lane X1 — D: the classic schedule tab (golden, android 800 × 1280)', () => {
  jest.setTimeout(120000);
  it('/(tabs)/schedule?projectId — ScheduleScreen\'s non-desktop branch', async () => {
    env('android', 800, 1280);
    pinRouterClocks();
    await primeWorld('populated');
    await seedHenderson();
    await AsyncStorage.setItem('mageid_theme', 'light');
    setColorTheme('light');
    const tree = await mountRouteChecked(`/schedule?projectId=${PID}`);
    await pump();
    expect(fingerprint('D-schedule-android800', tree.toJSON())).toMatchSnapshot();
  });
});

// ── A1 / A2. Each dialog alone, visible, light and dark ────────────────────
type Case = [string, 'alone' | 'app', () => React.ReactElement];
const CASES: Case[] = [
  // A1
  ['ConfirmEmailModal', 'app', () => { const C = req('@/components/ConfirmEmailModal').default; return <C visible email="omir@example.test" onClose={noop} onChangeEmail={noop} />; }],
  ['ConfirmEmailModal (confirmed elsewhere)', 'app', () => { const C = req('@/components/ConfirmEmailModal').default; return <C visible email="omir@example.test" confirmedElsewhere onClose={noop} />; }],
  ['EstimateLoadingOverlay', 'alone', () => { const C = req('@/components/EstimateLoadingOverlay').default; return <C visible title="Building your estimate" subtitle="Pricing on your costs" thinkingSteps={['Reading scope', 'Pricing labor']} onCancel={noop} />; }],
  ['InfoBubble', 'alone', () => { const C = req('@/components/InfoBubble').default; return <C term="Float" title="What is float?" what="Days a task can slip without moving the finish." why="Zero float means it is on the critical path." />; }],
  ['ReferralPrompt', 'alone', () => { const C = req('@/components/ReferralPrompt').default; return <C visible onClose={noop} jobName="Henderson kitchen" companyName="Majeed Builders" />; }],
  ['UpgradeSheet', 'app', () => { const C = req('@/components/UpgradeSheet').default; return <C visible onClose={noop} limit={{ allowed: false, remaining: 0, reason: 'daily_cap', message: 'You have used today\'s AI estimates.' }} featureLabel="AI estimates" />; }],
  ['QuickFieldUpdate', 'app', () => { const C = req('@/components/QuickFieldUpdate').default; return <C />; }],
  ['OfflineSyncPill (failed)', 'alone', () => {
    mockSyncOverride = {
      tone: 'failed', pending: 0, failed: 2, depths: {}, visible: true, badge: '2 not saved',
      title: 'Not saved to MAGE', detail: 'Two changes could not be saved.\n\nWhat failed: see below',
      unsaved: [
        { id: 'u1', label: 'Daily report', line: 'Not saved to MAGE — the server refused it', canRetry: true, writes: 2, discards: 'create' },
        { id: 'u2', label: 'Punch item', line: 'Not saved to MAGE — no longer exists', canRetry: false, writes: 1, discards: 'edit' },
      ],
      retryUnsaved: async () => 'failed', discardUnsaved: async () => {}, acknowledgeFailures: async () => {}, refresh: async () => {},
    };
    const C = req('@/components/OfflineSyncPill').default;
    return <C variant="full" />;
  }],
  ['PropertyManagerHome', 'app', () => { const C = req('@/components/PropertyManagerHome').default; return <C />; }],
  // A2
  ['UniversalMicButton', 'app', () => { const C = req('@/components/UniversalMicButton').default; return <C projectId={PROJECT_ID} />; }],
  ['InstantBidProposalModal', 'app', () => { const C = req('@/components/InstantBidProposalModal').default; return <C visible onClose={noop} lead={LEAD} />; }],
  ['AssemblyEditorModal', 'alone', () => { const C = req('@/components/AssemblyEditorModal').AssemblyEditorModal; return <C visible initial={null} onClose={noop} onSave={noop} />; }],
  ['RateOverrideModal', 'alone', () => { const C = req('@/components/RateOverrideModal').RateOverrideModal; return <C visible overrides={[]} materials={[{ id: 'm1', name: '2x4 stud', baseBulkPrice: 4.25 }]} onClose={noop} onAdd={noop} onUpdate={noop} onDelete={noop} />; }],
  ['SubDailyUpdateModal', 'alone', () => { const C = req('@/components/SubDailyUpdateModal').SubDailyUpdateModal; return <C visible onClose={noop} task={TASKS[1]} subName="Framers LLC" projectId={PROJECT_ID} projectName="Henderson" gcEmail="gc@example.test" gcName="Omir" onSubmit={noop} />; }],
  ['TakeoffFieldVerifyButton (new)', 'alone', () => { const C = req('@/components/TakeoffFieldVerifyButton').TakeoffFieldVerifyButton; return <C rowKey="materials:m1" currentQuantity={400} unit="sf" onCapture={noop} onUseMeasured={noop} />; }],
  ['TakeoffFieldVerifyButton (existing)', 'alone', () => { const C = req('@/components/TakeoffFieldVerifyButton').TakeoffFieldVerifyButton; return <C rowKey="materials:m1" currentQuantity={400} unit="sf" existing={VERIFICATION} onCapture={noop} onDelete={noop} onUseMeasured={noop} />; }],
  ['PunchExportSheet', 'app', () => { const C = req('@/components/punch/PunchExportSheet').PunchExportSheet; return <C visible onClose={noop} projectId={PROJECT_ID} allItems={PUNCH} filteredItems={PUNCH} selectedIds={[]} activeList="punch" filterStatus="all" filterSub="all" filterPriority="all" filterLocationKey="all" filterLocationLabel="All locations" />; }],
];

describe('lane X1 — A1 / A2: each dialog alone (golden, iOS 390)', () => {
  jest.setTimeout(120000);
  const MATRIX: Array<[string, Scheme, 'alone' | 'app', () => React.ReactElement]> = [];
  for (const [name, how, make] of CASES) for (const s of ['light', 'dark'] as Scheme[]) MATRIX.push([name, s, how, make]);
  it.each(MATRIX)('%s — %s', async (name, scheme, how, make) => {
    const json = how === 'alone' ? await mountAlone(make(), scheme) : await mountInApp(make(), scheme);
    const fp = fingerprint(`${name}-${scheme}`, json);
    expect(fp.modalCount).toBeGreaterThan(0);
    expect(fp).toMatchSnapshot();
  });
});

// ── PX. The punch export header button, alone ──────────────────────────────
describe('lane X1 — PunchExportHeaderButton alone (golden, iOS 390)', () => {
  jest.setTimeout(60000);
  it.each<Scheme>(['light', 'dark'])('%s — the phone label stays "Export"', async (scheme) => {
    const { PunchExportHeaderButton } = req('@/components/punch/PunchExportSheet');
    const json = await mountAlone(<PunchExportHeaderButton onPress={noop} />, scheme);
    const fp = fingerprint(`PunchExportHeaderButton-${scheme}`, json);
    const text = JSON.stringify(json);
    expect(text).toContain('"Export"');
    expect(text).toContain('PDF report or spreadsheet');
    expect(text).not.toContain('Print / Export');
    expect(fp).toMatchSnapshot();
  });
});

// ── Sanity: dark really is dark ────────────────────────────────────────────
describe('lane X1 — sanity', () => {
  jest.setTimeout(60000);
  it('the dark goldens are not the light ones', async () => {
    const make = CASES.find(([n]) => n === 'ReferralPrompt')![2];
    const light = fingerprint('s-light', await mountAlone(make(), 'light'));
    // One tree at a time: two renders left mounted in one test broke every
    // render in the tests after it.
    cleanup();
    const dark = fingerprint('s-dark', await mountAlone(make(), 'dark'));
    cleanup();
    expect(dark.sha256).not.toBe(light.sha256);
    await AsyncStorage.setItem('mageid_theme', 'light');
    setColorTheme('light');
  });
});

// ── Desktop web 1512: every framed card is centred and width-capped ────────
// Behaviour, not pixels (no snapshot). useSheetFrame reads useIsDesktop (the
// layout gate: 1512 is desktop on any platform); the header label reads
// useIsDesktopWeb, forced on here.
type JsonNode = { type: string; props: Record<string, unknown>; children: unknown };
function hostNodes(node: unknown, out: JsonNode[] = []): JsonNode[] {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const c of node) hostNodes(c, out); return out; }
  const el = node as JsonNode;
  out.push(el);
  hostNodes(el.children, out);
  return out;
}
const textOf = (node: unknown): string => {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf((node as JsonNode).children);
};
/** The innermost node carrying `maxWidth` whose subtree contains `text`. */
function cardAround(json: unknown, text: string): ViewStyle | null {
  let best: ViewStyle | null = null;
  for (const n of hostNodes(json)) {
    const st = flat(n.props?.style);
    if (typeof st.maxWidth === 'number' && textOf(n).includes(text)) best = st; // pre-order: the last hit is the innermost
  }
  return best;
}
const modalHints = (json: unknown) => hostNodes(json)
  .filter((n) => n.props?.testID === 'w6c-modal')
  .map((n) => JSON.parse(String(n.props.accessibilityHint)) as { animationType: string | null });

describe('lane X1 — desktop web 1512: the dialogs are centred, capped cards', () => {
  jest.setTimeout(120000);
  const DESK: Array<[string, () => React.ReactElement, string, number]> = [
    ['EstimateLoadingOverlay', CASES.find(([n]) => n === 'EstimateLoadingOverlay')![2], 'Building your estimate', 440],
    ['InfoBubble', CASES.find(([n]) => n === 'InfoBubble')![2], 'What is float?', 440],
    ['ReferralPrompt', CASES.find(([n]) => n === 'ReferralPrompt')![2], 'Refer a contractor', 440],
    ['OfflineSyncPill (failed)', CASES.find(([n]) => n === 'OfflineSyncPill (failed)')![2], 'Not saved to MAGE', 560],
    ['AssemblyEditorModal', CASES.find(([n]) => n === 'AssemblyEditorModal')![2], 'Create assembly', 720],
    ['RateOverrideModal', CASES.find(([n]) => n === 'RateOverrideModal')![2], 'Done', 560],
    ['SubDailyUpdateModal', CASES.find(([n]) => n === 'SubDailyUpdateModal')![2], 'Save and Email', 560],
    ['TakeoffFieldVerifyButton (new)', CASES.find(([n]) => n === 'TakeoffFieldVerifyButton (new)')![2], 'Save Verification', 440],
    ['TakeoffFieldVerifyButton (existing)', CASES.find(([n]) => n === 'TakeoffFieldVerifyButton (existing)')![2], 'Delete Verification', 440],
  ];
  it.each(DESK)('%s — a capped card with a fade, no drag handle', async (_n, make, text, width) => {
    mockForceDesktopWeb = true;
    const json = await mountAlone(make(), 'light', 1512, 945);
    const card = cardAround(json, text);
    expect(card?.maxWidth).toBe(width);
    expect(card?.maxHeight).toBe('85%');
    expect(card?.borderBottomLeftRadius).toBe(card?.borderTopLeftRadius);
    for (const h of modalHints(json)) expect(h.animationType).toBe('fade');
  });

  // Only the component's OWN sheet is asserted: QuickFieldUpdate also renders
  // QuickUpdateClarifier, another lane's file, whose sheet is not this lane's.
  it.each([
    ['ConfirmEmailModal', CASES.find(([n]) => n === 'ConfirmEmailModal')![2], 'omir@example.test', 440],
    ['UpgradeSheet', CASES.find(([n]) => n === 'UpgradeSheet')![2], 'See plans', 440],
    // The picker's title is 'Project'; no other sheet in this subtree has that word capitalised.
    ['QuickFieldUpdate (project picker)', CASES.find(([n]) => n === 'QuickFieldUpdate')![2], 'Project', 440],
    ['PropertyManagerHome (Add a property)', CASES.find(([n]) => n === 'PropertyManagerHome')![2], 'Add a Property', 560],
    ['UniversalMicButton', CASES.find(([n]) => n === 'UniversalMicButton')![2], 'Voice action', 560],
    ['InstantBidProposalModal', CASES.find(([n]) => n === 'InstantBidProposalModal')![2], 'Instant Bid', 720],
    ['PunchExportSheet', CASES.find(([n]) => n === 'PunchExportSheet')![2], 'Export Punch List', 720],
  ] as Array<[string, () => React.ReactElement, string, number]>)('%s — in the app, a capped card with a fade', async (_n, make, text, width) => {
    const json = await mountInAppDesktop(make());
    expect(cardAround(json, text)?.maxWidth).toBe(width);
    expect(cardAround(json, text)?.maxHeight).toBe('85%');
    const own = hostNodes(json).filter((n) => n.props?.testID === 'w6c-modal' && textOf(n).includes(text));
    expect(own.length).toBeGreaterThan(0);
    for (const m of own) expect(modalHints(m)[0]?.animationType).toBe('fade');
  });

  it('the punch export header reads "Print / export" on desktop web', async () => {
    mockForceDesktopWeb = true;
    const { PunchExportHeaderButton } = req('@/components/punch/PunchExportSheet');
    const json = await mountAlone(<PunchExportHeaderButton onPress={noop} />, 'light', 1512, 945);
    const text = JSON.stringify(json);
    expect(text).toContain('Print / Export');
    expect(text).toContain('Print, save as PDF, or download a spreadsheet');
    expect(text).toContain('"testID":"punch-export-open"');
  });

  it('…and still "Export" on a native tablet at 1100 (isDesktop, not a browser)', async () => {
    const { PunchExportHeaderButton } = req('@/components/punch/PunchExportSheet');
    const json = await mountAlone(<PunchExportHeaderButton onPress={noop} />, 'light', 1100, 800);
    const text = JSON.stringify(json);
    expect(text).toContain('"Export"');
    expect(text).not.toContain('Print / Export');
  });

  it('the classic tab: ripple and start date are 440 dialogs, predecessors and templates 560 forms', async () => {
    env('ios', 1512, 945);
    mockForceDesktopWeb = true;
    pinRouterClocks();
    await primeWorld('populated');
    await seedHenderson();
    const tree = await mountRouteChecked(`/schedule?projectId=${PID}&focus=x1d&classic=x1d`);
    await pump();
    const json = tree.toJSON();
    expect(cardAround(json, 'Schedule will shift')?.maxWidth).toBe(440);
    expect(cardAround(json, 'Project start date')?.maxWidth).toBe(440);
    expect(cardAround(json, 'Link predecessors')?.maxWidth).toBe(560);
    expect(cardAround(json, 'Schedule templates')?.maxWidth).toBe(560);
    // The templates sheet is a card, not a bottom sheet: all four corners round.
    const tpl = cardAround(json, 'Schedule templates')!;
    expect(tpl.borderBottomLeftRadius).toBe(tpl.borderTopLeftRadius);
  });
});
