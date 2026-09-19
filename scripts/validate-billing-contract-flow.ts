// validate-billing-contract-flow.ts — contract milestone → invoice → paid,
// wave 3 lane billing-contract (audits #31, #32, #119, #132, #133, #134, #136).
//
// WHAT IS GUARDED, AND WHY EACH IS EXECUTED RATHER THAN GREPPED WHERE IT CAN BE.
//
//   #31  The deposit invoice opened on Net 30 under a contract that said "Due
//        on signing". The trigger → terms map lives in utils/billingFlowCore
//        (milestoneBillEffect / milestoneContractTerms) and is executed here;
//        the screens' wiring (param forwarded, state seeded, cash-flow effect
//        bailing out) is pinned in source because a screen cannot run in bun.
//   #32  The deposit asked about — and could withhold — retainage, and a fix
//        that only seeded 0% would have moved the 0% into invoice #2 through
//        the carry. Both halves are executed on the real resolver.
//   #119 A sent contract never re-read, so a homeowner's signature was
//        invisible until he left the screen.
//   #132/#136 A milestone paid through the Pay link (or a flip lost offline)
//        stayed "Billed". PAID is now derived from the linked invoices; the
//        derivation and the repair list are executed.
//   #133 Record Payment had no received date or check number; readers now
//        prefer the received day. Executed on the real readers.
//   #134 parseFloat('12,500.00') recorded $12. The decision is executed.
//
// Run via: bun run scripts/validate-billing-contract-flow.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  milestoneBillEffect, milestoneContractTerms, milestoneContractTermsCaption, milestoneHoldsNoRetainage,
  milestonePaidFromInvoices, milestonePaidRepairs, paymentReceivedDay, paymentReceivedAt,
  recordPaymentDecision, parsePositiveMoney, parsePercentInput,
  type MilestoneBillability, type MilestoneLike,
} from '../utils/billingFlowCore';
import { resolveRetainagePercent, type RetainagePriorInvoice } from '../utils/retainageSource';
import { parseMoneyInput, getEffectiveStartingBalance } from '../utils/cashFlowEngine';
import type { Invoice } from '../types';

// tsc checks scripts against the app's lib set, which has no Bun global; the
// one API used is declared rather than pulling in @types/bun.
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync(code: string): string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

let failures = 0;
let passes = 0;
function ok(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passes++; console.log('  ✓', label); }
  else { failures++; console.error('  ✗', label, detail !== undefined ? `\n      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''); }
}

const INVOICE = stripComments(read('app/invoice.tsx'));
const CONTRACT = stripComments(read('app/contract.tsx'));

// ── #31: the contract's terms reach the invoice ────────────────────────────
console.log('\n#31 a deposit / final invoice carries the terms the contract printed');
{
  const billable: MilestoneBillability = { billable: true, amount: 5000 } as MilestoneBillability;
  const ms = (trigger: string): MilestoneLike => ({ id: `m-${trigger}`, label: trigger, amount: 5000, status: 'pending', trigger, triggerDate: '2026-10-01' });
  const effect = (trigger: string) => milestoneBillEffect(billable, ms(trigger), { contractValue: 50_000 });
  const e1 = effect('on_signing');
  ok('on_signing composes with due_on_receipt', e1.kind === 'compose' && e1.terms === 'due_on_receipt', e1);
  const e2 = effect('on_final');
  ok('on_final composes with due_on_receipt', e2.kind === 'compose' && e2.terms === 'due_on_receipt', e2);
  for (const t of ['on_date', 'on_milestone']) {
    const e = effect(t);
    ok(`${t} keeps his usual terms (terms: null)`, e.kind === 'compose' && e.terms === null, e);
  }
  ok('on_invoice never composes (it bills through Bill from Estimate)', effect('on_invoice').kind === 'progress');
  ok('milestoneContractTerms: undefined trigger → null', milestoneContractTerms(undefined) === null);
  ok('the caption names the contract and the trigger',
    milestoneContractTermsCaption('on_signing') === 'From the signed contract: due on signing.'
      && milestoneContractTermsCaption('on_final') === 'From the signed contract: due at substantial completion.'
      && milestoneContractTermsCaption('on_date') === null);

  ok('contract.tsx forwards the effect\'s terms and trigger as route params',
    /\.\.\.\(effect\.terms \? \{ contractTerms: effect\.terms, milestoneTrigger: m\.trigger \} : \{\}\)/.test(CONTRACT));
  ok('invoice.tsx accepts contract terms only for a NEW milestone invoice',
    /const contractTerms: PaymentTerms \| null =\s*!invoiceId && milestoneId && contractTermsParam === 'due_on_receipt' \? 'due_on_receipt' : null;/.test(INVOICE));
  ok('...seeds the terms synchronously', /useState<PaymentTerms>\(existingInvoice\?\.paymentTerms \?\? contractTerms \?\? 'net_30'\)/.test(INVOICE));
  ok('...with the \'contract\' origin, never \'loading\'', /: contractTerms \? 'contract' : 'loading',/.test(INVOICE));
  // The cash-flow effect must bail before settle() can run: settle overwrites
  // anything not touched, so seeding alone is not enough.
  const effAt = INVOICE.indexOf('if (invoiceId) return;');
  const bailAt = INVOICE.indexOf('if (contractTerms) return;', effAt);
  const settleAt = INVOICE.indexOf('const settle = () => {', effAt);
  ok('...and the cash-flow terms effect returns before settle() exists', effAt > 0 && bailAt > effAt && settleAt > bailAt);
  ok('...keyed on contractTerms', /\}, \[invoiceId, user\?\.id, contractTerms\]\);/.test(INVOICE));
  ok('...and the picker says where the terms came from', /termsOrigin === 'contract' && \(/.test(INVOICE) && /milestoneContractTermsCaption\(milestoneTrigger\)/.test(INVOICE));
}

// ── #32: a deposit holds no retainage, and does not become the job's rate ──
console.log('\n#32 the deposit holds no retainage; invoice #2 does not inherit its 0%');
{
  ok('only the deposit is exempt', milestoneHoldsNoRetainage('on_signing') && !milestoneHoldsNoRetainage('on_final') && !milestoneHoldsNoRetainage('on_date'));
  const billable: MilestoneBillability = { billable: true, amount: 5000 } as MilestoneBillability;
  const dep = milestoneBillEffect(billable, { id: 'm1', label: 'Deposit', amount: 5000, status: 'pending', trigger: 'on_signing' }, { contractValue: 50_000 });
  ok('the deposit effect carries depositNoRetainage', dep.kind === 'compose' && dep.depositNoRetainage === true);
  const deposit: RetainagePriorInvoice = { id: 'i1', number: 1, status: 'sent', retentionPercent: 0, createdAt: '2026-09-01T12:00:00Z', sourceMilestoneId: 'm1' };
  const r1 = resolveRetainagePercent({ priorInvoices: [deposit], project: {} });
  ok('a sent 0% deposit + nothing on file → the next invoice ASKS (not "same as #1" at 0%)', r1.needsAsk === true && r1.source === 'unknown', r1);
  const r2 = resolveRetainagePercent({ priorInvoices: [deposit], project: { retainagePercent: 10, retainagePercentAssumed: false } });
  ok('...with a 10% contract term → 10%, from the contract', r2.percent === 10 && r2.source === 'contract' && !r2.conflict, r2);
  const r3 = resolveRetainagePercent({ priorInvoices: [deposit], project: { retainagePercent: 10, retainagePercentAssumed: true } });
  ok('...even an assumed 10% is no longer beaten by the deposit\'s 0', r3.percent === 10 && r3.source === 'contract', r3);
  const draw: RetainagePriorInvoice = { id: 'i2', number: 2, status: 'sent', retentionPercent: 10, createdAt: '2026-09-05T12:00:00Z', sourceMilestoneId: 'm2' };
  const r4 = resolveRetainagePercent({ priorInvoices: [deposit, draw], project: {} });
  ok('a milestone draw that DID withhold 10% still carries', r4.percent === 10 && r4.source === 'carried', r4);
  const plainZero: RetainagePriorInvoice = { id: 'i3', number: 3, status: 'sent', retentionPercent: 0, createdAt: '2026-09-02T12:00:00Z' };
  const r5 = resolveRetainagePercent({ priorInvoices: [plainZero], project: {} });
  ok('an ordinary invoice sent at 0% still carries its 0 (only milestone lumps are skipped)', r5.percent === 0 && r5.source === 'carried', r5);
  const r6 = resolveRetainagePercent({ invoice: { retentionPercent: 0 }, priorInvoices: [], project: { retainagePercent: 10, retainagePercentAssumed: false } });
  ok('the saved deposit itself keeps its own 0% (layer 1)', r6.percent === 0 && r6.source === 'invoice', r6);

  ok('contract.tsx forwards depositNoRetainage', /\.\.\.\(effect\.depositNoRetainage \? \{ depositNoRetainage: '1' \} : \{\}\)/.test(CONTRACT));
  ok('invoice.tsx: a deposit is a NEW milestone invoice with the flag', /const isDepositInvoice = !invoiceId && !!milestoneId && depositParam === '1';/.test(INVOICE));
  ok('...seeds 0%', /useState<string>\(isDepositInvoice \? '0' : String\(retainageSeed\.percent\)\)/.test(INVOICE));
  ok('...never opens the ask', /retainageSeed\.needsAsk && !isLocked && !retainageAsked && !isDepositInvoice\)/.test(INVOICE));
  ok('...and labels the 0 as the contract\'s rule', /if \(isDepositInvoice\) return \{ label: 'Deposit — no retainage held \(per contract\)', warn: false \};/.test(INVOICE));
}

// ── #119: a sent contract re-reads ─────────────────────────────────────────
console.log('\n#119 the homeowner\'s signature shows without leaving the screen');
{
  ok('the focus re-read covers a SENT contract as well as a signed one',
    /if \(!unsavedDraft && focusContractStatus !== 'signed' && focusContractStatus !== 'sent'\) return;/.test(CONTRACT));
  ok('an AppState \'active\' listener re-reads', /AppState\.addEventListener\('change', \(next\) => \{\s*if \(next === 'active'\) void recheckLockedContract\(\);/.test(CONTRACT));
  ok('pull-to-refresh re-reads a sent/signed contract', /refreshControl=\{contract\.status === 'sent' \|\| contract\.status === 'signed'/.test(CONTRACT) && /onRefresh=\{onPullRefresh\}/.test(CONTRACT));
  const body = CONTRACT.slice(CONTRACT.indexOf('const recheckLockedContract'), CONTRACT.indexOf('useEffect(() => {', CONTRACT.indexOf('const recheckLockedContract')));
  ok('...which adopts only the SAME contract (a superseding revision is never swapped in)',
    /held\.status !== 'sent' && held\.status !== 'signed'/.test(body) && /fresh\.contract\.id !== held\.id\) return;/.test(body) && /current\.id !== fresh\.contract\.id\) return;/.test(body));
}

// ── #132 / #136: PAID from the invoices ────────────────────────────────────
console.log('\n#132/#136 a paid draw shows PAID however it was paid');
{
  const m = (over: Partial<MilestoneLike> = {}) => ({ id: 'm1', status: 'invoiced' as const, invoiceId: 'inv1', ...over });
  ok('stored invoiced + its invoice paid (Pay link / lost flip) → PAID', milestonePaidFromInvoices(m(), [{ id: 'inv1', paid: true, sourceMilestoneId: 'm1' }]));
  ok('stored invoiced + invoice unpaid → not paid', !milestonePaidFromInvoices(m(), [{ id: 'inv1', paid: false, sourceMilestoneId: 'm1' }]));
  ok('linked by sourceMilestoneId only (the invoiced flip was lost too) → PAID', milestonePaidFromInvoices(m({ status: 'pending', invoiceId: undefined }), [{ id: 'inv9', paid: true, sourceMilestoneId: 'm1' }]));
  ok('two linked invoices, one unpaid → not paid', !milestonePaidFromInvoices(m(), [{ id: 'inv1', paid: true }, { id: 'inv2', paid: false, sourceMilestoneId: 'm1' }]));
  ok('stored paid but the invoice was refunded → not paid', !milestonePaidFromInvoices(m({ status: 'paid' }), [{ id: 'inv1', paid: false }]));
  ok('no linked invoice on this device → the stored status stands', milestonePaidFromInvoices(m({ status: 'paid' }), []) && !milestonePaidFromInvoices(m(), []));
  ok('another milestone\'s invoice does not count', !milestonePaidFromInvoices(m({ invoiceId: undefined, status: 'pending' }), [{ id: 'x', paid: true, sourceMilestoneId: 'm2' }]));

  const rep = milestonePaidRepairs([
    { id: 'a', status: 'invoiced', invoiceId: 'ia' },
    { id: 'b', status: 'pending' },
    { id: 'c', status: 'paid', invoiceId: 'ic' },
    { id: 'd', status: 'invoiced', invoiceId: 'id' },
    { id: 'e', status: 'pending' },
  ], [
    { id: 'ia', paid: true, sourceMilestoneId: 'a' },
    { id: 'ib', paid: true, sourceMilestoneId: 'b' },
    { id: 'ic', paid: true, sourceMilestoneId: 'c' },
    { id: 'id', paid: false, sourceMilestoneId: 'd' },
    { id: 'ie1', paid: true, sourceMilestoneId: 'e' }, { id: 'ie2', paid: true, sourceMilestoneId: 'e' },
  ]);
  ok('repairs: only the stale invoiced row that names its invoice; paid, unpaid, unlinked and hand-paid rows are left alone',
    JSON.stringify(rep) === JSON.stringify([{ milestoneId: 'a', invoiceId: 'ia' }]), rep);
  ok('the contract screen never writes the invoiced link itself (that stays the editor\'s, on creation)', !/markMilestoneInvoiced\(/.test(CONTRACT));

  ok('the pill and the "Paid — already on an invoice" line read the derived state',
    /const isPaid = paidByInvoices \?\? milestone\.status === 'paid';/.test(CONTRACT) && /isPaid\s+\? \{ bg: themeColors\.success/.test(CONTRACT) && /\{isPaid \? 'Paid' : 'Billed'\} — already on an invoice/.test(CONTRACT));
  ok('the screen passes each row the invoice-derived answer, from EFFECTIVE status',
    /paidByInvoices=\{paidMilestoneIds\.has\(m\.id\)\}/.test(CONTRACT) && /paid: getEffectiveInvoiceStatus\(inv\) === 'paid',/.test(CONTRACT));
  ok('the open-time repair runs the live read-verify-write, never a queued schedule array',
    /milestonePaidRepairs\(c\.paymentSchedule, invoicePaidRows\)/.test(CONTRACT) && /await markMilestonePaidByInvoice\(repairContractId, r\.invoiceId\)/.test(CONTRACT)
      && !/supabaseWrite\([^)]*project_contracts/.test(CONTRACT));
  const pay = INVOICE.slice(INVOICE.indexOf('const commitPayment = useCallback'), INVOICE.indexOf('const handleMarkPaid = useCallback'));
  ok('Record Payment tells him when the milestone flip did not land (no console.warn)',
    /\.then\(\(outcome\) => \{ if \(outcome === 'failed' \|\| outcome === 'not_found'\) flipFailed\(\); \}\)/.test(pay) && /\.catch\(flipFailed\)/.test(pay) && !/console\.warn\('\[Invoice\] milestone paid-flip/.test(pay));
}

// ── #133: the received day and the check number ────────────────────────────
console.log('\n#133 a payment carries the day it arrived and its check number');
{
  ok('paymentReceivedDay prefers his picked day', paymentReceivedDay({ date: '2026-09-15T01:00:00.000Z', receivedDate: '2026-09-11' }) === '2026-09-11');
  const legacy = paymentReceivedDay({ date: '2026-09-15T15:00:00.000Z' });
  ok('...else the LOCAL day of the recorded instant', legacy === (() => { const d = new Date('2026-09-15T15:00:00.000Z'); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })(), legacy);
  ok('...a malformed picked day falls back', paymentReceivedDay({ date: '2026-09-15T15:00:00.000Z', receivedDate: '2026-02-30' }) === legacy);
  const at = paymentReceivedAt({ date: '2026-09-15T01:00:00.000Z', receivedDate: '2026-09-11' });
  ok('paymentReceivedAt reads the picked day at LOCAL noon (never UTC midnight)', at.getFullYear() === 2026 && at.getMonth() === 8 && at.getDate() === 11 && at.getHours() === 12, at.toString());
  ok('...and an unreadable row stays an Invalid Date (NaN guards keep working)', Number.isNaN(paymentReceivedAt({ date: 'garbage' }).getTime()));

  // The cash balance: a check received BEFORE he set the balance is not added
  // again because he recorded it after.
  const inv = (payments: Invoice['payments']) => ({ payments } as unknown as Invoice);
  const asOf = new Date(2026, 8, 12, 18).toISOString();
  const before = getEffectiveStartingBalance(1000, asOf, [inv([{ id: 'p', date: new Date(2026, 8, 14, 20).toISOString(), amount: 500, method: 'check', receivedDate: '2026-09-11' } as Invoice['payments'][number]])]);
  ok('cash balance: a check received the day before the balance was set is not counted again', before === 1000, before);
  const after = getEffectiveStartingBalance(1000, asOf, [inv([{ id: 'p', date: new Date(2026, 8, 14, 20).toISOString(), amount: 500, method: 'check', receivedDate: '2026-09-13' } as Invoice['payments'][number]])]);
  ok('...one received after it is', after === 1500, after);
  const legacyRow = getEffectiveStartingBalance(1000, asOf, [inv([{ id: 'p', date: new Date(2026, 8, 14, 20).toISOString(), amount: 500, method: 'check' }])]);
  ok('...a row with no received day keeps the recorded instant', legacyRow === 1500, legacyRow);

  // paymentPrediction's daysBetween, lifted and EXECUTED (it is self-contained
  // for validate-ai-failure-copy, which runs it the same way).
  const PRED = read('utils/paymentPrediction.ts');
  const dAt = PRED.indexOf('function daysBetween(');
  const dEnd = PRED.indexOf('\n}\n', dAt) + 3;
  // In a holder so TS does not narrow it to null across the try.
  const lifted: { daysBetween?: (a: string, p: unknown) => number } = {};
  try {
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${PRED.slice(dAt, dEnd)}\nmodule.exports = { daysBetween };`);
    const mod: { exports: Record<string, unknown> } = { exports: {} };
    new Function('module', 'exports', js)(mod, mod.exports);
    lifted.daysBetween = mod.exports.daysBetween as (a: string, p: unknown) => number;
  } catch (e) { ok('paymentPrediction daysBetween lifts and runs', false, String(e)); }
  const daysBetween = lifted.daysBetween;
  const due = new Date(2026, 8, 11, 12).toISOString();
  ok('paymentPrediction: a check received on the due day and recorded 3 days later is 0 days late',
    daysBetween?.(due, { date: new Date(2026, 8, 14, 21).toISOString(), receivedDate: '2026-09-11' }) === 0, String(daysBetween?.(due, { date: new Date(2026, 8, 14, 21).toISOString(), receivedDate: '2026-09-11' })));
  ok('...a row with no received day keeps the recorded instant (3 days)',
    daysBetween?.(due, { date: new Date(2026, 8, 14, 12).toISOString() }) === 3);
  const PRED_CODE = stripComments(PRED);
  ok('...and both history readers pass the payment row, not its bare .date',
    /daysBetween\(p\.dueDate, lastPayment\)/.test(PRED_CODE) && /daysBetween\(p\.issueDate, firstPayment\)/.test(PRED_CODE));
  const pay = INVOICE.slice(INVOICE.indexOf('const commitPayment = useCallback'), INVOICE.indexOf('const handleMarkPaid = useCallback'));
  ok('Record Payment stores the picked calendar day and the reference; `date` stays the recorded instant',
    /date: new Date\(\)\.toISOString\(\),/.test(pay) && /receivedDate: calendarDayOf\(paymentReceivedDate\) \?\? todayCalendarDay\(\),/.test(pay) && /\.\.\.\(reference \? \{ reference \} : \{\}\),/.test(pay));
  ok('the modal has a Date received picker (default today) and a Check # field',
    /useState\(\(\) => todayCalendarDay\(\)\)/.test(INVOICE) && /testID="record-payment-received-date"/.test(INVOICE) && /testID="record-payment-reference"/.test(INVOICE) && /<DatePickerModal[\s\S]{0,120}value=\{paymentReceivedDate\}/.test(INVOICE));
  ok('the payment history prints the received day as a calendar day, not new Date(p.date)',
    /formatCalendarDay\(paymentReceivedDay\(p as InvoicePayment & RecordedPaymentFields\)\)/.test(INVOICE) && !/new Date\(p\.date\)\.toLocaleDateString\(\)/.test(INVOICE));
}

// ── #134: money typed with commas ──────────────────────────────────────────
console.log('\n#134 Record Payment reads "12,500.00" as $12,500.00');
{
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const d = (t: string, bal = 12_500) => recordPaymentDecision(t, bal, parseMoneyInput, fmt);
  const a = d('12,500.00');
  ok('"12,500.00" records 12500 (was 12)', a.kind === 'record' && a.amount === 12_500, a);
  const b = d('$12,500');
  ok('"$12,500" records 12500', b.kind === 'record' && b.amount === 12_500, b);
  ok('"1200,50" is refused, never read as 1200', d('1200,50').kind === 'refuse');
  ok('empty, junk, 0 and negative are refused with a reason', ['', 'abc', '0', '-5', '0.001'].every(t => { const r = d(t); return r.kind === 'refuse' && r.message.length > 0; }));
  const c = d('125000');
  ok('more than the balance asks first, naming the balance and the excess', c.kind === 'confirm' && c.amount === 125_000 && /\$112500\.00 more than the \$12500\.00 balance/.test(c.message), c);
  const e = d('12500.004');
  ok('a fraction of a cent over rounds to the cent and records', e.kind === 'record' && e.amount === 12_500, e);
  const f = d('100.126', 1000);
  ok('amounts are rounded to the cent', f.kind === 'record' && f.amount === 100.13, f);
  ok('parsePositiveMoney: "10,000" → 10000; junk / 0 → null (never 0)',
    parsePositiveMoney('10,000', parseMoneyInput) === 10_000 && parsePositiveMoney('x', parseMoneyInput) === null && parsePositiveMoney('0', parseMoneyInput) === null);
  ok('parsePercentInput: "10", "7.5", "10%" read; "1,5" and "10abc" do not',
    parsePercentInput('10') === 10 && parsePercentInput('7.5') === 7.5 && parsePercentInput('10%') === 10 && parsePercentInput('1,5') === null && parsePercentInput('10abc') === null);
  const mark = INVOICE.slice(INVOICE.indexOf('const handleMarkPaid = useCallback'), INVOICE.indexOf('// Stripe payment link', INVOICE.indexOf('const handleMarkPaid = useCallback')));
  ok('handleMarkPaid decides through recordPaymentDecision(parseMoneyInput) and confirms an overpayment before writing',
    /recordPaymentDecision\(paymentAmount, balanceDue, parseMoneyInput, formatCurrency\)/.test(mark) && !/parseFloat/.test(mark)
      && /decision\.kind === 'confirm'[\s\S]{0,260}onPress: \(\) => commitPayment\(decision\.amount\)[\s\S]{0,40}\]\);\s*return;/.test(mark));
  const rel = INVOICE.slice(INVOICE.indexOf('const handleReleaseRetention = useCallback'), INVOICE.indexOf('const effectiveStatus ='));
  ok('the retention release parses with parseMoneyInput', /parsePositiveMoney\(retentionReleaseAmount, parseMoneyInput\)/.test(rel) && !/parseFloat/.test(rel));
  ok('the retainage ask parses a percentage strictly', /const retainageAskValue = parsePercentInput\(retainageAskInput\) \?\? NaN;/.test(INVOICE));
}

console.log(`\n${failures === 0 ? '✓' : '✗'} validate-billing-contract-flow: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
