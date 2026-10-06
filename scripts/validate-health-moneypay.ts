// scripts/validate-health-moneypay.ts — health lane MONEYPAY (2026-09-26).
//
//   1  MONEY-AIA-L7              G702 line 7 is CUMULATIVE: from the third pay
//                                app on it used to carry only the last period's
//                                certificate, overstating line 8 and its link.
//   2  MONEY-AIA-CERTIFIED-LINK  a Pay link minted for the amount applied for
//                                kept charging it after a lower certificate.
//   3  MONEY-PAYLINK-AMOUNT-TRUST create-payment-link minted whatever amount
//                                the device sent, even over a paid invoice.
//   4  MONEY-SAMPLE-SEED-PROGRESS the sample's progress invoices stored a
//                                subtotal the editor could not reproduce.
//
// Every check EXECUTES the code it guards where it can (the helpers, the
// screen's own line-7 expression, the real portal builder, the real seeder,
// the real 409 reader); the rest pin the wiring by text.
//
// FAIL-BEFORE: MONEYPAY_ROOT=<a tree holding the 2859f55b copies of the owned
// files> bun scripts/validate-health-moneypay.ts — every section goes red.
//
// Run:  bun scripts/validate-health-moneypay.ts

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

type BunLoadResult = { exports: Record<string, unknown>; loader: 'object' };
declare const Bun: {
  plugin: (p: { name: string; setup: (build: { module: (specifier: string, cb: () => BunLoadResult) => void }) => void }) => void;
};

const WT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = process.env.MONEYPAY_ROOT || WT;

// utils/stripe.ts imports the Supabase client; nothing here reaches the network.
Bun.plugin({
  name: 'moneypay-stubs',
  setup(build) {
    build.module('@/lib/supabase', () => ({
      exports: { supabase: { functions: { invoke: async () => ({ data: null, error: null }) } }, isSupabaseConfigured: true },
      loader: 'object',
    }));
  },
});

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? `\n      got: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
}
const read = (rel: string): string => {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
};
const load = async (rel: string): Promise<any> => {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return {};
  try { return await import(p); } catch (e) { console.log(`  (could not import ${rel}: ${(e as Error).message})`); return {}; }
};
const fn = <T,>(v: T | undefined): v is T => typeof v === 'function';

const A = await load('utils/aiaBilling.ts');
const IB = await import(join(WT, 'utils/invoiceBilling.ts'));
const roundCents: (n: number) => number = IB.roundCents;

// ════════════════════════════════════════════════════════════════════════════
console.log('\n1. MONEY-AIA-L7 — line 7 is everything certified to date');
{
  const seed = A.seedLessPreviousCertificates as ((p: unknown) => number) | undefined;
  ok('utils/aiaBilling exports seedLessPreviousCertificates', fn(seed));

  // The screen's OWN expression, lifted from seedFreshApplication and run.
  const screen = read('app/aia-pay-app.tsx');
  const seedBlock = screen.slice(screen.indexOf('const seedFreshApplication = useCallback'));
  const m = /lessPreviousCertificates:\s*([\s\S]*?),\s*\n\s*storedRetainagePercent:\s*priorAIA\.storedRetainagePercent/.exec(seedBlock);
  const screenExpr = m ? m[1] : '';
  ok('the next-period seed in app/aia-pay-app.tsx is found', !!screenExpr);
  const screenSeed = (prior: unknown): number => {
    const f = new Function('priorAIA', 'seedLessPreviousCertificates', `return (${screenExpr});`);
    return Number(f(prior, seed ?? (() => NaN)));
  };

  const mk = (fromPrev: number, thisPeriod: number, lessPrev: number) => ({
    contractSumToDate: 100_000, originalContractSum: 100_000, retainagePercent: 10, lessPreviousCertificates: lessPrev,
    lines: [{ id: 'l1', scheduledValue: 100_000, fromPreviousApp: fromPrev, thisPeriod, materialsPresentlyStored: 0, retainagePercent: 10 }],
  });
  // $100k contract, 25%/month, 10% retainage; the architect certifies each app.
  const run = (seedFn: (p: unknown) => number, certify: (n: number, due: number) => number) => {
    const out: { line6: number; line7: number; line8: number }[] = [];
    let prior: unknown = null;
    let billed = 0;
    for (let n = 1; n <= 4; n++) {
      const lessPrev = prior ? seedFn(prior) : 0;
      const t = A.computeAIATotals(mk(billed, 25_000, lessPrev));
      out.push({ line6: t.totalEarnedLessRetainage, line7: lessPrev, line8: t.currentPaymentDue });
      prior = { amountCertified: certify(n, t.currentPaymentDue), lessPreviousCertificates: lessPrev, totals: t, lines: [{}] };
      billed += 25_000;
    }
    return out;
  };
  const asApplied = (_n: number, due: number) => due;
  for (const [label, f] of [['the helper', seed], ["the screen's seed", screenExpr ? screenSeed : undefined]] as const) {
    if (!fn(f) || !fn(A.computeAIATotals)) { ok(`${label}: runs`, false, 'missing'); continue; }
    const r = run(f as (p: unknown) => number, asApplied);
    ok(`${label}: apps #1 and #2 ask for $22,500`, r[0].line8 === 22_500 && r[1].line8 === 22_500, r.map(x => x.line8));
    ok(`${label}: app #3 line 7 = $45,000 (app #2's line 6, as certified)`, r[2].line7 === 45_000 && r[2].line7 === r[1].line6, r[2]);
    ok(`${label}: app #3 line 8 = $22,500, not $45,000`, r[2].line8 === 22_500, r[2]);
    ok(`${label}: app #4 line 7 = $67,500, line 8 = $22,500`, r[3].line7 === 67_500 && r[3].line8 === 22_500, r[3]);
    // A certificate that came back REDUCED: the shortfall is billed again next
    // period, because line 7 only counts what was actually certified.
    const cut = run(f as (p: unknown) => number, (n, due) => (n === 2 ? 20_000 : due));
    ok(`${label}: app #2 certified $2,500 short → app #3 line 7 $42,500, line 8 $25,000`, cut[2].line7 === 42_500 && cut[2].line8 === 25_000, cut[2]);
  }
  if (fn(seed)) {
    ok('no certificate on the prior period → its line 6 (applied for to date), unchanged',
      seed({ lessPreviousCertificates: 22_500, totals: { totalEarnedLessRetainage: 45_000 } }) === 45_000);
    ok('MONEY-F1: a prior record with no totals and no certificate seeds 0', seed({}) === 0 && seed({ totals: null }) === 0);
    ok('a certificate with no stored line 7 is its own total', seed({ amountCertified: 5_000 }) === 5_000);
    ok('cents, not float drift', seed({ amountCertified: 0.1, lessPreviousCertificates: 0.2 }) === 0.3);
    ok('no prior period → 0', seed(null) === 0);
  }
  ok('app/aia-pay-app.tsx seeds line 7 through seedLessPreviousCertificates(priorAIA)',
    /lessPreviousCertificates:\s*seedLessPreviousCertificates\(priorAIA\)/.test(screen));
  ok('…and no longer reads priorAIA.amountCertified ?? priorAIA.totals',
    !/priorAIA\.amountCertified\s*\n?\s*\?\?\s*priorAIA\.totals/.test(screen));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2. MONEY-AIA-CERTIFIED-LINK — the owner pays the certified figure');
{
  const payable = A.aiaPayableNow as ((a: unknown) => number) | undefined;
  const needs = A.certifiedPayLinkNeedsRemint as ((r: unknown, o: unknown) => boolean) | undefined;
  ok('utils/aiaBilling exports aiaPayableNow and certifiedPayLinkNeedsRemint', fn(payable) && fn(needs));
  if (fn(payable)) {
    ok('certified $45,000 on a $50,000 application → $45,000', payable({ amountCertified: 45_000, totals: { currentPaymentDue: 50_000 } }) === 45_000);
    ok('no certificate → line 8 as applied for', payable({ totals: { currentPaymentDue: 50_000 } }) === 50_000);
    ok('certified $0 is $0, not "not recorded"', payable({ amountCertified: 0, totals: { currentPaymentDue: 50_000 } }) === 0);
    ok('no totals, no certificate → 0', payable({}) === 0 && payable(null) === 0);
    ok('rounded to cents', payable({ amountCertified: 45_000.004 }) === 45_000);
  }
  if (fn(needs)) {
    const live = { payLinkUrl: 'https://pay/x', payLinkId: 'plink_1', payLinkAmount: 50_000, amountCertified: 45_000, totals: { currentPaymentDue: 50_000 } };
    const clear = { pendingBankPayment: false, sourceInvoiceSettled: false };
    ok('a live link for $50,000 after a $45,000 certificate → replace it', needs(live, clear) === true);
    ok('…not when the link already charges the certified figure', needs({ ...live, payLinkAmount: 45_000 }, clear) === false);
    ok('…not when paid, settling, or the invoice is settled',
      !needs({ ...live, paidAt: '2026-09-01' }, clear) && !needs(live, { ...clear, pendingBankPayment: true }) && !needs(live, { ...clear, sourceInvoiceSettled: true }));
    ok('…not without a link, or without a certificate', !needs({ ...live, payLinkUrl: undefined }, clear) && !needs({ ...live, amountCertified: undefined }, clear));
    ok('…a link with no recorded amount is replaced once a certificate exists', needs({ ...live, payLinkAmount: undefined }, clear) === true);
  }

  // The real portal builder.
  const P = await load('utils/portalSnapshot.ts');
  if (!fn(P.buildPortalSnapshot)) ok('buildPortalSnapshot loads', false, 'missing');
  else {
    const app = (over: Record<string, unknown>) => ({
      id: 'a1', projectId: 'p1', invoiceId: 'inv1', applicationNumber: 2,
      applicationDate: '2026-09-30', periodTo: '2026-09-30',
      ownerName: 'O', contractorName: 'GC', projectName: 'Job',
      originalContractSum: 200_000, netChangeByCO: 0, contractSumToDate: 200_000,
      retainagePercent: 10, lessPreviousCertificates: 0, lines: [],
      totals: { totalScheduledValue: 200_000, totalCompletedAndStored: 55_556, totalRetainage: 5_556, totalEarnedLessRetainage: 50_000, currentPaymentDue: 50_000, balanceToFinish: 150_000, percentComplete: 27.8 },
      payLinkUrl: 'https://pay.stripe.com/x', payLinkId: 'plink_1', payLinkAmount: 50_000,
      savedAt: '2026-09-30', portalState: { status: 'sent' }, ...over,
    });
    const inv = { id: 'inv1', projectId: 'p1', number: 2, type: 'progress', status: 'sent', issueDate: '2026-09-30', dueDate: '2026-10-30', lineItems: [], subtotal: 50_000, taxAmount: 0, totalDue: 50_000, amountPaid: 0, portalState: { status: 'sent' } };
    const pay = (a: Record<string, unknown>) => P.buildPortalSnapshot({
      project: { id: 'p1', name: 'Job', status: 'active' }, portal: { showInvoices: true }, invoices: [inv], aiaPayApps: [a],
    }).sections.aiaPayApps?.[0]?.payLinkUrl;
    ok('portal: a $50,000 link on a $50,000 application certified at $45,000 shows NO Pay button', pay(app({ amountCertified: 45_000 })) === undefined);
    ok('portal: a link re-minted for the certified $45,000 shows Pay', pay(app({ amountCertified: 45_000, payLinkAmount: 45_000 })) === 'https://pay.stripe.com/x');
    ok('portal: no certificate, link for line 8 → Pay (unchanged)', pay(app({})) === 'https://pay.stripe.com/x');
  }

  const screen = read('app/aia-pay-app.tsx');
  const save = screen.slice(screen.indexOf('const handleSave = useCallback'), screen.indexOf('const handleSaveCertification'));
  ok('handleSave mints for aiaPayableNow(rec), not line 8', /const due = aiaPayableNow\(rec\);/.test(save) && !/const due = rec\.totals\?\.currentPaymentDue/.test(save));
  const remint = screen.slice(screen.indexOf('const remintCertifiedPayLink = useCallback'), screen.indexOf('const handleSaveCertification'));
  ok('the certificate re-mint is gated by certifiedPayLinkNeedsRemint and reaches createPaymentLink for the payable',
    /certifiedPayLinkNeedsRemint\(/.test(remint) && /createPaymentLink\(\{[\s\S]*?recordType: 'aia_pay_app'[\s\S]*?amountCents: Math\.round\(payable \* 100\)/.test(remint)
    && /const payable = aiaPayableNow\(updated\)/.test(remint));
  const cert = screen.slice(screen.indexOf('const handleSaveCertification = useCallback'), screen.indexOf('const certificationDirty'));
  ok('saving the architect’s response runs the re-mint on the updated record', /await remintCertifiedPayLink\(updated\)/.test(cert));
  ok('a failed replacement is shown on screen (testID aia-cert-remint-failed)', /testID="aia-cert-remint-failed"/.test(screen) && /setCertRemintNote\(/.test(remint));
  const portal = read('utils/portalSnapshot.ts');
  ok('the portal guard compares the link with aiaPayableNow(app)', /amountStillMatches = app\.payLinkAmount != null\s*&& Math\.abs\(app\.payLinkAmount - aiaPayableNow\(app\)\) <= 0\.01/.test(portal));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2b. Review round 1 — background re-mints the server refuses, and double taps');
{
  const S = await load('utils/stripe.ts');
  const notice = S.payLinkRemintRefusalNotice as ((code: unknown, ctx: string) => string | null) | undefined;
  ok('utils/stripe exports payLinkRemintRefusalNotice', fn(notice));
  if (fn(notice)) {
    const rel = notice('balance_changed', 'retention_release');
    ok('retention release refused as balance_changed → says the release has not reached the server and the link was not replaced',
      typeof rel === 'string' && /not reached the server/.test(rel) && /not replaced/.test(rel), rel);
    const cert = notice('balance_changed', 'certificate');
    ok('certificate refused as balance_changed → says the server has not received the certificate (not "refresh before sending")',
      typeof cert === 'string' && /not received the architect/.test(cert) && !/before sending/.test(cert), cert);
    ok('nothing_due, payment_pending, a Stripe error or no code → null (their existing handling stands)',
      notice('nothing_due', 'retention_release') === null && notice('payment_pending', 'certificate') === null
      && notice('Stripe said no', 'retention_release') === null && notice(undefined, 'certificate') === null);
  }

  const inv = read('app/invoice.tsx');
  const release = inv.slice(inv.indexOf('const handleReleaseRetention = useCallback'), inv.indexOf('// Use the effective status so an unpaid-but-past-due'));
  ok('the retention-release re-mint reads its result and shows the refusal instead of only logging it',
    /mintPayLinkFor\(existingInvoice, newBalance\)\.then\(\(minted\) => \{[\s\S]*?payLinkRemintRefusalNotice\(minted\.error, 'retention_release'\)[\s\S]*?showAlert\('Pay Link Not Replaced Yet', notice\)/.test(release));

  const screen = read('app/aia-pay-app.tsx');
  const remint = screen.slice(screen.indexOf('const remintCertifiedPayLink = useCallback'), screen.indexOf('const handleSaveCertification'));
  const lockAt = remint.indexOf('if (certRemintInFlight.current) return;');
  ok('the certificate re-mint has an in-flight lock, checked before anything else runs',
    /const certRemintInFlight = useRef\(false\)/.test(screen) && lockAt >= 0
    && lockAt < remint.indexOf('setCertRemintNote(null)') && lockAt < remint.indexOf('createPaymentLink('));
  ok('…taken before the call and released in a finally, so a failure never leaves it stuck',
    /certRemintInFlight\.current = true;\s*try \{/.test(remint) && /\} finally \{\s*certRemintInFlight\.current = false;\s*\}/.test(remint));
  ok('a certificate refused as balance_changed shows the certificate copy',
    /payLinkRemintRefusalNotice\(res\.code, 'certificate'\)/.test(remint));

  // The write-back. addAIAPayApp replaces the whole record; a corrected
  // certificate saved inside the network window (the lock skips its re-mint,
  // not its save) must survive the first call's write-back.
  const merge = A.mergeRemintedPayLink as ((l: unknown, m: unknown, k: unknown) => Record<string, unknown>) | undefined;
  ok('utils/aiaBilling exports mergeRemintedPayLink', fn(merge));
  if (fn(merge)) {
    const first = { id: 'a1', amountCertified: 45_000, certifiedDate: '2026-09-20', payLinkUrl: 'https://pay/old', payLinkId: 'plink_old', payLinkAmount: 50_000 };
    const corrected = { ...first, amountCertified: 44_000, certifiedDate: '2026-09-21' };
    const m = merge(corrected, first, { url: 'https://pay/new', id: 'plink_new', amount: 45_000 });
    ok('write-back keeps the certificate saved inside the window (44,000, not 45,000)', m.amountCertified === 44_000 && m.certifiedDate === '2026-09-21', JSON.stringify(m));
    ok('…and carries the new link', m.payLinkUrl === 'https://pay/new' && m.payLinkId === 'plink_new' && m.payLinkAmount === 45_000);
    ok('a latest record of ANOTHER id is ignored (the snapshot is used)', merge({ ...corrected, id: 'b9' }, first, { url: 'u', id: 'i', amount: 45_000 }).amountCertified === 45_000);
    ok('no latest record → the snapshot', merge(null, first, { url: 'u', id: 'i', amount: 45_000 }).amountCertified === 45_000);
    ok('the link amount is rounded to cents', merge(null, first, { url: 'u', id: 'i', amount: 45_000.004 }).payLinkAmount === 45_000);
    const needs = A.certifiedPayLinkNeedsRemint as ((r: unknown, o: unknown) => boolean) | undefined;
    if (fn(needs)) {
      ok('…and the merged record then says the link is stale (45,000 link, 44,000 certified)',
        needs({ ...m, totals: { currentPaymentDue: 50_000 } }, { pendingBankPayment: false, sourceInvoiceSettled: false }) === true);
    }
  }
  ok('the screen records the newest record handed to the re-mint BEFORE the lock check',
    /const latestCertRecordRef = useRef<SavedAIAPayApp \| null>\(null\)/.test(screen)
    && remint.indexOf('latestCertRecordRef.current = updated;') >= 0 && remint.indexOf('latestCertRecordRef.current = updated;') < lockAt);
  ok('the write-back merges onto latestCertRecordRef, never spreads the stale snapshot',
    /const merged = mergeRemintedPayLink\(latestCertRecordRef\.current, updated, \{ url: res\.url, id: res\.id, amount: payable \}\);\s*latestCertRecordRef\.current = merged;\s*addAIAPayApp\(merged\);/.test(remint)
    && !/addAIAPayApp\(\{ \.\.\.updated,/.test(remint));
  ok('a certificate that changed inside the window raises the retry note',
    /if \(certifiedPayLinkNeedsRemint\(\s*\{ \.\.\.merged,[\s\S]*?setCertRemintNote\(/.test(remint));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2c. The client portal PAGE offers the re-minted certified link');
{
  // The builder's guard alone is not enough: marketing/portal/index.html runs
  // its OWN aiaCanPay over the snapshot row, and before this it compared the
  // link with line 8 as applied for — so a link correctly re-minted for the
  // certified figure showed no Pay button at all (review round 1, major).
  const page = read('marketing/portal/index.html');
  const lift = (name: string): string => {
    const at = page.indexOf(`function ${name}(`);
    if (at < 0) return '';
    let depth = 0;
    for (let i = page.indexOf('{', at); i < page.length; i++) {
      if (page[i] === '{') depth++;
      else if (page[i] === '}' && --depth === 0) return page.slice(at, i + 1);
    }
    return '';
  };
  const src = ['aiaIsPaid', 'aiaPayable', 'aiaCanPay'].map(lift);
  ok('the page defines aiaPayable next to aiaCanPay', src.every(Boolean), src.map(x => x.length));
  // A page without aiaPayable printed line 8 on its Pay label; stand that in so
  // the checks below run the page's REAL aiaCanPay either way (fail-before).
  if (!src[1]) src[1] = 'function aiaPayable(a) { return a.currentPaymentDue || 0; }';
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const pageFns = src[0] && src[2]
    ? new Function('SETTLED_INVOICE_IDS', `${src.join('\n')}\nreturn { aiaCanPay: aiaCanPay, aiaPayable: aiaPayable };`)({}) as { aiaCanPay: (a: unknown) => boolean; aiaPayable: (a: unknown) => number }
    : null;
  const P = await load('utils/portalSnapshot.ts');
  if (!pageFns || !fn(P.buildPortalSnapshot)) ok('page guard + builder load', false, 'missing');
  else {
    const base = {
      id: 'a1', projectId: 'p1', invoiceId: 'inv1', applicationNumber: 2, applicationDate: '2026-09-30', periodTo: '2026-09-30',
      ownerName: 'O', contractorName: 'GC', projectName: 'Job', originalContractSum: 200_000, netChangeByCO: 0, contractSumToDate: 200_000,
      retainagePercent: 10, lessPreviousCertificates: 0, lines: [],
      totals: { totalScheduledValue: 200_000, totalCompletedAndStored: 55_556, totalRetainage: 5_556, totalEarnedLessRetainage: 50_000, currentPaymentDue: 50_000, balanceToFinish: 150_000, percentComplete: 27.8 },
      payLinkUrl: 'https://pay.stripe.com/x', payLinkId: 'plink_1', payLinkAmount: 50_000, savedAt: '2026-09-30', portalState: { status: 'sent' },
    };
    const inv = { id: 'inv1', projectId: 'p1', number: 2, type: 'progress', status: 'sent', issueDate: '2026-09-30', dueDate: '2026-10-30', lineItems: [], subtotal: 50_000, taxAmount: 0, totalDue: 50_000, amountPaid: 0, portalState: { status: 'sent' } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (over: Record<string, unknown>): any => P.buildPortalSnapshot({
      project: { id: 'p1', name: 'Job', status: 'active' }, portal: { showInvoices: true }, invoices: [inv], aiaPayApps: [{ ...base, ...over }],
    }).sections.aiaPayApps?.[0];
    const reminted = row({ amountCertified: 45_000, payLinkAmount: 45_000 });
    ok('the snapshot row carries payableNow = the certified $45,000 (line 8 stays $50,000)',
      reminted?.payableNow === 45_000 && reminted?.currentPaymentDue === 50_000, reminted && { payableNow: reminted.payableNow, due: reminted.currentPaymentDue });
    ok('PAGE: the link re-minted for the certified $45,000 shows Pay', pageFns.aiaCanPay(reminted) === true);
    ok('PAGE: …and the Pay label figure is $45,000, the amount the link charges', pageFns.aiaPayable(reminted) === 45_000);
    const stale = row({ amountCertified: 45_000 });
    ok('PAGE: the stale $50,000 link after the certificate still shows NO Pay', pageFns.aiaCanPay(stale) === false);
    ok('PAGE: a cached row that still carries the stale URL is refused by the page too',
      pageFns.aiaCanPay({ ...stale, payLinkUrl: 'https://pay.stripe.com/x' }) === false);
    ok('PAGE: no certificate, link for line 8 → Pay for line 8 (unchanged)',
      pageFns.aiaCanPay(row({})) === true && pageFns.aiaPayable(row({})) === 50_000);
    ok('PAGE: a snapshot published before payableNow existed falls back to line 8',
      pageFns.aiaCanPay({ currentPaymentDue: 50_000, payLinkUrl: 'u', payLinkAmount: 50_000 }) === true
      && pageFns.aiaCanPay({ currentPaymentDue: 50_000, payLinkUrl: 'u', payLinkAmount: 45_000 }) === false);
    ok('PAGE: certified $0 is nothing to pay', pageFns.aiaCanPay({ currentPaymentDue: 50_000, payableNow: 0, payLinkUrl: 'u', payLinkAmount: 0 }) === false);
  }
  const renderAIA = page.slice(page.indexOf('function renderAIA('), page.indexOf('function renderChangeOrders('));
  ok('the card\'s "Pay $X" reads aiaPayable(a)', /var due = aiaPayable\(a\);/.test(renderAIA) && /' Pay ' \+ fmtMoney\(due, \{dec:2\}\)/.test(renderAIA));
  ok('the drawer\'s "Pay $X" reads aiaPayable(a)', /var aiaDue = aiaPayable\(a\);/.test(page) && !/var aiaDue = a\.currentPaymentDue/.test(page));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n3. MONEY-PAYLINK-AMOUNT-TRUST — never mint above the server balance');
{
  const B = await load('supabase/functions/_shared/payLinkBalance.ts');
  const cents = B.serverPayableCents as ((t: string, r: unknown) => number | null) | undefined;
  const verdict = B.payLinkAmountVerdict as ((req: number, srv: number) => string) | undefined;
  ok('_shared/payLinkBalance.ts loads under bun with serverPayableCents + payLinkAmountVerdict', fn(cents) && fn(verdict));
  if (fn(cents) && fn(verdict)) {
    const paid = { status: 'paid', total_due: 20_000, amount_paid: 20_000, subtotal: 20_000 };
    ok('a paid invoice → server 0 → nothing_due', cents('invoice', paid) === 0 && verdict(2_000_000, cents('invoice', paid) as number) === 'nothing_due');
    ok('a stale $20,000 request on a $0 balance → nothing_due', verdict(2_000_000, 0) === 'nothing_due');
    const part = { status: 'partially_paid', total_due: '20000.00', amount_paid: '8000', subtotal: '20000' };
    ok('PostgREST numeric strings read; $20,000 less $8,000 paid = 1,200,000 cents', cents('invoice', part) === 1_200_000, cents('invoice', part));
    ok('a $20,000 request on a $12,000 balance → balance_changed', verdict(2_000_000, 1_200_000) === 'balance_changed');
    ok('request == balance → ok; request below balance → ok (partial / lagging payment)', verdict(1_200_000, 1_200_000) === 'ok' && verdict(500_000, 1_200_000) === 'ok');
    ok('one cent of rounding tolerance, two cents is an overcharge', verdict(1_200_001, 1_200_000) === 'ok' && verdict(1_200_002, 1_200_000) === 'balance_changed');
    const ret = { status: 'sent', total_due: 10_887.5, subtotal: 10_000, retention_percent: 10, amount_paid: 0 };
    ok('held retention is excluded (10% of the $10,000 work value)', cents('invoice', ret) === 988_750, cents('invoice', ret));
    ok('…so a gross request is an overcharge', verdict(1_088_750, cents('invoice', ret) as number) === 'balance_changed');
    ok('…released retention is collectible again', cents('invoice', { ...ret, retention_released: 1_000 }) === 1_088_750);
    ok('a DRAFT cannot vouch for a balance (edits are written after the mint) → null', cents('invoice', { ...ret, status: 'draft' }) === null);
    ok('no total_due read (older schema) → null', cents('invoice', { status: 'sent' }) === null);
    const aia = { pay_link_id: 'plink_1', certified_at: '2026-09-20T00:00:00Z', snapshot_totals: { currentPaymentDue: 50_000, __mageCertificate: { amountCertified: 45_000 } } };
    ok('AIA certified lower: server $45,000 → a $50,000 request is balance_changed', cents('aia_pay_app', aia) === 4_500_000 && verdict(5_000_000, 4_500_000) === 'balance_changed');
    ok('AIA: the certified $45,000 request is ok', verdict(4_500_000, cents('aia_pay_app', aia) as number) === 'ok');
    ok('AIA: no certificate → line 8', cents('aia_pay_app', { ...aia, snapshot_totals: { currentPaymentDue: 50_000 } }) === 5_000_000);
    ok('AIA: paid_at → nothing_due', cents('aia_pay_app', { ...aia, paid_at: '2026-09-21' }) === 0);
    ok('AIA: a draft never through Stripe (the screen mints before it writes) → null', cents('aia_pay_app', { snapshot_totals: { currentPaymentDue: 50_000 } }) === null);
    ok('AIA: a snapshot with no figure → null', cents('aia_pay_app', { ...aia, snapshot_totals: { __mageCertificate: {} } }) === null);
  }
  const msg = B.payLinkRefusalMessage as ((v: string, c: number | null, t?: string) => string) | undefined;
  ok('the refusal sentence says why and what to do',
    fn(msg) && /\$12,000\.00/.test(msg('balance_changed', 1_200_000)) && /Refresh the invoice/.test(msg('balance_changed', 1_200_000))
      && /Nothing is owed on this invoice/.test(msg('nothing_due', 0)) && /pay application/.test(msg('nothing_due', 0, 'aia_pay_app')));
  const bSrc = read('supabase/functions/_shared/payLinkBalance.ts');
  ok('_shared/payLinkBalance.ts has no Deno globals and imports only ./paymentMath.ts',
    !!bSrc && !/\bDeno\./.test(bSrc) && [...bSrc.matchAll(/from\s+"([^"]+)"/g)].every(x => x[1] === './paymentMath.ts'));

  // The client half: the 409 body reaches the screen.
  const S = await load('utils/stripe.ts');
  if (!fn(S.paymentLinkErrorResult)) ok('utils/stripe.ts exports paymentLinkErrorResult (reads the 409 body)', false, 'missing');
  else {
    const e409 = (body: unknown) => ({ message: 'Edge Function returned a non-2xx status code', context: { status: 409, json: async () => body } });
    const r1 = await S.paymentLinkErrorResult(e409({ success: false, error: 'balance_changed', code: 'balance_changed', serverBalanceCents: 1_200_000, message: 'SERVER SENTENCE' }));
    ok('balance_changed: code + serverBalanceCents + the server sentence pass through', r1.code === 'balance_changed' && r1.serverBalanceCents === 1_200_000 && r1.error === 'SERVER SENTENCE', r1);
    const r2 = await S.paymentLinkErrorResult(e409({ success: false, error: 'nothing_due', serverBalanceCents: 0 }));
    ok('nothing_due without a message: the app fallback names it', r2.code === 'nothing_due' && /Nothing is owed/.test(r2.error ?? ''), r2);
    const r3 = await S.paymentLinkErrorResult(e409({ success: false, error: 'payment_pending' }));
    ok('payment_pending still arrives as payment_pending', r3.error === 'payment_pending' && r3.code === 'payment_pending', r3);
    const r4 = await S.paymentLinkErrorResult({ message: 'fetch failed' });
    ok('no body → the transport message', r4.error === 'fetch failed' && !r4.code, r4);
    if (fn(msg) && fn(S.payLinkBalanceFallback)) {
      const same = (['balance_changed', 'nothing_due'] as const).every(code => (['invoice', 'aia_pay_app'] as const).every(t =>
        S.payLinkBalanceFallback(code, 1_234_567, t) === msg(code, 1_234_567, t)));
      ok("the app's fallback sentence is word-for-word the server's", same);
    }
  }

  const idx = read('supabase/functions/create-payment-link/index.ts');
  ok('create-payment-link imports the balance rule from ../_shared/payLinkBalance.ts', /from "\.\.\/_shared\/payLinkBalance\.ts"/.test(idx));
  ok('…selects the balance columns on the ownership lookup',
    /balanceCols = recordType === "aia_pay_app" \? AIA_BALANCE_COLUMNS : INVOICE_BALANCE_COLUMNS/.test(idx)
    && /lookup\(`id,user_id,project_id,pay_link_id,pay_pending_at,\$\{balanceCols\}`\)/.test(idx));
  ok('…keeps the 400-retry to the old column lists',
    idx.includes('lookup("id,user_id,project_id,pay_link_id,pay_pending_at")') && idx.includes('lookup("id,user_id,project_id,pay_link_id")'));
  const iSample = idx.indexOf('error: "sample_project"');
  const iPending = idx.indexOf('error: "payment_pending"');
  const iVerdict = idx.indexOf('payLinkAmountVerdict(Math.round(body.amountCents)');
  const iPrice = idx.indexOf('stripeFetch("/prices"');
  ok('…calls payLinkAmountVerdict after the sample and pending refusals and before the Stripe price create',
    iSample > 0 && iPending > iSample && iVerdict > iPending && iPrice > iVerdict, { iSample, iPending, iVerdict, iPrice });
  ok('…refuses on any verdict but ok, answering 409 with the code and serverBalanceCents',
    /if \(verdict !== "ok"\) \{[\s\S]{0,400}error: verdict,[\s\S]{0,200}serverBalanceCents: serverCents,[\s\S]{0,120}\}, 409\)/.test(idx));

  const invoice = read('app/invoice.tsx');
  const mint = invoice.slice(invoice.indexOf('const mintPayLinkFor = useCallback'), invoice.indexOf('const buildNewInvoice = useCallback'));
  ok("invoice.tsx mintPayLinkFor turns 'balance_changed' / 'nothing_due' into a failed result with the reason",
    /if \(isPayLinkBalanceCode\(res\.code\)\) \{[\s\S]{0,200}reason: 'failed',[\s\S]{0,80}error: res\.code,[\s\S]{0,40}message:/.test(mint));
  const stops = [...invoice.matchAll(/\} else if \(isPayLinkBalanceCode\(minted\.error\)\) \{([\s\S]{0,900}?)\} else \{/g)].map(x => x[1]);
  ok('…and BOTH send paths stop (no email) with the reason on a balance refusal',
    stops.length === 2 && stops.every(b => /showAlert\('Invoice Not Sent'/.test(b) && /\breturn;/.test(b)), stops.length);
  const aiaScreen = read('app/aia-pay-app.tsx');
  ok('aia-pay-app.tsx handles the balance refusal on its mint (own copy, not "Stripe didn\'t reach us")',
    /else if \(isPayLinkBalanceCode\(res\.code\)\)/.test(aiaScreen) && /balanceRefusal && due > 0/.test(aiaScreen));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n4. MONEY-SAMPLE-SEED-PROGRESS — the seeded figures foot the way the editor does');
{
  const D = await load('utils/demoSeed.ts');
  if (!fn(D.seedDemoProject)) ok('seedDemoProject loads', false, 'missing');
  else {
    for (const flavor of ['small', 'medium', 'large'] as const) {
      const invoices: any[] = [];
      const noop = () => {};
      await D.seedDemoProject({ addProject: noop, addInvoice: (i: unknown) => invoices.push(i), addDailyReport: noop, addPunchItem: noop, addProjectPhoto: noop, addRFI: noop, addChangeOrder: noop, flavor });
      const bad = invoices.filter(i => {
        const sub = roundCents(IB.progressSubtotal(i.lineItems, i.type === 'progress', i.progressPercent ?? 0));
        return i.subtotal !== sub
          || i.taxAmount !== roundCents(i.subtotal * i.taxRate / 100)
          || i.totalDue !== roundCents(i.subtotal + i.taxAmount);
      }).map(i => ({ n: i.number, subtotal: i.subtotal, editor: roundCents(IB.progressSubtotal(i.lineItems, i.type === 'progress', i.progressPercent ?? 0)), tax: i.taxAmount, total: i.totalDue }));
      ok(`${flavor}: every seeded invoice — subtotal = the editor's progressSubtotal, tax = subtotal × rate, total = subtotal + tax (${invoices.length})`,
        invoices.length > 0 && bad.length === 0, bad);
      const money = invoices.filter(i => {
        const paidSum = roundCents((i.payments ?? []).reduce((s: number, p: { amount: number }) => s + p.amount, 0));
        return (i.status === 'paid' && i.amountPaid !== i.totalDue) || i.amountPaid > i.totalDue || paidSum !== i.amountPaid
          || (i.status === 'partially_paid' && !(i.amountPaid > 0 && i.amountPaid < i.totalDue));
      }).map(i => ({ n: i.number, status: i.status, paid: i.amountPaid, total: i.totalDue }));
      ok(`${flavor}: paid = total, partial is partial, payments add up`, money.length === 0, money);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
