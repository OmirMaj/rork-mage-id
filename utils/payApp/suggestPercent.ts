// utils/payApp/suggestPercent.ts — where a suggested percent comes from.
//
// Easier Pay Applications, Phase 1. This replaces "Sync From Schedule", which
// wrote the project-wide average onto every line that had no linked task (and
// no screen ever linked one), at once, with no source shown.
//
// THE RULES THIS FILE HOLDS (scripts/validate-pay-app-easy.ts executes them):
//   1. A line with no linked schedule task gets NO suggestion, and says why.
//      There is no project-average fallback, anywhere in this file.
//   2. A suggestion is a VALUE, never an edit: nothing here takes or returns an
//      application, and `suggestForLines` cannot change a figure. The screen
//      writes `thisPeriod` only when the contractor accepts or types.
//   3. Never a negative, never a step backwards, never past the scheduled
//      value, and never on a deductive line.
//   4. No whole-percent rounding. Money to the cent.
//
// Pure: no network, no model, no clock, no storage.
import type { DailyFieldReport, ScheduleTask } from '@/types';
import type { AIASOVLine } from '@/utils/aiaBilling';
import { roundCents } from '@/utils/invoiceBilling';
import { CO_BILL_KEY_PREFIX } from '@/utils/changeOrderBilling';
import { dayKeyOf } from '@/utils/payApp/days';
import {
  NO_SUGGESTION, dailyReportSentence, nothingNewSentence, scheduleTaskSentence,
  weightedTasksSentence, wouldGoBackwardsSentence,
} from '@/utils/payApp/suggestCopy';

type MoneyLine = Pick<AIASOVLine, 'scheduledValue' | 'fromPreviousApp' | 'materialsPresentlyStored'>;

/**
 * The dollars a TOTAL percent complete puts in column E on a line.
 *
 * Lifted, unchanged, from applyPercentToLine in app/aia-pay-app.tsx so the
 * percent field, the percent chips, the grid and a suggestion are one rule.
 * STORED MATERIAL COUNTS TOWARD THE PERCENTAGE: column H is G ÷ C where G is
 * D + E + F, so 75% on a line with stored material bills less new work.
 */
export function thisPeriodForPercent(line: MoneyLine, percent: number): number {
  const totalCompleted = Math.max(0, Math.min(line.scheduledValue, line.scheduledValue * (percent / 100)));
  const thisPeriod = Math.max(0, totalCompleted - line.fromPreviousApp - line.materialsPresentlyStored);
  return roundCents(thisPeriod);
}

/**
 * A CREDIT line (scheduled value below zero): the dollars a total percent of
 * the credit puts in this period. 100% of a -500.00 credit with -200.00 given
 * before is -300.00. Never above zero, never past the credit. Kept apart from
 * thisPeriodForPercent, which the full screen's percent field shares and which
 * leaves a credit line at zero, as it always has.
 */
export function creditThisPeriodForPercent(line: MoneyLine, percent: number): number {
  if (!(line.scheduledValue < 0)) return 0;
  const p = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const totalCredit = line.scheduledValue * (p / 100);
  return roundCents(Math.min(0, totalCredit - line.fromPreviousApp));
}

/** Percent of a line taken to date, credit lines included (a credit is its own share of its own value). */
export function percentOfAnyLine(
  line: Pick<AIASOVLine, 'scheduledValue' | 'fromPreviousApp' | 'thisPeriod' | 'materialsPresentlyStored'>,
): number | null {
  if (line.scheduledValue < 0) return ((line.fromPreviousApp + line.thisPeriod) / line.scheduledValue) * 100;
  return percentOfLine(line);
}

export type TypedPercent =
  | { kind: 'ok'; percent: number }
  | { kind: 'empty' }
  | { kind: 'refused'; why: 'over_100' | 'below_zero' | 'not_a_number' };

/**
 * What he typed in a percent field. Digits with an optional decimal point and
 * an optional percent sign, from 0 to 100. Anything else is REFUSED with the
 * reason, never rounded, clamped or guessed at ("12,5" is not read as 12.5 or
 * as 125).
 */
export function parseTypedPercent(text: string): TypedPercent {
  const s = String(text ?? '').trim().replace(/\s*%$/, '');
  if (!s) return { kind: 'empty' };
  if (/^-\s*(\d+\.?\d*|\.\d+)$/.test(s)) return { kind: 'refused', why: 'below_zero' };
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return { kind: 'refused', why: 'not_a_number' };
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return { kind: 'refused', why: 'not_a_number' };
  if (n > 100) return { kind: 'refused', why: 'over_100' };
  return { kind: 'ok', percent: n };
}

/** Total percent complete to date on a line (column G ÷ C), or null when C is not positive. */
export function percentOfLine(
  line: Pick<AIASOVLine, 'scheduledValue' | 'fromPreviousApp' | 'thisPeriod' | 'materialsPresentlyStored'>,
): number | null {
  if (!(line.scheduledValue > 0)) return null;
  return ((line.fromPreviousApp + line.thisPeriod + line.materialsPresentlyStored) / line.scheduledValue) * 100;
}

export type SuggestionSource =
  | { kind: 'schedule_task'; taskId: string; taskTitle: string; progress: number }
  | { kind: 'schedule_tasks_weighted'; taskIds: string[]; count: number }
  | { kind: 'daily_report'; taskId: string; taskTitle: string; pct: number; reportDate: string };

export interface LineSuggestion {
  lineId: string;
  /** 0..100, total complete to date including stored (column H's meaning). */
  percent: number;
  /** Dollars this would put in column E, to the cent. Always above zero. */
  thisPeriod: number;
  source: SuggestionSource;
  /** Where it came from, from utils/payApp/suggestCopy. */
  sentence: string;
}

export type NoSuggestionReason =
  | 'no_linked_task' | 'no_progress_reported' | 'billed_in_full'
  | 'not_positive_value' | 'would_go_backwards' | 'nothing_new';

export type LineSuggestionResult =
  | { kind: 'suggest'; suggestion: LineSuggestion }
  | { kind: 'none'; reason: NoSuggestionReason; sentence: string };

type SuggestTask = Pick<ScheduleTask, 'id' | 'title' | 'progress' | 'durationDays' | 'linkedEstimateItems'>;
type SuggestReport = Pick<DailyFieldReport, 'date' | 'workProgress'>;

const clampPct = (n: unknown): number => {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
};

/**
 * The estimate key inside a schedule-of-values line id.
 *
 * buildAIASovLines ids an estimate line `sov_<materialId || name>` (suffixed
 * `__2` on a repeat) and a change order `sov_co:<coId>`. ScheduleTask
 * .linkedEstimateItems holds materialIds, so the key is the link, with no new
 * data entry. A change-order line, a hand-added line and an imported line have
 * no estimate key: null.
 */
export function estimateKeyOfLineId(lineId: string): string | null {
  if (!lineId.startsWith('sov_')) return null;
  const key = lineId.slice(4).replace(/__\d+$/, '');
  if (!key || key.startsWith(CO_BILL_KEY_PREFIX)) return null;
  if (key.startsWith('manual_') || key.startsWith('imp_')) return null;
  return key;
}

/** The schedule tasks that speak for one line: its own link first, else the estimate key. */
export function tasksForLine(line: Pick<AIASOVLine, 'id' | 'linkedTaskId'>, tasks: readonly SuggestTask[]): SuggestTask[] {
  if (line.linkedTaskId) {
    const own = tasks.find(t => t.id === line.linkedTaskId);
    if (own) return [own];
  }
  const key = estimateKeyOfLineId(line.id);
  if (!key) return [];
  return tasks.filter(t => (t.linkedEstimateItems ?? []).includes(key));
}

interface Reported { pct: number; reportDate: string | null }

/**
 * What was last reported for a task: the newest daily report on or before the
 * period end that names it, else the task's own progress. A report dated after
 * the period end is not this period's news and is ignored; when the period end
 * is not a date, no report can be placed and the task's own figure stands.
 */
function reportedFor(task: SuggestTask, reports: readonly SuggestReport[], periodTo: string | null): Reported {
  let best: { day: string; pct: number } | null = null;
  if (periodTo) {
    for (const r of reports) {
      const day = dayKeyOf(r.date);
      if (!day || day > periodTo) continue;
      for (const wp of r.workProgress ?? []) {
        if (!wp || wp.taskId !== task.id) continue;
        const pct = clampPct(wp.pct);
        // Newest day wins. Two reports on one day: the higher figure, so the
        // answer does not depend on the order the list arrived in.
        if (!best || day > best.day || (day === best.day && pct > best.pct)) best = { day, pct };
      }
    }
  }
  if (best) return { pct: best.pct, reportDate: best.day };
  return { pct: clampPct(task.progress), reportDate: null };
}

function suggestForLine(
  line: AIASOVLine,
  tasks: readonly SuggestTask[],
  reports: readonly SuggestReport[],
  periodTo: string | null,
): LineSuggestionResult {
  const none = (reason: Exclude<NoSuggestionReason, 'would_go_backwards' | 'nothing_new'>): LineSuggestionResult =>
    ({ kind: 'none', reason, sentence: NO_SUGGESTION[reason] });

  if (!(line.scheduledValue > 0)) return none('not_positive_value');
  const billed = roundCents(line.fromPreviousApp + line.materialsPresentlyStored);
  if (billed >= line.scheduledValue - 0.005) return none('billed_in_full');

  const linked = tasksForLine(line, tasks);
  // RULE 1. No linked task: no suggestion. Not the project average, not the
  // phase average, not last month's pace.
  if (linked.length === 0) return none('no_linked_task');

  let percent: number;
  let source: SuggestionSource;
  let sentence: string;
  if (linked.length === 1) {
    const t = linked[0];
    const rep = reportedFor(t, reports, periodTo);
    percent = rep.pct;
    if (rep.reportDate) {
      source = { kind: 'daily_report', taskId: t.id, taskTitle: t.title, pct: rep.pct, reportDate: rep.reportDate };
      sentence = dailyReportSentence(t.title, rep.pct, rep.reportDate);
    } else {
      source = { kind: 'schedule_task', taskId: t.id, taskTitle: t.title, progress: rep.pct };
      sentence = scheduleTaskSentence(t.title, rep.pct);
    }
  } else {
    let weightSum = 0;
    let weighted = 0;
    for (const t of linked) {
      const w = Number.isFinite(t.durationDays) && t.durationDays > 0 ? t.durationDays : 0;
      weightSum += w;
      weighted += w * reportedFor(t, reports, periodTo).pct;
    }
    // Every task with no duration: a plain average, so the answer exists.
    percent = weightSum > 0
      ? weighted / weightSum
      : linked.reduce((s, t) => s + reportedFor(t, reports, periodTo).pct, 0) / linked.length;
    source = { kind: 'schedule_tasks_weighted', taskIds: linked.map(t => t.id), count: linked.length };
    sentence = weightedTasksSentence(linked.length, percent);
  }

  if (!(percent > 0)) return none('no_progress_reported');

  const billedPct = (billed / line.scheduledValue) * 100;
  const thisPeriod = thisPeriodForPercent(line, percent);
  if (!(thisPeriod > 0)) {
    // RULE 3. The schedule is behind (or level with) what is already billed.
    return percent < billedPct - 0.05
      ? { kind: 'none', reason: 'would_go_backwards', sentence: wouldGoBackwardsSentence(percent, billedPct) }
      : { kind: 'none', reason: 'nothing_new', sentence: nothingNewSentence(percent) };
  }
  return { kind: 'suggest', suggestion: { lineId: line.id, percent, thisPeriod, source, sentence } };
}

/**
 * One result per line: a suggestion with its source, or the reason there is
 * none. Reads; writes nothing.
 */
export function suggestForLines(input: {
  lines: readonly AIASOVLine[];
  tasks: readonly SuggestTask[];
  dailyReports: readonly SuggestReport[];
  periodTo: string | undefined | null;
}): Record<string, LineSuggestionResult> {
  const periodTo = dayKeyOf(input.periodTo);
  const out: Record<string, LineSuggestionResult> = {};
  for (const line of input.lines) {
    out[line.id] = suggestForLine(line, input.tasks, input.dailyReports, periodTo);
  }
  return out;
}

// ── The accept step ─────────────────────────────────────────────────────────
// The line's state lives in the screen: 'untouched' until the contractor
// accepts the suggestion or types a value. These helpers are the only way a
// suggestion becomes money, and each needs his action to be called.

export type LineAcceptState = 'untouched' | 'accepted' | 'changed';

/**
 * The line after he taps Accept: column E is the suggested PERCENT worked out
 * on the line AS IT IS NOW, and the record keeps what was suggested.
 *
 * Not the dollar figure the suggestion was made with: that was worked out when
 * the suggestions were built, and a stored-material figure typed since then
 * would be billed a second time. Scheduled 100,000.00, previous 20,000.00,
 * suggestion 75% (55,000.00 when it was made), then 40,000.00 stored typed:
 * Accept puts 15,000.00 in this period, not 55,000.00.
 */
export function acceptSuggestion(line: AIASOVLine, s: LineSuggestion): AIASOVLine {
  if (s.lineId !== line.id) return line;
  return { ...line, thisPeriod: thisPeriodForPercent(line, s.percent), suggestedPercent: s.percent, suggestionSource: s.sentence };
}

/** What Accept would put in this period on the line as it is now (the figure the row shows). */
export function suggestionAmountNow(line: MoneyLine, s: Pick<LineSuggestion, 'percent'>): number {
  return thisPeriodForPercent(line, s.percent);
}

/** The line after he types his own percent over a suggestion (or with none). */
export function enterPercent(line: AIASOVLine, percent: number, s?: LineSuggestion | null): AIASOVLine {
  const next: AIASOVLine = {
    ...line,
    thisPeriod: line.scheduledValue < 0 ? creditThisPeriodForPercent(line, percent) : thisPeriodForPercent(line, percent),
  };
  if (s && s.lineId === line.id) {
    next.suggestedPercent = s.percent;
    next.suggestionSource = s.sentence;
  }
  return next;
}

export interface SuggestionTally {
  /** Suggestions not accepted and not typed over. */
  open: number;
  /** What they would add to column E if all were accepted. NOT in any total. */
  openAmount: number;
}

/** How many suggestions are still waiting, for the footer and the Accept All confirm. */
export function tallyOpenSuggestions(
  results: Record<string, LineSuggestionResult>,
  states: Record<string, LineAcceptState | undefined>,
): SuggestionTally {
  let open = 0;
  let openAmount = 0;
  for (const [lineId, r] of Object.entries(results)) {
    if (r.kind !== 'suggest') continue;
    if ((states[lineId] ?? 'untouched') !== 'untouched') continue;
    open += 1;
    openAmount += r.suggestion.thisPeriod;
  }
  return { open, openAmount: roundCents(openAmount) };
}
