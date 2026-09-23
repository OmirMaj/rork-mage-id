// validate-w4-invoice-send-core.ts — wave 4, lane invoice-send (chain B).
//
// EXECUTES the pure rules this lane added (never regex over them):
//   #37 the invoice email is exact to the cent — title, preheader, Amount due
//       row and the Pay button say $1,250.50, never "$1,251" (the subject and
//       the Stripe charge were already to the cent).
//   #36 a FAILED Stripe status check is 'unreachable', never "not connected".
//   #39 queued / unconfirmed / refused inserts never end in "tap Generate
//       Payment Link" (the row is not on the server).
//   #43 the portal shows invoices only when it is on AND showInvoices is not
//       off; the pay-link copy promises a portal Pay button only then.
//   #81 a reminder carries the portal link only to a portal invitee — in the
//       app mirror AND in invoice-dunning's own marker block.
//   #38 the owner-only role gate (the #41 rule), and dunning's owner check.
//   #66 a new milestone invoice seeds 0% tax; the rest seed Settings; an
//       existing invoice keeps its own rate.
//   #83 carry: create-payment-link's pending hold agrees with dunning's and
//       billingFlowCore's to the millisecond.
//
// Run: bun run scripts/validate-w4-invoice-send-core.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../utils/billingFlowCore';
import * as layout from '../utils/emailLayout';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
let passed = 0; let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
}
const { Transpiler } = (globalThis as unknown as {
  Bun: { Transpiler: new (o: { loader: string }) => { transformSync(src: string): string } };
}).Bun;
const tx = (src: string) => new Transpiler({ loader: 'ts' }).transformSync(src).replace(/^export /gm, '');
function block<T>(file: string, marker: string, names: string[]): T {
  const src = process.env[`W4IS_${file.replace(/\W/g, '_')}`] ? readFileSync(process.env[`W4IS_${file.replace(/\W/g, '_')}`]!, 'utf8') : read(file);
  const a = src.indexOf(`// >>> ${marker}`); const b = src.indexOf(`// <<< ${marker}`);
  if (a < 0 || b < a) { ok(`${file} carries the ${marker} block`, false); process.exit(1); }
  return new Function(`${tx(src.slice(a, b))}\nreturn { ${names.join(', ')} };`)() as T;
}

// ── #37 ────────────────────────────────────────────────────────────────
console.log('\n#37 the invoice email is exact to the cent');
ok('fmtMoneyCents(1250.5) = $1,250.50', layout.fmtMoneyCents(1250.5) === '$1,250.50', layout.fmtMoneyCents(1250.5));
ok('fmtMoneyCents(77484.88) = $77,484.88', layout.fmtMoneyCents(77484.88) === '$77,484.88');
ok('fmtMoneyCents rounds half a cent up, never to dollars', layout.fmtMoneyCents(0.005) === '$0.01' && layout.fmtMoneyCents(12) === '$12.00');
ok('fmtMoneyCents keeps the sign and the NaN guard', layout.fmtMoneyCents(-82.5) === '-$82.50' && layout.fmtMoneyCents('abc') === '—');
ok('fmtMoney (estimates) still whole dollars — not changed globally', layout.fmtMoney(8400.4) === '$8,400');
{
  const svc = read('utils/emailService.ts');
  const a = svc.indexOf('export function buildInvoiceEmailHtml(');
  const b = svc.indexOf('export function buildChangeOrderEmailHtml(');
  ok('buildInvoiceEmailHtml found', a > 0 && b > a);
  const build = new Function(
    'wrapEmailHtml', 'emailStatRow', 'emailStatCard', 'emailQuote', 'fmtMoney', 'fmtMoneyCents',
    `${tx(svc.slice(a, b))}\nreturn buildInvoiceEmailHtml;`,
  )(layout.wrapEmailHtml, layout.emailStatRow, layout.emailStatCard, layout.emailQuote, layout.fmtMoney, layout.fmtMoneyCents) as (o: Record<string, unknown>) => string;
  const html = build({
    companyName: 'Acme', recipientName: 'Dana', projectName: 'Maple St', invoiceNumber: 12,
    totalDue: 1250.5, dueDate: '2026-10-03T12:00:00.000Z', paymentTerms: 'Net 30', payLinkUrl: 'https://buy.stripe.com/x',
  });
  ok('title says $1,250.50 due', html.includes('$1,250.50 due'));
  ok('the Pay button says $1,250.50', html.includes('Pay securely · $1,250.50') || html.includes('Pay securely &middot; $1,250.50'));
  ok('the Amount due row says $1,250.50', /Amount due[\s\S]{0,400}\$1,250\.50/.test(html));
  ok('"$1,251" appears nowhere in the email', !html.includes('$1,251'));
  const co = svc.slice(b, svc.indexOf('export function', b + 10));
  ok('the CO builder uses the same cents formatter', /const money = \(n: number\) => fmtMoneyCents\(n\)/.test(co));
}

// ── #36 ────────────────────────────────────────────────────────────────
console.log('\n#36 a failed Stripe check is not "not connected"');
const st = core.stripeAccountStateFrom;
ok('network failure → unreachable', st({ success: false, error: 'Network request failed' }).kind === 'unreachable');
ok('no answer at all → unreachable', st(null).kind === 'unreachable');
ok('answered, no account → not_connected', st({ success: true, chargesEnabled: false }).kind === 'not_connected');
ok('answered, charges disabled → not_connected', st({ success: true, chargesEnabled: false, accountId: 'acct_1' }).kind === 'not_connected');
const c = st({ success: true, chargesEnabled: true, accountId: 'acct_1' });
ok('answered, enabled → connected with the id', c.kind === 'connected' && c.accountId === 'acct_1');
ok('the unreachable reason says offline, not "not connected"', /couldn't reach Stripe/.test(core.STRIPE_UNREACHABLE_REASON) && !/isn't connected/.test(core.STRIPE_UNREACHABLE_REASON));
ok('the unreachable reason IS retryable (try again once online)', core.payLinkReasonIsRetryable(core.STRIPE_UNREACHABLE_REASON));

// ── #39 ────────────────────────────────────────────────────────────────
console.log('\n#39 a row not on the server never suggests Generate Payment Link');
for (const [n, r] of [['queued', core.INVOICE_INSERT_QUEUED_REASON], ['unconfirmed', core.INVOICE_INSERT_UNCONFIRMED_REASON], ['pending', core.PAYMENT_PENDING_MINT_REASON], ['not connected', core.STRIPE_NOT_CONNECTED_REASON]] as const) {
  ok(`${n}: not retryable`, !core.payLinkReasonIsRetryable(r));
  ok(`${n}: the message has no "tap Generate Payment Link"`, !/Generate Payment Link/.test(core.sentWithoutPayButtonMessage(7, r)));
}
ok('a Stripe error still suggests the button', /Generate Payment Link/.test(core.sentWithoutPayButtonMessage(7, 'Stripe said: rate limited')));
ok('the queued reason never says "saved on this phone only"', !/saved on this phone only/.test(core.INVOICE_INSERT_QUEUED_REASON));
ok('the refused message says it was NOT sent', /was not sent/.test(core.invoiceInsertRefusedMessage(7)) && /Nothing went to your client/.test(core.invoiceInsertRefusedMessage(7)));
ok('the queued reason claims only what is known (no "you\'re offline")', !/offline/i.test(core.INVOICE_INSERT_QUEUED_REASON) && /sync queue/.test(core.INVOICE_INSERT_QUEUED_REASON));
for (const [n, m] of [['refused', core.invoiceInsertRefusedMessage(7)], ['unsaved', core.invoiceUnsavedOnServerMessage(7)]] as const) {
  ok(`${n}: says not sent, nothing went out`, /was not sent/.test(m) && /Nothing went to your client/.test(m));
  ok(`${n}: names the only resend path (Retry under "Not saved"), never "tap Send again" alone`, /Retry the invoice under "Not saved"/.test(m) && !/tap Send again\.$/.test(m));
}
ok("create-payment-link's 'payment_pending' maps to the processing copy", core.payLinkFailureReason('payment_pending') === core.PAYMENT_PENDING_MINT_REASON);

// ── #43 ────────────────────────────────────────────────────────────────
console.log('\n#43 the portal shows invoices only when its Invoices section is on');
const v = core.invoicesVisibleInPortal;
ok('on + showInvoices true → visible', v({ enabled: true, showInvoices: true }));
ok('on + legacy (no key) → visible', v({ enabled: true }));
ok('on + showInvoices false → hidden', !v({ enabled: true, showInvoices: false }));
ok('off → hidden', !v({ enabled: false, showInvoices: true }) && !v(null) && !v(undefined));
ok('payable-in-portal needs the portal AND the invoice shown', core.invoicePayableInPortal({ enabled: true }, null) && !core.invoicePayableInPortal({ enabled: true, showInvoices: false }, null) && !core.invoicePayableInPortal(null, null) && !core.invoicePayableInPortal({ enabled: true }, { status: 'draft' }));
ok('the hidden hint says so', /Invoices are hidden on this project's portal/.test(core.PORTAL_INVOICES_HIDDEN_HINT));

// ── #81 (app mirror) ───────────────────────────────────────────────────
console.log('\n#81 the portal link goes only to a portal invitee');
const invites = [{ email: 'Home@Owner.com ' }];
ok('invitee match is trimmed and case-insensitive', core.isPortalInvitee(' home@owner.COM', invites));
ok('the lender desk is not an invitee', !core.isPortalInvitee('draws@lender.com', invites));
ok('reminder to the lender carries no portal link', !core.reminderCarriesPortalLink('draws@lender.com', { enabled: true, invites }));
ok('reminder to the invitee (as bill-to) carries it', core.reminderCarriesPortalLink('home@owner.com', { enabled: true, invites }));
ok('reminder with no bill-to falls back to the invitee and carries it', core.reminderCarriesPortalLink(null, { enabled: true, invites }));
ok('invoices hidden → no portal link even to the invitee', !core.reminderCarriesPortalLink(null, { enabled: true, showInvoices: false, invites }));

// ── #81 / #43 / #38 (invoice-dunning's own blocks) ─────────────────────
console.log('\n#81 / #43 / #38 in invoice-dunning (executed)');
const D = block<{
  resolveDunningRecipient: (i: Record<string, unknown>, inv: unknown) => { email: string; source: 'bill_to' | 'portal_invite' } | null;
  dunningLinks: (i: Record<string, unknown>, u: string | null, o: number, cp?: unknown) => { viewUrl: string | null; payUrl: string | null };
  isPortalInvitee: (e: string, inv: unknown) => boolean;
  portalUrlForRecipient: (u: string | null, r: { email: string; source: 'bill_to' | 'portal_invite' }, inv: unknown) => string | null;
  invoiceOwnedByProjectOwner: (i: { user_id?: string | null }, p: { user_id?: string | null }) => boolean;
}>('supabase/functions/invoice-dunning/index.ts', 'dunning-recipient', ['resolveDunningRecipient', 'dunningLinks', 'isPortalInvitee', 'portalUrlForRecipient', 'invoiceOwnedByProjectOwner']);
const URL = 'https://mageid.app/portal/p1?t=secret';
const lender = D.resolveDunningRecipient({ bill_to_email: 'draws@lender.com' }, invites)!;
ok('dunning: bill-to lender → portal link withheld', D.portalUrlForRecipient(URL, lender, invites) === null);
const homeAsBill = D.resolveDunningRecipient({ bill_to_email: 'HOME@owner.com' }, invites)!;
ok('dunning: bill-to that IS an invitee → keeps the link', D.portalUrlForRecipient(URL, homeAsBill, invites) === URL);
const fallback = D.resolveDunningRecipient({}, invites)!;
ok('dunning: the portal-invite fallback → keeps the link', fallback.source === 'portal_invite' && D.portalUrlForRecipient(URL, fallback, invites) === URL);
ok('dunning and the app agree on invitee matching', ['home@owner.com', ' HOME@OWNER.COM', 'x@y.z', ''].every(e => D.isPortalInvitee(e, invites) === core.isPortalInvitee(e, invites)));
ok('dunning: showInvoices false → no View invoice', D.dunningLinks({ portal_state: null }, URL, 10, { showInvoices: false }).viewUrl === null);
ok('dunning: showInvoices true / absent → View invoice kept', D.dunningLinks({ portal_state: null }, URL, 10, { showInvoices: true }).viewUrl === URL && D.dunningLinks({ portal_state: null }, URL, 10).viewUrl === URL);
ok('dunning: the Pay button is unaffected by the portal gate', D.dunningLinks({ pay_link_url: 'https://buy.stripe.com/x', pay_link_amount: 10 }, null, 10, { showInvoices: false }).payUrl === 'https://buy.stripe.com/x');
ok('dunning #38: an invoice under a collaborator\'s user_id is not chased', !D.invoiceOwnedByProjectOwner({ user_id: 'b' }, { user_id: 'a' }));
ok('dunning #38: the owner\'s own invoice is', D.invoiceOwnedByProjectOwner({ user_id: 'a' }, { user_id: 'a' }));
ok('dunning #38: missing ids prove nothing (skip)', !D.invoiceOwnedByProjectOwner({ user_id: null }, { user_id: 'a' }));

// ── #38 role gate ──────────────────────────────────────────────────────
console.log('\n#38 only the job owner bills');
const g = (o: Partial<Parameters<typeof core.invoiceRoleGate>[0]>) => core.invoiceRoleGate({ hasProject: true, role: null, isLoading: false, isError: false, ...o });
ok('no job yet → open (the picker asks)', core.invoiceRoleGate({ hasProject: false, role: null, isLoading: true, isError: false }) === 'open');
ok('owner role → open', g({ role: 'owner' }) === 'open');
ok('owned locally → open even offline / loading / errored', g({ ownedLocally: true, isLoading: true }) === 'open' && g({ ownedLocally: true, isError: true }) === 'open');
ok('editor → collaborator', g({ role: 'editor' }) === 'collaborator');
ok('viewer → collaborator (read-only seat)', g({ role: 'viewer' }) === 'collaborator');
ok('field → collaborator', g({ role: 'field' }) === 'collaborator');
ok('a stamped collaborator seat blocks without waiting', g({ stampedRole: 'viewer', isLoading: true }) === 'collaborator');
ok('loading → spinner state', g({ isLoading: true }) === 'loading');
ok('error → retry state', g({ isError: true }) === 'error');
ok('paused → says its reason', g({ isPaused: true }) === 'paused' && core.invoiceRoleBlockedCopy('paused', "You're offline.").body.startsWith("You're offline."));
ok('settled null → no_access, said', g({}) === 'no_access' && /not shared with you/.test(core.invoiceRoleBlockedCopy('no_access').body));
ok('the collaborator copy says why (their bank)', /Only the job's owner bills the client/.test(core.invoiceRoleBlockedCopy('collaborator').body) && /bank/.test(core.INVOICE_OWNER_ONLY_REASON));
ok('never a paywall word in any blocked copy', (['loading', 'error', 'paused', 'collaborator', 'no_access'] as const).every(k => !/upgrade|Pro plan|paywall/i.test(core.invoiceRoleBlockedCopy(k).body)));
ok('the not_project_owner skip reads in words', /job owner/.test(core.reminderBlockMessage('not_project_owner')));

// ── #66 tax seed ───────────────────────────────────────────────────────
console.log('\n#66 the tax on a new invoice');
const S = 7.5;
ok('new milestone invoice → 0%, "per contract"', (() => { const x = core.invoiceTaxSeed({ isNew: true, milestoneId: 'm1', settingsTaxRate: S }); return x.rate === 0 && x.source === 'none'; })());
ok('new milestone invoice with a contract rate → that rate', core.invoiceTaxSeed({ isNew: true, milestoneId: 'm1', contractTaxRate: 6, settingsTaxRate: S }).rate === 6);
ok('new plain invoice → Settings rate', (() => { const x = core.invoiceTaxSeed({ isNew: true, settingsTaxRate: S }); return x.rate === S && x.source === 'settings'; })());
ok('existing invoice keeps ITS rate, never Settings', core.invoiceTaxSeed({ isNew: false, existingTaxRate: 0, milestoneId: null, settingsTaxRate: S }).rate === 0);
ok('source labels say where it came from', /per contract/.test(core.invoiceTaxSourceLabel({ rate: 0, source: 'none' }, false)) && /from Settings \(7\.5%\)/.test(core.invoiceTaxSourceLabel({ rate: S, source: 'settings' }, false)) && core.invoiceTaxSourceLabel({ rate: 3, source: 'settings' }, true) === 'set on this invoice');

// ── #83 carry: the three pending holds agree ───────────────────────────
console.log('\n#83 create-payment-link holds exactly as dunning and the app do');
const CPL = block<{ paymentPendingHolds: (a: string | null, n: number) => boolean }>('supabase/functions/create-payment-link/index.ts', 'payment-pending-hold', ['paymentPendingHolds']);
const DUN = block<{ paymentPendingHolds: (a: string | null, n: number) => boolean }>('supabase/functions/invoice-dunning/index.ts', 'payment-pending-hold', ['paymentPendingHolds']);
const now = Date.parse('2026-09-19T12:00:00Z');
const cases: (string | null)[] = [null, '', 'garbage', '2026-09-19T11:00:00Z', '2026-09-09T12:00:00.001Z', '2026-09-09T12:00:00Z', '2026-09-01T00:00:00Z'];
ok('all three agree on every case', cases.every(c => CPL.paymentPendingHolds(c, now) === core.paymentPendingHolds(c, now) && DUN.paymentPendingHolds(c, now) === core.paymentPendingHolds(c, now)), cases.map(c => [c, CPL.paymentPendingHolds(c, now)]));
ok('an hour-old marker holds; an 18-day-old one does not', CPL.paymentPendingHolds('2026-09-19T11:00:00Z', now) && !CPL.paymentPendingHolds('2026-09-01T00:00:00Z', now));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
