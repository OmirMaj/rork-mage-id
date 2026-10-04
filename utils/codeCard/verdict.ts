// utils/codeCard/verdict.ts — the re-check behind the threshold tape and the
// − / + re-measure on an opened code card.
//
// Pure: no React, no RN, no storage. scripts/validate-code-cards.ts drives it
// under bun.
//
// THE ONE RULE THIS FILE HOLDS. The tape and the re-check only ever run on two
// STRUCTURED numbers: the job's (`jobValue`, which came from a sheet, a site
// measurement or the job record) and the trigger (`trigger`). Nothing here
// parses a number out of prose, and a pair in different units is refused
// rather than converted — a converted number is a number nobody on the job
// wrote down.
//
// "CLOSE TO THE LINE" is within 2 in. of the trigger, inclusive, for lengths
// only (in, and ft as 2/12 ft). For psf, degrees and counts there is no agreed
// "equivalent" of two inches, so those are never called close: amber is kept
// for real warnings, not for a band invented here.

import type { CodeCardItem, CodeJobValue, CodeStage, CodeTrigger, CodeVerdict } from './types';

export type CodeUnit = CodeTrigger['unit'];

export interface RecheckResult {
  /** True when `jobValue <comparison> trigger.value` holds. */
  met: boolean;
  /** True when the two numbers are within 2 in. of each other (lengths only). */
  closeToLine: boolean;
}

/** The close-to-the-line band per unit, or null where no band applies. */
export const CLOSE_BAND: Readonly<Record<CodeUnit, number | null>> = Object.freeze({
  in: 2,
  ft: 2 / 12,
  psf: null,
  deg: null,
  count: null,
});

/** Floating-point slack, so 2/12 ft compares equal to 2 in. */
const EPS = 1e-9;

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Does `a <comparison> b` hold? Exact on the boundary (34 >= 34 is true). */
export function compare(a: number, comparison: CodeTrigger['comparison'], b: number): boolean {
  switch (comparison) {
    case '>': return a > b + EPS;
    case '>=': return a >= b - EPS;
    case '<': return a < b - EPS;
    case '<=': return a <= b + EPS;
    default: return false;
  }
}

/**
 * Re-check one job number against one trigger.
 *
 * Callers must check `canRecheck` first; given a unit mismatch this returns
 * { met: false, closeToLine: false } rather than guessing.
 */
export function recheck(jobValue: CodeJobValue, trigger: CodeTrigger): RecheckResult {
  if (!jobValue || !trigger || jobValue.unit !== trigger.unit || !finite(jobValue.value) || !finite(trigger.value)) {
    return { met: false, closeToLine: false };
  }
  const met = compare(jobValue.value, trigger.comparison, trigger.value);
  const band = CLOSE_BAND[trigger.unit];
  const closeToLine = band !== null && Math.abs(jobValue.value - trigger.value) <= band + EPS;
  return { met, closeToLine };
}

/**
 * True only when the item carries BOTH structured numbers, in the same unit,
 * and both are finite. The tape and the stepper render only when this is true.
 */
export function canRecheck(item: Pick<CodeCardItem, 'jobValue' | 'trigger'>): boolean {
  const j = item.jobValue;
  const t = item.trigger;
  if (!j || !t) return false;
  if (!finite(j.value) || !finite(t.value)) return false;
  if (j.unit !== t.unit) return false;
  if (!['sheet', 'measured', 'job'].includes(j.source)) return false;
  return ['>', '>=', '<', '<='].includes(t.comparison);
}

/** The comparison that holds when `comparison` does not. */
export function negate(comparison: CodeTrigger['comparison']): CodeTrigger['comparison'] {
  switch (comparison) {
    case '>': return '<=';
    case '>=': return '<';
    case '<': return '>=';
    case '<=': return '>';
    default: return comparison;
  }
}

/** The symbol a reader sees. */
export function comparisonSymbol(comparison: CodeTrigger['comparison']): string {
  switch (comparison) {
    case '>=': return '≥';
    case '<=': return '≤';
    default: return comparison;
  }
}

/**
 * The verdict the card shows once a re-check has run.
 *
 * For a trigger item (`required` / `not_required`) the trigger says when the
 * requirement APPLIES, so the re-check decides between the two. A `limit`
 * stays a limit; whether the job sits inside it is the outcome line's job.
 * With no re-check possible the AI's verdict stands untouched.
 */
export function effectiveVerdict(item: Pick<CodeCardItem, 'verdict' | 'jobValue' | 'trigger'>, jobValue?: CodeJobValue): CodeVerdict {
  const j = jobValue ?? item.jobValue;
  if (!j || !item.trigger || !canRecheck({ jobValue: j, trigger: item.trigger })) return item.verdict;
  if (item.verdict === 'limit') return 'limit';
  return recheck(j, item.trigger).met ? 'required' : 'not_required';
}

export type RecheckOutcome = 'required' | 'not_required' | 'within_limit' | 'over_limit';

export function recheckOutcome(item: Pick<CodeCardItem, 'verdict' | 'trigger'>, jobValue: CodeJobValue): RecheckOutcome | null {
  if (!item.trigger || !canRecheck({ jobValue, trigger: item.trigger })) return null;
  const { met } = recheck(jobValue, item.trigger);
  if (item.verdict === 'limit') return met ? 'within_limit' : 'over_limit';
  return met ? 'required' : 'not_required';
}

export const OUTCOME_WORDS: Readonly<Record<RecheckOutcome, string>> = Object.freeze({
  required: 'required',
  not_required: 'not required',
  within_limit: 'within the limit',
  over_limit: 'over the limit',
});

/** "34 in. > 30 in." plus the outcome words, or null when no re-check runs. */
export function recheckEquation(
  item: Pick<CodeCardItem, 'verdict' | 'trigger'>,
  jobValue: CodeJobValue,
): { left: string; op: string; right: string; outcome: RecheckOutcome; words: string } | null {
  const outcome = recheckOutcome(item, jobValue);
  if (!outcome || !item.trigger) return null;
  const { met } = recheck(jobValue, item.trigger);
  const cmp = met ? item.trigger.comparison : negate(item.trigger.comparison);
  return {
    left: formatJobNumber(jobValue.value, jobValue.unit),
    op: comparisonSymbol(cmp),
    right: formatJobNumber(item.trigger.value, item.trigger.unit),
    outcome,
    words: OUTCOME_WORDS[outcome],
  };
}

/** How far one tap of − / + moves the job number. */
export function stepFor(unit: CodeUnit): number {
  switch (unit) {
    case 'in': return 1;
    case 'ft': return 0.5;
    case 'psf': return 5;
    case 'deg': return 1;
    case 'count': return 1;
    default: return 1;
  }
}

/** The job value after `taps` taps (negative = −). Never below zero; marked as measured. */
export function stepJobValue(jobValue: CodeJobValue, taps: number): CodeJobValue {
  const step = stepFor(jobValue.unit);
  const next = Math.max(0, Math.round((jobValue.value + taps * step) * 1000) / 1000);
  if (taps === 0) return jobValue;
  return { value: next, unit: jobValue.unit, source: 'measured', sourceLabel: 'measured on site' };
}

const UNIT_LABEL: Readonly<Record<CodeUnit, string>> = Object.freeze({
  in: 'in.',
  ft: 'ft',
  psf: 'psf',
  deg: '°',
  count: '',
});

export function unitLabel(unit: CodeUnit): string {
  return UNIT_LABEL[unit] ?? '';
}

const FRACTIONS: readonly [number, string][] = [
  [0.25, '¼'],
  [0.5, '½'],
  [0.75, '¾'],
];

/** The number alone, with ¼ ½ ¾ for inches: 4.5 → "4½", 12 → "12". */
export function formatNumberPart(value: number, unit: CodeUnit): string {
  if (!finite(value)) return '';
  const whole = Math.floor(value + EPS);
  const frac = value - whole;
  if (unit === 'in') {
    if (Math.abs(frac) < 0.001) return String(whole);
    const hit = FRACTIONS.find(([f]) => Math.abs(frac - f) < 0.001);
    if (hit) return `${whole === 0 ? '' : whole}${hit[1]}` || hit[1];
  }
  if (unit === 'count') return String(Math.round(value));
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

/** "34 in.", "4½ in.", "12 ft", "40 psf", "30°", "5". */
export function formatJobNumber(value: number, unit: CodeUnit): string {
  const n = formatNumberPart(value, unit);
  const u = unitLabel(unit);
  if (!u) return n;
  if (unit === 'deg') return `${n}${u}`;
  return `${n} ${u}`;
}

// ── Inspection stages ────────────────────────────────────────────────────

export const CODE_STAGES: readonly CodeStage[] = ['footing', 'foundation', 'framing', 'rough', 'insulation', 'final', 'other'];

const STAGE_LABEL: Readonly<Record<CodeStage, string>> = Object.freeze({
  footing: 'Footing',
  foundation: 'Foundation',
  framing: 'Framing',
  rough: 'Rough-in',
  insulation: 'Insulation',
  final: 'Final',
  other: 'Other',
});

/** "Final", "Rough-in". */
export function stageLabel(stage: CodeStage | undefined | null): string {
  return stage ? STAGE_LABEL[stage] ?? 'Other' : 'Other';
}

/** "Final inspection"; "Inspection not set" when the item has no stage. */
export function stageInspectionLabel(stage: CodeStage | undefined | null): string {
  if (!stage) return 'Inspection not set';
  if (stage === 'other') return 'Other inspection';
  return `${STAGE_LABEL[stage]} inspection`;
}

export function isCodeStage(v: unknown): v is CodeStage {
  return typeof v === 'string' && (CODE_STAGES as readonly string[]).includes(v);
}
