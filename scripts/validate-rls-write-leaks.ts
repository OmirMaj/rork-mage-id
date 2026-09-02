// validate-rls-write-leaks.ts — checked on the way in, not on the way out.
//
// WHY THIS EXISTS. In Postgres RLS, USING is evaluated against the OLD row and
// WITH CHECK against the NEW one. A policy that puts the ownership predicate in
// USING but not in WITH CHECK therefore lets the caller REWRITE the row into
// somebody else's tenant: it passes on the way in because they genuinely own
// it, and passes on the way out because nothing re-checks who owns it any more.
//
// Two live instances were found on 2026-09-02, both confirmed against
// production:
//
//   sub_submitted_invoices "gc updates sub invoices for own portals"
//     USING      spl.user_id = auth.uid()     (correct)
//     WITH CHECK status = ANY (...)           (ownership gone)
//     -> sub_portal_id, project_id, commitment_id and amount could all be
//        rewritten, pushing a money row into another tenant. This UPDATE is the
//        table's ONLY write policy, so it was the whole write surface.
//
//   portal_budget_proposals "gc can update own proposals"
//     Identical mistake. project_id could be pointed at any other tenant's
//     project, and the one guard on that column
//     (trg_resolve_portal_project_id) is BEFORE INSERT only.
//
// A third class of the same bug: an ownership column that no policy CAN
// protect. projects_update allowed `auth.uid() = user_id OR
// is_project_collaborator(id,'editor')` in both clauses, so an invited editor
// set user_id to their own uid and satisfied the owner disjunct of WITH CHECK
// with the very row they were writing. The original owner then lost SELECT on
// their own project. That one needs a BEFORE UPDATE trigger, not a policy.
//
// THE RULE: any UPDATE/ALL policy whose USING references auth.uid() must also
// reference it in WITH CHECK; and the ownership columns that a policy cannot
// defend must be frozen by a trigger.
//
// schema.sql mirrors PRODUCTION, so the two known leaks still appear in it
// until the closing migration is deployed. Failing on those would leave the
// build red for days, and a permanently-red guard is one somebody disables. So
// the bar is "no UNADDRESSED leak": a leak the pending migration provably
// re-creates WITH an ownership predicate is reported as deploy-pending rather
// than failing. A brand-new leak that nothing fixes still fails the build.
//
// Reads the regenerated supabase/schema.sql (authoritative as of 2026-08-31),
// so it runs offline and in CI with no database credentials.
//
// Run via: bun run test:rls-write-leaks

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = readFileSync(join(ROOT, 'supabase', 'schema.sql'), 'utf8');
const MIG = join(ROOT, 'supabase', 'migrations', '20260902130000_close_rls_write_leaks.sql');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}

console.log('\nRLS write leaks (USING guards the old row, WITH CHECK the new one):');

// ── 1. no policy checks ownership in USING but not WITH CHECK ───────────────
// CREATE POLICY ... USING (...) WITH CHECK (...) — captured across newlines.
const policies = [...schema.matchAll(
  /CREATE POLICY\s+("?[^"\n]+?"?)\s+ON\s+(\S+)([\s\S]*?);\s*(?=\nCREATE|\nALTER|\n--|\n\n|$)/g,
)];
ok('policies were parsed from schema.sql', policies.length > 20,
  `only found ${policies.length} — the schema dump's shape changed; re-read this guard`);

const leaks: string[] = [];
for (const [, name, table, body] of policies) {
  if (!/FOR (UPDATE|ALL)/i.test(body)) continue;
  const using = /USING\s*\(([\s\S]*?)\)\s*(?:WITH CHECK|$)/i.exec(body)?.[1] ?? '';
  const check = /WITH CHECK\s*\(([\s\S]*)\)/i.exec(body)?.[1] ?? '';
  if (!check) continue;                       // no WITH CHECK at all: USING governs
  const owns = (t: string) => /auth\.uid\(\)|auth\.jwt\(\)/.test(t);
  if (owns(using) && !owns(check)) {
    leaks.push(`${table} :: ${name.replace(/"/g, '')}`);
  }
}

// schema.sql mirrors PRODUCTION, and the closing migration is not deployed yet,
// so both known leaks still appear here. A guard that stays red until a deploy
// lands is a guard someone disables — so the bar is "no UNADDRESSED leak".
// Anything schema.sql still shows must be provably re-created with an ownership
// predicate by the pending migration, and is reported as deploy-pending.
const migSrc = existsSync(MIG) ? readFileSync(MIG, 'utf8') : '';
function addressedByMigration(entry: string): boolean {
  const policy = entry.split('::')[1]?.trim() ?? '';
  if (!policy) return false;
  // Find this policy's CREATE in the migration and require auth.uid() inside
  // its WITH CHECK — i.e. the fix, not merely a mention of the name.
  const re = new RegExp(
    `create policy\\s+"${policy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?with check\\s*\\(([\\s\\S]*?)\\);`,
    'i',
  );
  const m = re.exec(migSrc);
  return !!m && /auth\.uid\(\)/.test(m[1]);
}

const unaddressed = leaks.filter(l => !addressedByMigration(l));
const pending = leaks.filter(addressedByMigration);

ok(
  'no UNADDRESSED policy guards the old row but not the new one',
  unaddressed.length === 0,
  unaddressed.length === 0 ? undefined :
    `${unaddressed.length} policy(ies) let the row be rewritten into another tenant,\n` +
    `      and NOTHING in supabase/migrations fixes them:\n` +
    unaddressed.map(l => `        • ${l}`).join('\n') +
    `\n\n      AND the ownership predicate into WITH CHECK.`,
);

if (pending.length > 0) {
  console.log(`  · ${pending.length} known leak(s) still live in PRODUCTION — fixed by an`);
  console.log(`    UNAPPLIED migration (${MIG.split('/').pop()}). Deploy it:`);
  for (const l of pending) console.log(`      ${l}`);
}

// ── 2. the fixing migration is present ──────────────────────────────────────
ok('the leak-closing migration exists', existsSync(MIG),
  'schema.sql reflects production, which will only match once this is applied');

if (existsSync(MIG)) {
  const mig = readFileSync(MIG, 'utf8');

  // ── 3. ownership columns a policy cannot defend are frozen ───────────────
  ok('projects.user_id is frozen by a BEFORE UPDATE trigger',
    /projects_freeze_ownership/.test(mig) && /new\.user_id := old\.user_id/.test(mig),
    'projects_update cannot be fixed in the policy — the owner disjunct is ' +
    'satisfiable by the row the attacker is writing, so an invited editor can ' +
    'reassign user_id to themselves and take the project');

  ok('sub_submitted_invoices identity + amount columns are frozen',
    /sub_submitted_invoices_freeze/.test(mig) && /new\.amount\s*:= old\.amount/.test(mig));

  ok('portal_budget_proposals.project_id is frozen',
    /portal_budget_proposals_freeze/.test(mig));

  // ── 4. the anon-executable SECURITY DEFINER function is locked ───────────
  ok('grant_rfp_post_credit is revoked from anon/authenticated',
    /revoke all on function public\.grant_rfp_post_credit[\s\S]{0,120}?anon, authenticated/.test(mig),
    'production had has_function_privilege(anon, EXECUTE) = true on a ' +
    'SECURITY DEFINER function that credits whatever p_user it is handed');

  ok('...and refuses non-service_role callers in its own body',
    /auth\.role\(\)[\s\S]{0,120}?service_role[\s\S]{0,160}?raise exception/.test(mig),
    'the REVOKE in the original migration did NOT survive — an ACL can drift ' +
    'back silently, a RAISE cannot, so both layers are required');

  // The body must be the real one. Rewriting it from a description silently
  // breaks callers: an earlier draft of this migration returned void instead of
  // boolean and used column names that do not exist.
  ok('the rewritten function keeps its real signature and columns',
    /returns boolean/.test(mig)
      && /session_id/.test(mig)
      && /lifetime_purchased/.test(mig)
      && /if not found then/.test(mig),
    'grant_rfp_post_credit returns boolean, conflicts on session_id, and uses ' +
    'credits/lifetime_purchased — a rewrite that drops the `if not found` early ' +
    'exit also destroys its idempotency against a replayed session id');
}

if (fail > 0) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n${pass} passed, 0 failed\n`);
