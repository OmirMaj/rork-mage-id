// validate-delay-rfi.ts — unit tests for the Delay Cascade + RFI Brain pure
// engine: delay prompt grounding + coercion, strict task-title matching,
// RFI critical-path block status. Run via: bun run test:delay-rfi
import { buildDelayPrompt, coerceDelayResult, hashDelayText, DELAY_SCHEMA_HINT, MAX_DELAY_HITS, MAX_DELTA_DAYS } from '../utils/delayScan/delayPrompt';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}

console.log('\ndelayScan buildDelayPrompt:');

const TITLES = ['Electrical rough-in', 'Drywall hang', 'Paint interior'];
const prompt = buildDelayPrompt('Inspector no-show this morning — electrical rough-in pushed 2 days. Also drywall stack got rained on.', TITLES);

expect('embeds the issues text', prompt.includes('electrical rough-in pushed 2 days'), true);
expect('lists every task title', prompt.includes('- Electrical rough-in') && prompt.includes('- Drywall hang') && prompt.includes('- Paint interior'), true);
expect('rule: guess must be verbatim from the list or empty', /VERBATIM/.test(prompt), true);
expect('rule: prefer empty over speculation', /empty hits list over speculation/i.test(prompt), true);
expect('rule: quote the exact phrase', /exact phrase/i.test(prompt), true);
expect('rule: vague delay defaults to 1 day', /minimum 1/.test(prompt), true);
expect('empty task list stays safe', buildDelayPrompt('x', []).includes('(no tasks)'), true);
expect('schema hint carries the hit shape', Object.keys(DELAY_SCHEMA_HINT.hits[0]).sort(), ['deltaDays', 'quote', 'taskTitleGuess']);

console.log('\ndelayScan hashDelayText:');
expect('stable for identical input', hashDelayText('rain delay') === hashDelayText('rain delay'), true);
expect('changes when text changes', hashDelayText('rain delay') === hashDelayText('rain delay tomorrow'), false);
expect('ignores case and outer whitespace', hashDelayText('  Rain Delay ') === hashDelayText('rain delay'), true);

console.log('\ndelayScan coerceDelayResult:');
const goodHit = { taskTitleGuess: 'Electrical rough-in', deltaDays: 2, quote: 'rough-in pushed 2 days' };
expect('accepts the {hits:[...]} envelope', coerceDelayResult({ hits: [goodHit] }).hits.length, 1);
expect('accepts a bare array', coerceDelayResult([goodHit]).hits[0].taskTitleGuess, 'Electrical rough-in');
expect('clamps deltaDays below 1 up to 1', coerceDelayResult({ hits: [{ ...goodHit, deltaDays: 0 }] }).hits[0].deltaDays, 1);
expect('rounds fractional deltaDays', coerceDelayResult({ hits: [{ ...goodHit, deltaDays: 2.6 }] }).hits[0].deltaDays, 3);
expect('missing deltaDays defaults to 1', coerceDelayResult({ hits: [{ taskTitleGuess: '', quote: 'delayed by weather' }] }).hits[0].deltaDays, 1);
expect('caps oversize deltaDays', coerceDelayResult({ hits: [{ ...goodHit, deltaDays: 999 }] }).hits[0].deltaDays, MAX_DELTA_DAYS);
expect('drops hits without a quote', coerceDelayResult({ hits: [{ taskTitleGuess: 'Drywall hang', deltaDays: 3 }] }).hits.length, 0);
expect('missing guess defaults to empty string', coerceDelayResult({ hits: [{ quote: 'stuck on inspection' }] }).hits[0].taskTitleGuess, '');
expect('junk input → empty hits', coerceDelayResult('nope').hits.length, 0);
expect('caps the hit count', coerceDelayResult({ hits: Array.from({ length: 9 }, (_, i) => ({ quote: `q${i}` })) }).hits.length, MAX_DELAY_HITS);

import { matchTaskByTitle } from '../utils/delayScan/matchTask';
import type { ScheduleTask } from '../types';

function task(id: string, title: string, startDay: number, durationDays: number, over: Partial<ScheduleTask> = {}): ScheduleTask {
  return { id, title, phase: 'General', durationDays, startDay, progress: 0, crew: 'Crew A', dependencies: [], notes: '', status: 'not_started', ...over };
}

console.log('\ndelayScan matchTaskByTitle:');

const TASKS = [
  task('A', 'Demo', 1, 3),
  task('B', 'Electrical rough-in', 4, 5),
  task('C', 'Drywall hang', 9, 4),
  task('D', 'Paint interior', 13, 3),
  task('E', 'Paint exterior', 13, 3),
  task('F', 'Demo prep', 1, 1),
];

expect('exact match, case/whitespace-insensitive', matchTaskByTitle('  electrical ROUGH-IN ', TASKS)?.id, 'B');
expect('guess-inside-title substring', matchTaskByTitle('rough-in', TASKS)?.id, 'B');
expect('title-inside-guess substring', matchTaskByTitle('Drywall hang west wing', TASKS)?.id, 'C');
expect('ambiguous substring → null', matchTaskByTitle('paint', TASKS), null);
expect('exact wins over substring ambiguity', matchTaskByTitle('demo', TASKS)?.id, 'A');
expect('no match → null', matchTaskByTitle('landscaping', TASKS), null);
expect('empty guess → null', matchTaskByTitle('', TASKS), null);

import { rfiBlockStatus } from '../utils/delayScan/rfiBlocking';
import type { ProjectSchedule } from '../types';

function sched(tasks: ScheduleTask[]): ProjectSchedule {
  return {
    id: 's1', name: 'Test schedule', projectId: 'P1', workingDaysPerWeek: 7, bufferDays: 0,
    tasks, totalDurationDays: 0, criticalPathDays: 0, laborAlignmentScore: 0, riskItems: [],
    updatedAt: new Date().toISOString(),
  };
}

console.log('\ndelayScan rfiBlockStatus:');

// A(1-5) → B(6-10) → C(11-15) is the zero-float chain; D(1-2) has no
// successors → LF = projectFinish 15 → totalFloat 13.
const CHAIN = [
  task('A', 'Foundation', 1, 5),
  task('B', 'Framing', 6, 5, { dependencies: ['A'] }),
  task('C', 'Roofing', 11, 5, { dependencies: ['B'] }),
  task('D', 'Order fixtures', 1, 2),
];
const S = sched(CHAIN);

const critical = rfiBlockStatus({ linkedTaskId: 'B', status: 'open' }, S);
expect('open RFI on a zero-float task → critical', critical.critical, true);
expect('carries the task title', critical.taskTitle, 'Framing');
expect('carries totalFloat 0', critical.totalFloat, 0);

const floaty = rfiBlockStatus({ linkedTaskId: 'D', status: 'open' }, S);
expect('open RFI on a floaty task → not critical', floaty.critical, false);
expect('still reports the float', floaty.totalFloat, 13);

expect('no linkedTaskId → not blocking', rfiBlockStatus({ status: 'open' }, S).critical, false);
expect('answered RFI → not blocking', rfiBlockStatus({ linkedTaskId: 'B', status: 'answered' }, S).critical, false);
expect('missing schedule → not blocking', rfiBlockStatus({ linkedTaskId: 'B', status: 'open' }, null).critical, false);
expect('unknown task id → not blocking', rfiBlockStatus({ linkedTaskId: 'ZZ', status: 'open' }, S).critical, false);

const doneChain = sched(CHAIN.map(t => t.id === 'B' ? { ...t, status: 'done' as const, progress: 100 } : t));
expect('done task never warns', rfiBlockStatus({ linkedTaskId: 'B', status: 'open' }, doneChain).critical, false);

import { overdueCalendarDays } from '../utils/delayScan/rfiBlocking';

console.log('\nrfi overdueCalendarDays (local calendar days, due-today = 0):');

// Fixed local "now": March 10 2026, 07:00 local — early morning, the exact
// window where the old elapsed-24h math hid a full-calendar-day-overdue RFI.
const NOW = new Date(2026, 2, 10, 7, 0, 0);
const noonUtc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 12, 0, 0)).toISOString();

// Due "yesterday" (local March 9) — overdue 1 the moment March 10 starts,
// regardless of the hour. Anchor the due day in LOCAL components so the test
// is timezone-independent (noon-UTC anchors shift a day only for |offset|>=12).
const localIso = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();
expect('due yesterday → 1 at 7am local', overdueCalendarDays(localIso(2026, 2, 9), NOW), 1);
expect('due today → 0 all day (not overdue)', overdueCalendarDays(localIso(2026, 2, 10), NOW), 0);
expect('due today late evening still 0', overdueCalendarDays(localIso(2026, 2, 10, 23), new Date(2026, 2, 10, 23, 30)), 0);
expect('due tomorrow → 0', overdueCalendarDays(localIso(2026, 2, 11), NOW), 0);
expect('due a week ago → 7', overdueCalendarDays(localIso(2026, 2, 3), NOW), 7);
expect('DST-spanning span still counts whole days', overdueCalendarDays(localIso(2026, 2, 5), new Date(2026, 2, 12, 7)), 7);
expect('noon-UTC anchor read in local components', overdueCalendarDays(noonUtc(2026, 2, 9), NOW) >= 1, true);
expect('empty due date → 0', overdueCalendarDays('', NOW), 0);
expect('junk due date → 0', overdueCalendarDays('not-a-date', NOW), 0);
expect('null due date → 0', overdueCalendarDays(null, NOW), 0);

import { isExcludedMemoryRecord } from '../utils/projectMemoryCore';

console.log('\nprojectMemory isExcludedMemoryRecord (self-retrieval exclusion):');

expect('client doc excluded by id', isExcludedMemoryRecord({ id: 'rfi-42', ref: 'RFI #12' }, ['rfi-42'], []), true);
expect('server match excluded by doc_id', isExcludedMemoryRecord({ doc_id: 'rfi-42', ref: 'RFI #12' }, ['rfi-42'], []), true);
expect('excluded by ref when id differs (stale index)', isExcludedMemoryRecord({ doc_id: 'rfi-old', ref: 'RFI #12' }, ['rfi-42'], ['RFI #12']), true);
expect('other records pass through', isExcludedMemoryRecord({ doc_id: 'rfi-7', ref: 'RFI #7' }, ['rfi-42'], ['RFI #12']), false);
expect('doc_id wins over id when both present', isExcludedMemoryRecord({ id: 'x', doc_id: 'rfi-42' }, ['rfi-42'], []), true);
expect('no exclusions → nothing excluded', isExcludedMemoryRecord({ id: 'rfi-42', ref: 'RFI #12' }), false);
expect('empty record never excluded', isExcludedMemoryRecord({}, ['rfi-42'], ['RFI #12']), false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
