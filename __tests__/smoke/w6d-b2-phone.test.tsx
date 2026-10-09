/**
 * Wave 6d restore (d6r), lane B2 — the WIP report and Bank-Ready Reports as
 * desktop tables, with a header Print action. PHONE PROOF.
 *
 * Every edit in lane B2 is `isDesktop && …`, a sheet frame whose phone branch
 * is inert (useSheetFrame returns null styles, the caller's own animation and
 * showHandle true), a primitive whose phone branch is today's tree
 * (DashboardColumns renders `<>{kpis}{main}{rail}{below}</>` in today's
 * portfolio → periods → projects order; DataTable → rows.map(renderCard);
 * TileGrid → `<View style={phoneStyle}>`; ChipRail → the identical ScrollView;
 * ActionBar → `<View style>`), or an `isDesktopWeb ? desktop : today` switch.
 * One refactor is pure and proved here: WIP's per-row flag derivation moved
 * into `rowFlagState` above `return (`. So on the iPhone NOTHING may change.
 *
 * GOLDEN — recorded FIRST, on the untouched base (24e74ecf), before a single
 * line of this lane was written, and never regenerated. Each case mounts a
 * real route inside the real app (the 16-provider stack, the populated
 * fixture world, enterprise tier) at 390 × 844 iOS with useResponsiveLayout
 * mocked to phone.
 *
 * EVERY <Modal> RENDERS ITS CONTENT, open or not (the w6c-field-phone
 * harness): the WIP drill-in sheet and its date picker are in the WIP
 * snapshots in their phone styles, with `visible`, `transparent` and
 * `animationType` recorded. One case opens the drill on the first project so
 * its body (the two money fields, the provenance box) is drawn too.
 *
 * NATIVE TABLET (android 1100): isDesktop is TRUE on native at >= 1024, so
 * desktop STYLES may apply there (the accepted 6c tablet rule), but no
 * useIsDesktopWeb() structure may: no dashboard-columns-row and no
 * wip-projects table on the WIP report; its cards still render. The reports
 * DataTables DO render there: that is DataTable's own isDesktop gate, accepted
 * and documented since 6b.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
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
const GOLDEN_CLOCK = new Date('2026-09-26T15:00:00.000Z').getTime();
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

// Three issued invoices on the fixture job, so the A/R aging tab has rows (the
// populated world issues none): one long past due, one current, and one paid
// down to its retention (a retainage-only row). Exported shape = types Invoice.
const inv = (id: string, number: number, issueDate: string, dueDate: string, totalDue: number, amountPaid: number, retentionAmount = 0) => ({
  id, number, projectId: PROJECT_ID, type: 'progress', progressPercent: 100,
  issueDate, dueDate, paymentTerms: 'net_30', notes: '',
  lineItems: [{ id: `${id}-l1`, name: 'Progress Billing', description: '', quantity: 1, unit: 'LS', unitPrice: totalDue, total: totalDue }],
  subtotal: totalDue, taxRate: 0, taxAmount: 0, totalDue, amountPaid,
  status: amountPaid > 0 ? 'partially_paid' : 'sent',
  payments: amountPaid > 0 ? [{ id: `${id}-p1`, date: issueDate, amount: amountPaid, method: 'check' }] : [],
  ...(retentionAmount > 0 ? { retentionPercent: 10, retentionAmount } : {}),
  createdAt: issueDate, updatedAt: issueDate,
});
const B2_INVOICES = [
  inv('inv-b2-late', 7, '2026-05-01T12:00:00.000Z', '2026-05-31T12:00:00.000Z', 18_250.5, 0),
  inv('inv-b2-current', 8, '2026-09-20T12:00:00.000Z', '2026-12-20T12:00:00.000Z', 9_400, 0),
  inv('inv-b2-retain', 6, '2026-04-01T12:00:00.000Z', '2026-05-01T12:00:00.000Z', 11_000, 9_900, 1_100),
];

async function phoneRoute(url: string, invoices = false) {
  env('ios', 390, 844);
  await primeWorld('populated');
  if (invoices) await AsyncStorage.setItem('mageid_invoices', JSON.stringify(B2_INVOICES));
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

// ── 1. GOLDEN, phone routes ────────────────────────────────────────────────
describe('lane B2 — the phone is unchanged (golden, 390 × 844 iOS)', () => {
  jest.setTimeout(120000);

  const ROUTES: [string, string][] = [
    ['wip-report (drill sheet + period picker mounted)', '/wip-report'],
    ['reports (default tab)', '/reports'],
    ['reports ?tab=aging', '/reports?tab=aging'],
  ];

  it.each(ROUTES)('%s', async (name, url) => {
    const tree = await phoneRoute(url);
    expect(fingerprint(name, tree.toJSON())).toMatchSnapshot();
  });

  it('reports ?tab=aging with three issued invoices (the aging rows drawn)', async () => {
    const tree = await phoneRoute('/reports?tab=aging', true);
    expect(screen.queryAllByTestId(/^aging-row-/).length).toBeGreaterThan(0);
    expect(fingerprint('reports-aging-rows', tree.toJSON())).toMatchSnapshot();
  });

  it('reports default tab with three issued invoices (billed figures on the WIP rows)', async () => {
    const tree = await phoneRoute('/reports', true);
    expect(fingerprint('reports-wip-billed', tree.toJSON())).toMatchSnapshot();
  });

  it('reports: Profit pressed', async () => {
    const tree = await phoneRoute('/reports');
    fireEvent.press(screen.getByText('Profit'));
    await pump();
    expect(fingerprint('reports-profit', tree.toJSON())).toMatchSnapshot();
  });

  it('wip-report: the first project row pressed (the drill sheet drawn)', async () => {
    const tree = await phoneRoute('/wip-report');
    // Every project row prints "<pct> complete · $<earned> earned"; a press on
    // that line bubbles to the row's own touchable (openDrill).
    const lines = screen.queryAllByText(/complete · \$[\d,]+ earned$/);
    expect(lines.length).toBeGreaterThan(0);
    fireEvent.press(lines[0]);
    await pump();
    expect(screen.getByTestId('wip-etc-input')).toBeTruthy();
    expect(fingerprint('wip-drill-open', tree.toJSON())).toMatchSnapshot();
  });
});

// ── 2. Native tablet: desktop styles may apply, desktop-WEB structure may not
describe('lane B2 — android 1100 (isDesktop true, desktopWeb false)', () => {
  jest.setTimeout(120000);

  async function tablet(url: string) {
    env('android', 1100, 800);
    await primeWorld('populated');
    await mountRouteChecked(url);
    await pump();
  }

  it('wip-report keeps its cards: no columns row, no projects table (the header toolbar may show: isDesktop, W4(f))', async () => {
    await tablet('/wip-report');
    expect(screen.queryByTestId('dashboard-columns-row')).toBeNull();
    expect(screen.queryByTestId('dashboard-columns')).toBeNull();
    expect(screen.queryByTestId('wip-projects')).toBeNull();
    expect(screen.getByText('Portfolio')).toBeTruthy();
    expect(screen.getByText('Periods')).toBeTruthy();
    expect(screen.getByTestId('wip-legend')).toBeTruthy();
  });

  it('reports renders on the tablet (its DataTables follow isDesktop, accepted since 6b)', async () => {
    await tablet('/reports');
    expect(screen.getAllByText('Reports for Your Bank').length).toBeGreaterThan(0);
  });
});
