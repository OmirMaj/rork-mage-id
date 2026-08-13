// utils/judges/narrateVerdict.ts — phrasing only. The prompt hands the model the
// ALREADY-COMPUTED verdict and forbids inventing figures; a failure degrades to
// the engine's own driver sentences.
// mageAI is lazy-imported inside narrateVerdict() so this module's top-level
// is pure (no React Native deps) and can be tested in Bun validators.
import type { BidVerdict } from './types';

const VERDICT_WORDS: Record<BidVerdict['verdict'], string> = {
  take: 'Take it', hold_firm: 'Bid but hold firm', walk: 'Walk away',
};

export function buildNarrationPrompt(v: BidVerdict): string {
  const facts = [
    `Verdict: ${v.verdict} (${VERDICT_WORDS[v.verdict]}).`,
    `Fit score: ${v.fitScore}/100.`,
    `Your true cost: ${Math.round(v.trueCost)}.`,
    `Recommended bid: ${Math.round(v.recommendedLow)}–${Math.round(v.recommendedHigh)} (mid ${Math.round(v.recommendedMid)}).`,
    `Margin at mid: ${Math.round(v.marginAtMid * 100)}%.`,
    `Cost confidence: ${v.costConfidence}; ${Math.round(v.coveragePct * 100)}% of scope priced from history.`,
    // The model must never phrase a self-reported rate as measured history —
    // "your framing costs $12.50, I've watched it" is the one sentence that
    // would cost the product its credibility. State the split explicitly.
    ...(v.seededCoveragePct > 0
      ? [`${Math.round(v.seededCoveragePct * 100)}% of scope priced from rates the contractor SET THEMSELVES (self-reported, not measured on any job here). Do NOT describe these as history, past jobs, or measured costs.`]
      : []),
    ...v.drivers.map((d) => `- (${d.polarity}) ${d.detail}`),
    ...v.disclaimers.map((s) => `- Note: ${s}`),
  ].join('\n');
  return [
    'You are a veteran construction estimator advising a contractor whether to bid a job.',
    'Write 2–3 short sentences explaining the recommendation in plain, confident language a contractor would respect.',
    'Use ONLY the numbers below — do not invent any figure, price, or percentage that is not present here.',
    'Lead with the verdict, then the single most important reason, then the biggest risk.',
    '',
    facts,
  ].join('\n');
}

export async function narrateVerdict(v: BidVerdict): Promise<string> {
  const fallback = v.drivers.slice(0, 2).map((d) => d.detail).join(' ');
  try {
    // Lazy import so this module's top-level stays free of React Native deps
    // (required for Bun-based validators to import buildNarrationPrompt cleanly).
    const { mageAI } = await import('@/utils/mageAI');
    const res = await mageAI({ prompt: buildNarrationPrompt(v), tier: 'smart', maxTokens: 400, feature: 'bid_scoring' });
    if (res.success && typeof res.data === 'string' && res.data.trim()) return res.data.trim();
    if (res.success && res.raw && res.raw.trim()) return res.raw.trim();
    return fallback;
  } catch {
    return fallback;
  }
}
