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
// AXES 2 AND 3 ARE CLOSED ON THE COST DENOMINATOR, and the parity is pinned by
// scripts/validate-money-basis-parity.ts rather than here: computeWIPReport now
// calls `deriveEstimatedCostWithSource` (utils/financialReports.ts:180-191) like
// utils/wip.ts does, and BOTH pass the `costIncurred` floor. That guard owns the
// call-site completeness check, because the failure mode it exists for is wiring
// the floor into some call sites and not others — which is exactly what happened
// on 2026-09-10 and left the two schedules 27 margin points apart.
//
// AXES 5, 6 AND 7 ARE CLOSED AND ASSERTED BELOW (2026-09-11 audit). All three
// were live divergences the four axes above were structurally blind to:
//
//   5. THE CONTRACT. utils/wip.ts took the baseline from the latest pay
//      application's `originalContractSum`; computeWIPReport ran
//      `effectiveEstimateTotal`, the linked estimate's grandTotal and nothing
//      else. Measured before the fix: a job with a saved pay application read
//      $700,000 / 42.9% margin on /wip-report and $550,000 / 27.3% on
//      /reports; a target-budget-only job read $900,000 against $0. That is
//      the REVENUE side of a surety document.
//   6. BILLED TO DATE. computeWIPReport's signature took no pay apps at all
//      and billedToDate was invoices-only, so a job billed entirely through
//      AIA progress billing reported $0 billed on /reports and invented
//      underbilling equal to the whole of earned revenue.
//   7. THE PERCENT-COMPLETE FALLBACK. With no cost recorded, computeWIPReport
//      fell back to the average task progress of the project's SCHEDULE — a
//      third basis, and schedule-basis revenue recognition on a document that
//      names itself cost-to-cost.
//
//   8. THE ENTERED COST TO COMPLETE (added on the adversarial re-review of the
//      same day). The ETC — the input that stops an overrun job reporting 100%
//      complete — landed as an argument to computeWipRow alone, which is the
//      /wip-report engine. computeWIPReport and computeProfitReport derive
//      their cost at completion from deriveEstimatedCostWithSource and could
//      not see it, so a GC who entered "$180,000 left to spend" got EAC
//      $800,000 / 77.5% / $426,250 earned / a $250,000 forecast loss on the
//      flagship screen and EAC $620,000 / 100% / $550,000 earned / a $70,000
//      loss on /reports, in its CSV and in its PDF. This guard was structurally
//      blind to it: `grep -c estimatedCostToComplete` over this file returned
//      ZERO, so the entire feature could be switched off (`const etcEntered =
//      false && …`) with wip-parity and money-basis-parity both green.
//
// Each is now one definition in utils/wip.ts that computeWIPReport calls, and
// each is asserted here ACROSS BOTH ENGINES on the same fixture. The call-site
// completeness check at the bottom is the other half: an optional positional
// parameter that some callers pass is a divergence generator, and that shape
// has split these two schedules twice in this repo already.
//
// Run via: bun run test:wip-parity

import {
  isWipBilling,
  isWipReportableProject,
  computeWipRow,
  deriveEstimatedCostWithSource as deriveEac,
  suggestBilledToDate,
  suggestRetainageHeld,
  suggestCostToDate,
  suggestCostToDateWithSource,
  deriveOriginalContract,
  deriveOriginalContractWithSource,
  deriveEstimatedCost,
  deriveEstimatedCostWithSource,
  computeWipPortfolio,
  wipRowHasCostBasis,
  WIP_SOURCE_LABELS,
  type WipSource,
} from '../utils/wip';
import {
  computeWIPReport, computeProfitReport, wipReportToCSV, profitRowHasCostBasis,
} from '../utils/financialReports';
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
    // The pay-app branch has to name the LATEST application. There is no
    // `pay_app_contract_conflict` source any more: an earlier pass abandoned
    // the whole branch whenever two saved certificates disagreed about the
    // original contract sum, which is the ORDINARY case (a new application
    // re-reads the sum off the estimate, so any re-price makes two of them
    // disagree) and which knocked $100,000 off a certified contract. The
    // disagreement is disclosed in words instead —
    // utils/wip.payAppContractHistoryNote, pinned in scripts/validate-wip.ts.
    ['pay_app_contract_sum', /LATEST saved AIA pay application/],
    // And the ETC branch has to say the GC entered it, because on that branch
    // the cost at completion is his forecast rather than anything MAGE derived.
    ['cost_to_complete_entered', /cost to complete YOU entered/],
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

// ── AXES 5, 6 AND 7 — CONTRACT, BILLINGS, PERCENT COMPLETE ──────────────────
//
// One fixture, both engines, every figure compared. This is the block that
// fails if either file grows a second opinion again.
console.log('\naxes 5-7 — the contract, the billings and the percent complete:');
{
  // A job billed entirely through AIA progress billing, whose pay application
  // certifies a $700,000 contract against a $550,000 estimate — the exact shape
  // that read two different contracts and two different billings.
  const PAY_APPS = [{
    id: 'pa1', projectId: 'p1', applicationNumber: 2, originalContractSum: 700_000,
    totals: { totalCompletedAndStored: 350_000, totalRetainage: 35_000 },
  }] as unknown as SavedAIAPayApp[];
  const P = project();
  const COMMITS = [commitment(160_000)];

  const tab = computeWIPReport([P], [], [], COMMITS, {}, PAY_APPS).rows[0];

  // /wip-report's side of the same figures, from the engine the screen calls.
  const contract = deriveOriginalContractWithSource(P, [], PAY_APPS);
  const eac = deriveEac(P, COMMITS, {
    approvedChangeOrders: 0, originalContract: contract.value, costIncurred: tab.costToDate ?? 0,
  });
  const flagship = computeWipRow({
    originalContract: contract.value,
    approvedChangeOrders: 0,
    totalEstimatedCost: eac.value,
    costToDate: tab.costToDate ?? 0,
    billedToDate: suggestBilledToDate([], PAY_APPS),
  });

  close('AXIS 5 — both schedules read the SAME contract', tab.contractValue, contract.value);
  close('…and it is the certified pay-app sum, not the estimate', tab.contractValue, 700_000);
  close('…so revised contract agrees too', tab.revisedContract, flagship.revisedContract);
  eq('…and /reports records which branch produced it', tab.contractSource, 'pay_app_contract_sum');
  // The number the old code produced, stated so the regression is legible.
  close('…the estimate grand total, which /reports used to print, is $550,000',
    P.linkedEstimate?.grandTotal ?? 0, 550_000);

  close('AXIS 6 — both schedules read the SAME billed-to-date',
    tab.billedToDate, flagship.revisedContract > 0 ? suggestBilledToDate([], PAY_APPS) : 0);
  close('…and it is the cumulative G703 figure, not $0', tab.billedToDate, 350_000);
  close('…retainage held comes off the same certificate',
    tab.retainageHeld, suggestRetainageHeld([], PAY_APPS));
  close('…which is $35,000, not the $0 an invoice-only read would give',
    tab.retainageHeld, 35_000);

  close('AXIS 3/5 — percent complete agrees',
    tab.percentComplete / 100, flagship.percentComplete);
  close('…and so does earned revenue',
    (tab.revisedContract * tab.percentComplete) / 100, flagship.earnedRevenue);
  close('…and cost at completion', tab.estimatedFinalCost, eac.value);

  // AXIS 7 — a job with a SCHEDULE and no cost recorded must read 0%, not the
  // average task progress. Two tasks at 40% and 60% used to report 50%
  // complete, $250,000 earned and $250,000 unbilled on /reports while
  // /wip-report reported 0% and $0 for the same job.
  const scheduled = project({
    id: 'p1',
    schedule: { tasks: [{ progress: 40 }, { progress: 60 }] },
  } as unknown as Partial<Project>);
  const noCost = computeWIPReport([scheduled], [], [], [], {}, []).rows[0];
  close('AXIS 7 — no cost recorded reads 0% complete, never schedule progress',
    noCost.percentComplete, 0);
  close('…so it earns nothing rather than half the contract', noCost.earnedRevenue ?? 0, 0);
  close('…and invents no underbilling', noCost.unbilled, 0);
  close('…where the schedule average it used to print was 50%',
    (40 + 60) / 2, 50);
  close('…and the flagship engine agrees, from the same zero-cost guard',
    computeWipRow({
      originalContract: 550_000, approvedChangeOrders: 0,
      totalEstimatedCost: 0, costToDate: 0, billedToDate: 0,
    }).percentComplete, 0);

  // A RECALLED application must not set either figure on either schedule.
  const recalled = [
    PAY_APPS[0],
    {
      id: 'pa2', projectId: 'p1', applicationNumber: 3, originalContractSum: 900_000,
      totals: { totalCompletedAndStored: 500_000, totalRetainage: 50_000 },
      portalState: { status: 'recalled' },
    },
  ] as unknown as SavedAIAPayApp[];
  const withRecall = computeWIPReport([P], [], [], COMMITS, {}, recalled).rows[0];
  close('a recalled application sets neither the contract…', withRecall.contractValue, 700_000);
  close('…nor the billings', withRecall.billedToDate, 350_000);
}

console.log('\naxis 8 — the entered cost to complete, on BOTH engines:');
{
  // The exact overrun shape the ETC exists for: $620,000 already spent against
  // a $400,000 estimate on a $550,000 contract. The incurred floor makes
  // costToDate / EAC exactly 1.0 BY CONSTRUCTION, so the row reports 100%
  // complete, the whole contract earned and $0 of backlog — on a job that may
  // be 60% built. The GC says $180,000 is left to spend.
  const P = project();
  const SPENT = [commitment(620_000)];
  const ETC = 180_000;

  const bare = computeWIPReport([P], [], [], SPENT, {}, [], {}).rows[0];
  close('WITHOUT an ETC an overrun job reads 100% complete', bare.percentComplete, 100);
  close('…and earns the whole contract', bare.earnedRevenue ?? 0, bare.revisedContract);

  const tab = computeWIPReport([P], [], [], SPENT, {}, [], { p1: ETC }).rows[0];
  const prof = computeProfitReport([P], [], [], SPENT, {}, [], { p1: ETC }).rows[0];
  const flagship = computeWipRow({
    originalContract: bare.contractValue,
    approvedChangeOrders: 0,
    totalEstimatedCost: bare.estimatedFinalCost,
    costToDate: tab.costToDate ?? 0,
    billedToDate: tab.billedToDate,
    estimatedCostToComplete: ETC,
  });

  close('AXIS 8 — both schedules read the SAME cost at completion',
    tab.estimatedFinalCost, flagship.estimatedCostAtCompletion ?? 0);
  close('…which is cost to date + the entered cost to complete',
    tab.estimatedFinalCost, (tab.costToDate ?? 0) + ETC);
  close('…and it MOVED off the pre-ETC figure', bare.estimatedFinalCost, 620_000);
  close('…percent complete agrees', tab.percentComplete / 100, flagship.percentComplete);
  close('…and is no longer 100%', tab.percentComplete, 77.5, 0.01);
  close('…earned revenue agrees', tab.earnedRevenue ?? 0, flagship.earnedRevenue);
  close('…forecast profit agrees',
    tab.projectedProfit, flagship.estGrossProfit);
  close('…and the PROFIT TAB, which every free and Pro user lands on, agrees too',
    prof.estimatedFinalCost, flagship.estimatedCostAtCompletion ?? 0);
  close('…including its projected profit', prof.projectedProfit, flagship.estGrossProfit);
  eq('…and /reports records that the figure is the GC\'s own forecast',
    tab.costAtCompletion?.source, 'cost_to_complete_entered');
  eq('…under a basis that is not one of the three derived candidates',
    tab.costAtCompletion?.basis, 'entered');

  // ZERO IS A FORECAST, on both engines. "Nothing left to spend" is a real
  // answer at closeout and dropping it would silently restore the derivation.
  const zero = computeWIPReport([P], [], [], SPENT, {}, [], { p1: 0 }).rows[0];
  close('a ZERO cost to complete is honoured, not treated as absent',
    zero.estimatedFinalCost, zero.costToDate ?? 0);
  // NEGATIVE IS NOT. It falls through to the derivation rather than poisoning
  // the row — again identically on both engines.
  const neg = computeWIPReport([P], [], [], SPENT, {}, [], { p1: -5_000 }).rows[0];
  close('a NEGATIVE one is rejected and the derivation stands',
    neg.estimatedFinalCost, bare.estimatedFinalCost);
  close('…and the flagship engine rejects it the same way',
    computeWipRow({
      originalContract: bare.contractValue, approvedChangeOrders: 0,
      totalEstimatedCost: bare.estimatedFinalCost, costToDate: tab.costToDate ?? 0,
      billedToDate: 0, estimatedCostToComplete: -5_000,
    }).estimatedCostAtCompletion ?? 0, bare.estimatedFinalCost);
}

// ── THE PROFIT TAB USES WHAT IT IS GIVEN ────────────────────────────────────
//
// computeProfitReport takes `payApps` and `costToCompleteByProject` and was
// pinned by NOTHING: replacing its contract call with
// `deriveOriginalContractWithSource(project, projectCOs, [])` survived twelve
// guards, because the only checks that existed were a source-level regex saying
// app/reports.tsx PASSES the argument and a set of assertions on the WIP tab.
// Axis 5 on the tab every free and Pro user lands on was entirely unasserted.
console.log('\nthe Profit tab reads the same contract and the same forecast:');
{
  const PAY_APPS = [{
    id: 'pa1', projectId: 'p1', applicationNumber: 2, originalContractSum: 700_000,
    totals: { totalCompletedAndStored: 350_000, totalRetainage: 35_000 },
  }] as unknown as SavedAIAPayApp[];
  const P = project();
  const COMMITS = [commitment(160_000)];

  const wipTab = computeWIPReport([P], [], [], COMMITS, {}, PAY_APPS, {}).rows[0];
  const profTab = computeProfitReport([P], [], [], COMMITS, {}, PAY_APPS, {}).rows[0];
  close('the Profit tab reads the certified pay-app contract, not the estimate',
    profTab.revenue, 700_000);
  close('…the same revised contract the WIP tab prints', profTab.revenue, wipTab.revisedContract);
  close('…and the same cost at completion', profTab.estimatedFinalCost, wipTab.estimatedFinalCost);
  close('…and therefore the same projected profit',
    profTab.projectedProfit, wipTab.projectedProfit);
  // The estimate figure the old code produced, stated so the regression reads.
  close('…where the estimate grand total it used to report is $550,000',
    P.linkedEstimate?.grandTotal ?? 0, 550_000);
}

// ── A JOB WITH NO COST BASIS DOES NOT REPORT A 100% MARGIN (F14) ────────────
//
// Both engines fall back to a target budget for REVENUE and deliberately not
// for COST, so a job set up with only a budget carries a contract and no cost
// and reports its whole contract as gross profit. The two must suppress it the
// same way, or one document says 100% and the other says nothing.
console.log('\na contract with no cost basis is unmeasurable on both:');
{
  const budgetOnly = project({
    id: 'p1', linkedEstimate: undefined, estimate: undefined,
    targetBudget: { amount: 900_000, setBy: 'client' },
  } as unknown as Partial<Project>);
  const tab = computeWIPReport([budgetOnly], [], [], [], {}, [], {});
  close('the row still carries the contract', tab.rows[0].revisedContract, 900_000);
  close('…and no cost', tab.rows[0].estimatedFinalCost, 0);
  eq('…so /reports excludes it from the portfolio margin',
    tab.totals.projectedMargin, 0);
  eq('…and counts it', tab.totals.noCostBasisCount, 1);
  close('…and reports the contract it cannot speak for', tab.totals.noCostBasisContract, 900_000);
  eq('…and the flagship roll-up agrees it is unmeasurable',
    wipRowHasCostBasis({
      projectId: 'p1', projectName: 'x',
      input: {
        originalContract: 900_000, approvedChangeOrders: 0, totalEstimatedCost: 0,
        costToDate: 0, billedToDate: 0,
      },
      output: computeWipRow({
        originalContract: 900_000, approvedChangeOrders: 0, totalEstimatedCost: 0,
        costToDate: 0, billedToDate: 0,
      }),
    }), false);
  const portfolio = computeWipPortfolio([{
    projectId: 'p1', projectName: 'x',
    input: {
      originalContract: 900_000, approvedChangeOrders: 0, totalEstimatedCost: 0,
      costToDate: 0, billedToDate: 0,
    },
    output: computeWipRow({
      originalContract: 900_000, approvedChangeOrders: 0, totalEstimatedCost: 0,
      costToDate: 0, billedToDate: 0,
    }),
  }]);
  close('…so its weighted margin is 0, not the 100% it used to print',
    portfolio.weightedMarginPct, 0);
  eq('…and it says how many jobs it could not measure', portfolio.noCostBasisCount, 1);

  // AND THE DOCUMENT THAT LEAVES THE BUILDING. Suppressing the fabricated
  // margin in the engine while the CSV still printed `r.projectedMargin` would
  // put "100.0" on the page a bank reads with every arithmetic assertion above
  // still green — which is exactly what happened until this was measured.
  const csv = wipReportToCSV(tab).split('\n');
  const head = csv[0].split(',');
  eq('the /reports CSV prints NOTHING for its projected profit',
    csv[1].split(',')[head.indexOf('Projected Profit')], '');
  eq('…and nothing for its margin, never 100.0',
    csv[1].split(',')[head.indexOf('Projected Margin %')], '');
  eq('…and a memo line names what it excluded',
    csv.some((l) => l.startsWith('"NO COST BASIS')), true);
  // A MEASURABLE job must still print both, or the suppression has eaten the
  // whole column.
  const measurableCsv = wipReportToCSV(
    computeWIPReport([project()], [], [], [commitment(160_000)], {}, [], {}),
  ).split('\n');
  const mHead = measurableCsv[0].split(',');
  eq('a job WITH a cost basis still prints its margin',
    measurableCsv[1].split(',')[mHead.indexOf('Projected Margin %')] !== '', true);
  eq('…and no memo line is added to a fully measurable book',
    measurableCsv.some((l) => l.startsWith('"NO COST BASIS')), false);

  // ── THE PROFIT TAB IS THE THIRD SURFACE, AND IT HAD NO EXCLUSION AT ALL
  // (adversarial review 2026-09-11). computeProfitReport's weighted margin ran
  // over every row, so a $1,000,000/$800,000 job beside the $900,000
  // target-budget job above rolled up to $1,100,000 of profit at a 57.9%
  // margin, against the $200,000 / 20% the WIP tab one chip away was printing.
  // Profit is the tab every free and Pro user LANDS ON — the WIP tab is
  // Business-gated — so it is the version of this defect most users would meet.
  const real = project({ id: 'p9' } as unknown as Partial<Project>);
  const book = [real, budgetOnly];
  const wipTab = computeWIPReport(book, [], [], [], {}, [], {});
  const profitTabBook = computeProfitReport(book, [], [], [], {}, [], {});
  close('the Profit tab reports the SAME profit as the WIP tab',
    profitTabBook.totalProfit, wipTab.totals.measurableProjectedProfit);
  close('…and the SAME weighted margin',
    profitTabBook.weightedMargin, wipTab.totals.projectedMargin);
  eq('…and counts the same unmeasurable jobs',
    profitTabBook.noCostBasisCount, wipTab.totals.noCostBasisCount);
  close('…and the same revenue it cannot speak for',
    profitTabBook.noCostBasisRevenue, wipTab.totals.noCostBasisContract);
  eq('…and never the netted total that included the fabricated margin',
    profitTabBook.totalProfit === profitTabBook.rows.reduce((sum, r) => sum + r.projectedProfit, 0),
    false);
  eq('…while the unmeasurable ROW is still on the list, flagged as unmeasurable',
    profitTabBook.rows.some((r) => r.projectId === 'p1' && !profitRowHasCostBasis(r)), true);
  eq('…and the measurable one is not', profitRowHasCostBasis(
    profitTabBook.rows.find((r) => r.projectId === 'p9') as never), true);
  // A fully measurable book excludes nothing, or the filter has eaten the tab.
  const allMeasurable = computeProfitReport([real], [], [], [], {}, [], {});
  eq('a fully measurable book excludes nothing', allMeasurable.noCostBasisCount, 0);
  close('…and its revenue is its measurable revenue',
    allMeasurable.measurableRevenue, allMeasurable.totalRevenue);

  // ── AND THE SCREEN READS THE SAME FIELD ITS OWN CSV AND PDF DO. The F14 fix
  // landed on the /reports EXPORTS and not on the /reports SCREEN: line 346
  // rendered `report.totals.projectedProfit` ($1,100,000) beside a 20% margin
  // struck on the measurable subset, while wipReportToCSV and the PDF both
  // rendered `measurableProjectedProfit` ($200,000). Two numbers for one book
  // on one screen is the exact defect this file exists to close. A source
  // check because bun cannot render a .tsx.
  const SCREEN = readFileSync(join(ROOT, 'app', 'reports.tsx'), 'utf8');
  eq('the /reports portfolio stat reads measurableProjectedProfit',
    /value=\{formatMoney\(report\.totals\.measurableProjectedProfit\)\}/.test(SCREEN), true);
  eq('…and the whole-book projectedProfit is not rendered anywhere on it',
    /formatMoney\(report\.totals\.projectedProfit\)/.test(SCREEN), false);
  eq('…the per-row margin pill and profit are gated on wipReportRowHasCostBasis',
    (SCREEN.match(/wipReportRowHasCostBasis\(r\)/g) ?? []).length >= 3, true);
  eq('…the Profit tab gates the same two on profitRowHasCostBasis',
    (SCREEN.match(/profitRowHasCostBasis\(r\)/g) ?? []).length >= 3, true);
  eq('…the Profit hero is struck on measurableRevenue, not the whole book',
    /formatMoney\(profit\.measurableRevenue\)/.test(SCREEN)
      && !/formatMoney\(profit\.totalRevenue\)/.test(SCREEN), true);
  eq('…and both tabs name the jobs they excluded',
    /noCostBasisCount > 0/.test(SCREEN) && /profit\.noCostBasisCount > 0/.test(SCREEN), true);
  eq('…and the Profit PDF is handed the exclusion so it can say so too',
    /profit\.noCostBasisCount, profit\.noCostBasisRevenue\)/.test(SCREEN), true);
}

// ── THE OTHER TWO WIP-ROW PRODUCERS ARE WIRED TOO ───────────────────────────
//
// hooks/useWeekClose.ts is the last hand-built WIP row in the repo, and
// utils/portfolio/pipelineHorizon.ts is the last four-argument
// computeWIPReport. Both were left behind by the pass that gave the two
// schedules one cost-at-completion and one billings basis:
//
//   • useWeekClose built its row from deriveEstimatedCost with NEITHER the
//     `costIncurred` floor NOR an `estimatedCostToComplete`, so on an overrun
//     job it produced a THIRD cost at completion and the Friday Close's
//     "$X unbilled" stopped agreeing with the WIP screen it was explicitly
//     built to agree with.
//   • pipelineHorizon passed no pay apps, and its ONE use of the report is
//     Σ max(0, revisedContract − billedToDate) — so for a GC billing through
//     G702/G703 the backlog was overstated by everything already billed.
//     (costSources and the ETC map are deliberately NOT threaded there: neither
//     the contract nor the billings derive from them, so they cannot move that
//     file's only output.)
//
// Source checks, because both live behind React context.
{
  const WEEK_CLOSE = readFileSync(join(ROOT, 'hooks', 'useWeekClose.ts'), 'utf8');
  eq('the Friday Close passes the cost-incurred floor',
    /costIncurred: costToDate,/.test(WEEK_CLOSE), true);
  eq('…and the GC\u2019s own cost to complete, from the shared map',
    (WEEK_CLOSE.match(/estimatedCostToComplete: etcByProject\[p\.id\]/g) ?? []).length, 2);
  eq('…hydrated from the same key both schedules read',
    /AsyncStorage\.getItem\(wipEtcStorageKey\(user\?\.id\)\)/.test(WEEK_CLOSE)
      && /wipEtcValueMap\(normalizeWipEtcMap\(JSON\.parse\(raw\)\)\)/.test(WEEK_CLOSE), true);
  eq('…and costToDate is computed once and reused, not derived twice',
    (WEEK_CLOSE.match(/costToDate: suggestCostToDate\(/g) ?? []).length, 0);

  const HORIZON = readFileSync(join(ROOT, 'utils', 'portfolio', 'pipelineHorizon.ts'), 'utf8');
  eq('the pipeline horizon passes the pay applications',
    /computeWIPReport\(projects, invoices, changeOrders, commitments, \{\}, aiaPayApps \?\? \[\]\)/
      .test(HORIZON), true);
  const BUSINESS = readFileSync(join(ROOT, 'app', 'business.tsx'), 'utf8');
  eq('…and its production caller supplies them',
    /buildPipelineHorizon\(\{[^}]*aiaPayApps[^}]*\}\)/.test(BUSINESS), true);
  const FACTS = readFileSync(join(ROOT, 'utils', 'oneMind', 'factBlocks.ts'), 'utf8');
  eq('…and so does the One Mind fact bundle',
    /aiaPayApps: bundle\.aiaPayApps/.test(FACTS), true);
  const ASK = readFileSync(join(ROOT, 'app', 'ask.tsx'), 'utf8');
  eq('…which is fed them by the screen that builds it',
    /^\s*aiaPayApps,$/m.test(ASK), true);
}

// ── EVERY PRODUCTION CALL SITE PASSES THE PAY APPS ──────────────────────────
//
// `payApps` is optional and positional, exactly like `costSources` before it —
// and the last two divergences in this area were both a parameter wired into
// some call sites and not others, both times leaving two screens in
// disagreement about one job while everything still typechecked. A source-level
// check, because bun cannot import a .tsx screen and the defect lives in the
// screen.
{
  const REPORTS = readFileSync(join(ROOT, 'app', 'reports.tsx'), 'utf8');
  const calls = [...REPORTS.matchAll(/compute(?:WIP|Profit)Report\(/g)].length;
  const fed = [...REPORTS.matchAll(/costSources, aiaPayApps, etcEntries\)/g)].length;
  eq('app/reports.tsx calls both report builders', calls, 2);
  eq('…and every one of them is handed the cost sources, the pay apps AND the ETC map',
    fed >= calls, true);
  // A map that is passed but never loaded is an empty map, which is the old
  // behaviour with the guard satisfied.
  eq('…and the ETC map is hydrated from the key /wip-report writes',
    /AsyncStorage\.getItem\(wipEtcStorageKey\(userId\)\)/.test(REPORTS), true);
  // The pay apps have to come from the context, not from an empty literal that
  // would satisfy the regex above and report $0 billed on every AIA job.
  eq('…and the pay apps come from the project context',
    /aiaPayApps,\s*\n\s*\} = useProjects\(\)/.test(REPORTS)
    || /\baiaPayApps\b[\s\S]{0,400}?= useProjects\(\)/.test(REPORTS), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
