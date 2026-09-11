// scripts/validate-ai-honesty.ts — pure-fn + source-text validator for the
// brain-center directive's HONEST leg on the estimate + Code Check surfaces.
//
//   AI-F4      the grounding chip may call a rate "learned" ONLY when it was
//              measured; a rate the contractor STATED is labelled as such.
//   PRODUCT-F18 the wizard grounds on the cost-book entries that match the
//              scope being priced, not the six largest jobs in the book.
//   AI-F3      the live Code Check never presents model recall as a lookup.
//   RT-R1      an unreachable backend is never shown as "all clear".
//   re-review  B1 loader copy is a claim (stated ≠ measured) · B2 cache key is
//              the prompt · A1 the probe never touches focusManager · A2 Quick
//              Estimate grounds per run and snapshots it · A3 the aha fires
//              only for a measured rate · A4 short-form aliases · A5 cancelled
//              runs cannot land · A6 the loader does not claim retrieval.
//
// Pure functions live in utils/groundingChip.ts and utils/activationSignals.ts.
// The source assertions pin the copy and wiring on the screens the pure
// functions cannot reach.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  EMPTY_GROUNDING,
  ESTIMATE_THINKING_STEPS,
  buildGroundingFacts,
  countGroundingEntries,
  estimateThinkingSteps,
  groundingChipLabel,
  groundingFactLine,
  groundingSource,
  scopeRelevance,
  selectGroundingEntries,
} from '../utils/groundingChip';
import { estimateGroundingProps } from '../utils/activationSignals';
import type { CostDatabase } from '../utils/costDatabase';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
// `why` is optional and printed only on failure. It used to be absent, so a
// failing check said nothing but its own title — and the titles are short
// because they are read in a passing list. Every other validator in this repo
// prints the reason; this one now does too.
function ok(n: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', n); return; }
  fail++;
  console.log('  ✗', n);
  if (why) console.log('        ' + why);
}

type Prov = 'earned' | 'seeded' | 'mixed' | undefined;
const entry = (trade: string, provenance: Prov, over: Record<string, unknown> = {}) => ({
  key: `${trade.toLowerCase()}|sf`, trade, unit: 'SF', provenance, suggestedRate: 12.5,
  confidence: 'medium' as const, jobCount: provenance === 'seeded' ? 0 : 2, ...over,
});

console.log('\ncountGroundingEntries (AI-F4):');
ok('empty book → 0/0', JSON.stringify(countGroundingEntries([])) === JSON.stringify({ measured: 0, seeded: 0 }));
ok('seeded-only → measured 0', (() => { const c = countGroundingEntries([entry('Tile', 'seeded'), entry('Plumbing', 'seeded')]); return c.measured === 0 && c.seeded === 2; })());
ok('mixed counts as measured (real jobs behind it)', countGroundingEntries([entry('Tile', 'mixed')]).measured === 1);
ok('legacy entry with no provenance counts as measured (matches activationSignals)', countGroundingEntries([entry('Tile', undefined)]).measured === 1);
ok('earned + seeded split correctly', (() => { const c = countGroundingEntries([entry('Tile', 'earned'), entry('Paint', 'seeded'), entry('HVAC', 'earned')]); return c.measured === 2 && c.seeded === 1; })());

console.log('\ngroundingChipLabel (AI-F4):');
ok('measured only → "learned rates" with the measured count', groundingChipLabel({ measured: 3, seeded: 0 }) === 'Priced with your cost history · 3 learned rates');
ok('singular', groundingChipLabel({ measured: 1, seeded: 0 }) === 'Priced with your cost history · 1 learned rate');
ok('seeded only → STATED label, never "learned"', (() => { const l = groundingChipLabel({ measured: 0, seeded: 3 }); return l.startsWith('Priced from rates you set') && l.includes('3') && !/learned/i.test(l) && !/cost history/i.test(l); })());
ok('both → learned count is the MEASURED count and the seeds are named separately', (() => {
  const l = groundingChipLabel({ measured: 2, seeded: 3 });
  return l.includes('2 learned rates') && l.includes('3 rates you set') && !l.includes('5 learned');
})());
ok('nothing → market-averages default', groundingChipLabel({ measured: 0, seeded: 0 }) === 'Priced from market averages — MAGE has none of your rates yet');
ok('nothing → caller-supplied empty label wins', groundingChipLabel({ measured: 0, seeded: 0 }, { emptyLabel: 'cold' }) === 'cold');
ok('negative / NaN counts are treated as zero', groundingChipLabel({ measured: NaN, seeded: -2 }) === 'Priced from market averages — MAGE has none of your rates yet');

console.log('\nestimateThinkingSteps (re-review B1 — the loader is a claim too):');
ok('seeded-only counts select the STATED copy — "rates you set", never "your history"', (() => {
  const s = estimateThinkingSteps({ measured: 0, seeded: 2 });
  return s.some((l) => /Pricing from the rates you set/.test(l)) && !s.some((l) => /history|learned/i.test(l));
})());
ok('one measured entry selects the "your history" copy, however many seeds ride along', estimateThinkingSteps({ measured: 1, seeded: 3 }).some((l) => /Pricing from your history/.test(l)));
ok('nothing selects market averages', estimateThinkingSteps({ measured: 0, seeded: 0 }).some((l) => /Pricing from market averages/.test(l)));
ok('calibration-only (zero entries) is "none" — the loader has no rates to price from', groundingSource(EMPTY_GROUNDING.counts) === 'none');
ok('groundingSource: measured beats stated; NaN reads as zero', groundingSource({ measured: 2, seeded: 5 }) === 'measured' && groundingSource({ measured: NaN, seeded: 1 }) === 'stated' && groundingSource({ measured: NaN, seeded: NaN }) === 'none');
ok('every variant has four steps, only the pricing line differs, and the instance is stable', (() => {
  const ks = ['measured', 'stated', 'none'] as const;
  const sameShape = ks.every((k) => ESTIMATE_THINKING_STEPS[k].length === 4 && ESTIMATE_THINKING_STEPS[k][0] === ESTIMATE_THINKING_STEPS.none[0] && ESTIMATE_THINKING_STEPS[k][3] === ESTIMATE_THINKING_STEPS.none[3]);
  return sameShape && estimateThinkingSteps({ measured: 0, seeded: 1 }) === ESTIMATE_THINKING_STEPS.stated;
})());

console.log('\nestimateGroundingProps with run counts (re-review A3 — the aha must not fire for seeded-only):');
const db = (entries: { provenance?: string }[], jobsAnalyzed: number) => ({ entries, jobsAnalyzed } as unknown as CostDatabase);
ok('seeded-only run → used_learned_costs false, learned_rate_count 0, jobs 0', JSON.stringify(estimateGroundingProps(db([{ provenance: 'seeded' }, { provenance: 'seeded' }], 0), { measured: 0, seeded: 2 })) === JSON.stringify({ used_learned_costs: false, learned_rate_count: 0, jobs_analyzed: 0 }));
ok('book has a measured rate but THIS run used none → false; the book-level props are unchanged', JSON.stringify(estimateGroundingProps(db([{ provenance: 'earned' }, { provenance: 'seeded' }], 3), { measured: 0, seeded: 1 })) === JSON.stringify({ used_learned_costs: false, learned_rate_count: 1, jobs_analyzed: 3 }));
ok('run carried a measured rate → true', estimateGroundingProps(db([{ provenance: 'earned' }, { provenance: 'seeded' }], 3), { measured: 1, seeded: 1 }).used_learned_costs === true);
ok('no run counts → legacy book-level reading (ProjectContext callers untouched)', estimateGroundingProps(db([{ provenance: 'seeded' }], 0)).used_learned_costs === true && estimateGroundingProps(db([], 0)).used_learned_costs === false);
ok('NaN run count reads as zero', estimateGroundingProps(db([{ provenance: 'earned' }], 1), { measured: NaN, seeded: 0 }).used_learned_costs === false);

console.log('\ngroundingFactLine (AI-F4 — the prompt side of the firewall):');
ok('seeded line says stated / self-reported and never "on your jobs"', (() => {
  const l = groundingFactLine(entry('Tile', 'seeded'));
  return /stated rate/.test(l) && /self-reported/.test(l) && !/on your jobs/.test(l) && l.includes('$12.50/SF');
})());
ok('earned line cites the measured job count', (() => {
  const l = groundingFactLine(entry('Tile', 'earned', { jobCount: 3, confidence: 'high' }));
  return /on your jobs/.test(l) && /3 jobs/.test(l) && /high confidence/.test(l);
})());
// A BOOK NOBODY HAS PAID YET. Every sample behind it is a signed sub or PO
// with no payment against it (utils/costDatabase earnedBasis 'contracted').
// Real evidence, different in kind from a paid cost — and "runs $X on your
// jobs (3 jobs)" is precisely the sentence a model paraphrases into "you paid
// this". app/cost-database, takeoffPricing, aiService and bidLevelingEngine
// were taught the distinction; this, the central fact line the estimate
// wizard and the full estimator both go through, was not.
ok('a signed-but-unpaid book says so, inside the same parenthetical', (() => {
  const l = groundingFactLine(entry('Tile', 'earned', { jobCount: 3, earnedBasis: 'contracted' }));
  return /3 jobs, signed but not yet paid\)/.test(l);
})(), groundingFactLine(entry('Tile', 'earned', { jobCount: 3, earnedBasis: 'contracted' })));
ok('…and a PAID book is not hedged (the qualifier is a claim too)', (() => {
  const l = groundingFactLine(entry('Tile', 'earned', { jobCount: 3, earnedBasis: 'paid' }));
  return !/signed but not yet paid/.test(l);
})());

console.log('\nbuildGroundingFacts (review B1 — one bundle per run):');
{
  const cal = 'Framing has run 12% over your bids on 3 jobs';
  const b0 = buildGroundingFacts([], cal);
  ok('calibration-only: one fact, zero entries, calibration flagged', b0.facts.length === 1 && b0.facts[0] === cal && b0.selectedCount === 0 && b0.counts.measured === 0 && b0.counts.seeded === 0 && b0.calibration);
  ok('calibration-only chip says history-only — not "none of your rates", not "N learned rates"', (() => {
    const l = groundingChipLabel(b0.counts, { calibration: b0.calibration });
    return /history/.test(l) && !/none of your rates/.test(l) && !/\d+ learned rate/.test(l);
  })());
  const b1 = buildGroundingFacts([entry('Tile', 'earned'), entry('Paint', 'seeded')], cal);
  ok('entries + calibration: facts = entries + 1; counts and selectedCount exclude the calibration line', b1.facts.length === 3 && b1.selectedCount === 2 && b1.counts.measured === 1 && b1.counts.seeded === 1 && b1.calibration);
  ok('chip with entries + calibration names measured, stated and the calibration', (() => {
    const l = groundingChipLabel(b1.counts, { calibration: true });
    return l.includes('1 learned rate') && l.includes('1 rate you set') && /calibrated/.test(l);
  })());
  ok('empty + no calibration → the zero bundle', (() => { const b = buildGroundingFacts([], null); return b.facts.length === 0 && !b.calibration && b.selectedCount === 0; })());
  ok('a blank calibration line is not a fact', !buildGroundingFacts([], '   ').calibration);
  ok('EMPTY_GROUNDING is the zero bundle', EMPTY_GROUNDING.facts.length === 0 && EMPTY_GROUNDING.selectedCount === 0 && !EMPTY_GROUNDING.calibration && EMPTY_GROUNDING.counts.measured === 0);
}

console.log('\nselectGroundingEntries (PRODUCT-F18):');
// A GC's book, already in buildCostDatabase order (largest exposure first):
// the big-ticket trades sit on top, the bathroom trades at the bottom.
const book = [
  entry('Roofing', 'earned'), entry('Concrete & Masonry', 'earned'), entry('Lumber & Framing', 'earned'),
  entry('Siding & Exterior', 'earned'), entry('Windows & Doors', 'earned'), entry('HVAC', 'earned'),
  entry('Tile', 'earned'), entry('Plumbing', 'seeded'), entry('Paint & Finishes', 'earned'),
  entry('Electrical', 'earned'), entry('Labor — Framing', 'earned'), entry('Materials', 'earned'), entry('Other', 'earned'),
  entry('Fireplaces', 'earned'),
];
const names = (xs: { trade: string }[]) => xs.map((e) => e.trade);
{
  const sel = selectGroundingEntries(book, { projectType: 'Bathroom Remodel', scope: 'Gut the hall bath, new tile shower, vanity and fixtures' }, 6);
  ok('bathroom: the six biggest jobs are NOT what gets sent', !names(sel).includes('Roofing') && !names(sel).includes('Siding & Exterior') && !names(sel).includes('Windows & Doors') && !names(sel).includes('HVAC'));
  ok('bathroom: tile / plumbing / paint / electrical are', ['Tile', 'Plumbing', 'Paint & Finishes', 'Electrical'].every((t) => names(sel).includes(t)));
  ok('bathroom: a trade named in the scope text outranks a type-implied one', names(sel)[0] === 'Tile');
  ok('bathroom: a seeded match is kept with its provenance intact', sel.find((e) => e.trade === 'Plumbing')?.provenance === 'seeded');
  ok('n is a hard cap', sel.length <= 6);
}
ok('roof replacement: roofing in, plumbing out', (() => {
  const sel = selectGroundingEntries(book, { projectType: 'Roof Replacement', scope: 'Tear off and re-shingle' }, 6);
  return names(sel).includes('Roofing') && !names(sel).includes('Plumbing') && !names(sel).includes('Tile');
})());
ok('deck: framing, concrete footings and lumber match; HVAC does not', (() => {
  const sel = selectGroundingEntries(book, { projectType: 'Deck / Outdoor', scope: 'Composite deck with railing and footings' }, 6);
  return names(sel).includes('Lumber & Framing') && names(sel).includes('Concrete & Masonry') && !names(sel).includes('HVAC');
})());
ok('addition: a self-perform labor entry matches on its trade word', names(selectGroundingEntries(book, { projectType: 'Addition', scope: '' }, 12)).includes('Labor — Framing'));
ok('a trade only named in the free text (HVAC in a kitchen) is pulled in', names(selectGroundingEntries(book, { projectType: 'Kitchen Remodel', scope: 'Move the range, needs an HVAC rough-in for the hood' }, 6)).includes('HVAC'));
ok('generic buckets (Materials / Other) never match on their own', (() => {
  const sel = selectGroundingEntries(book, { projectType: 'Bathroom Remodel', scope: 'tile' }, 12);
  return !names(sel).includes('Materials') && !names(sel).includes('Other');
})());
ok('nothing matches → falls back to the top-N by exposure, in book order', (() => {
  const sel = selectGroundingEntries(book, { projectType: 'Solar carport', scope: 'photovoltaic canopy' }, 3);
  return JSON.stringify(names(sel)) === JSON.stringify(['Roofing', 'Concrete & Masonry', 'Lumber & Framing']);
})());
ok('no hints at all → top-N fallback', names(selectGroundingEntries(book, {}, 2)).join() === 'Roofing,Concrete & Masonry');
ok('empty book → []', selectGroundingEntries([], { projectType: 'Bathroom Remodel' }, 6).length === 0);
ok('matching is case-insensitive', names(selectGroundingEntries(book, { projectType: 'BATHROOM REMODEL', scope: 'TILE' }, 6)).includes('Tile'));
ok('fewer matches than n → only the matches, no exposure padding', (() => {
  const sel = selectGroundingEntries(book, { projectType: 'Roof Replacement' }, 6);
  return sel.length >= 1 && sel.every((e) => /roof|gutter|siding|lumber|framing/i.test(e.trade));
})());
ok('Quick Estimate ids (types/ProjectType) steer selection too: "roofing" → Roofing, not the bathroom trades', (() => {
  const sel = selectGroundingEntries(book, { projectType: 'roofing', scope: 'tear-off and architectural shingles' }, 6);
  return names(sel).includes('Roofing') && !names(sel).includes('Tile') && !names(sel).includes('Plumbing');
})());

console.log('\nword-boundary matching (review B2 — no bare substrings):');
{
  const sel = selectGroundingEntries(book, { projectType: 'Bathroom Remodel', scope: 'waterproofing the shower pan' }, 6);
  ok('"waterproofing" does not summon Roofing; Plumbing and Tile rank instead', !names(sel).includes('Roofing') && names(sel).includes('Plumbing') && names(sel).includes('Tile'));
}
{
  const sel = selectGroundingEntries(book, { projectType: 'Kitchen Remodel', scope: 'outdoor kitchen with a built-in grill' }, 6);
  ok('"outdoor" does not summon Windows & Doors (let alone first)', !names(sel).includes('Windows & Doors') && names(sel)[0] !== 'Windows & Doors');
}
ok('"tiled" still reaches Tile — leading boundary only', names(selectGroundingEntries(book, { projectType: 'Bathroom Remodel', scope: 'tiled shower walls' }, 6))[0] === 'Tile');
ok('commercial TI: the "fire" keyword does not pull in Fireplaces', !names(selectGroundingEntries(book, { projectType: 'Commercial TI', scope: '' }, 20)).includes('Fireplaces'));
ok('"roof" still reaches Roofing through its trade suffix', names(selectGroundingEntries(book, { projectType: 'Roof Replacement' }, 6)).includes('Roofing'));
ok('"reptile enclosure" scores zero for Tile (no match inside a word)', scopeRelevance(entry('Tile', 'earned'), { projectType: 'Solar carport', scope: 'reptile enclosure' }) === 0);
ok('"tiled" scores a free-text hit for Tile', scopeRelevance(entry('Tile', 'earned'), { scope: 'tiled shower walls' }) === 2);

console.log('\nshort-form aliases (re-review A4 — scored explicitly, so a regression fails here, not by fixture order):');
// The old "re-roof the garage ranks Roofing first" check passed only because
// Roofing sits first in the fixture: atWordStart('roofing', 're-roof') is
// false, so every shell trade tied at +1 and the book order broke the tie.
// Each case below asserts the SCORE, and the ranking case reverses the book.
ok('"re-roof the garage" is a FREE-TEXT hit for Roofing (2) — not merely the type nudge', scopeRelevance(entry('Roofing', 'earned'), { scope: 're-roof the garage' }) === 2);
{
  const hints = { projectType: 'Addition', scope: 're-roof the garage' };
  ok('… with an Addition every shell trade gets +1, Roofing alone reaches 3', scopeRelevance(entry('Roofing', 'earned'), hints) === 3 && scopeRelevance(entry('Concrete & Masonry', 'earned'), hints) === 1 && scopeRelevance(entry('Lumber & Framing', 'earned'), hints) === 1);
  ok('… and Roofing ranks first even when it is LAST by exposure', names(selectGroundingEntries([...book].reverse(), hints, 20))[0] === 'Roofing');
}
ok('"reroof" (one word) reaches Roofing', scopeRelevance(entry('Roofing', 'earned'), { scope: 'reroof and new gutters' }) === 2);
ok('"electric" reaches Electrical', scopeRelevance(entry('Electrical', 'earned'), { scope: 'new electric service to the shop' }) === 2);
ok('"electrician" reaches Electrical', scopeRelevance(entry('Electrical', 'earned'), { scope: 'electrician for the sub-panel' }) === 2);
ok('"plumber" reaches Plumbing', scopeRelevance(entry('Plumbing', 'seeded'), { scope: 'plumber to move the drain' }) === 2);
ok('"framer" reaches Lumber & Framing', scopeRelevance(entry('Lumber & Framing', 'earned'), { scope: 'framer quoted three days' }) === 2);
ok('"painter" reaches Paint & Finishes', scopeRelevance(entry('Paint & Finishes', 'earned'), { scope: 'painter for two coats' }) === 2);
ok('aliases stay word-anchored: "fireproofing" / "waterproofing" do not reach Roofing', scopeRelevance(entry('Roofing', 'earned'), { scope: 'fireproofing and waterproofing the pan' }) === 0);
ok('an alias never fires for a trade that has none: "framer" does not reach Roofing', scopeRelevance(entry('Roofing', 'earned'), { scope: 'framer quoted three days' }) === 0);

console.log('\nsource assertions:');
{
  const wizard = src('app/estimate-wizard.tsx');
  ok('wizard: chip label comes from groundingChipLabel', /groundingChipLabel\(/.test(wizard));
  ok('wizard: no longer counts groundingFacts.length as learned rates', !/groundingFacts\.length\} learned rate/.test(wizard));
  ok('wizard: grounds through selectGroundingEntries, not entries.slice(0, 6)', /selectGroundingEntries\(/.test(wizard) && !/costDb\.entries\.slice\(0, 6\)/.test(wizard));
  ok('wizard (review B1): grounding is computed inside generate from the answers actually sent', /const used = groundingFor\(a\)/.test(wizard) && /selectGroundingEntries\(costDb\.entries, hintsFrom\(a\), 6\)/.test(wizard));
  ok('wizard (review B1): the prompt is built from that same bundle', /buildEstimatePrompt\(a, used\.facts\)/.test(wizard));
  ok('wizard (re-review B2): the cache key is derived from the PROMPT string — not scopeCacheKey + a facts hash', /const cacheKey = 'wizard::' \+ stableHash\(prompt\)/.test(wizard) && !/scopeCacheKey/.test(wizard) && !/used\.facts\.join/.test(wizard));
  ok('wizard (review B1): chip, seed CTA and loader key on the stored bundle, not a memo', (wizard.match(/\(groundingUsed \?\? EMPTY_GROUNDING\)\.counts/g) ?? []).length >= 2 && /groundingUsed\?\.selectedCount \?\? 0/.test(wizard) && !/groundingFacts/.test(wizard) && !/useMemo<string\[\]>/.test(wizard));
  ok('wizard (re-review B1): loader copy comes from estimateThinkingSteps on the bundle COUNTS — never selectedCount, no local copy', /thinkingSteps=\{estimateThinkingSteps\(\(groundingUsed \?\? EMPTY_GROUNDING\)\.counts\)\}/.test(wizard) && !/ESTIMATE_THINKING_STEPS_GROUNDED/.test(wizard) && !/selectedCount \?\? 0\) > 0 \?/.test(wizard) && !/Pricing from your history/.test(wizard));
  ok('wizard (review B1): the chip carries the calibration-only flag', /calibration: groundingUsed\?\.calibration/.test(wizard));
  ok('wizard (review B1): reset clears the stored bundle', /setGroundingUsed\(null\)/.test(wizard));
  ok('wizard (re-review A3): estimate_generated carries the RUN counts — used_learned_costs cannot fire for a seeded-only run', /estimateGroundingProps\(costDb, used\.counts\)/.test(wizard) && !/estimateGroundingProps\(costDb\)/.test(wizard) && /AnalyticsEvents\.ESTIMATE_GENERATED/.test(wizard) && /path: 'wizard_generated'/.test(wizard));
  ok('wizard (re-review A5): a run counter orphans a cancelled run — its result, its error and its finally', /const runRef = useRef\(0\)/.test(wizard) && /const runId = \+\+runRef\.current/.test(wizard) && (wizard.match(/if \(runRef\.current !== runId\) return;/g) ?? []).length >= 2 && /if \(runRef\.current === runId\) setLoading\(false\)/.test(wizard) && /const cancelGenerate = useCallback\(\(\) => \{\s*runRef\.current \+= 1;/.test(wizard));
  ok('wizard (re-review A6): the loader subtitle does not claim retrieval', !/Pulling materials, labor/.test(wizard) && /nothing is pulled from a price list/.test(wizard));
  ok('wizard (UX-F14/F18): no bare router.back() — a cold-start deep link into a gestureEnabled:false modal must still escape', !/router\.back\(\)/.test(wizard) && /useSafeBack\(\)/.test(wizard) && /safeBack\(\)/.test(wizard));
  const quick = src('components/AIQuickEstimate.tsx');
  ok('quick estimate: chip label comes from groundingChipLabel', /groundingChipLabel\(/.test(quick) && !/\$\{learnedRateCount\} learned rate/.test(quick));
  ok('quick estimate (re-review A2): grounding is chosen per run from the description + type and snapshotted next to the result', /groundingFor\(\{ projectType, scope: description \}\)/.test(quick) && /setResultGrounding\(used\)/.test(quick) && /useState<GroundingBundle \| null>/.test(quick) && /used\.facts,/.test(quick));
  ok('quick estimate (re-review A2): the chip reads the snapshot, never a live prop, and carries the calibration flag', /\(resultGrounding \?\? EMPTY_GROUNDING\)\.counts/.test(quick) && /calibration: resultGrounding\?\.calibration/.test(quick) && !/learnedRateCount/.test(quick) && !/seededRateCount/.test(quick));
  ok('quick estimate (re-review A2): reset clears the snapshot', /setResultGrounding\(null\)/.test(quick));
  const full = src('app/(tabs)/estimate/full.tsx');
  ok('estimator (re-review A2): Quick Estimate grounds through selectGroundingEntries with the run hints, not entries.slice(0, 6)', !/costDb\.entries\.slice\(0, 6\)/.test(full) && /selectGroundingEntries\(costDb\.entries, hints, 6\)/.test(full) && /groundingFor=\{quickEstimateGroundingFor\}/.test(full));
  ok('estimator: the bundle is built by buildGroundingFacts — measured count, groundingFactLine wording, calibration as a fact', /buildGroundingFacts\(/.test(full) && !/rateCount: costDb\.entries\.length/.test(full) && !/on your jobs \(\$\{e\.confidence\}/.test(full));
  // AI-F(audit 2026-09-07, ai-features): AIEstimateValidator scores the bid
  // "against industry standards" with nothing retrieved behind the phrase,
  // while computeCalibration — measured bias from TRACED actuals only — sat
  // uncalled. The deterministic answer now renders above the AI card, the way
  // MorningBriefCard sits beside the AI briefing on Home.
  ok('estimator: the measured calibration is computed for the validator, not just for Quick Estimate', /const validatorCalibration = useMemo\(/.test(full) && (full.match(/computeCalibration\(\{ projects, commitments \}\)/g) ?? []).length >= 2);
  ok('estimator: it renders ABOVE the AI validator, not after it', (() => {
    const cal = full.indexOf('testID="estimate-calibration"');
    const val = full.indexOf('<AIEstimateValidator');
    return cal > 0 && val > 0 && cal < val;
  })());
  // Counted, not merely present. A bare `.test()` passed a mutation that
  // swapped the rendered NUMBER for the word "several" and left the count only
  // in the singular/plural ternary beside it — the chip said "several jobs"
  // and the guard reported green (verified 2026-09-07). Each figure has to
  // appear twice: once as the value, once to pluralise its own noun.
  ok('estimator: the calibration chip prints the measured category and job COUNTS, not a vague quantity', (full.match(/validatorCalibration\.summary\.categoryCount/g) ?? []).length >= 2 && (full.match(/validatorCalibration\.summary\.totalJobs/g) ?? []).length >= 2 && /traced\s*\n?\s*actuals/.test(full));
  ok('estimator: the chip refuses the market-average framing', /Not a market average/.test(full) && /your own paid costs against your own bids/.test(full));
  ok('estimator: an empty book says it has nothing measured rather than scoring anyway', /hasData \?/.test(full) && /No traced actuals yet/.test(full));
  const pred = src('components/AIInvoicePredictor.tsx');
  ok('invoice predictor: the chip is the same history object the prompt was built from', /paymentHistoryForInvoice\(invoice, allInvoices\)/.test(pred) && /totalInvoices: history\.paidInvoices/.test(pred) && (pred.match(/history\.summary/g) ?? []).length >= 2);
  ok('invoice predictor: an absent predicted date renders as absent, not as a blank accent slot', /const predictedDate = result\.predictedPaymentDate\.trim\(\)/.test(pred) && /No date returned/.test(pred));
  const equip = src('components/AIEquipmentAdvice.tsx');
  ok('equipment advice: the chip cites the log rows and the rate it multiplied, and names the recall it cannot source', /utilization \{equipment\.utilizationLog\.length === 1 \? 'entry' : 'entries'\}/.test(equip) && /at your \$\{equipment\.dailyRate\.toLocaleString\(\)\}\/day rate/.test(equip) && /no equipment price feed/.test(equip));
  const ai = src('utils/aiService.ts');
  ok('quick estimate prompt (review 4): no "LEARNED RATES FROM YOUR JOBS" heading; measured vs stated spelled out', !/LEARNED RATES FROM YOUR JOBS/.test(ai) && /MEASURED on their jobs or STATED/.test(ai) && /never call a stated rate history/.test(ai));
  const code = src('app/(tabs)/construction-ai/index.tsx');
  ok('code check: the main prompt carries the anti-invention rule (was drill-in only)', (code.match(/Never invent a section number/g) ?? []).length >= 2);
  ok('code check: no "Looking up" copy — nothing was looked up', !/Looking up \{/.test(code) && !/Looking up \$\{/.test(code));
  ok('code check: recall chip is rendered above the codes', /From model recall — verify with your AHJ/.test(code));
  ok('code check (review 6): loading steps recall, they do not scan or check', !/Scanning applicable codes/.test(code) && !/Checking local amendments/.test(code) && /Recalling the codes that apply/.test(code));
  const loader = src('components/CodeCheckLoader.tsx');
  ok('code check loader (review 6): default headline does not claim to read the code', !/Reading the code that governs/.test(loader) && /Recalling the code/.test(loader));
  const ops = src('utils/copilot/estimateEdit/estimateOps.ts');
  ok('estimateOps (review 7): the stale "only reassigns globalMarkup" note is gone', !/currently only/.test(ops) && /AI-F5/.test(ops));
  const card = src('components/home/BrainWatchCard.tsx');
  ok('brain watch: all-clear is gated on the source NOT having failed', /sourceFailed/.test(card) && /Couldn.t reach MAGE/.test(card));
  const hook = src('hooks/useBrainWatch.ts');
  ok('brain watch hook: exposes sourceFailed', /sourceFailed/.test(hook));
  const probe = src('hooks/useMageReachability.ts');
  ok('probe (review B3): never inherits offlineFirst and treats a paused fetch as failed', /networkMode: 'always'/.test(probe) && /query\.isError \|\| query\.isPaused/.test(probe));
  ok('probe (re-review A1): never calls focusManager.setEventListener — nor imports focusManager at all', !/focusManager\.setEventListener\(/.test(probe) && !/import \{[^}]*focusManager/.test(probe) && !/installFocusBridge/.test(probe));
  ok('probe (re-review A1): a module AppState listener gates the ticker and refetches ONLY this key on foreground', /let foregrounded = true/.test(probe) && /AppState\.addEventListener\('change'/.test(probe) && /if \(!foregrounded\) return/.test(probe) && /if \(foregrounded && !was\) probeNow\(client\)/.test(probe) && /queryKey: MAGE_REACHABILITY_QUERY_KEY, type: 'active'/.test(probe) && !/refetchQueries\(\)/.test(probe) && !/invalidateQueries/.test(probe));
  ok('probe (re-review A1): the listener lives with the ticker and this query does not double-probe on web focus', /installForegroundGate\(client\)/.test(probe) && /removeForegroundGate\(\)/.test(probe) && /refetchOnWindowFocus: false/.test(probe));
  ok('probe (review 9): no per-observer refetchInterval — one ref-counted ticker, foreground-gated', !/refetchInterval:/.test(probe) && /acquireTicker/.test(probe) && /releaseTicker/.test(probe));
  const rail = src('components/DesktopActionRail.tsx');
  ok('desktop rail (review 8): "All caught up" requires !sourceFailed, same copy as the card', /sourceFailed \?/.test(rail) && /Couldn't reach MAGE — showing what's on this/.test(rail));
}

// ── the estimate validator scores against HIS numbers, not "industry" ──────
//
// Theme 4 of the 2026-09-07 audit — "the engine is uncalled where it matters
// most". utils/estimateCalibration.ts measures, per category, how this GC's
// finished jobs actually landed against what he estimated, and had eight
// consumers. The estimate VALIDATOR was not one of them: it asked a
// browsing-less relay to score the bid "against industry standards", i.e. a
// benchmark nobody in the conversation holds, for a contractor whose real bias
// is sitting measured in the repo.
{
  const svc = src('utils/aiService.ts');
  ok('validateEstimate no longer asks for a benchmark the relay cannot source',
    !/Validate this estimate against industry standards/.test(svc),
    '"industry standards" is an invented number wearing a confident label');
  ok('validateEstimate takes the calibration report and builds a grounding block',
    /calibration\?: CalibrationReport \| null/.test(svc) && /function calibrationGrounding\(/.test(svc));
  ok('the grounding block tells the model his own history OUTRANKS a general average',
    /Where they disagree, his own history wins/.test(svc));
  ok('with no measured history it says so instead of inventing one',
    /do not invent a benchmark you cannot source/.test(svc),
    'an empty grounding block silently becomes permission to make a number up');

  const panel = src('components/AIEstimateValidator.tsx');
  ok('the caller actually computes and passes the calibration',
    /computeCalibration\(\{ projects, commitments \}\)/.test(panel) && /\n\s*calibration,\n/.test(panel),
    'a grounding parameter nothing passes is the same ungrounded panel with extra code');
  ok('the panel carries a grounding chip naming what the score was measured against',
    /groundingChip/.test(panel) && /not an industry average/.test(panel) && /No finished jobs measured yet/.test(panel));
}

// ── Plan Review cites the ADOPTED edition, not "general IRC/IBC" ──────────
//
// Same theme-4 pattern as the estimate validator above. Code Check resolved the
// jurisdiction's adopted code and showed a chip saying which; Plan Review — one
// toggle to its left, in the same screen, on the same jobsite — asked the model
// for "general IRC/IBC guidance". A GC does not build to a general IRC. He
// builds to the edition his AHJ adopted, and the two differ in exactly the
// places a plan examiner stops him.
{
  const fn = src('supabase/functions/analyze-plan-code/index.ts');
  ok('the plan-review prompt accepts a jurisdiction block',
    /jurisdictionBlock\?: string;/.test(fn) && /const juris = req\.jurisdictionBlock/.test(fn));
  ok('…and instructs the model to cite the adopted edition when it has one',
    /Cite the ADOPTED edition named above/.test(fn) && /Never invent a local amendment that is not listed/.test(fn));
  ok('…while keeping the honest fallback when there is no adoption record',
    /give general IRC\/IBC guidance and do not invent local amendments/.test(fn),
    'without a resolved jurisdiction the prompt must stay general, not guess an edition');
  ok('an empty block does not leave a blank line in the prompt',
    /\]\.filter\(Boolean\)\.join/.test(fn));

  const screen = src('app/(tabs)/construction-ai/index.tsx');
  ok('Plan Review resolves the jurisdiction from ITS OWN project, not the Code Check field',
    /resolveCodeJurisdiction\(jobsiteAddressForProject\(planProject\)\)/.test(screen),
    'the two tabs answer questions about different jobs and must not share one resolution');
  ok('…and actually passes the block to the reviewer',
    /jurisdictionBlock: planGrounding\.promptBlock/.test(screen),
    'a grounding parameter nothing passes is the same ungrounded feature with extra code');
  ok('…and shows a chip naming the code the sheet was checked against',
    /testID="plan-review-jurisdiction-chip"/.test(screen) && /planGrounding\.chipLabel/.test(screen));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
