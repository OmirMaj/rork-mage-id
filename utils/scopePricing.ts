// utils/scopePricing.ts — THE one pricing path shared by Scope Code Gaps and
// the RFI scope check, so one trade can never show two prices.
//
// The cost book stores trades under the CATEGORY_META LABEL ('Lumber &
// Framing', 'Windows & Doors') because estimate/full.tsx writes the label; an
// AI trade such as 'Electrical' has no CATEGORY_META key and falls through
// as-is (bookKey lowercases both sides). This is the exact key
// app/(tabs)/estimate/review.tsx uses.
//
// EXACT ON THE UNIT. Never utils/costXray's any-unit fallback: a rate in
// another unit cannot price this quantity. The trade name, though, now also
// tries its book label: an AI trade word ('Framing', 'Concrete', 'Painting')
// is neither a CATEGORY_META key nor a label, so the RFI scope check and
// Scope Code Gaps read "No price of yours yet" while he had a Framing rate.
// TRADE_WORD_TO_BOOK_LABEL maps the unambiguous words; the exact lookup still
// runs first, so a book that really has 'Framing|sf' keeps winning.
//
// Pure — no React, no storage, no network.
import { CATEGORY_META } from '@/constants/materials';
import { lookupRate, type CostBookEntry, type CostDatabase } from '@/utils/costDatabase';

/** AI trade words → the cost-book label they mean. Only unambiguous words: 'tile', 'finishes', 'mechanical', 'doors/hardware' are deliberately absent (they could mean two books). Every value MUST be a CATEGORY_META label — scripts/validate-scope-trade-words.ts enforces it. */
export const TRADE_WORD_TO_BOOK_LABEL: Readonly<Record<string, string>> = {
  framing: 'Lumber & Framing', 'rough framing': 'Lumber & Framing', carpentry: 'Lumber & Framing', 'rough carpentry': 'Lumber & Framing', lumber: 'Lumber & Framing',
  concrete: 'Concrete & Masonry', masonry: 'Concrete & Masonry', 'concrete & masonry': 'Concrete & Masonry',
  painting: 'Paint & Finishes', paint: 'Paint & Finishes', painter: 'Paint & Finishes',
  windows: 'Windows & Doors', doors: 'Windows & Doors',
  siding: 'Siding & Exterior',
  steel: 'Steel & Metal', 'structural steel': 'Steel & Metal', metals: 'Steel & Metal', metal: 'Steel & Metal',
  fasteners: 'Fasteners & Hardware',
  landscaping: 'Landscape',
};

/** The cost-book label a trade name means: its CATEGORY_META label (by
 *  lowercase key), else the trade-word table, else null. */
export function bookLabelFor(trade: string): string | null {
  const word = String(trade ?? '').trim().toLowerCase();
  if (!word) return null;
  // Own keys only: 'constructor' must never resolve to Object's.
  if (Object.prototype.hasOwnProperty.call(CATEGORY_META, word)) return CATEGORY_META[word].label;
  return Object.prototype.hasOwnProperty.call(TRADE_WORD_TO_BOOK_LABEL, word) ? TRADE_WORD_TO_BOOK_LABEL[word] : null;
}

export function scopeRateFor(db: CostDatabase, trade: string, unit: string): CostBookEntry | null {
  // 1. The exact lookup, unchanged (a book that really has 'Framing|sf' keeps winning).
  const exact = lookupRate(db, CATEGORY_META[trade]?.label ?? trade, unit);
  if (exact) return exact;
  // 2. The trade word's book label, on the SAME unit.
  const label = bookLabelFor(trade);
  return label && label.toLowerCase() !== String(trade).trim().toLowerCase() ? lookupRate(db, label, unit) : null;
}

/** Where the rate came from, in his words. Never reads as a measured rate when it is not one. */
export function scopeRateCaption(entry: CostBookEntry | null): string {
  if (!entry) return 'No price of yours yet';
  if (entry.provenance === 'seeded') return 'a rate you set';
  const n = entry.jobCount;
  if (entry.earnedBasis === 'contracted') {
    return `from ${n} signed sub price${n === 1 ? '' : 's'}, not yet paid`;
  }
  return `your rate · ${n} job${n === 1 ? '' : 's'}`;
}
