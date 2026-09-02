// validate-account-deletion-storage.ts — deleting an account must actually
// remove the user's FILES and their PUBLIC LISTINGS, not just their rows.
//
// WHY THIS EXISTS. supabase/functions/delete-account shipped with a storage
// pass that touched one bucket out of eleven and a comment asserting the
// leftovers "cost cents per month but don't affect correctness". Both halves
// were wrong, in three separate ways:
//
//   1. BUCKETS IT NEVER OPENED. profiles/<uid>/avatar_*.jpg (a PUBLIC bucket),
//      worker-ids (government ID scans), secure-contracts, branding,
//      documents, project-photos, and rfp-attachments — also PUBLIC, and the
//      home the photos are of belongs to the person asking to be forgotten.
//
//   2. A NON-RECURSIVE WALK. Storage list() returns only immediate children,
//      with sub-folders as entries whose id is null. The function listed
//      `<projectId>/` in project-documents and handed the names to remove(),
//      but every object there is `<projectId>/daily-reports/<uuid>.pdf`, so it
//      called remove(['<projectId>/daily-reports']) — which matches nothing
//      and which Storage answers 200. project-photos is two levels deep too.
//      Every filed daily report and every jobsite photo survived deletion with
//      no error logged anywhere.
//
//   3. PUBLIC-DIRECTORY ROWS. public_bids, companies, worker_profiles and
//      job_listings hold their FK to auth.users as ON DELETE SET NULL. The
//      auth delete NULLed user_id instead of removing the row, and every
//      DELETE policy on those tables is `USING (auth.uid() = user_id)` — which
//      can never match NULL. A deleted homeowner's RFP, carrying their street
//      address, GPS coordinates, email and interior photos, stayed live and
//      browsable and could not be removed by anyone through the API.
//
// THE RULES this guard enforces:
//   A. every Storage bucket the app writes to is cleaned by delete-account
//   B. the walk recurses, so a bucket with nested paths is not a silent no-op
//   C. every FK to auth.users that is ON DELETE SET NULL is handled explicitly
//   D. storage keys are collected BEFORE the rows that hold them are deleted
//
// Reads supabase/schema.sql (regenerated from production 2026-08-31) so it
// works offline and in CI without database credentials.
//
// Run via: bun run test:account-deletion-storage

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FN_PATH = join(ROOT, 'supabase', 'functions', 'delete-account', 'index.ts');
const fnSource = readFileSync(FN_PATH, 'utf8');
// Strip block comments and whole-line // comments so a bucket name mentioned
// only in prose cannot satisfy a check.
const code = fnSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const schema = readFileSync(join(ROOT, 'supabase', 'schema.sql'), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}

console.log('\naccount deletion, storage + public listings (GDPR/CCPA + Apple 5.1.1(v)):');

// ── A. every bucket the app writes to is cleaned ────────────────────────────
// The eleven buckets in production storage.buckets as of 2026-09-02. This list
// is deliberately hardcoded: a guard that discovered buckets from the source it
// is checking could never notice one that the source forgot.
const PRODUCTION_BUCKETS = [
  'branding', 'documents', 'pdf-uploads', 'plan-sheets', 'profiles',
  'project-documents', 'project-photos', 'rfp-attachments',
  'secure-contracts', 'sub-documents', 'worker-ids',
];

for (const bucket of PRODUCTION_BUCKETS) {
  ok(`delete-account cleans the '${bucket}' bucket`,
    new RegExp(`['"]${bucket}['"]`).test(code),
    `Nothing in delete-account names '${bucket}', so every object in it outlives the ` +
    `account. Add it to USER_KEYED_BUCKETS / PROJECT_KEYED_BUCKETS / ` +
    `SUBCONTRACTOR_KEYED_BUCKETS depending on what its first path segment is.`);
}

// The other direction: a NEW bucket appearing in app source that this guard has
// never heard of. Collect bucket literals from `.storage ... .from('name')` call
// sites plus `const *_BUCKET = 'name'` declarations.
function walkSources(dir: string, out: string[]): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let isDir = false;
    try { isDir = statSync(full).isDirectory(); } catch { continue; }
    if (isDir) walkSources(full, out);
    else if (['.ts', '.tsx'].includes(extname(entry))) out.push(full);
  }
  return out;
}

const sourceFiles: string[] = [];
for (const d of ['app', 'utils', 'components', 'hooks', 'lib', 'contexts', 'supabase/functions']) {
  walkSources(join(ROOT, d), sourceFiles);
}

const seenBuckets = new Set<string>();
for (const file of sourceFiles) {
  const src = readFileSync(file, 'utf8');
  // `.storage` followed within a short window by `.from('<bucket>')`.
  for (const m of src.matchAll(/\.storage[\s\S]{0,80}?\.from\(\s*['"]([a-z][a-z0-9-]*)['"]/g)) {
    seenBuckets.add(m[1]);
  }
  // `const PHOTO_BUCKET = 'project-photos';` and friends.
  for (const m of src.matchAll(/\b[A-Z_]*BUCKET\b\s*(?::\s*string)?\s*=\s*['"]([a-z][a-z0-9-]*)['"]/g)) {
    seenBuckets.add(m[1]);
  }
}

const unknown = [...seenBuckets].filter(b => !PRODUCTION_BUCKETS.includes(b)).sort();
ok('no bucket is written by the app that this guard has never heard of',
  unknown.length === 0,
  unknown.length === 0 ? undefined :
    `found ${unknown.map(b => `'${b}'`).join(', ')} in app source. A new bucket needs TWO ` +
    `edits or its contents survive account deletion: add it to PRODUCTION_BUCKETS here, ` +
    `and add it to the matching *_KEYED_BUCKETS list in delete-account/index.ts.`);

ok('at least one bucket was actually discovered in app source', seenBuckets.size > 0,
  'the scan matched nothing — the storage call shape changed and this guard has gone blind');

// ── B. the walk recurses ────────────────────────────────────────────────────
// project-documents is `<projectId>/daily-reports/<file>` and project-photos is
// `<uid>/<projectId>/<file>`. A single-level list() returns the FOLDER name,
// and remove('<projectId>/daily-reports') deletes nothing and reports success.
const listCalls = [...code.matchAll(/\.list\(/g)].map(m => m.index ?? -1);
ok('delete-account still lists storage objects', listCalls.length > 0,
  'no .list( call — the storage pass was removed or renamed');

/**
 * End index of the brace-delimited body that starts at or after `from`.
 * Quote-aware, because template literals in these helpers contain `${...}`.
 * Returns -1 if the braces never balance.
 */
function bodyEnd(src: string, from: number): number {
  const open = src.indexOf('{', from);
  if (open === -1) return -1;
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

let nonRecursive = 0;
for (const at of listCalls) {
  // Find the innermost `const NAME = async` declaration before this call.
  const before = code.slice(0, at);
  const decls = [...before.matchAll(/const\s+(\w+)\s*=\s*async\b/g)];
  const enclosing = decls.length > 0 ? decls[decls.length - 1] : null;
  if (!enclosing) { nonRecursive++; continue; }
  const name = enclosing[1];
  const declAt = enclosing.index ?? 0;
  const end = bodyEnd(code, declAt);
  if (end === -1) { nonRecursive++; continue; }
  // The self-call must be INSIDE the helper's own body. Searching the whole
  // rest of the file instead would match the helper's CALL SITES, which is the
  // false pass this check originally shipped with: the old non-recursive
  // removePrefix() was invoked three times below its definition and the guard
  // read that as recursion.
  const body = code.slice(declAt + name.length, end);
  if (!new RegExp(`\\b${name}\\s*\\(`).test(body)) nonRecursive++;
}
ok('every storage list() sits in a helper that recurses into sub-folders',
  nonRecursive === 0,
  `${nonRecursive} list() call(s) never recurse. Storage list() returns only immediate ` +
  `children; sub-folders come back as entries with a null id. Passing those names to ` +
  `remove() is a 200-with-nothing-deleted, which is how every daily-report PDF and ` +
  `jobsite photo survived account deletion in the first place.`);

ok('folder entries are detected and recursed rather than removed',
  /id\s*==\s*null|id\s*===\s*null|isFolder/.test(code),
  'nothing distinguishes a folder entry from a file entry, so folders get handed to remove()');

// ── C. every ON DELETE SET NULL FK to auth.users is handled ─────────────────
// SET NULL does not BLOCK the auth delete (that is validate-account-deletion's
// job) — it does something worse for privacy: it orphans the row into a state
// where `USING (auth.uid() = user_id)` can never match, so no one can delete it.
const setNullRefs = [...schema.matchAll(
  /ALTER TABLE ONLY public\.(\w+)\s+ADD CONSTRAINT\s+(\S+)\s+FOREIGN KEY \((\w+)\)\s+REFERENCES auth\.users\(id\) ON DELETE SET NULL/gi,
)].map(m => ({ table: m[1], constraint: m[2], column: m[3] }));

ok('ON DELETE SET NULL foreign keys to auth.users were found in schema.sql',
  setNullRefs.length > 0,
  'either the schema regeneration changed shape or the FKs are gone — re-read this guard');

const tablesBlock = code.match(/USER_SCOPED_TABLES\s*=\s*\[([\s\S]*?)\]/);
const userScopedTables = tablesBlock
  ? [...tablesBlock[1].matchAll(/['"]([a-z_]+)['"]/g)].map(m => m[1])
  : [];
ok('USER_SCOPED_TABLES was parsed out of delete-account', userScopedTables.length > 10,
  'the table list changed shape — this guard can no longer read it');

const unhandledSetNull = setNullRefs.filter(r => {
  if (r.column === 'user_id') return !userScopedTables.includes(r.table);
  // A non-user_id owner column (crew_members.claimed_by_user_id) cannot be
  // swept by the user_id loop, so the function has to name the column itself.
  return !new RegExp(`['"]${r.column}['"]`).test(code);
});

ok('every ON DELETE SET NULL FK to auth.users is cleared or released explicitly',
  unhandledSetNull.length === 0,
  unhandledSetNull.length === 0 ? undefined :
    `${unhandledSetNull.length} table(s) keep a row that nobody can ever delete after the ` +
    `account is gone:\n` +
    unhandledSetNull.map(r => `        • ${r.table}.${r.column} (${r.constraint})`).join('\n') +
    `\n\n      Add the table to USER_SCOPED_TABLES if the row belongs to the departing user, ` +
    `\n      or clear its owner column explicitly if the row belongs to someone else.`);

// ── D. keys are collected before the rows holding them are deleted ─────────
// plan_sheets.image_uri and public_bids.photo_urls are the ONLY record of which
// objects are ours (plan-sheets renders made before a project is picked land in
// a shared `tmp/` folder that no per-user prefix walk can reach). Read them
// after the DELETE and the objects are orphaned permanently.
const collectAt = code.indexOf('explicitObjects');
const deleteAt = code.search(/\.delete\(\)\s*\.eq\(\s*['"]user_id['"]/);
ok('storage keys are collected BEFORE the row delete pass',
  collectAt !== -1 && deleteAt !== -1 && collectAt < deleteAt,
  'the URLs live in the rows being deleted; once the rows are gone the objects are ' +
  'unreachable and stay in the bucket forever');

if (fail > 0) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n${pass} passed, 0 failed\n`);
