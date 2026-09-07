// scripts/validate-edge-verify-jwt.ts — drift guard for supabase/config.toml.
//
// WHY. `supabase functions deploy <name>` resets verify_jwt to TRUE unless the
// value is pinned in supabase/config.toml (or --no-verify-jwt is passed on
// every single deploy). There was no config.toml, so three pg_cron targets
// (morning-digest, invoice-dunning, qbo-reconciler) were redeployed
// verify_jwt=true in July 2026 and answered 401 to every cron fire for ~6
// weeks while cron.job_run_details said "succeeded" — audit 2026-09-03
// EDGE-F1 / EDGE-F2, OPS-F1 / OPS-F3. The same deploy line would have killed
// the Stripe webhook, notify, mcp and the Friday homeowner digest.
//
// WHAT (pure source checks, no network):
//   (a) config.toml has exactly one [functions.<slug>] block per function
//       directory, each with an explicit verify_jwt, and no block for a
//       directory that does not exist;
//   (b) every function that authenticates itself out-of-band (cron secret,
//       Stripe / RevenueCat signature, portal access token, MCP token,
//       financing signature, signed unsubscribe token, self-declared public)
//       or is a pg_cron / DB-trigger target in the SQL is pinned FALSE — the
//       gateway must not demand a user JWT the caller cannot present;
//   (c) every verify_jwt = false function contains its own auth check IN CODE
//       (// and /* */ comments are stripped before matching — a comment that
//       said "portal access token" used to satisfy this rule; review
//       2026-09-04 advisory 5), or is allow-listed below as intentionally
//       public with a reason.
//
// Path handling matches validate-edge-typecheck.ts (fileURLToPath), so this
// runs from any cwd. Run via: bun run scripts/validate-edge-verify-jwt.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FN_DIR = join(ROOT, 'supabase', 'functions');
const CONFIG_PATH = join(ROOT, 'supabase', 'config.toml');
// Single production project (CLAUDE.md; lib/supabase.ts fallback URL; every
// pg_cron URL in supabase/migrations). A different ref here means the deploy
// would target the wrong project.
const EXPECTED_PROJECT_REF = 'nteoqhcswappxxjlpvap';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n    ${extra}` : ''); }
}
const read = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// ── minimal TOML reader: `[section]` headers + `key = value` lines ──────────
interface ParsedConfig {
  projectId: string | null;
  fns: Map<string, boolean | null>;
  duplicates: string[];
  malformed: string[];
}
function parseConfig(text: string): ParsedConfig {
  const fns = new Map<string, boolean | null>();
  const duplicates: string[] = [];
  const malformed: string[] = [];
  let projectId: string | null = null;
  let topLevel = true;
  let fnBlock: string | null = null;
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.replace(/^\s*#.*$/, '').replace(/\s+#.*$/, '').trim();
    if (!line) return;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      topLevel = false;
      const fn = section[1].trim().match(/^functions\.([A-Za-z0-9_-]+)$/);
      fnBlock = fn ? fn[1] : null;
      if (fn) {
        if (fns.has(fn[1])) duplicates.push(fn[1]);
        else fns.set(fn[1], null);
      }
      return;
    }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!kv) { malformed.push(`line ${i + 1}: ${rawLine.trim()}`); return; }
    const [, key, value] = kv;
    if (topLevel && key === 'project_id') { projectId = value.trim().replace(/^"|"$/g, ''); return; }
    if (fnBlock && key === 'verify_jwt') {
      if (value === 'true' || value === 'false') fns.set(fnBlock, value === 'true');
      else malformed.push(`line ${i + 1}: verify_jwt must be true or false, got ${value}`);
    }
  });
  return { projectId, fns, duplicates, malformed };
}

// ── (b) signals: a function that reads one of these cannot receive a user JWT ─
const MUST_BE_FALSE_SIGNALS: { name: string; re: RegExp; headerOnly?: boolean }[] = [
  { name: 'pg_cron shared secret (isValidCron / x-cron-secret)', re: /isValidCron\(|x-cron-secret/ },
  { name: 'Stripe webhook signature', re: /stripe-signature/i },
  { name: 'RevenueCat webhook authorization header', re: /REVENUECAT_WEBHOOK_SECRET/ },
  // `portal\??\.accessToken` also matches the optional-chained read
  // (`client_portal?.accessToken`) that portal-mark-viewed compares in code.
  { name: 'portal access token', re: /p_access_token|client_portal->>'accessToken'|portal\??\.accessToken|portal access token/i },
  { name: 'MCP personal token', re: /hashMcpToken\(|mage_mcp_/ },
  { name: 'financing HMAC signature', re: /x-financing-signature/ },
  { name: 'signed unsubscribe token', re: /verifyUnsubscribeToken\(/ },
  // The header comment says so in as many words ("verify_jwt: false", "verify_jwt is OFF").
  { name: 'self-declared public in its header comment', re: /verify_jwt(?:\s*(?::|=|is|must be set to)\s*)(?:false|off)/i, headerOnly: true },
];

// ── (c) signals: an in-code auth check a verify_jwt=false function may rely on ─
const OWN_AUTH_SIGNALS: { name: string; re: RegExp }[] = [
  { name: 'isValidCron', re: /isValidCron\(/ },
  { name: 'hasAuthenticatedUser', re: /hasAuthenticatedUser\(/ },
  { name: 'verifyUser (GoTrue-verified JWT)', re: /verifyUser(?:Token)?\(/ },
  { name: 'requireTier', re: /requireTier\(/ },
  { name: 'isServiceRoleToken', re: /isServiceRoleToken\(/ },
  { name: 'Stripe signature', re: /stripe-signature/i },
  { name: 'RevenueCat secret', re: /REVENUECAT_WEBHOOK_SECRET/ },
  { name: 'financing signature', re: /x-financing-signature/ },
  { name: 'signed OAuth state (verifyState)', re: /verifyState\(/ },
  { name: 'signed unsubscribe token', re: /verifyUnsubscribeToken\(/ },
  { name: 'HMAC-signed URL/token (crypto.subtle)', re: /crypto\.subtle\.(?:sign|verify)\(/ },
  { name: 'portal access token', re: /p_access_token|client_portal->>'accessToken'|portal\??\.accessToken|portal access token/i },
  { name: 'MCP personal token', re: /hashMcpToken\(/ },
  { name: 'rate-limited public path (rateLimitCount)', re: /rateLimitCount\(/ },
];

// Intentionally public, verify_jwt=false functions with NO in-code auth check.
// Each entry needs a reason; an entry whose function grows an auth check
// becomes stale and fails below, so the list cannot drift.
const INTENTIONALLY_PUBLIC: Record<string, string> = {
  'public-cost-index':
    'GET-only read of the SECURITY DEFINER public_cost_index() aggregate (opt-in ' +
    'contributors, >=5 per group, median/p25/p75 only) for the marketing site and ' +
    'crawlers; nothing per-caller to protect. OPS-F14c asks for a limiter — add ' +
    'rateLimitCount and delete this entry when it lands.',
};

// ── comment stripper for rule (c) ───────────────────────────────────────────
// (c) must find an auth check IN CODE. Matching the raw source let a function
// flip to verify_jwt = false on the strength of a comment that mentioned
// "portal access token" (review 2026-09-04, advisory 5). One pass over the
// source, tracking string / template (with ${} nesting) / regex literals so a
// `//` inside 'https://…' or /\/\// survives; `//` and `/* */` comments are
// blanked with their newlines kept. (The TOML reader above already drops `#`
// comments; rule (b)'s header-comment signal deliberately still reads comments.)
const REGEX_AFTER_KEYWORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'instanceof', 'new', 'throw', 'void', 'yield', 'await', 'delete']);
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  const emit = (s: string): void => { out += s; };
  // A `/` starts a regex literal after an operator / punctuator / keyword, and
  // is division after a value (identifier, number, `)`, `]`, a string).
  const regexAllowed = (): boolean => {
    const tail = out.replace(/\s+$/, '');
    if (tail === '') return true;
    const last = tail[tail.length - 1];
    if (/[\w$]/.test(last)) return REGEX_AFTER_KEYWORD.has((tail.match(/[\w$]+$/) ?? [''])[0]);
    return !(last === ')' || last === ']' || last === '"' || last === "'" || last === '`');
  };
  const scanTemplate = (): void => {
    while (i < n) {
      const c = src[i];
      if (c === '\\') { emit(src.slice(i, i + 2)); i += 2; continue; }
      if (c === '`') { emit(c); i++; return; }
      if (c === '$' && src[i + 1] === '{') {
        emit('${'); i += 2;
        scanCode(true);                       // stops AT the matching `}`
        if (i < n) { emit('}'); i++; }
        continue;
      }
      emit(c); i++;
    }
  };
  const scanCode = (stopAtBrace: boolean): void => {
    let depth = 0;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') {           // line comment → dropped
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && d === '*') {           // block comment → blanked, newlines kept
        const end = src.indexOf('*/', i + 2);
        const stop = end === -1 ? n : end + 2;
        emit(src.slice(i, stop).replace(/[^\n]/g, ' '));
        i = stop;
        continue;
      }
      if (c === '"' || c === "'") {           // string literal (kept verbatim)
        let j = i + 1;
        while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
        emit(src.slice(i, j + 1)); i = j + 1;
        continue;
      }
      if (c === '`') { emit(c); i++; scanTemplate(); continue; }
      if (c === '/' && regexAllowed()) {     // regex literal (kept verbatim)
        let j = i + 1, inClass = false;
        while (j < n && src[j] !== '\n') {
          const ch = src[j];
          if (ch === '\\') { j += 2; continue; }
          if (inClass) { if (ch === ']') inClass = false; }
          else if (ch === '[') inClass = true;
          else if (ch === '/') break;
          j++;
        }
        j++;                                  // closing slash
        while (j < n && /[a-z]/i.test(src[j])) j++; // flags
        emit(src.slice(i, j)); i = j;
        continue;
      }
      if (stopAtBrace) {
        if (c === '{') depth++;
        else if (c === '}') { if (depth === 0) return; depth--; }
      }
      emit(c); i++;
    }
  };
  scanCode(false);
  return out;
}

console.log('\nedge function verify_jwt pins (supabase/config.toml):');

// ── config + directories ────────────────────────────────────────────────────
ok('supabase/config.toml exists', existsSync(CONFIG_PATH), 'without it, every deploy resets verify_jwt to true (EDGE-F2)');
const cfg = parseConfig(read(CONFIG_PATH));
ok(`project_id is ${EXPECTED_PROJECT_REF}`, cfg.projectId === EXPECTED_PROJECT_REF, `got ${cfg.projectId ?? '(none)'}`);
ok('config.toml parses cleanly', cfg.malformed.length === 0, cfg.malformed.join('\n    '));
ok('no duplicate [functions.<slug>] blocks', cfg.duplicates.length === 0, cfg.duplicates.join(', '));

const dirs = existsSync(FN_DIR)
  ? readdirSync(FN_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(FN_DIR, d.name, 'index.ts')))
      .map((d) => d.name)
      .sort()
  : [];
ok('function directories were found', dirs.length > 0, `nothing under ${FN_DIR}`);

const missingFromConfig = dirs.filter((d) => !cfg.fns.has(d));
ok('(a) every function directory has a [functions.<slug>] block', missingFromConfig.length === 0,
  `add to supabase/config.toml: ${missingFromConfig.join(', ')}`);
const orphanEntries = [...cfg.fns.keys()].filter((s) => !dirs.includes(s));
ok('(a) every config block has a function directory', orphanEntries.length === 0,
  `no supabase/functions/<slug>/index.ts for: ${orphanEntries.join(', ')}`);
const unset = [...cfg.fns.entries()].filter(([, v]) => v === null).map(([k]) => k);
ok('(a) every block sets verify_jwt explicitly', unset.length === 0, `missing verify_jwt in: ${unset.join(', ')}`);
ok('(a) no underscore-prefixed (shared) directory is listed', ![...cfg.fns.keys()].some((s) => s.startsWith('_')));

// ── (b) must-be-false: source signals + SQL cron / trigger targets ──────────
const sqlFiles: string[] = [];
const migDir = join(ROOT, 'supabase', 'migrations');
if (existsSync(migDir)) for (const f of readdirSync(migDir)) if (f.endsWith('.sql')) sqlFiles.push(join(migDir, f));
for (const f of readdirSync(join(ROOT, 'supabase'))) if (f.endsWith('.sql')) sqlFiles.push(join(ROOT, 'supabase', f));
const sqlTargets = new Map<string, Set<string>>();
for (const f of sqlFiles) {
  for (const m of read(f).matchAll(/\/functions\/v1\/([a-z0-9-]+)/g)) {
    const slug = m[1];
    if (!sqlTargets.has(slug)) sqlTargets.set(slug, new Set());
    sqlTargets.get(slug)!.add(f.slice(ROOT.length + 1));
  }
}
ok('SQL cron / trigger targets were found', sqlTargets.size > 0, 'no /functions/v1/<slug> in supabase/**/*.sql — has the cron SQL moved?');

const sources = new Map<string, string>(dirs.map((d) => [d, read(join(FN_DIR, d, 'index.ts'))]));
const headerOf = (src: string): string => src.split('\n').slice(0, 40).join('\n');

const mustBeFalse = new Map<string, string[]>();
const addReason = (slug: string, why: string) => {
  if (!mustBeFalse.has(slug)) mustBeFalse.set(slug, []);
  mustBeFalse.get(slug)!.push(why);
};
for (const [slug, src] of sources) {
  for (const sig of MUST_BE_FALSE_SIGNALS) {
    if (sig.re.test(sig.headerOnly ? headerOf(src) : src)) addReason(slug, sig.name);
  }
}
for (const [slug, files] of sqlTargets) {
  if (sources.has(slug)) addReason(slug, `pg_cron / trigger target in ${[...files].join(', ')}`);
}
ok('(b) at least the known cron targets are derived', ['morning-digest', 'invoice-dunning', 'qbo-reconciler', 'notify', 'stripe-webhook'].every((s) => mustBeFalse.has(s)),
  'the signal table or the SQL scan has regressed');
for (const slug of [...mustBeFalse.keys()].sort()) {
  const v = cfg.fns.get(slug);
  ok(`(b) ${slug} is verify_jwt = false`, v === false,
    `it cannot receive a user JWT — ${mustBeFalse.get(slug)!.join('; ')}. A gateway 401 here is silent (pg_net / Stripe retries).`);
}

// ── (c) self-test: the stripper is load-bearing, so it is exercised here ─────
// A function whose only "auth" is prose in comments must NOT pass (c); real
// code, URLs and regex literals that contain `//` must survive the strip.
const commentOnlySource = [
  '// portal access token gates this path',
  '/* isValidCron( is what the cron job would need',
  '   verifyUser( too */',
  "const url = 'https://example.test/rest/v1/rpc/x'; // p_access_token",
  'const proto = /\\/\\//; const half = 4 / 2;',
  'const t = `https://${host}/functions/v1/${slug}`; // hashMcpToken(',
  'export default 1;',
].join('\n');
const strippedCommentOnly = stripComments(commentOnlySource);
ok('(c) self-test: comment-only auth mentions are NOT an auth check', !OWN_AUTH_SIGNALS.some((s) => s.re.test(strippedCommentOnly)),
  `stripped source still matched: ${OWN_AUTH_SIGNALS.filter((s) => s.re.test(strippedCommentOnly)).map((s) => s.name).join(', ')}`);
ok('(c) self-test: the same source DOES match unstripped (the strip is what closes advisory 5)', OWN_AUTH_SIGNALS.some((s) => s.re.test(commentOnlySource)));
ok('(c) self-test: a // inside a string literal survives', strippedCommentOnly.includes("'https://example.test/rest/v1/rpc/x'"));
ok('(c) self-test: a regex literal containing // survives, division too', strippedCommentOnly.includes('/\\/\\//') && strippedCommentOnly.includes('4 / 2'));
ok('(c) self-test: template literals with ${} interpolation survive', strippedCommentOnly.includes('`https://${host}/functions/v1/${slug}`'));
ok('(c) self-test: line count is preserved', strippedCommentOnly.split('\n').length === commentOnlySource.split('\n').length);
ok('(c) self-test: a real in-code check still matches after stripping',
  OWN_AUTH_SIGNALS.some((s) => s.re.test(stripComments("const user = await verifyUser(req); /* portal access token */\nif (!user) return new Response('nope', { status: 401 });"))));

// ── (c) every false function authenticates itself IN CODE, or is allow-listed ─
for (const [slug, v] of [...cfg.fns.entries()].sort()) {
  if (v !== false) continue;
  const code = stripComments(sources.get(slug) ?? '');
  const matched = OWN_AUTH_SIGNALS.filter((s) => s.re.test(code)).map((s) => s.name);
  const listed = Object.prototype.hasOwnProperty.call(INTENTIONALLY_PUBLIC, slug);
  if (listed) {
    ok(`(c) ${slug} is intentionally public (allow-listed) and still has no auth check`, matched.length === 0,
      `it now has ${matched.join(', ')} — delete its INTENTIONALLY_PUBLIC entry`);
  } else {
    ok(`(c) ${slug} authenticates itself (${matched[0] ?? 'NONE'})`, matched.length > 0,
      'verify_jwt = false with no in-code auth = publicly invocable. Add a check, or allow-list it with a reason.');
  }
}
for (const slug of Object.keys(INTENTIONALLY_PUBLIC)) {
  ok(`allow-list entry ${slug} refers to a real verify_jwt = false function`, cfg.fns.get(slug) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('\n✗ validate-edge-verify-jwt: fix supabase/config.toml (or the function) before deploying — see EDGE-F1/F2.');
  process.exit(1);
}
