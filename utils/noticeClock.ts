// utils/noticeClock.ts — the notice reminder clock.
//
// ── WHAT THIS IS ────────────────────────────────────────────────────────────
// A countdown against a number the user typed in. The GC opens their own
// contract, reads how many days it gives them to put a delay in writing, and
// enters that number on the project. This module counts from the date they
// first saw the problem to the date that window runs out, and sorts the
// results so the nearest one is on top.
//
// ── WHAT THIS MODULE MAY AND MAY NOT SAY ───────────────────────────────────
// It reminds a GC about a period THEY entered from THEIR contract. It does not
// read contracts, does not interpret them, and never tells the user what any
// agreement or any law requires of them. Every date it produces is described
// as the reminder the user configured — see NOTICE_REMINDER_DISCLAIMER, which
// every surface that renders one of these dates must show.
//
// Pure: no React, no react-native, no network, no clock — the caller passes
// `nowMs`. Same contract as utils/systemOfAction.ts:13 and the reason
// scripts/validate-notice-clock.ts can run it under bun.

import type {
  DelayEvent, DelayNotice, DelayNoticeMethod, DelayCause,
  DelayClassification, Project,
} from '@/types';

const DAY_MS = 86400000;

// ── The user's setting ──────────────────────────────────────────────────────

/**
 * Shortcut buttons on the ask. These are just the numbers people enter most
 * often; any other value goes in through the custom field.
 */
export const NOTICE_PERIOD_PRESETS: readonly number[] = [7, 14, 21];

/**
 * What "I don't know" resolves to. Short on purpose: a reminder that fires
 * early is a nuisance, a reminder that fires late is useless. Everything
 * derived from it is labelled assumed.
 */
export const ASSUMED_NOTICE_PERIOD_DAYS = 7;

/** The label every deadline built from an assumed period must carry. */
export const ASSUMED_LABEL = 'assumed — verify your contract';

/**
 * Recording a notice in MAGE is not the same act as sending it, and the
 * product must never let those two blur. Any screen that records a notice
 * renders this.
 */
export const RECORDING_IS_NOT_SERVING =
  'Recording a notice here is not the same as sending it. ' +
  'Send it the way your agreement requires, then log it here.';

/**
 * The one line every surface that renders a derived notice date must show.
 * Kept short and plain, in the spirit of PDF_DISCLAIMERS (utils/pdfDesign.ts):
 * say what the date is, say what it isn't, stop.
 */
export const NOTICE_REMINDER_DISCLAIMER =
  'This date is a reminder MAGE counted from the notice window you entered for this job. ' +
  'It is not legal advice — check your contract.';

/** The question the app asks when noticePeriodDays is unset. */
export const NOTICE_PERIOD_QUESTION =
  'How many days do you want to allow for written notice of a delay on this job? ' +
  'Check your agreement and enter what it gives you.';

// ── Day math ────────────────────────────────────────────────────────────────
//
// There is no canonical date helper in this codebase — daysPast
// (systemOfAction), daysOverdue (billingFlowCore), daysBetween
// (portalOwnerCore) and parseISODate (useSmartInbox) all coexist. This reuses
// daysPast's NOON-ANCHORED parse, which is the one that handles a bare
// YYYY-MM-DD without timezone drift. That drift is exactly the failure mode
// that would silently move a reminder date by a day.

/** Parse an ISO date or datetime to ms, anchoring bare dates at local noon. */
export function parseNoticeDate(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Whole days from `nowMs` forward to `iso`. Negative = already past. */
export function daysUntil(iso: string | undefined | null, nowMs: number): number | null {
  const ms = parseNoticeDate(iso);
  if (ms === null) return null;
  const todayNoon = anchorNoon(nowMs);
  return Math.round((ms - todayNoon) / DAY_MS);
}

/** Whole days from `iso` forward to `nowMs`. Negative = not yet reached. */
export function daysSince(iso: string | undefined | null, nowMs: number): number | null {
  const d = daysUntil(iso, nowMs);
  return d === null ? null : -d;
}

function anchorNoon(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0).getTime();
}

function toISODate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The date itself. DERIVED, NEVER STORED — a stored date goes stale the moment
 * the user corrects the window, and a stale reminder is worse than none. Same
 * grain as buildChaseList deriving daysOverdue from dateRequired
 * (utils/systemOfAction.ts:40-45).
 *
 * Counts from `firstObservedDate` — the date the GC first knew — not from when
 * the event was entered. A GC logging Monday's washout on Wednesday does not
 * get two free days.
 */
export function noticeDeadline(
  firstObservedDate: string,
  noticePeriodDays: number | null | undefined,
): string | null {
  if (noticePeriodDays == null || !Number.isFinite(noticePeriodDays) || noticePeriodDays <= 0) return null;
  const start = parseNoticeDate(firstObservedDate);
  if (start === null) return null;
  return toISODate(start + Math.floor(noticePeriodDays) * DAY_MS);
}

/**
 * The effective period for a project, and whether it was assumed.
 * `days: null` means UNSET — the app must ask. It must not fall back to 21, or
 * to anything else: shipping a default is the product putting words in the
 * user's contract, and it does not know what is in there. A GC on a 7-day
 * agreement given a 21-day reminder has a false sense of safety, which is
 * strictly worse than no reminder.
 */
export function effectiveNoticePeriod(project: Pick<Project, 'noticePeriodDays' | 'noticePeriodAssumed'> | undefined | null): {
  days: number | null;
  assumed: boolean;
} {
  const raw = project?.noticePeriodDays;
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return { days: null, assumed: false };
  return { days: Math.floor(raw), assumed: project?.noticePeriodAssumed === true };
}

// ── Form completeness ───────────────────────────────────────────────────────

/**
 * A reservation is three structured fields — what you are reserving, and how
 * much of it — rather than a checkbox plus a notes box, so that the record
 * says something specific rather than something generic.
 *
 * Returns the list of fields still empty; empty array means the form is
 * complete. This is a completeness check on a form, not an opinion about the
 * notice.
 */
export function reservationViolations(notice: Pick<DelayNotice, 'kind' | 'reservedClaimDescription' | 'reservedAmount' | 'reservedDaysClaimed'>): string[] {
  if (notice.kind !== 'reservation_of_rights') return [];
  const missing: string[] = [];
  if (!notice.reservedClaimDescription || notice.reservedClaimDescription.trim().length === 0) {
    missing.push('a description naming the specific claim you are reserving');
  }
  const hasAmount = typeof notice.reservedAmount === 'number' && Number.isFinite(notice.reservedAmount) && notice.reservedAmount > 0;
  const hasDays = typeof notice.reservedDaysClaimed === 'number' && Number.isFinite(notice.reservedDaysClaimed) && notice.reservedDaysClaimed > 0;
  if (!hasAmount && !hasDays) {
    missing.push('a stated amount — dollars, days, or both');
  }
  return missing;
}

/**
 * A notice that asks for time has a field for how much. This checks it was
 * filled in — nothing more.
 */
export function extensionRequestViolations(notice: Pick<DelayNotice, 'kind' | 'daysRequested'>): string[] {
  if (notice.kind === 'reservation_of_rights') return [];
  const d = notice.daysRequested;
  if (typeof d === 'number' && Number.isFinite(d) && d > 0) return [];
  return ['a number of days'];
}

/** Every empty required field on a notice, in one call. Empty means it can be
 *  saved. */
export function noticeViolations(notice: DelayNotice): string[] {
  return [...reservationViolations(notice), ...extensionRequestViolations(notice)];
}

const METHOD_LABEL: Record<DelayNoticeMethod, string> = {
  portal: 'Client portal',
  email: 'Email',
  hand_delivered: 'Hand delivered',
  certified_mail: 'Certified mail',
  courier: 'Courier',
  other: 'Other',
};

export function noticeMethodLabel(m: DelayNoticeMethod): string {
  return METHOD_LABEL[m] ?? 'Other';
}

/**
 * A mismatch between the delivery method the user recorded for this job and
 * the one they just logged. Reports the two settings back to them and says
 * nothing about what follows from the difference. Returns null when they
 * recorded no requirement, or when the method they used carries proof of
 * delivery.
 */
export function noticeMethodWarning(
  requiredMethod: DelayNoticeMethod | undefined | null,
  usedMethod: DelayNoticeMethod,
): string | null {
  if (requiredMethod !== 'certified_mail' && requiredMethod !== 'courier') return null;
  if (usedMethod === 'certified_mail' || usedMethod === 'courier' || usedMethod === 'hand_delivered') return null;
  return (
    `You set ${METHOD_LABEL[requiredMethod].toLowerCase()} as the delivery this job requires. ` +
    `This one is logged as ${METHOD_LABEL[usedMethod].toLowerCase()}.`
  );
}

// ── Classification ──────────────────────────────────────────────────────────

/**
 * SUGGEST, NEVER CONCLUDE. Returns a starting point for a human to accept or
 * override. The stored `classification` default is 'unclassified' and nothing
 * in the app may set it silently — this is the user's own label on their own
 * delay, and MAGE only pre-fills the obvious ones.
 *
 * Returns null where there is no honest suggestion to make.
 */
export function suggestClassification(cause: DelayCause): DelayClassification | null {
  switch (cause) {
    case 'weather':
      return 'excusable_noncompensable';
    case 'owner_directed_change':
    case 'late_rfi_response':
    case 'owner_supplied_item':
    case 'design_revision':
      return 'excusable_compensable';
    case 'contractor_caused':
      return 'nonexcusable';
    case 'differing_site_condition':
    case 'permit_or_inspection':
    case 'other':
      // Depends entirely on the job and the agreement. A guess here would be
      // MAGE putting a label on something it cannot see.
      return null;
    default:
      return null;
  }
}

export const CLASSIFICATION_LABEL: Record<DelayClassification, string> = {
  excusable_compensable: 'Excusable + compensable (time and money)',
  excusable_noncompensable: 'Excusable, non-compensable (time only)',
  nonexcusable: 'Non-excusable (neither)',
  unclassified: 'Not classified yet',
};

export const CAUSE_LABEL: Record<DelayCause, string> = {
  weather: 'Weather',
  owner_directed_change: 'Owner-directed change',
  late_rfi_response: 'Late RFI response',
  differing_site_condition: 'Differing site condition',
  owner_supplied_item: 'Owner-supplied item',
  permit_or_inspection: 'Permit or inspection',
  design_revision: 'Design revision',
  contractor_caused: 'Our own delay',
  other: 'Other',
};

// ── The clock ───────────────────────────────────────────────────────────────

export type NoticeUrgency =
  /** No noticePeriodDays on the project — the app must ask before it can count. */
  | 'unset'
  /** Deadline is more than a week out. */
  | 'open'
  /** 4–7 days remaining. */
  | 'due_soon'
  /** 0–3 days remaining. */
  | 'critical'
  /** The window has closed with no notice recorded. */
  | 'blown'
  /** An initial notice is on the record; the clock has stopped. */
  | 'given';

export interface NoticeStatus {
  eventId: string;
  projectId: string;
  projectName: string;
  /** Rendered "DE-004". */
  label: string;
  cause: DelayCause;
  firstObservedDate: string;
  /** Derived. null when the project has no notice period set. */
  deadlineDate: string | null;
  /** Derived. null when unset. Negative = the window has closed. */
  daysRemaining: number | null;
  noticePeriodDays: number | null;
  /** True when the period came from "I don't know". */
  assumed: boolean;
  urgency: NoticeUrgency;
  /** When an initial notice was recorded, its timestamp. */
  noticeRecordedAt?: string;
  /** Set when the method logged differs from the one recorded for the job. */
  methodWarning?: string;
  /** Set when a notice is on the record and the owner has not answered inside
   *  the response window. A fact about elapsed time, nothing more. */
  ownerSilencePrompt?: string;
  /** One-line headline for a card or an inbox row. */
  headline: string;
  detail: string;
  /** Inbox severity, matching the useSmartInbox 1..3 scale. */
  severity: 1 | 2 | 3;
}

/**
 * How long a recorded notice can sit unanswered before MAGE surfaces it again.
 * A display threshold, not a rule about anything.
 */
export const OWNER_RESPONSE_WINDOW_DAYS = 14;

function initialNotice(event: DelayEvent): DelayNotice | undefined {
  return (event.notices ?? []).find((n) => n.kind === 'initial');
}

function hasSupplementalNotice(event: DelayEvent): boolean {
  return (event.notices ?? []).some((n) => n.kind === 'supplemental');
}

/**
 * A notice went out and nothing came back. States how long it has been, so a
 * delay event that has gone quiet does not simply drop off the list.
 *
 * Fires when: an initial notice exists, no CO has resolved the event, no
 * follow-up notice has been recorded, and the wait is past the response
 * window. It reports the elapsed time and stops there — what to do about it
 * is the user's call.
 */
export function ownerSilencePromptFor(
  event: DelayEvent,
  nowMs: number,
  responseWindowDays: number = OWNER_RESPONSE_WINDOW_DAYS,
): string | null {
  const initial = initialNotice(event);
  if (!initial) return null;
  if (event.changeOrderId) return null;           // resolved — nothing outstanding
  if (hasSupplementalNotice(event)) return null;  // already followed up
  const waited = daysSince(initial.sentAt, nowMs);
  if (waited === null || waited < responseWindowDays) return null;
  return `No response recorded in the ${waited} days since you logged this notice.`;
}

function urgencyFor(daysRemaining: number): Exclude<NoticeUrgency, 'unset' | 'given'> {
  if (daysRemaining < 0) return 'blown';
  if (daysRemaining <= 3) return 'critical';
  if (daysRemaining <= 7) return 'due_soon';
  return 'open';
}

function severityFor(urgency: NoticeUrgency): 1 | 2 | 3 {
  switch (urgency) {
    case 'blown':
    case 'critical':
      return 3;
    case 'due_soon':
      return 2;
    default:
      return 1;
  }
}

export interface BuildNoticeStatusOpts {
  events: DelayEvent[];
  projects: Pick<Project, 'id' | 'name' | 'noticePeriodDays' | 'noticePeriodAssumed' | 'noticeMethodRequired'>[];
  nowMs: number;
  /** Include events whose notice is already recorded (default false). */
  includeGiven?: boolean;
  responseWindowDays?: number;
}

/**
 * The whole clock, for every open delay event. Sorted most-urgent first
 * (blown before critical, and within a bucket the fewest days remaining).
 *
 * Events on a project with no notice window produce an 'unset' status — that
 * is the ASK, not a silent skip. Dropping them would hide the one thing the
 * user has to do for the clock to work at all.
 */
export function buildNoticeStatus(opts: BuildNoticeStatusOpts): NoticeStatus[] {
  const { events, projects, nowMs } = opts;
  const includeGiven = opts.includeGiven ?? false;
  const byId = new Map(projects.map((p) => [p.id, p]));
  const out: NoticeStatus[] = [];

  for (const e of events) {
    const project = byId.get(e.projectId);
    const projectName = project?.name ?? 'Project';
    const { days, assumed } = effectiveNoticePeriod(project);
    const label = `DE-${String(e.number).padStart(3, '0')}`;
    const initial = initialNotice(e);
    const ownerSilencePrompt = ownerSilencePromptFor(e, nowMs, opts.responseWindowDays) ?? undefined;

    const methodWarning = initial
      ? noticeMethodWarning(project?.noticeMethodRequired, initial.method) ?? undefined
      : undefined;

    // Notice already on the record — the clock has stopped. Keep it only when
    // asked for, or when the owner has gone quiet or the method differs from
    // the one recorded for the job, because those are still open threads.
    if (initial) {
      if (!includeGiven && !ownerSilencePrompt && !methodWarning) continue;
      out.push({
        eventId: e.id,
        projectId: e.projectId,
        projectName,
        label,
        cause: e.cause,
        firstObservedDate: e.firstObservedDate,
        deadlineDate: noticeDeadline(e.firstObservedDate, days),
        daysRemaining: null,
        noticePeriodDays: days,
        assumed,
        urgency: 'given',
        noticeRecordedAt: initial.sentAt,
        methodWarning,
        ownerSilencePrompt,
        headline: ownerSilencePrompt
          ? `${label} · no response recorded`
          : `${label} · notice recorded`,
        detail: ownerSilencePrompt ?? methodWarning ?? `Notice recorded ${initial.sentAt.slice(0, 10)} · ${noticeMethodLabel(initial.method)}`,
        severity: ownerSilencePrompt ? 2 : methodWarning ? 2 : 1,
      });
      continue;
    }

    if (days === null) {
      out.push({
        eventId: e.id,
        projectId: e.projectId,
        projectName,
        label,
        cause: e.cause,
        firstObservedDate: e.firstObservedDate,
        deadlineDate: null,
        daysRemaining: null,
        noticePeriodDays: null,
        assumed: false,
        urgency: 'unset',
        ownerSilencePrompt,
        headline: `${label} · set your notice window`,
        detail:
          `${projectName} has no notice window recorded, so there is nothing for MAGE to ` +
          'count down. ' + NOTICE_PERIOD_QUESTION,
        severity: 2,
      });
      continue;
    }

    const deadlineDate = noticeDeadline(e.firstObservedDate, days);
    const daysRemaining = daysUntil(deadlineDate, nowMs);
    if (deadlineDate === null || daysRemaining === null) continue;

    const urgency = urgencyFor(daysRemaining);
    const suffix = assumed ? ` (${ASSUMED_LABEL})` : '';
    const headline =
      urgency === 'blown'
        ? `${label} · notice window closed ${Math.abs(daysRemaining)}d ago`
        : daysRemaining === 0
          ? `${label} · notice due today`
          : `${label} · notice due in ${daysRemaining}d`;

    out.push({
      eventId: e.id,
      projectId: e.projectId,
      projectName,
      label,
      cause: e.cause,
      firstObservedDate: e.firstObservedDate,
      deadlineDate,
      daysRemaining,
      noticePeriodDays: days,
      assumed,
      urgency,
      ownerSilencePrompt,
      headline,
      detail:
        `${CAUSE_LABEL[e.cause]} first observed ${e.firstObservedDate} · ` +
        `${days}-day window${suffix} · due ${deadlineDate} · ${projectName}`,
      severity: severityFor(urgency),
    });
  }

  return out.sort((a, b) => {
    if (a.severity !== b.severity) return b.severity - a.severity;
    const ad = a.daysRemaining ?? Number.MAX_SAFE_INTEGER;
    const bd = b.daysRemaining ?? Number.MAX_SAFE_INTEGER;
    if (ad !== bd) return ad - bd;
    return a.firstObservedDate.localeCompare(b.firstObservedDate);
  });
}

/** Headline counts for a card or a badge. */
export function noticeSummary(statuses: NoticeStatus[]): {
  total: number;
  blown: number;
  critical: number;
  unset: number;
  awaitingResponse: number;
} {
  let blown = 0, critical = 0, unset = 0, awaitingResponse = 0;
  for (const s of statuses) {
    if (s.urgency === 'blown') blown += 1;
    if (s.urgency === 'critical') critical += 1;
    if (s.urgency === 'unset') unset += 1;
    if (s.ownerSilencePrompt) awaitingResponse += 1;
  }
  return { total: statuses.length, blown, critical, unset, awaitingResponse };
}

/** Next per-project event number, rendered "DE-004". Mirrors
 *  nextFieldTicketNumber (utils/fieldTicketCore.ts:51). */
export function nextDelayEventNumber(existing: DelayEvent[]): number {
  return existing.reduce((max, e) => Math.max(max, e.number || 0), 0) + 1;
}

/** "DE-004". */
export function formatDelayEventNumber(n: number): string {
  return `DE-${String(n).padStart(3, '0')}`;
}
