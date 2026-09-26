/**
 * Wave 6d, lane M2 — the payments desk, the lien-waiver log, invoice lines and
 * honest financing copy. PHONE PROOF.
 *
 * On desktop the payments feed becomes an A/R KPI strip + DataTable, the lien
 * waivers a SplitView log, and invoice lines a read-only DataTable. Every one
 * of those switches sits behind `isDesktop ? <new/> : <today's JSX>` or a
 * primitive whose phone branch is today's tree, so on the iPhone NOTHING may
 * change — except the honest-copy deltas contract D8 names:
 *   (m)  the sent invoice: the Wisetack card is removed, the bring-your-own-
 *        lender line appears, and the factoring card's strings are rewritten;
 *   (pq) prequal-manager: the coi-requote-cta card's strings are rewritten.
 *
 *  1. GOLDEN — recorded FIRST, on a pristine archive of the untouched base
 *     (439e119a), before a single line of this lane was written. The g-logs
 *     harness: the real app mounted by mountRouteChecked at 390 × 844 iOS with
 *     useResponsiveLayout mocked to phone, every <Modal> rendering its content,
 *     each case a fingerprint (line count + sha256) of the whole tree with
 *     every style flattened and handler / undefined props dropped, and both
 *     clocks pinned.
 *
 *  2. NATIVE TABLET (android, 1100): isDesktop is true on native >= 1024, so
 *     the payments and lien DataTables render there (accepted, as in 6c), but
 *     no bulk or keyboard behaviour mounts (useIsDesktopWeb stays false).
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, ESTIMATE_ID, SMOKE_USER } from '@/__tests__/fixtures/world';

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

// Every Modal renders its content, open or closed (the g-logs recipe).
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

// ── Lien waivers: the owner, and a read the test controls ──────────────────
jest.mock('@/hooks/useProjectRole', () => {
  const actual = jest.requireActual('@/hooks/useProjectRole');
  const state = { role: 'owner', isLoading: false, isError: false, isPaused: false, refetch: () => undefined };
  return { ...actual, useProjectRoleState: () => state, useProjectRole: () => 'owner' };
});

type ReadResult = { ok: true; waivers: unknown[] } | { ok: false; error: string };
let mockWaiverRead: ReadResult = { ok: true, waivers: [] };
let mockWaiverCache: { waivers: unknown[]; savedAt: string } | null = null;
jest.mock('@/utils/lienWaiverEngine', () => {
  const actual = jest.requireActual('@/utils/lienWaiverEngine');
  return {
    ...actual,
    loadLienWaiversChecked: async () => mockWaiverRead,
    readLienWaiverCache: async () => mockWaiverCache,
  };
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

// Two clocks, both pinned (the GOLDEN_CLOCK pattern of g-logs / w6c-field).
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
  mockWaiverRead = { ok: true, waivers: [] };
  mockWaiverCache = null;
});
afterEach(() => {
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

// ── The records the populated world leaves empty ────────────────────────────
// Payments feed (f)/(g): a settled Stripe row, a hand-keyed card, a check, a
// pending WITH a pay link (inv-m-2) and a pending WITHOUT one (inv-m-3).
const INV_STRIPE = 'inv-m-1';
const INV_LINKED = 'inv-m-2';
const INV_UNLINKED = 'inv-m-3';
const INV_DRAFT = 'inv-m-4';
const baseInvoice = {
  projectId: PROJECT_ID,
  type: 'full',
  paymentTerms: 'net_30',
  notes: '',
  taxRate: 0,
  taxAmount: 0,
  createdAt: '2026-07-01T12:00:00.000Z',
};
const MONEY_DESK_INVOICES = [
  {
    ...baseInvoice,
    id: INV_STRIPE,
    number: 11,
    issueDate: '2026-07-01T12:00:00.000Z',
    dueDate: '2026-07-31T12:00:00.000Z',
    lineItems: [{ id: 'm1-l1', name: 'Demo and haul-off', description: '', quantity: 1, unit: 'ls', unitPrice: 12000, total: 12000 }],
    subtotal: 12000,
    totalDue: 12000,
    amountPaid: 12000,
    status: 'paid',
    payments: [{ id: 'stripe-cs_test_m1', date: '2026-07-20T12:00:00.000Z', amount: 12000, method: 'stripe' }],
    updatedAt: '2026-07-20T12:00:00.000Z',
  },
  {
    ...baseInvoice,
    id: INV_LINKED,
    number: 12,
    issueDate: '2026-08-01T12:00:00.000Z',
    dueDate: '2026-08-31T12:00:00.000Z',
    lineItems: [{ id: 'm2-l1', name: 'Framing', description: 'Kitchen wall and header', quantity: 1, unit: 'ls', unitPrice: 8000, total: 8000 }],
    subtotal: 8000,
    totalDue: 8000,
    amountPaid: 5000,
    status: 'partially_paid',
    payments: [
      { id: 'pay-card-m2', date: '2026-08-05T12:00:00.000Z', amount: 3000, method: 'credit_card' },
      { id: 'pay-check-m2', date: '2026-08-09T12:00:00.000Z', amount: 2000, method: 'check' },
    ],
    payLinkUrl: 'https://pay.example.test/m2',
    payLinkAmount: 3000,
    updatedAt: '2026-08-09T12:00:00.000Z',
  },
  {
    ...baseInvoice,
    id: INV_UNLINKED,
    number: 13,
    issueDate: '2026-06-10T12:00:00.000Z',
    dueDate: '2026-07-10T12:00:00.000Z',
    lineItems: [{ id: 'm3-l1', name: 'Rough electrical', description: '', quantity: 1, unit: 'ls', unitPrice: 4500.25, total: 4500.25 }],
    subtotal: 4500.25,
    totalDue: 4500.25,
    amountPaid: 0,
    status: 'sent',
    payments: [],
    updatedAt: '2026-06-10T12:00:00.000Z',
  },
  {
    ...baseInvoice,
    id: INV_DRAFT,
    number: 14,
    issueDate: '2026-08-12T12:00:00.000Z',
    dueDate: '2026-09-11T12:00:00.000Z',
    lineItems: [
      { id: 'm4-l1', name: 'Cabinet install', description: 'Uppers and lowers', quantity: 18, unit: 'lf', unitPrice: 145.5, total: 2619 },
      { id: 'm4-l2', name: 'Quartz countertop', description: '', quantity: 42, unit: 'sf', unitPrice: 88.25, total: 3706.5 },
      { id: 'm4-l3', name: 'Backsplash tile', description: 'Subway, herringbone', quantity: 36, unit: 'sf', unitPrice: 31.1, total: 1119.6 },
    ],
    subtotal: 7445.1,
    totalDue: 7445.1,
    amountPaid: 0,
    status: 'draft',
    payments: [],
    updatedAt: '2026-08-12T12:00:00.000Z',
  },
];

// Lien waivers (i): requested, signed by the sub, recorded from paper, received.
const MONEY_DESK_WAIVERS = [
  {
    id: 'lw-m-1', projectId: PROJECT_ID, userId: SMOKE_USER.id, waiverType: 'conditional_partial',
    subName: 'Ridgeline Framing', subEmail: 'office@ridgeline.example.test', throughDate: '2026-08-31', paidAmount: 8250.5,
    status: 'requested', signRequestedAt: '2026-09-01T16:00:00.000Z', notes: '',
    createdAt: '2026-09-01T15:00:00.000Z', updatedAt: '2026-09-01T16:00:00.000Z',
  },
  {
    id: 'lw-m-2', projectId: PROJECT_ID, userId: SMOKE_USER.id, waiverType: 'unconditional_partial',
    subName: 'Volt Electric', throughDate: '2026-07-31', paidAmount: 4100,
    status: 'signed', subSignature: { name: 'Dana Volt', role: 'sub', signedAt: '2026-08-06T18:00:00.000Z', method: 'portal' },
    signedAt: '2026-08-06T18:00:00.000Z', notes: '',
    createdAt: '2026-08-01T15:00:00.000Z', updatedAt: '2026-08-06T18:00:00.000Z',
  },
  {
    id: 'lw-m-3', projectId: PROJECT_ID, userId: SMOKE_USER.id, waiverType: 'conditional_final',
    subName: 'Northside Plumbing', throughDate: '2026-06-30', paidAmount: 2675.25,
    status: 'signed', subSignature: { name: 'R. Okafor', role: 'gc', signedAt: '2026-07-08T18:00:00.000Z', method: 'paper' },
    signedAt: '2026-07-08T18:00:00.000Z', notes: 'Paper original in the job binder',
    createdAt: '2026-07-02T15:00:00.000Z', updatedAt: '2026-07-08T18:00:00.000Z',
  },
  {
    id: 'lw-m-4', projectId: PROJECT_ID, userId: SMOKE_USER.id, waiverType: 'unconditional_final',
    subName: 'Summit Drywall', throughDate: '2026-05-31', paidAmount: 6900,
    status: 'received', subSignature: { name: 'Summit Drywall LLC', role: 'sub', signedAt: '2026-06-04T18:00:00.000Z', method: 'portal' },
    signedAt: '2026-06-04T18:00:00.000Z', notes: '',
    createdAt: '2026-06-01T15:00:00.000Z', updatedAt: '2026-06-05T18:00:00.000Z',
  },
];

// Prequal (pq): one sub whose packet renews ~10 days after the pinned clock.
const PQ_SUB_ID = 'sub-pq-m-1';
const prequalSubs = [{
  id: PQ_SUB_ID, companyName: 'Ridgeline Framing', contactName: 'Jo Ridge', phone: '(503) 555-0101',
  email: 'office@ridgeline.example.test', address: '', trade: 'Framing', licenseNumber: 'CCB 000001',
  w9OnFile: true, bidHistory: [], assignedProjects: [PROJECT_ID], notes: '',
  createdAt: '2026-01-10T12:00:00.000Z', updatedAt: '2026-01-10T12:00:00.000Z',
}];
const prequalPackets = [{
  id: 'pq-m-1', subcontractorId: PQ_SUB_ID, status: 'approved',
  criteria: {}, financials: {}, safety: {}, insurance: {}, licenses: [], w9OnFile: true,
  submittedAt: '2025-10-01T12:00:00.000Z', reviewedAt: '2025-10-05T12:00:00.000Z',
  expiresAt: '2026-10-05',
  createdAt: '2025-09-20T12:00:00.000Z', updatedAt: '2025-10-05T12:00:00.000Z',
}];

async function seedMoney() {
  await AsyncStorage.multiSet([
    ['mageid_invoices', JSON.stringify(MONEY_DESK_INVOICES)],
    ['mageid_subcontractors', JSON.stringify(prequalSubs)],
    ['mageid_prequal_packets', JSON.stringify(prequalPackets)],
  ]);
}

async function phoneRoute(url: string, world: 'populated' | 'empty' = 'populated') {
  env('ios', 390, 844);
  await primeWorld(world);
  if (world === 'populated') await seedMoney();
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

const P = `projectId=${PROJECT_ID}`;

// ── 1. GOLDEN, phone ───────────────────────────────────────────────────────
describe('lane M2 golden — the phone (390 × 844 iOS)', () => {
  jest.setTimeout(120000);

  it('(f) /payments, populated', async () => {
    const tree = await phoneRoute('/payments');
    expect(screen.getByTestId('payment-row-pending-inv-m-3')).toBeTruthy();
    expect(fingerprint('f payments populated', tree.toJSON())).toMatchSnapshot();
  });

  it('(g) /payments, Pending then Completed', async () => {
    const tree = await phoneRoute('/payments');
    await act(async () => { fireEvent.press(screen.getByTestId('payments-tab-pending')); });
    await pump(2);
    expect(fingerprint('g payments pending', tree.toJSON())).toMatchSnapshot();
    await act(async () => { fireEvent.press(screen.getByTestId('payments-tab-completed')); });
    await pump(2);
    expect(fingerprint('g payments completed', tree.toJSON())).toMatchSnapshot();
  });

  it('(h) /payments, empty', async () => {
    const tree = await phoneRoute('/payments', 'empty');
    expect(fingerprint('h payments empty', tree.toJSON())).toMatchSnapshot();
  });

  it('(i) /lien-waivers, four waivers', async () => {
    mockWaiverRead = { ok: true, waivers: MONEY_DESK_WAIVERS };
    const tree = await phoneRoute(`/lien-waivers?${P}`);
    expect(screen.getAllByText('Summit Drywall').length).toBeGreaterThan(0);
    expect(fingerprint('i lien populated', tree.toJSON())).toMatchSnapshot();
  });

  it('(j) /lien-waivers, a failed read with a cache (the stale banner)', async () => {
    mockWaiverRead = { ok: false, error: 'Network request failed' };
    mockWaiverCache = { waivers: MONEY_DESK_WAIVERS.slice(0, 2), savedAt: '2026-08-14T19:30:00.000Z' };
    const tree = await phoneRoute(`/lien-waivers?${P}`);
    expect(screen.getByTestId('lien-waivers-stale')).toBeTruthy();
    expect(fingerprint('j lien stale', tree.toJSON())).toMatchSnapshot();
  });

  it('(k) /lien-waivers, a failed read without a cache', async () => {
    mockWaiverRead = { ok: false, error: 'Network request failed' };
    const tree = await phoneRoute(`/lien-waivers?${P}`);
    expect(screen.getByTestId('lien-waivers-load-failed')).toBeTruthy();
    expect(fingerprint('k lien failed', tree.toJSON())).toMatchSnapshot();
  });

  it('(l) /invoice, a draft with 3 lines', async () => {
    const tree = await phoneRoute(`/invoice?${P}&invoiceId=${INV_DRAFT}`);
    expect(screen.getAllByText('Quartz countertop').length).toBeGreaterThan(0);
    expect(fingerprint('l invoice draft', tree.toJSON())).toMatchSnapshot();
  });

  it('(m) /invoice, sent with a pay link and a balance (the ONE intended delta)', async () => {
    const tree = await phoneRoute(`/invoice?${P}&invoiceId=${INV_LINKED}`);
    expect(screen.getByTestId('invoice-factoring-cta')).toBeTruthy();
    expect(fingerprint('m invoice sent', tree.toJSON())).toMatchSnapshot();
  });

  it('(pq) /prequal-manager, a packet renewing within 30 days (the coi-requote card; intended copy delta)', async () => {
    const tree = await phoneRoute('/prequal-manager');
    expect(screen.getByTestId('coi-requote-cta')).toBeTruthy();
    expect(fingerprint('pq prequal renewing', tree.toJSON())).toMatchSnapshot();
  });
});

// ── 2. Native tablet: the desktop tables render, no web behaviour mounts ───
describe('lane M2 — android 1100 (isDesktop true, desktopWeb false)', () => {
  jest.setTimeout(120000);
  async function tablet(url: string) {
    env('android', 1100, 800);
    await primeWorld('populated');
    await seedMoney();
    await mountRouteChecked(url);
    await pump();
  }
  it('/payments renders the KPI strip and the table; no row is selectable', async () => {
    await tablet('/payments');
    expect(screen.getByTestId('payments-kpis')).toBeTruthy();
    expect(screen.getByTestId('payments-table')).toBeTruthy();
    expect(screen.queryByTestId('payments-table-check-all')).toBeNull();
  });
  it('/lien-waivers renders the log', async () => {
    mockWaiverRead = { ok: true, waivers: MONEY_DESK_WAIVERS };
    await tablet(`/lien-waivers?${P}`);
    expect(screen.getByTestId('lien-waivers-table')).toBeTruthy();
    expect(screen.queryByTestId('lien-waivers-table-check-all')).toBeNull();
  });
});
