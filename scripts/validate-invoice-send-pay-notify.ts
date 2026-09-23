// validate-invoice-send-pay-notify.ts — the GC hears when his client pays
// (wave 3, lane invoice-send-pay: #48, plus the notify events other lanes fire).
//
//   #48 stripe-webhook credited the invoice and emailed the CLIENT a receipt —
//       and told the GC nothing: no push, no email, no inbox row. It now raises
//       client_invoice_paid through notify (push + email + notification_outbox,
//       which the inbox reads) from the invoice AND the AIA pay-app success
//       paths, only for a credited, non-duplicate delivery, and never from
//       inside creditInvoice (the AIA path calls it too; validate-invoice-billing
//       executes it against a fake Db). A delayed (ACH) payment that bounces
//       raises client_payment_failed — the old TODO.
//   The events chains B-D fire (field_report_filed, pro_response_received,
//   punch_marked_ready) get their wording here and their routes in
//   validate-notification-routes. All five are SERVICE-ONLY in notify.
//
// Pure blocks are executed; wiring is pinned.
//
// Run: bun run scripts/validate-invoice-send-pay-notify.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const WEBHOOK = process.env.WEBHOOK_PATH ? readFileSync(process.env.WEBHOOK_PATH, 'utf8') : read('supabase/functions/stripe-webhook/index.ts');
const NOTIFY = process.env.NOTIFY_PATH ? readFileSync(process.env.NOTIFY_PATH, 'utf8') : read('supabase/functions/notify/index.ts');
const INBOX = read('app/notifications-inbox.tsx');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;
function block(src: string, file: string, marker: string): string {
  const start = src.indexOf(`// >>> ${marker}`);
  const end = src.indexOf(`// <<< ${marker}`);
  ok(`${file} carries the ${marker} marker block`, start > -1 && end > start);
  return start > -1 && end > start ? src.slice(start, end) : '';
}
function evalJs<T>(ts: string, names: string[]): T | null {
  if (!ts) return null;
  const js = new Transpiler({ loader: 'ts' }).transformSync(ts.replace(/^export /gm, ''));
  return new Function(`${js}\nreturn { ${names.join(', ')} };`)() as T;
}

type Req = { event: string; source_table: string; source_id: string; payload: Record<string, unknown> } | null;
const W = evalJs<{ clientInvoicePaidEvent: (inv: Record<string, unknown>, c: { amountReceived: number; newStatus: string }, remaining: number) => Req }>(
  block(WEBHOOK, 'stripe-webhook', 'client-paid-notify'), ['clientInvoicePaidEvent'],
);
type Text = { prefKey: string; pushTitle: string; pushBody: string; emailSubject: string; title: string; subtitle: string; rows: [string, string, boolean?][]; ctaLabel: string } | null;
const fmtBlock = block(NOTIFY, 'notify', 'notify-format');
const textBlock = block(NOTIFY, 'notify', 'wave3-notify-text');
const N = fmtBlock && textBlock
  ? evalJs<{ wave3NotifyText: (e: string, p: Record<string, unknown>, proj: string) => Text }>(`${fmtBlock}\n${textBlock}`, ['wave3NotifyText'])
  : null;

console.log('\n#48 the paid event');
if (W) {
  const inv = { id: 'inv-1', number: 7, project_id: 'p-1', user_id: 'gc-1' };
  const part = W.clientInvoicePaidEvent(inv, { amountReceived: 5000, newStatus: 'partially_paid' }, 72484.88);
  ok('a partial payment names the amount, the balance and not paid-in-full',
    part?.event === 'client_invoice_paid' && part.payload.amount_paid === 5000 && part.payload.balance === 72484.88 && part.payload.paid_in_full === false, JSON.stringify(part));
  ok('the payload carries project, invoice and number (the route and the inbox read them)',
    part?.payload.project_id === 'p-1' && part.payload.invoice_id === 'inv-1' && part.payload.number === 7 && part.source_id === 'inv-1');
  const full = W.clientInvoicePaidEvent(inv, { amountReceived: 77484.88, newStatus: 'paid' }, 0.004);
  ok('a settling payment is paid in full with a zero balance', full?.payload.paid_in_full === true && full.payload.balance === 0);
  ok('an invoice with no project raises nothing (notify could not resolve the GC)', W.clientInvoicePaidEvent({ ...inv, project_id: null }, { amountReceived: 1, newStatus: 'paid' }, 0) === null);
}

console.log('\nthe wording (exact to the cent)');
if (N) {
  const paid = N.wave3NotifyText('client_invoice_paid', { number: 7, amount_paid: 77484.88, balance: 0, paid_in_full: true }, 'Henderson');
  ok('"Client paid Invoice #7 · Henderson" / "$77,484.88 received — paid in full."',
    paid?.pushTitle === 'Client paid Invoice #7 · Henderson' && paid.pushBody === '$77,484.88 received — paid in full.', JSON.stringify(paid));
  const part = N.wave3NotifyText('client_invoice_paid', { number: '7', amount_paid: 5000, balance: 72484.88, paid_in_full: false }, 'Henderson');
  ok('a partial names what is still due', part?.pushBody === '$5,000 received · $72,484.88 still due.', part?.pushBody);
  ok('nothing is rounded to $K anywhere in the paid text', !!paid && !/\$\d+K/.test(JSON.stringify(paid)) && !!part && !/\$\d+K/.test(JSON.stringify(part)));
  const fail = N.wave3NotifyText('client_payment_failed', { number: 7, amount: 1250.5 }, 'Henderson');
  ok('a bounced payment says nothing was credited', !!fail && /\$1,250\.50/.test(fail.pushBody) && /still open/.test(fail.pushBody));
  const dr = N.wave3NotifyText('field_report_filed', { author_name: 'Luis' }, 'Henderson');
  ok('a filed report names its author and that the homeowner sees nothing yet', dr?.title === 'Luis filed a daily report' && /homeowner/.test(dr.pushBody));
  const rfi = N.wave3NotifyText('pro_response_received', { kind: 'rfi', number: 12, responder_name: 'Arch Co', action_code: 'Answered' }, 'Henderson');
  ok('an RFI response names the RFI, the responder and the code', rfi?.pushTitle === 'RFI #12 answered · Henderson' && /Arch Co responded — Answered/.test(rfi.pushBody));
  const sub = N.wave3NotifyText('pro_response_received', { kind: 'submittal', number: 3, action_code: 'Revise and resubmit' }, 'H');
  ok('a submittal response is labelled Submittal', !!sub && /^Submittal #3/.test(sub.pushTitle) && sub.rows[0]?.[0] === 'Action');
  const pr = N.wave3NotifyText('punch_marked_ready', { sub_name: 'ACME Drywall' }, 'H');
  ok('a punch item marked ready names the sub', pr?.title === 'ACME Drywall says a punch item is done');
  ok('an event this block does not own → null', N.wave3NotifyText('portal_message', {}, 'H') === null);
  ok('a uuid is never printed as a number', !/#9b1e/.test(JSON.stringify(N.wave3NotifyText('client_invoice_paid', { number: '9b1e44c0', amount_paid: 1 }, 'H'))));
}

console.log('\nwiring');
const credit = WEBHOOK.slice(WEBHOOK.indexOf('// --- BEGIN creditInvoice'), WEBHOOK.indexOf('// --- END creditInvoice ---'));
ok('creditInvoice itself notifies nobody (the AIA path would double it; the validator lifts it)', credit.length > 100 && !/notifyGc|postNotify|functions\/v1\/notify/.test(credit));
const checkout = WEBHOOK.slice(WEBHOOK.indexOf('async function handleCheckoutCompleted('), WEBHOOK.indexOf('async function handleAiaPayAppCompleted('));
ok('the invoice path notifies AFTER the duplicate guard',
  checkout.indexOf('if (credit.duplicate) return') > -1 && checkout.indexOf('notifyGcInvoicePaid(supabase, invoiceId, credit)') > checkout.indexOf('if (credit.duplicate) return'));
const aia = WEBHOOK.slice(WEBHOOK.indexOf('async function handleAiaPayAppCompleted('), WEBHOOK.indexOf('async function findInvoiceByPaymentIntent('));
ok('the AIA path notifies only a credited, non-duplicate delivery', /if \(!credit\.duplicate\) afterCredit\(notifyGcInvoicePaid\(supabase, invoiceId, credit\)\)/.test(aia) && aia.indexOf('if (!credit.ok)') < aia.indexOf('notifyGcInvoicePaid'));
// wave 4 #45: still never awaited inline (a notify failure never makes Stripe
// retry a credited payment), but no longer `void`ed — registered with
// afterCredit, whose flushSideEffects hands Promise.allSettled to
// EdgeRuntime.waitUntil (or a bounded await) before markProcessed.
// scripts/validate-w4-money-ledger-pending.ts executes that helper.
ok('both are registered side effects, never awaited inline — a notify failure never makes Stripe retry a credited payment',
  /afterCredit\(notifyGcInvoicePaid\(/.test(checkout) && !/await notifyGcInvoicePaid/.test(WEBHOOK)
  && !/void notifyGcInvoicePaid\(/.test(WEBHOOK));
ok('the service-role hop to notify (as award-rfp does)', /fetch\(`\$\{SUPABASE_URL\}\/functions\/v1\/notify`/.test(WEBHOOK) && /Bearer \$\{SUPABASE_SERVICE_ROLE_KEY\}/.test(WEBHOOK));
ok('the payment_failed TODO is resolved: a bounced ACH session notifies', !/TODO: surface as a contractor notification/.test(WEBHOOK) && /event\.type === "checkout\.session\.async_payment_failed"[\s\S]{0,900}notifyGcPaymentFailed/.test(WEBHOOK));
ok('failure logs still never dump the Stripe object', /console\.log\("\[stripe-webhook\] Payment failed:", event\.type, obj\?\.id \?\? "\(no id\)"\)/.test(WEBHOOK));
const m = /SERVICE_ONLY_EVENTS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/.exec(NOTIFY);
for (const e of ['client_invoice_paid', 'client_payment_failed', 'field_report_filed', 'pro_response_received', 'punch_marked_ready']) {
  ok(`notify: ${e} is service-only (no JWT can forge it)`, !!m && m[1].includes(`'${e}'`));
  ok(`notify: ${e} has a dispatch case`, NOTIFY.includes(`case '${e}':`));
  ok(`inbox: ${e} has a label and a summary`, new RegExp(`\\n  ${e}:\\s+\\{ icon:`).test(INBOX) && INBOX.includes(`case '${e}':`));
}
// Integration critic server r1: every prefKey the wave-3 block sends under
// has a row in notifications settings, or the GC cannot mute it (the email's
// unsubscribe link was the only way out; the push had none).
{
  const SETTINGS = read('app/notifications-settings.tsx');
  const block = NOTIFY.slice(NOTIFY.indexOf('function wave3NotifyText('), NOTIFY.indexOf('function wave3NotifyText(') + 12000);
  const keys = [...new Set([...block.matchAll(/prefKey: '([a-z_]+)'/g)].map(m => m[1]))];
  // Wave 4 (safety lane): safety_incident_filed sends under its own
  // 'safety_incident' key — the per-key mute-row loop below still holds it.
  ok('the wave-3 block sends under the five known prefKeys', keys.sort().join(',') === 'field_report,invoice_paid,pro_response,punch_ready,safety_incident', keys.join(','));
  for (const k of keys) {
    ok(`settings: prefKey ${k} has a mute row`, new RegExp(`\\n    key: '${k}',\\n    label: '`).test(SETTINGS) && new RegExp(`\\| '${k}'`).test(SETTINGS));
  }
  ok('settings: every group with rows is rendered', /\(\['leads', 'client', 'team', 'sub', 'marketplace'\] as CategoryDef\['group'\]\[\]\)/.test(SETTINGS));
}
// Wave 5 (CONTRACT 8): the three sub-side events send under their own event
// names from wave5NotifyText — kept OUT of the wave-3 block above (its five
// keys stay pinned) and held to the same rule: every prefKey has a mute row.
{
  const SETTINGS = read('app/notifications-settings.tsx');
  const start = NOTIFY.indexOf('function wave5NotifyText(');
  const end = NOTIFY.indexOf('// <<< wave5-notify-text');
  const w5 = start > -1 && end > start ? NOTIFY.slice(start, end) : '';
  const keys = [...new Set([...w5.matchAll(/prefKey: '([a-z_]+)'/g)].map(m => m[1]))];
  ok('the wave-5 block sends under exactly its three event names', keys.sort().join(',') === 'bid_invite_received,lien_waiver_signed,prequal_submitted', keys.join(','));
  for (const k of keys) {
    ok(`settings: wave-5 prefKey ${k} has a mute row in the sub group`,
      new RegExp(`\\n    key: '${k}',\\n    label: '[^']+',\\n    description: '[^\\n]+',\\n    icon: [^\\n]+,\\n    group: 'sub',`).test(SETTINGS) && new RegExp(`\\| '${k}'`).test(SETTINGS));
  }
}
ok('notify email about his own client carries no "Sent by <himself>"', /case 'punch_marked_ready': \{[\s\S]{0,1200}sender: null/.test(NOTIFY));
ok('the email button goes through the shared route table', /cta: \{ label: text\.ctaLabel, href: appLink\(event, /.test(NOTIFY));
ok('the inbox prints the paid amount exact (fmtMoneyExact, not the compact $K formatter)', /case 'client_invoice_paid': \{[\s\S]{0,300}fmtMoneyExact\(p\.amount_paid\)/.test(INBOX));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
