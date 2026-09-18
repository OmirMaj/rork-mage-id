// validate-digest-schedule-today.ts — the 6 AM brief and the app agree on
// what is on site today (audit 2026-09-18 #14).
//
// The server brief (supabase/functions/morning-digest) counted CALENDAR days
// from the schedule start against task startDay values that are WORKING days,
// and filtered finished tasks on status 'completed' — a status TaskStatus does
// not have. Two weeks into a Tue-start job on a 5-day week it pushed Thursday's
// tasks on Monday, "3 tasks today" on a Saturday, and every finished pour
// forever. The same list fed the in-app inbox row, so muting the push did not
// remove it.
//
// The fix ports the app's rules into morning-digest/scheduleToday.ts. This
// validator EXECUTES both copies — utils/scheduleOps (the app) and the port —
// over a grid of anchors (every weekday, including a Saturday anchor), 5/6/7-
// day weeks, site closures, from ten days before the start to 120 after, and fails on
// any day the two disagree. Then it pins the digest to the port.
//
// Run: bun run scripts/validate-digest-schedule-today.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveScheduleAnchor, scheduleDayOnCalendar, isTaskActiveOnScheduleDay, isMilestoneOnScheduleDay,
} from '../utils/scheduleOps';
import { toCalendarDayString } from '../utils/calendarDate';
import type { ScheduleTask } from '../types';
import {
  todayOnSite, scheduleDayOnCalendarIso, calendarDayInZone, localHourInZone, digestGreeting,
} from '../supabase/functions/morning-digest/scheduleToday';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const T = (id: string, startDay: number, durationDays: number, over: Partial<ScheduleTask> = {}): ScheduleTask =>
  ({ id, title: id, startDay, durationDays, status: 'not_started', progress: 0, ...over } as unknown as ScheduleTask);

const TASKS: ScheduleTask[] = [
  T('d1', 1, 1), T('d1-5', 1, 5), T('d6-10', 6, 5), T('d10', 10, 1), T('d14', 14, 3), T('d19', 19, 2),
  T('done', 8, 10, { status: 'done' }), T('pct100', 8, 10, { progress: 100, status: 'in_progress' }),
  T('m12', 12, 0, { isMilestone: true }), T('long', 3, 40),
];

// ── 1. The port and the app give the same answer on every day ──────────────
console.log('\nserver port == app rule, across anchors, calendars and closures:');
{
  let days = 0, mismatches = 0, firstMiss = '';
  const anchors = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-10-30'];
  const calendars: Array<{ w: number; closed?: string[] }> = [
    { w: 5 }, { w: 6 }, { w: 7 }, { w: 5, closed: ['2026-09-07', '2026-09-16', '2026-11-26', '2026-11-27'] },
  ];
  for (const anchor of anchors) {
    for (const cal of calendars) {
      const schedule = { tasks: TASKS, startDate: anchor, workingDaysPerWeek: cal.w, nonWorkingDates: cal.closed };
      const a = resolveScheduleAnchor(schedule).date!;
      for (let off = -10; off <= 120; off++) {
        const d = new Date(a.getFullYear(), a.getMonth(), a.getDate() + off);
        const iso = toCalendarDayString(d);
        const appDay = scheduleDayOnCalendar(a, d, cal.w, cal.closed);
        const srvDay = scheduleDayOnCalendarIso(anchor, iso, cal.w, cal.closed);
        const appTasks = appDay == null ? [] : TASKS.filter(t => isTaskActiveOnScheduleDay(t, appDay)).map(t => t.id);
        const appMs = appDay == null ? [] : TASKS.filter(t => isMilestoneOnScheduleDay(t, appDay)).map(t => t.id);
        const site = todayOnSite(schedule, iso);
        const srvTasks = site.tasks.map(t => (t as ScheduleTask).id);
        const srvMs = site.milestones.map(t => (t as ScheduleTask).id);
        days++;
        if (appDay !== srvDay || appTasks.join() !== srvTasks.join() || appMs.join() !== srvMs.join()) {
          mismatches++;
          if (!firstMiss) firstMiss = `${anchor} w${cal.w} ${iso}: app day ${appDay} [${appTasks}] vs server day ${srvDay} [${srvTasks}]`;
        }
      }
    }
  }
  ok(`${days} (anchor, calendar, day) cases agree`, mismatches === 0, `${mismatches} disagree; first: ${firstMiss}`);
  // A stored ISO timestamp reads as its calendar day on both sides.
  eq('a round-tripped timestamp anchor is its calendar day',
    scheduleDayOnCalendarIso('2026-09-01T04:00:00.000Z', '2026-09-02'), 2);
}

// ── 2. The audit's repro, exactly ──────────────────────────────────────────
console.log('\nthe repro: start Tue Sep 1 2026, 5-day week:');
{
  const schedule = { tasks: TASKS, startDate: '2026-09-01', workingDaysPerWeek: 5 };
  const mon = todayOnSite(schedule, '2026-09-14');
  eq('Mon Sep 14 is working day 10 (the old code said 14)', mon.state === 'working' ? mon.dayNumber : null, 10);
  ok('…and lists day-10 work, not the day-14 task', mon.tasks.some(t => (t as ScheduleTask).id === 'd10') && !mon.tasks.some(t => (t as ScheduleTask).id === 'd14'));
  const sat = todayOnSite(schedule, '2026-09-19');
  eq('Sat Sep 19 is not a working day — no task list at all', [sat.state, sat.tasks.length], ['closed_day', 0]);
  // (The audit wrote "Thu Sep 17"; working day 14 is Fri Sep 18 — Sep 17 is day 13.)
  const fri = todayOnSite(schedule, '2026-09-18');
  ok('the day-14 task is on Fri Sep 18, where the app draws it', fri.tasks.some(t => (t as ScheduleTask).id === 'd14'));
  const wed = todayOnSite(schedule, '2026-09-09');
  ok('a task marked done is never listed', !wed.tasks.some(t => (t as ScheduleTask).id === 'done'));
  ok('a task at 100% is never listed', !wed.tasks.some(t => (t as ScheduleTask).id === 'pct100'));
  eq('before the start the job has not started (no clamp to day 1)', todayOnSite(schedule, '2026-08-28').state, 'not_started');
  eq('an undated schedule lists nothing', todayOnSite({ tasks: TASKS }, '2026-09-14').state, 'undated');
}

// ── 3. His clock, not the server's ─────────────────────────────────────────
console.log('\n"today" and the greeting are in his digest_timezone:');
{
  const at0300Utc = new Date(Date.UTC(2026, 8, 15, 3, 0, 0)); // 8 PM Mon Sep 14 in Los Angeles
  eq('an 8 PM Pacific brief is dated the Pacific day', calendarDayInZone(at0300Utc, 'America/Los_Angeles'), '2026-09-14');
  eq('…at hour 20 there', localHourInZone(at0300Utc, 'America/Los_Angeles'), 20);
  ok('…and does not say "Good morning"', !/morning/i.test(JSON.stringify(digestGreeting(20, 'Sam'))));
  ok('a 6 AM brief does', digestGreeting(6, 'Sam').title === 'Good morning, Sam.');
  eq('a bad zone falls back to the cron\'s default zone, not a throw', calendarDayInZone(at0300Utc, 'Not/AZone'), '2026-09-14');
}

// ── 4. The digest actually uses the port ───────────────────────────────────
console.log('\nmorning-digest reads today through the port:');
{
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const src = strip(readFileSync(join(ROOT, 'supabase/functions/morning-digest/index.ts'), 'utf8'));
  ok('imports todayOnSite from ./scheduleToday.ts', /import \{[\s\S]*?todayOnSite[\s\S]*?\} from '\.\/scheduleToday\.ts'/.test(src));
  ok('buildProjectBriefing builds today from todayOnSite(project.schedule, todayIso)', /const onSite = todayOnSite\(project\.schedule, todayIso\)/.test(src));
  ok('no calendar-day count against working-day tasks', !/86_400_000\)\s*\+\s*1/.test(src));
  ok('no status \'completed\' filter (TaskStatus has no such value)', !/'completed'/.test(src));
  ok('todayIso is his calendar day', /const todayIso = calendarDayInZone\(now, tz\)/.test(src));
  ok('the date label is formatted in his zone', /toLocaleDateString\('en-US', \{[^}]*timeZone: tz \}/.test(src));
  ok('the title comes from digestGreeting, not a fixed "Good morning"', /digestGreeting\(localHour, firstName\)/.test(src) && !/`Good morning/.test(src));
  ok('a closed day renders a line, not tasks', /b\.onSite\.state === 'closed_day'/.test(src));
  ok('the push badge is the unread count, not a hard-coded 1', !/badge: 1\b/.test(src) && /\.is\('read_at', null\)/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
