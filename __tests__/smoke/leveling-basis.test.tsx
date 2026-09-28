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
