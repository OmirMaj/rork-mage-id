// utils/schedulePreviewOverlay.ts — what a proposed schedule change WOULD do,
// in the shape the Gantt draws it (wave 6c, lane DA).
//
// WHY. The copilot proposes an edit ("push drywall a week", "add three tasks
// after rough-in") before anything is applied. Showing the proposal as a list
// of words made him read it; drawing it on the timeline he already reads —
// dashed outlines where bars would MOVE to, dashed rows for tasks that would
// be ADDED, a red wash over ones that would be REMOVED, and a marker at the
// new finish ("Finish +7d") — lets him see the ripple at a glance. Nothing is
// applied until he says so, so every mark is labelled "proposed".
//
// PURE: no React / react-native. Every day number here is a CALENDAR INDEX
// (the scale runCpm's es / ef and projectFinish are on — the same axis the
// Gantt draws). Lane DB's ScheduleDiffView imports the builder from here.

export interface SchedulePreviewOverlay {
  /** Tasks in both schedules whose scheduled span changed. */
  moved: { id: string; fromEs: number; fromEf: number; toEs: number; toEf: number }[];
  /** Tasks only in the proposal. `afterIndex` = the row (in the CURRENT task
   *  order) it would follow; −1 = before every current row. */
  added: { id: string; title: string; es: number; ef: number; isMilestone: boolean; afterIndex: number }[];
  /** Tasks the proposal would delete. */
  removedIds: string[];
  finishBefore: number;
  finishAfter: number;
  /** finishAfter − finishBefore, in calendar days (+ = later). */
  finishDeltaDays: number;
}

/** The two things the builder needs from a task and from a CPM run. */
interface PreviewTask { id: string; title?: string; isMilestone?: boolean; durationDays?: number }
interface PreviewCpm { perTask: Map<string, { es: number; ef: number }>; projectFinish: number }

export function buildSchedulePreviewOverlay(
  before: readonly PreviewTask[],
  after: readonly PreviewTask[],
  cpmBefore: PreviewCpm,
  cpmAfter: PreviewCpm,
): SchedulePreviewOverlay {
  const beforeIndex = new Map<string, number>();
  before.forEach((t, i) => { if (t && typeof t.id === 'string') beforeIndex.set(t.id, i); });
  const afterIds = new Set(after.filter((t) => t && typeof t.id === 'string').map((t) => t.id));

  const moved: SchedulePreviewOverlay['moved'] = [];
  const added: SchedulePreviewOverlay['added'] = [];
  let lastKnownIndex = -1;
  for (const t of after) {
    if (!t || typeof t.id !== 'string') continue;
    const was = beforeIndex.get(t.id);
    const next = cpmAfter.perTask.get(t.id);
    if (was != null) {
      lastKnownIndex = was;
      const prev = cpmBefore.perTask.get(t.id);
      if (prev && next && (prev.es !== next.es || prev.ef !== next.ef)) {
        moved.push({ id: t.id, fromEs: prev.es, fromEf: prev.ef, toEs: next.es, toEf: next.ef });
      }
      continue;
    }
    if (!next) continue; // the engine did not schedule it; nothing honest to draw
    added.push({
      id: t.id,
      title: t.title ?? '',
      es: next.es,
      ef: next.ef,
      isMilestone: !!t.isMilestone || t.durationDays === 0,
      afterIndex: lastKnownIndex,
    });
  }
  const removedIds = before.filter((t) => t && typeof t.id === 'string' && !afterIds.has(t.id)).map((t) => t.id);
  const finishBefore = cpmBefore.projectFinish;
  const finishAfter = cpmAfter.projectFinish;
  return { moved, added, removedIds, finishBefore, finishAfter, finishDeltaDays: finishAfter - finishBefore };
}

/** "Finish +7d" / "Finish −3d" / "Finish unchanged" — the pill on the marker. */
export function finishDeltaLabel(deltaDays: number): string {
  if (!Number.isFinite(deltaDays) || deltaDays === 0) return 'Finish unchanged';
  return deltaDays > 0 ? `Finish +${deltaDays}d` : `Finish −${Math.abs(deltaDays)}d`;
}
