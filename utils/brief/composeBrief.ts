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
// watched, the surface says so — but only about what it read. The line used
// to be "Quiet morning — nothing needs you" over a scan with no RFI, no
// submittal and no permit-expiry category in it; see QUIET_MORNING_LINE and
// BriefScope for the sentence it became and why.

import type {
  Project, Invoice, ChangeOrder, PunchItem, Permit, Certification,
  DailyFieldReport, RFI, Submittal,
} from '@/types';
import {
  scheduleAttention, invoiceAttention, permitAttention, certAttention,
  deliveryAttention, buildingAccessAttention, rfiAttention, submittalAttention,
  closeoutAttention, rankAttention, type AttentionItem, type AttnSeverity,
} from '@/utils/brainWatch';
import type { Delivery } from '@/utils/deliverySchedule';
import type { BuildingAccessRules, AccessReservation } from '@/utils/buildingAccess';
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
  /**
   * True for FYI/reminder lines (e.g. the week-close "draft a client update"
   * link) that are not open work: excluded from allQuiet and from open-leg
   * counts so an evergreen reminder can never cry wolf.
   */
  informational?: boolean;
}

/**
 * What this brief actually looked at, and what it did not.
 *
 * BRIEF-SCOPE (polish audit 2026-09-10, dead-ends P0 #3 / empty-states P0 #1).
 * The quiet state used to read "Nothing overdue, nothing at risk, nothing
 * waiting on you. Go build." — three checked negatives — and it rendered BYTE
 * IDENTICALLY (129 characters) in a brand-new account and in a seeded one
 * holding an RFI 23 days past due to the architect, a lapsed electrical permit
 * and a job the margin engine calls critical. Three total claims from a partial
 * scan. The composer cannot be made omniscient (nothing here reads the job-cost
 * engine, and see the `unchecked` note below for why that is deliberate), so
 * the sentence has to name its own evidence instead.
 *
 * Recorded by the composer rather than written by hand next to the copy, so the
 * sentence widens on its own the day a source is wired in and cannot drift back
 * into a claim the scan does not support.
 */
export interface BriefScope {
  /** Domains this brief read, in the words a contractor uses. Safe to assert on. */
  checked: string[];
  /** Domains it did NOT read. Named in the quiet line so the reader knows where
   *  the rest of the answer lives, instead of assuming there isn't one. */
  unchecked: string[];
}

export interface MorningBrief {
  /** Local calendar date the brief was composed for (YYYY-MM-DD). */
  dateISO: string;
  needsYou: BriefItem[];
  watching: BriefItem[];
  didForYou: BriefItem[];
  /** The evidence behind a quiet verdict — see BriefScope. */
  scope: BriefScope;
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
  /** Scheduled/expected loads. Late or unconfirmed ones become brief items —
   *  material that does not land shows up as idle LABOUR, not as a late PO. */
  deliveries: Delivery[];
  /** What the building requires (one row per project) and the slots booked
   *  from it. A load with a confirmed date and no freight elevator booked is
   *  not a delivery problem — the truck is simply turned away. */
  buildingAccessRules: BuildingAccessRules[];
  accessReservations: AccessReservation[];
  expiringCertifications: (Certification & { status: 'expiring' | 'expired' })[];
  /**
   * Open RFIs and in-review submittals — the "someone else is holding your job
   * up" half of the brief, and the half it was structurally blind to.
   *
   * OPTIONAL on purpose, and the optionality is load-bearing: `undefined` means
   * "this caller did not hand me RFIs", which drops 'RFIs' out of
   * BriefScope.checked and into `unchecked`, so the quiet line stops claiming
   * them. An empty ARRAY means "I looked and there are none" and keeps the
   * claim. A caller that forgets to pass them therefore under-claims rather
   * than lying, which is the only failure mode worth having here.
   */
  rfis?: RFI[];
  submittals?: Submittal[];
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
    all.push(...deliveryAttention(project, input.deliveries.filter(d => d.projectId === project.id), nowMs));
    all.push(...buildingAccessAttention(
      project,
      input.buildingAccessRules.find(r => r.projectId === project.id) ?? null,
      input.accessReservations,
      input.deliveries,
      nowMs,
    ));
    // Only when the caller handed them over — see the ComposeBriefInput note.
    if (input.rfis) all.push(...rfiAttention(project, input.rfis.filter(r => r.projectId === project.id), nowMs));
    if (input.submittals) all.push(...submittalAttention(project, input.submittals.filter(s => s.projectId === project.id), nowMs));
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
    route: { pathname: '/profit-leak-history' },
  };
}

/** The aggregate rollup's own overdue population (summaryBriefing's exact
 *  predicate): any non-paid, non-draft invoice past due — ALL projects, no
 *  grace window. Wider than the per-invoice brainWatch lines, which only
 *  cover ACTIVE projects and >7-day overdues. */
function countAggregateOverdueInvoices(invoices: Invoice[], nowMs: number): number {
  return invoices.filter(
    i => i.status !== 'paid' && i.status !== 'draft' && i.dueDate && new Date(i.dueDate).getTime() < nowMs,
  ).length;
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
  // per-invoice brainWatch lines — but only when those lines cover the
  // rollup's ENTIRE population. The rollup's scope is wider (all projects,
  // no 7-day grace), so kind-level suppression made receivables on
  // completed/closed projects and 1–7-day overdues vanish from the brief
  // whenever any single >7-day invoice was itemized (tribunal fix). The
  // per-invoice population is a strict subset of the rollup's, so a plain
  // count comparison decides coverage.
  const watchInvoiceCount = watch.filter(i => i.kind === 'invoice').length;
  const aggregateOverdueCount = countAggregateOverdueInvoices(input.invoices, now.getTime());
  for (const a of aggregateAttention(input.projects, input.invoices, input.punchItems, input.changeOrders, now)) {
    if (a.id === 'overdue-invoices' && watchInvoiceCount >= aggregateOverdueCount) continue;
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

// ─── Scope ───────────────────────────────────────────────────────────────────

/**
 * What the composer read, derived from the input it was actually handed.
 *
 * Every entry in `checked` corresponds to a builder called above: schedules
 * (scheduleAttention), invoices (invoiceAttention + the aggregate overdue
 * rollup), permits (permitAttention — inspections AND expiry since
 * PERMIT-EXPIRY), certs (certAttention), deliveries + building access, closeouts,
 * and — when passed — RFIs and submittals.
 *
 * `unchecked` names MARGIN unconditionally, and that is a decision rather than a
 * gap left for later. The margin verdict the rest of the app shows is, on the
 * audited account, a double count: utils/jobCostEngine.ts buckets an estimate's
 * budget by `item.category` ('subcontractor') and a commitment by `c.phase`
 * ('Electrical'), matches the two exactly and case-sensitively, and so adds
 * $42,200 of awarded buyout on top of the $131,502 estimate that already priced
 * it — which is where /margin-alerts' "projected to lose money" and /reports'
 * "-$18,530" come from on a job carrying real margin. Importing that number here
 * would swap a false green for a false red on the app's most trusted surface.
 * The brief points at the screen instead, and picks margin up when the engine is
 * fixed (see the verifier's REFUTED #2 / MISSED #1 in
 * docs/audits/2026-09-10-polish-audit-rendered.md).
 */
export function briefScope(input: ComposeBriefInput): BriefScope {
  // The six below are unconditional because their inputs are REQUIRED on
  // ComposeBriefInput — you cannot compose a brief without handing over
  // permits, and an empty array there means "looked, none". Only rfis and
  // submittals are optional, so only they can be missing rather than empty,
  // which is why only they are asked about. Any future OPTIONAL input has to
  // join them below or this sentence starts claiming a source again.
  const checked = ['schedules', 'invoices', 'permits', 'certs', 'deliveries', 'closeouts'];
  const unchecked: string[] = [];
  (input.rfis ? checked : unchecked).push('RFIs');
  (input.submittals ? checked : unchecked).push('submittals');
  unchecked.push('job margin');
  return { checked, unchecked };
}

/** "a, b and c" — an Oxford-less list, because these render inside a sentence. */
function joinWords(words: string[]): string {
  if (words.length === 0) return '';
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Where the answer this brief did not look for actually lives. Keyed by the
 *  exact strings briefScope puts in `unchecked`. */
const WHERE_UNCHECKED_LIVES: Record<string, string> = {
  RFIs: 'Waiting On',
  submittals: 'Waiting On',
  'job margin': 'Margin Alerts',
};

/**
 * The sentence the /brief screen shows when there is nothing to report — the
 * one that used to read "Nothing overdue, nothing at risk, nothing waiting on
 * you. Go build." on an account with a 23-day-late RFI.
 *
 * Built from BriefScope, so it states its evidence and names where the rest of
 * the answer lives. Deliberately not cheerful: "Go build" was the app sending a
 * contractor onto site on a day he needed to make two phone calls.
 */
export function quietBriefDetail(brief: MorningBrief): string {
  const { checked, unchecked } = brief.scope;
  const first = `Nothing overdue in ${joinWords(checked)}.`;
  if (unchecked.length === 0) return first;
  // The pointer is derived from what is actually unchecked, not written under
  // it. Hardcoded, it read "see Margin Alerts and Waiting On for those" — which
  // is right today and becomes wrong the moment hooks/useMorningBrief.ts passes
  // rfis, because then the only unchecked domain is margin and the sentence
  // would still be sending the reader to Waiting On for it. A sentence that
  // widens on its own has to carry its own directions.
  const screens: string[] = [];
  for (const domain of unchecked) {
    const screen = WHERE_UNCHECKED_LIVES[domain];
    if (screen && !screens.includes(screen)) screens.push(screen);
  }
  const tail = screens.length > 0 ? ` — see ${joinWords(screens)} for ${unchecked.length === 1 ? 'that' : 'those'}` : '';
  return `${first} Not checked here: ${joinWords(unchecked)}${tail}.`;
}


// ─── Compose ─────────────────────────────────────────────────────────────────

export function composeBrief(input: ComposeBriefInput): MorningBrief {
  const now = input.now ?? new Date();
  return {
    dateISO: localDateISO(now),
    needsYou: buildNeedsYou(input, now),
    watching: buildWatching(input, now),
    didForYou: buildDidForYou(input, now),
    scope: briefScope(input),
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

/**
 * The one-line quiet verdict, shown on the pinned home card
 * (components/home/MorningBriefCard.tsx renders briefSummaryLine at one line)
 * and as the /brief headline.
 *
 * It used to be "Quiet morning — nothing needs you", which is a TOTAL claim,
 * and the populated home screen printed it four nodes above "RFI #2 past due ·
 * 23d". One line has no room to list eight domains, so it hedges to exactly
 * what it can support and the screen it opens carries the list
 * (quietBriefDetail). No first person: the VOICE rule at the top of this file
 * reserves "I" for the brain's own did-for-you lines.
 */
export const QUIET_MORNING_LINE = 'Quiet morning — nothing overdue in what was checked';

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
