// utils/projectWorkspaceLayout.ts — the rules of the desktop job page.
//
// PURE: no React, no react-native. Everything imported from an RN-bound module
// is `import type` (erased), so scripts/validate-project-workspace.ts runs this
// file under bun.
//
// WHY THIS EXISTS (wave 6c, lane E). On the founder's 1512 x 945 MacBook the
// job page measured 3.1 screens tall: 675 px of quick-action tiles with a
// 1,360 px orphan, a 1,314 px "Total Estimate" box, two different "% complete"
// numbers, and sections that opened as a full-window sheet which dropped him
// back on the tile grid the moment he opened a record. The desktop workspace
// is one screen: a header, an 8-cell KPI strip, one row of quick actions,
// three overview cards, an index of every section, and sections in a
// right-docked side panel with ?tile= in the URL. This file holds the parts of
// that which are decisions, not drawing — so they can be tested.

import type { Href, Route } from 'expo-router';
import type { ChangeOrder, ScheduleTask } from '@/types';
import type { KpiCell, KpiTone } from '@/components/desktop/KpiStrip';
import type { LivingEstimateSnapshot } from '@/utils/livingEstimate';
import type { MarginRiskScore } from '@/utils/marginRiskScore';
import type { ProjectProgress } from '@/utils/projectProgress';
import type { ContractSumSource } from '@/utils/projectFinancials';
import type { ARAgingReport } from '@/utils/financialReports';
import { riskBandLabel } from '@/utils/marginRiskScore';
import { formatMoney, formatMoneyShort } from '@/utils/formatters';
import { buildScheduledStartDays, taskWindow, type TaskWindowCalendar } from '@/utils/lastPlanner';

// ─────────────────────────────────────────────────────────────────────────────
// Where each section opens on desktop
// ─────────────────────────────────────────────────────────────────────────────

/** Sections whose body is drawn in the desktop side panel (the in-page
 *  sections that have no screen of their own). Until their log lane ships
 *  (wave 6c G) RFIs, submittals, change orders and invoices are drawn here
 *  too — today's section bodies, not a blank create form. */
export const PANEL_SECTION_KEYS = [
  'linkedEstimate', 'schedule', 'collaborators', 'budget', 'photos', 'clientPortal', 'communications', 'aiReport',
  'rfis', 'submittals', 'changeOrders', 'invoices',
] as const;
export type PanelSectionKey = typeof PANEL_SECTION_KEYS[number];

/**
 * Sections that are a LOG with its own screen on desktop web (the wave-6c G
 * lanes: RFIs, submittals, change orders, invoices; H: daily reports; the
 * punch list already is one). A tile in this map opens the log instead of the
 * side panel, so opening a record and pressing Back returns to the job page.
 *
 * THE SWITCH for that contract: if a log lane is cut, delete its key here and
 * add it to PANEL_SECTION_KEYS — the tile, the index row, the KPI cells and
 * the overview rows then open the section in the side panel.
 */
export const LIST_SECTION_ROUTES = {
  dailyReports: '/daily-report',
  punchList: '/punch-list',
} as const satisfies Readonly<Partial<Record<LogSectionKey, Route>>>;
export type ListSectionKey = keyof typeof LIST_SECTION_ROUTES;

/**
 * Every section that is a log SOMEWHERE: its own screen on desktop web when
 * LIST_SECTION_ROUTES lists it, the side panel when it does not (a log lane
 * that has not shipped). The KPI strip and the overview cards point at these,
 * so deleting a key from LIST_SECTION_ROUTES re-routes them in place too.
 */
export type LogSectionKey = 'rfis' | 'submittals' | 'changeOrders' | 'invoices' | 'dailyReports' | 'punchList';

export function isPanelSection(key: string | null | undefined): key is PanelSectionKey {
  return typeof key === 'string' && (PANEL_SECTION_KEYS as readonly string[]).includes(key);
}

export function isListSection(key: string | null | undefined): key is ListSectionKey {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(LIST_SECTION_ROUTES, key);
}

/** The route a list section opens, or null. */
export function listSectionRoute(key: string | null | undefined): Route | null {
  return isListSection(key) ? LIST_SECTION_ROUTES[key] : null;
}

/**
 * The section sheet's title — lifted verbatim from the phone Modal header's
 * ternary (app/project-detail.tsx), plus the desktop-only AI report.
 */
export const SECTION_TITLES: Readonly<Record<string, string>> = {
  linkedEstimate: 'Estimate Items',
  schedule: 'Schedule',
  materials: 'Materials',
  labor: 'Labor',
  summary: 'Cost Summary',
  notes: 'Tips & Notes',
  collaborators: 'Team',
  changeOrders: 'Change Orders',
  invoices: 'Invoices',
  dailyReports: 'Daily Reports',
  punchList: 'Punch List',
  rfis: 'RFIs',
  submittals: 'Submittals',
  budget: 'Financial Health',
  photos: 'Photos',
  clientPortal: 'Client Portal',
  communications: 'Communications',
  aiReport: 'AI Project Report',
};

/** '' for an unknown key or none — exactly what the phone ternary printed. */
export function sectionTitle(key: string | null | undefined): string {
  if (!key) return '';
  return Object.prototype.hasOwnProperty.call(SECTION_TITLES, key) ? SECTION_TITLES[key] : '';
}

/** The one place a route-checked pathname becomes an Href (see
 *  components/desktop/RowLink routeHref — duplicated here only because that
 *  module is RN-bound). */
export function workspaceHref(pathname: Route, params?: Record<string, string>): Href {
  return (params ? { pathname, params } : { pathname }) as Href;
}

/**
 * The tiles that already LEAVE the job page, and where to (the screen's
 * pressTile push chain, app/project-detail.tsx). The desktop section index
 * draws these as real links (Cmd-click → new tab), so it needs the target
 * as data; scripts/validate-project-workspace.ts checks every entry against
 * the chain's own `router.push({ pathname: '…'` so the two cannot drift.
 * `param` is the name the target screen reads the job from.
 */
export const LEGACY_TILE_ROUTES = {
  activity: { pathname: '/activity-feed', param: 'projectId' },
  plans: { pathname: '/plans', param: 'projectId' },
  permits: { pathname: '/permits', param: 'projectId' },
  contract: { pathname: '/contract', param: 'projectId' },
  selections: { pathname: '/selections', param: 'projectId' },
  lienWaivers: { pathname: '/lien-waivers', param: 'projectId' },
  closeoutBinder: { pathname: '/closeout-binder', param: 'projectId' },
  handover: { pathname: '/handover', param: 'projectId' },
  oacMeetings: { pathname: '/oac-meeting', param: 'projectId' },
  safety: { pathname: '/safety', param: 'projectId' },
  timeTracking: { pathname: '/time-tracking', param: 'projectId' },
  fieldTickets: { pathname: '/field-ticket', param: 'projectId' },
  deliveries: { pathname: '/deliveries', param: 'projectId' },
  projectFiles: { pathname: '/project-files', param: 'projectId' },
  scope: { pathname: '/project-scope', param: 'id' },
} as const satisfies Readonly<Record<string, { pathname: Route; param: 'projectId' | 'id' }>>;
export type LegacyTileKey = keyof typeof LEGACY_TILE_ROUTES;

/**
 * The link a section-index row carries, or null when the row is a button
 * (a side-panel section, or Calendar Feed, which exports a file).
 *
 * `listLinks` is desktop WEB: the log screens (lanes G/H) are list-first only
 * in a browser. Elsewhere — a native tablet wide enough for the desktop
 * layout — `/rfi?projectId=…` is the phone's new-RFI form, so a list section
 * opens in the side panel instead of pretending to be its log.
 */
export function sectionIndexHref(key: string, projectId: string, listLinks: boolean): Href | null {
  const list = listSectionRoute(key);
  if (list) return listLinks ? workspaceHref(list, { projectId }) : null;
  if (Object.prototype.hasOwnProperty.call(LEGACY_TILE_ROUTES, key)) {
    const r = LEGACY_TILE_ROUTES[key as LegacyTileKey];
    return workspaceHref(r.pathname, { [r.param]: projectId });
  }
  return null;
}

export type DesktopTileTarget =
  | { kind: 'panel' }
  | { kind: 'route'; pathname: Route; params: { projectId: string } }
  | { kind: 'legacy' };

/**
 * What a section tile does on desktop web: open a log, open the side panel, or
 * run the existing push chain ('legacy': the tiles that already leave the job
 * page — Plans, Permits, Contract… — and Calendar, which exports a file).
 */
export function desktopTileTarget(key: string, projectId: string): DesktopTileTarget {
  const route = listSectionRoute(key);
  if (route) return { kind: 'route', pathname: route, params: { projectId } };
  if (isPanelSection(key)) return { kind: 'panel' };
  return { kind: 'legacy' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Money arithmetic
// ─────────────────────────────────────────────────────────────────────────────

/** Billed as a whole percent of the contract; null when there is no contract
 *  to bill against (never "0 %" of nothing). */
export function billedPct(invoiced: number, contract: number): number | null {
  if (!Number.isFinite(contract) || contract <= 0) return null;
  const inv = Number.isFinite(invoiced) ? Math.max(0, invoiced) : 0;
  return Math.round((inv / contract) * 100);
}

export type ARTotals = ARAgingReport['totals'];

/** Past due, any age: 0-30 + 31-60 + 61-90 + 90+ ('current' is not yet due). */
export function overdueAR(totals: Pick<ARTotals, '0-30' | '31-60' | '61-90' | '90+'>): number {
  return (totals['0-30'] ?? 0) + (totals['31-60'] ?? 0) + (totals['61-90'] ?? 0) + (totals['90+'] ?? 0);
}

/** Past due more than 30 days. */
export function overdueAR31Plus(totals: Pick<ARTotals, '31-60' | '61-90' | '90+'>): number {
  return (totals['31-60'] ?? 0) + (totals['61-90'] ?? 0) + (totals['90+'] ?? 0);
}

/** Past due more than 60 days. */
export function overdueAR61Plus(totals: Pick<ARTotals, '61-90' | '90+'>): number {
  return (totals['61-90'] ?? 0) + (totals['90+'] ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// The schedule lookahead
// ─────────────────────────────────────────────────────────────────────────────

export interface LookaheadRow {
  id: string;
  title: string;
  /** UTC-midnight ms of the calendar day the task starts (taskWindow's scale). */
  startMs: number;
  /** 'Tue 14 Oct'. */
  startLabel: string;
  /** Started before today and still open. */
  underway: boolean;
  isCriticalPath: boolean;
}

export interface Lookahead {
  rows: LookaheadRow[];
  /** Why there are no rows ('' when there are). */
  reason: string;
}

export const NO_START_DATE_REASON = 'Schedule has no start date';
export const NO_SCHEDULE_REASON = 'No schedule yet';
export const NOTHING_STARTS_REASON = 'Nothing starts in the next 21 days';

const DAY_MS = 86_400_000;

/** 'Tue 14 Oct' for a UTC-midnight ms. */
export function dayLabelUtc(ms: number): string {
  const d = new Date(ms);
  const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const mo = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${wd} ${d.getUTCDate()} ${mo}`;
}

/**
 * The next `days` of work: open tasks whose scheduled window touches
 * [today, today + days), earliest first, at most `limit`. Scheduled where CPM
 * puts them (lastPlanner buildScheduledStartDays + taskWindow — the same
 * placement the Last Planner board and the Gantt use), done tasks and summary
 * rows skipped. `now` is injected.
 */
export function lookaheadRows(
  tasks: readonly ScheduleTask[] | null | undefined,
  startDate: string | null | undefined,
  calendar: TaskWindowCalendar | undefined,
  now: Date,
  days = 21,
  limit = 5,
): Lookahead {
  const list = (tasks ?? []).filter(t => !t.isSummary);
  if (list.length === 0) return { rows: [], reason: NO_SCHEDULE_REASON };
  if (!startDate) return { rows: [], reason: NO_START_DATE_REASON };
  const es = buildScheduledStartDays(list as ScheduleTask[], startDate, calendar);
  const todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const horizonMs = todayMs + days * DAY_MS;
  const rows: LookaheadRow[] = [];
  for (const t of list) {
    if (t.status === 'done' || (t.progress ?? 0) >= 100) continue;
    const win = taskWindow(t, startDate, calendar, es.get(t.id));
    if (!win) continue;
    if (win.endMs < todayMs || win.startMs >= horizonMs) continue;
    rows.push({
      id: t.id,
      title: t.title,
      startMs: win.startMs,
      startLabel: dayLabelUtc(win.startMs),
      underway: win.startMs < todayMs,
      isCriticalPath: t.isCriticalPath === true,
    });
  }
  rows.sort((a, b) => a.startMs - b.startMs || a.title.localeCompare(b.title));
  const out = rows.slice(0, Math.max(0, limit));
  return { rows: out, reason: out.length ? '' : NOTHING_STARTS_REASON };
}

// ─────────────────────────────────────────────────────────────────────────────
// The job's pulse — what useProjectPulse hands the desktop surfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface DailyReportPulse {
  date: string;
  conditions: string;
  temperature: string;
  /** Σ manpower headcount. */
  crew: number;
}

export interface ProjectPulse {
  /** False for a null project — every number below is then inert. */
  hasProject: boolean;
  role: 'owner' | 'editor' | 'viewer' | 'field' | null;
  roleLoading: boolean;
  roleError: boolean;
  /** canViewFinancials(role) — fails closed while the role is unknown. */
  canSeeMoney: boolean;
  living: LivingEstimateSnapshot | null;
  risk: MarginRiskScore | null;
  costSourcesReady: boolean;
  /** THE one % complete (utils/projectProgress). */
  progress: ProjectProgress;
  /** 'YYYY-MM-DD' (utils/portalSnapshot scheduleFinishDate — portal parity). */
  forecastFinish: string | null;
  contract: {
    /** resolveContractSum: the signed contract, else the estimate. */
    value: number;
    source: ContractSumSource;
    approvedCO: number;
    /** value + approved change orders. */
    total: number;
  };
  invoiced: number;
  owed: number;
  nonDraftInvoiceCount: number;
  ar: ARTotals | null;
  openRfis: number;
  overdueRfis: number;
  punch: { open: number; inProgress: number; readyForReview: number };
  lastDailyReport: DailyReportPulse | null;
  lookahead: Lookahead;
  pendingCOs: ChangeOrder[];
  pendingCOValue: number;
  /** Σ commitment amount + change vs the bid cost; null without a basis. */
  committed: { committed: number; budget: number } | null;
}

export const INERT_PROGRESS: ProjectProgress = { pct: 0, taskCount: 0, doneCount: 0, hasSchedule: false };

export const INERT_PULSE: ProjectPulse = {
  hasProject: false,
  role: null,
  roleLoading: false,
  roleError: false,
  canSeeMoney: false,
  living: null,
  risk: null,
  costSourcesReady: false,
  progress: INERT_PROGRESS,
  forecastFinish: null,
  contract: { value: 0, source: 'estimate', approvedCO: 0, total: 0 },
  invoiced: 0,
  owed: 0,
  nonDraftInvoiceCount: 0,
  ar: null,
  openRfis: 0,
  overdueRfis: 0,
  punch: { open: 0, inProgress: 0, readyForReview: 0 },
  lastDailyReport: null,
  lookahead: { rows: [], reason: NO_SCHEDULE_REASON },
  pendingCOs: [],
  pendingCOValue: 0,
  committed: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// The KPI strip
// ─────────────────────────────────────────────────────────────────────────────

export const KPI_LOADING_COSTS = 'Loading crew hours and receipts…';
export const KPI_NO_BUDGET = 'No budget yet';
export const KPI_NO_ESTIMATE = 'No estimate yet';
export const KPI_NO_INVOICES = 'No invoices sent yet';
export const KPI_NO_SCHEDULE = 'No schedule yet';
export const KPI_NO_CONTRACT = 'No contract value yet';

export interface KpiContext {
  projectId: string;
  /** '% complete' — the existing schedule-tab push (router.replace). */
  onOpenSchedule: () => void;
  /** Desktop WEB (default true): cells that open a log carry its href. False
   *  (a native tablet): they open the section in place instead — see
   *  sectionIndexHref for why a phone route is not a log. */
  listLinks?: boolean;
  /** Opens a section in place: when listLinks is false, and for a log
   *  section with no log screen yet (not in LIST_SECTION_ROUTES). */
  onOpenSection?: (key: LogSectionKey) => void;
}

const HEALTH_TONE: Record<LivingEstimateSnapshot['health'], KpiTone> = { healthy: 'good', watch: 'warn', critical: 'bad' };
const RISK_TONE: Record<MarginRiskScore['band'], KpiTone> = { low: 'good', moderate: 'warn', elevated: 'warn', high: 'bad' };

/** 'Oct 14' for a 'YYYY-MM-DD' calendar day (local reading, no shift). */
export function finishLabel(day: string | null | undefined): string | null {
  if (!day) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * The 8 cells, in order: Contract, Margin, Risk, Billed %, Owed, Overdue A/R
 * (all `financial`), % complete, Open. Honest by construction: an unknown
 * value is null with the reason, never 0; the money cells are OMITTED (not
 * zeroed) when the viewer may not see money, or when his access could not be
 * verified (the strip then carries a notice instead).
 */
export function buildKpiCells(pulse: ProjectPulse, ctx: KpiContext): KpiCell[] {
  const pid = ctx.projectId;
  const withProject = (pathname: Route) => workspaceHref(pathname, { projectId: pid });
  // A log on desktop web (Cmd-click → new tab); in place elsewhere, and for
  // a section whose log screen is not live (not in LIST_SECTION_ROUTES).
  const listLinks = ctx.listLinks !== false;
  const toList = (key: LogSectionKey): Pick<KpiCell, 'href' | 'onPress'> => {
    const route = listSectionRoute(key);
    if (route && (listLinks || !ctx.onOpenSection)) return { href: withProject(route) };
    if (ctx.onOpenSection) return { onPress: () => ctx.onOpenSection?.(key) };
    return { href: workspaceHref('/project-detail', { id: pid, tile: key }) };
  };
  const money = pulse.canSeeMoney && !pulse.roleError;
  const cells: KpiCell[] = [];

  if (money) {
    // 1. Contract
    const c = pulse.contract;
    cells.push({
      key: 'contract',
      label: 'Contract',
      value: c.total > 0 ? formatMoney(c.total) : null,
      sub: c.total > 0 ? (c.source === 'signed_contract' ? 'Signed contract' : 'From estimate') : null,
      blockedReason: c.total > 0 ? null : KPI_NO_ESTIMATE,
      href: withProject('/contract'),
      financial: true,
    });

    // 2. Margin — held until the cost streams load (a guess is not a reading).
    const risk = pulse.risk;
    const living = pulse.living;
    const hasBasis = !!risk?.hasBasis && !!living;
    const marginReason = !pulse.costSourcesReady ? KPI_LOADING_COSTS : !hasBasis ? KPI_NO_BUDGET : null;
    cells.push({
      key: 'margin',
      label: 'Margin',
      value: marginReason || !living ? null : `${(living.projected.marginPct * 100).toFixed(1)}%`,
      tone: marginReason || !living ? undefined : HEALTH_TONE[living.health],
      blockedReason: marginReason,
      href: withProject('/living-estimate'),
      financial: true,
    });

    // 3. Risk
    cells.push({
      key: 'risk',
      label: 'Risk',
      value: marginReason || !risk ? null : riskBandLabel(risk.band),
      sub: marginReason || !risk ? null : `${risk.score}/100`,
      tone: marginReason || !risk ? undefined : RISK_TONE[risk.band],
      blockedReason: marginReason,
      href: withProject('/margin-risk'),
      financial: true,
    });

    // 4. Billed %
    const billed = billedPct(pulse.invoiced, c.total);
    cells.push({
      key: 'billed',
      label: 'Billed',
      value: billed == null ? null : `${billed}%`,
      sub: billed == null ? null : `${formatMoneyShort(pulse.invoiced)} of ${formatMoneyShort(c.total)}`,
      blockedReason: billed == null ? KPI_NO_CONTRACT : null,
      ...toList('invoices'),
      financial: true,
    });

    // 5. Owed — "$0 owed" and "no invoices yet" are different facts.
    const noInvoices = pulse.nonDraftInvoiceCount === 0;
    cells.push({
      key: 'owed',
      label: 'Owed',
      value: noInvoices ? null : formatMoney(pulse.owed),
      tone: !noInvoices && pulse.owed > 0 ? 'warn' : undefined,
      blockedReason: noInvoices ? KPI_NO_INVOICES : null,
      ...toList('invoices'),
      financial: true,
    });

    // 6. Overdue A/R
    const ar = pulse.ar;
    const overdue = ar ? overdueAR(ar) : 0;
    const past30 = ar ? overdueAR31Plus(ar) : 0;
    const past60 = ar ? overdueAR61Plus(ar) : 0;
    cells.push({
      key: 'overdue',
      label: 'Overdue A/R',
      value: noInvoices || !ar ? null : formatMoney(overdue),
      sub: !noInvoices && past60 > 0 ? `60+ ${formatMoneyShort(past60)}` : null,
      tone: noInvoices || !ar ? undefined : past30 > 0 ? 'bad' : overdue > 0 ? 'warn' : undefined,
      blockedReason: noInvoices || !ar ? KPI_NO_INVOICES : null,
      ...toList('invoices'),
      financial: true,
    });
  }

  // 7. % complete — THE one progress number.
  const p = pulse.progress;
  const finish = finishLabel(pulse.forecastFinish);
  cells.push({
    key: 'progress',
    label: '% complete',
    value: p.hasSchedule ? `${p.pct}%` : null,
    sub: p.hasSchedule ? (finish ? `Finish ${finish}` : 'No start date set') : null,
    blockedReason: p.hasSchedule ? null : KPI_NO_SCHEDULE,
    onPress: ctx.onOpenSchedule,
  });

  // 8. Open items
  const openPunch = pulse.punch.open + pulse.punch.inProgress + pulse.punch.readyForReview;
  const nCO = pulse.pendingCOs.length;
  const coLine = nCO > 0
    ? `${nCO} CO pending${money && pulse.pendingCOValue !== 0 ? ` · ${formatMoneyShort(pulse.pendingCOValue)}` : ''}`
    : 'No CO pending';
  cells.push({
    key: 'open',
    label: 'Open',
    value: `${pulse.openRfis} RFI · ${openPunch} punch`,
    sub: coLine,
    tone: pulse.overdueRfis > 0 ? 'warn' : undefined,
    ...toList('rfis'),
  });

  return cells;
}

// ─────────────────────────────────────────────────────────────────────────────
// The one-screen budget at 1512 x 945
// ─────────────────────────────────────────────────────────────────────────────

/** Heights (px) of the desktop workspace's rows, as specified. */
export const WORKSPACE_BUDGET = {
  header: 56,
  stage: 40,
  kpi: 88,
  quickActions: 56,
  card: 276,
  index: 280,
  gap: 12,
  padTop: 16,
  padBottom: 24,
} as const;

/** The overview's content height: six rows and five gaps between them, plus
 *  the page padding. Must fit a 945 px MacBook window (it is 896). */
export function workspaceHeight(b: typeof WORKSPACE_BUDGET = WORKSPACE_BUDGET): number {
  const rows = [b.header, b.stage, b.kpi, b.quickActions, b.card, b.index];
  return b.padTop + rows.reduce((a, h) => a + h, 0) + (rows.length - 1) * b.gap + b.padBottom;
}

// ─────────────────────────────────────────────────────────────────────────────
// The header's next-step notice
// ─────────────────────────────────────────────────────────────────────────────

/** NextStepHero's tones → the NoticeStrip's. */
export type NextStepTone = 'warn' | 'danger' | 'info' | 'accent' | 'success';
export type WorkspaceNoticeTone = 'info' | 'warn' | 'bad' | 'good';
export function noticeToneForStep(tone: NextStepTone): WorkspaceNoticeTone {
  switch (tone) {
    case 'danger': return 'bad';
    case 'warn': return 'warn';
    case 'success': return 'good';
    case 'info':
    case 'accent':
    default: return 'info';
  }
}

/**
 * The section a next step opens IN PLACE on this job page, or null (then the
 * step is a plain push). chooseNextStep's "Review RFIs" points at
 * /project-detail?id=<this job>&tile=rfis — pushing that would stack a second
 * copy of the page the GC is already on.
 */
export function inPlaceTileForStep(
  href: string | { pathname: string; params?: Record<string, unknown> },
  projectId: string,
): string | null {
  if (typeof href === 'string') return null;
  if (href.pathname !== '/project-detail') return null;
  const p = href.params ?? {};
  if (String(p.id ?? '') !== projectId) return null;
  const tile = p.tile;
  return typeof tile === 'string' && tile ? tile : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The overview cards' row text
// ─────────────────────────────────────────────────────────────────────────────

/** '#3 Add bathroom outlet · $1,240'. */
export function pendingCORowText(co: Pick<ChangeOrder, 'number' | 'description' | 'changeAmount'>): string {
  const desc = (co.description ?? '').trim() || 'Change order';
  return `#${co.number} ${desc} · ${formatMoney(co.changeAmount)}`;
}

/** '0-30 $1,200 · 31-60 $0 · 60+ $450' — the 61-90 and 90+ buckets fold into 60+. */
export function arRowText(totals: Pick<ARTotals, '0-30' | '31-60' | '61-90' | '90+'>): string {
  return `0-30 ${formatMoney(totals['0-30'] ?? 0)} · 31-60 ${formatMoney(totals['31-60'] ?? 0)} · 60+ ${formatMoney(overdueAR61Plus(totals))}`;
}

/** 'Committed $80,000 of $120,000 budget'; null without a budget basis. */
export function committedRowText(c: ProjectPulse['committed']): string | null {
  if (!c || !(c.budget > 0)) return null;
  return `Committed ${formatMoney(c.committed)} of ${formatMoney(c.budget)} budget`;
}

/** 'Last report Oct 14 · Sunny 72° · crew 6'. The weather is left out, not
 *  guessed, when the report has none. */
export function lastReportRowText(r: DailyReportPulse | null): string {
  if (!r) return 'No daily report yet';
  const day = finishLabel(r.date) ?? r.date;
  const weather = [r.conditions, r.temperature].map(x => (x ?? '').trim()).filter(Boolean).join(' ');
  return `Last report ${day}${weather ? ` · ${weather}` : ''} · crew ${r.crew}`;
}

export function punchRowText(p: ProjectPulse['punch']): string {
  return `Punch: ${p.open} open · ${p.inProgress} in progress · ${p.readyForReview} ready`;
}

/** 'Framing walls · Tue 14 Oct'. */
export function lookaheadRowText(row: Pick<LookaheadRow, 'title' | 'startLabel'>): string {
  return `${row.title} · ${row.startLabel}`;
}
