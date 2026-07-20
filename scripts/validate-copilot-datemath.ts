// scripts/validate-copilot-datemath.ts — pure-fn validator for addMonths, the
// warranty/permit expiry helper. The whole point is NOT overflowing on
// end-of-month starts (Jan 31 + 1mo must be Feb 28, not Mar 3).
import { addMonths } from '../utils/copilot/dateMath';

let pass = 0, fail = 0;
function eq(n: string, got: string, want: string) {
  if (got === want) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, `got ${got}, want ${want}`); }
}

eq('whole year', addMonths('2026-07-20', 12), '2027-07-20');
eq('25-year roof term', addMonths('2026-07-20', 300), '2051-07-20');
eq('mid-month + 6mo', addMonths('2026-01-15', 6), '2026-07-15');
// End-of-month clamps instead of overflowing.
eq('Jan 31 + 1mo clamps to Feb 28 (non-leap)', addMonths('2026-01-31', 1), '2026-02-28');
eq('Jan 31 + 1mo clamps to Feb 29 (leap)', addMonths('2028-01-31', 1), '2028-02-29');
eq('Aug 31 + 1mo clamps to Sep 30', addMonths('2026-08-31', 1), '2026-09-30');
eq('Dec 31 + 2mo clamps to Feb 28', addMonths('2026-12-31', 2), '2027-02-28');
// Cross-year rollover.
eq('Nov 20 + 3mo crosses the year', addMonths('2026-11-20', 3), '2027-02-20');
// Tolerates a full ISO timestamp input.
eq('accepts a full ISO timestamp', addMonths('2026-07-20T13:05:00.000Z', 1), '2026-08-20');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
