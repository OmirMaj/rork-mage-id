// validate-invoice-send-pay-honesty.ts — the invoice Send tells the truth about
// the Pay button, the portal and the reminders (wave 3, lane invoice-send-pay).
//
//   #3c  THE NEXT NUMBER IS NEVER REUSED. max+1 over the project's list missed
//        an invoice this device had just created whenever the list lagged it
//        (a refetch landing before the queued INSERT). The number is now past
//        the session's own issued max too.
//   #45  EMAILED = POSTED. Emailing never shared the invoice to the portal, yet
//        the app promised "a Pay Now button in the portal". The Send sheet posts
//        it (ticked by default); the copy promises the portal only when the
//        portal shows the invoice.
//   #47  THE CARD SAYS WHO GETS THE REMINDER. No billing address and no portal
//        invitee → 'no_recipient', shown up front; the send stores the address.
//   #49  A MISSING PAY BUTTON IS NEVER A SILENT "SENT". Over Stripe's
//        $999,999.99 cap, under $0.50, a queued (offline) insert, a 404, a
//        thrown mint — each replaces the success toast, in both send paths.
//   #135 THE SUBJECT IS EXACT. "$77K due" over a $77,484.88 charge.
//
// The rules are executed from utils/billingFlowCore.ts; the screen's wiring is
// pinned on app/invoice.tsx (the only place it can be seen without a device).
//
// Run: bun run scripts/validate-invoice-send-pay-honesty.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  payLinkAmountBlock, payLinkFailureReason, sentWithoutPayButtonMessage,
  nextInvoiceNumberFrom, invoiceShownInPortal, reminderRecipient,
  reminderEligibility, reminderBlockMessage,
} from '../utils/billingFlowCore';
import { invoiceBillToColumns } from '../utils/projectContextPure';

const ROOT = join(__dirname, '..');
const INVOICE_PATH = process.env.INVOICE_TSX_PATH ?? join(ROOT, 'app/invoice.tsx');
const SCREEN = readFileSync(INVOICE_PATH, 'utf8');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

/** Source of one useCallback handler: from `const name = useCallback(` to the next top-level `const … = useCallback(`. */
function handler(name: string): string {
  const i = SCREEN.indexOf(`const ${name} = useCallback(`);
  if (i < 0) return '';
  const rest = SCREEN.slice(i + 10);
  const next = rest.search(/\n {2}const [A-Za-z]+ = useCallback\(/);
  return next < 0 ? SCREEN.slice(i) : SCREEN.slice(i, i + 10 + next);
}

console.log('\n#49 Stripe limits are named before the round trip');
ok('$1.2M progress draw is blocked with the ACH/check way out',
  /999,999\.99/.test(payLinkAmountBlock(1_200_000) ?? '') && /ACH or check/.test(payLinkAmountBlock(1_200_000) ?? ''));
ok('exactly $999,999.99 is allowed', payLinkAmountBlock(999_999.99) === null);
ok('$1,000,000.00 is one cent over and blocked', payLinkAmountBlock(1_000_000) !== null);
ok('$0.49 names the $0.50 minimum', /\$0\.50/.test(payLinkAmountBlock(0.49) ?? ''));
ok('$0.50 is allowed', payLinkAmountBlock(0.5) === null);
ok('an ordinary $77,484.88 balance is allowed', payLinkAmountBlock(77_484.88) === null);
ok('the edge function\'s 404 names both possibilities (still saving OR failed), never promises arrival',
  /may still be saving, or the save may have failed/.test(payLinkFailureReason('Invoice not found'))
  && !/hadn't finished saving/.test(payLinkFailureReason('Invoice not found')));
ok('the edge function\'s max error reads as the Stripe limit', /999,999\.99/.test(payLinkFailureReason('Amount exceeds Stripe maximum ($999,999.99)')));
ok('the edge function\'s min error names $0.50', /\$0\.50/.test(payLinkFailureReason('Minimum charge amount is $0.50')));
ok('any other Stripe error is quoted, never swallowed', payLinkFailureReason('card_declined') === 'Stripe said: card_declined');
ok('no error text still gives a reason', payLinkFailureReason(undefined).length > 10);
ok('the replacement toast says "without a Pay button" and how to add one',
  /^Sent — without a Pay button: .+\. Open Invoice #7 and tap Generate Payment Link/.test(sentWithoutPayButtonMessage(7, 'x')));
// A limit never passes on retry, so its toast must not send him to the button.
for (const [label, amt] of [['over $999,999.99', 1_200_000], ['under $0.50', 0.49]] as const) {
  const reason = payLinkAmountBlock(amt) ?? '';
  const msg = sentWithoutPayButtonMessage(7, reason);
  ok(`${label}: the toast names the limit and does NOT say "tap Generate Payment Link"`,
    msg.startsWith('Sent — without a Pay button: ') && msg.includes(reason) && !/Generate Payment Link/.test(msg), msg);
  ok(`${label}: the edge function's own limit error reads the same (not retryable)`,
    !/Generate Payment Link/.test(sentWithoutPayButtonMessage(7, payLinkFailureReason(amt > 1 ? 'Amount exceeds Stripe maximum' : 'Minimum charge amount is $0.50'))));
}

console.log('\n#3c the next invoice number');
ok('max+1 over the list', nextInvoiceNumberFrom([{ number: 3 }, { number: 7 }]) === 8);
ok('a number issued this session but missing from the list is not handed out again',
  nextInvoiceNumberFrom([{ number: 3 }], 7) === 8);
ok('an empty project starts at 1', nextInvoiceNumberFrom([]) === 1);
ok('garbage numbers do not poison the max', nextInvoiceNumberFrom([{ number: null }, { number: NaN as unknown as number }, { number: 2 }]) === 3);

console.log('\n#45 the portal promise matches the portal');
ok('a sent invoice is shown', invoiceShownInPortal({ status: 'sent' }));
ok('a legacy invoice (no state) is shown', invoiceShownInPortal(undefined) && invoiceShownInPortal(null));
ok('a draft is hidden', !invoiceShownInPortal({ status: 'draft' }));
ok('a recalled invoice is hidden', !invoiceShownInPortal({ status: 'recalled' }));

console.log('\n#47 who a reminder goes to');
ok('the address the invoice went to wins over the portal invitee',
  reminderRecipient('ap@owner.com', [{ email: 'spouse@home.com' }]) === 'ap@owner.com');
ok('no billing address → first portal invitee with an @', reminderRecipient(undefined, [{ email: 'nope' }, { email: 'owner@home.com' }]) === 'owner@home.com');
ok('a blank billing address falls back', reminderRecipient('  ', [{ email: 'owner@home.com' }]) === 'owner@home.com');
ok('nobody → null', reminderRecipient(null, []) === null && reminderRecipient('', [{ email: '' }]) === null);
const base = {
  status: 'sent', totalDue: 1000, amountPaid: 0, nowMs: Date.UTC(2026, 8, 18),
  dueMs: Date.UTC(2026, 8, 1), dunningStage: 0, manual: true,
};
ok('no recipient blocks with no_recipient, up front', reminderEligibility({ ...base, hasRecipient: false }).reason === 'no_recipient');
ok('…and still counts the days overdue (17), so the card keeps "N days overdue"',
  reminderEligibility({ ...base, hasRecipient: false }).daysOverdue === 17);
ok('…and 0 days (not negative) while the invoice is still current',
  reminderEligibility({ ...base, dueMs: Date.UTC(2026, 9, 1), hasRecipient: false }).daysOverdue === 0);
ok('…even before the invoice is overdue (while he can still fix it)',
  reminderEligibility({ ...base, dueMs: Date.UTC(2026, 9, 1), hasRecipient: false }).reason === 'no_recipient');
ok('a paid invoice still says paid, not no_recipient', reminderEligibility({ ...base, amountPaid: 1000, hasRecipient: false }).reason !== 'no_recipient');
ok('a recipient → eligible', reminderEligibility({ ...base, hasRecipient: true }).eligible);
ok('unknown recipient (cron parity) is not blocked here', reminderEligibility({ ...base }).eligible);
ok('the card copy says reminders are off and why', /Automatic reminders are off — no client email/.test(reminderBlockMessage('no_recipient')));

console.log('\nthe screen is wired to the rules');
const confirm = handler('handleConfirmSend');
const pdf = handler('handleSendPDF');
const mint = handler('mintPayLinkFor');
ok('handleConfirmSend / handleSendPDF / mintPayLinkFor found', !!confirm && !!pdf && !!mint);
ok('the mint checks Stripe\'s limits before calling Stripe', /payLinkAmountBlock\(amount\)/.test(mint) && mint.indexOf('payLinkAmountBlock') < mint.indexOf('createPaymentLink('));
ok('a failed mint carries a plain reason', /message: payLinkFailureReason\(res\.error\)/.test(mint));
ok('a new invoice\'s queued insert is checked before minting',
  /pendingIdsForTable\(await getOfflineQueue\(\), 'invoices'\)\.has\(workingInvoice\.id\)/.test(confirm)
  && confirm.indexOf('pendingIdsForTable') < confirm.indexOf('mintPayLinkFor('));
ok('an unreadable queue skips the mint, with copy that does not claim he is offline',
  /catch \{ insertState = 'unknown'; \}/.test(confirm)
  && /insertState === 'unknown'\) \{\s*noPayButtonReason = "the invoice couldn't be confirmed on the server yet";/.test(confirm));
for (const [name, src] of [['handleConfirmSend', confirm], ['handleSendPDF', pdf]] as const) {
  ok(`${name}: a non-ok mint sets the no-Pay-button reason`, /noPayButtonReason = minted\.message \?\? payLinkFailureReason\(minted\.error\)/.test(src));
  ok(`${name}: a THROWN mint sets it too`, /catch \(err\) \{[\s\S]{0,160}noPayButtonReason = payLinkFailureReason\(/.test(src));
  ok(`${name}: the reason reaches the GC via sentWithoutPayButtonMessage`, /sentWithoutPayButtonMessage\(/.test(src));
  ok(`${name}: the subject is exact to the cent`, /subject: `Invoice #\$\{[a-zA-Z]+\.number\}: \$\{formatCurrency\(/.test(src) && !/\/ 1_000\)\}K/.test(src));
}
ok('handleConfirmSend: the no-Pay-button result REPLACES the "sent" toast',
  /if \(noPayButtonReason\) \{[\s\S]{0,400}router\.back\(\);\s*return;/.test(confirm)
  && confirm.indexOf('if (noPayButtonReason)') < confirm.indexOf('nailIt(`Invoice #${workingInvoice.number} sent'));
ok('handleConfirmSend: the portal post uses the latest-callback ref, after the email succeeded',
  /await sendToClientPortalRef\.current\(\{ kind: 'invoice', itemId: workingInvoice\.id/.test(confirm)
  && confirm.indexOf('sendToClientPortalRef.current') > confirm.indexOf('if (!result.success)'));
ok('handleConfirmSend: the post is gated on the tick AND a live portal', /if \(postToPortal && portalEnabled\)/.test(confirm));
ok('the Send sheet offers "Also post to client portal", ticked by default',
  /useState\(true\)/.test(SCREEN.slice(SCREEN.indexOf('const [postToPortal'), SCREEN.indexOf('const [postToPortal') + 60))
  && /Also post to client portal/.test(SCREEN));
ok('the send stores the recipient for reminders (new and existing branches)',
  /billToEmail: sendRecipientEmail\.trim\(\)/.test(confirm) && /updateInvoice\(workingInvoice\.id, \{ status: 'sent', dueDate, \.\.\.billTo \}\)/.test(confirm) && /updateInvoice\(existingInvoice\.id, \{\s*\.\.\.billTo,/.test(confirm));
ok('the PDF send stores its recipient too', /billToEmail: sentTo/.test(pdf));
// Integration critic money-portal: a PDF re-send to a NEW address must not keep
// the old recipient's name (dunning pairs bill_to_name with bill_to_email).
ok('the PDF send clears the previous recipient\'s name with the address', /\{ billToEmail: sentTo, billToName: undefined \}/.test(pdf));
{
  const cols = invoiceBillToColumns({ billToEmail: 'ap@lender.com', billToName: undefined }, { billToEmail: 'ap@lender.com', billToName: undefined });
  ok('…and that patch writes bill_to_name null', cols.bill_to_email === 'ap@lender.com' && 'bill_to_name' in cols && cols.bill_to_name === null, JSON.stringify(cols));
}
ok('the pay-link card promises the portal only when the portal shows it',
  /invoiceShownInPortal\(existingInvoice\.portalState\)\s*\?\s*'Clients can pay by card or ACH via the portal\.'/.test(SCREEN));
ok('"Payment Link Ready" promises the portal only when the portal shows it',
  /invoiceShownInPortal\(existingInvoice\.portalState\)\s*\?\s*'A Stripe payment link has been generated and attached to this invoice\. Your client will see a Pay Now button in the portal\.'/.test(SCREEN));
ok('no unconditional portal promise is left', (SCREEN.match(/Pay Now button in the portal/g) ?? []).length === 1);
ok('the reminder card passes hasRecipient from the cron\'s own order', /hasRecipient: reminderRecipient\(/.test(SCREEN));
// Reviewer major: the card renders only for invoices already sent, so its fix
// must never reach the draft Send sheet's re-issue (dueDate from today +
// status 'sent'). It opens the PDF send, which keeps both.
{
  const i = SCREEN.indexOf("reminderState.eligibility.reason === 'no_recipient' && (");
  const cta = i < 0 ? '' : SCREEN.slice(i, i + 400);
  ok('the reminder card offers the fix when there is nobody to remind', /testID="reminder-add-recipient"/.test(cta));
  ok('…and it opens the PDF send, not the draft Send sheet', /onPress=\{\(\) => setShowPDFPreSend\(true\)\}/.test(cta) && !/handleSendPress/.test(cta));
  ok('the PDF send keeps the stored due date and writes no status',
    /const dueDate = existingInvoice\.dueDate \|\|/.test(pdf) && !/status: 'sent'/.test(pdf) && !/updateInvoice\([^)]*dueDate/.test(pdf));
  ok('the PDF sheet is prefilled from the stored address, then the portal invitee', /defaultRecipient=\{pdfDefaultRecipient\}/.test(SCREEN)
    && /reminderRecipient\(billTo\?\.billToEmail, project\?\.clientPortal\?\.invites/.test(SCREEN));
}
ok('handleConfirmSend: a non-draft invoice is re-sent under its stored due date',
  /const isResend = !!existingInvoice && existingInvoice\.status !== 'draft';/.test(confirm)
  && /const dueDate = isResend && existingInvoice\?\.dueDate \? existingInvoice\.dueDate : getDueDate\(/.test(confirm));
ok('handleConfirmSend: a re-send writes only billTo — no status, no due date',
  /\} else if \(existingInvoice && isResend\) \{[\s\S]{0,200}const billToOnly: Partial<Invoice> & InvoiceBillTo = \{ \.\.\.billTo \};\s*updateInvoice\(existingInvoice\.id, billToOnly\);\s*\} else if \(existingInvoice\) \{/.test(confirm));
ok('the manual Generate Payment Link checks Stripe\'s limits before the round trip',
  (() => { const g = handler('handleGeneratePayLink'); return /if \(payLinkLimitReason\)/.test(g) && g.indexOf('payLinkLimitReason') < g.indexOf('createPaymentLink('); })());
ok('…and the Generate button is disabled with the reason shown',
  /disabled=\{generatingPayLink \|\| !!payLinkLimitReason\}/.test(SCREEN) && /testID="pay-link-limit-reason"/.test(SCREEN)
  && /const payLinkLimitReason = balanceDue > 0 \? payLinkAmountBlock\(balanceDue\) : null;/.test(SCREEN));
ok('the Send sheet prefills the stored address, then the portal invitee — on OPEN only',
  /const opening = showSendRecipient && !sendSheetWasOpen\.current;[\s\S]{0,400}reminderRecipient\(billTo\?\.billToEmail/.test(SCREEN));
// Post-chain: the session max moved to utils/billingFlowCore (shared with
// app/bill-from-estimate.tsx), so the screen holds the two CALLS, not the definition.
ok('every created invoice notes its number for the session', (SCREEN.match(/noteIssuedInvoiceNumber\(/g) ?? []).length >= 2
  && /export function noteIssuedInvoiceNumber\(/.test(readFileSync(join(ROOT, 'utils', 'billingFlowCore.ts'), 'utf8')));
ok('nextInvoiceNumber reads the session max', /nextInvoiceNumberFrom\(existingInvoices, sessionIssuedInvoiceMax\.get\(/.test(SCREEN));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
