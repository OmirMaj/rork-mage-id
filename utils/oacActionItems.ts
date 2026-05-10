// utils/oacActionItems.ts — OAC action item dock + auto carry-forward.
//
// Pre-fix the OAC flow auto-built agendas and extracted action items
// from voice transcripts (great), but once distributed those action
// items became orphans — no notification when due, no dock surface,
// no carry-forward into the next meeting's agenda. PM audit's
// "meetings produce decisions; without follow-up they're theater"
// finding.
//
// What this module gives:
//   - aggregateOpenActionItems: walks every meeting's actionItems
//     across the projects the GC owns, returns a flat list of OPEN
//     items + project context. Drives the "Open actions" dock that
//     project-detail's OAC tile and the Approvals dock can both
//     surface.
//   - groupOverdueByProject: filters to overdue items (dueBy < now)
//     and groups by project — feeds the daily morning-digest cron
//     so a GC sees "5 OAC actions overdue across 3 projects."
//   - carryForwardToNextMeeting: builds an agenda-item suggestion
//     list for the next OAC meeting from open action items,
//     prefilling them as "Carried from Meeting #N — review status."

import type { OACMeeting, OACActionItem, Project } from '@/types';

export interface OpenActionItem {
  item: OACActionItem;
  /** The meeting the action item came from. */
  meeting: OACMeeting;
  /** The project the meeting belongs to (denormalized for the dock). */
  project: Project;
  /** Days until due (negative = overdue). null when no dueBy. */
  daysUntilDue: number | null;
}

export function aggregateOpenActionItems(opts: {
  meetings: OACMeeting[];
  projects: Project[];
}): OpenActionItem[] {
  const { meetings, projects } = opts;
  const projectById = new Map(projects.map(p => [p.id, p]));
  const out: OpenActionItem[] = [];
  const today = Date.now();
  const dayMs = 86_400_000;

  for (const meeting of meetings) {
    const project = projectById.get(meeting.projectId);
    if (!project) continue;
    for (const item of meeting.actionItems ?? []) {
      if (item.status === 'done') continue;
      const dueMs = item.dueBy ? Date.parse(item.dueBy) : NaN;
      const daysUntilDue = Number.isFinite(dueMs)
        ? Math.round((dueMs - today) / dayMs)
        : null;
      out.push({ item, meeting, project, daysUntilDue });
    }
  }

  // Sort: overdue first (most-overdue at top), then due-soon, then
  // no-due-date, then alphabetical by project. This matches the
  // attention pattern a PM brings to a Monday morning OAC dock.
  out.sort((a, b) => {
    const aOver = a.daysUntilDue != null && a.daysUntilDue < 0;
    const bOver = b.daysUntilDue != null && b.daysUntilDue < 0;
    if (aOver && !bOver) return -1;
    if (!aOver && bOver) return 1;
    if (aOver && bOver) return (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0);
    if (a.daysUntilDue == null && b.daysUntilDue != null) return 1;
    if (a.daysUntilDue != null && b.daysUntilDue == null) return -1;
    if (a.daysUntilDue != null && b.daysUntilDue != null) {
      return a.daysUntilDue - b.daysUntilDue;
    }
    return a.project.name.localeCompare(b.project.name);
  });

  return out;
}

export function groupOverdueByProject(items: OpenActionItem[]): Map<string, OpenActionItem[]> {
  const out = new Map<string, OpenActionItem[]>();
  for (const it of items) {
    if (it.daysUntilDue == null || it.daysUntilDue >= 0) continue;
    if (!out.has(it.project.id)) out.set(it.project.id, []);
    out.get(it.project.id)!.push(it);
  }
  return out;
}

/**
 * Build "carried-forward" agenda items for the next meeting from any
 * still-open action items in the most-recent prior meeting on the
 * same project. The OAC meeting screen pre-fills these so the PM
 * doesn't have to remember last week's commitments.
 *
 * Returns one description string per open item — the OAC agenda
 * builder turns each into an agendaItem with a "Carried from
 * Meeting #N" prefix and the original ballInCourt.
 */
export function carryForwardToNextMeeting(opts: {
  projectMeetings: OACMeeting[];   // sorted by `number` asc
}): Array<{ description: string; ballInCourt: string; sourceItemId: string; sourceMeetingNumber: number }> {
  const { projectMeetings } = opts;
  if (projectMeetings.length === 0) return [];
  // The most recent CONCLUDED / DISTRIBUTED meeting on this project.
  // Don't carry from a draft — the PM hasn't run that meeting yet.
  const concluded = projectMeetings
    .filter(m => m.status === 'concluded' || m.status === 'distributed')
    .sort((a, b) => b.number - a.number);
  const last = concluded[0];
  if (!last) return [];
  return (last.actionItems ?? [])
    .filter(item => item.status !== 'done')
    .map(item => ({
      description: `Carried from Meeting #${last.number} — ${item.description}`,
      ballInCourt: item.ballInCourt,
      sourceItemId: item.id,
      sourceMeetingNumber: last.number,
    }));
}
