/**
 * Real-DOM proof for the wave-6c lane-G logs (jsdom + react-dom +
 * react-native-web — the stack app.mageid.app runs).
 *
 *   1. SplitView collapseWhenEmpty: with nothing open the list takes the whole
 *      row (width 100%) and there is no divider and no "pick a row" pane;
 *      opening a record brings the divider (print-hidden) and the record pane
 *      back — and the list's DOM node is the SAME node, never remounted, so
 *      his search / sort / scroll survive.
 *   2. useLogAwareRouter: inside a log's record pane, back() closes the record
 *      and a same-route replace opens that record in place; any other replace
 *      is the real router's. Outside a log it IS useRouter()'s object.
 *   3. RecordContextStrip: an unknown fact reads '—', never 0.
 *   4. Wave 6d, lane V3 (runtime fix C6): each log with its collection not yet
 *      loaded says "Loading …" and never its "No … yet" copy; a settled-and-
 *      failed RFI read shows the retry line; the daily-report rows are links.
 *   5. Bulk "Mark sent" / "Close" (founder default 3): the confirm names what
 *      it skips; nothing is written before he confirms; then one updateInvoice
 *      / updateRFI per record with the record screen's own patch.
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js __tests__/web/g-logs.webtest.tsx
 */

import React, { act } from 'react';
import { Dimensions, Text } from 'react-native';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

const mockRouter = { navigate: jest.fn(), push: jest.fn(), replace: jest.fn(), setParams: jest.fn(), back: jest.fn(), canGoBack: () => false };
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  // The logs mount outside a navigator here: no URL params, no stack header.
  return { ...actual, useRouter: () => mockRouter, useLocalSearchParams: () => ({}), Stack: { ...actual.Stack, Screen: () => null } };
});
jest.mock('@/utils/alert', () => ({ showAlert: jest.fn(), showPrompt: jest.fn() }));
// The logs' data: a stand-in ProjectContext and the RFI / submittal settle
// signal. The pure RFI rules (rfiBallAfterSave, rfiRegressionReason) stay the
// real ones — the hook module is loaded with a signed-out AuthContext.
let mockCtx: Record<string, unknown> = {};
jest.mock('@/contexts/ProjectContext', () => ({ useProjects: () => mockCtx }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
let mockSettle = { settled: true, failed: false, hasRecord: false };
jest.mock('@/hooks/useCollectionSettled', () => ({
  ...jest.requireActual('@/hooks/useCollectionSettled'),
  useCollectionSettled: () => mockSettle,
  useRefetchCollectionOnOpen: () => {},
}));

import { ThemeProvider } from '@/contexts/ThemeContext';
import { SplitView } from '@/components/desktop/SplitView';
import { LogRecordContext, useLogAwareRouter, type LogRecordHost } from '@/components/logs/LogRecordHost';
import { RecordContextStrip } from '@/components/logs/RecordContextStrip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RfiLog } from '@/components/logs/RfiLog';
import { SubmittalLog } from '@/components/logs/SubmittalLog';
import { ChangeOrderLog } from '@/components/logs/ChangeOrderLog';
import { InvoiceLog } from '@/components/logs/InvoiceLog';
import { DailyReportLog } from '@/components/logs/DailyReportLog';
import { showAlert } from '@/utils/alert';
import { markSentPatch } from '@/utils/logs/invoiceLogRows';
import { SAMPLE_PROJECT_PREFIX } from '@/utils/projectCap';
import type { DailyFieldReport, Invoice, RFI } from '@/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.spyOn(Dimensions, 'get').mockImplementation(
  () => ({ width: 1512, height: 945, scale: 2, fontScale: 1 }) as ReturnType<typeof Dimensions.get>,
);

const roots: { root: Root; el: HTMLElement }[] = [];
async function mount(node: React.ReactElement): Promise<{ el: HTMLElement; root: Root }> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  await act(async () => { root.render(<ThemeProvider>{node}</ThemeProvider>); });
  return { el, root };
}
afterEach(async () => {
  for (const { root, el } of roots.splice(0)) {
    await act(async () => { root.unmount(); });
    el.remove();
  }
  for (const f of Object.values(mockRouter)) if (typeof f === 'function' && 'mockClear' in f) (f as jest.Mock).mockClear();
});

const byId = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

function split(openId: string | null) {
  return (
    <SplitView
      splitId="g-webtest"
      testID="sv"
      collapseWhenEmpty
      openId={openId}
      onClose={() => {}}
      list={<Text testID="the-list">rows</Text>}
      detail={openId ? <Text testID="the-record">record {openId}</Text> : null}
    />
  );
}

describe('SplitView collapseWhenEmpty (real DOM, 1512)', () => {
  it('nothing open: the list fills the row; no divider, no empty pane', async () => {
    const { el } = await mount(split(null));
    const list = byId(el, 'sv-list');
    expect(list).not.toBeNull();
    expect(list!.style.width).toBe('100%');
    expect(byId(el, 'sv-divider')).toBeNull();
    expect(byId(el, 'sv-detail')).toBeNull();
    expect(el.textContent).not.toMatch(/Pick a row/);
  });

  it('opening a record restores the divider (print-hidden) and the pane — on the SAME list node', async () => {
    const { el, root } = await mount(split(null));
    const before = byId(el, 'the-list');
    await act(async () => { root.render(<ThemeProvider>{split('r1')}</ThemeProvider>); });
    const divider = byId(el, 'sv-divider');
    expect(divider).not.toBeNull();
    expect(divider!.getAttribute('data-print')).toBe('hide');
    expect(byId(el, 'the-record')?.textContent).toBe('record r1');
    expect(byId(el, 'sv-list')!.style.width).not.toBe('100%');
    // Not remounted: the very same DOM node.
    expect(byId(el, 'the-list')).toBe(before);
    // …and closing collapses it again, still the same node.
    await act(async () => { root.render(<ThemeProvider>{split(null)}</ThemeProvider>); });
    expect(byId(el, 'sv-divider')).toBeNull();
    expect(byId(el, 'the-list')).toBe(before);
  });

  it('without collapseWhenEmpty the "pick a row" pane is unchanged (default off)', async () => {
    const { el } = await mount(
      <SplitView splitId="g-webtest-2" testID="sv2" openId={null} onClose={() => {}} list={<Text>rows</Text>} detail={null} />,
    );
    expect(byId(el, 'sv2-divider')).not.toBeNull();
    expect(el.textContent).toMatch(/Pick a row/);
  });
});

describe('useLogAwareRouter (the editor inside a log record pane)', () => {
  let captured: ReturnType<typeof useLogAwareRouter> | null = null;
  function Probe() { captured = useLogAwareRouter(); return null; }

  it('outside a log it IS useRouter()', async () => {
    await mount(<Probe />);
    expect(captured).toBe(mockRouter);
  });

  it('inside a log: back() closes the record, same-route replace opens in place, others are real', async () => {
    const host: LogRecordHost = { kind: 'rfi', close: jest.fn(), replaceRecord: jest.fn(), setDirtyProbe: jest.fn() };
    await mount(<LogRecordContext.Provider value={host}><Probe /></LogRecordContext.Provider>);
    expect(captured).not.toBe(mockRouter);
    captured!.back();
    expect(host.close).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(captured!.canGoBack()).toBe(true);
    captured!.replace({ pathname: '/rfi', params: { projectId: 'p', rfiId: 'r9' } });
    expect(host.replaceRecord).toHaveBeenCalledWith('r9');
    expect(mockRouter.replace).not.toHaveBeenCalled();
    captured!.replace({ pathname: '/project-detail', params: { id: 'p' } });
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    // push is still the real router's.
    captured!.push('/rfi');
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });
});

describe('RecordContextStrip', () => {
  it("an unknown fact reads '—', never 0", async () => {
    const { el } = await mount(
      <RecordContextStrip testID="strip" status={{ label: 'Open', tone: 'warning' }} facts={[{ label: 'Days open', value: null }, { label: 'Due', value: 'Sep 5' }]} />,
    );
    const text = byId(el, 'strip')!.textContent ?? '';
    expect(text).toContain('Days open—');
    expect(text).toContain('DueSep 5');
    expect(text).not.toMatch(/Days open0/);
  });
});

// ── 4 / 5. Wave 6d, lane V3 ─────────────────────────────────────────────────
const P = 'p1';
function ctx(over: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    rfis: [], submittals: [], changeOrders: [], invoices: [], dailyReports: [],
    changeOrdersLoaded: true, invoicesLoaded: true, dailyReportsLoaded: true,
    projectName: 'Henderson Remodel',
    updateRFI: jest.fn(), updateInvoice: jest.fn(),
    ...over,
  };
  const of = (k: string) => (pid: string) => (base[k] as { projectId: string }[]).filter((r) => r.projectId === pid);
  return {
    ...base,
    getProject: (id: string) => (id === P ? { id: P, name: base.projectName } : undefined),
    getRFIsForProject: of('rfis'),
    getSubmittalsForProject: of('submittals'),
    getChangeOrdersForProject: of('changeOrders'),
    getInvoicesForProject: of('invoices'),
    getDailyReportsForProject: of('dailyReports'),
  };
}
let qc: QueryClient;
async function mountLog(node: React.ReactElement) {
  qc = new QueryClient();
  return mount(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
const alertMock = showAlert as jest.Mock;
type Btn = { text: string; style?: string; onPress?: () => void };
const lastAlert = () => alertMock.mock.calls[alertMock.mock.calls.length - 1] as [string, string, Btn[]];

async function click(target: Element): Promise<void> {
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
}
/** Tick every row, then press the bulk bar's `label` button. */
async function bulk(el: HTMLElement, table: string, label: string): Promise<void> {
  const all = byId(el, `${table}-check-all`);
  expect(all).not.toBeNull();
  await click(all!);
  const bar = byId(el, `${table}-bulkbar`);
  expect(bar).not.toBeNull();
  const btn = [...bar!.querySelectorAll('[role="button"]')].find((b) => b.textContent === label);
  expect(btn).toBeTruthy();
  await click(btn!);
}

beforeEach(() => {
  mockSettle = { settled: true, failed: false, hasRecord: false };
  mockCtx = ctx();
  alertMock.mockClear();
});

describe('honest loading — no "No … yet" before the collection has loaded (C6)', () => {
  it('RFIs: not settled → "Loading RFIs…", never "No RFIs on this job yet"; no chip counts', async () => {
    mockSettle = { settled: false, failed: false, hasRecord: false };
    const { el } = await mountLog(<RfiLog projectId={P} />);
    expect(el.textContent).toContain('Loading RFIs…');
    expect(el.textContent).not.toMatch(/No RFIs on this job yet/);
    // The chips carry no count while loading (never a 0 it has not earned).
    expect(byId(el, 'rfi-log-chip-open')?.textContent).toBe('Open');
    expect(byId(el, 'rfi-log-chip-all')?.textContent).toBe('All');
  });

  it("RFIs: settled but failed → \"Couldn't load RFIs. Check your connection.\" with a retry of ['rfis']", async () => {
    mockSettle = { settled: true, failed: true, hasRecord: false };
    const { el } = await mountLog(<RfiLog projectId={P} />);
    expect(el.textContent).toContain("Couldn't load RFIs. Check your connection.");
    expect(el.textContent).not.toMatch(/No RFIs on this job yet/);
    const spy = jest.spyOn(qc, 'invalidateQueries');
    const retry = [...el.querySelectorAll('[role="button"], div')].find((n) => n.textContent === 'Try again');
    expect(retry).toBeTruthy();
    await click(retry!);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['rfis'] });
  });

  it('RFIs: settled and truly empty → the empty copy is back', async () => {
    const { el } = await mountLog(<RfiLog projectId={P} />);
    expect(el.textContent).toContain('No RFIs on this job yet');
    expect(el.textContent).not.toMatch(/Loading/);
  });

  it('submittals: not settled → "Loading submittals…"', async () => {
    mockSettle = { settled: false, failed: false, hasRecord: false };
    const { el } = await mountLog(<SubmittalLog projectId={P} />);
    expect(el.textContent).toContain('Loading submittals…');
    expect(el.textContent).not.toMatch(/No submittals on this job yet/);
  });

  it('change orders: changeOrdersLoaded false → "Loading change orders…"', async () => {
    mockCtx = ctx({ changeOrdersLoaded: false });
    const { el } = await mountLog(<ChangeOrderLog projectId={P} />);
    expect(el.textContent).toContain('Loading change orders…');
    expect(el.textContent).not.toMatch(/No change orders on this job yet/);
  });

  it('invoices: invoicesLoaded false → "Loading invoices…"', async () => {
    mockCtx = ctx({ invoicesLoaded: false });
    const { el } = await mountLog(<InvoiceLog projectId={P} />);
    expect(el.textContent).toContain('Loading invoices…');
    expect(el.textContent).not.toMatch(/No invoices on this job yet/);
  });

  it('daily reports: dailyReportsLoaded false → "Loading daily reports…"', async () => {
    mockCtx = ctx({ dailyReportsLoaded: false });
    const { el } = await mountLog(<DailyReportLog projectId={P} filedBy={() => null} />);
    expect(el.textContent).toContain('Loading daily reports…');
    expect(el.textContent).not.toMatch(/No daily reports on this job yet/);
  });
});

describe('daily-report rows are record links (contract D7)', () => {
  it('a row is an <a href="/daily-report?projectId&reportId"> (Cmd-click / right-click → new tab)', async () => {
    const report = {
      id: 'dr-1', projectId: P, date: '2026-09-15', status: 'sent', manpower: [], workPerformed: '', materialsDelivered: [],
      issuesAndDelays: '', photos: [], weather: { temperature: '', conditions: '', wind: '' },
    } as unknown as DailyFieldReport;
    mockCtx = ctx({ dailyReports: [report] });
    const { el } = await mountLog(<DailyReportLog projectId={P} filedBy={() => null} />);
    const a = el.querySelector('a[href*="/daily-report"]');
    expect(a).not.toBeNull();
    expect(a!.getAttribute('href')).toBe('/daily-report?projectId=p1&reportId=dr-1');
  });
});

describe('bulk Mark sent (invoices)', () => {
  const inv = (id: string, number: number, status: string, extra: Partial<Invoice> = {}) => ({
    id, number, projectId: P, type: 'full', status, issueDate: '2026-09-01', dueDate: '2026-09-16T12:00:00.000Z', paymentTerms: 'net_15',
    notes: '', lineItems: [], subtotal: 1000, taxRate: 0, taxAmount: 0, totalDue: 1000, amountPaid: 0, payments: [],
    createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z', ...extra,
  } as unknown as Invoice);
  const invoices = [inv('i1', 1, 'draft'), inv('i2', 2, 'sent'), inv('i3', 3, 'paid', { amountPaid: 1000 }), inv('i4', 4, 'draft', { paymentTerms: 'net_30' })];

  it('the confirm names the skips; nothing is written until he confirms; then one updateInvoice per draft with markSentPatch', async () => {
    mockCtx = ctx({ invoices });
    const { el } = await mountLog(<InvoiceLog projectId={P} />);
    await bulk(el, 'invoice-log-table', 'Mark sent');
    const [title, message, buttons] = lastAlert();
    expect(title).toBe('Mark 2 invoices sent?');
    expect(message).toContain('This does not email anything.');
    expect(message).toContain('Skipped 2: #2 — already sent; #3 — paid.');
    const update = mockCtx.updateInvoice as jest.Mock;
    expect(update).not.toHaveBeenCalled();
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Mark 2 sent']);
    await act(async () => { buttons[1].onPress?.(); });
    expect(update).toHaveBeenCalledTimes(2);
    const byId2 = new Map(update.mock.calls.map((c) => [c[0] as string, c[1] as Partial<Invoice>]));
    expect([...byId2.keys()].sort()).toEqual(['i1', 'i4']);
    for (const id of ['i1', 'i4']) {
      const patch = byId2.get(id)!;
      expect(patch).toEqual(markSentPatch(invoices.find((i) => i.id === id)!, patch.issueDate!));
    }
  });

  it('on the sample job every draft is skipped: only the skipped line, with an OK', async () => {
    mockCtx = ctx({ invoices, projectName: `${SAMPLE_PROJECT_PREFIX}Kitchen remodel` });
    const { el } = await mountLog(<InvoiceLog projectId={P} />);
    await bulk(el, 'invoice-log-table', 'Mark sent');
    const [title, message, buttons] = lastAlert();
    expect(title).toBe('Nothing to mark sent');
    expect(message).toBe('Skipped 4: #1, #4 — sample job — sends only reach you; #2 — already sent; #3 — paid.');
    expect(buttons.map((b) => b.text)).toEqual(['OK']);
    expect(mockCtx.updateInvoice as jest.Mock).not.toHaveBeenCalled();
  });
});

describe('bulk Close (RFIs)', () => {
  const rfi = (id: string, number: number, status: string, extra: Partial<RFI> = {}) => ({
    id, number, projectId: P, status, subject: `S${number}`, question: 'Q', assignedTo: '', submittedBy: 'GC', dateSubmitted: '2026-09-01',
    dateRequired: '2026-09-30', priority: 'normal', attachments: [], createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z', ...extra,
  } as unknown as RFI);
  const prior = [{ at: '2026-09-02T12:00:00.000Z', fromParty: 'gc', toParty: 'architect' }, { at: '2026-09-05T12:00:00.000Z', fromParty: 'architect', toParty: 'gc', note: 'Response received' }];
  const rfis = [
    rfi('r1', 1, 'open'),
    rfi('r2', 2, 'answered', { ballInCourt: 'gc', response: 'Use LUS210', dateResponded: '2026-09-05T12:00:00.000Z', handoffs: prior as RFI['handoffs'] }),
    rfi('r3', 3, 'closed', { ballInCourt: 'closed' }),
    rfi('r4', 4, 'void'),
  ];

  it('answered RFIs only; the confirm names the skips; the patch is persistForm\'s (closed, ball to "closed", logged)', async () => {
    mockCtx = ctx({ rfis });
    const { el } = await mountLog(<RfiLog projectId={P} />);
    // The log opens on Open (1); All shows every RFI.
    const allChip = [...el.querySelectorAll('[data-testid^="rfi-log-chip"]')].find((n) => /^All/.test(n.textContent ?? ''));
    expect(allChip).toBeTruthy();
    await click(allChip!);
    await bulk(el, 'rfi-log-table', 'Close');
    const [title, message, buttons] = lastAlert();
    expect(title).toBe('Close 1 answered RFI?');
    expect(message).toContain('Each is marked Closed and the ball goes to "closed", logged as "RFI closed by GC".');
    expect(message).toContain('Skipped 3: #1 — not answered yet — close it from its record; #3 — already closed; #4 — void.');
    const update = mockCtx.updateRFI as jest.Mock;
    expect(update).not.toHaveBeenCalled();
    await act(async () => { buttons[1].onPress?.(); });
    expect(update).toHaveBeenCalledTimes(1);
    const [id, patch] = update.mock.calls[0] as [string, Partial<RFI>];
    expect(id).toBe('r2');
    expect(patch).toEqual({
      status: 'closed',
      ballInCourt: 'closed',
      handoffs: [...prior, { at: expect.any(String), fromParty: 'gc', toParty: 'closed', note: 'RFI closed by GC' }],
    });
  });
});
