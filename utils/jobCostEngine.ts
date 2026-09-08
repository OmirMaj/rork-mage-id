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
} from '@/types';
import {
  isEligibleLaborEntry, normalizeTradeKey, priceLaborEntry, DEFAULT_OVERTIME_MULTIPLIER,
  type LaborRateMap,
} from '@/utils/laborSamples';

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
 * Pick a phase bucket for a commitment. We prefer an explicit `phase`,
 * fall back to `csiDivision`, and last resort uncategorized.
 */
function commitmentPhase(c: Commitment): string {
  if (c.phase && c.phase.trim()) return c.phase.trim();
  if (c.csiDivision && c.csiDivision.trim()) return c.csiDivision.trim();
  return PHASE_UNCATEGORIZED;
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
  Pick<JobCostInput, 'receipts' | 'timeEntries' | 'laborRates' | 'overtimeMultiplier' | 'equipment' | 'permits'>;

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
}: JobCostInput): JobCostSummary {
  const projectCommitments = commitments.filter(c => c.projectId === project.id && c.status !== 'draft');
  const projectCOs = changeOrders.filter(co => co.projectId === project.id && co.status === 'approved');
  const projectReceipts = receipts.filter(r => r.projectId === project.id);

  const estimate = project.linkedEstimate ?? null;
  const phases = new Map<string, JobCostLine>();
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
    directActual.set(phase, (directActual.get(phase) ?? 0) + amount);
  };

  // Seed from estimate items — every category that exists in the budget
  // gets a line, even if no commitments / invoices landed on it yet. This
  // keeps the "$0 committed against $50K budget" visible early.
  if (estimate) {
    for (const item of estimate.items) {
      const phase = item.category?.trim() || PHASE_UNCATEGORIZED;
      const existing = phases.get(phase) ?? emptyLine(phase);
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
      phases.set(phase, existing);
    }
  } else if (project.estimate) {
    // Legacy estimate — one catch-all bucket.
    //
    // grandTotal stays here deliberately. EstimateBreakdown (types/index.ts:66)
    // has no markup or profit line at all — materials, labor, permits,
    // overhead, contingency, tax — so its grandTotal is cost + tax, not
    // cost + margin. There is no markup to strip, and it is the same call
    // utils/wip.deriveEstimatedCost makes for the legacy shape.
    phases.set('Budget', {
      ...emptyLine('Budget'),
      budget: project.estimate.grandTotal,
    });
  }

  // Change orders bump budget at the phase level. COs don't carry phase
  // data directly either — we use the CO description as a best-effort tag
  // and, if it doesn't map to an existing phase, we drop it into a
  // 'Change Orders' bucket so PMs can see the new work.
  for (const co of projectCOs) {
    const phaseKey = co.description?.trim() || 'Change Orders';
    const match = phases.has(phaseKey) ? phaseKey : 'Change Orders';
    const existing = phases.get(match) ?? emptyLine(match);
    existing.budget += co.changeAmount;
    existing.sources.changeOrders.push(co.id);
    phases.set(match, existing);
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
    const phase = commitmentPhase(c);
    const existing = phases.get(phase) ?? emptyLine(phase);
    existing.committed += c.amount + (c.changeAmount ?? 0);
    existing.actual += Math.max(0, c.paidToDate ?? 0);
    existing.sources.commitments.push(c.id);
    phases.set(phase, existing);
  }

  // Material receipts — snapped supplier invoices count as ACTUAL material
  // spend. A receipt linked to a PO commitment lands in that commitment's
  // phase (the whole receipt); an unlinked receipt is split per line by the
  // line's category → phase, so material cost shows up against the right scope.
  for (const r of projectReceipts) {
    const linked = r.commitmentId ? projectCommitments.find(c => c.id === r.commitmentId) : undefined;
    if (linked) {
      const phase = commitmentPhase(linked);
      const existing = phases.get(phase) ?? emptyLine(phase);
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
      phases.set(phase, existing);
    } else {
      for (const line of r.lines) {
        const cat = (line.category || '').trim();
        const phase = cat && phases.has(cat) ? cat : (cat || PHASE_UNCATEGORIZED);
        const existing = phases.get(phase) ?? emptyLine(phase);
        existing.actual += line.lineTotal || 0;
        addDirect(phase, line.lineTotal || 0);
        // One receipt splitting across three categories names itself on all
        // three phase lines — the drill-down has to be able to open it from any
        // of them. Within ONE line the same id can land twice (two lumber lines
        // in the same category); the finalize pass below dedupes, so the count
        // the sheet shows is receipts, not receipt-lines.
        existing.sources.receipts.push(r.id);
        phases.set(phase, existing);
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
      const existing = phases.get(phase) ?? emptyLine(phase);
      existing.actual += laborActual;
      addDirect(phase, laborActual);
      existing.sources.timeEntries.push(...countedIds);
      phases.set(phase, existing);
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
    const existing = phases.get(PHASE_EQUIPMENT) ?? emptyLine(PHASE_EQUIPMENT);
    existing.actual += cost;
    addDirect(PHASE_EQUIPMENT, cost);
    existing.sources.equipment.push(...rows.map(u => u.id));
    phases.set(PHASE_EQUIPMENT, existing);
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
    const existing = phases.get(PHASE_PERMITS) ?? emptyLine(PHASE_PERMITS);
    existing.actual += fee;
    addDirect(PHASE_PERMITS, fee);
    existing.sources.permits.push(p.id);
    phases.set(PHASE_PERMITS, existing);
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
      if (linkedTotal > 0 && (c.amount + (c.changeAmount ?? 0)) > linkedTotal * 1.02) {
        overcommitted.push(c);
      }
    }
  }

  // Finalize each phase — compute projectedFinal + variance + status.
  const byPhase: JobCostLine[] = [];
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
    const direct = Math.min(actual, Math.max(0, directActual.get(line.phase) ?? 0));
    const againstCommitment = actual - direct;
    const remainingCommitted = Math.max(0, committed - againstCommitment);
    const uncommittedRemainder = Math.max(0, budget - committed - direct);
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

  // Totals.
  const totalBudget = byPhase.reduce((s, p) => s + p.budget, 0);
  const totalCommitted = byPhase.reduce((s, p) => s + p.committed, 0);
  const totalActual = byPhase.reduce((s, p) => s + p.actual, 0);
  const totalProjected = byPhase.reduce((s, p) => s + p.projectedFinal, 0);

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
