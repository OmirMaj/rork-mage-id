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
//   7. DURABILITY (§11): the Postgres round-trip keeps the deterministic id and
//      every provenance-bearing field, the migration's PK is composite, and the
//      hook writes through the offline queue rather than supabase.from()
//   8. REACH (§12): all 16 cost-book consumers actually RECEIVE seeds. These
//      are source-level assertions on purpose — the exact failure this feature
//      already shipped with was "the 5th arg exists and eleven callers don't
//      pass it", which no behavioural test of the engine can catch.
//   9. THE FIREWALL AT EACH NEW SITE (§13): every newly-wired surface is
//      exercised against a seeded-only book and must still refuse to present a
//      stated rate as a measured one.
//
// Run: bun run scripts/validate-cost-seed.ts

import {
  parseSeedLine, parseSeedBlob, canonicalSeedUnit, seedKey, seedId,
  draftsToSeeds, mergeSeeds, seedsToCostSamples, isSeedSample, describeSeed,
  seedToRow, rowToSeed, reconcileSeeds, activeSeeds, pruneTombstones,
  SEED_PROJECT_PREFIX, SEED_UNITS, MAX_SEED_RATE, MAX_REPORTED_JOBS,
  type SeededRate, type SeededRateDraft,
} from '../utils/costSeedCore';
import { buildCostDatabase, lookupRate } from '../utils/costDatabase';
import { matchOwnRate, normalizeUnit, priceSourceLabel } from '../utils/takeoffPricing';
import { REQUIRED_TIER } from '../utils/featureTiers';
import { computeEstimateConfidence } from '../utils/estimateConfidence';
import { buildEstimateSnapshotPayload } from '../utils/brain/estimateSnapshot';
import { computeBidVerdict } from '../utils/judges/computeBidVerdict';
import { buildNarrationPrompt } from '../utils/judges/narrateVerdict';
import { priceTell, DEFAULT_VARIABILITY } from '../utils/costXray';
import { priceLeakItems } from '../utils/profitLeak/priceLeakItems';
import { checkSubBid } from '../utils/profitLeak/subBidCheck';
import type { Project, Commitment, LinkedEstimate } from '../types';
// fileURLToPath + join because the repo path contains a space.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

// ═══════════════════════════════════════════════════════════════════════════
// 11. DURABILITY — a price book that evaporates on reinstall is worse than
//     none, because by then they'd stopped double-checking the numbers
// ═══════════════════════════════════════════════════════════════════════════
//
// V1 was AsyncStorage-only. The data the whole cost moat rests on did not
// survive a reinstall and never reached a second device.

const UID = '11111111-2222-3333-4444-555555555555';

// ── The round trip. The deterministic id is the thing that must survive: it
// is what makes re-importing a corrected spreadsheet an UPDATE rather than a
// second row, both locally (mergeSeeds) and server-side (upsert on the PK).
const rich: SeededRate = draftsToSeeds(
  [{ trade: 'Drywall hang & finish', unit: 'SF', rate: 3.2, reportedJobs: 9, asOf: '2025-11-03', note: 'includes labor', raw: '' }],
  { now: NOW, method: 'manual' },
)[0];

const pgRow = seedToRow(rich, UID);
expect('pgRow carries the deterministic id verbatim', pgRow.id, seedId('Drywall hang & finish', 'SF'));
expect('pgRow is owned — RLS has something to check', pgRow.user_id, UID);
expect('snake_case reaches PostgREST', [pgRow.reported_jobs, pgRow.as_of], [9, '2025-11-03']);

const back = rowToSeed(pgRow);
expect('round-trip preserves the id', back?.id, rich.id);
expect('…and re-deriving from the round-tripped trade+unit lands on the SAME id',
  seedId(back!.trade, back!.unit), rich.id);
expect('round-trip preserves trade / unit / rate',
  [back?.trade, back?.unit, back?.rate], [rich.trade, rich.unit, rich.rate]);
expect('round-trip preserves the self-reported job count (display-only)',
  back?.reportedJobs, 9);
expect('round-trip preserves asOf / note / method',
  [back?.asOf, back?.note, back?.method], ['2025-11-03', 'includes labor', 'manual']);
expect('round-trip normalizes createdAt to canonical ISO', back?.createdAt, NOW);
ok('a Postgres +00:00 timestamp still normalizes to the same instant',
  rowToSeed({ ...pgRow, created_at: '2026-01-15 00:00:00+00' })?.createdAt === NOW);

// THE PROVENANCE ROUND TRIP: a restored seed must still be a CLAIM. If a
// reinstall silently promoted stated rates to measured ones, the restore would
// be worse than the loss it fixed.
const restoredDb = buildCostDatabase(emptyProjects, emptyCommitments, [], [], [back!]);
const restoredEntry = lookupRate(restoredDb, 'Drywall hang & finish', 'SF');
expect('a restored seed is still flagged seeded', restoredEntry?.provenance, 'seeded');
expect('…still counts ZERO jobs — a reinstall does not promote a claim',
  restoredEntry?.jobCount, 0);
expect('…still contributes no bid bias', restoredEntry?.bidBias, 0);
expect('…still leaves overallBidAccuracy null', restoredDb.overallBidAccuracy, null);
expect('…and jobsAnalyzed stays 0', restoredDb.jobsAnalyzed, 0);
ok('the restored sample keeps the seed: projectId prefix',
  seedsToCostSamples([back!])[0].projectId.startsWith(SEED_PROJECT_PREFIX));
expect('the restored sample keeps bidUnit 0', seedsToCostSamples([back!])[0].bidUnit, 0);

// Re-importing a correction after a restore must still collapse to one pgRow.
const corrected = draftsToSeeds([{ trade: 'drywall hang & finish', unit: 'sf', rate: 3.85, raw: '' }], { now: NOW });
const afterCorrection = mergeSeeds([back!], corrected);
expect('a corrected re-import after a restore replaces, never duplicates',
  afterCorrection.merged.length, 1);
expect('…at the corrected rate', afterCorrection.merged[0].rate, 3.85);
expect('…on the same deterministic id', afterCorrection.merged[0].id, rich.id);

// Junk rows must not survive the wire any more than they survive the cache.
expect('a pgRow with no rate is dropped, not imported as NaN', rowToSeed({ ...pgRow, rate: null }), null);
expect('a zero-rate pgRow is dropped', rowToSeed({ ...pgRow, rate: 0 }), null);
expect('a tradeless pgRow is dropped', rowToSeed({ ...pgRow, trade: '   ' }), null);
expect('a non-object is dropped', rowToSeed('nope'), null);
expect('an id-less pgRow re-derives its id from trade+unit',
  rowToSeed({ ...pgRow, id: undefined })?.id, rich.id);

// ── reconcileSeeds: the local-vs-server merge.
const older: SeededRate = { ...rich, rate: 10, createdAt: '2026-01-01T00:00:00.000Z' };
const newer: SeededRate = { ...rich, rate: 20, createdAt: '2026-06-01T00:00:00.000Z' };
expect('a reinstall (empty local) restores every server row',
  reconcileSeeds([], [newer]).length, 1);
expect('a pending local edit is NOT reverted by a stale server copy',
  reconcileSeeds([newer], [older])[0].rate, 20);
expect('a newer statement from another device wins',
  reconcileSeeds([older], [newer])[0].rate, 20);
expect('reconcile unions rather than replaces — nothing is dropped',
  reconcileSeeds(firstImport, [newer]).length, 3);
expect('reconcile is keyed like mergeSeeds — one row per trade+unit',
  reconcileSeeds([rich], [{ ...rich, trade: 'DRYWALL HANG & FINISH', unit: 'sf' }]).length, 1);

// ── The migration. Generated, deliberately NOT applied — a production schema
// change is the founder's call.
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const seedMigrationFile = readdirSync(MIGRATIONS).find(f => /_cost_seeds\.sql$/.test(f));
ok('a cost_seeds migration exists', !!seedMigrationFile, String(seedMigrationFile));
const mig = seedMigrationFile ? readFileSync(join(MIGRATIONS, seedMigrationFile), 'utf8') : '';

// Shape checks run against the DDL with `--` comments stripped: this file's
// header DISCUSSES the single-column PK and TO PUBLIC as the things it is
// deliberately not doing, and a naive grep would read the warning as the bug.
const ddl = mig.replace(/^[ \t]*--.*$/gm, '');

ok('it creates public.cost_seeds', /CREATE TABLE IF NOT EXISTS public\.cost_seeds/.test(ddl));

// THE COLLISION GUARD. seedId is deterministic from trade+unit, so EVERY
// contractor who frames walls produces 'seed-framing-sf'. With `id text PRIMARY
// KEY` the second contractor's insert is a duplicate-key violation — which
// utils/offlineQueue classifies TERMINAL and DISCARDS. Their rates would be
// dropped on the floor. The PK must be composite.
ok('the PK is COMPOSITE (user_id, id) — deterministic ids collide across users',
  /PRIMARY KEY \(user_id, id\)/.test(ddl));
ok('…and is NOT a bare single-column id PK',
  !/\bid text PRIMARY KEY/.test(ddl));
ok('the deterministic id is documented as not globally unique',
  /globally unique/.test(mig));

// RLS mirroring 20260804120000_delay_events.sql: owner-only, all four commands.
ok('RLS is enabled', /ALTER TABLE public\.cost_seeds ENABLE ROW LEVEL SECURITY/.test(ddl));
for (const cmd of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
  ok(`there is a ${cmd} policy`, new RegExp(`FOR ${cmd} TO authenticated`).test(ddl));
}
expect('every policy is owner-scoped on auth.uid() = user_id',
  (ddl.match(/auth\.uid\(\) = user_id/g) ?? []).length >= 5, true);
ok('UPDATE carries WITH CHECK too (no re-keying a row onto another user)',
  /FOR UPDATE TO authenticated\s+USING \(auth\.uid\(\) = user_id\)\s+WITH CHECK \(auth\.uid\(\) = user_id\)/.test(ddl));
ok('policies are TO authenticated, not TO PUBLIC', !/TO PUBLIC/i.test(ddl));
ok('a bad rate cannot be written around the parser', /CHECK \(rate > 0/.test(ddl));
ok('reported_jobs is documented as display-only',
  /DISPLAY ONLY/.test(mig));

// ── The hook. Local-first cache + queued writes.
const hook = src('hooks/useCostSeeds.ts');
ok('the hook still caches to AsyncStorage (works offline AND pre-migration)',
  /AsyncStorage/.test(hook) && /mageid_cost_seeds/.test(hook));
ok('writes go through supabaseWrite (utils/offlineQueue), never a raw write',
  /supabaseWrite\(/.test(hook) &&
  !/supabase\.from\([^)]*\)\s*\.\s*(insert|update|delete|upsert)/.test(hook));
ok('the write is an UPSERT — a deterministic id re-insert is a terminal dup-key',
  /supabaseWrite\(TABLE, 'upsert'/.test(hook));
// Deletes are queued as a TOMBSTONE upsert, not a hard delete: the read path
// unions local and server, and a union cannot express absence — a hard-deleted
// row just came back from whichever side had not synced yet. See §14.
ok('deletes are queued too — as a tombstone the merge can honour',
  /tombstoneSeed/.test(hook) && !/supabaseWrite\(TABLE, 'delete'/.test(hook));
ok('the seed→row mapper is used, so user_id rides along for RLS',
  /seedToRow\(s, userId\)/.test(hook));
ok('the query is keyed by user so a tenant switch refetches',
  /\['cost-seeds', userId\]/.test(hook));
ok('the pre-migration schema-cache behaviour is documented, not discovered',
  /schema-cache/.test(hook));
// A local row the server has never seen is a rate still one reinstall from
// being lost — seeds entered in onboarding before the auth session hydrated,
// or a queued write dropped at the offline queue's 1,000-entry cap.
//
// It must compare VALUES, not merely whether the key exists server-side: a
// presence check skips exactly the rows whose local copy WON the reconcile,
// so a correction whose queued write was dropped never reached the server.
ok('local rows the server has never seen are backfilled on sync',
  /BACKFILL/.test(hook) && /serverByKey\.get\(/.test(hook));
ok('…and so are rows the server has a DIFFERENT version of',
  /sameSeedValue\(theirs, s\)\) continue/.test(hook));

// ═══════════════════════════════════════════════════════════════════════════
// 12. REACH — the arg exists and the callers pass it
// ═══════════════════════════════════════════════════════════════════════════
//
// This is the failure mode the feature actually shipped with: buildCostDatabase
// grew an additive 5th `seeds` arg, five callers passed it, and ELEVEN did not.
// A seeded contractor got their own numbers in the estimate wizard and generic
// AI everywhere else. Nothing about the engine can detect that, so it is
// pinned at the source.

/** Every file that builds a cost book, and the call that must carry seeds. */
const COST_BOOK_CONSUMERS: { file: string; why: string }[] = [
  // Wired at launch (2026-08-03).
  { file: 'app/estimate-wizard.tsx', why: 'the estimate itself' },
  { file: 'app/(tabs)/estimate/full.tsx', why: 'the full estimate screen' },
  { file: 'app/takeoff-estimate.tsx', why: 'takeoff pricing' },
  { file: 'app/area-takeoff.tsx', why: 'area takeoff' },
  { file: 'app/cost-database.tsx', why: 'the price book screen' },
  // The eleven that were not.
  { file: 'app/cost-xray.tsx', why: 'hidden-condition allowances' },
  { file: 'app/daily-report.tsx', why: 'profit-leak pricing' },
  { file: 'app/job-costing.tsx', why: 'the sub-bid reality check' },
  { file: 'app/estimate-confidence.tsx', why: 'per-line confidence' },
  { file: 'utils/aiService.ts', why: 'change-order impact' },
  { file: 'utils/bidLevelingEngine.ts', why: 'bid leveling' },
  { file: 'utils/instantBid.ts', why: 'the instant ROM' },
  { file: 'utils/copilot/estimate/estimateGrounding.ts', why: 'the copilot interview' },
  { file: 'utils/judges/runJudges.ts', why: 'the bid verdict' },
  { file: 'utils/brain/estimateSnapshot.ts', why: 'the brain snapshot' },
  { file: 'components/BidConfidenceBadge.tsx', why: 'the confidence pill' },
];

for (const c of COST_BOOK_CONSUMERS) {
  const body = src(c.file);
  ok(`${c.file} builds its cost book WITH seeds (${c.why})`,
    /buildCostDatabase\([^;]*?,\s*seeds\s*\)/.test(body),
    (/buildCostDatabase\([^;]*?\)/.exec(body) ?? ['<no call found>'])[0]);
}
expect('all 16 cost-book consumers are accounted for', COST_BOOK_CONSUMERS.length, 16);

// Screens/components read seeds from the hook…
for (const f of [
  'app/cost-xray.tsx', 'app/daily-report.tsx', 'app/job-costing.tsx',
  'app/estimate-confidence.tsx', 'components/BidConfidenceBadge.tsx',
]) {
  ok(`${f} actually calls useCostSeeds()`, /useCostSeeds\(\)/.test(src(f)));
}

// …and the pure engines get theirs from a caller. Half of the eleven never
// build the book from their own hooks, so wiring the engine alone is a no-op —
// these pin the CALLER side, which is where the bug lived.
const CALLER_HANDOFFS: { caller: string; pattern: RegExp; why: string }[] = [
  { caller: 'app/judges.tsx', pattern: /receipts, laborSamples, seeds \}/, why: 'JudgesContext → runJudges' },
  { caller: 'app/copilot.tsx', pattern: /receipts, laborSamples, seeds \}/, why: 'ctx bag → estimateGrounding' },
  { caller: 'app/submit-bid-response.tsx', pattern: /laborSamples, seeds \}/, why: 'groundingContext → instantBid' },
  { caller: 'components/InstantBidProposalModal.tsx', pattern: /laborSamples, seeds \}/, why: 'groundingContext → instantBid' },
  { caller: 'app/bid-leveling.tsx', pattern: /levelBids\(\{ pkg, bids, projects, commitments, receipts, seeds \}\)/, why: '→ bidLevelingEngine' },
  { caller: 'app/buyout-package.tsx', pattern: /levelBids\(\{ pkg, bids, projects, commitments, receipts, seeds \}\)/, why: '→ bidLevelingEngine' },
  { caller: 'components/AIChangeOrderImpact.tsx', pattern: /analyzeChangeOrderImpact\([^;]*laborSamples, seeds\)/, why: '→ aiService' },
  { caller: 'app/contract.tsx', pattern: /buildEstimateSnapshotPayload\([^;]*seeds\)/, why: '→ estimateSnapshot' },
];
for (const h of CALLER_HANDOFFS) {
  ok(`${h.caller} passes seeds onward (${h.why})`, h.pattern.test(src(h.caller)));
}
// estimate-wizard calls the snapshot builder from three separate commit paths.
expect('all three estimate-wizard snapshot calls carry seeds',
  (src('app/estimate-wizard.tsx').match(/laborSamples, seeds,/g) ?? []).length, 3);

// A seeded contractor most plausibly has ZERO projects — they pasted a rate
// sheet and haven't created a job yet. Both instant-bid callers used to gate
// grounding on projects.length > 0, which threw those seeds away.
for (const f of ['app/submit-bid-response.tsx', 'components/InstantBidProposalModal.tsx']) {
  ok(`${f} grounds on seeds even with no projects yet`,
    /projects\.length > 0\) \|\| seeds\.length > 0/.test(src(f)));
}

// ═══════════════════════════════════════════════════════════════════════════
// 13. THE FIREWALL AT EACH NEWLY-WIRED SITE
// ═══════════════════════════════════════════════════════════════════════════
//
// Reaching more surfaces is only worth doing if none of them start describing
// a stated rate as a measured one. Each block below runs the real engine
// against a seeded-only book.

const SEEDED_ONLY = buildCostDatabase(emptyProjects, emptyCommitments, [], [], SEEDS);
const EARNED_ONLY = buildCostDatabase(emptyProjects, emptyCommitments, [], [realSample], []);

// ── JUDGES. Coverage is the load-bearing number here twice over: it is shown
// as "% from your history" AND it scales how far the verdict may move off
// neutral (confWeight). Seeded coverage must be reported apart from both.
const seededVerdict = computeBidVerdict({
  lines: [{ category: 'Framing', unit: 'SF', quantity: 100, bidUnit: 12 }],
  costDb: SEEDED_ONLY,
  targetMargin: 0.2,
  typeMargin: { avgMarginPct: 0.3, jobCount: 6 },
  capacity: { loadPct: 0.1, bookedSolid: false, overlappingProjects: 0 },
});
expect('JUDGES prices the line from the seeded rate (the point of wiring it)',
  seededVerdict.lines[0].usedUnit, 12.5);
expect('…and the priced line is stamped seeded', seededVerdict.lines[0].provenance, 'seeded');
expect('measured coverage stays 0 on a seeded-only book', seededVerdict.coveragePct, 0);
expect('…the seeded share is reported separately', seededVerdict.seededCoveragePct, 1);
ok('the confidence chip never merges the two',
  (seededVerdict.drivers.find(d => d.kind === 'cost_confidence')?.detail ?? '')
    .includes('0% of this scope is priced from your own history'),
  seededVerdict.drivers.find(d => d.kind === 'cost_confidence')?.detail);
ok('…and it names the stated share out loud',
  (seededVerdict.drivers.find(d => d.kind === 'cost_confidence')?.detail ?? '')
    .includes('rates you set yourself'));
ok('a disclaimer says the scope is priced off unmeasured rates',
  seededVerdict.disclaimers.some(s => s.includes('rates you set yourself')),
  seededVerdict.disclaimers.join(' | '));
// The damping test: strong signals + a fully seeded book must NOT buy a 'take'
// that an equally strong EARNED book would earn.
const earnedVerdict = computeBidVerdict({
  lines: [{ category: 'Framing', unit: 'SF', quantity: 100, bidUnit: 12 }],
  costDb: EARNED_ONLY,
  targetMargin: 0.2,
  typeMargin: { avgMarginPct: 0.3, jobCount: 6 },
  capacity: { loadPct: 0.1, bookedSolid: false, overlappingProjects: 0 },
});
ok('a seeded book cannot buy the confidence an earned one does',
  seededVerdict.fitScore < earnedVerdict.fitScore,
  `seeded=${seededVerdict.fitScore} earned=${earnedVerdict.fitScore}`);
expect('an earned book still reports full measured coverage', earnedVerdict.coveragePct, 1);
expect('…and zero seeded coverage', earnedVerdict.seededCoveragePct, 0);
// The LLM that phrases the verdict must be told which kind of number it holds.
const narration = buildNarrationPrompt(seededVerdict);
ok('the narration prompt tells the model the rate is SELF-REPORTED',
  /SET THEMSELVES/.test(narration) && /not measured/.test(narration), narration.slice(0, 400));
ok('…and forbids calling it history',
  /Do NOT describe these as history/.test(narration));
ok('an earned verdict\'s prompt carries no self-reported caveat',
  !/SET THEMSELVES/.test(buildNarrationPrompt(earnedVerdict)));

// ── ESTIMATE CONFIDENCE + the BidConfidenceBadge pill that opens it.
// The score is "share of estimate $ backed by ALIGNED, PROVEN costs". A seeded
// rate may light up the underpriced warning; it must never raise the score.
const estimate: LinkedEstimate = {
  id: 'est-1',
  items: [{
    materialId: 'm1', name: 'Wall framing', category: 'Framing', unit: 'SF',
    quantity: 100, unitPrice: 12.5, bulkPrice: 0, markup: 0, usesBulk: false,
    lineTotal: 1250, supplier: '',
  }],
  globalMarkup: 0, baseTotal: 1250, markupTotal: 0, grandTotal: 1250, createdAt: NOW,
};
const seededProject = { id: 'p-seed', name: 'Cold Start', linkedEstimate: estimate } as unknown as Project;

const coldConf = computeEstimateConfidence(seededProject, cold);
const seededConf = computeEstimateConfidence(seededProject, SEEDED_ONLY);
expect('with no book at all the line reads no_history', coldConf.lines[0].confidence, 'no_history');
expect('a seeded book gives the line a rate to check against',
  seededConf.lines[0].learnedRate, 12.5);
expect('…and the line is no longer flagged unknown', seededConf.lines[0].flag, 'aligned');
expect('…but its confidence stays low', seededConf.lines[0].confidence, 'low');
expect('…and it honestly reports zero jobs', seededConf.lines[0].jobCount, 0);
expect('NOTHING is "backed by proven costs" on a seeded-only book',
  seededConf.backedCost, 0);
expect('…so the Bid Confidence score stays 0 — no fabricated credibility',
  seededConf.score, 0);
// The same shape of estimate against three real closed jobs DOES score — so
// the zero above is the firewall doing its job, not computeEstimateConfidence
// being incapable of scoring anything. (Priced at the blended $14 those jobs
// imply, so the line reads 'aligned'; the seeded case above was aligned too.)
const earnedProject = {
  id: 'p-earned', name: 'Real Jobs',
  linkedEstimate: {
    ...estimate,
    items: [{ ...estimate.items[0], unitPrice: 14, lineTotal: 1400 }],
    baseTotal: 1400, grandTotal: 1400,
  },
} as unknown as Project;
const earnedConf = computeEstimateConfidence(
  earnedProject,
  buildCostDatabase(emptyProjects, emptyCommitments, [], [
    realSample, { ...realSample, projectId: 'p2', closedAt: '2026-01-11' },
    { ...realSample, projectId: 'p3', closedAt: '2026-01-12' },
  ], []),
);
expect('three closed jobs lift the line to medium confidence', earnedConf.lines[0].confidence, 'medium');
ok('a measured book CAN score — the zero above is the firewall, not a bug',
  earnedConf.score > 0, `score=${earnedConf.score} flag=${earnedConf.lines[0].flag}`);

// ── BRAIN SNAPSHOT. This payload is what the brain later grades ITSELF on, so
// an inflated coveragePct would corrupt its own track record.
const seededSnap = buildEstimateSnapshotPayload(seededProject, emptyProjects, emptyCommitments, [], [], SEEDS);
expect('the snapshot prices the line off the seed', seededSnap?.lines[0].confidenceBand, 'low');
expect('…but claims zero coverage — the brain never grades itself on a claim',
  seededSnap?.coveragePct, 0);

// ── COST X-RAY. Two firewalls: the caption, and the band.
const TELL = {
  key: 'panel_fpe_zinsco' as const, category: 'electrical' as const,
  tell: 'FPE panel', severity: 'high' as const, confidence: 90, likelihood: 80,
  photoIndex: 0, bbox: { x: 0, y: 0, w: 1, h: 1 },
};
const XRAY_SEEDS = draftsToSeeds([{ trade: 'Electrical', unit: 'EA', rate: 3000, raw: '' }], { now: NOW });
const xraySeeded = priceTell(TELL, buildCostDatabase(emptyProjects, emptyCommitments, [], [], XRAY_SEEDS));
const xrayCatalog = priceTell(TELL, cold);
expect('X-Ray prices the tell off the seeded rate', xraySeeded.band.expected, Math.round(0.8 * 3000));
expect('…labelled seeded, so the screen cannot say "your job history"',
  xraySeeded.rateBasis, 'seeded');
expect('a bookless scan is labelled catalog', xrayCatalog.rateBasis, 'catalog');
expect('an earned book is labelled earned',
  priceTell(TELL, buildCostDatabase(emptyProjects, emptyCommitments, [], [{
    ...realSample, trade: 'Electrical', unit: 'EA', quantity: 4, actualUnit: 2800,
  }], [])).rateBasis, 'earned');
ok('a seeded allowance keeps a real RANGE — one stated number is not certainty',
  xraySeeded.band.low < xraySeeded.band.expected && xraySeeded.band.expected < xraySeeded.band.high,
  JSON.stringify(xraySeeded.band));
expect('…using the catalog band width, not a fake 0% spread',
  xraySeeded.band.low, Math.max(0, Math.round(xraySeeded.band.expected * (1 - DEFAULT_VARIABILITY))));
ok('the screen has a distinct caption for a seeded rate',
  /seeded: 'the rate you set yourself'/.test(src('app/cost-xray.tsx')));
ok('…and no longer captions everything learned as "your job history"',
  !/hasLearnedRate \? 'your job history'/.test(src('app/cost-xray.tsx')));

// ── PROFIT LEAK (daily report). Out-of-scope work now gets a price instead of
// "price it yourself" — carrying the right label.
const leak = priceLeakItems(
  [{ trade: 'Framing', unit: 'SF', quantity: 40, description: 'extra wall', confidence: 'high', reportQuote: '' } as never],
  SEEDED_ONLY,
);
expect('a seeded book prices a flagged leak item', leak[0].estimatedPrice, 500);
expect('…stamped seeded so the row cannot read "from your cost history"',
  leak[0].rateProvenance, 'seeded');
expect('…at low confidence', leak[0].rateConfidence, 'low');
expect('an earned book stamps earned',
  priceLeakItems([{ trade: 'Framing', unit: 'SF', quantity: 40, description: 'x', confidence: 'high', reportQuote: '' } as never],
    EARNED_ONLY)[0].rateProvenance, 'earned');
ok('the daily report renders the seeded caption differently',
  /rateProvenance === 'seeded' \? 'from the rate you set'/.test(src('app/daily-report.tsx')));

// ── SUB-BID REALITY CHECK (job costing). A seeded book gives it an expectation
// to compare against; its copy never claims a job count either way.
const subVerdict = checkSubBid(
  { id: 'c1', projectId: 'p-seed', amount: 800, description: 'Framing', vendorName: 'Ace' } as never,
  seededProject,
  SEEDED_ONLY,
);
expect('a seeded book gives the sub-bid check a basis', subVerdict.basis, 'trade_match');
expect('…priced at the stated rate (100 SF × $12.50)', subVerdict.expected, 1250);
expect('…and flags the 36%-under bid', subVerdict.verdict, 'low');
ok('the sub-bid copy never cites a job count for a seeded rate',
  !/\d+ jobs?\b/.test(subVerdict.detail), subVerdict.detail);

// ── AI GROUNDING FACTS. Every prompt that can now see a seeded rate must say
// so in the prompt text — the model is the surface most likely to launder a
// claim into a measurement.
const GROUNDING_PROMPTS: { file: string; why: string }[] = [
  { file: 'utils/copilot/estimate/estimateGrounding.ts', why: 'copilot interview' },
  { file: 'utils/instantBid.ts', why: 'instant ROM' },
  { file: 'utils/bidLevelingEngine.ts', why: 'bid leveling' },
  { file: 'utils/aiService.ts', why: 'change-order impact' },
];
for (const g of GROUNDING_PROMPTS) {
  const body = src(g.file);
  ok(`${g.file} branches on provenance === 'seeded' (${g.why})`,
    /provenance === 'seeded'/.test(body));
  ok(`…and tells the model the rate is self-reported`,
    /SELF-REPORTED|SET THEMSELVES/.test(body));
}
ok('instantBid never labels a seeded-only proposal as basis=history',
  /basis = rateCount > 0 \? 'history' : 'ai_guess'/.test(src('utils/instantBid.ts')) &&
  /seededRateCount/.test(src('utils/instantBid.ts')));
ok('…and the assumption line for stated rates is worded separately',
  /rate\$\{seededRateCount === 1 \? '' : 's'\} you set yourself/.test(src('utils/instantBid.ts')));
ok('the instant-bid prompt header no longer claims every rate came from closed jobs',
  !/LEARNED RATES FROM THIS CONTRACTOR'S CLOSED JOBS/.test(src('utils/instantBid.ts')));
ok('bid leveling counts self-reported trades apart from learned ones',
  /rates you set yourself/.test(src('utils/bidLevelingEngine.ts')));

// ── AND THE ORIGINAL INVARIANT, RE-ASSERTED ACROSS EVERY NEW SITE.
// overallBidAccuracy excluding seeded-only entries is the single check that
// keeps a contractor who has closed nothing from being shown a perfect 100%.
expect('a fully seeded book STILL reports no bid accuracy',
  SEEDED_ONLY.overallBidAccuracy, null);
expect('…still zero closed jobs', SEEDED_ONLY.jobsAnalyzed, 0);
expect('…and every entry still counts zero jobs',
  SEEDED_ONLY.entries.every(e => e.jobCount === 0), true);
expect('…with every seeded sample still bidUnit 0',
  SEEDED_ONLY.entries.every(e => e.samples.every(s => !isSeedSample(s) || s.bidUnit === 0)), true);

// ═══════════════════════════════════════════════════════════════════════════
// §14. SYNC HARDENING — the failure modes a union-with-timestamps merge has.
//
// The V2 round-trip (§11) made seeds durable. It did not make them CONVERGENT:
// reconcileSeeds unioned local and server and never removed anything, so a
// delete was undone by the next refetch; the tiebreaker compared two CLIENT
// clocks through Date.parse, so one unparseable or skewed stamp pinned a stale
// rate forever; and the backfill re-pushed only rows the server had never seen,
// so a won local edit whose queued write was dropped never reached the server.
// Each check below is one of those, stated as the behaviour it must have.
// ═══════════════════════════════════════════════════════════════════════════

const T_OLD = '2026-01-01T00:00:00.000Z';
const T_MID = '2026-03-01T00:00:00.000Z';
const T_NEW = '2026-06-01T00:00:00.000Z';
const base: SeededRate = draftsToSeeds(
  [{ trade: 'Framing', unit: 'SF', rate: 12.5, raw: '' }], { now: T_OLD, method: 'manual' },
)[0];

// ── A DELETE MUST STICK. The bug: deleteSeed dropped the row locally and
// queued a server delete; any refetch before that flushed re-added the server
// copy, and the backfill then re-upserted it — the rate came back forever.
const tombstone: SeededRate = { ...base, deletedAt: T_NEW };
ok('a local tombstone is not resurrected by the server copy still being there',
  activeSeeds(reconcileSeeds([tombstone], [base])).length === 0);
ok('…and a tombstone from ANOTHER device removes the row here',
  activeSeeds(reconcileSeeds([base], [{ ...base, deletedAt: T_NEW }])).length === 0);
ok('…while a re-statement AFTER a delete brings the rate back',
  activeSeeds(reconcileSeeds([tombstone], [{ ...base, rate: 14, createdAt: T_NEW, updatedAt: T_NEW }]))
    .length === 1);
ok('the tombstone itself survives reconcile so the delete can still be pushed',
  reconcileSeeds([tombstone], [base]).some(s => !!s.deletedAt));
ok('activeSeeds hides tombstones from every consumer',
  activeSeeds([base, { ...base, trade: 'Drywall', deletedAt: T_NEW }]).length === 1);
ok('pruneTombstones drops a tombstone once it can no longer be contradicted',
  pruneTombstones([tombstone], { now: Date.parse(T_NEW) + 200 * 86400000 }).length === 0);
ok('…but keeps a fresh one', pruneTombstones([tombstone], { now: Date.parse(T_NEW) + 86400000 }).length === 1);

// ── NaN MUST NOT DECIDE A MERGE. `x >= NaN` is false, so an unparseable local
// stamp silently made the local row unbeatable.
const localNaN: SeededRate = { ...base, rate: 1, createdAt: 'not-a-date' };
expect('a server row still wins over a local row with an unparseable stamp',
  reconcileSeeds([localNaN], [{ ...base, rate: 20, createdAt: T_NEW }])[0].rate, 20);
expect('…and an unparseable SERVER stamp does not beat a known local one',
  reconcileSeeds([{ ...base, rate: 7, createdAt: T_MID }], [{ ...base, rate: 20, createdAt: 'junk' }])[0].rate, 7);
expect('two unknown stamps still resolve — ties go to the server',
  reconcileSeeds([localNaN], [{ ...base, rate: 20, createdAt: '' }])[0].rate, 20);

// ── THE SERVER CLOCK IS THE AUTHORITY. created_at is client-supplied, so a
// device with a skewed clock could pin a stale rate as permanently "newest".
// updated_at is stamped by the DB trigger and outranks it.
expect('server updated_at outranks a client createdAt as the tiebreaker',
  reconcileSeeds(
    [{ ...base, rate: 5, createdAt: '2099-01-01T00:00:00.000Z' }],   // skewed clock
    [{ ...base, rate: 20, createdAt: T_OLD, updatedAt: T_NEW }],
  )[0].rate, 20);
expect('a future client stamp is clamped, not trusted',
  reconcileSeeds(
    [{ ...base, rate: 5, createdAt: '2099-01-01T00:00:00.000Z' }],
    [{ ...base, rate: 20, createdAt: T_NEW }],
    { now: Date.parse(T_NEW) + 1000 },
  )[0].rate, 20);
expect('a genuine pending local edit still survives a stale server copy',
  reconcileSeeds([{ ...base, rate: 5, createdAt: T_NEW }], [{ ...base, rate: 20, createdAt: T_OLD }])[0].rate, 5);

// ── THE PARSER'S LIMITS ARE THE TABLE'S LIMITS. The migration CHECKs mirror
// MAX_SEED_RATE / MAX_REPORTED_JOBS. Any path that can produce a row breaking
// them writes a value the offline queue classifies TERMINAL and DISCARDS — the
// rate shows as saved on device and never reaches Postgres.
ok('MAX_SEED_RATE / MAX_REPORTED_JOBS are exported so the UI can enforce them',
  MAX_SEED_RATE === 10_000_000 && MAX_REPORTED_JOBS === 500);
const wild = draftsToSeeds(
  [{ trade: 'Gold leaf', unit: 'SF', rate: 99_000_000, reportedJobs: 9_999, raw: '' }],
  { now: NOW, method: 'manual' },
)[0];
ok('draftsToSeeds refuses a rate past the table CHECK rather than storing it',
  wild === undefined || wild.rate <= MAX_SEED_RATE);
ok('…and never emits a reported-job count past the CHECK',
  wild === undefined || (wild.reportedJobs ?? 0) <= MAX_REPORTED_JOBS);
const wildRow = seedToRow({ ...base, rate: 99_000_000, reportedJobs: 9_999 }, UID);
ok('seedToRow is the last line of defence — the row it emits satisfies both CHECKs',
  wildRow.rate > 0 && wildRow.rate <= MAX_SEED_RATE &&
  (wildRow.reported_jobs === null || (wildRow.reported_jobs > 0 && wildRow.reported_jobs <= MAX_REPORTED_JOBS)));
ok('the manual entry form enforces the same ceiling it will be written under',
  /MAX_SEED_RATE/.test(src('app/cost-seed.tsx')) && /MAX_REPORTED_JOBS/.test(src('app/cost-seed.tsx')));

// ── THE TOMBSTONE ON THE WIRE.
const delRow = seedToRow(tombstone, UID);
expect('a tombstone reaches Postgres as a soft delete, not a vanished row',
  delRow.deleted_at, T_NEW);
expect('…and comes back as a tombstone', rowToSeed(delRow)?.deletedAt, T_NEW);
expect('a live row carries no deleted_at', seedToRow(base, UID).deleted_at, null);
expect('rowToSeed reads the server updated_at', rowToSeed({ ...pgRow, updated_at: T_NEW })?.updatedAt, T_NEW);
ok('seedToRow does NOT send updated_at — the DB trigger owns it',
  !('updated_at' in (seedToRow(base, UID) as unknown as Record<string, unknown>)));

// ── THE HOOK'S SIDE OF IT. Source-level because the failures are structural:
// what the backfill compares, and what a delete writes.
const hookSrc = src('hooks/useCostSeeds.ts');
ok('the backfill compares VALUES, not merely whether the key exists server-side',
  /seedsDiffer|sameSeedValue|fingerprint/.test(hookSrc) && !/onServer\.has\([^)]*\)\) continue/.test(hookSrc));
ok('a delete writes a tombstone through the queue rather than a hard delete',
  /tombstoneSeed\(s, now\)/.test(hookSrc) &&
  /supabaseWrite\(TABLE, 'upsert', seedToRow\(dead, userId\)/.test(hookSrc) &&
  !/supabaseWrite\(TABLE, 'delete'/.test(hookSrc));
ok('the hook hands consumers ACTIVE seeds only', /activeSeeds/.test(hookSrc));
ok('the local cache is sanitized on load so a bad stamp cannot poison a merge',
  /normalizeSeed|sanitize/.test(hookSrc) || /normalizeSeed/.test(src('utils/costSeedCore.ts')));
ok('addSeeds does not enqueue two writes for one deterministic id',
  /dedupeSeeds|mergeSeeds\(\[\], incoming\)|byId/.test(hookSrc));

// ── THE FOLLOW-UP MIGRATION. cost_seeds is already applied in production, so
// the tombstone column arrives as its own append-only file — never by editing
// 20260805120000_cost_seeds.sql, which the deployed database has already run.
const tombstoneMigration = readdirSync(MIGRATIONS).find(f => /cost_seeds_soft_delete\.sql$/.test(f));
ok('a follow-up migration adds the tombstone column', !!tombstoneMigration, String(tombstoneMigration));
const tmig = tombstoneMigration ? readFileSync(join(MIGRATIONS, tombstoneMigration), 'utf8') : '';
const tddl = tmig.replace(/^[ \t]*--.*$/gm, '');
ok('…as an ADD COLUMN IF NOT EXISTS, so re-running it is safe',
  /ALTER TABLE public\.cost_seeds/.test(tddl) && /ADD COLUMN IF NOT EXISTS deleted_at/.test(tddl));
ok('…nullable with no default — an existing row is live, not tombstoned',
  !/deleted_at timestamptz NOT NULL/.test(tddl));
ok('the already-applied migration was NOT edited to add it',
  !/deleted_at/.test(mig));

// ── AND THE FIREWALL, ONE MORE TIME: none of this promotes a claim.
const afterSync = activeSeeds(reconcileSeeds([base], [{ ...base, rate: 14, updatedAt: T_NEW }]));
const syncedDb = buildCostDatabase(emptyProjects, emptyCommitments, [], [], afterSync);
expect('a rate that survived a cross-device merge is still a claim',
  lookupRate(syncedDb, 'Framing', 'SF')?.provenance, 'seeded');
expect('…and still counts zero closed jobs', syncedDb.jobsAnalyzed, 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
