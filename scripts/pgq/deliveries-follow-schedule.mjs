// deliveries-follow-schedule.mjs — PGlite proof of 20261012090000_deliveries_follow_schedule.sql (lane DELIVERIES-1):
// the columns, the checks, the unchanged policies and grants, and the ONE trigger that keeps the record
// (the promise is written once; the history is not shrunk; nothing is refused, nothing else is touched).
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
    15: ['16', '18', '19c', '21'], // the trigger is not created: a set promise is overwritten and the history is nulled
    16: ['19c'],         // the correction need not say what the promise WAS: a stale device's correction lands
    17: ['21'],          // the shrink guard removed: a second device nulls and cuts the history
    18: ['23'],          // the function is made SECURITY DEFINER
    19: ['19b'],         // any last entry that names the new date counts as a correction (the kind is not read)
    20: ['23'],          // EXECUTE is not revoked: anon and authenticated can call the function
    21: ['18', '19a', '22'], // the trigger RAISES instead of keeping the two columns: the rest of a stale write is lost
    22: ['16'],          // the trigger fires on every update, not only one that names the two columns
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
const CREATE_TRIGGER = `create trigger deliveries_fs_keep_record
  before update of promised_date, date_history on public.deliveries
  for each row execute function public.deliveries_fs_keep_record();`;
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
  case 15: rep(CREATE_TRIGGER, ''); noSelfCheck(); break;
  case 16: rep("\n       or (v_last ->> 'previousPromisedDate') is distinct from to_char(old.promised_date, 'YYYY-MM-DD') then", ' then'); break;
  case 17: rep('    new.date_history := old.date_history;', '    null;'); break;
  case 18: rep('security invoker\nset search_path', 'security definer\nset search_path'); noSelfCheck(); break;
  case 19: rep("\n       or (v_last ->> 'kind') is distinct from 'promise_corrected'", ''); break;
  case 20: rep('revoke all on function public.deliveries_fs_keep_record() from public, anon, authenticated;', ''); noSelfCheck(); break;
  case 21: rep('      new.promised_date := old.promised_date;', "      raise exception 'the promised date is written once';"); break;
  case 22: rep('  before update of promised_date, date_history on public.deliveries', '  before update on public.deliveries'); rep("  return new;\nend\n$fn$;", "  new.updated_at := now();\n  return new;\nend\n$fn$;"); noSelfCheck(); break;
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
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
const FUNCS = `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`;
const funcsBefore = (await rows(FUNCS)).map((r) => r.proname);

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
  // 40 entries (not fewer than the row holds, so the trigger does not simply keep the old list) of 500 characters each: about 24 KB.
  const big = await setCol(D(2), 'date_history = $1::jsonb', OWNER, [JSON.stringify(Array.from({ length: 40 }, (_, i) => entry(i, 'x'.repeat(500))))]);
  ok('9c the history is at most 16,384 bytes: forty entries of 500 characters each are refused', !big.ok, big.ok ? 'stored' : 'refused');
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
  const added = (await rows(FUNCS)).map((r) => r.proname).filter((n) => !funcsBefore.includes(n));
  const before = (await rows(`select notes, updated_at::text as u, status, description from public.deliveries where id = '${D(2)}'`))[0];
  await setCol(D(2), "task_start_seen = '2026-11-30'");
  const after = (await rows(`select notes, updated_at::text as u, status, description from public.deliveries where id = '${D(2)}'`))[0];
  ok('16 the migration adds ONE trigger (deliveries_fs_keep_record) and ONE function, and neither acts on a write that names neither of its two columns (a write of one other column changes that column only)',
    eq(trig.map((t) => t.tgname), ['deliveries_fs_keep_record']) && eq(added, ['deliveries_fs_keep_record']) && eq(before, after),
    `triggers [${trig.map((t) => t.tgname).join(',')}] new functions [${added.join(',')}]`);
}
{
  const f = await tryRun('authenticated', `delete from public.deliveries where id = '${D(3)}' returning id`, FIELD);
  const o = await tryRun('authenticated', `delete from public.deliveries where id = '${D(3)}' returning id`, OWNER);
  ok('17 only the row\'s owner deletes a delivery, as before', (!f.ok || f.n === 0) && o.ok && o.n === 1, `field ${f.ok ? f.n : 'refused'}; owner ${o.ok ? o.n : o.err}`);
}

// ── the record is kept: the promise is written once, the history is not shrunk ──
const rec = async (id) => (await rows(`select promised_date::text as promised, date_history as history, status, expected_date::text as expected, notes from public.deliveries where id = '${id}'`))[0];
const E1 = { date: '2026-11-12', previousDate: '', at: '2026-10-06T15:00:00.000Z', source: 'supplier_said', note: 'by phone', by: OWNER };
const E2 = { date: '2026-12-01', previousDate: '2026-11-12', at: '2026-10-09T15:00:00.000Z', source: 'supplier_said', by: OWNER };
const fix = (to, was, extra = {}) => ({ date: '2026-12-01', previousDate: '2026-12-01', at: '2026-10-10T15:00:00.000Z', source: 'typed', by: OWNER, byName: 'Dana Ortiz', kind: 'promise_corrected', promisedDate: to, previousPromisedDate: was, ...extra });
{
  const made = await tryRun('authenticated',
    `insert into public.deliveries (id, user_id, project_id, description, supplier, expected_date, status, created_at, updated_at, task_id, promised_date, date_history)
     values ('${D(5)}', '${OWNER}', '${P1}', 'Entry Doors', 'Northside Glass', '2026-12-01', 'scheduled', now(), now(), 'task-doors', '2026-11-12', $1::jsonb)`, OWNER, [JSON.stringify([E1, E2])]);
  if (!made.ok) { console.error('the fixture row for the record checks could not be written: ' + made.err); process.exit(3); }

  // A second device with an old copy: it writes the supplier date it has, a different promise, and marks the load confirmed.
  const stale = await setCol(D(5), "promised_date = '2026-12-01', status = 'confirmed', notes = 'gate code 4471'");
  const a = await rec(D(5));
  const nulled = await setCol(D(5), 'promised_date = null');
  const b = await rec(D(5));
  ok('18 the promise is written once: an update that sets a different promised_date, or NULL, leaves it as it was, and the REST of that update lands (status, notes)',
    stale.ok && stale.n === 1 && a?.promised === '2026-11-12' && a?.status === 'confirmed' && a?.notes === 'gate code 4471' && nulled.ok && b?.promised === '2026-11-12',
    `different date: ${stale.ok ? `promise ${a?.promised}, status ${a?.status}` : stale.err}; null: ${nulled.ok ? b?.promised : nulled.err}`);

  // A correction is an update whose history ENDS with an entry that says so.
  const noEntry = await setCol(D(5), "promised_date = '2026-11-20', date_history = $1::jsonb", OWNER, [JSON.stringify([E1, E2, { ...E2, at: '2026-10-10T15:00:00.000Z' }])]);
  const afterNoEntry = (await rec(D(5)))?.promised;
  const wrongDate = await setCol(D(5), "promised_date = '2026-11-20', date_history = $1::jsonb", OWNER, [JSON.stringify([E1, E2, fix('2026-11-21', '2026-11-12')])]);
  const afterWrongDate = (await rec(D(5)))?.promised;
  ok('19a a history entry that is not a correction, or a correction that names another date, does not move the promise',
    noEntry.ok && afterNoEntry === '2026-11-12' && wrongDate.ok && afterWrongDate === '2026-11-12', `plain entry: ${afterNoEntry}; wrong date: ${afterWrongDate}`);
  const noKind = await setCol(D(5), "promised_date = '2026-11-20', date_history = $1::jsonb", OWNER, [JSON.stringify([E1, E2, fix('2026-11-20', '2026-11-12', { kind: undefined })])]);
  const afterNoKind = (await rec(D(5)))?.promised;
  ok('19b an entry that names the new date but is not marked as a correction does not move the promise', noKind.ok && afterNoKind === '2026-11-12', `promise ${afterNoKind}`);
  const wrongWas = await setCol(D(5), "promised_date = '2026-11-20', date_history = $1::jsonb", OWNER, [JSON.stringify([E1, E2, fix('2026-11-20', '2026-10-30')])]);
  const afterWrongWas = (await rec(D(5)))?.promised;
  ok('19c a correction that does not say what the promise WAS (a device correcting from an old copy) does not move it', wrongWas.ok && afterWrongWas === '2026-11-12', `promise ${afterWrongWas}`);
  const good = [E1, E2, fix('2026-11-20', '2026-11-12')];
  const corrected = await setCol(D(5), "promised_date = '2026-11-20', date_history = $1::jsonb", OWNER, [JSON.stringify(good)]);
  const c = await rec(D(5));
  ok('20 a correction that says what the promise became and what it was moves it, and the history keeps who made it',
    corrected.ok && corrected.n === 1 && c?.promised === '2026-11-20' && c?.history?.length === 3 && c?.history?.[2]?.kind === 'promise_corrected' && c?.history?.[2]?.by === OWNER && c?.history?.[2]?.byName === 'Dana Ortiz' && c?.history?.[2]?.previousPromisedDate === '2026-11-12',
    corrected.ok ? `promise ${c?.promised}, ${c?.history?.length} entries` : corrected.err);
  // Replaying that same history cannot move it again: the last entry names Nov 20, not the new date.
  const replay = await setCol(D(5), "promised_date = '2026-12-05', date_history = $1::jsonb", OWNER, [JSON.stringify(good)]);
  ok('20b the same correction entry sent again with another date moves nothing', replay.ok && (await rec(D(5)))?.promised === '2026-11-20', `promise ${(await rec(D(5)))?.promised}`);

  const toNull = await setCol(D(5), "date_history = null, status = 'scheduled'");
  const n1 = await rec(D(5));
  const toEmpty = await setCol(D(5), "date_history = '[]'::jsonb");
  const n2 = await rec(D(5));
  const shorter = await setCol(D(5), 'date_history = $1::jsonb', OWNER, [JSON.stringify([E1])]);
  const n3 = await rec(D(5));
  const sameLength = await setCol(D(5), 'date_history = $1::jsonb', OWNER, [JSON.stringify([E2, good[2], { ...E2, date: '2026-12-03', previousDate: '2026-12-01', at: '2026-10-11T15:00:00.000Z' }])]);
  const n4 = await rec(D(5));
  const longer = await setCol(D(5), 'date_history = $1::jsonb', OWNER, [JSON.stringify([...n4.history, { ...E2, date: '2026-12-04', previousDate: '2026-12-03', at: '2026-10-12T15:00:00.000Z' }])]);
  const n5 = await rec(D(5));
  ok('21 the history is not shrunk: NULL, an empty list and a shorter list leave it as it was (and the rest of the update lands); the same length (the app at its cap) and a longer list are stored',
    toNull.ok && n1?.history?.length === 3 && n1?.status === 'scheduled' && toEmpty.ok && n2?.history?.length === 3 && shorter.ok && n3?.history?.length === 3
      && sameLength.ok && n4?.history?.length === 3 && n4?.history?.[2]?.date === '2026-12-03' && longer.ok && n5?.history?.length === 4,
    `null ${n1?.history?.length}; [] ${n2?.history?.length}; shorter ${n3?.history?.length}; same length ${n4?.history?.[2]?.date}; longer ${n5?.history?.length}`);
}
{
  // The first promise is free: a row with none takes one, from the owner and from a field seat.
  const first = await setCol(D(4), "promised_date = '2026-11-12'", FIELD);
  const set = (await rec(D(4)))?.promised;
  // And a field seat's ordinary stale write (old promise, no history) still lands everything else.
  const stale = await setCol(D(5), "promised_date = '2026-11-12', date_history = null, status = 'confirmed', task_start_seen = '2026-12-02'", FIELD);
  const after = (await rows(`select promised_date::text as promised, jsonb_array_length(date_history) as n, status, task_start_seen::text as seen from public.deliveries where id = '${D(5)}'`))[0];
  ok('22 setting the promise for the first time is not held back, and a field seat\'s stale write is not refused: its other columns land and the two kept columns stay',
    first.ok && first.n === 1 && set === '2026-11-12' && stale.ok && stale.n === 1 && after?.promised === '2026-11-20' && after?.n === 4 && after?.status === 'confirmed' && after?.seen === '2026-12-02',
    `first ${first.ok ? set : first.err}; stale ${stale.ok ? JSON.stringify(after) : stale.err}`);
}
{
  const fn = (await rows(`select p.prosecdef as definer, coalesce(array_to_string(p.proconfig, ','), '') as config, p.prosrc as src,
      has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authed, has_function_privilege('public', p.oid, 'execute') as pub
    from pg_proc p where p.oid = to_regprocedure('public.deliveries_fs_keep_record()')`))[0];
  const called = await tryRun('authenticated', 'select public.deliveries_fs_keep_record()', OWNER);
  ok('23 the trigger function is SECURITY INVOKER with an empty search_path, nobody can call it (anon, authenticated, PUBLIC hold no EXECUTE), and its body writes nothing but the two columns of NEW',
    !!fn && fn.definer === false && /search_path=(""|)$/.test(fn.config) && fn.anon === false && fn.authed === false && fn.pub === false && !called.ok
      && !/\b(insert|delete|perform|execute|notify|pg_notify|net\.|http|update\s+public)\b/i.test(fn.src) && (fn.src.match(/new\.[a-z_]+\s*:=/g) ?? []).every((a) => /new\.(promised_date|date_history)\s*:=/.test(a)),
    fn ? `definer ${fn.definer}; config ${fn.config}; execute anon ${fn.anon} authenticated ${fn.authed} public ${fn.pub}; direct call ${called.ok ? 'ran' : 'refused'}` : 'function missing');
}

done();
