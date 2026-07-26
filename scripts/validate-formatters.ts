/**
 * validate-formatters.ts — pinned test cases for parseLenientNumber.
 *
 * Run: bun run test:formatters
 *
 * These cases cover the exact corruption vectors documented in the audit:
 *  - '1,200' → parseFloat returns 1 (NOT 1200), passes the <=0 guard → silent $1 entry.
 *  - '$450'  → parseFloat returns NaN  → valid for the "no currency symbol" case,
 *              but parseLenientNumber should handle it.
 *  - '2-3'   → first number wins (range tolerance for qty inputs).
 *  - 'abc'   → null (no valid number).
 *
 * Each case: { input, expected, description }
 */

import { parseLenientNumber, displayText } from '../utils/formatters';

interface Case {
  input: string;
  expected: number | null;
  description: string;
}

const CASES: Case[] = [
  // ── Core corruption fixes ──────────────────────────────────────────────────
  { input: '1,200',     expected: 1200,   description: 'comma-formatted money (was silently 1)' },
  { input: '$450',      expected: 450,    description: 'currency symbol stripped' },
  { input: '2-3',       expected: 2,      description: 'range input → first number only' },
  { input: 'abc',       expected: null,   description: 'no digits → null' },
  // ── Additional coverage ───────────────────────────────────────────────────
  { input: '$1,200,000', expected: 1200000, description: 'large dollar with commas' },
  { input: '0',          expected: 0,       description: 'zero is a valid number' },
  { input: '-50',        expected: -50,     description: 'negative (e.g. discount)' },
  { input: '12.50',      expected: 12.5,    description: 'decimal price' },
  { input: ' 850 ',      expected: 850,     description: 'leading/trailing spaces' },
  { input: '',           expected: null,    description: 'empty string' },
  { input: '1,200.50',   expected: 1200.5,  description: 'comma + decimal combined' },
  { input: '$0.99',      expected: 0.99,    description: 'sub-dollar price' },
  { input: '10units',    expected: 10,      description: 'trailing unit text stripped' },
];

let passed = 0;
let failed = 0;

for (const c of CASES) {
  const got = parseLenientNumber(c.input);
  const ok = got === c.expected;
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL [${c.description}]`);
    console.error(`  input:    ${JSON.stringify(c.input)}`);
    console.error(`  expected: ${c.expected}`);
    console.error(`  got:      ${got}`);
  }
}

console.log(`parseLenientNumber: ${passed} passed, ${failed} failed`);

// ── displayText — the literal-"null" display guard (sim-audit fix #6) ────────
// A wizard project row rendered "New Project — null · renovation" because an
// AI extractor stringified an absent location. displayText collapses junk
// tokens to the fallback and passes real text through trimmed.
interface DisplayCase {
  input: string | null | undefined;
  fallback?: string;
  expected: string;
  description: string;
}

const DISPLAY_CASES: DisplayCase[] = [
  { input: 'null',        expected: '',            description: "literal 'null' → empty" },
  { input: 'NULL',        expected: '',            description: 'case-insensitive junk' },
  { input: 'undefined',   expected: '',            description: "literal 'undefined' → empty" },
  { input: 'n/a',         expected: '',            description: 'n/a → empty' },
  { input: 'none',        expected: '',            description: 'none → empty' },
  { input: null,          expected: '',            description: 'real null → empty' },
  { input: undefined,     expected: '',            description: 'real undefined → empty' },
  { input: '  ',          expected: '',            description: 'whitespace-only → empty' },
  { input: 'null', fallback: 'No location', expected: 'No location', description: 'junk → fallback' },
  { input: '', fallback: 'No location set', expected: 'No location set', description: 'empty → fallback' },
  { input: 'Austin',      expected: 'Austin',      description: 'real text passes through' },
  { input: '  Austin  ',  expected: 'Austin',      description: 'real text is trimmed' },
  { input: 'Nulltown, OH', expected: 'Nulltown, OH', description: 'junk token must match WHOLE string only' },
];

let dPassed = 0;
let dFailed = 0;
for (const c of DISPLAY_CASES) {
  const got = c.fallback !== undefined ? displayText(c.input, c.fallback) : displayText(c.input);
  if (got === c.expected) {
    dPassed++;
  } else {
    dFailed++;
    console.error(`FAIL [${c.description}]`);
    console.error(`  input:    ${JSON.stringify(c.input)}`);
    console.error(`  expected: ${JSON.stringify(c.expected)}`);
    console.error(`  got:      ${JSON.stringify(got)}`);
  }
}
console.log(`displayText: ${dPassed} passed, ${dFailed} failed`);

if (failed + dFailed > 0) process.exit(1);
