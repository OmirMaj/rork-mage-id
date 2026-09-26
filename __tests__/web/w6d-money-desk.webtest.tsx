/**
 * Real-DOM proof for wave 6d, lane M2 (jsdom + react-dom + react-native-web —
 * the stack app.mageid.app runs), at 1512 × 945.
 *
 *   1. Payments desk: the KPI strip's Pending is EXACTLY the sum of its five
 *      aging cells, to the cent; the Completed tab's footer Amount is the KPI
 *      Received; a hand-keyed card's Net is '—' and its Fee 'Unknown'; there
 *      is no search box (the footers are tab totals).
 *   2. Lien waivers: clicking a row opens the waiver's card BESIDE the list
 *      (the same WaiverCard the phone shows), the URL carries ?waiverId, and
 *      Esc closes it.
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js __tests__/web/w6d-money-desk.webtest.tsx
 */

import React, { act } from 'react';
import { Dimensions } from 'react-native';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

// ── The URL: a tiny store, so setParams re-renders like the real router ─────
let mockParams: Record<string, string | undefined> = {};
const mockListeners = new Set<() => void>();
function mockSetParams(next: Record<string, string | undefined>) {
  mockParams = { ...mockParams, ...next };
  for (const l of mockListeners) l();
}
// The router lives INSIDE the factory: route modules import `router` while
// this file's own consts are still uninitialised (jest hoists the mocks).
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  const R = jest.requireActual('react');
  const subscribe = (l: () => void) => { mockListeners.add(l); return () => { mockListeners.delete(l); }; };
  const router = {
    navigate: jest.fn(), push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => false,
    setParams: jest.fn((p: Record<string, string | undefined>) => mockSetParams(p)),
  };
  return {
    ...actual,
    router,
    useRouter: () => router,
    useLocalSearchParams: () => R.useSyncExternalStore(subscribe, () => mockParams),
    useFocusEffect: () => {},
    Stack: { ...actual.Stack, Screen: () => null },
  };
});
const mockLinkTo = jest.fn();
jest.mock('expo-router/build/global-state/routing', () => {
  const actual = jest.requireActual('expo-router/build/global-state/routing');
  return { ...actual, linkTo: (...a: unknown[]) => mockLinkTo(...a) };
});
jest.mock('@/utils/alert', () => ({ showAlert: jest.fn(), showPrompt: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
let mockCtx: Record<string, unknown> = {};
jest.mock('@/contexts/ProjectContext', () => ({ useProjects: () => mockCtx }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/hooks/useTierAccess', () => ({ useTierAccess: () => ({ tier: 'enterprise', canAccess: () => true }) }));
jest.mock('@/hooks/useSafeBack', () => ({ useSafeBack: () => () => {} }));
jest.mock('@/hooks/useProjectRole', () => ({
  useProjectRoleState: () => ({ role: 'owner', isLoading: false, isError: false, isPaused: false, refetch: () => {} }),
  useProjectRole: () => 'owner',
}));
let mockWaivers: unknown[] = [];
jest.mock('@/utils/lienWaiverEngine', () => ({
  ...jest.requireActual('@/utils/lienWaiverEngine'),
  loadLienWaiversChecked: async () => ({ ok: true, waivers: mockWaivers }),
  readLienWaiverCache: async () => null,
}));

import { ThemeProvider } from '@/contexts/ThemeContext';
import PaymentsScreen from '@/app/payments';
import LienWaiversScreen from '@/app/lien-waivers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockRouter = (jest.requireMock('expo-router') as { router: { setParams: jest.Mock } }).router;

jest.spyOn(Dimensions, 'get').mockImplementation(
  () => ({ width: 1512, height: 945, scale: 2, fontScale: 1 }) as ReturnType<typeof Dimensions.get>,
);
// The aging clock: 2026-08-15 (inv-m-3 is 36 days past due, inv-m-2 current).
jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-15T15:00:00.000Z').getTime());

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const project = { id: PROJECT_ID, name: 'Harlow Residence', location: '4218 SE Rex St, Portland, OR 97206', status: 'in_progress' };
const base = { projectId: PROJECT_ID, type: 'full', paymentTerms: 'net_30', notes: '', taxRate: 0, taxAmount: 0, createdAt: '2026-07-01T12:00:00.000Z', updatedAt: '2026-08-01T12:00:00.000Z' };
const invoices = [
  { ...base, id: 'inv-m-1', number: 11, issueDate: '2026-07-01T12:00:00.000Z', dueDate: '2026-07-31T12:00:00.000Z', lineItems: [], subtotal: 12000, totalDue: 12000, amountPaid: 12000, status: 'paid',
    payments: [{ id: 'stripe-cs_test_m1', date: '2026-07-20T12:00:00.000Z', amount: 12000, method: 'stripe' }] },
  { ...base, id: 'inv-m-2', number: 12, issueDate: '2026-08-01T12:00:00.000Z', dueDate: '2026-08-31T12:00:00.000Z', lineItems: [], subtotal: 8000, totalDue: 8000, amountPaid: 5000, status: 'partially_paid',
    payments: [
      { id: 'pay-card-m2', date: '2026-08-05T12:00:00.000Z', amount: 3000, method: 'credit_card' },
      { id: 'pay-check-m2', date: '2026-08-09T12:00:00.000Z', amount: 2000, method: 'check' },
    ],
    payLinkUrl: 'https://pay.example.test/m2', payLinkAmount: 3000 },
  { ...base, id: 'inv-m-3', number: 13, issueDate: '2026-06-10T12:00:00.000Z', dueDate: '2026-07-10T12:00:00.000Z', lineItems: [], subtotal: 4500.25, totalDue: 4500.25, amountPaid: 0, status: 'sent', payments: [] },
  { ...base, id: 'inv-m-5', number: 15, issueDate: '2026-08-10T12:00:00.000Z', dueDate: '2026-09-09T12:00:00.000Z', lineItems: [], subtotal: 0.3, totalDue: 0.3, amountPaid: 0, status: 'sent', payments: [] },
];
const waivers = [
  { id: 'lw-m-1', projectId: PROJECT_ID, userId: 'u', waiverType: 'conditional_partial', subName: 'Ridgeline Framing', throughDate: '2026-08-31', paidAmount: 8250.5, status: 'requested', notes: '', createdAt: '2026-09-01T15:00:00.000Z', updatedAt: '2026-09-01T15:00:00.000Z' },
  { id: 'lw-m-2', projectId: PROJECT_ID, userId: 'u', waiverType: 'unconditional_partial', subName: 'Volt Electric', throughDate: '2026-07-31', paidAmount: 4100, status: 'signed',
    subSignature: { name: 'Dana Volt', role: 'sub', signedAt: '2026-08-06T18:00:00.000Z' }, notes: '', createdAt: '2026-08-01T15:00:00.000Z', updatedAt: '2026-08-06T18:00:00.000Z' },
];

const roots: { root: Root; el: HTMLElement }[] = [];
async function mount(node: React.ReactElement): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  await act(async () => { root.render(<ThemeProvider>{node}</ThemeProvider>); });
  await flush();
  return el;
}
async function flush(n = 5) {
  for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
afterEach(async () => {
  for (const { root, el } of roots.splice(0)) {
    await act(async () => { root.unmount(); });
    el.remove();
  }
  mockParams = {};
  mockLinkTo.mockClear();
  mockRouter.setParams.mockClear();
});

const byId = (el: ParentNode, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
async function click(target: Element, init: MouseEventInit = {}): Promise<MouseEvent> {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  await act(async () => { target.dispatchEvent(ev); });
  await flush(2);
  return ev;
}
async function keydown(target: EventTarget, init: KeyboardEventInit): Promise<void> {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); });
  await flush(2);
}
/** The first "$1,234.56" in a node's text, in cents. */
function moneyCents(node: HTMLElement | null): number {
  const m = /-?\$[\d,]+\.\d{2}/.exec(node?.textContent ?? '');
  if (!m) throw new Error(`no money in: ${node?.textContent}`);
  return Math.round(Number(m[0].replace(/[$,]/g, '')) * 100);
}

describe('Payments desk (real DOM, 1512)', () => {
  beforeEach(() => { mockCtx = { projects: [project], invoices, contacts: [] }; });

  it('KPI Pending === Σ(Current, 1–30, 31–60, 61–90, 90+), to the cent', async () => {
    const el = await mount(<PaymentsScreen />);
    expect(byId(el, 'payments-kpis')).not.toBeNull();
    const pending = moneyCents(byId(el, 'payments-kpis-pending'));
    const cells = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90p'].map((k) => moneyCents(byId(el, `payments-kpis-${k}`)));
    expect(cells.reduce((s, c) => s + c, 0)).toBe(pending);
    // 3,000.00 (current, linked) + 0.30 (≤ $0.50: the report skips it → current) + 4,500.25 (36 days late).
    expect(pending).toBe(750055);
    expect(cells).toEqual([300030, 0, 450025, 0, 0]);
    expect(byId(el, 'payments-kpis-pending')!.textContent).not.toMatch(/differ/);
    // No search box: the footers are the tab's totals.
    expect(byId(el, 'payments-table-search')).toBeNull();
  });

  it('the Completed footer Amount === the KPI Received; a hand-keyed card\'s Net is — and its Fee Unknown', async () => {
    const el = await mount(<PaymentsScreen />);
    const received = moneyCents(byId(el, 'payments-kpis-received'));
    expect(received).toBe(1700000);
    await click(byId(el, 'payments-tab-completed')!);
    const table = byId(el, 'payments-table')!;
    const footer = table.lastElementChild as HTMLElement;
    expect(moneyCents(footer)).toBe(received);
    const card = byId(el, 'payments-table-row-pay-card-m2')!;
    expect(card.textContent).toMatch(/Unknown/);
    expect(card.textContent).toMatch(/—/);
    expect(card.textContent).toMatch(/#12/);
    // The All tab has no Amount sum: it names both totals instead.
    await click(byId(el, 'payments-tab-all')!);
    const allFooter = (byId(el, 'payments-table')!.lastElementChild as HTMLElement).textContent ?? '';
    expect(allFooter).toMatch(/Received \$17,000\.00 · Pending \$7,500\.55/);
  });

  it('a row is a link to its invoice (Cmd-click → new tab)', async () => {
    const el = await mount(<PaymentsScreen />);
    const row = byId(el, 'payments-table-row-pending-inv-m-3')!;
    const a = row.tagName === 'A' ? row : row.querySelector('a') ?? row.closest('a');
    expect(a?.getAttribute('href')).toMatch(/\/invoice\?projectId=22222222-2222-4222-8222-222222222222&invoiceId=inv-m-3/);
  });
});

describe('Lien waivers log (real DOM, 1512)', () => {
  beforeEach(() => {
    mockWaivers = waivers;
    mockParams = { projectId: PROJECT_ID };
    mockCtx = {
      getProject: (id: string) => (id === PROJECT_ID ? project : undefined),
      settings: {},
      getInvoicesForProject: () => [],
      getCommitmentsForProject: () => [],
      subcontractors: [],
    };
  });

  it('a row opens its WaiverCard beside the list; Esc closes it', async () => {
    const el = await mount(<LienWaiversScreen />);
    expect(byId(el, 'lien-waivers-table')).not.toBeNull();
    expect(byId(el, 'lien-waivers-split-detail')).toBeNull();
    const row = byId(el, 'lien-waivers-table-row-lw-m-2')!;
    const a = (row.tagName === 'A' ? row : row.querySelector('a') ?? row.closest('a'))!;
    expect(a.getAttribute('href')).toMatch(/\/lien-waivers\?projectId=22222222-2222-4222-8222-222222222222&waiverId=lw-m-2/);
    const ev = await click(a);
    expect(ev.defaultPrevented).toBe(true); // opened in place, no page load
    expect(mockRouter.setParams).toHaveBeenCalledWith({ waiverId: 'lw-m-2' });
    const detail = byId(el, 'lien-waivers-split-detail');
    expect(detail).not.toBeNull();
    expect(detail!.textContent).toMatch(/Volt Electric/);
    expect(detail!.textContent).toMatch(/Mark received/);
    // Beside the list, not instead of it.
    expect(byId(el, 'lien-waivers-split-divider')).not.toBeNull();
    expect(byId(el, 'lien-waivers-table')).not.toBeNull();

    await keydown(document.body, { key: 'Escape' });
    expect(mockParams.waiverId).toBeUndefined();
    expect(byId(el, 'lien-waivers-split-detail')).toBeNull();
  });

  it('a stale ?waiverId (a deleted waiver) closes itself once the list has loaded', async () => {
    mockParams = { projectId: PROJECT_ID, waiverId: 'lw-gone' };
    await mount(<LienWaiversScreen />);
    expect(mockRouter.setParams).toHaveBeenCalledWith({ waiverId: undefined });
  });
});
