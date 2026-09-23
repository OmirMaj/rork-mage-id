// validate-w5-photo-ai-errors.ts — wave 5, lane photo-ai: audit #124 + #68
// (an AI edge refusal shows the server's sentence, not "Edge Function returned
// a non-2xx status code"; a 5xx is retried from the STATUS) and #39 (a takeoff
// or spec-book import checks the month's drawing analyses before any upload).
//
// Runs the real utils (edgeError, invokeWithTimeout, photoAnalyzer,
// takeoffAnalyzer, drawingAnalyzer, specMatcher, quotaPrecheck) against a
// stubbed supabase client and alert (Bun.plugin), with fake FunctionsHttpErrors
// shaped like supabase-js's: `{ message, context: Response-like }` whose body
// can be read ONCE. Then pins the screens' wiring by source.
//
// Run: bun run scripts/validate-w5-photo-ai-errors.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.info('  ✓', name); }
  else { fail++; console.info('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n');
}
/** The body of `const <name> = useCallback(async (...) => { … }` up to the next top-level const. */
function callbackBody(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = useCallback(`);
  if (start < 0) return '';
  const next = src.indexOf('\n  const ', start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}

// ── stubs ────────────────────────────────────────────────────────────────
type InvokeReply = { data: unknown; error: unknown };
let invokeCalls: { fn: string; body: unknown }[] = [];
let invokeQueue: (() => InvokeReply)[] = [];
const alerts: { title: string; body: string; buttons: { text: string; onPress?: () => void }[] }[] = [];
const pushes: string[] = [];

interface VirtualModuleBuilder {
  module(specifier: string, cb: () => { exports: Record<string, unknown>; loader: 'object' }): void;
}
interface BunGlobal { plugin(def: { name: string; setup: (build: VirtualModuleBuilder) => void }): void }
const bun = (globalThis as unknown as { Bun?: BunGlobal }).Bun;
if (!bun) { console.error('\n✗ must run under bun (Bun.plugin stubs the native modules)\n'); process.exit(1); }
bun.plugin({
  name: 'stub-native-for-photo-ai',
  setup(build) {
    build.module('@/lib/supabase', () => ({
      exports: {
        supabase: {
          functions: {
            invoke: async (fn: string, opts: { body?: unknown }) => {
              invokeCalls.push({ fn, body: opts?.body });
              const next = invokeQueue.shift();
              return next ? next() : { data: null, error: { message: 'no reply queued' } };
            },
          },
          auth: { getSession: async () => ({ data: { session: null } }) },
        },
        isSupabaseConfigured: true,
      },
      loader: 'object',
    }));
    build.module('react-native', () => ({ exports: { Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios } }, loader: 'object' }));
    build.module('expo-file-system/legacy', () => ({ exports: { readAsStringAsync: async () => '' }, loader: 'object' }));
    build.module('@/utils/alert', () => ({
      exports: {
        showAlert: (title: string, body: string, buttons: { text: string; onPress?: () => void }[] = [], opts?: { onDismiss?: () => void }) => {
          alerts.push({ title, body, buttons });
          void opts;
        },
      },
      loader: 'object',
    }));
  },
});

/** A supabase-js FunctionsHttpError: the Response body can be read ONCE. */
function httpError(status: number, body: unknown) {
  let reads = 0;
  return {
    message: 'Edge Function returned a non-2xx status code',
    context: {
      status,
      json: async () => {
        reads++;
        if (reads > 1) throw new TypeError('Body already used');
        return body;
      },
    },
    get reads() { return reads; },
  };
}

const edge = await import('../utils/edgeError');
const { triagePhotos } = await import('../utils/photoAnalyzer');
const { analyzeTakeoff } = await import('../utils/takeoffAnalyzer');
const { analyzeDrawings } = await import('../utils/drawingAnalyzer');
const { analyzeSpecBook, extractSubmittalsFromSpecBook } = await import('../utils/specMatcher');
const qp = await import('../utils/quotaPrecheck');
const { nextAiResetLabel } = await import('../utils/aiRateLimiterCore');

const CAP_SENTENCE = 'Monthly photo-analysis limit reached (50 on pro). Resets on the 1st.';
const router = { push: (p: string) => { pushes.push(p); } } as unknown as Parameters<typeof qp.showAiRefusal>[1];

// ── A. utils/edgeError ───────────────────────────────────────────────────
console.info('\nA. edgeError reads the server sentence once; status without the body');
{
  const e = httpError(429, { error: CAP_SENTENCE, code: 'monthly_cap_reached' });
  const info = await edge.readEdgeError(e, 'fallback');
  ok('readEdgeError with a fake { context: { status: 429, json } } → the server sentence', info.message === CAP_SENTENCE, info.message);
  ok('…and its code', info.code === 'monthly_cap_reached');
  const e2 = httpError(502, 'not json');
  ok('edgeErrorStatus reads 502 without touching the body', edge.edgeErrorStatus(e2) === 502 && e2.reads === 0);
  ok('edgeErrorStatus is null for a timeout (no context)', edge.edgeErrorStatus({ message: 'Took too long — try again.' }) === null);
  ok('edgeErrorStatus is null for nothing', edge.edgeErrorStatus(null) === null);
  const err = Object.assign(new Error('x'), { code: 'monthly_cap_reached' });
  ok('aiRefusalKind: monthly_cap_reached → plan', edge.aiRefusalKind(err) === 'plan');
  ok('aiRefusalKind: tier_required → plan', edge.aiRefusalKind(Object.assign(new Error('x'), { code: 'tier_required' })) === 'plan');
  ok('aiRefusalKind: hourly_limit → hourly', edge.aiRefusalKind(Object.assign(new Error('x'), { code: 'hourly_limit' })) === 'hourly');
  ok('aiRefusalKind: http_502 / none → null', edge.aiRefusalKind(Object.assign(new Error('x'), { code: 'http_502' })) === null && edge.aiRefusalKind(new Error('x')) === null);
}

// ── B. photoAnalyzer: #68 transient from STATUS, sentence on failure ─────
console.info('\nB. photoAnalyzer — a 5xx retries once, a cap does not, the sentence reaches the screen');
const URLS = { photoUrls: ['https://x.supabase.co/storage/v1/object/sign/a.jpg?token=1'] };
{
  invokeCalls = [];
  const cap = httpError(429, { error: CAP_SENTENCE, code: 'monthly_cap_reached' });
  invokeQueue = [() => ({ data: null, error: cap })];
  let thrown: unknown = null;
  try { await triagePhotos(URLS); } catch (e) { thrown = e; }
  // w5-join-screens (#123/#128, ai-limits handoff): edgeFunctionError now
  // rewrites "Resets on the 1st." to the real local moment ("Resets Sep 30,
  // 8:00 PM."), so the sentence is the server's up to its reset clause.
  const capHead = CAP_SENTENCE.replace(/\s*Resets (?:on )?the 1st[^.]*\.?$/i, '');
  ok('a 429 cap throws the server sentence, not "Edge Function returned a non-2xx status code"',
    typeof (thrown as Error)?.message === 'string' && (thrown as Error).message.startsWith(capHead)
    && !/the 1st/i.test((thrown as Error).message) && !/non-2xx/.test((thrown as Error).message), String((thrown as Error)?.message));
  ok('…with code monthly_cap_reached', edge.edgeErrorCode(thrown) === 'monthly_cap_reached');
  ok('…and no "Photo analyzer call failed:" prefix', !/call failed/i.test(String((thrown as Error)?.message)));
  ok('a 429 is NOT retried (one call)', invokeCalls.length === 1, String(invokeCalls.length));
  ok('the body was read exactly once', cap.reads === 1, String(cap.reads));
}
{
  invokeCalls = [];
  const bad = httpError(502, { error: 'Upstream model error', code: 'upstream_error' });
  invokeQueue = [
    () => ({ data: null, error: bad }),
    () => ({ data: { success: true, data: { entries: [{ photoIndex: 0, classification: 'punch', confidence: 0.9, title: 't', location: '', trade: '', priority: 'low', rationale: '' }] } }, error: null }),
  ];
  let r: Awaited<ReturnType<typeof triagePhotos>> | null = null;
  let thrown: unknown = null;
  try { r = await triagePhotos(URLS); } catch (e) { thrown = e; }
  ok('a 502 is retried once and the retry’s result is returned', invokeCalls.length === 2 && r?.entries.length === 1,
    `${invokeCalls.length} call(s); ${(thrown as Error)?.message ?? ''}`);
  ok('the retry decision did not consume the 502 body', bad.reads === 0, String(bad.reads));
}
{
  invokeCalls = [];
  const bad1 = httpError(503, { error: 'Service unavailable', code: 'upstream_error' });
  const bad2 = httpError(504, { error: 'The model took too long.', code: 'upstream_timeout' });
  invokeQueue = [() => ({ data: null, error: bad1 }), () => ({ data: null, error: bad2 })];
  let thrown: unknown = null;
  try { await triagePhotos(URLS); } catch (e) { thrown = e; }
  ok('two 5xx: exactly one retry, then the SECOND answer’s sentence', invokeCalls.length === 2 && (thrown as Error)?.message === 'The model took too long.', `${invokeCalls.length} ${(thrown as Error)?.message}`);
}
{
  invokeCalls = [];
  invokeQueue = [() => ({ data: null, error: { message: 'Took too long — try again.' } })];
  let thrown: unknown = null;
  try { await triagePhotos(URLS); } catch (e) { thrown = e; }
  ok('the invokeWithTimeout timeout (no context) is not retried', invokeCalls.length === 1);
  ok('…and keeps its own sentence', (thrown as Error)?.message === 'Took too long — try again.', String((thrown as Error)?.message));
}

// ── C. the other callers route through edgeFunctionError ─────────────────
console.info('\nC. takeoff / drawing / spec-book callers carry the sentence and code');
const DRAW_SENTENCE = 'Monthly drawing-analysis limit reached (15 on pro). Resets on the 1st.';
for (const [name, run] of [
  ['analyzeTakeoff', () => analyzeTakeoff({ pagePaths: ['p/1.png'] })],
  ['analyzeDrawings', () => analyzeDrawings({ pagePaths: ['p/1.png'] } as Parameters<typeof analyzeDrawings>[0])],
  ['analyzeSpecBook', () => analyzeSpecBook({ pagePaths: ['p/1.png'] } as Parameters<typeof analyzeSpecBook>[0])],
  ['extractSubmittalsFromSpecBook', () => extractSubmittalsFromSpecBook({ pagePaths: ['p/1.png'] } as Parameters<typeof extractSubmittalsFromSpecBook>[0])],
] as const) {
  invokeQueue = [() => ({ data: null, error: httpError(429, { error: DRAW_SENTENCE, code: 'monthly_cap_reached' }) })];
  let thrown: unknown = null;
  try { await (run as () => Promise<unknown>)(); } catch (e) { thrown = e; }
  // (reset clause localized by edgeFunctionError — see section B)
  ok(`${name}: the server sentence, code monthly_cap_reached`,
    typeof (thrown as Error)?.message === 'string'
    && (thrown as Error).message.startsWith(DRAW_SENTENCE.replace(/\s*Resets on the 1st\.$/, ''))
    && !/the 1st/i.test((thrown as Error).message)
    && edge.edgeErrorCode(thrown) === 'monthly_cap_reached',
    `${(thrown as Error)?.message} / ${edge.edgeErrorCode(thrown)}`);
}
{
  invokeQueue = [() => ({ data: null, error: httpError(403, { error: 'AI Takeoff is a Pro feature.', code: 'tier_required' }) })];
  let thrown: unknown = null;
  try { await analyzeTakeoff({ pagePaths: ['p/1.png'] }); } catch (e) { thrown = e; }
  ok('a tier refusal carries tier_required', edge.edgeErrorCode(thrown) === 'tier_required');
  invokeQueue = [() => ({ data: null, error: httpError(500, '<html>') })];
  try { await analyzeTakeoff({ pagePaths: ['p/1.png'] }); } catch (e) { thrown = e; }
  ok('a non-JSON 500 reads "Takeoff failed (HTTP 500)"', (thrown as Error)?.message === 'Takeoff failed (HTTP 500)', String((thrown as Error)?.message));
}

// ── D. #39 the drawing-analysis precheck ─────────────────────────────────
console.info('\nD. quotaPrecheck — drawing analyses checked before any upload');
const LABEL = nextAiResetLabel().monthly;
{
  ok('no bucket (usage read failed) → no refusal (server stays the gate)', qp.drawingAnalysesRefusal(null, LABEL) === null);
  ok('one left → no refusal', qp.drawingAnalysesRefusal({ used: 14, cap: 15, remaining: 1 }, LABEL) === null);
  const spent = qp.drawingAnalysesRefusal({ used: 15, cap: 15, remaining: 0 }, 'Resets Sep 30, 8:00 PM');
  ok('spent → a refusal naming the cap', !!spent && /all 15 drawing analyses/.test(spent.body), spent?.body);
  ok('…and every tool that shares it', !!spent && /takeoffs/.test(spent.body) && /spec-book imports/.test(spent.body) && /Compare Drawings/.test(spent.body) && /drawing analyzer/.test(spent.body));
  ok('…with the REAL reset, not "the 1st"', !!spent && /Resets Sep 30, 8:00 PM\./.test(spent.body) && !/the 1st/.test(spent.body));
  ok('…and that nothing was uploaded or charged', !!spent && /Nothing was uploaded/.test(spent.body));
  const none = qp.drawingAnalysesRefusal({ used: 0, cap: 0, remaining: 0 }, LABEL);
  ok('cap 0 → "not on your plan", never "all 0"', !!none && !/all 0/.test(none.body) && /isn’t on your plan/.test(none.title));
}
{
  alerts.length = 0; pushes.length = 0;
  invokeQueue = [() => ({ data: { tier: 'pro', features: { takeoff_pages: { used: 0, cap: 30, remaining: 30 }, analyze_drawings: { used: 15, cap: 15, remaining: 0 } } }, error: null })];
  const p = qp.confirmDrawingAnalysesLeft(router);
  await new Promise(r => setTimeout(r, 0));
  ok('confirmDrawingAnalysesLeft blocks with a dialog when the bucket is spent', alerts.length === 1 && /No drawing analyses left/.test(alerts[0]?.title ?? ''), alerts[0]?.title);
  const seePlans = alerts[0]?.buttons.find(b => /See plans|Upgrade/.test(b.text));
  ok('…offering See plans and Cancel, never "proceed"', !!seePlans && alerts[0].buttons.some(b => b.text === 'Cancel') && !alerts[0].buttons.some(b => /proceed|anyway|continue/i.test(b.text)));
  seePlans?.onPress?.();
  ok('See plans routes to /paywall and resolves false', (await p) === false && pushes.includes('/paywall'));
  alerts.length = 0;
  invokeQueue = [() => ({ data: { tier: 'pro', features: { analyze_drawings: { used: 3, cap: 15, remaining: 12 } } }, error: null })];
  ok('with analyses left it resolves true silently', (await qp.confirmDrawingAnalysesLeft(router)) === true && alerts.length === 0);
  invokeQueue = [() => ({ data: null, error: { message: 'offline' } })];
  ok('a failed usage read does not block (server is the authoritative gate)', (await qp.confirmDrawingAnalysesLeft(router)) === true && alerts.length === 0);
  // confirmQuotaFits still reads takeoff_pages from the same response.
  invokeQueue = [() => ({ data: { tier: 'pro', features: { takeoff_pages: { used: 25, cap: 30, remaining: 5 }, analyze_drawings: { used: 0, cap: 15, remaining: 15 } } }, error: null })];
  const fits = qp.confirmQuotaFits(10, 'plans.pdf', router);
  await new Promise(r => setTimeout(r, 0));
  ok('confirmQuotaFits still refuses 10 pages with 5 left', alerts.length === 1 && /won't fit/.test(alerts[0]?.title ?? ''), alerts[0]?.title);
  alerts[0]?.buttons.find(b => b.text === 'Cancel')?.onPress?.();
  ok('…and resolves false on Cancel', (await fits) === false);
}

// ── E. showAiRefusal — CONTRACT 26's screen half ─────────────────────────
console.info('\nE. showAiRefusal');
{
  alerts.length = 0; pushes.length = 0;
  const capErr = Object.assign(new Error(CAP_SENTENCE), { code: 'monthly_cap_reached' });
  const shown = qp.showAiRefusal(capErr, router);
  ok('a monthly cap returns the sentence with the REAL reset', shown === `Monthly photo-analysis limit reached (50 on pro). ${LABEL}.`, String(shown));
  ok('…in a dialog with See plans → /paywall and no "try again"',
    alerts.length === 1 && alerts[0].buttons.some(b => b.text === 'See plans') && !alerts[0].buttons.some(b => /try again|retry/i.test(b.text)));
  alerts[0]?.buttons.find(b => b.text === 'See plans')?.onPress?.();
  ok('See plans pushes /paywall', pushes.includes('/paywall'));
  alerts.length = 0;
  const tierErr = Object.assign(new Error('Photo Triage is part of Pro.'), { code: 'tier_required' });
  qp.showAiRefusal(tierErr, router);
  ok('a tier refusal is titled as the plan, not a limit', alerts[0]?.title === 'Not included in your plan', alerts[0]?.title);
  alerts.length = 0;
  const hourly = Object.assign(new Error('Hourly limit reached (20 per hour). Try again in an hour.'), { code: 'hourly_limit' });
  ok('hourly: the server sentence as-is, no dialog', qp.showAiRefusal(hourly, router) === 'Hourly limit reached (20 per hour). Try again in an hour.' && alerts.length === 0);
  ok('anything else: null (the screen’s own handling)', qp.showAiRefusal(new Error('network'), router) === null && qp.showAiRefusal(Object.assign(new Error('x'), { code: 'http_502' }), router) === null);
  ok('withRealMonthlyReset leaves a sentence with no reset untouched', qp.withRealMonthlyReset('Hourly limit reached.', 'Resets Sep 30') === 'Hourly limit reached.');
}

// ── F. source pins: no raw error.message thrown; screens branch ───────────
console.info('\nF. wiring');
for (const f of ['utils/photoAnalyzer.ts', 'utils/takeoffAnalyzer.ts', 'utils/drawingAnalyzer.ts', 'utils/specMatcher.ts', 'app/schedule-import.tsx']) {
  const src = code(read(f));
  ok(`${f}: no edge error.message thrown raw`, !/throw new Error\([^)]*error\.message/.test(src));
  ok(`${f}: routes through edgeFunctionError`, /throw await edgeFunctionError\(/.test(src));
}
{
  const pa = code(read('utils/photoAnalyzer.ts'));
  ok('photoAnalyzer: no 5xx regex on the message', !/\/5\\d\\d\//.test(pa));
  ok('photoAnalyzer: transient from edgeErrorStatus(error) >= 500', /edgeErrorStatus\(error\)/.test(pa) && />= 500/.test(pa));
  const inv = read('utils/invokeWithTimeout.ts');
  ok('InvokeResult.error carries context (CONTRACT 10)', /error: \{ message: string; context\?: unknown \} \| null/.test(inv));
}
for (const f of ['app/photo-triage.tsx', 'app/ai-punch.tsx', 'app/takeoff.tsx', 'app/extract-submittals.tsx', 'app/schedule-import.tsx']) {
  ok(`${f}: branches on the refusal (showAiRefusal)`, /showAiRefusal\(/.test(code(read(f))));
}
{
  const t = code(read('app/takeoff.tsx'));
  const pick = callbackBody(t, 'handlePick');
  ok('takeoff handlePick: drawing analyses checked BEFORE the picker',
    pick.indexOf('confirmDrawingAnalysesLeft(') > -1 && pick.indexOf('confirmDrawingAnalysesLeft(') < pick.indexOf('DocumentPicker.getDocumentAsync'));
  const spec = callbackBody(t, 'handleMatchSpecs');
  ok('takeoff handleMatchSpecs: checked BEFORE the picker',
    spec.indexOf('confirmDrawingAnalysesLeft(') > -1 && spec.indexOf('confirmDrawingAnalysesLeft(') < spec.indexOf('DocumentPicker.getDocumentAsync'));
  const retry = callbackBody(t, 'handleRetryAnalysis');
  ok('Retry analysis re-reads kept pages: analyze only, no upload / render',
    /analyzePages\(kept\)/.test(retry) && !/uploadAndRenderPdf/.test(retry));
  ok('a failed analyze keeps the rendered pages (failRun(e, rendered))', /failRun\(e, rendered\)/.test(pick) && /setRetryPages\(rendered\)/.test(t));
  ok('the Retry analysis control is rendered', /Retry analysis/.test(t) && /onPress=\{handleRetryAnalysis\}/.test(t));
  const x = code(read('app/extract-submittals.tsx'));
  const first = callbackBody(x, 'handlePickAndAnalyze');
  ok('spec-book import: drawing analyses checked BEFORE the picker',
    first.indexOf('confirmDrawingAnalysesLeft(') > -1 && first.indexOf('confirmDrawingAnalysesLeft(') < first.indexOf('DocumentPicker.getDocumentAsync'));
  ok('spec-book next pass: checked before runPass', /confirmDrawingAnalysesLeft\(router\)[\s\S]{0,400}runPass\(book, nextPage\)/.test(callbackBody(x, 'handleNextPass')));
  ok('plans.tsx does not get the drawing-analysis check (it never calls analyze-takeoff)', !/confirmDrawingAnalysesLeft/.test(read('app/plans.tsx')));
}

console.info(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
