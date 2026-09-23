// scripts/validate-w5-brain-money-forecast.ts — the Friday Close's AI payment
// forecast after audit wave 5 (#116, 2026-09-22).
//
// The Home card re-ran a smart-tier AI forecast on every invoices / COs /
// projects array identity — even after the close had been seen — charging his
// monthly allowance on the server while the app's own meter never counted it.
// Pinned here:
//   1. the fingerprint the query and the mageAI cache are keyed on is a
//      function of the A/R state only: same content → same key (a new array,
//      a re-sort, a CO edit), a real change → a new key (a payment, a new
//      invoice, a new day, another account);
//   2. no call unless an invoice is past due on the local calendar;
//   3. the real mageAI call carries that key as its cacheKey, and a fresh call
//      is reported so the caller can meter it — a cache hit is not;
//   4. the hook and the Home card are wired that way (source, comments
//      stripped — bun cannot mount either).
//
// utils/paymentPrediction.ts imports utils/mageAI (AsyncStorage, supabase) at
// module scope; mageAI is replaced with a recording stand-in BEFORE import.
//
// Run via: bun run scripts/validate-w5-brain-money-forecast.ts

const BUN_TEST = 'bun:test';
const { mock } = (await import(BUN_TEST)) as {
  mock: { module: (specifier: string, factory: () => Record<string, unknown>) => void };
};
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Invoice, Project } from '../types';

const aiCalls: Record<string, unknown>[] = [];
let serveFromCache = false;
mock.module('@/utils/mageAI', () => ({
  mageAI: async (params: Record<string, unknown>) => {
    aiCalls.push(params);
    return {
      success: true, fromCache: serveFromCache, cached: serveFromCache,
      data: { perInvoice: [{ invoiceId: 'i1', onTimeProbability: 60, daysToPay: 9, riskLevel: 'medium', reasons: [], suggestedAction: 'Call' }], headline: 'h', topAction: 't' },
    };
  },
}));

const pp = await import('../utils/paymentPrediction');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (p: string) => strip(readFileSync(join(ROOT, p), 'utf8'));

const inv = (id: string, over: Partial<Invoice> = {}): Invoice => ({
  id, number: 1, projectId: 'p1', type: 'progress',
  issueDate: '2026-08-01', dueDate: '2026-08-31', paymentTerms: 'net_30', notes: '',
  lineItems: [], subtotal: 10_000, taxRate: 0, taxAmount: 0, totalDue: 10_000, amountPaid: 0,
  status: 'sent', payments: [], createdAt: '2026-08-01', updatedAt: '2026-08-01',
  ...over,
} as unknown as Invoice);
const projectsById = { p1: { id: 'p1', name: 'Henderson', status: 'in_progress' } as unknown as Project };
const FRI = new Date(2026, 8, 18, 9, 0, 0);          // Fri Sep 18 2026, local
const SAT = new Date(2026, 8, 19, 9, 0, 0);

console.log('\n#116 — one forecast per A/R state:');
{
  const book = [inv('i1'), inv('i2', { dueDate: '2026-10-15' }), inv('i3', { status: 'paid', amountPaid: 10_000 })];
  const k = pp.paymentForecastFingerprint(book, projectsById, 'u1', FRI);
  ok('a fingerprint exists when something is unpaid', typeof k === 'string' && k.length > 0);
  ok('same content in a NEW array → same key (array identity no longer re-asks)',
    pp.paymentForecastFingerprint(book.map(i => ({ ...i })), { ...projectsById }, 'u1', FRI) === k);
  ok('…in a different order → same key', pp.paymentForecastFingerprint([...book].reverse(), projectsById, 'u1', FRI) === k);
  ok('…later the same day → same key',
    pp.paymentForecastFingerprint(book, projectsById, 'u1', new Date(2026, 8, 18, 22, 30)) === k);
  ok('a payment recorded → new key',
    pp.paymentForecastFingerprint([inv('i1', { amountPaid: 4_000, status: 'partially_paid', payments: [{ id: 'pay', amount: 4_000, date: '2026-09-17' }] as never }), book[1], book[2]], projectsById, 'u1', FRI) !== k);
  ok('a new invoice → new key', pp.paymentForecastFingerprint([...book, inv('i4')], projectsById, 'u1', FRI) !== k);
  ok('a changed due date → new key',
    pp.paymentForecastFingerprint([inv('i1', { dueDate: '2026-09-30' }), book[1], book[2]], projectsById, 'u1', FRI) !== k);
  ok('a new local day → new key', pp.paymentForecastFingerprint(book, projectsById, 'u1', SAT) !== k);
  ok('another account → new key', pp.paymentForecastFingerprint(book, projectsById, 'u2', FRI) !== k);
  ok('a draft or a settled invoice does not enter it',
    pp.paymentForecastFingerprint([...book, inv('d1', { status: 'draft' })], projectsById, 'u1', FRI) === k);
  ok('nothing unpaid → no fingerprint (nothing to forecast)',
    pp.paymentForecastFingerprint([book[2]], projectsById, 'u1', FRI) === null);

  ok('an invoice due before today (local) is overdue', pp.hasOverdueUnpaidInvoice([inv('i1')], FRI));
  ok('one due later is not', !pp.hasOverdueUnpaidInvoice([inv('i2', { dueDate: '2026-10-15' })], FRI));
  ok('…nor one due TODAY', !pp.hasOverdueUnpaidInvoice([inv('i5', { dueDate: '2026-09-18' })], FRI));
  ok('…nor a paid-off or draft one',
    !pp.hasOverdueUnpaidInvoice([inv('i3', { status: 'paid', amountPaid: 10_000 }), inv('d', { status: 'draft' })], FRI));
}

console.log('\n#116 — the call carries the key and reports whether it spent:');
{
  aiCalls.length = 0;
  serveFromCache = false;
  const fresh = await pp.predictInvoicePaymentsCached([inv('i1')], projectsById, { cacheKey: 'week_close_forecast_K', cacheHours: 12 });
  ok('the mageAI call is handed the cacheKey and cacheHours',
    aiCalls.length === 1 && aiCalls[0].cacheKey === 'week_close_forecast_K' && aiCalls[0].cacheHours === 12,
    JSON.stringify({ cacheKey: aiCalls[0]?.cacheKey, cacheHours: aiCalls[0]?.cacheHours }));
  ok('…still attributed to invoicePrediction on the smart tier',
    aiCalls[0]?.feature === 'invoicePrediction' && aiCalls[0]?.tier === 'smart');
  ok('a fresh call is reported as one (so it is metered)', fresh.freshAiCall === true);
  serveFromCache = true;
  const cached = await pp.predictInvoicePaymentsCached([inv('i1')], projectsById, { cacheKey: 'week_close_forecast_K', cacheHours: 12 });
  ok('a cache hit is not', cached.freshAiCall === false);
  serveFromCache = false;
  const none = await pp.predictInvoicePaymentsCached([], projectsById, { cacheKey: 'x', cacheHours: 12 });
  ok('nothing unpaid → no call and nothing metered', none.freshAiCall === false && aiCalls.length === 2);
  aiCalls.length = 0;
  await pp.predictInvoicePayments([inv('i1')], projectsById);
  ok('the forecast screen’s own path is unchanged: no cacheKey', aiCalls.length === 1 && !('cacheKey' in aiCalls[0]));
}

console.log('\nintegration review — the background forecast asks the AI allowance first:');
{
  const K = { cacheKey: 'week_close_forecast_K', cacheHours: 12 };
  const run = async (o: { cached: boolean; allowed: boolean; fromCache?: boolean; allowThrows?: boolean }) => {
    aiCalls.length = 0;
    serveFromCache = o.fromCache ?? o.cached;
    const log: string[] = [];
    const res = await pp.predictInvoicePaymentsWithinAllowance([inv('i1')], projectsById, K, {
      isCached: async (k) => { log.push('peek:' + k); return o.cached; },
      allowFresh: async () => { log.push('check'); if (o.allowThrows) throw new Error('x'); return o.allowed; },
      record: async () => { log.push('record'); },
    });
    serveFromCache = false;
    return { res, log, calls: aiCalls.length };
  };
  const refused = await run({ cached: false, allowed: false });
  ok('over the allowance with nothing cached → no AI call, nothing recorded, null (no dates)',
    refused.res === null && refused.calls === 0 && !refused.log.includes('record'),
    JSON.stringify(refused));
  ok('…and the limit was asked BEFORE anything else could spend',
    refused.log.join(',') === 'peek:week_close_forecast_K,check', refused.log.join(','));
  const allowed = await run({ cached: false, allowed: true });
  ok('within the allowance → one fresh call, recorded once',
    allowed.res !== null && allowed.calls === 1 && allowed.log.filter(l => l === 'record').length === 1,
    JSON.stringify(allowed));
  const cachedHit = await run({ cached: true, allowed: false });
  ok('a cached answer is served even over the allowance, never re-asked and never recorded',
    cachedHit.res !== null && !cachedHit.log.includes('check') && !cachedHit.log.includes('record'),
    JSON.stringify(cachedHit));
  const throws = await run({ cached: false, allowed: true, allowThrows: true });
  ok('a limit read that throws does not spend (background work, when in doubt it waits)',
    throws.res === null && throws.calls === 0, JSON.stringify(throws));
}

console.log('\n#116 — the Friday Close wiring:');
{
  const hook = read('hooks/useWeekClose.ts');
  ok('the forecast is no longer inside the array-identity effect',
    !/predictInvoicePayments\(invoices, projectsById\)/.test(hook)
      && /\}, \[enabled, projects, refreshKey, queryClient, userId\]\);/.test(hook));
  ok('…it is one query keyed on the fingerprint, shared by Home and /week-close',
    /queryKey: \['weekClosePaymentForecast', userId, forecastKey\]/.test(hook)
      && /paymentForecastFingerprint\(invoices, projectsById, userId,/.test(hook));
  ok('…fresh for 12 h, never retried (a retry is another charge)',
    /staleTime: 12 \* 60 \* 60 \* 1000/.test(hook) && /retry: false/.test(hook));
  ok('…enabled only with something past due',
    /enabled: enabled && forecastKey !== null && hasOverdue,/.test(hook));
  ok('…the same fingerprint is mageAI’s cacheKey',
    /cacheKey: `week_close_forecast_\$\{forecastKey\}`/.test(hook));
  ok('…and a fresh call is recorded on the app’s AI meter, after the allowance was asked',
    /return predictInvoicePaymentsWithinAllowance\(inv, byId, \{/.test(hook)
      && /isCached: hasCachedMageAIResult,/.test(hook)
      && /allowFresh: async \(\) => \(await checkAILimit\(tierNow, 'smart', 'invoicePrediction'\)\)\.allowed,/.test(hook)
      && /record: \(\) => recordAIUsage\('smart', 'invoicePrediction'\),/.test(hook)
      && !/predictInvoicePaymentsCached\(/.test(hook),
    'the hook must go through predictInvoicePaymentsWithinAllowance — a direct predictInvoicePaymentsCached call spends without asking');
  ok('…the query reads its inputs through a ref, not a closure over a new array',
    /const \{ invoices: inv, projectsById: byId, subscriptionTier: tierNow \} = forecastInputsRef\.current;/.test(hook));

  const card = read('components/home/WeekCloseCard.tsx');
  ok('the Home card assembles the close only when it will render',
    /const cardWillRender = gated && isFridayWindow\(\) && seenThisWeek === false;/.test(card)
      && /useWeekClose\(\{ enabled: cardWillRender && homeFocused \}\)/.test(card)
      && /if \(!cardWillRender\) return null;/.test(card));
  ok('…and not while another screen (e.g. /week-close) is on top of Home',
    /setHomeFocused\(true\);/.test(card) && /setHomeFocused\(false\);/.test(card));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
