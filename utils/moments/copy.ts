// copy.ts: the words a commit moment is allowed to say (moments wave, lane CAPSULE).
//
// Pure, no imports. lintMomentCopy is the rule book scripts/moments-checks
// runs over every string literal in components/moments/** and utils/moments/**:
// sentence case, no em dash, no exclamation mark, cents on every amount.
// The founder flagged vibe-coded wording in the same request that asked for
// these moments, and an em dash is the loudest tell.

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const EN_BETWEEN_WORDS = new RegExp(`[A-Za-z]\\s*${EN_DASH}\\s*[A-Za-z]|\\s${EN_DASH}\\s`);

/**
 * [] when `s` is clean; otherwise one short reason per rule it breaks:
 *   - an em dash anywhere;
 *   - an en dash used as a dash between words (a digit range such as 9 to 5 is fine);
 *   - an exclamation mark;
 *   - a dollar amount without cents ("$4,200" -> "$4,200.00");
 *   - Title Case (3+ words and every word of 3+ letters capitalised, at
 *     least two of them; a sentence's first word and all-caps words such as
 *     CO or SIGNED do not count);
 *   - a leading lowercase letter;
 *   - a double space, or a trailing space.
 */
export function lintMomentCopy(s: string): string[] {
  const out: string[] = [];
  if (s.includes(EM_DASH)) out.push('Em dash (U+2014)');
  if (EN_BETWEEN_WORDS.test(s)) out.push('En dash used as a dash between words');
  if (s.includes('!')) out.push('Exclamation mark');
  if (/\$\d[\d,]*(?![\d,]|\.\d{2})/.test(s)) out.push('Amount without cents');
  const words = s.split(/\s+/).filter(Boolean);
  // A word that opens a sentence is capitalised by right, so it never counts.
  const qualifying = words
    .filter((_, i) => i > 0 && !/[.?:]$/.test(words[i - 1]))
    .map((w) => w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, ''))
    .filter((w) => /^[A-Za-z]{3,}$/.test(w) && w !== w.toUpperCase());
  if (words.length >= 3 && qualifying.length >= 2 && qualifying.every((w) => /^[A-Z]/.test(w))) out.push('Title Case');
  if (/^[a-z]/.test(s)) out.push('Leading lowercase letter');
  if (/ {2}/.test(s)) out.push('Double space');
  if (/\s$/.test(s)) out.push('Trailing space');
  return out;
}

export interface MomentCopyDefaults {
  /** The screen-reader hint on the slide's button mode. */
  srHint: string;
  /** The honest "not yet" result for a write the offline queue accepted. */
  queued: string;
  busyAnnouncePrefix?: never;
}

export const MOMENT_COPY: MomentCopyDefaults = {
  srHint: 'Double-tap, then confirm',
  queued: 'Saved on this phone · sends when online',
};

// ── Step 0 (lane MOMSTEP0): whole sentences the adapters and the data layer
// hand back. Each one is a complete sentence so the W3 Spanish lanes can
// translate it as one key (docs/I18N.md §3.5). No developer words: never
// "sync", "queue" or "payload".

/** A write kept on this device only because no account is signed in (RecordWriteOutcome 'local'). Never a green tick. */
export const LOCAL_ONLY_TITLE = 'Saved on this phone only';
/** What unlocks it. */
export const LOCAL_ONLY_NEXT = 'Sign in to send it to your account.';

/**
 * An online-only write (utils/offlineQueue supabaseWriteOnline) that would have
 * overtaken an earlier change to the same record still waiting on this phone.
 * Nothing was sent. The data layer answers 'refused' with the code
 * 'earlier_change_pending'; a site's copy file may show this sentence.
 */
export const EARLIER_CHANGE_PENDING_REASON = "An earlier change to this record hasn't sent yet. Try again in a moment.";

/** The same, when the earlier change is under Not saved (the server refused it): Retry goes first. */
export const EARLIER_CHANGE_UNSAVED_REASON = 'An earlier change to this record is under Not saved. Retry it first.';

// ── Wave-next W2 (lane ESTOOLS): the same words in the app's language ─────
// The constants above stay English, byte for byte (the adapters, the
// capsule and their checks compare against them). These function forms read
// the language at CALL time: a provider bound by the i18n layer
// (utils/moments/sealText.ts installMomentLanguage) answers null in English,
// so English callers get exactly the constants. This file stays import-free:
// the moments checks load copies of it on their own.

/** Whole sentences, one per constant above, in the app's language. */
export interface MomentWords {
  srHint: string;
  queued: string;
  localOnlyTitle: string;
  localOnlyNext: string;
  earlierPending: string;
  earlierUnsaved: string;
}

let momentWordsProvider: (() => MomentWords | null) | null = null;

/** Bound once by the i18n layer. null (or a provider answering null) = English. */
export function bindMomentWords(provider: (() => MomentWords | null) | null): void {
  momentWordsProvider = provider;
}

function wordsNow(): MomentWords | null {
  try {
    return momentWordsProvider ? momentWordsProvider() : null;
  } catch {
    return null;
  }
}

/** MOMENT_COPY in the app's language. */
export function momentCopy(): MomentCopyDefaults {
  const w = wordsNow();
  return w ? { srHint: w.srHint, queued: w.queued } : MOMENT_COPY;
}

/** LOCAL_ONLY_TITLE in the app's language. */
export function localOnlyTitle(): string {
  return wordsNow()?.localOnlyTitle ?? LOCAL_ONLY_TITLE;
}

/** LOCAL_ONLY_NEXT in the app's language. */
export function localOnlyNext(): string {
  return wordsNow()?.localOnlyNext ?? LOCAL_ONLY_NEXT;
}

/** EARLIER_CHANGE_PENDING_REASON in the app's language. */
export function earlierChangePendingReason(): string {
  return wordsNow()?.earlierPending ?? EARLIER_CHANGE_PENDING_REASON;
}

/** EARLIER_CHANGE_UNSAVED_REASON in the app's language. */
export function earlierChangeUnsavedReason(): string {
  return wordsNow()?.earlierUnsaved ?? EARLIER_CHANGE_UNSAVED_REASON;
}
