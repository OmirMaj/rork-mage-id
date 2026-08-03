// validate-cost-seed.ts — pins the cold-start cost-seeding path.
//
// WHY THIS IS PINNED HARD. MAGE is sold on "it learns your real costs", but
// utils/costDatabase only learns from jobs closed inside the app: with no
// closed jobs it returns entries: [], the estimate wizard's groundingFacts is
// [], and a twenty-year contractor's day-one estimate is a beginner's. Seeding
// is the fix — and it introduces the one thing that could destroy the product's
// credibility: a number the contractor TOLD us being presented as a number we
// MEASURED. Every check below exists to keep those apart.
//
// Covers:
//   1. messy paste input — headers, $, thousands separators, tabs, blank
//      lines, unit aliases, inline "/SF", job counts, dates, dash-separated
//   2. rejection of junk rows, with a reason
//   3. dedupe / merge when the same trade+unit is imported twice
//   4. a seeded book makes matchOwnRate-style lookup SUCCEED
//   5. seeded entries stay distinguishable from earned ones — in the sample,
//      in the entry, in the database rollup, and in the provenance label
//   6. a real closed job outweighs and corrects the seed
//
// Run: bun run scripts/validate-cost-seed.ts

import {
  parseSeedLine, parseSeedBlob, canonicalSeedUnit, seedKey, seedId,
  draftsToSeeds, mergeSeeds, seedsToCostSamples, isSeedSample, describeSeed,
  SEED_PROJECT_PREFIX, SEED_UNITS,
  type SeededRate, type SeededRateDraft,
} from '../utils/costSeedCore';
import { buildCostDatabase, lookupRate } from '../utils/costDatabase';
import { matchOwnRate, normalizeUnit, priceSourceLabel } from '../utils/takeoffPricing';
import { REQUIRED_TIER } from '../utils/featureTiers';
import type { Project, Commitment } from '../types';
// fileURLToPath + join because the repo path contains a space.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function expect<T>(name: string, got: T, want: T) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { pass++; console.log('  ✓', name); }
  else {
    fail++;
    console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want));
  }
}

/** Convenience: parse one line and return the draft, or null. */
function row(line: string): SeededRateDraft | null {
  const out = parseSeedLine(line);
  return out.status === 'row' ? out.draft : null;
}
/** Convenience: parse one line and return the rejection reason, or null. */
function reject(line: string): string | null {
  const out = parseSeedLine(line);
  return out.status === 'rejected' ? out.reason : null;
}

const NOW = '2026-01-15T00:00:00.000Z';

console.log('\ncost seeding (your prices on day one, without pretending they are history):');

// ═══════════════════════════════════════════════════════════════════════════
// 1. Units — aliases, and the round-trip that makes matching work at all
// ═══════════════════════════════════════════════════════════════════════════

expect('SF stays SF', canonicalSeedUnit('SF'), 'SF');
expect('sqft → SF', canonicalSeedUnit('sqft'), 'SF');
expect('SQ FT → SF', canonicalSeedUnit('SQ FT'), 'SF');
expect('square feet → SF', canonicalSeedUnit('square feet'), 'SF');
expect('LNFT → LF', canonicalSeedUnit('LNFT'), 'LF');
expect('lin. ft. → LF', canonicalSeedUnit('lin. ft.'), 'LF');
expect('each → EA', canonicalSeedUnit('Each'), 'EA');
expect('unit → EA', canonicalSeedUnit('unit'), 'EA');
expect('hours → HR', canonicalSeedUnit('hours'), 'HR');
expect('cu yd → CY', canonicalSeedUnit('cu yd'), 'CY');
expect('a trade name is NOT a unit', canonicalSeedUnit('Framing'), null);
expect('empty is NOT a unit', canonicalSeedUnit('   '), null);

// THE INVARIANT: costSeedCore's canonical labels must normalize, under
// takeoffPricing.normalizeUnit, to the same token an earned entry would. If
// this drifts, a seeded SF rate silently stops matching an SF takeoff line and
// the whole feature quietly does nothing.
for (const u of SEED_UNITS) {
  const viaSeed = normalizeUnit(u);
  const viaAlias = normalizeUnit(u.toLowerCase());
  ok(`seed unit ${u} round-trips through normalizeUnit (${viaSeed})`,
    viaSeed === viaAlias && viaSeed.length > 0);
}
expect('a seeded SF and a takeoff SQFT line normalize alike',
  normalizeUnit(canonicalSeedUnit('sqft') as string), normalizeUnit('SQFT'));

// ═══════════════════════════════════════════════════════════════════════════
// 2. Messy paste input
// ═══════════════════════════════════════════════════════════════════════════

expect('plain comma row', row('Framing, SF, 12.50'),
  { trade: 'Framing', unit: 'SF', rate: 12.5, raw: 'Framing, SF, 12.50' });

expect('dollar sign is stripped', row('Framing, SF, $12.50')?.rate, 12.5);

expect('thousands separator survives the comma split',
  row('Steel erection, TON, $1,250')?.rate, 1250);
expect('multi-group thousands separator', row('Modular unit, EA, $1,250,000')?.rate, 1250000);

expect('tab-delimited (spreadsheet column copy)',
  row('Drywall\tSF\t$3.20'), { trade: 'Drywall', unit: 'SF', rate: 3.2, raw: 'Drywall\tSF\t$3.20' });

expect('semicolon-delimited', row('Paint; SF; 1.85')?.rate, 1.85);
expect('pipe-delimited', row('Paint | SF | 1.85')?.rate, 1.85);

expect('inline /unit on the rate needs no unit column',
  row('Framing, $12.50/SF'), { trade: 'Framing', unit: 'SF', rate: 12.5, raw: 'Framing, $12.50/SF' });
expect('"per sf" reads the same as "/SF"', row('Framing, $12.50 per sf')?.unit, 'SF');

expect('em-dash separated, no commas at all',
  row('Framing — $12.50/SF — 14 jobs'),
  { trade: 'Framing', unit: 'SF', rate: 12.5, reportedJobs: 14, raw: 'Framing — $12.50/SF — 14 jobs' });

expect('single-space row still parses, multi-word trade intact',
  row('Interior Paint $1.85/SF'),
  { trade: 'Interior Paint', unit: 'SF', rate: 1.85, raw: 'Interior Paint $1.85/SF' });

expect('multi-word trade in a comma row', row('Drywall hang & finish, SF, 3.20')?.trade,
  'Drywall hang & finish');

expect('a trailing bare integer is read as the job count',
  row('Framing, SF, 12.50, 8')?.reportedJobs, 8);
expect('the decimal wins the rate slot even when it comes second',
  [row('Framing, SF, 8, 12.50')?.rate, row('Framing, SF, 8, 12.50')?.reportedJobs], [12.5, 8]);
expect('"22 jobs" is a job count, not a rate',
  [row('Concrete, CY, $185, 22 jobs')?.rate, row('Concrete, CY, $185, 22 jobs')?.reportedJobs],
  [185, 22]);
expect('an absurd job count is dropped, not stored',
  row('Framing, SF, $12.50, 9999')?.reportedJobs, undefined);

expect('ISO date is captured', row('Framing, SF, $12.50, 2025-11-03')?.asOf, '2025-11-03');
expect('US date is normalized to ISO', row('Framing, SF, $12.50, 3/9/25')?.asOf, '2025-03-09');

expect('trailing free text becomes a note',
  row('Framing, SF, 12.50, includes labor')?.note, 'includes labor');

expect('rate is rounded to cents', row('Framing, SF, 12.5049')?.rate, 12.5);

// Case + whitespace tolerance
expect('lowercase unit column', row('framing, sf, 12.50')?.unit, 'SF');
expect('padded fields', row('   Framing ,  SF ,  $12.50   ')?.trade, 'Framing');
expect('quoted trade is unquoted', row('"Framing", SF, 12.50')?.trade, 'Framing');

// ═══════════════════════════════════════════════════════════════════════════
// 3. Headers, blanks, junk
// ═══════════════════════════════════════════════════════════════════════════

expect('header row is skipped, not rejected',
  parseSeedLine('Trade, Unit, Rate').status, 'skipped');
expect('tab header is skipped', parseSeedLine('Trade\tUOM\tUnit Cost\tJobs').status, 'skipped');
expect('blank line is skipped', parseSeedLine('   ').status, 'skipped');

ok('a row with no price is rejected with a reason',
  (reject('Framing, SF') ?? '').includes('rate'), String(reject('Framing, SF')));
ok('a row with no unit is rejected with a reason',
  (reject('Framing, 12.50') ?? '').toLowerCase().includes('unit'), String(reject('Framing, 12.50')));
ok('a row with no trade is rejected with a reason',
  (reject('SF, 12.50') ?? '').toLowerCase().includes('trade'), String(reject('SF, 12.50')));
ok('a zero rate is rejected (a $0 unit cost is not a price)',
  reject('Framing, SF, 0') !== null, String(reject('Framing, SF, 0')));
ok('an absurd rate is rejected rather than poisoning the book',
  (reject('Framing, SF, $99,000,000') ?? '').includes('typo'), String(reject('Framing, SF, $99,000,000')));
ok('a legitimately huge EA line is NOT treated as a typo',
  row('Modular unit, EA, $1,250,000')?.rate === 1250000);
ok('pure prose is rejected', reject('call me about the kitchen job') !== null);

// A junk row must never sneak through as a real rate.
expect('junk yields no draft', row('lorem ipsum dolor'), null);

// ═══════════════════════════════════════════════════════════════════════════
// 4. Whole-blob parsing
// ═══════════════════════════════════════════════════════════════════════════

const BLOB = [
  'Trade,Unit,Rate,Jobs',
  '',
  'Framing, SF, $12.50, 14',
  'Drywall hang & finish\tSQFT\t$3.20',
  '   ',
  'Electrical rough-in, each, $145, 6',
  'Concrete flatwork, cu yd, $1,250',
  'this line has no numbers at all',
  'Framing, SF, $13.10',
].join('\n');

const parsed = parseSeedBlob(BLOB);
ok('header row detected', parsed.headerSkipped);
expect('4 usable rates from a messy 9-line paste', parsed.rows.length, 4);
expect('1 junk line rejected', parsed.rejected.length, 1);
ok('the rejection carries the offending text',
  parsed.rejected[0].raw === 'this line has no numbers at all',
  parsed.rejected[0]?.raw);
expect('duplicate framing rows collapsed to one', parsed.duplicates, 1);
expect('the LAST framing row wins (a correction, not a duplicate)',
  parsed.rows.find(r => r.trade === 'Framing')?.rate, 13.1);
expect('SQFT normalized to SF on the way in',
  parsed.rows.find(r => r.trade.startsWith('Drywall'))?.unit, 'SF');
expect('"each" normalized to EA',
  parsed.rows.find(r => r.trade.startsWith('Electrical'))?.unit, 'EA');
expect('"cu yd" normalized to CY',
  parsed.rows.find(r => r.trade.startsWith('Concrete'))?.unit, 'CY');
expect('CRLF line endings parse identically',
  parseSeedBlob(BLOB.replace(/\n/g, '\r\n')).rows.length, 4);
expect('empty blob yields nothing, throws nothing', parseSeedBlob('').rows.length, 0);

// ═══════════════════════════════════════════════════════════════════════════
// 5. Ids, dedupe, merge
// ═══════════════════════════════════════════════════════════════════════════

expect('seedKey matches how costDatabase keys entries', seedKey('Framing', 'SF'), 'framing|sf');
expect('seedKey is case/whitespace insensitive', seedKey('  FRAMING ', ' sf '), 'framing|sf');
expect('ids are deterministic from trade+unit', seedId('Framing', 'SF'), seedId('framing', 'sf'));
ok('different units get different ids', seedId('Framing', 'SF') !== seedId('Framing', 'LF'));

const firstImport = draftsToSeeds(
  [{ trade: 'Framing', unit: 'SF', rate: 12.5, raw: 'x' },
   { trade: 'Drywall', unit: 'SF', rate: 3.2, raw: 'y' }],
  { now: NOW },
);
const secondImport = draftsToSeeds(
  [{ trade: 'Framing', unit: 'SF', rate: 13.75, raw: 'z' },
   { trade: 'Electrical', unit: 'EA', rate: 145, raw: 'w' }],
  { now: NOW },
);
const merged = mergeSeeds(firstImport, secondImport);
expect('merge keeps one row per trade+unit', merged.merged.length, 3);
expect('re-importing the same scope REPLACES, it does not stack',
  merged.merged.filter(s => s.trade === 'Framing').length, 1);
expect('the re-imported rate wins',
  merged.merged.find(s => s.trade === 'Framing')?.rate, 13.75);
expect('merge reports what changed', [merged.added, merged.replaced], [1, 1]);
expect('merging an empty batch is a no-op',
  mergeSeeds(firstImport, []).merged.length, firstImport.length);
expect('drafts carry the entry method', firstImport[0].method, 'paste');
expect('manual entry is labelled as such',
  draftsToSeeds([{ trade: 'Framing', unit: 'SF', rate: 12.5, raw: '' }],
    { now: NOW, method: 'manual' })[0].method, 'manual');

// ═══════════════════════════════════════════════════════════════════════════
// 6. Seeds → cost samples: the provenance firewall
// ═══════════════════════════════════════════════════════════════════════════

const SEEDS: SeededRate[] = draftsToSeeds([
  { trade: 'Framing', unit: 'SF', rate: 12.5, reportedJobs: 14, raw: '' },
  { trade: 'Electrical', unit: 'EA', rate: 145, raw: '' },
], { now: NOW });

const samples = seedsToCostSamples(SEEDS);
expect('one sample per seed', samples.length, 2);
expect('samples are basis=seeded, never actual/committed',
  samples.every(s => s.basis === 'seeded'), true);
expect('samples carry source=seed', samples.every(s => s.source === 'seed'), true);
ok('the synthetic projectId is prefixed so it can never be mistaken for a job',
  samples.every(s => s.projectId.startsWith(SEED_PROJECT_PREFIX)), samples[0].projectId);
expect('quantity is 1 — a single vote a real job outweighs',
  samples.every(s => s.quantity === 1), true);
expect('bidUnit is 0 so a seed can never move bid bias',
  samples.every(s => s.bidUnit === 0), true);
expect('a seed with no stated date claims no recency',
  samples.every(s => s.closedAt === ''), true);
expect('isSeedSample recognizes them', samples.every(isSeedSample), true);
expect('isSeedSample rejects a real closed-job sample',
  isSeedSample({ projectId: 'p1', source: undefined }), false);
expect('a zero-rate seed is dropped on the way into the book',
  seedsToCostSamples([{ ...SEEDS[0], rate: 0 }]).length, 0);

// ═══════════════════════════════════════════════════════════════════════════
// 7. A seeded book: it must PRICE, and it must stay labelled
// ═══════════════════════════════════════════════════════════════════════════

const emptyProjects: Project[] = [];
const emptyCommitments: Commitment[] = [];

const cold = buildCostDatabase(emptyProjects, emptyCommitments, [], [], []);
expect('no jobs, no seeds → the empty book that started all this',
  cold.entries.length, 0);

const seeded = buildCostDatabase(emptyProjects, emptyCommitments, [], [], SEEDS);
expect('a seeded book is NOT empty — this is the whole fix', seeded.entries.length, 2);
expect('…so groundingFacts would be non-empty', seeded.entries.length > 0, true);

const framing = lookupRate(seeded, 'Framing', 'SF');
ok('the seeded trade is findable by lookupRate', framing !== null);
expect('the suggested rate IS the stated rate — no silent blending toward nothing',
  framing?.suggestedRate, 12.5);
expect('personalRate is the stated rate', framing?.personalRate, 12.5);

// The firewall, at the entry level.
expect('a seeded entry counts ZERO real jobs', framing?.jobCount, 0);
expect('a seeded entry is flagged seeded', framing?.provenance, 'seeded');
expect('a seeded entry reports its seeded sample count', framing?.seededSampleCount, 1);
expect('confidence stays low on a stated rate', framing?.confidence, 'low');

// The firewall, at the database level.
expect('jobsAnalyzed is NOT inflated by seeds — "0 closed jobs" stays true',
  seeded.jobsAnalyzed, 0);
expect('tradesSeededOnly names how much of the book is unproven',
  seeded.tradesSeededOnly, 2);
expect('bid accuracy is null, not a fake 100%, when nothing is measured',
  seeded.overallBidAccuracy, null);

// THE POINT: matchOwnRate must succeed on a seeded book.
const seededBook = seeded.entries;
const m = matchOwnRate({ description: 'Exterior wall framing', unit: 'SQFT' }, seededBook);
ok('a seeded book prices a takeoff line (matchOwnRate succeeds)', m !== null);
expect('…at the contractor\'s own rate', m?.rate, 12.5);
expect('…carried with seeded provenance', m?.provenance, 'seeded');
expect('…and honestly zero jobs', m?.jobCount, 0);
ok('the provenance label says "you set this", never a job count',
  priceSourceLabel('yours', m).includes('you set this') &&
  !/\d+ jobs?/.test(priceSourceLabel('yours', m)),
  priceSourceLabel('yours', m));

// Unit safety is not relaxed for seeds.
expect('a seeded $/SF rate still never prices an EA line',
  matchOwnRate({ description: 'Framing', unit: 'EA' }, seededBook), null);
// An unrelated trade still gets nothing.
expect('a seeded book does not invent a rate for an unseeded trade',
  matchOwnRate({ description: 'Asphalt paving', unit: 'SF' }, seededBook), null);

// Backward compatibility: the 5th arg is additive.
expect('omitting seeds is byte-identical to passing []',
  JSON.stringify({ ...buildCostDatabase(emptyProjects, emptyCommitments, [], []), asOf: 'x' }),
  JSON.stringify({ ...buildCostDatabase(emptyProjects, emptyCommitments, [], [], []), asOf: 'x' }));

// ═══════════════════════════════════════════════════════════════════════════
// 8. Measurement beats a claim: a real closed job corrects the seed
// ═══════════════════════════════════════════════════════════════════════════
//
// buildCostDatabase reads closed-job actuals through computeEstimateActuals,
// which needs a whole Project + estimate shape. Labor samples take the same
// CostSample path with far less scaffolding, so we use one as the stand-in for
// "something MAGE actually measured" — it exercises the identical grouping,
// weighting and provenance code.

const realSample = {
  projectId: 'proj-real-1',
  projectName: 'Oak St Remodel',
  trade: 'Framing',
  unit: 'SF',
  quantity: 1200,          // a real job's real quantity
  bidUnit: 13,
  actualUnit: 15,          // what it actually cost
  basis: 'actual' as const,
  closedAt: '2026-01-10',
};

const mixed = buildCostDatabase(emptyProjects, emptyCommitments, [], [realSample], SEEDS);
const mixedFraming = lookupRate(mixed, 'Framing', 'SF');
ok('the seed and the real job land on the SAME entry', mixedFraming !== null);
expect('the entry is now flagged mixed', mixedFraming?.provenance, 'mixed');
expect('the real job counts as one job; the seed still counts as none',
  mixedFraming?.jobCount, 1);
expect('the seed is still visible as a seeded sample', mixedFraming?.seededSampleCount, 1);
expect('two samples total', mixedFraming?.sampleCount, 2);
ok('the measured rate dominates the quantity-weighted mean (1200 SF vs 1 vote)',
  (mixedFraming?.personalRate ?? 0) > 14.99,
  `personalRate=${mixedFraming?.personalRate}`);
ok('the suggested rate has moved off the seeded 12.50 toward the measured 15',
  (mixedFraming?.suggestedRate ?? 0) > 12.5,
  `suggestedRate=${mixedFraming?.suggestedRate}`);
expect('jobsAnalyzed counts the real job only', mixed.jobsAnalyzed, 1);
expect('tradesSeededOnly drops as trades get proven out', mixed.tradesSeededOnly, 1);
ok('bid accuracy is computed now that something real exists',
  mixed.overallBidAccuracy !== null, String(mixed.overallBidAccuracy));

const mixedMatch = matchOwnRate({ description: 'Framing', unit: 'SF' }, mixed.entries);
expect('a mixed entry reports mixed provenance to the pricer',
  mixedMatch?.provenance, 'mixed');
ok('the mixed label still admits the seed is in there',
  priceSourceLabel('yours', mixedMatch).includes('set rate'),
  priceSourceLabel('yours', mixedMatch));

// An earned-only entry must be untouched by any of this.
const earnedOnly = buildCostDatabase(emptyProjects, emptyCommitments, [], [realSample], []);
const earnedFraming = lookupRate(earnedOnly, 'Framing', 'SF');
expect('an earned entry is flagged earned', earnedFraming?.provenance, 'earned');
expect('an earned entry has no seeded samples', earnedFraming?.seededSampleCount, 0);
const earnedMatch = matchOwnRate({ description: 'Framing', unit: 'SF' }, earnedOnly.entries);
ok('the earned label is unchanged — "Your rate — Framing, 1 job"',
  priceSourceLabel('yours', earnedMatch).startsWith('Your rate — Framing, 1 job'),
  priceSourceLabel('yours', earnedMatch));

// ═══════════════════════════════════════════════════════════════════════════
// 9. Display helper
// ═══════════════════════════════════════════════════════════════════════════

expect('describeSeed reads as a claim, with the self-reported count',
  describeSeed(SEEDS[0]), '$12.50/SF · you say 14 jobs');
expect('describeSeed omits the count when there isn\'t one',
  describeSeed(SEEDS[1]), '$145.00/EA');

// ═══════════════════════════════════════════════════════════════════════════
// 10. Reachability — this repo has shipped fully-built screens nobody could
//     reach. A cold-start fix that can't be found fixes nothing.
// ═══════════════════════════════════════════════════════════════════════════

const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

ok('the seeding screen exists', existsSync(join(ROOT, 'app', 'cost-seed.tsx')));
ok('…and is registered as a route in app/_layout.tsx',
  /name="cost-seed"/.test(src('app/_layout.tsx')));
ok('…and is in the feature registry (universal search finds it)',
  /route: '\/cost-seed'/.test(src('utils/featureRegistry.ts')));
ok('…and in the desktop sidebar (parity with the registry)',
  /route: '\/cost-seed'/.test(src('components/DesktopSidebar.tsx')));
ok('…and Settings links to it',
  /'\/cost-seed'/.test(src('app/(tabs)/settings/index.tsx')));
ok('…and first-run onboarding has the rates step',
  /'rates'/.test(src('app/onboarding.tsx')) &&
  /parseSeedBlob/.test(src('app/onboarding.tsx')));

const wizard = src('app/estimate-wizard.tsx');
ok('the estimate wizard actually feeds seeds into the cost book',
  /buildCostDatabase\(projects, commitments, receipts, laborSamples, seeds\)/.test(wizard));
ok('…and its empty cost book points at the fix instead of just confessing',
  /\/cost-seed/.test(wizard),
  'the "priced from market averages" state must be actionable');
ok('the cost database empty state offers seeding as step one',
  /'\/cost-seed'/.test(src('app/cost-database.tsx')));
ok('the takeoff pricer sees seeds too',
  /buildCostDatabase\(projects, commitments \?\? \[\], \[\], \[\], seeds\)/.test(src('app/takeoff-estimate.tsx')));

// Tenant safety: a new mageid_* per-user key that isn't wiped on sign-out
// leaks one contractor's pricing to the next person on a shared device.
ok('mageid_cost_seeds is wiped on tenant switch (LOCAL_USER_CACHE_KEYS)',
  /'mageid_cost_seeds'/.test(src('contexts/AuthContext.tsx')));

// The tier gate must be the honest one, and it must be reachable at Pro.
ok('the screen gates on job_costing (Pro), not a Business key',
  /canAccess\('job_costing'\)/.test(src('app/cost-seed.tsx')));
expect('job_costing is still a Pro gate', REQUIRED_TIER.job_costing, 'pro');
expect('the registry entry is gated at Pro too',
  REQUIRED_TIER[
    (/route: '\/cost-seed'[^}]*requires: '([a-z_]+)'/.exec(src('utils/featureRegistry.ts'))?.[1] ??
      'job_costing') as keyof typeof REQUIRED_TIER
  ],
  'pro');

// Purity: bun must be able to run the core, and the validator IS the proof —
// but pin it so nobody imports a component into it later.
const core = src('utils/costSeedCore.ts');
ok('costSeedCore imports nothing from react-native / expo / a hook',
  !/from '(react-native|expo|@\/hooks|@\/components|@\/contexts)/.test(core));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
