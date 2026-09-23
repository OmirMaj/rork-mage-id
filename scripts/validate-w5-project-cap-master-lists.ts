// validate-w5-project-cap-master-lists.ts — wave 5, lane project-cap, #1.
//
// The master-account override lives in FIVE places today:
//   - OWNER_EMAILS in utils/owner.ts (the app shows Business),
//   - MASTER_EMAILS in supabase/functions/_shared/auth.ts (requireTier),
//   - public.is_master_account(uuid) in the newest supabase/migrations/*.sql
//     that defines it (the free-plan project-cap trigger),
//   - private MASTER_EMAILS sets in edge functions that can't import
//     _shared/auth.ts's lookup: supabase/functions/mcp/index.ts and
//     supabase/functions/project-memory-embed/planScopeIo.ts.
// The trigger used to miss the override, so the founder's app said "Business,
// unlimited" while the database refused every new job after his first. This
// check parses every list (lower-cased, trimmed) and fails on any drift. It
// also finds every `MASTER_EMAILS = new Set` under supabase/functions and
// every source file that spells a master email, so a sixth copy can't drift
// unseen; and it pins that the two sync comments name the copies.
//
// Run: bun run scripts/validate-w5-project-cap-master-lists.ts

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

const norm = (xs: string[]) => [...new Set(xs.map(x => x.trim().toLowerCase()))].sort();
/** Every single-quoted string literal in `src`, comments stripped first. */
function quoted(src: string): string[] {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/--.*$/gm, '');
  return [...noComments.matchAll(/'([^'\n]*)'/g)].map(m => m[1]);
}
/** Every '…' or "…" string literal in a TS snippet, comments stripped first. */
function tsStrings(src: string): string[] {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return [...noComments.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map(m => m[1] ?? m[2]);
}
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(rel);
  }
  return out;
}

// ── 1. OWNER_EMAILS (utils/owner.ts) ────────────────────────────────────────
const ownerSrc = read('utils/owner.ts');
const ownerDecl = ownerSrc.match(/const OWNER_EMAILS[^=]*=\s*\[([\s\S]*?)\];/);
const ownerList = norm(ownerDecl ? quoted(ownerDecl[1]) : []);
ok('OWNER_EMAILS parsed from utils/owner.ts', ownerList.length > 0, ownerDecl ? '' : 'declaration not found');

// ── 2. MASTER_EMAILS (_shared/auth.ts) ──────────────────────────────────────
const authSrc = read('supabase/functions/_shared/auth.ts');
const masterDecl = authSrc.match(/const MASTER_EMAILS\s*=\s*new Set<string>\(\[([\s\S]*?)\]\);/);
const masterList = norm(masterDecl ? quoted(masterDecl[1]) : []);
ok('MASTER_EMAILS parsed from _shared/auth.ts', masterList.length > 0, masterDecl ? '' : 'declaration not found');

// ── 2b. every other MASTER_EMAILS set under supabase/functions ──────────────
// Found by search, not by a fixed list: a new private copy is checked the
// moment it is written. The two known ones must still be found (a rename of
// the constant would otherwise hide them).
const SET_DECL = /const MASTER_EMAILS\s*=\s*new Set<string>\(\[([\s\S]*?)\]\);/;
const fnFiles = walk('supabase/functions');
const setCopies = fnFiles
  .filter(f => f !== 'supabase/functions/_shared/auth.ts')
  .map(f => ({ f, m: read(f).match(SET_DECL) }))
  .filter((x): x is { f: string; m: RegExpMatchArray } => !!x.m)
  .map(({ f, m }) => ({ f, list: norm(tsStrings(m[1])) }));
for (const known of ['supabase/functions/mcp/index.ts', 'supabase/functions/project-memory-embed/planScopeIo.ts']) {
  ok(`private MASTER_EMAILS copy found in ${known}`, setCopies.some(c => c.f === known));
}

// ── 3. public.is_master_account — the NEWEST migration that defines it ──────
const MIG_DIR = 'supabase/migrations';
const defining = readdirSync(join(ROOT, MIG_DIR))
  .filter(f => f.endsWith('.sql'))
  .sort()
  .filter(f => /create\s+(or\s+replace\s+)?function\s+public\.is_master_account\s*\(/i.test(read(`${MIG_DIR}/${f}`)));
const newest = defining[defining.length - 1];
ok('a migration defines public.is_master_account', !!newest);
let sqlList: string[] = [];
if (newest) {
  const sql = read(`${MIG_DIR}/${newest}`);
  const start = sql.search(/create\s+(or\s+replace\s+)?function\s+public\.is_master_account\s*\(/i);
  const body = sql.slice(start);
  const dollar = body.match(/as\s+(\$\w*\$)([\s\S]*?)\1/i);
  const inList = dollar?.[2].match(/\bin\s*\(([^)]*)\)/i);
  sqlList = norm(inList ? quoted(inList[1]) : []);
  ok(`is_master_account list parsed from ${newest}`, sqlList.length > 0, inList ? '' : 'IN (…) list not found in the function body');
  // The comparison must be case/space-insensitive, as the TS sides are.
  ok('is_master_account compares lower(btrim(email))', /lower\s*\(\s*btrim\s*\(/i.test(dollar?.[2] ?? ''));
}

// ── The three lists agree ───────────────────────────────────────────────────
const show = (xs: string[]) => JSON.stringify(xs);
ok('OWNER_EMAILS == MASTER_EMAILS', show(ownerList) === show(masterList), `owner ${show(ownerList)} vs master ${show(masterList)}`);
ok('MASTER_EMAILS == is_master_account', show(masterList) === show(sqlList), `master ${show(masterList)} vs sql ${show(sqlList)}`);
for (const c of setCopies) {
  ok(`MASTER_EMAILS == ${c.f}`, show(masterList) === show(c.list), `master ${show(masterList)} vs ${show(c.list)}`);
}

// ── No unchecked copy: every source file that spells the WHOLE master list is
// one of the copies parsed above (a copy under another name would drift
// unseen). The whole list, not any one address: support@mageid.app is also the
// app's ordinary support contact and appears in help and paywall copy. ──
const checked = new Set<string>(['utils/owner.ts', 'supabase/functions/_shared/auth.ts', ...setCopies.map(c => c.f)]);
const SOURCE_DIRS = ['app', 'components', 'contexts', 'hooks', 'lib', 'utils', 'constants', 'backend', 'supabase/functions'];
const stray: string[] = [];
for (const d of SOURCE_DIRS) {
  let files: string[] = [];
  try { files = walk(d); } catch { continue; }
  for (const f of files) {
    if (checked.has(f)) continue;
    const src = read(f).toLowerCase();
    if (masterList.length > 0 && masterList.every(e => src.includes(e))) stray.push(f);
  }
}
ok('no source file carries the master list outside the checked copies', stray.length === 0, `unchecked: ${stray.join(', ')}`);

// ── The sync comments name all three copies ─────────────────────────────────
ok('utils/owner.ts comment names MASTER_EMAILS and is_master_account',
  /MASTER_EMAILS/.test(ownerSrc) && /is_master_account/.test(ownerSrc) && /20260922100000_master_account_project_cap\.sql/.test(ownerSrc));
ok('_shared/auth.ts comment names OWNER_EMAILS and is_master_account',
  /OWNER_EMAILS/.test(authSrc) && /is_master_account/.test(authSrc) && /20260922100000_master_account_project_cap\.sql/.test(authSrc));

// ── The trigger still consults the override ─────────────────────────────────
const capDefs = readdirSync(join(ROOT, MIG_DIR)).filter(f => f.endsWith('.sql')).sort()
  .filter(f => /create\s+(or\s+replace\s+)?function\s+public\.enforce_free_tier_project_cap\s*\(/i.test(read(`${MIG_DIR}/${f}`)));
const capNewest = capDefs[capDefs.length - 1];
ok(`newest enforce_free_tier_project_cap (${capNewest}) keeps the is_master_account early return`,
  !!capNewest && /if\s+public\.is_master_account\s*\([^)]*\)\s+then\s+return\s+NEW;/i.test(read(`${MIG_DIR}/${capNewest}`)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
