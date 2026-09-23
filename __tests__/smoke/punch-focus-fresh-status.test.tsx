// Smoke: the "ready for review" notification tap lands on the item's FRESH
// status (punch-gc, wave 4, review round 2).
//
// The screen is mounted once (the launch copy says punch-1 is Open), the
// server copy then moves punch-1 to Ready for Review with a sub's note, and
// the notification route is pushed. The focus must filter to Review and show
// the row — not filter to Open from a stale ['punchItems', null] cache entry
// the provider left behind before auth resolved (the round-2 bug: "Nothing
// matches those filters", no row, no banner).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID } from '@/__tests__/fixtures/world';

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

describe('punch-list notification focus', () => {
  beforeEach(async () => { await primeWorld('populated'); });
  jest.setTimeout(40000);

  it('focuses the item under its fresh status (Review), with the sub note', async () => {
    await mountRouteChecked(`/punch-list?projectId=${PROJECT_ID}`);
    await pump();
    const raw = await AsyncStorage.getItem('mageid_punch_items');
    const parsed = JSON.parse(raw!);
    const list = Array.isArray(parsed) ? parsed : parsed.data;
    const next = list.map((p: { id: string }) => (p.id === 'punch-1'
      ? { ...p, status: 'ready_for_review', subNote: 'Rerolled the wall, SMOKE-SUBNOTE' }
      : p));
    await AsyncStorage.setItem('mageid_punch_items', JSON.stringify(next));

    await act(async () => { router.push(`/punch-list?projectId=${PROJECT_ID}&itemId=punch-1`); });
    await pump(10);
    await settle();
    await pump(10);

    expect(screen.queryByTestId('punch-focused-item')).toBeTruthy();
    expect(screen.queryByTestId('punch-focus-refreshing')).toBeNull();
    expect(screen.queryByTestId('punch-focus-missing')).toBeNull();
    expect(screen.queryAllByText(/Touch-up paint at dining room/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/SMOKE-SUBNOTE/).length).toBeGreaterThan(0);
    // Filtered to Review: an Open item on the same list is not shown.
    expect(screen.queryAllByText(/Undercabinet light dimmer/).length).toBe(0);
  });
});
