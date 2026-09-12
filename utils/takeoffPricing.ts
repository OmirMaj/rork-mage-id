// utils/takeoffPricing.ts
//
// Prices a takeoff line from the contractor's OWN cost book.
//
// WHY THIS IS THE WHOLE POINT. app/takeoff-estimate already had two price
// sources: an LLM guess (`aiUnitPrice`) and a deterministic rate from
// constants/materials.ts (`engineRate`). Both are GENERIC — the catalog knows
// what framing costs somewhere, not what it costs *you*. That is precisely the
// failure mode the AI-estimator products get mocked for (publicly over-bidding
// $7,500 to paint eight doors).
//
// MAGE has the thing they don't: utils/costDatabase learns each contractor's
// real installed rate per trade + unit from their own closed jobs. This module
// matches a takeoff line to that history, so the price on the estimate is the
// number that contractor actually paid last time.
//
// Priority the caller should apply: YOURS > engine catalog > AI guess.
//
// Pure: no React, no network, no clock.
//
// VOCABULARY UNIFICATION
// ----------------------
// priceSourceLabel's earned/seeded/mixed determination delegates to
// provenanceClaimModel (utils/rateProvenance.ts) — the same function the
// estimate-row chip uses. One decision, two visual languages: this file renders
// a sentence; the chip renders a pill. See rateProvenance.ts §VOCABULARY.

import type { CostBookEntry } from '@/utils/costDatabase';
import { provenanceClaimModel } from '@/utils/rateProvenance';

export type PriceSource = 'yours' | 'engine' | 'ai' | 'manual';

export interface OwnRateMatch {
  /** The rate to use — the cost book's blended suggestion. */
  rate: number;
  /** The trade label it matched, for display ("matched to Framing"). */
  trade: string;
  unit: string;
  /** How many of the contractor's REAL jobs back this rate. 0 on a rate they
   *  seeded by hand and haven't yet closed a job against. */
  jobCount: number;
  /** 'earned' = measured from closed jobs / receipts / clocked labor.
   *  'seeded' = the contractor stated it, nothing measured yet.
   *  'mixed' = a stated rate that real jobs have started to correct.
   *  The UI must not present a 'seeded' rate as learned history. */
  provenance: 'earned' | 'seeded' | 'mixed';
  confidence: CostBookEntry['confidence'];
  /** What the earned half rests on — 'contracted' means signed but not yet
   *  paid, so the sentence must not say "measured". */
  earnedBasis?: CostBookEntry['earnedBasis'];
  /** Spread across jobs, as a fraction (0.12 = ±12%). */
  variability: number;
  /** False when `variability` is arithmetic rather than an observation (one
   *  sample, or every sample priced at a rate the GC stated). The ± band must
   *  not be printed then. See CostBookEntry.spreadMeaningful. */
  spreadMeaningful?: boolean;
  /** 0..1 — how confident we are this line IS that trade (not the rate itself). */
  matchScore: number;
}

/** Words that carry no trade meaning, so they can't earn a match on their own. */
const STOPWORDS = new Set([
  'and', 'the', 'of', 'for', 'with', 'per', 'new', 'install', 'installed',
  'installation', 'supply', 'labor', 'material', 'materials', 'work', 'misc',
  'miscellaneous', 'allowance', 'each', 'total', 'other', 'general',
]);

/** Split any identifier/label into comparable lowercase words. */
export function words(input: string): string[] {
  return (input ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

/**
 * Units that mean the same thing, so a book entry in SF matches a line in SQFT.
 *
 * THIS TABLE AND utils/costSeedCore's MUST AGREE — its comment says so — and for
 * everything but square feet they had drifted apart. That was survivable while
 * this table only decided whether a takeoff line could borrow a rate. It stopped
 * being survivable when utils/costDatabase started keying the price book on
 * normalizeUnit: the book then inherited the gap. constants/materials.ts spells
 * trim work 'lin ft' → this table returned 'linft', a seeded LF rate is 'lf', and
 * ONE Trim trade came out as TWO ROWS — `trim|linft` (earned, 1 job, $4.50) and
 * `trim|lf` (seeded, $5.00). The screen showed the same trade twice at two
 * prices, lookupRate resolved whichever spelling the caller happened to ask for
 * (one earned, one seeded, off the same book), and the empty state's promise —
 * "every closed job corrects what you seeded" — was false for every catalog unit
 * that is not square feet: 'lin ft', 'cu yd' (before 'cuyd' was added), 'square',
 * 'sq yd'. Measurement and claim could never meet in the same row.
 *
 * So this is now costSeedCore's table, verbatim. Keep them in step:
 * scripts/validate-cost-seed.ts asserts that every token either table knows
 * canonicalises the same way, and that every unit spelling shipped in
 * constants/materials.ts round-trips.
 */
const UNIT_ALIASES: Record<string, string> = {
  // area
  sf: 'sf', sqft: 'sf', sqf: 'sf', ft2: 'sf', sfa: 'sf',
  squarefoot: 'sf', squarefeet: 'sf', sqfeet: 'sf', squarefeat: 'sf',
  // linear
  lf: 'lf', lnft: 'lf', lin: 'lf', linft: 'lf', lft: 'lf',
  linearfoot: 'lf', linearfeet: 'lf', linealfoot: 'lf', linealfeet: 'lf',
  // each
  ea: 'ea', each: 'ea', unit: 'ea', pc: 'ea', pcs: 'ea', piece: 'ea',
  pieces: 'ea', item: 'ea', items: 'ea', qty: 'ea',
  // volume / weight
  cy: 'cy', cuyd: 'cy', cubicyard: 'cy', cubicyards: 'cy', yd3: 'cy',
  cf: 'cf', cuft: 'cf', cubicfoot: 'cf', cubicfeet: 'cf',
  ton: 'ton', tons: 'ton', tn: 'ton',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  bf: 'bf', bdft: 'bf', boardfoot: 'bf', boardfeet: 'bf',
  // roofing / paving
  sq: 'sq', square: 'sq', squares: 'sq',
  sy: 'sy', sqyd: 'sy', squareyard: 'sy', squareyards: 'sy',
  // time
  hr: 'hr', hour: 'hr', hours: 'hr', hrs: 'hr', manhour: 'hr',
  manhours: 'hr', mh: 'hr',
  day: 'day', days: 'day', dy: 'day',
  wk: 'wk', week: 'wk', weeks: 'wk',
  mo: 'mo', month: 'mo', months: 'mo',
  // lump
  ls: 'ls', lot: 'ls', lumpsum: 'ls', allowance: 'ls', job: 'ls',
};

export function normalizeUnit(unit: string): string {
  const u = (unit ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return UNIT_ALIASES[u] ?? u;
}

/**
 * Find the contractor's own rate for a takeoff line.
 *
 * Units must agree — an $/SF rate on an EA line is not a cheaper price, it's a
 * wrong one, and silently applying it would be worse than having no history at
 * all. Beyond that, we score word overlap between the line (its CSI division +
 * description) and the book's trade label, and require a real signal rather
 * than a single incidental word.
 */
export function matchOwnRate(
  line: { csiDivision?: string; description?: string; unit: string },
  book: CostBookEntry[],
  opts?: { minJobs?: number; minScore?: number },
): OwnRateMatch | null {
  const minJobs = opts?.minJobs ?? 1;
  const minScore = opts?.minScore ?? 0.34;
  const unit = normalizeUnit(line.unit);
  if (!unit) return null;

  const lineWords = new Set([...words(line.description ?? ''), ...words(line.csiDivision ?? '')]);
  if (lineWords.size === 0) return null;

  let best: OwnRateMatch | null = null;

  for (const entry of book) {
    if (normalizeUnit(entry.unit) !== unit) continue;      // unit must agree
    // Evidence = real jobs, plus ONE for a cold-start seed the contractor
    // stated themselves (utils/costSeedCore). A seed is weaker evidence than a
    // closed job — it counts once, never more — but it is still the
    // contractor's own number, and it beats a national catalog average. An
    // entry with neither still returns null: no history, no claim.
    const evidence = (entry.jobCount ?? 0) + ((entry.seededSampleCount ?? 0) > 0 ? 1 : 0);
    if (evidence < minJobs) continue;
    if (!(entry.suggestedRate > 0)) continue;

    const tradeWords = words(entry.trade);
    if (tradeWords.length === 0) continue;
    const hits = tradeWords.filter(w => lineWords.has(w)).length;
    if (hits === 0) continue;

    // Score against the trade label's own length, so a one-word trade matched
    // exactly ("Framing") beats a two-word trade half-matched.
    const score = hits / tradeWords.length;
    if (score < minScore) continue;

    if (
      !best ||
      score > best.matchScore ||
      // Tie-break on evidence: more of the contractor's jobs behind it wins.
      (score === best.matchScore && (entry.jobCount ?? 0) > best.jobCount)
    ) {
      best = {
        rate: entry.suggestedRate,
        trade: entry.trade,
        unit: entry.unit,
        jobCount: entry.jobCount ?? 0,
        provenance: entry.provenance ?? 'earned',
        earnedBasis: entry.earnedBasis,
        confidence: entry.confidence,
        variability: entry.variability ?? 0,
        spreadMeaningful: entry.spreadMeaningful,
        matchScore: score,
      };
    }
  }

  return best;
}

/**
 * Human provenance sentence shown under a priced row on the takeoff screen.
 *
 * The earned/seeded/mixed determination is delegated to provenanceClaimModel
 * (utils/rateProvenance.ts) — the same function the estimate-row chip uses.
 * This keeps the sentence format the takeoff layout needs while sharing the
 * single firewall that decides what may be claimed.
 */
export function priceSourceLabel(source: PriceSource, match?: OwnRateMatch | null): string {
  if (source === 'yours' && match) {
    const claim = provenanceClaimModel({
      provenance: match.provenance,
      jobCount: match.jobCount,
      earnedBasis: match.earnedBasis,
    });

    // A seeded rate (claim === null is impossible here since seeded always
    // returns a model, but we handle claim?.provenance directly for clarity).
    if (claim?.provenance === 'seeded') {
      // The contractor TOLD us this rate — not measured. Saying "0 jobs" would
      // read as a bug; claiming jobs would be a lie. Say exactly what happened.
      return `Your rate — ${match.trade}, you set this (no closed jobs yet)`;
    }
    const jobs = `${match.jobCount} job${match.jobCount === 1 ? '' : 's'}`;
    // The ± band is printed only when the spread is an observation. `variability
    // > 0` caught n=1 by luck; it does NOT catch six clocked shifts priced at
    // one typed rate, which also agree by construction. spreadMeaningful says
    // so explicitly; the `> 0` check stays as the fallback for a caller that
    // does not carry the flag.
    const hasSpread = match.spreadMeaningful ?? (match.variability > 0);
    const spread = hasSpread && match.variability > 0 ? ` · ±${Math.round(match.variability * 100)}%` : '';
    if (claim?.provenance === 'mixed') {
      // Started from a stated rate but real jobs have begun to correct it.
      return `Your rate — ${match.trade}, ${jobs}${spread} · started from your set rate`;
    }
    if (claim?.tone === 'contracted') {
      // Signed subs, nothing paid out yet — real, but not a measured cost.
      return `Your rate — ${match.trade}, ${jobs}${spread} · signed, not yet paid`;
    }
    // earned — measured from closed jobs. The tone is 'measured' only here.
    return `Your rate — ${match.trade}, ${jobs}${spread}`;
  }
  if (source === 'engine') return 'Catalog rate — not your history';
  if (source === 'ai') return 'AI estimate — no history for this yet';
  return 'You set this';
}

/** Roll up how much of an estimate is backed by the contractor's own numbers. */
export function pricingProvenance(sources: PriceSource[]): {
  yours: number; engine: number; ai: number; manual: number; ownShare: number;
} {
  const count = { yours: 0, engine: 0, ai: 0, manual: 0 };
  for (const s of sources) count[s] += 1;
  const total = sources.length;
  return { ...count, ownShare: total > 0 ? count.yours / total : 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE TAKEOFF ROW KEY — ONE SPELLING, OR THE MEASUREMENT IS DROPPED SILENTLY
// ═══════════════════════════════════════════════════════════════════════════
//
// WHY THIS LIVES HERE AND NOT IN EITHER SCREEN. `PersistedTakeoff.overrides`
// and `.rejected` are keyed `<section>:<id>`. app/takeoff.tsx WRITES those keys
// (the manual quantity edit, the reject toggle, and the adopt tap on a field
// measurement all land in the same map); app/takeoff-estimate.tsx READS them
// when it builds the AI pricing prompt. Until 2026-09-12 each screen spelled
// the section names in its own local helper, and three of the seven did not
// match:
//
//     WRITE (app/takeoff.tsx)          READ (app/takeoff-estimate.tsx)
//     finish                           finishes
//     fixture                          fixtures
//     bulk                             bulkMaterials
//
// The consequence was silent and one-directional. A GC who measured a drywall
// run on site, tapped "Use 2,600 SF as the quantity", and watched the "rows
// still priced off the plan" notice clear was then priced off the plan anyway
// — and a row he explicitly REJECTED was still sent to the pricer, because
// `apply` only drops a row when `rejected['<section>:<id>']` hits. Both sides
// looked correct in isolation, so no source grep could see it.
//
// The section list is therefore a TYPE, not a convention: a mis-spelled section
// is now a compile error at the call site, and the round-trip below is executed
// for all seven sections in scripts/validate-cost-seed §17i.
//
// The names are the WRITE side's, because those are the keys already sitting in
// `mageid_takeoff::<projectId>` on every device that has run a takeoff. Renaming
// them would orphan every override a contractor has already made.

/** Every section of a takeoff that owns editable, rejectable rows. */
export const TAKEOFF_ROW_SECTIONS = [
  'walls', 'floor', 'doors', 'windows', 'finish', 'fixture', 'bulk',
] as const;

export type TakeoffRowSection = (typeof TAKEOFF_ROW_SECTIONS)[number];

/** The persisted key for one takeoff row. The only place this string is built. */
export function takeoffRowKey(section: TakeoffRowSection, id: string): string {
  return `${section}:${id}`;
}

/** The two per-row maps a takeoff carries. Structural so guards can run this. */
export interface TakeoffRowDecisions {
  overrides?: Record<string, number>;
  rejected?: Record<string, true>;
}

/**
 * THE QUANTITY THAT IS ACTUALLY PRICING THIS ROW — the number the estimate
 * uses, and the denominator utils/costDatabase will divide a closed
 * commitment by.
 *
 * Returns null when the row prices nothing: the GC rejected it, or there is no
 * usable fallback (the row is gone from the takeoff, or the AI read nothing).
 * A null row is not "zero" — it must be dropped from the prompt, not priced at
 * nothing.
 *
 * Both screens run this one function. app/takeoff.tsx asks it what is of
 * record so it can count the field measurements still waiting on a decision;
 * app/takeoff-estimate.tsx asks it what to price. When they were two
 * copies they disagreed for three of the seven sections (see above).
 */
export function takeoffQuantityOfRecord(
  decisions: TakeoffRowDecisions,
  rowKey: string,
  fallback: number | null,
): number | null {
  if (decisions.rejected?.[rowKey]) return null;
  const o = decisions.overrides?.[rowKey];
  if (typeof o === 'number' && Number.isFinite(o)) return o;
  return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : null;
}

/**
 * The section-and-id form app/takeoff-estimate's prompt builder needs, bound
 * to one takeoff's decisions. Same function underneath — the section name is
 * type-checked on the way in, which is the half that was broken.
 */
export function takeoffQuantityResolver(
  decisions: TakeoffRowDecisions,
): (section: TakeoffRowSection, id: string, fallback: number) => number | null {
  return (section, id, fallback) =>
    takeoffQuantityOfRecord(decisions, takeoffRowKey(section, id), fallback);
}
