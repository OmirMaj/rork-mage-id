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
//   - clients: informational reminder lines gated on active (portal) projects
//     and excluded from allQuiet / open-work counts

import {
  composeWeekClose, projectIsActive, QUIET_CLOSE_LINE,
  type ComposeWeekCloseInput, type WeekCloseWipRow,
} from '../utils/weekClose/composeWeekClose';
import { computeWipRow } from '../utils/wip';
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
    atRiskAmount: 0, collectionRiskScore: 20, unforecastCount: 0, unforecastAmount: 0,
    headline: '', topAction: '',
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

  // No active projects → no evergreen reminder lines at all.
  assert(
    !clientsLeg.items.some(i => i.id === 'client-update'),
    'no active projects → no weekly update link',
  );
  assert(
    !clientsLeg.items.some(i => i.id === 'portal-digest-notice'),
    'no active projects → no portal digest notice',
  );

  // Active project → update link present, tagged informational.
  const pActive = project({ id: 'p-cl', name: 'Client Job' });
  const repActive = dailyReport({ id: 'r-cl', projectId: 'p-cl', date: dateOnlyDaysAgo(2) });
  const resultActive = composeWeekClose(baseInput({
    projects: [pActive], dailyReports: [repActive], unsentClientItemCount: 0,
  }));
  const clientsActive = resultActive.legs.find(l => l.id === 'clients')!;
  assert(
    !clientsActive.items.some(i => i.id === 'unsent-client'),
    'unsentClientItemCount=0 → no unsent line',
  );
  assert(
    clientsActive.items.some(i => i.id === 'client-update' && i.informational === true),
    'active project → update link present and informational',
  );
  assert(
    !clientsActive.items.some(i => i.id === 'portal-digest-notice'),
    'active project WITHOUT portal → no portal digest notice (honesty)',
  );

  // Active project WITH a portal → notice present, tagged informational.
  const pPortal = project({
    id: 'p-portal', name: 'Portal Job',
    clientPortal: { enabled: true, portalId: 'pp1' },
  } as unknown as Partial<Project> & { id: string; name: string });
  const repPortal = dailyReport({ id: 'r-portal', projectId: 'p-portal', date: dateOnlyDaysAgo(2) });
  const resultPortal = composeWeekClose(baseInput({
    projects: [pPortal], dailyReports: [repPortal],
  }));
  const clientsPortal = resultPortal.legs.find(l => l.id === 'clients')!;
  assert(
    clientsPortal.items.some(i => i.id === 'portal-digest-notice' && i.informational === true),
    'active portal project → portal digest notice present and informational',
  );
}

// ─── allQuiet empty state ─────────────────────────────────────────────────────

{
  console.log('\n── allQuiet + empty state ──');

  // G10: zero qualifying items → allQuiet must actually be reachable.
  const result = composeWeekClose(baseInput({}));
  assert(result.allQuiet, 'no projects, no items → allQuiet true (quiet close reachable)');

  // An ACTIVE project with zero open work: only the informational client-
  // update reminder remains — still an honestly quiet close.
  const pQuiet = project({ id: 'p-q', name: 'Quiet Job' });
  const repQuiet = dailyReport({ id: 'r-q', projectId: 'p-q', date: dateOnlyDaysAgo(2) });
  const quiet = composeWeekClose(baseInput({ projects: [pQuiet], dailyReports: [repQuiet] }));
  assert(
    quiet.legs.find(l => l.id === 'clients')!.items.some(i => i.informational === true),
    'quiet active project still gets the informational reminder line',
  );
  assert(quiet.allQuiet, 'active project with only informational lines → allQuiet true');

  // Real open work flips it off.
  const busy = composeWeekClose(baseInput({
    projects: [pQuiet], dailyReports: [repQuiet],
    wipRows: [wipRow({ projectId: 'p-q', projectName: 'Quiet Job', unbilled: 20_000 })],
  }));
  assert(!busy.allQuiet, 'unbilled WIP (open work) → allQuiet false');

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

// ─── Verdict agreement (sim-audit fix #13) ────────────────────────────────────
// Home card said "1 leg to close out" while the modal said "Clean close" for
// the SAME week: the ppc recap + lookahead forecast lines flipped allQuiet on
// whichever surface's snapshot had them loaded. Recap/forecast lines are now
// informational, so every surface that filters on the flag (home card,
// modal headline, allQuiet itself) counts the same legs.

{
  console.log('\n── Verdict agreement: recap/forecast lines are informational ──');

  const pQuiet = project({ id: 'p-v', name: 'Verdict Job' });
  const repQuiet = dailyReport({ id: 'r-v', projectId: 'p-v', date: dateOnlyDaysAgo(2) });

  const thisMonday = (() => {
    const d = new Date(NOW);
    const dow = d.getDay();
    const shift = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + shift);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const commitments: WeeklyCommitment[] = Array.from({ length: 4 }, (_, i) => ({
    taskId: `tv${i}`, weekStart: thisMonday, committed: true, outcome: 'done' as const,
  }));

  // PPC recap + lookahead forecast + client reminders, ZERO actionable work.
  const recapOnly = composeWeekClose(baseInput({
    projects: [pQuiet], dailyReports: [repQuiet],
    wwp: { commitments, ppc: null },
    lookaheadReadyCount: 5,
  }));
  assert(
    recapOnly.legs.find(l => l.id === 'close')!.items.every(i => i.informational === true),
    'ppc recap line is informational',
  );
  assert(
    recapOnly.legs.find(l => l.id === 'commit')!.items.every(i => i.informational === true),
    'lookahead forecast line is informational',
  );
  assert(recapOnly.allQuiet, 'recap + forecast + reminders only → allQuiet true');

  // The open-leg count every surface derives (legs with ≥1 non-informational
  // item) must be 0 in this state — home card and modal headline agree.
  const openLegs = recapOnly.legs.filter(l => l.items.some(i => !i.informational)).length;
  assert(openLegs === 0, 'surface open-leg count is 0 when only recap/forecast lines exist');

  // Actionable work still flips both the same way.
  const withWork = composeWeekClose(baseInput({
    projects: [pQuiet], dailyReports: [repQuiet],
    wwp: { commitments, ppc: null },
    lookaheadReadyCount: 5,
    unsentClientItemCount: 2,
  }));
  assert(!withWork.allQuiet, 'unsent client items (actionable) → allQuiet false');
  const openLegs2 = withWork.legs.filter(l => l.items.some(i => !i.informational)).length;
  assert(openLegs2 === 1, 'actionable work opens exactly the clients leg on both surfaces');
  assert(
    withWork.legs.find(l => l.id === 'clients')!.items.some(i => i.id === 'unsent-client' && !i.informational),
    'unsent-client stays actionable (never informational)',
  );

  // PPC fallback line follows the same rule. The fallback branch needs
  // commitments present but NONE for the current week (committed=0), plus a
  // pre-computed ppc.
  const staleCommitments: WeeklyCommitment[] = [
    { taskId: 'old1', weekStart: '2026-01-05', committed: true, outcome: 'done' as const },
  ];
  const fallback = composeWeekClose(baseInput({
    projects: [pQuiet], dailyReports: [repQuiet],
    wwp: { commitments: staleCommitments, ppc: 0.72 },
  }));
  const closeItems = fallback.legs.find(l => l.id === 'close')!.items;
  assert(
    closeItems.length > 0 && closeItems.every(i => i.informational === true),
    'ppc fallback line is informational',
  );
  assert(fallback.allQuiet, 'ppc fallback only → allQuiet true');
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

// ─── Bill leg wired to the REAL WIP engine (utils/wip) ────────────────────────

{
  console.log('\n── bill leg ← real WIP engine ──');

  // A job 60% complete by cost with $18K earned-not-billed:
  // contract 200K, est cost 150K, cost-to-date 90K (60%), billed 102K
  // → earned 120K, underbilling 18K. This is the shape useWeekClose derives
  // (computeWipRow → underbilling), pinned here so the bill leg can never
  // again be silently starved by a dead WIP source (financialReports.
  // computeWIPReport's unbilled is structurally 0 — earned ≡ billed).
  const out = computeWipRow({
    originalContract: 200_000, approvedChangeOrders: 0,
    totalEstimatedCost: 150_000, costToDate: 90_000, billedToDate: 102_000,
  });
  assert(
    Math.round(out.underbilling) === 18_000,
    `real WIP engine yields $18K underbilling (got ${out.underbilling})`,
  );
  assert(
    Math.round(out.percentComplete * 100) === 60,
    `real WIP engine yields 60% complete (got ${out.percentComplete * 100})`,
  );

  const p = project({ id: 'p-wip', name: 'Engine Job' });
  const rep = dailyReport({ id: 'r-wip', projectId: 'p-wip', date: dateOnlyDaysAgo(2) });
  const engineRow: WeekCloseWipRow = {
    projectId: 'p-wip',
    projectName: 'Engine Job',
    unbilled: out.underbilling,
    percentComplete: out.percentComplete * 100,
  };
  const result = composeWeekClose(baseInput({
    projects: [p], dailyReports: [rep], wipRows: [engineRow],
  }));
  const bill = result.legs.find(l => l.id === 'bill')!;
  assert(
    bill.items.some(i => i.id === 'unbilled-p-wip' && i.text.includes('$18K') && i.text.includes('60% complete')),
    'engine-derived unbilled row flows into the bill leg',
  );
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
