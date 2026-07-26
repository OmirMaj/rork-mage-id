// utils/oneMind/factBlocks.ts — One Mind's per-domain fact assemblers.
//
// Every engine the app already runs — living estimate, margin risk, schedule
// health, pace book, RFI latency, brain watch, cash flow, portfolio engines,
// prediction-ledger accuracy — feeds ONE answer surface through a common
// currency: the FactBlock. facts ≡ the copilot's Grounding.facts idiom;
// drillIn ≡ brainWatch's AttentionItem.route contract, so every cited block
// can jump to the real screen behind it.
//
// PURITY SPLIT (narrateVerdict.ts precedent):
//   - The per-domain build*Block functions are PURE (engine output in →
//     fact lines out). Bun validators exercise them directly.
//   - assembleFactBlocks is the async orchestrator. Impure sources (business
//     records serializer, project memory, cash-flow storage, prediction
//     ledger) are LAZY-imported inside their own try/catch, so a failing
//     source skips its block instead of killing the answer (runJudges.ts
//     additive pattern) — and this module's top level stays Bun-importable.
//
// G4 analogue: assembly is never load-bearing on any single engine.

import type { Route } from 'expo-router';
import type {
  Project, RFI, Invoice, ChangeOrder, Commitment, Lead, DailyFieldReport,
  Permit, Certification, Submittal, PunchItem, HomeownerBidResponse,
  MaterialReceipt,
} from '@/types';
import { computeLivingEstimate, type LivingEstimateSnapshot } from '@/utils/livingEstimate';
import { computeMarginRisk, type MarginRiskScore } from '@/utils/marginRiskScore';
import { computePillStatus, pillLabel } from '@/utils/scheduleHealth';
import { buildPaceBook, lookupPace, type PaceBook } from '@/utils/pace/paceBook';
import { tradeKeyForTask } from '@/utils/scheduleColors';
import { computeRFILatency } from '@/utils/rfiLatency';
import {
  scheduleAttention, invoiceAttention, permitAttention, certAttention,
  closeoutAttention, rankAttention, type AttentionItem,
} from '@/utils/brainWatch';
import {
  buildTypeProfitability, buildPipelineHorizon, buildClientBook,
  buildWeatherSeasonality, typeProfitabilityFacts, pipelineHorizonFacts,
  clientBookFacts, seasonalityFacts, type PortfolioFactBlock,
} from '@/utils/portfolio';
import type { AccuracyReport } from '@/utils/brain/accuracyReport';
import type { CashFlowSummary } from '@/utils/cashFlowEngine';
import type { CostSample } from '@/utils/costDatabase';
import type { OneMindScope } from './resolveScope';

// ─── The common currency ─────────────────────────────────────────────────────

export interface FactBlockDrillIn {
  /** Typed against the router (expo-router's generated Route union), so a
   *  drill-in to a route that doesn't exist fails tsc instead of shipping a
   *  +not-found dead end (the /profit-leak-history regression). */
  pathname: Route;
  params?: Record<string, string>;
}

export interface FactBlock {
  /** Human domain name, e.g. "LIVE MARGIN". */
  domain: string;
  /** Stable citation ref the model quotes back, e.g. "MARGIN". */
  ref: string;
  /** Prompt-ready fact lines (Grounding.facts idiom). */
  facts: string[];
  /** Where a tapped citation lands (AttentionItem.route contract). */
  drillIn?: FactBlockDrillIn;
}

/** Everything One Mind may read. The judges assembly (app/judges.tsx) plus
 *  docs/field/precon collections and the Wave-3 bid-responses hook. All
 *  supplied by the calling screen — this module never touches contexts. */
export interface OneMindBundle {
  projects: Project[];
  commitments: Commitment[];
  changeOrders: ChangeOrder[];
  invoices: Invoice[];
  rfis: RFI[];
  leads: Lead[];
  dailyReports: DailyFieldReport[];
  permits: Permit[];
  submittals: Submittal[];
  punchItems: PunchItem[];
  expiringCertifications: (Certification & { status: 'expiring' | 'expired' })[];
  bidResponses: HomeownerBidResponse[];
  /** Judges-assembly parity; reserved for cost-book fact blocks (v1.1). */
  receipts?: MaterialReceipt[];
  laborSamples?: CostSample[];
}

// ─── Small formatters (module-local, mirror portfolio/factLines style) ──────

function fmtMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function fmtPct1(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

// ─── Cold start ──────────────────────────────────────────────────────────────

/** True when there is nothing logged to answer from — the honest empty case.
 *  The caller short-circuits to a plain "log something first" answer instead
 *  of burning an AI call on an empty prompt. */
export function isColdStart(bundle: OneMindBundle): boolean {
  return (
    bundle.projects.length === 0 &&
    bundle.invoices.length === 0 &&
    bundle.leads.length === 0 &&
    bundle.dailyReports.length === 0
  );
}

// ─── RECORDS (mageAgent.buildBusinessContext, wrapped whole) ─────────────────

export function buildRecordsBlock(contextText: string): FactBlock {
  return {
    domain: 'BUSINESS RECORDS',
    ref: 'RECORDS',
    facts: contextText.split('\n').map(l => l.trim()).filter(Boolean),
  };
}

// ─── MARGIN (computeLivingEstimate) ──────────────────────────────────────────

export function buildMarginBlock(
  projectId: string,
  projectName: string,
  le: LivingEstimateSnapshot,
): FactBlock {
  const facts: string[] = [];
  if (!le.hasMarginBasis) {
    // Never silence the gap — the explicit fact beats a hallucinated margin.
    facts.push(
      `No margin basis: ${projectName}'s estimate is not linked or carries no cost/markup split, so live margin can't be computed. Link an estimate with markup to enable it.`,
    );
  } else {
    facts.push(`Bid margin ${fmtPct1(le.original.marginPct)} (${fmtMoney(le.original.margin)} on ${fmtMoney(le.original.revenue)}).`);
    facts.push(`Projected margin at completion ${fmtPct1(le.projected.marginPct)} (${fmtMoney(le.projected.margin)} on ${fmtMoney(le.projected.revenue)}).`);
    if (Math.abs(le.marginErosionPoints) >= 0.1) {
      facts.push(
        le.marginErosionPoints < 0
          ? `Margin down ${Math.abs(le.marginErosionPoints).toFixed(1)} pts (${fmtMoney(le.marginErosionDollars)}) from bid.`
          : `Margin up ${le.marginErosionPoints.toFixed(1)} pts from bid.`,
      );
    }
    for (const d of le.drivers.slice(0, 3)) {
      facts.push(`Driver — ${d.label}: ${d.detail}.`);
    }
    if (le.pendingChangeOrders > 0) {
      facts.push(`${fmtMoney(le.pendingChangeOrders)} in pending change orders (not booked into projected).`);
    }
    facts.push(`Margin health: ${le.health}.`);
  }
  return {
    domain: 'LIVE MARGIN',
    ref: 'MARGIN',
    facts,
    drillIn: { pathname: '/living-estimate', params: { projectId } },
  };
}

// ─── RISK (computeMarginRisk) ────────────────────────────────────────────────

export function buildRiskBlock(projectId: string, risk: MarginRiskScore): FactBlock | null {
  if (!risk.hasBasis) return null; // MARGIN block already carries the honesty line
  const facts: string[] = [
    `Margin risk score ${risk.score}/100 (${risk.band}).`,
  ];
  for (const f of risk.topFactors.slice(0, 3)) {
    facts.push(`${f.label}: ${f.detail}. ${f.recommendation}`);
  }
  return {
    domain: 'MARGIN RISK',
    ref: 'RISK',
    facts,
    drillIn: { pathname: '/margin-risk', params: { projectId } },
  };
}

// ─── SCHEDULE (schedule.healthScore + computePillStatus) ─────────────────────

export function buildScheduleBlock(project: Project, now: Date = new Date()): FactBlock {
  const schedule = project.schedule;
  const facts: string[] = [];
  if (!schedule || schedule.tasks.length === 0) {
    facts.push(`No schedule built for ${project.name} yet.`);
  } else {
    const tasks = schedule.tasks;
    const done = tasks.filter(t => t.status === 'done').length;

    // Overdue = not done and planned finish already past (mageAgent idiom —
    // needs startDate to map day numbers onto the calendar).
    let overdueCount = 0;
    if (schedule.startDate) {
      const start = new Date(schedule.startDate);
      if (!isNaN(start.getTime())) {
        const todayDay = Math.floor((now.getTime() - start.getTime()) / 86_400_000) + 1;
        overdueCount = tasks.filter(
          t => t.status !== 'done' && (t.startDay + Math.max(0, t.durationDays - 1)) < todayDay,
        ).length;
      }
    }

    const health = schedule.healthScore;
    const pill = computePillStatus({
      cpmSlipDays: 0, // baseline slip isn't persisted; health + overdue carry the signal
      overdueCount,
      healthScore: health ?? 100,
    });
    facts.push(
      `Schedule status: ${pillLabel(pill)}${health != null ? ` (health ${Math.round(health)}/100)` : ' (no health score yet)'}.`,
    );
    facts.push(`${done} of ${tasks.length} tasks done.`);
    if (overdueCount > 0) facts.push(`${overdueCount} task(s) past their planned finish.`);
    if (schedule.totalDurationDays) facts.push(`Planned duration ${schedule.totalDurationDays} days${schedule.startDate ? `, started ${schedule.startDate.slice(0, 10)}` : ''}.`);
    if (schedule.riskItems?.length) facts.push(`${schedule.riskItems.length} flagged schedule risk(s).`);
  }
  return {
    domain: 'SCHEDULE',
    ref: 'SCHEDULE',
    facts,
    drillIn: { pathname: '/schedule-pro', params: { projectId: project.id } },
  };
}

// ─── PACE (buildPaceBook + lookupPace over the project's trades) ─────────────

export function buildPaceBlock(project: Project, book: PaceBook): FactBlock | null {
  if (book.entries.length === 0) return null;
  const tasks = project.schedule?.tasks ?? [];
  const trades = [...new Set(tasks.map(t => tradeKeyForTask(t)).filter(t => t !== 'general'))];
  const facts: string[] = [];
  for (const trade of trades.slice(0, 6)) {
    const entry = lookupPace(book, trade, project.squareFootage);
    if (!entry || entry.confidence === 'low') continue;
    facts.push(
      `${trade[0].toUpperCase()}${trade.slice(1)}: you actually average ${entry.actualMean.toFixed(1)}d vs ${entry.plannedMean.toFixed(1)}d planned (${entry.jobCount} jobs, ${entry.confidence} confidence).`,
    );
  }
  if (facts.length === 0) return null;
  facts.push(`Pace book covers ${book.tradesTracked} trade(s) from ${book.jobsAnalyzed} finished job(s).`);
  return {
    domain: 'YOUR PACE',
    ref: 'PACE',
    facts,
    drillIn: { pathname: '/schedule-review', params: { projectId: project.id } },
  };
}

// ─── RFI (computeRFILatency fact line) ───────────────────────────────────────

export function buildRfiBlock(projectId: string, projectRfis: RFI[]): FactBlock | null {
  if (projectRfis.length === 0) return null;
  const latency = computeRFILatency(projectRfis);
  const open = projectRfis.filter(r => r.status === 'open').length;
  const facts: string[] = [
    `${projectRfis.length} RFI(s) on this project, ${open} open.`,
  ];
  if (latency.factLine) facts.push(latency.factLine + '.');
  else if (latency.overdueCount > 0) facts.push(`${latency.overdueCount} RFI(s) past their needed-by date.`);
  return {
    domain: 'RFI LATENCY',
    ref: 'RFI',
    facts,
    drillIn: { pathname: '/rfi', params: { projectId } },
  };
}

// ─── MEMORY (retrieveRelevant over extractMemoryDocs) ────────────────────────

export interface MemoryFactDoc {
  ref: string;
  date?: string;
  text: string;
}

export function buildMemoryBlock(projectId: string, docs: MemoryFactDoc[]): FactBlock | null {
  if (docs.length === 0) return null;
  return {
    domain: 'PROJECT MEMORY',
    ref: 'MEMORY',
    facts: docs.map(d => `[${d.ref}${d.date ? ` · ${d.date.slice(0, 10)}` : ''}] ${d.text}`),
    drillIn: { pathname: '/project-memory', params: { projectId } },
  };
}

// ─── CASH (cashFlowEngine forecast summary) ──────────────────────────────────

export function buildCashBlock(
  summary: CashFlowSummary | null,
  setupComplete: boolean,
  weeks: number,
): FactBlock {
  const facts: string[] = [];
  if (!setupComplete || !summary) {
    facts.push('Cash flow forecast is not set up yet — open Cash Flow and add your bank balance and recurring expenses to enable it.');
  } else {
    facts.push(`${weeks}-week forecast: ${fmtMoney(summary.totalIncome)} in, ${fmtMoney(summary.totalExpenses)} out, net ${fmtMoney(summary.netProfit)}.`);
    facts.push(`Lowest projected balance ${fmtMoney(summary.lowestBalance)} in week ${summary.lowestBalanceWeek}.`);
    if (summary.dangerWeeks.length > 0) {
      facts.push(
        `${summary.dangerWeeks.length} danger week(s) with negative balance: ` +
        summary.dangerWeeks.slice(0, 3).map(w => `week of ${w.weekDate} (${fmtMoney(w.balance)})`).join(', ') + '.',
      );
    } else {
      facts.push('No negative-balance weeks in the horizon.');
    }
  }
  return {
    domain: 'CASH FLOW',
    ref: 'CASH',
    facts,
    drillIn: { pathname: '/cash-flow' },
  };
}

// ─── WATCH (brainWatch attention items) ──────────────────────────────────────

export function buildBrainWatchBlock(items: AttentionItem[]): FactBlock | null {
  if (items.length === 0) return null;
  const top = rankAttention(items).slice(0, 6);
  return {
    domain: 'NEEDS ATTENTION',
    ref: 'WATCH',
    facts: top.map(i => `[${i.severity}] ${i.message}`),
    drillIn: top[0].route,
  };
}

/** Pure aggregation of the brainWatch builders over the bundle —
 *  BrainWatchCard's exact assembly, optionally narrowed to one project. */
export function collectAttentionItems(
  bundle: OneMindBundle,
  projectId?: string,
  now: Date = new Date(),
): AttentionItem[] {
  const nowMs = now.getTime();
  const all: AttentionItem[] = [];
  for (const project of bundle.projects) {
    if (project.status === 'closed' || project.status === 'completed') continue;
    if (projectId && project.id !== projectId) continue;
    all.push(...scheduleAttention(project));
    all.push(...invoiceAttention(project, bundle.invoices, nowMs));
    all.push(...permitAttention(project, bundle.permits.filter(p => p.projectId === project.id), nowMs));
    all.push(...closeoutAttention(project));
  }
  // Cert signals are company-scoped — business scope only.
  if (!projectId) {
    all.push(...certAttention(bundle.expiringCertifications, nowMs));
  }
  return all;
}

// ─── ACCURACY (buildAccuracyReport — the trust layer) ────────────────────────

export function buildAccuracyBlock(report: AccuracyReport): FactBlock | null {
  if (!report.hasEnoughData) return null;
  return {
    domain: 'BRAIN ACCURACY',
    ref: 'ACCURACY',
    facts: report.rows.slice(0, 4).map(r => r.headline + '.'),
    drillIn: { pathname: '/cost-database' },
  };
}

// ─── LEAKS (open leak_flag predictions) ──────────────────────────────────────

export function buildLeaksBlock(openCount: number, estTotal: number): FactBlock | null {
  if (openCount <= 0) return null;
  const facts = [
    `${openCount} flagged profit-leak scan(s) have not turned into change orders yet` +
    (estTotal > 0 ? ` (~${fmtMoney(estTotal)} of flagged extra work at risk of being eaten).` : '.'),
  ];
  return {
    domain: 'OPEN LEAK FLAGS',
    ref: 'LEAKS',
    facts,
    // Same destination the Morning Brief routes this exact data to
    // (composeBrief.ts buildLeakItem) — /profit-leak-history never existed.
    drillIn: { pathname: '/report-inbox' },
  };
}

// ─── PORTFOLIO (Wave 3 engines via factLines) ────────────────────────────────

export function buildPortfolioBlocks(portfolio: PortfolioFactBlock[]): FactBlock[] {
  return portfolio.map(b => ({
    domain: b.domain,
    ref: b.ref,
    facts: b.facts,
    drillIn: { pathname: '/business' },
  }));
}

// ─── The orchestrator ────────────────────────────────────────────────────────

type BlockSource = () => FactBlock | FactBlock[] | null | Promise<FactBlock | FactBlock[] | null>;

async function runAdditive(sources: BlockSource[]): Promise<FactBlock[]> {
  const out: FactBlock[] = [];
  for (const source of sources) {
    try {
      const res = await source();
      if (!res) continue;
      const blocks = Array.isArray(res) ? res : [res];
      for (const b of blocks) {
        if (b.facts.length > 0 && !out.some(existing => existing.ref === b.ref)) out.push(b);
      }
    } catch {
      // Additive: a failing engine degrades to exactly "no block" —
      // the answer can never get worse than the blocks that DID assemble.
    }
  }
  return out;
}

/**
 * Assemble every fact block for the resolved scope. Async because the cash
 * inputs, project memory, records serializer and prediction ledger live
 * behind storage/network — each is lazy-imported in its own try/catch so
 * this NEVER throws and never blocks on a single failing source.
 *
 * Block order = fallback priority (answer.ts quotes the first blocks
 * verbatim when the model is unreachable).
 */
export async function assembleFactBlocks(
  scope: OneMindScope,
  question: string,
  bundle: OneMindBundle,
): Promise<FactBlock[]> {
  const now = new Date();

  if (scope.scope === 'project') {
    const project = bundle.projects.find(p => p.id === scope.projectId);
    if (!project) return assembleFactBlocks({ scope: 'business' }, question, bundle);
    const projectCOs = bundle.changeOrders.filter(c => c.projectId === project.id);
    const projectInvoices = bundle.invoices.filter(i => i.projectId === project.id);
    const projectRfis = bundle.rfis.filter(r => r.projectId === project.id);

    return runAdditive([
      // MARGIN — livingEstimate, with the explicit no-basis honesty line.
      () => buildMarginBlock(project.id, project.name, computeLivingEstimate({
        project, changeOrders: projectCOs, commitments: bundle.commitments, invoices: projectInvoices,
      })),
      // RISK
      () => buildRiskBlock(project.id, computeMarginRisk({
        project, changeOrders: projectCOs, commitments: bundle.commitments, invoices: projectInvoices,
      })),
      // SCHEDULE
      () => buildScheduleBlock(project, now),
      // WATCH — this project's attention items only.
      () => buildBrainWatchBlock(collectAttentionItems(bundle, project.id, now)),
      // PACE — the whole portfolio's pace book, read for this project's trades.
      () => buildPaceBlock(project, buildPaceBook(bundle.projects)),
      // RFI
      () => buildRfiBlock(project.id, projectRfis),
      // MEMORY — records × retrieval fusion (impure module, lazy).
      async () => {
        const { extractMemoryDocs, retrieveRelevant } = await import('@/utils/projectMemory');
        const docs = extractMemoryDocs({
          rfis: projectRfis,
          dailyReports: bundle.dailyReports.filter(d => d.projectId === project.id),
          changeOrders: projectCOs,
          submittals: bundle.submittals.filter(s => s.projectId === project.id),
          punchItems: bundle.punchItems.filter(p => p.projectId === project.id),
        });
        const top = retrieveRelevant(question, docs, 5);
        return buildMemoryBlock(project.id, top);
      },
      // RECORDS — project-filtered business context: the answers-can-never-
      // get-worse floor (invoice/CO detail lines the engines don't carry).
      async () => {
        const { buildBusinessContext } = await import('@/utils/mageAgent');
        return buildRecordsBlock(buildBusinessContext({
          projects: [project],
          invoices: projectInvoices,
          leads: [],
          changeOrders: projectCOs,
          rfis: projectRfis,
        }, now));
      },
    ]);
  }

  // ── Business scope ─────────────────────────────────────────────────────
  return runAdditive([
    // WATCH — ranked attention across every active job + certs.
    () => buildBrainWatchBlock(collectAttentionItems(bundle, undefined, now)),
    // CASH — AsyncStorage inputs + pure forecast engine (lazy).
    async () => {
      const [{ loadCashFlowData, isSetupComplete }, engine] = await Promise.all([
        import('@/utils/cashFlowStorage'),
        import('@/utils/cashFlowEngine'),
      ]);
      const setupDone = await isSetupComplete();
      if (!setupDone) return buildCashBlock(null, false, 12);
      const data = await loadCashFlowData();
      const balance = engine.getEffectiveStartingBalance(data.startingBalance, data.balanceAsOf, bundle.invoices);
      const forecast = engine.generateForecast(
        balance, data.expenses, bundle.invoices, data.expectedPayments,
        12, data.defaultPaymentTerms, bundle.changeOrders,
      );
      return buildCashBlock(engine.calculateSummary(forecast), true, 12);
    },
    // RECORDS — buildBusinessContext wrapped whole (the regression floor).
    async () => {
      const { buildBusinessContext } = await import('@/utils/mageAgent');
      return buildRecordsBlock(buildBusinessContext({
        projects: bundle.projects,
        invoices: bundle.invoices,
        leads: bundle.leads,
        changeOrders: bundle.changeOrders,
        rfis: bundle.rfis,
      }, now));
    },
    // PORTFOLIO — the four Wave-3 engines, each individually additive.
    () => {
      const blocks: PortfolioFactBlock[] = [];
      try {
        blocks.push(typeProfitabilityFacts(buildTypeProfitability(bundle.projects, bundle.commitments)));
      } catch { /* additive */ }
      try {
        blocks.push(pipelineHorizonFacts(buildPipelineHorizon({
          leads: bundle.leads, projects: bundle.projects, invoices: bundle.invoices,
          changeOrders: bundle.changeOrders, commitments: bundle.commitments,
          bidResponses: bundle.bidResponses, now,
        })));
      } catch { /* additive */ }
      try {
        blocks.push(clientBookFacts(buildClientBook({
          projects: bundle.projects, invoices: bundle.invoices, changeOrders: bundle.changeOrders,
        })));
      } catch { /* additive */ }
      try {
        blocks.push(seasonalityFacts(buildWeatherSeasonality(bundle.dailyReports)));
      } catch { /* additive */ }
      return buildPortfolioBlocks(blocks);
    },
    // ACCURACY — the trust layer (resolved ledger rows, lazy).
    async () => {
      const [{ fetchResolvedPredictions }, { buildAccuracyReport }] = await Promise.all([
        import('@/utils/brain/predictionLedger'),
        import('@/utils/brain/accuracyReport'),
      ]);
      const resolved = await fetchResolvedPredictions();
      return buildAccuracyBlock(buildAccuracyReport(resolved));
    },
    // LEAKS — open leak flags (additive, skipped on fetch failure).
    async () => {
      const { fetchOpenPredictionsDeduped } = await import('@/utils/brain/predictionLedger');
      const rows = await fetchOpenPredictionsDeduped(['leak_flag']);
      let estTotal = 0;
      for (const row of rows) {
        const items = (row.payload as { items?: { estPrice?: number | null }[] }).items ?? [];
        for (const item of items) estTotal += item.estPrice ?? 0;
      }
      return buildLeaksBlock(rows.length, estTotal);
    },
  ]);
}
