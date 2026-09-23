/**
 * Wave-4 final fix, round 8 — Record Payment after "Open Not saved", and a
 * payment that lands after he left the invoice (money critic round 7, data-sync
 * critic round 8; replays RS1, T5 and T6 on the real tree).
 *
 *  • Same money: the waiting-payment dialog tells him to retry the waiting
 *    append on the Not-saved sheet. Round 7 brought his typed payment back on
 *    the next open anyway — the same amount, day and check # — and once the
 *    Retry had landed nothing warned him, so one tap recorded the check twice
 *    (invoices_ledger_guard will not let the app take an entry back out).
 *  • Different money: the typed payment still comes back, once.
 *  • Late back: the payment chain ended in router.back() even after he had
 *    closed the sheet, left the invoice and opened another screen — closing
 *    THAT screen. The result alert still shows.
 */
import { act, fireEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { retryUnsavedWrite } from '@/utils/syncLedger';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { SMOKE_USER, PROJECT_ID } from '@/__tests__/fixtures/world';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';

const INV_ID = '55555555-5555-4555-8555-555555555555';

/* eslint-disable @typescript-eslint/no-explicit-any */
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
function install(latencyMs: number) {
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
    const answer = () => {
      if (!serverPayments.some((p) => p.id === e.id)) serverPayments = [...serverPayments, e];
      const paid = serverPayments.reduce((s, p) => s + p.amount, 0);
      return { data: { ok: true, already: false, amount_paid: paid, status: 'partially_paid', balance: 20000 - paid }, error: null, status: 200 };
    };
    return latencyMs > 0 ? new Promise((res) => setTimeout(() => res(answer()), latencyMs)) : Promise.resolve(answer());
  };
}
type AlertCall = { title: string; buttons?: { text?: string; onPress?: () => void }[] };
let alerts: AlertCall[] = [];
/* eslint-enable @typescript-eslint/no-explicit-any */

async function pump(ms: number, step = 50) {
  for (let t = 0; t < ms; t += step) {
    await act(async () => { jest.advanceTimersByTime(step); for (let k = 0; k < 20; k++) await Promise.resolve(); });
  }
}

const WAITING_5000 = (at: number) => ({
  id: 'oq-pay-1', kind: 'write', label: 'Invoice payment of $5,000.00', reason: 'the server refused it', at, userId: SMOKE_USER.id,
  table: 'invoices', recordId: INV_ID, operation: 'rpc', queuedAt: at,
  rpc: { fn: 'invoice_append_payment', args: { p_invoice_id: INV_ID, p_entry: { id: 'pay-old', date: new Date(at).toISOString(), amount: 5000, method: 'check', receivedDate: '2026-09-20', reference: '1234' } } },
});

async function openSheet(latencyMs: number, lines: unknown[]) {
  await primeWorld('populated');
  allowConsoleErrors();
  appends = [];
  serverPayments = [];
  alerts = [];
  install(latencyMs);
  if (lines.length) await AsyncStorage.setItem('mageid_sync_failures', JSON.stringify(lines));
  jest.spyOn(Alert, 'alert').mockImplementation(((title: string, _m?: string, buttons?: AlertCall['buttons']) => { alerts.push({ title, buttons }); }) as never);
  const tree = await mountRouteChecked('/');
  await settle();
  await act(async () => { router.push(`/invoice?projectId=${PROJECT_ID}&invoiceId=${INV_ID}` as never); });
  await settle();
  await pump(500);
  await act(async () => { fireEvent.press(tree.getByTestId('mark-paid-btn')); });
  await pump(300);
  return tree;
}

async function typeAndSubmit(tree: Awaited<ReturnType<typeof openSheet>>, amount: string, reference?: string) {
  await act(async () => { fireEvent.changeText(tree.getByDisplayValue('20000.00'), amount); });
  if (reference) await act(async () => { fireEvent.changeText(tree.getByTestId('record-payment-reference'), reference); });
  await pump(100);
  await act(async () => { fireEvent.press(tree.getByTestId('record-payment-submit')); });
  await pump(1000);
}

async function pressOpenNotSaved() {
  const warn = alerts.find((a) => a.title === 'A payment on this invoice is not saved yet');
  expect(warn).toBeDefined();
  const open = warn?.buttons?.find((b) => b.text === 'Open Not saved');
  await act(async () => { open?.onPress?.(); });
  await pump(1000);
}

afterEach(() => { sb.from = origFrom; sb.rpc = origRpc; jest.restoreAllMocks(); });

describe('Record Payment after "Open Not saved"', () => {
  test('RS1: the SAME money retried there — the next open starts fresh, and nothing is recorded twice', async () => {
    const tree = await openSheet(0, [WAITING_5000(Date.now())]);
    await typeAndSubmit(tree, '5000', '1234');
    await pressOpenNotSaved();
    let r = '';
    await act(async () => { r = await retryUnsavedWrite('oq-pay-1'); });
    await pump(2000);
    expect(r).toBe('synced');
    await act(async () => { fireEvent.press(tree.getByTestId('mark-paid-btn')); });
    await pump(300);
    // Round 7: the sheet came back holding 5000 / check 1234 — one tap from a
    // second $5,000 entry for one check.
    expect(tree.queryByDisplayValue('5000')).toBeNull();
    expect(tree.queryByDisplayValue('1234')).toBeNull();
    expect(appends.map((a) => a.id)).toEqual(['pay-old']);
  });

  test('T5: DIFFERENT money — what he typed comes back once, then the sheet resets', async () => {
    const tree = await openSheet(0, [WAITING_5000(Date.now())]);
    await typeAndSubmit(tree, '3000', '777');
    await pressOpenNotSaved();
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
});

describe('a payment that lands after he left the invoice', () => {
  test('T6: no late router.back() closes the screen he opened since — the result alert still shows', async () => {
    const tree = await openSheet(4000, []);
    await act(async () => { fireEvent.changeText(tree.getByDisplayValue('20000.00'), '5000'); });
    await pump(100);
    await act(async () => { fireEvent.press(tree.getByTestId('record-payment-submit')); });
    await pump(500);
    const closes = tree.getAllByLabelText('Close');
    await act(async () => { fireEvent.press(closes[closes.length - 1]); });
    await pump(300);
    await act(async () => { router.back(); });
    await pump(300);
    await act(async () => { router.push('/cash-flow' as never); });
    await pump(300);
    expect(tree.getPathname()).toBe('/cash-flow');
    await pump(15000);
    expect(alerts.map((a) => a.title)).toContain('Payment Recorded');
    expect(tree.getPathname()).toBe('/cash-flow'); // round 7: '/' — his cash-flow screen closed
    expect(appends).toHaveLength(1);
  });
});
