// utils/copilot/askDecision.ts — the ask-only-when-unresolved discipline.
import type { Gap, AskDecision } from './types';

export interface AskState { asked: string[]; count: number; cap: number; threshold: number }

/** Decide the ONE gap to ask next, or that we're ready / capped. Gaps below
 *  `threshold` are never asked (the engine states their grounded default).
 *  Already-asked fields are skipped. At/over the cap we stop asking. */
export function decideAsk(gaps: Gap[], s: AskState): AskDecision {
  const askable = gaps
    .filter(g => g.impact >= s.threshold && !s.asked.includes(g.field))
    .sort((a, b) => b.impact - a.impact);
  if (askable.length === 0) return { kind: 'ready' };
  if (s.count >= s.cap) return { kind: 'capped' };
  return { kind: 'ask', gap: askable[0] };
}
