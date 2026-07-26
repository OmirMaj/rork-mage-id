// utils/brief/composeBrief.ts — the Morning Brief composer.
//
// Pure and deterministic: no AI call, no React, no storage, no network —
// runs under Bun for scripts/validate-compose-brief.ts. All async inputs
// (open leak flags from the prediction ledger, the cash-flow summary, the
// did-for-you ledger entries, the accuracy report) are loaded by the CALLER
// (hooks/useMorningBrief.ts) and passed in — the composer only arranges
// facts it was handed.
//
// VOICE (the hybrid rule): section lines are dense facts with no first
// person ("Invoice #12 is 21d overdue ($5,000)"). "I/my" appears ONLY in
// the brain-moment lines — the did-for-you ledger entries and the accuracy
// self-correction line — because those are the brain reporting on itself.
//
// Sections:
//   needsYou  — brainWatch attention items (the five G8 kinds) + the
//               summary-dashboard aggregate rollups (deduped against the
//               per-invoice brainWatch lines) + unconverted leak flags.
//   watching  — cash danger weeks, this week's task density, and active
//               projects with a reporting cadence that skipped yesterday.
//   didForYou — yesterday's mageid_brain_ledger entries, plus the accuracy
//               self-correction line when the graded ledger produced one.
//
// Honest empty state: when nothing needs the user and nothing is being
// watched, the surface says so ("Quiet morning — nothing needs you")
// instead of inflating noise.

import type {
  Project, Invoice, ChangeOrder, PunchItem, Permit, Certification,
  DailyFieldReport,
} from '@/types';
import {
  scheduleAttention, invoiceAttention, permitAttention, certAttention,
  closeoutAttention, rankAttention, type AttentionItem, type AttnSeverity,
} from '@/utils/brainWatch';
import { aggregateAttention, computeWeekLoad } from '@/utils/summaryBriefing';
import type { CashFlowSummary } from '@/utils/cashFlowEngine';
import type { DidForYouEntry } from '@/utils/brain/didForYou';
import type { AccuracyReport } from '@/utils/brain/accuracyReport';

// ─── Public types ────────────────────────────────────────────────────────────

/** AsyncStorage key holding the local date (YYYY-MM-DD) the brief was last
 *  opened/dismissed. Registered in LOCAL_USER_CACHE_KEYS (AuthContext, B0). */
export const BRIEF_LAST_SEEN_KEY = 'mageid_brief_last_seen';

export interface BriefRoute {
  pathname: string;
  params?: Record<string, string>;
}

export type BriefSeverity = AttnSeverity; // 'critical' | 'high' | 'medium'

export interface BriefItem {
  id: string;
  text: string;
  severity?: BriefSeverity;
  /** Where tapping the line lands (AttentionItem.route contract). */
  route?: BriefRoute;
}

export interface MorningBrief {
  /** Local calendar date the brief was composed for (YYYY-MM-DD). */
  dateISO: string;
  needsYou: BriefItem[];
  watching: BriefItem[];
  didForYou: BriefItem[];
}

export interface OpenLeakSummary {
  /** Unresolved leak_flag scans (one row per scanned report). */
  count: number;
  /** Sum of the flagged items' estimated prices across those scans. */
  estTotal: number;
}

export interface ComposeBriefInput {
  projects: Project[];
  invoices: Invoice[];
  changeOrders: ChangeOrder[];
  punchItems: PunchItem[];
  permits: Permit[];
  expiringCertifications: (Certification & { status: 'expiring' | 'expired' })[];
  dailyReports: DailyFieldReport[];
  /** From fetchOpenPredictionsDeduped(['leak_flag']). Pass null/undefined when
   *  the ledger read failed — the pure 14-day report-scan fallback kicks in. */
  openLeakFlags?: OpenLeakSummary | null;
  /** calculateSummary(...) output; null when cash flow isn't set up. */
  cashSummary?: CashFlowSummary | null;
  cashHorizonWeeks?: number;
  didForYouEntries: DidForYouEntry[];
  /** buildAccuracyReport over resolved ledger rows; null when unavailable. */
  accuracyReport?: AccuracyReport | null;
  now?: Date;
}

// ─── Small helpers ───────────────────────────────────────────────────────────

const NEEDS_YOU_CAP = 10;
const DID_FOR_YOU_CAP = 8;
const MS_DAY = 86_400_000;

/** Local calendar date (YYYY-MM-DD) — deliberately NOT toISOString(), which
 *  is UTC and flips the date for evening hours in negative-offset zones. */
export function localDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

/** Normalize a stored report/entry date to a LOCAL calendar date. Date-only
 *  strings ("2026-07-24") are taken verbatim (parsing them lands at UTC
 *  midnight and shifts a day west of Greenwich); full ISO timestamps go
 *  through Date so the user's local calendar decides which day it was. */
function toLocalDay(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (raw.length === 10) return raw;
  const t = new Date(raw);
  if (Number.isNaN(t.getTime())) return null;
  return localDateISO(t);
}

function fmtMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

const SEVERITY_RANK: Record<BriefSeverity, number> = { critical: 0, high: 1, medium: 2 };

function isActive(p: Project): boolean {
  return p.status !== 'closed' && p.status !== 'completed';
}

// ─── needsYou builders ───────────────────────────────────────────────────────

function collectBrainWatch(input: ComposeBriefInput, now: Date): AttentionItem[] {
  const nowMs = now.getTime();
  const all: AttentionItem[] = [];
  for (const project of input.projects) {
    if (!isActive(project)) continue;
    all.push(...scheduleAttention(project));
    all.push(...invoiceAttention(project, input.invoices, nowMs));
    all.push(...permitAttention(project, input.permits.filter(p => p.projectId === project.id), nowMs));
    all.push(...closeoutAttention(project));
  }
  all.push(...certAttention(input.expiringCertifications, nowMs));
  return rankAttention(all);
}

/** Pure fallback for the open-leak count when the prediction ledger is
 *  unreadable: leak scans riding daily reports from the last 14 days on
 *  active projects (LeakScanRecord is LOCAL-ONLY, so this is the same
 *  population the ledger captures — minus resolution state). */
export function fallbackOpenLeaks(
  dailyReports: DailyFieldReport[],
  projects: Project[],
  now: Date,
): OpenLeakSummary {
  const activeIds = new Set(projects.filter(isActive).map(p => p.id));
  const cutoffMs = now.getTime() - 14 * MS_DAY;
  let count = 0;
  let estTotal = 0;
  for (const r of dailyReports) {
    if (!activeIds.has(r.projectId)) continue;
    const scan = r.leakScan;
    if (!scan || scan.items.length === 0) continue;
    const scannedMs = Date.parse(scan.scannedAt ?? r.date);
    if (!Number.isFinite(scannedMs) || scannedMs < cutoffMs) continue;
    count += 1;
    for (const item of scan.items) estTotal += item.estimatedPrice ?? 0;
  }
  return { count, estTotal };
}

function buildLeakItem(leaks: OpenLeakSummary): BriefItem | null {
  if (leaks.count <= 0) return null;
  const scans = leaks.count === 1 ? '1 profit-leak scan' : `${leaks.count} profit-leak scans`;
  const verb = leaks.count === 1 ? "hasn't" : "haven't";
  const tail = leaks.estTotal > 0 ? ` (~${fmtMoney(leaks.estTotal)} of flagged extra work)` : '';
  return {
    id: 'open-leak-flags',
    text: `${scans} ${verb} turned into a change order yet${tail}`,
    severity: leaks.estTotal >= 1_000 ? 'high' : 'medium',
    route: { pathname: '/report-inbox' },
  };
}

function buildNeedsYou(input: ComposeBriefInput, now: Date): BriefItem[] {
  const watch = collectBrainWatch(input, now);
  const items: BriefItem[] = watch.map(i => ({
    id: i.id,
    text: i.message,
    severity: i.severity,
    route: i.route,
  }));

  // Aggregate rollups from the Summary dashboard, deduped against the
  // per-invoice brainWatch lines (plan: dedupe by kind — the rollup and the
  // per-invoice items describe the same overdue money).
  const hasInvoiceWatch = watch.some(i => i.kind === 'invoice');
  for (const a of aggregateAttention(input.projects, input.invoices, input.punchItems, input.changeOrders, now)) {
    if (a.id === 'overdue-invoices' && hasInvoiceWatch) continue;
    items.push({
      id: `agg-${a.id}`,
      text: a.label,
      severity: a.severity === 'danger' ? 'high' : 'medium',
      route: { pathname: a.route, params: a.params },
    });
  }

  // Unconverted leak flags — flagged extra work that never became a CO.
  const leaks = input.openLeakFlags ?? fallbackOpenLeaks(input.dailyReports, input.projects, now);
  const leakItem = buildLeakItem(leaks);
  if (leakItem) items.push(leakItem);

  // Stable severity sort (matches rankAttention semantics), then cap.
  return items
    .sort((a, b) => SEVERITY_RANK[a.severity ?? 'medium'] - SEVERITY_RANK[b.severity ?? 'medium'])
    .slice(0, NEEDS_YOU_CAP);
}

// ─── watching builders ───────────────────────────────────────────────────────

/** Active projects with a recent reporting cadence (≥2 reports in the 7 days
 *  before yesterday) that skipped yesterday. Pure over dailyReports. */
export function missingReportItems(
  projects: Project[],
  dailyReports: DailyFieldReport[],
  now: Date,
): BriefItem[] {
  const yesterday = localDateISO(shiftDays(now, -1));
  const windowStart = localDateISO(shiftDays(now, -9));
  const windowEnd = localDateISO(shiftDays(now, -2));
  const out: BriefItem[] = [];
  for (const p of projects) {
    if (p.status !== 'in_progress') continue;
    const reports = dailyReports.filter(r => r.projectId === p.id);
    if (reports.some(r => toLocalDay(r.date) === yesterday)) continue;
    const cadence = reports.filter(r => {
      const d = toLocalDay(r.date);
      return d != null && d >= windowStart && d <= windowEnd;
    }).length;
    if (cadence < 2) continue;
    out.push({
      id: `no-report-${p.id}`,
      text: `No daily report filed yesterday on ${p.name}`,
      severity: 'medium',
      route: { pathname: '/daily-report', params: { projectId: p.id } },
    });
  }
  return out;
}

function buildWatching(input: ComposeBriefInput, now: Date): BriefItem[] {
  const items: BriefItem[] = [];

  // Cash danger — straight from the cash-flow engine (G8: there is no
  // cashflow attention kind; the brief reads the engine's summary).
  const cash = input.cashSummary;
  if (cash && cash.dangerWeeks.length > 0) {
    const first = cash.dangerWeeks[0];
    const horizon = input.cashHorizonWeeks ?? 12;
    const more = cash.dangerWeeks.length > 1
      ? ` — ${cash.dangerWeeks.length} negative weeks in the ${horizon}-week forecast`
      : '';
    items.push({
      id: 'cash-danger',
      text: `Cash dips to ${fmtMoney(first.balance)} the week of ${first.weekDate}${more}`,
      severity: 'high',
      route: { pathname: '/cash-flow' },
    });
  }

  // This week's task density across active jobs.
  const load = computeWeekLoad(input.projects.filter(isActive), now);
  if (load.totalTasks > 0) {
    const busyDays = load.days.filter(d => d.count > 0).length;
    const peak = Math.max(...load.days.map(d => d.count));
    const milestones = load.milestoneCount > 0
      ? `, ${load.milestoneCount} milestone${load.milestoneCount === 1 ? '' : 's'} landing`
      : '';
    items.push({
      id: 'week-load',
      text: `Tasks running ${busyDays} of 7 days this week (peak ${peak} at once${milestones})`,
      severity: 'medium',
      route: { pathname: '/(tabs)/schedule' },
    });
  }

  items.push(...missingReportItems(input.projects, input.dailyReports, now));
  return items;
}

// ─── didForYou builders ──────────────────────────────────────────────────────

/** Yesterday's ledger entries, judged on the LOCAL calendar (an entry logged
 *  at 11:58pm belongs to that day even after toISOString() rolls it forward). */
export function yesterdayEntries(entries: DidForYouEntry[], now: Date): DidForYouEntry[] {
  const yesterday = localDateISO(shiftDays(now, -1));
  return entries.filter(e => {
    const t = new Date(e.at);
    return !Number.isNaN(t.getTime()) && localDateISO(t) === yesterday;
  });
}

const SELF_CORRECTION_RE = /recalibrat|adjusting|sharpen|over-budgeting/i;

/** The accuracy report's self-correction line, when the graded ledger
 *  produced one. All of accuracyReport.ts's corrective detail lines carry
 *  one of these markers; congratulatory details never do. */
export function selectSelfCorrectionLine(report: AccuracyReport | null | undefined): string | null {
  if (!report || !report.hasEnoughData) return null;
  for (const row of report.rows) {
    if (SELF_CORRECTION_RE.test(row.detail)) return row.detail;
  }
  return null;
}

function buildDidForYou(input: ComposeBriefInput, now: Date): BriefItem[] {
  const items: BriefItem[] = yesterdayEntries(input.didForYouEntries, now)
    .slice(0, DID_FOR_YOU_CAP)
    .map(e => ({
      id: e.id,
      text: e.text,
      route: e.projectId ? { pathname: '/project-detail', params: { id: e.projectId } } : undefined,
    }));

  const correction = selectSelfCorrectionLine(input.accuracyReport);
  if (correction) {
    items.push({
      id: 'brain-self-correction',
      text: correction,
      route: { pathname: '/cost-database' },
    });
  }
  return items;
}

// ─── Compose ─────────────────────────────────────────────────────────────────

export function composeBrief(input: ComposeBriefInput): MorningBrief {
  const now = input.now ?? new Date();
  return {
    dateISO: localDateISO(now),
    needsYou: buildNeedsYou(input, now),
    watching: buildWatching(input, now),
    didForYou: buildDidForYou(input, now),
  };
}

/** Nothing needs the user and nothing is being watched. */
export function briefIsQuiet(brief: MorningBrief): boolean {
  return brief.needsYou.length === 0 && brief.watching.length === 0;
}

/** Quiet AND the brain has nothing to report on itself. */
export function briefIsEmpty(brief: MorningBrief): boolean {
  return briefIsQuiet(brief) && brief.didForYou.length === 0;
}

export const QUIET_MORNING_LINE = 'Quiet morning — nothing needs you';

/** One-line rollup for the home card: "3 need you · 2 watching · brain did
 *  4 things". Zero segments are dropped; a fully empty brief reads the
 *  honest quiet line instead. */
export function briefSummaryLine(brief: MorningBrief): string {
  if (briefIsEmpty(brief)) return QUIET_MORNING_LINE;
  const parts: string[] = [];
  if (brief.needsYou.length > 0) {
    parts.push(`${brief.needsYou.length} need${brief.needsYou.length === 1 ? 's' : ''} you`);
  }
  if (brief.watching.length > 0) parts.push(`${brief.watching.length} watching`);
  if (brief.didForYou.length > 0) {
    parts.push(`brain did ${brief.didForYou.length} thing${brief.didForYou.length === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}
