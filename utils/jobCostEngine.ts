// jobCostEngine.ts — derive per-phase and project-level job cost lines from
// the existing Estimate / Commitment / MaterialReceipt / TimeEntry data.
//
// The four numbers every GC needs:
//
//   BUDGET    — what you said it would cost (estimate + approved COs)
//   COMMITTED — signed subs + POs against that budget
//   ACTUAL    — what the GC has actually paid OUT: commitment.paidToDate
//               (subs + POs) + snapped material receipts + priced crew hours
//               + logged equipment days at the machine's day rate
//               + permit fees
//   EAC       — projected final cost at completion
//
// ACTUAL IS COST, NEVER REVENUE. Money the CLIENT pays the GC is revenue and
// is not a job cost — it belongs to the WIP billings column, not here. Until
// MONEY-DEF-1 (audit 2026-09-07) this engine's only actual-cost signal was
// `Invoice.amountPaid`, so a homeowner's deposit looked like budget burn while
// a GC who had performed $300K and billed nothing showed Actual $0 and "on
// track to finish under budget" — and that definition fed the CPI, the margin
// alerts, the bank-facing WIP tab and the AI. utils/wip.suggestCostToDate and
// utils/estimateActuals already used the correct definition; this engine now
// agrees with them, and scripts/validate-money-definitions.ts pins the two
// together so they cannot drift apart again.
//
// MONEY-EQP-1 / MONEY-PMT-1 (audit 2026-09-07, "worth doing" #12): equipment
// utilization and permit fees are both captured (logUtilization writes hours
// against a projectId; Permit.fee is typed in on every permit) and posted here
// NOWHERE. A GC self-performing excavation ran a $450/day machine for six days
// and saw $0 of it in that job's actuals, and every permit he pulled was free.
// Both omissions understate cost in the direction that makes a bleeding job
// look healthy, and both flow on into the CPI, the margin alerts and the WIP
// row. They are additive inputs — omit them and the engine behaves exactly as
// it did before — and scripts/validate-job-cost.ts pins the arithmetic.
//
// EAC (estimate at completion) method — MAGE opinionated default:
//
//   EAC = ACTUAL + max(0, COMMITTED - paidAgainstCommitments)
//                + max(0, BUDGET - COMMITTED - directCost)   // uncommitted
//
// Rationale: we know we'll pay out the remaining commitment balance (that
// work is signed). If budget exceeds what's been committed AND what we've
// already paid out of pocket, we still owe that work to sub-buy (so it acts
// as a floor).
//
// EAC-DIRECT-1 (audit 2026-09-07): the uncommitted term used to be
// `max(0, BUDGET - COMMITTED)` flat, and the remaining-commitment term used
// the WHOLE actual. Direct cost — receipts, crew hours, equipment, permits —
// is covered by neither `committed` nor a commitment balance, so it was added
// on top of the entire budget while also shrinking a sub's remaining contract.
// A job with $3,000 budgeted for permits and $3,015 paid projected $6,015 and
// reported "Over by $3,015". The split is arithmetically identical on any
// phase whose only actual is commitment payments.
//
// SIGN CONVENTION — variance = projectedFinal - budget, so POSITIVE = OVER
// BUDGET and negative = under. If commitments already exceed budget then
// EAC collapses to `committed`, and variance = committed - budget > 0 — the
// signal a PM needs to kill the project before it bleeds further.
//
// This comment used to claim the opposite ("shows up negative"), which the
// formula three lines below never did and arithmetically could not. The Job
// Costing screen believed the prose instead of the code and told a GC he was
// "$49K UNDER budget" while he was $49K over (docs/audits/2026-08-17-web-audit.md).
// Note this is the OPPOSITE of the EVM convention in utils/scheduleEarnedValue.ts,
// where `varianceAtCompletion = BAC - EAC` and positive means under. Do not
// carry a sign across the two engines. Render through `describeVariance`
// below rather than re-deriving `variance >= 0` at a call site; that
// re-derivation is exactly what shipped the bug.
//
// NOTE: we intentionally don't include progress-weighted EAC variants
// (CPI / SPI-based) here — those require earned-value output which is a
// separate concern. See utils/scheduleEarnedValue.ts
// (buildEarnedValueSnapshot, legacyEvmMetrics) for that flavor.

import type {
  Project,
  Commitment,
  Invoice,
  ChangeOrder,
  MaterialReceipt,
  TimeEntry,
  Equipment,
  Permit,
  LinkedEstimateItem,
} from '@/types';
import {
  isEligibleLaborEntry, normalizeTradeKey, priceLaborEntry, DEFAULT_OVERTIME_MULTIPLIER,
  type LaborRateMap,
} from '@/utils/laborSamples';
// The contract value the CO cost ratio is measured against — the same
// definition every other money surface uses (JOBCOST-CO-COST-1).
import { effectiveEstimateTotal } from '@/utils/estimateCommit';

export interface JobCostLine {
  /** Grouping key — phase name or '(uncategorized)'. */
  phase: string;
  /** Estimate + approved CO deltas. */
  budget: number;
  /** Signed subs + POs. */
  committed: number;
  /** Cost paid out on this phase — commitment payments, material receipts,
   *  priced crew hours, equipment days and permit fees. Never client money in
   *  (see header). */
  actual: number;
  /** Projected final cost using the MAGE EAC method (see header). */
  projectedFinal: number;
  /** projectedFinal - budget. Positive = over budget (see header). */
  variance: number;
  /** Ratio of actual to budget, clamped to [0, 2]. */
  burnRatio: number;
  /** Status classification for dashboard chips. `unbudgeted` = real money
   *  landed on a phase carrying no budget, so there is nothing to be on
   *  track against. */
  status: 'on_track' | 'warning' | 'over' | 'unbudgeted';
  /**
   * WHICH records built this line — record ids, not counts.
   *
   * MONEY-DRILL-1 (audit 2026-09-07, "worth doing" #25): these were four
   * integers, so the phase sheet said "Commitments 3, Material receipts 7" and
   * a PM reading "Electrical over by $9,200" had to go reconcile by hand in
   * another tab — the work the tool was bought to remove. The loops below
   * already hold the record, so keeping only its cardinality threw the answer
   * away. Call sites take `.length` where they want the count.
   *
   * There is no `invoices` entry: client invoices are revenue and contribute
   * nothing here (MONEY-DEF-1). `equipment` holds EquipmentUtilizationEntry
   * ids (one per logged shift), not Equipment ids — the entry is the thing
   * that carries the hours and the project.
   */
  sources: {
    commitments: string[];
    changeOrders: string[];
    receipts: string[];
    timeEntries: string[];
    equipment: string[];
    permits: string[];
  };
}

export interface JobCostSummary {
  asOf: string;
  /** Total budget including approved change orders. */
  budget: number;
  /** Sum of all committed sub/PO amounts (incl. CO revisions). */
  committed: number;
  /** Sum of cost paid out — commitment payments + material receipts +
   *  priced crew hours + equipment days + permit fees. NOT client payments
   *  (see header). */
  actual: number;
  /** Sum of projected finals. */
  projectedFinal: number;
  /** projectedFinal - budget. Positive = projecting over budget (see header). */
  variance: number;
  /** Percent of budget committed (signed). NOT capped at 100 — 175% means
   *  you've signed $1.75 of subs for every budgeted dollar, and capping it
   *  is how an over-budget job used to look on-budget. */
  commitmentCoverage: number;
  /** Percent of budget spent. NOT capped at 100 — see commitmentCoverage. */
  spendPercent: number;
  byPhase: JobCostLine[];
  /** Top three phases by variance magnitude. */
  biggestVariances: JobCostLine[];
  /**
   * Per-phase projected overage the PROJECT headline does not carry — i.e.
   * `Σ byPhase.projectedFinal − projectedFinal`, floored at zero.
   *
   * WHY A SCREEN MUST RENDER THIS (audit 2026-09-11, review round 3). The
   * headline takes the uncommitted floor ONCE over the whole job (see the
   * totals block), so genuinely unbudgeted spend is absorbed by the job's
   * remaining uncommitted budget until that budget runs out. The phase rows
   * and `biggestVariances` still show it — correctly, because it IS spend the
   * estimate never priced — and a screen that prints both without a word
   * between them gives the GC two answers to "am I over" in one render. That
   * is the two-screens-disagree defect moved inside a single screen.
   *
   * Zero on the ordinary job. When it is not zero the screen owes the reader
   * one sentence: this much of what the rows below show is being absorbed by
   * budget that has not been committed yet.
   */
  absorbedVariance: number;
  /** Commitments that exceed their linked estimate items. */
  overcommittedCommitments: Commitment[];
  /** Engine signature for reports / telemetry. */
  method: 'mage_committed_plus_uncommitted';
}

const PHASE_UNCATEGORIZED = '(Uncategorized)';

/**
 * Phase buckets for the two cost streams that carry no phase of their own.
 *
 * Plain names on purpose: an estimate whose categories happen to include
 * "Equipment" or "Permits" merges into that budgeted line rather than opening
 * a second unbudgeted one beside it. The match is exact and case-sensitive,
 * like every other phase match in this file — a "permits" line in the estimate
 * stays its own bucket, which reads as unbudgeted rather than silently
 * absorbing the fees.
 */
const PHASE_EQUIPMENT = 'Equipment';
const PHASE_PERMITS = 'Permits';

/**
 * Hours per charged equipment day. components/AIEquipmentAdvice.tsx
 * `measuredUsage` already converts the same log with `daysUsed = hours / 8`,
 * and contexts/ProjectContext.getEquipmentCostForProject instead counts LOG
 * ROWS (`Math.max(daysUsed, 1)`), which bills a full day for a one-hour lift
 * and two days for two entries on the same date. This engine follows the
 * hours-based definition: it is the one the rent-vs-buy panel shows the GC,
 * and cost that disagrees with the panel that justified the machine is worse
 * than no cost at all. Exported so the guard pins the number, not a copy.
 */
export const EQUIPMENT_HOURS_PER_DAY = 8;

/**
 * What a commitment is worth today — the signed amount plus the net of the
 * approved change orders written against it. `amount` is deliberately never
 * mutated by a CO revision (see the field doc on Commitment), so reading it
 * alone understates every commitment that has been revised.
 */
export function commitmentValue(c: Commitment): number {
  const signed = Number.isFinite(c.amount) ? c.amount : 0;
  const revisions = Number.isFinite(c.changeAmount) ? (c.changeAmount as number) : 0;
  return signed + revisions;
}

/**
 * What has already gone OUT against a commitment — the server-maintained
 * rollup of approved-and-paid sub invoices. COST, not revenue: this is the
 * GC's money leaving, never the client's money arriving. Floored at zero
 * because a negative rollup is a data fault, not a refund.
 */
export function commitmentPaidToDate(c: Commitment): number {
  const paid = Number.isFinite(c.paidToDate) ? (c.paidToDate as number) : 0;
  return Math.max(0, paid);
}

/**
 * CASH still to leave the bank against a signed commitment — what the GC has
 * committed to and has NOT yet paid.
 *
 * Snapped material receipts are deliberately NOT netted out of this, and that
 * is the one place where the cash view and this engine's EAC legitimately
 * differ, so it is worth being explicit about why:
 *
 *   • The EAC above nets them, and must. There, a receipt is already inside
 *     `actual`, so leaving the same lumber in the remaining commitment balance
 *     as well would project a $10,000 PO with $6,000 of snapped receipts at
 *     $16,000 (EAC-DIRECT-1 — the finalize pass documents that arithmetic).
 *
 *   • A cash forecast has no `actual` term at all. It counts only money that
 *     has yet to move, and a MaterialReceipt is a supplier INVOICE, not a
 *     payment — the type carries no paid flag (status is 'extracted' |
 *     'reviewed') and the doc on it says receipts are never posted into
 *     `paidToDate`. Subtracting them there removes real, unpaid, imminent cash
 *     from the runway with nothing putting it back, since generateForecast has
 *     no receipt term. That is the same optimism the committed-outflow work was
 *     written to remove, arriving through the dedupe.
 *
 *   • Receipts are also device-local (`mageid_material_receipts`, no sync), so
 *     netting them made the laptop and the phone answer "what do I owe on this
 *     PO" with different numbers — the exact defect the cash-flow sync closed.
 *
 * So the cash side is early with an outflow when the GC paid at the counter,
 * rather than late with one when the bill is still on his desk. On the screen
 * that answers "can I make payroll Friday" that is the cheap error, not the
 * expensive one.
 *
 * Floored at zero: an overpaid commitment is not negative future cash.
 */
export function commitmentUnpaid(c: Commitment): number {
  return Math.max(0, commitmentValue(c) - commitmentPaidToDate(c));
}

/**
 * Pick a phase bucket for a commitment. We prefer an explicit `phase`,
 * fall back to `csiDivision`, and last resort uncategorized.
 */
function commitmentPhase(c: Commitment): string {
  if (c.phase && c.phase.trim()) return c.phase.trim();
  if (c.csiDivision && c.csiDivision.trim()) return c.csiDivision.trim();
  return PHASE_UNCATEGORIZED;
}

/** Case- and space-folded name, for the vendor ↔ supplier compare. */
function foldName(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Cost basis of one estimate line — `unitPrice × quantity`, the same basis the
 *  phase budgets are seeded from. NEVER `lineTotal`, which is marked up. */
function itemCost(i: LinkedEstimateItem): number {
  return (i.unitPrice ?? 0) * (i.quantity ?? 0);
}

/**
 * The estimate items a commitment BOUGHT OUT, so its committed cost can net
 * against their budget instead of landing beside it (JOBCOST-PHASE-1).
 *
 * FOUR signals, strongest first. Each is a LINK between the two records, not a
 * guess from a string — the string compare is what failed.
 *
 *  1. `linkedEstimateItems`. The explicit link, and the same one the
 *     overcommitted check further down this file trusts. If the GC said which
 *     lines this subcontract covers, that is the answer and it is taken whole.
 *  2. `subcontractorId` → the sub's `companyName`, matched against the estimate
 *     line's `supplier`. It needs the roster, so it is live only where the
 *     caller passes `subcontractors` — see the note on that input. Until the
 *     close-out pass this was the ONLY signal that could fire on a subcontract
 *     a user actually created, because the commitment editor pointed at the
 *     sub and wrote no name; that is what the first cut of this fix shipped,
 *     and it is why the roster is load-bearing on /job-costing.
 *     app/job-costing.tsx now ALSO stamps the sub's `companyName` into
 *     `vendorName` when it saves, so signal 4 covers the same record with no
 *     roster at all — but only for a record saved or re-saved since. A
 *     subcontract written before that still needs this signal, so it stays.
 *  3. `csiDivision`. A classification both records carry, matched exactly
 *     after trimming. '26' is '26' whoever typed it.
 *  4. `vendorName` ↔ `LinkedEstimateItem.supplier`. The estimator named the
 *     vendor when he priced the line and the GC then signed that vendor — the
 *     same scope. Case- and space-insensitive, and DELIBERATELY exact after
 *     that: a substring match would let 'Alder' claim 'Alder Mechanical' and
 *     'Alder Electric' both. Live for purchase orders, and — since the
 *     close-out pass stamped the sub's company name at save time — for any
 *     subcontract saved by app/job-costing.tsx, WITHOUT a roster. That is what
 *     carries the row repair to the three callers that cannot pass one
 *     (utils/livingEstimate.ts, utils/marginRiskScore.ts,
 *     utils/portalSnapshot.ts); measured on the fixture in
 *     scripts/validate-money-definitions.ts, the roster-free result is
 *     byte-identical to the roster-passed one.
 *
 * Signals are NOT combined. The first one that returns anything wins, because
 * a weaker signal agreeing adds nothing and a weaker signal disagreeing would
 * quietly widen what a commitment is allowed to claim.
 *
 * AN INFERRED SIGNAL MAY NOT OVER-CLAIM (audit 2026-09-11, review round 2).
 * `csiDivision` and the two name compares are MANY-to-one: __tests__/fixtures/
 * world.ts alone carries two division-'12' lines, cabinets ($41,250) and
 * countertops ($8,064). A $19,900 cabinetry PO took BOTH budgets, and the
 * countertop subcontract signed later at exactly its estimate then read
 * "Unbudgeted — $8,064 over" on a job that was on budget: the fabricated
 * overrun this function exists to remove, moved one row down.
 *
 * So an inferred claim is capped by what the commitment is actually worth.
 * Candidates are considered LARGEST first; the first is always taken — buying
 * a $41,250 scope out for $19,900 is a good day, not an over-claim — and each
 * one after that only while the running total stays inside `commitmentValue`.
 * An EXPLICIT `linkedEstimateItems` is exempt: the GC named those lines.
 *
 * `claimed` carries ids already taken by an earlier commitment, so one
 * estimate line can only ever net against one commitment.
 */
function matchEstimateItems(
  c: Commitment,
  items: readonly LinkedEstimateItem[],
  claimed: ReadonlySet<string>,
  subsById: ReadonlyMap<string, string>,
): LinkedEstimateItem[] {
  const free = items.filter(i => !!i.materialId && !claimed.has(i.materialId));
  if (free.length === 0) return [];

  const linked = c.linkedEstimateItems ?? [];
  if (linked.length > 0) {
    const byLink = free.filter(i => linked.includes(i.materialId));
    // Explicit — no cap. The GC named these lines.
    if (byLink.length > 0) return byLink;
  }

  const inferred = (): LinkedEstimateItem[] => {
    const subName = c.subcontractorId ? subsById.get(c.subcontractorId) : undefined;
    if (subName) {
      const bySub = free.filter(i => foldName(i.supplier) === subName);
      if (bySub.length > 0) return bySub;
    }
    const csi = c.csiDivision?.trim();
    if (csi) {
      const byCsi = free.filter(i => (i.csiDivision ?? '').trim() === csi);
      if (byCsi.length > 0) return byCsi;
    }
    const vendor = foldName(c.vendorName);
    if (vendor) {
      const byVendor = free.filter(i => foldName(i.supplier) === vendor);
      if (byVendor.length > 0) return byVendor;
    }
    return [];
  };

  const candidates = inferred();
  if (candidates.length <= 1) return candidates;

  const budgetForClaim = Math.max(0, commitmentValue(c));
  const sorted = [...candidates].sort((a, b) => itemCost(b) - itemCost(a));
  const out: LinkedEstimateItem[] = [];
  let running = 0;
  for (const item of sorted) {
    const cost = Math.max(0, itemCost(item));
    if (out.length === 0) { out.push(item); running = cost; continue; }
    if (running + cost > budgetForClaim + 0.005) continue;
    out.push(item);
    running += cost;
  }
  return out;
}

/**
 * The job's own cost ratio, for converting a change order's PRICE into a cost
 * budget (JOBCOST-CO-COST-1). Deliberately the same convention — and the same
 * fallback — as `topUpForChangeOrders` in utils/wip.ts, so the two screens a
 * Business subscriber can open side by side cannot disagree about the same CO.
 *
 * A ChangeOrder carries no cost field (its lineItems hold unitPrice/total,
 * which are PRICED), so CO cost can only be estimated. Assuming a CO carries
 * the same margin as the base contract is the standard WIP convention.
 *
 * NO CONTRACT BASIS ⇒ 1.0, never 0: cost equals revenue, zero margin on the
 * CO. That UNDERSTATES profit, which is the correct direction to be wrong on a
 * number a surety or a lender may end up reading.
 *
 * THE RATIO IS NOT CAPPED AT 1, and it used to be (audit 2026-09-11, review
 * round 2). A cap looked prudent — "a cost budget above the contract means the
 * job is priced at a loss, don't gross the CO up by that loss" — but it is the
 * one thing this function must not do, because `topUpForChangeOrders` has no
 * cap and the whole reason this function exists is that the two must agree.
 * Measured on a job with a $120,000 cost basis sold at $100,000 and a $50,000
 * approved CO: capped, /job-costing entered the CO at $50,000 while
 * /wip-report entered it at $60,000 — two screens a Business subscriber can
 * open side by side, disagreeing about one change order, which is the defect
 * class this change was made to close. The uncapped answer is also the more
 * defensible one: the convention is that a CO carries the SAME margin as the
 * base contract, and if the base contract is underwater then so is the CO.
 */
function changeOrderCostRatio(project: Project, phases: ReadonlyMap<string, JobCostLine>): number {
  const contract = effectiveEstimateTotal(project);
  if (!Number.isFinite(contract) || contract <= 0) return 1;
  let costBudget = 0;
  for (const line of phases.values()) costBudget += line.budget;
  if (!Number.isFinite(costBudget) || costBudget <= 0) return 1;
  return costBudget / contract;
}

/**
 * Classify a phase by how its actual + projected stack up.
 * - over:       projectedFinal exceeds a real budget by more than 2%
 * - warning:    actual is 90% of budget but the phase isn't visibly done
 * - unbudgeted: money landed on a phase the estimate never priced
 * - on_track:   everything else
 */
function classify(line: Omit<JobCostLine, 'status'>): JobCostLine['status'] {
  if (line.budget > 0) {
    if (line.projectedFinal > line.budget * 1.02) return 'over';
    if (line.actual / line.budget > 0.9 && line.committed > line.actual * 1.05) return 'warning';
    return 'on_track';
  }
  // No budget line at all. `variance` for this phase is its ENTIRE projected
  // cost, so calling it "on track" is the same lie the KPI card used to tell:
  // in the Henderson case a whole $49K of untraceable payments sat in
  // '(Uncategorized)' behind a green "On track" chip. A 2% tolerance is
  // meaningless against a $0 budget — any dollar is infinitely over it.
  //
  // Deliberately NOT 'over': this money isn't necessarily an overrun, it's
  // money the estimate never accounted for, which is a different and often
  // fixable thing (a commitment tagged with a phase name the estimate
  // spells differently, a material receipt whose category the estimate never
  // used, self-perform labor that was never estimated as its own scope). Naming
  // that honestly beats both a false green and a false red.
  if (line.projectedFinal > 0) return 'unbudgeted';
  return 'on_track';
}

export interface JobCostInput {
  project: Project;
  commitments: Commitment[];
  /** ACCEPTED AND DELIBERATELY UNREAD. Client invoices are REVENUE — see the
   *  ACTUAL definition in the header. The engine summed `Invoice.amountPaid`
   *  into `actual` until MONEY-DEF-1 (audit 2026-09-07); the field stays on the
   *  input only so the existing call sites keep compiling, and passing it can
   *  never move a number. Do not reintroduce a reader — scripts/
   *  validate-money-definitions.ts fails the build if an invoice payment moves
   *  `summary.actual`. */
  invoices?: Invoice[];
  changeOrders: ChangeOrder[];
  /** Snapped supplier invoices. Their line totals count as ACTUAL material
   *  spend, attributed to the phase of their linked PO commitment (or, when
   *  unlinked, by each line's category). Additive — omit for the original
   *  commitments+invoices-only actuals. */
  receipts?: MaterialReceipt[];
  /** Crew time entries (self-perform labor, D6). Finished shifts × the GC's
   *  configured loaded rates (laborRates) count as ACTUAL labor spend in a
   *  dedicated "Self-perform labor" phase line. Entries whose trade has no
   *  configured rate contribute nothing — hours alone carry no dollars, and
   *  we never substitute market averages. Additive — omit both for the
   *  original behavior. */
  timeEntries?: TimeEntry[];
  laborRates?: LaborRateMap;
  /** MONEY-F19: the GC's overtime premium (hooks/useLaborRates.ts
   *  overtimeMultiplier). Overtime hours on a shift are priced at
   *  rate × multiplier; omit for the 1.5× default. */
  overtimeMultiplier?: number;
  /** MONEY-EQP-1: the GC's machines. Utilization entries logged against THIS
   *  project are charged at the machine's `dailyRate` into an "Equipment"
   *  phase line. A machine with no day rate contributes nothing — hours alone
   *  carry no dollars, and we never invent a rate (the same refusal
   *  components/AIEquipmentAdvice.tsx makes). Additive — omit for the
   *  no-equipment behavior. */
  equipment?: Equipment[];
  /** MONEY-PMT-1: permits on this project. `fee` is ACTUAL cost — the
   *  jurisdiction is paid at application — and lands in a "Permits" phase
   *  line. Additive — omit for the no-permits behavior. */
  permits?: Permit[];
  /**
   * The GC's subcontractor roster, used ONLY to turn a commitment's
   * `subcontractorId` into a company name for the buyout match in
   * `matchEstimateItems`.
   *
   * It is here because `subcontractorId` WAS the one structured link the
   * commitment editor wrote for a SUBCONTRACT — until the close-out pass
   * app/job-costing.tsx stamped `vendorName` on a purchase order only, and it
   * still writes neither `csiDivision` nor `linkedEstimateItems` at all — so
   * without the roster the buyout match could only fire on purchase orders and
   * on seeded data. That first clause is HISTORY, not current behaviour: the
   * editor now stamps a subcontract's `vendorName` too (see below), and any
   * comment still saying otherwise is stale. Additive and optional: omit the
   * roster and the other three signals behave exactly as before.
   *
   * IT IS NO LONGER THE ONLY LINK, and that is what closed this defect for the
   * callers that cannot pass a roster. The commitment editor now also stamps
   * the picked sub's `companyName` into `vendorName`, so signal 4 resolves the
   * same buyout with no roster: measured on the fixture below, a $40,000
   * electrical subcontract against a $26,200 bucket reports variance $13,800 /
   * EAC $71,000 either way. The roster still matters here for a subcontract
   * saved BEFORE that change and never re-saved, which is why /job-costing
   * keeps passing it and MONEY-PHASE-WIRED-1 keeps pinning that it does.
   *
   * WHO PASSES IT. app/job-costing.tsx — the screen this whole fix is about —
   * passes the roster off `useProjects()`; MONEY-PHASE-WIRED-1 in
   * scripts/validate-money-definitions.ts fails the build if it stops. It is
   * also part of `JobCostActualSources`, so any caller that threads a
   * `costSources` bundle carries it for free once that bundle includes it.
   *
   * AND WHO DOES NOT NEED IT — measured, because the obvious next wiring job is
   * a no-op and someone will otherwise spend a wave on it. utils/financialReports
   * .ts reads exactly ONE field off this engine, `job.actual` (its cost-at-
   * completion came off `deriveEstimatedCostWithSource` in the 2026-09-10 parity
   * pass). `actual` is Σ commitment paidToDate + receipts + priced hours +
   * equipment + permits — the roster moves which BUCKET a commitment lands in
   * and never the total — so adding `subcontractors` to /reports' costSources
   * bundle changes no number on either tab: measured identical costToDate
   * 12,000 / estimatedFinalCost 57,200 / projectedProfit 0 with and without it.
   * MONEY-PHASE-WIRED-1 pins both halves: that the roster cannot move `actual`,
   * and that financialReports reads no roster-sensitive field. If that second
   * assertion ever fires, wire the bundle.
   *
   * STILL UNWIRED, and these three DO read a roster-sensitive field: utils/
   * livingEstimate.ts and utils/marginRiskScore.ts read `projectedFinal`,
   * utils/portalSnapshot.ts reads `projectedFinal` AND `byPhase`. None of the
   * three even accepts a roster on its own input type, and none receives one
   * from its own callers (THIRTEEN call sites across eight files — measured,
   * `grep -n 'computeLivingEstimate(\|computeMarginRisk('`), so wiring them is
   * a signature change in three public interfaces, not a property.
   *
   * THEY WERE WIRED THE OTHER WAY INSTEAD, at the writer (close-out pass).
   * What those three actually needed was not the roster; it was for the
   * commitment to KNOW who it is with. Every production writer of a subcontract
   * commitment now records that:
   *   • contexts/ProjectContext.tsx's buyout award already wrote `vendorName`
   *     off the winning bid — that is SIGNAL 4, and it is what exempts it. It
   *     also writes `linkedEstimateItems`, but that is NOT the reason: the
   *     value is `pkg.linkedEstimateItemIds`, which app/takeoff.tsx:572 creates
   *     as `[]`, and `matchEstimateItems` falls through an empty array
   *     (`if (linked.length > 0)`), so signal 1 is not guaranteed on that path;
   *   • the dev seeders already wrote `vendorName`;
   *   • app/job-costing.tsx's commitment editor — the only writer that did not
   *     — now stamps the picked sub's `companyName` into `vendorName`, so
   *     signal 4 resolves the buyout with no roster at all.
   * Measured on the fixture below, a $40,000 electrical subcontract against a
   * $26,200 electrical bucket: without the stamp and without a roster the
   * engine reported variance $0 / EAC $57,200 and split the trade into an
   * untouched "subcontractor $22,600" row beside an "electrical $3,600 budget /
   * $40,000 committed" row; with the stamp and still no roster it reports
   * variance $13,800 / EAC $71,000 on ONE electrical row at $26,200 / $40,000 —
   * byte-identical to the roster-passed result.
   *
   * WHAT THAT WAS COSTING, MEASURED THROUGH THE SHIPPED FUNCTION rather than
   * argued: the same job through `computeLivingEstimate` reported margin
   * $22,800 and health 'healthy' on the unresolved EAC, and $9,000 /
   * 'critical' on the resolved one. A losing job read healthy, and
   * utils/marginAlerts.ts is built on that same output — so the push alert that
   * exists to warn about margin fade was silent on exactly the job it was
   * written for. It is not silent now, and no signature moved.
   *
   * The stamp CANNOT over-claim relative to the roster, which is why it is a
   * safe substitute rather than a wider net: signals 2 and 4 compare against
   * the same field on the same records — the estimate line's `supplier` — so a
   * job whose estimate names no supplier resolves under neither, exactly as
   * before. Signal 2 still runs first, so where a roster IS passed the current
   * company name wins over a stored one that has since been renamed.
   *
   * WHAT IS LEFT, stated rather than glossed: a subcontract SAVED BEFORE the
   * stamp and never re-saved still carries only a `subcontractorId`, and those
   * three callers still absorb its overrun. Re-saving the commitment backfills
   * it; there is no migration, because a client-only wave cannot ship one. That
   * residue is the reason the roster is not dead code and why /job-costing must
   * keep passing it.
   *
   * THAT FIGURE IS MEASURED AND WAS WRONG HERE UNTIL THE CLOSE-OUT PASS. It
   * published the subcontract less that one line, which forgets that the buyout
   * moves the line onto the ELECTRICAL bucket, where $3,600 of recessed cans
   * already sit. The bucket budget is $26,200, so the overrun is $13,800.
   * MONEY-PHASE-WIRED-1 in scripts/validate-money-definitions.ts now asserts
   * both numbers against this exact fixture, so the prose cannot drift from the
   * arithmetic again. Understating an overrun is the conservative direction for
   * a margin ALERT and the wrong one for a bank document — see
   * docs/audits/2026-09-11-handoff-money-to-wip.md.
   */
  subcontractors?: { id: string; companyName?: string }[];
}

/**
 * The cost-side inputs a caller must FORWARD for `actual` to be the whole cost
 * picture rather than subs-and-POs only. Reports that omit them (utils/
 * financialReports did, on both the bank-facing WIP tab and the Profit report)
 * report a cost-to-date missing every dollar of materials and self-perform
 * labor, which reads as a fatter margin than the job has (MONEY-DEF-1).
 *
 * `equipment` and `permits` joined this list with MONEY-EQP-1 / MONEY-PMT-1.
 * They are optional like the rest, so a caller that has not been widened still
 * compiles — and still under-reports by exactly the machine time and permit
 * spend it does not pass. utils/financialReports.ts and its two screen callers
 * are the known holdouts (they thread a `costSources` object straight through
 * to `computeJobCost`, so widening them is a matter of adding the two fields
 * at the call sites that build it).
 */
export type JobCostActualSources =
  Pick<JobCostInput,
    'receipts' | 'timeEntries' | 'laborRates' | 'overtimeMultiplier' | 'equipment' | 'permits'
    | 'subcontractors'>;

/**
 * Run the cost-to-complete engine on one project's numbers.
 *
 * Pure function — all data is passed in, no storage side effects. Callers
 * wire it up from ProjectContext and re-run on every mutation. Results are
 * cheap to recompute because the input arrays are already in memory.
 */
export function computeJobCost({
  project, commitments, changeOrders, receipts = [], timeEntries = [], laborRates = {},
  overtimeMultiplier = DEFAULT_OVERTIME_MULTIPLIER, equipment = [], permits = [],
  subcontractors = [],
}: JobCostInput): JobCostSummary {
  const projectCommitments = commitments.filter(c => c.projectId === project.id && c.status !== 'draft');
  const projectCOs = changeOrders.filter(co => co.projectId === project.id && co.status === 'approved');
  const projectReceipts = receipts.filter(r => r.projectId === project.id);

  const estimate = project.linkedEstimate ?? null;

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE BUCKETS ARE KEYED CASE-INSENSITIVELY (JOBCOST-PHASE-1, audit
  // 2026-09-11).
  //
  // Both sides of the join used to `.trim()` and neither lowercased, and the
  // two sides are written by different hands:
  //   • estimate items carry `category` — title-case for materials
  //     ('Electrical', constants/materials.ts) and LOWERCASE for assemblies
  //     ('electrical', constants/assemblies.ts), so ONE estimate can contain
  //     both spellings of one trade;
  //   • `Commitment.phase` is free text the GC types, with the placeholder
  //     'Electrical' (app/job-costing.tsx).
  // A case difference split one trade into two rows: a budget with nothing
  // committed beside an "Unbudgeted" commitment with no budget — and the
  // project EAC summed both, reporting an overrun exactly the size of the
  // scope the GC had bought out.
  //
  // The map is keyed by the folded key; the LINE keeps the first display label
  // it was seen under, so the drill-down still reads the way the GC wrote it.
  // ───────────────────────────────────────────────────────────────────────────
  const phaseKey = (label: string): string => label.trim().toLowerCase();
  const phases = new Map<string, JobCostLine>();
  /** The bucket for `label`, created on first sight. Returns the STORED line —
   *  callers mutate it in place, so no `.set` is needed afterwards. */
  const bucket = (label: string): JobCostLine => {
    const key = phaseKey(label);
    const existing = phases.get(key);
    if (existing) return existing;
    const made = emptyLine(label.trim() || PHASE_UNCATEGORIZED);
    phases.set(key, made);
    return made;
  };
  const hasPhase = (label: string): boolean => phases.has(phaseKey(label));
  /**
   * Actual cost on a phase that is NOT a payment against a commitment —
   * UNLINKED material receipts, priced crew hours, equipment days, permit
   * fees. A receipt snapped to a commitment is excluded on purpose: it is
   * delivery against that PO, so it belongs to the commitment balance (see
   * the receipts loop).
   *
   * EAC-DIRECT-1 (audit 2026-09-07, found while wiring MONEY-EQP-1/PMT-1). The
   * EAC's uncommitted-remainder term is `budget - committed`, and direct cost
   * reduces neither side of that, so it was added ON TOP of the whole budget:
   * a job with $3,000 budgeted for permits and $3,015 actually paid projected
   * $6,015 and reported "Over by $3,015" — money counted twice. Same for every
   * dollar of materials and self-perform labor MONEY-DEF-1 had just started
   * counting. A commitment payment never had the bug (it is covered by
   * `committed`), which is why it survived the original engine unnoticed.
   *
   * Tracked per phase, outside JobCostLine — it is an intermediate, not a
   * number any screen should render.
   */
  const directActual = new Map<string, number>();
  const addDirect = (phase: string, amount: number) => {
    // Folded key — the same key `phases` uses. Keyed by raw label, 'Electrical'
    // and 'electrical' kept separate direct-cost tallies while sharing one
    // budget line, so the finalize pass below read only one of them and the
    // other dollar was charged against the commitment balance instead.
    const key = phaseKey(phase);
    directActual.set(key, (directActual.get(key) ?? 0) + amount);
  };

  // Seed from estimate items — every category that exists in the budget
  // gets a line, even if no commitments / invoices landed on it yet. This
  // keeps the "$0 committed against $50K budget" visible early.
  if (estimate) {
    for (const item of estimate.items) {
      const phase = item.category?.trim() || PHASE_UNCATEGORIZED;
      const existing = bucket(phase);
      // COST, not sell. `lineTotal` is the MARKED-UP figure —
      // app/(tabs)/estimate/full.tsx:933 computes it as
      //     base * (1 + markup / 100) * quantity
      // and grandTotal is the sum of those. Seeding a job-COST budget with it
      // made budget === revenue, so projectedFinal === projectedRevenue and
      // every job reported $0 projected profit before any work happened. Real
      // cost erosion then looked identical to that baseline noise, and the
      // same inflated EAC flowed into the profit report and the bank-facing
      // WIP row.
      //
      // `unitPrice` is the cost basis and is already bulk-aware (full.tsx:932
      // assigns `usesBulk ? baseBulkPrice : baseRetailPrice`). Labor and
      // assemblies carry markup: 0 with unitPrice × quantity equal to their
      // all-in cost, so this sum reproduces the estimate's own baseTotal
      // exactly — which is the same cost basis utils/wip.deriveEstimatedCost
      // uses. One definition of cost across the app.
      existing.budget += (item.unitPrice ?? 0) * (item.quantity ?? 0);
    }
  } else if (project.estimate) {
    // Legacy estimate — one catch-all bucket.
    //
    // grandTotal stays here deliberately. EstimateBreakdown (types/index.ts:66)
    // has no markup or profit line at all — materials, labor, permits,
    // overhead, contingency, tax — so its grandTotal is cost + tax, not
    // cost + margin. There is no markup to strip, and it is the same call
    // utils/wip.deriveEstimatedCost makes for the legacy shape.
    bucket('Budget').budget += project.estimate.grandTotal;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // BUYOUT MOVES THE BUDGET (JOBCOST-PHASE-1, audit 2026-09-11).
  //
  // Awarding a subcontract at the estimated price is a NEUTRAL event: committed
  // cost REPLACES estimated cost. It does not add to it. That is the first
  // thing any PM checks after buyout, and /job-costing failed it.
  //
  // The reason is that the two sides are bucketed by different vocabularies.
  // An estimate line for a sub is categorised by the estimator — the shipped
  // material catalogue writes 'subcontractor' for exactly these lines
  // (__tests__/fixtures/world.ts mirrors the real shape) — while the signed
  // subcontract is tagged with the TRADE, because the field on the commitment
  // form is labelled Phase and its placeholder is 'Electrical'. Case folding
  // (above) cannot reconcile 'subcontractor' with 'Electrical'; nothing can,
  // from the strings alone.
  //
  // What CAN reconcile them is the link between the two records, and three of
  // those already exist on the data:
  //   1. `Commitment.linkedEstimateItems` — the explicit link the commitment
  //      form writes, and the same one the overcommitted check below trusts.
  //   2. `csiDivision` on both sides — a real classification, not free text.
  //   3. the commitment's `vendorName` against the estimate line's `supplier`
  //      — the estimate literally names the sub who went on to sign.
  // Each item may be claimed ONCE (first claimant in commitment order wins),
  // so two subs cannot both net against the same budget line.
  //
  // The budget MOVES to the commitment's own phase rather than the commitment
  // moving to the estimate's: 'Electrical — budget 22,600, committed 22,600,
  // on track' is the row a GC can act on, where 'subcontractor — 41,000' is
  // not. Project totals are unaffected by which side moves; the double count
  // is what is removed.
  //
  // A commitment that matches nothing still behaves exactly as before — its
  // phase reads Unbudgeted, which is the honest answer for scope the estimate
  // never priced.
  // ───────────────────────────────────────────────────────────────────────────
  /** Folded phase key → how many commitments landed in it, and how many of
   *  those the engine could RESOLVE to the estimate lines they bought out.
   *  Read by the project total at the bottom: an overrun on a phase whose
   *  commitments were all resolved is a real overrun on identified scope; on a
   *  phase where the join failed, the phase's budget and its commitment are
   *  simply two records that happen to share a name. */
  const phaseCommitmentCount = new Map<string, number>();
  const phaseResolvedCount = new Map<string, number>();
  for (const c of projectCommitments) {
    const k = phaseKey(commitmentPhase(c));
    phaseCommitmentCount.set(k, (phaseCommitmentCount.get(k) ?? 0) + 1);
  }
  if (estimate) {
    const claimed = new Set<string>();
    // id → folded company name, for the `subcontractorId` signal.
    const subsById = new Map<string, string>();
    for (const sub of subcontractors) {
      const name = foldName(sub.companyName);
      if (sub.id && name) subsById.set(sub.id, name);
    }
    // Deterministic order so the same world always produces the same buckets.
    const ordered = [...projectCommitments].sort((a, b) =>
      (a.signedDate || '').localeCompare(b.signedDate || '') || a.id.localeCompare(b.id));
    for (const c of ordered) {
      const target = commitmentPhase(c);
      const matches = matchEstimateItems(c, estimate.items, claimed, subsById);
      if (matches.length === 0) continue;
      const tk = phaseKey(target);
      phaseResolvedCount.set(tk, (phaseResolvedCount.get(tk) ?? 0) + 1);
      for (const item of matches) {
        const from = bucket(item.category?.trim() || PHASE_UNCATEGORIZED);
        const cost = (item.unitPrice ?? 0) * (item.quantity ?? 0);
        if (cost <= 0) { claimed.add(item.materialId); continue; }
        if (phaseKey(from.phase) === phaseKey(target)) { claimed.add(item.materialId); continue; }
        from.budget -= cost;
        bucket(target).budget += cost;
        claimed.add(item.materialId);
      }
    }
    // A bucket the buyout emptied of budget, commitments and actuals is noise
    // on the sheet — it existed only to hold the estimate line that has now
    // moved. Drop it rather than print 'subcontractor — $0 everything'.
    for (const [key, line] of [...phases.entries()]) {
      if (Math.abs(line.budget) < 0.005 && line.committed === 0 && line.actual === 0
        && line.sources.commitments.length === 0 && line.sources.changeOrders.length === 0
        && line.sources.receipts.length === 0) {
        phases.delete(key);
      }
    }
  }

  // Change orders bump budget at the phase level. COs don't carry phase
  // data directly either — we use the CO description as a best-effort tag
  // and, if it doesn't map to an existing phase, we drop it into a
  // 'Change Orders' bucket so PMs can see the new work.
  //
  // THE CO GOES IN AT COST, NOT AT PRICE (JOBCOST-CO-COST-1, audit
  // 2026-09-11). `co.changeAmount` is what the OWNER is charged; this is a
  // cost budget, seeded above from `unitPrice × quantity` for exactly that
  // reason. Adding the priced figure mixed the two bases in one number and put
  // /job-costing's cost-at-completion a full CO margin above the one
  // /wip-report and /reports compute (utils/wip.topUpForChangeOrders).
  //
  // It never moved the headline variance — `uncommittedRemainder` rises by the
  // identical dollar, so `variance = projectedFinal − budget` is unchanged, and
  // a CO whose description is not verbatim a phase name lands in its own
  // 'Change Orders' bucket whose variance is exactly $0. What it did was
  // inflate cost-EAC by the CO's margin, i.e. UNDERSTATE projected profit. That
  // is the conservative direction, which is why this is a parity fix and not an
  // over-budget-job-looks-healthy fix — do not describe it as one.
  const coCostRatio = changeOrderCostRatio(project, phases);
  for (const co of projectCOs) {
    const coPhaseLabel = co.description?.trim() || 'Change Orders';
    const match = hasPhase(coPhaseLabel) ? coPhaseLabel : 'Change Orders';
    const existing = bucket(match);
    existing.budget += co.changeAmount * coCostRatio;
    existing.sources.changeOrders.push(co.id);
  }

  // Commitments — signed subs/POs push into their phase, and what has been
  // PAID against them is the primary actual-cost signal.
  //
  // MONEY-DEF-1 (audit 2026-09-07): `paidToDate` is the server rollup of sub
  // and PO payments, hydrated at contexts/ProjectContext.tsx:918 and already
  // the cost basis utils/wip.suggestCostToDate and utils/estimateActuals use.
  // This engine never read it — its only actual-cost signal was the CLIENT's
  // invoice payments, i.e. revenue — so a homeowner's deposit read as budget
  // burn and a GC who had performed $300K and billed nothing showed Actual $0
  // and "on track to finish under budget". Two screens in one app answered
  // "what has this job cost me" with incompatible arithmetic.
  for (const c of projectCommitments) {
    const existing = bucket(commitmentPhase(c));
    existing.committed += commitmentValue(c);
    existing.actual += commitmentPaidToDate(c);
    existing.sources.commitments.push(c.id);
  }

  // Material receipts — snapped supplier invoices count as ACTUAL material
  // spend. A receipt linked to a PO commitment lands in that commitment's
  // phase (the whole receipt); an unlinked receipt is split per line by the
  // line's category → phase, so material cost shows up against the right scope.
  for (const r of projectReceipts) {
    const linked = r.commitmentId ? projectCommitments.find(c => c.id === r.commitmentId) : undefined;
    if (linked) {
      const existing = bucket(commitmentPhase(linked));
      const receiptTotal = r.lines.reduce((s, l) => s + (l.lineTotal || 0), 0);
      existing.actual += receiptTotal;
      // NOT direct. A receipt SNAPPED to a commitment is material delivered
      // against that PO, so it buys down the PO's remaining balance exactly
      // the way a payment does. Calling it direct (the first cut of
      // EAC-DIRECT-1) left the whole PO standing as remaining exposure AND
      // subtracted the receipt from the uncommitted budget, which projected a
      // $10,000 PO with $6,000 of snapped receipts at $16,000 and reported
      // "over by $6,000" on a job that is exactly on budget — the same
      // double-count the split was written to remove, pointed the other way.
      // Only the UNLINKED branch below is direct.
      existing.sources.receipts.push(r.id);
    } else {
      for (const line of r.lines) {
        const cat = (line.category || '').trim();
        const phase = cat || PHASE_UNCATEGORIZED;
        const existing = bucket(phase);
        existing.actual += line.lineTotal || 0;
        addDirect(phase, line.lineTotal || 0);
        // One receipt splitting across three categories names itself on all
        // three phase lines — the drill-down has to be able to open it from any
        // of them. Within ONE line the same id can land twice (two lumber lines
        // in the same category); the finalize pass below dedupes, so the count
        // the sheet shows is receipts, not receipt-lines.
        existing.sources.receipts.push(r.id);
      }
    }
  }

  // Self-perform labor — finished shifts × the GC's configured loaded rates
  // count as ACTUAL labor spend, in a dedicated phase line. Estimates rarely
  // carry a matching phase, so it reads as unbudgeted actuals — the honest
  // story until self-perform labor is estimated as its own scope. Same
  // no-budget behavior as an unbudgeted commitment phase.
  {
    let laborActual = 0;
    const countedIds: string[] = [];
    for (const e of timeEntries) {
      if (e.projectId !== project.id || !isEligibleLaborEntry(e)) continue;
      const rate = laborRates[normalizeTradeKey(e.trade)];
      if (!Number.isFinite(rate) || rate <= 0) continue;
      // MONEY-F19: overtime is PRICED, not just counted. totalHours × rate
      // booked a 10-hour day at $500 when the crew cost $550.
      laborActual += priceLaborEntry(e, rate, overtimeMultiplier);
      countedIds.push(e.id);
    }
    if (laborActual > 0) {
      const phase = 'Self-perform labor';
      const existing = bucket(phase);
      existing.actual += laborActual;
      addDirect(phase, laborActual);
      existing.sources.timeEntries.push(...countedIds);
    }
  }

  // Equipment — logged hours on THIS project × the machine's day rate
  // (MONEY-EQP-1). Charged whether the machine is owned or rented: a rental is
  // literal cash out, and an owned machine's day rate is the GC's own recovery
  // figure for fuel, wear and the note. Both are real cost to the job, and
  // leaving owned machines out is what made a self-perform excavation look
  // free.
  //
  // Refuses the same way components/AIEquipmentAdvice.tsx refuses: a machine
  // with no day rate contributes ZERO, not a guessed rate. The add form allows
  // `parseFloat(newDailyRate) || 0` (app/(tabs)/equipment/index.tsx:101), so a
  // $0 rate is a real state that must produce no dollars rather than silently
  // price six days at nothing and call it measured.
  for (const eq of equipment) {
    const rows = (eq.utilizationLog ?? []).filter(u => u.projectId === project.id);
    if (rows.length === 0) continue;
    const rate = Number.isFinite(eq.dailyRate) ? eq.dailyRate : 0;
    if (rate <= 0) continue;
    const hours = rows.reduce(
      (s, u) => s + (Number.isFinite(u.hoursUsed) ? Math.max(0, u.hoursUsed) : 0),
      0,
    );
    const cost = (hours / EQUIPMENT_HOURS_PER_DAY) * rate;
    if (cost <= 0) continue;
    const existing = bucket(PHASE_EQUIPMENT);
    existing.actual += cost;
    addDirect(PHASE_EQUIPMENT, cost);
    existing.sources.equipment.push(...rows.map(u => u.id));
  }

  // Permit fees — ACTUAL cost the day the application goes in (MONEY-PMT-1).
  //
  // Every status counts, denied and expired included: the jurisdiction does not
  // refund a plan-check fee because it turned the plan down, and a permit that
  // lapsed was still paid for. Filtering by status would quietly delete money
  // that already left the account, which is the same class of error as the
  // omission this fix closes.
  for (const p of permits) {
    if (p.projectId !== project.id) continue;
    const fee = Number.isFinite(p.fee) ? Math.max(0, p.fee) : 0;
    if (fee <= 0) continue;
    const existing = bucket(PHASE_PERMITS);
    existing.actual += fee;
    addDirect(PHASE_PERMITS, fee);
    existing.sources.permits.push(p.id);
  }

  // Overcommitted detection — any commitment whose sum exceeds the sum
  // of its linked estimate items. Useful for the dashboard call-out.
  const overcommitted: Commitment[] = [];
  if (estimate) {
    for (const c of projectCommitments) {
      if (!c.linkedEstimateItems || c.linkedEstimateItems.length === 0) continue;
      // MONEY-F11: COST basis (unitPrice × quantity), not the marked-up
      // lineTotal — a commitment is at cost, and measuring it against sell
      // hid a sub signed 17% over the estimate behind the 15% markup.
      const linkedTotal = c.linkedEstimateItems.reduce((s, id) => {
        const item = estimate.items.find(it => it.materialId === id);
        return s + (item ? (item.unitPrice ?? 0) * (item.quantity ?? 0) : 0);
      }, 0);
      if (linkedTotal > 0 && commitmentValue(c) > linkedTotal * 1.02) {
        overcommitted.push(c);
      }
    }
  }

  // Finalize each phase — compute projectedFinal + variance + status.
  const byPhase: JobCostLine[] = [];
  /** Σ per-phase direct cost, after the per-phase clamp. Feeds the PROJECT
   *  uncommitted term below — see the block above the totals. */
  let sumDirect = 0;
  /** Σ per-phase remaining commitment balance. Same. */
  let sumRemainingCommitted = 0;
  /** Σ of the spend that exceeded a budget the engine can vouch for. See the
   *  project-total block for why this is not simply "every phase with a
   *  budget": a $3,600 lighting line and a $22,600 electrical subcontract can
   *  share a bucket by coincidence, and calling the difference an overrun is
   *  the fabricated-overrun bug in miniature. */
  let sumIdentifiedOverrun = 0;
  for (const line of phases.values()) {
    const actual = Math.max(0, line.actual);
    const committed = Math.max(0, line.committed);
    const budget = Math.max(0, line.budget);

    // MAGE EAC, split by WHAT the actual paid for (EAC-DIRECT-1):
    //
    //   direct    — receipts, crew hours, equipment, permits. Buys down the
    //               UNCOMMITTED budget, because that work is now done and paid.
    //   committed — payments against a signed sub/PO. Buys down the remaining
    //               COMMITMENT balance, which is where it always belonged.
    //
    // Charging the whole actual against the commitment balance (the old
    // `committed - actual`) let a lumber receipt shrink a sub's remaining
    // contract, and leaving direct cost out of the uncommitted term added it on
    // top of the full budget. Both terms were wrong in the same direction for
    // the same reason. On a phase whose only actual is commitment payments —
    // every phase the original engine had — this is arithmetically identical to
    // the old formula.
    const direct = Math.min(actual, Math.max(0, directActual.get(phaseKey(line.phase)) ?? 0));
    const againstCommitment = actual - direct;
    const remainingCommitted = Math.max(0, committed - againstCommitment);
    const uncommittedRemainder = Math.max(0, budget - committed - direct);
    sumDirect += direct;
    sumRemainingCommitted += remainingCommitted;
    // A phase's overrun counts at project level only when the engine can vouch
    // for the pairing: the phase has a real budget, and EVERY commitment in it
    // was resolved to the estimate lines it bought out (a phase with no
    // commitments at all — pure receipts, crew hours — qualifies on its
    // category alone). Where the join failed, the budget beside the commitment
    // is not that commitment's budget and the difference is not an overrun.
    const pk = phaseKey(line.phase);
    const inPhase = phaseCommitmentCount.get(pk) ?? 0;
    const resolvedHere = phaseResolvedCount.get(pk) ?? 0;
    if (budget > 0 && resolvedHere === inPhase) {
      sumIdentifiedOverrun += Math.max(0, committed + direct - budget);
    }
    const projectedFinal = actual + remainingCommitted + uncommittedRemainder;
    const variance = projectedFinal - budget;
    const burnRatio = budget > 0 ? Math.min(2, actual / budget) : (committed > 0 ? Math.min(2, actual / committed) : 0);

    const enriched: Omit<JobCostLine, 'status'> = {
      ...line,
      actual,
      committed,
      budget,
      projectedFinal,
      variance,
      burnRatio,
      // Dedupe once, here, so a caller can read `.length` as a record count and
      // render the list without a Set of its own. A multi-line receipt pushes
      // its id per line; nothing else can currently repeat, but the pass costs
      // nothing and makes ".length is a count of records" a property of the
      // engine rather than a fact each screen has to re-establish.
      sources: {
        commitments: dedupe(line.sources.commitments),
        changeOrders: dedupe(line.sources.changeOrders),
        receipts: dedupe(line.sources.receipts),
        timeEntries: dedupe(line.sources.timeEntries),
        equipment: dedupe(line.sources.equipment),
        permits: dedupe(line.sources.permits),
      },
    };
    byPhase.push({ ...enriched, status: classify(enriched) });
  }

  byPhase.sort((a, b) => b.budget - a.budget);

  // ───────────────────────────────────────────────────────────────────────────
  // THE UNCOMMITTED FLOOR IS A PROJECT TERM, NOT A SUM OF PHASE TERMS
  // (JOBCOST-PHASE-1, audit 2026-09-11, review round 2).
  //
  // `totalProjected` used to be `Σ byPhase.projectedFinal`, and that sum is
  // where /job-costing's fabricated overrun actually came from. Each phase
  // carries `max(0, budget − committed − direct)` as its own floor, so a
  // commitment sitting in a DIFFERENT bucket from the budget it bought out
  // adds its whole value on top of a budget that was never reduced: the
  // estimate's "subcontractor $41,000, committed $0" row kept its full floor
  // while "Electrical — Unbudgeted, committed $22,600" added $22,600 beside
  // it. Budget $131,502 + a $22,600 buyout printed "Projected $154,102 —
  // $22,600 OVER" on a job that was exactly on budget.
  //
  // `matchEstimateItems` above repairs the ROWS when it can find a link. It
  // cannot always, and the reason is structural: app/job-costing.tsx's
  // commitment editor gives a subcontract a `subcontractorId` and a phase name
  // the GC types, and writes neither `csiDivision` nor `linkedEstimateItems`.
  // On a project with no subcontractor roster, or a sub the estimate never
  // named, there is no link to find. The ROWS stay honest then ("this trade
  // has commitments the estimate never priced" is a true statement) — but the
  // HEADLINE must not double count, because whether two records could be
  // JOINED is a fact about the app, not about the job.
  //
  // So the headline is the SMALLER of two readings, and it can therefore only
  // ever shrink a fabricated overrun, never invent one:
  //
  //   perPhase      = Σ byPhase.projectedFinal              (the old answer)
  //   projectLevel  = actual
  //                 + Σ remaining commitment balances
  //                 + max(0, totalBudget − totalCommitted − totalDirect)
  //                 + Σ overrun on phases that HAVE a budget
  //
  // projectLevel takes the uncommitted floor ONCE over the whole job, so a
  // neutral buyout is neutral wherever it is bucketed. The last term is what
  // keeps it from being a blunt instrument: a phase whose budget the engine can
  // VOUCH FOR, committed past that budget, is a real overrun on identified
  // scope and it survives — /job-costing still reports the $1,200 sub change
  // order on a plumbing subcontract signed above its estimate.
  //
  // "Vouch for" is narrower than "has a budget", and the difference matters. A
  // trade bucket can hold a $3,600 lighting line while the $22,600 electrical
  // SUBCONTRACT's budget sits under the estimator's 'subcontractor' category:
  // budget is non-zero, committed is 6× it, and none of that gap is an
  // overrun. So the term counts a phase only when every commitment in it was
  // resolved to the estimate lines it bought out (or when it holds no
  // commitments at all, and its budget is being measured against receipts and
  // crew hours filed under the same category). Everything else is named in the
  // drill-down and left out of the headline.
  //
  // WHAT THIS TRADES AWAY, stated plainly: genuinely unbudgeted spend — a
  // permit fee on an estimate with no permits line — is now absorbed by the
  // job's remaining uncommitted budget instead of adding to the projected
  // final, until the job runs out of that budget. That is the same absorption
  // any PM does mentally with contingency, it is bounded (once
  // totalCommitted + direct reaches totalBudget the third term is zero and
  // every further dollar lands on the headline), and it is the price of not
  // fabricating an overrun on every commitment whose phase string the GC typed
  // differently from his estimator.
  //
  // CONSEQUENCE TO KNOW: `summary.projectedFinal` is no longer Σ
  // `byPhase.projectedFinal`. Do not re-derive the headline by summing the
  // rows — that re-derivation is the bug.
  // ───────────────────────────────────────────────────────────────────────────
  const totalBudget = byPhase.reduce((s, p) => s + p.budget, 0);
  const totalCommitted = byPhase.reduce((s, p) => s + p.committed, 0);
  const totalActual = byPhase.reduce((s, p) => s + p.actual, 0);
  const perPhaseProjected = byPhase.reduce((s, p) => s + p.projectedFinal, 0);
  const projectLevelProjected = totalActual + sumRemainingCommitted
    + Math.max(0, totalBudget - totalCommitted - sumDirect)
    + sumIdentifiedOverrun;
  const totalProjected = Math.min(perPhaseProjected, projectLevelProjected);

  const biggestVariances = [...byPhase]
    .filter(p => Math.abs(p.variance) > 1)
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
    .slice(0, 3);

  return {
    asOf: new Date().toISOString(),
    budget: totalBudget,
    committed: totalCommitted,
    actual: totalActual,
    projectedFinal: totalProjected,
    variance: totalProjected - totalBudget,
    // NOT clamped to 100. These are reported numbers, not bar widths: a
    // Math.min(100, …) here made $49K spent against a $48K budget read
    // "100% of budget", so an over-budget job could never look over-budget
    // (docs/audits/2026-08-17-web-audit.md). Anything drawing a progress bar
    // from these must clamp the WIDTH at the call site, never the value.
    commitmentCoverage: totalBudget > 0 ? (totalCommitted / totalBudget) * 100 : 0,
    spendPercent: totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0,
    byPhase,
    biggestVariances,
    // What the rows show and the headline does not — see the field doc. The
    // screen owes the reader a sentence when this is non-zero; leaving it
    // implicit is the "two answers in one render" defect.
    absorbedVariance: Math.max(0, Math.round((perPhaseProjected - totalProjected) * 100) / 100),
    overcommittedCommitments: overcommitted,
    method: 'mage_committed_plus_uncommitted',
  };
}

/** Order-preserving unique — the drill-down list reads in contribution order. */
function dedupe(ids: string[]): string[] {
  return ids.length < 2 ? ids : [...new Set(ids)];
}

function emptyLine(phase: string): JobCostLine {
  return {
    phase,
    budget: 0,
    committed: 0,
    actual: 0,
    projectedFinal: 0,
    variance: 0,
    burnRatio: 0,
    status: 'on_track',
    sources: { commitments: [], changeOrders: [], receipts: [], timeEntries: [], equipment: [], permits: [] },
  };
}

/**
 * Format helper so screens don't reinvent currency formatting. We use
 * `Intl.NumberFormat` because `toLocaleString` varies by platform.
 */
export function formatMoney(n: number, opts?: { sign?: boolean }): string {
  const abs = Math.abs(n);
  const sign = opts?.sign && n >= 0 ? '+' : n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}K`;
  if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}

export function formatMoneyFull(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// ─────────────────────────────────────────────────────────────
// Variance presentation
// ─────────────────────────────────────────────────────────────

/**
 * Below this many dollars a variance displays as `$0`, so it must not read
 * as a direction — otherwise float noise paints the card red or green.
 */
export const VARIANCE_EPSILON = 0.5;

export type VarianceTone = 'over' | 'under' | 'on_budget';

export interface VarianceDisplay {
  /** Which side of budget this lands on. */
  tone: VarianceTone;
  /** KPI card label — pair with `amount`, e.g. "Over by" + "$49K". */
  label: string;
  /** One-sentence projection banner. */
  banner: string;
  /** Magnitude in dollars, always >= 0. */
  amount: number;
  /** Theme colour family. Map to `colors.danger` / `.success` at the call site. */
  colorKey: 'danger' | 'success' | 'neutral';
  /** Trend arrow direction. */
  trend: 'up' | 'down' | 'flat';
}

/**
 * Turn a signed variance into the words and colour that go on screen.
 *
 * Pure and exported so it can be tested without rendering a screen —
 * see scripts/validate-job-cost-variance.ts.
 */
export function describeVariance(variance: number): VarianceDisplay {
  const amount = Math.abs(variance);
  // variance = projectedFinal - budget, so POSITIVE MEANS OVER. Read the
  // arithmetic at the top of computeJobCost, not any prose about it.
  if (variance > VARIANCE_EPSILON) {
    return {
      tone: 'over',
      label: 'Over by',
      banner: `Projecting ${formatMoney(amount)} over budget`,
      amount,
      colorKey: 'danger',
      trend: 'up',
    };
  }
  if (variance < -VARIANCE_EPSILON) {
    return {
      tone: 'under',
      label: 'Under by',
      banner: `On track to finish ${formatMoney(amount)} under budget`,
      amount,
      colorKey: 'success',
      trend: 'down',
    };
  }
  // Landing on the number is neither a win nor a loss, and must not be
  // painted as one — `formatMoney` would render "$0" beside "Under by".
  return {
    tone: 'on_budget',
    label: 'On budget',
    banner: 'Projecting to finish on budget',
    amount: 0,
    colorKey: 'neutral',
    trend: 'flat',
  };
}
