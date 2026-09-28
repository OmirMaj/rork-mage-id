/**
 * "Client approved without signing" on the REAL change-order screen
 * (wave-next W2 integration, critic 2 issue 8).
 *
 * THE PROMISE THIS PROVES
 *   The button used to approve on an Alert's tap: updateChangeOrder, then
 *   nailIt("CO #n approved, unsigned") before any write was confirmed. It is
 *   now the SAME slide as every approve: the tap only opens the approve sheet
 *   (the #79 money line, "there is no client signature on this path"); no
 *   Alert, no toast, no write. The slide writes the approval through
 *   ProjectContext.approveChangeOrder with the #131 tax freeze IN that status
 *   write, nothing shows as approved while the write is out, and only the
 *   confirmed answer plays, marked "unsigned".
 *
 * Mounted inside the real app (the provider stack, the populated fixture
 * world, 390 x 844 iOS). Only the change_orders write is shaped (a spy on the
 * queue's supabaseWriteDetailed that answers when told to).
 */

import { Alert, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, configure, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import * as offlineQueue from '@/utils/offlineQueue';
import { supabase } from '@/lib/supabase';

// The capsule's decorative text (label, result) is hidden from the a11y tree on purpose.
configure({ defaultIncludeHiddenElements: true });

jest.mock('@/components/moments/core/useScreenReaderMode', () => ({ useScreenReaderMode: () => true }));
jest.mock('@/utils/moments/haptics', () => ({ momentHaptic: jest.fn(), announce: jest.fn() }));
const mockNailIt = jest.fn();
jest.mock('@/components/animations/NailItToast', () => {
  const actual = jest.requireActual('@/components/animations/NailItToast');
  return { ...actual, nailIt: (...a: unknown[]) => mockNailIt(...a) };
});
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => ({
    screenSize: 'phone', isPhone: true, isTablet: false, isDesktop: false,
    width: 390, height: 844, contentMaxWidth: 390, sidebarWidth: 0, showSidebar: false, ganttRowHeight: 32,
  }),
}));

const CO_ID = 'co-unsigned-7';
const SUBMITTED = {
  id: CO_ID, number: 7, projectId: PROJECT_ID, date: '2026-09-20T12:00:00.000Z',
  description: 'Add a pantry cabinet run', reason: 'Owner request',
  lineItems: [{ id: 'l1', name: 'Pantry cabinets', description: '', quantity: 1, unit: 'ea', unitPrice: 4200, total: 4200, isNew: true }],
  originalContractValue: 48000, changeAmount: 4200, newContractTotal: 52200, scheduleImpactDays: 0,
  status: 'submitted', createdAt: '2026-09-20T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z',
};

/** The same CO as the server row the change-order list reads (a synced CO is on the server too). */
const SERVER_ROW = {
  id: SUBMITTED.id, number: SUBMITTED.number, project_id: SUBMITTED.projectId, date: SUBMITTED.date,
  description: SUBMITTED.description, reason: SUBMITTED.reason, line_items: SUBMITTED.lineItems,
  original_contract_value: SUBMITTED.originalContractValue, change_amount: SUBMITTED.changeAmount,
  new_contract_total: SUBMITTED.newContractTotal, status: SUBMITTED.status, schedule_impact_days: 0,
  created_at: SUBMITTED.createdAt, updated_at: SUBMITTED.updatedAt,
};
// The repo mock answers every SELECT empty, and an empty answer to the live
// bearer is the server's truth (the list is cleared). Answer the change_orders
// list with the synced CO; everything else stays the mock's.
const sb = supabase as unknown as { from: (t: string) => unknown };
const origFrom = sb.from;
function serveChangeOrder() {
  sb.from = (t: string) => {
    const b = origFrom.call(sb, t) as object;
    if (t !== 'change_orders') return b;
    return new Proxy(b, {
      get(target, prop) {
        if (prop !== 'select') return Reflect.get(target, prop);
        return () => {
          const res = Promise.resolve({ data: [SERVER_ROW], error: null, count: 1, status: 200, statusText: 'OK' });
          const chain: Record<string, unknown> = {};
          for (const m of ['order', 'eq', 'in', 'limit', 'neq', 'is']) chain[m] = () => chain;
          chain.then = res.then.bind(res);
          return chain;
        };
      },
    });
  };
}

async function pump(n = 4) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      try { jest.advanceTimersByTime(250); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  jest.useRealTimers();
  allowConsoleErrors();
  mockNailIt.mockClear();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  Dimensions.set({ window: { width: 390, height: 844, scale: 2, fontScale: 1 }, screen: { width: 390, height: 844, scale: 2, fontScale: 1 } });
});
afterEach(() => {
  sb.from = origFrom;
  alertSpy.mockRestore();
  jest.restoreAllMocks();
});

describe('"Client approved without signing" is the approve slide', () => {
  jest.setTimeout(120000);

  it('the tap only OPENS the sheet; the slide writes the approval with the tax freeze; nothing says approved until the write is confirmed, then "unsigned"', async () => {
    let answer: (o: 'synced' | 'queued' | 'failed') => void = () => {};
    const coWrites: Record<string, unknown>[] = [];
    const real = offlineQueue.supabaseWriteDetailed;
    jest.spyOn(offlineQueue, 'supabaseWriteDetailed').mockImplementation(((table: string, op: string, data: Record<string, unknown>, opts?: unknown) => {
      if (table === 'change_orders' && op === 'update' && data.status === 'approved' && coWrites.length === 0) {
        coWrites.push(data);
        return new Promise((res) => { answer = res; });
      }
      return real(table, op as never, data, opts as never);
    }) as typeof offlineQueue.supabaseWriteDetailed);

    await primeWorld('populated');
    await AsyncStorage.setItem('mageid_change_orders', JSON.stringify([SUBMITTED]));
    serveChangeOrder();
    await mountRouteChecked(`/change-order?projectId=${PROJECT_ID}&coId=${CO_ID}`);
    for (let i = 0; i < 30 && !screen.queryByTestId('co-approve-unsigned-btn'); i++) await pump(1);

    await act(async () => { fireEvent.press(screen.getByTestId('co-approve-unsigned-btn')); });
    await pump(2);
    // The old path asked in an Alert and approved + toasted on its button.
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockNailIt).not.toHaveBeenCalled();
    expect(coWrites).toHaveLength(0);
    // The approve sheet is up: the #79 money line, then the slide.
    expect(screen.getByText(/there is no client signature on this path/)).toBeTruthy();

    fireEvent(screen.getByTestId('co-approve-slide-track'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 358, height: 64 } } });
    await pump(1);
    await act(async () => {
      fireEvent(screen.getByTestId('co-approve-slide-rail'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    });
    await pump(2);
    await act(async () => { fireEvent.press(screen.getByTestId('co-approve-slide-confirm')); });
    for (let i = 0; i < 20 && coWrites.length === 0; i++) await pump(1);

    // The approval's own status write carries the #131 freeze.
    expect(coWrites).toHaveLength(1);
    expect(coWrites[0].id).toBe(CO_ID);
    expect(coWrites[0]).toEqual(expect.objectContaining({ status: 'approved', tax_rate_pct: expect.any(Number), total_with_tax: expect.any(Number) }));
    // The write is out: nothing says approved yet.
    expect(screen.queryByTestId('co-approve-slide-result')).toBeNull();
    expect(mockNailIt).not.toHaveBeenCalled();

    // Confirmed: only now the result, marked unsigned.
    await act(async () => { answer('synced'); });
    let seen: string | null = null;
    for (let i = 0; i < 30 && seen == null; i++) {
      const el = screen.queryByTestId('co-approve-slide-result');
      if (el) seen = ([] as unknown[]).concat(el.props.children).join('');
      else await pump(1);
    }
    expect(seen).toMatch(/^CO #\d+ approved, unsigned · /);
    expect(mockNailIt).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
