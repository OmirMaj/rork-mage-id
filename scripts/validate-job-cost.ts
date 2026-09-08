// scripts/validate-job-cost.ts — equipment days and permit fees are ACTUAL
// job cost, and the phase sheet names WHICH records built each line.
//
// WHY THIS EXISTS. Two findings from docs/audits/2026-09-07-app-experience-
// audit.md, both in the "worth doing" tier, both about the same screen:
//
//   MONEY-EQP-1 / MONEY-PMT-1 (#12) — `logUtilization` writes hours against a
//     projectId and `Permit.fee` is typed in on every permit, and neither ever
//     reached utils/jobCostEngine. A GC self-performing excavation ran a
//     $450/day machine for six days and saw $0 of it in that job's actuals;
//     every permit he pulled cost the job nothing. Both omissions understate
//     cost in the direction that makes a bleeding job look healthy, and the
//     same `actual` feeds the CPI, the margin alerts and the WIP row a bank
//     reads.
//
//   MONEY-DRILL-1 (#25) — the phase sheet printed "Commitments 3, Material
//     receipts 7" with no tap target, so a PM reading "Electrical over by
//     $9,200" reconciled by hand in another tab. `JobCostLine.sources` is now
//     record ids, and the drill-down opens them.
//
// Pins INTENDED semantics:
//   • equipment cost = logged hours ÷ 8 × dailyRate, for THIS project only.
//   • a machine with no day rate contributes ZERO — never a guessed rate.
//   • a permit fee is cost the day it is paid, in every status (a denial is
//     not a refund).
//   • omitting either input reproduces the pre-fix engine byte for byte.
//   • sources are ids that resolve to the records that actually contributed,
//     deduped, so `.length` is a count of RECORDS.
//   • the screen forwards both inputs and renders the drill-down.
//
// Run via: bun run scripts/validate-job-cost.ts
//
// (scripts/validate-job-cost-variance.ts is a different file and a different
// question — it pins the SIGN of the variance and the status-pill tokens.)

import { computeJobCost, EQUIPMENT_HOURS_PER_DAY } from '../utils/jobCostEngine';
import type {
  Project, LinkedEstimate, Commitment, MaterialReceipt, Equipment, Permit, Invoice,
} from '../types';
// fileURLToPath + join because the repo path contains a space.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Source with comments dropped — for checks about what the CODE does, and
 *  about copy a GC reads rather than what the file explains to a developer. */
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function expect<T>(name: string, got: T, want: T) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log('  ✓', name); }
  else {
    fail++;
    console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want));
  }
}
function close(name: string, got: number, want: number, tol = 0.01) {
  ok(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);
}

// ── Fixtures ─────────────────────────────────────────────────────────────
// The audit's own example: a GC self-performing excavation on a $420,000 job.

function estimate(items: { category: string; unitPrice: number }[]): LinkedEstimate {
  const baseTotal = items.reduce((s, i) => s + i.unitPrice, 0);
  return {
    id: 'est', items: items.map((i, n) => ({
      materialId: `m${n}`, name: i.category, category: i.category, unit: 'ls',
      quantity: 1, unitPrice: i.unitPrice, bulkPrice: i.unitPrice, markup: 0,
      usesBulk: false, lineTotal: i.unitPrice, supplier: '',
    })),
    globalMarkup: 0, baseTotal, markupTotal: 0, grandTotal: baseTotal,
    createdAt: '2026-01-01T00:00:00.000Z',
  } as LinkedEstimate;
}

const PROJECT = {
  id: 'p1', name: 'Henderson Remodel', status: 'in_progress',
  linkedEstimate: estimate([{ category: 'Framing', unitPrice: 300_000 }, { category: 'Finishes', unitPrice: 120_000 }]),
} as unknown as Project;

const BASE = { project: PROJECT, commitments: [] as Commitment[], changeOrders: [] };

function sub(id: string, amount: number, paidToDate: number, phase: string): Commitment {
  return {
    id, projectId: 'p1', number: 'SC-1', type: 'subcontract',
    description: `${phase} package`, amount, paidToDate, phase, status: 'active',
    signedDate: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  } as unknown as Commitment;
}

/** A machine with logged shifts. `hours` entries land on `projectId`. */
function machine(
  id: string, dailyRate: number,
  log: { id: string; projectId: string; hoursUsed: number }[],
  over: Partial<Equipment> = {},
): Equipment {
  return {
    id, name: `Machine ${id}`, type: 'owned', category: 'excavation',
    make: 'CAT', model: '305', dailyRate, maintenanceSchedule: [],
    utilizationLog: log.map(u => ({ ...u, equipmentId: id, date: '2026-03-02' })),
    status: 'in_use', createdAt: '2026-01-01', ...over,
  } as unknown as Equipment;
}

function permit(id: string, fee: number, over: Partial<Permit> = {}): Permit {
  return {
    id, projectId: 'p1', projectName: 'Henderson Remodel', type: 'building',
    jurisdiction: 'City of Henderson', status: 'approved', appliedDate: '2026-02-01',
    fee, ...over,
  } as unknown as Permit;
}

function receipt(
  id: string,
  lines: { category: string; lineTotal: number }[],
  commitmentId?: string,
): MaterialReceipt {
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  return {
    id, projectId: 'p1', vendor: 'Supply Co', commitmentId,
    lines: lines.map((l, n) => ({
      id: `${id}-l${n}`, description: 'Lumber', category: l.category,
      quantity: 1, unit: 'ls', unitPrice: l.lineTotal, lineTotal: l.lineTotal,
    })),
    subtotal, total: subtotal, status: 'reviewed',
  } as unknown as MaterialReceipt;
}

const equipmentPhase = (jc: ReturnType<typeof computeJobCost>) => jc.byPhase.find(p => p.phase === 'Equipment');
const permitPhase = (jc: ReturnType<typeof computeJobCost>) => jc.byPhase.find(p => p.phase === 'Permits');

// ── 1. Equipment days are actual cost (MONEY-EQP-1) ──────────────────────

console.log('\nequipment time is job cost (MONEY-EQP-1):');
{
  // The audit's machine: $450/day, six 8-hour days on this job.
  const excavator = machine('eq1', 450, [
    { id: 'u1', projectId: 'p1', hoursUsed: 8 },
    { id: 'u2', projectId: 'p1', hoursUsed: 8 },
    { id: 'u3', projectId: 'p1', hoursUsed: 8 },
    { id: 'u4', projectId: 'p1', hoursUsed: 8 },
    { id: 'u5', projectId: 'p1', hoursUsed: 8 },
    { id: 'u6', projectId: 'p1', hoursUsed: 8 },
  ]);
  const jc = computeJobCost({ ...BASE, equipment: [excavator] });
  close('a $450/day machine run six 8-hour days is $2,700 of actual cost', jc.actual, 2_700);
  close('…on its own "Equipment" phase line', equipmentPhase(jc)?.actual ?? -1, 2_700);
  expect('…and the phase names the six utilization entries, not a count',
    equipmentPhase(jc)?.sources.equipment, ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']);
  ok('…and with no estimate line for it, the phase reads unbudgeted, not on track',
    equipmentPhase(jc)?.status === 'unbudgeted', equipmentPhase(jc)?.status);

  // THE MUTATION THIS SECTION EXISTS FOR: counting log ROWS instead of hours.
  // contexts/ProjectContext.getEquipmentCostForProject does exactly that
  // (`Math.max(daysUsed, 1)` over row count), which bills a full day for a
  // one-hour lift. Half-days must not round up to days.
  const halfDays = machine('eq2', 400, [
    { id: 'h1', projectId: 'p1', hoursUsed: 4 },
    { id: 'h2', projectId: 'p1', hoursUsed: 4 },
  ]);
  close('two half-days at $400/day is one day of cost, not two',
    computeJobCost({ ...BASE, equipment: [halfDays] }).actual, 400);
  const oneHour = machine('eq3', 800, [{ id: 'q1', projectId: 'p1', hoursUsed: 1 }]);
  close('a single logged hour on an $800/day machine is $100, not $800',
    computeJobCost({ ...BASE, equipment: [oneHour] }).actual, 100);
  ok(`the hours-to-day divisor is ${EQUIPMENT_HOURS_PER_DAY}, matching AIEquipmentAdvice.measuredUsage`,
    EQUIPMENT_HOURS_PER_DAY === 8);
}
{
  // Hours alone carry no dollars. The add form allows a $0 rate
  // (`parseFloat(newDailyRate) || 0`, app/(tabs)/equipment/index.tsx), and a
  // rate we do not have must produce nothing rather than a confident $0 line.
  const unrated = machine('eq4', 0, [{ id: 'z1', projectId: 'p1', hoursUsed: 40 }]);
  const jc = computeJobCost({ ...BASE, equipment: [unrated] });
  close('a machine with no day rate adds $0', jc.actual, 0);
  ok('…and opens no Equipment phase at all', equipmentPhase(jc) === undefined);
}
{
  // Another job's hours are another job's cost.
  const shared = machine('eq5', 500, [
    { id: 'a1', projectId: 'p1', hoursUsed: 8 },
    { id: 'b1', projectId: 'p2', hoursUsed: 80 },
  ]);
  const jc = computeJobCost({ ...BASE, equipment: [shared] });
  close('utilization logged against a DIFFERENT project stays there', jc.actual, 500);
  expect('…and only this project’s entry is named', equipmentPhase(jc)?.sources.equipment, ['a1']);
}
{
  // An estimate that DID budget equipment gets a budgeted line, not a second
  // unbudgeted one beside it.
  const withBudget = {
    ...PROJECT,
    linkedEstimate: estimate([{ category: 'Equipment', unitPrice: 5_000 }]),
  } as unknown as Project;
  const jc = computeJobCost({
    project: withBudget, commitments: [], changeOrders: [],
    equipment: [machine('eq6', 450, [{ id: 'w1', projectId: 'p1', hoursUsed: 16 }])],
  });
  const eq = jc.byPhase.find(p => p.phase === 'Equipment');
  expect('a budgeted "Equipment" estimate category absorbs the machine cost',
    eq ? [eq.budget, eq.actual, eq.status] : null, [5_000, 900, 'on_track']);
  ok('…and there is exactly ONE Equipment line', jc.byPhase.filter(p => p.phase === 'Equipment').length === 1);
}

// ── 2. Permit fees are actual cost (MONEY-PMT-1) ─────────────────────────

console.log('\npermit fees are job cost (MONEY-PMT-1):');
{
  const jc = computeJobCost({
    ...BASE,
    permits: [permit('pm1', 2_400), permit('pm2', 615, { type: 'electrical' })],
  });
  close('permit fees sum into actual cost', jc.actual, 3_015);
  close('…on a "Permits" phase line', permitPhase(jc)?.actual ?? -1, 3_015);
  expect('…naming both permits', permitPhase(jc)?.sources.permits, ['pm1', 'pm2']);
}
{
  // A denied application is not refunded, and a lapsed permit was still paid
  // for. Filtering by status would silently delete money already spent — the
  // same class of error as the omission this fix closes.
  const jc = computeJobCost({
    ...BASE,
    permits: [
      permit('d1', 900, { status: 'denied' }),
      permit('e1', 300, { status: 'expired' }),
      permit('a1', 100, { status: 'applied' }),
    ],
  });
  close('denied, expired and pending permits all count as spent', jc.actual, 1_300);
}
{
  const jc = computeJobCost({
    ...BASE,
    permits: [permit('other', 5_000, { projectId: 'p2' }), permit('mine', 400)],
  });
  close('a permit on another project is not this job’s cost', jc.actual, 400);
  expect('…and is not named on the phase', permitPhase(jc)?.sources.permits, ['mine']);
  const zero = computeJobCost({ ...BASE, permits: [permit('free', 0)] });
  ok('a $0 permit opens no phase (nothing was paid)', permitPhase(zero) === undefined);
}

// ── 3. Both are ADDITIVE — omitting them changes nothing ─────────────────
// The way this fix goes wrong is a default that is not empty, or a phase that
// materialises at $0 and drags a project's phase list around.

console.log('\nthe new inputs are additive:');
{
  const commitments = [sub('c1', 300_000, 180_000, 'Framing')];
  const bare = computeJobCost({ ...BASE, commitments });
  const withEmpty = computeJobCost({ ...BASE, commitments, equipment: [], permits: [] });
  expect('passing empty equipment/permits is byte-identical to omitting them',
    JSON.stringify({ ...withEmpty, asOf: 'x' }), JSON.stringify({ ...bare, asOf: 'x' }));
  const withData = computeJobCost({
    ...BASE, commitments,
    equipment: [machine('eq7', 450, [{ id: 'p1u', projectId: 'p1', hoursUsed: 48 }])],
    permits: [permit('pmx', 2_400)],
  });
  close('…and with data, actual is subs + equipment + permits',
    withData.actual, 180_000 + 2_700 + 2_400);
  close('…while committed is untouched by either', withData.committed, bare.committed);
  close('…and budget is untouched by either', withData.budget, bare.budget);
}
{
  // Regression tie-in to MONEY-DEF-1: adding cost sources must not reopen the
  // revenue door. A client payment still moves nothing.
  const paid = {
    id: 'inv1', number: 1, projectId: 'p1', type: 'progress',
    issueDate: '2026-03-01', dueDate: '2026-03-31', paymentTerms: 'net_30', notes: '',
    lineItems: [{ id: 'l1', name: 'Progress', description: '', quantity: 1, unit: 'ls', unitPrice: 250_000, total: 250_000 }],
    subtotal: 250_000, taxRate: 0, taxAmount: 0, totalDue: 250_000, amountPaid: 250_000,
    status: 'sent', payments: [], createdAt: '2026-03-01', updatedAt: '2026-03-01',
  } as unknown as Invoice;
  const jc = computeJobCost({ ...BASE, invoices: [paid], permits: [permit('pm9', 400)] });
  close('a $250,000 client payment beside a $400 permit leaves actual at $400', jc.actual, 400);
}

// ── 3b. Direct cost buys down the budget, it is not stacked on it ────────
// EAC-DIRECT-1, found while wiring the two inputs above. The uncommitted
// remainder was `budget - committed` flat, so every dollar of direct cost —
// receipts, crew hours, equipment, permits — landed ON TOP of the whole
// budget. This is the reason the audit said to do #12 AFTER the actuals fix:
// correct cost on an incorrect base reads as an overrun that isn't there.

console.log('\ndirect cost is spent budget, not extra budget (EAC-DIRECT-1):');
{
  const budgeted = {
    ...PROJECT,
    linkedEstimate: estimate([{ category: 'Permits', unitPrice: 3_000 }]),
  } as unknown as Project;
  const jc = computeJobCost({
    project: budgeted, commitments: [], changeOrders: [], permits: [permit('pm1', 3_015)],
  });
  close('$3,000 budgeted and $3,015 paid projects $3,015 — not $6,015',
    permitPhase(jc)?.projectedFinal ?? -1, 3_015);
  close('…so the variance is the $15 overrun, not the whole permit again',
    jc.variance, 15);
}
{
  // A commitment payment must still buy down the COMMITMENT, and a receipt
  // must not. Charging the whole actual against the commitment balance let a
  // lumber receipt shrink a sub's remaining contract.
  const commitments = [sub('c1', 200_000, 100_000, 'Framing')];
  const withReceipt = computeJobCost({
    project: { ...PROJECT, linkedEstimate: estimate([{ category: 'Framing', unitPrice: 300_000 }]) } as unknown as Project,
    commitments, changeOrders: [], receipts: [receipt('r1', [{ category: 'Framing', lineTotal: 40_000 }])],
  });
  const framing = withReceipt.byPhase.find(p => p.phase === 'Framing');
  // 140,000 spent + 100,000 left on the sub + (300,000 - 200,000 - 40,000).
  close('paid $100k of a $200k sub plus a $40k receipt against $300k budget projects $300k',
    framing?.projectedFinal ?? -1, 300_000);
  close('…and reports on budget, not $40,000 over', withReceipt.variance, 0);
}
{
  // …and the OTHER half of the same split, which the first cut got backwards.
  // A receipt SNAPPED to a commitment (`commitmentId` set) is material
  // delivered against that PO. Treating it as direct left the entire PO
  // standing as remaining exposure AND subtracted the receipt from the
  // uncommitted budget, so a job that is exactly on budget reported an
  // overrun the size of its own deliveries. The unlinked case above and this
  // one have to be pulled apart or one of them is always wrong.
  const commitments = [sub('c1', 10_000, 0, 'Framing')];
  const linked = computeJobCost({
    project: { ...PROJECT, linkedEstimate: estimate([{ category: 'Framing', unitPrice: 10_000 }]) } as unknown as Project,
    commitments, changeOrders: [],
    receipts: [receipt('r1', [{ category: 'Framing', lineTotal: 6_000 }], 'c1')],
  });
  const framing = linked.byPhase.find(p => p.phase === 'Framing');
  close('a $6,000 receipt snapped to a $10,000 PO still projects $10,000',
    framing?.projectedFinal ?? -1, 10_000);
  close('…and reports on budget, not $6,000 over', linked.variance, 0);
  close('…while the $6,000 counts as actual cost paid out', framing?.actual ?? -1, 6_000);
  // The same money on an UNLINKED receipt has no PO behind it, so it buys down
  // the budget instead. Both land at $10,000 here — by two different routes,
  // which is the point of tracking direct cost separately at all.
  const unlinked = computeJobCost({
    project: { ...PROJECT, linkedEstimate: estimate([{ category: 'Framing', unitPrice: 10_000 }]) } as unknown as Project,
    commitments, changeOrders: [],
    receipts: [receipt('r2', [{ category: 'Framing', lineTotal: 6_000 }])],
  });
  close('…and an unlinked receipt of the same size does not double-count either',
    unlinked.byPhase.find(p => p.phase === 'Framing')?.projectedFinal ?? -1, 16_000);
}
{
  // The identity that keeps this from being a rewrite: on a phase whose only
  // actual is commitment payments — every phase the pre-MONEY-DEF-1 engine
  // had — the split formula produces exactly the old number.
  const commitments = [sub('c1', 300_000, 180_000, 'Framing')];
  const jc = computeJobCost({ ...BASE, commitments });
  const framing = jc.byPhase.find(p => p.phase === 'Framing');
  close('a commitments-only phase is unchanged by the split', framing?.projectedFinal ?? -1, 300_000);
  close('…and an over-committed phase still collapses to committed',
    computeJobCost({ ...BASE, commitments: [sub('c2', 340_000, 0, 'Framing')] })
      .byPhase.find(p => p.phase === 'Framing')?.projectedFinal ?? -1,
    340_000);
}

// ── 4. sources are ids that resolve (MONEY-DRILL-1) ──────────────────────

console.log('\nthe phase sheet names WHICH records built the line (MONEY-DRILL-1):');
{
  const commitments = [sub('c-elec', 60_000, 51_200, 'Electrical'), sub('c-fram', 300_000, 10_000, 'Framing')];
  const jc = computeJobCost({
    ...BASE, commitments,
    receipts: [receipt('r1', [{ category: 'Framing', lineTotal: 4_000 }])],
    permits: [permit('pm1', 900)],
  });
  const elec = jc.byPhase.find(p => p.phase === 'Electrical');
  expect('the over-budget phase names its commitment by id', elec?.sources.commitments, ['c-elec']);
  const framing = jc.byPhase.find(p => p.phase === 'Framing');
  expect('…and the framing phase names its commitment and its receipt',
    framing ? [framing.sources.commitments, framing.sources.receipts] : null,
    [['c-fram'], ['r1']]);
  ok('every id on every phase resolves to a real record',
    jc.byPhase.every(p =>
      p.sources.commitments.every(id => commitments.some(c => c.id === id))
      && p.sources.receipts.every(id => id === 'r1')
      && p.sources.permits.every(id => id === 'pm1')),
    JSON.stringify(jc.byPhase.map(p => [p.phase, p.sources])));
}
{
  // A receipt with two lines in the SAME category contributed twice under the
  // old counter, so "Material receipts 7" could mean four receipts. `.length`
  // is a count of records or it is not a count of anything.
  const split = receipt('rsplit', [
    { category: 'Framing', lineTotal: 1_000 },
    { category: 'Framing', lineTotal: 2_000 },
    { category: 'Finishes', lineTotal: 500 },
  ]);
  const jc = computeJobCost({ ...BASE, receipts: [split] });
  const framing = jc.byPhase.find(p => p.phase === 'Framing');
  const finishes = jc.byPhase.find(p => p.phase === 'Finishes');
  expect('a receipt with two lines in one phase is named once there',
    framing?.sources.receipts, ['rsplit']);
  close('…while both line totals still count as cost', framing?.actual ?? -1, 3_000);
  expect('…and the same receipt is also named on the other phase it touched',
    finishes?.sources.receipts, ['rsplit']);
}

// ── 5. Source-level: the screen actually forwards and renders it ─────────
// The arithmetic above passes with the screen wired to nothing.

console.log('\nthe Job Costing screen forwards both inputs and opens the records:');
{
  const screen = stripComments(read('app/job-costing.tsx'));
  ok('app/job-costing.tsx pulls equipment and permits from ProjectContext',
    /equipment,\s*permits,/.test(screen),
    'both are on useProjects() and were read by nothing on this screen');
  ok('…and forwards them into computeJobCost',
    /computeJobCost\(\{[\s\S]{0,400}equipment,\s*permits,[\s\S]{0,40}\}\)/.test(screen),
    'a screen that computes without them under-reports by exactly that money');
  ok('…and lists them in the useMemo deps, so logging a shift re-costs the job',
    /\},\s*\[[^\]]*equipment,\s*permits\]\)/.test(screen));

  ok('the phase sheet reads sources as ids, never as a bare count',
    !/sources\.(commitments|changeOrders|receipts|timeEntries|equipment|permits)\}/.test(screen),
    'printing the array itself is the bug this replaced');
  ok('…and resolves each id against the records it was given',
    /buildPhaseDrill\(/.test(screen) && /records\.commitments\.find/.test(screen));
  // Anchored to `g.rows.map`, not just to the presence of `row.onPress`:
  // pointing the map at an empty array left every other assertion green while
  // rendering nothing (caught while mutation-testing this guard).
  ok('…and every drill group renders its own rows, pressable',
    /testID=\{`phase-drill-\$\{g\.key\}`\}/.test(screen)
    && /\{g\.rows\.map\(row =>/.test(screen)
    && /onPress=\{row\.onPress\}/.test(screen));
  ok('…built from the selected phase’s own source ids',
    /buildPhaseDrill\(line, records,/.test(screen),
    'a drill-down fed from anything but this line is a different phase’s answer');
  // A row that opens the WRONG screen is the same dead end as a row that opens
  // nothing. A crew row IS a TimeEntry, and app/crew.tsx is the crew-member
  // directory — it renders no shift at all. The first cut pointed there.
  ok('a crew-shift row opens the screen the shift actually lives on',
    /crew:\s*\(\)\s*=>\s*\{[^}]*pathname:\s*'\/time-tracking'/.test(screen),
    '/crew is the crew-member roster; TimeEntry records are on /time-tracking');
  ok('…and an equipment row opens that machine, not the equipment list',
    /pathname:\s*'\/equipment-detail',\s*params:\s*\{\s*equipmentId\s*\}/.test(screen),
    'app/equipment-detail.tsx reads `equipmentId` off the route');
  // The drill formats FIVE date fields written in TWO shapes: bare
  // 'YYYY-MM-DD' (Permit.appliedDate via todayCalendarDay, TimeEntry.date via
  // toISOString().split('T')[0]) and full instants (ChangeOrder.date,
  // EquipmentUtilizationEntry.date). `Date.parse` on the bare shape is UTC
  // midnight, which toLocaleDateString prints as the PREVIOUS day west of
  // Greenwich — a Sep 4 shift listed under Sep 3, beside the money it cost.
  // The first cut did exactly that, and validate-calendar-date's scanner does
  // not reach it because the value arrives as a plain parameter.
  ok('…and every date in the drill goes through the mixed-shape helper',
    /const shortDate = \([\s\S]{0,200}calendarDayStart\(/.test(screen)
    && !/const shortDate = \([\s\S]{0,200}Date\.parse\(/.test(screen),
    'Date.parse names the day before for every bare YYYY-MM-DD field here');
  ok('…and the equipment note admits the one overlap it cannot detect',
    /rental invoice as a PO or a receipt/.test(screen),
    'nothing links Equipment to a Commitment, so only the GC can see that double-count');

  // The footer note is the only place the screen defines "Actual" for a GC.
  // Comments are stripped: this is copy a user reads.
  ok('the footer note names equipment days and permit fees as actual cost',
    /equipment days/i.test(screen) && /permit fees/i.test(screen),
    'the definition on screen has to match the arithmetic behind it');
  ok('…and still says client payments are counted nowhere here',
    /revenue\s+and are counted nowhere on this screen/.test(screen.replace(/\s+/g, ' ')),
    'MONEY-DEF-1 disclosure must survive this change');
}
{
  const engine = stripComments(read('utils/jobCostEngine.ts'));
  ok('the engine never invents a day rate for an unrated machine',
    /if \(rate <= 0\) continue;/.test(engine),
    'hours alone carry no dollars — the same refusal AIEquipmentAdvice makes');
  ok('…and never filters permits by status',
    !/permits[\s\S]{0,200}p\.status ===/.test(engine),
    'a denied permit is not refunded');
  ok('…and still reads no invoice payment (MONEY-DEF-1 holds)',
    !/\bamountPaid\b/.test(engine));
}

console.log(`\nvalidate-job-cost: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
