// validate-skill-certificates.ts — an app-skills certificate exists only
// because the SERVER graded a passing answer sheet, a client can never mint
// one, and the public check page shows only what the row and the key hold.
// OWNER: LEARNCERT.
//
//   (a) TOPICS — the migration's topic check lists exactly the SKILL_TOPICS ids
//       (utils/learn/topics.ts), which are exactly the generated key's topics.
//   (b) PASS — the migration's pass check is `correct * 100 >= <PASS_PCT> *
//       total` with PASS_PCT from topics.ts (and the key's SKILL_PASS_PCT);
//       total is 3 to 5; correct is 0 to total.
//   (c) WRITES — RLS is enabled in the same file; no insert / update / all
//       policy; no grant of insert or update to authenticated; insert, update,
//       truncate, trigger and references revoked from authenticated; all
//       revoked from anon; select-own and delete-own policies only; no column
//       grant either (the grant scan reads `grant update (col) on …`, and the
//       in-migration self-check uses has_any_column_privilege).
//   (d) AWARD — the award function imports SKILL_QUIZ_KEY from the generated
//       key, re-verifies the user, rate-limits per user, refuses another quiz
//       version with 409, grades with integer pass math (no division), and
//       never logs the holder name or the answers; it answers 401 without a
//       user, refuses a graded total that is not the key's, stores the CLEANED
//       name under the verified user.id, ignores a duplicate (never overwrites),
//       reads back by user_id + topic + version, and answers 410 for a revoked
//       row. Its pure helpers are RUN:
//       isPass, grade, parseBody, cleanHolderName, newVerifyCode.
//   (e) VERIFY — the verify function's select list never names user_id, email
//       or id; the format check runs before the rate limit, which runs before
//       the database; GET / OPTIONS only; the per-IP key is cf-connecting-ip,
//       else the LAST x-forwarded-for hop; title and scope come from the key
//       (scope = topics.ts's template for every topic); errors are no-store,
//       a 200 is cached 60 s; the lookup is an exact .eq("verify_code", code);
//       the header says "verify_jwt is OFF".
//   (f) PAGE — marketing/skills/index.html carries CERT_SCOPE_NOTE and
//       CERT_NAME_NOTE verbatim (the name note directly under the name), is
//       noindex + no-referrer, loads no analytics and no third-party script,
//       never uses innerHTML (every value goes in with textContent), carries
//       the exact copy, and holds none of the credential words (seal, ribbon,
//       badge, shield, hard hat, wallet, card number, expir…, certified, OSHA,
//       license outside CERT_SCOPE_NOTE). Its classify / code / date
//       functions are RUN; the date is pinned to America/New_York so every
//       viewer reads the same issue date.
//   (g) CONFIG — supabase/config.toml: skill-certificate-award verify_jwt =
//       true, skill-certificate-verify verify_jwt = false.
//   (h) DELETION — delete-account lists app_skill_certificates in
//       USER_SCOPED_TABLES.
//   (i) ROUTE — /skills/* → /skills/index.html 200 in BOTH marketing/_redirects
//       and marketing/netlify.toml, ahead of the catch-all 404.
//
// PLANTED MUTATIONS. Every rule (a)-(i) is also run against an in-memory copy
// of its real file with one planted defect, and that copy must FAIL the rule
// (section "planted mutations" below). A rule that cannot see its own defect
// is reported as broken.
//
// Pure node:fs + direct imports + Bun.Transpiler (the edge functions are Deno;
// their import lines and serve() call are cut and the pure helpers run here).
// Run: bun run scripts/validate-skill-certificates.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PASS_PCT, SKILL_TOPICS } from '../utils/learn/topics';
import { CERT_NAME_NOTE, CERT_SCOPE_NOTE } from '../utils/learn/types';
import { SKILL_PASS_PCT, SKILL_QUIZ_KEY } from '../supabase/functions/_shared/skillQuizKey.generated';

// The project has no bun-types; declare the one Bun API this file uses (tsc
// includes scripts/**, the same pattern as validate-closeout-binder.ts).
declare const Bun: { Transpiler: new (o: { loader: 'ts' | 'js' }) => { transformSync(code: string): string } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const P = {
  migration: 'supabase/migrations/20261001120000_app_skill_certificates.sql',
  award: 'supabase/functions/skill-certificate-award/index.ts',
  verify: 'supabase/functions/skill-certificate-verify/index.ts',
  ipHelper: 'supabase/functions/_shared/notifyGuards.ts',
  page: 'marketing/skills/index.html',
  config: 'supabase/config.toml',
  deleteAccount: 'supabase/functions/delete-account/index.ts',
  redirects: 'marketing/_redirects',
  netlify: 'marketing/netlify.toml',
};

let pass = 0;
let fail = 0;
function rule(name: string, problems: string[]) {
  if (problems.length === 0) { pass++; console.log(`  ✓ ${name}`); return; }
  fail++;
  console.log(`  ✗ ${name}`);
  for (const p of problems.slice(0, 25)) console.log(`      ${p}`);
}

/** SQL without -- comments (a comment naming a grant is not a grant). */
const sqlCode = (s: string) => s.replace(/--[^\n]*/g, '');
/** TS without block comments and // comments that start a line or follow code
 *  after whitespace (a URL's // inside a string is preceded by ':' and stays). */
const tsCode = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
/** TOML without # comments. */
const tomlCode = (s: string) => s.replace(/#[^\n]*/g, '');

const TOPIC_IDS = SKILL_TOPICS.map(t => t.id as string);

// ── (a) topics ───────────────────────────────────────────────────────────────
export function checkTopics(mig: string): string[] {
  const p: string[] = [];
  const m = /topic\s+text\s+not\s+null\s+check\s*\(\s*topic\s+in\s*\(([\s\S]*?)\)\s*\)/i.exec(sqlCode(mig));
  if (!m) return ['no `topic text not null check (topic in (…))` in the migration'];
  const listed = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  const want = [...TOPIC_IDS].sort();
  const got = [...listed].sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    p.push(`migration topics ≠ SKILL_TOPICS — missing: ${want.filter(t => !got.includes(t)).join(', ') || 'none'}; extra: ${got.filter(t => !want.includes(t)).join(', ') || 'none'}`);
  }
  if (new Set(listed).size !== listed.length) p.push('a topic is listed twice in the migration');
  const keyTopics = Object.keys(SKILL_QUIZ_KEY.TOPICS).sort();
  if (JSON.stringify(keyTopics) !== JSON.stringify(want)) p.push(`generated key topics ≠ SKILL_TOPICS: ${keyTopics.join(', ')}`);
  return p;
}

// ── (b) pass rule ────────────────────────────────────────────────────────────
export function checkPass(mig: string): string[] {
  const p: string[] = [];
  const code = sqlCode(mig);
  if (PASS_PCT !== SKILL_PASS_PCT || SKILL_QUIZ_KEY.PASS_PCT !== PASS_PCT) p.push(`PASS_PCT ${PASS_PCT} ≠ the key's ${SKILL_PASS_PCT}/${SKILL_QUIZ_KEY.PASS_PCT}`);
  const pc = [...code.matchAll(/check\s*\(\s*correct\s*\*\s*100\s*>=\s*(\d+)\s*\*\s*total\s*\)/gi)];
  if (pc.length !== 1) p.push(`expected one \`check (correct * 100 >= N * total)\`, found ${pc.length}`);
  else if (Number(pc[0][1]) !== PASS_PCT) p.push(`the migration passes at ${pc[0][1]} percent; PASS_PCT is ${PASS_PCT}`);
  if (!/total\s+integer\s+not\s+null\s+check\s*\(\s*total\s+between\s+3\s+and\s+5\s*\)/i.test(code)) p.push('total is not checked 3 to 5');
  if (!/check\s*\(\s*correct\s+between\s+0\s+and\s+total\s*\)/i.test(code)) p.push('correct is not checked 0 to total');
  if (!/holder_name[\s\S]{0,80}char_length\(btrim\(holder_name\)\)\s+between\s+2\s+and\s+80/i.test(code)) p.push('holder_name length 2 to 80 is not checked');
  if (!/position\('@'\s+in\s+holder_name\)\s*=\s*0/i.test(code)) p.push("holder_name '@' is not refused");
  if (!/holder_name\s*!~\s*'\[\[:cntrl:\]\]'/i.test(code)) p.push('holder_name control characters are not refused');
  if (!/verify_code\s+text\s+not\s+null\s+unique\s+check\s*\(\s*verify_code\s*~\s*'\^\[A-HJ-NP-Z2-9\]\{12\}\$'\s*\)/.test(code)) p.push('verify_code is not unique + ^[A-HJ-NP-Z2-9]{12}$');
  if (!/unique\s*\(\s*user_id\s*,\s*topic\s*,\s*quiz_version\s*\)/i.test(code)) p.push('no unique (user_id, topic, quiz_version)');
  if (!/user_id\s+uuid\s+not\s+null\s+references\s+auth\.users\(id\)\s+on\s+delete\s+cascade/i.test(code)) p.push('user_id is not a cascading FK to auth.users');
  return p;
}

// ── (c) writes ───────────────────────────────────────────────────────────────
export function checkWrites(mig: string): string[] {
  const p: string[] = [];
  const code = sqlCode(mig).replace(/\s+/g, ' ');
  const T = 'public\\.app_skill_certificates';
  if (!new RegExp(`alter table ${T} enable row level security;`, 'i').test(code)) p.push('RLS is not enabled in this file');
  if (/for (insert|update|all)\b/i.test(code)) p.push('an insert / update / all policy exists (the award function is the only writer)');
  // Matches table grants AND column grants (`grant update (holder_name) on …`).
  for (const g of code.matchAll(/grant ([a-z_, ()]+?) on (?:table )?public\.app_skill_certificates to ([a-z_, ]+);/gi)) {
    const verbs = g[1].toLowerCase().replace(/\([^)]*\)/g, ' ');
    const roles = g[2].toLowerCase();
    if (/\b(anon|public)\b/.test(roles)) p.push(`grant to ${roles}: ${g[0]}`);
    if (/\bauthenticated\b/.test(roles) && /\b(insert|update|all|truncate|trigger|references)\b/.test(verbs)) p.push(`authenticated is granted a write verb: ${g[0]}`);
  }
  if (!new RegExp(`grant select, delete on ${T} to authenticated;`, 'i').test(code)) p.push('authenticated is not granted exactly select, delete');
  const rev = new RegExp(`revoke ([a-z, ]+) on ${T} from authenticated;`, 'i').exec(code);
  const revoked = rev ? rev[1].toLowerCase().split(',').map(s => s.trim()) : [];
  for (const v of ['insert', 'update', 'truncate', 'trigger', 'references']) if (!revoked.includes(v)) p.push(`${v} is not revoked from authenticated`);
  if (!new RegExp(`revoke all on ${T} from anon, public;`, 'i').test(code)) p.push('all is not revoked from anon, public');
  for (const v of ['insert', 'update']) {
    if (!new RegExp(`has_any_column_privilege\\('authenticated', '${T}', '${v}'\\)`, 'i').test(code)) p.push(`the self-check does not refuse a column ${v} grant (has_any_column_privilege)`);
  }
  const pols = [...code.matchAll(/create policy (\w+) on public\.app_skill_certificates for (\w+) to (\w+) using \((.*?)\);/gi)];
  const kinds = pols.map(x => x[2].toLowerCase()).sort();
  if (JSON.stringify(kinds) !== JSON.stringify(['delete', 'select'])) p.push(`policies are ${kinds.join(', ') || 'none'}; want select + delete`);
  for (const x of pols) {
    if (x[3].toLowerCase() !== 'authenticated') p.push(`policy ${x[1]} is for ${x[3]}`);
    if (x[4].replace(/\s+/g, '') !== 'auth.uid()=user_id') p.push(`policy ${x[1]} is not own-rows (${x[4]})`);
  }
  return p;
}

// ── (d) award ────────────────────────────────────────────────────────────────
export function checkAwardSource(src: string): string[] {
  const p: string[] = [];
  const code = tsCode(src);
  if (!/import\s*\{[^}]*\bSKILL_QUIZ_KEY\b[^}]*\}\s*from\s*"\.\.\/_shared\/skillQuizKey\.generated\.ts"/.test(code)) p.push('does not import SKILL_QUIZ_KEY from ../_shared/skillQuizKey.generated.ts');
  if (!/correct\s*\*\s*100\s*>=\s*SKILL_PASS_PCT\s*\*\s*total/.test(code)) p.push('pass math is not `correct * 100 >= SKILL_PASS_PCT * total`');
  const isPassBody = /function isPass\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(code)?.[1] ?? '';
  if (!isPassBody) p.push('isPass() not found');
  if (/[^/*]\/[^/*]/.test(isPassBody)) p.push('isPass divides (integer math only)');
  if (!/const user = await verifyUser\(req\);\s*if \(!user\) return json\(\{ error: "unauthorized" \}, 401\);/.test(code)) p.push('does not re-verify the user with verifyUser(req) and answer 401 without one');
  if (!/graded\.total !== key\.total\) return json\(\{ error: "bad_request" \}, 400\)/.test(code)) p.push('a graded total that differs from the key total is not refused');
  if (!/const holderName = cleanHolderName\(body\.holderName\);/.test(code) || !/\bholder_name: holderName,/.test(code) || /holder_name:\s*body\./.test(code)) p.push('the row does not store the CLEANED name (holder_name: holderName from cleanHolderName)');
  const ownerSets = [...code.matchAll(/\buser_id:\s*([^,\n]+),/g)].map(m => m[1].trim());
  if (ownerSets.length !== 1 || ownerSets[0] !== 'user.id') p.push(`the row's user_id must be exactly the verified user.id (found: ${ownerSets.join(' | ') || 'none'})`);
  if (!/onConflict: "user_id,topic,quiz_version", ignoreDuplicates: true/.test(code)) p.push('the upsert does not ignore a duplicate (a re-award would overwrite the issued row)');
  const readBack = code.slice(Math.max(0, code.indexOf('.upsert(')));
  if (!/\.select\(CERT_COLUMNS\)\s*\.eq\("user_id", user\.id\)\s*\.eq\("topic", body\.topic\)\s*\.eq\("quiz_version", key\.version\)/.test(readBack)) p.push('the read-back is not filtered on user_id, topic and quiz_version');
  if (!/if \(cert\.revoked_at !== null\) return json\(\{ error: "revoked" \}, 410\);/.test(code)) p.push('a revoked row is handed back as a pass (want 410 revoked)');
  if (!/rateLimitCount\(`skill-cert-award:\$\{user\.id\}`\)/.test(code)) p.push('no per-user rateLimitCount(`skill-cert-award:${user.id}`)');
  if (!/AWARD_HOURLY_LIMIT\s*=\s*30\b/.test(code) || !/hits\s*>\s*AWARD_HOURLY_LIMIT\)\s*return json\(\{\s*error:\s*"rate_limited"\s*\},\s*429\)/.test(code)) p.push('the award limit is not 30/h → 429 rate_limited');
  if (!/body\.quizVersion\s*!==\s*key\.version\)\s*return json\(\{\s*error:\s*"quiz_changed"\s*\},\s*409\)/.test(code)) p.push('another quiz version is not refused with 409 quiz_changed');
  if (!/if \(!isPass\(correct, total\)\) return json\(\{ passed: false, correct, total \}\);/.test(code)) p.push('a fail does not answer {passed:false, correct, total} before any write');
  const failAt = code.indexOf('if (!isPass(correct, total))');
  const writeAt = code.indexOf('.upsert(');
  if (failAt < 0 || writeAt < 0 || failAt > writeAt) p.push('the pass check does not come before the write');
  if (!/req\.method !== "POST"\) return json\([^)]*405\)/.test(code)) p.push('not POST-only (405)');
  for (const m of code.matchAll(/console\.(?:log|info|warn|error|debug)\(([^;]*)\);/g)) {
    if (/holderName|holder_name|answers|body\b|raw\b|cert\b|\bname\b/.test(m[1])) p.push(`a log line may carry the name or the answers: ${m[0].slice(0, 120)}`);
  }
  return p;
}

type Fn = (...a: never[]) => unknown;
/** Cut the Deno imports and the serve() call, strip `export`, transpile, and
 *  return the named helpers. Throws when the file changed shape. */
function loadHelpers(src: string, names: string[], inject: Record<string, unknown>): Record<string, Fn> {
  const at = src.search(/^serve\(/m);
  if (at < 0) throw new Error('no top-level serve( call');
  const body = src.slice(0, at)
    .replace(/^import[\s\S]*?from\s*"[^"]+";\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(body);
  const keys = Object.keys(inject);
  // eslint-disable-next-line no-new-func
  const f = new Function(...keys, `${js}\nreturn { ${names.join(', ')} };`);
  return f(...keys.map(k => inject[k])) as Record<string, Fn>;
}
const DENO = { env: { get: () => '' } };
const CODE_RE = /^[A-HJ-NP-Z2-9]{12}$/;

export function checkAwardBehaviour(src: string): string[] {
  const p: string[] = [];
  let h: Record<string, Fn>;
  try {
    h = loadHelpers(src, ['isPass', 'grade', 'parseBody', 'cleanHolderName', 'newVerifyCode', 'CODE_ALPHABET'],
      { SKILL_QUIZ_KEY, SKILL_PASS_PCT, Deno: DENO });
  } catch (e) { return [`could not load the award helpers: ${(e as Error).message}`]; }
  const isPass = h.isPass as unknown as (c: number, t: number) => boolean;
  const grade = h.grade as unknown as (a: Record<string, string>, k: Readonly<Record<string, string>>) => { correct: number; total: number } | null;
  const parseBody = h.parseBody as unknown as (raw: unknown) => unknown;
  const clean = h.cleanHolderName as unknown as (s: string) => string | null;
  const newCode = h.newVerifyCode as unknown as () => string;
  const alphabet = h.CODE_ALPHABET as unknown as string;

  const passCases: [number, number, boolean][] = [[5, 5, true], [4, 5, true], [3, 5, false], [3, 3, true], [2, 3, false], [4, 4, true], [3, 4, false], [0, 5, false], [6, 5, false], [4.5, 5, false]];
  for (const [c, t, want] of passCases) if (isPass(c, t) !== want) p.push(`isPass(${c}, ${t}) should be ${want}`);

  const key = SKILL_QUIZ_KEY.TOPICS['punch-walk'].answers;
  const right = { ...key };
  const g5 = grade(right, key);
  if (!g5 || g5.correct !== 5 || g5.total !== 5) p.push(`grade(all right) = ${JSON.stringify(g5)}`);
  const oneWrong = { ...key, q1: key.q1 === 'a' ? 'b' : 'a' };
  if (grade(oneWrong, key)?.correct !== 4) p.push('grade(one wrong) should be 4');
  const missing: Record<string, string> = { ...key };
  delete missing.q5;
  if (grade(missing, key) !== null) p.push('grade with a missing question should be null (400)');
  if (grade({ ...key, q9: 'a' }, key)?.total !== 5) p.push('an extra answer id must not change the total');

  const ok = { topic: 'punch-walk', quizVersion: 1, answers: right, holderName: 'Omir Majeed' };
  if (!parseBody(ok)) p.push('parseBody refused a well-formed body');
  const bad: [string, unknown][] = [
    ['unknown topic', { ...ok, topic: 'osha-30' }],
    ['__proto__ topic', { ...ok, topic: '__proto__' }],
    ['constructor topic', { ...ok, topic: 'constructor' }],
    ['string version', { ...ok, quizVersion: '1' }],
    ['fractional version', { ...ok, quizVersion: 1.5 }],
    ['array answers', { ...ok, answers: ['a', 'b'] }],
    ['number answer', { ...ok, answers: { ...right, q1: 1 } }],
    ['missing name', { ...ok, holderName: undefined }],
    ['null body', null],
    ['array body', []],
  ];
  for (const [why, b] of bad) if (parseBody(b) !== null) p.push(`parseBody accepted: ${why}`);

  const names: [string, string | null][] = [
    ['  Omir   Majeed ', 'Omir Majeed'],
    ['Omir‮Majeed', 'Omir Majeed'],
    ['Omir\u0007Majeed', 'Omir Majeed'],
    ['omir@mageid.app', null],
    ['O', null],
    [' \t ', null],
    ['x'.repeat(81), null],
    ['x'.repeat(80), 'x'.repeat(80)],
    ['José Núñez', 'José Núñez'],
  ];
  for (const [inp, want] of names) if (clean(inp) !== want) p.push(`cleanHolderName(${JSON.stringify(inp)}) = ${JSON.stringify(clean(inp))}, want ${JSON.stringify(want)}`);

  if (alphabet !== 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') p.push(`CODE_ALPHABET is "${alphabet}", want the 32 characters A-H J-N P-Z 2-9`);
  const seen = new Set<string>();
  const codes = new Set<string>();
  for (let i = 0; i < 3000; i++) {
    const c = newCode();
    if (!CODE_RE.test(c)) { p.push(`newVerifyCode() produced ${c}`); break; }
    codes.add(c);
    for (const ch of c) seen.add(ch);
  }
  if (seen.size !== 32) p.push(`3000 codes used ${seen.size} of the 32 characters`);
  if (codes.size !== 3000) p.push('newVerifyCode() repeated a code in 3000 draws');
  if (!/crypto\.getRandomValues\(/.test(tsCode(src)) || /Math\.random\(/.test(tsCode(src))) p.push('codes must come from crypto.getRandomValues, never Math.random');
  return p;
}

// ── (e) verify ───────────────────────────────────────────────────────────────
const FORBIDDEN_COLUMNS = ['user_id', 'email', 'id'];
export function checkVerifySource(src: string, ipHelper: string): string[] {
  const p: string[] = [];
  const code = tsCode(src);
  if (!src.includes('verify_jwt is OFF: a public, rate-limited read of one certificate by its check code')) p.push('header comment "verify_jwt is OFF: a public, rate-limited read of one certificate by its check code" is missing');
  const consts = new Map<string, string>();
  for (const m of code.matchAll(/const (\w+)\s*=\s*"([^"]*)"/g)) consts.set(m[1], m[2]);
  const selects = [...code.matchAll(/\.select\(\s*([^)]*?)\s*\)/g)].map(m => m[1]);
  if (selects.length === 0) p.push('no .select( found');
  for (const s of selects) {
    const lit = /^"([^"]*)"$/.exec(s)?.[1] ?? consts.get(s);
    if (lit == null) { p.push(`select list is not a literal or a const: ${s}`); continue; }
    const cols = lit.split(',').map(c => c.trim().toLowerCase());
    for (const c of cols) if (FORBIDDEN_COLUMNS.includes(c) || c === '*' || c.includes('email')) p.push(`the verify select reads ${c}`);
  }
  const formatAt = code.search(/if \(!CODE_RE\.test\(code\)\) return json\(\{ error: "bad_code" \}, 400\)/);
  const limitAt = code.indexOf('rateLimitCount(');
  const dbAt = code.indexOf('.from("app_skill_certificates")');
  if (formatAt < 0) p.push('no format check answering 400 bad_code');
  if (!(formatAt >= 0 && limitAt > formatAt && dbAt > limitAt)) p.push('order must be: format check → rate limit → database read');
  if (!/CODE_RE\s*=\s*\/\^\[A-HJ-NP-Z2-9\]\{12\}\$\//.test(code)) p.push('CODE_RE is not /^[A-HJ-NP-Z2-9]{12}$/');
  if (!/req\.method !== "GET"\) return json\([^)]*405\)/.test(code)) p.push('not GET-only (405)');
  if (!/rateLimitCount\(`skill-cert-verify:\$\{clientIpFrom\(req\.headers\)\}`\)/.test(code)) p.push('the per-IP limit is not keyed on clientIpFrom(req.headers)');
  if (!/IP_HOURLY_LIMIT\s*=\s*120\b/.test(code) || !/hits\s*>\s*IP_HOURLY_LIMIT\)\s*return json\(\{\s*error:\s*"rate_limited"\s*\},\s*429\)/.test(code)) p.push('the verify limit is not 120/h → 429');
  if (!/"Cache-Control":\s*status === 200 \? "public, max-age=60" : "no-store"/.test(code)) p.push('200 is not max-age=60 with errors no-store');
  if (!/if \(!data\) return json\(\{ valid: false \}, 404\)/.test(code)) p.push('an unknown code does not answer 404 {valid:false}');
  if (!/x-forwarded-for/.test(ipHelper) || !/cf-connecting-ip/.test(ipHelper) || !/hops\[hops\.length - 1\]/.test(ipHelper)) p.push('clientIpFrom no longer keys on cf-connecting-ip, else the LAST x-forwarded-for hop');
  if (/\.(insert|update|upsert|delete)\(/.test(code)) p.push('the public verify function writes');
  if (!/\.eq\("verify_code", code\)/.test(code) || /\.(ilike|like|textSearch|or)\(/.test(code)) p.push('the verify lookup is not an exact .eq("verify_code", code)');
  return p;
}

export function checkVerifyBehaviour(src: string): string[] {
  const p: string[] = [];
  let h: Record<string, Fn>;
  try { h = loadHelpers(src, ['verifyPayload', 'scopeFor', 'PUBLIC_COLUMNS'], { SKILL_QUIZ_KEY, Deno: DENO }); }
  catch (e) { return [`could not load the verify helpers: ${(e as Error).message}`]; }
  const verifyPayload = h.verifyPayload as unknown as (r: Record<string, unknown>) => Record<string, unknown> | null;
  const scopeFor = h.scopeFor as unknown as (l: string) => string;
  for (const t of SKILL_TOPICS) {
    const k = SKILL_QUIZ_KEY.TOPICS[t.id];
    if (!k) { p.push(`no key entry for ${t.id}`); continue; }
    if (scopeFor(k.label) !== t.scope) p.push(`scope for ${t.id}: "${scopeFor(k.label)}" ≠ topics.ts "${t.scope}"`);
    if (k.certificateTitle !== t.certificateTitle) p.push(`title for ${t.id}: key "${k.certificateTitle}" ≠ topics.ts "${t.certificateTitle}"`);
  }
  const row = { topic: 'change-order-draft', quiz_version: 1, correct: 4, total: 5, holder_name: 'Omir Majeed', issued_at: '2026-10-01T14:00:00Z', revoked_at: null, user_id: 'u-1', id: 'r-1', email: 'x@y.z' };
  const out = verifyPayload(row);
  const want = ['valid', 'revoked', 'holderName', 'certificateTitle', 'scope', 'issuedAt', 'correct', 'total'];
  if (!out) p.push('verifyPayload returned null for a good row');
  else {
    if (JSON.stringify(Object.keys(out).sort()) !== JSON.stringify([...want].sort())) p.push(`verifyPayload keys: ${Object.keys(out).join(', ')}`);
    if (out.valid !== true || out.revoked !== false) p.push('a live row must be valid:true revoked:false');
    if (out.certificateTitle !== 'MAGE ID skills: Change orders' || out.scope !== 'Using change orders in the MAGE ID app.') p.push(`title/scope: ${out.certificateTitle} / ${out.scope}`);
    if (JSON.stringify(out).includes('u-1') || JSON.stringify(out).includes('r-1') || JSON.stringify(out).includes('x@y.z')) p.push('verifyPayload leaked user_id / id / email');
  }
  const rev = verifyPayload({ ...row, revoked_at: '2026-10-02T00:00:00Z' });
  if (!rev || rev.valid !== false || rev.revoked !== true) p.push('a revoked row must be valid:false revoked:true');
  if (verifyPayload({ ...row, topic: 'osha-30' }) !== null) p.push('an unknown topic must not get an invented title');
  if (verifyPayload({ ...row, topic: '__proto__' }) !== null) p.push('a __proto__ topic must not resolve');
  return p;
}

// ── (f) page ─────────────────────────────────────────────────────────────────
const BANNED_WORDS: [RegExp, string][] = [
  [/\bseal/i, 'seal'], [/\bribbon/i, 'ribbon'], [/\bbadge/i, 'badge'], [/\bshield/i, 'shield'],
  [/hard[\s-]?hat/i, 'hard hat'], [/\bwallet/i, 'wallet'], [/card[\s-]?(number|no\b|#)/i, 'card number'],
  [/\bexpir/i, 'expiry'], [/\bcertified\b/i, 'certified'], [/\bosha\b/i, 'OSHA'], [/\blicen[cs]e/i, 'license'],
  [/\bverified\b/i, 'verified'], [/\baccredit/i, 'accredited'],
];
const PAGE_COPY = [
  '<title>Check a MAGE ID skills certificate</title>',
  'Awarded to <strong id="cert-name"></strong>',
  "'Passed the in-app check, ' + d.correct + ' of ' + d.total",
  "'Issued ' + date",
  "We couldn't find a certificate with this code.",
  'This certificate was removed by its owner.',
  "Couldn't check this certificate right now. Try again in a minute.",
];
export function checkPageSource(html: string): string[] {
  const p: string[] = [];
  if (html.split(CERT_SCOPE_NOTE).length - 1 !== 1) p.push('CERT_SCOPE_NOTE is not on the page verbatim (exactly once)');
  if (html.split(CERT_NAME_NOTE).length - 1 !== 1) p.push('CERT_NAME_NOTE is not on the page verbatim (exactly once)');
  const nameAt = html.indexOf('id="cert-name"');
  const noteAt = html.indexOf(CERT_NAME_NOTE);
  const scoreAt = html.indexOf('id="cert-score"');
  if (!(nameAt >= 0 && noteAt > nameAt && scoreAt > noteAt)) p.push('CERT_NAME_NOTE is not directly under the name');
  if (!/<meta name="robots" content="noindex" \/>/.test(html)) p.push('not noindex');
  if (!/<meta name="referrer" content="no-referrer" \/>/.test(html)) p.push('no <meta name="referrer" content="no-referrer" />');
  for (const c of PAGE_COPY) if (!html.includes(c)) p.push(`copy missing: ${c}`);
  if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html)) p.push('the page writes HTML (innerHTML / outerHTML / insertAdjacentHTML / document.write); use textContent');
  if (!/setText\('cert-name', d\.holderName\)/.test(html) || !/\.textContent = value/.test(html)) p.push('the name is not set with textContent');
  if (/<script[^>]*\bsrc=/i.test(html)) p.push('the page loads a script file (no analytics, no third-party script)');
  if (/posthog|growth\.js|gtag|googletagmanager|plausible|segment|hotjar|clarity/i.test(html)) p.push('the page carries an analytics hook');
  if (/<link[^>]+href="https?:/i.test(html)) p.push('the page loads a third-party stylesheet or font');
  const hosts = [...html.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase())
    .filter(h => h !== 'nteoqhcswappxxjlpvap.supabase.co' && h !== 'www.w3.org');
  if (hosts.length) p.push(`the page names another host: ${[...new Set(hosts)].join(', ')}`);
  const prose = html.split(CERT_SCOPE_NOTE).join(' ');
  for (const [re, w] of BANNED_WORDS) if (re.test(prose)) p.push(`credential word on the page: ${w}`);
  return p;
}

type PageFns = {
  classifyVerifyResponse: (s: number, d: unknown) => string;
  codeFromPath: (p: string) => string;
  issuedDate: (iso: string) => string;
};
function loadPageFns(html: string): PageFns {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (scripts.length !== 1) throw new Error(`expected one inline script, found ${scripts.length}`);
  const pick = (name: string) => {
    const m = new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}`).exec(scripts[0]);
    if (!m) throw new Error(`function ${name} not found`);
    return m[0];
  };
  // eslint-disable-next-line no-new-func
  return new Function(`${pick('codeFromPath')}\n${pick('classifyVerifyResponse')}\n${pick('issuedDate')}\nreturn { codeFromPath, classifyVerifyResponse, issuedDate };`)() as PageFns;
}
export function checkPageBehaviour(html: string): string[] {
  const p: string[] = [];
  let f: PageFns;
  try { f = loadPageFns(html); } catch (e) { return [`could not load the page functions: ${(e as Error).message}`]; }
  const good = { valid: true, revoked: false, holderName: 'Omir', certificateTitle: 'MAGE ID skills: Takeoff', scope: 'Using takeoff in the MAGE ID app.', issuedAt: '2026-10-01T14:00:00Z', correct: 5, total: 5 };
  const cases: [number, unknown, string][] = [
    [200, good, 'found'],
    [200, { ...good, valid: false, revoked: true }, 'removed'],
    [404, { valid: false }, 'notfound'],
    [400, { error: 'bad_code' }, 'notfound'],
    [404, { code: 'NOT_FOUND', message: 'Requested function was not found' }, 'error'],
    [404, null, 'error'],
    [400, { error: 'bad_request' }, 'error'],
    [429, { error: 'rate_limited' }, 'error'],
    [502, { error: 'unavailable' }, 'error'],
    [200, null, 'error'],
    [200, { ...good, holderName: 7 }, 'error'],
    [200, { ...good, valid: false, revoked: false }, 'error'],
    [200, { ...good, correct: '5' }, 'error'],
  ];
  for (const [s, d, want] of cases) {
    const got = f.classifyVerifyResponse(s, d);
    if (got !== want) p.push(`classifyVerifyResponse(${s}, ${JSON.stringify(d)?.slice(0, 60)}) = ${got}, want ${want}`);
  }
  const paths: [string, string][] = [
    ['/skills/ABCDEFGH2345', 'ABCDEFGH2345'],
    ['/skills/abcd-efgh-2345', 'ABCDEFGH2345'],
    ['/skills/ABCD%20EFGH%202345', 'ABCDEFGH2345'],
    ['/skills/', ''],
    ['/skills', ''],
    ['/skills/%E0%A4%A', ''],
  ];
  for (const [path, want] of paths) if (f.codeFromPath(path) !== want) p.push(`codeFromPath(${path}) = ${f.codeFromPath(path)}, want ${want}`);
  const d = f.issuedDate('2026-10-01T16:00:00Z');
  if (!/^October 1, 2026$/.test(d)) p.push(`issuedDate → "${d}", want "October 1, 2026"`);
  if (f.issuedDate('not a date') !== '') p.push('issuedDate of garbage should be empty (error state)');
  // 02:30 UTC on Oct 2 is the evening of Oct 1 in New York: every viewer must
  // see the same date, whatever the viewer's own time zone.
  const late = f.issuedDate('2026-10-02T02:30:00Z');
  if (late !== 'October 1, 2026') p.push(`issuedDate(2026-10-02T02:30Z) → "${late}", want "October 1, 2026" (fixed America/New_York)`);
  if (!/timeZone: 'America\/New_York'/.test(html)) p.push("issuedDate does not pin timeZone: 'America/New_York' (the date would follow the viewer's zone)");
  return p;
}

// ── (g) config / (h) deletion / (i) route ────────────────────────────────────
export function checkConfig(toml: string): string[] {
  const code = tomlCode(toml);
  const p: string[] = [];
  const val = (fn: string) => {
    const all = [...code.matchAll(new RegExp(`\\[functions\\.${fn}\\]\\s*\\n\\s*verify_jwt\\s*=\\s*(true|false)`, 'g'))];
    return all.length === 1 ? all[0][1] : `${all.length} entries`;
  };
  if (val('skill-certificate-award') !== 'true') p.push(`skill-certificate-award verify_jwt: ${val('skill-certificate-award')} (want true)`);
  if (val('skill-certificate-verify') !== 'false') p.push(`skill-certificate-verify verify_jwt: ${val('skill-certificate-verify')} (want false)`);
  return p;
}
export function checkDeletion(src: string): string[] {
  const b = /USER_SCOPED_TABLES\s*=\s*\[([\s\S]*?)\];/.exec(tsCode(src));
  if (!b) return ['USER_SCOPED_TABLES not found in delete-account'];
  return [...b[1].matchAll(/'([a-z_]+)'/g)].some(m => m[1] === 'app_skill_certificates') ? [] : ["delete-account's USER_SCOPED_TABLES does not list 'app_skill_certificates'"];
}
export function checkRoute(redirects: string, netlify: string): string[] {
  const p: string[] = [];
  const r = tomlCode(redirects);
  const rule = r.search(/^\/skills\/\*\s+\/skills\/index\.html\s+200\s*$/m);
  const catchAll = r.search(/^\/\*\s+\/404\.html\s+404\s*$/m);
  if (rule < 0) p.push('_redirects has no "/skills/*  /skills/index.html  200"');
  else if (catchAll >= 0 && rule > catchAll) p.push('_redirects: the /skills/* rule comes after the catch-all 404');
  const n = tomlCode(netlify);
  const block = n.search(/\[\[redirects\]\]\s*\n\s*from = "\/skills\/\*"\s*\n\s*to = "\/skills\/index\.html"\s*\n\s*status = 200/);
  const nCatch = n.search(/from = "\/\*"/);
  if (block < 0) p.push('netlify.toml has no [[redirects]] /skills/* → /skills/index.html 200');
  else if (nCatch >= 0 && block > nCatch) p.push('netlify.toml: the /skills/* block comes after the catch-all 404');
  return p;
}

// ── run on the real files ────────────────────────────────────────────────────
const src = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, read(v)])) as Record<keyof typeof P, string>;

console.log('\nskill certificates (LEARNCERT):');
rule('(a) migration topics = SKILL_TOPICS = the generated key', checkTopics(src.migration));
rule(`(b) pass check = PASS_PCT (${PASS_PCT}), 3-5 questions, name / code / uniqueness checks`, checkPass(src.migration));
rule('(c) RLS on, no client insert / update, write verbs revoked, own-rows select + delete only', checkWrites(src.migration));
rule('(d) award: generated key, verifyUser, per-user limit, 409 on another version, integer pass math, no PII logs', checkAwardSource(src.award));
rule('(d) award helpers RUN: isPass, grade, parseBody, cleanHolderName, newVerifyCode', checkAwardBehaviour(src.award));
rule('(e) verify: no user_id / email / id read, format → limit → DB, GET only, last-hop IP, caching', checkVerifySource(src.verify, src.ipHelper));
rule('(e) verify helpers RUN: title + scope from the key (= topics.ts), payload keys, revoked', checkVerifyBehaviour(src.verify));
rule('(f) page: both notes verbatim, noindex, no analytics / third-party, textContent only, exact copy, no credential words', checkPageSource(src.page));
rule('(f) page functions RUN: classifyVerifyResponse, codeFromPath, issuedDate', checkPageBehaviour(src.page));
rule('(g) config.toml: award verify_jwt = true, verify verify_jwt = false', checkConfig(src.config));
rule('(h) delete-account lists app_skill_certificates', checkDeletion(src.deleteAccount));
rule('(i) /skills/* rewrite in _redirects and netlify.toml, ahead of the 404', checkRoute(src.redirects, src.netlify));

// ── planted mutations: each rule must see its own defect ────────────────────
function plant(text: string, from: string | RegExp, to: string): string {
  const out = text.replace(from, to);
  if (out === text) throw new Error(`plant anchor not found: ${String(from).slice(0, 70)}`);
  return out;
}
const PLANTS: { name: string; run: () => string[] }[] = [
  { name: '(a) a topic dropped from the migration', run: () => checkTopics(plant(src.migration, "    'closeout-binder'\n", "    'closeout-bindr'\n")) },
  { name: '(b) pass check at 60 percent', run: () => checkPass(plant(src.migration, 'correct * 100 >= 80 * total', 'correct * 100 >= 60 * total')) },
  { name: '(b) the @ check removed', run: () => checkPass(plant(src.migration, "position('@' in holder_name) = 0", 'true')) },
  { name: '(c) RLS enable removed', run: () => checkWrites(plant(src.migration, 'alter table public.app_skill_certificates enable row level security;', '')) },
  { name: '(c) insert granted to authenticated', run: () => checkWrites(plant(src.migration, 'grant select, delete on public.app_skill_certificates to authenticated;', 'grant select, insert, delete on public.app_skill_certificates to authenticated;')) },
  { name: '(c) truncate left with authenticated', run: () => checkWrites(plant(src.migration, 'revoke insert, update, truncate, trigger, references on', 'revoke insert, update, trigger, references on')) },
  { name: '(c) an insert policy added', run: () => checkWrites(src.migration + '\ncreate policy p on public.app_skill_certificates for insert to authenticated with check (true);\n') },
  { name: '(b) the control-character check removed', run: () => checkPass(plant(src.migration, "    and holder_name !~ '[[:cntrl:]]'\n", '')) },
  { name: '(c) a column update grant to authenticated', run: () => checkWrites(src.migration + '\ngrant update (holder_name) on public.app_skill_certificates to authenticated;\n') },
  { name: '(c) self-check loses has_any_column_privilege', run: () => checkWrites(plant(src.migration, "has_any_column_privilege('authenticated', 'public.app_skill_certificates', 'update')", "false")) },
  { name: '(c) select policy opened to everyone', run: () => checkWrites(plant(src.migration, '  for select to authenticated\n  using (auth.uid() = user_id);', '  for select to authenticated\n  using (true);')) },
  { name: '(d) pass math by division', run: () => checkAwardSource(plant(src.award, 'correct * 100 >= SKILL_PASS_PCT * total', '(correct / total) * 100 >= SKILL_PASS_PCT')) },
  { name: '(d) key import removed', run: () => checkAwardSource(plant(src.award, 'import { SKILL_PASS_PCT, SKILL_QUIZ_KEY } from "../_shared/skillQuizKey.generated.ts";', 'const SKILL_PASS_PCT = 80; const SKILL_QUIZ_KEY = { TOPICS: {} } as any;')) },
  { name: '(d) the holder name logged', run: () => checkAwardSource(plant(src.award, 'return json({ error: "bad_name" }, 400);', '{ console.log("bad name", body.holderName); return json({ error: "bad_name" }, 400); }')) },
  { name: '(d) quiz version not enforced', run: () => checkAwardSource(plant(src.award, 'if (body.quizVersion !== key.version) return json({ error: "quiz_changed" }, 409);', '')) },
  { name: '(d) the 401 return removed', run: () => checkAwardSource(plant(src.award, '  if (!user) return json({ error: "unauthorized" }, 401);\n', '')) },
  { name: '(d) the key-total check removed', run: () => checkAwardSource(plant(src.award, 'if (!graded || graded.total !== key.total)', 'if (!graded)')) },
  { name: '(d) the raw name stored', run: () => checkAwardSource(plant(src.award, '        holder_name: holderName,', '        holder_name: body.holderName,')) },
  { name: '(d) user_id taken from the body', run: () => checkAwardSource(plant(src.award, '        user_id: user.id,', '        user_id: (raw as { userId?: string }).userId ?? user.id,')) },
  { name: '(d) a re-award overwrites', run: () => checkAwardSource(plant(src.award, 'ignoreDuplicates: true', 'ignoreDuplicates: false')) },
  { name: '(d) read-back not filtered on user_id', run: () => checkAwardSource(plant(src.award, '    .eq("user_id", user.id)\n    .eq("topic", body.topic)', '    .eq("topic", body.topic)')) },
  { name: '(d) a revoked row passed back', run: () => checkAwardSource(plant(src.award, '  if (cert.revoked_at !== null) return json({ error: "revoked" }, 410);\n', '')) },
  { name: '(d) isPass at >= 60 (behaviour)', run: () => checkAwardBehaviour(plant(src.award, 'correct * 100 >= SKILL_PASS_PCT * total', 'correct * 100 >= 60 * total')) },
  { name: '(d) cleanHolderName lets @ through (behaviour)', run: () => checkAwardBehaviour(plant(src.award, 'if (name.includes("@") || len < 2', 'if (len < 2')) },
  { name: '(d) codes drawn from a shifted alphabet with a 0 in it (behaviour)', run: () => checkAwardBehaviour(plant(src.award, 'out += CODE_ALPHABET[b % n];', 'out += (CODE_ALPHABET.slice(1) + "0")[b % n];')) },
  { name: '(d) codes drawn from Math.random (behaviour)', run: () => checkAwardBehaviour(plant(src.award, 'crypto.getRandomValues(bytes);', 'bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });')) },
  { name: '(d) grade ignores a missing question (behaviour)', run: () => checkAwardBehaviour(plant(src.award, '    if (!hasOwn(answers, qid)) return null;\n', '')) },
  { name: '(e) verify selects user_id', run: () => checkVerifySource(plant(src.verify, '"topic, quiz_version, correct', '"user_id, topic, quiz_version, correct'), src.ipHelper) },
  { name: '(e) verify reads the DB before the format check', run: () => checkVerifySource(plant(src.verify, '  if (!CODE_RE.test(code)) return json({ error: "bad_code" }, 400);\n', ''), src.ipHelper) },
  { name: '(e) verify keyed on the FIRST x-forwarded-for hop', run: () => checkVerifySource(src.verify, plant(src.ipHelper, 'hops[hops.length - 1]', 'hops[0]')) },
  { name: '(e) verify looks the code up with ilike', run: () => checkVerifySource(plant(src.verify, '.eq("verify_code", code)', '.ilike("verify_code", code)'), src.ipHelper) },
  { name: '(e) verify accepts POST', run: () => checkVerifySource(plant(src.verify, 'if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);', ''), src.ipHelper) },
  { name: '(e) verify invents its own scope (behaviour)', run: () => checkVerifyBehaviour(plant(src.verify, 'return `Using ${lowerFirst(label)} in the MAGE ID app.`;', 'return `Certified in ${label}.`;')) },
  { name: '(e) verify payload passes user_id through (behaviour)', run: () => checkVerifyBehaviour(plant(src.verify, '    total: row.total,\n  };', '    total: row.total,\n    userId: (row as unknown as Record<string, unknown>).user_id,\n  };')) },
  { name: '(f) CERT_SCOPE_NOTE reworded', run: () => checkPageSource(plant(src.page, CERT_SCOPE_NOTE, CERT_SCOPE_NOTE.replace('short check', 'quick check'))) },
  { name: '(f) CERT_NAME_NOTE removed', run: () => checkPageSource(plant(src.page, CERT_NAME_NOTE, '')) },
  { name: '(f) the name set with innerHTML', run: () => checkPageSource(plant(src.page, 'document.getElementById(id).textContent = value;', 'document.getElementById(id).innerHTML = value;')) },
  { name: '(f) PostHog added', run: () => checkPageSource(plant(src.page, '</head>', '<script src="https://us-assets.i.posthog.com/static/array.js"></script>\n</head>')) },
  { name: '(f) growth.js added', run: () => checkPageSource(plant(src.page, '</body>', '<script src="/growth.js"></script>\n</body>')) },
  { name: '(f) a credential word ("Certified")', run: () => checkPageSource(plant(src.page, '<p class="awarded">Awarded to', '<p class="awarded">Certified: awarded to')) },
  { name: '(f) a seal / badge mark', run: () => checkPageSource(plant(src.page, '<h1 id="cert-title"></h1>', '<div class="seal" aria-hidden="true"></div><h1 id="cert-title"></h1>')) },
  { name: '(f) noindex removed', run: () => checkPageSource(plant(src.page, '<meta name="robots" content="noindex" />', '')) },
  { name: '(f) classify reads a gateway 404 as "not found" (behaviour)', run: () => checkPageBehaviour(plant(src.page, "if (status === 404 && d.valid === false) return 'notfound';", "if (status === 404) return 'notfound';")) },
  { name: '(f) issuedDate follows the viewer zone (behaviour)', run: () => checkPageBehaviour(plant(src.page, ", timeZone: 'America/New_York' }", ' }')) },
  { name: '(f) classify treats a revoked 200 as found (behaviour)', run: () => checkPageBehaviour(plant(src.page, "if (d.revoked === true) return 'removed';", '')) },
  { name: '(g) verify pinned verify_jwt = true', run: () => checkConfig(plant(src.config, '[functions.skill-certificate-verify]\nverify_jwt = false', '[functions.skill-certificate-verify]\nverify_jwt = true')) },
  { name: '(g) award entry removed', run: () => checkConfig(plant(src.config, '[functions.skill-certificate-award]\nverify_jwt = true\n', '')) },
  { name: '(h) table dropped from USER_SCOPED_TABLES', run: () => checkDeletion(plant(src.deleteAccount, "  'app_skill_certificates',\n", '')) },
  { name: '(i) _redirects rule removed', run: () => checkRoute(plant(src.redirects, /^\/skills\/\*.*$/m, ''), src.netlify) },
  { name: '(i) netlify.toml block removed', run: () => checkRoute(src.redirects, plant(src.netlify, 'from = "/skills/*"', 'from = "/skillz/*"')) },
];
const blind: string[] = [];
for (const pl of PLANTS) {
  let probs: string[];
  try { probs = pl.run(); } catch (e) { probs = []; blind.push(`${pl.name}: ${(e as Error).message}`); continue; }
  if (probs.length === 0) blind.push(`${pl.name}: the rule did not see it`);
}
rule(`planted mutations: all ${PLANTS.length} are caught`, blind);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
