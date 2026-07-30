// validate-drafted-revenue.ts — pins utils/draftedRevenue.ts.
// The "$X in change orders ready to send" payoff surface for the leak→CO
// autonomy. Run: bun run scripts/validate-drafted-revenue.ts
import { buildReadyToBill } from '../utils/draftedRevenue';
import { AUTO_DRAFT_ACTION } from '../utils/brain/leakCoDraft';
import type { ChangeOrder, Project } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}

const projects = [
  { id: 'p1', name: 'Oak Kitchen' },
  { id: 'p2', name: 'Elm Bath' },
] as unknown as Project[];

const auto = (id: string, num: number, projectId: string, amount: number, createdAt: string): ChangeOrder =>
  ({ id, number: num, projectId, status: 'draft', changeAmount: amount, createdAt, date: createdAt,
     auditTrail: [{ id: 'a' + id, action: AUTO_DRAFT_ACTION, actor: 'MAGE', timestamp: createdAt, detail: 'r' }] } as unknown as ChangeOrder);
const manual = (id: string, num: number, projectId: string, amount: number, status: string, createdAt: string): ChangeOrder =>
  ({ id, number: num, projectId, status, changeAmount: amount, createdAt, date: createdAt, auditTrail: [] } as unknown as ChangeOrder);

const NOW = Date.parse('2026-02-01T00:00:00');

console.log('\ndrafted revenue (ready to bill):');

const r = buildReadyToBill({
  changeOrders: [
    auto('c1', 1, 'p1', 5000, '2026-01-25T00:00:00'),
    manual('c2', 2, 'p2', 8000, 'draft', '2026-01-30T00:00:00'),
    manual('c3', 3, 'p1', 0, 'draft', '2026-01-30T00:00:00'),        // zero amount → excluded
    manual('c4', 4, 'p1', 3000, 'approved', '2026-01-20T00:00:00'),  // not draft → excluded
    auto('c5', 5, 'p2', 1200, '2026-01-31T00:00:00'),
  ],
  projects,
  nowMs: NOW,
});

expect('rows sorted by amount desc, zero + non-draft excluded', r.rows.map((x) => x.id), ['c2', 'c1', 'c5']);
expect('amounts', r.rows.map((x) => x.amount), [8000, 5000, 1200]);
expect('project names resolved', [r.rows[0].projectName, r.rows[1].projectName], ['Elm Bath', 'Oak Kitchen']);
expect('isAuto flags (manual vs MAGE-drafted)', r.rows.map((x) => x.isAuto), [false, true, true]);
expect('count / total', [r.count, r.total], [3, 14200]);
expect('autoCount / autoTotal (MAGE-drafted only)', [r.autoCount, r.autoTotal], [2, 6200]);
expect('ageDays computed from createdAt (Jan 25 → Feb 1 = 7)', r.rows[1].ageDays, 7);

// empty state
const empty = buildReadyToBill({ changeOrders: [manual('x', 9, 'p1', 4000, 'approved', '2026-01-01T00:00:00')], projects, nowMs: NOW });
expect('no drafts → zeroed', [empty.count, empty.total, empty.autoCount], [0, 0, 0]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
