// Record Payment appends ONE entry per payment, however often it is tapped.
//
// invoice_append_payment de-duplicates by entry id only, and every tap of the
// sheet's Record Payment mints a new id. The sheet stays up (and, before the
// fix, its button stayed live) through the ledger reads, the append and the
// re-read — seconds on job-site signal. A second tap in that window recorded
// the same check twice, and nothing in the app can take an entry back out
// (invoices_ledger_guard re-merges any client write that drops one). This is
// a mount of the REAL tree (providers, app/invoice.tsx, recordInvoicePayment,
// the offline queue); only the Supabase answers are shaped here, and the
// append answers after 4 s like a slow connection.
// (The resume of a typed payment after "Open Not saved" is pinned in
// scripts/validate-w4-final-fix-sync.ts section F.)
import { act, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { SMOKE_USER, PROJECT_ID } from '@/__tests__/fixtures/world';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { getOfflineQueue } from '@/utils/offlineQueue';

const INV_ID = '55555555-5555-4555-8555-555555555555';
const SERVER_INV = {
  id: INV_ID, number: 1042, project_id: PROJECT_ID, user_id: SMOKE_USER.id, type: 'full',
  issue_date: '2026-09-01', due_date: '2026-10-01', payment_terms: 'net_30', notes: '',
  line_items: [{ id: 'li1', name: 'Framing draw', description: 'Framing draw', quantity: 1, unit: 'ls', unitPrice: 20000, total: 20000 }],
  subtotal: 20000, tax_rate: 0, tax_amount: 0, total_due: 20000, amount_paid: 0, status: 'sent', payments: [],
  retention_percent: 0, retention_amount: 0, retention_released: 0,
  created_at: '2026-09-01T12:00:00.000Z', updated_at: '2026-09-01T12:00:00.000Z',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
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
            const data = write ? null : (single ? SERVER_INV : [SERVER_INV]);
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
    appends.push({ id: args?.p_entry?.id, amount: args?.p_entry?.amount });
    return new Promise((res) => setTimeout(() => res({
      data: { ok: true, already: false, amount_paid: 0, status: 'partially_paid', balance: 0 }, error: null, status: 200,
    }), latencyMs));
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function pump(ms: number, step = 50) {
  for (let t = 0; t < ms; t += step) {
    await act(async () => { jest.advanceTimersByTime(step); for (let k = 0; k < 20; k++) await Promise.resolve(); });
  }
}

// Sent plus waiting on this phone: a second entry parked in the queue behind
// the first (the queue holds a write behind its own in-flight one) is the same
// double count, only later.
async function appendsRecorded(): Promise<{ id: string; amount: number }[]> {
  const queued = (await getOfflineQueue())
    .filter((m) => m.operation === 'rpc' && m.rpc?.fn === 'invoice_append_payment')
    .map((m) => {
      const e = (m.rpc?.args as { p_entry?: { id?: string; amount?: number } } | undefined)?.p_entry;
      return { id: String(e?.id), amount: Number(e?.amount) };
    });
  const byId = new Map<string, { id: string; amount: number }>();
  for (const a of [...appends, ...queued]) byId.set(a.id, a);
  return [...byId.values()];
}

async function openSheet() {
  await primeWorld('populated');
  allowConsoleErrors();
  appends = [];
  install(4000);
  const tree = await mountRouteChecked('/');
  await settle();
  await act(async () => { router.push(`/invoice?projectId=${PROJECT_ID}&invoiceId=${INV_ID}` as never); });
  await settle();
  await pump(500);
  await act(async () => { fireEvent.press(tree.getByTestId('mark-paid-btn')); });
  await pump(300);
  return tree;
}

afterEach(() => { sb.from = origFrom; sb.rpc = origRpc; });

describe('Record Payment — one append per payment', () => {
  test('one tap records one entry', async () => {
    const tree = await openSheet();
    await act(async () => { fireEvent.changeText(tree.getByDisplayValue('20000.00'), '5000'); });
    await pump(100);
    await act(async () => { fireEvent.press(tree.getByTestId('record-payment-submit')); });
    await pump(12000);
    expect(appends).toHaveLength(1);
    expect(appends[0].amount).toBe(5000);
  });

  test('a second tap while the append is on the wire records nothing more, and the button says so', async () => {
    const tree = await openSheet();
    await act(async () => { fireEvent.changeText(tree.getByDisplayValue('20000.00'), '5000'); });
    await pump(100);
    await act(async () => { fireEvent.press(tree.getByTestId('record-payment-submit')); });
    await pump(1500);
    // Still on the wire: the sheet is up, its button is disabled and says why.
    const btn = tree.getByTestId('record-payment-submit');
    expect(tree.queryByText('Recording…')).not.toBeNull();
    await act(async () => { fireEvent.press(btn); });
    await pump(15000);
    const all = await appendsRecorded();
    expect(all).toHaveLength(1);
    expect(all.reduce((s, a) => s + a.amount, 0)).toBe(5000);
  });

  test('a fast double tap on the prefilled full balance (one frame) records it once', async () => {
    const tree = await openSheet();
    const save = tree.getByTestId('record-payment-submit');
    await act(async () => { fireEvent.press(save); fireEvent.press(save); });
    await pump(15000);
    const all = await appendsRecorded();
    expect(all).toHaveLength(1);
    expect(all[0].amount).toBe(20000);
  });
});
