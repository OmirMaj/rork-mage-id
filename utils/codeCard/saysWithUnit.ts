// utils/codeCard/saysWithUnit.ts — "did he write this number, next to this
// unit?" The one test a surface runs before it lets the AI's account of THE
// JOB'S OWN NUMBER onto a card.
//
// Pure: no React, no RN. scripts/validate-code-cards.ts drives it under bun.
//
// WHY. A code card draws a tape and re-checks its verdict from two numbers:
// the trigger and the job's own number. The Ask server keeps a job number only
// when the contractor's question prints that figure right next to its unit
// (supabase/functions/construction-answer/codeCardRequirements.ts,
// saysWithUnit). Code Check has no server of its own: its prompt is built on
// the phone, so the same test has to run on the phone, against the words he
// typed for that run. This file is the client's copy of the server's scanner,
// rule for rule; scripts/validate-code-card-server.ts runs both over one
// corpus and fails if they ever answer differently.
//
// It only proves that a figure was written, never what it means, and it never
// converts: "12 ft wide" is not an inch value.

import type { CodeTrigger } from './types';

type Unit = CodeTrigger['unit'];

const VULGAR: Readonly<Record<string, number>> = Object.freeze({
  '½': 0.5, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
  '⅓': 1 / 3, '⅔': 2 / 3,
});
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** One figure as written: its full value and where it starts and ends in the text. */
interface NumberSpan { value: number; start: number; end: number }

/**
 * Every figure a text states: integers and decimals (1,000-style thousands
 * allowed), simple fractions (3/4), mixed numbers (4 1/2, 4-1/2) and vulgar
 * fractions alone or after a whole number (4½, ½). A minus sign is never
 * read, so a negative figure is never "written".
 */
function numberSpans(text: string): NumberSpan[] {
  const out: NumberSpan[] = [];
  const t = String(text ?? '');
  const vul = Object.keys(VULGAR).join('');
  const NUM = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?';
  const re = new RegExp(
    `(\\d+)[\\s-]+(\\d+)\\/(\\d+)` // 1-3: mixed number
      + `|(\\d+)\\/(\\d+)` // 4-5: simple fraction
      + `|(${NUM})?\\s*([${vul}])` // 6-7: vulgar fraction, optional whole
      + `|(${NUM})`, // 8: plain number
    'g',
  );
  const num = (s: string) => parseFloat(s.replace(/,/g, ''));
  const push = (value: number, start: number, end: number) => {
    if (Number.isFinite(value)) out.push({ value: round4(value), start, end });
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (m[1] !== undefined) {
      const w = num(m[1]), n = num(m[2]), d = num(m[3]);
      push(d !== 0 ? w + n / d : w, start, end);
    } else if (m[4] !== undefined) {
      const n = num(m[4]), d = num(m[5]);
      if (d !== 0) push(n / d, start, end);
    } else if (m[7] !== undefined) {
      const f = VULGAR[m[7]];
      push(m[6] !== undefined ? num(m[6]) + f : f, start, end);
    } else if (m[8] !== undefined) {
      push(num(m[8]), start, end);
    }
  }
  return out;
}

/** What may follow a figure, between it and its unit: spaces or a hyphen. */
const UNIT_AFTER: Readonly<Record<Exclude<Unit, 'count'>, RegExp>> = Object.freeze({
  // "in" alone only when it is not the preposition before a place name
  // ("31 in Oyster Bay"); "in.", "inch", "inches" and an inch mark always.
  in: /^[\s-]*(?:in\.|in\b(?!\s+[A-Z])|inch(?:es)?\b|["”″])/,
  ft: /^[\s-]*(?:ft\b|foot\b|feet\b|['’′])/i,
  psf: /^[\s-]*(?:psf\b|lbs?\.?\s*(?:\/|per)\s*(?:sq\.?\s*ft|square\s+f(?:oo|ee)t|ft2|ft²))/i,
  deg: /^[\s-]*(?:°|º|deg\b|degrees?\b)/i,
});

const UNITS: readonly Unit[] = ['in', 'ft', 'psf', 'deg', 'count'];

/**
 * Does `text` print `value` IMMEDIATELY followed by `unit` ("30 in.", "31
 * inches", "12 ft", "40 psf", "4½ in.")? A figure next to another unit ("12
 * ft wide" for an inch value) is not a match. A count is a figure followed by
 * none of the measuring units. Anything that is not a finite number with one
 * of the five units is false.
 */
export function saysNumberWithUnit(text: unknown, value: unknown, unit: unknown): boolean {
  if (typeof text !== 'string' || typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (typeof unit !== 'string' || !(UNITS as readonly string[]).includes(unit)) return false;
  const want = round4(value);
  return numberSpans(text).some((s) => {
    if (s.value !== want) return false;
    const after = text.slice(s.end, s.end + 40);
    if (unit === 'count') return !Object.values(UNIT_AFTER).some((re) => re.test(after));
    return UNIT_AFTER[unit as Exclude<Unit, 'count'>].test(after);
  });
}

// ── which side of a limit a line says ────────────────────────────────────────
//
// A LIMIT card ("Guard has to be at least 36 in. high.") is the one card whose
// re-check has no second witness: a Required or Not required card's numbers
// have to give its own verdict, but a limit only has the model's comparison
// sign, and a sign pointing the wrong way prints "within the limit" for a job
// that is outside it. So the card's OWN LINE is the witness: a limit's job
// number is kept only when the line itself says the side, right at the limit's
// figure, and the sign is the one those words mean (utils/codeCard/parse.ts
// numbersAgreeWithVerdict; the Ask server keeps the same rule in
// supabase/functions/construction-answer/codeCardRequirements.ts, and
// scripts/validate-code-card-server.ts runs both copies over one corpus).
//
// THE RULE, in full:
//   * the line prints the limit's figure next to its unit ("36 in.");
//   * a side word sits RIGHT AT that figure: before it ("at least", "minimum",
//     "minimum of" / "at most", "maximum", "maximum of", "no more than", "up
//     to") or straight after its unit ("or more", "minimum" / "or less",
//     "maximum");
//   * the whole line uses ONE kind of side word. A line with both kinds
//     ("at least 34 in. and at most 38 in.") gives no side.
// Every one of those words includes the figure itself, so a minimum is ">="
// and a maximum is "<=", never ">" or "<".

export type LimitSide = 'min' | 'max';

const MIN_ANYWHERE = /\b(?:at least|minimum|or more)\b/i;
const MAX_ANYWHERE = /\b(?:at most|maximum|or less|no more than|up to)\b/i;
const MIN_BEFORE = /\b(?:at least|minimum(?: of)?)\s*$/i;
const MAX_BEFORE = /\b(?:at most|maximum(?: of)?|no more than|up to)\s*$/i;
const MIN_AFTER = /^\s*(?:or more|minimum)\b/i;
const MAX_AFTER = /^\s*(?:or less|maximum)\b/i;

/** The sign a side's words mean: the figure itself is inside the limit. */
export const LIMIT_COMPARISON: Readonly<Record<LimitSide, CodeTrigger['comparison']>> = Object.freeze({ min: '>=', max: '<=' });

/**
 * Which side of `value unit` the line says the job has to stay on, or null
 * when the line does not say (see the rule above). Anything that is not a
 * finite number with one of the five units is null.
 */
export function limitSideInLine(line: unknown, value: unknown, unit: unknown): LimitSide | null {
  if (typeof line !== 'string' || typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (typeof unit !== 'string' || !(UNITS as readonly string[]).includes(unit)) return null;
  const min = MIN_ANYWHERE.test(line);
  const max = MAX_ANYWHERE.test(line);
  if (min === max) return null; // no side word, or both kinds
  const want = round4(value);
  const before = min ? MIN_BEFORE : MAX_BEFORE;
  const after = min ? MIN_AFTER : MAX_AFTER;
  const at = numberSpans(line).some((s) => {
    if (s.value !== want) return false;
    const rest = line.slice(s.end);
    let unitLength = 0;
    if (unit === 'count') {
      if (Object.values(UNIT_AFTER).some((re) => re.test(rest.slice(0, 40)))) return false;
    } else {
      const m = UNIT_AFTER[unit as Exclude<Unit, 'count'>].exec(rest.slice(0, 40));
      if (!m) return false;
      unitLength = m[0].length;
    }
    return before.test(line.slice(0, s.start)) || after.test(rest.slice(unitLength));
  });
  return at ? (min ? 'min' : 'max') : null;
}
