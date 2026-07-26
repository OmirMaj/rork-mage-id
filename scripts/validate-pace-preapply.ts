// scripts/validate-pace-preapply.ts
// Run: bun scripts/validate-pace-preapply.ts
//
// Tests for utils/pace/preApplyPlan.ts (F4 — pace pre-apply, the first
// earned autonomous act):
//   - Eligibility = paceFor's rules VERBATIM (via the shared paceSuggestionFor)
//     AND tradeGates[trade].passed AND prefEnabled
//   - pref off → empty plan (even when gates pass and suggestions exist)
//   - gate fail / missing gate for a trade → tasks of that trade skipped
//   - milestone / 'general' trade / zero-duration / low-confidence /
//     within-a-day-agreement skips (delegated to paceSuggestionFor — verified
//     end-to-end here so a future reimplementation can't drift)
//   - decision carries {taskId, trade, paceDays, aiOriginalDays, jobCount,
//     confidence} with paceDays identical to what the suggest chip would show

import { computePreApplyPlan } from '../utils/pace/preApplyPlan';
import { paceSuggestionFor, type PaceBook, type PaceBookEntry } from '../utils/pace/paceBook';
import type { ScheduleTask } from '../types';

let failures = 0;
function assert(cond: boolean, msg: string, extra?: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}${extra ? ` — ${extra}` : ''}`);
    failures++;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<ScheduleTask> & { id: string }): ScheduleTask {
  return {
    title: 'Task',
    phase: 'Rough-In',
    durationDays: 4,
    startDay: 0,
    progress: 0,
    crew: '',
    dependencies: [],
    notes: '',
    status: 'not_started',
    ...overrides,
  } as ScheduleTask;
}

function makeEntry(overrides: Partial<PaceBookEntry> & { trade: string }): PaceBookEntry {
  return {
    key: `${overrides.trade}|all`,
    sqftBucket: 'all',
    sampleCount: 6,
    jobCount: 6,
    plannedMean: 5,
    actualMean: 9,
    variability: 0.1,
    bias: 0.8,
    confidence: 'high',
    samples: [],
    ...overrides,
  } as PaceBookEntry;
}

function makeBook(entries: PaceBookEntry[]): PaceBook {
  return {
    entries,
    jobsAnalyzed: 6,
    tradesTracked: new Set(entries.map(e => e.trade)).size,
    asOf: new Date().toISOString(),
  };
}

const gates = (spec: Record<string, boolean>): Map<string, { passed: boolean }> =>
  new Map(Object.entries(spec).map(([trade, passed]) => [trade, { passed }]));

// framing|all: jobCount 6, actualMean 9 → suggestDuration(4) = round((3/9)*4 + (6/9)*9) = round(7.33) = 7
const framingEntry = makeEntry({ trade: 'framing' });
const finishEntry = makeEntry({ trade: 'finish', key: 'finish|all', actualMean: 8 });
const book = makeBook([framingEntry, finishEntry]);

// ─── Pref off → empty ────────────────────────────────────────────────────────

{
  console.log('\n── pref off ──');
  const tasks = [makeTask({ id: 't1', tradeKey: 'framing' })];
  const plan = computePreApplyPlan({
    tasks, paceBook: book, sqft: undefined,
    tradeGates: gates({ framing: true }),
    prefEnabled: false,
  });
  assert(plan.length === 0, 'prefEnabled=false → empty plan even with passing gate + live suggestion');
}

// ─── Gate pass/fail per trade ────────────────────────────────────────────────

{
  console.log('\n── per-trade gates ──');
  const tasks = [
    makeTask({ id: 'framing-1', tradeKey: 'framing' }),
    makeTask({ id: 'finish-1', tradeKey: 'finish' }),
  ];
  // Only framing gate passed.
  const plan = computePreApplyPlan({
    tasks, paceBook: book, sqft: undefined,
    tradeGates: gates({ framing: true, finish: false }),
    prefEnabled: true,
  });
  assert(plan.length === 1, 'only the passing trade pre-applies', `got ${plan.length}`);
  assert(plan[0]?.taskId === 'framing-1', 'framing task is the decision');
  assert(plan[0]?.trade === 'framing', 'decision.trade = framing');

  // No gate entry at all for the trade → locked (never default-open).
  const planNoGate = computePreApplyPlan({
    tasks, paceBook: book, sqft: undefined,
    tradeGates: gates({}),
    prefEnabled: true,
  });
  assert(planNoGate.length === 0, 'trade with NO gate record → skipped (locked by default)');
}

// ─── Decision payload shape ──────────────────────────────────────────────────

{
  console.log('\n── decision payload ──');
  const task = makeTask({ id: 'f1', tradeKey: 'framing', durationDays: 4 });
  const plan = computePreApplyPlan({
    tasks: [task], paceBook: book, sqft: undefined,
    tradeGates: gates({ framing: true }),
    prefEnabled: true,
  });
  const d = plan[0];
  assert(!!d, 'decision produced');
  assert(d!.aiOriginalDays === 4, 'aiOriginalDays = the AI draft duration', `got ${d!.aiOriginalDays}`);
  assert(d!.paceDays === 7, 'paceDays = blended suggestion (round((3/9)*4+(6/9)*9)=7)', `got ${d!.paceDays}`);
  assert(d!.jobCount === 6, 'jobCount carried from the book entry');
  assert(d!.confidence === 'high', 'confidence carried from the book entry');

  // Parity with the suggest chip — the pre-apply planner must never invent a
  // different number than paceFor/paceSuggestionFor would offer.
  const chip = paceSuggestionFor(book, task, undefined);
  assert(!!chip && chip.days === d!.paceDays, 'paceDays identical to the suggest chip (paceSuggestionFor parity)');
}

// ─── paceFor rule skips, end-to-end ──────────────────────────────────────────

{
  console.log('\n── paceFor rule skips ──');
  const allPass = gates({ framing: true, general: true });

  const milestone = makeTask({ id: 'm1', tradeKey: 'framing', isMilestone: true });
  assert(
    computePreApplyPlan({ tasks: [milestone], paceBook: book, sqft: undefined, tradeGates: allPass, prefEnabled: true }).length === 0,
    'milestone → skipped',
  );

  const zeroDur = makeTask({ id: 'z1', tradeKey: 'framing', durationDays: 0 });
  assert(
    computePreApplyPlan({ tasks: [zeroDur], paceBook: book, sqft: undefined, tradeGates: allPass, prefEnabled: true }).length === 0,
    'durationDays <= 0 → skipped',
  );

  // 'general' fallback trade never suggests — even with a (nonsense) general entry + passing gate.
  const generalBook = makeBook([makeEntry({ trade: 'general', key: 'general|all' })]);
  const generalTask = makeTask({ id: 'g1', title: 'Miscellaneous coordination' });
  assert(
    computePreApplyPlan({ tasks: [generalTask], paceBook: generalBook, sqft: undefined, tradeGates: allPass, prefEnabled: true }).length === 0,
    "'general' trade → never pre-applies",
  );

  // Low-confidence entry → silent.
  const lowBook = makeBook([makeEntry({ trade: 'framing', confidence: 'low', jobCount: 1, sampleCount: 1 })]);
  assert(
    computePreApplyPlan({ tasks: [makeTask({ id: 'l1', tradeKey: 'framing' })], paceBook: lowBook, sqft: undefined, tradeGates: allPass, prefEnabled: true }).length === 0,
    'low-confidence book entry → skipped',
  );

  // Agreement within a day → silent (delta threshold).
  // actualMean == proposedDays ⇒ blend == proposedDays ⇒ |delta| = 0 < 1.
  const agreeBook = makeBook([makeEntry({ trade: 'framing', actualMean: 4 })]);
  assert(
    computePreApplyPlan({ tasks: [makeTask({ id: 'a1', tradeKey: 'framing', durationDays: 4 })], paceBook: agreeBook, sqft: undefined, tradeGates: allPass, prefEnabled: true }).length === 0,
    'suggestion within a day of the AI duration → skipped (no ≥1-day delta)',
  );

  // No book entry for the trade at all → silent.
  const emptyBook = makeBook([]);
  assert(
    computePreApplyPlan({ tasks: [makeTask({ id: 'n1', tradeKey: 'framing' })], paceBook: emptyBook, sqft: undefined, tradeGates: allPass, prefEnabled: true }).length === 0,
    'no pace history for trade → skipped',
  );
}

// ─── Mixed multi-task plan ───────────────────────────────────────────────────

{
  console.log('\n── mixed plan ──');
  const tasks = [
    makeTask({ id: 'f1', tradeKey: 'framing', durationDays: 4 }),
    makeTask({ id: 'f2', tradeKey: 'framing', durationDays: 12 }),
    makeTask({ id: 'd1', tradeKey: 'finish', durationDays: 3 }),
    makeTask({ id: 'm1', tradeKey: 'framing', isMilestone: true }),
  ];
  const plan = computePreApplyPlan({
    tasks, paceBook: book, sqft: undefined,
    tradeGates: gates({ framing: true, finish: true }),
    prefEnabled: true,
  });
  // f1: 4→7; f2: round((3/9)*12+(6/9)*9)=round(10)=10, delta 2 → included;
  // d1: finish actualMean 8 → round((3/9)*3+(6/9)*8)=round(6.33)=6, delta 3 → included;
  // m1 skipped.
  assert(plan.length === 3, '3 of 4 tasks pre-apply (milestone skipped)', `got ${plan.length}`);
  const byId = new Map(plan.map(p => [p.taskId, p]));
  assert(byId.get('f2')?.paceDays === 10, 'f2 blended to 10d', `got ${byId.get('f2')?.paceDays}`);
  assert(byId.get('d1')?.paceDays === 6, 'd1 blended to 6d', `got ${byId.get('d1')?.paceDays}`);
  assert(byId.get('d1')?.aiOriginalDays === 3, 'd1 aiOriginalDays preserved');
}

// ─── Summary ──────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} pace pre-apply test(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nAll pace pre-apply tests passed.');
}
