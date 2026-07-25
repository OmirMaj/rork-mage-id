// utils/copilot/scheduleBuilder/paceGrounding.ts — pace-book grounding for the
// schedule generators. THE time-side moat, mirroring estimateGrounding.ts on
// the money side: every duration a generator proposes should be derived from
// what work ACTUALLY took this contractor (utils/pace/paceBook.ts — learned
// per-trade actuals, bias, confidence from their own finished tasks), not a
// generic industry guess. Competitors size durations from templates; we size
// them from your history.
//
// Pure function — no storage, no network, no RN imports — so the validator
// (scripts/validate-pace-grounding.ts) drives it and every generator (AI
// Schedule Builder, estimate-driven, AIAssistantPanel, legacy) shares ONE fact
// format with the honesty chips.
import type { Project, TradeKey } from '@/types';
import { buildPaceBook, type PaceBookEntry } from '@/utils/pace/paceBook';
import { tradeLabel, TRADE_KEYS } from '@/utils/scheduleColors';

export interface PaceFactsResult {
  /** Prompt-ready fact lines, e.g. "Framing actually takes you ~8 working days
   *  on your small jobs (<2,000 SF; 3 jobs, medium confidence) — you plan 14%
   *  optimistic." Empty when the book has nothing trustworthy. */
  facts: string[];
  /** Distinct trades among the EMITTED facts — powers the honest chip
   *  ("Paced from your history · N trades"). 0 = cold start. */
  tradeCount: number;
}

/** Cap the block so it grounds the model without flooding the prompt. */
const MAX_FACTS = 8;

/** Human-readable size bands (boundaries canonical per paceBook.bucketForSqft). */
const BAND_DESCRIPTORS: Record<string, string> = {
  small: 'small jobs (<2,000 SF',
  medium: 'medium jobs (2,000–3,499 SF',
  large: 'large jobs (3,500–5,999 SF',
  xlarge: 'extra-large jobs (6,000+ SF',
};

function formatDays(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function labelFor(trade: string): string {
  if ((TRADE_KEYS as readonly string[]).includes(trade)) return tradeLabel(trade as TradeKey);
  return trade ? trade.charAt(0).toUpperCase() + trade.slice(1) : trade;
}

function factFor(e: PaceBookEntry): string {
  const jobs = `${e.jobCount} job${e.jobCount === 1 ? '' : 's'}`;
  const where = e.sqftBucket === 'all'
    ? `across your jobs (${jobs}, ${e.confidence} confidence)`
    : `on your ${BAND_DESCRIPTORS[e.sqftBucket] ?? `${e.sqftBucket} jobs (`}; ${jobs}, ${e.confidence} confidence)`;
  // Bias clause only when it rounds to a real signal (≥5%): >0 = actuals run
  // longer than plans (optimistic planner), <0 = plans are padded (conservative).
  const pct = Math.round(e.bias * 100);
  const bias = Math.abs(pct) >= 5 ? ` — you plan ${Math.abs(pct)}% ${pct > 0 ? 'optimistic' : 'conservative'}` : '';
  return `${labelFor(e.trade)} actually takes you ~${formatDays(e.actualMean)} working days ${where}${bias}.`;
}

/**
 * Distil the pace book into prompt-ready fact lines.
 *
 * Selection rules:
 *   • only entries the book actually trusts (confidence medium/high) — a
 *     low-confidence mean is noise dressed up as history
 *   • never the 'general' inference fallback — it pools unrelated misc tasks
 *     (mobilization, permits, cleanup), same rule as paceSuggestionFor
 *   • exact size-band entries preferred; a trade's |all aggregate is emitted
 *     only when NO band for that trade qualifies (bands teach the model the
 *     scaling curve; |all is the fallback signal)
 *   • sorted by evidence weight (jobCount, then sampleCount), capped at 8
 */
export function buildPaceFacts(projects: Project[]): PaceFactsResult {
  const book = buildPaceBook(projects ?? []);
  const qualified = book.entries.filter(e => e.confidence !== 'low' && e.trade !== 'general');
  const tradesWithQualifiedBand = new Set(qualified.filter(e => e.sqftBucket !== 'all').map(e => e.trade));
  const chosen = qualified
    .filter(e => e.sqftBucket !== 'all' || !tradesWithQualifiedBand.has(e.trade))
    .sort((a, b) => (b.jobCount - a.jobCount) || (b.sampleCount - a.sampleCount) || a.key.localeCompare(b.key))
    .slice(0, MAX_FACTS);
  return {
    facts: chosen.map(factFor),
    tradeCount: new Set(chosen.map(e => e.trade)).size,
  };
}

/**
 * Render the injectable prompt block. '' when there are no facts, so callers
 * can unconditionally concatenate.
 *
 * Default instruction targets generators whose task schema carries
 * rationale/assumption (buildAnswersPrompt, generateScheduleFromEstimate).
 * Pass `citeInRationale: false` for schemas WITHOUT those fields
 * (scheduleAI's AIGeneratedTask, aiService's aiScheduleSchema) — instructing a
 * model to set fields its schema doesn't have degrades output quality.
 */
export function paceFactsBlock(facts: string[], opts?: { citeInRationale?: boolean }): string {
  if (!facts || facts.length === 0) return '';
  const instruction = opts?.citeInRationale === false
    ? 'When a trade appears in PACE HISTORY, derive its duration from the actual pace scaled to this job’s size instead of a generic industry guess.'
    : 'When a trade appears in PACE HISTORY, derive its duration from the actual pace scaled to this job’s size, set assumption:false for that task, and cite the pace in its rationale.';
  return [
    'YOUR PACE HISTORY (measured from this contractor’s finished tasks):',
    ...facts.map(f => `- ${f}`),
    instruction,
  ].join('\n');
}
