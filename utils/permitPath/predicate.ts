// utils/permitPath/predicate.ts — evaluates the pack predicates. PURE and TOTAL:
// any shape it does not recognise, and any question with no answer, is false
// for `is` (never a throw, never a guess).
//
// DERIVED IDS. Predicates only test equality, and two pack rules need more than
// that: "built before April 1, 1987" from a typed year, and "the building
// record shows open violations". The engine answers these itself, under the
// reserved `derived.` prefix, from the GC's own answers (or the record's count).
// They are never stored and never asked. Pack validators should accept
// DERIVED_QUESTION_IDS as existing ids.

import type { Family, InterviewAnswers, Predicate } from '@/utils/permitPath/types';

export const YEAR_QUESTION_ID = 'base.building_year';
export const APRIL_1987_QUESTION_ID = 'nyc.built_before_apr_1987';
/** NYC: buildings constructed after April 1, 1987 are exempt from DEP asbestos
 *  certification (PLAN V7). Mirrors ACP5_LAST_YEAR (utils/buildingScopeTriggers.ts). */
export const ACP5_YEAR = 1987;

/**
 * derived.year_band      'before_1987' | 'in_1987' | 'after_1987' (absent until a year is answered)
 * derived.pre_apr_1987   'yes' | 'no' | 'unsure' — the year decides outside 1987; in 1987 (or with
 *                        no year) it is the GC's answer to nyc.built_before_apr_1987, else absent
 * derived.open_violations 'yes' | 'no' (absent when the record was not read)
 */
export const DERIVED_QUESTION_IDS: readonly string[] = ['derived.year_band', 'derived.pre_apr_1987', 'derived.open_violations'];

export interface PredicateSignals { openViolations?: number | null }
export interface PredicateCtx {
  answers: InterviewAnswers;
  family: Family;
  countyFips: string | null;
  signals?: PredicateSignals;
}

function yearOf(answers: InterviewAnswers): number | null {
  const a = answers[YEAR_QUESTION_ID];
  if (!a) return null;
  const v = typeof a.value === 'number' ? a.value : typeof a.value === 'string' && a.value.trim() !== '' ? Number(a.value.trim()) : NaN;
  return Number.isInteger(v) ? v : null;
}

function simpleValue(answers: InterviewAnswers, id: string): string | null {
  const a = answers[id];
  if (!a || Array.isArray(a.value)) return null;
  return String(a.value);
}

/** The derived value, or null when it is not known. */
export function derivedValue(id: string, ctx: Pick<PredicateCtx, 'answers' | 'signals'>): string | null {
  if (id === 'derived.year_band') {
    const y = yearOf(ctx.answers);
    if (y === null) return null;
    return y < ACP5_YEAR ? 'before_1987' : y === ACP5_YEAR ? 'in_1987' : 'after_1987';
  }
  if (id === 'derived.pre_apr_1987') {
    const y = yearOf(ctx.answers);
    if (y !== null && y < ACP5_YEAR) return 'yes';
    if (y !== null && y > ACP5_YEAR) return 'no';
    const v = simpleValue(ctx.answers, APRIL_1987_QUESTION_ID);
    return v === 'yes' || v === 'no' || v === 'unsure' ? v : null;
  }
  if (id === 'derived.open_violations') {
    const n = ctx.signals?.openViolations;
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    return n > 0 ? 'yes' : 'no';
  }
  return null;
}

/** The answer values a predicate compares against: [] when unanswered. */
function valuesFor(id: string, ctx: PredicateCtx): string[] | null {
  if (id.startsWith('derived.')) {
    const d = derivedValue(id, ctx);
    return d === null ? null : [d];
  }
  const a = ctx.answers[id];
  if (!a) return null;
  if (Array.isArray(a.value)) return a.value.map(String);
  return [String(a.value)];
}

type O = Record<string, unknown>;
const isObj = (v: unknown): v is O => !!v && typeof v === 'object' && !Array.isArray(v);

export function evalPredicate(p: Predicate | null | undefined, ctx: PredicateCtx): boolean {
  if (!isObj(p)) return false;
  try {
    if ('all' in p) return Array.isArray(p.all) && p.all.every((c) => evalPredicate(c as Predicate, ctx));
    if ('any' in p) return Array.isArray(p.any) && p.any.some((c) => evalPredicate(c as Predicate, ctx));
    if ('not' in p) return isObj(p.not) ? !evalPredicate(p.not as Predicate, ctx) : false;
    if ('family' in p) return Array.isArray(p.family) && (p.family as readonly string[]).includes(ctx.family);
    if ('county' in p) return Array.isArray(p.county) && !!ctx.countyFips && (p.county as readonly string[]).includes(ctx.countyFips);
    if ('q' in p && typeof p.q === 'string') {
      const vals = valuesFor(p.q, ctx);
      if ('answered' in p && typeof p.answered === 'boolean') return (vals !== null) === p.answered;
      if ('is' in p) {
        if (vals === null) return false;
        const want = typeof p.is === 'string' ? [p.is] : Array.isArray(p.is) ? (p.is as readonly unknown[]).map(String) : null;
        if (!want) return false;
        return vals.some((v) => want.includes(v));
      }
    }
  } catch {
    return false;
  }
  return false;
}

/** Every question id a predicate reads, in walk order, deduped. */
export function predicateQuestionIds(p: Predicate | null | undefined): string[] {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (!isObj(x)) return;
    if ('all' in x && Array.isArray(x.all)) x.all.forEach(walk);
    else if ('any' in x && Array.isArray(x.any)) x.any.forEach(walk);
    else if ('not' in x) walk(x.not);
    else if ('q' in x && typeof x.q === 'string' && !out.includes(x.q)) out.push(x.q);
  };
  walk(p);
  return out;
}
