// scripts/validate-building-scope-triggers.ts
//
// Bet 1 ("The Building Prices Itself"), first slice: the two building-age
// rules (utils/buildingScopeTriggers), their year sources (utils/buildingYear),
// the seam into Scope Code Gaps (utils/scopeGaps) and the card's copy.
//   • no year → nothing fires; RRP before 1978 only (1978 does not fire),
//     residential only, and only when the scope touches paint, demo, drywall,
//     windows or doors; ACP-5 in NYC only, before 1987 (1987 fires with the
//     April-1 line, 1988 does not);
//   • PLUTO's 0 is unknown, never a year;
//   • pricing only through utils/scopePricing.scopeRateFor: a rate he set
//     prices it ("a rate you set", integer cents); an empty book → "Needs
//     price", out of the total, counted in needsPriceCount;
//   • evaluateScopeGaps without `building` is byte-identical to before;
//   • the copy never says the building has lead or asbestos.
// Pure — no React, no network, no AsyncStorage. Exits non-zero on failure.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILDING_SCOPE_RULES, buildingSeedDraft, buildingYearChip, evaluateBuildingRules, normalizeYearBuilt,
  parsePriceCents, scopeHasBuildingTrigger, type BuildingRulesInput, type BuildingYear,
} from '../utils/buildingScopeTriggers';
import {
  BUILDING_YEAR_KEY, enteredBuildingYear, parseBuildingYears, plutoBuildingYear, resolveBuildingYear,
  withEnteredYear, withoutEnteredYear,
} from '../utils/buildingYear';
import * as COPY from '../utils/buildingScopeCopy';
import { evaluateScopeGaps, isBuildingGap, type ScopeGapsInput } from '../utils/scopeGaps';
import { buildCostDatabase, type CostDatabase } from '../utils/costDatabase';
import { draftsToSeeds } from '../utils/costSeedCore';
import { scopeRateFor } from '../utils/scopePricing';
import { isAppStorageKey } from '../utils/localCacheKeys';
import type { BuildingRecord } from '../utils/buildingRecord';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { console.log(`  PASS ${label}`); passed++; } else { console.error(`  FAIL ${label}`); failed++; }
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (f: string) => readFileSync(join(ROOT, f), 'utf8');

const EMPTY_DB: CostDatabase = { entries: [], jobsAnalyzed: 0, tradesTracked: 0, overallBidAccuracy: null, asOf: '' };
const THIS_YEAR = 2026;
const NYC = { city: 'New York', state: 'NY' };
const JERSEY_CITY = { city: 'Jersey City', county: 'Hudson', state: 'NJ' };
const NASSAU = { city: 'Hempstead', county: 'Nassau', state: 'NY' };
const pluto = (year: number): BuildingYear => ({ year, source: 'pluto', asOf: '25v2' });
const entered = (year: number): BuildingYear => ({ year, source: 'entered', asOf: '2026-09-28' });

function run(lines: string[], over: Partial<BuildingRulesInput> = {}) {
  return evaluateBuildingRules({ lines: lines.map(name => ({ name })), jobKind: 'residential', costDb: EMPTY_DB, year: null, ...over });
}
const rule = (r: ReturnType<typeof run>, id: string) => r.find(g => g.rule.id === id);

// ─── Years ────────────────────────────────────────────────────────────────
console.log('\n── year built');
assert(normalizeYearBuilt(0, THIS_YEAR) === null, 'PLUTO yearBuilt 0 → null');
assert(normalizeYearBuilt(1931, THIS_YEAR) === 1931 && normalizeYearBuilt('1955', THIS_YEAR) === 1955, 'a whole year reads as itself (number or text)');
assert(normalizeYearBuilt(1599, THIS_YEAR) === null && normalizeYearBuilt(THIS_YEAR + 1, THIS_YEAR) === null, 'outside 1600..this year → null');
assert(normalizeYearBuilt(1931.5, THIS_YEAR) === null && normalizeYearBuilt(null, THIS_YEAR) === null && normalizeYearBuilt('19x1', THIS_YEAR) === null, 'fractions, null and junk → null');
{
  const rec = (yearBuilt: number | null, plutoVersion: string | null) => ({
    fetchedAt: '2026-09-25T14:30:00.000Z',
    parcel: { yearBuilt, plutoVersion, asOf: '2026-09-24T00:00:00.000Z' },
  }) as unknown as BuildingRecord;
  const r = plutoBuildingYear({ phase: 'ready', record: rec(1931, '25v2') }, THIS_YEAR);
  assert(r?.year === 1931 && r.source === 'pluto' && r.asOf === '25v2', `ready record → PLUTO 1931, asOf = plutoVersion (${JSON.stringify(r)})`);
  assert(plutoBuildingYear({ phase: 'ready', record: rec(1931, null) }, THIS_YEAR)?.asOf === '2026-09-24T00:00:00.000Z', 'no plutoVersion → the parcel as-of');
  assert(plutoBuildingYear({ phase: 'ready', record: rec(0, '25v2') }, THIS_YEAR) === null, 'PLUTO 0 on a ready record → no year, never 0');
  for (const phase of ['unsupported', 'no_address', 'idle', 'resolving', 'confirm', 'loading', 'error']) {
    assert(plutoBuildingYear({ phase, record: rec(1931, '25v2') }, THIS_YEAR) === null, `phase '${phase}' → PLUTO year unavailable`);
  }
  const both = resolveBuildingYear(entered(1955), pluto(1931));
  assert(both.year?.year === 1955 && both.year.source === 'entered' && both.pluto?.year === 1931, 'entered wins over PLUTO, PLUTO kept alongside');
  assert(resolveBuildingYear(null, pluto(1931)).year?.source === 'pluto', 'no entered year → PLUTO');
  assert(resolveBuildingYear(null, null).year === null, 'neither → null');
}
{
  assert(BUILDING_YEAR_KEY === 'mageid_building_year' && isAppStorageKey(BUILDING_YEAR_KEY), 'the entered-year key is mageid_ (swept at sign-out)');
  assert(JSON.stringify(parseBuildingYears('not json', THIS_YEAR)) === '{}' && JSON.stringify(parseBuildingYears(null, THIS_YEAR)) === '{}'
    && JSON.stringify(parseBuildingYears('[1,2]', THIS_YEAR)) === '{}', 'parse never throws: junk / null / an array → {}');
  const m = parseBuildingYears(JSON.stringify({ a: { year: 1955, enteredAt: '2026-09-28T10:00:00Z' }, b: { year: 0 }, c: 'x', d: { year: 3000 } }), THIS_YEAR);
  assert(Object.keys(m).join() === 'a' && m.a.year === 1955, 'only plausible rows survive the parse');
  const w = withEnteredYear({}, 'p1', 1955, '2026-09-28T10:00:00Z');
  assert(enteredBuildingYear(w.p1, THIS_YEAR)?.asOf === '2026-09-28' && enteredBuildingYear(w.p1, THIS_YEAR)?.source === 'entered', 'entered year: asOf = the entered-on day');
  assert(!('p1' in withoutEnteredYear(w, 'p1')), 'remove drops the row');
}

// ─── Rules ────────────────────────────────────────────────────────────────
console.log('\n── rules');
assert(BUILDING_SCOPE_RULES.length === 2 && BUILDING_SCOPE_RULES.map(r => r.id).join() === 'rrp,acp5', 'two rules only: rrp, acp5');
assert(BUILDING_SCOPE_RULES.every(r => r.price.unit === 'ea' && r.price.qty === 1), 'each is priced one each');
assert(run(['Interior painting']).length === 0 && run(['Interior painting'], { address: NYC }).length === 0, 'no year → nothing fires (even in NYC)');
assert(rule(run(['Interior painting'], { year: pluto(1977) }), 'rrp')?.state === 'gap', '1977 residential + paint fires RRP');
assert(!rule(run(['Interior painting'], { year: pluto(1978) }), 'rrp'), '1978 does NOT fire RRP');
assert(!rule(run(['Interior painting'], { year: pluto(1950), jobKind: 'commercial' }), 'rrp'), 'commercial 1950 does not fire RRP');
assert(!rule(run(['Interior painting'], { year: pluto(1950), projectType: 'commercial' }), 'rrp'), 'projectType commercial does not fire RRP');
assert(!rule(run(['Composite deck'], { year: pluto(1950) }), 'rrp'), "residential 1950 with only 'deck' scope does not fire RRP");
for (const w of ['Demo kitchen', 'Drywall patch', 'Replace windows', 'New door', 'Sanding floors', 'Plaster repair', 'Trim carpentry', 'Sheetrock']) {
  assert(!!rule(run([w], { year: pluto(1950) }), 'rrp'), `'${w}' touches the RRP triggers`);
}
assert(rule(run(['Deck'], { year: pluto(1950), scopeNotes: ['Paint the railings'] }), 'rrp')?.triggeredBy === 'your scope notes', 'a scope note fires it and names the notes');
assert(scopeHasBuildingTrigger([{ name: 'Interior painting' }]) && !scopeHasBuildingTrigger([{ name: 'Composite deck' }]), 'the year row asks only when the scope touches a trigger');
{
  const g = rule(run(['Interior painting'], { year: pluto(1950), address: NYC }), 'acp5');
  assert(!!g, 'NYC 1950 fires ACP-5');
  assert(!!rule(run(['Composite deck'], { year: pluto(1986), address: NYC }), 'acp5'), 'NYC 1986 fires ACP-5 (no scope phrase needed)');
  const g87 = rule(run(['Deck'], { year: pluto(1987), address: NYC }), 'acp5');
  assert(!!g87 && g87.building.lines.includes(COPY.ACP5_1987_LINE), 'NYC 1987 fires with the April-1 line');
  assert(!rule(run(['Deck'], { year: pluto(1988), address: NYC }), 'acp5'), 'NYC 1988 does not fire');
  assert(!rule(run(['Deck'], { year: pluto(1950), address: JERSEY_CITY }), 'acp5'), 'Jersey City (NJ) 1950 does not fire ACP-5');
  assert(!rule(run(['Deck'], { year: entered(1950), address: NASSAU }), 'acp5'), 'Nassau County NY 1950 does not fire ACP-5');
  assert(!!rule(run(['Paint'], { year: entered(1950), address: NASSAU }), 'rrp'), '…but RRP still fires there on an entered year');
  assert(!!rule(run(['Deck'], { year: pluto(1950), address: NYC, jobKind: 'commercial' }), 'acp5'), 'ACP-5 is not residential-only');
  assert(g!.rule.requires === COPY.ACP5_REQUIRES && COPY.ACP5_REQUIRES.startsWith('If this project needs a DOB permit'), 'ACP-5 always says "If this project needs a DOB permit"');
}

// ─── Chips ────────────────────────────────────────────────────────────────
console.log('\n── source chips');
assert(buildingYearChip(pluto(1931)) === 'PLUTO lists built 1931', 'pluto chip');
assert(buildingYearChip(entered(1955)) === 'You entered 1955', 'entered chip');
assert(buildingYearChip(entered(1955), pluto(1931)) === 'You entered 1955 · PLUTO lists 1931', 'both chip');
{
  const p = rule(run(['Paint'], { year: pluto(1931) }), 'rrp')!;
  assert(p.building.sourceChip === 'PLUTO lists built 1931' && p.building.footer === COPY.PLUTO_FOOTER, 'a PLUTO year carries the PLUTO caveat');
  const e = rule(run(['Paint'], { year: entered(1955), pluto: pluto(1931) }), 'rrp')!;
  assert(e.building.sourceChip === 'You entered 1955 · PLUTO lists 1931' && e.building.footer === null, 'an entered year: both named, no PLUTO caveat');
  assert(p.building.lines.includes(COPY.RRP_EXEMPTION), 'RRP names the exemptions');
}

// ─── Pricing ──────────────────────────────────────────────────────────────
console.log('\n── pricing');
{
  const g = rule(run(['Paint'], { year: pluto(1950) }), 'rrp')!;
  assert(!g.priced && g.unitRate === null && g.totalCents === null && g.rateCaption === 'No price of yours yet', 'empty book → priced:false, total null');
  const r = evaluateScopeGaps({ lines: [{ name: 'Paint' }], jobKind: 'residential', costDb: EMPTY_DB, address: NYC, building: { year: pluto(1950) } });
  const bl = r.gaps.filter(isBuildingGap);
  assert(bl.length === 2 && bl.every(x => x.state === 'gap' && !x.priced), 'both building lines on an NYC 1950 paint job, unpriced');
  const codeNeeds = evaluateScopeGaps({ lines: [{ name: 'Paint' }], jobKind: 'residential', costDb: EMPTY_DB, address: NYC }).needsPriceCount;
  assert(r.needsPriceCount === codeNeeds + 2 && r.totalCents === 0, `unpriced lines count in needsPriceCount (${r.needsPriceCount}) and stay out of totalCents`);
}
{
  // A rate he sets from the card: the exact seed path (draftsToSeeds + the book builder).
  const rrp = BUILDING_SCOPE_RULES.find(x => x.id === 'rrp')!;
  const cents = parsePriceCents('1,140.50');
  assert(cents === 114050, `'1,140.50' → 114050 cents (${cents})`);
  const seeds = draftsToSeeds([buildingSeedDraft(rrp, cents!)], { now: '2026-09-28T00:00:00Z', method: 'manual' });
  assert(seeds.length === 1 && seeds[0].trade === 'Lead-safe setup' && seeds[0].rate === 1140.5 && seeds[0].method === 'manual', 'the seed is Lead-safe setup, $1,140.50, manual');
  const db = buildCostDatabase([], [], [], [], seeds);
  const entry = scopeRateFor(db, 'Lead-safe setup', 'ea');
  assert(entry?.provenance === 'seeded', "scopeRateFor finds it with provenance 'seeded'");
  const g = rule(run(['Paint'], { year: pluto(1950), costDb: db }), 'rrp')!;
  assert(g.priced && g.totalCents === 114050 && Number.isInteger(g.totalCents) && g.rateCaption === 'a rate you set', `priced at that rate, caption "a rate you set", integer cents (${g.totalCents}, ${g.rateCaption})`);
  const r = evaluateScopeGaps({ lines: [{ name: 'Paint' }], jobKind: 'residential', costDb: db, building: { year: pluto(1950) } });
  const codeTotal = evaluateScopeGaps({ lines: [{ name: 'Paint' }], jobKind: 'residential', costDb: db }).totalCents;
  assert(r.totalCents === codeTotal + 114050, 'the priced line joins totalCents');
  assert(parsePriceCents('0') === null && parsePriceCents('-5') === null && parsePriceCents('12.345') === null && parsePriceCents('abc') === null && parsePriceCents('') === null,
    'a price that is not a positive amount in cents → null');
  assert(parsePriceCents('$950') === 95000 && parsePriceCents('0.07') === 7 && parsePriceCents('12.5') === 1250, 'dollars and cents parse exactly');
}
{
  // Covered / dismissed.
  const cov = rule(run(['Paint', 'Lead-safe setup (EPA RRP)'], { year: pluto(1950) }), 'rrp');
  assert(cov?.state === 'in_scope', 'a line named after the topic covers RRP');
  const acp = rule(run(['Asbestos survey'], { year: pluto(1950), address: NYC }), 'acp5');
  assert(acp?.state === 'in_scope', "an 'Asbestos survey' line covers ACP-5");
  const d = rule(run(['Paint'], { year: pluto(1950), dismissals: { 'bldg:rrp': { verdict: 'n_a', at: '2026-09-28' } } }), 'rrp');
  assert(d?.state === 'n_a', "the 'bldg:rrp' dismissal hides it");
  const nd = rule(run(['Paint'], { year: pluto(1950), dismissals: { rrp: { verdict: 'n_a', at: '2026-09-28' } } }), 'rrp');
  assert(nd?.state === 'gap', 'an un-namespaced key does not (the namespace is bldg:)');
}

// ─── The seam: no building → byte-identical ───────────────────────────────
console.log('\n── evaluateScopeGaps without building');
{
  const fixture: ScopeGapsInput = {
    lines: [{ name: 'Bedroom addition framing' }, { name: 'Interior painting' }, { name: 'Bath remodel' }],
    scopeNotes: ['Replace windows'], jobKind: 'residential', address: NYC, costDb: EMPTY_DB,
  };
  const a = JSON.stringify(evaluateScopeGaps(fixture));
  const b = JSON.stringify(evaluateScopeGaps({ ...fixture, building: undefined }));
  const c = JSON.stringify(evaluateScopeGaps({ ...fixture, building: null }));
  const d = JSON.stringify(evaluateScopeGaps({ ...fixture, building: { year: null } }));
  assert(a === b && a === c && a === d, 'building undefined / null / year null → the same output as today');
  assert(!evaluateScopeGaps(fixture).gaps.some(isBuildingGap), 'and no building line in it');
  // Today's output, pinned: the sha256 of this fixture's JSON as the base
  // commit 64d397af's utils/scopeGaps.ts produced it (computed once from that
  // file; a change to the code-rule path moves it and must be explained).
  const digest = createHash('sha256').update(a).digest('hex');
  assert(digest === '35760445dae4aeccce0daee120af870792305ecf6ea507e444c5692093d59383', `deep-equal to the 64d397af output (sha256 ${digest.slice(0, 12)})`);
  // …and the code rules this fixture fires.
  const ids = evaluateScopeGaps(fixture).gaps.map(g => g.rule.id).sort().join();
  assert(ids.length > 0 && !ids.includes('rrp') && !ids.includes('acp5'), `code rules only (${ids})`);
}

// ─── Source assertions ────────────────────────────────────────────────────
console.log('\n── source');
const trig = src('utils/buildingScopeTriggers.ts');
const code = trig.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
assert(!/\$\s?\d/.test(code) && !/\b\d{3,}(\.\d\d)?\s*(dollars|usd)\b/i.test(code)
  && !/\b\w*(rate|price|cost|typical|market|amount)\w*\s*[:=]\s*\d/i.test(code)
  && !/\?\s*entry!?\.suggestedRate\s*:\s*\d/.test(code), 'no dollar literal (and no number assigned to a rate, price or cost) in utils/buildingScopeTriggers.ts');
assert(/scopeRateFor\)\(input\.costDb, rule\.price\.trade, rule\.price\.unit\)/.test(code) && !/suggestedRate\s*[:=]\s*\d/.test(code), 'the rules price only via scopeRateFor');
const copyTexts = Object.values(COPY).map(v => (typeof v === 'function' ? String((v as (...a: unknown[]) => string)(1931, 'line 1 "Paint"', 'x', 'y')) : String(v)));
const card = src('components/scopeGaps/ScopeGapsCard.tsx') + src('components/scopeGaps/BuildingYearRow.tsx');
const BAD = /\b(has lead|contains lead|may contain lead|lead is present|contains asbestos|has asbestos|asbestos is present|guaranteed)\b/i;
assert(!copyTexts.some(t => BAD.test(t)) && !BAD.test(trig) && !BAD.test(card), "no 'has lead' / 'contains asbestos' / 'may contain lead' / 'guaranteed' wording");
assert(!copyTexts.some(t => /!|\b(he|his|him|she|her)\b/.test(t)), 'copy: no exclamation marks, no he/his/she/her');
assert(!/\bScopeRuleFamily\b[^;]*'EPA'/.test(src('utils/codeScopeTriggers.ts')), "the model-code family type does not grow 'EPA'");
assert(card.includes('scopegaps-year-row') && card.includes('scopegaps-year-input') && /scopegaps-bldg-\$\{rule\.id\}/.test(card), 'card testIDs: scopegaps-year-row, scopegaps-year-input, scopegaps-bldg-<id>');
assert(card.includes('BUILDING_HEADER_NOTE') && card.includes('SAVED_ON_DEVICE'), 'card shows the reminder note and "Saved on this device."');
assert(/addSeeds\(\[seed\]\)/.test(card) && /draftsToSeeds\(\[buildingSeedDraft/.test(card), 'Set your price seeds through draftsToSeeds + addSeeds');
const hook = src('hooks/useBuildingYear.ts');
assert(!/\.(lookup|confirm|changeBuilding|refresh)\(/.test(hook.replace(/\/\/[^\n]*/g, '')), 'the year hook never calls the building lookup / confirm / refresh');
assert(/try\s*\{[\s\S]*AsyncStorage\.getItem[\s\S]*\}\s*catch/.test(hook) && /try\s*\{[\s\S]*AsyncStorage\.setItem[\s\S]*\}\s*catch/.test(hook), 'every AsyncStorage read and write in the hook is wrapped');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('building-scope-triggers validator FAILED'); process.exit(1); }
console.log('building-scope-triggers validator PASSED');
