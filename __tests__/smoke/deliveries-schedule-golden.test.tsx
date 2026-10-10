/**
 * Smoke — Deliveries That Follow The Schedule (lane DELIVERIES-1), THE GOLDEN.
 *
 * The feature ships dark: constants/featureFlags.ts
 * DELIVERIES_FOLLOW_SCHEDULE_ENABLED is false and only the owner account
 * (utils/owner.ts) passes the gate. The fixture's contractor is NOT an owner
 * account, so this file renders what every customer sees.
 *
 * RECORDED ON THE UNTOUCHED SCREEN: the two snapshots below were written by
 * running this file against app/deliveries.tsx as it was on origin/main
 * (08b23f8d), BEFORE any lane edit. They are run with --ci and never
 * re-recorded: a diff here means a contractor with the feature off no longer
 * sees, byte for byte, what he saw before the lane.
 *
 *   a  phone 390 x 844: the whole Deliveries screen (one late load, one
 *      unconfirmed load due inside the confirm window, one confirmed load,
 *      one delivered load that the look-ahead leaves out)
 *   b  phone 390 x 844: the "Expecting a Delivery" sheet, opened
 *
 * The clock is pinned (MountOpts.now) so "3 days late" and "Due in 2d" do not
 * move with the day the suite runs.
 */

import { Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, act } from 'expo-router/testing-library';
import { cleanup } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import { GOLDEN_DELIVERIES, SCREEN_IDS, SHEET_IDS, smallestHolding, type Json } from '@/__tests__/helpers/deliveriesGolden';

// Noon local on a Wednesday: the same calendar day in every time zone the suite runs in.
const NOW = new Date(2026, 9, 14, 12, 0, 0).getTime();

function phone() {
  Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale: 1 }, screen: { width: 390, height: 844, scale: 3, fontScale: 1 } });
}

describe('Deliveries, flag off and not the owner account: the screen is what it was before the lane', () => {
  beforeEach(async () => {
    phone();
    await primeWorld('populated');
    await AsyncStorage.setItem('mageid_deliveries', JSON.stringify(GOLDEN_DELIVERIES));
  });
  afterEach(() => { cleanup(); });

  it('a. the whole screen', async () => {
    const tree = await mountRouteChecked(`/deliveries?projectId=${PROJECT_ID}`, { now: NOW });
    await settle();
    expect(tree.queryByText('Roof Trusses')).toBeTruthy();
    expect(tree.queryByText('3 days late')).toBeTruthy();
    const screen = smallestHolding(tree.toJSON() as Json, SCREEN_IDS);
    expect(screen).toBeTruthy();
    expect(screen).toMatchSnapshot();
  });

  it('b. the Expecting a Delivery sheet', async () => {
    const tree = await mountRouteChecked(`/deliveries?projectId=${PROJECT_ID}`, { now: NOW });
    await settle();
    await act(async () => { fireEvent.press(tree.getByLabelText('Add Delivery')); });
    await settle();
    expect(tree.queryByText('Expecting a Delivery')).toBeTruthy();
    const sheet = smallestHolding(tree.toJSON() as Json, SHEET_IDS);
    expect(sheet).toBeTruthy();
    expect(sheet).toMatchSnapshot();
  });
});
