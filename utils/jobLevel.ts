// utils/jobLevel.ts — the Level as a project-health instrument (ideas-1, T5).
//
// "The Level" (components/loaders/LevelMark) was only ever a loader. This is
// its still READING: one spirit level per project, read at a glance.
//
//   • DRIFT (the bubble's offset) comes ONLY from schedule slip in working
//     days against the active baseline — PortfolioSchedule.slipDays, derived
//     by utils/portfolio/portfolioRow exactly as the Schedule tab derives it.
//     slipDays ≤ 0 → 0 (centred; no extra credit for being ahead).
//     slipDays > 0 → min(1, slipDays / SLIP_FULL_SCALE_DAYS).
//     DIRECTION: behind drifts to the RIGHT (a positive offset). The page reads
//     left to right like a Gantt chart, and a slipping finish moves right on
//     one, so a bubble pushed right says "the finish moved later" without a
//     legend. Being ahead never drifts left: no credit, so a bubble left of
//     centre can never exist and never needs explaining.
//     No baseline (slipDays null), an undated schedule, or no schedule → NO
//     drift reading. It is never inferred from overdue counts or the health
//     score: an overdue count is not a number of days.
//   • TINT comes ONLY from margin risk (utils/marginRiskScore, the same
//     computeMarginRisk call the Margin risk screen makes): low → steady,
//     moderate → watch, elevated / high → risk; no basis → none.
//   • HONESTY: with neither half the reading is 'no_data' ("Not enough data
//     yet", a hollow grey vial); with one half it is 'partial' and the missing
//     half is NAMED in the reasons — never drawn as centred-and-fine. "On plan"
//     is printed only when slipDays is exactly known and ≤ 0.
//   • SITE COUNTS (open punch, RFIs past due) are LISTED in the reasons, never
//     drawn: they move no offset, tint, kind, label or key.
//
// PURE: no React, no react-native (bun-executable; scripts/validate-job-level.ts
// runs the reading table over it).

import type { PortfolioSchedule } from '@/utils/portfolio/portfolioRow';
import { PORTFOLIO_HIDE_BELOW } from '@/utils/portfolio/portfolioRow';
import type { RiskBand } from '@/utils/marginRiskScore';
import type { MarginCostBasis } from '@/utils/livingEstimate';

/** Working days of slip that put the bubble at the end of its travel. */
export const SLIP_FULL_SCALE_DAYS = 10;

/** The bubble's one ease when a reading changes (ms). */
export const JOB_LEVEL_EASE_MS = 450;

export type JobLevelKind = 'reading' | 'partial' | 'no_data';
export type JobLevelTint = 'steady' | 'watch' | 'risk' | 'none';

/** The margin half — the fields of a MarginRiskScore the Level reads. */
export interface JobLevelMargin {
  hasBasis: boolean;
  band: RiskBand;
  score: number;
  /** Absent reads as 'subs_only' (marginRiskScore's own rule). */
  costBasis?: MarginCostBasis;
  topFactors: readonly { label: string; detail: string }[];
}

/**
 * Why the margin half is absent when it is not simply "no estimate":
 *   'loading'   — the cost streams (receipts, rates, crew hours) have not been
 *                 read yet; scoring now would price a self-perform job at its
 *                 bid margin (the Margin risk screen holds its score too);
 *   'no_access' — the project's money is not shown here (a project someone
 *                 else owns, a field seat, or unread invoices / change orders:
 *                 Home's burnByProject visibility rule).
 */
export type JobLevelMarginWithheld = 'loading' | 'no_access';

export interface JobLevelInput {
  schedule: PortfolioSchedule | 'undated' | null;
  margin: JobLevelMargin | null;
  marginWithheld?: JobLevelMarginWithheld;
  /**
   * Site counts the hub knows (open punch, RFIs past their due date). They are
   * LISTED in the reasons and never drawn: a count is not a number of days, so
   * they change no offset, tint, kind, label or key (no ease fires on them).
   */
  site?: JobLevelSite;
}

export interface JobLevelSite {
  openPunch: number;
  overdueRfis: number;
}

export interface JobLevelReading {
  kind: JobLevelKind;
  /** −1 … 1; 0 = centred. Behind = positive (right). 0 without a slip reading. */
  offset: number;
  tint: JobLevelTint;
  /** The schedule half has a basis (a known slip against a baseline). */
  hasSchedule: boolean;
  /** The margin half has a basis. */
  hasMargin: boolean;
  /** One line: the popover title and the phone caption. */
  label: string;
  /** What VoiceOver reads. */
  accessibilityLabel: string;
  /** The tap detail, one full sentence each. */
  reasons: string[];
  /** Changes only when the drawn reading changes (the ease-once rule). */
  key: string;
}

export const NOT_ENOUGH_DATA = 'Not enough data yet';
export const ON_PLAN = 'On plan';
export const NO_BASELINE_REASON = 'No baseline yet, so there is no slip reading.';
export const UNDATED_REASON = 'The schedule has no start date, so there is no slip reading.';
export const NO_SCHEDULE_REASON = 'No schedule yet, so there is no slip reading.';
export const NO_MARGIN_REASON = 'No estimate with a margin yet, so there is no margin reading.';
export const MARGIN_LOADING_REASON = 'Margin is still loading.';
export const MARGIN_HIDDEN_REASON = 'Margin is not shown for this project.';
export const SUBS_ONLY_REASON = 'Margin reads subcontracts only; add labor and material costs for a full reading.';

const days = (n: number) => `${n} working ${n === 1 ? 'day' : 'days'}`;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** A factor label mid-sentence: first letter lowered unless it starts an acronym ("RFI", "CO"). */
function midSentence(s: string): string {
  if (s.length > 1 && s[1] === s[1].toUpperCase() && s[1] !== s[1].toLowerCase()) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

const endSentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

export function tintForBand(band: RiskBand): JobLevelTint {
  if (band === 'low') return 'steady';
  if (band === 'moderate') return 'watch';
  return 'risk';
}

/** The slip (working days) the schedule half reads, or null without a baseline reading. */
export function knownSlip(schedule: JobLevelInput['schedule']): number | null {
  if (schedule == null || schedule === 'undated') return null;
  const s = schedule.slipDays;
  return s != null && Number.isFinite(s) ? Math.round(s) : null;
}

/** The bubble's drift for a slip. ≤ 0 → 0 (no credit for ahead); > 0 → min(1, slip / 10). */
export function offsetForSlip(slipDays: number | null): number {
  if (slipDays == null || !Number.isFinite(slipDays) || slipDays <= 0) return 0;
  return clamp(slipDays / SLIP_FULL_SCALE_DAYS, 0, 1);
}

export function computeJobLevel(input: JobLevelInput): JobLevelReading {
  const { schedule, margin, marginWithheld } = input;

  // ── Schedule half ─────────────────────────────────────────────────────────
  const slip = knownSlip(schedule);
  const hasSchedule = slip != null;
  const offset = offsetForSlip(slip);
  const reasons: string[] = [];
  let schedShort: string;
  let schedSpoken: string;
  if (slip != null && slip > 0) {
    schedShort = `${days(slip)} behind`;
    schedSpoken = `${days(slip)} behind`;
    reasons.push(`${days(slip)} behind the baseline finish.`);
  } else if (slip != null) {
    schedShort = ON_PLAN;
    schedSpoken = 'on plan';
    reasons.push(slip < 0
      ? `On plan: ${days(-slip)} ahead of the baseline finish.`
      : 'On plan: the forecast finish matches the baseline finish.');
  } else {
    schedShort = 'No slip reading';
    schedSpoken = 'no slip reading';
    reasons.push(schedule == null ? NO_SCHEDULE_REASON : schedule === 'undated' ? UNDATED_REASON : NO_BASELINE_REASON);
  }
  // Overdue tasks are said, never turned into drift (a count is not days).
  if (schedule != null && schedule !== 'undated' && schedule.overdueCount > 0) {
    const n = schedule.overdueCount;
    reasons.push(n === 1 ? '1 task is past its deadline.' : `${n} tasks are past their deadline.`);
  }

  // ── Margin half ───────────────────────────────────────────────────────────
  const hasMargin = !marginWithheld && margin != null && margin.hasBasis;
  const tint: JobLevelTint = hasMargin ? tintForBand(margin!.band) : 'none';
  let marginShort: string;
  let marginSpoken: string;
  if (hasMargin) {
    const m = margin!;
    marginShort = `Margin risk: ${m.band}`;
    marginSpoken = `Margin risk: ${m.band}.`;
    const top = m.topFactors[0];
    reasons.push(top
      ? `Margin risk: ${m.band}. Biggest factor: ${endSentence(midSentence(top.label))} ${endSentence(top.detail)}`
      : `Margin risk: ${m.band}. No single factor stands out.`);
    if (m.costBasis !== 'all_sources') reasons.push(SUBS_ONLY_REASON);
  } else if (marginWithheld === 'loading') {
    marginShort = 'Margin loading';
    marginSpoken = 'Margin: still loading.';
    reasons.push(MARGIN_LOADING_REASON);
  } else if (marginWithheld === 'no_access') {
    marginShort = 'No margin reading';
    marginSpoken = 'Margin: not shown.';
    reasons.push(MARGIN_HIDDEN_REASON);
  } else {
    marginShort = 'No margin reading';
    marginSpoken = 'Margin: no reading.';
    reasons.push(NO_MARGIN_REASON);
  }

  // ── Kind, label, key ──────────────────────────────────────────────────────
  const kind: JobLevelKind = hasSchedule && hasMargin ? 'reading' : hasSchedule || hasMargin ? 'partial' : 'no_data';
  let label: string;
  let accessibilityLabel: string;
  if (kind === 'no_data') {
    // A reading that is only waiting on the cost streams is not "no data".
    label = marginWithheld === 'loading' ? 'Loading margin…' : NOT_ENOUGH_DATA;
    accessibilityLabel = marginWithheld === 'loading'
      ? 'Project health: loading margin.'
      : 'Project health: not enough data yet.';
  } else {
    label = `${schedShort} · ${marginShort}`;
    accessibilityLabel = `Schedule: ${schedSpoken}. ${marginSpoken}`;
  }
  const key = `${kind}|${hasSchedule ? offset.toFixed(3) : 'x'}|${tint}`;

  // ── Site counts: said after both halves, never drawn ───────────────────────
  reasons.push(...siteReasons(input.site));

  return { kind, offset, tint, hasSchedule, hasMargin, label, accessibilityLabel, reasons, key };
}

/** A usable count: a finite whole number above zero, else 0 (negative / NaN add nothing). */
const count = (n: number | null | undefined): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** The site reasons, one full sentence per count above zero. */
export function siteReasons(site: JobLevelSite | null | undefined): string[] {
  if (!site) return [];
  const out: string[] = [];
  const punch = count(site.openPunch);
  const rfis = count(site.overdueRfis);
  if (punch > 0) out.push(punch === 1 ? '1 punch item is open.' : `${punch} punch items are open.`);
  if (rfis > 0) out.push(rfis === 1 ? '1 RFI is past its due date.' : `${rfis} RFIs are past their due date.`);
  return out;
}

/** The margin half from a MarginRiskScore-shaped value (null passes through). */
export function marginForLevel(risk: {
  hasBasis: boolean; band: RiskBand; score: number; costBasis?: MarginCostBasis;
  topFactors: readonly { label: string; detail: string }[];
} | null | undefined): JobLevelMargin | null {
  if (!risk) return null;
  return {
    hasBasis: risk.hasBasis,
    band: risk.band,
    score: risk.score,
    costBasis: risk.costBasis,
    topFactors: risk.topFactors.map((f) => ({ label: f.label, detail: f.detail })),
  };
}

// ── The hub's reading, from the job page's one pulse ────────────────────────
//
// app/project-detail reads the job once (hooks/useProjectPulse) and hands that
// pulse to ProjectHero, the desktop KPI strip and the Level card. The margin
// half here uses the PULSE's risk — the very object ProjectHero prints as its
// "Margin risk" band — so the hub's colour and the hero's band are one number.

/** The fields of a ProjectPulse the Level reads (a structural subset; no import). */
export interface JobLevelPulseFacts {
  canSeeMoney: boolean;
  roleLoading: boolean;
  costSourcesReady: boolean;
  risk: {
    hasBasis: boolean; band: RiskBand; score: number; costBasis?: MarginCostBasis;
    topFactors: readonly { label: string; detail: string }[];
  } | null;
  openPunch: number;
  overdueRfis: number;
}

/**
 * The hub reading. Margin, in order: the role still resolving → 'loading';
 * a role that may not see money → 'no_access'; the cost streams not read yet
 * → 'loading'; else the pulse's own risk. The site counts are listed only.
 */
export function jobLevelFromPulse(schedule: JobLevelInput['schedule'], f: JobLevelPulseFacts): JobLevelReading {
  const site: JobLevelSite = { openPunch: f.openPunch, overdueRfis: f.overdueRfis };
  if (!f.canSeeMoney && f.roleLoading) return computeJobLevel({ schedule, margin: null, marginWithheld: 'loading', site });
  if (!f.canSeeMoney) return computeJobLevel({ schedule, margin: null, marginWithheld: 'no_access', site });
  if (!f.costSourcesReady) return computeJobLevel({ schedule, margin: null, marginWithheld: 'loading', site });
  return computeJobLevel({ schedule, margin: marginForLevel(f.risk), site });
}

// ── The legend ──────────────────────────────────────────────────────────────
//
// What every Level's sheet says about how to read it (components/level/
// JobLevelReason renders all four through t(); the hub card renders the first
// two). The keys are office.projectHealth.legend.<id>; the English here is the
// t() fallback text, pinned equal by scripts/validate-job-level.ts.
// The colour line names no colour words: the accent follows the company's
// theme preset (Settings), so "green" would be false for anyone who picked
// another hue.

export type JobLevelLegendId = 'bubble' | 'colour' | 'listed' | 'empty';

export const JOB_LEVEL_LEGEND: readonly { id: JobLevelLegendId; text: string }[] = [
  { id: 'bubble', text: 'The bubble moves right when the finish slips past the baseline.' },
  { id: 'colour', text: 'The colour is margin risk.' },
  { id: 'listed', text: 'Open punch, late RFIs and late tasks are listed, not drawn.' },
  { id: 'empty', text: 'A grey, hollow level means there is not enough data yet.' },
];

/**
 * The Health column's sort value: ascending = worst first (like Schedule).
 * Severity = drift + the tint's weight; no data sorts last (null).
 */
export function jobLevelSortValue(r: JobLevelReading | null | undefined): number | null {
  if (!r || r.kind === 'no_data') return null;
  const tintWeight = r.tint === 'risk' ? 1 : r.tint === 'watch' ? 0.5 : 0;
  return -Math.round((r.offset + tintWeight) * 1000) / 1000;
}

// ── The desktop portfolio's Health column ───────────────────────────────────
//
// It is not one of utils/portfolio/portfolioRow's spec columns (that file and
// its validator belong to another lane), so its budget lives here. WIDTH 64 =
// the "Health" header (caption1, ≈ 6 × 7 px) inside 2 × 10 px of cell padding,
// and a 40 pt Level. HIDE BELOW: it shows only where Job still keeps its
// 160 px with it — the % column's threshold plus its own width. Every
// portfolio threshold leaves ZERO slack at the width it opens (657, 773, 857,
// 921), and from 921 up the slack never drops under 119 px again (1200 → 119,
// 1320 → 127), so any Health width ≤ 119 placed at HIDE.pct + width fits at
// every table width. scripts/validate-job-level.ts sweeps 0–2600 to prove it.

export const JOB_LEVEL_COLUMN_ID = 'health';
export const JOB_LEVEL_COLUMN_WIDTH = 64;
export const JOB_LEVEL_COLUMN_HIDE_BELOW = PORTFOLIO_HIDE_BELOW.pct + JOB_LEVEL_COLUMN_WIDTH;
/** The drawn Level width in a row (the column's inner 44 px, less 4). */
export const JOB_LEVEL_ROW_SIZE = 40;
export const JOB_LEVEL_DETAIL_SIZE = 120;
