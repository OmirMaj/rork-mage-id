// subScorecard.ts — grade every subcontractor from the GC's REAL job data.
//
// The sub list knows who exists; this knows who is GOOD. It rolls the signals
// already sitting in memory — signed commitments, change-order growth baked
// into commitment.changeAmount, and the compliance dates on the sub record —
// into a 0–100 score + letter grade per sub, so the GC knows who to call for
// the next award (and who to quietly stop calling).
//
// Pure function, no network, no AI. Scoring shape mirrors utils/marginRiskScore:
// each factor yields a quality score in [0,1] (higher = better) with a fixed
// weight; the blend is a weighted average over the factors that actually apply.
//   score = round( Σ(quality·weight) / Σ(weight) · 100 )
// Track record (history depth) deliberately moves CONFIDENCE, never the score —
// a brand-new sub with clean paper isn't punished, they're just unproven.

import type { Subcontractor, Commitment, ChangeOrder } from '@/types';

export type SubGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type ScoreConfidence = 'low' | 'medium' | 'high';

export type ScorecardFactorKey = 'cost_discipline' | 'co_impact' | 'compliance';

export interface ScorecardFactor {
  key: ScorecardFactorKey;
  label: string;
  /** Quality 0–1, higher = better. */
  score: number;
  /** Weight used in this sub's blend (0 when the factor didn't apply). */
  weight: number;
  /** True when there was real data behind the factor. */
  applicable: boolean;
  /** Plain-English explanation of what drove the number. */
  detail: string;
}

export interface SubScorecard {
  subId: string;
  companyName: string;
  trade: string;
  /** 0–100, higher = better sub. */
  score: number;
  grade: SubGrade;
  /** Driven by history depth, not score. */
  confidence: ScoreConfidence;
  /**
   * Factors ranked by weighted drag (weight × shortfall) descending — the
   * first entry is the biggest thing holding the score down. When nothing
   * drags, best factors lead.
   */
  factors: ScorecardFactor[];
  /** factors[0].detail — the one-liner for list rows. */
  topDriver: string;
  /** Non-draft commitments attributed to this sub. */
  commitmentCount: number;
  closedCommitmentCount: number;
  /** Σ(amount + changeAmount) over non-draft commitments. */
  totalVolume: number;
  /** True when the sub has zero non-draft commitments — compliance-only score. */
  noHistory: boolean;
}

export interface SubScorecardInput {
  subcontractors: Subcontractor[];
  commitments: Commitment[];
  /**
   * Accepted for future per-CO attribution. Today CO growth is already rolled
   * into commitment.changeAmount (see Commitment docs in types/index.ts), so
   * the engine reads it from there and this list is not required.
   */
  changeOrders?: ChangeOrder[];
}

export interface SubScorecardResult {
  /** Ranked best-first (score desc, then confidence, then volume). */
  cards: SubScorecard[];
  /** trade → subId of the highest-ranked sub in that trade. */
  bestByTrade: Record<string, string>;
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const clamp100 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(100, x)) : 0);

const DAY_MS = 86_400_000;
const EXPIRING_WINDOW_DAYS = 30;

// Weights when all three factors apply. Cost discipline is the headline —
// it's the only factor measured on finished work.
const W_COST = 0.4;
const W_CO = 0.3;
const W_COMPLIANCE = 0.3;

function money(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `$${Math.round(abs / 1000)}K`;
  if (abs >= 1_000) return `$${(abs / 1000).toFixed(1)}K`;
  return `$${Math.round(abs).toLocaleString('en-US')}`;
}

const pct1 = (r: number): string => `${(r * 100).toFixed(1)}%`;

export function gradeForScore(score: number): SubGrade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/** Days from `now` until the ISO date; null when missing/unparseable. */
function daysUntil(iso: string | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - now.getTime()) / DAY_MS);
}

interface DocStatus {
  score: number;
  detail: string;
}

function docStatus(label: string, iso: string | undefined, now: Date): DocStatus {
  const days = daysUntil(iso, now);
  if (days === null) return { score: 0.4, detail: `${label} expiry not on file` };
  if (days < 0) return { score: 0, detail: `${label} expired ${Math.abs(days)}d ago` };
  if (days <= EXPIRING_WINDOW_DAYS) return { score: 0.5, detail: `${label} expires in ${days}d` };
  return { score: 1, detail: `${label} current` };
}

function confidenceFor(commitmentCount: number): ScoreConfidence {
  if (commitmentCount >= 6) return 'high';
  if (commitmentCount >= 3) return 'medium';
  return 'low';
}

function buildCard(sub: Subcontractor, subCommitments: Commitment[], now: Date): SubScorecard {
  // Draft commitments are unsigned intent — they say nothing about how the
  // sub actually performs, so they don't count as history.
  const signed = subCommitments.filter(c => c.status !== 'draft');
  const closed = signed.filter(c => c.status === 'closed');

  const totalBase = signed.reduce((s, c) => s + (Number.isFinite(c.amount) ? c.amount : 0), 0);
  const totalChange = signed.reduce((s, c) => s + (Number.isFinite(c.changeAmount ?? 0) ? (c.changeAmount ?? 0) : 0), 0);
  const totalVolume = totalBase + totalChange;
  const noHistory = signed.length === 0;

  const factors: ScorecardFactor[] = [];

  // ── Cost discipline — only finished work counts. Final value vs signed
  // value on closed commitments; ≥25% overrun zeroes the factor.
  const closedBase = closed.reduce((s, c) => s + (Number.isFinite(c.amount) ? c.amount : 0), 0);
  const closedFinal = closed.reduce(
    (s, c) => s + (Number.isFinite(c.amount) ? c.amount : 0) + (Number.isFinite(c.changeAmount ?? 0) ? (c.changeAmount ?? 0) : 0),
    0,
  );
  const costApplicable = closed.length > 0 && closedBase > 0;
  if (costApplicable) {
    const overrun = Math.max(0, (closedFinal - closedBase) / closedBase); // underruns don't add credit beyond 1
    const costScore = clamp01(1 - overrun / 0.25);
    factors.push({
      key: 'cost_discipline',
      label: 'Cost discipline',
      score: costScore,
      weight: W_COST,
      applicable: true,
      detail:
        overrun > 0.001
          ? `Closed work finished ${pct1(overrun)} over signed value (${money(closedFinal - closedBase)} over on ${money(closedBase)} across ${closed.length} closed commitment${closed.length === 1 ? '' : 's'})`
          : `Closed work finished on or under signed value across ${closed.length} closed commitment${closed.length === 1 ? '' : 's'}`,
    });
  } else {
    factors.push({
      key: 'cost_discipline',
      label: 'Cost discipline',
      score: 0,
      weight: 0,
      applicable: false,
      detail: noHistory ? 'No job history yet' : 'No closed commitments yet — final cost unproven',
    });
  }

  // ── Change-order impact — CO growth as a share of base across ALL signed
  // work (open jobs included; CO creep shows up before a job closes).
  // ≥20% growth zeroes the factor.
  const coApplicable = signed.length > 0 && totalBase > 0;
  if (coApplicable) {
    const coShare = Math.max(0, totalChange / totalBase);
    const coScore = clamp01(1 - coShare / 0.2);
    factors.push({
      key: 'co_impact',
      label: 'Change-order impact',
      score: coScore,
      weight: W_CO,
      applicable: true,
      detail:
        coShare > 0.001
          ? `Change orders added ${pct1(coShare)} on top of ${money(totalBase)} in signed contracts (${money(Math.max(0, totalChange))})`
          : `No change-order growth across ${money(totalBase)} in signed contracts`,
    });
  } else {
    factors.push({
      key: 'co_impact',
      label: 'Change-order impact',
      score: 0,
      weight: 0,
      applicable: false,
      detail: 'No signed commitments to measure change-order growth on',
    });
  }

  // ── Compliance — paperwork standing today. Always applicable.
  const coi = docStatus('COI', sub.coiExpiry, now);
  const license = docStatus('License', sub.licenseExpiry, now);
  const coiVerifiedDays = daysUntil(sub.coiVerifiedAt, now); // negative = days ago
  const coiRecentlyVerified = coi.score >= 1 && coiVerifiedDays !== null && coiVerifiedDays >= -90 && coiVerifiedDays <= 0;
  const parts: string[] = [
    coiRecentlyVerified ? `${coi.detail} (verified ${Math.abs(coiVerifiedDays ?? 0)}d ago)` : coi.detail,
    license.detail,
    sub.w9OnFile ? 'W-9 on file' : 'No W-9 on file',
  ];
  const complianceScore = clamp01(coi.score * 0.4 + license.score * 0.4 + (sub.w9OnFile ? 1 : 0) * 0.2);
  factors.push({
    key: 'compliance',
    label: 'Compliance',
    score: complianceScore,
    weight: noHistory ? 1 : W_COMPLIANCE,
    applicable: true,
    detail: parts.join(' · '),
  });

  // Blend over applicable factors only; weights renormalize automatically
  // because we divide by the sum of the weights that made it in.
  const used = factors.filter(f => f.applicable && f.weight > 0);
  const weightSum = used.reduce((s, f) => s + f.weight, 0);
  const score = weightSum > 0
    ? Math.round(clamp100((used.reduce((s, f) => s + f.score * f.weight, 0) / weightSum) * 100))
    : 0;

  // Rank: biggest weighted drag first so factors[0] is the top driver.
  // Inapplicable factors sink to the bottom.
  const ranked = [...factors].sort((a, b) => {
    if (a.applicable !== b.applicable) return a.applicable ? -1 : 1;
    const dragA = a.weight * (1 - a.score);
    const dragB = b.weight * (1 - b.score);
    if (dragB !== dragA) return dragB - dragA;
    return b.weight - a.weight;
  });

  const topDriver = noHistory
    ? `No job history yet — graded on paperwork only. ${ranked[0]?.detail ?? ''}`.trim()
    : ranked[0]?.detail ?? '';

  return {
    subId: sub.id,
    companyName: sub.companyName,
    trade: sub.trade,
    score,
    grade: gradeForScore(score),
    confidence: noHistory ? 'low' : confidenceFor(signed.length),
    factors: ranked,
    topDriver,
    commitmentCount: signed.length,
    closedCommitmentCount: closed.length,
    totalVolume,
    noHistory,
  };
}

const CONFIDENCE_RANK: Record<ScoreConfidence, number> = { low: 0, medium: 1, high: 2 };

export function computeSubScorecards(input: SubScorecardInput): SubScorecardResult {
  const { subcontractors, commitments } = input;
  const now = new Date();

  const bySub = new Map<string, Commitment[]>();
  for (const c of commitments ?? []) {
    if (!c.subcontractorId) continue;
    const list = bySub.get(c.subcontractorId);
    if (list) list.push(c);
    else bySub.set(c.subcontractorId, [c]);
  }

  const cards = (subcontractors ?? [])
    .map(sub => buildCard(sub, bySub.get(sub.id) ?? [], now))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const conf = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
      if (conf !== 0) return conf;
      return b.totalVolume - a.totalVolume;
    });

  // First card per trade is the best — cards are already ranked.
  const bestByTrade: Record<string, string> = {};
  for (const card of cards) {
    if (!(card.trade in bestByTrade)) bestByTrade[card.trade] = card.subId;
  }

  return { cards, bestByTrade };
}
