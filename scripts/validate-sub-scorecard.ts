// validate-sub-scorecard.ts — unit tests for the Sub Scorecard engine,
// including the D7 factors (flywheel#57): punch rework + schedule
// reliability from data the app already captures per sub.
//
// Pins INTENDED semantics:
//   • rework attribution: assignedSubId wins; company-name fallback ONLY
//     when the item carries no id
//   • the rework denominator is REVIEWED work (closed or rejectionNote'd) —
//     items still open/awaiting review say nothing yet
//   • a rejectionNote marks rework even after the item eventually closes
//   • thresholds: <3 reviewed punch items / <2 measured tasks ⇒
//     applicable:false with honest "Not enough linked data yet" detail —
//     never a fake neutral score
//   • schedule reliability measures Σactual/Σplanned in WORKING days via
//     each schedule's own calendar (same conversion as the pace book);
//     finishing early earns full marks, no extra credit
//   • paperwork is the whole grade ONLY when no performance factor applies —
//     a zero-commitment sub with real punch/schedule data is graded on it
//   • legacy factors unchanged: ≥25% closed-cost overrun zeroes cost
//     discipline; ≥20% CO growth zeroes CO impact
//
// Run via: bun run test:sub-scorecard

import { computeSubScorecards, gradeForScore } from '../utils/subScorecard';
import type { ScorecardFactor, SubScorecard } from '../utils/subScorecard';
import type { Subcontractor, Commitment, PunchItem, Project, ScheduleTask, RFI } from '../types';

let pass = 0, fail = 0;
function canon(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canon);
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    return Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => { acc[k] = canon(o[k]); return acc; }, {});
  }
  return x;
}
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(canon(got)) === JSON.stringify(canon(want));
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(canon(got)), '\n      want: ', JSON.stringify(canon(want))); }
}
const r4 = (n: number): number => Math.round(n * 10000) / 10000;

// ── Fixtures ──
function sub(over: Partial<Subcontractor>): Subcontractor {
  return {
    id: 's1', companyName: 'Acme Electric', trade: 'Electrical',
    w9OnFile: false, ...over,
  } as Subcontractor;
}
function commitment(over: Partial<Commitment>): Commitment {
  return {
    id: 'c1', projectId: 'p1', subcontractorId: 's1', amount: 100_000,
    changeAmount: 0, status: 'closed', ...over,
  } as Commitment;
}
function punch(over: Partial<PunchItem>): PunchItem {
  return {
    id: 'pi1', projectId: 'p1', description: 'Fix outlet', location: 'Unit 1',
    assignedSub: 'Acme Electric', assignedSubId: 's1', dueDate: '2026-08-01',
    priority: 'medium', status: 'closed',
    createdAt: '2026-07-01', updatedAt: '2026-07-02', ...over,
  } as PunchItem;
}
function task(over: Partial<ScheduleTask>): ScheduleTask {
  return {
    id: 'T1', title: 'Rough-in', phase: 'MEP', durationDays: 5, startDay: 1,
    progress: 100, crew: '', dependencies: [], notes: '', status: 'done',
    assignedSubId: 's1', ...over,
  } as ScheduleTask;
}
// RFI fixture. handoffs drive utils/rfiHoldTime: an RFI with no chain is
// `measurable:false` and must score nobody — 0 days there means UNKNOWN,
// not fast.
function rfi(over: Partial<RFI>): RFI {
  return {
    id: 'r1', projectId: 'p1', number: 1, subject: 'Conduit routing',
    question: 'Which wall?', submittedBy: 'GC', assignedTo: 'Acme Electric',
    assignedSubId: 's1', ballInCourt: 'closed', status: 'closed',
    priority: 'medium', attachments: [],
    dateSubmitted: '2026-07-01T00:00:00.000Z',
    dateRequired: '2026-07-10T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-05T00:00:00.000Z',
    handoffs: [
      { at: '2026-07-01T00:00:00.000Z', fromParty: 'gc', toParty: 'sub' },
      { at: '2026-07-03T00:00:00.000Z', fromParty: 'sub', toParty: 'gc' },
    ],
    ...over,
  } as RFI;
}

// startDate 2026-07-06 is a Monday; day 1 = Jul 6. With a 5-day week,
// days 6-7 (Sat/Sun Jul 11-12) are non-working.
function project(tasks: ScheduleTask[], over?: Partial<Project>): Project {
  return {
    id: 'p1', name: 'Henderson',
    schedule: { startDate: '2026-07-06', workingDaysPerWeek: 5, tasks },
    ...over,
  } as unknown as Project;
}

function cardFor(result: { cards: SubScorecard[] }, id: string): SubScorecard {
  const c = result.cards.find(x => x.subId === id);
  if (!c) throw new Error(`no card for ${id}`);
  return c;
}
function factor(card: SubScorecard, key: string): ScorecardFactor {
  const f = card.factors.find(x => x.key === key);
  if (!f) throw new Error(`no factor ${key}`);
  return f;
}

console.log('\nrework attribution:');
{
  const res = computeSubScorecards({
    subcontractors: [sub({}), sub({ id: 's2', companyName: 'Bravo Plumbing' })],
    commitments: [],
    punchItems: [
      punch({ id: 'a' }),                                                    // id match → s1
      punch({ id: 'b', assignedSubId: 's2', assignedSub: 'Acme Electric' }), // id wins over name
      punch({ id: 'c', assignedSubId: undefined, assignedSub: ' ACME ELECTRIC ' }), // name fallback → s1
      punch({ id: 'd', assignedSubId: undefined, assignedSub: '' }),         // unattributed
    ],
  });
  const rework = factor(cardFor(res, 's1'), 'rework_rate');
  expect('id match + name fallback (id wins; blank name unattributed)',
    { applicable: rework.applicable, detail: rework.detail },
    { applicable: false, detail: 'Not enough linked data yet — 2 of 3 reviewed punch items needed' });
}

console.log('\nrework denominator + scoring:');
{
  const res = computeSubScorecards({
    subcontractors: [sub({})],
    commitments: [],
    punchItems: [
      punch({ id: 'a', status: 'closed' }),
      punch({ id: 'b', status: 'closed' }),
      // Rejected then reopened — reviewed AND rework, even while open.
      punch({ id: 'c', status: 'open', rejectionNote: 'Cover plate still crooked' }),
      // Awaiting first review / plain open — not reviewed, not counted.
      punch({ id: 'd', status: 'ready_for_review' }),
      punch({ id: 'e', status: 'open' }),
    ],
  });
  const rework = factor(cardFor(res, 's1'), 'rework_rate');
  // 3 reviewed, 1 rejected → rate 1/3 → score 1 − (1/3)/0.4 = 1/6.
  expect('reviewed = closed + rejected; 1 of 3 bounced scores 1/6',
    { applicable: rework.applicable, score: r4(rework.score), weight: rework.weight },
    { applicable: true, score: r4(1 / 6), weight: 0.2 });
  expect('detail names the bounce count',
    rework.detail, '1 of 3 reviewed punch items bounced at review (sent back for rework)');
}
{
  const res = computeSubScorecards({
    subcontractors: [sub({})],
    commitments: [],
    punchItems: [punch({ id: 'a' }), punch({ id: 'b' }), punch({ id: 'c' })],
  });
  const rework = factor(cardFor(res, 's1'), 'rework_rate');
  expect('all clean punch record scores 1.0',
    { score: rework.score, detail: rework.detail },
    { score: 1, detail: 'All 3 reviewed punch items closed without rework' });
}
{
  const res = computeSubScorecards({ subcontractors: [sub({})], commitments: [], punchItems: [] });
  expect('no punch items at all → honest empty detail',
    factor(cardFor(res, 's1'), 'rework_rate').detail,
    'Not enough linked data yet — no punch items assigned to this sub');
}

console.log('\nschedule reliability:');
{
  // Task A: days 4-8 (Thu→Mon) = Thu, Fri, Mon = 3 working days, planned 5.
  // Task B: days 1-12 (Mon→Fri next week) = 10 working days, planned 5.
  // Σactual 13 vs Σplanned 10 → slip 0.3 → score 1 − 0.3/0.5 = 0.4.
  const res = computeSubScorecards({
    subcontractors: [sub({})],
    commitments: [],
    projects: [project([
      task({ id: 'A', actualStartDay: 4, actualEndDay: 8 }),
      task({ id: 'B', actualStartDay: 1, actualEndDay: 12 }),
    ])],
  });
  const sched = factor(cardFor(res, 's1'), 'schedule_reliability');
  expect('Σ-weighted slip through the working-day calendar',
    { applicable: sched.applicable, score: r4(sched.score), weight: sched.weight },
    { applicable: true, score: 0.4, weight: 0.2 });
  expect('detail shows the working-day math',
    sched.detail, 'Assigned tasks ran 30.0% over plan (13 vs 10 working days across 2 finished tasks)');
}
{
  // Early finish: days 1-3 = 3 working days vs 5 planned, twice → full marks.
  const res = computeSubScorecards({
    subcontractors: [sub({})],
    commitments: [],
    projects: [project([
      task({ id: 'A', actualStartDay: 1, actualEndDay: 3 }),
      task({ id: 'B', actualStartDay: 1, actualEndDay: 3 }),
    ])],
  });
  expect('finishing early earns 1.0, no extra credit',
    factor(cardFor(res, 's1'), 'schedule_reliability').score, 1);
}
{
  // Eligibility mirrors the pace book: not-done, missing stamps, inverted
  // pairs, milestones all excluded — leaving 1 measured task (< 2 needed).
  const res = computeSubScorecards({
    subcontractors: [sub({})],
    commitments: [],
    projects: [project([
      task({ id: 'A', actualStartDay: 1, actualEndDay: 5 }),
      task({ id: 'B', status: 'in_progress', actualStartDay: 1 }),
      task({ id: 'C', actualStartDay: 9, actualEndDay: 3 }),          // inverted
      task({ id: 'D', isMilestone: true, actualStartDay: 1, actualEndDay: 1 }),
      task({ id: 'E' }),                                              // no stamps
    ])],
  });
  const sched = factor(cardFor(res, 's1'), 'schedule_reliability');
  expect('pace-book eligibility rules; 1 measured of 2 needed',
    { applicable: sched.applicable, detail: sched.detail },
    { applicable: false, detail: 'Not enough linked data yet — 1 of 2 measured tasks needed' });
}
{
  const res = computeSubScorecards({
    subcontractors: [sub({})],
    commitments: [],
    projects: [project([task({ id: 'A', status: 'in_progress' }), task({ id: 'B', status: 'not_started' })])],
  });
  expect('linked but unmeasured tasks → as-built-dates detail',
    factor(cardFor(res, 's1'), 'schedule_reliability').detail,
    'Not enough linked data yet — 2 assigned tasks without as-built dates');
}

console.log('\npaperwork-only + blend:');
{
  // Zero commitments but real punch history: graded on performance, not
  // paperwork alone. Compliance = 0.4·0.4 + 0.4·0.4 + 0·0.2 = 0.32 (w 0.3);
  // rework = 1 (w 0.2) → score round((0.32·0.3 + 1·0.2)/0.5·100) = 59.
  const res = computeSubScorecards({
    subcontractors: [sub({})],
    commitments: [],
    punchItems: [punch({ id: 'a' }), punch({ id: 'b' }), punch({ id: 'c' })],
  });
  const card = cardFor(res, 's1');
  expect('performance data breaks paperwork-only mode',
    { score: card.score, topDriverIsPaperworkOnly: card.topDriver.startsWith('No job history yet') },
    { score: 59, topDriverIsPaperworkOnly: false });
}
{
  const res = computeSubScorecards({ subcontractors: [sub({})], commitments: [] });
  const card = cardFor(res, 's1');
  expect('no data anywhere → compliance-only grade with honest topDriver',
    { score: card.score, prefixed: card.topDriver.startsWith('No job history yet — graded on paperwork only.') },
    { score: 32, prefixed: true });
  expect('D7 factors omitted entirely → applicable:false, weight 0',
    card.factors.filter(f => f.key === 'rework_rate' || f.key === 'schedule_reliability')
      .map(f => ({ applicable: f.applicable, weight: f.weight })),
    [{ applicable: false, weight: 0 }, { applicable: false, weight: 0 }]);
}

console.log('\nlegacy factors unchanged:');
{
  const res = computeSubScorecards({
    subcontractors: [sub({})],
    commitments: [commitment({ changeAmount: 25_000 })],
  });
  const card = cardFor(res, 's1');
  expect('≥25% closed overrun zeroes cost discipline',
    factor(card, 'cost_discipline').score, 0);
  expect('≥20% CO growth zeroes CO impact',
    factor(card, 'co_impact').score, 0);
}

console.log('\nRFI responsiveness (sub attribution):');
{
  // Two answered RFIs, 2 days of sub-side hold each → mean 2d.
  const res = computeSubScorecards({
    subcontractors: [sub({}), sub({ id: 's2', companyName: 'Bravo Plumbing' })],
    commitments: [],
    rfis: [rfi({ id: 'a' }), rfi({ id: 'b' })],
  });
  const f = factor(cardFor(res, 's1'), 'rfi_responsiveness');
  expect('two measurable RFIs make it applicable', f.applicable, true);
  expect('2d mean hold scores 0.8 (zero-at 10d)', Math.round(f.score * 100) / 100, 0.8);
  expect('detail names the average', f.detail.includes('2.0d'), true);
  // Attribution: an RFI assigned to s1 must not score s2.
  expect('unassigned sub is not scored',
    factor(cardFor(res, 's2'), 'rfi_responsiveness').applicable, false);
}
{
  // ONE RFI is an anecdote, not a pattern.
  const res = computeSubScorecards({
    subcontractors: [sub({})], commitments: [], rfis: [rfi({})],
  });
  const f = factor(cardFor(res, 's1'), 'rfi_responsiveness');
  expect('one RFI is not enough', f.applicable, false);
  expect('…and carries no weight', f.weight, 0);
  expect('…with an honest reason', f.detail.includes('Not enough linked data'), true);
}
{
  // An RFI with no handoff chain is NOT measurable — 0 days means unknown.
  const res = computeSubScorecards({
    subcontractors: [sub({})], commitments: [],
    rfis: [rfi({ id: 'a', handoffs: [] }), rfi({ id: 'b', handoffs: [] })],
  });
  expect('unmeasurable RFIs never score a sub as instant',
    factor(cardFor(res, 's1'), 'rfi_responsiveness').applicable, false);
}
{
  // Legacy rows with no assignedSubId attribute to nobody.
  const res = computeSubScorecards({
    subcontractors: [sub({})], commitments: [],
    rfis: [rfi({ id: 'a', assignedSubId: undefined }), rfi({ id: 'b', assignedSubId: undefined })],
  });
  expect('RFIs without assignedSubId score nobody',
    factor(cardFor(res, 's1'), 'rfi_responsiveness').applicable, false);
}
{
  // Slow: 12 days of sub-side hold → past the 10d floor → 0.
  const slow = rfi({
    handoffs: [
      { at: '2026-07-01T00:00:00.000Z', fromParty: 'gc', toParty: 'sub' },
      { at: '2026-07-13T00:00:00.000Z', fromParty: 'sub', toParty: 'gc' },
    ],
  });
  const res = computeSubScorecards({
    subcontractors: [sub({})], commitments: [],
    rfis: [{ ...slow, id: 'a' }, { ...slow, id: 'b' }],
  });
  expect('12d mean hold floors the score at 0',
    factor(cardFor(res, 's1'), 'rfi_responsiveness').score, 0);
}
{
  // RFI data alone is a performance factor — the sub must NOT be graded as
  // paperwork-only just because they have no commitments.
  const res = computeSubScorecards({
    subcontractors: [sub({})], commitments: [], rfis: [rfi({ id: 'a' }), rfi({ id: 'b' })],
  });
  const card = cardFor(res, 's1');
  expect('RFI data alone lifts the sub out of paperwork-only',
    factor(card, 'compliance').weight < 1, true);
}

expect('grade bands hold', [gradeForScore(95), gradeForScore(85), gradeForScore(75), gradeForScore(65), gradeForScore(50)], ['A', 'B', 'C', 'D', 'F']);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
