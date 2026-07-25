// validate-pace-grounding.ts — unit tests for the pace-grounding fact builder
// that feeds every schedule generator prompt (the C1 flagship brain build).
//
// Pins INTENDED semantics:
//   • empty book → { facts: [], tradeCount: 0 } (generators degrade gracefully)
//   • low-confidence entries NEVER become facts (2 jobs stays silent)
//   • the 'general' inference-fallback trade NEVER becomes a fact (it pools
//     unrelated misc tasks — mobilization, permits, cleanup)
//   • exact size-band entries are preferred; the trade-wide |all aggregate is
//     emitted only when no band for that trade qualifies
//   • fact line format is exact (the prompts and the honesty chips both hang
//     off it): "~N working days", band descriptor, jobs + confidence, and a
//     bias clause only when |bias| rounds to ≥5%
//   • facts are capped at 8; tradeCount counts distinct trades actually EMITTED
//   • paceFactsBlock renders the injectable prompt block: '' when empty,
//     assumption/rationale instruction by default, and a schema-safe variant
//     (citeInRationale:false) for generators whose task schema has no
//     rationale/assumption fields
//
// Run via: bun run test:pace-grounding
import { buildPaceFacts, paceFactsBlock } from '../utils/copilot/scheduleBuilder/paceGrounding';
import type { Project, ScheduleTask } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}

// ── Fixtures (mirrors validate-pace.ts) ──
function t(over: Partial<ScheduleTask>): ScheduleTask {
  return {
    id: 'T1', title: 'Task', phase: 'Structure', durationDays: 5,
    startDay: 1, progress: 0, crew: '', dependencies: [], notes: '',
    status: 'not_started', ...over,
  } as ScheduleTask;
}
// No schedule.startDate → actualDays falls back to the raw calendar span
// (paceBook's documented degradation), which keeps the arithmetic legible here.
function proj(id: string, sqft: number | undefined, tasks: ScheduleTask[]): Project {
  return {
    id, name: `Job ${id}`, squareFootage: sqft,
    schedule: {
      id: `s-${id}`, name: 'Sched', projectId: id, workingDaysPerWeek: 5,
      bufferDays: 0, tasks, totalDurationDays: 0, criticalPathDays: 0,
      laborAlignmentScore: 0, riskItems: [],
    },
  } as unknown as Project;
}
/** A done task with captured actuals: planned `planned` days, actual span 1..actual. */
function doneTask(id: string, tradeKey: string, planned: number, actual: number): ScheduleTask {
  return t({
    id, tradeKey: tradeKey as ScheduleTask['tradeKey'], status: 'done', durationDays: planned,
    actualStartDay: 1, actualEndDay: actual, actualEndDate: '2026-07-01',
  });
}

console.log('\npaceGrounding buildPaceFacts:');

// ── empty book ──
expect('empty projects → empty facts, zero trades', buildPaceFacts([]), { facts: [], tradeCount: 0 });
expect('projects without captured actuals → empty facts',
  buildPaceFacts([proj('P1', 1800, [t({ tradeKey: 'framing', status: 'done', durationDays: 5 })])]),
  { facts: [], tradeCount: 0 });

// ── low confidence excluded ──
expect('2 jobs = low confidence → excluded',
  buildPaceFacts([
    proj('P1', 1800, [doneTask('f1', 'framing', 7, 8)]),
    proj('P2', 1800, [doneTask('f2', 'framing', 7, 8)]),
  ]),
  { facts: [], tradeCount: 0 });

// ── the medium-confidence happy path: exact format ──
// 3 jobs, small band (1800 SF), planned 7, actuals 8/8/8 → actualMean 8,
// bias (8−7)/7 ≈ +14.3% → "you plan 14% optimistic".
const threeFraming = [
  proj('P1', 1800, [doneTask('f1', 'framing', 7, 8)]),
  proj('P2', 1800, [doneTask('f2', 'framing', 7, 8)]),
  proj('P3', 1800, [doneTask('f3', 'framing', 7, 8)]),
];
expect('exact fact line: band + jobs + confidence + optimistic bias',
  buildPaceFacts(threeFraming),
  {
    facts: ['Framing actually takes you ~8 working days on your small jobs (<2,000 SF; 3 jobs, medium confidence) — you plan 14% optimistic.'],
    tradeCount: 1,
  });

// Fractional mean formats to one decimal: actuals 8/8/9 → mean 8.333 → "~8.3".
expect('fractional actualMean renders one decimal',
  buildPaceFacts([
    proj('P1', 1800, [doneTask('f1', 'framing', 8, 8)]),
    proj('P2', 1800, [doneTask('f2', 'framing', 8, 8)]),
    proj('P3', 1800, [doneTask('f3', 'framing', 8, 9)]),
  ]).facts[0].includes('~8.3 working days'),
  true);

// Conservative bias: planned 10, actual 8 → −20% → "you plan 20% conservative".
ok('conservative bias clause',
  buildPaceFacts([
    proj('P1', 1800, [doneTask('d1', 'demo', 10, 8)]),
    proj('P2', 1800, [doneTask('d2', 'demo', 10, 8)]),
    proj('P3', 1800, [doneTask('d3', 'demo', 10, 8)]),
  ]).facts[0].endsWith('— you plan 20% conservative.'));

// On-plan (|bias| < 5%) → no bias clause.
ok('no bias clause when planning is on-pace',
  buildPaceFacts([
    proj('P1', 1800, [doneTask('h1', 'hvac', 8, 8)]),
    proj('P2', 1800, [doneTask('h2', 'hvac', 8, 8)]),
    proj('P3', 1800, [doneTask('h3', 'hvac', 8, 8)]),
  ]).facts[0].endsWith('(<2,000 SF; 3 jobs, medium confidence).'));

// ── 'general' trade never becomes a fact ──
expect('general-trade entries excluded even at medium confidence',
  buildPaceFacts([
    proj('P1', 1800, [doneTask('g1', 'general', 5, 6)]),
    proj('P2', 1800, [doneTask('g2', 'general', 5, 6)]),
    proj('P3', 1800, [doneTask('g3', 'general', 5, 6)]),
  ]),
  { facts: [], tradeCount: 0 });

// ── band preference vs |all fallback ──
// 3 jobs in 3 DIFFERENT bands: every band entry has 1 job (low) but |all has
// 3 (medium) → the trade-wide aggregate is emitted, phrased "across your jobs".
const spreadBands = buildPaceFacts([
  proj('P1', 1800, [doneTask('f1', 'framing', 7, 8)]),
  proj('P2', 2500, [doneTask('f2', 'framing', 7, 8)]),
  proj('P3', 4000, [doneTask('f3', 'framing', 7, 8)]),
]);
expect('bands too thin → trade-wide |all fact',
  spreadBands,
  {
    facts: ['Framing actually takes you ~8 working days across your jobs (3 jobs, medium confidence) — you plan 14% optimistic.'],
    tradeCount: 1,
  });

// When a band qualifies, the redundant |all aggregate for that trade is dropped
// (threeFraming above: framing|small AND framing|all both reach 3 jobs — only
// the band fact was emitted).
expect('qualified band suppresses the |all duplicate', buildPaceFacts(threeFraming).facts.length, 1);

// ── cap at 8 facts; tradeCount counts EMITTED trades ──
const nineTrades = ['concrete', 'framing', 'electrical', 'plumbing', 'hvac', 'roofing', 'steel', 'demo', 'landscaping'];
const capBook = buildPaceFacts([1, 2, 3].map(n =>
  proj(`P${n}`, 1800, nineTrades.map((tr, i) => doneTask(`${tr}${n}`, tr, 5, 6 + i)))));
expect('facts capped at 8', capBook.facts.length, 8);
expect('tradeCount counts only emitted trades', capBook.tradeCount, 8);

console.log('\npaceGrounding paceFactsBlock:');

expect('empty facts → empty block', paceFactsBlock([]), '');

const block = paceFactsBlock(['Framing actually takes you ~8 working days across your jobs (3 jobs, medium confidence).']);
ok('block carries the PACE HISTORY header', block.includes('YOUR PACE HISTORY'));
ok('block bullets each fact', block.includes('- Framing actually takes you ~8 working days'));
ok('default instruction demands assumption:false + rationale citation',
  block.includes('assumption:false') && /rationale/.test(block));
ok('default instruction demands scaling to this job’s size', /scaled to this job/.test(block));

const lean = paceFactsBlock(['Framing actually takes you ~8 working days across your jobs (3 jobs, medium confidence).'], { citeInRationale: false });
ok('schema-safe variant never mentions assumption/rationale fields',
  !lean.includes('assumption') && !lean.includes('rationale'));
ok('schema-safe variant still demands deriving from the actual pace',
  /derive its duration from the actual pace/.test(lean) && /scaled to this job/.test(lean));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
