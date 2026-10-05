// validate-calendar-date.ts — calendar days must not move with the reader's
// timezone, and the guard ENUMERATES the parse sites instead of naming files.
//
// WHY THIS EXISTS. Due dates, applied dates, schedule start dates, waiver
// "through" dates, sub daily-update dates and forecast days are DAYS ON A
// CALENDAR, not instants. The spec parses a bare 'YYYY-MM-DD' as UTC midnight,
// so `new Date('2026-08-30').toLocaleDateString()` prints "Aug 29" anywhere
// west of Greenwich, and `new Date().toISOString().slice(0, 10)` names
// tomorrow from about 5–7 pm. utils/calendarDate.ts exists for exactly this.
//
// The first version of this guard pinned three call sites (punch list,
// safety hazards, StatusPipeline) — and the 2026-09-03 final-push audit found
// eleven more instances of the same bug (UX-F1–F4, F9–F11) in files the guard
// never looked at. A listing guard goes blind the moment the list is stale, so
// this one walks app/ and components/ and fails on every `new Date(<arg>)` /
// `Date.parse(<arg>)` whose ARGUMENT TEXT names a date-ish value — it contains
// date / Date / deadline / dueBy or ends in Iso / ISO (see DATE_ISH) — unless
// the call is (a) suffixed with 'T00:00:00', (b) on a line that already
// resolves via parseCalendarDay, or (c) in the dated ALLOWED list below with a
// reason. Every ALLOWED entry must still match a real site — a stale entry
// fails the run rather than silently widening it.
//
// What it does NOT see (B4 review A2 — the header used to claim "ANY"): an
// argument that is a string but not named like one. `new Date(doc.expiresAt)`,
// `new Date(value)` inside a helper, `new Date(row.when)` are all invisible
// here; the enumerator is textual and has no types. Those sites are covered
// only when a reviewer reads them — app/documents.tsx's expiresAt is one that
// was, and is now normalised at its source.
//
// Runtime checks run under FOUR timezones (Denver, New York, UTC, Tokyo) by re-spawning
// this script with TZ set, so a helper that only works east or west of
// Greenwich cannot pass on the developer's machine and fail on the user's.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import {
  formatCalendarDay, parseCalendarDay, toCalendarDayString, todayCalendarDay, daysUntilCalendarDay,
  addCalendarMonths, addCalendarDays, calendarDayOf, calendarDayStart, dayOrInstantDate,
  mondayOfLocalWeek, localWeekStart, daysPastDue,
} from '../utils/calendarDate';
import { currentWeekStart, addWeeks, buildLookahead, computePpc } from '../utils/lastPlanner';
import { computeWeekLoad, aggregateAttention } from '../utils/summaryBriefing';
import { buildDraftCO, collectDraftableLeaks } from '../utils/brain/leakCoDraft';
import { coPastItsOwnTurnaround } from '../utils/followUp/rules';
import { normalizeExtraction } from '../utils/materialReceipt';
import { computePrequalExpiry, prequalApprovalRisk, renewalBucket } from '../utils/prequalEngine';
import { computeARAgingReport } from '../utils/financialReports';
import { getEffectiveInvoiceStatus, getDaysPastDue } from '../utils/projectFinancials';
import { findWeatherRisk } from '../utils/weatherService';
import { buildFeedbackAsk } from '../utils/portalSnapshot';
import { addWorkingDays } from '../utils/scheduleEngine';
import { setLang, getLang } from '../i18n/core';
import { buildPortalSnapshot } from '../utils/portalSnapshot';
import type { ClientPortalSettings, DailyFieldReport, Project } from '../types';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const TZ_CHILD_FLAG = 'CALENDAR_DATE_TZ_CHILD';
const TIMEZONES = ['America/Denver', 'America/New_York', 'UTC', 'Asia/Tokyo'];

let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
  }
}

function eq(label: string, got: unknown, want: unknown) {
  ok(label, got === want, `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// The SHIPPED "Copy from …" day label, loaded out of the screen it lives in.
//
// DFR-CARRY-LABEL (runtime audit 2026-09-06): the daily report's carry-forward
// button named the source day from `Math.round((now - then) / 86400000)` —
// elapsed HOURS between two instants, relabelled as days. A report filed at
// 9 pm and opened at 8 am the next morning is 11 hours old, rounds to 0, and
// the button read "Copy from earlier today" while copying yesterday's crew
// counts and work-performed text into a record that gets signed and sent to
// the owner.
//
// app/daily-report.tsx is an Expo Router route and cannot be imported outside
// Metro, so the two label functions are extracted from between their sentinel
// comments, transpiled, and executed here for real — under all three
// timezones, like everything else in this file. Same technique as
// scripts/validate-sub-overpayment.ts. A textual pin would only prove the
// helper is called; this proves what it answers.
// ═══════════════════════════════════════════════════════════════════════════

// Declared locally rather than pulled from `bun-types`: this repo has no bun
// type package installed, and without this `npx tsc --noEmit` fails with
// TS2867 "Cannot find name 'Bun'". Same pattern as validate-sub-overpayment.ts.
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string };
};

type DayLabeller = (value: string | null | undefined, now?: Date) => string;

const DFR_SCREEN = 'app/daily-report.tsx';
const DFR_BEGIN = '// --- BEGIN carrySourceDayLabel ---';
const DFR_END = '// --- END carrySourceDayLabel ---';

function loadCarryLabellers(): { label: DayLabeller; absolute: DayLabeller } {
  const src = read(DFR_SCREEN);
  const from = src.indexOf(DFR_BEGIN);
  const to = src.indexOf(DFR_END);
  if (from < 0 || to < 0 || to <= from) {
    console.error(`\n  FAIL could not find the carrySourceDayLabel sentinels in ${DFR_SCREEN}.`);
    console.error('       Someone moved or renamed them, and the "Copy from yesterday" label');
    console.error('       would go unpinned. Restore the sentinels rather than deleting this.');
    process.exit(1);
  }
  const js = new Bun.Transpiler({ loader: 'ts' })
    .transformSync(src.slice(from, to))
    .replace(/\bexport\s+function\b/g, 'function');
  const built = new Function(
    'calendarDayOf', 'daysUntilCalendarDay', 'formatCalendarDay', 'todayCalendarDay',
    `${js}\nreturn { label: carrySourceDayLabel, absolute: carrySourceDayAbsolute };`,
  )(calendarDayOf, daysUntilCalendarDay, formatCalendarDay, todayCalendarDay) as { label: DayLabeller; absolute: DayLabeller };
  if (typeof built.label !== 'function' || typeof built.absolute !== 'function') {
    console.error(`\n  FAIL the carrySourceDayLabel region of ${DFR_SCREEN} did not yield both functions.`);
    process.exit(1);
  }
  return built;
}

const carry = loadCarryLabellers();

// ═══════════════════════════════════════════════════════════════════════════
// Runtime checks — executed once per timezone in a child process.
// ═══════════════════════════════════════════════════════════════════════════

function runtimeChecks() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`\n[TZ=${tz}] calendar days are timezone-stable:`);
  {
    eq('bare YYYY-MM-DD formats to the same day', formatCalendarDay('2026-08-30'), 'Aug 30, 2026');
    eq('New Year\'s Day does not roll back a year', formatCalendarDay('2026-01-01'), 'Jan 1, 2026');
    eq('leap day survives', formatCalendarDay('2028-02-29'), 'Feb 29, 2028');
    eq('options shape the label without moving the day',
      formatCalendarDay('2026-09-10', { weekday: 'long', month: 'long', day: 'numeric' }), 'Thursday, September 10');

    // The guard that actually matters: parse must land on local midnight of
    // the requested day, so getDate() round-trips no matter what TZ the
    // process runs in. Under `new Date(iso)` this is off by one west of
    // Greenwich.
    const d = parseCalendarDay('2026-08-30');
    ok('parse lands on the requested calendar day, not UTC midnight',
      d !== null && d.getFullYear() === 2026 && d.getMonth() === 7 && d.getDate() === 30,
      `got ${d?.toString()}`);
    eq('parse lands at local midnight', d?.getHours(), 0);
  }

  console.log(`[TZ=${tz}] the string ↔ Date round-trip is lossless:`);
  {
    eq('toCalendarDayString(parseCalendarDay(x)) === x', toCalendarDayString(parseCalendarDay('2026-08-30')!), '2026-08-30');
    eq('… on New Year\'s Eve', toCalendarDayString(parseCalendarDay('2026-12-31')!), '2026-12-31');
    eq('… on a leap day', toCalendarDayString(parseCalendarDay('2028-02-29')!), '2028-02-29');
    const late = new Date(2026, 7, 31, 23, 30); // 11:30 pm local, Aug 31
    eq('todayCalendarDay names the LOCAL day at 11:30 pm', todayCalendarDay(late), '2026-08-31');
    const early = new Date(2026, 8, 1, 0, 30); // 12:30 am local, Sep 1
    eq('todayCalendarDay names the LOCAL day at 12:30 am', todayCalendarDay(early), '2026-09-01');
    ok('toISOString().slice(0, 10) is NOT what todayCalendarDay returns in at least one direction',
      // Denver: 11:30 pm Aug 31 is Sep 1 UTC; Tokyo: 12:30 am Sep 1 is Aug 31 UTC; UTC: both agree.
      tz === 'UTC' || late.toISOString().slice(0, 10) !== '2026-08-31' || early.toISOString().slice(0, 10) !== '2026-09-01');
  }

  console.log(`[TZ=${tz}] whole-day countdowns ignore DST and the clock:`);
  {
    const evening = new Date(2026, 8, 3, 19, 30); // Sep 3, 7:30 pm local
    eq('a day named today is 0 days away even in the evening', daysUntilCalendarDay('2026-09-03', evening), 0);
    eq('tomorrow is 1', daysUntilCalendarDay('2026-09-04', evening), 1);
    eq('yesterday is -1', daysUntilCalendarDay('2026-09-02', evening), -1);
    // US DST ends 2026-11-01; a 25-hour day must still count as one.
    eq('crossing the DST fall-back still counts whole days', daysUntilCalendarDay('2026-11-02', new Date(2026, 9, 31, 12)), 2);
    eq('crossing the DST spring-forward still counts whole days', daysUntilCalendarDay('2026-03-09', new Date(2026, 2, 7, 12)), 2);
    eq('unparseable input is null, not NaN', daysUntilCalendarDay('soon', evening), null);
  }

  console.log(`[TZ=${tz}] a mixed-shape field resolves to the day the record was made (B4 review A4):`);
  {
    eq('a bare day is kept', calendarDayOf('2026-09-04'), '2026-09-04');
    eq('a rolled-over bare day is rejected', calendarDayOf('2026-02-30'), null);
    // 9 pm local on Sep 4, whatever the zone — its toISOString() may start with Sep 5.
    const evening = new Date(2026, 8, 4, 21, 0).toISOString();
    eq('an evening instant names its LOCAL day, not its UTC date', calendarDayOf(evening), '2026-09-04');
    eq('a noon-UTC DatePickerModal instant names its day', calendarDayOf('2026-09-04T12:00:00.000Z'), '2026-09-04');
    eq('garbage is null', calendarDayOf('later'), null);
    eq('empty is null', calendarDayOf(''), null);
  }

  console.log(`[TZ=${tz}] the DFR "Copy from …" button names a CALENDAR day (DFR-CARRY-LABEL):`);
  {
    // Sep 6 2026 is a Sunday (the day of the runtime audit), so Sep 5 is a
    // Saturday, Sep 4 a Friday and Sep 1 a Tuesday. Every `now` below is built
    // from LOCAL components, so the wall clock is the same in all three zones
    // and only the arithmetic under test can differ.
    const morningSep5 = new Date(2026, 8, 5, 8, 0);
    const nightSep5 = new Date(2026, 8, 5, 23, 0);

    // The audited failure, both directions. A DFR is stored as a full ISO
    // instant, so "how long ago was it written" and "which day is it FOR" are
    // different questions and only the second one belongs on the button.
    const filed9pmSep4 = new Date(2026, 8, 4, 21, 0).toISOString();
    eq('a 9 pm report opened at 8 am the next morning is "yesterday"',
      carry.label(filed9pmSep4, morningSep5), 'yesterday');
    ok('… and the elapsed-hours arithmetic really did answer "earlier today"',
      Math.round((morningSep5.getTime() - new Date(filed9pmSep4).getTime()) / 86400000) === 0,
      'the old idiom no longer reproduces the bug — re-derive this case before deleting it');

    const filed7amSep5 = new Date(2026, 8, 5, 7, 0).toISOString();
    eq('a 7 am report read the same night is "earlier today"',
      carry.label(filed7amSep5, nightSep5), 'earlier today');
    ok('… and the elapsed-hours arithmetic really did answer "yesterday"',
      Math.round((nightSep5.getTime() - new Date(filed7amSep5).getTime()) / 86400000) === 1);

    // A bare 'YYYY-MM-DD' — the shape some writers and Postgres `date` columns
    // hand back — must name the same day, not the UTC-midnight reading of it.
    eq('a bare day equal to today is "earlier today"', carry.label('2026-09-05', morningSep5), 'earlier today');
    eq('a bare day one back is "yesterday"', carry.label('2026-09-04', morningSep5), 'yesterday');
    eq('three days back counts days', carry.label('2026-09-02', morningSep5), '3 days ago');
    eq('six days back is still counted', carry.label('2026-08-30', morningSep5), '6 days ago');
    eq('a week or more gets the date itself', carry.label('2026-08-29', morningSep5), 'Sat, Aug 29');
    // A DFR filed for tomorrow used to render "-1 days ago" (diffDays < 7).
    eq('a future-dated report names its date, not a negative count',
      carry.label('2026-09-06', morningSep5), 'Sun, Sep 6');
    eq('an unreadable date names no day at all', carry.label('sometime last week', morningSep5), 'the last report');
    eq('a missing date names no day at all', carry.label(undefined, morningSep5), 'the last report');

    // US DST ends 2026-11-01. An evening report read the next morning spans
    // 10-11 wall-clock hours (a 25-hour day in Denver), which the millisecond
    // walk rounds to zero.
    const halloweenEvening = new Date(2026, 9, 31, 21, 0).toISOString();
    eq('a report filed the evening before the fall-back is "yesterday" the next morning',
      carry.label(halloweenEvening, new Date(2026, 10, 1, 7, 0)), 'yesterday');

    // ── A day outside the current year must SAY its year ──────────────────
    // 'Mon, Sep 8' reads as this year, always. A job stalls, its last DFR is
    // 2025-09-08, the super reopens the screen on 2026-09-07: the short label
    // names a day twelve months off. Same defect as the one above — the label
    // naming a day that is not the day — from a rarer input.
    eq('a report from last year carries its year',
      carry.label('2025-09-08', new Date(2026, 8, 7, 8, 0)), 'Mon, Sep 8, 2025');
    eq('… and so does the toast that confirms the copy',
      carry.absolute('2025-09-08', new Date(2026, 8, 7, 8, 0)), 'Mon, Sep 8, 2025');
    // …while a day in THIS year stays short, however far back it is. This is
    // why the rule is the calendar year and not a distance in days.
    eq('a distant day in the current year stays short',
      carry.label('2026-01-05', morningSep5), 'Mon, Jan 5');
    // The case that rules out the "> 180 days ago" threshold outright: 171
    // days back, so a distance rule keeps the short form, yet it is last
    // December and 'Fri, Dec 12' read in June names this coming December.
    eq('a day 171 days back but in the previous year still carries its year',
      carry.label('2025-12-12', new Date(2026, 5, 1, 8, 0)), 'Fri, Dec 12, 2025');
    // The relative branch is unaffected: it cannot be ambiguous, so it never
    // grows a year even across New Year.
    eq('New Year\'s Day still says "yesterday", not a dated label',
      carry.label('2025-12-31', new Date(2026, 0, 1, 8, 0)), 'yesterday');

    // The toast that fires after the copy names the day absolutely.
    eq('the toast names an instant\'s LOCAL day', carry.absolute(filed9pmSep4, morningSep5), 'Fri, Sep 4');
    eq('the toast names a bare day unchanged', carry.absolute('2026-09-01', morningSep5), 'Tue, Sep 1');
    eq('the toast refuses to invent a day', carry.absolute('whenever', morningSep5), 'the last report');
    ok('in America/Denver the naive `new Date(bareDay)` toast really did name Aug 31',
      tz !== 'America/Denver' || new Date('2026-09-01').getDate() === 31);
  }

  console.log(`[TZ=${tz}] a mixed-shape field's day STARTS at local midnight of that day (B4 review A2 — overdueCalendarDays, client-view formatDate, the RFI log/email):`);
  {
    const bare = calendarDayStart('2026-09-15');
    ok('a bare day starts at local midnight of that day',
      bare !== null && toCalendarDayString(bare) === '2026-09-15' && bare.getHours() === 0, `got ${bare?.toString()}`);
    eq('a noon-UTC DatePickerModal instant starts on its own day', toCalendarDayString(calendarDayStart('2026-09-15T12:00:00.000Z')!), '2026-09-15');
    const evening = new Date(2026, 8, 4, 21, 0); // 9 pm local Sep 4 — its toISOString() may start with Sep 5
    eq('an evening instant starts on its LOCAL day', toCalendarDayString(calendarDayStart(evening.toISOString())!), '2026-09-04');
    eq('garbage is null', calendarDayStart('soon'), null);
    // The defect: the spec parses a bare day as UTC midnight — the previous local day west of Greenwich.
    ok('in America/Denver the naive parse of the bare day really names Sep 14',
      tz !== 'America/Denver' || toCalendarDayString(new Date('2026-09-15')) === '2026-09-14');
  }

  console.log(`[TZ=${tz}] month arithmetic clamps to the end of the target month (B4 review item 1):`);
  {
    // The three values app/warranties.tsx used to store in warranties.end_date.
    eq('Jan 31 + 1 month is Feb 28, not Mar 3', addCalendarMonths('2026-01-31', 1), '2026-02-28');
    eq('a leap day + 12 months is Feb 28 of the next year, not Mar 1', addCalendarMonths('2028-02-29', 12), '2029-02-28');
    eq('Aug 31 + 6 months is Feb 28, not Mar 3', addCalendarMonths('2026-08-31', 6), '2027-02-28');
    eq('Jan 31 + 1 month in a leap year is Feb 29', addCalendarMonths('2028-01-31', 1), '2028-02-29');
    eq('a mid-month day is untouched', addCalendarMonths('2026-03-15', 12), '2027-03-15');
    eq('Mar 31 + 1 month is Apr 30', addCalendarMonths('2026-03-31', 1), '2026-04-30');
    eq('crossing a year boundary', addCalendarMonths('2026-11-20', 3), '2027-02-20');
    eq('a full ISO timestamp is read by its date part', addCalendarMonths('2026-01-31T00:00:00.000Z', 1), '2026-02-28');
    eq('unparseable input is null', addCalendarMonths('next year', 1), null);
    eq('empty input is null', addCalendarMonths('', 1), null);
  }

  console.log(`[TZ=${tz}] day arithmetic survives the DST fall-back (B4 review item 2):`);
  {
    // US DST ends 2026-11-01 (a Sunday): the day is 25 hours long, so
    // `getTime() + 1 * 86_400_000` from Nov 1 midnight lands on Nov 1 23:00
    // in Denver and getDate() names the wrong day from then on.
    const nov1 = parseCalendarDay('2026-11-01')!;
    eq('Nov 1 + 1 day is Nov 2', toCalendarDayString(addCalendarDays(nov1, 1)), '2026-11-02');
    eq('Nov 1 + 7 days is Nov 8', toCalendarDayString(addCalendarDays(nov1, 7)), '2026-11-08');
    eq('Nov 1 - 1 day is Oct 31', toCalendarDayString(addCalendarDays(nov1, -1)), '2026-10-31');
    eq('Oct 31 + 2 days crosses the fall-back to Nov 2', toCalendarDayString(addCalendarDays(parseCalendarDay('2026-10-31')!, 2)), '2026-11-02');
    eq('Mar 7 + 2 days crosses the spring-forward to Mar 9', toCalendarDayString(addCalendarDays(parseCalendarDay('2026-03-07')!, 2)), '2026-03-09');
    eq('the result is local midnight', addCalendarDays(nov1, 1).getHours(), 0);
    // Only meaningful in a zone that observes US DST; in UTC/Tokyo the two agree.
    const msWalk = new Date(nov1.getTime() + 86_400_000);
    ok('in America/Denver the millisecond walk really does land on the wrong day',
      tz !== 'America/Denver' || msWalk.getDate() === 1,
      `ms walk from Nov 1 gave ${msWalk.toString()}`);
    // components/schedule/mobile/MonthCalendarSheet.tsx activeDayKeys walks a
    // task's days with addWorkingDays and keys them y-getMonth()-getDate(); on
    // a 7-day week the walk passes THROUGH the fall-back day. The ms walk keyed
    // Nov 1 twice and never Nov 2 in Denver (B4 review item 2).
    const keys: string[] = [];
    let day = addWorkingDays(parseCalendarDay('2026-10-26')!, 5, 7); // startDay 6 on a Mon anchor → Sat Oct 31
    for (let k = 0; k < 3; k++) { keys.push(`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`); day = addWorkingDays(day, 1, 7); }
    eq('a 7-day-week task walked through the fall-back keys Oct 31, Nov 1, Nov 2', keys.join(' '), '2026-9-31 2026-10-1 2026-10-2');
    const wk: string[] = [];
    day = addWorkingDays(parseCalendarDay('2026-10-26')!, 5, 5); // startDay 6 on a 5-day week → Mon Nov 2
    for (let k = 0; k < 3; k++) { wk.push(toCalendarDayString(day)); day = addWorkingDays(day, 1, 5); }
    eq('a 5-day-week task after the fall-back keys Nov 2, 3, 4 (not Sat Oct 31)', wk.join(' '), '2026-11-02 2026-11-03 2026-11-04');
  }

  console.log(`[TZ=${tz}] local and Supabase-synced rows agree:`);
  {
    eq('full ISO timestamp truncates to its date part',
      formatCalendarDay('2026-08-30T00:00:00.000Z'), 'Aug 30, 2026');
    ok('a synced row renders identically to the local row',
      formatCalendarDay('2026-08-30T00:00:00.000Z') === formatCalendarDay('2026-08-30'));
    ok('a timestamp late in the UTC day still uses its own date part',
      formatCalendarDay('2026-08-30T23:59:59Z') === formatCalendarDay('2026-08-30'));
  }

  console.log(`[TZ=${tz}] bad input is never dressed up as a real date:`);
  {
    eq('month 13 is rejected, not rolled into next year', formatCalendarDay('2026-13-01'), '2026-13-01');
    eq('day 45 is rejected, not rolled into the next month', formatCalendarDay('2026-01-45'), '2026-01-45');
    eq('Feb 30 is rejected in a non-leap year', formatCalendarDay('2027-02-30'), '2027-02-30');
    eq('Feb 29 is rejected in a non-leap year', formatCalendarDay('2027-02-29'), '2027-02-29');
    eq('free text is echoed back', formatCalendarDay('next tuesday'), 'next tuesday');
    eq('empty string yields empty string', formatCalendarDay(''), '');
    eq('null yields empty string', formatCalendarDay(null), '');
    eq('undefined yields empty string', formatCalendarDay(undefined), '');
    eq('parse rejects month 13', parseCalendarDay('2026-13-01'), null);
    eq('parse rejects day 45', parseCalendarDay('2026-01-45'), null);
  }

  // Spanish (wave-next I18NWIRE, docs/I18N.md §6): formatCalendarDay takes
  // `lang` (default getLang()). English is the unchanged en-US path; Spanish
  // comes from our own tables and is NEVER numeric — `9/10` is 9 October to a
  // Mexican foreman and 10 September to his owner.
  console.log(`[TZ=${tz}] Spanish calendar days are month names, never numbers:`);
  {
    const NUMERIC_DATE = /\d{1,2}\s*[/.-]\s*\d{1,2}/;
    const ES_MONTH = /\b(ene|feb|mar|abr|may|jun|jul|ago|sept|oct|nov|dic|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/;
    const days = ['2026-09-10', '2026-01-01', '2028-02-29'];
    const shapes: (Intl.DateTimeFormatOptions | undefined)[] = [
      undefined,
      { month: 'numeric', day: 'numeric', year: 'numeric' },
      { month: '2-digit', day: '2-digit' },
      { month: 'numeric', day: 'numeric' },
      { weekday: 'short', month: 'short', day: 'numeric' },
    ];
    const outs = days.flatMap(d => shapes.map(o => formatCalendarDay(d, o, 'es')));
    const numeric = outs.filter(x => NUMERIC_DATE.test(x) || !ES_MONTH.test(x));
    ok(`es output for 3 dates × ${shapes.length} shapes is never numeric and always names the month (${outs.length})`,
      numeric.length === 0, numeric.join(' | '));
    eq("es default: '2026-09-10' → '10 sept 2026'", formatCalendarDay('2026-09-10', undefined, 'es'), '10 sept 2026');
    eq("es month:'numeric' asked → the month NAME ('10 sept 2026')",
      formatCalendarDay('2026-09-10', { month: 'numeric', day: 'numeric', year: 'numeric' }, 'es'), '10 sept 2026');
    eq('es New Year\'s Day does not roll back a year', formatCalendarDay('2026-01-01', undefined, 'es'), '1 ene 2026');
    eq('es leap day survives', formatCalendarDay('2028-02-29', undefined, 'es'), '29 feb 2028');
    eq('es long weekday form', formatCalendarDay('2026-09-10', { weekday: 'long', month: 'long', day: 'numeric' }, 'es'), 'jueves, 10 de septiembre');
    eq('es synced ISO row = bare row', formatCalendarDay('2026-08-30T23:59:59Z', undefined, 'es'), formatCalendarDay('2026-08-30', undefined, 'es'));
    eq('es bad input is echoed back', formatCalendarDay('2026-13-01', undefined, 'es'), '2026-13-01');
    eq('es empty yields empty', formatCalendarDay('', undefined, 'es'), '');
    // English identity: an explicit 'en', and the default while the app is in English.
    const enOpts: (Intl.DateTimeFormatOptions | undefined)[] = [undefined, { weekday: 'long', month: 'long', day: 'numeric' }, { month: 'numeric', day: 'numeric' }];
    const enDiff = days.flatMap(d => enOpts.map(o => [d, o] as const)).filter(([d, o]) => {
      const legacy = parseCalendarDay(d)!.toLocaleDateString('en-US', o ?? { month: 'short', day: 'numeric', year: 'numeric' });
      return formatCalendarDay(d, o, 'en') !== legacy || formatCalendarDay(d, o) !== legacy;
    });
    ok('en (explicit, and the default in English) is exactly the en-US toLocaleDateString path', enDiff.length === 0 && getLang() === 'en',
      enDiff.map(([d, o]) => `${d} ${JSON.stringify(o)}`).join(' | '));
    // The default follows the app language (i18n/core getLang()).
    setLang('es');
    const followed = formatCalendarDay('2026-09-10');
    setLang('en');
    eq('the default lang follows the app language (es → Spanish)', followed, '10 sept 2026');
    eq('…and back to English afterwards', formatCalendarDay('2026-09-10'), 'Sep 10, 2026');
    // An unknown lang value (a callback's index/array argument) stays English.
    eq('a non-language third argument renders English', formatCalendarDay('2026-09-10', undefined, [] as never), 'Sep 10, 2026');
  }

  // DailyFieldReport.date holds an instant from every writer but a bare local
  // day from the voice report for a while (rows on devices and in a text
  // column). Its readers go through dayOrInstantDate; `new Date('2026-09-17')`
  // is UTC midnight and printed "Wednesday, September 16" in Denver.
  {
    const bare = dayOrInstantDate('2026-09-17');
    eq("dayOrInstantDate: a bare '2026-09-17' is the 17th here", bare.getDate(), 17);
    eq('…and a Thursday here', bare.toLocaleDateString('en-US', { weekday: 'long' }), 'Thursday');
    eq('…and its ISO form still names the 17th (noon survives re-serialising)', bare.toISOString().slice(0, 10), '2026-09-17');
    const inst = '2026-09-17T15:04:05.000Z';
    eq('…an instant passes through untouched', dayOrInstantDate(inst).getTime(), new Date(inst).getTime());
    ok('…garbage stays an Invalid Date, as new Date() gave', Number.isNaN(dayOrInstantDate('nope').getTime()));
    ok('…and so does a missing value', Number.isNaN(dayOrInstantDate(undefined).getTime()));
  }

  // The homeowner portal's Daily Reports card formats `date` with
  // `new Date(iso).toLocaleDateString()`. A bare day an older voice build
  // saved went out as-is and printed the day before west of Greenwich; the
  // snapshot now sends that day's local-noon instant, and sorts the same way.
  {
    const project = { id: 'p1', name: 'Maple St', status: 'in_progress' } as unknown as Project;
    const portal = { portalId: 'x', enabled: true, showDailyReports: true } as unknown as ClientPortalSettings;
    const eveningBefore = new Date(2026, 8, 14, 20).toISOString(); // Sep 14, 8 pm local
    const snap = buildPortalSnapshot({
      project, portal,
      dailyReports: [
        { id: 'inst', projectId: 'p1', date: eveningBefore, manpower: [], workPerformed: 'a' },
        { id: 'bare', projectId: 'p1', date: '2026-09-15', manpower: [], workPerformed: 'b' },
      ] as unknown as DailyFieldReport[],
    });
    const rows = (snap.sections.dailyReports ?? []) as { id: string; date: string }[];
    const bare = rows.find(r => r.id === 'bare');
    eq("portal DFR card: a bare '2026-09-15' report prints the 15th here", bare ? new Date(bare.date).getDate() : null, 15);
    eq('…an instant report keeps its instant', rows.find(r => r.id === 'inst')?.date, eveningBefore);
    eq('…and the 15th sorts ahead of the evening of the 14th', rows.map(r => r.id).join(','), 'bare,inst');
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// THE WEEK RULE (2026-10-04) — "this week" is the LOCAL Monday-to-Sunday week
// of the device, on every screen. Last Planner used the Monday of the UTC
// date; Summary and the Friday close used the local one, so on a New York
// Sunday from 8 pm to midnight (and a Tokyo Monday from midnight to 9 am) the
// two screens were a week apart. Runs once per timezone, like the rest.
// ═══════════════════════════════════════════════════════════════════════════

function weekBoundaryChecks() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`[TZ=${tz}] "this week" is the local Monday-to-Sunday week (WEEK RULE):`);

  // Wall-clock cases: the same local moment is a different instant in each
  // zone, and the answer must be the same calendar Monday in all of them.
  const WALL: [string, [number, number, number, number, number], string][] = [
    ['Sunday 20:30', [2026, 9, 4, 20, 30], '2026-09-28'],
    ['Sunday 21:00', [2026, 9, 4, 21, 0], '2026-09-28'],
    ['Sunday 23:59', [2026, 9, 4, 23, 59], '2026-09-28'],
    ['Monday 00:01', [2026, 9, 5, 0, 1], '2026-10-05'],
    ['Monday 09:00', [2026, 9, 5, 9, 0], '2026-10-05'],
    ['Wednesday noon', [2026, 9, 7, 12, 0], '2026-10-05'],
    ['the Sunday US clocks spring forward, 01:30', [2026, 2, 8, 1, 30], '2026-03-02'],
    ['the Sunday US clocks spring forward, 23:30', [2026, 2, 8, 23, 30], '2026-03-02'],
    ['the Monday after spring forward, 00:01', [2026, 2, 9, 0, 1], '2026-03-09'],
    ['the Sunday US clocks fall back, 01:30', [2026, 10, 1, 1, 30], '2026-10-26'],
    ['the Sunday US clocks fall back, 23:30', [2026, 10, 1, 23, 30], '2026-10-26'],
    ['the Monday after fall back, 00:01', [2026, 10, 2, 0, 1], '2026-11-02'],
    ['a week that spans a month end (Wed Sep 30)', [2026, 8, 30, 23, 59], '2026-09-28'],
    ['…and its Thursday Oct 1', [2026, 9, 1, 0, 1], '2026-09-28'],
    ['New Year\'s Eve 23:59', [2026, 11, 31, 23, 59], '2026-12-28'],
    ['New Year\'s Day 00:01 is still last year\'s Monday', [2027, 0, 1, 0, 1], '2026-12-28'],
    ['Sunday Jan 3 23:59', [2027, 0, 3, 23, 59], '2026-12-28'],
    ['Monday Jan 4 00:01', [2027, 0, 4, 0, 1], '2027-01-04'],
    ['leap day (Tue Feb 29 2028)', [2028, 1, 29, 22, 0], '2028-02-28'],
  ];
  for (const [label, [y, mo, d, h, mi], want] of WALL) {
    const at = new Date(y, mo, d, h, mi, 0);
    eq(`${label} → week of ${want}`, localWeekStart(at), want);
    eq(`…Last Planner opens on the same week`, currentWeekStart(at), want);
    eq(`…and Summary's strip starts on it`, computeWeekLoad([], at).days[0]?.date, want);
  }

  // Fixed INSTANTS: one moment, a different local day per zone. These are the
  // moments the two screens used to disagree at.
  const INSTANTS: [string, Record<string, string>][] = [
    ['2026-10-05T00:30:00Z', { 'America/New_York': '2026-09-28', 'America/Denver': '2026-09-28', UTC: '2026-10-05', 'Asia/Tokyo': '2026-10-05' }],
    ['2026-10-05T01:00:00Z', { 'America/New_York': '2026-09-28', 'America/Denver': '2026-09-28', UTC: '2026-10-05', 'Asia/Tokyo': '2026-10-05' }],
    ['2026-10-05T03:59:00Z', { 'America/New_York': '2026-09-28', 'America/Denver': '2026-09-28', UTC: '2026-10-05', 'Asia/Tokyo': '2026-10-05' }],
    ['2026-10-05T04:01:00Z', { 'America/New_York': '2026-10-05', 'America/Denver': '2026-09-28', UTC: '2026-10-05', 'Asia/Tokyo': '2026-10-05' }],
    ['2026-10-04T15:30:00Z', { 'America/New_York': '2026-09-28', 'America/Denver': '2026-09-28', UTC: '2026-09-28', 'Asia/Tokyo': '2026-10-05' }],
    ['2026-10-04T14:59:00Z', { 'America/New_York': '2026-09-28', 'America/Denver': '2026-09-28', UTC: '2026-09-28', 'Asia/Tokyo': '2026-09-28' }],
    // Winter (EST, UTC-5): the window opens at 7 pm, not 8.
    ['2027-01-04T00:30:00Z', { 'America/New_York': '2026-12-28', 'America/Denver': '2026-12-28', UTC: '2027-01-04', 'Asia/Tokyo': '2027-01-04' }],
  ];
  for (const [iso, byZone] of INSTANTS) {
    const want = byZone[tz];
    if (!want) { ok(`instant ${iso}: an expectation exists for ${tz}`, false, 'add this zone to INSTANTS'); continue; }
    const at = new Date(iso);
    eq(`instant ${iso} is the week of ${want} here`, localWeekStart(at), want);
    eq(`…on Last Planner`, currentWeekStart(at), want);
    eq(`…and on Summary`, computeWeekLoad([], at).days[0]?.date, want);
  }

  // Every hour of two years: the screens never part, the key is always a
  // Monday, the strip is always seven consecutive calendar days with exactly
  // one TODAY on the local day.
  {
    let apart = '', notMonday = '', badStrip = '', badToday = '';
    let n = 0;
    for (let ms = Date.UTC(2026, 0, 1, 0, 30); ms < Date.UTC(2028, 0, 1); ms += 3_600_000) {
      n++;
      const at = new Date(ms);
      const lp = currentWeekStart(at);
      const week = computeWeekLoad([], at);
      const stamp = `${at.toISOString()} lastPlanner=${lp} summary=${week.days[0]?.date}`;
      if (!apart && lp !== week.days[0]?.date) apart = stamp;
      if (!notMonday && (parseCalendarDay(lp)?.getDay() !== 1 || lp !== toCalendarDayString(mondayOfLocalWeek(at)))) notMonday = stamp;
      if (!badStrip) {
        const monday = parseCalendarDay(lp)!;
        for (let i = 0; i < 7; i++) {
          if (week.days[i]?.date !== toCalendarDayString(addCalendarDays(monday, i))) badStrip = `${stamp} day ${i}=${week.days[i]?.date}`;
        }
      }
      const todays = week.days.filter(d => d.isToday);
      if (!badToday && (todays.length !== 1 || todays[0].date !== todayCalendarDay(at))) badToday = `${stamp} today=${todays.map(d => d.date).join('|')}`;
    }
    ok(`Last Planner and Summary name the same week at every hour of 2026–2027 (${n} instants)`, !apart, apart);
    ok('…that week key is always a local Monday', !notMonday, notMonday);
    ok('…the strip is seven consecutive calendar days from it (DST weeks included)', !badStrip, badStrip);
    ok('…with exactly one TODAY, on the local day', !badToday, badToday);
  }

  // The lookahead buckets by the same Monday: on Sunday 21:00 a task on this
  // (ending) week's Monday is THIS week, and one on tomorrow is NEXT week.
  {
    const sundayNight = new Date(2026, 9, 4, 21, 0, 0);
    const mk = (id: string) => ({
      id, title: id, phase: 'Drywall', startDay: 1, durationDays: 3, progress: 0, crew: '',
      dependencies: [], notes: '', status: 'not_started',
    }) as unknown as Parameters<typeof buildLookahead>[0][number];
    const ending = buildLookahead([mk('a')], '2026-09-28', [], { weeks: 3, asOf: sundayNight });
    eq('Sunday 21:00: work dated this (ending) week is in the lookahead as this week', ending.weeks[0]?.weeksOut, 0);
    eq('…under this week\'s Monday', ending.weeks[0]?.weekStart, '2026-09-28');
    const coming = buildLookahead([mk('b')], '2026-10-05', [], { weeks: 3, asOf: sundayNight });
    eq('Sunday 21:00: work starting tomorrow is NEXT week, not this week', coming.weeks[0]?.weeksOut, 1);
  }

  // STORED KEYS. last_planner_commitments.week_start rows were all written as
  // a Monday 'YYYY-MM-DD' and are matched by string equality; nothing is
  // rewritten. A row written before this change on a Sunday evening west of
  // Greenwich carries the COMING Monday (the UTC rule) — it is that week's
  // row, found one tap forward on Sunday night and on "This week" from Monday.
  {
    eq('addWeeks is calendar arithmetic across spring forward', addWeeks('2026-03-02', 1), '2026-03-09');
    eq('…across fall back', addWeeks('2026-10-26', 1), '2026-11-02');
    eq('…across the year end', addWeeks('2026-12-28', 1), '2027-01-04');
    eq('…and backwards', addWeeks('2026-11-02', -1), '2026-10-26');
    const stored = [{ taskId: 't', weekStart: '2026-10-05', committed: true, outcome: 'done' as const }];
    const sundayNight = new Date(2026, 9, 4, 21, 0, 0);
    eq('a row stored under the coming Monday is read one week forward on Sunday night',
      computePpc(stored, addWeeks(currentWeekStart(sundayNight), 1)).committed, 1);
    eq('…and as "This week" from Monday 00:01', computePpc(stored, currentWeekStart(new Date(2026, 9, 5, 0, 1, 0))).committed, 1);
    eq('…through the following Sunday 23:59', computePpc(stored, currentWeekStart(new Date(2026, 9, 11, 23, 59, 0))).committed, 1);
  }
}

// ════════════════════════════════════════════════════════════════════════�
// THE DAY RULE (2026-10-05). "Today" for jobsite work is the DEVICE'S LOCAL
// calendar day, on every screen and in every record. The week fix the night
// before left the same bug wherever "today" came from the UTC date
// (`new Date().toISOString().slice(0, 10)`): in New York from 8 pm (7 pm in
// winter) it is already "tomorrow", and in Tokyo until 9 am it is still
// "yesterday". One helper — todayCalendarDay — answers; nothing else may.
// Runs once per timezone, like the rest.
// ════════════════════════════════════════════════════════════════════════�

/** Run `fn` with `new Date()` / `Date.now()` frozen at `at`. */
function withNow<T>(at: Date, fn: () => T): T {
  const Real = Date;
  const frozen = at.getTime();
  class Frozen extends Real {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(frozen);
      else super(...(args as [number]));
    }
    static now() { return frozen; }
  }
  (globalThis as { Date: DateConstructor }).Date = Frozen as unknown as DateConstructor;
  try { return fn(); } finally { (globalThis as { Date: DateConstructor }).Date = Real; }
}

function localDayChecks() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`[TZ=${tz}] "today" is the device's local calendar day (DAY RULE):`);
  const pad = (n: number) => String(n).padStart(2, '0');
  const zoneDay = (at: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
    const get = (t: string) => parts.find(x => x.type === t)!.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  };

  // Wall clocks: the four moments around the old 8 pm flip and around
  // midnight, on an ordinary day and on both US clock-change days.
  const DAYS: [string, number, number, number][] = [
    ['an ordinary Monday', 2026, 9, 5],
    ['the day US clocks spring forward', 2026, 2, 8],
    ['the day US clocks fall back', 2026, 10, 1],
    ['New Year\'s Eve', 2026, 11, 31],
  ];
  for (const [name, y, m, d] of DAYS) {
    for (const [h, mi] of [[19, 59], [20, 1], [23, 59], [0, 1]] as const) {
      const at = new Date(y, m, d, h, mi);
      const want = `${y}-${pad(m + 1)}-${pad(d)}`;
      eq(`${name}, ${pad(h)}:${pad(mi)} local → ${want}`, todayCalendarDay(at), want);
      eq(`…and that is the day the zone itself names`, zoneDay(at), want);
      eq(`…also when the clock is read, not passed`, withNow(at, () => todayCalendarDay()), want);
    }
  }

  // Fixed instants: one moment, a different local day per zone.
  const FIXED: [string, Record<string, string>][] = [
    ['2026-10-06T01:00:00Z', { 'America/Denver': '2026-10-05', 'America/New_York': '2026-10-05', UTC: '2026-10-06', 'Asia/Tokyo': '2026-10-06' }],
    ['2026-10-05T23:59:00Z', { 'America/Denver': '2026-10-05', 'America/New_York': '2026-10-05', UTC: '2026-10-05', 'Asia/Tokyo': '2026-10-06' }],
    ['2026-10-05T16:30:00Z', { 'America/Denver': '2026-10-05', 'America/New_York': '2026-10-05', UTC: '2026-10-05', 'Asia/Tokyo': '2026-10-06' }],
    ['2026-03-09T03:30:00Z', { 'America/Denver': '2026-03-08', 'America/New_York': '2026-03-08', UTC: '2026-03-09', 'Asia/Tokyo': '2026-03-09' }],
    ['2026-03-08T06:59:00Z', { 'America/Denver': '2026-03-07', 'America/New_York': '2026-03-08', UTC: '2026-03-08', 'Asia/Tokyo': '2026-03-08' }],
    ['2026-11-01T05:30:00Z', { 'America/Denver': '2026-10-31', 'America/New_York': '2026-11-01', UTC: '2026-11-01', 'Asia/Tokyo': '2026-11-01' }],
    ['2026-11-02T04:30:00Z', { 'America/Denver': '2026-11-01', 'America/New_York': '2026-11-01', UTC: '2026-11-02', 'Asia/Tokyo': '2026-11-02' }],
    ['2027-01-01T00:30:00Z', { 'America/Denver': '2026-12-31', 'America/New_York': '2026-12-31', UTC: '2027-01-01', 'Asia/Tokyo': '2027-01-01' }],
  ];
  for (const [iso, want] of FIXED) {
    if (want[tz]) eq(`the instant ${iso} is ${want[tz]} here`, todayCalendarDay(new Date(iso)), want[tz]);
  }

  // Every hour of 2026 and 2027 against the zone's own calendar.
  {
    let bad = '';
    let differs = 0;
    const end = Date.UTC(2028, 0, 1);
    for (let t = Date.UTC(2026, 0, 1); t < end && !bad; t += 3_600_000) {
      const at = new Date(t);
      const got = todayCalendarDay(at);
      if (got !== zoneDay(at)) bad = `${at.toISOString()} → ${got}, the zone says ${zoneDay(at)}`;
      if (got !== at.toISOString().slice(0, 10)) differs++;
    }
    ok('todayCalendarDay equals the zone\'s own day at every hour of 2026 and 2027', !bad, bad);
    ok(tz === 'UTC' ? 'in UTC the UTC date is never wrong (control)' : 'the UTC date is the WRONG day for some hours here — the bug this rule ends',
      tz === 'UTC' ? differs === 0 : differs > 0, `${differs} hour(s) differ`);
  }

  // ── Every behaviour that SAVES a date, at 9 pm local on Monday Oct 5 ─────
  // (in New York that instant is 2026-10-06T01:00Z — its UTC date is the 6th).
  const evening = new Date(2026, 9, 5, 21, 0);
  const eveningIso = evening.toISOString();
  const DAY = '2026-10-05';
  if (tz === 'America/New_York' || tz === 'America/Denver') {
    eq('(the case bites here: 9 pm local is already the 6th in UTC)', eveningIso.slice(0, 10), '2026-10-06');
  }
  if (tz === 'Asia/Tokyo') {
    eq('(the case bites here: local midnight is still the 4th in UTC)', new Date(2026, 9, 5).toISOString().slice(0, 10), '2026-10-04');
  }

  // 1. Schedule import: an imported schedule with no start date is anchored today.
  eq('import anchor: an undated import at 9 pm is anchored to TODAY', withNow(evening, () => todayCalendarDay()), DAY);
  // 2. An undated schedule's start (the project's createdAt instant, or the
  //    local-midnight anchor of a double-tapped Gantt day) is its LOCAL day.
  eq('undated schedule start: a project created at 9 pm starts that day', toCalendarDayString(new Date(eveningIso)), DAY);
  eq('double-tap-to-add: the tapped local-midnight day prefills itself', toCalendarDayString(new Date(2026, 9, 5)), DAY);
  // 3. Auto-drafted change orders are dated today, and the 14-day window is
  //    14 LOCAL days.
  {
    const project = { id: 'p1', name: 'Job', status: 'in_progress' } as unknown as Project;
    const reportAt = (d: Date, id: string) => ({
      id, projectId: 'p1', date: d.toISOString(),
      leakScan: { items: [{ description: 'Extra outlet', estimatedPrice: 250 }] },
    }) as unknown as DailyFieldReport;
    const draft = withNow(evening, () => buildDraftCO({ report: reportAt(evening, 'r0'), project }, [], todayCalendarDay()));
    eq('CO draft date: a change order drafted at 9 pm is dated TODAY', draft.date, DAY);
    const collect = (now: Date, r: DailyFieldReport) => collectDraftableLeaks({
      dailyReports: [r], projects: [project], changeOrders: [], processedReportIds: new Set(), userId: 'u1', now,
    }).length;
    eq('…a report filed 14 local days ago (10 am) is still in the window at 9 pm', collect(evening, reportAt(new Date(2026, 8, 21, 10, 0), 'r1')), 1);
    eq('…one filed 15 local days ago (9:30 pm) is out of it the next morning', collect(new Date(2026, 9, 5, 10, 0), reportAt(new Date(2026, 8, 20, 21, 30), 'r2')), 0);
    eq('…and one filed 14 local days ago at 9:30 pm is in', collect(evening, reportAt(new Date(2026, 8, 21, 21, 30), 'r3')), 1);
  }
  // 4. A change order's approval target is N calendar days after the LOCAL day it was sent.
  {
    const mint = (co: Record<string, unknown>) => coPastItsOwnTurnaround.mint({
      nowMs: evening.getTime(), projectId: 'p1', projectName: 'Job',
      changeOrders: [{ id: 'co1', number: 1, status: 'submitted', description: 'x', approvers: [], ...co }],
    } as unknown as Parameters<typeof coPastItsOwnTurnaround.mint>[0])[0]?.targetDate;
    eq('approval target: sent at 9 pm with a 7-day turnaround → due the 12th', mint({ date: eveningIso, approvalDeadlineDays: 7 }), '2026-10-12');
    eq('…a bare sent day gives the same answer', mint({ date: DAY, approvalDeadlineDays: 7 }), '2026-10-12');
    eq('…across the day US clocks fall back', mint({ date: new Date(2026, 9, 28, 21, 0).toISOString(), approvalDeadlineDays: 7 }), '2026-11-04');
    eq('…and the day they spring forward', mint({ date: new Date(2026, 2, 5, 21, 0).toISOString(), approvalDeadlineDays: 7 }), '2026-03-12');
  }
  // 5. A receipt's date is the day printed on it.
  {
    const receiptDate = (printed: string) => normalizeExtraction({ receiptDate: printed, lines: [] } as unknown as Parameters<typeof normalizeExtraction>[0], { projectId: 'p1', now: eveningIso }).receiptDate;
    eq('receipt date: "Oct 5, 2026 9:15 PM" is Oct 5', receiptDate('Oct 5, 2026 9:15 PM'), DAY);
    eq('…"10/5/2026" is Oct 5', receiptDate('10/5/2026'), DAY);
    eq('…an ISO day is kept as written', receiptDate('2026-10-05'), DAY);
    eq('…an ISO timestamp keeps its printed day', receiptDate('2026-10-05T21:15:00'), DAY);
    eq('…and what cannot be read is shown as printed', receiptDate('fifth of October'), 'fifth of October');
  }
  // 6. The lien-waiver through-date falls back to today (the invoice screen),
  //    and the waiver screen reads an instant as its local day.
  eq('waiver through-date: an invoice issued at 9 pm is "through" that day', calendarDayOf(eveningIso), DAY);
  eq('…and with nothing on the invoice it is today', withNow(evening, () => calendarDayOf(undefined) ?? todayCalendarDay()), DAY);

  // ── Display: what is "today" / "expired" / "overdue" at 9 pm ─────────────
  eq('prequal: an approval at 9 pm runs one year from TODAY', computePrequalExpiry(eveningIso), '2027-10-05');
  eq('…a COI that lapses today is flagged as lapsing TODAY', JSON.stringify(prequalApprovalRisk(eveningIso, DAY)), JSON.stringify({ kind: 'lapsed', coi: DAY, today: true }));
  eq('…a COI good through tomorrow is not a risk at 9 pm tonight', prequalApprovalRisk(eveningIso, '2026-10-06'), null);
  eq('…and a COI that expires today is not "expired" the evening of', withNow(evening, () => renewalBucket(DAY)), '7d');
  eq('…it is expired the next morning', withNow(new Date(2026, 9, 6, 0, 1), () => renewalBucket(DAY)), 'expired');
  {
    const rain = [{ date: DAY, isWorkable: false }] as unknown as Parameters<typeof findWeatherRisk>[3];
    eq('weather on an undated schedule: day 1 of a job created at 9 pm is TODAY\'s forecast', findWeatherRisk(new Date(eveningIso), 1, 1, rain)?.date, DAY);
    eq('…and of a local-midnight anchor', findWeatherRisk(new Date(2026, 9, 5), 1, 1, rain)?.date, DAY);
    eq('…day 2 is tomorrow\'s, not today\'s', findWeatherRisk(new Date(eveningIso), 2, 1, rain), null);
  }
  {
    const portal = { enabled: true } as unknown as ClientPortalSettings;
    const done = (day: string) => ({ id: 'p1', substantialCompletionDate: day }) as unknown as Project;
    const a = withNow(evening, () => buildFeedbackAsk(done(DAY), portal));
    const b = buildFeedbackAsk(done(DAY), portal, DAY);
    eq('portal: the snapshot\'s default "today" is the local day', JSON.stringify(a), JSON.stringify(b));
  }

  // ── THE OVERDUE RULE: overdue from the start of the local day AFTER the due day
  {
    const due2pm = new Date(2026, 9, 5, 14, 0).toISOString();
    eq('overdue: due today at 2 pm, now 2:01 pm → not overdue', daysPastDue(due2pm, new Date(2026, 9, 5, 14, 1)), 0);
    eq('…now 11:59 pm → still not overdue', daysPastDue(due2pm, new Date(2026, 9, 5, 23, 59)), 0);
    eq('…now 12:01 am the next day → 1 day overdue', daysPastDue(due2pm, new Date(2026, 9, 6, 0, 1)), 1);
    eq('…9 am two days later → 2', daysPastDue(due2pm, new Date(2026, 9, 7, 9, 0)), 2);
    eq('…a due date stored at 9 pm is due THAT local day', daysPastDue(eveningIso, new Date(2026, 9, 5, 23, 59)), 0);
    eq('…and overdue at 12:01 am', daysPastDue(eveningIso, new Date(2026, 9, 6, 0, 1)), 1);
    eq('…a bare due day behaves the same', daysPastDue(DAY, new Date(2026, 9, 6, 0, 1)), 1);
    eq('…and is not overdue on its own day', daysPastDue(DAY, new Date(2026, 9, 5, 23, 59)), 0);
    eq('…days are calendar days across the fall-back weekend', daysPastDue('2026-10-31', new Date(2026, 10, 2, 0, 1)), 2);
    eq('…and across spring forward', daysPastDue('2026-03-07', new Date(2026, 2, 9, 0, 1)), 2);
    eq('…not yet due → 0', daysPastDue('2026-10-09', evening), 0);
    eq('…unreadable → 0, never overdue', daysPastDue('next week', evening) + daysPastDue(undefined, evening) + daysPastDue('', evening), 0);

    // The same invoice through every reader that calls it overdue.
    const inv = (dueDate: string) => ({
      id: 'i1', number: 7, projectId: 'p1', status: 'sent', issueDate: '2026-09-05T14:00:00.000Z', dueDate,
      totalDue: 1000, amountPaid: 0, subtotal: 1000, retentionPercent: 0, retentionAmount: 0, retentionReleased: 0, lineItems: [], payments: [],
    }) as unknown as Parameters<typeof getEffectiveInvoiceStatus>[0];
    const projects = [{ id: 'p1', name: 'Job', status: 'in_progress' }] as unknown as Project[];
    const lateSameDay = new Date(2026, 9, 5, 23, 30);
    const nextMorning = new Date(2026, 9, 6, 0, 1);
    const attention = (now: Date) => aggregateAttention(projects, [inv(due2pm)], [], [], now).filter(a => a.id === 'overdue-invoices');
    eq('Summary: no "overdue" row at 11:30 pm on the due day', attention(lateSameDay).length, 0);
    eq('…one at 12:01 am, counted as 1 day', attention(nextMorning).map(a => a.label).join('|'), 'Invoice 1 days overdue');
    eq('invoice badge: "sent" at 11:30 pm on the due day', withNow(lateSameDay, () => getEffectiveInvoiceStatus(inv(due2pm))), 'sent');
    eq('…"overdue" at 12:01 am', withNow(nextMorning, () => getEffectiveInvoiceStatus(inv(due2pm))), 'overdue');
    eq('…1 day past due', withNow(nextMorning, () => getDaysPastDue(inv(due2pm))), 1);
    const aging = (now: Date) => withNow(now, () => computeARAgingReport([inv(due2pm)], projects).rows.map(r => `${r.bucket}:${r.daysPastDue}`).join('|'));
    eq('A/R aging: "current" at 11:30 pm on the due day', aging(lateSameDay), 'current:0');
    eq('…in the 0-30 bucket, 1 day past due, at 12:01 am', aging(nextMorning), '0-30:1');
  }
}

if (process.env[TZ_CHILD_FLAG]) {
  runtimeChecks();
  weekBoundaryChecks();
  localDayChecks();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

// ── Parent: run the runtime checks under each timezone ────────────────────

console.log('\nruntime checks under four timezones:');
for (const tz of TIMEZONES) {
  const res = spawnSync(process.execPath, [__filename], {
    env: { ...process.env, TZ: tz, [TZ_CHILD_FLAG]: '1' },
    encoding: 'utf8',
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
  const childFails = out.split('\n').filter(l => /^\s*FAIL /.test(l));
  ok(`TZ=${tz}: every runtime check passes`, res.status === 0 && childFails.length === 0,
    childFails.join('\n       ') || out.slice(-400));
  const resolved = /\[TZ=([^\]]+)\]/.exec(out)?.[1];
  ok(`TZ=${tz}: the child actually ran in that zone`, resolved === tz, `child reported ${resolved}`);
}

// THE WEEK RULE, at its call sites. The runtime sweep above proves the answers
// agree; these pin WHERE each screen asks, so a fourth copy of "the Monday of
// now" cannot grow back unnoticed.
{
  console.log('\nevery "which week is it now" asks utils/calendarDate (WEEK RULE):');
  const fnBody = (src: string, signature: string): string => {
    const from = src.indexOf(signature);
    if (from < 0) return '';
    const next = src.indexOf('\nexport function ', from + signature.length);
    return src.slice(from, next < 0 ? undefined : next);
  };
  const lp = read('utils/lastPlanner.ts');
  ok('lastPlanner.currentWeekStart returns localWeekStart(asOf)',
    /return localWeekStart\(asOf\);/.test(fnBody(lp, 'export function currentWeekStart(')));
  ok('lastPlanner.buildLookahead takes "this Monday" from currentWeekStart(asOf)',
    /const thisMonday = currentWeekStart\(asOf\);/.test(fnBody(lp, 'export function buildLookahead(')));
  const summary = fnBody(read('utils/summaryBriefing.ts'), 'export function computeWeekLoad(');
  ok('summaryBriefing.computeWeekLoad starts its strip at mondayOfLocalWeek',
    /mondayOfLocalWeek\(/.test(summary) && !/getDay\(\)|getUTCDay\(\)/.test(summary));
  const close = read('utils/weekClose/composeWeekClose.ts');
  ok('composeWeekClose scores PPC on currentWeekStart(now), not its own Monday',
    /const thisMonday = currentWeekStart\(now\);/.test(close));

  // `toMonday` is for a DAY-GRID date (UTC midnight of a calendar day). Handing
  // it an instant is the bug; no caller outside lastPlanner may hold it at all.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(ROOT, rel)).isDirectory()) { walk(rel); continue; }
      if (!/\.tsx?$/.test(name)) continue;
      const src = read(rel);
      src.split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (/\btoMonday\(\s*(new Date\(\s*\)|now\b|asOf\b|Date\.now)/.test(line)) offenders.push(`${rel}:${i + 1} passes an instant to toMonday`);
        if (rel !== 'utils/lastPlanner.ts' && /\btoMonday\b/.test(line)) offenders.push(`${rel}:${i + 1} uses toMonday outside utils/lastPlanner`);
      });
    }
  };
  for (const dir of ['app', 'components', 'contexts', 'hooks', 'utils', 'lib']) walk(dir);
  ok('no caller derives the current week from the UTC date (toMonday of an instant)', offenders.length === 0, offenders.join('\n       '));
}

// Spanish routing has no import cycle (wave-next I18NWIRE): i18n/format.ts
// imports utils/calendarDate.ts, so calendarDate must reach the Spanish tables
// through i18n/dateEs.ts, which imports nothing from utils/.
{
  // Side-effect imports (`import '…';`) count too.
  const importsOf = (p: string) => [...read(p).matchAll(/^import\s+(?:[^;]*?from\s+)?'([^']+)'/gm)].map(m => m[1]);
  const cal = importsOf('utils/calendarDate.ts');
  ok('utils/calendarDate.ts never imports i18n/format (cycle)', !cal.some(m => /i18n\/format$/.test(m)), cal.join(', '));
  ok('…it reaches Spanish through i18n/dateEs and the language through i18n/core', cal.includes('../i18n/dateEs') && cal.includes('../i18n/core'), cal.join(', '));
  const es = importsOf('i18n/dateEs.ts');
  ok('i18n/dateEs.ts imports nothing from utils/ or react-native', !es.some(m => /utils\/|react-native/.test(m)), es.join(', '));
}

// ═══════════════════════════════════════════════════════════════════════════
// Source enumeration — every date-ish parse in app/ and components/.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sites that parse a date-ish expression with `new Date()` / `Date.parse()`
 * and have been READ and judged safe. `line` is the exact call text (not a
 * line number — numbers drift with every edit above them). Every entry must
 * still match a live site; a stale entry fails the run.
 */
interface Allowed { file: string; line: string; reason: string; added: string }
const ALLOWED: Allowed[] = [
  // ── Full ISO instants (written with toISOString()), never a bare day ──
  { file: 'components/punch/PunchExportSheet.tsx', line: 'new Date(model.generatedAtIso)', added: '2026-09-17',
    reason: 'utils/punchExportCore.ts sets generatedAtIso = now.toISOString() — the INSTANT the export was built, never a bare day. It is turned back into a Date only to stamp the file name through exportFileName, which formats the LOCAL day itself; the two call sites are the native PDF and the web print.' },
  { file: 'app/wip-report.tsx', line: "Date.parse(raw.updated_at ?? '')", added: '2026-09-08',
    reason: 'wip_cost_overrides.updated_at is a timestamptz — an INSTANT, not a calendar day. It is parsed to milliseconds only to decide which of two devices wrote last (string compare over mixed offsets would let the laptop\'s newer figure lose to the phone\'s older one, which is the failure the override sync exists to fix). No day is ever named from it.' },
  // `new Date(reportDate)` (daily-report), `new Date(dr.date)` (report-inbox,
  // project-detail) and project-detail's DFR sort keys used to sit here as
  // "an instant". They were not always: the voice report stored a bare day for
  // a while. All now read through dayOrInstantDate (pinned by name above).
  // `new Date(lastReport.date)` used to sit here. It is gone: DFR-CARRY-LABEL
  // replaced both readers with carrySourceDayLabel / carrySourceDayAbsolute,
  // which resolve the day through calendarDayOf and are executed for real in
  // the runtime section above.
  // daily-report's Date.parse(a.date)/(b.date) sort comparator used to sit
  // here; wave 4 (lane dfr) removed that site, so the entries went with it.
  // RFI.dateRequired is NOT an instant: app/photo-triage.tsx and the voice
  // parsers write a bare 'YYYY-MM-DD', DatePickerModal writes noon UTC, and
  // app/rfi.tsx's two-week default is a bare local day. Every screen reader
  // (report-inbox, weekly-snapshot, project-detail, rfi.tsx) resolves it
  // parseCalendarDay-first (daysUntilCalendarDay / formatCalendarDay), so no
  // `new Date(…dateRequired)` site remains to allow (B4 review A2). The
  // readers this enumerator CANNOT see — app/client-view.tsx formatDate(iso),
  // utils/delayScan/rfiBlocking.ts overdueCalendarDays (behind app/rfi.tsx's
  // overdue badge) and the utils/ readers (pdfGenerator RFI log, emailService,
  // mageAgent, rfiLatency, oacEngine) — go through calendarDayStart, which
  // keeps a true instant on its local day; pinned in the runtime block above.
  { file: 'app/report-inbox.tsx', line: 'new Date(r.dateSubmitted ?? r.createdAt)', added: '2026-09-04',
    reason: 'both are toISOString() instants — app/rfi.tsx (`dateSubmitted: now`) and app/photo-triage.tsx (same, since B4 review A2; it used to write the bare UTC day)' },
  { file: 'app/report-inbox.tsx', line: 'new Date(inv.dueDate)', added: '2026-09-04',
    reason: 'Invoice.dueDate is an instant — app/invoice.tsx getDueDate() returns toISOString()' },
  { file: 'app/report-inbox.tsx', line: 'new Date(inv.issueDate ?? inv.createdAt)', added: '2026-09-04',
    reason: 'Invoice.issueDate = now (a toISOString() instant) in app/invoice.tsx buildNewInvoice' },
  { file: 'app/reports.tsx', line: 'new Date(r.issueDate)', added: '2026-09-04', reason: 'Invoice.issueDate instant (see report-inbox entry)' },
  { file: 'app/reports.tsx', line: 'new Date(r.dueDate)', added: '2026-09-04', reason: 'Invoice.dueDate instant (getDueDate → toISOString())' },
  { file: 'app/(tabs)/discover/bids.tsx', line: 'new Date(deadline)', added: '2026-09-04', reason: 'getDeadlineInfo(bid.response_deadline): public_bids.response_deadline is timestamptz (schema.sql:374)' },
  { file: 'app/(tabs)/discover/bids.tsx', line: 'new Date(bid.response_deadline)', added: '2026-09-04', reason: 'timestamptz column (schema.sql:374)' },
  { file: 'app/(tabs)/discover/bids.tsx', line: 'new Date(a.posted_date)', added: '2026-09-04', reason: 'posted_date is timestamptz (schema.sql:373)' },
  { file: 'app/(tabs)/discover/bids.tsx', line: 'new Date(b.posted_date)', added: '2026-09-04', reason: 'posted_date is timestamptz (schema.sql:373)' },
  { file: 'app/(tabs)/mage-id-bids/index.tsx', line: 'new Date(b.posted_date)', added: '2026-09-04', reason: 'homeowner RFP posted_date = new Date().toISOString() (app/post-rfp.tsx:390); sort key' },
  { file: 'app/(tabs)/mage-id-bids/index.tsx', line: 'new Date(a.posted_date)', added: '2026-09-04', reason: 'same sort key, other operand' },
  { file: 'app/nearby-rfps.tsx', line: 'new Date(b.posted_date)', added: '2026-09-04', reason: 'posted_date instant (app/post-rfp.tsx:390); sort key' },
  { file: 'app/nearby-rfps.tsx', line: 'new Date(a.posted_date)', added: '2026-09-04', reason: 'same sort key, other operand' },
  { file: 'app/cash-flow.tsx', line: 'new Date(ep.expectedDate)', added: '2026-09-04', reason: 'expectedDate: date.toISOString() (app/cash-flow.tsx:360)' },
  { file: 'app/bid-detail.tsx', line: 'new Date(dateStr)', added: '2026-09-04', reason: 'formats public_bids timestamptz fields (posted_date / response_deadline)' },
  { file: 'app/bid-detail.tsx', line: 'new Date(deadline)', added: '2026-09-04', reason: 'getCountdown(bid.response_deadline): timestamptz' },
  { file: 'app/retention.tsx', line: 'new Date(inv.issueDate)', added: '2026-09-04', reason: 'Invoice.issueDate instant' },
  { file: 'app/payments.tsx', line: 'new Date(a.issueDate)', added: '2026-09-04', reason: 'Invoice.issueDate instant; sort key' },
  { file: 'app/payments.tsx', line: 'new Date(b.issueDate)', added: '2026-09-04', reason: 'same sort key, other operand' },
  { file: 'app/client-view.tsx', line: "new Date(co.approvers.find(a => a.role === 'Client' && a.status === 'approved')?.responseDate ?? co.updatedAt)", added: '2026-09-04',
    reason: 'responseDate: now, where now = new Date().toISOString() (app/client-view.tsx submitApproval, both approver entries); updatedAt is an instant' },
  { file: 'app/invoice.tsx', line: 'new Date(issueDate)', added: '2026-09-04', reason: 'getDueDate(issueDate): issueDate is the toISOString() instant buildNewInvoice writes (issueDate: now)' },
  { file: 'app/invoice.tsx', line: 'new Date(existingInvoice.dueDate)', added: '2026-09-04', reason: 'Invoice.dueDate instant' },
  { file: 'app/invoice.tsx', line: 'new Date(r.date)', added: '2026-09-04', reason: 'payment record date = new Date().toISOString() (app/invoice.tsx handleMarkPaid / handleReleaseRetention)' },
  { file: 'app/post-bid.tsx', line: 'new Date(deadline.trim())', added: '2026-09-04', reason: 'validity gate only — the regex on the next line enforces YYYY-MM-DD and the Date value is not used for a day' },
  { file: 'app/shared-photos.tsx', line: 'new Date(dates[0])', added: '2026-09-04', reason: 'photo capture timestamps (payload.photos[].ts), instants' },
  { file: 'app/shared-photos.tsx', line: 'new Date(dates[dates.length - 1])', added: '2026-09-04', reason: 'photo capture timestamps, instants' },
  { file: 'app/project-detail.tsx', line: 'new Date(inv.dueDate)', added: '2026-09-04', reason: 'Invoice.dueDate instant' },
  // Two sibling entries (new Date(inv.dueDate), new Date(lastPayment.date)) were
  // removed 2026-09-07: the per-client prediction rewrite deleted both call
  // sites, and an ALLOWED entry with no live site is a blind entry — it would
  // silently re-permit the parse if someone reintroduced it.
  { file: 'components/AIInvoicePredictor.tsx', line: 'new Date(invoice.dueDate)', added: '2026-09-04', reason: 'Invoice.dueDate instant' },
  { file: 'components/NextStepHero.tsx', line: 'new Date(r.dateSubmitted ?? Date.now())', added: '2026-09-04', reason: 'RFI.dateSubmitted instant (app/rfi.tsx:287, dateSubmitted: now)' },
  // ── Clones of a Date instance (the parameter is typed Date), not parses ──
  { file: 'app/schedule-wizard.tsx', line: 'new Date(date)', added: '2026-09-04', reason: 'addDays(date: Date) clone' },
  { file: 'components/schedule/InteractiveGantt.tsx', line: 'new Date(date)', added: '2026-09-04', reason: 'addDays(date: Date) clone' },
  { file: 'components/schedule/GanttChart.tsx', line: 'new Date(date)', added: '2026-09-04', reason: 'addDays(date: Date) clone' },
  { file: 'components/schedule/ResourceSwimlanes.tsx', line: 'new Date(date)', added: '2026-09-04', reason: 'addDays(date: Date) clone' },
  { file: 'components/schedule/LookaheadView.tsx', line: 'new Date(date)', added: '2026-09-04', reason: 'getMonday(date: Date) clone' },
  { file: 'components/schedule/VerticalGantt.tsx', line: 'new Date(projectStartDate)', added: '2026-09-04', reason: 'projectStartDate is a Date prop; clone before setDate()' },
  { file: 'components/schedule/mobile/WeekStrip.tsx', line: 'new Date(selectedDate)', added: '2026-09-04', reason: 'selectedDate is a Date; clone before shifting a week' },
];

/**
 * Sites that are NOT resolved and NOT judged safe. They are listed here — not
 * in ALLOWED — so the guard passes on the tree the 2026-09-04 fix pass left
 * without lying about them: every entry is either a bare-day-as-UTC defect in
 * a file outside that pass's file set, or a field whose writer could not be
 * traced to a format. Fix the site (or verify the writer) and DELETE the entry;
 * a stale entry fails the run.
 */
interface Unresolved extends Allowed { status: 'defect' | 'unverified' }
const UNRESOLVED: Unresolved[] = [
  // app/time-tracking.tsx 'new Date(entry.date)' — FIXED and removed
  // 2026-09-17 (audit round 2, #8/#9). The writer now stamps the LOCAL day
  // (timeEntryDay in hooks/useTimeEntries.ts) and the history reads it through
  // the calendarDate helpers, so the site no longer exists; a listed entry with
  // no live site fails this run, which is how we found out it was done.
  { file: 'app/oac-meeting.tsx', line: 'new Date(a.dueBy)', status: 'defect', added: '2026-09-04',
    reason: 'AI-extracted "ISO date" (bare) parsed as UTC in the minutes and the exported HTML — two sites, one snippet (audit appendix)' },
  { file: 'app/(tabs)/mage-id-bids/index.tsx', line: 'new Date(r.deadline)', status: 'defect', added: '2026-09-04',
    reason: 'homeowner deadline is typed as YYYY-MM-DD (app/post-rfp.tsx:898) and stored bare; daysLeft is one short west of Greenwich. Fix: daysUntilCalendarDay. Outside the B4 edit region (Nearby entry only)' },
  { file: 'app/nearby-rfps.tsx', line: 'new Date(r.deadline)', status: 'defect', added: '2026-09-04',
    reason: 'same bare deadline as mage-id-bids; B4 owned copy only' },
  { file: 'components/schedule/SchedulerHeader.tsx', line: 'new Date(t.deadline)', status: 'defect', added: '2026-09-04',
    reason: 'overdue count parses the bare deadline as UTC midnight — overdue from ~6 pm the evening before (UX-F9 class); file not in the B4 set' },
  // components/schedule/WeatherReschedulePrompt.tsx 'new Date(startISO)' —
  // FIXED and removed 2026-09-27 (health lane SCHEDDAYS). The push walk moved
  // to utils/weatherReschedule.ts findWeatherPushConflicts; a dated schedule
  // walks WORKING days through utils/scheduleCalendarDate, and the raw-day
  // walk is keyed exactly like findWeatherRisk's raw path with no UTC
  // re-parse. The component no longer does date arithmetic at all.
  { file: 'app/equipment-detail.tsx', line: 'new Date(u.date)', status: 'unverified', added: '2026-09-04',
    reason: 'EquipmentUtilizationEntry.date — logUtilization callers were not traced to a format' },
  { file: 'app/equipment-detail.tsx', line: 'new Date(a.date)', status: 'unverified', added: '2026-09-04', reason: 'same field, sort key' },
  { file: 'app/equipment-detail.tsx', line: 'new Date(b.date)', status: 'unverified', added: '2026-09-04', reason: 'same field, sort key' },
  { file: 'app/(tabs)/subs/index.tsx', line: 'new Date(bid.date)', status: 'unverified', added: '2026-09-04',
    reason: 'SubBidRecord.date — writer not traced' },
];

interface Hit { file: string; lineNo: number; snippet: string }

/** Block comments become spaces (line numbers survive); `//` comments are cut
 *  unless the `//` sits inside a string literal (odd quote count before it). */
function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  return noBlocks.split('\n').map(line => {
    let from = 0;
    for (;;) {
      const i = line.indexOf('//', from);
      if (i < 0) return line;
      const before = line.slice(0, i);
      const inString = ["'", '"', '`'].some(q => (before.split(q).length - 1) % 2 === 1);
      if (!inString) return before;
      from = i + 2;
    }
  }).join('\n');
}

// `Iso`/`ISO` suffixes are included because the schedule anchors travel under
// names like baseIso / projectStartISO / startISO and carry calendar days.
// `updatedAt`-style instants contain "date" by accident and are stripped
// before the test.
const DATE_ISH = /date|Date|deadline|dueBy|Iso\b|ISO\b/;

/** Every `new Date(<arg>)` / `Date.parse(<arg>)` whose <arg> names a date-ish
 *  value and is not already resolved as a calendar day. */
function findDateParses(file: string, src: string): Hit[] {
  const code = stripComments(src);
  const hits: Hit[] = [];
  const re = /\b(new\s+Date|Date\.parse)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    // Balanced-paren scan for the argument list.
    let depth = 1;
    let i = m.index + m[0].length;
    const argStart = i;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
    }
    const arg = code.slice(argStart, i - 1).trim();
    const lineNo = code.slice(0, m.index).split('\n').length;
    const line = code.split('\n')[lineNo - 1] ?? '';
    const snippet = `${m[1].replace(/\s+/g, ' ')}(${arg})`;

    if (arg === '') continue;                        // new Date()
    if (/^Date\.(now\(\)|UTC\()/.test(arg)) continue; // an instant / instant arithmetic
    if (/^\d+$/.test(arg)) continue;                 // epoch millis literal
    if (/\.getTime\(\)|\bMs\b|Millis/.test(arg)) continue; // millisecond arithmetic
    if (/,/.test(arg.replace(/\([^()]*\)/g, ''))) continue; // new Date(y, m, d) components
    if (!DATE_ISH.test(arg.replace(/\b\w*[uU]pdatedAt\b/g, ''))) continue;
    if (/T\d\d:\d\d:\d\d/.test(arg)) continue;       // explicit local-time suffix ('T00:00:00', 'T12:00:00')
    if (/parseCalendarDay\(/.test(line)) continue;   // resolved on the same line
    hits.push({ file, lineNo, snippet });
  }
  return hits;
}

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { if (name !== 'node_modules') out.push(...listSources(full)); }
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

console.log('\nthe enumerator itself still sees the bug:');
{
  const bad = findDateParses('x.tsx', `const a = new Date(item.dueDate);\nconst b = Date.parse(sched.startDate);\nconst c = new Date(f.date).toLocaleDateString();\nconst d = Date.parse(baseIso); const e = new Date(payload.projectStartISO);`);
  eq('flags bare parses of dueDate / startDate / f.date / baseIso / projectStartISO', bad.length, 5);
  const guarded = findDateParses('x.tsx', [
    `const a = new Date(item.dueDate + 'T00:00:00');`,
    `const b = parseCalendarDay(iso) ?? new Date(iso.startDate);`,
    `const c = new Date(); const d = new Date(Date.now()); const e = new Date(baseMs);`,
    `const f = new Date(d.getFullYear(), d.getMonth(), 1); const g = new Date(now);`,
    `const k = new Date(row.updatedAt); const l = new Date(Date.now() + 7 * 86400000); const m = new Date(Date.UTC(y, mo, d, 12));`,
    `const n = new Date(dateISO + 'T12:00:00');`,
    `// const h = new Date(task.deadline);`,
    `/* new Date(schedule.startDate) */ const i = 1;`,
  ].join('\n'));
  eq('ignores the T00:00:00 suffix, parseCalendarDay lines, instants, components and comments', guarded.length, 0);
  const url = findDateParses('x.tsx', `const u = 'https://x.test/a'; const j = new Date(row.dueDate);`);
  eq('a // inside a string does not hide the rest of the line', url.length, 1);
}

console.log('\nevery date-ish parse in app/ and components/ is resolved or allowed:');
{
  const files = [...listSources(join(ROOT, 'app')), ...listSources(join(ROOT, 'components'))];
  const hits: Hit[] = [];
  for (const full of files) {
    const rel = full.slice(ROOT.length + 1);
    hits.push(...findDateParses(rel, readFileSync(full, 'utf8')));
  }
  const matched = new Set<Allowed>();
  const known = new Set<Unresolved>();
  // Fixed since the 2026-09-04 pass (B4 review): app/(tabs)/schedule/index.tsx
  // `new Date(date)` (open-meteo day vs a noon-anchored task range — now a
  // calendar-day comparison) and app/documents.tsx `new Date(p.expiresDate)`
  // (permits.expires_date is a `date` column, supabase/schema.sql ~1245 — not
  // text as the old entry claimed; now normalised at the aggregation site).
  const unallowed = hits.filter(h => {
    const entry = ALLOWED.find(a => a.file === h.file && a.line === h.snippet);
    if (entry) { matched.add(entry); return false; }
    const listed = UNRESOLVED.find(a => a.file === h.file && a.line === h.snippet);
    if (listed) { known.add(listed); return false; }
    return true;
  });
  ok(`scanned ${files.length} source files`, files.length > 300, `only ${files.length} files found`);
  ok(`no new date-ish parse (found ${hits.length} candidate(s): ${hits.length - unallowed.length - hits.filter(h => UNRESOLVED.some(u => u.file === h.file && u.line === h.snippet)).length} allowed, ${hits.filter(h => UNRESOLVED.some(u => u.file === h.file && u.line === h.snippet)).length} listed unresolved)`,
    unallowed.length === 0,
    unallowed.map(h => `${h.file}:${h.lineNo}: ${h.snippet}  → parseCalendarDay / formatCalendarDay / todayCalendarDay, or add to ALLOWED with a reason`).join('\n       '));
  const stale = ALLOWED.filter(a => !matched.has(a));
  ok('every ALLOWED entry still matches a live site (no blind entries)', stale.length === 0,
    stale.map(a => `${a.file}: ${a.line}`).join('\n       '));
  const staleKnown = UNRESOLVED.filter(a => !known.has(a));
  ok('every UNRESOLVED entry still matches a live site (delete the entry when the site is fixed)', staleKnown.length === 0,
    staleKnown.map(a => `${a.file}: ${a.line}`).join('\n       '));
  const defects = UNRESOLVED.filter(u => u.status === 'defect').length;
  console.log(`       ${defects} known defect(s) and ${UNRESOLVED.length - defects} unverified site(s) remain listed in UNRESOLVED — outside the 2026-09-04 fix set`);
}

// ═══════════════════════════════════════════════════════════════════════════
// The WRITER half — a form that PREFILLS a day must prefill the local one.
//
// The enumerator above only sees date-ish PARSES. It is blind to
// `new Date().toISOString().slice(0, 10)`, which takes no argument at all —
// and that idiom is the writer-side twin of the same bug: from about 6 pm
// local it stamps TOMORROW.
//
// WARR-FORM-UTC-PREFILL (runtime audit 2026-09-06) is exactly that. The
// warranty form's useState initializer already used todayCalendarDay(), but
// resetForm — the code that actually runs, on every "New Warranty" — reset it
// to the UTC day, and handleSave derives endDate = addCalendarMonths(startDay,
// months) from the value it finds, so an evening entry stored a 12-month
// warranty that began and expired a day late.
//
// Scope: app/warranties.tsx only, deliberately. The same idiom is live at 26
// other call sites across 18 other files under app/ + components/ — measured
// 2026-09-06, not estimated, with the same regex this guard uses:
//
//   grep -rnE 'new Date\(\)\s*\.toISOString\(\)\s*\.(slice|split|substring)\(' app components
//
// which reports 27 hits in 19 files; the 19th file is this one's subject,
// app/warranties.tsx, whose single remaining hit is the prose in the comment
// that explains the fix. The heaviest are app/safety-{incidents,inspections,
// jha,toolbox}.tsx, app/field-ticket.tsx, app/job-costing.tsx,
// app/wip-report.tsx and app/schedule-pro.tsx at two apiece. Each is a
// separate judgement — some of those values never leave the device, some are
// keys rather than dates — and widening this guard before those calls are made
// would only produce a failing gate nobody can act on. Widen it as they are
// audited; do not widen it by deleting the ones that fail. If the count above
// no longer matches, re-run the grep rather than adjusting the prose to taste.
// (2026-09-17: app/field-ticket.tsx and app/job-costing.tsx have since been
// audited and are pinned in their own section below; the grep then reported
// 12 hits in 11 files before their fixes.)
// ═══════════════════════════════════════════════════════════════════════════

console.log('\nthe warranty form prefills the LOCAL calendar day:');
{
  const warr = read('app/warranties.tsx');
  const utcDayWrite = /new Date\(\)\s*\.toISOString\(\)\s*\.(?:slice|split|substring)\(/;
  const offenders = warr.split('\n')
    .map((line, i) => ({ text: line.trim(), no: i + 1 }))
    // Prose about the bug is not the bug. Comment lines are excluded so the
    // fix can explain itself.
    .filter(x => !x.text.startsWith('//') && !x.text.startsWith('*') && !x.text.startsWith('/*'))
    .filter(x => utcDayWrite.test(x.text));
  ok('app/warranties.tsx never stamps a date from the UTC day', offenders.length === 0,
    offenders.map(o => `app/warranties.tsx:${o.no}: ${o.text}`).join('\n       '));
  ok('the New Warranty form prefills Start Date with todayCalendarDay()',
    /setStartDate\(todayCalendarDay\(\)\)/.test(warr),
    'resetForm must call setStartDate(todayCalendarDay()) — it is the path openNew() takes');
  ok('the stored expiry is still derived from the prefilled start day',
    /const endDay = addMonths\(startDay, months\)/.test(warr));
}

// ── Field-ticket work date + job-costing (integration round 3) ──────────
// Two more screens from the scope list above, audited and pinned. The field
// ticket's work date is SEALED by the owner's rep's signature and printed on
// the CO and the PDF as "extra work performed <day>" — prefilled from the UTC
// day, an evening ticket carried tomorrow. Job costing prefilled a
// commitment's signed date the same way, and its labor drill-down printed the
// stored TimeEntry.date, which shifts saved before the #9 fix hold as the UTC
// day; the clock-in instant (timeEntryDay) names the day actually worked.

console.log('\nthe field ticket and job costing name the LOCAL calendar day:');
{
  const utcDayWrite = /new Date\(\)\s*\.toISOString\(\)\s*\.(?:slice|split|substring)\(/;
  for (const rel of ['app/field-ticket.tsx', 'app/job-costing.tsx']) {
    const offenders = read(rel).split('\n')
      .map((line, i) => ({ text: line.trim(), no: i + 1 }))
      .filter(x => !x.text.startsWith('//') && !x.text.startsWith('*') && !x.text.startsWith('/*'))
      .filter(x => utcDayWrite.test(x.text));
    ok(`${rel} never stamps a date from the UTC day`, offenders.length === 0,
      offenders.map(o => `${rel}:${o.no}: ${o.text}`).join('\n       '));
  }
  const ft = read('app/field-ticket.tsx');
  ok('the field-ticket composer prefills AND resets the work date with todayCalendarDay()',
    /useState\(\(\) => todayCalendarDay\(\)\)/.test(ft) && /setWorkDate\(todayCalendarDay\(\)\)/.test(ft));
  const jc = read('app/job-costing.tsx');
  ok('the commitment form prefills AND resets the signed date with todayCalendarDay()',
    /useState<string>\(\(\) => todayCalendarDay\(\)\)/.test(jc) && /setSignedDate\(todayCalendarDay\(\)\)/.test(jc));
  ok("the labor drill-down prints the shift's day from its clock-in (timeEntryDay), not the stored date",
    /shortDate\(timeEntryDay\(e\)\)/.test(jc) && !/shortDate\(e\.date\)/.test(jc));
}

// ── The voice capabilities stamp the LOCAL day ────────────────────────────
// MAGE Copilot's apply() handlers are the one place a record is created with
// NO form in front of it: the GC speaks, the record is filed. Five of them
// stamped `new Date().toISOString().slice(0, 10)`, which is TOMORROW from about
// 5-8 pm anywhere west of Greenwich — so an RFI dictated after the crew knocked
// off was dated the next day and its "date required" was a day out with it. The
// screen scan above covers app/ and components/ only, so these five are pinned
// by name here (audit round 2, #2 appendix).

console.log('\nthe voice capabilities stamp the LOCAL calendar day:');
{
  const CAPABILITIES = [
    'utils/copilot/rfi/rfiCapability.ts',
    'utils/copilot/permit/permitCapability.ts',
    'utils/copilot/submittal/submittalCapability.ts',
    'utils/copilot/punch/punchCapability.ts',
    'utils/copilot/warranty/warrantyCapability.ts',
  ];
  // A bare-day stamp taken off an INSTANT. Matched on the TAIL — an
  // `.toISOString()` immediately sliced or split — rather than on the receiver:
  // the first version of this check keyed on `new Date(<no parens>)` and missed
  // `new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)`, which is
  // exactly the form the due dates used. The tail is the bug regardless of what
  // produced the instant.
  const utcDayStamp = /\.toISOString\(\)\s*\.(?:slice|split|substring)\(/;
  for (const rel of CAPABILITIES) {
    const src = read(rel);
    const offenders = src.split('\n')
      .map((line, i) => ({ text: line.trim(), no: i + 1 }))
      // Prose about the bug is not the bug — the fixes explain themselves.
      .filter(x => !x.text.startsWith('//') && !x.text.startsWith('*') && !x.text.startsWith('/*'))
      .filter(x => utcDayStamp.test(x.text));
    ok(`${rel} never stamps a calendar day from the UTC day`, offenders.length === 0,
      offenders.map(o => `${rel}:${o.no}: ${o.text}`).join('\n       '));
  }
  // …and each one actually reaches for the helper, so "no offenders" cannot be
  // satisfied by deleting the date instead of fixing it.
  for (const [rel, needle] of [
    ['utils/copilot/rfi/rfiCapability.ts', 'todayCalendarDay()'],
    ['utils/copilot/permit/permitCapability.ts', 'todayCalendarDay()'],
    ['utils/copilot/submittal/submittalCapability.ts', 'todayCalendarDay()'],
    ['utils/copilot/punch/punchCapability.ts', 'toCalendarDayString(addCalendarDays('],
    ['utils/copilot/warranty/warrantyCapability.ts', 'todayCalendarDay()'],
  ] as const) {
    ok(`${rel} takes its day from utils/calendarDate`, read(rel).includes(needle));
  }
}

// The voice DAILY REPORT is the exception to "stamp the local day": its date
// field is an instant for every other writer and every reader treats it as
// one. A bare day there printed the previous weekday on the header, the email
// subject and the owner's PDF across the Americas (integration round 2).
console.log('\nthe voice daily report stamps an instant, and DFR readers tolerate a bare day:');
{
  const cap = read('utils/copilot/dailyReport/dfrCapability.ts');
  ok('dfrCapability writes `date: now` (the ISO instant)', /^\s*date: now,/m.test(cap) && /const now = new Date\(\)\.toISOString\(\);/.test(cap));
  // Every reader that turned DailyFieldReport.date into a Date with `new Date`.
  const READERS: [string, RegExp][] = [
    ['utils/pdfGenerator.ts', /new Date\(dfr\.date\)/],
    ['utils/aiService.ts', /new Date\(dfr\.date\)/],
    ['app/report-inbox.tsx', /new Date\(dr\.date\)/],
    ['app/project-detail.tsx', /new Date\((?:dr|a|b)\.date\)/],
    ['contexts/ProjectContext.tsx', /new Date\((?:report|a|b)\.date\)/],
    ['app/daily-report.tsx', /new Date\((?:reportDate|ref)\)/],
    // The homeowner's "latest update" date on the portal, and the OAC
    // agenda's incident dates.
    ['utils/portalSnapshot.ts', /new Date\(top\.date\)/],
    ['utils/oacEngine.ts', /new Date\(i\.date\)/],
  ];
  for (const [rel, bad] of READERS) {
    const code = read(rel).split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    ok(`${rel} reads the report date through dayOrInstantDate`, !bad.test(code) && /dayOrInstantDate\(/.test(code),
      (code.match(bad) ?? []).join(', '));
  }
}

// …and EVERY capability, not a hand list. The list above missed two (the JHA
// and the voice daily report still wrote `now.slice(0, 10)` where
// `now = new Date().toISOString()`), because a named list only covers the
// files someone remembered. This walks utils/copilot/**/*Capability.ts and
// flags both forms: an `.toISOString()` sliced in place, and a variable
// holding an ISO instant that is later sliced to a day.
console.log('\nno voice capability anywhere stamps the UTC day:');
{
  const capFiles: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/Capability\.ts$/.test(name)) capFiles.push(full.slice(ROOT.length + 1));
    }
  };
  walk(join(ROOT, 'utils', 'copilot'));
  ok('found the voice capabilities', capFiles.length >= 12, `only ${capFiles.length}`);
  const inlineSlice = /\.toISOString\(\)\s*\.(?:slice|split|substring)\(/;
  for (const rel of capFiles) {
    const code = read(rel).split('\n')
      .map((line, i) => ({ text: line.trim(), no: i + 1 }))
      .filter(x => !x.text.startsWith('//') && !x.text.startsWith('*') && !x.text.startsWith('/*'));
    const isoVars = new Set<string>();
    for (const x of code) {
      const m = x.text.match(/\b(?:const|let|var)\s+(\w+)\s*=\s*new Date\([^;]*\)\.toISOString\(\)\s*;?$/);
      if (m) isoVars.add(m[1]);
    }
    const offenders = code.filter(x => inlineSlice.test(x.text)
      || [...isoVars].some(v => new RegExp(`\\b${v}\\.(?:slice\\(0,\\s*10\\)|split\\('T'\\)|substring\\(0,\\s*10\\))`).test(x.text)));
    ok(`${rel} never slices an ISO instant down to a calendar day`, offenders.length === 0,
      offenders.map(o => `${rel}:${o.no}: ${o.text}`).join('\n       '));
  }
}

// ── The DFR carry-forward label is the one this file executes ─────────────
// The runtime section proves carrySourceDayLabel is right. These three lines
// prove the screen actually renders it — a correct helper nobody calls is not
// a fix.

console.log('\nthe daily report renders the guarded carry-forward label:');
{
  const dfr = read(DFR_SCREEN);
  ok('the "Copy from …" button label comes from carrySourceDayLabel',
    /return carrySourceDayLabel\(lastReport\.date,/.test(dfr));
  // A correct helper handed a `now` captured at mount is stale the moment the
  // screen survives midnight — the button would keep saying "earlier today"
  // for yesterday's report. The day is re-read on focus and is a memo dep, so
  // the label cannot outlive the day it was computed for.
  ok('the label re-reads the current day on focus rather than capturing it at mount',
    /useFocusEffect\(useCallback\(\(\) => \{ setCarryLabelDay\(todayCalendarDay\(\)\); \}, \[\]\)\)/.test(dfr) &&
    /\}, \[lastReport, carryLabelDay\]\)/.test(dfr),
    'carryLabelDay must be set from a useFocusEffect and be a dependency of the lastReportLabel memo');
  ok('the post-copy toast comes from carrySourceDayAbsolute',
    /carrySourceDayAbsolute\(lastReport\.date\)/.test(dfr));
  const code = dfr.split('\n')
    .map(l => l.trim())
    .filter(l => !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));
  ok('no elapsed-millisecond "day" arithmetic is left in the screen',
    !code.some(l => /86_?400_?000/.test(l)),
    code.filter(l => /86_?400_?000/.test(l)).join('\n       '));
}

// ═══════════════════════════════════════════════════════════════════════════
// Unrelated guards that have always lived in this file — kept so the rewrite
// does not silently drop coverage.
// ═══════════════════════════════════════════════════════════════════════════

// ── The filter rail can share its row with the More-filters button ────────
// Yoga's DefaultFlexShrink is 0.0f on native (Style.h), so a horizontal
// ScrollView sized from its own content cannot give width back to a sibling —
// the audited "filter chips clipped by the filter button". `flex: 1` fixes it
// through flexBasis, not shrink: processFlexBasis (Node.cpp) resolves a
// positive flex with auto basis to points(0) on native, so the rail starts at
// zero and grows into the leftover space. Layout is invisible to a render
// test, so the style is pinned textually instead.

console.log('\nthe punch-list filter rail is flexible:');
{
  const punch = read('app/punch-list.tsx');
  ok('filterScroll declares flex: 1', /filterScroll: \{[^}]*flex: 1/.test(punch),
    (punch.match(/filterScroll: \{[^}]*\}/) ?? []).join(''));
  ok('the horizontal ScrollView in the filter bar applies it',
    /style=\{styles\.filterScroll\}/.test(punch));
}

// ── The header eyebrow carries the real brand ─────────────────────────────
// Pre-launch de-brand left 43 eyebrows reading "· MAGE" instead of the
// product name, "MAGE ID". Every app/ and components/ eyebrow is covered —
// no path is excluded. Prose uses of MAGE (the assistant's name in "Ask
// MAGE") are deliberately NOT covered here — only the brand line.

console.log('\nheader eyebrows say MAGE ID:');
{
  const stale: string[] = [];
  for (const full of [...listSources(join(ROOT, 'app')), ...listSources(join(ROOT, 'components'))]) {
    if (!full.endsWith('.tsx')) continue;
    const src = readFileSync(full, 'utf8');
    for (const line of src.split('\n')) {
      // Only the eyebrow/brand-line form: "… · MAGE" immediately closing a
      // JSX text node or a string prop. Prose like "· MAGE never stores…"
      // does not match and is left to a product decision.
      if (/· MAGE(?=["<])/.test(line)) stale.push(`${full.slice(ROOT.length + 1)}: ${line.trim()}`);
    }
  }
  ok('no header eyebrow still reads "· MAGE"', stale.length === 0, stale.join('\n       '));
}

console.log('\nthe shared date picker opens on the stored day:');
{
  // DatePickerModal is handed both a bare 'YYYY-MM-DD' and its own noon-UTC
  // instant. It seeded its wheels with `new Date(value)`, which reads the bare
  // shape as UTC midnight: west of Greenwich it opened on the previous day, and
  // confirming untouched saved that wrong day back.
  const src = read('components/DatePickerModal.tsx');
  const seed = /const initial = useMemo\(\(\) => ([^;]*), \[value\]\);/.exec(src);
  ok('DatePickerModal seeds from calendarDayStart(value)', !!seed && /calendarDayStart\(value\)/.test(seed[1]), seed ? seed[1] : 'initial useMemo not found');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  ok('…and never from new Date(value)', !/new Date\(value\)/.test(code));
  eq("…a bare '2026-09-15' opens on the 15th", calendarDayStart('2026-09-15')?.getDate(), 15);
}

// ════════════════════════════════════════════════════════════════════════�
// THE DAY RULE, static half: no app code may derive a day key from the UTC
// text of an instant.
//
// The earlier sweeps in this file name the files they read, and each time the
// bug came back in a file they did not name. This one walks every source
// directory. `<anything>.toISOString()` immediately sliced / split /
// substringed is how a Date becomes a 'YYYY-MM-DD' in UTC; every such line is
// either gone (todayCalendarDay / toCalendarDayString / calendarDayOf) or in
// UTC_DAY_ALLOWED below with the reason UTC is right THERE. A stale entry
// fails, so the list cannot rot into a blanket pass. The same for the
// component form (getUTCFullYear/Month/Date/Day, Date.UTC), listed per file.
// ════════════════════════════════════════════════════════════════════════�

console.log('\nno day key is derived from the UTC text of an instant (DAY RULE):');
{
  const DIRS = ['app', 'components', 'contexts', 'hooks', 'utils', 'lib', 'constants'];
  const UTC_DAY_ALLOWED: { file: string; line: string; reason: string }[] = [
    // The AI caps: the server counts a UTC day and resets at UTC midnight
    // (supabase/functions/_shared/auth.ts), so the client's counter must
    // roll over at the same instant or the meter and the refusal disagree.
    { file: 'utils/aiRateLimiter.ts', line: "const today = new Date().toISOString().split('T')[0];", reason: 'AI daily cap — must match the server\'s UTC day (two sites, same text)' },
    { file: 'utils/aiService.ts', line: "const today = new Date().toISOString().split('T')[0];", reason: 'AI daily usage counter — the server\'s UTC day' },
    { file: 'utils/aiService.ts', line: "return { date: new Date().toISOString().split('T')[0], copilotCount: 0, builderCount: 0 };", reason: 'AI daily usage counter — the server\'s UTC day' },
    { file: 'utils/aiService.ts', line: "usage.date = new Date().toISOString().split('T')[0];", reason: 'AI daily usage counter — the server\'s UTC day' },
    // Day-GRID arithmetic on a bare calendar day: the Date is built at UTC
    // midnight/noon from 'YYYY-MM-DD' and read back in UTC, so no zone enters.
    { file: 'utils/portalOwnerCore.ts', line: 'return new Date(dayMs(calendarDate) + offsetDays * DAY_MS).toISOString().slice(0, 10);', reason: 'UTC day grid: dayMs() parses the bare day at UTC, so the UTC read-back is the same calendar' },
    { file: 'utils/copilot/dateMath.ts', line: 'return out.toISOString().slice(0, 10);', reason: 'UTC day grid: built with Date.UTC from a bare day\'s components' },
    { file: 'utils/icsGenerator.ts', line: 'return d.toISOString().slice(0, 10);', reason: 'UTC day grid: `${base}T12:00:00Z` + setUTCDate' },
    { file: 'app/aia-pay-app.tsx', line: '? new Date(new Date(priorAIA.periodTo).getTime() + 86400000).toISOString().slice(0, 10)', reason: 'UTC day grid: periodTo is a bare \'YYYY-MM-DD\' (parsed at UTC midnight) plus one day' },
    // The JOBSITE's day, not the device's and not UTC: the instant is shifted
    // by OpenWeather's city.timezone first, then read on the UTC grid.
    { file: 'utils/weatherService.ts', line: "const iso = siteTime(e).toISOString().split('T')[0];", reason: 'jobsite-local day: siteTime() has already added the site\'s UTC offset' },
    // Not a jobsite day at all.
    { file: 'components/schedule/mobile/WeekStrip.tsx', line: 'keyExtractor={(d) => d.toISOString().slice(0, 10)}', reason: 'a React list key — unique per day in any zone, never shown or stored' },
    { file: 'utils/dataExport.ts', line: "const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');", reason: 'a to-the-second UTC timestamp in a backup file name — an instant, not a day key' },
    // KNOWN, NOT YET FIXED (reported 2026-10-05; none of these reads "now"):
    { file: 'utils/icsGenerator.ts', line: 'return new Date(t).toISOString().slice(0, 10);', reason: 'UNRESOLVED: a schedule date stored as a full instant is exported on its UTC day; bare days (the normal shape) return before this line' },
    { file: 'utils/dataTable.ts', line: 'if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : UNKNOWN_CELL;', reason: 'UNRESOLVED: the generic table prints a raw Date cell on its UTC day; no column passes "now"' },
    { file: 'utils/portalSnapshot.ts', line: '.toISOString().slice(0, 10);', reason: 'UNRESOLVED: milestone dates walk a UTC-midnight anchor through addWorkingDays (which reads the LOCAL weekday) — a separate, older defect in the walk, not in "today"' },
    { file: 'utils/portfolio/pipelineHorizon.ts', line: 'return d.toISOString().slice(0, 10);', reason: 'UNRESOLVED: same UTC-anchor / local-weekday walk as the portal milestones (backlog horizon date only; the load windows are local since 2026-10-05)' },
  ];
  const UTC_PARTS_ALLOWED: Record<string, string> = {
    'utils/aiRateLimiterCore.ts': 'when the server\'s UTC-day and UTC-month AI caps reset',
    'utils/weekClose/composeWeekClose.ts': 'the next run of the weekly digest cron, which is scheduled in UTC',
    'utils/weatherService.ts': 'the jobsite\'s midday, on an instant already shifted by the site offset',
    'utils/lastPlanner.ts': 'the UTC day grid for stored week keys (toMonday is grid-only; "now" comes from localWeekStart)',
    'utils/crossProjectLoad.ts': 'UTC day grid over bare schedule days; no "now"',
    'utils/cpm.ts': 'UTC day grid over bare schedule days; no "now"',
    'utils/copilot/dateMath.ts': 'UTC day grid over a bare day',
    'utils/icsGenerator.ts': 'UTC day grid over a bare day',
    'utils/prequalEngine.ts': 'parsePrequalDate round-trips a typed day\'s components on the UTC grid',
    'utils/permitPath/deptAnswers.ts': 'round-trips a bare day\'s components on the UTC grid',
    'utils/tutorial/learn/fixturesD.ts': 'round-trips a bare day\'s components on the UTC grid',
    'utils/passport/consumerPassport.ts': 'UTC day grid from a bare day\'s components',
    'utils/safety/oshaLog.ts': 'UTC day grid from a bare day\'s components',
    'utils/accountingExport.ts': 'formats a bare day parsed at noon UTC',
    'utils/projectWorkspaceLayout.ts': 'UTC day grid; "today" enters as Date.UTC(LOCAL year, month, date)',
    'utils/calendarDate.ts': 'UTC day grid of LOCAL components (daysUntilCalendarDay)',
    'utils/punchExportCore.ts': 'UTC day grid of LOCAL components',
    'utils/constructionNews.ts': 'UTC day grid of LOCAL components',
    'utils/bidInviteCore.ts': 'UTC day grid of LOCAL components',
    'utils/portfolio/portfolioRow.ts': 'UTC day grid of LOCAL components',
    'components/DatePickerModal.tsx': 'the picker stores the chosen day at noon UTC so it names the same day in every zone',
    'utils/subNetwork.ts': 'the YEAR of a stored instant (a "since 2024" label)',
  };

  const sliced = /\.toISOString\(\)\s*\.(?:slice|split|substring|substr)\(/;
  const parts = /\.getUTC(?:FullYear|Month|Date|Day|Hours)\(|\bDate\.UTC\(/;
  const hits: { file: string; lineNo: number; text: string }[] = [];
  const partFiles = new Set<string>();
  const brokenAcrossLines: string[] = [];
  const aliased: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(ROOT, rel)).isDirectory()) { if (name !== 'node_modules' && name !== '__tests__') walk(rel); continue; }
      if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
      const src = read(rel);
      const lines = src.split('\n');
      // `const now = new Date().toISOString()` … `now.slice(0, 10)` is the same
      // bug one line apart.
      const nowIso = new Set([...src.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*new Date\((?:Date\.now\(\))?\)\.toISOString\(\)/g)].map(m => m[1]));
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (sliced.test(line)) hits.push({ file: rel, lineNo: i + 1, text: line.trim() });
        if (parts.test(line)) partFiles.add(rel);
        if (/\.toISOString\(\)\s*$/.test(line) && /^\s*\.(?:slice|split|substring|substr)\(/.test(lines[i + 1] ?? '')) brokenAcrossLines.push(`${rel}:${i + 1}`);
        for (const n of nowIso) {
          if (new RegExp(`\\b${n}\\.(?:slice\\(0, ?10\\)|split\\(['"]T['"]\\)|substring\\(0, ?10\\))`).test(line)) aliased.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }
  };
  for (const d of DIRS) walk(d);

  const isAllowed = (h: { file: string; text: string }) => UTC_DAY_ALLOWED.some(a => a.file === h.file && a.line === h.text);
  const unallowed = hits.filter(h => !isAllowed(h));
  ok(`no un-listed \`.toISOString()\` day slice (found ${hits.length}, ${hits.length - unallowed.length} listed with a reason)`,
    unallowed.length === 0,
    unallowed.map(h => `${h.file}:${h.lineNo}: ${h.text}\n         → todayCalendarDay() / toCalendarDayString(d) / calendarDayOf(value); or, if UTC is right here, add it to UTC_DAY_ALLOWED with why`).join('\n       '));
  const stale = UTC_DAY_ALLOWED.filter(a => !hits.some(h => h.file === a.file && h.text === a.line));
  ok('every UTC_DAY_ALLOWED entry still matches a real line', stale.length === 0, stale.map(a => `${a.file}: ${a.line}`).join('\n       '));
  ok('every UTC_DAY_ALLOWED entry says why', UTC_DAY_ALLOWED.every(a => a.reason.trim().length >= 20));
  ok('no day slice hides behind a line break', brokenAcrossLines.length === 0, brokenAcrossLines.join('\n       '));
  // The alias match is by NAME within a file, so one same-named parameter is a
  // false hit: SignatureBlock's `signedAt` prop is sliced only after a regex
  // has proved it is the noon-UTC stamp of a paper signature's calendar day.
  const ALIAS_ALLOWED = ['app/contract.tsx: ? formatCalendarDay(signedAt.slice(0, 10))'];
  const aliasKey = (a: string) => a.replace(/:\d+:/, ':');
  const badAliases = aliased.filter(a => !ALIAS_ALLOWED.includes(aliasKey(a)));
  ok('no day slice hides behind a `const now = new Date().toISOString()` alias', badAliases.length === 0, badAliases.join('\n       '));
  ok('…and the one allowed same-named prop is still there', ALIAS_ALLOWED.every(k => aliased.some(a => aliasKey(a) === k)));
  const newPartFiles = [...partFiles].filter(f => !(f in UTC_PARTS_ALLOWED));
  ok(`no un-listed file reads UTC date parts (${partFiles.size} file(s), all listed with a reason)`, newPartFiles.length === 0,
    newPartFiles.map(f => `${f} → local components (getFullYear/getMonth/getDate) via utils/calendarDate, or add the file to UTC_PARTS_ALLOWED with why`).join('\n       '));
  const stalePartFiles = Object.keys(UTC_PARTS_ALLOWED).filter(f => !partFiles.has(f));
  ok('every UTC_PARTS_ALLOWED file still reads UTC date parts', stalePartFiles.length === 0, stalePartFiles.join(', '));
  ok('the AI caps are the only allowed "UTC day of now"', UTC_DAY_ALLOWED.filter(a => /new Date\(\)\.toISOString\(\)\.(?:split|slice\(0, 10\))/.test(a.line)).every(a => /^utils\/ai(RateLimiter|Service)\.ts$/.test(a.file)));

  // The call sites that SAVE a date, pinned to the one helper.
  const pins: [string, string, RegExp][] = [
    ['schedule import anchors an undated import on todayCalendarDay()', 'app/schedule-import.tsx', /project\.schedule\?\.startDate \?\? todayCalendarDay\(\)/],
    ['the Schedule tab\'s new project anchors on todayCalendarDay()', 'app/(tabs)/schedule/index.tsx', /startDate: schedule\.startDate \?\? todayCalendarDay\(\)/],
    ['schedule-pro saves an undated schedule\'s start as its local day (shell)', 'app/schedule-pro.tsx', /startDate: project\?\.schedule\?\.startDate \?\? toCalendarDayString\(projectStartDate\),/],
    ['…and on the desktop editor', 'app/schedule-pro.tsx', /\?\? toCalendarDayString\(projectStartDate\),\n\s+totalDurationDays,/],
    ['…and double-tap-to-add prefills the tapped local day', 'app/schedule-pro.tsx', /const iso = toCalendarDayString\(target\);/],
    ['auto-drafted change orders are dated todayCalendarDay()', 'hooks/useLeakCoDrafts.ts', /const nowISO = todayCalendarDay\(\);/],
    ['the leak sweep\'s 14-day cutoff is 14 local calendar days', 'utils/brain/leakCoDraft.ts', /const cutoffISO = toCalendarDayString\(addCalendarDays\(now, -14\)\);/],
    ['the buyout risk-override note is dated todayCalendarDay()', 'app/buyout-package.tsx', /\[risk-override \$\{todayCalendarDay\(\)\}\]/],
    ['the lien-waiver through-date falls back to todayCalendarDay()', 'app/invoice.tsx', /existingInvoice\.issueDate \?\? todayCalendarDay\(\),/],
    ['a change order\'s approval target counts calendar days from the local sent day', 'utils/followUp/rules.ts', /toCalendarDayString\(addCalendarDays\(new Date\(sentMs\), deadline\)\)/],
    ['a receipt date is read back from local components', 'utils/materialReceipt.ts', /return toCalendarDayString\(new Date\(t\)\);/],
    ['a shared plan link\'s start day falls back to todayCalendarDay()', 'utils/planShareToken.ts', /sd: scheduleStartDate \?\? todayCalendarDay\(\),/],
    ['the vertical Gantt\'s "today" row is todayCalendarDay(now)', 'components/schedule/VerticalGantt.tsx', /const todayStr = todayCalendarDay\(now\);/],
    ['the in-app client view ranks decisions against todayCalendarDay()', 'app/client-view.tsx', /today: todayCalendarDay\(\),/],
    ['the bid advisor\'s capacity window starts on todayCalendarDay', 'app/judges.tsx', /startISO: todayCalendarDay\(start\), endISO: toCalendarDayString\(addCalendarDays\(start, weeks \* 7\)\)/],
    ['the Home briefing cache is keyed on todayCalendarDay()', 'components/AIHomeBriefing.tsx', /const today = todayCalendarDay\(\);/],
  ];
  for (const [label, file, re] of pins) ok(label, re.test(read(file)));

  // One overdue rule: every reader that calls an invoice overdue asks daysPastDue.
  const OVERDUE_READERS = [
    'utils/summaryBriefing.ts', 'utils/brief/composeBrief.ts', 'app/report-inbox.tsx', 'utils/financialReports.ts',
    'utils/projectFinancials.ts', 'utils/weekClose/composeWeekClose.ts', 'utils/brainWatch.ts', 'hooks/useSmartInbox.ts',
  ];
  for (const file of OVERDUE_READERS) {
    const code = read(file).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    ok(`${file} asks daysPastDue for "overdue"`, /daysPastDue(?:Day)?\(/.test(code));
    ok(`…and no longer compares the due INSTANT to the clock`,
      !/new Date\((?:\w+\.)?dueDate\)\.getTime\(\)\s*<|dueTs < Date\.now\(\)|- new Date\((?:\w+\.)?dueDate\)\.getTime\(\)/.test(code));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
