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
import { exportTasksToCsv } from '../utils/scheduleOps';
import { addWorkingDays, getTaskDateRange, buildScheduleFromTasks } from '../utils/scheduleEngine';
import { parseCalendarDay } from '../utils/calendarDate';
import type { ScheduleTask } from '../types';

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
    /import \{ parseCalendarDay \} from '@\/utils\/calendarDate'/.test(gantt));
  ok('MobileGantt baseMs uses parseCalendarDay',
    /startOfDayMs\(parseCalendarDay\(startDate\) \?\? new Date\(\)\)/.test(gantt));
  ok('MobileGantt no longer bare-parses the anchor',
    !/new Date\(startDate\)/.test(gantt),
    (gantt.match(/.*new Date\(startDate\).*/g) ?? []).join('\n       '));
  ok('MobileGantt emits the long-press ISO from local components, not toISOString',
    /toIsoDay\(new Date\(baseMs \+ day \* MS_DAY\)\)/.test(gantt) && !/toISOString\(\)/.test(gantt));

  const sheet = stripComments(read('components/schedule/mobile/TaskDetailSheet.tsx'));
  ok('TaskDetailSheet imports parseCalendarDay',
    /import \{ parseCalendarDay \} from '@\/utils\/calendarDate'/.test(sheet));
  ok('TaskDetailSheet baseMs uses parseCalendarDay',
    /parseCalendarDay\(startDate\) \?\? new Date\(\)/.test(sheet));
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
