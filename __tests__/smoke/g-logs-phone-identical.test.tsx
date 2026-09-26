/**
 * Wave 6c, lane G — log-first RFIs, submittals, change orders and invoices.
 * PHONE PROOF.
 *
 * On desktop web a bare `?projectId=` link to /rfi, /submittal, /change-order
 * or /invoice now opens a sortable log with the record beside it
 * (utils/logs/logRoutes.logRouteMode), the editors cap at the 760 form
 * column, and their sheets are framed. Every one of those edits sits behind
 * useIsDesktopWeb() (the log switch), an `isDesktop && …` style append, or a
 * wave-6b primitive whose phone branch is today's tree — so on the iPhone
 * NOTHING may change. This file is the proof.
 *
 *  1. GOLDEN — recorded FIRST, on the untouched base (bdd5daee), before a
 *     single line of this lane was written, and never regenerated. Each case
 *     mounts a real route inside the real app (the provider stack, the
 *     populated fixture world plus one submittal, change order and invoice) at
 *     390 × 844 iOS with useResponsiveLayout mocked to phone, and records the
 *     whole rendered tree. Every <Modal> renders its content, open or not, so
 *     a screen's snapshot holds every sheet it owns (send, task picker,
 *     payment, retainage, retention…) in its phone styles.
 *
 *  2. BEHAVIOUR on the phone: a bare `/rfi?projectId=P` still renders the
 *     create FORM (testID rfi-subject), not the log.
 *
 *  3. NATIVE TABLET (android, 1100 wide): isDesktop is TRUE on native at
 *     >= 1024, so desktop STYLES apply there (accepted, documented), but the
 *     useIsDesktopWeb() switch stays off: no log ever mounts.
 *
 *  4. DESKTOP WEB (forced useIsDesktopWeb, 1512): the log for a bare
 *     projectId, the form for new=1 and for the tutorial's type=progress.
 *
 * What a snapshot records: every style prop FLATTENED (a `false` left by
 * `isDesktop && …` renders nothing), handler props dropped (behaviour, not
 * pixels), undefined props dropped. Both clocks are pinned (see GOLDEN_CLOCK).
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';
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
// unless a desktop-web case below forces it. RN-web cannot run inside this
// native harness (expo-router reads window.location on web), so the
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

// Two clocks, both pinned (the GOLDEN_CLOCK pattern of w6c-field-phone):
//  - NOW: this realm's Date.now, read by code that runs with no fake timers.
//  - GOLDEN_CLOCK: the FAKE clock renderRouter installs, which starts from the
//    OUTER realm's Date.now. Without the pin every "Overdue n days" and every
//    today's-date field follows the wall clock and the goldens break at
//    midnight.
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
function fingerprint(name: string, json: unknown): { lines: number; sha256: string } {
  json = stripSanctioned(json);
  const out: string[] = [];
  dumpLines(json, 0, out);
  const text = out.join('\n');
  const dir = process.env.G_DUMP_DIR;
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

// ── Records the populated world leaves empty ────────────────────────────────
const SUBMITTAL_ID = 'sub-g-1';
const CO_ID = 'co-g-1';
const INVOICE_ID = 'inv-g-1';

const submittals = [{
  id: SUBMITTAL_ID,
  projectId: PROJECT_ID,
  number: 1,
  title: 'Curbless shower pan membrane',
  specSection: '07 14 00',
  submittedBy: 'Smoke GC',
  submittedDate: '2026-08-01',
  requiredDate: '2026-08-20',
  trade: 'Tile',
  leadDays: 14,
  reviewCycles: [{ cycleNumber: 1, sentDate: '2026-08-01', reviewer: 'Kestrel Architects', status: 'in_review' }],
  currentStatus: 'in_review',
  attachments: [],
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
}];

const changeOrders = [{
  id: CO_ID,
  number: 1,
  projectId: PROJECT_ID,
  date: '2026-08-05T12:00:00.000Z',
  description: 'Add island outlet circuit',
  reason: 'Owner request',
  lineItems: [{ id: 'li-1', name: 'Outlet circuit', description: '20A circuit to island', quantity: 1, unit: 'ea', unitPrice: 650, total: 650, isNew: true }],
  originalContractValue: 84000,
  changeAmount: 650,
  newContractTotal: 84650,
  scheduleImpactDays: 1,
  status: 'draft',
  createdAt: '2026-08-05T12:00:00.000Z',
  updatedAt: '2026-08-05T12:00:00.000Z',
}];

const invoices = [{
  id: INVOICE_ID,
  number: 1,
  projectId: PROJECT_ID,
  type: 'progress',
  progressPercent: 25,
  issueDate: '2026-08-01T12:00:00.000Z',
  dueDate: '2026-08-31T12:00:00.000Z',
  paymentTerms: 'net_30',
  notes: '',
  lineItems: [{ id: 'il-1', name: 'Demo and framing', description: '', quantity: 1, unit: 'ls', unitPrice: 21000, total: 21000 }],
  subtotal: 21000,
  taxRate: 0,
  taxAmount: 0,
  totalDue: 21000,
  amountPaid: 5000,
  status: 'partially_paid',
  payments: [{ id: 'pay-1', date: '2026-08-10T12:00:00.000Z', amount: 5000, method: 'check' }],
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-10T12:00:00.000Z',
}];

async function seedRecords() {
  await AsyncStorage.multiSet([
    ['mageid_submittals', JSON.stringify(submittals)],
    ['mageid_change_orders', JSON.stringify(changeOrders)],
    ['mageid_invoices', JSON.stringify(invoices)],
  ]);
}

async function phoneRoute(url: string) {
  env('ios', 390, 844);
  await primeWorld('populated');
  await seedRecords();
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

const P = `projectId=${PROJECT_ID}`;

// ── 1. GOLDEN, phone ───────────────────────────────────────────────────────
describe('lane G — the phone is unchanged (golden, 390 × 844 iOS)', () => {
  jest.setTimeout(120000);

  const ROUTES: [string, string][] = [
    ['rfi (project only: the create form)', `/rfi?${P}`],
    ['rfi (a record)', `/rfi?${P}&rfiId=rfi-2`],
    ['submittal (project only)', `/submittal?${P}`],
    ['submittal (a record)', `/submittal?${P}&submittalId=${SUBMITTAL_ID}`],
    ['change-order (project only)', `/change-order?${P}`],
    ['change-order (a record)', `/change-order?${P}&coId=${CO_ID}`],
    ['invoice (project only)', `/invoice?${P}`],
    ['invoice (a record)', `/invoice?${P}&invoiceId=${INVOICE_ID}`],
    ['invoice (the tutorial route, type=progress)', `/invoice?${P}&type=progress`],
  ];

  it.each(ROUTES)('%s', async (name, url) => {
    const tree = await phoneRoute(url);
    expect(fingerprint(name, tree.toJSON())).toMatchSnapshot();
  });

  it('a bare /rfi?projectId on the phone is still the create form, not the log', async () => {
    await phoneRoute(`/rfi?${P}`);
    expect(screen.getByTestId('rfi-subject')).toBeTruthy();
    expect(screen.queryByTestId('rfi-log')).toBeNull();
  });
});

// ── 1b. GOLDEN, phone — the bars the ActionBar swap touched most ──────────
// Fix round 1 (review): the draft CO and the partly-paid invoice above never
// render the approved-CO bill bar (with its ActionBarReadout note), a locked
// CO, or a sent invoice's reminder / pay-link buttons (desktopCta appends).
// These goldens were recorded on a scratch copy of the untouched base
// (git archive bdd5daee), never in this worktree, then copied in.
const EXTRA_CO_BILLABLE = 'co-g-2';
const EXTRA_CO_CREDIT = 'co-g-3';
const EXTRA_CO_REJECTED = 'co-g-4';
const EXTRA_INV_SENT = 'inv-g-2';
const coBase = changeOrders[0];
const extraChangeOrders = [
  { ...coBase, id: EXTRA_CO_BILLABLE, number: 2, description: 'Upgrade vanity lighting', changeAmount: 1200, newContractTotal: 85200, status: 'approved' },
  { ...coBase, id: EXTRA_CO_CREDIT, number: 3, description: 'Delete pantry shelving', lineItems: [{ ...coBase.lineItems[0], id: 'li-3', name: 'Pantry shelving credit', unitPrice: -400, total: -400 }], changeAmount: -400, newContractTotal: 83600, scheduleImpactDays: 0, status: 'approved' },
  { ...coBase, id: EXTRA_CO_REJECTED, number: 4, description: 'Heated floor in hall bath', changeAmount: 2600, newContractTotal: 86600, status: 'rejected' },
];
const extraInvoices = [
  { ...invoices[0], id: EXTRA_INV_SENT, number: 2, issueDate: '2026-08-12T12:00:00.000Z', dueDate: '2026-09-11T12:00:00.000Z', amountPaid: 0, payments: [], status: 'sent', updatedAt: '2026-08-12T12:00:00.000Z' },
];
async function phoneRouteExtra(url: string) {
  env('ios', 390, 844);
  await primeWorld('populated');
  await AsyncStorage.multiSet([
    ['mageid_submittals', JSON.stringify(submittals)],
    ['mageid_change_orders', JSON.stringify([...changeOrders, ...extraChangeOrders])],
    ['mageid_invoices', JSON.stringify([...invoices, ...extraInvoices])],
  ]);
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}
describe('lane G — the phone is unchanged, bar branches (golden, 390 × 844 iOS)', () => {
  jest.setTimeout(120000);
  const ROUTES: [string, string][] = [
    ['change-order (approved, billable: the bill bar)', `/change-order?${P}&coId=${EXTRA_CO_BILLABLE}`],
    ['change-order (approved credit: the bill bar says why)', `/change-order?${P}&coId=${EXTRA_CO_CREDIT}`],
    ['change-order (rejected: locked, no bar)', `/change-order?${P}&coId=${EXTRA_CO_REJECTED}`],
    ['invoice (sent: reminder and pay link)', `/invoice?${P}&invoiceId=${EXTRA_INV_SENT}`],
  ];
  it.each(ROUTES)('%s', async (name, url) => {
    const tree = await phoneRouteExtra(url);
    expect(fingerprint(name, tree.toJSON())).toMatchSnapshot();
  });
});

// ── 3. Native tablet: desktop styles may apply, the desktop-WEB log may not ──
describe('lane G — android 1100 (isDesktop true, desktopWeb false)', () => {
  jest.setTimeout(120000);
  const cases: [string, string, string, string][] = [
    ['rfi', `/rfi?${P}`, 'rfi-log', 'rfi-subject'],
    ['submittal', `/submittal?${P}`, 'submittal-log', 'submittal-title'],
    ['change-order', `/change-order?${P}`, 'co-log', 'co-number-label'],
    ['invoice', `/invoice?${P}`, 'invoice-log', 'save-invoice-to-project'],
  ];
  it.each(cases)('%s with only a projectId opens the EDITOR, never the log', async (_n, url, logId, formId) => {
    env('android', 1100, 800);
    await primeWorld('populated');
    await seedRecords();
    await mountRouteChecked(url);
    await pump();
    expect(screen.queryByTestId(logId)).toBeNull();
    expect(screen.getByTestId(formId)).toBeTruthy();
  });
});

// ── 4. Desktop web: the log for a bare projectId; the form for create links ──
// Behaviour, not pixels (no snapshot): useIsDesktopWeb() is forced on (see the
// mock above).
describe('lane G — desktop web 1512 (logRouteMode)', () => {
  jest.setTimeout(120000);
  async function desk(url: string) {
    env('ios', 1512, 945);
    mockForceDesktopWeb = true;
    await primeWorld('populated');
    await seedRecords();
    await mountRouteChecked(url);
    await pump();
  }
  it('a bare /rfi?projectId opens the RFI log, not the form', async () => {
    await desk(`/rfi?${P}`);
    expect(screen.getByTestId('rfi-log')).toBeTruthy();
    expect(screen.queryByTestId('rfi-subject')).toBeNull();
  });
  it('/rfi?projectId&new=1 opens the create form', async () => {
    await desk(`/rfi?${P}&new=1`);
    expect(screen.queryByTestId('rfi-log')).toBeNull();
    expect(screen.getByTestId('rfi-subject')).toBeTruthy();
  });
  it('/rfi?projectId&rfiId opens the record BESIDE the log, with its facts strip', async () => {
    await desk(`/rfi?${P}&rfiId=rfi-2`);
    expect(screen.getByTestId('rfi-log')).toBeTruthy();
    expect(screen.getByTestId('rfi-log-strip')).toBeTruthy();
    expect(screen.getByTestId('rfi-subject')).toBeTruthy();
  });
  it('submittal: a bare projectId opens the log', async () => {
    await desk(`/submittal?${P}`);
    expect(screen.getByTestId('submittal-log')).toBeTruthy();
    expect(screen.queryByTestId('submittal-title')).toBeNull();
  });
  it('submittal: a record opens beside the log', async () => {
    await desk(`/submittal?${P}&submittalId=${SUBMITTAL_ID}`);
    expect(screen.getByTestId('submittal-log')).toBeTruthy();
    expect(screen.getByTestId('submittal-log-strip')).toBeTruthy();
    expect(screen.getByTestId('submittal-title')).toBeTruthy();
  });
  it('change-order: a bare projectId opens the log', async () => {
    await desk(`/change-order?${P}`);
    expect(screen.getByTestId('co-log')).toBeTruthy();
    expect(screen.queryByTestId('co-number-label')).toBeNull();
  });
  it('change-order: a record opens beside the log', async () => {
    await desk(`/change-order?${P}&coId=${CO_ID}`);
    expect(screen.getByTestId('co-log')).toBeTruthy();
    expect(screen.getByTestId('co-log-strip')).toBeTruthy();
    expect(screen.getByTestId('co-number-label')).toBeTruthy();
    // Fix round 1: the ToolHeader's chevron is the REAL router's back (it
    // would leave the whole log); in the record pane it is not rendered — the
    // log's title row names the job and the pane closes the record.
    expect(screen.queryByTestId('tool-header-back')).toBeNull();
  });
  it('change-order: new=1 is the form', async () => {
    await desk(`/change-order?${P}&new=1`);
    expect(screen.queryByTestId('co-log')).toBeNull();
    expect(screen.getByTestId('co-number-label')).toBeTruthy();
    // No log around it: the editor keeps its own header and Back.
    expect(screen.getByTestId('tool-header-back')).toBeTruthy();
  });
  it('rfi: with unsaved edits, opening another row asks "Discard changes?" first', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const alertMod = require('@/utils/alert') as typeof import('@/utils/alert');
    const spy = jest.spyOn(alertMod, 'showAlert').mockImplementation(() => undefined);
    try {
      await desk(`/rfi?${P}&rfiId=rfi-1`);
      expect(screen.getByTestId('rfi-subject').props.value).toBe('Header size at island opening');
      await act(async () => { fireEvent.changeText(screen.getByTestId('rfi-subject'), 'Header size at island opening (rev)'); });
      await pump(2);
      await act(async () => { fireEvent.press(screen.getByTestId('rfi-log-table-row-rfi-2')); });
      await pump(2);
      const discard = spy.mock.calls.filter((c) => c[0] === 'Discard changes?');
      expect(discard).toHaveLength(1);
      // Nothing moved yet: the edited record is still the one open.
      expect(screen.getByTestId('rfi-subject').props.value).toBe('Header size at island opening (rev)');
      // "Discard" is the destructive choice, and it is what opens the row.
      const buttons = discard[0][2] as { text: string; style?: string; onPress?: () => void }[];
      expect(buttons.map((b) => b.text)).toEqual(['Keep editing', 'Discard']);
      await act(async () => { buttons[1].onPress?.(); });
      await pump();
      expect(screen.getByTestId('rfi-subject').props.value).toBe('Shower niche waterproofing detail');
    } finally {
      spy.mockRestore();
    }
  });
  it('rfi: with no edits, opening another row does not ask', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const alertMod = require('@/utils/alert') as typeof import('@/utils/alert');
    const spy = jest.spyOn(alertMod, 'showAlert').mockImplementation(() => undefined);
    try {
      await desk(`/rfi?${P}&rfiId=rfi-1`);
      await act(async () => { fireEvent.press(screen.getByTestId('rfi-log-table-row-rfi-2')); });
      await pump();
      expect(spy.mock.calls.filter((c) => c[0] === 'Discard changes?')).toHaveLength(0);
      expect(screen.getByTestId('rfi-subject').props.value).toBe('Shower niche waterproofing detail');
    } finally {
      spy.mockRestore();
    }
  });
  it('invoice: a bare projectId opens the log', async () => {
    await desk(`/invoice?${P}`);
    expect(screen.getByTestId('invoice-log')).toBeTruthy();
  });
  it('invoice: a record opens beside the log', async () => {
    await desk(`/invoice?${P}&invoiceId=${INVOICE_ID}`);
    expect(screen.getByTestId('invoice-log')).toBeTruthy();
    expect(screen.getByTestId('invoice-log-strip')).toBeTruthy();
    // The editor itself (a partly-paid invoice: no draft bar, but its sheets).
    expect(screen.getByTestId('record-payment-submit')).toBeTruthy();
  });
  it("invoice: the tutorial's type=progress stays the form", async () => {
    await desk(`/invoice?${P}&type=progress`);
    expect(screen.queryByTestId('invoice-log')).toBeNull();
    expect(screen.getByTestId('save-invoice-to-project')).toBeTruthy();
  });
});
