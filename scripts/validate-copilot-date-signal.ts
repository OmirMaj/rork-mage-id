// scripts/validate-copilot-date-signal.ts — pure-fn validator for the schedule
// interview's date-signal guard: a model-presumed startDate is only accepted
// when the contractor's OWN words carried a date (or they're answering the
// start-date question). This is what makes the "when do you break ground?"
// clarifying question actually appear for a dateless scope. Imports only the
// pure dateSignal module (no RN-heavy capability chain).
import { hasDateSignal, isPlausibleStartDay, shouldAcceptStartDate } from '../utils/copilot/schedule/dateSignal';

let pass = 0, fail = 0;
function eq(n: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
}

// --- hasDateSignal: dateless scopes are NOT date signals ---
eq('plain scope, no date', hasDateSignal('Kitchen and two bathroom remodel'), false);
eq('empty transcript', hasDateSignal(''), false);
eq('gut bath only', hasDateSignal('Full gut bathroom, designer finishes'), false);

// --- hasDateSignal: real timing phrases ARE date signals ---
eq('month name', hasDateSignal('break ground end of March'), true);
eq('relative weeks', hasDateSignal('start in about two weeks'), true);
eq('in N weeks', hasDateSignal('in 3 weeks'), true);
eq('weekday', hasDateSignal('we start Monday'), true);
eq('ISO date', hasDateSignal('kickoff 2026-03-21'), true);
eq('M/D date', hasDateSignal('begin 3/21'), true);
eq('next month', hasDateSignal('next month sometime'), true);
eq('the 15th', hasDateSignal('mobilize the 15th'), true);

// --- shouldAcceptStartDate: model-presumed date is DROPPED without a signal ---
// A fixed "today" so these never drift into the plausibility window's edges.
const T = '2026-03-01';
eq('presumed date dropped (no signal)', shouldAcceptStartDate('2026-05-01', 'Kitchen and two bathroom remodel', false, T), false);
eq('stated date kept (has signal)', shouldAcceptStartDate('2026-03-31', 'break ground end of March', false, T), true);
eq('answer to start-date accepted', shouldAcceptStartDate('2026-06-10', 'June 10th', true, T), true);
eq('answering with no signal still accepted', shouldAcceptStartDate('2026-06-10', 'sounds good', true, T), true);
eq('non-string date rejected', shouldAcceptStartDate(null, 'break ground in March', false, T), false);
eq('undefined date rejected', shouldAcceptStartDate(undefined, 'next week', false, T), false);

// --- the plausibility window (integration review, wave 6) ---
// The prompt had no today, so "end of March" could come back a year off and
// pass every check. A day outside [today − 60, today + 730] is not accepted.
eq('wrong-year "end of March" (a year early) rejected', shouldAcceptStartDate('2025-03-31', 'break ground end of March', false, T), false);
eq('…even when answering the start question', shouldAcceptStartDate('2025-03-31', 'end of March', true, T), false);
eq('three years out rejected', shouldAcceptStartDate('2029-03-31', 'end of March', false, T), false);
eq('broke ground 4 weeks ago kept', shouldAcceptStartDate('2026-02-01', 'we started 4 weeks ago', false, T), true);
eq('edge: exactly 60 days back kept', isPlausibleStartDay('2025-12-31', T), true);
eq('edge: 61 days back rejected', isPlausibleStartDay('2025-12-30', T), false);
eq('edge: exactly 730 days out kept', isPlausibleStartDay('2028-02-29', T), true);
eq('edge: 731 days out rejected', isPlausibleStartDay('2028-03-01', T), false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
