// utils/priceDriftGate.ts — the stale-price check at the two moments that
// matter: SENDING a proposal and SIGNING a contract (roadmap T2).
//
// utils/receiptPriceWatch.estimateDrift already knows when his newest reviewed
// receipt contradicts a price on an estimate; until now only the receipts
// screen (components/priceWatch/PriceWatchCard) asked it. This asks it for ONE
// project, right before that project's numbers leave the building:
//   • the project is checked whatever its status (estimateDrift's
//     includeProjectIds) — at signing it may already be past 'estimated';
//   • lines he chose to Keep (PRICE_WATCH_KEPT_KEY, the same device memory the
//     receipt card writes) stay hidden;
//   • the totals are repriceEstimate's own, to the cent, so what the check
//     says Reprice will do is exactly what Reprice does.
//
// UNREAD IS NOT CLEAR: when the projects, the receipts or the Keep memory have
// not been read yet (null), the answer is null — never an empty "no drift".
//
// Pure — no React, no storage, no network, no clock.
import type { LinkedEstimate, MaterialReceipt, Project } from '@/types';
import { normalizeUnit } from '@/utils/takeoffPricing';
import {
  estimateDrift,
  keptKeyFor,
  repriceEstimate,
  type DriftFinding,
} from '@/utils/receiptPriceWatch';

/** One drifted line, with the sentence the check prints for it. */
export interface DriftLine {
  finding: DriftFinding;
  text: string;
}

export interface DriftAtSend {
  projectId: string;
  /** Visible lines (Kept ones removed), in estimate order. Empty = checked, nothing moved. */
  lines: DriftLine[];
  /** Cost delta across the visible lines, pre-markup, integer cents. */
  costDeltaCents: number;
  /** Sell (grand total) delta Reprice would apply, integer cents. */
  sellDeltaCents: number;
  grandBeforeCents: number;
  grandAfterCents: number;
  /** "2 prices on this estimate are older than your latest receipts. +$486.00 cost at today's prices."
   *  Empty string when there are no lines. */
  summary: string;
  /** The estimate Reprice writes (the same object repriceEstimate returns);
   *  null when the project has no estimate. */
  next: LinkedEstimate | null;
}

export interface DriftAtSendOptions {
  /** Smallest move reported, in percent (estimateDrift's default is 5). */
  minPct?: number;
}

const toCents = (dollars: number) => Math.round(dollars * 100);

/** Money to the cent: 31200 → "$312.00", 123456 → "$1,234.56". */
function money(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  return `$${whole}.${String(abs % 100).padStart(2, '0')}`;
}
/** "+$312.00" / "-$80.00" (zero is "+$0.00"). */
function signedMoney(cents: number): string {
  return `${cents < 0 ? '-' : '+'}${money(cents)}`;
}

// Readable unit words for the price: "$4.10/ft", "$1.85/sq ft". Anything not
// listed prints as he typed it ("sheet", "box"); a blank unit is "unit".
const UNIT_WORDS: Record<string, string> = {
  lf: 'ft', ft: 'ft', sf: 'sq ft', sy: 'sq yd', cy: 'cu yd', cf: 'cu ft', bf: 'bd ft',
  ea: 'ea', sq: 'square', gal: 'gal', ton: 'ton', hr: 'hr', day: 'day', wk: 'wk', mo: 'mo',
};
export function unitWord(unit: string | null | undefined): string {
  const raw = String(unit ?? '').trim();
  if (!raw) return 'unit';
  const key = normalizeUnit(raw);
  return UNIT_WORDS[key] ?? raw.toLowerCase();
}

/** 'YYYY-MM-DD' → "9/20" (no leading zeros). The raw value when it is not that shape. */
export function monthDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? '');
  return m ? `${Number(m[2])}/${Number(m[3])}` : String(day ?? '');
}

/** Signed percent, one decimal: 12.7 → "+12.7%", -8 → "-8.0%". */
function signedPct(pct: number): string {
  const v = Math.round(pct * 10) / 10;
  return `${v < 0 ? '-' : '+'}${Math.abs(v).toFixed(1)}%`;
}

/**
 * "Copper pipe: priced $4.10/ft, your 9/20 receipt from Ferguson says $4.62 (+12.7%), +$312.00 cost."
 * The vendor clause only when the receipt names one.
 */
export function driftLineText(d: DriftFinding): string {
  const unit = unitWord(d.unit);
  const vendor = (d.latestVendor ?? '').trim();
  const from = vendor ? ` from ${vendor}` : '';
  return `${d.itemName.trim()}: priced ${money(d.pricedUnitCents)}/${unit}, your ${monthDay(d.latestDate)} receipt${from} says ${money(d.latestUnitCents)} (${signedPct(d.pct)}), ${signedMoney(d.deltaCents)} cost.`;
}

/** "2 prices on this estimate are older than your latest receipts. +$486.00 cost at today's prices." */
export function driftSummaryText(count: number, costDeltaCents: number): string {
  if (count <= 0) return '';
  const head = count === 1
    ? '1 price on this estimate is older than your latest receipt.'
    : `${count} prices on this estimate are older than your latest receipts.`;
  return `${head} ${signedMoney(costDeltaCents)} cost at today's prices.`;
}

/**
 * The drift check for ONE project before it is sent or signed.
 *
 * null when anything is unread (`projects`, `receipts` or `kept` is null) or
 * there is no project. Otherwise a result — `lines` is empty when nothing
 * moved, the project has no estimate, or every moved line was Kept.
 * The freshest copy of the project in `projects` wins over the one passed in.
 */
export function driftAtSend(
  project: Project | null | undefined,
  projects: readonly Project[] | null | undefined,
  receipts: readonly MaterialReceipt[] | null | undefined,
  kept: ReadonlySet<string> | readonly string[] | null | undefined,
  opts: DriftAtSendOptions = {},
): DriftAtSend | null {
  if (!project || !projects || !receipts || !kept) return null;
  const p = projects.find(x => x?.id === project.id) ?? project;
  const keptSet: ReadonlySet<string> = kept instanceof Set ? kept : new Set(kept as readonly string[]);
  const est = p.linkedEstimate ?? null;
  const grandBeforeCents = toCents(Number(est?.grandTotal) || 0);

  const findings = est
    ? estimateDrift([p], [...receipts], opts.minPct ?? 5, { includeProjectIds: [p.id] })
      .filter(d => !keptSet.has(keptKeyFor(d)))
    : [];

  if (!est || findings.length === 0) {
    return {
      projectId: p.id, lines: [], costDeltaCents: 0, sellDeltaCents: 0,
      grandBeforeCents, grandAfterCents: grandBeforeCents, summary: '', next: est,
    };
  }

  const { next, costDeltaCents, sellDeltaCents } = repriceEstimate(est, findings);
  return {
    projectId: p.id,
    lines: findings.map(finding => ({ finding, text: driftLineText(finding) })),
    costDeltaCents,
    sellDeltaCents,
    grandBeforeCents,
    grandAfterCents: toCents(Number(next.grandTotal) || 0),
    summary: driftSummaryText(findings.length, costDeltaCents),
    next,
  };
}

/** The Keep memory keys for a check's visible lines (what "Keep these prices" adds). */
export function keptKeysFor(check: Pick<DriftAtSend, 'lines'>): string[] {
  return check.lines.map(l => keptKeyFor(l.finding));
}
