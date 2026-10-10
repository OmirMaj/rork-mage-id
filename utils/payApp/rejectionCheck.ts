// utils/payApp/rejectionCheck.ts — "Things a Reviewer May Question".
//
// Easier Pay Applications, Phase 1. Arithmetic and comparisons on the
// contractor's OWN numbers, run before he certifies. Every rule is a sum, a
// difference or an equality between two figures already on the application,
// on the last application, or in his change order log.
//
// WHAT THIS IS NOT (design-previews/pay-apps/EASIER-PAY-APPS.md):
//   • It never blocks a send. The result has no "ok" field to gate on, and the
//     screen always offers Continue Anyway.
//   • It gives no verdict. A rule that found nothing lands in `ranClean` and
//     reads "Nothing flagged". There is no score and no percent.
//   • It decides no legal question and computes no deadline. What the contract
//     allows, whether the work is done, lien and notice dates and which waiver
//     form applies are named, every time, as NOT checked.
//   • It is not saved on the record and not printed. The result is a value the
//     screen shows and throws away.
//
// Reuses the pay application's own functions (utils/aiaBilling) for over-bill,
// footing and change orders. All money compared at cent precision, tolerance
// one cent. Pure: no clock, no storage, no network.
import type { ChangeOrder, SavedAIAPayApp } from '@/types';
import {
  changeOrderApprovalDate, computeAIATotals, g703LineFigures, isCalendarDay, lineOverBill,
  reconcileAIASov, seedLessPreviousCertificates, splitApprovedCOsByPeriod,
  storedRetainagePercentForLine, summarizeChangeOrders, totalOverBill,
  type AIAPayApplication, type AIASOVLine,
} from '@/utils/aiaBilling';
import { roundCents } from '@/utils/invoiceBilling';
import { CO_BILL_KEY_PREFIX } from '@/utils/changeOrderBilling';
import { dayAfter, dayKeyOf, daysBetween } from '@/utils/payApp/days';
import {
  CHECK_LABELS, COVER_FIELD_NAMES, DATE_FIELD_NAMES, FINDING_COPY, NOT_RUN_WHY, REJECTION_COPY,
} from '@/utils/payApp/rejectionCopy';

/** One cent: the tolerance for every money comparison here. */
export const CHECK_TOLERANCE = 0.01;
const differs = (a: number, b: number): boolean => Math.abs(roundCents(a - b)) > CHECK_TOLERANCE;

export interface CheckInput {
  app: AIAPayApplication;
  /** The application before this one, or null on a first application. */
  prior: SavedAIAPayApp | null;
  /** Every OTHER saved application on the project (not this one's own record). */
  saved: readonly Pick<SavedAIAPayApp, 'applicationNumber'>[];
  changeOrders: readonly ChangeOrder[];
  /** The rate on record for this job and where it was read from, when one is. */
  statedRetainagePercent?: number;
  statedRetainageOrigin?: string;
  statedStoredRetainagePercent?: number;
  /** Phase 2. Undefined in Phase 1. */
  attachments?: { lineId?: string; kind: string }[];
  ownerChecklist?: { key: string; label: string; present: boolean }[];
}

export interface CheckAction { kind: 'line'; lineId: string; itemNo: string; label: string }
export interface CheckFinding { id: string; lineId?: string; summary: string; detail: string; action?: CheckAction }
export interface CheckResult {
  flagged: CheckFinding[];
  /** Ran and flagged nothing. Each row reads "Nothing flagged". */
  ranClean: { id: string; label: string }[];
  notRun: { id: string; label: string; why: string }[];
}

type Outcome = CheckFinding[] | { notRun: string };
interface Rule { id: string; label: string; run: () => Outcome }

const G = (l: Pick<AIASOVLine, 'fromPreviousApp' | 'thisPeriod' | 'materialsPresentlyStored'>): number =>
  roundCents((l.fromPreviousApp || 0) + (l.thisPeriod || 0) + (l.materialsPresentlyStored || 0));

function lineFinding(id: string, l: AIASOVLine, copy: { summary: string; detail: string }): CheckFinding {
  return {
    id, lineId: l.id, summary: copy.summary, detail: copy.detail,
    action: { kind: 'line', lineId: l.id, itemNo: l.itemNo, label: REJECTION_COPY.goToLine(l.itemNo) },
  };
}

/** The change order a schedule-of-values line bills, by id key first, then by "CO #n" in its description. */
function changeOrderOfLine(l: AIASOVLine, cos: readonly ChangeOrder[]): { co: ChangeOrder | null; isCoLine: boolean } {
  const prefix = `sov_${CO_BILL_KEY_PREFIX}`;
  if (l.id.startsWith(prefix)) {
    const coId = l.id.slice(prefix.length).replace(/__\d+$/, '');
    return { co: cos.find(c => c.id === coId) ?? null, isCoLine: true };
  }
  const m = /\b(?:CO|Change Order)\s*#?\s*(\d+)\b/i.exec(l.description);
  if (!m) return { co: null, isCoLine: false };
  const n = Number(m[1]);
  const co = cos.find(c => c.number === n) ?? null;
  // A description that names a number the log does not have is not evidence
  // of a change order line; say nothing rather than guess.
  return { co, isCoLine: !!co };
}

function distinctRates(values: number[]): number[] {
  return [...new Set(values.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
}

/**
 * Run every rule. Deterministic for the same input, and the input is only
 * read.
 */
export function runRejectionCheck(input: CheckInput): CheckResult {
  const { app, prior } = input;
  const cos = [...input.changeOrders];
  const totals = computeAIATotals(app);
  const priorNo = prior?.applicationNumber;
  const priorById = new Map((prior?.lines ?? []).map(l => [l.id, l]));
  const periodTo = dayKeyOf(app.periodTo);
  const periodFrom = dayKeyOf(app.periodFrom);
  const applicationDate = dayKeyOf(app.applicationDate);
  const needsPrior: Outcome = { notRun: NOT_RUN_WHY.no_prior };

  const rules: Rule[] = [
    {
      id: 'line_over_value', label: CHECK_LABELS.line_over_value(),
      run: () => app.lines.filter(l => lineOverBill(l) > 0).map(l => lineFinding('line_over_value', l,
        FINDING_COPY.line_over_value(l.itemNo, l.description, G(l), l.scheduledValue, lineOverBill(l)))),
    },
    {
      id: 'total_over_contract', label: CHECK_LABELS.total_over_contract(),
      run: () => {
        const over = totalOverBill(app);
        return over > CHECK_TOLERANCE
          ? [{ id: 'total_over_contract', ...FINDING_COPY.total_over_contract(totals.totalCompletedAndStored, roundCents(app.contractSumToDate), over) }]
          : [];
      },
    },
    {
      id: 'sov_not_footing', label: CHECK_LABELS.sov_not_footing(),
      run: () => {
        const r = reconcileAIASov(app);
        return r.reconciled ? [] : [{ id: 'sov_not_footing', ...FINDING_COPY.sov_not_footing(r.totalScheduledValue, r.contractSumToDate, r.difference) }];
      },
    },
    {
      id: 'previous_mismatch', label: CHECK_LABELS.previous_mismatch(priorNo),
      run: () => {
        if (!prior) return needsPrior;
        const out: CheckFinding[] = [];
        for (const l of app.lines) {
          const p = priorById.get(l.id);
          if (!p) {
            // A line the last application did not have should open at zero.
            if (differs(l.fromPreviousApp, 0)) {
              out.push(lineFinding('previous_mismatch', l, FINDING_COPY.previous_mismatch(l.itemNo, l.fromPreviousApp, prior.applicationNumber, 0)));
            }
            continue;
          }
          const ended = roundCents((p.fromPreviousApp || 0) + (p.thisPeriod || 0));
          if (differs(l.fromPreviousApp, ended)) {
            out.push(lineFinding('previous_mismatch', l, FINDING_COPY.previous_mismatch(l.itemNo, l.fromPreviousApp, prior.applicationNumber, ended)));
          }
        }
        return out;
      },
    },
    {
      id: 'previous_line_missing', label: CHECK_LABELS.previous_line_missing(priorNo),
      run: () => {
        if (!prior) return needsPrior;
        const here = new Set(app.lines.map(l => l.id));
        return prior.lines
          .filter(p => !here.has(p.id) && Math.abs(G(p)) > 0.005)
          .map(p => ({ id: 'previous_line_missing', ...FINDING_COPY.previous_line_missing(prior.applicationNumber, G(p), p.description, p.itemNo) }));
      },
    },
    {
      id: 'line7_mismatch', label: CHECK_LABELS.line7_mismatch(priorNo),
      run: () => {
        if (!prior) return needsPrior;
        const carries = seedLessPreviousCertificates(prior);
        return differs(app.lessPreviousCertificates, carries)
          ? [{ id: 'line7_mismatch', ...FINDING_COPY.line7_mismatch(app.lessPreviousCertificates, prior.applicationNumber, carries) }]
          : [];
      },
    },
    {
      id: 'stored_in_previous', label: CHECK_LABELS.stored_in_previous(),
      run: () => {
        if (!prior) return needsPrior;
        const out: CheckFinding[] = [];
        for (const l of app.lines) {
          const p = priorById.get(l.id);
          const before = roundCents(p?.materialsPresentlyStored || 0);
          if (!(before > 0)) continue;
          const fell = roundCents(before - l.materialsPresentlyStored);
          if (fell > CHECK_TOLERANCE && roundCents(fell - l.thisPeriod) > CHECK_TOLERANCE) {
            out.push(lineFinding('stored_in_previous', l, FINDING_COPY.stored_in_previous(l.itemNo, fell)));
          }
        }
        return out;
      },
    },
    {
      id: 'went_backwards', label: CHECK_LABELS.went_backwards(),
      run: () => {
        const out: CheckFinding[] = [];
        for (const l of app.lines) {
          if (!(l.scheduledValue > 0)) continue;
          if (l.thisPeriod < -0.005) {
            out.push(lineFinding('went_backwards', l, FINDING_COPY.went_backwards_negative(l.itemNo, l.thisPeriod)));
            continue;
          }
          const p = priorById.get(l.id);
          if (!p || !prior) continue;
          // A drop explained by stored material coming down is the stored
          // rule's to report, once.
          const storedFell = roundCents((p.materialsPresentlyStored || 0) - l.materialsPresentlyStored) > CHECK_TOLERANCE;
          if (!storedFell && roundCents(G(p) - G(l)) > CHECK_TOLERANCE) {
            out.push(lineFinding('went_backwards', l, FINDING_COPY.went_backwards_total(l.itemNo, prior.applicationNumber, G(l), G(p))));
          }
        }
        return out;
      },
    },
    {
      id: 'retainage', label: CHECK_LABELS.retainage(input.statedRetainagePercent),
      run: () => {
        const out: CheckFinding[] = [];
        const stated = input.statedRetainagePercent;
        if (stated != null && Number.isFinite(stated)) {
          const off = app.lines.filter(l => Math.abs(l.retainagePercent - stated) > 1e-9);
          if (off.length) {
            out.push({ id: 'retainage_rate', ...FINDING_COPY.retainage_rate(off.length, distinctRates(off.map(l => l.retainagePercent)), stated, input.statedRetainageOrigin ?? '', false) });
          }
          const statedStored = input.statedStoredRetainagePercent;
          if (statedStored != null && Number.isFinite(statedStored)) {
            const offStored = app.lines.filter(l => Math.abs(storedRetainagePercentForLine(l) - statedStored) > 1e-9);
            if (offStored.length) {
              out.push({ id: 'retainage_rate', ...FINDING_COPY.retainage_rate(offStored.length, distinctRates(offStored.map(l => storedRetainagePercentForLine(l))), statedStored, input.statedRetainageOrigin ?? '', true) });
            }
          }
          return out;
        }
        const rates = distinctRates(app.lines.map(l => l.retainagePercent));
        return rates.length > 1 ? [{ id: 'retainage_mixed', ...FINDING_COPY.retainage_mixed(rates) }] : [];
      },
    },
    {
      id: 'co_billed_not_approved', label: CHECK_LABELS.co_billed_not_approved(),
      run: () => {
        const out: CheckFinding[] = [];
        for (const l of app.lines) {
          if (Math.abs(G(l)) <= 0.005) continue;
          const { co, isCoLine } = changeOrderOfLine(l, cos);
          if (!isCoLine) continue;
          if (!co) {
            out.push(lineFinding('co_billed_not_approved', l, FINDING_COPY.co_billed_not_in_log(l.itemNo)));
          } else if (co.status !== 'approved') {
            out.push(lineFinding('co_billed_not_approved', l, FINDING_COPY.co_billed_status(l.itemNo, co.number, String(co.status).replace(/_/g, ' '))));
          } else if (periodTo) {
            const when = dayKeyOf(changeOrderApprovalDate(co));
            if (when && when > periodTo) {
              out.push(lineFinding('co_billed_not_approved', l, FINDING_COPY.co_billed_after_period(l.itemNo, co.number, when)));
            }
          }
        }
        return out;
      },
    },
    {
      id: 'co_approved_missing', label: CHECK_LABELS.co_approved_missing(),
      run: () => {
        const onSheet = new Set<string>();
        for (const l of app.lines) {
          const { co } = changeOrderOfLine(l, cos);
          if (co) onSheet.add(co.id);
        }
        return splitApprovedCOsByPeriod(cos, app.periodTo || undefined).inPeriod
          .filter(co => !onSheet.has(co.id))
          .map(co => ({ id: 'co_approved_missing', ...FINDING_COPY.co_approved_missing(co.number, co.changeAmount) }));
      },
    },
    {
      id: 'co_summary_mismatch', label: CHECK_LABELS.co_summary_mismatch(),
      run: () => {
        const log = summarizeChangeOrders(cos, app.periodFrom, app.periodTo || undefined).netChange;
        return differs(app.netChangeByCO, log)
          ? [{ id: 'co_summary_mismatch', ...FINDING_COPY.co_summary_mismatch(app.netChangeByCO, log) }]
          : [];
      },
    },
    {
      id: 'contract_sum_math', label: CHECK_LABELS.contract_sum_math(),
      run: () => (differs(app.contractSumToDate, app.originalContractSum + app.netChangeByCO)
        ? [{ id: 'contract_sum_math', ...FINDING_COPY.contract_sum_math(app.originalContractSum, app.netChangeByCO, app.contractSumToDate) }]
        : []),
    },
    {
      id: 'cover_vs_sheet', label: CHECK_LABELS.cover_vs_sheet(),
      run: () => {
        const out: CheckFinding[] = [];
        // The sheet, added up the way a reader adds it: each printed row to
        // the cent, then the column.
        const sheetG = roundCents(app.lines.reduce((s, l) => s + G(l), 0));
        const sheetI = roundCents(app.lines.reduce((s, l) => s + g703LineFigures(l).retainage, 0));
        if (differs(totals.totalCompletedAndStored, sheetG)) {
          out.push({ id: 'cover_vs_sheet', ...FINDING_COPY.cover_vs_sheet(COVER_FIELD_NAMES.completed, totals.totalCompletedAndStored, sheetG) });
        }
        if (differs(totals.totalRetainage, sheetI)) {
          out.push({ id: 'cover_vs_sheet', ...FINDING_COPY.cover_vs_sheet(COVER_FIELD_NAMES.retainage, totals.totalRetainage, sheetI) });
        }
        const line8 = roundCents(sheetG - sheetI - app.lessPreviousCertificates);
        if (differs(totals.currentPaymentDue, line8)) {
          out.push({ id: 'cover_vs_sheet', ...FINDING_COPY.cover_vs_sheet(COVER_FIELD_NAMES.payment, totals.currentPaymentDue, line8) });
        }
        return out;
      },
    },
    {
      id: 'payment_not_positive', label: CHECK_LABELS.payment_not_positive(),
      run: () => (totals.currentPaymentDue <= 0
        ? [{ id: 'payment_not_positive', ...FINDING_COPY.payment_not_positive(totals.currentPaymentDue) }]
        : []),
    },
    {
      id: 'dates_invalid', label: CHECK_LABELS.dates_invalid(),
      run: () => {
        const out: CheckFinding[] = [];
        if (!applicationDate || !isCalendarDay(app.applicationDate)) out.push({ id: 'dates_invalid', ...FINDING_COPY.dates_invalid(DATE_FIELD_NAMES.applicationDate) });
        if (!periodTo || !isCalendarDay(app.periodTo)) out.push({ id: 'dates_invalid', ...FINDING_COPY.dates_invalid(DATE_FIELD_NAMES.periodTo) });
        if (app.periodFrom && !periodFrom) out.push({ id: 'dates_invalid', ...FINDING_COPY.dates_invalid(DATE_FIELD_NAMES.periodFrom) });
        return out;
      },
    },
    {
      id: 'period_order', label: CHECK_LABELS.period_order(),
      run: () => {
        if (!app.periodFrom) return { notRun: NOT_RUN_WHY.needs_period_from };
        if (!periodFrom || !periodTo) return { notRun: NOT_RUN_WHY.needs_dates };
        return periodFrom > periodTo ? [{ id: 'period_order', ...FINDING_COPY.period_order() }] : [];
      },
    },
    {
      id: 'period_sequence', label: CHECK_LABELS.period_sequence(),
      run: () => {
        if (!prior) return needsPrior;
        const priorTo = dayKeyOf(prior.periodTo);
        if (!priorTo) return { notRun: NOT_RUN_WHY.needs_prior_period };
        if (!app.periodFrom) return { notRun: NOT_RUN_WHY.needs_period_from };
        if (!periodFrom) return { notRun: NOT_RUN_WHY.needs_dates };
        if (periodFrom <= priorTo) {
          return [{ id: 'period_overlap', ...FINDING_COPY.period_overlap(periodFrom, prior.applicationNumber, priorTo) }];
        }
        const next = dayAfter(priorTo);
        if (next && periodFrom > next) {
          const gap = (daysBetween(priorTo, periodFrom) ?? 1) - 1;
          return [{ id: 'period_gap', ...FINDING_COPY.period_gap(gap, prior.applicationNumber) }];
        }
        return [];
      },
    },
    {
      id: 'app_date_before_period_end', label: CHECK_LABELS.app_date_before_period_end(),
      run: () => {
        if (!applicationDate || !periodTo) return { notRun: NOT_RUN_WHY.needs_dates };
        return applicationDate < periodTo ? [{ id: 'app_date_before_period_end', ...FINDING_COPY.app_date_before_period_end() }] : [];
      },
    },
    {
      id: 'number_sequence', label: CHECK_LABELS.number_sequence(priorNo),
      run: () => {
        const n = app.applicationNumber;
        if (input.saved.some(a => a.applicationNumber === n)) {
          return [{ id: 'number_sequence', ...FINDING_COPY.number_duplicate(n) }];
        }
        if (prior) {
          return n !== prior.applicationNumber + 1
            ? [{ id: 'number_sequence', ...FINDING_COPY.number_sequence(n, prior.applicationNumber) }]
            : [];
        }
        return n !== 1 ? [{ id: 'number_sequence', ...FINDING_COPY.number_first(n) }] : [];
      },
    },
    {
      id: 'nothing_billed', label: CHECK_LABELS.nothing_billed(),
      run: () => {
        const work = roundCents(app.lines.reduce((s, l) => s + l.thisPeriod, 0));
        const stored = roundCents(app.lines.reduce((s, l) => s + l.materialsPresentlyStored, 0));
        const storedBefore = roundCents((prior?.lines ?? []).reduce((s, l) => s + (l.materialsPresentlyStored || 0), 0));
        return Math.abs(work) <= 0.005 && !differs(stored, storedBefore)
          ? [{ id: 'nothing_billed', ...FINDING_COPY.nothing_billed() }]
          : [];
      },
    },
    // Phase 2. Named so the contractor can see they exist and did not run.
    { id: 'stored_no_backup', label: CHECK_LABELS.stored_no_backup(), run: () => ({ notRun: NOT_RUN_WHY.needs_checklist }) },
    { id: 'checklist_missing', label: CHECK_LABELS.checklist_missing(), run: () => ({ notRun: NOT_RUN_WHY.needs_checklist }) },
    { id: 'notary_checklist', label: CHECK_LABELS.notary_checklist(), run: () => ({ notRun: NOT_RUN_WHY.needs_checklist }) },
  ];

  const result: CheckResult = { flagged: [], ranClean: [], notRun: [] };
  for (const rule of rules) {
    const outcome = rule.run();
    if (!Array.isArray(outcome)) {
      result.notRun.push({ id: rule.id, label: rule.label, why: outcome.notRun });
    } else if (outcome.length === 0) {
      result.ranClean.push({ id: rule.id, label: rule.label });
    } else {
      result.flagged.push(...outcome);
    }
  }
  return result;
}

/** The first finding that points at a line: the "Fix Line n" button. */
export function firstLineFinding(result: CheckResult): CheckAction | null {
  for (const f of result.flagged) if (f.action) return f.action;
  return null;
}

/**
 * The figures the check read, as one string. The screen remembers the string
 * it last SHOWED the check for; the certify sheet opens only when that equals
 * the application on screen, so a figure changed after the check brings the
 * check back before the slide.
 */
export function checkFingerprint(app: AIAPayApplication): string {
  const c = (n: number | undefined): string => (n == null || !Number.isFinite(n) ? '' : String(Math.round(n * 100)));
  return [
    app.applicationNumber, app.applicationDate, app.periodFrom ?? '', app.periodTo,
    c(app.originalContractSum), c(app.netChangeByCO), c(app.contractSumToDate), c(app.lessPreviousCertificates),
    String(app.retainagePercent), String(app.storedRetainagePercent ?? ''),
    ...app.lines.map(l => [
      l.id, l.itemNo, c(l.scheduledValue), c(l.fromPreviousApp), c(l.thisPeriod), c(l.materialsPresentlyStored),
      String(l.retainagePercent), String(l.storedRetainagePercent ?? ''),
    ].join('~')),
  ].join('|');
}
