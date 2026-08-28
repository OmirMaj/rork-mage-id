import { runCpm, isWorkingDay, workingDaysBetween } from '../../utils/cpm';
import { getTaskDateRange, addWorkingDays } from '../../utils/scheduleEngine';
import type { ScheduleTask } from '../../types';

const T = (o: Partial<ScheduleTask>): ScheduleTask => ({
  id: o.id!, title: o.title ?? o.id!, phase: 'General',
  startDay: o.startDay ?? 1, durationDays: o.durationDays ?? 1,
  progress: 0, status: 'not_started', dependencies: o.dependencies ?? [],
  isMilestone: false, ...o,
} as ScheduleTask);

const start = '2026-01-05'; // Monday
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const dayToDate = (d: number) => {
  const dt = new Date(Date.parse(start + 'T00:00:00Z') + (d - 1) * 86400000);
  return `${dt.toISOString().slice(0,10)} ${DOW[dt.getUTCDay()]}`;
};

console.log('=== A. workingDaysPerWeek = 6 (Mon-Sat) is treated as 5 ===');
for (const wd of [5, 6, 7]) {
  const r = runCpm([T({ id: 'a', durationDays: 12, startDay: 1 })], {
    scheduleStartDate: start, workingDaysPerWeek: wd,
  });
  const t = r.perTask.get('a')!;
  console.log(`  wdpw=${wd}  ES=${t.es} EF=${t.ef}  finish=${dayToDate(t.ef)}`);
}
console.log('  TRUE 6-day answer: 12 working days Mon-Sat from Mon Jan 5 => Sat Jan 17 = day 13');

console.log('\n=== B. isWorkingDay on a 6-day week (Saturday should be working) ===');
for (let d = 1; d <= 8; d++) {
  console.log(`  day ${d} = ${dayToDate(d)}  isWorkingDay(wd=6)=${isWorkingDay(d, 6, start, new Set())}`);
}

console.log('\n=== C. totalFloat units: calendar vs working days ===');
const tasks = [
  T({ id: 'A', startDay: 1, durationDays: 10 }),
  T({ id: 'B', startDay: 1, durationDays: 1 }),
  T({ id: 'C', startDay: 1, durationDays: 1, dependencies: ['A', 'B'] }),
];
const r5 = runCpm(tasks, { scheduleStartDate: start, workingDaysPerWeek: 5 });
for (const id of ['A','B','C']) {
  const t = r5.perTask.get(id)!;
  console.log(`  ${id}: es=${t.es}(${dayToDate(t.es)}) ef=${t.ef} ls=${t.ls} lf=${t.lf} TF=${t.totalFloat} FF=${t.freeFloat} crit=${t.isCritical}`);
}
const B = r5.perTask.get('B')!;
console.log('  workingDaysBetween(B.es -> B.ls) =',
  workingDaysBetween(B.es, B.ls, { workingDaysPerWeek: 5, scheduleStartDate: start }));

console.log('\n=== D. criticalFloatThresholdDays vs weekend-inflated float ===');
const tasks2 = [
  T({ id: 'P', startDay: 1, durationDays: 5 }),
  T({ id: 'Q', startDay: 1, durationDays: 4 }),
  T({ id: 'R', startDay: 1, durationDays: 1, dependencies: ['P', 'Q'] }),
];
const r2 = runCpm(tasks2, { scheduleStartDate: start, workingDaysPerWeek: 5, criticalFloatThresholdDays: 1 });
for (const id of ['P','Q','R']) {
  const t = r2.perTask.get(id)!;
  console.log(`  ${id}: es=${t.es} ef=${t.ef} ls=${t.ls} lf=${t.lf} TF=${t.totalFloat} crit=${t.isCritical}`);
}

console.log('\n=== E. empty task list ===');
const re = runCpm([]);
console.log('  projectStart', re.projectStart, 'projectFinish', re.projectFinish, 'crit', re.criticalPath, 'conflicts', re.conflicts.length);

console.log('\n=== F. zero + negative duration ===');
const r3 = runCpm([T({ id: 'z', durationDays: 0 }), T({ id: 'n', durationDays: -5 }), T({ id: 's', durationDays: 3, dependencies: ['n'] })], { scheduleStartDate: start, workingDaysPerWeek: 5 });
r3.perTask.forEach((v, k) => console.log(`  ${k}: es=${v.es} ef=${v.ef} ls=${v.ls} lf=${v.lf} tf=${v.totalFloat}`));

console.log('\n=== G. NaN duration / NaN startDay ===');
const r4 = runCpm([T({ id: 'nan', durationDays: NaN, startDay: NaN }), T({id:'ok', durationDays: 2, dependencies:['nan']})], { scheduleStartDate: start, workingDaysPerWeek: 5 });
r4.perTask.forEach((v, k) => console.log(`  ${k}: es=${v.es} ef=${v.ef} ls=${v.ls} lf=${v.lf} tf=${v.totalFloat}`));

console.log('\n=== H. anchorDate as full ISO timestamp vs bare date ===');
for (const ad of ['2026-01-19T00:00:00.000Z', '2026-01-19']) {
  const r6 = runCpm([T({ id: 'anch', durationDays: 2, startDay: 1, anchorType: 'must-start-on', anchorDate: ad } as any)], { scheduleStartDate: start, workingDaysPerWeek: 5 });
  const t = r6.perTask.get('anch')!;
  console.log(`  anchorDate=${ad}  es=${t.es} ef=${t.ef}  conflicts=${r6.conflicts.length}`);
}

console.log('\n=== I. scheduleStartDate as full ISO timestamp ===');
for (const sd of ['2026-01-05', '2026-01-05T00:00:00.000Z']) {
  const r8 = runCpm([T({ id: 'a', durationDays: 12 })], { scheduleStartDate: sd, workingDaysPerWeek: 5 });
  const t = r8.perTask.get('a')!;
  console.log(`  scheduleStartDate=${sd}  es=${t.es} ef=${t.ef}`);
}

console.log('\n=== J. engine day-index vs renderer (getTaskDateRange/addWorkingDays) ===');
const chain = [
  T({ id: 'X', startDay: 1, durationDays: 5 }),
  T({ id: 'Y', startDay: 1, durationDays: 1, dependencies: ['X'] }),
];
const rc = runCpm(chain, { scheduleStartDate: start, workingDaysPerWeek: 5 });
const base = new Date(2026, 0, 5);
for (const id of ['X','Y']) {
  const t = rc.perTask.get(id)!;
  const task = chain.find(c => c.id === id)!;
  const applied = { ...task, startDay: t.es };
  const { start: s, end: e } = getTaskDateRange(applied as ScheduleTask, base, 5);
  console.log(`  ${id}: CPM es=${t.es}(${dayToDate(t.es)}) ef=${t.ef}(${dayToDate(t.ef)})`);
  console.log(`      renderer: start=${s.toDateString()} end=${e.toDateString()}`);
}
