// validate-time-clock-payroll.ts — the payroll export, the missed clock-out,
// live net hours and the offline-safe pull rule (wave-3 workflow audit).
//
//   #64 the export dumped every shift ever logged (each week repaid the last),
//       with crew still on the clock at 0.00 h. Now: one pay period, one job or
//       all, finished shifts only, the open ones named and left out.
//   #68 on a phone it went out as message text, on the web as a clipboard paste
//       promised to "QuickBooks". Now: a real .csv file, both platforms.
//   #63 crew his foreman clocked on HIS jobs were counted in Job Costing and
//       nowhere on Time Tracking. Now listed ("Logged by …"), exported in a
//       Logged by column, closed only through the owner's own writer.
//   #66 a forgotten clock-out stayed On Site for days and booked every elapsed
//       hour. Now flagged, left out of On Site, closed at the real out time.
//   #67 an offline clock-out was put back "on the clock" by a pull that beat
//       the flush. Now local wins while a write is queued.
//   #151 corrected hours beside unchanged stamps — flagged "Adjusted".
//   #152 the timer counted breaks; Hours Today read 0.0 with a crew working.
//   #155 no project meant an 'unassigned' row the server refuses.
//
// Pure helpers are exercised directly; screen wiring is pinned by source.
// Run via: bun run scripts/validate-time-clock-payroll.ts

process.env.TZ = 'America/Los_Angeles';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { TimeEntry } from '../types';
import * as P from '../utils/timeClockPayroll';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}
function expect<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const H = '11111111-1111-4111-8111-111111111111';
const OAK = '22222222-2222-4222-8222-222222222222';
/** A local wall-clock instant on a Pacific day. */
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00`).toISOString();
function shift(over: Partial<TimeEntry>): TimeEntry {
  return {
    id: 'x', projectId: H, projectName: 'Henderson', workerId: 'w-jose', workerName: 'Jose', trade: 'Framing',
    clockIn: at('2026-09-15', '07:00'), clockOut: at('2026-09-15', '15:30'), breakMinutes: 30,
    totalHours: 8, overtimeHours: 0, status: 'clocked_out', date: '2026-09-15', ...over,
  };
}

console.log('\n#64 one pay period, finished shifts only:');
{
  // Week starting Monday; today Thursday Sep 17 2026.
  expect('this pay week', P.payWeekRange('2026-09-17', 1, 0), { start: '2026-09-14', end: '2026-09-20' });
  expect('last week is one tap away', P.payWeekRange('2026-09-17', 1, -1), { start: '2026-09-07', end: '2026-09-13' });
  expect('a Sunday-start week', P.payWeekRange('2026-09-17', 0, 0), { start: '2026-09-13', end: '2026-09-19' });
  const entries: TimeEntry[] = [
    shift({ id: 'last-week', clockIn: at('2026-09-11', '07:00'), clockOut: at('2026-09-11', '15:30') }),
    shift({ id: 'mon', clockIn: at('2026-09-14', '07:00'), clockOut: at('2026-09-14', '15:30') }),
    // 5:15 pm Thursday Pacific = Friday in UTC — still Thursday's shift.
    shift({ id: 'thu-eve', clockIn: at('2026-09-17', '17:15'), clockOut: at('2026-09-17', '20:15'), date: '2026-09-18' }),
    shift({ id: 'oak', projectId: OAK, projectName: 'Oak St', clockIn: at('2026-09-15', '07:00') }),
    shift({ id: 'open-mike', workerName: 'Mike', status: 'clocked_in', clockOut: undefined, totalHours: 0, clockIn: at('2026-09-17', '07:00') }),
  ];
  const sel = P.selectPayrollEntries(entries, '2026-09-14', '2026-09-20');
  expect('finished shifts in the week only — last week is not repaid', sel.rows.map(e => e.id), ['mon', 'oak', 'thu-eve']);
  expect('open shifts come back separately, never as 0.00 h rows', sel.open.map(e => e.id), ['open-mike']);
  expect('the job filter', P.selectPayrollEntries(entries, '2026-09-14', '2026-09-20', { projectId: OAK }).rows.map(e => e.id), ['oak']);
  expect('open note names them', P.openShiftsNote(sel.open), '1 crew still on the clock (Mike) — not included');
  const period = { start: '2026-09-14', end: '2026-09-20' };
  expect('file name carries the period, no locale slashes', P.payrollFileName(period, 'Henderson Rd #2'), 'time-entries-2026-09-14-to-2026-09-20-henderson-rd-2.csv');
  expect('title carries the period', P.payrollTitle(period, null), 'Time entries 2026-09-14 to 2026-09-20');
  ok('a period with only open shifts says so', /still on the clock\. Clock them out first/.test(P.payrollBlockedReason({ rows: [], open: sel.open }, period) ?? ''));
  ok('an empty period says so', /No finished shifts between 2026-09-14 and 2026-09-20/.test(P.payrollBlockedReason({ rows: [], open: [] }, period) ?? ''));
  ok('a period with rows is not blocked', P.payrollBlockedReason(sel, period) === null);
}

console.log('\n#65/#151/#63 the CSV:');
{
  const rule = { weeklyThreshold: 40, dailyThreshold: null, weekStartsOn: 1 as const };
  const rows: P.PayrollRow[] = [
    shift({ id: 'a', clockIn: at('2026-09-07', '07:00'), clockOut: at('2026-09-07', '18:00'), breakMinutes: 30, totalHours: 9.5 }),
    { ...shift({ id: 'team', workerId: 'w-ana', workerName: 'Ana', clockIn: at('2026-09-08', '07:00'), clockOut: at('2026-09-08', '15:30') }), loggedByLabel: 'mike@crew.test' },
  ];
  const csv = P.buildTimeEntriesCSV(rows, rule);
  const [head, r1, r2] = csv.split('\n');
  ok('the Overtime header names the rule', head.includes('Overtime (weekly >40)'), head);
  ok('Adjusted names the punched hours when a correction changed them (stamps kept)',
    (r1 ?? '').includes('Adjusted (punched 10.50)') && (r1 ?? '').includes('2026-09-07 18:00'), r1);
  ok('an untouched row is not flagged', !(r2 ?? '').includes('Adjusted'), r2);
  ok('a team row names who logged it; own rows leave it blank',
    (r2 ?? '').includes('mike@crew.test') && (r1 ?? '').split(',')[11] === '', `${r1}\n${r2}`);
  // A legacy row filed under no real job (#155) never reached the server —
  // the file must say so, as the screen does (reviewer, round 1).
  const legacy = P.buildTimeEntriesCSV([shift({ id: 'u', projectId: 'unassigned', projectName: 'Unassigned' })], rule).split('\n')[1] ?? '';
  ok('a not-synced legacy row is marked in the Logged by column', legacy.split(',')[11] === 'Not synced \u2014 this device only', legacy);
  ok('…and a synced own row stays blank there', P.payrollLoggedByCell(shift({ id: 's' })) === '');
  const many: TimeEntry[] = [0, 1, 2, 3, 4].map(i => shift({
    id: `d${i}`, clockIn: at(`2026-09-${String(7 + i).padStart(2, '0')}`, '06:00'), clockOut: at(`2026-09-${String(7 + i).padStart(2, '0')}`, '16:30'), breakMinutes: 30, totalHours: 10,
  }));
  const otCsv = P.buildTimeEntriesCSV(many.slice(4), rule, many);
  ok('overtime is allocated across allEntries (the 5th 10-h day carries 10 h OT)', (otCsv.split('\n')[1] ?? '').split(',')[8] === '10.00', otCsv);
  expect('TSV fallback splits into columns, quotes undone', P.csvToTsv('a,"b, c",d\n1,2,3'), 'a\tb, c\td\n1\t2\t3');
}

console.log('\n#66 missed clock-out:');
{
  const now = Date.parse(at('2026-09-17', '10:00'));
  const open = (clockIn: string, over: Partial<TimeEntry> = {}) => shift({ clockIn, clockOut: undefined, status: 'clocked_in', totalHours: 0, breakMinutes: 0, ...over });
  ok('a shift from an earlier day is missed', P.isMissedClockOut(open(at('2026-09-16', '07:00')), now, 8));
  ok('…by the calendar day alone (7 h open, clocked in yesterday 11 pm)',
    P.isMissedClockOut(open(at('2026-09-16', '23:00')), Date.parse(at('2026-09-17', '06:00')), 8));
  ok('this morning\'s shift is not', !P.isMissedClockOut(open(at('2026-09-17', '06:00')), now, 8));
  ok('a same-day shift past max(alert + 2, 14) h is missed',
    P.isMissedClockOut(open(at('2026-09-17', '00:30')), Date.parse(at('2026-09-17', '15:00')), 8)
    && !P.isMissedClockOut(open(at('2026-09-17', '01:30')), Date.parse(at('2026-09-17', '15:00')), 8));
  ok('a finished shift is never missed', !P.isMissedClockOut(shift({ clockIn: at('2026-09-01', '07:00') }), now, 8));
  const fri = open(at('2026-09-11', '07:00'), { breakMinutes: 30 });
  expect('default out time = clock-in + alert + break, on the clock-in day',
    new Date(P.defaultMissedOutMs(fri, 8, now)).toISOString(), at('2026-09-11', '15:30'));
  const late = open(at('2026-09-11', '20:00'));
  expect('…clamped to the end of the clock-in day', new Date(P.defaultMissedOutMs(late, 8, now)).toISOString(), at('2026-09-11', '23:59'));
  ok('an out time before the clock-in is refused', /after the clock-in/.test(P.outTimeProblem(fri, Date.parse(at('2026-09-11', '06:00')), now) ?? ''));
  ok('an out time after now is refused', /later than now/.test(P.outTimeProblem(fri, now + 3_600_000, now) ?? ''));
  ok('a sane out time passes', P.outTimeProblem(fri, Date.parse(at('2026-09-11', '15:30')), now) === null);
  expect('typed times', ['3:30 pm', '15:30', '3pm', '0730', '12:15 am', '25:00', '13pm'].map(P.parseClockTime), [930, 930, 900, 450, 15, null, null]);
  expect('next-day out time', new Date(P.outMsOnClockInDay(late.clockIn, 6 * 60, 1)).toISOString(), at('2026-09-12', '06:00'));
}

console.log('\n#152 live NET hours:');
{
  const now = Date.parse(at('2026-09-17', '15:30'));
  const e = shift({ clockIn: at('2026-09-17', '07:00'), clockOut: undefined, status: 'clocked_in', breakMinutes: 60, totalHours: 0 });
  expect('finished breaks come off the timer', P.liveNetHours(e, now), 7.5);
  const onBreak = { ...e, status: 'break' as const, breakStartedAt: at('2026-09-17', '15:00') };
  expect('…and the break in progress', P.liveNetHours(onBreak, now), 7);
  expect('clock-out from break records the running break too', P.breakMinutesAt(onBreak, now), 90);
  expect('formatHoursMinutes', P.formatHoursMinutes(7.5), '7h 30m');
}

console.log('\n#67 a queued write keeps the local row:');
{
  const local = [{ id: 'jose', v: 'local-clocked-out' }, { id: 'offline', v: 'local-only' }, { id: 'gone', v: 'deleted-offline' }];
  const server = [{ id: 'jose', v: 'server-clocked-in' }, { id: 'gone', v: 'server' }, { id: 'new', v: 'server-new' }];
  const merged = P.mergeServerPull(local, server, new Set(['jose']), new Set(['gone']));
  expect('pending id: local wins; queued delete: gone; local-only: kept; new: added',
    merged.map(r => `${r.id}=${r.v}`).sort(), ['jose=local-clocked-out', 'new=server-new', 'offline=local-only']);
  expect('with nothing queued the server wins', P.mergeServerPull(local, server, new Set(), new Set()).find(r => r.id === 'jose')?.v, 'server-clocked-in');
  expect('queued deletes are collected apart from writes',
    [...P.queuedDeleteIds([{ table: 'time_entries', operation: 'delete', data: { id: 'a' } }, { table: 'time_entries', operation: 'update', data: { id: 'b' } }, { table: 'invoices', operation: 'delete', data: { id: 'c' } }], 'time_entries')],
    ['a']);
}

console.log('\n#155 hours are filed against a job:');
ok('a uuid is a project id; "unassigned" is not', P.isUuid(H) && !P.isUuid('unassigned') && !P.isUuid(''));

console.log('\nScreen wiring (source):');
{
  const tt = src('app/time-tracking.tsx');
  const hook = src('hooks/useTimeEntries.ts');
  const jc = src('app/job-costing.tsx');
  ok('#155 no unassigned fallback on clock-in', !/\?\? 'unassigned'/.test(tt) && !/\?\? 'Unassigned'/.test(tt));
  ok('#155 Clock In is disabled with the reason and a create-project button',
    /disabled=\{!!clockInDisabledReason\}/.test(tt) && /Create a project first/.test(tt) && /openCreate: '1'/.test(tt));
  ok('#155 the hook refuses a non-uuid project id', (hook.match(/if \(!isUuid\(args\.projectId\)\)/g) ?? []).length === 2);
  ok('#68 a real file: deliverTextFile + Sharing.shareAsync with the CSV UTI',
    /deliverTextFile\(fileName, csv, 'text\/csv;charset=utf-8'\)/.test(tt) && /Sharing\.shareAsync\(uri, \{[\s\S]{0,200}UTI: 'public\.comma-separated-values-text'/.test(tt));
  {
    // The export modal closes only AFTER the share sheet resolves: dismissing
    // it in the same tick lets iOS refuse the sheet mid-dismiss, silently.
    const share = tt.indexOf('await Sharing.shareAsync(uri');
    const between = share >= 0 ? tt.slice(tt.lastIndexOf('if (!uri ||', share), share) : '';
    ok('#68 the share sheet is presented before the export modal closes',
      share > 0 && !/setShowExport\(false\)/.test(between) && /\}\);\s*setShowExport\(false\);/.test(tt.slice(share, share + 400)), between.slice(-200));
  }
  ok('#63 a teammate correction never sends a note (the team read has none to keep)',
    /closeTeamShift\(entry\.id, \{ totalHours, breakMinutes \}\)/.test(tt) && !/closeTeamShift\([^)]*notes/.test(tt) && /Notes belong to the person who logged the shift/.test(tt));
  ok('#68 no message-text share, no QuickBooks paste promise', !/shareText\(/.test(tt) && !/Paste into Excel \/ QuickBooks/.test(tt));
  ok('#64 the export writes the period selection, not every entry',
    /buildTimeEntriesCSV\(rows, overtimeRule, mergeTimeEntriesMirror\(entries, teamEntries\)\)/.test(tt) && /selectPayrollEntries\(/.test(tt) && !/buildTimeEntriesCSV\(entries\)/.test(tt));
  ok('#63 team rows are the OWNED-project ones (costingTeamRows), never all teamEntries', /costingTeamRows\(teamEntries\)/.test(tt));
  ok('#63 team rows close through closeTeamShift, never clockOut / updateEntry',
    /closeTeamShift\(entry\.id, \{ clockOut: outIso/.test(tt) && /if \(teamRow\) return;/.test(tt));
  ok('#63 the job-costing drill tags team rows the same way', /teamLoggedByLabel\(e as TeamTimeEntry\)/.test(jc) && /Time Tracking lists all/.test(jc));
  ok('#66 missed shifts leave On Site and stop blocking a clock-in',
    /liveCount: activeLiveRows\.length/.test(tt) && /!isMissed\(e\)\)\),/.test(tt));
  ok('#152 the timer and Hours Today use liveNetHours', /formatHoursMinutes\(elapsedHrs\)/.test(tt) && /liveNetHours\(e, nowMs\)/.test(tt) && !/getElapsedHours/.test(tt));
  ok('#67 the pull reads the queue before and after the SELECT and subscribes to flushes',
    /const queueBefore = await readTimeEntryQueue\(\)/.test(hook) && /const queueAfter = await readTimeEntryQueue\(\)/.test(hook)
    && /mergeServerPull\(prev, fromServer, pending, deleted\)/.test(hook) && /onQueueFlushed\(tables =>/.test(hook));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
