// costDatabase.ts — your prices, learned from your jobs.
//
// Generic cost databases (RSMeans, national averages) are documented to drift
// from what a specific contractor actually pays — stale regional data, buried
// productivity assumptions, wrong for non-standard scopes. The most accurate
// "regional cost data" that exists for a GC is their OWN history. This engine
// builds it: it reads every closed job's bid-vs-actual ledger (utils/
// estimateActuals) and distils a personal price book — per trade + unit, what
// work actually costs at your hands, with a variability band and a read on
// whether you systematically bid that scope high or low.
//
// Cold-start handling (the known weakness of "learn from your data"): each
// entry blends your most recent BID assumption (the baseline/prior) toward your
// measured actuals as samples accumulate — w = n/(n+K). With one job it leans on
// your prior; by the fifth it's mostly your real numbers. So the book is useful
// immediately and gets sharper with every closeout.
//
// Pure function — no storage, no network. Derived live from ProjectContext data.

import type { Project, Commitment, MaterialReceipt } from '@/types';
import {
  computeEstimateActuals,
  isClosedProject,
  type EstimateActualsReport,
} from '@/utils/estimateActuals';
import { receiptToCostSamples } from '@/utils/materialReceipt';
import { seedsToCostSamples, isSeedSample, type SeededRate } from '@/utils/costSeedCore';
import { flagOutliers } from '@/utils/varianceDecomposition';
import { normalizeUnit } from '@/utils/takeoffPricing';
import { laborSampleTradeKey, normalizeTradeKey } from '@/utils/laborSamples';

/** Blend constant: at n samples, personal weight = n/(n+K). K=3 ⇒ 50/50 at n=3. */
const BLEND_K = 3;

/**
 * The book's grouping key. The unit is NORMALIZED (utils/takeoffPricing's
 * alias table), not taken verbatim.
 *
 * WHY. costSeedCore canonicalises a pasted seed's unit to SF/LF/EA/HR, pinned
 * to normalizeUnit — but the book's key and lookupRate were exact lowercase
 * string matches, while constants/materials.ts spells the same units "sq ft",
 * "lin ft", "cu yd", "each". So an SF Framing seed and a closed Framing job on
 * a "sq ft" catalog line landed in TWO rows: `framing|sq ft` (earned, 1 job,
 * $7.50) and `framing|sf` (seeded, $8.00). The screen showed one trade twice
 * at two prices, the estimate row resolved whichever spelling it happened to
 * ask for, and the empty state's promise — "every closed job corrects what you
 * seeded" — was false for every catalog-unit trade, because measurement and
 * claim never met in the same row.
 */
/**
 * The unit half of the key.
 *
 * A line with NO unit is not "each". normalizeUnit has always mapped the
 * placeholder token 'unit' onto 'ea' — correct for the takeoff matcher, which
 * only decides whether a line may BORROW a rate — and that became a silent
 * merge the moment bookKey started routing through it: a unitless lump line
 * pooled into the same price row as genuine per-each rates, and
 * lookupRate(db, trade, '') resolved into `trade|ea`. Unitless keeps its own
 * row, exactly as it did when the key was the literal lowercased string.
 */
function unitKey(unit: string): string {
  const raw = (unit || '').trim().toLowerCase();
  if (!raw || raw === 'unit') return 'unit';
  return normalizeUnit(raw) || raw;
}

function bookKey(trade: string, unit: string): string {
  return `${(trade || '').trim().toLowerCase()}|${unitKey(unit)}`;
}

export interface CostSample {
  projectId: string;
  projectName: string;
  trade: string;
  unit: string;
  quantity: number;
  bidUnit: number;
  /** Actual unit cost per unit — a SETTLED payment where one exists, else the
   *  signed commitment. See SETTLED_PAYMENT_RATIO (utils/estimateActuals): a
   *  deposit or progress draw is never treated as a completed cost. */
  actualUnit: number;
  /** 'seeded' = the contractor TOLD us this rate (utils/costSeedCore) — a
   *  claim, never a measurement. 'actual' (a settled payment / receipt /
   *  clocked cost), 'committed' (a signed sub or PO on a closed job, nobody
   *  paid out yet) and 'self_perform' (direct receipts + clocked hours on a
   *  scope with no sub at all) are earned. */
  basis: 'actual' | 'committed' | 'seeded' | 'self_perform';
  closedAt: string;
  /** Provenance of a receipt-derived sample: 'receipt' = scanned supplier
   *  invoice, 'qbo' = confirmed QuickBooks cost line, 'seed' = a rate the
   *  contractor typed/imported before they had history here, 'labor_rate' =
   *  measured hours priced at the loaded rate the GC typed in settings (a real
   *  quantity, a STATED price — see utils/laborSamples). Absent on closed-job
   *  samples. Additive — F5. */
  source?: 'receipt' | 'qbo' | 'seed' | 'labor_rate';
  /** Set by buildCostDatabase when this sample must not teach the learned rate.
   *  Kept in `samples` so the GC still sees the job; excluded from the
   *  rate/variability/bias math. Absent = a clean sample that informs the rate.
   *  `excludedReason` says WHY, so the UI never explains a change-order
   *  exclusion with the one-off-blowout sentence. Additive. */
  excludedFromRate?: boolean;
  excludedReason?: 'outlier' | 'change_order' | 'package_allocation' | 'material_component';
  /**
   * The date we can actually attest a MEASUREMENT happened, when that is not
   * the same as `closedAt`.
   *
   * `closedAt` on a closed-job sample falls back to `project.updatedAt` so the
   * date sort has something to order by (see the note in buildCostDatabase) —
   * and ProjectContext.updateProject stamps updatedAt with `new Date()` on
   * EVERY write, so for a job that was never formally closed out that value is
   * "the last time anything on this project was touched", not "when this work
   * was measured". Sorting by it is fine; PRINTING it as "Last measured Sep
   * 2026" over a job done in 2019 is the exact inversion the row exists to
   * prevent. So the measurement date is carried separately and is only ever a
   * real closeout date; '' means "we cannot vouch for when". Absent (the
   * receipt / labor / seed paths) = use closedAt, which for those IS the date
   * of the thing itself.
   */
  measuredAt?: string;
}

export interface CostBookEntry {
  key: string;
  trade: string;
  unit: string;
  sampleCount: number;
  /** Distinct REAL jobs behind this entry. Seed-derived samples never count
   *  here — a rate you typed is not a job you closed. */
  jobCount: number;
  /** How many seeded (contractor-stated) samples back this entry. Optional so
   *  existing CostBookEntry literals keep compiling; buildCostDatabase always
   *  sets it. */
  seededSampleCount?: number;
  /** How many samples were rejected from the learned rate as gross outliers
   *  (utils/varianceDecomposition) — one-off blowouts kept visible but not
   *  averaged into personalRate/bias. 0 for a clean entry. Optional for
   *  back-compat; buildCostDatabase always sets it. */
  excludedSampleCount?: number;
  /** How many samples the DERIVATION disqualified as unit-rate evidence —
   *  a commitment carrying approved change-order dollars against the original
   *  bid quantity, or a package price split across several estimate lines.
   *  Distinct from `excludedSampleCount` (gross outliers) because the sentence
   *  the UI owes the contractor is different: one says "this job was weird",
   *  the other says "this number is not a unit price". Optional for
   *  back-compat; buildCostDatabase always sets it. */
  notRateEvidenceCount?: number;
  /**
   * How many samples in this row are MATERIAL unit prices sitting under a row
   * whose meaning is an INSTALLED rate — shown, never averaged.
   *
   * WHY. The self-perform derivation emits an installed rate ($/SF for the
   * finished scope) keyed on the estimate line's trade+unit, and its numerator
   * already contains this job's receipt dollars for that trade. When the
   * receipt happens to be priced in the SAME unit as the scope — the ordinary
   * case for drywall, sheathing, flooring, siding, roofing — the material
   * sample lands in the very row the installed rate does, and the two get
   * quantity-averaged into a number that is neither: 2,000 SF of drywall at
   * $2,600 of crew time plus $1,000 of board is $1.80/SF installed, and the
   * book learned $1.15 — 36% low, with a ±57% "spread" manufactured out of
   * averaging a total with one of its own parts, stamped 'earned'/'paid' and
   * eligible for the cross-contractor index. Wrong in the direction that makes
   * a correctly-priced bid look padded, which is the same failure class as the
   * mobilization-deposit defect. Optional for back-compat; always set.
   */
  materialComponentCount?: number;
  /** 'earned' = closed jobs / receipts / clocked labor only. 'seeded' = the
   *  contractor's stated rate only, nothing measured yet. 'mixed' = both.
   *  Surface this anywhere the rate is shown — the product's credibility rests
   *  on never conflating "you told me" with "I watched this happen". */
  provenance?: 'earned' | 'seeded' | 'mixed';
  /**
   * What the EARNED half of this entry actually rests on, across its clean
   * non-seed samples:
   *   'paid'       — at least one settled payment / receipt / self-perform cost
   *   'contracted' — every sample is a signed sub or PO nobody has paid yet
   *   'stated'     — nothing earned at all (seeded-only)
   *
   * WHY IT EXISTS. jobCount counts distinct projects among non-seed samples
   * regardless of basis, so a book where NOTHING has been paid still emitted
   * "MEASURED · 4 jobs". The seed firewall was built against one threat (rates
   * the GC typed) and a signed contract read as a cost walked through a
   * different door. Optional for back-compat; always set by the builder.
   */
  earnedBasis?: 'paid' | 'contracted' | 'stated';
  /** Quantity-weighted mean actual unit cost — your learned rate. */
  personalRate: number;
  /** Coefficient of variation as a fraction (0.12 = ±12% spread across jobs). */
  variability: number;
  /**
   * True when `variability` is a real measurement of spread. False when it is
   * arithmetic dressed as one:
   *   • fewer than two clean priced samples — a dispersion statistic from n=1
   *     is undefined, not zero, and the card printed "$2.00 ±0%" after one job.
   *   • every clean sample carries a STATED price (a seed, or clocked hours at
   *     the one loaded rate the GC typed) — six shifts at $65/hr agree with
   *     each other by construction, not by observation.
   * Surfaces must not print a ± band when this is false; utils/takeoffPricing
   * already suppressed it at variability === 0 and app/cost-database did not.
   */
  spreadMeaningful?: boolean;
  /** Weighted mean of (actualUnit/bidUnit − 1). Positive = you bid LOW (actuals
   *  came in over your bid); negative = you padded it. */
  bidBias: number;
  /** Most recent bid unit cost — the prior used for blending. Taken from the
   *  DATE-sorted samples: this used to read `learn.find(...)`, i.e. whichever
   *  project happened to arrive first from ProjectContext (sorted by
   *  updatedAt), so the same two jobs — 2019 @ $100/CY and 2026 @ $200/CY —
   *  produced suggestedRate $120 or $180 depending on arrival order, and the
   *  field doc said "most recent" while the code said "first in the array".
   *  With n=1 the baseline carries 75% of the suggested rate, so on a cold book
   *  this WAS the number that priced the next job. */
  baseline: number;
  /** Blended suggested rate to use on the next bid (baseline → personal). */
  suggestedRate: number;
  confidence: 'low' | 'medium' | 'high';
  /** Total actual $ this entry represents — exposure / ranking weight. */
  totalActual: number;
  /** ISO stamp of the most recent MEASURED sample ('' when none). Seeds are
   *  excluded: a seed's closedAt is whatever the contractor typed, and a seed
   *  with a recent asOf used to sort first and report itself as the last time
   *  this trade was seen. Rendered on the cost-database card as "last measured
   *  <Mon YYYY>" — a returning contractor could not otherwise tell that the
   *  rate pricing his next bid was measured four years ago. */
  lastSeen: string;
  samples: CostSample[];
}

export interface CostDatabase {
  /** Trades this book can PRICE. Every entry here has a rate derived from at
   *  least one sample that is allowed to teach one. */
  entries: CostBookEntry[];
  /**
   * Trades we saw on a closed job and deliberately cannot price yet, because
   * every sample behind them was disqualified as unit-rate evidence (a
   * commitment carrying approved change-order dollars against the original bid
   * quantity; a package price split across several estimate lines).
   *
   * They are kept OUT of `entries` so nothing — the screen, matchOwnRate, the
   * AI prompt — can quote a $0.00 rate, and kept in the database so the screen
   * can tell the contractor his painting job WAS read and say why it taught
   * nothing. Silence there would be the silent degradation this engine is
   * supposed to be the cure for. Optional for back-compat; always set.
   */
  entriesAwaitingEvidence?: CostBookEntry[];
  /** REAL closed jobs / receipt projects behind the book. Seeds never inflate
   *  this — a seeded book still honestly reads "0 closed jobs". */
  jobsAnalyzed: number;
  tradesTracked: number;
  /** How many of `tradesTracked` rest on a seeded rate with nothing measured
   *  behind them yet. Optional for back-compat; always set by the builder. */
  tradesSeededOnly?: number;
  /** Exposure-weighted accuracy = 1 − mean|bidBias|. null when no priced history. */
  overallBidAccuracy: number | null;
  asOf: string;
}

const isClosed = isClosedProject;

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function buildCostDatabase(
  projects: Project[],
  commitments: Commitment[],
  /** Snapped supplier invoices. Their line-item unit prices feed the price book
   *  as live `actual` material samples — additive; pass [] (default) for the
   *  original closed-jobs-only behavior. */
  receipts: MaterialReceipt[] = [],
  /** Self-perform labor samples (utils/laborSamples.ts buildLaborSamples):
   *  crew clocked hours priced at the GC's configured loaded rates. Keyed
   *  like everything else, with the unit normalized ("labor — framing|hr").
   *  Additive; [] (default)
   *  = zero behavior change for existing callers. */
  laborSamples: CostSample[] = [],
  /** COLD-START SEEDS (utils/costSeedCore). Rates the contractor pasted or
   *  typed before they had any closed-job history here — the only way a
   *  twenty-year GC's day-one estimate isn't a beginner's. Folded in as
   *  quantity-1, bidUnit-0 samples under a `seed:` projectId so they:
   *    • never count toward jobCount / jobsAnalyzed / bidBias
   *    • are washed out by the first real job's measured quantity
   *  Additive; [] (default) = byte-identical to the prior behavior. */
  seeds: SeededRate[] = [],
): CostDatabase {
  const asOf = new Date().toISOString();
  const groups = new Map<string, CostSample[]>();
  const jobs = new Set<string>();

  const pushSample = (key: string, s: CostSample) => {
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  };

  for (const project of projects) {
    if (!isClosed(project)) continue;
    const report = computeEstimateActuals(project, commitments);
    if (!report.hasEstimate) continue;
    // WHEN THIS JOB CLOSED — and why there is a third fallback.
    //
    // `closedAt` is stamped by the closeout flow. A GC who simply advances the
    // lifecycle stage instead (app/project-detail.tsx does
    // `updateProject(id, { status: STAGE_TO_STATUS[stage] })`) gets status
    // 'completed'/'closed' and NO date at all. Every sample from such a job
    // then carried closedAt '' — so the date sort below degenerated to array
    // order and the "most recent bid" prior reverted to whichever project
    // ProjectContext happened to hand over first: the same two jobs (2019 @
    // $100/CY and 2026 @ $200/CY) produced suggestedRate $180 or $120
    // depending on arrival order, which is the exact defect the sort was added
    // to fix. `updatedAt` is not the closeout date, but it is a real date that
    // moves when the job does, and it orders these books correctly instead of
    // not ordering them at all. It is also what makes the "Last measured"
    // row renderable for them; it silently never appeared before.
    const closedAt =
      project.closedAt || project.substantialCompletionDate || project.updatedAt || '';
    // …AND THE HALF OF IT THAT MAY BE PRINTED. `updatedAt` orders these books;
    // it does not date them. ProjectContext.updateProject stamps
    // `updatedAt: new Date().toISOString()` on every write, so a job actually
    // done in 2019 that was never formally closed out carries TODAY — and the
    // "Last measured" row, added to disclose staleness, asserted freshness
    // instead ("Last measured Sep 2026" over four-year-old work). The sort
    // keeps the fallback; the display gets only a real closeout date, and ''
    // renders nothing at all.
    const measuredAt = project.closedAt || project.substantialCompletionDate || '';

    let contributed = false;
    for (const l of report.lines) {
      if (l.quantity <= 0) continue;

      // THE COST OF A CLOSED SCOPE.
      //
      // A SETTLED payment is the cost (see SETTLED_PAYMENT_RATIO). A partial
      // one is not: it used to be preferred over the contract sum with no
      // proximity test, so a single mobilization deposit on a closed job
      // taught the book a tenth of the real rate and the screen congratulated
      // the GC in green for bidding "90% over actual cost". Below the settled
      // threshold we use the signed commitment — for a closed job a signed sub
      // IS what that scope cost you — and label the sample "signed" so the
      // screen never calls a contract a payment.
      // The third rung used to be `: l.actual` — an unsettled payment with no
      // contract sum behind it, taken at face value. That is the same 10x
      // error one rung up, reached from the other side: a commitment whose
      // amount is blank (or fully offset by a deductive CO) reports committed
      // 0 / hasCommitment false, so a $1,200 draw on a 30 SQ roof taught
      // $40/SQ. There is no honest number in that branch — a payment we cannot
      // prove is complete, against a contract sum nobody recorded — so the
      // line teaches nothing and stays out of the book, exactly as an
      // uncommitted, unpaid line already did.
      const cost = l.settled && l.actual > 0
        ? l.actual
        : l.hasCommitment
          ? l.committed
          : 0;
      if (cost <= 0) continue;

      // Human category first (readable price-book labels); CSI division only
      // as a fallback. Matches estimateActuals + jobCostEngine grouping.
      const trade = (l.category || l.csiDivision || 'Other').trim() || 'Other';
      const unit = (l.unit || 'unit').trim() || 'unit';

      // WHAT MAY NOT TEACH A RATE. Both of these produce a number that LOOKS
      // like a unit price and carries no unit-price information, because the
      // denominator is the original bid quantity and the numerator is not the
      // cost of that quantity. Kept as visible samples with a reason; dropped
      // from rate / variability / bias / jobCount. Full argument in the field
      // docs on EstimateLineActual.changeOrderAmount and .fromSharedCommitment.
      const excludedReason: CostSample['excludedReason'] | undefined =
        l.changeOrderAmount !== 0 ? 'change_order'
          : l.fromSharedCommitment ? 'package_allocation'
            : undefined;

      const sample: CostSample = {
        projectId: project.id,
        projectName: project.name,
        trade,
        unit,
        quantity: l.quantity,
        bidUnit: l.bidUnit ?? 0,
        actualUnit: cost / l.quantity,
        basis: l.settled && l.actual > 0 ? 'actual' : 'committed',
        closedAt,
        measuredAt,
        ...(excludedReason ? { excludedFromRate: true, excludedReason } : {}),
      };
      pushSample(bookKey(trade, unit), sample);
      contributed = true;
    }

    // SELF-PERFORM: the one place "what it costs at YOUR hands" is literally
    // true was the one place the book was empty. A self-performed line has no
    // commitment by definition, so the loop above resolved it to cost 0 and
    // skipped it — while the crew hours and the lumber receipts that DID pay
    // for it entered the book under keys ("labor — framing|hr",
    // "framing|ea") that can never price a "Framing | SF" estimate line. A
    // closed job with a 2,400 SF framing line, ten 8-hour framing shifts at
    // $65/hr and a $5,580 lumber receipt taught lookupRate(db,'Framing','SF')
    // exactly nothing, when the rate it should have learned —
    // ($5,200 + $5,580) / 2,400 = $4.49/SF — was already fully in the data.
    //
    // Note the component samples stay in the book too, so the same dollars
    // appear under both the trade rate and the material/labor rows. That is
    // deliberate: this is a price book, not a ledger, and the material unit
    // price is worth keeping on its own.
    for (const s of selfPerformSamples(project, report, receipts, laborSamples, closedAt, measuredAt)) {
      pushSample(bookKey(s.trade, s.unit), s);
      contributed = true;
    }

    if (contributed) jobs.add(project.id);
  }

  // Fold in supplier-invoice samples — live material prices, available the day
  // the GC snaps the receipt (no wait for project closeout). Keyed the same way
  // (trade|unit) so a material that already has a closed-job history just gets
  // more, fresher samples.
  if (receipts.length > 0) {
    const nameById = new Map(projects.map(p => [p.id, p.name]));
    for (const receipt of receipts) {
      const samples = receiptToCostSamples(receipt, nameById.get(receipt.projectId) ?? 'Project');
      for (const s of samples) {
        pushSample(bookKey(s.trade, s.unit), s);
        // A receipt snapped before it was filed against a job carries
        // projectId '' — and `jobs` is a Set, so the empty string counted as a
        // job. One unassigned receipt on an account with NO projects rendered
        // "1 closed job" on the screen. A job has to exist to be counted.
        if (receipt.projectId) jobs.add(receipt.projectId);
      }
    }
  }

  // Fold in self-perform labor — crew hours × the GC's own loaded rates,
  // available the day the shift is clocked out (no wait for closeout). Same
  // additive shape as receipts; the "Labor — <trade>" label keeps these
  // entries legible as labor in the price book, never a subcontract scope.
  for (const s of laborSamples) {
    if (s.quantity <= 0 || s.actualUnit <= 0) continue;
    pushSample(bookKey(s.trade, s.unit), s);
    if (s.projectId) jobs.add(s.projectId);
  }

  // Fold in cold-start seeds LAST so they only ever add rows, never displace
  // one. Deliberately NOT added to `jobs` — a rate the contractor stated is
  // not a job with cost data behind it, and the headline count must stay true.
  for (const s of seedsToCostSamples(seeds)) {
    pushSample(bookKey(s.trade, s.unit), s);
  }

  const priced: CostBookEntry[] = [];
  const unpriced: CostBookEntry[] = [];
  for (const [key, ss] of groups) {
    // OUTLIER REJECTION. A trade's learned rate must not be poisoned by a
    // one-off blowout (a weather week, a fat-fingered actual). We flag gross outliers among the REAL (non-seed)
    // samples and drop them from every learning statistic below — but keep
    // them in `samples` so the GC still sees the job. Seeds are priors, never
    // outlier-tested. flagOutliers is a no-op below ROBUST_MIN_SAMPLES and
    // never rejects more than a minority, so cold-start entries are untouched.
    // Samples the DERIVATION already disqualified (a change-order-bearing
    // commitment, a package price split across lines) are out of every
    // statistic before outlier rejection even runs — they are not evidence
    // that happens to look odd, they are numbers with no unit-price content,
    // and feeding them to the median/MAD would let them move the very
    // threshold that is supposed to catch them.
    const notEvidence = new Set<CostSample>(ss.filter(s => s.excludedFromRate));
    // A MATERIAL PRICE IS NOT AN INSTALLED RATE.
    //
    // Once a self-perform sample is in this row, the row's meaning is "what
    // this scope costs installed" — and its numerator ALREADY contains this
    // job's receipt dollars for the trade. A receipt sample that happens to
    // carry the same unit as the scope therefore lands in the same row as the
    // total it is a part of, and averaging the two gives a number that is
    // neither: the $1.80/SF drywall job below learned $1.15. (The §6h fixture
    // dodged this by pricing its lumber in 'ea' against an SF scope, so the
    // two never met.) Cross-project is the same collision one step out — a
    // bare board price is not evidence of an installed rate either — so the
    // test is the row's meaning, not the projectId.
    //
    // These stay VISIBLE with their own reason and their own sentence: the
    // material unit price is worth keeping (it is what a receipts-only book
    // legitimately learns), it is just not what THIS row measures.
    const hasSelfPerform = ss.some(s => s.basis === 'self_perform');
    const materialComponents = new Set<CostSample>(
      hasSelfPerform ? ss.filter(s => s.source === 'receipt' || s.source === 'qbo') : [],
    );
    const excluded = new Set<CostSample>([...notEvidence, ...materialComponents]);
    const realSamples = ss.filter(s => !isSeedSample(s) && !excluded.has(s));
    const outlierFlags = flagOutliers(realSamples.map(s => s.actualUnit));
    realSamples.forEach((s, i) => { if (outlierFlags[i]) excluded.add(s); });
    // The learning set: everything except the rejected samples (seeds stay).
    const learn = ss.filter(s => !excluded.has(s));

    const qtyTotal = learn.reduce((a, s) => a + s.quantity, 0);
    const personalRate =
      qtyTotal > 0
        ? learn.reduce((a, s) => a + s.actualUnit * s.quantity, 0) / qtyTotal
        : mean(learn.map(s => s.actualUnit));

    const variance =
      qtyTotal > 0
        ? learn.reduce((a, s) => a + s.quantity * (s.actualUnit - personalRate) ** 2, 0) / qtyTotal
        : 0;
    const variability = personalRate > 0 ? Math.sqrt(variance) / personalRate : 0;

    const biasSamples = learn.filter(s => s.bidUnit > 0);
    const biasQty = biasSamples.reduce((a, s) => a + s.quantity, 0);
    const bidBias =
      biasQty > 0
        ? biasSamples.reduce((a, s) => a + s.quantity * (s.actualUnit / s.bidUnit - 1), 0) / biasQty
        : 0;

    // Sort ALL samples for display; mark the rejected ones. Spread only the
    // excluded ones into fresh objects so the shared input arrays (receipt/
    // labor/seed samples pushed by reference) are never mutated.
    //
    // The comparator is TOTAL. It used to return -1 for EQUAL keys, which is
    // not a valid ordering: two jobs closed on the SAME DAY compared as "a
    // before b" AND "b before a", so the engine's answer depended on which one
    // the array happened to hold first — the same $200-vs-$100 baseline flip
    // the date sort exists to eliminate, reachable without any missing date.
    // Same-day jobs have no "more recent" one, so the tiebreak is projectId:
    // arbitrary, but the same every time, which is the whole point.
    const sorted = [...ss]
      .sort((a, b) =>
        a.closedAt === b.closedAt
          ? (a.projectId === b.projectId ? 0 : a.projectId < b.projectId ? -1 : 1)
          : a.closedAt < b.closedAt ? 1 : -1)
      .map(s => (excluded.has(s)
        ? {
          ...s,
          excludedFromRate: true,
          ...(materialComponents.has(s) ? { excludedReason: 'material_component' as const } : {}),
        }
        : s));

    // THE PRIOR IS THE MOST RECENT BID, NOT THE FIRST ONE IN THE ARRAY.
    // This read `learn.find(s => s.bidUnit > 0)` — insertion order, i.e.
    // whichever project ProjectContext happened to hand over first (it sorts
    // by updatedAt, not closedAt). The same two jobs — 2019 @ $100/CY and
    // 2026 @ $200/CY — produced suggestedRate $120 or $180 depending on
    // arrival order, while the field doc promised "most recent". With n=1 the
    // baseline carries 75% of the suggested rate, so on a cold book this WAS
    // the number that priced the next job. `sorted` is closedAt-descending;
    // take the newest priced sample that is still allowed to teach.
    // (`sorted` carries CLONES of the excluded samples, so the exclusion has
    // to be read off the stamped flag, not off the `excluded` Set.)
    const baseline = sorted.find(s => s.bidUnit > 0 && !s.excludedFromRate)?.bidUnit
      || sorted.find(s => s.bidUnit > 0)?.bidUnit
      || personalRate;

    // WHEN THIS TRADE WAS LAST MEASURED. Seeds are skipped: a seed's closedAt
    // is whatever the contractor typed (often today's date on a rate sheet
    // they pasted), and it would sort first and report itself as the last time
    // we saw this trade — the exact inversion this field exists to prevent.
    // …and it is `measuredAt` where the sample carries one, NOT the closedAt
    // the sort runs on: closedAt falls back to project.updatedAt (stamped on
    // every write), so printing it made a 2019 job report "Last measured
    // <this month>". A receipt or a clocked shift has no such fallback — its
    // closedAt IS the date of the thing — so those keep using it.
    const lastSeen = sorted
      .map(s => (isSeedSample(s) ? '' : (s.measuredAt ?? s.closedAt) || ''))
      .find(d => !!d) || '';

    // EVIDENCE COUNT IS EARNED-ONLY AND CLEAN-ONLY. Seed samples are excluded
    // from jobIds, so a seeded-only entry has n=0 → w=0 → suggestedRate = the
    // stated rate (baseline falls back to personalRate when no bid exists), and
    // confidence stays 'low'. Outlier jobs are excluded too — a blowout job
    // shouldn't buy confidence in a rate it wasn't allowed to set.
    const seededSamples = ss.filter(isSeedSample);
    const seededSampleCount = seededSamples.length;
    // …and a sample with NO project is not a job either. The headline
    // `jobsAnalyzed` was taught this (a receipt snapped before it is filed
    // carries projectId ''), but jobIds was not — so a single unfiled receipt
    // produced jobCount 1, which is the number the MEASURED chip prints, the
    // blend weight uses, the AI prompt cites, and — worst — the cross-
    // contractor publish gate reads (`earned && jobCount >= 1`). One receipt
    // that was never attached to a job could send a rate out of the tenant.
    const jobIds = new Set(
      learn.filter(s => !isSeedSample(s) && !!s.projectId).map(s => s.projectId),
    );
    const n = jobIds.size;
    const w = n / (n + BLEND_K);
    const suggestedRate = baseline > 0 ? baseline * (1 - w) + personalRate * w : personalRate;

    // WHAT THE EARNED HALF RESTS ON. jobCount counts distinct projects among
    // non-seed samples and says nothing about whether a dollar ever moved, so
    // a book where every sample was a SIGNED sub nobody has paid still emitted
    // "MEASURED · 4 jobs". A signed contract is real evidence — it is just a
    // different kind from a paid one, and the product's whole claim is that we
    // never blur those. 'paid' needs at least one settled payment / receipt /
    // self-perform cost among the samples that actually teach the rate.
    const earnedLearn = learn.filter(s => !isSeedSample(s));
    const earnedBasis: NonNullable<CostBookEntry['earnedBasis']> =
      earnedLearn.length === 0
        ? 'stated'
        : earnedLearn.some(s => s.basis !== 'committed')
          ? 'paid'
          : 'contracted';

    // IS THE ± BAND A MEASUREMENT? Two ways it is not:
    //   • fewer than two clean MEASURED samples — dispersion from n=1 is
    //     undefined, not 0, and the card printed "$2.00 ±0%" after one job.
    //   • every clean measured sample carries a price the GC STATED (clocked
    //     hours at the one loaded rate he typed in settings) — six shifts at
    //     $65/hr agree by construction, not by observation.
    //
    // A SEED IS NOT A SAMPLE FOR THIS TEST, and counting it as one defeated the
    // rule on the product's primary cold-start path. The count used to run over
    // all of `learn` (seeds included, because seeds deliberately stay in the
    // learning set as the prior), and `allStatedPrice` used `.every`, so ONE
    // typed rate-sheet line plus ONE closed job scored pricedLearn 2 and
    // allStatedPrice false ⇒ spreadMeaningful true. Measured: a Trim seed at
    // $9.00/LF plus one 400 LF job settled at $4.50/LF published "±5%" — a
    // dispersion statistic whose entire spread is the gap between the
    // contractor's guess and a single job, printed as though we had watched the
    // trade vary. The band has to be a spread BETWEEN MEASUREMENTS or nothing.
    const pricedLearn = learn.filter(s => !isSeedSample(s) && s.actualUnit > 0);
    const allStatedPrice = pricedLearn.every(s => s.source === 'labor_rate');
    const spreadMeaningful = pricedLearn.length >= 2 && !allStatedPrice;

    // 'high' is the strongest thing this screen says, and it used to be
    // reachable from a spread that was arithmetic rather than observation —
    // six clocked shifts at one typed rate scored n=5, variability 0, 'high'.
    // A claim of low spread requires a spread we actually measured.
    const confidence: CostBookEntry['confidence'] =
      n >= 5 && variability <= 0.2 && spreadMeaningful ? 'high' : n >= 3 ? 'medium' : 'low';

    const provenance: NonNullable<CostBookEntry['provenance']> =
      seededSampleCount === 0 ? 'earned' : n === 0 ? 'seeded' : 'mixed';

    // Exposure weight stays over ALL samples (an outlier job still represents
    // real dollars you spent — it just doesn't get to move the rate).
    const totalActual = ss.reduce((a, s) => a + s.actualUnit * s.quantity, 0);

    // A rate of 0 means every sample here was disqualified as unit-rate
    // evidence. It is not a price, so it does not go in the price book.
    (personalRate > 0 ? priced : unpriced).push({
      key,
      trade: ss[0].trade,
      unit: ss[0].unit,
      sampleCount: ss.length,
      jobCount: n,
      seededSampleCount,
      // Outliers only — a job that came in far off the usual. Derivation
      // exclusions are counted separately, because the UI must not explain a
      // change order with the one-bad-week sentence.
      excludedSampleCount: excluded.size - notEvidence.size - materialComponents.size,
      notRateEvidenceCount: notEvidence.size,
      materialComponentCount: materialComponents.size,
      provenance,
      earnedBasis,
      personalRate,
      variability,
      spreadMeaningful,
      bidBias,
      baseline,
      suggestedRate,
      confidence,
      totalActual,
      lastSeen,
      samples: sorted,
    });
  }

  const entries = priced.sort((a, b) => b.totalActual - a.totalActual);
  unpriced.sort((a, b) => b.totalActual - a.totalActual);

  // Bid accuracy is est-vs-actual — it can only be computed from entries with
  // something MEASURED behind them. A seeded-only entry has bidBias 0 by
  // construction, so leaving it in would report a perfect 100% to a contractor
  // who has closed nothing. Excluded.
  const earnedEntries = entries.filter(e => e.provenance !== 'seeded');
  const expTotal = earnedEntries.reduce((a, e) => a + e.totalActual, 0);
  const overallBidAccuracy =
    expTotal > 0
      ? 1 - earnedEntries.reduce((a, e) => a + e.totalActual * Math.abs(e.bidBias), 0) / expTotal
      : null;

  return {
    entries,
    entriesAwaitingEvidence: unpriced,
    jobsAnalyzed: jobs.size,
    tradesTracked: entries.length,
    tradesSeededOnly: entries.filter(e => e.provenance === 'seeded').length,
    overallBidAccuracy,
    asOf,
  };
}

/**
 * Look up a learned rate for a trade+unit — used by the estimate-confidence
 * layer (Build A3) to flag a line whose price deviates from your history.
 */
export function lookupRate(db: CostDatabase, trade: string, unit: string): CostBookEntry | null {
  // Same normalization as bookKey — an exact lowercase match meant
  // rateEntryFor('Framing','sq ft') and rateEntryFor('Framing','SF') resolved
  // to two DIFFERENT entries on the same book (one earned, one seeded).
  const key = bookKey(trade, unit || 'unit');
  return db.entries.find(e => e.key === key) ?? null;
}

/**
 * SELF-PERFORM: what a scope cost at the GC's own hands.
 *
 * A self-performed estimate line has no commitment by definition, so the main
 * loop resolved it to cost 0 and skipped it — while the crew hours and the
 * lumber receipts that DID pay for it entered the book under keys
 * ("labor — framing|hr", "framing|ea") that can never price a "Framing | SF"
 * estimate line. lookupRate(db,'Framing','SF') returned null on a job where
 * every input to the real answer — ($5,200 labor + $5,580 material) / 2,400 SF
 * = $4.49/SF — was already in the database.
 *
 * The derivation, and its two deliberate conservatisms:
 *
 *  • SCOPE comes from the estimate lines of this job that have NO commitment
 *    and NO payment behind them, summed per trade+unit. Summing is what makes
 *    it safe to have several lines of one trade: the dollars are attributed to
 *    the trade, not to a line, so they are divided by ALL of that trade's
 *    self-performed quantity exactly once.
 *
 *  • COST comes from the direct dollars this job already attributes to that
 *    trade: priced clocked hours (utils/laborSamples) and receipt lines whose
 *    category is that trade.
 *
 *  • BOTH COST STREAMS ARE REQUIRED — clocked hours for this trade AND
 *    receipt dollars for this trade. Not a technicality: it is what stops this
 *    derivation from publishing a number that is short by an entire cost
 *    stream. Two ways that happened, and the first version of this function
 *    only closed one of them.
 *
 *    (a) The CALLER hands over a partial world. Most cost-book consumers do:
 *        app/cost-xray, app/area-takeoff, app/daily-report,
 *        utils/bidLevelingEngine and components/BidConfidenceBadge all pass
 *        receipts and `[]` for labor; app/takeoff-estimate passes neither
 *        (docs/audits 2026-09-11, the "one book, one answer" finding). Summing
 *        whichever streams arrived made the SAME trade+unit key carry a
 *        different rate on every screen: the 2,400 SF framing job below
 *        measured $4.49/SF on the full book, $2.33/SF with receipts only and
 *        $2.17/SF with labor only.
 *
 *    (b) The BOOK is full and the trade's materials are filed elsewhere. A
 *        receipt line's `category` is free text the GC types
 *        (app/material-receipt.tsx, placeholder "Category (e.g. Framing)") and
 *        utils/materialReceipt defaults it to 'Materials'. So the ordinary case
 *        — a full book, a closed job, 80 clocked framing hours and a $5,580
 *        lumber receipt filed under 'Materials' — produced a labor-only
 *        "installed rate" of $2.17/SF against a true $4.49/SF: 52% short,
 *        stamped provenance 'earned' / earnedBasis 'paid', rendered
 *        "MEASURED · 1 job", and eligible for the cross-contractor index. A
 *        clocked-hours-only gate cannot see this at all, because the labor side
 *        IS present. Requiring the material side too is the only test that
 *        distinguishes "this trade's costs are fully attributed here" from
 *        "half of them went somewhere else".
 *
 *    A rate short by a whole stream is worse than no rate — it is wrong in the
 *    direction that makes a correct bid look padded, which is exactly what the
 *    deposit blocker did. A partial or mis-filed book emits NOTHING here
 *    (missing, which every surface already handles honestly) rather than
 *    something cheap. The cost of the rule is a genuinely material-free
 *    self-performed scope (pure demolition, pure cleanup) staying unpriced;
 *    that is accepted, because from inside this function "no materials were
 *    needed" and "the materials were categorised as something else" are the
 *    same observation. Both halves are pinned by
 *    scripts/validate-estimate-cost-basis.ts §6h/§6i.
 *
 *  • A trade with ANY committed line on this job is SKIPPED entirely. Crew
 *    hours on a trade that was also subbed cannot be split between the subbed
 *    and self-performed halves, and guessing would teach a rate off dollars
 *    that belong to someone else's scope.
 *
 *  • A trade with no direct dollars at all emits nothing. Silence is honest;
 *    a $0/SF framing rate is not.
 */
/**
 * normalizeTradeKey's sink for un-named trades — '', 'crew', 'general' and
 * 'labor' all fold onto it (utils/laborSamples GENERIC_TRADES).
 *
 * Refusing it on the RECEIPT side is sufficient to keep it out of the emitted
 * rates entirely: the both-streams rule below requires the trade to be in
 * `materialTrades`, and this skip is the only thing that ever puts a key
 * there. A scope-side skip as well would be exactly equivalent and therefore
 * unguardable — remove either one alone and the fixture stays green, which is
 * the state a guard is supposed to make impossible.
 */
const GENERIC_TRADE_KEY = 'general';

function selfPerformSamples(
  project: Project,
  report: EstimateActualsReport,
  receipts: MaterialReceipt[],
  laborSamples: CostSample[],
  closedAt: string,
  /** See CostSample.measuredAt — the closeout date we can actually attest,
   *  which is NOT the updatedAt fallback `closedAt` may be carrying. */
  measuredAt: string,
): CostSample[] {
  interface Scope { trade: string; unit: string; quantity: number; bid: number }
  const scopes = new Map<string, Scope>();
  const subbedTrades = new Set<string>();

  for (const l of report.lines) {
    const trade = (l.category || l.csiDivision || 'Other').trim() || 'Other';
    const tradeKey = normalizeTradeKey(trade);
    if (l.hasCommitment || l.actual > 0) { subbedTrades.add(tradeKey); continue; }
    if (l.quantity <= 0) continue;
    const unit = (l.unit || 'unit').trim() || 'unit';
    const key = `${tradeKey}|${unitKey(unit)}`;
    const cur = scopes.get(key);
    if (cur) { cur.quantity += l.quantity; cur.bid += l.bid; }
    else scopes.set(key, { trade, unit, quantity: l.quantity, bid: l.bid });
  }
  if (scopes.size === 0) return [];

  const directByTrade = new Map<string, number>();
  /** Trades with clocked hours in THIS book — half of the completeness gate. */
  const clockedTrades = new Set<string>();
  /** Trades with receipt dollars in THIS book — the other half. */
  const materialTrades = new Set<string>();
  const addDirect = (trade: string, dollars: number) => {
    if (!(dollars > 0)) return;
    const k = normalizeTradeKey(trade);
    if (!k) return;
    directByTrade.set(k, (directByTrade.get(k) ?? 0) + dollars);
  };

  for (const s of laborSamples) {
    if (s.projectId !== project.id) continue;
    const k = laborSampleTradeKey(s.trade);
    if (!k) continue;
    if (s.actualUnit * s.quantity > 0) clockedTrades.add(k);
    addDirect(k, s.actualUnit * s.quantity);
  }
  for (const r of receipts) {
    if (r.projectId !== project.id) continue;
    for (const rl of r.lines ?? []) {
      if (rl.quantity <= 0 || rl.unitPrice <= 0) continue;
      // AN UNCATEGORISED RECEIPT LINE IS NOT A NAMED TRADE'S MATERIAL.
      // normalizeTradeKey folds '', 'crew', 'general' and 'labor' onto the
      // single key 'general' (utils/laborSamples GENERIC_TRADES), so a blank-
      // or "Labor"-categorised receipt line used to pool under a key that a
      // scope line categorised 'Labor'/'Crew'/'General' would then absorb
      // whole — and satisfy the material half of the completeness gate for it.
      // The main book loop defaults an uncategorised line to 'Other', so the
      // two namespaces did not even agree about what a blank category is.
      // A line whose trade we cannot name funds no trade's installed rate.
      const raw = (rl.category || '').trim();
      const k = normalizeTradeKey(raw);
      if (!raw || k === GENERIC_TRADE_KEY) continue;
      materialTrades.add(k);
      addDirect(raw, rl.quantity * rl.unitPrice);
    }
  }
  if (directByTrade.size === 0) return [];

  // A trade's direct dollars are spent ONCE. If the same trade appears under
  // two different units (a framing SF line and a framing EA line), there is no
  // basis for splitting the dollars between them, so we emit nothing rather
  // than double-count the cost into both rates.
  const unitsPerTrade = new Map<string, number>();
  for (const key of scopes.keys()) {
    const t = key.slice(0, key.indexOf('|'));
    unitsPerTrade.set(t, (unitsPerTrade.get(t) ?? 0) + 1);
  }

  const out: CostSample[] = [];
  for (const [key, sc] of scopes) {
    const tradeKey = key.slice(0, key.indexOf('|'));
    if (subbedTrades.has(tradeKey)) continue;
    if ((unitsPerTrade.get(tradeKey) ?? 0) !== 1) continue;
    // BOTH STREAMS OR NOTHING. A missing stream has three indistinguishable
    // causes from in here — the caller passed [] for it, the crew/supplier
    // genuinely was not involved, or the dollars were filed under a different
    // free-text category — and in two of the three the "installed rate" we
    // would publish is short by that whole stream. No clocked hours ⇒ a
    // materials-only rate; no receipt dollars ⇒ a labor-only rate ($2.17/SF
    // against a true $4.49/SF on the fixture below, stamped MEASURED and
    // eligible for the public index). Say nothing. (See the BOTH COST STREAMS
    // note above for the full argument, including why this is the right answer
    // even for a scope that really did use no materials.)
    if (!clockedTrades.has(tradeKey) || !materialTrades.has(tradeKey)) continue;
    const direct = directByTrade.get(tradeKey) ?? 0;
    if (!(direct > 0) || sc.quantity <= 0) continue;
    out.push({
      projectId: project.id,
      projectName: project.name,
      trade: sc.trade,
      unit: sc.unit,
      quantity: sc.quantity,
      bidUnit: sc.bid > 0 ? sc.bid / sc.quantity : 0,
      actualUnit: direct / sc.quantity,
      basis: 'self_perform',
      closedAt,
      measuredAt,
    });
  }
  return out;
}
