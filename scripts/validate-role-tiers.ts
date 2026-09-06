// validate-role-tiers.ts — the roles the app offers must be roles the database
// accepts, and every access tier a policy asks for must be a tier the access
// helpers actually understand.
//
// WHY THIS EXISTS. On 2026-09-03 the final-push audit (DB-F2) found that the
// `field` collaborator role did not exist in production even though the deploy
// record said its migration "IS applied":
//
//   • project_collaborators_role_check was still owner|editor|viewer, so every
//     "Field" invite the client offers was rejected with 23514;
//   • can_access_project() had no `when 'field'` branch, so the six policies
//     shipped on 09-03 that pass 'field' as min_role (deliveries,
//     access_reservations, building_access_rules insert/update) resolved
//     through the `else true` arm — i.e. ANY accepted collaborator, including a
//     read-only Viewer, could insert deliveries and reservations.
//
// Nothing caught it because the two halves live in different places: the
// role literals in TypeScript, the CHECK constraint and the CASE branches in
// SQL. This guard reads all of them from the regenerated supabase/schema.sql
// (production truth) and the client source, and fails on either drift.
//
// THE RULES:
//   A. every role the client can hand out (utils/projectRole.ts,
//      utils/roleBlinding.ts, components/collaborators/CollaboratorsManager.tsx,
//      supabase/functions/project-invite) is in the database CHECK;
//   B. every min_role literal any policy passes to can_access_project() or
//      is_project_collaborator() has a `when '<role>'` branch in BOTH helpers
//      ('viewer' is the `else` arm and needs none);
//   C. the text overload of can_access_project delegates to the uuid one, so
//      the two signatures can never disagree about tiers.
//
// DEPLOY-PENDING, NOT PERMANENTLY RED. schema.sql mirrors production, and the
// migration that adds a role can sit unapplied for days. A guard that is red
// the whole time is one somebody disables, so EXPECTED_PENDING lists the
// migration file that is known to be pending and what it adds. While that file
// is present under supabase/migrations/ AND its effects are entirely absent
// from schema.sql, the corresponding failures are reported as deploy-pending
// and the guard passes. The moment the migration is applied but incomplete —
// the CHECK accepts the role but a helper lacks the branch, or vice versa —
// the guard FAILS, because that is exactly the DB-F2 state. Once schema.sql
// carries everything, the entry is reported as retirable.
//
// Enumerates literals; does not list them (START-HERE rule 2).
//
// Run via: bun run test:role-tiers

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const schema = read('supabase/schema.sql');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}
function note(msg: string) { console.log('  ·', msg); }

/**
 * Migrations known to be written but not yet applied to production, keyed by
 * filename, with the roles they add to the CHECK and the tiers they add to the
 * helpers. An entry only excuses a failure while (1) the file exists at the
 * top level of supabase/migrations, (2) the file really contains the change,
 * and (3) NONE of it has reached schema.sql yet.
 */
const EXPECTED_PENDING: Record<string, { roles: string[]; tiers: string[] }> = {
  '20260826130000_field_role.sql': { roles: ['field'], tiers: ['field'] },
};

console.log('\nrole tiers (client roles ⊆ DB CHECK; policy tiers ⊆ helper branches):');

// ── A. the database side ────────────────────────────────────────────────────
const checkMatch = schema.match(
  /ADD CONSTRAINT project_collaborators_role_check CHECK \(\(role = ANY \(ARRAY\[([^\]]+)\]\)\)\)/,
);
const dbRoles = new Set(checkMatch ? [...checkMatch[1].matchAll(/'(\w+)'::text/g)].map(m => m[1]) : []);
ok('project_collaborators_role_check was parsed from schema.sql', dbRoles.size > 0,
  'the constraint is gone or the dump changed shape — re-read this guard');

function functionText(name: string, firstArg: string): string {
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\(${firstArg}[\\s\\S]*?\\$function\\$\\s*;`,
  );
  return schema.match(re)?.[0] ?? '';
}
const capUuid = functionText('can_access_project', 'pid uuid');
const capText = functionText('can_access_project', 'pid text');
const ipc = functionText('is_project_collaborator', 'pid uuid');
ok('can_access_project(uuid) body was found', capUuid.length > 0);
ok('can_access_project(text) body was found', capText.length > 0);
ok('is_project_collaborator(uuid) body was found', ipc.length > 0);

const branches = (body: string) => new Set([...body.matchAll(/\bwhen\s+'(\w+)'/g)].map(m => m[1]));
const capBranches = branches(capUuid);
const ipcBranches = branches(ipc);

// C. the text overload must delegate, not re-implement.
ok('can_access_project(text) delegates to the uuid overload (tiers cannot diverge)',
  /return\s+public\.can_access_project\(\s*u\s*,\s*min_role\s*\)/.test(capText),
  'the text overload (time_entries / field_tickets policies) carries its own CASE — it will fall behind the uuid one');

// ── B. the client side ──────────────────────────────────────────────────────
const offered = new Map<string, Set<string>>();
const offer = (role: string, source: string) => {
  if (!offered.has(role)) offered.set(role, new Set());
  offered.get(role)!.add(source);
};

{ // utils/projectRole.ts — the ProjectRole union
  const src = read('utils/projectRole.ts');
  const m = src.match(/export type ProjectRole\s*=\s*([^;]+);/);
  for (const r of m ? [...m[1].matchAll(/'(\w+)'/g)].map(x => x[1]) : []) offer(r, 'utils/projectRole.ts');
}
{ // utils/roleBlinding.ts — ROLE_LABELS keys (what the picker renders)
  const src = read('utils/roleBlinding.ts');
  const m = src.match(/export const ROLE_LABELS[^{]*\{([\s\S]*?)\n\}/);
  for (const k of m ? [...m[1].matchAll(/^\s*(\w+):/gm)].map(x => x[1]) : []) offer(k, 'utils/roleBlinding.ts');
}
{ // components/collaborators/CollaboratorsManager.tsx — the invite picker
  const src = read('components/collaborators/CollaboratorsManager.tsx');
  const state = src.match(/useState<((?:'\w+'\s*\|\s*)+'\w+')>/);
  for (const r of state ? [...state[1].matchAll(/'(\w+)'/g)].map(x => x[1]) : []) offer(r, 'CollaboratorsManager.tsx (state)');
  const picker = src.match(/\(\[((?:'\w+',?\s*)+)\] as const\)/);
  for (const r of picker ? [...picker[1].matchAll(/'(\w+)'/g)].map(x => x[1]) : []) offer(r, 'CollaboratorsManager.tsx (picker)');
}
{ // supabase/functions/project-invite — what the server accepts on invite
  const p = join(ROOT, 'supabase', 'functions', 'project-invite', 'index.ts');
  if (existsSync(p)) {
    const src = readFileSync(p, 'utf8');
    const m = src.match(/const ROLES\s*=\s*new Set\(\[([^\]]+)\]\)/);
    for (const r of m ? [...m[1].matchAll(/["'](\w+)["']/g)].map(x => x[1]) : []) offer(r, 'project-invite/index.ts');
  }
}
ok('client role literals were enumerated (not a vacuous pass)', offered.size >= 3,
  `only ${offered.size} role(s) found across the four client sources — a regex has gone stale`);

// ── policies: which tiers are actually requested ───────────────────────────
const sec5Start = schema.indexOf('SECTION 5');
const sec6Start = schema.indexOf('SECTION 6');
const policies = sec5Start !== -1 && sec6Start !== -1 ? schema.slice(sec5Start, sec6Start) : '';
ok('policy section was located in schema.sql', policies.length > 0);

const tiersUsed = new Map<string, number>();
for (const m of policies.matchAll(/\b(can_access_project|is_project_collaborator)\(([^()]*)\)/g)) {
  const args = m[2].split(',').map(s => s.trim());
  const tier = args[1]?.match(/^'(\w+)'::text$/)?.[1] ?? 'viewer';
  tiersUsed.set(tier, (tiersUsed.get(tier) ?? 0) + 1);
}
ok('policy tier literals were enumerated', tiersUsed.size > 0, 'no policy calls the access helpers — the dump changed shape');

// ── pending-migration bookkeeping ───────────────────────────────────────────
interface Pending { file: string; roles: Set<string>; tiers: Set<string> }
const pending: Pending[] = [];
for (const [file, spec] of Object.entries(EXPECTED_PENDING)) {
  const p = join(ROOT, 'supabase', 'migrations', file);
  if (!existsSync(p)) {
    ok(`EXPECTED_PENDING entry ${file} refers to a file that exists`, false,
      'the file was moved or renamed — update or drop the entry; do not keep excusing a failure nothing will fix');
    continue;
  }
  // Strip `--` comments first: the 08-26 header quotes the OLD constraint
  // (`CHECK (role in ('owner','editor','viewer'))`) while explaining the fix.
  const txt = readFileSync(p, 'utf8').replace(/--.*$/gm, '');
  const checkLine = txt.match(/check\s*\(\s*role\s+in\s*\(([^)]+)\)\s*\)/i);
  const fileRoles = new Set(checkLine ? [...checkLine[1].matchAll(/'(\w+)'/g)].map(x => x[1]) : []);
  const fileTiers = new Set([...txt.matchAll(/\bwhen\s+'(\w+)'/g)].map(x => x[1]));
  const lying = [
    ...spec.roles.filter(r => !fileRoles.has(r)).map(r => `role '${r}' is not in the file's CHECK`),
    ...spec.tiers.filter(t => !fileTiers.has(t)).map(t => `no when '${t}' branch in the file`),
  ];
  ok(`EXPECTED_PENDING entry ${file} promises only what the file contains`, lying.length === 0, lying.join('; '));
  if (lying.length > 0) continue;

  const applied = spec.roles.every(r => dbRoles.has(r))
    && spec.tiers.every(t => capBranches.has(t) && ipcBranches.has(t));
  if (applied) {
    note(`${file} is fully reflected in schema.sql — retire its EXPECTED_PENDING entry`);
    continue;
  }
  pending.push({ file, roles: new Set(spec.roles), tiers: new Set(spec.tiers) });
}

/** A missing ROLE is excused only while nothing of its migration has landed. */
function pendingForRole(role: string): Pending | undefined {
  return pending.find(p => p.roles.has(role) && !dbRoles.has(role)
    && [...p.tiers].every(t => !capBranches.has(t) && !ipcBranches.has(t)));
}
/** A missing TIER is excused only while the CHECK does not accept it either. */
function pendingForTier(tier: string): Pending | undefined {
  return pending.find(p => p.tiers.has(tier) && !dbRoles.has(tier));
}

// ── A. offered roles ⊆ DB CHECK ─────────────────────────────────────────────
const missingRoles = [...offered.keys()].filter(r => !dbRoles.has(r));
const unexcusedRoles: string[] = [];
for (const r of missingRoles) {
  const p = pendingForRole(r);
  if (p) note(`role '${r}' (offered by ${[...offered.get(r)!].join(', ')}) is deploy-pending: ${p.file}`);
  else unexcusedRoles.push(r);
}
ok('every role the client offers is accepted by project_collaborators_role_check',
  unexcusedRoles.length === 0,
  unexcusedRoles.map(r => `'${r}' offered by ${[...offered.get(r)!].join(', ')} — the database rejects the invite with 23514`).join('\n      '));

const unofferedRoles = [...dbRoles].filter(r => !offered.has(r));
if (unofferedRoles.length > 0) note(`CHECK also accepts ${unofferedRoles.map(r => `'${r}'`).join(', ')} which no client surface offers`);

// ── B. requested tiers ⊆ helper branches ────────────────────────────────────
const unexcusedTiers: string[] = [];
for (const [tier, count] of tiersUsed) {
  if (tier === 'viewer') continue; // the `else true` arm — any accepted collaborator
  const inCap = capBranches.has(tier);
  const inIpc = ipcBranches.has(tier);
  if (inCap && inIpc) continue;
  const p = pendingForTier(tier);
  if (p && !inCap && !inIpc) {
    note(`tier '${tier}' (${count} policy call(s)) is deploy-pending: ${p.file} — until then those policies resolve through 'else true' (any collaborator, including viewers)`);
    continue;
  }
  const where = [!inCap ? 'can_access_project(uuid)' : '', !inIpc ? 'is_project_collaborator' : ''].filter(Boolean).join(' and ');
  unexcusedTiers.push(
    `'${tier}' is requested by ${count} policy call(s) but ${where} has no when '${tier}' branch` +
    (dbRoles.has(tier) ? ' — the CHECK already accepts the role, so the migration is APPLIED BUT INCOMPLETE' : ''),
  );
}
ok('every min_role a policy passes has a branch in both access helpers (no silent fall-through to "any collaborator")',
  unexcusedTiers.length === 0, unexcusedTiers.join('\n      '));

// A branch nobody asks for is not a bug, but a branch for a role the CHECK
// rejects means a helper is ahead of the constraint — the mirror image of DB-F2.
const orphanBranches = [...capBranches, ...ipcBranches].filter(b => !dbRoles.has(b) && !pendingForTier(b));
ok('no helper branch names a role the CHECK rejects', orphanBranches.length === 0,
  `branch(es) ${[...new Set(orphanBranches)].map(b => `'${b}'`).join(', ')} exist but the constraint refuses the role`);

if (fail > 0) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n${pass} passed, 0 failed\n`);
