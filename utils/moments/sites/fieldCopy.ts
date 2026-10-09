// fieldCopy.ts: every word the field and closeout moments say (wave-next W2, lane MOMFIELD).
//
// The four sites: clocking out (app/time-tracking.tsx: your own shift, a
// crew member's shift on your project, a missed clock-out), closing the
// project from the punch list (app/punch-list.tsx), finalizing the closeout
// binder (app/closeout-binder.tsx) and locking a WIP period
// (app/wip-report.tsx).
//
// THE MOMENT-COPY RULE (docs/I18N.md §3.5, scripts/moments-checks/rules.ts R3/R4):
//   - One exported function per sentence, returning ONE whole sentence (or one
//     whole label). Data (a name, a duration, a date) enters only as a
//     placeholder argument; never a verb, a noun or a subject phrase passed
//     into a frame.
//   - The screens pass these as writeOptions.copy.refused / copy.timeout and
//     as the confirmed title / next. They never inline a moment string and
//     never join two of these with `+` or inside a template.
//   - W3 lane ESCLOCK wrapped the time-clock (C1, C2) and punch (C3)
//     functions in t(): ONE key per function, the data as {placeholders}
//     (field.time.moment.* / field.punch.moment.*; the sheet title reuses the
//     seed key field.time.clockOut). The Spanish avoids gender agreement. C4
//     (closeout binder) and C5 (WIP) stay English until Phase 2.
//   - docs/VOICE.md: sentence case, no exclamation marks, no em dash, never a
//     pronoun for a user (a worker is named, or "they"), project not job.
//
// Pure apart from t() (i18n/core, pure; read at call time, so English is the
// inline string byte for byte). scripts/moments-checks/field-sites.ts calls
// every export.

import { t } from '@/i18n/core';

// ─────────────────────────────────────────────────────────────────────────────
// C1 + C2: clocking out (app/time-tracking.tsx)
// ─────────────────────────────────────────────────────────────────────────────

/** The own-shift sheet's title. */
export function clockOutSheetTitle(): string {
  return t('field.time.clockOut', 'Clock Out');
}

/** The summary above the slide, no break taken: "Jose has been on the clock 8h 12m. This ends the shift and records 8.20 hours." */
export function clockOutSummary(workerName: string, onClock: string, hours: string): string {
  return t('field.time.moment.clockOutSummary', '{name} has been on the clock {onClock}. This ends the shift and records {hours} hours.', { name: workerName, onClock, hours });
}

/** The summary above the slide after a break: net time and the break named. */
export function clockOutSummaryAfterBreak(workerName: string, onClock: string, net: string, breakMinutes: number, hours: string): string {
  return t('field.time.moment.clockOutSummaryAfterBreak', '{name} has been on the clock {onClock} ({net} after a {breakMinutes}-min break). This ends the shift and records {hours} hours.', { name: workerName, onClock, net, breakMinutes, hours });
}

/** The track label. */
export function clockOutSlideLabel(): string {
  return t('field.time.moment.clockOutSlideLabel', 'Slide to clock out');
}

/** While the write runs. */
export function clockOutBusy(): string {
  return t('field.time.moment.clockOutBusy', 'Clocking out…');
}

/** The screen-reader button: "Clock out Jose". */
export function clockOutSrLabel(workerName: string): string {
  return t('field.time.moment.clockOutSrLabel', 'Clock out {name}', { name: workerName });
}

/** The screen-reader Confirm half. */
export function clockOutSrConfirm(): string {
  return t('field.time.moment.clockOutSrConfirm', 'Confirm clock out');
}

/** Confirmed (the server has it): "Clocked out · 8h 12m". */
export function clockedOutTitle(recorded: string): string {
  return t('field.time.moment.clockedOutTitle', 'Clocked out · {recorded}', { recorded });
}

/** Queued (kept on this phone, sends when online): honest, never a green check. */
export function clockOutQueued(): string {
  return t('field.time.moment.clockOutQueued', 'Clocked out on this phone · sends when online');
}

/** The shift had already ended (a second tap, or another phone): nothing written. */
export function clockOutAlready(): string {
  return t('field.time.moment.clockOutAlready', 'Already clocked out. Nothing was changed.');
}

/** The write was refused; the shift is back on the clock exactly as it was. */
export function clockOutRefused(): string {
  return t('field.time.moment.clockOutRefused', 'Not clocked out. Something went wrong on our side, so the shift is still open.');
}

/** No answer in time: it may still have gone through. "No answer yet. Check Jose's shift before trying again." */
export function clockOutTimeout(workerName: string): string {
  return t('field.time.moment.clockOutTimeout', "No answer yet. Check {name}'s shift before trying again.", { name: workerName });
}

/** No answer in time, and no name on the shift. */
export function clockOutTimeoutNoName(): string {
  return t('field.time.moment.clockOutTimeoutNoName', 'No answer yet. Check the shift before trying again.');
}

/** C2: a crew member's shift on your project, closed from the out-time sheet (the caption above the track). */
export function teamShiftCaption(loggedByName: string): string {
  return t('field.time.moment.teamShiftCaption', '{name} logged this shift. It stays theirs, and their copy updates too.', { name: loggedByName });
}

/** C2: the same, when the name of whoever logged it is not known. */
export function teamShiftCaptionUnnamed(): string {
  return t('field.time.moment.teamShiftCaptionUnnamed', 'A teammate logged this shift. It stays theirs, and their copy updates too.');
}

/** C2: not a shift on a project you own (nothing written). */
export function teamShiftNotOwn(): string {
  return t('field.time.moment.teamShiftNotOwn', 'Only shifts on your own projects can be closed here.');
}

// ─────────────────────────────────────────────────────────────────────────────
// C3: closing the project from the punch list (app/punch-list.tsx)
// ─────────────────────────────────────────────────────────────────────────────

/** The inline banner once the last punch item closes. */
export function punchAllClosedBanner(projectName: string): string {
  return t('field.punch.moment.punchAllClosedBanner', 'Every punch item on {project} is closed.', { project: projectName });
}

/** The banner's tap, and the close sheet's title. */
export function closeProjectAction(): string {
  return t('field.punch.moment.closeProjectAction', 'Close the project');
}

/** The close sheet's body: what closing does, as the code does it. */
export function closeProjectSheetBody(projectName: string): string {
  return t('field.punch.moment.closeProjectSheetBody', '{project} is marked closed and moves to Closeout in your projects list.', { project: projectName });
}

/** The track label. */
export function closeProjectSlideLabel(): string {
  return t('field.punch.moment.closeProjectSlideLabel', 'Slide to close the project');
}

/** While the write runs. */
export function closeProjectBusy(): string {
  return t('field.punch.moment.closeProjectBusy', 'Closing the project…');
}

/** The screen-reader button: "Close Kitchen remodel". */
export function closeProjectSrLabel(projectName: string): string {
  return t('field.punch.moment.closeProjectSrLabel', 'Close {project}', { project: projectName });
}

/** The screen-reader button when the project has no name on file. */
export function closeProjectNoNameSrLabel(): string {
  return t('field.punch.moment.closeProjectNoNameSrLabel', 'Close the project');
}

/** The screen-reader Confirm half. */
export function closeProjectSrConfirm(): string {
  return t('field.punch.moment.closeProjectSrConfirm', 'Confirm close');
}

/** Disabled while any punch item is still open. */
export function closeProjectBlocked(): string {
  return t('field.punch.moment.closeProjectBlocked', 'Close every punch item first.');
}

/** Confirmed. */
export function projectClosedTitle(): string {
  return t('field.punch.moment.projectClosedTitle', 'Project closed');
}

/** Next line, only when the project's closeout binder is finalized. */
export function projectClosedNextBinder(): string {
  return t('field.punch.moment.projectClosedNextBinder', 'The closeout binder is ready to hand over.');
}

/** Next line otherwise: where the closed project now lives (the Closeout filter on the projects list). */
export function projectClosedNextFind(): string {
  return t('field.punch.moment.projectClosedNextFind', 'Find it under Closeout in your projects list.');
}

/** Queued. */
export function projectCloseQueued(): string {
  return t('field.punch.moment.projectCloseQueued', 'Closed on this phone · sends when online');
}

/** Refused: nothing changed locally. */
export function projectCloseRefused(): string {
  return t('field.punch.moment.projectCloseRefused', 'Not closed. Something went wrong on our side, so the project is still open.');
}

/** No answer in time: "No answer yet. Check Kitchen remodel before trying again." */
export function closeProjectTimeout(projectName: string): string {
  return t('field.punch.moment.closeProjectTimeout', 'No answer yet. Check {project} before trying again.', { project: projectName });
}

/** No answer in time, and the project has no name on file. */
export function closeProjectTimeoutNoName(): string {
  return t('field.punch.moment.closeProjectTimeoutNoName', 'No answer yet. Check the project before trying again.');
}

// ─────────────────────────────────────────────────────────────────────────────
// C4: finalizing the closeout binder (app/closeout-binder.tsx)
// ─────────────────────────────────────────────────────────────────────────────

/** The track label. */
export function binderFinalizeSlideLabel(): string {
  return 'Slide to finalize the binder';
}

/** While the write runs. */
export function binderFinalizeBusy(): string {
  return 'Finalizing the binder…';
}

/** The screen-reader button. */
export function binderFinalizeSrLabel(): string {
  return 'Finalize the binder';
}

/** The screen-reader Confirm half. */
export function binderFinalizeSrConfirm(): string {
  return 'Confirm finalize';
}

/** Confirmed (the server returned the finalized row). GC-facing: client, never owner (VOICE glossary). */
export function binderFinalizedTitle(): string {
  return 'Binder finalized · ready to hand over';
}

/** Next line: true in code (the note and maintenance items stay editable when finalized). */
export function binderFinalizedNext(): string {
  return 'You can still edit the note and maintenance items.';
}

/** Refused. */
export function binderFinalizeRefused(): string {
  return 'Not finalized. Something went wrong on our side.';
}

/** No answer in time: it may have landed. */
export function binderFinalizeTimeout(): string {
  return 'No answer yet. Check the binder before trying again.';
}

/** A Save draft is still in flight: the disabled reason, so two upserts never race. */
export function binderFinalizeSaving(): string {
  return "Saving the draft. Finalize when it's done.";
}

/** The binder save needs a connection (it is not kept on the phone): the disabled reason offline. */
export function binderFinalizeOffline(): string {
  return "You're offline. Finalizing the binder needs a connection.";
}

// ─────────────────────────────────────────────────────────────────────────────
// C5: locking a WIP period (app/wip-report.tsx)
// ─────────────────────────────────────────────────────────────────────────────

/** The lock sheet's title. */
export function wipLockSheetTitle(): string {
  return 'Lock the period';
}

/** The lock sheet's body: "Locking freezes Sep 30, 2026. It can no longer be edited." */
export function wipLockSheetBody(periodEnd: string): string {
  return `Locking freezes ${periodEnd}. It can no longer be edited.`;
}

/** The track label: "Slide to lock September 2026". */
export function wipLockSlideLabel(month: string): string {
  return `Slide to lock ${month}`;
}

/** While the write runs. */
export function wipLockBusy(): string {
  return 'Locking the period…';
}

/** The screen-reader button: "Lock September 2026". */
export function wipLockSrLabel(month: string): string {
  return `Lock ${month}`;
}

/** The screen-reader Confirm half. */
export function wipLockSrConfirm(): string {
  return 'Confirm lock';
}

/** Confirmed, neutral (a lock, not a success): "Period locked · Sep 2026". */
export function wipLockedTitle(shortMonth: string): string {
  return `Period locked · ${shortMonth}`;
}

/** Next line: a locked period cannot change, a new one can. */
export function wipLockedNext(): string {
  return 'Create a new period to make changes.';
}

/** Queued. */
export function wipLockQueued(): string {
  return 'Locked on this phone · sends when online';
}

/** Refused: the period is unlocked again on this phone. */
export function wipLockRefused(): string {
  return 'Not locked. Something went wrong on our side, so the period is still open.';
}

/** No answer in time: "No answer yet. Check the September 2026 period before trying again." */
export function wipLockTimeout(month: string): string {
  return `No answer yet. Check the ${month} period before trying again.`;
}

/** Locked before this slide (nothing written). */
export function wipLockAlready(): string {
  return 'Already locked. Nothing was changed.';
}

/** Disabled: this period is locked already. */
export function wipAlreadyLockedReason(): string {
  return 'This period is already locked. Create a new period to make changes.';
}

/** Disabled: there is no saved period to lock. */
export function wipNoPeriodReason(): string {
  return 'Save a period snapshot first, then lock it.';
}
