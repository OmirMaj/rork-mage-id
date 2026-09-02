// validate-account-deletion.ts — deleting an account must not destroy data and
// then fail.
//
// WHY THIS EXISTS. supabase/functions/delete-account runs four steps as
// SEPARATE, NON-TRANSACTIONAL calls with no rollback:
//   1. collect the user's project ids
//   2. delete rows across 33 user-scoped tables
//   3. remove their Storage objects
//   4. auth.admin.deleteUser
//
// Two FKs to auth.users were declared ON DELETE NO ACTION
// (project_collaborators.user_id and .invited_by), and project_collaborators'
// only cascade path is via project_id — which fires solely for projects the
// user OWNS. So a Project Manager or Expeditor invited onto someone ELSE's job
// still had a referencing row when step 4 ran. Postgres raised 23503.
//
// By then steps 2 and 3 had already destroyed everything. The user got a 500,
// an unrecoverable half-deleted account they were still signed in to, and the
// message "Your data was removed but the login still exists." Apple exercises
// account deletion during review, so it was also a 5.1.1(v) rejection.
//
// The comment above USER_SCOPED_TABLES had asserted the opposite — that a
// missing table "just means orphan rows (no functional break)".
//
// THE RULE: every FK to auth.users whose delete action BLOCKS the parent
// delete — NO ACTION or RESTRICT, including an omitted clause, which defaults
// to NO ACTION — must be cleared by the function before it calls deleteUser.
// CASCADE, SET NULL and SET DEFAULT do not block and are left alone.
//
// This guard reads the regenerated supabase/schema.sql (authoritative as of
// 2026-08-31) so it works offline and in CI without database credentials.
//
// Run via: bun run test:account-deletion

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = readFileSync(join(ROOT, 'supabase', 'functions', 'delete-account', 'index.ts'), 'utf8');
const code = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const schema = readFileSync(join(ROOT, 'supabase', 'schema.sql'), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}

console.log('\naccount deletion (Apple 5.1.1(v) — must not half-delete):');

// ── 1. every auth.users FK is CASCADE, or is cleared by the function ────────
// Match `REFERENCES auth.users(id)` and capture whether ON DELETE CASCADE
// follows on the same statement.
const refs = [...schema.matchAll(
  /(?:CONSTRAINT\s+(\S+)\s+)?FOREIGN KEY \(([a-z_]+)\)\s+REFERENCES auth\.users\(id\)([^,;\n]*)/gi,
)];
ok('auth.users foreign keys were found in schema.sql', refs.length > 0,
  'either the schema regeneration changed shape or the FKs are gone — re-read this guard');

// ONLY NO ACTION and RESTRICT block the parent delete. CASCADE removes the
// child row; SET NULL and SET DEFAULT rewrite it. An earlier version of this
// guard flagged everything that was not CASCADE and accused
// crew_members_claimed_by_user_id_fkey, which is ON DELETE SET NULL and cannot
// block anything — a false accusation trains the reader to ignore the guard,
// so the rule matches what Postgres actually does.
//
// NO ACTION is also the DEFAULT when no ON DELETE clause is written, so an
// absent clause counts as blocking.
const blocking = refs
  .filter(m => {
    const action = m[3];
    if (/on delete (cascade|set null|set default)/i.test(action)) return false;
    return true; // explicit NO ACTION / RESTRICT, or no clause at all
  })
  .map(m => ({ constraint: m[1] ?? '(unnamed)', column: m[2] }));

// A non-cascading FK is acceptable ONLY if the function explicitly clears it.
const unhandled = blocking.filter(r =>
  !new RegExp(`['"]${r.column}['"]`).test(code) || !/project_collaborators/.test(code));

ok(
  'every BLOCKING FK to auth.users (NO ACTION / RESTRICT) is cleared first',
  unhandled.length === 0,
  unhandled.length === 0 ? undefined :
    `${unhandled.length} FK(s) would raise 23503 AFTER the user's data is already destroyed:\n` +
    unhandled.map(r => `        • ${r.constraint} (${r.column})`).join('\n') +
    `\n\n      Either add ON DELETE CASCADE in a migration, or delete the rows in\n` +
    `      supabase/functions/delete-account before step 4.`,
);

// ── 2. the clear happens BEFORE the auth delete ─────────────────────────────
// Ordering is the whole defect. A clear placed after deleteUser is useless.
const clearAt = code.indexOf('project_collaborators');
const authAt = code.indexOf('deleteUser');
ok('the collaborator clear runs BEFORE auth.admin.deleteUser',
  clearAt !== -1 && authAt !== -1 && clearAt < authAt,
  'the rows must be gone before the auth row is deleted, or the FK still blocks it');

// ── 3. both columns are handled, not just user_id ───────────────────────────
// invited_by is NOT NULL, so it cannot be nulled — the row has to go.
ok("both 'user_id' and 'invited_by' are cleared",
  /'user_id'\s*,\s*'invited_by'/.test(code) ||
  (/eq\(\s*['"]user_id['"]/.test(code) && /eq\(\s*['"]invited_by['"]/.test(code)),
  'invited_by is NOT NULL and also references auth.users — clearing only user_id ' +
  'leaves the second FK blocking the delete');

// ── 4. the backstop migration exists ────────────────────────────────────────
const mig = join(ROOT, 'supabase', 'migrations', '20260902120000_collaborator_fk_cascade.sql');
ok('the ON DELETE CASCADE backstop migration is present', existsSync(mig),
  'the function fix alone leaves the database able to reproduce the bug through ' +
  'any other delete path (admin console, support script, future refactor)');

// ── 5. account deletion is reachable in-app ─────────────────────────────────
// Apple requires an in-app path, not an email-support instruction. A working
// edge function nobody can reach still fails review.
const settings = ['app/(tabs)/settings/index.tsx', 'app/settings.tsx']
  .map(p => join(ROOT, p)).find(existsSync);
ok('a settings screen was located', !!settings,
  'cannot verify the in-app deletion entry point');
if (settings) {
  const s = readFileSync(settings, 'utf8');
  ok('settings links to account deletion',
    /delete-account|deleteAccount|Delete Account/i.test(s),
    'Apple 5.1.1(v) requires deletion to be initiated IN THE APP; an edge function ' +
    'with no entry point does not satisfy it');
}

if (fail > 0) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n${pass} passed, 0 failed\n`);
