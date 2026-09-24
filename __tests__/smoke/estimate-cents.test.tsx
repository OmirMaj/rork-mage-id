/**
 * Render proof — the estimator's ONE CENT RULE and its market-change question,
 * mounted in the real app (founder, 2026-09-24: "Are estimates dynamic?? Went
 * up a cent after I left a material").
 *
 * The populated fixture seeds a cart priced from the base book (×1.00) while
 * the contractor's settings say Portland, OR. Before this change the estimator
 * silently re-snapshotted both rows to Portland prices on mount — the cart
 * total went from $1,049.04 to $1,153.97 with nothing on screen saying so
 * (golden recorded on the untouched screen). Now:
 *
 *   1. the rows keep the prices he saw, and a notice ASKS: "Reprice 2 lines
 *      for Portland? +$104.93", Keep / Reprice;
 *   2. the rows he sees add up to the footer and the Estimate Summary, to the
 *      cent, before and after he answers;
 *   3. Reprice moves the footer by exactly the amount the notice stated;
 *   4. Keep leaves every price alone and puts the question away.
 *
 * The arithmetic itself is proven on the shared functions by
 * scripts/validate-estimate-cents.ts; this proves the screen is wired to it.
 */

import { fireEvent } from 'expo-router/testing-library';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';

function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((n) => collectText(n, out)); return out; }
  const n = node as { children?: unknown; props?: { children?: unknown } };
  if (n.children) collectText(n.children, out);
  else if (n.props?.children !== undefined) collectText(n.props.children, out);
  return out;
}

type Tree = Awaited<ReturnType<typeof mountRouteChecked>>;
/** "$1,049.04" → 104904 */
const centsOf = (tree: Tree, testID: string): number => {
  const s = collectText(tree.getByTestId(testID)).join('');
  const m = s.match(/-?\$[\d,]+\.\d{2}/);
  if (!m) throw new Error(`${testID} printed no money: "${s}"`);
  return Math.round(Number(m[0].replace(/[$,]/g, '')) * 100);
};
// The fixture cart: 1/2" copper (p1) and 14/2 NM-B (e1).
const ROWS = ['cart-line-total-p1', 'cart-line-total-e1'];
const rowSum = (tree: Tree) => ROWS.reduce((s, id) => s + centsOf(tree, id), 0);

async function openEstimateSheet(): Promise<Tree> {
  await primeWorld('populated');
  const tree = await mountRouteChecked('/estimate/full');
  await settle();
  fireEvent.press(tree.getByTestId('cart-btn'));
  await settle();
  return tree;
}

describe('estimator — one cent rule and the market-change question', () => {
  it('asks before repricing, and the rows add up to the total before and after Reprice', async () => {
    const tree = await openEstimateSheet();

    // 1. Nothing was repriced on mount — the question is on screen instead.
    const notices = tree.getAllByTestId('reprice-notice');
    expect(notices.length).toBeGreaterThan(0);
    const noticeText = collectText(notices[0]).join('');
    expect(noticeText).toMatch(/2 lines in this estimate are priced\s*differently from the Portland price book/);
    const delta = noticeText.match(/\+\$([\d,]+\.\d{2})/);
    expect(delta).not.toBeNull();
    const deltaCents = Math.round(Number(delta![1].replace(/,/g, '')) * 100);

    // 2. The rows he sees ARE the total — footer and summary alike.
    const footerBefore = centsOf(tree, 'cart-footer-total');
    expect(footerBefore).toBe(104904); // the prices he priced at, not Portland's $1,153.97
    expect(rowSum(tree)).toBe(footerBefore);
    expect(centsOf(tree, 'summary-grand-total')).toBe(footerBefore);

    // 3. Reprice: the question goes, and the total moves by exactly what it said.
    fireEvent.press(tree.getAllByTestId('reprice-apply')[0]);
    await settle();
    expect(tree.queryAllByTestId('reprice-notice')).toHaveLength(0);
    const footerAfter = centsOf(tree, 'cart-footer-total');
    expect(footerAfter - footerBefore).toBe(deltaCents);
    expect(rowSum(tree)).toBe(footerAfter);
    expect(centsOf(tree, 'summary-grand-total')).toBe(footerAfter);
  });

  it('the labor pop-up previews the row it adds: Line Total === the cart row after Add', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked('/estimate/full');
    await settle();
    fireEvent.press(tree.getByText('Labor'));
    await settle();
    fireEvent.press(tree.getByLabelText(/^Carpenter, \$/));
    await settle();
    const preview = centsOf(tree, 'labor-popup-line-total');
    expect(preview).toBeGreaterThan(0);
    // With a markup on, the pop-up shows SELL and keeps the cost under it —
    // it used to print the cost, and the row after Add printed the sell.
    // (The estimator's default markup is 15%.)
    const cost = centsOf(tree, 'labor-popup-cost');
    expect(collectText(tree.getByTestId('labor-popup-cost')).join('')).toMatch(/\+15% O&P/);
    expect(preview).toBe(Math.round(cost * 1.15));
    fireEvent.press(tree.getByText('Add Labor'));
    await settle();
    fireEvent.press(tree.getByTestId('cart-btn'));
    await settle();
    expect(centsOf(tree, 'cart-labor-total-lab-carpenter')).toBe(preview);
    // …and the rows (materials + that labor row) still add up to the footer.
    expect(rowSum(tree) + preview).toBe(centsOf(tree, 'cart-footer-total'));
  });

  it('a kept line\'s pop-up prints the price it is kept at, and previews its own row', async () => {
    const tree = await openEstimateSheet();
    const rowBefore = centsOf(tree, 'cart-line-total-p1');
    fireEvent.press(tree.getByTestId('close-cart'));
    await settle();
    fireEvent.changeText(tree.getByTestId('search-input'), 'copper');
    await settle();
    fireEvent.press(tree.getByTestId('material-p1'));
    await settle();
    // The row is still at its earlier price (the question is unanswered), so
    // the pop-up says so, instead of printing Portland's prices over it.
    const note = collectText(tree.getByTestId('popup-kept-price-note')).join('');
    expect(note).toMatch(/Kept at its earlier price/);
    expect(note).toMatch(/The Portland price book reads/);
    // The qty is prefilled with the row's own, so Line Total IS the row.
    expect(centsOf(tree, 'popup-line-total')).toBe(rowBefore);
  });

  it('Keep leaves every price alone and puts the question away', async () => {
    const tree = await openEstimateSheet();
    const before = ROWS.map((id) => centsOf(tree, id));
    fireEvent.press(tree.getAllByTestId('reprice-keep')[0]);
    await settle();
    expect(tree.queryAllByTestId('reprice-notice')).toHaveLength(0);
    expect(ROWS.map((id) => centsOf(tree, id))).toEqual(before);
    expect(centsOf(tree, 'cart-footer-total')).toBe(104904);
  });
});
