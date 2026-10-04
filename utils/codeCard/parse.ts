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
//   * evidence is only kept when it is a real CitationEvidence shape; the
//     client attaches its own with attachEvidence().

import { citationEvidenceFor, RUNG_INDEX, type CitationEvidence, type CitationRung } from '../codeAmendments';
import type { ResolvedCodeJurisdiction } from '../codeJurisdiction';
import { BUILD_LINE_MAX, passesEchoCheck, SUMMARY_MAX, WHY_MAX } from './echoCheck';
import type { CodeCardItem, CodeCardStatus, CodeJobValue, CodeTrigger, CodeVerdict } from './types';
import { isCodeStage } from './verdict';

export const MAX_ITEMS = 40;
export const MAX_BUILD_LINES = 6;
const QUESTION_MAX = 200;

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

export function parseJobValue(v: unknown): CodeJobValue | undefined {
  const r = rec(v);
  if (!r) return undefined;
  const value = num(r.value);
  const unit = oneOf(r.unit, UNITS);
  const source = oneOf(r.source, SOURCES);
  const sourceLabel = str(r.sourceLabel, 60);
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

/** One item, or null when it cannot be shown. `fallbackId` is used when the input has none. */
export function parseCodeCardItem(raw: unknown, fallbackId?: string): CodeCardItem | null {
  const r = rec(raw);
  if (!r) return null;
  const verdict = oneOf(r.verdict, VERDICTS);
  const summary = str(r.summary, SUMMARY_MAX);
  const section = str(r.section, 32);
  if (!verdict || !summary || !section) return null;
  if (!passesEchoCheck(summary, SUMMARY_MAX)) return null;
  const id = str(r.id, 80) ?? fallbackId;
  if (!id) return null;

  const item: CodeCardItem = {
    id,
    verdict,
    summary,
    section,
    evidence: parseEvidence(r.evidence),
    stageIsGuess: true,
  };

  const why = str(r.why, WHY_MAX);
  if (why && passesEchoCheck(why, WHY_MAX)) item.why = why;
  const edition = str(r.citedEdition, 60);
  if (edition) item.citedEdition = edition;
  if (isCodeStage(r.stage)) {
    item.stage = r.stage;
    item.stageIsGuess = r.stageIsGuess !== false;
  }
  const status = oneOf(r.status, STATUSES);
  if (status) item.status = status;
  const observed = str(r.observed, 60);
  if (observed && passesEchoCheck(observed, 60)) item.observed = observed;
  const location = str(r.location, 60);
  if (location) item.location = location;
  const question = str(r.question, QUESTION_MAX);
  if (question && passesEchoCheck(question, QUESTION_MAX)) item.question = question;
  const jobValue = parseJobValue(r.jobValue);
  if (jobValue) item.jobValue = jobValue;
  const trigger = parseTrigger(r.trigger);
  if (trigger) item.trigger = trigger;
  const calc = rec(r.calc);
  if (calc) {
    const expression = str(calc.expression, 80);
    const value = typeof calc.value === 'number' && Number.isFinite(calc.value) ? String(calc.value) : str(calc.value, 40);
    const note = str(calc.note, 100);
    if (expression && value) item.calc = note ? { expression, value, note } : { expression, value };
  }
  const trade = str(r.trade, 40);
  if (trade) item.trade = trade;
  if (Array.isArray(r.whatToBuild)) {
    const lines = r.whatToBuild
      .map((l) => str(l, BUILD_LINE_MAX))
      .filter((l): l is string => !!l && passesEchoCheck(l, BUILD_LINE_MAX))
      .slice(0, MAX_BUILD_LINES);
    if (lines.length) item.whatToBuild = lines;
  }
  return item;
}

/** A whole `requirements[]`: unshowable items dropped, ids made unique, capped. */
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
