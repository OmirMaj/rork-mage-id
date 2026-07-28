// Client-estimate-view validation — utils/clientEstimateView.ts (pure, no RN imports).
//
// The client view is a SAFETY boundary: it must never leak the contractor's
// internal numbers (base cost, markup, margin, unit prices, suppliers) to a
// client. This validator guards:
//   1. projectTotal == grand total (what the client pays).
//   2. Scope groups sum EXACTLY to projectTotal (a fixed-price proposal must tie out).
//   3. Allowances come only from isAllowance items.
//   4. No forbidden internal key appears anywhere in the produced view.
//
// fileURLToPath because the repo path contains a space.

import { fileURLToPath } from 'node:url';
import { toClientEstimateView } from '@/utils/clientEstimateView';
import type { LinkedEstimate } from '@/types';

let failed = 0;
let passed = 0;
const assert = (c: boolean, m: string) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  FAIL  ' + m); } };

console.log('\nclient-estimate-view validation:');

// ── Fixture: $200k base + 25% markup = $250k grand total ────────────────────
const mkItem = (over: Partial<LinkedEstimate['items'][number]>) => ({
  materialId: 'm', name: 'Item', category: 'c', unit: 'ea', quantity: 1,
  unitPrice: 0, bulkPrice: 0, markup: 0, usesBulk: false, lineTotal: 0, supplier: 'ACME',
  ...over,
});

const est: LinkedEstimate = {
  id: 'e1',
  globalMarkup: 0.25,
  baseTotal: 200000,
  markupTotal: 50000,
  grandTotal: 250000,
  createdAt: '2026-07-27T00:00:00.000Z',
  items: [
    mkItem({ name: 'Foundations', csiDivision: '03', lineTotal: 100000 }),
    mkItem({ name: 'Slab on grade', csiDivision: '03', lineTotal: 50000 }),
    mkItem({ name: 'Electrical rough-in', csiDivision: '26', lineTotal: 40000 }),
    mkItem({ name: 'Tile', csiDivision: '09', lineTotal: 10000, isAllowance: true }),
  ],
};

const view = toClientEstimateView(est);

// 1. Project total is the grand total
assert(view.projectTotal === 250000, `projectTotal is the grand total (got ${view.projectTotal})`);

// 2. Groups sum EXACTLY to the project total (fixed-price proposal ties out)
const sum = view.scopeGroups.reduce((s, g) => s + g.total, 0);
assert(sum === view.projectTotal, `scope groups sum exactly to project total (got ${sum})`);

// Concrete (2 items) should be the largest group, markup baked in: 150000 * 1.25 = 187500
const concrete = view.scopeGroups.find(g => g.key === '03');
assert(!!concrete && concrete.total === 187500, `concrete group carries baked-in markup (got ${concrete?.total})`);
assert(view.scopeGroups.every(g => g.total > 0), 'no empty scope groups');
assert(view.scopeGroups.some(g => /concrete/i.test(g.label)), 'groups are labeled by division name');

// 3. Allowances only from isAllowance items, client price (markup baked in)
assert(view.allowances.length === 1, `one allowance item (got ${view.allowances.length})`);
assert(view.allowances[0]?.name === 'Tile' && view.allowances[0]?.amount === 12500, 'allowance shows client price');

// 4. No forbidden internal key anywhere in the view
const FORBIDDEN = ['markup', 'baseTotal', 'markupTotal', 'globalMarkup', 'unitPrice', 'bulkPrice', 'supplier', 'margin', 'usesBulk'];
const keys = new Set<string>();
const walk = (v: unknown) => {
  if (Array.isArray(v)) { v.forEach(walk); return; }
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) { keys.add(k); walk((v as Record<string, unknown>)[k]); } }
};
walk(view);
for (const f of FORBIDDEN) assert(!keys.has(f), `view never exposes internal key '${f}'`);

// 5. Degenerate: zero base total must not divide by zero
const empty = toClientEstimateView({ ...est, items: [], baseTotal: 0, markupTotal: 0, grandTotal: 0 });
assert(empty.projectTotal === 0 && empty.scopeGroups.length === 0, 'empty estimate is safe (no divide-by-zero)');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
