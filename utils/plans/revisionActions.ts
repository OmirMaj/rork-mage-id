// utils/plans/revisionActions.ts — pure. What a drawing comparison and a
// sheet renumber are allowed to DO to the plan set, decided without React so
// scripts/validate-plan-revision-actions.ts can pin it under bun.
//
// Audit round 2:
//   #20 Compare Drawings found the changes, drafted the RFIs, then offered only
//       "Done" — the revision was never filed, so the old sheet stayed "current"
//       in the field, and every flagged change had to be retyped from memory.
//   #21 addPlanSheet chains revisions by sheet number, but PDF pages import with
//       no number and nothing could give them one. The viewer's number field
//       uses planRenumber below, which runs the SAME check addPlanSheet runs
//       (utils/planRevisionCore sheetNumberKey / currentSheetCandidates) — and,
//       unlike addPlanSheet, has to decide which of two existing sheets is newer.

import {
  currentSheetCandidates, effectiveRevision, sheetNumberKey, type RevisionSheetLike,
} from '@/utils/planRevisionCore';
import { addCalendarDays, toCalendarDayString } from '@/utils/calendarDate';

export interface SheetLike extends RevisionSheetLike {
  name: string;
  createdAt: string;
}

// ── #20 Compare Drawings ───────────────────────────────────────────────────

/** Sheets that may be picked as "the sheet currently in the field". A
 *  superseded revision is by definition not in the field. */
export function currentSheetsForCompare<T extends RevisionSheetLike>(sheets: readonly T[]): T[] {
  return sheets.filter(s => s.superseded !== true);
}

export type RevisionFiling =
  | { kind: 'ready'; label: string; nextRevision: number }
  | { kind: 'blocked'; reason: string }
  | { kind: 'filed'; label: string };

/**
 * Can the uploaded revision be filed into the plan set as the next revision of
 * `oldSheet`? Every blocked state carries the sentence the button shows — a
 * disabled control says why.
 */
export function revisionFiling(opts: {
  oldSheet: SheetLike;
  allSheets: readonly SheetLike[];
  /** Storage path of the rendered revision page; '' for a picked image. */
  newPath: string;
  filedRevision?: number | null;
}): RevisionFiling {
  const { oldSheet, allSheets, newPath, filedRevision } = opts;
  const number = sheetNumberKey(oldSheet);
  if (typeof filedRevision === 'number') {
    return { kind: 'filed', label: `Filed as Rev ${filedRevision} of ${number ?? oldSheet.name} — the old copy is marked superseded` };
  }
  if (!newPath) {
    return { kind: 'blocked', reason: 'Only a PDF revision can be filed into the plan set — a picked image has no stored copy.' };
  }
  if (!number) {
    return {
      kind: 'blocked',
      reason: `${oldSheet.name} has no sheet number, so a new copy can't replace it. Give it a number in the plan viewer, then compare again.`,
    };
  }
  // addPlanSheet chains onto the highest live revision with this number; say
  // the number it WILL assign, not oldSheet's + 1, when a newer live copy exists.
  const live = [oldSheet, ...currentSheetCandidates(oldSheet, allSheets)].filter(s => s.superseded !== true);
  const head = live.reduce((a, b) => (effectiveRevision(a) >= effectiveRevision(b) ? a : b), oldSheet);
  const nextRevision = effectiveRevision(head) + 1;
  return { kind: 'ready', label: `File as Rev ${nextRevision} of ${number}`, nextRevision };
}

/** How a sheet is named in a record that must still make sense in a year. */
export function sheetCitation(sheet: { sheetNumber?: string; name: string; revision?: number }): string {
  const number = (sheet.sheetNumber ?? '').trim();
  const rev = `Rev ${typeof sheet.revision === 'number' && sheet.revision >= 1 ? sheet.revision : 1}`;
  return number ? `${number} ${rev}` : `${sheet.name} (${rev})`;
}

/**
 * Params for app/change-order.tsx. The description carries the drawing
 * reference itself: change-order maps only its known `prefillReason` values to
 * a reason, so a revision reason passed there alone would arrive blank.
 */
export function changeOrderPrefill(
  change: { location?: string; description: string },
  oldSheet: { sheetNumber?: string; name: string; revision?: number },
  revisionLabel: string | null,
): { prefillDescription: string; prefillReason: string } {
  const where = (change.location ?? '').trim();
  const what = change.description.trim();
  const from = `Drawing revision of ${sheetCitation(oldSheet)}${revisionLabel ? ` (${revisionLabel})` : ''}`;
  return {
    prefillDescription: `${where ? `${where}: ` : ''}${what} — ${from}`,
    prefillReason: 'drawing_revision',
  };
}

/**
 * The addRFI input for a drafted question. Due in 7 days — a revision question
 * blocks work on that sheet, so it is not a 14-day RFI.
 *
 * `dateRequired` is a CALENDAR DAY, the same shape app/rfi.tsx writes, not an
 * instant: `now + 7 * 86_400_000` then `.toISOString()` hands back TOMORROW's
 * date prefix for anyone comparing drawings after ~5 pm west of Greenwich (and
 * is a day out across a DST boundary), and every reader of this field
 * (formatCalendarDay / parseCalendarDay, the overdue chip) takes the first ten
 * characters verbatim. `dateSubmitted` stays an instant — that one IS a moment.
 */
export function rfiFromCandidate(
  candidate: { subject: string; question: string },
  oldSheet: { projectId: string; sheetNumber?: string; name: string; revision?: number },
  revisionLabel: string | null,
  now: Date,
) {
  const cite = sheetCitation(oldSheet);
  return {
    projectId: oldSheet.projectId,
    subject: candidate.subject.trim() || `${cite} revision question`,
    question: `${candidate.question.trim()}\n\n(Raised comparing ${cite} against the revision${revisionLabel ? ` "${revisionLabel}"` : ''}.)`,
    submittedBy: '',
    assignedTo: '',
    dateSubmitted: now.toISOString(),
    dateRequired: toCalendarDayString(addCalendarDays(now, 7)),
    status: 'open' as const,
    priority: 'normal' as const,
    ballInCourt: 'gc' as const,
    linkedDrawing: (oldSheet.sheetNumber ?? '').trim() || oldSheet.name,
    attachments: [] as string[],
  };
}

// ── #21 Renumbering a sheet ────────────────────────────────────────────────

export interface SheetPatch {
  id: string;
  updates: { sheetNumber?: string; revision?: number; previousSheetId?: string; superseded?: boolean };
}

export type RenumberPlan =
  | { kind: 'noop' }
  | { kind: 'invalid'; reason: string }
  /** Patches in the order to apply them. `message` tells the user what happened to the chain. */
  | { kind: 'apply'; patches: SheetPatch[]; message: string | null };

const newerThan = (a: SheetLike, b: SheetLike): boolean => {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta > tb;
  // Same instant or unparseable: fall back to the revision counter, then id,
  // so the answer is at least stable.
  if (effectiveRevision(a) !== effectiveRevision(b)) return effectiveRevision(a) > effectiveRevision(b);
  return a.id > b.id;
};

/**
 * Give `edited` a sheet number and re-run the revision check addPlanSheet runs
 * on upload.
 *
 * Direction matters. addPlanSheet always treats the INCOMING sheet as newer; a
 * renumber does not have that luxury — numbering the old IFC page after the
 * ASI page exists must mark the IFC page superseded, not the ASI page. The
 * newer sheet (by createdAt) is the live one.
 *
 * Two live copies already carrying the number is left alone (with a message):
 * picking a winner there is the wrong-sheet guess planRevisionCore refuses to
 * make, and the viewer's banner already says "confirm which one is current".
 */
export function planRenumber(
  edited: SheetLike,
  rawNumber: string,
  allSheets: readonly SheetLike[],
): RenumberPlan {
  const number = rawNumber.trim();
  const before = (edited.sheetNumber ?? '').trim();
  if (number === before) return { kind: 'noop' };
  if (number.length > 40) return { kind: 'invalid', reason: 'Sheet numbers are short, like A-201 — 40 characters at most.' };
  if (!number) {
    return { kind: 'apply', patches: [{ id: edited.id, updates: { sheetNumber: '' } }], message: null };
  }
  // A superseded copy only gets its label corrected; its chain is history.
  if (edited.superseded === true) {
    return { kind: 'apply', patches: [{ id: edited.id, updates: { sheetNumber: number } }], message: null };
  }
  const probe = { ...edited, sheetNumber: number };
  const heads = currentSheetCandidates(probe, allSheets) as SheetLike[];
  if (heads.length === 0) {
    return { kind: 'apply', patches: [{ id: edited.id, updates: { sheetNumber: number } }], message: null };
  }
  if (heads.length > 1) {
    return {
      kind: 'apply',
      patches: [{ id: edited.id, updates: { sheetNumber: number } }],
      message: `${heads.length} other live sheets already carry ${number}. Nothing was marked superseded — open them and confirm which one is current.`,
    };
  }
  const head = heads[0];
  if (newerThan(edited, head)) {
    const revision = effectiveRevision(head) + 1;
    return {
      kind: 'apply',
      // Supersede the old copy FIRST: if the second write is lost, the worst
      // case is no live copy of the number (the banner says "not found"), never
      // two live copies with the wrong one on top.
      patches: [
        { id: head.id, updates: { superseded: true } },
        { id: edited.id, updates: { sheetNumber: number, revision, previousSheetId: head.id, superseded: false } },
      ],
      message: `This sheet is now Rev ${revision} of ${number}; the older copy is marked superseded.`,
    };
  }
  // The edited sheet is the OLDER copy: it becomes the history, the existing
  // live sheet stays current. Only link the chain when the live sheet has no
  // predecessor yet — never overwrite a chain that already exists.
  const patches: SheetPatch[] = [
    { id: edited.id, updates: { sheetNumber: number, superseded: true, revision: head.previousSheetId ? effectiveRevision(edited) : effectiveRevision(head) } },
  ];
  if (!head.previousSheetId) {
    patches.push({ id: head.id, updates: { revision: effectiveRevision(head) + 1, previousSheetId: edited.id } });
  }
  return {
    kind: 'apply',
    patches,
    message: `A newer copy of ${number} is already in the set, so this sheet is now marked superseded.`,
  };
}
