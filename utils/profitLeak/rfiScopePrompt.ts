// utils/profitLeak/rfiScopePrompt.ts — the RFI scope check's AI seam.
//
// An architect's answer to an RFI is the moment extra work most often slips in
// unpriced: "add blocking at every TV location", "upsize the beam to a W10x22".
// This builds the grounded prompt that compares that ANSWER with the contracted
// scope (the same buildScopeSummary text the Profit Leak scan uses) and reuses
// the leak parser, so one malformed field never tanks the check.
//
// Pure: no React, no storage, no network.
import { hashLeakText } from './leakPrompt';
import { toCents } from '@/utils/brain/scopeCoDraft';
import { formatMoney } from '@/utils/formatters';

export { coerceLeakResult as parseRfiScopeResult, LEAK_SCHEMA_HINT as RFI_SCOPE_SCHEMA_HINT } from './leakPrompt';

export interface RfiScopeInput {
  number: number;
  subject: string;
  question: string;
  response: string;
  linkedDrawing?: string | null;
}

/** Remembered verdicts (not a change / nothing found), per RFI id. Under the
 *  mageid_ prefix, so the sign-out sweep erases them. */
export const RFI_SCOPE_CHECKS_KEY = 'mageid_rfi_scope_checks';

export function buildRfiScopePrompt(scopeSummary: string, rfi: RfiScopeInput): string {
  const lines: string[] = [
    'You are a construction change-order auditor working for the general contractor.',
    "Compare the ARCHITECT'S OR ENGINEER'S ANSWER to this RFI against the CONTRACTED SCOPE and list only work the answer ADDS beyond that scope (work the GC should price as a change order).",
    '',
    'Rules:',
    '- Compare ONLY against the scope provided below. Do not assume any scope that is not written here.',
    '- Work listed under "already approved additions" or "already captured additions" is in scope — never flag it.',
    '- A clarification that only confirms what is already drawn or specified adds nothing. Return an empty items list for it.',
    '- For every flagged item, set reportQuote to the exact phrase from the ANSWER that adds it.',
    '- Prefer an empty items list over speculation.',
    '- quantity is only what the answer states or clearly implies; otherwise quantity 1 and unit "ls".',
    '- trade is the trade that would do the work (Electrical, Plumbing, HVAC, Framing, Drywall, ...).',
    '- confidence is how sure you are the item is added scope: low, medium, or high.',
    '- Respond with JSON only, matching the provided shape.',
    '',
    '=== CONTRACTED SCOPE ===',
    scopeSummary,
    '',
    `=== RFI #${rfi.number}: ${rfi.subject} ===`,
    `Question: ${(rfi.question ?? '').trim() || '(none)'}`,
  ];
  if (rfi.linkedDrawing) lines.push(`Drawing: ${rfi.linkedDrawing}`);
  lines.push(`Answer: ${(rfi.response ?? '').trim()}`);
  return lines.join('\n');
}

/** Stable hash of the question + answer. A remembered verdict whose hash no
 *  longer matches is ignored: the answer changed. */
export function hashRfiAnswer(rfi: { question?: string; response?: string }): string {
  return hashLeakText(rfi.question ?? '', rfi.response ?? '', []);
}

/** One checked item as the card prices it: his rate (or none) × the quantity. */
export interface RfiScopePricedLine {
  quantity: number;
  rateUsed: number | null;
}

/** Σ Math.round(qty × rate cents) over the PRICED lines — the exact rounding
 *  buildScopeCoDraft uses, so the headline equals the drafted CO's
 *  changeAmount to the cent. Unpriced lines add nothing (they land on the CO
 *  as 'needs price'). */
export function rfiScopeTotalCents(lines: readonly RfiScopePricedLine[]): number {
  let sum = 0;
  for (const l of lines) {
    if (l.rateUsed == null || !Number.isFinite(l.rateUsed) || l.rateUsed <= 0) continue;
    sum += Math.round(l.quantity * toCents(l.rateUsed));
  }
  return sum;
}

/** 'This answer adds scope: 2 items, about $1,240 at your rates · 1 with no
 *  price of yours yet'. With nothing priced: 'This answer adds scope: 2 items ·
 *  none has a price of yours yet' (never 'about $0'). */
export function rfiScopeHeadline(lines: readonly RfiScopePricedLine[]): { text: string; cents: number; unpriced: number } {
  const cents = rfiScopeTotalCents(lines);
  const unpriced = lines.filter(l => l.rateUsed == null || !Number.isFinite(l.rateUsed) || l.rateUsed <= 0).length;
  const n = lines.length;
  const items = `${n} item${n === 1 ? '' : 's'}`;
  // Nothing priced means we don't know the money, not that it's $0: drop the
  // money clause rather than print 'about $0'.
  if (cents === 0 && unpriced > 0) {
    const tail = unpriced === n
      ? (n === 1 ? 'no price of yours yet' : 'none has a price of yours yet')
      : `${unpriced} with no price of yours yet`;
    return { text: `This answer adds scope: ${items} · ${tail}`, cents, unpriced };
  }
  const money = formatMoney(cents / 100, cents % 100 === 0 ? 0 : 2);
  let text = `This answer adds scope: ${items}, about ${money} at your rates`;
  if (unpriced > 0) text += ` · ${unpriced} with no price of yours yet`;
  return { text, cents, unpriced };
}
