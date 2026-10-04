// utils/askFilesCore.ts — the pure rules behind "MAGE reads a file" (edge
// function ask-files). Limits, what Ask keeps of a picked file, what a turn
// may remember about a file, how a failed read becomes a sentence, and the
// own-words gate for text that came out of a file.
//
// PURE: no react-native, no i18n layer, no storage, nothing written to a log.
// scripts/validate-ask-files.ts runs every rule here under bun and pins the
// limits to the server's (supabase/functions/ask-files/core.ts).
//
// Shared by Ask MAGE (components/brain/AskConversation.tsx) and the portal
// sheet (components/messages/MessageAiSheet.tsx), so both refuse the same
// files and say the same thing when a read fails.
import type { AskAttachedFile, AskFileRead, AskTurnFile } from '@/types';
import {
  longestRun, ownWordsProse, proseSentences, sectionsIn, withoutInchMarks,
} from '@/utils/codeCard/echoCheck';
import type { AskCopy } from '@/hooks/useAskCopy';

// ── Limits (PLAN 2.4). No limit is ever typed into a string: every sentence
// takes its number from these. ─────────────────────────────────────────────
export const ASK_MAX_FILES = 4;
export const ASK_DEVICE_TOTAL_MAX_BYTES = 6291456;
export const ASK_PLAN_PAGE_MAX_BYTES = 8388608;
export const ASK_MESSAGE_FILE_MAX_BYTES = 4194304;
export const ASK_TOTAL_MAX_BYTES = 8388608;
export const ASK_PDF_MAX_PAGES = 20;
export const ASK_QUESTION_MAX = 2000;
export const ASK_CLIENT_TIMEOUT_MS = 140000;
export const ASK_FILE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const FILE_CODE_RUN_WORDS = 40;
export const mbOf = (bytes: number): number => Math.round(bytes / 1048576);

/** The bytes a base64 payload decodes to: floor(len * 3 / 4) minus its padding. */
export function decodedBase64Bytes(base64: string): number {
  const len = base64.length;
  if (len === 0) return 0;
  const pad = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((len * 3) / 4) - pad);
}

// ── Plan pages ──────────────────────────────────────────────────────────────

const PLAN_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAN_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const PLAN_EXT_RE = /\.(?:png|jpe?g|webp)$/i;
/** '%', a backslash, '?', '#', any whitespace or any control character. */
const PLAN_FORBIDDEN_RE = /[%\\?#\s\u0000-\u001f\u007f-\u009f]/;

/**
 * May this stored path be sent as a plan page? The server's planSheetKey rule
 * (PLAN 2.5): exactly `<project uuid>/<file name>`, nothing that a URL could
 * read as another folder. The plan list offers only pages that pass, so the
 * server never has to refuse one he picked.
 */
export function isAskablePlanPath(path: unknown): boolean {
  if (typeof path !== 'string') return false;
  if (path.length === 0 || path.length > 260 || path !== path.trim()) return false;
  if (PLAN_FORBIDDEN_RE.test(path)) return false;
  const segments = path.split('/');
  if (segments.length !== 2) return false;
  if (!PLAN_UUID_RE.test(segments[0])) return false;
  return PLAN_FILE_RE.test(segments[1]) && PLAN_EXT_RE.test(segments[1]);
}

export type AskPlanRowBlock = 'noJob' | 'checking' | 'unknown' | 'notOwner';

/**
 * Why the "Plan page" row is off, or null when a page can be picked. The
 * server reads a plan page only for the account that OWNS the job
 * (PLAN_PAGES_OWNER_ONLY in supabase/functions/ask-files/core.ts), so the row
 * is offered to the owner alone: anyone else would attach a page, ask, and be
 * told the file is not available. A role still loading is not the owner, and
 * neither is one that could not be read.
 */
export function askPlanRowBlock(i: {
  hasJob: boolean; role: string | null | undefined; isLoading: boolean; isError: boolean;
}): AskPlanRowBlock | null {
  if (i.hasJob !== true) return 'noJob';
  if (i.role === 'owner') return null;
  if (i.isLoading === true) return 'checking';
  if (i.isError === true || typeof i.role !== 'string' || i.role === '') return 'unknown';
  return 'notOwner';
}

// ── What Ask keeps of the files he just picked ──────────────────────────────

export type AskVetReason = 'count' | 'size' | 'total';
export interface AskVetResult {
  /** Indexes into `picked`, in picker order. */
  kept: number[];
  refused: { index: number; name: string; reason: AskVetReason; size?: number }[];
}

const deviceBytes = (files: readonly AskAttachedFile[]): number =>
  files.reduce((sum, f) => sum + (f.source === 'device' && f.size > 0 ? f.size : 0), 0);

/**
 * Ask's own limits on newly picked device files, in picker order: the file
 * count, one file against the device allowance, then the running total. A size
 * of 0 is unknown: it passes here and the bytes are measured at send.
 */
export function vetAskFiles(
  picked: readonly { name: string; size: number }[],
  attached: readonly AskAttachedFile[],
): AskVetResult {
  const kept: number[] = [];
  const refused: AskVetResult['refused'] = [];
  let bytes = deviceBytes(attached);
  picked.forEach((p, index) => {
    const size = typeof p.size === 'number' && p.size > 0 ? p.size : 0;
    if (attached.length + kept.length >= ASK_MAX_FILES) {
      refused.push({ index, name: p.name, reason: 'count' });
      return;
    }
    if (size > ASK_DEVICE_TOTAL_MAX_BYTES) {
      refused.push({ index, name: p.name, reason: 'size', size });
      return;
    }
    if (bytes + size > ASK_DEVICE_TOTAL_MAX_BYTES) {
      // `size` here is what the files would come to together.
      refused.push({ index, name: p.name, reason: 'total', size: bytes + size });
      return;
    }
    kept.push(index);
    bytes += size;
  });
  return { kept, refused };
}

// ── What a turn may remember about a file ───────────────────────────────────
// Turns are saved whole to Ask history. A name, a kind and a page count are
// all that is kept: never a location, an id, a size or the bytes.

const pagesOf = (pages: unknown): number | undefined =>
  (typeof pages === 'number' && Number.isFinite(pages) && pages > 0 ? Math.floor(pages) : undefined);

function turnFile(name: string, kind: AskTurnFile['kind'], pages: unknown): AskTurnFile {
  const p = pagesOf(pages);
  return p === undefined ? { name, kind } : { name, kind, pages: p };
}

/** The server's "what I sent to the model" list, as a turn keeps it. */
export function toTurnFiles(read: readonly AskFileRead[]): AskTurnFile[] {
  return (Array.isArray(read) ? read : []).map((r) => turnFile(
    typeof r?.name === 'string' ? r.name : '',
    r?.kind === 'pdf' || r?.kind === 'plan' ? r.kind : 'image',
    r?.pages,
  ));
}

/** The files in the composer, as the question's turn keeps them. */
export function attachedTurnFiles(files: readonly AskAttachedFile[]): AskTurnFile[] {
  return files.map((f) => (f.source === 'plan'
    ? turnFile(f.name, 'plan', undefined)
    : turnFile(f.name, f.mime === 'application/pdf' ? 'pdf' : 'image', f.pages)));
}

/**
 * The turns the text model may be sent: the ones that carry neither `files`
 * (a file question) nor `read` (MAGE's reading of a file, or a failed read).
 * Once the files are out of the tray the text model must not be handed a
 * reading of a file it cannot see.
 */
export function withoutFileTurns<T extends { files?: unknown; read?: unknown }>(turns: readonly T[]): T[] {
  return turns.filter((t) => t.files === undefined && t.read === undefined);
}

// ── A failed read, as one sentence ──────────────────────────────────────────

export type AskFilesErrKey =
  | 'offline' | 'timeout' | 'network' | 'plan' | 'unavailable' | 'tooLarge' | 'tooLargeTogether'
  | 'pages' | 'unreadable' | 'count' | 'type' | 'blocked' | 'noAnswer' | 'service' | 'signIn'
  | 'off' | 'generic';

const ERR_KEY: Readonly<Record<string, AskFilesErrKey>> = {
  offline: 'offline',
  client_timeout: 'timeout',
  network: 'network',
  tier_required: 'plan',
  file_unavailable: 'unavailable',
  file_too_large: 'tooLarge',
  files_too_large: 'tooLargeTogether',
  body_too_large: 'tooLargeTogether',
  too_many_pages: 'pages',
  unreadable_file: 'unreadable',
  too_many_files: 'count',
  unsupported_type: 'type',
  blocked: 'blocked',
  no_answer: 'noAnswer',
  upstream_timeout: 'service',
  upstream_error: 'service',
  rate_limiter_unavailable: 'service',
  not_configured: 'service',
  ai_check_unavailable: 'service',
  unauthenticated: 'signIn',
  feature_off: 'off',
};

/** Which sentence a code gets. Anything not listed (bad_request, internal, account_ai_off, before_notice, an unknown code) is 'generic'. */
export function askFilesErrKey(code: string): AskFilesErrKey {
  return (typeof code === 'string' && Object.prototype.hasOwnProperty.call(ERR_KEY, code)) ? ERR_KEY[code] : 'generic';
}

export interface AskFilesFailure {
  code: string;
  message: string;
  fileIndex?: number;
  pages?: number;
  limit?: number;
}

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * The one place a failed read becomes a sentence, so Ask and the portal sheet
 * say the same thing. `names` are the files that were sent, in order. A
 * sentence the gate or the server already wrote (consent, the monthly cap, the
 * hourly limit) is shown as it is. Never returns ''.
 */
export function askFilesSentence(outcome: AskFilesFailure, copy: AskCopy['files'], names: readonly string[]): string {
  if (typeof outcome.message === 'string' && outcome.message.trim()) return outcome.message;
  const i = outcome.fileIndex;
  const picked = typeof i === 'number' && Number.isInteger(i) && i >= 0 ? names[i] : undefined;
  const name = typeof picked === 'string' && picked.trim() ? picked : copy.fileFallback;
  let out: string;
  switch (askFilesErrKey(outcome.code)) {
    case 'tooLarge': out = copy.errTooLarge(name, mbOf(positive(outcome.limit) ? outcome.limit : ASK_PLAN_PAGE_MAX_BYTES)); break;
    case 'tooLargeTogether': out = copy.errTooLargeTogether(mbOf(positive(outcome.limit) ? outcome.limit : ASK_TOTAL_MAX_BYTES)); break;
    case 'pages': out = copy.refusePages(name, positive(outcome.pages) ? outcome.pages : 0, positive(outcome.limit) ? outcome.limit : ASK_PDF_MAX_PAGES); break;
    case 'unreadable': out = copy.errUnreadable(name); break;
    case 'type': out = copy.refuseType(name); break;
    case 'count': out = copy.refuseCount(ASK_MAX_FILES); break;
    case 'offline': out = copy.errOffline; break;
    case 'timeout': out = copy.errTimeout; break;
    case 'network': out = copy.errNetwork; break;
    case 'plan': out = copy.errPlan; break;
    case 'unavailable': out = copy.errUnavailable; break;
    case 'blocked': out = copy.errBlocked; break;
    case 'noAnswer': out = copy.errNoAnswer; break;
    case 'service': out = copy.errService; break;
    case 'signIn': out = copy.errSignIn; break;
    case 'off': out = copy.errOff; break;
    default: out = copy.errGeneric;
  }
  return out || copy.errGeneric || 'Something went wrong reading the files. Try again.';
}

// ── The own-words gate for text that came out of a file (PLAN 2.12) ─────────
//
// The cards' prose gate takes out every sentence with a quotation, and its
// section matcher also matches sheet numbers (S1.02), document numbers
// (INV1024, CO123) and plain decimals. Run over a whole file answer it would
// hide what a client wrote and blame building-code text. So the gate asks one
// question of the WHOLE answer first: does any sentence read like a code?

// A code named by its letters, or by its title: "NYC Building Code",
// "California Residential Code", "International Fuel Gas Code", "National
// Electrical Code", "Uniform Plumbing Code". Capitals only ("the local building
// code" in a sentence of his own is not a title). IFC, UPC, IPC, IMC and UMC
// are left out as letters: "IFC" is "issued for construction" on a drawing and
// "UPC" is a barcode.
const CODE_NAME_RE = /\b(?:IRC|IBC|IECC|IEBC|NEC|NFPA|ICC)\b|\b(?:Building|Residential|Plumbing|Mechanical|Electrical|Fire|Fuel Gas|Energy(?: Conservation)?) Code\b/;
const SECTION_WORD_RE = /(?:\bsections?\b|\bsec\.|§)\s*(?:[RNMGPE]\d{3,4}(?:\.\d+)*|\d{3,4}\.\d+)/i;
const CODE_SECTION_SHAPE = /^(?:[RNMGPE]\d{3,4}(?:\.\d+)+|\d{3,4}(?:\.\d+){2,}|\d{3,4}\.\d+(?=\())(?:\([A-Za-z0-9]{1,3}\))*$/;

/** Does this sentence name a model code, or a section number of code shape that is not part of one of this ask's file names? */
function codeLike(sentence: string, labels: readonly string[]): boolean {
  if (CODE_NAME_RE.test(sentence) || SECTION_WORD_RE.test(sentence)) return true;
  const lower = labels.map((l) => (typeof l === 'string' ? l.toLowerCase() : ''));
  return sectionsIn(sentence).some((t) => CODE_SECTION_SHAPE.test(t) && !lower.some((l) => l.includes(t.toLowerCase())));
}

const countOf = (text: string, ch: string): number => text.split(ch).length - 1;

/** How many sentences an open quotation can take with it (it also stops at a line break). */
export const FILE_QUOTE_CARRY_SENTENCES = 2;
/** A numbered-list marker standing alone ("2. "): it goes with the sentence it numbers. */
const LIST_MARKER_RE = /^[ \t]*\d{1,3}\.[ \t]+$/;
const ENDS_LINE_RE = /\n\s*$/;

/**
 * Is a straight double quotation still open at the end of `sentence`, given
 * whether one was open at its start? Inch marks are not quotes (36"), with one
 * exception: when the count comes out open and the sentence's LAST double quote
 * was read as an inch mark, that mark is the closing quote (a quotation that
 * ends in a number: "rated 20").
 */
function straightOpenAfter(sentence: string, openBefore: boolean): boolean {
  const real = countOf(withoutInchMarks(sentence), '"');
  const open = openBefore !== (real % 2 === 1);
  if (!open) return false;
  const last = sentence.lastIndexOf('"');
  if (last < 0) return true;
  // Everything but the last quote: when that holds as many real quotes as the
  // whole sentence, the last one was read as an inch mark.
  const lastWasInch = countOf(withoutInchMarks(sentence.slice(0, last)), '"') === real;
  return !lastWasInch;
}

/**
 * A file answer as it may be shown, sentence by sentence. Everything that is
 * not taken out stays exactly as written. `labels` are this ask's file names.
 * `sameAnswer` is for an answer that arrives in several fields (the portal
 * sheet's summary, asks and draft): the other fields' text, which is asked
 * the code question too, so a code named in one field holds every field.
 *
 * 1. THE WHOLE ANSWER. When no sentence is CODE-LIKE (names a model code or a
 *    code section), the answer is shown as written: contract wording, sheet
 *    and invoice numbers and a client's quoted words are not code text.
 * 2. When ANY sentence is code-like, wherever it stands, every sentence of the
 *    answer is held to the gate. No paragraphs and no order: a code book
 *    prints a heading and then body sentences that name no code, a model may
 *    put the body a blank line under its lead-in, or name the section after
 *    the body. In such an answer:
 *    - a code-like sentence is taken out when it quotes, uses code phrasing
 *      or runs past FILE_CODE_RUN_WORDS words;
 *    - any other sentence is taken out when it uses code phrasing or runs
 *      past FILE_CODE_RUN_WORDS words. A quotation alone does not count: a
 *      client's quoted words next to "IRC R312.1 covers guards" still show.
 *    THE COST: in an answer that names a code anywhere, contract or plan-note
 *    wording with "shall", "not less than" or "in accordance with" is left
 *    out too. This goes beyond PLAN 2.12, which held only the code-like
 *    sentence.
 * 3. A QUOTATION a taken-out sentence leaves open takes the following
 *    sentences with it until it closes, a line ends, or
 *    FILE_QUOTE_CARRY_SENTENCES sentences have gone (a stray quotation mark
 *    must not swallow the rest of an answer).
 * 4. A numbered-list marker whose sentence was taken out goes with it, and
 *    the line break a taken-out sentence ended stays (lines never run together).
 *
 * A heuristic on the phone. What still passes: code text in an answer that
 * names no code and no code section anywhere (a code this list does not know,
 * "IPC 604.3" with no "Section" word, a file named after its section), and
 * code sentences with no code phrasing and a short run. The server's prompt
 * rule is the first line of defense.
 */
export function guardFileText(
  text: string,
  labels: readonly string[] = [],
  sameAnswer: readonly string[] = [],
): { text: string; withheld: number } {
  const block = typeof text === 'string' ? text : '';
  if (!block.trim()) return { text: '', withheld: 0 };
  const sentences = proseSentences(block);
  // Rules 1 and 2: one question for the whole answer. It is asked of the
  // answer in one piece too: "Sec. 210.8" is cut in two at its period.
  const named = [block, ...sentences, ...sameAnswer].some((s) => typeof s === 'string' && codeLike(s, labels));
  if (!named) return { text: block.trim(), withheld: 0 };
  const kept: string[] = [];
  let withheld = 0;
  // Rule 3: how many more sentences the open quotation may take, and its state.
  let carry = 0;
  let straightOpen = false;
  let curlyOpen = 0;
  // Rule 4: true while the last kept piece is the marker right before this sentence.
  let markerBefore = false;
  const noteQuotes = (sentence: string) => {
    straightOpen = straightOpenAfter(sentence, straightOpen);
    curlyOpen = Math.max(0, curlyOpen + countOf(sentence, '“') - countOf(sentence, '”'));
  };
  const endCarry = () => { carry = 0; straightOpen = false; curlyOpen = 0; };
  for (const sentence of sentences) {
    if (!sentence.trim()) { kept.push(sentence); continue; }
    let hold: boolean;
    if (carry > 0) {
      hold = true;
      carry -= 1;
      noteQuotes(sentence);
      if (carry === 0 || !(straightOpen || curlyOpen > 0) || ENDS_LINE_RE.test(sentence)) endCarry();
    } else {
      const prose = ownWordsProse(sentence, { notice: false });
      hold = longestRun(sentence) > FILE_CODE_RUN_WORDS
        || (codeLike(sentence, labels) ? prose.withheld > 0 : prose.reasons.includes('code_phrasing'));
      if (hold) {
        noteQuotes(sentence);
        if ((straightOpen || curlyOpen > 0) && !ENDS_LINE_RE.test(sentence)) carry = FILE_QUOTE_CARRY_SENTENCES;
        else endCarry();
      }
    }
    if (hold) {
      withheld += 1;
      if (markerBefore) kept.pop();
      markerBefore = false;
      // The line break it ended stays, so the lines around it do not run together.
      const tail = /\s*$/.exec(sentence)?.[0] ?? '';
      const last = kept.length > 0 ? kept[kept.length - 1] : '';
      if (tail.includes('\n') && last !== '' && !ENDS_LINE_RE.test(last)) {
        kept[kept.length - 1] = last.replace(/[ \t]+$/, '') + tail.slice(tail.indexOf('\n'));
      }
      continue;
    }
    kept.push(sentence);
    markerBefore = LIST_MARKER_RE.test(sentence);
  }
  if (withheld === 0) return { text: block.trim(), withheld: 0 };
  return { text: kept.join('').trim(), withheld };
}
