/**
 * Wave 6d restore (d6r), lane B2 — the WIP report and Bank-Ready Reports on
 * desktop web (1512 × 945).
 *
 * Behaviour, not pixels. RN-web cannot run inside this native harness
 * (expo-router reads window.location on web), so each case keeps Platform.OS
 * native and forces only useIsDesktopWeb() on (the w6c-field-phone pattern);
 * useResponsiveLayout is mocked to the 1512 desktop. It asserts:
 *   - /wip-report: Portfolio (main) beside Periods (rail) in the columns row,
 *     the wip-projects table below, and its totals row IS the Portfolio card —
 *     computeWipPortfolio's figures, printed by two different components — not
 *     a sum of the rows; a row opens the drill-in as a centred 720 card;
 *   - /reports: the WIP, Profit and A/R Aging tables; the WIP footer equals the
 *     summary tiles (report.totals), the Profit footer equals the headline
 *     (profit.totalProfit), the Aging footer the outstanding total; a cost to
 *     date the engine cannot state prints '—', never $0; an aging row opens
 *     /invoice?projectId=…&invoiceId=… (the same URL getRowHref hands the <a>
 *     on web, pinned in scripts/validate-dashboard-tables.ts);
 *   - the header toolbars (wip-toolbar, reports-toolbar): Print is there, and
 *     on an empty account it is blocked and says why.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import { Layout } from '@/constants/designTokens';

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

// One case strips the engine's cost to date off the first WIP row — the
// shape a hand-built or legacy row has — to prove the table prints '—'.
let mockStripCostToDate = false;
jest.mock('@/utils/financialReports', () => {
  const actual = jest.requireActual('@/utils/financialReports');
  return {
    ...actual,
    computeWIPReport: (...args: unknown[]) => {
      const report = actual.computeWIPReport(...args);
      if (!mockStripCostToDate || report.rows.length === 0) return report;
      return { ...report, rows: [{ ...report.rows[0], costToDate: undefined }, ...report.rows.slice(1)] };
    },
  };
});

// Every Modal renders its content, open or closed.
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const ReactActual = jest.requireActual('react');
  const { View: RNView, Text: RNText } = jest.requireActual('react-native');
  class Boundary extends ReactActual.Component<{ children?: React.ReactNode }, { threw: boolean }> {
    state = { threw: false };
    static getDerivedStateFromError() { return { threw: true }; }
    componentDidCatch() { /* recorded as a placeholder */ }
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
  mockStripCostToDate = false;
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
  restoreOS?.();
  restoreOS = null;
});

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;

function texts(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  const kids = (node as { children?: unknown }).children;
  if (kids) texts(kids, out);
  return out;
}
const textsOf = (testID: string) => texts(screen.getByTestId(testID).children as unknown);
/** The cells that follow a label inside a table's texts. */
function after(all: string[], label: string, n: number): string[] {
  const at = all.indexOf(label);
  expect(at).toBeGreaterThan(-1);
  return all.slice(at + 1, at + 1 + n);
}
/** A Portfolio / summary value: the text right after its label, anywhere on screen. */
function valueAfterLabel(label: string): string {
  const all = texts(screen.toJSON() as unknown);
  const at = all.indexOf(label);
  expect(at).toBeGreaterThan(-1);
  return all[at + 1];
}

// Three issued invoices on the fixture job (the populated world issues none):
// one long past due, one current, one paid down to its retention.
const inv = (id: string, number: number, issueDate: string, dueDate: string, totalDue: number, amountPaid: number, retentionAmount = 0) => ({
  id, number, projectId: PROJECT_ID, type: 'progress', progressPercent: 100,
  issueDate, dueDate, paymentTerms: 'net_30', notes: '',
  lineItems: [{ id: `${id}-l1`, name: 'Progress billing', description: '', quantity: 1, unit: 'LS', unitPrice: totalDue, total: totalDue }],
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

async function desk(url: string, opts: { world?: 'empty' | 'populated'; invoices?: boolean } = {}) {
  env('android', 1512, 945);
  mockForceDesktopWeb = true;
  await primeWorld(opts.world ?? 'populated');
  if (opts.invoices) await AsyncStorage.setItem('mageid_invoices', JSON.stringify(B2_INVOICES));
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

const NOTHING_TO_REPORT_START = 'A WIP schedule needs at least one active project with a cost-and-markup estimate.';

describe('lane B2 — /wip-report on desktop web (1512 × 945)', () => {
  jest.setTimeout(120000);

  it('Portfolio beside Periods, the projects table below, and its totals row IS the Portfolio card', async () => {
    await desk('/wip-report');
    expect(screen.getByTestId('dashboard-columns-row')).toBeTruthy();
    const main = screen.getByTestId('dashboard-columns-main');
    const rail = screen.getByTestId('dashboard-columns-rail');
    expect(within(main).getByText('Portfolio')).toBeTruthy();
    expect(within(rail).getByText('Periods')).toBeTruthy();
    expect(flat(rail.props.style).width).toBe(Layout.column.rail);
    const below = screen.getByTestId('dashboard-columns-below');
    expect(within(below).getByTestId('wip-projects')).toBeTruthy();
    // The period chips wrap (ChipRail on desktop): no horizontal ScrollView.
    expect(within(rail).getByText('Live')).toBeTruthy();

    // The totals row: 'Portfolio total', then Contract, Est. cost, Cost to
    // date, (% complete has no total), Earned, Billed — the SAME figures the
    // Portfolio card prints through its own Row component.
    const table = textsOf('wip-projects');
    const [fContract, fEst, fCost, fEarned, fBilled] = after(table, 'Portfolio total', 5);
    expect(fContract).toBe(valueAfterLabel('Revised contract'));
    expect(fEarned).toBe(valueAfterLabel('Earned revenue'));
    expect(fBilled).toBe(valueAfterLabel('Billed to date'));
    expect(fEst).toMatch(/^\$[\d,]+$/);
    expect(fCost).toMatch(/^\$[\d,]+$/);
    // The phone's row cards are not drawn on desktop web.
    expect(screen.queryAllByText(/complete · \$[\d,]+ earned$/)).toHaveLength(0);
  });

  it('a row opens the drill-in as a centred wide card', async () => {
    await desk('/wip-report');
    const rows = screen.getAllByTestId(/^wip-projects-row-/);
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.press(rows[0]);
    await pump();
    const etc = screen.getByTestId('wip-etc-input');
    expect(etc).toBeTruthy();
    // The card the input sits in carries the frame: capped at Layout.sheet.wide.
    type Walk = { props?: { style?: unknown }; parent?: unknown } | null;
    let node = etc as unknown as Walk;
    let capped = false;
    while (node && !capped) {
      if (flat(node.props?.style).maxWidth === Layout.sheet.wide) capped = true;
      node = (node.parent ?? null) as Walk;
    }
    expect(capped).toBe(true);
  });

  it("a saved (frozen) period's rows open nothing; Live rows open the drill again", async () => {
    await desk('/wip-report');
    fireEvent.press(screen.getByText('Save period'));
    await pump();
    const rail = screen.getByTestId('dashboard-columns-rail');
    // The saved chip, then the period-end picker row below it, print the same
    // date; the chip renders first. The cost-basis sentence below proves the
    // press landed on the chip (only a frozen period prints it).
    const dated = within(rail).getAllByText(/^\d{4}-\d{2}-\d{2}$/);
    expect(dated).toHaveLength(2);
    fireEvent.press(dated[0]);
    await pump();
    // The frozen period says so, and its table still draws its rows.
    expect(screen.getByTestId('wip-cost-basis').props.children).toMatch(/^Cost basis: recorded per project on this frozen period/);
    const frozenRows = screen.getAllByTestId(/^wip-projects-row-/);
    expect(frozenRows.length).toBeGreaterThan(0);
    fireEvent.press(frozenRows[0]);
    await pump();
    expect(screen.queryByTestId('wip-etc-input')).toBeNull();
    // Control: back on Live the same press opens the drill (so the null above
    // is the frozen rule, not a press that never lands).
    fireEvent.press(within(rail).getByText('Live'));
    await pump();
    fireEvent.press(screen.getAllByTestId(/^wip-projects-row-/)[0]);
    await pump();
    expect(screen.getByTestId('wip-etc-input')).toBeTruthy();
  });

  it('the header carries Print and Export CSV; both work on a populated book', async () => {
    await desk('/wip-report');
    const bar = screen.getByTestId('wip-toolbar');
    const print = within(bar).getByTestId('wip-print');
    expect(print.props.accessibilityState).toEqual({ disabled: false });
    expect(within(bar).getByTestId('wip-toolbar-csv').props.accessibilityState).toEqual({ disabled: false });
    // The in-page export buttons stay exactly where they were (validate-wip).
    expect(screen.getByText('Export PDF')).toBeTruthy();
  });

  it('on an empty account Print is blocked and says why', async () => {
    await desk('/wip-report', { world: 'empty' });
    const print = screen.getByTestId('wip-print');
    expect(print.props.accessibilityState).toEqual({ disabled: true });
    expect(String(print.props.accessibilityHint)).toContain(NOTHING_TO_REPORT_START);
    expect(screen.queryByTestId('wip-projects')).toBeNull();
  });
});

describe('lane B2 — /reports on desktop web (1512 × 945)', () => {
  jest.setTimeout(120000);

  it('WIP tab: the table, its footer equals the summary tiles (report.totals), no hero', async () => {
    await desk('/reports', { invoices: true });
    expect(screen.getByTestId('reports-wip')).toBeTruthy();
    expect(screen.getByTestId('reports-toolbar')).toBeTruthy();
    // The hero repeated the title; on desktop web only the header says it.
    expect(screen.getAllByText('Reports for your bank')).toHaveLength(1);
    const table = textsOf('reports-wip');
    const [fContract] = after(table, 'Total', 1);
    expect(fContract).toBe(valueAfterLabel('Revised contract'));
    // The Retainage column is shown at 1272 (hideBelow 1150): its total is the tile's.
    expect(table).toContain(valueAfterLabel('Retainage held'));
    // Billed: the column total equals the "Billed" tile.
    expect(table).toContain(valueAfterLabel('Billed'));
    // The cost-basis line and the two named testIDs stay in the summary card.
    expect(screen.getByTestId('reports-cost-basis')).toBeTruthy();
  });

  it("an unknown cost to date prints '—', never $0", async () => {
    mockStripCostToDate = true;
    await desk('/reports', { invoices: true });
    const rows = screen.getAllByTestId(/^reports-wip-row-/);
    const cells = texts(rows[0].children as unknown);
    expect(cells).toContain('—');
    expect(cells).not.toContain('$0');
  });

  it('Profit tab: the table and its footer equal the headline profit', async () => {
    await desk('/reports');
    fireEvent.press(screen.getByText('Profit'));
    await pump();
    expect(screen.getByTestId('reports-profit')).toBeTruthy();
    const table = textsOf('reports-profit');
    const at = table.indexOf('Portfolio');
    expect(at).toBeGreaterThan(-1);
    // The headline under RUNNING PORTFOLIO MARGIN is formatMoney(profit.totalProfit).
    expect(table.slice(at)).toContain(valueAfterLabel('Running portfolio margin'));
    // No Export CSV on Profit (it ships no CSV); Print stays.
    expect(screen.getByTestId('reports-print')).toBeTruthy();
    expect(screen.queryByTestId('reports-toolbar-csv')).toBeNull();
  });

  it('A/R Aging: worst first, footer = outstanding total, a row opens /invoice?projectId&invoiceId', async () => {
    const tree = await desk('/reports?tab=aging', { invoices: true });
    expect(screen.getByTestId('reports-aging')).toBeTruthy();
    const rows = screen.getAllByTestId(/^reports-aging-row-/);
    expect(rows.map((r) => r.props.testID)).toEqual([
      'reports-aging-row-inv-b2-late', 'reports-aging-row-inv-b2-current', 'reports-aging-row-inv-b2-retain',
    ]);
    const table = textsOf('reports-aging');
    // lastIndexOf: 'Total' is also the total-due column's header.
    const tail = table.slice(table.lastIndexOf('Total'));
    // The hero amount above the table is report.totals.totalOutstanding.
    const all = texts(screen.toJSON() as unknown);
    const heroAt = all.findIndex((s) => /^OUTSTANDING — /.test(s));
    const hero = all.slice(heroAt).find((s) => /^\$[\d,]+/.test(s));
    expect(tail).toContain(hero);
    expect(texts(rows[2].children as unknown)).toContain('Retainage only');

    fireEvent.press(rows[0]);
    await pump();
    expect(tree.getPathname()).toBe('/invoice');
    expect(tree.getSearchParams()).toMatchObject({ projectId: PROJECT_ID, invoiceId: 'inv-b2-late' });
  });

  it('on an empty account Print is blocked with the tab\'s reason', async () => {
    await desk('/reports?tab=aging', { world: 'empty' });
    const print = screen.getByTestId('reports-print');
    expect(print.props.accessibilityState).toEqual({ disabled: true });
    expect(String(print.props.accessibilityHint)).toMatch(/A\/R aging report/);
  });
});
