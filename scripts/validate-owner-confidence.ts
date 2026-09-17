// validate-owner-confidence.ts — pins utils/ownerConfidence.ts.
// The OWNER-facing "on time & on budget" summary. Client-safe: contract/billing
// only, never cost/markup/margin. Run: bun run scripts/validate-owner-confidence.ts
import { buildOwnerConfidence, ownerSchedulePace, NO_PACE_LABEL, OWNER_PACE_THRESHOLDS } from '../utils/ownerConfidence';
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
// "Behind" needs EVIDENCE: work reported on a schedule that is not keeping up.
// (This case used to be `progress: 0` on an untouched schedule — the exact
// false "Behind schedule" the evidence gate below now refuses to print.)
expect('behind: 10% reported done at ~45% through the schedule',
  buildOwnerConfidence({ project: project([task({ durationDays: 10, progress: 10, status: 'in_progress' })]), changeOrders: [], invoices: [], nowMs: MID }).status, 'behind');
expect('minor_delays: 35% done at ~45% through (inside the -0.15 band)',
  buildOwnerConfidence({ project: project([task({ durationDays: 10, progress: 35 })]), changeOrders: [], invoices: [], nowMs: MID }).status, 'minor_delays');

// ── the evidence gate: no reported work, or no start date → NO verdict ──
const untouched = buildOwnerConfidence({ project: project(tasks10), changeOrders: [], invoices: [], nowMs: MID });
expect('untouched schedule mid-job is not "Behind" — neutral status, honest label',
  [untouched.status, untouched.statusLabel], ['not_started', NO_PACE_LABEL.noProgress]);
expect('ownerSchedulePace refuses an untouched schedule',
  ownerSchedulePace({ tasks: tasks10, startDate: '2026-01-05', nowMs: MID }), null);
const noStart = buildOwnerConfidence({ project: project([task({ durationDays: 10, progress: 50 })], 100000, ''), changeOrders: [], invoices: [], nowMs: MID });
expect('progress but no start date is not an unearned "On track"',
  [noStart.status, noStart.statusLabel, noStart.projectedFinishISO], ['not_started', NO_PACE_LABEL.noStartDate, null]);
expect('an in_progress status with 0% counts as reported work',
  ownerSchedulePace({ tasks: [task({ durationDays: 10, progress: 0, status: 'in_progress' })], startDate: '2026-01-05', nowMs: MID })?.status, 'behind');
expect('a milestone alone is not evidence of work',
  ownerSchedulePace({ tasks: [task({ isMilestone: true, progress: 100, status: 'done' }), task({ id: 'x', durationDays: 10 })], startDate: '2026-01-05', nowMs: MID }), null);
expect('a legacy full-timestamp startDate still anchors (same day as the portal hero)',
  ownerSchedulePace({ tasks: [task({ durationDays: 10, progress: 50 })], startDate: '2026-01-05T08:00:00.000Z', nowMs: MID })?.finishISO, '2026-01-16');
expect('every task at 100% reads complete, not "on track" to a past date',
  ownerSchedulePace({ tasks: [task({ durationDays: 10, progress: 100 })], startDate: '2026-01-05', nowMs: Date.parse('2026-03-01T00:00:00') })?.status, 'complete');
expect('threshold constants', [OWNER_PACE_THRESHOLDS.onTrackMinDelta, OWNER_PACE_THRESHOLDS.minorDelaysMinDelta], [-0.05, -0.15]);
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
