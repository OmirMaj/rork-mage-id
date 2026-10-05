// validate-ai-call-log.ts — every model call writes one cost row, and a
// Construction Answer has an hourly limit, a wall-clock stop and a round cap.
//
// WHY THIS EXISTS (lane AICOST, 2026-10-04). Until this lane nothing recorded
// which model answered, how big the call was or what it cost. The log is only
// worth having if it is COMPLETE: one unlogged call site and "cost per
// feature" is quietly wrong. So this guard does not keep a list of call sites.
// It DERIVES them from supabase/functions/** and fails when one is not inside
// one of the four logging wrappers of _shared/aiCallLog.ts:
//
//   A. call sites   every fetch (or local fetch wrapper) whose URL is built
//                   from a model provider's host, every SDK-style
//                   `.messages.create/stream(` call, and every geminiEmbed(
//                   caller. Derived by taint from the host literal, per file.
//   B. the logger   the row type is the migration's column list and nothing
//                   else, has no free-text field, sanitizes identifiers, never
//                   throws, gives up after a bound, and the wrappers hand back
//                   exactly what the call returned / threw with one row each.
//   C. prices       every priced model has a source on the provider's own
//                   pricing page and the day it was read; every model id the
//                   functions name is priced or knowingly unpriced.
//   D. migration    RLS on, no policy, no client grant, 400-day guarded purge.
//   E. limits       construction-answer: 10 an hour (fail closed), a 100 s
//                   stop that is not charged, 8 rounds x 5 searches.
//   F. mutations    planted in memory; each must turn its check red.
//
// Run via: bun run test:ai-call-log
//
// The PGlite proof of the migration's behaviour (anon / authenticated cannot
// read or write, the purge removes old rows only) is scratchpad/pgq/ai-call-log.mjs.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// tsc type-checks scripts/ with the app's lib set, which has no Bun global.
declare const Bun: { Transpiler: new (o: { loader: 'ts' }) => { transformSync(src: string): string } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FN_DIR = 'supabase/functions';

// ── source set ───────────────────────────────────────────────────────────────
type Files = Map<string, string>;
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) { if (name !== 'node_modules' && name !== '__tests__') walk(rel, out); }
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}
const DISK: Files = new Map();
for (const f of walk(FN_DIR)) DISK.set(f, readFileSync(join(ROOT, f), 'utf8'));
const MIGRATION = 'supabase/migrations/20261005090000_ai_call_log.sql';
const CLIENT = 'utils/constructionAnswer.ts';
for (const f of [MIGRATION, CLIENT]) DISK.set(f, readFileSync(join(ROOT, f), 'utf8'));

// ── a small lexer: comments blanked, parens matched past strings/templates ───
/** Same length as `src`, comments replaced by spaces (strings kept: hosts live in them). */
function blankComments(src: string): string {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  const skipString = (q: string) => { i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; };
  const skipTemplate = () => {
    i++;
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        let d = 1; i += 2;
        while (i < n && d > 0) {
          if (src[i] === '`') { skipTemplate(); continue; }
          if (src[i] === '{') d++; else if (src[i] === '}') d--;
          i++;
        }
        continue;
      }
      i++;
    }
    i++;
  };
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") skipString(c);
    else if (c === '`') skipTemplate();
    else if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') { out[i] = ' '; i++; } }
    else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2); const stop = end < 0 ? n : end + 2;
      for (; i < stop; i++) if (src[i] !== '\n') out[i] = ' ';
    } else i++;
  }
  return out.join('');
}
/** Index of the `)` matching the `(` at `open` (in comment-blanked code), or -1. */
function matchParen(code: string, open: number): number {
  const n = code.length;
  let depth = 0; let i = open;
  while (i < n) {
    const c = code[i];
    if (c === '"' || c === "'") { i++; while (i < n && code[i] !== c) { if (code[i] === '\\') i++; i++; } }
    else if (c === '`') {
      i++;
      while (i < n && code[i] !== '`') {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === '$' && code[i + 1] === '{') {
          let d = 1; i += 2;
          while (i < n && d > 0) { if (code[i] === '{') d++; else if (code[i] === '}') d--; i++; }
          continue;
        }
        i++;
      }
    } else if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}
/** Top-level arguments of the call whose `(` is at `open`. */
function argsOf(code: string, open: number): string[] {
  const close = matchParen(code, open);
  if (close < 0) return [];
  const args: string[] = []; let depth = 0; let start = open + 1; let i = open + 1;
  while (i < close) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      const sub = matchQuote(code, i); i = sub + 1; continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { args.push(code.slice(start, i)); start = i + 1; }
    i++;
  }
  const last = code.slice(start, close);
  if (last.trim() !== '') args.push(last);
  return args;
}
function matchQuote(code: string, at: number): number {
  const q = code[at]; let i = at + 1; const n = code.length;
  while (i < n && code[i] !== q) {
    if (code[i] === '\\') { i += 2; continue; }
    if (q === '`' && code[i] === '$' && code[i + 1] === '{') {
      let d = 1; i += 2;
      while (i < n && d > 0) { if (code[i] === '{') d++; else if (code[i] === '}') d--; i++; }
      continue;
    }
    i++;
  }
  return i;
}
const lineOf = (src: string, at: number) => src.slice(0, at).split('\n').length;

// ── A. deriving the call sites ───────────────────────────────────────────────
// A model provider's host. A new provider must be added here AND logged.
const MODEL_HOST = /generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com|api\.anthropic\.com|api\.openai\.com|openrouter\.ai|api\.groq\.com|api\.mistral\.ai|api\.cohere\.(?:ai|com)|api\.together\.xyz|api\.perplexity\.ai|api\.x\.ai|api\.deepgram\.com|api\.assemblyai\.com|api\.elevenlabs\.io|bedrock-runtime|toolkit\.rork\.com\/stt/;
// An SDK-style model call (the Anthropic SDK today; the others so a new SDK cannot slip in dark).
const SDK_CALL = /\.messages\s*\.\s*(?:create|stream|parse)\s*\(|\.chat\s*\.\s*completions\s*\.\s*create\s*\(|\.responses\s*\.\s*create\s*\(|\.(?:generateContent|generateContentStream|embedContent|batchEmbedContents)\s*\(/g;
const WRAPPERS = ['logGeminiCall', 'logAnthropicHttpCall', 'logAnthropicSdkCall', 'logOpaqueCall'];
const WRAPPER_CALL = new RegExp(`(?<![.\\w])(${WRAPPERS.join('|')})\\s*\\(`, 'g');
const LOGGER = `${FN_DIR}/_shared/aiCallLog.ts`;
const PRICES = `${FN_DIR}/_shared/aiPrices.ts`;
const EMBED = `${FN_DIR}/_shared/embeddings.ts`;
const ASK = `${FN_DIR}/construction-answer/index.ts`;
const CARDS = `${FN_DIR}/construction-answer/codeCardRequirements.ts`;
const LIMITS = `${FN_DIR}/construction-answer/limits.ts`;
// A file that calls `.messages.create(` on a client it was HANDED. It must import nothing
// (so it cannot build its own client) and its caller must hand it a logging client (checked in A).
const INJECTED_CLIENT = new Set([CARDS]);

interface Site { file: string; line: number; at: number; kind: 'fetch' | 'sdk'; text: string; wrapper: string | null; meta: string }

function taintedNames(code: string): Set<string> {
  const tainted = new Set<string>();
  const decl = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*([^;]*);/g;
  const fn = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  const isTainted = (text: string) => MODEL_HOST.test(text) || [...tainted].some(t => new RegExp(`(?<![.\\w$])${t.replace(/\$/g, '\\$')}(?![\\w$])`).test(text));
  for (let pass = 0; pass < 6; pass++) {
    const before = tainted.size;
    for (const m of code.matchAll(decl)) if (!tainted.has(m[1]) && isTainted(m[2])) tainted.add(m[1]);
    for (const m of code.matchAll(fn)) {
      if (tainted.has(m[1])) continue;
      const open = (m.index ?? 0) + m[0].length - 1;
      const close = matchParen(code, open);
      const brace = close < 0 ? -1 : code.indexOf('{', close);
      if (brace < 0) continue;
      // body up to the matching brace
      let d = 0; let j = brace;
      for (; j < code.length; j++) { if (code[j] === '{') d++; else if (code[j] === '}') { d--; if (d === 0) break; } }
      const body = code.slice(brace, j);
      // A URL builder returns a model URL; a function that itself fetches is a caller, not a URL.
      if (!/(?<![.\w])fetch\s*\(/.test(body) && /return[^;]*;/.test(body) && isTainted((body.match(/return[^;]*;/g) ?? []).join('\n'))) tainted.add(m[1]);
    }
    if (tainted.size === before) break;
  }
  return tainted;
}
/** `fetch` plus every local function that fetches its own first parameter (fetchWithTimeout). */
function fetchLike(code: string): Set<string> {
  const names = new Set<string>(['fetch']);
  for (const m of code.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)/g)) {
    const open = (m.index ?? 0) + m[0].indexOf('(');
    const close = matchParen(code, open);
    const brace = close < 0 ? -1 : code.indexOf('{', close);
    if (brace < 0) continue;
    let d = 0; let j = brace;
    for (; j < code.length; j++) { if (code[j] === '{') d++; else if (code[j] === '}') { d--; if (d === 0) break; } }
    if (new RegExp(`(?<![.\\w])fetch\\s*\\(\\s*${m[2]}\\s*[,)]`).test(code.slice(brace, j))) names.add(m[1]);
  }
  return names;
}

function sitesOf(file: string, src: string): Site[] {
  const code = blankComments(src);
  const tainted = taintedNames(code);
  const fetchers = fetchLike(code);
  const spans: { name: string; open: number; close: number; meta: string }[] = [];
  if (file !== LOGGER) {
    for (const m of code.matchAll(WRAPPER_CALL)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      const close = matchParen(code, open);
      const args = argsOf(code, open);
      // meta is the object argument: 2nd for the three typed wrappers, 3rd for logOpaqueCall.
      spans.push({ name: m[1], open, close, meta: (m[1] === 'logOpaqueCall' ? args[2] : args[1]) ?? '' });
    }
  }
  const innermost = (at: number) => spans.filter(s => s.open < at && at < s.close).sort((a, b) => (a.close - a.open) - (b.close - b.open))[0] ?? null;
  const sites: Site[] = [];
  const isTaintedArg = (arg: string) => MODEL_HOST.test(arg) || [...tainted].some(t => new RegExp(`(?<![.\\w$])${t.replace(/\$/g, '\\$')}(?![\\w$])`).test(arg));
  for (const name of fetchers) {
    for (const m of code.matchAll(new RegExp(`(?<![.\\w$])${name}\\s*\\(`, 'g'))) {
      const at = m.index ?? 0;
      if (/function\s+$/.test(code.slice(Math.max(0, at - 12), at))) continue; // its own declaration
      const first = argsOf(code, at + m[0].length - 1)[0] ?? '';
      if (!isTaintedArg(first)) continue;
      const span = innermost(at);
      sites.push({ file, line: lineOf(src, at), at, kind: 'fetch', text: first.trim().slice(0, 70), wrapper: span?.name ?? null, meta: span?.meta ?? '' });
    }
  }
  if (file !== LOGGER) {
    for (const m of code.matchAll(SDK_CALL)) {
      const at = m.index ?? 0;
      const span = innermost(at);
      sites.push({ file, line: lineOf(src, at), at, kind: 'sdk', text: m[0].replace(/\s+/g, ''), wrapper: span?.name ?? null, meta: span?.meta ?? '' });
    }
  }
  return sites.sort((a, b) => a.at - b.at);
}

// ── the checks, over a file set (the disk, or the disk with one planted mutation) ─
interface Result { name: string; pass: boolean; detail: string }
const fnNameOf = (file: string) => file.slice(FN_DIR.length + 1).split('/')[0];

function loadLimits(src: string): Record<string, unknown> | null {
  if (/^\s*import\s/m.test(src)) return null;
  try {
    const names = [...src.matchAll(/export (?:const|function) ([A-Za-z_]\w*)/g)].map(m => m[1]);
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(src).replace(/^export\s+/gm, '');
    const mod: { exports: Record<string, unknown> } = { exports: {} };
    new Function('module', 'exports', `${js}\nmodule.exports = { ${names.join(', ')} };`)(mod, mod.exports);
    return mod.exports;
  } catch { return null; }
}

function analyze(files: Files): { results: Result[]; sites: Site[] } {
  const results: Result[] = [];
  const ok = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); };
  const get = (f: string) => files.get(f) ?? '';
  const fnFiles = [...files.keys()].filter(f => f.startsWith(`${FN_DIR}/`)).sort();

  // ── A. call sites ──
  const sites: Site[] = [];
  for (const f of fnFiles) sites.push(...sitesOf(f, get(f)));
  const real = sites.filter(s => !(s.kind === 'sdk' && INJECTED_CLIENT.has(s.file)));
  ok('A1 the sweep finds model call sites (it is not blind)', real.length >= 20, `${real.length} found`);
  const unlogged = real.filter(s => s.wrapper === null);
  ok('A2 every model call site is inside a logging wrapper', unlogged.length === 0,
    unlogged.map(s => `${s.file}:${s.line} ${s.kind} ${s.text}`).join('\n      '));
  const wrongWrapper = real.filter(s => s.wrapper !== null && (
    (s.kind === 'sdk' && s.wrapper !== 'logAnthropicSdkCall')
    || (s.kind === 'fetch' && s.wrapper === 'logAnthropicSdkCall')
    || (s.kind === 'fetch' && /anthropic\.com/.test(s.text) && s.wrapper !== 'logAnthropicHttpCall')));
  ok('A3 each site uses the wrapper for its provider (SDK call → logAnthropicSdkCall, api.anthropic.com → logAnthropicHttpCall)', wrongWrapper.length === 0,
    wrongWrapper.map(s => `${s.file}:${s.line} ${s.wrapper}`).join('\n      '));
  // exactly one call per wrapper, and no wrapper without a call
  const dupes: string[] = []; const hollow: string[] = [];
  for (const f of fnFiles) {
    if (f === LOGGER) continue;
    const code = blankComments(get(f));
    const mine = sites.filter(s => s.file === f);
    for (const m of code.matchAll(WRAPPER_CALL)) {
      const open = (m.index ?? 0) + m[0].length - 1; const close = matchParen(code, open);
      const inside = mine.filter(s => s.at > open && s.at < close);
      if (inside.length > 1) dupes.push(`${f}:${lineOf(get(f), open)} wraps ${inside.length} calls`);
      if (inside.length === 0) hollow.push(`${f}:${lineOf(get(f), open)} ${m[1]} wraps no model call`);
    }
  }
  ok('A4 one wrapper holds exactly one model call (one call, one row)', dupes.length === 0 && hollow.length === 0, [...dupes, ...hollow].join('\n      '));
  const badMeta = real.filter(s => s.wrapper !== null).filter(s => {
    const dir = fnNameOf(s.file);
    const named = dir === '_shared' ? /\bfn\s*:\s*who\.fn\b/.test(s.meta) : new RegExp(`\\bfn\\s*:\\s*["']${dir}["']`).test(s.meta) || (/\.\.\.callMeta\b|^\s*callMeta\s*$/.test(s.meta) && new RegExp(`const callMeta = \\{ fn: "${dir}"`).test(get(s.file)));
    const full = /^\s*callMeta\s*$/.test(s.meta) || /\.\.\.callMeta\b/.test(s.meta) || (/\bfeature\b/.test(s.meta) && /\buserId\b/.test(s.meta) && /\bmodel\b/.test(s.meta));
    return !named || !full;
  });
  ok("A5 each site states its own function directory, a feature, the billed account and the model", badMeta.length === 0,
    badMeta.map(s => `${s.file}:${s.line} meta: ${s.meta.trim().slice(0, 90)}`).join('\n      '));
  // no dark file: a model host in code with no derived call site
  const dark = fnFiles.filter(f => f !== LOGGER && f !== PRICES && MODEL_HOST.test(blankComments(get(f))) && !sites.some(s => s.file === f));
  ok('A6 no file names a model host without a derived call site (the sweep sees every one)', dark.length === 0, dark.join(', '));
  // the injected client
  const cards = get(CARDS);
  const ask = get(ASK);
  ok('A7 the code-cards module still imports nothing, so its client can only be the one it is handed', !/^\s*import\s/m.test(cards) && (blankComments(cards).match(SDK_CALL) ?? []).length === 1);
  ok('A8 construction-answer hands it a logging client (the cards call is one row)',
    /const cardsClient: RequirementsClient = \{\s*messages: \{\s*create: \(params, options\) =>\s*logAnthropicSdkCall\(null, \{ \.\.\.callMeta, feature: "construction_answer_cards" \}, \(\) => \(client as unknown as RequirementsClient\)\.messages\.create\(params, options\)\),/.test(ask)
      && /await requirementsFor\(cardsClient, MODEL, \{ question, answer, calc \}, cardsMs\)/.test(ask) && (ask.match(/requirementsFor\(/g) ?? []).length === 1);
  // the shared embedding helper
  const emb = get(EMBED);
  ok('A9 geminiEmbed cannot be called without saying who it is logged against', /export async function geminiEmbed\(texts: string\[\], who: EmbedCaller\): Promise<number\[\]\[\]>/.test(emb)
    && /logGeminiCall\(null, \{ fn: who\.fn, feature: who\.feature, userId: who\.userId, model: EMBED_MODEL \}, async \(\) => \{\n\s*return await fetch\(/.test(emb));
  const embedCalls: string[] = []; const badEmbed: string[] = [];
  for (const f of fnFiles) {
    if (f === EMBED) continue;
    const code = blankComments(get(f));
    for (const m of code.matchAll(/(?<![.\w])geminiEmbed\s*\(/g)) {
      const args = argsOf(code, (m.index ?? 0) + m[0].length - 1);
      embedCalls.push(f);
      if (args.length !== 2 || !new RegExp(`fn: "${fnNameOf(f)}"`).test(args[1]) || !/feature: "[a-z_]+"/.test(args[1]) || !/userId: /.test(args[1])) badEmbed.push(`${f}:${lineOf(get(f), m.index ?? 0)}`);
    }
  }
  ok('A10 every geminiEmbed caller names its function, feature and account', embedCalls.length >= 3 && badEmbed.length === 0, `${embedCalls.length} callers; bad: ${badEmbed.join(', ')}`);
  // a helper that reads the account off its request object needs a handler that noted it
  const unnoted = fnFiles.filter(f => f !== LOGGER).filter(f => {
    const code = blankComments(get(f));
    const reads = (code.match(/(?<![.\w])aiCallerOf\(/g) ?? []).length;
    const notes = [...code.matchAll(/(?<![.\w])noteAiCaller\(/g)].map(m => argsOf(code, (m.index ?? 0) + m[0].length - 1));
    return reads > 0 && (notes.length === 0 || !notes.every(a => a.length === 2 && /\buserId\b/.test(a[1])));
  });
  const noters = fnFiles.filter(f => f !== LOGGER && /(?<![.\w])aiCallerOf\(/.test(blankComments(get(f))));
  ok('A11 where a helper reads the billed account off its request (aiCallerOf), the handler notes it (noteAiCaller with a userId)', noters.length === 3 && unnoted.length === 0,
    `readers: ${noters.join(', ')}; without a note: ${unnoted.join(', ')}`);

  // ── B. the logger's shape (behaviour is run once, below) ──
  const logger = get(LOGGER);
  const entryBlock = logger.match(/export interface AiCallLogEntry \{\n([\s\S]*?)\n\}/)?.[1] ?? '';
  const entryFields = [...entryBlock.matchAll(/^\s*([a-z_0-9]+)\??:\s*([^;]+);/gm)].map(m => ({ name: m[1], type: m[2].trim() }));
  const migration = get(MIGRATION);
  const tableBody = migration.match(/create table if not exists public\.ai_call_log \(\n([\s\S]*?)\n\);/)?.[1] ?? '';
  const columns = [...tableBody.matchAll(/^  ([a-z_0-9]+)\s+(?:bigint|timestamptz|uuid|text|integer)/gm)].map(m => m[1]);
  const WRITER_SETS = ['id', 'created_at', 'est_cost_micros', 'price_version'];
  ok('B1 the log entry type is the table, column for column', entryFields.length > 10
    && JSON.stringify(entryFields.map(f => f.name)) === JSON.stringify(columns.filter(c => !WRITER_SETS.includes(c))),
    `entry: ${entryFields.map(f => f.name).join(',')}\n      table: ${columns.join(',')}`);
  const STRING_OK: Record<string, string> = { user_id: 'string | null', request_id: 'string | null', feature: 'string', function: 'string', provider: 'AiProvider', model: 'string', outcome: 'AiOutcome' };
  const freeText = entryFields.filter(f => (STRING_OK[f.name] ?? 'number | null') !== f.type);
  const CONTENT = /prompt|answer|question|response|content|text|message|file|name|title|body|query|note|detail|description|url|path|email/i;
  const contentish = [...entryFields.map(f => f.name), ...columns].filter(n => CONTENT.test(n));
  ok('B2 the entry carries no free-text field: seven identifier / enum fields, every other one number | null', freeText.length === 0 && contentish.length === 0,
    [...freeText.map(f => `${f.name}: ${f.type}`), ...contentish].join(', '));
  const metaBlock = logger.match(/export interface AiCallMeta \{\n([\s\S]*?)\n\}/)?.[1] ?? '';
  const metaFields = [...metaBlock.matchAll(/^\s*([A-Za-z]+)\??:/gm)].map(m => m[1]);
  ok('B3 a call site can state only fn, feature, userId, model, images, pdfPages, requestId', JSON.stringify(metaFields) === JSON.stringify(['fn', 'feature', 'userId', 'model', 'images', 'pdfPages', 'requestId']), metaFields.join(','));
  ok('B4 the logger imports only the price table and reads the provider reply from a clone',
    JSON.stringify([...logger.matchAll(/^import .* from "([^"]+)";/gm)].map(m => m[1])) === JSON.stringify(['./aiPrices.ts']) && /clone = resp\.clone\(\);/.test(logger) && !/console\.(log|error)\([^)]*(json|text|body)\b/.test(logger));

  // ── C. prices ──
  const prices = get(PRICES);
  const entries = [...prices.matchAll(/\{\s*provider: "([a-z-]+)",\s*model: "([^"]+)",([\s\S]*?)\n  \},/g)].map(m => ({ provider: m[1], model: m[2], body: m[3] }));
  const SRC: Record<string, string> = { ANTHROPIC_SOURCE: prices.match(/const ANTHROPIC_SOURCE = "([^"]+)";/)?.[1] ?? '', GEMINI_SOURCE: prices.match(/const GEMINI_SOURCE = "([^"]+)";/)?.[1] ?? '' };
  const OWN_PAGE: Record<string, RegExp> = { anthropic: /^https:\/\/(platform\.claude\.com|docs\.anthropic\.com|www\.anthropic\.com|claude\.com)\/.*pricing/, gemini: /^https:\/\/ai\.google\.dev\/.*pricing/ };
  const badPrice = entries.filter(e => {
    const srcRef = e.body.match(/source: ([A-Z_]+|"[^"]+"),/)?.[1] ?? '';
    const url = srcRef.startsWith('"') ? srcRef.slice(1, -1) : SRC[srcRef] ?? '';
    return !(OWN_PAGE[e.provider]?.test(url)) || !/readOn: "20\d\d-\d\d-\d\d",/.test(e.body) || !/inputPerM: [\d.]+,/.test(e.body) || !/outputPerM: [\d.]+,/.test(e.body);
  });
  ok("C1 every priced model has per-million input and output prices, the provider's own pricing page and the day it was read", entries.length >= 5 && badPrice.length === 0,
    `${entries.length} entries; bad: ${badPrice.map(e => e.model).join(', ')}`);
  ok('C2 the price version is a date and each pricing URL is cited in the header with what was read', /export const PRICE_VERSION = "20\d\d-\d\d-\d\d";/.test(prices)
    && Object.values(SRC).every(u => u !== '' && prices.split(u).length >= 3));
  const priced = new Set(entries.map(e => e.model));
  const named = new Map<string, string>();
  for (const f of fnFiles) {
    if (f === PRICES) continue;
    for (const m of blankComments(get(f)).matchAll(/["'`]((?:gemini|claude|gpt|text-embedding|whisper)-[a-z0-9.-]+)["'`]/g)) if (!named.has(m[1])) named.set(m[1], f);
  }
  const unpriced = [...named].filter(([id]) => !priced.has(id));
  ok('C3 every model id the functions name has a verified price (a new model is a decision, not a silent NULL)', named.size >= 4 && unpriced.length === 0,
    unpriced.map(([id, f]) => `${id} (${f})`).join(', '));
  ok('C4 an unknown model or missing token counts give NULL, never a guess', /if \(!p\) return null;/.test(prices) && /if \(u\.inputTokens === null \|\| u\.outputTokens === null\) return null;/.test(prices)
    && /return MODEL_PRICES\.find\(\(p\) => p\.provider === provider && p\.model === model\) \?\? null;/.test(prices));

  // ── D. the migration ──
  const sql = migration.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  ok('D1 row level security is on and the table has no policy', /alter table public\.ai_call_log enable row level security;/.test(sql) && !/create policy/i.test(sql) && !/disable row level security/i.test(sql));
  ok('D2 no client grant: everything revoked from public, anon, authenticated; only the service role is granted',
    /revoke all on public\.ai_call_log from public, anon, authenticated;/.test(sql)
      && JSON.stringify((sql.match(/^grant [^;]+;/gm) ?? [])) === JSON.stringify(['grant select, insert, delete on public.ai_call_log to service_role;', 'grant execute on function public.ai_call_log_purge() to service_role;'])
      && /revoke all on function public\.ai_call_log_purge\(\) from public, anon, authenticated;/.test(sql));
  ok('D3 indexes on (created_at), (user_id, created_at), (feature, created_at)',
    /on public\.ai_call_log \(created_at\);/.test(sql) && /on public\.ai_call_log \(user_id, created_at\);/.test(sql) && /on public\.ai_call_log \(feature, created_at\);/.test(sql));
  ok('D4 a 400-day purge, scheduled daily and guarded where pg_cron is absent',
    /delete from public\.ai_call_log where created_at < now\(\) - interval '400 days';/.test(sql)
      && /if exists \(select 1 from pg_extension where extname = 'pg_cron'\) then\s*perform cron\.schedule\('ai-call-log-purge', '\d+ \d+ \* \* \*', \$j\$ select public\.ai_call_log_purge\(\) \$j\$\);/.test(sql));
  ok('D5 additive and idempotent, with a self-check that fails the apply', /create table if not exists public\.ai_call_log/.test(sql) && !/drop table|alter table public\.(?!ai_call_log)/i.test(sql)
    && (sql.match(/create index if not exists/g) ?? []).length === (sql.match(/create (unique )?index/g) ?? []).length
    && (sql.match(/raise exception '\[ai_call_log\] verify:/g) ?? []).length >= 6);
  ok('D6 the header says what a row is, who writes, who reads, retention, deploy order, undo and verify-after',
    ['WHAT A ROW MEANS', 'WHO WRITES', 'WHO READS', 'RETENTION', 'DEPLOY ORDER', 'VERIFY AFTER', 'UNDO', 'PROOF'].every(h => migration.includes(`-- ${h}`)));
  ok('D7 an account deletion keeps the cost and drops the person', /user_id\s+uuid references auth\.users\(id\) on delete set null,/.test(sql));

  // ── E. construction-answer limits ──
  const L = loadLimits(get(LIMITS));
  ok('E1 limits.ts is pure and loads', !!L);
  if (L) {
    const decide = L.hourlyDecision as (n: number, limit?: number) => string;
    const left = L.stopMsLeft as (a: number, b: number, c?: number) => number;
    ok('E2 the numbers: 10 an hour, a 100 s stop, 8 rounds of at most 5 searches (40 an answer)',
      L.HOURLY_LIMIT === 10 && L.ANSWER_STOP_MS === 100_000 && L.MAX_ROUNDS === 8 && L.MAX_WEB_SEARCHES_PER_ROUND === 5 && L.MAX_WEB_SEARCHES_PER_ANSWER === 40,
      JSON.stringify([L.HOURLY_LIMIT, L.ANSWER_STOP_MS, L.MAX_ROUNDS, L.MAX_WEB_SEARCHES_PER_ROUND, L.MAX_WEB_SEARCHES_PER_ANSWER]));
    ok('E3 the 10th answer of the hour runs and the 11th is refused', decide(1) === 'ok' && decide(10) === 'ok' && decide(11) === 'limited' && decide(500) === 'limited');
    ok('E4 a limiter that cannot answer refuses the run (fail closed)', decide(-1) === 'unavailable' && decide(NaN) === 'unavailable' && decide(Infinity) === 'unavailable'
      && decide(undefined as unknown as number) === 'unavailable' && decide('3' as unknown as number) === 'unavailable');
    ok('E5 the stop: time left at 0 s, 99.9 s; none at 100 s, after it, or on a garbled clock',
      left(1000, 1000) === 100_000 && left(1000, 100_900) === 100 && left(1000, 101_000) === 0 && left(1000, 300_000) < 0 && left(NaN, 5) === 0 && left(1000, 999) === 0);
    const hourly = (L.hourlyLimitBody as () => Record<string, string>)();
    const stopped = (L.answerStoppedBody as () => Record<string, string>)();
    const down = (L.limiterUnavailableBody as () => Record<string, string>)();
    ok('E6 the three bodies carry a typed code and a plain sentence', hourly.code === 'hourly_limit' && hourly.message === 'Construction Answers limit reached (10 per hour). Try again in an hour.'
      && stopped.code === 'answer_timeout' && /took too long/.test(stopped.message) && /did not count toward this month's limit/.test(stopped.message) && /narrower question/.test(stopped.message)
      && down.code === 'rate_limiter_unavailable' && !/Resets (?:on )?the 1st/i.test(hourly.message + stopped.message));
  }
  const askCode = blankComments(ask);
  const at = (needle: string) => askCode.indexOf(needle);
  const hourlyAt = at('const hourly = hourlyDecision(await rateLimitCount(`construction-answer:user:${auth.userId}`), HOURLY_LIMIT);');
  ok('E7 the hourly limit is per account, after the Business gate, the key check and the monthly cap, and before any Anthropic call',
    hourlyAt > at('requireTier(req, ["business"], "construction_answer")') && hourlyAt > at('if (!ANTHROPIC_API_KEY) {') && hourlyAt > at('if (used >= cap) {')
      && hourlyAt > 0 && hourlyAt < at('new Anthropic(') && hourlyAt < at('.messages.stream('));
  ok('E8 a failed limiter is a 503 and the limit a 429, both before the run',
    /if \(hourly === "unavailable"\) return jsonResp\(limiterUnavailableBody\(\), 503\);\n\s*if \(hourly === "limited"\) return jsonResp\(hourlyLimitBody\(HOURLY_LIMIT\), 429\);/.test(ask)
      && at('if (hourly === "limited")') < at('new Anthropic('));
  ok('E9 the loop is bounded by MAX_ROUNDS and each round by MAX_WEB_SEARCHES_PER_ROUND (no other bound, no literal)',
    (askCode.match(/for \(let iter = 0; iter < MAX_ROUNDS; iter\+\+\) \{/g) ?? []).length === 1 && !/while\s*\(/.test(askCode.slice(at('const client = new Anthropic('), at('const parsed = parseFooter(fullText);')))
      && /\{ type: "web_search_20260209", name: "web_search", max_uses: MAX_WEB_SEARCHES_PER_ROUND \},/.test(ask) && (askCode.match(/max_uses:/g) ?? []).length === 1
      && /if \(iter === MAX_ROUNDS - 1\) hitCap = true;/.test(ask) && (askCode.match(/runOnce\(\)/g) ?? []).length === 2);
  const streams = [...askCode.matchAll(/\.messages\.stream\(/g)].map(m => { const open = (m.index ?? 0) + m[0].length - 1; return argsOf(askCode, open); });
  ok('E10 both model calls of the loop carry the stop signal', streams.length === 2 && streams.every(a => a.length === 2 && /^\s*\{ signal: stop\.signal \}\s*$/.test(a[1])));
  ok('E11 the stop is armed from the handler start for ANSWER_STOP_MS, checked before each round, and cleared when the loop ends',
    /const stop = new AbortController\(\);\n\n  try \{/.test(ask)
      && /const stopTimer = setTimeout\(\(\) => stop\.abort\(\), Math\.max\(0, stopMsLeft\(startedAt, Date\.now\(\), ANSWER_STOP_MS\)\)\);/.test(ask)
      && /for \(let iter = 0; iter < MAX_ROUNDS; iter\+\+\) \{\n\s*if \(stop\.signal\.aborted \|\| stopMsLeft\(startedAt, Date\.now\(\), ANSWER_STOP_MS\) <= 0\) \{\n\s*stop\.abort\(\);\n\s*throw new Error\(/.test(ask)
      && /\} finally \{\n\s*clearTimeout\(stopTimer\);\n\s*\}/.test(ask) && at('clearTimeout(stopTimer);') < at('const parsed = parseFooter(fullText);'));
  ok('E12 a stop is not mistaken for a rejected beta (no second attempt)', /\} catch \(e\) \{\n\s*\/\/[^\n]*\n\s*if \(stop\.signal\.aborted\) throw e;/.test(ask));
  const catchAt = at('} catch (err) {');
  ok('E13 a stopped run answers 504 answer_timeout before the generic 500',
    /\} catch \(err\) \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(stop\.signal\.aborted\) \{\n\s*console\.error\([^\n]*\n\s*return jsonResp\(answerStoppedBody\(\), 504\);\n\s*\}/.test(ask)
      && catchAt > 0 && at('return jsonResp(answerStoppedBody(), 504);') < at('return jsonResp({ error: "Internal error" }, 500);'));
  ok('E14 a stopped run is not charged: the one monthly increment sits after the loop, like every run that ends without an answer',
    (askCode.match(/aiUsageIncrement\(/g) ?? []).length === 1 && at('await aiUsageIncrement(auth.userId, "construction_answer");') > at('clearTimeout(stopTimer);')
      && at('await aiUsageIncrement(auth.userId, "construction_answer");') < catchAt);
  const client = get(CLIENT);
  const appWait = Number((client.match(/export const ANSWER_TIMEOUT_MS = ([\d_]+);/)?.[1] ?? '0').replace(/_/g, ''));
  ok('E15 the server stops (100 s) before the app gives up (120 s), and the app shows the server sentence for answer_timeout',
    appWait === 120_000 && appWait > Number(L?.ANSWER_STOP_MS ?? Infinity)
      && /if \(code === 'answer_timeout'\) \{\n\s*return new ConstructionAnswerError\('timeout', message \|\| CONSTRUCTION_ANSWER_COPY\.timeout\);/.test(client));
  ok('E16 every model call of one answer shares a request id and the function name',
    /const callMeta = \{ fn: "construction-answer", feature: "construction_answer", userId: auth\.userId, model: MODEL, requestId: crypto\.randomUUID\(\) \};/.test(ask)
      && (ask.match(/logAnthropicSdkCall\(null, callMeta, \(\) => client\.(?:beta\.)?messages\.stream\(/g) ?? []).length === 2);
  return { results, sites };
}

// ── run on the disk ──────────────────────────────────────────────────────────
let pass = 0; let fail = 0;
const say = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
};
const base = analyze(DISK);
console.log('\nAI cost log: every model call site, derived from supabase/functions/**');
const listed = base.sites.filter(s => !(s.kind === 'sdk' && INJECTED_CLIENT.has(s.file)));
for (const s of listed) console.log(`    ${relative(FN_DIR, s.file)}:${s.line}  ${s.wrapper ?? 'NOT LOGGED'}  ${s.text}`);
console.log(`    (${listed.length} call sites in ${new Set(listed.map(s => s.file)).size} files; the code-cards call is the .messages.create( site: codeCardRequirements.ts runs it through the logging client it is handed)\n`);
for (const r of base.results) say(r.name, r.pass, r.detail);

// ── B (behaviour): the real modules, run under Bun ───────────────────────────
type Row = Record<string, unknown>;
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
async function behaviour() {
  console.log('\nthe logger and the price table, run');
  const LOG = await import(join(ROOT, LOGGER));
  const PR = await import(join(ROOT, PRICES));
  const rows: Row[] = [];
  const everyRow: Row[] = [];
  const admin = { from: (t: string) => ({ insert: async (row: Row) => { rows.push({ __table: t, ...row }); everyRow.push(row); return { error: null }; } }) };
  const until = async (n: number) => { for (let i = 0; i < 100 && rows.length < n; i++) await wait(5); await wait(15); };
  const U = '00000000-0000-4000-8000-0000000000a1';
  const meta = { fn: 'ai', feature: 'ai_text', userId: U, model: 'gemini-2.5-flash' };
  const gem = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  // prices
  const cost = PR.estCostMicros as (p: string, m: string, u: Row) => number | null;
  const tok = (o: Row) => ({ inputTokens: null, outputTokens: null, thinkingTokens: null, cachedTokens: null, cacheWriteTokens: null, toolCalls: null, ...o });
  say('P1 Gemini 2.5 Flash: 10,000 in + 1,000 out + 500 thinking = 3,000 + 3,750 = 6,750 micros', cost('gemini', 'gemini-2.5-flash', tok({ inputTokens: 10_000, outputTokens: 1000, thinkingTokens: 500 })) === 6750);
  say('P2 Gemini 2.5 Pro under 200k: 100,000 in (20,000 cached) + 2,000 out = 100,000 + 2,500 + 20,000 = 122,500', cost('gemini', 'gemini-2.5-pro', tok({ inputTokens: 100_000, cachedTokens: 20_000, outputTokens: 2000 })) === 122_500);
  say('P3 Gemini 2.5 Pro over 200k moves the whole call to the long-context rates: 250,000 x 2.50 + 1,000 x 15 = 640,000', cost('gemini', 'gemini-2.5-pro', tok({ inputTokens: 250_000, outputTokens: 1000 })) === 640_000);
  say('P4 Claude Opus 4.8: 1,000 plain + 2,000 cache write + 3,000 cache read + 500 out + 3 searches = 5,000 + 12,500 + 1,500 + 12,500 + 30,000 = 61,500',
    cost('anthropic', 'claude-opus-4-8', tok({ inputTokens: 6000, cacheWriteTokens: 2000, cachedTokens: 3000, outputTokens: 500, toolCalls: 3 })) === 61_500);
  say('P5 an unknown model, an unknown provider and missing token counts are NULL', cost('gemini', 'gemini-9-ultra', tok({ inputTokens: 5, outputTokens: 5 })) === null
    && cost('rork-stt', 'unknown', tok({ inputTokens: 5, outputTokens: 5 })) === null && cost('gemini', 'gemini-2.5-flash', tok({})) === null
    && cost('gemini', 'gemini-2.5-flash', tok({ inputTokens: 5 })) === null && PR.priceFor('anthropic', 'claude-opus-4-8-fast') === null);
  say('P6 a kind of token the entry has no rate for is NULL (web searches on Gemini), not priced at zero', cost('gemini', 'gemini-2.5-flash', tok({ inputTokens: 5, outputTokens: 5, toolCalls: 2 })) === null);

  // usage readers
  const gu = LOG.usageFromGemini({ usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300, thoughtsTokenCount: 80, cachedContentTokenCount: 200, totalTokenCount: 1580 } });
  say("L1 Gemini's usage block is read as given (prompt, candidates, thoughts, cached)", gu.input_tokens === 1200 && gu.output_tokens === 300 && gu.thinking_tokens === 80 && gu.cached_tokens === 200);
  const au = LOG.usageFromAnthropic({ input_tokens: 100, output_tokens: 900, cache_creation_input_tokens: 4000, cache_read_input_tokens: 6000, server_tool_use: { web_search_requests: 4 } });
  say("L2 Anthropic's usage block: whole prompt = uncached + cache write + cache read; web searches counted", au.input_tokens === 10_100 && au.output_tokens === 900 && au.cached_tokens === 6000 && au.cache_write_tokens === 4000 && au.tool_calls === 4);
  say('L3 no usage block → every count NULL (so the cost is NULL)', LOG.usageFromGemini({}).input_tokens === null && LOG.usageFromAnthropic(undefined).output_tokens === null);

  // rowFor: identifiers only
  const dirty = LOG.rowFor({ user_id: 'not-a-uuid', request_id: 'x', feature: 'how deep do my "footings" need to be?\n', function: 'ai; drop table', provider: 'gemini', model: 'gemini-2.5-flash', input_tokens: 10, output_tokens: 2,
    thinking_tokens: null, cached_tokens: null, cache_write_tokens: null, tool_calls: null, images: -3, pdf_pages: 2.9, duration_ms: 12, outcome: 'ok', http_status: 200 });
  say('L4 the row keeps identifiers only: prose loses every space and mark, a non-uuid account is NULL, a bad count is NULL',
    dirty.user_id === null && dirty.request_id === null && dirty.feature === 'howdeepdomyfootingsneedtobe' && dirty.function === 'aidroptable' && dirty.images === null && dirty.pdf_pages === 2
      && dirty.est_cost_micros === 8 && /^20\d\d-\d\d-\d\d$/.test(String(dirty.price_version)), JSON.stringify(dirty));
  say('L5 the row has exactly the table columns the writer sets', JSON.stringify(Object.keys(dirty).sort()) === JSON.stringify(['cache_write_tokens', 'cached_tokens', 'duration_ms', 'est_cost_micros', 'feature', 'function', 'http_status', 'images', 'input_tokens', 'model', 'outcome', 'output_tokens', 'pdf_pages', 'price_version', 'provider', 'request_id', 'thinking_tokens', 'tool_calls', 'user_id']));

  // wrappers: exactly one row per way a call can end, and the caller sees no difference
  const okBody = { candidates: [{ content: { parts: [{ text: '{"a":1}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100 } };
  const sent = gem(okBody);
  const got = await LOG.logGeminiCall(admin, { ...meta, images: 2 }, async () => sent);
  const gotBody = await got.json();
  await until(1);
  say('W1 ok: the caller gets the very same Response with its body unread; one row: tokens, cost 550, images 2',
    got === sent && gotBody.candidates[0].content.parts[0].text === '{"a":1}' && rows.length === 1 && rows[0].__table === 'ai_call_log' && rows[0].outcome === 'ok' && rows[0].http_status === 200
      && rows[0].input_tokens === 1000 && rows[0].output_tokens === 100 && rows[0].est_cost_micros === 550 && rows[0].images === 2 && rows[0].user_id === U && rows[0].function === 'ai' && rows[0].feature === 'ai_text', JSON.stringify(rows));
  rows.length = 0;
  const r429 = await LOG.logGeminiCall(admin, meta, async () => gem({ error: { message: 'quota' } }, 429));
  await until(1);
  say('W2 a non-2xx reply: one row, outcome error, the status, cost NULL', r429.status === 429 && rows.length === 1 && rows[0].outcome === 'error' && rows[0].http_status === 429 && rows[0].est_cost_micros === null);
  rows.length = 0;
  await LOG.logGeminiCall(admin, meta, async () => gem({ promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: { promptTokenCount: 50 } }));
  await LOG.logGeminiCall(admin, meta, async () => gem({ candidates: [{ finishReason: 'PROHIBITED_CONTENT' }], usageMetadata: { promptTokenCount: 50 } }));
  await LOG.logGeminiCall(admin, meta, async () => gem({ candidates: [{ content: { parts: [{ text: '  ' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 0 } }));
  await until(3);
  say('W3 blocked (prompt feedback), blocked (finish reason) and empty: one row each, the input tokens still counted',
    rows.length === 3 && JSON.stringify(rows.map(r => r.outcome)) === JSON.stringify(['blocked', 'blocked', 'empty']) && rows.every(r => r.input_tokens === 50 && r.est_cost_micros === 15), JSON.stringify(rows.map(r => [r.outcome, r.est_cost_micros])));
  rows.length = 0;
  const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  let thrown: unknown = null;
  try { await LOG.logGeminiCall(admin, meta, async () => { throw abort; }); } catch (e) { thrown = e; }
  let thrown2: unknown = null; const net = new TypeError('connection refused');
  try { await LOG.logGeminiCall(admin, meta, async () => { throw net; }); } catch (e) { thrown2 = e; }
  await until(2);
  say('W4 a timeout and a network failure rethrow the very same error; one row each: timeout, error',
    thrown === abort && thrown2 === net && rows.length === 2 && rows[0].outcome === 'timeout' && rows[1].outcome === 'error' && rows[0].input_tokens === null && rows[0].est_cost_micros === null, JSON.stringify(rows.map(r => r.outcome)));
  rows.length = 0;
  const msgOk = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 2000, output_tokens: 400, cache_read_input_tokens: 3000, server_tool_use: { web_search_requests: 2 } } };
  const sdkMeta = { fn: 'construction-answer', feature: 'construction_answer', userId: U, model: 'claude-opus-4-8', requestId: '11111111-1111-4111-8111-111111111111' };
  const m1 = await LOG.logAnthropicSdkCall(admin, sdkMeta, async () => msgOk);
  await LOG.logAnthropicSdkCall(admin, sdkMeta, async () => ({ stop_reason: 'refusal', content: [], usage: { input_tokens: 10, output_tokens: 1 } }));
  await LOG.logAnthropicSdkCall(admin, sdkMeta, async () => ({ stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', name: 'web_search' }], usage: { input_tokens: 10, output_tokens: 1 } }));
  let sdkThrown: unknown = null; const userAbort = Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' });
  try { await LOG.logAnthropicSdkCall(admin, sdkMeta, async () => { throw userAbort; }); } catch (e) { sdkThrown = e; }
  let sdk400: unknown = null; const bad = Object.assign(new Error('task_budget: unknown'), { name: 'BadRequestError', status: 400 });
  try { await LOG.logAnthropicSdkCall(admin, sdkMeta, async () => { throw bad; }); } catch (e) { sdk400 = e; }
  await until(5);
  say('W5 Anthropic SDK: ok (2,000 x 5 + 3,000 x 0.5 + 400 x 25 + 2 searches = 41,500), refused, a tool-only turn is ok, a stop is timeout, a 400 is error; one row each with the request id',
    m1 === msgOk && sdkThrown === userAbort && sdk400 === bad && rows.length === 5
      && JSON.stringify(rows.map(r => r.outcome)) === JSON.stringify(['ok', 'refused', 'ok', 'timeout', 'error']) && rows[0].est_cost_micros === 41_500 && rows[0].tool_calls === 2 && rows[0].input_tokens === 5000
      && rows[4].http_status === 400 && rows.every(r => r.request_id === sdkMeta.requestId && r.provider === 'anthropic'), JSON.stringify(rows.map(r => [r.outcome, r.est_cost_micros, r.http_status])));
  rows.length = 0;
  await LOG.logOpaqueCall('rork-stt', admin, { fn: 'transcribe-audio', feature: 'stt', userId: U, model: 'unknown' }, async () => new Response('{"text":"hello"}', { status: 200 }));
  await LOG.logAnthropicHttpCall(admin, { fn: 'analyze-takeoff', feature: 'analyze_takeoff', userId: U, model: 'claude-sonnet-4-5' }, async () => gem({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_takeoff', input: {} }], usage: { input_tokens: 1000, output_tokens: 1000 } }));
  await until(2);
  say('W6 speech-to-text: one row, no tokens, cost NULL; Anthropic over fetch: 1,000 x 3 + 1,000 x 15 = 18,000',
    rows.length === 2 && rows[0].provider === 'rork-stt' && rows[0].outcome === 'ok' && rows[0].est_cost_micros === null && rows[1].est_cost_micros === 18_000 && rows[1].outcome === 'ok', JSON.stringify(rows));
  rows.length = 0;
  const flat = JSON.stringify(everyRow);
  say(`W7 nothing a reply or an error says reaches a row (${everyRow.length} rows written above: no reply text, no error text, no key)`,
    everyRow.length === 14 && !/\{\\"a\\":1\}|hello|quota|connection refused|aborted|task_budget|submit_takeoff|web_search"/.test(flat)
      && everyRow.every(r => Object.values(r).every(v => v === null || typeof v === 'number' || (typeof v === 'string' && /^[A-Za-z0-9._:\/-]{1,80}$/.test(v)))), flat.slice(0, 300));

  // logAiCall never throws, never hangs
  const entry = { user_id: U, request_id: null, feature: 'ai_text', function: 'ai', provider: 'gemini', model: 'gemini-2.5-flash', input_tokens: 1, output_tokens: 1, thinking_tokens: null, cached_tokens: null, cache_write_tokens: null, tool_calls: null, images: null, pdf_pages: null, duration_ms: 1, outcome: 'ok', http_status: 200 };
  let threw = false;
  try {
    await LOG.logAiCall({ from: () => { throw new Error('boom'); } }, entry);
    await LOG.logAiCall({ from: () => ({ insert: async () => { throw new Error('boom'); } }) }, entry);
    await LOG.logAiCall({ from: () => ({ insert: async () => ({ error: { code: '42P01', message: 'relation "ai_call_log" does not exist' } }) }) }, entry);
    await LOG.logAiCall(null, entry); // no service key in this process: a quiet no-op
  } catch { threw = true; }
  say('N1 a throwing client, a rejected insert, a missing table and a missing service key never throw', !threw);
  const t0 = Date.now();
  await LOG.logAiCall({ from: () => ({ insert: () => new Promise(() => undefined) }) }, entry);
  const took = Date.now() - t0;
  say(`N2 an insert that never answers is abandoned at the bound (${LOG.LOG_TIMEOUT_MS} ms; took ${took} ms)`, LOG.LOG_TIMEOUT_MS <= 3000 && took >= LOG.LOG_TIMEOUT_MS - 50 && took < LOG.LOG_TIMEOUT_MS + 1500);
  const t1 = Date.now();
  const slow = await LOG.logGeminiCall({ from: () => ({ insert: () => new Promise(() => undefined) }) }, meta, async () => gem(okBody));
  say(`N3 a wrapper does not wait for the write at all (returned in ${Date.now() - t1} ms with the insert hung)`, slow.status === 200 && Date.now() - t1 < 200);

  // the app's mapping of the two new refusals
  console.log('\nwhat the app shows');
  const CA = await import(join(ROOT, CLIENT));
  const limits = loadLimits(DISK.get(LIMITS) ?? '');
  if (limits) {
    const h = CA.mapConstructionAnswerFailure(429, (limits.hourlyLimitBody as () => Row)());
    say('S1 the hourly limit shows the server sentence as written, with no Try again button', h.code === 'limit_reached' && h.message === 'Construction Answers limit reached (10 per hour). Try again in an hour.' && !CA.isRetryableConstructionError(h.code), h.message);
    const s = CA.mapConstructionAnswerFailure(504, (limits.answerStoppedBody as () => Row)());
    say('S2 the stop shows "took too long ... did not count ... narrower question", with Try again', s.code === 'timeout' && /took too long/.test(s.message) && /did not count toward this month's limit/.test(s.message) && CA.isRetryableConstructionError(s.code), s.message);
    const d = CA.mapConstructionAnswerFailure(503, (limits.limiterUnavailableBody as () => Row)());
    say('S3 a limiter outage is a retryable "could not finish", not "isn\'t available yet"', d.code === 'server_error' && CA.isRetryableConstructionError(d.code), d.code);
    const m = CA.mapConstructionAnswerFailure(429, { code: 'monthly_cap', message: 'Monthly Construction Answers limit reached (100/mo on business). Resets the 1st (UTC).' });
    say('S4 the monthly cap still maps as before', m.code === 'limit_reached' && m.message.startsWith('Monthly Construction Answers limit reached (100/mo on business).'), m.message);
  } else say('S1 limits.ts loads', false);
}

// ── F. planted mutations ─────────────────────────────────────────────────────
interface Mutation { name: string; red: string[]; apply: (f: Files) => void }
const edit = (f: Files, file: string, from: string | RegExp, to: string) => {
  const src = f.get(file) ?? '';
  const out = typeof from === 'string' ? src.replace(from, () => to) : src.replace(from, to);
  if (out === src) throw new Error(`mutation anchor not found in ${file}: ${String(from).slice(0, 70)}`);
  f.set(file, out);
};
const fnFile = (dir: string) => `${FN_DIR}/${dir}/index.ts`;
const MUTATIONS: Mutation[] = [
  { name: 'M1 the log call is removed from the text relay (ai)', red: ['A2'], apply: f => edit(f, fnFile('ai'), 'await logGeminiCall(null, { fn: "ai", feature: "ai_text", userId: auth.userId, model }, async () => {', 'await unlogged(async () => {') },
  { name: 'M2 the log call is removed from Anthropic over fetch (analyze-takeoff)', red: ['A2'], apply: f => edit(f, fnFile('analyze-takeoff'), /await logAnthropicHttpCall\(null, \{[^}]*\}, async \(\) => \{/, 'await pass(async () => {') },
  { name: 'M3 a new, unlogged Gemini call is added to an existing function', red: ['A2'], apply: f => f.set(fnFile('scan-credential'), `${f.get(fnFile('scan-credential'))}\nasync function second() { return await fetch(\`\${ENDPOINT}?key=\${GEMINI_API_KEY}\`, { method: 'POST' }); }\n`) },
  { name: 'M4 a new edge function calls a model with no log', red: ['A2'], apply: f => f.set(fnFile('brand-new'), 'const URL_ = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";\nexport async function go(k: string) { const u = `${URL_}?key=${k}`; return await fetch(u, { method: "POST" }); }\n') },
  { name: 'M5 a new unlogged Anthropic SDK call is added to construction-answer', red: ['A2'], apply: f => edit(f, ASK, '    let msg: any = null;\n', '    let msg: any = null;\n    await client.messages.create({ model: MODEL, max_tokens: 5, messages: [] });\n') },
  { name: 'M6 the stream call escapes its wrapper', red: ['A2', 'E16'], apply: f => edit(f, ASK, 'return await logAnthropicSdkCall(null, callMeta, () => client.messages.stream(baseParams, { signal: stop.signal }).finalMessage());', 'return await client.messages.stream(baseParams, { signal: stop.signal }).finalMessage();') },
  { name: 'M7 the cards call loses its logging client', red: ['A8'], apply: f => edit(f, ASK, 'await requirementsFor(cardsClient, MODEL,', 'await requirementsFor(client as unknown as RequirementsClient, MODEL,') },
  { name: 'M8 the embedding helper stops logging', red: ['A2', 'A9'], apply: f => edit(f, EMBED, /r = await logGeminiCall\(null, \{[^}]*\}, async \(\) => \{/, 'r = await run(async () => {') },
  { name: 'M9 a geminiEmbed caller does not say who it is', red: ['A10'], apply: f => edit(f, fnFile('project-memory-search'), /await geminiEmbed\(\[query\], \{[^}]*\}\);/, 'await geminiEmbed([query]);') },
  { name: 'M10 two model calls share one wrapper (two calls, one row)', red: ['A4'], apply: f => edit(f, fnFile('safety-generate-jha'), "return await fetch(`${ENDPOINT}?key=${GEMINI_API_KEY}`, {", "await fetch(`${ENDPOINT}?key=${GEMINI_API_KEY}`, { method: 'POST' });\n      return await fetch(`${ENDPOINT}?key=${GEMINI_API_KEY}`, {") },
  { name: 'M11 a call site logs under another function\'s name', red: ['A5'], apply: f => edit(f, fnFile('scan-credential'), "fn: 'scan-credential',", "fn: 'scan-anything',") },
  { name: 'M12 the speech-to-text call is unlogged', red: ['A2'], apply: f => edit(f, fnFile('transcribe-audio'), /await logOpaqueCall\('rork-stt', null, \{[^}]*\}, async \(\) => \{/, 'await run(async () => {') },
  { name: 'M12b a handler stops noting who its model call is billed to (every row would have no account)', red: ['A11'], apply: f => edit(f, fnFile('analyze-plan-code'), '    noteAiCaller(body, { userId: auth.userId });\n', '') },
  { name: 'M13 the entry type gains a prompt field', red: ['B1', 'B2'], apply: f => edit(f, LOGGER, '  http_status: number | null;\n}', '  http_status: number | null;\n  prompt: string;\n}') },
  { name: 'M14 a count field becomes free text', red: ['B2'], apply: f => edit(f, LOGGER, '  images: number | null;\n  pdf_pages: number | null;\n  duration_ms', '  images: string;\n  pdf_pages: number | null;\n  duration_ms') },
  { name: 'M15 a price loses its source', red: ['C1'], apply: f => edit(f, PRICES, '    perToolCallMicros: 10_000,\n    source: ANTHROPIC_SOURCE,\n', '    perToolCallMicros: 10_000,\n') },
  { name: 'M16 a price is sourced from a blog, not the provider', red: ['C1'], apply: f => edit(f, PRICES, 'const GEMINI_SOURCE = "https://ai.google.dev/gemini-api/docs/pricing";', 'const GEMINI_SOURCE = "https://llm-prices.example.com/gemini";') },
  { name: 'M17 a price loses the day it was read', red: ['C1'], apply: f => edit(f, PRICES, '    audioInputPerM: 1,\n    source: GEMINI_SOURCE,\n    readOn: "2026-10-04",', '    audioInputPerM: 1,\n    source: GEMINI_SOURCE,') },
  { name: 'M18 a function names a model with no verified price', red: ['C3'], apply: f => edit(f, fnFile('scan-credential'), "const MODEL = 'gemini-2.5-flash';", "const MODEL = 'gemini-3-flash';") },
  { name: 'M19 an unknown model falls back to a guess', red: ['C4'], apply: f => edit(f, PRICES, 'if (!p) return null;', 'if (!p) return Math.round(n0(u.inputTokens) * 1);') },
  { name: 'M20 the migration gains a client read policy', red: ['D1'], apply: f => edit(f, MIGRATION, 'revoke all on public.ai_call_log from public, anon, authenticated;', 'revoke all on public.ai_call_log from public, anon, authenticated;\ncreate policy ai_call_log_own on public.ai_call_log for select to authenticated using (user_id = auth.uid());') },
  { name: 'M21 the migration grants select to authenticated', red: ['D2'], apply: f => edit(f, MIGRATION, 'grant select, insert, delete on public.ai_call_log to service_role;', 'grant select, insert, delete on public.ai_call_log to service_role;\ngrant select on public.ai_call_log to authenticated;') },
  { name: 'M22 the client revoke is dropped', red: ['D2'], apply: f => edit(f, MIGRATION, 'revoke all on public.ai_call_log from public, anon, authenticated;\n', '') },
  { name: 'M23 row level security is never enabled', red: ['D1'], apply: f => edit(f, MIGRATION, 'alter table public.ai_call_log enable row level security;\n', '') },
  { name: 'M24 the purge keeps 40 days', red: ['D4'], apply: f => edit(f, MIGRATION, "where created_at < now() - interval '400 days';", "where created_at < now() - interval '40 days';") },
  { name: 'M25 the table gains an answer_text column', red: ['B1', 'B2'], apply: f => edit(f, MIGRATION, '  price_version      text,\n', '  price_version      text,\n  answer_text        text,\n') },
  { name: 'M26 the hourly limit is 1,000', red: ['E2', 'E3', 'E6'], apply: f => edit(f, LIMITS, 'export const HOURLY_LIMIT = 10;', 'export const HOURLY_LIMIT = 1000;') },
  { name: 'M27 the hourly limit fails open', red: ['E4'], apply: f => edit(f, LIMITS, 'countAfter < 0) return "unavailable";', 'countAfter < 0) return "ok";') },
  { name: 'M28 the hourly limit is off by one (the 11th runs)', red: ['E3'], apply: f => edit(f, LIMITS, 'return countAfter - 1 >= limit ? "limited" : "ok";', 'return countAfter - 1 > limit ? "limited" : "ok";') },
  { name: 'M29 the hourly check is removed from the handler', red: ['E7', 'E8'], apply: f => edit(f, ASK, /    const hourly = hourlyDecision\([^\n]*\n[^\n]*\n[^\n]*\n/, '') },
  { name: 'M30 the hourly check moves after the first model call is possible (below the client)', red: ['E7', 'E8'], apply: f => {
    const src = f.get(ASK) ?? ''; const m = src.match(/    const hourly = hourlyDecision\([^\n]*\n[^\n]*\n[^\n]*\n/);
    if (!m) throw new Error('anchor');
    f.set(ASK, src.replace(m[0], '').replace('    let msg: any = null;\n', `    let msg: any = null;\n${m[0]}`));
  } },
  { name: 'M31 the hourly bucket is one for everybody (not per account)', red: ['E7'], apply: f => edit(f, ASK, 'rateLimitCount(`construction-answer:user:${auth.userId}`)', 'rateLimitCount(`construction-answer:all`)') },
  { name: 'M32 a model call drops the stop signal', red: ['E10'], apply: f => edit(f, ASK, '}, { signal: stop.signal }).finalMessage());', '}).finalMessage());') },
  { name: 'M33 the stop is 10 minutes', red: ['E2', 'E5', 'E15'], apply: f => edit(f, LIMITS, 'export const ANSWER_STOP_MS = 100_000;', 'export const ANSWER_STOP_MS = 600_000;') },
  { name: 'M34 the stop timer is never armed', red: ['E11'], apply: f => edit(f, ASK, /    const stopTimer = setTimeout\([^\n]*\n/, '    const stopTimer = undefined;\n') },
  { name: 'M35 no check before a new round', red: ['E11'], apply: f => edit(f, ASK, /      if \(stop\.signal\.aborted \|\| stopMsLeft\([^\n]*\n[^\n]*\n[^\n]*\n      \}\n/, '') },
  { name: 'M36 a stop falls through to the plain attempt', red: ['E12'], apply: f => edit(f, ASK, '          if (stop.signal.aborted) throw e;\n', '') },
  { name: 'M37 a stopped run answers the generic 500', red: ['E13'], apply: f => edit(f, ASK, /    if \(stop\.signal\.aborted\) \{\n      console\.error\([^\n]*\n      return jsonResp\(answerStoppedBody\(\), 504\);\n    \}\n/, '') },
  { name: 'M38 a stopped run is charged (the increment moves before the loop)', red: ['E14'], apply: f => {
    edit(f, ASK, '    await aiUsageIncrement(auth.userId, "construction_answer");\n', '');
    edit(f, ASK, '    let msg: any = null;\n', '    let msg: any = null;\n    await aiUsageIncrement(auth.userId, "construction_answer");\n');
  } },
  { name: 'M39 the loop runs 80 rounds', red: ['E9'], apply: f => edit(f, ASK, 'for (let iter = 0; iter < MAX_ROUNDS; iter++) {', 'for (let iter = 0; iter < 80; iter++) {') },
  { name: 'M40 a round may search 50 times', red: ['E9'], apply: f => edit(f, ASK, 'max_uses: MAX_WEB_SEARCHES_PER_ROUND }', 'max_uses: 50 }') },
  { name: 'M41 MAX_ROUNDS is 30', red: ['E2'], apply: f => edit(f, LIMITS, 'export const MAX_ROUNDS = 8;', 'export const MAX_ROUNDS = 30;') },
  { name: 'M42 the app no longer knows answer_timeout', red: ['E15'], apply: f => edit(f, CLIENT, "if (code === 'answer_timeout') {", "if (code === 'answer_timeout_v2') {") },
  { name: 'M43 the answer loses its shared request id', red: ['E16'], apply: f => edit(f, ASK, ', requestId: crypto.randomUUID() };', ' };') },
];

await behaviour();

console.log('\nplanted mutations (in memory; each must turn its check red)');
for (const m of MUTATIONS) {
  const files: Files = new Map(DISK);
  let err = '';
  let redNow: string[] = [];
  try {
    m.apply(files);
    redNow = analyze(files).results.filter(r => !r.pass).map(r => r.name.split(' ')[0]);
  } catch (e) { err = e instanceof Error ? e.message : String(e); }
  const want = m.red.filter(id => base.results.some(r => r.name.startsWith(`${id} `)));
  say(`${m.name} → red: ${redNow.join(', ') || 'nothing'}`, err === '' && want.length === m.red.length && want.every(id => redNow.includes(id)), err || `expected ${m.red.join(', ')}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
