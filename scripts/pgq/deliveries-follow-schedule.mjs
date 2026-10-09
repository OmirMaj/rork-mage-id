// deliveries-follow-schedule.mjs — PGlite proof of 20261012090000_deliveries_follow_schedule.sql (lane DELIVERIES-1).
// Usage: [MUTATE=<n>] node scripts/pgq/deliveries-follow-schedule.mjs <worktree>   (one run)
//        node scripts/pgq/deliveries-follow-schedule.mjs <worktree> --all            (as written + every planted mutation)
// A plant softens the migration's own self-check to a notice where it would catch the plant at
// apply time, so the CASES below are what must go red.
//
// REAL: the migration; the whole of 20260826200000_deliveries.sql (the table, its indexes and its four
// policies, applied first, exactly as on disk); and public.can_access_project(uuid, text) cut out of
// 20260826130000_field_role.sql at run time (a missing anchor stops the proof).
// STUBS: the roles, auth.users, auth.uid(), and small versions of public.projects and
// public.project_collaborators holding only the columns can_access_project reads.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BASE_SQL, loadPGlite, makeKit, readMigration, replacer, runAll, worktreeArg } from './_harness.mjs';

const ROOT = worktreeArg('scripts/pgq/deliveries-follow-schedule.mjs');
const FILE = '20261012090000_deliveries_follow_schedule.sql';

if (process.argv[3] === '--all') {
  runAll(import.meta.url, ROOT, {
    1: ['6'],            // expected_date stays NOT NULL: "No date yet" cannot be saved
    2: ['7'],            // the buffer check removed: -1 and 61 working days are stored
    3: ['8'],            // the lead time check removed: 0 and 731 days are stored
    4: ['9a', '9b', '9c'], // the history check removed: an object, 41 entries and 20 KB are stored
    5: ['10'],           // the task id check removed: an empty and a 201-character id are stored
    6: ['2', '3'],       // buffer_days added NOT NULL with a default: an old row is no longer untouched
    7: ['2'],            // a needed-by column is added: the date would be stored
    8: ['12', '13', '15'], // the update policy loosened to `true`: a viewer and a stranger write
    9: ['16'],           // a trigger is added to the table: something acts when a row changes
    10: ['9c'],          // only the byte cap removed
    11: ['9b'],          // only the entry cap removed
    12: ['14', '15'],    // anon is given a read policy
    13: ['2'],           // an order-by column is added: the date would be stored
    14: ['11'],          // a column is added the field seat cannot write (a column-level revoke)
  });
}

let MIG = readMigration(ROOT, FILE);
const MUTATE = Number(process.env.MUTATE || 0);
const rep = replacer(() => MIG, (v) => { MIG = v; }, MUTATE);
const noSelfCheck = () => rep("raise exception '[deliveries_follow_schedule] verify:", "raise notice '[deliveries_follow_schedule] verify:", true);
const END = "notify pgrst, 'reload schema';";
const HISTORY_CHECK = `alter table public.deliveries add constraint deliveries_fs_date_history_check
  check (date_history is null or (
    jsonb_typeof(date_history) = 'array'
    and jsonb_array_length(date_history) <= 40
    and octet_length(date_history::text) <= 16384
  ));`;
switch (MUTATE) {
  case 0: break;
  case 1: rep('alter table public.deliveries alter column expected_date drop not null;', ''); noSelfCheck(); break;
  case 2: rep('  check (buffer_days is null or (buffer_days between 0 and 60));', '  check (true);'); break;
  case 3: rep('  check (lead_time_days is null or (lead_time_days between 1 and 730));', '  check (true);'); break;
  case 4: rep(HISTORY_CHECK, 'alter table public.deliveries add constraint deliveries_fs_date_history_check check (true);'); break;
  case 5: rep('  check (task_id is null or (char_length(task_id) between 1 and 200));', '  check (true);'); break;
  case 6: rep('alter table public.deliveries add column if not exists buffer_days integer;', 'alter table public.deliveries add column if not exists buffer_days integer not null default 2;'); noSelfCheck(); break;
  case 7: rep(END, `alter table public.deliveries add column if not exists needed_by date;\n${END}`); noSelfCheck(); break;
  case 8: rep(END, `drop policy if exists deliveries_collab_update on public.deliveries;\ncreate policy deliveries_collab_update on public.deliveries for update to authenticated using (true) with check (true);\n${END}`); break;
  case 9: rep(END, `create or replace function public.deliveries_follow_schedule_touch() returns trigger language plpgsql as $t$ begin new.notes := coalesce(new.notes, '') || ' moved'; return new; end $t$;\ndrop trigger if exists deliveries_follow_schedule_touch on public.deliveries;\ncreate trigger deliveries_follow_schedule_touch before update on public.deliveries for each row execute function public.deliveries_follow_schedule_touch();\n${END}`); noSelfCheck(); break;
  case 10: rep("\n    and octet_length(date_history::text) <= 16384", ''); break;
  case 11: rep("\n    and jsonb_array_length(date_history) <= 40", ''); break;
  case 12: rep(END, `drop policy if exists deliveries_anon_read on public.deliveries;\ncreate policy deliveries_anon_read on public.deliveries for select to anon using (true);\n${END}`); noSelfCheck(); break;
  case 13: rep(END, `alter table public.deliveries add column if not exists order_by_date date;\n${END}`); noSelfCheck(); break;
  case 14: rep(END, `revoke update on public.deliveries from authenticated;\ngrant update (description, supplier, status, expected_date, updated_at) on public.deliveries to authenticated;\n${END}`); break;
  default: console.error('unknown MUTATE'); process.exit(2);
}
if (MUTATE) console.log(`(planted mutation M${MUTATE} applied)`);

// The real table and its real policies, and the real access rule.
const DELIVERIES = readMigration(ROOT, '20260826200000_deliveries.sql');
const FIELD_ROLE = readFileSync(path.join(ROOT, 'supabase/migrations/20260826130000_field_role.sql'), 'utf8');
const START = "create or replace function public.can_access_project(pid uuid, min_role text default 'viewer')";
const at = FIELD_ROLE.indexOf(START);
const end = at < 0 ? -1 : FIELD_ROLE.indexOf('$$;', at);
if (at < 0 || end < 0) { console.error('anchor not found: can_access_project(uuid, text) in 20260826130000_field_role.sql'); process.exit(3); }
const CAN_ACCESS = FIELD_ROLE.slice(at, end + 3);
if (!CAN_ACCESS.includes("'field'")) { console.error('can_access_project no longer has the field tier this proof names'); process.exit(3); }
for (const p of ['deliveries_collab_select', 'deliveries_collab_insert', 'deliveries_collab_update', 'deliveries_owner_delete']) {
  if (!DELIVERIES.includes(`create policy ${p} on public.deliveries`)) { console.error(`anchor not found: policy ${p} in 20260826200000_deliveries.sql`); process.exit(3); }
}

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const FIELD = '00000000-0000-4000-8000-0000000000d4';
const VIEWER = '00000000-0000-4000-8000-0000000000c3';
const STRANGER = '00000000-0000-4000-8000-0000000000e5';
const P1 = '10000000-0000-4000-8000-000000000001';
const P2 = '10000000-0000-4000-8000-000000000002';   // the stranger's own job
const D = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const PGlite = await loadPGlite();
const db = new PGlite();
await db.exec(BASE_SQL);
await db.exec(`
insert into auth.users (id, email) values ('${OWNER}', 'owner@x.test'), ('${FIELD}', 'field@x.test'), ('${VIEWER}', 'viewer@x.test'), ('${STRANGER}', 'stranger@x.test');
create table public.projects (id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, name text);
create table public.project_collaborators (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null, status text not null);
insert into public.projects (id, user_id, name) values ('${P1}', '${OWNER}', 'Job one'), ('${P2}', '${STRANGER}', 'Another firm');
insert into public.project_collaborators (project_id, user_id, role, status) values ('${P1}', '${FIELD}', 'field', 'accepted'), ('${P1}', '${VIEWER}', 'viewer', 'accepted');
${CAN_ACCESS}
grant execute on function public.can_access_project(uuid, text) to authenticated, service_role;
`);
await db.exec(DELIVERIES);
const { ok, rows, tryRun, done } = makeKit(db);

// A row from before the migration, written the way every build before the lane writes it.
const OLD_INSERT = (id, uid, project, extra = '') =>
  `insert into public.deliveries (id, user_id, project_id, description, supplier, expected_date, status, created_at, updated_at${extra ? ', ' + extra.split('=')[0] : ''})
   values ('${id}', '${uid}', '${project}', 'Roof Trusses', 'Kessler Lumber Yard', '2026-11-12', 'scheduled', now(), now()${extra ? ', ' + extra.split('=')[1] : ''})`;
const pre = await tryRun('authenticated', OLD_INSERT(D(1), OWNER, P1), OWNER);
if (!pre.ok) { console.error('the fixture row could not be written before the migration: ' + pre.err); process.exit(3); }

const POLICY_SNAPSHOT = `select policyname, cmd, roles::text as roles, coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
  from pg_policies where schemaname = 'public' and tablename = 'deliveries' order by policyname`;
const GRANT_SNAPSHOT = `select r as role, p as priv, has_table_privilege(r, 'public.deliveries', p) as held
  from unnest(array['anon','authenticated','service_role']) r, unnest(array['select','insert','update','delete']) p order by 1, 2`;
const policiesBefore = JSON.stringify(await rows(POLICY_SNAPSHOT));
const grantsBefore = JSON.stringify(await rows(GRANT_SNAPSHOT));
const funcsBefore = (await rows(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`))[0].n;

let applyErr = null;
try { await db.exec(MIG); await db.exec(MIG); } catch (e) { applyErr = e; }
ok('1 the migration applies cleanly, twice (idempotent)', applyErr === null, applyErr ? String(applyErr.message) : '');
if (applyErr) done();

const cols = await rows(`select column_name, is_nullable, data_type from information_schema.columns where table_schema = 'public' and table_name = 'deliveries'`);
const col = (n) => cols.find((c) => c.column_name === n);
const NEW = { task_id: 'text', buffer_days: 'integer', lead_time_days: 'integer', ordered_on: 'date', promised_date: 'date', date_history: 'jsonb', task_start_seen: 'date' };
const stored = cols.filter((c) => /^needed|^order_by/.test(c.column_name)).map((c) => c.column_name);
ok('2 the seven columns exist with the header\'s types and are nullable; no needed-by and no order-by column exists (those dates are worked out, never stored)',
  Object.entries(NEW).every(([n, t]) => col(n)?.is_nullable === 'YES' && col(n)?.data_type === t) && stored.length === 0,
  `${Object.keys(NEW).map((n) => `${n}:${col(n)?.data_type ?? 'missing'}/${col(n)?.is_nullable ?? '-'}`).join(' ')} stored-date columns [${stored.join(',')}]`);

const old = (await rows(`select * from public.deliveries where id = '${D(1)}'`))[0];
ok('3 a row from before the migration is untouched: its date kept, every new column NULL',
  !!old && String(old.expected_date).length > 0 && Object.keys(NEW).every((n) => old[n] === null),
  JSON.stringify(old && Object.fromEntries(Object.keys(NEW).map((n) => [n, old[n]]))));

const oldBuild = await tryRun('authenticated', OLD_INSERT(D(2), OWNER, P1), OWNER);
ok('4 an older build\'s insert (the old columns only) still lands', oldBuild.ok, oldBuild.err ?? '');

const history = JSON.stringify([{ date: '2026-12-01', previousDate: '2026-11-12', at: '2026-10-09T15:00:00.000Z', source: 'supplier_said', note: 'by phone', by: OWNER }]);
const full = await tryRun('authenticated',
  `insert into public.deliveries (id, user_id, project_id, description, supplier, expected_date, status, created_at, updated_at, task_id, buffer_days, lead_time_days, ordered_on, promised_date, date_history, task_start_seen)
   values ('${D(3)}', '${OWNER}', '${P1}', '14 Windows', 'Northside Glass', '2026-12-01', 'scheduled', now(), now(), 'task-window-install', 3, 42, '2026-09-28', '2026-11-12', $1::jsonb, '2026-11-18')`, OWNER, [history]);
const back = (await rows(`select task_id, buffer_days, lead_time_days, ordered_on::text as ordered_on, promised_date::text as promised_date, date_history, task_start_seen::text as task_start_seen from public.deliveries where id = '${D(3)}'`))[0];
ok('5 the owner saves a delivery with every new column and reads the same values back',
  full.ok && back?.task_id === 'task-window-install' && back?.buffer_days === 3 && back?.lead_time_days === 42 && back?.ordered_on === '2026-09-28'
    && back?.promised_date === '2026-11-12' && back?.task_start_seen === '2026-11-18' && back?.date_history?.[0]?.previousDate === '2026-11-12',
  full.err ?? JSON.stringify(back));

const noDate = await tryRun('authenticated',
  `insert into public.deliveries (id, user_id, project_id, description, supplier, expected_date, status, created_at, updated_at, task_id)
   values ('${D(4)}', '${OWNER}', '${P1}', 'Flashing Tape and Sealant', 'Harbor Building Supply', null, 'scheduled', now(), now(), 'task-window-install')`, OWNER);
ok('6 "No date yet": a delivery with no supplier date is saved (expected_date NULL)', noDate.ok, noDate.err ?? '');

const setCol = (id, sql, uid = OWNER, params = []) => tryRun('authenticated', `update public.deliveries set ${sql} where id = '${id}' returning id`, uid, params);
{
  const lo = await setCol(D(2), 'buffer_days = -1');
  const hi = await setCol(D(2), 'buffer_days = 61');
  const zero = await setCol(D(2), 'buffer_days = 0');
  const sixty = await setCol(D(2), 'buffer_days = 60');
  ok('7 the buffer is 0 to 60 working days: -1 and 61 are refused, 0 and 60 are stored', !lo.ok && !hi.ok && zero.ok && zero.n === 1 && sixty.ok && sixty.n === 1,
    `-1 ${lo.ok ? 'stored' : 'refused'}; 61 ${hi.ok ? 'stored' : 'refused'}; 0 ${zero.ok ? 'stored' : zero.err}; 60 ${sixty.ok ? 'stored' : sixty.err}`);
}
{
  const lo = await setCol(D(2), 'lead_time_days = 0');
  const hi = await setCol(D(2), 'lead_time_days = 731');
  const one = await setCol(D(2), 'lead_time_days = 1');
  const top = await setCol(D(2), 'lead_time_days = 730');
  ok('8 the lead time is 1 to 730 calendar days: 0 and 731 are refused, 1 and 730 are stored', !lo.ok && !hi.ok && one.ok && top.ok,
    `0 ${lo.ok ? 'stored' : 'refused'}; 731 ${hi.ok ? 'stored' : 'refused'}; 1 ${one.ok ? 'stored' : one.err}; 730 ${top.ok ? 'stored' : top.err}`);
}
{
  const entry = (i, note = 'by phone') => ({ date: '2026-12-01', previousDate: '2026-11-12', at: `2026-10-09T15:00:${String(i % 60).padStart(2, '0')}.000Z`, source: 'typed', note });
  const obj = await setCol(D(2), 'date_history = $1::jsonb', OWNER, [JSON.stringify({ date: '2026-12-01' })]);
  const twenty = await setCol(D(2), 'date_history = $1::jsonb', OWNER, [JSON.stringify(Array.from({ length: 20 }, (_, i) => entry(i)))]);
  ok('9a the history is an array: an object is refused, 20 entries are stored', !obj.ok && twenty.ok && twenty.n === 1, `object ${obj.ok ? 'stored' : 'refused'}; 20 entries ${twenty.ok ? 'stored' : twenty.err}`);
  const fortyOne = await setCol(D(2), 'date_history = $1::jsonb', OWNER, [JSON.stringify(Array.from({ length: 41 }, (_, i) => ({ at: String(i) })))]);
  const forty = await setCol(D(2), 'date_history = $1::jsonb', OWNER, [JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ at: String(i) })))]);
  ok('9b the history holds at most 40 entries: 41 are refused, 40 are stored', !fortyOne.ok && forty.ok, `41 ${fortyOne.ok ? 'stored' : 'refused'}; 40 ${forty.ok ? 'stored' : forty.err}`);
  const big = await setCol(D(2), 'date_history = $1::jsonb', OWNER, [JSON.stringify(Array.from({ length: 10 }, (_, i) => entry(i, 'x'.repeat(2000))))]);
  ok('9c the history is at most 16,384 bytes: ten entries of 2,000 characters each are refused', !big.ok, big.ok ? 'stored' : 'refused');
}
{
  const empty = await setCol(D(2), "task_id = ''");
  const long = await setCol(D(2), `task_id = '${'t'.repeat(201)}'`);
  const fine = await setCol(D(2), `task_id = '${'t'.repeat(200)}'`);
  const cleared = await setCol(D(2), 'task_id = null');
  ok('10 a task id is 1 to 200 characters or NULL: an empty one and 201 characters are refused, 200 are stored, and it can be cleared',
    !empty.ok && !long.ok && fine.ok && cleared.ok, `'' ${empty.ok ? 'stored' : 'refused'}; 201 ${long.ok ? 'stored' : 'refused'}; 200 ${fine.ok ? 'stored' : fine.err}; null ${cleared.ok ? 'stored' : cleared.err}`);
}

// ── the same people as before ──
{
  const r = await tryRun('authenticated', `select id from public.deliveries where project_id = '${P1}'`, FIELD);
  const u = await setCol(D(3), "task_id = 'task-siding', buffer_days = 2, lead_time_days = 14, ordered_on = '2026-10-01', promised_date = '2026-11-12', task_start_seen = '2026-11-20', date_history = '[]'::jsonb", FIELD);
  const now = (await rows(`select task_id, task_start_seen::text as seen from public.deliveries where id = '${D(3)}'`))[0];
  ok('11 a field seat (who could update a delivery before) reads the job\'s deliveries and writes every new column',
    r.ok && r.n >= 3 && u.ok && u.n === 1 && now?.task_id === 'task-siding' && now?.seen === '2026-11-20', `read ${r.ok ? r.n : r.err}; update ${u.ok ? u.n : u.err}`);
}
{
  const r = await tryRun('authenticated', `select id from public.deliveries where project_id = '${P1}'`, VIEWER);
  const u = await setCol(D(3), "task_id = 'from-viewer'", VIEWER);
  const now = (await rows(`select task_id from public.deliveries where id = '${D(3)}'`))[0];
  ok('12 a viewer reads the job\'s deliveries and changes nothing (0 rows updated)', r.ok && r.n >= 3 && (!u.ok || u.n === 0) && now?.task_id === 'task-siding', `read ${r.ok ? r.n : r.err}; update ${u.ok ? u.n + ' rows' : 'refused'}; task_id ${now?.task_id}`);
}
{
  const r = await tryRun('authenticated', `select id from public.deliveries where project_id = '${P1}'`, STRANGER);
  const u = await setCol(D(3), "task_id = 'from-stranger'", STRANGER);
  const i = await tryRun('authenticated', OLD_INSERT(D(9), STRANGER, P1, "task_id='x'"), STRANGER);
  const now = (await rows(`select task_id from public.deliveries where id = '${D(3)}'`))[0];
  ok('13 a person who is not on the job reads nothing, updates nothing and cannot add a delivery to it', r.ok && r.n === 0 && (!u.ok || u.n === 0) && !i.ok && now?.task_id === 'task-siding',
    `read ${r.ok ? r.n : r.err}; update ${u.ok ? u.n + ' rows' : 'refused'}; insert ${i.ok ? 'ran' : 'refused'}`);
}
{
  const r = await tryRun('anon', 'select id from public.deliveries');
  ok('14 anon reads no delivery', !r.ok || r.n === 0, r.ok ? `${r.n} rows` : 'refused');
}
{
  const policiesAfter = JSON.stringify(await rows(POLICY_SNAPSHOT));
  const grantsAfter = JSON.stringify(await rows(GRANT_SNAPSHOT));
  ok('15 the policies and the table grants are, text for text, what they were before the migration', policiesAfter === policiesBefore && grantsAfter === grantsBefore,
    policiesAfter !== policiesBefore ? 'policies differ' : grantsAfter !== grantsBefore ? 'grants differ' : 'same');
}
{
  const trig = await rows(`select tgname from pg_trigger where tgrelid = 'public.deliveries'::regclass and not tgisinternal`);
  const funcsAfter = (await rows(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`))[0].n;
  const before = (await rows(`select notes, updated_at::text as u from public.deliveries where id = '${D(2)}'`))[0];
  await setCol(D(2), "task_start_seen = '2026-11-30'");
  const after = (await rows(`select notes, updated_at::text as u from public.deliveries where id = '${D(2)}'`))[0];
  ok('16 the migration adds no trigger and no function: nothing acts when a delivery row changes (a write of one column changes that column only)',
    trig.length === 0 && funcsAfter === funcsBefore && before?.notes === after?.notes && before?.u === after?.u, `triggers [${trig.map((t) => t.tgname).join(',')}] functions ${funcsBefore} -> ${funcsAfter}`);
}
{
  const f = await tryRun('authenticated', `delete from public.deliveries where id = '${D(3)}' returning id`, FIELD);
  const o = await tryRun('authenticated', `delete from public.deliveries where id = '${D(3)}' returning id`, OWNER);
  ok('17 only the row\'s owner deletes a delivery, as before', (!f.ok || f.n === 0) && o.ok && o.n === 1, `field ${f.ok ? f.n : 'refused'}; owner ${o.ok ? o.n : o.err}`);
}

done();
