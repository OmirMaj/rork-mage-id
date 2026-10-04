// scripts/validate-ai-consent-server.ts — lane AICONSENT (App Store 5.1.2(i)):
// the answer to "Use AI features?" is stored on the ACCOUNT, and every server
// path that sends job content to an AI provider with no tap in the app refuses
// without a yes.
//
// WHY THIS EXISTS. The answer used to live only on the phone, and two server
// paths (the Friday client recap and Ask Your Home) sent a contractor's job
// records to Google Gemini without ever seeing it. The failure this file stops
// is quiet: a new cron or portal function that calls an AI vendor, a gate moved
// below the call it guards, or a yes copied onto the account without a
// question would ship a silent data share, and nothing would crash.
//
//   S1  THE SERVER HELPER, executed with a fake fetch
//       (supabase/functions/_shared/aiConsent.ts): only the exact string
//       'granted' on the owner's own row is a yes; everything else, including
//       a failed read (tried twice), is "no AI".
//   S2  THE SWEEP, derived, not listed: every function that can run with no
//       user tap (verify_jwt = false, or a cron / service-role marker) and
//       reaches an AI provider (directly, through a _shared file, or by
//       relaying to an AI function) must gate through that helper and carry a
//       proof below. A function that only declares an AI key needs a written,
//       re-checked exemption.
//   S3  homeowner-weekly-digest: the read sits right before the one AI call.
//   S4  portal-ask-home: the gate sits before the counter and before the
//       embedding call; a not-yes is a normal 200 answer, a failed read is 502.
//   S5  delete-account switches AI off before its first delete.
//   S6  The migration's text (the PGlite proof executes it; this pins it).
//   C1  The phone gate's "the person answered" event, executed.
//   C2  utils/aiConsentSyncCore, executed: every rule of what the phone sends
//       and what the screens say.
//   C3  The wiring, static: one read, one rpc write, no direct profiles write,
//       no grant on the phone, the mount, the screens, a reconcile run at
//       sign-in, in the foreground handler and before sign-out, and the retry
//       delay (30 s, changed by no app file).
//   C4  The copy: every sentence exact; the web question pressed on a fake alert.
//   C5  utils/aiConsentAccount, EXECUTED with a fake storage, a fake profiles
//       read and a fake rpc: an answer the account did not hear stays
//       undelivered and is sent again, ON A TIMER, with no tap and no other
//       event; the web buttons send exactly what was answered, after asking;
//       "Allow" on a phone always asks.
//
// MUTATION PROOF: set AI_CONSENT_SERVER_MUT_DIR to a directory that mirrors
// repo-relative paths; any file present there is read (and executed) instead of
// the repo's. Unset = the repo.
//
// Run: bun run scripts/validate-ai-consent-server.ts

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MUT = process.env.AI_CONSENT_SERVER_MUT_DIR;
const srcPath = (rel: string) => (MUT && existsSync(join(MUT, rel)) ? join(MUT, rel) : join(ROOT, rel));
const read = (rel: string) => readFileSync(srcPath(rel), 'utf8');
const readOr = (rel: string) => { try { return read(rel); } catch { return ''; } };

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = ''): boolean {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
  return cond;
}
if (MUT) console.log(`(mutation dir: ${MUT})`);

/** Comments blanked to spaces, line structure kept, strings untouched. */
function strip(src: string): string {
  let out = '';
  let i = 0;
  let mode: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'bt' = 'code';
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && n === '*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") mode = 'sq'; else if (c === '"') mode = 'dq'; else if (c === '`') mode = 'bt';
      out += c; i++; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } else out += ' '; i++; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; out += '  '; i += 2; continue; } out += c === '\n' ? c : ' '; i++; continue; }
    if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'bt' && c === '`')) mode = 'code';
    if ((mode === 'sq' || mode === 'dq') && c === '\n') mode = 'code';
    out += c; i++;
  }
  return out;
}
const count = (src: string, needle: string): number => src.split(needle).length - 1;
/** Runs of whitespace become one space (for text that wraps across lines). */
const flat = (s: string): string => s.replace(/\s+/g, ' ');
/** From `header` to the next top-level declaration (a line starting in column 0). */
function topLevelBlock(src: string, header: string): string {
  const at = src.indexOf(header);
  if (at < 0) return '';
  const rest = src.slice(at + header.length);
  const next = rest.search(/\n(?:async function|function|const|let|type|interface|export|Deno\.serve|serve\()/);
  return src.slice(at, next < 0 ? src.length : at + header.length + next);
}

const UID_A = '0b9d2c1e-5a44-4f0e-9d6b-1c2a3b4c5d6e';
const UID_B = '7f3e9a10-2b6c-4d8e-8f01-a1b2c3d4e5f6';

// ════════════════════════════════════════════════════════════════════════════
// S1 — the server helper, executed
// ════════════════════════════════════════════════════════════════════════════
type OwnerAiConsent = 'granted' | 'not_granted' | 'unavailable';
type FakeResponse = { ok: boolean; json(): Promise<unknown> };
type FakeFetch = (url: string, init: { headers: Record<string, string> }) => Promise<FakeResponse>;
type ReadOwner = (url: string, key: string, ownerId: string | null | undefined, fetchImpl?: FakeFetch) => Promise<OwnerAiConsent>;

function fakeFetch(script: (unknown | (() => never))[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl: FakeFetch = async (url, init) => {
    const step = script[Math.min(calls.length, script.length - 1)];
    calls.push({ url, headers: init.headers });
    if (typeof step === 'function') return (step as () => never)();
    return step as FakeResponse;
  };
  return { calls, impl };
}
const rows = (r: unknown): FakeResponse => ({ ok: true, json: async () => r });
const notOk: FakeResponse = { ok: false, json: async () => ({ message: 'boom' }) };
const throws = (): never => { throw new Error('network down'); };

async function partS1(): Promise<void> {
  console.log('\nS1. _shared/aiConsent.ts (executed with a fake fetch)');
  let readOwner: ReadOwner | null = null;
  let allows: ((v: unknown) => boolean) | null = null;
  try {
    const mod = await import(srcPath('supabase/functions/_shared/aiConsent.ts')) as { readOwnerAiConsent?: ReadOwner; aiConsentAllows?: (v: unknown) => boolean };
    readOwner = typeof mod.readOwnerAiConsent === 'function' ? mod.readOwnerAiConsent : null;
    allows = typeof mod.aiConsentAllows === 'function' ? mod.aiConsentAllows : null;
  } catch (e) { ok('the helper imports under bun (no Deno global, no imports)', false, String(e)); }
  if (!ok('readOwnerAiConsent and aiConsentAllows are exported', !!readOwner && !!allows) || !readOwner || !allows) return;
  const URL_ = 'https://x.supabase.co';
  const KEY = 'service-key';

  ok("aiConsentAllows: true only for the exact string 'granted'",
    allows('granted') === true
    && [null, undefined, 'declined', 'not_granted', 'unavailable', 'GRANTED', 'Granted', 'granted ', 'yes', true, 1, {}].every((v) => allows!(v) === false));

  {
    const f = fakeFetch([rows([{ id: UID_A, ai_consent: 'granted' }])]);
    const r = await readOwner(URL_, KEY, UID_A, f.impl);
    ok("a 'granted' row for the owner → granted, one request", r === 'granted' && f.calls.length === 1, `${r}, ${f.calls.length} request(s)`);
    ok('the request is /rest/v1/profiles?select=id,ai_consent&id=eq.<id>&limit=1',
      f.calls[0]?.url === `${URL_}/rest/v1/profiles?select=id,ai_consent&id=eq.${UID_A}&limit=1`, f.calls[0]?.url ?? '');
    ok('…with the service key in apikey and Authorization',
      f.calls[0]?.headers.apikey === KEY && f.calls[0]?.headers.Authorization === `Bearer ${KEY}`);
  }
  {
    const f = fakeFetch([rows([{ id: UID_A.toUpperCase(), ai_consent: 'granted' }])]);
    ok('the id match ignores letter case', (await readOwner(URL_, KEY, UID_A, f.impl)) === 'granted');
  }
  for (const [label, body] of [
    ["'declined'", [{ id: UID_A, ai_consent: 'declined' }]],
    ['NULL (never told)', [{ id: UID_A, ai_consent: null }]],
    ['no row', []],
    ['a row for ANOTHER id that says granted', [{ id: UID_B, ai_consent: 'granted' }]],
    ["'GRANTED'", [{ id: UID_A, ai_consent: 'GRANTED' }]],
    ['true', [{ id: UID_A, ai_consent: true }]],
    ["'yes'", [{ id: UID_A, ai_consent: 'yes' }]],
    ['a row with no ai_consent key', [{ id: UID_A }]],
  ] as const) {
    const f = fakeFetch([rows(body)]);
    const r = await readOwner(URL_, KEY, UID_A, f.impl);
    ok(`${label} → not_granted`, r === 'not_granted' && f.calls.length === 1, `${r}, ${f.calls.length} request(s)`);
  }
  for (const [label, step] of [
    ['a non-2xx answer', notOk],
    ['a fetch that throws', throws],
    ['a body that is not an array', rows({ message: 'column profiles.ai_consent does not exist' })],
  ] as const) {
    const f = fakeFetch([step, step]);
    const r = await readOwner(URL_, KEY, UID_A, f.impl);
    ok(`${label}, twice → unavailable, and exactly TWO requests were made`, r === 'unavailable' && f.calls.length === 2, `${r}, ${f.calls.length} request(s)`);
  }
  {
    const f = fakeFetch([notOk, rows([{ id: UID_A, ai_consent: 'granted' }])]);
    const r = await readOwner(URL_, KEY, UID_A, f.impl);
    ok("fail once, then 'granted' → granted (two requests)", r === 'granted' && f.calls.length === 2, `${r}, ${f.calls.length} request(s)`);
  }
  {
    const f = fakeFetch([throws, rows([{ id: UID_A, ai_consent: 'declined' }])]);
    const r = await readOwner(URL_, KEY, UID_A, f.impl);
    ok("throw once, then 'declined' → not_granted (a retry never turns a no into a yes)", r === 'not_granted' && f.calls.length === 2, `${r}`);
  }
  {
    const f = fakeFetch([rows([{ id: UID_A, ai_consent: 'granted' }])]);
    const a = await readOwner('', KEY, UID_A, f.impl);
    const b = await readOwner(URL_, '', UID_A, f.impl);
    ok('an empty url or key → unavailable, and no request', a === 'unavailable' && b === 'unavailable' && f.calls.length === 0, `${a} ${b} ${f.calls.length}`);
  }
  {
    const f = fakeFetch([rows([{ id: 'x', ai_consent: 'granted' }])]);
    const got: string[] = [];
    for (const id of ['not-a-uuid', `${UID_A}&select=*`, `eq.${UID_A}`, '', null, undefined]) got.push(await readOwner(URL_, KEY, id, f.impl));
    ok('an id that is not a uuid (or is missing) → not_granted, and NO request', got.every((g) => g === 'not_granted') && f.calls.length === 0, `${got.join(',')} ${f.calls.length} request(s)`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S2 — the sweep (derived), with S3 / S4 as its proofs
// ════════════════════════════════════════════════════════════════════════════
const FN_REL = 'supabase/functions';
// The two vendor lists are scripts/validate-ai-consent.ts's own (part B and
// aiFunctions()). The assertion below fails if that file's text changes, so the
// two sweeps cannot drift apart.
const AI_HOST = /generativelanguage\.googleapis\.com|api\.anthropic\.com|@anthropic-ai\/sdk|toolkit\.rork\.com\/stt|_shared\/embeddings(\.ts)?['"]/;
const UNDISCLOSED = /api\.openai\.com|openai\.azure|api\.deepgram\.com|api\.assemblyai\.com|api\.elevenlabs\.io|api\.cohere\.|api\.mistral\.ai|api\.groq\.com|api\.replicate\.com|api\.together\.xyz|api\.voyageai\.com/;
/** Runs with no user tap: its OWN files carry a cron / service-role marker.
 *  (Own files only: _shared/auth.ts names x-cron-secret, and nearly every
 *  function imports it.) */
const UNATTENDED_MARK = /isValidCron\(|x-cron-secret|isServiceRoleToken\(/;
const AI_HINT = /GEMINI_API_KEY|ANTHROPIC_API_KEY|_shared\/models(\.ts)?['"]/;
/** A FILE that can reach an AI provider, beyond the vendor hosts above: it reads
 *  an AI key, names an AI endpoint, or calls the embeddings helper. Matched on
 *  raw text (comments included): a false alarm is loud, a miss is silent. */
const AI_TOUCH = /GEMINI_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|generateContent|embedContent|batchEmbedContents|\/v1\/messages|geminiEmbed\(/;
/** Any AI vendor other than Google Gemini (the only one the two gated paths use). */
const OTHER_VENDOR = new RegExp(`api\\.anthropic\\.com|@anthropic-ai\\/sdk|toolkit\\.rork\\.com\\/stt|${UNDISCLOSED.source}`);

/** WHERE A GATED FUNCTION CAN SEND ANYTHING. The vendor lists above only know
 *  the vendors they name; a call to one they do not name (a new AI host, a
 *  relay, a collector) would pass them. So for the two gated functions the rule
 *  is turned around: every network call in the whole source must go to a
 *  destination on this short list, written as the literal start of the call's
 *  first argument. Anything else, including a URL held in a variable, fails. */
const OWN_DB = /^`\$\{(?:SUPABASE_URL|supabaseUrl)\}\/(?:rest|auth)\/v1\//;
const EMAIL_PROVIDER = /^'https:\/\/api\.resend\.com\/emails'/;
/** Only inside the files AI_FILES names (the calls the proofs put behind the gate). */
const GEMINI_CALL = /^`https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/|^`\$\{BASE\}\$\{EMBED_MODEL\}:/;
const REMOTE_IMPORT_OK = /^https:\/\/deno\.land\/std@[\d.]+\/|^https:\/\/esm\.sh\/@supabase\/supabase-js@/;
const OTHER_EGRESS = /\bWebSocket\b|Deno\.connect|Deno\.Command|XMLHttpRequest|sendBeacon|\bEventSource\b|\.functions\.invoke\(/;

/** Every network call and remote import in `file` that is not on the list. */
function strayEgress(file: string, mayCallGemini: boolean): string[] {
  const src = strip(readOr(file));
  const out: string[] = [];
  for (const m of src.matchAll(/\bfetch(?:Impl)?\(\s*/g)) {
    const head = src.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 90);
    if (OWN_DB.test(head) || EMAIL_PROVIDER.test(head) || (mayCallGemini && GEMINI_CALL.test(head))) continue;
    out.push(`${file}: fetch(${flat(head).slice(0, 60)}`);
  }
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"]((?:https?:|npm:|jsr:|node:)[^'"]+)['"]/g)) {
    if (!REMOTE_IMPORT_OK.test(m[1])) out.push(`${file}: import ${m[1]}`);
  }
  const other = OTHER_EGRESS.exec(src);
  if (other) out.push(`${file}: ${other[0]}`);
  if (file.endsWith('_shared/embeddings.ts') && !src.includes('const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";')) {
    out.push(`${file}: BASE is no longer the Gemini host`);
  }
  return out;
}

function listFunctions(): string[] {
  const dir = join(ROOT, FN_REL);
  return readdirSync(dir).filter((n) => !n.startsWith('_') && statSync(join(dir, n)).isDirectory()).sort();
}
/** Repo-relative paths of a function's own .ts / .js files. */
function ownFiles(name: string): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const f of readdirSync(abs)) {
      const p = join(abs, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|js)$/.test(f)) out.push(relative(ROOT, p));
    }
  };
  walk(join(ROOT, FN_REL, name));
  return out;
}
/** Own files plus every file reached by following relative imports, transitively. */
function closure(files: string[]): string[] {
  const seen = new Set(files);
  const queue = [...files];
  while (queue.length > 0) {
    const rel = queue.pop() as string;
    const src = readOr(rel);
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = relative(ROOT, resolve(join(ROOT, dirname(rel)), m[1]));
      if (seen.has(target) || target.startsWith('..')) continue;
      if (!existsSync(join(ROOT, target)) && !(MUT && existsSync(join(MUT, target)))) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return [...seen];
}

type Proof = () => boolean;

/** S3 — homeowner-weekly-digest. True when every pin holds. */
const proveDigest: Proof = () => {
  console.log('\nS3. homeowner-weekly-digest: the read sits right before the one AI call');
  const src = strip(read('supabase/functions/homeowner-weekly-digest/index.ts'));
  const send = src.slice(src.indexOf('async function sendForProject('), src.indexOf('Deno.serve('));
  const READ = 'readOwnerAiConsent(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, project.user_id)';
  const CALL = 'aiAllowed ? await buildAISummary(project, dfrs, photos, cos, tasks) : null';
  const readAt = send.indexOf(READ);
  const callAt = send.indexOf('buildAISummary(');
  const all = [
    ok('the consent read occurs exactly once, inside sendForProject', count(src, 'readOwnerAiConsent(') === 1 && readAt > 0),
    ok('…as its own statement: const consent = await readOwnerAiConsent(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, project.user_id);',
      send.includes(`const consent = await ${READ};`) && (send.match(/\bconsent\s*=[^=]/g) ?? []).length === 1),
    ok('…after clientVisibleWeek( and BEFORE the buildAISummary call',
      readAt > send.indexOf('clientVisibleWeek(') && send.indexOf('clientVisibleWeek(') > 0 && readAt < callAt, `read@${readAt} call@${callAt}`),
    ok('const aiAllowed = aiConsentAllows(consent); (and aiAllowed is assigned nowhere else)',
      send.includes('const aiAllowed = aiConsentAllows(consent);') && (send.match(/\baiAllowed\s*=[^=]/g) ?? []).length === 1
      && send.indexOf('const aiAllowed = aiConsentAllows(consent);') > readAt && send.indexOf('const aiAllowed = aiConsentAllows(consent);') < callAt),
    ok('buildAISummary( occurs exactly twice (its declaration and ONE call), and the call is guarded by aiAllowed',
      count(src, 'buildAISummary(') === 2 && send.includes(`const ai = ${CALL};`), `occurrences: ${count(src, 'buildAISummary(')}`),
    ok('the Gemini host occurs once in the file, inside buildAISummary',
      count(src, 'generativelanguage.googleapis.com') === 1
      && topLevelBlock(src, 'async function buildAISummary(').includes('generativelanguage.googleapis.com')),
    ok('…and it is the file’s ONLY fetch( (nothing else in this file leaves for another host), with no other AI vendor named',
      count(src, 'fetch(') === 1 && topLevelBlock(src, 'async function buildAISummary(').includes('fetch(') && !OTHER_VENDOR.test(src),
      `fetch( occurs ${count(src, 'fetch(')} time(s)`),
    ok('the recap kind is derived from the same answer (a failed read is "unknown", never "off")',
      send.includes("recap = ai ? 'ai' : aiAllowed ? 'plain' : consent === 'unavailable' ? 'plain_ai_unknown' : 'plain_ai_off';")),
    ok('the handover ("final") branch contains neither the read nor the AI call', (() => {
      const a = send.indexOf("if (plan.kind === 'final') {");
      const b = send.indexOf('} else {', a);
      const branch = a > 0 && b > a ? send.slice(a, b) : null;
      return branch !== null && !branch.includes('buildAISummary(') && !branch.includes('readOwnerAiConsent(') && branch.includes("recap = 'final';");
    })()),
    ok('sendForProject returns the kind: return { sent, errors, recap };', send.includes('return { sent, errors, recap };')),
    ok('the preview response carries recap: result.recap', /mode: 'preview',\s*sent: result\.sent,\s*errors: result\.errors,\s*recap: result\.recap,/.test(src)),
    ok('the cron response carries the two counts, and the log line carries counts only',
      /recapsWithoutAi,\s*recapsAiUnknown,/.test(src)
      && src.includes("if (result.sent > 0 && result.recap === 'plain_ai_off') recapsWithoutAi += 1;")
      && src.includes("if (result.sent > 0 && result.recap === 'plain_ai_unknown') recapsAiUnknown += 1;")
      && src.includes("console.log('[homeowner-weekly-digest] recaps without AI:', recapsWithoutAi, 'AI setting not readable:', recapsAiUnknown);")),
    ok('the pinned owner-profile select still occurs exactly twice (the consent read is its own query)',
      count(src, "select('id,email,name,company_name,contact_name,digest_timezone')") === 2),
    ok('errors[] never receives a consent code', !/errors(\.push\(|: \[)[^\n]*(consent|ai_off|plain_ai|recap)/i.test(src)),
  ];
  return all.every(Boolean);
};

/** S4 — portal-ask-home. True when every pin holds. */
const proveAskHome: Proof = () => {
  console.log('\nS4. portal-ask-home: the gate sits before the counter and before any AI call');
  const src = strip(read('supabase/functions/portal-ask-home/index.ts'));
  const readAt = src.indexOf('readOwnerAiConsent(');
  const counterAt = src.indexOf('rateLimitCount(`askhome:portal:');
  const embedAt = src.indexOf('geminiEmbed(');
  const genAt = src.indexOf(':generateContent');
  const OFF = /if \(!aiConsentAllows\(consent\)\) \{\s*return json\(\{ success: true, answer: ASK_AI_OFF_LINE, refs: \[\], code: "ai_off" \}\);\s*\}/;
  const UNAVAILABLE = /if \(consent === "unavailable"\) \{\s*console\.error\("\[portal-ask-home\] ai consent read failed"\);\s*return json\(\{ success: false, error: "No answer right now — try again in a moment\." \}, 502\);\s*\}/;
  const offAt = src.search(OFF);
  const all = [
    ok('the read is its own statement: const consent = await readOwnerAiConsent(SUPABASE_URL, SERVICE_ROLE_KEY, proj.user_id);',
      count(src, 'readOwnerAiConsent(') === 1
      && src.includes('const consent = await readOwnerAiConsent(SUPABASE_URL, SERVICE_ROLE_KEY, proj.user_id);')
      && (src.match(/\bconsent\s*=[^=]/g) ?? []).length === 1),
    ok('order: the read < the per-portal counter < geminiEmbed( < :generateContent',
      readAt > 0 && readAt < counterAt && counterAt < embedAt && embedAt < genAt, `read@${readAt} counter@${counterAt} embed@${embedAt} generate@${genAt}`),
    ok('one geminiEmbed( and one :generateContent in the file', count(src, 'geminiEmbed(') === 1 && count(src, ':generateContent') === 1),
    ok('the Gemini host occurs once in the file, AFTER the gate, and no other AI vendor is named',
      count(src, 'generativelanguage.googleapis.com') === 1 && src.indexOf('generativelanguage.googleapis.com') > offAt && offAt > 0 && !OTHER_VENDOR.test(src)),
    ok('every fetch( BEFORE the gate goes to our own database (`${SUPABASE_URL}/rest/v1/…`): nothing leaves for another host before the answer is read', (() => {
      const before = [...src.matchAll(/\bfetch\(\s*/g)].filter((m) => (m.index ?? 0) < readAt);
      return readAt > 0 && before.length >= 2
        && before.every((m) => src.slice((m.index ?? 0) + m[0].length).startsWith('`${SUPABASE_URL}/rest/v1/'));
    })()),
    ok('the embeddings helper is used for exactly what it is used for today: import { geminiEmbed, toVectorLiteral }',
      count(src, '_shared/embeddings') === 1 && src.includes('import { geminiEmbed, toVectorLiteral } from "../_shared/embeddings.ts";')),
    ok('…and that helper makes ONE network call, inside geminiEmbed (toVectorLiteral sends nothing)', (() => {
      const emb = strip(readOr('supabase/functions/_shared/embeddings.ts'));
      return count(emb, 'fetch(') === 1 && topLevelBlock(emb, 'export async function geminiEmbed(').includes('fetch(') && !OTHER_VENDOR.test(emb);
    })()),
    ok("a failed read ('unavailable') returns 502 \"No answer right now — try again in a moment.\"", UNAVAILABLE.test(src)),
    ok('a not-yes returns json({ success: true, answer: ASK_AI_OFF_LINE, refs: [], code: "ai_off" }) with no status argument', OFF.test(src)),
    ok('…and both returns sit between the read and the counter (a refused question spends none of the 20 a day, and is not embedded)',
      offAt > readAt && offAt < counterAt && src.search(UNAVAILABLE) > readAt && src.search(UNAVAILABLE) < offAt),
    ok('ASK_AI_OFF_LINE is the exact sentence',
      src.includes('const ASK_AI_OFF_LINE = "Typed questions are not turned on for this project. The binder above has what is on file, or ask your contractor.";')),
    ok('the consent read is never folded into the client_portal lookup', !/select=[^`"']*ai_consent/.test(src)),
  ];
  return all.every(Boolean);
};

/** Every unattended function that reaches an AI provider, and the proof that
 *  each of its AI calls sits behind _shared/aiConsent. */
const PROOFS: Record<string, Proof> = {
  'homeowner-weekly-digest': proveDigest,
  'portal-ask-home': proveAskHome,
};

/** For each proven function: the ONLY files in its whole source (its own files
 *  plus everything they import, transitively) that may touch an AI provider.
 *  The proofs above pin the calls inside these files; this pins that there is
 *  no AI call anywhere else — a sibling or a _shared file that grew one, called
 *  before the gate, would otherwise pass. */
const AI_FILES: Record<string, string[]> = {
  'homeowner-weekly-digest': ['supabase/functions/homeowner-weekly-digest/index.ts'],
  'portal-ask-home': ['supabase/functions/_shared/embeddings.ts', 'supabase/functions/portal-ask-home/index.ts'],
};

/** Unattended functions that only LOOK like AI (they read an AI key or import
 *  the model names) and call no AI provider. Each pin is re-checked. */
const EXEMPT: Record<string, { why: string; pin: (ownSrc: string) => boolean }> = {
  'morning-digest': {
    why: 'declares GEMINI_API_KEY, makes no AI call',
    pin: (ownSrc) => !/generateContent|embedContent|\/v1\/messages|geminiEmbed\(/.test(ownSrc),
  },
};

/** Unattended, deliberately NOT gated by this answer, with the reason (founder
 *  decision D5). The pin fails the day the server itself starts calling an AI. */
const NOT_GATED: Record<string, string> = {
  mcp: 'the server calls no AI provider: it serves the token owner’s own data to the AI client HE connected, until he revokes the token (the Off row and the privacy page say so)',
};

function partS2(): void {
  console.log('\nS2. the sweep: every AI path with no user tap is gated');
  const consentValidator = readOr('scripts/validate-ai-consent.ts');
  ok('the AI host list is still the one in scripts/validate-ai-consent.ts (the two sweeps cannot drift)',
    consentValidator.includes(AI_HOST.source) && consentValidator.includes(UNDISCLOSED.source));

  const config = readOr('supabase/config.toml');
  const noJwt = new Set<string>();
  {
    let current: string | null = null;
    for (const line of config.split('\n')) {
      const head = /^\[functions\.([A-Za-z0-9_-]+)\]/.exec(line.trim());
      if (head) { current = head[1]; continue; }
      if (current && /^verify_jwt\s*=\s*false\b/.test(line.trim())) noJwt.add(current);
    }
  }
  const names = listFunctions();
  type Info = { own: string; all: string; ownList: string[]; allList: string[]; unattended: boolean; hint: boolean };
  const info = new Map<string, Info>();
  for (const n of names) {
    const files = ownFiles(n);
    const own = files.map(readOr).join('\n');
    const allList = closure(files);
    const all = allList.map(readOr).join('\n');
    info.set(n, { own, all, ownList: files, allList, unattended: noJwt.has(n) || UNATTENDED_MARK.test(own), hint: AI_HINT.test(own) });
  }
  // AI REACH: a vendor host in the source, or a relay to a function that has one.
  const ai = new Set<string>(names.filter((n) => { const i = info.get(n) as Info; return AI_HOST.test(i.all) || UNDISCLOSED.test(i.all); }));
  for (let grew = true; grew;) {
    grew = false;
    for (const n of names) {
      if (ai.has(n)) continue;
      const relays = [...(info.get(n) as Info).all.matchAll(/\/functions\/v1\/([a-z0-9-]+)/g)].map((m) => m[1]);
      if (relays.some((r) => ai.has(r))) { ai.add(n); grew = true; }
    }
  }
  const unattended = names.filter((n) => (info.get(n) as Info).unattended);
  ok(`the sweep read the functions and the config (${names.length} functions, ${noJwt.size} verify_jwt = false, ${ai.size} reach an AI provider)`,
    names.length >= 60 && noJwt.size >= 30 && ai.has('ai') && ai.has('analyze-photos') && ai.has('transcribe-audio') && ai.has('construction-answer'),
    `functions=${names.length} noJwt=${noJwt.size} ai=${[...ai].sort().join(', ')}`);

  const reach = unattended.filter((n) => ai.has(n)).sort();
  ok('the unattended AI paths are exactly homeowner-weekly-digest and portal-ask-home (no silent zero, no new one)',
    reach.join(',') === 'homeowner-weekly-digest,portal-ask-home', `found: ${reach.join(', ') || '(none)'}`);
  for (const n of reach) {
    const own = strip((info.get(n) as Info).own);
    const imports = /import \{[^}]*\breadOwnerAiConsent\b[^}]*\} from ['"]\.\.\/_shared\/aiConsent\.ts['"];/.test(own);
    const calls = /\bawait readOwnerAiConsent\(/.test(own);
    ok(`${n}: imports '../_shared/aiConsent.ts' and calls readOwnerAiConsent(`, imports && calls, `import=${imports} call=${calls}`);
    const proof = PROOFS[n];
    if (!proof) {
      ok(`${n}: an AI path with no user tap: prove every AI call sits behind _shared/aiConsent`, false, 'add a proof to PROOFS in this file');
      continue;
    }
    const proven = proof();
    ok(`${n}: every AI call sits behind _shared/aiConsent (proof above)`, proven);
    // The proof pins the calls in the files it names. Nothing else in the
    // function's whole source may touch an AI provider.
    const i = info.get(n) as Info;
    const touching = i.allList.filter((f) => {
      const src = readOr(f);
      if (AI_HOST.test(src) || UNDISCLOSED.test(src) || AI_TOUCH.test(src)) return true;
      return [...src.matchAll(/\/functions\/v1\/([a-z0-9-]+)/g)].some((m) => ai.has(m[1]));
    }).sort();
    const want = [...(AI_FILES[n] ?? [])].sort();
    ok(`${n}: across its whole source (${i.allList.length} files, imports followed) the only files that touch an AI provider are ${want.map((f) => f.replace('supabase/functions/', '')).join(' and ')}`,
      want.length > 0 && touching.join(',') === want.join(','), `found: ${touching.join(', ') || '(none)'}`);
    const siblings = i.ownList.filter((f) => !f.endsWith('/index.ts') && /\bfetch\(/.test(strip(readOr(f))));
    ok(`${n}: its own files beside index.ts make no network call (no fetch()`, siblings.length === 0, siblings.join(', '));
    // The vendor lists cannot name a vendor nobody has heard of yet. This can:
    // every destination in the whole source is on a short list, or it fails.
    const stray = i.allList.flatMap((f) => strayEgress(f, want.includes(f)));
    const netCalls = i.allList.reduce((sum, f) => sum + (strip(readOr(f)).match(/\bfetch(?:Impl)?\(/g) ?? []).length, 0);
    ok(`${n}: every network call in its whole source (${netCalls} calls) goes to our own database, to the email provider, or (only in the files above) to Google Gemini; every remote import is the Deno std library or supabase-js`,
      netCalls >= 5 && stray.length === 0, stray.join(' | '));
  }
  const staleProofs = Object.keys(PROOFS).filter((n) => !reach.includes(n));
  ok('no stale proof (each proven function is still an unattended AI path)', staleProofs.length === 0, staleProofs.join(', '));

  console.log('\nS2b. functions that only look like AI, and the ones left ungated on purpose');
  const hinted = unattended.filter((n) => (info.get(n) as Info).hint && !ai.has(n)).sort();
  for (const n of hinted) {
    const e = EXEMPT[n];
    ok(`${n}: reads an AI key or the model names, reaches no AI provider${e ? ` (${e.why})` : ''}`,
      !!e && e.pin(strip((info.get(n) as Info).own)), e ? 'the exemption’s pin no longer holds' : 'add it to EXEMPT with a reason and a pin, or gate it');
  }
  const staleExempt = Object.keys(EXEMPT).filter((n) => !hinted.includes(n));
  ok('no stale exemption (each exempt function is still unattended, AI-looking, and reaches no AI provider)', staleExempt.length === 0, staleExempt.join(', '));
  for (const [n, why] of Object.entries(NOT_GATED)) {
    const i = info.get(n);
    ok(`${n} is not gated by this answer, on purpose: ${why.split(':')[0]}`, !!i && i.unattended && !ai.has(n), i ? 'it now reaches an AI provider: gate it' : 'the function is gone: remove the entry');
  }

  const auth = strip(readOr('supabase/functions/_shared/auth.ts'));
  ok('_shared/auth.ts does not import aiConsent.ts (a check in requireTier would switch off every AI feature on web)',
    auth.length > 0 && !/aiConsent/.test(auth));
  const naming: string[] = [];
  const walkAll = (abs: string) => {
    for (const f of readdirSync(abs)) {
      const p = join(abs, f);
      if (statSync(p).isDirectory()) walkAll(p);
      else if (/\.(ts|js|json|sql|md)$/.test(f) && readOr(relative(ROOT, p)).includes('ai_consent')) naming.push(relative(ROOT, p));
    }
  };
  walkAll(join(ROOT, FN_REL));
  ok("the column name 'ai_consent' appears in no function file except _shared/aiConsent.ts and delete-account/index.ts",
    naming.sort().join(',') === 'supabase/functions/_shared/aiConsent.ts,supabase/functions/delete-account/index.ts', naming.join(', '));
}

// ════════════════════════════════════════════════════════════════════════════
// S5 — delete-account
// ════════════════════════════════════════════════════════════════════════════
function partS5(): void {
  console.log('\nS5. delete-account switches AI off before its first delete');
  const src = strip(read('supabase/functions/delete-account/index.ts'));
  const flip = src.indexOf('writesStarted = true;');
  const off = src.indexOf("ai_consent: 'declined'");
  const after = (needle: string) => { const i = src.indexOf(needle, flip); return i < 0 ? Infinity : i; };
  const firstWrite = Math.min(after('.update({ user_id: ownerId })'), after('.delete()'));
  ok("the ai_consent: 'declined' update sits after writesStarted = true; and before the first hand-over update and the first .delete()",
    flip > 0 && off > flip && off < firstWrite && Number.isFinite(firstWrite), `flip@${flip} off@${off} firstWrite@${firstWrite}`);
  ok('it sets the time with the answer (the column CHECK needs both) on the caller’s own row',
    /\.from\('profiles'\)\s*\.update\(\{ ai_consent: 'declined', ai_consent_at: aiOffAt, ai_consent_recorded_at: aiOffAt \}\)\s*\.eq\('id', userId\);/.test(src));
  const tryAt = src.lastIndexOf('try {', off);
  const catchAt = src.indexOf('} catch (e) {', off);
  const catchEnd = src.indexOf('}', catchAt + '} catch (e) {'.length);
  const block = tryAt > flip && catchAt > off && catchEnd > catchAt ? src.slice(tryAt, catchEnd + 1) : '';
  ok('it is inside a try whose catch does not return: a failure is logged and never stops the deletion',
    block.length > 0 && block.length < 900 && !/\breturn\b|\bthrow\b/.test(block) && count(block, 'console.warn(') === 2, block.slice(0, 160));
}

// ════════════════════════════════════════════════════════════════════════════
// S6 — the migration text
// ════════════════════════════════════════════════════════════════════════════
function partS6(): void {
  console.log('\nS6. migration 20261004090000_ai_consent.sql (text; the PGlite proof executes it)');
  const raw = readOr('supabase/migrations/20261004090000_ai_consent.sql');
  const sql = raw.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  const one = flat(sql);
  const cols = sql.split('\n').filter((l) => /add column if not exists/.test(l)).map((l) => l.trim());
  ok('four "add column if not exists" lines, exactly these',
    cols.join('|') === [
      'alter table public.profiles add column if not exists ai_consent text;',
      'alter table public.profiles add column if not exists ai_consent_at timestamptz;',
      'alter table public.profiles add column if not exists ai_consent_version smallint;',
      'alter table public.profiles add column if not exists ai_consent_recorded_at timestamptz;',
    ].join('|'), cols.join(' | '));
  ok('none of them carries a default or NOT NULL (NULL = never told = not allowed; no backfill)', cols.length === 4 && cols.every((l) => !/default|not null/i.test(l)));
  ok('no UPDATE of public.profiles outside the function (no backfill statement)',
    (one.match(/update public\.profiles/g) ?? []).length === 2 && !/insert into public\.profiles/.test(one));
  ok("CHECK: ai_consent is null or one of 'granted', 'declined'", one.includes("check (ai_consent is null or ai_consent in ('granted', 'declined'));"));
  ok('CHECK: an answer always has its time', one.includes('check (ai_consent is null or ai_consent_at is not null);'));
  const guard = sql.slice(sql.indexOf('create or replace function public.profiles_keep_ai_consent()'), sql.indexOf('revoke execute on function public.profiles_keep_ai_consent()'));
  ok("the guard pins the four columns for current_user in ('authenticated', 'anon'), INSERT and UPDATE",
    guard.includes("if current_user in ('authenticated', 'anon') then")
    && ['ai_consent', 'ai_consent_at', 'ai_consent_version', 'ai_consent_recorded_at'].every((c) => guard.includes(`new.${c} := null;`) && guard.includes(`new.${c} := old.${c};`))
    && /return new;/.test(guard));
  ok('the guard is SECURITY INVOKER (current_user is the role the statement runs as)', guard.length > 0 && !/security definer/i.test(guard));
  ok('both triggers exist: BEFORE UPDATE OF the four columns, and BEFORE INSERT',
    one.includes('create trigger profiles_keep_ai_consent before update of ai_consent, ai_consent_at, ai_consent_version, ai_consent_recorded_at on public.profiles for each row execute function public.profiles_keep_ai_consent();')
    && /create trigger profiles_keep_ai_consent_on_insert before insert on public\.profiles for each row when \([^;]*\) execute function public\.profiles_keep_ai_consent\(\);/.test(one));
  const fnHead = sql.slice(sql.indexOf('create or replace function public.set_my_ai_consent('), sql.indexOf('declare', sql.indexOf('create or replace function public.set_my_ai_consent(')));
  ok("set_my_ai_consent is security definer with set search_path to ''", /security definer/.test(fnHead) && fnHead.includes("set search_path to ''"));
  const fn = sql.slice(sql.indexOf('create or replace function public.set_my_ai_consent('), sql.indexOf('revoke all on function public.set_my_ai_consent'));
  ok('it writes only the caller’s own row (auth.uid()), and refuses when nobody is signed in',
    fn.includes('v_uid uuid := auth.uid();') && fn.includes('if v_uid is null then') && (fn.match(/where id = v_uid;/g) ?? []).length === 2 && fn.includes('where p.id = v_uid'));
  ok('the order rules are in the function: version floor, a yes needs a time, a stale yes is refused, the later no is kept',
    fn.includes('if p_version is null or p_version < 2 then')
    && fn.includes('if v_at is null then')
    && fn.includes("if v_old = 'declined' and (v_old_at is null or v_at <= v_old_at) then")
    && fn.includes("if v_old = 'declined' and v_old_at is not null and v_old_at > v_new_at then"));
  ok('revoke all on function public.set_my_ai_consent(text, bigint, integer) from public, anon; and the grant to authenticated',
    sql.includes('revoke all on function public.set_my_ai_consent(text, bigint, integer) from public, anon;')
    && sql.includes('grant execute on function public.set_my_ai_consent(text, bigint, integer) to authenticated;'));
  ok('no "create table", no "create policy", no grant or revoke on the table public.profiles',
    raw.length > 0 && !/create table/i.test(sql) && !/create policy/i.test(sql) && !/\b(grant|revoke)\b[^;]*\bon\s+(table\s+)?public\.profiles\b/i.test(sql));
  ok("it ends with notify pgrst, 'reload schema';", sql.trim().endsWith("notify pgrst, 'reload schema';"));
}

// ════════════════════════════════════════════════════════════════════════════
// C1 — the gate's answer event, executed
// ════════════════════════════════════════════════════════════════════════════
type Answer = 'granted' | 'declined';
type GateState = 'unknown' | Answer;
interface Gate {
  getState(): GateState;
  load(): Promise<GateState>;
  onAnswer?(fn: (a: Answer) => void): () => void;
  grant(): Promise<void>;
  decline(): Promise<void>;
  reset(): Promise<void>;
  setHost(h: { isWeb: boolean; prompt: () => Promise<boolean> } | null): void;
  ensure(): Promise<boolean>;
}
type AlertButton = { text: string; style?: string; onPress: () => void };
type ShowAlert = (title: string, message: string, buttons: AlertButton[], options: { cancelable: boolean; onDismiss: () => void }) => void;
interface CoreModule {
  createAiConsentGate(deps: { storage: { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> } }): Gate;
  AI_CONSENT_STORAGE_KEY: string;
  AI_CONSENT_META_KEY: string;
  AI_CONSENT_QUESTION_VERSION: number;
  AI_CONSENT_COPY: { title: string; autoHeading: string; auto: readonly string[]; use: string; allow: string; notNow: string; privacyLink: string; intro: string; providersHeading: string; providers: readonly string[]; sentHeading: string; sent: readonly string[] };
  AI_CONSENT_OFF_ROW: string;
  AI_ACCOUNT_COPY: Record<string, unknown>;
  AI_ACCOUNT_CONSENT_COPY: { title: string; intro: string; providersHeading: string; providers: readonly string[]; sentHeading: string; sent: readonly string[]; use: string; privacyLink: string; allow: string; notNow: string };
  aiConsentAlertMessage(): string;
  aiAccountConsentAlertMessage(): string;
  askAiConsentOnce(show: ShowAlert, openPolicy: () => void): Promise<boolean>;
  askAiAccountConsentOnce(show: ShowAlert, openPolicy: () => void): Promise<boolean>;
}

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    storage: {
      async getItem(k: string) { return map.has(k) ? (map.get(k) as string) : null; },
      async setItem(k: string, v: string) { map.set(k, v); },
      async removeItem(k: string) { map.delete(k); },
    },
  };
}
function fakeAlert() {
  const shown: { title: string; message: string; buttons: AlertButton[]; options: { cancelable: boolean; onDismiss: () => void } }[] = [];
  const show: ShowAlert = (title, message, buttons, options) => { shown.push({ title, message, buttons, options }); };
  const press = (i: number, text: string) => { shown[i]?.buttons.find((b) => b.text === text)?.onPress(); };
  return { shown, show, press };
}
const tick = (ms = 5) => new Promise<void>((r) => setTimeout(r, ms));
async function peek(p: Promise<boolean>): Promise<boolean | 'pending'> {
  return Promise.race([p, new Promise<'pending'>((r) => setTimeout(() => r('pending'), 5))]);
}

async function loadCore(): Promise<CoreModule | null> {
  try {
    return await import(srcPath('utils/aiConsentCore.ts')) as CoreModule;
  } catch (e) {
    ok('utils/aiConsentCore imports under bun', false, String(e));
    return null;
  }
}

async function partC1(core: CoreModule): Promise<void> {
  console.log('\nC1. the gate’s "the person answered" event (executed)');
  ok("the answer key is 'mageid_ai_consent_v2', the record key 'mageid_ai_consent_meta_v2', the question version 2",
    core.AI_CONSENT_STORAGE_KEY === 'mageid_ai_consent_v2' && core.AI_CONSENT_META_KEY === 'mageid_ai_consent_meta_v2' && core.AI_CONSENT_QUESTION_VERSION === 2,
    `${core.AI_CONSENT_STORAGE_KEY} ${core.AI_CONSENT_META_KEY} ${core.AI_CONSENT_QUESTION_VERSION}`);
  const KEY = core.AI_CONSENT_STORAGE_KEY;
  const make = (initial: Record<string, string> = {}) => {
    const s = fakeStorage(initial);
    const gate = core.createAiConsentGate({ storage: s.storage });
    const heard: string[] = [];
    const storedAtEvent: (string | undefined)[] = [];
    const off = typeof gate.onAnswer === 'function'
      ? gate.onAnswer((a) => { heard.push(a); storedAtEvent.push(s.map.get(KEY)); })
      : () => {};
    return { s, gate, heard, storedAtEvent, off };
  };
  if (!ok('the gate has onAnswer', typeof make().gate.onAnswer === 'function')) return;
  {
    const t = make();
    t.gate.setHost({ isWeb: false, prompt: async () => true });
    await t.gate.ensure();
    ok("\"Allow\" fires once with 'granted'", t.heard.join(',') === 'granted', t.heard.join(','));
    ok('…and fires AFTER the storage write (the answer is already on disk)', t.storedAtEvent[0] === 'granted', String(t.storedAtEvent[0]));
    await t.gate.ensure();
    await t.gate.load();
    ok('a later ensure() or load() of the same answer does not fire again', t.heard.length === 1, t.heard.join(','));
  }
  {
    const t = make();
    t.gate.setHost({ isWeb: false, prompt: async () => false });
    await t.gate.ensure();
    ok("\"Not now\" fires once with 'declined'", t.heard.join(',') === 'declined', t.heard.join(','));
  }
  {
    const t = make();
    const a = fakeAlert();
    t.gate.setHost({ isWeb: false, prompt: () => core.askAiConsentOnce(a.show, () => {}) });
    const e = t.gate.ensure();
    await tick();
    a.shown[0]?.options.onDismiss();
    await e;
    ok("a dismissed question fires once with 'declined'", t.heard.join(',') === 'declined', t.heard.join(','));
  }
  {
    const t = make();
    await t.gate.grant();
    await t.gate.decline();
    ok('grant() and decline() each fire', t.heard.join(',') === 'granted,declined', t.heard.join(','));
  }
  {
    const t = make();
    let release: (v: boolean) => void = () => {};
    t.gate.setHost({ isWeb: false, prompt: () => new Promise<boolean>((r) => { release = r; }) });
    const a = t.gate.ensure();
    const b = t.gate.ensure();
    await tick();
    release(true);
    await Promise.all([a, b]);
    ok('two racing ensure() calls fire once', t.heard.join(',') === 'granted', t.heard.join(','));
  }
  {
    const t = make({ [KEY]: 'granted' });
    await t.gate.load();
    await t.gate.reset();
    ok('reset() never fires (it is not an answer)', t.heard.length === 0 && t.gate.getState() === 'unknown', t.heard.join(','));
  }
  {
    const t = make({ [KEY]: 'declined' });
    await t.gate.load();
    t.s.map.delete(KEY);
    await t.gate.load();
    ok('load() after the key was removed never fires', t.heard.length === 0 && t.gate.getState() === 'unknown', t.heard.join(','));
  }
  {
    const t = make();
    t.gate.setHost({ isWeb: true, prompt: async () => true });
    const yes = await t.gate.ensure();
    ok('the web host never fires (and stores nothing)', yes === true && t.heard.length === 0 && !t.s.map.has(KEY));
  }
  {
    const t = make();
    const yes = await t.gate.ensure();
    ok('no host (not the app) never fires', yes === true && t.heard.length === 0);
  }
  {
    const t = make();
    const second: string[] = [];
    t.off();
    t.gate.onAnswer?.(() => { throw new Error('listener blew up'); });
    t.gate.onAnswer?.((a) => { second.push(a); });
    t.gate.setHost({ isWeb: false, prompt: async () => true });
    let threw = false;
    let yes = false;
    try { yes = await t.gate.ensure(); } catch { threw = true; }
    ok('a throwing listener does not break ensure(), and the next listener still hears it', !threw && yes === true && second.join(',') === 'granted');
    ok('an unsubscribed listener hears nothing', t.heard.length === 0);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// C2 — utils/aiConsentSyncCore, executed
// ════════════════════════════════════════════════════════════════════════════
type Account = Answer | null | 'no_profile' | 'missing_column' | 'unavailable' | 'unread';
interface Meta { uid: string | null; answer: Answer; at: number; delivered: boolean }
interface SyncModule {
  parseAiConsentMeta(raw: string | null | undefined): Meta | null;
  metaForAnswer(answer: Answer, uid: string | null | undefined, nowMs: number): Meta;
  isMissingAiConsentColumn(e: { code?: string; message?: string } | null | undefined): boolean;
  isMissingAiConsentFunction(m: string | null | undefined): boolean;
  accountAiConsentFromRead(r: unknown): Account;
  parseSetConsentResult(d: unknown): { ok: true; account: Answer | null; applied: boolean } | { ok: false; reason: string };
  decideReconcile(i: { userId: string | null | undefined; supabaseConfigured: boolean; account: Account; device: GateState; meta: Meta | null; nowMs: number }):
    { push: { answer: Answer; ageMs: number | null } | null; reason?: string };
  portalAccountNote(i: { owner: boolean; isWeb: boolean; ready: boolean; device: GateState; account: Account; pending: Answer | null }): { note: string; action: string | null };
  settingsAccountLine(i: { ready: boolean; device: GateState; seen: GateState | null; account: Account; pending: Answer | null; sendFailed: boolean }): { line: string; action: string | null };
}

async function partC2(): Promise<void> {
  console.log('\nC2. utils/aiConsentSyncCore (executed)');
  let m: SyncModule;
  try {
    m = await import(srcPath('utils/aiConsentSyncCore.ts')) as SyncModule;
  } catch (e) { ok('utils/aiConsentSyncCore imports under bun (pure)', false, String(e)); return; }
  const src = strip(read('utils/aiConsentSyncCore.ts'));
  ok('it is pure: its only import is a type from utils/aiConsentCore',
    (src.match(/^\s*import\b/gm) ?? []).length === 1 && /import type \{[^}]*\} from '\.\/aiConsentCore';/.test(src) && !/require\(/.test(src));

  const NOW = 1_800_000_000_000;
  const meta = (over: Partial<Meta> = {}): Meta => ({ uid: UID_A, answer: 'declined', at: NOW - 60_000, delivered: false, ...over });
  const dec = (over: Partial<Parameters<SyncModule['decideReconcile']>[0]>) =>
    m.decideReconcile({ userId: UID_A, supabaseConfigured: true, account: null, device: 'declined', meta: meta(), nowMs: NOW, ...over });
  const says = (d: ReturnType<SyncModule['decideReconcile']>) => (d.push ? `push ${d.push.answer} ${d.push.ageMs}` : `none ${d.reason}`);
  const row = (name: string, got: ReturnType<SyncModule['decideReconcile']>, want: string) => ok(`decideReconcile: ${name}`, says(got) === want, `got "${says(got)}", want "${want}"`);

  row('1 supabase not configured → nothing', dec({ supabaseConfigured: false }), 'none not_configured');
  row('1 signed out (null) → nothing', dec({ userId: null }), 'none signed_out');
  row('1 signed out (undefined / empty) → nothing', dec({ userId: '' }), 'none signed_out');
  row('2 the column is not there → nothing, even for an undelivered no', dec({ account: 'missing_column' }), 'none missing_column');
  row('3 the phone holds no answer → nothing', dec({ device: 'unknown' }), 'none no_device_answer');
  row('4 a no left by ANOTHER user is never sent to this account', dec({ meta: meta({ uid: UID_B }) }), 'none not_this_user');
  row('4 a yes left by ANOTHER user is never sent to this account (device granted + meta.uid of another user)',
    dec({ device: 'granted', meta: meta({ uid: UID_B, answer: 'granted' }) }), 'none not_this_user');
  row('6 declined, delivered → nothing', dec({ meta: meta({ delivered: true }) }), 'none delivered');
  row('6 declined, undelivered → push declined with its real age', dec({}), 'push declined 60000');
  row('6 device declined + account granted + undelivered → push declined', dec({ account: 'granted' }), 'push declined 60000');
  row('6 declined, undelivered, the clock moved back → push declined with no age', dec({ meta: meta({ at: NOW + 5000 }) }), 'push declined null');
  row('6 device declined + no meta → push declined with ageMs null (fail closed)', dec({ meta: null }), 'push declined null');
  row('6 declined, the record has no user → push declined with no age', dec({ meta: meta({ uid: null }) }), 'push declined null');
  row('6 declined, the record says granted → push declined with no age', dec({ meta: meta({ answer: 'granted', delivered: true }) }), 'push declined null');
  row('7 device granted + no meta → no push', dec({ device: 'granted', meta: null }), 'none no_meta');
  row('7 granted, the record has no user → no push', dec({ device: 'granted', meta: meta({ uid: null, answer: 'granted' }) }), 'none no_meta');
  row('7 granted, the record says declined → no push', dec({ device: 'granted', meta: meta({ answer: 'declined' }) }), 'none no_meta');
  row('7 granted, delivered → no push', dec({ device: 'granted', meta: meta({ answer: 'granted', delivered: true }) }), 'none delivered');
  row('7 granted, nowMs < meta.at (the clock moved back) → no push', dec({ device: 'granted', meta: meta({ answer: 'granted', at: NOW + 1 }) }), 'none clock_moved');
  row('7 granted, undelivered → push granted with its real age', dec({ device: 'granted', meta: meta({ answer: 'granted' }) }), 'push granted 60000');
  row('the account’s value is not consulted: an undelivered yes is sent even when the account already says yes (the server judges order)',
    dec({ device: 'granted', account: 'granted', meta: meta({ answer: 'granted' }) }), 'push granted 60000');
  row('…and when the account could not be read', dec({ device: 'granted', account: 'unavailable', meta: meta({ answer: 'granted', at: NOW }) }), 'push granted 0');

  const note = (over: Partial<Parameters<SyncModule['portalAccountNote']>[0]>) => {
    const r = m.portalAccountNote({ owner: true, isWeb: false, ready: true, device: 'declined', account: null, pending: null, ...over });
    return `${r.note}/${r.action}`;
  };
  const noteRow = (name: string, got: string, want: string) => ok(`portalAccountNote: ${name}`, got === want, `got ${got}, want ${want}`);
  noteRow('a collaborator (not the owner) sees nothing', note({ owner: false }), 'none/null');
  noteRow('a collaborator sees nothing on the web either, even when the account says yes', note({ owner: false, isWeb: true, account: 'granted' }), 'none/null');
  noteRow('not ready → nothing', note({ ready: false }), 'none/null');
  noteRow('account granted, phone → nothing', note({ account: 'granted', device: 'granted' }), 'none/null');
  noteRow('account granted, web → the "on" line with Turn off', note({ account: 'granted', isWeb: true, device: 'unknown' }), 'web_allowed/turn_off');
  noteRow('account never told (NULL) → the note with Allow', note({ account: null }), 'not_allowed/allow');
  noteRow('account declined → the note with Allow', note({ account: 'declined', device: 'unknown' }), 'not_allowed/allow');
  noteRow('account not yes, web → the note with Allow', note({ account: null, isWeb: true, device: 'unknown' }), 'not_allowed/allow');
  noteRow('account not yes, this phone’s yes is on its way → nothing', note({ account: null, device: 'granted', pending: 'granted' }), 'none/null');
  noteRow('account not yes, this phone says yes but nothing is pending (a refused or unrecorded yes) → the note with Allow', note({ account: 'declined', device: 'granted', pending: null }), 'not_allowed/allow');
  for (const a of ['unread', 'unavailable', 'missing_column', 'no_profile'] as const) noteRow(`account ${a} → nothing`, note({ account: a }), 'none/null');

  // `seen` defaults to the phone's answer: the sync has weighed the answer the phone has now.
  const line = (over: Partial<Parameters<SyncModule['settingsAccountLine']>[0]>) => {
    const base = { ready: true, device: 'declined' as GateState, account: null, pending: null, sendFailed: false, ...over };
    const r = m.settingsAccountLine({ ...base, seen: 'seen' in over ? (over.seen as GateState | null) : base.device });
    return `${r.line}/${r.action}`;
  };
  const lineRow = (name: string, got: string, want: string) => ok(`settingsAccountLine: ${name}`, got === want, `got ${got}, want ${want}`);
  lineRow('not ready → nothing', line({ ready: false, account: 'granted' }), 'none/null');
  lineRow('On, account yes → "also allows", no button', line({ device: 'granted', account: 'granted' }), 'also_allowed/null');
  lineRow('Off, account yes, a send of this no FAILED → "not been told yet" + Turn off', line({ device: 'declined', account: 'granted', pending: 'declined', sendFailed: true }), 'not_told_yet/turn_off');
  lineRow('Off, account yes, this no is still on its first way out → nothing (no "not told yet" flash before a send that is about to land)',
    line({ device: 'declined', account: 'granted', pending: 'declined', sendFailed: false }), 'none/null');
  ok('settingsAccountLine: a missing sendFailed flag is not a failure (nothing is said)',
    (() => { const r = m.settingsAccountLine({ ready: true, device: 'declined', seen: 'declined', account: 'granted', pending: 'declined' } as never); return `${r.line}/${r.action}` === 'none/null'; })());
  // The line speaks only about the answer the phone has NOW (no line or button that appears for a few frames and goes).
  lineRow('AI just switched Off, the sync still holds the yes it weighed before → nothing (never "allows" + Turn off for a few frames)',
    line({ device: 'declined', seen: 'granted', account: 'granted', pending: null }), 'none/null');
  lineRow('…the same state once the sync has weighed that no and found it already delivered → "allows" + Turn off',
    line({ device: 'declined', seen: 'declined', account: 'granted', pending: null }), 'allowed/turn_off');
  lineRow('the question is on screen (the phone’s answer was cleared, the sync last weighed a no) → nothing',
    line({ device: 'unknown', seen: 'declined', account: 'granted', pending: null }), 'none/null');
  lineRow('AI just switched On, the sync still holds the no → nothing (never "has not allowed" + Allow for a few frames)',
    line({ device: 'granted', seen: 'declined', account: 'declined', pending: null }), 'none/null');
  lineRow('the sync has not looked at the phone’s answer yet (seen null) → nothing', line({ device: 'granted', seen: null, account: 'granted' }), 'none/null');
  ok('settingsAccountLine: a missing `seen` says nothing (only the exact same answer counts)',
    (() => { const r = m.settingsAccountLine({ ready: true, device: 'granted', account: 'granted', pending: null, sendFailed: false } as never); return `${r.line}/${r.action}` === 'none/null'; })());
  lineRow('sendFailed alone never changes another row: Off and told earlier → "allows" + Turn off', line({ device: 'declined', account: 'granted', pending: null, sendFailed: true }), 'allowed/turn_off');
  lineRow('sendFailed alone never changes another row: On, account yes → "also allows"', line({ device: 'granted', account: 'granted', pending: 'granted', sendFailed: true }), 'also_allowed/null');
  lineRow('sendFailed alone never changes another row: On, account not yes, the yes waiting → nothing', line({ device: 'granted', account: null, pending: 'granted', sendFailed: true }), 'none/null');
  lineRow('Off, account yes, told earlier → "allows" + Turn off', line({ device: 'declined', account: 'granted', pending: null }), 'allowed/turn_off');
  lineRow('unanswered, account yes → "allows" + Turn off', line({ device: 'unknown', account: 'granted' }), 'allowed/turn_off');
  lineRow('On, account not yes, the yes is on its way → nothing', line({ device: 'granted', account: null, pending: 'granted' }), 'none/null');
  lineRow('On, account not yes → "has not allowed" + Allow', line({ device: 'granted', account: 'declined', pending: null }), 'not_allowed/allow');
  lineRow('Off, account not yes → "has not allowed", no button', line({ device: 'declined', account: null }), 'not_allowed/null');
  lineRow('unanswered, account not yes → nothing', line({ device: 'unknown', account: 'declined' }), 'none/null');
  for (const a of ['unread', 'unavailable', 'missing_column', 'no_profile'] as const) {
    for (const d of ['granted', 'declined', 'unknown'] as const) lineRow(`account ${a}, phone ${d} → nothing`, line({ account: a, device: d }), 'none/null');
  }

  const good = JSON.stringify({ uid: UID_A, answer: 'granted', at: 123, delivered: false });
  ok('parseAiConsentMeta: a valid record round-trips', JSON.stringify(m.parseAiConsentMeta(good)) === good);
  ok('parseAiConsentMeta: uid null is valid (answered while signed out)', m.parseAiConsentMeta(JSON.stringify({ uid: null, answer: 'declined', at: 1, delivered: true }))?.uid === null);
  const bad: [string, string | null | undefined][] = [
    ['bad JSON', '{not json'], ['null', null], ['undefined', undefined], ['empty', ''],
    ['a missing field (no delivered)', JSON.stringify({ uid: UID_A, answer: 'granted', at: 1 })],
    ["answer 'yes'", JSON.stringify({ uid: UID_A, answer: 'yes', at: 1, delivered: false })],
    ['at NaN (null in JSON)', JSON.stringify({ uid: UID_A, answer: 'granted', at: Number.NaN, delivered: false })],
    ['at a string', JSON.stringify({ uid: UID_A, answer: 'granted', at: '1', delivered: false })],
    ['delivered a string', JSON.stringify({ uid: UID_A, answer: 'granted', at: 1, delivered: 'true' })],
    ['uid empty', JSON.stringify({ uid: '', answer: 'granted', at: 1, delivered: false })],
    ['uid a number', JSON.stringify({ uid: 7, answer: 'granted', at: 1, delivered: false })],
    ['an array', '[]'], ['a string', '"granted"'],
  ];
  for (const [name, raw] of bad) ok(`parseAiConsentMeta refuses ${name}`, m.parseAiConsentMeta(raw) === null);
  ok('metaForAnswer: this user, this time, not yet delivered; a missing user is null',
    JSON.stringify(m.metaForAnswer('declined', UID_A, 99)) === JSON.stringify({ uid: UID_A, answer: 'declined', at: 99, delivered: false })
    && m.metaForAnswer('granted', undefined, 1).uid === null && m.metaForAnswer('granted', '', 1).uid === null);

  const fromRead = (r: unknown) => String(m.accountAiConsentFromRead(r));
  ok('accountAiConsentFromRead: no result → unavailable', fromRead(null) === 'unavailable' && fromRead(undefined) === 'unavailable');
  ok('accountAiConsentFromRead: 42703 and PGRST204 → missing_column',
    fromRead({ data: null, error: { code: '42703', message: 'x' } }) === 'missing_column' && fromRead({ data: null, error: { code: 'PGRST204', message: 'x' } }) === 'missing_column');
  ok('accountAiConsentFromRead: a message naming ai_consent "does not exist" → missing_column',
    fromRead({ data: null, error: { message: 'column profiles.ai_consent does not exist' } }) === 'missing_column');
  ok('accountAiConsentFromRead: another error → unavailable', fromRead({ data: null, error: { code: '500', message: 'timeout' } }) === 'unavailable');
  ok('accountAiConsentFromRead: data null → no_profile', fromRead({ data: null, error: null }) === 'no_profile');
  ok('accountAiConsentFromRead: a row with no ai_consent key → null (never told)', m.accountAiConsentFromRead({ data: {}, error: null }) === null);
  ok("accountAiConsentFromRead: 'yes' → null; 'granted' / 'declined' → that",
    m.accountAiConsentFromRead({ data: { ai_consent: 'yes' }, error: null }) === null
    && fromRead({ data: { ai_consent: 'granted' }, error: null }) === 'granted'
    && fromRead({ data: { ai_consent: 'declined' }, error: null }) === 'declined');
  ok('isMissingAiConsentFunction: PostgREST’s "Could not find the function … set_my_ai_consent" → true; anything else → false',
    m.isMissingAiConsentFunction('Could not find the function public.set_my_ai_consent(p_age_ms, p_answer, p_version) in the schema cache') === true
    && m.isMissingAiConsentFunction('PGRST202: set_my_ai_consent') === true
    && m.isMissingAiConsentFunction('Could not find the function public.other_fn in the schema cache') === false
    && m.isMissingAiConsentFunction('permission denied for function set_my_ai_consent') === false
    && m.isMissingAiConsentFunction(null) === false);
  const ps = (d: unknown) => JSON.stringify(m.parseSetConsentResult(d));
  ok('parseSetConsentResult: { ok:true, applied:true, ai_consent:"granted" } → heard, applied',
    ps({ ok: true, applied: true, ai_consent: 'granted', ai_consent_at: 'x' }) === JSON.stringify({ ok: true, account: 'granted', applied: true }));
  ok('parseSetConsentResult: a refused stale yes is still heard (ok, not applied, the account’s value)',
    ps({ ok: true, applied: false, reason: 'stale', ai_consent: 'declined' }) === JSON.stringify({ ok: true, account: 'declined', applied: false })
    && ps({ ok: true, applied: false, reason: 'no_time', ai_consent: null }) === JSON.stringify({ ok: true, account: null, applied: false }));
  ok('parseSetConsentResult: { ok:false, reason } → not heard, with the reason', ps({ ok: false, reason: 'no_profile' }) === JSON.stringify({ ok: false, reason: 'no_profile' }));
  ok('parseSetConsentResult: an array, null, a string, or ok:true with a strange value → bad_response',
    [[], null, 'granted', 7, { ok: true, ai_consent: 'yes' }, { ok: true }, { applied: true, ai_consent: 'granted' }].every((d) => ps(d) === JSON.stringify({ ok: false, reason: 'bad_response' })));
}

// ════════════════════════════════════════════════════════════════════════════
// C3 — the wiring (static)
// ════════════════════════════════════════════════════════════════════════════
function partC3(): void {
  console.log('\nC3. the wiring: one read, one rpc write, no grant on the phone');
  const acct = strip(readOr('utils/aiConsentAccount.ts'));
  ok('utils/aiConsentAccount.ts has exactly ONE read: .from(\'profiles\').select(\'ai_consent\').eq(\'id\', userId).maybeSingle()',
    count(acct, '.from(') === 1 && /supabase\.from\('profiles'\)\.select\('ai_consent'\)\.eq\('id', userId\)\.maybeSingle\(\)/.test(acct));
  const rpcAt = acct.search(/supabaseRpcOnline<unknown>\(\s*'set_my_ai_consent'/);
  ok("…and exactly ONE write: supabaseRpcOnline('set_my_ai_consent', …) with the question version, and no `record`",
    (acct.match(/\bsupabaseRpcOnline\b/g) ?? []).length === 2 && rpcAt > 0 && !/\.rpc\(/.test(acct)
    && /p_answer: answer,\s*p_age_ms: ageMs,\s*p_version: AI_CONSENT_QUESTION_VERSION,\s*\}\);/.test(acct) && !/\brecord\s*:/.test(acct));
  ok('…sent only while the person it is for is the one signed in (the function writes the CALLER’s row)',
    acct.indexOf('if (snap.userId !== userId) return { ok: false };') > 0 && acct.indexOf('if (snap.userId !== userId) return { ok: false };') < rpcAt
    && acct.indexOf('if (data?.session?.user?.id !== userId) return { ok: false };') > 0 && acct.indexOf('if (data?.session?.user?.id !== userId) return { ok: false };') < rpcAt);
  const forbidden = ['supabaseWrite', '.update(', '.upsert(', '.insert(', 'grantAiConsent', 'setItem(AI_CONSENT_STORAGE_KEY', 'removeItem(', 'loadAiConsent(', 'getAiConsentState(']
    .filter((w) => acct.includes(w));
  ok('it never queues or writes profiles directly, never grants on the phone, never writes the phone’s answer, and reads storage directly (not the gate’s memory)',
    acct.length > 0 && forbidden.length === 0, `found: ${forbidden.join(', ')}`);
  ok('the only storage write is the record (AI_CONSENT_META_KEY); the device answer is read with getItem(AI_CONSENT_STORAGE_KEY) in a try/catch',
    count(acct, 'setItem(') === 1 && acct.includes('AsyncStorage.setItem(AI_CONSENT_META_KEY, JSON.stringify(m))')
    && /try \{\s*return parseAiConsent\(await AsyncStorage\.getItem\(AI_CONSENT_STORAGE_KEY\)\);\s*\} catch \{\s*return 'unknown';\s*\}/.test(acct));
  ok('the pre-sign-out run sends a no only (onlyDeclined stops a yes)', acct.includes("if (opts?.onlyDeclined && d.push.answer !== 'declined') return;")
    && acct.indexOf("if (opts?.onlyDeclined && d.push.answer !== 'declined') return;") < acct.indexOf('const r = await sendAnswer(userId, answer, d.push.ageMs);'));

  const wrapper = strip(readOr('utils/aiConsent.ts'));
  ok('utils/aiConsent.ts imports none of aiConsentAccount / lib/supabase / offlineQueue (bun validators import AI utils through it)',
    wrapper.length > 0 && !/aiConsentAccount|lib\/supabase|offlineQueue|react-native['"]/.test(wrapper));
  ok('utils/aiConsent.ts exposes the answer event and the new constants',
    /export const subscribeAiConsentAnswer = \(fn: \(a: 'granted' \| 'declined'\) => void\): \(\(\) => void\) => gate\.onAnswer\(fn\);/.test(wrapper)
    && /onAnswer: subscribeAiConsentAnswer,/.test(wrapper)
    && ['AI_CONSENT_META_KEY', 'AI_CONSENT_QUESTION_VERSION', 'AI_ACCOUNT_COPY', 'AI_ACCOUNT_CONSENT_COPY', 'aiAccountConsentAlertMessage', 'askAiAccountConsentOnce'].every((n) => new RegExp(`\\b${n},`).test(wrapper)));

  const LANE = ['utils/aiConsentAccount.ts', 'utils/aiConsentSyncCore.ts', 'hooks/useAccountAi.ts', 'components/AiConsentAccountSync.tsx', 'components/AiAccountNote.tsx'];
  const granting = LANE.filter((f) => /grantAiConsent|\.grant\(/.test(strip(readOr(f))));
  ok('no file in this lane calls grantAiConsent (a yes on the account is never copied onto a phone)',
    LANE.every((f) => readOr(f).length > 0) && granting.length === 0, granting.join(', '));

  const layout = strip(readOr('app/_layout.tsx'));
  const mountAt = layout.indexOf('<AiConsentAccountSync />');
  ok('app/_layout.tsx imports and mounts <AiConsentAccountSync /> once, inside AuthProvider',
    /import \{ AiConsentAccountSync \} from "@\/components\/AiConsentAccountSync";/.test(layout)
    && count(layout, '<AiConsentAccountSync />') === 1
    && mountAt > layout.indexOf('<AuthProvider>') && layout.indexOf('<AuthProvider>') > 0 && mountAt < layout.indexOf('</AuthProvider>'));

  const sync = strip(readOr('components/AiConsentAccountSync.tsx'));
  ok('AiConsentAccountSync: the answer event writes the record and reconciles', /subscribeAiConsentAnswer\(\(answer\) => \{\s*void noteAiAnswer\(userIdRef\.current, answer\);\s*\}\)/.test(sync));
  ok('AiConsentAccountSync: sign-in reads the account, then reconciles',
    /resetAccountAi\(userId\);\s*if \(!userId \|\| !isSupabaseConfigured\) return;/.test(sync)
    && sync.indexOf('await refreshAccountAiConsent(userId);') > 0 && sync.indexOf('await refreshAccountAiConsent(userId);') < sync.indexOf('await reconcileAiConsent(userId);'));
  // The foreground handler must END in a reconcile run: a listener that is
  // registered and does nothing would lose an undelivered no with every other
  // check green (the jest suite fires the handler; this pins the text).
  const fgAt = sync.indexOf("AppState.addEventListener('change'");
  const cleanupAt = sync.indexOf('return () => { sub.remove(); };', fgAt);
  const foreground = fgAt > 0 && cleanupAt > fgAt ? sync.slice(fgAt, cleanupAt) : '';
  ok('AiConsentAccountSync: it listens for the foreground, once', count(sync, "AppState.addEventListener('change'") === 1 && foreground.length > 0);
  ok('AiConsentAccountSync: the foreground handler runs a reconcile when the app is active and someone is signed in',
    /if \(state !== 'active' \|\| !uid \|\| !isSupabaseConfigured\) return;/.test(foreground)
    && /if \(userIdRef\.current !== uid\) return;\s*await reconcileAiConsent\(uid\);/.test(foreground)
    && foreground.indexOf("if (state !== 'active'") < foreground.indexOf('await reconcileAiConsent(uid);')
    && count(foreground, 'return;') === 2 && count(foreground, 'return') === 2,
    foreground.slice(0, 200));
  // "Back online" is NOT a trigger. The app has no NetInfo; react-query's
  // onlineManager only hears the browser's online/offline events, so on an
  // iPhone it never fires, and the web app holds no phone answer to send. A
  // listener here would be a trigger that exists only on paper. The retry that
  // is real on a phone is the timer in utils/aiConsentAccount (executed in C5).
  ok('AiConsentAccountSync: no "back online" listener (onlineManager never fires on an iPhone; the timed retry in utils/aiConsentAccount is the real one)',
    sync.length > 0 && !/onlineManager|NetInfo|addEventListener\('online'/.test(sync));
  ok('AiConsentAccountSync: reconcileAiConsent( is called in three places (sign-in, foreground, before sign-out)', count(sync, 'reconcileAiConsent(') === 3, `found ${count(sync, 'reconcileAiConsent(')}`);
  ok('AiConsentAccountSync: registerPreSignOutFlush( sends with onlyDeclined: true, bounded by a timer',
    /registerPreSignOutFlush\(\(\) => \{[\s\S]{0,300}reconcileAiConsent\(userIdRef\.current, \{ onlyDeclined: true \}\)/.test(sync) && /Promise\.race\(/.test(sync));
  ok('AiConsentAccountSync: the web asks through askAiAccountConsentOnce (pressed in C4), with the app’s own alert',
    /askAccount: \(\) => askAiAccountConsentOnce\(showAlert, openPrivacyPolicy\)/.test(sync) && /isWeb: Platform\.OS === 'web'/.test(sync) && /setAccountAiHost\(null\)/.test(sync));

  ok('the timed retry: a failed send is tried again every 30 s (AI_CONSENT_RETRY_MS), one timer at a time',
    acct.includes('export const AI_CONSENT_RETRY_MS = 30_000;') && acct.includes('let retryMs = AI_CONSENT_RETRY_MS;')
    && count(acct, 'setTimeout(') === 2 && /retryTimer = setTimeout\(\(\) => \{\s*retryTimer = null;\s*void reconcileAiConsent\(userId\);\s*\}, retryMs\);/.test(acct)
    && /function armRetry\(userId: string\): void \{\s*clearRetry\(\);/.test(acct));
  {
    const SETTER = 'setAiConsentRetryMsForTests(';
    const callers: string[] = [];
    const walkApp = (rel: string) => {
      for (const f of readdirSync(join(ROOT, rel))) {
        if (f === 'node_modules' || f.startsWith('.')) continue;
        const child = join(rel, f);
        if (statSync(join(ROOT, child)).isDirectory()) walkApp(child);
        else if (/\.(ts|tsx|js|jsx)$/.test(f) && strip(readOr(child)).includes(SETTER)) callers.push(child);
      }
    };
    for (const d of ['app', 'components', 'contexts', 'hooks', 'lib', 'utils']) if (existsSync(join(ROOT, d))) walkApp(d);
    ok('…and no app file changes that delay (the test-only setter is named in utils/aiConsentAccount.ts alone, once: its definition)',
      callers.join(',') === 'utils/aiConsentAccount.ts' && count(acct, SETTER) === 1, callers.join(', '));
  }

  const hook = strip(readOr('hooks/useAccountAi.ts'));
  ok('useAccountAi: ready only for the signed-in person, after a reconcile run AND after the phone’s own answer was loaded',
    hook.includes('ready: deviceLoaded && snap.ready && snap.userId === userId,') && /if \(!alive\) return;/.test(hook));
  // The hook is the one place the snapshot reaches the screens. Each line that
  // carries a field is pinned: a constant in its place (sendFailed: true,
  // isWeb: false) changes what a screen says with every executed check green.
  ok('useAccountAi: passes the snapshot through as it is (pending, sendFailed, seen), never a constant',
    hook.includes('account: snap.account,') && hook.includes('pending: snap.pending,') && hook.includes('sendFailed: snap.sendFailed,') && hook.includes('seen: snap.seen,')
    && count(hook, 'sendFailed:') === 3 && count(hook, 'seen:') === 3 && count(hook, 'pending:') === 4,
    `sendFailed: x${count(hook, 'sendFailed:')}, seen: x${count(hook, 'seen:')}, pending: x${count(hook, 'pending:')} (the type, the pass-through, and one per screen rule)`);
  const portalHook = topLevelBlock(hook, 'export function usePortalAccountNote(');
  const settingsHook = topLevelBlock(hook, 'export function useSettingsAccountLine(');
  ok('usePortalAccountNote: the web flag is the platform (isWeb: Platform.OS === \'web\'), and the note is fed the real owner, ready, device, account, pending',
    /portalAccountNote\(\{\s*owner,\s*isWeb: Platform\.OS === 'web',\s*ready: ai\.ready,\s*device: ai\.device,\s*account: ai\.account,\s*pending: ai\.pending,\s*\}\)/.test(portalHook)
    && count(hook, 'isWeb') === 1 && /import \{ Platform \} from 'react-native';/.test(hook));
  ok('useSettingsAccountLine: the line is fed the real ready, device, seen, account, pending, sendFailed',
    /settingsAccountLine\(\{\s*ready: ai\.ready,\s*device: ai\.device,\s*seen: ai\.seen,\s*account: ai\.account,\s*pending: ai\.pending,\s*sendFailed: ai\.sendFailed,\s*\}\)/.test(settingsHook));
  const noteFile = strip(readOr('components/AiAccountNote.tsx'));
  ok('AiAccountNote / AiAccountSettingsLine render nothing for "none", and their buttons ask or turn off through utils/aiConsentAccount',
    noteFile.includes("if (note === 'none') return null;") && noteFile.includes("if (line === 'none') return null;")
    && noteFile.includes('askAiConsentForAccount(userId)') && noteFile.includes('turnOffAiForAccount(userId)')
    && ['ai-account-note', 'ai-account-allow', 'ai-account-turn-off', 'ai-account-settings-line', 'ai-account-settings-action'].every((id) => noteFile.includes(`testID="${id}"`)));

  const setup = strip(readOr('app/client-portal-setup.tsx'));
  ok('client-portal-setup: turning the recap on asks, and either answer turns it on',
    setup.includes('if (val) await ensureAiConsent();') && !/val && !\(await ensureAiConsent\(\)\)/.test(setup));
  ok('client-portal-setup: const accountAi = usePortalAccountNote(isOwner); and <AiAccountNote owner={isOwner} />',
    setup.includes('const accountAi = usePortalAccountNote(isOwner);') && count(setup, '<AiAccountNote owner={isOwner} />') === 1);
  ok('client-portal-setup: the "AI strips the contractor jargon" subtitle is replaced while the account has not allowed AI',
    /\{accountAi\.note === 'not_allowed'\s*\? <Text style=\{styles\.sectionSubtitle\}>\{AI_ACCOUNT_COPY\.recapSubtitlePlain\}<\/Text>\s*: \(/.test(setup));
  const gateAt = setup.indexOf('if (!(await ensureAiConsent())) { showAlert(AI_CONSENT_OFF_TITLE, AI_CONSENT_OFF_MESSAGE); return; }');
  const settleAt = setup.indexOf('await settleAiConsentSync();');
  const invokeAt = setup.indexOf("supabase.functions.invoke('homeowner-weekly-digest'");
  ok('client-portal-setup: the preview keeps the phone’s refusal, then await settleAiConsentSync(); BEFORE the homeowner-weekly-digest invoke',
    gateAt > 0 && settleAt > gateAt && invokeAt > settleAt, `gate@${gateAt} settle@${settleAt} invoke@${invokeAt}`);
  ok("client-portal-setup: the preview alert says previewSentPlain on 'plain_ai_off' and previewSentUnchecked on 'plain_ai_unknown'",
    /recap === 'plain_ai_off'\s*\? AI_ACCOUNT_COPY\.previewSentPlain\(sent\)\s*: recap === 'plain_ai_unknown'\s*\? AI_ACCOUNT_COPY\.previewSentUnchecked\(sent\)\s*:/.test(setup)
    && setup.includes('const recap = (data as { recap?: string } | null)?.recap;'));

  const settings = strip(readOr('app/(tabs)/settings/index.tsx'));
  const rowAt = settings.indexOf('testID="ai-features-row"');
  const lineAt = settings.indexOf('<AiAccountSettingsLine />');
  ok('settings: <AiAccountSettingsLine /> sits once, inside the ai-features-row, under the row’s own sentence',
    count(settings, '<AiAccountSettingsLine />') === 1 && rowAt > 0 && lineAt > rowAt && lineAt < settings.indexOf('testID="ai-features-switch"')
    && /<\/Text>\s*<AiAccountSettingsLine \/>\s*<\/View>/.test(settings) && !/grantAiConsent/.test(settings));

  const OLD_KEY = ['mageid', 'ai', 'consent', 'v1'].join('_');
  const holders: string[] = [];
  const walk = (rel: string) => {
    for (const f of readdirSync(join(ROOT, rel))) {
      if (f === 'node_modules' || f.startsWith('.')) continue;
      const child = join(rel, f);
      if (statSync(join(ROOT, child)).isDirectory()) walk(child);
      else if (/\.(ts|tsx|js|jsx|json|snap)$/.test(f) && readOr(child).includes(OLD_KEY)) holders.push(child);
    }
  };
  for (const d of ['app', 'components', 'contexts', 'hooks', 'lib', 'utils', '__tests__']) if (existsSync(join(ROOT, d))) walk(d);
  ok('no runtime or test file names the old answer key (everyone is asked once more, by the question that names the server features)', holders.length === 0, holders.join(', '));
}

// ════════════════════════════════════════════════════════════════════════════
// C4 — the copy
// ════════════════════════════════════════════════════════════════════════════
const WANT = {
  autoHeading: 'Sent automatically, with no tap from you, to Google Gemini',
  auto: [
    'For a weekly client recap you switch on for a job: that job’s name and location, the week’s daily report text and completed task names',
    'For Ask Your Home in the client portal: your client’s typed questions and the Home Passport records that match them',
  ],
  use: 'It is used only to answer that request or write that recap. Nothing is sent from this app until you allow it, and you can turn AI features off any time in Settings → AI features.',
  offRow: 'AI buttons in this app send nothing to an AI provider until you turn this on. '
    + 'The weekly client recap and Ask Your Home run on our server and follow the answer saved on your account. '
    + 'A Claude connection you set up keeps working until you revoke it in Settings → Connect Claude.',
  web: {
    title: 'Use AI for the weekly recap and Ask Your Home?',
    intro: 'Two client portal features run on our server and use an outside AI service, with no tap from you each time.',
    providersHeading: 'Who receives it',
    providers: ['Google Gemini'],
    sentHeading: 'What is sent',
    use: 'It is used only to write that recap or answer that question. This answer covers the weekly client recap and Ask Your Home on every job you own. AI buttons in the web app are not changed by it. You can turn it off any time on a job’s Client portal screen.',
    privacyLink: 'Privacy policy',
    allow: 'Allow',
    notNow: 'Not now',
  },
  account: {
    recapNote: 'Your account has not allowed AI for the weekly client recap and Ask Your Home. With the recap switched on, your client gets a plain summary: days on site, trades on site, milestones reached, and photo and change order counts. Ask Your Home does not answer questions your client types in the portal.',
    recapSubtitlePlain: 'We email your client a recap every Friday with what got done this week. Off until you toggle it on.',
    allow: 'Allow AI features',
    webOn: 'Your account allows AI for the weekly client recap and Ask Your Home, on every job you own.',
    turnOff: 'Turn off',
    settingsAlso: 'Your account also allows AI on our server for the weekly client recap and Ask Your Home, on jobs where you set them up.',
    settingsAllowed: 'Your account allows AI on our server for the weekly client recap and Ask Your Home.',
    settingsNotToldYet: 'Your account has not been told yet, so the weekly client recap and Ask Your Home still use AI. This phone tries again while the app is open and each time you open it.',
    settingsNotAllowed: 'Your account has not allowed AI for the weekly client recap and Ask Your Home: a recap you switch on goes out as a plain summary with no AI, and Ask Your Home does not answer client questions.',
    turnOffForAccount: 'Turn off for my account',
    allowForAccount: 'Allow for my account',
    saveFailedTitle: 'Not saved',
    saveFailed: 'We could not reach your account, so nothing changed. Check your connection and try again.',
  } as Record<string, string>,
  previewPlain1: 'Sent the recap to 1 portal invite as a plain summary with no AI, because your account has not allowed AI for the weekly client recap. Check your inbox or your client’s.',
  previewPlain3: 'Sent the recap to 3 portal invites as a plain summary with no AI, because your account has not allowed AI for the weekly client recap. Check your inbox or your client’s.',
  previewUnchecked2: 'Sent the recap to 2 portal invites as a plain summary with no AI, because we could not check your account’s AI setting just now. Check your inbox or your client’s.',
  privacy: "<p>In the phone app, AI features send nothing until you allow them, and you can turn them off in Settings. Two client portal features use AI on our server without a tap from you each time: the weekly client recap (Google Gemini writes the email from that job's name and location, the week's daily report text and completed task names) and Ask Your Home (your client's typed question and the matching Home Passport records go to Google Gemini). Both use AI only while your account's answer to the AI question is yes; you give or change that answer in the app. Otherwise the recap is sent as a plain summary written without AI, and Ask Your Home does not answer. A Claude connection you set up in Settings is separate: it lets the Claude app you connected read your project data until you revoke its token.</p>",
};

async function partC4(core: CoreModule): Promise<void> {
  console.log('\nC4. the copy');
  const c = core.AI_CONSENT_COPY;
  const list = (items: readonly string[]) => items.map((s) => `• ${s}`).join('\n');
  ok('the phone’s question has the automatic block: heading and two lines, exact',
    c.autoHeading === WANT.autoHeading && JSON.stringify(c.auto) === JSON.stringify(WANT.auto));
  ok('the phone’s question: `use` is exact', c.use === WANT.use, c.use);
  const msg = core.aiConsentAlertMessage();
  ok('the phone’s question reads intro, who receives it, what is sent, what is sent automatically, use',
    msg === [c.intro, `${c.providersHeading}:\n${list(c.providers)}`, `${c.sentHeading}:\n${list(c.sent)}`, `${WANT.autoHeading}:\n${list(WANT.auto)}`, WANT.use].join('\n\n'));
  ok('the phone’s question names "weekly client recap", "Ask Your Home" and "with no tap from you"',
    msg.includes('weekly client recap') && msg.includes('Ask Your Home') && msg.includes('with no tap from you'));
  ok('title and buttons of the phone’s question are unchanged', c.title === 'Use AI features?' && c.allow === 'Allow AI features' && c.notNow === 'Not now' && c.privacyLink === 'Privacy policy');

  const w = core.AI_ACCOUNT_CONSENT_COPY;
  ok('the web question: every field is exact, and "What is sent" is the same two lines as the phone’s automatic block',
    w.title === WANT.web.title && w.intro === WANT.web.intro && w.providersHeading === WANT.web.providersHeading
    && JSON.stringify(w.providers) === JSON.stringify(WANT.web.providers) && w.sentHeading === WANT.web.sentHeading
    && JSON.stringify(w.sent) === JSON.stringify(WANT.auto) && w.use === WANT.web.use
    && w.privacyLink === WANT.web.privacyLink && w.allow === WANT.web.allow && w.notNow === WANT.web.notNow);
  const webMsg = core.aiAccountConsentAlertMessage();
  ok('the web question reads intro, who receives it, what is sent, use',
    webMsg === [WANT.web.intro, `Who receives it:\n${list(['Google Gemini'])}`, `What is sent:\n${list(WANT.auto)}`, WANT.web.use].join('\n\n'));
  ok('the web question says neither "Nothing is sent from this app" nor "Settings → AI features" (neither is true on the web)',
    !webMsg.includes('Nothing is sent from this app') && !webMsg.includes('Settings → AI features') && !w.title.includes('Settings'));
  ok('the web question names only Google Gemini', webMsg.includes('Google Gemini') && !/Anthropic|Claude|speech-to-text|Rork/.test(webMsg));
  {
    const a = fakeAlert();
    const p = core.askAiAccountConsentOnce(a.show, () => {});
    const first = a.shown[0];
    ok('the web question, shown: its title, its full text, three answers, "Not now" is the cancel answer',
      a.shown.length === 1 && first.title === WANT.web.title && first.message === webMsg
      && first.buttons.map((b) => b.text).join('|') === 'Privacy policy|Not now|Allow' && first.buttons[1].style === 'cancel' && first.options.cancelable === false);
    ok('nothing is answered until a button is pressed', (await peek(p)) === 'pending');
    a.press(0, 'Allow');
    ok('"Allow" → yes', (await peek(p)) === true);
  }
  {
    const a = fakeAlert();
    const p = core.askAiAccountConsentOnce(a.show, () => {});
    a.press(0, 'Not now');
    ok('"Not now" → no', (await peek(p)) === false);
    a.press(0, 'Allow');
    ok('the first answer wins', (await p) === false);
  }
  {
    const a = fakeAlert();
    const p = core.askAiAccountConsentOnce(a.show, () => {});
    a.shown[0]?.options.onDismiss();
    ok('a dismissed web question → no (never a silent yes)', (await peek(p)) === false);
  }
  {
    const a = fakeAlert();
    let opened = 0;
    const p = core.askAiAccountConsentOnce(a.show, () => { opened += 1; });
    a.press(0, 'Privacy policy');
    ok('"Privacy policy" opens the policy, is not an answer, and the question comes back', opened === 1 && a.shown.length === 2 && (await peek(p)) === 'pending');
    a.press(0, 'Allow');
    ok('the spent first alert can no longer answer', (await peek(p)) === 'pending');
    a.press(1, 'Allow');
    ok('…and the second alert’s "Allow" → yes', (await peek(p)) === true);
  }
  {
    // askAiConsentOnce shares the same answer logic; its own words must not have moved.
    const a = fakeAlert();
    void core.askAiConsentOnce(a.show, () => {});
    ok('the phone’s question still shows its own title, text and answers',
      a.shown[0]?.title === 'Use AI features?' && a.shown[0]?.message === msg && a.shown[0]?.buttons.map((b) => b.text).join('|') === 'Privacy policy|Not now|Allow AI features');
  }

  ok('Settings → AI features, Off: the row is exact', core.AI_CONSENT_OFF_ROW === WANT.offRow, core.AI_CONSENT_OFF_ROW);
  ok('…it does not say the account was told, and no longer says the server "still uses AI"',
    !core.AI_CONSENT_OFF_ROW.includes('still uses AI on our server') && !core.AI_CONSENT_OFF_ROW.includes('when this phone is online'));

  const acc = core.AI_ACCOUNT_COPY;
  const wrong = Object.keys(WANT.account).filter((k) => acc[k] !== WANT.account[k]);
  ok('AI_ACCOUNT_COPY: every sentence and label is exact', wrong.length === 0, `differs: ${wrong.join(', ')}`);
  const plain = acc.previewSentPlain as ((n: number) => string) | undefined;
  const unchecked = acc.previewSentUnchecked as ((n: number) => string) | undefined;
  ok('AI_ACCOUNT_COPY: the two preview sentences are exact (singular and plural)',
    typeof plain === 'function' && typeof unchecked === 'function'
    && plain(1) === WANT.previewPlain1 && plain(3) === WANT.previewPlain3 && unchecked(2) === WANT.previewUnchecked2);
  ok('the "not told yet" line promises only what the phone does: it tries again while the app is open (the timer) and each time it is opened; it never claims to know when the phone is online',
    !/online|connection|signal/i.test(String(acc.settingsNotToldYet)) && String(acc.settingsNotToldYet).includes('while the app is open and each time you open it'));
  ok('the web "on" line says neither "Nothing is sent from this app" nor "Settings → AI features"',
    !String(acc.webOn).includes('Nothing is sent from this app') && !String(acc.webOn).includes('Settings → AI features'));

  const privacy = readOr('marketing/privacy.html');
  ok('marketing/privacy.html carries the paragraph, exact, before "AI prompts are not used to train…"',
    privacy.includes(WANT.privacy) && privacy.indexOf(WANT.privacy) < privacy.indexOf('<p>AI prompts are not used to train third-party foundation models.'));
  ok('…with "Both use AI only while your account\'s answer to the AI question is yes"', privacy.includes("Both use AI only while your account's answer to the AI question is yes"));

  const serverLine = /const ASK_AI_OFF_LINE = "([^"]+)";/.exec(readOr('supabase/functions/portal-ask-home/index.ts'))?.[1] ?? '';
  const appStrings = [
    c.autoHeading, ...c.auto, c.use, core.AI_CONSENT_OFF_ROW, webMsg, w.title, w.allow, w.notNow,
    ...Object.keys(WANT.account).map((k) => String(acc[k])), plain ? plain(2) : '', unchecked ? unchecked(2) : '',
  ];
  const everything = [...appStrings, serverLine, WANT.privacy];
  ok('American spelling in every new string', !everything.some((s) => /analys(e|ing)|authoris|organis|colour|licence\b|favour|summaris|recognis/i.test(s)));
  ok('never "unlimited"', !everything.some((s) => /unlimited/i.test(s)));
  ok('no em dash in the new strings', serverLine.length > 0 && !everything.some((s) => s.includes('—')));
  ok('the app strings use the typographic apostrophe, like their neighbors', !appStrings.some((s) => s.includes("'")));
}

// ════════════════════════════════════════════════════════════════════════════
// C5 — utils/aiConsentAccount, executed with fakes
// ════════════════════════════════════════════════════════════════════════════
// The wiring that marks an answer "heard by the account" and the web write
// path. C2 proves what SHOULD be sent; this proves what IS: the storage, the
// profiles read and the rpc are fakes, everything else is the real file (and
// the real utils/aiConsent gate), so a "no" that is marked delivered without
// being heard, or a "Not now" sent as a yes, turns a check red here.
type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
declare const Bun: { plugin: (p: { name: string; setup: (build: { module: (specifier: string, cb: () => VirtualModule) => void }) => void }) => void } | undefined;

interface AcctSnapshot { userId: string | null; account: Account; pending: Answer | null; ready: boolean; seen?: GateState | null; sendFailed?: boolean }
interface AcctModule {
  getAccountAiSnapshot(): AcctSnapshot;
  resetAccountAi(userId: string | null): void;
  setAccountAiHost(h: { isWeb: boolean; askAccount: () => Promise<boolean> } | null): void;
  refreshAccountAiConsent(userId: string): Promise<Account>;
  noteAiAnswer(userId: string | null, answer: Answer): Promise<void>;
  reconcileAiConsent(userId: string | null, opts?: { onlyDeclined?: boolean }): Promise<void>;
  settleAiConsentSync(timeoutMs?: number): Promise<void>;
  askAiConsentForAccount(userId: string | null): Promise<'allowed' | 'not_allowed' | 'failed'>;
  turnOffAiForAccount(userId: string | null): Promise<boolean>;
  setAiConsentRetryMsForTests(ms: number | null): void;
  AI_CONSENT_RETRY_MS: number;
}
interface WrapperModule {
  setAiConsentHost(h: { isWeb: boolean; prompt: () => Promise<boolean> } | null): void;
  subscribeAiConsentAnswer(fn: (a: Answer) => void): () => void;
  subscribeAiConsent(fn: (s: GateState) => void): () => void;
  declineAiConsent(): Promise<void>;
  loadAiConsent(): Promise<GateState>;
  getAiConsentState(): GateState;
  resetAiConsent(): Promise<void>;
}
type RpcArgs = { p_answer?: unknown; p_age_ms?: unknown; p_version?: unknown };

async function partC5(core: CoreModule): Promise<void> {
  console.log('\nC5. utils/aiConsentAccount (executed: fake storage, fake profiles read, fake rpc)');
  if (typeof Bun === 'undefined') { ok('C5 runs under bun (needs Bun.plugin for the fakes)', false); return; }
  const KEY = core.AI_CONSENT_STORAGE_KEY;
  const META = core.AI_CONSENT_META_KEY;
  const U = UID_A;

  // ── the fakes ────────────────────────────────────────────────────────────
  const store = new Map<string, string>();
  const written: string[] = [];
  let throwOnGet: string | null = null;
  /** Every storage read, counted: a run that happens at all reads the phone's answer. */
  let gets = 0;
  const storage = {
    getItem: async (k: string) => { gets += 1; if (throwOnGet === k) throw new Error('storage read failed'); return store.has(k) ? (store.get(k) as string) : null; },
    setItem: async (k: string, v: string) => { written.push(k); store.set(k, v); },
    removeItem: async (k: string) => { store.delete(k); },
  };
  let sessionUser: string | null = U;
  let profileRead: () => Promise<unknown> = async () => ({ data: { ai_consent: null }, error: null });
  const reads: string[] = [];
  const supabase = {
    auth: { getSession: async () => ({ data: { session: sessionUser ? { user: { id: sessionUser } } : null } }) },
    from: (table: string) => ({ select: (cols: string) => ({ eq: (col: string, id: string) => ({ maybeSingle: () => { reads.push(`${table}.${cols}.${col}=${id}`); return profileRead(); } }) }) }),
  };
  const rpc: { fn: string; args: RpcArgs; opts: unknown }[] = [];
  const order: string[] = [];
  const OFFLINE = async () => ({ status: 'refused', code: 'offline' });
  const HEARD = async (a: RpcArgs) => ({ status: 'synced', data: { ok: true, applied: true, ai_consent: a.p_answer, ai_consent_at: 'x' } });
  let rpcImpl: (a: RpcArgs) => Promise<unknown> = OFFLINE;
  const supabaseRpcOnline = async (fn: string, args: RpcArgs, opts?: unknown) => { rpc.push({ fn, args, opts }); order.push(`rpc:${String(args.p_answer)}`); return rpcImpl(args); };

  let acct: AcctModule;
  let wrapper: WrapperModule;
  let lineOf: SyncModule['settingsAccountLine'];
  try {
    const syncCore = await import(srcPath('utils/aiConsentSyncCore.ts')) as Record<string, unknown>;
    lineOf = (syncCore as unknown as SyncModule).settingsAccountLine;
    Bun.plugin({
      name: 'ai-consent-account-fakes',
      setup(build) {
        build.module('@react-native-async-storage/async-storage', () => ({ loader: 'object', exports: { default: storage, ...storage } }));
        build.module('@/lib/supabase', () => ({ loader: 'object', exports: { supabase, isSupabaseConfigured: true } }));
        build.module('@/utils/offlineQueue', () => ({ loader: 'object', exports: { supabaseRpcOnline } }));
        // The real files, through the mutation overlay (a scratch copy has no tsconfig to resolve "@/").
        build.module('@/utils/aiConsentCore', () => ({ loader: 'object', exports: { ...(core as unknown as Record<string, unknown>) } }));
        build.module('@/utils/aiConsentSyncCore', () => ({ loader: 'object', exports: { ...syncCore } }));
      },
    });
    const realWrapper = await import(srcPath('utils/aiConsent.ts')) as Record<string, unknown>;
    Bun.plugin({
      name: 'ai-consent-account-gate',
      setup(build) { build.module('@/utils/aiConsent', () => ({ loader: 'object', exports: { ...realWrapper } })); },
    });
    wrapper = realWrapper as unknown as WrapperModule;
    acct = await import(srcPath('utils/aiConsentAccount.ts')) as AcctModule;
  } catch (e) { ok('utils/aiConsentAccount imports under bun with the fakes', false, String(e)); return; }

  // What components/AiConsentAccountSync does (pinned as text in C3): the gate's answer event → noteAiAnswer.
  let eventUser: string | null = U;
  wrapper.subscribeAiConsentAnswer((a) => { void acct.noteAiAnswer(eventUser, a); });
  let prompts = 0;
  let promptAnswer = true;
  wrapper.setAiConsentHost({ isWeb: false, prompt: async () => { prompts += 1; order.push('question'); return promptAnswer; } });

  const meta = (): Meta | null => { const raw = store.get(META); return raw ? JSON.parse(raw) as Meta : null; };
  const putMeta = (over: Partial<Meta> = {}) => store.set(META, JSON.stringify({ uid: U, answer: 'declined', at: Date.now() - 5000, delivered: false, ...over }));
  const snap = () => acct.getAccountAiSnapshot();
  const args = (i: number) => JSON.stringify(rpc[i]?.args);
  const exactly = (answer: Answer, age: number | null) => JSON.stringify({ p_answer: answer, p_age_ms: age, p_version: 2 });
  const fresh = async (user: string | null = U) => {
    await acct.settleAiConsentSync(500);
    acct.setAccountAiHost(null);
    acct.setAiConsentRetryMsForTests(null); // the app's own 30 s: no timed retry fires inside a case that does not ask for one
    await wrapper.resetAiConsent();
    store.clear(); written.length = 0; rpc.length = 0; order.length = 0; reads.length = 0;
    throwOnGet = null; sessionUser = U; eventUser = U; prompts = 0; promptAnswer = true;
    rpcImpl = OFFLINE;
    profileRead = async () => ({ data: { ai_consent: null }, error: null });
    acct.resetAccountAi(user);
  };
  const deferred = () => { let release: () => void = () => {}; const gate = new Promise<void>((r) => { release = r; }); return { gate, release }; };

  // ── "keep trying until the account has heard" ───────────────────────────
  {
    await fresh();
    store.set(KEY, 'declined');
    await acct.noteAiAnswer(U, 'declined'); // offline: the rpc is refused
    ok('answer given offline: one send was tried, with the question version and no `record`',
      rpc.length === 1 && rpc[0].fn === 'set_my_ai_consent' && rpc[0].args.p_answer === 'declined' && rpc[0].args.p_version === 2 && rpc[0].opts === undefined, JSON.stringify(rpc));
    ok('…the record is on disk for this person and NOT marked delivered (a refused send is not "heard")',
      meta()?.uid === U && meta()?.answer === 'declined' && meta()?.delivered === false, JSON.stringify(meta()));
    ok('…the snapshot still shows it waiting, and says the send failed', snap().pending === 'declined' && snap().ready === true && snap().sendFailed === true, JSON.stringify(snap()));
    await tick(30);
    rpcImpl = HEARD;
    await acct.reconcileAiConsent(U); // the next run (foreground / next start / the timed retry)
    ok('…the next run sends it AGAIN, with its real age', rpc.length === 2 && rpc[1].args.p_answer === 'declined' && typeof rpc[1].args.p_age_ms === 'number' && (rpc[1].args.p_age_ms as number) >= 25 && (rpc[1].args.p_age_ms as number) < 5000, JSON.stringify(rpc[1]?.args));
    ok('…and only then is it marked delivered; the snapshot shows the account’s answer, nothing waiting, no failure',
      meta()?.delivered === true && snap().account === 'declined' && snap().pending === null && snap().sendFailed === false, `${JSON.stringify(meta())} ${JSON.stringify(snap())}`);
    await acct.reconcileAiConsent(U);
    ok('…a delivered answer is not sent again', rpc.length === 2);
    ok('the phone’s own answer key is never written by this file', !written.includes(KEY) && store.get(KEY) === 'declined', written.join(','));
  }
  for (const [label, impl] of [
    ["the request may have left ('unknown')", async () => ({ status: 'unknown', error: 'network' })],
    ['the server refused it', async () => ({ status: 'refused', code: 'server', error: 'permission denied' })],
    ['the account has no profile row (ok:false)', async () => ({ status: 'synced', data: { ok: false, reason: 'no_profile' } })],
    ['the answer came back unreadable', async () => ({ status: 'synced', data: ['granted'] })],
    ['the rpc threw', async () => { throw new Error('boom'); }],
  ] as const) {
    await fresh();
    store.set(KEY, 'declined');
    rpcImpl = impl as (a: RpcArgs) => Promise<unknown>;
    await acct.noteAiAnswer(U, 'declined');
    const undelivered = meta()?.delivered === false && snap().pending === 'declined';
    rpcImpl = HEARD;
    await acct.reconcileAiConsent(U);
    ok(`${label}: the no stays undelivered, and the next run sends it again`, undelivered && rpc.length === 2 && rpc[1].args.p_answer === 'declined' && meta()?.delivered === true, `${rpc.length} send(s), ${JSON.stringify(meta())}`);
  }
  {
    await fresh();
    store.set(KEY, 'granted');
    await acct.noteAiAnswer(U, 'granted'); // offline
    const waiting = meta()?.delivered === false && snap().pending === 'granted';
    rpcImpl = HEARD;
    await acct.reconcileAiConsent(U);
    ok('a yes given offline stays undelivered, then lands on the next run', waiting && rpc.length === 2 && rpc[1].args.p_answer === 'granted' && meta()?.delivered === true && snap().account === 'granted');
  }
  {
    await fresh();
    store.set(KEY, 'declined');
    const d = deferred();
    rpcImpl = async (a) => { await d.gate; return HEARD(a); };
    const run = acct.noteAiAnswer(U, 'declined');
    await tick(20);
    ok('while the FIRST send is in flight: waiting, and no failure is claimed', snap().pending === 'declined' && snap().sendFailed === false && rpc.length === 1, JSON.stringify(snap()));
    d.release();
    await run;
    ok('…it lands: nothing waiting, no failure', snap().pending === null && snap().sendFailed === false && meta()?.delivered === true);
    // a failure is remembered through the retry, and forgotten by a new answer
    await fresh();
    store.set(KEY, 'declined');
    await acct.noteAiAnswer(U, 'declined'); // refused
    const d2 = deferred();
    rpcImpl = async (a) => { await d2.gate; return HEARD(a); };
    const retry = acct.reconcileAiConsent(U);
    await tick(20);
    ok('a failed send stays "failed" while the retry is in flight', snap().pending === 'declined' && snap().sendFailed === true, JSON.stringify(snap()));
    d2.release();
    await retry;
    ok('…and is cleared when the retry lands', snap().sendFailed === false && snap().pending === null);
    await fresh();
    store.set(KEY, 'declined');
    await acct.noteAiAnswer(U, 'declined'); // refused → failed
    store.set(KEY, 'granted');
    const d3 = deferred();
    rpcImpl = async (a) => { await d3.gate; return HEARD(a); };
    const next = acct.noteAiAnswer(U, 'granted');
    await tick(20);
    ok('a NEW answer starts clean: the earlier answer’s failure is not carried over', snap().pending === 'granted' && snap().sendFailed === false, JSON.stringify(snap()));
    d3.release();
    await next;
  }
  {
    await fresh();
    store.set(KEY, 'declined');
    rpcImpl = HEARD;
    await acct.reconcileAiConsent(U);
    ok('a no with NO record (killed before the record was written) is sent anyway, with no age, and then recorded as delivered',
      rpc.length === 1 && args(0) === exactly('declined', null) && meta()?.uid === U && meta()?.answer === 'declined' && meta()?.delivered === true, `${args(0)} ${JSON.stringify(meta())}`);
    await fresh();
    store.set(KEY, 'granted');
    rpcImpl = HEARD;
    await acct.reconcileAiConsent(U);
    ok('a yes with NO record is never sent', rpc.length === 0 && meta() === null && snap().pending === null && snap().ready === true);
  }
  {
    await fresh();
    rpcImpl = HEARD;
    store.set(KEY, 'granted'); putMeta({ uid: UID_B, answer: 'granted' });
    await acct.reconcileAiConsent(U);
    store.set(KEY, 'declined'); putMeta({ uid: UID_B, answer: 'declined' });
    await acct.reconcileAiConsent(U);
    ok('another person’s answer left on the phone is never sent to this account (yes or no)', rpc.length === 0 && meta()?.uid === UID_B && meta()?.delivered === false);
  }
  {
    await fresh();
    store.set(KEY, 'declined'); sessionUser = UID_B; rpcImpl = HEARD;
    await acct.noteAiAnswer(U, 'declined');
    ok('the session belongs to someone else: nothing is sent, and the record stays undelivered', rpc.length === 0 && meta()?.delivered === false);
    await fresh(UID_B);
    store.set(KEY, 'declined'); putMeta(); rpcImpl = HEARD;
    await acct.reconcileAiConsent(U);
    ok('a late run for the person who was signed in BEFORE sends nothing', rpc.length === 0 && meta()?.delivered === false);
    await fresh();
    store.set(KEY, 'declined'); sessionUser = null; rpcImpl = HEARD;
    await acct.noteAiAnswer(U, 'declined');
    ok('no session at all: nothing is sent', rpc.length === 0 && meta()?.delivered === false);
  }
  {
    await fresh();
    store.set(KEY, 'declined');
    const d = deferred();
    rpcImpl = async (a) => { await d.gate; return HEARD(a); };
    const first = acct.noteAiAnswer(U, 'declined');
    await tick(20);
    store.set(KEY, 'granted');
    const second = acct.noteAiAnswer(U, 'granted');
    await tick(20);
    ok('a yes given while the no is in flight: its record is on disk at once (not behind the request)', meta()?.answer === 'granted' && meta()?.delivered === false, JSON.stringify(meta()));
    d.release();
    await first; await second;
    ok('…the sends go out in the order the answers were given, and the yes is the one marked delivered',
      rpc.map((c) => c.args.p_answer).join(',') === 'declined,granted' && meta()?.answer === 'granted' && meta()?.delivered === true && snap().account === 'granted' && snap().pending === null,
      `${rpc.map((c) => c.args.p_answer).join(',')} ${JSON.stringify(meta())}`);
  }
  {
    await fresh();
    rpcImpl = HEARD;
    store.set(KEY, 'granted'); putMeta({ answer: 'granted' });
    await acct.reconcileAiConsent(U, { onlyDeclined: true });
    const yesHeld = rpc.length === 0 && meta()?.delivered === false;
    store.set(KEY, 'declined'); putMeta({ answer: 'declined' });
    await acct.reconcileAiConsent(U, { onlyDeclined: true });
    ok('before sign-out (onlyDeclined): an undelivered yes is NOT sent; an undelivered no is', yesHeld && rpc.length === 1 && rpc[0].args.p_answer === 'declined' && meta()?.delivered === true);
  }
  {
    await fresh();
    store.set(KEY, 'granted'); putMeta({ answer: 'granted' });
    rpcImpl = async () => ({ status: 'synced', data: { ok: true, applied: false, reason: 'stale', ai_consent: 'declined' } });
    await acct.reconcileAiConsent(U);
    ok('a yes the server refused as stale is HEARD: marked delivered, sent with its age, and the snapshot shows the account’s no',
      rpc.length === 1 && (rpc[0].args.p_age_ms as number) >= 5000 && meta()?.delivered === true && snap().account === 'declined' && snap().pending === null, `${args(0)} ${JSON.stringify(snap())}`);
    await acct.reconcileAiConsent(U);
    ok('…and is not sent again', rpc.length === 1);
  }
  {
    await fresh();
    store.set(KEY, 'granted'); putMeta({ answer: 'granted' });
    throwOnGet = KEY; rpcImpl = HEARD;
    await acct.reconcileAiConsent(U);
    ok('a storage read that THROWS sends nothing (the gate’s in-memory answer is never pushed)', rpc.length === 0 && meta()?.delivered === false);
  }
  {
    await fresh();
    store.set(KEY, 'declined');
    rpcImpl = async () => ({ status: 'refused', code: 'server', error: 'Could not find the function public.set_my_ai_consent(p_age_ms, p_answer, p_version) in the schema cache' });
    await acct.noteAiAnswer(U, 'declined');
    await acct.reconcileAiConsent(U);
    ok('the function is not on the server yet: one try, then no more this session; the no stays undelivered', rpc.length === 1 && meta()?.delivered === false && snap().pending === 'declined');
    rpcImpl = HEARD;
    acct.resetAccountAi(U); // the next sign-in / app start
    await acct.reconcileAiConsent(U);
    ok('…and it is sent at the next start', rpc.length === 2 && meta()?.delivered === true);
  }
  {
    await fresh();
    profileRead = async () => ({ data: null, error: { code: '42703', message: 'column profiles.ai_consent does not exist' } });
    const got = await acct.refreshAccountAiConsent(U);
    store.set(KEY, 'declined'); putMeta(); rpcImpl = HEARD;
    await acct.reconcileAiConsent(U);
    ok('the column is not there yet (app ahead of the migration): nothing is sent, the record stays undelivered', got === 'missing_column' && rpc.length === 0 && meta()?.delivered === false && reads.join('|') === `profiles.ai_consent.id=${U}`, `${got} ${reads.join('|')}`);
  }
  {
    await fresh();
    profileRead = async () => ({ data: { ai_consent: 'granted' }, error: null });
    await acct.refreshAccountAiConsent(U);
    profileRead = async () => { throw new Error('offline'); };
    const again = await acct.refreshAccountAiConsent(U);
    ok('a read that fails keeps the last thing the account was read to say (and never throws)', again === 'unavailable' && snap().account === 'granted');
    profileRead = async () => ({ data: { ai_consent: 'granted' }, error: null });
    await acct.refreshAccountAiConsent(UID_B);
    ok('a read for someone who is not the signed-in person is dropped', snap().userId === U && snap().account === 'granted');
    await fresh();
    const d = deferred();
    profileRead = async () => { await d.gate; return { data: { ai_consent: 'granted' }, error: null }; };
    const slow = acct.refreshAccountAiConsent(U);
    store.set(KEY, 'declined'); rpcImpl = HEARD;
    await acct.noteAiAnswer(U, 'declined');
    d.release();
    await slow;
    ok('a slow read that started BEFORE a write cannot put the old yes back on screen', snap().account === 'declined');
  }

  // ── the timed retry: the one "keep trying" trigger that needs nothing else ─
  // No tap, no foreground, no "back online" event (a phone has none): after a
  // send fails, the same run happens again on a clock until one lands.
  const NETWORK_DOWN = async () => ({ status: 'unknown', error: 'Network request failed' });
  {
    ok('the retry delay the app ships with is 30 s', acct.AI_CONSENT_RETRY_MS === 30_000, String(acct.AI_CONSENT_RETRY_MS));
    await fresh();
    store.set(KEY, 'declined');
    rpcImpl = NETWORK_DOWN;
    await acct.noteAiAnswer(U, 'declined');
    await tick(150);
    ok('with the app’s own delay nothing is re-sent within a moment (the retry is a clock, not a loop)', rpc.length === 1 && meta()?.delivered === false, `${rpc.length} send(s)`);

    await fresh();
    acct.setAiConsentRetryMsForTests(40);
    store.set(KEY, 'declined');
    rpcImpl = NETWORK_DOWN;
    await acct.noteAiAnswer(U, 'declined'); // no signal: the request may or may not have left
    ok('a no that could not be sent: one try, undelivered, the screen says the send failed', rpc.length === 1 && meta()?.delivered === false && snap().pending === 'declined' && snap().sendFailed === true, `${rpc.length} ${JSON.stringify(snap())}`);
    await tick(220);
    const whileDown = rpc.length;
    ok('…with NOTHING else happening (no tap, no foreground, no reconcile call) the phone tries again on its own, and again while it keeps failing',
      whileDown >= 3 && rpc.every((c) => c.args.p_answer === 'declined') && meta()?.delivered === false && snap().sendFailed === true, `${whileDown} send(s) in 220 ms at a 40 ms delay`);
    ok('…each retry is built fresh: it carries the answer’s age at the moment it is sent',
      rpc.slice(1).every((c, i) => typeof c.args.p_age_ms === 'number' && (c.args.p_age_ms as number) > (i === 0 ? ((rpc[0].args.p_age_ms as number) ?? -1) : (rpc[i].args.p_age_ms as number))),
      rpc.map((c) => c.args.p_age_ms).join(','));
    rpcImpl = HEARD; // signal is back; nobody touches the phone
    await tick(120);
    const landedAt = rpc.length;
    ok('…and the first retry after the signal returns delivers it: marked delivered, the account says no, nothing waiting, no failure',
      landedAt === whileDown + 1 && meta()?.delivered === true && snap().account === 'declined' && snap().pending === null && snap().sendFailed === false,
      `${landedAt - whileDown} more send(s), ${JSON.stringify(meta())} ${JSON.stringify(snap())}`);
    const readsAfter = gets;
    await tick(200);
    ok('…once it has landed the clock stops: no more sends and no more runs', rpc.length === landedAt && gets === readsAfter, `${rpc.length - landedAt} send(s), ${gets - readsAfter} storage read(s)`);
  }
  {
    await fresh();
    acct.setAiConsentRetryMsForTests(40);
    store.set(KEY, 'granted');
    rpcImpl = NETWORK_DOWN;
    await acct.noteAiAnswer(U, 'granted');
    rpcImpl = HEARD;
    await tick(120);
    ok('a yes that could not be sent is retried on the same clock, and lands', rpc.length === 2 && rpc[1].args.p_answer === 'granted' && meta()?.delivered === true && snap().account === 'granted', `${rpc.length} ${JSON.stringify(meta())}`);
  }
  {
    // Someone else signs in (or the same person again): the armed retry dies with the old snapshot.
    await fresh();
    acct.setAiConsentRetryMsForTests(40);
    store.set(KEY, 'declined');
    rpcImpl = NETWORK_DOWN;
    await acct.noteAiAnswer(U, 'declined');
    rpcImpl = HEARD;
    acct.resetAccountAi(U); // sign-in / app start resets; the start-up run is the component's job, not the old timer's
    await tick(200);
    ok('resetAccountAi clears the armed retry: nothing is sent by a timer left over from before', rpc.length === 1 && meta()?.delivered === false, `${rpc.length} send(s)`);
    await acct.reconcileAiConsent(U);
    ok('…and the start-up run still delivers it', rpc.length === 2 && meta()?.delivered === true);
  }
  {
    // A run that succeeds (a foreground run that got there first) clears the armed retry.
    await fresh();
    acct.setAiConsentRetryMsForTests(120);
    store.set(KEY, 'declined');
    rpcImpl = NETWORK_DOWN;
    await acct.noteAiAnswer(U, 'declined');
    rpcImpl = HEARD;
    await acct.reconcileAiConsent(U); // well inside the 120 ms
    const sent = rpc.length;
    const readsAfter = gets;
    await tick(320);
    ok('a run that lands clears the armed retry (no left-over run later)', sent === 2 && rpc.length === 2 && meta()?.delivered === true && gets === readsAfter, `${rpc.length} send(s), ${gets - readsAfter} storage read(s) after`);
  }
  {
    // Nothing is waiting any more (the phone's answer is gone): the armed retry is cleared too.
    await fresh();
    acct.setAiConsentRetryMsForTests(120);
    store.set(KEY, 'declined');
    rpcImpl = NETWORK_DOWN;
    await acct.noteAiAnswer(U, 'declined');
    store.delete(KEY);
    await acct.reconcileAiConsent(U);
    const readsAfter = gets;
    await tick(320);
    ok('a run that finds nothing waiting clears the armed retry', rpc.length === 1 && snap().pending === null && gets === readsAfter, `${rpc.length} send(s), ${gets - readsAfter} storage read(s) after`);
  }
  {
    // A late run for the person who was signed in before must not arm (or clear) the new person's clock.
    await fresh(UID_B);
    acct.setAiConsentRetryMsForTests(40);
    store.set(KEY, 'declined'); putMeta();
    rpcImpl = HEARD;
    await acct.reconcileAiConsent(U); // U is no longer the one signed in: the send is refused before any request
    const readsAfter = gets;
    await tick(160);
    ok('a run for someone who is no longer signed in arms no retry', rpc.length === 0 && gets === readsAfter, `${rpc.length} send(s), ${gets - readsAfter} storage read(s) after`);
  }

  // ── a wait on the sync is always bounded ─────────────────────────────────
  {
    await fresh();
    store.set(KEY, 'declined');
    const d = deferred();
    rpcImpl = async (a) => { await d.gate; return HEARD(a); };
    const hung = acct.noteAiAnswer(U, 'declined'); // the request does not come back
    await tick(20);
    const outcome = await Promise.race([acct.settleAiConsentSync(50).then(() => 'bounded' as const), tick(700).then(() => 'hung' as const)]);
    ok('settleAiConsentSync(50) resolves although the request has not come back ("Send today’s preview now" and "Allow" never hang on it)', outcome === 'bounded' && rpc.length === 1, outcome);
    d.release();
    await hung;
    const t0 = Date.now();
    await acct.settleAiConsentSync(5000);
    ok('…and with nothing in flight it resolves at once, not after the timeout', Date.now() - t0 < 500, `${Date.now() - t0} ms`);
  }

  // ── a no pushed with no record, while a newer yes arrives ────────────────
  {
    await fresh();
    store.set(KEY, 'declined'); // killed before the record was written
    const d = deferred();
    rpcImpl = async (a) => { await d.gate; return HEARD(a); };
    const first = acct.reconcileAiConsent(U);
    await tick(20);
    store.set(KEY, 'granted'); // he answers yes while that no is in flight
    const second = acct.noteAiAnswer(U, 'granted');
    await tick(20);
    d.release();
    await first; await second;
    ok('a record-less no that lands AFTER the person said yes does not write a "delivered no" over the yes’s record: the yes is still sent, and is the one marked delivered',
      rpc.map((c) => c.args.p_answer).join(',') === 'declined,granted' && meta()?.answer === 'granted' && meta()?.delivered === true && snap().account === 'granted' && snap().pending === null,
      `${rpc.map((c) => c.args.p_answer).join(',')} ${JSON.stringify(meta())}`);
  }

  // ── Settings never shows a line for a few frames and takes it back ───────
  // AI switched Off while the account says yes, through the REAL gate (its
  // state change reaches the screen before its own storage write, and the
  // answer event only after it). At every step the snapshot and the gate's
  // state are fed to the real settingsAccountLine.
  {
    await fresh();
    store.set(KEY, 'granted'); putMeta({ answer: 'granted', delivered: true });
    profileRead = async () => ({ data: { ai_consent: 'granted' }, error: null });
    await acct.refreshAccountAiConsent(U);
    await wrapper.loadAiConsent();
    await acct.reconcileAiConsent(U);
    const shown = () => { const sn = snap(); const r = lineOf({ ready: sn.ready, device: wrapper.getAiConsentState(), seen: sn.seen ?? null, account: sn.account, pending: sn.pending, sendFailed: sn.sendFailed === true }); return `${r.line}/${r.action}`; };
    ok('before: the phone and the account both say yes → "also allows"', snap().seen === 'granted' && shown() === 'also_allowed/null', `${shown()} ${JSON.stringify(snap())}`);
    const d = deferred();
    rpcImpl = async (a) => { await d.gate; return HEARD(a); };
    const frames: string[] = [];
    const off = wrapper.subscribeAiConsent(() => { frames.push(`gate:${shown()}`); }); // the instant the screen first sees the no
    const answered = wrapper.declineAiConsent();
    frames.push(`sync:${shown()}`);
    await answered; // the gate's storage write is done and the answer event has fired
    frames.push(`event:${shown()}`);
    ok('the answer event marks the new answer as the one waiting AT ONCE (before the record is written or storage is read)',
      snap().pending === 'declined' && snap().seen === 'declined' && snap().sendFailed === false, JSON.stringify(snap()));
    await tick(20);
    frames.push(`in-flight:${shown()}`);
    off();
    ok('AI switched Off: from the first instant to the send in flight the line says NOTHING (never "allows" + Turn off for a few frames)',
      frames.join(' ') === 'gate:none/null sync:none/null event:none/null in-flight:none/null', frames.join(' '));
    d.release();
    await acct.settleAiConsentSync(500);
    ok('…and when the account has answered it says so: "has not allowed", no button', shown() === 'not_allowed/null' && snap().seen === 'declined', `${shown()} ${JSON.stringify(snap())}`);
  }
  {
    await fresh();
    await acct.reconcileAiConsent(U);
    ok('a run records the phone answer it weighed, also when there is none (unknown)', snap().seen === 'unknown' && snap().ready === true, JSON.stringify(snap()));
    profileRead = async () => ({ data: { ai_consent: 'granted' }, error: null });
    await acct.refreshAccountAiConsent(U);
    rpcImpl = HEARD;
    await acct.turnOffAiForAccount(U);
    ok('…and so does the answer to a write ("Turn off for my account" on an unanswered phone)', snap().seen === 'unknown' && snap().account === 'declined', JSON.stringify(snap()));
    store.set(KEY, 'declined'); putMeta(); // the phone's answer moved on with no run in between
    await acct.turnOffAiForAccount(U);
    ok('…a write’s answer re-reads the phone: what is waiting and the answer it was worked out from are from the SAME read', snap().seen === 'declined' && snap().pending === null && meta()?.delivered === true, JSON.stringify(snap()));
    acct.resetAccountAi(U);
    ok('resetAccountAi forgets it (nothing is said until the next run has looked)', snap().seen === null && snap().ready === false && snap().pending === null);
    await acct.noteAiAnswer(UID_B, 'declined');
    ok('an answer for someone who is not the signed-in person changes nothing on screen', snap().seen === null && snap().pending === null && rpc.length === 2, JSON.stringify(snap()));
  }

  // ── the web write path (the only way the web app changes the account) ───
  const webHost = (answer: () => boolean | Promise<boolean>) => {
    let asked = 0;
    acct.setAccountAiHost({ isWeb: true, askAccount: async () => { asked += 1; order.push('question'); return answer(); } });
    return { asked: () => asked };
  };
  {
    await fresh();
    rpcImpl = HEARD;
    store.set(KEY, 'granted'); // a phone answer that happens to be on disk must not be touched or sent
    const h = webHost(() => false);
    const r = await acct.askAiConsentForAccount(U);
    ok('web "Not now" (or a dismissed question): the question was shown ONCE, BEFORE the write', h.asked() === 1 && order.join('>') === 'question>rpc:declined', order.join('>'));
    ok('…what is sent is exactly { p_answer: \'declined\', p_age_ms: 0, p_version: 2 }, and the result is not_allowed', rpc.length === 1 && args(0) === exactly('declined', 0) && r === 'not_allowed', `${args(0)} → ${r}`);
    ok('…the snapshot shows the account’s no; the phone’s answer key and gate are untouched', snap().account === 'declined' && store.get(KEY) === 'granted' && !written.includes(KEY) && wrapper.getAiConsentState() === 'unknown', `${JSON.stringify(snap())} wrote: ${written.join(',')}`);
  }
  {
    await fresh();
    rpcImpl = HEARD;
    const h = webHost(() => true);
    const r = await acct.askAiConsentForAccount(U);
    ok('web "Allow": asked once, before the write; exactly { p_answer: \'granted\', p_age_ms: 0, p_version: 2 }; result allowed',
      h.asked() === 1 && order.join('>') === 'question>rpc:granted' && rpc.length === 1 && args(0) === exactly('granted', 0) && r === 'allowed', `${order.join('>')} ${args(0)} → ${r}`);
    ok('…the account says yes; nothing was written on the device (no answer, no record, no grant on the gate)',
      snap().account === 'granted' && !store.has(KEY) && written.length === 0 && wrapper.getAiConsentState() === 'unknown', `wrote: ${written.join(',')}`);
    // a failed write changes nothing and says so
    rpcImpl = OFFLINE;
    const h2 = webHost(() => false);
    const failed = await acct.askAiConsentForAccount(U);
    ok('web, the write fails: result is failed, and the snapshot is unchanged (still the account’s yes)', h2.asked() === 1 && failed === 'failed' && snap().account === 'granted', `${failed} ${JSON.stringify(snap())}`);
    rpcImpl = async () => ({ status: 'synced', data: { ok: true, applied: false, reason: 'stale', ai_consent: 'declined' } });
    webHost(() => true);
    const refused = await acct.askAiConsentForAccount(U);
    ok('web "Allow" the server did not apply is never reported as allowed', refused === 'failed' && snap().account === 'declined', `${refused} ${JSON.stringify(snap())}`);
  }
  {
    await fresh();
    rpcImpl = HEARD;
    const none = await acct.askAiConsentForAccount(U); // no host registered
    const h = webHost(() => true);
    const noUser = await acct.askAiConsentForAccount(null);
    ok('no way to ask (no host) or nobody signed in: failed, no question, NOTHING sent', none === 'failed' && noUser === 'failed' && h.asked() === 0 && rpc.length === 0);
    webHost(() => { throw new Error('the alert blew up'); });
    const threw = await acct.askAiConsentForAccount(U);
    ok('a question that throws: failed, nothing sent (never a silent yes)', threw === 'failed' && rpc.length === 0);
    sessionUser = UID_B;
    webHost(() => true);
    const other = await acct.askAiConsentForAccount(U);
    ok('web "Allow" while the session belongs to someone else: failed, nothing sent', other === 'failed' && rpc.length === 0);
  }

  // ── "Allow" on a phone: always the question, then the gate's event writes ─
  {
    await fresh();
    rpcImpl = HEARD;
    store.set(KEY, 'granted'); // a yes already on the phone (no record): Allow must still ASK
    await wrapper.loadAiConsent();
    acct.setAccountAiHost({ isWeb: false, askAccount: async () => { order.push('web-question'); return true; } });
    promptAnswer = true;
    const r = await acct.askAiConsentForAccount(U);
    ok('phone "Allow", with a yes already on the phone: the phone’s question is shown once, before anything is sent',
      prompts === 1 && order[0] === 'question' && !order.includes('web-question'), order.join('>'));
    ok('…a yes on the question is sent by the gate’s answer event: granted, a small age, question version 2; result allowed',
      r === 'allowed' && rpc.length === 1 && rpc[0].args.p_answer === 'granted' && rpc[0].args.p_version === 2
      && typeof rpc[0].args.p_age_ms === 'number' && (rpc[0].args.p_age_ms as number) >= 0 && (rpc[0].args.p_age_ms as number) < 5000
      && meta()?.uid === U && meta()?.delivered === true && snap().account === 'granted', `${r} ${args(0)} ${JSON.stringify(meta())}`);
    await fresh();
    rpcImpl = HEARD;
    acct.setAccountAiHost({ isWeb: false, askAccount: async () => true });
    promptAnswer = false;
    const no = await acct.askAiConsentForAccount(U);
    ok('phone "Allow", then "Not now" on the question: a no is sent; result not_allowed', prompts === 1 && no === 'not_allowed' && rpc.length === 1 && rpc[0].args.p_answer === 'declined' && snap().account === 'declined', `${no} ${args(0)}`);
  }

  // ── "Turn off" (web) / "Turn off for my account" (phone Settings) ────────
  {
    await fresh();
    profileRead = async () => ({ data: { ai_consent: 'granted' }, error: null });
    await acct.refreshAccountAiConsent(U);
    store.set(KEY, 'declined'); putMeta();
    const failed = await acct.turnOffAiForAccount(U); // offline
    ok('turn off, the write fails: false, the record stays undelivered, the snapshot still shows the account’s yes',
      failed === false && rpc.length === 1 && meta()?.delivered === false && snap().account === 'granted', `${failed} ${JSON.stringify(snap())}`);
    rpcImpl = HEARD;
    const done = await acct.turnOffAiForAccount(U);
    ok('turn off: exactly { p_answer: \'declined\', p_age_ms: 0, p_version: 2 }; true; the account says no; this phone’s waiting no is marked delivered',
      done === true && args(1) === exactly('declined', 0) && snap().account === 'declined' && snap().pending === null && meta()?.delivered === true, `${args(1)} ${JSON.stringify(snap())}`);
    ok('…and the phone’s own answer is not touched', store.get(KEY) === 'declined' && !written.includes(KEY));
    await fresh();
    rpcImpl = HEARD;
    const unanswered = await acct.turnOffAiForAccount(U);
    ok('turn off on a phone with no answer of its own: sent, and nothing is written on the device', unanswered === true && rpc.length === 1 && written.length === 0 && !store.has(KEY) && !store.has(META));
    const nobody = await acct.turnOffAiForAccount(null);
    ok('turn off with nobody signed in: false, nothing sent', nobody === false && rpc.length === 1);
  }
  wrapper.setAiConsentHost(null);
  acct.setAccountAiHost(null);
  // No timer is left armed when the file ends.
  acct.setAiConsentRetryMsForTests(null);
  acct.resetAccountAi(null);
}

// ════════════════════════════════════════════════════════════════════════════
await partS1();
partS2();
partS5();
partS6();
const core = await loadCore();
if (core) await partC1(core);
await partC2();
partC3();
if (core) await partC4(core);
if (core) await partC5(core);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('\n✗ validate-ai-consent-server failed');
  process.exit(1);
}
console.log('\n✓ validate-ai-consent-server passed');
