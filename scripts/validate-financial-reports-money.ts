// validate-financial-reports-money.ts — pins the two money figures a GC reads
// off the Reports hub and the estimate revision history.
// Run via: bun run scripts/validate-financial-reports-money.ts
//
// Both cases here FAIL against the pre-fix code:
//
//   1. computeARAgingReport had no status filter at all, so a staged DRAFT
//      invoice counted as an outstanding receivable and aged into a past-due
//      bucket — while the WIP tab of the same screen said nothing was billed.
//   2. diffEstimates pushed a "Markup & overhead" row equal to the markupTotal
//      movement on top of category deltas that were ALREADY markup-inclusive,
//      so the Changes tab summed to twice its own Net Change footer.
//
// Pure modules, no React Native deps — bun imports and runs them directly.

import { computeARAgingReport } from '../utils/financialReports';
import { diffEstimates } from '../utils/estimateCommit';
import type { Invoice, Project, LinkedEstimate, LinkedEstimateItem } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, hint?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, hint ? `\n   ${hint}` : ''); }
}
function eq(name: string, got: number, want: number, tol = 0.005) {
  ok(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);
}

const DAY = 86_400_000;
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

function invoice(over: Partial<Invoice>): Invoice {
  return {
    id: 'i', number: 1, projectId: 'p1', type: 'full',
    issueDate: iso(-60 * DAY), dueDate: iso(-45 * DAY),
    paymentTerms: 'net_30', notes: '', lineItems: [],
    subtotal: 0, taxRate: 0, taxAmount: 0,
    totalDue: 0, amountPaid: 0, status: 'sent', payments: [],
    createdAt: iso(-60 * DAY), updatedAt: iso(-60 * DAY),
    ...over,
  } as Invoice;
}

const projects = [{ id: 'p1', name: 'Maple St' } as Project];

// ── 1. A/R aging: an unsent draft is not a receivable ───────────────────────
console.log('\nA/R aging — draft invoices:');
{
  // A $40K draft staged by Bill-from-Estimate and never sent, dated 45 days
  // past its notional due date, alongside one genuinely sent $10K invoice.
  const report = computeARAgingReport(
    [
      invoice({ id: 'draft', number: 1, status: 'draft', totalDue: 40_000 }),
      invoice({ id: 'sent',  number: 2, status: 'sent',  totalDue: 10_000 }),
    ],
    projects,
  );

  ok('the draft invoice produces no A/R row', !report.rows.some(r => r.invoiceId === 'draft'));
  ok('the sent invoice still produces a row', report.rows.some(r => r.invoiceId === 'sent'));
  eq('total outstanding is the sent invoice only, not $50,000',
    report.totals.totalOutstanding, 10_000);
  eq('the 31-60 past-due bucket carries no draft money',
    report.totals['31-60'], 10_000);

  // Statuses that HAVE been billed must all survive the filter — the fix must
  // not quietly narrow A/R to 'sent'.
  const billed = computeARAgingReport(
    [
      invoice({ id: 's',  number: 1, status: 'sent',           totalDue: 1_000 }),
      invoice({ id: 'pp', number: 2, status: 'partially_paid', totalDue: 1_000, amountPaid: 400 }),
      invoice({ id: 'od', number: 3, status: 'overdue',        totalDue: 1_000 }),
      invoice({ id: 'pd', number: 4, status: 'paid',           totalDue: 1_000, amountPaid: 1_000 }),
    ],
    projects,
  );
  eq('sent + partially_paid + overdue stay in A/R (paid nets to zero)',
    billed.totals.totalOutstanding, 2_600);
}

// ── 2. Revision diff: rows must foot to Net Change ──────────────────────────
console.log('\nEstimate revision diff — markup reconciliation:');

function item(over: Partial<LinkedEstimateItem>): LinkedEstimateItem {
  return {
    materialId: 'm1', name: 'Lumber', category: 'Materials', unit: 'ea',
    quantity: 1, unitPrice: 0, bulkPrice: 0, markup: 0, usesBulk: false,
    lineTotal: 0, supplier: 'ACME', ...over,
  };
}
const sumRows = (rows: { delta: number }[]) => rows.reduce((s, r) => s + r.delta, 0);

{
  // Convention A — app/(tabs)/estimate/full.tsx + takeoff-estimate.tsx:
  // lineTotal is markup-INCLUSIVE and grandTotal = Σ lineTotal.
  // $100K of base materials, markup 15% → 25%. The only real movement is
  // +$10,000. Pre-fix this rendered Materials +$10,000 AND Markup +$10,000.
  const mk = (pct: number): LinkedEstimate => {
    const lineTotal = 100_000 * (1 + pct / 100);
    return {
      id: `e${pct}`,
      items: [item({ category: 'Materials', quantity: 1, unitPrice: 100_000, bulkPrice: 100_000, markup: pct, lineTotal })],
      globalMarkup: pct,
      baseTotal: 100_000,
      markupTotal: lineTotal - 100_000,
      grandTotal: lineTotal,
      createdAt: '2026-01-01',
    };
  };
  const d = diffEstimates(mk(15), mk(25));

  eq('markup-inclusive: net change is the true +$10,000', d.netDelta, 10_000);
  eq('markup-inclusive: rows sum to Net Change, not double it',
    sumRows(d.categories), 10_000);
  ok('markup-inclusive: no double-counted markup row is emitted',
    !d.categories.some(c => c.key === '__markup__'));
}

{
  // Convention B — lineTotal PRE-markup, grandTotal = baseTotal + markupTotal.
  // This is what utils/copilot/estimateEdit/estimateOps.ts wrote before it was
  // realigned to the estimator, so persisted revision snapshots still carry the
  // shape. Here the markup row is load-bearing: the markup move touches no
  // category at all, so deleting the row outright would render "no changes"
  // over a nonzero Net Change. It must survive.
  const mk = (pct: number): LinkedEstimate => ({
    id: `c${pct}`,
    items: [item({ category: 'Materials', quantity: 1, unitPrice: 100_000, bulkPrice: 100_000, lineTotal: 100_000 })],
    globalMarkup: pct,
    baseTotal: 100_000,
    markupTotal: 100_000 * (pct / 100),
    grandTotal: 100_000 * (1 + pct / 100),
    createdAt: '2026-01-01',
  });
  const d = diffEstimates(mk(15), mk(25));

  eq('pre-markup: net change is +$10,000', d.netDelta, 10_000);
  ok('pre-markup: the markup row is still emitted',
    d.categories.some(c => c.key === '__markup__'));
  eq('pre-markup: the markup row carries the whole movement',
    d.categories.find(c => c.key === '__markup__')?.delta ?? 0, 10_000);
  eq('pre-markup: rows sum to Net Change', sumRows(d.categories), 10_000);
}

{
  // Scope change at constant markup, markup-inclusive convention: add $10K of
  // base electrical at 20%. Net is +$12,000 and the single category row must
  // carry all of it.
  const base = (extra: LinkedEstimateItem[]): LinkedEstimate => {
    const items = [item({ category: 'Materials', csiDivision: '06', quantity: 1, unitPrice: 100_000, bulkPrice: 100_000, markup: 20, lineTotal: 120_000 }), ...extra];
    const grandTotal = items.reduce((s, i) => s + i.lineTotal, 0);
    const baseTotal = items.reduce((s, i) => s + (i.usesBulk ? i.bulkPrice : i.unitPrice) * i.quantity, 0);
    return { id: 'x', items, globalMarkup: 20, baseTotal, markupTotal: grandTotal - baseTotal, grandTotal, createdAt: '2026-01-01' };
  };
  const d = diffEstimates(
    base([]),
    base([item({ materialId: 'm2', name: 'Conduit', category: 'Electrical', csiDivision: '26', quantity: 1, unitPrice: 10_000, bulkPrice: 10_000, markup: 20, lineTotal: 12_000 })]),
  );

  eq('scope add: net change is +$12,000', d.netDelta, 12_000);
  eq('scope add: rows sum to Net Change', sumRows(d.categories), 12_000);
  ok('scope add: exactly one row, the new division', d.categories.length === 1 && d.categories[0].key === '26');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
