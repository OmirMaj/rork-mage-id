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
//   3. quotation       double quotes (straight or curly), a left single
//                      curly quote, or a span in paired straight single
//                      quotes ('like this'). A card paraphrases; it never
//                      quotes. Apostrophes (can't, doesn’t) and a foot mark
//                      (2'-8) are fine.
//                      AN INCH MARK IS NOT A QUOTE: a straight " (or a double
//                      prime) that sits directly after a MEASUREMENT (a
//                      number or a fraction character, with no space) is
//                      ignored by this test when what follows it is
//                        - the end, a space or punctuation (anything that is
//                          not a letter or a digit),
//                        - an x between two sizes (2"x4"), or
//                        - one of INCH_ABBREVIATIONS, glued on and ending
//                          there: o.c., oc, dia, min, max, typ, clr, thk,
//                          wide, high, deep, long, tall (any case),
//                      so 36", 2'-8", 7-7/8" and 12"o.c. pass. A mark glued
//                      to a word a drawing does not abbreviate that way
//                      (36"guards) is still a quote, and so is one glued to
//                      a SECTION NUMBER: a number with a letter glued in
//                      front of it (R312.1") or with two dots (1011.5.2") is
//                      not a measurement. An opening quote never follows a
//                      digit, so "Guards…", reads "X" and R312.1 "Guards all
//                      still fail.
//   4. code phrasing   the words that mark COPIED code text: "shall",
//                      "Exception:", "herein", "thereof", "notwithstanding",
//                      "the provisions of", and a cross-reference written the
//                      code's way ("in accordance with Section …", "where
//                      required by Table …", "comply with Section …"). Our
//                      own words never need them.
//                      A NUMBER IS NEVER A SIGNAL, and neither is an ordinary
//                      word next to one: "at least 36 in.", "36 in. minimum",
//                      "not less than 36 in.", "no more than 7 3/4 in.",
//                      "required", "in accordance with the manufacturer's
//                      instructions" all pass. A required dimension is a fact
//                      and the card exists to show it; a gate that hid the
//                      line for saying "not less than" hid the answer
//                      (2026-10-04, the founder: "the code doesn't tell you
//                      measurements any more"). Until then "not less than",
//                      "not more than" and every "in accordance with" /
//                      "where required by" were refused.
//
// A rejected summary is not shown. The caller drops the item (or the line)
// rather than trimming it, because a trimmed quote is still a quote.
//
// THE PHONE GATE IS THE SERVER GATE. On Code Check, Plan Review and the plan
// set sweep this file is the ONLY wording gate (analyze-plan-code has none on
// the server), so it may never be the looser of the two. CODE_PHRASES,
// QUOTE_RE, INCH_MARK_RE, the 25-word run and the way a line is normalized
// before it is measured are the server's, rule for rule
// (supabase/functions/construction-answer/codeCardRequirements.ts:
// CODE_PHRASING, QUOTED, INCH_MARK, MAX_WORD_RUN, oneLine).
// scripts/validate-code-card-server.ts reads BOTH files and fails when a
// phrase or a quote rule is on one side only, and runs both gates over the
// same lines.
//
// TWO MODES.
//   CARD MODE  (summaryEchoCheck / passesEchoCheck): one line of a card. All
//              four rules above.
//   PROSE MODE (ownWordsProse / ownWordsBlock): a paragraph the AI wrote (the
//              Code Check summary, the drill-in answer, Inspection Ready's
//              recall list). It is checked SENTENCE BY SENTENCE and has NO
//              length cap and NO word-run cap: an ordinary long sentence is
//              not code text, and hiding it for its length would hide the
//              answer. It uses only the code-text signals: quotation (rule
//              3), code phrasing (rule 4) and a section number followed by
//              a quoted title (R312.1 "Guards"). A sentence that fails is
//              taken out and the rest stays; the block says so ONCE, with the
//              PROSE notice (PROSE_WITHHELD: prose has no Official text
//              button, so its notice never names one) and the section numbers
//              the hidden sentences named, so he can still look them up.
//   LISTS      (ownWordsList / ownWordsQuestions): a list of short AI lines
//              (the Code Check permits, inspections, common violations and
//              follow-up questions). Each line is checked as prose and is
//              shown WHOLE or not at all: half a permit name is not a permit.
//              What was taken out is counted, with where the notice goes, so
//              the list says so once, not once per line.
//              A quotation that runs across several sentences hides every
//              sentence it touches; one that never closes hides the rest of
//              the block (nothing after an opening quote is shown unless the
//              quote was closed).

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

/**
 * Quotation: double quotes of any kind, guillemets, any left single curly
 * quote, or a span in paired straight single quotes. The server's QUOTED,
 * character for character (validate-code-card-server pins the two equal).
 */
const QUOTE_RE = /["\u201c\u201d\u201e\u00ab\u00bb\u2018]|(^|[\s(])'[^']+'(?=$|[\s.,;:!?)])/;
/**
 * An inch mark: see rule 3 in the header. Group 1 is the measurement it
 * follows, with the character before it, and is kept.
 *   - the measurement: digits, at most one decimal point, ending in a digit
 *     or a fraction character, and NOT glued to a letter or a dot before it
 *     (an x is fine: 12"x12"). So R312.1" and 1011.5.2" are not inch marks.
 *   - what follows: the end, anything that is not a letter or a digit, an x
 *     between two sizes, or one of the abbreviations below, ending there.
 * THE SERVER'S INCH_MARK, character for character and flag for flag
 * (validate-code-card-server pins the two equal, and reads the abbreviations
 * out of both).
 */
const INCH_MARK_RE = /((?:^|[^A-WYZa-wyz0-9.])(?:[0-9]*\.)?[0-9]*[0-9\u00bc-\u00be\u2150-\u215e])["\u2033](?=$|[^A-Za-z0-9]|x(?![a-z])|(?:o\.c\.|oc|dia|min|max|typ|clr|thk|wide|high|deep|long|tall)(?![a-z0-9]))/gi;
/**
 * The construction abbreviations a drawing glues to an inch mark (12"o.c.,
 * 36"min). The SAME list as the alternatives inside INCH_MARK_RE and inside
 * the server's INCH_MARK (validate-code-card-server pins all three equal).
 */
export const INCH_ABBREVIATIONS: readonly string[] = Object.freeze([
  'o.c.', 'oc', 'dia', 'min', 'max', 'typ', 'clr', 'thk', 'wide', 'high', 'deep', 'long', 'tall',
]);

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

/**
 * THE NOTICE ON A PROSE SURFACE (the Code Check summary, its lists and its
 * drill-in, Inspection Ready's recall list). A paragraph or a list has no
 * Official text button (that is on a code card), so this notice never names
 * one: it says what MAGE did, and withheldNotice adds the section numbers.
 */
export const PROSE_WITHHELD = 'MAGE hid wording here because it read like code text.';
/**
 * Added to the prose notice ONLY where the publisher's free viewer is rendered
 * right under it (withheldNotice's `viewer`). With no viewer link on screen
 * (the jurisdiction is not known) the notice names no button and no link.
 */
export const PROSE_VIEWER_LINE = "Read the code in the publisher's free viewer, below.";

/**
 * What every in-app prompt that asks the AI for code wording is told, so the
 * gate has less to withhold. ONE SOURCE: the Code Check prompt, its drill-in
 * and Inspection Ready's recall prompt all carry this sentence, straight
 * after the no-verbatim sentence.
 */
export const PLAIN_SENTENCE_RULE = `Write each requirement as one short plain sentence of under 25 words, with no quotation marks. Write inches as in. and feet as ft (36 in., 6 ft 8 in.), never with the " or ' marks.`;

/**
 * What every prompt that asks the AI for a code requirement is told, straight
 * after the plain-sentence rule: THE NUMBER IS THE ANSWER. The copyright rule
 * ("never quote the code") made the AI drop figures to be safe; a required
 * dimension, a count, a threshold and a section number are facts, and a
 * contractor needs them. Recall is LABELLED on screen (the AI-recall chip and
 * the confirm line), never left out. ONE SOURCE on the phone (the Code Check
 * prompt, its drill-in, Inspection Ready's recall prompt); the servers carry
 * the same sentence, word for word (ai relay for ai_code_check,
 * analyze-plan-code, construction-answer's cards call), pinned equal by
 * scripts/validate-code-copyright-prompts.ts.
 */
export const SPECIFICS_RULE = `Be specific: state the required number with its unit and the condition that triggers it, for example a guard at least 36 in. high where the drop is more than 30 in. Numbers, dimensions, counts, thresholds and section numbers are facts, not code text, so always state them. A figure from your own recall is still stated: the app marks it as AI recall to confirm with the building department. Never leave a number out or answer vaguely to avoid quoting.`;

/**
 * Phrasing that marks COPIED model-code text rather than a contractor's words.
 * THE SAME LIST AS THE SERVER'S CODE_PHRASING, one entry per alternative
 * (validate-code-card-server fails when a phrase is on one side only).
 * Nothing here may match a plain sentence for carrying a number or an ordinary
 * word such as minimum, maximum, at least, not less than, required (rule 4 in
 * the header; validate-code-cards runs 40 such sentences through both modes).
 */
const CODE_PHRASES: readonly RegExp[] = [
  /\bshall\b/i,
  /\bin accordance with (?:this (?:code|section|chapter)|sections?|tables?|chapters?)\b/i,
  /\bwhere required by (?:this (?:code|section|chapter)|sections?|tables?|chapters?)\b/i,
  /\bexceptions?\s*:/i,
  /\bherein(?:after)?\b/i,
  /\bthereof\b/i,
  /\bnotwithstanding\b/i,
  /\bcompl(?:y|ying|ies) with (?:section|table|chapter)\b/i,
  /\bthe provisions of\b/i,
];

/** One line: control characters out, whitespace collapsed, trimmed (the server's oneLine). */
function oneLine(text: unknown): string {
  return typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

/**
 * Word count of the longest run between sentence breaks (. ; : ! ?), on the
 * line as the gate measures it (one line, whitespace collapsed). The server's
 * count, token for token.
 */
export function longestRun(text: string): number {
  let max = 0;
  for (const part of oneLine(text).split(/[.;:!?]+/)) {
    const words = part.trim().split(/\s+/).filter(Boolean);
    if (words.length > max) max = words.length;
  }
  return max;
}

/**
 * Check one line of card wording (CARD MODE).
 *
 * `max` is the length cap for the field (SUMMARY_MAX by default; WHY_MAX for
 * `why`, BUILD_LINE_MAX for a what-to-build line).
 */
export function summaryEchoCheck(text: string, max: number = SUMMARY_MAX): EchoResult {
  const reasons: EchoReason[] = [];
  const t = oneLine(text);
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

// ── PROSE MODE ───────────────────────────────────────────────────────────────

export type ProseReason = 'quotation' | 'code_phrasing' | 'section_title';

/** A stretch of a block that reads like code text: [from, to). */
interface ProseSpan { from: number; to: number; reason: ProseReason }

/** What a block of AI prose may show. */
export interface ProseGate {
  /** The text as it may be shown: failing sentences out, the rest as written. */
  text: string;
  /** How many sentences were taken out. */
  withheld: number;
  /** Section numbers the withheld sentences named, in order, each once. */
  sections: string[];
  /** Why, across the withheld sentences (for tests and logs; never shown). */
  reasons: ProseReason[];
}

/**
 * A section number as a code prints it, inside running text: R312.1, E3902.16,
 * R602.3(1), 1011.5.2, 210.8(A). A bare decimal next to a unit (101.5 psf) is
 * a measurement, not a section, and R19 (an insulation value) is not one.
 * Group 1 is the character before it (kept out of the number), group 2 the number.
 */
const NOT_A_MEASURE = String.raw`(?!["'\u2032\u2033%\u00b0]|\s*(?:in\.|inch|ft\b|feet\b|foot\b|psf\b|psi\b|lbs?\b|deg|mm\b|cm\b|sq\b|%|\u00b0))`;
const SECTION_NUMBER = String.raw`(?:[A-Z]{1,3}\d{3,4}(?:\.\d+)*|[A-Z]{1,3}\d{1,2}(?:\.\d+)+|\d{3,4}(?:\.\d+)+${NOT_A_MEASURE})(?:\([A-Za-z0-9]{1,3}\))*(?![A-Za-z0-9]|\.\d)`;
const SECTION_RE = new RegExp(String.raw`(^|[^A-Za-z0-9.$])(${SECTION_NUMBER})`, 'g');
/**
 * The section-then-quoted-title shape: a section number, then an opening quote
 * of any kind (R312.1 "Guards", 1015.2: 'Where required'). A possessive
 * (R312.1's) is not one.
 */
const SECTION_TITLE_RE = new RegExp(
  String.raw`(^|[^A-Za-z0-9.$])${SECTION_NUMBER}(?:[\s,:;(\u2013\u2014-]{0,3}["\u201c\u201e\u00ab\u2018]|[\s,:;(\u2013\u2014-]{1,3}'(?=[A-Za-z]))`,
  'g',
);

/** Every section number `text` names, in order, each once. */
export function sectionsIn(text: string): string[] {
  const out: string[] = [];
  SECTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SECTION_RE.exec(text)) !== null) {
    if (!out.includes(m[2])) out.push(m[2]);
  }
  return out;
}

/** A character that stands in for an inch mark, so positions do not move. Never in gated text (control characters are taken out first). */
const INCH_PLACEHOLDER = '\u0001';
const QUOTE_OPENERS = '\u201c\u201e\u00ab';
const QUOTE_CLOSERS = '\u201d\u00bb';

/** Every stretch of `block` that reads like code text. `block` has no control characters but newlines. */
function proseSpans(block: string): ProseSpan[] {
  const t = block.replace(INCH_MARK_RE, `$1${INCH_PLACEHOLDER}`);
  const spans: ProseSpan[] = [];
  // Double quotes, paired across the whole block. An open quote that never
  // closes runs to the end.
  let open = -1;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '"') {
      if (open < 0) open = i;
      else { spans.push({ from: open, to: i + 1, reason: 'quotation' }); open = -1; }
    } else if (QUOTE_OPENERS.includes(ch)) {
      if (open < 0) open = i;
    } else if (QUOTE_CLOSERS.includes(ch)) {
      if (open >= 0) { spans.push({ from: open, to: i + 1, reason: 'quotation' }); open = -1; }
      else spans.push({ from: i, to: i + 1, reason: 'quotation' });
    }
  }
  if (open >= 0) spans.push({ from: open, to: t.length, reason: 'quotation' });
  // A left single curly quote, to the first right one that is not an
  // apostrophe inside a word; never closed = to the end.
  for (let i = t.indexOf('\u2018'); i >= 0; ) {
    let close = -1;
    for (let j = t.indexOf('\u2019', i + 1); j >= 0; j = t.indexOf('\u2019', j + 1)) {
      if (!/[A-Za-z]/.test(t[j + 1] ?? '')) { close = j; break; }
    }
    const to = close >= 0 ? close + 1 : t.length;
    spans.push({ from: i, to, reason: 'quotation' });
    i = t.indexOf('\u2018', to);
  }
  // Everything else the card gate calls a quotation (a span in paired straight
  // single quotes), wherever it sits.
  const quoted = new RegExp(QUOTE_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = quoted.exec(t)) !== null) {
    const lead = (m[1] ?? '').length;
    spans.push({ from: m.index + lead, to: m.index + m[0].length, reason: 'quotation' });
    if (m[0].length === 0) quoted.lastIndex += 1;
  }
  for (const phrase of CODE_PHRASES) {
    const re = new RegExp(phrase.source, 'gi');
    while ((m = re.exec(t)) !== null) {
      spans.push({ from: m.index, to: m.index + m[0].length, reason: 'code_phrasing' });
      if (m[0].length === 0) re.lastIndex += 1;
    }
  }
  SECTION_TITLE_RE.lastIndex = 0;
  while ((m = SECTION_TITLE_RE.exec(t)) !== null) {
    // From the number itself: the character before it belongs to the sentence before.
    spans.push({ from: m.index + (m[1] ?? '').length, to: m.index + m[0].length, reason: 'section_title' });
  }
  return spans;
}

/**
 * Where one sentence ends and the next begins: sentence punctuation (and any
 * closing mark after it), then space, then anything but a lower-case letter
 * ("36 in. high" stays whole); or a line break. Splitting too often is safe:
 * every piece is checked, and a quotation is tracked across pieces.
 */
const SENTENCE_BREAK = /[.!?]+["'\u201d\u2019)\]]*\s+(?![\sa-z])|\n\s*/g;

/** `block` cut into sentences; each keeps the space that follows it, so joined they are `block`. */
export function proseSentences(block: string): string[] {
  const out: string[] = [];
  let from = 0;
  SENTENCE_BREAK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_BREAK.exec(block)) !== null) {
    const end = m.index + m[0].length;
    if (end > from) { out.push(block.slice(from, end)); from = end; }
    if (m[0].length === 0) SENTENCE_BREAK.lastIndex += 1;
  }
  if (from < block.length) out.push(block.slice(from));
  return out;
}

/**
 * The notice a PROSE surface prints when the gate took something out:
 * PROSE_WITHHELD, then the section numbers that are known (so he can still
 * look them up), then, ONLY with `viewer: true`, the line that points at the
 * publisher's free viewer. A caller passes `viewer: true` only where it
 * renders a viewer link right under this notice; without it the notice names
 * no button and no link.
 */
export function withheldNotice(
  sections: readonly (string | null | undefined)[] = [],
  opts: { viewer?: boolean } = {},
): string {
  const list: string[] = [];
  for (const s of sections) {
    const t = oneLine(s);
    if (t && !list.includes(t)) list.push(t);
  }
  const said = list.length === 0
    ? PROSE_WITHHELD
    : `${PROSE_WITHHELD} ${list.length === 1 ? 'Section' : 'Sections'}: ${list.join(', ')}.`;
  return opts.viewer === true ? `${said} ${PROSE_VIEWER_LINE}` : said;
}

/**
 * A block of AI prose as it may be shown (PROSE MODE, see the header): checked
 * sentence by sentence, with no length cap. A sentence that reads like code
 * text is taken out and the rest stays as written.
 *
 * `notice` (default true): the FIRST withheld sentence is replaced, in place,
 * by the prose notice and the section numbers the withheld sentences named
 * (withheldNotice with no viewer line: this text is saved and printed in
 * places that render no viewer link); later ones are simply taken out, so the
 * block says it once. Pass false when several fields print together as one
 * block and the screen shows the notice once for all of them (ownWordsBlock).
 *
 * Gating the result again changes nothing, and never adds a second notice.
 *
 * A PARAGRAPH SAVED BEFORE THE PROSE NOTICE carries the card's line
 * (LINE_WITHHELD, "Use Official text…") where a sentence was withheld. A
 * paragraph has no such button, so that line is read as the prose notice
 * wherever the paragraph prints.
 */
export function ownWordsProse(text: unknown, opts: { notice?: boolean } = {}): ProseGate {
  const block = typeof text === 'string'
    ? text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim().split(LINE_WITHHELD).join(PROSE_WITHHELD)
    : '';
  if (!block) return { text: '', withheld: 0, sections: [], reasons: [] };
  const spans = proseSpans(block);
  const parts: (string | null)[] = [];
  const sections: string[] = [];
  const reasons: ProseReason[] = [];
  let withheld = 0;
  let at = 0;
  for (const sentence of proseSentences(block)) {
    const from = at;
    const to = at + sentence.length;
    at = to;
    const hits = spans.filter((s) => s.from < to && s.to > from);
    if (hits.length === 0) { parts.push(sentence); continue; }
    withheld += 1;
    for (const h of hits) if (!reasons.includes(h.reason)) reasons.push(h.reason);
    for (const s of sectionsIn(sentence)) if (!sections.includes(s)) sections.push(s);
    // The first one leaves a slot for the notice (null), with the space that followed it.
    if (withheld === 1) { parts.push(null); parts.push(/\s*$/.exec(sentence)?.[0] ?? ''); }
  }
  // Nothing withheld: the block exactly as written.
  if (withheld === 0) return { text: block, withheld: 0, sections: [], reasons: [] };
  const alreadySaid = parts.filter((p) => p !== null).join('').includes(PROSE_WITHHELD);
  const notice = opts.notice === false || alreadySaid ? '' : withheldNotice(sections);
  const shown = parts.map((p) => (p === null ? notice : p)).join('')
    .replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text: shown, withheld, sections, reasons };
}

/** Shorthand: does this prose pass whole (something there, and nothing withheld)? */
export function passesProseCheck(text: unknown): boolean {
  const g = ownWordsProse(text, { notice: false });
  return g.withheld === 0 && g.text.length > 0;
}

/** Several AI fields that print together as ONE block, gated. */
export interface ProseBlock<T> {
  /** The same fields: every string gated as prose, every list keeping only the lines that still say something. */
  value: T;
  /** How many sentences were taken out across the block. 0 = nothing was hidden. */
  withheld: number;
  /** Section numbers the withheld sentences named. */
  sections: string[];
}

/**
 * Gate EVERY string and EVERY list of strings in `fields` as prose (no notice
 * inside the text: the screen prints withheldNotice once for the block when
 * `withheld` is above 0). A field that is not text is passed through as it is.
 * Generic on purpose: a field added to the AI's answer later is gated too.
 */
export function ownWordsBlock<T extends Record<string, unknown>>(fields: T): ProseBlock<T> {
  const sections: string[] = [];
  let withheld = 0;
  const one = (v: string): string => {
    const g = ownWordsProse(v, { notice: false });
    withheld += g.withheld;
    for (const s of g.sections) if (!sections.includes(s)) sections.push(s);
    return g.text;
  };
  const value: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) {
    const v = fields[key];
    if (typeof v === 'string') value[key] = one(v);
    else if (Array.isArray(v)) value[key] = v.map((x) => (typeof x === 'string' ? one(x) : x)).filter((x) => x !== '');
    else value[key] = v;
  }
  return { value: value as T, withheld, sections };
}

// ── LISTS ────────────────────────────────────────────────────────────────────

/** A list of short AI lines as it may be shown (see LISTS in the header). */
export interface ProseList<T = string> {
  /** The lines that passed WHOLE, in order, as the gate returned them. */
  items: T[];
  /** How many lines were taken out. 0 = nothing was hidden. */
  withheld: number;
  /** Section numbers the withheld lines named, in order, each once. */
  sections: string[];
  /**
   * Where the notice prints, once: before `items[noticeAt]` (the place of the
   * first line taken out; `items.length` = after the last line). -1 when
   * nothing was withheld.
   */
  noticeAt: number;
}

/**
 * A list of AI lines, gated line by line as prose. A line the gate would take
 * anything out of is not shown at all (it is counted, and the notice goes
 * where the first such line was). Anything that is not text, and an empty
 * line, is left out without a notice: there was nothing to hide.
 */
export function ownWordsList(lines: unknown): ProseList<string> {
  const out: ProseList<string> = { items: [], withheld: 0, sections: [], noticeAt: -1 };
  if (!Array.isArray(lines)) return out;
  for (const line of lines) {
    const g = ownWordsProse(line, { notice: false });
    if (g.withheld > 0) {
      out.withheld += 1;
      for (const s of g.sections) if (!out.sections.includes(s)) out.sections.push(s);
      if (out.noticeAt < 0) out.noticeAt = out.items.length;
    } else if (g.text) {
      out.items.push(g.text);
    }
  }
  return out;
}

/**
 * A list of AI questions with tap options (the Code Check follow-ups). A
 * question is asked WHOLE or not at all: when the gate would take anything out
 * of the question or of any option, the whole question is left out and
 * counted. A kept question is the same object with its question and options as
 * the gate returned them.
 */
export function ownWordsQuestions<T extends { question?: unknown; options?: unknown }>(
  list: readonly T[] | null | undefined,
): ProseList<T> {
  const out: ProseList<T> = { items: [], withheld: 0, sections: [], noticeAt: -1 };
  if (!Array.isArray(list)) return out;
  for (const item of list as readonly T[]) {
    if (!item || typeof item !== 'object') continue;
    const question = ownWordsProse(item.question, { notice: false });
    const options = (Array.isArray(item.options) ? item.options : []).map((o) => ownWordsProse(o, { notice: false }));
    if (question.withheld > 0 || options.some((o) => o.withheld > 0)) {
      out.withheld += 1;
      for (const s of [...question.sections, ...options.flatMap((o) => o.sections)]) if (!out.sections.includes(s)) out.sections.push(s);
      if (out.noticeAt < 0) out.noticeAt = out.items.length;
      continue;
    }
    if (!question.text) continue;
    out.items.push({ ...item, question: question.text, options: options.map((o) => o.text).filter(Boolean) });
  }
  return out;
}
