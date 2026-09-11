// utils/wip.ts — pure WIP (Work-In-Progress) schedule engine.
// NO React / React Native imports. Every function is deterministic and
// side-effect-free so scripts/validate-wip.ts can exercise it directly.
import type {
  WipRowInput, WipRow, WipPortfolio, WipSnapshotRow, WipFlags, WipPeriod,
  Commitment, Invoice, SavedAIAPayApp, ChangeOrder, Project, MaterialReceipt,
} from '@/types';

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

/** Clamp with NaN → lo, so divide-by-zero never leaks a NaN downstream. */
export function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** Turn explicit inputs into a fully computed WIP row. */
export function computeWipRow(input: WipRowInput): WipRow {
  const {
    originalContract, approvedChangeOrders, totalEstimatedCost,
    costToDate, billedToDate, percentCompleteOverride,
  } = input;

  const revisedContract = originalContract + approvedChangeOrders;

  const percentComplete = percentCompleteOverride != null
    ? clamp(percentCompleteOverride, 0, 1)
    : (totalEstimatedCost === 0 ? 0 : clamp(costToDate / totalEstimatedCost, 0, 1));

  const earnedRevenue = revisedContract * percentComplete;
  const overbilling = Math.max(0, billedToDate - earnedRevenue);
  const underbilling = Math.max(0, earnedRevenue - billedToDate);
  const estGrossProfit = revisedContract - totalEstimatedCost;
  const estGrossMarginPct = revisedContract === 0 ? 0 : estGrossProfit / revisedContract;
  const costToComplete = Math.max(0, totalEstimatedCost - costToDate);
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
    anticipatedLoss,
  };
}

/** Sum a set of snapshot rows into a portfolio roll-up with weighted margin. */
export function computeWipPortfolio(rows: WipSnapshotRow[]): WipPortfolio {
  const acc: WipPortfolio = {
    revisedContract: 0, totalEstimatedCost: 0, costToDate: 0, earnedRevenue: 0,
    billedToDate: 0, overbilling: 0, underbilling: 0, backlog: 0, weightedMarginPct: 0,
  };
  for (const r of rows) {
    acc.revisedContract += r.output.revisedContract;
    acc.totalEstimatedCost += r.input.totalEstimatedCost;
    acc.costToDate += r.input.costToDate;
    acc.earnedRevenue += r.output.earnedRevenue;
    acc.billedToDate += r.input.billedToDate;
    acc.overbilling += r.output.overbilling;
    acc.underbilling += r.output.underbilling;
    acc.backlog += r.output.backlog;
  }
  acc.weightedMarginPct = acc.revisedContract === 0
    ? 0
    : (acc.revisedContract - acc.totalEstimatedCost) / acc.revisedContract;
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
  pay_app_contract_sum: 'Original contract sum on a saved AIA pay application',
  estimate_grand_total: 'Linked estimate — grand total (priced)',
  change_order_snapshot: 'Reconstructed from a change order’s contract snapshot',
  target_budget: 'Target budget you entered in project setup',
  gmp_cap: 'GMP cap you entered in project setup',
  legacy_estimate_grand_total: 'Legacy estimate — grand total',
  estimate_base_total: 'Linked estimate — base total (cost before markup)',
  signed_commitments: 'Signed subcontracts and POs, including CO revisions',
  commitments_and_receipts:
    'Subs paid to date plus material receipts — self-performed labor NOT included, so this is a lower bound',
  none: 'No source on file — enter this figure yourself',
};

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
  const fromPayApp = payApps[0]?.originalContractSum;
  if (typeof fromPayApp === 'number' && fromPayApp > 0) {
    return { value: fromPayApp, source: 'pay_app_contract_sum' };
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
 * Estimated cost at completion (the WIP "Total Estimated Cost" input) — the
 * GC's COST budget, which MUST be sourced separately from the contract value
 * (revenue). Precedence:
 *   1. linkedEstimate.baseTotal — cost before markup (the true cost budget;
 *      grandTotal there is the PRICED figure and must not be used as cost).
 *   2. legacy project.estimate.grandTotal — no markup split exists, so this is
 *      the best-available cost estimate.
 *   3. Σ signed commitment amounts (subs + POs, incl. CO revisions).
 *   4. 0 — no cost basis recorded; the engine's zero-est guard yields 0%
 *      complete and the screen prompts manual entry (never silently wrong).
 * targetBudget / gmpCap are deliberately NOT used here — those are contract
 * (revenue) figures reserved for deriveOriginalContract.
 */
export function deriveEstimatedCost(
  project: Pick<Project, 'linkedEstimate' | 'estimate'> | null | undefined,
  commitments: Commitment[],
  /**
   * Approved change orders, so their COST can be added to the cost budget the
   * same way their REVENUE is added to revisedContract. Omit only when you
   * genuinely want the original-scope cost (e.g. a baseline comparison).
   */
  opts?: { approvedChangeOrders?: number; originalContract?: number },
): number {
  return deriveEstimatedCostWithSource(project, commitments, opts).value;
}

/** deriveEstimatedCost, plus which branch supplied the cost base. */
export function deriveEstimatedCostWithSource(
  project: Pick<Project, 'linkedEstimate' | 'estimate'> | null | undefined,
  commitments: Commitment[],
  opts?: { approvedChangeOrders?: number; originalContract?: number },
): WipDerived {
  // Which branch supplied the base matters: the commitments branch already
  // contains CO cost (c.changeAmount is the sub-side CO revision), so adding a
  // derived CO cost on top of it would DOUBLE COUNT. The estimate branches are
  // frozen at original scope and are the ones that need topping up.
  let base = 0;
  let baseIsOriginalScope = false;
  let source: WipSource = 'none';

  const fromEstimate = project?.linkedEstimate?.baseTotal;
  const fromLegacy = project?.estimate?.grandTotal;
  if (typeof fromEstimate === 'number' && fromEstimate > 0) {
    base = fromEstimate; baseIsOriginalScope = true; source = 'estimate_base_total';
  } else if (typeof fromLegacy === 'number' && fromLegacy > 0) {
    base = fromLegacy; baseIsOriginalScope = true; source = 'legacy_estimate_grand_total';
  } else {
    const committed = commitments.reduce(
      (sum, c) => sum + (c.amount ?? 0) + (c.changeAmount ?? 0), 0);
    if (committed > 0) { base = committed; source = 'signed_commitments'; } // already CO-inclusive
  }

  if (base === 0) return { value: 0, source: 'none' };
  if (!baseIsOriginalScope) return { value: base, source };

  const coRevenue = opts?.approvedChangeOrders ?? 0;
  if (coRevenue === 0) return { value: base, source };

  // THE BUG THIS CLOSES. computeWipRow does
  //     revisedContract = originalContract + approvedChangeOrders
  //     estGrossProfit  = revisedContract - totalEstimatedCost
  // so a change order that adds revenue while the cost budget stays frozen at
  // the original estimate books at ONE HUNDRED PERCENT MARGIN. A $500k job
  // carrying $100k of approved COs reported ~$100k of profit that does not
  // exist. percentComplete (costToDate / totalEstimatedCost) inflated too,
  // because costToDate DOES pick up CO-driven actuals through commitments and
  // material receipts — so earned revenue and underbilling inflated with it.
  //
  // A WIP schedule is the document a surety and a bank underwrite against.
  // Overstating profit on one is not a display bug.
  //
  // ChangeOrder carries no cost field — lineItems hold unitPrice/total, which
  // are PRICED figures — so CO cost cannot be read, only estimated. We apply
  // the job's own cost ratio, i.e. assume a CO carries the same margin as the
  // base contract. That is the standard WIP convention and it is far closer to
  // truth than assuming the CO is free to deliver.
  //
  // When there is no contract basis to derive a ratio from, fall back to a
  // 1.0 ratio — cost equals revenue, zero margin on the CO. That UNDERstates
  // profit, which is the correct direction to be wrong on a document a surety
  // reads. Never fall back to 0.
  const originalContract = opts?.originalContract ?? 0;
  const costRatio = originalContract > 0 ? base / originalContract : 1;
  return { value: base + coRevenue * costRatio, source };
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
 * sums totalDue (gross), keeping both billing sources on the same gross basis.
 *
 * DRAFTS ARE NOT BILLINGS (audit 2026-09-07, "Do next" #2 axis 1). This summed
 * every invoice regardless of status while utils/financialReports.ts — the
 * OTHER WIP schedule, one sidebar row away — already excluded them, so an
 * unsent draft inflated billed-to-date here and the two reports handed a bank
 * two different underbilling figures for the same job. The population is
 * `isWipBilling` above, so neither engine gets to hold its own opinion.
 */
export function suggestBilledToDate(
  invoices: Invoice[],
  payApps: SavedAIAPayApp[],
): number {
  if (payApps.length > 0) {
    const latest = payApps.reduce((a, b) =>
      (b.applicationNumber ?? 0) >= (a.applicationNumber ?? 0) ? b : a);
    return latest.totals?.totalCompletedAndStored ?? 0;
  }
  return invoices.filter(isWipBilling).reduce((sum, i) => sum + (i.totalDue ?? 0), 0);
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
