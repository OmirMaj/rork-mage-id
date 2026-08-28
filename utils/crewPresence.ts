// crewPresence.ts — who was actually on site, from the daily reports.
//
// THE GAP. Every daily field report carries ManpowerEntry
// { trade, company, headcount, hoursWorked }. Until now it was only ever
// SUMMED for display — crew size on the client update, man-hours on the portal
// snapshot, a completeness score. Nothing derived anything from it and nothing
// learned.
//
// That matters most on a fit-out, which is 70-80% subcontracted.
// utils/laborSamples already bridges the GC's OWN clocked crew (TimeEntry) into
// the cost book, but a sub's crew never clocks into your app. The daily report
// is the ONLY record that Acme Drywall had four people on site Tuesday — and
// it was being used to make a PDF.
//
// ── WHAT THIS REFUSES TO DO ────────────────────────────────────────────────
// It does not infer productivity. ManpowerEntry has no quantity installed, so
// units-per-hour cannot be computed from it without inventing an attribution
// (which task did those four people work on?) that the data does not support.
// A confident wrong rate is worse than no rate — see the pace book's
// endogeneity problem. This module reports PRESENCE, which is exactly what the
// data actually witnesses.
//
// ── THE ABSENCE RULE, AND WHY IT IS COUNTED THIS WAY ───────────────────────
// "Days since last seen" is counted in REPORTED days — days that actually have
// a report — never calendar days. A GC who skips a week of reports has not
// witnessed anyone's absence; they have witnessed nothing. Counting calendar
// days would turn the GC's own paperwork gap into an accusation against their
// subs, and the alarm would grow louder the less data it had. This way, if
// reporting stops, every trade's counter simply freezes.
//
// Pure — no storage, no network. Pinned by test:crew-presence.

import type { DailyFieldReport } from '@/types';
import { normalizeTradeKey } from '@/utils/laborSamples';

/** A trade must appear on this many reported days before "went quiet" can mean
 *  anything. One appearance is as likely to be a delivery, a measure-up or a
 *  walk-through as it is a crew starting work. */
export const MIN_REPORTED_DAYS_TO_ESTABLISH = 2;

/** Reported days of absence, after being established, before a trade is
 *  flagged as having gone quiet. */
export const WENT_QUIET_AFTER_REPORTED_DAYS = 3;

export interface TradePresence {
  /** Normalized via laborSamples.normalizeTradeKey so this speaks the same
   *  trade vocabulary as the labor→cost-book bridge. */
  tradeKey: string;
  /** Every company seen working this trade, in first-seen order. */
  companies: string[];
  /** Distinct reported days this trade had anyone on site. */
  reportedDaysPresent: number;
  /** Σ headcount × hoursWorked. Man-hours, not crew-days. */
  manHours: number;
  peakHeadcount: number;
  /** YYYY-MM-DD. */
  firstSeen: string;
  lastSeen: string;
  /** Reported days that have elapsed since lastSeen — i.e. the number of
   *  report dates strictly after it. Zero when this trade was on the most
   *  recent report. */
  reportedDaysSince: number;
}

export interface CrewPresenceSummary {
  trades: TradePresence[];
  /** Distinct dates that produced a report. The denominator for everything. */
  reportedDays: number;
  totalManHours: number;
  /** The latest report date, or '' when there are none. Every absence figure
   *  is relative to THIS, never to today — see the header. */
  asOf: string;
}

/** Report dates are stored as ISO timestamps or plain YYYY-MM-DD. Take the
 *  calendar day verbatim: parsing a date-only string through Date lands at UTC
 *  midnight and shifts a day west of Greenwich. */
function reportDay(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (s.length < 10) return null;
  const day = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * Fold daily reports into per-trade presence.
 *
 * `reports` should already be scoped to one project — this does not filter by
 * projectId, so a caller passing a mixed list gets a mixed answer. That is
 * deliberate: the portfolio view is a legitimate second use.
 */
export function buildCrewPresence(reports: DailyFieldReport[]): CrewPresenceSummary {
  // Distinct report dates, ascending. This is the clock everything is measured
  // against; calendar days never enter the calculation.
  const dayList = [...new Set(
    reports.map(r => reportDay(r.date)).filter((d): d is string => d !== null),
  )].sort();

  const byTrade = new Map<string, {
    companies: string[];
    days: Set<string>;
    manHours: number;
    peak: number;
  }>();

  for (const report of reports) {
    const day = reportDay(report.date);
    if (day === null) continue;
    for (const entry of report.manpower ?? []) {
      const headcount = Number(entry?.headcount) || 0;
      // Zero heads is not presence. A row logged with nobody on it is a
      // paperwork artifact, and counting it would let an empty row reset a
      // trade's absence clock.
      if (headcount <= 0) continue;

      const tradeKey = normalizeTradeKey(entry.trade);
      let acc = byTrade.get(tradeKey);
      if (!acc) {
        acc = { companies: [], days: new Set(), manHours: 0, peak: 0 };
        byTrade.set(tradeKey, acc);
      }
      const company = (entry.company ?? '').trim();
      if (company && !acc.companies.includes(company)) acc.companies.push(company);
      acc.days.add(day);
      acc.manHours += headcount * (Number(entry.hoursWorked) || 0);
      if (headcount > acc.peak) acc.peak = headcount;
    }
  }

  const trades: TradePresence[] = [];
  for (const [tradeKey, acc] of byTrade) {
    const seen = [...acc.days].sort();
    const lastSeen = seen[seen.length - 1];
    trades.push({
      tradeKey,
      companies: acc.companies,
      reportedDaysPresent: seen.length,
      manHours: Math.round(acc.manHours * 10) / 10,
      peakHeadcount: acc.peak,
      firstSeen: seen[0],
      lastSeen,
      // Report dates strictly after this trade's last appearance. If reporting
      // stopped, this is 0 for everyone and nothing can be flagged.
      reportedDaysSince: dayList.filter(d => d > lastSeen).length,
    });
  }

  // Most recently on site first — the live crews lead.
  trades.sort((a, b) => (b.lastSeen > a.lastSeen ? 1 : b.lastSeen < a.lastSeen ? -1 : 0));

  return {
    trades,
    reportedDays: dayList.length,
    totalManHours: Math.round(trades.reduce((s, t) => s + t.manHours, 0) * 10) / 10,
    asOf: dayList.length ? dayList[dayList.length - 1] : '',
  };
}

export interface QuietTrade {
  tradeKey: string;
  companies: string[];
  lastSeen: string;
  reportedDaysSince: number;
  /** One line for a chase row or a brief item. */
  message: string;
}

/**
 * Trades that were working and stopped.
 *
 * No schedule join and no promised crew size is required, which is the point:
 * a sub who was on site for several days and then vanished is worth a question
 * regardless of what any plan says. Cross-referencing the schedule would make
 * this smarter and also make it wrong whenever the schedule is stale, which on
 * a live job is most of the time.
 */
export function findQuietTrades(
  summary: CrewPresenceSummary,
  opts: { minDaysToEstablish?: number; quietAfter?: number } = {},
): QuietTrade[] {
  const establish = opts.minDaysToEstablish ?? MIN_REPORTED_DAYS_TO_ESTABLISH;
  const quietAfter = opts.quietAfter ?? WENT_QUIET_AFTER_REPORTED_DAYS;

  return summary.trades
    .filter(t => t.reportedDaysPresent >= establish && t.reportedDaysSince >= quietAfter)
    .map(t => {
      const who = t.companies.length === 1 ? t.companies[0] : t.tradeKey;
      const d = t.reportedDaysSince;
      return {
        tradeKey: t.tradeKey,
        companies: t.companies,
        lastSeen: t.lastSeen,
        reportedDaysSince: d,
        message: `${who} last on site ${t.lastSeen} — ${d} reported ${d === 1 ? 'day' : 'days'} ago`,
      };
    })
    .sort((a, b) => b.reportedDaysSince - a.reportedDaysSince);
}

/** One line for a dashboard tile. Null when there is nothing worth saying. */
export function summarizeCrewPresence(summary: CrewPresenceSummary): string | null {
  if (summary.reportedDays === 0) return null;
  const active = summary.trades.filter(t => t.reportedDaysSince === 0).length;
  if (active === 0) return null;
  return `${active} ${active === 1 ? 'trade' : 'trades'} on site · ` +
    `${Math.round(summary.totalManHours).toLocaleString()} man-hours logged`;
}
