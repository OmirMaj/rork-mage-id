// utils/brainWatch.ts — pure aggregator for the Brain Watch home card.
// No React / React Native imports — runs under Bun for the validator.
//
// All builders take already-fetched data and return AttentionItem[].
// No context calls, no side effects. Sorting + summarizing are separate.

import type { Route } from 'expo-router';
import type { Project, Invoice, Permit, Certification, PunchItem, ChangeOrder, RFI, Submittal } from '@/types';
import { computeProjectProgress } from './projectProgress';
import { invoiceOutstanding } from './invoiceBilling';
// MONEY-03 (runtime audit 2026-09-06): every money string in this file goes
// through the same formatter the rest of the app uses. formatters.ts has zero
// imports of its own, so it is safe under Bun for the validator.
import { formatMoney } from './formatters';
// Reused, not re-derived: classifyDelivery is the single source of truth for
// late / unconfirmed, pinned by test:delivery-schedule.
import { classifyDelivery, type Delivery } from './deliverySchedule';
import { daysUntilCalendarDay } from './calendarDate';
import {
  findAccessConflicts,
  type BuildingAccessRules, type AccessReservation,
} from './buildingAccess';

// ─── Public types ────────────────────────────────────────────────────────────

// ATTN-RFI (polish audit 2026-09-10, empty-states P0 #1 / dead-ends P0 #1).
// There was no 'rfi' and no 'submittal' kind here, and that absence is what
// made four surfaces lie at once. The seeded account carries an RFI 23 days
// past due to the architect; /waiting-on and the Smart Inbox both name it
// ("RFI #2 past due · 23d"), but because no attention builder could see it the
// home Brain Watch card printed "All clear — your jobs are on track" ten rows
// above that very line, the Morning Brief printed "Nothing overdue, nothing at
// risk, nothing waiting on you. Go build." byte-identically in an EMPTY and a
// POPULATED account, and the desktop rail said "All caught up". An unanswered
// RFI is the most expensive thing on this list — it stops work — so it is the
// last thing an all-clear should be blind to.
export type AttnKind = 'schedule' | 'invoice' | 'permit' | 'cert' | 'closeout' | 'punch' | 'changeOrder' | 'delivery' | 'buildingAccess' | 'rfi' | 'submittal';
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

    // MONEY-03 (runtime audit 2026-09-06): this was `outstanding.toFixed(0)`
    // interpolated as `($${amt})`, so the one number the app asks the GC to act
    // on rendered as "$77201" — the only unformatted money string on the
    // Summary, 300px below a MONEY tile showing the same figure as "$77K". At a
    // glance $77201 reads as easily as $772.01. formatMoney is the formatter
    // every other money render in the app uses; grouped digits are what make a
    // six-figure receivable legible without counting them.
    const amt = formatMoney(outstanding);

    items.push({
      id: `invoice-${inv.id}`,
      projectId: project.id,
      projectName: project.name,
      kind: 'invoice',
      severity,
      message: `${project.name}: invoice #${inv.number} is ${overdueDays}d overdue (${amt})`,
      route: {
        pathname: '/invoice',
        params: { projectId: project.id, invoiceId: inv.id },
      },
    });
  }

  return items;
}

// ─── permitAttention ──────────────────────────────────────────────────────────

/** How far ahead an expiring permit becomes a this-week problem. Wider than
 *  the inspection window below because a permit renewal is paperwork with a
 *  jurisdiction on the other end of it — two days' notice is not enough to do
 *  anything about one, where two days' notice of an inspection is. */
const PERMIT_EXPIRY_HORIZON_DAYS = 30;

/** What a permit's printed expiry says about it today. */
export interface PermitExpiryState {
  /** Already past its expiry day, or recorded as expired by the jurisdiction. */
  lapsed: boolean;
  /** Whole calendar days until it expires — 0 is today, negative once past.
   *  Null when the permit carries no readable expiry and only its `status`
   *  says 'expired', which is still worth saying but carries no countdown. */
  daysToExpiry: number | null;
  /** What to call it on screen: the jurisdiction's number when there is one,
   *  otherwise the trade. One rule, so two surfaces name the same permit the
   *  same way. */
  label: string;
}

/**
 * THE definition of "this permit needs a human about its expiry" — null when it
 * does not.
 *
 * ONE definition because two surfaces read it: permitAttention below (the
 * canonical attention set behind every "needs you" verdict) and the
 * `permit_expiring` rule in hooks/useSmartInbox.ts. While only the first of
 * those could see an expired permit, the home screen rendered "1 thing needs
 * your attention | … ELE-26-02219 permit has expired — work on it is
 * unpermitted" and, four rows lower in the same scroll, the Inbox card's "All
 * caught up. | Nothing urgent across your projects." (measured render,
 * 2026-09-10). Two cards, one account, opposite verdicts — the same shape of
 * failure as sim-audit #15, and the reason this decision is not made twice.
 *
 * `denied` is excluded: there is nothing to renew, and a denied permit is a
 * different conversation.
 *
 * Expiry is read as a CALENDAR DAY — a permit expires on a date printed on a
 * card, not at an instant — so a reader in Denver and a reader in Tokyo agree
 * about which day it lapsed.
 */
function permitLabel(permit: Permit): string {
  return permit.permitNumber ?? permit.type;
}

export function permitExpiryState(permit: Permit, nowMs: number): PermitExpiryState | null {
  if (permit.status === 'denied') return null;
  const daysToExpiry = daysUntilCalendarDay(permit.expiresDate, new Date(nowMs));
  const lapsed = permit.status === 'expired' || (daysToExpiry !== null && daysToExpiry < 0);
  const expiringSoon =
    daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= PERMIT_EXPIRY_HORIZON_DAYS;
  if (!lapsed && !expiringSoon) return null;
  return { lapsed, daysToExpiry, label: permitLabel(permit) };
}

/**
 * Produces AttentionItems for a permit that needs a human this week:
 *   • an upcoming inspection within 7 days (≤ 2 days → critical, else high), and
 *   • a permit that has lapsed or is about to (expired → critical, else high).
 *
 * Route: /permits with projectId param.
 *
 * PERMIT-EXPIRY (polish audit 2026-09-10, verifier "missed" #2): this function
 * only ever read `inspectionDate`, and then only for an inspection 0–7 days
 * out. Nothing here had ever looked at `expiresDate`. The consequence was not
 * a missing nag — it was that an EXPIRED electrical permit on an active job
 * produced no attention item at all, which is why the home card, the Morning
 * Brief, the Friday Close and /waiting-on were all silent about the one on the
 * seeded account (ELE-26-02219, lapsed Sep 5) while /documents rendered it as
 * "Expired". Building on a lapsed permit is a stop-work risk; it belongs in the
 * set that decides whether the app may say "all clear".
 *
 * Expiry is read as a CALENDAR DAY, like the inspection date beside it — a
 * permit expires on a date printed on a card, not at an instant.
 */
export function permitAttention(
  project: Project,
  permits: Permit[],
  nowMs: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const permit of permits) {
    if (permit.projectId !== project.id) continue;

    // A permit already recorded as expired, or one whose printed expiry has
    // passed / is within the renewal horizon — see permitExpiryState, which
    // the Smart Inbox reads too so the two cannot disagree.
    const expiry = permitExpiryState(permit, nowMs);
    if (expiry) {
      items.push({
        id: `permit-expiry-${permit.id}`,
        projectId: project.id,
        projectName: project.name,
        kind: 'permit',
        severity: expiry.lapsed ? 'critical' : 'high',
        message: expiry.lapsed
          ? `${project.name}: ${expiry.label} permit has expired — work on it is unpermitted`
          // "expires in 0d" is not a sentence anyone says, and today is the one
          // day the countdown matters most.
          : expiry.daysToExpiry === 0
            ? `${project.name}: ${expiry.label} permit expires today`
            : `${project.name}: ${expiry.label} permit expires in ${expiry.daysToExpiry}d`,
        route: {
          pathname: '/permits',
          params: { projectId: project.id },
        },
      });
    }

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

    items.push({
      id: `permit-${permit.id}`,
      projectId: project.id,
      projectName: project.name,
      kind: 'permit',
      severity,
      message: `${project.name}: ${permitLabel(permit)} inspection in ${daysUntil}d`,
      route: {
        pathname: '/permits',
        params: { projectId: project.id },
      },
    });
  }

  return items;
}

// ─── rfiAttention ─────────────────────────────────────────────────────────────
//
// The line that was missing. An RFI past its required-by date is the app's
// clearest "someone else is holding your job up" signal, and it was the one
// signal no attention builder produced — see the ATTN-RFI note on AttnKind.
//
// Thresholds and the day count are lifted from hooks/useSmartInbox.ts:185-202
// deliberately, not re-invented: that rule already renders "RFI #2 past due ·
// 23d" on the home Inbox card, and if these two disagreed the same screen would
// print two different day counts for the same RFI. Same reason the day math is
// daysUntilCalendarDay — RFI.dateRequired is a date on a calendar (a reply is
// "due Tuesday", not "due at 14:07"), and it arrives in MIXED shapes (bare
// 'YYYY-MM-DD' from the voice/photo writers, noon-UTC from DatePickerModal),
// which is exactly what that helper's slice-to-10 handles.

export function rfiAttention(
  project: Project,
  rfis: RFI[],
  nowMs: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const now = new Date(nowMs);

  for (const rfi of rfis) {
    if (rfi.projectId !== project.id) continue;
    // Only 'open' — an answered/closed/void RFI is nobody's problem, and
    // useSmartInbox draws the line in the same place.
    if (rfi.status !== 'open') continue;

    const daysUntil = daysUntilCalendarDay(rfi.dateRequired, now);
    if (daysUntil === null || daysUntil >= 0) continue; // not due yet
    const daysLate = -daysUntil;

    const severity: AttnSeverity =
      daysLate >= 7 ? 'critical' : daysLate >= 3 ? 'high' : 'medium';

    // assignedTo is free text and can be blank on a legacy row; naming a blank
    // holder would read as "waiting on " with nothing after it.
    const holder = rfi.assignedTo?.trim();
    const waiting = holder ? ` — waiting on ${holder}` : '';

    items.push({
      id: `rfi-${rfi.id}`,
      projectId: project.id,
      projectName: project.name,
      kind: 'rfi',
      severity,
      message: `${project.name}: RFI #${rfi.number} is ${daysLate}d past due${waiting}`,
      route: {
        pathname: '/rfi',
        params: { projectId: project.id },
      },
    });
  }

  return items;
}

// ─── submittalAttention ───────────────────────────────────────────────────────
//
// A submittal sitting in review is the same shape of problem as an overdue RFI
// — someone else is holding a decision the schedule needs — and it was missing
// for the same reason. Staleness (not the required-by date) is the trigger,
// matching hooks/useSmartInbox.ts:204-225, because a submittal's requiredDate
// is often the date it is needed ON SITE while the review clock is what a GC
// can actually chase.

/** Days in review before a submittal becomes something to chase. Same 7 the
 *  Smart Inbox uses, so the two surfaces cannot disagree about what is stale. */
const SUBMITTAL_STALE_DAYS = 7;

export function submittalAttention(
  project: Project,
  submittals: Submittal[],
  nowMs: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const now = new Date(nowMs);

  for (const subm of submittals) {
    if (subm.projectId !== project.id) continue;
    if (subm.currentStatus !== 'in_review' && subm.currentStatus !== 'pending') continue;

    // The clock runs from the LAST time it went out, not from first submission:
    // a resubmittal that left yesterday is not 40 days stale.
    const cycles = subm.reviewCycles ?? [];
    const last = cycles.length > 0 ? cycles[cycles.length - 1] : null;
    const sentDay = last?.sentDate ?? subm.submittedDate;

    const daysUntil = daysUntilCalendarDay(sentDay, now);
    if (daysUntil === null) continue;
    const daysStale = -daysUntil;
    if (daysStale < SUBMITTAL_STALE_DAYS) continue;

    const severity: AttnSeverity =
      daysStale >= 21 ? 'critical' : daysStale >= 14 ? 'high' : 'medium';

    items.push({
      id: `submittal-${subm.id}`,
      projectId: project.id,
      projectName: project.name,
      kind: 'submittal',
      severity,
      message: `${project.name}: submittal #${subm.number} has been in review ${daysStale}d`,
      route: {
        pathname: '/submittal',
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
 *
 * Route: /safety-certifications (company-scoped, no project anchor).
 *
 * NOT /crew. A certification is not a crew row — the two live in different
 * tables and neither implies the other. The runtime audit (2026-09-06, NAV-02)
 * caught the founder's #1 attention item, "Dana Cole — First Aid / CPR
 * expired", routing to the Crew screen; production holds 16 certifications and
 * 0 crew_members, so the tap landed on "No crew yet · Add your first crew
 * member" with Dana nowhere on it. The flag could never be cleared from the
 * screen the app itself offered. /safety-certifications is the screen that
 * holds those 16 rows and can renew, re-date or delete one.
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
      route: { pathname: '/safety-certifications' },
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
    rfi: 0,
    submittal: 0,
  };
  for (const item of items) {
    byKind[item.kind]++;
  }
  return { total: items.length, byKind };
}
