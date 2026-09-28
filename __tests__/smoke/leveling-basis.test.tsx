/**
 * T7 — bid leveling labels numbers that are not from the GC's book.
 * BEHAVIOUR ONLY, no snapshot.
 *
 * Two bids whose SAVED reasons carry the labels the honesty pass writes
 * (utils/levelingBasis): a fresh mount is exactly a reload, so what shows
 * here is what the contractor sees the next day, with no session state.
 *   • /bid-leveling: "Not from your book" and "Needs price" chips, the ranking
 *     note, and no winner claimed while the would-be winner's exclusion needs
 *     a price.
 *   • /buyout-package: the same labels on the adjustment reasons.
 *   • (round 2) /buyout-package: a needs-price bid has no Award and no leveled
 *     total — "Set your price" instead; saving his price labels it "Your
 *     price" and brings Award back at the leveled total with his number.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import { NEEDS_PRICE_TAG, NOT_FROM_BOOK_TAG } from '@/utils/levelingBasis';

const T = '2026-08-01T12:00:00.000Z';
const PKG = {
  projectId: PROJECT_ID, createdAt: T, updatedAt: T, id: 'pkg-t7-plumb', name: 'Plumbing rough-in', phase: 'Rough-in',
  csiDivision: '22', scopeDescription: '• Plumbing rough + trim — 1 LS', linkedEstimateItemIds: [], estimateBudget: 16000,
  status: 'leveling',
};
const bidBase = { createdAt: T, updatedAt: T, submittedAt: T, source: 'manual', packageId: PKG.id, status: 'received' };
const BIDS = [
  { ...bidBase, id: 'bid-t7-1', vendorName: "Joe's Plumbing", amount: 14800, includes: 'Rough + trim, permits',
    excludes: 'Fixtures', normalizedAdjustment: 1200, normalizedAdjustmentReason: `${NOT_FROM_BOOK_TAG}Fixtures, a typical allowance.` },
  { ...bidBase, id: 'bid-t7-2', vendorName: 'Ace Mechanical', amount: 15000, includes: 'Rough + trim, fixtures',
    excludes: 'Permits', normalizedAdjustment: 0, normalizedAdjustmentReason: `${NEEDS_PRICE_TAG}Permits excluded; Bid 1 includes them.` },
];

beforeEach(async () => {
  await primeWorld('populated');
  await AsyncStorage.setItem('mageid_bid_packages', JSON.stringify([PKG]));
  await AsyncStorage.setItem('mageid_bid_package_bids', JSON.stringify(BIDS));
});

function textOf(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => textOf(n, out)); return out; }
  const c = (node as { children?: unknown }).children;
  if (c) textOf(c, out);
  return out;
}

describe('bid leveling — the saved basis label', () => {
  it('/bid-leveling shows the saved labels, the ranking note, and calls no winner', async () => {
    const tree = await mountRouteChecked(`/bid-leveling?packageId=${PKG.id}`);
    expect(within(screen.getByTestId('leveling-basis-bid-t7-1')).getByText('Not from your book')).toBeTruthy();
    expect(within(screen.getByTestId('leveling-basis-bid-t7-2')).getByText('Needs price')).toBeTruthy();
    const text = textOf(tree.toJSON()).join('\n');
    const note = String(screen.getByTestId('leveling-note').props.children);
    expect(note).toContain('Ranking uses 1 amount not from your book.');
    expect(note).toContain('1 exclusion needs your price before this ranking is complete.');
    // Leveled: Joe $16,000, Ace $15,000 — Ace would win, but its exclusion needs a price.
    expect(text).toContain('Close call until you price the exclusion');
    // The prefix is a label, not part of the words shown after "leveled:".
    expect(text).not.toContain(`leveled: ${NOT_FROM_BOOK_TAG}`);
    expect(text).not.toContain('AI draft');
  });

  it('/buyout-package renders the same labels on the adjustment reasons', async () => {
    const tree = await mountRouteChecked(`/buyout-package?packageId=${PKG.id}`);
    expect(screen.getByTestId('leveling-basis-bid-t7-1').props.children).toBe('Not from your book');
    expect(screen.getByTestId('leveling-basis-bid-t7-2').props.children).toBe('Needs price');
    const text = textOf(tree.toJSON()).join('\n');
    expect(text).toContain('Not from your book');
    expect(text).toContain('Needs price');
    expect(text).toContain('Fixtures, a typical allowance.');
    expect(text).not.toContain(NOT_FROM_BOOK_TAG + 'Fixtures');
  });

  it('/buyout-package: a needs-price bid cannot be awarded until you set your price', async () => {
    const tree = await mountRouteChecked(`/buyout-package?packageId=${PKG.id}`);
    // The priced bid keeps Award; the needs-price bid gets the unlock instead.
    expect(screen.queryByTestId('leveling-set-price-bid-t7-1')).toBeNull();
    expect(screen.getByTestId('leveling-set-price-bid-t7-2')).toBeTruthy();
    const before = textOf(tree.toJSON()).join('\n');
    expect(before).toContain('Set your price for the excluded scope');
    // Ace $15,000 + a 0 placeholder is NOT offered as a leveled total or an
    // Award: only Joe's bid carries Award.
    expect(before).toMatch(/Leveled total\nNeeds price/);
    expect(before.match(/^Award /gm)?.length).toBe(1);
    await act(async () => { fireEvent.press(screen.getByTestId('leveling-set-price-bid-t7-2')); });
    await settle();
    expect(textOf(tree.toJSON()).join('\n')).toContain('Your price for Permits *');
    await act(async () => { fireEvent.changeText(screen.getByTestId('bid-amount-input'), '750.50'); });
    await act(async () => { fireEvent.press(screen.getByTestId('bid-amount-save')); });
    await settle();
    expect(screen.queryByTestId('leveling-set-price-bid-t7-2')).toBeNull();
    expect(screen.getByTestId('leveling-basis-bid-t7-2').props.children).toBe('Your price');
    const after = textOf(tree.toJSON()).join('\n');
    // $15,000 + $750.50, shown to the dollar like every leveled total and Award.
    expect(after).toMatch(/Leveled total\n\$15,751\n/);
    expect(after.match(/^Award /gm)?.length).toBe(2);
    const saved = JSON.parse((await AsyncStorage.getItem('mageid_bid_package_bids')) ?? '[]') as { id: string; normalizedAdjustment?: number; normalizedAdjustmentReason?: string }[];
    const ace = saved.find(b => b.id === 'bid-t7-2');
    expect(ace?.normalizedAdjustment).toBe(750.5);
    expect(ace?.normalizedAdjustmentReason).toBe('Your price: Permits');
  });
});

// Integration round 3 (onto main): (a) the needs-price 0 is a placeholder, so
// no screen prints a number built on it; (b) "Nothing extra" is a reachable
// answer — a button, or 0 typed into the price field and confirmed.
describe('bid leveling — a needs-price bid is never a number, and "Nothing extra" answers it', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  const lines = (tree: { toJSON: () => unknown }) => textOf(tree.toJSON()).join('\n');

  it('/bid-leveling: no "as bid", no vs-budget, no leveled amount or "under budget" for the needs-price would-be winner', async () => {
    const tree = await mountRouteChecked(`/bid-leveling?packageId=${PKG.id}`);
    const text = lines(tree);
    // Ace $15,000 + a 0 placeholder would print "$15,000 leveled", "$1,000 under
    // budget.", "as bid" and "−$1,000 vs budget". None of it is a price.
    expect(text).not.toMatch(/^\$15,000$/m);
    expect(text).not.toMatch(/^leveled$/m);
    expect(text).not.toContain('under budget');
    expect(text).not.toContain('as bid');
    expect(text.match(/vs budget/g)?.length).toBe(1); // Joe's row only
    expect(screen.getByTestId('leveling-needs-price-bid-t7-2').props.children).toBe('Needs price');
    expect(text).toContain('$15,000 bid + the excluded scope');
    // The close call is called a close call — no "Best value" badge on Ace.
    expect(text).toContain('Close call until you price the exclusion');
    expect(text).not.toMatch(/^Best value$/m);
    // The spread is not measured off the placeholder: one known leveled cost.
    expect(text).not.toMatch(/Field spread\n\$1,000/);
  });

  it('/buyout-package: a needs-price bid never wears "Lowest"', async () => {
    const tree = await mountRouteChecked(`/buyout-package?packageId=${PKG.id}`);
    expect(lines(tree)).not.toMatch(/^Lowest$/m);
  });

  it('/buyout-package: the outlier median is taken over known leveled costs only', async () => {
    // A needs price at $8,000; B $16,000 and C $19,000 are known. With A's 0
    // placeholder in the median ($16,000), C reads "19% HIGH" and A "50% LOW".
    await AsyncStorage.setItem('mageid_bid_package_bids', JSON.stringify([
      { ...bidBase, id: 'bid-o-a', vendorName: 'Alpha Framing', amount: 8000, excludes: 'Blocking', normalizedAdjustment: 0, normalizedAdjustmentReason: `${NEEDS_PRICE_TAG}Blocking, unclear.` },
      { ...bidBase, id: 'bid-o-b', vendorName: 'Beta Framing', amount: 16000 },
      { ...bidBase, id: 'bid-o-c', vendorName: 'Gamma Framing', amount: 19000 },
    ]));
    const tree = await mountRouteChecked(`/buyout-package?packageId=${PKG.id}`);
    const text = lines(tree);
    expect(text).not.toMatch(/% (?:LOW|HIGH)$/m);
    // Beta is the lowest KNOWN leveled cost of two.
    expect(text).toMatch(/Beta Framing\nLowest/);
  });

  it('/buyout-package: "Nothing extra" records the answer; Award returns at the bid amount', async () => {
    const tree = await mountRouteChecked(`/buyout-package?packageId=${PKG.id}`);
    await act(async () => { fireEvent.press(screen.getByTestId('leveling-set-price-bid-t7-2')); });
    await settle();
    await act(async () => { fireEvent.press(screen.getByTestId('bid-price-nothing-extra')); });
    await settle();
    expect(screen.queryByTestId('leveling-set-price-bid-t7-2')).toBeNull();
    expect(screen.getByTestId('leveling-basis-bid-t7-2').props.children).toBe('Your price');
    const after = lines(tree);
    expect(after).toContain('Nothing extra for Permits');
    expect(after).toMatch(/Leveled total\n\$15,000\n/);
    // Award is back, at the bid amount (the Award label and its amount are two text runs).
    expect(after).toMatch(/^Award .*\n\$15,000$/m);
    expect(after.match(/^Award /gm)?.length).toBe(2);
    const saved = JSON.parse((await AsyncStorage.getItem('mageid_bid_package_bids')) ?? '[]') as { id: string; normalizedAdjustment?: number; normalizedAdjustmentReason?: string }[];
    const ace = saved.find(b => b.id === 'bid-t7-2');
    expect(ace?.normalizedAdjustment).toBe(0);
    expect(ace?.normalizedAdjustmentReason).toBe('Your price: Nothing extra for Permits');
  });

  it('/buyout-package: typing 0 asks to confirm "Nothing extra", then records it', async () => {
    const asked: string[] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((title, _msg, buttons) => {
      asked.push(String(title));
      const yes = (buttons ?? []).find(b => b.text === 'Nothing extra');
      yes?.onPress?.();
    });
    const tree = await mountRouteChecked(`/buyout-package?packageId=${PKG.id}`);
    await act(async () => { fireEvent.press(screen.getByTestId('leveling-set-price-bid-t7-2')); });
    await settle();
    await act(async () => { fireEvent.changeText(screen.getByTestId('bid-amount-input'), '0.00'); });
    await act(async () => { fireEvent.press(screen.getByTestId('bid-amount-save')); });
    await settle();
    expect(asked).toContain('Nothing extra?');
    expect(asked).not.toContain('Needs an amount');
    expect(screen.getByTestId('leveling-basis-bid-t7-2').props.children).toBe('Your price');
    expect(lines(tree)).toMatch(/^Award .*\n\$15,000$/m);
  });
});
