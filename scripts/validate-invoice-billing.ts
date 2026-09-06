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
  invoiceIsSettled,
} from '../utils/invoiceBilling';
import { billFromEstimateUnitPrice } from '../utils/billFromEstimateCore';
import { getEffectiveStartingBalance, generateForecast, calculateSummary } from '../utils/cashFlowEngine';
import { computeWIPReport } from '../utils/financialReports';
import type { Invoice, Project, Commitment } from '../types';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// ── billFromEstimateUnitPrice — footing on the invoice and PDF (finding #5) ──
// The ONE markup-inclusive unit price. The editor (app/invoice.tsx) and
// Bill-from-Estimate both seed lines from the estimate with an UNROUNDED unit
// price and round only the line total, so quantity × unitPrice foots for every
// line, cent-exact or not. (The rounding helper markupInclusiveUnitPrice was
// deleted 2026-09-04 — 3 × $33.33 = $99.99 did not foot.)
{
  // 100 units, $10 pre-markup, 20% markup → lineTotal $1,200 → effective $12/unit
  // so 100 × $12 = $1,200 foots.
  close('markup folded into unit price foots the line', billFromEstimateUnitPrice(1200, 100, 10), 12);
  // No markup → unit price unchanged.
  close('no markup → unchanged unit price', billFromEstimateUnitPrice(1000, 100, 10), 10);
  // Code-health test #9: lump-sum (qty 0) keeps the fallback, no divide-by-zero.
  close('billFromEstimateUnitPrice(0, 0, 42) === 42 (qty 0, no divide-by-zero)', billFromEstimateUnitPrice(0, 0, 42), 42);

  const unit = billFromEstimateUnitPrice(100, 3, 33.33);
  close('unrounded unit price foots: 3 × (100 ÷ 3) rounds to $100.00', Math.round(unit * 3 * 100) / 100, 100);
  eq('unit price is NOT pre-rounded to cents', Math.abs(unit - 33.33) > 1e-6, true);
  close('lump-sum (qty 0) keeps the fallback price', billFromEstimateUnitPrice(1200, 0, 1200), 1200);
  close('cent-exact line is unchanged', billFromEstimateUnitPrice(1200, 100, 10), 12);
  // The editor must stay on the unrounded helper.
  {
    const invoiceScreen = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'invoice.tsx'), 'utf8');
    eq('app/invoice.tsx seeds estimate lines with billFromEstimateUnitPrice',
      /unitPrice:\s*billFromEstimateUnitPrice\(/.test(invoiceScreen), true);
    eq('the deleted rounding helper is not referenced anywhere in the invoice editor',
      /markupInclusiveUnitPrice/.test(invoiceScreen), false);
    eq('app/invoice.tsx rounds only the line total',
      /total:\s*Math\.round\(item\.lineTotal \* 100\) \/ 100/.test(invoiceScreen), true);

    // ── MONEY-F2 (review 2026-09-05): a stale Stripe link is never reused ──
    // pay_link_* are server-owned, so a local clear is undone by the next
    // refetch. Every mint site must gate on the minted amount matching today's
    // balance — not on "a link exists" — and Copy / Share must read the same
    // predicate. Fixture: link minted for $90,000, a $50,000 check recorded,
    // "Send" used to email "$40,000 due" with a button charging $90,000.
    const code = invoiceScreen
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    eq('no `!payLinkUrl &&` mint gate remains (a link for the OLD balance must never be reused)',
      /!payLinkUrl\s*&&/.test(code), false);
    eq('the screen derives payLinkMatchesBalance from payLinkAmount vs balanceDue to the cent',
      /const payLinkMatchesBalance\s*=[\s\S]{0,200}payLinkAmount\s*-\s*balanceDue\)\s*<=\s*0\.01/.test(code), true);
    eq('the email send and the PDF send both re-mint unless the stored link matches the balance',
      (code.match(/if \(!(?:working|stored)LinkMatchesBalance && (?:balanceDue|pdfNetDue) > 0\)/g) ?? []).length, 2);
    eq('a non-matching stored link is NOT carried into the email as a fallback',
      /workingLinkMatchesBalance \? workingInvoice\.payLinkUrl : undefined/.test(code)
      && /storedLinkMatchesBalance \? existingInvoice\.payLinkUrl : undefined/.test(code), true);
    eq('Copy reads payLinkMatchesBalance',
      /const handleCopyPayLink[\s\S]{0,160}\|\| !payLinkMatchesBalance\) return;/.test(code), true);
    eq('Share reads payLinkMatchesBalance',
      /const handleSharePayLink[\s\S]{0,160}\|\| !payLinkMatchesBalance\b/.test(code), true);
    eq('the card explains a stale link instead of offering it',
      /regenerate for the current balance of/.test(code), true);
    eq('Copy / Share buttons render only behind payLinkMatchesBalance',
      /\{payLinkMatchesBalance && \(\s*<>\s*<TouchableOpacity[\s\S]{0,400}testID="copy-pay-link-btn"/.test(code), true);
    eq('recording a payment and releasing retention both re-mint a live link for the new balance',
      (code.match(/void mintPayLinkFor\(existingInvoice, newBalance\)/g) ?? []).length, 2);
    eq('a draft total change clears payLinkAmount together with url/id',
      /totalChanged \? \{ payLinkUrl: undefined, payLinkId: undefined, payLinkAmount: undefined \}/.test(code), true);
    eq('releasing retention on a stored-paid invoice reopens it',
      /existingInvoice\.status === 'paid' && newBalance > 0\.01[\s\S]{0,120}status: amountPaid > 0 \? 'partially_paid'/.test(code), true);
  }
  // Code-health test #9: a 0% progress line bills nothing.
  close('progressSubtotal on a 0% progress invoice is 0', progressSubtotal([{ total: 10000 }], true, 0), 0);
}

// ── MONEY-F7 — "Release Retention" has ONE meaning: now collectible ─────────
// Bank balance set $50,000 on Jan 1. The $100,000 invoice (10% retention)
// was paid down to the $90,000 asked for. Feb 1 the GC releases the $10,000;
// the check arrives Feb 10 and is recorded as a payment. The release must
// show up ONCE — as collectible / forecast income — and the cash ONCE, when
// the payment is recorded: starting balance $60,000, never $70,000.
{
  const asOf = '2026-01-01T00:00:00.000Z';
  const base: Invoice = {
    id: 'i7', number: 7, projectId: 'p1', type: 'progress',
    issueDate: '2025-12-01T12:00:00.000Z', dueDate: '2025-12-31T12:00:00.000Z', paymentTerms: 'net_30',
    notes: '', lineItems: [], subtotal: 100_000, taxRate: 0, taxAmount: 0,
    totalDue: 100_000, amountPaid: 90_000, status: 'partially_paid',
    payments: [{ id: 'pay1', date: '2025-12-15T12:00:00.000Z', amount: 90_000, method: 'check' }],
    retentionPercent: 10, retentionAmount: 10_000,
    createdAt: '2025-12-01T12:00:00.000Z', updatedAt: '2025-12-01T12:00:00.000Z',
  };
  eq('paid-to-retention invoice is settled (MONEY-F5)', invoiceIsSettled(base), true);
  close('…and nothing is collectible before the release', netBalanceDue(base), 0);

  const released: Invoice = {
    ...base,
    retentionReleased: 10_000,
    retentionReleases: [{ id: 'rel1', date: '2026-02-01T12:00:00.000Z', amount: 10_000 }],
  };
  close('a release does NOT add to the effective bank balance', getEffectiveStartingBalance(50_000, asOf, [released]), 50_000);
  close('…it makes the $10,000 collectible', netBalanceDue(released), 10_000);
  eq('…and the invoice reopens until it is paid', invoiceIsSettled(released), false);
  const forecast = calculateSummary(generateForecast(50_000, [], [released], [], 12, 'net_30', []));
  close('forecast income carries the released $10,000 exactly once', forecast.totalIncome, 10_000);

  const paid: Invoice = {
    ...released,
    amountPaid: 100_000,
    status: 'paid',
    payments: [...base.payments, { id: 'pay2', date: '2026-02-10T12:00:00.000Z', amount: 10_000, method: 'check' }],
  };
  close('recording the payment lands $60,000 — once, never $70,000', getEffectiveStartingBalance(50_000, asOf, [paid]), 60_000);
  close('…and nothing remains collectible', netBalanceDue(paid), 0);
  eq('…and the invoice is settled again', invoiceIsSettled(paid), true);
  const afterPay = calculateSummary(generateForecast(60_000, [], [paid], [], 12, 'net_30', []));
  close('the paid release is not forecast again', afterPay.totalIncome, 0);
}

// ── MONEY-F13 — Reports-hub WIP "Unbilled" is no longer identically zero ────
// Revised contract $550,000; $220,000 billed. Percent complete comes from COST
// (job actual ÷ EAC, the utils/wip.ts basis), not from billed ÷ revised —
// the old basis made earned ≡ billed, so Unbilled could never be non-zero.
{
  const project = {
    id: 'p1', name: 'Ridge Rd', status: 'in_progress',
    linkedEstimate: {
      id: 'est', items: [{
        materialId: 'm1', name: 'Build', category: 'Materials', unit: 'ls',
        quantity: 1, unitPrice: 400_000, bulkPrice: 400_000, markup: 37.5, usesBulk: false,
        lineTotal: 550_000, supplier: '',
      }],
      globalMarkup: 37.5, baseTotal: 400_000, markupTotal: 150_000, grandTotal: 550_000, createdAt: '2026-01-01',
    },
  } as unknown as Project;
  // The whole $400,000 cost budget is committed, so EAC = budget and
  // actual ÷ EAC is the plain cost percent.
  const commitment = {
    id: 'c1', projectId: 'p1', number: 'SC-1', type: 'subcontract', description: 'Build',
    amount: 400_000, signedDate: '2026-01-01', phase: 'Materials', status: 'active',
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
  } as unknown as Commitment;
  const billed = (actualPaid: number): Invoice => ({
    id: 'inv1', number: 1, projectId: 'p1', type: 'progress', progressPercent: 40,
    issueDate: '2026-03-01', dueDate: '2026-03-31', paymentTerms: 'net_30', notes: '',
    lineItems: [{ id: 'l1', name: 'Progress', description: '', quantity: 1, unit: 'ls', unitPrice: 220_000, total: 220_000, sourceEstimateItemId: 'm1' }],
    subtotal: 220_000, taxRate: 0, taxAmount: 0, totalDue: 220_000, amountPaid: actualPaid,
    status: 'sent', payments: [], createdAt: '2026-03-01', updatedAt: '2026-03-01',
  } as unknown as Invoice);

  const at40 = computeWIPReport([project], [billed(160_000)], [], [commitment]).rows[0];
  close('revised contract is $550,000', at40.revisedContract, 550_000);
  close('billed to date is $220,000', at40.billedToDate, 220_000);
  close('40% cost-complete → percentComplete 40', at40.percentComplete, 40, 0.01);
  close('40% cost-complete → earned $220,000, unbilled $0', at40.unbilled, 0, 0.01);

  const at50 = computeWIPReport([project], [billed(200_000)], [], [commitment]).rows[0];
  close('50% cost-complete → percentComplete 50', at50.percentComplete, 50, 0.01);
  close('50% cost-complete → earned $275,000, unbilled $55,000', at50.unbilled, 55_000, 0.01);

  // No cost picture at all → schedule progress, not "as billed".
  const scheduled = { ...project, schedule: { tasks: [{ progress: 30 }, { progress: 70 }] } } as unknown as Project;
  const noCost = computeWIPReport([scheduled], [billed(0)], [], []).rows[0];
  close('with no actuals, percent complete falls back to schedule progress (50)', noCost.percentComplete, 50, 0.01);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
