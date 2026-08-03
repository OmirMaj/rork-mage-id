// utils/noticeClock.ts — the notice clock.
//
// Spec: docs/superpowers/specs/2026-08-03-claim-defense-design.md §3.
//
// ── WHY THIS IS THE HIGHEST-VALUE PIECE OF THE WHOLE FEATURE ────────────────
// Most construction contracts make written notice a CONDITION PRECEDENT to any
// claim for time or money. Miss the window and the claim is waived — not
// weakened, waived — even when the entitlement was completely real.
//
//   Greg Opinski Construction, Inc. v. City of Oakdale, 199 Cal.App.4th 1107
//   (2011): the contractor was held liable for liquidated damages DESPITE
//   owner-caused delay, because "since the contractor did not use either of the
//   available contract procedures to obtain a change order to extend the
//   contract time, the time was not extended, regardless of which party was to
//   blame for the late completion." Accord Dugan & Meyers Constr. Co. v. Ohio
//   Dept. of Admin. Servs., 113 Ohio St.3d 226 (2007).
//
// Excusability is necessary but not sufficient — the extension has to actually
// be obtained through the contract's machinery. Every other part of this
// feature documents a loss. This part prevents one.
//
// ── WHAT THIS MODULE MAY AND MAY NOT SAY ───────────────────────────────────
// It reminds a GC about a period THEY entered from THEIR contract. It does not
// read contracts, does not opine on whether late notice is fatal (courts split:
// strict-compliance jurisdictions waive the claim outright; others excuse late
// notice on actual notice without prejudice, waiver by conduct, or substantial
// compliance), and never states MAGE's reading of anyone's agreement.
//
// Pure: no React, no react-native, no network, no clock — the caller passes
// `nowMs`. Same contract as utils/systemOfAction.ts:13 and the reason
// scripts/validate-notice-clock.ts can run it under bun.

import type {
  DelayEvent, DelayNotice, DelayNoticeMethod, DelayCause,
  DelayClassification, Project,
} from '@/types';

const DAY_MS = 86400000;

// ── Contract setting ────────────────────────────────────────────────────────

/**
 * The presets offered when the app asks. Deliberately the three real-world
 * windows and nothing else:
 *   21 — AIA A201-2017 §15.1.3.1 Notice of Claim.
 *   14 — A201-2017 §3.7.4 concealed/unknown conditions (shortened from 21 in
 *        the 2007 edition); also the common ConsensusDocs 200 family window.
 *    7 — the short end of the residential / GC-authored range.
 * "Custom" and "I don't know" are handled by the caller.
 */
export const NOTICE_PERIOD_PRESETS: readonly number[] = [7, 14, 21];

/**
 * What "I don't know" resolves to. Conservative on purpose: a clock that runs
 * SHORT is a nuisance, a clock that runs LONG is a waived claim. Everything
 * derived from it is labelled assumed.
 */
export const ASSUMED_NOTICE_PERIOD_DAYS = 7;

/** The label every deadline built from an assumed period must carry. */
export const ASSUMED_LABEL = 'assumed — verify your contract';

/**
 * §3.5. Recording a notice in MAGE is not the same act as serving notice under
 * the contract, and the product must never let those two blur. Any screen that
 * records a notice renders this.
 */
export const RECORDING_IS_NOT_SERVING =
  'Recording a notice here is not the same as serving it under your contract. ' +
  'Send it the way your agreement requires, then log it.';

/** The question the app asks when noticePeriodDays is unset. */
export const NOTICE_PERIOD_QUESTION =
  "What does your contract give you for written notice of a delay? " +
  "Check your agreement — it's usually 7, 14, or 21 days.";

// ── Day math ────────────────────────────────────────────────────────────────
//
// There is no canonical date helper in this codebase — daysPast
// (systemOfAction), daysOverdue (billingFlowCore), daysBetween
// (portalOwnerCore) and parseISODate (useSmartInbox) all coexist. This reuses
// daysPast's NOON-ANCHORED parse, which is the one that handles a bare
// YYYY-MM-DD without timezone drift. That drift is exactly the failure mode
// that would silently move a legal deadline by a day.

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
 * The deadline itself. DERIVED, NEVER STORED — a stored deadline goes stale the
 * moment the contract setting is corrected, and a stale legal deadline is worse
 * than none. Same grain as buildChaseList deriving daysOverdue from
 * dateRequired (utils/systemOfAction.ts:40-45).
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
 * `days: null` means UNSET — the app must ask (§3.3). It must not fall back to
 * 21, or to anything else: shipping a default is the product telling a
 * contractor what their contract says, and it does not know. A GC on a 7-day
 * residential agreement given a 21-day clock has a false sense of safety, which
 * is strictly worse than no clock.
 */
export function effectiveNoticePeriod(project: Pick<Project, 'noticePeriodDays' | 'noticePeriodAssumed'> | undefined | null): {
  days: number | null;
  assumed: boolean;
} {
  const raw = project?.noticePeriodDays;
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return { days: null, assumed: false };
  return { days: Math.floor(raw), assumed: project?.noticePeriodAssumed === true };
}

// ── Notice validity ─────────────────────────────────────────────────────────

/**
 * Mingus Constructors, Inc. v. United States, 812 F.2d 1387 (Fed. Cir. 1987)
 * requires that "specific claims be excepted in stated amounts." The court
 * called generic language a "blunderbuss exception" and held: "Vague, broad
 * exceptions … are insufficient as a matter of law to constitute 'claims'."
 * Still quoted by the CBCA — Enfield Enterprises v. DHS, CBCA 7684 (2024).
 *
 * This is why the reservation is three structured fields and not a checkbox
 * plus a notes box. A free-text "reserves all rights" is the anti-pattern, not
 * the feature.
 *
 * Returns the list of what is missing; empty means valid.
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
 * Zafer Taahhut Insaat v. United States, 833 F.3d 1356, 1362 (Fed. Cir. 2016):
 * an open-ended extension request fails Fraser elements 2 and 3. Every notice
 * that asks for time must state how much.
 */
export function extensionRequestViolations(notice: Pick<DelayNotice, 'kind' | 'daysRequested'>): string[] {
  if (notice.kind === 'reservation_of_rights') return [];
  const d = notice.daysRequested;
  if (typeof d === 'number' && Number.isFinite(d) && d > 0) return [];
  return ['a number of days — an open-ended extension request is not a sufficient request'];
}

/** Everything wrong with a notice, in one call. Empty means it can be saved. */
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
 * §3.5 — THE ONE THING THE CLOCK MUST SAY OUT LOUD.
 *
 * AIA A201-2017 §15.1.3.2 requires written notice "by certified or registered
 * mail, or by courier providing proof of delivery." An ordinary email does not
 * satisfy it unless the §1.6 electronic-transmission provisions are set up in
 * the agreement, and a message in a vendor's portal certainly does not.
 *
 * So when the contract requires certified mail or courier and the GC records a
 * notice sent through the portal or by email, say so. Returns null when there
 * is nothing to warn about.
 */
export function noticeMethodWarning(
  requiredMethod: DelayNoticeMethod | undefined | null,
  usedMethod: DelayNoticeMethod,
): string | null {
  if (requiredMethod !== 'certified_mail' && requiredMethod !== 'courier') return null;
  if (usedMethod === 'certified_mail' || usedMethod === 'courier' || usedMethod === 'hand_delivered') return null;
  return (
    'Your contract requires certified mail or courier with proof of delivery. ' +
    `A ${METHOD_LABEL[usedMethod].toLowerCase()} notice may not satisfy A201 §15.1.3.2.`
  );
}

// ── Classification ──────────────────────────────────────────────────────────

/**
 * §5.3 — SUGGEST, NEVER CONCLUDE. This returns a starting point for a human to
 * accept or override. The stored `classification` default is 'unclassified' and
 * nothing in the app may set it silently: an entitlement call is the GC's
 * assertion and their attorney's argument, not a finding software makes.
 *
 * Returns null where there is no honest suggestion to make.
 */
export function suggestClassification(cause: DelayCause): DelayClassification | null {
  switch (cause) {
    case 'weather':
      // Excusable if unusually severe; time but not money. "Unusually severe"
      // is itself a contested question, which is why this is a suggestion.
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
      // Genuinely depends on who bears the risk under this contract. Offering a
      // guess here would be the app deciding entitlement.
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
  /** §3.5 — set when the recorded method may not satisfy the contract. */
  methodWarning?: string;
  /** §3.4 Fraser element 4 — the second notice nobody remembers. */
  accelerationPrompt?: string;
  /** One-line headline for a card or an inbox row. */
  headline: string;
  detail: string;
  /** Inbox severity, matching the useSmartInbox 1..3 scale. */
  severity: 1 | 2 | 3;
}

/**
 * How long the owner gets to answer an extension request before the app raises
 * the constructive-acceleration prompt. Fraser element 3 is "denied the request
 * or failed to act on it within a reasonable time"; what is reasonable is a
 * question of fact, so this is a nudge threshold and nothing more.
 */
export const OWNER_RESPONSE_WINDOW_DAYS = 14;

function initialNotice(event: DelayEvent): DelayNotice | undefined {
  return (event.notices ?? []).find((n) => n.kind === 'initial');
}

function hasSupplementalNotice(event: DelayEvent): boolean {
  return (event.notices ?? []).some((n) => n.kind === 'supplemental');
}

/**
 * §3.4 — CONSTRUCTIVE ACCELERATION NEEDS THE NOTICE TWICE, AND EVERYONE MISSES
 * THE SECOND ONE.
 *
 *   Fraser Construction Co. v. United States, 384 F.3d 1354, 1361 (Fed. Cir.
 *   2004): "(1) … a delay that is excusable under the contract; (2) … a timely
 *   and sufficient request for an extension; (3) … the government denied the
 *   request or failed to act on it within a reasonable time; (4) … the
 *   government insisted on completion … within a shorter period …, AFTER WHICH
 *   THE CONTRACTOR NOTIFIED THE GOVERNMENT THAT IT REGARDED THE ALLEGED ORDER
 *   TO ACCELERATE AS A CONSTRUCTIVE CHANGE IN THE CONTRACT; and (5) … the
 *   contractor was required to expend extra resources."
 *
 * Element 4 is a second, separate notice. It is the most-missed element in this
 * body of law. Fires when: an initial notice exists, no CO has resolved the
 * event, no supplemental notice has been sent, and the owner has been sitting
 * on it past the response window.
 */
export function accelerationPromptFor(
  event: DelayEvent,
  nowMs: number,
  responseWindowDays: number = OWNER_RESPONSE_WINDOW_DAYS,
): string | null {
  const initial = initialNotice(event);
  if (!initial) return null;
  if (event.changeOrderId) return null;           // resolved — nothing to escalate
  if (hasSupplementalNotice(event)) return null;  // already sent
  const waited = daysSince(initial.sentAt, nowMs);
  if (waited === null || waited < responseWindowDays) return null;
  return (
    `The owner hasn't responded in ${waited} days. If they're still holding you to the ` +
    'original completion date, you may need to notify them in writing that you regard that ' +
    'as constructive acceleration — that second notice is a separate element of the claim.'
  );
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
 * Events on a project with no notice period produce an 'unset' status — that
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
    const accelerationPrompt = accelerationPromptFor(e, nowMs, opts.responseWindowDays) ?? undefined;

    const methodWarning = initial
      ? noticeMethodWarning(project?.noticeMethodRequired, initial.method) ?? undefined
      : undefined;

    // Notice already on the record — the clock has stopped. Keep it only when
    // asked for, or when there is an acceleration prompt or a method warning to
    // surface, because those are live obligations of their own.
    if (initial) {
      if (!includeGiven && !accelerationPrompt && !methodWarning) continue;
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
        accelerationPrompt,
        headline: accelerationPrompt
          ? `${label} · owner hasn't responded`
          : `${label} · notice recorded`,
        detail: accelerationPrompt ?? methodWarning ?? `Notice recorded ${initial.sentAt.slice(0, 10)} · ${noticeMethodLabel(initial.method)}`,
        severity: accelerationPrompt ? 2 : methodWarning ? 2 : 1,
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
        accelerationPrompt,
        headline: `${label} · set your notice period`,
        detail:
          `${projectName} has no written-notice window recorded, so MAGE can't tell you when ` +
          "notice is due. " + NOTICE_PERIOD_QUESTION,
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
      accelerationPrompt,
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
  needsSecondNotice: number;
} {
  let blown = 0, critical = 0, unset = 0, needsSecondNotice = 0;
  for (const s of statuses) {
    if (s.urgency === 'blown') blown += 1;
    if (s.urgency === 'critical') critical += 1;
    if (s.urgency === 'unset') unset += 1;
    if (s.accelerationPrompt) needsSecondNotice += 1;
  }
  return { total: statuses.length, blown, critical, unset, needsSecondNotice };
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
