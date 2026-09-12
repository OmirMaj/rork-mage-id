// scheduleHealthScore — graded diagnostic of a CPM schedule.
//
// Inspired by SmartPM's 0-100 Health Score and Asta Powerproject's
// DCMA/CIOB metrics, but tuned for residential GCs (smaller schedules,
// lighter dependencies, more progress fields). The output is a single
// 0-100 score plus a breakdown of contributing checks so the user can
// see *why* their schedule is graded the way it is — and what to fix.
//
// Each check returns a value 0..1 (1 = perfect) and a weight. Final
// score = round(100 * Σ(value × weight) / Σ(weights)).
//
// Why a single number: most users can't internalize 15 metrics at once.
// A 78/100 with a "what's hurting your score" list is the right UX bar.
// Pros can drill into the breakdown.
//
// ── SCORING CHANGE, 2026-09-11 — read before comparing a score to an old one ─
// The 2026-09-07 audit asked only for the DCMA LABELS to stop citing items this
// file did not implement (three checks named the wrong item and one invented a
// "#14 BEI" that was never here). Fixing the labels honestly meant fixing what
// they pointed AT, so seven checks were added or given a real DCMA identity in
// the same pass:
//
//     #2  Leads                w=4    (new)
//     #3  Lags                 w=3    (new)
//     #4  Relationship Types   w=4    (new)
//     #5  Hard Constraints     w=5    (new)
//     #7  Negative Float       w=6    (new)
//     #9  Invalid Dates        w=6    (new)
//     #13 CPLI                 w=4    (new, refuses rather than guessing when
//                                      there is no baseline or no calendar)
//
// That is a PRODUCT change, not a bug fix, and it is flagged here rather than
// left to be discovered: **an existing schedule's score will move.** New
// weights total 32 against denominators that were previously smaller, so a
// schedule with leads, lags, SS/FF chains or hard pins scores lower than it did
// on 2026-09-06, and a clean one scores about the same. Nothing is persisted
// that a migration could fix — `computeScheduleHealthScore` runs on render — so
// the only visible effect is the number changing once. It is not shown in the
// UI as "recalculated"; if that matters, the badge is the place to say so.
//
// The alternative was to keep the four honest checks and delete the DCMA claim,
// which would have made the marketing copy ("DCMA 14-point") false in the other
// direction. `DCMA_COVERAGE` is now the exported, audited source of truth for
// which of the fourteen items are implemented, approximated, or absent, and
// scripts/validate-schedule-health.ts fails if any label drifts from it.

import type { ScheduleTask, DependencyLink } from '@/types';
import { calendarIndexToWorkingOrdinal, type CpmResult, type DayScaleOptions } from '@/utils/cpm';

export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface HealthCheck {
  /** Stable key for filtering / linking to fix flows. */
  key:
    | 'has_tasks'
    | 'logic_completeness'
    | 'open_ends'
    | 'leads'
    | 'lags'
    | 'relationship_types'
    | 'hard_constraints'
    | 'negative_float'
    | 'invalid_dates'
    | 'cpli'
    | 'critical_density'
    | 'long_tasks'
    | 'missing_durations'
    | 'baseline_drift'
    | 'progress_freshness'
    | 'resource_overallocation'
    | 'milestone_clarity'
    | 'phase_grouping'
    | 'note_completeness';
  /** Display name. */
  label: string;
  /**
   * DCMA 14-Point Schedule Assessment label, when — and ONLY when — the check
   * actually measures that item. See DCMA_COVERAGE below for the audited map.
   *
   * These labels used to be decorative: "Open ends" was tagged "#2 Leads / #3
   * Lags" when open ends are #1 Logic, "Realistic durations" was tagged "#5
   * Hard Constraints" when duration is #8, "Critical-path density" claimed "#6
   * High Float / #12 Critical Path Test" when it measures neither, and
   * "Baseline drift" claimed "#14 BEI" when BEI is a specific completed÷due
   * ratio this app cannot compute without a data date. A contractor who put
   * that output in front of a federal owner's scheduler was making a claim the
   * labels themselves would fail.
   */
  dcmaLabel?: string;
  /** 1-line explainer of what the check measures. */
  description: string;
  /** 0..1 — perfect = 1. */
  value: number;
  /** Weight in the final score. Higher = more punishing. */
  weight: number;
  /** Specific items that triggered the check (task ids + brief detail). */
  flagged: { id: string; title: string; reason: string }[];
  /** Tone for UI rendering. */
  severity: 'good' | 'warn' | 'bad';
  /** What the user should do to lift this. Plain English, action-oriented. */
  suggestion: string;
}

export interface HealthScoreResult {
  /** 0-100 integer. */
  score: number;
  grade: HealthGrade;
  /** One-line summary tone. */
  summary: string;
  checks: HealthCheck[];
  /** When the score was computed. */
  computedAt: string;
}

/**
 * WHICH DCMA 14-POINT ITEMS THIS FILE ACTUALLY IMPLEMENTS.
 *
 * The 14 items (Deltek Acumen's published numbering):
 *   1 Logic · 2 Leads · 3 Lags · 4 Relationship Types · 5 Hard Constraints ·
 *   6 High Float · 7 Negative Float · 8 High Duration · 9 Invalid Dates ·
 *   10 Resources · 11 Missed Tasks · 12 Critical Path Test · 13 CPLI · 14 BEI
 *
 * IMPLEMENTED (10): 1, 2, 3, 4, 5, 7, 8, 9, 10, 13 — every one computed from
 * data the app already holds (DependencyLink.type/lagDays, anchorType,
 * CpmTaskResult.totalFloat, the actual/baseline day fields).
 *
 * PARTIAL: 11 Missed Tasks — `progress_freshness` approximates it against the
 * CPM span rather than against a data date.
 *
 * NOT IMPLEMENTED, and deliberately not labelled as if they were:
 *   6  High Float      — DCMA's test is float > 44 WORKING days on >5% of
 *                        tasks. Cheap to add now that totalFloat is in working
 *                        days; not in scope for this pass.
 *   12 Critical Path Test — needs a perturbation run (add 600 days to a
 *                        critical activity, check the finish moves the same).
 *   14 BEI             — (baseline tasks completed) ÷ (baseline tasks DUE by
 *                        the data date). This engine has no data date by
 *                        deliberate design (types/index.ts: "the plan stays the
 *                        plan until you say so"), so the denominator does not
 *                        exist. `baseline_drift` measures slippage, which is a
 *                        different and honest thing.
 *
 * Keep this list true. It is the only thing standing behind the file header's
 * claim that a contractor can put this output in front of a federal owner.
 */
export const DCMA_COVERAGE = {
  implemented: [1, 2, 3, 4, 5, 7, 8, 9, 10, 13] as const,
  partial: [11] as const,
  notImplemented: [6, 12, 14] as const,
};

/** Typed links for a task, with the legacy `dependencies: string[]` (FS + 0 lag)
 *  folded in — the same normalization utils/cpm.ts getLinks does, so the DCMA
 *  link checks below count exactly the edges the engine schedules. */
function linksOf(t: ScheduleTask): DependencyLink[] {
  if (t.dependencyLinks && t.dependencyLinks.length > 0) return t.dependencyLinks;
  return (t.dependencies ?? []).map(id => ({ taskId: id, type: 'FS' as const, lagDays: 0 }));
}

interface ScoreInput {
  tasks: ScheduleTask[];
  cpm: CpmResult;
  /**
   * The project calendar. Needed only by CPLI, which has to put the CALENDAR
   * index `cpm.projectFinish` and the WORKING ordinal `baselineEndDay` in the
   * same unit before it can divide one by the other. Omit it and CPLI reports
   * "needs a baseline" rather than a number computed from mixed scales.
   */
  calendar?: DayScaleOptions;
}

function gradeFromScore(score: number): HealthGrade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function severityFromValue(v: number, weight: number): 'good' | 'warn' | 'bad' {
  // Weighted thresholds so high-weight checks trip "bad" sooner.
  void weight;
  if (v >= 0.85) return 'good';
  if (v >= 0.6) return 'warn';
  return 'bad';
}

/**
 * Compute the schedule health score.
 */
export function computeScheduleHealthScore({ tasks, cpm, calendar }: ScoreInput): HealthScoreResult {
  const checks: HealthCheck[] = [];

  // ── Check 1: has tasks ──────────────────────────────────────────────
  if (tasks.length === 0) {
    return {
      score: 0,
      grade: 'F',
      summary: 'Empty schedule — add a few tasks to get a real score.',
      checks: [{
        key: 'has_tasks',
        label: 'Schedule populated',
        description: 'Your schedule needs tasks to be evaluated.',
        value: 0,
        weight: 1,
        flagged: [],
        severity: 'bad',
        suggestion: 'Tap + on the schedule grid to add your first task, or run AI auto-schedule from the estimate.',
      }],
      computedAt: new Date().toISOString(),
    };
  }

  // Treat summaries as informational rows; they don't carry their own
  // dependencies / duration, so most checks should ignore them.
  const leafTasks = tasks.filter(t => !t.isSummary);

  // ── Check 2: Logic completeness ─────────────────────────────────────
  // A task with at least one predecessor or successor is "linked." The
  // first task naturally has no predecessor, the last no successor —
  // that's expected. A task in the middle with neither is suspicious.
  {
    const successorMap = new Map<string, number>();
    for (const t of leafTasks) {
      for (const dep of t.dependencies ?? []) {
        successorMap.set(dep, (successorMap.get(dep) ?? 0) + 1);
      }
    }
    const missing: { id: string; title: string; reason: string }[] = [];
    for (const t of leafTasks) {
      const hasPred = (t.dependencies?.length ?? 0) > 0;
      const hasSucc = (successorMap.get(t.id) ?? 0) > 0;
      if (!hasPred && !hasSucc && !t.isMilestone) {
        missing.push({ id: t.id, title: t.title, reason: 'No predecessor or successor' });
      }
    }
    const value = leafTasks.length === 0 ? 1 : 1 - (missing.length / leafTasks.length);
    const weight = 12;
    checks.push({
      key: 'logic_completeness',
      label: 'Logic completeness',
      dcmaLabel: 'DCMA #1 — Logic',
      description: 'Tasks should connect to others via dependencies. Floaters reveal missing logic.',
      value: Math.max(0, value),
      weight,
      flagged: missing.slice(0, 8),
      severity: severityFromValue(value, weight),
      suggestion: missing.length === 0
        ? 'Every task is linked into the chain. Strong logic.'
        : `Add a predecessor or successor to ${missing.length} unlinked task${missing.length === 1 ? '' : 's'}.`,
    });
  }

  // ── Check 3: Open ends ─────────────────────────────────────────────
  // More than one task should not have zero successors, and more than one
  // shouldn't have zero predecessors. (1 of each is fine — the start +
  // finish.) Beyond that you have detached chains.
  {
    const successorCount = new Map<string, number>();
    for (const t of leafTasks) {
      for (const dep of t.dependencies ?? []) {
        successorCount.set(dep, (successorCount.get(dep) ?? 0) + 1);
      }
    }
    const noPred = leafTasks.filter(t => (t.dependencies?.length ?? 0) === 0);
    const noSucc = leafTasks.filter(t => (successorCount.get(t.id) ?? 0) === 0);
    const extraStarts = Math.max(0, noPred.length - 1);
    const extraEnds = Math.max(0, noSucc.length - 1);
    const denom = leafTasks.length || 1;
    const value = 1 - Math.min(1, (extraStarts + extraEnds) / denom);
    const flagged: { id: string; title: string; reason: string }[] = [
      ...noPred.slice(1).map(t => ({ id: t.id, title: t.title, reason: 'Extra start (no predecessor)' })),
      ...noSucc.slice(1).map(t => ({ id: t.id, title: t.title, reason: 'Extra end (no successor)' })),
    ];
    const weight = 8;
    checks.push({
      key: 'open_ends',
      label: 'Open ends',
      dcmaLabel: 'DCMA #1 — Logic (open ends)',
      description: 'Pro schedules have one start and one finish. Multiple of either means detached chains.',
      value,
      weight,
      flagged: flagged.slice(0, 6),
      severity: severityFromValue(value, weight),
      suggestion: flagged.length === 0
        ? 'Single start, single finish. Clean chain.'
        : `Connect ${flagged.length} dangling task${flagged.length === 1 ? '' : 's'} into the main chain.`,
    });
  }

  // ── DCMA #2 Leads / #3 Lags ─────────────────────────────────────────
  // A LEAD is a negative lag: "start 2 days before the predecessor finishes".
  // DCMA's position is that leads should not exist at all (they hide logic and
  // break the forward pass's meaning), and that lags should be rare — under 5%
  // of links. The engine has supported both since v2.2d and nothing ever
  // flagged them.
  {
    const allLinks = leafTasks.flatMap(t => linksOf(t).map(l => ({ t, l })));
    const leads = allLinks.filter(x => (x.l.lagDays ?? 0) < 0);
    const denom = allLinks.length || 1;
    const value = 1 - Math.min(1, leads.length / denom);
    const weight = 4;
    checks.push({
      key: 'leads',
      label: 'Leads (negative lag)',
      dcmaLabel: 'DCMA #2 — Leads',
      description: 'A negative lag pulls a task earlier than its predecessor allows. DCMA wants zero.',
      value,
      weight,
      flagged: leads.slice(0, 6).map(x => ({
        id: x.t.id, title: x.t.title, reason: `${x.l.lagDays}d lead on a ${x.l.type ?? 'FS'} link`,
      })),
      severity: severityFromValue(value, weight),
      suggestion: leads.length === 0
        ? 'No leads. Every link waits for the work in front of it.'
        : `Replace ${leads.length} lead${leads.length === 1 ? '' : 's'} with a real predecessor — split the upstream task instead of overlapping it.`,
    });

    const lags = allLinks.filter(x => (x.l.lagDays ?? 0) > 0);
    // DCMA threshold: lags on no more than 5% of links.
    const lagRatio = lags.length / denom;
    const lagValue = lagRatio <= 0.05 ? 1 : Math.max(0, 1 - (lagRatio - 0.05) / 0.25);
    const lagWeight = 3;
    checks.push({
      key: 'lags',
      label: 'Lags',
      dcmaLabel: 'DCMA #3 — Lags',
      description: 'A lag is waiting time with no activity behind it. DCMA wants them on under 5% of links.',
      value: lagValue,
      weight: lagWeight,
      flagged: lags.slice(0, 6).map(x => ({
        id: x.t.id, title: x.t.title, reason: `+${x.l.lagDays}d lag on a ${x.l.type ?? 'FS'} link`,
      })),
      severity: severityFromValue(lagValue, lagWeight),
      suggestion: lags.length === 0
        ? 'No lags — every wait is modelled as real work.'
        : `${lags.length} of ${allLinks.length} links carry a lag (${Math.round(lagRatio * 100)}%). Model long waits as activities ("slab cure") so the client can see them.`,
    });

    // ── DCMA #4 Relationship Types ────────────────────────────────────
    // At least 90% of links should be Finish-to-Start. SS/FF/SF are legitimate
    // but each one is a place the plan can be misread; SF especially is almost
    // always an authoring mistake.
    const fs = allLinks.filter(x => (x.l.type ?? 'FS') === 'FS');
    const fsRatio = allLinks.length === 0 ? 1 : fs.length / allLinks.length;
    const relValue = fsRatio >= 0.9 ? 1 : Math.max(0, fsRatio / 0.9);
    const relWeight = 4;
    checks.push({
      key: 'relationship_types',
      label: 'Relationship types',
      dcmaLabel: 'DCMA #4 — Relationship Types',
      description: 'At least 90% of links should be Finish-to-Start. SS/FF/SF are harder to read and easier to get wrong.',
      value: relValue,
      weight: relWeight,
      flagged: allLinks.filter(x => (x.l.type ?? 'FS') !== 'FS').slice(0, 6).map(x => ({
        id: x.t.id, title: x.t.title, reason: `${x.l.type} link`,
      })),
      severity: severityFromValue(relValue, relWeight),
      suggestion: fsRatio >= 0.9
        ? `${Math.round(fsRatio * 100)}% of links are Finish-to-Start. Clean logic.`
        : `Only ${Math.round(fsRatio * 100)}% of links are Finish-to-Start. Convert the SS/FF/SF ones unless the overlap is real.`,
    });
  }

  // ── DCMA #5 Hard Constraints ────────────────────────────────────────
  // must-start-on / must-finish-on override the network: the task lands on the
  // pinned date whatever its predecessors say. DCMA wants them on under 5% of
  // tasks. The data is already on the row (`anchorType`) and nothing read it.
  {
    const hard = leafTasks.filter(t => t.anchorType === 'must-start-on' || t.anchorType === 'must-finish-on');
    const denom = leafTasks.length || 1;
    const ratio = hard.length / denom;
    const value = ratio <= 0.05 ? 1 : Math.max(0, 1 - (ratio - 0.05) / 0.25);
    const weight = 5;
    checks.push({
      key: 'hard_constraints',
      label: 'Hard date pins',
      dcmaLabel: 'DCMA #5 — Hard Constraints',
      description: 'Must-start-on / must-finish-on pins beat the logic. DCMA wants them on under 5% of tasks.',
      value,
      weight,
      flagged: hard.slice(0, 6).map(t => ({
        id: t.id, title: t.title, reason: `${t.anchorType} ${t.anchorDate ?? ''}`.trim(),
      })),
      severity: severityFromValue(value, weight),
      suggestion: hard.length === 0
        ? 'No hard pins — the finish date is driven by the logic, which is what makes it defensible.'
        : `${hard.length} task${hard.length === 1 ? ' is' : 's are'} hard-pinned. Use "start no earlier than" instead unless the date is contractual.`,
    });
  }

  // ── DCMA #7 Negative Float ──────────────────────────────────────────
  // Negative float means the plan is already impossible — a task must finish
  // before its own predecessors allow. The engine has computed it since the
  // backward pass was written and no surface ever said so.
  {
    const negative = leafTasks
      .map(t => ({ t, r: cpm.perTask.get(t.id) }))
      .filter((x): x is { t: ScheduleTask; r: NonNullable<typeof x.r> } => !!x.r && x.r.totalFloat < 0);
    const denom = leafTasks.length || 1;
    const value = 1 - Math.min(1, negative.length / denom);
    const weight = 10;
    checks.push({
      key: 'negative_float',
      label: 'Negative float',
      dcmaLabel: 'DCMA #7 — Negative Float',
      description: 'Negative float means the plan cannot be built as drawn — something has to give.',
      value,
      weight,
      flagged: negative.slice(0, 8).map(x => ({
        id: x.t.id, title: x.t.title, reason: `${x.r.totalFloat}d float — ${Math.abs(x.r.totalFloat)} working day(s) short`,
      })),
      severity: severityFromValue(value, weight),
      suggestion: negative.length === 0
        ? 'No negative float. Every task has room to be built where it sits.'
        : `${negative.length} task${negative.length === 1 ? '' : 's'} carry negative float. Move the deadline, shorten the work, or drop a hard pin.`,
    });
  }

  // ── DCMA #9 Invalid Dates ───────────────────────────────────────────
  // Rows whose own date fields contradict each other. DCMA's version tests
  // actuals against a data date; this engine has none by design, so the honest
  // subset is self-contradiction: an actual finish before its actual start, a
  // non-positive day number, an anchor type with no (or an unparseable) date,
  // and an unparseable deadline.
  {
    const bad: { id: string; title: string; reason: string }[] = [];
    const parses = (iso: string | undefined) => !!iso && Number.isFinite(Date.parse(iso.slice(0, 10) + 'T00:00:00Z'));
    for (const t of leafTasks) {
      if (t.actualStartDay != null && t.actualEndDay != null && t.actualEndDay < t.actualStartDay) {
        bad.push({ id: t.id, title: t.title, reason: `Actual finish (day ${t.actualEndDay}) is before actual start (day ${t.actualStartDay})` });
        continue;
      }
      if ((t.actualStartDay != null && t.actualStartDay < 1) || (t.actualEndDay != null && t.actualEndDay < 1)) {
        bad.push({ id: t.id, title: t.title, reason: 'Actual day number is not a real day' });
        continue;
      }
      if (t.anchorType && t.anchorType !== 'none' && t.anchorType !== 'as-late-as-possible' && !parses(t.anchorDate)) {
        bad.push({ id: t.id, title: t.title, reason: `${t.anchorType} pin with no usable date — the engine drops it silently` });
        continue;
      }
      if (t.deadline && !parses(t.deadline)) {
        bad.push({ id: t.id, title: t.title, reason: `Deadline "${t.deadline}" is not a date` });
      }
    }
    const denom = leafTasks.length || 1;
    const value = 1 - Math.min(1, bad.length / denom);
    const weight = 8;
    checks.push({
      key: 'invalid_dates',
      label: 'Invalid dates',
      dcmaLabel: 'DCMA #9 — Invalid Dates',
      description: 'Date fields that contradict themselves — an actual finish before its start, or a pin with no usable date.',
      value,
      weight,
      flagged: bad.slice(0, 8),
      severity: severityFromValue(value, weight),
      suggestion: bad.length === 0
        ? 'Every date on the schedule is internally consistent.'
        : `Fix ${bad.length} row${bad.length === 1 ? '' : 's'} whose dates contradict themselves — an anchor with no date is dropped by the engine without a word.`,
    });
  }

  // ── DCMA #13 CPLI (Critical Path Length Index) ──────────────────────
  // CPLI = (critical path length + project total float) / critical path length.
  // 1.00 = the plan finishes exactly on the baseline; below 0.95 is DCMA's
  // fail. Needs a baseline finish, which the rows already carry.
  {
    const withBaseline = leafTasks.filter(t => t.baselineEndDay != null);
    const weight = 6;
    if (withBaseline.length === 0 || cpm.projectFinish <= 1 || !calendar?.scheduleStartDate) {
      checks.push({
        key: 'cpli',
        label: 'Critical Path Length Index',
        dcmaLabel: 'DCMA #13 — CPLI',
        description: 'How the forecast finish compares to the promised one. Needs a baseline.',
        value: 0.5,
        weight,
        flagged: [],
        severity: 'warn',
        suggestion: withBaseline.length === 0
          ? 'Capture a baseline to turn CPLI on — it is the single number a federal or institutional owner asks for first.'
          : 'CPLI needs the project calendar to compare a working-day baseline against a calendar-day forecast. Set a start date on the schedule.',
      });
    } else {
      // Baseline days are WORKING ordinals (captureBaseline stores startDay +
      // dur - 1 with no weekend skipping); cpm.projectFinish is a CALENDAR
      // index. Put the forecast on the baseline's scale before dividing, or the
      // ratio is two different clocks and always reads late on a 5-day week.
      const baselineFinishOrdinal = Math.max(...withBaseline.map(t => t.baselineEndDay!));
      const cpl = Math.max(1, calendarIndexToWorkingOrdinal(cpm.projectFinish, calendar));
      const projectTotalFloat = baselineFinishOrdinal - cpl;
      const cpli = (cpl + projectTotalFloat) / cpl;
      // DCMA: >= 0.95 passes, 1.0 is on the money. Score linearly from 0.80.
      const value = Math.max(0, Math.min(1, (cpli - 0.8) / 0.2));
      checks.push({
        key: 'cpli',
        label: 'Critical Path Length Index',
        dcmaLabel: 'DCMA #13 — CPLI',
        description: 'CPLI = (critical path length + project float) ÷ critical path length. 1.00 hits the baseline; DCMA fails under 0.95.',
        value,
        weight,
        flagged: [],
        severity: severityFromValue(value, weight),
        suggestion: cpli >= 1
          ? `CPLI ${cpli.toFixed(2)} — the forecast finishes on or inside the baseline.`
          : `CPLI ${cpli.toFixed(2)} — the forecast runs ${Math.abs(projectTotalFloat)} working day(s) past the baseline. Recover time on the critical path or rebaseline and say why.`,
      });
    }
  }

  // ── Check 4: Critical-path density ──────────────────────────────────
  // 100% critical = brittle. 0% critical = no chain at all. 25-50% is
  // the sweet spot for a healthy CPM-driven schedule.
  {
    const criticalCount = cpm.criticalPath.length;
    const ratio = leafTasks.length === 0 ? 0 : criticalCount / leafTasks.length;
    let value: number;
    if (ratio >= 0.25 && ratio <= 0.55) value = 1;
    else if (ratio < 0.25) value = ratio / 0.25;
    else value = Math.max(0, 1 - (ratio - 0.55) / 0.4);
    const weight = 8;
    checks.push({
      key: 'critical_density',
      label: 'Critical-path density',
      description: '25–55% of tasks on the critical path is the sweet spot. Higher is brittle, lower means no real chain.',
      value,
      weight,
      flagged: [],
      severity: severityFromValue(value, weight),
      suggestion: ratio < 0.25
        ? 'Few tasks are critical — usually means missing dependencies. Add predecessor links so a real chain forms.'
        : ratio > 0.55
          ? 'Almost everything is critical — the schedule is brittle. Add float by sequencing parallel tasks.'
          : 'Critical-path density is healthy.',
    });
  }

  // ── Check 5: Long tasks ────────────────────────────────────────────
  // Tasks longer than 20 working days are usually a hidden compound
  // activity. DCMA's threshold is 44 days (2 months); residential GCs
  // benefit from a tighter cap.
  {
    const longThreshold = 20;
    const longTasks = leafTasks.filter(t => t.durationDays > longThreshold);
    const denom = leafTasks.length || 1;
    const value = 1 - Math.min(1, longTasks.length / denom);
    const weight = 5;
    checks.push({
      key: 'long_tasks',
      label: 'Long tasks',
      dcmaLabel: 'DCMA #8 — High Duration',
      description: `Activities longer than ${longThreshold} working days hide compound work. Break them down.`,
      value,
      weight,
      flagged: longTasks.slice(0, 6).map(t => ({ id: t.id, title: t.title, reason: `${t.durationDays} days` })),
      severity: severityFromValue(value, weight),
      suggestion: longTasks.length === 0
        ? 'No long tasks. Activities are appropriately scoped.'
        : `Break down ${longTasks.length} long task${longTasks.length === 1 ? '' : 's'} into smaller steps for better tracking.`,
    });
  }

  // ── Check 6: Missing durations ──────────────────────────────────────
  // A duration of 0 is OK only on milestones. Anything else is broken.
  {
    const broken = leafTasks.filter(t => t.durationDays <= 0 && !t.isMilestone);
    const denom = leafTasks.length || 1;
    const value = 1 - Math.min(1, broken.length / denom);
    const weight = 7;
    checks.push({
      key: 'missing_durations',
      label: 'Realistic durations',
      description: 'Every non-milestone task should have a duration of 1+ day.',
      value,
      weight,
      flagged: broken.slice(0, 6).map(t => ({ id: t.id, title: t.title, reason: 'Duration is 0' })),
      severity: severityFromValue(value, weight),
      suggestion: broken.length === 0
        ? 'All tasks have realistic durations.'
        : `Set a duration on ${broken.length} task${broken.length === 1 ? '' : 's'} that currently show 0 days.`,
    });
  }

  // ── Check 7: Baseline drift ─────────────────────────────────────────
  // For tasks with a baseline, how many are slipping vs. the baseline.
  {
    const withBaseline = leafTasks.filter(t => t.baselineStartDay != null && t.baselineEndDay != null);
    if (withBaseline.length === 0) {
      const weight = 6;
      checks.push({
        key: 'baseline_drift',
        label: 'Baseline drift',
        description: 'Capture a baseline so we can track slippage over time.',
        value: 0.5,
        weight,
        flagged: [],
        severity: 'warn',
        suggestion: 'Tap "Baseline" in the toolbar to capture a snapshot. Slippage tracking will activate after.',
      });
    } else {
      const slipped = withBaseline.filter(t => {
        const baseEnd = t.baselineEndDay ?? 0;
        const currentEnd = t.startDay + t.durationDays - 1;
        return currentEnd > baseEnd;
      });
      const value = withBaseline.length === 0 ? 1 : 1 - (slipped.length / withBaseline.length);
      const weight = 10;
      checks.push({
        key: 'baseline_drift',
        label: 'Baseline drift',
        description: 'How many tasks have slipped past their captured baseline end.',
        value,
        weight,
        flagged: slipped.slice(0, 8).map(t => {
          const baseEnd = t.baselineEndDay ?? 0;
          const currentEnd = t.startDay + t.durationDays - 1;
          return { id: t.id, title: t.title, reason: `+${currentEnd - baseEnd} day${currentEnd - baseEnd === 1 ? '' : 's'} vs baseline` };
        }),
        severity: severityFromValue(value, weight),
        suggestion: slipped.length === 0
          ? 'Schedule tracking on or ahead of baseline.'
          : `${slipped.length} task${slipped.length === 1 ? '' : 's'} slipped past baseline. Update the plan or recapture the baseline if scope changed.`,
      });
    }
  }

  // ── Check 8: Progress freshness ────────────────────────────────────
  // Tasks that should be in progress / done by today but show 0%
  // progress suggest the schedule isn't being maintained.
  {
    const stale: { id: string; title: string; reason: string }[] = [];
    // We don't know "today's day" without project start — approximate by
    // asking how many tasks are past their planned end (per CPM) but show
    // zero progress.
    const projectFinish = cpm.projectFinish;
    const halfwayThroughProject = projectFinish * 0.5;
    for (const t of leafTasks) {
      // `t.startDay + t.durationDays - 1` mixed a WORKING ordinal with a
      // WORKING duration and compared the result against cpm.projectFinish, a
      // CALENDAR index — so on a 5-day week every task read ~40% earlier than
      // it really finishes and this check flagged work that was not yet due.
      const taskEnd = cpm.perTask.get(t.id)?.ef ?? (t.startDay + t.durationDays - 1);
      if (taskEnd <= halfwayThroughProject && t.progress === 0 && t.status !== 'done') {
        stale.push({ id: t.id, title: t.title, reason: 'Past mid-project, still 0%' });
      }
    }
    const denom = leafTasks.length || 1;
    const value = 1 - Math.min(1, stale.length / denom);
    const weight = 6;
    checks.push({
      key: 'progress_freshness',
      label: 'Progress freshness',
      dcmaLabel: 'DCMA #11 — Missed Tasks (proxy — no data date)',
      description: 'Tasks that should already be in progress but still show 0% suggest the plan isn\'t being maintained.',
      value,
      weight,
      flagged: stale.slice(0, 6),
      severity: severityFromValue(value, weight),
      suggestion: stale.length === 0
        ? 'Progress is being kept up to date.'
        : `Update progress on ${stale.length} task${stale.length === 1 ? '' : 's'} that should already be running.`,
    });
  }

  // ── Check 9: Resource overallocation ───────────────────────────────
  // Pull from CPM conflicts.
  {
    // RESOURCE conflicts only. This read `cpm.conflicts` whole, so a dependency
    // cycle, an anchor violation and (since 2026-09-12) a link to a deleted task
    // all landed in a check labelled "DCMA #10 — Resources" and were reported to
    // the user as "crew conflicts — reassign or sequence the overlapping tasks",
    // which is advice that cannot fix any of them. levelResources is the only
    // producer of these two kinds (utils/cpm.ts), and they are what DCMA #10 is
    // about.
    const conflicts = (cpm.conflicts ?? []).filter(
      c => c.kind === 'resource_overallocation' || c.kind === 'resource_delayed_project',
    );
    const denom = leafTasks.length || 1;
    const value = 1 - Math.min(1, conflicts.length / denom);
    const weight = 6;
    const taskById = new Map(leafTasks.map(t => [t.id, t]));
    checks.push({
      key: 'resource_overallocation',
      label: 'Resource overallocation',
      dcmaLabel: 'DCMA #10 — Resources',
      description: 'Same crew assigned to overlapping tasks creates a real-world conflict.',
      value,
      weight,
      flagged: conflicts.slice(0, 6).map(c => {
        const firstId = c.taskIds[0] ?? '';
        const t = taskById.get(firstId);
        return {
          id: firstId,
          title: t?.title ?? firstId,
          reason: c.message,
        };
      }),
      severity: severityFromValue(value, weight),
      suggestion: conflicts.length === 0
        ? 'No crew conflicts detected.'
        : `Resolve ${conflicts.length} crew conflict${conflicts.length === 1 ? '' : 's'} — reassign or sequence the overlapping tasks.`,
    });
  }

  // ── Check 10: Milestone clarity ────────────────────────────────────
  // Healthy schedules name their milestones (foundation pour, dry-in,
  // C of O). One milestone per ~10-15 leaf tasks is a reasonable target.
  {
    const milestoneCount = leafTasks.filter(t => t.isMilestone).length;
    const target = Math.max(2, Math.floor(leafTasks.length / 12));
    const value = milestoneCount === 0 ? 0 : Math.min(1, milestoneCount / target);
    const weight = 4;
    checks.push({
      key: 'milestone_clarity',
      label: 'Milestone clarity',
      description: 'Named milestones (foundation, dry-in, C of O) anchor the schedule for the GC + client.',
      value,
      weight,
      flagged: [],
      severity: severityFromValue(value, weight),
      suggestion: milestoneCount === 0
        ? 'Add at least one milestone (e.g. foundation pour, dry-in, C of O) to anchor the schedule.'
        : milestoneCount < target
          ? `Add a few more milestones — ${target} total is a healthy target for this schedule size.`
          : 'Milestones are well distributed.',
    });
  }

  // ── Check 11: Phase grouping ───────────────────────────────────────
  // Tasks should be grouped under named phases. "General" or empty is a
  // weak signal that the schedule wasn't intentionally organized.
  {
    const phasedTasks = leafTasks.filter(t =>
      t.phase && t.phase.trim().length > 0 && t.phase.toLowerCase() !== 'general',
    );
    const value = leafTasks.length === 0 ? 1 : phasedTasks.length / leafTasks.length;
    const weight = 4;
    checks.push({
      key: 'phase_grouping',
      label: 'Phase grouping',
      description: 'Tasks should sit under named phases (Demo, Frame, MEP, Finishes) — not all "General".',
      value,
      weight,
      flagged: [],
      severity: severityFromValue(value, weight),
      suggestion: value >= 0.85
        ? 'Phases are well organized.'
        : 'Group remaining tasks under named phases. Helps the team and the client see the rhythm.',
    });
  }

  // ── Check 12: Note completeness on critical tasks ──────────────────
  // Critical-path tasks without notes are a soft red flag — there's no
  // context for the GC if a sub asks "why is this on the critical path."
  {
    // Critical per the ENGINE, not per `task.isCriticalPath` — that field is
    // written once by the AI generator / template seed code and (until the
    // stamp added in schedule-pro's persist) never refreshed, so this check
    // used to grade the schedule against a language model's guess.
    const isCrit = (t: ScheduleTask) => cpm.perTask.get(t.id)?.isCritical ?? !!t.isCriticalPath;
    const criticalNoNote = leafTasks.filter(t =>
      isCrit(t) && (!t.notes || t.notes.trim().length === 0),
    );
    const criticalLeafCount = leafTasks.filter(isCrit).length;
    const value = criticalLeafCount === 0
      ? 1
      : 1 - (criticalNoNote.length / criticalLeafCount);
    const weight = 3;
    checks.push({
      key: 'note_completeness',
      label: 'Critical-task notes',
      description: 'Critical-path tasks should have a short note explaining why they\'re critical.',
      value,
      weight,
      flagged: criticalNoNote.slice(0, 4).map(t => ({ id: t.id, title: t.title, reason: 'On critical path, no note' })),
      severity: severityFromValue(value, weight),
      suggestion: criticalNoNote.length === 0
        ? 'Critical-path tasks have context.'
        : `Add a one-line note on ${criticalNoNote.length} critical-path task${criticalNoNote.length === 1 ? '' : 's'}.`,
    });
  }

  // ── Final score ────────────────────────────────────────────────────
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const weightedSum = checks.reduce((s, c) => s + c.value * c.weight, 0);
  const score = totalWeight === 0 ? 0 : Math.round((weightedSum / totalWeight) * 100);
  const grade = gradeFromScore(score);

  const summary = (() => {
    if (score >= 90) return `Excellent (${grade}). Schedule is professional-grade.`;
    if (score >= 80) return `Solid (${grade}). Few small fixes can lift this to A.`;
    if (score >= 70) return `Decent (${grade}). Several improvements available below.`;
    if (score >= 60) return `Needs work (${grade}). Address the red flags before bidding off this.`;
    return `Significant gaps (${grade}). Run AI auto-schedule or rebuild from the estimate.`;
  })();

  return {
    score,
    grade,
    summary,
    checks,
    computedAt: new Date().toISOString(),
  };
}
