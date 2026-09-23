// utils/submittalAttachments.ts — pure. The rules behind a submittal package
// (what is attached, what may be sent, what the email may claim) and behind a
// spec-book intake (duplicates, page numbers, the required date).
//
// WHY THIS FILE EXISTS (audit 2026-09, #57 / #59 / #60):
//   • The submittal email told the architect to "review the attached submittal
//     package" when nothing was attached, and the app had no way to attach a
//     cut sheet at all — `attachments: []` on every create path, never edited.
//   • A second spec-book pass (or the same book twice) inserted every row again
//     under new numbers.
//   • Every extracted submittal got a hard Required Date of upload day + 14/30,
//     a guess the chase list then treated as a real deadline, and the log said
//     each one was "submitted" on the day it was merely extracted.
//
// NO react-native / expo / supabase imports, deliberately: bun cannot parse
// react-native, and these are the decisions the validators have to execute
// (scripts/validate-submittals-package.ts). The upload itself — bytes to
// Storage — lives in app/submittal.tsx, which calls these for every decision.

import type { ProjectSchedule, ScheduleTask, Submittal } from '@/types';
import { resolveScheduleAnchor, taskCalendarRange } from '@/utils/scheduleOps';
import { addCalendarDays, formatCalendarDay, toCalendarDayString } from '@/utils/calendarDate';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Where an attached file lives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PRIVATE bucket. Its policies (20260904100400_storage_membership_policies)
 * key on folder[1] = the project id: anyone on the project may read
 * (can_access_project), only the owner or an editor may upload
 * (can_access_project(…, 'editor')). A field or viewer seat's upload is refused
 * by Storage — so the screen refuses it first and says why (see
 * attachmentUploadBlock) instead of letting it fail at the server.
 */
export const SUBMITTAL_ATTACHMENT_BUCKET = 'project-documents';

/** How long the link minted for an email send works. The email carries the
 *  BYTES (emailService downloads and base64-encodes them), so this only has to
 *  outlive the send itself. */
export const SUBMITTAL_ATTACHMENT_SEND_TTL_SECONDS = 60 * 60;

/** A filename Storage and a mail client will both accept, keeping the
 *  extension (the attachment's MIME type is read off it at send). */
export function safeAttachmentFileName(name: string | null | undefined, fallbackExt: string): string {
  const raw = (name ?? '').trim();
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^[._]+/, '').slice(0, 80);
  const ext = fallbackExt.replace(/^\./, '').toLowerCase();
  if (!cleaned) return `attachment.${ext}`;
  return /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.${ext}`;
}

/**
 * The object path INSIDE the bucket: `<projectId>/submittals/<submittalId>/<uniq>/<file>`.
 * The project id is folder[1] because that is what the bucket's policies read.
 * The file keeps its own name as the LAST segment, so the attachment reaches
 * the architect as `cut-sheet.pdf`, not `3f2a…-cut-sheet.pdf`; `uniq` keeps two
 * files with the same name apart.
 */
export function submittalAttachmentObjectPath(o: {
  projectId: string; submittalId: string; uniq: string; fileName: string;
}): string {
  const seg = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${seg(o.projectId)}/submittals/${seg(o.submittalId)}/${seg(o.uniq)}/${o.fileName}`;
}

/** What goes into `submittal.attachments`: the bucket-qualified path. Durable
 *  (a signed URL expires; a local file:// means nothing on another phone). */
export function toStoredAttachment(objectPath: string): string {
  return `${SUBMITTAL_ATTACHMENT_BUCKET}/${objectPath}`;
}

/** The object path of a stored attachment, or null when the entry is not one
 *  of ours (a legacy local URI or a URL). */
export function storedAttachmentObjectPath(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  const prefix = `${SUBMITTAL_ATTACHMENT_BUCKET}/`;
  return v.startsWith(prefix) && v.length > prefix.length ? v.slice(prefix.length) : null;
}

/** The name a person sees for an attachment entry. */
export function attachmentDisplayName(value: string): string {
  const path = value.split('?')[0].split('#')[0];
  let name = path.split('/').pop() || 'attachment';
  try { name = decodeURIComponent(name); } catch { /* keep the raw segment */ }
  return name || 'attachment';
}

/**
 * Why this person may not add a file here, or null when he may.
 * Mirrors the bucket's INSERT policy (owner or editor). A role that is still
 * being read is a wait, not a refusal.
 */
export function attachmentUploadBlock(o: {
  role: 'owner' | 'editor' | 'viewer' | 'field' | null;
  roleLoading: boolean;
  roleError: boolean;
}): string | null {
  if (o.role === 'owner' || o.role === 'editor') return null;
  if (o.roleLoading) return 'Checking your access to this job…';
  if (o.roleError) return "Couldn't check your access to this job, so files can't be added yet. Check your connection.";
  if (o.role === 'field' || o.role === 'viewer') {
    return 'Only the project owner or an editor can attach files to a submittal. Send the cut sheet to your GC to attach.';
  }
  return "You don't have access to add files to this project.";
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. What a send may do, and what the email may say
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether Send may go, before anything is sent.
 *
 * Product data (the cut sheet, the shop drawing) IS the submittal. The cover
 * sheet this app generates is a transmittal, not a package — sending only it
 * asks the architect to stamp nothing. So an empty package is blocked with the
 * reason, unless he confirms he means to send without it (a re-send of a
 * package that already went by other means, a sample delivered by hand).
 */
export function submittalSendGate(o: {
  productDataCount: number;
  /** The cover-sheet PDF can be produced here (false on the web app). */
  coverSheetAvailable: boolean;
  confirmedWithoutProductData: boolean;
}): { blocked: string | null; confirmLabel: string | null } {
  if (o.productDataCount > 0) return { blocked: null, confirmLabel: null };
  const confirmLabel = o.coverSheetAvailable
    ? 'Send the cover sheet only (no product data)'
    : 'Send the details and reply link only (no files)';
  if (o.confirmedWithoutProductData) return { blocked: null, confirmLabel };
  return {
    blocked: o.coverSheetAvailable
      ? 'No product data is attached. Attach the cut sheet or shop drawing first, or confirm you want to send the cover sheet only.'
      : 'No product data is attached, and the web app cannot make the cover-sheet PDF. Attach the cut sheet or shop drawing first, or confirm you want to send the details and reply link only.',
    confirmLabel,
  };
}

/**
 * The email's opening line when he wrote none. It names what rides on the
 * email — built from the files that were actually resolved for it — and never
 * says "attached" when nothing is.
 */
export function submittalEmailIntro(o: { coverSheet: boolean; productNames: string[] }): string {
  const parts: string[] = [];
  if (o.productNames.length > 0) {
    const n = o.productNames.length;
    parts.push(`${n} product data file${n === 1 ? '' : 's'} (${o.productNames.join(', ')})`);
  }
  if (o.coverSheet) parts.unshift('the submittal cover sheet');
  if (parts.length === 0) {
    return 'Please review the submittal details below and reply with your action code when ready.';
  }
  return `Attached: ${parts.join(' and ')}. Please review and reply with your action code when ready.`;
}

/**
 * What a completed send means for the log.
 *
 * sendEmail reports files it could not read (`attachmentsDropped`) instead of
 * failing. An email that went out missing part of its package is NOT a clean
 * round of review: it is not logged as one, and he is told what happened.
 */
export function submittalSendOutcome(o: {
  requested: number;
  dropped: number;
}): { recordCycle: boolean; warning: string | null } {
  const dropped = Math.max(0, Math.min(o.requested, o.dropped || 0));
  if (dropped === 0) return { recordCycle: true, warning: null };
  const sent = o.requested - dropped;
  return {
    recordCycle: false,
    warning:
      `The email went, but ${dropped} of ${o.requested} file${o.requested === 1 ? '' : 's'} could not be attached` +
      (sent > 0 ? ` (${sent} did)` : '') +
      '. It was not logged as a review round — check the files and send again.',
  };
}

/**
 * The most the reviewer email can carry, all files together (decoded bytes).
 * MIRRORS supabase/functions/send-email/index.ts MAX_ATTACHMENT_BYTES — the
 * server refuses anything over it with a bare 400, which on the phone surfaced
 * as "Edge Function returned a non-2xx status code". validate-submittals-package
 * pins the two numbers equal.
 */
export const SUBMITTAL_EMAIL_ATTACHMENT_CAP_BYTES = 5 * 1024 * 1024;

/** Room kept for the generated cover sheet (a one-page transmittal PDF runs
 *  well under this), so a package that fits at attach time still fits once
 *  the cover rides along at send. */
export const SUBMITTAL_COVER_SHEET_RESERVE_BYTES = 300 * 1024;

export function formatMegabytes(bytes: number): string {
  return `${(Math.max(0, bytes) / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentBudget(coverSheet: boolean): number {
  return SUBMITTAL_EMAIL_ATTACHMENT_CAP_BYTES - (coverSheet ? SUBMITTAL_COVER_SHEET_RESERVE_BYTES : 0);
}

/**
 * Why a picked file may not be attached because of its size, or null.
 * Refused BEFORE upload: a file the email can never carry would sit on the
 * submittal and make Send fail. `packageBytes` is what is already attached
 * (sizes that could not be read count as 0 — the send-time gate re-checks).
 */
export function submittalFileSizeBlock(o: {
  fileName: string; fileBytes: number; packageBytes: number; coverSheet: boolean;
}): string | null {
  const budget = attachmentBudget(o.coverSheet);
  const capLine = `Email attachments are limited to ${formatMegabytes(SUBMITTAL_EMAIL_ATTACHMENT_CAP_BYTES)} in total${o.coverSheet ? ', cover sheet included' : ''}`;
  if (o.fileBytes > budget) {
    return `${capLine}; ${o.fileName} is ${formatMegabytes(o.fileBytes)}. Compress it or split it, or share it from Project Files. It was not attached.`;
  }
  const total = Math.max(0, o.packageBytes) + o.fileBytes;
  if (total > budget) {
    return `${capLine}. ${formatMegabytes(o.packageBytes)} is already attached, and ${o.fileName} (${formatMegabytes(o.fileBytes)}) would bring it to ${formatMegabytes(total)}. Remove a file or compress this one. It was not attached.`;
  }
  return null;
}

/**
 * Why Send may not go because the package is over the email's cap, or null.
 * Checked at send over the stored files' real sizes (null = unreadable, left
 * to the server's own check, whose refusal is translated by
 * attachmentsTooLargeMessage).
 */
export function submittalPackageSizeBlock(o: { sizes: readonly (number | null)[]; coverSheet: boolean }): string | null {
  const total = o.sizes.reduce<number>((a, b) => a + (typeof b === 'number' && b > 0 ? b : 0), 0);
  if (total <= attachmentBudget(o.coverSheet)) return null;
  return `The attached files come to ${formatMegabytes(total)}, and email attachments are limited to ${formatMegabytes(SUBMITTAL_EMAIL_ATTACHMENT_CAP_BYTES)} in total${o.coverSheet ? ', cover sheet included' : ''}. Remove or compress a file, then send. Nothing was sent.`;
}

/** The send-email refusal for an oversized package, in words he can act on;
 *  null for any other error. */
export function attachmentsTooLargeMessage(error: string | null | undefined): string | null {
  if (!/attachments too large/i.test(error ?? '')) return null;
  return `The files are too large to email together (the limit is ${formatMegabytes(SUBMITTAL_EMAIL_ATTACHMENT_CAP_BYTES)} in total). Remove or compress a file, then send. Nothing was sent.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Spec-book intake
// ─────────────────────────────────────────────────────────────────────────────

/** A log entry and a candidate are "the same submittal" when their spec
 *  section and title match after normalization ("08 71 00" = "087100",
 *  case and punctuation ignored). */
export function specDedupeKey(specSection: string | null | undefined, title: string | null | undefined): string {
  const sec = (specSection ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const t = (title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${sec}|${t}`;
}

export type SpecDuplicate = 'log' | 'list' | null;

/**
 * Flag each new candidate that is already in the project's submittal log, or
 * already on the review list from an earlier pass. Nothing is dropped: a match
 * comes back UNCHECKED with its reason, so he sees it and can still keep it.
 */
export function markSpecDuplicates<T extends { specSection: string; title: string; confidence: 'high' | 'medium' | 'low' }>(
  candidates: readonly T[],
  existingLog: readonly Pick<Submittal, 'specSection' | 'title'>[],
  currentRows: readonly { specSection: string; title: string }[],
): (T & { duplicate: SpecDuplicate; selected: boolean })[] {
  const inLog = new Set(existingLog.map(s => specDedupeKey(s.specSection, s.title)));
  const onList = new Set(currentRows.map(r => specDedupeKey(r.specSection, r.title)));
  return candidates.map(c => {
    const key = specDedupeKey(c.specSection, c.title);
    const duplicate: SpecDuplicate = inLog.has(key) ? 'log' : onList.has(key) ? 'list' : null;
    // Later rows in the SAME pass count against earlier ones, so one pass
    // cannot put the same item on the list twice either.
    onList.add(key);
    return { ...c, duplicate, selected: duplicate ? false : c.confidence !== 'low' };
  });
}

/**
 * The model numbers the pages it was SHOWN, 1..N. A pass that started at page
 * 25 showed it pages 25–48, so its "p. 3" is the book's page 27. Map through
 * the rendered pages' real numbers; anything out of range is dropped rather
 * than printed as a page the book may not have.
 */
export function absoluteSourcePages(pages: readonly number[], renderedPageNumbers: readonly number[]): number[] {
  const out: number[] = [];
  for (const p of pages) {
    const i = Math.floor(p) - 1;
    if (!Number.isFinite(i) || i < 0 || i >= renderedPageNumbers.length) continue;
    const abs = renderedPageNumbers[i];
    if (!out.includes(abs)) out.push(abs);
  }
  return out;
}

/** Words that name a trade's work on a schedule task. Deliberately narrow: a
 *  wrong match puts a wrong date on the log, a missed one leaves it blank. */
const TRADE_TASK_WORDS: Record<string, string[]> = {
  concrete: ['concrete', 'slab', 'foundation', 'footing'],
  framing: ['framing'],
  roofing: ['roof'],
  plumbing: ['plumb'],
  electrical: ['electric'],
  hvac: ['hvac', 'mechanical', 'ductwork'],
  drywall: ['drywall', 'gypsum', 'sheetrock'],
  painting: ['paint'],
  flooring: ['flooring', 'carpet', 'hardwood', 'lvp'],
  tile: ['tile'],
  'doors/hardware': ['door', 'hardware'],
  cabinets: ['cabinet', 'millwork', 'casework'],
};

/** The earliest non-milestone task whose title or phase names this trade's
 *  work, or null. 'General' and unknown trades never match. */
export function matchScheduleTaskForTrade(trade: string | null | undefined, tasks: readonly ScheduleTask[]): ScheduleTask | null {
  const words = TRADE_TASK_WORDS[(trade ?? '').trim().toLowerCase()];
  if (!words) return null;
  let best: ScheduleTask | null = null;
  for (const t of tasks) {
    if (t.isMilestone) continue;
    const hay = `${t.title ?? ''} ${t.phase ?? ''}`.toLowerCase();
    // Word-START match, not substring: 'door' must not find "Outdoor
    // kitchen" and put a schedule-derived date on the log as fact. A prefix
    // is still allowed ('plumb' → plumbing, 'electric' → electrical).
    // (TRADE_TASK_WORDS are plain lowercase letters — nothing to escape.)
    if (!words.some(w => new RegExp(`\\b${w}`).test(hay))) continue;
    if (!best || (t.startDay ?? 0) < (best.startDay ?? 0)) best = t;
  }
  return best;
}

export interface DerivedRequiredDate {
  /** 'YYYY-MM-DD', or '' when there is nothing real to count back from. */
  requiredDate: string;
  requiredDateSource?: 'schedule';
  linkedTaskId?: string;
  /** For the label: which task, and the day it starts. */
  taskTitle?: string;
  taskStart?: string;
}

/**
 * A spec item's Required Date. Only ever the matching schedule task's start
 * day minus the (AI-estimated) lead, in calendar days — and only when the
 * schedule has a real start date, since an undated schedule's tasks have no
 * calendar days to count back from. Otherwise '' — never upload day + N, which
 * is a deadline nobody set that the chase list would then enforce.
 */
export function deriveSubmittalRequiredDate(o: {
  schedule: Pick<ProjectSchedule, 'startDate' | 'workingDaysPerWeek' | 'nonWorkingDates' | 'tasks'> | null | undefined;
  trade: string | null | undefined;
  leadDays: number | null | undefined;
}): DerivedRequiredDate {
  if (!o.schedule) return { requiredDate: '' };
  const anchor = resolveScheduleAnchor(o.schedule).date;
  if (!anchor) return { requiredDate: '' };
  const task = matchScheduleTaskForTrade(o.trade, o.schedule.tasks ?? []);
  if (!task) return { requiredDate: '' };
  return requiredDateFromTask(o.schedule, anchor, task, o.leadDays);
}

/**
 * #96: the same date, for the task the submittal is LINKED to now (by id) —
 * so the screen can recompute it from today's schedule instead of trusting
 * the date stored when the spec book was read. '' when the task is gone or
 * the schedule has no start date to count from.
 */
export function deriveSubmittalRequiredDateForTask(o: {
  schedule: Pick<ProjectSchedule, 'startDate' | 'workingDaysPerWeek' | 'nonWorkingDates' | 'tasks'> | null | undefined;
  taskId: string | null | undefined;
  leadDays: number | null | undefined;
}): DerivedRequiredDate {
  if (!o.schedule || !o.taskId) return { requiredDate: '' };
  const anchor = resolveScheduleAnchor(o.schedule).date;
  if (!anchor) return { requiredDate: '' };
  const task = (o.schedule.tasks ?? []).find(t => t.id === o.taskId);
  if (!task) return { requiredDate: '' };
  return requiredDateFromTask(o.schedule, anchor, task, o.leadDays);
}

/** The task's first calendar day, less the lead, in calendar days. */
function requiredDateFromTask(
  schedule: Pick<ProjectSchedule, 'workingDaysPerWeek' | 'nonWorkingDates'>,
  anchor: NonNullable<ReturnType<typeof resolveScheduleAnchor>['date']>,
  task: ScheduleTask,
  leadDays: number | null | undefined,
): DerivedRequiredDate {
  const lead = typeof leadDays === 'number' && Number.isFinite(leadDays) ? Math.max(0, Math.round(leadDays)) : 0;
  const start = taskCalendarRange(
    { startDay: Math.floor(task.startDay ?? 1), durationDays: 1 },
    anchor, schedule.workingDaysPerWeek, schedule.nonWorkingDates,
  ).start;
  return {
    requiredDate: toCalendarDayString(addCalendarDays(start, -lead)),
    requiredDateSource: 'schedule',
    linkedTaskId: task.id,
    taskTitle: task.title,
    taskStart: toCalendarDayString(start),
  };
}

/** The review row's line about the date — says where it came from, or that
 *  there is none. */
export function requiredDateNote(d: DerivedRequiredDate, leadDays: number): string {
  if (!d.requiredDate) return 'Required date: set it, or link a schedule task';
  return `Needed by ${formatCalendarDay(d.requiredDate)} — "${d.taskTitle}" starts ${formatCalendarDay(d.taskStart ?? '')}, less the ${leadDays}-day estimated lead (AI)`;
}

/** The submittal a kept spec row becomes. Not submitted (nothing has been sent)
 *  and dated only when the schedule gives it a date. */
export function extractedSubmittal(o: {
  projectId: string;
  submittedBy: string;
  row: { title: string; specSection: string; submittalType: string; trade: string; dueRelativeDays: number; sourcePages: number[] };
  derived: DerivedRequiredDate;
}): Omit<Submittal, 'id' | 'createdAt' | 'updatedAt' | 'number'> {
  const lead = Number.isFinite(o.row.dueRelativeDays) ? Math.max(0, Math.round(o.row.dueRelativeDays)) : undefined;
  return {
    projectId: o.projectId,
    title: o.row.title,
    specSection: o.row.specSection || '',
    submittedBy: o.submittedBy,
    submittedDate: '',
    requiredDate: o.derived.requiredDate,
    ...(o.derived.requiredDateSource ? { requiredDateSource: o.derived.requiredDateSource } : {}),
    ...(o.derived.linkedTaskId ? { linkedTaskId: o.derived.linkedTaskId } : {}),
    submittalType: o.row.submittalType,
    trade: o.row.trade,
    sourcePages: o.row.sourcePages,
    ...(lead !== undefined ? { leadDays: lead } : {}),
    reviewCycles: [],
    currentStatus: 'pending',
    attachments: [],
  };
}
