// scripts/validate-startdate-rebase.ts — pure-fn validator for utils/scheduleRebase.ts.
//
// rebaseRawToCalendar maps raw working-day ordinals onto calendar day indices
// when a dateless schedule first gets an explicit start date. Day 1 = the
// start date. 2026-01-05 is a Monday; 2026-01-03 is a Saturday.
import { rebaseRawToCalendar } from '../utils/scheduleRebase';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}
const T = (id: string, startDay: number, durationDays = 1): ScheduleTask => ({ id, title: id.toUpperCase(), phase: '', startDay, durationDays, progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started' } as ScheduleTask);
const days = (ts: ScheduleTask[]) => ts.map(t => t.startDay);

// 7-day week, no closures → every day works → identity (same array ref back).
{
  const tasks = [T('a', 1), T('b', 6), T('c', 14)];
  const out = rebaseRawToCalendar(tasks, '2026-01-05', 7);
  eq('wdpw=7 no closures → identity days', days(out), [1, 6, 14]);
  eq('wdpw=7 identity returns the SAME array (commit no-op)', out === tasks, true);
}

// 5-day week starting Monday: ordinals 1-5 = Mon-Fri (days 1-5), ordinal 6
// skips the weekend to the next Monday (day 8), and so on.
{
  const tasks = [1, 2, 5, 6, 7, 10].map((d, i) => T(`t${i}`, d));
  const out = rebaseRawToCalendar(tasks, '2026-01-05', 5);
  eq('wdpw=5 Monday start maps 1,2,5,6,7,10 → 1,2,5,8,9,12', days(out), [1, 2, 5, 8, 9, 12]);
}

// 5-day week starting Saturday: days 1-2 are the weekend, so ordinal 1 is
// day 3 (Monday); ordinal 6 crosses the next weekend to day 10.
{
  const tasks = [T('a', 1), T('b', 5), T('c', 6)];
  const out = rebaseRawToCalendar(tasks, '2026-01-03', 5);
  eq('wdpw=5 Saturday start maps 1,5,6 → 3,7,10', days(out), [3, 7, 10]);
}

// Closures push ordinals past the closed day: Tue 2026-01-06 closed → the
// 2nd working day is Wednesday (day 3); ordinal 5 lands on Monday (day 8).
{
  const tasks = [T('a', 1), T('b', 2), T('c', 5)];
  const out = rebaseRawToCalendar(tasks, '2026-01-05', 5, ['2026-01-06']);
  eq('closure on day 2 maps 1,2,5 → 1,3,8', days(out), [1, 3, 8]);
}

// Same raw day → same calendar day (parallel tasks stay parallel).
{
  const out = rebaseRawToCalendar([T('a', 6), T('b', 6)], '2026-01-05', 5);
  eq('duplicate raw days stay equal', days(out), [8, 8]);
}

// Durations and other fields pass through untouched; only startDay changes.
{
  const src = T('a', 6, 4);
  const out = rebaseRawToCalendar([src], '2026-01-05', 5)[0];
  eq('durationDays preserved', out.durationDays, 4);
  eq('title/status preserved', [out.title, out.status], ['A', 'not_started']);
  eq('source task not mutated', src.startDay, 6);
}

// Garbage start date → identity (engine is permissive → mapping is identity).
{
  const tasks = [T('a', 6)];
  eq('unparseable startDate → unchanged', rebaseRawToCalendar(tasks, 'not-a-date', 5) === tasks, true);
}

// Empty input → same array back.
{
  const empty: ScheduleTask[] = [];
  eq('empty tasks → same array', rebaseRawToCalendar(empty, '2026-01-05', 5) === empty, true);
}

// Zero / negative / fractional startDay clamps to ordinal 1.
{
  const out = rebaseRawToCalendar([T('a', 0), T('b', -3)], '2026-01-03', 5);
  eq('non-positive startDay clamps to ordinal 1', days(out), [3, 3]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
