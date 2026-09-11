// utils/wip.ts — pure WIP (Work-In-Progress) schedule engine.
// NO React / React Native imports. Every function is deterministic and
// side-effect-free so scripts/validate-wip.ts can exercise it directly.
import type {
  WipRowInput, WipRow, WipPortfolio, WipSnapshotRow, WipFlags, WipPeriod,
  Commitment, Invoice, SavedAIAPayApp, ChangeOrder, Project, MaterialReceipt,
} from '@/types';
// Pure money math — utils/invoiceBilling.ts has no React Native imports, so the
// bun validators that import this module keep running.
import { pendingRetentionHeld } from '@/utils/invoiceBilling';

// ─────────────────────────────────────────────────────────────────────────────
// THE WIP TERMS — one definition each (app-experience audit 2026-09-07, "Do
// next" #2).
//
// MAGE ships TWO bank-facing WIP schedules one sidebar row apart — this engine
// (app/wip-report.tsx) and utils/financialReports.computeWIPReport (the WIP tab
// of app/reports.tsx) — and they disagreed on four axes:
//
//   1. BILLINGS POPULATION — suggestBilledToDate summed EVERY invoice
//      including drafts; computeWIPReport excludes them. A draft is a document
//      the client has never seen, so counting it inflates billed-to-date and
//      understates underbilling — the exact number a lender reads to judge
//      whether a job is financing itself on its own client's money.
//   2. COST-TO-DATE BASIS — this engine sums commitment.paidToDate + material
//      receipts (suggestCostToDate); computeWIPReport routes through
//      utils/jobCostEngine. validate-money-definitions.ts already pins those
//      two to the same arithmetic.
//   3. PERCENT-COMPLETE BASIS — both are cost-based (cost ÷ cost-at-
//      completion); they inherit whatever axis 2 hands them.
//   4. PROJECT POPULATION — app/wip-report.tsx listed EVERY project including
//      CLOSED ones; computeWIPReport skips closed. A finished job carried on a
//      surety document restates backlog that does not exist.
//
// Axes 1 and 4 are settled HERE, by the two predicates below, so that a screen
// cannot express its own opinion about what a billing or a WIP-reportable job
// is. scripts/validate-wip-parity.ts asserts both engines return the same
// dollars for the same inputs.
//
// AXIS 2 IS NOW SETTLED HERE TOO (polish audit 2026-09-10, the worst finding in
// it). On one seeded job — a $155,172 contract against a $131,502 estimate with
// $42,200 of subs already awarded — /wip-report printed "Weighted margin 15%"
// and /reports printed "Projected profit -$18,530 / -11.9%", same account, same
// session, same project, and neither said which cost it had measured against.
// Two screens that both call themselves bank-ready, 27 margin points apart, and
// the contractor is the one who has to explain it to the lender.
//
// The -11.9% was not a second defensible opinion, it was a double count:
// computeWIPReport read jobCostEngine's per-phase EAC, and the engine buckets a
// commitment by its free-text `phase` ("Electrical") while it buckets the
// estimate by `item.category` ("subcontractor"). The strings differ, so awarding
// the two subs the estimate had already priced added $42,200 ON TOP of the
// $131,502 that still priced them. A GC who buys out exactly what he estimated
// was told he was losing money.
//
// So there is one definition now, `deriveEstimatedCostWithSource` below, and
// both schedules route through it. Fixing the phase-matching inside the engine
// is still worth doing for the Job Costing screen, but it is not what makes
// these two reports foot — one definition is.
//
// AXES 5, 6 AND 7 — THE THREE NOBODY HAD ENUMERATED (audit 2026-09-11):
//
//   5. THE CONTRACT. This engine ran a seven-branch chain (pay-app contract
//      sum, CO snapshot, target budget, GMP cap, estimate); computeWIPReport
//      ran `effectiveEstimateTotal`, which is the linked estimate's grandTotal
//      and nothing else. A job with a saved pay application read $700,000 /
//      42.9% margin here and $550,000 / 27.3% there; a target-budget-only job
//      read $900,000 against $0. That is the REVENUE side of a surety
//      document, and none of the four axes above could see it.
//   6. BILLED TO DATE. computeWIPReport never took pay applications at all, so
//      a GC billing through the flagship AIA progress billing read
//      $350,000 billed on /wip-report and $0 on the /reports WIP tab — which
//      then invented underbilling equal to the whole of earned revenue.
//   7. THE PERCENT-COMPLETE FALLBACK. computeWIPReport fell back to the
//      AVERAGE TASK PROGRESS of the project schedule whenever it had no cost
//      picture, so a job with two tasks at 40% and 60% and no cost data read
//      50% complete, $250,000 earned and $250,000 unbilled on /reports while
//      /wip-report read 0% and $0. Schedule-basis revenue recognition, on a
//      document that names itself cost-to-cost — and the divergence most
//      likely to hit a NEW account (no cost yet, a schedule already built).
//
// All three are settled here now: `deriveOriginalContractWithSource`,
// `suggestBillingsWithSource` and `computeWipRow`'s own zero-cost guard are the
// single definitions, and utils/financialReports calls them instead of holding
// its own opinion. Schedule progress is still READ on both screens — as a
// DIAGNOSTIC (flagWipRow's `evm` divergence flag), never as a revenue basis.
// scripts/validate-wip-parity.ts asserts all three axes across the two engines.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DEFINITION 1 — a BILLING is an invoice the client has actually been given.
 *
 * A `draft` is a document that exists only on the GC's phone: it has been
 * issued to nobody and owes nothing. Everything else — sent, partially_paid,
 * paid, overdue — has genuinely been billed. utils/changeOrderBilling and
 * app/bill-from-estimate already draw the line in exactly this place.
 */
export function isWipBilling(invoice: Pick<Invoice, 'status'>): boolean {
  return invoice.status !== 'draft';
}

/**
 * DEFINITION 1b — a SAVED AIA PAY APPLICATION is a billing once it has been
 * issued to the owner.
 *
 * `portalState.status` is the only lifecycle a pay app has: draft | sent |
 * recalled. `undefined` reads as SENT, which is not a shortcut — PortalState's
 * own field doc says items predating the portal feature are treated as sent by
 * the snapshot filter, and reading them as drafts here would blank the billings
 * of every account that has been on MAGE longer than the portal has.
 */
export function payAppPortalStatus(app: SavedAIAPayApp): 'draft' | 'sent' | 'recalled' {
  return app.portalState?.status ?? 'sent';
}

/**
 * The pay applications that count as billings on a WIP schedule.
 *
 * A RECALLED application is always out: the GC withdrew it from the client, so
 * its cumulative "Total Completed and Stored" is not billed, the same way a
 * draft invoice is not billed (definition 1).
 *
 * A DRAFT is out ONLY WHEN THIS PROJECT ACTUALLY USES THE PORTAL, and that
 * condition is the whole of the care in this function. On the invoice side the
 * GC sets `status` himself, so `draft` means what it says. A pay app has no
 * such control: app/aia-pay-app.tsx stamps `{ status: 'draft' }` on EVERY save,
 * and "Generate PDF" — the actual act of issuing a G702 to an owner for most of
 * this product's users — routes through the same save. So excluding every draft
 * outright would report $0 billed, and therefore underbilling equal to the whole
 * of earned revenue, for every GC who mails or emails his pay applications. That
 * is a worse wrong number than the one it fixes, in the same column, on the same
 * bank document.
 *
 * The signal that separates the two worlds is whether ANY application on this
 * project has ever left through the portal. If one has, the portal IS this job's
 * issuing channel and a draft is genuinely unissued — so a G702 saved but never
 * sent stops inflating billed-to-date. If none has, the GC issues outside MAGE
 * and every surviving application counts. (A `recalled` app proves the portal
 * was used, because recall requires a prior send.)
 */
export function wipBillablePayApps(payApps: SavedAIAPayApp[]): SavedAIAPayApp[] {
  const portalIsTheChannel = payApps.some((a) => {
    const status = payAppPortalStatus(a);
    return status === 'sent' || status === 'recalled'
      || a.portalState?.sentAt != null || (a.portalState?.sentVersion ?? 0) > 0;
  });
  return payApps.filter((a) => {
    const status = payAppPortalStatus(a);
    if (status === 'recalled') return false;
    if (status === 'draft' && portalIsTheChannel) return false;
    return true;
  });
}

/**
 * DEFINITION 4 — which projects belong on a WIP schedule.
 *
 * Work-in-progress means work still in progress. A `closed` job has no
 * remaining backlog, no cost to complete and no earned revenue left to
 * recognize; carrying it inflates portfolio backlog and revised contract on a
 * document a surety sizes a bond from. `completed` is deliberately KEPT — a
 * job can be built out and still be carrying unbilled revenue or unreleased
 * retainage, which is precisely what the schedule exists to show.
 */
export function isWipReportableProject(project: Pick<Project, 'status'>): boolean {
  return project.status !== 'closed';
}

/**
 * DEFINITION 5 — a SIGNED commitment is money the GC is contractually bound to
 * pay out.
 *
 * A `draft` subcontract or PO has been issued to nobody: it binds the GC to
 * nothing and must not raise his cost-at-completion. utils/jobCostEngine.ts
 * draws the line in exactly the same place (`c.status !== 'draft'`), so the two
 * cost engines cannot disagree about which commitments exist — which is how the
 * two WIP schedules came to disagree about everything else.
 */
export function isSignedCommitment(commitment: Pick<Commitment, 'status'>): boolean {
  return commitment.status !== 'draft';
}

/**
 * Σ what the GC has signed for — the original amount plus the net of the change
 * orders written against each commitment. COST leaving the business, never
 * revenue arriving. `amount` is deliberately never mutated by a CO revision
 * (see the field doc on Commitment), so reading it alone understates every
 * commitment that has been revised.
 */
export function sumSignedCommitmentValue(commitments: Commitment[]): number {
  return commitments
    .filter(isSignedCommitment)
    .reduce((sum, c) => sum + (c.amount ?? 0) + (c.changeAmount ?? 0), 0);
}

/**
 * THE ONE TEST for whether a typed cost to complete is a usable forecast.
 *
 * Two engines apply the ETC — computeWipRow below (the /wip-report row) and
 * deriveEstimatedCostWithSource (which is what utils/financialReports.ts's two
 * report builders derive their cost at completion from). They must not each
 * carry their own copy of "what counts", because a job the one accepts and the
 * other rejects is two cost-at-completion figures on one job again, which is
 * the whole subject of this module.
 *
 * ZERO IS A FORECAST. "Nothing left to spend" is a real thing for a GC to say
 * about a job at closeout, and rejecting it would silently restore the derived
 * figure on the one job where he said the opposite. Negative is not: a cost to
 * complete below zero is not a forecast, and neither is NaN or Infinity.
 */
export function isUsableWipEtc(etc: number | null | undefined): etc is number {
  return typeof etc === 'number' && Number.isFinite(etc) && etc >= 0;
}

/** Clamp with NaN → lo, so divide-by-zero never leaks a NaN downstream. */
export function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Turn explicit inputs into a fully computed WIP row.
 *
 * THE ESTIMATED COST TO COMPLETE, AND WHY IT IS THE INPUT THAT MATTERS MOST
 * (audit 2026-09-11, the top finding in this area).
 *
 * Cost at completion used to be a pure derivation: max(estimate, signed
 * commitments, cost already paid out). The third floor is correct and it has to
 * be there — a job cannot finish for less than what it has already cost — but
 * once it binds, EAC == costToDate, so `costToDate / EAC` is exactly 1.0 BY
 * CONSTRUCTION and `costToComplete` and `backlog` are 0. Measured: a $550,000
 * contract with $620,000 incurred reported 100% complete, the FULL $550,000
 * earned, $0 left to spend and $0 of backlog — on both schedules. The engine
 * was forecasting that every overrun job would incur no further cost, on the
 * document a bank and a surety underwrite, and the job might be 60% built.
 *
 * Under cost-to-cost, cost incurred passing the estimate is the signal that the
 * FORECAST is stale, not that the job is finished. The fix is the input every
 * CPA-prepared WIP has and this product did not: an estimated cost to complete,
 * entered per period by the person actually running the job. Surety-issued WIP
 * templates name it as a required column and name inaccurate cost-to-complete
 * estimates as the first failure that sinks construction accounting.
 *
 * So when `estimatedCostToComplete` is present:
 *     EAC = costToDate + ETC          (the CPA definition)
 *     costToComplete = ETC            (what the GC actually said is left)
 * and when it is absent the derived `totalEstimatedCost` stands, exactly as
 * before. `estimatedCostAtCompletion` on the output is the figure the row was
 * actually struck against, so an export never prints a denominator the margin
 * beside it was not measured with.
 */
export function computeWipRow(input: WipRowInput): WipRow {
  const {
    originalContract, approvedChangeOrders, totalEstimatedCost,
    costToDate, billedToDate, estimatedCostToComplete,
  } = input;

  const revisedContract = originalContract + approvedChangeOrders;

  // A typed ETC REPLACES the derived forecast rather than flooring it: the
  // whole point is that the GC can say the job will cost MORE than it has so
  // far, and also that it will cost LESS than a stale estimate says. Negative
  // and non-finite are rejected (a cost to complete below zero is not a
  // forecast) and fall back to the derivation rather than poisoning the row.
  const etcEntered = isUsableWipEtc(estimatedCostToComplete);
  const estimatedCostAtCompletion = etcEntered
    ? costToDate + estimatedCostToComplete
    : totalEstimatedCost;

  const percentComplete = estimatedCostAtCompletion === 0
    ? 0
    : clamp(costToDate / estimatedCostAtCompletion, 0, 1);

  const earnedRevenue = revisedContract * percentComplete;
  const overbilling = Math.max(0, billedToDate - earnedRevenue);
  const underbilling = Math.max(0, earnedRevenue - billedToDate);
  const estGrossProfit = revisedContract - estimatedCostAtCompletion;
  const estGrossMarginPct = revisedContract === 0 ? 0 : estGrossProfit / revisedContract;
  const costToComplete = etcEntered
    ? estimatedCostToComplete
    : Math.max(0, estimatedCostAtCompletion - costToDate);
  const backlog = revisedContract - earnedRevenue;

  // Profit-to-date. GAAP (ASC 606 / 605-35) requires the FULL anticipated loss
  // to be recognized as soon as a job is forecast to lose money, not pro-rated
  // by percent complete. So for a loss job (estGrossProfit < 0) we book the
  // greater of the pro-rata result and the total estimated loss — whichever is
  // worse (more negative). Profit jobs keep the spec's simple earned − cost.
  const anticipatedLoss = estGrossProfit < 0;
  const profitToDate = anticipatedLoss
    ? Math.min(earnedRevenue - costToDate, estGrossProfit)
    : earnedRevenue - costToDate;

  return {
    revisedContract, percentComplete, earnedRevenue, overbilling, underbilling,
    estGrossProfit, estGrossMarginPct, profitToDate, costToComplete, backlog,
    anticipatedLoss, estimatedCostAtCompletion,
  };
}

/**
 * The cost at completion a row was actually struck against.
 *
 * A snapshot frozen before the ETC input shipped has no `estimatedCostAtCompletion`
 * on its output — the field is declared optional for exactly that reason — so
 * every reader falls back to the input's derived figure, which IS what those
 * rows were computed with. Printing the input blindly on a NEW row would print
 * a denominator the margin beside it was not measured with, which is why this
 * is one function rather than a `??` repeated at seven call sites.
 */
export function wipRowCostAtCompletion(row: WipSnapshotRow): number {
  return row.output.estimatedCostAtCompletion ?? row.input.totalEstimatedCost;
}

/**
 * Does this row have ANY cost basis — a forecast, a commitment, or a dollar
 * actually spent?
 *
 * A job set up with only a target budget or a GMP cap gets a CONTRACT (those
 * are revenue fallbacks in deriveOriginalContract) and NO COST
 * (deriveEstimatedCost deliberately excludes both), so computeWipRow returns
 * estGrossProfit == the entire contract at a 100% margin. Measured on a
 * $900,000 target-budget job with no estimate: estGrossProfit $900,000,
 * estGrossMarginPct 1.0, and the portfolio's weightedMarginPct 1.0 — a
 * fabricated hundred-percent margin pulling the number a lender reads as the
 * verdict, on a job whose "contract" may be a homeowner's proposed budget
 * (ProjectTargetBudget can carry setBy: 'client').
 *
 * A contract with no cost basis has no measurable margin, so the roll-up
 * excludes it from both sides of the weighted margin and counts it instead.
 * `costToDate > 0` keeps a job whose only cost signal is money already spent —
 * that IS a basis, and it is the one the incurred floor is built on.
 */
export function wipRowHasCostBasis(row: WipSnapshotRow): boolean {
  return wipRowCostAtCompletion(row) > 0 || row.input.costToDate > 0;
}

/**
 * Sum a set of snapshot rows into a portfolio roll-up with weighted margin.
 *
 * THE LOSS FIGURES ARE NOT DECORATION (audit 2026-09-11). `weightedMarginPct`
 * NETS: a $1,000,000 job at $800,000 of cost beside a $300,000 job at $500,000
 * returns 0%, and the Portfolio strip printed "Weighted margin 0%" over a book
 * carrying a $200,000 forecast loss with nothing naming it. A WIP total row DOES
 * sum across jobs — that is correct and it stays — but ASC 605-35-25-46 requires
 * the provision for an onerous contract to be booked per contract, and it cannot
 * be offset against profitable ones. So the roll-up now also carries the count,
 * the total forecast loss, and the provision a CPA actually posts, and the
 * weighted margin is never allowed to stand alone.
 */
export function computeWipPortfolio(rows: WipSnapshotRow[]): WipPortfolio {
  const acc: WipPortfolio = {
    revisedContract: 0, totalEstimatedCost: 0, costToDate: 0, earnedRevenue: 0,
    billedToDate: 0, overbilling: 0, underbilling: 0, backlog: 0, weightedMarginPct: 0,
    retainageHeld: 0, lossJobCount: 0, totalForecastLoss: 0, lossProvision: 0,
    noCostBasisCount: 0, noCostBasisContract: 0,
  };
  // The weighted margin runs over MEASURABLE jobs only — see wipRowHasCostBasis.
  // The column totals above it still sum the whole book, because a WIP total row
  // does; it is the RATIO that a costless job corrupts, by adding contract to
  // the numerator and nothing to the denominator.
  let marginContract = 0;
  let marginCost = 0;
  for (const r of rows) {
    acc.revisedContract += r.output.revisedContract;
    if (wipRowHasCostBasis(r)) {
      marginContract += r.output.revisedContract;
      marginCost += wipRowCostAtCompletion(r);
    } else {
      acc.noCostBasisCount = (acc.noCostBasisCount ?? 0) + 1;
      acc.noCostBasisContract = (acc.noCostBasisContract ?? 0) + r.output.revisedContract;
    }
    // The cost the ROW was struck against, not the derivation it started from —
    // otherwise a portfolio carrying one ETC-revised job sums a denominator
    // none of its own margins were measured with.
    acc.totalEstimatedCost += wipRowCostAtCompletion(r);
    acc.costToDate += r.input.costToDate;
    acc.earnedRevenue += r.output.earnedRevenue;
    acc.billedToDate += r.input.billedToDate;
    acc.overbilling += r.output.overbilling;
    acc.underbilling += r.output.underbilling;
    acc.backlog += r.output.backlog;
    // Legacy snapshots predate the retainage column; absent means "not
    // recorded", and adding 0 for them is the only honest sum available.
    acc.retainageHeld = (acc.retainageHeld ?? 0) + (r.input.retainageHeld ?? 0);
    if (r.output.estGrossProfit < 0) {
      acc.lossJobCount = (acc.lossJobCount ?? 0) + 1;
      acc.totalForecastLoss = (acc.totalForecastLoss ?? 0) - r.output.estGrossProfit;
      // The accrual: the part of the forecast loss NOT yet run through cost.
      // (earned − cost) is the loss already incurred; the forecast loss is the
      // whole of it; the difference is what must be provided for now. Floored
      // at 0 because a job whose incurred loss already exceeds the forecast
      // needs no further provision — it needs a new forecast.
      const incurredLoss = r.output.earnedRevenue - r.input.costToDate;
      acc.lossProvision = (acc.lossProvision ?? 0)
        + Math.max(0, incurredLoss - r.output.estGrossProfit);
    }
  }
  acc.weightedMarginPct = marginContract === 0
    ? 0
    : (marginContract - marginCost) / marginContract;
  return acc;
}

/** Σ approved change-order value deltas → the revised-contract adjustment. */
export function sumApprovedChangeOrders(changeOrders: ChangeOrder[]): number {
  return changeOrders
    .filter((co) => co.status === 'approved')
    .reduce((sum, co) => sum + (co.changeAmount || 0), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVENANCE (audit 2026-09-07, "Worth doing" #26).
//
// Every input on this schedule comes off a multi-branch fallback chain —
// deriveOriginalContract alone has seven — and the GC had no way to learn that
// the $1,400,000 "contract" a bank is reading came from a GMP cap he typed once
// during project setup rather than from a signed contract. That is his surety's
// first question and he could not answer it from inside the product.
//
// So each derive function has a `…WithSource` sibling that returns
// `{ value, source }`, and the plain function is a one-line wrapper over it.
// One chain, one set of branches: a new fallback cannot be added to the number
// without also being added to the explanation.
// ─────────────────────────────────────────────────────────────────────────────

/** Which branch of a WIP fallback chain actually produced the number. */
export type WipSource =
  | 'pay_app_contract_sum'
  | 'estimate_grand_total'
  | 'change_order_snapshot'
  | 'target_budget'
  | 'gmp_cap'
  | 'legacy_estimate_grand_total'
  | 'estimate_base_total'
  | 'signed_commitments'
  | 'commitments_and_receipts'
  | 'cost_incurred'
  | 'cost_to_complete_entered'
  | 'none';

/** A derived WIP figure and the branch it came from. */
export interface WipDerived {
  value: number;
  source: WipSource;
}

/**
 * Plain-English provenance, phrased for a GC answering a banker — not for a
 * developer reading a stack. Shown in the WIP drill-in and exported alongside
 * the figure so the schedule can say where each number came from.
 */
export const WIP_SOURCE_LABELS: Record<WipSource, string> = {
  pay_app_contract_sum: 'Original contract sum on your LATEST saved AIA pay application',
  estimate_grand_total: 'Linked estimate — grand total (priced)',
  change_order_snapshot: 'Reconstructed from a change order’s contract snapshot',
  target_budget: 'Target budget you entered in project setup',
  gmp_cap: 'GMP cap you entered in project setup',
  legacy_estimate_grand_total: 'Legacy estimate — grand total',
  estimate_base_total: 'Linked estimate — base total (cost before markup)',
  signed_commitments: 'Signed subcontracts and POs, including CO revisions',
  commitments_and_receipts:
    'Subs paid to date plus material receipts — self-performed labor NOT included, so this is a lower bound',
  cost_incurred:
    'Cost you have already paid out on this job — more than the estimate or the commitments, so it sets the floor',
  cost_to_complete_entered:
    'Cost to date plus the cost to complete YOU entered — your own forecast for this period, not a figure MAGE derived',
  none: 'No source on file — enter this figure yourself',
};

/**
 * THE ESTIMATED-COST-TO-COMPLETE STORE, AND WHY ITS SHAPE LIVES IN THE ENGINE.
 *
 * The ETC is typed on /wip-report and stored per user in AsyncStorage (there is
 * no server column yet — see the notFixed entry and the handoff). It began as
 * three private helpers inside app/wip-report.tsx, and that is precisely why
 * /reports could not see it: the flagship screen forecast an $800,000 cost at
 * completion while the /reports WIP tab, its CSV and its PDF forecast $620,000
 * on the same job in the same session, because the second screen had no way to
 * reach the map. A storage key that only one screen knows how to build is a
 * second definition of the number it holds.
 *
 * So the key, the entry shape and the parser are HERE, and both screens read
 * them. The prefix is `mageid_` so utils/localCacheKeys.ts's tenant sweep takes
 * it on a user switch (test:storage-hygiene fails the build otherwise).
 */
export const WIP_ETC_STORAGE_PREFIX = 'mageid_wip_cost_to_complete';

/**
 * One project's typed cost to complete. COST still to be spent — never revenue,
 * never cost already incurred. `updatedAt` is an INSTANT, kept for the same
 * reason the cost-to-date override map keeps one: it is what a future server
 * merge compares on, so the rows are already shaped for it.
 */
export interface WipEtcEntry {
  value: number;
  updatedAt: string;
}

/** Per-user key. Falls back to the bare prefix only when there is no user id. */
export function wipEtcStorageKey(userId: string | undefined): string {
  return userId ? `${WIP_ETC_STORAGE_PREFIX}_${userId}` : WIP_ETC_STORAGE_PREFIX;
}

/** Instant stamped on an entry that predates `updatedAt` — always the loser. */
export const WIP_ETC_LEGACY_STAMP = '1970-01-01T00:00:00.000Z';

/** Parse a stored ETC map, dropping anything that is not a usable forecast. */
export function normalizeWipEtcMap(raw: unknown): Record<string, WipEtcEntry> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, WipEtcEntry> = {};
  for (const [projectId, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (entry && typeof entry === 'object') {
      const e = entry as Partial<WipEtcEntry>;
      // `>= 0` not `> 0`: zero is a legitimate forecast ("nothing left to
      // spend") and dropping it would silently restore the derived figure on
      // the one job where the GC has said the opposite.
      if (typeof e.value === 'number' && Number.isFinite(e.value) && e.value >= 0) {
        out[projectId] = {
          value: e.value,
          updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : WIP_ETC_LEGACY_STAMP,
        };
      }
    }
  }
  return out;
}

/**
 * The map both report builders take: project id → cost to complete.
 *
 * A plain `Record<string, number>` rather than the entry shape, because the
 * engines have no business with sync stamps and a narrower parameter cannot be
 * fed a half-parsed object by a future caller.
 */
export function wipEtcValueMap(entries: Record<string, WipEtcEntry>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [projectId, e] of Object.entries(entries)) out[projectId] = e.value;
  return out;
}

/**
 * Cost-to-date is the one input on this schedule a GC types over, because the
 * automatic figure (subs paid + material receipts) cannot see what his own
 * crews cost. So it has two provenances the derive chain above will never
 * return, and a schedule that does not say which one it used is the whole
 * finding: $340,000 of self-performed labor typed on the laptop, an empty
 * override map on the phone, a period frozen and exported from the phone at
 * the lower bound — and nothing on screen saying the number had moved.
 *
 * These are deliberately NOT members of WipSource. WipSource is exactly the
 * set of branches the three derive functions can return, and
 * scripts/validate-wip-parity.ts holds it to exactly that set. A typed number
 * is user input, not a derivation.
 */
export type WipCostOverrideSource = 'entered_on_this_device' | 'entered_and_synced';

/** Every provenance a cost-to-date figure can carry — derived or typed. */
export type WipCostToDateSource = WipSource | WipCostOverrideSource;

export const WIP_COST_OVERRIDE_LABELS: Record<WipCostOverrideSource, string> = {
  entered_on_this_device: 'Cost-to-date you entered on this device — not yet synced to your account',
  entered_and_synced: 'Cost-to-date you entered, synced across your devices',
};

/**
 * What a Source cell says when the row names a branch this build has no label
 * for. This is reachable, not theoretical: snapshot rows are read back out of
 * AsyncStorage and out of the `wip_periods` jsonb column with a cast and no
 * validation (contexts/WipContext.tsx:55), so a renamed WipSource — or a row
 * written by a newer build — arrives here as a string nothing in this file
 * declares.
 */
export const WIP_SOURCE_UNRECOGNIZED =
  'Recorded under a source this version of MAGE does not recognise';

/**
 * Plain-English provenance for any source a WIP figure can carry.
 *
 * Own-property lookups, and a real sentence when neither table has the key.
 * `in` walks the prototype chain, so a snapshot carrying `'constructor'`
 * returned Object itself and printed `function Object() { [native code] }` in
 * the Source column; an unrecognised key returned undefined and printed the
 * word "undefined" beside a $1.4M contract on the page a surety reads. A
 * source cell has to be a sentence or an admission — never a stringified miss.
 */
export function wipSourceLabel(source: WipCostToDateSource): string {
  const has = (table: object, key: unknown): boolean =>
    typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);
  if (has(WIP_COST_OVERRIDE_LABELS, source)) {
    return WIP_COST_OVERRIDE_LABELS[source as WipCostOverrideSource];
  }
  if (has(WIP_SOURCE_LABELS, source)) return WIP_SOURCE_LABELS[source as WipSource];
  return WIP_SOURCE_UNRECOGNIZED;
}

/**
 * The provenance of the three DERIVED inputs on one WIP row, carried on the
 * snapshot so a period locked in March can still answer the surety's question
 * in June. Snapshots are the document; recomputing provenance at export time
 * against today's projects would explain a number the export is not printing.
 */
export interface WipRowSources {
  /** Branch that produced originalContract — a REVENUE figure. */
  originalContract: WipSource;
  /** Branch that produced totalEstimatedCost — a COST figure. */
  totalEstimatedCost: WipSource;
  /** Automatic chain, or the GC's typed override and whether it has synced. */
  costToDate: WipCostToDateSource;
}

/**
 * A snapshot row that carries its provenance. `sources` is optional because
 * periods locked before this shipped do not have it — those must say so rather
 * than have a source invented for them (WIP_SOURCE_UNRECORDED below).
 */
export type WipSnapshotRowWithSources = WipSnapshotRow & { sources?: WipRowSources };

/** A period whose rows may carry provenance. A plain WipPeriod is assignable. */
export type WipPeriodWithSources = Omit<WipPeriod, 'rows'> & { rows: WipSnapshotRowWithSources[] };

/**
 * WHAT THE WIP SCREEN IS ACTUALLY SHOWING — a pure selector, not a ternary
 * scattered through JSX (adversarial review 2026-09-11).
 *
 * The defect it encodes: tapping a saved or locked period chip changed
 * `selectedPeriodId`, which fed the Export buttons and NOTHING else. The
 * Portfolio strip and the Projects list stayed hardwired to today's live rows,
 * so a GC tapped the locked "2026-03-31" chip, read today's revised contract, today's
 * underbilling and today's weighted margin, pressed Export PDF and mailed
 * March.
 *
 * The fix lived in the screen as `const viewingFrozen = selectedPeriod !== null`
 * plus two more ternaries, and every guard on it was a REGEX over the source
 * text. Setting `viewingFrozen = false` restored the whole defect with all four
 * WIP validators green, because the strings the regexes match were all still
 * there. So the decision is a function the validators can call, and they assert
 * what it RETURNS.
 *
 * `viewingFrozen` is the one flag the screen branches on: it blocks the
 * cost-to-date and cost-to-complete edits (the period is the document), blocks
 * Save (which builds from today's book), and suppresses the schedule-divergence
 * check (measured against TODAY's schedule, which a frozen row must not be
 * compared to).
 */
export function selectWipDisplayPeriod<R extends WipSnapshotRowWithSources, P extends WipPortfolio>(
  selectedPeriodId: string | null,
  periods: WipPeriodWithSources[],
  liveRows: R[],
  livePortfolio: P,
): {
  period: WipPeriodWithSources | null;
  rows: WipSnapshotRowWithSources[];
  portfolio: WipPortfolio;
  viewingFrozen: boolean;
} {
  const period = selectedPeriodId
    ? periods.find((p) => p.id === selectedPeriodId) ?? null
    : null;
  return {
    period,
    rows: period ? period.rows : liveRows,
    portfolio: period ? period.portfolioTotals : livePortfolio,
    // A chip pointing at a period that is no longer in the list (deleted on
    // another device, or not yet hydrated) is NOT "frozen" — it falls back to
    // the live book, and the flag has to agree with the rows beside it or the
    // screen locks editing on figures that are today's.
    viewingFrozen: period !== null,
  };
}

/**
 * The estimated-cost-to-complete reducer, extracted from the /wip-report
 * drill-in so it can be tested by behaviour (adversarial review 2026-09-11).
 *
 * It lived inside `commitDrillEtc`, a useCallback, and the only guard on the
 * top finding's whole fix was a regex over the surrounding source — inserting
 * an early `return` at the top of that callback made the entire cost-to-complete
 * input record NOTHING, with all four WIP validators still green.
 *
 * The rules, all of which have a reason:
 *   • EMPTY means "use MAGE's forecast" and REMOVES the entry. There is no
 *     server row to resurrect, so a plain delete is enough (unlike the
 *     cost-to-date override, which needs a tombstone).
 *   • "0" is a deliberate zero, not empty: a job with nothing left to spend is
 *     a real answer, and it is the one that makes percent complete read 100%
 *     honestly.
 *   • Unparseable text ("1.2.3") is not an instruction — record nothing and
 *     leave the previous forecast standing.
 *   • Negative is not a forecast; same treatment.
 *   • An unchanged value returns the SAME OBJECT, because this fires on blur
 *     AND on close and a re-stamped `updatedAt` on every open/close would beat
 *     a real edit from another device in any future last-write-wins merge. The
 *     compare is rounded because the input is seeded with Math.round of the
 *     stored figure.
 */
export function applyWipEtcEntry(
  prev: Record<string, WipEtcEntry>,
  projectId: string,
  text: string,
  nowIso: string,
): Record<string, WipEtcEntry> {
  // A MINUS SIGN IS CAUGHT BEFORE THE STRIP, not after it. The strip removes
  // everything but digits and dots — which is what lets a GC type "$180,000" —
  // and it also removed the minus, so "-5000" parsed as 5000 and the `typed < 0`
  // guard below could never fire. Recording the OPPOSITE of what the user typed,
  // silently, into the figure the whole schedule is measured against, is worse
  // than recording nothing. (Found by the behaviour guard that replaced this
  // path's source-shape regex — adversarial review 2026-09-11.)
  if (/-/.test(text)) return prev;
  const cleaned = text.replace(/[^0-9.]/g, '');
  const typed = Number(cleaned);
  const emptied = !/[0-9]/.test(cleaned);
  if (!emptied && !Number.isFinite(typed)) return prev;
  const current = prev[projectId];
  if (emptied) {
    if (!current) return prev;
    const next = { ...prev };
    delete next[projectId];
    return next;
  }
  if (typed < 0) return prev;
  if (current && Math.round(current.value) === Math.round(typed)) return prev;
  return { ...prev, [projectId]: { value: typed, updatedAt: nowIso } };
}

/**
 * What the export prints when a row predates source tracking. Saying "not
 * recorded" is the honest answer; picking the most likely branch would put a
 * guess in front of a banker in the same typeface as a fact.
 */
export const WIP_SOURCE_UNRECORDED = 'Not recorded — this snapshot predates source tracking';

/**
 * The standing caveat on cost-to-date. The list row on app/wip-report.tsx has
 * always shown it ("est. — tap to add labor") and the PDF dropped it, so the
 * one document that leaves the building was the one that did not say the
 * figure was a floor.
 */
export const WIP_COST_TO_DATE_CAVEAT =
  'Cost to date counts subcontractor payments and material receipts. Self-performed '
  + 'labor is not captured automatically — unless the line above says you entered the '
  + 'figure, it is a LOWER BOUND, not the total cost incurred.';

/**
 * The three source lines for one row, ready to print in a CSV cell or a PDF.
 * One function so the CSV and the PDF cannot end up explaining the same
 * schedule two different ways.
 */
export function describeWipRowSources(row: WipSnapshotRowWithSources): {
  originalContract: string;
  totalEstimatedCost: string;
  costToDate: string;
} {
  const s = row.sources;
  // The exported column is REVISED contract — original plus approved change
  // orders — so naming only the original branch would leave a banker unable to
  // reconcile the printed figure against the source it claims.
  const cos = row.input.approvedChangeOrders;
  // A DEDUCTIVE change order is a negative REVENUE adjustment and it is
  // ordinary — the owner cuts scope after signing. The sign has to pick the
  // word: this read "plus $-30,000 of approved change orders" on the footnote
  // page a surety underwrites. NaN off a corrupt row falls through both
  // comparisons and says nothing, which is the right silence.
  const coClause = cos > 0
    ? `, plus ${wipMoney(cos)} of approved change orders`
    : cos < 0
      ? `, less ${wipMoney(Math.abs(cos))} of approved deductive change orders`
      : '';
  return {
    originalContract: s ? wipSourceLabel(s.originalContract) + coClause : WIP_SOURCE_UNRECORDED,
    totalEstimatedCost: s ? wipSourceLabel(s.totalEstimatedCost) : WIP_SOURCE_UNRECORDED,
    costToDate: s ? wipSourceLabel(s.costToDate) : WIP_SOURCE_UNRECORDED,
  };
}

/** Dollars, for prose inside a source line. Revenue or cost — the caller says which. */
function wipMoney(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/**
 * Recover the original (pre-change-order) contract value. `Project` has no
 * direct contract field, so fall back through the best available sources.
 *
 * Final fallback (added so a project with ONLY a legacy estimate still gets a
 * non-zero contract basis — otherwise revisedContract=0 and earnedRevenue=0):
 * the linked-estimate grandTotal, else the legacy estimate.grandTotal. These
 * are the PRICED (revenue) figures — grandTotal already includes markup — so
 * they are the correct contract-value basis, unlike baseTotal (cost) which
 * belongs to deriveEstimatedCost. gmpCap stays ahead of the estimate fallback
 * since a GMP cap is a truer contract ceiling than a working estimate.
 */
export function deriveOriginalContract(
  project: Pick<Project, 'targetBudget' | 'gmpCap' | 'linkedEstimate' | 'estimate'> | null | undefined,
  changeOrders: ChangeOrder[],
  payApps: SavedAIAPayApp[],
): number {
  return deriveOriginalContractWithSource(project, changeOrders, payApps).value;
}

/** deriveOriginalContract, plus which of its seven branches answered. */
export function deriveOriginalContractWithSource(
  project: Pick<Project, 'targetBudget' | 'gmpCap' | 'linkedEstimate' | 'estimate'> | null | undefined,
  changeOrders: ChangeOrder[],
  payApps: SavedAIAPayApp[],
): WipDerived {
  // THE PAY-APP BRANCH IS THE TOP OF THE CHAIN, SO IT IS THE ONE THAT HAS TO BE
  // DEFENSIVE (audit 2026-09-11). It used to read `payApps[0].originalContractSum`
  // and trust it. Three things were wrong with that:
  //
  //   • [0] IS NOT "THE LATEST". It happens to be, because
  //     getAIAPayAppsForProject sorts descending — but this module is pure and
  //     takes an array from any caller, and a future caller passing an
  //     unsorted array would put application #1's contract sum on a bank
  //     document. Reduce to the highest applicationNumber, the way
  //     suggestBilledToDate already does.
  //   • AN APPLICATION THAT IS NOT A BILLING IS NOT A CONTRACT EITHER. This
  //     branch originally filtered `recalled` only, and reasoned about recall
  //     at length while ignoring the DRAFT rule the billings branch right
  //     beside it applies (`wipBillablePayApps`). A mid-edit draft re-seeded
  //     at a different contract sum is not a certificate, and on a portal job
  //     it could otherwise become the "latest" application and put a figure
  //     the client has never seen on a surety schedule. The two branches now
  //     read the same population, which is the only defensible answer: a
  //     recalled application is withdrawn, and a draft on a project that issues
  //     through the portal has not been certified to anyone.
  //
  //     (A GC who issues OUTSIDE the portal keeps every draft, here as in the
  //     billings — `wipBillablePayApps` owns that distinction and the reason
  //     for it, and duplicating a second rule here is how the two drifted.)
  //   • ONE CONTRACT HAS ONE ORIGINAL SUM, AND THE LATEST CERTIFICATE IS THE
  //     ONE THAT SAYS WHAT IT IS. An earlier pass here invented a third rule:
  //     if the surviving applications disagreed about the sum by more than a
  //     dollar, the whole branch was abandoned, the estimate chain answered
  //     instead, and the export printed a `pay_app_contract_conflict` source
  //     label warning the reader to "check the G702s". That was wrong, and it
  //     was wrong on the ORDINARY case rather than a rare one:
  //     `seedAIAPayApplicationFromInvoice` (utils/aiaBilling.ts) re-derives
  //     `originalContractSum` from `effectiveEstimateTotal(project)` on EVERY
  //     new application, so two saved certificates disagree whenever the
  //     estimate moved between them — a re-price, a committed change order.
  //     Measured: apps #1 $550,000 and #2 $700,000 with the estimate now at
  //     $600,000 returned $600,000, so the $700,000 the GC actually certified
  //     to the owner on the latest G702 came off a surety document by
  //     $100,000, under a source cell alarming the reader about a job with
  //     nothing wrong with it.
  //
  //     The defensible tie-break is the one the audit actually asked for:
  //     reduce to the HIGHEST applicationNumber and take its sum. That is the
  //     sum most recently certified to the owner, and it is the figure the
  //     owner is holding a copy of. A disagreement among the earlier
  //     applications is real information, so it is DISCLOSED rather than acted
  //     on — see `payAppContractHistoryNote`, which is the same shape as
  //     `contractVsEstimateNote` below and for the same reason.
  //
  // What this deliberately does NOT do is override a pay-app contract sum that
  // merely DISAGREES WITH THE ESTIMATE. A signed contract differing from the
  // estimate that priced it is the ordinary case — negotiation, allowances,
  // value engineering — and preferring the estimate there would put a wrong
  // contract on the schedule for the common case in order to catch a rare one.
  // The disagreement is disclosed instead, on the surface that can still see
  // the estimate: see `contractVsEstimateNote`.
  const contractApps = wipBillablePayApps(payApps).filter(
    (a) => typeof a.originalContractSum === 'number' && a.originalContractSum > 0,
  );
  if (contractApps.length > 0) {
    const latest = contractApps.reduce((a, b) =>
      (b.applicationNumber ?? 0) >= (a.applicationNumber ?? 0) ? b : a);
    return { value: latest.originalContractSum, source: 'pay_app_contract_sum' };
  }
  // MONEY-F10. A change order's originalContractValue is NOT the original
  // contract: app/change-order.tsx stamps it as
  //     estimate grandTotal + Σ OTHER approved COs at save time
  // and getChangeOrdersForProject hands COs out newest-first, so on a job with
  // two approved COs `changeOrders[0]` already contained the first one and
  // revisedContract added it AGAIN ($500k estimate, +$20k, +$30k read $570k;
  // earned revenue, underbilling and the CO cost ratio all inherited it — on
  // the schedule a surety underwrites). The base every snapshot started from
  // is the estimate total, so when the project has one, that IS the original
  // contract — exact, and immune to the order COs were approved in (a
  // deductive CO approved first leaves a later CO's snapshot BELOW the base).
  // Without an estimate the snapshots are all there is: the smallest positive
  // one carries the fewest other COs. Never the newest.
  if (changeOrders.length > 0) {
    // Linked estimate then legacy estimate, in that order — the same order the
    // tail of this chain uses. (This branch used to be one `??` expression, so
    // a linkedEstimate stored with grandTotal 0 skipped the legacy estimate
    // entirely and reconstructed the contract from a CO snapshot instead. Two
    // branches rather than one is also what lets each say where it came from.)
    const fromLinked = project?.linkedEstimate?.grandTotal;
    if (typeof fromLinked === 'number' && fromLinked > 0) {
      return { value: fromLinked, source: 'estimate_grand_total' };
    }
    const fromLegacy = project?.estimate?.grandTotal;
    if (typeof fromLegacy === 'number' && fromLegacy > 0) {
      return { value: fromLegacy, source: 'legacy_estimate_grand_total' };
    }
    const snapshots = changeOrders
      .map(co => co.originalContractValue)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    if (snapshots.length > 0) {
      return { value: Math.min(...snapshots), source: 'change_order_snapshot' };
    }
  }
  const fromBudget = project?.targetBudget?.amount;
  if (typeof fromBudget === 'number' && fromBudget > 0) {
    return { value: fromBudget, source: 'target_budget' };
  }
  const fromGmp = project?.gmpCap;
  if (typeof fromGmp === 'number' && fromGmp > 0) {
    return { value: fromGmp, source: 'gmp_cap' };
  }
  const fromLinkedEstimate = project?.linkedEstimate?.grandTotal;
  if (typeof fromLinkedEstimate === 'number' && fromLinkedEstimate > 0) {
    return { value: fromLinkedEstimate, source: 'estimate_grand_total' };
  }
  const fromLegacyEstimate = project?.estimate?.grandTotal;
  if (typeof fromLegacyEstimate === 'number' && fromLegacyEstimate > 0) {
    return { value: fromLegacyEstimate, source: 'legacy_estimate_grand_total' };
  }
  return { value: 0, source: 'none' };
}

/**
 * Auto-suggested cost-to-date. Cost-to-date in a WIP schedule is cost
 * INCURRED, so we sum the two actual-cost sources MAGE tracks:
 *   1. Σ commitment.paidToDate — approved + paid sub-submitted invoices against
 *      subcontracts / POs (server-maintained rollup).
 *   2. Σ material-receipt totals — direct material cost captured via
 *      MaterialReceipt. Receipts are NEVER posted into commitment.paidToDate
 *      (see types/index.ts MaterialReceipt doc), so there is no double count.
 *
 * NOT captured automatically: self-performed / direct labor and any incurred-
 * but-not-yet-invoiced sub work. This is therefore a LOWER BOUND — the screen
 * surfaces it as an editable suggestion the user tops up before locking, so a
 * seeded figure is never presented as the authoritative total incurred cost.
 */
export function suggestCostToDate(
  commitments: Commitment[],
  materialReceipts: MaterialReceipt[] = [],
): number {
  return suggestCostToDateWithSource(commitments, materialReceipts).value;
}

/**
 * suggestCostToDate, plus the split the screen needs to say what is IN the
 * lower bound and what is missing from it. `source` is always
 * `commitments_and_receipts` — this figure has one chain, not a fallback tree —
 * but the two components are returned so the drill-in can print
 * "$180,000 subs paid + $42,000 materials — self-performed labor not included".
 */
export function suggestCostToDateWithSource(
  commitments: Commitment[],
  materialReceipts: MaterialReceipt[] = [],
): WipDerived & { committed: number; materials: number } {
  const committed = commitments.reduce((sum, c) => sum + (c.paidToDate ?? 0), 0);
  const materials = materialReceipts.reduce((sum, r) => sum + (r.total ?? 0), 0);
  return {
    value: committed + materials,
    source: 'commitments_and_receipts',
    committed,
    materials,
  };
}

/**
 * Estimated cost at completion — the GC's COST budget, which MUST be sourced
 * separately from the contract value (revenue).
 *
 * THE ONE DEFINITION, used by both bank-facing WIP schedules and by the Profit
 * report (axis 2 of the parity work; see the header):
 *
 *     cost at completion = max(estimate cost basis, Σ signed commitments)
 *
 * The estimate is the plan; the signed commitments are a FLOOR under it,
 * because a job cannot be finished for less than the money already contracted
 * out. Taking the greater of the two is what makes buyout safe to do: awarding
 * the sub the estimate already priced leaves the number where it was, and only
 * a sub signed ABOVE the estimate moves it — which is the real event, and the
 * one a lender wants to see.
 *
 * That max() is the whole fix for the double count. Adding the two together (or
 * per-phase, when the phase strings do not match) is what printed a $173,702
 * cost-at-completion on a $131,502 estimate whose two subcontractor lines were
 * exactly the two subs that had been awarded.
 *
 * Estimate-side precedence:
 *   1. linkedEstimate.baseTotal — cost before markup (the true cost budget;
 *      grandTotal there is the PRICED figure and must not be used as cost).
 *   2. legacy project.estimate.grandTotal — no markup split exists, so this is
 *      the best-available cost estimate.
 * Then the commitments floor; then 0 — no cost basis recorded, so the engine's
 * zero-est guard yields 0% complete and the screen prompts manual entry (never
 * silently wrong).
 *
 * targetBudget / gmpCap are deliberately NOT used here — those are contract
 * (revenue) figures reserved for deriveOriginalContract.
 *
 * DIRECT actual cost (material receipts, crew hours, equipment days, permit
 * fees) is deliberately NOT part of the floor. A snapped receipt is usually a
 * draw against a PO whose full value is already counted here, so adding it
 * would reintroduce the same double count one layer down — the very arithmetic
 * utils/jobCostEngine.ts documents as EAC-DIRECT-1. The consequence, stated
 * plainly so nobody has to rediscover it: a job carried entirely on
 * self-performed labour with no commitments reads its cost at completion off
 * the estimate alone, and the GC's typed cost-to-date is what corrects it.
 */
export function deriveEstimatedCost(
  project: Pick<Project, 'linkedEstimate' | 'estimate'> | null | undefined,
  commitments: Commitment[],
  /**
   * Approved change orders, so their COST can be added to the cost budget the
   * same way their REVENUE is added to revisedContract. Omit only when you
   * genuinely want the original-scope cost (e.g. a baseline comparison).
   */
  /**
   * The full option set of `deriveEstimatedCostWithSource`, deliberately — this
   * is a thin wrapper over it and a narrower type here is how a caller ends up
   * with a different cost at completion from the two report builders. It was
   * missing `costIncurred`, and hooks/useWeekClose.ts (the only hand-built WIP
   * row left in the repo) could therefore not pass the floor even though both
   * WIP schedules do: on an overrun job it reported the ESTIMATE as cost at
   * completion and the Friday Close's "$X unbilled" stopped agreeing with the
   * WIP screen it was built to agree with.
   */
  opts?: Parameters<typeof deriveEstimatedCostWithSource>[2],
): number {
  return deriveEstimatedCostWithSource(project, commitments, opts).value;
}

/**
 * A cost-at-completion, the branch that supplied it, AND both candidates — so a
 * report can print the sentence a banker needs ("this margin is measured
 * against your estimate's cost, and the $42,200 you have signed is inside that
 * figure, not on top of it") instead of an unexplained number.
 */
export interface WipEstimatedCost extends WipDerived {
  /** The estimate's own cost line, topped up for approved COs. COST. */
  estimateBasis: number;
  /** Σ signed (non-draft) commitment value — money contracted OUT. COST. */
  committedFloor: number;
  /**
   * COST ALREADY PAID OUT on this job — subs paid, receipts, crew hours,
   * equipment, permits. The hardest of the three floors, because it is the only
   * one that is not a forecast: the job cannot finish for less than what it has
   * already cost.
   */
  incurredFloor: number;
  /**
   * Which candidate `value` is. 'none' = no cost basis on file at all.
   * 'entered' = the GC's own cost to complete, which REPLACES all three
   * candidates rather than joining the max (see `estimatedCostToComplete`).
   */
  basis: 'estimate' | 'commitments' | 'incurred' | 'entered' | 'none';
}

/** deriveEstimatedCost, plus which branch supplied the cost base. */
export function deriveEstimatedCostWithSource(
  project: Pick<Project, 'linkedEstimate' | 'estimate'> | null | undefined,
  commitments: Commitment[],
  opts?: {
    approvedChangeOrders?: number;
    originalContract?: number;
    costIncurred?: number;
    /**
     * THE GC's OWN COST TO COMPLETE, and the reason this parameter lives HERE
     * rather than only inside computeWipRow (adversarial review 2026-09-11).
     *
     * The ETC shipped as an argument to computeWipRow alone — which is the
     * /wip-report engine. utils/financialReports.computeWIPReport and
     * computeProfitReport derive their cost at completion from THIS function
     * and never saw it, so a GC who entered "$180,000 left to spend" on the
     * flagship screen got EAC $800,000 / 77.5% / $426,250 earned there and EAC
     * $620,000 / 100% / $550,000 earned on /reports, its CSV and its PDF. Two
     * bank-facing WIP schedules, one job, one session — which is the exact
     * defect the whole parity effort exists to close, re-created on a new axis
     * by putting the fix one level too low.
     *
     * So the ETC is part of the ONE cost-at-completion definition, not a
     * property of one screen's row builder. When it is present and valid it
     * REPLACES the three-candidate max entirely:
     *     EAC = cost incurred + cost to complete
     * which is the CPA definition, and the whole point is that the GC can say
     * the job will cost MORE than a stale estimate says (or less). Negative and
     * non-finite are rejected — a cost to complete below zero is not a forecast
     * — and fall through to the derivation rather than poisoning the row.
     */
    estimatedCostToComplete?: number;
  },
): WipEstimatedCost {
  // Which branch supplied the base matters: the commitments floor already
  // contains CO cost (c.changeAmount is the sub-side CO revision), so adding a
  // derived CO cost on top of it would DOUBLE COUNT. The estimate branches are
  // frozen at original scope and are the ones that need topping up.
  let base = 0;
  let baseIsOriginalScope = false;
  let source: WipSource = 'none';

  // Already CO-inclusive, and drafts excluded — an unissued PO binds nobody.
  const committedFloor = sumSignedCommitmentValue(commitments);

  const fromEstimate = project?.linkedEstimate?.baseTotal;
  const fromLegacy = project?.estimate?.grandTotal;
  if (typeof fromEstimate === 'number' && fromEstimate > 0) {
    base = fromEstimate; baseIsOriginalScope = true; source = 'estimate_base_total';
  } else if (typeof fromLegacy === 'number' && fromLegacy > 0) {
    base = fromLegacy; baseIsOriginalScope = true; source = 'legacy_estimate_grand_total';
  }

  const enteredEtc = opts?.estimatedCostToComplete;
  const etcEntered = isUsableWipEtc(enteredEtc);

  if (base === 0 && committedFloor === 0 && !etcEntered) {
    return { value: 0, source: 'none', estimateBasis: 0, committedFloor: 0, incurredFloor: 0, basis: 'none' };
  }

  const estimateBasis = baseIsOriginalScope
    ? topUpForChangeOrders(base, opts)
    : base;

  // The floor only binds when it is ABOVE the plan and is itself a real figure.
  // `> 0` matters: a deductive-CO estimate basis can go negative, and a $0
  // floor must not then "win" and claim signed commitments as its provenance.
  // THE THIRD FLOOR, and the only one that is not a forecast. A job cannot
  // finish for less than what it has ALREADY cost. Without this, a job that has
  // burned past its estimate reports the estimate as its cost at completion and
  // therefore a profit it has already spent its way out of — on the document a
  // bank and a surety underwrite. Added 2026-09-10 after the polish audit found
  // /reports had been flipped from overstating cost (conservative on a surety
  // document) to understating it.
  //
  // A max can never double count, which is why all three candidates can stand
  // side by side: whichever is largest is the one that binds.
  const incurredFloor = Math.max(0, opts?.costIncurred ?? 0);

  // THE ENTERED FORECAST OUTRANKS ALL THREE DERIVED CANDIDATES. It is not a
  // fourth floor in the max: a max could only ever raise the figure, and half
  // the value of the input is a GC saying a stale estimate is too HIGH. It is
  // also the only candidate that is not MAGE's opinion, so the source it
  // returns names the person who typed it.
  if (etcEntered) {
    return {
      value: incurredFloor + enteredEtc,
      source: 'cost_to_complete_entered',
      estimateBasis,
      committedFloor,
      incurredFloor,
      basis: 'entered',
    };
  }

  const winner = Math.max(estimateBasis, committedFloor, incurredFloor);

  // Ordering on ties is deliberate: the SOFTEST explanation wins a tie, because
  // saying "this is your estimate" when the numbers coincide is less alarming
  // and equally true. Only a strict `>` promotes a harder floor.
  if (incurredFloor > estimateBasis && incurredFloor > committedFloor && incurredFloor > 0) {
    return {
      value: incurredFloor,
      source: 'cost_incurred',
      estimateBasis,
      committedFloor,
      incurredFloor,
      basis: 'incurred',
    };
  }
  if (committedFloor > estimateBasis && committedFloor > 0) {
    return {
      value: committedFloor,
      source: 'signed_commitments',
      estimateBasis,
      committedFloor,
      incurredFloor,
      basis: 'commitments',
    };
  }
  void winner;
  return { value: estimateBasis, source, estimateBasis, committedFloor, incurredFloor, basis: 'estimate' };
}

/**
 * Grow an original-scope cost budget by the COST of the approved change orders
 * whose REVENUE computeWipRow has already added to revisedContract.
 *
 * THE BUG THIS CLOSES. computeWipRow does
 *     revisedContract = originalContract + approvedChangeOrders
 *     estGrossProfit  = revisedContract - totalEstimatedCost
 * so a change order that adds revenue while the cost budget stays frozen at the
 * original estimate books at ONE HUNDRED PERCENT MARGIN. A $500k job carrying
 * $100k of approved COs reported ~$100k of profit that does not exist.
 * percentComplete (costToDate / totalEstimatedCost) inflated too, because
 * costToDate DOES pick up CO-driven actuals through commitments and material
 * receipts — so earned revenue and underbilling inflated with it.
 *
 * A WIP schedule is the document a surety and a bank underwrite against.
 * Overstating profit on one is not a display bug.
 *
 * ChangeOrder carries no cost field — lineItems hold unitPrice/total, which are
 * PRICED figures — so CO cost cannot be read, only estimated. We apply the job's
 * own cost ratio, i.e. assume a CO carries the same margin as the base contract.
 * That is the standard WIP convention and it is far closer to truth than
 * assuming the CO is free to deliver.
 *
 * When there is no contract basis to derive a ratio from, fall back to a 1.0
 * ratio — cost equals revenue, zero margin on the CO. That UNDERstates profit,
 * which is the correct direction to be wrong on a document a surety reads. Never
 * fall back to 0.
 */
function topUpForChangeOrders(
  base: number,
  opts?: { approvedChangeOrders?: number; originalContract?: number },
): number {
  const coRevenue = opts?.approvedChangeOrders ?? 0;
  if (coRevenue === 0) return base;
  const originalContract = opts?.originalContract ?? 0;
  const costRatio = originalContract > 0 ? base / originalContract : 1;
  return base + coRevenue * costRatio;
}

// ─────────────────────────────────────────────────────────────────────────────
// SAYING WHICH COST A MARGIN WAS MEASURED AGAINST.
//
// Both screens print a margin above an Export button, and until now neither
// named its basis. The audit's verdict was the right one: two reports that
// disagree but each say why are survivable; two that disagree silently are not.
// Now that they agree, the sentence is still the point — a number a banker reads
// has to say where it came from, and "Est. final cost $173,702" arriving with no
// explanation on a $131,502 estimate is what nobody could account for.
//
// One function for both screens and for the PDF, so the three cannot end up
// explaining the same schedule three different ways.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * COST ALREADY SPENT IS A FLOOR THIS DEFINITION DOES NOT ENFORCE, SO IT SAYS SO.
 *
 * HISTORY, because the sentence outlived the defect. This note was written when
 * `deriveEstimatedCostWithSource` took max(estimate, signed commitments) and
 * stopped there, so a job that had already burned more than its estimate still
 * reported the estimate as its cost at completion — a profit it had spent its
 * way out of, on a document a lender underwrites.
 *
 * The third branch LANDED: `'cost_incurred'` is a WipSource (:212) and the floor
 * is applied at :631-639. The figure now moves. This sentence stays because the
 * floor only raises cost at completion when the caller PASSES `costIncurred`,
 * and a caller that forgets it silently gets the old behaviour — /wip-report was
 * exactly that caller until 2026-09-11. scripts/validate-money-basis-parity.ts
 * now owns the call-site completeness check.
 *
 * THE CONSEQUENCE THE FLOOR CREATES, AND WHAT CLOSES IT (2026-09-11 audit).
 * Once the floor binds, EAC == costToDate on an overrun job, so
 * `percentComplete` is 1.0 BY CONSTRUCTION and `costToComplete` and `backlog`
 * are 0 — the engine forecasting that an overrun job will incur no further
 * cost. That is now closed by the per-period ESTIMATED COST TO COMPLETE the GC
 * enters on the drill-in (`WipRowInput.estimatedCostToComplete`, applied in
 * computeWipRow): with an ETC on the row, EAC = costToDate + ETC and the floor
 * stops being the answer. This sentence still fires when there is NO ETC yet,
 * which is the state in which the number really is overstated, and it is now
 * the prompt to enter one.
 *
 * COST on both sides — `costIncurred` is money paid out, never money billed.
 */
function overspentNote(costAtCompletion: number, costIncurred?: number): string {
  if (costIncurred == null || costIncurred <= costAtCompletion) return '';
  return ` You have already recorded ${wipMoney(costIncurred)} of cost on this job — MORE than the `
    + 'cost at completion above, so the margin here is overstated. Enter what is still left to spend '
    + '(cost to complete) on this job, or update the estimate, before anyone underwrites it.';
}

/**
 * How far out of step a pay application's original contract sum is from the
 * estimate that priced the job — disclosed, never acted on.
 *
 * `deriveOriginalContractWithSource` takes the pay-app contract sum first and
 * keeps taking it even when the estimate disagrees, because a signed contract
 * differing from the estimate is ORDINARY: negotiation, allowances, value
 * engineering. Overriding it would put a wrong contract on the schedule for the
 * common case to catch a rare one. What it must not do is stay silent — a
 * $1,400,000 "contract" that sits $300,000 off the only estimate on the job is
 * the thing a surety asks about, and the GC could not see it from inside the
 * product.
 *
 * REVENUE on both sides. Returns '' unless the pay-app branch actually won and
 * the gap is material (2% of the contract, with a $500 floor so a rounding
 * difference on a small job does not raise an alarm).
 *
 * NOT reachable from the export: a frozen snapshot row carries the contract and
 * its source, never the estimate it might be compared against. This is the live
 * drill-in's sentence, and persisting the estimate onto the snapshot so the PDF
 * footnote can print it too is a follow-up, not a silent omission.
 */
export function contractVsEstimateNote(
  contract: WipDerived,
  estimateGrandTotal: number | null | undefined,
): string {
  if (contract.source !== 'pay_app_contract_sum') return '';
  if (typeof estimateGrandTotal !== 'number' || !(estimateGrandTotal > 0)) return '';
  const gap = contract.value - estimateGrandTotal;
  const material = Math.max(500, Math.abs(contract.value) * 0.02);
  if (Math.abs(gap) <= material) return '';
  return `This contract figure comes off your saved pay application and sits ${wipMoney(Math.abs(gap))} `
    + `${gap > 0 ? 'ABOVE' : 'BELOW'} the ${wipMoney(estimateGrandTotal)} your estimate prices this job at. `
    + 'MAGE uses the pay application, because that is the sum you certified to the owner — but if the '
    + 'pay app was seeded from the wrong contract, every figure on this row is measured against it.';
}

/**
 * Your saved pay applications disagree with each other about the original
 * contract sum — disclosed, never acted on.
 *
 * `deriveOriginalContractWithSource` takes the sum off the LATEST certificate,
 * because that is the one most recently certified to the owner and the one the
 * owner is holding a copy of. It must not abandon the branch when an earlier
 * application disagrees: `seedAIAPayApplicationFromInvoice` re-derives
 * `originalContractSum` from the estimate as it stands on the day each
 * application is created, so two saved certificates disagree whenever the
 * estimate moved between them — an ordinary re-price, a committed change order.
 * An earlier pass here fell through to the estimate chain on exactly that, and
 * knocked $100,000 off a certified contract on a job with nothing wrong with it.
 *
 * What the disagreement IS is a reason to look at the G702s, so it is said in
 * words on the drill-in, the same way `contractVsEstimateNote` is.
 *
 * REVENUE on both sides. Returns '' unless two BILLABLE applications carrying a
 * contract sum differ by more than a dollar (rounding is not a disagreement).
 */
export function payAppContractHistoryNote(payApps: SavedAIAPayApp[]): string {
  const contractApps = wipBillablePayApps(payApps).filter(
    (a) => typeof a.originalContractSum === 'number' && a.originalContractSum > 0,
  );
  if (contractApps.length < 2) return '';
  const sums = contractApps.map((a) => a.originalContractSum);
  const lo = Math.min(...sums);
  const hi = Math.max(...sums);
  if (hi - lo <= 1) return '';
  const latest = contractApps.reduce((a, b) =>
    (b.applicationNumber ?? 0) >= (a.applicationNumber ?? 0) ? b : a);
  return `Your saved pay applications do not agree about the original contract sum — they range from `
    + `${wipMoney(lo)} to ${wipMoney(hi)}. MAGE uses ${wipMoney(latest.originalContractSum)}, off `
    + `application #${latest.applicationNumber ?? '?'}, because that is the sum most recently `
    + 'certified to the owner. A new application re-reads the contract sum off your estimate, so this '
    + 'usually just means the estimate moved between applications — but check the G702s before anyone '
    + 'underwrites this row.';
}

/**
 * One project's cost basis, in the words a GC uses with his banker.
 *
 * `costIncurred` is optional so a caller that genuinely does not know what the
 * job has cost (the PDF builder, working from a frozen snapshot row) omits it
 * rather than passing a 0 that would read as "nothing spent".
 */
export function describeCostBasis(cost: WipEstimatedCost, costIncurred?: number): string {
  // The GC's own forecast, which replaced all three derived candidates. No
  // overspend note: "you have spent more than the cost at completion" is
  // meaningless against a figure the reader just built out of what he has spent
  // plus what he says is left.
  if (cost.basis === 'entered') {
    const etc = Math.max(0, cost.value - cost.incurredFloor);
    return `Cost basis: YOUR cost to complete, ${wipMoney(etc)}, on top of the `
      + `${wipMoney(cost.incurredFloor)} this job has already cost — ${wipMoney(cost.value)} at `
      + 'completion. That is your forecast for this period, not a figure MAGE derived, and every '
      + 'percentage, earned-revenue and margin figure on this row is measured against it.';
  }
  if (cost.basis === 'none') {
    return 'Cost basis: nothing on file. Give this job an estimate with a cost line, or type its '
      + 'cost-to-date, before you hand these figures to anyone.';
  }
  if (cost.basis === 'commitments') {
    // The second clause is not decoration. This branch says the awarded subs
    // ARE the cost at completion, and a reader would take that as the whole
    // cost — but nothing self-performed and nothing bought outside a commitment
    // is in the figure, so on a self-perform-heavy job it is a floor, not a
    // forecast.
    return `Cost basis: signed subcontracts and POs, ${wipMoney(cost.committedFloor)} — already above `
      + `the ${wipMoney(cost.estimateBasis)} cost line in your estimate, so what you have awarded now `
      + 'sets the cost at completion. Work you self-perform, and anything bought outside a '
      + 'subcontract or PO, is not in that figure.' + overspentNote(cost.value, costIncurred);
  }
  if (cost.committedFloor > 0) {
    // NOT "is inside that figure" — MAGE cannot know that. Nothing ties a
    // commitment to the estimate line it fulfils (the job-cost engine's attempt
    // to, by matching a free-text phase against an item category, is what
    // printed a $42,200 double count in the first place). So this states the
    // CONVENTION and then states what it costs the reader if the convention is
    // wrong for his job, which is the only honest way to say it.
    return `Cost basis: your estimate's cost before markup, ${wipMoney(cost.estimateBasis)}. The `
      + `${wipMoney(cost.committedFloor)} you have signed in subcontracts and POs is read as work `
      + 'that estimate already prices, so it is not added on top of it. If any of it is scope your '
      + 'estimate never priced, this job will cost more than the figure above.'
      + overspentNote(cost.value, costIncurred);
  }
  return `Cost basis: your estimate's cost before markup, ${wipMoney(cost.estimateBasis)}. Nothing `
    + 'signed in subcontracts or POs against it yet.' + overspentNote(cost.value, costIncurred);
}

/**
 * The same sentence for a roll-up. Mixed portfolios say so and send the reader
 * to the per-project drill rather than picking one basis to speak for all of
 * them — which is the class of quiet averaging this whole wave is about.
 *
 * `costIncurred` is the portfolio's total cost-to-date (COST, money paid out —
 * not billings). Optional for the same reason as on describeCostBasis: a caller
 * that cannot see it must omit it rather than pass a 0 that reads as measured.
 */
export function describePortfolioCostBasis(
  costs: WipEstimatedCost[],
  costIncurred?: number,
): string {
  if (costs.length === 0) return '';
  if (costs.length === 1) return describeCostBasis(costs[0], costIncurred);

  const jobs = (n: number) => `${n} job${n === 1 ? '' : 's'}`;
  const onEstimate = costs.filter((c) => c.basis === 'estimate');
  const onCommitments = costs.filter((c) => c.basis === 'commitments');
  const onNothing = costs.filter((c) => c.basis === 'none');
  const onEntered = costs.filter((c) => c.basis === 'entered');
  const total = costs.reduce((sum, c) => sum + c.value, 0);
  // The roll-up's own overspend check. Per-project overspends can hide inside a
  // portfolio total, so this only fires when the BOOK is spent past its own
  // cost at completion — the per-project sentence in the drill-in catches the
  // rest.
  const overspent = overspentNote(total, costIncurred);

  if (onNothing.length === costs.length) {
    return `Cost basis: nothing on file for any of these ${jobs(costs.length)} — there is no cost for `
      + 'the margin below to be measured against.';
  }
  if (onEstimate.length === costs.length) {
    return `Cost basis: your estimates' cost before markup across ${jobs(costs.length)}, `
      + `${wipMoney(total)}. Signed subcontracts and POs are read as work those estimates already `
      + 'price, so they are not added on top.' + overspent;
  }
  if (onCommitments.length === costs.length) {
    return `Cost basis: signed subcontracts and POs on all ${jobs(costs.length)}, ${wipMoney(total)} — `
      + 'each already above the estimate\'s own cost line. Self-performed work is not in that figure.'
      + overspent;
  }
  if (onEntered.length === costs.length) {
    return `Cost basis: YOUR own cost to complete on all ${jobs(costs.length)}, ${wipMoney(total)} at `
      + 'completion. These are your forecasts for this period, not figures MAGE derived.';
  }
  const parts: string[] = [];
  if (onEntered.length > 0) parts.push(`your own cost to complete on ${jobs(onEntered.length)}`);
  if (onEstimate.length > 0) parts.push(`estimate cost on ${jobs(onEstimate.length)}`);
  if (onCommitments.length > 0) {
    parts.push(`signed commitments, already above estimate, on ${jobs(onCommitments.length)}`);
  }
  if (onNothing.length > 0) parts.push(`no cost on file for ${jobs(onNothing.length)}`);
  return `Cost basis: mixed — ${parts.join('; ')}. Total ${wipMoney(total)}. Open a project for its `
    + 'own source.' + overspent;
}

/**
 * Auto-suggested billed-to-date from a SINGLE source to avoid double counting:
 * a project bills via pay-apps OR invoices (a pay-app is itself the invoice).
 * Prefer pay-apps when any exist, else fall back to invoices.
 *
 * AIA billings are CUMULATIVE (G703 "Total Completed & Stored to Date"), so we
 * take the LATEST application's gross cumulative figure — NOT a sum of each
 * app's currentPaymentDue. currentPaymentDue is a per-period increment NET of
 * retainage; summing it telescopes to totalEarnedLessRetainage (billings minus
 * retainage held) AND silently depends on every historical app being saved.
 * Both failure modes understate billings and flip an overbilled job to
 * apparent underbilling on a bank/CPA-facing schedule. The invoices fallback
 * sums totalDue NET OF SALES TAX — gross of retainage, like the G703 figure,
 * but on the same tax-free contract basis (see `suggestBillingsWithSource`,
 * which owns the branch and the reason).
 *
 * DRAFTS ARE NOT BILLINGS (audit 2026-09-07, "Do next" #2 axis 1). This summed
 * every invoice regardless of status while utils/financialReports.ts — the
 * OTHER WIP schedule, one sidebar row away — already excluded them, so an
 * unsent draft inflated billed-to-date here and the two reports handed a bank
 * two different underbilling figures for the same job. The population is
 * `isWipBilling` above, so neither engine gets to hold its own opinion — and
 * as of 2026-09-11 the PAY-APP branch has a population too (`wipBillablePayApps`),
 * because that half had no status test at all and it is the branch that wins.
 */
export function suggestBilledToDate(
  invoices: Invoice[],
  payApps: SavedAIAPayApp[],
): number {
  return suggestBillingsWithSource(invoices, payApps).billedToDate;
}

/**
 * Retainage the OWNER is holding out of what has been billed — a receivable,
 * and the most illiquid asset a contractor owns.
 *
 * It is asked for by name on every surety submission, reported separately from
 * ordinary receivables, and until 2026-09-11 it appeared nowhere on the flagship
 * WIP schedule: not on screen, not in the CSV, not in the PDF. The /reports tab
 * had it and the document that actually leaves the building did not. It is also
 * the usual explanation for a COMPLETED job still showing underbilling, which
 * the schedule could not say because it did not hold the figure.
 *
 * Same branch as billed-to-date, deliberately — see `suggestBillingsWithSource`.
 */
export function suggestRetainageHeld(
  invoices: Invoice[],
  payApps: SavedAIAPayApp[],
): number {
  return suggestBillingsWithSource(invoices, payApps).retainageHeld;
}

/** Which billing population answered, and what it holds. */
export interface WipBillings {
  /** CONTRACT billings to date, gross of retainage, exclusive of sales tax. */
  billedToDate: number;
  /** Retainage still held out of those billings. A receivable, not revenue. */
  retainageHeld: number;
  /** 'pay_apps' | 'invoices' | 'none' — which half of the branch answered. */
  basis: 'pay_apps' | 'invoices' | 'none';
}

/**
 * Billed-to-date AND the retainage held inside it, from ONE branch decision.
 *
 * Two figures, one function, because they have to come off the same population:
 * billings from the pay applications and retainage from the invoices would
 * report a retainage a bank cannot reconcile to any billing on the page.
 *
 * SALES TAX IS NOT CONTRACT REVENUE (audit 2026-09-11). The invoice branch
 * summed `totalDue`, which is `subtotal + taxAmount` (app/invoice.tsx), while
 * the pay-app branch takes G703 "Total Completed and Stored to Date", which is
 * tax-free — and earned revenue is struck against a contract value derived from
 * estimate totals and pay-app contract sums, all of them tax-free. So in a
 * jurisdiction that taxes a contractor's sales the invoice branch reported
 * billings on a different basis from the contract they were compared against:
 * $300,000 of work at 8.25% read $324,750 billed, which understates underbilling
 * or flips an underbilled job to apparent overbilling.
 *
 * `subtotal` is the WORK VALUE, and it is deliberately the same field
 * utils/invoiceBilling.effectiveRetentionHeld measures retainage against — so
 * the billings and the retainage disclosed beside them come off one basis
 * rather than two. (Not `totalDue − taxAmount`, which is the same arithmetic
 * but is the shape scripts/validate-money-outstanding.ts forbids outside
 * invoiceBilling, for the good reason that gross-totalDue arithmetic scattered
 * across the app is how MONEY-F5 happened.) A legacy row that never stored a
 * subtotal falls back to `totalDue`: it is the only figure such a row has, and
 * `taxRate` defaults to 0, so on almost every real row the two are equal.
 *
 * RETAINAGE IS NOT NETTED OUT of either branch and that is deliberate: both are
 * GROSS of retainage (`pendingRetentionHeld` is disclosed beside them, not
 * subtracted), which keeps billed-to-date on the same basis as the cumulative
 * G703 figure it may be compared against.
 */
export function suggestBillingsWithSource(
  invoices: Invoice[],
  payApps: SavedAIAPayApp[],
): WipBillings {
  // DRAFT AND RECALLED PAY APPS ARE NOT BILLINGS. Axis 1 closed this for
  // invoices and left the PREFERRED branch untouched, so a G702 saved but never
  // sent — or recalled from the client — still set billed-to-date on both
  // schedules. See `wipBillablePayApps` for why "draft" needs a condition here
  // and does not on the invoice side.
  const billable = wipBillablePayApps(payApps);
  if (billable.length > 0) {
    const latest = billable.reduce((a, b) =>
      (b.applicationNumber ?? 0) >= (a.applicationNumber ?? 0) ? b : a);
    return {
      billedToDate: latest.totals?.totalCompletedAndStored ?? 0,
      // Cumulative retainage on the same certificate, so the two figures
      // reconcile to each other on the G703 the owner already holds.
      retainageHeld: latest.totals?.totalRetainage ?? 0,
      basis: 'pay_apps',
    };
  }
  const issued = invoices.filter(isWipBilling);
  if (issued.length === 0) {
    return { billedToDate: 0, retainageHeld: 0, basis: 'none' };
  }
  return {
    billedToDate: issued.reduce(
      (sum, i) => sum + (Number.isFinite(i.subtotal) ? i.subtotal : (i.totalDue ?? 0)),
      0,
    ),
    // MONEY-05's helper: retainage on the VALUE OF THE WORK, net of releases —
    // never the stored column, which on legacy rows was computed on the
    // tax-inclusive total.
    retainageHeld: issued.reduce((sum, i) => sum + pendingRetentionHeld(i), 0),
    basis: 'invoices',
  };
}

// Thresholds for the profit-fade watch. Exported so the screen can reference
// the same constants in copy/tooltips.
export const WIP_PROFIT_FADE_THRESHOLD = 0.02;         // 2 margin points
export const WIP_BILLING_SWING_THRESHOLD = 0.05;       // 5% of revised contract
export const WIP_SCHEDULE_DIVERGENCE_THRESHOLD = 0.10; // 10 percentage points

/**
 * Classify a WIP row against the prior locked period and (optionally) EVM
 * schedule-% for early over/under-billing detection.
 */
export function flagWipRow(
  row: WipRow,
  prev?: WipRow,
  evm?: { schedulePercent: number },
): WipFlags {
  const reasons: string[] = [];
  let profitFade = false;
  let billingSwing = false;
  let scheduleDivergence = false;

  if (prev && row.estGrossMarginPct < prev.estGrossMarginPct - WIP_PROFIT_FADE_THRESHOLD) {
    profitFade = true;
    const dropPts = (prev.estGrossMarginPct - row.estGrossMarginPct) * 100;
    reasons.push(`Gross margin faded ${dropPts.toFixed(1)} pts vs prior period`);
  }

  if (prev && row.revisedContract > 0) {
    const netNow = row.overbilling - row.underbilling;
    const netPrev = prev.overbilling - prev.underbilling;
    if (Math.abs(netNow - netPrev) > WIP_BILLING_SWING_THRESHOLD * row.revisedContract) {
      billingSwing = true;
      reasons.push('Large swing in over/under-billing vs prior period');
    }
  }

  if (evm && Math.abs(row.percentComplete - evm.schedulePercent) > WIP_SCHEDULE_DIVERGENCE_THRESHOLD) {
    scheduleDivergence = true;
    const costPct = (row.percentComplete * 100).toFixed(0);
    const schedPct = (evm.schedulePercent * 100).toFixed(0);
    reasons.push(`Cost %-complete (${costPct}%) diverges from schedule (${schedPct}%)`);
  }

  return { profitFade, billingSwing, scheduleDivergence, reasons };
}

/**
 * Immutability guard, mirroring the invoice-immutability precedent. A locked
 * period must not be edited — callers route the user to "create a new period".
 */
export function assertPeriodEditable(
  period: Pick<WipPeriod, 'lockedAt'>,
): { blocked: boolean; reason?: string } {
  if (period.lockedAt) {
    return { blocked: true, reason: 'This period is locked. Create a new period instead.' };
  }
  return { blocked: false };
}
