// The tutorial practice pass opens invoicing on the SAMPLE job only.
//
// The founder's practice pass (utils/tutorial/practicePass) lets a Free user
// practise invoicing — a Pro feature — on "Sample — Sarah's Place" while the
// invoice tutorial runs. The integration review found an escape: the route
// gate checked the pass against the invoice-derived project when the URL
// named only an invoice, and the editor's own project picker then opened a
// REAL job in the full Pro editor, whose Send emails the real client and
// mints a live pay link. The pass is now keyed to the URL's project, and the
// editor re-checks the tier on the job it writes to.
//
// A mount of the REAL tree (providers, TutorialHost, app/invoice.tsx) on the
// Free tier with one real job and one sample. The run is dispatched straight
// into the real store — no seeding, no navigation by the host — because what
// is under test is the gate, not the boot.
import { act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { SMOKE_USER, PROJECT_ID, world } from '@/__tests__/fixtures/world';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { __resetTutorialStoreForTest, dispatchTutorial, getTutorialState } from '@/utils/tutorial/store';

const SAMPLE_ID = '66666666-6666-4666-8666-666666666666';
const SAMPLE_INV_ID = '77777777-7777-4777-8777-777777777777';
const SAMPLE_NAME = 'Sample — Sarah’s Place';

// The sample's issued invoice #2, as the server returns it.
const SERVER_INV = {
  id: SAMPLE_INV_ID, number: 2, project_id: SAMPLE_ID, user_id: SMOKE_USER.id, type: 'progress',
  issue_date: '2026-08-01', due_date: '2026-08-31', payment_terms: 'net_30', notes: '',
  line_items: [{ id: 'li1', name: 'Demo + rough-in', description: 'Demo + rough-in', quantity: 1, unit: 'ls', unitPrice: 42240, total: 42240 }],
  subtotal: 42240, tax_rate: 0, tax_amount: 0, total_due: 42240, amount_paid: 0, status: 'sent', payments: [],
  retention_percent: 0, retention_amount: 0, retention_released: 0,
  created_at: '2026-08-01T12:00:00.000Z', updated_at: '2026-08-01T12:00:00.000Z',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const sb = supabase as any;
const origFrom = sb.from;
function serveSampleInvoice() {
  sb.from = (table?: string) => {
    if (table !== 'invoices') return origFrom(table);
    let single = false; let write = false;
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
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function primeFreeWithSample() {
  await primeWorld('populated');
  allowConsoleErrors();
  await AsyncStorage.setItem('mageid_subscription_tier', 'free');
  // The sample: the fixture job's shape under the byte-exact sample name, with
  // the recorded retainage term the seed now writes (no retainage ask).
  const sample = {
    ...world.project, id: SAMPLE_ID, name: SAMPLE_NAME, clientPortal: undefined,
    retainagePercent: 0, retainagePercentAssumed: false,
  };
  await AsyncStorage.setItem('mageid_projects', JSON.stringify([world.project, sample]));
  serveSampleInvoice();
}

function startInvoiceRun() {
  const now = Date.now();
  dispatchTutorial({ type: 'START', tutorialId: 'invoice-to-self', sandboxProjectId: SAMPLE_ID, entry: 'hub', now });
  dispatchTutorial({ type: 'BOOTED', flags: { samplePlan: true, mic: true }, mounted: [], now });
}

// The run starts AFTER the app has mounted and signed in: the host ends a
// run on an auth-user change, which the first mount is.
async function open(url: string, withRun: boolean) {
  const tree = await mountRouteChecked('/');
  await settle();
  if (withRun) await act(async () => { startInvoiceRun(); });
  await act(async () => { router.push(url as never); });
  await settle();
  return tree;
}

/** The run must still be live, or a paywall proves nothing about the pass. */
function expectRunLive() {
  const s = getTutorialState();
  expect(s.status === 'running' ? s.tutorialId : `not running: ${s.status}${s.status === 'finished' ? ` (${s.reason ?? s.outcome})` : ''}`).toBe('invoice-to-self');
}

beforeEach(() => { __resetTutorialStoreForTest(); });
afterEach(() => { sb.from = origFrom; __resetTutorialStoreForTest(); });

describe('practice pass — sample only', () => {
  test('control: no run, an invoice-only link to the sample → the Invoicing paywall', async () => {
    await primeFreeWithSample();
    const tree = await open(`/invoice?invoiceId=${SAMPLE_INV_ID}`, false);
    expect(tree.queryByTestId('paywall-upgrade-btn')).not.toBeNull();
    expect(tree.queryByTestId('send-invoice-btn')).toBeNull();
  });

  test('control: a run is live, but the URL names the REAL job → the paywall', async () => {
    await primeFreeWithSample();
    const tree = await open(`/invoice?projectId=${PROJECT_ID}&type=progress`, true);
    expectRunLive();
    expect(tree.queryByTestId('paywall-upgrade-btn')).not.toBeNull();
    expect(tree.queryByTestId('send-invoice-btn')).toBeNull();
  });

  test('the escape: a run is live and the link names only a sample invoice → still the paywall, no job picker', async () => {
    await primeFreeWithSample();
    const tree = await open(`/invoice?invoiceId=${SAMPLE_INV_ID}`, true);
    expectRunLive();
    expect(tree.queryByTestId('paywall-upgrade-btn')).not.toBeNull();
    expect(tree.queryByTestId(`tool-pick-project-${PROJECT_ID}`)).toBeNull();
    expect(tree.queryByTestId('send-invoice-btn')).toBeNull();
  });

  test('the pass itself: a run is live on the sample → the editor opens there, sending to him, with no retainage ask', async () => {
    await primeFreeWithSample();
    const tree = await open(`/invoice?projectId=${SAMPLE_ID}&type=progress`, true);
    expectRunLive();
    expect(tree.queryByTestId('paywall-upgrade-btn')).toBeNull();
    expect(tree.queryByTestId('send-invoice-btn')).not.toBeNull();
    expect(tree.queryByText('Send to me')).not.toBeNull();
    // The sample records its retainage term, so step 1 is not hidden behind
    // the "Retainage on this job" sheet (integration review).
    expect(tree.queryByTestId('retainage-ask-modal')).toBeNull();
  });
});
