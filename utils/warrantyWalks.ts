// Warranty walk reminders — walk the job with the owner a month before the
// contractor's workmanship warranty closes.
//
// Best practice is to walk the project with the owner shortly before the
// workmanship warranty expires, to surface latent defects while they are
// still the contractor's to fix — anything missed becomes the owner's
// problem. On a one-year warranty that is the familiar 11-month walk.
//
// This file derives upcoming walks from the project list and exposes them to
// the home-screen banner and the walk screen. No database changes beyond the
// fields already on Project (substantialCompletionDate, closedAt,
// warrantyWalkCompletedAt).
//
// WHEN THE WARRANTY STARTS (#136). Substantial completion when it is recorded
// (the Closeout Binder's G704 writes it), otherwise the day he closed the job
// (closedAt, while the job is closed or completed — every close path writes
// it; almost none write the G704 date, and production had 0 closed jobs with
// one). Reading only substantialCompletionDate meant a job closed from the
// binder without a G704 never produced a walk reminder at all — and the
// banner is the only way into /warranty-walk. The alert carries which date it
// counted from, so a screen can say "counted from the day you closed the job"
// instead of presenting the close date as the certified completion date.
// consumerPassport.ts reads the same two fields in the same order.
//
// HOW LONG (#142). The GC's own warranty length (utils/paymentTerms
// resolveWarrantyMonths — the number his contract prints), not a hard-wired
// 12. A 24-month warranty was prompted at month 11 and dropped at month 13, so
// no walk was ever offered before its real end. 12 only when he has not set
// one, and the alert says so (`warrantyMonthsAssumed`). Dates are CALENDAR
// months (addCalendarMonths clamps Jan 31 + 1 month to Feb 28) and whole local
// days — the old 30-day "month" put the walk ~5 days early a year out, and
// `new Date('YYYY-MM-DD')` read the completion day as UTC midnight.

import type { Project } from '@/types';
import {
  addCalendarDays, addCalendarMonths, calendarDayOf, daysUntilCalendarDay, parseCalendarDay, toCalendarDayString,
} from '@/utils/calendarDate';

/** Surface the walk this many days before it is due. */
const LOOKAHEAD_DAYS = 90;
/** Keep flagging a missed walk this many days past the REAL expiry. */
const EXPIRED_GRACE_DAYS = 30;
/** Warranties this short walk about two weeks before they close — "month
 *  (N - 1)" of a 1- to 3-month warranty is on or right after completion. */
const SHORT_WARRANTY_MONTHS = 3;
const SHORT_WARRANTY_LEAD_DAYS = 14;
/** The length assumed when the GC has not set one. */
export const DEFAULT_WARRANTY_MONTHS = 12;

export type WarrantyStartSource = 'substantial_completion' | 'closed';

export interface WarrantyWalkAlert {
  project: Project;
  /** Days until the walk is due (negative = past due). */
  daysUntilWalk: number;
  /** Calendar day ('YYYY-MM-DD') the walk should happen by. */
  walkDueDate: string;
  /** Calendar day ('YYYY-MM-DD') the warranty expires. */
  warrantyExpiresAt: string;
  /** Days until the warranty expires (negative = already expired). */
  daysUntilWarrantyExpires: number;
  /** Severity for UI: 'upcoming' (1-3mo away), 'soon' (within 30d), 'urgent' (within 7d / past) */
  severity: 'upcoming' | 'soon' | 'urgent';
  /** The warranty length the dates were computed with. */
  warrantyMonths: number;
  /** True when no warranty length is set and DEFAULT_WARRANTY_MONTHS was used. */
  warrantyMonthsAssumed: boolean;
  /** Which project date the warranty was counted from. */
  warrantyStartSource: WarrantyStartSource;
  /** That date, as a calendar day. */
  warrantyStartDate: string;
}

/** The warranty length to compute with: his months when they are a real
 *  positive whole number, otherwise 12 — flagged as assumed. */
export function resolveWalkMonths(warrantyMonths?: number | null): { months: number; assumed: boolean } {
  if (typeof warrantyMonths === 'number' && Number.isInteger(warrantyMonths) && warrantyMonths > 0) {
    return { months: warrantyMonths, assumed: false };
  }
  return { months: DEFAULT_WARRANTY_MONTHS, assumed: true };
}

/** '11-month' for a 12-month warranty, '23-month' for 24; 'pre-expiry' for a
 *  warranty of 3 months or less, whose walk is not at a month mark. */
export function warrantyWalkLabel(months: number): string {
  return months > SHORT_WARRANTY_MONTHS ? `${months - 1}-month` : 'pre-expiry';
}

/** The banner / screen title: '11-month warranty walk', 'Pre-expiry warranty walk'. */
export function warrantyWalkTitle(months: number): string {
  const label = warrantyWalkLabel(months);
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} warranty walk`;
}

/**
 * The walk schedule for one project, whatever today is — or null when the
 * project has no usable start date. getUpcomingWarrantyWalks filters these to
 * the ones worth a banner; the walk screen reads it directly so it can say
 * which date the warranty counts from.
 */
export function warrantyWalkScheduleFor(
  p: Pick<Project, 'substantialCompletionDate' | 'closedAt' | 'status'>,
  warrantyMonths?: number | null,
  now: Date = new Date(),
): Omit<WarrantyWalkAlert, 'project' | 'severity'> | null {
  const sc = calendarDayOf(p.substantialCompletionDate);
  // The close date counts only while the job IS closed (or completed): a job
  // reopened after a close keeps its stale closedAt, and its warranty has not
  // started. A recorded substantial-completion date counts whatever the status.
  const closedNow = p.status === 'closed' || p.status === 'completed';
  const closed = sc || !closedNow ? null : calendarDayOf(p.closedAt);
  const start = sc ?? closed;
  if (!start) return null;
  const warrantyStartSource: WarrantyStartSource = sc ? 'substantial_completion' : 'closed';

  const { months, assumed } = resolveWalkMonths(warrantyMonths);
  const expires = addCalendarMonths(start, months);
  if (!expires) return null;
  let walk: string | null;
  if (months <= SHORT_WARRANTY_MONTHS) {
    const exp = parseCalendarDay(expires);
    walk = exp ? toCalendarDayString(addCalendarDays(exp, -SHORT_WARRANTY_LEAD_DAYS)) : null;
  } else {
    walk = addCalendarMonths(start, Math.max(1, months - 1));
  }
  if (!walk) return null;
  const daysUntilWalk = daysUntilCalendarDay(walk, now);
  const daysUntilWarrantyExpires = daysUntilCalendarDay(expires, now);
  if (daysUntilWalk === null || daysUntilWarrantyExpires === null) return null;
  return {
    daysUntilWalk,
    walkDueDate: walk,
    warrantyExpiresAt: expires,
    daysUntilWarrantyExpires,
    warrantyMonths: months,
    warrantyMonthsAssumed: assumed,
    warrantyStartSource,
    warrantyStartDate: start,
  };
}

/**
 * Projects whose walk is due within ~3 months, or missed less than 30 days
 * after the warranty actually expired, and that have not logged a walk yet.
 * Sorted by how soon the walk needs to happen.
 *
 * `warrantyMonths` is the GC's workmanship warranty (resolveWarrantyMonths of
 * his settings); omitted or null = 12, flagged on each alert. `now` is
 * injectable for the validator.
 */
export function getUpcomingWarrantyWalks(
  projects: Project[],
  warrantyMonths?: number | null,
  now: Date = new Date(),
): WarrantyWalkAlert[] {
  const out: WarrantyWalkAlert[] = [];

  for (const p of projects) {
    if (p.warrantyWalkCompletedAt) continue;
    const schedule = warrantyWalkScheduleFor(p, warrantyMonths, now);
    if (!schedule) continue;

    // Only surface when the walk is within ~3 months ahead, and keep it up to
    // a month past the REAL expiry (after that the walk is archival — until
    // then it is flagged urgent so the GC sees he missed it).
    if (schedule.daysUntilWalk > LOOKAHEAD_DAYS) continue;
    if (schedule.daysUntilWarrantyExpires < -EXPIRED_GRACE_DAYS) continue;

    let severity: WarrantyWalkAlert['severity'] = 'upcoming';
    if (schedule.daysUntilWalk <= 7) severity = 'urgent';
    else if (schedule.daysUntilWalk <= 30) severity = 'soon';

    out.push({ project: p, severity, ...schedule });
  }

  // Sort: most urgent first
  out.sort((a, b) => a.daysUntilWalk - b.daysUntilWalk);
  return out;
}

/** Friendly label for the banner. A walk counted from the close date says so
 *  — the close tap is not a certified completion date (#136). */
export function describeWalkTiming(alert: WarrantyWalkAlert): string {
  const d = alert.daysUntilWalk;
  let timing: string;
  if (d < 0) timing = `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} overdue`;
  else if (d === 0) timing = 'due today';
  else if (d === 1) timing = 'due tomorrow';
  else if (d < 14) timing = `due in ${d} days`;
  else if (d < 60) timing = `due in ${Math.round(d / 7)} weeks`;
  else timing = `due in ${Math.round(d / 30)} months`;
  return alert.warrantyStartSource === 'closed' ? `${timing} · counted from close date` : timing;
}

// ── The walk in progress (#143) ─────────────────────────────────────────────
//
// Every tick, flag and note of a walk lived only in screen memory: a swipe
// back, or iOS evicting the app while he checked Photos, lost twelve checked
// items and three flagged defects — and a flag only becomes a punch item when
// the walk is logged. The screen saves a draft per project under this key
// (the `mageid_` prefix keeps it inside wipeLocalUserCache's tenant sweep and
// the storage-hygiene check) and restores it on open. Pure codec here so bun
// can test it; the screen owns the AsyncStorage calls.

export const WALK_DRAFT_KEY_PREFIX = 'mageid_warranty_walk_draft:';

export function walkDraftKey(projectId: string): string {
  return `${WALK_DRAFT_KEY_PREFIX}${projectId}`;
}

export interface WalkItemState {
  checked: boolean;
  needsAttention: boolean;
  notes: string;
}

export interface WalkDraft {
  items: Record<string, WalkItemState>;
  overallNotes: string;
  /** ISO instant of the last change. */
  updatedAt: string;
}

export function emptyWalkItems(itemIds: readonly string[]): Record<string, WalkItemState> {
  return Object.fromEntries(itemIds.map(id => [id, { checked: false, needsAttention: false, notes: '' }]));
}

/** True when there is nothing worth keeping — no tick, flag or note. */
export function walkDraftIsEmpty(items: Record<string, WalkItemState>, overallNotes: string): boolean {
  return overallNotes.trim() === ''
    && Object.values(items).every(s => !s.checked && !s.needsAttention && s.notes.trim() === '');
}

/**
 * A stored draft, merged onto TODAY's checklist ids: an item the checklist no
 * longer has is dropped, a new one starts unticked, and a malformed field
 * reads as its empty value — so a checklist change or a hand-edited value can
 * never crash the screen. Null when there is nothing to restore: no draft,
 * unreadable JSON, an empty draft, or a draft OLDER than the walk already
 * logged for this job (`completedAt`) — that one is stale, the walk it was
 * for is done. A draft started after a logged walk (a re-walk) still restores.
 */
export function parseWalkDraft(
  raw: string | null | undefined,
  itemIds: readonly string[],
  completedAt?: string | null,
): WalkDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const d = parsed as { items?: unknown; overallNotes?: unknown; updatedAt?: unknown };
  const updatedAt = typeof d.updatedAt === 'string' ? d.updatedAt : '';
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) return null;
  const doneMs = completedAt ? Date.parse(completedAt) : NaN;
  if (Number.isFinite(doneMs) && updatedMs <= doneMs) return null;
  const stored = (d.items && typeof d.items === 'object') ? d.items as Record<string, unknown> : {};
  const items = emptyWalkItems(itemIds);
  for (const id of itemIds) {
    const v = stored[id];
    if (!v || typeof v !== 'object') continue;
    const r = v as { checked?: unknown; needsAttention?: unknown; notes?: unknown };
    items[id] = {
      checked: r.checked === true,
      needsAttention: r.needsAttention === true,
      notes: typeof r.notes === 'string' ? r.notes : '',
    };
  }
  const overallNotes = typeof d.overallNotes === 'string' ? d.overallNotes : '';
  if (walkDraftIsEmpty(items, overallNotes)) return null;
  return { items, overallNotes, updatedAt };
}
