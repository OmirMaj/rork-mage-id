/**
 * Smoke: the money moments (wave-next W2, lane MOMMONEY).
 *
 * THE PROMISES THIS PROVES
 *   - Approving a change order (the approve sheet, and the reflow preview's
 *     slide) answers all four ways: synced -> "CO #4 approved · contract
 *     $52,400.00" and the sheet closes after the hold; queued -> "Approved on
 *     this phone · sends when online"; failed -> the reason line and the sheet
 *     stays; no answer in 20 s -> "No answer yet. Check CO #4 before trying
 *     again." No confetti, no Alert. The reflow slide passes the anchor it
 *     previewed and names the new finish.
 *   - Recording a payment on the REAL invoice screen (providers, the offline
 *     queue, recordInvoicePayment; only the Supabase answers are shaped here):
 *     confirmed shows the server's balance with no Alert; a refusal is the
 *     reason line; a dropped connection queues honestly; a timeout says
 *     "No answer yet. Check invoice #1042 before trying again.", locks the
 *     fields, and the retry sends the SAME payment id (the server
 *     de-duplicates by id, so the check is counted once). A second Confirm
 *     while the append is on the wire records nothing more.
 *   - Certifying an AIA pay app on the REAL screen (only
 *     saveAIAPayAppOnline, the Stripe status read and the PDF maker are
 *     shaped): synced names "Pay app #n certified · $x" and opens the PDF only
 *     after the hold (onDone); refused and "no answer" never turn green and
 *     never open the PDF; offline, the slide is disabled with "You're offline.
 *     Certifying needs a connection." and nothing is written; a retry after
 *     "no answer" certifies the SAME record id; nothing in the write touches
 *     the queue-backed aia_pay_apps store (addAIAPayApp).
 *
 * The screen-reader path drives every slide (Confirm in place of the drag):
 * the legacy PanGestureHandler needs a native module jest does not have, so
 * it is a pass-through here only.
 */
import React from 'react';
import { AccessibilityInfo, Alert } from 'react-native';
import { act, configure, fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { retryUnsavedWrite } from '@/utils/syncLedger';
import { supabase } from '@/lib/supabase';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { SMOKE_USER, PROJECT_ID } from '@/__tests__/fixtures/world';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ChangeOrder, ProjectSchedule } from '@/types';
import { onlineManager } from '@tanstack/react-query';
import { getOfflineQueue } from '@/utils/offlineQueue';
import { COApproveSheet, contractAfterApprovalCents } from '@/components/moments-sites/COApproveSheet';
import { COScheduleReflowPreviewModal } from '@/components/schedule/COScheduleReflowPreviewModal';

configure({ defaultIncludeHiddenElements: true });

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
function Shell({ children }: { children: React.ReactNode }) {
  return <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{children}</ThemeProvider></SafeAreaProvider>;
}

jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler');
  return { ...actual, PanGestureHandler: (props: { children: React.ReactNode }) => props.children };
});

const mockFireConfetti = jest.fn();
jest.mock('@/components/animations/Confetti', () => ({
  __esModule: true,
  fireConfetti: (...a: unknown[]) => mockFireConfetti(...a),
  default: () => null,
  ConfettiHost: () => null,
}));

// The context values are the REAL ones inside the provider tree, with only the
// two writes these sites make shaped: approveChangeOrder (useProjectCrossActions:
// the approve sheet / reflow slide, mounted bare) and saveAIAPayAppOnline
// (useProjects: the certify). Each value is cached per real object so
// consumers see stable references.
const mockApprove = jest.fn();
const mockSaveAia = jest.fn();
jest.mock('@/contexts/ProjectContext', () => {
  const actual = jest.requireActual('@/contexts/ProjectContext');
  const approve = (...a: unknown[]) => mockApprove(...a);
  const saveAia = (...a: unknown[]) => mockSaveAia(...a);
  const bare = { approveChangeOrder: approve };
  const cache = new WeakMap<object, object>();
  const projCache = new WeakMap<object, object>();
  return {
    ...actual,
    useProjects: () => {
      const real: object = actual.useProjects();
      const hit = projCache.get(real);
      if (hit) return hit;
      const v: object = { ...real, saveAIAPayAppOnline: saveAia };
      projCache.set(real, v);
      return v;
    },
    useProjectCrossActions: () => {
      let real: object | null = null;
      try { real = actual.useProjectCrossActions(); } catch { real = null; }
      if (!real) return bare;
      let v = cache.get(real);
      if (!v) { v = { ...real, ...bare }; cache.set(real, v); }
      return v;
    },
  };
});

// The certify's PDF and Stripe status read (nothing leaves the test).
const mockPdf = jest.fn();
jest.mock('@/utils/aiaBilling', () => {
  const actual = jest.requireActual('@/utils/aiaBilling');
  return { ...actual, generateAIAPayAppPDF: (...a: unknown[]) => mockPdf(...a) };
});
jest.mock('@/utils/stripeConnect', () => {
  const actual = jest.requireActual('@/utils/stripeConnect');
  return { ...actual, fetchStripeConnectStatus: () => Promise.resolve({ success: true, chargesEnabled: false }) };
});

jest.useFakeTimers();

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockFireConfetti.mockClear();
  mockApprove.mockReset();
  mockSaveAia.mockReset();
  mockPdf.mockReset();
  mockPdf.mockResolvedValue(undefined);
  (AccessibilityInfo.isScreenReaderEnabled as jest.Mock).mockImplementation(() => Promise.resolve(true));
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { alertSpy.mockRestore(); });

async function advance(ms: number) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
}

/** The slide's screen-reader Confirm: activate the rail, then press Confirm. */
async function srConfirm(u: { getByTestId: (id: string) => unknown }, tid: string) {
  fireEvent(u.getByTestId(`${tid}-track`) as never, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 358, height: 64 } } });
  await advance(20);
  await act(async () => {
    fireEvent(u.getByTestId(`${tid}-rail`) as never, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
  });
  await advance(300);
  fireEvent.press(u.getByTestId(`${tid}-confirm`) as never);
}

const textOf = (u: { getByTestId: (id: string) => { props: { children?: unknown } } }, id: string) => u.getByTestId(id).props.children;

// ─────────────────────────────────────────────────────────────────────────────
// B1 / B2: approve a change order
// ─────────────────────────────────────────────────────────────────────────────

const CO = {
  id: 'co-4', number: 4, projectId: 'p1', status: 'submitted', description: 'Add a pantry',
  changeAmount: 4200, lineItems: [], createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z',
} as unknown as ChangeOrder;

function mountSheet(onClose = jest.fn()) {
  const u = render(
    <Shell>
      <COApproveSheet
        visible
        changeOrder={CO}
        coNumber={4}
        title="Approve CO #4?"
        moneyLine="This commits $4,200.00 to the contract."
        contractAfterCents={5240000}
        onClose={onClose}
      />
    </Shell>,
  );
  return { u, onClose };
}

describe('B1 the approve sheet', () => {
  test('synced: the stored approval, then the sheet closes; no confetti, no Alert', async () => {
    mockApprove.mockResolvedValue('synced');
    const { u, onClose } = mountSheet();
    await advance(10);
    expect(textOf(u, 'co-approve-slide-label')).toBe('Slide to approve · +$4,200.00');
    await srConfirm(u, 'co-approve-slide');
    await advance(2500);
    expect(mockApprove).toHaveBeenCalledWith('co-4');
    expect(textOf(u, 'co-approve-slide-result')).toBe('CO #4 approved · contract $52,400.00');
    await advance(2000);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockFireConfetti).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    u.unmount();
  });

  test('an unread contract: the title names the CO amount, never a guessed contract total', async () => {
    mockApprove.mockResolvedValue('synced');
    const onClose = jest.fn();
    const u = render(
      <Shell>
        <COApproveSheet visible changeOrder={CO} coNumber={4} title="Approve CO #4?" moneyLine="x" contractAfterCents={null} onClose={onClose} />
      </Shell>,
    );
    await advance(10);
    await srConfirm(u, 'co-approve-slide');
    await advance(2500);
    expect(textOf(u, 'co-approve-slide-result')).toBe('CO #4 approved · +$4,200.00');
    u.unmount();
  });

  test('the contract after approval is the SIGNED contract plus approved COs (cents); unread is null', () => {
    const project = { id: 'p1', estimate: { grandTotal: 48000 } } as never;
    const cos = [
      { ...CO, id: 'co-1', status: 'approved', changeAmount: 1000.1 },
      CO,
      { ...CO, id: 'co-9', status: 'submitted', changeAmount: 99999 },
    ] as unknown as ChangeOrder[];
    expect(contractAfterApprovalCents(project, cos, 'co-4', { status: 'signed', contractValue: 50000 })).toBe(5000000 + 100010 + 420000);
    // A sent (unsigned) contract is not the contract sum: the estimate basis stands.
    const onEstimate = contractAfterApprovalCents(project, cos, 'co-4', null);
    expect(contractAfterApprovalCents(project, cos, 'co-4', { status: 'sent', contractValue: 50000 })).toBe(onEstimate);
    expect(contractAfterApprovalCents(project, cos, 'co-4', undefined)).toBeNull();
  });

  test('queued: said as waiting on this phone, never green', async () => {
    mockApprove.mockResolvedValue('queued');
    const { u, onClose } = mountSheet();
    await advance(10);
    await srConfirm(u, 'co-approve-slide');
    await advance(2500);
    expect(textOf(u, 'co-approve-slide-result')).toBe('Approved on this phone · sends when online');
    await advance(2000);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    u.unmount();
  });

  test('failed: the reason line, the sheet stays open', async () => {
    mockApprove.mockResolvedValue('failed');
    const { u, onClose } = mountSheet();
    await advance(10);
    await srConfirm(u, 'co-approve-slide');
    await advance(4000);
    expect(textOf(u, 'co-approve-slide-reason')).toBe('Not approved. Something went wrong on our side.');
    expect(u.queryByTestId('co-approve-slide-result')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    u.unmount();
  });

  test('no answer in 20 s: "Check CO #4", never "nothing was saved"', async () => {
    mockApprove.mockImplementation(() => new Promise(() => {}));
    const { u, onClose } = mountSheet();
    await advance(10);
    await srConfirm(u, 'co-approve-slide');
    await advance(22000);
    expect(textOf(u, 'co-approve-slide-reason')).toBe('No answer yet. Check CO #4 before trying again.');
    expect(JSON.stringify(u.toJSON())).not.toMatch(/nothing was saved/i);
    expect(onClose).not.toHaveBeenCalled();
    u.unmount();
  });
});

const SCHEDULE = {
  id: 's1', name: 'Pantry schedule', projectId: 'p1', startDate: '2026-09-14', workingDaysPerWeek: 7, bufferDays: 0,
  tasks: [
    { id: 'a', title: 'Frame pantry', phase: 'Framing', startDay: 1, durationDays: 5, dependencies: [], progress: 0, crew: '', notes: '', status: 'not_started' },
    { id: 'b', title: 'Drywall', phase: 'Finishes', startDay: 6, durationDays: 4, dependencies: ['a'], progress: 0, crew: '', notes: '', status: 'not_started' },
  ],
  totalDurationDays: 9, criticalPathDays: 9, laborAlignmentScore: 0, riskItems: [],
} as unknown as ProjectSchedule;

describe('B2 the reflow preview slide', () => {
  test('synced: approves with the previewed anchor and names the new finish', async () => {
    mockApprove.mockResolvedValue('synced');
    const onClose = jest.fn();
    const co = { ...CO, scheduleImpactDays: 3, scheduleImpactTaskIds: ['a'] } as ChangeOrder;
    const u = render(
      <Shell>
        <COScheduleReflowPreviewModal
          visible changeOrder={co} schedule={SCHEDULE} onConfirm={jest.fn()} onClose={onClose}
          approveSlide={{ coNumber: 4, contractAfterCents: 5240000 }}
        />
      </Shell>,
    );
    await advance(10);
    expect(textOf(u, 'co-reflow-slide-label')).toBe('Slide to approve and shift the schedule · +$4,200.00');
    expect(u.queryByTestId('co-reflow-confirm')).toBeNull();
    await srConfirm(u, 'co-reflow-slide');
    await advance(2500);
    expect(mockApprove).toHaveBeenCalledWith('co-4', { anchorTaskId: 'a' });
    expect(textOf(u, 'co-reflow-slide-result')).toBe('CO #4 approved · contract $52,400.00');
    expect(u.getByText(/^Finish moves to [A-Z][a-z]{2} \d{1,2}, 2026$/)).toBeTruthy();
    await advance(2000);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockFireConfetti).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    u.unmount();
  });

  test('place (already approved) stays a tap: no slide', async () => {
    const co = { ...CO, status: 'approved', scheduleImpactDays: 3, scheduleImpactTaskIds: ['a'] } as ChangeOrder;
    const u = render(
      <Shell>
        <COScheduleReflowPreviewModal visible changeOrder={co} schedule={SCHEDULE} intent="place" onConfirm={jest.fn()} onClose={jest.fn()} />
      </Shell>,
    );
    await advance(10);
    expect(u.queryByTestId('co-reflow-slide')).toBeNull();
    expect(u.getByTestId('co-reflow-confirm')).toBeTruthy();
    u.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B3: record a payment on the real invoice screen
// ─────────────────────────────────────────────────────────────────────────────

const INV_ID = '55555555-5555-4555-8555-555555555555';
let serverPayments: any[] = [];
const serverInv = () => ({
  id: INV_ID, number: 1042, project_id: PROJECT_ID, user_id: SMOKE_USER.id, type: 'full',
  issue_date: '2026-09-01', due_date: '2026-10-01', payment_terms: 'net_30', notes: '',
  line_items: [{ id: 'li1', name: 'Framing draw', description: 'Framing draw', quantity: 1, unit: 'ls', unitPrice: 20000, total: 20000 }],
  subtotal: 20000, tax_rate: 0, tax_amount: 0, total_due: 20000,
  amount_paid: serverPayments.reduce((s, p) => s + p.amount, 0),
  status: serverPayments.length ? 'partially_paid' : 'sent', payments: serverPayments,
  retention_percent: 0, retention_amount: 0, retention_released: 0,
  created_at: '2026-09-01T12:00:00.000Z', updated_at: '2026-09-01T12:00:00.000Z',
});
const sb = supabase as any;
const origFrom = sb.from;
const origRpc = sb.rpc;
let appends: { id: string; amount: number }[] = [];
type RpcMode = { kind: 'ok'; latencyMs: number } | { kind: 'refuse' } | { kind: 'drop' };
function install(mode: () => RpcMode) {
  sb.from = (table?: string) => {
    if (table !== 'invoices') return origFrom(table);
    let write = false; let single = false;
    const b: any = new Proxy({}, {
      get(_t, prop: string | symbol) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
            const data = write ? null : (single ? serverInv() : [serverInv()]);
            return Promise.resolve({ data, error: null, status: 200, count: null, statusText: 'OK' }).then(ok, bad);
          };
        }
        if (typeof prop === 'symbol') return undefined;
        return (..._a: unknown[]) => {
          if (['insert', 'update', 'upsert', 'delete'].includes(prop)) write = true;
          if (prop === 'single' || prop === 'maybeSingle') single = true;
          return b;
        };
      },
    });
    return b;
  };
  sb.rpc = (fn: string, args: any) => {
    if (fn !== 'invoice_append_payment') return origRpc(fn, args);
    const e = args?.p_entry;
    appends.push({ id: e?.id, amount: e?.amount });
    const m = mode();
    if (m.kind === 'drop') return Promise.reject(new TypeError('Network request failed'));
    if (m.kind === 'refuse') return Promise.resolve({ data: null, error: { message: 'amount_invalid', code: 'P0001' }, status: 400 });
    const answer = () => {
      // invoice_append_payment de-duplicates by entry id.
      if (!serverPayments.some((p) => p.id === e.id)) serverPayments = [...serverPayments, e];
      const paid = serverPayments.reduce((s, p) => s + p.amount, 0);
      return { data: { ok: true, already: false, amount_paid: paid, status: 'partially_paid', balance: 20000 - paid }, error: null, status: 200 };
    };
    return m.latencyMs > 0 ? new Promise((res) => setTimeout(() => res(answer()), m.latencyMs)) : Promise.resolve(answer());
  };
}

async function pump(ms: number, step = 50) {
  for (let t = 0; t < ms; t += step) {
    await act(async () => { jest.advanceTimersByTime(step); for (let k = 0; k < 20; k++) await Promise.resolve(); });
  }
}

async function openPaymentSheet(mode: () => RpcMode, opts: { lines?: unknown[]; amount?: string; reference?: string } = {}) {
  await primeWorld('populated');
  allowConsoleErrors();
  appends = [];
  serverPayments = [];
  install(mode);
  if (opts.lines?.length) await AsyncStorage.setItem('mageid_sync_failures', JSON.stringify(opts.lines));
  const tree = await mountRouteChecked('/');
  await settle();
  await act(async () => { router.push(`/invoice?projectId=${PROJECT_ID}&invoiceId=${INV_ID}` as never); });
  await settle();
  await pump(500);
  await act(async () => { fireEvent.press(tree.getByTestId('mark-paid-btn')); });
  await pump(300);
  await act(async () => { fireEvent.changeText(tree.getByTestId('record-payment-amount'), opts.amount ?? '5000'); });
  if (opts.reference) await act(async () => { fireEvent.changeText(tree.getByTestId('record-payment-reference'), opts.reference as string); });
  await pump(300);
  fireEvent(tree.getByTestId('record-payment-slide-track'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 358, height: 64 } } });
  await pump(100);
  return tree;
}

/** Pump in 100 ms steps until `testID` shows; its text the first time it does (null if never). */
async function firstSeen(tree: Awaited<ReturnType<typeof openPaymentSheet>>, testID: string, maxMs: number): Promise<unknown> {
  for (let t = 0; t < maxMs; t += 100) {
    const el = tree.queryByTestId(testID);
    if (el) return el.props.children;
    await pump(100);
  }
  return null;
}

async function recordBySlide(tree: Awaited<ReturnType<typeof openPaymentSheet>>) {
  await act(async () => {
    fireEvent(tree.getByTestId('record-payment-slide-rail'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
  });
  await pump(400);
  await act(async () => { fireEvent.press(tree.getByTestId('record-payment-slide-confirm')); });
}

afterEach(() => { sb.from = origFrom; sb.rpc = origRpc; });

describe('B3 record a payment (the real invoice screen)', () => {
  test('confirmed: the server balance on the slide, no Alert, one entry', async () => {
    const tree = await openPaymentSheet(() => ({ kind: 'ok', latencyMs: 300 }));
    expect(tree.getByTestId('record-payment-slide-label').props.children).toBe('Slide to record $5,000.00');
    await recordBySlide(tree);
    expect(await firstSeen(tree, 'record-payment-slide-result', 4000)).toBe('Recorded $5,000.00 · Balance $15,000.00');
    await pump(3000);
    // After the hold the sheet closes and the screen goes back.
    expect(tree.queryByTestId('record-payment-slide')).toBeNull();
    expect(appends).toHaveLength(1);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockFireConfetti).not.toHaveBeenCalled();
  });

  test('refused: the reason line, the sheet stays, nothing recorded', async () => {
    const tree = await openPaymentSheet(() => ({ kind: 'refuse' }));
    await recordBySlide(tree);
    expect(await firstSeen(tree, 'record-payment-slide-reason', 4000)).toBe('Not recorded. The server said no, so nothing was saved.');
    await pump(3000);
    expect(tree.queryByTestId('record-payment-slide-result')).toBeNull();
    expect(serverPayments).toHaveLength(0);
  });

  test('a dropped connection queues: said as waiting on this phone', async () => {
    const tree = await openPaymentSheet(() => ({ kind: 'drop' }));
    await recordBySlide(tree);
    expect(await firstSeen(tree, 'record-payment-slide-result', 4000)).toBe('Recorded on this phone · sends when online');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('a second Confirm while the append is on the wire records nothing more (was record-payment-once)', async () => {
    const tree = await openPaymentSheet(() => ({ kind: 'ok', latencyMs: 4000 }));
    await recordBySlide(tree);
    await pump(1500);
    // Still on the wire: the capsule is locked; a second activation cannot start a second append.
    await act(async () => {
      fireEvent(tree.getByTestId('record-payment-slide-rail'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    });
    await pump(400);
    const again = tree.queryByTestId('record-payment-slide-confirm');
    if (again) await act(async () => { fireEvent.press(again); });
    await pump(8000);
    const queued = (await getOfflineQueue()).filter((m) => m.operation === 'rpc' && m.rpc?.fn === 'invoice_append_payment');
    expect(new Set([...appends.map((a) => a.id), ...queued.map((m) => (m.rpc?.args as { p_entry?: { id?: string } }).p_entry?.id)]).size).toBe(1);
    expect(serverPayments).toHaveLength(1);
    expect(serverPayments[0].amount).toBe(5000);
  });

  test('a refused amount is one whole sentence that says why the slide waits', async () => {
    const tree = await openPaymentSheet(() => ({ kind: 'ok', latencyMs: 0 }), { amount: '' });
    expect(tree.getByTestId('record-payment-slide-label').props.children).toBe('Type the amount received to record a payment.');
    await act(async () => { fireEvent.changeText(tree.getByTestId('record-payment-amount'), '12.5.0'); });
    await pump(200);
    expect(tree.getByTestId('record-payment-slide-label').props.children).toBe("Couldn't read that amount. Type it like 12500.00 or 12,500.00.");
    await act(async () => { fireEvent.changeText(tree.getByTestId('record-payment-amount'), '0'); });
    await pump(200);
    expect(tree.getByTestId('record-payment-slide-label').props.children).toBe('Enter an amount above $0.00 to record a payment.');
    expect(appends).toHaveLength(0);
  });

  test('a timeout says "Check invoice #1042", locks the fields, and the retry sends the SAME payment id', async () => {
    let call = 0;
    const tree = await openPaymentSheet(() => (++call === 1 ? { kind: 'ok', latencyMs: 25000 } : { kind: 'ok', latencyMs: 300 }));
    await recordBySlide(tree);
    await pump(21500);
    expect(tree.getByTestId('record-payment-slide-reason').props.children).toBe('No answer yet. Check invoice #1042 before trying again.');
    expect(tree.getByTestId('record-payment-amount').props.editable).toBe(false);
    // The first append lands late; then he retries.
    await pump(5000);
    await recordBySlide(tree);
    expect(await firstSeen(tree, 'record-payment-slide-result', 4000)).toBe('Recorded $5,000.00 · Balance $15,000.00');
    expect(appends.length).toBeGreaterThanOrEqual(2);
    expect(new Set(appends.map((a) => a.id)).size).toBe(1);
    expect(serverPayments).toHaveLength(1);
    expect(serverPayments[0].amount).toBe(5000);
  });
});

// The promises of the retired record-payment-resume / record-payment-once
// smokes, on the slide: the unsent-changes hold reads BEFORE the slide, the
// link does not bring the same money back, and a payment that lands after he
// left never closes the screen he opened since.
const WAITING_5000 = (at: number) => ({
  id: 'oq-pay-1', kind: 'write', label: 'Invoice payment of $5,000.00', reason: 'the server refused it', at, userId: SMOKE_USER.id,
  table: 'invoices', recordId: INV_ID, operation: 'rpc', queuedAt: at,
  rpc: { fn: 'invoice_append_payment', args: { p_invoice_id: INV_ID, p_entry: { id: 'pay-old', date: new Date(at).toISOString(), amount: 5000, method: 'check', receivedDate: '2026-09-20', reference: '1234' } } },
});

async function reviewUnsent(tree: Awaited<ReturnType<typeof openPaymentSheet>>) {
  await act(async () => { fireEvent.press(tree.getByTestId('record-payment-review-unsent')); });
  await pump(1000);
}

describe('B3 the unsent-changes hold, on the slide', () => {
  test('the SAME money waiting: the slide is held with the reason; after its retry the next open starts fresh and nothing counts twice', async () => {
    const tree = await openPaymentSheet(() => ({ kind: 'ok', latencyMs: 0 }), { lines: [WAITING_5000(Date.now())], amount: '5000', reference: '1234' });
    expect(tree.getByTestId('record-payment-slide-label').props.children).toBe("An earlier change to this invoice hasn't sent yet. Review unsent changes first.");
    // Said once (the track); the row below holds only the link.
    expect(tree.getAllByText("An earlier change to this invoice hasn't sent yet. Review unsent changes first.")).toHaveLength(1);
    expect(tree.getByText('Review unsent changes')).toBeTruthy();
    expect(tree.queryByText(/Not saved/)).toBeNull();
    await reviewUnsent(tree);
    let r = '';
    await act(async () => { r = await retryUnsavedWrite('oq-pay-1'); });
    await pump(2000);
    expect(r).toBe('synced');
    await act(async () => { fireEvent.press(tree.getByTestId('mark-paid-btn')); });
    await pump(300);
    expect(tree.queryByDisplayValue('5000')).toBeNull();
    expect(tree.queryByDisplayValue('1234')).toBeNull();
    expect(appends.map((a) => a.id)).toEqual(['pay-old']);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('DIFFERENT money waiting: what he typed comes back once, then the sheet resets', async () => {
    const tree = await openPaymentSheet(() => ({ kind: 'ok', latencyMs: 0 }), { lines: [WAITING_5000(Date.now())], amount: '3000', reference: '777' });
    await reviewUnsent(tree);
    await act(async () => { fireEvent.press(tree.getByTestId('mark-paid-btn')); });
    await pump(300);
    expect(tree.queryByDisplayValue('3000')).not.toBeNull();
    expect(tree.queryByDisplayValue('777')).not.toBeNull();
    const closes = tree.getAllByLabelText('Close');
    await act(async () => { fireEvent.press(closes[closes.length - 1]); });
    await pump(300);
    await act(async () => { fireEvent.press(tree.getByTestId('mark-paid-btn')); });
    await pump(300);
    expect(tree.queryByDisplayValue('20000.00')).not.toBeNull();
    expect(appends).toHaveLength(0);
  });

  test('a payment that lands after he left: no late back() closes the screen he opened since, and the result is still said', async () => {
    const tree = await openPaymentSheet(() => ({ kind: 'ok', latencyMs: 4000 }));
    await recordBySlide(tree);
    await pump(500);
    const closes = tree.getAllByLabelText('Close');
    await act(async () => { fireEvent.press(closes[closes.length - 1]); });
    await pump(300);
    await act(async () => { router.back(); });
    await pump(300);
    await act(async () => { router.push('/cash-flow' as never); });
    await pump(300);
    expect(tree.getPathname()).toBe('/cash-flow');
    let said = false;
    for (let t = 0; t < 15000 && !said; t += 100) {
      await pump(100);
      said = !!tree.queryByText('Payment of $5,000.00 recorded');
    }
    expect(said).toBe(true);
    expect(tree.getPathname()).toBe('/cash-flow');
    expect(appends).toHaveLength(1);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// B4: certify an AIA pay app on the real screen
// ─────────────────────────────────────────────────────────────────────────────

const AIA_INV = 'inv-mm-aia';
const aiaInvoice = {
  id: AIA_INV, number: 7, projectId: PROJECT_ID, type: 'progress', progressPercent: 100,
  issueDate: '2026-09-01T12:00:00.000Z', dueDate: '2026-09-30T12:00:00.000Z', paymentTerms: 'net_30', notes: '',
  lineItems: [
    { id: 'aia-l1', name: 'Selective demolition', description: '', quantity: 1, unit: 'LS', unitPrice: 3400.5, total: 3400.5 },
    { id: 'aia-l2', name: 'Rough carpentry', description: '', quantity: 1, unit: 'LS', unitPrice: 2250.25, total: 2250.25 },
  ],
  subtotal: 5650.75, taxRate: 0, taxAmount: 0, totalDue: 5650.75, amountPaid: 0, status: 'sent', payments: [],
  retainagePercent: 10, createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z',
};

// The server's copy of the invoice (the provider reads invoices from the
// server once signed in; the phone's copy alone is replaced by that read).
const aiaServerInv = {
  id: AIA_INV, number: 7, project_id: PROJECT_ID, user_id: SMOKE_USER.id, type: 'progress', progress_percent: 100,
  issue_date: '2026-09-01', due_date: '2026-09-30', payment_terms: 'net_30', notes: '',
  line_items: aiaInvoice.lineItems, subtotal: 5650.75, tax_rate: 0, tax_amount: 0, total_due: 5650.75, amount_paid: 0,
  status: 'sent', payments: [], retention_percent: 10, retention_amount: 0, retention_released: 0,
  created_at: '2026-09-01T12:00:00.000Z', updated_at: '2026-09-01T12:00:00.000Z',
};

/** Every write to aia_pay_apps that reached supabase-js (addAIAPayApp's queue flush lands here). */
let aiaWrites: string[] = [];
function watchAiaWrites() {
  sb.from = (table?: string) => {
    if (table === 'invoices') {
      let write = false; let single = false;
      const q: any = new Proxy({}, {
        get(_t, prop: string | symbol) {
          if (prop === 'then') {
            return (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
              const data = write ? null : (single ? aiaServerInv : [aiaServerInv]);
              return Promise.resolve({ data, error: null, status: 200, count: null, statusText: 'OK' }).then(ok, bad);
            };
          }
          if (typeof prop === 'symbol') return undefined;
          return (..._a: unknown[]) => {
            if (['insert', 'update', 'upsert', 'delete'].includes(prop)) write = true;
            if (prop === 'single' || prop === 'maybeSingle') single = true;
            return q;
          };
        },
      });
      return q;
    }
    const b = origFrom(table);
    if (table !== 'aia_pay_apps') return b;
    return new Proxy(b, {
      get(t: any, prop: string | symbol) {
        const v = t[prop];
        if (typeof prop === 'string' && ['insert', 'update', 'upsert', 'delete'].includes(prop)) aiaWrites.push(prop);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  };
}

async function queuedAiaWrites(): Promise<number> {
  return (await getOfflineQueue()).filter((m) => m.table === 'aia_pay_apps').length;
}

async function openCertify() {
  await primeWorld('populated');
  allowConsoleErrors();
  aiaWrites = [];
  watchAiaWrites();
  await AsyncStorage.multiSet([['mageid_invoices', JSON.stringify([aiaInvoice])], ['mageid_aia_pay_apps', JSON.stringify([])]]);
  const tree = await mountRouteChecked('/');
  await settle();
  await act(async () => { router.push(`/aia-pay-app?invoiceId=${AIA_INV}` as never); });
  await settle();
  await pump(800);
  const understood = tree.queryByText('I understand');
  if (understood) { await act(async () => { fireEvent.press(understood); }); await pump(300); }
  await act(async () => { fireEvent.press(tree.getByText('Generate PDF')); });
  await pump(300);
  expect(tree.getByText('Ready to certify?')).toBeTruthy();
  fireEvent(tree.getByTestId('aia-certify-slide-track'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 358, height: 64 } } });
  await pump(100);
  return tree;
}

async function certifyBySlide(tree: Awaited<ReturnType<typeof openCertify>>) {
  await act(async () => {
    fireEvent(tree.getByTestId('aia-certify-slide-rail'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
  });
  await pump(400);
  await act(async () => { fireEvent.press(tree.getByTestId('aia-certify-slide-confirm')); });
}

afterEach(() => { onlineManager.setOnline(true); });

describe('B4 certify an AIA pay app (the real screen)', () => {
  test('synced: "Pay app #n certified · $x", the PDF opens only after the hold, no Alert, nothing queued', async () => {
    mockSaveAia.mockImplementation(async (rec: { id: string }) => ({ status: 'synced', record: rec }));
    const tree = await openCertify();
    expect(tree.getByTestId('aia-certify-slide-label').props.children).toMatch(/^Slide to certify · \$[\d,]+\.\d{2}$/);
    await certifyBySlide(tree);
    const title = await firstSeen(tree, 'aia-certify-slide-result', 6000);
    expect(title).toMatch(/^Pay app #\d+ certified · \$[\d,]+\.\d{2}$/);
    // The result is showing and the PDF has not opened yet: it opens in onDone.
    expect(mockPdf).not.toHaveBeenCalled();
    expect(tree.getByText('No Pay button yet. Connect Stripe to add one.')).toBeTruthy();
    await pump(4000);
    expect(mockPdf).toHaveBeenCalledTimes(1);
    expect(mockSaveAia).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockFireConfetti).not.toHaveBeenCalled();
    // The certification went through the online write only; nothing queue-backed.
    expect(aiaWrites).toHaveLength(0);
    expect(await queuedAiaWrites()).toBe(0);
  });

  test('refused: the reason line, never green, no PDF, nothing queued', async () => {
    mockSaveAia.mockResolvedValue({ status: 'refused' });
    const tree = await openCertify();
    await certifyBySlide(tree);
    expect(await firstSeen(tree, 'aia-certify-slide-reason', 6000)).toBe('Not certified. Something went wrong on our side.');
    await pump(4000);
    expect(tree.queryByTestId('aia-certify-slide-result')).toBeNull();
    expect(mockPdf).not.toHaveBeenCalled();
    expect(aiaWrites).toHaveLength(0);
    expect(await queuedAiaWrites()).toBe(0);
  });

  test('no answer: "Check pay app #n", never green, no PDF; the retry certifies the SAME record id', async () => {
    mockSaveAia.mockResolvedValueOnce({ status: 'unknown' });
    const tree = await openCertify();
    await certifyBySlide(tree);
    expect(await firstSeen(tree, 'aia-certify-slide-reason', 6000)).toMatch(/^No answer yet\. Check pay app #\d+ before trying again\.$/);
    await pump(3000);
    expect(tree.queryByTestId('aia-certify-slide-result')).toBeNull();
    expect(mockPdf).not.toHaveBeenCalled();
    expect(tree.queryByText(/nothing was (saved|certified)/i)).toBeNull();
    // The retry: the same certificate, never a second aia_pay_apps row.
    mockSaveAia.mockImplementation(async (rec: { id: string }) => ({ status: 'synced', record: rec }));
    await certifyBySlide(tree);
    expect(await firstSeen(tree, 'aia-certify-slide-result', 6000)).toMatch(/^Pay app #\d+ certified/);
    expect(mockSaveAia).toHaveBeenCalledTimes(2);
    const ids = mockSaveAia.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBe(ids[0]);
    expect(aiaWrites).toHaveLength(0);
  });

  test('offline: the slide is disabled with the reason, and nothing is written', async () => {
    const tree = await openCertify();
    await act(async () => { onlineManager.setOnline(false); });
    await pump(200);
    expect(tree.getByTestId('aia-certify-slide-label').props.children).toBe("You're offline. Certifying needs a connection.");
    await act(async () => {
      fireEvent(tree.getByTestId('aia-certify-slide-rail'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    });
    await pump(400);
    const confirm = tree.queryByTestId('aia-certify-slide-confirm');
    if (confirm) await act(async () => { fireEvent.press(confirm); });
    await pump(3000);
    expect(mockSaveAia).not.toHaveBeenCalled();
    expect(mockPdf).not.toHaveBeenCalled();
    expect(tree.queryByTestId('aia-certify-slide-result')).toBeNull();
    expect(aiaWrites).toHaveLength(0);
    expect(await queuedAiaWrites()).toBe(0);
  });
});
