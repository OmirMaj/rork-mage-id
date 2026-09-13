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
  reconcileAIASov,
  carryForwardPriorLines,
  buildAIAPayAppHtml,
  nextApplicationNumber,
  selectPriorApplication,
  installStoredMaterialOnLine,
  findOverBilledLines,
  splitApprovedCOsByPeriod,
  changeOrderApprovalDate,
  summarizeChangeOrders,
  storedRetainagePercentForLine,
  moveSovLine,
  renumberSovLines,
  newSovLine,
  applicationFromSavedRecord,
  sovLineDeletionRefusal,
  claimInitKey,
  sovLineToSaved,
  savedLineToSov,
  payAppEditability,
  payAppReviewNotice,
  coFiguresAdvice,
  resolveSovBasis,
  totalOverBill,
  lineOverBill,
  applyApprovedCOsToApplication,
  mergeRefreshedContract,
  isCalendarDay,
  type AIAPayApplication,
  type AIASOVLine,
} from '../utils/aiaBilling';
import { buildPortalSnapshot } from '../utils/portalSnapshot';
import { aiaRowToSaved, savedToAiaRow, aiaTotalsFromLines } from '../utils/projectContextPure';
import type { SavedAIAPayApp } from '../types';
import { changeOrderBillKey } from '../utils/changeOrderBilling';
// AIA-F11: the canonical at-cost rule and the canonical total recompute, so the
// two estimate writers below are checked against the estimator's own contract
// rather than against a hand-copied formula.
import { isAtCostLine, recomputeEstimate } from '../utils/copilot/estimateEdit/estimateOps';
import { billFromEstimateUnitPrice } from '../utils/billFromEstimateCore';
import { getEffectiveStartingBalance, generateForecast, calculateSummary } from '../utils/cashFlowEngine';
import { computeWIPReport } from '../utils/financialReports';
import type { Invoice, Project, Commitment, ChangeOrder } from '../types';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// The webhook's own money rules, injected into the lifted `creditInvoice` so it
// runs against the same functions production runs against rather than stubs.
import {
  toCents2,
  effectiveRetention,
  ledgerFrom,
  applyLedgerEntry,
  settlementStatus,
  netPayable,
} from '../supabase/functions/_shared/paymentMath';

// Declared locally rather than pulled from `bun-types`: this repo has no bun
// type package installed, and without this `npx tsc --noEmit` fails with TS2867
// "Cannot find name 'Bun'". Same pattern as scripts/validate-stripe-webhook-math.ts:46.
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string };
};

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

  // NO COST PICTURE AT ALL → 0%, NEVER SCHEDULE PROGRESS (axis 7, audit
  // 2026-09-11 — this assertion used to pin the opposite and had to be
  // INVERTED, not deleted).
  //
  // computeWIPReport used to fall back to the AVERAGE TASK PROGRESS of the
  // project schedule whenever it had no cost picture, so the job below — two
  // tasks at 30% and 70%, nothing spent — reported 50% complete, $275,000
  // earned and $275,000 unbilled here while /wip-report reported 0% and $0 for
  // the same job. That is a THIRD percent-complete basis, and it is
  // schedule-basis revenue recognition on a document that names itself
  // cost-to-cost — on the account most likely to have it (a new one, with a
  // schedule built and no cost entered yet).
  //
  // Schedule progress is a DIAGNOSTIC, never a revenue basis: it reaches the
  // WIP screens as utils/wip.flagWipRow's `evm` argument, which raises a
  // divergence flag when cost-complete and schedule-complete disagree. It does
  // not set percent complete on either schedule.
  const scheduled = { ...project, schedule: { tasks: [{ progress: 30 }, { progress: 70 }] } } as unknown as Project;
  const noCost = computeWIPReport([scheduled], [billed(0)], [], []).rows[0];
  close('with no cost recorded, percent complete is 0 — the schedule is not a revenue basis',
    noCost.percentComplete, 0, 0.01);
  close('…so nothing is reported as earned', noCost.earnedRevenue ?? -1, 0, 0.01);
  close('…and nothing as unbilled', noCost.unbilled, 0, 0.01);
  // …and the average task progress it used to print (50) is still 50, so this
  // assertion is pinning the CHANGE and not an accident of the fixture.
  close('…while the schedule average it used to print was 50',
    (scheduled.schedule?.tasks ?? []).reduce((s, t) => s + t.progress, 0)
      / Math.max(1, (scheduled.schedule?.tasks ?? []).length),
    50, 0.01);
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

// ── The G702 must not open at 100% Complete on a partial billing ───────────
// App-experience audit 2026-09-07, "Do next" #3. seedAIAPayApplicationFromInvoice
// set column C (Scheduled Value) and column E (This Period) from the SAME
// invoice line, so computeAIATotals divided a number by itself and every
// certificate read 100% Complete while Contract Sum to Date stated the full
// contract and Balance to Finish stated the remainder. Four numbers on one
// page that cannot all be true — on the document a bank funds against and a
// surety underwrites, over the GC's signature.
{
  const estimateProject = (): Project => ({
    id: 'p1', name: 'Henderson', status: 'in_progress', estimate: null,
    linkedEstimate: {
      id: 'e1', globalMarkup: 0, baseTotal: 400_000, markupTotal: 100_000,
      grandTotal: 500_000, createdAt: '2026-01-01',
      items: [
        { materialId: 'm1', name: 'Framing', category: 'Structure', unit: 'ls', quantity: 1, unitPrice: 300_000, bulkPrice: 300_000, markup: 0, usesBulk: false, lineTotal: 300_000, supplier: '' },
        { materialId: 'm2', name: 'Finishes', category: 'Interior', unit: 'ls', quantity: 1, unitPrice: 200_000, bulkPrice: 200_000, markup: 0, usesBulk: false, lineTotal: 200_000, supplier: '' },
      ],
    },
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
  } as unknown as Project);

  const inv = (lineItems: unknown[], over: Record<string, unknown> = {}): Invoice => ({
    id: 'inv1', number: 7, projectId: 'p1', type: 'progress',
    issueDate: '2026-03-01', dueDate: '2026-03-31', paymentTerms: 'net_30', notes: '',
    lineItems, subtotal: 0, taxRate: 0, taxAmount: 0, totalDue: 0, amountPaid: 0,
    status: 'sent', payments: [], retentionPercent: 5,
    createdAt: '2026-03-01', updatedAt: '2026-03-01', ...over,
  } as unknown as Invoice);

  const brand = { companyName: 'MAGE' } as never;

  // A Bill-from-Estimate draw: 30% of the $300k framing line, on a $500k job.
  const partial = seedAIAPayApplicationFromInvoice(
    inv([{ id: 'l1', name: 'Framing', description: '', quantity: 1, unit: 'ls', unitPrice: 90_000, total: 90_000, sourceEstimateItemId: 'm1', billedPercent: 30 }]),
    estimateProject(), [], brand);
  const partialTotals = computeAIATotals(partial);

  // `?? -1` rather than a bare index: a regression that drops SOV lines should
  // report a wrong number, not crash the validator two assertions in and hide
  // everything after it.
  const at = (a: AIAPayApplication, i: number) => a.lines[i] ?? { scheduledValue: -1, thisPeriod: -1, description: '(missing)' };

  eq('the schedule of values comes from the contract, not from one invoice',
    partial.sovBasis, 'linked_estimate');
  eq('…so every estimate line is on the G703, billed or not', partial.lines.length, 2);
  close('column C is the whole framing line', at(partial, 0).scheduledValue, 300_000);
  close('column E is only what this invoice bills', at(partial, 0).thisPeriod, 90_000);
  close('an unbilled contract line carries 0 this period', at(partial, 1).thisPeriod, 0);
  // THE DEFECT, as one number. Pre-fix this read 100.
  close('a $90,000 draw on a $500,000 contract certifies 18% complete, not 100%',
    partialTotals.percentComplete, 18, 1e-9);
  close('…and the SOV total foots to Contract Sum to Date',
    partialTotals.totalScheduledValue, partial.contractSumToDate);
  eq('…so the reconciliation check is clean', reconcileAIASov(partial).reconciled, true);
  close('Balance to Finish is the rest of the contract, net of retainage',
    partialTotals.balanceToFinish, roundCents(500_000 - partialTotals.totalEarnedLessRetainage));

  // A native-editor progress invoice stores FULL line totals and scales once at
  // the invoice level, so column C is the stored total and column E is the
  // scaled share — the opposite unit convention from the case above.
  const native = seedAIAPayApplicationFromInvoice(
    inv([{ id: 'l1', name: 'Framing', description: '', quantity: 1, unit: 'ls', unitPrice: 300_000, total: 300_000, sourceEstimateItemId: 'm1' }],
      { progressPercent: 25 }),
    estimateProject(), [], brand);
  close('a native 25% progress line bills a quarter of the contract line',
    at(native, 0).thisPeriod, 75_000);
  close('…against the full scheduled value', at(native, 0).scheduledValue, 300_000);
  close('…for 15% of a $500,000 contract', computeAIATotals(native).percentComplete, 15, 1e-9);

  // A FINAL billing legitimately reads 100% — the fix must not make that
  // impossible, or a closeout certificate would understate itself.
  const final = seedAIAPayApplicationFromInvoice(
    inv([
      { id: 'l1', name: 'Framing', description: '', quantity: 1, unit: 'ls', unitPrice: 300_000, total: 300_000, sourceEstimateItemId: 'm1', billedPercent: 100 },
      { id: 'l2', name: 'Finishes', description: '', quantity: 1, unit: 'ls', unitPrice: 200_000, total: 200_000, sourceEstimateItemId: 'm2', billedPercent: 100 },
    ], { type: 'full' }),
    estimateProject(), [], brand);
  close('a final billing still certifies 100% complete',
    computeAIATotals(final).percentComplete, 100, 1e-9);

  // An approved change order is its own CONTRACT line — it belongs in column C
  // whether or not this invoice bills it, because Contract Sum to Date already
  // includes it. The unbilled case is the one that proves the CO branch runs:
  // when the invoice DOES carry the CO, an appended off-contract line would
  // produce identical output, so that case alone tests nothing.
  const co = { id: 'co1', number: 2, projectId: 'p1', description: 'Add deck', changeAmount: 25_000, status: 'approved' } as unknown as ChangeOrder;
  const coUnbilled = seedAIAPayApplicationFromInvoice(
    inv([{ id: 'l1', name: 'Framing', description: '', quantity: 1, unit: 'ls', unitPrice: 90_000, total: 90_000, sourceEstimateItemId: 'm1', billedPercent: 30 }]),
    estimateProject(), [co], brand);
  eq('an approved CO is on the G703 even before it is billed', coUnbilled.lines.length, 3);
  close('…at its change amount', at(coUnbilled, 2).scheduledValue, 25_000);
  close('…with nothing billed against it yet', at(coUnbilled, 2).thisPeriod, 0);
  eq('…and it is named as the change order it is',
    /^CO #2/.test(at(coUnbilled, 2).description), true);
  close('…so column C totals the CO-revised contract',
    computeAIATotals(coUnbilled).totalScheduledValue, 525_000);
  eq('…and the certificate reconciles', reconcileAIASov(coUnbilled).reconciled, true);

  // Billed on this invoice, it lands on that same row rather than a duplicate.
  const withCO = seedAIAPayApplicationFromInvoice(
    inv([{ id: 'l1', name: 'CO #2 — Add deck', description: '', quantity: 1, unit: 'lump', unitPrice: 25_000, total: 25_000, sourceEstimateItemId: changeOrderBillKey('co1'), billedPercent: 100 }]),
    estimateProject(), [co], brand);
  eq('billing the CO does not create a second row for it', withCO.lines.length, 3);
  close('…it is charged on the CO row', at(withCO, 2).thisPeriod, 25_000);
  close('…and the SOV still foots to the CO-revised contract',
    computeAIATotals(withCO).totalScheduledValue, 525_000);
  eq('…so the certificate reconciles', reconcileAIASov(withCO).reconciled, true);

  // Money that was billed must never fall off the certificate: an invoice line
  // matching no contract line is appended rather than dropped, and the
  // resulting overage is surfaced instead of printed silently.
  const withExtra = seedAIAPayApplicationFromInvoice(
    inv([
      { id: 'l1', name: 'Framing', description: '', quantity: 1, unit: 'ls', unitPrice: 90_000, total: 90_000, sourceEstimateItemId: 'm1', billedPercent: 30 },
      { id: 'l9', name: 'T&M dig-out', description: 'unforeseen rock', quantity: 1, unit: 'ls', unitPrice: 4_000, total: 4_000 },
    ]),
    estimateProject(), [], brand);
  eq('an off-contract line is added to the G703, not dropped', withExtra.lines.length, 3);
  close('…at what it billed', at(withExtra, 2).thisPeriod, 4_000);
  eq('…and the SOV no longer foots, which the screen must say',
    reconcileAIASov(withExtra).reconciled, false);
  close('…by exactly the off-contract amount', reconcileAIASov(withExtra).difference, 4_000);

  // No linked estimate: column C can only be reconstructed from this invoice.
  // That is honest, reported, and still not 100% on a partial draw.
  const bare = { id: 'p2', name: 'Bare', status: 'in_progress', estimate: { grandTotal: 500_000 } } as unknown as Project;
  const reconstructed = seedAIAPayApplicationFromInvoice(
    inv([{ id: 'l1', name: 'Framing', description: '', quantity: 1, unit: 'ls', unitPrice: 90_000, total: 90_000, billedPercent: 30 }]),
    bare, [], brand);
  eq('with no linked estimate the basis says so', reconstructed.sovBasis, 'invoice_lines');
  close('…column C grosses the billed line back up', at(reconstructed, 0).scheduledValue, 300_000);
  close('…column E stays the draw', at(reconstructed, 0).thisPeriod, 90_000);
  eq('…and the gap to the contract is flagged, not hidden',
    reconcileAIASov(reconstructed).reconciled, false);
  close('…the SOV covers only the scope this invoice touched',
    reconcileAIASov(reconstructed).difference, -200_000);

  // The NAME fallback. Invoices written before `sourceEstimateItemId` existed
  // carry no key, so column E is attributed by name — the same fallback
  // app/bill-from-estimate.tsx uses to compute already-billed. Lose it and
  // those lines match nothing, get APPENDED as off-contract rows, and column C
  // states the contract PLUS the scope already in it: a G703 that over-foots
  // Contract Sum to Date on every pre-field invoice in the account.
  const preField = seedAIAPayApplicationFromInvoice(
    inv([{ id: 'l1', name: 'Framing', description: '', quantity: 1, unit: 'ls', unitPrice: 90_000, total: 90_000, billedPercent: 30 }]),
    estimateProject(), [], brand);
  eq('a pre-sourceEstimateItemId line matches its contract line by name',
    preField.lines.length, 2);
  close('…and is charged on that line, not appended as new contract value',
    at(preField, 0).thisPeriod, 90_000);
  eq('…so the SOV still foots', reconcileAIASov(preField).reconciled, true);

  // SOV line ids must be UNIQUE. app/aia-pay-app.tsx renders rows with
  // `key={line.id}` and edits them with `lines.map(l => l.id === lineId ? …)`,
  // so two rows sharing an id means typing this period's draw into one row
  // silently writes the same dollars into the other. The merge branch of
  // app/(tabs)/estimate/full.tsx handleConfirmLink concatenates two item lists,
  // so one materialId genuinely can appear twice on a linked estimate.
  const mergedProject = {
    id: 'p3', name: 'Merged', status: 'in_progress', estimate: null,
    linkedEstimate: {
      id: 'e2', globalMarkup: 0, baseTotal: 450_000, markupTotal: 0,
      grandTotal: 450_000, createdAt: '2026-01-01',
      items: [
        { materialId: 'm1', name: 'Framing', category: 'S', unit: 'ls', quantity: 1, unitPrice: 300_000, bulkPrice: 300_000, markup: 0, usesBulk: false, lineTotal: 300_000, supplier: '' },
        { materialId: 'm1', name: 'Framing', category: 'S', unit: 'ls', quantity: 1, unitPrice: 150_000, bulkPrice: 150_000, markup: 0, usesBulk: false, lineTotal: 150_000, supplier: '' },
      ],
    },
  } as unknown as Project;
  const merged = seedAIAPayApplicationFromInvoice(
    inv([{ id: 'l1', name: 'Framing', description: '', quantity: 1, unit: 'ls', unitPrice: 30_000, total: 30_000, sourceEstimateItemId: 'm1', billedPercent: 10 }]),
    mergedProject, [], brand);
  eq('a merged estimate with a repeated material still gets two SOV rows',
    merged.lines.length, 2);
  eq('…with DISTINCT ids, or editing one row would edit the other',
    new Set(merged.lines.map(l => l.id)).size, merged.lines.length);
  close('…and the draw lands on exactly one of them',
    merged.lines.reduce((t, l) => t + l.thisPeriod, 0), 30_000);

  // A degenerate billedPercent must not divide by zero or invent contract value.
  const zeroPct = seedAIAPayApplicationFromInvoice(
    inv([{ id: 'l1', name: 'X', description: '', quantity: 1, unit: 'ls', unitPrice: 1_000, total: 1_000, billedPercent: 0 }]),
    bare, [], brand);
  close('billedPercent 0 grosses up to the line itself, never Infinity',
    at(zeroPct, 0).scheduledValue, 1_000);
  eq('…and no G702 total is non-finite',
    Object.values(computeAIATotals(zeroPct)).every(Number.isFinite), true);
}

// ── Carry-forward must land on the RIGHT contract line ────────────────────
// Review 2026-09-07. buildAIASovLines changed what `itemNo` counts: it now
// numbers the ESTIMATE's lines, then the approved COs, then whatever the
// invoice billed off-contract — where it used to number the invoice's own
// lines. app/aia-pay-app.tsx carries the prior period's billed-through onto
// the new application, and it matched on itemNo alone, so:
//
//   • every pay app SAVED BEFORE this change carries old-scheme numbers, and
//     the next period lands $X of "billed through" on whichever contract line
//     now happens to sit at that position;
//   • approving one CO between periods shifts every off-contract row by one.
//
// The G702 cover still totals correctly — Σ fromPreviousApp is unchanged —
// which is exactly why nobody would catch it. The G703 is what is wrong: a
// line can be pushed past its own scheduled value, and every per-line %
// complete and balance-to-finish on the continuation sheet is a fiction.
{
  const sov = (id: string, itemNo: string, sched: number, from: number, per: number): AIASOVLine => ({
    id, itemNo, description: id, scheduledValue: sched,
    fromPreviousApp: from, thisPeriod: per, materialsPresentlyStored: 0, retainagePercent: 10,
  });
  const billedThrough = (ls: AIASOVLine[]) => ls.map(l => `${l.id}=${l.fromPreviousApp}`).join(',');

  // OLD-SCHEME PRIOR. Period 1 was numbered over the invoice, which billed
  // only "Interiors", so its itemNo "1" is Interiors — while the new period's
  // itemNo "1" is Sitework, the first line of the estimate.
  const oldPrior = [{ id: 'l77', itemNo: '1', fromPreviousApp: 0, thisPeriod: 20_000 }];
  const fresh = [sov('sov_m1', '1', 60_000, 0, 0), sov('sov_m2', '2', 40_000, 0, 0)];
  eq('an old-scheme prior still carries forward — by itemNo, as it always did',
    billedThrough(carryForwardPriorLines(fresh, oldPrior)), 'sov_m1=20000,sov_m2=0');

  // NEW-SCHEME PRIOR, with a CO approved in between. Under itemNo matching the
  // CO row (itemNo 3) would inherit the T&M row's $4,000.
  const newPrior = [
    { id: 'sov_m1', itemNo: '1', fromPreviousApp: 0, thisPeriod: 30_000 },
    { id: 'sov_m2', itemNo: '2', fromPreviousApp: 0, thisPeriod: 5_000 },
    { id: 'l9', itemNo: '3', fromPreviousApp: 0, thisPeriod: 4_000 },
  ];
  const afterCO = [
    sov('sov_m1', '1', 60_000, 0, 0),
    sov('sov_m2', '2', 40_000, 0, 0),
    sov('sov_co:co1', '3', 25_000, 0, 0),
    sov('l9', '4', 4_000, 0, 0),
  ];
  const carriedAfterCO = carryForwardPriorLines(afterCO, newPrior);
  eq('a CO approved between periods does not inherit the previous row\u2019s billings',
    billedThrough(carriedAfterCO),
    'sov_m1=30000,sov_m2=5000,sov_co:co1=0,l9=4000');
  close('…and the cover still totals what was actually billed through',
    carriedAfterCO.reduce((t, l) => t + l.fromPreviousApp, 0), 39_000);

  // A prior line must be claimed ONCE. id and itemNo both pointing at it would
  // count the same billed-through twice on the G702 cover.
  const ambiguous = [{ id: 'sov_m1', itemNo: '1', fromPreviousApp: 0, thisPeriod: 30_000 }];
  const twoClaimants = [sov('sov_m1', '9', 60_000, 0, 0), sov('other', '1', 40_000, 0, 0)];
  const claimedOnce = carryForwardPriorLines(twoClaimants, ambiguous);
  close('one prior line is carried onto one new line, never two',
    claimedOnce.reduce((t, l) => t + l.fromPreviousApp, 0), 30_000);
  eq('…and it is the id match that wins, not the position',
    billedThrough(claimedOnce), 'sov_m1=30000,other=0');

  // Nothing to carry is still nothing to carry.
  eq('no prior lines carries nothing', billedThrough(carryForwardPriorLines(fresh, [])),
    'sov_m1=0,sov_m2=0');

  // And the screen uses it rather than keeping its own copy of the matching.
  const payScreen = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'aia-pay-app.tsx'), 'utf8');
  eq('app/aia-pay-app.tsx carries forward through the shared helper',
    /carryForwardPriorLines\(seeded\.lines, priorAIA\.lines\)/.test(payScreen), true);
  eq('…and no longer matches prior lines on itemNo alone',
    /priorByItem/.test(payScreen), false);
}

// ── …and the screen actually shows the reconciliation ─────────────────────
// bun cannot import a .tsx screen. The banner is the interim the audit asked
// for and the only thing standing between a non-footing SOV and a signature.
{
  const screen = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'aia-pay-app.tsx'), 'utf8');
  eq('app/aia-pay-app.tsx computes the SOV reconciliation',
    /reconcileAIASov\(app\)/.test(screen), true);
  // Anchored on the `{` that opens the JSX expression: a `{false && …` or any
  // other short-circuit inserted ahead of the condition breaks the match. The
  // looser form of this check passed while the banner was disabled.
  eq('…and renders a banner when it does not foot',
    /\{sovReconciliation && !sovReconciliation\.reconciled && \(/.test(screen), true);
  eq('…which is actually mounted, not commented out',
    /testID="aia-sov-reconciliation"/.test(screen), true);
  eq('…naming both figures so the GC can see which one is wrong',
    /sovReconciliation\.totalScheduledValue/.test(screen)
    && /sovReconciliation\.contractSumToDate/.test(screen), true);
  eq('…and the SOV says where column C came from',
    /testID="aia-sov-basis"/.test(screen) && /sovBasis === 'linked_estimate'/.test(screen), true);
  // 2026-09-11: the three assertions that used to sit here asserted the
  // OPPOSITE of what now ships. They read "column C is still read-only, so the
  // copy must not send him to edit it here" and were written when the G703 had
  // no add/edit/delete of any kind. It has one now — a schedule of values is
  // negotiated with the owner and organised by CSI division, and without an
  // editor per-line retainage (the entire reason G703 column I exists) and
  // stored-material carry-forward were unreachable. Leaving those guards green
  // would have made them lie about the screen they guard.
  eq('the G703 has a real schedule-of-values editor',
    /testID="aia-add-sov-line"/.test(screen)
    && /testID="aia-renumber"/.test(screen)
    && /aia-move-up-|aia-move-down-/.test(screen)
    && /aia-delete-/.test(screen), true);
  eq('…including the item number, which AIASOVLine documents as "1.0"/"2.1"',
    /testID={`aia-itemno-\$\{line\.id\}`}/.test(screen), true);
  // The refusal moved into utils/aiaBilling.sovLineDeletionRefusal (it used to
  // be a showAlert INSIDE a setApp updater — impure, and only reachable
  // through a renderer). Assert the screen routes through it; the rule itself
  // is executed further down.
  eq('…and deleting a line that has been billed is refused, not silent',
    /sovLineDeletionRefusal\(app\.lines\.find/.test(screen), true);
  eq('…so the reconciliation banner no longer says column C cannot be edited',
    /Scheduled Value cannot be edited on this screen/.test(screen), false);
}

// ── The Retention screen shows every invoice holding money, and says the basis ─
// Audit 2026-09-07, "Worth doing" #27. Two separate defects on one screen:
//
//   (a) it selected invoices on the STORED `retentionPercent` column, so a row
//       holding money via `retentionAmount` alone — a legacy import, or a row
//       whose percent was cleared after the fact — was absent from the one
//       screen whose entire job is "what is still being held from me", while
//       effectiveRetentionHeld went on withholding it everywhere else.
//   (b) the arithmetic has been right since MISS-04 (retainage on the work
//       value, before sales tax) but only app/invoice.tsx ever SAID so, so a
//       client reading "Retention held (5%)" beside a tax-inclusive total
//       multiplied it himself, got a bigger number, and called.
{
  // The arithmetic half, executed rather than regexed: a row with an amount and
  // no percent IS holding money, so it must be in the population.
  const amountOnly = { subtotal: 20_000, retentionAmount: 1_000 };
  close('a row with a stored amount and no percent still holds money',
    effectiveRetentionHeld(amountOnly), 1_000);
  eq('…so a retentionPercent filter would have hidden it',
    ((amountOnly as { retentionPercent?: number }).retentionPercent ?? 0) > 0, false);
  close('a released row drops out of the pending figure, not out of "held"',
    pendingRetentionHeld({ subtotal: 100_000, retentionPercent: 5, retentionReleased: 5_000 }), 0);

  const screen = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'retention.tsx'), 'utf8');
  eq('app/retention.tsx selects on the money held, not on the stored percent',
    /invoices\.filter\(inv => effectiveRetentionHeld\(inv\) > 0\)/.test(screen), true);
  eq('…so the old retentionPercent filter is gone',
    /invoices\.filter\(inv => \(inv\.retentionPercent \?\? 0\) > 0\)/.test(screen), false);
  eq('…and a row with no percent on file does not print a bare "%"',
    /\(inv\.retentionPercent \?\? 0\) > 0[\s\S]{0,120}retainage on file/.test(screen), true);
  eq('the basis is stated on the screen, not only in the invoice editor',
    /testID="retention-basis-note"/.test(screen)
    && /before sales tax/.test(screen), true);
  eq('…and the explainer defines the term for a GC who has never met it',
    /term="Retention \(Retainage\)"/.test(screen), true);
}


// ═══════════════════════════════════════════════════════════════════════════
// AIA G702 / G703 — the 2026-09-11 wave.
//
// Every assertion below encodes one defect that shipped. Where a guard could
// be satisfied by a comment or a dead branch it executes the shipped function
// instead, and where it can only read the screen it anchors on the exact
// syntax the bug had.
// ═══════════════════════════════════════════════════════════════════════════
{
  // Read the CODE, not the prose around it. These files explain the defects
  // they fixed by QUOTING the broken expression, so a guard that greps the raw
  // text goes red on its own documentation — and, worse, a guard asserting the
  // ABSENCE of a bad pattern would go green the day someone deleted the code
  // but left the comment, or red the day someone documented it. Drop block
  // comments and whole-line // and * lines; nothing else, so string literals
  // containing "//" (URLs) survive.
  const codeOnly = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  // Raw, comments and all: the lift-and-execute blocks are delimited by `//`
  // sentinels that codeOnly strips.
  const aiaScreenRaw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'aia-pay-app.tsx'), 'utf8');
  const aiaScreen = codeOnly(aiaScreenRaw);
  const billing = codeOnly(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'utils', 'aiaBilling.ts'), 'utf8'));
  const snapshotSrc = codeOnly(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'utils', 'portalSnapshot.ts'), 'utf8'));
  const portalHtml = codeOnly(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'marketing', 'portal', 'index.html'), 'utf8'));
  const ctx = codeOnly(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'contexts', 'ProjectContext.tsx'), 'utf8'));

  const line = (over: Partial<AIASOVLine> = {}): AIASOVLine => ({
    id: 'l1', itemNo: '1', description: 'Framing',
    scheduledValue: 10_000, fromPreviousApp: 0, thisPeriod: 0,
    materialsPresentlyStored: 0, retainagePercent: 10, ...over,
  });
  const app = (over: Partial<AIAPayApplication> = {}): AIAPayApplication => ({
    applicationNumber: 1, applicationDate: '2026-03-31', periodTo: '2026-03-31',
    ownerName: 'Owner', contractorName: 'GC', projectName: 'Job',
    originalContractSum: 10_000, netChangeByCO: 0, contractSumToDate: 10_000,
    retainagePercent: 10, lessPreviousCertificates: 0, lines: [line()], ...over,
  });

  // ── BLOCKER: the two money fields could not accept a typed number ─────────
  // `value={line.thisPeriod.toFixed(2)}` re-derived the input's text from
  // numeric state on every keystroke, so typing 4500 recorded $4.00 — on
  // "This Period" and on "Stored", the two figures a certificate is made of.
  // These were the only two such bindings in the repo.
  eq('no money TextInput re-derives its own text from numeric state',
    (aiaScreen.match(/value=\{[^}\n]*\.toFixed\(2\)\}/g) ?? [])
      .every(m => m.includes('draft ??')), true);
  eq('…and the exact binding that recorded $4.00 for "4500" is gone',
    /value=\{line\.[A-Za-z]+\.toFixed\(2\)\}/.test(aiaScreen), false);
  eq('…the SOV money fields go through MoneyField',
    /testID={`aia-this-period-\$\{line\.id\}`}/.test(aiaScreen)
    && /testID={`aia-stored-\$\{line\.id\}`}/.test(aiaScreen), true);
  eq('…which holds a raw draft string and re-formats only on blur',
    /const \[draft, setDraft\] = useState<string \| null>\(null\)/.test(aiaScreen)
    && /value=\{draft \?\? value\.toFixed\(2\)\}/.test(aiaScreen)
    && /onBlur=\{\(\) => setDraft\(null\)\}/.test(aiaScreen), true);
  // The contract, executed: the OLD binding re-derives and loses the digits;
  // the NEW one keeps whatever was typed while the field is focused.
  {
    const controlled = (typed: string) => (parseFloat(typed.replace(/[^0-9.-]/g, '')) || 0).toFixed(2);
    let oldText = '';
    for (const ch of '4500') oldText = controlled(oldText + ch);
    eq('the old controlled binding turns "4500" into $4.00', oldText, '4.00');
    let draft: string | null = null;
    let committed = 0;
    for (const ch of '4500') {
      draft = (draft ?? committed.toFixed(2)).replace(/^0\.00$/, '') + ch;
      committed = parseFloat(draft.replace(/[^0-9.-]/g, '')) || 0;
    }
    close('MoneyField commits 4500 from the same keystrokes', committed, 4500);
  }
  eq('column F has quick-percent buttons too, not only column E',
    /testID={`aia-stored-quick-\$\{q\}-\$\{line\.id\}`}/.test(aiaScreen), true);

  // ── BLOCKER: the reopen chain that minted a second live payment link ──────
  // Reopen App #2 on a five-app job → the old code numbered it #6, the saved
  // lookup (keyed on applicationNumber) missed, isLocked went false, and Save
  // minted a SECOND Stripe payment link for already-certified money plus a
  // phantom record that then became payApps[0] for the WIP contract baseline.
  {
    const saved = [
      { applicationNumber: 1, invoiceId: 'inv1' },
      { applicationNumber: 2, invoiceId: 'inv2' },
      { applicationNumber: 5, invoiceId: 'inv5' },
    ];
    eq('reopening a billed period reopens THAT application', nextApplicationNumber(saved, 'inv2'), 2);
    eq('…not a successor to the newest one', nextApplicationNumber(saved, 'inv2') === 6, false);
    eq('a genuinely new period is max + 1', nextApplicationNumber(saved, 'inv9'), 6);
    eq('the first application on a job is #1', nextApplicationNumber([], 'inv1'), 1);
    eq('…and an unsaved period with no invoice still gets the next number',
      nextApplicationNumber(saved, undefined), 6);
  }
  eq('the screen resolves the saved record BY INVOICE, not by application number',
    /savedForProject\.find\(a => a\.invoiceId === invoice\.id\)/.test(aiaScreen), true);
  eq('…and no longer keys the lock on a number it derived itself',
    /getAIAPayAppsForProject\(project\.id\)\.find\(a => a\.applicationNumber === app\.applicationNumber\)/.test(aiaScreen), false);
  eq('…and the application number comes from the pay-app sequence',
    /nextApplicationNumber\(savedForProject, invoice\?\.id\)/.test(aiaScreen), true);
  eq('…which is no longer the invoice number plus one',
    /applicationNumber: priorAIA\.applicationNumber \+ 1/.test(aiaScreen), false);

  // ── "PREVIOUS APPLICATION" MEANS THE PREVIOUS PERIOD ──────────────────────
  // Column D is "Work Completed From Previous Application" and line 7 is
  // "Line 6 from prior Certificate". Ordering by application number alone gave
  // a July certificate August's billed-through, because the period picker
  // sorts newest-first and a GC who certifies #5 then goes back to do #4 is
  // ordinary. Period ordering only became possible once PERIOD TO was a field
  // he fills in rather than the invoice's issue date.
  {
    const saved = [
      { invoiceId: 'inv4', applicationNumber: 4, periodTo: '2026-06-30' },
      { invoiceId: 'inv5', applicationNumber: 5, periodTo: '2026-08-31' },
    ];
    eq('billing JULY after August was certified carries forward from JUNE',
      selectPriorApplication(saved, {
        excludeInvoiceId: 'invJul', thisApplicationNumber: 6, thisPeriodTo: '2026-07-31',
      })?.applicationNumber, 4);
    eq('…and the ordinary sequential case is unchanged',
      selectPriorApplication(saved, {
        excludeInvoiceId: 'invSep', thisApplicationNumber: 6, thisPeriodTo: '2026-09-30',
      })?.applicationNumber, 5);
    eq('reopening #5 carries forward from #4, never from itself',
      selectPriorApplication(saved, {
        excludeInvoiceId: 'inv5', thisApplicationNumber: 5, thisPeriodTo: '2026-08-31',
      })?.applicationNumber, 4);
    // A silently zeroed column D over-bills the owner, so an undated history
    // falls back to the sequence rather than to "no prior application".
    eq('undated records fall back to the sequence, never to nothing',
      selectPriorApplication(saved.map(a => ({ ...a, periodTo: '' })), {
        excludeInvoiceId: 'invNew', thisApplicationNumber: 6, thisPeriodTo: '2026-07-31',
      })?.applicationNumber, 5);
    eq('the first application on a job has no prior',
      selectPriorApplication([], { thisApplicationNumber: 1, thisPeriodTo: '2026-01-31' }), null);
  }
  eq('the screen selects the prior application through the shared helper',
    /selectPriorApplication\(savedForProject, \{/.test(aiaScreen)
    && /thisPeriodTo: effectivePeriodTo/.test(aiaScreen), true);

  // ── BLOCKER: reopening destroyed the certified record ─────────────────────
  eq('a saved application is HYDRATED, never re-derived over',
    /if \(savedForThisInvoice\) \{\s*\n\s*setApp\(applicationFromSaved\(savedForThisInvoice\)\);/.test(aiaScreen), true);
  eq('…and there is a read-only presentation of what was sent',
    /testID="aia-review-banner"/.test(aiaScreen)
    && /testID="aia-reprint"/.test(aiaScreen), true);
  // EVERY mutating handler, by NAME, not a count of six.
  //
  // The assertion this replaces counted occurrences of `if (isReadOnly) return;`
  // and asked for at least six. A count cannot say WHICH handler is guarded: a
  // new mutating handler added without the bail kept the number at six or
  // raised it, and moving the bail off the money handler onto a cosmetic one
  // left it green. This enumerates the handlers that actually call `setApp` and
  // requires each one to refuse before it mutates — measured on the shipped
  // file, so the list cannot go stale.
  {
    const handlers = [...aiaScreenRaw.matchAll(/const (\w+) = useCallback\(([\s\S]*?)\n  \}, \[/g)]
      .map(m => ({ name: m[1], body: m[2] }))
      .filter(h => /\bsetApp\(/.test(h.body));
    // The bail must come BEFORE the first setApp, which is the thing a grep for
    // the string cannot tell you.
    const unguarded = handlers.filter((h) => {
      const bail = h.body.search(/if \(isReadOnly[^)]*\) return\b/);
      return bail < 0 || bail > h.body.indexOf('setApp(');
    }).map(h => h.name);
    eq('…which every handler that mutates the certificate respects, before it mutates',
      [handlers.length >= 10, unguarded], [true, []]);
  }

  // ── THE OTHER HALF: THE WRITES THAT LIVE IN THE JSX, EXECUTED ─────────────
  //
  // The enumeration above walks `const X = useCallback(…)` blocks and the
  // TextInput sweep further down walks `<TextInput>` elements. Thirteen of this
  // screen's writes are neither — an arrow function written inline on a
  // TouchableOpacity or a MoneyField — and both guards were blind to them.
  // Proved: deleting the `!isReadOnly &&` from the notarize toggle, and
  // deleting `disabled={certReadOnly}` from the "Not yet certified — record it"
  // chip, each left a read-only certificate mutable from the screen with the
  // suite green.
  //
  // So RUN them. Every JSX element whose opening tag contains a `setApp(` is
  // executed with the certificate read-only, and passes only if it declares
  // itself disabled/not-editable (that expression is executed too) or its own
  // handler refuses to call setApp. Nothing here is keyed on a flag NAME: a
  // rename that still blocks passes, and a guard that stops blocking fails.
  {
    /** Opening tags, brace-aware so `=>` and nested `{…}` do not end one early. */
    const openingTags = (s: string): string[] => {
      const out: string[] = [];
      for (let i = 0; i < s.length; i++) {
        if (s[i] !== '<' || !/[A-Za-z]/.test(s[i + 1] ?? '')) continue;
        let depth = 0;
        for (let j = i + 1; j < s.length; j++) {
          const c = s[j];
          if (c === '{') depth++;
          else if (c === '}') depth--;
          else if (c === '<' && depth === 0) { i = j - 1; break; }
          else if (c === '>' && depth === 0 && s[j - 1] !== '=') { out.push(s.slice(i, j + 1)); i = j; break; }
        }
      }
      return out;
    };
    /** One prop's expression, brace-balanced. */
    const propExpr = (tag: string, name: string): string | null => {
      const m = new RegExp(`\\b${name}=\\{`).exec(tag);
      if (!m) return null;
      const start = m.index + m[0].length;
      let depth = 1;
      for (let i = start; i < tag.length; i++) {
        if (tag[i] === '{') depth++;
        else if (tag[i] === '}') { depth--; if (depth === 0) return tag.slice(start, i); }
      }
      return null;
    };
    const RESERVED = new Set(['true', 'false', 'null', 'undefined', 'if', 'else', 'return', 'const',
      'let', 'var', 'new', 'typeof', 'in', 'of', 'instanceof', 'function', 'this', 'void', 'delete',
      'do', 'while', 'for', 'switch', 'case', 'break', 'continue', 'default', 'try', 'catch',
      'finally', 'throw', 'class', 'extends', 'super', 'yield', 'await', 'async', 'import',
      'export', 'NaN', 'Infinity']);
    /** Anything the expression reaches for that is not a flag under test: callable,
     *  indexable, truthy — so styles, `totals.currentPaymentDue` and `Math.max`
     *  cannot throw and make a refusal look like a pass. */
    const anyValue: unknown = new Proxy(function () { /* callable */ } as object, {
      get: (_t, k) => (k === Symbol.toPrimitive || k === 'valueOf' ? () => 0
        : k === Symbol.iterator ? undefined : anyValue),
      apply: () => anyValue,
    });
    const run = (expr: string, flags: Record<string, unknown>, setAppSpy: () => void): unknown => {
      const names = [...new Set(expr.match(/[A-Za-z_$][\w$]*/g) ?? [])].filter(n => !RESERVED.has(n));
      const args = names.map(n => (n === 'setApp' ? setAppSpy : n in flags ? flags[n] : anyValue));
      return new Function(...names, `return (${expr});`)(...args);
    };

    const mutatingTags = openingTags(aiaScreen).filter(t => /setApp\(/.test(t));
    // READ-ONLY AND CERTIFICATION-LOCKED — the state of a certificate that has
    // been paid, where nothing on the screen may write.
    const flags = { isReadOnly: true, certReadOnly: true };
    const leaks = mutatingTags.filter((tag) => {
      const disabled = propExpr(tag, 'disabled');
      const editable = propExpr(tag, 'editable');
      if (disabled != null && run(disabled, flags, () => {})) return false;
      if (editable != null && !run(editable, flags, () => {})) return false;
      let mutated = false;
      for (const prop of ['onPress', 'onChangeText', 'onCommit', 'onValueChange']) {
        const expr = propExpr(tag, prop);
        if (expr == null || !/setApp\(/.test(expr)) continue;
        const handler = run(expr, flags, () => { mutated = true; }) as (a?: unknown) => void;
        // A throw before the write is a refusal too.
        try { handler('4500'); } catch { /* refused */ }
      }
      return mutated;
    }).map(t => /testID="([^"]+)"/.exec(t)?.[1] ?? /^<(\w+)/.exec(t)?.[1] ?? '?');
    // The floor is on the SCANNER, not on the screen: if a reformat stops
    // openingTags matching, `leaks` goes empty and this guard would pass while
    // checking nothing. The writes themselves may legitimately migrate into
    // useCallback handlers — where the enumeration above picks them up.
    eq('…and every write that lives in the JSX refuses a read-only certificate too',
      [mutatingTags.length >= 10, leaks], [true, []]);
  }

  // ── REVIEW MODE AND THE READ-ONLY LOCK, EXECUTED ──────────────────────────
  // These two lines used to be computed inline in the screen, so the only
  // coverage they had was a grep for `const isReviewMode =`. An adversarial
  // review replaced the whole expression with `false` — deleting the read-only
  // presentation of a submitted certificate, and separately unlocking every
  // mutating handler on a CERTIFIED pay application — and the guard matched the
  // mutated line character for character and stayed green. The rule is a pure
  // function now and this runs it.
  {
    const e = (o: Partial<Parameters<typeof payAppEditability>[0]>) => payAppEditability({
      hasSavedRecord: true, isLocked: false, editRequested: false, ...o,
    });
    eq('a saved certificate opens in review, not in the editor', e({}).isReviewMode, true);
    eq('…and review mode is read-only', e({}).isReadOnly, true);
    eq('a draft leaves review when the GC asks to edit it',
      [e({ editRequested: true }).isReviewMode, e({ editRequested: true }).isReadOnly], [false, false]);
    eq('a CERTIFIED application can never leave review, however hard he asks',
      [e({ isLocked: true, editRequested: true }).isReviewMode,
        e({ isLocked: true, editRequested: true }).isReadOnly], [true, true]);
    eq('a period that has never been saved is an editor, not a review',
      e({ hasSavedRecord: false }).isReviewMode, false);
    // AMOUNT CERTIFIED is the architect's ANSWER, and it arrives after the
    // application was sent. A GC with Stripe Connect gets a pay link on the
    // first Save, so gating it on isReadOnly made it unreachable on every
    // certificate an architect ever responds to — the exact defect (line 7
    // seeding from the amount applied for) it was built to fix.
    eq('the architect’s response is recordable on a LOCKED certificate',
      e({ isLocked: true }).canRecordCertification, true);
    eq('…and stops being a field once the money has moved',
      e({ isLocked: true, isPaid: true }).canRecordCertification, false);
  }
  // F20 — "no edit-after-send lock". Locking on SEND is the wrong shape: the
  // portal renders portalState.lastSentSnapshot, not live state, so an edit
  // after a send cannot reach the client until the GC sends again — while a
  // hard lock would strand a GC who shared a draft and then found a typo on a
  // screen whose only exit is to bill a period he has not worked. So the screen
  // SAYS it. This executes the wording rather than grepping for it.
  {
    const n = (o: Partial<Parameters<typeof payAppReviewNotice>[0]>) =>
      payAppReviewNotice({ isLocked: false, savedAt: '2026-04-01T00:00:00Z', ...o });
    eq('an unsent saved draft reads as a saved certificate',
      n({}).title, 'Saved certificate');
    eq('a certificate the client already has says so, and says what he sees',
      [n({ portalStatus: 'sent', sentAt: '2026-04-02T00:00:00Z' }).title,
        /client keeps seeing the sent version until you send it again/
          .test(n({ portalStatus: 'sent', sentAt: '2026-04-02T00:00:00Z' }).body)],
      ['Sent to the client', true]);
    eq('…and the edit affordance stops pretending it is a private draft',
      n({ portalStatus: 'sent' }).editLabel, 'Edit and re-send');
    eq('a recalled certificate is a draft again',
      n({ portalStatus: 'recalled' }).title, 'Saved certificate');
    // Stripe holding a live obligation for these exact figures IS a lock, and
    // outranks whatever the portal says.
    eq('a certified certificate still reads as uneditable',
      n({ isLocked: true, portalStatus: 'sent' }).title, 'Certified record');
  }
  eq('…and the review banner renders that notice rather than its own copy',
    /<Text style=\{styles\.reviewBannerTitle\}>\{reviewNotice\.title\}<\/Text>/.test(aiaScreen)
    && /<Text style=\{styles\.reviewBannerBody\}>\{reviewNotice\.body\}<\/Text>/.test(aiaScreen)
    && /<Text style=\{styles\.sovFooterBtnText\}>\{reviewNotice\.editLabel\}<\/Text>/.test(aiaScreen), true);
  // THE SERVER HALF. These three fields ride in the `__mageCertificate` sidecar
  // inside snapshot_totals, and migration 20260728120000 froze snapshot_totals
  // WHOLESALE on any row with certified_at set — which create-payment-link
  // stamps when it mints the link. So un-gating the UI alone would have left
  // every write rejected with check_violation on exactly the certificates the
  // feature exists for. The trigger must strip these three keys before it
  // compares, and nothing else.
  {
    const mig = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase',
      'migrations', '20260911090000_aia_certificate_response_writable.sql'), 'utf8');
    eq('the DB freeze lets the architect’s answer through',
      /#- '\{__mageCertificate,amountCertified\}'/.test(mig)
      && /#- '\{__mageCertificate,certifiedDate\}'/.test(mig)
      && /#- '\{__mageCertificate,certifiedExplanation\}'/.test(mig), true);
    eq('…and still freezes snapshot_totals itself',
      /new_frozen\s+is distinct from old_frozen/.test(mig)
      && /new\.snapshot_totals\s+is distinct from old\.snapshot_totals/.test(mig) === false, true);
    eq('…and every other column the 2026-07-28 lock protects',
      ['lines', 'contract_sum_to_date', 'retainage_percent', 'less_previous_certificates',
        'net_change_by_co', 'original_contract_sum', 'certified_at']
        .every(c => new RegExp(`new\\.${c}\\s+is distinct from old\\.${c}`).test(mig)), true);
    // The sidecar key the trigger strips must be the key the app writes.
    eq('…and it names the field utils/projectContextPure actually writes',
      /const AIA_EXTRAS_FIELD = '__mageCertificate';/.test(
        readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'utils', 'projectContextPure.ts'), 'utf8'),
      ), true);
  }

  eq('the screen derives both flags from that helper rather than inline',
    /const \{ isReviewMode, isReadOnly, canRecordCertification \} = payAppEditability\(\{/.test(aiaScreen)
    && /const certReadOnly = !canRecordCertification;/.test(aiaScreen), true);
  eq('…and the architect’s response has its own write path, not handleSave',
    /const handleSaveCertification = useCallback/.test(aiaScreen)
    && /testID="aia-save-certification"/.test(aiaScreen)
    && /amountCertified: app\.amountCertified,/.test(aiaScreen), true);

  // ── COLUMN F SURVIVES THE TWO SCREEN-LOCAL MAPPERS ────────────────────────
  // The blocker this wave was opened for. Both mappers used to be inline
  // object literals in app/aia-pay-app.tsx, and a review reinstated the bug in
  // each of them — `materialsPresentlyStored: 0` on save, and again on
  // hydrate — with the entire guard suite still green, because every column-F
  // assertion tested carryForwardPriorLines or the DB mappers instead.
  {
    const l: AIASOVLine = {
      id: 'l1', itemNo: '3.1', description: 'Windows', scheduledValue: 80_000,
      fromPreviousApp: 12_000, thisPeriod: 5_000, materialsPresentlyStored: 42_000,
      retainagePercent: 10, storedRetainagePercent: 0, linkedTaskId: 't9',
    };
    close('saving a certificate keeps the stored-materials figure the GC typed',
      sovLineToSaved(l).materialsPresentlyStored, 42_000);
    // …and the screen must actually GO THROUGH them. Executing the helpers
    // proves nothing if the screen keeps its own copy: re-inlining the mapper
    // in buildSavedRecord with `materialsPresentlyStored: 0` is precisely the
    // mutation that left the previous suite green.
    eq('the screen has no line mapper of its own, in either direction',
      /lines: app\.lines\.map\(sovLineToSaved\),/.test(aiaScreen)
      && /applicationFromSavedRecord\(rec\)/.test(aiaScreen)
      // The two RECORD-boundary mappers specifically: `app.lines` on the way
      // out and `rec.lines` on the way in. (`prev.lines.map(...)` is the
      // in-memory edit handlers, which patch one line and are not a boundary.)
      && (aiaScreen.match(/lines: (?:app|rec)\.lines\.map\([^)\n]*/g) ?? [])
        .every(m => /map\(sovLineToSaved|map\(savedLineToSov/.test(m)), true);
    close('…and reopening it does too', savedLineToSov(sovLineToSaved(l)).materialsPresentlyStored, 42_000);
    eq('…along with every other field on the line, both ways',
      savedLineToSov(sovLineToSaved(l)), l);
  }

  // ── HYDRATE IS NOT A RE-DERIVATION ────────────────────────────────────────
  // applicationFromSaved was a 25-field object literal written by hand. It
  // silently omitted `sovBasis`, so the provenance note under the schedule of
  // values took its else branch on EVERY reopened certificate and told a GC
  // whose job HAS a linked estimate to go and link one — the honesty
  // instrumentation this feature is differentiated by, inverted by the fix
  // that was supposed to preserve the record.
  {
    const rec: SavedAIAPayApp = {
      id: 'a1', projectId: 'p1', invoiceId: 'inv1', applicationNumber: 3,
      applicationDate: '2026-04-02', periodTo: '2026-03-31', periodFrom: '2026-03-01',
      contractDate: '2025-11-14',
      ownerName: 'O', contractorName: 'GC', architectName: 'A', projectName: 'Job',
      projectLocation: 'Austin', contractForDescription: 'Remodel',
      originalContractSum: 100_000, netChangeByCO: 30_000, contractSumToDate: 130_000,
      retainagePercent: 10, storedRetainagePercent: 0, lessPreviousCertificates: 20_000,
      amountCertified: 58_200, certifiedDate: '2026-04-08', certifiedExplanation: 'Backcharge',
      changeOrderSummary: {
        priorAdditions: 50_000, priorDeductions: 0, thisPeriodAdditions: 0,
        thisPeriodDeductions: 20_000, totalAdditions: 50_000, totalDeductions: 20_000,
        netChange: 30_000,
      },
      notarize: true, notaryState: 'Texas', notaryCounty: 'Harris',
      sovBasis: 'linked_estimate',
      lines: [{
        id: 'l1', itemNo: '1', description: 'Framing', scheduledValue: 100_000,
        fromPreviousApp: 10_000, thisPeriod: 5_000, materialsPresentlyStored: 42_000,
        retainagePercent: 10, storedRetainagePercent: 0,
      }],
      notes: 'n',
      totals: {
        totalScheduledValue: 100_000, totalCompletedAndStored: 57_000, totalRetainage: 1_500,
        totalEarnedLessRetainage: 55_500, currentPaymentDue: 35_500, balanceToFinish: 74_500,
        percentComplete: 57,
      },
      savedAt: '2026-04-02',
    };
    const hydrated = applicationFromSavedRecord(rec);
    eq('a reopened certificate still knows where column C came from',
      hydrated.sovBasis, 'linked_estimate');
    close('…and column F is the figure that was certified',
      hydrated.lines[0].materialsPresentlyStored, 42_000);
    eq('…and what the architect certified comes back with it',
      [hydrated.amountCertified, hydrated.certifiedDate, hydrated.certifiedExplanation],
      [58_200, '2026-04-08', 'Backcharge']);
    eq('…and the jurat, the window and the frozen CO summary',
      [hydrated.notarize, hydrated.notaryState, hydrated.periodFrom,
        hydrated.changeOrderSummary?.thisPeriodDeductions],
      [true, 'Texas', '2026-03-01', 20_000]);
    // EXHAUSTIVENESS, executed. The mapper was written field-by-field with no
    // check of any kind, which is how sovBasis went missing; the next field
    // added would have gone the same way.
    {
      const skip = new Set([
        'id', 'projectId', 'invoiceId', 'totals', 'savedAt', 'createdAt', 'updatedAt',
        'portalState', 'payLinkUrl', 'payLinkId', 'payLinkAmount', 'paidAt',
      ]);
      const asRecord = hydrated as unknown as Record<string, unknown>;
      const missing = Object.keys(rec)
        .filter(k => !skip.has(k))
        .filter(k => !(k in asRecord) || asRecord[k] === undefined);
      eq('every certificate field on the record reaches the editor', missing, []);
    }
    // …and the same record survives the SERVER round trip, sidecar and all.
    eq('sovBasis survives the server round trip too',
      aiaRowToSaved(savedToAiaRow(rec, 'u1')).sovBasis, 'linked_estimate');
    // …AND A RECORD THAT PREDATES THE FIELD MUST NOT BE ACCUSED OF HAVING NO
    // ESTIMATE. Review mode is the default for a saved pay application, so an
    // absent basis defaulting to the else branch made the provenance note lie
    // on every certificate saved before the field existed — telling a GC whose
    // job DOES have a linked estimate to go and link one.
    eq('a recorded basis always wins',
      [resolveSovBasis('invoice_lines', true), resolveSovBasis('linked_estimate', false)],
      ['invoice_lines', 'linked_estimate']);
    eq('…and an absent one reads the project rather than assuming the worst',
      [resolveSovBasis(undefined, true), resolveSovBasis(undefined, false)],
      ['linked_estimate', 'invoice_lines']);
    eq('…which is what the screen’s provenance note branches on',
      /const sovBasis = resolveSovBasis\(app\?\.sovBasis, \(project\?\.linkedEstimate\?\.items\?\.length \?\? 0\) > 0\);/.test(aiaScreen)
      && /\{sovBasis === 'linked_estimate'/.test(aiaScreen), true);
  }
  eq('…and contract drift only lands on an explicit tap',
    /testID="aia-refresh-contract"/.test(aiaScreen), true);
  // ── ONE CHANGE-ORDER TABLE, AND THE GUARD WATCHES THAT ONE ────────────────
  //
  // "Print as saved" means SAVED: the four-row table was the last thing on the
  // printed form still being derived live at print time. Three handoffs reach
  // buildAIAPayAppHtml — the reprint, the generate, and the record
  // buildSavedRecord freezes — and each used to resolve
  // `app.changeOrderSummary ?? coSummaryForPdf` at its own call site while
  // `coFiguresAgree` compared a FOURTH thing, the live recompute. On a record
  // saved BEFORE the effectivePeriodTo fix — a frozen summary split on
  // app.periodTo beside a netChangeByCO split on the invoice's issue date, the
  // two-figures defect persisted to disk — reopening it prints both numbers and
  // a guard watching the live recompute sees agreement and says nothing.
  //
  // EXECUTED: the derivation is lifted out of the shipped screen and run.
  {
    const BEGIN = '// --- BEGIN printed co summary ---';
    const END = '// --- END printed co summary ---';
    const from = aiaScreenRaw.indexOf(BEGIN);
    const to = aiaScreenRaw.indexOf(END);
    if (from < 0 || to < 0) {
      console.error('\n  ✗ could not find the printed-co-summary sentinels in app/aia-pay-app.tsx.');
      console.error('    The guard could go back to watching a table the certificate does not print.');
      process.exit(1);
    }
    const js = new Bun.Transpiler({ loader: 'ts' })
      .transformSync(aiaScreenRaw.slice(from + BEGIN.length, to));
    const derive = new Function('app', 'coSummaryForPdf', 'roundCents',
      `${js}\nreturn { printedCoSummary, coFiguresAgree };`) as (
      a: unknown, live: unknown, r: (n: number) => number,
    ) => { printedCoSummary: { netChange: number } | undefined; coFiguresAgree: boolean };

    const summary = (netChange: number) => ({
      priorAdditions: netChange, priorDeductions: 0, thisPeriodAdditions: 0,
      thisPeriodDeductions: 0, totalAdditions: netChange, totalDeductions: 0, netChange,
    });
    const live = summary(70_000);

    // A DRAFT has no frozen table, so the live one prints and is what is judged.
    eq('a draft prints the live change-order summary',
      derive(app({ netChangeByCO: 70_000 }), live, roundCents),
      { printedCoSummary: live, coFiguresAgree: true });

    // A REOPENED certificate prints its STORED table — the freeze is deliberate.
    const frozen = summary(50_000);
    eq('a reopened certificate prints its STORED change-order summary, not a fresh one',
      derive(app({ netChangeByCO: 50_000, changeOrderSummary: frozen }), live, roundCents)
        .printedCoSummary, frozen);

    // THE LEGACY RECORD. This is the assertion that goes red the moment the
    // guard is pointed back at `coSummaryForPdf`: the live table agrees with
    // line 2, the FROZEN one does not, and the frozen one is what prints.
    eq('a certificate whose frozen table contradicts line 2 is caught, not printed quietly',
      derive(app({ netChangeByCO: 70_000, changeOrderSummary: frozen }), live, roundCents),
      { printedCoSummary: frozen, coFiguresAgree: false });
    // …and a cent of float drift is not a contradiction.
    eq('…while a rounding cent is not a contradiction',
      derive(app({ netChangeByCO: 70_000.004 }), live, roundCents).coFiguresAgree, true);

    // NO app at all (the screen renders before the seed lands) must not throw.
    eq('an unseeded screen neither prints a table nor cries foul',
      derive(null, undefined, roundCents), { printedCoSummary: undefined, coFiguresAgree: true });
  }
  // …and every handoff to the builder uses that ONE value. Not a presence
  // check: what it forbids is a call site re-resolving the fallback inline,
  // which is how the guard and the print path drifted apart the first time.
  eq('all three handoffs to buildAIAPayAppHtml pass the value the guard judged',
    [(aiaScreen.match(/changeOrderSummary: printedCoSummary\b/g) ?? []).length,
      /changeOrderSummary: app\.changeOrderSummary \?\?/.test(aiaScreen)],
    [3, false]);
  eq('…and a saved record hydrates its own stored table',
    /changeOrderSummary: rec\.changeOrderSummary/.test(billing), true);
  // A field left editable in review mode is a dead end: the keystrokes land in
  // state and there is no Save button to persist them.
  // `certReadOnly` is the ONE deliberate exception: AMOUNT CERTIFIED and its
  // date/explanation are the architect's ANSWER, they arrive after the
  // application was sent, and gating them on isReadOnly made the whole feature
  // unreachable on every certificate an architect ever responds to. See
  // payAppEditability.canRecordCertification, which is executed below.
  eq('…and no header field stays typable while the record is read-only',
    (aiaScreen.match(/<TextInput\b[\s\S]*?\/>/g) ?? [])
      .filter(t => /onChangeText|onCommit/.test(t))
      .every(t => /editable=\{!isReadOnly\}|editable=\{editable\}|editable=\{!certReadOnly\}/.test(t)), true);
  // The effect rebuilds `app` from scratch, so anything that re-runs it throws
  // away every figure typed and not yet saved — and every one of its deps is a
  // context callback whose identity changes on a BACKGROUND write (a sync
  // flush, another screen saving a change order). Hydrating instead of
  // re-deriving made that quieter, not harmless. It must initialise once per
  // (invoice, saved record), and the ref must be cleared when nothing was
  // built or the screen never seeds at all.
  eq('the form initialises once per certificate, not on every context refresh',
    /const initialisedFor = useRef<string \| null>\(null\)/.test(aiaScreen)
    && /const key = `\$\{invoice\.id\}\|\$\{savedForThisInvoice\?\.id \?\? 'new'\}`/.test(aiaScreen)
    && /if \(!claimInitKey\(initialisedFor, key\)\) return;/.test(aiaScreen)
    && /initialisedFor\.current = null;/.test(aiaScreen), true);
  // …AND THE GATE IS EXECUTED, not merely greppable. As two lines in the
  // component (`if (ref.current === key) return;` then `ref.current = key;`) a
  // reviewer deleted the SECOND one: the gate never armed, the effect rebuilt
  // the form on every dependency-identity change again, and all four regexes
  // above still matched — the suite did not move. One indivisible function
  // cannot be half-applied, and this runs it.
  {
    const ref: { current: string | null } = { current: null };
    eq('the first certificate initialises', claimInitKey(ref, 'inv1|new'), true);
    eq('…and a background refetch of the SAME certificate does not',
      [claimInitKey(ref, 'inv1|new'), claimInitKey(ref, 'inv1|new')], [false, false]);
    eq('…the key is stamped, so the gate actually arms', ref.current, 'inv1|new');
    eq('the first Save minting a record IS a new identity',
      claimInitKey(ref, 'inv1|rec_a'), true);
    eq('picking a different billing period re-initialises',
      claimInitKey(ref, 'inv2|new'), true);
    // The screen clears the ref when nothing could be built, so a late-arriving
    // branding value still seeds.
    ref.current = null;
    eq('a cleared ref re-initialises the same certificate', claimInitKey(ref, 'inv2|new'), true);
  }
  // SAVING IS NOT "I AM DONE EDITING". The record appears, the screen notices
  // it, and without this the form the GC is halfway through goes read-only
  // under his hands the instant he taps Save. Nothing guarded the line; a
  // reviewer deleted it and the suite did not move.
  {
    const save = /const handleSave = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[/.exec(aiaScreen)?.[0] ?? '';
    eq('handleSave leaves the editor open — Save is not "done editing"',
      /setEditRequested\(true\);/.test(save), true);
    // And the intent is dropped when a different period is chosen, or the next
    // application would open straight into the editor.
    eq('…but choosing another period drops the intent',
      /useEffect\(\(\) => \{ setEditRequested\(false\); \}, \[invoice\?\.id\]\);/.test(aiaScreen), true);
  }
  // THE PURE HELPER IS NOT THE FEATURE. installStoredMaterialOnLine is executed
  // below, but the affordance that makes it reachable — the only control that
  // moves column F into column E — was unguarded: renaming its testID (i.e.
  // removing the button) left the suite green.
  eq('the screen carries the control that installs stored material',
    /testID=\{`aia-install-stored-\$\{line\.id\}`\}/.test(aiaScreen)
    && /onPress=\{\(\) => installStored\(line\.id, line\.materialsPresentlyStored\)\}/.test(aiaScreen), true);
  // ONE COPY OF THE COVER-LEVEL OVER-BILL COMPARISON. `totalOverBill` was
  // exported and documented and never called, while the screen re-implemented
  // the same subtraction inline — two copies of a money comparison, the
  // exported one dead and therefore never executed by any guard.
  {
    close('the cover over-bill is the amount past Contract Sum to Date',
      totalOverBill(app({ contractSumToDate: 8_000, lines: [line({ thisPeriod: 10_000 })] })), 2_000);
    close('…and an exactly-billed contract is not over',
      totalOverBill(app({ contractSumToDate: 10_000, lines: [line({ thisPeriod: 10_000 })] })), 0);
    eq('…and the screen uses that helper rather than a second copy of it',
      /const totalOverBilled = useMemo\(\(\) => \(app \? totalOverBill\(app\) : 0\), \[app\]\);/.test(aiaScreen), true);
  }
  // A REFUSAL IS NOT A SIDE EFFECT OF RENDERING. Deleting a billed SOV row
  // takes money off the certificate, and the refusal used to `showAlert` from
  // INSIDE a `setApp` updater — impure (StrictMode runs it twice in
  // development, so the GC got two alerts) and reachable only through a
  // renderer, so the rule could never be executed.
  {
    const billed = line({ id: 'x', itemNo: '4', description: 'Millwork', fromPreviousApp: 0, thisPeriod: 3_000, materialsPresentlyStored: 1_000 });
    eq('a billed line refuses deletion, and says what it carries',
      [sovLineDeletionRefusal(billed)?.billedToDate,
        /\$4,000\.00 of billed and stored value/.test(sovLineDeletionRefusal(billed)?.body ?? '')],
      [4_000, true]);
    eq('an empty line deletes without argument',
      sovLineDeletionRefusal(line({ fromPreviousApp: 0, thisPeriod: 0, materialsPresentlyStored: 0 })), null);
    // A deductive change order billed as a credit is still money on the form.
    eq('a credit row is billed too, not "empty"',
      !!sovLineDeletionRefusal(line({ fromPreviousApp: 0, thisPeriod: -2_000, materialsPresentlyStored: 0 })), true);
    eq('a row that is already gone is not a refusal', sovLineDeletionRefusal(undefined), null);
    eq('…and the screen decides it OUTSIDE the state updater',
      /const refusal = sovLineDeletionRefusal\(app\.lines\.find\(l => l\.id === lineId\)\);/.test(aiaScreen)
      && /setApp\(prev => \(prev \? \{ \.\.\.prev, lines: prev\.lines\.filter\(l => l\.id !== lineId\) \} : prev\)\);/.test(aiaScreen), true);
    // The whole point: no alert may be raised from inside a setApp updater.
    eq('…and no setApp updater anywhere on the screen raises an alert',
      (aiaScreen.match(/setApp\(\s*(?:\(\s*)?prev[\s\S]*?\n  \}, \[/g) ?? [])
        .some(block => /showAlert\(/.test(block)), false);
  }

  // ── Column F is a BALANCE, carried forward, and installable ───────────────
  {
    const prior = [{ id: 'l1', itemNo: '1', fromPreviousApp: 1_000, thisPeriod: 2_000, materialsPresentlyStored: 4_000 }];
    const carried = carryForwardPriorLines([line()], prior);
    close('column D carries (D + E) of the prior period', carried[0].fromPreviousApp, 3_000);
    close('column F carries the prior period’s stored BALANCE', carried[0].materialsPresentlyStored, 4_000);
    // Installing it must move dollars, never destroy them: column G is the
    // number the architect reads and it must not dip when material is built in.
    const before = carried[0];
    const after = installStoredMaterialOnLine(before, 4_000);
    close('installing stored material empties column F', after.materialsPresentlyStored, 0);
    close('…and adds the same dollars to column E', after.thisPeriod, 4_000);
    close('…so column G does not move',
      after.fromPreviousApp + after.thisPeriod + after.materialsPresentlyStored,
      before.fromPreviousApp + before.thisPeriod + before.materialsPresentlyStored);
    close('installing more than is stored installs only what is stored',
      installStoredMaterialOnLine(before, 99_000).thisPeriod, 4_000);
  }

  // ── G702 lines 5a and 5b are two INDEPENDENT blanks ───────────────────────
  {
    const l = line({ fromPreviousApp: 0, thisPeriod: 5_000, materialsPresentlyStored: 4_000, retainagePercent: 10 });
    const same = computeAIATotals(app({ lines: [l] }));
    close('one rate holds 10% of work and 10% of stored material', same.totalRetainage, 900);
    const split = computeAIATotals(app({ lines: [{ ...l, storedRetainagePercent: 0 }] }));
    close('5b at 0% withholds nothing on stored material', split.retainageOnStored, 0);
    close('…while 5a still withholds 10% of work in place', split.retainageOnCompleted, 500);
    close('…and the GC is paid the $400 he is owed this period',
      split.currentPaymentDue - same.currentPaymentDue, 400);
    eq('undefined means "same as 5a" — the semantics of every archived record',
      storedRetainagePercentForLine({ retainagePercent: 7.5, storedRetainagePercent: undefined }), 7.5);
    eq('…and an explicit 0 is NOT treated as missing',
      storedRetainagePercentForLine({ retainagePercent: 10, storedRetainagePercent: 0 }), 0);
  }

  // ── The over-bill warning (a practice norm, NOT a printed form rule) ──────
  {
    const over = findOverBilledLines({ lines: [line({ scheduledValue: 38_000, thisPeriod: 45_000 })] });
    eq('a line billed past its scheduled value is reported', over.length, 1);
    close('…by the right amount', over[0].overBy, 7_000);
    eq('a line billed exactly to its scheduled value is not',
      findOverBilledLines({ lines: [line({ thisPeriod: 10_000 })] }).length, 0);
    eq('stored material counts toward the over-bill, as it does toward column G',
      findOverBilledLines({ lines: [line({ thisPeriod: 9_000, materialsPresentlyStored: 2_000 })] }).length, 1);
    eq('a deductive change-order line is not an over-bill',
      findOverBilledLines({ lines: [line({ scheduledValue: -5_000, thisPeriod: -5_000 })] }).length, 0);
  }
  eq('the progress bar no longer hides an over-bill by clamping at 100%',
    /isOver && styles\.sovProgressFillOver/.test(aiaScreen)
    && /testID={`aia-overbill-\$\{line\.id\}`}/.test(aiaScreen), true);
  // The G703-1992 prints no rule that column G may not exceed column C, and
  // AIA's instructions state none. The warning must not claim otherwise.
  eq('…and the warning does not claim the form requires it',
    /the (G703 )?form requires|the G703 requires|required by the form/i.test(aiaScreen), false);
  eq('…the quick-% buttons include stored material, as column H does',
    /thisPeriod = Math\.max\(0, totalCompleted - l\.fromPreviousApp - l\.materialsPresentlyStored\)/.test(aiaScreen), true);

  // ── Change orders belong to a period ──────────────────────────────────────
  {
    const co = (n: number, when: string, amt: number) => ({
      number: n, status: 'approved' as const, date: when, updatedAt: when, changeAmount: amt,
    });
    const split = splitApprovedCOsByPeriod(
      [co(1, '2026-02-10', 50_000), co(2, '2026-03-31', 10_000), co(3, '2026-04-05', 20_000)],
      '2026-03-31',
    );
    eq('a CO approved after the period end is not on this certificate', split.inPeriod.length, 2);
    eq('…and is named as belonging to the next one', split.afterPeriod[0].number, 3);
    eq('a CO approved ON the last day of the period is IN it',
      split.inPeriod.some(c => c.number === 2), true);
    eq('the last approver to sign is when the CO became approved',
      changeOrderApprovalDate({
        status: 'approved', date: '2026-01-01', updatedAt: '2026-05-01',
        approvers: [
          { id: 'a', name: 'A', email: '', role: 'Owner’s Rep' as never, required: true, order: 1, status: 'approved', responseDate: '2026-02-01' },
          { id: 'b', name: 'B', email: '', role: 'Architect', required: true, order: 2, status: 'approved', responseDate: '2026-03-02' },
        ],
      }), '2026-03-02');
    // A $50,000 add and a $20,000 deduct are not one $30,000 addition.
    const sum = summarizeChangeOrders(
      [co(1, '2026-02-10', 50_000), co(2, '2026-03-10', -20_000)],
      '2026-03-01', '2026-03-31',
    );
    close('prior months carry their own additions', sum.priorAdditions, 50_000);
    close('this month’s deduct is not netted into last month’s add', sum.thisPeriodDeductions, 20_000);
    close('…and the four rows still foot to line 2', sum.netChange, 30_000);
  }
  eq('the screen filters change orders to the period being billed',
    /splitApprovedCOsByPeriod\(getChangeOrdersForProject\(project\.id\), effectivePeriodTo\)/.test(aiaScreen), true);
  eq('…and says which COs were held back and why',
    /testID="aia-co-after-period"/.test(aiaScreen), true);
  // …NAMING THE DATE ITS OWN SPLIT USED. The banner printed `app.periodTo`
  // while the split it lists ran on the invoice's issue date, so it could say
  // "approved AFTER 2026-04-30" about a change order approved on the 20th —
  // the GC reads that as a bug in his change-order log, not in the boundary.
  {
    const banner = /testID="aia-co-after-period"[\s\S]*?<\/Text>/.exec(aiaScreen)?.[0] ?? '';
    eq('…dated by the boundary the split used, not by a second date',
      /effectivePeriodTo \|\| 'this period'/.test(banner) && !/\{app\.periodTo/.test(banner), true);
  }

  // ── Period + application-number controls exist at all ─────────────────────
  eq('PERIOD TO, PERIOD FROM and APPLICATION DATE are editable fields',
    /testID="aia-period-to"/.test(aiaScreen)
    && /testID="aia-period-from"/.test(aiaScreen)
    && /testID="aia-application-date"/.test(aiaScreen), true);
  eq('…and so is APPLICATION NO., for a GC migrating a job mid-stream',
    /testID="aia-application-number"/.test(aiaScreen), true);
  eq('…and seeding no longer forces PERIOD TO to the invoice issue date',
    /periodTo: opts\?\.periodTo \?\? invoice\.issueDate/.test(billing), true);
  // …and the only caller PASSES them. The seeder grew both options in this
  // wave and neither was ever supplied, so the refresh path rebuilt the
  // change-order rows against the invoice's issue date while the rest of the
  // certificate spoke about the GC's period.
  eq('…and the screen actually passes the dates it holds',
    /periodTo: app\?\.periodTo \|\| undefined,/.test(aiaScreen)
    && /applicationDate: app\?\.applicationDate \|\| undefined,/.test(aiaScreen), true);

  // ── The printed form ──────────────────────────────────────────────────────
  {
    const html = buildAIAPayAppHtml(app({
      lines: [line({ thisPeriod: 5_000, materialsPresentlyStored: 1_000 })],
      amountCertified: 4_000, notarize: true, notaryState: 'Texas', notaryCounty: 'Harris',
    }), { companyName: 'GC' } as never);

    // THE RUNNING FOOTER PRINTED ON TOP OF MONEY ROWS.
    //
    // Two position:fixed footers at the same offset repeat on EVERY page and
    // overprint character by character: every page read
    // "GenGeratedbyMAGEID·Application#3·Page2of1of2·G703G702ContinuationCover".
    // Collapsing them to ONE fixed div fixed the garble and NOT the collision.
    // A fixed element in paged media is positioned against the PAGE AREA, the
    // same box the content flows through, so it sits ON the flow with nothing
    // reserved beneath it. Measured on a 60-line SOV through headless Chrome
    // (--print-to-pdf, `pdftotext -bbox`): the footer printed at
    // y 715.79–722.77 / x 208.8–402.8 while SOV row 43 occupied
    // y 710.19–717.60 / x 44.0–572.2 — struck through that row's D, E and F.
    //
    // This suite cannot drive Chrome, so it guards the MECHANISM instead of the
    // geometry: no position:fixed anywhere in the print stylesheet means no
    // element can be laid over the flow in the first place. Counting footer
    // occurrences (what the previous guard did) is exactly the check that went
    // green while the collision was still there.
    eq('nothing in the printed form is positioned OVER the page content',
      /position:\s*fixed/.test(html), false);
    // Where the provenance line went instead: the @page margin box (a band the
    // print engine reserves) plus a thead caption row, which repeats in normal
    // flow on every continuation page in engines that ignore margin boxes —
    // iOS WebKit among them, and page 2+ of the G703 carries no other
    // identification at all.
    eq('…the provenance line rides in the @page margin box',
      /@bottom-left \{ content: "Generated by MAGE ID · Job · Application #\d+ · G702 \/ G703";/.test(html), true);
    eq('…and repeats in-flow as the G703 thead caption, for engines without margin boxes',
      /<thead>\s*<tr>\s*<th class="sheet-caption" colspan="10">Generated by MAGE ID/.test(html), true);
    eq('…and it does not hardcode a page count it cannot know',
      /Page \d+ of \d+/.test(html), false);
    eq('…the real count comes from the print engine',
      /@bottom-right \{ content: "Page " counter\(page\) " of " counter\(pages\);/.test(html), true);
    // A `content:` string is a CSS string literal, not HTML. A project called
    // `4" Slab` would terminate it and take the whole @page rule — including
    // the page counter — down with it.
    {
      const quoted = buildAIAPayAppHtml(
        app({ projectName: '4" Slab \\ Wing' }), { companyName: 'GC' } as never);
      eq('…with the project name escaped for CSS, so a quote cannot drop the @page rule',
        /@bottom-left \{ content: "Generated by MAGE ID · 4\\" Slab \\\\ Wing/.test(quoted)
        && /@bottom-right \{ content: "Page " counter\(page\)/.test(quoted), true);
    }
    // A <tfoot> repeats on every page, so page 2 of a 60-line SOV printed the
    // whole contract's GRAND TOTAL beneath line 28 of 60.
    eq('the GRAND TOTAL row does not repeat on every continuation page',
      /table\.g703 tfoot \{ display: table-row-group; \}/.test(html), true);
    // The trailing break the old `.page:last-child` override stopped catching
    // once the footer became body's last child.
    eq('…and no sheet carries a trailing page break',
      /page-break-after: always/.test(html), false);

    eq('the architect’s certificate is its own block, not a second signature rule',
      (html.match(/class="cert-block"/g) ?? []).length, 2);
    eq('…carrying an AMOUNT CERTIFIED line as its own labelled row',
      /<div class="amount-certified">[\s\S]{0,200}<span class="ac-label">AMOUNT CERTIFIED<\/span>/.test(html), true);
    eq('…which prints a blank rule for the architect until it comes back',
      /<span class="rule" style="min-width:120px">/.test(
        buildAIAPayAppHtml(app(), { companyName: 'GC' } as never)), true);
    eq('…which prints the figure once it is recorded', /\$ 4,000\.00/.test(html), true);
    eq('…the instruction to attach an explanation and initial changed figures',
      /Attach an explanation if the amount certified differs/.test(html)
      && /Initial every figure on this Application and on the Continuation Sheet/.test(html), true);
    eq('…and the closing non-negotiability clause',
      /This Certificate is not negotiable\. The AMOUNT CERTIFIED is payable only to the Contractor named herein/.test(html), true);
    eq('the notary jurat prints when the GC asks for it',
      /Subscribed and sworn to before me this/.test(html)
      && /Notary Public/.test(html)
      && /My commission expires/.test(html)
      && /Texas/.test(html) && /Harris/.test(html), true);
    eq('…and not otherwise, so a residential GC prints no empty notary lines',
      /Subscribed and sworn/.test(buildAIAPayAppHtml(app(), { companyName: 'GC' } as never)), false);

    // AIA licenses its documents and prints a copyright-violation reporting
    // address on the form. The contractor's undertaking is the contractor's;
    // it does not have to be stated in AIA's exact words.
    eq('the contractor’s certification is not AIA’s verbatim sentence',
      /to the best of the Contractor's knowledge, information and belief the Work covered by this Application for Payment has been completed in accordance with the Contract Documents/.test(html), false);
    eq('…but it still states the same three undertakings',
      /as the Contract Documents require/.test(html)
      && /Certificates for Payment already issued has been paid/.test(html)
      && /properly due now/.test(html), true);
    // The trademark disclaimer is a different thing and stays.
    eq('…and the AIA trademark disclaimer is untouched',
      /registered trademarks of The American Institute of Architects/.test(html), true);

    eq('line 5a and 5b print their OWN rates',
      /a\. 10% of Completed Work/.test(html) && /b\. 10% of Stored Material/.test(html), true);
    {
      const mixed = buildAIAPayAppHtml(app({
        lines: [line({ materialsPresentlyStored: 1_000, storedRetainagePercent: 0 }), line({ id: 'l2', retainagePercent: 5 })],
      }), { companyName: 'GC' } as never);
      // 5a's amount is summed from the PER-LINE rates while its label used to
      // come from the cover, so a mixed schedule printed a percentage that did
      // not produce the figure beside it.
      eq('…and say "variable" rather than a rate that contradicts the amount',
        /at variable rates/.test(mixed), true);
    }
    eq('the G703 headers carry the arithmetic that makes the sheet self-checking',
      /\(D \+ E \+ F\)/.test(html) && /\(Not in D or E\)/.test(html)
      && /\(C − G\)/.test(html) && /\(If variable rate\)/.test(html), true);
    // A billing-period bound is a CALENDAR DAY. `new Date('2026-08-31')` is UTC
    // midnight, so west of Greenwich the certificate printed "August 30" for a
    // period the GC had set to the 31st — harmless while the dates were copied
    // from the invoice, not harmless now that they are fields he fills in and
    // an architect reconciles against his file.
    {
      const dated = buildAIAPayAppHtml(
        app({ periodTo: '2026-08-31', periodFrom: '2026-08-01', applicationDate: '2026-09-01' }),
        { companyName: 'GC' } as never,
      );
      // THESE TWO ONLY FIRE OUTSIDE UTC. Under TZ=UTC — the default on
      // essentially every CI runner — there is no shift to detect and both
      // pass with the defect reinstated. They are kept because they cost
      // nothing on a developer machine, but the guard that actually holds this
      // fix is the forced-zone block further down ("11 hours west of
      // Greenwich"), which pins the zone itself.
      eq('PERIOD TO does not shift a day by the viewer’s timezone',
        /August 31, 2026/.test(dated) && !/August 30, 2026/.test(dated), true);
      eq('…nor does APPLICATION DATE', /September 1, 2026/.test(dated), true);
    }

    // The 1992 form this app emulates carries no page-count field. Do not add one.
    eq('no PAGE __ OF __ PAGES field (that is the pre-1992 form)',
      /PAGE \d* ?OF ___|OF ___ PAGES/i.test(html), false);
  }

  // ── The second live Pay button ────────────────────────────────────────────
  // Paying the INVOICE credits it and clears the invoice's link, but nothing
  // clears the AIA side, so the portal kept a live Pay button for the same
  // money — and the two links need not be for the same amount.
  {
    const payApp = (over: Partial<SavedAIAPayApp> = {}): SavedAIAPayApp => ({
      id: 'a1', projectId: 'p1', invoiceId: 'inv1', applicationNumber: 1,
      applicationDate: '2026-03-31', periodTo: '2026-03-31',
      ownerName: 'O', contractorName: 'GC', projectName: 'Job',
      originalContractSum: 10_000, netChangeByCO: 0, contractSumToDate: 10_000,
      retainagePercent: 10, lessPreviousCertificates: 0, lines: [],
      totals: {
        totalScheduledValue: 10_000, totalCompletedAndStored: 5_000, totalRetainage: 500,
        totalEarnedLessRetainage: 4_500, currentPaymentDue: 4_500, balanceToFinish: 5_500,
        percentComplete: 50,
      },
      payLinkUrl: 'https://pay.stripe.com/x', payLinkAmount: 4_500,
      savedAt: '2026-04-01', portalState: { status: 'sent' } as never, ...over,
    });
    const inv = (over: Record<string, unknown> = {}) => ({
      id: 'inv1', projectId: 'p1', number: 3, type: 'progress', status: 'sent',
      issueDate: '2026-03-31', dueDate: '2026-04-30', lineItems: [],
      subtotal: 5_000, taxAmount: 0, totalDue: 5_000, amountPaid: 0,
      portalState: { status: 'sent' }, ...over,
    }) as never;
    const build = (apps: SavedAIAPayApp[], invoices: unknown[]) => buildPortalSnapshot({
      project: { id: 'p1', name: 'Job', status: 'active' } as never,
      portal: { showInvoices: true } as never,
      invoices: invoices as never,
      aiaPayApps: apps,
    }).sections.aiaPayApps?.[0];

    eq('an unpaid pay app whose link matches what is owed keeps its Pay button',
      !!build([payApp()], [inv()])?.payLinkUrl, true);
    eq('a pay app whose INVOICE is settled shows no Pay button',
      build([payApp()], [inv({ amountPaid: 5_000, status: 'paid' })])?.payLinkUrl, undefined);
    // "SETTLED" IS NOT A PAYMENT DATE. This used to assert `paidAt` was set on
    // an invoice-settled period, which the builder satisfied by falling back to
    // the invoice's ISSUE date — so a client-facing certificate printed "Paid
    // March 31" naming the day the GC BILLED him, on an invoice with no
    // recorded payment at all. The honest shape: date it only when a payment
    // was actually recorded, and let the portal's own "Settled with invoice"
    // copy carry the rest. That copy was dead code until this changed.
    {
      const settled = inv({ amountPaid: 5_000, status: 'paid' });
      eq('…and does NOT invent a payment date from the invoice issue date',
        build([payApp()], [settled])?.paidAt, undefined);
      eq('…but reports the real one when a payment was recorded',
        build([payApp()], [inv({
          amountPaid: 5_000, status: 'paid',
          payments: [{ id: 'p1', date: '2026-04-14', amount: 2_000, method: 'card' }],
        })])?.paidAt, '2026-04-14');
      // payments[] is in ENTRY order, not date order: a cheque received on the
      // 3rd, back-entered after a card payment on the 14th, used to date the
      // certificate the 3rd because the reader took the last ELEMENT.
      eq('…the LATEST payment, not the last one typed',
        build([payApp()], [inv({
          amountPaid: 5_000, status: 'paid',
          payments: [
            { id: 'p1', date: '2026-04-14', amount: 3_000, method: 'card' },
            { id: 'p2', date: '2026-04-03', amount: 2_000, method: 'check' },
          ],
        })])?.paidAt, '2026-04-14');
    }
    // THE BILLING WINDOW THE GC SET BEATS THE ONE THE PORTAL INFERRED.
    // derivePayAppPeriods guesses periodFrom as "the day after the previous
    // application's period end" because SavedAIAPayApp used to have no such
    // field. It has one now, and a date the contractor actually typed is
    // evidence where the inference is a guess — so the portal narrative ("what
    // this period bought") reports the window he certified, not a derived one
    // that can silently include or exclude a day's photos and reports. This
    // behaviour shipped unguarded.
    eq('a stored PERIOD FROM beats the portal’s inferred window',
      build([payApp({ periodFrom: '2026-03-05' } as never)], [inv()])?.periodFrom, '2026-03-05');
    eq('…and the inference still runs when the GC set nothing',
      build([payApp()], [inv()])?.periodFrom, undefined);
    // MONEY-F2, the guard the invoice button had and the AIA button did not.
    eq('a link minted for a different amount is withheld',
      build([payApp({ payLinkAmount: 9_000 })], [inv()])?.payLinkUrl, undefined);
    eq('a link with no recorded amount is withheld',
      build([payApp({ payLinkAmount: undefined })], [inv()])?.payLinkUrl, undefined);
    // …and that is a DEAD END, not a temporary state: the record is locked by
    // its own payLinkUrl, so no save regenerates it. The screen has to name it
    // instead of leaving an owner staring at a card with no button.
    eq('…and the screen says so instead of leaving an unexplained dead card',
      /testID="aia-paylink-amount-unknown"/.test(aiaScreen)
      && /payLinkAmount == null/.test(aiaScreen), true);
    eq('a pay app the webhook already stamped stays settled',
      build([payApp({ paidAt: '2026-04-02' })], [inv()])?.payLinkUrl, undefined);

    // A GC-ENTERED PERIOD START BEATS THE INFERRED ONE, executed rather than
    // grepped: derivePayAppPeriods guesses "the day after the previous
    // application's period end" because SavedAIAPayApp used to have no
    // periodFrom, and dropping the stored value silently reinstated the guess
    // with the whole suite green.
    const twoPeriods = [
      payApp({ id: 'a1', invoiceId: 'inv1', applicationNumber: 1, periodTo: '2026-02-28' }),
      payApp({ id: 'a2', invoiceId: 'inv2', applicationNumber: 2, periodTo: '2026-03-31',
        periodFrom: '2026-03-10' }),
    ];
    const snapped = buildPortalSnapshot({
      project: { id: 'p1', name: 'Job', status: 'active', schedule: { startDate: '2026-01-01', tasks: [] } } as never,
      portal: { showInvoices: true } as never,
      invoices: [inv({ id: 'inv1' }), inv({ id: 'inv2' })] as never,
      aiaPayApps: twoPeriods,
    }).sections.aiaPayApps ?? [];
    eq('the portal believes a period start the contractor actually set',
      snapped.find(a => a.id === 'a2')?.periodFrom, '2026-03-10');
    eq('…and still infers one for a period he did not',
      snapped.find(a => a.id === 'a1')?.periodFrom, '2026-01-01');
  }
  // ── THE SERVER HALF OF THE SECOND PAY BUTTON ──────────────────────────────
  // Suppressing the button in the snapshot builder and in the portal page
  // cannot retire a Stripe Payment Link, and a snapshot published BEFORE the
  // invoice was paid still carries the pre-payment AIA row. creditInvoice has
  // to do to the pay app what handleAiaPayAppCompleted already does to the
  // invoice.
  //
  // EXECUTED, NOT GREPPED. These four assertions used to be regexes over the
  // webhook source, and a regex over a file cannot see an early `return` above
  // the mirror — which is precisely how a blocker survived two review layers
  // elsewhere in this campaign. `creditInvoice` is lifted out of the SHIPPED
  // function between its sentinels, transpiled, and run against a fake
  // PostgREST client that records every write. If the block is moved into dead
  // code, guarded behind something unreachable, or dropped, no write is
  // recorded and these go red.
  {
    const WEBHOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase',
      'functions', 'stripe-webhook', 'index.ts');
    const src = readFileSync(WEBHOOK, 'utf8');
    const BEGIN = '// --- BEGIN creditInvoice ---';
    const END = '// --- END creditInvoice ---';
    const from = src.indexOf(BEGIN);
    const to = src.indexOf(END);
    if (from < 0 || to < 0) {
      console.error('\n  ✗ could not find the creditInvoice sentinels in the stripe webhook.');
      console.error('    Someone moved or renamed the function; the invoice→AIA settlement');
      console.error('    mirror would go unpinned and a second live Pay button could return.');
      process.exit(1);
    }

    type Row = Record<string, unknown>;
    type Write = { table: string; patch: Row; on: [string, unknown] };
    const writes: Write[] = [];
    const deactivated: string[] = [];
    /** A PostgREST-shaped double, only as clever as the four chains the
     *  function actually issues. Terminal awaits are `.single()` and `.is()`
     *  on reads and `.eq()` on updates, exactly as the source uses them. */
    const makeDb = (invoice: Row | null, aiaRows: Row[]) => {
      const reader = (rows: Row[]) => {
        const b = {
          eq: (k: string, v: unknown) => { rows = rows.filter(r => (r[k] ?? null) === v); return b; },
          is: (k: string, v: unknown) =>
            Promise.resolve({ data: rows.filter(r => (r[k] ?? null) === v), error: null }),
          single: () => Promise.resolve(rows[0]
            ? { data: rows[0], error: null }
            : { data: null, error: { code: 'PGRST116', message: 'no rows' } }),
        };
        return b;
      };
      return {
        from: (table: string) => ({
          select: () => reader(table === 'invoices' ? (invoice ? [invoice] : []) : aiaRows),
          update: (patch: Row) => ({
            eq: (k: string, v: unknown) => {
              writes.push({ table, patch, on: [k, v] });
              return Promise.resolve({ error: null });
            },
          }),
        }),
      };
    };

    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(src.slice(from, to));
    const creditInvoice = new Function(
      'INVOICE_COLS', 'isNotFound', 'deactivatePaymentLink',
      'toCents2', 'effectiveRetention', 'ledgerFrom', 'applyLedgerEntry',
      'settlementStatus', 'netPayable',
      `${js}\nreturn creditInvoice;`,
    )(
      '*',
      (code: string | undefined) => code === 'PGRST116' || code === '22P02',
      (id: string) => { deactivated.push(id); return Promise.resolve({ ok: true }); },
      toCents2, effectiveRetention, ledgerFrom, applyLedgerEntry, settlementStatus, netPayable,
    ) as (
      db: unknown, invoiceId: string, session: Row,
      account: string | undefined, via: string, viaId?: string,
    ) => Promise<{ ok: boolean }>;

    /** Henderson period 3: a $61,400 draw invoiced and certified on one G702. */
    const invoiceRow = () => ({
      id: 'inv1', status: 'sent', total_due: 61_400, amount_paid: 0, subtotal: 61_400,
      retention_percent: 0, retention_amount: 0, retention_released: 0,
      payments: [], pay_link_id: 'plink_inv', pay_link_url: 'https://pay.stripe.com/inv',
    });
    const aiaRow = () => ({
      id: 'aia1', invoice_id: 'inv1', paid_at: null,
      pay_link_id: 'plink_aia', pay_link_url: 'https://pay.stripe.com/aia',
    });
    const session = { id: 'cs_1', amount_total: 6_140_000, payment_intent: 'pi_1', payment_link: 'plink_inv' };

    // THE BOOKKEEPER PAYS THE INVOICE.
    writes.length = 0; deactivated.length = 0;
    const credited = await creditInvoice(makeDb(invoiceRow(), [aiaRow()]), 'inv1', session, 'acct_1', 'invoice');
    const aiaWrite = writes.find(w => w.table === 'aia_pay_apps');
    eq('paying the invoice credits it', credited.ok, true);
    eq('paying the invoice settles the AIA pay application for the same period',
      [aiaWrite?.on, !!aiaWrite], [['id', 'aia1'], true]);
    eq('…stamping paid_at and nulling all three pay-link columns',
      aiaWrite && {
        paid_at: typeof aiaWrite.patch.paid_at === 'string',
        pay_link_url: aiaWrite.patch.pay_link_url,
        pay_link_id: aiaWrite.patch.pay_link_id,
        pay_link_amount: aiaWrite.patch.pay_link_amount,
        payment_intent_id: aiaWrite.patch.payment_intent_id,
      },
      { paid_at: true, pay_link_url: null, pay_link_id: null, pay_link_amount: null, payment_intent_id: 'pi_1' });
    eq('…and deactivating the pay app\'s link on Stripe, which no read side can do',
      deactivated.includes('plink_aia'), true);

    // THE AIA ROUTE must not do it twice — handleAiaPayAppCompleted has already
    // stamped the row it came from, and a second pass would re-deactivate a
    // link Stripe has already retired.
    writes.length = 0; deactivated.length = 0;
    await creditInvoice(makeDb(invoiceRow(), [aiaRow()]), 'inv1', session, 'acct_1', 'aia_pay_app', 'aia1');
    eq('…only on the invoice route, so the AIA route does not do it twice',
      [writes.some(w => w.table === 'aia_pay_apps'), deactivated.includes('plink_aia')], [false, false]);

    // A PERIOD ALREADY SETTLED is skipped: the `.is("paid_at", null)` filter is
    // what keeps a re-delivered event from re-stamping a paid_at that is the
    // historical record of when the money landed.
    writes.length = 0;
    await creditInvoice(
      makeDb(invoiceRow(), [{ ...aiaRow(), paid_at: '2026-04-02T00:00:00.000Z' }]),
      'inv1', session, 'acct_1', 'invoice');
    eq('…and an already-settled pay app is left exactly as it was',
      writes.some(w => w.table === 'aia_pay_apps'), false);

    // REACHABILITY, the thing a grep cannot check: a DUPLICATE session returns
    // early, so nothing at all is written. This assertion is what fails if
    // someone later moves the mirror above that early return, where it would
    // settle a pay app on a Stripe retry that moved no money.
    writes.length = 0;
    const dupInvoice = {
      ...invoiceRow(), amount_paid: 61_400, status: 'paid',
      payments: [{ id: 'stripe-cs_1', amount: 61_400, method: 'stripe', kind: 'payment' }],
    };
    await creditInvoice(makeDb(dupInvoice, [aiaRow()]), 'inv1', session, 'acct_1', 'invoice');
    eq('a re-delivered session writes nothing — not the invoice, not the pay app',
      writes.length, 0);

    // And a pay app whose link is the very one just paid is settled WITHOUT a
    // redundant Stripe round trip.
    writes.length = 0; deactivated.length = 0;
    await creditInvoice(
      makeDb(invoiceRow(), [{ ...aiaRow(), pay_link_id: 'plink_inv' }]),
      'inv1', session, 'acct_1', 'invoice');
    eq('the link Stripe just charged is not deactivated a second time',
      [writes.some(w => w.table === 'aia_pay_apps'), deactivated], [true, []]);
  }

  // Read-side suppression cannot undo a charge Stripe has already taken, so
  // the screen must not MINT a link for a period whose invoice is settled.
  // An existing link is deliberately left alone — `isLocked` is computed from
  // it and nulling it would unlock a certificate that has been through Stripe.
  eq('the screen refuses to mint a pay link for a period the invoice already settled',
    /const sourceInvoiceSettled = !!invoice && invoiceOutstanding\(invoice\) <= 0\.01;/.test(aiaScreen)
    && /if \(!payLinkUrl && due > 0 && !savedPaidAt && !sourceInvoiceSettled && user\?\.id\)/.test(aiaScreen), true);
  eq('…using the same outstanding-balance definition as the portal and the invoice screen',
    /import \{ invoiceOutstanding \} from '@\/utils\/invoiceBilling';/.test(aiaScreen), true);
  eq('portalSnapshot gates the AIA link on the minted amount, like the invoice one',
    /const amountStillMatches = app\.payLinkAmount != null/.test(snapshotSrc), true);
  eq('…and no longer gates it on paidAt alone',
    /payLinkUrl: paidAt \? undefined : app\.payLinkUrl/.test(snapshotSrc), false);
  // The portal page runs against whatever snapshot is CACHED in the client's
  // browser, including ones published before the builder-side guard existed.
  eq('the portal page re-checks payability itself, in both render sites',
    /function aiaCanPay\(a\)/.test(portalHtml)
    && (portalHtml.match(/aiaCanPay\(a\)/g) ?? []).length >= 2, true);
  eq('…and the old unguarded expressions are gone',
    /var canPay = !aiaPaid && !!a\.payLinkUrl && due > 0/.test(portalHtml)
    || /var aiaCanPay = !aiaPaid && !!a\.payLinkUrl && aiaDue > 0/.test(portalHtml), false);
  eq('…knowing which invoices are settled before it renders the cards',
    /noteSettledInvoices\(sections\.invoices\);[\s\S]{0,200}renderAIA\(sections\.aiaPayApps\)/.test(portalHtml), true);
  // EXECUTE the portal page's own gate rather than grepping for it. A grep for
  // an expression goes green the day someone leaves the function in place and
  // stops calling it; this lifts the three functions out of the page and runs
  // them against the scenario that shipped the bug.
  {
    const rawPortal = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'marketing', 'portal', 'index.html'), 'utf8');
    const lift = (name: string) => {
      const i = rawPortal.indexOf(`function ${name}(`);
      if (i < 0) throw new Error(`portal page no longer defines ${name}`);
      let depth = 0;
      for (let k = rawPortal.indexOf('{', i); k < rawPortal.length; k++) {
        if (rawPortal[k] === '{') depth++;
        else if (rawPortal[k] === '}' && --depth === 0) return rawPortal.slice(i, k + 1);
      }
      throw new Error(`unterminated ${name}`);
    };
    const gate = new Function(
      `var SETTLED_INVOICE_IDS={};
       ${lift('noteSettledInvoices')}${lift('aiaIsPaid')}${lift('aiaCanPay')}
       return { noteSettledInvoices, aiaIsPaid, aiaCanPay };`,
    )() as {
      noteSettledInvoices: (i: unknown[]) => void;
      aiaIsPaid: (a: unknown) => boolean;
      aiaCanPay: (a: unknown) => boolean;
    };
    const card = { id: 'a1', invoiceId: 'inv1', currentPaymentDue: 61_400, payLinkUrl: 'https://pay.stripe.com/x', payLinkAmount: 61_400 };

    gate.noteSettledInvoices([{ id: 'inv1', balance: 0 }]);
    eq('the portal page itself refuses to collect for a period the invoice settled',
      gate.aiaCanPay(card), false);
    eq('…and says so, rather than showing a dead card', gate.aiaIsPaid(card), true);

    gate.noteSettledInvoices([{ id: 'inv1', balance: 61_400 }]);
    eq('…while a genuinely unpaid period whose link still matches keeps its button',
      gate.aiaCanPay(card), true);
    eq('…a link minted for a different amount does not',
      gate.aiaCanPay({ ...card, payLinkAmount: 55_000 }), false);
    eq('…and a webhook-stamped pay app is Paid, never payable',
      [gate.aiaCanPay({ ...card, paidAt: '2026-04-02' }), gate.aiaIsPaid({ ...card, paidAt: '2026-04-02' })],
      [false, true]);

    // "SETTLED WITH INVOICE" MUST BE REACHABLE. The page has two copies for a
    // settled period — a date when one is known, and "Settled with invoice" /
    // "Settled — this period was paid on the invoice" when one is not. The
    // second was DEAD CODE for as long as the builder inferred `paidAt` from the
    // invoice's issue date, because the inference could never produce
    // undefined: `issueDate` is required on Invoice. That is the exact shape
    // the builder now emits, and this runs the page's branch on it.
    {
      const settledRow = buildPortalSnapshot({
        project: { id: 'p1', name: 'Job', status: 'active' } as never,
        portal: { showInvoices: true } as never,
        invoices: [{
          id: 'inv1', projectId: 'p1', number: 3, type: 'progress', status: 'paid',
          issueDate: '2026-03-31', dueDate: '2026-04-30', lineItems: [],
          subtotal: 5_000, taxAmount: 0, totalDue: 5_000, amountPaid: 5_000,
          portalState: { status: 'sent' },
        }] as never,
        aiaPayApps: [{
          id: 'a1', projectId: 'p1', invoiceId: 'inv1', applicationNumber: 1,
          applicationDate: '2026-03-31', periodTo: '2026-03-31',
          ownerName: 'O', contractorName: 'GC', projectName: 'Job',
          originalContractSum: 10_000, netChangeByCO: 0, contractSumToDate: 10_000,
          retainagePercent: 10, lessPreviousCertificates: 0, lines: [],
          totals: {
            totalScheduledValue: 10_000, totalCompletedAndStored: 5_000, totalRetainage: 500,
            totalEarnedLessRetainage: 4_500, currentPaymentDue: 4_500, balanceToFinish: 5_500,
            percentComplete: 50,
          },
          payLinkUrl: 'https://pay.stripe.com/x', payLinkAmount: 4_500,
          savedAt: '2026-04-01', portalState: { status: 'sent' } as never,
        }] as SavedAIAPayApp[],
      }).sections.aiaPayApps?.[0];
      gate.noteSettledInvoices([{ id: 'inv1', balance: 0 }]);
      const branch = (a: { paidAt?: string } | undefined) =>
        (!gate.aiaCanPay(a) && gate.aiaIsPaid(a))
          ? (a?.paidAt ? 'Paid ' + a.paidAt : 'Settled with invoice')
          : 'no pill';
      eq('the portal prints "Settled with invoice", not a date it made up',
        branch(settledRow), 'Settled with invoice');
      eq('…and still prints the real date when there is one',
        branch({ ...settledRow, paidAt: '2026-04-14' } as never), 'Paid 2026-04-14');
    }
  }

  // ── Every edit after the first save was local-only ────────────────────────
  eq('a re-saved pay application actually reaches the server',
    /supabaseWrite\('aia_pay_apps', 'upsert', aiaPayAppToRow\(finalApp\)\)/.test(ctx), true);
  eq('…and the insert that returned an ignored 409 is gone',
    /supabaseWrite\('aia_pay_apps', 'insert'/.test(ctx), false);

  // ── The new certificate fields survive a server round trip ────────────────
  {
    const rec: SavedAIAPayApp = {
      id: 'a1', projectId: 'p1', invoiceId: 'inv1', applicationNumber: 2,
      applicationDate: '2026-04-02', periodTo: '2026-03-31', periodFrom: '2026-03-01',
      ownerName: 'O', contractorName: 'GC', projectName: 'Job',
      originalContractSum: 100, netChangeByCO: 0, contractSumToDate: 100,
      retainagePercent: 10, storedRetainagePercent: 0, lessPreviousCertificates: 0,
      amountCertified: 58_200, certifiedDate: '2026-04-08',
      certifiedExplanation: 'Backcharge on drywall',
      notarize: true, notaryState: 'Texas', notaryCounty: 'Harris',
      changeOrderSummary: {
        priorAdditions: 50_000, priorDeductions: 0,
        thisPeriodAdditions: 0, thisPeriodDeductions: 20_000,
        totalAdditions: 50_000, totalDeductions: 20_000, netChange: 30_000,
      },
      lines: [{
        id: 'l1', itemNo: '1', description: 'Framing', scheduledValue: 100,
        fromPreviousApp: 0, thisPeriod: 0, materialsPresentlyStored: 0,
        retainagePercent: 10, storedRetainagePercent: 0,
      }],
      totals: {
        totalScheduledValue: 100, totalCompletedAndStored: 0, totalRetainage: 0,
        totalEarnedLessRetainage: 0, currentPaymentDue: 0, balanceToFinish: 100,
        percentComplete: 0,
      },
      savedAt: '2026-04-02',
    };
    const back = aiaRowToSaved(savedToAiaRow(rec, 'u1'));
    close('AMOUNT CERTIFIED survives the round trip', back.amountCertified ?? -1, 58_200);
    eq('…with its date and explanation', [back.certifiedDate, back.certifiedExplanation],
      ['2026-04-08', 'Backcharge on drywall']);
    eq('the notary jurat survives', [back.notarize, back.notaryState, back.notaryCounty],
      [true, 'Texas', 'Harris']);
    eq('the billing window survives', back.periodFrom, '2026-03-01');
    // Reprinting a SENT certificate must reproduce the document that went out.
    // Recomputing the four-row table from today's change orders restates it the
    // moment a CO approved inside the period is entered after the fact.
    eq('the CHANGE ORDER SUMMARY that was certified survives, rather than being recomputed',
      back.changeOrderSummary?.thisPeriodDeductions, 20_000);
    eq('line 5b’s rate survives, including an explicit 0', back.storedRetainagePercent, 0);
    eq('…and per-line, inside the lines JSONB', back.lines[0].storedRetainagePercent, 0);
    // The sidecar must never leak: the portal snapshot and the WIP report both
    // read `totals`, and an extra key on it is an extra key on every consumer.
    eq('the sidecar does not leak into totals',
      Object.keys(back.totals).some(k => k.startsWith('__')), false);
    // A record using none of them must write the row it always wrote.
    const plain = { ...rec };
    delete plain.periodFrom; delete plain.storedRetainagePercent; delete plain.amountCertified;
    delete plain.certifiedDate; delete plain.certifiedExplanation; delete plain.changeOrderSummary;
    delete plain.notarize; delete plain.notaryState; delete plain.notaryCounty;
    eq('a certificate using none of them writes a byte-identical snapshot_totals',
      JSON.stringify(savedToAiaRow(plain, 'u1').snapshot_totals), JSON.stringify(plain.totals));

    // …AND THE SIDECAR MUST NOT DISABLE THE `snapshot_totals`-MISSING REPAIR.
    //
    // `savedToAiaRow` writes `{...(a.totals ?? {}), __mageCertificate: …}`, so a
    // record with NO totals but any certificate field still writes a non-null
    // snapshot_totals whose only key is the sidecar. The reader's
    // "snapshot is an object" test then fired, the sidecar was stripped, and
    // `totals` came back `{}` instead of being recomputed from the lines — so
    // the NEXT period seeded line 7 from `priorAIA.totals?.… ?? 0` and billed
    // "less previous certificates = $0". The byte-identical assertion above
    // cannot see this: it only covers the record that sets nothing.
    {
      const noTotals = { ...rec, totals: undefined } as unknown as SavedAIAPayApp;
      const bare = aiaRowToSaved(savedToAiaRow(
        { ...noTotals, periodFrom: undefined } as SavedAIAPayApp, 'u1') as never);
      const withSidecar = aiaRowToSaved(savedToAiaRow(
        { ...noTotals, periodFrom: '2026-03-01' } as SavedAIAPayApp, 'u1') as never);
      eq('a record with no totals is repaired from its lines — sidecar or not',
        [typeof bare.totals?.currentPaymentDue, typeof withSidecar.totals?.currentPaymentDue],
        ['number', 'number']);
      eq('…to the SAME figures, so the sidecar changes no money',
        JSON.stringify(withSidecar.totals), JSON.stringify(bare.totals));
      eq('…and the sidecar still rides home on the repaired record',
        withSidecar.periodFrom, '2026-03-01');
    }
  }

  // ── The TWO copies of the retainage math must agree ───────────────────────
  // utils/projectContextPure.aiaTotalsFromLines is a second implementation of
  // computeAIATotals (it exists so a row with no snapshot_totals can be
  // repaired without loading expo-print). A copy that did not learn about
  // line 5b would recompute a DIFFERENT total retainage from the one the
  // certificate was signed with — and only on the archived rows that have no
  // snapshot to fall back on, which is the hardest possible place to notice.
  {
    const mixed: AIASOVLine[] = [
      line({ id: 'a', fromPreviousApp: 1_000, thisPeriod: 5_000, materialsPresentlyStored: 4_000, retainagePercent: 10, storedRetainagePercent: 0 }),
      line({ id: 'b', fromPreviousApp: 0, thisPeriod: 2_000, materialsPresentlyStored: 1_000, retainagePercent: 5 }),
    ];
    const authoritative = computeAIATotals(app({ lines: mixed, contractSumToDate: 20_000 }));
    const repaired = aiaTotalsFromLines(mixed as never, 20_000, 0);
    close('the repair path computes the same total retainage',
      roundCents(repaired.totalRetainage), authoritative.totalRetainage, 0.01);
    close('…and therefore the same current payment due',
      roundCents(repaired.currentPaymentDue), authoritative.currentPaymentDue, 0.01);
  }

  // ── The schedule-of-values editor ─────────────────────────────────────────
  {
    const ls = [line({ id: 'a', itemNo: '1' }), line({ id: 'b', itemNo: '2' }), line({ id: 'c', itemNo: '3' })];
    eq('a line can be moved down', moveSovLine(ls, 'a', 1).map(l => l.id), ['b', 'a', 'c']);
    eq('…and up', moveSovLine(ls, 'c', -1).map(l => l.id), ['a', 'c', 'b']);
    eq('moving off either end is a no-op, not a throw', moveSovLine(ls, 'a', -1).map(l => l.id), ['a', 'b', 'c']);
    eq('renumbering is 1..N', renumberSovLines(moveSovLine(ls, 'a', 2)).map(l => l.itemNo), ['1', '2', '3']);
    eq('a new line never collides with an existing id',
      ls.some(l => l.id === newSovLine(ls, 10).id), false);
    // itemNo is carryForwardPriorLines' FALLBACK key, so a renumber must not
    // be something the editor does behind the GC's back after every insert.
    eq('reordering alone does NOT renumber', moveSovLine(ls, 'a', 2).map(l => l.itemNo), ['2', '3', '1']);
  }

  // ══ 2026-09-11 adversarial review: the guards that used to stay GREEN ══════
  // Everything below exists because a mutation of the code it protects left
  // the previous suite passing. Each block names the mutation it now catches.

  // ── ONE PERIOD END. Line 2 and the printed CHANGE ORDER SUMMARY could state
  // two different NET CHANGE figures on the same page: the CO split ran on the
  // invoice's issue date while the summary ran on the PERIOD TO the GC had
  // just typed. Measured, not inferred — invoice 2026-04-10, PERIOD TO set to
  // 2026-03-31, CO #1 +$50,000 on 02-10 and CO #2 +$20,000 on 04-05 gave
  // $70,000 on line 2 against $50,000 in the summary.
  {
    const co = (id: string, n: number, when: string, amt: number) => ({
      id, number: n, status: 'approved' as const, date: when, updatedAt: when,
      changeAmount: amt, description: `CO ${n}`,
    });
    const cos = [co('c1', 1, '2026-02-10', 50_000), co('c2', 2, '2026-04-05', 20_000)];
    // Seeded against the invoice's issue date, the way a fresh application is.
    const seeded = app({
      originalContractSum: 100_000, netChangeByCO: 70_000, contractSumToDate: 170_000,
      periodTo: '2026-04-10',
      lines: [line({ id: 'sov_co:c1', scheduledValue: 50_000 }), line({ id: 'sov_co:c2', scheduledValue: 20_000 })],
    });
    const typed = '2026-03-31';
    const restated = applyApprovedCOsToApplication(
      { ...seeded, periodTo: typed },
      splitApprovedCOsByPeriod(cos, typed).inPeriod,
    );
    const summary = summarizeChangeOrders(cos, undefined, typed);
    close('editing PERIOD TO restates G702 line 2', restated.netChangeByCO, 50_000);
    close('…and line 3, Contract Sum to Date', restated.contractSumToDate, 150_000);
    close('…and the printed CHANGE ORDER SUMMARY agrees with line 2',
      summary.netChange, restated.netChangeByCO);
    eq('…the change order that fell out of the period loses its G703 row',
      restated.lines.some(l => l.id === 'sov_co:c2'), false);
    // Money already billed is never taken off a certificate silently.
    const billed = applyApprovedCOsToApplication(
      {
        ...seeded,
        periodTo: typed,
        lines: [line({ id: 'sov_co:c1', scheduledValue: 50_000 }),
          line({ id: 'sov_co:c2', scheduledValue: 20_000, thisPeriod: 8_000 })],
      },
      splitApprovedCOsByPeriod(cos, typed).inPeriod,
    );
    eq('…unless that row has been billed, which is never dropped in silence',
      billed.lines.some(l => l.id === 'sov_co:c2'), true);
    // A CO approved back INTO the period reappears as a row.
    const widened = applyApprovedCOsToApplication(
      { ...seeded, periodTo: '2026-04-30', lines: [line({ id: 'sov_co:c1', scheduledValue: 50_000 })] },
      splitApprovedCOsByPeriod(cos, '2026-04-30').inPeriod,
    );
    eq('a change order brought back into the period gets its row back',
      widened.lines.some(l => l.id === 'sov_co:c2'), true);
    close('…and line 2 with it', widened.netChangeByCO, 70_000);
  }
  eq('the screen drives the CO split, line 2 and the printed summary off ONE date',
    /const effectivePeriodTo = app\?\.periodTo \|\| seedPeriodTo;/.test(aiaScreen)
    && /splitApprovedCOsByPeriod\(getChangeOrdersForProject\(project\.id\), effectivePeriodTo\)/.test(aiaScreen)
    && /summarizeChangeOrders\(getChangeOrdersForProject\(project\.id\), app\?\.periodFrom, effectivePeriodTo\)/.test(aiaScreen), true);
  eq('…and both period fields are wired to the handlers that restate it',
    /onChangeText=\{setPeriodTo\}/.test(aiaScreen)
    && /onChangeText=\{setPeriodFrom\}/.test(aiaScreen), true);

  // ── THE SCREEN'S OWN PERIOD HANDLERS, EXECUTED ────────────────────────────
  //
  // The assertions above say which expressions appear in the file. They cannot
  // say the handler is reached, and they could not see the half of this defect
  // that shipped: `buildSavedRecord` deliberately FREEZES the four-row summary
  // into the record, the print path reads `app.changeOrderSummary ??
  // coSummaryForPdf`, and so the frozen table wins on every reopened
  // certificate. Editing PERIOD FROM moved the window printed in the header
  // while the ADDITIONS/DEDUCTIONS split beneath it still described the old
  // window — and `coFiguresAgree` compares netChange, which a re-split does not
  // move, so no banner fired. Both handlers are lifted out of the shipped
  // screen and run here against a captured reducer.
  {
    const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
    const src = readFileSync(join(ROOT, 'app', 'aia-pay-app.tsx'), 'utf8');
    const BEGIN = '// --- BEGIN period handlers ---';
    const END = '// --- END period handlers ---';
    const from = src.indexOf(BEGIN);
    const to = src.indexOf(END);
    if (from < 0 || to < 0) {
      console.error('\n  ✗ could not find the period-handler sentinels in app/aia-pay-app.tsx.');
      console.error('    Someone moved or renamed them; a certificate could go back to printing');
      console.error('    two different NET CHANGE BY CHANGE ORDER figures on one page.');
      process.exit(1);
    }
    const js = new Bun.Transpiler({ loader: 'ts' })
      .transformSync(src.slice(from + BEGIN.length, to));

    type Reducer = (prev: AIAPayApplication | null) => AIAPayApplication | null;
    const build = (isReadOnly: boolean) => {
      let captured: Reducer | AIAPayApplication | null = null;
      const handlers = new Function(
        'useCallback', 'isReadOnly', 'setApp', 'project', 'getChangeOrdersForProject',
        'isCalendarDay', 'applyApprovedCOsToApplication', 'splitApprovedCOsByPeriod',
        `${js}\nreturn { setPeriodFrom, setPeriodTo };`,
      )(
        (fn: unknown) => fn,
        isReadOnly,
        (r: Reducer) => { captured = r; },
        { id: 'p1' },
        () => [
          { id: 'c1', number: 1, status: 'approved', date: '2026-02-10', updatedAt: '2026-02-10', changeAmount: 50_000, description: 'CO 1' },
          { id: 'c2', number: 2, status: 'approved', date: '2026-04-05', updatedAt: '2026-04-05', changeAmount: 20_000, description: 'CO 2' },
        ],
        isCalendarDay, applyApprovedCOsToApplication, splitApprovedCOsByPeriod,
      ) as { setPeriodFrom: (v: string) => void; setPeriodTo: (v: string) => void };
      return {
        ...handlers,
        run: (prev: AIAPayApplication) => (captured as Reducer | null)?.(prev) ?? null,
        touched: () => captured != null,
        reset: () => { captured = null; },
      };
    };

    /** A REOPENED certificate: seeded across the whole CO history, carrying the
     *  frozen summary buildSavedRecord wrote. */
    const reopened = (): AIAPayApplication => app({
      originalContractSum: 100_000, netChangeByCO: 70_000, contractSumToDate: 170_000,
      periodTo: '2026-04-10', periodFrom: '2026-04-01',
      lines: [line({ id: 'sov_co:c1', scheduledValue: 50_000 }), line({ id: 'sov_co:c2', scheduledValue: 20_000 })],
      changeOrderSummary: {
        priorAdditions: 50_000, priorDeductions: 0,
        thisPeriodAdditions: 20_000, thisPeriodDeductions: 0,
        totalAdditions: 70_000, totalDeductions: 0, netChange: 70_000,
      },
    });

    // PERIOD FROM: the split moves, so the frozen table must not print.
    // The frozen table was written for a window opening 2026-04-01 (CO #1 prior,
    // CO #2 this month). Correcting PERIOD FROM back to 2026-02-01 moves CO #1
    // into THIS month, so the frozen split is now wrong by $50,000 of
    // ADDITIONS — measured below, not assumed.
    const hFrom = build(false);
    hFrom.setPeriodFrom('2026-02-01');
    const afterFrom = hFrom.run(reopened());
    eq('editing PERIOD FROM drops the frozen CHANGE ORDER SUMMARY',
      [afterFrom?.periodFrom, afterFrom?.changeOrderSummary], ['2026-02-01', undefined]);
    // …and the live table the screen then prints really does read differently,
    // which is what made the frozen one a lie rather than a redundancy.
    {
      const cos = [
        { id: 'c1', number: 1, status: 'approved' as const, date: '2026-02-10', updatedAt: '2026-02-10', changeAmount: 50_000, description: 'CO 1' },
        { id: 'c2', number: 2, status: 'approved' as const, date: '2026-04-05', updatedAt: '2026-04-05', changeAmount: 20_000, description: 'CO 2' },
      ];
      const live = summarizeChangeOrders(cos, afterFrom?.periodFrom, afterFrom?.periodTo);
      eq('…because the live split for the new window is a different table',
        [live.priorAdditions, live.thisPeriodAdditions], [0, 70_000]);
      eq('…while still footing to G702 line 2, which PERIOD FROM does not move',
        live.netChange, afterFrom?.netChangeByCO);
    }
    // A CLEARED field is `undefined`, not the empty string a date parser would
    // sweep every change order under.
    const hClear = build(false);
    hClear.setPeriodFrom('');
    eq('clearing PERIOD FROM stores undefined, not ""',
      hClear.run(reopened())?.periodFrom, undefined);

    // PERIOD TO: restates line 2, line 3, the G703 rows AND the frozen table.
    const hTo = build(false);
    hTo.setPeriodTo('2026-03-31');
    const afterTo = hTo.run(reopened());
    eq('editing PERIOD TO restates the contract, not just the label',
      [afterTo?.netChangeByCO, afterTo?.contractSumToDate, afterTo?.changeOrderSummary,
        afterTo?.lines.some(l => l.id === 'sov_co:c2')],
      [50_000, 150_000, undefined, false]);
    // An unreadable date must not restate anything — it would sweep in every CO.
    const hBad = build(false);
    hBad.setPeriodTo('3/31/26');
    const afterBad = hBad.run(reopened());
    // Nothing else moves — not line 2, and not the frozen table either. Dropping
    // the isCalendarDay guard here does NOT show up in line 2 (an unreadable date
    // makes onOrBeforeDay return true, so every CO is swept in and the figure
    // happens to be unchanged); it shows up as the frozen summary being discarded
    // and replaced by a live one computed from a date nothing can read. Measured.
    eq('an unreadable PERIOD TO changes the label and nothing else',
      [afterBad?.periodTo, afterBad?.netChangeByCO, afterBad?.changeOrderSummary?.netChange],
      ['3/31/26', 70_000, 70_000]);

    // REACHABILITY: a certified certificate is read-only and neither handler
    // may touch it. A grep for the handler body cannot see this guard at all.
    const locked = build(true);
    locked.setPeriodFrom('2026-03-01');
    eq('a read-only certificate refuses a PERIOD FROM edit', locked.touched(), false);
    // Reset, so this next assertion is about the PERIOD TO guard and not about
    // the one above it — without it, breaking setPeriodFrom alone reddened both
    // and the second said nothing of its own. Measured: it did.
    locked.reset();
    locked.setPeriodTo('2026-03-31');
    eq('…and a PERIOD TO edit', locked.touched(), false);
  }
  eq('…with a banner if the two figures ever disagree anyway',
    /testID="aia-co-figures-disagree"/.test(aiaScreen)
    && /const coFiguresAgree =/.test(aiaScreen), true);
  // …AND THE BANNER'S ADVICE HAS TO BE FOLLOWABLE. It gave one instruction on
  // every certificate — "Re-enter Period To, or tap the refresh button above"
  // — while on a read-only record setPeriodTo bails, the PERIOD TO input is
  // `editable={!isReadOnly}` and the refresh chip is not rendered at all. Every
  // SAVED certificate is read-only until the GC taps Edit, and a paid one
  // permanently, so the advice pointed at nothing on exactly the certificates
  // where the two figures can still disagree. Executed, three states:
  {
    const advice = (isReadOnly: boolean, isLocked: boolean) =>
      coFiguresAdvice({ isReadOnly, isLocked, editLabel: 'Edit draft' });
    const editable = advice(false, false), review = advice(true, false), locked = advice(true, true);
    eq('the two-figures banner sends an EDITABLE certificate to PERIOD TO and the refresh button',
      [/re-enter PERIOD TO/i.test(editable), /refresh button/i.test(editable)], [true, true]);
    eq('…sends a SAVED one to the Edit button first, by the name that button carries',
      [/Edit draft/.test(review), /read-only/i.test(review), review === editable], [true, true, false]);
    // The one that matters: a locked certificate has neither control on screen,
    // so naming either of them is advice the GC cannot act on. Collapsing the
    // three cases back to one sentence fails here.
    eq('…and never sends a LOCKED one to controls that are not on the screen',
      [/re-enter PERIOD TO/i.test(locked), /refresh button above/i.test(locked),
        /next application/i.test(locked), locked === editable || locked === review],
      [false, false, true, false]);
    eq('…and the banner prints that advice rather than a sentence of its own',
      /coFiguresAdvice\(\{ isReadOnly, isLocked, editLabel: reviewNotice\.editLabel \}\)/.test(aiaScreen)
      && !/Re-enter Period To, or tap the refresh button above/.test(aiaScreen), true);
  }

  // ── THE FOUR-ROW CHANGE ORDER SUMMARY IS ACTUALLY PRINTED.
  // summarizeChangeOrders was unit-tested in isolation and buildAIAPayAppHtml
  // was never once called with a `changeOrderSummary`, so replacing
  // `const coSummary = app.changeOrderSummary` with `undefined` — every
  // certificate silently falling back to the single net row — left the suite
  // green.
  {
    const withSummary = buildAIAPayAppHtml(app({
      netChangeByCO: 30_000,
      changeOrderSummary: {
        priorAdditions: 50_000, priorDeductions: 0,
        thisPeriodAdditions: 4_000, thisPeriodDeductions: 20_000,
        totalAdditions: 54_000, totalDeductions: 20_000, netChange: 34_000,
      },
    }), { companyName: 'GC' } as never);
    eq('the printed G702 carries the form’s four change-order rows',
      /Total changes approved in previous months by Owner/.test(withSummary)
      && /Total approved this month/.test(withSummary)
      && />TOTAL</.test(withSummary)
      && /NET CHANGES by Change Order/.test(withSummary), true);
    eq('…with this month’s figures, not last month’s',
      /\$ 4,000\.00/.test(withSummary) && /\$ 54,000\.00/.test(withSummary), true);
    eq('…and the single net row only when there is no summary to print',
      /Net change by Change Orders/.test(buildAIAPayAppHtml(app(), { companyName: 'GC' } as never))
      && /Net change by Change Orders/.test(withSummary) === false, true);
  }

  // ── THE HEADER'S HAND-TICKED FIELD (F18 remainder).
  // "Distribution to: OWNER / ARCHITECT / CONTRACTOR / FIELD / OTHER" is on the
  // 1992 form's face and was absent from the generator. Executed against the
  // real HTML because the five labels alone would pass while the boxes the GC
  // actually ticks were missing.
  {
    const html = buildAIAPayAppHtml(app(), { companyName: 'GC' } as never);
    const block = html.slice(html.indexOf('class="distribution"'), html.indexOf('<!-- Application summary -->'));
    eq('the printed G702 carries the Distribution to: block',
      [/Distribution to:/.test(html),
        ['OWNER', 'ARCHITECT', 'CONTRACTOR', 'FIELD', 'OTHER'].every(w => block.includes(w)),
        (block.match(/class="dist-box"/g) ?? []).length],
      [true, true, 5]);
    eq('…and it is a tick-box field, not five words of prose',
      /\.dist-box \{[\s\S]{0,120}border: 1px solid/.test(html), true);
  }

  // ── THE OVER-BILL WARNING IS THE SAME RULE ON THE ROW AND IN THE BANNER.
  // `findOverBilledLines` was well tested and nothing tied it to the screen:
  // `const isOver = false`, `overBilledLines` returning `[]`, and killing the
  // aggregate banner's condition all left the suite green, because the guards
  // grepped for style names and testIDs that survive every one of them.
  {
    close('a line billed past its scheduled value reports the overage',
      lineOverBill({ scheduledValue: 38_000, fromPreviousApp: 0, thisPeriod: 45_000, materialsPresentlyStored: 0 }),
      7_000);
    close('stored material counts toward it, as it does toward column G',
      lineOverBill({ scheduledValue: 10_000, fromPreviousApp: 0, thisPeriod: 9_000, materialsPresentlyStored: 2_000 }),
      1_000);
    close('a line billed exactly to its scheduled value is not over',
      lineOverBill({ scheduledValue: 10_000, fromPreviousApp: 0, thisPeriod: 10_000, materialsPresentlyStored: 0 }), 0);
    close('a deductive change-order line is not an over-bill',
      lineOverBill({ scheduledValue: -5_000, fromPreviousApp: 0, thisPeriod: -5_000, materialsPresentlyStored: 0 }), 0);
    close('the aggregate list is the same rule, so the two cannot drift',
      findOverBilledLines({ lines: [line({ scheduledValue: 38_000, thisPeriod: 45_000 })] })[0].overBy,
      lineOverBill({ scheduledValue: 38_000, fromPreviousApp: 0, thisPeriod: 45_000, materialsPresentlyStored: 0 }));
  }
  eq('the row that paints itself red uses that one rule',
    /const over = lineOverBill\(line\);/.test(aiaScreen)
    && /const isOver = over > 0;/.test(aiaScreen), true);
  eq('…and the aggregate banner is still wired to findOverBilledLines',
    /const overBilledLines = useMemo\(\(\) => \(app \? findOverBilledLines\(app\) : \[\]\), \[app\]\);/.test(aiaScreen)
    && /\{\(overBilledLines\.length > 0 \|\| totalOverBilled > 0\.01\) && \(/.test(aiaScreen), true);

  // ── THE TIMEZONE FIX, INDEPENDENT OF THE RUNNER'S TIMEZONE.
  // The previous assertion only failed west of Greenwich: under TZ=UTC — the
  // default on essentially every CI runner — reverting fmtDate to
  // `new Date(iso)` left it GREEN, certifying the bug it was written for.
  // Force a negative-offset zone for the duration instead of hoping for one.
  {
    const originalTZ = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Niue'; // UTC−11: UTC midnight is the day before
      const dated = buildAIAPayAppHtml(
        app({ periodTo: '2026-08-31', periodFrom: '2026-08-01', applicationDate: '2026-09-01' }),
        { companyName: 'GC' } as never,
      );
      eq('PERIOD TO holds its calendar day 11 hours west of Greenwich',
        /August 31, 2026/.test(dated) && !/August 30, 2026/.test(dated), true);
      eq('…and so does APPLICATION DATE',
        /September 1, 2026/.test(dated) && !/August 31, 2026, /.test(dated), true);
      // Prove the zone is really being applied, or the assertion above is a
      // tautology that would pass with the defect reinstated.
      eq('…and this runner really is rendering in that zone',
        new Date('2026-08-31').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        'August 30, 2026');
    } finally {
      if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ;
    }
  }

  // ── REFRESH FROM CONTRACT KEEPS THE GC'S WORK.
  // The version this replaces spread `...fresh` and re-applied a hand-picked
  // list of header fields, so one tap dropped AMOUNT CERTIFIED, the certified
  // date and explanation, the notes and any hand-set line 7 — and, because
  // fresh.lines is rebuilt from the estimate, every line the GC had added with
  // this same wave's new SOV editor.
  {
    const prev = app({
      amountCertified: 58_200, certifiedDate: '2026-04-08', certifiedExplanation: 'Backcharge',
      notes: 'Send to the lender', lessPreviousCertificates: 41_000,
      notarize: true, notaryState: 'Texas',
      originalContractSum: 100_000, netChangeByCO: 0, contractSumToDate: 100_000,
      lines: [
        line({ id: 'sov_a', itemNo: '3.1', description: 'Framing (negotiated)', scheduledValue: 40_000, thisPeriod: 9_000, materialsPresentlyStored: 4_000, retainagePercent: 5 }),
        line({ id: 'sov_manual_x', itemNo: '99', description: 'T&M ticket 14', scheduledValue: 2_500, thisPeriod: 2_500 }),
      ],
    });
    const fresh = app({
      originalContractSum: 120_000, netChangeByCO: 10_000, contractSumToDate: 130_000,
      sovBasis: 'linked_estimate',
      lines: [
        line({ id: 'sov_a', itemNo: '1', description: 'Framing', scheduledValue: 45_000 }),
        line({ id: 'sov_co:c9', itemNo: '2', description: 'CO #9 — new bath', scheduledValue: 10_000 }),
      ],
    });
    const m = mergeRefreshedContract(prev, fresh);
    eq('refreshing does not throw away what the architect certified',
      [m.amountCertified, m.certifiedDate, m.certifiedExplanation], [58_200, '2026-04-08', 'Backcharge']);
    eq('…nor the notes, nor a hand-set line 7',
      [m.notes, m.lessPreviousCertificates], ['Send to the lender', 41_000]);
    eq('…nor a line the GC added himself',
      m.lines.some(l => l.id === 'sov_manual_x'), true);
    eq('…nor the item numbers he typed', m.lines.find(l => l.id === 'sov_a')?.itemNo, '3.1');
    close('…nor a single figure he entered',
      m.lines.find(l => l.id === 'sov_a')?.thisPeriod ?? -1, 9_000);
    close('…nor column F', m.lines.find(l => l.id === 'sov_a')?.materialsPresentlyStored ?? -1, 4_000);
    close('…nor a per-line retainage override',
      m.lines.find(l => l.id === 'sov_a')?.retainagePercent ?? -1, 5);
    // What refresh IS for.
    close('column C on a contract line IS refreshed — that is the whole point',
      m.lines.find(l => l.id === 'sov_a')?.scheduledValue ?? -1, 45_000);
    close('…and so are the three contract scalars', m.contractSumToDate, 130_000);
    eq('…and a newly approved change order arrives as a new row',
      m.lines.some(l => l.id === 'sov_co:c9'), true);
    eq('…and a frozen CO summary is dropped so the refreshed one prints',
      m.changeOrderSummary, undefined);
  }
  eq('the screen refreshes through that merge, not a spread of the fresh app',
    /mergeRefreshedContract\(prev, fresh\)/.test(aiaScreen), true);

  // ── APPLICATION NO. REACHES THE SEED.
  // `nextApplicationNumber(savedForProject, invoice?.id)` being CALLED proves
  // nothing: the memo is also read by the override note, so putting
  // `applicationNumber: invoice.number` back into the seed — the original
  // defect, a first G702 opening at "#3" — left the guard green.
  eq('the resolved sequence number is what the seed actually uses',
    /applicationNumber: resolvedApplicationNumber,/.test(aiaScreen)
    && /applicationNumber: invoice\.number/.test(aiaScreen) === false, true);
  eq('…and two certificates at one number are called out',
    /testID="aia-appno-collision"/.test(aiaScreen), true);

  // ── DATES THAT CANNOT BE PARSED FAIL LOUDLY.
  // dayKey returns null and selectPriorApplication drops to sequence ordering;
  // onOrBeforeDay returns TRUE and splitApprovedCOsByPeriod sweeps EVERY
  // approved change order onto the certificate. Both silent, both undoing the
  // fix the field was added for.
  {
    eq('a bare calendar day is accepted', isCalendarDay('2026-03-31'), true);
    eq('…and the head of an ISO timestamp', isCalendarDay('2026-03-31T18:04:00.000Z'), true);
    eq('"3/31/26" is not a date this form can reason about', isCalendarDay('3/31/26'), false);
    eq('…nor is an empty field', isCalendarDay(''), false);
    // The consequence, executed, so the warning copy is not merely plausible.
    const cos = [{ number: 9, status: 'approved' as const, date: '2026-12-01', updatedAt: '2026-12-01', changeAmount: 1 }];
    eq('an unparseable period end really does sweep in every approved CO',
      splitApprovedCOsByPeriod(cos, '3/31/26').inPeriod.length, 1);
  }
  eq('the screen says so at each date field instead of swallowing it',
    /testID="aia-period-to-error"/.test(aiaScreen)
    && /testID="aia-period-from-error"/.test(aiaScreen)
    && /testID="aia-application-date-error"/.test(aiaScreen)
    && /testID="aia-certified-date-error"/.test(aiaScreen), true);
  eq('…and refuses to restate the contract from a date it cannot read',
    /if \(!isCalendarDay\(v\)\) return next;/.test(aiaScreen), true);

  // ── CONTRACT DATE prints on every G702 and had no writer anywhere, so the
  // header box printed an em dash forever.
  eq('CONTRACT DATE can be filled in', /testID="aia-contract-date"/.test(aiaScreen), true);
  eq('…and still reaches the record and the print',
    /contractDate: app\.contractDate,/.test(aiaScreen)
    && /contractDate: rec\.contractDate,/.test(billing), true);

  // ── G703 COLUMN I was modelled, summed into line 5 and printed, and nothing
  // in the app could set it: both retainage controls wrote every line at once.
  eq('per-line retainage — the reason column I exists — is reachable',
    /testID={`aia-line-retainage-\$\{line\.id\}`}/.test(aiaScreen)
    && /testID={`aia-line-stored-retainage-\$\{line\.id\}`}/.test(aiaScreen), true);

  // ── DELETING A BILLED ROW is refused by a rule that can be executed.
  {
    eq('a row carrying billed money may not be deleted',
      sovLineDeletionRefusal(line({ thisPeriod: 4_000 }))?.title, 'This line has been billed');
    eq('…a credit row counts as billed too',
      !!sovLineDeletionRefusal(line({ thisPeriod: -4_000 })), true);
    eq('…an empty row deletes without argument', sovLineDeletionRefusal(line()), null);
    eq('…and a row that is already gone is not an error', sovLineDeletionRefusal(undefined), null);
  }

  // ── THE RECORD'S IDENTITY IS THE RECORD, NOT A NUMBER DERIVED FROM IT.
  // The screen moved identity onto invoiceId and made APPLICATION NO. editable
  // in the same change, while addAIAPayApp still de-duped on
  // (projectId, applicationNumber) — so typing a number another pay app held
  // deleted that record locally while leaving its row on the server.
  eq('addAIAPayApp de-dupes on the record, not on the application number',
    /const sameRecord = \(a: SavedAIAPayApp\) => \{/.test(ctx)
    && /if \(a\.id === finalApp\.id\) return true;/.test(ctx)
    && /if \(finalApp\.invoiceId && a\.invoiceId\) return a\.invoiceId === finalApp\.invoiceId;/.test(ctx), true);
  eq('…and the old application-number key is gone',
    /!\(a\.projectId === finalApp\.projectId && a\.applicationNumber === finalApp\.applicationNumber\)/.test(ctx), false);
  eq('…and a record it genuinely displaces leaves the server too',
    /supabaseWrite\('aia_pay_apps', 'delete', \{ id: a\.id \}\)/.test(ctx), true);
}

// ── AIA-F11: THE TWO WRITERS THAT MADE COLUMN C UNDER-FOOT ─────────────────
//
// G703 column C is Σ items.lineTotal (utils/aiaBilling.buildAIASovLines) and
// G702 line 3 is the estimate's grandTotal. app/area-takeoff.tsx and
// app/plan-intelligence.tsx appended a line whose lineTotal EXCLUDED markup
// while raising grandTotal by the cost PLUS its share of markup, so every
// certificate for a job either screen had touched under-footed by exactly that
// markup — measured at $7,200 on a $40,000 takeoff addition to a $118,000
// estimate carrying 18% — and the reconciliation banner told the GC to fix an
// estimate that was already correct.
//
// EXECUTED, not grepped: each screen's append arithmetic is lifted out of the
// shipped file between its sentinels and run, then the resulting estimate is
// fed through the REAL seeding and reconciliation. A regex could not tell a
// marked-up lineTotal from a cost one.
{
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const lift = (file: string, begin: string, end: string): string => {
    const src = readFileSync(join(ROOT, file), 'utf8');
    const from = src.indexOf(begin);
    const to = src.indexOf(end);
    if (from < 0 || to < 0) {
      console.error(`\n  ✗ could not find the append sentinels in ${file}.`);
      console.error('    Someone moved or renamed the block; column C could silently go back to');
      console.error('    under-footing G702 line 3 on every project this screen touches.');
      process.exit(1);
    }
    return new Bun.Transpiler({ loader: 'ts' }).transformSync(src.slice(from + begin.length, to));
  };

  type EstItem = {
    materialId: string; name: string; category: string; unit: string;
    quantity: number; unitPrice: number; bulkPrice: number; markup: number;
    usesBulk: boolean; lineTotal: number; supplier: string;
  };
  type Est = {
    id: string; items: EstItem[]; globalMarkup: number;
    baseTotal: number; markupTotal: number; grandTotal: number; createdAt: string;
  };
  /** A job estimated the estimator's way: Σ lineTotal === grandTotal, 18% on
   *  $100,000 of material. This is the shape full.tsx:986 writes. */
  const cleanEstimate = (): Est => ({
    id: 'e1', globalMarkup: 18, baseTotal: 100_000, markupTotal: 18_000, grandTotal: 118_000,
    createdAt: '2026-01-01',
    items: [{
      materialId: 'm1', name: 'Base scope', category: 'Framing', unit: 'ea',
      quantity: 1, unitPrice: 100_000, bulkPrice: 100_000, markup: 18,
      usesBulk: false, lineTotal: 118_000, supplier: '',
    }],
  });

  const takeoffAppend = new Function(
    'est', 'costLineTotal', 'category', 'qty', 'effectiveRate', 'name', 'unit',
    'isAtCostLine', 'roundCents', 'generateUUID',
    `${lift('app/area-takeoff.tsx', '// --- BEGIN takeoff append ---', '// --- END takeoff append ---')}\nreturn next;`,
  ) as (
    est: Est, costLineTotal: number, category: string, qty: number, rate: number,
    name: string, unit: string,
    isAtCost: (i: { category: string }) => boolean,
    round: (n: number) => number, uuid: () => string,
  ) => Est;

  const planAppend = new Function(
    'est', 'lines', 'isAtCostLine', 'roundCents', 'generateUUID',
    `${lift('app/plan-intelligence.tsx', '// --- BEGIN plan append ---', '// --- END plan append ---')}\nreturn next;`,
  ) as (
    est: Est,
    lines: { name: string; category: string; unit: string; quantity: number; unitPrice: number; lineTotal: number }[],
    isAtCost: (i: { category: string }) => boolean,
    round: (n: number) => number, uuid: () => string,
  ) => Est;

  let n = 0;
  const uuid = () => `gen_${++n}`;
  /** The whole point: does the printed certificate foot to the contract it
   *  bills? Runs the SHIPPED seeding, not a copy of column C. */
  const certificate = (est: Est) => {
    const project = { id: 'p1', name: 'Job', status: 'active', linkedEstimate: est } as unknown as Project;
    const inv = {
      id: 'inv1', projectId: 'p1', number: 1, type: 'progress', status: 'sent',
      issueDate: '2026-03-31', dueDate: '2026-04-30', lineItems: [],
      subtotal: 0, taxAmount: 0, totalDue: 0, amountPaid: 0, retentionPercent: 10,
    } as unknown as Invoice;
    return reconcileAIASov(
      seedAIAPayApplicationFromInvoice(inv, project, [], { companyName: 'GC' } as never));
  };

  // ── Visual Takeoff: 40,000 SF at $1.00 onto the 18% job ──────────────────
  const afterTakeoff = takeoffAppend(
    cleanEstimate(), 40_000, 'Drywall', 40_000, 1, 'Drywall (takeoff)', 'SF',
    isAtCostLine as never, roundCents, uuid);
  const takeoffLine = afterTakeoff.items[1];
  eq('Visual Takeoff prices the appended line at SELL, not cost',
    [takeoffLine.lineTotal, takeoffLine.unitPrice, roundCents(takeoffLine.markup)],
    [47_200, 1, 18]);
  eq('…so Σ lineTotal is the contract, to the cent',
    [roundCents(afterTakeoff.items.reduce((s, i) => s + i.lineTotal, 0)), afterTakeoff.grandTotal],
    [165_200, 165_200]);
  eq('…baseTotal is still the pre-markup COST budget the WIP report reads',
    [afterTakeoff.baseTotal, afterTakeoff.markupTotal], [140_000, 25_200]);
  eq('…and the G703 finally foots to G702 line 3',
    [certificate(afterTakeoff).difference, certificate(afterTakeoff).reconciled], [0, true]);

  // ── Plan Intelligence: three rooms onto the same job ─────────────────────
  const afterPlan = planAppend(cleanEstimate(), [
    { name: 'Kitchen — finish-out (plan AI)', category: 'Kitchen', unit: 'SF', quantity: 240, unitPrice: 55, lineTotal: 13_200 },
    { name: 'Primary bath — finish-out (plan AI)', category: 'Bathroom', unit: 'SF', quantity: 110, unitPrice: 95, lineTotal: 10_450 },
    { name: 'Living — finish-out (plan AI)', category: 'Living', unit: 'SF', quantity: 420, unitPrice: 28, lineTotal: 11_760 },
  ], isAtCostLine as never, roundCents, uuid);
  eq('Plan Intelligence prices every appended room at SELL',
    afterPlan.items.slice(1).map(i => i.lineTotal), [15_576, 12_331, 13_876.8]);
  eq('…Σ lineTotal is the contract, to the cent',
    [roundCents(afterPlan.items.reduce((s, i) => s + i.lineTotal, 0)), afterPlan.grandTotal],
    [159_783.8, 159_783.8]);
  eq('…the cost budget is still the rooms at their own rates',
    [afterPlan.baseTotal, afterPlan.markupTotal], [135_410, 24_373.8]);
  eq('…and the certificate foots', certificate(afterPlan).reconciled, true);

  // ── THE INVARIANT, not the arithmetic. recomputeEstimate is the canonical
  // total rebuild (the voice-edit path runs the WHOLE estimate through it), and
  // it rebuilds grandTotal as Σ lineTotal from each line's own markup. With the
  // old shape that DELETED the takeoff line's markup on the first voice edit;
  // both appends must now be fixed points of it.
  //
  // AND A RATIO THAT DOES NOT DIVIDE. Both fixtures above carry 18%, and
  // 40 000 × 1.18 = 47 200 exactly — so they pinned the arithmetic while saying
  // nothing about the `roundCents` each writer's own comment justifies
  // ("rounded the way recomputeEstimate rounds, so a later edit is a no-op
  // rather than a cent of drift on the contract value"). Deleting it left the
  // suite green. A one-third markup — $10,000 on a $30,000 base, an ordinary
  // cost-plus-33% job — makes the unrounded product 53 333.333…, and
  // recomputeEstimate's own round2 then moves the line on the first edit.
  const thirdEstimate = (): Est => ({
    id: 'e3', globalMarkup: 33.333333333333336, baseTotal: 30_000, markupTotal: 10_000,
    grandTotal: 40_000, createdAt: '2026-01-01',
    items: [{
      materialId: 'm1', name: 'Base scope', category: 'Framing', unit: 'ea',
      quantity: 1, unitPrice: 30_000, bulkPrice: 30_000, markup: 33.333333333333336,
      usesBulk: false, lineTotal: 40_000, supplier: '',
    }],
  });
  const afterThird = takeoffAppend(
    thirdEstimate(), 40_000, 'Drywall', 40_000, 1, 'Drywall (takeoff)', 'SF',
    isAtCostLine as never, roundCents, uuid);
  eq('a markup that does not divide still lands on a whole cent',
    afterThird.items[1].lineTotal, 53_333.33);

  // ── THE INVARIANT, not the arithmetic. recomputeEstimate is the canonical
  // total rebuild (the voice-edit path runs the WHOLE estimate through it), and
  // it rebuilds grandTotal as Σ lineTotal from each line's own markup. With the
  // old shape that DELETED the takeoff line's markup on the first voice edit;
  // both appends must now be fixed points of it — LINE BY LINE, not just on the
  // three scalars, because a grandTotal that is itself rounded absorbs a
  // fraction of a cent left on an individual line.
  for (const [label, est] of [['Visual Takeoff', afterTakeoff], ['Plan Intelligence', afterPlan],
    ['Visual Takeoff at a third', afterThird]] as const) {
    const again = recomputeEstimate(est as never) as unknown as Est;
    eq(`${label}: the canonical recompute moves nothing — no markup is lost on the first edit`,
      [again.baseTotal, again.markupTotal, again.grandTotal, again.items.map(i => i.lineTotal)],
      [est.baseTotal, est.markupTotal, est.grandTotal, est.items.map(i => i.lineTotal)]);
  }

  // AT-COST LINES TAKE NO MARKUP, because recomputeEstimate would strip it and
  // the estimate would stop footing the moment anything touched it.
  const labourTakeoff = takeoffAppend(
    cleanEstimate(), 10_000, 'Labor', 100, 100, 'Framing crew', 'hrs',
    isAtCostLine as never, roundCents, uuid);
  eq('a LABOR takeoff line stays at cost, and the estimate still foots',
    [labourTakeoff.items[1].markup, labourTakeoff.items[1].lineTotal,
      roundCents(labourTakeoff.items.reduce((s, i) => s + i.lineTotal, 0)), labourTakeoff.grandTotal],
    [0, 10_000, 128_000, 128_000]);
  // …AND SO DOES THE OTHER WRITER'S. The at-cost rule is shared, but only ONE
  // of the two writers was ever run against it: deleting
  // `!isAtCostLine({ category: l.category }) &&` from plan-intelligence left
  // the suite green while the identical deletion in area-takeoff went red.
  // Today the branch is defensive — ROOM_TYPE_LABELS never yields 'labor' or
  // 'assemblies' — but the writer takes its lines as an argument and the
  // teach/AI paths are what feed it, so the rule is only as proved as it is
  // executed. Also carries a markup that does not divide, for the same
  // rounding invariant the takeoff fixture above pins.
  const planMixed = planAppend(thirdEstimate(), [
    { name: 'Primary bath — finish-out (plan AI)', category: 'Bathroom', unit: 'SF', quantity: 110, unitPrice: 95, lineTotal: 10_450 },
    { name: 'Framing crew', category: 'Labor', unit: 'hrs', quantity: 100, unitPrice: 100, lineTotal: 10_000 },
  ], isAtCostLine as never, roundCents, uuid);
  eq('a LABOR plan line stays at cost while the room beside it takes markup',
    [planMixed.items[1].markup, planMixed.items[1].lineTotal,
      planMixed.items[2].markup, planMixed.items[2].lineTotal],
    [33.33333333333333, 13_933.33, 0, 10_000]);
  eq('…and that estimate foots, on the cent, after the canonical recompute',
    [roundCents(planMixed.items.reduce((s, i) => s + i.lineTotal, 0)), planMixed.grandTotal,
      (recomputeEstimate(planMixed as never) as unknown as Est).items.map(i => i.lineTotal)],
    [63_933.33, 63_933.33, planMixed.items.map(i => i.lineTotal)]);

  // AN ESTIMATE WITH NO MARKUP appends at cost and still foots — the zero-ratio
  // branch, which is what a cost-plus job looks like.
  const noMarkup: Est = {
    id: 'e2', globalMarkup: 0, baseTotal: 50_000, markupTotal: 0, grandTotal: 50_000,
    createdAt: '2026-01-01',
    items: [{
      materialId: 'm1', name: 'Base', category: 'Framing', unit: 'ea', quantity: 1,
      unitPrice: 50_000, bulkPrice: 50_000, markup: 0, usesBulk: false,
      lineTotal: 50_000, supplier: '',
    }],
  };
  const flat = takeoffAppend(noMarkup, 5_000, 'Drywall', 5_000, 1, 'Drywall', 'SF',
    isAtCostLine as never, roundCents, uuid);
  eq('a cost-plus estimate appends at cost and still foots',
    [flat.items[1].markup, flat.grandTotal, roundCents(flat.items.reduce((s, i) => s + i.lineTotal, 0))],
    [0, 55_000, 55_000]);

  // ── THE ON-SCREEN HALF OF THE SAME DEFECT ────────────────────────────────
  // Each writer confirms what it just did in a toast, and both named the COST
  // while the contract had moved by the SELL figure — "$40,000 of Drywall" on a
  // line that put $47,200 on the certificate. The fix went in unguarded:
  // reverting `formatMoneyFull(lineTotal)` to `costLineTotal`, and
  // `formatMoney(addedSell)` to `addedBase`, each left the suite green.
  //
  // So EXECUTE the confirmation statement out of the shipped file, with the two
  // figures set far apart and the formatter replaced by one that brackets its
  // argument, and read what it says. A regex on the call site could not tell
  // which variable it received; this can.
  {
    const RESERVED = new Set(['true', 'false', 'null', 'undefined', 'if', 'else', 'return', 'const',
      'let', 'var', 'new', 'typeof', 'in', 'instanceof', 'function', 'this', 'void', 'delete', 'do',
      'while', 'for', 'switch', 'case', 'break', 'continue', 'default', 'try', 'catch', 'finally',
      'throw', 'class', 'extends', 'super', 'yield', 'await', 'async', 'import', 'export', 'with']);
    /** Run the `setter(...)` call that follows `afterSentinel`, and return what it was told. */
    const confirmationSays = (
      file: string, afterSentinel: string, setter: string, bindings: Record<string, unknown>,
    ): string => {
      const src = readFileSync(join(ROOT, file), 'utf8');
      const start = src.indexOf(`${setter}(`, src.indexOf(afterSentinel));
      if (start < 0) {
        console.error(`\n  ✗ ${file}: no ${setter}( after ${afterSentinel}.`);
        console.error('    The confirmation the GC reads is no longer checked; it went back to');
        console.error('    naming the cost once already.');
        process.exit(1);
      }
      let depth = 0, end = -1;
      for (let i = src.indexOf('(', start); i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      const stmt = src.slice(start, end);
      let said = '';
      const names = [...new Set(stmt.match(/[A-Za-z_$][\w$]*/g) ?? [])].filter(n => !RESERVED.has(n));
      const args = names.map(n => (n === setter ? (s: unknown) => { said = String(s); }
        : n in bindings ? bindings[n] : '?'));
      new Function(...names, `${stmt};`)(...args);
      return said;
    };
    const bracketed = (n: number) => `«${n}»`;
    const takeoffSays = confirmationSays(
      'app/area-takeoff.tsx', '// --- END takeoff append ---', 'setLastAdded',
      { quantityLabel: (q: number) => `${q} SF`, qty: 7, category: 'Drywall',
        formatMoneyFull: bracketed, lineTotal: 47_200, costLineTotal: 40_000 });
    eq('Visual Takeoff confirms the SELL figure it just put on the contract, not the cost',
      [takeoffSays.includes('«47200»'), takeoffSays.includes('«40000»')], [true, false]);
    const planSays = confirmationSays(
      'app/plan-intelligence.tsx', '// --- END plan append ---', 'setAddedNote',
      { items: [{}, {}], formatMoney: bracketed, addedSell: 47_200, addedBase: 40_000 });
    eq('Plan Intelligence confirms the SELL figure too',
      [planSays.includes('«47200»'), planSays.includes('«40000»')], [true, false]);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
