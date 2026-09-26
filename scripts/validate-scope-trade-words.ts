// scripts/validate-scope-trade-words.ts
//
// Wave 4 W1 §F: the RFI trade-word pricing fix. An AI trade word ('Framing',
// 'Concrete', 'Painting') now reaches the cost-book LABEL it means, on the SAME
// unit only — never an any-unit fallback — and an exact entry still wins.
// Pure — exits non-zero on failure.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scopeRateFor, bookLabelFor, TRADE_WORD_TO_BOOK_LABEL } from '../utils/scopePricing';
import { CATEGORY_META } from '../constants/materials';
import type { CostBookEntry, CostDatabase } from '../utils/costDatabase';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { console.log(`  PASS ${label}`); passed++; } else { console.error(`  FAIL ${label}`); failed++; }
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

// Built the way scripts/validate-scope-coverage.ts builds its book.
function entry(trade: string, unit: string, extra: Partial<CostBookEntry> = {}): CostBookEntry {
  return {
    key: `${trade.toLowerCase()}|${unit.toLowerCase()}`, trade, unit, sampleCount: 2, jobCount: 2,
    personalRate: 100, variability: 0.1, bidBias: 0, baseline: 100, suggestedRate: 100, confidence: 'medium',
    totalActual: 1000, lastSeen: '', samples: [], provenance: 'earned', earnedBasis: 'paid', ...extra,
  };
}
const db: CostDatabase = {
  entries: [
    entry('Lumber & Framing', 'sf'),
    entry('Concrete & Masonry', 'cy'),
    entry('Paint & Finishes', 'sf'),
    entry('Electrical', 'ea'),
  ],
  jobsAnalyzed: 2, tradesTracked: 4, overallBidAccuracy: null, asOf: '',
};

console.log('\n── trade words reach their book label (same unit)');
assert(scopeRateFor(db, 'Framing', 'SF')?.trade === 'Lumber & Framing', "'Framing'|SF → 'Lumber & Framing|sf'");
assert(scopeRateFor(db, 'Concrete', 'CY')?.trade === 'Concrete & Masonry', "'Concrete'|CY → 'Concrete & Masonry|cy'");
assert(scopeRateFor(db, 'Painting', 'SF')?.trade === 'Paint & Finishes', "'Painting'|SF → 'Paint & Finishes|sf'");
assert(scopeRateFor(db, '  rough framing ', 'sq ft')?.trade === 'Lumber & Framing', "' rough framing '|'sq ft' → 'Lumber & Framing|sf'");
assert(scopeRateFor(db, 'lumber', 'sf')?.trade === 'Lumber & Framing', "CATEGORY_META key 'lumber' still maps (unchanged)");

console.log('\n── exact wins, unit is never relaxed');
{
  const withExact: CostDatabase = { ...db, entries: [...db.entries, entry('Framing', 'sf', { personalRate: 7 })] };
  const hit = scopeRateFor(withExact, 'Framing', 'SF');
  assert(hit?.trade === 'Framing' && hit.personalRate === 7, "an exact 'Framing|sf' entry wins over the alias");
}
assert(scopeRateFor(db, 'Framing', 'EA') === null, "'Framing'|EA with only an SF entry → null (no any-unit fallback)");
assert(scopeRateFor(db, 'Tile', 'SF') === null, "'Tile' → null (deliberately unmapped)");
assert(scopeRateFor(db, 'Electrical', 'EA')?.trade === 'Electrical', "'Electrical'|EA still hits 'Electrical|ea'");
assert(scopeRateFor(db, 'Plumbing', 'EA') === null, 'a trade with no entry → null');

console.log('\n── the table');
{
  const labels = new Set(Object.values(CATEGORY_META).map((m) => m.label));
  for (const [word, label] of Object.entries(TRADE_WORD_TO_BOOK_LABEL)) {
    assert(labels.has(label), `'${word}' → '${label}' is a CATEGORY_META label`);
    assert(word === word.trim().toLowerCase(), `'${word}' is a lowercase trimmed key`);
  }
  for (const ambiguous of ['tile', 'finishes', 'mechanical', 'doors/hardware']) {
    assert(!(ambiguous in TRADE_WORD_TO_BOOK_LABEL), `'${ambiguous}' is deliberately absent`);
  }
  assert(bookLabelFor('lumber') === 'Lumber & Framing' && bookLabelFor('Framing') === 'Lumber & Framing', 'bookLabelFor: CATEGORY_META key, then the word table');
  assert(bookLabelFor('Tile') === null && bookLabelFor('') === null, 'bookLabelFor: unknown → null');
  assert(bookLabelFor('constructor') === null && scopeRateFor(db, 'toString', 'ea') === null, 'prototype names never resolve');
}

console.log('\n── callers');
for (const rel of ['components/rfi/RfiScopeCheckCard.tsx', 'components/scopeGaps/ScopeGapsCard.tsx', 'utils/scopeGaps.ts']) {
  assert(/import \{[^}]*\bscopeRateFor\b[^}]*\} from '@\/utils\/scopePricing'/.test(read(rel)), `${rel} imports scopeRateFor from '@/utils/scopePricing'`);
}
assert(!/any-unit|anyUnit/.test(read('utils/scopePricing.ts').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'scopePricing code has no any-unit fallback');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
