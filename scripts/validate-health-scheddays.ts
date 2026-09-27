// scripts/validate-health-scheddays.ts — readers that treated a WORKING-DAY
// `startDay` as a CALENDAR offset (health lane SCHEDDAYS).
//
// `ScheduleTask.startDay` is a working-day ordinal (utils/cpm.ts "THE TWO
// DAY-NUMBER SCALES"): on a Mon-Fri week from Mon 2026-03-02, working day 11 is
// Mon Mar 16 and working day 16 is Mon Mar 23. Five readers outside the engine
// added (startDay − 1) CALENDAR days instead:
//
//   LS-1  weather reschedule + Gantt weather badge + "Push them" banner —
//         checked the wrong days, pushed the job for rain on a Saturday, wrote
//         those days into the owner-facing delay log (source 'live'), and
//         compared a CALENDAR "today" with working ordinals (froze future work)
//   LS-2  the "COI expires before the sub is on site" follow-up — put the
//         sub's start too early and missed real lapses
//   LS-3  Smart Inbox "Starts today" — wrong day, could fire on a weekend
//   LS-6  Schedule Pro "Add task" — its own Mon-Fri loop (in validate-cpm §28)
//   LS-8  the schedule-ical feed — day late, calendar days, timed UTC events
//
// Every check below runs the REAL function where one exists. The shared helper
// (utils/scheduleCalendarDate.ts) is proved EQUAL to the engine's own
// converters over a sweep, so "the same way the Gantt reads it" is executed,
// not asserted.
//
// FAIL-BEFORE: SCHEDDAYS_OLD_DIR=<dir inside the worktree> points the consumer
// modules and screen sources at the 2859f55b copies (see the file list in
// `oldOr` below); the helper and the new pure files stay current, so every
// failure is a consumer still reading the old way.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  taskCalendarDate, taskCalendarDay, todayWorkingOrdinal, tasksStartingOn, scheduleCalendarOf,
  type ScheduleCalendar,
} from '../utils/scheduleCalendarDate';
import { workingOrdinalToCalendarIndex, calendarDayToDate, runCpm } from '../utils/cpm';
import { addWorkingDays } from '../utils/scheduleEngine';
import { scheduleDayNumberFor } from '../utils/scheduleOps';
import { toCalendarDayString } from '../utils/calendarDate';
import { buildScheduleIcalEvents, addWorkingDaysIso } from '../supabase/functions/schedule-ical/icsEvents';
import type { ScheduleTask, Subcontractor } from '../types';
import type { DayForecast } from '../utils/weatherService';

type WeatherRescheduleMod = typeof import('../utils/weatherReschedule');
type WeatherServiceMod = typeof import('../utils/weatherService');
type RulesMod = typeof import('../utils/followUp/rules');
type EngineMod = typeof import('../utils/followUp/engine');

const ROOT = join(__dirname, '..');
const OLD = process.env.SCHEDDAYS_OLD_DIR;
/** Current file, or its 2859f55b copy when SCHEDDAYS_OLD_DIR is set. */
function oldOr(rel: string, oldName: string): string {
  if (OLD) {
    const p = join(OLD, oldName);
    if (!existsSync(p)) throw new Error(`SCHEDDAYS_OLD_DIR is missing ${oldName}`);
    return p;
  }
  return join(ROOT, rel);
}
const readSrc = (rel: string, oldName: string) => readFileSync(oldOr(rel, oldName), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  const good = JSON.stringify(got) === JSON.stringify(want);
  if (good) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got ', JSON.stringify(got), '\n      want', JSON.stringify(want)); }
}

/** A function body from `marker` to the first `until` after it. */
function slice(src: string, marker: string, until: string): string {
  const a = src.indexOf(marker);
  if (a < 0) return '';
  const b = src.indexOf(until, a + marker.length);
  return b < 0 ? src.slice(a) : src.slice(a, b);
}

// ── fixtures ────────────────────────────────────────────────────────────────
const ISO = '2026-03-02';                          // a Monday
const START = new Date(2026, 2, 2);                // same day, local midnight
const MF: ScheduleCalendar = { startDate: ISO, workingDaysPerWeek: 5, nonWorkingDates: [] };
const ds = (d: Date | null) => (d ? d.toDateString() : 'null');
const day = (m: number, dd: number) => new Date(2026, m - 1, dd);

function fc(date: string, workable: boolean, source: DayForecast['source'] = 'live'): DayForecast {
  return {
    date, condition: workable ? 'clear' : 'rain', tempHigh: 60, tempLow: 40,
    precipChance: workable ? 0 : 80, windSpeed: 5, isWorkable: workable, icon: '', source,
  };
}
/** Every day Mar 9 → Apr 10 clear, except the `bad` ones. */
function forecast(bad: string[]): DayForecast[] {
  const out: DayForecast[] = [];
  for (let d = new Date(2026, 2, 9); d <= new Date(2026, 3, 10); d.setDate(d.getDate() + 1)) {
    const iso = toCalendarDayString(d);
    out.push(fc(iso, !bad.includes(iso)));
  }
  return out;
}
function T(id: string, startDay: number, durationDays: number, extra: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id, title: id, phase: 'General', startDay, durationDays, progress: 0, crew: '',
    dependencies: [], notes: '', status: 'not_started', ...extra,
  } as ScheduleTask;
}

/** weatherService.findWeatherRisk as it shipped at 2859f55b, verbatim — the
 *  Gantt's reading, which a call without a calendar must reproduce exactly. */
function legacyFindWeatherRisk(projectStartDate: Date, startDay: number, durationDays: number, forecasts: DayForecast[]): DayForecast | null {
  if (forecasts.length === 0) return null;
  for (let offset = 0; offset < Math.max(1, durationDays); offset++) {
    const taskDate = new Date(projectStartDate);
    taskDate.setDate(taskDate.getDate() + (startDay - 1) + offset);
    const iso = taskDate.toISOString().split('T')[0];
    const d = forecasts.find((f) => f.date === iso);
    if (d && !d.isWorkable) return d;
  }
  return null;
}

async function main() {
  const W = (await import(oldOr('utils/weatherReschedule.ts', 'weatherReschedule.ts'))) as WeatherRescheduleMod;
  const WS = (await import(oldOr('utils/weatherService.ts', 'weatherService.ts'))) as WeatherServiceMod;
  const R = (await import(oldOr('utils/followUp/rules.ts', 'followUp/rules.ts'))) as RulesMod;
  const E = (await import(oldOr('utils/followUp/engine.ts', 'followUp/engine.ts'))) as EngineMod;

  // ── 0. The helper reads a schedule the way the engine and the Gantt do ────
  console.log('\n0. scheduleCalendarDate agrees with the engine');
  {
    eq('working day 11 on Mon-Fri from Mon Mar 2 is Mon Mar 16', ds(taskCalendarDate(MF, 11)), ds(day(3, 16)));
    eq('working day 16 is Mon Mar 23', ds(taskCalendarDate(MF, 16)), ds(day(3, 23)));
    eq('offset walks WORKING days: day 14 + 2 is Mon Mar 23 (skips the weekend)', ds(taskCalendarDate(MF, 14, 2)), ds(day(3, 23)));
    eq('no start date ⇒ null (raw-day mode has no weekdays)', taskCalendarDate({ workingDaysPerWeek: 5 }, 3), null);
    eq('startDayBasis does not change the reading (the engine ignores it too)',
      taskCalendarDay({ ...MF, startDayBasis: 'workingOrdinal' }, 16), taskCalendarDay(MF, 16));
    eq('missing workingDaysPerWeek ⇒ 5 (runCpmForCalendar / Schedule Pro default)',
      taskCalendarDay({ startDate: ISO }, 16), '2026-03-23');

    let mismatches = 0; let checked = 0;
    const cals: ScheduleCalendar[] = [
      MF,
      { startDate: ISO, workingDaysPerWeek: 6, nonWorkingDates: [] },
      { startDate: ISO, workingDaysPerWeek: 7, nonWorkingDates: [] },
      { startDate: ISO, workingDaysPerWeek: 5, nonWorkingDates: ['2026-03-09', '2026-03-20', '2026-04-03'] },
      { startDate: ISO, workingDaysPerWeek: 6, nonWorkingDates: ['2026-03-14', '2026-03-16'] },
      { startDate: '2026-03-07', workingDaysPerWeek: 5, nonWorkingDates: [] }, // anchored on a Saturday
    ];
    for (const cal of cals) {
      const opts = { scheduleStartDate: cal.startDate!, workingDaysPerWeek: cal.workingDaysPerWeek!, nonWorkingDates: [...(cal.nonWorkingDates ?? [])] };
      const anchor = new Date(`${cal.startDate}T00:00:00`);
      for (let n = 1; n <= 60; n++) {
        checked++;
        const engine = calendarDayToDate(anchor, workingOrdinalToCalendarIndex(n, opts));
        const gantt = addWorkingDays(anchor, n - 1, opts.workingDaysPerWeek, opts.nonWorkingDates);
        const mine = taskCalendarDate(cal, n);
        if (ds(mine) !== ds(engine) || ds(mine) !== ds(gantt)) mismatches++;
        const ical = addWorkingDaysIso(cal.startDate!, n - 1, opts.workingDaysPerWeek, opts.nonWorkingDates);
        if (ical !== toCalendarDayString(gantt)) mismatches++;
      }
      for (let i = 0; i < 70; i++) {
        const now = new Date(anchor.getTime()); now.setDate(now.getDate() + i - 3); now.setHours(15, 30);
        if (todayWorkingOrdinal(cal, now) !== scheduleDayNumberFor(anchor, now, opts.workingDaysPerWeek, opts.nonWorkingDates)) mismatches++;
      }
    }
    eq(`taskCalendarDate == engine == addWorkingDays == the iCal walk, and todayWorkingOrdinal == scheduleDayNumberFor (${checked} ordinals, 6 calendars)`, mismatches, 0);
    // The engine's own placement of a pinned task lands where the helper says.
    const es = runCpm([T('P', 16, 3)], { scheduleStartDate: ISO, workingDaysPerWeek: 5 }).perTask.get('P')!.es;
    eq('runCpm places a startDay-16 task on the helper\'s date', calendarDayToDate(START, es).toDateString(), ds(taskCalendarDate(MF, 16)));
    eq('scheduleCalendarOf copies the four fields', scheduleCalendarOf({ startDate: ISO, workingDaysPerWeek: 6, nonWorkingDates: ['2026-03-09'], startDayBasis: 'workingOrdinal' }),
      { startDate: ISO, workingDaysPerWeek: 6, nonWorkingDates: ['2026-03-09'], startDayBasis: 'workingOrdinal' });
  }

  // ── 1. LS-1 weather reschedule ────────────────────────────────────────────
  console.log('\n1. LS-1 the weather reschedule reads working days');
  {
    // Slab at working day 11 (Mon Mar 16) for 3 days → Mar 16, 17, 18.
    const slab = () => [T('a', 11, 3, { title: 'Pour slab', isWeatherSensitive: true }), T('b', 14, 5, { title: 'Framing', dependencies: ['a'] })];
    const now = day(3, 10);

    const r1 = W.computeWeatherReschedule(slab(), START, forecast(['2026-03-12', '2026-03-14']), { now, calendar: MF });
    eq('rain Thu Mar 12 (before the pour) and Sat Mar 14 (nobody works) hit nothing', r1.impacts.find(i => i.taskId === 'a')?.badDates ?? [], []);
    eq('  …0 project slip', r1.projectSlipDays, 0);
    eq('  …and NO delay-log entry (owner evidence)', W.buildWeatherDelayLog(r1, () => 'x', '2026-03-10T00:00:00Z'), null);

    const r2 = W.computeWeatherReschedule(slab(), START, forecast(['2026-03-17']), { now, calendar: MF });
    eq('rain Tue Mar 17 (inside the pour) costs 1 WORKING day of slip', r2.projectSlipDays, 1);
    eq('  …the slab carries that one bad date', r2.impacts.find(i => i.taskId === 'a')?.badDates, ['2026-03-17']);
    const log2 = W.buildWeatherDelayLog(r2, () => 'x', '2026-03-10T00:00:00Z');
    eq('  …and the delay log records 03-17, source live', log2 ? { dates: log2.dates, source: log2.source, slip: log2.projectSlipDays } : null,
      { dates: ['2026-03-17'], source: 'live', slip: 1 });
    eq('  …framing (FS successor) moves one working day, 14 → 15', r2.tasks.find(t => t.id === 'b')?.startDay, 15);

    const r3 = W.computeWeatherReschedule(slab(), START, forecast(['2026-03-16', '2026-03-17', '2026-03-21', '2026-03-22']), { now, calendar: MF });
    eq('two working-day hits + a rained-out weekend = 2 working days of slip, weekend ignored', r3.projectSlipDays, 2);

    // "Today" on the working scale: Mon Mar 23 is working day 16, calendar day 22.
    eq('todayWorkingOrdinal(Mon Mar 23) is 16, not the calendar 22', todayWorkingOrdinal(MF, day(3, 23)), 16);
    const roof = () => [T('c', 18, 2, { title: 'Roof', isWeatherSensitive: true })];
    const r4 = W.computeWeatherReschedule(roof(), START, forecast(['2026-03-25', '2026-03-26']), { now: day(3, 23), calendar: MF });
    ok('the roof task on Wed Mar 25 (day 18) is NOT frozen on Mon Mar 23', r4.impacts.length === 1 && r4.impacts[0].badDates.length === 2, r4.impacts);
    const started = [T('d', 10, 5, { title: 'Started', isWeatherSensitive: true })];   // Fri Mar 13
    const r5 = W.computeWeatherReschedule(started, START, forecast(['2026-03-25']), { now: day(3, 23), calendar: MF });
    eq('  …while work that really started (day 10, Fri Mar 13) stays pinned', r5.impacts.length, 0);
    // An explicit todayDay still wins (it is on the startDay scale by contract).
    const r6 = W.computeWeatherReschedule(roof(), START, forecast(['2026-03-25']), { todayDay: 19, now: day(3, 23), calendar: MF });
    eq('  …and an explicit todayDay wins over now', r6.impacts.length, 0);

    // Undated schedule: raw-day mode, the engine's own reading — unchanged.
    const raw = W.computeWeatherReschedule([T('a', 11, 3, { isWeatherSensitive: true })], START, forecast(['2026-03-12']), { now, calendar: { workingDaysPerWeek: 5 } });
    eq('undated calendar ⇒ raw calendar offsets (day 11 = Mar 12), as runCpm reads it', raw.impacts[0]?.badDates, ['2026-03-12']);
  }

  // ── 2. LS-1 findWeatherRisk (the Gantt badge + banner) ────────────────────
  console.log('\n2. LS-1 findWeatherRisk');
  {
    const fSat = forecast(['2026-03-14']);
    const fTue = forecast(['2026-03-17']);
    eq('with the calendar, Sat Mar 14 rain is no risk to the Mar 16-18 pour', WS.findWeatherRisk(START, 11, 3, fSat, MF), null);
    eq('  …Tue Mar 17 rain is', WS.findWeatherRisk(START, 11, 3, fTue, MF)?.date, '2026-03-17');
    // Regression lock: NO calendar ⇒ byte-for-byte the shipped function.
    let diffs = 0; let n = 0;
    const patterns = [[], ['2026-03-12'], ['2026-03-14', '2026-03-15'], ['2026-03-17', '2026-03-25', '2026-04-01']];
    for (const bad of patterns) {
      const f = forecast(bad);
      for (let sd = 1; sd <= 30; sd++) for (let dur = 0; dur <= 6; dur++) {
        n++;
        const a = JSON.stringify(WS.findWeatherRisk(START, sd, dur, f));
        const b = JSON.stringify(legacyFindWeatherRisk(START, sd, dur, f));
        if (a !== b) diffs++;
      }
    }
    eq(`findWeatherRisk WITHOUT a calendar === the shipped function (${n} cases; the Gantt is unchanged until its patch)`, diffs, 0);
    eq('an empty forecast is still null with a calendar', WS.findWeatherRisk(START, 11, 3, [], MF), null);
  }

  // ── 3. LS-1 the "Push them" banner ────────────────────────────────────────
  console.log('\n3. LS-1 the Push-all shift is in working days');
  {
    const fn = (W as Partial<WeatherRescheduleMod>).findWeatherPushConflicts;
    ok('findWeatherPushConflicts is exported (the banner\'s logic is testable)', typeof fn === 'function');
    if (typeof fn === 'function') {
      const slab = [T('a', 11, 3, { isWeatherSensitive: true })];
      const c1 = fn(slab, forecast(['2026-03-16', '2026-03-17']), START, MF);
      eq('rain Mon+Tue on the Mon-Wed pour → push 2 working days (Wed-Fri)', c1.map(c => c.suggestedPushDays), [2]);
      const edge = [T('e', 14, 3, { isWeatherSensitive: true })];   // Thu 19, Fri 20, Mon 23
      const c2 = fn(edge, forecast(['2026-03-20']), START, MF);
      eq('rain Fri on a Thu-Fri-Mon task → push 2 working days (Mon-Wed), not 4 calendar', c2.map(c => c.suggestedPushDays), [2]);
      const pushed = c2[0] ? taskCalendarDay(MF, 14 + c2[0].suggestedPushDays) : null;
      eq('  …the pushed startDay lands on Mon Mar 23', pushed, '2026-03-23');
      eq('Saturday rain raises no conflict on a Mon-Fri job', fn(slab, forecast(['2026-03-14']), START, MF).length, 0);
      eq('a started task is not offered a push', fn([T('a', 11, 3, { isWeatherSensitive: true, progress: 10 })], forecast(['2026-03-17']), START, MF).length, 0);

      // RAW-DAY MODE (undated schedule): the push must clear exactly the risk
      // the raw findWeatherRisk reports, in any timezone.
      let rawBad = 0; let rawN = 0; let oldDiff = 0;
      const legacyPush = (sd: number, dur: number, f: DayForecast[]): number => {
        // WeatherReschedulePrompt.tsx at 2859f55b, verbatim.
        const startDate = new Date(START); startDate.setDate(startDate.getDate() + (sd - 1));
        const sd0 = new Date(startDate.toISOString().split('T')[0]);
        for (let push = 1; push <= 14; push++) {
          let all = true;
          for (let o = 0; o < dur; o++) {
            const d = new Date(sd0); d.setDate(d.getDate() + push + o);
            const x = f.find(ff => ff.date === d.toISOString().split('T')[0]);
            if (x && !x.isWorkable) { all = false; break; }
          }
          if (all) return push;
        }
        return 1;
      };
      for (const bad of [['2026-03-12'], ['2026-03-14', '2026-03-15'], ['2026-03-17', '2026-03-18', '2026-03-25']]) {
        const f = forecast(bad);
        for (let sd = 5; sd <= 26; sd++) for (let dur = 1; dur <= 4; dur++) {
          const c = fn([T('r', sd, dur, { isWeatherSensitive: true })], f, START, undefined)[0];
          if (!c) continue;
          rawN++;
          if (WS.findWeatherRisk(START, sd + c.suggestedPushDays, dur, f) !== null) rawBad++;
          if (c.suggestedPushDays !== legacyPush(sd, dur, f)) oldDiff++;
        }
      }
      ok(`raw mode: every suggested push clears the raw risk finder (${rawN} conflicts)`, rawN > 0 && rawBad === 0, { rawN, rawBad });
      if (new Date(2026, 2, 2).getTimezoneOffset() >= 0) {
        eq('raw mode: west of Greenwich the push equals the shipped walk (no behaviour change there)', oldDiff, 0);
      }
    }
    const prompt = readSrc('components/schedule/WeatherReschedulePrompt.tsx', 'WeatherReschedulePrompt.tsx');
    ok('the banner computes its conflicts through findWeatherPushConflicts with the calendar',
      /findWeatherPushConflicts\(tasks, forecasts, projectStartDate, scheduleCalendar\)/.test(prompt));
    ok('  …and no longer walks CALENDAR days from startDay itself', !/startDate\.setDate\(startDate\.getDate\(\) \+ \(task\.startDay - 1\)\)/.test(prompt));
  }

  // ── 4. LS-1 Schedule Pro wiring ───────────────────────────────────────────
  console.log('\n4. LS-1 Schedule Pro hands every weather reader the calendar');
  {
    const pro = readSrc('app/schedule-pro.tsx', 'schedule-pro.tsx');
    const open = slice(pro, 'const openWeatherReschedule = useCallback(', '}, [');
    ok('openWeatherReschedule passes the schedule calendar and the real clock',
      /calendar:\s*weatherCalendar/.test(open) && /now:\s*new Date\(\)/.test(open), open.slice(0, 400));
    ok('  …and no longer counts CALENDAR days into todayDay',
      !/Math\.floor\(\(Date\.now\(\) - projectStartDate\.getTime\(\)\) \/ 86400000\)/.test(pro));
    ok('weatherCalendar is the project schedule\'s calendar', /const weatherCalendar = useMemo\(\s*\(\) => scheduleCalendarOf\(project\?\.schedule\)/.test(pro));
    ok('the phone banner gets scheduleCalendar={weatherCalendar}', /<WeatherReschedulePrompt[\s\S]{0,400}?scheduleCalendar=\{weatherCalendar\}/.test(pro));
    ok('the desktop signals chip gets it too (weather={desktopWeatherSignal} carrying scheduleCalendar)',
      /weather=\{desktopWeatherSignal\}/.test(pro) && /const desktopWeatherSignal[\s\S]{0,500}?scheduleCalendar: weatherCalendar/.test(pro));
    // The chip path relies on ScheduleSignals spreading `weather` onto the
    // prompt. Read-only check of a file this lane does not own.
    const signals = readFileSync(join(ROOT, 'components/schedule/desktop/ScheduleSignals.tsx'), 'utf8');
    ok('  …ScheduleSignals spreads {...weather} onto WeatherReschedulePrompt', /<WeatherReschedulePrompt[^>]*\{\.\.\.weather\}/.test(signals));
    const push = slice(pro, 'const handleWeatherPush = useCallback(', '}, [commit]);');
    ok('handleWeatherPush adds the (working-day) delta to startDay, rounded', /Math\.round\(t\.startDay \+ p\.deltaDays\)/.test(push));
  }

  // ── 5. LS-2 COI before the sub is on site ─────────────────────────────────
  console.log('\n5. LS-2 the COI follow-up dates the sub\'s start on working days');
  {
    const sub = (coiExpiry: string) => ({ id: 's1', companyName: 'Sparks LLC', contactName: 'Sal', coiExpiry } as unknown as Subcontractor);
    const ctx = (coiExpiry: string, extra: Record<string, unknown> = {}) => ({
      nowMs: new Date(2026, 2, 5, 12).getTime(), projectId: 'p1', projectName: 'Henderson',
      scheduleStartDate: ISO, scheduleCalendar: { workingDaysPerWeek: 5, nonWorkingDates: [] },
      tasks: [T('t', 16, 5, { title: 'Electrical rough', assignedSubId: 's1' })],
      subcontractors: [sub(coiExpiry)],
      ...extra,
    }) as unknown as import('../utils/followUp/engine').FollowUpContext;

    const minted = R.coiExpiresBeforeSubIsOnSite.mint(ctx('2026-03-20'));
    eq('COI expiring Fri Mar 20, sub on site working day 16 (Mon Mar 23) → 1 follow-up', minted.length, 1);
    ok('  …evidence and nudge say Mon Mar 23', minted[0]?.evidence.some(e => /starts 2026-03-23/.test(e.says)) === true && /2026-03-23/.test(minted[0]?.nudge ?? ''), minted[0]?.evidence);
    ok('  …the title counts 3 days (Fri → Mon)', /expires 3 days before/.test(minted[0]?.title ?? ''), minted[0]?.title);
    ok('  …closed() does NOT resolve the lapse', !R.coiExpiresBeforeSubIsOnSite.closed(ctx('2026-03-20')).includes('coi_expires_before_sub_is_on_site:subcontractor:s1'));
    eq('COI expiring Mon Mar 23 (the start day) → 0', R.coiExpiresBeforeSubIsOnSite.mint(ctx('2026-03-23')).length, 0);
    eq('COI expiring Mon Mar 30 → 0', R.coiExpiresBeforeSubIsOnSite.mint(ctx('2026-03-30')).length, 0);
    ok('  …and closed() resolves those', R.coiExpiresBeforeSubIsOnSite.closed(ctx('2026-03-23')).includes('coi_expires_before_sub_is_on_site:subcontractor:s1'));
    // A closure on Mon Mar 23 moves the start to Tue Mar 24 — the calendar is read.
    const closed = R.coiExpiresBeforeSubIsOnSite.mint(ctx('2026-03-23', { scheduleCalendar: { workingDaysPerWeek: 5, nonWorkingDates: ['2026-03-23'] } }));
    ok('a Mon Mar 23 site closure moves the start to Tue Mar 24, so a Mar 23 expiry now lapses',
      closed.length === 1 && closed[0].evidence.some(e => /starts 2026-03-24/.test(e.says)), closed[0]?.evidence);
    // Through the engine: the calendar is NOT a read — omitting it never refuses.
    const run = E.runFollowUpRules([R.coiExpiresBeforeSubIsOnSite], ctx('2026-03-20', { scheduleCalendar: undefined }));
    eq('omitting scheduleCalendar still runs the rule (5-day default), no refusal', { ran: run.ranRuleIds.length, refused: run.refusals.length, items: run.items.length }, { ran: 1, refused: 0, items: 1 });
    const undated = E.runFollowUpRules([R.coiExpiresBeforeSubIsOnSite], ctx('2026-03-20', { scheduleStartDate: undefined, scheduleCalendar: { startDate: ISO, workingDaysPerWeek: 5 } }));
    eq('an undated schedule still refuses on scheduleStartDate (the calendar\'s own startDate cannot bypass it)',
      { items: undated.items.length, missing: undated.refusals[0]?.missing }, { items: 0, missing: ['scheduleStartDate'] });
    eq('  …and mint() itself refuses too (no date from the calendar object)',
      R.coiExpiresBeforeSubIsOnSite.mint(ctx('2026-03-20', { scheduleStartDate: undefined, scheduleCalendar: { startDate: ISO, workingDaysPerWeek: 5 } })).length, 0);
    const stray = R.coiExpiresBeforeSubIsOnSite.mint(ctx('2026-03-20', { scheduleCalendar: { startDate: '2026-01-05', workingDaysPerWeek: 5 } }));
    ok('the anchor is scheduleStartDate even when the calendar object carries another startDate',
      stray.length === 1 && stray[0].evidence.some(e => /starts 2026-03-23/.test(e.says)), stray[0]?.evidence);
    const waiting = readSrc('app/waiting-on.tsx', 'waiting-on.tsx');
    ok('/waiting-on fills scheduleCalendar from the project schedule', /scheduleCalendar:\s*scheduleCalendarOf\(p\.schedule\)/.test(waiting));
  }

  // ── 6. LS-3 Smart Inbox "Starts today" ────────────────────────────────────
  console.log('\n6. LS-3 Smart Inbox "Starts today"');
  {
    const tasks = [T('t16', 16, 3)];
    eq('working day 16 starts on Mon Mar 23', tasksStartingOn(MF, tasks, day(3, 23)).map(x => x.task.id), ['t16']);
    eq('  …not on Tue Mar 17 (the old calendar-offset day)', tasksStartingOn(MF, tasks, day(3, 17)).length, 0);
    let firedOn: string[] = []; let weekendFires = 0;
    const many = Array.from({ length: 45 }, (_, i) => T(`o${i + 1}`, i + 1, 2));
    for (let d = new Date(2026, 1, 25); d <= new Date(2026, 4, 15); d.setDate(d.getDate() + 1)) {
      const hits = tasksStartingOn(MF, many, new Date(d.getTime()));
      if ((d.getDay() === 0 || d.getDay() === 6) && hits.length > 0) weekendFires++;
      if (tasksStartingOn(MF, tasks, new Date(d.getTime())).length > 0) firedOn.push(toCalendarDayString(d));
    }
    eq('over Feb 25 → May 15, ordinal 16 fires on exactly one day, Mar 23', firedOn, ['2026-03-23']);
    eq('  …and none of 45 ordinals ever fires on a Saturday or Sunday', weekendFires, 0);
    eq('a started task is not "starting today"', tasksStartingOn(MF, [T('x', 16, 3, { status: 'in_progress' })], day(3, 23)).length, 0);
    eq('an undated schedule fires nothing', tasksStartingOn({ workingDaysPerWeek: 5 }, tasks, day(3, 17)).length, 0);
    const hook = readSrc('hooks/useSmartInbox.ts', 'useSmartInbox.ts');
    ok('useSmartInbox uses tasksStartingOn with the schedule\'s calendar', /tasksStartingOn\(scheduleCalendarOf\(schedule\)/.test(hook));
    ok('  …and the calendar-offset formula is gone', !/\(task\.startDay - 1\) \* MS_PER_DAY/.test(hook));
  }

  // ── 7. LS-8 schedule-ical feed ────────────────────────────────────────────
  console.log('\n7. LS-8 the schedule-ical feed');
  {
    const sched = (tasks: object[], extra: object = {}) => ({ startDate: ISO, workingDaysPerWeek: 5, nonWorkingDates: [], tasks, ...extra });
    const ev = (tasks: object[], extra: object = {}) => buildScheduleIcalEvents('p1', sched(tasks, extra) as never, new Date(Date.UTC(2026, 2, 1, 9)));
    const field = (e: string, k: string) => (e.split('\r\n').find(l => l.startsWith(k)) ?? '').slice(k.length);
    const e1 = ev([{ id: 'a', title: 'Mobilize', startDay: 1, durationDays: 1 }])[0] ?? '';
    eq('working day 1 → DTSTART;VALUE=DATE:20260302', field(e1, 'DTSTART;VALUE=DATE:'), '20260302');
    eq('  …DTEND is exclusive, the next day', field(e1, 'DTEND;VALUE=DATE:'), '20260303');
    const e16 = ev([{ id: 'b', title: 'Rough', startDay: 16, durationDays: 1 }])[0] ?? '';
    eq('working day 16 → 20260323 (was the evening of Tue Mar 17)', field(e16, 'DTSTART;VALUE=DATE:'), '20260323');
    eq('  …DTEND 20260324', field(e16, 'DTEND;VALUE=DATE:'), '20260324');
    const span = ev([{ id: 'c', title: 'Span', startDay: 14, durationDays: 3 }])[0] ?? '';
    eq('a 3-day task from Thu Mar 19 ends Mon Mar 23 → DTEND 20260324 (weekend not counted)',
      [field(span, 'DTSTART;VALUE=DATE:'), field(span, 'DTEND;VALUE=DATE:')], ['20260319', '20260324']);
    const clo = ev([{ id: 'd', title: 'Closed', startDay: 6, durationDays: 1 }], { nonWorkingDates: ['2026-03-09'] })[0] ?? '';
    eq('a Mon Mar 9 closure moves working day 6 to Tue Mar 10', field(clo, 'DTSTART;VALUE=DATE:'), '20260310');
    const ms = ev([{ id: 'm', title: 'Topping out', startDay: 16, durationDays: 0, isMilestone: true }])[0] ?? '';
    eq('a milestone is one all-day event', [field(ms, 'DTSTART;VALUE=DATE:'), field(ms, 'DTEND;VALUE=DATE:')], ['20260323', '20260324']);
    ok('no event is a timed UTC DTSTART', !/\nDTSTART:\d{8}T/.test([e1, e16, span, clo, ms].join('\n')));
    eq('no start date ⇒ no task events (no plan anchored on "today")', buildScheduleIcalEvents('p1', { tasks: [{ id: 'a', title: 'x', startDay: 1 }] } as never, new Date()).length, 0);
    ok('text fields are escaped', /SUMMARY:A\\, B\\; C/.test(ev([{ id: 'x', title: 'A, B; C', startDay: 1, durationDays: 1 }])[0] ?? ''));
    const idx = readSrc('supabase/functions/schedule-ical/index.ts', 'schedule-ical-index.ts');
    ok('index.ts builds its events with buildScheduleIcalEvents from ./icsEvents.ts',
      /from '\.\/icsEvents\.ts'/.test(idx) && /buildScheduleIcalEvents\(project\.id,/.test(idx));
    ok('  …and has no calendar-day millisecond date math left', !/\* 86_400_000/.test(idx) && !/DTSTART:\$\{/.test(idx));
    ok('  …auth untouched: secret fail-closed, constant-time token check, owner check',
      /SCHEDULE_ICAL_SECRET is not configured/.test(idx) && /constantTimeEq\(expected, token\)/.test(idx) && /project\.user_id !== userId/.test(idx));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
