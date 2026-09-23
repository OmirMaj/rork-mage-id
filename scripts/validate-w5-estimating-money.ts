// validate-w5-estimating-money.ts — wave 5, lane "estimating": the money
// findings, EXECUTED over the pure functions the screens ship.
//
//   #8   Drawing Analyzer "Use as starting point": the contingency row lands,
//        at his markup, footed to the cent; Append keeps the estimate's ratio.
//   #91  takeoff Replace / Append on the cent grid.
//   #10  decimal keypads: parseDecimalInput reads '7,5' as 7.5, never 75.
//   #90  Quick Quote text: cents, no "Most popular", no unstated licence /
//        insurance claim.
//   #55  the estimate email prints sell-basis quantities and totals only.
//
// Run: bun run scripts/validate-w5-estimating-money.ts

import {
  analyzerCostItems, appendAtEstimateRatio, buildNewEstimate, costItem,
  parseDecimalInput, pickEstimateProject, estimateProjectCandidates, takeoffCostItems,
} from '@/utils/estimateLanding';
import {
  buildQuickQuote, buildProposalTiers, proposalToShareText, quickQuoteTotals, licenseLine,
} from '@/utils/proposalBuilder';
import { buildEstimateEmailBody, footLines } from '@/utils/estimateEmailBody';
import { recomputeEstimate } from '@/utils/copilot/estimateEdit/estimateOps';
import type { LinkedEstimate, Project } from '@/types';

let pass = 0;
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
};
const ok = (name: string, cond: boolean, why = '') => {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
};
const onCents = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const sumLines = (e: LinkedEstimate) => Math.round(e.items.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
let n = 0;
const id = () => `id_${++n}`;

// ── #8 the Drawing Analyzer's result → the project's estimate ──────────────
console.log('\n#8 Drawing Analyzer "Use as starting point"');
{
  const lines = [
    { name: 'Framing', category: 'Framing', unit: 'LF', quantity: 1000, unitPrice: 60 },
    { name: 'Drywall', category: 'Drywall', unit: 'SF', quantity: 8000, unitPrice: 5 },
  ]; // subtotal 100,000
  const totals = { contingencyPercent: 10, contingencyAmount: 10_000 };
  const cost = analyzerCostItems(lines, totals, id);
  const cont = cost.find(i => i.category === 'Contingency');
  eq('the contingency the result card showed becomes its own LS line', cont && [cont.name, cont.unit, cont.quantity, cont.unitPrice, cont.lineTotal],
    ['Contingency (10%)', 'LS', 1, 10_000, 10_000]);
  const atCost = buildNewEstimate(cost, 0, 'e', '2026-09-23');
  eq('at a 0% markup the estimate is the AI starting figure — subtotal + contingency', [atCost.baseTotal, atCost.grandTotal], [110_000, 110_000]);
  const marked = buildNewEstimate(cost, 20, 'e', '2026-09-23');
  ok('at his 20% the grand total is >= 110,000 (the contingency is no longer dropped)', marked.grandTotal >= 110_000);
  eq('…cost stays in baseTotal, sell in grandTotal, markup the difference', [marked.baseTotal, marked.markupTotal, marked.grandTotal, marked.globalMarkup], [110_000, 22_000, 132_000, 20]);
  eq('…and Σ lineTotal === grandTotal to the cent', sumLines(marked), marked.grandTotal);
  ok('…every line carries his markup (none saved at cost)', marked.items.every(i => i.markup === 20));

  // A model line that IS contingency is dropped when totals carry one — no double charge.
  const withLine = analyzerCostItems(
    [...lines, { name: 'Contingency', category: 'Contingency', unit: 'LS', quantity: 1, unitPrice: 9_000 }],
    totals, id);
  eq('a model "Contingency" line is not charged on top of the totals contingency',
    withLine.filter(i => /contingency/i.test(i.category)).map(i => i.lineTotal), [10_000]);
  eq('each cost line is on the cent grid before any markup (123.45 SF × $3.33 → 411.09)',
    analyzerCostItems([{ name: 'Tile', category: 'Tile', unit: 'SF', quantity: 123.45, unitPrice: 3.33 }], { contingencyPercent: 0, contingencyAmount: 0 }, id)[0].lineTotal, 411.09);
  eq('no contingency in totals → no contingency row invented', analyzerCostItems(lines, { contingencyPercent: 0, contingencyAmount: 0 }, id).length, 2);

  // Awkward cents: a fractional contingency lands on the cent grid.
  const odd = buildNewEstimate(analyzerCostItems(
    [{ name: 'Tile', category: 'Tile', unit: 'SF', quantity: 123.45, unitPrice: 3.33 }],
    { contingencyPercent: 7.5, contingencyAmount: 30.831637 }, id), 18, 'e', 'x');
  ok('fractional amounts foot on the cent grid', odd.items.every(i => onCents(i.lineTotal)) && onCents(odd.grandTotal) && onCents(odd.baseTotal));
  eq('…Σ lineTotal === grandTotal', sumLines(odd), odd.grandTotal);
  const again = recomputeEstimate(odd as never) as unknown as LinkedEstimate;
  eq('…and the canonical recompute moves nothing', [again.baseTotal, again.grandTotal], [odd.baseTotal, odd.grandTotal]);
}

// ── Append keeps the existing estimate's ratio and its off-item add-ons ────
console.log('\nAppend at the existing estimate\'s own ratio (#8 / #91)');
{
  // 18% on $100,000, plus $2,000 of permits carried in markupTotal/grandTotal
  // but in no item's lineTotal — a retotal would wipe them.
  const existing: LinkedEstimate = {
    id: 'x', globalMarkup: 18, baseTotal: 100_000, markupTotal: 18_000, grandTotal: 120_000, createdAt: 'x',
    items: [{ materialId: 'm', name: 'Base', category: 'Framing', unit: 'ea', quantity: 1, unitPrice: 100_000, bulkPrice: 100_000, markup: 18, usesBulk: false, lineTotal: 118_000, supplier: '' }],
  };
  const add = [costItem({ id: 'a', name: 'Drywall', category: 'Drywall', unit: 'SF', quantity: 123.45, unitPrice: 3.33 })];
  const { next, addedBase, addedSell } = appendAtEstimateRatio(existing, add, null);
  eq('the new line is rounded to the cent at the estimate ratio', [next.items[1].lineTotal, addedBase, addedSell], [485.08, 411.09, 485.08]);
  eq('…the totals move by the rounded sums, permits kept', [next.baseTotal, next.markupTotal, next.grandTotal], [100_411.09, 18_073.99, 120_485.08]);
  const zeroBase: LinkedEstimate = { ...existing, items: [], baseTotal: 0, markupTotal: 0, grandTotal: 0 };
  eq('a degenerate estimate falls back to his answered markup', appendAtEstimateRatio(zeroBase, add, 20).next.grandTotal, 493.31);
  eq('…or to nothing when he has not answered (never a guessed 15%)', appendAtEstimateRatio(zeroBase, add, null).next.grandTotal, 411.09);
}

// ── #91 the takeoff's Replace ──────────────────────────────────────────────
console.log('\n#91 takeoff Replace on the cent grid');
{
  const est = buildNewEstimate(takeoffCostItems([
    { id: 'l1', description: 'Tile floor', csiDivision: '09 - Finishes', unit: 'SF', quantity: 123.45, unitPrice: 3.33 },
  ]), 18, 'e', 'x');
  eq('123.45 SF × $3.33 at 18% → lineTotal 485.08, baseTotal 411.09, grandTotal 485.08',
    [est.items[0].lineTotal, est.baseTotal, est.grandTotal], [485.08, 411.09, 485.08]);
  eq('…markupTotal is the rounded difference', est.markupTotal, 73.99);
  eq('…the item keeps its cost unit price and its CSI division', [est.items[0].unitPrice, est.items[0].csiDivision, est.items[0].supplier], [3.33, '09', 'AI Takeoff']);
  eq('an unanswered markup adds nothing (the at-cost band says so)', buildNewEstimate(est.items.map(i => ({ ...i, markup: 0, lineTotal: 411.09 })), null, 'e', 'x').grandTotal, 411.09);
}

// ── #87 which job a bare hub push opens on ─────────────────────────────────
console.log('\n#87 the default job');
{
  const est = (items: number): LinkedEstimate => ({ id: 'e', items: Array.from({ length: items }, (_, i) => ({ materialId: `m${i}`, name: 'x', category: 'x', unit: 'ea', quantity: 1, unitPrice: 1, bulkPrice: 1, markup: 0, usesBulk: false, lineTotal: 1, supplier: '' })), globalMarkup: 0, baseTotal: items, markupTotal: 0, grandTotal: items, createdAt: 'x' });
  const P = (id: string, updatedAt: string, items: number, status: Project['status'] = 'in_progress') =>
    ({ id, updatedAt, status, linkedEstimate: items >= 0 ? est(items) : null }) as unknown as Project;
  const projects = [P('old', '2026-01-01', 3), P('new', '2026-09-01', 2), P('empty', '2026-09-20', 0), P('none', '2026-09-22', -1), P('done', '2026-06-01', 4, 'completed')];
  eq('candidates: jobs with estimate lines, most recently updated first', estimateProjectCandidates(projects).map(p => p.id), ['new', 'done', 'old']);
  eq('estimate mode → the most recent job with estimate lines', pickEstimateProject(projects, 'estimate')?.id, 'new');
  eq('accuracy mode → the most recent completed/closed job with commitments', pickEstimateProject(projects, 'accuracy', [{ projectId: 'done' }, { projectId: 'new' }])?.id, 'done');
  eq('…else any job with commitments', pickEstimateProject(projects, 'accuracy', [{ projectId: 'old' }])?.id, 'old');
  eq('…else the most recent job with an estimate', pickEstimateProject(projects, 'accuracy', [])?.id, 'new');
  eq('no job has estimate lines → null (the screen offers "Build an estimate")', pickEstimateProject([P('a', 'x', 0), P('b', 'y', -1)]), null);
}

// ── #10 a decimal typed on a phone keypad ──────────────────────────────────
console.log('\n#10 parseDecimalInput');
{
  const cases: [string, number | null][] = [
    ['7.5', 7.5], ['7,5', 7.5], ['12,50', 12.5], ['$12.50', 12.5], ['12,500', 12_500], ['$1,234.56', 1234.56],
    ['1,234', 1234], ['3200,50', 3200.5], ['7%', 7], ['.5', 0.5], ['', null], ['abc', null], ['1,2,3', null],
    ['1,2345', null], ['12.5.1', null], ['1.234,56', null],
  ];
  for (const [input, want] of cases) eq(`'${input}' → ${want}`, parseDecimalInput(input), want);
}

// ── #90 the Quick Quote the client reads ───────────────────────────────────
console.log('\n#90 Quick Quote');
{
  const input = {
    clientName: 'Jane', jobTitle: 'Faucet swap',
    lineItems: [{ description: 'Labor', amount: 1000 }, { description: 'Fixture', amount: 1234.56 }],
    taxPct: 7,
  };
  const q = quickQuoteTotals(input);
  // The audit repro printed "$2,391.98" for this case; the arithmetic is
  // 1,000 + 1,234.56 = 2,234.56, + 7% tax 156.42 = 2,390.98.
  eq('$1,000 + $1,234.56 at 7% tax → $2,234.56 + $156.42 = $2,390.98', [q.subtotal, q.tax, q.total], [2234.56, 156.42, 2390.98]);
  const quote = buildQuickQuote(input);
  eq('the saved price is on the cent grid', quote.tiers[0].price, 2390.98);
  eq('the one option is not flagged "recommended" (nothing to be most popular among)', quote.tiers[0].recommended, false);
  const text = proposalToShareText(quote);
  ok('the text prints the total to the cent', text.includes('TOTAL — $2,390.98'), text);
  ok('…not a whole-dollar rounding', !/\$2,391\b/.test(text));
  ok('…says QUOTE, not PROPOSAL', text.startsWith('QUOTE — Faucet swap') && !/PROPOSAL/.test(text));
  ok('…no "★ Most popular" on the only option', !/Most popular/.test(text));
  ok('…no "Every option" multi-option footer', !/Every option/.test(text));
  ok('…one call to action', (text.match(/Reply to accept this quote\./g) ?? []).length === 1 && !/option that fits best/.test(text));
  ok('…the line items with their amounts', text.includes('Labor — $1,000.00') && text.includes('Fixture — $1,234.56'));
  ok('…and the tax it adds', text.includes('Sales tax (7%) — $156.42') && text.includes('Subtotal — $2,234.56'));
  ok('…no "licensed" or "insured" claim when he has saved no licence', !/licen[cs]ed|insured/i.test(text));
  ok('…no empty tagline line under the divider', !/──\n\n  •/.test(text));
  const withLic = proposalToShareText(quote, { licenseNumber: ' 123456 ' });
  ok('with a saved licence the text states HIS number', withLic.includes('License #123456') && !/insured/i.test(withLic));
  eq('licenseLine is null for a blank licence', [licenseLine(''), licenseLine(undefined), licenseLine('  ')], [null, null, null]);

  // Markup is folded into the lines, never printed as its own row.
  const mq = buildQuickQuote({ ...input, markupPct: 15, taxPct: 0 });
  const mt = proposalToShareText(mq);
  ok('a marked-up quote prints sell lines, no "Markup" row', mt.includes('Labor — $1,150.00') && mt.includes('Fixture — $1,419.74') && !/markup/i.test(mt));
  eq('…and they foot to the total', mq.quick?.total, 2569.74);
  const qt = quickQuoteTotals({ lineItems: input.lineItems, markupPct: 15, taxPct: 7 });
  eq('the screen breakdown foots: cost + markup + tax = total', Math.round((qt.costSubtotal + qt.markup + qt.tax) * 100) / 100, qt.total);

  // A quote saved before the breakdown existed still renders.
  const legacy = { ...quote, quick: undefined };
  ok('a legacy quick quote renders its descriptions and the total', /• Labor\n/.test(proposalToShareText(legacy)) && proposalToShareText(legacy).includes('TOTAL — $2,390.98'));

  // The tiered proposal: no unconditional licensed/insured claim either.
  const tiers = buildProposalTiers({ cost: 100_000, leads: [], typicalMarkup: 0.2 });
  ok('the tiered proposal no longer claims a "Licensed and insured crew"', !tiers.tiers.some(t => t.inclusions.some(i => /insured/i.test(i))));
  const tieredText = proposalToShareText({ id: 'p', clientName: 'J', tiers: tiers.tiers, status: 'draft', createdAt: 'x', updatedAt: 'x' });
  ok('…nor a "licensed, insured team" footer', !/licensed, insured/i.test(tieredText) && !/insured/i.test(tieredText));
  const licTiers = buildProposalTiers({ cost: 100_000, leads: [], typicalMarkup: 0.2, licenseNumber: 'CSLB 99' });
  ok('…and states HIS licence on Essential when saved', licTiers.tiers[0].inclusions.includes('Licensed contractor — License #CSLB 99'));
}

// ── #55 the estimate email ─────────────────────────────────────────────────
console.log('\n#55 estimate email body');
{
  // 10 EA at $42.00 cost + 25% markup; 8 hrs at $65.00/hr + 20%.
  const rows = [
    { name: 'Tile', qtyLabel: 'Qty: 10 EA', lineTotal: 42 * 1.25 * 10 },
    { name: 'Tile setter', qtyLabel: '8 hrs', lineTotal: 65 * 8 * 1.2 },
    { name: 'Odd', qtyLabel: 'Qty: 3 EA', lineTotal: 3.333333 * 3 },
  ];
  const grand = rows.reduce((s, r) => s + r.lineTotal, 0);
  const body = buildEstimateEmailBody({ companyName: 'GC Co', rows, grandTotal: grand });
  ok('no "Markup" field anywhere in the body', !/markup/i.test(body), body);
  ok('no cost-basis unit price ($42.00/EA, $65.00/hr)', !/\$42\.00/.test(body) && !/\$65\.00/.test(body));
  ok('no per-unit price at all (nothing that has to multiply out)', !/\/(EA|hr|SF|ea)\b/.test(body));
  const printed = [...body.matchAll(/Total: \$([\d,]+\.\d\d)/g)].map(m => Number(m[1].replace(/,/g, '')));
  const total = Number((body.match(/TOTAL: \$([\d,]+\.\d\d)/) ?? [])[1]?.replace(/,/g, ''));
  eq('the printed lines foot to the printed TOTAL, to the cent', Math.round(printed.reduce((s, x) => s + x, 0) * 100) / 100, total);
  eq('…which is the grand total', total, Math.round(grand * 100) / 100);
  // Three lines of $10.005 (float: 1000.5000…01 cents each): rounding each
  // line alone prints $30.03 of lines under a $30.02 TOTAL.
  const odd = buildEstimateEmailBody({ rows: [0, 1, 2].map(i => ({ name: `L${i}`, qtyLabel: 'Qty: 1 EA', lineTotal: 10.005 })), grandTotal: 30.015 });
  const oddLines = [...odd.matchAll(/\| Total: \$([\d,]+\.\d\d)/g)].map(m => Number(m[1]));
  eq('lines that each round down still foot to the TOTAL', [Math.round(oddLines.reduce((s, x) => s + x, 0) * 100) / 100, Number((odd.match(/TOTAL: \$([\d.]+)/) ?? [])[1])], [30.02, 30.02]);
  // Three lines that each round up: independent rounding would print 0.02 over.
  eq('footLines keeps Σ equal to the total when every line rounds the same way', footLines([0.005, 0.005, 0.005], 0.015).reduce((s, c) => s + c, 0), 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
