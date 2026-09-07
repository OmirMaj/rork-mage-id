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
  roundCents,
  retainageOnWorkValue,
  taxBasisRetentionOverhold,
  effectiveRetentionHeld,
  pendingRetentionHeld,
} from '../utils/invoiceBilling';
import {
  retainagePercentForInvoice,
  computeAIATotals,
  seedAIAPayApplicationFromInvoice,
  type AIAPayApplication,
} from '../utils/aiaBilling';
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
  // MONEY-DEF-1 (audit 2026-09-07): cost complete is driven by what has been
  // paid OUT (commitment.paidToDate), never by what the client has paid IN.
  const commitmentPaid = (paidToDate: number): Commitment => ({
    id: 'c1', projectId: 'p1', number: 'SC-1', type: 'subcontract', description: 'Build',
    amount: 400_000, paidToDate, signedDate: '2026-01-01', phase: 'Materials', status: 'active',
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
  } as unknown as Commitment);
  const billed = (clientPaid: number): Invoice => ({
    id: 'inv1', number: 1, projectId: 'p1', type: 'progress', progressPercent: 40,
    issueDate: '2026-03-01', dueDate: '2026-03-31', paymentTerms: 'net_30', notes: '',
    lineItems: [{ id: 'l1', name: 'Progress', description: '', quantity: 1, unit: 'ls', unitPrice: 220_000, total: 220_000, sourceEstimateItemId: 'm1' }],
    subtotal: 220_000, taxRate: 0, taxAmount: 0, totalDue: 220_000, amountPaid: clientPaid,
    status: 'sent', payments: [], createdAt: '2026-03-01', updatedAt: '2026-03-01',
  } as unknown as Invoice);

  const at40 = computeWIPReport([project], [billed(160_000)], [], [commitmentPaid(160_000)]).rows[0];
  close('revised contract is $550,000', at40.revisedContract, 550_000);
  close('billed to date is $220,000', at40.billedToDate, 220_000);
  close('40% cost-complete → percentComplete 40', at40.percentComplete, 40, 0.01);
  close('40% cost-complete → earned $220,000, unbilled $0', at40.unbilled, 0, 0.01);

  const at50 = computeWIPReport([project], [billed(200_000)], [], [commitmentPaid(200_000)]).rows[0];
  close('50% cost-complete → percentComplete 50', at50.percentComplete, 50, 0.01);
  close('50% cost-complete → earned $275,000, unbilled $55,000', at50.unbilled, 55_000, 0.01);

  // No cost picture at all → schedule progress, not "as billed".
  const scheduled = { ...project, schedule: { tasks: [{ progress: 30 }, { progress: 70 }] } } as unknown as Project;
  const noCost = computeWIPReport([scheduled], [billed(0)], [], []).rows[0];
  close('with no actuals, percent complete falls back to schedule progress (50)', noCost.percentComplete, 50, 0.01);
}

// ── MISS-04 — retainage basis is the WORK VALUE, never the taxed total ─────
// Runtime audit 2026-09-06. app/invoice.tsx applied the retention % to
// `subtotal + taxAmount`, so the founder's live Houston Phone Booth Ad invoice
// #1 held $4,063.23 against a $75,595 subtotal + $5,669.63 of sales tax. The
// GC remits that tax to the state whether or not the owner holds retainage, so
// $283.48 of the withholding was against money already owed out. The G702 in
// the same repo has always used the work value, and now both call the SAME
// function.
{
  const HOUSTON_SUBTOTAL = 75_595;
  const HOUSTON_TAX = roundCents(HOUSTON_SUBTOTAL * 0.075);   // 5,669.63
  const HOUSTON_TOTAL = roundCents(HOUSTON_SUBTOTAL + HOUSTON_TAX); // 81,264.63

  close('the live Houston invoice retains 5% of work, not of the taxed total',
    retainageOnWorkValue(HOUSTON_SUBTOTAL, 5), 3_779.75);
  eq('…and that is NOT the shipped figure the audit found',
    retainageOnWorkValue(HOUSTON_SUBTOTAL, 5) === roundCents(HOUSTON_TOTAL * 0.05), false);
  close('the difference is exactly the retainage that was held against sales tax',
    roundCents(roundCents(HOUSTON_TOTAL * 0.05) - retainageOnWorkValue(HOUSTON_SUBTOTAL, 5)), 283.48);
  close('a zero tax rate leaves the retainage unchanged (basis was never the tax)',
    retainageOnWorkValue(HOUSTON_SUBTOTAL, 5), retainageOnWorkValue(HOUSTON_SUBTOTAL, 5));

  // Whole cents, both directions, and no NaN/negative leakage.
  close('retainage is whole cents (rounds down)', retainageOnWorkValue(333.33, 10), 33.33);
  close('retainage is whole cents (rounds up)', retainageOnWorkValue(366.67, 10), 36.67);
  close('the exact sub-cent value production stored is rounded, not carried',
    retainageOnWorkValue(81_264.625, 5), 4_063.23);
  close('retainage of 0% is 0', retainageOnWorkValue(50_000, 0), 0);
  // NOT clamped at zero: a deductive change-order line on a G703 is a real,
  // enterable credit whose retainage reduces the certificate's withholding.
  // Flooring it here made the G702 over-withhold by pct x |credit| and printed
  // $0.00 in the continuation sheet's retainage column on that line. Callers
  // whose basis cannot be negative (the invoice editor) clamp their own input —
  // asserted against app/invoice.tsx source below.
  close('a deductive credit line carries negative retainage, not zero',
    retainageOnWorkValue(-5_000, 10), -500);
  close('NaN work value → 0, not NaN', retainageOnWorkValue(NaN, 10), 0);
  close('a percentage above 100 is clamped', retainageOnWorkValue(1_000, 250), 1_000);

  // roundCents itself — the sub-cent values production actually stored.
  close('roundCents(4063.2312500000003) → 4063.23', roundCents(4_063.2312500000003), 4_063.23);
  close('roundCents(81264.625) → 81264.63', roundCents(81_264.625), 81_264.63);
  close('roundCents(48698.04825) → 48698.05', roundCents(48_698.04825), 48_698.05);
  close('roundCents(6142.400000000001) → 6142.40', roundCents(6_142.400000000001), 6_142.4);
  close('roundCents(NaN) → 0', roundCents(NaN), 0);

  // The screen must compute the three totals at cent precision AND take the
  // retainage basis from the work value. Source assertions, because the
  // arithmetic lives in a React component.
  {
    const invoiceScreen = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'invoice.tsx'), 'utf8');
    const code = invoiceScreen
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    eq('app/invoice.tsx computes retention through the shared retainageOnWorkValue',
      /retainageOnWorkValue\(retentionBasis, retentionPctValue\)/.test(code), true);
    eq('…whose basis is the subtotal (work value), not totalDue',
      /const retentionBasis = Math\.max\(0, subtotal\);/.test(code), true);
    eq('the tax-inclusive basis is gone',
      /totalDue \* \(retentionPctValue \/ 100\)/.test(code), false);
    eq('subtotal, tax and total are rounded to cents where they are computed',
      /const subtotal = useMemo\(\s*\(\) => roundCents\(progressSubtotal\(/.test(code)
      && /const taxAmount = roundCents\(subtotal \* \(taxRate \/ 100\)\);/.test(code)
      && /const totalDue = roundCents\(subtotal \+ taxAmount\);/.test(code), true);
    eq('the totals card discloses the retainage basis',
      /Retention Held \(\{retentionPctValue\}% of work completed\)/.test(code)
      && /testID="retention-basis-note"/.test(code), true);
    // The row under that note must show the amount WITHHELD, or the note stops
    // being true the moment any retention is released.
    eq('…and the row it labels renders retentionAmount, not retentionPending',
      /Retention Held \(\{retentionPctValue\}% of work completed\)<\/Text>\s*\n\s*<Text [^>]*>-\{formatCurrency\(retentionAmount\)\}/.test(code), true);
    eq('a row stored on the old tax-inclusive basis is called out from STORED columns only',
      /testID="retention-basis-legacy"/.test(code)
      && /taxBasisRetentionOverhold\(existingInvoice\)/.test(code), true);
    // MISS-04's stored half: the banner has to be actionable. Every invoice past
    // draft is locked and hides the save bar, so "save it again" repairs nothing.
    eq('…and offers a repair the GC can actually reach on a locked invoice',
      /testID="retention-basis-fix-btn"/.test(code)
      && /onPress=\{handleCorrectRetentionBasis\}/.test(code), true);
    eq('the repair rewrites the STORED row, not the editor\'s live state',
      /retentionAmount: corrected,/.test(code)
      && /subtotal: roundCents\(existingInvoice\.subtotal\),/.test(code)
      && /taxAmount: roundCents\(existingInvoice\.taxAmount\),/.test(code)
      && /totalDue: roundCents\(existingInvoice\.totalDue\),/.test(code), true);
    // MISS-05 at the writer: a deliberate 0% must persist AS 0.
    eq('a 0% retention is persisted as 0, never erased to undefined',
      /retentionPercent: retentionPctValue \|\| undefined/.test(code), false);
    // Line-anchored: only the three PERSIST sites (buildNewInvoice, save, send)
    // write `retentionPercent` as a standalone field. MONEY-05 added the same
    // key inline to the READ-time netBalanceDue / invoiceIsSettled calls, which
    // are not write sites and must not be counted here.
    eq('…at all three write sites',
      (code.match(/^\s+retentionPercent: retentionPctValue,$/gm) ?? []).length, 3);
    // MONEY-05: the screen's own balance must run the SHARED rule, not a figure
    // it computed privately — that divergence is the whole defect.
    eq('the screen hands netBalanceDue the basis, so it runs effectiveRetentionHeld',
      /netBalanceDue\(\{\s*\n?\s*totalDue, amountPaid, subtotal, retentionPercent: retentionPctValue, retentionAmount, retentionReleased,/.test(code), true);
    eq('…and the release cap comes from the shared pendingRetentionHeld',
      /const retentionPending = pendingRetentionHeld\(\{/.test(code), true);
    // The "Correct it" button no longer changes any money — every surface
    // already agrees — so its copy must not promise that it does.
    eq('the repair affordance is described as a bookkeeping fix, not a money change',
      /Update the saved figure to \{formatCurrency\(legacyTaxBasisRetention\.corrected\)\}/.test(code)
      && /nothing you or\s*\n?\s*your client is charged changes/.test(code), true);
  }
}

// ── MISS-05 — a pay app carries the invoice's retainage, never invents 10% ──
{
  const inv = (retentionPercent?: number): Invoice => ({
    id: 'inv-a', number: 1, projectId: 'p1', type: 'progress',
    issueDate: '2026-03-01', dueDate: '2026-03-31', paymentTerms: 'net_30', notes: '',
    lineItems: [{ id: 'l1', name: 'Work', description: '', quantity: 1, unit: 'ls', unitPrice: 45_300.51, total: 45_300.51 }],
    subtotal: 45_300.51, taxRate: 7.5, taxAmount: 3_397.54, totalDue: 48_698.05, amountPaid: 0,
    status: 'sent', payments: [], retentionPercent,
    createdAt: '2026-03-01', updatedAt: '2026-03-01',
  } as unknown as Invoice);

  close('an invoice that stored no retainage percent seeds 0%, not 10%',
    retainagePercentForInvoice(inv(undefined)), 0);
  close('a deliberate 0% stays 0%', retainagePercentForInvoice(inv(0)), 0);
  close('a real 5% is carried', retainagePercentForInvoice(inv(5)), 5);
  close('a nonsense stored percent is clamped, not trusted', retainagePercentForInvoice(inv(999)), 100);

  const project = { id: 'p1', name: 'Henderson', status: 'in_progress' } as unknown as Project;
  const seededNone = seedAIAPayApplicationFromInvoice(inv(undefined), project, [], { companyName: 'MAGE' } as never);
  close('the seeded G702 withholds nothing when the invoice withheld nothing',
    seededNone.retainagePercent, 0);
  close('…and every SOV line agrees', seededNone.lines[0].retainagePercent, 0);
  close('…so nothing is retained on the certificate',
    computeAIATotals(seededNone).totalRetainage, 0);
  close('…and current payment due is the full billed work, not 90% of it',
    computeAIATotals(seededNone).currentPaymentDue, 45_300.51);

  const seededFive = seedAIAPayApplicationFromInvoice(inv(5), project, [], { companyName: 'MAGE' } as never);
  close('a 5% invoice seeds a 5% certificate', seededFive.retainagePercent, 5);
  close('…retaining 5% of the WORK value on the SOV (no tax on a G703)',
    computeAIATotals(seededFive).totalRetainage, roundCents(45_300.51 * 0.05));

  // An explicit override still wins — the GC can enter the contract's rate.
  close('an explicit opts.retainagePercent still overrides the invoice',
    seedAIAPayApplicationFromInvoice(inv(0), project, [], { companyName: 'MAGE' } as never, { retainagePercent: 10 }).retainagePercent, 10);
}

// ── AIA totals foot to the cent (G703 column total === G702 line 5) ────────
{
  // Three lines whose unrounded retainage each lands on a half-cent: summing
  // once over the raw total and rounding at the end drifts from the printed
  // per-line column. computeAIATotals rounds PER LINE for exactly this reason.
  const app: AIAPayApplication = {
    applicationNumber: 1, applicationDate: '2026-03-01', periodTo: '2026-03-01',
    ownerName: 'Owner', contractorName: 'GC', projectName: 'P',
    originalContractSum: 100_000, netChangeByCO: 0, contractSumToDate: 100_000,
    retainagePercent: 7.5, lessPreviousCertificates: 0,
    lines: [
      { id: 'a', itemNo: '1', description: 'A', scheduledValue: 1_000.10, fromPreviousApp: 0, thisPeriod: 1_000.10, materialsPresentlyStored: 0, retainagePercent: 7.5 },
      { id: 'b', itemNo: '2', description: 'B', scheduledValue: 2_000.10, fromPreviousApp: 0, thisPeriod: 2_000.10, materialsPresentlyStored: 0, retainagePercent: 7.5 },
      { id: 'c', itemNo: '3', description: 'C', scheduledValue: 3_000.10, fromPreviousApp: 0, thisPeriod: 3_000.10, materialsPresentlyStored: 0, retainagePercent: 7.5 },
    ],
  };
  const t = computeAIATotals(app);
  const perLineColumn = roundCents(app.lines.reduce(
    (s, l) => s + retainageOnWorkValue(l.fromPreviousApp + l.thisPeriod, l.retainagePercent)
      + retainageOnWorkValue(l.materialsPresentlyStored, l.retainagePercent), 0));
  close('G702 line 5 equals the G703 retainage column, to the cent', t.totalRetainage, perLineColumn);
  eq('every G702 money total is whole cents',
    [t.totalCompletedAndStored, t.totalScheduledValue, t.retainageOnCompleted, t.retainageOnStored,
      t.totalRetainage, t.totalEarnedLessRetainage, t.currentPaymentDue, t.balanceToFinish]
      .every(v => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9), true);
  close('line 6 = line 4 − line 5', t.totalEarnedLessRetainage, roundCents(t.totalCompletedAndStored - t.totalRetainage));
  close('line 9 = line 3 − line 6', t.balanceToFinish, roundCents(app.contractSumToDate - t.totalEarnedLessRetainage));

  // Stored material is retained at the same rate and reported on its own line.
  const withStored: AIAPayApplication = {
    ...app,
    lines: [{ ...app.lines[0], materialsPresentlyStored: 500 }],
  };
  const ts = computeAIATotals(withStored);
  close('stored material retainage is split out', ts.retainageOnStored, roundCents(500 * 0.075));
  close('…and included in the total', ts.totalRetainage, roundCents(ts.retainageOnCompleted + ts.retainageOnStored));
}

// ── MISS-04 — a deductive change-order line must not be over-withheld ──────
// A G703 schedule of values legitimately carries credit lines (a deleted scope,
// a negotiated deduct), and app/aia-pay-app.tsx sanitises "This Period" with
// /[^0-9.-]/ — the minus is deliberately kept — and applies no floor. Flooring
// the shared retainage basis at zero made the certificate withhold 5% of the
// framing line while withholding NOTHING against the credit, over-withholding
// by pct x |credit| and under-certifying the payment due by the same amount.
{
  const withCredit: AIAPayApplication = {
    applicationNumber: 1, applicationDate: '2026-03-01', periodTo: '2026-03-01',
    ownerName: 'Owner', contractorName: 'GC', projectName: 'P',
    originalContractSum: 200_000, netChangeByCO: -5_000, contractSumToDate: 195_000,
    retainagePercent: 5, lessPreviousCertificates: 0,
    lines: [
      { id: 'a', itemNo: '1', description: 'Framing', scheduledValue: 200_000, fromPreviousApp: 0, thisPeriod: 195_000, materialsPresentlyStored: 0, retainagePercent: 5 },
      { id: 'b', itemNo: '2', description: 'CO-2 credit — stone deleted', scheduledValue: -5_000, fromPreviousApp: 0, thisPeriod: -5_000, materialsPresentlyStored: 0, retainagePercent: 5 },
    ],
  };
  const tc = computeAIATotals(withCredit);
  close('the credit line reduces the withholding (5% of 190,000, not of 195,000)',
    tc.totalRetainage, 9_500);
  close('…so the certificate does not over-withhold $250', tc.currentPaymentDue, 180_500);
  close('…and the G703 retainage column on the credit line is -250, not 0',
    retainageOnWorkValue(withCredit.lines[1].fromPreviousApp + withCredit.lines[1].thisPeriod, 5), -250);

  // A credit that swings the whole application negative still foots.
  const allCredit: AIAPayApplication = {
    ...withCredit,
    lines: [{ ...withCredit.lines[1] }],
  };
  const ta = computeAIATotals(allCredit);
  close('a credit-only application retains a negative amount', ta.totalRetainage, -250);
  close('…and line 6 still equals line 4 − line 5', ta.totalEarnedLessRetainage, -4_750);
}

// ── MISS-04 — naming the tax basis is an accusation, so it must be earned ───
// The first attempt at this banner compared the STORED retention against the
// LIVE one recomputed from editable screen state, so any ordinary edit printed
// "which included sales tax" — including on invoices carrying no sales tax at
// all. taxBasisRetentionOverhold reads STORED columns only and fires only when
// the stored figure IS the taxed-total figure.
{
  const row = (o: Partial<{ subtotal: number; totalDue: number; retentionPercent: number; retentionAmount: number }>) => ({
    subtotal: 75_595, totalDue: 81_264.625, retentionPercent: 5, retentionAmount: 4_063.2312500000003, ...o,
  });

  const houston = taxBasisRetentionOverhold(row({}));
  eq('the live Houston row is identified', houston !== null, true);
  close('…stored, to the cent', houston?.stored ?? -1, 4_063.23);
  close('…corrected onto the work basis', houston?.corrected ?? -1, 3_779.75);
  close('…and the overhold is the retainage taken out of sales tax', houston?.overheld ?? -1, 283.48);

  // The zero-tax case the first predicate got wrong: subtotal 10,000, no tax,
  // stored 500 that was ALWAYS on the work basis. The GC edits the percentage
  // to 10 → the live figure becomes 1,000, but the ROW is still honest.
  eq('a zero-tax invoice is never accused, whatever the GC types',
    taxBasisRetentionOverhold({ subtotal: 10_000, totalDue: 10_000, retentionPercent: 5, retentionAmount: 500 }), null);
  // Adding a $2,000 line item, or moving a progress invoice 30% → 40%, moved
  // the LIVE figure and used to trip the banner. Neither touches the row.
  eq('a taxed invoice already on the work basis is not accused',
    taxBasisRetentionOverhold({ subtotal: 10_000, totalDue: 10_750, retentionPercent: 5, retentionAmount: 500 }), null);
  // An amount that matches neither basis is unexplained — which is not the same
  // as tax-based, and the app must not say it is.
  eq('an unexplained amount is left alone, not blamed on tax',
    taxBasisRetentionOverhold({ subtotal: 10_000, totalDue: 10_750, retentionPercent: 5, retentionAmount: 612.34 }), null);
  eq('no stored amount → nothing to say',
    taxBasisRetentionOverhold({ subtotal: 10_000, totalDue: 10_750, retentionPercent: 5 }), null);
  eq('no retention percent → nothing to say',
    taxBasisRetentionOverhold({ subtotal: 10_000, totalDue: 10_750, retentionAmount: 500 }), null);
  eq('0% retention → nothing to say',
    taxBasisRetentionOverhold({ subtotal: 10_000, totalDue: 10_750, retentionPercent: 0, retentionAmount: 0 }), null);
  eq('a NaN column is not an accusation',
    taxBasisRetentionOverhold({ subtotal: NaN, totalDue: 10_750, retentionPercent: 5, retentionAmount: 537.5 }), null);

  // Applying the repair makes the row stop reporting.
  const fixed = row({ retentionAmount: houston?.corrected ?? 0 });
  eq('after the repair the row no longer reports a tax basis',
    taxBasisRetentionOverhold(fixed), null);
  // And the repaired row can be released to zero — the defect the compute-only
  // fix left behind was $283.48 of retention the Retention screen showed as
  // pending forever while the invoice screen hid the release button.
  close('…and the repaired stored amount is exactly what a full release can clear',
    roundCents((houston?.corrected ?? 0) - retainageOnWorkValue(75_595, 5)), 0);
}

// ── MONEY-05 — the stored column never sets the amount a client is asked for ─
//
// MISS-04 fixed the BASIS the editor computes retainage on; every shared reader
// kept trusting the STORED `retentionAmount`, so the founder's live invoice #1
// read $77,484.88 on the invoice screen and the Stripe pay-link row while
// Summary's NEEDS YOU line, the A/R aging, cash flow, the portal and the webhook
// all read $77,201.39. The row below is production, verbatim (read-only SELECT,
// 2026-09-07): subtotal 75,595 / tax 5,669.625 / total_due 81,264.625 / 5% /
// stored retention 4,063.2312500000003 — a stored figure that is exactly 5% of
// the TAX-INCLUSIVE total.
{
  const houston: Invoice = {
    id: 'd8f3e7a8', number: 1, projectId: 'phone-booth', type: 'progress',
    issueDate: '2026-08-01T12:00:00.000Z', dueDate: '2026-08-31T12:00:00.000Z',
    paymentTerms: 'net_30', notes: '', lineItems: [],
    subtotal: 75_595, taxRate: 7.5, taxAmount: 5_669.625, totalDue: 81_264.625,
    amountPaid: 0, status: 'sent', payments: [],
    retentionPercent: 5, retentionAmount: 4_063.2312500000003, retentionReleased: 0,
    createdAt: '2026-08-01', updatedAt: '2026-08-01',
  } as unknown as Invoice;

  close('the withholding is 5% of the work value', effectiveRetentionHeld(houston), 3_779.75);
  close('…and nothing has been released, so that is what is held',
    pendingRetentionHeld(houston), 3_779.75);
  close('the stored column is NOT what the client is asked for',
    netBalanceDue(houston), 77_484.88);
  close('…and the two halves foot to the cent-rounded total',
    roundCents(pendingRetentionHeld(houston) + netBalanceDue(houston)), 81_264.63);
  eq('the invoice is not settled at zero paid', invoiceIsSettled(houston), false);
  eq('…paying the $77,484.88 the screen shows settles it',
    invoiceIsSettled({ ...houston, amountPaid: 77_484.88 }), true);
  eq('…paying the old stored-basis $77,201.39 does not',
    invoiceIsSettled({ ...houston, amountPaid: 77_201.39 }), false);

  // The pay application for the same job has always used the work basis; now
  // the invoice agrees with it, which is what MISS-04 set out to achieve and
  // MONEY-05 finished.
  close('the G702 certificate withholds the same figure',
    retainageOnWorkValue(75_595, retainagePercentForInvoice(houston)), 3_779.75);

  // The WIP report a banker reads must hold the same figure — it is a real
  // reader, not a re-implementation.
  const project = {
    id: 'phone-booth', name: 'Houston Phone Booth Ad', status: 'active',
    startDate: '2026-07-01', schedule: { tasks: [] },
  } as unknown as Project;
  const wip = computeWIPReport([project], [houston], [], [] as Commitment[]);
  close('utils/financialReports WIP retainage holds $3,779.75',
    wip.rows[0]?.retainageHeld ?? -1, 3_779.75, 0.005);

  // And the banner that offers to repair the ROW still fires — the money agrees
  // now, but the saved column is still on the old basis until someone fixes it.
  const flagged = taxBasisRetentionOverhold(houston);
  eq('the row is still flagged as stored on the tax basis', flagged !== null, true);
  close('…and the repair writes exactly what every reader already computes',
    flagged?.corrected ?? -1, effectiveRetentionHeld(houston));
  eq('…so applying it changes no money anywhere',
    netBalanceDue({ ...houston, retentionAmount: flagged?.corrected }), netBalanceDue(houston));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
