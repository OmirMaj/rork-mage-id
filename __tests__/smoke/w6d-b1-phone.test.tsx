/**
 * Wave 6d, lane B1 — money dashboards I (Budget, Job costing, Cash flow), the
 * row-action popover and the record-payment sheet. PHONE PROOF.
 *
 * Every edit in lane B1 is `isDesktop && …`, a sheet frame whose phone branch
 * is inert (useSheetFrame returns null styles, the caller's own animation and
 * showHandle true), a primitive whose phone branch is today's tree
 * (DashboardColumns renders `<>{kpis}{main}{rail}{below}</>` only where that
 * concatenation IS today's order; DataTable → rows.map(renderCard)), or an
 * `isDesktopWeb ? desktop : today` switch. So on the iPhone NOTHING may change.
 * This file is the proof.
 *
 * GOLDEN — recorded FIRST, on the untouched base (439e119a), before a single
 * line of this lane was written, and never regenerated. Each route case mounts
 * a real route inside the real app (the 16-provider stack, the populated
 * fixture world, enterprise tier) at 390 × 844 iOS with useResponsiveLayout
 * mocked to phone. The component cases inject a one-line synthetic screen into
 * the real app tree (mountRouteChecked's injected form), so EntityActionSheet
 * reads the real ProjectContext and router.
 *
 * EVERY <Modal> RENDERS ITS CONTENT, open or not (the w6c-field-phone
 * harness): job-costing's commitment editor and phase sheet, and cash-flow's
 * balance / expense / payment sheets are all in their screens' snapshots, in
 * their phone styles, with `visible`, `transparent` and `animationType`
 * recorded.
 *
 * NATIVE TABLET (android 1100): isDesktop is TRUE on native at >= 1024, so
 * desktop STYLES may apply there (the accepted 6c tablet rule), but no
 * useIsDesktopWeb() structure may: no dashboard-columns-row, no jobcost-kpis
 * strip, no entity-action-popover; the job-costing KPI cards still render.
 */

import React from 'react';
import { ActionSheetIOS, Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, ESTIMATE_ID } from '@/__tests__/fixtures/world';
import type { EntityRef } from '@/types';

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

// useIsDesktopWeb(): the app's own answer everywhere (false on iOS/Android).
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

// Two clocks, both pinned (see w6c-field-phone for why the outer realm's
// Date.now — the one renderRouter's fake timers start from — is pinned too).
const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-25T15:00:00.000Z').getTime();
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
// One line per host node — type, every style FLATTENED, every primitive or
// small-object prop, handlers dropped — stored as the dump's line count and
// sha256. Set $W6C_DUMP_DIR to write the dumps for a line-by-line diff.
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

async function phoneRoute(url: string) {
  env('ios', 390, 844);
  await primeWorld('populated');
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

const P = `projectId=${PROJECT_ID}`;

// ── 1. GOLDEN, phone routes ────────────────────────────────────────────────
describe('lane B1 — the phone is unchanged (golden, 390 × 844 iOS)', () => {
  jest.setTimeout(120000);

  const ROUTES: Array<[string, string]> = [
    ['budget-dashboard', `/budget-dashboard?${P}`],
    ['job-costing (commitment editor + phase sheet mounted)', `/job-costing?${P}`],
    ['cash-flow with a project (balance, expense, payment sheets)', `/cash-flow?${P}`],
    ['cash-flow (no project)', '/cash-flow'],
  ];

  it.each(ROUTES)('%s', async (name, url) => {
    const tree = await phoneRoute(url);
    expect(fingerprint(name, tree.toJSON())).toMatchSnapshot();
  });

  it('job-costing: the first phase pressed (PhaseDetailModal open)', async () => {
    const tree = await phoneRoute(`/job-costing?${P}`);
    // The status pill is drawn only by PhaseBar (the By-phase cards); a press
    // on it bubbles to the PhaseBar's own touchable.
    const pills = screen.queryAllByText(/^(On track|Watch|Over|Unbudgeted)$/);
    expect(pills.length).toBeGreaterThan(0);
    fireEvent.press(pills[0]);
    await pump();
    expect(fingerprint('job-costing-phase-open', tree.toJSON())).toMatchSnapshot();
  });
});

// ── 2. GOLDEN, components (injected into the real app tree) ────────────────
// A module-level slot the injected screens read; set before each mount.
// The screen keeps the ref in state so a case can open the sheet AFTER the
// mount (the web cases: the app root cannot mount with Platform.OS 'web' in
// this native harness — expo-router reads window.location — so they mount on
// android and flip only Platform.OS before the sheet opens and renders).
let mockSheetRef: EntityRef | null = null;
let mockSetSheetRef: ((r: EntityRef | null) => void) | null = null;
function EntitySheetScreen() {
  const [ref, setRef] = React.useState<EntityRef | null>(mockSheetRef);
  mockSetSheetRef = setRef;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const EntityActionSheet = require('@/components/EntityActionSheet').default;
  return <EntityActionSheet entityRef={ref} onClose={() => {}} />;
}
function RecordPaymentScreen() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RecordPaymentModal = require('@/components/RecordPaymentModal').default;
  return (
    <RecordPaymentModal
      visible
      title="Stone Electric · Invoice 12"
      amountLabel="$1,250.00"
      initial={{ method: 'check', reference: '1042', paidOn: '2026-08-14' }}
      onCancel={() => {}}
      onSubmit={() => {}}
      onSkip={() => {}}
    />
  );
}

const PROJECT_REF: EntityRef = { kind: 'project', id: PROJECT_ID };
const RFI_REF: EntityRef = { kind: 'rfi', id: 'rfi-1', projectId: PROJECT_ID };

async function mountSheet(os: 'ios' | 'android' | 'web', ref: EntityRef | null) {
  env(os === 'web' ? 'android' : os, 390, 844);
  await primeWorld('populated');
  mockSheetRef = os === 'web' ? null : ref;
  const tree = await mountRouteChecked('/w6d-b1-entity-sheet', EntitySheetScreen);
  await pump();
  if (os === 'web') {
    restoreOS?.();
    restoreOS = jest.replaceProperty(Platform, 'OS', 'web').restore;
    mockWeb = true;
    await act(async () => { mockSetSheetRef?.(ref); });
    await pump();
  }
  return tree;
}

describe('lane B1 — components (golden, 390 phone)', () => {
  jest.setTimeout(120000);

  it('RecordPaymentModal, open (iOS)', async () => {
    env('ios', 390, 844);
    await primeWorld('populated');
    const tree = await mountRouteChecked('/w6d-b1-record-payment', RecordPaymentScreen);
    await pump();
    expect(screen.getByTestId('payment-save')).toBeTruthy();
    expect(fingerprint('record-payment', tree.toJSON())).toMatchSnapshot();
  });

  const SHEETS: Array<[string, 'android' | 'web', EntityRef]> = [
    ['EntityActionSheet project ref, android 390', 'android', PROJECT_REF],
    ['EntityActionSheet rfi ref, android 390', 'android', RFI_REF],
    ['EntityActionSheet project ref, web 390', 'web', PROJECT_REF],
    ['EntityActionSheet rfi ref, web 390', 'web', RFI_REF],
  ];
  it.each(SHEETS)('%s', async (name, os, ref) => {
    const tree = await mountSheet(os, ref);
    expect(screen.getByTestId('entity-action-open')).toBeTruthy();
    expect(screen.queryByTestId('entity-action-popover')).toBeNull();
    expect(fingerprint(name, tree.toJSON())).toMatchSnapshot();
  });

  it('EntityActionSheet on iOS renders nothing (the native sheet owns the UI)', async () => {
    // jest has no native ActionSheetManager; the call itself is the iOS UI.
    const show = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
    const tree = await mountSheet('ios', RFI_REF);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0].options).toEqual(expect.arrayContaining(['Cancel']));
    show.mockRestore();
    expect(screen.queryByTestId('entity-action-open')).toBeNull();
    expect(fingerprint('entity-sheet-ios', tree.toJSON())).toMatchSnapshot();
  });
});

// ── 3. Native tablet: desktop styles may apply, desktop-WEB structure may not
describe('lane B1 — android 1100 (isDesktop true, desktopWeb false)', () => {
  jest.setTimeout(120000);

  it('EntityActionSheet: the sheet, never the popover', async () => {
    env('android', 1100, 800);
    await primeWorld('populated');
    mockSheetRef = RFI_REF;
    await mountRouteChecked('/w6d-b1-entity-sheet', EntitySheetScreen);
    await pump();
    expect(screen.getByTestId('entity-action-open')).toBeTruthy();
    expect(screen.queryByTestId('entity-action-popover')).toBeNull();
  });

  async function tablet(url: string) {
    env('android', 1100, 800);
    await primeWorld('populated');
    await mountRouteChecked(url);
    await pump();
  }

  it('job-costing keeps the KPI cards; no columns row, no KPI strip, no tables', async () => {
    await tablet(`/job-costing?${P}`);
    expect(screen.getByTestId('variance-kpi')).toBeTruthy();
    expect(screen.queryByTestId('dashboard-columns-row')).toBeNull();
    expect(screen.queryByTestId('jobcost-kpis')).toBeNull();
    expect(screen.queryByTestId('open-living-estimate')).toBeTruthy();
  });

  it('budget-dashboard: no columns row', async () => {
    await tablet(`/budget-dashboard?${P}`);
    expect(screen.queryByTestId('dashboard-columns-row')).toBeNull();
    expect(screen.queryByTestId('dashboard-columns')).toBeNull();
  });

  it('cash-flow: no columns row', async () => {
    await tablet(`/cash-flow?${P}`);
    expect(screen.queryByTestId('dashboard-columns-row')).toBeNull();
    expect(screen.queryByTestId('dashboard-columns')).toBeNull();
  });

});
