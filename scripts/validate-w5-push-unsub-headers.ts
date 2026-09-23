// scripts/validate-w5-push-unsub-headers.ts — wave 5, lane push-unsub:
// Gmail's / Apple Mail's one-click Unsubscribe reaches something that records it.
//
//   #45 / #76  The List-Unsubscribe HEADER used to carry the static
//              mageid.app/unsubscribe page URL. RFC 8058 clients POST
//              `List-Unsubscribe=One-Click` to that URL; the page is a GET-only
//              Netlify rewrite, so the POST 404'd, no email_unsubscribes row was
//              written and the mail kept coming while the mail app said
//              "unsubscribed". The header now points at the unsubscribe edge
//              function; the FOOTER keeps the page (a person needs the confirm).
//
// Executed, not grepped, where it can be: _shared/email.ts is imported under a
// Deno.env shim and its builders and resendSend (against a stubbed fetch) run
// here. The send-email and unsubscribe function checks are source pins — both
// import Deno-only std modules.
//
// Run: bun run scripts/validate-w5-push-unsub-headers.ts

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.info('  ✓', name); }
  else { fail++; console.error('  ✗', name, detail ? `— ${detail}` : ''); }
}

type Unsub = { recipientEmail?: string; eventKey?: string; enabled?: boolean };
// Typed by hand: `typeof import(...)` would pull the Deno module into the app's
// tsc program (it has no Deno types).
type EmailMod = {
  buildOneClickUnsubscribeUrl(o: Unsub): string | null;
  buildUnsubscribeUrl(o: Unsub): string | null;
  buildListUnsubscribeHeaders(o: Unsub | null | undefined): Record<string, string>;
  verifyUnsubscribeToken(email: string, token: string): boolean;
  wrapEmailHtml(o: { preheader: string; title: string; bodyHtml: string; unsubscribe?: Unsub }): string;
  resendSend(apiKey: string, o: { to: string; subject: string; html: string; unsubscribe?: Unsub }): Promise<{ ok: boolean; resp: unknown }>;
  buildUnsubscribeToken(email: string): string;
  TRANSACTIONAL_DOCUMENT_KEYS: readonly string[];
  isTransactionalDocumentKey(k: string | null | undefined): boolean;
  UNSUBSCRIBE_PAGE_URL: string;
};

const FUNCTIONS_HOST = 'nteoqhcswappxxjlpvap.supabase.co';
const env: Record<string, string | undefined> = {
  UNSUB_SECRET: 'validate-w5-push-unsub-secret',
  SUPABASE_URL: `https://${FUNCTIONS_HOST}`,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-the-validator-only',
  SUPABASE_ANON_KEY: 'anon-key-for-the-validator-only-000',
  RESEND_API_KEY: 're_validator',
};
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] } };
// Variable specifier: tsc must not pull the Deno module into the app program.
const emailModPath = '../supabase/functions/_shared/email';
const mod = await import(emailModPath) as EmailMod;

const u = { recipientEmail: 'Dana@Example.com', eventKey: 'portal_message', enabled: true };

// ── the one-click URL is the function ────────────────────────────────────────
{
  const oneClick = mod.buildOneClickUnsubscribeUrl(u);
  const page = mod.buildUnsubscribeUrl(u);
  ok('one-click URL is built', typeof oneClick === 'string' && !!oneClick);
  const a = new URL(oneClick ?? 'http://x/');
  const b = new URL(page ?? 'http://x/');
  ok('the List-Unsubscribe URL host is the Supabase functions host', a.host === FUNCTIONS_HOST, a.host);
  ok('…and its path is the unsubscribe function', a.pathname === '/functions/v1/unsubscribe', a.pathname);
  ok('the footer URL is still the mageid.app confirmation page', b.host === 'mageid.app' && b.pathname === '/unsubscribe', `${b.host}${b.pathname}`);
  ok('both carry the same e / k / t (one set of params, two destinations)',
    ['e', 'k', 't'].every((p) => a.searchParams.get(p) === b.searchParams.get(p) && !!a.searchParams.get(p)),
    `${a.search} vs ${b.search}`);
  ok('the token in the one-click URL verifies for the recipient',
    mod.verifyUnsubscribeToken('dana@example.com', a.searchParams.get('t') ?? ''));
  ok('no key → no k (a global unsubscribe), same as the page',
    !new URL(mod.buildOneClickUnsubscribeUrl({ recipientEmail: 'x@y.com' }) ?? 'http://x/').searchParams.has('k'));
  ok('same guards: not unsubscribable → null',
    mod.buildOneClickUnsubscribeUrl({ ...u, enabled: false }) === null
    && mod.buildOneClickUnsubscribeUrl({ eventKey: 'x' }) === null);

  env.SUPABASE_URL = undefined;
  const fallback = new URL(mod.buildOneClickUnsubscribeUrl(u) ?? 'http://x/');
  ok('SUPABASE_URL unset → still the production functions host', fallback.host === FUNCTIONS_HOST, fallback.host);
  env.SUPABASE_URL = '';
  const empty = mod.buildOneClickUnsubscribeUrl(u) ?? '';
  ok('SUPABASE_URL empty → never a relative "/functions/v1/…" header', empty.startsWith(`https://${FUNCTIONS_HOST}/functions/v1/unsubscribe?`), empty);
  env.SUPABASE_URL = `https://${FUNCTIONS_HOST}/`;
  ok('a trailing slash on SUPABASE_URL does not double up', (mod.buildOneClickUnsubscribeUrl(u) ?? '').includes(`${FUNCTIONS_HOST}/functions/v1/unsubscribe?`));
  env.SUPABASE_URL = `https://${FUNCTIONS_HOST}`;
}

// ── the header pair ──────────────────────────────────────────────────────────
{
  const h = mod.buildListUnsubscribeHeaders(u);
  ok('List-Unsubscribe is exactly <one-click URL>', h['List-Unsubscribe'] === `<${mod.buildOneClickUnsubscribeUrl(u)}>`, h['List-Unsubscribe']);
  ok('List-Unsubscribe-Post is the RFC 8058 value', h['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click');
  ok('no mailto: entry (nothing reads unsubscribe@mageid.app)', !/mailto:/i.test(h['List-Unsubscribe'] ?? ''));
  ok('not unsubscribable → no headers at all',
    Object.keys(mod.buildListUnsubscribeHeaders({ ...u, enabled: false })).length === 0
    && Object.keys(mod.buildListUnsubscribeHeaders(undefined)).length === 0);
}

// ── resendSend actually sends that header (stubbed fetch) ────────────────────
{
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ id: 'r1' }), { status: 200 });
  }) as typeof fetch;
  try {
    const html = mod.wrapEmailHtml({ preheader: 'p', title: 't', bodyHtml: '<p>b</p>', unsubscribe: u });
    const r = await mod.resendSend('re_test', { to: 'dana@example.com', subject: 's', html, unsubscribe: u });
    ok('resendSend succeeds against the stub', r.ok === true && sent.length === 1);
    const headers = (sent[0]?.body.headers ?? {}) as Record<string, string>;
    const hdr = /^<([^>]+)>$/.exec(headers['List-Unsubscribe'] ?? '')?.[1] ?? '';
    ok('resendSend: the List-Unsubscribe header host is the functions host (not mageid.app)',
      hdr !== '' && new URL(hdr).host === FUNCTIONS_HOST, headers['List-Unsubscribe']);
    ok('resendSend: List-Unsubscribe-Post is set', headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click');
    ok('the email BODY links the confirmation page, not the function',
      html.includes('https://mageid.app/unsubscribe?') && !html.includes('/functions/v1/unsubscribe'));
    const r2 = await mod.resendSend('re_test', { to: 'dana@example.com', subject: 's', html: '<p>x</p>', unsubscribe: { ...u, enabled: false } });
    const h2 = (sent[1]?.body.headers ?? {}) as Record<string, string>;
    ok('a non-unsubscribable send carries no List-Unsubscribe', r2.ok && !('List-Unsubscribe' in h2));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ── one builder for every send path ──────────────────────────────────────────
{
  const sendEmail = stripComments(read('supabase/functions/send-email/index.ts'));
  ok('send-email\'s attachment path takes its headers from buildListUnsubscribeHeaders(u)',
    /Object\.assign\(unsubHeaders, buildListUnsubscribeHeaders\(u\)\)/.test(sendEmail));
  ok('send-email offers one-click only for a named, non-document key, on both paths',
    /const oneClickKey = body\.unsubscribe\?\.eventKey;/.test(sendEmail)
    && /const oneClickOffered = body\.unsubscribe\?\.enabled !== false\s*&& typeof oneClickKey === 'string' && oneClickKey\.trim\(\)\.length > 0\s*&& !isTransactionalDocumentKey\(oneClickKey\);/.test(sendEmail)
    && /if \(oneClickOffered\) \{/.test(sendEmail) && /unsubscribe: !oneClickOffered \? undefined :/.test(sendEmail));
  ok('send-email builds no List-Unsubscribe string of its own', !/'List-Unsubscribe'/.test(sendEmail));
  ok('send-email still pins the unsubscribe recipient to `to` (B1)', /const u = \{ eventKey: body\.unsubscribe\?\.eventKey, recipientEmail: to \};/.test(sendEmail));

  // Sweep: the header literal is built in exactly one place.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(join(ROOT, dir))) {
      const p = `${dir}/${f}`;
      if (statSync(join(ROOT, p)).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) files.push(p);
    }
  };
  walk('supabase/functions');
  const builders = files.filter((f) => /\[\s*'List-Unsubscribe'\s*\]\s*=|'List-Unsubscribe'\s*:/.test(stripComments(read(f))));
  ok('only _shared/email.ts writes a List-Unsubscribe header', builders.length === 1 && builders[0] === 'supabase/functions/_shared/email.ts', builders.join(', '));
  const mailto = files.filter((f) => /mailto:unsubscribe@mageid\.app/.test(stripComments(read(f))));
  ok('no function advertises the dead mailto:unsubscribe@mageid.app', mailto.length === 0, mailto.join(', '));
}

// ── the function honours the one-click POST ──────────────────────────────────
{
  const unsub = read('supabase/functions/unsubscribe/index.ts');
  const code = stripComments(unsub);
  ok('the misleading "same URL" comment is gone', !/We accept it on the same URL/.test(unsub));
  ok('its header comment says the List-Unsubscribe header points at the function',
    /List-Unsubscribe HEADER points HERE/.test(unsub));
  ok('a form-encoded One-Click POST is recorded as list_unsubscribe_one_click',
    /ct\.includes\('application\/x-www-form-urlencoded'\)/.test(code)
    && /List-Unsubscribe=One-Click/.test(code) && /source = 'list_unsubscribe_one_click'/.test(code));
  ok('the one-click POST still reads e / k / t from the query', /normalizeEmail\(url\.searchParams\.get\('e'\)\)/.test(code)
    && /let token: string \| null = url\.searchParams\.get\('t'\)/.test(code));
  ok('unsubscribe still requires the signed token on POST', /if \(!currentToken && !legacyToken\) \{\s*return jsonResponse\(\{ ok: false, error: 'token_invalid' \}, 400\);/.test(code));
  // The list-all read (preferences page catch-all) is token-gated with the
  // CURRENT token only — the legacy token is for the unsubscribe direction.
  const listAt = code.indexOf("if (url.searchParams.get('list') === '1') {");
  const listBlock = listAt >= 0 ? code.slice(listAt, code.indexOf('return jsonResponse({ ok: true, suppressed', listAt)) : '';
  ok('list=1 verifies the signed token before reading', /if \(!token \|\| !verifyUnsubscribeToken\(email, token\)\)/.test(listBlock) && !/legacy/i.test(listBlock));
  const cfg = read('supabase/config.toml');
  ok('unsubscribe runs with verify_jwt = false (Gmail\'s POST carries no JWT)', /\[functions\.unsubscribe\]\s*\nverify_jwt\s*=\s*false/.test(cfg));
}

// ── the two functions, executed (Bun.plugin stubs std's serve) ───────────────
// serve() is captured instead of listening; fetch is a router that answers the
// auth / rate-limit / profile / RPC calls and records what reaches Resend and
// email_unsubscribes.
type Handler = (r: Request) => Promise<Response>;
const handlers: Handler[] = [];
interface VirtualModuleBuilder { module(specifier: string, cb: () => { exports: Record<string, unknown>; loader: 'object' }): void }
const bun = (globalThis as unknown as { Bun?: { plugin(def: { name: string; setup: (b: VirtualModuleBuilder) => void }): void } }).Bun;
if (!bun) { console.error('\n✗ must run under bun (Bun.plugin stubs std/http/server.ts)\n'); process.exit(1); }
bun.plugin({
  name: 'stub-deno-std-serve',
  setup(b) {
    b.module('https://deno.land/std@0.177.0/http/server.ts', () => ({
      exports: { serve: (h: Handler) => { handlers.push(h); } }, loader: 'object',
    }));
  },
});
type Hit = { url: string; method: string; headers: Record<string, string>; body: string };
const hits: Hit[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const headers = Object.fromEntries(new Headers(init?.headers ?? {}).entries());
  hits.push({ url, method: init?.method ?? 'GET', headers, body: String(init?.body ?? '') });
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
  if (url.endsWith('/auth/v1/user')) return json({ id: 'u-gc', email: 'gc@builder.com', role: 'authenticated' });
  if (url.includes('/rpc/rate_limit_increment')) return json(1);
  if (url.includes('/rpc/is_email_unsubscribed')) return json(false);
  if (url.includes('/rest/v1/subscriptions')) return json([{ tier: 'pro', status: 'active' }]);
  if (url.includes('/rest/v1/profiles')) return json([{ company_name: 'Ace Builders', contact_name: null, email: 'gc@builder.com' }]);
  if (url.includes('/rest/v1/email_unsubscribes')) {
    return (init?.method ?? 'GET') === 'GET' ? json([{ event_key: 'punch_ready' }]) : new Response(null, { status: 201 });
  }
  if (url.startsWith('https://api.resend.com/emails')) return json({ id: 'r-1' });
  return json([]);
}) as typeof fetch;
const fnPath = (n: string) => `../supabase/functions/${n}/index.ts`;
await import(fnPath('send-email'));
const sendEmail = handlers[0];
await import(fnPath('unsubscribe'));
const unsubscribeFn = handlers[1];
ok('both functions load under the stub and register a handler', typeof sendEmail === 'function' && typeof unsubscribeFn === 'function');

// ── send-email: no one-click on the GC's own documents ──────────────────────
// Review of #45/#76: send-email checks no suppression, so a working one-click
// on an invoice or estimate is recorded and then ignored — the mail app says
// "unsubscribed" and the invoices keep coming.
{
  ok('TRANSACTIONAL_DOCUMENT_KEYS is the six document kinds the app sends through send-email',
    JSON.stringify([...mod.TRANSACTIONAL_DOCUMENT_KEYS].sort()) === JSON.stringify(['daily_report', 'estimate', 'invoice', 'lien_waiver', 'submittal', 'weekly_update']));
  ok('isTransactionalDocumentKey: documents yes; a notification, nothing, or a lookalike no',
    mod.TRANSACTIONAL_DOCUMENT_KEYS.every((k) => mod.isTransactionalDocumentKey(k))
    && !mod.isTransactionalDocumentKey('portal_message') && !mod.isTransactionalDocumentKey(undefined)
    && !mod.isTransactionalDocumentKey('') && !mod.isTransactionalDocumentKey('invoice_paid'));
  // `unsubscribe` = undefined sends NO unsubscribe block at all (contract,
  // RFI, OAC minutes, last-planner, warranty walk, sub-portal setup,
  // SendPortalLinkModal, get-verified, AuthContext all do that).
  const call = async (eventKey: string | undefined, attachments: boolean, unsubscribe?: Record<string, unknown> | null) => {
    hits.length = 0;
    const body: Record<string, unknown> = {
      to: 'client@home.com', subject: 's', html: '<p>x</p>',
    };
    if (unsubscribe !== null) body.unsubscribe = unsubscribe ?? { eventKey, recipientEmail: 'client@home.com', enabled: true };
    if (attachments) body.attachments = [{ filename: 'a.pdf', content: 'AAAA', contentType: 'application/pdf' }];
    const r = await sendEmail(new Request('https://x/functions/v1/send-email', {
      method: 'POST',
      headers: { Authorization: 'Bearer user-jwt-for-the-validator-0000', apikey: 'anon-key-for-the-validator-only-000', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
    const resend = hits.find((h) => h.url.startsWith('https://api.resend.com/emails'));
    const sentHeaders = (resend ? (JSON.parse(resend.body).headers ?? {}) : {}) as Record<string, string>;
    return { status: r.status, sent: !!resend, sentHeaders };
  };
  for (const k of mod.TRANSACTIONAL_DOCUMENT_KEYS) {
    for (const att of [false, true]) {
      const r = await call(k, att);
      ok(`send-email '${k}' (${att ? 'with' : 'no'} attachment): sent, and NO List-Unsubscribe / -Post`,
        r.status === 200 && r.sent && !('List-Unsubscribe' in r.sentHeaders) && !('List-Unsubscribe-Post' in r.sentHeaders),
        `${r.status} ${JSON.stringify(r.sentHeaders)}`);
    }
  }
  // Review round 3: a keyless one-click writes a GLOBAL suppression row
  // (event_key NULL) that send-email never reads — the contract / RFI keeps
  // coming — while notify's is_email_unsubscribed counts it and stops every
  // notify email to that address (and a GC's digests via the sync trigger).
  const keyless: [string, Record<string, unknown> | null][] = [
    ['no unsubscribe block', null],
    ['{ enabled: true } and no eventKey', { enabled: true }],
    ['{ recipientEmail } and no eventKey', { recipientEmail: 'client@home.com' }],
    ["eventKey ''", { eventKey: '', enabled: true }],
    ["eventKey '   '", { eventKey: '   ', enabled: true }],
  ];
  for (const [label, unsub] of keyless) {
    for (const att of [false, true]) {
      const r = await call(undefined, att, unsub);
      ok(`send-email with ${label} (${att ? 'with' : 'no'} attachment): sent, and NO List-Unsubscribe / -Post`,
        r.status === 200 && r.sent && !('List-Unsubscribe' in r.sentHeaders) && !('List-Unsubscribe-Post' in r.sentHeaders),
        `${r.status} ${JSON.stringify(r.sentHeaders)}`);
    }
  }
  for (const att of [false, true]) {
    const r = await call('portal_message', att);
    const hdr = /^<([^>]+)>$/.exec(r.sentHeaders['List-Unsubscribe'] ?? '')?.[1] ?? '';
    ok(`send-email 'portal_message' (${att ? 'with' : 'no'} attachment): one-click header on the functions host`,
      r.status === 200 && hdr !== '' && new URL(hdr).host === FUNCTIONS_HOST
      && new URL(hdr).searchParams.get('e') === 'client@home.com'
      && r.sentHeaders['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', JSON.stringify(r.sentHeaders));
  }
}

// ── unsubscribe: a browser GET of the header URL lands on the confirm page ──
// Review of #45/#76: a client that doesn't do the RFC 8058 POST opens the
// header URL in a browser; the function answered with JSON and the reader
// stayed subscribed. A GET must never unsubscribe by itself.
{
  const e = 'client@home.com';
  const t = mod.buildUnsubscribeToken(e);
  const get = async (qs: string, accept = '*/*') => {
    hits.length = 0;
    const r = await unsubscribeFn(new Request(`https://${FUNCTIONS_HOST}/functions/v1/unsubscribe?${qs}`, { headers: { accept } }));
    return { r, writes: hits.filter((h) => h.url.includes('email_unsubscribes') && h.method !== 'GET').length, reads: hits.length };
  };
  const headerQs = new URL(mod.buildOneClickUnsubscribeUrl({ recipientEmail: e, eventKey: 'portal_message' }) ?? 'http://x/').search.slice(1);
  const a = await get(headerQs);
  const loc = new URL(a.r.headers.get('location') ?? 'http://x/');
  ok('GET of the header URL (carries t) → 303 to PORTAL_BASE_URL/unsubscribe',
    a.r.status === 303 && `${loc.origin}${loc.pathname}` === mod.UNSUBSCRIBE_PAGE_URL && mod.UNSUBSCRIBE_PAGE_URL === 'https://mageid.app/unsubscribe',
    `${a.r.status} ${loc.href}`);
  ok('…carrying the same e / k / t', loc.searchParams.get('e') === e && loc.searchParams.get('k') === 'portal_message' && loc.searchParams.get('t') === t);
  ok('…and records NOTHING (no write, no read — the redirect comes first)', a.writes === 0 && a.reads === 0, `${a.writes} writes, ${a.reads} calls`);
  const b = await get(`e=${encodeURIComponent(e)}&k=invoice`, 'text/html,application/xhtml+xml');
  ok('a browser GET without a token (Accept: text/html) also goes to the page, no write',
    b.r.status === 303 && (b.r.headers.get('location') ?? '').startsWith('https://mageid.app/unsubscribe?') && b.writes === 0);
  const c = await get(`${headerQs}&next=${encodeURIComponent('https://evil.example/')}`);
  const cl = c.r.headers.get('location') ?? '';
  ok('the Location is built on the fixed host from e / k / t only (no open redirect)',
    cl.startsWith('https://mageid.app/unsubscribe?') && !/evil|next=/.test(cl), cl);
  const d = await get(`e=${encodeURIComponent(e)}&k=punch_ready`);
  ok('the preferences page\'s own fetch (no t, Accept */*) still gets JSON',
    d.r.status === 200 && /application\/json/.test(d.r.headers.get('content-type') ?? '') && (await d.r.json()).unsubscribed === false);
  const f = await get(`e=${encodeURIComponent(e)}&t=${encodeURIComponent(t)}&list=1`);
  ok('list=1 (the preferences page\'s token-carrying fetch) still gets JSON, not a redirect',
    f.r.status === 200 && Array.isArray((await f.r.json()).suppressed));
  // The one-click POST itself still records (the redirect is GET-only).
  hits.length = 0;
  const post = await unsubscribeFn(new Request(`https://${FUNCTIONS_HOST}/functions/v1/unsubscribe?${headerQs}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click',
  }));
  const w = hits.find((h) => h.url.includes('email_unsubscribes') && h.method === 'POST');
  const wb = w ? JSON.parse(w.body) : {};
  ok('the RFC 8058 POST to the header URL records the suppression (source list_unsubscribe_one_click)',
    post.status === 200 && wb.email === e && wb.event_key === 'portal_message' && wb.source === 'list_unsubscribe_one_click', JSON.stringify(wb));
}
globalThis.fetch = realFetch;

console.info(`\n${fail === 0 ? `validate-w5-push-unsub-headers: ${pass} checks passed` : `${fail} of ${pass + fail} checks FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
