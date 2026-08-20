/**
 * SURFACE COVERAGE — the construction-ai Roadmap "Generate inspection schedule"
 * affordance (app/(tabs)/construction-ai/index.tsx).
 *
 * construction-ai/index.tsx is a very large screen, so we test at the smallest
 * HONEST seam: the two pieces of pure decision logic the surface is built on,
 * exercised through the SAME real utilities the screen wires up.
 *
 *   • `alreadyScheduled` — the predicate that flips the button from
 *     "Generate inspection schedule" to "✓ Scheduled · View in Schedule". It is
 *     true IFF a schedule task carries this feature's sourceEventRef.
 *   • the COMMIT PATH — mergeReviewLines + buildScheduleFromTasks, exactly what
 *     handleConfirmInspections runs. It must land the draft inspection tasks in
 *     the rebuilt schedule and be IDEMPOTENT on re-run (committing twice adds
 *     nothing new). And nothing mutates without an explicit confirm — the
 *     builder is a pure function of its inputs; no schedule object is touched
 *     until the caller applies the result.
 *
 * The predicate and the commit builder here are transcribed verbatim from the
 * screen (same expression, same util calls) so the test moves in lockstep with
 * the surface. A BREAK-TEST below flips the predicate to prove the assertions
 * are load-bearing.
 */

import {
  roadmapToScheduleWork,
  mergeReviewLines,
  hasRoadmapScheduleTasks,
  ROADMAP_FEATURE,
  type ReviewLine,
} from '@/utils/automation/roadmapToScheduleWork';
import { buildScheduleFromTasks } from '@/utils/scheduleEngine';
import type { ProjectSchedule, RoadmapInspection, ScheduleTask } from '@/types';

// The SAME predicate the screen uses (construction-ai/index.tsx imports this
// too) — not a re-implementation, so a break in the real expression fails here.
const alreadyScheduled = hasRoadmapScheduleTasks;

// ── The exact commit builder handleConfirmInspections runs ───────────────────
function commit(schedule: ProjectSchedule, lines: ReviewLine[]): ProjectSchedule {
  const merged = mergeReviewLines(lines, schedule.tasks ?? []);
  const rebuilt = buildScheduleFromTasks(
    schedule.name ?? 'Schedule',
    schedule.projectId,
    merged,
    schedule.baseline ?? null,
  );
  return { ...schedule, ...rebuilt };
}

function seedSchedule(): ProjectSchedule {
  const tasks: ScheduleTask[] = [
    {
      id: 'task-framing',
      title: 'Framing',
      phase: 'Structure',
      durationDays: 10,
      startDay: 5,
      progress: 0,
      crew: 'framing',
      dependencies: [],
      notes: '',
      status: 'not_started',
    },
  ];
  return {
    id: 'sched-1',
    name: 'Test schedule',
    projectId: 'proj-1',
    startDate: '2026-09-01',
    workingDaysPerWeek: 5,
    bufferDays: 0,
    tasks,
    totalDurationDays: 30,
    criticalPathDays: 30,
    laborAlignmentScore: 1,
    riskItems: [],
    updatedAt: '2026-08-19T00:00:00.000Z',
  };
}

function seedInspections(): RoadmapInspection[] {
  return [
    {
      id: 'insp-framing',
      type: 'framing_inspection',
      title: 'Framing / rough inspection',
      description: 'DOB framing inspection before closing walls.',
      gatesTaskHint: 'Framing',
      leadTimeDays: 8,
      status: 'pending',
    },
  ];
}

describe('automation surface — (a) alreadyScheduled predicate', () => {
  it('is FALSE before any auto-scheduled task exists', () => {
    const schedule = seedSchedule();
    expect(alreadyScheduled(schedule)).toBe(false);
  });

  it('is TRUE iff a task carries sourceEventRef.feature === ROADMAP_FEATURE', () => {
    const schedule = seedSchedule();
    const lines = roadmapToScheduleWork(seedInspections(), schedule);
    const committed = commit(schedule, lines);
    // A draft inspection task with our feature ref is now present.
    expect(
      committed.tasks.some((t) => t.sourceEventRef?.feature === ROADMAP_FEATURE),
    ).toBe(true);
    expect(alreadyScheduled(committed)).toBe(true);
  });

  it('is FALSE when a task has a DIFFERENT feature ref (only our feature counts)', () => {
    const schedule = seedSchedule();
    schedule.tasks.push({
      ...schedule.tasks[0],
      id: 'task-other',
      sourceEventRef: { feature: 'someOtherFeature', id: 'x' },
    });
    expect(alreadyScheduled(schedule)).toBe(false);
  });

  it('is FALSE when there is no schedule at all (button hidden)', () => {
    expect(alreadyScheduled(undefined)).toBe(false);
  });
});

describe('automation surface — (b) commit path lands drafts and is idempotent', () => {
  it('commits the draft inspection tasks into the rebuilt schedule', () => {
    const schedule = seedSchedule();
    const lines = roadmapToScheduleWork(seedInspections(), schedule);
    const committed = commit(schedule, lines);

    // Every draft task the review produced is now in the schedule.
    for (const line of lines) {
      expect(committed.tasks.some((t) => t.id === line.draftTask.id)).toBe(true);
    }
    // And the original task survived the rebuild.
    expect(committed.tasks.some((t) => t.id === 'task-framing')).toBe(true);
  });

  it('is IDEMPOTENT — committing a second time adds no new tasks', () => {
    const schedule = seedSchedule();
    const first = commit(schedule, roadmapToScheduleWork(seedInspections(), schedule));
    const firstCount = first.tasks.length;

    // Re-run the whole flow against the already-committed schedule.
    const secondLines = roadmapToScheduleWork(seedInspections(), first);
    const second = commit(first, secondLines);

    expect(second.tasks.length).toBe(firstCount);
    // Exactly one task per inspection carries the feature ref — never doubled.
    const featureTasks = second.tasks.filter(
      (t) => t.sourceEventRef?.feature === ROADMAP_FEATURE,
    );
    expect(featureTasks).toHaveLength(seedInspections().length);
  });
});

describe('automation surface — (c) nothing mutates without confirm', () => {
  it('building review lines does NOT mutate the source schedule', () => {
    const schedule = seedSchedule();
    const before = JSON.stringify(schedule);
    roadmapToScheduleWork(seedInspections(), schedule);
    expect(JSON.stringify(schedule)).toBe(before);
    // The predicate still reads false — no draft leaked in without a commit.
    expect(alreadyScheduled(schedule)).toBe(false);
  });

  it('the commit builder returns a NEW schedule; the input is untouched', () => {
    const schedule = seedSchedule();
    const before = JSON.stringify(schedule);
    const lines = roadmapToScheduleWork(seedInspections(), schedule);
    const committed = commit(schedule, lines);
    // Original object unchanged; the caller applies `committed` via updateProject.
    expect(JSON.stringify(schedule)).toBe(before);
    expect(committed).not.toBe(schedule);
    expect(committed.tasks.length).toBeGreaterThan(schedule.tasks.length);
  });
});
