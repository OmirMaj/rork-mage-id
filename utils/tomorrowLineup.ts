// tomorrowLineup.ts — "who is on site tomorrow, and what do they need to know",
// one ready-to-send text per sub.
//
// The GC's 3 pm ritual: read tomorrow off the schedule, then text every sub
// their slice — the work, the freight-elevator slot the building gave him, the
// load that is coming, the inspection. This builds those texts from his own
// records and nothing else. It never sends anything: the screen opens the share
// sheet / SMS / email compose on HIS tap (crewDispatch's share path), and every
// message is editable first.
//
// GROUNDED, NOT GUESSED:
//   • Tasks land on a day through the schedule's own calendar — the same
//     helpers the 6 AM brief and Home's TODAY ON SITE use (utils/scheduleOps
//     resolveScheduleAnchor + scheduleDayOnCalendar + isTaskActiveOnScheduleDay,
//     held together with the server copy by validate-digest-schedule-today).
//     No day arithmetic is re-derived here.
//   • A delivery belongs to a sub ONLY through a record: Delivery.commitmentId
//     → Commitment.subcontractorId. Never by matching a name or a trade word in
//     the description — a delivery that says "for Acme" but has no commitment
//     goes to the site-wide block.
//   • A time is printed only when a record carries one (a delivery or access
//     window). Anything without one reads "time not set". PermitInspection has
//     no time field at all — `scheduledFor` is a calendar day — so EVERY
//     inspection reads "time not set"; a time is never guessed.
//   • Only a CONFIRMED access slot is called booked; a requested one says the
//     building has not confirmed it; denied / cancelled ones are left out of
//     every message and named in the gaps.
//
// Pure: no React, no React Native, no network, no send API.
// scripts/validate-tomorrow-lineup.ts runs it under bun and scans this file's
// imports for Linking / SMS / fetch / supabase.

import type { Commitment, Permit, PermitInspection, ProjectSchedule, ScheduleTask, Subcontractor } from '@/types';
import type { Delivery } from '@/utils/deliverySchedule';
import { ACCESS_KIND_LABEL, type AccessReservation } from '@/utils/buildingAccess';
import {
  resolveScheduleAnchor, scheduleDayOnCalendar, isTaskActiveOnScheduleDay, isMilestoneOnScheduleDay,
} from '@/utils/scheduleOps';
import { parseCalendarDay, toCalendarDayString, addCalendarDays } from '@/utils/calendarDate';
import { isWorkingDayOfWeek } from '@/utils/cpm';
import { decodePermitInspectionNotes } from '@/utils/permitInspectionHistory';

export const TIME_NOT_SET = 'time not set';
export const NO_SCHEDULE_NOTE = 'No schedule on this job — the lineup reads tasks from the schedule.';
export const MESSAGE_SOFT_LIMIT = 600;
/** After this local hour the lineup is what he sends; before it, a preview. */
export const READY_HOUR = 15;

export interface LineupTask { id: string; name: string; area?: string; status: ScheduleTask['status']; milestone: boolean }
export interface LineupDelivery { id: string; text: string; window?: string; confirmed: boolean }
export interface LineupAccess { id: string; kindLabel: string; window?: string; status: AccessReservation['status']; confirmationRef?: string; text: string }
export interface LineupInspection { id: string; name: string; permitLabel?: string; text: string }

export interface LineupSub {
  sub: { id: string; name: string; phone?: string; email?: string };
  /** True when neither a phone nor an email is on file — Send opens the share sheet. */
  noContact: boolean;
  tasks: LineupTask[];
  deliveries: LineupDelivery[];
  access: LineupAccess[];
  inspections: LineupInspection[];
  message: string;
}

export interface Lineup {
  date: string;
  projectLabel: string;
  /** "tomorrow (Tue, Sep 29)" or "on Mon, Sep 28". */
  dayPhrase: string;
  perSub: LineupSub[];
  siteWide: { deliveries: LineupDelivery[]; access: LineupAccess[]; inspections: LineupInspection[] };
  gaps: string[];
  /** One line for the top of the screen, or null when there is nothing. */
  summary: string | null;
  /** Set when there is nothing to send (no schedule / nothing on the day). */
  emptyNote: string | null;
}

export interface LineupInput {
  project: { id: string; name: string; location?: string };
  /** The day the lineup is for, 'YYYY-MM-DD'. */
  date: string;
  schedule: Pick<ProjectSchedule, 'startDate' | 'workingDaysPerWeek' | 'nonWorkingDates' | 'tasks'> | null | undefined;
  subs: readonly Subcontractor[];
  commitments: readonly Commitment[];
  deliveries: readonly Delivery[];
  accessReservations: readonly AccessReservation[];
  permits: readonly Permit[];
  now: Date;
}

// ─── Day helpers ───────────────────────────────────────────────────────────

function shortDay(day: string): string {
  const d = parseCalendarDay(day);
  if (!d) return day;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "tomorrow (Tue, Sep 29)" when `date` is the day after `now`, else "on Mon, Sep 28". */
export function dayPhraseFor(date: string, now: Date): string {
  const tomorrow = toCalendarDayString(addCalendarDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 1));
  return date === tomorrow ? `tomorrow (${shortDay(date)})` : `on ${shortDay(date)}`;
}

/**
 * The next day work happens after `now`: tomorrow, skipped forward past the
 * schedule's non-working weekdays (workingDaysPerWeek — the rule the CPM engine
 * uses) and its site closures. With no schedule, or no working-week on it, the
 * answer is simply tomorrow; the screen lets him change it.
 */
export function nextWorkingDay(
  now: Date,
  schedule?: Pick<ProjectSchedule, 'workingDaysPerWeek' | 'nonWorkingDates'> | null,
): string {
  let d = addCalendarDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 1);
  const wdpw = schedule?.workingDaysPerWeek;
  if (!schedule || !wdpw || !Number.isFinite(wdpw)) return toCalendarDayString(d);
  const closed = new Set(schedule.nonWorkingDates ?? []);
  for (let i = 0; i < 21; i++) {
    const iso = toCalendarDayString(d);
    if (isWorkingDayOfWeek(d.getDay(), wdpw) && !closed.has(iso)) return iso;
    d = addCalendarDays(d, 1);
  }
  return toCalendarDayString(addCalendarDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 1));
}

/** The screen headline: after 3 pm local it is the list he sends; before, a preview. */
export function lineupHeadline(now: Date): string {
  return now.getHours() >= READY_HOUR
    ? "Tomorrow's lineup — ready to send"
    : "Tomorrow's lineup (preview — schedules can still change today)";
}

// ─── Record → text ─────────────────────────────────────────────────────────

function subName(s: Pick<Subcontractor, 'companyName' | 'contactName' | 'legalName'> | undefined): string {
  return s?.companyName?.trim() || s?.legalName?.trim() || s?.contactName?.trim() || 'Subcontractor';
}

function deliveryOf(d: Delivery): LineupDelivery {
  const what = d.description?.trim() || 'Delivery';
  const from = d.supplier?.trim() ? ` from ${d.supplier.trim()}` : '';
  const window = d.window?.trim() || undefined;
  const when = window ? `window ${window}` : TIME_NOT_SET;
  const confirmed = d.status === 'confirmed';
  return {
    id: d.id,
    window,
    confirmed,
    text: `${what}${from}, ${when}${confirmed ? '' : ' (not confirmed by the supplier)'}`,
  };
}

function accessOf(r: AccessReservation): LineupAccess {
  const kindLabel = ACCESS_KIND_LABEL[r.kind] ?? r.kind;
  const window = r.window?.trim() || undefined;
  const ref = r.confirmationRef?.trim() || undefined;
  const text = r.status === 'confirmed'
    ? `${kindLabel} booked ${window ?? `(${TIME_NOT_SET})`}${ref ? `, ref ${ref}` : ''}`
    : `${kindLabel} ${window ? `${window} ` : ''}requested, not yet confirmed by the building`;
  return { id: r.id, kindLabel, window, status: r.status, confirmationRef: ref, text };
}

function inspectionOf(i: PermitInspection, p: Permit): LineupInspection {
  const name = i.name?.trim() || 'Inspection';
  const label = /inspection$/i.test(name) ? name : `${name} inspection`;
  // PermitInspection carries a calendar day only (scheduledFor) — no time field
  // exists, so the time is ALWAYS "time not set". Never guess one.
  return { id: `${p.id}:${i.id}`, name, permitLabel: p.permitNumber || undefined, text: `${label} — ${TIME_NOT_SET}` };
}

function taskText(t: LineupTask): string {
  return `${t.name}${t.area ? ` (${t.area})` : ''}${t.milestone ? ' — milestone' : ''}`;
}

function listOrNone<T>(items: readonly T[], fmt: (x: T) => string, max = 6): string {
  const shown = items.slice(0, max).map(fmt);
  const more = items.length - shown.length;
  return shown.join('; ') + (more > 0 ? `; +${more} more` : '');
}

/**
 * Plain-text message, crewDispatch's style (a greeting line would push it past
 * one SMS screen; this is the one-paragraph form a sub reads at 6 am).
 */
export function buildLineupMessage(opts: {
  subName: string;
  dayPhrase: string;
  place: string;
  tasks: readonly LineupTask[];
  access: readonly LineupAccess[];
  deliveries: readonly LineupDelivery[];
  inspections: readonly LineupInspection[];
}): string {
  const build = (maxTasks: number, maxOther: number) => {
    const parts: string[] = [];
    parts.push(`${opts.subName}: ${opts.dayPhrase} at ${opts.place}: ${opts.tasks.length ? listOrNone(opts.tasks, taskText, maxTasks) : 'no tasks on the schedule for you'}.`);
    if (opts.access.length) parts.push(`Access: ${listOrNone(opts.access, a => a.text, maxOther)}.`);
    if (opts.deliveries.length) parts.push(`Deliveries: ${listOrNone(opts.deliveries, d => d.text, maxOther)}.`);
    if (opts.inspections.length) parts.push(`Inspections: ${listOrNone(opts.inspections, i => i.text, maxOther)}.`);
    parts.push("Reply to confirm you'll be there.");
    return parts.join(' ');
  };
  let msg = build(6, 4);
  for (let t = 5, o = 3; msg.length > MESSAGE_SOFT_LIMIT && (t > 1 || o > 1); t = Math.max(1, t - 1), o = Math.max(1, o - 1)) {
    msg = build(t, o);
  }
  return msg;
}

// ─── The lineup ────────────────────────────────────────────────────────────

export function buildLineup(input: LineupInput): Lineup {
  const { project, date, schedule, now } = input;
  const place = project.location?.trim() || project.name;
  const projectLabel = project.location?.trim() ? `${project.name} · ${project.location.trim()}` : project.name;
  const dayPhrase = dayPhraseFor(date, now);
  const gaps: string[] = [];
  const roster = new Map(input.subs.map(s => [s.id, s]));

  // 1. Tasks on the day — through the schedule's own calendar.
  const tasks = schedule?.tasks ?? [];
  const anchor = resolveScheduleAnchor(schedule ?? null, now);
  const target = parseCalendarDay(date);
  const noSchedule = !schedule || tasks.length === 0 || !anchor.dated;
  if (schedule && tasks.length > 0 && !anchor.dated) {
    gaps.push("This schedule has no start date, so its tasks can't be put on a calendar day. Set the start date on the schedule.");
  }
  let dayNumber: number | null = null;
  if (!noSchedule && anchor.date && target) {
    dayNumber = scheduleDayOnCalendar(anchor.date, target, schedule!.workingDaysPerWeek ?? 5, schedule!.nonWorkingDates);
    if (dayNumber === null && target.getTime() >= anchor.date.getTime()) {
      gaps.push(`${shortDay(date)} is not a working day on this schedule.`);
    } else if (dayNumber === null) {
      gaps.push(`The schedule starts ${shortDay(anchor.iso!)} — nothing on it before then.`);
    }
  }
  const onDay: ScheduleTask[] = dayNumber === null ? [] : tasks.filter(t =>
    !t.isSummary && (isTaskActiveOnScheduleDay(t, dayNumber!) || isMilestoneOnScheduleDay(t, dayNumber!)));

  const tasksBySub = new Map<string, LineupTask[]>();
  const unassigned: string[] = [];
  const unknownSub: string[] = [];
  for (const t of onDay) {
    const lt: LineupTask = {
      id: t.id,
      name: t.title?.trim() || 'Task',
      area: t.phase?.trim() && t.phase.trim() !== t.title?.trim() ? t.phase.trim() : undefined,
      status: t.status,
      milestone: !!t.isMilestone,
    };
    if (!t.assignedSubId) { unassigned.push(lt.name); continue; }
    if (!roster.has(t.assignedSubId)) { unknownSub.push(lt.name); continue; }
    const list = tasksBySub.get(t.assignedSubId) ?? [];
    list.push(lt);
    tasksBySub.set(t.assignedSubId, list);
  }
  const dayWord = dayPhrase.startsWith('tomorrow') ? 'tomorrow' : dayPhrase;
  if (unassigned.length) {
    gaps.push(`${unassigned.length} task${unassigned.length === 1 ? '' : 's'} ${dayWord} ${unassigned.length === 1 ? 'has' : 'have'} no sub assigned — ${unassigned.length === 1 ? "it's" : "they're"} not in any message: ${unassigned.join(', ')}.`);
  }
  if (unknownSub.length) {
    gaps.push(`${unknownSub.length} task${unknownSub.length === 1 ? ' is' : 's are'} assigned to a sub no longer in your Subs list — not in any message: ${unknownSub.join(', ')}.`);
  }

  // 2. Deliveries on the day. A sub gets one ONLY through commitmentId →
  //    Commitment.subcontractorId.
  const commitById = new Map(input.commitments.map(c => [c.id, c]));
  const deliveriesBySub = new Map<string, LineupDelivery[]>();
  const deliverySub = new Map<string, string>(); // delivery id → sub id
  const siteDeliveries: LineupDelivery[] = [];
  for (const d of input.deliveries) {
    if (d.projectId !== project.id || (d.expectedDate ?? '').slice(0, 10) !== date) continue;
    if (d.status === 'cancelled' || d.status === 'delivered') continue;
    const subId = d.commitmentId ? commitById.get(d.commitmentId)?.subcontractorId : undefined;
    const ld = deliveryOf(d);
    if (subId && roster.has(subId)) {
      const list = deliveriesBySub.get(subId) ?? [];
      list.push(ld);
      deliveriesBySub.set(subId, list);
      deliverySub.set(d.id, subId);
    } else {
      siteDeliveries.push(ld);
    }
  }

  // 3. Access slots on the day. A slot tied (deliveryId) to a sub's delivery is
  //    that sub's; every other live slot is the building's and goes to everyone.
  const accessBySub = new Map<string, LineupAccess[]>();
  const siteAccess: LineupAccess[] = [];
  for (const r of input.accessReservations) {
    if (r.projectId !== project.id || (r.date ?? '').slice(0, 10) !== date) continue;
    if (r.status === 'denied' || r.status === 'cancelled') {
      gaps.push(`The ${ACCESS_KIND_LABEL[r.kind] ?? r.kind} slot for ${shortDay(date)} was ${r.status === 'denied' ? 'denied by the building' : 'cancelled'} — it is not in any message.`);
      continue;
    }
    const la = accessOf(r);
    const subId = r.deliveryId ? deliverySub.get(r.deliveryId) : undefined;
    if (subId) {
      const list = accessBySub.get(subId) ?? [];
      list.push(la);
      accessBySub.set(subId, list);
    } else {
      siteAccess.push(la);
    }
  }

  // 4. Inspections on the day (result still 'scheduled'). Nothing ties an
  //    inspection to a sub, so they are site-wide and every message carries them.
  const inspections: LineupInspection[] = [];
  for (const p of input.permits) {
    if (p.projectId !== project.id) continue;
    const history = p.inspections ?? decodePermitInspectionNotes(p.inspectionNotes).inspections;
    for (const i of history) {
      if (i.result === 'scheduled' && (i.scheduledFor ?? '').slice(0, 10) === date) inspections.push(inspectionOf(i, p));
    }
  }

  // 5. One message per sub with work, a delivery or a slot of their own.
  const subIds = new Set<string>([...tasksBySub.keys(), ...deliveriesBySub.keys(), ...accessBySub.keys()]);
  const perSub: LineupSub[] = [...subIds].map(id => {
    const s = roster.get(id)!;
    const name = subName(s);
    const phone = s.phone?.trim() || undefined;
    const email = s.email?.trim() || undefined;
    const tasksFor = tasksBySub.get(id) ?? [];
    const deliveriesFor = deliveriesBySub.get(id) ?? [];
    const accessFor = [...(accessBySub.get(id) ?? []), ...siteAccess];
    return {
      sub: { id, name, phone, email },
      noContact: !phone && !email,
      tasks: tasksFor,
      deliveries: deliveriesFor,
      access: accessFor,
      inspections,
      message: buildLineupMessage({
        subName: name, dayPhrase, place, tasks: tasksFor, access: accessFor, deliveries: deliveriesFor, inspections,
      }),
    };
  });
  perSub.sort((a, b) => a.sub.name.localeCompare(b.sub.name));

  // 6. Empty + summary.
  const nothing = perSub.length === 0 && siteDeliveries.length === 0 && siteAccess.length === 0 && inspections.length === 0;
  let emptyNote: string | null = null;
  if (noSchedule && nothing) emptyNote = NO_SCHEDULE_NOTE;
  else if (nothing) emptyNote = `Nothing scheduled for ${shortDay(date)} on this job`;
  else if (noSchedule) gaps.push(NO_SCHEDULE_NOTE);

  const bits: string[] = [];
  for (const s of perSub) {
    const areas = [...new Set(s.tasks.map(t => t.area).filter(Boolean))];
    bits.push(`${s.sub.name}${areas.length ? ` (${areas.join(', ')})` : ''}`);
  }
  for (const a of siteAccess) bits.push(a.text);
  for (const s of perSub) for (const a of accessBySub.get(s.sub.id) ?? []) bits.push(a.text);
  for (const d of [...[...deliveriesBySub.values()].flat(), ...siteDeliveries]) bits.push(`delivery: ${d.text}`);
  for (const i of inspections) bits.push(i.text);
  const cap = dayPhrase.charAt(0).toUpperCase() + dayPhrase.slice(1);
  const summary = bits.length ? `${cap} at ${place}: ${bits.join(', ')}.` : null;

  return {
    date, projectLabel, dayPhrase, perSub,
    siteWide: { deliveries: siteDeliveries, access: siteAccess, inspections },
    gaps, summary, emptyNote,
  };
}
