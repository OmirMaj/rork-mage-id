/**
 * Smoke — Code Flags (lane CODEFLAGS), FLAG OFF, exactly as shipped.
 *
 * constants/featureFlags.ts CODE_FLAGS_ENABLED is false and nothing here
 * changes it. The same change order as code-flags.test.tsx (one line the rule
 * table knows, one ordinary line) is mounted in the real app:
 *
 *   1  no chip on either line, and no flag wording anywhere on the screen;
 *   2  the feature's modules are never loaded: components/codeFlags is
 *      replaced by a factory that throws, so the screen requiring it would
 *      fail this test;
 *   3  nothing is written under the feature's storage key.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { CODE_FLAGS_ENABLED } from '@/constants/featureFlags';

let mockLoads = 0;
jest.mock('@/components/codeFlags', () => {
  mockLoads += 1;
  throw new Error('components/codeFlags was loaded while CODE_FLAGS_ENABLED is false');
});

jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => ({
    screenSize: 'phone', isPhone: true, isTablet: false, isDesktop: false, width: 390, height: 844,
    contentMaxWidth: 390, sidebarWidth: 0, showSidebar: false, ganttRowHeight: 32,
  }),
}));

jest.setTimeout(180000);

// The fixture world's clock (the same instant the other change order suites pin).
const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
let nowSpy: jest.SpyInstance | null = null;
beforeEach(() => {
  jest.useRealTimers();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  allowConsoleErrors();
});
afterEach(() => {
  nowSpy?.mockRestore();
  nowSpy = null;
});

const CO_ID = 'co-cf-1';
const changeOrders = [{
  id: CO_ID,
  number: 1,
  projectId: PROJECT_ID,
  date: '2026-08-05T12:00:00.000Z',
  description: 'Garage power and a new counter',
  reason: 'Owner request',
  lineItems: [
    { id: 'coli-cf-1', name: 'Add subpanel in garage', description: '', quantity: 1, unit: 'ea', unitPrice: 1850, total: 1850, isNew: true },
    { id: 'coli-cf-2', name: 'Quartz countertop', description: '', quantity: 42, unit: 'sf', unitPrice: 95, total: 3990, isNew: true },
  ],
  originalContractValue: 155172,
  changeAmount: 5840,
  newContractTotal: 161012,
  scheduleImpactDays: 0,
  status: 'draft',
  createdAt: '2026-08-05T12:00:00.000Z',
  updatedAt: '2026-08-05T12:00:00.000Z',
}];

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

describe('Code Flags on a change order, flag off', () => {
  it('shows no chip and never loads the feature', async () => {
    expect(CODE_FLAGS_ENABLED).toBe(false);
    await primeWorld('populated');
    await AsyncStorage.setItem('mageid_change_orders', JSON.stringify(changeOrders));
    await mountRouteChecked(`/change-order?projectId=${PROJECT_ID}&coId=${CO_ID}`);
    await pump();

    expect(screen.getByTestId('co-number-label')).toBeTruthy();
    expect(screen.getByText('Add subpanel in garage')).toBeTruthy();
    expect(screen.queryByTestId('code-flag-coli-cf-1')).toBeNull();
    expect(screen.queryByTestId('code-flag-coli-cf-2')).toBeNull();
    expect(screen.queryByText(/Permit Amendment/)).toBeNull();
    expect(mockLoads).toBe(0);
    expect((await AsyncStorage.getAllKeys()).filter((k) => /code_flag/.test(k))).toEqual([]);
  });
});
