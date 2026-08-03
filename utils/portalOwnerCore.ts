// utils/portalOwnerCore.ts
//
// The OWNER-facing (homeowner) pure logic behind two client-portal surfaces:
//
//   1. buildPeriodNarrative() — the plain-English "what this billing period
//      actually bought" summary that sits ABOVE the AIA G702/G703 schedule of
//      values. A homeowner can't judge "Division 09 Finishes — $14,200 this
//      period, 62% complete"; they CAN judge "this covers framing completion
//      and rough electrical — here are 6 photos from June 3–7". Days-to-payment
//      is the number that decides whether a small GC makes payroll.
//
//   2. buildOwnerDecisions() — the ranked list of things waiting on the owner
//      (unsigned contract, pending change orders, overdue selections, unpaid
//      invoices). Every day an owner sits on a tile selection is a day the GC's
//      sub doesn't show up.
//
// CLIENT-FACING SAFETY BOUNDARY — same rule as utils/clientEstimateView.ts and
// utils/ownerConfidence.ts: nothing produced here may carry cost, markup,
// margin, unit cost, or supplier. The inputs are deliberately narrow structural
// shapes so a caller CANNOT hand us a schedule-of-values line or an estimate
// item and have its cost buildup fall through into the output. Contract-level
// dollars the owner already sees (a change-order delta, an invoice balance) are
// allowed and are the only money that appears.
//
// DETERMINISTIC AND NON-AI on purpose. supabase/functions/homeowner-weekly-
// digest already proves the plain-English-summary shape works; it uses Gemini
// with a deterministic template fallback. Here the template IS the product: a
// pay application is a legal payment demand, so the summary must be reproducible
// and provably grounded in real rows. WE NEVER FABRICATE — an empty period
// returns an explicit gap reason and NO bullets rather than filler prose.
//
// Pure: no react-native, no network, no Date.now(). Callers pass `today` /
// period bounds so scripts/validate-portal-owner.ts can exercise it under Bun.
// Mirrors the utils/alertCore.ts split.

// ─────────────────────────────────────────────────────────────────────────────
// Calendar-date helpers. Everything is a YYYY-MM-DD calendar date compared at
// UTC midnight, so a homeowner in Hawaii and a GC in Maine agree on whether a
// photo landed inside a billing period.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86400000;

/** Normalize any date-ish string ('2026-06-07', '2026-06-07T18:22:00Z') to a
 *  YYYY-MM-DD calendar date. Returns null for junk — callers treat null as
 *  "unknown", never as "today". */
export function toCalendarDate(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (direct) {
    const ms = Date.parse(`${direct[1]}-${direct[2]}-${direct[3]}T00:00:00Z`);
    return Number.isFinite(ms) ? `${direct[1]}-${direct[2]}-${direct[3]}` : null;
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function dayMs(calendarDate: string): number {
  return Date.parse(`${calendarDate}T00:00:00Z`);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
}

/** `offsetDays` calendar days after `calendarDate`. */
export function addCalendarDays(calendarDate: string, offsetDays: number): string {
  return new Date(dayMs(calendarDate) + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jun 7" / "Jun 7, 2026" — deterministic, locale-independent (the portal's
 *  own fmtDate() is locale-aware, but narrative TEXT is baked into the snapshot
 *  so it must not vary by which device built it). */
export function formatShortDate(calendarDate: string, withYear = false): string {
  const [y, m, d] = calendarDate.split('-');
  const label = `${MONTHS[Number(m) - 1] ?? m} ${Number(d)}`;
  return withYear ? `${label}, ${y}` : label;
}

/** "Jun 1 – Jun 30" (same year) or "Dec 20, 2025 – Jan 15, 2026". */
export function formatDateRange(from: string, to: string): string {
  if (from === to) return formatShortDate(from, true);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return sameYear
    ? `${formatShortDate(from)} – ${formatShortDate(to, true)}`
    : `${formatShortDate(from, true)} – ${formatShortDate(to, true)}`;
}

function plural(n: number, one: string, many?: string): string {
  return n === 1 ? one : (many ?? `${one}s`);
}

/** "A", "A and B", "A, B and C" — reads like a sentence, not a CSV. */
function humanJoin(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Collapse whitespace and hard-cap free text the GC typed. Field notes can run
 *  long; the homeowner needs a readable line, not a wall. */
function tidy(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, maxChars - 1).trimEnd()}…`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Pay-application billing periods
// ─────────────────────────────────────────────────────────────────────────────

/** SavedAIAPayApp carries `periodTo` but NOT `periodFrom` (see types/index.ts).
 *  Rather than invent a column, we derive the window the way AIA billing
 *  actually works: application N covers the day after application N-1's period
 *  end through its own period end. Application #1 falls back to the caller's
 *  project start. If neither is known the window stays open and the narrative
 *  reports a `no_period` gap instead of guessing. */
export interface PayAppPeriodSource {
  id: string;
  applicationNumber: number;
  periodTo?: string;
}

export interface PayAppPeriod {
  id: string;
  periodFrom?: string;
  periodTo?: string;
}

export function derivePayAppPeriods(
  apps: PayAppPeriodSource[],
  firstPeriodStart?: string,
): PayAppPeriod[] {
  const ordered = [...(apps ?? [])].sort((a, b) => {
    const byNumber = (a.applicationNumber ?? 0) - (b.applicationNumber ?? 0);
    return byNumber !== 0 ? byNumber : String(a.id).localeCompare(String(b.id));
  });

  const fallbackStart = toCalendarDate(firstPeriodStart);
  let previousEnd: string | null = null;

  return ordered.map((app) => {
    const periodTo = toCalendarDate(app.periodTo);
    const rawFrom = previousEnd ? addCalendarDays(previousEnd, 1) : fallbackStart;
    // A derived start after the period end means the GC's dates disagree with
    // each other. Report no window rather than an impossible one.
    const periodFrom = rawFrom && periodTo && dayMs(rawFrom) > dayMs(periodTo) ? undefined : (rawFrom ?? undefined);
    if (periodTo) previousEnd = periodTo;
    return { id: app.id, periodFrom, periodTo: periodTo ?? undefined };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Period → activity narrative
// ─────────────────────────────────────────────────────────────────────────────

export interface PeriodReport {
  id?: string;
  date?: string;
  /** The GC's own field note. Free text — never a cost. */
  workPerformed?: string;
}

export interface PeriodPhoto {
  url?: string;
  caption?: string;
  timestamp?: string;
}

export interface PeriodMilestone {
  id?: string;
  title?: string;
  /** Calendar date the milestone landed on. */
  dateISO?: string;
  completed?: boolean;
}

/** Which sources the GC actually shares with THIS homeowner. We must never cite
 *  a photo the portal isn't showing — "here are 6 photos" with no photos section
 *  is worse than saying nothing. */
export interface PeriodSharedSources {
  reports?: boolean;
  photos?: boolean;
  schedule?: boolean;
}

export interface PeriodActivityInput {
  periodFrom?: string;
  periodTo?: string;
  reports?: PeriodReport[];
  photos?: PeriodPhoto[];
  milestones?: PeriodMilestone[];
  shared?: PeriodSharedSources;
  /** Max GC field notes to quote (default 3). */
  maxWorkNotes?: number;
}

/** Why a narrative is empty. Rendered verbatim-ish by the portal so the
 *  homeowner gets a true reason, never filler. */
export type PeriodNarrativeGap = 'no_period' | 'nothing_shared' | 'no_activity';

export interface PeriodNarrative {
  periodFrom?: string;
  periodTo?: string;
  /** "Jun 1 – Jun 30", or '' when the window is unknown. */
  periodLabel: string;
  hasActivity: boolean;
  headline: string;
  bullets: string[];
  reportCount: number;
  workdayCount: number;
  photoCount: number;
  photoFrom?: string;
  photoTo?: string;
  milestones: string[];
  workNotes: string[];
  gap?: PeriodNarrativeGap;
}

const GAP_HEADLINE: Record<PeriodNarrativeGap, string> = {
  no_period:
    "This application doesn't say which dates it covers, so we can't match it to what happened on site. Ask your contractor for the billing period before you pay.",
  nothing_shared:
    "Your contractor hasn't shared daily reports, photos, or the schedule on this project, so there's nothing we can show you about this billing period.",
  no_activity: '', // built with the real dates below
};

function inWindow(date: string | null, from: string, to: string): boolean {
  if (!date) return false;
  const ms = dayMs(date);
  return ms >= dayMs(from) && ms <= dayMs(to);
}

/**
 * Cross-reference a pay application's billing window against the daily reports,
 * photos, and completed schedule milestones that fall INSIDE it.
 *
 * Guarantees, in order of importance:
 *  - Only in-window rows are counted. An out-of-window photo never inflates a count.
 *  - Only sources the GC shares are cited.
 *  - An empty period yields `hasActivity: false`, zero bullets, and a `gap`
 *    reason. It never invents content.
 */
export function buildPeriodNarrative(input: PeriodActivityInput): PeriodNarrative {
  const periodFrom = toCalendarDate(input.periodFrom);
  const periodTo = toCalendarDate(input.periodTo);
  const shared = input.shared ?? {};
  const showReports = shared.reports !== false;
  const showPhotos = shared.photos !== false;
  const showSchedule = shared.schedule !== false;

  const base: PeriodNarrative = {
    periodFrom: periodFrom ?? undefined,
    periodTo: periodTo ?? undefined,
    periodLabel: periodFrom && periodTo ? formatDateRange(periodFrom, periodTo) : '',
    hasActivity: false,
    headline: '',
    bullets: [],
    reportCount: 0,
    workdayCount: 0,
    photoCount: 0,
    milestones: [],
    workNotes: [],
  };

  // Unknown window → we cannot honestly attribute anything to this period.
  if (!periodFrom || !periodTo) {
    return { ...base, gap: 'no_period', headline: GAP_HEADLINE.no_period };
  }

  // Nothing shared at all → say that, don't summarize invisible rows.
  if (!showReports && !showPhotos && !showSchedule) {
    return { ...base, gap: 'nothing_shared', headline: GAP_HEADLINE.nothing_shared };
  }

  // ── In-window daily reports ──
  const reportDays = new Set<string>();
  const workNotes: string[] = [];
  const seenNotes = new Set<string>();
  const maxWorkNotes = input.maxWorkNotes ?? 3;
  let reportCount = 0;
  if (showReports) {
    const windowed = (input.reports ?? [])
      .map((r) => ({ r, date: toCalendarDate(r.date) }))
      .filter((x) => inWindow(x.date, periodFrom, periodTo))
      .sort((a, b) => dayMs(a.date!) - dayMs(b.date!));
    reportCount = windowed.length;
    for (const { r, date } of windowed) {
      reportDays.add(date!);
      const note = typeof r.workPerformed === 'string' ? tidy(r.workPerformed, 160) : '';
      if (!note) continue;
      const key = note.toLowerCase();
      if (seenNotes.has(key)) continue;
      seenNotes.add(key);
      if (workNotes.length < maxWorkNotes) workNotes.push(note);
    }
  }

  // ── In-window photos ──
  let photoCount = 0;
  let photoFrom: string | undefined;
  let photoTo: string | undefined;
  if (showPhotos) {
    const dates = (input.photos ?? [])
      .filter((p) => typeof p.url === 'string' && p.url.length > 0)
      .map((p) => toCalendarDate(p.timestamp))
      .filter((d): d is string => inWindow(d, periodFrom, periodTo))
      .sort((a, b) => dayMs(a) - dayMs(b));
    photoCount = dates.length;
    if (dates.length > 0) {
      photoFrom = dates[0];
      photoTo = dates[dates.length - 1];
    }
  }

  // ── In-window completed milestones ──
  const milestones: string[] = [];
  if (showSchedule) {
    const seen = new Set<string>();
    const windowed = (input.milestones ?? [])
      .filter((m) => m.completed === true)
      .map((m) => ({ m, date: toCalendarDate(m.dateISO) }))
      .filter((x) => inWindow(x.date, periodFrom, periodTo))
      .sort((a, b) => dayMs(a.date!) - dayMs(b.date!));
    for (const { m } of windowed) {
      const title = typeof m.title === 'string' ? tidy(m.title, 70) : '';
      if (!title) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (milestones.length < 4) milestones.push(title);
    }
  }

  const workdayCount = reportDays.size;
  const hasActivity = reportCount > 0 || photoCount > 0 || milestones.length > 0;

  if (!hasActivity) {
    return {
      ...base,
      gap: 'no_activity',
      headline:
        `Nothing was logged on this project between ${formatDateRange(periodFrom, periodTo)} — ` +
        'no photos, daily reports, or completed milestones. Ask your contractor what this billing period covers before you pay.',
    };
  }

  // ── Headline: milestones first (the thing an owner can picture), then site
  //    days, then photos. Photos get appended as evidence, matching the shape
  //    "this covers X — here are N photos from D1–D2".
  let subject: string;
  if (milestones.length > 0) {
    subject = `This billing period covers ${humanJoin(milestones.slice(0, 3))}`;
  } else if (workdayCount > 0) {
    subject = `This billing period covers ${workdayCount} ${plural(workdayCount, 'day')} of work logged on site`;
  } else {
    subject = 'This billing period covers work documented on site';
  }
  let headline = `${subject}.`;
  if (photoCount > 0 && photoFrom && photoTo) {
    const range = photoFrom === photoTo ? formatShortDate(photoFrom) : `${formatShortDate(photoFrom)}–${formatShortDate(photoTo)}`;
    headline = `${subject} — ${photoCount} ${plural(photoCount, 'photo')} from ${range}.`;
  }

  // ── Bullets: only facts we counted. Each maps 1:1 to rows the portal shows.
  const bullets: string[] = [];
  if (milestones.length > 0) {
    bullets.push(`Finished this period: ${humanJoin(milestones)}.`);
  }
  if (reportCount > 0) {
    bullets.push(
      `${reportCount} daily ${plural(reportCount, 'report')} filed` +
        (workdayCount > 0 ? `, covering ${workdayCount} ${plural(workdayCount, 'day')} on site` : '') +
        '.',
    );
  }
  for (const note of workNotes) {
    bullets.push(`Work logged: ${note}`);
  }
  if (photoCount > 0 && photoFrom && photoTo) {
    const range = photoFrom === photoTo ? formatShortDate(photoFrom, true) : formatDateRange(photoFrom, photoTo);
    bullets.push(`${photoCount} ${plural(photoCount, 'photo')} taken ${photoFrom === photoTo ? 'on' : 'between'} ${range} — see the Photos section.`);
  }

  return {
    periodFrom,
    periodTo,
    periodLabel: formatDateRange(periodFrom, periodTo),
    hasActivity: true,
    headline,
    bullets,
    reportCount,
    workdayCount,
    photoCount,
    photoFrom,
    photoTo,
    milestones,
    workNotes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. What's waiting on the owner
// ─────────────────────────────────────────────────────────────────────────────

export type OwnerDecisionKind = 'contract' | 'change_order' | 'selection' | 'invoice';

/** `overdue` and `due_soon` are only ever claimed when a REAL date exists and
 *  has passed / is close. An item with no stated deadline is `waiting` — we
 *  don't manufacture urgency the contract never promised. */
export type OwnerDecisionUrgency = 'overdue' | 'due_soon' | 'waiting';

export interface OwnerDecision {
  id: string;
  kind: OwnerDecisionKind;
  title: string;
  detail: string;
  urgency: OwnerDecisionUrgency;
  /** Stated deadline, when one exists. */
  dueDate?: string;
  /** Whole days past `dueDate`. Only set when urgency === 'overdue'. */
  daysOverdue?: number;
  /** Whole days this has sat in the owner's court, when we know when it landed. */
  waitingDays?: number;
  /** Contract-level dollars the owner already sees (a change-order delta, an
   *  invoice balance). NEVER a cost, unit price, markup, or margin. */
  amount?: number;
  /** Portal section anchor to scroll to. */
  target: string;
  /** Deterministic sort key; lower is more urgent. */
  rank: number;
}

export interface OwnerDecisionInput {
  /** Calendar date "today" — passed in so results are testable and so the
   *  snapshot bakes the same answer the builder computed. */
  today: string;
  contract?: { status?: string; needsSignature?: boolean; sentAt?: string; title?: string } | null;
  changeOrders?: {
    id: string; number?: number | string; description?: string;
    status?: string; changeAmount?: number; dateSubmitted?: string;
  }[];
  coApprovalEnabled?: boolean;
  selections?: { id: string; category?: string; dueDate?: string; status?: string; chosen?: boolean }[];
  invoices?: { id: string; number?: number | string; status?: string; balance?: number; dueDate?: string }[];
}

/** Within how many days a stated deadline counts as "due soon". */
export const DUE_SOON_DAYS = 7;

const KIND_WEIGHT: Record<OwnerDecisionKind, number> = {
  contract: 0,
  change_order: 1,
  selection: 2,
  invoice: 3,
};
const SEVERITY_WEIGHT: Record<OwnerDecisionUrgency, number> = {
  overdue: 0,
  due_soon: 10,
  waiting: 20,
};

const PENDING_CO_STATUSES = new Set(['submitted', 'pending', 'under_review', 'review']);
const OPEN_INVOICE_STATUSES = new Set(['sent', 'partially_paid', 'overdue', 'unpaid']);

function urgencyFor(today: string, dueDate: string | null): {
  urgency: OwnerDecisionUrgency; daysOverdue?: number;
} {
  if (!dueDate) return { urgency: 'waiting' };
  const delta = daysBetween(today, dueDate); // negative = the date has passed
  if (delta < 0) return { urgency: 'overdue', daysOverdue: -delta };
  if (delta <= DUE_SOON_DAYS) return { urgency: 'due_soon' };
  return { urgency: 'waiting' };
}

/**
 * Everything currently sitting in the owner's court, ranked so the portal can
 * show the single most urgent item in the banner and the whole list below it.
 *
 * Ordering: severity first (a passed date is a hard fact), then kind
 * (contract → change order → selection → invoice), then age — the thing that's
 * been overdue/waiting longest wins the tie. Fully deterministic.
 */
export function buildOwnerDecisions(input: OwnerDecisionInput): OwnerDecision[] {
  const today = toCalendarDate(input.today);
  if (!today) return [];
  const out: OwnerDecision[] = [];

  const push = (
    d: Omit<OwnerDecision, 'rank'> & { rank?: number },
  ) => {
    out.push({ ...d, rank: SEVERITY_WEIGHT[d.urgency] + KIND_WEIGHT[d.kind] });
  };

  // ── Contract awaiting the owner's signature. No stated deadline, so it is
  //    `waiting` however long it sits — but it outranks every other `waiting`
  //    item because nothing else is real until it's signed.
  const contract = input.contract;
  if (contract && contract.status === 'sent' && contract.needsSignature) {
    const sentAt = toCalendarDate(contract.sentAt);
    const waitingDays = sentAt ? Math.max(0, daysBetween(sentAt, today)) : undefined;
    push({
      id: 'contract',
      kind: 'contract',
      title: 'Contract waiting for your signature',
      // NOTE: `detail` never bakes a live day count. The static portal caches
      // this list in a snapshot and re-ages it in the browser, so the elapsed
      // number lives in `waitingDays` / `daysOverdue` (rendered in the badge)
      // and the prose only ever states a fixed DATE. Otherwise a week-old
      // snapshot would read "3 days past due" next to a badge saying 10.
      detail: 'Review the scope, payment schedule, and warranty, then counter-sign to make it binding.',
      urgency: 'waiting',
      waitingDays,
      target: 'sec-contract',
    });
  }

  // ── Change orders pending the owner's decision.
  for (const co of input.changeOrders ?? []) {
    const status = String(co.status ?? '').toLowerCase();
    if (!PENDING_CO_STATUSES.has(status)) continue;
    const submitted = toCalendarDate(co.dateSubmitted);
    const waitingDays = submitted ? Math.max(0, daysBetween(submitted, today)) : undefined;
    const amount = typeof co.changeAmount === 'number' ? co.changeAmount : undefined;
    const label = co.number != null ? `Change order #${co.number}` : 'Change order';
    const description = typeof co.description === 'string' ? tidy(co.description, 80) : '';
    push({
      id: co.id,
      kind: 'change_order',
      title: description ? `${label} — ${description}` : `${label} needs your approval`,
      detail: input.coApprovalEnabled
        ? 'Review the scope and the change to your contract total, then sign to approve or decline with a reason.'
        : 'Your contractor is waiting on your decision — reply in Messages.',
      urgency: 'waiting',
      waitingDays,
      amount,
      target: 'sec-changeOrders',
    });
  }

  // ── Selections the owner hasn't picked. THE schedule lever: a tile decision
  //    left open is a day the sub doesn't show up. dueDate now flows through
  //    the snapshot (it always existed on SelectionCategory), so these can
  //    finally go overdue instead of sitting as an undated nag.
  for (const sel of input.selections ?? []) {
    if (sel.chosen) continue;
    const dueDate = toCalendarDate(sel.dueDate);
    const { urgency, daysOverdue } = urgencyFor(today, dueDate);
    const category = typeof sel.category === 'string' && sel.category.trim() ? tidy(sel.category, 60) : 'Selection';
    let detail: string;
    if (urgency === 'overdue') {
      detail = `Was due ${formatShortDate(dueDate!, true)}. Your contractor can't order until you pick.`;
    } else if (urgency === 'due_soon') {
      detail = `Due ${formatShortDate(dueDate!, true)}. Picking now keeps the crew and the delivery on schedule.`;
    } else if (dueDate) {
      detail = `Due ${formatShortDate(dueDate, true)}. Pick when you're ready — earlier is easier to schedule.`;
    } else {
      detail = 'Pick a finish so your contractor can order it and hold the schedule.';
    }
    push({
      id: sel.id,
      kind: 'selection',
      title: `${category} — pick your option`,
      detail,
      urgency,
      dueDate: dueDate ?? undefined,
      daysOverdue,
      target: 'sec-selections',
    });
  }

  // ── Unpaid invoices with a real balance.
  for (const inv of input.invoices ?? []) {
    const status = String(inv.status ?? '').toLowerCase();
    if (!OPEN_INVOICE_STATUSES.has(status)) continue;
    const balance = typeof inv.balance === 'number' ? inv.balance : undefined;
    if (balance != null && balance <= 0) continue;
    const dueDate = toCalendarDate(inv.dueDate);
    const { urgency, daysOverdue } = urgencyFor(today, dueDate);
    const label = inv.number != null ? `Invoice #${inv.number}` : 'Invoice';
    let detail: string;
    if (urgency === 'overdue') {
      detail = `Was due ${formatShortDate(dueDate!, true)}. Open it to review and pay.`;
    } else if (dueDate) {
      detail = `Due ${formatShortDate(dueDate, true)}. Open it to review and pay.`;
    } else {
      detail = 'Open the invoice to review and pay.';
    }
    push({
      id: inv.id,
      kind: 'invoice',
      title: `${label} awaiting payment`,
      detail,
      urgency,
      dueDate: dueDate ?? undefined,
      daysOverdue,
      amount: balance,
      target: 'sec-invoices',
    });
  }

  return out.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const overdueDelta = (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0);
    if (overdueDelta !== 0) return overdueDelta;
    // A stated deadline sorts ahead of an undated peer at the same severity.
    const aDue = a.dueDate ?? '￿';
    const bDue = b.dueDate ?? '￿';
    if (aDue !== bDue) return aDue < bDue ? -1 : 1;
    const waitDelta = (b.waitingDays ?? 0) - (a.waitingDays ?? 0);
    if (waitDelta !== 0) return waitDelta;
    return String(a.id).localeCompare(String(b.id));
  });
}

/** One-line roll-up for the portal banner / in-app card header. */
export function summarizeOwnerDecisions(decisions: OwnerDecision[]): string {
  if (decisions.length === 0) return 'Nothing needs you right now.';
  const overdue = decisions.filter((d) => d.urgency === 'overdue').length;
  const n = decisions.length;
  const head = `${n} ${plural(n, 'thing')} ${n === 1 ? 'needs' : 'need'} you`;
  return overdue > 0 ? `${head} · ${overdue} past due` : head;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Change-order e-signature consent record (ESIGN / UETA)
// ─────────────────────────────────────────────────────────────────────────────
//
// A homeowner "approving" a $12K change order behind a browser confirm() +
// prompt() is a consent CLICK, not an electronic signature. ESIGN/UETA want:
// intent to sign, consent to do business electronically, association of the
// signature with the record, and a retainable copy. The canonical record below
// is the retainable artifact — the portal hashes it (SHA-256) and the
// portal_submit_co_approval_signed RPC re-hashes it server-side before storing,
// so any later byte-level edit to the stored record breaks the stored hash.
// Same tamper-evidence property as the contract flow's seal-document fn.
//
// Canonicalization is hand-rolled and ORDER-FIXED (not JSON.stringify over an
// object literal) so the browser, the server, and any future auditor all hash
// exactly the same bytes.

/** Bump when the disclosure text or the field set changes — a stored record
 *  must always be re-verifiable against the disclosure the signer actually saw. */
export const ESIGN_DISCLOSURE_VERSION = 'co-esign-1';

export const ESIGN_DISCLOSURE_TEXT =
  'By typing your legal name, drawing your signature, and selecting "I agree", you consent to sign this change order electronically. ' +
  'Your electronic signature has the same legal effect as a handwritten one under the U.S. E-SIGN Act and UETA. ' +
  'You are approving the scope described above and the resulting change to your contract total. ' +
  'You may decline instead, or ask for a paper copy at no charge, by messaging your contractor. ' +
  'A copy of this record is retained by your contractor and is available to you on request.';

export interface COConsentRecordInput {
  changeOrderId: string;
  changeOrderNumber: number | string;
  description: string;
  changeAmount: number;
  newContractTotal?: number;
  decision: 'approved' | 'declined';
  signerName: string;
  /** SHA-256 of the drawn signature stroke data. Approvals only. */
  signatureHash?: string;
  /** Number of pen strokes drawn — evidence the pad was actually used. */
  signatureStrokeCount?: number;
  /** Free-text reason. Declines only. */
  reason?: string;
  portalId: string;
  signedAt: string;
  userAgent?: string;
  /** Minutes offset from UTC, as reported by the signer's browser. */
  timezoneOffsetMinutes?: number;
}

/**
 * Deterministic, line-oriented canonical form of the consent record. This exact
 * string is what gets hashed and what gets stored — a human can read it, and a
 * machine can re-hash it, years later.
 */
export function buildCOConsentRecord(input: COConsentRecordInput): string {
  const lines: string[] = [
    'MAGE ID CHANGE ORDER ELECTRONIC SIGNATURE RECORD',
    `version: ${ESIGN_DISCLOSURE_VERSION}`,
    `decision: ${input.decision}`,
    `portal_id: ${input.portalId}`,
    `change_order_id: ${input.changeOrderId}`,
    `change_order_number: ${input.changeOrderNumber}`,
    `scope: ${tidy(String(input.description ?? ''), 600)}`,
    `change_amount_usd: ${Number(input.changeAmount ?? 0).toFixed(2)}`,
  ];
  if (typeof input.newContractTotal === 'number') {
    lines.push(`new_contract_total_usd: ${input.newContractTotal.toFixed(2)}`);
  }
  lines.push(`signer_name: ${String(input.signerName ?? '').trim()}`);
  lines.push(`signed_at: ${input.signedAt}`);
  if (typeof input.timezoneOffsetMinutes === 'number') {
    lines.push(`signer_utc_offset_minutes: ${input.timezoneOffsetMinutes}`);
  }
  if (input.signatureHash) lines.push(`signature_sha256: ${input.signatureHash}`);
  if (typeof input.signatureStrokeCount === 'number') {
    lines.push(`signature_strokes: ${input.signatureStrokeCount}`);
  }
  if (input.reason) lines.push(`decline_reason: ${tidy(input.reason, 600)}`);
  if (input.userAgent) lines.push(`user_agent: ${tidy(input.userAgent, 200)}`);
  lines.push(`consent_disclosure: ${ESIGN_DISCLOSURE_TEXT}`);
  return lines.join('\n');
}

/** The audit entry the portal asks the server to append to change_orders.audit_trail.
 *  Mirrors COAuditEntry in types/index.ts — app/client-view.tsx was the only
 *  code path in the app writing these; the portal now writes real ones too. */
export function buildCOAuditDetail(input: {
  decision: 'approved' | 'declined';
  signatureStrokeCount?: number;
  documentHash?: string;
  reason?: string;
}): string {
  if (input.decision === 'approved') {
    return (
      'Electronically signed via the client portal ' +
      `(E-SIGN/UETA consent ${ESIGN_DISCLOSURE_VERSION}` +
      (input.signatureStrokeCount != null ? `, ${input.signatureStrokeCount} signature strokes` : '') +
      (input.documentHash ? `, record SHA-256 ${input.documentHash.slice(0, 16)}…` : '') +
      ').'
    );
  }
  return `Declined via the client portal. Reason: ${tidy(input.reason ?? '(none given)', 500)}`;
}
