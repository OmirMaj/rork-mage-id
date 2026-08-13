import { recommendedOnRampPath } from '@/utils/scheduleOnRamp';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, `\n      got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
console.log('\nschedule on-ramp recommended path:');
eq('estimate wins', recommendedOnRampPath({ hasEstimate: true }), 'estimate');
eq('no estimate → interview', recommendedOnRampPath({ hasEstimate: false }), 'interview');
eq('empty ctx → interview', recommendedOnRampPath({}), 'interview');
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
