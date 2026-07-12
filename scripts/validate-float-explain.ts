// scripts/validate-float-explain.ts — pure-fn validator for utils/floatExplain.ts.
import { floatPhrase, buildCriticalPathExplanation } from '../utils/floatExplain';
import type { ScheduleTask } from '../types';
import type { CpmResult, CpmTaskResult } from '../utils/cpm';

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}
eq('float 0 → critical wording', floatPhrase(0), 'On the critical path — no slack');
eq('float -2 → critical wording', floatPhrase(-2), 'On the critical path — no slack');
eq('float 1 → singular day', floatPhrase(1), 'Can slip 1 day');
eq('float 3 → plural days', floatPhrase(3), 'Can slip 3 days');

const T = (id: string): ScheduleTask => ({ id, title: id.toUpperCase(), phase: '', startDay: 1, durationDays: 2, progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started' } as ScheduleTask);
const per = (id: string, totalFloat: number, isCritical: boolean): [string, CpmTaskResult] =>
  [id, { id, es: 1, ef: 2, ls: 1, lf: 2, totalFloat, freeFloat: totalFloat, isCritical }];
const cpm: CpmResult = {
  perTask: new Map<string, CpmTaskResult>([per('a', 0, true), per('b', 0, true), per('c', 4, false), per('d', 1, false)]),
  projectStart: 1, projectFinish: 10, criticalPath: ['a', 'b'], conflicts: [],
} as CpmResult;
const ex = buildCriticalPathExplanation(cpm, [T('a'), T('b'), T('c'), T('d')]);
eq('finishDay from cpm', ex.finishDay, 10);
eq('critical chain in criticalPath order', ex.criticalTitles.map(x => x.id), ['a', 'b']);
eq('slack excludes critical, sorted asc by canSlipDays', ex.slack.map(x => x.id), ['d', 'c']);
eq('slack canSlipDays from totalFloat', ex.slack.find(x => x.id === 'c')?.canSlipDays, 4);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
