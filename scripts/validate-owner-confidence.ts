// validate-owner-confidence.ts — pins utils/ownerConfidence.ts.
// The OWNER-facing "on time & on budget" summary. Client-safe: contract/billing
// only, never cost/markup/margin. Run: bun run scripts/validate-owner-confidence.ts
import { buildOwnerConfidence } from '../utils/ownerConfidence';
import type { Project, ChangeOrder, Invoice, ScheduleTask } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}

const task = (o: Partial<ScheduleTask>): ScheduleTask => ({
  id: 't', title: 'Task', phase: 'General', durationDays: 1, startDay: 1,
  dependencies: [], crew: '', crewSize: 1, isMilestone: false, notes: '',
  status: 'not_started', progress: 0, ...o,
} as ScheduleTask);

function project(tasks: ScheduleTask[], grandTotal = 100000, startDate = '2026-01-05'): Project {
  return {
    id: 'p1', name: 'Test', type: 'renovation', status: 'in_progress',
    linkedEstimate: { grandTotal },
    schedule: { tasks, startDate, workingDaysPerWeek: 5 },
    updatedAt: '2026-01-05T00:00:00.000Z',
  } as unknown as Project;
}
const co = (status: string, amt: number): ChangeOrder => ({ id: 'c' + amt + status, status, changeAmount: amt } as unknown as ChangeOrder);
const inv = (totalDue: number, amountPaid: number): Invoice => ({ id: 'i' + totalDue, totalDue, amountPaid } as unknown as Invoice);

const AT_START = Date.parse('2026-01-05T00:00:00');
const MID = Date.parse('2026-01-10T00:00:00'); // ~45% through the Jan 5→16 span

console.log('\nowner confidence:');

// ── % complete: duration-weighted ──
expect('pctComplete duration-weighted (30d@100% + 10d@0% = 75%)',
  buildOwnerConfidence({ project: project([task({ id: 'a', durationDays: 30, progress: 100 }), task({ id: 'b', durationDays: 10, progress: 0 })]), changeOrders: [], invoices: [], nowMs: AT_START }).pctComplete,
  75);

// ── billing: client-facing only (contract + approved COs; billed/paid/balance) ──
const b = buildOwnerConfidence({
  project: project([task({ durationDays: 10, progress: 50 })], 100000),
  changeOrders: [co('approved', 5000), co('pending', 9999), co('rejected', 1)],
  invoices: [inv(40000, 30000), inv(20000, 10000)],
  nowMs: MID,
}).billing;
expect('billing contract/approvedChanges/revised', [b.contract, b.approvedChanges, b.revisedContract], [100000, 5000, 105000]);
expect('billing billed/paid/balance', [b.billed, b.paid, b.balance], [60000, 40000, 65000]);

// ── awaiting approval: pending + changes_requested only ──
expect('awaitingApproval counts submitted + under_review (not approved/rejected)',
  buildOwnerConfidence({ project: project([task({})]), changeOrders: [co('submitted', 1), co('under_review', 2), co('approved', 3), co('rejected', 4)], invoices: [], nowMs: AT_START }).awaitingApproval,
  2);

// ── pace status ──
const tasks10 = [task({ durationDays: 10, progress: 0 })];
expect('behind: 0% done at ~45% through the schedule',
  buildOwnerConfidence({ project: project(tasks10), changeOrders: [], invoices: [], nowMs: MID }).status, 'behind');
expect('on_track: 50% done at ~45% through',
  buildOwnerConfidence({ project: project([task({ durationDays: 10, progress: 50 })]), changeOrders: [], invoices: [], nowMs: MID }).status, 'on_track');
expect('not_started before start date',
  buildOwnerConfidence({ project: project(tasks10), changeOrders: [], invoices: [], nowMs: Date.parse('2026-01-01T00:00:00') }).status, 'not_started');

// ── completed project → complete + 100% ──
const doneC = buildOwnerConfidence({ project: { ...project([task({ durationDays: 10, progress: 50 })]), status: 'completed' } as unknown as Project, changeOrders: [], invoices: [], nowMs: MID });
expect('completed → status complete + 100%', [doneC.status, doneC.pctComplete], ['complete', 100]);

// ── next milestones: upcoming, not-done, soonest first ──
const ms = buildOwnerConfidence({
  project: project([
    task({ id: 'm1', isMilestone: true, startDay: 1, durationDays: 5, title: 'Framing done' }),
    task({ id: 'm2', isMilestone: true, startDay: 1, durationDays: 15, title: 'Rough-in done' }),
    task({ id: 'm3', isMilestone: true, startDay: 1, durationDays: 2, title: 'Permit', status: 'done', progress: 100 }),
  ]),
  changeOrders: [], invoices: [], nowMs: AT_START,
}).nextMilestones;
expect('milestones: done excluded, soonest first', ms.map((m) => m.title), ['Framing done', 'Rough-in done']);

// ── client-safety: the summary shape exposes no cost/markup/margin keys ──
const keys = Object.keys(buildOwnerConfidence({ project: project([task({})]), changeOrders: [], invoices: [], nowMs: AT_START }).billing);
expect('billing exposes only client-facing keys (no cost/markup/margin)',
  keys.some((k) => /cost|markup|margin|profit/i.test(k)), false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
