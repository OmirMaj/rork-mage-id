import { computePillStatus, pillLabel } from '../utils/scheduleHealth';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:', got, '\n      want:', want); }
}

console.log('\nscheduleHealth validation:');

// On track
expect('All zero → on_track', computePillStatus({ cpmSlipDays: 0, overdueCount: 0, healthScore: 100 }), 'on_track');
expect('Healthy 85 score → on_track', computePillStatus({ cpmSlipDays: 0, overdueCount: 0, healthScore: 85 }), 'on_track');
expect('Slight ahead → on_track', computePillStatus({ cpmSlipDays: -2, overdueCount: 0, healthScore: 90 }), 'on_track');

// At risk
expect('Slip 3 days → at_risk', computePillStatus({ cpmSlipDays: 3, overdueCount: 0, healthScore: 80 }), 'at_risk');
expect('Health 69 → at_risk', computePillStatus({ cpmSlipDays: 0, overdueCount: 0, healthScore: 69 }), 'at_risk');

// Late
expect('1 overdue → late', computePillStatus({ cpmSlipDays: 0, overdueCount: 1, healthScore: 100 }), 'late');
expect('Slip 8 days → late', computePillStatus({ cpmSlipDays: 8, overdueCount: 0, healthScore: 100 }), 'late');
expect('Slip 100 + bad health → late', computePillStatus({ cpmSlipDays: 100, overdueCount: 5, healthScore: 30 }), 'late');

// Boundary: slip exactly 7 days = NOT late (>7 is late)
expect('Slip exactly 7d, 0 overdue → at_risk (boundary)', computePillStatus({ cpmSlipDays: 7, overdueCount: 0, healthScore: 100 }), 'at_risk');
// Boundary: slip exactly 2 days = NOT at_risk (>2 is at_risk)
expect('Slip exactly 2d, healthy → on_track (boundary)', computePillStatus({ cpmSlipDays: 2, overdueCount: 0, healthScore: 100 }), 'on_track');
// Boundary: healthScore exactly 70 = on_track (<70 is at_risk)
expect('Health exactly 70 → on_track (boundary)', computePillStatus({ cpmSlipDays: 0, overdueCount: 0, healthScore: 70 }), 'on_track');

// Label
expect('pillLabel on_track', pillLabel('on_track'), 'On Track');
expect('pillLabel at_risk', pillLabel('at_risk'), 'At Risk');
expect('pillLabel late', pillLabel('late'), 'Late');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
