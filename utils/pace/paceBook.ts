// utils/pace/paceBook.ts — your pace, learned from your finished work.
//
// Time-twin of utils/costDatabase.ts (money): reads every project's schedule,
// takes tasks whose as-built dates were captured (both actualStartDay AND
// actualEndDay — utils/pace/stampActuals.ts is the capture flywheel), and
// distils per-trade duration entries: what "Framing" ACTUALLY takes this
// contractor, by project-size bucket, with a variability band and a read on
// whether they plan optimistic. Samples come from ALL projects, not only
// closed ones — a finished task on an active job is a valid pace sample.
//
// Cold-start mirrors the cost DB: suggestDuration blends the AI's proposed
// duration (the prior) toward the measured mean with w = n/(n+K), K=3 — with
// one job it leans on the plan; by the fifth it's mostly your real pace.
//
// Pure function — no storage, no network. Derived live from ProjectContext
// data via useMemo where surfaced.
import type { Project, ScheduleTask } from '@/types';
import { tradeKeyForTask } from '@/utils/scheduleColors';

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
  /** task.durationDays at sampling time — the plan. */
  plannedDays: number;
  /** actualEndDay − actualStartDay + 1, clamped ≥ 1 — the reality. */
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

/** Project-size buckets: small <2000 | medium 2000–3499 | large 3500–5999 | xlarge ≥6000. */
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
    const tasks: ScheduleTask[] = project?.schedule?.tasks ?? [];
    const sqftBucket = bucketForSqft(project?.squareFootage);
    let contributed = false;
    for (const task of tasks) {
      if (!task) continue;
      // Milestones carry no duration signal; a task becomes a sample only
      // once BOTH as-built ends were captured.
      if (task.isMilestone || !(task.durationDays > 0)) continue;
      if (typeof task.actualStartDay !== 'number' || typeof task.actualEndDay !== 'number') continue;
      const sample: PaceSample = {
        projectId: project.id,
        projectName: project.name,
        trade: tradeKeyForTask(task),
        sqftBucket,
        plannedDays: Math.max(1, Math.round(task.durationDays)),
        actualDays: Math.max(1, task.actualEndDay - task.actualStartDay + 1),
        completedAt: task.actualEndDate ?? '',
      };
      push(`${sample.trade}|${sample.sqftBucket}`, sample);
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

/** Exact size-bucket entry first, then the trade-wide `|all` aggregate. */
export function lookupPace(book: PaceBook, trade: string, sqft: number | undefined): PaceBookEntry | null {
  const t = (trade || '').trim().toLowerCase();
  if (!t) return null;
  const exact = book.entries.find(e => e.key === `${t}|${bucketForSqft(sqft)}`);
  if (exact) return exact;
  return book.entries.find(e => e.key === `${t}|all`) ?? null;
}

/** Blend the proposed duration toward your measured mean: w = jobCount/(jobCount+K). */
export function suggestDuration(entry: PaceBookEntry, proposedDays: number): number {
  const w = entry.jobCount / (entry.jobCount + PACE_BLEND_K);
  return Math.round(Math.max(1, (1 - w) * proposedDays + w * entry.actualMean));
}
