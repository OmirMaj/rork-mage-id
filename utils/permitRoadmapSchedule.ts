// utils/permitRoadmapSchedule.ts — the roadmap's date + flag arithmetic, and
// nothing else. PURE: types only, no mageAI, no React, no network — which is
// the entire reason it is not in utils/permitRoadmap.ts any more.
//
// It lived there, three lines below `import { mageAISmart }`, so
// scripts/validate-learned-lead-time.ts could not import bookByDate or
// roadmapFlags without dragging react-native in through the AI client and
// dying on a Flow type in react-native/index.js. Untestable arithmetic is how
// "book-by date passed" shipped as a red banner computed from a number a
// language model invented. utils/permitRoadmap.ts re-exports both, so every
// existing caller and import path is unchanged.

import type { PermitRoadmap, RoadmapFlag, RoadmapInspection, ScheduleTask } from '@/types';

const MS_DAY = 86400000;

/**
 * The lead a book-by date is computed from, and whether that date is allowed
 * to be a DEADLINE.
 *
 * `bookByDate` used to read `insp.leadTimeDays` — the raw integer the model
 * returned — straight off the inspection, so an unverified LLM guess became a
 * calendar date and then a red "book-by date passed" banner with nothing on
 * screen saying where the number came from. The lead is now an ARGUMENT,
 * resolved by utils/automation/learnedLeadTime.ts, and it carries whether the
 * resulting date may be raised as hard.
 */
export interface RoadmapLead {
  /** Book-ahead lead in calendar days. */
  days: number;
  /** False for an `ai_estimate` lead: a date derived from a guess is not a
   *  deadline that passed, and must not render as one. */
  hardDate: boolean;
  /** Short provenance clause for the flag text, e.g. "an AI estimate, not
   *  your record". */
  sourceLabel: string;
}

export function bookByDate(
  insp: RoadmapInspection,
  tasks: ScheduleTask[],
  startDate: string,
  lead: RoadmapLead,
): Date | null {
  const t = insp.gatesTaskId ? tasks.find((x) => x.id === insp.gatesTaskId) : null;
  if (!t) return null;
  const base = new Date(startDate); base.setHours(0, 0, 0, 0);
  return new Date(base.getTime() + (t.startDay ?? 0) * MS_DAY - lead.days * MS_DAY);
}

/**
 * `leadFor` resolves the lead for one inspection. It is injected rather than
 * read off the inspection so this function cannot silently go back to trusting
 * `insp.leadTimeDays`, and so the flag text can name where the number came
 * from.
 *
 * SEVERITY IS PROVENANCE-AWARE. An overdue book-by date raises 'high' only
 * when the lead behind it is grounded (learned from the contractor's own
 * records, a jurisdiction dataset, or the labelled seeded default). An
 * `ai_estimate` lead raises 'med' and says in the message that the deadline is
 * only as real as a guess — a red "book-by date passed" banner sourced from an
 * LLM-sized integer is the exact defect this change exists to remove.
 */
export function roadmapFlags(
  roadmap: PermitRoadmap,
  tasks: ScheduleTask[],
  startDate: string,
  leadFor: (insp: RoadmapInspection) => RoadmapLead,
): RoadmapFlag[] {
  const out: RoadmapFlag[] = [];
  const now = Date.now();
  for (const insp of roadmap.inspections) {
    if (insp.status === 'passed') continue;
    const lead = leadFor(insp);
    const by = bookByDate(insp, tasks, startDate, lead);
    if (by && by.getTime() <= now + 7 * MS_DAY) {
      const overdue = by.getTime() < now;
      const when = by.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const message = overdue
        ? lead.hardDate
          ? `${insp.title}: book-by date passed (${lead.days}d lead, ${lead.sourceLabel})`
          : `${insp.title}: book-by date passed IF the ~${lead.days}d lead is right — ${lead.sourceLabel}, confirm with the AHJ`
        : `${insp.title}: book by ${when} (${lead.days}d lead, ${lead.sourceLabel})`;
      out.push({
        kind: 'inspection',
        itemId: insp.id,
        severity: overdue && lead.hardDate ? 'high' : 'med',
        message,
      });
    }
  }
  for (const p of roadmap.permits) {
    if (p.status === 'needed') out.push({ kind: 'permit', itemId: p.id, severity: 'med', message: `${p.title}: not pulled yet` });
  }
  return out;
}
