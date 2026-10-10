// aia-pay-app-delete-guard.mjs — PGlite proof of 20261014100000_aia_pay_app_delete_guard.sql (lane PAYAPP-1d):
// a frozen pay application cannot be deleted by a client's own statement; a draft can; deleting the whole job or
// the account still removes it; the service role still can.
// Usage: [MUTATE=<n>] node scripts/pgq/aia-pay-app-delete-guard.mjs <worktree>   |   ... <worktree> --all
//
// REAL: this migration; 20260728120000, 20260911090000 and 20261014090000, applied first exactly as on disk.
// STUBS: the roles, auth.users, auth.uid(); small public.projects; public.aia_pay_apps (production's columns, its
// owner policy, and its two foreign keys with ON DELETE CASCADE, read from pg_constraint on 2026-10-10).
import { BASE_SQL, loadPGlite, makeKit, readMigration, replacer, runAll, worktreeArg } from './_harness.mjs';

const ROOT = worktreeArg('scripts/pgq/aia-pay-app-delete-guard.mjs');
const FILE = '20261014100000_aia_pay_app_delete_guard.sql';

if (process.argv[3] === '--all') {
  runAll(import.meta.url, ROOT, {
    1: ['3'],       // a row frozen by the send alone can be deleted
    2: ['4'],       // a row frozen by a pay link can be deleted
    3: ['2'],       // a draft's delete is silently skipped
    4: ['6', '7', '8'],  // every role is refused: the job and the account cannot be deleted
    5: ['2'],       // a draft cannot be deleted
    6: ['3', '4'],  // the guard is on update, not delete
    7: ['9'],       // the refusal is retried by the offline queue (no "violates")
    8: ['13'],      // the self-check does not look at TRUNCATE or the owner
    9: ['14'],      // a deny-list: a role made later is not refused
  });
}

let MIG = readMigration(ROOT, FILE);
const MUTATE = Number(process.env.MUTATE || 0);
const rep = replacer(() => MIG, (v) => { MIG = v; }, MUTATE);
const noSelfCheck = () => rep("raise exception '[aia_pay_app_delete_guard] verify:", "raise notice '[aia_pay_app_delete_guard] verify:", true);
switch (MUTATE) {
  case 0: break;
  case 1: rep('  if (old.certified_at is not null or old.sent_locked_at is not null)', '  if (old.certified_at is not null)'); break;
  case 2: rep('  if (old.certified_at is not null or old.sent_locked_at is not null)', '  if (old.sent_locked_at is not null)'); break;
  case 3: rep('  return old;', '  return null;'); break;
  case 4: rep("     and current_user not in ('service_role', 'postgres', 'supabase_admin') then", '     then'); break;
  case 5: rep('  if (old.certified_at is not null or old.sent_locked_at is not null)\n', '  if true\n'); break;
  case 6: rep('  before delete on public.aia_pay_apps', '  before update on public.aia_pay_apps'); noSelfCheck(); break;
  case 7: rep('cannot be deleted: that violates its send lock.', 'cannot be deleted.'); break;
  case 8: rep("    raise exception '[aia_pay_app_delete_guard] verify: a client role holds TRUNCATE", "    raise notice '[aia_pay_app_delete_guard] verify: a client role holds TRUNCATE"); rep("    raise exception '[aia_pay_app_delete_guard] verify: public.aia_pay_apps is not owned by a server role", "    raise notice '[aia_pay_app_delete_guard] verify: public.aia_pay_apps is not owned by a server role"); break;
  case 9: rep("     and current_user not in ('service_role', 'postgres', 'supabase_admin') then", "     and current_user in ('authenticated', 'anon') then"); break;
  default: console.error('unknown MUTATE'); process.exit(2);
}
if (MUTATE) console.log(`(planted mutation M${MUTATE} applied)`);

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';
const P = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const R = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const PGlite = await loadPGlite();
const db = new PGlite();
await db.exec(BASE_SQL);
await db.exec(`
insert into auth.users (id, email) values ('${OWNER}', 'owner@x.test'), ('${OTHER}', 'other@x.test');
create table public.projects (id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, name text);
alter table public.projects enable row level security;
create policy projects_owner_all on public.projects for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
insert into public.projects (id, user_id, name) values ('${P(1)}', '${OWNER}', 'Job one'), ('${P(2)}', '${OWNER}', 'Job two'), ('${P(3)}', '${OTHER}', 'Other job');
create table public.aia_pay_apps (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, project_id uuid not null references public.projects(id) on delete cascade, invoice_id text,
  application_number integer not null default 1, application_date date, period_to date, contract_date date,
  owner_name text, contractor_name text, architect_name text, project_name text, project_location text, contract_for_description text,
  original_contract_sum numeric not null default 0, net_change_by_co numeric not null default 0, contract_sum_to_date numeric not null default 0,
  retainage_percent numeric not null default 10, less_previous_certificates numeric not null default 0,
  lines jsonb not null default '[]'::jsonb, notes text, snapshot_totals jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  portal_state jsonb, paid_at timestamptz, payment_intent_id text,
  pay_link_url text, pay_link_id text, pay_link_amount numeric
);
alter table public.aia_pay_apps enable row level security;
-- Production: no client role holds TRUNCATE (20260926190000_table_grant_hygiene.sql; read from the catalog 2026-10-10).
revoke truncate on public.aia_pay_apps from anon, authenticated;
create policy aia_pay_apps_owner_all on public.aia_pay_apps as permissive for all to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
`);
await db.exec(readMigration(ROOT, '20260728120000_lock_certified_aia_pay_apps.sql'));
await db.exec(readMigration(ROOT, '20260911090000_aia_certificate_response_writable.sql'));
const SEND_LOCK = readMigration(ROOT, '20261014090000_aia_pay_app_send_lock.sql');
const { ok, rows, tryRun, done } = makeKit(db);

// The pre-check: this file refuses to apply before the send lock.
let early = null;
try { await db.exec(MIG); } catch (e) { early = String(e.message); }
ok('0 applied before the send-lock migration, the file refuses and says which one to apply first', !!early && /20261014090000_aia_pay_app_send_lock\.sql first/.test(early), early ?? 'APPLIED');
await db.exec(SEND_LOCK);

const SENT = JSON.stringify({ currentPaymentDue: 10, __mageCertificate: { sentLockedAt: '2026-10-10T12:00:00.000Z' } });
const DRAFT = JSON.stringify({ currentPaymentDue: 10 });
const ins = async (n, project, snapshot, user = OWNER) => {
  const r = await tryRun('authenticated', `insert into public.aia_pay_apps (id, user_id, project_id, application_number, snapshot_totals) values ('${R(n)}', '${user}', '${project}', ${n}, $1::jsonb)`, user, [snapshot]);
  if (!r.ok) { console.error('fixture not written: ' + r.err); process.exit(3); }
};
// Job one: a draft (1), one sent with no pay link (2), one with a pay link (3), one sent AND linked (4), spares (5, 6, 7).
await ins(1, P(1), DRAFT); await ins(2, P(1), SENT); await ins(3, P(1), DRAFT); await ins(4, P(1), SENT);
await ins(5, P(1), SENT); await ins(6, P(1), SENT); await ins(7, P(1), DRAFT);
// Job two: a sent one that goes with its job. The other account: a sent one that goes with its account.
await ins(20, P(2), SENT); await ins(21, P(2), DRAFT); await ins(30, P(3), SENT, OTHER);
await db.exec(`update public.aia_pay_apps set certified_at = now(), pay_link_url = 'https://pay.test/x' where id in ('${R(3)}', '${R(4)}')`);
const before = JSON.stringify(await rows(`select * from public.aia_pay_apps order by id`));

let applyErr = null;
try { await db.exec(MIG); await db.exec(MIG); } catch (e) { applyErr = e; }
const after = JSON.stringify(await rows(`select * from public.aia_pay_apps order by id`));
ok('1 the migration applies cleanly, twice, and changes no row', applyErr === null && after === before, applyErr ? String(applyErr.message) : '');
if (applyErr) done();

const del = (n, role = 'authenticated', user = OWNER) => tryRun(role, `delete from public.aia_pay_apps where id = '${R(n)}'`, user);
const there = async (n) => (await rows(`select count(*)::int as n from public.aia_pay_apps where id = '${R(n)}'`))[0].n === 1;
const refused = (r) => !r.ok && /cannot be deleted/.test(r.err ?? '');

const d1 = await del(1);
ok('2 a draft is deleted by its owner exactly as before', d1.ok && d1.affected === 1 && !(await there(1)), d1.err ?? '');

const d2 = await del(2);
ok('3 an application frozen by the send alone (no pay link) cannot be deleted by its owner', refused(d2) && await there(2), d2.err ?? 'DELETED');

const d3 = await del(3);
const d4 = await del(4);
ok('4 an application frozen by a pay link, and one frozen by both, cannot be deleted by its owner', refused(d3) && refused(d4) && await there(3) && await there(4), [d3, d4].map((x) => x.err ?? 'DELETED').join(' | '));

const swap = await tryRun('authenticated', `with gone as (delete from public.aia_pay_apps where id = '${R(5)}' returning id) insert into public.aia_pay_apps (id, user_id, project_id, application_number, snapshot_totals) select '${R(50)}', '${OWNER}', '${P(1)}', 5, '{"currentPaymentDue": 99999}'::jsonb from gone`, OWNER);
const many = await tryRun('authenticated', `delete from public.aia_pay_apps where project_id = '${P(1)}'`, OWNER);
ok('5 the single-row swap is closed: delete-and-reinsert in one statement is refused, and a delete of every application on the job is refused whole (the draft beside them stays too)', refused(swap) && refused(many) && await there(5) && await there(7) && !(await there(50)), [swap, many].map((x) => x.err ?? 'TAKEN').join(' | '));

const job = await tryRun('authenticated', `delete from public.projects where id = '${P(2)}'`, OWNER);
ok('6 deleting the whole job still removes its applications, the frozen one included (Postgres runs the cascade as the owner of the table, not as the client)', job.ok && job.affected === 1 && !(await there(20)) && !(await there(21)), job.err ?? '');

const svc = await del(6, 'service_role');
ok('7 the service role can still delete a frozen application (support work, and delete-account\'s own table sweep)', svc.ok && svc.affected === 1 && !(await there(6)), svc.err ?? '');

const acct = await tryRun('service_role', `delete from auth.users where id = '${OTHER}'`);
ok('8 deleting the account (service role) still removes its frozen applications', acct.ok && !(await there(30)), acct.err ?? '');

ok('9 the refusal is a check_violation whose message says "violates", which the offline queue reads as final', /violates/.test(d2.err ?? '') && !/foreign key/.test(d2.err ?? ''), d2.err ?? '');

const stranger = await del(2, 'authenticated', OWNER.replace('a1', 'c3'));
const anon = await del(2, 'anon', '');
ok('10 another account and a signed-out caller delete nothing: row level security hides the row from them, so 0 rows and no refusal (unchanged)', stranger.ok && stranger.affected === 0 && anon.ok && anon.affected === 0 && await there(2), (stranger.err ?? '') + (anon.err ?? ''));

const edit = await tryRun('authenticated', `update public.aia_pay_apps set notes = 'still writable' where id = '${R(2)}'`, OWNER);
const priv = await rows(`select has_function_privilege('authenticated', 'public.aia_pay_app_guard_frozen_delete()', 'execute') as b, (select prosecdef from pg_proc where oid = 'public.aia_pay_app_guard_frozen_delete()'::regprocedure) as definer, (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'aia_pay_apps') as policies`);
ok('11 nothing else moved: a frozen row still takes a note, the guard is not SECURITY DEFINER or callable, the table has its one policy', edit.ok && edit.affected === 1 && priv[0].b === false && priv[0].definer === false && priv[0].policies === 1, JSON.stringify(priv[0]));

// A role made later, given the table and able to see every row, is a client too.
await db.exec(`create role partner_api bypassrls; grant usage on schema public to partner_api; grant select, delete on public.aia_pay_apps to partner_api`);
const later = await del(3, 'partner_api');
ok('14 a role created later, with DELETE on the table and no row level security, is refused like any client (the guard names who may, not who may not)', refused(later) && await there(3), later.err ?? 'DELETED');

// KNOWN LIMIT, stated in the migration: the round trip through the whole job is still open.
const jobGone = await tryRun('authenticated', `delete from public.projects where id = '${P(1)}'`, OWNER);
const jobBack = await tryRun('authenticated', `insert into public.projects (id, user_id, name) values ('${P(1)}', '${OWNER}', 'Job one again')`, OWNER);
const rowBack = await tryRun('authenticated', `insert into public.aia_pay_apps (id, user_id, project_id, application_number, original_contract_sum) values ('${R(2)}', '${OWNER}', '${P(1)}', 2, 99999)`, OWNER);
ok('12 KNOWN LIMIT: deleting the whole job, making it again and re-inserting the application under its old id is not stopped by this file', jobGone.ok && jobBack.ok && rowBack.ok, [jobGone, jobBack, rowBack].map((x) => x.err ?? 'ok').join(' | '));

// The self-check: a client role holding TRUNCATE, or owning the table, stops the file.
await db.exec(`grant truncate on public.aia_pay_apps to authenticated`);
let truncErr = null; try { await db.exec(MIG); } catch (e) { truncErr = String(e.message); }
await db.exec(`revoke truncate on public.aia_pay_apps from authenticated; alter table public.aia_pay_apps owner to authenticated`);
let ownerErr = null; try { await db.exec(MIG); } catch (e) { ownerErr = String(e.message); }
await db.exec(`alter table public.aia_pay_apps owner to postgres`);
ok('13 the file refuses to finish when a client role holds TRUNCATE on the table, or owns it (either would undo the design)', /holds TRUNCATE/.test(truncErr ?? '') && /not owned by a server role/.test(ownerErr ?? ''), `${truncErr} | ${ownerErr}`);

done();
