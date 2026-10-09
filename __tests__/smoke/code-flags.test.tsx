/**
 * Smoke — Code Flags (Big Bets, Bet 4, Phase 1; lane CODEFLAGS), FLAG ON.
 *
 * The feature ships dark: constants/featureFlags.ts CODE_FLAGS_ENABLED is
 * false. Here it is mocked ON, and the REAL change order screen is mounted in
 * the real app (mountRouteChecked) on a change order with two lines:
 *
 *   "Add subpanel in garage"      a kind of work the rule table knows
 *   "Quartz countertop"           an ordinary line
 *   "Paint trim at garage door"   words the lead rule reads in an older home
 *
 *   1  the first line shows the chip, the second shows nothing;
 *   2  with a flag on screen, Save and Send are exactly as enabled as before
 *      (the chip blocks nothing);
 *   3  tapping the chip opens the sheet: the family, the words that triggered
 *      it, the plain line that no section number is on file, the sentence
 *      that this place has no local rules (the fixture job is in Oregon), and
 *      the sentence that a line with no flag means nothing;
 *   4  "Hide This Flag" removes the chip and writes only the app-owned key;
 *   5  the change order in storage is byte for byte what was seeded: nothing
 *      of a flag is written onto the line.
 *   6  building age is ONE row for the page: nothing while no year is on
 *      file, one row once the home is on file as built in 1925, never a chip
 *      on the painted line, and its sheet says how many lines have the words.
 *
 * __tests__/smoke/code-flags-off.test.tsx mounts the same screen with the
 * flag as shipped. The pure rules are run under bun by
 * scripts/validate-code-flags.ts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { CODE_FLAG_DISMISS_KEY } from '@/utils/codeFlags/dismissCore';
import { NO_PLACE } from '@/utils/codeFlags/place';
import { publishCodeFlagContext } from '@/components/codeFlags/contextStore';

jest.mock('@/constants/featureFlags', () => {
  const mod = { ...jest.requireActual('@/constants/featureFlags') };
  Object.defineProperty(mod, 'CODE_FLAGS_ENABLED', { enumerable: true, get: () => true });
  return mod;
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
const FLAGGED = 'coli-cf-1';
const PLAIN = 'coli-cf-2';
const PAINT = 'coli-cf-3';
const changeOrders = [{
  id: CO_ID,
  number: 1,
  projectId: PROJECT_ID,
  date: '2026-08-05T12:00:00.000Z',
  description: 'Garage power and a new counter',
  reason: 'Owner request',
  lineItems: [
    { id: FLAGGED, name: 'Add subpanel in garage', description: '', quantity: 1, unit: 'ea', unitPrice: 1850, total: 1850, isNew: true },
    { id: PLAIN, name: 'Quartz countertop', description: '', quantity: 42, unit: 'sf', unitPrice: 95, total: 3990, isNew: true },
    { id: PAINT, name: 'Paint trim at garage door', description: '', quantity: 1, unit: 'ls', unitPrice: 0, total: 0, isNew: true },
  ],
  originalContractValue: 155172,
  changeAmount: 5840,
  newContractTotal: 161012,
  scheduleImpactDays: 0,
  status: 'draft',
  createdAt: '2026-08-05T12:00:00.000Z',
  updatedAt: '2026-08-05T12:00:00.000Z',
}];
const SEEDED = JSON.stringify(changeOrders);

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

async function mount() {
  await primeWorld('populated');
  await AsyncStorage.setItem('mageid_change_orders', SEEDED);
  await mountRouteChecked(`/change-order?projectId=${PROJECT_ID}&coId=${CO_ID}`);
  await pump();
}

const disabledOf = (testID: string): boolean => {
  const node = screen.getByTestId(testID);
  return !!(node.props.accessibilityState?.disabled ?? node.props.disabled);
};

describe('Code Flags on a change order, flag on', () => {
  it('flags the code-sensitive line, leaves the ordinary one alone, and blocks nothing', async () => {
    await mount();
    expect(screen.getByTestId('co-number-label')).toBeTruthy();

    // 1. One chip, on the right line.
    expect(screen.getByTestId(`code-flag-${FLAGGED}`)).toBeTruthy();
    expect(screen.queryByTestId(`code-flag-${PLAIN}`)).toBeNull();
    expect(screen.getByText('May Need a Permit Amendment or an Inspection')).toBeTruthy();

    // 2. Save and Send are not disabled by a flag.
    expect(disabledOf('save-co-draft')).toBe(false);
    expect(disabledOf('send-co-btn')).toBe(false);

    // 3. The sheet.
    await act(async () => { fireEvent.press(screen.getByTestId(`code-flag-${FLAGGED}`)); });
    await pump(2);
    expect(screen.getByText('Why This Line Has a Flag')).toBeTruthy();
    expect(screen.getByText('Electrical Service, Panels and Big New Loads')).toBeTruthy();
    expect(screen.getByText('These words on the line: subpanel.')).toBeTruthy();
    expect(screen.getByText('MAGE ID has no checked section number for this yet.')).toBeTruthy();
    expect(screen.getByText(/MAGE ID has no local rules for this place\. This is a general flag, with no section number and no local link\./)).toBeTruthy();
    expect(screen.getByText('A line with no flag can still need a permit or an inspection. No flag means nothing.')).toBeTruthy();
    expect(screen.getByText('A flag never stops you from saving, sending, signing or billing.')).toBeTruthy();
    expect(screen.queryByText(/nyc\.gov|baltimore/i)).toBeNull();
    expect(disabledOf('save-co-draft')).toBe(false);
    expect(disabledOf('send-co-btn')).toBe(false);

    // 4. Hide it.
    await act(async () => { fireEvent.press(screen.getByTestId(`code-flag-${FLAGGED}-sheet-hide`)); });
    await pump(2);
    expect(screen.queryByTestId(`code-flag-${FLAGGED}`)).toBeNull();
    const stored = JSON.parse((await AsyncStorage.getItem(CODE_FLAG_DISMISS_KEY)) ?? '{}');
    expect(stored.lines[`p:${PROJECT_ID}`][FLAGGED].families).toEqual(['electrical_service']);

    // 6. Building age: one row for the page, never a chip on a line.
    expect(screen.queryByTestId(`code-flag-${PAINT}`)).toBeNull();
    expect(screen.queryByTestId('code-flag-age-row')).toBeNull();
    await act(async () => { publishCodeFlagContext(PROJECT_ID, { place: NO_PLACE, yearBuilt: 1925, jobKind: 'residential' }); });
    await pump(2);
    expect(screen.getAllByTestId('code-flag-age-row')).toHaveLength(1);
    expect(screen.getByText('Check Building-Age Rules')).toBeTruthy();
    expect(screen.queryByTestId(`code-flag-${PAINT}`)).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('code-flag-age-row')); });
    await pump(2);
    expect(screen.getByText('Building-Age Rules')).toBeTruthy();
    expect(screen.getByText('Lead-Safe Work in an Older Home')).toBeTruthy();
    expect(screen.getByText('These words, on 1 of the lines: paint, door, trim.')).toBeTruthy();
    expect(disabledOf('save-co-draft')).toBe(false);
    expect(disabledOf('send-co-btn')).toBe(false);

    // 5. The change order itself was never touched.
    expect(await AsyncStorage.getItem('mageid_change_orders')).toBe(SEEDED);
    expect(SEEDED).not.toMatch(/flag/i);
  });
});
