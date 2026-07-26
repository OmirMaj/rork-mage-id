// scripts/validate-compose-brief.ts — validator for the Morning Brief
// composer (utils/brief/composeBrief.ts) and the nudge fire-time math
// (utils/brief/nudgeTime.ts).
//
// Plan-required cases: dedupe (per-invoice brainWatch lines suppress the
// aggregate overdue rollup), the honest empty state, and yesterday
// windowing on the LOCAL calendar. Plus: leak fallback windowing, missing-
// report cadence, severity ordering + cap, self-correction line selection,
// summary-line grammar, and nudge date rollovers.

import {
  composeBrief, briefIsQuiet, briefIsEmpty, briefSummaryLine,
  fallbackOpenLeaks, missingReportItems, yesterdayEntries,
  selectSelfCorrectionLine, localDateISO, QUIET_MORNING_LINE,
  type ComposeBriefInput, type MorningBrief,
} from '../utils/brief/composeBrief';
import { nextMorningFireDate } from '../utils/brief/nudgeTime';
import type {
  Project, Invoice, ChangeOrder, PunchItem, DailyFieldReport,
} from '../types';
import type { CashFlowSummary } from '../utils/cashFlowEngine';
import type { DidForYouEntry } from '../utils/brain/didForYou';
import type { AccuracyReport } from '../utils/brain/accuracyReport';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? `\n   ${extra}` : ''); }
}

// ─── Fixture helpers ─────────────────────────────────────────────────────────

// Fixed local "now": a Saturday morning, mid-month, mid-day-of-week window.
const NOW = new Date(2026, 6, 25, 6, 30, 0); // Jul 25 2026, 06:30 local

function daysAgoISO(days: number, hour = 12): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function project(over: Partial<Project> & { id: string; name: string }): Project {
  return {
    status: 'in_progress',
    createdAt: daysAgoISO(60),
    ...over,
  } as unknown as Project;
}

function invoice(over: Record<string, unknown> & { id: string; projectId: string }): Invoice {
  return {
    number: '12', status: 'sent', totalDue: 5_000, amountPaid: 0,
    dueDate: daysAgoISO(20),
    ...over,
  } as unknown as Invoice;
}

function baseInput(over: Partial<ComposeBriefInput> = {}): ComposeBriefInput {
  return {
    projects: [], invoices: [], changeOrders: [], punchItems: [], permits: [],
    expiringCertifications: [], dailyReports: [], didForYouEntries: [],
    openLeakFlags: { count: 0, estTotal: 0 },
    now: NOW,
    ...over,
  };
}

function ids(items: { id: string }[]): string[] {
  return items.map(i => i.id);
}

// ─── 1. Honest empty state ───────────────────────────────────────────────────

console.log('\ncomposeBrief — empty state:');
{
  const brief: MorningBrief = composeBrief(baseInput());
  ok('empty input → all sections empty',
    brief.needsYou.length === 0 && brief.watching.length === 0 && brief.didForYou.length === 0);
  ok('empty input → quiet AND empty', briefIsQuiet(brief) && briefIsEmpty(brief));
  ok('empty input → quiet summary line', briefSummaryLine(brief) === QUIET_MORNING_LINE);
  ok('dateISO is the local calendar day', brief.dateISO === localDateISO(NOW));
}

// ─── 2. needsYou: brainWatch + aggregate dedupe ──────────────────────────────

console.log('\ncomposeBrief — needsYou dedupe:');
{
  const p = project({ id: 'p1', name: 'Henderson' });
  // 20d-overdue invoice → BOTH invoiceAttention (>7d) and the aggregate
  // rollup would fire; per-invoice line must win, rollup must be suppressed.
  const both = composeBrief(baseInput({ projects: [p], invoices: [invoice({ id: 'inv1', projectId: 'p1' })] }));
  ok('per-invoice brainWatch line present', ids(both.needsYou).includes('invoice-inv1'));
  ok('aggregate overdue rollup suppressed', !ids(both.needsYou).includes('agg-overdue-invoices'));

  // 3d-overdue invoice → inside brainWatch's 7-day grace window, so ONLY the
  // aggregate rollup catches it.
  const graceOnly = composeBrief(baseInput({
    projects: [p],
    invoices: [invoice({ id: 'inv2', projectId: 'p1', dueDate: daysAgoISO(3) })],
  }));
  ok('grace-window invoice → rollup kept', ids(graceOnly.needsYou).includes('agg-overdue-invoices'));
  ok('grace-window invoice → no per-invoice line', !ids(graceOnly.needsYou).includes('invoice-inv2'));

  // CORRECTED (tribunal): suppress only when the per-invoice lines cover the
  // rollup's WHOLE population. A 20d overdue (itemized) + a 3d overdue
  // (grace window — rollup only) must keep BOTH the line and the rollup.
  const mixed = composeBrief(baseInput({
    projects: [p],
    invoices: [
      invoice({ id: 'inv-far', projectId: 'p1' }), // 20d → per-invoice line
      invoice({ id: 'inv-near', projectId: 'p1', dueDate: daysAgoISO(3) }), // grace → rollup only
    ],
  }));
  ok('wider rollup kept alongside per-invoice line', ids(mixed.needsYou).includes('agg-overdue-invoices'));
  ok('per-invoice line still present in mixed case', ids(mixed.needsYou).includes('invoice-inv-far'));

  // Receivable on a COMPLETED project: brainWatch skips inactive projects,
  // so only the rollup carries it — it must not be suppressed by an
  // itemized invoice on an active project.
  const done = project({ id: 'p2', name: 'Done Job', status: 'completed' as Project['status'] });
  const closedMoney = composeBrief(baseInput({
    projects: [p, done],
    invoices: [
      invoice({ id: 'inv-act', projectId: 'p1' }),  // active, 20d → itemized
      invoice({ id: 'inv-done', projectId: 'p2' }), // completed project → rollup only
    ],
  }));
  ok('completed-project receivable keeps the rollup', ids(closedMoney.needsYou).includes('agg-overdue-invoices'));

  // Punch + pending-CO rollups always pass through.
  const rollups = composeBrief(baseInput({
    projects: [p],
    punchItems: [{ id: 'pi1', projectId: 'p1', status: 'open', priority: 'high' } as unknown as PunchItem],
    changeOrders: [{ id: 'co1', projectId: 'p1', status: 'submitted' } as unknown as ChangeOrder],
  }));
  ok('urgent punch rollup present', ids(rollups.needsYou).includes('agg-urgent-punch'));
  ok('pending CO rollup present', ids(rollups.needsYou).includes('agg-pending-cos'));
  const punchItem = rollups.needsYou.find(i => i.id === 'agg-urgent-punch');
  ok('punch rollup routes to project-detail', punchItem?.route?.pathname === '/project-detail' && punchItem?.route?.params?.id === 'p1');
}

// ─── 3. needsYou: severity order + cap ───────────────────────────────────────

console.log('\ncomposeBrief — severity order + cap:');
{
  const p = project({ id: 'p1', name: 'Henderson' });
  // 40d overdue → critical; pending CO → medium; 10d overdue → medium sev high.
  const brief = composeBrief(baseInput({
    projects: [p],
    invoices: [
      invoice({ id: 'a', projectId: 'p1', dueDate: daysAgoISO(40) }), // critical
      invoice({ id: 'b', projectId: 'p1', dueDate: daysAgoISO(10) }), // medium
    ],
    changeOrders: [{ id: 'co1', projectId: 'p1', status: 'submitted' } as unknown as ChangeOrder],
  }));
  const sevs = brief.needsYou.map(i => i.severity);
  const rank = (s: string | undefined) => s === 'critical' ? 0 : s === 'high' ? 1 : 2;
  ok('needsYou sorted critical→high→medium',
    sevs.every((s, i) => i === 0 || rank(sevs[i - 1]) <= rank(s)), sevs.join(','));

  // Cap at 10.
  const many = composeBrief(baseInput({
    projects: [p],
    invoices: Array.from({ length: 14 }, (_, i) =>
      invoice({ id: `inv${i}`, projectId: 'p1', dueDate: daysAgoISO(20 + i) })),
  }));
  ok('needsYou capped at 10', many.needsYou.length === 10, String(many.needsYou.length));
}

// ─── 4. needsYou: leak flags (ledger input + pure fallback) ──────────────────

console.log('\ncomposeBrief — leak flags:');
{
  const p = project({ id: 'p1', name: 'Henderson' });
  const fromLedger = composeBrief(baseInput({
    projects: [p],
    openLeakFlags: { count: 2, estTotal: 1_500 },
  }));
  const leak = fromLedger.needsYou.find(i => i.id === 'open-leak-flags');
  ok('ledger leak item present', !!leak);
  ok('ledger leak text carries count + $', !!leak && leak.text.includes('2 profit-leak scans') && leak.text.includes('$'), leak?.text);
  ok('leak ≥$1K → high severity', leak?.severity === 'high');
  ok('leak routes to a real screen (/report-inbox)', leak?.route?.pathname === '/report-inbox');

  // Pure fallback: openLeakFlags null → scan reports from last 14 days on
  // active projects only.
  const reports: DailyFieldReport[] = [
    { id: 'r1', projectId: 'p1', date: daysAgoISO(5),
      leakScan: { items: [{ estimatedPrice: 800 }, { estimatedPrice: null }], scannedAt: daysAgoISO(5), textHash: 'x' } },
    { id: 'r2', projectId: 'p1', date: daysAgoISO(20),
      leakScan: { items: [{ estimatedPrice: 999 }], scannedAt: daysAgoISO(20), textHash: 'y' } }, // too old
    { id: 'r3', projectId: 'closed1', date: daysAgoISO(3),
      leakScan: { items: [{ estimatedPrice: 500 }], scannedAt: daysAgoISO(3), textHash: 'z' } }, // closed project
  ] as unknown as DailyFieldReport[];
  const closed = project({ id: 'closed1', name: 'Done Job', status: 'closed' as Project['status'] });
  const fb = fallbackOpenLeaks(reports, [p, closed], NOW);
  ok('fallback counts only recent scans on active projects', fb.count === 1, String(fb.count));
  ok('fallback sums estimated prices (null-safe)', fb.estTotal === 800, String(fb.estTotal));

  const fbBrief = composeBrief(baseInput({ projects: [p, closed], dailyReports: reports, openLeakFlags: null }));
  const fbItem = fbBrief.needsYou.find(i => i.id === 'open-leak-flags');
  ok('null ledger → fallback item present (singular grammar)',
    !!fbItem && fbItem.text.startsWith("1 profit-leak scan hasn't"), fbItem?.text);
  ok('leak <$1K → medium severity', fbItem?.severity === 'medium');
}

// ─── 5. watching: cash danger + week load + missing reports ─────────────────

console.log('\ncomposeBrief — watching:');
{
  const cash: CashFlowSummary = {
    totalIncome: 10_000, totalExpenses: 14_000, netProfit: -4_000,
    lowestBalance: -4_200, lowestBalanceWeek: 3, highestBalance: 9_000, highestBalanceWeek: 1,
    dangerWeeks: [
      { weekNumber: 3, weekDate: '2026-08-10', balance: -4_200 },
      { weekNumber: 4, weekDate: '2026-08-17', balance: -1_100 },
    ],
  };
  const brief = composeBrief(baseInput({ cashSummary: cash }));
  const cashItem = brief.watching.find(i => i.id === 'cash-danger');
  ok('cash danger item present', !!cashItem);
  ok('cash text carries week + amount + horizon',
    !!cashItem && cashItem.text.includes('2026-08-10') && cashItem.text.includes('$') && cashItem.text.includes('2 negative weeks'),
    cashItem?.text);
  ok('cash routes to /cash-flow', cashItem?.route?.pathname === '/cash-flow');

  // Week load: schedule started 30d ago, one 60d task → active all week.
  const busy = project({
    id: 'p1', name: 'Henderson',
    schedule: {
      id: 's1', name: 'S', projectId: 'p1',
      startDate: daysAgoISO(30).slice(0, 10),
      tasks: [{ id: 't1', title: 'Framing', phase: 'G', startDay: 1, durationDays: 60, progress: 10, status: 'in_progress' }],
      riskItems: [], healthScore: 90,
    },
  } as unknown as Partial<Project> & { id: string; name: string });
  const loadBrief = composeBrief(baseInput({ projects: [busy] }));
  const loadItem = loadBrief.watching.find(i => i.id === 'week-load');
  ok('week-load item present when tasks active', !!loadItem);
  ok('week-load counts 7 busy days', !!loadItem && loadItem.text.includes('7 of 7 days'), loadItem?.text);
  ok('no week-load item when no schedules', composeBrief(baseInput()).watching.every(i => i.id !== 'week-load'));

  // Missing report: cadence at d-3/d-4, nothing yesterday.
  const p = project({ id: 'p1', name: 'Henderson' });
  const cadenceReports = [
    { id: 'r1', projectId: 'p1', date: daysAgoISO(3) },
    { id: 'r2', projectId: 'p1', date: daysAgoISO(4) },
  ] as unknown as DailyFieldReport[];
  const missing = missingReportItems([p], cadenceReports, NOW);
  ok('cadence + gap → missing-report item', missing.length === 1 && missing[0].id === 'no-report-p1');
  ok('missing-report routes to /daily-report with projectId',
    missing[0]?.route?.pathname === '/daily-report' && missing[0]?.route?.params?.projectId === 'p1');

  const filedYesterday = [...cadenceReports,
    { id: 'r3', projectId: 'p1', date: daysAgoISO(1) } as unknown as DailyFieldReport];
  ok('report filed yesterday → no item', missingReportItems([p], filedYesterday, NOW).length === 0);

  const noCadence = [{ id: 'r1', projectId: 'p1', date: daysAgoISO(3) }] as unknown as DailyFieldReport[];
  ok('single report ≠ cadence → no item', missingReportItems([p], noCadence, NOW).length === 0);

  const notStarted = project({ id: 'p2', name: 'Precon', status: 'planning' as Project['status'] });
  ok('non-in_progress project → no item', missingReportItems([notStarted], cadenceReports, NOW).length === 0);
}

// ─── 6. didForYou: yesterday windowing across the local calendar ────────────

console.log('\ncomposeBrief — didForYou windowing:');
{
  const localStamp = (daysBack: number, hour: number, minute: number): string => {
    const d = new Date(NOW);
    d.setDate(d.getDate() - daysBack);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString(); // UTC serialization of a LOCAL moment
  };
  const entries: DidForYouEntry[] = [
    { id: 'e1', at: localStamp(1, 0, 30), text: 'Rippled 3 tasks from your delay note', projectId: 'p1' },
    { id: 'e2', at: localStamp(1, 23, 59), text: 'Auto-stamped actual dates for Framing' },
    { id: 'e3', at: localStamp(0, 0, 10), text: 'today — excluded' },
    { id: 'e4', at: localStamp(2, 12, 0), text: 'two days ago — excluded' },
    { id: 'e5', at: 'not-a-date', text: 'garbage — excluded' },
  ];
  const kept = yesterdayEntries(entries, NOW);
  ok('keeps 00:30 and 23:59 local yesterday', ids(kept).join(',') === 'e1,e2', ids(kept).join(','));

  const brief = composeBrief(baseInput({ didForYouEntries: entries }));
  ok('didForYou section carries both entries', brief.didForYou.length === 2);
  ok('entry with projectId routes to project-detail',
    brief.didForYou[0].route?.pathname === '/project-detail' && brief.didForYou[0].route?.params?.id === 'p1');
  ok('entry without projectId has no route', brief.didForYou[1].route === undefined);
  ok('didForYou alone is quiet but NOT empty', briefIsQuiet(brief) && !briefIsEmpty(brief));
}

// ─── 7. Accuracy self-correction line ───────────────────────────────────────

console.log('\ncomposeBrief — self-correction line:');
{
  const correcting: AccuracyReport = {
    totalGraded: 6, hasEnoughData: true,
    rows: [
      { kind: 'instant_bid_sent', label: 'Instant bid win rate', n: 4, rate: 0.75,
        headline: '75% win rate on Instant Bid proposals (4 decided)',
        detail: '3 of 4 Instant Bid responses awarded — above average.' },
      { kind: 'estimate_confidence_snapshot', label: 'Estimate accuracy', n: 3, rate: 0.7,
        headline: 'Estimates averaged -6% vs actuals across 3 closed jobs',
        detail: "My estimates ran -6% under actual costs — I'm leaving margin on the table. Recalibrating my high-confidence line estimates upward." },
    ],
  };
  const line = selectSelfCorrectionLine(correcting);
  ok('picks the corrective row, skips the congratulatory one',
    !!line && line.includes('Recalibrating'), line ?? 'null');

  const praiseOnly: AccuracyReport = {
    totalGraded: 4, hasEnoughData: true,
    rows: [correcting.rows[0]],
  };
  ok('no corrective row → null', selectSelfCorrectionLine(praiseOnly) === null);
  ok('n-gated report → null', selectSelfCorrectionLine({ totalGraded: 1, hasEnoughData: false, rows: [] }) === null);

  const brief = composeBrief(baseInput({ accuracyReport: correcting }));
  const item = brief.didForYou.find(i => i.id === 'brain-self-correction');
  ok('self-correction lands in didForYou → /cost-database',
    !!item && item.route?.pathname === '/cost-database');
}

// ─── 8. Summary line grammar ─────────────────────────────────────────────────

console.log('\ncomposeBrief — summary line:');
{
  const p = project({ id: 'p1', name: 'Henderson' });
  const one = composeBrief(baseInput({ projects: [p], invoices: [invoice({ id: 'i1', projectId: 'p1' })] }));
  ok('singular "1 needs you"', briefSummaryLine(one).startsWith('1 needs you'), briefSummaryLine(one));

  const cash: CashFlowSummary = {
    totalIncome: 0, totalExpenses: 0, netProfit: 0, lowestBalance: -1, lowestBalanceWeek: 1,
    highestBalance: 0, highestBalanceWeek: 1,
    dangerWeeks: [{ weekNumber: 1, weekDate: '2026-07-27', balance: -1 }],
  };
  const watchOnly = composeBrief(baseInput({ cashSummary: cash }));
  ok('zero needsYou segment dropped', briefSummaryLine(watchOnly) === '1 watching', briefSummaryLine(watchOnly));
}

// ─── 9. Nudge fire-time math ─────────────────────────────────────────────────

console.log('\nnudgeTime — nextMorningFireDate:');
{
  const monthEnd = nextMorningFireDate(6, 30, new Date(2026, 0, 31, 22, 0));
  ok('month rollover → Feb 1, 06:30 local',
    monthEnd.getMonth() === 1 && monthEnd.getDate() === 1 && monthEnd.getHours() === 6 && monthEnd.getMinutes() === 30);

  const yearEnd = nextMorningFireDate(6, 30, new Date(2026, 11, 31, 23, 59));
  ok('year rollover → Jan 1 next year', yearEnd.getFullYear() === 2027 && yearEnd.getMonth() === 0 && yearEnd.getDate() === 1);

  // CORRECTED (tribunal): an app open BEFORE the fire time must keep TODAY's
  // nudge — always-tomorrow meant every early-morning open silently
  // cancelled the day's doorbell.
  const early = nextMorningFireDate(6, 30, new Date(2026, 6, 25, 2, 0));
  ok('before today\'s hour → fires TODAY', early.getDate() === 25 && early.getHours() === 6 && early.getMinutes() === 30);

  const after = nextMorningFireDate(6, 30, new Date(2026, 6, 25, 7, 0));
  ok('after today\'s hour → fires tomorrow', after.getDate() === 26 && after.getHours() === 6);

  const atFire = nextMorningFireDate(6, 30, new Date(2026, 6, 25, 6, 30, 0));
  ok('exactly at the fire minute → tomorrow (never in the past)', atFire.getDate() === 26);

  const clamped = nextMorningFireDate(25, 90, new Date(2026, 6, 25, 12, 0));
  ok('clamps hour/minute into range', clamped.getHours() === 23 && clamped.getMinutes() === 59);
  ok('clamped time still ahead → fires today', clamped.getDate() === 25);
}

// ─── Result ──────────────────────────────────────────────────────────────────

console.log(`\ncompose-brief: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
