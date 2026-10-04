// utils/messageAiCore.ts — the rules behind "Read with MAGE" on a client's
// portal message (lane ATTPORTAL). Pure: no react-native, no i18n, no storage,
// no logging. scripts/validate-portal-message-ai.ts runs every rule here.
//
// What this file decides, and nothing else:
//   - which message gets the button (the owner, on a phone, on a client's sent
//     message that carries a stored file, written after the client was told);
//   - which of the message's files are sent to be read and which are listed as
//     "Not read", with the reason;
//   - what of the model's text is drawn (the own-words gate, asked once for the
//     whole reading);
//   - where a draft goes when the contractor picks a record type.
// The AI never picks the record type, never sets a price and never sets a
// change order's reason: the routes below carry a fixed reason and no amount.
// The size and count limits are the ones in utils/askFilesCore; none is typed
// here.

import type { AskFileRead, AskFilesSuccess, MessageAiDraft, MessageAttachment } from '@/types';
import { ASK_MAX_FILES, ASK_MESSAGE_FILE_MAX_BYTES, ASK_TOTAL_MAX_BYTES, guardFileText } from '@/utils/askFilesCore';

/** ISO time the portal page's AI notice went live. '' = no message qualifies. Set at flip B,
 *  equal to MESSAGE_SOURCE_NOT_BEFORE in supabase/functions/ask-files/core.ts. */
export const MESSAGE_AI_NOT_BEFORE = '';

/** The server's pattern for the cut-off (ISO_TIME_RE in supabase/functions/ask-files/core.ts):
 *  an ISO time that names its zone. A date alone, or a time with no zone, is
 *  a different instant on every phone, so it is read as no cut-off at all. */
const NOTICE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

/** Milliseconds for a cut-off written the way the server accepts it, else NaN. */
export function noticeTimeMs(notBefore: unknown): number {
  if (typeof notBefore !== 'string' || !NOTICE_TIME_RE.test(notBefore)) return NaN;
  return Date.parse(notBefore);
}

/** Whether the button is offered. The cut-off is held to the server's own
 *  pattern: no cut-off, or one the server would not accept, is a no. The
 *  message time is the one this phone holds, in whatever form it was stored;
 *  an unreadable one, or one older than the cut-off, is a no. The server makes
 *  the real decision from its own copy of the message time. */
export function isAfterNotice(createdAt: string, notBefore: string): boolean {
  const cut = noticeTimeMs(notBefore);
  if (!Number.isFinite(cut)) return false;
  if (typeof createdAt !== 'string' || createdAt === '') return false;
  const at = Date.parse(createdAt);
  if (!Number.isFinite(at)) return false;
  return at >= cut;
}

export interface CanReadWithAiInput {
  flag: boolean;
  isWeb: boolean;
  role: string | null | undefined;
  authorType: string;
  pending: boolean;
  attachments: { path?: string }[];
  createdAt: string;
  notBefore: string;
}

/** True only when every condition holds. A role still loading is not the owner. */
export function canReadWithAi(i: CanReadWithAiInput): boolean {
  if (i.flag !== true) return false;
  if (i.isWeb !== false) return false;
  if (i.role !== 'owner') return false;
  if (i.authorType !== 'client') return false;
  if (i.pending !== false) return false;
  const stored = Array.isArray(i.attachments)
    && i.attachments.some((a) => !!a && typeof a.path === 'string' && a.path.length > 0);
  if (!stored) return false;
  return isAfterNotice(i.createdAt, i.notBefore);
}

export type NotReadReason = 'count' | 'size' | 'total' | 'pages' | 'unreadable' | 'missing';

export interface AiReadableFiles {
  read: MessageAttachment[];
  notRead: { att: MessageAttachment; reason: NotReadReason }[];
}

/** The files that are sent to be read, in message order, and the rest with
 *  the reason each one is left out. */
export function aiReadableFiles(
  attachments: MessageAttachment[],
  excluded?: ReadonlyMap<string, NotReadReason>,
): AiReadableFiles {
  const read: MessageAttachment[] = [];
  const notRead: { att: MessageAttachment; reason: NotReadReason }[] = [];
  let total = 0;
  for (const att of attachments ?? []) {
    if (!att) continue;
    const out = excluded?.get(att.id);
    if (out) { notRead.push({ att, reason: out }); continue; }
    if (typeof att.path !== 'string' || att.path.length === 0) { notRead.push({ att, reason: 'missing' }); continue; }
    const size = Number.isFinite(att.size) && att.size > 0 ? att.size : 0;
    if (size > ASK_MESSAGE_FILE_MAX_BYTES) { notRead.push({ att, reason: 'size' }); continue; }
    if (read.length === ASK_MAX_FILES) { notRead.push({ att, reason: 'count' }); continue; }
    if (total + size > ASK_TOTAL_MAX_BYTES) { notRead.push({ att, reason: 'total' }); continue; }
    total += size;
    read.push(att);
  }
  return { read, notRead };
}

/** A server refusal that names one file moves that file to "Not read". */
export function refusalToNotRead(code: string): NotReadReason | null {
  switch (code) {
    case 'file_too_large': return 'size';
    case 'too_many_pages': return 'pages';
    case 'unreadable_file': return 'unreadable';
    default: return null;
  }
}

/** Why "Read files" is off before anything is sent: the plan first, then the connection. */
export function messageAiBlock(i: { isPro: boolean; offline: boolean }): 'plan' | 'offline' | null {
  if (!i.isPro) return 'plan';
  if (i.offline) return 'offline';
  return null;
}

// ─── Where a draft goes (the contractor picks; the AI does not) ──────────────

/** Today's change-order params, exactly as the manual convert sends them. */
export function coDraftRoute(projectId: string, description: string) {
  return {
    pathname: '/change-order' as const,
    params: { projectId, prefillReason: 'client_request', prefillDescription: description },
  };
}

/** The RFI form takes the draft by an in-memory id, never the text. */
export function rfiDraftRoute(projectId: string, draftId: string) {
  return { pathname: '/rfi' as const, params: { projectId, prefillDraft: draftId } };
}

/** The punch form takes the draft by an in-memory id, never the text. */
export function punchDraftRoute(projectId: string, draftId: string) {
  return { pathname: '/punch-list' as const, params: { projectId, new: '1', prefillDraft: draftId } };
}

// ─── What of the model's text is drawn ───────────────────────────────────────

/** Why the sheet draws no ask line. */
export type AsksEmpty = 'none' | 'withheld';
/** Why the sheet draws no draft. */
export type DraftEmpty = 'none' | 'withheld' | 'notWritten';

/** What the model wrote, after the own-words gate, plus what the server read. */
export interface MessageReadingView {
  summary: string;
  asks: string[];
  draft: MessageAiDraft | null;
  read: AskFileRead[];
  truncated: boolean;
  /** The gate took something out of the summary, the asks or the draft. */
  withheld: boolean;
  /** null while an ask line is drawn; otherwise why there is none (asksEmptyReason). */
  asksEmpty: AsksEmpty | null;
  /** null while a draft is drawn; otherwise why there is none (draftEmptyReason). */
  draftEmpty: DraftEmpty | null;
}

/**
 * Why no ask line is drawn. `found` is how many lines with text the server
 * sent, `shown` how many are left after the gate.
 *   'none'      the server sent no line: the reading held no request;
 *   'withheld'  it sent at least one and the gate on this phone took every
 *               one. "MAGE found no request" would be false there.
 */
export function asksEmptyReason(found: number, shown: number): AsksEmpty | null {
  if (shown > 0) return null;
  return found > 0 ? 'withheld' : 'none';
}

/**
 * Why no draft is drawn.
 *   'withheld'    the server sent a draft with a description (`written`) and
 *                 the gate on this phone emptied it;
 *   'notWritten'  the server sent no draft although it listed requests
 *                 (`asksFound`): "because MAGE found no request" would be false;
 *   'none'        no draft and no request line: nothing was found.
 */
export function draftEmptyReason(i: { shown: boolean; written: boolean; asksFound: number }): DraftEmpty | null {
  if (i.shown) return null;
  if (i.written) return 'withheld';
  return i.asksFound > 0 ? 'notWritten' : 'none';
}

/**
 * Every model text goes through the own-words gate before it is drawn. The
 * gate's first question, "does this answer name a code?", is asked ONCE for
 * the whole reading: the summary, every ask and the draft are handed to each
 * call, so a code named in the summary holds code text in an ask or in the
 * draft (the draft is the text that opens a change order, an RFI or a punch
 * item). The labels are the names of the files the server read, so a sheet or
 * invoice number in a file name is not mistaken for a code section.
 *
 * It also says WHY the asks or the draft are empty (asksEmpty, draftEmpty),
 * from what the server sent before the gate: "nothing was found" and "the
 * gate hid what was found" are different sentences in the sheet.
 */
export function guardMessageReading(data: Extract<AskFilesSuccess, { mode: 'message' }>): MessageReadingView {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const read = Array.isArray(data.read) ? data.read : [];
  const labels = read.map((r) => r.name);
  const rawAsks = (Array.isArray(data.asks) ? data.asks : []).map(str);
  const whole = [str(data.summary), ...rawAsks, str(data.draft?.title), str(data.draft?.description)];
  let withheld = 0;
  const gate = (text: string): string => {
    const g = guardFileText(text, labels, whole);
    withheld += g.withheld;
    return g.text;
  };
  const summary = gate(str(data.summary));
  const asks = rawAsks.map(gate).filter((line) => line.length > 0);
  // A line with text that the gate returns empty was taken out by the gate:
  // guardFileText answers '' only for blank text or for text it withheld.
  const asksFound = rawAsks.filter((line) => line.trim().length > 0).length;
  let draft: MessageAiDraft | null = null;
  let written = false;
  if (data.draft) {
    const title = gate(str(data.draft.title));
    const description = gate(str(data.draft.description));
    written = str(data.draft.description).trim().length > 0;
    // A draft whose description the gate emptied is no draft.
    if (description.length > 0) draft = { title, description };
  }
  return {
    summary, asks, draft, read, truncated: !!data.truncated, withheld: withheld > 0,
    asksEmpty: asksEmptyReason(asksFound, asks.length),
    draftEmpty: draftEmptyReason({ shown: draft !== null, written, asksFound }),
  };
}

// ─── The draft's text ────────────────────────────────────────────────────────

export const DRAFT_TEXT_MAX = 1000;

/**
 * The description a draft opens with: the text, then the line naming the files
 * it came from, then `notReadNote` ("(2 more not read)") when files were left
 * out. Cut to DRAFT_TEXT_MAX. The note is never what gets cut: when the text is
 * too long, the description and the names give way (marked with "…") and the
 * note stays whole at the end, so a draft never reads as if every file was read.
 */
export function draftText(description: string, filesLine: string, notReadNote: string = ''): string {
  const head = `${description ?? ''}\n${filesLine ?? ''}`.trim();
  const note = (notReadNote ?? '').trim().slice(0, DRAFT_TEXT_MAX);
  if (!note) return head.slice(0, DRAFT_TEXT_MAX);
  if (!head) return note;
  const whole = `${head} ${note}`;
  if (whole.length <= DRAFT_TEXT_MAX) return whole;
  // Room for the head: the limit, less the note, the space before it and the "…".
  const room = Math.max(0, DRAFT_TEXT_MAX - note.length - 2);
  const cut = head.slice(0, room).trimEnd();
  return cut ? `${cut}… ${note}` : note;
}
