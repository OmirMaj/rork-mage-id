// validate-wip-parity.ts — the two bank-facing WIP schedules must answer the
// same question with the same number.
//
// WHY THIS EXISTS. MAGE ships TWO work-in-progress schedules one sidebar row
// apart, and the app-experience audit (docs/audits/2026-09-07-app-experience-
// audit.md, "Do next" #2) found them disagreeing on four axes:
//
//   1. BILLINGS POPULATION — utils/wip.suggestBilledToDate summed EVERY
//      invoice, drafts included; utils/financialReports.computeWIPReport
//      excludes drafts. A draft is a document the client has never seen. Every
//      draft dollar inflated billed-to-date and shrank underbilling — which is
//      the exact figure a lender reads to judge whether a contractor is
//      financing his jobs on his client's money.
//   2. COST-TO-DATE BASIS — pinned by scripts/validate-money-definitions.ts.
//   3. PERCENT-COMPLETE BASIS — both cost-based; inherits axis 2.
//   4. PROJECT POPULATION — app/wip-report.tsx listed EVERY project including
//      CLOSED ones; computeWIPReport skips closed. A finished job on a surety
//      document restates backlog that does not exist.
//
// Axes 1 and 4 now have ONE definition each — utils/wip.isWipBilling and
// utils/wip.isWipReportableProject — and this guard holds both engines to them.
// It also pins the PROVENANCE siblings added for "Worth doing" #26: a new
// fallback branch cannot be added to a number without also being added to the
// explanation the GC shows his surety.
//
// AXES 2 AND 3 ARE STILL OPEN, and this guard deliberately does NOT assert
// them, because they do not agree yet and a guard that pinned today's answer
// would certify the divergence as correct. The remaining gap is the COST-AT-
// COMPLETION denominator: computeWIPReport divides by jobCostEngine's
// `projectedFinal` while utils/wip.ts divides by `deriveEstimatedCost`. They
// coincide on a job running to budget and part on one that is not — $520k of
// signed subs against a $400k estimate reports 50% vs 65% complete and $55,000
// vs $137,500 underbilled, for the same job, on the same day. Closing it means
// making computeWIPReport a thin adapter over utils/wip.ts (audit "Do next"
// #2), which lives in utils/financialReports.ts. When that lands, add the
// percent-complete and underbilling parity assertions here.
//
// Run via: bun run test:wip-parity

import {
  isWipBilling,
  isWipReportableProject,
  suggestBilledToDate,
  suggestCostToDate,
  suggestCostToDateWithSource,
  deriveOriginalContract,
  deriveOriginalContractWithSource,
  deriveEstimatedCost,
  deriveEstimatedCostWithSource,
  WIP_SOURCE_LABELS,
  type WipSource,
} from '../utils/wip';
import { computeWIPReport } from '../utils/financialReports';
import type {
  Project, Invoice, Commitment, ChangeOrder, SavedAIAPayApp, MaterialReceipt,
} from '../types';
// fileURLToPath + join because the repo path contains a space.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}
function close(n: string, got: number, want: number, eps = 1e-9) {
  const ok = Math.abs(got - want) <= eps;
  if (ok) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n, '\n   got ', got, '\n   want', want); }
}

console.log('\nWIP parity — one definition per term, across both schedules:');

// ── Fixtures ────────────────────────────────────────────────────────────────
// A $550,000 job (linked estimate: $400k cost, $550k priced) that has billed
// $220,000 on a SENT invoice and carries an $80,000 DRAFT the client has never
// seen. That draft is the whole defect: counted, billed-to-date reads $300,000.
const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'Henderson', status: 'in_progress',
  estimate: null,
  linkedEstimate: {
    id: 'e1', items: [], globalMarkup: 37.5,
    baseTotal: 400_000, markupTotal: 150_000, grandTotal: 550_000,
    createdAt: '2026-01-01',
  },
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
  ...over,
} as unknown as Project);

const invoice = (id: string, totalDue: number, status: Invoice['status']): Invoice => ({
  id, number: 1, projectId: 'p1', type: 'progress',
  issueDate: '2026-03-01', dueDate: '2026-03-31', paymentTerms: 'net_30', notes: '',
  lineItems: [{ id: `${id}-l1`, name: 'Progress', description: '', quantity: 1, unit: 'ls', unitPrice: totalDue, total: totalDue }],
  subtotal: totalDue, taxRate: 0, taxAmount: 0, totalDue, amountPaid: 0,
  status, payments: [], createdAt: '2026-03-01', updatedAt: '2026-03-01',
} as unknown as Invoice);

const commitment = (paidToDate: number): Commitment => ({
  id: 'c1', projectId: 'p1', number: 'SC-1', type: 'subcontract', description: 'Build',
  amount: 400_000, paidToDate, signedDate: '2026-01-01', phase: 'Materials', status: 'active',
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
} as unknown as Commitment);

const SENT = invoice('inv-sent', 220_000, 'sent');
const DRAFT = invoice('inv-draft', 80_000, 'draft');

// ── AXIS 1 — BILLINGS POPULATION ────────────────────────────────────────────
{
  eq('a draft invoice is not a billing', isWipBilling(DRAFT), false);
  eq('a sent invoice is', isWipBilling(SENT), true);
  eq('paid / partially_paid / overdue are all billings', [
    isWipBilling({ status: 'paid' }),
    isWipBilling({ status: 'partially_paid' }),
    isWipBilling({ status: 'overdue' }),
  ], [true, true, true]);

  // The defect, stated as a number: with the draft counted, billed-to-date is
  // $300,000 and a job that is $55,000 UNDERbilled reads as $25,000 OVERbilled.
  close('suggestBilledToDate excludes the $80k draft',
    suggestBilledToDate([SENT, DRAFT], []), 220_000);
  close('…and would have read $300,000 if drafts counted',
    [SENT, DRAFT].reduce((s, i) => s + i.totalDue, 0), 300_000);

  // PARITY. Same inputs, both engines, same dollars — this is the check that
  // fails if EITHER file's definition drifts again.
  const wipTab = computeWIPReport([project()], [SENT, DRAFT], [], [commitment(160_000)]).rows[0];
  close('both WIP schedules report the same billed-to-date',
    suggestBilledToDate([SENT, DRAFT], []), wipTab.billedToDate);

  // A pay-app job takes the cumulative G703 figure instead; the draft filter
  // must not silently change that branch.
  const payApps = [
    { applicationNumber: 2, totals: { totalCompletedAndStored: 310_000 } },
  ] as unknown as SavedAIAPayApp[];
  close('pay-apps still win over invoices, drafts or no drafts',
    suggestBilledToDate([SENT, DRAFT], payApps), 310_000);
}

// ── AXIS 4 — PROJECT POPULATION ─────────────────────────────────────────────
{
  eq('a closed project is off the WIP schedule', isWipReportableProject({ status: 'closed' }), false);
  eq('draft / estimated / in_progress / completed all stay on', [
    isWipReportableProject({ status: 'draft' }),
    isWipReportableProject({ status: 'estimated' }),
    isWipReportableProject({ status: 'in_progress' }),
    // `completed` is deliberately kept: a built-out job can still carry
    // unbilled revenue and unreleased retainage, which is what the schedule
    // exists to show.
    isWipReportableProject({ status: 'completed' }),
  ], [true, true, true, true]);

  const closed = project({ id: 'p9', status: 'closed' } as Partial<Project>);
  eq('the other WIP schedule drops it too',
    computeWIPReport([closed], [], [], []).rows.length, 0);
  eq('…and keeps a completed one', [
    computeWIPReport([project({ status: 'completed' } as Partial<Project>)], [], [], []).rows.length,
  ], [1]);
}

// ── The screen actually derives from the shared predicate ───────────────────
// bun cannot import a .tsx screen, so this is source-level. It is still the
// check that matters: the defect was one memo in app/wip-report.tsx returning
// `projects` unfiltered.
{
  const screen = readFileSync(join(ROOT, 'app', 'wip-report.tsx'), 'utf8');
  eq('app/wip-report.tsx imports the shared population predicate',
    /import\s*\{[^}]*\bisWipReportableProject\b[^}]*\}\s*from\s*'@\/utils\/wip'/s.test(screen), true);
  eq('…and filters the project list with it',
    /activeProjects[\s\S]{0,200}?projects\.filter\(isWipReportableProject\)/.test(screen), true);
  eq('…so the unfiltered `() => projects` memo is gone',
    /const activeProjects: Project\[\] = useMemo\(\s*\(\)\s*=>\s*projects,/.test(screen), false);
  // The legend is the other half of "Do next" #2's user-facing cost: two
  // colours carried the meaning of the table and nothing defined them.
  eq('the over/under legend is on the screen',
    /billed more than earned/.test(screen) && /earned more than billed/.test(screen), true);
}

// ── PROVENANCE — the number and its explanation share one branch chain ──────
{
  const cos: ChangeOrder[] = [];
  const payApps: SavedAIAPayApp[] = [];

  // Every branch of deriveOriginalContract, in precedence order. Each case
  // asserts BOTH the value and the source, so a reordering shows up here.
  const cases: { name: string; p: unknown; cos: ChangeOrder[]; payApps: SavedAIAPayApp[]; value: number; source: WipSource }[] = [
    {
      name: 'a saved pay application outranks everything',
      p: { gmpCap: 1_400_000 }, cos, value: 900_000, source: 'pay_app_contract_sum',
      payApps: [{ applicationNumber: 1, originalContractSum: 900_000 }] as unknown as SavedAIAPayApp[],
    },
    {
      name: 'with COs on the job, the linked estimate is the original contract',
      p: { linkedEstimate: { grandTotal: 500_000 } },
      cos: [{ status: 'approved', changeAmount: 20_000, originalContractValue: 520_000 }] as unknown as ChangeOrder[],
      payApps, value: 500_000, source: 'estimate_grand_total',
    },
    {
      name: 'with COs and no estimate, the smallest CO snapshot',
      p: {},
      cos: [
        { status: 'approved', changeAmount: 30_000, originalContractValue: 520_000 },
        { status: 'approved', changeAmount: 20_000, originalContractValue: 500_000 },
      ] as unknown as ChangeOrder[],
      payApps, value: 500_000, source: 'change_order_snapshot',
    },
    {
      name: 'target budget',
      p: { targetBudget: { amount: 750_000 }, gmpCap: 1_400_000 }, cos, payApps,
      value: 750_000, source: 'target_budget',
    },
    {
      // The audit's named example: the GC could not learn his "$1.4M contract"
      // was a GMP cap he typed once during project setup.
      name: 'a GMP cap says so out loud',
      p: { gmpCap: 1_400_000 }, cos, payApps, value: 1_400_000, source: 'gmp_cap',
    },
    {
      name: 'linked estimate grand total',
      p: { linkedEstimate: { grandTotal: 550_000 } }, cos, payApps,
      value: 550_000, source: 'estimate_grand_total',
    },
    {
      name: 'legacy estimate grand total',
      p: { estimate: { grandTotal: 310_000 } }, cos, payApps,
      value: 310_000, source: 'legacy_estimate_grand_total',
    },
    {
      name: 'nothing on file is reported as nothing on file',
      p: {}, cos, payApps, value: 0, source: 'none',
    },
  ];

  for (const c of cases) {
    const withSource = deriveOriginalContractWithSource(c.p as never, c.cos, c.payApps);
    close(`contract — ${c.name}`, withSource.value, c.value);
    eq(`contract source — ${c.name}`, withSource.source, c.source);
    // The plain function must be the same chain, not a second copy of it.
    close(`contract — plain and sourced agree (${c.source})`,
      deriveOriginalContract(c.p as never, c.cos, c.payApps), withSource.value);
  }

  // Cost budget: same three branches, same parity requirement.
  const costCases: { name: string; p: unknown; commitments: Commitment[]; value: number; source: WipSource }[] = [
    {
      name: 'linked estimate base total (cost before markup)',
      p: { linkedEstimate: { baseTotal: 400_000, grandTotal: 550_000 } },
      commitments: [], value: 400_000, source: 'estimate_base_total',
    },
    {
      name: 'legacy estimate grand total',
      p: { estimate: { grandTotal: 300_000 } }, commitments: [],
      value: 300_000, source: 'legacy_estimate_grand_total',
    },
    {
      name: 'signed commitments (already CO-inclusive)',
      p: {}, commitments: [commitment(0)], value: 400_000, source: 'signed_commitments',
    },
    { name: 'no cost basis at all', p: {}, commitments: [], value: 0, source: 'none' },
  ];
  for (const c of costCases) {
    const withSource = deriveEstimatedCostWithSource(c.p as never, c.commitments);
    close(`cost budget — ${c.name}`, withSource.value, c.value);
    eq(`cost budget source — ${c.name}`, withSource.source, c.source);
    close(`cost budget — plain and sourced agree (${c.source})`,
      deriveEstimatedCost(c.p as never, c.commitments), withSource.value);
  }

  // Topping the cost budget up for approved COs must not change the source —
  // it is still the estimate's number, adjusted.
  const topped = deriveEstimatedCostWithSource(
    { linkedEstimate: { baseTotal: 400_000 } } as never, [],
    { approvedChangeOrders: 100_000, originalContract: 500_000 });
  close('a CO tops the cost budget at the job cost ratio', topped.value, 480_000);
  eq('…and the source is still the estimate', topped.source, 'estimate_base_total');

  // Cost-to-date components, so the drill-in can say what is NOT in the figure.
  const receipts = [{ total: 42_000 }] as unknown as MaterialReceipt[];
  const ctd = suggestCostToDateWithSource([commitment(180_000)], receipts);
  close('cost-to-date value', ctd.value, 222_000);
  close('…subs paid split out', ctd.committed, 180_000);
  close('…materials split out', ctd.materials, 42_000);
  close('cost-to-date — plain and sourced agree',
    suggestCostToDate([commitment(180_000)], receipts), ctd.value);

  // Every source a derive function can return must have a label the GC can
  // read. A branch added without a label would print `undefined` to a banker.
  const emitted: WipSource[] = [
    ...cases.map(c => c.source), ...costCases.map(c => c.source), ctd.source,
  ];
  eq('every source that can be returned has a plain-English label',
    emitted.filter(s => !WIP_SOURCE_LABELS[s]), []);
  eq('no label is a placeholder',
    Object.values(WIP_SOURCE_LABELS).filter(l => !l || l.length < 12), []);

  // A label that is merely PRESENT is not the point — the whole finding is that
  // the GC could not learn his "$1.4M contract" was a GMP cap. Retyping one
  // source's label onto another passes a presence check while telling a banker
  // the wrong provenance, so pin the phrase that distinguishes each one, and
  // require the set to be distinct.
  eq('no two sources share a label',
    new Set(Object.values(WIP_SOURCE_LABELS)).size,
    Object.keys(WIP_SOURCE_LABELS).length);
  const mustSay: [WipSource, RegExp][] = [
    ['pay_app_contract_sum', /pay application/i],
    ['estimate_grand_total', /grand total/i],
    ['change_order_snapshot', /change order/i],
    ['target_budget', /target budget/i],
    ['gmp_cap', /\bGMP\b/],
    ['legacy_estimate_grand_total', /legacy/i],
    ['estimate_base_total', /base total/i],
    ['signed_commitments', /subcontract/i],
    ['commitments_and_receipts', /receipt/i],
    ['cost_incurred', /already paid out/i],
    ['none', /no source|enter this figure/i],
  ];
  for (const [source, phrase] of mustSay) {
    eq(`the ${source} label actually names ${source}`,
      phrase.test(WIP_SOURCE_LABELS[source]), true);
  }
  // Every source the type declares needs a label, not only the ones these
  // fixtures happen to walk — a branch added tomorrow must fail here.
  eq('every declared source is labelled',
    mustSay.map(([sourceKey]) => sourceKey).filter(sourceKey => !WIP_SOURCE_LABELS[sourceKey]), []);
  eq('…and the label table has no source the guard does not pin',
    Object.keys(WIP_SOURCE_LABELS).filter(k => !mustSay.some(([sourceKey]) => sourceKey === k)), []);
}

// ── The drill-in actually shows the provenance ──────────────────────────────
{
  const screen = readFileSync(join(ROOT, 'app', 'wip-report.tsx'), 'utf8');
  eq('app/wip-report.tsx reads the sourced derive functions',
    /deriveOriginalContractWithSource/.test(screen)
    && /deriveEstimatedCostWithSource/.test(screen)
    && /suggestCostToDateWithSource/.test(screen), true);
  eq('…and renders the labels rather than the enum',
    /WIP_SOURCE_LABELS\[/.test(screen), true);
  eq('…and names what cost-to-date does NOT include',
    /Self-performed labor is NOT included/.test(screen), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
