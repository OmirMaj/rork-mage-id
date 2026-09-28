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
