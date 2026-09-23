// validate-w4-invoice-send-screen.ts — wave 4, lane invoice-send (chain B).
//
// The call sites of the invoice-send fixes, pinned in the shipped files. The
// pure rules they call are EXECUTED by validate-w4-invoice-send-core.ts; this
// file proves the screens and the edge function actually call them, in the
// order that matters:
//   #34 one send at a time (ref taken before any await, released in finally
//       unless the screen is leaving), controls disabled + "Sending…", the
//       editor pointed at the new draft right after addInvoice.
//   #36 the mint maps an unreachable status check to a reason; the queue
//       check runs for existing drafts too; the PDF path names not-connected.
//   #39 a refused insert stops BEFORE sendEmail; the check runs for every
//       send, not only when a mint is due.
//   #43 portalEnabled and the pay-link copy use the portal predicates.
//   #84 the composer_opened branches store the recipient.
//   #66 the tax row is editable with its source; "Invoice total".
//   #38 both screens gate on the owner; create-payment-link checks the
//       project owner; migration 03 replaces BOTH insert policies.
//   #83 carry: create-payment-link answers 409 payment_pending.
//
// Run: bun run scripts/validate-w4-invoice-send-screen.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(process.env[`W4IS_${f.replace(/\W/g, '_')}`] ?? join(ROOT, f), 'utf8');
let passed = 0; let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
// Comments stripped, so a WHY comment can never satisfy a pin.
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const INV = code(read('app/invoice.tsx'));
const BFE = code(read('app/bill-from-estimate.tsx'));
const CPL = code(read('supabase/functions/create-payment-link/index.ts'));
const MIG = read('supabase/migrations/20260920030000_invoices_owner_insert.sql');
const between = (s: string, a: string, b: string) => { const i = s.indexOf(a); const j = s.indexOf(b, i + a.length); return i >= 0 && j > i ? s.slice(i, j) : ''; };

console.log('\n#34 one send at a time');
const wrapper = between(INV, 'const handleConfirmSend = useCallback(async () => {', '}, [runConfirmSend]);');
ok('handleConfirmSend wraps the body', wrapper.length > 0);
ok('…returns at once while a send is in flight (ref, before any await)', /useCallback\(async \(\) => \{\s*if \(sendingRef\.current\) return;\s*sendingRef\.current = true;\s*setSendInFlight\(true\);/.test(wrapper));
ok('…releases in finally unless the screen is leaving', /finally \{\s*if \(!left\) \{\s*sendingRef\.current = false;\s*setSendInFlight\(false\);/.test(wrapper));
const run = between(INV, 'const runConfirmSend = useCallback(async (): Promise<\'left\' | void> => {', '\n  }, [');
ok('every router.back() in the send body returns \'left\'', run.length > 0 && (run.match(/router\.back\(\);/g) ?? []).length === (run.match(/router\.back\(\);\s*return 'left';/g) ?? []).length && /router\.back\(\);\s*return 'left';/.test(run));
ok('the editor points at the new draft right after addInvoice', /addInvoice\(workingInvoice\);\s*noteIssuedInvoiceNumber\([^)]*\);\s*void linkMilestone\(workingInvoice\);\s*router\.setParams\(\{ invoiceId: workingInvoice\.id \}\);/.test(run));
const save = between(INV, 'const handleSave = useCallback(', 'router.back();');
ok('Save to Project refuses mid-send and takes the lock', /if \(sendingRef\.current\) return;/.test(save) && /sendingRef\.current = true;/.test(save));
ok('handleSendPress refuses mid-send', /const handleSendPress = useCallback\(\(\) => \{\s*if \(sendingRef\.current\) return;/.test(INV));
ok('Save to Project is disabled mid-send', /label="Save to Project"[\s\S]{0,160}disabled=\{sendInFlight\}/.test(INV));
ok('Send & Save is disabled and relabelled "Sending…"', /label=\{sendInFlight \? 'Sending…' : 'Send & Save'\}[\s\S]{0,120}disabled=\{sendInFlight\}/.test(INV));
ok("the sheet's Send is disabled mid-send", /onPress=\{handleConfirmSend\}\s*disabled=\{sendInFlight\}/.test(INV));

console.log('\n#36 / #39 the row and the Stripe check, before the email');
ok('the Stripe check is tri-state (resolveStripeAccount)', /resolveStripeAccount\(user\?\.id\)/.test(INV) && /account\.kind === 'unreachable'[\s\S]{0,160}message: STRIPE_UNREACHABLE_REASON/.test(INV));
ok('only an ANSWERED check is not_connected', /if \(account\.kind === 'not_connected'\) return \{ ok: false, reason: 'not_connected' \};/.test(INV));
ok('existing drafts get the queue check too', /else if \(existingInvoice\?\.status === 'draft'\) \{\s*insertState = await readQueuedInsert\(\);/.test(run));
const refuse = run.indexOf("if (insertState === 'failed') {");
ok('a refused insert stops with the reason', refuse > 0 && /if \(insertState === 'failed'\) \{\s*showAlert\('Invoice not sent', invoiceInsertRefusedMessage\(workingInvoice\.number\)\);\s*return;/.test(run));
ok('…BEFORE the email and before the mint gate', refuse > 0 && refuse < run.indexOf('await sendEmail(') && refuse < run.indexOf('if (!workingLinkMatchesBalance && balanceDue > 0)'));
// Review round 1: a refused write sits in the sync ledger's "Not saved" list,
// NOT the offline queue — the queue read alone answered 'clear' and the next
// Send emailed an invoice the server still did not have.
ok('the row check reads the "Not saved" ledger (unsavedWriteIds) before the queue', /if \(\(await unsavedWriteIds\('invoices'\)\)\.has\(workingInvoice\.id\)\) return 'unsaved';\s*return pendingIdsForTable/.test(run));
const unsaved = run.indexOf("if (insertState === 'unsaved') {");
ok('an unsaved draft stops with the reason BEFORE the email', unsaved > 0 && unsaved < run.indexOf('await sendEmail(') && /if \(insertState === 'unsaved'\) \{\s*showAlert\('Invoice not sent', invoiceUnsavedOnServerMessage\(workingInvoice\.number\)\);\s*return;/.test(run));
{
  const pdfStart = INV.indexOf('const handleSendPDF = useCallback(');
  const pdf = INV.slice(pdfStart, INV.indexOf('}, [project, existingInvoice, settings', pdfStart));
  const stop = pdf.search(/if \(\(await unsavedWriteIds\('invoices'\)\)\.has\(existingInvoice\.id\)\) \{\s*showAlert\('Invoice not sent', invoiceUnsavedOnServerMessage\(existingInvoice\.number\)\);\s*return;/);
  ok('the PDF send stops an unsaved draft BEFORE its email', pdfStart > 0 && stop > 0 && stop < pdf.indexOf('await sendEmail('));
  ok('the PDF send skips the mint for a queued draft, saying why', /if \(pdfInsertQueued && !storedLinkMatchesBalance && pdfNetDue > 0\) \{\s*noPayButtonReason = INVOICE_INSERT_QUEUED_REASON;/.test(pdf));
}
ok('"saved on this phone only" is gone', !/saved on this phone only/.test(INV));
ok('the PDF path names not-connected (no plain "Email Sent")', /minted\.reason === 'not_connected'\) \{[\s\S]{0,200}noPayButtonReason = STRIPE_NOT_CONNECTED_REASON;/.test(INV));
ok('a failed mint asks the row about a pending bank payment', /if \(await serverPaymentPending\(invoice\.id\)\) \{\s*return \{ ok: false, reason: 'failed', error: 'payment_pending', message: PAYMENT_PENDING_MINT_REASON \};/.test(INV));

console.log('\n#43 the portal predicates');
ok('portalEnabled = invoicesVisibleInPortal', /const portalEnabled = invoicesVisibleInPortal\(project\?\.clientPortal\);/.test(INV));
ok('the checkbox says when invoices are hidden', /portalHidesInvoices\s*\?\s*PORTAL_INVOICES_HIDDEN_HINT/.test(INV));
ok('both pay-link promises use invoicePayableInPortal', (INV.match(/invoicePayableInPortal\(project\.clientPortal, existingInvoice\.portalState\)/g) ?? []).length === 2 && !/invoiceShownInPortal\(/.test(INV));
ok('the reminder card says when the portal link is withheld (#81)', /reminderCarriesPortalLink\(/.test(INV) && /reminder-portal-link-withheld/.test(INV));

console.log('\n#84 the composer fallback keeps the recipient');
const comp = between(run, "if (result.outcome === 'composer_opened') {", 'showAlert(');
ok('Send: composer_opened stores billToEmail/billToName', /updateInvoice\(workingInvoice\.id, billToPatch\)/.test(comp) && /billToEmail: typedTo/.test(comp));
const pdfComp = between(INV, "} else if (result.outcome === 'composer_opened') {", "showAlert('Draft opened");
ok('PDF: composer_opened stores the recipient', /updateInvoice\(existingInvoice\.id, billToPatch\)/.test(pdfComp));

console.log('\n#66 tax and the total label');
ok('the tax rate is seeded by invoiceTaxSeed (milestone aware)', /invoiceTaxSeed\(\{[\s\S]{0,200}milestoneId: !invoiceId \? milestoneId : null/.test(INV) && /settings\.taxRate \?\? 0/.test(INV));
ok('an editable tax input with its source on new/draft', /testID="invoice-tax-rate-input"/.test(INV) && /invoiceTaxSourceLabel\(taxSeed, taxRateText != null\)/.test(INV));
ok('"Invoice total", never "Contract Total"', />Invoice total</.test(INV) && !/Contract Total/.test(INV));

console.log('\n#38 owner-only billing');
ok('invoice route gate before the paywall', INV.indexOf('if (roleGate !== \'open\') {') > 0 && INV.indexOf('if (roleGate !== \'open\') {') < INV.indexOf("if (!canAccess('change_orders_invoicing'))"));
ok('invoice: the picked job is gated too', /if \(innerRoleGate !== 'open'\) \{\s*return <InvoiceRoleBlocked/.test(INV));
ok('invoice: send and save refuse a blocked seat', (INV.match(/if \(billingBlocked\) \{\s*showAlert\('Only the job owner bills', INVOICE_OWNER_ONLY_REASON\);/g) ?? []).length >= 3);
ok('bill-from-estimate: gate + blocked render + create refuses', /invoiceRoleGate\(\{/.test(BFE) && /if \(roleGate !== 'open'\) \{\s*const copy = invoiceRoleBlockedCopy/.test(BFE) && /if \(roleGate !== 'open'\) \{\s*showAlert\('Only the job owner bills'/.test(BFE));
ok('create-payment-link checks the project owner', /projects\?id=eq\.\$\{encodeURIComponent\(projectId\)\}&select=user_id/.test(CPL) && /projRows\[0\]\.user_id !== callerSub/.test(CPL));
ok('create-payment-link answers 409 payment_pending', /if \(paymentPendingHolds\(ownRows\[0\]\.pay_pending_at \?\? null, Date\.now\(\)\)\) \{\s*return jsonResponse\(\{ success: false, error: "payment_pending" \}, 409\);/.test(CPL));
ok('…before any Stripe call', CPL.indexOf('"payment_pending" }, 409') < CPL.indexOf('stripeFetch("/prices"'));
ok('migration 03 replaces BOTH insert policies with the owner check', (MIG.match(/create policy (invoices_insert|inv_insert_own) on public\.invoices\s+for insert\s+with check \(\s*auth\.uid\(\) = user_id\s+and \(\s*project_id is null\s+or exists \(\s*select 1 from public\.projects p\s+where p\.id = invoices\.project_id\s+and p\.user_id = auth\.uid\(\)/g) ?? []).length === 2
  && /drop policy if exists invoices_insert/.test(MIG) && /drop policy if exists inv_insert_own/.test(MIG));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
