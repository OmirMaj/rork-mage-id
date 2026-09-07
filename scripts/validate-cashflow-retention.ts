// validate-cashflow-retention.ts — retention is not cash on the terms clock.
//
// WHY THIS EXISTS. `Invoice.totalDue` is the GROSS billed figure; it includes
// the retention the contract holds back until closeout. The cash-flow forecast
// projected `totalDue - amountPaid` as arriving at issueDate + payment terms,
// so every held-back dollar showed up as spendable cash net-30 — money the
// client is contractually not going to send for months.
//
// On a $500k job at 10% retention that is $50k of phantom near-term cash. The
// screen exists to answer "can I make payroll", and its summary also feeds
// hooks/useMorningBrief.ts and utils/oneMind/factBlocks.ts, so the overstatement
// became "you're fine this week" in the brief and in the AI's answers.
//
// The repo already had the correct formula — utils/invoiceBilling.netBalanceDue,
// used by the Stripe pay link and the in-app Generate Payment Link button. The
// forecast simply wasn't using it, so the app's forecast and the app's own
// invoice disagreed about the same invoice. Now they share one function.
//
// THE RULE: the weekly forecast projects only retention-NET collectible dollars.
// Held retention is reported separately by pendingRetention() and deliberately
// carries no date, because nothing in this module knows the closeout date and a
// forecast that names a date it cannot know is worse than one that says "held".
//
// Run via: bun run test:cashflow-retention

import { generateForecast, calculateSummary, pendingRetention } from '../utils/cashFlowEngine';
import { netBalanceDue } from '../utils/invoiceBilling';
import type { Invoice } from '../types';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ✓', label); }
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}
function eq(label: string, actual: number, expected: number, tol = 0.01) {
  check(`${label} (= ${expected})`, Math.abs(actual - expected) <= tol, `got ${actual}`);
}

const today = new Date();
const iso = (d: Date) => d.toISOString();

function invoice(over: Partial<Invoice>): Invoice {
  return {
    id: 'i1', number: 1, projectId: 'p1', type: 'progress',
    issueDate: iso(today), dueDate: iso(today), paymentTerms: 'net_30',
    notes: '', lineItems: [], subtotal: 100_000, taxRate: 0, taxAmount: 0,
    totalDue: 100_000, amountPaid: 0, status: 'sent', payments: [],
    createdAt: iso(today), updatedAt: iso(today),
    ...over,
  } as Invoice;
}

const forecast = (invs: Invoice[]) =>
  calculateSummary(generateForecast(0, [], invs, [], 12, 'net_30', []));

console.log('\ncash-flow retention (held money is not forecast cash):');

// ── 1. retention is excluded from the weekly runway ─────────────────────────
const withRet = invoice({ retentionPercent: 10, retentionAmount: 10_000 });
eq('forecast income on a $100k invoice holding $10k retention',
  forecast([withRet]).totalIncome, 90_000);
eq('...and the $10k is reported as held, not lost',
  pendingRetention([withRet]), 10_000);

// ── 2. no retention → unchanged from the old behaviour ──────────────────────
// The fix must not move the number for the many invoices that hold nothing back.
const noRet = invoice({});
eq('a no-retention invoice still forecasts its full balance',
  forecast([noRet]).totalIncome, 100_000);
eq('no-retention invoice reports zero held', pendingRetention([noRet]), 0);

// ── 3. released retention becomes collectible again ─────────────────────────
const released = invoice({ retentionAmount: 10_000, retentionReleased: 10_000 });
eq('once retention is released it returns to the forecast',
  forecast([released]).totalIncome, 100_000);
eq('...and is no longer counted as held', pendingRetention([released]), 0);

// Partial release: half the retention freed.
const half = invoice({ retentionAmount: 10_000, retentionReleased: 4_000 });
eq('partial release frees only the released portion',
  forecast([half]).totalIncome, 94_000);
eq('partial release leaves the rest held', pendingRetention([half]), 6_000);

// ── 4. payments already received are not re-forecast ────────────────────────
const partlyPaid = invoice({ amountPaid: 50_000, status: 'partially_paid', retentionAmount: 10_000 });
eq('a partly-paid invoice forecasts only what is still collectible',
  forecast([partlyPaid]).totalIncome, 40_000);

// Paid down to exactly the retention: nothing more is collectible NOW.
const paidToRetention = invoice({ amountPaid: 90_000, status: 'partially_paid', retentionAmount: 10_000 });
eq('paid down to the retention forecasts ZERO further cash',
  forecast([paidToRetention]).totalIncome, 0);
eq('...while still reporting the retention as held',
  pendingRetention([paidToRetention]), 10_000);

// ── 5. never negative ───────────────────────────────────────────────────────
// Over-payment or a retention larger than the balance must not create a
// negative income item, which would silently DRAIN the projected balance.
const overpaid = invoice({ amountPaid: 120_000, status: 'partially_paid', retentionAmount: 10_000 });
check('an overpaid invoice contributes no negative income',
  forecast([overpaid]).totalIncome >= 0, `got ${forecast([overpaid]).totalIncome}`);
const hugeRetention = invoice({ retentionAmount: 500_000 });
check('retention exceeding the balance clamps at zero, never negative',
  netBalanceDue(hugeRetention) === 0, `got ${netBalanceDue(hugeRetention)}`);

// ── 6. draft invoices owe nothing yet ───────────────────────────────────────
const draft = invoice({ status: 'draft', retentionAmount: 10_000 });
eq('a draft invoice forecasts no income', forecast([draft]).totalIncome, 0);
eq('a draft invoice reports no held retention', pendingRetention([draft]), 0);

// ── 7. the forecast and the pay link agree ──────────────────────────────────
// The original defect was two formulas for one invoice. Pin them together so a
// future edit to either side has to break this test to diverge again.
const sample = invoice({ amountPaid: 25_000, status: 'partially_paid', retentionAmount: 10_000 });
eq('forecast income equals netBalanceDue — one formula, not two',
  forecast([sample]).totalIncome, netBalanceDue(sample));

// ── 8. the dunning cron must not chase retention ────────────────────────────
// Source-text assertions, because deno check cannot see inside a .select()
// string: a column omitted there is a runtime undefined, not a type error.
// (That is exactly how homeowner-weekly-digest ended up selecting a column and
// a table that do not exist, and reporting zeroes to every client for weeks.)
//
// invoice-dunning emails the client and escalates to "FINAL NOTICE". It
// computed outstanding = total_due - amount_paid, so a client who had paid
// every dollar they were billed still showed a balance equal to the retention
// and got chased for money the contract says they keep.
{
  const dunning = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'functions', 'invoice-dunning', 'index.ts'),
    'utf8',
  );

  check(
    'dunning nets retention out of the outstanding balance',
    /retention_amount[\s\S]{0,200}retention_released/.test(dunning) &&
      /const\s+outstanding\s*=\s*netPayable\s*-/.test(dunning),
    'invoice-dunning must subtract pending retention before deciding to email, ' +
    'and before printing the amount demanded. Otherwise it dunns the client for ' +
    'retention the contract entitles them to hold.',
  );

  const selects = dunning.match(/\.select\('[^']*total_due[^']*'\)/g) ?? [];
  check(
    'every invoice select fetches the retention columns',
    selects.length > 0 && selects.every(sel =>
      sel.includes('retention_amount') && sel.includes('retention_released')),
    `A select that omits them makes Number(undefined) → NaN in the retention math, ` +
    `which silently disables the fix. Found ${selects.length} select(s); ` +
    `offending: ${selects.filter(x => !x.includes('retention_amount')).join(' | ') || 'none'}`,
  );

  // MONEY-05 (runtime audit 2026-09-07). The retention math is no longer written
  // out here — it is _shared/paymentMath, the same module the Stripe webhook
  // runs, which recomputes the withholding as retention_percent x subtotal and
  // falls back to the stored column only when there is nothing to recompute
  // from. The hand-written subtraction that used to sit in this file trusted
  // `retention_amount`, which on rows written before the MISS-04 basis fix is
  // retainage taken on the TAX-INCLUSIVE total: the notice demanded $77,201.39
  // on the founder's Houston invoice while the app, the portal and the Stripe
  // pay link all said $77,484.88. A dunning notice is the one place the client
  // reads a number and pays it.
  check(
    'dunning takes the withholding from _shared/paymentMath, not its own arithmetic',
    /from '\.\.\/_shared\/paymentMath\.ts'/.test(dunning) &&
      /const\s+netPayable\s*=\s*netPayableOf\(invoice\)/.test(dunning),
    'invoice-dunning must not re-derive retention. netPayable() in ' +
    'supabase/functions/_shared/paymentMath.ts is the one rule, shared with the ' +
    'Stripe webhook and mirrored by utils/invoiceBilling on the client.',
  );
  check(
    '…and no hand-written retention subtraction survives in the file',
    !/Number\(invoice\.retention_amount[^)]*\)\s*-\s*Number\(invoice\.retention_released/.test(dunning),
    'A second copy of the arithmetic is a second place to forget the basis.',
  );
  check(
    'every invoice select also fetches the basis the withholding is recomputed from',
    selects.length > 0 && selects.every(sel =>
      sel.includes('subtotal') && sel.includes('retention_percent')),
    'Omit subtotal or retention_percent and effectiveRetention() silently falls ' +
    'back to the stored retention_amount for every row — the exact figure this ' +
    'fix exists to stop trusting. Offending: ' +
    (selects.filter(x => !(x.includes('subtotal') && x.includes('retention_percent'))).join(' | ') || 'none'),
  );
}

// ── 9. no receivable falls between two weeks ────────────────────────────────
// weekStart is midnight-aligned and isDateInWeek tests `d <= weekEnd`, so when
// weekEnd was also midnight, every instant after 00:00:00.000 on a week's LAST
// DAY belonged to no week at all. Invoice dates carry a real time-of-day
// (app/invoice.tsx:354 stores a full ISO timestamp), so ~1 receivable in 7
// vanished from the runway entirely — not late, not deferred: absent.
{
  const anchor = new Date(today); anchor.setHours(0, 0, 0, 0);
  // Land the expected date on each day of forecast week 0, at 10:15 local.
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const arrive = new Date(anchor);
    arrive.setDate(arrive.getDate() + dayOffset);
    arrive.setHours(10, 15, 0, 0);
    const issued = new Date(arrive);
    issued.setDate(issued.getDate() - 30); // net_30

    const inv = invoice({ issueDate: iso(issued), dueDate: iso(issued) });
    const total = forecast([inv]).totalIncome;
    check(
      `a receivable arriving on day ${dayOffset} of the week is counted`,
      Math.abs(total - 100_000) < 0.01,
      `got ${total} — day ${dayOffset} matched no forecast week`,
    );
  }
}

if (failures > 0) {
  console.error(`\n✗ validate-cashflow-retention: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log('\n26 passed, 0 failed\n');
