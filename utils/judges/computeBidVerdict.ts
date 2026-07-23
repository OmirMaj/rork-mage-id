// utils/judges/computeBidVerdict.ts — turns priced scope + signals into a
// deterministic bid verdict. Every number here is computed, never AI-generated.
//
// Scoring model (revised after the adversarial money-math review):
// - The recommended price GUARANTEES the target margin by construction, so
//   margin is an OUTPUT of the engine, not a fitness input — scoring it was
//   circular (it reduced to a function of the settings value alone). Margin and
//   cost-confidence render as non-scoring driver chips instead.
// - fitScore starts from a NEUTRAL 55 ("no signal" lands in hold_firm, never a
//   confident take) and is moved by the real job signals — track record,
//   capacity, margin-risk — scaled by how much of the scope is priced from the
//   contractor's own history (coverage). Zero history cannot inflate the score.
// - bidBias is already partially absorbed into suggestedRate (blend weight
//   w = jobCount/(jobCount+K) in costDatabase); only the UNabsorbed residual
//   (1−w) nudges the price, so long-history users aren't double-corrected.
import { priceLines } from './priceLines';
import type { BidVerdict, BidVerdictInput, BidDriver, ConfidenceLevel, PricedLine, Verdict } from './types';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const CONF_SCORE: Record<ConfidenceLevel, number> = { low: 0.33, medium: 0.66, high: 1 };
/** No-signal baseline: inside the hold_firm band (45–69), never a take. */
const NEUTRAL_SCORE = 55;
/** Mirrors costDatabase BLEND_K — the blend constant behind suggestedRate. */
const BLEND_K = 3;

function exposureConfidence(lines: PricedLine[]): { level: ConfidenceLevel; score: number; coveragePct: number } {
  const total = lines.reduce((a, l) => a + l.lineTrueCost, 0);
  if (total <= 0) return { level: 'low', score: 0.33, coveragePct: 0 };
  const wScore = lines.reduce((a, l) => a + l.lineTrueCost * CONF_SCORE[l.confidence], 0) / total;
  const coveragePct = lines.reduce((a, l) => a + (l.fromHistory ? l.lineTrueCost : 0), 0) / total;
  const level: ConfidenceLevel = wScore >= 0.8 ? 'high' : wScore >= 0.5 ? 'medium' : 'low';
  return { level, score: wScore, coveragePct };
}

/** Exposure-weighted RESIDUAL bid bias — only the share suggestedRate hasn't already absorbed. */
function exposureResidualBias(lines: PricedLine[], input: BidVerdictInput): number {
  const byKey = new Map(input.costDb.entries.map((e) => [e.key, e]));
  const total = lines.reduce((a, l) => a + (l.fromHistory ? l.lineTrueCost : 0), 0);
  if (total <= 0) return 0;
  let acc = 0;
  for (const l of lines) {
    if (!l.fromHistory || !l.bookKey) continue;
    const e = byKey.get(l.bookKey);
    if (!e) continue;
    const w = e.jobCount / (e.jobCount + BLEND_K); // share already blended into suggestedRate
    acc += l.lineTrueCost * e.bidBias * (1 - w);
  }
  return acc / total;
}

export function computeBidVerdict(input: BidVerdictInput): BidVerdict {
  // Sane margin band: 2%–60%. Anything outside is a settings error, not a plan.
  const rawTarget = Number.isFinite(input.targetMargin) && input.targetMargin > 0 ? input.targetMargin : 0.2;
  const targetMargin = Math.min(0.6, Math.max(0.02, rawTarget));
  const lines = priceLines(input.lines, input.costDb);
  const trueCost = lines.reduce((a, l) => a + l.lineTrueCost, 0);
  const conf = exposureConfidence(lines);
  const unpricedCount = lines.filter((l) => l.quantity > 0 && l.usedUnit <= 0).length;

  // Bid range from margin target; nudge up by the residual (unabsorbed) bias only.
  const rawBias = exposureResidualBias(lines, input);
  const bidBiasNudge = rawBias > 0 ? Math.min(rawBias, 0.15) : 0;
  const priceAt = (m: number) => (trueCost > 0 ? (trueCost / (1 - clamp01(m))) * (1 + bidBiasNudge) : 0);
  const recommendedMid = priceAt(targetMargin);
  const recommendedLow = priceAt(Math.max(0, targetMargin - 0.03));
  const recommendedHigh = priceAt(Math.min(0.95, targetMargin + 0.03));
  const marginAtMid = recommendedMid > 0 ? 1 - trueCost / recommendedMid : 0;

  // Job-quality signals. Absent inputs drop out and remaining weights renormalize.
  const parts: { key: BidDriver['kind']; weight: number; score: number; polarity?: BidDriver['polarity']; detail: string }[] = [];
  if (input.typeMargin && input.typeMargin.avgMarginPct !== null) {
    // One closed job is an anecdote, not a track record — scale weight in by jobCount.
    const weight = 0.35 * Math.min(1, input.typeMargin.jobCount / 3);
    if (weight > 0) {
      const avg = input.typeMargin.avgMarginPct;
      parts.push({
        key: 'track_record', weight, score: clamp01(avg / 0.2),
        detail: `Your ${input.typeMargin.jobCount} past job${input.typeMargin.jobCount === 1 ? '' : 's'} of this type average ${Math.round(avg * 100)}% realized margin.`,
      });
    }
  }
  if (input.capacity) {
    const load = clamp01(input.capacity.loadPct);
    parts.push({
      key: 'capacity', weight: 0.35, score: clamp01(1 - load),
      polarity: load >= 0.6 ? 'negative' : 'positive',
      detail: input.capacity.bookedSolid
        ? `You're booked ~${Math.round(load * 100)}% in this window — squeezing it in risks your other jobs.`
        : load >= 0.6
          ? `This window is getting tight (${Math.round(load * 100)}% booked).`
          : `You have room in this window (${Math.round(load * 100)}% booked).`,
    });
  }
  if (input.marginRisk && input.marginRisk.hasBasis) {
    parts.push({
      key: 'risk', weight: 0.30, score: clamp01(1 - input.marginRisk.score / 100),
      detail: `Margin-risk model scores this ${input.marginRisk.band} (${input.marginRisk.score}/100).`,
    });
  }

  const totalWeight = parts.reduce((a, p) => a + p.weight, 0);
  const base = totalWeight > 0
    ? 100 * parts.reduce((a, p) => a + (p.weight / totalWeight) * clamp01(p.score), 0)
    : NEUTRAL_SCORE;
  // Low coverage pulls the verdict toward neutral — the brain can't move far on
  // scope it hasn't priced from its own history.
  const confWeight = 0.3 + 0.7 * clamp01(conf.coveragePct / 0.7);
  let fitScore = Math.round(NEUTRAL_SCORE + (base - NEUTRAL_SCORE) * confWeight);
  // Booked solid can never be a confident "take", whatever the other signals say.
  if (input.capacity?.bookedSolid) fitScore = Math.min(fitScore, 65);
  fitScore = Math.max(0, Math.min(100, fitScore));

  const drivers: BidDriver[] = parts
    .map((p) => ({
      kind: p.key,
      polarity: (p.polarity ?? (p.score >= 0.6 ? 'positive' : 'negative')) as BidDriver['polarity'],
      weight: totalWeight > 0 ? p.weight / totalWeight : 0,
      detail: p.detail,
    }))
    .sort((a, b) => b.weight - a.weight);

  // Non-scoring context chips (weight 0): margin is an output; confidence explains reach.
  drivers.push({
    kind: 'cost_confidence',
    polarity: conf.level === 'low' ? 'negative' : 'positive',
    weight: 0,
    detail: `Cost confidence is ${conf.level} — ${Math.round(conf.coveragePct * 100)}% of this scope is priced from your own history.`,
  });
  if (trueCost > 0) {
    drivers.push({
      kind: 'margin', polarity: 'positive', weight: 0,
      detail: `At the recommended price you keep ~${Math.round(marginAtMid * 100)}% margin.`,
    });
  }
  const topCal = input.calibration?.categories?.find((c) => c.direction !== 'aligned');
  if (topCal) drivers.push({ kind: 'calibration', polarity: topCal.direction === 'under' ? 'negative' : 'positive', weight: 0, detail: topCal.detail });

  const disclaimers: string[] = [];
  if (trueCost <= 0) disclaimers.push('No scope to price yet — add line items or describe the job.');
  else if (conf.coveragePct < 0.5) disclaimers.push('Based on your bid assumptions, not yet your history — this sharpens as you close jobs.');
  if (trueCost > 0 && unpricedCount > 0) {
    disclaimers.push(`${unpricedCount} line${unpricedCount === 1 ? ' has' : 's have'} no price yet and ${unpricedCount === 1 ? 'is' : 'are'} excluded from the total — price ${unpricedCount === 1 ? 'it' : 'them'} before relying on this number.`);
  }

  const verdict: Verdict = trueCost <= 0 ? 'walk' : fitScore >= 70 ? 'take' : fitScore >= 45 ? 'hold_firm' : 'walk';

  return {
    verdict, fitScore, trueCost,
    recommendedLow, recommendedHigh, recommendedMid, marginAtMid, targetMargin, bidBiasNudge,
    costConfidence: conf.level, coveragePct: conf.coveragePct,
    lines, drivers, disclaimers,
  };
}
