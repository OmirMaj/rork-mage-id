// validate-profit-leak.ts — unit tests for the Profit Leak faculty:
// scope summary, leak prompt, deterministic pricing, sub-bid check.
// Run via: bun run test:profit-leak
import { buildScopeSummary, MAX_SCOPE_CHARS } from '../utils/profitLeak/scopeSummary';
import type { ChangeOrder, ChangeOrderStatus, LinkedEstimateItem, Project } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}

// ── Fixtures ──
function li(materialId: string, category: string, name: string, unit: string, quantity: number, lineTotal: number, csiDivision?: string): LinkedEstimateItem {
  return { materialId, name, category, unit, quantity, unitPrice: quantity > 0 ? lineTotal / quantity : lineTotal, bulkPrice: 0, markup: 0, usesBulk: false, lineTotal, supplier: '', csiDivision };
}
function proj(items: LinkedEstimateItem[], over: Record<string, unknown> = {}): Project {
  return {
    id: 'P1', name: 'Henderson Kitchen', type: 'renovation', status: 'in_progress',
    squareFootage: 400, quality: 'standard', description: '',
    linkedEstimate: items.length > 0 ? {
      id: 'e1', items, globalMarkup: 20, baseTotal: 0, markupTotal: 0,
      grandTotal: items.reduce((s, it) => s + it.lineTotal, 0), createdAt: '2026-06-01',
    } : undefined,
    ...over,
  } as unknown as Project;
}
function co(number: number, description: string, status: ChangeOrderStatus): ChangeOrder {
  return {
    id: `co-${number}`, number, projectId: 'P1', date: '2026-07-01', description, reason: 'Field change',
    lineItems: [], originalContractValue: 0, changeAmount: 0, newContractTotal: 0, status,
    createdAt: '2026-07-01', updatedAt: '2026-07-01',
  };
}

const ITEMS = [
  li('m1', 'Electrical', 'Panel upgrade', 'ea', 1, 4200, '26'),
  li('m2', 'Framing', 'Wall framing', 'sf', 400, 4800, '06'),
];

console.log('\nprofitLeak buildScopeSummary:');

const scopeProj = proj(ITEMS, {
  scope: { projectType: 'renovation', sizeSqft: '400', location: '', quality: 'standard', scope: 'Full kitchen remodel per plans', timelineWeeks: '8', specialRequirements: 'Keep fridge circuit live', targetBudget: '', updatedAt: '2026-06-01' },
});
const cos = [co(1, 'Added exterior GFCI outlet', 'approved'), co(2, 'Skylight over island', 'rejected'), co(3, 'Extra pot lights', 'submitted')];
const summary = buildScopeSummary(scopeProj, cos);

expect('names the project', summary.includes('Henderson Kitchen'), true);
expect('groups items under the CSI division label', summary.includes('Div 26 — Electrical'), true);
expect('formats item as category — name (qty unit)', summary.includes('- Electrical — Panel upgrade (1 ea)'), true);
expect('includes the scope free text', summary.includes('Full kitchen remodel per plans'), true);
expect('includes special requirements', summary.includes('Keep fridge circuit live'), true);
expect('includes approved CO as already-approved addition', summary.includes('CO #1: Added exterior GFCI outlet'), true);
expect('excludes rejected CO', summary.includes('Skylight over island'), false);
expect('submitted CO appears as captured addition (not flaggable)', summary.includes('CO #3') && summary.includes('Extra pot lights'), true);
expect('says so when no line-item estimate exists', buildScopeSummary(proj([]), []).includes('No line-item estimate'), true);

// Truncation order: scope notes + COs survive even when estimate items are huge.
const bigItems = Array.from({ length: 400 }, (_, i) => li(`b${i}`, 'Finishes', `Very long descriptive line item name number ${i} with extra words`, 'sf', 10, 100, '09'));
const bigProj = proj(bigItems, {
  scope: { projectType: 'renovation', sizeSqft: '5000', location: '', quality: 'luxury', scope: 'Full house gut renovation', timelineWeeks: '52', specialRequirements: 'Keep master bath live', targetBudget: '', updatedAt: '2026-06-01' },
});
const bigCOs = [co(1, 'Owner-added wine cellar', 'approved')];
const bigSummary = buildScopeSummary(bigProj, bigCOs);
expect('caps output length when estimate is huge', bigSummary.length <= MAX_SCOPE_CHARS, true);
expect('approved CO always survives truncation', bigSummary.includes('Owner-added wine cellar'), true);
expect('scope notes always survive truncation', bigSummary.includes('Full house gut renovation'), true);
expect('truncated estimate items get a marker', bigSummary.includes('estimate items truncated') || bigSummary.length <= MAX_SCOPE_CHARS, true);
expect('never throws on a bare project', typeof buildScopeSummary({} as Project, []) === 'string', true);

import { buildLeakPrompt, coerceLeakResult, hashLeakText, LEAK_SCHEMA_HINT, MAX_LEAK_ITEMS } from '../utils/profitLeak/leakPrompt';

console.log('\nprofitLeak buildLeakPrompt:');

const report = {
  workPerformed: 'Framed pantry wall. Also trenched 40 lf for the new gas line the owner asked for.',
  issuesAndDelays: 'Inspector wants a second GFCI at the island.',
  materialsDelivered: ['40 lf gas pipe'],
};
const prompt = buildLeakPrompt(summary, report);

expect('prompt embeds the scope summary', prompt.includes('Henderson Kitchen'), true);
expect('prompt embeds work performed', prompt.includes('trenched 40 lf'), true);
expect('prompt embeds issues and delays', prompt.includes('second GFCI'), true);
expect('prompt embeds materials delivered', prompt.includes('40 lf gas pipe'), true);
expect('rule: compare only against provided scope', /ONLY against the scope provided/i.test(prompt), true);
expect('rule: approved additions are in scope', /already approved additions/i.test(prompt), true);
expect('rule: quote the exact report phrase', /exact phrase/i.test(prompt), true);
expect('rule: prefer empty over speculation', /empty items list over speculation/i.test(prompt), true);
expect('schema hint carries the item shape', Object.keys(LEAK_SCHEMA_HINT.items[0]).sort(), ['confidence', 'description', 'quantity', 'reportQuote', 'trade', 'unit']);

console.log('\nprofitLeak hashLeakText:');
expect('stable for identical input', hashLeakText('framed walls', 'none') === hashLeakText('framed walls', 'none'), true);
expect('changes when text changes', hashLeakText('framed walls', 'none') === hashLeakText('framed walls today', 'none'), false);
expect('ignores case and outer whitespace', hashLeakText('  Framed Walls ', 'None') === hashLeakText('framed walls', 'none'), true);
// Materials change must produce a different hash (finding #2 / #7)
expect('materials change → different hash', hashLeakText('framed walls', 'none', ['40 lf pipe']) === hashLeakText('framed walls', 'none', []), false);
expect('materials change → different hash (different delivery)', hashLeakText('framed walls', 'none', ['40 lf pipe']) === hashLeakText('framed walls', 'none', ['40 lf pipe', '10 bags cement']), false);
expect('same materials in same order → same hash', hashLeakText('framed walls', 'none', ['40 lf pipe']) === hashLeakText('framed walls', 'none', ['40 lf pipe']), true);
expect('no materials arg ≡ empty array', hashLeakText('framed walls', 'none') === hashLeakText('framed walls', 'none', []), true);

console.log('\nprofitLeak coerceLeakResult:');
const goodItem = { description: 'Gas line trench', trade: 'Plumbing', unit: 'lf', quantity: 40, confidence: 'high', reportQuote: 'trenched 40 lf' };
expect('accepts the {items:[...]} envelope', coerceLeakResult({ items: [goodItem] }).length, 1);
expect('accepts a bare array', coerceLeakResult([goodItem])[0].description, 'Gas line trench');
expect('fills defaults for missing fields', coerceLeakResult({ items: [{ description: 'Extra paint' }] })[0], { description: 'Extra paint', trade: 'General', unit: 'ls', quantity: 1, confidence: 'low', reportQuote: '' });
expect('drops items without a description', coerceLeakResult({ items: [{ trade: 'Electrical' }] }).length, 0);
expect('returns [] for junk input', coerceLeakResult('nope').length, 0);
expect('caps the item count', coerceLeakResult({ items: Array.from({ length: 25 }, (_, i) => ({ description: `x${i}` })) }).length, MAX_LEAK_ITEMS);

import { priceLeakItems } from '../utils/profitLeak/priceLeakItems';
import type { CostBookEntry, CostDatabase } from '../utils/costDatabase';

function entry(trade: string, unit: string, suggestedRate: number, confidence: CostBookEntry['confidence']): CostBookEntry {
  return {
    key: `${trade.toLowerCase()}|${unit.toLowerCase()}`, trade, unit,
    sampleCount: 5, jobCount: 5, personalRate: suggestedRate, variability: 0.1,
    bidBias: 0, baseline: suggestedRate, suggestedRate, confidence,
    totalActual: 1000, lastSeen: '2026-01-01', samples: [],
  };
}
function db(entries: CostBookEntry[]): CostDatabase {
  return { entries, jobsAnalyzed: 5, tradesTracked: entries.length, overallBidAccuracy: 0.9, asOf: '2026-01-01' };
}

console.log('\nprofitLeak priceLeakItems:');

const elecDb = db([entry('Electrical', 'ea', 400, 'high')]);
const priced = priceLeakItems([{ description: 'Extra cans', trade: 'Electrical', unit: 'ea', quantity: 3, confidence: 'medium', reportQuote: 'added 3 cans' }], elecDb);
expect('prices from history: rate × qty, rounded', priced[0].estimatedPrice, 1200);
expect('carries the rate used', priced[0].rateUsed, 400);
expect('carries the cost-book confidence', priced[0].rateConfidence, 'high');
expect('marks fromHistory', priced[0].fromHistory, true);

const noHist = priceLeakItems([{ description: 'Gas trench', trade: 'Plumbing', unit: 'lf', quantity: 40, confidence: 'high', reportQuote: 'trenched' }], elecDb);
expect('no history → null price (never invents a number)', noHist[0].estimatedPrice, null);
expect('no history → null rate confidence', noHist[0].rateConfidence, null);
expect('no history → fromHistory false', noHist[0].fromHistory, false);

const badQty = priceLeakItems([{ description: 'Panel work', trade: 'Electrical', unit: 'ea', quantity: NaN, confidence: 'low', reportQuote: '' }], elecDb);
expect('bad quantity clamps to 1', badQty[0].estimatedPrice, 400);
expect('empty input → empty output', priceLeakItems([], elecDb).length, 0);

import { checkSubBid, LOW_BAND, HIGH_BAND } from '../utils/profitLeak/subBidCheck';
import type { Commitment } from '../types';

function cmt(over: Partial<Commitment>): Commitment {
  return {
    id: 'c1', projectId: 'P1', number: 'C-1001', type: 'subcontract',
    description: 'Electrical rough-in', amount: 10000, signedDate: '2026-07-01',
    status: 'active', createdAt: '2026-07-01', updatedAt: '2026-07-01', ...over,
  };
}

console.log('\nprofitLeak checkSubBid (basis A — linked items):');

const projA = proj(ITEMS);                        // m1 4200 + m2 4800 = 9000 expected
const costDbA = db([entry('Electrical', 'ea', 4000, 'high')]);
const low = checkSubBid(cmt({ linkedEstimateItems: ['m1', 'm2'], amount: 7000 }), projA, costDbA);
expect('linked items → basis linked_items', low.basis, 'linked_items');
expect('expected = sum of linked lineTotals', low.expected, 9000);
expect('under 0.85× → low', low.verdict, 'low');
expect('gap = amount − expected', low.gap, -2000);
expect('exactly 0.85× → fair (band is strict)', checkSubBid(cmt({ linkedEstimateItems: ['m1', 'm2'], amount: 9000 * LOW_BAND }), projA, costDbA).verdict, 'fair');
expect('in-band → fair', checkSubBid(cmt({ linkedEstimateItems: ['m1', 'm2'], amount: 9000 }), projA, costDbA).verdict, 'fair');
expect('exactly 1.30× → fair (band is strict)', checkSubBid(cmt({ linkedEstimateItems: ['m1', 'm2'], amount: 9000 * HIGH_BAND }), projA, costDbA).verdict, 'fair');
expect('above 1.30× → high', checkSubBid(cmt({ linkedEstimateItems: ['m1', 'm2'], amount: 11701 }), projA, costDbA).verdict, 'high');
expect('low verdict carries a dollar sentence', low.detail.includes('$7,000') && low.detail.includes('$9,000'), true);

console.log('\nprofitLeak checkSubBid (basis B — trade match):');

const projB1 = proj([li('m1', 'Electrical', 'Panel upgrade', 'ea', 1, 4200, '26')]);
const b1 = checkSubBid(cmt({ csiDivision: '26', amount: 3000 }), projB1, costDbA);
expect('csiDivision match → basis trade_match', b1.basis, 'trade_match');
expect('expected uses the learned rate (4000), not lineTotal', b1.expected, 4000);
expect('3000 vs 4000 → low', b1.verdict, 'low');

const projB2 = proj([
  li('m1', 'Electrical', 'Panel upgrade', 'ea', 1, 4200, '26'),
  li('m3', 'Electrical', 'Trenching for service', 'lf', 100, 1500, '26'),
]);
const b2 = checkSubBid(cmt({ csiDivision: '26', amount: 5500 }), projB2, costDbA);
expect('no learned rate for a matched item → falls back to its lineTotal', b2.expected, 5500);
expect('mixed-basis in-band → fair', b2.verdict, 'fair');

const projB3 = proj([li('m4', 'Pool', 'Gunite pool', 'ls', 1, 30000)]);
const b3 = checkSubBid(cmt({ description: 'Pool package for backyard', amount: 20000 }), projB3, db([]));
expect('description keyword match when nothing classifies', b3.basis, 'trade_match');
expect('keyword-matched low bid flags', b3.verdict, 'low');

console.log('\nprofitLeak checkSubBid (unknown / never throws):');
expect('no estimate → unknown', checkSubBid(cmt({ linkedEstimateItems: ['m1'] }), proj([]), costDbA).verdict, 'unknown');
expect('zero amount → unknown', checkSubBid(cmt({ amount: 0 }), projA, costDbA).verdict, 'unknown');
expect('NaN amount → unknown (never throws)', checkSubBid(cmt({ amount: NaN }), projA, costDbA).verdict, 'unknown');
expect('no basis at all → unknown', checkSubBid(cmt({ description: 'Xyz misc package', amount: 5000 }), projB1, costDbA).verdict, 'unknown');

console.log('\nprofitLeak checkSubBid (basis A partial-link fallback — finding #1):');
// 3 links: m1 ($4200) + m2 ($4800) + m5 ($20000) = $28000 total, but m5 is missing from the estimate.
// The $28000 bid should NOT be flagged as 211% above the 2-item partial sum ($9000).
// Instead, the resolver must fall back to trade_match (basis B) or return unknown.
const projPartial = proj([
  li('m1', 'Electrical', 'Panel upgrade', 'ea', 1, 4200, '26'),
  li('m2', 'Electrical', 'Rough-in wire', 'lf', 400, 4800, '26'),
  // m5 ($20000) intentionally absent — simulates regenerated estimate with new materialIds
]);
const partialCheck = checkSubBid(
  cmt({ linkedEstimateItems: ['m1', 'm2', 'm5'], amount: 28000, csiDivision: '26' }),
  projPartial,
  db([entry('Electrical', 'ea', 4200, 'high')]),
);
expect('3 links / 1 missing → does NOT use partial sum as basis (must not be high from $9k)', partialCheck.verdict !== 'high' || partialCheck.basis !== 'linked_items', true);
expect('3 links / 1 missing → falls back to trade_match or unknown (not linked_items)', partialCheck.basis !== 'linked_items', true);
// When all links resolve, basis A still works normally
const allResolve = checkSubBid(
  cmt({ linkedEstimateItems: ['m1', 'm2'], amount: 7000 }),
  projPartial,
  costDbA,
);
expect('2 links / 2 resolved → basis linked_items still used', allResolve.basis, 'linked_items');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
