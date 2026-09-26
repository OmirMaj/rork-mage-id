// scripts/validate-code-scope-triggers.ts
//
// Step-3 L1: Scope Code Gaps — the hand-written starter rule table
// (utils/codeScopeTriggers) and its engine (utils/scopeGaps).
//   • table honesty: family-level only, no section numbers, no edition years,
//     ships labelled "not yet reviewed by you";
//   • engine: triggers, exclusions, job kind, state and NEC-edition gates,
//     the family-not-listed note, dismissals, pricing through the one path,
//     no invented quantity, and a total that reconciles with the CO builder.
// Pure — no React, no network, no AsyncStorage. Exits non-zero on failure.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CODE_SCOPE_RULES, CODE_SCOPE_RULES_REVIEW, SCOPE_GAPS_STARTER_LABEL, type CodeScopeRule,
} from '../utils/codeScopeTriggers';
import { evaluateScopeGaps, scopeGapUnitWord, type ScopeGapsInput } from '../utils/scopeGaps';
import { buildScopeCoDraft, CODE_GAP_DRAFT_ACTION, toCents } from '../utils/brain/scopeCoDraft';
import { CATEGORY_META } from '../constants/materials';
import { buildScopeIndex, isInContractScope } from '../utils/scopeCoverage';
import type { CostBookEntry, CostDatabase } from '../utils/costDatabase';
import type { ChangeOrder } from '../types';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { console.log(`  PASS ${label}`); passed++; } else { console.error(`  FAIL ${label}`); failed++; }
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ─── Table ────────────────────────────────────────────────────────────────
console.log('\n── rule table');
const rules = CODE_SCOPE_RULES;
assert(rules.length >= 25 && rules.length <= 40, `25 <= rules <= 40 (${rules.length})`);
assert(rules.length === 30, 'today 30');
assert(new Set(rules.map(r => r.id)).size === rules.length, 'unique ids');
const FAMILIES = new Set(['IBC', 'IRC', 'IECC', 'IEBC', 'IPC', 'IMC', 'IFC', 'IFGC', 'NEC']);
assert(rules.every(r => FAMILIES.has(r.family)), 'family ∈ the nine model-code families');

function textsOf(r: CodeScopeRule): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(r);
  return out;
}
const SECTION = /\b[A-Z]{0,2}\d{3,4}(\.\d+)+\b|§|\bsection\b/i;
const YEAR = /\b(19|20)\d{2}\b/;
const secHits = rules.flatMap(r => textsOf(r).filter(t => SECTION.test(t)).map(t => `${r.id}: ${t}`));
assert(secHits.length === 0, `no section numbers in any text field${secHits.length ? ` (${secHits.join(' | ')})` : ''}`);
const yearHits = rules.flatMap(r => textsOf(r).filter(t => YEAR.test(t)).map(t => `${r.id}: ${t}`));
assert(yearHits.length === 0, `no edition years in any text field, why/varies included${yearHits.length ? ` (${yearHits.join(' | ')})` : ''}`);
assert(!SECTION.test(SCOPE_GAPS_STARTER_LABEL.replace('never a code section', '')) && !YEAR.test(SCOPE_GAPS_STARTER_LABEL), 'the starter label carries no section or year');
assert(rules.every(r => r.coveredBy.length > 0), 'coveredBy non-empty');
assert(rules.every(r => r.triggers.length > 0 || (r.projectTypes ?? []).length > 0), 'triggers or projectTypes non-empty');
assert(rules.every(r => r.why.trim() && r.requires.trim() && r.topic.trim()), 'every rule has requires, why and topic');
assert(rules.every(r => { const w = r.topic.trim().split(/\s+/).length; return w >= 2 && w <= 4; }), 'every topic is 2 to 4 words');
{
  // A line named after the rule's topic (the CO line or cart line this card
  // adds) must count as covering the rule, or the row would stay a gap after
  // he has added it.
  const selfMiss = rules.filter(r => !isInContractScope({ phrases: r.coveredBy }, buildScopeIndex({ estimateLines: [{ name: r.topic }] })).covered).map(r => r.id);
  assert(selfMiss.length === 0, `a line named after each topic covers its own rule${selfMiss.length ? ` (${selfMiss.join(', ')})` : ''}`);
}
const TRADES = new Set([...Object.keys(CATEGORY_META), 'general']);
assert(rules.every(r => TRADES.has(r.price.trade)), 'price.trade ∈ CATEGORY_META keys + general');
assert(rules.every(r => r.price.qty === null || (Number.isFinite(r.price.qty) && r.price.qty > 0)), 'starter qty is null or > 0');
assert(rules.find(r => r.id === 'service-surge')?.editionGate?.minYear === 2020, 'service-surge is gated on NEC edition');
assert((rules.find(r => r.id === 'reroof-ice-barrier')?.onlyStates ?? []).includes('NY'), 'reroof-ice-barrier carries its state list');
const cardSrc = readFileSync(join(ROOT, 'components/scopeGaps/ScopeGapsCard.tsx'), 'utf8');
assert(CODE_SCOPE_RULES_REVIEW.status === 'pending_founder_review' && CODE_SCOPE_RULES_REVIEW.reviewedOn === null, "CODE_SCOPE_RULES_REVIEW.status === 'pending_founder_review'");
assert(cardSrc.includes('SCOPE_GAPS_STARTER_LABEL'), 'ScopeGapsCard.tsx shows SCOPE_GAPS_STARTER_LABEL');

// ─── Engine ───────────────────────────────────────────────────────────────
console.log('\n── engine');
const EMPTY_DB: CostDatabase = { entries: [], jobsAnalyzed: 0, tradesTracked: 0, overallBidAccuracy: null, asOf: '' };
function entry(trade: string, unit: string, rate: number): CostBookEntry {
  return {
    key: `${trade.toLowerCase()}|${unit.toLowerCase()}`, trade, unit, sampleCount: 3, jobCount: 3,
    personalRate: rate, variability: 0.1, bidBias: 0, baseline: rate, suggestedRate: rate, confidence: 'medium',
    totalActual: 1000, lastSeen: '', samples: [], provenance: 'earned', earnedBasis: 'paid',
  };
}
function run(lines: string[], over: Partial<ScopeGapsInput> = {}) {
  return evaluateScopeGaps({ lines: lines.map(name => ({ name })), jobKind: 'residential', costDb: EMPTY_DB, ...over });
}
const gap = (r: ReturnType<typeof run>, id: string) => r.gaps.find(g => g.rule.id === id);

{
  const r = run(['Bedroom addition framing']);
  assert(gap(r, 'smoke-co-sleeping')?.state === 'gap' && gap(r, 'habitable-afci')?.state === 'gap', "'Bedroom addition framing' fires smoke-co-sleeping and habitable-afci");
  assert(gap(r, 'smoke-co-sleeping')?.triggeredBy === 'line 1 "Bedroom addition framing"', 'triggeredBy names the line');
  assert(!gap(r, 'kitchen-gfci-afci'), 'an unrelated rule does not fire');
}
{
  const r = run(['Bedroom addition framing', 'Smoke/CO detector']);
  const g = gap(r, 'smoke-co-sleeping');
  assert(g?.state === 'in_scope' && g.coverage.explain === 'Matches line 2 "Smoke/CO detector"', `adding a 'Smoke/CO detector' line → in_scope (${g?.coverage.explain})`);
}
assert(!gap(run(['Tankless water heater']), 'water-heater-expansion'), "a 'Tankless water heater' line alone does not fire water-heater-expansion");
assert(gap(run(['Water heater']), 'water-heater-expansion')?.state === 'gap', "a plain 'Water heater' line does");
assert(!gap(run(['Bedroom addition framing'], { jobKind: 'commercial' }), 'smoke-co-sleeping'), "jobKind 'commercial' never fires smoke-co-sleeping");
assert(!!gap(run(['Restroom'], { jobKind: 'commercial' }), 'accessible-restroom') && !gap(run(['Restroom']), 'accessible-restroom'), "a 'Restroom' line fires accessible-restroom only under commercial");
{
  const r = run(['Roof replacement'], { address: { state: 'FL' } });
  const g = gap(r, 'reroof-ice-barrier');
  assert(g?.state === 'suppressed' && g.suppressedReason === "doesn't usually apply in FL", `state FL suppresses reroof-ice-barrier, with the reason (${g?.suppressedReason})`);
  assert(r.totalCents === 0, 'a suppressed rule never counts');
  const u = gap(run(['Roof replacement']), 'reroof-ice-barrier');
  assert(u?.state === 'gap' && u.jurisdictionNote === 'Depends on your location — no state on file', 'no state → shown with the location note');
}
{
  const chi = gap(run(['Panel upgrade'], { address: { city: 'Chicago', state: 'IL' } }), 'service-surge');
  assert(chi?.state === 'suppressed' && chi.suppressedReason === 'your adopted NEC 2017 predates this', `NEC 2017 (Chicago's row) suppresses service-surge (${chi?.suppressedReason})`);
  const wa = gap(run(['Panel upgrade'], { address: { state: 'WA' } }), 'service-surge');
  assert(wa?.state === 'gap' && wa.jurisdictionNote === null, 'a 2023 NEC row (WA) shows it, no note');
  const pa = gap(run(['Panel upgrade'], { address: { state: 'PA' } }), 'service-surge');
  assert(pa?.state === 'gap' && pa.jurisdictionNote === 'Depends on your NEC edition — not on file for this jurisdiction', 'no NEC on file (PA) shows it with the Depends-on-your-NEC-edition note');
}
{
  const g = gap(run(['Bedroom addition framing'], { address: { city: 'New York', state: 'NY' } }), 'smoke-co-sleeping');
  assert(!!g?.jurisdictionNote && g.jurisdictionNote.includes("adoption record doesn't list the IRC") && g.jurisdictionNote.startsWith('New York City Department of Buildings'), `NYC puts the family-not-listed note on an IRC rule (${g?.jurisdictionNote})`);
  const u = gap(run(['Bedroom addition framing']), 'smoke-co-sleeping');
  assert(u?.jurisdictionNote === null, 'unknown jurisdiction → no per-rule note');
}
{
  const r = run(['Bedroom addition framing'], { dismissals: { 'smoke-co-sleeping': { verdict: 'n_a', at: '2026-09-26' } } });
  assert(gap(r, 'smoke-co-sleeping')?.state === 'n_a', "an 'n_a' dismissal hides a gap");
  const r2 = run(['Bedroom addition framing'], { dismissals: { 'habitable-afci': { verdict: 'already_covered', at: '2026-09-26' } } });
  assert(gap(r2, 'habitable-afci')?.state === 'already_covered', "an 'already_covered' dismissal hides a gap");
}

console.log('\n── pricing and quantity');
const DB: CostDatabase = { entries: [entry('Windows & Doors', 'ea', 412.337), entry('Electrical', 'ea', 185.5)], jobsAnalyzed: 3, tradesTracked: 2, overallBidAccuracy: null, asOf: '' };
{
  const r = run(['Shower door'], { costDb: DB, quantities: { 'safety-glazing': 3 } });
  const g = gap(r, 'safety-glazing');
  assert(!!g && g.priced && g.unitRate === 412.337 && g.quantity === 3 && g.totalCents === Math.round(3 * 41234), `'Windows & Doors|ea' prices safety-glazing with quantity 3 (${g?.totalCents})`);
  assert(!!g && g.rateCaption !== 'No price of yours yet' && g.rateCaption === 'your rate · 3 jobs', `…with a real caption (${g?.rateCaption})`);
  const n = gap(run(['Shower door'], { costDb: DB }), 'safety-glazing');
  assert(!!n && n.needsQuantity && n.quantity === null && n.totalCents === null, 'without a quantity: needsQuantity true, totalCents null');
  const rn = run(['Shower door'], { costDb: DB });
  assert(!rn.gaps.some(x => x.state === 'gap' && x.totalCents != null && x.rule.id === 'safety-glazing') && rn.needsPriceCount >= 1, '…excluded from the total and counted as needing a quantity');
  const bad = gap(run(['Shower door'], { costDb: DB, quantities: { 'safety-glazing': 0 } }), 'safety-glazing');
  assert(bad?.quantity === null, 'a 0 quantity is not a quantity');
  const unp = gap(run(['Bath remodel']), 'bath-exhaust');
  assert(!!unp && !unp.priced && unp.unitRate === null && unp.totalCents === null && unp.rateCaption === 'No price of yours yet' && unp.quantity === 1, 'an unpriced rule keeps its starter qty and no price');
}
{
  // Reconcile: the card total === the CO builder's changeAmount for the same gaps.
  const r = run(['Shower door', 'Bedroom addition framing', 'Bath remodel'], { costDb: DB, quantities: { 'safety-glazing': 3, 'bath-gfci': 2 } });
  const priced = r.gaps.filter(g => g.state === 'gap' && g.priced && g.quantity != null);
  assert(priced.length >= 3, `several priced gaps (${priced.map(g => g.rule.id).join(', ')})`);
  const co = buildScopeCoDraft({
    project: { id: 'p1' } as never, existingCOs: [] as ChangeOrder[],
    lines: priced.map(g => ({ name: g.rule.topic, quantity: g.quantity!, unit: g.rule.price.unit, unitRate: g.unitRate })),
    description: 'Added scope.', reason: 'Added scope', marker: { action: CODE_GAP_DRAFT_ACTION, detail: 'p1:x' }, nowISO: '2026-09-26T00:00:00Z',
  });
  assert(r.totalCents === toCents(co.changeAmount) && r.totalCents === co.changeAmount * 100 - (co.changeAmount * 100 - toCents(co.changeAmount)), `totalCents (${r.totalCents}) === buildScopeCoDraft(...).changeAmount*100 (${co.changeAmount})`);
  assert(r.totalCents === priced.reduce((s, g) => s + (g.totalCents ?? 0), 0), 'totalCents is the sum of the gap rows');
}
assert(scopeGapUnitWord('ea') === 'how many' && scopeGapUnitWord('lf') === 'how many linear feet' && scopeGapUnitWord('sf') === 'how many square feet' && scopeGapUnitWord('ls') === 'the quantity', 'unit words');

console.log('\n── card source checks');
assert(cardSrc.includes('Added scope:'), "card contains 'Added scope:'");
assert(!cardSrc.includes('Code-required'), "card never says 'Code-required'");
assert(!/\?\?\s*1\b/.test(cardSrc), 'card contains no `?? 1` (never invents a quantity)');
assert(cardSrc.includes('until you sign out'), "card says 'until you sign out'");
assert(/testID=\{[^}]*'scopegaps-card'/.test(cardSrc) || cardSrc.includes("?? 'scopegaps-card'"), "card root testID defaults to 'scopegaps-card'");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('code-scope-triggers validator FAILED'); process.exit(1); }
console.log('code-scope-triggers validator PASSED');
