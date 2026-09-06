// utils/brainWatch.ts — pure aggregator for the Brain Watch home card.
// No React / React Native imports — runs under Bun for the validator.
//
// All builders take already-fetched data and return AttentionItem[].
// No context calls, no side effects. Sorting + summarizing are separate.

import type { Route } from 'expo-router';
import type { Project, Invoice, Permit, Certification, PunchItem, ChangeOrder } from '@/types';
import { computeProjectProgress } from './projectProgress';
import { invoiceOutstanding } from './invoiceBilling';
// Reused, not re-derived: classifyDelivery is the single source of truth for
// late / unconfirmed, pinned by test:delivery-schedule.
import { classifyDelivery, type Delivery } from './deliverySchedule';
import { daysUntilCalendarDay } from './calendarDate';
import {
  findAccessConflicts,
  type BuildingAccessRules, type AccessReservation,
} from './buildingAccess';

// ─── Public types ────────────────────────────────────────────────────────────

export type AttnKind = 'schedule' | 'invoice' | 'permit' | 'cert' | 'closeout' | 'punch' | 'changeOrder' | 'delivery' | 'buildingAccess';
export type AttnSeverity = 'critical' | 'high' | 'medium';

export interface AttentionItem {
  id: string;
  projectId: string;
  projectName: string;
  kind: AttnKind;
  severity: AttnSeverity;
  message: string;
  /** Typed against the router's generated Route union — a dead route here
   *  fails tsc (this contract feeds One Mind drill-in chips too). */
  route: { pathname: Route; params?: Record<string, string> };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function daysBetween(laterMs: number, earlierMs: number): number {
  return Math.floor((laterMs - earlierMs) / (24 * 60 * 60 * 1000));
}

// ─── scheduleAttention ────────────────────────────────────────────────────────

/**
 * Produces one AttentionItem if the project's schedule health is at-risk.
 * Conditions:
 *   - health score < 70, OR
 *   - schedule exists with tasks but health score is absent (undefined/null),
 *     AND the schedule has at least one task that is behind (status === 'at_risk'
 *     or 'delayed', or riskItems.length > 0).
 * Severity: health < 40 → critical, < 60 → high, else medium.
 */
export function scheduleAttention(project: Project): AttentionItem[] {
  const schedule = project.schedule;
  if (!schedule) return [];

  const hasTasks = schedule.tasks.length > 0;
  if (!hasTasks) return [];

  const score = schedule.healthScore;

  // If health score is present and fine, skip.
  if (score !== undefined && score !== null && score >= 70) return [];

  // If score is absent, only flag when the schedule shows risk signals.
  if ((score === undefined || score === null) && schedule.riskItems.length === 0) return [];

  const effectiveScore = score ?? 0; // treat missing as unknown risk → use 0 for severity calc
  const severity: AttnSeverity =
    effectiveScore < 40 ? 'critical' : effectiveScore < 60 ? 'high' : 'medium';

  const displayScore = score !== undefined && score !== null ? String(Math.round(score)) : '?';

  return [
    {
      id: `schedule-${project.id}`,
      projectId: project.id,
      projectName: project.name,
      kind: 'schedule',
      severity,
      message: `${project.name}: schedule at risk (health ${displayScore})`,
      route: { pathname: '/schedule-pro', params: { projectId: project.id } },
    },
  ];
}

// ─── invoiceAttention ─────────────────────────────────────────────────────────

/**
 * Produces one AttentionItem per unpaid invoice that is overdue by > 7 days.
 * "Unpaid" = status 'sent' | 'partially_paid' | 'overdue'.
 * Severity: overdue > 30 days → critical, > 14 days → high, else medium.
 * Route: /invoice with projectId + invoiceId params.
 */
export function invoiceAttention(
  project: Project,
  invoices: Invoice[],
  nowMs: number,
): AttentionItem[] {
  const unpaidStatuses = new Set<string>(['sent', 'partially_paid', 'overdue']);
  const items: AttentionItem[] = [];

  for (const inv of invoices) {
    if (inv.projectId !== project.id) continue;
    if (!unpaidStatuses.has(inv.status)) continue;
    if (!inv.dueDate) continue;

    const dueMs = Date.parse(inv.dueDate);
    if (Number.isNaN(dueMs)) continue;

    const overdueDays = daysBetween(nowMs, dueMs);
    if (overdueDays <= 7) continue; // grace window

    // MONEY-F5: net of held retention. An invoice whose only open balance is
    // retention the client is entitled to hold is not overdue for anything.
    const outstanding = invoiceOutstanding(inv);
    if (outstanding <= 0) continue;

    const severity: AttnSeverity =
      overdueDays > 30 ? 'critical' : overdueDays > 14 ? 'high' : 'medium';

    const amt = outstanding.toFixed(0);

    items.push({
      id: `invoice-${inv.id}`,
      projectId: project.id,
      projectName: project.name,
      kind: 'invoice',
      severity,
      message: `${project.name}: invoice #${inv.number} is ${overdueDays}d overdue ($${amt})`,
      route: {
        pathname: '/invoice',
        params: { projectId: project.id, invoiceId: inv.id },
      },
    });
  }

  return items;
}

// ─── permitAttention ──────────────────────────────────────────────────────────

/**
 * Produces one AttentionItem per permit with an upcoming inspection within 7 days.
 * Severity: ≤ 2 days → critical, else high.
 * Route: /permits with projectId param.
 */
export function permitAttention(
  project: Project,
  permits: Permit[],
  nowMs: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const permit of permits) {
    if (permit.projectId !== project.id) continue;
    if (!permit.inspectionDate) continue;

    // B4 review A3: inspectionDate is a CALENDAR DAY (bare 'YYYY-MM-DD',
    // app/permits.tsx UX-F4). Date.parse read it as UTC midnight and the
    // floored millisecond difference then came out a day short from any
    // morning west of Greenwich — "inspection in 1d" for a two-day-out
    // inspection, and the critical/high threshold moved with it. Whole local
    // calendar days, like the permits screen itself.
    const daysUntil = daysUntilCalendarDay(permit.inspectionDate, new Date(nowMs));
    if (daysUntil === null) continue;
    if (daysUntil < 0 || daysUntil > 7) continue; // past or too far out

    const severity: AttnSeverity = daysUntil <= 2 ? 'critical' : 'high';
    const label = permit.permitNumber ?? permit.type;

    items.push({
      id: `permit-${permit.id}`,
      projectId: project.id,
      projectName: project.name,
      kind: 'permit',
      severity,
      message: `${project.name}: ${label} inspection in ${daysUntil}d`,
      route: {
        pathname: '/permits',
        params: { projectId: project.id },
      },
    });
  }

  return items;
}

// ─── deliveryAttention ────────────────────────────────────────────────────────
//
// A load that does not land is a crew standing around, and that cost surfaces as
// LABOUR rather than as a late PO — which is exactly why it goes unnoticed until
// payroll. The brief is the right place for it: it is a this-morning problem.
//
// All the classification lives in utils/deliverySchedule (pure, pinned by
// test:delivery-schedule). This function only decides severity and phrasing —
// re-deriving "is it late" here would give the brief and the /deliveries screen
// two chances to disagree with each other.

export function deliveryAttention(
  project: Project,
  deliveries: Delivery[],
  nowMs: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const delivery of deliveries) {
    if (delivery.projectId !== project.id) continue;

    const view = classifyDelivery(delivery, nowMs);

    // 'due_soon' and 'ok' are not attention — a confirmed load arriving Friday
    // is the system working. Only chase what needs a human today.
    if (view.flag !== 'late' && view.flag !== 'unconfirmed') continue;

    // Late outranks unconfirmed for the same reason it does on the screen: the
    // date has already been missed, so the crew may be waiting right now.
    const severity: AttnSeverity = view.flag === 'late' ? 'critical' : 'high';

    items.push({
      id: `delivery-${delivery.id}`,
      projectId: project.id,
      projectName: project.name,
      kind: 'delivery',
      severity,
      message: `${project.name}: ${delivery.description} — ${view.label.toLowerCase()}`,
      route: {
        pathname: '/deliveries',
        params: { projectId: project.id },
      },
    });
  }

  return items;
}

// ─── buildingAccessAttention ──────────────────────────────────────────────────
//
// What the BUILDING will stop, as opposed to what the supplier will. On an
// occupied-building fit-out these are the failures nothing else catches: a load
// arrives on its confirmed date, the freight elevator was never booked, and the
// truck goes home full. deliveryAttention cannot see that — the delivery is
// perfectly on schedule.
//
// The two do not double up. findAccessConflicts deliberately skips past-due
// deliveries ("the delivery chase's problem, not access planning's"), so a late
// load produces exactly one brief line, from deliveryAttention.

/** How far ahead the BRIEF looks for access conflicts.
 *
 *  Deliberately tighter than the 28-day default the /building-access screen
 *  uses. The brief answers "what needs me this week"; a slot unbooked three
 *  weeks out is real but would sit here nagging for fifteen mornings, and a
 *  line you scroll past every day stops being a line you read. Two weeks is
 *  still ample lead time to book an elevator or send a COI. */
export const BRIEF_ACCESS_HORIZON_DAYS = 14;

export function buildingAccessAttention(
  project: Project,
  rules: BuildingAccessRules | null | undefined,
  reservations: AccessReservation[],
  deliveries: Delivery[],
  nowMs: number,
): AttentionItem[] {
  // No rules recorded means no constraints — most jobs are not in occupied
  // towers, and inventing a constraint teaches people to ignore the real ones.
  if (!rules) return [];

  const conflicts = findAccessConflicts({
    rules,
    deliveries: deliveries.filter(d => d.projectId === project.id),
    reservations: reservations.filter(r => r.projectId === project.id),
    horizonDays: BRIEF_ACCESS_HORIZON_DAYS,
    nowMs,
  });

  return conflicts.map((c, i) => ({
    // kind + deliveryId is not unique on its own: a building requiring BOTH an
    // elevator and a dock emits two 'no_reservation' conflicts for the same
    // load. The index disambiguates, and conflict order is deterministic.
    id: `access-${project.id}-${c.kind}-${c.deliveryId ?? 'all'}-${i}`,
    projectId: project.id,
    projectName: project.name,
    kind: 'buildingAccess' as const,
    // 'blocking' means the truck is turned away or the crew is refused entry —
    // the day does not happen. 'warning' means it still might, but someone has
    // to move. Collapsing the two would make the list untriageable.
    severity: (c.severity === 'blocking' ? 'critical' : 'high') as AttnSeverity,
    message: `${project.name}: ${c.message}`,
    route: {
      pathname: '/building-access' as Route,
      params: { projectId: project.id },
    },
  }));
}

// ─── certAttention ────────────────────────────────────────────────────────────

/**
 * Produces one AttentionItem per expiring/expired certification.
 * Takes the already-computed list from SafetyContext.expiringCertifications().
 * Severity: expired → critical, expiring < 14 days → high, else medium.
 * Route: /crew (company-scoped, no project anchor).
 *
 * @param expiring — output of useSafety().expiringCertifications(todayISO)
 * @param nowMs    — Date.now() for day math
 */
export function certAttention(
  expiring: (Certification & { status: 'expiring' | 'expired' })[],
  nowMs: number,
): AttentionItem[] {
  // Dedupe by (person, cert): a certification is a person-level fact, so
  // duplicate records (re-seeded data, one row per project, double entry)
  // must collapse to ONE line — the sim audit found "Dana Cole — First Aid /
  // CPR expired" rendered 3x verbatim on home, brief, and needs-attention.
  // On collision the most urgent record wins (expired > soonest expiry).
  const byKey = new Map<string, AttentionItem & { _rank: number }>();

  for (const cert of expiring) {
    let severity: AttnSeverity;
    let dayStr: string;
    // Lower rank = more urgent. Expired = -1; expiring ranks by days left.
    let rank: number;

    if (cert.status === 'expired') {
      severity = 'critical';
      dayStr = 'expired';
      rank = -1;
    } else {
      // 'expiring'
      const expMs = cert.expiresDate ? Date.parse(cert.expiresDate) : NaN;
      const daysLeft = Number.isNaN(expMs) ? 0 : daysBetween(expMs, nowMs);
      severity = daysLeft < 14 ? 'high' : 'medium';
      dayStr = `expires in ${daysLeft}d`;
      rank = daysLeft;
    }

    const workerLabel = cert.holderName ?? cert.workerId ?? 'Unknown worker';
    const certLabel = cert.type;
    // Dedupe on (person, cert). But a real person identifier is REQUIRED to
    // merge — when both holderName AND workerId are absent, two genuinely
    // distinct people would both key as "unknown worker|<type>" and collapse
    // to one, dropping a real expired cert from the canonical count. Fall back
    // to the per-record id so unknown-holder records never merge across people.
    const personKey = cert.holderName ?? cert.workerId ?? `cert:${cert.id}`;
    const key = `${personKey.trim().toLowerCase()}|${certLabel.trim().toLowerCase()}`;

    const existing = byKey.get(key);
    if (existing && existing._rank <= rank) continue;

    byKey.set(key, {
      id: `cert-${cert.id}`,
      projectId: '',
      projectName: '',
      kind: 'cert',
      severity,
      message: `${workerLabel} — ${certLabel} ${dayStr}`,
      route: { pathname: '/crew' },
      _rank: rank,
    });
  }

  return [...byKey.values()].map(({ _rank, ...item }) => item);
}

// ─── groupReadyPunchItems ─────────────────────────────────────────────────────

export interface ReadyPunchInput {
  id: string;
  projectId: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  updatedAt: string;
}

export interface ReadyPunchGroup {
  /** The representative item — stable dismissal anchor + tap target. */
  primary: ReadyPunchInput;
  /** All member punch-item ids (primary first). */
  ids: string[];
  /** Count of DISTINCT projects the identical item appears on. */
  projectCount: number;
  /** Highest member priority (high > medium > low). */
  priority: 'high' | 'medium' | 'low';
}

const PUNCH_PRIORITY_RANK: Record<'high' | 'medium' | 'low', number> = { high: 0, medium: 1, low: 2 };

// Generic free-text descriptions that collide across UNRELATED punch items —
// "touch up paint" on project A is not the same work as "touch up paint" on
// project B. Merging them hides one item behind a bogus "x2 projects" count.
// Only DISTINCTIVE descriptions (specific enough to plausibly be a re-seeded
// identical item) are allowed to collapse across projects; anything generic
// or too short stays a per-item row.
const GENERIC_PUNCH_PHRASES = new Set<string>([
  'touch up paint',
  'touch-up paint',
  'paint touch up',
  'touch up',
  'clean up',
  'cleanup',
  'clean',
  'final walkthrough',
  'walkthrough',
  'walk through',
  'punch',
  'punch item',
  'punch list',
  'punchlist',
  'misc',
  'miscellaneous',
  'repair',
  'fix',
  'caulk',
  'caulking',
  'inspection',
  'final clean',
]);

function normalizePunchDesc(description: string): string {
  return description.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Groups ready-to-verify punch items that carry the SAME DISTINCTIVE
 * description — the "Punch item ready to verify" x3 sim-audit dupe (identical
 * item seeded on 3 projects). Consumers render one row per group with a
 * "xN projects" suffix when the group spans multiple projects.
 *
 * Cross-project merge is gated on the description NOT being a generic
 * stop-list phrase: two unrelated "touch up paint" items on different
 * projects key on their item id instead of the shared text, so they stay two
 * separate rows rather than a false "x2 projects" collapse. Distinctive
 * descriptions still collapse true re-seeded duplicates. Pure — validated
 * under Bun.
 */
export function groupReadyPunchItems(items: ReadyPunchInput[]): ReadyPunchGroup[] {
  const groups = new Map<string, ReadyPunchGroup & { _projects: Set<string> }>();

  for (const item of items) {
    const norm = normalizePunchDesc(item.description);
    // Distinctive descriptions merge across projects (true re-seeded dupes);
    // generic stop-list phrases fall back to a per-item key so they never merge.
    const key = GENERIC_PUNCH_PHRASES.has(norm) ? `id:${item.id}` : norm;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        primary: item,
        ids: [item.id],
        projectCount: 1,
        priority: item.priority,
        _projects: new Set([item.projectId]),
      });
      continue;
    }
    existing.ids.push(item.id);
    existing._projects.add(item.projectId);
    existing.projectCount = existing._projects.size;
    if (PUNCH_PRIORITY_RANK[item.priority] < PUNCH_PRIORITY_RANK[existing.priority]) {
      existing.priority = item.priority;
    }
  }

  return [...groups.values()].map(({ _projects, ...group }) => group);
}

// ─── punchAttention ───────────────────────────────────────────────────────────

/**
 * ONE rollup item for open high-priority punch items (portfolio-wide).
 * Mirrors the Summary dashboard's urgent-punch rule so the canonical
 * needs-you set covers everything Summary used to count on its own
 * (sim-audit #15 — Summary/home/bell counters disagreed).
 */
export function punchAttention(punchItems: PunchItem[]): AttentionItem[] {
  const urgent = punchItems.filter((pi) => pi.status !== 'closed' && pi.priority === 'high');
  if (urgent.length === 0) return [];
  return [
    {
      id: 'punch-high-open',
      projectId: urgent[0].projectId,
      projectName: '',
      kind: 'punch',
      severity: 'high',
      message: `${urgent.length} high-priority punch item${urgent.length === 1 ? '' : 's'} open`,
      route: { pathname: '/project-detail', params: { id: urgent[0].projectId } },
    },
  ];
}

// ─── changeOrderAttention ─────────────────────────────────────────────────────

/**
 * ONE rollup item for change orders sitting in submitted / under_review.
 * Same population as the Summary dashboard's pending-CO rule.
 */
export function changeOrderAttention(changeOrders: ChangeOrder[]): AttentionItem[] {
  const pending = changeOrders.filter((co) => co.status === 'submitted' || co.status === 'under_review');
  if (pending.length === 0) return [];
  return [
    {
      id: 'co-awaiting-approval',
      projectId: pending[0].projectId,
      projectName: '',
      kind: 'changeOrder',
      severity: 'medium',
      message: `${pending.length} change order${pending.length === 1 ? '' : 's'} awaiting approval`,
      route: { pathname: '/project-detail', params: { id: pending[0].projectId } },
    },
  ];
}

// ─── closeoutAttention ────────────────────────────────────────────────────────

/**
 * Produces one AttentionItem when a project looks done (schedule >= 100%)
 * but is still in_progress. Closing it feeds the cost book, pace book, and
 * passport — every learning engine depends on this transition.
 * Severity: always medium (it's a good thing, not a risk).
 */
export function closeoutAttention(project: Project): AttentionItem[] {
  // Only nudge in_progress projects — completed/closed already crossed the line
  if (project.status !== 'in_progress') return [];

  const prog = computeProjectProgress(project);
  if (!prog.hasSchedule || prog.pct < 100) return [];

  return [
    {
      id: `closeout-${project.id}`,
      projectId: project.id,
      projectName: project.name,
      kind: 'closeout',
      severity: 'medium',
      message: `${project.name}: work looks done — close it to feed your cost book`,
      route: { pathname: '/closeout-binder', params: { projectId: project.id } },
    },
  ];
}

// ─── rankAttention ────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<AttnSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

/**
 * Stable sort: critical first, then high, then medium.
 * Items of the same severity stay in their original order.
 */
export function rankAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

// ─── summarize ────────────────────────────────────────────────────────────────

export function summarize(items: AttentionItem[]): {
  total: number;
  byKind: Record<AttnKind, number>;
} {
  const byKind: Record<AttnKind, number> = {
    schedule: 0,
    invoice: 0,
    permit: 0,
    cert: 0,
    closeout: 0,
    punch: 0,
    changeOrder: 0,
    delivery: 0,
    buildingAccess: 0,
  };
  for (const item of items) {
    byKind[item.kind]++;
  }
  return { total: items.length, byKind };
}
