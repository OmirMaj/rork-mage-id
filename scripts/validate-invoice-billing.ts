// scripts/validate-invoice-billing.ts — pure-fn validator for utils/invoiceBilling.ts.
//
// These four formulas back the money-critical fixes from the 2026-07-13
// financials audit: the double-scale gate, the retention-net pay-link charge,
// the "already billed" per-line weighting, and the markup-inclusive unit price.
// Each case below encodes the exact bug it prevents.
import {
  progressSubtotal,
  netBalanceDue,
  billedAmountForLine,
  markupInclusiveUnitPrice,
} from '../utils/invoiceBilling';

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}
function close(n: string, got: number, want: number, eps = 1e-9) {
  const ok = Math.abs(got - want) <= eps;
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', got, '\n   want', want); }
}

// ── progressSubtotal — the double-scale gate (finding #1) ──────────────────
{
  // Bill-from-Estimate: lines are ALREADY scaled to 30% ($3,000 of a $10k line)
  // and carry billedPercent. Reopening as a 30% progress invoice must NOT scale
  // again — subtotal stays $3,000, not $900.
  const preScaled = [{ total: 3000, billedPercent: 30 }];
  close('pre-scaled progress line is NOT re-scaled', progressSubtotal(preScaled, true, 30), 3000);

  // Native editor progress invoice: line stores the FULL $10k total and the
  // invoice-level 30% applies once → $3,000.
  const fullLine = [{ total: 10000 }];
  close('native progress line IS scaled once', progressSubtotal(fullLine, true, 30), 3000);

  // A single pre-scaled line taints the whole invoice → no scaling applied.
  const mixed = [{ total: 3000, billedPercent: 30 }, { total: 500 }];
  close('any pre-scaled line disables invoice-level scaling', progressSubtotal(mixed, true, 30), 3500);

  // Non-progress invoice: never scaled regardless of pct.
  close('full (non-progress) invoice never scales', progressSubtotal([{ total: 4000 }], false, 30), 4000);

  // billedPercent of 0 still counts as "pre-scaled" (0 != null).
  close('billedPercent 0 counts as pre-scaled', progressSubtotal([{ total: 2000, billedPercent: 0 }], true, 50), 2000);

  // Empty invoice → 0, no NaN.
  close('empty line items → 0', progressSubtotal([], true, 30), 0);
}

// ── netBalanceDue — retention-net pay-link charge (finding #4) ─────────────
{
  // $100k invoice, 10% retention ($10k held), nothing paid → charge $90k, not $100k.
  close('retention held back is not charged', netBalanceDue({ totalDue: 100000, retentionAmount: 10000 }), 90000);

  // Released retention becomes collectible again.
  close('released retention is collectible', netBalanceDue({ totalDue: 100000, retentionAmount: 10000, retentionReleased: 10000 }), 100000);

  // Partial release: $4k of $10k released → $6k still held → charge $94k.
  close('partial retention release', netBalanceDue({ totalDue: 100000, retentionAmount: 10000, retentionReleased: 4000 }), 94000);

  // Payments already collected reduce the balance too.
  close('amountPaid reduces the balance', netBalanceDue({ totalDue: 100000, retentionAmount: 10000, amountPaid: 50000 }), 40000);

  // No retention → full totalDue (less payments).
  close('no retention → gross balance', netBalanceDue({ totalDue: 5000 }), 5000);

  // Overpaid / over-released never goes negative.
  close('never negative (overpaid)', netBalanceDue({ totalDue: 1000, amountPaid: 2000 }), 0);
  close('never negative (retention > total)', netBalanceDue({ totalDue: 1000, retentionAmount: 5000 }), 0);
}

// ── billedAmountForLine — "already billed" weighting (finding #6) ──────────
{
  // Bill-from-Estimate line: total IS the billed amount (already scaled).
  close('bill-from-estimate line counts its stored total', billedAmountForLine({ total: 3000, billedPercent: 30 }, { type: 'progress', progressPercent: 30 }), 3000);

  // Editor progress line: FULL total weighted by the invoice progress %.
  // $10k line on a 30% progress invoice → $3,000 billed (not $10,000).
  close('editor progress line weighted by invoice %', billedAmountForLine({ total: 10000 }, { type: 'progress', progressPercent: 30 }), 3000);

  // Full (non-progress) invoice: 100% of the line billed.
  close('full invoice line billed at 100%', billedAmountForLine({ total: 10000 }, { type: 'full' }), 10000);

  // Unknown progress % on a progress invoice → conservative FULL count
  // (over-count blocks re-billing; under-count would double-bill).
  close('unknown progress % falls back to full', billedAmountForLine({ total: 10000 }, { type: 'progress' }), 10000);

  // No invoice meta → treat as full line.
  close('missing invoice meta → full line', billedAmountForLine({ total: 750 }, undefined), 750);

  // MIXED invoice (a voice-added line with no billedPercent alongside pre-scaled
  // bill-from-estimate lines): progressSubtotal charges EVERY line unscaled, so
  // the plain line's billed amount is its FULL total, not progressPercent of it.
  // Under-counting here would offer already-billed work for re-billing (double
  // charge). anyPreScaledInInvoice=true must return the full $6,000, not $2,400.
  const mixedInv = { type: 'progress', progressPercent: 40 };
  close('mixed invoice: plain line counts full when siblings are pre-scaled',
    billedAmountForLine({ total: 6000 }, mixedInv, true), 6000);
  close('mixed invoice: pre-scaled line still counts its stored total',
    billedAmountForLine({ total: 8000, billedPercent: 40 }, mixedInv, true), 8000);

  // The invariant that guards against drift: sum(billedAmountForLine) over an
  // invoice's lines must equal progressSubtotal(those lines). Verify on the
  // mixed invoice above ($8,000 pre-scaled + $6,000 full = $14,000 charged).
  {
    const lines: { total: number; billedPercent?: number }[] = [{ total: 8000, billedPercent: 40 }, { total: 6000 }];
    const anyPre = lines.some(l => l.billedPercent != null);
    const summed = lines.reduce((s, li) => s + billedAmountForLine(li, mixedInv, anyPre), 0);
    close('sum(billedAmountForLine) === progressSubtotal (mixed)', summed, progressSubtotal(lines, true, 40));
  }
  // Same invariant for a PURE editor progress invoice (no pre-scaled line).
  {
    const lines: { total: number; billedPercent?: number }[] = [{ total: 10000 }, { total: 5000 }];
    const anyPre = lines.some(l => l.billedPercent != null);
    const summed = lines.reduce((s, li) => s + billedAmountForLine(li, { type: 'progress', progressPercent: 30 }, anyPre), 0);
    close('sum(billedAmountForLine) === progressSubtotal (pure editor progress)', summed, progressSubtotal(lines, true, 30));
  }
}

// ── markupInclusiveUnitPrice — footing on the PDF (finding #5) ─────────────
{
  // 100 units, $10 pre-markup, 20% markup → lineTotal $1,200 → effective $12/unit
  // so 100 × $12 = $1,200 foots.
  close('markup folded into unit price foots the line', markupInclusiveUnitPrice(1200, 100, 10), 12);

  // Lump-sum line (qty 0) → keep the fallback price, no divide-by-zero.
  close('qty 0 keeps fallback price', markupInclusiveUnitPrice(1200, 0, 1200), 1200);

  // Rounds the displayed unit price to cents (line total stays authoritative).
  close('rounds unit price to cents', markupInclusiveUnitPrice(100, 3, 33.33), 33.33);

  // No markup → unit price unchanged.
  close('no markup → unchanged unit price', markupInclusiveUnitPrice(1000, 100, 10), 10);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
