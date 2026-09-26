// scripts/validate-scope-coverage.ts
//
// Step-3 L1: the shared "is this already in contract scope?" comparator
// (utils/scopeCoverage) and the ONE pricing path (utils/scopePricing), shared
// by Scope Code Gaps and the RFI scope check.
// Pure — no React, no network, no AsyncStorage. Exits non-zero on failure.

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildScopeIndex, isInContractScope, normalizeScopeText, EMPTY_SCOPE_EXPLAIN,
} from '../utils/scopeCoverage';
import { scopeRateFor, scopeRateCaption } from '../utils/scopePricing';
import type { ChangeOrder } from '../types';
import type { CostBookEntry, CostDatabase } from '../utils/costDatabase';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { console.log(`  PASS ${label}`); passed++; } else { console.error(`  FAIL ${label}`); failed++; }
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function co(n: number, status: ChangeOrder['status'], lineNames: string[], description = '', projectId = 'p1'): ChangeOrder {
  return {
    id: `co-${n}`, number: n, projectId, date: '2026-09-01', description, reason: 'x',
    lineItems: lineNames.map((name, i) => ({ id: `l${n}-${i}`, name, description: '', quantity: 1, unit: 'ea', unitPrice: 0, total: 0, isNew: true })),
    originalContractValue: 0, changeAmount: 0, newContractTotal: 0, status,
    createdAt: '', updatedAt: '',
  } as ChangeOrder;
}

// ─── Fixture ──────────────────────────────────────────────────────────────
const lines = [{ name: 'Smoke/CO combo detectors', category: 'electrical', quantity: 4, unit: 'ea' }];
const cos = [
  co(1, 'approved', ['Bath exhaust fan']),
  co(2, 'rejected', ['Deck railing']),
  co(3, 'void', ['Attic insulation'], 'Attic insulation'),
  co(4, 'approved', ['Fence'], '', 'other-project'),
];
const idx = buildScopeIndex({ estimateLines: lines, changeOrders: cos, projectId: 'p1' });

console.log('\n── phrase queries');
{
  const r = isInContractScope({ phrases: ['smoke'] }, idx);
  assert(r.covered && r.basis === 'phrase', "['smoke'] is covered, basis phrase");
  assert(r.matches[0]?.source.kind === 'estimate_line' && r.explain === 'Matches line 1 "Smoke/CO combo detectors"', `…by the estimate line (${r.explain})`);
}
{
  const r = isInContractScope({ phrases: ['exhaust fan'] }, idx);
  assert(r.covered && r.matches[0]?.source.kind === 'co_line' && r.explain === 'Matches CO #1 "Bath exhaust fan"', `['exhaust fan'] is covered by the CO line (${r.explain})`);
}
{
  const r = isInContractScope({ phrases: ['railing'] }, idx);
  assert(!r.covered && r.basis === 'none', "['railing'] is NOT covered (its CO was rejected)");
  assert(!isInContractScope({ phrases: ['insulation'] }, idx).covered, 'a void CO never counts');
  assert(!isInContractScope({ phrases: ['fence'] }, idx).covered, 'a CO on another project never counts when projectId is given');
  assert(!isInContractScope({ phrases: ['smok'] }, idx).covered, 'a phrase matches on word boundaries only');
  assert(!isInContractScope({ phrases: ['moke'] }, idx).covered && !isInContractScope({ phrases: ['co combo detector'] }, idx).covered, 'both edges are word boundaries');
  assert(isInContractScope({ phrases: ['co combo detectors'] }, idx).covered, "'/' is a boundary: 'co combo detectors' is found after 'smoke/'");
}

console.log('\n── description queries');
{
  const i2 = buildScopeIndex({ estimateLines: [{ name: 'Fire damper allowance' }] });
  const r = isInContractScope({ description: 'Add 2 fire dampers at grid C' }, i2);
  assert(r.covered && r.basis === 'tokens', `'Add 2 fire dampers at grid C' vs 'Fire damper allowance' → covered, basis tokens`);
  const i3 = buildScopeIndex({ estimateLines: [{ name: 'Bath fan' }] });
  const r3 = isInContractScope({ description: 'Replace attic insulation' }, i3);
  assert(!r3.covered, "'Replace attic insulation' vs only 'Bath fan' → not covered");
  const r4 = isInContractScope({ description: 'Bath fan' }, i3);
  assert(r4.covered, 'a two-token description whose every token is in a source is covered');
  const r5 = isInContractScope({ description: 'the and for' }, i3);
  assert(!r5.covered, 'a description with no tokens is never covered');
}

console.log('\n── explain wording');
{
  const r = isInContractScope({ phrases: ['egress'] }, idx);
  assert(r.explain === 'Not found in 1 estimate line and 1 change order', `singular: ${r.explain}`);
  const i2 = buildScopeIndex({
    estimateLines: [{ name: 'A thing' }, { name: 'B thing' }],
    changeOrders: [co(1, 'approved', ['x']), co(2, 'draft', ['y'])],
    contractScopeText: 'Scope: kitchen',
  });
  const r2 = isInContractScope({ phrases: ['egress'] }, i2);
  assert(r2.explain === 'Not found in 2 estimate lines and 2 change orders or the contract scope text', `plural + contract: ${r2.explain}`);
  const i3 = buildScopeIndex({ estimateLines: [{ name: 'A thing' }, { name: 'B thing' }] });
  assert(isInContractScope({ phrases: ['egress'] }, i3).explain === 'Not found in 2 estimate lines', 'no change orders → no CO clause');
  const rc = isInContractScope({ phrases: ['kitchen'] }, i2);
  assert(rc.covered && rc.explain === 'Matches the contract scope text', 'contract text is a source');
  const i4 = buildScopeIndex({ scopeNotes: [null, '', 'Owner supplies the range hood'] });
  const rn = isInContractScope({ phrases: ['range hood'] }, i4);
  assert(rn.covered && rn.explain === 'Matches your scope notes' && i4.counts.scopeNotes === 1, 'scope notes are a source; blanks skipped');
}

console.log('\n── normalize + empty index');
assert(normalizeScopeText('Smoke & CO') === 'smoke and co', "normalizeScopeText('Smoke & CO') === 'smoke and co'");
assert(normalizeScopeText('  Type-X  5/8"  GWB ') === 'type x 5/8 gwb', 'punctuation → space, / kept, collapsed');
{
  const r = isInContractScope({ phrases: ['smoke'] }, buildScopeIndex({}));
  assert(!r.covered && r.explain === EMPTY_SCOPE_EXPLAIN && r.explain === 'No estimate lines, change orders or contract scope on file to compare with', 'empty index → covered false with the No-estimate-lines explain');
}

console.log('\n── source checks');
{
  const src = read('utils/scopeCoverage.ts');
  assert(/import \{ CAPTURED_STATUSES \} from '@\/utils\/profitLeak\/scopeSummary'/.test(src), 'CAPTURED_STATUSES is imported from scopeSummary');
  assert(!/new Set\(\[\s*'approved'/.test(src), 'scopeCoverage does not re-type the captured statuses');
}

console.log('\n── scopeRateFor (exact key, label mapping)');
function entry(trade: string, unit: string, extra: Partial<CostBookEntry> = {}): CostBookEntry {
  return {
    key: `${trade.toLowerCase()}|${unit.toLowerCase()}`, trade, unit, sampleCount: 2, jobCount: 2,
    personalRate: 100, variability: 0.1, bidBias: 0, baseline: 100, suggestedRate: 100, confidence: 'medium',
    totalActual: 1000, lastSeen: '', samples: [], provenance: 'earned', earnedBasis: 'paid', ...extra,
  };
}
const db: CostDatabase = {
  entries: [entry('Windows & Doors', 'ea'), entry('Lumber & Framing', 'lf'), entry('Electrical', 'ea')],
  jobsAnalyzed: 2, tradesTracked: 3, overallBidAccuracy: null, asOf: '',
};
assert(scopeRateFor(db, 'windows', 'ea')?.trade === 'Windows & Doors', "scopeRateFor(db,'windows','ea') hits 'Windows & Doors|ea'");
assert(scopeRateFor(db, 'lumber', 'lf')?.trade === 'Lumber & Framing', "scopeRateFor(db,'lumber','lf') hits 'Lumber & Framing|lf'");
assert(scopeRateFor(db, 'Electrical', 'ea')?.trade === 'Electrical', "scopeRateFor(db,'Electrical','ea') hits 'Electrical|ea'");
assert(scopeRateFor(db, 'windows', 'lf') === null, "a 'windows|lf' query misses (no any-unit fallback)");

console.log('\n── scopeRateCaption');
assert(scopeRateCaption(null) === 'No price of yours yet', 'null → No price of yours yet');
assert(scopeRateCaption(entry('X', 'ea', { provenance: 'seeded' })) === 'a rate you set', 'seeded → a rate you set');
assert(scopeRateCaption(entry('X', 'ea', { earnedBasis: 'contracted', jobCount: 3 })) === 'from 3 signed sub prices, not yet paid', 'contracted → from 3 signed sub prices, not yet paid');
assert(scopeRateCaption(entry('X', 'ea', { earnedBasis: 'contracted', jobCount: 1 })) === 'from 1 signed sub price, not yet paid', 'contracted singular');
assert(scopeRateCaption(entry('X', 'ea', { jobCount: 1 })) === 'your rate · 1 job', 'earned → your rate · 1 job');
assert(scopeRateCaption(entry('X', 'ea', { jobCount: 4 })) === 'your rate · 4 jobs', 'earned → your rate · 4 jobs');

console.log('\n── one pricing path (source checks)');
for (const rel of ['components/rfi/RfiScopeCheckCard.tsx', 'components/scopeGaps/ScopeGapsCard.tsx']) {
  if (!existsSync(join(ROOT, rel))) { assert(false, `${rel} exists`); continue; }
  const src = read(rel);
  assert(/useScopeCostBook/.test(src) && /from '@\/hooks\/useScopeCostBook'/.test(src), `${rel} imports useScopeCostBook`);
  assert(/import \{[^}]*\bscopeRateFor\b[^}]*\} from '@\/utils\/scopePricing'/.test(src), `${rel} imports scopeRateFor from utils/scopePricing`);
  assert(!/\bpriceLeakItems\s*\(/.test(src) && !/\bbuildCostDatabase\s*\(/.test(src), `${rel} never calls priceLeakItems or buildCostDatabase directly`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('scope-coverage validator FAILED'); process.exit(1); }
console.log('scope-coverage validator PASSED');
