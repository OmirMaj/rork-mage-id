// marginAlerts.ts — the margin train, but it taps you on the shoulder.
//
// Living Estimate (utils/livingEstimate) and Margin Risk (utils/marginRiskScore)
// compute, on demand, how each job's margin is doing. The Portfolio Margin Board
// ranks them. But all three are PULL surfaces — they only tell you the truth when
// you remember to open them. The job that quietly slid from "watch" to "losing
// money" on a Tuesday doesn't announce itself.
//
// This module is the PUSH half. It compares each active job's margin state now
// against a stored baseline (what the user last acknowledged) and emits an alert
// only when something materially CROSSED — a risk band stepped up, margin health
// degraded, projected profit went negative, or erosion deepened past a point
// threshold. Recoveries are surfaced too (as info) so the loop closes both ways.
//
// Pure functions, no storage and no network. The screen (app/margin-alerts) owns
// the baseline persistence; the manager (components/MarginAlertManager) owns the
// local-notification fan-out. Both call into here so the logic lives in one place
// and stays testable.

import type { Project, ChangeOrder, Commitment, Invoice } from '@/types';
import { computeLivingEstimate, type MarginHealth } from '@/utils/livingEstimate';
import { computeMarginRisk, type RiskBand, riskBandLabel } from '@/utils/marginRiskScore';

export type AlertSeverity = 'critical' | 'high' | 'warning' | 'info';
export type AlertDirection = 'worsened' | 'recovered';
export type AlertKind = 'margin_negative' | 'risk_band' | 'health' | 'erosion';

export interface MarginAlert {
  /** Stable per crossing (`projectId:kind:step`) so a given transition notifies
   *  exactly once and survives re-evaluation until acknowledged. */
  id: string;
  projectId: string;
  projectName: string;
  kind: AlertKind;
  direction: AlertDirection;
  severity: AlertSeverity;
  title: string;
  detail: string;
  // Current metrics, carried for the card so the UI needs no second compute.
  score: number;
  band: RiskBand;
  marginPct: number;
  erosionPoints: number;
  asOf: string;
}

/** The per-project snapshot we persist to detect the next transition. */
export interface MarginBaseline {
  projectId: string;
  health: MarginHealth;
  band: RiskBand;
  score: number;
  /** projected.marginPct (0–1), can be negative when underwater. */
  marginPct: number;
  /** marginErosionPoints — negative means margin eroded off the bid. */
  erosionPoints: number;
  /** Deepest erosion step crossed (see EROSION_STEPS). */
  erosionStep: number;
  asOf: string;
}

export type BaselineMap = Record<string, MarginBaseline>;

/** What the user last acknowledged — alerts are diffed against this. */
export const MARGIN_ALERTS_BASELINE_KEY = 'mageid_margin_alerts_baseline';
/** Alert ids already pushed as a local notification (so each fires once). */
export const MARGIN_ALERTS_NOTIFIED_KEY = 'mageid_margin_alerts_notified';

export interface PortfolioInput {
  projects: Project[];
  changeOrders: ChangeOrder[];
  commitments: Commitment[];
  invoices: Invoice[];
}

const HEALTH_RANK: Record<MarginHealth, number> = { healthy: 0, watch: 1, critical: 2 };
const BAND_RANK: Record<RiskBand, number> = { low: 0, moderate: 1, elevated: 2, high: 3 };
const SEV_RANK: Record<AlertSeverity, number> = { info: 0, warning: 1, high: 2, critical: 3 };

// Erosion thresholds in margin POINTS. Crossing into a deeper bucket is a fresh
// alert; staying inside the same bucket is not. Mirrors the Living Estimate's own
// health thresholds (2 pts = watch, 5 pts = critical) and adds an 8-pt "severe".
const EROSION_STEPS = [2, 5, 8] as const;

function erosionStepOf(erosionPoints: number): number {
  const mag = Math.max(0, -erosionPoints);
  let step = 0;
  for (const s of EROSION_STEPS) if (mag >= s) step = s;
  return step;
}

const isActive = (p: Project): boolean =>
  p.status === 'estimated' || p.status === 'in_progress';

function pct(r: number): string {
  return `${(r * 100).toFixed(1)}%`;
}

/**
 * Run the margin engines across every active job and reduce each to the compact
 * baseline we compare on. Projects without a real cost/markup estimate (no
 * margin basis) are skipped — there's nothing to alert on.
 */
export function computeCurrentBaselines(input: PortfolioInput): {
  baselines: BaselineMap;
  names: Record<string, string>;
} {
  const { projects, changeOrders, commitments, invoices } = input;
  const baselines: BaselineMap = {};
  const names: Record<string, string> = {};

  for (const project of projects) {
    if (!isActive(project)) continue;
    const le = computeLivingEstimate({ project, changeOrders, commitments, invoices });
    if (!le.hasMarginBasis) continue;
    const risk = computeMarginRisk({ project, changeOrders, commitments, invoices });
    baselines[project.id] = {
      projectId: project.id,
      health: le.health,
      band: risk.band,
      score: risk.score,
      marginPct: le.projected.marginPct,
      erosionPoints: le.marginErosionPoints,
      erosionStep: erosionStepOf(le.marginErosionPoints),
      asOf: le.asOf,
    };
    names[project.id] = project.name;
  }

  return { baselines, names };
}

function makeAlert(
  cur: MarginBaseline,
  name: string,
  kind: AlertKind,
  step: string,
  direction: AlertDirection,
  severity: AlertSeverity,
  title: string,
  detail: string,
): MarginAlert {
  return {
    id: `${cur.projectId}:${kind}:${step}`,
    projectId: cur.projectId,
    projectName: name,
    kind,
    direction,
    severity,
    title,
    detail,
    score: cur.score,
    band: cur.band,
    marginPct: cur.marginPct,
    erosionPoints: cur.erosionPoints,
    asOf: cur.asOf,
  };
}

/**
 * All candidate transitions for one project between `prev` (may be undefined on
 * first-ever sight) and `cur`. Multiple can fire for one job; the caller picks.
 *
 * First-sight rule: with no baseline we DON'T flood the inbox with the whole
 * portfolio. We only raise a job that is already in a genuinely bad state
 * (underwater, elevated+ risk, or critical health) so the first open is signal,
 * not noise.
 */
function candidatesFor(
  prev: MarginBaseline | undefined,
  cur: MarginBaseline,
  name: string,
): MarginAlert[] {
  const out: MarginAlert[] = [];
  const firstSight = !prev;

  // 1 — Projected to lose money (margin crossed below zero).
  const wasNeg = prev ? prev.marginPct < 0 : false;
  const isNeg = cur.marginPct < 0;
  if (isNeg && !wasNeg) {
    out.push(makeAlert(cur, name, 'margin_negative', 'neg', 'worsened', 'critical',
      `${name} is projected to lose money`,
      `Projected margin is ${pct(cur.marginPct)} — costs now exceed the contract. Act before more cost posts.`));
  } else if (!isNeg && wasNeg) {
    out.push(makeAlert(cur, name, 'margin_negative', 'pos', 'recovered', 'info',
      `${name} is back above breakeven`,
      `Projected margin recovered to ${pct(cur.marginPct)}.`));
  }

  // 2 — Risk band stepped up (or first-sight already elevated+).
  if (firstSight) {
    if (BAND_RANK[cur.band] >= BAND_RANK.elevated) {
      out.push(makeAlert(cur, name, 'risk_band', cur.band, 'worsened',
        cur.band === 'high' ? 'high' : 'warning',
        `${name} is at ${riskBandLabel(cur.band).toLowerCase()}`,
        `Margin risk score ${cur.score}/100. Open it to see the top drivers.`));
    }
  } else if (BAND_RANK[cur.band] > BAND_RANK[prev.band]) {
    out.push(makeAlert(cur, name, 'risk_band', cur.band, 'worsened',
      cur.band === 'high' ? 'high' : 'warning',
      `${name} risk rose to ${riskBandLabel(cur.band).toLowerCase()}`,
      `Margin risk climbed from ${prev.score} to ${cur.score}/100.`));
  } else if (BAND_RANK[cur.band] < BAND_RANK[prev.band] && BAND_RANK[prev.band] >= BAND_RANK.elevated) {
    out.push(makeAlert(cur, name, 'risk_band', cur.band, 'recovered', 'info',
      `${name} risk eased to ${riskBandLabel(cur.band).toLowerCase()}`,
      `Margin risk fell from ${prev.score} to ${cur.score}/100.`));
  }

  // 3 — Margin health degraded (healthy → watch → critical). On first sight we
  // only raise an already-critical job, and only if margin_negative didn't
  // already cover it (negative margin always classifies as critical health).
  if (firstSight) {
    if (cur.health === 'critical' && !isNeg) {
      out.push(makeAlert(cur, name, 'health', cur.health, 'worsened', 'high',
        `${name} margin health is critical`,
        `Projected margin has slipped well off the bid. Trace the biggest variance now.`));
    }
  } else if (HEALTH_RANK[cur.health] > HEALTH_RANK[prev.health]) {
    out.push(makeAlert(cur, name, 'health', cur.health, 'worsened',
      cur.health === 'critical' ? 'high' : 'warning',
      `${name} margin health → ${cur.health}`,
      cur.health === 'critical'
        ? 'Margin has degraded to critical. This job needs attention this week.'
        : 'Margin slipped onto the watch list. Keep an eye on buyout and COs.'));
  } else if (HEALTH_RANK[cur.health] < HEALTH_RANK[prev.health] && HEALTH_RANK[prev.health] >= HEALTH_RANK.watch) {
    out.push(makeAlert(cur, name, 'health', cur.health, 'recovered', 'info',
      `${name} margin health → ${cur.health}`,
      'Margin health improved.'));
  }

  // 4 — Erosion deepened past a point threshold.
  const prevStep = prev?.erosionStep ?? 0;
  if (cur.erosionStep > prevStep) {
    out.push(makeAlert(cur, name, 'erosion', String(cur.erosionStep), 'worsened',
      cur.erosionStep >= 5 ? 'high' : 'warning',
      `${name} margin down ${Math.abs(cur.erosionPoints).toFixed(1)} pts`,
      `Projected margin has now eroded past ${cur.erosionStep} points from the bid.`));
  }

  return out;
}

function rankAlert(a: MarginAlert): number {
  // Worsened before recovered; within that, by severity.
  const dir = a.direction === 'worsened' ? 1 : 0;
  return dir * 10 + SEV_RANK[a.severity];
}

// Kind priority for picking the single representative alert per job: a job going
// underwater shouldn't also spam a separate "health → critical" card.
const KIND_PRIORITY: Record<AlertKind, number> = {
  margin_negative: 3,
  health: 2,
  erosion: 1,
  risk_band: 0,
};

/**
 * One alert per project max — the most important transition — so the inbox reads
 * clean. Returns the full list sorted worst-first.
 */
export function computeAlerts(
  current: BaselineMap,
  names: Record<string, string>,
  previous: BaselineMap,
): MarginAlert[] {
  const alerts: MarginAlert[] = [];
  for (const id of Object.keys(current)) {
    const cands = candidatesFor(previous[id], current[id], names[id] ?? 'Project');
    if (cands.length === 0) continue;
    cands.sort(
      (a, b) =>
        rankAlert(b) - rankAlert(a) ||
        KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind],
    );
    alerts.push(cands[0]);
  }
  alerts.sort(
    (a, b) =>
      rankAlert(b) - rankAlert(a) ||
      Math.abs(b.erosionPoints) - Math.abs(a.erosionPoints) ||
      b.score - a.score,
  );
  return alerts;
}

export const alertSeverityRank = (s: AlertSeverity): number => SEV_RANK[s];

/** Count of worsening (actionable) alerts — what the unread badge should show. */
export function countActionable(alerts: MarginAlert[]): number {
  return alerts.filter(a => a.direction === 'worsened').length;
}

/** Worsening, high-or-critical alerts — the only ones worth an OS notification. */
export function selectNotifiable(alerts: MarginAlert[]): MarginAlert[] {
  return alerts.filter(
    a => a.direction === 'worsened' && (a.severity === 'critical' || a.severity === 'high'),
  );
}
