// utils/codeCard/parse.ts — turn the AI's `requirements[]` (or a stored pin)
// into CodeCardItems the components can trust.
//
// Pure: no React, no RN. scripts/validate-code-cards.ts drives it under bun.
//
// Every field is re-checked here, client side, even though the server checks
// too: an older or newer server, a cached response or a hand-edited store must
// never put an unchecked line on screen.
//   * summary fails summaryEchoCheck → the WHOLE item is dropped (a card with
//     no requirement line is not a card).
//   * why / a what-to-build line / a question fails → that field or line is
//     dropped, the card stays.
//   * jobValue / trigger that are not fully structured are dropped, which is
//     what keeps the tape and the re-check from ever drawing a guessed number.
//   * THE NUMBERS MUST AGREE WITH THE VERDICT (wire only). The card re-checks
//     its two numbers the moment it opens (effectiveVerdict), so a 'required'
//     or 'not_required' card whose own numbers give the OTHER answer would open
//     showing the opposite of the AI's verdict and of its own summary line.
//     Nobody can tell which of the three the AI got wrong, so the job number
//     is dropped and the trigger kept: the AI's verdict and words stand, with
//     no tape and no "Result:" line. A device store is not touched (it keeps
//     what a surface showed; the − / + re-measure flips the verdict by design).
//   * A LIMIT'S OWN LINE MUST SAY THE SIDE (wire only). A 'limit' has no
//     verdict to check its numbers against: all that says which way the job
//     has to stand is the AI's comparison sign, and a sign pointing the wrong
//     way would print "within the limit" for a 34 in. guard against a 36 in.
//     minimum. So a limit keeps its job number only when the line the card
//     shows says the side itself, right at the trigger's figure ("at least
//     36 in.", "at most 7.75 in."; ./saysWithUnit.ts limitSideInLine), and the
//     sign is the one those words mean (">=" for a minimum, "<=" for a
//     maximum). No such words, both kinds, or a sign that disagrees: the job
//     number is dropped and the trigger kept, exactly as above.
//   * EVIDENCE AND "NOT A GUESS" NEVER COME OFF THE WIRE. parseCodeCardItem
//     returns every item with `evidence: null` and `stageIsGuess: true`,
//     whatever the input said: the rung is MAGE's own lookup (attachEvidence,
//     from utils/codeAmendments.ts) and only the contractor can end the stage
//     guess. A server or a model that sends {rung:'named', …} would otherwise
//     outrank the client's lookup and take the recall label off the card.
//
// TWO READERS, ONE BUILDER.
//   parseCodeCardItem    the WIRE (the AI's requirements[]): the tight caps a
//                        card line has (140 / 160 / 100, section 32), a section
//                        is required, evidence and "not a guess" are dropped.
//   storedCodeCardItem   the DEVICE STORES (pins.ts, saved.ts), and only them.
//                        It is the ONE function those stores use both to accept
//                        a card and to read it back, so a store reads back
//                        exactly what it accepted (see the note on it below).
//                        It keeps the evidence and the stage edit this device
//                        stamped, allows an empty section (the card says "No
//                        section given") and lifts the text caps to
//                        STORED_TEXT_MAX, the longest line any card surface
//                        shows. Types, shapes and the own-words gate still
//                        apply: a hand-edited store never puts an unchecked
//                        line on screen.

import { citationEvidenceFor, RUNG_INDEX, type CitationEvidence, type CitationRung } from '../codeAmendments';
import type { ResolvedCodeJurisdiction } from '../codeJurisdiction';
import { BUILD_LINE_MAX, passesEchoCheck, SUMMARY_MAX, WHY_MAX } from './echoCheck';
import { LIMIT_COMPARISON, limitSideInLine } from './saysWithUnit';
import type { CodeCardItem, CodeCardStatus, CodeJobValue, CodeTrigger, CodeVerdict } from './types';
import { canRecheck, isCodeStage, recheck } from './verdict';

export const MAX_ITEMS = 40;
export const MAX_BUILD_LINES = 6;
const QUESTION_MAX = 200;
/**
 * The cap on every text field of a DEVICE-STORED card. It must be at least the
 * longest line any card surface shows (Code Check / plan check show a line up
 * to 400 characters: CARD_TEXT_MAX in components/construction/
 * AskConstructionMode.tsx; scripts/validate-code-cards.ts fails if that one
 * ever passes this one), or a pin of a card that is on screen would be refused.
 */
export const STORED_TEXT_MAX = 400;

/** The caps one reader applies. `stored` lifts them all to STORED_TEXT_MAX. */
interface Caps {
  summary: number; section: number; why: number; edition: number; observed: number; location: number;
  question: number; trade: number; build: number; calcExpr: number; calcValue: number; calcNote: number; sourceLabel: number;
}
const WIRE_CAPS: Caps = Object.freeze({
  summary: SUMMARY_MAX, section: 32, why: WHY_MAX, edition: 60, observed: 60, location: 60,
  question: QUESTION_MAX, trade: 40, build: BUILD_LINE_MAX, calcExpr: 80, calcValue: 40, calcNote: 100, sourceLabel: 60,
});
const M = STORED_TEXT_MAX;
const STORED_CAPS: Caps = Object.freeze({
  summary: M, section: M, why: M, edition: M, observed: M, location: M,
  question: M, trade: M, build: M, calcExpr: M, calcValue: M, calcNote: M, sourceLabel: M,
});

const VERDICTS: readonly CodeVerdict[] = ['required', 'limit', 'not_required'];
const STATUSES: readonly CodeCardStatus[] = ['fix', 'ask', 'ok'];
const UNITS: readonly CodeTrigger['unit'][] = ['in', 'ft', 'psf', 'deg', 'count'];
const COMPARISONS: readonly CodeTrigger['comparison'][] = ['>', '>=', '<', '<='];
const SOURCES: readonly CodeJobValue['source'][] = ['sheet', 'measured', 'job'];
const RUNGS: readonly CitationRung[] = ['amended', 'named', 'edition', 'unresolved'];

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null;
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().replace(/\s+/g, ' ');
  if (!t || t.length > max) return undefined;
  return t;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function oneOf<T extends string>(v: unknown, set: readonly T[]): T | undefined {
  return typeof v === 'string' && (set as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function parseTrigger(v: unknown): CodeTrigger | undefined {
  const r = rec(v);
  if (!r) return undefined;
  const value = num(r.value);
  const unit = oneOf(r.unit, UNITS);
  const comparison = oneOf(r.comparison, COMPARISONS);
  if (value === undefined || value < 0 || !unit || !comparison) return undefined;
  return { value, unit, comparison };
}

/** `labelMax` is the cap on `sourceLabel`: 60 off the wire, STORED_TEXT_MAX for a device store. */
export function parseJobValue(v: unknown, labelMax: number = WIRE_CAPS.sourceLabel): CodeJobValue | undefined {
  const r = rec(v);
  if (!r) return undefined;
  const value = num(r.value);
  const unit = oneOf(r.unit, UNITS);
  const source = oneOf(r.source, SOURCES);
  const sourceLabel = str(r.sourceLabel, labelMax);
  if (value === undefined || value < 0 || !unit || !source || !sourceLabel) return undefined;
  return { value, unit, source, sourceLabel };
}

/** Keep a CitationEvidence only when it has the real shape (rung + index agree). */
export function parseEvidence(v: unknown): CitationEvidence | null {
  const r = rec(v);
  if (!r) return null;
  const rung = oneOf(r.rung, RUNGS);
  if (!rung || r.rungIndex !== RUNG_INDEX[rung]) return null;
  if (typeof r.badge !== 'string' || typeof r.detail !== 'string') return null;
  const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : null);
  return {
    rung,
    rungIndex: RUNG_INDEX[rung],
    badge: r.badge,
    detail: r.detail,
    sourceUrl: s('sourceUrl'),
    sourceLabel: s('sourceLabel'),
    quote: s('quote'),
    quoteComplete: r.quoteComplete !== false,
    parentMatch: r.parentMatch === true,
    viewerUrl: s('viewerUrl'),
    viewerLabel: s('viewerLabel'),
  };
}

/**
 * May the card's two numbers be re-checked on screen? True when there is
 * nothing to disagree: no pair the re-check can run on.
 *   required / not_required  the numbers must give that verdict: the trigger
 *                            is met for 'required' and not met for the other.
 *   limit                    the card's own line (`summary`) must say the side
 *                            right at the trigger's figure, and the sign must
 *                            be the one those words mean (see the header). A
 *                            limit with no line, or a line that does not say,
 *                            is false.
 */
export function numbersAgreeWithVerdict(
  item: Pick<CodeCardItem, 'verdict' | 'jobValue' | 'trigger'> & { summary?: string },
): boolean {
  if (!item.jobValue || !item.trigger || !canRecheck(item)) return true;
  if (item.verdict === 'limit') {
    const side = limitSideInLine(item.summary ?? '', item.trigger.value, item.trigger.unit);
    return side !== null && item.trigger.comparison === LIMIT_COMPARISON[side];
  }
  return recheck(item.jobValue, item.trigger).met === (item.verdict === 'required');
}

/**
 * The one builder behind both readers. `stored` = a card a device store holds
 * (see the header): its caps, an empty section allowed, evidence and the stage
 * edit kept, and the id taken exactly as stored (never a fallback).
 * `shownLine` (wire only) is the line the surface will show in place of the
 * summary, when it gates its own line (Code Check); a limit's side is read
 * from the line the card SHOWS, never from a stand-in.
 */
function build(raw: unknown, fallbackId: string | undefined, stored: boolean, shownLine?: string): CodeCardItem | null {
  const caps = stored ? STORED_CAPS : WIRE_CAPS;
  const r = rec(raw);
  if (!r) return null;
  const verdict = oneOf(r.verdict, VERDICTS);
  const summary = str(r.summary, caps.summary);
  if (!verdict || !summary) return null;
  if (!passesEchoCheck(summary, caps.summary)) return null;
  // The wire needs a section. A device store keeps a card with none (the card
  // says "No section given"), but a section that is not text, or is over the
  // cap, is still refused.
  let section: string;
  if (stored && typeof r.section === 'string' && !r.section.trim()) section = '';
  else {
    const sec = str(r.section, caps.section);
    if (!sec) return null;
    section = sec;
  }
  // A store keys on the id: it is kept exactly as written, never normalised.
  const id = stored
    ? (typeof r.id === 'string' && r.id.length > 0 && r.id.length <= STORED_TEXT_MAX ? r.id : undefined)
    : str(r.id, 80) ?? fallbackId;
  if (!id) return null;

  const item: CodeCardItem = {
    id,
    verdict,
    summary,
    section,
    evidence: stored ? parseEvidence(r.evidence) : null,
    stageIsGuess: true,
  };

  const why = str(r.why, caps.why);
  if (why && passesEchoCheck(why, caps.why)) item.why = why;
  const edition = str(r.citedEdition, caps.edition);
  if (edition) item.citedEdition = edition;
  if (isCodeStage(r.stage)) {
    item.stage = r.stage;
    item.stageIsGuess = stored ? r.stageIsGuess !== false : true;
  }
  const status = oneOf(r.status, STATUSES);
  if (status) item.status = status;
  const observed = str(r.observed, caps.observed);
  if (observed && passesEchoCheck(observed, caps.observed)) item.observed = observed;
  const location = str(r.location, caps.location);
  if (location) item.location = location;
  const question = str(r.question, caps.question);
  if (question && passesEchoCheck(question, caps.question)) item.question = question;
  const jobValue = parseJobValue(r.jobValue, caps.sourceLabel);
  if (jobValue) item.jobValue = jobValue;
  const trigger = parseTrigger(r.trigger);
  if (trigger) item.trigger = trigger;
  // Wire only: numbers that disagree with the verdict, or a limit whose own
  // line does not say the side, never draw a tape.
  if (!stored && !numbersAgreeWithVerdict({ ...item, summary: shownLine ?? summary })) delete item.jobValue;
  const calc = rec(r.calc);
  if (calc) {
    const expression = str(calc.expression, caps.calcExpr);
    const value = typeof calc.value === 'number' && Number.isFinite(calc.value) ? String(calc.value) : str(calc.value, caps.calcValue);
    const note = str(calc.note, caps.calcNote);
    if (expression && value) item.calc = note ? { expression, value, note } : { expression, value };
  }
  const trade = str(r.trade, caps.trade);
  if (trade) item.trade = trade;
  if (Array.isArray(r.whatToBuild)) {
    const lines = r.whatToBuild
      .map((l) => str(l, caps.build))
      .filter((l): l is string => !!l && passesEchoCheck(l, caps.build))
      .slice(0, MAX_BUILD_LINES);
    if (lines.length) item.whatToBuild = lines;
  }
  return item;
}

/**
 * WIRE input: one item of the AI's `requirements[]`, or null when it cannot be
 * shown. `fallbackId` is used when the input has none. Evidence is always null
 * and the stage always a guess on the way out (see the header).
 *
 * `shownLine`: a surface that replaces the summary with a line it gates itself
 * (Code Check sends a stand-in summary and shows the model's requirement line)
 * passes THE LINE IT WILL SHOW, so a limit's side is read from the words on the
 * card. It is the caller's argument, never a field of `raw`: nothing off the
 * wire can supply it.
 */
export function parseCodeCardItem(raw: unknown, fallbackId?: string, shownLine?: string): CodeCardItem | null {
  return build(raw, fallbackId, false, typeof shownLine === 'string' ? shownLine : undefined);
}

/**
 * A card a DEVICE STORE holds, or null when the store cannot keep it.
 *
 * THE RULE THE STORES RELY ON: pins.ts and saved.ts call this ONE function
 * both when a card is handed to them (the reducers) and when they read their
 * JSON back (parsePinsState / parseSavedState). It is idempotent and its
 * output survives JSON unchanged, so what a store accepted is exactly what it
 * reads back after a restart. A card it returns null for is never accepted in
 * the first place (see codeCardStoreBlockedReason), so no pin can vanish later.
 */
export function storedCodeCardItem(raw: unknown): CodeCardItem | null {
  return build(raw, undefined, true);
}

export const STORE_BLOCKED_REASON =
  'MAGE can’t keep this card: its wording did not pass the own-words check, or a line is too long. Open the official text instead.';

/**
 * Why a card cannot be pinned or saved, in plain words; null when it can. A
 * surface that offers Checklist / Save for a card should show this as the
 * button's blocked reason instead of offering a tap that does nothing.
 */
export function codeCardStoreBlockedReason(item: unknown): string | null {
  return storedCodeCardItem(item) ? null : STORE_BLOCKED_REASON;
}

/**
 * A whole `requirements[]` off the WIRE: unshowable items dropped, ids made
 * unique, capped. Evidence null, stage a guess (see the header).
 */
export function parseCodeCardItems(raw: unknown): CodeCardItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CodeCardItem[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    if (out.length >= MAX_ITEMS) return;
    const item = parseCodeCardItem(r, `req-${i + 1}`);
    if (!item) return;
    let id = item.id;
    let n = 2;
    while (seen.has(id)) id = `${item.id}-${n++}`;
    seen.add(id);
    out.push(id === item.id ? item : { ...item, id });
  });
  return out;
}

/**
 * Attach the client's own evidence (utils/codeAmendments.ts) to every item
 * that has none, by section and the edition it cites. With no resolved
 * jurisdiction the item keeps `evidence: null` (model recall, unresolved).
 */
export function attachEvidence(
  items: readonly CodeCardItem[],
  resolved: ResolvedCodeJurisdiction | null | undefined,
  fallbackCitedCode?: string | null,
): CodeCardItem[] {
  if (!resolved) return items.slice();
  return items.map((i) => {
    if (i.evidence) return i;
    const cited = (i.citedEdition ?? fallbackCitedCode ?? '').trim();
    return { ...i, evidence: citationEvidenceFor(resolved, cited, i.section) };
  });
}
