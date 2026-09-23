// validate-invoice-send-pay-dunning.ts — payment reminders go to the right
// person, with buttons that work (wave 3, lane invoice-send-pay: #45, #47).
//
//   #47 The reminder used to go to project.client_portal.invites[0] — never to
//       the address the GC emailed the invoice to, and to nobody when the
//       project had no portal. invoice-dunning now prefers invoices.bill_to_email
//       (migration 20260919010000) and checks unsubscribe on whichever address
//       it uses.
//   #45 'View invoice' opened a portal that did not list the invoice. It is now
//       offered only when the portal shows it, and the reminder carries the
//       invoice's OWN pay link while that link charges exactly what is owed.
//   Deploy safety: if the function ships before the migration, the select must
//       not take every reminder down — it retries without the new columns.
//
// The pure blocks of the Deno function are EXECUTED (marker blocks), not
// regex-matched; the call sites are pinned.
//
// Run: bun run scripts/validate-invoice-send-pay-dunning.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const FILE = process.env.DUNNING_PATH ?? join(ROOT, 'supabase/functions/invoice-dunning/index.ts');
const SRC = readFileSync(FILE, 'utf8');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;
function evalBlock<T>(marker: string, names: string[]): T | null {
  const start = SRC.indexOf(`// >>> ${marker}`);
  const end = SRC.indexOf(`// <<< ${marker}`);
  ok(`invoice-dunning carries the ${marker} marker block`, start > -1 && end > start);
  if (!(start > -1 && end > start)) return null;
  const js = new Transpiler({ loader: 'ts' }).transformSync(SRC.slice(start, end).replace(/^export /gm, ''));
  return new Function(`${js}\nreturn { ${names.join(', ')} };`)() as T;
}

type Recipient = { email: string; name: string | null; source: string } | null;
const R = evalBlock<{
  resolveDunningRecipient: (inv: Record<string, unknown>, invites: unknown) => Recipient;
  dunningLinks: (inv: Record<string, unknown>, portalUrl: string | null, outstanding: number) => { viewUrl: string | null; payUrl: string | null };
}>('dunning-recipient', ['resolveDunningRecipient', 'dunningLinks']);

async function main() {
  console.log('\n#47 who the reminder goes to');
  if (R) {
    const invites = [{ email: 'spouse@home.com', name: 'Spouse' }];
    const a = R.resolveDunningRecipient({ bill_to_email: 'ap@owner.com', bill_to_name: 'Owner AP' }, invites);
    ok('the address the invoice was emailed to wins', a?.email === 'ap@owner.com' && a?.source === 'bill_to' && a?.name === 'Owner AP', JSON.stringify(a));
    const b = R.resolveDunningRecipient({ bill_to_email: null }, [{ email: 'bad' }, ...invites]);
    ok('no stored address → the first portal invitee with an @', b?.email === 'spouse@home.com' && b?.source === 'portal_invite', JSON.stringify(b));
    ok('a stored address without @ is ignored', R.resolveDunningRecipient({ bill_to_email: 'n/a' }, invites)?.email === 'spouse@home.com');
    ok('a pre-migration row (column absent) falls back to the invitee', R.resolveDunningRecipient({}, invites)?.email === 'spouse@home.com');
    ok('nobody → null (skip no_recipient)', R.resolveDunningRecipient({}, []) === null && R.resolveDunningRecipient({}, undefined) === null);
  }

  console.log('\n#45 the buttons on a reminder');
  if (R) {
    const portal = 'https://mageid.app/portal/p?t=x';
    ok('a portal that shows the invoice (sent) keeps View invoice', R.dunningLinks({ portal_state: { status: 'sent' } }, portal, 100).viewUrl === portal);
    ok('a legacy row (no portal_state) keeps View invoice', R.dunningLinks({ portal_state: null }, portal, 100).viewUrl === portal);
    ok('a draft portal state drops View invoice', R.dunningLinks({ portal_state: { status: 'draft' } }, portal, 100).viewUrl === null);
    ok('a recalled invoice drops View invoice', R.dunningLinks({ portal_state: { status: 'recalled' } }, portal, 100).viewUrl === null);
    ok('no portal → no View invoice', R.dunningLinks({ portal_state: { status: 'sent' } }, null, 100).viewUrl === null);
    const link = 'https://buy.stripe.com/x';
    ok('the pay link rides along when it charges the outstanding amount', R.dunningLinks({ pay_link_url: link, pay_link_amount: '77484.88' }, null, 77484.88).payUrl === link);
    ok('…within a cent', R.dunningLinks({ pay_link_url: link, pay_link_amount: 77484.87 }, null, 77484.88).payUrl === link);
    ok('a link for an older balance is never sent', R.dunningLinks({ pay_link_url: link, pay_link_amount: 90000 }, null, 77484.88).payUrl === null);
    ok('a link with no recorded amount is never sent', R.dunningLinks({ pay_link_url: link, pay_link_amount: null }, null, 77484.88).payUrl === null);
    ok('no link → no Pay button', R.dunningLinks({ pay_link_url: null, pay_link_amount: 5 }, null, 5).payUrl === null);
  }

  console.log('\ndeploy safety: the select survives a missing migration');
  const S = evalBlock<{
    isMissingColumn: (e: { code?: string; message?: string } | null | undefined) => boolean;
    withoutBillTo: (cols: string) => string;
  }>('dunning-select', ['isMissingColumn', 'withoutBillTo']);
  const literals = SRC.match(/\.select\('([^']*total_due[^']*)'\)/g)?.map((x) => x.slice(9, -2)) ?? [];
  const constCols = /const INVOICE_SELECT_COLS = '([^']*)';/.exec(SRC)?.[1] ?? '';
  ok('both invoice selects are one literal list with bill_to + portal_state + the pay link',
    literals.length === 2 && literals.every((l) => l === literals[0]) && ['bill_to_email', 'bill_to_name', 'portal_state', 'pay_link_url', 'pay_link_amount', 'retention_percent', 'qbo_error'].every((c) => literals[0].split(',').includes(c)),
    JSON.stringify(literals));
  ok('the fallback list is built from the same columns', constCols === literals[0]);
  if (S) {
    ok('PostgREST\'s missing-column error (42703) triggers the fallback', S.isMissingColumn({ code: '42703', message: 'column invoices.bill_to_email does not exist' }));
    ok('…and the schema-cache variant (PGRST204)', S.isMissingColumn({ code: 'PGRST204' }));
    ok('a timeout or RLS error does NOT (no silent retry hiding a real failure)', !S.isMissingColumn({ code: '57014', message: 'canceling statement due to statement timeout' }) && !S.isMissingColumn(null));
    const pre = S.withoutBillTo(constCols);
    ok('the fallback drops exactly the two bill_to columns', !/bill_to/.test(pre) && pre.split(',').length === constCols.split(',').length - 2 && /retention_released/.test(pre) && /qbo_error/.test(pre));
  }
  ok('both call sites retry through withoutBillTo on a missing column',
    (SRC.match(/if \(isMissingColumn\(invRes\.error\)\) \{[\s\S]{0,260}withoutBillTo\(INVOICE_SELECT_COLS\)/g) ?? []).length === 2);

  console.log('\ncall sites');
  ok('processInvoice resolves the recipient through resolveDunningRecipient', /const recipient = resolveDunningRecipient\(invoice, project\.client_portal\?\.invites\)/.test(SRC));
  ok('invites[0] is no longer taken blindly', !/invites\[0\]/.test(SRC));
  ok('unsubscribe is checked on the address actually used', /const recipientEmail = recipient\.email;/.test(SRC) && /isEmailUnsubscribed\(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, recipientEmail, 'payment_reminders'\)/.test(SRC));
  ok('the email gets View invoice / Pay from dunningLinks', /const links = dunningLinks\(invoice, portalUrl, outstanding(, project\.client_portal)?\)/.test(SRC) && /portalUrl: links\.viewUrl/.test(SRC) && /payUrl: links\.payUrl/.test(SRC));
  ok('the notice\'s amount is exact to the cent (not the shared whole-dollar fmtMoney)', /const amountFormatted = fmtMoneyCents\(opts\.outstanding\)/.test(SRC) && !/\bfmtMoney\(/.test(SRC));
  ok('the Pay button prints the exact amount it charges', /emailButton\(`Pay \$\{amountFormatted\} now`, opts\.payUrl\)/.test(SRC));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
void main();
