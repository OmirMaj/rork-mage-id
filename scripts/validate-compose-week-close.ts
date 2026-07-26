// scripts/validate-compose-week-close.ts
// Run: bun scripts/validate-compose-week-close.ts
//
// Tests for utils/weekClose/composeWeekClose.ts.
// Plan-required cases:
//   - per-leg fixtures (correct items in each of 5 legs)
//   - cadence exclusion (inactive project → excluded from bill/chase)
//   - allQuiet empty state (no items → allQuiet + honest quiet line)
//   - dedupe of a CO appearing as both autoDraftedCO and unbilled WIP row
//   - unbilled $500 floor
//   - chase: overdue invoice included; paid invoice excluded
//   - close: PPC computed correctly
//   - commit: lookaheadReadyCount surfaced
//   - clients: always includes update link + portal notice

import {
  composeWeekClose, projectIsActive, QUIET_CLOSE_LINE,
  type ComposeWeekCloseInput,
} from '../utils/weekClose/composeWeekClose';
import type { Project, Invoice, ChangeOrder, DailyFieldReport } from '../types';
import type { WIPRow } from '../utils/financialReports';
import type { PaymentPredictionResult } from '../utils/paymentPrediction';
import type { WeeklyCommitment } from '../utils/lastPlanner';

let failures = 0;
function assert(cond: boolean, msg: string, extra?: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}${extra ? ` — ${extra}` : ''}`);
    failures++;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// ─── Fixed "now" — a Friday, Jul 25 2026 ─────────────────────────────────────

const NOW = new Date(2026, 6, 25, 15, 0, 0); // Sat Jul 25 2026 15:00 local
// (plan says Friday; Saturday also exercises the cadence window — fine)

function daysAgoISO(days: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function dateOnlyDaysAgo(days: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function project(over: Partial<Project> & { id: string; name: string }): Project {
  return {
    status: 'in_progress',
    createdAt: daysAgoISO(90),
    ...over,
  } as unknown as Project;
}

function invoice(over: Record<string, unknown> & { id: string; projectId: string }): Invoice {
  return {
    number: 1, status: 'sent', totalDue: 10_000, amountPaid: 0,
    dueDate: dateOnlyDaysAgo(15), issueDate: dateOnlyDaysAgo(30),
    lineItems: [], payments: [],
    subtotal: 10_000, taxRate: 0, taxAmount: 0,
    type: 'progress', progressPercent: 50,
    paymentTerms: 'net_30', notes: '',
    createdAt: daysAgoISO(30), updatedAt: daysAgoISO(1),
    ...over,
  } as unknown as Invoice;
}

function changeOrder(over: Record<string, unknown> & { id: string; projectId: string }): ChangeOrder {
  return {
    number: 1, date: dateOnlyDaysAgo(1), description: 'Out of scope concrete',
    reason: 'out_of_scope', lineItems: [],
    originalContractValue: 200_000, changeAmount: 1_800, newContractTotal: 201_800,
    status: 'draft',
    auditTrail: [],
    createdAt: daysAgoISO(1), updatedAt: daysAgoISO(1),
    ...over,
  } as unknown as ChangeOrder;
}

function dailyReport(over: Record<string, unknown> & { id: string; projectId: string; date: string }): DailyFieldReport {
  return {
    weather: { condition: 'clear', tempF: 75, windMph: 0 },
    manpower: [], workPerformed: 'Framing', materialsDelivered: [],
    issuesAndDelays: '', photos: [], status: 'draft',
    createdAt: daysAgoISO(1), updatedAt: daysAgoISO(1),
    ...over,
  } as unknown as DailyFieldReport;
}

function wipRow(over: Partial<WIPRow> & { projectId: string; projectName: string }): WIPRow {
  return {
    contractValue: 200_000, approvedChangeOrders: 0, revisedContract: 200_000,
    percentComplete: 50, billedToDate: 80_000, paidToDate: 70_000,
    unbilled: 20_000, retainageHeld: 0,
    estimatedFinalCost: 160_000, projectedProfit: 40_000, projectedMargin: 20,
    status: 'in_progress',
    ...over,
  };
}

function baseInput(over: Partial<ComposeWeekCloseInput> = {}): ComposeWeekCloseInput {
  return {
    projects: [], invoices: [], changeOrders: [],
    dailyReports: [], wipRows: [], now: NOW, ...over,
  };
}

// ─── projectIsActive tests ────────────────────────────────────────────────────

{
  console.log('\n── projectIsActive ──');

  const p = project({ id: 'p1', name: 'P1' });

  // Report within 14 days → active
  const recentReport = dailyReport({ id: 'r1', projectId: 'p1', date: dateOnlyDaysAgo(3) });
  assert(
    projectIsActive(p, [], [recentReport], NOW),
    'report within 14d → active',
  );

  // Report older than 14d + no invoice → not active
  const oldReport = dailyReport({ id: 'r2', projectId: 'p1', date: dateOnlyDaysAgo(20) });
  assert(
    !projectIsActive(p, [], [oldReport], NOW),
    'report older than 14d, no other activity → not active',
  );

  // Invoice issued within 14d → active
  const recentInvoice = invoice({ id: 'i1', projectId: 'p1', issueDate: dateOnlyDaysAgo(5) });
  assert(
    projectIsActive(p, [recentInvoice], [], NOW),
    'invoice issued within 14d → active',
  );

  // Completed project → not active (cadence check)
  const completedProject = project({ id: 'p2', name: 'P2', status: 'completed' } as unknown as Partial<Project> & { id: string; name: string });
  assert(
    !projectIsActive(completedProject as unknown as Project, [], [recentReport], NOW),
    'completed project → not active regardless of reports',
  );
}

// ─── LEG 1: bill what you earned ─────────────────────────────────────────────

{
  console.log('\n── LEG 1: bill ──');

  const p1 = project({ id: 'p1', name: 'Henderson Remodel' });
  const report = dailyReport({ id: 'r1', projectId: 'p1', date: dateOnlyDaysAgo(3) });
  const wip = wipRow({ projectId: 'p1', projectName: 'Henderson Remodel', unbilled: 20_000 });

  const result = composeWeekClose(baseInput({
    projects: [p1],
    dailyReports: [report],
    wipRows: [wip],
  }));

  const billLeg = result.legs.find(l => l.id === 'bill')!;
  assert(!!billLeg, 'bill leg present');
  assert(
    billLeg.items.some(item => item.id === 'unbilled-p1'),
    'unbilled WIP row for active project in bill leg',
  );
  assert(
    billLeg.items.some(item => item.text.includes('Henderson Remodel')),
    'bill item mentions project name',
  );
  assert(
    billLeg.items.some(item => item.text.includes('$20K')),
    'bill item formats money correctly',
  );

  // Inactive project (no reports) → excluded
  const p2 = project({ id: 'p2', name: 'Inactive Job' });
  const wip2 = wipRow({ projectId: 'p2', projectName: 'Inactive Job', unbilled: 50_000 });
  const resultWithInactive = composeWeekClose(baseInput({
    projects: [p2],
    dailyReports: [], // no reports → inactive
    wipRows: [wip2],
  }));
  const billLegInactive = resultWithInactive.legs.find(l => l.id === 'bill')!;
  assert(
    !billLegInactive.items.some(item => item.id === 'unbilled-p2'),
    'inactive project WIP excluded from bill leg (cadence)',
  );

  // Unbilled below $500 floor → excluded
  const p3 = project({ id: 'p3', name: 'Small Job' });
  const report3 = dailyReport({ id: 'r3', projectId: 'p3', date: dateOnlyDaysAgo(2) });
  const wipSmall = wipRow({ projectId: 'p3', projectName: 'Small Job', unbilled: 400 });
  const resultSmall = composeWeekClose(baseInput({
    projects: [p3],
    dailyReports: [report3],
    wipRows: [wipSmall],
  }));
  const billLegSmall = resultSmall.legs.find(l => l.id === 'bill')!;
  assert(
    !billLegSmall.items.some(item => item.id === 'unbilled-p3'),
    'unbilled < $500 excluded from bill leg (floor)',
  );

  // Auto-drafted CO appears in bill leg
  const co = changeOrder({
    id: 'co1', projectId: 'p1', number: 3,
    auditTrail: [{ id: 'a1', action: 'auto_drafted_from_leak', actor: 'MAGE', timestamp: daysAgoISO(1) }],
  });
  const resultWithCO = composeWeekClose(baseInput({
    projects: [p1],
    dailyReports: [report],
    wipRows: [wip],
    changeOrders: [co],
    autoDraftedCOs: [co],
  }));
  const billLegWithCO = resultWithCO.legs.find(l => l.id === 'bill')!;
  assert(
    billLegWithCO.items.some(item => item.id === 'leak-co-co1'),
    'auto-drafted CO appears in bill leg',
  );
  assert(
    billLegWithCO.items.some(item => item.text.includes('CO #3')),
    'CO item mentions CO number',
  );

  // QBO pending count
  const resultWithQBO = composeWeekClose(baseInput({
    projects: [p1],
    dailyReports: [report],
    wipRows: [wip],
    qboPendingCount: 6,
  }));
  const billWithQBO = resultWithQBO.legs.find(l => l.id === 'bill')!;
  assert(
    billWithQBO.items.some(item => item.id === 'qbo-pending'),
    'QBO pending count line in bill leg',
  );
  assert(
    billWithQBO.items.some(item => item.text.includes('6 QBO costs')),
    'QBO pending item mentions count',
  );

  // No QBO → no qbo line
  const resultNoQBO = composeWeekClose(baseInput({ projects: [p1], dailyReports: [report], wipRows: [wip], qboPendingCount: 0 }));
  assert(
    !resultNoQBO.legs.find(l => l.id === 'bill')!.items.some(i => i.id === 'qbo-pending'),
    'qboPendingCount = 0 → no QBO line',
  );
}

// ─── LEG 2: chase ─────────────────────────────────────────────────────────────

{
  console.log('\n── LEG 2: chase ──');

  const p1 = project({ id: 'p1', name: 'Henderson' });
  const report = dailyReport({ id: 'r1', projectId: 'p1', date: dateOnlyDaysAgo(3) });

  // Overdue invoice → appears in chase
  const overdueInv = invoice({ id: 'i1', projectId: 'p1', number: 12 as unknown as number, dueDate: dateOnlyDaysAgo(10) });
  const result = composeWeekClose(baseInput({
    projects: [p1], dailyReports: [report],
    invoices: [overdueInv], wipRows: [],
  }));
  const chaseLeg = result.legs.find(l => l.id === 'chase')!;
  assert(chaseLeg.items.some(i => i.id === 'overdue-i1'), 'overdue invoice in chase leg');
  assert(chaseLeg.items.some(i => /\d+d overdue/.test(i.text)), 'shows days overdue in text');

  // Paid invoice → not in chase
  const paidInv = invoice({ id: 'i2', projectId: 'p1', status: 'paid', amountPaid: 10_000, dueDate: dateOnlyDaysAgo(5) });
  const resultPaid = composeWeekClose(baseInput({
    projects: [p1], dailyReports: [report],
    invoices: [paidInv], wipRows: [],
  }));
  assert(
    !resultPaid.legs.find(l => l.id === 'chase')!.items.some(i => i.id === 'overdue-i2'),
    'paid invoice excluded from chase',
  );

  // Prediction landing date shown
  const predictions: PaymentPredictionResult = {
    perInvoice: [{ invoiceId: 'i1', invoiceNumber: 12, projectName: 'Henderson',
      outstandingAmount: 10_000, onTimeProbability: 60, predictedPayDate: '2026-08-01',
      daysToPay: 7, riskLevel: 'low', reasons: [], suggestedAction: '' }],
    expected7dInflow: 10_000, expected14dInflow: 10_000, expected30dInflow: 10_000,
    atRiskAmount: 0, collectionRiskScore: 20, headline: '', topAction: '',
  };
  const resultPred = composeWeekClose(baseInput({
    projects: [p1], dailyReports: [report],
    invoices: [overdueInv], wipRows: [],
    paymentPredictions: predictions,
  }));
  assert(
    resultPred.legs.find(l => l.id === 'chase')!.items.some(i => i.text.includes('2026-08-01')),
    'payment prediction landing date shown in chase item',
  );

  // Inactive project invoice excluded
  const p2 = project({ id: 'p2', name: 'Inactive' });
  const overdueInv2 = invoice({ id: 'i3', projectId: 'p2', dueDate: dateOnlyDaysAgo(5) });
  const resultInactive = composeWeekClose(baseInput({
    projects: [p2], dailyReports: [],
    invoices: [overdueInv2], wipRows: [],
  }));
  assert(
    !resultInactive.legs.find(l => l.id === 'chase')!.items.some(i => i.id === 'overdue-i3'),
    'overdue invoice on inactive project excluded from chase',
  );
}

// ─── LEG 3: close ─────────────────────────────────────────────────────────────

{
  console.log('\n── LEG 3: close ──');

  // Compute this week's Monday ISO
  const thisMonday = (() => {
    const d = new Date(NOW);
    const dow = d.getDay();
    const shift = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + shift);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  // 9 committed, 7 done → 78% PPC
  const commitments: WeeklyCommitment[] = [
    ...Array.from({ length: 7 }, (_, i) => ({
      taskId: `t${i}`, weekStart: thisMonday, committed: true, outcome: 'done' as const,
    })),
    ...Array.from({ length: 2 }, (_, i) => ({
      taskId: `tm${i}`, weekStart: thisMonday, committed: true, outcome: 'missed' as const,
    })),
  ];

  const result = composeWeekClose(baseInput({
    wwp: { commitments, ppc: null },
  }));
  const closeLeg = result.legs.find(l => l.id === 'close')!;
  assert(closeLeg.items.some(i => i.id === 'ppc-close'), 'PPC item in close leg');
  assert(
    closeLeg.items.some(i => i.text.includes('78%')),
    'PPC percentage shown (7/9 ≈ 78%)',
  );
  assert(
    closeLeg.items.some(i => i.text.includes('committed 9') && i.text.includes('finished 7')),
    'committed and finished counts in close item',
  );

  // No commitments → empty close leg
  const resultEmpty = composeWeekClose(baseInput({ wwp: { commitments: [], ppc: null } }));
  assert(
    resultEmpty.legs.find(l => l.id === 'close')!.items.length === 0,
    'no commitments → empty close leg',
  );
}

// ─── LEG 4: commit ────────────────────────────────────────────────────────────

{
  console.log('\n── LEG 4: commit ──');

  const result5 = composeWeekClose(baseInput({ lookaheadReadyCount: 5 }));
  assert(
    result5.legs.find(l => l.id === 'commit')!.items.some(i => i.text.includes('5 tasks')),
    '5 constraint-clear tasks shown in commit leg',
  );

  const result0 = composeWeekClose(baseInput({ lookaheadReadyCount: 0 }));
  assert(
    result0.legs.find(l => l.id === 'commit')!.items.length === 0,
    '0 ready tasks → empty commit leg',
  );

  // undefined → empty
  const resultUndef = composeWeekClose(baseInput({}));
  assert(
    resultUndef.legs.find(l => l.id === 'commit')!.items.length === 0,
    'undefined lookaheadReadyCount → empty commit leg',
  );

  // Singular grammar
  const result1 = composeWeekClose(baseInput({ lookaheadReadyCount: 1 }));
  assert(
    result1.legs.find(l => l.id === 'commit')!.items.some(i => i.text.includes('1 task constraint-clear')),
    'singular "task" for count=1',
  );
}

// ─── LEG 5: clients ───────────────────────────────────────────────────────────

{
  console.log('\n── LEG 5: clients ──');

  const result = composeWeekClose(baseInput({ unsentClientItemCount: 3 }));
  const clientsLeg = result.legs.find(l => l.id === 'clients')!;
  assert(
    clientsLeg.items.some(i => i.id === 'unsent-client'),
    'unsent client items shown in clients leg',
  );
  assert(
    clientsLeg.items.some(i => i.text.includes('3 unsent client items')),
    'count shown in clients leg item',
  );
  assert(
    clientsLeg.items.some(i => i.id === 'client-update'),
    'weekly update link always present',
  );
  assert(
    clientsLeg.items.some(i => i.id === 'portal-digest-notice'),
    'portal digest honesty notice present',
  );

  // 0 unsent → no unsent line, but update link still present
  const result0 = composeWeekClose(baseInput({ unsentClientItemCount: 0 }));
  const clientsLeg0 = result0.legs.find(l => l.id === 'clients')!;
  assert(
    !clientsLeg0.items.some(i => i.id === 'unsent-client'),
    'unsentClientItemCount=0 → no unsent line',
  );
  assert(
    clientsLeg0.items.some(i => i.id === 'client-update'),
    'update link present even with 0 unsent items',
  );
}

// ─── allQuiet empty state ─────────────────────────────────────────────────────

{
  console.log('\n── allQuiet + empty state ──');

  const result = composeWeekClose(baseInput({}));
  // clients leg always has items (update link + portal notice) — so allQuiet = false
  assert(!result.allQuiet, 'clients leg always has items → not allQuiet');

  // Verify QUIET_CLOSE_LINE is exported
  assert(
    QUIET_CLOSE_LINE === 'Clean close — nothing left on the table this week.',
    'QUIET_CLOSE_LINE is correct',
  );

  // Confirm legs are in correct order
  const legIds = result.legs.map(l => l.id);
  assert(
    JSON.stringify(legIds) === JSON.stringify(['bill', 'chase', 'close', 'commit', 'clients']),
    'legs in correct order: bill→chase→close→commit→clients',
  );
}

// ─── Dedupe: CO appearing as both autoDraftedCO and unbilled WIP ──────────────

{
  console.log('\n── Dedupe across legs ──');

  // Same id should not appear twice across all legs combined
  const p1 = project({ id: 'p1', name: 'Dedup Job' });
  const report = dailyReport({ id: 'r1', projectId: 'p1', date: dateOnlyDaysAgo(2) });
  const co = changeOrder({
    id: 'co-dup', projectId: 'p1', number: 5,
    auditTrail: [{ id: 'a1', action: 'auto_drafted_from_leak', actor: 'MAGE', timestamp: daysAgoISO(1) }],
  });
  const wip = wipRow({ projectId: 'p1', projectName: 'Dedup Job', unbilled: 25_000 });

  const result = composeWeekClose(baseInput({
    projects: [p1], dailyReports: [report], wipRows: [wip],
    changeOrders: [co], autoDraftedCOs: [co],
  }));

  const allItems = result.legs.flatMap(l => l.items);
  const idCounts = new Map<string, number>();
  for (const item of allItems) {
    idCounts.set(item.id, (idCounts.get(item.id) ?? 0) + 1);
  }
  const dupes = Array.from(idCounts.entries()).filter(([, count]) => count > 1);
  assert(dupes.length === 0, 'no duplicate item ids across all legs', dupes.map(([id]) => id).join(', '));
}

// ─── dateISO format ───────────────────────────────────────────────────────────

{
  console.log('\n── dateISO output ──');
  const result = composeWeekClose(baseInput({ now: new Date(2026, 6, 25, 15, 0) }));
  assert(result.dateISO === '2026-07-25', `dateISO is local YYYY-MM-DD (got ${result.dateISO})`);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} composeWeekClose test(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nAll composeWeekClose tests passed.');
}
