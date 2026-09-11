// validate-schedule-date-basis.ts — pins the two ways a schedule date can be
// wrong, on every surface that prints one.
//
// WHY THIS EXISTS. The 2026-08-31 medium sweep found FIVE schedule surfaces
// printing a date the user could see was wrong, from two distinct root causes
// that keep getting confused for each other:
//
//   (1) TIMEZONE. `schedule.startDate` is a bare 'YYYY-MM-DD' (types/index.ts).
//       `new Date('2026-03-02')` is spec'd to parse as UTC MIDNIGHT, so at any
//       negative UTC offset — the entire US market — it renders as Mar 1.
//       MobileGantt (#6) drew every bar one column left of the today line;
//       TaskDetailSheet (#11) printed "Sun, Mar 1" for a Monday task, with a
//       ± stepper next to it that edits startDay against that wrong label;
//       SchedulerHeader (#19) put the day BEFORE the schedule's start in the
//       headline START KPI, above a grid that showed the right one.
//       utils/calendarDate.ts (parseCalendarDay/formatCalendarDay) exists for
//       exactly this; these call sites had never adopted it.
//
//   (2) WORKING DAY vs CALENDAR DAY. `startDay`, `finishDay` and
//       `totalDurationDays` are WORKING-day numbers on the schedule's own
//       calendar (day 1 = the anchor, day 2 = the next working day). Two call
//       sites treated them as calendar quantities:
//         • exportTasksToCsv (#18) advanced raw calendar days, so the CSV a GC
//           hands a sub drifted a day per weekend crossed — and the error grew
//           down the file while the correct 'Start day'/'Finish day' integer
//           columns sat right next to it.
//         • ScheduleShareSheet (#21) advanced the FULL totalDurationDays, but
//           that value is already a finish DAY NUMBER
//           (max(startDay + duration - 1)), so the client-facing PDF stated a
//           completion date one working day past its own last table row.
//
// The invariant this guard enforces is a single sentence: EVERY surface must
// resolve a day number the way scheduleEngine.getTaskDateRange does — walk
// `n - 1` WORKING days from the anchor — and must resolve the anchor itself
// through parseCalendarDay, never `new Date(bareDay)`.
//
// Run via: bun run test:schedule-date-basis

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  exportTasksToCsv, isMilestoneOnScheduleDay, isTaskActiveOnScheduleDay,
  isUndatedSchedule, resolveScheduleAnchor, scheduleDayNumberFor, scheduleDayOnCalendar,
  startDayNumberFor, taskCalendarRange, taskWorkingDayLabel,
  UNDATED_SCHEDULE_PREVIEW_NOTE,
} from '../utils/scheduleOps';
import { addWorkingDays, getTaskDateRange, buildScheduleFromTasks } from '../utils/scheduleEngine';
import { parseCalendarDay, toCalendarDayString } from '../utils/calendarDate';
import { computeTodayTasks, computeWeekLoad } from '../utils/summaryBriefing';
import type { Project, ScheduleTask } from '../types';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// Comments in this codebase QUOTE the buggy expression they replaced (house
// style: say what the old behaviour did wrong). A negative regex run over raw
// source therefore matches the fix's own explanation and reports a false
// regression — so the "no longer does X" checks read from stripped code.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`); }
}
function eq(label: string, got: unknown, want: unknown) {
  ok(label, got === want, `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

const T = (id: string, startDay: number, durationDays: number, extra: Partial<ScheduleTask> = {}): ScheduleTask => ({
  id, title: id.toUpperCase(), phase: 'General', startDay, durationDays,
  progress: 0, crew: '', crewSize: 1, dependencies: [], notes: '',
  status: 'not_started', ...extra,
} as ScheduleTask);

const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 2026-03-02 is a MONDAY. Built from local components on purpose — this is the
// anchor every surface derives from, and it must be local midnight.
const MON_MAR_2 = new Date(2026, 2, 2);

// ── 1. The CSV export uses working days, and prints them in LOCAL time ──────
// The exact case from the audit. Old code: Start 2026-03-12, Finish 2026-03-21.

console.log('\nCSV export dates are working-day dates, not calendar-day dates:');
{
  ok('the fixture anchor really is a Monday', MON_MAR_2.getDay() === 1, String(MON_MAR_2));

  const tasks = [T('a', 11, 10)];
  const csv = exportTasksToCsv(tasks, MON_MAR_2, 5);
  const cells = csv.split('\n')[1].split(',');
  const headers = csv.split('\n')[0].split(',');
  const cell = (name: string) => cells[headers.indexOf(name)];

  eq("start day 11 on a Mon anchor / 5-day week exports Mar 16", cell('Start date'), '2026-03-16');
  eq("finish day 20 exports Mar 27", cell('Finish date'), '2026-03-27');

  // The pre-fix values. Pinned as NEGATIVES so a regression to raw calendar
  // walking is named in the failure output rather than just "wrong date".
  ok('the calendar-day answer (Mar 12) is NOT what we export', cell('Start date') !== '2026-03-12');
  ok('the calendar-day answer (Mar 21) is NOT what we export', cell('Finish date') !== '2026-03-21');

  // The integer columns beside the dates were always right; they must agree.
  eq('the Start day integer column still reads 11', cell('Start day'), '11');
  eq('the Finish day integer column still reads 20', cell('Finish day'), '20');
}

// ── 2. The CSV agrees with what the grid draws, for every task ──────────────
// Timezone-independent cross-check: the export and getTaskDateRange (the
// display path, used by GridPane and the PDF task rows) must never diverge.

console.log('\nthe CSV and the on-screen grid resolve the same dates:');
{
  const tasks = [T('a', 1, 5), T('b', 6, 3), T('c', 11, 10), T('m', 21, 0, { isMilestone: true })];
  for (const wdpw of [5, 6, 7]) {
    const csv = exportTasksToCsv(tasks, MON_MAR_2, wdpw);
    const lines = csv.split('\n');
    const headers = lines[0].split(',');
    let agree = true;
    const detail: string[] = [];
    tasks.forEach((t, i) => {
      const cells = lines[i + 1].split(',');
      const dr = getTaskDateRange(t, MON_MAR_2, wdpw);
      const gotStart = cells[headers.indexOf('Start date')];
      const wantStart = isoLocal(dr.start);
      if (gotStart !== wantStart) { agree = false; detail.push(`${t.id} start: csv ${gotStart} vs grid ${wantStart}`); }
    });
    ok(`${wdpw}-day week: every CSV start date equals getTaskDateRange`, agree, detail.join('; '));
  }
}

// ── 3. Non-working dates (holidays / closures) are honoured ─────────────────
{
  console.log('\nsite closures move the exported dates:');
  const csv = exportTasksToCsv([T('a', 3, 1)], MON_MAR_2, 5, ['2026-03-04']);
  const cells = csv.split('\n')[1].split(',');
  const headers = csv.split('\n')[0].split(',');
  // Working days: 1=Mon Mar 2, 2=Tue Mar 3, (Wed Mar 4 closed), 3=Thu Mar 5.
  eq('a closed Wednesday pushes working day 3 to Thu Mar 5',
    cells[headers.indexOf('Start date')], '2026-03-05');
}

// ── 4. The shared PDF's end date is the LAST TASK's end date ───────────────
// #21: totalDurationDays is a finish DAY NUMBER, so the header must walk
// `totalDurationDays - 1` working days — the same -1 the task rows use.

console.log('\nthe client-facing end date matches the last row of its own table:');
{
  const tasks = [T('a', 1, 5)];
  const schedule = buildScheduleFromTasks('S', null, tasks);
  eq('a single startDay:1/duration:5 task finishes on day 5', schedule.totalDurationDays, 5);

  const headerEnd = addWorkingDays(MON_MAR_2, Math.max(0, schedule.totalDurationDays - 1), 5);
  const lastRowEnd = getTaskDateRange(tasks[0], MON_MAR_2, 5).end;
  eq('header end date == last task end date', isoLocal(headerEnd), isoLocal(lastRowEnd));
  eq('and that date is Fri Mar 6, not Mon Mar 9', isoLocal(headerEnd), '2026-03-06');

  // The pre-fix expression, named so a regression is legible.
  const preFix = addWorkingDays(MON_MAR_2, schedule.totalDurationDays, 5);
  ok('the un-decremented walk really did overshoot by one working day',
    isoLocal(preFix) === '2026-03-09');
}

// ── 5. The anchor is parsed as a CALENDAR DAY, never as an instant ─────────

console.log('\nthe schedule anchor never shifts with the reader\'s timezone:');
{
  const d = parseCalendarDay('2026-03-02');
  ok('parseCalendarDay lands on Mon Mar 2 local, whatever TZ this runs in',
    d !== null && d.getFullYear() === 2026 && d.getMonth() === 2 && d.getDate() === 2 && d.getDay() === 1,
    `TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone} got ${d?.toString()}`);
  ok('a Supabase-synced full ISO timestamp resolves to the same day',
    isoLocal(parseCalendarDay('2026-03-02T00:00:00.000Z')!) === isoLocal(parseCalendarDay('2026-03-02')!));
}

// ── 6. The call sites actually adopted it ─────────────────────────────────
// Every defect here was a call site that had a correct helper available and
// did its own thing. Layout/render is invisible to a unit test, so the
// adoption is pinned textually.

console.log('\nthe schedule surfaces route their anchor through calendarDate:');
{
  // SCOPE, not a list. The three checks below name their files, and that is
  // exactly how components/schedule/mobile/MobileScheduleList.tsx — the PRIMARY
  // iOS schedule surface — kept a `new Date(startDate)` through the whole
  // 2026-09-02 date-basis fix: nobody added it here, so nothing looked at it.
  // (Same failure as validate-alert-shim, whose ROOTS omitted utils/ and let a
  // raw Alert.alert sit in two files while the guard printed green.)
  //
  // So: ENUMERATE every schedule component that consumes a schedule startDate
  // and require the whole set to be clean. A new surface is covered the day it
  // is written, without anyone remembering to come back here.
  const dir = join(ROOT, 'components', 'schedule');
  const walk = (d: string, out: string[] = []): string[] => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const surfaces = walk(dir).filter(f => {
    const src = stripComments(readFileSync(f, 'utf8'));
    // Only files that actually anchor on a schedule start date can have this bug.
    return /startDate/.test(src) && /new Date\(|parseCalendarDay/.test(src);
  });

  ok('schedule surfaces consuming startDate were found', surfaces.length >= 3,
    `only ${surfaces.length} — the component layout changed; re-read this guard`);

  // `new Date(startDate)` is only a BUG when startDate is a 'YYYY-MM-DD'
  // STRING. Where it is already a Date, that expression is an ordinary
  // defensive clone and flagging it would be a false accusation — which trains
  // the reader to ignore this guard, the very thing that let the original three
  // surfaces stay broken. Two such clones exist today and are correct:
  //   WeatherReschedulePrompt.tsx:53 — `const startDate = new Date(startISO)`
  //   TaskInspector.tsx:46          — `dayToDate(startDate: Date, ...)`
  const bare = surfaces.filter(f => {
    const src = stripComments(readFileSync(f, 'utf8'));
    if (!/new Date\(\s*startDate\s*\)/.test(src)) return false;
    // Locally constructed as a Date, or declared as one -> clone, not a parse.
    if (/(?:const|let)\s+startDate\s*=\s*new Date\(/.test(src)) return false;
    if (/startDate\s*\??\s*:\s*Date\b/.test(src)) return false;
    return true;
  });

  ok(
    `no schedule surface bare-parses its anchor (${surfaces.length} scanned)`,
    bare.length === 0,
    bare.length === 0 ? undefined :
      `new Date('YYYY-MM-DD') is UTC MIDNIGHT and floors to the PREVIOUS local\n` +
      `      day at any negative offset, so every date on these surfaces renders a\n` +
      `      day early:\n` +
      bare.map(f => `        • ${f.replace(`${ROOT}/`, '')}`).join('\n') +
      `\n\n      Use parseCalendarDay(startDate) ?? new Date() from @/utils/calendarDate.`,
  );
}

{
  const gantt = stripComments(read('components/schedule/mobile/MobileGantt.tsx'));
  ok('MobileGantt imports parseCalendarDay',
    /import \{ parseCalendarDay(?:, [^}]+)? \} from '@\/utils\/calendarDate'/.test(gantt));
  ok('MobileGantt baseMs uses parseCalendarDay',
    /startOfDayMs\(parseCalendarDay\(startDate\) \?\? new Date\(\)\)/.test(gantt));
  ok('MobileGantt no longer bare-parses the anchor',
    !/new Date\(startDate\)/.test(gantt),
    (gantt.match(/.*new Date\(startDate\).*/g) ?? []).join('\n       '));
  ok('MobileGantt emits the long-press ISO from local components, not toISOString',
    /toIsoDay\(dayAt\(day\)\)/.test(gantt) && !/toISOString\(\)/.test(gantt));

  const sheet = stripComments(read('components/schedule/mobile/TaskDetailSheet.tsx'));
  ok('TaskDetailSheet imports parseCalendarDay',
    /import \{ parseCalendarDay \} from '@\/utils\/calendarDate'/.test(sheet));
  // Was `parseCalendarDay(startDate) ?? new Date()`. That `?? new Date()` IS
  // the invented anchor (SCHED-NO-ANCHOR) — the sheet now keeps null and
  // prints day numbers, so the requirement is parseCalendarDay WITHOUT a
  // today fallback. Section 9 pins what it prints instead.
  ok('TaskDetailSheet baseMs uses parseCalendarDay and does NOT fall back to today',
    /const d = parseCalendarDay\(startDate\);\s*\n\s*if \(!d\) return null;/.test(sheet),
    (sheet.match(/.*parseCalendarDay\(startDate\).*/g) ?? []).join('\n       '));
  ok('TaskDetailSheet no longer bare-parses the anchor',
    !/new Date\(startDate\)/.test(sheet),
    (sheet.match(/.*new Date\(startDate\).*/g) ?? []).join('\n       '));

  const header = stripComments(read('components/schedule/SchedulerHeader.tsx'));
  ok('SchedulerHeader imports parseCalendarDay + formatCalendarDay',
    /import \{ parseCalendarDay, formatCalendarDay \} from '@\/utils\/calendarDate'/.test(header));
  ok('SchedulerHeader START formats a calendar day',
    /formatCalendarDay\(schedule\.startDate\)/.test(header));
  ok('SchedulerHeader FINISH walks working days from the parsed anchor',
    /addWorkingDays\(\s*startAnchor,\s*Math\.max\(0, totalDuration - 1\)/.test(header));
  ok('SchedulerHeader no longer adds raw calendar milliseconds',
    !/86400000/.test(header),
    (header.match(/.*86400000.*/g) ?? []).join('\n       '));
  ok('SchedulerHeader no longer bare-parses schedule.startDate',
    !/new Date\(schedule\.startDate\)/.test(header));

  const share = stripComments(read('components/schedule/ScheduleShareSheet.tsx'));
  ok('ScheduleShareSheet decrements the finish day number before walking',
    /addWorkingDays\(\s*projectStartDate,\s*Math\.max\(0, schedule\.totalDurationDays - 1\)/.test(share));
  ok('ScheduleShareSheet no longer advances the full totalDurationDays',
    !/addWorkingDays\(projectStartDate, schedule\.totalDurationDays,/.test(share));

  const ops = stripComments(read('utils/scheduleOps.ts'));
  ok('exportTasksToCsv walks working days',
    /const fmtDate = \(dayNum: number\) => \{[\s\S]{0,200}addWorkingDays\(/.test(ops));
  ok('exportTasksToCsv no longer setDate()s raw calendar days',
    !/d\.setDate\(d\.getDate\(\) \+ dayNum - 1\)/.test(ops));
  ok('exportTasksToCsv formats from local Y/M/D, not toISOString',
    !/toISOString\(\)/.test(ops.slice(ops.indexOf('export function exportTasksToCsv'), ops.indexOf('function csvEscape'))));
}

// ── 7. The MOBILE surfaces use the working-day basis too (B4 review A9) ──
// startDay is a working-day number everywhere else, but the phone list, gantt,
// month sheet, detail sheet and progress tab laid tasks out at
// `baseMs + (startDay - 1) * MS_DAY` — calendar days — and AddTask wrote the
// calendar-day inverse. A startDay-6 task on a Monday anchor was drawn on the
// Saturday; a task picked for the second Monday got startDay 8. The pure math
// they now share is fixed here; the adoption is pinned textually below.

console.log('\nthe mobile schedule resolves startDay as WORKING days:');
{
  const MS_DAY = 86_400_000;
  const MON_SEP_7 = new Date(2026, 8, 7);
  ok('the fixture anchor (2026-09-07) really is a Monday', MON_SEP_7.getDay() === 1, String(MON_SEP_7));

  eq('startDay 6 on a Mon 2026-09-07 anchor renders on Mon 2026-09-14',
    isoLocal(taskCalendarRange(T('a', 6, 1), MON_SEP_7, 5).start), '2026-09-14');
  eq('… and the calendar-day layout it replaced drew it on Sat 2026-09-12',
    isoLocal(new Date(MON_SEP_7.getFullYear(), MON_SEP_7.getMonth(), MON_SEP_7.getDate() + 5)), '2026-09-12');
  eq('a 3-day task starting Thu (day 4) ends the next Mon, spanning the weekend',
    isoLocal(taskCalendarRange(T('b', 4, 3), MON_SEP_7, 5).end), '2026-09-14');
  eq('a milestone ends on its start day',
    isoLocal(taskCalendarRange(T('m', 6, 0, { isMilestone: true }), MON_SEP_7, 5).end), '2026-09-14');
  eq('a site closure on Mon 14 pushes day 6 to Tue 15',
    isoLocal(taskCalendarRange(T('c', 6, 1), MON_SEP_7, 5, ['2026-09-14']).start), '2026-09-15');
  eq('on a 7-day week day 6 is Sat 12',
    isoLocal(taskCalendarRange(T('d', 6, 1), MON_SEP_7, 7).start), '2026-09-12');
  ok('taskCalendarRange agrees with getTaskDateRange wherever the latter applies',
    [1, 2, 5, 6, 11, 23].every(n => isoLocal(taskCalendarRange(T('x', n, 4), MON_SEP_7, 5).end) === isoLocal(getTaskDateRange(T('x', n, 4), MON_SEP_7, 5).end)));

  // AddTask's inverse: the day the user picked → the working-day number.
  eq('picking Mon Sep 14 gives startDay 6', startDayNumberFor(MON_SEP_7, new Date(2026, 8, 14), 5), 6);
  eq('picking Fri Sep 11 gives startDay 5', startDayNumberFor(MON_SEP_7, new Date(2026, 8, 11), 5), 5);
  eq('picking Sat Sep 12 (closed) starts the next working day, Mon 14 = 6', startDayNumberFor(MON_SEP_7, new Date(2026, 8, 12), 5), 6);
  eq('picking Sun Sep 13 (closed) also gives 6', startDayNumberFor(MON_SEP_7, new Date(2026, 8, 13), 5), 6);
  eq('picking the anchor gives 1', startDayNumberFor(MON_SEP_7, MON_SEP_7, 5), 1);
  eq('picking before the anchor clamps to 1', startDayNumberFor(MON_SEP_7, new Date(2026, 8, 5), 5), 1);
  eq('on a 7-day week Sat Sep 12 is day 6', startDayNumberFor(MON_SEP_7, new Date(2026, 8, 12), 7), 6);
  eq('with Mon 14 closed, picking it lands on Tue 15 = day 6', startDayNumberFor(MON_SEP_7, new Date(2026, 8, 14), 5, ['2026-09-14']), 6);
  eq('the calendar-day inverse it replaced said 8 for Mon Sep 14',
    1 + Math.round((new Date(2026, 8, 14).getTime() - MON_SEP_7.getTime()) / MS_DAY), 8);
  ok('startDayNumberFor round-trips taskCalendarRange for days 1..40 (5-day week + a closure)',
    Array.from({ length: 40 }, (_, i) => i + 1).every(n =>
      startDayNumberFor(MON_SEP_7, taskCalendarRange(T('r', n, 1), MON_SEP_7, 5, ['2026-09-14']).start, 5, ['2026-09-14']) === n));
  // scheduleDayNumberFor (today-on-site) keeps its on/before semantics: a
  // Saturday is still "day 5's week", not day 6.
  eq('scheduleDayNumberFor treats Sat Sep 12 as day 5', scheduleDayNumberFor(MON_SEP_7, new Date(2026, 8, 12), 5), 5);
}

// The adoption. Every file under components/schedule/mobile/ that turns a
// startDay into a calendar day must do it through addWorkingDays /
// taskCalendarRange, and NOTHING under that directory may build a Date from
// day-multiplied milliseconds any more (B4 review item 2: `getTime() + d *
// MS_DAY` lands at 23:00 the day before across the 2026-11-01 fall-back).
console.log('\nthe mobile surfaces adopted it:');
{
  const dir = join(ROOT, 'components', 'schedule', 'mobile');
  const files = readdirSync(dir).filter(f => /\.tsx?$/.test(f)).map(f => join(dir, f));
  ok('the mobile schedule directory was found', files.length >= 8, `only ${files.length} files`);
  const msDay: string[] = [];
  for (const f of files) {
    const code = stripComments(readFileSync(f, 'utf8'));
    code.split('\n').forEach((line, i) => {
      if (/\*\s*(?:MS_DAY|86400000|86_400_000)\b|\b(?:MS_DAY|86400000|86_400_000)\s*\*/.test(line)) msDay.push(`${f.slice(ROOT.length + 1)}:${i + 1}: ${line.trim()}`);
    });
  }
  ok('no mobile schedule surface multiplies days into milliseconds (DST-unsafe day walk)',
    msDay.length === 0, msDay.join('\n       '));

  const uses = (file: string, re: RegExp) => re.test(stripComments(read(`components/schedule/mobile/${file}`)));
  for (const [file, re] of [
    ['MobileScheduleList.tsx', /taskCalendarRange\(t, base, workingDaysPerWeek, nonWorkingDates\)/],
    ['TaskDetailSheet.tsx', /taskCalendarRange\(task, base, workingDaysPerWeek, nonWorkingDates\)/],
    ['ProgressTab.tsx', /taskCalendarRange\(m, base, workingDaysPerWeek, nonWorkingDates\)/],
    ['MonthCalendarSheet.tsx', /addWorkingDays\(base, \(t\.startDay \?\? 1\) - 1, wdpw, nonWorkingDates\)/],
    ['MobileGantt.tsx', /const x = dayToX\(offsetOfWorkingDay\(n\)\);/],
    ['MobileGantt.tsx', /return startDayNumberFor\(base, dayAt\(colToDay\(targetCol\)\), wdpw, nonWorkingDates\);/],
    ['MobileGantt.tsx', /const dow = dayAt\(d\)\.getDay\(\);/],
    ['MonthCalendarSheet.tsx', /addCalendarDays\(first, i - startOffset\)/],
    ['LivingFloorPlan.tsx', /scheduleDayNumberFor\(base, new Date\(\), workingDaysPerWeek, nonWorkingDates\) - 1/],
    ['MobileScheduleScreen.tsx', /startDay = startDayNumberFor\(base, target, activeSchedule\?\.workingDaysPerWeek, activeSchedule\?\.nonWorkingDates\)/],
  ] as const) {
    ok(`${file} resolves ${String(re).slice(1, 60)}…`, uses(file, re));
  }
  const screen = stripComments(read('components/schedule/mobile/MobileScheduleScreen.tsx'));
  for (const c of ['MobileScheduleList', 'MobileGantt', 'TaskDetailSheet', 'MonthCalendarSheet', 'ProgressTab', 'LivingFloorPlan']) {
    ok(`MobileScheduleScreen hands <${c}> the schedule calendar (workingDaysPerWeek + nonWorkingDates)`,
      new RegExp(`<${c}[\\s\\S]{0,400}?workingDaysPerWeek=\\{[^}]+\\}[\\s\\S]{0,120}?nonWorkingDates=\\{[^}]+\\}`).test(screen));
  }
}

// ── 8. One "which day is today" basis (B4 review item 3) ───────────────────
// Home and Summary each carried a private todayScheduleDayNumber that ignored
// nonWorkingDates and floored raw milliseconds on 7-day weeks (a day behind
// all summer in Denver). They must call scheduleDayNumberFor — the inverse of
// getTaskDateRange that app/daily-report.tsx already used — with the
// schedule's closures, and no private copy may exist anywhere.
console.log('\nthe daily report uses scheduleDayNumberFor, and nobody keeps a private copy:');
{
  const walk = (d: string, out: string[] = []): string[] => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const copies: string[] = [];
  for (const root of ['app', 'components', 'utils', 'hooks', 'contexts']) {
    for (const f of walk(join(ROOT, root))) {
      if (/\b(?:function|const|let)\s+todayScheduleDayNumber\b/.test(stripComments(readFileSync(f, 'utf8')))) copies.push(f.slice(ROOT.length + 1));
    }
  }
  ok('no private todayScheduleDayNumber definition survives', copies.length === 0, copies.join('\n       '));
  for (const [file, re] of [
    // Neither Summary NOR Home is in this list any more. Both ask a different
    // question — "is this task on site on THIS calendar day", a membership
    // test — and scheduleDayNumberFor answers the "what day is the job on"
    // question with two clamps that invent work when used for membership.
    // They call scheduleDayOnCalendar instead; section 8b pins that, the Home
    // strip's own two symptoms, and the clamp difference between the two.
    ['app/daily-report.tsx', /scheduleDayNumberFor\(base, reportDay, project\.schedule\.workingDaysPerWeek, project\.schedule\.nonWorkingDates\)/],
    ['app/daily-report.tsx', /scheduleDayNumberFor\(startDay, reportDay, sched\.workingDaysPerWeek, sched\.nonWorkingDates\)/],
  ] as const) {
    ok(`${file} calls scheduleDayNumberFor with the schedule's closures`, re.test(stripComments(read(file))));
  }
  // 7-day weeks no longer floor milliseconds: across the spring-forward the
  // 23-hour day still counts as one.
  eq('7-day week across the 2026-03-08 spring-forward: Mar 9 is day 3 from Mar 7',
    scheduleDayNumberFor(new Date(2026, 2, 7), new Date(2026, 2, 9), 7), 3);
  eq('a closure is skipped on Home/Summary too: Wed 4 closed → Thu Mar 5 is day 3',
    scheduleDayNumberFor(new Date(2026, 2, 2), new Date(2026, 2, 5), 5, ['2026-03-04']), 3);
}

// ── 8b. MEMBERSHIP is not the same question (the briefing over-report) ─────
// scheduleDayNumberFor CLAMPS twice, by design: every date at or before the
// anchor is day 1, and a closed day folds back onto the working day before it.
// That is right for "what working day is this job on today" and wrong as
// "is this task on site on THIS calendar day" — under those clamps the morning
// briefing INVENTED work: a job breaking ground in 25 days listed its day-1
// task as on site today, the week strip put a crew on the three days before a
// Thursday start, and ONE 0-day milestone was counted four times because Mon,
// Tue, Wed and Thu all clamp to day 1. Same class as MISS-01, aimed the other
// way. scheduleDayOnCalendar is the membership answer: the exact inverse of
// addWorkingDays, null when the schedule does not land on that day.
console.log('\nmembership asks scheduleDayOnCalendar, which does not clamp:');
{
  const MON = new Date(2026, 8, 7); // Mon 2026-09-07
  eq('the anchor itself is day 1', scheduleDayOnCalendar(MON, MON, 5), 1);
  eq('the next working day is day 2', scheduleDayOnCalendar(MON, new Date(2026, 8, 8), 5), 2);
  eq('Fri is day 5', scheduleDayOnCalendar(MON, new Date(2026, 8, 11), 5), 5);
  eq('Sat is NOT a day of a 5-day schedule', scheduleDayOnCalendar(MON, new Date(2026, 8, 12), 5), null);
  eq('Sun is not either', scheduleDayOnCalendar(MON, new Date(2026, 8, 13), 5), null);
  eq('… but Sat IS day 6 on a 7-day week', scheduleDayOnCalendar(MON, new Date(2026, 8, 12), 7), 6);
  eq('the day BEFORE the anchor is no day at all', scheduleDayOnCalendar(MON, new Date(2026, 8, 4), 5), null);
  eq('nor is a month before it', scheduleDayOnCalendar(MON, new Date(2026, 7, 7), 5), null);
  eq('a site closure is not a day of the schedule', scheduleDayOnCalendar(MON, new Date(2026, 8, 9), 5, ['2026-09-09']), null);
  eq('… and the day after it takes that day number', scheduleDayOnCalendar(MON, new Date(2026, 8, 10), 5, ['2026-09-09']), 3);
  // A user CAN anchor on a Saturday, and addWorkingDays(start, 0) is `start`,
  // so day 1 is that Saturday. Membership must agree with the drawing.
  const SAT = new Date(2026, 8, 12);
  eq('an anchor that falls on a Saturday is still its own day 1', scheduleDayOnCalendar(SAT, SAT, 5), 1);
  eq('… the Sunday after it is not a working day', scheduleDayOnCalendar(SAT, new Date(2026, 8, 13), 5), null);
  eq('… and the Monday is day 2', scheduleDayOnCalendar(SAT, new Date(2026, 8, 14), 5), 2);

  // The contrast that caused the regression, stated as a test so nobody
  // "simplifies" one into the other again.
  eq('scheduleDayNumberFor clamps a pre-start date to day 1 (right for its own question)',
    scheduleDayNumberFor(MON, new Date(2026, 8, 4), 5), 1);
  eq('scheduleDayOnCalendar refuses it (right for membership)',
    scheduleDayOnCalendar(MON, new Date(2026, 8, 4), 5), null);

  // Round-trip: for every day of a month, a non-null answer must be the day
  // addWorkingDays actually places, and a null must be a day it never places.
  const placed = new Set<string>();
  for (let n = 1; n <= 30; n++) placed.add(toCalendarDayString(addWorkingDays(MON, n - 1, 5, ['2026-09-23'])));
  let roundTrip = true;
  const bad: string[] = [];
  for (let i = -10; i < 45; i++) {
    const d = new Date(2026, 8, 7 + i);
    const n = scheduleDayOnCalendar(MON, d, 5, ['2026-09-23']);
    const iso = toCalendarDayString(d);
    if (n === null) { if (placed.has(iso)) { roundTrip = false; bad.push(`${iso} is placed but reported null`); } continue; }
    const back = toCalendarDayString(addWorkingDays(MON, n - 1, 5, ['2026-09-23']));
    if (back !== iso) { roundTrip = false; bad.push(`${iso} → day ${n} → ${back}`); }
  }
  ok('scheduleDayOnCalendar is the exact inverse of addWorkingDays over 55 days', roundTrip, bad.join('; '));
}

console.log('\nthe morning briefing never invents work the schedule does not have:');
{
  const mk = (id: string, startDate: string | undefined, tasks: ScheduleTask[]): Project => ({
    id, name: id, status: 'in_progress', createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schedule: { tasks, workingDaysPerWeek: 5, startDate } as never,
  } as unknown as Project);

  // (A) A job that breaks ground in 25 days has nobody on site today.
  const future = mk('future', '2026-10-01', [T('t1', 1, 5), T('t2', 6, 5)]);
  eq('a job starting 2026-10-01 lists nothing on site on 2026-09-06',
    computeTodayTasks([future], new Date(2026, 8, 6)).length, 0);
  eq('… and lists its day-1 task on 2026-10-01 itself',
    computeTodayTasks([future], new Date(2026, 9, 1)).map(t => t.taskTitle).join(','), 'T1');

  // (B) The production row shape: Houston Phone Booth Ad, Thu 2026-08-06.
  const thu = mk('houston', '2026-08-06', [T('t1', 1, 10)]);
  eq('the week strip reports no crew on the three days before a Thursday start',
    computeWeekLoad([thu], new Date(2026, 7, 5)).days.slice(0, 3).map(d => d.count).join(''), '000');
  eq('… and does report it from the start day on',
    computeWeekLoad([thu], new Date(2026, 7, 5)).days.slice(3, 5).map(d => d.count).join(''), '11');

  // (C) One milestone is one milestone. WeekAheadStrip prints this number
  // verbatim, and composeBrief repeats it as "N milestones landing".
  const ms = mk('milestone', '2026-09-10', [T('m', 1, 0, { isMilestone: true })]);
  const msWeek = computeWeekLoad([ms], new Date(2026, 8, 9));
  eq('one 0-day milestone on a Thursday start counts ONCE, not once per clamped day',
    msWeek.milestoneCount, 1);
  eq('… on the Thursday', msWeek.days.filter(d => d.hasMilestone).map(d => d.date).join(','), '2026-09-10');

  // ── Home's TODAY ON SITE strip is the same question, so the same helper ──
  // It shipped on scheduleDayNumberFor and therefore had both clamp symptoms
  // in the user's face: a job starting 2026-10-01 was listed as on site today,
  // and every Saturday and Sunday it re-listed Friday's crew. Home builds its
  // rows inline in a .tsx that cannot be imported here, so the rule is pinned
  // textually and the ARITHMETIC is reconciled against the briefing below.
  {
    const home = stripComments(read('app/(tabs)/(home)/index.tsx'));
    ok('Home asks membership with scheduleDayOnCalendar',
      /scheduleDayOnCalendar\(base, now, sched\.workingDaysPerWeek, sched\.nonWorkingDates\)/.test(home));
    ok('… and drops the project when today is not a day of its schedule',
      /if \(todayDayNumber === null\) continue;/.test(home));
    ok('… reusing the shared active-task predicate rather than inlining the range',
      /isTaskActiveOnScheduleDay\(t, todayDayNumber\)/.test(home)
      && !/todayDayNumber >= start && todayDayNumber <= start \+ dur - 1/.test(home));
    ok('… and no longer imports the clamping helper at all',
      !/scheduleDayNumberFor/.test(home),
      (home.match(/.*scheduleDayNumberFor.*/g) ?? []).join('\n       '));

    // Home's rule, replayed here over the same inputs the briefing gets: for
    // every calendar day of a month, the set of task titles Home would list is
    // exactly the set Summary counts. One basis, two screens, no drift.
    const homeRow = (p: Project, now: Date): string[] => {
      const sched = p.schedule;
      if (!sched || !sched.tasks || sched.tasks.length === 0) return [];
      const base = parseCalendarDay(sched.startDate ?? null);
      if (!base) return [];
      const n = scheduleDayOnCalendar(base, now, sched.workingDaysPerWeek, sched.nonWorkingDates);
      if (n === null) return [];
      return sched.tasks.filter(t => isTaskActiveOnScheduleDay(t, n)).map(t => t.title);
    };
    const job = mk('home', '2026-09-10', [T('t1', 1, 4), T('t2', 3, 6), T('t3', 12, 2)]);
    let agree = true;
    const detail: string[] = [];
    const before: string[] = [];
    const weekend: string[] = [];
    for (let i = -6; i < 30; i++) {
      const d = new Date(2026, 8, 4 + i);
      const mine = homeRow(job, d).sort().join(',');
      const theirs = computeTodayTasks([job], d).map(t => t.taskTitle).sort().join(',');
      if (mine !== theirs) { agree = false; detail.push(`${toCalendarDayString(d)}: home [${mine}] vs summary [${theirs}]`); }
      if (d < new Date(2026, 8, 10)) before.push(mine);
      if (d.getDay() === 0 || d.getDay() === 6) weekend.push(mine);
    }
    ok('Home lists exactly what the briefing counts, every day for a month', agree, detail.join('; '));
    ok('(a) nothing is on site before the job starts', before.every(x => x === ''), before.join('|'));
    ok('(b) nothing is on site on a weekend of a 5-day schedule', weekend.every(x => x === ''), weekend.join('|'));
    eq('… while the start day itself lists its day-1 work',
      homeRow(job, new Date(2026, 8, 10)).join(','), 'T1');
  }
}

// ── 9. ONE anchor rule: an undated schedule has NO date, not today's ──────
// The 2026-09-06 runtime audit (SCHED-NO-ANCHOR + MISS-01) found FIVE
// surfaces inventing five different anchors for the same absent
// `schedule.startDate` — and 2 of the 3 real schedules in production have
// never had one (Henderson 20 tasks, Watermark 9F 19, both in_progress):
//
//   mobile Schedule   today          → every task date moved forward one day,
//                                      every day, with nothing saying so
//   desktop Schedule  today          → same drift, and "Starts <today>"
//   icsGenerator      today (UTC)    → drifting dates written into the GC's
//                                      real Apple/Google calendar
//   summaryBriefing   createdAt      → "Nothing scheduled on site today" and
//                                      "No scheduled work this week" on jobs
//                                      with 20 and 15 OPEN tasks, above a card
//                                      calling those same schedules at risk
//   construction-ai   the UTC day    → a fifth answer
//
// resolveScheduleAnchor is the single rule and it has NO fallback: undated
// means `date === null`, and the surface must say so.

console.log('\nthe anchor resolves once, and an absent one stays absent:');
{
  const a = resolveScheduleAnchor({ startDate: '2026-03-02' });
  ok('a bare YYYY-MM-DD resolves to LOCAL midnight of that day',
    a.dated && a.date !== null && isoLocal(a.date) === '2026-03-02' && a.date.getDay() === 1,
    `TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone} got ${a.date?.toString()}`);
  eq('and its iso round-trips', a.iso, '2026-03-02');
  ok('a Supabase full-ISO round-trip resolves to the same day',
    resolveScheduleAnchor({ startDate: '2026-03-02T00:00:00.000Z' }).iso === '2026-03-02');

  for (const [label, value] of [
    ['absent', undefined],
    ['null', null],
    ['empty string', ''],
    ['not a date', 'sometime in May'],
    ['rolled-over components', '2026-13-45'],
  ] as const) {
    const r = resolveScheduleAnchor({ startDate: value as string | null | undefined });
    ok(`${label} ⇒ UNDATED (date null, iso null, dated false)`,
      r.date === null && r.iso === null && r.dated === false,
      JSON.stringify({ iso: r.iso, dated: r.dated }));
  }
  ok('a missing schedule object is undated too', !resolveScheduleAnchor(null).dated);
  ok('isUndatedSchedule is false for no schedule at all (nothing to disclose)',
    !isUndatedSchedule(null) && !isUndatedSchedule(undefined));
  ok('isUndatedSchedule is true for a schedule with no startDate',
    isUndatedSchedule({ startDate: undefined }) && !isUndatedSchedule({ startDate: '2026-03-02' }));

  // The preview origin is TODAY and it is NOT the anchor. Both facts matter:
  // it exists (relative drawings need an origin) and it never leaks into
  // `date`, which is what made the dates drift.
  const now = new Date(2026, 8, 6, 22, 30);
  const r = resolveScheduleAnchor({}, now);
  eq('unanchoredPreviewIso is TODAY from LOCAL components, not toISOString',
    r.unanchoredPreviewIso, '2026-09-06');
  eq('unanchoredPreviewDate is local midnight', r.unanchoredPreviewDate.getHours(), 0);
  ok('the preview never becomes the anchor', r.date === null && r.iso === null);

  // The drift itself, pinned: the OLD rule moved every task a day per day.
  const day1 = resolveScheduleAnchor({}, new Date(2026, 8, 6)).unanchoredPreviewIso;
  const day2 = resolveScheduleAnchor({}, new Date(2026, 8, 7)).unanchoredPreviewIso;
  ok('the today-fallback really did move a day per day (that is the bug)', day1 !== day2);
  ok('the anchor rule does NOT move a day per day',
    resolveScheduleAnchor({}, new Date(2026, 8, 6)).iso === resolveScheduleAnchor({}, new Date(2026, 8, 7)).iso);
}

console.log('\nan undated schedule says day numbers, which are real:');
{
  eq('a 5-day task starting day 6', taskWorkingDayLabel(T('a', 6, 5)), 'Day 6 – 10');
  eq('a 1-day task', taskWorkingDayLabel(T('b', 6, 1)), 'Day 6');
  eq('a milestone (0 days)', taskWorkingDayLabel(T('m', 6, 0, { isMilestone: true })), 'Day 6');
  eq('day 1 of the plan', taskWorkingDayLabel(T('c', 1, 1)), 'Day 1');
}

// ── 10. TODAY ON SITE and THIS WEEK are the same rule (MISS-01) ───────────
// Summary drew TODAY with the 1-indexed WORKING-day model and THIS WEEK with a
// 0-indexed RAW CALENDAR index whose inclusive end was one day too long. Two
// cards on one screen, disagreeing about the same task on the same day.

console.log('\nTODAY ON SITE and THIS WEEK share one membership rule:');
{
  eq('a 5-day task starting day 6 is not on site on day 5', isTaskActiveOnScheduleDay(T('a', 6, 5), 5), false);
  eq('… is on site on day 6', isTaskActiveOnScheduleDay(T('a', 6, 5), 6), true);
  eq('… is on site on day 10 (inclusive last day = start + dur - 1)', isTaskActiveOnScheduleDay(T('a', 6, 5), 10), true);
  eq('… is NOT on site on day 11', isTaskActiveOnScheduleDay(T('a', 6, 5), 11), false);
  eq('the old THIS WEEK rule (start + dur) counted day 11 — that was the bug',
    11 >= 6 && 11 <= 6 + 5, true);
  eq('a done task is never on site', isTaskActiveOnScheduleDay(T('a', 6, 5, { status: 'done' }), 7), false);
  eq('a 0-day milestone is an event, not work', isTaskActiveOnScheduleDay(T('m', 6, 0, { isMilestone: true }), 6), false);
  eq('… and is reported as a milestone on its own day', isMilestoneOnScheduleDay(T('m', 6, 0, { isMilestone: true }), 6), true);
  eq('… but not on the next', isMilestoneOnScheduleDay(T('m', 6, 0, { isMilestone: true }), 7), false);
}

const proj = (over: Partial<Project> & { id: string }, sched: Record<string, unknown> | null): Project => ({
  name: over.id, status: 'in_progress', createdAt: '2026-03-20T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z', ...over,
  schedule: sched as never,
} as unknown as Project);

console.log('\nthe morning briefing never reports an empty day it cannot see:');
{
  // The exact production shape: a 30-working-day plan, created in March, with
  // NO startDate. Anchored at createdAt (the old rule) "today" is working day
  // ~122 and every card comes back empty.
  const undatedTasks = [T('t1', 1, 10), T('t2', 11, 10), T('t3', 21, 10)];
  const dated = proj({ id: 'dated' }, { tasks: undatedTasks, workingDaysPerWeek: 5, startDate: '2026-09-07' });
  const undated = proj({ id: 'henderson' }, { tasks: undatedTasks, workingDaysPerWeek: 5 });
  const NOW = new Date(2026, 8, 9); // Wed of the anchor week

  const weekBoth = computeWeekLoad([dated, undated], NOW);
  ok('an undated schedule is NAMED, not silently dropped',
    weekBoth.undated.length === 1 && weekBoth.undated[0].projectId === 'henderson',
    JSON.stringify(weekBoth.undated));
  eq('… with its open-task count, so "0 tasks" can never read as "no work"',
    weekBoth.undated[0].openTasks, 3);
  ok('a dated schedule is NOT in the undated list', !weekBoth.undated.some(u => u.projectId === 'dated'));
  ok('the undated project contributes no phantom work to the week',
    weekBoth.totalTasks === computeWeekLoad([dated], NOW).totalTasks,
    `${weekBoth.totalTasks} vs ${computeWeekLoad([dated], NOW).totalTasks}`);
  ok('and none to today', computeTodayTasks([dated, undated], NOW).length === computeTodayTasks([dated], NOW).length);
  ok('the createdAt anchor is gone: nothing is placed from project.createdAt',
    !/createdAt/.test(stripComments(read('utils/summaryBriefing.ts'))),
    (stripComments(read('utils/summaryBriefing.ts')).match(/.*createdAt.*/g) ?? []).join('\n       '));

  // THE reconciliation: for every day of the week, THIS WEEK's count is
  // exactly the number of tasks TODAY ON SITE would list on that day.
  let agree = true;
  const detail: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(2026, 8, 7 + i);
    const weekCount = computeWeekLoad([dated], d).days.find(x => x.date === toCalendarDayString(d))?.count ?? -1;
    const todayCount = computeTodayTasks([dated], d).length;
    if (weekCount !== todayCount) { agree = false; detail.push(`${toCalendarDayString(d)}: week ${weekCount} vs today ${todayCount}`); }
  }
  ok('every day of THIS WEEK counts exactly what TODAY ON SITE would list', agree, detail.join('; '));

  const wk = computeWeekLoad([dated], NOW);
  eq('the week strip days are LOCAL calendar days, not a UTC re-projection',
    wk.days[0].date, '2026-09-07');
  // Weekend days are NOT working days on a 5-day week, so the strip shows zero
  // there. The comment here used to claim this and the assertion underneath
  // checked the ISO label instead — with the old rule Sat and Sun BOTH counted
  // Friday's tasks, because scheduleDayNumberFor folds a closed day back onto
  // the working day before it.
  eq('Sat and Sun of a 5-day-week schedule count zero tasks',
    `${wk.days[5].count}/${wk.days[6].count}`, '0/0');
  eq('… while Mon–Fri of the same 30-day plan each count one',
    wk.days.slice(0, 5).map(d => d.count).join(''), '11111');
}

// utils/icsGenerator.ts cannot be imported here — it pulls in react-native,
// expo-file-system and expo-sharing at module scope and this validator runs in
// bare bun. Its two guarantees are pinned instead: (a) no task event without
// an anchor, (b) the dates it does write are WORKING-day dates from
// taskCalendarRange — the same resolver exercised numerically above. The
// arithmetic the .ics now produces is therefore already covered by section 7.
console.log('\nan .ics never carries a date the schedule does not have:');
{
  const ics = stripComments(read('utils/icsGenerator.ts'));
  ok('buildProjectEvents emits task events only when the anchor resolved',
    /if \(schedule && schedule\.tasks\.length > 0 && anchor\.date\)/.test(ics));
  ok('the skip is reported so the caller can disclose an empty schedule section',
    /export function projectIcsScheduleSkip/.test(ics) && /scheduleSkip: IcsScheduleSkip/.test(ics));
  ok('the export result carries it', /return \{ icsText, fileUri, eventCount: events\.length, scheduleSkip \};/.test(ics));
  ok('no todayIso\(\) fallback survives anywhere in the module',
    !/todayIso/.test(ics), (ics.match(/.*todayIso.*/g) ?? []).join('\n       '));
  ok('task dates are walked with taskCalendarRange, not raw addDays',
    /taskCalendarRange\(t, anchor, schedule\.workingDaysPerWeek, schedule\.nonWorkingDates\)/.test(ics)
    && !/addDays\(scheduleStartIso/.test(ics));

  // The working-day answer the .ics now writes, computed here from the shared
  // resolver so a regression in taskCalendarRange fails as an ICS failure too.
  const anchorDate = parseCalendarDay('2026-09-07')!;
  eq('day 1 dur 5 on Mon Sep 7 ends Fri Sep 11',
    isoLocal(taskCalendarRange(T('t1', 1, 5), anchorDate, 5).end), '2026-09-11');
  eq('a milestone on day 6 is the NEXT Monday, not the Saturday',
    isoLocal(taskCalendarRange(T('m', 6, 0, { isMilestone: true }), anchorDate, 5).start), '2026-09-14');
}

// ── 11. No surface may re-invent an anchor ───────────────────────────────
// A textual sweep, because the invention is one `??` and it reappears the
// moment someone writes a new screen. Two idioms are banned:
//   `startDate ?? today / createdAt`        — the resolution itself
//   `parseCalendarDay(startDate) ?? new Date()` — the same thing, one call in
// A file is either migrated to resolveScheduleAnchor, or it is named below.

console.log('\nno surface re-invents the anchor:');
{
  // Legitimate: CREATING a schedule right now — today is a date the user is
  // choosing by the act, not a substitute for one they never gave.
  const CREATION_ANCHORS = new Set([
    'app/(tabs)/schedule/index.tsx',
    'components/schedule/mobile/MobileScheduleScreen.tsx',
  ]);
  // Not a schedule at all — a warranty's own start date.
  const NOT_A_SCHEDULE_ANCHOR = new Set([
    'utils/copilot/warranty/warrantyCapability.ts',
  ]);
  // DEBT, from the 2026-09-06 audit fix. Each still resolves an absent anchor
  // to today or to project.createdAt. Delete the entry when it migrates to
  // resolveScheduleAnchor — do NOT add to this list.
  const KNOWN_UNMIGRATED = new Set([
    'app/(tabs)/(home)/index.tsx',                          // TODAY ON SITE strip: `sched.startDate || p.createdAt`
    'app/(tabs)/construction-ai/index.tsx',                 // roadmap: the UTC day
    'app/daily-report.tsx',                                 // report day number: createdAt
    'components/schedule/mobile/MobileGantt.tsx',           // needs `string | null` + an undated column model
    'components/schedule/mobile/MonthCalendarSheet.tsx',    // ditto
    'components/schedule/mobile/ProgressTab.tsx',           // milestone column should print taskWorkingDayLabel
    'components/schedule/mobile/ExportCenterSheet.tsx',     // CSV/PDF/share all print dates
    'components/schedule/mobile/LivingFloorPlan.tsx',       // 4D "today index" from an invented anchor
  ]);

  const INVENTED = /(?:schedule\??\.)?startDate\w*\s*(?:\?\?|\|\|)\s*(?:todayCalendarDay\(\)|todayIso\(\)|new Date\(\)|[A-Za-z_$][\w$.?]*createdAt)/;
  const PARSE_FALLBACK = /parseCalendarDay\(\s*\w+\s*\)\s*\?\?\s*(?:new Date\(\)|startOfDay\(new Date\(\)\))/;

  const walk = (d: string, out: string[] = []): string[] => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  };

  const hits = new Map<string, string[]>();
  for (const root of ['app', 'components', 'utils', 'hooks', 'contexts']) {
    for (const f of walk(join(ROOT, root))) {
      const rel = f.slice(ROOT.length + 1);
      const code = stripComments(readFileSync(f, 'utf8'));
      code.split('\n').forEach((line, i) => {
        if (!INVENTED.test(line) && !PARSE_FALLBACK.test(line)) return;
        if (!hits.has(rel)) hits.set(rel, []);
        hits.get(rel)!.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  const unexpected = [...hits.keys()].filter(
    f => !CREATION_ANCHORS.has(f) && !NOT_A_SCHEDULE_ANCHOR.has(f) && !KNOWN_UNMIGRATED.has(f),
  );
  ok('the sweep still finds the known call sites (the regex has not rotted)',
    hits.size >= 8, `only ${hits.size} files matched`);
  ok('no NEW surface invents a schedule anchor', unexpected.length === 0,
    unexpected.flatMap(f => hits.get(f)!).join('\n       ') +
    '\n\n      There is no fallback anchor. Call resolveScheduleAnchor(schedule)' +
    '\n      from @/utils/scheduleOps and render the undated case (say it, and' +
    '\n      offer a start date) — a date drawn from today moves forward one day' +
    '\n      every day and nothing on screen says so.');
  // The debt list must shrink, never silently go stale.
  const stale = [...KNOWN_UNMIGRATED].filter(f => !hits.has(f));
  ok('every KNOWN_UNMIGRATED entry still has a violation (delete the fixed ones)',
    stale.length === 0, stale.join('\n       '));
}

console.log('\nthe migrated surfaces call the one rule:');
{
  for (const [file, re, why] of [
    ['components/schedule/mobile/MobileScheduleScreen.tsx',
      /const anchor = useMemo\(\(\) => resolveScheduleAnchor\(activeSchedule\), \[activeSchedule\]\)/,
      'resolves the anchor once'],
    ['components/schedule/mobile/MobileScheduleScreen.tsx',
      /const isUndated = !!activeSchedule && tasks\.length > 0 && !anchor\.dated/,
      'knows when it is undated'],
    ['components/schedule/mobile/MobileScheduleScreen.tsx',
      /scheduleStartDate: anchor\.iso \?\? undefined/,
      'keeps CPM in raw-day mode without an anchor (the finish-jump bug)'],
    ['components/schedule/mobile/MobileScheduleScreen.tsx',
      /testID="schedule-undated-banner"/,
      'SAYS the schedule is undated'],
    ['components/schedule/mobile/MobileScheduleScreen.tsx',
      /<DatePickerModal[\s\S]{0,400}?onChange=\{\(iso\) => applyStartDate\(iso\.slice\(0, 10\)\)\}/,
      'OFFERS to set the start date'],
    // 2026-09-11: the OPPOSITE assertion. This used to demand a
    // `rebaseRawToCalendar` call here. That helper compensated for the CPM
    // engine reading `ScheduleTask.startDay` as a CALENDAR index; the engine
    // now converts at its own `pins` line, so `startDay` is a WORKING ORDINAL
    // on both sides of the anchor flip and re-mapping DOUBLE-converts. Both
    // this screen and app/(tabs)/schedule/index.tsx persist the result through
    // updateProject, so it was stored corruption, not a display artefact:
    // A(10)->B(10)->C(5) at ordinals 1/11/21 on a 5-day week from
    // Mon 2026-03-02 became 1,15,29 and the finish moved Apr 3 → Apr 15.
    ['components/schedule/mobile/MobileScheduleScreen.tsx',
      /^(?![\s\S]*rebaseRawToCalendar)[\s\S]*$/,
      'does NOT re-map startDay when the first anchor is set (the engine converts)'],
    ['app/(tabs)/schedule/index.tsx',
      /^(?![\s\S]*rebaseRawToCalendar)[\s\S]*$/,
      'does NOT re-map startDay when the first anchor is set (the engine converts)'],
    ['components/schedule/mobile/MobileScheduleList.tsx',
      /startDate: string \| null;/, 'accepts a null anchor'],
    ['components/schedule/mobile/MobileScheduleList.tsx',
      /range = taskWorkingDayLabel\(t\)/, 'prints day numbers when undated'],
    ['components/schedule/mobile/TaskDetailSheet.tsx',
      /startDate: string \| null;/, 'accepts a null anchor'],
    ['components/schedule/mobile/TaskDetailSheet.tsx',
      /const startLabel = range \? fmt\(range\.start\) : `Day \$\{startDayNumber\}`/,
      'never steps a real startDay against an invented date'],
    ['app/(tabs)/schedule/index.tsx',
      /const scheduleAnchor = useMemo\(\(\) => resolveScheduleAnchor\(activeSchedule\), \[activeSchedule\]\)/,
      'resolves the anchor once'],
    ['app/(tabs)/schedule/index.tsx',
      /\?\s*UNDATED_SCHEDULE_PREVIEW_NOTE/,
      'never prints today as the plan’s start'],
    ['app/(tabs)/summary/index.tsx',
      /const today = useMemo\(\(\) => computeTodayTasks\(active\), \[active\]\)/,
      'uses the shared rollup instead of a private copy'],
    ['app/(tabs)/summary/index.tsx',
      /testID="summary-undated-schedules"/,
      'names the schedules it could not place'],
    ['utils/summaryBriefing.ts',
      /undated: undatedSchedules\(projects\)/, 'reports what it could not place'],
    ['utils/icsGenerator.ts',
      /if \(schedule && schedule\.tasks\.length > 0 && anchor\.date\)/,
      'writes no task event without an anchor'],
    ['utils/icsGenerator.ts',
      /taskCalendarRange\(t, anchor, schedule\.workingDaysPerWeek, schedule\.nonWorkingDates\)/,
      'walks WORKING days like every other surface'],
    ['app/last-planner.tsx',
      /const startDate = resolveScheduleAnchor\(project\?\.schedule\)\.iso/,
      'resolves the anchor through the one rule'],
    ['app/last-planner.tsx',
      /if \(tasks\.length > 0 && !startDate\)/,
      'tells an undated 20-task plan apart from an empty one'],
  ] as const) {
    ok(`${file} ${why}`, re.test(stripComments(read(file))));
  }
  ok('MobileScheduleScreen no longer falls back to todayCalendarDay() for the anchor',
    !/startDate = activeSchedule\?\.startDate \?\? todayCalendarDay\(\)/.test(stripComments(read('components/schedule/mobile/MobileScheduleScreen.tsx'))));
  ok('icsGenerator has no todayIso() left to fall back to',
    !/function todayIso/.test(stripComments(read('utils/icsGenerator.ts'))));
}

// ── 11. The preview must disclose itself ──────────────────────────────────
// utils/scheduleOps.ts states, above `unanchoredPreviewDate`, that anything
// reading it must render UNDATED_SCHEDULE_TITLE or
// UNDATED_SCHEDULE_PREVIEW_NOTE beside it and that this validator fails the
// build otherwise. That claim was false for a day — no such check existed and
// PREVIEW_NOTE was exported and used by nothing, while the desktop start bar
// carried its own copy of the wording. A comment promising enforcement that
// isn't there is the same failure this file exists to stop, aimed at the next
// engineer. Here is the enforcement.
console.log('\nevery surface that draws from the today-preview says so:');
{
  const walkAll = (d: string, out: string[] = []): string[] => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walkAll(p, out);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const silent: string[] = [];
  let readers = 0;
  for (const root of ['app', 'components', 'hooks', 'contexts']) {
    for (const f of walkAll(join(ROOT, root))) {
      const code = stripComments(readFileSync(f, 'utf8'));
      if (!/\bunanchoredPreview(?:Date|Iso)\b/.test(code)) continue;
      readers++;
      if (!/UNDATED_SCHEDULE_(?:TITLE|PREVIEW_NOTE)/.test(code)) silent.push(f.slice(ROOT.length + 1));
    }
  }
  ok('the sweep still finds the preview readers (the regex has not rotted)', readers >= 2, `${readers} found`);
  ok('no surface draws preview dates without naming the undated case', silent.length === 0,
    silent.join('\n       '));
  ok('UNDATED_SCHEDULE_PREVIEW_NOTE is the wording those surfaces use, not a dead export',
    /UNDATED_SCHEDULE_PREVIEW_NOTE/.test(stripComments(read('app/(tabs)/schedule/index.tsx'))));
  ok('… and it replaces a DATE, so it must not itself contain one',
    !/\d{4}|\d{1,2}\/\d{1,2}/.test(UNDATED_SCHEDULE_PREVIEW_NOTE), UNDATED_SCHEDULE_PREVIEW_NOTE);
  // The desktop start bar is rendered twice (wide pane + narrow pane). Both
  // copies must be the constant — that pair is what drifted.
  eq('both desktop start bars use the shared constant (not one, not an inline copy)',
    (stripComments(read('app/(tabs)/schedule/index.tsx')).match(/\?\s*UNDATED_SCHEDULE_PREVIEW_NOTE/g) ?? []).length, 2);
}

// ── 12. An empty .ics says WHY it is empty ────────────────────────────────
// buildProjectEvents now emits no task event without an anchor, which is
// right — but it made both callers state something false: "This schedule has
// no tasks yet" / "No schedule tasks … found for this project yet" on The
// Henderson Residence, which has 20. Trading an invented date for a false
// sentence is not a fix, so the skip is reported and both callers disclose it.
console.log('\nan empty calendar export says WHY it is empty:');
{
  const ics = stripComments(read('utils/icsGenerator.ts'));
  ok('the skip counts the tasks it left out', /skippedTaskCount: undated \? count : 0/.test(ics));
  ok('an eventless .ics is never pushed into the share sheet',
    /const canShare = events\.length > 0 && await Sharing\.isAvailableAsync\(\)/.test(ics));
  for (const [file, re, why] of [
    ['utils/scheduleExportIcal.ts', /result\.scheduleSkip/, 'reads the skip'],
    ['utils/scheduleExportIcal.ts', /if \(undatedSchedule\) \{[\s\S]{0,320}?UNDATED_SCHEDULE_TITLE/,
      'names the undated schedule instead of claiming it has no tasks'],
    ['app/project-detail.tsx', /const \{ undatedSchedule, skippedTaskCount \} = result\.scheduleSkip/,
      'reads the skip'],
    ['app/project-detail.tsx', /skipNote/, 'appends the disclosure to the success message too'],
    ['app/schedule-pro.tsx', /if \(result\.scheduleSkip\.undatedSchedule\)/,
      'says why a 20-task plan exported nothing, on web AND native'],
  ] as const) {
    ok(`${file} ${why}`, re.test(stripComments(read(file))));
  }
  // Order matters: the "no tasks yet" branch still exists (it is true for a
  // genuinely empty schedule) and must be UNREACHABLE for an undated one, so
  // the undated check has to come first and return.
  {
    const src = stripComments(read('utils/scheduleExportIcal.ts'));
    const undatedAt = src.indexOf('if (undatedSchedule)');
    const emptyAt = src.indexOf("'Nothing to export'");
    ok('the undated branch returns BEFORE the "no tasks yet" branch can fire',
      undatedAt >= 0 && emptyAt >= 0 && undatedAt < emptyAt,
      `undated@${undatedAt} empty@${emptyAt}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
