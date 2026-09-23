// scripts/validate-invoice-terms.ts — new invoices default to the GC's OWN
// payment terms, not a hard-coded Net 30.
//
// The bug (screen audit 2026-09-15, profile-identity "never asks how he gets
// paid"): cash-flow setup asks the GC for his payment terms and the forecast
// times every receivable by them (utils/cashFlowEngine.ts), but app/invoice.tsx
// opened every new invoice on `useState(... ?? 'net_30')` and
// app/bill-from-estimate.tsx stamped `paymentTerms: 'net_30'` on every draft.
// A GC on Net 15 issued Net 30 paper while his forecast expected the money two
// weeks sooner.
//
// The mapping lives as a byte-identical block in BOTH screens (route files the
// validator cannot import without React Native). This script:
//   1. extracts each copy, requires them identical, and EXECUTES both against
//      the mapping cases (his setting honoured; a real record with no usable
//      terms is `fallback`; the loader placeholder / a failed read is
//      `unconfirmed`), the cache+server settle rules (an empty cache never
//      settles while the server read is pending — review 2026-09-16), and the
//      bounded server read (rejection and hang both count as failed);
//   2. pins the wiring: the editor loads the setting only for a NEW invoice,
//      a GC pick outranks a late load, the picker names the source; the
//      bill-from-estimate draft stamps the resolved terms and a matching due
//      date instead of the literal.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bun global (same declaration as scripts/validate-invoice-billing.ts) — the
// repo tsconfig includes scripts/, and `npx tsc --noEmit` has no Bun types.
declare const Bun: { Transpiler: new (o: { loader: 'ts' }) => { transformSync(s: string): string } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let failures = 0;
let passes = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passes++; return; }
  failures++;
  console.error(`FAIL: ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
}

const OPEN = '// <invoice-terms-default>';
const CLOSE = '// </invoice-terms-default>';

type Resolved = { terms: string; origin: string };
type Fn = (s: unknown) => Resolved;
type ReadServer = (load: () => Promise<unknown>, waitMs?: number) => Promise<Resolved | 'failed'>;
type Settle = (cache: Resolved | null, server: unknown) => Resolved | null;
type Block = { fn: Fn; readServer: ReadServer; settle: Settle };

function extract(rel: string): { block: string; api: Block | null } {
  const src = read(rel);
  const start = src.indexOf(OPEN);
  const end = src.indexOf(CLOSE);
  if (start < 0 || end <= start) return { block: '', api: null };
  const block = src.slice(start, end + CLOSE.length);
  const key = `__invoiceTerms_${rel.replace(/\W/g, '_')}`;
  const ts = `${block}\n(globalThis as any).${key} = { fn: invoiceTermsDefaultFromCashFlow, readServer: readServerInvoiceTerms, settle: settleInvoiceTermsDefault };`;
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(ts);
  new Function(js)();
  return { block, api: (globalThis as unknown as Record<string, Block>)[key] };
}

const SCREENS = ['app/invoice.tsx', 'app/bill-from-estimate.tsx'] as const;
const copies = SCREENS.map((rel) => ({ rel, ...extract(rel) }));

for (const c of copies) ok(`${c.rel} carries the invoice-terms-default block`, !!c.api);
ok('the two invoice-terms-default blocks are byte-identical',
  copies[0].block.length > 0 && copies[0].block === copies[1].block);

const set = (terms: unknown, extra: Record<string, unknown> = {}) =>
  ({ data: { defaultPaymentTerms: terms }, setupComplete: true, source: 'server', ...extra });

const CASES: { name: string; input: unknown; want: Resolved }[] = [
  // His setting, every term the setup wizard offers (components/CashFlowSetup.tsx).
  { name: 'net_15 from setup', input: set('net_15'), want: { terms: 'net_15', origin: 'cash_flow_setup' } },
  { name: 'net_45 from setup', input: set('net_45'), want: { terms: 'net_45', origin: 'cash_flow_setup' } },
  { name: 'due_on_receipt from setup', input: set('due_on_receipt'), want: { terms: 'due_on_receipt', origin: 'cash_flow_setup' } },
  // net_30 he actually chose is HIS, not the fallback — the hint must say so.
  { name: 'net_30 he chose is his setting', input: set('net_30'), want: { terms: 'net_30', origin: 'cash_flow_setup' } },
  { name: 'device cache counts as his setting', input: set('net_15', { source: 'device' }), want: { terms: 'net_15', origin: 'cash_flow_setup' } },
  // Free-text drift on the column normalises.
  { name: '"Net 15" normalises', input: set('Net 15'), want: { terms: 'net_15', origin: 'cash_flow_setup' } },
  { name: '"net-45" normalises', input: set(' net-45 '), want: { terms: 'net_45', origin: 'cash_flow_setup' } },
  { name: '"NET15" normalises', input: set('NET15'), want: { terms: 'net_15', origin: 'cash_flow_setup' } },
  { name: '"Due upon receipt" normalises', input: set('Due upon receipt'), want: { terms: 'due_on_receipt', origin: 'cash_flow_setup' } },
  // Nothing answered → Net 30, captioned as UNCONFIRMED (the loader's
  // placeholder is returned for "no row" and "server read failed" alike).
  { name: 'loader placeholder (source default) is unconfirmed, not "no setting"', input: set('net_15', { source: 'default' }), want: { terms: 'net_30', origin: 'unconfirmed' } },
  { name: 'placeholder with setup flag still unconfirmed', input: set('net_30', { source: 'default', setupComplete: false }), want: { terms: 'net_30', origin: 'unconfirmed' } },
  { name: 'null settings (load failed) is unconfirmed', input: null, want: { terms: 'net_30', origin: 'unconfirmed' } },
  // A real record with no usable terms → Net 30, labelled as the fallback.
  { name: 'setup never finished is not his setting', input: set('net_15', { setupComplete: false }), want: { terms: 'net_30', origin: 'fallback' } },
  { name: 'unmappable net_60 falls back (never forced to nearest)', input: set('net_60'), want: { terms: 'net_30', origin: 'fallback' } },
  { name: 'unmappable "2/10 net 30" falls back', input: set('2/10 net 30'), want: { terms: 'net_30', origin: 'fallback' } },
  { name: 'empty string falls back', input: set(''), want: { terms: 'net_30', origin: 'fallback' } },
  { name: 'non-string falls back', input: set(15), want: { terms: 'net_30', origin: 'fallback' } },
  { name: 'missing data falls back', input: { setupComplete: true, source: 'server' }, want: { terms: 'net_30', origin: 'fallback' } },
];

for (const c of copies) {
  if (!c.api) continue;
  for (const tc of CASES) {
    let got: Resolved | string;
    try { got = c.api.fn(tc.input); } catch (e) { got = `threw ${String(e)}`; }
    ok(`${c.rel}: ${tc.name}`,
      typeof got === 'object' && got.terms === tc.want.terms && got.origin === tc.want.origin,
      { got, want: tc.want });
  }
}

// ── Settling the two reads ─────────────────────────────────────────────────
// The reviewer's failure: an EMPTY device cache (fresh sign-in, tenant switch,
// new browser) settled to "Net 30 — not your setting" before the server read
// came back, so the picker jumped and, offline, lied. A signed-in GC's empty
// cache must keep waiting (null); a failed read must say unconfirmed.
const MINE: Resolved = { terms: 'net_15', origin: 'cash_flow_setup' };
const SERVER45: Resolved = { terms: 'net_45', origin: 'cash_flow_setup' };
const NONE_FALLBACK: Resolved = { terms: 'net_30', origin: 'fallback' };
const NONE_UNCONF: Resolved = { terms: 'net_30', origin: 'unconfirmed' };
const SETTLE: { name: string; cache: Resolved | null; server: unknown; want: Resolved | null }[] = [
  { name: 'empty cache + server pending keeps loading (no Net 30 flash)', cache: NONE_UNCONF, server: 'pending', want: null },
  { name: 'unreadable cache + server pending keeps loading', cache: null, server: 'pending', want: null },
  { name: 'cache record without terms + server pending keeps loading', cache: NONE_FALLBACK, server: 'pending', want: null },
  { name: 'cache with his terms shows at once while server pending', cache: MINE, server: 'pending', want: MINE },
  { name: 'server answer wins over cache', cache: MINE, server: SERVER45, want: SERVER45 },
  { name: 'server answer settles an empty cache', cache: NONE_UNCONF, server: SERVER45, want: SERVER45 },
  { name: 'server failed + empty cache is unconfirmed (never "not your setting")', cache: NONE_UNCONF, server: 'failed', want: NONE_UNCONF },
  { name: 'server failed + stale no-terms cache record is unconfirmed', cache: NONE_FALLBACK, server: 'failed', want: NONE_UNCONF },
  { name: 'server failed keeps his cached terms', cache: MINE, server: 'failed', want: MINE },
  { name: 'not signed in uses the cache answer', cache: NONE_FALLBACK, server: 'not_signed_in', want: NONE_FALLBACK },
  { name: 'not signed in + unreadable cache is unconfirmed', cache: null, server: 'not_signed_in', want: NONE_UNCONF },
];
const same = (a: Resolved | null, b: Resolved | null) =>
  a === b || (!!a && !!b && a.terms === b.terms && a.origin === b.origin);
for (const c of copies) {
  if (!c.api) continue;
  for (const tc of SETTLE) {
    let got: Resolved | null | string;
    try { got = c.api.settle(tc.cache, tc.server); } catch (e) { got = `threw ${String(e)}`; }
    ok(`${c.rel}: settle — ${tc.name}`, typeof got !== 'string' && same(got, tc.want), { got, want: tc.want });
  }
}

// The bounded server read: an answer maps, a rejection and a hang both count
// as failed (a hang offline must not leave the picker on "Checking…").
async function checkReadServer() {
  for (const c of copies) {
    if (!c.api) continue;
    const answered = await c.api.readServer(async () => ({ data: { defaultPaymentTerms: 'net_15' }, setupComplete: true, source: 'server' }), 200);
    ok(`${c.rel}: server read maps an answer`, typeof answered === 'object' && same(answered, MINE), answered);
    const rejected = await c.api.readServer(() => Promise.reject(new Error('offline')), 200);
    ok(`${c.rel}: server read rejection is failed`, rejected === 'failed', rejected);
    // Raced against a watchdog: if the budget is not enforced the read never
    // settles, and an un-raced await would end the process with exit 0 and no
    // tally at all (mutation-testing found exactly that silent pass).
    const hung = await Promise.race([
      c.api.readServer(() => new Promise(() => {}), 30),
      new Promise<'watchdog'>(resolve => setTimeout(() => resolve('watchdog'), 1000)),
    ]);
    ok(`${c.rel}: server read that hangs past the budget is failed`, hung === 'failed', hung);
  }
}

// ── Wiring pins: app/invoice.tsx ────────────────────────────────────────────
{
  const src = read('app/invoice.tsx');
  ok('invoice editor reads the cash-flow setup through the existing loader',
    /import \{ loadCashFlowSettings \} from '@\/utils\/cashFlowStorage'/.test(src));
  ok('invoice editor never re-defaults an EXISTING invoice (effect returns on invoiceId)',
    /useEffect\(\(\) => \{[\s\S]{0,300}?if \(invoiceId\) return;[\s\S]{0,1600}?settleInvoiceTermsDefault\(cache, server\)/.test(src));
  ok('a late load never overwrites a GC pick (touched guard inside settle)',
    /const settle = \(\) => \{\s*if \(cancelled \|\| termsTouchedRef\.current\) return;/.test(src));
  ok('the cache pass cannot settle on its own while the server read is pending (every apply goes through settle, which may return null)',
    /const resolved = settleInvoiceTermsDefault\(cache, server\);\s*if \(!resolved\) return;/.test(src)
    && /let server: ServerInvoiceTerms = user\?\.id \? 'pending' : 'not_signed_in';/.test(src)
    && !/invoiceTermsDefaultFromCashFlow\(await loadCashFlowSettings\(\)\);\s*set(PaymentTerms|TermsOrigin)/.test(src)
    && (src.match(/setTermsOrigin\(resolved\.origin\)/g) ?? []).length === 1);
  ok('the server read is the bounded one',
    /server = await readServerInvoiceTerms\(\(\) => loadCashFlowSettings\(uid\)\);/.test(src));
  ok('the selector names no term while loading (no Net 30 flash)',
    /termsOrigin === 'loading'\s*\?\s*'Checking…'/.test(src));
  ok('the picker marks the choice as his (pickPaymentTerms sets touched)',
    /const pickPaymentTerms = useCallback\(\(terms: PaymentTerms\) => \{\s*termsTouchedRef\.current = true;/.test(src)
    && /onPress=\{\(\) => \{ pickPaymentTerms\(opt\.value\);/.test(src)
    && !/onPress=\{\(\) => \{ setPaymentTerms\(opt\.value\);/.test(src));
  ok('the fallback is named as the app default, not his setting',
    /termsOrigin === 'fallback'[\s\S]{0,200}?app default, not your setting/.test(src));
  const unconf = /termsOrigin === 'unconfirmed' && \(\s*<Text[^>]*>([^<]*)<\/Text>/.exec(src);
  ok('an unconfirmed read has its own caption that never claims he has no setting',
    !!unconf && /could not be reached/.test(unconf[1]) && !/not your setting/.test(unconf[1]), unconf?.[1]);
  ok('his setting is named as coming from cash-flow setup',
    /termsOrigin === 'cash_flow_setup'[\s\S]{0,200}?From your cash-flow setup/.test(src));
  // Review 2026-09-17: Save / Send tapped while the picker still said
  // (wave 4: the handlers also carry the #34 send lock, the #38 owner gate
  // and the #66 tax check, so the windows are wider — the order still holds.)
  // "Checking…" stamped a Net 30 the GC never saw. Both entry points wait.
  ok('Save waits while the new invoice terms are still loading',
    /const handleSave = useCallback\([\s\S]{0,1400}?if \(termsOrigin === 'loading'\) \{\s*showAlert\(TERMS_LOADING_TITLE, TERMS_LOADING_MESSAGE\);\s*return;/.test(src));
  ok('Send waits while the new invoice terms are still loading',
    /const handleSendPress = useCallback\(\(\) => \{[\s\S]{0,400}?if \(termsOrigin === 'loading'\) \{\s*showAlert\(TERMS_LOADING_TITLE, TERMS_LOADING_MESSAGE\);\s*return;\s*\}[\s\S]{0,400}?setShowSendRecipient\(true\);\s*\}, \[termsOrigin\b/.test(src));
  ok('the Save guard is not stale (termsOrigin in handleSave deps)',
    /\}, \[projectId, billingBlocked, lineItems, paymentTerms, termsOrigin, /.test(src));
  ok('a bill-from-estimate draft carries its resolved origin into the editor (all three origins)',
    /termsOriginParam === 'cash_flow_setup' \|\| termsOriginParam === 'fallback' \|\| termsOriginParam === 'unconfirmed'/.test(src));
}

// ── Wiring pins: app/bill-from-estimate.tsx ────────────────────────────────
{
  const src = read('app/bill-from-estimate.tsx');
  ok('bill-from-estimate no longer stamps a literal net_30 on the draft',
    !/paymentTerms:\s*'net_30'/.test(src));
  ok('bill-from-estimate stamps the resolved terms',
    /paymentTerms: termsDefault\.terms,/.test(src));
  ok('bill-from-estimate due date follows the same terms (not `now`)',
    /dueDate: dueDateForTerms\(now, termsDefault\.terms\),/.test(src));
  ok('the mount effect keeps the server promise so a tap can await it',
    /const p = readServerInvoiceTerms\(\(\) => loadCashFlowSettings\(uid\)\);\s*termsServerPromiseRef\.current = p;/.test(src));
  ok('a tap re-reads an unanswered cache instead of stamping net_30',
    /if \(!termsCacheRef\.current\) \{[\s\S]{0,200}?invoiceTermsDefaultFromCashFlow\(await loadCashFlowSettings\(\)\)/.test(src));
  ok('a tap awaits a pending server read unless the cache already holds his terms',
    /if \(termsServerRef\.current === 'pending' && termsCacheRef\.current\?\.origin !== 'cash_flow_setup' && termsServerPromiseRef\.current\) \{\s*termsServerRef\.current = await termsServerPromiseRef\.current;/.test(src));
  ok('the stamped terms come from settle (cache fallback never stamped while server pending)',
    /const termsDefault: InvoiceTermsDefault = settleInvoiceTermsDefault\(termsCacheRef\.current, termsServerRef\.current\)/.test(src));
  ok('a double tap cannot create two drafts (in-flight guard before the await)',
    /const handleCreateDraft = useCallback\(async \(\) => \{[\s\S]{0,120}?if \(creatingDraftRef\.current\) return;/.test(src)
    && /creatingDraftRef\.current = true;\s*if \(!termsCacheRef\.current\)/.test(src));
  ok('bill-from-estimate hands the origin to the editor',
    /params: \{ projectId, invoiceId: inv\.id, termsOrigin: termsDefault\.origin \}/.test(src));
}

// Belt and braces: an event loop that drains before the tally runs is a
// failure, never a silent pass.
let tallied = false;
process.on('exit', (code) => {
  if (!tallied && code === 0) {
    console.error('validate-invoice-terms: exited before reporting — an async check never settled');
    process.exitCode = 1;
  }
});
void checkReadServer().then(() => {
  tallied = true;
  if (failures > 0) {
    console.error(`\nvalidate-invoice-terms: ${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.info(`validate-invoice-terms: all ${passes} checks passed`);
});
