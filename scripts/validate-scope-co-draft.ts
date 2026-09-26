// scripts/validate-scope-co-draft.ts
//
// Step-3 L1: the shared draft-CO builder (utils/brain/scopeCoDraft) used by
// Scope Code Gaps and the RFI scope check. Integer cents, draft-forever, the
// dedupe marker, the internal note that never reaches the client, and no
// invented quantity.
// Pure — no React, no network, no AsyncStorage. Exits non-zero on failure.

import {
  buildScopeCoDraft, findScopeDraft, toCents, CODE_GAP_DRAFT_ACTION, RFI_DRAFT_ACTION,
  type ScopeCoDraftInput,
} from '../utils/brain/scopeCoDraft';
import { nextChangeOrderNumber } from '../utils/coNumbering';
import type { ChangeOrder, Project } from '../types';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { console.log(`  PASS ${label}`); passed++; } else { console.error(`  FAIL ${label}`); failed++; }
}

const NOW = '2026-09-26T14:00:00.000Z';
const project = { id: 'p1', linkedEstimate: { grandTotal: 50000.1 } } as unknown as Pick<Project, 'id' | 'linkedEstimate' | 'estimate'>;

function co(n: number, status: ChangeOrder['status'], changeAmount: number, audit: { action: string; detail?: string }[] = []): ChangeOrder {
  return {
    id: `co-${n}`, number: n, projectId: 'p1', date: NOW, description: '', reason: '', lineItems: [],
    originalContractValue: 0, changeAmount, newContractTotal: 0, status,
    auditTrail: audit.map((a, i) => ({ id: `a${i}`, actor: 'x', timestamp: NOW, ...a })),
    createdAt: NOW, updatedAt: NOW,
  } as ChangeOrder;
}

const existing = [co(1, 'approved', 1200.25), co(4, 'rejected', 999), co(2, 'draft', 300), co(3, 'approved', 99.99)];
const marker = { action: CODE_GAP_DRAFT_ACTION, detail: 'p1:deck-guards' };

function input(over: Partial<ScopeCoDraftInput> = {}): ScopeCoDraftInput {
  return {
    project, existingCOs: existing,
    lines: [{ name: 'Deck guards and handrails', quantity: 3, unit: 'lf', unitRate: 613.333 }],
    description: 'Added scope: Deck guards and handrails.', reason: 'Added scope',
    marker, nowISO: NOW, ...over,
  };
}

console.log('\n── one line, cents');
{
  const d = buildScopeCoDraft(input());
  const l = d.lineItems[0];
  assert(l.unitPrice === 613.33, `qty 3 × rate 613.333 → unitPrice 613.33 (got ${l.unitPrice})`);
  assert(l.total === 1839.99, `…total 1839.99 (got ${l.total})`);
  assert(d.changeAmount === 1839.99, `changeAmount 1839.99 (got ${d.changeAmount})`);
  assert(l.unitCost === l.unitPrice, 'unitCost === unitPrice on a priced line (his cost rate → true zero margin)');
  assert(l.priceSource === 'ai_estimated' && l.isNew === true && l.description === '' && l.unit === 'lf', 'priced line is tagged ai_estimated, isNew, no description');
  assert(d.status === 'draft', "status 'draft'");
  assert(d.date === NOW && d.createdAt === NOW && d.updatedAt === NOW, 'date/createdAt/updatedAt = nowISO');
  assert(d.number === nextChangeOrderNumber(existing) && d.number === 5, `number === nextChangeOrderNumber(existing) (${d.number})`);
  assert(d.originalContractValue === 50000.1 + 1200.25 + 99.99, `originalContractValue = linked grandTotal + approved COs only (${d.originalContractValue})`);
  assert(toCents(d.newContractTotal) === toCents(d.originalContractValue) + toCents(d.changeAmount), `newContractTotal === original + change, to the cent (${d.newContractTotal})`);
  assert(Number.isInteger(toCents(d.newContractTotal) * 1) && Math.round(d.newContractTotal * 100) === toCents(d.newContractTotal), 'newContractTotal is whole cents');
}

console.log('\n── five-line mixed fixture');
{
  const d = buildScopeCoDraft(input({
    lines: [
      { name: 'A', quantity: 3, unit: 'ea', unitRate: 613.333 },
      { name: 'B', quantity: 2.5, unit: 'sf', unitRate: 1.115 },
      { name: 'C', quantity: 7, unit: 'lf', unitRate: null },
      { name: 'D', quantity: 1, unit: '', unitRate: 0.1 + 0.2 },
      { name: 'E', quantity: 0.333, unit: 'ls', unitRate: 1000.005 },
    ],
  }));
  const sumCents = d.lineItems.reduce((s, l) => s + toCents(l.total), 0);
  assert(sumCents === toCents(d.changeAmount), `Σ line cents (${sumCents}) === changeAmount cents (${toCents(d.changeAmount)})`);
  assert(d.lineItems.every(l => Number.isInteger(Math.round(l.total * 100)) && Math.abs(l.total * 100 - Math.round(l.total * 100)) < 1e-6), 'every line total is whole cents');
  const c = d.lineItems[2];
  assert(c.unitPrice === 0 && c.total === 0 && c.priceSource === 'needs_price' && c.unitCost === undefined, 'a needs_price line → 0, tagged needs_price, no invented cost');
  assert(d.lineItems[3].unit === 'ls', "unit defaults to 'ls'");
  assert(d.lineItems.filter(l => l.priceSource === 'ai_estimated').every(l => l.unitCost === l.unitPrice), 'unitCost === unitPrice on every priced line');
  const zero = buildScopeCoDraft(input({ lines: [{ name: 'Z', quantity: 2, unit: 'ea', unitRate: 0 }] }));
  assert(zero.lineItems[0].priceSource === 'needs_price' && zero.changeAmount === 0, 'a 0 rate is needs_price, not a $0 priced line');
  const long = buildScopeCoDraft(input({ lines: [{ name: `  ${'x'.repeat(200)}  `, quantity: 1, unit: 'ea', unitRate: 1 }] }));
  assert(long.lineItems[0].name.length === 120, 'name trimmed to 120 chars');
}

console.log('\n── marker + internal note');
{
  const d = buildScopeCoDraft(input());
  assert(d.auditTrail?.length === 1 && d.auditTrail[0].action === CODE_GAP_DRAFT_ACTION && d.auditTrail[0].detail === 'p1:deck-guards' && d.auditTrail[0].actor === 'MAGE' && d.auditTrail[0].timestamp === NOW, 'the marker is present with action + detail');
  const note = 'Scope Code Gaps starter rule deck-guards (IRC: Deck guards and handrails), not yet reviewed by the founder.';
  const n = buildScopeCoDraft(input({ internalNote: note }));
  assert(n.auditTrail?.length === 2 && n.auditTrail[1].action === 'internal_note' && n.auditTrail[1].detail === note, 'internalNote adds a second internal_note entry');
  assert(!n.description.includes('IRC') && !n.reason.includes('IRC') && !n.description.includes(note) && !n.reason.includes(note), 'the internal note never appears in description or reason');
  assert(n.description === 'Added scope: Deck guards and handrails.' && n.reason === 'Added scope', 'description and reason are the caller\'s neutral wording, verbatim');
  assert(RFI_DRAFT_ACTION === 'drafted_from_rfi' && CODE_GAP_DRAFT_ACTION === 'drafted_from_code_gap', 'marker constants');
}

console.log('\n── never invents a quantity');
for (const q of [0, NaN, -1, Infinity, undefined as unknown as number]) {
  let threw = false;
  try { buildScopeCoDraft(input({ lines: [{ name: 'X', quantity: q, unit: 'ea', unitRate: 10 }] })); } catch { threw = true; }
  assert(threw, `quantity ${String(q)} throws`);
}

console.log('\n── findScopeDraft');
{
  const hit = co(9, 'draft', 0, [{ action: 'created' }, { action: CODE_GAP_DRAFT_ACTION, detail: 'p1:deck-guards' }]);
  const other = co(8, 'draft', 0, [{ action: CODE_GAP_DRAFT_ACTION, detail: 'p1:deck-ledger' }]);
  const rfi = co(7, 'draft', 0, [{ action: RFI_DRAFT_ACTION, detail: 'p1:deck-guards' }]);
  assert(findScopeDraft([other, rfi, hit], marker)?.id === 'co-9', 'hit: action AND detail both match');
  assert(findScopeDraft([other, rfi], marker) === null, 'miss: same detail under another action, or another detail, is not a hit');
  assert(findScopeDraft([], marker) === null, 'miss on an empty list');
}

console.log('\n── toCents');
assert(toCents(613.333) === 61333 && toCents(NaN) === 0 && toCents(Infinity) === 0 && toCents(0.1 + 0.2) === 30, 'toCents rounds to integer cents; non-finite → 0');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('scope-co-draft validator FAILED'); process.exit(1); }
console.log('scope-co-draft validator PASSED');
