// utils/codeCard/echoCheck.ts — the gate every card's wording passes before it
// is shown: MAGE's own plain English, never a model code's sentences.
//
// Pure: no React, no RN. scripts/validate-code-cards.ts drives it under bun.
//
// WHAT IT CAN AND CANNOT PROVE. MAGE holds no model-code text (see the header
// of utils/codeAmendments.ts for why), so it cannot diff a summary against the
// code. What it CAN do is refuse the SHAPES that copied code text takes:
//
//   1. too long        a card line has a cap (140 / 160 / 100 chars); a pasted
//                      section never fits in one.
//   2. a long run      more than 25 words without a sentence break. Code
//                      sentences run long; a card line never needs to.
//   3. quotation       double quotes (straight or curly) or a left single
//                      curly quote. A card paraphrases; it never quotes.
//                      Apostrophes (can't, doesn’t) are fine.
//                      AN INCH MARK IS NOT A QUOTE: a straight " (or a double
//                      prime) that sits directly after a digit or a fraction
//                      character, with no space, and is not followed by a
//                      letter (an x between two sizes is fine: 2"x4") is
//                      ignored by this test, so 36", 2'-8" and 7-7/8" pass.
//                      Every other mark is still a quote: an opening quote
//                      never follows a digit, so "Guards…", reads "X" and
//                      R312.1 "Guards all still fail.
//   4. code phrasing   "shall", "in accordance with", "comply with Section",
//                      "Exception:", "herein", "thereof", "notwithstanding",
//                      "hereinafter". Our own words never need them.
//
// A rejected summary is not shown. The caller drops the item (or the line)
// rather than trimming it, because a trimmed quote is still a quote.

export type EchoReason = 'empty' | 'too_long' | 'long_run' | 'quotation' | 'code_phrasing';

export interface EchoResult {
  ok: boolean;
  reasons: EchoReason[];
}

export const SUMMARY_MAX = 140;
export const WHY_MAX = 160;
export const BUILD_LINE_MAX = 100;
/** The longest run of words allowed between sentence breaks. */
export const MAX_RUN_WORDS = 25;

const QUOTE_RE = /["“”„«»‘]/;
/** An inch mark: see rule 3 in the header. The digit (or fraction character) it follows is kept. */
const INCH_MARK_RE = /([0-9\u00bc-\u00be\u2150-\u215e])["\u2033](?![A-WYZa-wyz]|[xX][A-Za-z])/g;

/** The text with its inch marks taken out (36" → 36), for the quotation test only. */
export function withoutInchMarks(text: string): string {
  return text.replace(INCH_MARK_RE, '$1');
}

/**
 * MAGE's two stand-in lines for a card that has no requirement in words: the
 * AI's line was withheld by this gate, or the AI gave none. A stand-in is not a
 * requirement: it is never texted, emailed, saved, pinned or filed as one.
 * (The wiring's own copies, CARD_WITHHELD and CARD_NO_TEXT in
 * components/construction/AskConstructionMode.tsx, are pinned equal to these
 * by scripts/validate-code-card-wiring.ts.)
 */
export const LINE_WITHHELD = 'MAGE hid this line because it read like code text. Use Official text to read the section.';
export const LINE_NO_TEXT = 'The AI gave no plain-English line for this one. Use Official text to read the section.';
/** True when `line` is one of MAGE's stand-ins, not a requirement in words. */
export function isStandInLine(line: string | null | undefined): boolean {
  return line === LINE_WITHHELD || line === LINE_NO_TEXT;
}

const CODE_PHRASES: readonly RegExp[] = [
  /\bshall\b/i,
  /\bin accordance with\b/i,
  /\bcompl(?:y|ying|ies) with (?:section|table|chapter)\b/i,
  /\bexceptions?\s*:/i,
  /\bherein(?:after)?\b/i,
  /\bthereof\b/i,
  /\bnotwithstanding\b/i,
];

/** Word count of the longest run between sentence breaks (. ; : ! ? and newlines). */
export function longestRun(text: string): number {
  let max = 0;
  for (const part of text.split(/[.;:!?\n]+/)) {
    const words = part.trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
    if (words.length > max) max = words.length;
  }
  return max;
}

/**
 * Check one line of card wording.
 *
 * `max` is the length cap for the field (SUMMARY_MAX by default; WHY_MAX for
 * `why`, BUILD_LINE_MAX for a what-to-build line).
 */
export function summaryEchoCheck(text: string, max: number = SUMMARY_MAX): EchoResult {
  const reasons: EchoReason[] = [];
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return { ok: false, reasons: ['empty'] };
  if (t.length > max) reasons.push('too_long');
  if (longestRun(t) > MAX_RUN_WORDS) reasons.push('long_run');
  if (QUOTE_RE.test(withoutInchMarks(t))) reasons.push('quotation');
  if (CODE_PHRASES.some((re) => re.test(t))) reasons.push('code_phrasing');
  return { ok: reasons.length === 0, reasons };
}

/** Shorthand: does this line pass? */
export function passesEchoCheck(text: string, max: number = SUMMARY_MAX): boolean {
  return summaryEchoCheck(text, max).ok;
}
