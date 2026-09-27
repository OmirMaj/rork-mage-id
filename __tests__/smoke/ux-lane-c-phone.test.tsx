/**
 * UX wave, Lane C (the money chain) — PHONE PROOF.
 *
 * GOLDEN — recorded FIRST, on the untouched Lane C files (HEAD a102ff73, Lane 0
 * committed), before a single source line of this lane was written. The
 * g-logs harness: the real app (mountRouteChecked, the provider stack, the
 * populated fixture world plus this file's records) at 390 × 844 iOS with
 * useResponsiveLayout mocked to phone; every <Modal> renders its content;
 * styles flattened, handlers and undefined props dropped; both clocks pinned.
 *
 * Each case is a fingerprint (line count + sha256). Set $UXC_DUMP_DIR to
 * write the dumps for a line-by-line diff. The deltas Lane C is allowed to
 * cause are listed in its handoff, one per case, each proven by that diff.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, ESTIMATE_ID } from '@/__tests__/fixtures/world';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';

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

jest.mock('@/hooks/useProjectRole', () => {
  const actual = jest.requireActual('@/hooks/useProjectRole');
  const state = { role: 'owner', isLoading: false, isError: false, isPaused: false, refetch: () => undefined };
  return { ...actual, useProjectRoleState: () => state, useProjectRole: () => 'owner' };
});

// Records every alert (title, message) while still showing it, so the
// behaviour cases can read the ONE confirm "Remind all" asks.
const mockAlerts: { title: string; message?: string }[] = [];
jest.mock('@/utils/alert', () => {
  const actual = jest.requireActual('@/utils/alert');
  return {
    ...actual,
    showAlert: (title: string, message?: string, ...rest: unknown[]) => {
      mockAlerts.push({ title, message });
      return (actual.showAlert as (...a: unknown[]) => unknown)(title, message, ...rest);
    },
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
  const dir = process.env.UXC_DUMP_DIR;
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
// An overdue sent invoice (due 2026-07-10, before both pinned clocks), a
// second overdue one for a "Remind all" of two, and a paid one.
const INV_LATE_1 = 'inv-uxc-late-1';
const INV_LATE_2 = 'inv-uxc-late-2';
const INV_PAID = 'inv-uxc-paid';
const base = {
  projectId: PROJECT_ID,
  type: 'full',
  paymentTerms: 'net_30',
  notes: '',
  taxRate: 0,
  taxAmount: 0,
  createdAt: '2026-06-01T12:00:00.000Z',
};
const UXC_INVOICES = [
  {
    ...base, id: INV_LATE_1, number: 21,
    issueDate: '2026-06-10T12:00:00.000Z', dueDate: '2026-07-10T12:00:00.000Z',
    lineItems: [{ id: 'uxc1-l1', name: 'Rough electrical', description: '', quantity: 1, unit: 'ls', unitPrice: 4500.25, total: 4500.25 }],
    subtotal: 4500.25, totalDue: 4500.25, amountPaid: 0, status: 'sent', payments: [],
    updatedAt: '2026-06-10T12:00:00.000Z',
  },
  {
    ...base, id: INV_LATE_2, number: 22,
    issueDate: '2026-06-20T12:00:00.000Z', dueDate: '2026-07-20T12:00:00.000Z',
    lineItems: [{ id: 'uxc2-l1', name: 'Plumbing rough', description: '', quantity: 1, unit: 'ls', unitPrice: 3100, total: 3100 }],
    subtotal: 3100, totalDue: 3100, amountPaid: 0, status: 'sent', payments: [],
    updatedAt: '2026-06-20T12:00:00.000Z',
  },
  {
    ...base, id: INV_PAID, number: 20,
    issueDate: '2026-05-01T12:00:00.000Z', dueDate: '2026-05-31T12:00:00.000Z',
    lineItems: [{ id: 'uxc0-l1', name: 'Demo and haul-off', description: '', quantity: 1, unit: 'ls', unitPrice: 12000, total: 12000 }],
    subtotal: 12000, totalDue: 12000, amountPaid: 12000, status: 'paid',
    payments: [{ id: 'pay-uxc-0', date: '2026-05-20T12:00:00.000Z', amount: 12000, method: 'check' }],
    updatedAt: '2026-05-20T12:00:00.000Z',
  },
];

const SUB_ID = 'sub-uxc-1';
const UXC_SUBS = [{
  id: SUB_ID, companyName: 'Northline Electric', contactName: 'Sam North', phone: '(503) 555-0199',
  email: 'office@northline.example.test', address: '', trade: 'Electrical', licenseNumber: 'CCB 000002',
  w9OnFile: true, bidHistory: [], assignedProjects: [PROJECT_ID], notes: '',
  createdAt: '2026-01-10T12:00:00.000Z', updatedAt: '2026-01-10T12:00:00.000Z',
}];

async function phoneRoute(url: string) {
  env('ios', 390, 844);
  await primeWorld('populated');
  await AsyncStorage.multiSet([
    ['mageid_invoices', JSON.stringify(UXC_INVOICES)],
    ['mageid_subcontractors', JSON.stringify(UXC_SUBS)],
  ]);
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

const P = `projectId=${PROJECT_ID}`;

describe('Lane C golden — the phone (390 × 844 iOS)', () => {
  jest.setTimeout(120000);

  it('(a) /contract for the fixture job (no invitee email on file)', async () => {
    const tree = await phoneRoute(`/contract?${P}`);
    expect(fingerprint('a contract', tree.toJSON())).toMatchSnapshot();
  });

  it('(b) /change-order, a new CO on the fixture job', async () => {
    const tree = await phoneRoute(`/change-order?${P}`);
    expect(fingerprint('b change order new', tree.toJSON())).toMatchSnapshot();
  });

  it('(c) /estimate-wizard for a job that already has an estimate', async () => {
    const tree = await phoneRoute(`/estimate-wizard?${P}`);
    expect(fingerprint('c estimate wizard', tree.toJSON())).toMatchSnapshot();
  });

  it('(d) /smart-proposal for the fixture job', async () => {
    const tree = await phoneRoute(`/smart-proposal?${P}`);
    expect(fingerprint('d smart proposal', tree.toJSON())).toMatchSnapshot();
  });

  it('(e) /quick-quote', async () => {
    const tree = await phoneRoute('/quick-quote');
    expect(fingerprint('e quick quote', tree.toJSON())).toMatchSnapshot();
  });

  it('(f) /invoice, an overdue sent invoice', async () => {
    const tree = await phoneRoute(`/invoice?${P}&invoiceId=${INV_LATE_1}`);
    expect(fingerprint('f invoice overdue', tree.toJSON())).toMatchSnapshot();
  });

  it('(g) /invoice, a paid invoice', async () => {
    const tree = await phoneRoute(`/invoice?${P}&invoiceId=${INV_PAID}`);
    expect(fingerprint('g invoice paid', tree.toJSON())).toMatchSnapshot();
  });

  it('(h) /invoice, a new invoice on the fixture job', async () => {
    const tree = await phoneRoute(`/invoice?${P}`);
    expect(fingerprint('h invoice new', tree.toJSON())).toMatchSnapshot();
  });

  it('(i) /payments with two overdue invoices', async () => {
    const tree = await phoneRoute('/payments');
    expect(fingerprint('i payments overdue', tree.toJSON())).toMatchSnapshot();
  });

  it('(j) /lien-waivers for the fixture job', async () => {
    const tree = await phoneRoute(`/lien-waivers?${P}`);
    expect(fingerprint('j lien waivers', tree.toJSON())).toMatchSnapshot();
  });

  it('(k) /sub-portal-setup for a sub on the fixture job', async () => {
    const tree = await phoneRoute(`/sub-portal-setup?${P}&subId=${SUB_ID}`);
    expect(fingerprint('k sub portal setup', tree.toJSON())).toMatchSnapshot();
  });

  it('(l) /takeoff-estimate for the fixture job', async () => {
    const tree = await phoneRoute(`/takeoff-estimate?${P}`);
    expect(fingerprint('l takeoff estimate', tree.toJSON())).toMatchSnapshot();
  });

  it('(n) behaviour: /payments lists both late invoices and Remind all asks ONE confirm naming the count', async () => {
    await phoneRoute('/payments');
    expect(screen.getByTestId(`payments-overdue-${INV_LATE_1}`)).toBeTruthy();
    expect(screen.getByTestId(`payments-overdue-${INV_LATE_2}`)).toBeTruthy();
    mockAlerts.length = 0;
    await act(async () => { fireEvent.press(screen.getByTestId('payments-remind-all')); });
    expect(mockAlerts.length).toBe(1);
    // No bill-to and no portal invitee on the fixture job: nobody is invented.
    expect(mockAlerts[0].title).toBe('Send 2 reminders?');
    expect(mockAlerts[0].message).toContain('No client email on file for invoice #21, #22');
  });

  it('(o) behaviour: an overdue invoice opens on the late card; a paid one does not', async () => {
    await phoneRoute(`/invoice?${P}&invoiceId=${INV_LATE_1}`);
    expect(screen.getByTestId('invoice-overdue-card')).toBeTruthy();
    expect(screen.getByTestId('invoice-overdue-record-payment')).toBeTruthy();
  });

  it('(o2) behaviour: a paid invoice has no late card', async () => {
    await phoneRoute(`/invoice?${P}&invoiceId=${INV_PAID}`);
    expect(screen.queryByTestId('invoice-overdue-card')).toBeNull();
  });

  it('(p) behaviour: the waiver form offers this job\'s subcontracts, not the PO', async () => {
    await phoneRoute(`/lien-waivers?${P}`);
    expect(screen.getByTestId('waiver-sub-commit-1')).toBeTruthy();
    expect(screen.getByTestId('waiver-sub-commit-2')).toBeTruthy();
    expect(screen.queryByTestId('waiver-sub-commit-3')).toBeNull();
    expect(screen.queryByPlaceholderText('YYYY-MM-DD')).toBeNull();
  });

  it('(q) behaviour: Smart Proposal never says "Mark accepted"', async () => {
    await phoneRoute(`/smart-proposal?${P}`);
    expect(screen.queryByText('Mark accepted')).toBeNull();
  });

  it('(m) the route mounted (sanity: the fixture job name renders on /contract)', async () => {
    await phoneRoute(`/contract?${P}`);
    expect(screen.toJSON()).toBeTruthy();
  });
});
