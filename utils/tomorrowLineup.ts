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
// TWO LANGUAGES (Spanish Phase 1b, W3 ESSHELL; docs/I18N.md §9):
//   • `lang` — the app language of the person holding the phone: the
//     headline, the summary, the gaps (tú in Spanish). Default 'en'.
//   • `languageFor(sub)` — the language EACH SUB's text goes out in: the
//     recipient's, never the sender's (usted in Spanish; outbound.lineup.*
//     keys). Default English for everyone. The screen passes
//     lineupLanguageFor (utils/lineupTexts), which answers English until
//     Spanish is switched on.
// With both at 'en' every string is byte-identical to the English-only build.
// Dates in Spanish come from i18n/format (never numeric: "mar 29 sept").
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
import { t, tn } from '@/i18n/core';
import { formatDateOptsL } from '@/i18n/format';
import type { DisplayLang, Lang } from '@/i18n/types';

export const TIME_NOT_SET = 'time not set';
export const NO_SCHEDULE_NOTE = 'No schedule on this project. The lineup reads tasks from the schedule.';
export const MESSAGE_SOFT_LIMIT = 600;
/** After this local hour the lineup is what he sends; before it, a preview. */
export const READY_HOUR = 15;

/** "time not set" in a language (a sub's text, or the screen). */
export function timeNotSet(lang: DisplayLang = 'en'): string {
  return t('outbound.lineup.timeNotSet', 'time not set', undefined, lang);
}

/** The no-schedule sentence in the app language. */
export function noScheduleNote(lang: DisplayLang = 'en'): string {
  return t('field.lineup.noScheduleNote', 'No schedule on this project. The lineup reads tasks from the schedule.', undefined, lang);
}

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
  /** The language `message` is written in (the sub's, never the sender's). */
  lang: Lang;
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
  /** The app language (headline, summary, gaps). Default 'en'. */
  lang?: DisplayLang;
  /** The language each sub's text goes out in. Default English for every sub. */
  languageFor?: (sub: Subcontractor) => Lang;
}

// ─── Day helpers ───────────────────────────────────────────────────────────

const fmtLang = (lang: DisplayLang): Lang => (lang === 'es' ? 'es' : 'en');

function shortDay(day: string, lang: DisplayLang = 'en'): string {
  const d = parseCalendarDay(day);
  if (!d) return day;
  // en: exactly d.toLocaleDateString('en-US', …) ("Tue, Sep 29"); es: "mar 29 sept".
  return formatDateOptsL(d, { weekday: 'short', month: 'short', day: 'numeric' }, fmtLang(lang));
}

function isTomorrow(date: string, now: Date): boolean {
  const tomorrow = toCalendarDayString(addCalendarDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 1));
  return date === tomorrow;
}

/** "tomorrow (Tue, Sep 29)" when `date` is the day after `now`, else "on Mon, Sep 28". */
export function dayPhraseFor(date: string, now: Date, lang: DisplayLang = 'en'): string {
  return isTomorrow(date, now)
    ? t('field.lineup.dayTomorrow', 'tomorrow ({day})', { day: shortDay(date, lang) }, lang)
    : t('field.lineup.dayOn', 'on {day}', { day: shortDay(date, lang) }, lang);
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
export function lineupHeadline(now: Date, lang: DisplayLang = 'en'): string {
  return now.getHours() >= READY_HOUR
    ? t('field.lineup.headlineReady', "Tomorrow's lineup — ready to send", undefined, lang)
    : t('field.lineup.headlinePreview', "Tomorrow's lineup (preview — schedules can still change today)", undefined, lang);
}

// ─── Record → text ─────────────────────────────────────────────────────────

function subName(s: Pick<Subcontractor, 'companyName' | 'contactName' | 'legalName'> | undefined, lang: DisplayLang): string {
  return s?.companyName?.trim() || s?.legalName?.trim() || s?.contactName?.trim() || t('field.lineup.subFallback', 'Subcontractor', undefined, lang);
}

/** The access kind as a sub reads it. English is utils/buildingAccess's own label. */
function accessKindLabel(kind: AccessReservation['kind'], lang: DisplayLang): string {
  if (lang === 'en') return ACCESS_KIND_LABEL[kind] ?? kind;
  switch (kind) {
    case 'freight_elevator': return t('outbound.lineup.kind.freightElevator', 'freight elevator', undefined, lang);
    case 'dock': return t('outbound.lineup.kind.dock', 'loading dock', undefined, lang);
    case 'after_hours': return t('outbound.lineup.kind.afterHours', 'after-hours work', undefined, lang);
    case 'badging': return t('outbound.lineup.kind.badging', 'badging', undefined, lang);
    case 'hot_work': return t('outbound.lineup.kind.hotWork', 'hot work permit', undefined, lang);
    case 'shutdown': return t('outbound.lineup.kind.shutdown', 'system shutdown', undefined, lang);
    default: return ACCESS_KIND_LABEL[kind] ?? kind;
  }
}

function deliveryOf(d: Delivery, lang: DisplayLang = 'en'): LineupDelivery {
  const what = d.description?.trim() || t('outbound.lineup.deliveryFallback', 'Delivery', undefined, lang);
  const supplier = d.supplier?.trim();
  const item = supplier ? t('outbound.lineup.deliveryFrom', '{what} from {supplier}', { what, supplier }, lang) : what;
  const window = d.window?.trim() || undefined;
  const when = window ? t('outbound.lineup.window', 'window {window}', { window }, lang) : timeNotSet(lang);
  const confirmed = d.status === 'confirmed';
  const text = confirmed
    ? t('outbound.lineup.deliveryText', '{item}, {when}', { item, when }, lang)
    : t('outbound.lineup.deliveryUnconfirmed', '{item}, {when} (not confirmed by the supplier)', { item, when }, lang);
  return { id: d.id, window, confirmed, text };
}

function accessOf(r: AccessReservation, lang: DisplayLang = 'en'): LineupAccess {
  const kindLabel = accessKindLabel(r.kind, lang);
  const window = r.window?.trim() || undefined;
  const ref = r.confirmationRef?.trim() || undefined;
  let text: string;
  if (r.status === 'confirmed') {
    const slot = window ?? t('outbound.lineup.timeNotSetParens', '({time})', { time: timeNotSet(lang) }, lang);
    text = ref
      ? t('outbound.lineup.accessBookedRef', '{kind} booked {slot}, ref {ref}', { kind: kindLabel, slot, ref }, lang)
      : t('outbound.lineup.accessBooked', '{kind} booked {slot}', { kind: kindLabel, slot }, lang);
  } else {
    text = window
      ? t('outbound.lineup.accessRequestedWindow', '{kind} {window} requested, not yet confirmed by the building', { kind: kindLabel, window }, lang)
      : t('outbound.lineup.accessRequested', '{kind} requested, not yet confirmed by the building', { kind: kindLabel }, lang);
  }
  return { id: r.id, kindLabel, window, status: r.status, confirmationRef: ref, text };
}

function inspectionOf(i: PermitInspection, p: Permit, lang: DisplayLang = 'en'): LineupInspection {
  const name = i.name?.trim() || t('outbound.lineup.inspectionFallback', 'Inspection', undefined, lang);
  const label = /inspection$/i.test(name) ? name : t('outbound.lineup.inspectionNamed', '{name} inspection', { name }, lang);
  // PermitInspection carries a calendar day only (scheduledFor) — no time field
  // exists, so the time is ALWAYS "time not set". Never guess one.
  return {
    id: `${p.id}:${i.id}`, name, permitLabel: p.permitNumber || undefined,
    text: t('outbound.lineup.inspectionText', '{label} — {time}', { label, time: timeNotSet(lang) }, lang),
  };
}

function taskText(task: LineupTask, lang: DisplayLang = 'en'): string {
  const base = `${task.name}${task.area ? ` (${task.area})` : ''}`;
  return task.milestone ? t('outbound.lineup.milestone', '{task} — milestone', { task: base }, lang) : base;
}

function listOrNone<T>(items: readonly T[], fmt: (x: T) => string, max = 6, lang: DisplayLang = 'en'): string {
  const shown = items.slice(0, max).map(fmt);
  const more = items.length - shown.length;
  return shown.join('; ') + (more > 0 ? `; ${t('outbound.lineup.more', '+{count} more', { count: more }, lang)}` : '');
}

/**
 * Plain-text message, crewDispatch's style (a greeting line would push it past
 * one SMS screen; this is the one-paragraph form a sub reads at 6 am).
 * `lang` is the SUB's language (default 'en' — byte-identical English); every
 * part is a whole sentence with placeholders, and Spanish is usted.
 */
export function buildLineupMessage(opts: {
  subName: string;
  dayPhrase: string;
  place: string;
  tasks: readonly LineupTask[];
  access: readonly LineupAccess[];
  deliveries: readonly LineupDelivery[];
  inspections: readonly LineupInspection[];
  lang?: Lang;
}): string {
  const lang: Lang = opts.lang ?? 'en';
  const build = (maxTasks: number, maxOther: number) => {
    const parts: string[] = [];
    const work = opts.tasks.length
      ? listOrNone(opts.tasks, x => taskText(x, lang), maxTasks, lang)
      : t('outbound.lineup.noTasks', 'no tasks on the schedule for you', undefined, lang);
    parts.push(t('outbound.lineup.lead', '{sub}: {day} at {place}: {work}.', { sub: opts.subName, day: opts.dayPhrase, place: opts.place, work }, lang));
    if (opts.access.length) parts.push(t('outbound.lineup.accessLine', 'Access: {items}.', { items: listOrNone(opts.access, a => a.text, maxOther, lang) }, lang));
    if (opts.deliveries.length) parts.push(t('outbound.lineup.deliveriesLine', 'Deliveries: {items}.', { items: listOrNone(opts.deliveries, d => d.text, maxOther, lang) }, lang));
    if (opts.inspections.length) parts.push(t('outbound.lineup.inspectionsLine', 'Inspections: {items}.', { items: listOrNone(opts.inspections, i => i.text, maxOther, lang) }, lang));
    parts.push(t('outbound.lineup.replyConfirm', "Reply to confirm you'll be there.", undefined, lang));
    return parts.join(' ');
  };
  let msg = build(6, 4);
  for (let tk = 5, o = 3; msg.length > MESSAGE_SOFT_LIMIT && (tk > 1 || o > 1); tk = Math.max(1, tk - 1), o = Math.max(1, o - 1)) {
    msg = build(tk, o);
  }
  return msg;
}

// ─── The lineup ────────────────────────────────────────────────────────────

export function buildLineup(input: LineupInput): Lineup {
  const { project, date, schedule, now } = input;
  const lang: DisplayLang = input.lang ?? 'en';
  const languageFor = input.languageFor ?? ((): Lang => 'en');
  const place = project.location?.trim() || project.name;
  const projectLabel = project.location?.trim() ? `${project.name} · ${project.location.trim()}` : project.name;
  const dayPhrase = dayPhraseFor(date, now, lang);
  const gaps: string[] = [];
  const roster = new Map(input.subs.map(s => [s.id, s]));

  // 1. Tasks on the day — through the schedule's own calendar.
  const tasks = schedule?.tasks ?? [];
  const anchor = resolveScheduleAnchor(schedule ?? null, now);
  const target = parseCalendarDay(date);
  const noSchedule = !schedule || tasks.length === 0 || !anchor.dated;
  if (schedule && tasks.length > 0 && !anchor.dated) {
    gaps.push(t('field.lineup.gap.noStartDate', "This schedule has no start date, so its tasks can't be put on a calendar day. Set the start date on the schedule.", undefined, lang));
  }
  let dayNumber: number | null = null;
  if (!noSchedule && anchor.date && target) {
    dayNumber = scheduleDayOnCalendar(anchor.date, target, schedule!.workingDaysPerWeek ?? 5, schedule!.nonWorkingDates);
    if (dayNumber === null && target.getTime() >= anchor.date.getTime()) {
      gaps.push(t('field.lineup.gap.notWorkingDay', '{day} is not a working day on this schedule.', { day: shortDay(date, lang) }, lang));
    } else if (dayNumber === null) {
      gaps.push(t('field.lineup.gap.beforeStart', 'The schedule starts {day} — nothing on it before then.', { day: shortDay(anchor.iso!, lang) }, lang));
    }
  }
  const onDay: ScheduleTask[] = dayNumber === null ? [] : tasks.filter(task =>
    !task.isSummary && (isTaskActiveOnScheduleDay(task, dayNumber!) || isMilestoneOnScheduleDay(task, dayNumber!)));

  const tasksBySub = new Map<string, LineupTask[]>();
  const unassigned: string[] = [];
  const unknownSub: string[] = [];
  for (const task of onDay) {
    const lt: LineupTask = {
      id: task.id,
      name: task.title?.trim() || t('field.lineup.taskFallback', 'Task', undefined, lang),
      area: task.phase?.trim() && task.phase.trim() !== task.title?.trim() ? task.phase.trim() : undefined,
      status: task.status,
      milestone: !!task.isMilestone,
    };
    if (!task.assignedSubId) { unassigned.push(lt.name); continue; }
    if (!roster.has(task.assignedSubId)) { unknownSub.push(lt.name); continue; }
    const list = tasksBySub.get(task.assignedSubId) ?? [];
    list.push(lt);
    tasksBySub.set(task.assignedSubId, list);
  }
  const dayWord = isTomorrow(date, now) ? t('field.lineup.tomorrowWord', 'tomorrow', undefined, lang) : dayPhrase;
  if (unassigned.length) {
    gaps.push(tn('field.lineup.gap.unassigned', unassigned.length, {
      one: "{count} task {day} has no sub assigned — it's not in any message: {tasks}.",
      other: "{count} tasks {day} have no sub assigned — they're not in any message: {tasks}.",
    }, { day: dayWord, tasks: unassigned.join(', ') }, lang));
  }
  if (unknownSub.length) {
    gaps.push(tn('field.lineup.gap.unknownSub', unknownSub.length, {
      one: '{count} task is assigned to a sub no longer in your Subs list — not in any message: {tasks}.',
      other: '{count} tasks are assigned to a sub no longer in your Subs list — not in any message: {tasks}.',
    }, { tasks: unknownSub.join(', ') }, lang));
  }

  // 2. Deliveries on the day. A sub gets one ONLY through commitmentId →
  //    Commitment.subcontractorId.
  const commitById = new Map(input.commitments.map(c => [c.id, c]));
  const deliveriesBySub = new Map<string, Delivery[]>();
  const deliverySub = new Map<string, string>(); // delivery id → sub id
  const siteDeliveryRecords: Delivery[] = [];
  for (const d of input.deliveries) {
    if (d.projectId !== project.id || (d.expectedDate ?? '').slice(0, 10) !== date) continue;
    if (d.status === 'cancelled' || d.status === 'delivered') continue;
    const subId = d.commitmentId ? commitById.get(d.commitmentId)?.subcontractorId : undefined;
    if (subId && roster.has(subId)) {
      const list = deliveriesBySub.get(subId) ?? [];
      list.push(d);
      deliveriesBySub.set(subId, list);
      deliverySub.set(d.id, subId);
    } else {
      siteDeliveryRecords.push(d);
    }
  }
  const siteDeliveries = siteDeliveryRecords.map(d => deliveryOf(d, lang));

  // 3. Access slots on the day. A slot tied (deliveryId) to a sub's delivery is
  //    that sub's; every other live slot is the building's and goes to everyone.
  const accessBySub = new Map<string, AccessReservation[]>();
  const siteAccessRecords: AccessReservation[] = [];
  for (const r of input.accessReservations) {
    if (r.projectId !== project.id || (r.date ?? '').slice(0, 10) !== date) continue;
    if (r.status === 'denied' || r.status === 'cancelled') {
      const vars = { kind: accessKindLabel(r.kind, lang), day: shortDay(date, lang) };
      gaps.push(r.status === 'denied'
        ? t('field.lineup.gap.slotDenied', 'The {kind} slot for {day} was denied by the building — it is not in any message.', vars, lang)
        : t('field.lineup.gap.slotCancelled', 'The {kind} slot for {day} was cancelled — it is not in any message.', vars, lang));
      continue;
    }
    const subId = r.deliveryId ? deliverySub.get(r.deliveryId) : undefined;
    if (subId) {
      const list = accessBySub.get(subId) ?? [];
      list.push(r);
      accessBySub.set(subId, list);
    } else {
      siteAccessRecords.push(r);
    }
  }
  const siteAccess = siteAccessRecords.map(r => accessOf(r, lang));

  // 4. Inspections on the day (result still 'scheduled'). Nothing ties an
  //    inspection to a sub, so they are site-wide and every message carries them.
  const inspectionRecords: { i: PermitInspection; p: Permit }[] = [];
  for (const p of input.permits) {
    if (p.projectId !== project.id) continue;
    const history = p.inspections ?? decodePermitInspectionNotes(p.inspectionNotes).inspections;
    for (const i of history) {
      if (i.result === 'scheduled' && (i.scheduledFor ?? '').slice(0, 10) === date) inspectionRecords.push({ i, p });
    }
  }
  const inspections: LineupInspection[] = inspectionRecords.map(({ i, p }) => inspectionOf(i, p, lang));

  // 5. One message per sub with work, a delivery or a slot of their own — in
  //    THAT SUB's language (the texts are rebuilt from the records in it).
  const subIds = new Set<string>([...tasksBySub.keys(), ...deliveriesBySub.keys(), ...accessBySub.keys()]);
  const perSub: LineupSub[] = [...subIds].map(id => {
    const s = roster.get(id)!;
    const name = subName(s, lang);
    const phone = s.phone?.trim() || undefined;
    const email = s.email?.trim() || undefined;
    const subLang = languageFor(s);
    const tasksFor = tasksBySub.get(id) ?? [];
    const deliveryRecs = deliveriesBySub.get(id) ?? [];
    const accessRecs = [...(accessBySub.get(id) ?? []), ...siteAccessRecords];
    const deliveriesFor = deliveryRecs.map(d => deliveryOf(d, lang));
    const accessFor = accessRecs.map(r => accessOf(r, lang));
    const same = subLang === lang;
    return {
      sub: { id, name, phone, email },
      noContact: !phone && !email,
      tasks: tasksFor,
      deliveries: deliveriesFor,
      access: accessFor,
      inspections,
      lang: subLang,
      message: buildLineupMessage({
        subName: name,
        dayPhrase: same ? dayPhrase : dayPhraseFor(date, now, subLang),
        place,
        tasks: tasksFor,
        access: same ? accessFor : accessRecs.map(r => accessOf(r, subLang)),
        deliveries: same ? deliveriesFor : deliveryRecs.map(d => deliveryOf(d, subLang)),
        inspections: same ? inspections : inspectionRecords.map(({ i, p }) => inspectionOf(i, p, subLang)),
        lang: subLang,
      }),
    };
  });
  perSub.sort((a, b) => a.sub.name.localeCompare(b.sub.name));

  // 6. Empty + summary.
  const nothing = perSub.length === 0 && siteDeliveries.length === 0 && siteAccess.length === 0 && inspections.length === 0;
  let emptyNote: string | null = null;
  if (noSchedule && nothing) emptyNote = noScheduleNote(lang);
  else if (nothing) emptyNote = t('field.lineup.nothingScheduled', 'Nothing scheduled for {day} on this project', { day: shortDay(date, lang) }, lang);
  else if (noSchedule) gaps.push(noScheduleNote(lang));

  const bits: string[] = [];
  for (const s of perSub) {
    const areas = [...new Set(s.tasks.map(x => x.area).filter(Boolean))];
    bits.push(`${s.sub.name}${areas.length ? ` (${areas.join(', ')})` : ''}`);
  }
  for (const a of siteAccess) bits.push(a.text);
  for (const s of perSub) for (const r of accessBySub.get(s.sub.id) ?? []) bits.push(accessOf(r, lang).text);
  for (const d of [...[...deliveriesBySub.values()].flat().map(x => deliveryOf(x, lang)), ...siteDeliveries]) {
    bits.push(t('field.lineup.summaryDelivery', 'delivery: {text}', { text: d.text }, lang));
  }
  for (const i of inspections) bits.push(i.text);
  const cap = dayPhrase.charAt(0).toUpperCase() + dayPhrase.slice(1);
  const summary = bits.length
    ? t('field.lineup.summary', '{day} at {place}: {items}.', { day: cap, place, items: bits.join(', ') }, lang)
    : null;

  return {
    date, projectLabel, dayPhrase, perSub,
    siteWide: { deliveries: siteDeliveries, access: siteAccess, inspections },
    gaps, summary, emptyNote,
  };
}
