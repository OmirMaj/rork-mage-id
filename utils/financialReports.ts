// financialReports.ts — pure data computations behind the Reports hub.
//
// Three reports, all derived from the same project + invoices + commitments
// + change-orders inputs:
//
//   • WIP (work-in-progress) — bank-ready: contract, change-orders,
//     revised contract, % complete, billed, paid, retainage, EAC, profit.
//   • Profit-per-project — revenue (estimate + approved COs) minus
//     projected final cost (from the job-cost engine), running margin %.
//   • AR aging — open invoices bucketed by days-past-due (0-30, 31-60,
//     61-90, 90+). Uses dueDate vs today. Excludes DRAFTS (never sent, so
//     never owed) and anything fully collected. ("ignores closed/canceled",
//     which this line used to say, described statuses InvoiceStatus has never
//     had — and no filter of any kind was actually applied.)
//
// All amounts in USD. All return shapes are PURE so the screen can
// memoize them and the PDF builders can serialize them as-is.

import type { Project, Invoice, ChangeOrder, Commitment, SavedAIAPayApp } from '@/types';
import { computeJobCost, type JobCostActualSources } from './jobCostEngine';
import {
  deriveEstimatedCostWithSource, deriveOriginalContractWithSource,
  suggestBillingsWithSource, type WipEstimatedCost, type WipSource,
} from '@/utils/wip';
import { invoiceOutstanding, pendingRetentionHeld } from '@/utils/invoiceBilling';

// ─── WIP ─────────────────────────────────────────────────────────────

export interface WIPRow {
  projectId: string;
  projectName: string;
  contractValue: number;        // original signed contract (linked estimate grand total or estimate.grandTotal)
  approvedChangeOrders: number; // sum of approved CO change amounts
  revisedContract: number;      // contractValue + approvedChangeOrders
  percentComplete: number;      // 0–100, COST basis only (job actual ÷ EAC), exactly as utils/wip.ts does; 0 when no cost is recorded
  billedToDate: number;         // utils/wip.suggestBillingsWithSource — pay apps or issued invoices, tax-free
  /**
   * CASH collected against issued INVOICES. Tax-INCLUSIVE, unlike every other
   * money column on this row — see the note at the call site. Never feeds the
   * contract-basis arithmetic.
   */
  paidToDate: number;
  /**
   * EARNED REVENUE — revisedContract × percentComplete. Computed since
   * MONEY-F13 and rendered nowhere until 2026-09-11: without it a banker
   * cannot tie this schedule to an income statement, which is the first thing
   * he does with it.
   *
   * OPTIONAL for the same reason `costToDate` is — scripts/
   * validate-compose-week-close.ts builds synthetic WIPRows by hand — but
   * unlike cost-to-date it is DERIVABLE from two fields that are required, so
   * absence is not unknown: read it through `wipRowEarned` below, never with a
   * bare `?? 0`, which would print $0 earned on a half-built job.
   */
  earnedRevenue?: number;
  unbilled: number;             // earned - billed, ≥ 0 (UNDERbilling)
  /** billed - earned, ≥ 0 (the other side of it). Derivable — see `wipRowOverbilled`. */
  overbilled?: number;
  retainageHeld: number;        // retention still held out of the billings above
  estimatedFinalCost: number;   // utils/wip.deriveEstimatedCostWithSource — the ONE cost-at-completion
  /**
   * COST already paid out on this job (job-cost engine `actual`) — never a
   * billing. Carried so the screen can say when a job has already spent MORE
   * than the cost at completion above it, which the estimate-based definition
   * of that figure cannot show on its own. See utils/wip.describeCostBasis.
   *
   * OPTIONAL for the same reason `costAtCompletion` is: scripts/
   * validate-compose-week-close.ts builds synthetic WIPRows by hand. A reader
   * must treat "absent" as UNKNOWN, never as zero — a 0 here would read as
   * "nothing spent" and silence the overspend warning on exactly the job that
   * needs it. Every row this module produces carries it.
   */
  costToDate?: number;
  projectedProfit: number;      // revisedContract - estimatedFinalCost
  projectedMargin: number;      // projectedProfit / revisedContract * 100
  status: Project['status'];
  /**
   * Which branch of utils/wip.deriveOriginalContractWithSource produced
   * `contractValue`. Optional only because scripts/validate-compose-week-close.ts
   * builds synthetic WIPRows by hand; every row this module produces carries it.
   */
  contractSource?: WipSource;
  /**
   * Which cost basis produced `estimatedFinalCost`, so the screen and the PDF
   * can name it instead of printing an unexplained figure above an Export
   * button. OPTIONAL only because scripts/validate-compose-week-close.ts builds
   * synthetic WIPRows by hand; every row this module produces carries it.
   */
  costAtCompletion?: WipEstimatedCost;
}

export interface WIPReport {
  asOf: string;
  rows: WIPRow[];
  totals: {
    contractValue: number;
    approvedChangeOrders: number;
    revisedContract: number;
    billedToDate: number;
    paidToDate: number;
    earnedRevenue: number;
    unbilled: number;
    overbilled: number;
    retainageHeld: number;
    /** COST already paid out across the book — never a billing. */
    costToDate: number;
    estimatedFinalCost: number;
    projectedProfit: number;
    projectedMargin: number;
    /**
     * Sum of projected profit over jobs that HAVE a cost basis, and the count
     * and contract value of the jobs that do not (F14). `projectedMargin` above
     * is struck on the measurable subset; these three are what let an export
     * say so instead of suppressing the difference silently.
     */
    measurableProjectedProfit: number;
    noCostBasisCount: number;
    noCostBasisContract: number;
  };
}

/**
 * Earned revenue on one WIP row, derived when the row does not carry it.
 *
 * One function so the screen, the CSV and the PDF cannot end up printing three
 * earned-revenue figures for one job — which is the whole subject of this
 * module's parity work, one level down.
 */
export function wipRowEarned(r: WIPRow): number {
  return r.earnedRevenue ?? (r.revisedContract * r.percentComplete) / 100;
}

/** Overbilling on one WIP row — billed beyond earned, never negative. */
export function wipRowOverbilled(r: WIPRow): number {
  return r.overbilled ?? Math.max(0, r.billedToDate - wipRowEarned(r));
}

/**
 * Does this row have any cost basis at all?
 *
 * F14 (audit 2026-09-11). `deriveOriginalContract` falls back to a target
 * budget and then a GMP cap for REVENUE, while `deriveEstimatedCost`
 * deliberately excludes both — so a job set up with only a target budget (which
 * is what the portal budget-proposal flow creates, and the budget can be set by
 * the CLIENT) gets a contract and NO cost, and this row then reports
 * projectedProfit == the whole contract at a 100% margin. Measured: a $900,000
 * target-budget job returned projectedProfit $900,000 / projectedMargin 100.
 *
 * A contract with no cost basis has no measurable margin. The exports print an
 * empty cell for its profit and margin, the totals exclude it, and both name
 * the exclusion — the same rule utils/wip.wipRowHasCostBasis applies on the
 * flagship schedule, so the two documents agree about which jobs are
 * unmeasurable as well as about the jobs that are not.
 */
export function wipReportRowHasCostBasis(r: WIPRow): boolean {
  return r.estimatedFinalCost > 0 || (r.costToDate ?? 0) > 0;
}

/**
 * The same question for a Profit-tab row. Separate function only because
 * ProfitRow's cost-to-date is required where WIPRow's is optional; the RULE is
 * identical on purpose, so the two tabs of one screen agree about which jobs
 * are unmeasurable as well as about the ones that are not.
 */
export function profitRowHasCostBasis(r: Pick<ProfitRow, 'estimatedFinalCost' | 'costToDate'>): boolean {
  return r.estimatedFinalCost > 0 || (r.costToDate ?? 0) > 0;
}

/** Cost still to spend, or null when the row cannot say what it has cost. */
export function wipRowCostToComplete(r: WIPRow): number | null {
  return r.costToDate == null ? null : Math.max(0, r.estimatedFinalCost - r.costToDate);
}

// MONEY-DEF-1 (audit 2026-09-07): both reports below call the job-cost engine,
// and both used to call it with NO receipts and NO time entries — so their
// cost-to-date was subs-and-POs only, missing every dollar of materials and
// self-perform labor. On the WIP tab that lands in front of a bank; on the
// Profit report it prints a margin the job does not have. The screen already
// holds these (app/job-costing.tsx wires useMaterialReceipts / time entries /
// useLaborRates), so they are forwarded here rather than re-derived. Default
// `{}` keeps a caller that has not been wired yet compiling — and honest: it
// gets the same lower bound it got before, not a silently different number.
//
// `costSources` is spread WHOLE into the engine at both call sites, so it
// carries every field of JobCostActualSources — including the `equipment` and
// `permits` that MONEY-EQP-1 / MONEY-PMT-1 added after this was written. There
// is no per-field list here to fall behind the type: widening
// JobCostActualSources widens these reports the same day.
//
// HOW FAR THE GUARD ACTUALLY REACHES, measured rather than assumed (mutation-
// tested 2026-09-08). scripts/validate-money-definitions.ts regex-counts the
// engine calls in this file against the ones carrying a `...costSources`
// spread, so DELETING a spread fails it immediately, three assertions at once.
// What it does not catch is a spread that is kept and then overridden: append
// `, equipment: [], permits: []` after the spread at both call sites and the
// regex still matches, while every arithmetic assertion in that guard is built
// from receipts / timeEntries / laborRates alone — it passes 89/89 with
// machine time and permit fees silently deleted from a page a bank reads.
// validate-job-cost and validate-wip-parity pass on that mutation too.
//
// So the spread is protected against removal, not against narrowing. If you
// override a field of it, only review will stop you — do not read a green
// guard as permission. (That regex also counts occurrences in PROSE, which is
// why this paragraph talks around the call's name instead of quoting it.)
//
// WHICH MEANS THE UNDERSTATEMENT THAT REMAINS IS ENTIRELY AT THE CALL SITES.
// A caller that omits the argument gets subs-and-POs only, and the omission
// compiles silently because the parameter is optional and positional. app/
// reports.tsx was that caller on BOTH tabs until 2026-09-11 — and Profit is the
// tab every free and Pro user lands on, so the paragraph above ("an omitted
// argument paints a bleeding job green") described the shipped product. It is
// wired now, from the same hooks app/job-costing.tsx uses, and scripts/
// validate-money-basis-parity.ts pins the call sites so it cannot quietly come
// undone.
//
// THE ONE CALLER STILL PASSING NOTHING, DESCRIBED HONESTLY (adversarial review
// 2026-09-11). utils/portfolio/pipelineHorizon.ts:124 calls
// `computeWIPReport(projects, invoices, changeOrders, commitments)` — four
// arguments, so no cost sources, no pay applications and no cost-to-complete
// map. The earlier version of this paragraph said only that it omits
// `costSources`, which understated the blast radius badly: the CONTRACT basis
// and the BILLINGS basis both changed underneath it in the same pass.
// Measured on a target-budget-only job carrying one sent $300,000 + 8.25%
// invoice:
//     contract      0 (effectiveEstimateTotal) → 900,000 (target_budget)
//     billed  324,750 (invoice totalDue)       → 300,000 (subtotal, tax-free)
//     remainingToBill$   0                     → 600,000
// That is its headline figure moving by six hundred thousand dollars, with no
// test of its own and no disclosure. It is a forecasting surface rather than a
// bank document and it is not this wave's file, so it is HANDED OFF with those
// numbers rather than quietly accepted; scripts/validate-money-basis-parity.ts's
// call-site block is the pattern for wiring it.
//
// And it is not the only other WIP-row producer. hooks/useWeekClose.ts:163
// builds a `computeWipRow` by hand from `deriveOriginalContract`,
// `deriveEstimatedCost`, `suggestCostToDate` and `suggestBilledToDate` — so it
// inherits every change above, and it passes NEITHER the `costIncurred` floor
// NOR an `estimatedCostToComplete`. It is therefore a third answer to "cost at
// completion" on an overrun job. Also handed off.
export function computeWIPReport(
  projects: Project[],
  invoices: Invoice[],
  changeOrders: ChangeOrder[],
  commitments: Commitment[],
  costSources: JobCostActualSources = {},
  /**
   * SAVED AIA PAY APPLICATIONS — axis 6 (audit 2026-09-11).
   *
   * This report had no pay-app parameter AT ALL and billedToDate was
   * invoices-only, so a GC billing through MAGE's flagship AIA progress billing
   * read $350,000 billed on /wip-report and $0 here, in its CSV and in its PDF —
   * and therefore underbilling equal to the whole of earned revenue. A wrong
   * number on a bank document, on the feature the $29-vs-$99 pitch rests on.
   *
   * Defaulted to `[]` rather than made required so a caller that has not been
   * wired yet still compiles — but unlike `costSources`, an omission here is
   * PINNED: scripts/validate-wip-parity.ts asserts every production call site
   * passes it, because "optional parameter some callers pass" is the exact shape
   * that has split these two schedules twice already.
   */
  payApps: SavedAIAPayApp[] = [],
  /**
   * PER-PROJECT ESTIMATED COST TO COMPLETE — project id → cost still to spend.
   *
   * The input that stops an overrun job reporting 100% complete. It shipped on
   * 2026-09-11 reaching computeWipRow only, which is the /wip-report engine —
   * so a GC who entered "$180,000 left to spend" saw EAC $800,000 / 77.5% /
   * $426,250 earned / a $250,000 forecast loss there, and EAC $620,000 / 100% /
   * $550,000 earned / a $70,000 loss HERE, in this report's CSV and in its PDF.
   * Two bank-facing WIP schedules disagreeing about cost at completion, percent
   * complete, earned revenue and forecast profit on one job in one session is
   * the exact defect the parity work exists to close; putting the ETC one level
   * too low re-created it on a new axis.
   *
   * It is applied through the SHARED derivation (utils/wip.deriveEstimatedCost-
   * WithSource's `estimatedCostToComplete`), not re-implemented here, so the
   * two engines cannot round it differently or disagree about what a negative
   * value means. Both screens read one AsyncStorage map through
   * utils/wip.wipEtcStorageKey — see the note there about why the key's shape
   * is engine-side.
   *
   * Defaulted to `{}`: a caller that has not been wired gets the derived
   * forecast, exactly what it got before. app/reports.tsx IS wired, and
   * scripts/validate-wip-parity.ts pins both the call site and the cross-engine
   * agreement — the ETC axis was invisible to that guard until this landed
   * (`grep -c estimatedCostToComplete scripts/validate-wip-parity.ts` was 0
   * while the whole feature could be switched off with the guard still green).
   */
  costToCompleteByProject: Record<string, number> = {},
): WIPReport {
  const rows: WIPRow[] = [];
  for (const project of projects) {
    if (project.status === 'closed') continue;

    const projectCOs = changeOrders.filter(co => co.projectId === project.id && co.status === 'approved');
    const approvedChangeOrders = projectCOs.reduce((s, co) => s + co.changeAmount, 0);
    const projectPayApps = payApps.filter(a => a.projectId === project.id);
    // THE CONTRACT — ONE DEFINITION, SHARED WITH app/wip-report.tsx (axis 5,
    // audit 2026-09-11). This was `effectiveEstimateTotal(project)`, the linked
    // estimate's grandTotal and nothing else, while the other bank-facing WIP
    // schedule ran deriveOriginalContract's full chain. A job with a saved pay
    // application read $700,000 / 42.9% margin there and $550,000 / 27.3% here;
    // a job set up with only a target budget read $900,000 against $0. That is
    // the REVENUE side of a surety document, it was never one of the four axes
    // the parity work enumerated, and it is closed the same way every other axis
    // was: by deleting this file's second opinion.
    const contract = deriveOriginalContractWithSource(project, projectCOs, projectPayApps);
    const contractValue = contract.value;
    const revisedContract = contractValue + approvedChangeOrders;

    const projectInvoices = invoices.filter(inv => inv.projectId === project.id);
    // BILLED TO DATE AND RETAINAGE HELD — ONE DEFINITION, ONE BRANCH
    // (utils/wip.suggestBillingsWithSource). It decides pay-apps-or-invoices,
    // drops drafts and recalled applications, keeps both sources on the same
    // tax-free contract basis, and hands back the retainage sitting inside the
    // billings it chose. This file used to sum invoice `totalDue` itself, which
    // (a) could not see a pay application at all and (b) carried sales tax into
    // a figure compared against a tax-free contract.
    //
    // A draft is a document the client has never seen. Everything else — sent,
    // partially_paid, paid, overdue — has genuinely been billed.
    const billedInvoices = projectInvoices.filter(inv => inv.status !== 'draft');
    const billings = suggestBillingsWithSource(projectInvoices, projectPayApps);
    const billedToDate = billings.billedToDate;
    // PAID TO DATE IS CASH, AND IT IS ON A DIFFERENT BASIS FROM EVERYTHING ELSE
    // ON THIS ROW — stated rather than left implicit (money-wave handoff
    // 2026-09-11 §1). Two reasons, both deliberate:
    //
    //   • It is tax-INCLUSIVE. `amountPaid` is money that actually arrived, and
    //     the client paid the tax with it, while the contract, earned revenue
    //     and billed-to-date above are all pre-tax contract figures. It is
    //     therefore never used in the contract-basis arithmetic: percent
    //     complete, earned revenue and over/under billing derive from
    //     `billedToDate`, and nothing here derives from this. Grossing the
    //     contract up to meet it would corrupt a schedule to make one column
    //     comparable; the honest answer is that this column is collections.
    //   • It has no pay-app equivalent that is both cumulative and reliable, so
    //     it stays on the invoice population. On a pay-app-billed job it
    //     reports only what came in through invoices, which is what MAGE can
    //     actually see.
    //
    // The CSV and the PDF both label it as cash collected for that reason, and
    // the PDF's methodology block says where it lives.
    const paidToDate = billedInvoices.reduce((s, inv) => s + (inv.amountPaid || 0), 0);
    // MONEY-05: the withholding is the percentage of the work value, via the
    // shared helper — not the stored column, which on legacy rows is retainage
    // computed on the tax-inclusive total. A WIP report that held one figure
    // while the A/R aging on the same screen collected against another does not
    // foot for the banker reading both.
    const retainageHeld = billings.retainageHeld;

    const job = computeJobCost({ project, commitments, changeOrders, ...costSources });
    // COST AT COMPLETION — ONE DEFINITION, SHARED WITH app/wip-report.tsx
    // (polish audit 2026-09-10). This read `job.projectedFinal`, the job-cost
    // engine's per-phase EAC, while the other bank-facing WIP schedule read
    // utils/wip.deriveEstimatedCost. On the seeded job that was $173,702 here
    // and $131,502 there — "Projected profit -$18,530 / -11.9%" on one screen
    // and "Weighted margin 15%" on the other, same session, same project,
    // neither naming its basis, both offering a PDF for the bank.
    //
    // The engine's figure was not a second opinion, it was a double count: it
    // buckets the estimate by `item.category` ('subcontractor') and a
    // commitment by its free-text `phase` ('Electrical'), so awarding the two
    // subs the estimate had already priced added $42,200 on top of the
    // $131,502 that still priced them. Fixing that bucketing is worth doing
    // for /job-costing; it is not what makes these two reports foot. One
    // definition is, and this is the call site that adopts it.
    const projectCommitments = commitments.filter(c => c.projectId === project.id);
    const costAtCompletion = deriveEstimatedCostWithSource(project, projectCommitments, {
      approvedChangeOrders,
      // The ratio denominator is this report's own contract value, so the CO
      // cost top-up is derived from the same revenue figure the margin is
      // struck against rather than from a second contract basis.
      originalContract: contractValue,
      // COST already paid out. A job cannot finish for less than what it has
      // already cost, so this is the hard floor under the two forecasts — and
      // without it a job that has burned past its estimate reports the estimate
      // and a profit it has already spent its way out of.
      costIncurred: job.actual,
      // …and when the GC has said what is LEFT to spend, that replaces the
      // forecast entirely: EAC = cost to date + cost to complete. See the
      // parameter's doc above for what this being absent used to cost.
      estimatedCostToComplete: costToCompleteByProject[project.id],
    });
    const estimatedFinalCost = costAtCompletion.value;

    // MONEY-F13 (audit 2026-09-03): percent complete on a COST basis —
    // job actual ÷ estimate-at-completion — the same basis utils/wip.ts uses
    // (costToDate / totalEstimatedCost). The old basis was billed ÷ revised,
    // which makes earned ≡ billed, so the Unbilled column below was
    // identically zero: no input could make it non-zero, and a banker reading
    // it concluded the contractor was never underbilled.
    //
    // NO SCHEDULE FALLBACK (axis 7, audit 2026-09-11). Until then, a job with
    // no cost picture fell back to the AVERAGE TASK PROGRESS of its schedule —
    // so a job with two tasks at 40% and 60% and no cost recorded reported 50%
    // complete, $250,000 earned and $250,000 unbilled here while /wip-report
    // reported 0% and $0 for the same job. That is a THIRD percent-complete
    // basis, and it is schedule-basis revenue recognition on a document that
    // names itself cost-to-cost — on the account most likely to have it (a new
    // one, with a schedule built and no cost entered yet). Zero is the honest
    // answer: no cost recorded means percent complete is unmeasured, not
    // fifty. Schedule progress is still read on both screens, as the
    // divergence DIAGNOSTIC (utils/wip.flagWipRow's `evm` argument), which is
    // what it is good for.
    //
    // The denominator is the shared cost-at-completion above, not
    // job.projectedFinal: two schedules reporting different percent-complete
    // for one job is the same defect as reporting different margin, and this is
    // the axis-3 half of it.
    const percentComplete = estimatedFinalCost > 0 && job.actual > 0
      ? Math.min(100, Math.max(0, (job.actual / estimatedFinalCost) * 100))
      : 0;

    const earned = (revisedContract * percentComplete) / 100;
    const unbilled = Math.max(0, earned - billedToDate);
    const overbilled = Math.max(0, billedToDate - earned);

    const projectedProfit = revisedContract - estimatedFinalCost;
    const projectedMargin = revisedContract > 0 ? (projectedProfit / revisedContract) * 100 : 0;

    rows.push({
      projectId: project.id,
      projectName: project.name,
      contractValue,
      approvedChangeOrders,
      revisedContract,
      percentComplete,
      billedToDate,
      paidToDate,
      earnedRevenue: earned,
      unbilled,
      overbilled,
      retainageHeld,
      estimatedFinalCost,
      costToDate: job.actual,
      projectedProfit,
      projectedMargin,
      status: project.status,
      costAtCompletion,
      contractSource: contract.source,
    });
  }

  // Sort largest contract first — banks read top-down.
  rows.sort((a, b) => b.revisedContract - a.revisedContract);

  const totals = rows.reduce(
    (t, r) => ({
      contractValue:        t.contractValue + r.contractValue,
      approvedChangeOrders: t.approvedChangeOrders + r.approvedChangeOrders,
      revisedContract:      t.revisedContract + r.revisedContract,
      billedToDate:         t.billedToDate + r.billedToDate,
      paidToDate:           t.paidToDate + r.paidToDate,
      earnedRevenue:        t.earnedRevenue + wipRowEarned(r),
      unbilled:             t.unbilled + r.unbilled,
      overbilled:           t.overbilled + wipRowOverbilled(r),
      retainageHeld:        t.retainageHeld + r.retainageHeld,
      // `costToDate` is optional on the row (hand-built rows exist), and absent
      // means UNKNOWN. Adding 0 for such a row would understate the book's
      // spend; every row this module produces carries it, so in practice this
      // sums the whole book and the `?? 0` is the honest floor for the rest.
      costToDate:           t.costToDate + (r.costToDate ?? 0),
      estimatedFinalCost:   t.estimatedFinalCost + r.estimatedFinalCost,
      projectedProfit:      t.projectedProfit + r.projectedProfit,
      projectedMargin:      0, // computed below
      measurableProjectedProfit: 0, // computed below
      noCostBasisCount:     0, // computed below
      noCostBasisContract:  0, // computed below
    }),
    {
      contractValue: 0, approvedChangeOrders: 0, revisedContract: 0,
      billedToDate: 0, paidToDate: 0, earnedRevenue: 0, unbilled: 0, overbilled: 0,
      retainageHeld: 0, costToDate: 0,
      estimatedFinalCost: 0, projectedProfit: 0, projectedMargin: 0,
      measurableProjectedProfit: 0, noCostBasisCount: 0, noCostBasisContract: 0,
    },
  );
  // THE PORTFOLIO MARGIN RUNS OVER MEASURABLE JOBS ONLY (F14). The column
  // totals above still sum the whole book — a WIP total row does — but the
  // RATIO is what a costless job corrupts, by putting its contract in the
  // numerator and nothing in the denominator. `projectedProfit` in the totals
  // is left summing everything for the same reason `revisedContract` is, and
  // the exports print the measurable subtotal beside the count of what is out.
  const measurable = rows.filter(wipReportRowHasCostBasis);
  const measurableContract = measurable.reduce((sum, r) => sum + r.revisedContract, 0);
  const measurableProfit = measurable.reduce((sum, r) => sum + r.projectedProfit, 0);
  totals.projectedMargin = measurableContract > 0
    ? (measurableProfit / measurableContract) * 100
    : 0;
  totals.measurableProjectedProfit = measurableProfit;
  totals.noCostBasisCount = rows.length - measurable.length;
  totals.noCostBasisContract = totals.revisedContract - measurableContract;

  return { asOf: new Date().toISOString(), rows, totals };
}

// ─── Profit per project ──────────────────────────────────────────────

export interface ProfitRow {
  projectId: string;
  projectName: string;
  status: Project['status'];
  revenue: number;             // revised contract
  costToDate: number;          // job-cost actual
  estimatedFinalCost: number;  // utils/wip.deriveEstimatedCostWithSource — same basis as WIP
  projectedProfit: number;
  projectedMargin: number;     // %
  health: 'green' | 'yellow' | 'red';
  /** Which cost basis produced `estimatedFinalCost`. See WIPRow.costAtCompletion. */
  costAtCompletion?: WipEstimatedCost;
}

/**
 * Revenue minus projected final cost, per project.
 *
 * `costSources` carries the same contract as computeWIPReport above and is
 * spread whole into the engine: pass it and `costToDate` is the engine's full
 * ACTUAL (commitment payments + material receipts + priced crew hours +
 * equipment days + permit fees); omit it and every one of those but the
 * commitment payments is missing, which shows as margin the job has not
 * earned. The health chip is derived from that margin, so an omitted argument
 * paints a bleeding job green.
 */
export function computeProfitReport(
  projects: Project[],
  invoices: Invoice[],
  changeOrders: ChangeOrder[],
  commitments: Commitment[],
  costSources: JobCostActualSources = {},
  /** Same contract chain as the WIP tab needs them for — see computeWIPReport. */
  payApps: SavedAIAPayApp[] = [],
  /** Same cost-to-complete map, same reason — see computeWIPReport. */
  costToCompleteByProject: Record<string, number> = {},
): {
  rows: ProfitRow[];
  totalRevenue: number;
  totalProfit: number;
  weightedMargin: number;
  measurableRevenue: number;
  noCostBasisCount: number;
  noCostBasisRevenue: number;
} {
  const rows: ProfitRow[] = [];
  for (const project of projects) {
    const projectCOs = changeOrders.filter(co => co.projectId === project.id && co.status === 'approved');
    const approvedCOs = projectCOs.reduce((s, co) => s + co.changeAmount, 0);
    // The same one contract definition the WIP tab uses (axis 5). Two tabs of
    // ONE screen reporting different revenue for one job is the same defect as
    // two screens doing it, and this is the tab every sub-Business user lands
    // on by default.
    const contractValue = deriveOriginalContractWithSource(
      project, projectCOs, payApps.filter(a => a.projectId === project.id),
    ).value;
    const revenue = contractValue + approvedCOs;

    const job = computeJobCost({ project, commitments, changeOrders, ...costSources });
    // Same one cost-at-completion the WIP tab now uses — and this tab is the
    // one that matters most, because app/reports.tsx lands every sub-Business
    // user straight on it. A free trialist who bought out two subs was being
    // shown "Projected profit -$18,530" on a job carrying $23,670 of margin.
    const projectCommitments = commitments.filter(c => c.projectId === project.id);
    const costAtCompletion = deriveEstimatedCostWithSource(project, projectCommitments, {
      approvedChangeOrders: approvedCOs,
      originalContract: contractValue,
      // See the sibling call site: cost already paid out is the hard floor, and
      // an entered cost to complete replaces the forecast outright. The Profit
      // tab is the one every free and Pro user lands on, so a margin here that
      // ignores the GC's own revised forecast is the version of this defect
      // most users would actually meet.
      costIncurred: job.actual,
      estimatedCostToComplete: costToCompleteByProject[project.id],
    });
    const estimatedFinalCost = costAtCompletion.value;
    const projectedProfit = revenue - estimatedFinalCost;
    const projectedMargin = revenue > 0 ? (projectedProfit / revenue) * 100 : 0;

    let health: 'green' | 'yellow' | 'red';
    if (projectedMargin >= 12)      health = 'green';
    else if (projectedMargin >= 5)  health = 'yellow';
    else                            health = 'red';

    rows.push({
      projectId: project.id,
      projectName: project.name,
      status: project.status,
      revenue,
      costToDate: job.actual,
      estimatedFinalCost,
      projectedProfit,
      projectedMargin,
      health,
      costAtCompletion,
    });
  }

  rows.sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);

  // THE SAME NO-COST-BASIS EXCLUSION THE WIP TAB APPLIES (F14, adversarial
  // review 2026-09-11 — this tab was missed on the first pass).
  //
  // `deriveOriginalContract` falls back to a target budget and then a GMP cap
  // for REVENUE; `deriveEstimatedCost` deliberately excludes both. So a job set
  // up with only a target budget — which the portal budget-proposal flow
  // creates, and the budget can be set by the CLIENT — carries a contract and
  // no cost, and reported its entire contract as profit at a 100% margin
  // straight into this roll-up. Measured on a $1,000,000/$800,000 job beside a
  // $900,000 target-budget job: totalProfit $1,100,000 at a 57.9% weighted
  // margin, against the $200,000 / 20% the WIP tab one chip away was already
  // printing. Three surfaces, three answers for one book.
  //
  // This is the tab every free and Pro user lands on by default (the WIP tab is
  // Business-gated), so it is the version of the defect most users would meet.
  const measurable = rows.filter(profitRowHasCostBasis);
  const measurableRevenue = measurable.reduce((s, r) => s + r.revenue, 0);
  // `totalProfit` is the MEASURABLE sum, not the whole book: unlike the WIP
  // schedule there is no column total here for a reader to cross-foot against,
  // and this figure is rendered as the portfolio headline directly above the
  // margin — so the two have to be struck on the same population or the screen
  // contradicts itself in two adjacent lines.
  const totalProfit  = measurable.reduce((s, r) => s + r.projectedProfit, 0);
  const weightedMargin = measurableRevenue > 0 ? (totalProfit / measurableRevenue) * 100 : 0;

  return {
    rows,
    totalRevenue,
    totalProfit,
    weightedMargin,
    /** Revenue the headline profit and margin above were actually measured on. */
    measurableRevenue,
    /** How many rows carry a contract with no cost basis at all, and their revenue. */
    noCostBasisCount: rows.length - measurable.length,
    noCostBasisRevenue: totalRevenue - measurableRevenue,
  };
}

// ─── AR aging ────────────────────────────────────────────────────────

export type AgingBucket = '0-30' | '31-60' | '61-90' | '90+';

export interface ARAgingRow {
  invoiceId: string;
  invoiceNumber: number;
  projectId: string;
  projectName: string;
  issueDate: string;
  dueDate: string;
  totalDue: number;
  amountPaid: number;
  /** Retention still held on the invoice — not due, so not aged (MONEY-F5). */
  retainageHeld: number;
  /** Collectible today: totalDue − retainageHeld − amountPaid, never negative. */
  outstanding: number;
  daysPastDue: number;
  bucket: AgingBucket | 'current';
  status: Invoice['status'];
}

export interface ARAgingReport {
  asOf: string;
  rows: ARAgingRow[];
  totals: {
    current: number;
    '0-30': number;
    '31-60': number;
    '61-90': number;
    '90+': number;
    totalOutstanding: number;
    /** Retention still held across the listed invoices — a receivable, not aged. */
    retainageHeld: number;
  };
}

export function computeARAgingReport(
  invoices: Invoice[],
  projects: Project[],
): ARAgingReport {
  const projectName = new Map(projects.map(p => [p.id, p.name]));
  const now = Date.now();
  const DAY = 86_400_000;

  const rows: ARAgingRow[] = [];
  for (const inv of invoices) {
    // DRAFTS ARE NOT RECEIVABLES. A draft is a document the client has never
    // seen: nobody owes it, so it cannot be outstanding and it cannot be past
    // due. This loop had NO status filter at all — and the comment that used to
    // sit here claimed it skipped "canceled", a status `InvoiceStatus` does not
    // even have (draft | sent | partially_paid | paid | overdue). So a $40K
    // invoice staged by Bill-from-Estimate and never sent showed up as
    // OUTSTANDING in danger red, aged into the 31-60 past-due bucket, and rode
    // out on the exported CSV/PDF — while the WIP tab of the same Reports
    // screen (computeWIPReport above, whose `billedInvoices` does exclude
    // drafts) reported nothing billed. Two tabs of one screen contradicting
    // each other, with the collections number overstated by every staged draft.
    //
    // Same population as WIP billings, deliberately: sent / partially_paid /
    // paid / overdue have genuinely been billed; draft has not.
    if (inv.status === 'draft') continue;
    // MONEY-F5: outstanding is NET of the retention the contract lets the
    // client hold (utils/invoiceBilling.invoiceOutstanding). Aging held
    // retention as "past due" told the bank a client was late on money that
    // is not due until closeout. Skip anything already collected (half-dollar
    // floor absorbs rounding on split payments).
    const outstanding = invoiceOutstanding(inv);
    // MONEY-05: same helper invoiceOutstanding nets out, so the aged balance and
    // the Retainage Held column are two halves of one total_due.
    const retainageHeld = pendingRetentionHeld(inv);
    // Nothing collectible AND nothing held → fully collected, no receivable.
    // A settled invoice that still HOLDS retainage stays on the report as a
    // zero-current row: the $10,000 the client keeps until closeout is a
    // receivable the bank needs to see (review of B3a, 2026-09-05) — disclosed
    // under Retainage Held, never aged, never in a bucket.
    if (outstanding <= 0.5 && retainageHeld <= 0.5) continue;

    const dueMs = new Date(inv.dueDate).getTime();
    // Only a collectible balance ages; held retainage is not past due.
    const daysPastDue = outstanding <= 0.5 || isNaN(dueMs) ? 0 : Math.max(0, Math.floor((now - dueMs) / DAY));

    let bucket: AgingBucket | 'current';
    if (daysPastDue === 0)        bucket = 'current';
    else if (daysPastDue <= 30)   bucket = '0-30';
    else if (daysPastDue <= 60)   bucket = '31-60';
    else if (daysPastDue <= 90)   bucket = '61-90';
    else                          bucket = '90+';

    rows.push({
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      projectId: inv.projectId,
      projectName: projectName.get(inv.projectId) ?? '—',
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      totalDue: inv.totalDue || 0,
      amountPaid: inv.amountPaid || 0,
      retainageHeld,
      outstanding,
      daysPastDue,
      bucket,
      status: inv.status,
    });
  }

  // Worst-aged first.
  rows.sort((a, b) => b.daysPastDue - a.daysPastDue);

  const totals = {
    current: 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0,
    totalOutstanding: 0,
    retainageHeld: 0,
  };
  for (const r of rows) {
    if (r.bucket === 'current') totals.current += r.outstanding;
    else totals[r.bucket] += r.outstanding;
    totals.totalOutstanding += r.outstanding;
    totals.retainageHeld += r.retainageHeld;
  }

  return { asOf: new Date().toISOString(), rows, totals };
}

// ─── CSV helpers ─────────────────────────────────────────────────────

function csvEscape(s: string | number | null | undefined): string {
  const v = s == null ? '' : String(s);
  // Wrap in quotes if it contains a comma, quote, or newline; double up internal quotes.
  if (/[,"\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function wipReportToCSV(report: WIPReport): string {
  // COST TO DATE, EARNED REVENUE AND OVER-BILLING WERE MISSING (audit
  // 2026-09-11). `unbilled` was already here; its counterpart was not, and
  // neither were the two columns an underwriter reads to tie a WIP schedule to
  // an income statement. All three were computed and dropped on the floor.
  const headers = [
    'Project', 'Status',
    'Contract', 'Approved COs', 'Revised Contract',
    'Cost to Date', 'Estimated Final Cost', 'Cost to Complete', '% Complete',
    'Earned Revenue', 'Billed to Date', 'Cash Collected (incl. tax)',
    'Overbilled', 'Underbilled', 'Retainage Held',
    'Projected Profit', 'Projected Margin %',
  ];
  const rows = report.rows.map(r => [
    r.projectName, r.status,
    r.contractValue.toFixed(2), r.approvedChangeOrders.toFixed(2), r.revisedContract.toFixed(2),
    // A row that cannot say what it cost prints nothing, not 0 — see the
    // `costToDate?` field doc. An empty cell is UNKNOWN; a 0 asserts the job
    // has cost nothing, and a CPA would total it as such.
    r.costToDate == null ? '' : r.costToDate.toFixed(2),
    r.estimatedFinalCost.toFixed(2),
    wipRowCostToComplete(r)?.toFixed(2) ?? '',
    r.percentComplete.toFixed(1),
    wipRowEarned(r).toFixed(2), r.billedToDate.toFixed(2), r.paidToDate.toFixed(2),
    wipRowOverbilled(r).toFixed(2), r.unbilled.toFixed(2), r.retainageHeld.toFixed(2),
    // Blank, never a number: a contract with no cost basis has no measurable
    // profit and no margin, and 100% on a bank document is the worst possible
    // place for a fabricated one (F14). Same rule as the Cost to Date cell
    // above — an empty cell is UNMEASURABLE, a figure is a claim.
    wipReportRowHasCostBasis(r) ? r.projectedProfit.toFixed(2) : '',
    wipReportRowHasCostBasis(r) ? r.projectedMargin.toFixed(1) : '',
  ]);
  const totals = [
    'TOTAL', '',
    report.totals.contractValue.toFixed(2),
    report.totals.approvedChangeOrders.toFixed(2),
    report.totals.revisedContract.toFixed(2),
    report.totals.costToDate.toFixed(2),
    report.totals.estimatedFinalCost.toFixed(2),
    Math.max(0, report.totals.estimatedFinalCost - report.totals.costToDate).toFixed(2),
    '',
    report.totals.earnedRevenue.toFixed(2),
    report.totals.billedToDate.toFixed(2),
    report.totals.paidToDate.toFixed(2),
    report.totals.overbilled.toFixed(2),
    report.totals.unbilled.toFixed(2),
    report.totals.retainageHeld.toFixed(2),
    // Sum over MEASURABLE jobs, matching the cells above and the margin beside it.
    report.totals.measurableProjectedProfit.toFixed(2),
    report.totals.projectedMargin.toFixed(1),
  ];
  const out = [headers, ...rows, totals];
  // THE LINE THAT MAKES THE TOTAL ROW FOOT. Revised Contract − Estimated Final
  // Cost should equal Projected Profit on a total line, and it cannot whenever
  // a job has no cost basis: the contract column sums the whole book (a WIP
  // total row does) while Projected Profit is struck on the measurable subset.
  // Measured: 1,900,000 − 800,000 = 1,100,000 beside a Projected Profit cell
  // reading 200,000. Neither half is wrong, so the reconciling line is printed.
  // Same line, same reason, as utils/wipExport.wipPeriodToCSV.
  if (report.totals.noCostBasisCount > 0) {
    const measurableRows = report.rows.filter(wipReportRowHasCostBasis);
    const mContract = measurableRows.reduce((sum, r) => sum + r.revisedContract, 0);
    const mCost = measurableRows.reduce((sum, r) => sum + r.estimatedFinalCost, 0);
    const sub = new Array(headers.length).fill('');
    sub[0] = `MEASURABLE SUBTOTAL (${measurableRows.length} of ${report.rows.length} projects)`;
    sub[headers.indexOf('Revised Contract')] = mContract.toFixed(2);
    sub[headers.indexOf('Estimated Final Cost')] = mCost.toFixed(2);
    sub[headers.indexOf('Projected Profit')] = (mContract - mCost).toFixed(2);
    out.push(sub);
  }
  if (report.totals.noCostBasisCount > 0) {
    // Suppressing a figure without saying it was suppressed is its own quiet
    // lie, and this line is what stops the TOTAL above reading as the whole
    // book.
    const memo = new Array(headers.length).fill('');
    memo[0] = `NO COST BASIS — ${report.totals.noCostBasisCount} contract`
      + `${report.totals.noCostBasisCount === 1 ? ' carries' : 's carry'} a contract value with no cost `
      + `estimate, no signed commitment and nothing spent. ${report.totals.noCostBasisCount === 1 ? 'It is' : 'They are'} EXCLUDED from the projected `
      + 'profit total and the margin above, because a contract with no cost basis has no '
      + 'measurable margin.';
    memo[headers.indexOf('Revised Contract')] = report.totals.noCostBasisContract.toFixed(2);
    out.push(memo);
  }
  return out.map(r => r.map(csvEscape).join(',')).join('\n');
}

export function arAgingReportToCSV(report: ARAgingReport): string {
  // MONEY-F5: Total Due − Paid − Retainage Held = Outstanding, so the CSV foots
  // for the banker who reads it (held retention is disclosed, not aged).
  const headers = [
    'Project', 'Invoice #', 'Issue Date', 'Due Date',
    'Total Due', 'Paid', 'Retainage Held', 'Outstanding', 'Days Past Due', 'Bucket', 'Status',
  ];
  const rows = report.rows.map(r => [
    r.projectName, r.invoiceNumber, r.issueDate, r.dueDate,
    r.totalDue.toFixed(2), r.amountPaid.toFixed(2), r.retainageHeld.toFixed(2), r.outstanding.toFixed(2),
    r.daysPastDue, r.bucket, r.status,
  ]);
  // A TOTAL line that foots the same way, so the held retainage the report
  // discloses is also visible as one number.
  const sumTotalDue = report.rows.reduce((s, r) => s + r.totalDue, 0);
  const sumPaid = report.rows.reduce((s, r) => s + r.amountPaid, 0);
  const totals = [
    'TOTAL', '', '', '',
    sumTotalDue.toFixed(2), sumPaid.toFixed(2), report.totals.retainageHeld.toFixed(2), report.totals.totalOutstanding.toFixed(2),
    '', '', '',
  ];
  return [headers, ...rows, totals].map(r => r.map(csvEscape).join(',')).join('\n');
}

/**
 * The DOCUMENT a report CSV arrives as: the file name in the bookkeeper's inbox
 * and the title on the share sheet that hands it over.
 *
 * IT TRAVELS AS ONE NAMED OBJECT, and that is the whole point of it existing.
 * `shareReportCsv(fileName, csv, dialogTitle)` was three same-typed positional
 * strings, and the verifier (2026-09-11) transposed two of them at the call site
 * with all four WIP validators still at 100%: the guards checked that the two
 * file-name templates appeared in the handler and that the share call came
 * before the clipboard call, and neither of those can see argument order. The
 * shipped attachment would have been named "WIP Schedule 2026-08-31", with no
 * .csv extension — the one thing the fix exists to get right, because an
 * extensionless attachment is not a file a bookkeeper's Excel will open.
 *
 * Producing the pair here makes the transposition unexpressible at the call
 * site rather than merely guarded, and it is executable, so the extension and
 * the date can be asserted as VALUES (scripts/validate-wip.ts).
 */
export interface ReportCsvDocument {
  /** What the file is called once it lands. Always carries the .csv extension. */
  fileName: string;
  /** What the share sheet calls it. Human-readable, no extension. */
  dialogTitle: string;
}

/**
 * `asOf` is an ISO timestamp; the DATE half of it is the document's identity —
 * a WIP schedule and an A/R aging are both "as of" a day, not a moment.
 */
export function reportCsvDocument(kind: 'wip' | 'aging', asOf: string): ReportCsvDocument {
  const asOfDay = asOf.slice(0, 10);
  return kind === 'wip'
    ? { fileName: `wip-schedule-${asOfDay}.csv`, dialogTitle: `WIP Schedule ${asOfDay}` }
    : { fileName: `ar-aging-${asOfDay}.csv`, dialogTitle: `A/R Aging ${asOfDay}` };
}
