// utils/portfolio/factLines.ts — portfolio → prompt-ready fact lines
//
// Converts portfolio engine outputs into the FactBlock[] format consumed
// by One Mind (Wave 5) and future Brief extensions.
// Dependency direction: oneMind imports portfolio; never reverse.
//
// HYBRID VOICE rule (plan spec): dense stat lines are third-person;
// "I" only for judgment lines.
//
// Pure. No React. No network. Never throws.

import type { TypeProfitabilityResult } from './typeProfitability';
import type { PipelineHorizonResult } from './pipelineHorizon';
import type { ClientBookResult } from './clientBook';
import type { SeasonalityResult } from './seasonality';

export interface PortfolioFactBlock {
  domain: string;
  ref: string;
  facts: string[];
}

function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function fmtMoney(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

function fmtLoadPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

// ─── Job-type profitability facts ─────────────────────────────────────────

export function typeProfitabilityFacts(result: TypeProfitabilityResult): PortfolioFactBlock {
  const facts: string[] = [];
  const visibleRows = result.rows.filter(r => !r.gated && r.avgMarginPct !== null);
  if (visibleRows.length === 0) {
    facts.push(
      'No job types have enough closed projects (2+) to report realized margin yet.',
    );
  } else {
    // Sort by revenue-weighted margin descending
    const sorted = [...visibleRows].sort(
      (a, b) => (b.revenueWeightedMarginPct ?? 0) - (a.revenueWeightedMarginPct ?? 0),
    );
    for (const r of sorted) {
      const rwm = r.revenueWeightedMarginPct ?? r.avgMarginPct!;
      facts.push(
        `${r.label}: ${r.jobCount} closed job${r.jobCount === 1 ? '' : 's'}, ${fmtPct(rwm)} revenue-weighted margin (${fmtMoney(r.totalRevenue)} total revenue).`,
      );
    }
    const gatedTypes = result.rows.filter(r => r.gated && r.jobCount === 1);
    if (gatedTypes.length > 0) {
      facts.push(
        `${gatedTypes.length} other type${gatedTypes.length === 1 ? '' : 's'} have only 1 closed job — not enough for a reliable margin reading.`,
      );
    }
  }
  facts.push(result.definitionNote);
  return { domain: 'JOB TYPE PROFITABILITY', ref: 'TYPEPROFIT', facts };
}

// ─── Pipeline horizon facts ────────────────────────────────────────────────

export function pipelineHorizonFacts(result: PipelineHorizonResult): PortfolioFactBlock {
  const facts: string[] = [];

  // CRM pipeline
  if (result.leadCount > 0) {
    facts.push(
      `CRM pipeline: ${result.leadCount} lead${result.leadCount === 1 ? '' : 's'} in new/qualified/proposal stages totaling ${fmtMoney(result.leadPipeline$)} in estimated scope.`,
    );
  } else {
    facts.push('No active CRM leads in pipeline stages.');
  }

  // Win rates
  if (result.winRates.crm !== null) {
    facts.push(`CRM win rate: ${fmtPct(result.winRates.crm)} (from decided leads).`);
  } else {
    facts.push('CRM win rate: not enough decided leads yet (need ≥3).');
  }
  if (result.winRates.outbound !== null) {
    facts.push(
      `Outbound bid win rate: ${fmtPct(result.winRates.outbound)} (marketplace bids won/lost).`,
    );
  } else if (result.pendingBidsCount > 0) {
    facts.push(
      `${result.pendingBidsCount} pending marketplace bid${result.pendingBidsCount === 1 ? '' : 's'} (${fmtMoney(result.pendingBids$)}); outbound win rate needs ≥3 decided bids.`,
    );
  }

  // Expected inflow
  if (result.expectedInflow$ > 0) {
    facts.push(`Expected inflow (pipeline × win rate): ${fmtMoney(result.expectedInflow$)}.`);
  }

  // Backlog
  if (result.backlog.remainingToBill$ > 0) {
    facts.push(
      `Active project backlog: ${fmtMoney(result.backlog.remainingToBill$)} remaining to bill.`,
    );
  }
  if (result.backlog.horizonDate) {
    facts.push(`Latest scheduled project end: ${result.backlog.horizonDate}.`);
  }

  // Load windows
  for (const w of result.loadWindows) {
    const descriptor = w.bookedSolid ? 'fully booked' : `${fmtLoadPct(w.loadPct)} booked`;
    facts.push(`Crew load ${w.label}: ${descriptor} (${w.overlappingProjects} active project${w.overlappingProjects === 1 ? '' : 's'} in window).`);
  }
  facts.push(result.loadCaveat);

  return { domain: 'PIPELINE & CAPACITY', ref: 'PIPELINE', facts };
}

// ─── Client book facts ─────────────────────────────────────────────────────

export function clientBookFacts(result: ClientBookResult): PortfolioFactBlock {
  const facts: string[] = [];
  facts.push(result.coverageNote + '.');

  if (result.clients.length === 0) {
    facts.push('No clients with identifiable contact info yet.');
    return { domain: 'CLIENT BOOK', ref: 'CLIENTS', facts };
  }

  const repeatClients = result.clients.filter(c => c.repeat);
  if (repeatClients.length > 0) {
    facts.push(
      `${repeatClients.length} repeat client${repeatClients.length === 1 ? '' : 's'} (2+ projects).`,
    );
  }

  // Top 3 by revenue
  const top3 = result.clients.slice(0, 3);
  for (const c of top3) {
    const lines: string[] = [`${c.displayName}: ${c.projectCount} project${c.projectCount === 1 ? '' : 's'}, ${fmtMoney(c.lifetimeRevenue)} lifetime revenue`];
    if (c.payment.medianDaysToPaid !== null) {
      lines.push(`pays in median ${Math.round(c.payment.medianDaysToPaid)} days`);
    }
    if (c.payment.overdue$ > 0) {
      lines.push(`${fmtMoney(c.payment.overdue$)} overdue`);
    }
    if (c.coFriction.count > 0) {
      lines.push(`${c.coFriction.count} COs (${fmtPct(c.coFriction.rejectionRate)} rejection rate)`);
    }
    facts.push(lines.join('; ') + '.');
  }

  if (result.clients.length > 3) {
    facts.push(`${result.clients.length - 3} other client${result.clients.length - 3 === 1 ? '' : 's'} in the book.`);
  }

  return { domain: 'CLIENT BOOK', ref: 'CLIENTS', facts };
}

// ─── Seasonality facts ─────────────────────────────────────────────────────

export function seasonalityFacts(result: SeasonalityResult): PortfolioFactBlock {
  const facts: string[] = [];
  if (result.noData) {
    facts.push('No weather-lost days recorded in daily field reports yet.');
  } else {
    const topMonths = [...result.months]
      .sort((a, b) => b.avgLostDays - a.avgLostDays)
      .slice(0, 3);
    for (const m of topMonths) {
      facts.push(
        `${m.label}: avg ${m.avgLostDays.toFixed(1)} weather-lost day${m.avgLostDays === 1 ? '' : 's'} per year (from ${result.reportCount} reports).`,
      );
    }
  }
  return { domain: 'SEASONALITY', ref: 'SEASON', facts };
}

// ─── Composite builder ─────────────────────────────────────────────────────

export interface PortfolioEngineOutputs {
  typeProfitability: TypeProfitabilityResult;
  pipelineHorizon: PipelineHorizonResult;
  clientBook: ClientBookResult;
  seasonality: SeasonalityResult;
}

/**
 * Convert all four portfolio engine outputs into prompt-ready PortfolioFactBlock[].
 * Matches the factLines.ts precedent from utils/rfiLatency.ts.
 */
export function buildPortfolioFactLines(outputs: PortfolioEngineOutputs): PortfolioFactBlock[] {
  return [
    typeProfitabilityFacts(outputs.typeProfitability),
    pipelineHorizonFacts(outputs.pipelineHorizon),
    clientBookFacts(outputs.clientBook),
    seasonalityFacts(outputs.seasonality),
  ];
}
