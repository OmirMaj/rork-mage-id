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
import { sheetIdFromDocId } from './planChunk';
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
  /** `needsNumber`: the only thing missing is the old sheet's number, and the
   *  screen can take it inline without throwing the paid comparison away (#75). */
  | { kind: 'blocked'; reason: string; needsNumber?: boolean }
  | { kind: 'filed'; label: string }
  /** #76: both sides were already in the plan set — there is nothing to file,
   *  and offering "File as Rev N+1" would create a duplicate revision. */
  | { kind: 'in_set'; label: string };

/** How a sheet is cited (see sheetCitation). */
export interface SheetCite { sheetNumber?: string; name: string; revision?: number }

/**
 * Can the uploaded revision be filed into the plan set as the next revision of
 * `oldSheet`? Every blocked state carries the sentence the button shows — a
 * disabled control says why.
 */
export function revisionFiling(opts: {
  oldSheet: SheetLike;
  allSheets: readonly SheetLike[];
  /** Storage path of the rendered revision page (PDF render or uploaded
   *  image); '' when the revision has no stored copy. */
  newPath: string;
  filedRevision?: number | null;
  /** #76: the "new" side is a sheet already in the plan set. */
  newSheetInSet?: SheetCite | null;
}): RevisionFiling {
  const { oldSheet, allSheets, newPath, filedRevision, newSheetInSet } = opts;
  const number = sheetNumberKey(oldSheet);
  if (newSheetInSet) {
    return { kind: 'in_set', label: `Already in the plan set as ${sheetCitation(newSheetInSet)} — nothing to file.` };
  }
  if (typeof filedRevision === 'number') {
    return { kind: 'filed', label: `Filed as Rev ${filedRevision} of ${number ?? oldSheet.name} — the old copy is marked superseded` };
  }
  if (!newPath) {
    return { kind: 'blocked', reason: 'Only a PDF revision or an uploaded image can be filed into the plan set — this revision has no stored copy.' };
  }
  if (!number) {
    return {
      kind: 'blocked',
      needsNumber: true,
      // The comparison is kept while he types it (#75): no second render, no
      // second paid compare.
      reason: `${oldSheet.name} has no sheet number, so a new copy can't replace it. Type the number from its title block below (or in the plan viewer) — this comparison is kept.`,
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
  /** #76: when the revision is itself a sheet in the plan set, the RFI is about
   *  THAT sheet — cite it and link it, and name the old one as the baseline.
   *  #77: `sheetImages` are the two drawings compared (old, then new), attached
   *  so the architect can see what changed instead of a sheet number in text.
   *  #113: each is stored as its DURABLE plan-sheets key (attachableSheetUri),
   *  never the 24 h signed URL the screen rendered it from — app/rfi.tsx signs
   *  it when drawn, the send signs it for the email, the reply page signs it
   *  on each open. */
  opts?: { newSheet?: SheetCite | null; sheetImages?: readonly (string | null | undefined)[] },
) {
  const newSheet = opts?.newSheet ?? null;
  const images = [...new Set((opts?.sheetImages ?? []).map(attachableSheetUri).filter(Boolean))];
  const cite = sheetCitation(newSheet ?? oldSheet);
  const raised = newSheet
    ? `(Raised comparing ${sheetCitation(oldSheet)} with ${cite}, both in the plan set.)`
    : `(Raised comparing ${cite} against the revision${revisionLabel ? ` "${revisionLabel}"` : ''}.)`;
  const linked = newSheet ?? oldSheet;
  return {
    projectId: oldSheet.projectId,
    subject: candidate.subject.trim() || `${cite} revision question`,
    question: `${candidate.question.trim()}\n\n${raised}`,
    submittedBy: '',
    assignedTo: '',
    dateSubmitted: now.toISOString(),
    dateRequired: toCalendarDayString(addCalendarDays(now, 7)),
    status: 'open' as const,
    priority: 'normal' as const,
    ballInCourt: 'gc' as const,
    linkedDrawing: (linked.sheetNumber ?? '').trim() || linked.name,
    attachments: images as string[],
  };
}

const CHANGE_LABEL: Record<string, string> = {
  added: 'Added', removed: 'Removed', modified: 'Modified', renote: 'Note revised',
};

/**
 * #166: a flagged CHANGE that needs the architect's word, as an RFI. Same
 * record as a drafted question (rfiFromCandidate) — the subject says what kind
 * of change and where, the question carries the AI's description and asks for
 * the intent. The addressee stays empty on purpose: the screen then opens the
 * RFI so he fills it in, rather than guessing one.
 */
export function rfiFromChange(
  change: { type?: string; location?: string; description: string },
  oldSheet: { projectId: string; sheetNumber?: string; name: string; revision?: number },
  revisionLabel: string | null,
  now: Date,
  opts?: { newSheet?: SheetCite | null; sheetImages?: readonly (string | null | undefined)[] },
) {
  const where = (change.location ?? '').trim();
  const kind = CHANGE_LABEL[change.type ?? ''] ?? 'Change';
  const what = change.description.trim();
  return rfiFromCandidate(
    {
      subject: `${kind}${where ? ` · ${where}` : ''}`,
      question: `${what}${/[.?!]$/.test(what) ? '' : '.'} Please confirm the intent of this change before we price or build it.`,
    },
    oldSheet, revisionLabel, now, opts,
  );
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

/**
 * The plan_sheets columns a SheetPatch carries that ProjectContext.updatePlanSheet
 * does not forward (revision / previous_sheet_id / superseded). Without this
 * write a chain edit lives in local state alone and the next refetch resurrects
 * the old copy as live (plan-viewer B4 review). null when there is nothing to
 * write. Shared by the viewer's number field and Compare's inline one (#75).
 */
export function chainColumnsPatch(updates: SheetPatch['updates']): Record<string, unknown> | null {
  const chain: Record<string, unknown> = {};
  if (updates.revision !== undefined) chain.revision = updates.revision;
  if (updates.previousSheetId !== undefined) chain.previous_sheet_id = updates.previousSheetId;
  if (updates.superseded !== undefined) chain.superseded = updates.superseded;
  return Object.keys(chain).length > 0 ? chain : null;
}

// ── #75 Title-block sheet numbers ──────────────────────────────────────────

/** A number read off a sheet's title block, offered — never written — until he
 *  confirms it. The model can misread, and a wrong number supersedes the
 *  wrong sheet. */
export interface TitleBlockSuggestion {
  sheetId: string;
  /** How the sheet is named today ("IFC Set — Page 12"). */
  label: string;
  sheetNumber: string;
  /** Another sheet in the same batch read the same number. Offered, but not
   *  pre-ticked: two pages of one set cannot both be A-201. */
  duplicate: boolean;
}

/**
 * Which title-block reads are worth offering: sheets that still have NO number
 * (a number he typed always wins), are not superseded history, and whose read
 * is a plausible sheet number (non-empty, ≤ 40 chars — planRenumber's limit).
 */
export function titleBlockSuggestions(
  sheets: readonly SheetLike[],
  reads: readonly { sheetId: string; sheetNumber?: string | null }[],
): TitleBlockSuggestion[] {
  const byId = new Map(sheets.map(s => [s.id, s]));
  const out: Omit<TitleBlockSuggestion, 'duplicate'>[] = [];
  for (const r of reads) {
    const sheet = byId.get(r.sheetId);
    const number = String(r.sheetNumber ?? '').replace(/\s+/g, ' ').trim();
    if (!sheet || !number || number.length > 40) continue;
    if ((sheet.sheetNumber ?? '').trim()) continue;
    if (sheet.superseded === true) continue;
    if (out.some(o => o.sheetId === sheet.id)) continue;
    out.push({ sheetId: sheet.id, label: sheet.name, sheetNumber: number });
  }
  const key = (n: string) => n.toUpperCase();
  const counts = new Map<string, number>();
  for (const o of out) counts.set(key(o.sheetNumber), (counts.get(key(o.sheetNumber)) ?? 0) + 1);
  return out.map(o => ({ ...o, duplicate: (counts.get(key(o.sheetNumber)) ?? 0) > 1 }));
}

/**
 * Apply several confirmed numbers as ONE ordered patch list. Each renumber is
 * planned against the set as the previous ones left it, so numbering page 3
 * A-201 and then meeting the older IFC A-201 chains correctly, exactly as if
 * he had typed each number in the viewer one after another.
 */
export function planBatchRenumber(
  accepted: readonly { sheetId: string; sheetNumber: string }[],
  allSheets: readonly SheetLike[],
): { patches: SheetPatch[]; messages: string[]; applied: number } {
  let working: SheetLike[] = allSheets.map(s => ({ ...s }));
  const patches: SheetPatch[] = [];
  const messages: string[] = [];
  let applied = 0;
  for (const a of accepted) {
    const sheet = working.find(s => s.id === a.sheetId);
    if (!sheet) continue;
    const plan = planRenumber(sheet, a.sheetNumber, working);
    if (plan.kind === 'invalid') { messages.push(`${sheet.name}: ${plan.reason}`); continue; }
    if (plan.kind === 'noop') continue;
    applied++;
    for (const p of plan.patches) {
      patches.push(p);
      working = working.map(s => (s.id === p.id ? { ...s, ...p.updates } : s));
    }
    // Named: in a batch, "this sheet" alone does not say which one.
    if (plan.message) messages.push(`${sheet.name}: ${plan.message}`);
  }
  return { patches, messages, applied };
}

// ── #77 An RFI raised from a pin ───────────────────────────────────────────

/**
 * Where a pin sits on a sheet, in words someone holding ONLY the sheet can
 * find: a 3×3 zone plus the percentages. The RFI used to say "the marked
 * location", and nothing the architect received — email or portal — showed a
 * mark, so he answered the wrong beam pocket or wrote back "which mark?".
 */
export function pinPositionPhrase(x: number, y: number): string {
  const cx = Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0.5));
  const cy = Math.min(1, Math.max(0, Number.isFinite(y) ? y : 0.5));
  const col = cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : 'centre';
  const row = cy < 1 / 3 ? 'upper' : cy > 2 / 3 ? 'lower' : 'middle';
  const zone = row === 'middle' && col === 'centre' ? 'centre' : row === 'middle' ? `middle ${col}` : col === 'centre' ? `${row} centre` : `${row}-${col}`;
  return `${zone} of the sheet (about ${Math.round(cx * 100)}% from the left, ${Math.round(cy * 100)}% from the top)`;
}

/**
 * The addRFI input for "Raise RFI from this location".
 *
 * `sheetImageUri` is the drawing itself (stored as its durable plan-sheets key,
 * #93 — pass sheetAttachmentFor(sheet)), attached so the recipient can see the
 * sheet; `photo` is a photo linked to the pin. The photo goes FIRST: app/rfi.tsx
 * treats attachment 0 as the source photo (sourcePhotoId) and draws its markup
 * from there, so putting the sheet ahead of it would hang the photo's circle on
 * the drawing. The question never says "marked" — an attached sheet shows the
 * drawing, not the pin, so the position is written out in words either way.
 *
 * `dateRequired` is a CALENDAR DAY 14 days out (#164), the same shape app/rfi.tsx
 * writes; `now + 14 * 86_400_000` then `.toISOString()` was the next UTC day for
 * anyone raising it after ~5 pm west of Greenwich, so the screen said day 15
 * while the email said day 14.
 */
export function rfiFromPin(
  sheet: { projectId: string; sheetNumber?: string; name: string },
  pin: { x: number; y: number; label?: string },
  now: Date,
  attach: { sheetImageUri?: string | null; photo?: { id: string; uri: string } | null } = {},
) {
  const sheetName = (sheet.sheetNumber ?? '').trim() || sheet.name;
  const label = (pin.label ?? '').trim();
  const where = `on ${sheetName}, ${pinPositionPhrase(pin.x, pin.y)}`;
  const photo = attach.photo && attach.photo.uri ? attach.photo : null;
  // #93/#94: the durable key, never a signed URL (attachableSheetUri) — and a
  // bare key is a real sheet now, so an offline raise still attaches it.
  const sheetUri = attachableSheetUri(attach.sheetImageUri);
  const attachments = [...(photo ? [photo.uri] : []), ...(sheetUri ? [sheetUri] : [])];
  const seeAttached = sheetUri ? ` ${sheetName} is attached.` : '';
  return {
    projectId: sheet.projectId,
    subject: label ? `${sheetName}: ${label}` : `${sheetName} — RFI`,
    question: label
      ? `Regarding ${label} ${where}: please advise.${seeAttached}`
      : `Please clarify the detail ${where}.${seeAttached}`,
    submittedBy: '',
    assignedTo: '',
    dateSubmitted: now.toISOString(),
    dateRequired: toCalendarDayString(addCalendarDays(now, 14)),
    status: 'open' as const,
    priority: 'normal' as const,
    ballInCourt: 'gc' as const,
    linkedDrawing: sheetName,
    attachments,
    // #146: the linked photo's id rides with it, so app/rfi.tsx draws the
    // markup he made on that photo (attachment 0) on every device.
    ...(photo ? { sourcePhotoId: photo.id } : {}),
  };
}

// ── #93 / #113 What a sheet attachment stores ──────────────────────────────

// Mirror of utils/planSheetUrls.ts planSheetStoragePath + isProjectScopedPlanSheetPath.
// Duplicated ON PURPOSE: that module imports the Supabase client, and this file
// must stay pure so bun validators can execute it. scripts/validate-w4-plans-*
// runs both over the same inputs so the two cannot drift.
const PLAN_SHEET_URL_MARKERS = [
  '/storage/v1/object/public/plan-sheets/',
  '/storage/v1/object/sign/plan-sheets/',
  '/storage/v1/object/plan-sheets/',
] as const;
const DEVICE_LOCAL = /^(file|blob|data|content|ph|assets-library):/i;
const PROJECT_FOLDER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i;

/** The plan-sheets object key inside a path or a public/signed storage URL, or
 *  '' when the value is not a plan-sheets reference (see planSheetStoragePath). */
export function planSheetKeyOf(uri: string | null | undefined): string {
  const raw = String(uri ?? '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return DEVICE_LOCAL.test(raw) ? '' : raw.replace(/^\/+/, '');
  for (const marker of PLAN_SHEET_URL_MARKERS) {
    const at = raw.indexOf(marker);
    if (at < 0) continue;
    const tail = raw.slice(at + marker.length);
    const q = tail.indexOf('?');
    const key = q >= 0 ? tail.slice(0, q) : tail;
    try { return decodeURIComponent(key); } catch { return key; }
  }
  return '';
}

/**
 * What an RFI stores for a drawing: the DURABLE plan-sheets key
 * (`<projectId>/<id>-page-N.png`), or '' when there is nothing any other
 * device could ever open.
 *
 * #93 / #113: this used to keep the signed https URL itself, which dies 24 h
 * after it was minted — the GC's own tile went blank a day later and the
 * architect's reply page lost the drawing mid-review. A key never expires;
 * every reader signs it when it draws it (app/rfi.tsx, the send, and the reply
 * page through signed-media-urls). Only a PROJECT-SCOPED key is kept: a legacy
 * `tmp/` object no membership policy can sign. An https image that is not
 * ours (or a legacy tmp/ URL) is kept as-is — there is no key to recover. A
 * device-local file or a bare non-project path is dropped.
 */
export function attachableSheetUri(uri: string | null | undefined): string {
  const u = String(uri ?? '').trim();
  const key = planSheetKeyOf(u);
  if (key && PROJECT_FOLDER.test(key)) return key;
  return /^https:\/\//i.test(u) ? u : '';
}

/**
 * The value to attach for a sheet object: its storagePath when it has one (set
 * only for project-scoped keys), else whatever attachableSheetUri keeps of its
 * renderable URI. #94: offline, `imageUri` is the cached bare key and used to be
 * dropped, so a pin RFI raised on site went out with no sheet.
 */
export function sheetAttachmentFor(sheet: { storagePath?: string; imageUri?: string }): string {
  return attachableSheetUri(sheet.storagePath || sheet.imageUri);
}

/** True when `attachments` already carry this sheet (compared by object key,
 *  so a legacy signed URL and the bare key count as the same drawing). */
export function attachmentsHaveSheet(attachments: readonly string[], sheetKey: string): boolean {
  const key = planSheetKeyOf(sheetKey);
  if (!key) return false;
  return attachments.some(a => planSheetKeyOf(a) === key);
}

/**
 * #94: the email's pin sentence. The reply page circles a pin only on a tile
 * whose object key matches the pin's sheet (pin_marks.sheet_path), so the
 * circle is promised only when such a tile was actually signed for this send.
 */
export function pinLocationLine(opts: {
  sheetName: string; x: number; y: number;
  /** A reply link exists AND a signed attachment carries the pin's sheet. */
  circledAtReplyLink: boolean;
}): string {
  const where = `Marked location: ${opts.sheetName}, ${Math.round(opts.x * 100)}% across and ${Math.round(opts.y * 100)}% down the sheet`;
  return opts.circledAtReplyLink
    ? `${where} — circled on the sheet at the reply link.`
    : `${where} (the sheet is not attached; the location is given here in words).`;
}

// ── #78 Answers only from the current revision ─────────────────────────────

/**
 * Split vector matches into those on a CURRENT sheet and those on a superseded
 * or deleted one. Runs BEFORE the confidence floor and the prompt: filtering
 * only the citation chips is too late, the model has already read the old
 * header size by then.
 */
export function splitMatchesByCurrentSheet<T extends { doc_id: string }>(
  matches: readonly T[],
  sheets: readonly { id: string; superseded?: boolean }[],
): { current: T[]; staleDropped: number } {
  const currentIds = new Set(sheets.filter(s => s.superseded !== true).map(s => s.id));
  const current: T[] = [];
  let staleDropped = 0;
  for (const m of matches) {
    const id = sheetIdFromDocId(m.doc_id);
    if (id && currentIds.has(id)) current.push(m);
    else staleDropped++;
  }
  return { current, staleDropped };
}

/** The line shown when older-revision matches were left out of an answer.
 *  #114: `canIndex` false (a viewer or field seat) must not be told to "tap
 *  Index" — a button his seat does not have. */
export function staleMatchesNote(staleDropped: number, answeredFromCurrent: boolean, canIndex = true): string | null {
  if (staleDropped <= 0) return null;
  const n = `${staleDropped} match${staleDropped === 1 ? '' : 'es'}`;
  if (!canIndex) {
    return answeredFromCurrent
      ? `${n} came from a superseded or deleted sheet and ${staleDropped === 1 ? 'was' : 'were'} left out — ask the project owner or an editor to re-index the new revision.`
      : `The only matching sheets were older revisions — the current set isn't indexed yet. Ask the project owner or an editor to re-index it.`;
  }
  return answeredFromCurrent
    ? `${n} came from a superseded or deleted sheet and ${staleDropped === 1 ? 'was' : 'were'} left out — tap Index to read the new revision.`
    : `The only matching sheets were older revisions — the current set isn't indexed yet. Tap Index to search it.`;
}

/** The index button's wording when the manifest says sheets changed since the
 *  last run. null = the manifest could not be read (never claim "up to date"). */
export function changedSinceIndexLabel(staleCount: number | null): string | null {
  if (staleCount === null || staleCount <= 0) return null;
  return `Index ${staleCount} changed sheet${staleCount === 1 ? '' : 's'} — answers may be from older revisions`;
}

// ── #73 Who may do what to the plan set ────────────────────────────────────

export type PlanRole = 'owner' | 'editor' | 'viewer' | 'field' | null;

/** What a project-scoped plan screen shows. `open` means the screen renders;
 *  the per-control blocks below still apply inside it. */
export type PlanGate = 'open' | 'loading' | 'error' | 'no_access' | 'locked';

/**
 * The GATING CONTRACT for Plans / the viewer. Project access (own tier OR the
 * collaborator grant) opens it. Otherwise: a spinner only while the role read
 * is in flight (a free foreman must not see a paywall flash), a retry on a
 * failed read (a network error is not an upgrade prompt), and a null role after
 * loading is "no access" said plainly — never a spinner forever.
 */
export function planScreenGate(s: { canAccess: boolean; roleLoading: boolean; roleError: boolean; role: PlanRole; offline?: boolean }): PlanGate {
  if (s.canAccess) return 'open';
  if (s.roleLoading) return 'loading';
  // Offline, a paused role read is neither loading nor errored — and it is not
  // "no access" either. It gets the retry ("check your connection").
  if (s.roleError || (s.offline && s.role === null)) return 'error';
  if (s.role === null) return 'no_access';
  return 'locked';
}

export type PlanControl = 'import' | 'delete' | 'compare' | 'estimate' | 'index' | 'markup';

/** The one sentence for a seat that may not build the index — the same words
 *  plan-extract and project-memory-embed refuse with. */
export const PLAN_INDEX_REFUSAL = 'The project owner or an editor indexes the plan set \u2014 you can ask questions of the sheets they indexed.';

/** Why the role read has not produced a role. A null role means different
 *  things, and each needs its own sentence: still in flight, the read FAILED
 *  (retry), or paused because the device is offline (web react-query pauses a
 *  query offline — it is then neither loading nor errored). */
export interface PlanRoleStatus { isError?: boolean; offline?: boolean }

/**
 * The role the plan controls act on. The collaborator read is the authority,
 * but when it has not produced a role (in flight, failed, paused offline) the
 * local project row already knows whether this user OWNS the job
 * (projects.user_id, loaded as ownerUserId). An owner must not lose Delete or
 * Import to a network blip. Only 'owner' is inferred — a collaborator's cached
 * role could be stale (removed from the job), so it is never trusted here.
 */
export function effectivePlanRole(
  role: PlanRole,
  project: { ownerUserId?: string | null } | null | undefined,
  userId: string | null | undefined,
): PlanRole {
  if (role !== null) return role;
  const owner = project?.ownerUserId;
  return owner && userId && owner === userId ? 'owner' : null;
}

/**
 * Why `role` may NOT use a plan control, or null when it may. Every refusal is
 * the sentence the disabled control shows.
 *
 *   import / compare — write sheets into the GC's set (plan-sheets storage is
 *     editor+), so field and viewer seats are refused;
 *   delete — the project owner; an editor only for sheets HE added, which is
 *     sheetDeleteBlock's per-sheet decision (plan_sheets_collab_delete:
 *     auth.uid() = user_id OR the project owner) — this screen-wide check
 *     refuses every non-owner;
 *   estimate — Plan Intelligence is the GC's estimating tool, not the job's;
 *   index — owner or editor (planScope mayWritePlanIndex, #114), metered on the
 *     owner's plan and allowance; viewer and field seats ask only;
 *   markup — pins, strokes, scale and sheet numbers insert/update at field tier
 *     and above (field_role_reconcile: drawing_pins, plan_markups,
 *     plan_calibrations, plan_sheets _collab_insert/_collab_update), so a
 *     viewer's write would fail silently at RLS.
 *
 * A null role is refused, never waved through — with the sentence that is true
 * for WHY it is null: a failed read says so and points at Try again; offline
 * says the check waits for signal; otherwise it is still checking.
 */
export function planControlBlock(role: PlanRole, control: PlanControl, status?: PlanRoleStatus): string | null {
  if (role === null) {
    if (status?.isError) return 'Couldn\u2019t check your role on this job \u2014 tap Try again.';
    if (status?.offline) return 'You\u2019re offline, so your role on this job can\u2019t be checked yet \u2014 this unlocks when you reconnect.';
    return 'Checking your role on this job\u2026';
  }
  if (role === 'owner') return null;
  switch (control) {
    case 'import':
      return role === 'editor' ? null : 'Only the project owner or an editor can add sheets to this job.';
    case 'compare':
      return role === 'editor' ? null : 'Only the project owner or an editor can compare revisions \u2014 a comparison files the new revision into the set.';
    case 'delete':
      return 'Only the project owner, or the editor who added a sheet, can delete it.';
    case 'estimate':
      return role === 'editor' ? null : 'Estimating rooms from a sheet is the project owner\u2019s tool.';
    case 'index':
      // #114: the server lets an editor index (planScope mayWritePlanIndex,
      // metered on the owner's plan), so refusing him here was a client-only
      // dead end right after he filed a revision through Compare.
      return role === 'editor' ? null : PLAN_INDEX_REFUSAL;
    case 'markup':
      return role === 'viewer' ? 'Viewer seats can look but not mark up \u2014 ask the project owner for a field seat.' : null;
  }
}

/**
 * #118: may this seat delete THIS sheet? The owner always; an editor only a
 * sheet he added (plan_sheets_collab_delete: auth.uid() = user_id OR the
 * project owner). A sheet with no recorded uploader (legacy row, or one read
 * before the uploader was mapped) stays blocked — the server would refuse him.
 */
export function sheetDeleteBlock(
  role: PlanRole,
  sheet: { userId?: string },
  userId: string | null | undefined,
  status?: PlanRoleStatus,
): string | null {
  const screenWide = planControlBlock(role, 'delete', status);
  if (screenWide === null) return null;
  if (role === 'editor' && sheet.userId && userId && sheet.userId === userId) return null;
  if (role === 'editor') return 'Only the project owner, or the editor who added this sheet, can delete it \u2014 someone else added this one.';
  return screenWide;
}
