/**
 * Wave 6c, lane H — the field screens and every stretched sub-tab and sheet in
 * the field and tool screens. PHONE PROOF.
 *
 * The founder, on a 1512 × 945 MacBook: "when doing the schedules or picking a
 * subtab the boxes are so stretched out and it looks terrible". Lane H caps
 * the desktop editors, gives the PM a daily-report log beside the report, and
 * converts every segment row and hand-rolled sheet in ~45 files to the wave-6b
 * primitives. Every one of those edits is `isDesktop && …`, a sheet frame
 * whose phone branch is null, or a `useIsDesktopWeb()` switch — so on the
 * iPhone NOTHING may change. This file is the proof.
 *
 *  1. GOLDEN — recorded FIRST, on the untouched base (77c00f3d), before a
 *     single line of this lane was written, and never regenerated. Each case
 *     mounts a real route inside the real app (the 16-provider stack, the
 *     populated fixture world) at 390 × 844 iOS with useResponsiveLayout
 *     mocked to phone, and records the whole rendered tree.
 *
 *     EVERY <Modal> RENDERS ITS CONTENT, open or not. The RN jest mock drops a
 *     closed Modal's children; this file's Modal keeps them (and records
 *     `visible`, `transparent` and `animationType`), so a screen's snapshot
 *     holds every sheet it owns — the send and crew sheets on the daily
 *     report, the six time-clock sheets, the punch list's walk and filter
 *     sheets, estimate/full's dialogs and forms, contract's signature sheets —
 *     each in its phone styles, with the drag handle and the original slide /
 *     fade literal. A sheet body that cannot render with its state still null
 *     (a correction sheet with nothing to correct) is caught by a per-Modal
 *     boundary and recorded as `modal-body-threw`, identically before and
 *     after. That is a superset of "the sheet, open": what a sheet draws does
 *     not depend on the Modal's `visible` flag.
 *
 *  2. NATIVE TABLET (android, 1100 wide): isDesktop is TRUE on native at
 *     >= 1024, so desktop STYLES apply there (accepted, documented), but the
 *     useIsDesktopWeb() switches must stay off: the daily report still opens
 *     the editor, never the log.
 *
 * What a snapshot records: every style prop FLATTENED (a `false` left by
 * `isDesktop && …` renders nothing), handler props dropped (behaviour, not
 * pixels), undefined props dropped. The clock is pinned (the fake clock
 * renderRouter installs starts from Date.now(), which is pinned here).
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, ESTIMATE_ID } from '@/__tests__/fixtures/world';

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

// ── 1. GOLDEN, phone ───────────────────────────────────────────────────────
describe('lane H — the phone is unchanged (golden, 390 × 844 iOS)', () => {
  jest.setTimeout(120000);

  // Screens whose phone render is the whole proof: every sheet they own is in
  // the tree (see the header), and every segment row sits at rest.
  const ROUTES: Array<[string, string]> = [
    ['daily-report (editor, send + crew + contact sheets)', `/daily-report?${P}`],
    ['time-tracking (Live, six sheets)', `/time-tracking?${P}`],
    ['field-ticket (the job picker)', '/field-ticket'],
    ['punch-list (walk, filter and five more sheets)', `/punch-list?${P}`],
    ['punch-walk (trade override, sub picker, all locations)', `/punch-walk?${P}`],
    ['safety-certifications', `/safety-certifications?${P}`],
    ['safety-forms', `/safety-forms?${P}`],
    ['safety-hazards', `/safety-hazards?${P}`],
    ['safety-incidents (Report Incident)', `/safety-incidents?${P}`],
    ['safety-inspections', `/safety-inspections?${P}`],
    ['safety-jha', `/safety-jha?${P}`],
    ['safety-toolbox', `/safety-toolbox?${P}`],
    ['retention', `/retention?${P}`],
    ['warranties', `/warranties?${P}`],
    ['selections', `/selections?${P}`],
    ['prequal-manager', '/prequal-manager'],
    ['permits', `/permits?${P}`],
    ['estimate/full (dialogs and forms)', '/estimate/full'],
    ['estimate/review', `/estimate/review?${P}&estimateId=${ESTIMATE_ID}`],
    ['contract (signature sheets)', `/contract?${P}`],
    ['construction-ai', '/construction-ai'],
    ['mage-id-bids', '/mage-id-bids'],
    ['marketplace', '/marketplace'],
    ['equipment', '/equipment'],
    ['area-takeoff', `/area-takeoff?${P}`],
    ['cost-seed', '/cost-seed'],
    ['data-export', '/data-export'],
    ['import-pipeline', '/import-pipeline'],
    ['last-planner', `/last-planner?${P}`],
    ['sub-scorecard', '/sub-scorecard'],
    ['reports (tab row)', `/reports?${P}`],
    ['payments (tab row)', `/payments?${P}`],
    ['job-costing', `/job-costing?${P}`],
    ['deliveries (horizon row)', `/deliveries?${P}`],
    ['cost-xray', `/cost-xray?${P}`],
    ['scan', `/scan?${P}`],
    ['judges', '/judges'],
    ['weekly-snapshot', `/weekly-snapshot?${P}`],
  ];

  it.each(ROUTES)('%s', async (_name, url) => {
    const tree = await phoneRoute(url);
    expect(fingerprint(_name, tree.toJSON())).toMatchSnapshot();
  });

  it('time-tracking: the History tab', async () => {
    const tree = await phoneRoute(`/time-tracking?${P}`);
    const history = screen.queryAllByText(/^History/);
    expect(history.length).toBeGreaterThan(0);
    fireEvent.press(history[0]);
    await pump();
    expect(fingerprint('time-tracking-history', tree.toJSON())).toMatchSnapshot();
  });

  it('field-ticket: pick a job on a free plan -> the paywall / access view', async () => {
    const tree = await phoneRoute('/field-ticket', async () => {
      await AsyncStorage.setItem('mageid_subscription_tier', 'free');
    });
    const pick = screen.queryAllByText(/Kitchen|Remodel|Henderson|Ridgeline/i);
    if (pick.length > 0) {
      fireEvent.press(pick[0]);
      await pump();
    }
    expect(fingerprint('field-ticket-access', tree.toJSON())).toMatchSnapshot();
  });
});

// ── Components mounted on their own ────────────────────────────────────────
describe('lane H — components (golden, 390 phone)', () => {
  const METRICS = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
  };
  const Wrap = ({ children }: { children: React.ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
  );

  it('ContactPickerModal, open', () => {
    env('ios', 390, 844);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ContactPickerModal = require('@/components/ContactPickerModal').default;
    const contacts = [
      { id: 'c1', firstName: 'Ava', lastName: 'Stone', companyName: 'Stone Electric', role: 'Sub', email: 'ava@stone.test', phone: '555-0101', address: '', notes: '', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
      { id: 'c2', firstName: 'Ben', lastName: 'Ruiz', companyName: '', role: 'Client', email: 'ben@ruiz.test', phone: '', address: '', notes: '', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
    ];
    const r = render(
      <Wrap><ThemeProvider><View><ContactPickerModal visible contacts={contacts} onClose={() => {}} onSelect={() => {}} /></View></ThemeProvider></Wrap>,
    );
    expect(fingerprint('contact-picker', r.toJSON())).toMatchSnapshot();
  });
});

// ── 2. Native tablet: desktop styles may apply, desktop-WEB switches may not ─
describe('lane H — android 1100 (isDesktop true, desktopWeb false)', () => {
  jest.setTimeout(120000);
  it('daily-report with only a projectId opens the EDITOR, never the log', async () => {
    env('android', 1100, 800);
    await primeWorld('populated');
    await mountRouteChecked(`/daily-report?${P}`);
    await pump();
    expect(screen.queryByTestId('dfr-log')).toBeNull();
    expect(screen.getByTestId('save-draft-btn')).toBeTruthy();
  });
});

// ── 3. Desktop web: a bare ?projectId= opens the LOG; new=1 the editor ──────
// Behaviour, not pixels (no snapshot): the gate reads useIsDesktopWeb() (forced
// on here — see the mock above), and every link that names a report or asks
// for a new one still opens the editor.
describe('lane H — desktop web 1512 (the daily-report gate)', () => {
  jest.setTimeout(120000);
  it('a bare projectId opens the report log beside the open report', async () => {
    env('ios', 1512, 945);
    mockForceDesktopWeb = true;
    await primeWorld('populated');
    await mountRouteChecked(`/daily-report?${P}`);
    await pump();
    expect(screen.getByTestId('dfr-log')).toBeTruthy();
    expect(screen.queryByTestId('save-draft-btn')).toBeNull();
  });
  it('new=1 opens the editor, not the log', async () => {
    env('ios', 1512, 945);
    mockForceDesktopWeb = true;
    await primeWorld('populated');
    await mountRouteChecked(`/daily-report?${P}&new=1`);
    await pump();
    expect(screen.queryByTestId('dfr-log')).toBeNull();
    expect(screen.getByTestId('save-draft-btn')).toBeTruthy();
  });
});
