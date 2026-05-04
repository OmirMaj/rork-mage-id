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

import type { ScheduleTask } from '@/types';
import type { CpmResult } from '@/utils/cpm';

export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface HealthCheck {
  /** Stable key for filtering / linking to fix flows. */
  key:
    | 'has_tasks'
    | 'logic_completeness'
    | 'open_ends'
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
  /** DCMA 14-Point Schedule Assessment label, when applicable. Tagging
   *  our checks against DCMA names lets contractors bidding government /
   *  federal work claim DCMA-grade schedule QA out of the box. Skipped
   *  for checks that don't map cleanly (phase grouping, milestone clarity). */
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

interface ScoreInput {
  tasks: ScheduleTask[];
  cpm: CpmResult;
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
export function computeScheduleHealthScore({ tasks, cpm }: ScoreInput): HealthScoreResult {
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
      dcmaLabel: 'DCMA #2 — Leads / DCMA #3 — Lags (proxy)',
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
      dcmaLabel: 'DCMA #6 — High Float / DCMA #12 — Critical Path Test',
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
      dcmaLabel: 'DCMA #5 — Hard Constraints (proxy)',
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
        dcmaLabel: 'DCMA #14 — Baseline Execution Index (BEI)',
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
      const taskEnd = t.startDay + t.durationDays - 1;
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
      dcmaLabel: 'DCMA #11 — Missed Tasks',
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
    const conflicts = cpm.conflicts ?? [];
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
    const criticalNoNote = leafTasks.filter(t =>
      t.isCriticalPath && (!t.notes || t.notes.trim().length === 0),
    );
    const criticalLeafCount = leafTasks.filter(t => t.isCriticalPath).length;
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
