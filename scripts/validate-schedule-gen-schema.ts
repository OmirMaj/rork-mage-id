import { autoScheduleTaskSchema, normalizeGeneratedTask } from '../utils/scheduleGenSchema';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:', got, '\n      want:', want); }
}

console.log('\nschedule generation schema validation:');

const full = {
  id: 't1', name: 'Framing', phase: 'Framing', duration: 5,
  predecessorIds: ['t0'], isMilestone: false, isCriticalPath: true,
  crewSize: 4, wbs: '3.1', rationale: 'Framing before drywall; 5 days from 1,800 SF at crew rate.',
  assumption: false, linkedCategories: ['lumber'],
};
expect('accepts a full task with rationale', autoScheduleTaskSchema.safeParse(full).success, true);

const noRationale = { ...full } as any; delete noRationale.rationale;
expect('rejects a task missing rationale', autoScheduleTaskSchema.safeParse(noRationale).success, false);

const noAssumption = { ...full } as any; delete noAssumption.assumption;
expect('assumption is optional', autoScheduleTaskSchema.safeParse(noAssumption).success, true);

const normalized = normalizeGeneratedTask({ id: 't2', name: 'Roofing', phase: 'Roofing', duration: 3, predecessorIds: [] }, 1);
expect('normalize defaults rationale to ""', normalized.rationale, '');
expect('normalize defaults assumption to true when no basis given', normalized.assumption, true);
expect('normalize clamps crewSize into 1..8', normalized.crewSize, 2);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
