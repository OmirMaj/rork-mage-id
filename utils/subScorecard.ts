// subScorecard.ts — grade every subcontractor from the GC's REAL job data.
//
// The sub list knows who exists; this knows who is GOOD. It rolls the signals
// already sitting in memory — signed commitments, change-order growth baked
// into commitment.changeAmount, the compliance dates on the sub record,
// punch-list rework (items bounced at review, D7), and schedule reliability
// (as-built vs planned days on tasks assigned to the sub, D7) — into a
// 0–100 score + letter grade per sub, so the GC knows who to call for
// the next award (and who to quietly stop calling).
//
// Pure function, no network, no AI. Scoring shape mirrors utils/marginRiskScore:
// each factor yields a quality score in [0,1] (higher = better) with a fixed
// weight; the blend is a weighted average over the factors that actually apply.
//   score = round( Σ(quality·weight) / Σ(weight) · 100 )
// Track record (history depth) deliberately moves CONFIDENCE, never the score —
// a brand-new sub with clean paper isn't punished, they're just unproven.
// Factors without enough linked data render applicable:false ("Not enough
// linked data yet") instead of a fake neutral score.

import type { Subcontractor, Commitment, ChangeOrder, PunchItem, Project } from '@/types';
import { actualWorkingDays } from '@/utils/pace/paceBook';

export type SubGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type ScoreConfidence = 'low' | 'medium' | 'high';

export type ScorecardFactorKey = 'cost_discipline' | 'co_impact' | 'compliance' | 'rework_rate' | 'schedule_reliability';

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
  /**
   * Punch items for the rework_rate factor (D7). Attribution: assignedSubId
   * first; company-name match on assignedSub only when no id is set. An item
   * counts as REVIEWED once it closed or carries a rejectionNote (the reject
   * flow stamps one — see app/punch-list.tsx), and as REWORK when that note
   * exists. Optional — omitted ⇒ the factor reports applicable:false.
   */
  punchItems?: PunchItem[];
  /**
   * Projects (for their schedules) for the schedule_reliability factor (D7).
   * Tasks link to subs via task.assignedSubId; only done tasks with both
   * as-built day stamps count (same eligibility as utils/pace/paceBook.ts),
   * measured in working days through each schedule's own calendar. Optional —
   * omitted ⇒ the factor reports applicable:false.
   */
  projects?: Project[];
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

// Weights when all factors apply. Cost discipline is the headline — it's
// measured on finished work. The blend divides by the sum of APPLIED
// weights, so these are relative shares, not percentages; the original
// three keep their proportions when the D7 factors lack data.
const W_COST = 0.4;
const W_CO = 0.3;
const W_COMPLIANCE = 0.3;
const W_REWORK = 0.2;
const W_SCHED = 0.2;

// Minimum linked data before a D7 factor scores — below these it stays
// applicable:false so one bounced punch item can't tank an unproven sub.
const MIN_REVIEWED_PUNCH = 3;
const MIN_MEASURED_TASKS = 2;

// A 40% bounce rate zeroes rework quality; a 50% schedule overrun zeroes
// reliability. Finishing early earns full marks, no extra credit (mirrors
// cost_discipline's treatment of underruns).
const REWORK_ZERO_AT = 0.4;
const SLIP_ZERO_AT = 0.5;

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

/** One finished, both-stamps task assigned to a sub, in working days. */
interface MeasuredTask {
  plannedDays: number;
  actualDays: number;
}

/** Per-sub linked schedule work: how many tasks name the sub at all, and
 *  the subset with trustworthy as-built spans (paceBook eligibility). */
interface SubTaskRecord {
  linked: number;
  measured: MeasuredTask[];
}

/**
 * Walk every project schedule once and bucket tasks by assignedSubId.
 * Eligibility mirrors utils/pace/paceBook.ts buildPaceBook exactly: done,
 * both as-built day stamps, non-milestone, positive duration, non-inverted —
 * and actual spans convert through each schedule's own calendar so
 * actualDays is in durationDays' working-day unit.
 */
function collectSubTasks(projects: Project[]): Map<string, SubTaskRecord> {
  const bySub = new Map<string, SubTaskRecord>();
  const recordFor = (subId: string): SubTaskRecord => {
    const existing = bySub.get(subId);
    if (existing) return existing;
    const fresh: SubTaskRecord = { linked: 0, measured: [] };
    bySub.set(subId, fresh);
    return fresh;
  };
  for (const project of projects ?? []) {
    const schedule = project?.schedule;
    if (!schedule?.tasks?.length) continue;
    const startDate = schedule.startDate;
    const workingDaysPerWeek = schedule.workingDaysPerWeek ?? 7;
    const closures = new Set(schedule.nonWorkingDates ?? []);
    for (const task of schedule.tasks) {
      if (!task?.assignedSubId) continue;
      const rec = recordFor(task.assignedSubId);
      rec.linked++;
      if (task.isMilestone || !(task.durationDays > 0)) continue;
      if (task.status !== 'done') continue;
      if (typeof task.actualStartDay !== 'number' || typeof task.actualEndDay !== 'number') continue;
      if (task.actualEndDay < task.actualStartDay) continue;
      rec.measured.push({
        plannedDays: Math.max(1, Math.round(task.durationDays)),
        actualDays: actualWorkingDays(task.actualStartDay, task.actualEndDay, workingDaysPerWeek, startDate, closures),
      });
    }
  }
  return bySub;
}

/** Punch-item attribution: id first, company-name fallback only when the
 *  item has no assignedSubId (older items were routed by name alone). */
function punchBelongsToSub(item: PunchItem, sub: Subcontractor): boolean {
  if (item.assignedSubId) return item.assignedSubId === sub.id;
  const name = (item.assignedSub || '').trim().toLowerCase();
  return name.length > 0 && name === (sub.companyName || '').trim().toLowerCase();
}

function buildCard(
  sub: Subcontractor,
  subCommitments: Commitment[],
  subPunch: PunchItem[],
  subTasks: SubTaskRecord,
  now: Date,
): SubScorecard {
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

  // ── Rework rate (D7) — punch items that bounced at review. An item is
  // REVIEWED once it closed or carries a rejectionNote (the reject flow
  // stamps one and reopens the item — the note persists after the eventual
  // close, which is correct: the rework happened). Items still open/awaiting
  // review say nothing yet and stay out of the denominator.
  const reviewedPunch = subPunch.filter(p => p.status === 'closed' || !!(p.rejectionNote || '').trim());
  const rejectedPunch = reviewedPunch.filter(p => !!(p.rejectionNote || '').trim());
  const reworkApplicable = reviewedPunch.length >= MIN_REVIEWED_PUNCH;
  if (reworkApplicable) {
    const reworkRate = rejectedPunch.length / reviewedPunch.length;
    factors.push({
      key: 'rework_rate',
      label: 'Punch rework',
      score: clamp01(1 - reworkRate / REWORK_ZERO_AT),
      weight: W_REWORK,
      applicable: true,
      detail:
        rejectedPunch.length > 0
          ? `${rejectedPunch.length} of ${reviewedPunch.length} reviewed punch items bounced at review (sent back for rework)`
          : `All ${reviewedPunch.length} reviewed punch items closed without rework`,
    });
  } else {
    factors.push({
      key: 'rework_rate',
      label: 'Punch rework',
      score: 0,
      weight: 0,
      applicable: false,
      detail:
        subPunch.length === 0
          ? 'Not enough linked data yet — no punch items assigned to this sub'
          : `Not enough linked data yet — ${reviewedPunch.length} of ${MIN_REVIEWED_PUNCH} reviewed punch items needed`,
    });
  }

  // ── Schedule reliability (D7) — as-built vs planned working days on
  // tasks assigned to this sub (task.assignedSubId), same eligibility and
  // calendar conversion as the pace book. Aggregated as Σactual/Σplanned so
  // a big task counts more than a one-day punch task; finishing early earns
  // full marks, no extra credit.
  const measured = subTasks.measured;
  const schedApplicable = measured.length >= MIN_MEASURED_TASKS;
  if (schedApplicable) {
    const plannedSum = measured.reduce((s, t) => s + t.plannedDays, 0);
    const actualSum = measured.reduce((s, t) => s + t.actualDays, 0);
    const slip = plannedSum > 0 ? Math.max(0, actualSum / plannedSum - 1) : 0;
    factors.push({
      key: 'schedule_reliability',
      label: 'Schedule reliability',
      score: clamp01(1 - slip / SLIP_ZERO_AT),
      weight: W_SCHED,
      applicable: true,
      detail:
        slip > 0.001
          ? `Assigned tasks ran ${pct1(slip)} over plan (${actualSum} vs ${plannedSum} working days across ${measured.length} finished tasks)`
          : `Assigned tasks finished on or ahead of plan (${actualSum} vs ${plannedSum} working days across ${measured.length} finished tasks)`,
    });
  } else {
    factors.push({
      key: 'schedule_reliability',
      label: 'Schedule reliability',
      score: 0,
      weight: 0,
      applicable: false,
      detail:
        subTasks.linked === 0
          ? 'Not enough linked data yet — no schedule tasks assigned to this sub'
          : measured.length === 0
            ? `Not enough linked data yet — ${subTasks.linked} assigned task${subTasks.linked === 1 ? '' : 's'} without as-built dates`
            : `Not enough linked data yet — ${measured.length} of ${MIN_MEASURED_TASKS} measured tasks needed`,
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
  // Paperwork is the WHOLE grade only when no performance factor applies at
  // all — a sub with zero commitments can still be graded on punch rework
  // or schedule reliability when that linked data exists.
  const paperworkOnly = !costApplicable && !coApplicable && !reworkApplicable && !schedApplicable;
  factors.push({
    key: 'compliance',
    label: 'Compliance',
    score: complianceScore,
    weight: paperworkOnly ? 1 : W_COMPLIANCE,
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

  const topDriver = paperworkOnly
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

const EMPTY_TASK_RECORD: SubTaskRecord = { linked: 0, measured: [] };

export function computeSubScorecards(input: SubScorecardInput): SubScorecardResult {
  const { subcontractors, commitments, punchItems, projects } = input;
  const now = new Date();

  const bySub = new Map<string, Commitment[]>();
  for (const c of commitments ?? []) {
    if (!c.subcontractorId) continue;
    const list = bySub.get(c.subcontractorId);
    if (list) list.push(c);
    else bySub.set(c.subcontractorId, [c]);
  }

  const tasksBySub = collectSubTasks(projects ?? []);
  const allPunch = punchItems ?? [];

  const cards = (subcontractors ?? [])
    .map(sub => buildCard(
      sub,
      bySub.get(sub.id) ?? [],
      allPunch.filter(p => punchBelongsToSub(p, sub)),
      tasksBySub.get(sub.id) ?? EMPTY_TASK_RECORD,
      now,
    ))
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
