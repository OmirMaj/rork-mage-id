// laborRateDraft.ts — what the Labor rates sheet may write when it closes (#101).
//
// THE BUG. The sheet seeded one text field per trade from the rate book when it
// opened, and closing it sent EVERY field to setRates. setRates compares each
// value with the book as it is NOW, so when the account sync landed while the
// sheet was open (the web cleared the device cache, or the phone's copy was
// older than the rates he had just set on the web), every field he never
// touched still showed the old or empty value, differed from the fresh book,
// was re-dated "now" and upserted — and newest-edit-wins then pushed the
// cleared or rolled-back rate to every device he has. It fired with no typing
// at all: closing the sheet always commits.
//
// THE RULE NOW. The sheet keeps the values it was seeded with (the baseline).
//   • Closing writes only the trades whose PARSED value differs from the
//     baseline — "62" and "62.00" are the same rate, "" and "$0" both clear.
//   • While the sheet is open, a field he has not touched (its text still
//     equals the baseline text) follows the book: when the sync lands, both
//     the field and its baseline move to the new value, so it shows the
//     account's rate and can never overwrite it. A field he typed in is his.
//
// Pure — no React — so scripts/validate-w4-time-labor-*.ts runs it under bun.

import { parseLenientNumber } from '@/utils/formatters';

export type RateDrafts = Record<string, string>;

/** A rate field's text as the book stores it: a positive number, or null
 *  (blank, zero, negative or not a number — "no rate for this trade"). */
export function parseRateDraft(raw: string | undefined): number | null {
  const t = (raw ?? '').trim();
  if (t === '') return null;
  const n = parseLenientNumber(t);
  if (n === null || !Number.isFinite(n) || n <= 0) return null;
  // Cents: the book rounds to cents too (laborSamples roundRate), so 62.001
  // and 62 are the same stored rate.
  return Math.round(n * 100) / 100;
}

/** The text a field shows for a stored rate ('' for none). */
export function rateDraftText(rate: number | null | undefined): string {
  return Number.isFinite(rate) && (rate as number) > 0 ? String(rate) : '';
}

/** Seed one field per offered trade from the book. */
export function seedRateDrafts(tradeKeys: readonly string[], rates: Readonly<Record<string, number>>): RateDrafts {
  const out: RateDrafts = {};
  for (const k of tradeKeys) out[k] = rateDraftText(rates[k]);
  return out;
}

/**
 * The batch closing the sheet may send to setRates: ONLY the trades whose
 * parsed value moved away from what the sheet was opened (or last re-seeded)
 * with. An untouched field — even one that now disagrees with a book that
 * changed underneath it — sends nothing.
 */
export function rateDraftBatch(drafts: Readonly<RateDrafts>, baseline: Readonly<RateDrafts>): Record<string, number | null> {
  const batch: Record<string, number | null> = {};
  for (const [key, raw] of Object.entries(drafts)) {
    const now = parseRateDraft(raw);
    const was = parseRateDraft(baseline[key]);
    if (now !== was) batch[key] = now;
  }
  return batch;
}

/**
 * The book changed while the sheet was open (the account sync landed). Every
 * field he has not touched — text still equal to its baseline text — moves to
 * the book's value, baseline too; trades new to the list are added; a field
 * he edited is left exactly as he typed it. Returns null when nothing moves,
 * so the caller can skip a re-render.
 */
export function reseedUntouchedDrafts(
  drafts: Readonly<RateDrafts>,
  baseline: Readonly<RateDrafts>,
  fresh: Readonly<RateDrafts>,
): { drafts: RateDrafts; baseline: RateDrafts } | null {
  const nextDrafts: RateDrafts = { ...drafts };
  const nextBaseline: RateDrafts = { ...baseline };
  let moved = false;
  for (const [key, value] of Object.entries(fresh)) {
    if (!(key in drafts)) {
      nextDrafts[key] = value;
      nextBaseline[key] = value;
      moved = true;
      continue;
    }
    const untouched = (drafts[key] ?? '') === (baseline[key] ?? '');
    if (untouched && (drafts[key] !== value || baseline[key] !== value)) {
      nextDrafts[key] = value;
      nextBaseline[key] = value;
      moved = true;
    }
  }
  return moved ? { drafts: nextDrafts, baseline: nextBaseline } : null;
}
