// scripts/validate-schedule-scale-actuals.ts
//
// Audit #50 + #141 — ONE scale for actualStartDay / actualEndDay, and no
// invented start.
//
// #50. The foreman closed a task from his phone (the status sink stamps
// todayScheduleDay, a CALENDAR index) and the GC's Schedule Pro read the same
// field as a WORKING ordinal: on a 5-day week, six weeks in, an on-time finish
// read "+10d late" in red and the as-built bar sat two weeks right. Decided:
// calendar is the one scale (utils/pace/stampActuals.ts header has why). This
// pins, on a 5-day calendar anchored on a Monday:
//   • the status path and the Gantt's Finish-today button stamp the SAME
//     actualEndDay for the same day;
//   • the badge reads 'on time' when the finish is the planned day, and counts
//     working days (a Friday plan finished Monday is +1, not +3);
//   • reflowFromActuals and the Gantt read calendar actuals as calendar.
// #141. A finish with no recorded start never stamps an ISO date for a start
// nobody saw, and the phone / Pro / tab status paths do not back-fill one.
//
// Pure functions run for real; the screen wiring is pinned by source.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  stampActuals, todayScheduleDay, ganttLogFinishPatch, ganttLogStartPatch, asBuiltVariance,
} from '../utils/pace/stampActuals';
import { runCpm, calendarDayToDate, calendarIndexToWorkingOrdinal } from '../utils/cpm';
import { reflowFromActuals, exportTasksToCsv } from '../utils/scheduleOps';
import { parseCalendarDay } from '../utils/calendarDate';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ''}`); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const START = '2026-03-02';   // a Monday
const CAL = { scheduleStartDate: START, workingDaysPerWeek: 5, nonWorkingDates: [] as string[] };
const NOW = '2026-04-10T19:00:00.000Z';
const T = (id: string, startDay: number, dur: number, deps: string[] = []): ScheduleTask => ({
  id, title: id, phase: 'General', startDay, durationDays: dur, progress: 0, crew: '',
  dependencies: deps, notes: '', status: 'not_started',
} as ScheduleTask);

// Foundation 10 → Framing 10 → Drywall 5 — Framing ends in week 4, Drywall in week 5.
const tasks = [T('A', 1, 10), T('B', 11, 10, ['A']), T('C', 21, 5, ['B'])];
const cpm = runCpm(tasks, CAL);
const base = parseCalendarDay(START)!;
const noonOf = (calendarIndex: number) => { const d = calendarDayToDate(base, calendarIndex); d.setHours(12); return d; };
const toOrd = (c: number) => calendarIndexToWorkingOrdinal(c, CAL);

console.log('\n#50 one scale — the status path and the Gantt button agree:');
{
  const b = cpm.perTask.get('B')!;
  const finishDay = noonOf(b.ef);
  const today = todayScheduleDay(START, finishDay)!;
  eq('todayScheduleDay on the planned finish date is the engine ef (calendar)', today, b.ef);
  const phone = stampActuals({ ...tasks[1], status: 'in_progress', actualStartDay: b.es }, 'done', today, NOW, { retroStartFromPlanned: false });
  const gantt = ganttLogFinishPatch(todayScheduleDay(START, finishDay)!, NOW);
  eq('status sink and Finish-today stamp the SAME actualEndDay', phone.actualEndDay, gantt.actualEndDay);
  eq('...and Start-today stamps the same basis', ganttLogStartPatch(tasks[1], today, NOW).actualStartDay, today);
  ok('the fixture really crosses weekends (calendar ef ≠ ordinal end)', b.ef !== toOrd(b.ef), { ef: b.ef, ord: toOrd(b.ef) });

  const planStart = toOrd(b.es), planEnd = toOrd(b.ef);
  const v = asBuiltVariance({ actualStartDay: b.es, actualEndDay: phone.actualEndDay }, planStart, planEnd, CAL);
  eq('the badge reads on time for a phone finish on the planned day', v?.label, 'on time');
  // The pre-fix badge: the raw calendar actual minus the ordinal plan.
  ok('...where the old subtraction read it as days late', (phone.actualEndDay! - planEnd) > 0, phone.actualEndDay! - planEnd);

  const c = cpm.perTask.get('C')!;
  const cv = asBuiltVariance({ actualStartDay: c.es, actualEndDay: c.ef }, toOrd(c.es), toOrd(c.ef), CAL);
  eq('six weeks in, still on time (the error used to grow per weekend)', cv?.label, 'on time');

  // A Friday planned finish closed the following Monday is ONE working day late.
  const friEf = c.ef;  // Drywall: 5 days from a Monday ends on a Friday
  eq('fixture: Drywall ends on a Friday', calendarDayToDate(base, friEf).getDay(), 5);
  const late = asBuiltVariance({ actualStartDay: c.es, actualEndDay: friEf + 3 }, toOrd(c.es), toOrd(friEf), CAL);
  eq('Friday plan, Monday finish = +1d late (working days, not +3)', late?.label, '+1d late');
  const early = asBuiltVariance({ actualStartDay: c.es, actualEndDay: friEf - 1 }, toOrd(c.es), toOrd(friEf), CAL);
  eq('a day early reads -1d early', early?.label, '-1d early');
  eq('a started-only task compares its start', asBuiltVariance({ actualStartDay: c.es }, toOrd(c.es), toOrd(c.ef), CAL)?.label, 'started on time');
}

console.log('\n#50 readers take calendar actuals:');
{
  const b = cpm.perTask.get('B')!;
  // Framing ran exactly to plan (calendar actuals): Drywall must not move.
  const onPlan = tasks.map(t => t.id === 'B' ? { ...t, status: 'done' as const, actualStartDay: b.es, actualEndDay: b.ef } : t);
  eq('reflowFromActuals: an on-plan calendar finish moves nothing', reflowFromActuals(onPlan, CAL).find(t => t.id === 'C')!.startDay, 21);
  // Two working days late (Framing ends Fri → closed the next Tue).
  const late = tasks.map(t => t.id === 'B' ? { ...t, status: 'done' as const, actualStartDay: b.es, actualEndDay: b.ef + 4 } : t);
  eq('...a finish 2 working days late pushes Drywall 2 working days', reflowFromActuals(late, CAL).find(t => t.id === 'C')!.startDay, 23);
}

console.log('\n#141 no invented start:');
{
  const today = 40;
  const status = stampActuals({ status: 'not_started', startDay: 11 }, 'done', today, NOW, { retroStartFromPlanned: false });
  eq('status paths: done from not started stamps the finish only', status, { actualEndDay: today, actualEndDate: NOW });
  const retro = stampActuals({ status: 'not_started', startDay: 11 }, 'done', today, NOW, { calendar: CAL });
  ok('the documented retro start never writes an ISO date', !('actualStartDate' in retro), retro);
  eq('...and converts the planned ordinal to the calendar field (ordinal 11 = Mon Mar 16 = day 15)', retro.actualStartDay, 15);
  const g = ganttLogFinishPatch(today, NOW);
  ok('Finish-today back-fills no start at all', !('actualStartDay' in g) && !('actualStartDate' in g), g);
}

console.log('\nundated schedule — one rule for every writer:');
{
  // todayScheduleDay has no day 1 to count from on an undated plan.
  eq('todayScheduleDay(undefined) is null', todayScheduleDay(undefined), null);
  const sink = stampActuals({ status: 'in_progress', startDay: 3 }, 'done', null, NOW, { retroStartFromPlanned: false });
  const fin = ganttLogFinishPatch(todayScheduleDay(undefined), NOW);
  const st = ganttLogStartPatch({ status: 'not_started' }, todayScheduleDay(undefined), NOW);
  ok('status sink: ISO date only, no day number', !('actualEndDay' in sink) && sink.actualEndDate === NOW, sink);
  ok('Finish today: ISO date only, no day number (same as the sink)', !('actualEndDay' in fin) && fin.actualEndDate === NOW && fin.status === 'done', fin);
  ok('Start today: ISO date only, no day number', !('actualStartDay' in st) && st.actualStartDate === NOW && st.status === 'in_progress', st);
}

console.log('\nundated Schedule Pro — the Gantt counts from the schedule, not the display start (review r2):');
{
  // The reviewer's replay. Project created Mon 2026-08-03, schedule has NO
  // startDate, today is 2026-09-18. Schedule Pro's projectStartDate (and so the
  // Gantt's dayScale, and the scheduler context's schedule.startDate) are
  // back-filled with createdAt; Reflow from actuals runs on summaryScale, whose
  // anchor is the REAL (absent) startDate.
  const now = new Date(2026, 8, 18, 12);
  const createdAtDisplayStart = '2026-08-03';
  const realStart: string | undefined = undefined;
  const reflowScale = { scheduleStartDate: realStart, workingDaysPerWeek: 5 };
  const a = { ...T('a', 35, 5), status: 'not_started' } as ScheduleTask;
  const b = T('b', 40, 5, ['a']);
  const startedToday = (basis: string | undefined) =>
    ({ ...a, ...ganttLogStartPatch(a, todayScheduleDay(basis, now), now.toISOString()) }) as ScheduleTask;

  // The old basis, shown so the harm is on record: 47 calendar days since
  // createdAt, read back by the reflow as working ordinal 47.
  const bad = startedToday(createdAtDisplayStart);
  eq('display-start basis stamps calendar day 47 (the bug)', bad.actualStartDay, 47);
  ok('...and the reflow pushes b from 40 to 52 on a task that started on plan',
    reflowFromActuals([bad, b], reflowScale).find(t => t.id === 'b')!.startDay === 52);

  const good = startedToday(realStart);
  ok('the real basis stamps the date only', good.actualStartDay === undefined && good.actualStartDate === now.toISOString() && good.status === 'in_progress', good);
  eq('Reflow from actuals after Gantt Start-today leaves the successor unmoved', reflowFromActuals([good, b], reflowScale).find(t => t.id === 'b')!.startDay, 40);

  // The wiring that decides which basis the real Gantt uses.
  const gantt = src('components/schedule/InteractiveGantt.tsx');
  ok('Gantt stamps on todayScheduleDay(stampBasis), never on dayScale (display start)',
    /\(\) => todayScheduleDay\(stampBasis\),/.test(gantt) && !/todayScheduleDay\(dayScale/.test(gantt));
  ok('stampBasis = the scheduleStartDate prop, else the GanttStampBasis provider (default: none)',
    /export const GanttStampBasis = createContext<string \| undefined>\(undefined\);/.test(gantt)
    && /const providedBasis = useContext\(GanttStampBasis\);/.test(gantt)
    && /const stampBasis = props\.scheduleStartDate !== undefined\s*\?\s*\(props\.scheduleStartDate \?\? undefined\)\s*:\s*providedBasis;/.test(gantt));
  const pro = src('app/schedule-pro.tsx');
  ok('Schedule Pro provides the REAL schedule.startDate around the tab shell (not projectStartDate)',
    /const scheduleStartIso = project\?\.schedule\?\.startDate;/.test(pro)
    && /<GanttStampBasis\.Provider value=\{scheduleStartIso\}>\s*<SchedulerTabShell/.test(pro)
    && /onBulkAskAI=\{handleBulkAskAI\}\s*\/>\s*<\/GanttStampBasis\.Provider>/.test(pro));
}

console.log('\nFinish today on an unstarted, late task still reflows (review r3):');
{
  // The reviewer's replay. Schedule Mon 2026-08-03, 5-day week, now
  // 2026-09-18 = calendar day 47 = working ordinal 35. Framing planned on
  // ordinals 26-30; Drywall FS after it at 31. #141 means Finish today stamps
  // the end ALONE (no invented start) — that record must still ground the
  // reflow, or the GC is told "nothing to reflow" about a 5-day-late finish.
  const cal = { scheduleStartDate: '2026-08-03', workingDaysPerWeek: 5, nonWorkingDates: [] as string[] };
  const now = new Date(2026, 8, 18, 12);
  const day = todayScheduleDay(cal.scheduleStartDate, now)!;
  eq('today is calendar day 47', day, 47);
  eq('...which is working ordinal 35', calendarIndexToWorkingOrdinal(day, cal), 35);
  const framing = { ...T('F', 26, 5), status: 'in_progress' } as ScheduleTask;
  const drywall = T('D', 31, 5, ['F']);
  const finished = { ...framing, ...ganttLogFinishPatch(day, now.toISOString()) } as ScheduleTask;
  ok('Finish today stamps the end only (no invented start)', finished.actualStartDay == null && finished.actualEndDay === 47, finished);
  const pro = src('app/schedule-pro.tsx');
  const gate = pro.match(/const withActuals = workingTasks\.filter\((t => [^;]*)\);/);
  ok('handleReflow counts a start OR a finish', !!gate, gate?.[1]);
  // eslint-disable-next-line no-new-func
  const filter = gate ? (new Function(`return (${gate[1]})`)() as (t: ScheduleTask) => boolean) : () => false;
  eq("handleReflow's gate is non-empty after Finish today", [finished, drywall].filter(filter).length, 1);
  ok("the empty-state copy says 'actual start or finish'", /No tasks have an actual start or finish logged yet/.test(pro));
  const out = reflowFromActuals([finished, drywall], cal);
  eq('reflow pushes the FS successor 31 → 36', out.find(t => t.id === 'D')!.startDay, 36);
  eq('...and leaves the finished task itself where it was planned', out.find(t => t.id === 'F')!.startDay, 26);
  eq('a finish-only record reflows the same as start+finish when the start was on plan',
    reflowFromActuals([{ ...finished, actualStartDay: 36 } as ScheduleTask, drywall], cal).find(t => t.id === 'D')!.startDay, 36);
  // An EARLY finish never pulls Drywall earlier.
  const early = { ...framing, ...ganttLogFinishPatch(30, now.toISOString()) } as ScheduleTask; // cal 30 = ord 22
  eq('an early finish does not pull the successor earlier', reflowFromActuals([early, drywall], cal).find(t => t.id === 'D')!.startDay, 31);
  // A finish-only task is itself pinned: a late predecessor does not move it.
  const pred = { ...T('P', 20, 3), actualStartDay: 40, actualEndDay: 45 } as unknown as ScheduleTask;
  const finishedAfterPred = { ...finished, dependencies: ['P'] } as ScheduleTask;
  eq('a finish-only task is not moved by the cascade', reflowFromActuals([pred, finishedAfterPred], cal).find(t => t.id === 'F')!.startDay, 26);
}

console.log('\nCSV names the actuals scale:');
{
  const t = { id: 'x', title: 'Framing', phase: 'General', startDay: 5, durationDays: 1, progress: 100, crew: '',
    dependencies: [], notes: '', status: 'done', actualStartDay: 5, actualEndDay: 7 } as unknown as ScheduleTask;
  const csv = exportTasksToCsv([t], parseCalendarDay(START)!, 5);
  const [h, r] = csv.split('\n').map(l => l.split(','));
  const cell = (n: string) => r[h.indexOf(n)];
  ok('no bare "Actual start"/"Actual end" header', !h.includes('Actual start') && !h.includes('Actual end'), h);
  eq('calendar day 5 on a Monday anchor is Friday', [cell('Actual start (calendar day)'), cell('Actual start date')], ['5', '2026-03-06']);
  eq('calendar day 7 is Sunday (every calendar day counts, not working day 7)', cell('Actual end date'), '2026-03-08');
  const undated = { ...t, actualStartDay: undefined, actualEndDay: undefined, actualEndDate: '2026-03-10T15:00:00.000Z' } as unknown as ScheduleTask;
  const [h2, r2] = exportTasksToCsv([undated], parseCalendarDay(START)!, 5).split('\n').map(l => l.split(','));
  eq('an ISO-only stamp still shows its date', [r2[h2.indexOf('Actual end (calendar day)')], r2[h2.indexOf('Actual end date')]], ['', '2026-03-10']);
}

console.log('\nwiring:');
{
  const sinks: [string, RegExp][] = [
    ['components/schedule/mobile/MobileScheduleScreen.tsx', /stampActuals\(prev, next\.status, todayScheduleDay\(activeSchedule\?\.startDate\), new Date\(\)\.toISOString\(\), \{ retroStartFromPlanned: false \}\)/],
    ['app/schedule-pro.tsx', /stampActuals\(before, patch\.status, todayScheduleDay\(startDateRef\.current\), new Date\(\)\.toISOString\(\), \{ retroStartFromPlanned: false \}\)/],
    ['app/(tabs)/schedule/index.tsx', /stampActuals\(\{ \.\.\.item, startDay: updated\.startDay \}, draft\.status, todayScheduleDay\(activeSchedule\?\.startDate\), new Date\(\)\.toISOString\(\), \{ retroStartFromPlanned: false \}\)/],
    ['app/(tabs)/schedule/index.tsx', /stampActuals\(item, nextStatus, todayScheduleDay\(activeSchedule\?\.startDate\), new Date\(\)\.toISOString\(\), \{ retroStartFromPlanned: false \}\)/],
  ];
  for (const [f, re] of sinks) ok(`${f}: status sink stamps today's calendar day with no retro start`, re.test(src(f)));
  const gantt = src('components/schedule/InteractiveGantt.tsx');
  ok('Gantt buttons stamp through stampActuals on todayScheduleDay, with no display-start fallback',
    /\(\) => todayScheduleDay\(stampBasis\),/.test(gantt)
    && !/todayScheduleDay\(stampBasis\) \?\?/.test(gantt)
    && /ganttLogStartPatch\(task, stampDay\(\)/.test(gantt) && /ganttLogFinishPatch\(stampDay\(\)/.test(gantt)
    && !/todayOrdinal/.test(gantt));
  ok('Gantt overlay draws actuals on the axis unconverted',
    /const aStart = bar\.task\.actualStartDay;/.test(gantt) && /const aEnd = bar\.task\.actualEndDay \?\? todayDayNumber;/.test(gantt)
    && !/toCal\(aStartOrd\)|toCal\(bar\.task\.actualEndDay\)/.test(gantt));
  ok('Gantt badge goes through asBuiltVariance (converts before subtracting)',
    /asBuiltVariance\(bar\.task, baseStart, baseEnd, dayScale\)/.test(gantt) && !/const v = aEnd - baseEnd;/.test(gantt));
  ok('Schedule Pro reflows with the schedule calendar', /reflowFromActuals\(workingTasks, summaryScale\)/.test(src('app/schedule-pro.tsx')));
  ok('the AI as-built parser does not back-fill a planned start', !/patch\.actualStartDay = t\.startDay/.test(src('utils/scheduleAI.ts')));
  ok('gradeDelayRipple converts the calendar finish before comparing with ordinal plans',
    /const actualDelta = actualEndOrdinal - plannedEndDay;/.test(src('utils/brain/gradePredictions.ts')));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
