// utils/scheduleExportIcal.ts — Phase 27.
//
// Client-side iCal export for the Pro Scheduler.
//
// Today this is the one-shot snapshot path: builds a static .ics file of the
// schedule tasks and opens the native share sheet via Sharing.shareAsync.
// Good for one-off delivery (email to client, save to Files).
//
// The live-subscription path is served separately by the `schedule-ical-url`
// edge function (deployed alongside Phase 27). When the client UX for that
// flow lands, it'll surface as a second option in ExportSheet.
//
// Reuses the existing `icsGenerator.ts` infrastructure — no duplicate ICS
// builder logic.

// showAlert, never Alert.alert — the raw one no-ops on web, so an empty
// schedule or a failed export produced complete silence.
import { showAlert } from '@/utils/alert';
import { exportProjectIcs } from '@/utils/icsGenerator';
import { UNDATED_SCHEDULE_BODY, UNDATED_SCHEDULE_TITLE } from '@/utils/scheduleOps';
import type { Project } from '@/types';

/**
 * One-shot .ics export. Called from ExportSheet.
 *
 * Pass `project` — the full project object. Invoices and warranties are
 * left empty here to keep the export focused on the schedule; those
 * extras are included when the user exports via the project-detail
 * Calendar tile (which provides them).
 */
export async function exportScheduleIcal(opts: { project: Project }): Promise<void> {
  await handleOneShot(opts.project);
}

async function handleOneShot(project: Project): Promise<void> {
  try {
    const result = await exportProjectIcs({
      project,
      invoices: [],
      warranties: [],
    });
    // An undated schedule produces an EMPTY file (icsGenerator refuses to
    // invent the anchor it used to take from today), and "no tasks yet" is
    // then a lie about a 20-task plan — trading an invented date for a false
    // sentence is not a fix. Say which of the two it actually is.
    const { undatedSchedule, skippedTaskCount } = result.scheduleSkip;
    if (undatedSchedule) {
      showAlert(
        UNDATED_SCHEDULE_TITLE,
        `${skippedTaskCount} task${skippedTaskCount === 1 ? '' : 's'} could not be exported. ${UNDATED_SCHEDULE_BODY}`,
      );
      return;
    }
    if (result.eventCount === 0) {
      showAlert('Nothing to export', 'This schedule has no tasks yet.');
    }
  } catch (e) {
    showAlert('Export failed', String(e));
  }
}
