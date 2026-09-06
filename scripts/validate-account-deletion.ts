// validate-account-deletion.ts — deleting an account must delete, and must
// not destroy data and then fail.
//
// WHY THIS EXISTS (part 1, 2026-09-02). supabase/functions/delete-account runs
// its steps as SEPARATE, NON-TRANSACTIONAL calls with no rollback:
//   1. collect the user's project / portal / sub-portal ids and storage keys
//   2. delete rows across the user- and tenant-scoped tables
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
// WHY THIS EXISTS (part 2, 2026-09-03 — audit DB-F7 / AUTH-F1). The first
// version of this guard enumerated FOREIGN KEYS to auth.users. A table with no
// FK at all was therefore invisible to it, and eight such tables held client
// and sub PII that survived deletion: change_order_approvals (signature
// images), portal_messages, portal_budget_proposals, portal_decision_audit,
// sub_submitted_invoices, notification_outbox, memory_embeddings,
// conversations. Worse, USER_SCOPED_TABLES named 'portal_messages' — a table
// with no user_id column — so that delete answered 42703 on every run, the
// message did not match the "relation does not exist" tolerance, and the
// response still said success: true. Two orphaned portal messages were live.
//
// THE RULES:
//   1. every FK to auth.users that BLOCKS the parent delete (NO ACTION /
//      RESTRICT, including an omitted clause) is cleared by the function
//      before it calls deleteUser;
//   2. every table in supabase/schema.sql has a deletion path: a FK to
//      auth.users ON DELETE CASCADE, a CASCADE chain to a table that has one,
//      an explicit delete in delete-account, or a reasoned entry in the
//      allow-list of reference / shared tables below — enumerated from every
//      `CREATE TABLE public.*`, never from a list of names;
//   3. every explicit delete targets a column that exists (the dead
//      'portal_messages' entry class);
//   4. a failed delete against a table that exists stops the run BEFORE the
//      login is removed — success is never reported over orphaned rows.
//
// Reads the regenerated supabase/schema.sql (production truth) so it works
// offline and in CI without database credentials.
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
function note(msg: string) { console.log('  ·', msg); }

console.log('\naccount deletion (Apple 5.1.1(v) — must delete, must not half-delete):');

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

// ── 6. schema model: every table, every column, every FK ───────────────────
interface Table { columns: Map<string, { notNull: boolean }> }
const tables = new Map<string, Table>();
for (const m of schema.matchAll(/^CREATE TABLE public\.(\w+) \(\n([\s\S]*?)\n\);/gm)) {
  const columns = new Map<string, { notNull: boolean }>();
  for (const line of m[2].split('\n')) {
    if (/^\s*(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)\b/i.test(line)) continue;
    const cm = line.match(/^\s+"?(\w+)"?\s+\S/);
    if (cm) columns.set(cm[1], { notNull: /\bNOT NULL\b/.test(line) });
  }
  tables.set(m[1], { columns });
}
ok('tables were parsed from schema.sql (enumerated, not listed)', tables.size > 50,
  `only ${tables.size} CREATE TABLE statements matched — the dump changed shape; re-read this guard`);

interface Fk { table: string; constraint: string; column: string; target: string; action: string }
const fks: Fk[] = [...schema.matchAll(
  /ALTER TABLE ONLY public\.(\w+) ADD CONSTRAINT (\S+) FOREIGN KEY \((\w+)\) REFERENCES (auth\.users|\w+)\(\w+\)([^;]*);/g,
)].map(m => ({
  table: m[1], constraint: m[2], column: m[3], target: m[4],
  action: (m[5].match(/ON DELETE (CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION)/i)?.[1] ?? 'NO ACTION').toUpperCase(),
}));
ok('foreign keys were parsed from schema.sql', fks.length > 50);

// ── 7. what the function deletes explicitly ─────────────────────────────────
const arrayLiterals = (name: string): string[] => {
  const b = code.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  return b ? [...b[1].matchAll(/['"]([a-z_]+)['"]/g)].map(m => m[1]) : [];
};
const userScoped = arrayLiterals('USER_SCOPED_TABLES');
ok('USER_SCOPED_TABLES was parsed out of delete-account', userScoped.length > 10,
  'the table list changed shape — this guard can no longer read it');

const tenantBlock = code.match(/TENANT_SCOPED_DELETES[^=]*=\s*\[([\s\S]*?)\];/);
const tenantDeletes = tenantBlock
  ? [...tenantBlock[1].matchAll(/table:\s*'(\w+)'\s*,\s*column:\s*'(\w+)'\s*,\s*key:\s*'(\w+)'/g)]
      .map(m => ({ table: m[1], column: m[2], key: m[3] }))
  : [];
ok('TENANT_SCOPED_DELETES was parsed out of delete-account', tenantDeletes.length > 5,
  'the tenant-scoped delete map is missing or changed shape — portal / sub-portal / outbox rows would be invisible to this guard');

// `.from('x').delete()` written inline (conversations is keyed by a jsonb
// array of participant ids and cannot be expressed as a column match).
const inlineDeletes = [...code.matchAll(/\.from\(\s*'(\w+)'\s*\)\s*\.delete\(\)/g)].map(m => m[1]);
const explicit = new Set<string>([...userScoped, ...tenantDeletes.map(t => t.table), ...inlineDeletes]);

// Rule 3: every explicit delete targets a real column.
const deadUserEntries = userScoped.filter(t => !tables.has(t) || !tables.get(t)!.columns.has('user_id'));
ok("every USER_SCOPED_TABLES entry exists and has a user_id column (the dead 'portal_messages' entry class)",
  deadUserEntries.length === 0,
  deadUserEntries.map(t => `• '${t}' — ${tables.has(t) ? 'no user_id column: .eq(\'user_id\', …) answers 42703 on every run' : 'table does not exist in schema.sql'}`).join('\n      '));

const deadTenantEntries = tenantDeletes.filter(d => !tables.has(d.table) || !tables.get(d.table)!.columns.has(d.column));
ok('every TENANT_SCOPED_DELETES entry targets a column that exists',
  deadTenantEntries.length === 0,
  deadTenantEntries.map(d => `• ${d.table}.${d.column}`).join('\n      '));

const badKeys = tenantDeletes.filter(d => !['project', 'portal', 'subPortal', 'user'].includes(d.key));
ok('every TENANT_SCOPED_DELETES key is one the function resolves', badKeys.length === 0,
  badKeys.map(d => `• ${d.table}.${d.column} key '${d.key}'`).join('\n      '));

// ── 8. every table has a deletion path ──────────────────────────────────────
// Reference / shared tables that legitimately hold no tenant data, or whose
// rows must OUTLIVE the account. Each needs a reason — the reason is the
// point, so the next person adding a table has to decide which list it
// belongs in rather than pattern-match.
const ALLOWED: Record<string, string> = {
  app_config: 'server-only key/value config (edge-function URLs); no tenant column',
  cached_bids: 'scraped public bid notices shared by every tenant; no tenant column',
  cached_companies: 'scraped public company directory shared by every tenant; no tenant column',
  cached_jobs: 'scraped public job feed shared by every tenant; no tenant column',
  city_coords: 'geocoding cache keyed by (city, state); no tenant column',
  email_unsubscribes: 'CAN-SPAM suppression list keyed by email — an opt-out MUST survive the account so a re-signup cannot resume mail',
  geocode_run_lock: 'single-row cron mutex; no tenant column',
  labor_rates: 'reference rate table; no tenant column (unused by the app — CONTRACT-F5)',
  material_prices: 'reference price table; no tenant column (unused by the app — CONTRACT-F5)',
  materials_pricing: 'reference price table; no tenant column (unused by the app — CONTRACT-F5)',
  rate_limit_counters: 'edge-function rate-limit buckets keyed by scope string; expire on their own',
  zip_cost_factors: 'reference cost-factor table keyed by zip; no tenant column',
};

// A column that names a tenant. An allow-listed table carrying one of these is
// a mistake in the allow-list, not a reference table.
const TENANT_COLUMN = /^(user_id|recipient_user_id|gc_user_id|project_id|portal_id|sub_portal_id|sender_id|invited_by|created_by|claimed_by_user_id|homeowner_id|asker_user_id|subcontractor_id)$/;

const staleAllow = Object.keys(ALLOWED).filter(t => !tables.has(t));
ok('every allow-listed table exists (a stale excuse is its own bug)', staleAllow.length === 0,
  staleAllow.map(t => `• '${t}' is not in schema.sql`).join('\n      '));
const tenantAllow = Object.keys(ALLOWED).filter(t =>
  tables.has(t) && [...tables.get(t)!.columns.keys()].some(c => TENANT_COLUMN.test(c)));
ok('no allow-listed table carries a tenant-bearing column', tenantAllow.length === 0,
  tenantAllow.map(t => `• '${t}' has ${[...tables.get(t)!.columns.keys()].filter(c => TENANT_COLUMN.test(c)).join(', ')} — it holds tenant data and needs a real deletion path`).join('\n      '));

const covered = new Map<string, string>();
for (const t of explicit) if (tables.has(t)) covered.set(t, 'deleted explicitly by delete-account');
for (const [t, why] of Object.entries(ALLOWED)) if (tables.has(t)) covered.set(t, `allow-listed: ${why}`);

// Fixpoint over CASCADE chains: a table cascades if a CASCADE FK points at
// auth.users, or at a table that is itself covered.
let changed = true;
while (changed) {
  changed = false;
  for (const fk of fks) {
    if (covered.has(fk.table) || fk.action !== 'CASCADE') continue;
    if (fk.target === 'auth.users') {
      covered.set(fk.table, `${fk.constraint} → auth.users ON DELETE CASCADE`);
      changed = true;
    } else if (covered.has(fk.target) && !covered.get(fk.target)!.startsWith('allow-listed')) {
      covered.set(fk.table, `${fk.constraint} → ${fk.target} ON DELETE CASCADE (${covered.get(fk.target)})`);
      changed = true;
    }
  }
}

const uncovered = [...tables.keys()].filter(t => !covered.has(t)).sort();
ok('every table in schema.sql has a deletion path (auth CASCADE, CASCADE chain, explicit delete, or a reasoned allow-list entry)',
  uncovered.length === 0,
  uncovered.map(t => {
    const cols = [...tables.get(t)!.columns.keys()].filter(c => TENANT_COLUMN.test(c));
    return `• ${t}${cols.length ? ` (tenant columns: ${cols.join(', ')})` : ' (no tenant column — allow-list it with a reason if it is shared data)'}`;
  }).join('\n      ') +
  '\n\n      Add the table to USER_SCOPED_TABLES (user_id), TENANT_SCOPED_DELETES (project / portal / sub-portal keyed),\n' +
  '      an ON DELETE CASCADE FK in a migration, or ALLOWED above with a reason.');

// A CASCADE on a NULLABLE column covers only the rows that have the column
// set. Belt-and-braces explicit deletes exist for the known cases; report the
// rest so nobody assumes the FK alone is airtight.
const weak = fks.filter(fk => fk.action === 'CASCADE' && !explicit.has(fk.table)
  && tables.get(fk.table)?.columns.get(fk.column)?.notNull === false
  && covered.get(fk.table)?.startsWith(fk.constraint));
for (const fk of weak) note(`${fk.table} relies on ${fk.constraint} over NULLABLE ${fk.column} — rows with a NULL ${fk.column} would survive`);

// ── 9. ordering and honesty ─────────────────────────────────────────────────
const collectAt = code.indexOf('explicitObjects');
const tenantAt = code.indexOf('of TENANT_SCOPED_DELETES)');
ok('tenant-scoped deletes run after storage-key collection and before the auth delete',
  collectAt !== -1 && tenantAt !== -1 && collectAt < tenantAt && tenantAt < authAt,
  'the portal / project id lists come from rows the function is about to delete; order is the whole defect');

const abortAt = code.search(/tableErrors\.length\s*>\s*0/);
ok('a failed delete against an existing table stops the run BEFORE the login is removed (rule 4)',
  abortAt !== -1 && abortAt < authAt,
  'without this the response says success: true over rows that were never deleted, and nobody can retry because the JWT is gone');

ok("only 'relation does not exist' is tolerated — a missing COLUMN is an error",
  /relation \.\* does not exist/.test(code) && !/column \.\* does not exist/.test(code),
  'tolerating "column … does not exist" is exactly how the dead portal_messages entry hid for a month');

// ── 10. reads cannot fail quietly, and bytes go only after every row is gone ─
// (review 2026-09-05) selectAllByUser used to `break` on error and hand back
// an empty list, so a transient read failure on projects / sub_portal_links /
// plan_sheets / public_bids emptied projectIds / portalIds / subPortalIds;
// every TENANT_SCOPED_DELETES entry and every keyed storage walk was skipped
// without a word, projects cascaded, and step 4 still removed the login with
// success: true. And the storage pass ran BEFORE the tableErrors abort, so an
// abort kept the login with the user's files already destroyed.
const selStart = code.indexOf('const selectAllByUser');
const selEnd = selStart === -1 ? -1 : code.indexOf('return rows;', selStart);
const selBody = selStart !== -1 && selEnd !== -1 ? code.slice(selStart, selEnd) : '';
ok('selectAllByUser propagates a read failure instead of returning an empty list',
  selBody.length > 0 && /if\s*\(\s*error\s*\)\s*throw\b/.test(selBody) && !/error\s*\|\|/.test(selBody),
  'an empty list on error is indistinguishable from an account that owns nothing — every tenant-scoped delete and keyed storage walk is then skipped silently');

const collectFailAt = code.indexOf('collectErr');
const firstDeleteAt = code.search(/\.delete\(\)/);
const collectFailBlock = collectFailAt !== -1 && firstDeleteAt !== -1 ? code.slice(collectFailAt, firstDeleteAt) : '';
ok('a failed id / storage-key collection answers 500 BEFORE the first row delete',
  collectFailAt !== -1 && firstDeleteAt !== -1 && collectFailAt < firstDeleteAt && /\b500\b/.test(collectFailBlock),
  'the collection failure must become a response while nothing has been deleted yet');

const storageAt = code.indexOf('sb.storage');
ok('storage removal runs only AFTER the row-delete abort check (an abort keeps the bytes as well as the login)',
  abortAt !== -1 && storageAt !== -1 && abortAt < storageAt,
  'storage ran before the abort, so a kept login came with its files already gone and nothing left to retry against');
ok('storage removal runs BEFORE the auth delete',
  storageAt !== -1 && authAt !== -1 && storageAt < authAt,
  'the row-derived storage keys cannot be re-read once the login is gone');

// ── 11. a portal id is a claim, not a proof (review 2026-09-05, round 3) ────
// projects.client_portal is client-written (the owner upsert sends the whole
// blob) and the portalId is in every homeowner link. A caller who PATCHes a
// victim's id into their own project and then deletes their account would
// have step 2a delete the victim's portal_messages, e-signed
// change_order_approvals, portal_budget_proposals, portal_decision_audit and
// portal_snapshots under the service role — and answer success: true. The
// function must resolve every claimed id back to the projects that carry it,
// keep only the ids that resolve to the caller's projects alone, and key the
// portal deletes on THAT set. (The database half — a unique partial index and
// the freeze trigger — is 20260904100950; its content is pinned by
// validate-portal-security.)
ok('the ids read out of client_portal are CLAIMED (claimedPortalIds), never used as portalIds directly',
  /const\s+claimedPortalIds\b[^;]*selectAllByUser\(\s*'projects'\s*,\s*'client_portal'\s*\)/.test(code)
  && !/const\s+portalIds\b[^;]*selectAllByUser\(/.test(code),
  'the raw jsonb read must not feed the portal-keyed deletes');

const resolverAt = code.indexOf('const resolvePortalIds');
const resolverEnd = resolverAt === -1 ? -1 : code.indexOf('return { portalIds, portalCollisions };', resolverAt);
const resolver = resolverAt !== -1 && resolverEnd !== -1 ? code.slice(resolverAt, resolverEnd) : '';
ok('a resolvePortalIds helper exists and returns { portalIds, portalCollisions }', resolver.length > 0,
  'the resolver was removed or renamed — the portal-keyed deletes are running on the raw claim');
ok('it resolves the claimed ids against projects by client_portal->>portalId (service role, so RLS cannot hide a row)',
  /\.from\(\s*'projects'\s*\)[\s\S]*?\.in\(\s*'client_portal->>portalId'\s*,/.test(resolver),
  'without the reverse lookup a spoofed id is indistinguishable from an owned one');
ok("an id is kept only if EVERY project it resolves to is the caller's; a collision is counted, not kept",
  /every\(\s*\w+\s*=>\s*owned\.has\(\s*\w+\s*\)\s*\)/.test(resolver) && /portalCollisions\+\+/.test(resolver),
  'a colliding id must be dropped and counted');
ok('an id that resolves to no project is not used as a key either',
  /projects\.size\s*===\s*0[\s\S]*?continue/.test(resolver),
  'not provably ours → not deleted under the service role');
const collisionLog = resolver.match(/console\.error\(\s*`([^`]*)`/)?.[1] ?? '';
ok('the collision log carries the COUNT and no id',
  /\$\{portalCollisions\}/.test(collisionLog) && (collisionLog.match(/\$\{/g) ?? []).length === 1,
  "naming the id in a log names the victim's link");
ok('portalIds and portalCollisions come out of the resolver, fed the claimed ids and the owned project ids',
  /const\s*\{\s*portalIds\s*,\s*portalCollisions\s*\}\s*=\s*await\s+resolvePortalIds\(\s*claimedPortalIds\s*,\s*projectIds\s*\)/.test(code),
  'the resolver must be what produces portalIds');
ok("the 'portal' key of TENANT_SCOPED_DELETES is fed the RESOLVED list",
  /portal:\s*portalIds\s*,/.test(code) && !/portal:\s*claimedPortalIds/.test(code),
  'the tenantIds map is what the delete loop reads; it must never see the raw claim');
const successAt = code.lastIndexOf('success: true');
const successBody = successAt === -1 ? '' : code.slice(successAt, code.indexOf('})', successAt));
ok('the success response reports portalCollisions and storageListErrors (counts only)',
  /portalCollisions/.test(successBody) && /storageListErrors/.test(successBody),
  'a silent drop is how the next reviewer finds this again');

// Sub-portal ids need no OWNERSHIP resolution: they are read from the
// sub_portal_links TABLE, `id` is its PRIMARY KEY, and both write policies pin
// user_id = auth.uid(). Pin that construction — it is the reason no resolver
// exists for them.
ok('subPortalIds are read from the sub_portal_links TABLE, not out of a jsonb',
  /selectAllByUser\(\s*'sub_portal_links'\s*,\s*'id'\s*\)/.test(code));
ok('sub_portal_links.id is its PRIMARY KEY, so no other tenant can hold the same id',
  /ALTER TABLE ONLY public\.sub_portal_links ADD CONSTRAINT sub_portal_links_pkey PRIMARY KEY \(id\);/.test(schema),
  'if the PK moves off id, subPortalIds need the same OWNERSHIP resolution as portalIds ' +
  '(the ENCODING half is section 13 below and is not covered by the PK)');
ok('sub_portal_links INSERT and UPDATE policies pin user_id = auth.uid()',
  /CREATE POLICY "gc writes own sub portal links" ON public\.sub_portal_links[^;]*WITH CHECK \(\(user_id = auth\.uid\(\)\)\)/.test(schema)
  && /CREATE POLICY "gc updates own sub portal links" ON public\.sub_portal_links[^;]*WITH CHECK \(\(user_id = auth\.uid\(\)\)\)/.test(schema),
  'the rows selected by user_id must be rows only that user could have written');
ok('the database half exists: 20260904100950_portal_id_unique_and_frozen.sql',
  existsSync(join(ROOT, 'supabase', 'migrations', '20260904100950_portal_id_unique_and_frozen.sql')),
  'the resolver alone leaves the spoof WRITABLE (see validate-portal-security for the content checks)');

// ── 13. an id is a QUERY FRAGMENT (review 2026-09-06) ───────────────────────
// The three checks above answer "whose id is this". They are all true and they
// were all beside the point, because the live exploit needed no spoofing at
// all. postgrest-js builds `.in()` by wrapping any value containing `[,()]` in
// DOUBLE QUOTES and escaping nothing inside them; PostgREST splits on the
// commas between quoted items and un-escapes `\"` inside them. So ONE id can
// become TWO filter values. Probed live 2026-09-06 against city_coords with
// the public anon key: `state=in.("TX","CA")` → TX rows AND CA rows;
// `latitude=in.("AA\",\"BB")` → 400 naming the single value `AA","BB`;
// `state=in.("TX\",\"CA",CA)` → CA rows (escaped and plain items coexist);
// `state=eq.TX","CA` → []. Under the service role, in a DELETE, that is a
// cross-tenant erase:
//   (a) sub_portal_links.id is `text NOT NULL` with NO DEFAULT, minted on the
//       client, and its INSERT policy checks only user_id — so a row that is
//       genuinely and uniquely the caller's could hold the value
//       `x","<victim sub_portal_id>`. The PK pin above proves IDENTITY and
//       says nothing about ENCODING.
//   (b) two projects of the attacker's own, carrying P = `x","<victim>` and
//       C = `x\",\"<victim>`, walk P past resolvePortalIds: C un-escapes to P
//       inside the resolver's own `.in()`, so P resolves to an owned project
//       and is kept. Both strings are distinct, so 20260904100950's unique
//       index is satisfied; both writes are by the OWNER, so its freeze
//       trigger never fires.
// The fix has three parts and every one of them is pinned here: a charset
// gate before any id becomes a filter value, `.eq` (which does not split)
// instead of `.in()` on the two TEXT-keyed delete columns, and a CHECK
// constraint on both tables that store such an id.
const CHARSET_LITERAL = String.raw`/^[A-Za-z0-9._:-]{1,128}$/`;
ok(`delete-account defines the id charset gate as ${CHARSET_LITERAL}`,
  code.includes(`const SAFE_DELETE_KEY = ${CHARSET_LITERAL}`),
  'the class must exclude , ( ) " \\ and whitespace — every character the `.in()` splice needs — ' +
  'and it must stay byte-identical to the CHECK constraints in 20260904100950');

// Every list that becomes a filter value or a storage prefix goes through it.
const gateDefAt = code.indexOf('const gate = (');
ok('a single gate() helper is what applies it, and it counts rather than logs the value',
  gateDefAt !== -1
  && /malformedIds\s*\+=\s*dropped/.test(code)
  && /console\.error\(`\[delete-account\] \$\{dropped\} \$\{label\} id\(s\)/.test(code),
  'the value that fails the gate IS the payload and carries the victim id — count it, never print it');
for (const list of ['project', 'subcontractor', 'portal', 'sub-portal']) {
  ok(`the ${list} id list is produced by gate('${list}', …)`,
    new RegExp(`gate\\(\\s*'${list}'\\s*,`).test(code),
    'an ungated list is one refactor away from being a delete key again');
}
ok('resolvePortalIds re-asserts the gate on its own candidates',
  /const candidates = \[\.\.\.new Set\(claimed\)\]\.filter\(id => SAFE_DELETE_KEY\.test\(id\)\)/.test(code),
  "the resolver's own `.in()` was exploit (b)'s first stop — a read filter is a filter");
ok('malformedIds is reported in the success response (count only)',
  /malformedIds/.test(successBody) && !/malformedId\w*\s*:\s*\[/.test(code),
  'a silent drop is how the next reviewer finds this again');

// The `.eq` form, and the rule that it must not slide back to `.in()`.
// `code` has its comment lines stripped, so the loop's end is marked by the
// next statement (step 2b's conversations delete), never by a `// 2b.` label.
const tenantLoopAt = code.indexOf('for (const { table, column, key } of TENANT_SCOPED_DELETES)');
const tenantLoopEnd = tenantLoopAt === -1 ? -1 : code.indexOf(".from('conversations')", tenantLoopAt);
const tenantLoop = tenantLoopAt !== -1 && tenantLoopEnd !== -1 ? code.slice(tenantLoopAt, tenantLoopEnd) : '';
ok('the tenant-scoped delete loop was located and bounded', tenantLoop.length > 0,
  'the loop or the conversations delete that follows it moved — re-read this section');
ok("the TEXT-keyed delete columns ('portal', 'subPortal') are named as such",
  /const TEXT_KEYED_TENANT_KEYS: ReadonlyArray<TenantKey> = \['portal', 'subPortal'\]/.test(code),
  'these are the two whose column is `text` and whose values the caller minted');
ok('they are deleted one id at a time with .eq(column, id) — the form proved not to split',
  /TEXT_KEYED_TENANT_KEYS\.includes\(key\)\)\s*\{\s*for \(const id of ids\) \{\s*const \{ error \} = await sb\.from\(table\)\.delete\(\)\.eq\(column, id\);/.test(tenantLoop),
  'postgrest-js appends `eq.${value}` verbatim, so there is no quoted context for a `","` to escape out of');
// The teeth: a `.in()` reachable from a text-keyed id is the regression.
// `[^)]*` would stop inside `ids.slice(i, i + IN_CHUNK)`, so take the rest of
// the statement up to the `;` and compare the whole argument list.
const inCallsInLoop = [...tenantLoop.matchAll(/\.delete\(\)\.in\((.*?)\);/g)].map(m => m[1].trim());
ok('the only `.in()` left in the loop is the uuid-keyed, chunked project delete',
  inCallsInLoop.length === 1 && inCallsInLoop[0] === 'column, ids.slice(i, i + IN_CHUNK)'
  && /\} else if \(key === 'user'\)/.test(tenantLoop),
  `found ${inCallsInLoop.length} \`.in()\` delete call(s): ${inCallsInLoop.join(' | ') || '(none)'}\n` +
  '      A `.in()` is only admissible on a column PostgREST cannot return a splice from — projects.id\n' +
  "      and subcontractors.id are `uuid`. portal_id and sub_portal_id are `text`: use `.eq` per id.");
for (const col of ['portal_id', 'sub_portal_id'] as const) {
  ok(`${col} is still a text column in schema.sql (so it still needs the .eq form)`,
    new RegExp(`^\\s+${col} text NOT NULL,`, 'm').test(schema),
    'if these ever become uuid the .eq loop may go back to a chunked .in(); until then it may not');
}
// The mirror of the rule above: the chunked `.in()` that survives is admissible
// ONLY because these two are uuid, which PostgREST cannot splice. Pin it, or the
// stated reason for that call quietly stops being true.
for (const [table, col] of [['projects', 'id'], ['subcontractors', 'id']] as const) {
  const decl = new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?^\\);`, 'm').exec(schema)?.[0] ?? '';
  ok(`${table}.${col} is still uuid (the reason the chunked .in() is allowed)`,
    new RegExp(`^\\s+${col} uuid `, 'm').test(decl),
    `if ${table}.${col} ever becomes text, that .in() becomes the same splice vector as portal_id was`);
}

// The database half of the charset gate.
const uniqMig = readFileSync(join(ROOT, 'supabase', 'migrations', '20260904100950_portal_id_unique_and_frozen.sql'), 'utf8')
  .replace(/^[ \t]*--.*$/gm, '');
ok('20260904100950 adds sub_portal_links_id_charset with the same class',
  /add constraint sub_portal_links_id_charset\s+check \(id ~ '\^\[A-Za-z0-9\._:-\]\{1,128\}\$'\)/.test(uniqMig),
  'the code gate holds only in delete-account; any other service-role reader of these ids is on its own');
ok("20260904100950 adds projects_client_portal_portal_id_charset, admitting NULL and the '' placeholder",
  /add constraint projects_client_portal_portal_id_charset\s+check \(client_portal->>'portalId' is null\s+or client_portal->>'portalId' = ''\s+or client_portal->>'portalId' ~ '\^\[A-Za-z0-9\._:-\]\{1,128\}\$'\)/.test(uniqMig),
  "'' is DEFAULT_PORTAL's placeholder (app/client-portal-setup.tsx:135); rejecting it would fail a save that succeeds today");
ok('both CHECKs are guarded by a violation count that raises with the COUNT and never the value',
  /where id !~ '\^\[A-Za-z0-9\._:-\]\{1,128\}\$'/.test(uniqMig)
  && /raise exception '\[100950\] % sub_portal_links row\(s\) hold an id outside/.test(uniqMig)
  && /raise exception '\[100950\] % project\(s\) hold a client_portal->>''portalId'' outside/.test(uniqMig),
  'an id that fails the class IS a splice payload and carries the victim id');
ok('section 5 asserts both constraints exist AND are validated',
  /conname = 'sub_portal_links_id_charset'[\s\S]{0,200}?convalidated/.test(uniqMig)
  && /conname = 'projects_client_portal_portal_id_charset'[\s\S]{0,200}?convalidated/.test(uniqMig),
  'an unvalidated CHECK admits every row already in the table');

// The advisory that came with it.
ok('a failed storage remove() is counted, not just logged',
  /storageRemoveErrors\+\+/.test(code) && /storageRemoveErrors/.test(successBody),
  'a remove() that fails leaves the objects in place, and the response looked exactly like an empty prefix');

// ── 12. paging and storage honesty (advisories from the same review) ────────
ok('selectAllByUser pages until an EMPTY page, stepping by what came back (no db-max-rows assumption)',
  /from\s*\+=\s*data\.length/.test(selBody) && !/data\.length\s*<\s*PAGE/.test(selBody),
  'stopping on a short page assumes db-max-rows >= 1000; under a lower cap the first slice is reported as the whole account');
// The 600-char window after `.list(` holds the error branch; lazy matching
// because the log line's template literal carries `${…}` braces of its own.
const listAt = code.indexOf('.list(');
const listBlock = listAt === -1 ? '' : code.slice(listAt, listAt + 600);
ok('a failed storage list() is logged and counted, not treated as an empty folder',
  /if\s*\(\s*error\s*\)\s*\{[\s\S]*?console\.error\([\s\S]*?storageListErrors\+\+;[\s\S]*?break;/.test(listBlock)
  && !/error\s*\|\|\s*!list/.test(listBlock),
  'an unlistable prefix used to look exactly like an empty one');
ok('no support mailbox is hard-coded into a response body', !/support@mageid\.app/.test(code),
  'a mailbox in an error string outlives the mailbox');

if (fail > 0) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n${pass} passed, 0 failed\n`);
