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
import type { Backcharge } from '../utils/backcharges';

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

console.log('\nbackcharges (health lane H1.6):');
{
  // 3 signed commitments on 3 distinct projects, $100K each, open (no closed
  // work, so cost discipline does not apply; CO impact does).
  const three = [
    commitment({ id: 'c1', projectId: 'p1', status: 'active' as Commitment['status'] }),
    commitment({ id: 'c2', projectId: 'p2', status: 'active' as Commitment['status'] }),
    commitment({ id: 'c3', projectId: 'p3', status: 'active' as Commitment['status'] }),
  ];
  const bc = (over: Partial<Backcharge>): Backcharge => ({
    id: 'b1', projectId: 'p1', subId: 's1', subName: 'Acme Electric', commitmentId: null,
    reason: 'Cleanup', amountCents: 150_000, basis: 'typed', hours: null, rateCents: null,
    photoUri: null, photoId: null, punchItemId: null, status: 'open',
    appliedInvoiceId: null, appliedAt: null, createdAt: '2026-09-01T00:00:00Z', ...over,
  });

  // Below 3 projects → not applicable, honest detail, no weight.
  const two = computeSubScorecards({
    subcontractors: [sub({})],
    commitments: three.slice(0, 2),
    backcharges: [bc({})],
  });
  const f2 = factor(cardFor(two, 's1'), 'backcharges');
  expect('2 projects: not applicable, weight 0, "Not enough projects yet to judge backcharges"',
    { applicable: f2.applicable, weight: f2.weight, detail: f2.detail, label: f2.label },
    { applicable: false, weight: 0, detail: 'Not enough projects yet to judge backcharges', label: 'Backcharges' });
  {
    // Two commitments on ONE project + one on another = 2 distinct projects.
    const sameJob = computeSubScorecards({
      subcontractors: [sub({})],
      commitments: [three[0], { ...three[1], projectId: 'p1' }, three[2]],
      backcharges: [],
    });
    expect('projects are counted DISTINCT (3 commitments on 2 projects is not enough)',
      factor(cardFor(sameJob, 's1'), 'backcharges').applicable, false);
    const drafts = computeSubScorecards({
      subcontractors: [sub({})],
      commitments: [three[0], three[1], { ...three[2], status: 'draft' as Commitment['status'] }],
      backcharges: [],
    });
    expect('a draft commitment is not a project worked', factor(cardFor(drafts, 's1'), 'backcharges').applicable, false);
  }

  // 0 backcharges on 3 projects → full marks.
  const clean = computeSubScorecards({ subcontractors: [sub({})], commitments: three, backcharges: [] });
  const fc = factor(cardFor(clean, 's1'), 'backcharges');
  expect('0 backcharges on 3 projects: full marks, weight 0.15',
    { applicable: fc.applicable, score: fc.score, weight: fc.weight, detail: fc.detail },
    { applicable: true, score: 1, weight: 0.15, detail: 'No backcharges on 3 projects' });
  const four = computeSubScorecards({
    subcontractors: [sub({})],
    commitments: [...three, commitment({ id: 'c4', projectId: 'p4', status: 'active' as Commitment['status'] })],
    backcharges: [bc({ subId: 's2' })],
  });
  expect("another sub's backcharge is not this sub's: 'No backcharges on 4 projects'",
    factor(cardFor(four, 's1'), 'backcharges').detail, 'No backcharges on 4 projects');

  // Per-$100K maths: $300K signed; $1,500 open + $3,000 applied = $4,500 = 1.5%
  // → quality 1 − 0.015/0.03 = 0.5; 2 backcharges → 0.7 per $100K; $1.5K per $100K.
  const some = computeSubScorecards({
    subcontractors: [sub({})],
    commitments: three,
    backcharges: [
      bc({ id: 'b1', amountCents: 150_000 }),
      bc({ id: 'b2', amountCents: 300_000, status: 'applied', appliedInvoiceId: 'inv1', appliedAt: '2026-09-02T00:00:00Z' }),
      bc({ id: 'b3', amountCents: 9_000_000, status: 'void' }),
    ],
  });
  const fs = factor(cardFor(some, 's1'), 'backcharges');
  expect('open + applied count, void never: 1.5% of volume scores 0.5',
    { applicable: fs.applicable, score: r4(fs.score) }, { applicable: true, score: 0.5 });
  expect('detail names count, dollars, projects and the per-$100K rates',
    fs.detail, '2 backcharges ($4.5K) across 3 projects · 0.7 backcharges and $1.5K per $100K of signed work');
  const onlyVoid = computeSubScorecards({
    subcontractors: [sub({})], commitments: three, backcharges: [bc({ status: 'void', amountCents: 9_000_000 })],
  });
  expect('a voided backcharge alone leaves full marks', factor(cardFor(onlyVoid, 's1'), 'backcharges').score, 1);
  const heavy = computeSubScorecards({
    subcontractors: [sub({})], commitments: three, backcharges: [bc({ amountCents: 900_000 })],
  });
  expect('3% of volume (the zero-at line) scores 0', r4(factor(cardFor(heavy, 's1'), 'backcharges').score), 0);

  // The blend: CO impact (1.0, w 0.3) + compliance (0.32, w 0.3) + backcharges (0.5, w 0.15).
  expect('the factor joins the blend with weight 0.15',
    cardFor(some, 's1').score, Math.round(((1 * 0.3 + 0.32 * 0.3 + 0.5 * 0.15) / 0.75) * 100));

  // Omitted input → not applicable and the score is exactly what the other
  // factors make (the byte-identical guarantee for every existing caller).
  const omitted = computeSubScorecards({ subcontractors: [sub({})], commitments: three });
  const fo = factor(cardFor(omitted, 's1'), 'backcharges');
  expect('omitted input: not applicable, weight 0, says it was not counted',
    { applicable: fo.applicable, weight: fo.weight, detail: fo.detail },
    { applicable: false, weight: 0, detail: 'Backcharges not counted on this screen' });
  const others = cardFor(omitted, 's1').factors.filter(f => f.applicable && f.weight > 0);
  expect('omitted input: score = the blend of the other factors alone',
    cardFor(omitted, 's1').score,
    Math.round((others.reduce((s, f) => s + f.score * f.weight, 0) / others.reduce((s, f) => s + f.weight, 0)) * 100));
  const strip = (c: SubScorecard) => ({ ...c, factors: c.factors.filter(f => f.key !== 'backcharges') });
  expect('omitted input vs a list that does not apply (2 projects): identical card apart from the factor detail',
    strip(cardFor(computeSubScorecards({ subcontractors: [sub({})], commitments: three.slice(0, 2) }), 's1')),
    strip(cardFor(two, 's1')));
  // Every fixture above that predates the factor, re-run with backcharges
  // omitted, keeps its pinned numbers: 59 (punch-only) and 32 (paperwork only).
  expect('pre-factor fixtures keep their scores (59 / 32)',
    [
      cardFor(computeSubScorecards({ subcontractors: [sub({})], commitments: [], punchItems: [punch({ id: 'a' }), punch({ id: 'b' }), punch({ id: 'c' })] }), 's1').score,
      cardFor(computeSubScorecards({ subcontractors: [sub({})], commitments: [] }), 's1').score,
    ],
    [59, 32]);
  expect('the backcharges factor never becomes the top driver when it does not apply',
    cardFor(omitted, 's1').factors[0].key !== 'backcharges' && cardFor(two, 's1').topDriver === cardFor(omitted, 's1').topDriver
      ? true : cardFor(two, 's1').topDriver, true);
  expect('backcharge data alone does not lift a sub out of paperwork-only below 3 projects',
    cardFor(computeSubScorecards({ subcontractors: [sub({})], commitments: [], backcharges: [bc({})] }), 's1').topDriver.startsWith('No job history yet'), true);
}

expect('grade bands hold', [gradeForScore(95), gradeForScore(85), gradeForScore(75), gradeForScore(65), gradeForScore(50)], ['A', 'B', 'C', 'D', 'F']);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
