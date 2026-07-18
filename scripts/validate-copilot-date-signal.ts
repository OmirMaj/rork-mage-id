// scripts/validate-copilot-date-signal.ts — pure-fn validator for the schedule
// interview's date-signal guard: a model-presumed startDate is only accepted
// when the contractor's OWN words carried a date (or they're answering the
// start-date question). This is what makes the "when do you break ground?"
// clarifying question actually appear for a dateless scope. Imports only the
// pure dateSignal module (no RN-heavy capability chain).
import { hasDateSignal, shouldAcceptStartDate } from '../utils/copilot/schedule/dateSignal';

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
eq('presumed date dropped (no signal)', shouldAcceptStartDate('2026-05-01', 'Kitchen and two bathroom remodel', false), false);
eq('stated date kept (has signal)', shouldAcceptStartDate('2026-03-31', 'break ground end of March', false), true);
eq('answer to start-date accepted', shouldAcceptStartDate('2026-06-10', 'June 10th', true), true);
eq('answering with no signal still accepted', shouldAcceptStartDate('2026-06-10', 'sounds good', true), true);
eq('non-string date rejected', shouldAcceptStartDate(null, 'break ground in March', false), false);
eq('undefined date rejected', shouldAcceptStartDate(undefined, 'next week', false), false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
