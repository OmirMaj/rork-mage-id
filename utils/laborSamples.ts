// laborSamples.ts — self-perform labor into the cost book.
//
// Crew time tracking captures the largest actual-cost stream a self-perform
// GC has: real clocked hours, per worker, per project, per trade — and until
// this bridge existed, every learning engine discarded them. This module
// converts finished shifts into Cost Database samples so the GC's OWN labor
// shows up in estimate grounding, instant bids, judges, and the price book.
//
// Honesty note (verified against the data model, 2026-07): TimeEntry carries
// NO pay rate — not on the entry, not on CrewMember, not in the Supabase
// schema. The payroll CSV has no rate column either. So the dollars here are
// hours (measured, real) × the GC's configured loaded rate per trade
// (hooks/useLaborRates.ts — entered once by the GC, their real payroll
// number, wages + burden). No rate configured for a trade ⇒ NO samples for
// that trade. We never substitute market-average rates and call them "your
// learned rate" — that would poison the book's core promise.
//
// Trade attribution (verified): TimeEntry has a direct `trade` field (set
// from the crew member's first trade at clock-in) — no task linkage exists,
// so no tradeKeyForTask inference is needed. Placeholder trades ('', 'Crew')
// fall back to the 'general' bucket, labeled "Labor — general".
//
// Pure functions — no storage, no network. Mirrors utils/materialReceipt.ts
// receiptToCostSamples (the receipts template this bridge was modeled on).

import type { TimeEntry } from '@/types';
import type { CostSample } from '@/utils/costDatabase';

/** Normalized trade key → loaded $/hour the GC pays for that trade. */
export type LaborRateMap = Record<string, number>;

/** All labor samples share this unit — the book keys on `trade|unit`. */
export const LABOR_UNIT = 'hour';

/** Roster placeholders that mean "no specific trade was set at clock-in". */
const GENERIC_TRADES = new Set(['', 'crew', 'general', 'labor']);

/** Canonical map key for a raw TimeEntry.trade value. */
export function normalizeTradeKey(trade: string | undefined): string {
  const t = (trade ?? '').trim().toLowerCase();
  return GENERIC_TRADES.has(t) ? 'general' : t;
}

/** Price-book display label: "Labor — Framing" / "Labor — general". Prefixed
 *  so a self-perform labor entry never masquerades as a subcontract scope. */
export function laborTradeLabel(trade: string | undefined): string {
  if (normalizeTradeKey(trade) === 'general') return 'Labor — general';
  return `Labor — ${(trade ?? '').trim()}`;
}

/** An entry is labor evidence only when the shift is FINISHED (live shifts
 *  have provisional hours), has positive hours, and is attributed to a real
 *  project ('unassigned' clock-ins carry no job context — the configured
 *  rate is the only dollar content, so they'd teach the book nothing). */
export function isEligibleLaborEntry(e: TimeEntry): boolean {
  return (
    e.status === 'clocked_out' &&
    Number.isFinite(e.totalHours) &&
    e.totalHours > 0 &&
    !!e.projectId &&
    e.projectId !== 'unassigned'
  );
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Convert time entries into Cost Database samples: one sample per
 * (project, trade), quantity = summed hours, actualUnit = the GC's loaded
 * rate. bidUnit is 0 (clocked hours carry no bid context — same as
 * receipts), so labor never distorts bid-bias math. Entries whose trade has
 * no configured rate are skipped entirely.
 */
export function buildLaborSamples(entries: TimeEntry[], rates: LaborRateMap): CostSample[] {
  interface Group {
    projectId: string;
    projectName: string;
    label: string;
    rate: number;
    hours: number;
    lastDate: string;
  }
  const groups = new Map<string, Group>();

  for (const e of entries ?? []) {
    if (!isEligibleLaborEntry(e)) continue;
    const tradeKey = normalizeTradeKey(e.trade);
    const rate = rates?.[tradeKey];
    if (!Number.isFinite(rate) || (rate as number) <= 0) continue;

    const key = `${e.projectId}|${tradeKey}`;
    const g = groups.get(key);
    if (g) {
      g.hours += e.totalHours;
      if (e.date > g.lastDate) g.lastDate = e.date;
    } else {
      groups.set(key, {
        projectId: e.projectId,
        projectName: e.projectName || 'Project',
        label: laborTradeLabel(e.trade),
        rate: rate as number,
        hours: e.totalHours,
        lastDate: e.date || '',
      });
    }
  }

  const out: CostSample[] = [];
  for (const g of groups.values()) {
    out.push({
      projectId: g.projectId,
      projectName: g.projectName,
      trade: g.label,
      unit: LABOR_UNIT,
      quantity: round2(g.hours),
      bidUnit: 0,
      actualUnit: g.rate,
      basis: 'actual',
      closedAt: g.lastDate,
    });
  }
  return out;
}

export interface LaborSampleStats {
  /** Finished shifts with hours on a real project — the raw feedstock. */
  eligibleEntries: number;
  /** Of those, entries whose trade has a configured rate (became samples). */
  sampledEntries: number;
  /** Total hours across sampled entries. */
  sampledHours: number;
  /** Normalized trade keys present in eligible entries but missing a rate —
   *  the honest "set a rate to unlock these" list. */
  tradesMissingRates: string[];
}

/** Stats for the time-tracking honesty surface ("Feeding your labor rates:
 *  N entries → your cost book" / "set rates to unlock N shifts"). */
export function computeLaborStats(entries: TimeEntry[], rates: LaborRateMap): LaborSampleStats {
  let eligibleEntries = 0;
  let sampledEntries = 0;
  let sampledHours = 0;
  const missing = new Set<string>();
  for (const e of entries ?? []) {
    if (!isEligibleLaborEntry(e)) continue;
    eligibleEntries++;
    const tradeKey = normalizeTradeKey(e.trade);
    const rate = rates?.[tradeKey];
    if (Number.isFinite(rate) && (rate as number) > 0) {
      sampledEntries++;
      sampledHours += e.totalHours;
    } else {
      missing.add(tradeKey);
    }
  }
  return {
    eligibleEntries,
    sampledEntries,
    sampledHours: round2(sampledHours),
    tradesMissingRates: [...missing].sort(),
  };
}
