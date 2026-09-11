// utils/portfolio/pipelineHorizon.ts — pipeline vs capacity horizon
//
// Answers: "what's coming in the door, and am I already full?"
// Sources: CRM leads (stages new/qualified/proposal), outbound bid_responses
// (pending marketplace bids), active project WIP backlog, schedule ends,
// capacity load in three 4-week windows.
//
// POPULATION RULE (bidHistoryFacts.ts:4-21 carried verbatim):
//   CRM win rate  = Lead.stage 'won'/'lost' from leads array (app/leads.tsx:82-93 math)
//   Outbound rate = bid_responses 'awarded'/'declined' from the GC's own submissions
//   NEVER pooled — different statistical populations.
//
// Pure. No React. No network. Never throws.

import type { Project, Invoice, ChangeOrder, Commitment, Lead, SavedAIAPayApp } from '@/types';
import type { HomeownerBidResponse } from '@/types';
import { computeCapacityLoad } from '@/utils/judges/capacityLoad';
import { computeWIPReport } from '@/utils/financialReports';
import { addWorkingDays } from '@/utils/scheduleEngine';
import { outboundBidRecordsFromResponses, bidHistoryFacts } from '@/utils/bidHistoryFacts';

const MS_PER_DAY = 86_400_000;

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface WinRates {
  /** CRM: % of won+lost leads that were won. null when < 3 decided. */
  crm: number | null;
  /** Outbound marketplace: from bidHistoryFacts. null when < 3 decided. */
  outbound: number | null;
}

export interface BacklogInfo {
  /** Σ(revisedContract − billedToDate) across active projects */
  remainingToBill$: number;
  /** Latest schedule end date across active projects. null = none scheduled. */
  horizonDate: string | null;
}

export interface LoadWindow {
  label: string; // "Next 4 weeks", "4–8 weeks", "8–12 weeks"
  startISO: string;
  endISO: string;
  loadPct: number;
  bookedSolid: boolean;
  overlappingProjects: number;
}

export interface PipelineHorizonResult {
  /** CRM pipeline: sum of (budgetMin + budgetMax) / 2 for new/qualified/proposal leads */
  leadPipeline$: number;
  leadCount: number;
  /** Pending marketplace bids: estimateAmount sum (0 when amount unknown) */
  pendingBids$: number;
  pendingBidsCount: number;
  winRates: WinRates;
  /** Expected inflow = each source × its own win rate (outbound omitted when null) */
  expectedInflow$: number;
  backlog: BacklogInfo;
  /** Three 4-week load windows from now */
  loadWindows: LoadWindow[];
  /** Single-crew + calendar-day approximation caveat */
  loadCaveat: string;
}

export interface PipelineHorizonInput {
  leads: Lead[];
  projects: Project[];
  invoices: Invoice[];
  changeOrders: ChangeOrder[];
  commitments: Commitment[];
  bidResponses: HomeownerBidResponse[];
  /**
   * SAVED AIA PAY APPLICATIONS (adversarial review 2026-09-11).
   *
   * `computeWIPReport` gained a pay-app parameter in the same pass that gave it
   * the shared contract chain and tax-free billings, and this call site was
   * left at four arguments. The contract and billings changes reach it for free
   * — they are inside the function — but the pay apps are not, and this file's
   * ONE use of the report is
   *     remainingToBill$ = Σ max(0, revisedContract − billedToDate)
   * so for a GC billing through the flagship G702/G703 flow, billedToDate read
   * $0 and the backlog was overstated by everything he had already billed.
   * Measured on a target-budget job with one $300,000 pay application:
   * remainingToBill$ 900,000 against a true 600,000.
   *
   * `costSources` and the cost-to-complete map are deliberately NOT threaded:
   * neither the contract nor the billings derive from them, so they cannot move
   * this file's only output. Adding parameters that cannot change a number is
   * how a signature stops meaning anything.
   *
   * Optional so the validators' hand-built fixtures still compile. app/
   * business.tsx and the One Mind fact bundle (app/ask.tsx) both pass it; a
   * caller that does not gets exactly the behaviour it had before, which is
   * invoices-only billings.
   */
  aiaPayApps?: SavedAIAPayApp[];
  now: Date;
}

export function buildPipelineHorizon(input: PipelineHorizonInput): PipelineHorizonResult {
  const { leads, projects, invoices, changeOrders, commitments, bidResponses, aiaPayApps, now } = input;

  // ── CRM pipeline leads ────────────────────────────────────────────────────
  const pipelineStages = new Set<string>(['new', 'qualified', 'proposal']);
  const pipelineLeads = leads.filter(l => pipelineStages.has(l.stage));
  let leadPipeline$ = 0;
  for (const l of pipelineLeads) {
    const mid =
      l.budgetMin != null && l.budgetMax != null
        ? (l.budgetMin + l.budgetMax) / 2
        : l.budgetMin ?? l.budgetMax ?? 0;
    leadPipeline$ += mid;
  }

  // CRM win rate: leads with stage 'won' or 'lost' (app/leads.tsx:82-93 pattern)
  const crmDecided = leads.filter(l => l.stage === 'won' || l.stage === 'lost');
  const crmWon = crmDecided.filter(l => l.stage === 'won').length;
  const crmWinRate: number | null =
    crmDecided.length >= 3 ? crmWon / crmDecided.length : null;

  // ── Outbound marketplace bids ────────────────────────────────────────────
  const pending = bidResponses.filter(
    r => r.status === 'submitted' || r.status === 'shortlisted',
  );
  const pendingBids$ = pending.reduce(
    (s, r) => s + (r.estimateAmount > 0 ? r.estimateAmount : 0),
    0,
  );

  const outboundRecords = outboundBidRecordsFromResponses(
    bidResponses.map(r => ({ bid_amount: r.estimateAmount ?? 0, status: r.status })),
  );
  const outboundFacts = bidHistoryFacts(outboundRecords);
  const outboundWinRate = outboundFacts.overallWinRate;

  // ── Expected inflow ───────────────────────────────────────────────────────
  let expectedInflow$ = 0;
  if (crmWinRate !== null) expectedInflow$ += leadPipeline$ * crmWinRate;
  if (outboundWinRate !== null) expectedInflow$ += pendingBids$ * outboundWinRate;

  // ── Backlog ────────────────────────────────────────────────────────────────
  const wipReport = computeWIPReport(projects, invoices, changeOrders, commitments, {}, aiaPayApps ?? []);
  const activeWipRows = wipReport.rows.filter(
    r => r.status !== 'completed' && r.status !== 'closed' && r.status !== 'draft',
  );
  const remainingToBill$ = activeWipRows.reduce(
    (s, r) => s + Math.max(0, r.revisedContract - r.billedToDate),
    0,
  );

  // Horizon = latest schedule end date across active projects
  let horizonDate: string | null = null;
  for (const p of projects) {
    if (p.status === 'completed' || p.status === 'closed' || p.status === 'draft') continue;
    const sched = p.schedule;
    if (!sched?.startDate || !sched.tasks?.length) continue;
    const start = new Date(sched.startDate + 'T00:00:00Z');
    if (!Number.isFinite(start.getTime())) continue;
    const wd = sched.workingDaysPerWeek ?? 5;
    // Latest end day across all tasks
    const maxEnd = sched.tasks.reduce(
      (m, t) => Math.max(m, (t.startDay ?? 1) + Math.max(0, (t.durationDays ?? 1) - 1)),
      0,
    );
    if (maxEnd <= 0) continue;
    const endDate = addWorkingDays(start, maxEnd, wd);
    const endISO = toISO(endDate);
    if (horizonDate === null || endISO > horizonDate) horizonDate = endISO;
  }

  // ── Capacity load windows (3 × 4 weeks) ──────────────────────────────────
  const loadWindows: LoadWindow[] = [];
  const labels = ['Next 4 weeks', '4–8 weeks', '8–12 weeks'];
  for (let i = 0; i < 3; i++) {
    const winStart = addDays(now, i * 28);
    const winEnd = addDays(now, (i + 1) * 28);
    const startISO = toISO(winStart);
    const endISO = toISO(winEnd);
    const load = computeCapacityLoad(projects, startISO, endISO);
    loadWindows.push({
      label: labels[i]!,
      startISO,
      endISO,
      loadPct: load.loadPct,
      bookedSolid: load.bookedSolid,
      overlappingProjects: load.overlappingProjects,
    });
  }

  return {
    leadPipeline$,
    leadCount: pipelineLeads.length,
    pendingBids$,
    pendingBidsCount: pending.length,
    winRates: { crm: crmWinRate, outbound: outboundWinRate },
    expectedInflow$,
    backlog: { remainingToBill$, horizonDate },
    loadWindows,
    loadCaveat:
      'Load uses a single-crew baseline mapping schedule task spans to calendar days. Parallel tasks within a project count once.',
  };
}
