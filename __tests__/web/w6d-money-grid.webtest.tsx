/**
 * Wave 6d, lane M1 — the AIA G703 grid on the real desktop-web stack (jsdom +
 * react-dom + react-native-web, 1512 wide): the screen app.mageid.app runs.
 *
 *   1. The G703 grid renders its ten columns (A–I and %).
 *   2. Typing 4500 in E moves G, H and I on that line, and the GRAND TOTAL.
 *   3. The grid's GRAND TOTAL is computeAIATotals (G === line 4, I === line 5),
 *      and every G702 KPI cell prints what the G702 card prints, in cents.
 *   4. Review mode (a saved certificate) renders no input anywhere in the grid.
 *   5. % on a deductive (negative-C) line is text, not an input.
 *   6. An invalid draft ("12,5o") blocks Save, naming the line and column —
 *      and nothing is written (addAIAPayApp is never called).
 *   7. Grid | Cards: Cards brings the phone line cards back.
 *
 * The screen runs for real; the contexts, the tier gate and the router are
 * stand-ins (no navigator outside the app stack).
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js __tests__/web/w6d-money-grid.webtest.tsx
 */

import React, { act } from 'react';
import { Dimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

let mockParams: Record<string, string> = {};
const mockRouter = { navigate: jest.fn(), push: jest.fn(), replace: jest.fn(), setParams: jest.fn(), back: jest.fn(), canGoBack: () => false };
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: () => {},
    usePathname: () => '/aia-pay-app',
    Stack: { ...actual.Stack, Screen: () => null },
  };
});
jest.mock('@/utils/alert', () => ({ showAlert: jest.fn(), showPrompt: jest.fn() }));
let mockCtx: Record<string, unknown> = {};
jest.mock('@/contexts/ProjectContext', () => ({ useProjects: () => mockCtx }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/contexts/SubscriptionContext', () => ({ useSubscription: () => ({ tier: 'pro' }) }));
jest.mock('@/hooks/useTierAccess', () => ({ useTierAccess: () => ({ canAccess: () => true }) }));
jest.mock('@/components/SendToClientButton', () => ({ SendToClientButton: () => null }));
jest.mock('@/components/PortalStatusPill', () => ({ PortalStatusPill: () => null }));

import { ThemeProvider } from '@/contexts/ThemeContext';
import AIAPayAppScreen from '@/app/aia-pay-app';
import { showAlert } from '@/utils/alert';
import { applicationFromSavedRecord, computeAIATotals, g703LineFigures } from '@/utils/aiaBilling';
import { formatMoney } from '@/utils/formatters';
import type { SavedAIAPayApp } from '@/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.spyOn(Dimensions, 'get').mockImplementation(
  () => ({ width: 1512, height: 945, scale: 2, fontScale: 1 }) as ReturnType<typeof Dimensions.get>,
);

// ── the world: one job, one progress invoice, one saved (unsent) certificate ─
const PROJECT = { id: 'p1', name: 'Harlow Residence', status: 'in_progress' };
const INVOICE = {
  id: 'inv-1', number: 4, projectId: 'p1', type: 'progress', issueDate: '2026-03-31', dueDate: '2026-04-30',
  lineItems: [], subtotal: 0, taxRate: 0, taxAmount: 0, totalDue: 20_000, amountPaid: 0, status: 'sent', payments: [],
};
const BRANDING = { companyName: 'Smoke GC', contactName: 'Pat', email: 'pat@example.test', phone: '', address: '', licenseNumber: '', tagline: '' };
const line = (id: string, itemNo: string, description: string, c: number, d: number, e: number, f: number) => ({
  id, itemNo, description, scheduledValue: c, fromPreviousApp: d, thisPeriod: e, materialsPresentlyStored: f, retainagePercent: 10,
});
function savedRecord(over: Partial<SavedAIAPayApp> = {}): SavedAIAPayApp {
  return {
    id: 'aia-1', projectId: 'p1', invoiceId: 'inv-1', applicationNumber: 2,
    applicationDate: '2026-03-31', periodTo: '2026-03-31', periodFrom: '2026-03-01',
    ownerName: 'Meredith Harlow', contractorName: 'Smoke GC', projectName: 'Harlow Residence',
    originalContractSum: 100_000, netChangeByCO: -1_500, contractSumToDate: 98_500,
    retainagePercent: 10, lessPreviousCertificates: 12_345.67,
    lines: [
      line('L1', '1', 'Demolition', 10_000, 4_000, 1_000.5, 0),
      line('L2', '2', 'Framing', 40_000, 10_000, 5_000, 2_500.25),
      line('L3', '3', 'Cabinets', 50_000, 0, 51_000, 0), // billed past C
      line('L4', '4', 'CO #2 credit — delete pantry', -1_500, 0, -1_500, 0), // deductive
    ],
    totals: { totalScheduledValue: 0, totalCompletedAndStored: 0, totalRetainage: 0, totalEarnedLessRetainage: 0, currentPaymentDue: 0, balanceToFinish: 0, percentComplete: 0 },
    savedAt: '2026-04-01T12:00:00.000Z',
    ...over,
  } as SavedAIAPayApp;
}
const addAIAPayApp = jest.fn();
function world(rec: SavedAIAPayApp) {
  mockParams = { invoiceId: 'inv-1' };
  mockCtx = {
    invoices: [INVOICE], projects: [PROJECT], settings: { branding: BRANDING },
    getProject: (id: string) => (id === 'p1' ? PROJECT : undefined),
    getChangeOrdersForProject: () => [],
    getAIAPayAppsForProject: () => [rec],
    addAIAPayApp,
  };
}

const roots: { root: Root; el: HTMLElement }[] = [];
async function mount(): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  await act(async () => {
    root.render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 1512, height: 945 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <ThemeProvider><AIAPayAppScreen /></ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
  return el;
}
afterEach(async () => {
  for (const { root, el } of roots.splice(0)) {
    await act(async () => { root.unmount(); });
    el.remove();
  }
  addAIAPayApp.mockClear();
  (showAlert as jest.Mock).mockClear();
  try { window.localStorage.clear(); } catch { /* no storage */ }
});

const byId = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
async function click(target: Element) {
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
}
async function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** The G702 card's value beside `label` (Row: label Text, then value Text). */
function g702Row(el: HTMLElement, label: string): string | null {
  // The deepest node reading exactly the label, then up to the row that also
  // holds the value: the row's text is label + value.
  for (const hit of Array.from(el.querySelectorAll('*')).filter((d) => d.textContent === label && d.children.length === 0)) {
    let row: Element | null = hit;
    while (row && row.textContent === label) row = row.parentElement;
    const rest = (row?.textContent ?? '').startsWith(label) ? (row?.textContent ?? '').slice(label.length) : '';
    if (/^[+-]?\$[\d,]+(\.\d+)?$/.test(rest)) return rest;
  }
  return null;
}
async function openEditable(): Promise<HTMLElement> {
  world(savedRecord());
  const el = await mount();
  // A saved, unsent certificate opens in review; Edit draft is an explicit tap.
  const edit = byId(el, 'aia-edit-draft');
  expect(edit).not.toBeNull();
  await click(edit!);
  return el;
}

describe('the AIA G703 grid (desktop web, 1512)', () => {
  it('renders the ten G703 columns and the G702 strip', async () => {
    const el = await openEditable();
    const grid = byId(el, 'aia-g703');
    expect(grid).not.toBeNull();
    for (const h of ['A Item', 'B Description of work', 'C Scheduled value', 'D From previous', 'E This period', 'F Stored', 'G Completed & stored', '% (G ÷ C)', 'H Balance to finish', 'I Retainage']) {
      expect(grid!.textContent).toContain(h);
    }
    expect(byId(el, 'aia-g702-strip')).not.toBeNull();
    expect(byId(el, 'aia-sov-view')).not.toBeNull();
    // The phone cards are not also drawn.
    expect(byId(el, 'aia-this-period-L1')).toBeNull();
  });

  it('typing 4500 in E moves G, H and I on that line and the GRAND TOTAL', async () => {
    const el = await openEditable();
    const e = byId(el, 'aia-g703-cell-L1-thisPeriod') as HTMLInputElement;
    expect(e).not.toBeNull();
    await type(e, '4500');
    const row = byId(el, 'aia-g703-row-L1')!;
    const want = g703LineFigures({ ...savedRecord().lines[0], thisPeriod: 4500 });
    expect(row.textContent).toContain(fmt(want.completedAndStored)); // G 8,500.00
    expect(row.textContent).toContain(fmt(want.balanceToFinish)); // H 1,500.00
    expect(row.textContent).toContain(fmt(want.retainage)); // I 850.00
    const app = applicationFromSavedRecord(savedRecord());
    app.lines[0] = { ...app.lines[0], thisPeriod: 4500 };
    expect(byId(el, 'aia-g703-totals')!.textContent).toContain(fmt(computeAIATotals(app).totalCompletedAndStored));
  });

  it('the GRAND TOTAL is the G702 math, and every KPI cell prints the G702 card\'s figure in cents', async () => {
    const el = await openEditable();
    const t = computeAIATotals(applicationFromSavedRecord(savedRecord()));
    const foot = byId(el, 'aia-g703-totals')!.textContent ?? '';
    expect(foot).toContain('Grand total');
    expect(foot).toContain(fmt(t.totalCompletedAndStored)); // G === line 4
    expect(foot).toContain(fmt(t.totalRetainage)); // I === line 5
    const pairs: [string, string][] = [
      ['original', 'Original Contract Sum'],
      ['net-co', 'Net Change by COs'],
      ['to-date', 'Contract Sum to Date'],
      ['completed', 'Total Completed & Stored'],
      ['earned', 'Total Earned Less Retainage'],
      ['previous', 'Less Previous Certificates'],
      ['due', 'Current Payment Due'],
    ];
    for (const [key, label] of pairs) {
      const row = g702Row(el, label);
      expect(row).toMatch(/\.\d\d$/); // cents on the card (founder default 2)
      expect(byId(el, `aia-g702-strip-${key}`)!.textContent).toContain(row!);
    }
    expect(g702Row(el, 'Current Payment Due')).toBe(formatMoney(t.currentPaymentDue, 2));
    expect(byId(el, 'aia-g702-strip-completed')!.textContent).toContain(`${t.percentComplete.toFixed(1)}% complete`);
  });

  it('review mode: no input anywhere in the grid, no add row, no delete column', async () => {
    world(savedRecord());
    const el = await mount();
    expect(byId(el, 'aia-review-banner')).not.toBeNull();
    const grid = byId(el, 'aia-g703')!;
    expect(grid.querySelectorAll('input, textarea')).toHaveLength(0);
    expect(byId(el, 'aia-g703-add')).toBeNull();
    expect(grid.querySelector('[data-testid^="aia-g703-delete-"]')).toBeNull();
  });

  it('% on a deductive (negative-C) line is text, not an input', async () => {
    const el = await openEditable();
    expect(byId(el, 'aia-g703-cell-L4-percent')).toBeNull();
    expect(byId(el, 'aia-g703-text-L4-percent')!.textContent).toBe('—');
    expect(byId(el, 'aia-g703-cell-L1-percent')).not.toBeNull(); // a positive line takes a percent
  });

  it('an invalid draft blocks Save, naming the line — and nothing is written', async () => {
    const el = await openEditable();
    await type(byId(el, 'aia-g703-cell-L2-stored') as HTMLInputElement, '12,5o');
    expect(byId(el, 'aia-g703-row-L2')!.textContent).toContain('is not an amount');
    const save = Array.from(el.querySelectorAll('div, button')).find((n) => n.textContent === 'Save to project' && n.children.length === 0);
    expect(save).toBeTruthy();
    await click(save!);
    expect(showAlert).toHaveBeenCalledWith('Line 2 — Stored', '"12,5o" is not an amount — this line still bills $2,500.25');
    expect(addAIAPayApp).not.toHaveBeenCalled();
  });

  it('Cards brings the phone line cards back', async () => {
    const el = await openEditable();
    const cards = Array.from(byId(el, 'aia-sov-view')!.querySelectorAll('*')).find((n) => n.textContent === 'Cards' && n.children.length === 0);
    await click(cards!);
    expect(byId(el, 'aia-g703')).toBeNull();
    expect(byId(el, 'aia-this-period-L1')).not.toBeNull();
  });
});
