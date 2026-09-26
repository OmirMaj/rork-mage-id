/**
 * Wave 6d, lane M1 — the AIA G703 grid, the G702 KPI strip and the
 * change-order line grid. PHONE PROOF.
 *
 * On desktop web the AIA pay app's schedule of values becomes an editable
 * G703 grid (components/desktop/LineItemGrid) with an 8-cell G702 strip, and
 * the change-order editor's lines become the same grid. Every one of those
 * edits sits behind useIsDesktopWeb() (the grid switch), an `isDesktop && …`
 * style append, or a primitive whose phone branch is today's tree — so on the
 * iPhone the tree may change ONLY where the spec names an intended delta:
 *
 *   founder default 2 — the G702 summary card and the SOV card's "Scheduled"
 *     value print CENTS (formatMoney(x, 2)), because the PDF the GC certifies
 *     does;
 *   founder default 1b — the two early-access cards (rendered while
 *     currentPaymentDue > 0) lose every rate, "today", partner and date claim
 *     (contract D8's exact copy).
 *
 * Both touch only goldens (a)–(c). (d) and (e), the change-order editor, must
 * pass UNCHANGED.
 *
 * GOLDEN — recorded FIRST, on a pristine `git archive 439e119a` copy, before
 * a single source line of this lane was written. The g-logs harness: the real
 * app (mountRouteChecked, the provider stack, the populated fixture world plus
 * this file's records) at 390 × 844 iOS with useResponsiveLayout mocked to
 * phone; every <Modal> renders its content; styles flattened, handlers and
 * undefined props dropped; both clocks pinned.
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

// useIsDesktopWeb(): the app's own answer everywhere (false on iOS/Android),
// unless the desktop-web block at the bottom forces it (the g-logs recipe:
// RN-web cannot run inside this native harness).
let mockForceDesktopWeb = false;
jest.mock('@/components/ui/desktop', () => {
  const actual = jest.requireActual('@/components/ui/desktop');
  return { ...actual, useIsDesktopWeb: () => (mockForceDesktopWeb ? actual.useIsDesktop() : actual.useIsDesktopWeb()) };
});

// Every Modal renders its content, open or closed (the g-logs harness).
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
        testID: 'g-modal',
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

// Two clocks, both pinned (see g-logs-phone-identical GOLDEN_CLOCK).
const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-25T16:00:00.000Z').getTime();
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

// ── What a snapshot records (one line per host node; line count + sha256) ──
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
function dumpText(json: unknown): string {
  const out: string[] = [];
  dumpLines(json, 0, out);
  return out.join('\n');
}
function fingerprint(name: string, json: unknown): { lines: number; sha256: string } {
  const text = dumpText(json);
  const dir = process.env.M1_DUMP_DIR;
  if (dir) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/${name.replace(/[^a-z0-9]+/gi, '_')}.txt`, text);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sha256 = require('node:crypto').createHash('sha256').update(text).digest('hex');
  return { lines: text.split('\n').length, sha256 };
}

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

// ── The records the populated world leaves empty ────────────────────────────
// Two progress invoices on the fixture job (a fresh period and a saved one),
// one saved AIA record on the second, and change orders: a draft with a
// needs_price and an ai_estimated line, and an approved (locked) one.
const INV_FRESH = 'inv-m1-fresh';
const INV_SAVED = 'inv-m1-saved';
const AIA_SAVED = 'aia-m1-saved';
const CO_DRAFT = 'co-m1-draft';
const CO_APPROVED = 'co-m1-approved';

const DEMO = 'Selective demolition — kitchen + primary bath';
const FRAMING = 'Rough carpentry — wall relocation, header at island';
const CABINETS = 'Semi-custom cabinetry, painted maple';

const invoice = (id: string, number: number, issueDate: string) => ({
  id,
  number,
  projectId: PROJECT_ID,
  type: 'progress',
  progressPercent: 100,
  issueDate,
  dueDate: '2026-09-30T12:00:00.000Z',
  paymentTerms: 'net_30',
  notes: '',
  lineItems: [
    { id: `${id}-l1`, name: DEMO, description: '', quantity: 1, unit: 'LS', unitPrice: 3400.5, total: 3400.5 },
    { id: `${id}-l2`, name: FRAMING, description: '', quantity: 1, unit: 'LS', unitPrice: 2250.25, total: 2250.25 },
    { id: `${id}-l3`, name: CABINETS, description: '', quantity: 1, unit: 'LS', unitPrice: 9950, total: 9950 },
  ],
  subtotal: 15600.75,
  taxRate: 0,
  taxAmount: 0,
  totalDue: 15600.75,
  amountPaid: 0,
  status: 'sent',
  payments: [],
  retainagePercent: 10,
  createdAt: issueDate,
  updatedAt: issueDate,
});

const invoices = [
  invoice(INV_FRESH, 3, '2026-08-01T12:00:00.000Z'),
  invoice(INV_SAVED, 2, '2026-07-01T12:00:00.000Z'),
];

const savedLine = (id: string, itemNo: string, description: string, scheduledValue: number, fromPreviousApp: number, thisPeriod: number, stored: number) => ({
  id, itemNo, description, scheduledValue, fromPreviousApp, thisPeriod, materialsPresentlyStored: stored, retainagePercent: 10,
});

function savedApp(payLink: boolean) {
  return {
    id: AIA_SAVED,
    projectId: PROJECT_ID,
    invoiceId: INV_SAVED,
    applicationNumber: 1,
    applicationDate: '2026-07-01',
    periodTo: '2026-06-30',
    periodFrom: '2026-06-01',
    ownerName: 'Meredith Harlow',
    contractorName: 'Smoke GC',
    projectName: 'Harlow Residence — kitchen + primary suite',
    originalContractSum: 155172,
    netChangeByCO: 0,
    contractSumToDate: 155172,
    retainagePercent: 10,
    lessPreviousCertificates: 0,
    lines: [
      savedLine('sov_saved_1', '1', DEMO, 6800, 0, 3400.5, 0),
      savedLine('sov_saved_2', '2', FRAMING, 7488, 0, 2250.25, 1200.4),
      // Billed past its scheduled value (C 8064, D+E+F 8500.33).
      savedLine('sov_saved_3', '3', 'Quartz countertops + waterfall island', 8064, 0, 8500.33, 0),
    ],
    totals: {
      totalScheduledValue: 22352,
      totalCompletedAndStored: 15351.48,
      totalRetainage: 1535.15,
      totalEarnedLessRetainage: 13816.33,
      currentPaymentDue: 13816.33,
      balanceToFinish: 141355.67,
      percentComplete: 68.7,
    },
    ...(payLink ? { payLinkUrl: 'https://buy.stripe.com/test_m1', payLinkId: 'plink_m1', payLinkAmount: 13816.33 } : {}),
    savedAt: '2026-07-02T12:00:00.000Z',
  };
}

const coLine = (id: string, name: string, quantity: number, unit: string, unitPrice: number, extra: Record<string, unknown> = {}) => ({
  id, name, description: '', quantity, unit, unitPrice, total: Math.round(quantity * unitPrice * 100) / 100, isNew: true, ...extra,
});

const changeOrders = [
  {
    id: CO_DRAFT,
    number: 1,
    projectId: PROJECT_ID,
    date: '2026-08-05T12:00:00.000Z',
    description: 'Add island outlet circuit and pendant rough-in',
    reason: 'Owner request',
    lineItems: [
      coLine('coli-m1-1', 'Outlet circuit', 1, 'ea', 650.5),
      coLine('coli-m1-2', 'Pendant rough-in', 3, 'ea', 0, { priceSource: 'needs_price' }),
      coLine('coli-m1-3', 'Patch and paint', 12.5, 'sf', 18.75, { priceSource: 'ai_estimated' }),
    ],
    originalContractValue: 155172,
    changeAmount: 884.88,
    newContractTotal: 156056.88,
    scheduleImpactDays: 1,
    status: 'draft',
    createdAt: '2026-08-05T12:00:00.000Z',
    updatedAt: '2026-08-05T12:00:00.000Z',
  },
  {
    id: CO_APPROVED,
    number: 2,
    projectId: PROJECT_ID,
    date: '2026-08-06T12:00:00.000Z',
    description: 'Upgrade vanity lighting',
    reason: 'Owner request',
    lineItems: [coLine('coli-m1-4', 'Vanity light fixtures', 2, 'ea', 612.35)],
    originalContractValue: 155172,
    changeAmount: 1224.7,
    newContractTotal: 156396.7,
    scheduleImpactDays: 0,
    status: 'approved',
    createdAt: '2026-08-06T12:00:00.000Z',
    updatedAt: '2026-08-06T12:00:00.000Z',
  },
];

async function seedRecords(payLink: boolean) {
  await AsyncStorage.multiSet([
    ['mageid_invoices', JSON.stringify(invoices)],
    ['mageid_change_orders', JSON.stringify(changeOrders)],
    ['mageid_aia_pay_apps', JSON.stringify([savedApp(payLink)])],
  ]);
}

async function mountAt(url: string, os: 'ios' | 'android', width: number, height: number, payLink = false) {
  env(os, width, height);
  await primeWorld('populated');
  await seedRecords(payLink);
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

const P = `projectId=${PROJECT_ID}`;

// ── GOLDEN, phone ───────────────────────────────────────────────────────────
describe('lane M1 — the phone is unchanged except the named deltas (golden, 390 × 844 iOS)', () => {
  jest.setTimeout(120000);

  it('(a) /aia-pay-app, a fresh progress period: an editable draft, one line over-billed, one with stored material', async () => {
    const tree = await mountAt(`/aia-pay-app?invoiceId=${INV_FRESH}`, 'ios', 390, 844);
    // Editable: the MoneyFields are live.
    const stored = screen.getAllByTestId(/^aia-stored-sov_/);
    const thisPeriod = screen.getAllByTestId(/^aia-this-period-sov_/);
    expect(stored.length).toBeGreaterThanOrEqual(3);
    // Stored material on the second line; the first line billed past C.
    await act(async () => { fireEvent.changeText(stored[1], '1200.40'); });
    await act(async () => { fireEvent.changeText(thisPeriod[0], '7100.25'); });
    await pump(3);
    expect(screen.getAllByTestId(/^aia-install-stored-/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId(/^aia-overbill-sov_/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('aia-factoring-cta')).toBeTruthy();
    expect(screen.queryByTestId('aia-review-banner')).toBeNull();
    expect(fingerprint('a_aia_fresh_draft', tree.toJSON())).toMatchSnapshot();
  });

  it('(b) /aia-pay-app, the saved record: review mode, read-only', async () => {
    const tree = await mountAt(`/aia-pay-app?invoiceId=${INV_SAVED}`, 'ios', 390, 844);
    expect(screen.getByTestId('aia-review-banner')).toBeTruthy();
    expect(screen.getByTestId('aia-edit-draft')).toBeTruthy();
    expect(fingerprint('b_aia_saved_review', tree.toJSON())).toMatchSnapshot();
  });

  it('(c) /aia-pay-app, the saved record with a pay link: locked', async () => {
    const tree = await mountAt(`/aia-pay-app?invoiceId=${INV_SAVED}`, 'ios', 390, 844, true);
    expect(screen.getByTestId('aia-review-banner')).toBeTruthy();
    expect(screen.queryByTestId('aia-edit-draft')).toBeNull();
    expect(fingerprint('c_aia_saved_locked', tree.toJSON())).toMatchSnapshot();
  });

  it('(d) /change-order, a draft with a needs_price and an ai_estimated line', async () => {
    const tree = await mountAt(`/change-order?${P}&coId=${CO_DRAFT}`, 'ios', 390, 844);
    expect(screen.getByTestId('co-number-label')).toBeTruthy();
    expect(screen.queryByTestId('co-lines')).toBeNull();
    expect(fingerprint('d_co_draft_lines', tree.toJSON())).toMatchSnapshot();
  });

  it('(e) /change-order, an approved CO: locked', async () => {
    const tree = await mountAt(`/change-order?${P}&coId=${CO_APPROVED}`, 'ios', 390, 844);
    expect(screen.getByTestId('co-number-label')).toBeTruthy();
    expect(fingerprint('e_co_approved_locked', tree.toJSON())).toMatchSnapshot();
  });
});

// ── Native tablet: desktop STYLES may apply, the desktop-WEB grid may not ────
describe('lane M1 — android 1100 (isDesktop true, desktopWeb false): the cards stay', () => {
  jest.setTimeout(120000);
  it('the AIA schedule of values is the line cards, not the G703 grid', async () => {
    await mountAt(`/aia-pay-app?invoiceId=${INV_FRESH}`, 'android', 1100, 800);
    expect(screen.queryByTestId('aia-g703')).toBeNull();
    expect(screen.queryByTestId('aia-sov-view')).toBeNull();
    expect(screen.getAllByTestId(/^aia-this-period-sov_/).length).toBeGreaterThanOrEqual(3);
  });
  it('the change-order lines are the line cards, not the grid', async () => {
    await mountAt(`/change-order?${P}&coId=${CO_DRAFT}`, 'android', 1100, 800);
    expect(screen.getByTestId('co-number-label')).toBeTruthy();
    expect(screen.queryByTestId('co-lines')).toBeNull();
    expect(screen.queryByTestId('co-lines-view')).toBeNull();
  });
});

// ── Desktop web (forced useIsDesktopWeb, 1512): the change-order line grid ───
// Behaviour, not pixels. The editor opens beside the change-order log.
describe('lane M1 — the change-order line grid (desktop web 1512)', () => {
  jest.setTimeout(120000);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const co = require('@/app/change-order') as typeof import('@/app/change-order');
  async function desk(url: string) {
    env('ios', 1512, 945);
    mockForceDesktopWeb = true;
    await primeWorld('populated');
    await seedRecords(false);
    await mountRouteChecked(url);
    await pump();
  }
  const rows = () => screen.queryAllByTestId(/^co-lines-row-/);

  it('the grid replaces the cards: Item | Qty | Unit | Unit $ | Total, and the Grid | Cards switch', async () => {
    await desk(`/change-order?${P}&coId=${CO_DRAFT}`);
    expect(screen.getByTestId('co-lines')).toBeTruthy();
    expect(screen.getByTestId('co-lines-view')).toBeTruthy();
    expect(rows()).toHaveLength(3);
    expect(screen.queryByTestId('co-line-qty-coli-m1-1')).toBeNull(); // the card inputs are gone
    expect(screen.getByText('Lines subtotal (before tax)')).toBeTruthy();
    expect(screen.getByText('CSI division, line notes and margin are in Cards.')).toBeTruthy();
    // The row tags say why a line cannot go out yet.
    expect(screen.getByText('Needs a price — it cannot be sent at $0.')).toBeTruthy();
    expect(screen.getByText('AI estimate from your cost book — type a price, or confirm it when you send.')).toBeTruthy();
  });

  it('Enter adds a needs_price line under the current one', async () => {
    await desk(`/change-order?${P}&coId=${CO_DRAFT}`);
    await act(async () => { fireEvent(screen.getByTestId('co-lines-cell-coli-m1-1-name'), 'submitEditing'); });
    await pump(2);
    const now = rows();
    expect(now).toHaveLength(4);
    const newId = (now[1].props.testID as string).replace('co-lines-row-', '');
    expect(newId).not.toMatch(/^coli-m1-/); // inserted right under line 1
    expect(screen.getByText('Name this line — it prints on the change order.')).toBeTruthy();
    await act(async () => { fireEvent.changeText(screen.getByTestId(`co-lines-cell-${newId}-name`), 'Blocking for pendants'); });
    await pump(2);
    // Named now: what is left is the price, and it is tagged needs_price.
    expect(screen.queryByText('Name this line — it prints on the change order.')).toBeNull();
    expect(screen.getAllByText('Needs a price — it cannot be sent at $0.')).toHaveLength(2);
  });

  it("after a '12.345' price draft the footer is persistCO's committed amount, not the typed line's", async () => {
    await desk(`/change-order?${P}&coId=${CO_DRAFT}`);
    await act(async () => { fireEvent.changeText(screen.getByTestId('co-lines-cell-coli-m1-3-unitPrice'), '12.345'); });
    await pump(2);
    const draftLines = changeOrders[0].lineItems.map((l) => (l.id === 'coli-m1-3'
      ? { ...l, unitPrice: 12.345, total: co.coRoundCents(l.quantity * 12.345), priceSource: undefined }
      : l));
    const committedAmount = co.coRoundCents(co.coCommitLineItems(draftLines).reduce((s, i) => s + i.total, 0));
    const naive = co.coRoundCents(draftLines.reduce((s, i) => s + i.total, 0));
    expect(committedAmount).toBe(co.coGridFooter(draftLines));
    expect(committedAmount).not.toBe(naive); // the fixture really has a half cent in it
    const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const footer = screen.getByTestId('co-lines-totals');
    const texts: string[] = [];
    const walk = (n: unknown) => {
      if (typeof n === 'string') { texts.push(n); return; }
      const el = n as { children?: unknown[] } | null;
      for (const c of el?.children ?? []) walk(c);
    };
    walk(footer);
    expect(texts).toContain(money(committedAmount));
    expect(texts).not.toContain(money(naive));
    // The typed draft stays in the box until blur, then commits to the cent.
    expect(screen.getByTestId('co-lines-cell-coli-m1-3-unitPrice').props.value).toBe('12.345');
    await act(async () => { fireEvent(screen.getByTestId('co-lines-cell-coli-m1-3-unitPrice'), 'blur'); });
    await pump(2);
    expect(screen.getByTestId('co-lines-cell-coli-m1-3-unitPrice').props.value).toBe('12.35');
  });

  it('an approved (locked) change order: the grid is read-only', async () => {
    await desk(`/change-order?${P}&coId=${CO_APPROVED}`);
    expect(screen.getByTestId('co-lines')).toBeTruthy();
    expect(screen.queryByTestId('co-lines-add')).toBeNull();
    expect(screen.queryByTestId('co-lines-cell-coli-m1-4-name')).toBeNull();
    expect(screen.getByTestId('co-lines-text-coli-m1-4-name')).toBeTruthy();
  });
});
