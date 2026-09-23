// scripts/validate-w5-desktop-web-screens.ts — two screens that stranded or
// misinformed him (audit 2026-09-23 #149 and #161).
//
//   #149 'Reply in MAGE ID' in a homeowner-message email opens Safari at
//        app.mageid.app/client-messages?id=… as the FIRST route, at phone
//        width: no sidebar, no tab bar, no header back, and two buttons that
//        called router.back() with nothing to pop. /sub-portals (the
//        sub-invoice email's fallback) declared a headerLeft that never
//        rendered, because the root stack hides that screen's header. Both now
//        exit through hooks/useSafeBack, which falls through to Home.
//   #161 Documents labelled a COI that FAILED its insurance check a harmless
//        'Draft' and counted it nowhere, called every saved AIA pay app
//        'Signed', and promised 'every contract' while holding none. The status
//        rules are extracted from app/documents.tsx and RUN here (they are
//        plain functions with no imports, so they are transpiled and evaluated
//        without loading react-native).
//
// Run via: bun run scripts/validate-w5-desktop-web-screens.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEffectiveInvoiceStatus } from '../utils/projectFinancials';
import type { Invoice } from '../types';

// tsc checks scripts/ against the app's react-native lib set, which has no Bun
// global; bun provides it at runtime.
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => read(p).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ═════ #149 ══════════════════════════════════════════════════════════════════
console.log('\n#149 /client-messages always has a way out:');
{
  const src = code('app/client-messages.tsx');
  ok('it takes a safe back', /import \{ useSafeBack \} from '@\/hooks\/useSafeBack';/.test(src) && /const goBack = useSafeBack\(\);/.test(src));
  ok('no bare router.back() is left on the screen', !/router\.back\(\)/.test(src),
    'router.back() with nothing to pop does nothing — the email-link dead end');
  ok("'Go back' uses the safe back", /onPress=\{goBack\}>\s*<Text style=\{styles\.backBtnTxt\}>Go back<\/Text>/.test(src));
  ok("'Back to portal setup' goes to portal setup for THIS project",
    /router\.replace\(\{ pathname: '\/client-portal-setup', params: \{ id: project\.id \} \}\)[\s\S]{0,40}>\s*<Text style=\{styles\.backBtnTxt\}>Back to portal setup<\/Text>/.test(src));
  const screens = src.match(/<Stack\.Screen options=\{\{[^}]*\}\} \/>/g) ?? [];
  ok(`every one of its Stack.Screen states carries the header back (${screens.length} found)`,
    screens.length === 3 && screens.every(s => /\.\.\.headerBack/.test(s)), screens.join('\n   '));
  ok('the header back is drawn when there is no history, wired to the safe back',
    /const headerBack = router\.canGoBack\(\)\s*\?\s*\{\}\s*:\s*\{\s*headerLeft: \(\) => \(\s*<TouchableOpacity\s+onPress=\{goBack\}/.test(src)
    && /<ChevronLeft /.test(src));
  ok('useSafeBack is called before the early returns (hook order)',
    src.indexOf('useSafeBack()') < src.indexOf('if (!project) {'));
}
console.log('\n#149 /sub-portals draws its back where it can be seen:');
{
  const src = code('app/sub-portals.tsx');
  const layout = read('app/_layout.tsx');
  ok('the root stack still hides this screen\'s header (why the back is in the body)',
    /name="sub-portals"\s*options=\{\{ headerShown: false \}\}/.test(layout));
  ok('no dead headerLeft is declared on a hidden header', !/headerLeft/.test(src));
  ok('no bare router.back() is left', !/router\.back\(\)/.test(src));
  ok('the in-body chevron sits in headerWrap and uses the safe back',
    /const goBack = useSafeBack\(\);/.test(src)
    && /<View style=\{styles\.headerWrap\}>\s*<TouchableOpacity\s+onPress=\{goBack\}[\s\S]{0,300}<ChevronLeft /.test(src));
}
{
  const hook = read('hooks/useSafeBack.ts');
  ok('useSafeBack still falls through to Home when nothing can be popped',
    /if \(router\.canGoBack\(\)\) router\.back\(\);\s*else router\.replace\('\/\(tabs\)\/\(home\)'\);/.test(hook));
}

// ═════ #161 ══════════════════════════════════════════════════════════════════
console.log('\n#161 Documents: the status rules, run:');
const docsRaw = read('app/documents.tsx');
const startAt = docsRaw.indexOf('type DocBucket =');
const endAt = docsRaw.indexOf('// Themed per-tone chip styling');
const expStart = docsRaw.indexOf('function isExpiringSoon(');
const expEnd = docsRaw.indexOf('\n}\n', expStart) + 3;
ok('the rule block is where the guard expects it', startAt > 0 && endAt > startAt && expStart > endAt && expEnd > expStart);
type S = { bucket: string; label: string; tone: string };
let coiDocStatus: (v: { overallStatus?: string } | null | undefined, expiryDay: string | null, today: string) => S = () => ({ bucket: '', label: '', tone: '' });
let payAppDocStatus: (paidAt: string | undefined, inv: string | undefined, portal: { status?: string; viewedAt?: string } | undefined) => S = coiDocStatus as never;
let isExpiringSoon: (d: { expiresAt?: string; status: S }, nowMs: number) => boolean = () => false;
try {
  const ts = docsRaw.slice(startAt, endAt) + '\n' + docsRaw.slice(expStart, expEnd);
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(ts);
  const mod = new Function(`${js}\nreturn { coiDocStatus, payAppDocStatus, isExpiringSoon };`)() as {
    coiDocStatus: typeof coiDocStatus; payAppDocStatus: typeof payAppDocStatus; isExpiringSoon: typeof isExpiringSoon;
  };
  ({ coiDocStatus, payAppDocStatus, isExpiringSoon } = mod);
  ok('the rules transpile and load without react-native', true);
} catch (e) {
  ok('the rules transpile and load without react-native', false, String(e));
}
const T = '2026-09-23';
{
  const f = coiDocStatus({ overallStatus: 'fail' }, '2027-01-01', T);
  ok("a COI that FAILED its check → 'Failed check', at risk, danger (was a grey 'Draft')",
    f.bucket === 'at_risk' && f.label === 'Failed check' && f.tone === 'danger', JSON.stringify(f));
  const w = coiDocStatus({ overallStatus: 'warn' }, '2027-01-01', T);
  ok("a flagged COI → 'Needs review', at risk", w.bucket === 'at_risk' && w.label === 'Needs review' && w.tone === 'warning', JSON.stringify(w));
  const n = coiDocStatus(undefined, '2027-01-01', T);
  ok("only a COI nobody has checked reads 'Awaiting review'", n.label === 'Awaiting review' && n.bucket === 'awaiting', JSON.stringify(n));
  const p = coiDocStatus({ overallStatus: 'pass' }, '2027-01-01', T);
  ok("a passed COI reads 'Passed check', never 'Signed'", p.label === 'Passed check' && p.bucket === 'done', JSON.stringify(p));
  const e = coiDocStatus({ overallStatus: 'pass' }, '2026-09-22', T);
  ok('a COI past its last covered day is expired whatever its check said', e.bucket === 'expired', JSON.stringify(e));
  const d = coiDocStatus({ overallStatus: 'fail' }, T, T);
  ok('a policy is good THROUGH its expiry day (calendar-day compare, no UTC flip)', d.bucket === 'at_risk', JSON.stringify(d));
}
{
  const saved = payAppDocStatus(undefined, 'draft', undefined);
  ok("a pay app saved and never sent reads 'Saved', not 'Signed'", saved.label === 'Saved' && saved.bucket === 'draft', JSON.stringify(saved));
  const none = payAppDocStatus(undefined, undefined, undefined);
  ok('…and so does one with no linked invoice', none.label === 'Saved', JSON.stringify(none));
  const sent = payAppDocStatus(undefined, 'draft', { status: 'sent' });
  ok("sent through the portal → 'Sent to client', waiting", sent.label === 'Sent to client' && sent.bucket === 'awaiting', JSON.stringify(sent));
  const viewed = payAppDocStatus(undefined, 'sent', { status: 'sent', viewedAt: '2026-09-20T10:00:00Z' });
  ok("viewed → 'Viewed by client'", viewed.label === 'Viewed by client', JSON.stringify(viewed));
  const invSent = payAppDocStatus(undefined, 'sent', undefined);
  ok("invoice sent → 'Awaiting payment'", invSent.label === 'Awaiting payment' && invSent.bucket === 'awaiting', JSON.stringify(invSent));
  const partly = payAppDocStatus(undefined, 'partially_paid', { status: 'sent' });
  ok("partly paid → 'Partly paid'", partly.label === 'Partly paid', JSON.stringify(partly));
  const overdue = payAppDocStatus(undefined, 'overdue', { status: 'sent' });
  ok("overdue → 'Overdue' in danger", overdue.label === 'Overdue' && overdue.tone === 'danger', JSON.stringify(overdue));
  const paid = payAppDocStatus(undefined, 'paid', { status: 'sent' });
  const stamped = payAppDocStatus('2026-09-21T00:00:00Z', 'sent', undefined);
  ok("paid (invoice or Stripe stamp) → 'Paid', done", paid.label === 'Paid' && stamped.label === 'Paid' && paid.bucket === 'done');
  const recalled = payAppDocStatus(undefined, 'draft', { status: 'recalled' });
  ok('recalled from the portal is not waiting on anyone', recalled.bucket === 'draft', JSON.stringify(recalled));
  const all = [saved, none, sent, viewed, invSent, partly, overdue, paid, stamped, recalled];
  ok('no pay-app status ever says Signed', all.every(s => !/sign/i.test(s.label)));
}
{
  const now = Date.parse('2026-09-23T12:00:00Z');
  const in10 = new Date(now + 10 * 86400000).toISOString();
  ok('a failed-check COI keeps its expiry warning (was judged only for "signed" rows)',
    isExpiringSoon({ expiresAt: in10, status: { bucket: 'at_risk', label: 'Failed check', tone: 'danger' } }, now));
  ok('an awaiting permit expiring in 10 days is flagged too',
    isExpiringSoon({ expiresAt: in10, status: { bucket: 'awaiting', label: 'Pending', tone: 'warning' } }, now));
  ok('an already-expired row is not "expiring soon"',
    !isExpiringSoon({ expiresAt: in10, status: { bucket: 'expired', label: 'Expired', tone: 'danger' } }, now));
  ok('41 days out is not soon',
    !isExpiringSoon({ expiresAt: new Date(now + 41 * 86400000).toISOString(), status: { bucket: 'done', label: 'Passed check', tone: 'success' } }, now));
}

console.log('\n#161 Documents: pay-app status reads the DERIVED invoice status, run:');
{
  // Extract the exact per-invoice expression the screen feeds payAppDocStatus
  // and evaluate it with the real getEffectiveInvoiceStatus in scope. Nothing
  // writes 'overdue' to an invoice (it is derived from dueDate), so a map built
  // from the stored i.status can never produce 'Overdue'.
  const m = /const invoiceStatusById = new Map\(invoices\.map\(i => \[i\.id, ([^\]]+)\]\)\);/.exec(docsRaw);
  ok('the invoice-status map is where the guard expects it', !!m);
  let statusOf: (i: Invoice) => string | undefined = () => undefined;
  try {
    statusOf = new Function('getEffectiveInvoiceStatus', `return (i) => ${m ? m[1] : 'undefined'};`)(getEffectiveInvoiceStatus) as typeof statusOf;
  } catch (e) {
    ok('the invoice-status expression evaluates', false, String(e));
  }
  const inv = (over: Partial<Invoice>): Invoice => ({
    id: 'inv-1', projectId: 'p1', number: 1, type: 'progress', issueDate: '2026-08-01',
    dueDate: '2026-08-31', paymentTerms: 'net_30', notes: '', lineItems: [],
    subtotal: 1000, taxRate: 0, taxAmount: 0, totalDue: 1000, amountPaid: 0,
    status: 'sent', payments: [], createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  } as unknown as Invoice);
  const pastDue = payAppDocStatus(undefined, statusOf(inv({ status: 'sent', dueDate: '2026-01-15' })), { status: 'sent' });
  ok("a SENT invoice past its due date → the pay app reads 'Overdue' (the derived status)",
    pastDue.label === 'Overdue' && pastDue.tone === 'danger', JSON.stringify(pastDue));
  const notDue = payAppDocStatus(undefined, statusOf(inv({ status: 'sent', dueDate: '2099-01-15' })), undefined);
  ok("a sent invoice not yet due → 'Awaiting payment'", notDue.label === 'Awaiting payment', JSON.stringify(notDue));
  const reopened = payAppDocStatus(undefined, statusOf(inv({ status: 'paid', dueDate: '2099-01-15', amountPaid: 0 })), undefined);
  ok("a stored-'paid' invoice with the balance still open is NOT 'Paid' (matches the Invoice screen)",
    reopened.label !== 'Paid' && reopened.bucket !== 'done', JSON.stringify(reopened));
  const settled = payAppDocStatus(undefined, statusOf(inv({ status: 'paid', amountPaid: 1000 })), undefined);
  ok("a paid-in-full invoice → 'Paid'", settled.label === 'Paid', JSON.stringify(settled));
}

console.log('\n#161 Documents: wiring and copy:');
{
  const src = code('app/documents.tsx');
  ok("no row is hard-coded 'signed' any more", !/status:\s*'signed'/.test(src) && !/DocumentStatus\b/.test(src));
  ok('COIs are mapped through coiDocStatus', /const status = coiDocStatus\(c\.validation, expiryDay, today\);/.test(src));
  ok('pay apps are mapped through payAppDocStatus with the linked invoice and portal state',
    /status: payAppDocStatus\(a\.paidAt, a\.invoiceId \? invoiceStatusById\.get\(a\.invoiceId\) : undefined, a\.portalState\)/.test(src) &&
    /const invoiceStatusById = new Map\(invoices\.map\(i => \[i\.id, getEffectiveInvoiceStatus\(i\)\]\)\);/.test(src) &&
    /import \{ getEffectiveInvoiceStatus \} from '@\/utils\/projectFinancials';/.test(src));
  ok('the card and the count share one expiring-soon rule',
    /const expiringSoon = isExpiringSoon\(doc, Date\.now\(\)\);/.test(src) && /expiringSoon: documents\.filter\(d => isExpiringSoon\(d, nowMs\)\)\.length/.test(src));
  ok('failed / flagged COIs are counted in an alert card that opens the COI Vault',
    /stats\.coiFailed \+ stats\.coiReview > 0 && \(\s*<TouchableOpacity[\s\S]{0,300}router\.push\('\/coi-vault' as never\)/.test(src)
    && /failed the insurance check/.test(src));
  const hero = /<Text style=\{styles\.docsHeroSub\}>([\s\S]*?)<\/Text>/.exec(src)?.[1] ?? '';
  ok("the hero no longer promises contracts it does not hold", hero.length > 20 && !/contract/i.test(hero), hero.trim());
  ok("each project's Files is one tap away",
    /router\.push\(\{ pathname: '\/project-files', params: \{ projectId \} \} as never\)/.test(src) && /onPress=\{\(\) => openProjectFiles\(p\.id\)\}/.test(src));
  ok("no filter chip says 'Signed'", !/label: 'Signed'/.test(src));
  ok('the empty state still tells an empty filter from an empty account',
    /documents\.length === 0 \? 'Nothing filed yet' : 'Nothing under this filter'/.test(src));
}

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-w5-desktop-web-screens: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
