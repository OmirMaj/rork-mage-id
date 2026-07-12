// scripts/validate-schedule-verdict.ts — pure-fn validator for utils/scheduleVerdict.ts.
// Run via `bun run scripts/validate-schedule-verdict.ts`. No jest in this repo.
import { scheduleVerdict } from '../utils/scheduleVerdict';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', got, '\n      want: ', want); }
}

// On pace, no issues.
const onPace = scheduleVerdict({ slipDaysVsBaseline: 0, finishDateLabel: 'Aug 14, 2026', overdueCount: 0 });
expect('onPace tone', onPace.tone, 'onPace');
expect('onPace headline', onPace.headline, 'On pace — finishing about Aug 14, 2026');
expect('onPace detail empty', onPace.detail, '');

// Slightly behind (1..3) + driver + overdue.
const sb = scheduleVerdict({ slipDaysVsBaseline: 3, finishDateLabel: 'Sep 2, 2026', criticalDriverTitle: 'Electrical rough-in', overdueCount: 2 });
expect('slightlyBehind tone', sb.tone, 'slightlyBehind');
expect('slightlyBehind headline', sb.headline, '3 days behind plan — finishing about Sep 2, 2026');
expect('slightlyBehind detail', sb.detail, 'Electrical rough-in is your finish-date driver. 2 tasks overdue.');

// Behind (>=4), no finish date known.
const behind = scheduleVerdict({ slipDaysVsBaseline: 7, finishDateLabel: '—', overdueCount: 0 });
expect('behind tone', behind.tone, 'behind');
expect('behind headline (no finish)', behind.headline, '7 days behind plan');

// Ahead (singular day).
const ahead = scheduleVerdict({ slipDaysVsBaseline: -1, finishDateLabel: 'Jul 1, 2026', overdueCount: 0 });
expect('ahead tone', ahead.tone, 'ahead');
expect('ahead headline (singular)', ahead.headline, '1 day ahead of plan — finishing about Jul 1, 2026');

// No baseline set, but we know a finish date.
const nb = scheduleVerdict({ slipDaysVsBaseline: null, finishDateLabel: 'Aug 14, 2026', overdueCount: 0 });
expect('noBaseline tone', nb.tone, 'noBaseline');
expect('noBaseline headline', nb.headline, 'On track to finish about Aug 14, 2026');

// No baseline, no finish, overdue-only detail.
const nbEmpty = scheduleVerdict({ slipDaysVsBaseline: null, finishDateLabel: '—', overdueCount: 1 });
expect('noBaseline no-finish headline', nbEmpty.headline, 'Schedule in progress');
expect('overdue-only detail (singular)', nbEmpty.detail, '1 task overdue.');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
