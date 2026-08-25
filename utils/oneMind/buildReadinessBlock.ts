// utils/oneMind/buildReadinessBlock.ts — "am I ready for next week?" fact block.
//
// Surfaces the Last Planner lookahead engine (utils/lastPlanner.ts) inside Ask:
// for a project's next three weeks, which scheduled tasks are NOT ready because
// they carry open constraints, and what's blocking them. Answers the field
// question from the real constraint log instead of a gut check. Pure + additive;
// returns null when there's no schedule to assess.

import type { Project } from '@/types';
import { buildLookahead, CONSTRAINT_LABELS, type Constraint } from '@/utils/lastPlanner';
import type { FactBlock } from './factBlocks';

export function buildReadinessBlock(
  project: Project,
  constraints: Constraint[],
  now: Date = new Date(),
): FactBlock | null {
  const tasks = project.schedule?.tasks ?? [];
  if (tasks.length === 0) return null;

  const result = buildLookahead(tasks, project.schedule?.startDate ?? null, constraints, { weeks: 3, asOf: now });
  if (!result.hasSchedule || result.totalTasks === 0) return null;

  const open = constraints.filter(c => c.status === 'open');
  const facts: string[] = [
    `Next 3 weeks: ${result.totalTasks} task(s) scheduled, ${result.constrainedCount} not ready (open constraints).`,
  ];

  if (result.constrainedCount === 0) {
    facts.push(open.length === 0
      ? 'No open constraints are logged, so everything reads ready — but that only reflects what is in the constraint log.'
      : 'All tasks in the window are ready; the open constraints sit on tasks further out.');
  } else {
    const constrained = result.weeks
      .flatMap(w => w.entries)
      .filter(e => e.readiness === 'constrained')
      .slice(0, 3);
    for (const e of constrained) {
      const cats = Array.from(new Set(e.openConstraints.map(c => CONSTRAINT_LABELS[c.category])))
        .filter(Boolean).join(', ');
      facts.push(`"${e.task.title}" (week of ${e.weekStart.slice(5)}) blocked by ${cats || 'open constraints'}.`);
    }
    facts.push('Clear these to protect the start dates — earliest need-by dates first.');
  }

  return {
    domain: 'READINESS LOOKAHEAD',
    ref: 'READY',
    facts,
    drillIn: { pathname: '/last-planner', params: { projectId: project.id } },
  };
}
