// utils/pace/paceBook.ts — your pace, learned from your finished work.
//
// Time-twin of utils/costDatabase.ts (money): reads every project's schedule,
// takes tasks that are CURRENTLY done and whose as-built day numbers were
// captured (both actualStartDay AND actualEndDay — utils/pace/stampActuals.ts
// is the capture flywheel), and distils per-trade duration entries: what
// "Framing" ACTUALLY takes this contractor, by project-size bucket, with a
// variability band and a read on whether they plan optimistic. Samples come
// from ALL projects, not only closed ones — a finished task on an active job
// is a valid pace sample.
//
// Units: actualDays is measured in WORKING days — the same unit as
// task.durationDays. Task day numbers (startDay/actualStartDay/actualEndDay)
// are CALENDAR-day indices from schedule.startDate, while the CPM engine
// (utils/cpm.ts walkWorkingDays) stretches durationDays across those indices
// skipping non-working days. Sampling the raw calendar span would inflate
// every weekend-crossing task (+2 per weekend on a 5-day week) and ratchet
// suggestions upward each accept cycle, so buildPaceBook converts the span
// through the schedule's own calendar (isWorkingDay from utils/cpm.ts).
//
// Cold-start mirrors the cost DB: suggestDuration blends the AI's proposed
// duration (the prior) toward the measured mean with w = n/(n+K), K=3 — with
// one job it leans on the plan; by the fifth it's mostly your real pace.
//
// Pure function — no storage, no network. Derived live from ProjectContext
// data via useMemo where surfaced.
import type { Project, ScheduleTask } from '@/types';
import { tradeKeyForTask } from '@/utils/scheduleColors';
import { isWorkingDay } from '@/utils/cpm';

/** Blend constant: at n jobs, personal weight = n/(n+K). K=3 ⇒ 50/50 at n=3. */
export const PACE_BLEND_K = 3;

export type SqftBucket = 'small' | 'medium' | 'large' | 'xlarge' | 'unknown';

export interface PaceSample {
  projectId: string;
  projectName: string;
  /** tradeKeyForTask(task) — explicit tradeKey, else conservative name inference. */
  trade: string;
  /** The source project's size bucket (a real SqftBucket, even inside `|all`). */
  sqftBucket: string;
  /** task.durationDays at sampling time — the plan (working days). */
  plannedDays: number;
  /** Working days in [actualStartDay, actualEndDay], clamped ≥ 1 — the
   *  reality, in the SAME unit as plannedDays. */
  actualDays: number;
  completedAt: string;
}

export interface PaceBookEntry {
  /** `${trade}|${sqftBucket}` — plus a `${trade}|all` trade-wide aggregate. */
  key: string;
  trade: string;
  /** SqftBucket, or 'all' on the trade-wide aggregate entry. */
  sqftBucket: string;
  sampleCount: number;
  jobCount: number;
  plannedMean: number;
  actualMean: number;
  /** Coefficient of variation of actualDays (0.2 = ±20% spread). */
  variability: number;
  /** (actualMean − plannedMean) / plannedMean. >0 = you plan optimistic. */
  bias: number;
  confidence: 'low' | 'medium' | 'high';
  samples: PaceSample[];
}

export interface PaceBook {
  entries: PaceBookEntry[];
  jobsAnalyzed: number;
  /** Distinct trades (the |all aggregates would double-count entries). */
  tradesTracked: number;
  asOf: string;
}

/** Project-size buckets: small <2000 | medium 2000–3499 | large 3500–5999 |
 *  xlarge ≥6000. The 6000 boundary belongs to xlarge — this is canonical
 *  (the spec's "large 3500–6000" prose was inclusive-sloppy). */
export function bucketForSqft(sqft: number | null | undefined): SqftBucket {
  if (typeof sqft !== 'number' || !Number.isFinite(sqft) || sqft <= 0) return 'unknown';
  if (sqft < 2000) return 'small';
  if (sqft < 3500) return 'medium';
  if (sqft < 6000) return 'large';
  return 'xlarge';
}

/** jobCount≥5 with cv≤0.35 → high; jobCount≥3 → medium; else low.
 *  (Looser cv edge than the cost book's 0.2 — durations are noisier than
 *  unit prices; per the approved spec.) */
export function paceConfidence(jobCount: number, variability: number): PaceBookEntry['confidence'] {
  if (jobCount >= 5 && variability <= 0.35) return 'high';
  if (jobCount >= 3) return 'medium';
  return 'low';
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/**
 * Working days in the inclusive span [startDay, endDay] under the schedule's
 * calendar — the conversion that puts actualDays in durationDays' unit.
 * Falls back to the raw calendar span when the schedule has no startDate,
 * exactly matching cpm.ts's raw-day degradation (no anchor ⇒ every day
 * counts, calendar == working). Clamped ≥ 1 so a same-day task logged on a
 * non-working day still registers as one day of work.
 */
function actualWorkingDays(
  startDay: number,
  endDay: number,
  workingDaysPerWeek: number,
  scheduleStartDate: string | undefined,
  closures: Set<string>,
): number {
  if (!scheduleStartDate) return Math.max(1, endDay - startDay + 1);
  let count = 0;
  for (let d = startDay; d <= endDay; d++) {
    if (isWorkingDay(d, workingDaysPerWeek, scheduleStartDate, closures)) count++;
  }
  return Math.max(1, count);
}

export function buildPaceBook(projects: Project[]): PaceBook {
  const asOf = new Date().toISOString();
  const groups = new Map<string, PaceSample[]>();
  const jobs = new Set<string>();

  const push = (key: string, s: PaceSample) => {
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  };

  for (const project of projects ?? []) {
    const schedule = project?.schedule;
    const tasks: ScheduleTask[] = schedule?.tasks ?? [];
    const sqftBucket = bucketForSqft(project?.squareFootage);
    const startDate = schedule?.startDate;
    const workingDaysPerWeek = schedule?.workingDaysPerWeek ?? 7;
    const closures = new Set(schedule?.nonWorkingDates ?? []);
    let contributed = false;
    for (const task of tasks) {
      if (!task) continue;
      // Milestones carry no duration signal; a task becomes a sample only
      // once BOTH as-built day numbers were captured. Date-only captures
      // (null-basis stamps on startDate-less schedules) are skipped — their
      // day numbers are missing, so no span can be trusted.
      if (task.isMilestone || !(task.durationDays > 0)) continue;
      // Only CURRENTLY-done tasks are pace evidence. A reopened task's
      // stamps are provisional until it is finished again — sampling it
      // would feed the book a too-short duration mid-rework.
      if (task.status !== 'done') continue;
      if (typeof task.actualStartDay !== 'number' || typeof task.actualEndDay !== 'number') continue;
      // Inverted pairs are corrupt capture (out-of-order manual logs, plan
      // rebases after a retro-stamp). EXCLUDE them — clamping to 1 would
      // inject a fake fastest-possible sample that deflates the mean and
      // inflates variability.
      if (task.actualEndDay < task.actualStartDay) continue;
      const sample: PaceSample = {
        projectId: project.id,
        projectName: project.name,
        trade: tradeKeyForTask(task),
        sqftBucket,
        plannedDays: Math.max(1, Math.round(task.durationDays)),
        actualDays: actualWorkingDays(task.actualStartDay, task.actualEndDay, workingDaysPerWeek, startDate, closures),
        completedAt: task.actualEndDate ?? '',
      };
      // No `trade|unknown` exact-bucket entry: projects missing sqft share no
      // size similarity, and that bucket is a strict subset of `|all` — its
      // samples belong only in the trade-wide aggregate.
      if (sample.sqftBucket !== 'unknown') push(`${sample.trade}|${sample.sqftBucket}`, sample);
      push(`${sample.trade}|all`, { ...sample });
      contributed = true;
    }
    if (contributed) jobs.add(project.id);
  }

  const entries: PaceBookEntry[] = [];
  for (const [key, ss] of groups) {
    const actualMean = mean(ss.map(s => s.actualDays));
    const plannedMean = mean(ss.map(s => s.plannedDays));
    const variance = mean(ss.map(s => (s.actualDays - actualMean) ** 2));
    const variability = actualMean > 0 ? Math.sqrt(variance) / actualMean : 0;
    const bias = plannedMean > 0 ? (actualMean - plannedMean) / plannedMean : 0;
    const jobCount = new Set(ss.map(s => s.projectId)).size;
    const sorted = [...ss].sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1));
    const [trade, sqftBucket] = key.split('|');
    entries.push({
      key,
      trade,
      sqftBucket,
      sampleCount: ss.length,
      jobCount,
      plannedMean,
      actualMean,
      variability,
      bias,
      confidence: paceConfidence(jobCount, variability),
      samples: sorted,
    });
  }

  const tradesTracked = new Set(entries.map(e => e.trade)).size;
  return { entries, jobsAnalyzed: jobs.size, tradesTracked, asOf };
}

/** Exact size-bucket entry first, then the trade-wide `|all` aggregate.
 *  When the current project's sqft is missing (bucket 'unknown'), go straight
 *  to `|all`: it holds every sample at the trade's max jobCount, strictly
 *  dominating the meaningless would-be `|unknown` subset. */
export function lookupPace(book: PaceBook, trade: string, sqft: number | undefined): PaceBookEntry | null {
  const t = (trade || '').trim().toLowerCase();
  if (!t) return null;
  const bucket = bucketForSqft(sqft);
  if (bucket !== 'unknown') {
    const exact = book.entries.find(e => e.key === `${t}|${bucket}`);
    if (exact) return exact;
  }
  return book.entries.find(e => e.key === `${t}|all`) ?? null;
}

/** Blend the proposed duration toward your measured mean: w = jobCount/(jobCount+K).
 *  Rounding is half-UP (Math.round): a blended 8.5 suggests 9 — canonical. */
export function suggestDuration(entry: PaceBookEntry, proposedDays: number): number {
  const w = entry.jobCount / (entry.jobCount + PACE_BLEND_K);
  return Math.round(Math.max(1, (1 - w) * proposedDays + w * entry.actualMean));
}

export interface PaceSuggestion {
  days: number;
  jobCount: number;
  confidence: 'medium' | 'high';
}

/**
 * The chip decision in one pure place (shared by schedule-review's paceFor
 * and the validator): suggest only when the book knows this task's trade at
 * medium+ confidence AND disagrees with the proposed duration by at least a
 * day. The 'general' inference fallback NEVER suggests — its entries pool
 * unrelated miscellaneous tasks (mobilization, permits, cleanup) whose
 * blended mean says nothing about the task at hand. Null = stay silent.
 */
export function paceSuggestionFor(
  book: PaceBook,
  task: ScheduleTask,
  sqft: number | undefined,
): PaceSuggestion | null {
  if (task.isMilestone || task.durationDays <= 0) return null;
  const trade = tradeKeyForTask(task);
  if (trade === 'general') return null;
  const entry = lookupPace(book, trade, sqft);
  if (!entry || entry.confidence === 'low') return null;
  const days = suggestDuration(entry, task.durationDays);
  if (Math.abs(days - task.durationDays) < 1) return null;
  return { days, jobCount: entry.jobCount, confidence: entry.confidence };
}
