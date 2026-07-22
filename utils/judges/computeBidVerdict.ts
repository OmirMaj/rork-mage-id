// utils/judges/computeBidVerdict.ts — turns priced scope + signals into a
// deterministic bid verdict. Every number here is computed, never AI-generated.
import { priceLines } from './priceLines';
import type { BidVerdict, BidVerdictInput, BidDriver, ConfidenceLevel, PricedLine, Verdict } from './types';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const CONF_SCORE: Record<ConfidenceLevel, number> = { low: 0.33, medium: 0.66, high: 1 };

function exposureConfidence(lines: PricedLine[]): { level: ConfidenceLevel; score: number; coveragePct: number } {
  const total = lines.reduce((a, l) => a + l.lineTrueCost, 0);
  if (total <= 0) return { level: 'low', score: 0.33, coveragePct: 0 };
  const wScore = lines.reduce((a, l) => a + l.lineTrueCost * CONF_SCORE[l.confidence], 0) / total;
  const coveragePct = lines.reduce((a, l) => a + (l.fromHistory ? l.lineTrueCost : 0), 0) / total;
  const level: ConfidenceLevel = wScore >= 0.8 ? 'high' : wScore >= 0.5 ? 'medium' : 'low';
  return { level, score: wScore, coveragePct };
}

function exposureBidBias(lines: PricedLine[], input: BidVerdictInput): number {
  // Exposure-weighted bidBias across lines that have a cost-book entry.
  const total = lines.reduce((a, l) => a + (l.fromHistory ? l.lineTrueCost : 0), 0);
  if (total <= 0) return 0;
  let acc = 0;
  for (const l of lines) {
    if (!l.fromHistory) continue;
    const hit = input.costDb.entries.find((e) => e.key === `${l.category.trim().toLowerCase()}|${(l.unit || 'unit').trim().toLowerCase()}`);
    if (hit) acc += l.lineTrueCost * hit.bidBias;
  }
  return acc / total;
}

export function computeBidVerdict(input: BidVerdictInput): BidVerdict {
  const targetMargin = clamp01(input.targetMargin > 0 ? input.targetMargin : 0.2);
  const lines = priceLines(input.lines, input.costDb);
  const trueCost = lines.reduce((a, l) => a + l.lineTrueCost, 0);
  const conf = exposureConfidence(lines);

  // Bid range from margin target; nudge up if you habitually bid low (bidBias>0).
  const rawBias = exposureBidBias(lines, input);
  const bidBiasNudge = rawBias > 0 ? Math.min(rawBias, 0.15) : 0;
  const priceAt = (m: number) => (trueCost > 0 ? (trueCost / (1 - clamp01(m))) * (1 + bidBiasNudge) : 0);
  const recommendedMid = priceAt(targetMargin);
  const recommendedLow = priceAt(Math.max(0, targetMargin - 0.03));
  const recommendedHigh = priceAt(Math.min(0.95, targetMargin + 0.03));
  const marginAtMid = recommendedMid > 0 ? 1 - trueCost / recommendedMid : 0;

  // Weighted sub-scores; absent inputs drop out and remaining weights renormalize.
  const parts: { key: BidDriver['kind']; weight: number; score: number; detail: (s: number) => string }[] = [];
  parts.push({ key: 'cost_confidence', weight: 0.25, score: conf.score, detail: () => `Cost confidence is ${conf.level} — ${Math.round(conf.coveragePct * 100)}% of this scope is priced from your own history.` });
  parts.push({ key: 'margin', weight: 0.30, score: clamp01(marginAtMid / 0.2), detail: () => `At the recommended price you keep ${Math.round(marginAtMid * 100)}% margin.` });
  if (input.typeMargin && input.typeMargin.avgMarginPct !== null) {
    parts.push({ key: 'track_record', weight: 0.15, score: clamp01(input.typeMargin.avgMarginPct / 0.2), detail: () => `Your ${input.typeMargin!.jobCount} past jobs of this type average ${Math.round((input.typeMargin!.avgMarginPct as number) * 100)}% margin.` });
  }
  if (input.capacity) {
    parts.push({ key: 'capacity', weight: 0.15, score: clamp01(1 - input.capacity.loadPct), detail: () => (input.capacity!.bookedSolid ? `You're booked ~${Math.round(input.capacity!.loadPct * 100)}% in this window — squeezing it in risks your other jobs.` : `You have room in this window (${Math.round(input.capacity!.loadPct * 100)}% booked).`) });
  }
  if (input.marginRisk && input.marginRisk.hasBasis) {
    parts.push({ key: 'risk', weight: 0.15, score: clamp01(1 - input.marginRisk.score / 100), detail: () => `Margin-risk model scores this ${input.marginRisk!.band} (${input.marginRisk!.score}/100).` });
  }

  const totalWeight = parts.reduce((a, p) => a + p.weight, 0) || 1;
  const fitScore = Math.round(100 * parts.reduce((a, p) => a + (p.weight / totalWeight) * clamp01(p.score), 0));

  const drivers: BidDriver[] = parts
    .map((p) => ({ kind: p.key, polarity: (p.score >= 0.6 ? 'positive' : 'negative') as BidDriver['polarity'], weight: p.weight / totalWeight, detail: p.detail(p.score) }))
    .sort((a, b) => b.weight - a.weight);

  // Calibration driver (non-scoring, additive narrative) if a top category is off.
  const topCal = input.calibration?.categories?.find((c) => c.direction !== 'aligned');
  if (topCal) drivers.push({ kind: 'calibration', polarity: topCal.direction === 'under' ? 'negative' : 'positive', weight: 0, detail: topCal.detail });

  const disclaimers: string[] = [];
  if (trueCost <= 0) disclaimers.push('No scope to price yet — add line items or describe the job.');
  else if (conf.coveragePct < 0.5) disclaimers.push('Based on your bid assumptions, not yet your history — this sharpens as you close jobs.');

  const verdict: Verdict = trueCost <= 0 ? 'walk' : fitScore >= 70 ? 'take' : fitScore >= 45 ? 'hold_firm' : 'walk';

  return {
    verdict, fitScore, trueCost,
    recommendedLow, recommendedHigh, recommendedMid, marginAtMid, targetMargin, bidBiasNudge,
    costConfidence: conf.level, coveragePct: conf.coveragePct,
    lines, drivers, disclaimers,
  };
}
