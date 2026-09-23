// scripts/validate-w5-benchmark-financing-public.ts — wave 5, benchmark-financing lane.
//
// The public / server half:
//   #174 marketing/costs + public-cost-index — an outage is never shown as
//        the (normal, today permanent) "not published yet" state; only a 200
//        is cached; `updated` is the data's freshness (omitted when there is
//        none), not the request time.
//   #173 the website widget — a malformed email with no phone is caught on the
//        form with the same EMAIL_RE the server runs, the server answers
//        leadError 'invalid_email' and THIS embed goes back to the form (an
//        older cached embed still shows its generic not-sent line until its
//        cache expires); only a failed save says "could not reach".
//   #79/#84 migration 20260923180000 — static shape (the executed half is the
//        PGlite script named in its header, run twice). Round 2: NOTHING is
//        published — both aggregates return zero rows — and no public copy
//        promises a floor, rounding or "never an individual price".
//   #83  the plan-sheets migration left held/ with its body byte-identical and
//        a header naming its apply preconditions; held/README.md says so.
//
// Pure functions are EXECUTED (lifted out of their files and transpiled).
//
// Run via: bun run scripts/validate-w5-benchmark-financing-public.ts

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const read = (p: string) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const sqlCode = (s: string) => s.replace(/--[^\n]*/g, '');

function liftFunction(src: string, name: string): string {
  const m = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!m) return '';
  let j = m.index + m[0].length - 1, paren = 0;
  for (; j < src.length; j++) {
    if (src[j] === '(') paren++;
    else if (src[j] === ')') { paren--; if (paren === 0) break; }
  }
  const open = src.indexOf('{', j);
  let depth = 0;
  for (let p = open; p < src.length; p++) {
    if (src[p] === '{') depth++;
    else if (src[p] === '}') { depth--; if (depth === 0) return src.slice(m.index, p + 1).replace(/^export\s+/, ''); }
  }
  return '';
}
// Bun's global (the repo's tsconfig has no bun types; same declaration as
// validate-ai-failure-copy.ts).
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync(code: string): string };
};
const transpiler = new Bun.Transpiler({ loader: 'ts' });
/**
 * Build `(…params) => <expr>` over the lifted sources, so closures can be
 * injected. A function missing from the file is a FAILED check (the stub
 * answers undefined), not a crash.
 */
function factory<T>(params: string[], sources: string[], expr: string): (...args: unknown[]) => T {
  const stub = (() => (() => undefined)) as unknown as (...args: unknown[]) => T;
  if (sources.some((s) => !s.trim())) { ok(`${expr} exists and can be lifted`, false); return stub; }
  try {
    const js = transpiler.transformSync(`globalThis.__w5bfp = function (${params.join(', ')}) {\n${sources.join('\n\n')}\nreturn (${expr});\n};`);
    new Function(js)();
    return (globalThis as unknown as { __w5bfp: (...a: unknown[]) => T }).__w5bfp;
  } catch (e) {
    ok(`${expr} evaluates`, false, String(e));
    return stub;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// #174 · marketing/costs/index.html
// ════════════════════════════════════════════════════════════════════════════
const page = read('marketing/costs/index.html');
const classify = factory<(ok: boolean, d: unknown) => string>([], [liftFunction(page, 'classifyIndexResponse')], 'classifyIndexResponse')();
ok('a 502 with an error body is an outage, not "not published yet"', classify(false, { error: 'Could not load the index.' }) === 'error');
ok('a 200 carrying an error body is an outage', classify(true, { error: 'x', rows: [] }) === 'error');
ok('a 200 with no rows array (malformed) is an outage', classify(true, {}) === 'error' && classify(true, { rows: 'x' }) === 'error');
ok('an unparseable body is an outage', classify(true, null) === 'error');
ok('ONLY a real rows: [] is "not published yet"', classify(true, { rows: [] }) === 'empty');
ok('rows render as the index', classify(true, { rows: [{ category: 'framing' }] }) === 'rows');
{
  const js = page.slice(page.indexOf('fetch(API)'));
  ok('the page checks r.ok before trusting the body (no bare r.json() → rows)',
    !/\.then\(function \(r\) \{ return r\.json\(\); \}\)/.test(page)
    && /return \{ ok: r\.ok, d: d \};/.test(js));
  ok('…and an outage throws into the existing "Couldn\'t load the index." catch',
    /if \(kind === 'error'\) throw new Error/.test(js)
    && /\.catch\(function \(\) \{\s*document\.getElementById\('index-body'\)\.innerHTML =\s*'<div class="state"><strong>Couldn\\'t load the index\.<\/strong>/.test(js));
  ok('the empty copy is reachable only from kind === \'empty\' and says "Not published yet"',
    /if \(kind === 'empty'\) \{\s*(\/\/[^\n]*\n\s*)+host\.innerHTML =\s*'<div class="state"><strong>Not published yet\.<\/strong>/.test(js));
  ok('"Updated" prints the data day in UTC, only when present and valid',
    /if \(meta && d\.updated && !isNaN\(new Date\(d\.updated\)\.getTime\(\)\)\)/.test(js) && /timeZone: 'UTC'/.test(js));
}

// ════════════════════════════════════════════════════════════════════════════
// #174 · supabase/functions/public-cost-index
// ════════════════════════════════════════════════════════════════════════════
const pciSrc = read('supabase/functions/public-cost-index/index.ts');
const pci = code(pciSrc);
{
  const cors = (/const CORS = \{[\s\S]*?\};/.exec(pciSrc) ?? [''])[0];
  const json = factory<(body: unknown, status?: number) => Response>([], [cors, liftFunction(pciSrc, 'json')], 'json')();
  const ok200 = json({ rows: [] }, 200).headers.get('Cache-Control') ?? '';
  const e502 = json({ error: 'x' }, 502).headers.get('Cache-Control') ?? '';
  const e500 = json({ error: 'x' }, 500).headers.get('Cache-Control') ?? '';
  const e405 = json({ error: 'x' }, 405).headers.get('Cache-Control') ?? '';
  ok('a 200 is cached at the edge', /s-maxage=86400/.test(ok200), ok200);
  ok('a 502 / 500 / 405 is NEVER cached (no-store)', e502 === 'no-store' && e500 === 'no-store' && e405 === 'no-store', `${e502} ${e500} ${e405}`);
  const fresh = factory<(rows: Array<Record<string, unknown>>) => string | null>([], [liftFunction(pciSrc, 'dataFreshness')], 'dataFreshness')();
  ok('`updated` = the freshest group\'s day',
    fresh([{ updated_at: '2026-09-01T00:00:00+00:00' }, { updated_at: '2026-09-20T00:00:00+00:00' }]) === '2026-09-20T00:00:00.000Z');
  ok('…and null (omitted) when nothing is published', fresh([]) === null && fresh([{ updated_at: null }]) === null);
}
ok('the request time is no longer stamped as `updated`', !/updated: new Date\(\)\.toISOString\(\)/.test(pci));
ok('`updated` is omitted when absent', /\.\.\.\(updated \? \{ updated \} : \{\}\)/.test(pci));
ok('a non-array RPC answer is a 502, not an empty index', /if \(!Array\.isArray\(data\)\) \{[\s\S]{0,160}return json\(\{ error: "Could not load the index\." \}, 502\);/.test(pci));

// ════════════════════════════════════════════════════════════════════════════
// #173 · the website widget
// ════════════════════════════════════════════════════════════════════════════
const embed = read('marketing/widget/embed.js');
const weSrc = read('supabase/functions/widget-estimate/index.ts');
const we = code(weSrc);
{
  const clientRe = (/var EMAIL_RE = (\/[^\n]+\/);/.exec(embed) ?? [])[1] ?? '';
  const serverRe = (/const EMAIL_RE = (\/[^\n]+\/);/.exec(weSrc) ?? [])[1] ?? '';
  ok('embed.js EMAIL_RE is byte-identical to the server\'s', clientRe !== '' && clientRe === serverRe, `${clientRe} vs ${serverRe}`);
  const re = new Function(`return ${clientRe || '/$^/'};`)() as RegExp;
  ok('…and it refuses the repro address "dana@gmail"', !re.test('dana@gmail') && re.test('dana@gmail.com'));
}
{
  const go = (/go\.addEventListener\('click', function \(\) \{[\s\S]*?\n      \}\);/.exec(embed) ?? [''])[0];
  ok('stepContact refuses a malformed email when there is no phone, before submitting',
    /if \(state\.data\.email && !EMAIL_RE\.test\(state\.data\.email\) && !state\.data\.phone\) \{\s*state\.error = INVALID_EMAIL_MSG;\s*return draw\(\);/.test(go)
    && go.indexOf('EMAIL_RE.test') < go.indexOf('submit()'), go.slice(0, 200));
  ok('…with the fields saved first (nothing typed is lost)',
    go.indexOf("state.data.email = email.value.trim();") < go.indexOf('EMAIL_RE.test'));
  ok('the message says what to do', /var INVALID_EMAIL_MSG = "That email doesn't look complete \(like name@gmail\.com\)\. Fix it or add a phone number\.";/.test(embed));
  ok('a server "invalid_email" sends the visitor back to the form (this embed; older cached copies show their generic line)',
    /if \(res\.body\.leadError === 'invalid_email' && !res\.body\.leadCaptured\) \{\s*state\.step = 2;\s*return done\(null, false, INVALID_EMAIL_MSG, null\);/.test(embed));
}
{
  const notSent = factory<(u: boolean) => string>(['state', 'cfg'], [liftFunction(embed, 'notSentText')], 'notSentText');
  const cfg = { contractorName: 'Ridgeline' };
  const t = (le: string | null, u = false) => notSent({ leadError: le }, cfg)(u);
  ok('only a failed save says "could not reach"', /could not reach Ridgeline/.test(t('save_failed')), t('save_failed'));
  ok('a rate limit does not blame a connection', !/could not reach/i.test(t('rate_limited')) && /Ridgeline/.test(t('rate_limited')), t('rate_limited'));
  ok('an unconnected snippet does not blame a connection', !/could not reach/i.test(t('unknown_contractor')), t('unknown_contractor'));
  ok('no reason does not blame a connection', !/could not reach/i.test(t(null)), t(null));
  ok('the result screens use notSentText for the not-sent line (both of them)',
    (embed.match(/: notSentText\((?:true|false)\) \}\)/g) ?? []).length === 2
    && !/'We could not reach ' \+ cfg\.contractorName \+ " just now/.test(embed));
}
ok('neither the server nor this embed claims older cached embeds go back to the form (round-2 review)',
  !/older cached embeds included/.test(weSrc) && /an older cached embed\.js has no\s*\n?\s*\/\/ invalid_email branch/.test(weSrc));
{
  const capture = we.slice(we.indexOf('const name = clip(body.name, 120);'));
  ok('widget-estimate answers leadError "invalid_email" when the only contact is a malformed email',
    /\} else if \(name && email && !validEmail && !phone\) \{\s*leadError = "invalid_email";/.test(capture));
  ok('…where it used to fall through with leadError null', /const validEmail = email && EMAIL_RE\.test\(email\) \? email : null;/.test(capture)
    && /if \(name && \(validEmail \|\| phone\)\) \{/.test(capture));
  ok('a lead is stored with a valid email or none (never a bouncing reply-to)', /email: validEmail,/.test(capture));
  ok('…and a malformed one that came with a phone is kept as text in scope',
    /email && !validEmail \? `email as typed \(did not look valid\): \$\{email\}` : null,/.test(capture));
}

// ════════════════════════════════════════════════════════════════════════════
// #79 / #84 · migration 20260923180000 (static; PGlite executes it)
// ════════════════════════════════════════════════════════════════════════════
const MIG = 'supabase/migrations/20260923180000_cost_benchmark_privacy.sql';
const mig = sqlCode(read(MIG));
ok('migration present', mig.length > 0, MIG);
ok('#79: an account-level opt-in table with own-row SELECT only',
  /create table if not exists public\.cost_benchmark_prefs/.test(mig)
  && /create policy cbp_own_select on public\.cost_benchmark_prefs\s+for select to authenticated\s+using \(auth\.uid\(\) = user_id\);/.test(mig)
  && /revoke all on public\.cost_benchmark_prefs from public, anon, authenticated;/.test(mig));
ok('#84: client writes to cost_benchmark_samples revoked; cbs_own replaced by SELECT-own',
  /revoke insert, update, delete, truncate, references, trigger\s+on public\.cost_benchmark_samples from public, anon, authenticated;/.test(mig)
  && /drop policy if exists cbs_own on public\.cost_benchmark_samples;/.test(mig)
  && /create policy cbs_own_select on public\.cost_benchmark_samples\s+for select to authenticated/.test(mig));
ok('#84: CHECK region = \'US\' and a price band', /check \(region = 'US'\)/.test(mig) && /check \(unit_price > 0 and unit_price <= 1000000\)/.test(mig));
{
  const contrib = (/create or replace function public\.contribute_benchmark_rate[\s\S]*?\$function\$;/.exec(mig) ?? [''])[0];
  ok('contribute_benchmark_rate is SECURITY DEFINER with a pinned search_path', /security definer\s+set search_path = public/.test(contrib));
  ok('…forces the owner and the region', /v_uid\s+uuid := auth\.uid\(\);/.test(contrib) && /values\s+\(v_uid, v_cat, v_unit, 'US',/.test(contrib));
  ok('…lower-cases / trims the key and refuses an out-of-band price',
    /lower\(btrim\(coalesce\(p_category, ''\)\)\)/.test(contrib) && /p_unit_price <= 0 or p_unit_price > 1000000/.test(contrib));
  ok('…and copies the ACCOUNT opt-in onto the row (never the client\'s)', /public_index_opt_in\s*\)\s*values[\s\S]*coalesce\(v_opt, false\)/.test(contrib));
}
// Round 2 (LESSON): round 0's distinct-contractor k fell to one sybil and
// round 1's 5% grid fell to a threshold search (review probe: three exact
// prices in 141 RPC calls). The rule that can be proven: no aggregate of
// posted rates leaves the server. Pinned on the code, not the comments.
const fnBody = (src: string) => (/as \$function\$([\s\S]*?)\$function\$;/.exec(src) ?? [])[1] ?? '';
{
  const stats = (/create or replace function public\.cost_benchmark_stats[\s\S]*?\$function\$;/.exec(mig) ?? [''])[0];
  const body = fnBody(stats);
  ok('#84: cost_benchmark_stats returns ZERO rows (where false)', /select null::numeric, null::numeric, null::numeric, null::integer\s+where false;/.test(body), body.trim().slice(0, 160));
  ok('…and reads no table at all (nothing to aggregate, nothing to probe)', !/\bfrom\b/i.test(body) && !/cost_benchmark_samples|percentile_cont/.test(body));
  ok('…keeps its signature, return type, SECURITY DEFINER and search_path',
    /cost_benchmark_stats\(\s*p_category text,\s*p_unit text,\s*p_region text default 'US'\s*\)\s*returns table\(median numeric, p25 numeric, p75 numeric, n integer\)/.test(stats)
    && /security definer\s+set search_path = public/.test(stats));
  ok('…and its grants (authenticated + service_role, not anon)',
    /revoke all on function public\.cost_benchmark_stats\(text, text, text\) from public, anon;/.test(mig)
    && /grant execute on function public\.cost_benchmark_stats\(text, text, text\) to authenticated, service_role;/.test(mig));
}
{
  const pub = (/create function public\.public_cost_index[\s\S]*?\$function\$;/.exec(mig) ?? [''])[0];
  const body = fnBody(pub);
  ok('#84: public_cost_index returns ZERO rows (where false)',
    /select null::text, null::text, null::text,\s*null::numeric, null::numeric, null::numeric,\s*null::integer, null::timestamptz\s+where false;/.test(body), body.trim().slice(0, 200));
  ok('…and reads no table at all', !/\bfrom\b/i.test(body) && !/cost_benchmark_samples|percentile_cont/.test(body));
  ok('#174: …its return type carries updated_at for the day it reopens', /n integer, updated_at timestamptz\)/.test(pub));
  ok('…SECURITY DEFINER / search_path kept, anon keeps EXECUTE after the drop/re-create',
    /security definer\s+set search_path = public/.test(pub)
    && /grant execute on function public\.public_cost_index\(text, text, text\) to anon, authenticated, service_role;/.test(mig));
}
ok('the round-1 snap grid is gone (it protected nothing against a threshold search)', !/cost_benchmark_snap/.test(read(MIG)));
ok('the migration fails loudly if either aggregate ever returns a row',
  /if exists \(select 1 from public\.cost_benchmark_stats\('roofing', 'sq', 'US'\)\)\s+or exists \(select 1 from public\.public_cost_index\(null, null, 'US'\)\) then\s+raise exception/.test(mig));
{
  const raw = read(MIG);
  ok('the header states the proven rule, the threshold search that forced it, and what it gives up',
    /NOTHING IS PUBLISHED/.test(raw) && /threshold search/.test(raw) && /WHAT IT GIVES UP/.test(raw)
    && !/a neighbourhood, not the price/.test(raw) && !/0\.3%-4\.7%/.test(raw));
}
{
  const pciRaw = read('supabase/functions/public-cost-index/index.ts');
  const pciCode = code(pciRaw);
  ok('public-cost-index states no publishing floor (none exists) and says "Not published yet" only on rows: []',
    !/minimumContributors/.test(pciCode)
    && /\.\.\.\(rows\.length === 0\s*\?\s*\{ note: "Not published yet\./.test(pciCode));
  ok('…and its PRIVACY comment says the RPC returns NOTHING, not a neighbourhood',
    /that is NOTHING/.test(pciRaw) && !/neighbour's price to a few percent/.test(pciRaw) && !/snapped to a 5% price grid/.test(pciRaw));
}
{
  const costsPage = read('marketing/costs/index.html');
  // the round-2 review's list: FAQ / JSON-LD / protection paragraph / meta
  ok('the costs page never promises a floor, rounding, or "never an individual contractor\'s price"',
    !/\b(five|six) (or more )?independent contractors\b/i.test(costsPage) && !/at least (five|six)/i.test(costsPage)
    && !/5% price step/.test(costsPage) && !/never an individual contractor's price/.test(costsPage)
    && !/minimumContributors/.test(costsPage) && !/still building/i.test(costsPage.replace(/\/\/[^\n]*/g, '')));
  ok('…and says, in the FAQ and the page body, that nothing is published and why',
    /"name": "Is an individual contractor's pricing ever exposed\?"[\s\S]{0,120}Nothing is published today/.test(costsPage)
    && /<h3>Why nothing is published yet<\/h3>/.test(costsPage)
    && /"measurementTechnique": "[^"]*Nothing is published yet/.test(costsPage));
}

// ════════════════════════════════════════════════════════════════════════════
// #83 · the plan-sheets migration left held/, unchanged, with its gate stated
// ════════════════════════════════════════════════════════════════════════════
const NEW = 'supabase/migrations/20260923181000_plan_sheets_private.sql';
const OLD = 'supabase/migrations/held/20260904101100_plan_sheets_private.sql';
const moved = read(NEW);
ok('the plan-sheets migration is now 20260923181000 and no longer in held/', moved.length > 0 && !existsSync(join(ROOT, OLD)));
{
  // sha-256 of held/20260904101100_plan_sheets_private.sql at ab5bab13
  const ORIGINAL_BODY_SHA = 'f7b708c012da031ce2404703d9e7678df5fa7384a498c2c9c900a8a443d2cd61';
  const marker = '-- ============================================================================\n-- HELD — do not apply until';
  const at = moved.indexOf(marker);
  const body = at >= 0 ? moved.slice(at) : '';
  ok('its body is byte-identical to the held file', createHash('sha256').update(body).digest('hex') === ORIGINAL_BODY_SHA);
  const header = at >= 0 ? moved.slice(0, at) : '';
  ok('the header says DO NOT APPLY without the founder\'s OK', /DO NOT APPLY/.test(header) && /THE FOUNDER SAYS YES \(productDecision #83/.test(header));
  ok('…names the 7 tmp/ objects deleted through the Storage API, not SQL', /7 orphaned objects under plan-sheets\/tmp\//.test(header) && /DELETED THROUGH THE\s*\n?--\s*STORAGE API/.test(header));
  ok('…wave 4\'s signed-media-urls + the architect page live, and the OTA on devices',
    /signed-media-urls/.test(header) && /architect page/.test(header) && /REACHED\s*\n?--\s*devices/.test(header));
  ok('…and the limits: signed URLs until expiry (7 days legacy) and rfp-attachments',
    /up to 7 DAYS/.test(header) && /rfp-attachments/.test(header));
}
{
  const readme = read('supabase/migrations/held/README.md');
  ok('held/README.md no longer lists it as a held file', !/^\| `20260904101100_plan_sheets_private\.sql`/m.test(readme));
  ok('…and records the move with its apply gate', /\.\.\/20260923181000_plan_sheets_private\.sql/.test(readme) && /productDecision #83/.test(readme));
  ok('…keeping the other lanes\' rows', /20260923171000_portal_token_strip\.sql/.test(readme) && /proposal-esign-2/.test(readme));
}

console.log(`\n${fail === 0 ? '✓' : '✗'} w5 benchmark-financing (public): ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
