import { computePillStatus, pillLabel } from '../utils/scheduleHealth';
import { computeScheduleHealthScore, DCMA_COVERAGE } from '../utils/scheduleHealthScore';
import { runCpm } from '../utils/cpm';
import type { ScheduleTask } from '../types';

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

// ─────────────────────────────────────────────────────────────────────────────
// DCMA 14-point coverage — utils/scheduleHealthScore.ts
// ─────────────────────────────────────────────────────────────────────────────
// The file header pitches "DCMA-grade schedule QA out of the box" to
// contractors bidding federal work. These assertions are what stands behind
// that sentence: the labels have to name the item they measure, and the items
// claimed as implemented have to actually fire on a schedule that violates them.

console.log('\nDCMA coverage (scheduleHealthScore):');

const ISO = '2026-03-02';
const CAL = { scheduleStartDate: ISO, workingDaysPerWeek: 5 };
function T(id: string, dur: number, deps: string[] = [], extra: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id, title: id, phase: 'Frame', durationDays: dur, startDay: 1, progress: 0, crew: '',
    dependencies: deps, notes: '', status: 'not_started', ...extra,
  } as ScheduleTask;
}
function score(tasks: ScheduleTask[], calendar: Record<string, unknown> = CAL) {
  const cpm = runCpm(tasks, CAL);
  return computeScheduleHealthScore({ tasks, cpm, calendar });
}
function check(tasks: ScheduleTask[], key: string) {
  return score(tasks).checks.find(c => c.key === key);
}

// The published DCMA numbering. Every dcmaLabel must reference an item this
// file claims to implement — a label pointing at an unimplemented item is the
// exact failure the corrections in this pass were about.
{
  const all = score([T('A', 5), T('B', 5, ['A'])]).checks;
  const claimed = all
    .map(c => c.dcmaLabel)
    .filter((l): l is string => !!l)
    .map(l => Number(/#(\d+)/.exec(l)?.[1] ?? NaN));
  const implemented = new Set<number>(DCMA_COVERAGE.implemented as readonly number[]);
  const partial = new Set<number>(DCMA_COVERAGE.partial as readonly number[]);
  expect('every dcmaLabel names an item DCMA_COVERAGE claims to implement or approximate',
    claimed.filter(n => !implemented.has(n) && !partial.has(n)), []);
  // A partial item must SAY it is partial on the label the user reads, not only
  // in a constant they never see.
  expect('a partial item labels itself a proxy',
    all.filter(c => {
      const n = Number(/#(\d+)/.exec(c.dcmaLabel ?? '')?.[1] ?? NaN);
      return partial.has(n) && !/proxy/i.test(c.dcmaLabel ?? '');
    }).map(c => c.key), []);
  expect('no label claims #6 High Float, #12 Critical Path Test or #14 BEI',
    claimed.filter(n => [6, 12, 14].includes(n)), []);
  expect('#4 Relationship Types is present', claimed.includes(4), true);
  expect('#7 Negative Float is present', claimed.includes(7), true);
  expect('#9 Invalid Dates is present', claimed.includes(9), true);
  expect('#13 CPLI is present', claimed.includes(13), true);
}

// #4 — a schedule of SS links must score below a schedule of FS links.
{
  const fsOnly = [T('A', 5), T('B', 5, ['A']), T('C', 5, ['B'])];
  const ssHeavy = [
    T('A', 5),
    T('B', 5, ['A'], { dependencyLinks: [{ taskId: 'A', type: 'SS', lagDays: 0 }] }),
    T('C', 5, ['B'], { dependencyLinks: [{ taskId: 'B', type: 'FF', lagDays: 0 }] }),
  ];
  expect('#4 all-FS scores 1', check(fsOnly, 'relationship_types')!.value, 1);
  expect('#4 an SS/FF-heavy chain scores below 1',
    check(ssHeavy, 'relationship_types')!.value < 1, true);
  expect('#4 flags the offending links',
    check(ssHeavy, 'relationship_types')!.flagged.length, 2);
}

// #2 / #3 — a lead is a negative lag; a lag is waiting time.
{
  const lead = [T('A', 5), T('B', 5, ['A'], { dependencyLinks: [{ taskId: 'A', type: 'FS', lagDays: -2 }] })];
  expect('#2 a lead is flagged', check(lead, 'leads')!.flagged.length, 1);
  expect('#2 a clean chain is not', check([T('A', 5), T('B', 5, ['A'])], 'leads')!.value, 1);
  const lag = [T('A', 5), T('B', 5, ['A'], { dependencyLinks: [{ taskId: 'A', type: 'FS', lagDays: 3 }] })];
  expect('#3 a lag is flagged', check(lag, 'lags')!.flagged.length, 1);
}

// #5 — hard pins beat the logic, so DCMA counts them.
{
  const pinned = [
    T('A', 5),
    T('B', 5, ['A'], { anchorType: 'must-finish-on', anchorDate: '2026-04-01' }),
  ];
  expect('#5 a hard pin is flagged', check(pinned, 'hard_constraints')!.flagged.length, 1);
  expect('#5 a soft pin is not',
    check([T('A', 5, [], { anchorType: 'start-no-earlier', anchorDate: '2026-03-09' })], 'hard_constraints')!.flagged.length, 0);
}

// #7 — negative float means the plan is already impossible.
{
  const impossible = [
    T('P', 10),
    T('S', 2, ['P'], { anchorType: 'must-start-on', anchorDate: '2026-03-04' }),
  ];
  const c = check(impossible, 'negative_float')!;
  expect('#7 negative float is detected', c.flagged.length > 0, true);
  expect('#7 a healthy chain reports none',
    check([T('A', 5), T('B', 5, ['A'])], 'negative_float')!.value, 1);
}

// #9 — self-contradicting date fields.
{
  const bad = [
    T('A', 5, [], { actualStartDay: 5, actualEndDay: 2 }),
    T('B', 5, [], { anchorType: 'must-start-on' }),           // pin with no date
    T('C', 5, [], { deadline: 'next Tuesday' }),
  ];
  const c = check(bad, 'invalid_dates')!;
  expect('#9 catches all three shapes of invalid date', c.flagged.length, 3);
  expect('#9 a clean schedule scores 1',
    check([T('A', 5), T('B', 5, ['A'])], 'invalid_dates')!.value, 1);
}

// #13 — CPLI needs a baseline AND a calendar, and must say so rather than
// dividing two different clocks.
{
  const noBaseline = check([T('A', 5), T('B', 5, ['A'])], 'cpli')!;
  expect('#13 with no baseline reports "needs a baseline", not a number',
    /baseline/i.test(noBaseline.suggestion), true);

  // Baseline finish (working ordinal) 12 vs a forecast of 10 working days →
  // CPLI 1.2, comfortably ahead.
  const ahead = [
    T('A', 5, [], { baselineStartDay: 1, baselineEndDay: 6 }),
    T('B', 5, ['A'], { baselineStartDay: 7, baselineEndDay: 12 }),
  ];
  const aheadCheck = check(ahead, 'cpli')!;
  expect('#13 an ahead-of-baseline plan scores 1', aheadCheck.value, 1);
  expect('#13 prints the ratio', /CPLI 1\.\d\d/.test(aheadCheck.suggestion), true);

  // Baseline finish 8 vs a 10-working-day forecast → CPLI 0.8, DCMA fail.
  const behind = [
    T('A', 5, [], { baselineStartDay: 1, baselineEndDay: 4 }),
    T('B', 5, ['A'], { baselineStartDay: 5, baselineEndDay: 8 }),
  ];
  const behindCheck = check(behind, 'cpli')!;
  expect('#13 a behind-baseline plan scores 0', behindCheck.value, 0);
  expect('#13 explains the gap in working days',
    /working day\(s\) past the baseline/.test(behindCheck.suggestion), true);

  // Without a calendar the two scales cannot be compared, and CPLI must refuse
  // rather than divide a working ordinal by a calendar index.
  const noCal = computeScheduleHealthScore({ tasks: ahead, cpm: runCpm(ahead, CAL) })
    .checks.find(c => c.key === 'cpli')!;
  expect('#13 with no calendar refuses instead of guessing', noCal.value, 0.5);
}

// The critical-task-notes check must grade against the ENGINE, not the stored
// isCriticalPath flag the AI generator writes and nothing refreshes.
{
  const tasks = [
    T('LONG', 10, [], { isCriticalPath: false, notes: '' }),
    T('SHORT', 2, [], { isCriticalPath: true, notes: '' }),
  ];
  const c = check(tasks, 'note_completeness')!;
  expect('critical-task notes grade the engine\'s critical path, not the stored flag',
    c.flagged.map(f => f.id), ['LONG']);
}

// `progress_freshness` asks "is this task past its planned end and still 0%".
// The planned end has to be the ENGINE's finish (a CALENDAR index), because it
// is compared against half of cpm.projectFinish, which is also a calendar
// index. It used to be `t.startDay + t.durationDays - 1` — a WORKING ordinal
// plus a WORKING duration — so on a 5-day week every task read ~40% earlier
// than it really finishes and the check flagged work that was not yet due.
//
// The fixture is built so the two readings DISAGREE: a 5-task chain of 4-day
// tasks from Mon 2026-03-02. Task 2 finishes on calendar index 12 (mid-project
// is 13, so it IS past halfway) but its ordinal arithmetic puts it at 8 against
// a mid-project of 13 too — so pick the task the two readings straddle.
{
  const chain: ScheduleTask[] = [];
  for (let i = 0; i < 5; i++) chain.push(T(`t${i}`, 4, i ? [`t${i - 1}`] : []));
  const cpm = runCpm(chain, CAL);
  const half = cpm.projectFinish * 0.5;
  // Which tasks the ENGINE says are past halfway…
  const engineStale = chain.filter(t => cpm.perTask.get(t.id)!.ef <= half).map(t => t.id);
  // …versus what the ordinal arithmetic would have said.
  const ordinalStale = chain.filter(t => (t.startDay + t.durationDays - 1) <= half).map(t => t.id);
  expect('the fixture really does make the two readings disagree',
    JSON.stringify(engineStale) !== JSON.stringify(ordinalStale), true);
  const flagged = check(chain, 'progress_freshness')!.flagged.map(f => f.id);
  expect('progress freshness measures the ENGINE finish, not startDay + duration',
    flagged, engineStale);
  expect('  …and NOT what the mixed-scale arithmetic would have flagged',
    JSON.stringify(flagged) !== JSON.stringify(ordinalStale), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
