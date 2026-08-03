// validate-recovered-value.ts — pins the honesty rules on the "MAGE recovered
// $X for you" number.
//
// WHY THESE ARE TESTS AND NOT COMMENTS: this figure is a claim the product makes
// about its own worth, shown to a contractor deciding whether to keep paying. If
// it can be inflated — by counting a CO a human wrote, by counting one the owner
// hasn't signed, by counting a credit backwards — it becomes marketing, and the
// contractor's trust in every other number in the app goes with it.
//
// Run: bun run scripts/validate-recovered-value.ts
import { computeRecoveredValue, recoveredHeadline, recoveredPendingLine } from '../utils/recoveredValue';
import type { ChangeOrder, ChangeOrderStatus, Project } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const NOW = '2026-08-03T12:00:00.000Z';
const AUTO_DRAFT_ACTION = 'auto_drafted_from_leak';

const projects: Project[] = [
  { id: 'p1', name: 'Maple St' } as Project,
  { id: 'p2', name: 'Henderson' } as Project,
];

function co(over: Partial<ChangeOrder> & { id: string; status: ChangeOrderStatus }): ChangeOrder {
  return {
    number: 1, projectId: 'p1', date: NOW, description: '', reason: '',
    lineItems: [], originalContractValue: 0, changeAmount: 1000,
    newContractTotal: 0, createdAt: NOW, updatedAt: NOW,
    ...over,
  } as ChangeOrder;
}

/** A CO carrying the marker leakCoDraft stamps — i.e. MAGE wrote it. */
function auto(over: Partial<ChangeOrder> & { id: string; status: ChangeOrderStatus }): ChangeOrder {
  return co({
    ...over,
    auditTrail: [
      { id: 'a1', action: AUTO_DRAFT_ACTION, actor: 'MAGE', timestamp: NOW, detail: 'r1' },
      ...(over.auditTrail ?? []),
    ],
  } as Partial<ChangeOrder> & { id: string; status: ChangeOrderStatus });
}

console.log('\nrecovered value:');

// ── The core claim: only MAGE-drafted AND owner-approved counts ──────────────
{
  const v = computeRecoveredValue(projects, [
    auto({ id: '1', status: 'approved', changeAmount: 2400 }),
    auto({ id: '2', status: 'approved', changeAmount: 1800 }),
  ], { nowISO: NOW });
  ok('approved auto-drafted COs sum into the headline', v.total === 4200, `got ${v.total}`);
  ok('and are counted', v.count === 2, `got ${v.count}`);
  ok('rows carry the project name', v.rows.every(r => r.projectName === 'Maple St'));
}

// ── The inflation guards. Each of these would make the number a lie. ─────────
{
  const v = computeRecoveredValue(projects, [
    co({ id: 'h', status: 'approved', changeAmount: 9999 }), // human wrote it
  ], { nowISO: NOW });
  ok('a hand-written CO NEVER counts as recovered by MAGE', v.total === 0, `got ${v.total}`);
  ok('but it is tracked separately as manual', v.manualTotal === 9999, `got ${v.manualTotal}`);
  ok('and hasData stays false with no MAGE wins', v.hasData === false);
}

{
  const statuses: ChangeOrderStatus[] = ['draft', 'submitted', 'under_review', 'rejected', 'void', 'revised'];
  const v = computeRecoveredValue(
    projects,
    statuses.map((s, i) => auto({ id: `s${i}`, status: s, changeAmount: 500 })),
    { nowISO: NOW },
  );
  ok('no unapproved status is ever counted as recovered', v.total === 0, `got ${v.total}`);
  // submitted + under_review are "with the owner"; draft/rejected/void/revised are not.
  ok('only owner-held COs count as pending', v.pendingCount === 2, `got ${v.pendingCount}`);
  ok('a REVISED co is not pending — it is back in negotiation', v.pendingTotal === 1000, `got ${v.pendingTotal}`);
}

{
  const v = computeRecoveredValue(projects, [
    auto({ id: 'c', status: 'approved', changeAmount: -5000 }), // credit CO
    auto({ id: 'z', status: 'approved', changeAmount: 0 }),
    auto({ id: 'n', status: 'approved', changeAmount: Number.NaN }),
  ], { nowISO: NOW });
  ok('a credit CO cannot drag the recovered number negative', v.total === 0, `got ${v.total}`);
  ok('zero and NaN amounts are ignored, not summed', v.count === 0, `got ${v.count}`);
}

// ── Windowing ────────────────────────────────────────────────────────────────
{
  const old = '2026-01-01T00:00:00.000Z';
  const rows = [
    auto({ id: 'recent', status: 'approved', changeAmount: 1000, updatedAt: NOW }),
    auto({ id: 'old', status: 'approved', changeAmount: 7000, updatedAt: old, date: old }),
  ];
  const windowed = computeRecoveredValue(projects, rows, { nowISO: NOW, windowDays: 90 });
  ok('a 90-day window excludes an older win', windowed.total === 1000, `got ${windowed.total}`);
  const allTime = computeRecoveredValue(projects, rows, { nowISO: NOW });
  ok('no window means all-time', allTime.total === 8000, `got ${allTime.total}`);
}

{
  // An unparseable date must not silently vanish — that would understate the
  // number for a reason the contractor cannot see or correct.
  const v = computeRecoveredValue(projects, [
    auto({ id: 'bad', status: 'approved', changeAmount: 1234, updatedAt: 'not-a-date', date: '', createdAt: '' }),
  ], { nowISO: NOW, windowDays: 30 });
  ok('an unparseable date is kept, never silently dropped', v.total === 1234, `got ${v.total}`);
}

// ── Ordering, naming, and shape ──────────────────────────────────────────────
{
  const v = computeRecoveredValue(projects, [
    auto({ id: 'a', status: 'approved', changeAmount: 100, updatedAt: '2026-07-01T00:00:00.000Z' }),
    auto({ id: 'b', status: 'approved', changeAmount: 100, updatedAt: '2026-08-01T00:00:00.000Z' }),
  ], { nowISO: NOW });
  ok('newest win sorts first', v.rows[0]?.id === 'b', `got ${v.rows[0]?.id}`);
}

{
  const v = computeRecoveredValue([], [
    auto({ id: 'x', status: 'approved', changeAmount: 100, projectId: 'ghost' }),
  ], { nowISO: NOW });
  ok('a CO on a missing project still counts, with a safe label',
    v.total === 100 && v.rows[0]?.projectName === 'Unknown project');
}

{
  const empty = computeRecoveredValue(projects, [], { nowISO: NOW });
  ok('empty input is empty, not a crash', empty.total === 0 && empty.hasData === false);
  ok('headline is null when there is nothing earned', recoveredHeadline(empty) === null);
  ok('pending line is null when nothing is pending', recoveredPendingLine(empty) === null);
}

// ── Copy ─────────────────────────────────────────────────────────────────────
{
  const v = computeRecoveredValue(projects, [
    auto({ id: '1', status: 'approved', changeAmount: 12400 }),
    auto({ id: '2', status: 'submitted', changeAmount: 3000 }),
  ], { nowISO: NOW });
  const h = recoveredHeadline(v, 'this quarter') ?? '';
  ok('headline states the money and the window', h.includes('$12,400') && h.includes('this quarter'), h);
  ok('headline says BILLED, not "found" alone — the claim is an outcome', h.includes('you billed'), h);
  ok('headline has no hype punctuation', !h.includes('!'), h);
  const p = recoveredPendingLine(v) ?? '';
  ok('pending line names the amount still with the client', p.includes('$3,000'), p);
  // Singular/plural
  const one = computeRecoveredValue(projects, [auto({ id: '1', status: 'approved', changeAmount: 500 })], { nowISO: NOW });
  ok('singular grammar for one CO', (recoveredHeadline(one) ?? '').includes('1 change order —') ||
    (recoveredHeadline(one) ?? '').includes('1 change order'), recoveredHeadline(one) ?? '');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
