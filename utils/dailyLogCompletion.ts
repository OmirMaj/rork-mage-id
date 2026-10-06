// utils/dailyLogCompletion.ts — how complete the daily log is over the
// project's own working days, counting a "nothing happened" report as a
// COMPLETION rather than a gap.
//
// WHY COMPLETENESS, NOT QUALITY
// ------------------------------------------------------------------------
// A daily log is only worth anything if it covers the whole job. A month with
// a hole in it tells you nothing about the day in the hole, no matter how
// detailed the days on either side are. So the number this module produces is
// coverage: filed days over the working days the project actually expected —
// and a report that records "nothing happened on site" is a filed day, not a
// gap. Those are counted separately so a surface can say so out loud, because
// the day a superintendent is most tempted to skip is the day nothing
// happened.
//
// WHAT THIS DELIBERATELY DOES NOT DO
// ------------------------------------------------------------------------
// It does not reward backfilling. A report typed weeks later carries the date
// it was typed, not the day it describes, and it is not the same artifact as
// a note written on site that afternoon. Gaps are reported as facts about the
// record, never as a to-do list to go fill in. The only action a surface
// should offer is filing TODAY'S log.
//
// It also does not reward volume. Nothing here reads report length, and there
// is no score to raise by typing more. If the fastest path to a complete
// record is inventing content, the metric is worse than nothing.
//
// CALENDAR
// ------------------------------------------------------------------------
// Expected days come from the project's own schedule configuration
// (`ProjectSchedule.workingDaysPerWeek`, `ProjectSchedule.nonWorkingDates`),
// matching utils/cpm.ts `isWorkingDay`: fewer than 7 days per week excludes
// Saturday and Sunday, and any date in `nonWorkingDates` is off. A Sunday is
// never a miss on a 5-day project.
//
// Unlike cpm.ts, which indexes days off a schedule anchor in UTC, this module
// works in LOCAL calendar days. It compares a user's local "today" against
// reports the user filed locally, and `nonWorkingDates` are bare YYYY-MM-DD
// strings with no timezone, so local is the only reading that does not drift a
// day for anyone west of Greenwich.
//
// Pure: no React, no React Native, no network, no ambient clock (`todayISO` is
// injectable). Safe to import from a bun validator script.

import type { DailyFieldReport, ManpowerEntry, ProjectSchedule } from '@/types';
import { DELIVERY_TICKET_TAG } from '@/utils/deliveryArrival';
// Spanish (wave-next W3): the sentence builders below take a trailing
// `lang` (default 'en'). Each sentence is ONE key with its count
// (docs/I18N.md, "Gender and sentence building"); t/tn read the catalog only when lang is not 'en', so
// the English path returns exactly the sentence it always did.
import { t, tn } from '@/i18n/core';
import { formatTimeL } from '@/i18n/format';
import type { DisplayLang } from '@/i18n/types';

/** Default rolling window. Long enough to show a habit, short enough that an
 *  old gap stops being news. */
export const DEFAULT_WINDOW_DAYS = 30;
/** Cap on how many missed dates we hand back for display. */
export const MAX_MISSED_LISTED = 6;

export interface WorkingDayCalendar {
  workingDaysPerWeek?: number;
  nonWorkingDates?: string[];
}

/** The DFR fields this metric touches. Kept narrow so callers can pass partial
 *  rows and so the validator does not have to build a full DailyFieldReport.
 *  `workPerformed` / `issuesAndDelays` are accepted and then deliberately NOT
 *  read — see isNoWorkReport. Reading the prose would turn a completeness
 *  metric into a word count, and a word count is a reason to type filler. */
export type DailyLogReport = Pick<DailyFieldReport, 'date'> &
  Partial<Pick<DailyFieldReport,
    'id' | 'manpower' | 'workProgress' | 'materialsDelivered' | 'photos' | 'workPerformed' | 'issuesAndDelays'>> & {
    /** UX A5 — 'voice' on a draft the app created from a voice note on his
     *  behalf (see VOICE_ORIGIN below). Local only (DailyFieldReport.origin);
     *  read structurally so the validator can pass plain rows. */
    origin?: unknown;
  };

// ── Voice-created drafts (UX wave, lane A: A4 / A5) ──────────────────────────
//
// A one-sentence voice note used to switch off the "no daily log today" nag,
// because a voice note made a daily-report draft and ANY report counted. The
// rule is NOT "only sent counts": the form's own primary action saves a draft,
// the no-work-day shortcut saves a draft, and plenty of small GCs keep the log
// without emailing anyone — a sent-only rule would nag every one of them and
// turn every honest no-work day into a gap. So exactly one thing is excluded:
// a report the APP created from a voice note (`origin: 'voice'`). Every report
// he saved himself counts exactly as before. Opening that report in the form
// and saving it clears the marker (app/daily-report.tsx), and the day is filed.
//
// The marker is LOCAL, like leakScan: it is never in a supabaseWrite payload
// (dailyReportColumns does not name it). Consequences, both accepted:
//   • on a second device the marker is absent, so that device counts the day
//     as filed — the old behaviour, never a false "missing";
//   • ProjectContext merges `origin` forward on a server refetch, as it does
//     leakScan, so a refetch on THIS device keeps the marker.

/** The one origin value that does not file a day. */
export const VOICE_ORIGIN = 'voice' as const;

/** True for a draft the app created from a voice note on his behalf. */
export function isVoiceOnlyReport(r: { origin?: unknown } | null | undefined): boolean {
  return !!r && r.origin === VOICE_ORIGIN;
}

/** A save patch that also clears the voice marker: the form save IS him
 *  finishing the report. Typed as the input so a caller's Partial<Report>
 *  stays one. */
export function withVoiceOriginCleared<T extends object>(patch: T): T {
  return { ...patch, origin: undefined } as T;
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad2 = (n: number) => String(n).padStart(2, '0');

function keyOfLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Local YYYY-MM-DD for any ISO timestamp, bare date, epoch ms, or Date.
 * A bare YYYY-MM-DD is returned untouched — `new Date('2026-07-01')` parses as
 * UTC midnight, which reads as June 30 for most of the Americas, and silently
 * moving a filed day back one is exactly the bug this metric cannot afford.
 */
export function localDayKey(input: string | number | Date | null | undefined): string | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'string' && DAY_KEY_RE.test(input)) return input;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isFinite(d.getTime()) ? keyOfLocalDate(d) : null;
}

/** Local midnight Date for a YYYY-MM-DD key. */
function dateOfKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Shift a day key by n calendar days (local, DST-safe via Date arithmetic). */
export function shiftDayKey(key: string, n: number): string {
  const d = dateOfKey(key);
  d.setDate(d.getDate() + n);
  return keyOfLocalDate(d);
}

/**
 * Is this local calendar day one the project expects work on?
 * Mirrors utils/cpm.ts `isWorkingDay`: workingDaysPerWeek < 7 excludes Sat and
 * Sun; anything in nonWorkingDates is off regardless of weekday. Defaults to a
 * 5-day week, which is the forgiving direction — a wrong default here would
 * manufacture misses.
 */
export function isExpectedWorkingDay(key: string, cal?: WorkingDayCalendar | null): boolean {
  if (!DAY_KEY_RE.test(key)) return false;
  const wpw = cal?.workingDaysPerWeek ?? 5;
  const dow = dateOfKey(key).getDay();
  if (wpw < 7 && (dow === 0 || dow === 6)) return false;
  return !(cal?.nonWorkingDates ?? []).includes(key);
}

/** Pull the working-day calendar off a ProjectSchedule. */
export function calendarOfSchedule(schedule: ProjectSchedule | null | undefined): WorkingDayCalendar {
  return {
    workingDaysPerWeek: schedule?.workingDaysPerWeek,
    nonWorkingDates: schedule?.nonWorkingDates,
  };
}

/**
 * Did this report record any work on site?
 *
 * "Nothing happened" means no crew, no task progress, no deliveries, no
 * photos. Free text is deliberately NOT read: a report that says "rain, no
 * work" is still a no-work day, and reading the prose would turn the metric
 * into a word-count game. A report with a photo and no crew is not a no-work
 * day — something was documented.
 */
export function isNoWorkReport(r: DailyLogReport): boolean {
  const heads = (r.manpower ?? []).reduce((s, m) => s + (Number(m?.headcount) || 0), 0);
  if (heads > 0) return false;
  if ((r.workProgress ?? []).length > 0) return false;
  if ((r.materialsDelivered ?? []).filter(m => (m ?? '').trim().length > 0).length > 0) return false;
  if ((r.photos ?? []).length > 0) return false;
  return true;
}

export interface DailyLogCompletionInput {
  reports: DailyLogReport[];
  calendar?: WorkingDayCalendar | null;
  /** Project/schedule start. The window never reaches back past it. */
  startDateISO?: string | null;
  /** "Now", injectable. Defaults to the current local day. */
  todayISO?: string | number | Date;
  /** Rolling window length in calendar days, inclusive of today. */
  windowDays?: number;
}

export interface DailyLogCompletion {
  /** Local YYYY-MM-DD the window opens on. */
  windowStart: string;
  /** Local YYYY-MM-DD of today. */
  today: string;
  /** False until at least one report exists — before that there is no record
   *  to be complete or incomplete, and surfaces should render nothing. */
  hasRecord: boolean;
  /** Expected working days in the window, today included. */
  expectedDays: number;
  /** Expected days that are over. Today is excluded until it is filed, so the
   *  metric does not report a gap at 12:01am for a day still in progress. */
  closedExpectedDays: number;
  /** Closed expected days with at least one report. */
  filedDays: number;
  /** Of those, days whose report records no work. Completions, not gaps. */
  emptyDayFilings: number;
  /** Closed expected days with no report. */
  missedDays: number;
  /** Missed days, most recent first, capped at MAX_MISSED_LISTED. */
  missedDates: string[];
  /** Consecutive filed expected days ending at the most recent closed
   *  expected day (or today, when today is already filed). */
  currentStreak: number;
  /** Longest run of consecutive filed expected days inside the window. */
  longestStreak: number;
  /** filedDays / closedExpectedDays. 1 when there is nothing to measure. */
  completionRate: number;
  todayExpected: boolean;
  todayFiled: boolean;
  /** UX A5 — expected days in the window whose ONLY reports are voice-created
   *  drafts, most recent first (today included). Neither filed nor missed:
   *  the surfaces say "Voice note only · finish it". `reportId` is the newest
   *  voice draft that day (when the rows carry ids). */
  voiceOnlyDays: { date: string; reportId: string | null }[];
  /** Today's voice-only draft (today is expected and has nothing else). */
  todayVoiceDraftId: string | null;
}

const EMPTY_RESULT = (today: string): DailyLogCompletion => ({
  windowStart: today,
  today,
  hasRecord: false,
  expectedDays: 0,
  closedExpectedDays: 0,
  filedDays: 0,
  emptyDayFilings: 0,
  missedDays: 0,
  missedDates: [],
  currentStreak: 0,
  longestStreak: 0,
  completionRate: 1,
  todayExpected: false,
  todayFiled: false,
  voiceOnlyDays: [],
  todayVoiceDraftId: null,
});

/**
 * Completion of the daily log over the project's expected working days.
 *
 * The window opens at the later of (today - windowDays + 1), the project start
 * date, and the day of the first filed report. That last clamp matters: MAGE
 * can only speak to the stretch it was actually keeping the log, and reporting
 * thirty "misses" for the month before the GC adopted daily reports would be
 * both untrue and the fastest way to teach them to ignore the number.
 *
 * Reports filed on non-working days are ignored rather than credited — they
 * neither extend a streak nor were ever expected.
 */
export function computeDailyLogCompletion(input: DailyLogCompletionInput): DailyLogCompletion {
  const today = localDayKey(input?.todayISO ?? new Date()) ?? localDayKey(new Date())!;
  const cal = input?.calendar ?? null;
  const windowDays = Math.max(1, input?.windowDays ?? DEFAULT_WINDOW_DAYS);

  // One entry per day that has at least one report; true = the day recorded
  // no work. A day with several reports counts once, and counts as "work
  // happened" if any of them recorded work.
  const filedByDay = new Map<string, boolean>();
  // UX A5: voice-created drafts, per day — newest id wins. They open the
  // record (the window clamp and hasRecord treat them as a report on the job)
  // but they never make a day filed.
  const voiceByDay = new Map<string, { id: string | null; date: string }>();
  let firstFiledKey: string | null = null;
  for (const r of input?.reports ?? []) {
    const key = localDayKey(r?.date);
    if (!key) continue;
    if (firstFiledKey === null || key < firstFiledKey) firstFiledKey = key;
    if (isVoiceOnlyReport(r)) {
      const prev = voiceByDay.get(key);
      if (!prev || String(r.date) > prev.date) voiceByDay.set(key, { id: typeof r.id === 'string' ? r.id : null, date: String(r.date) });
      continue;
    }
    const noWork = isNoWorkReport(r);
    filedByDay.set(key, (filedByDay.get(key) ?? true) && noWork);
  }

  if (filedByDay.size === 0 && voiceByDay.size === 0) return EMPTY_RESULT(today);

  let windowStart = shiftDayKey(today, -(windowDays - 1));
  const projectStart = localDayKey(input?.startDateISO ?? null);
  if (projectStart && projectStart > windowStart) windowStart = projectStart;
  if (firstFiledKey && firstFiledKey > windowStart) windowStart = firstFiledKey;
  if (windowStart > today) windowStart = today;

  const todayExpected = isExpectedWorkingDay(today, cal);
  const todayFiled = filedByDay.has(today);

  // Expected days, oldest first.
  const expected: string[] = [];
  for (let k = windowStart; k <= today; k = shiftDayKey(k, 1)) {
    if (isExpectedWorkingDay(k, cal)) expected.push(k);
  }

  // Today is "closed" only once it has been filed; otherwise the day is still
  // in progress and is neither a completion nor a miss.
  const closed = expected.filter(k => k !== today || todayFiled);

  let filedDays = 0;
  let emptyDayFilings = 0;
  const missedDates: string[] = [];
  let longestStreak = 0;
  let run = 0;

  for (const k of closed) {
    if (filedByDay.has(k)) {
      filedDays++;
      if (filedByDay.get(k) === true) emptyDayFilings++;
      run++;
      if (run > longestStreak) longestStreak = run;
    } else {
      // A voice-only day is not filed (it breaks a run) and not missed (the
      // surfaces say "finish it", never "missing").
      if (!voiceByDay.has(k)) missedDates.push(k);
      run = 0;
    }
  }

  // Voice-only days: expected, in the window, nothing but voice drafts. Today
  // counts here too (it is not "closed" until filed).
  const voiceOnlyDays: { date: string; reportId: string | null }[] = [];
  for (let i = expected.length - 1; i >= 0; i--) {
    const k = expected[i];
    const v = voiceByDay.get(k);
    if (v && !filedByDay.has(k)) voiceOnlyDays.push({ date: k, reportId: v.id });
  }
  const todayVoice = todayExpected && !todayFiled ? voiceByDay.get(today) : undefined;

  // Current streak: walk back from the most recent closed expected day.
  let currentStreak = 0;
  for (let i = closed.length - 1; i >= 0; i--) {
    if (!filedByDay.has(closed[i])) break;
    currentStreak++;
  }

  return {
    windowStart,
    today,
    hasRecord: true,
    expectedDays: expected.length,
    closedExpectedDays: closed.length,
    filedDays,
    emptyDayFilings,
    missedDays: missedDates.length,
    missedDates: missedDates.slice(-MAX_MISSED_LISTED).reverse(),
    currentStreak,
    longestStreak,
    completionRate: closed.length === 0 ? 1 : filedDays / closed.length,
    todayExpected,
    todayFiled,
    voiceOnlyDays,
    todayVoiceDraftId: todayVoice ? todayVoice.id : null,
  };
}

/**
 * The standing number. States it; does not congratulate anyone for it.
 * Null before there is a record to describe.
 */
export function dailyLogHeadline(c: DailyLogCompletion, lang: DisplayLang = 'en'): string | null {
  if (!c.hasRecord || c.closedExpectedDays === 0) return null;
  return tn('field.dfr.record.headline', c.closedExpectedDays, {
    one: 'Daily log covers {filed} of {count} working day.',
    other: 'Daily log covers {filed} of {count} working days.',
  }, { filed: c.filedDays }, lang);
}

/** The "nothing happened days still count" line. Null when there are none. */
export function dailyLogEmptyDayLine(c: DailyLogCompletion, lang: DisplayLang = 'en'): string | null {
  if (!c.hasRecord || c.emptyDayFilings === 0) return null;
  return tn('field.dfr.record.emptyDays', c.emptyDayFilings, {
    one: '{count} of those days was logged with no work on site. Those count: a filed day with nothing on it still keeps the record unbroken.',
    other: '{count} of those days were logged with no work on site. Those count: a filed day with nothing on it still keeps the record unbroken.',
  }, undefined, lang);
}

/** The gap statement. A fact about the record, not a to-do list. */
export function dailyLogGapLine(c: DailyLogCompletion, lang: DisplayLang = 'en'): string | null {
  if (!c.hasRecord || c.missedDays === 0) return null;
  return tn('field.dfr.record.gap', c.missedDays, {
    one: "{count} working day in this stretch has no log. A report written now would carry today's date, not that day's, so the gap stays.",
    other: "{count} working days in this stretch have no log. A report written now would carry today's date, not that day's, so the gap stays.",
  }, undefined, lang);
}

/** The only action worth offering: today. Null when today is not owed. */
export function dailyLogTodayLine(c: DailyLogCompletion, lang: DisplayLang = 'en'): string | null {
  if (!c.hasRecord || !c.todayExpected || c.todayFiled) return null;
  return t('field.dfr.record.today', 'Today has no log yet. If nothing happened on site, that is still the day to record.', undefined, lang);
}

// ═════════════════════════════════════════════════════════════════════════════
// The daily-report FORM's pure helpers (UX wave, lane A). They live here, next
// to the completion rule they feed, because this module is already bun-safe
// and scripts/validate-ux-lane-a.ts drives them without React.
// ═════════════════════════════════════════════════════════════════════════════

// ── A1: "Add today's N job photos" ──────────────────────────────────────────

export interface DayPhotoLike {
  id: string;
  uri: string;
  timestamp: string;
  storagePath?: string;
  localUri?: string;
  latitude?: number;
  longitude?: number;
  locationAccuracyMeters?: number;
  locationLabel?: string;
}

export interface TodaysPhotosPlan<P extends DayPhotoLike> {
  /** The photos one tap attaches (in the gallery's order). */
  add: P[];
  /** Today's job photos not on the report yet. */
  available: number;
  /** Free slots on the report. */
  room: number;
  /** The chip's words, or null when the chip does not show. */
  label: string | null;
}

/**
 * The day's gallery photos the one-tap chip may offer. A delivery-ticket photo
 * (tag DELIVERY_TICKET_TAG, filed by the Deliveries "It's here now" sheet) is
 * left out: the report goes out as email and PDF to the architect or client,
 * and a supplier's ticket can carry his pricing. He can still attach a ticket
 * by hand (From Library, or the gallery). The chip's count excludes them too.
 */
export function oneTapDayPhotos<P extends { id: string; tag?: string | null }>(dayPhotos: readonly P[] | null | undefined): P[] {
  return (dayPhotos ?? []).filter(p => p?.tag !== DELIVERY_TICKET_TAG);
}

/**
 * What the "Add today's job photos" chip attaches. Photos already on the
 * report (same id — a DFR photo and its gallery copy share one) are skipped,
 * and it never goes past the report's cap. Nothing is attached without the
 * tap; this only plans it.
 *
 *   3 new, 0 on the report  → "Add today's 3 job photos", adds 3
 *   5 new, 9 on the report  → "Add today's job photos · 1 more fits", adds 1
 *   0 new, or no room left  → no chip
 */
export function todaysPhotosToAttach<P extends DayPhotoLike>(
  dayPhotos: readonly P[] | null | undefined,
  attached: readonly { id: string }[] | null | undefined,
  max: number,
  /** "today's" (default) — a backdated report says "that day's". */
  dayWord: string = "today's",
  /** Spanish (W3): the chip is ONE key per day word ("today's" or any other
   *  word = "that day's"), never the English word spliced into Spanish. */
  lang: DisplayLang = 'en',
): TodaysPhotosPlan<P> {
  const have = new Set((attached ?? []).map(p => p.id));
  const seen = new Set<string>();
  const fresh: P[] = [];
  for (const p of dayPhotos ?? []) {
    if (!p?.id || have.has(p.id) || seen.has(p.id)) continue;
    seen.add(p.id);
    fresh.push(p);
  }
  const room = Math.max(0, Math.floor(max) - (attached ?? []).length);
  const add = fresh.slice(0, room);
  let label: string | null = null;
  if (add.length > 0 && lang === 'en') {
    label = add.length === fresh.length
      ? `Add ${dayWord} ${add.length} ${add.length === 1 ? 'photo' : 'photos'}`
      : `Add ${dayWord} photos · ${room} more ${room === 1 ? 'fits' : 'fit'}`;
  } else if (add.length > 0) {
    const today = dayWord === "today's";
    label = add.length === fresh.length
      ? (today
        ? tn('field.dfr.photos.addToday', add.length, { one: "Add today's {count} photo", other: "Add today's {count} photos" }, undefined, lang)
        : tn('field.dfr.photos.addThatDay', add.length, { one: "Add that day's {count} photo", other: "Add that day's {count} photos" }, undefined, lang))
      : (today
        ? tn('field.dfr.photos.addTodayFits', room, { one: "Add today's photos · {count} more fits", other: "Add today's photos · {count} more fit" }, undefined, lang)
        : tn('field.dfr.photos.addThatDayFits', room, { one: "Add that day's photos · {count} more fits", other: "Add that day's photos · {count} more fit" }, undefined, lang));
  }
  return { add, available: fresh.length, room, label };
}

/** A gallery photo as a report photo: SAME id (so the report's save does not
 *  mirror a duplicate into the gallery, and markup drawn on the gallery copy
 *  prints on the report), the durable storagePath carried so nothing is
 *  re-uploaded, and the capture-time GPS kept (never a new reading). */
export function dayPhotoAsReportPhoto(p: DayPhotoLike): DayPhotoLike {
  const out: DayPhotoLike = { id: p.id, uri: p.uri, timestamp: p.timestamp };
  if (p.storagePath) out.storagePath = p.storagePath;
  if (p.localUri) out.localUri = p.localUri;
  if (typeof p.latitude === 'number') out.latitude = p.latitude;
  if (typeof p.longitude === 'number') out.longitude = p.longitude;
  if (typeof p.locationAccuracyMeters === 'number') out.locationAccuracyMeters = p.locationAccuracyMeters;
  if (p.locationLabel) out.locationLabel = p.locationLabel;
  return out;
}

// ── A2: the remembered recipient ────────────────────────────────────────────
//
// Per project, per DEVICE: the key lives in local storage, so the desk does not
// see a recipient picked on the phone (settings.dfrRecipients is the synced
// fallback). The mageid_ prefix is load-bearing — wipeLocalUserCache sweeps by
// prefix (utils/localCacheKeys.ts) and test:storage-hygiene fails on any other.

export const DFR_LAST_RECIPIENT_PREFIX = 'mageid_dfr_last_recipient:';

export function dfrLastRecipientKey(projectId: string): string {
  return `${DFR_LAST_RECIPIENT_PREFIX}${projectId}`;
}

export interface DfrRecipient { name: string; email: string }
export type DfrRecipientSource = 'last' | 'settings';

const RECIPIENT_EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

/** Parse the stored value; anything unreadable is no recipient. */
export function parseDfrRecipient(raw: string | null | undefined): DfrRecipient | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { name?: unknown; email?: unknown } | null;
    const email = typeof v?.email === 'string' ? v.email.trim() : '';
    if (!RECIPIENT_EMAIL_RE.test(email)) return null;
    return { name: typeof v?.name === 'string' ? v.name.trim() : '', email };
  } catch {
    return null;
  }
}

/**
 * Who the Send sheet opens addressed to, or null (the blank / contact-picker
 * flow). This job's last recipient first, then the first usable address in
 * settings.dfrRecipients (named from a contact with that address, when one
 * exists). Never invents an address; never used on a sample job (the caller
 * checks sampleSendPlan first — it overrides everything).
 */
export function dfrRecipientPrefill(o: {
  last: DfrRecipient | null | undefined;
  settingsRecipients?: readonly string[] | null;
  contacts?: readonly { firstName?: string; lastName?: string; companyName?: string; email?: string }[] | null;
}): (DfrRecipient & { source: DfrRecipientSource }) | null {
  if (o.last && RECIPIENT_EMAIL_RE.test(o.last.email.trim())) {
    return { name: o.last.name.trim(), email: o.last.email.trim(), source: 'last' };
  }
  const email = (o.settingsRecipients ?? []).map(e => (e ?? '').trim()).find(e => RECIPIENT_EMAIL_RE.test(e));
  if (!email) return null;
  const c = (o.contacts ?? []).find(x => (x.email ?? '').trim().toLowerCase() === email.toLowerCase());
  const name = c ? (`${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || (c.companyName ?? '').trim()) : '';
  return { name, email, source: 'settings' };
}

/** "Tom Reyes (tom@arch.com)" / "tom@arch.com" — the prefilled line. */
export function dfrRecipientLine(r: DfrRecipient): string {
  return r.name ? `${r.name} (${r.email})` : r.email;
}

// ── A4: a voice note adds to today's report ─────────────────────────────────
//
// Planned here, WIRED where the voice note is filed: components/
// UniversalMicButton.tsx's `note` and `field_update` branches. That file is
// HELD this wave (desktop-restore phase B is editing it), so the two call
// sites are an orchestrator item; the rule is fixed and validated now.

export type VoiceLogReport = Pick<DailyFieldReport, 'id' | 'projectId' | 'date' | 'status' | 'workPerformed'> &
  Partial<Pick<DailyFieldReport, 'manpower' | 'materialsDelivered' | 'updatedAt'>> & { origin?: unknown };

export interface VoiceLogInput {
  reports: readonly VoiceLogReport[];
  projectId: string;
  /** "Now" — the note's instant. The day is its LOCAL day. */
  at: string | number | Date;
  /** The note's text (one line). */
  line: string;
  /** field_update only: the crew and materials it heard. */
  manpower?: readonly ManpowerEntry[];
  materials?: readonly string[];
}

export type VoiceLogWrite =
  | { kind: 'append'; reportId: string; patch: { workPerformed: string; manpower?: ManpowerEntry[]; materialsDelivered?: string[] } }
  | { kind: 'create'; seed: { workPerformed: string; manpower: ManpowerEntry[]; materialsDelivered: string[]; status: 'draft'; origin: typeof VOICE_ORIGIN } };

const pad2v = (n: number) => String(n).padStart(2, '0');

/** "7:42 AM" in local time — the stamp on an appended line. Spanish (W3):
 *  "7:42 a.m." (i18n/format.ts formatTimeL). */
export function voiceLineStamp(at: string | number | Date, lang: DisplayLang = 'en'): string {
  const d = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(d.getTime())) return '';
  if (lang === 'es') return formatTimeL(d, 'es');
  const h = d.getHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${pad2v(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Where a voice note goes. Today's UNSENT report for the job takes it as one
 * more timestamped line (appended — nothing he typed is replaced), and a
 * field update's crew and materials are merged in without duplicating a row
 * already there. With no unsent report today (none at all, or only a SENT
 * one) it creates a new draft marked origin 'voice' — a sent report is never
 * modified by voice; a note after the report went out is an addendum draft.
 */
export function planVoiceLogWrite(input: VoiceLogInput): VoiceLogWrite {
  const day = localDayKey(input.at);
  const stamp = voiceLineStamp(input.at);
  const text = (input.line ?? '').trim();
  const stamped = stamp ? `[${stamp}] ${text}` : text;
  const heard = (input.manpower ?? []).filter(m => m && (m.trade || m.company));
  const mats = (input.materials ?? []).map(m => (m ?? '').trim()).filter(Boolean);

  const candidates = input.reports.filter(r =>
    r.projectId === input.projectId && r.status !== 'sent' && day !== null && localDayKey(r.date) === day,
  );
  // Several unsent drafts today: the most recently touched one takes it.
  const target = candidates.sort((a, b) => String(b.updatedAt ?? b.date).localeCompare(String(a.updatedAt ?? a.date)))[0];

  if (!target) {
    return {
      kind: 'create',
      seed: { workPerformed: stamped, manpower: [...heard], materialsDelivered: mats, status: 'draft', origin: VOICE_ORIGIN },
    };
  }

  const prior = (target.workPerformed ?? '').replace(/\s+$/, '');
  const patch: { workPerformed: string; manpower?: ManpowerEntry[]; materialsDelivered?: string[] } = {
    workPerformed: prior ? `${prior}\n${stamped}` : stamped,
  };
  if (heard.length > 0) {
    const key = (m: Pick<ManpowerEntry, 'trade' | 'company'>) => `${(m.trade ?? '').trim().toLowerCase()}|${(m.company ?? '').trim().toLowerCase()}`;
    const existing = target.manpower ?? [];
    const have = new Set(existing.map(key));
    const added = heard.filter(m => !have.has(key(m)));
    if (added.length > 0) patch.manpower = [...existing, ...added];
  }
  if (mats.length > 0) {
    const existing = target.materialsDelivered ?? [];
    const have = new Set(existing.map(m => (m ?? '').trim().toLowerCase()));
    const added = mats.filter(m => !have.has(m.toLowerCase()));
    if (added.length > 0) patch.materialsDelivered = [...existing, ...added];
  }
  return { kind: 'append', reportId: target.id, patch };
}
