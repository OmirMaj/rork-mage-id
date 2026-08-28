// supplierScorecard.ts — which suppliers actually hit their dates.
//
// THE QUESTION NOBODY ASKS. A GC picks a supplier on price, then eats the
// difference in schedule. Nothing in this app — or in most of the category —
// records that Acme Glass has been late on four of their last six loads, so the
// next bid gets awarded on price again and the same crew stands around again.
//
// Everything here is derived from data the app ALREADY captures:
//   • public.deliveries      — promised date vs delivered date, and whether the
//                              supplier ever confirmed when asked
//   • public.delivery_receipts — has_damage / damage_notes, captured at receiving
// No new input is asked of the user. It backfills across all history the moment
// it ships, which is the whole reason to build this rather than a new form.
//
// ── WHY THIS REFUSES TO SCORE MOST OF THE TIME ─────────────────────────────
// A supplier judged on one delivery is a supplier judged on luck. Every factor
// carries an `applicable` flag and contributes NOTHING to the blend when the
// evidence is thin, and the whole card reports low confidence until there is
// real history. A grade the GC cannot defend in a buyout meeting is worse than
// no grade — they will quote it once, be wrong once, and never trust the app's
// numbers again.
//
// Specifically:
//   • a delivery with no receipt is NOT counted as damage-free. Absence of a
//     receipt is absence of evidence, and scoring it as clean would reward the
//     suppliers whose loads nobody bothered to inspect.
//   • a load still in flight is not counted as on-time OR late. Only settled
//     deliveries score.
//   • no promised date means no reliability signal, however late it feels.
//
// Mirrors utils/subScorecard's shape deliberately: same factor/weight/
// applicability machinery, same confidence ladder, so the two cards read alike.
//
// Pure — no storage, no network. Pinned by test:supplier-scorecard.

import type { Delivery } from '@/utils/deliverySchedule';
import { parseLocalDate } from '@/utils/deliverySchedule';

export type SupplierGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type SupplierConfidence = 'low' | 'medium' | 'high';

export type SupplierFactorKey = 'on_time' | 'confirmation' | 'damage_free';

export interface SupplierFactor {
  key: SupplierFactorKey;
  label: string;
  /** Quality 0–1, higher = better. */
  score: number;
  /** Weight used in this supplier's blend (0 when the factor didn't apply). */
  weight: number;
  /** True when there was real evidence behind the factor. */
  applicable: boolean;
  detail: string;
}

/** Weights. On-time dominates because it is the thing that costs crew hours;
 *  confirmation is communication, which predicts the next slip; damage is real
 *  but rarer and usually recoverable through a claim. */
export const W_ON_TIME = 0.55;
export const W_CONFIRMATION = 0.25;
export const W_DAMAGE_FREE = 0.20;

/** Settled deliveries needed before a factor says anything at all. */
export const MIN_DELIVERIES_TO_SCORE = 3;
/** Receipts needed before damage is scored — one damaged load out of one is
 *  not a 0% damage-free rate, it is a single bad Tuesday. */
export const MIN_RECEIPTS_TO_SCORE = 3;
/** A load this many days late or more scores zero for that delivery rather than
 *  dragging the average into meaninglessness. */
export const BADLY_LATE_DAYS = 7;

/** Just the receipt fields this module needs — callers pass rows straight from
 *  public.delivery_receipts without importing a wider type. */
export interface SupplierReceiptFact {
  supplier: string;
  hasDamage: boolean;
}

export interface SupplierScorecard {
  /** Normalized key used for grouping. */
  supplierKey: string;
  /** The supplier's name as the GC actually typed it (most recent spelling). */
  supplier: string;
  /** 0–100. Null when nothing was applicable — an honest blank, not a zero. */
  score: number | null;
  grade: SupplierGrade | null;
  confidence: SupplierConfidence;
  factors: SupplierFactor[];
  /** factors[0].detail — the one-liner for a list row. */
  topDriver: string;
  deliveryCount: number;
  settledCount: number;
  lateCount: number;
  /** Mean days late across LATE deliveries only. Early/on-time do not offset a
   *  slip: a supplier who is three days early once and three days late once has
   *  cost a crew a day, not broken even. */
  avgSlipDays: number | null;
  receiptCount: number;
  damagedCount: number;
}

function norm(supplier: string): string {
  return supplier.trim().toLowerCase().replace(/\s+/g, ' ');
}

function gradeFor(score: number): SupplierGrade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/** Days late for a settled delivery. Negative = early. Null when either date is
 *  missing — no promise or no arrival means no signal. */
export function slipDays(d: Delivery): number | null {
  if (d.status !== 'delivered' || !d.deliveredAt) return null;
  const promised = parseLocalDate(d.expectedDate);
  const actual = parseLocalDate(d.deliveredAt);
  if (promised === null || actual === null) return null;
  return Math.round((actual - promised) / 86_400_000);
}

export interface SupplierScorecardInput {
  deliveries: Delivery[];
  /** Rows from public.delivery_receipts. Optional — omitted simply means the
   *  damage factor is not applicable for anyone. */
  receipts?: SupplierReceiptFact[];
}

/**
 * One card per supplier, worst score first so the problem leads.
 *
 * Suppliers with no settled deliveries still appear (with a null score) rather
 * than being hidden — "we have bought from them and never measured it" is
 * useful information at a buyout table, and silently dropping them would make
 * the list look like a complete picture when it is not.
 */
export function computeSupplierScorecards(input: SupplierScorecardInput): SupplierScorecard[] {
  const byKey = new Map<string, {
    supplier: string;
    deliveries: Delivery[];
    receipts: SupplierReceiptFact[];
  }>();

  for (const d of input.deliveries) {
    const key = norm(d.supplier);
    if (!key) continue;
    const acc = byKey.get(key) ?? { supplier: d.supplier.trim(), deliveries: [], receipts: [] };
    // Keep the most recent spelling the GC used — suppliers get renamed.
    acc.supplier = d.supplier.trim();
    acc.deliveries.push(d);
    byKey.set(key, acc);
  }
  for (const r of input.receipts ?? []) {
    const key = norm(r.supplier);
    // A receipt from a supplier with no scheduled delivery is real but tells us
    // nothing about reliability, so it does not mint a card of its own.
    const acc = byKey.get(key);
    if (acc) acc.receipts.push(r);
  }

  const cards: SupplierScorecard[] = [];

  for (const [supplierKey, acc] of byKey) {
    const settled = acc.deliveries.filter(d => d.status === 'delivered');
    const slips = settled.map(slipDays).filter((n): n is number => n !== null);
    const late = slips.filter(n => n > 0);
    const damaged = acc.receipts.filter(r => r.hasDamage).length;

    const factors: SupplierFactor[] = [];

    // ── on-time ────────────────────────────────────────────────────────────
    {
      const applicable = slips.length >= MIN_DELIVERIES_TO_SCORE;
      // Per-delivery quality, then averaged: on time or early = 1, and it
      // decays to 0 at BADLY_LATE_DAYS. Averaging the QUALITY rather than the
      // days stops one catastrophic load from making every other delivery look
      // irrelevant, while still costing the supplier that delivery entirely.
      const quality = slips.length
        ? slips.reduce((s, n) => s + (n <= 0 ? 1 : Math.max(0, 1 - n / BADLY_LATE_DAYS)), 0) / slips.length
        : 0;
      factors.push({
        key: 'on_time',
        label: 'On time',
        score: applicable ? quality : 0,
        weight: applicable ? W_ON_TIME : 0,
        applicable,
        detail: applicable
          ? (late.length === 0
              ? `Every one of ${slips.length} deliveries landed on or before its date`
              : `${late.length} of ${slips.length} deliveries late, averaging ${
                  Math.round((late.reduce((s, n) => s + n, 0) / late.length) * 10) / 10} days`)
          : `Only ${slips.length} settled ${slips.length === 1 ? 'delivery' : 'deliveries'} — need ${MIN_DELIVERIES_TO_SCORE} to judge`,
      });
    }

    // ── confirmation ───────────────────────────────────────────────────────
    // Did they ever confirm the date? A supplier who confirms is a supplier you
    // can staff a crew around; one who never answers is a slip you cannot see
    // coming. Only settled loads count, so a load still awaiting a reply is not
    // held against them yet.
    {
      const applicable = settled.length >= MIN_DELIVERIES_TO_SCORE;
      const confirmed = settled.filter(d => d.confirmedAt).length;
      const quality = settled.length ? confirmed / settled.length : 0;
      factors.push({
        key: 'confirmation',
        label: 'Confirms dates',
        score: applicable ? quality : 0,
        weight: applicable ? W_CONFIRMATION : 0,
        applicable,
        detail: applicable
          ? `Confirmed ${confirmed} of ${settled.length} dates before delivering`
          : `Not enough settled deliveries to judge`,
      });
    }

    // ── damage ─────────────────────────────────────────────────────────────
    // Receipts ONLY. A delivery with no receipt is not a clean delivery; it is
    // an uninspected one, and counting it as clean would reward exactly the
    // loads nobody checked.
    {
      const applicable = acc.receipts.length >= MIN_RECEIPTS_TO_SCORE;
      const quality = acc.receipts.length ? 1 - damaged / acc.receipts.length : 0;
      factors.push({
        key: 'damage_free',
        label: 'Arrives undamaged',
        score: applicable ? quality : 0,
        weight: applicable ? W_DAMAGE_FREE : 0,
        applicable,
        detail: applicable
          ? (damaged === 0
              ? `No damage on ${acc.receipts.length} inspected loads`
              : `${damaged} of ${acc.receipts.length} inspected loads arrived damaged`)
          : `${acc.receipts.length} inspected ${acc.receipts.length === 1 ? 'load' : 'loads'} — need ${MIN_RECEIPTS_TO_SCORE} to judge`,
      });
    }

    const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
    // Null, not zero. A supplier with no evidence has not scored badly — the app
    // simply has nothing to say, and a 0 would read as an F.
    const score = totalWeight > 0
      ? Math.round((factors.reduce((s, f) => s + f.score * f.weight, 0) / totalWeight) * 100)
      : null;

    const confidence: SupplierConfidence =
      slips.length >= 8 ? 'high' : slips.length >= MIN_DELIVERIES_TO_SCORE ? 'medium' : 'low';

    // Biggest weighted drag leads; with nothing to drag, the strongest factor does.
    const ranked = [...factors].sort((a, b) =>
      (b.weight * (1 - b.score)) - (a.weight * (1 - a.score)));

    cards.push({
      supplierKey,
      supplier: acc.supplier,
      score,
      grade: score === null ? null : gradeFor(score),
      confidence,
      factors: ranked,
      topDriver: ranked[0]?.detail ?? '',
      deliveryCount: acc.deliveries.length,
      settledCount: settled.length,
      lateCount: late.length,
      avgSlipDays: late.length
        ? Math.round((late.reduce((s, n) => s + n, 0) / late.length) * 10) / 10
        : null,
      receiptCount: acc.receipts.length,
      damagedCount: damaged,
    });
  }

  // Worst scored first — the problem leads. Unscored suppliers sort last: they
  // are not good news, they are no news, and putting them above a measured D
  // would bury the finding.
  return cards.sort((a, b) => {
    if (a.score === null && b.score === null) return a.supplier.localeCompare(b.supplier);
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return a.score - b.score;
  });
}

/** One line for a dashboard tile. Null when there is nothing defensible to say. */
export function summarizeSuppliers(cards: SupplierScorecard[]): string | null {
  const scored = cards.filter(c => c.score !== null);
  if (scored.length === 0) return null;
  const worst = scored[0];
  if (worst.lateCount === 0) {
    return `${scored.length} ${scored.length === 1 ? 'supplier' : 'suppliers'} measured · none running late`;
  }
  return `${worst.supplier} is late on ${worst.lateCount} of ${worst.settledCount} loads`;
}
