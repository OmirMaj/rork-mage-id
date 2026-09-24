// The practice pass opens ONLY the tutorial's own screens.
//
// Round 2 of the integration review found that the pass, ORed into
// hooks/useProjectAccess, opened every screen gated on the practised feature.
// /change-order and /field-ticket gate on the URL's projectId but load the
// record by id from ANY project, so a link naming the SAMPLE as projectId and
// a REAL coId / ticketId opened the real job in the paid editor for a Free
// user while the invoice tutorial ran. The fix is the simplest provable rule:
// the pass is opt-in, read only by punch-walk, invoice and the hub's tile
// locks (validate-tutorial-field-screens pins the allowlist).
//
// A mount of the REAL tree (providers, TutorialHost, the screens) on the Free
// tier with one real job and one sample. The run is dispatched straight into
// the real store: what is under test is the gate, not the boot.
import { act, fireEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { SMOKE_USER, PROJECT_ID, world } from '@/__tests__/fixtures/world';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { __resetTutorialStoreForTest, dispatchTutorial, getTutorialState } from '@/utils/tutorial/store';

const SAMPLE_ID = '66666666-6666-4666-8666-666666666666';
const REAL_CO_ID = '88888888-8888-4888-8888-888888888888';
const REAL_INV_ID = '99999999-9999-4999-8999-999999999999';
const SAMPLE_NAME = 'Sample — Sarah’s Place';
const REAL_DESC = 'REAL CLIENT CO extra outlets';
const REAL_TICKET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SERVER_TICKET = {
  id: REAL_TICKET_ID, number: 4, project_id: PROJECT_ID, user_id: SMOKE_USER.id,
  date: '2026-08-01', work_description: 'REAL extra outlet run', reason_extra: 'Owner request after rough-in',
  labor: [{ id: 'lab1', workerName: 'Mike', trade: 'Electrician', hours: 8, rate: 95 }],
  materials: [], equipment: [], photos: [], markup_percent: 10, status: 'signed',
  authorization: { name: 'Owner Rep', signaturePaths: ['M0 0 L10 10'], signedAt: '2026-08-01T12:00:00.000Z' },
  audit_trail: [], created_at: '2026-08-01T12:00:00.000Z', updated_at: '2026-08-01T12:00:00.000Z',
};

const SERVER_CO = {
  id: REAL_CO_ID, number: 1, project_id: PROJECT_ID, user_id: SMOKE_USER.id,
  date: '2026-08-01', description: REAL_DESC, reason: 'Owner request',
  line_items: [{ id: 'l1', name: 'Outlets', description: 'Outlets', quantity: 1, unit: 'ls', unitPrice: 1200, total: 1200 }],
  original_contract_value: 100000, change_amount: 1200, new_contract_total: 101200,
  status: 'draft', approvers: [], approval_mode: 'any', approval_deadline_days: 7, audit_trail: [], revision: 1,
  created_at: '2026-08-01T12:00:00.000Z', updated_at: '2026-08-01T12:00:00.000Z',
};
const SERVER_INV = {
  id: REAL_INV_ID, number: 7, project_id: PROJECT_ID, user_id: SMOKE_USER.id, type: 'progress',
  issue_date: '2026-08-01', due_date: '2026-08-31', payment_terms: 'net_30', notes: '',
  line_items: [{ id: 'li1', name: 'Real work', description: 'Real work', quantity: 1, unit: 'ls', unitPrice: 5000, total: 5000 }],
  subtotal: 5000, tax_rate: 0, tax_amount: 0, total_due: 5000, amount_paid: 0, status: 'draft', payments: [],
  retention_percent: 0, retention_amount: 0, retention_released: 0,
  created_at: '2026-08-01T12:00:00.000Z', updated_at: '2026-08-01T12:00:00.000Z',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const sb = supabase as any;
const origFrom = sb.from;
function serveRows() {
  sb.from = (table?: string) => {
    const row = table === 'change_orders' ? SERVER_CO : table === 'invoices' ? SERVER_INV : table === 'field_tickets' ? SERVER_TICKET : null;
    if (!row) return origFrom(table);
    let single = false; let write = false;
    const b: any = new Proxy({}, {
      get(_t, prop: string | symbol) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
            const data = write ? null : (single ? row : [row]);
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
  const sample = {
    ...world.project, id: SAMPLE_ID, name: SAMPLE_NAME, clientPortal: undefined,
    retainagePercent: 0, retainagePercentAssumed: false,
  };
  await AsyncStorage.setItem('mageid_projects', JSON.stringify([world.project, sample]));
  serveRows();
}

type RunId = 'invoice-to-self' | 'punch-walk';
function startRun(tutorialId: RunId) {
  const now = Date.now();
  dispatchTutorial({ type: 'START', tutorialId, sandboxProjectId: SAMPLE_ID, entry: 'hub', now });
  dispatchTutorial({ type: 'BOOTED', flags: { samplePlan: true, mic: true }, mounted: [], now });
}

// The run starts AFTER the app has mounted and signed in: the host ends a
// run on an auth-user change, which the first mount is.
async function open(url: string, run: RunId | null) {
  const tree = await mountRouteChecked('/');
  await settle();
  if (run) await act(async () => { startRun(run); });
  await act(async () => { router.push(url as never); });
  await settle();
  await settle();
  return tree;
}

/** The run must still be live, or a paywall proves nothing about the pass. */
function expectRunLive(id: RunId) {
  const s = getTutorialState();
  expect(s.status === 'running' ? s.tutorialId : `not running: ${s.status}`).toBe(id);
}

beforeEach(() => { __resetTutorialStoreForTest(); });
afterEach(() => { sb.from = origFrom; __resetTutorialStoreForTest(); });

describe('practice pass — record links cannot reach a real job', () => {
  test('control: no run, sample projectId + real coId → the paywall', async () => {
    await primeFreeWithSample();
    const tree = await open(`/change-order?projectId=${SAMPLE_ID}&coId=${REAL_CO_ID}`, null);
    expect(tree.queryByTestId('paywall-upgrade-btn')).not.toBeNull();
    expect(tree.queryByTestId('co-description-input')).toBeNull();
  });

  test('control: run live, real coId only → the paywall', async () => {
    await primeFreeWithSample();
    const tree = await open(`/change-order?coId=${REAL_CO_ID}`, 'invoice-to-self');
    expectRunLive('invoice-to-self');
    expect(tree.queryByTestId('paywall-upgrade-btn')).not.toBeNull();
    expect(tree.queryByTestId('co-description-input')).toBeNull();
  });

  test('the escape: run live, projectId=sample + a REAL coId → still the paywall, the real CO never renders', async () => {
    await primeFreeWithSample();
    const tree = await open(`/change-order?projectId=${SAMPLE_ID}&coId=${REAL_CO_ID}`, 'invoice-to-self');
    expectRunLive('invoice-to-self');
    expect(tree.queryByTestId('paywall-upgrade-btn')).not.toBeNull();
    expect(tree.queryByTestId('co-description-input')).toBeNull();
    expect(tree.queryByTestId('send-co-btn')).toBeNull();
  });

  test('field ticket escape: run live, projectId=sample + a REAL ticketId → gated, no price / bill-it', async () => {
    await primeFreeWithSample();
    const tree = await open(`/field-ticket?projectId=${SAMPLE_ID}&ticketId=${REAL_TICKET_ID}`, 'invoice-to-self');
    expectRunLive('invoice-to-self');
    expect(tree.queryByTestId('ticket-convert')).toBeNull();
    expect(tree.queryByTestId('ticket-price')).toBeNull();
    expect(tree.queryByText(/REAL extra outlet run/)).toBeNull();
  });

  test('field ticket control: no run, same link → gated', async () => {
    await primeFreeWithSample();
    const tree = await open(`/field-ticket?projectId=${SAMPLE_ID}&ticketId=${REAL_TICKET_ID}`, null);
    expect(tree.queryByTestId('ticket-convert')).toBeNull();
    expect(tree.queryByTestId('ticket-price')).toBeNull();
  });

  test('invoice: run live, projectId=sample + a REAL invoiceId → never the real invoice', async () => {
    await primeFreeWithSample();
    const tree = await open(`/invoice?projectId=${SAMPLE_ID}&invoiceId=${REAL_INV_ID}&type=progress`, 'invoice-to-self');
    expectRunLive('invoice-to-self');
    expect(tree.queryByText('Real work')).toBeNull();
  });

  test('the opt-in still works: punch-walk run live on the sample → walk mode opens there', async () => {
    await primeFreeWithSample();
    const tree = await open(`/punch-walk?projectId=${SAMPLE_ID}`, 'punch-walk');
    expectRunLive('punch-walk');
    expect(tree.queryByTestId('paywall-upgrade-btn')).toBeNull();
    expect(tree.queryByTestId('walk-save')).not.toBeNull();
  });

  test('…and only there: punch-walk run live, the REAL job → the paywall', async () => {
    await primeFreeWithSample();
    const tree = await open(`/punch-walk?projectId=${PROJECT_ID}`, 'punch-walk');
    expectRunLive('punch-walk');
    expect(tree.queryByTestId('paywall-upgrade-btn')).not.toBeNull();
    expect(tree.queryByTestId('walk-save')).toBeNull();
  });
  // A RESTORED run (web reload mid-tutorial) holds no pass, so the sample's
  // gated /invoice shows the wall. Its offer is his way back in: it must show,
  // say Resume, and resuming must open the editor on the sample.
  test('restored run on the sample /invoice → the wall offers Resume, and Resume opens the editor', async () => {
    await primeFreeWithSample();
    const tree = await mountRouteChecked('/');
    await settle();
    await act(async () => {
      dispatchTutorial({
        type: 'RESTORE',
        saved: { tutorialId: 'invoice-to-self', version: 1, stepIndex: 0, sandboxProjectId: SAMPLE_ID, entry: 'hub', returnTo: null, savedAt: Date.now() - 60_000 },
        sampleExists: true,
        now: Date.now(),
      } as never);
    });
    await act(async () => { router.push(`/invoice?projectId=${SAMPLE_ID}&type=progress` as never); });
    await settle();
    await settle();
    const s = getTutorialState();
    expect(s.status === 'running' && s.paused ? s.paused.reason : 'not restored').toBe('restored');
    expect(tree.queryByTestId('paywall-upgrade-btn')).not.toBeNull();
    const offer = tree.queryByTestId('paywall-practice-sample');
    expect(offer).not.toBeNull();
    expect(tree.queryByText('Resume the tutorial on the sample job')).not.toBeNull();
    await act(async () => { fireEvent.press(offer!); });
    await settle();
    await settle();
    const s2 = getTutorialState();
    expect(s2.status === 'running' ? (s2.paused ? s2.paused.reason : 'live') : s2.status).not.toBe('restored');
    expect(tree.queryByText('Send to me')).not.toBeNull();
  });
});

// Round 3: the same Resume offer on a wall that is NOT the run's checkpoint
// (a real job's /invoice, any /punch-list). The host pushes the sample screens,
// so the wall must pop first, or its <Modal visible> stays presented over the
// resumed tutorial (iOS pageSheet / RN-web portal) and 'Not now' pops the
// sample screen instead of the wall.
/* eslint-disable @typescript-eslint/no-explicit-any */
function restoreRun(tutorialId: RunId) {
  dispatchTutorial({
    type: 'RESTORE',
    saved: { tutorialId, version: 1, stepIndex: 0, sandboxProjectId: SAMPLE_ID, entry: 'hub', returnTo: null, savedAt: Date.now() - 60_000 },
    sampleExists: true,
    now: Date.now(),
  } as never);
}
/** Every route in the navigator tree, as `name:projectId`. */
function routesOf(tree: any): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    for (const r of n?.routes ?? []) {
      out.push(`${r.name}:${r.params?.projectId ?? r.params?.id ?? ''}`);
      if (r.state) walk(r.state);
    }
  };
  walk(tree.getRouterState?.());
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('practice pass — Resume off the checkpoint pops the wall first', () => {
  test.each([
    ['invoice-to-self', `/invoice?projectId=${PROJECT_ID}`, 'invoice', 'invoice'] as const,
    ['punch-walk', `/punch-list?projectId=${PROJECT_ID}`, 'punch-list', 'punch-walk'] as const,
  ])('restored %s run, a REAL job wall (%s) → Resume leaves no wall behind', async (id, url, wallRoute, sampleRoute) => {
    await primeFreeWithSample();
    const tree = await mountRouteChecked('/');
    await settle();
    await act(async () => { restoreRun(id); });
    await act(async () => { router.push(url as never); });
    await settle();
    await settle();
    expect(routesOf(tree)).toContain(`${wallRoute}:${PROJECT_ID}`);
    expect(tree.queryByText('Resume the tutorial on the sample job')).not.toBeNull();
    const offer = tree.queryByTestId('paywall-practice-sample');
    await act(async () => { fireEvent.press(offer!); });
    await settle();
    await settle();
    await settle();
    // The wall's screen has left the stack, and no Paywall is mounted anywhere.
    expect(routesOf(tree)).not.toContain(`${wallRoute}:${PROJECT_ID}`);
    expect(tree.queryAllByTestId('paywall-upgrade-btn', { includeHiddenElements: true })).toHaveLength(0);
    // …the sample screen is up, and the run resumed.
    expect(routesOf(tree)).toContain(`${sampleRoute}:${SAMPLE_ID}`);
    const s = getTutorialState();
    expect(s.status === 'running' ? (s.paused ? s.paused.reason : 'live') : s.status).toBe('live');
  });
});
