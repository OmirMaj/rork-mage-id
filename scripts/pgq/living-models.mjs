// living-models.mjs — PGlite proof of 20261011090000_living_models.sql (lane LIVINGSYNC).
// Usage: [MUTATE=<n>] node scripts/pgq/living-models.mjs <worktree>   (one run)
//        node scripts/pgq/living-models.mjs <worktree> --all            (as written + every planted mutation)
// A plant softens the migration's own self-check to a notice where it would catch the plant at
// apply time, so the CASES below are what must go red.
//
// REAL: the migration, and public.can_access_project(uuid, text) cut out of
// 20260826130000_field_role.sql at run time (a missing anchor stops the proof).
// STUBS: the roles, auth.users, auth.uid(), and small versions of public.projects and
// public.project_collaborators holding only the columns can_access_project reads.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BASE_SQL, loadPGlite, makeKit, readMigration, replacer, runAll, worktreeArg } from './_harness.mjs';

const ROOT = worktreeArg('scripts/pgq/living-models.mjs');
const FILE = '20261011090000_living_models.sql';

if (process.argv[3] === '--all') {
  runAll(import.meta.url, ROOT, {
    1: ['11'],           // the client revoke removed: a signed-in account writes the table directly
    2: ['8'],            // row level security never switched on: a stranger reads the model
    3: ['8'],            // the read policy is `true`
    4: ['6', '7'],       // the writer asks for any seat, not the schedule-edit seat: a viewer and a field seat save
    5: ['8'],            // the permission check removed: a stranger saves
    6: ['12', '13'],     // the stale check removed: a save based on an old revision lands
    7: ['15'],           // the size cap removed (the function's and the table's)
    8: ['16'],           // the project foreign key does not cascade
    9: ['10'],           // anon may call the save function
    10: ['17'],          // the save function is not SECURITY DEFINER
    11: ['17'],          // the save function's search_path is public
    12: ['18'],          // updated_at is taken from the model the caller sent
    13: ['14', '25'],    // both replay rules removed: the same save sent twice is called stale
    14: ['22'],          // the author is taken from a caller-shaped setting, not auth.uid()
    15: ['20'],          // the newer-schema rule removed: an old build writes over a newer model
    16: ['6', '7'],      // the read policy asks for the edit seat: a viewer and a field seat read nothing
    17: ['4'],           // the revision does not go up
    18: ['21'],          // deleting the last editor's account deletes the row (set null became cascade)
    19: ['23'],          // lower() removed: a job id written in capitals is refused
    20: ['24'],          // the room and part limits removed (the function's and the table's)
    21: ['25'],          // the row forgets its recent saves: a save that landed and was saved over is called stale
    22: ['25'],          // the replay of an earlier save answers with the head's revision, not the one it landed at
    23: ['26'],          // the remove function asks for any seat: a viewer and a field seat delete the account copy
    24: ['26'],          // the remove function's permission check removed: a stranger deletes it
    25: ['26'],          // anon may call the remove function
    26: ['27'],          // a job whose copy was removed starts again at revision 1
    27: ['28'],          // clients may read and write the removals table
    28: ['27'],          // removing leaves no line behind
    29: ['26'],          // the remove function deletes every row
  });
}

let MIG = readMigration(ROOT, FILE);
const MUTATE = Number(process.env.MUTATE || 0);
const rep = replacer(() => MIG, (v) => { MIG = v; }, MUTATE);
const noSelfCheck = () => rep("raise exception '[living_models] verify:", "raise notice '[living_models] verify:", true);
const SIG = 'uuid, jsonb, integer, uuid, integer';
const DEFINER = "language plpgsql\nsecurity definer\nset search_path to ''\nas $function$\ndeclare\n  v_uid uuid";
switch (MUTATE) {
  case 0: break;
  case 1: rep('revoke all on public.living_models from public, anon, authenticated;\ngrant select on public.living_models to authenticated;', ''); noSelfCheck(); break;
  case 2: rep('alter table public.living_models enable row level security;', ''); noSelfCheck(); break;
  case 3: rep('using (public.can_access_project(project_id));', 'using (true);'); break;
  case 4: rep("if not public.can_access_project(p_project_id, 'editor') then", 'if not public.can_access_project(p_project_id) then'); break;
  case 5: rep("if not public.can_access_project(p_project_id, 'editor') then", 'if false then'); break;
  case 6: rep('if v_row.revision <> p_base_revision then', 'if false then'); rep("    if v_row.project_id is null then\n      return pg_catalog.jsonb_build_object('saved', false, 'code', 'stale_revision', 'revision', 0);\n    end if;", ''); break;
  case 7:
    rep('if pg_catalog.octet_length(p_model::text) > 3145728 then', 'if false then');
    rep('  constraint living_models_model_size_check   check (octet_length(model::text) <= 3145728),\n', '');
    noSelfCheck();
    break;
  case 8: rep('uuid primary key references public.projects(id) on delete cascade,', 'uuid primary key references public.projects(id),'); noSelfCheck(); break;
  case 9: rep(`revoke all on function public.living_model_save(${SIG}) from public, anon;`, ''); noSelfCheck(); break;
  case 10: rep(DEFINER, "language plpgsql\nset search_path to ''\nas $function$\ndeclare\n  v_uid uuid"); noSelfCheck(); break;
  case 11: rep(DEFINER, 'language plpgsql\nsecurity definer\nset search_path to public\nas $function$\ndeclare\n  v_uid uuid'); noSelfCheck(); break;
  case 12:
    rep("         updated_at = pg_catalog.clock_timestamp(),", "         updated_at = coalesce((p_model ->> 'updatedAt')::timestamptz, pg_catalog.clock_timestamp()),");
    rep("         pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), v_uid)", "         pg_catalog.clock_timestamp(), coalesce((p_model ->> 'updatedAt')::timestamptz, pg_catalog.clock_timestamp()), v_uid)");
    break;
  case 13: rep('if v_row.last_write_id = p_write_id and v_row.updated_by is not distinct from v_uid then', 'if false then'); rep('if v_hit is not null then', 'if false then'); break;
  case 14: rep('v_uid uuid := auth.uid();', "v_uid uuid := coalesce(nullif(current_setting('request.claimed_user', true), '')::uuid, auth.uid());"); break;
  case 15: rep('if p_schema_version < v_row.schema_version then', 'if false then'); break;
  case 16: rep('using (public.can_access_project(project_id));', "using (public.can_access_project(project_id, 'editor'));"); break;
  case 17: rep('         revision = m.revision + 1,', '         revision = m.revision,'); break;
  case 18: rep('updated_by     uuid references auth.users(id) on delete set null,', 'updated_by     uuid references auth.users(id) on delete cascade,'); break;
  case 19:
    rep("or pg_catalog.lower(p_model ->> 'projectId') is distinct from pg_catalog.lower(p_project_id::text)", "or (p_model ->> 'projectId') is distinct from p_project_id::text");
    rep("check (lower(model ->> 'projectId') = lower(project_id::text))", "check ((model ->> 'projectId') = project_id::text)");
    break;
  case 20:
    rep("if pg_catalog.jsonb_array_length(p_model -> 'rooms') > 60 then", 'if false then');
    rep("pg_catalog.jsonb_array_length(v_room -> 'room' -> 'walls') > 200 then", "pg_catalog.jsonb_array_length(v_room -> 'room' -> 'walls') > 200000 then");
    rep("pg_catalog.jsonb_array_length(v_room -> 'room' -> 'openings') > 400 then", "pg_catalog.jsonb_array_length(v_room -> 'room' -> 'openings') > 400000 then");
    rep("pg_catalog.jsonb_array_length(v_room -> 'room' -> 'objects') > 400 then", "pg_catalog.jsonb_array_length(v_room -> 'room' -> 'objects') > 400000 then");
    rep(" and jsonb_array_length(model -> 'rooms') <= 60),", '),');
    break;
  case 21: rep('         recent_writes = v_recent,\n', ''); break;
  case 22: rep("'revision', (v_hit ->> 'r')::integer, 'updated_at', v_row.updated_at, 'replay', true,", "'revision', v_row.revision, 'updated_at', v_row.updated_at, 'replay', true,"); break;
  case 23: rep("if not public.can_access_project(p_project_id, 'editor') then\n    raise exception 'living_model_remove:", "if not public.can_access_project(p_project_id) then\n    raise exception 'living_model_remove:"); break;
  case 24: rep("if not public.can_access_project(p_project_id, 'editor') then\n    raise exception 'living_model_remove:", "if false then\n    raise exception 'living_model_remove:"); break;
  case 25: rep('revoke all on function public.living_model_remove(uuid) from public, anon;', ''); noSelfCheck(); break;
  case 26: rep("select coalesce((select x.last_revision from public.living_model_removals x where x.project_id = p_project_id), 0) + 1 into v_start;", 'v_start := 1;'); break;
  case 27: rep('revoke all on public.living_model_removals from public, anon, authenticated;', ''); noSelfCheck(); break;
  case 28: rep("  insert into public.living_model_removals (project_id, last_revision, removed_at, removed_by)\n  values (p_project_id, v_rev, pg_catalog.clock_timestamp(), v_uid)\n  on conflict (project_id) do update\n    set last_revision = greatest(public.living_model_removals.last_revision, excluded.last_revision),\n        removed_at = excluded.removed_at,\n        removed_by = excluded.removed_by;\n", ''); break;
  case 29: rep('delete from public.living_models m where m.project_id = p_project_id returning m.revision into v_rev;', 'delete from public.living_models m where m.project_id = p_project_id returning m.revision into v_rev;\n  delete from public.living_models;'); break;
  default: console.error('unknown MUTATE'); process.exit(2);
}
if (MUTATE) console.log(`(planted mutation M${MUTATE} applied)`);

// The real access rule, cut out of the file that defines it.
const FIELD_ROLE = readFileSync(path.join(ROOT, 'supabase/migrations/20260826130000_field_role.sql'), 'utf8');
const START = "create or replace function public.can_access_project(pid uuid, min_role text default 'viewer')";
const at = FIELD_ROLE.indexOf(START);
const end = at < 0 ? -1 : FIELD_ROLE.indexOf('$$;', at);
if (at < 0 || end < 0) { console.error('anchor not found: can_access_project(uuid, text) in 20260826130000_field_role.sql'); process.exit(3); }
const CAN_ACCESS = FIELD_ROLE.slice(at, end + 3);
if (!CAN_ACCESS.includes("when 'editor' then pc.role in ('owner','editor')")) { console.error('can_access_project no longer has the editor tier this proof names'); process.exit(3); }

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const EDITOR = '00000000-0000-4000-8000-0000000000b2';
const VIEWER = '00000000-0000-4000-8000-0000000000c3';
const FIELD = '00000000-0000-4000-8000-0000000000d4';
const STRANGER = '00000000-0000-4000-8000-0000000000e5';
const PENDING = '00000000-0000-4000-8000-0000000000f6';
const REVOKED = '00000000-0000-4000-8000-000000000a07';
const P1 = '10000000-0000-4000-8000-000000000001';
const P2 = '10000000-0000-4000-8000-000000000002';   // the stranger's own job
const GHOST = '10000000-0000-4000-8000-00000000dead';   // no such project
const P3 = '10000000-0000-4000-8000-0000000000c3';      // the job of the later cases (ids with letters, for the capitals case)
const P4 = '10000000-0000-4000-8000-0000000000d4';      // a second job of the owner's, to show a removal takes one row only
const W = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const PGlite = await loadPGlite();
const db = new PGlite();
await db.exec(BASE_SQL);
await db.exec(`
insert into auth.users (id, email) values
  ('${OWNER}', 'owner@x.test'), ('${EDITOR}', 'editor@x.test'), ('${VIEWER}', 'viewer@x.test'), ('${FIELD}', 'field@x.test'),
  ('${STRANGER}', 'stranger@x.test'), ('${PENDING}', 'pending@x.test'), ('${REVOKED}', 'revoked@x.test');
create table public.projects (id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, name text);
create table public.project_collaborators (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null, status text not null);
insert into public.projects (id, user_id, name) values ('${P1}', '${OWNER}', 'Job one'), ('${P2}', '${STRANGER}', 'Another firm'), ('${P3}', '${OWNER}', 'Job three'), ('${P4}', '${OWNER}', 'Job four');
insert into public.project_collaborators (project_id, user_id, role, status) values
  ('${P1}', '${EDITOR}', 'editor', 'accepted'), ('${P1}', '${VIEWER}', 'viewer', 'accepted'), ('${P1}', '${FIELD}', 'field', 'accepted'),
  ('${P1}', '${PENDING}', 'editor', 'pending'), ('${P1}', '${REVOKED}', 'editor', 'revoked'),
  ('${P3}', '${EDITOR}', 'editor', 'accepted'), ('${P3}', '${VIEWER}', 'viewer', 'accepted'), ('${P3}', '${FIELD}', 'field', 'accepted');
${CAN_ACCESS}
revoke all on function public.can_access_project(uuid, text) from public, anon;
grant execute on function public.can_access_project(uuid, text) to authenticated, service_role;
`);
const { ok, rows, tryRun, done } = makeKit(db);

let applyErr = null;
try { await db.exec(MIG); await db.exec(MIG); } catch (e) { applyErr = e; }
ok('1 the migration applies cleanly, twice (idempotent)', applyErr === null, applyErr ? String(applyErr.message) : '');
if (applyErr) done();

const model = (project, extra = {}) => JSON.stringify({ version: 1, projectId: project, rooms: [], links: {}, updatedAt: '2001-01-01T00:00:00.000Z', ...extra });
const SAVE = 'select public.living_model_save($1::uuid, $2::jsonb, $3::integer, $4::uuid, $5::integer) as r';
const save = (uid, project, base, writeId, body = model(project), schema = 1, role = 'authenticated') => tryRun(role, SAVE, uid, [project, body, base, writeId, schema]);
const theRow = async (project = P1) => (await rows(`select * from public.living_models where project_id = '${project}'`))[0] ?? null;
const READ = `select revision from public.living_models where project_id = '${P1}'`;
const verdict = (r) => (r.ok ? r.rows[0].r : null);

const cols = (await rows(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'living_models' order by ordinal_position`)).map((r) => r.column_name);
const WANT = ['project_id', 'owner_id', 'model', 'schema_version', 'revision', 'last_write_id', 'recent_writes', 'created_at', 'updated_at', 'updated_by'];
ok('2 the columns are exactly the list in the header', JSON.stringify(cols) === JSON.stringify(WANT), cols.join(','));

// ── the owner ──
const before = (await rows('select clock_timestamp() as t'))[0].t;
const o1 = await save(OWNER, P1, 0, W(1), model(P1, { rooms: [{ id: 'r1' }] }));
const after = (await rows('select clock_timestamp() as t'))[0].t;
const row1 = await theRow();
ok('3 the owner saves the first model: revision 1, owner_id and updated_by are his',
  verdict(o1)?.saved === true && verdict(o1)?.revision === 1 && row1?.owner_id === OWNER && row1?.updated_by === OWNER && row1?.revision === 1 && row1?.last_write_id === W(1),
  o1.err ?? JSON.stringify(verdict(o1)));
const o2 = await save(OWNER, P1, 1, W(2));
const row2 = await theRow();
ok('4 a save based on the current revision lands and the revision goes up by one', verdict(o2)?.saved === true && verdict(o2)?.revision === 2 && row2?.revision === 2, o2.err ?? JSON.stringify(verdict(o2)));

// ── a collaborator who may edit the schedule ──
const e1 = await save(EDITOR, P1, 2, W(3), model(P1, { rooms: [{ id: 'from-editor' }] }));
const row3 = await theRow();
const eRead = await tryRun('authenticated', READ, EDITOR);
ok('5 an accepted editor reads and saves; the row stays the project owner\'s and names him as the author',
  verdict(e1)?.saved === true && row3?.revision === 3 && row3?.updated_by === EDITOR && row3?.owner_id === OWNER && eRead.ok && eRead.n === 1,
  e1.err ?? JSON.stringify(verdict(e1)));

// ── seats that may see the schedule and not edit it ──
for (const [n, who, uid] of [['6', 'a viewer', VIEWER], ['7', 'a field seat', FIELD]]) {
  const r = await tryRun('authenticated', READ, uid);
  const s = await save(uid, P1, 3, W(40 + Number(n)), model(P1, { rooms: [{ id: `from-${n}` }] }));
  const now = await theRow();
  ok(`${n} ${who} reads the model and cannot save it (42501, nothing written)`,
    r.ok && r.n === 1 && !s.ok && /permission denied/.test(s.err ?? '') && now?.revision === 3 && now?.updated_by === EDITOR,
    `read ${r.ok ? r.n : r.err}; save ${s.ok ? JSON.stringify(verdict(s)) : s.err}`);
}

// ── people who are not on the job ──
{
  const r = await tryRun('authenticated', READ, STRANGER);
  const s = await save(STRANGER, P1, 3, W(50), model(P1, { rooms: [{ id: 'stranger' }] }));
  const own = await save(STRANGER, P2, 0, W(51), model(P2));
  const now = await theRow();
  ok('8 a stranger reads nothing and cannot save (and still saves a model on his own job)',
    r.ok && r.n === 0 && !s.ok && /permission denied/.test(s.err ?? '') && now?.revision === 3 && now?.updated_by === EDITOR && verdict(own)?.saved === true,
    `read ${r.ok ? r.n : r.err}; save ${s.ok ? JSON.stringify(verdict(s)) : s.err}; own ${own.err ?? JSON.stringify(verdict(own))}`);
  let bad = [];
  for (const [who, uid] of [['an invited editor who has not accepted', PENDING], ['a revoked editor', REVOKED]]) {
    const pr = await tryRun('authenticated', READ, uid);
    const ps = await save(uid, P1, 3, W(52), model(P1));
    if (!(pr.ok && pr.n === 0 && !ps.ok && /permission denied/.test(ps.err ?? ''))) bad.push(who);
  }
  ok('9 an invited editor who has not accepted, and a revoked one, read nothing and cannot save', bad.length === 0, bad.join('; '));
}

// ── anon ──
{
  const privs = (await rows(`select ${['select', 'insert', 'update', 'delete', 'truncate'].map((p) => `has_table_privilege('anon', 'public.living_models', '${p}') as ${p}`).join(', ')}`))[0];
  const sel = await tryRun('anon', 'select * from public.living_models');
  const call = await save('', P1, 3, W(60), model(P1), 1, 'anon');
  const fn = (await rows(`select has_function_privilege('anon', 'public.living_model_save(${SIG})', 'execute') as x`))[0].x;
  const now = await theRow();
  ok('10 anon holds nothing: no table privilege, no read, no call',
    Object.values(privs).every((v) => v === false) && !sel.ok && !call.ok && fn === false && now?.revision === 3,
    `${JSON.stringify(privs)} select ${sel.ok ? 'ran' : 'refused'} call ${call.ok ? JSON.stringify(verdict(call)) : 'refused'} execute ${fn}`);
}

// ── no client writes the table directly, not even the owner ──
{
  const ins = await tryRun('authenticated', `insert into public.living_models (project_id, owner_id, model, last_write_id) values ('${P2}', '${STRANGER}', '${model(P2)}'::jsonb, '${W(70)}') on conflict (project_id) do update set revision = 99`, STRANGER);
  const upd = await tryRun('authenticated', `update public.living_models set revision = 99, updated_by = '${STRANGER}' where project_id = '${P1}'`, OWNER);
  const del = await tryRun('authenticated', `delete from public.living_models where project_id = '${P1}'`, OWNER);
  const now = await theRow();
  ok('11 a signed-in account cannot insert, update or delete the table directly (the owner included)',
    !ins.ok && !upd.ok && !del.ok && now?.revision === 3,
    `insert ${ins.ok ? 'ran' : 'refused'} update ${upd.ok ? 'ran' : 'refused'} delete ${del.ok ? 'ran' : 'refused'} revision ${now?.revision}`);
}

// ── one save at a time ──
{
  const stale = await save(OWNER, P1, 1, W(80), model(P1, { rooms: [{ id: 'stale' }] }));
  const now = await theRow();
  ok('12 a save based on an older revision is refused with code stale_revision and nothing is written',
    verdict(stale)?.saved === false && verdict(stale)?.code === 'stale_revision' && verdict(stale)?.revision === 3 && now?.revision === 3 && now?.last_write_id === W(3) && JSON.stringify(now?.model?.rooms) === JSON.stringify([{ id: 'from-editor' }]),
    stale.err ?? JSON.stringify(verdict(stale)));
  const fresh = await save(OWNER, P1, 0, W(81), model(P1, { rooms: [{ id: 'thought-there-was-none' }] }));
  const ahead = await save(OWNER, P1, 9, W(82), model(P1));
  const none = await save(OWNER, GHOST, 0, W(83), model(GHOST));
  await db.exec(`insert into public.projects (id, user_id, name) values ('${GHOST}', '${OWNER}', 'Late job')`);
  const noRow = await save(OWNER, GHOST, 4, W(84), model(GHOST));
  const ghostRow = await theRow(GHOST);
  const now2 = await theRow();
  ok('13 "I saw no row" against a row that exists, a revision from the future, and a base revision with no row are all refused; a project that does not exist answers like one that is not his',
    verdict(fresh)?.code === 'stale_revision' && verdict(ahead)?.code === 'stale_revision' && now2?.revision === 3
      && !none.ok && /permission denied/.test(none.err ?? '')
      && verdict(noRow)?.saved === false && verdict(noRow)?.code === 'stale_revision' && verdict(noRow)?.revision === 0 && ghostRow === null,
    `${fresh.err ?? JSON.stringify(verdict(fresh))} | ${ahead.err ?? JSON.stringify(verdict(ahead))} | ${none.ok ? JSON.stringify(verdict(none)) : none.err} | ${noRow.err ?? JSON.stringify(verdict(noRow))}`);
  const again = await save(EDITOR, P1, 2, W(3), model(P1, { rooms: [{ id: 'from-editor' }] }));
  const now3 = await theRow();
  ok('14 the same save sent twice answers saved (replay) and writes nothing', verdict(again)?.saved === true && verdict(again)?.replay === true && verdict(again)?.revision === 3 && now3?.revision === 3, again.err ?? JSON.stringify(verdict(again)));
}

// ── the cap ──
{
  const big = model(P1, { rooms: [{ id: 'big', pad: 'x'.repeat(3_200_000) }] });
  const s = await save(OWNER, P1, 3, W(90), big);
  const now = await theRow();
  let direct = null;
  try { await db.query(`update public.living_models set model = $1::jsonb where project_id = '${P1}'`, [big]); direct = 'ran'; } catch (e) { direct = String(e.message); }
  const under = await save(OWNER, P1, 3, W(91), model(P1, { rooms: [{ id: 'ok', pad: 'x'.repeat(1_600_000) }] }));
  ok('15 a model over 3 MiB is refused with code too_large and nothing is written; the table itself refuses one too; a 1.6 MB model saves',
    verdict(s)?.saved === false && verdict(s)?.code === 'too_large' && now?.revision === 3 && /living_models_model_size_check/.test(direct ?? '') && verdict(under)?.saved === true && verdict(under)?.revision === 4,
    `${s.err ?? JSON.stringify(verdict(s))} | direct: ${String(direct).slice(0, 80)} | under: ${under.err ?? JSON.stringify(verdict(under))}`);
}

// ── the function itself ──
{
  const f = (await rows(`select prosecdef, proconfig from pg_proc where oid = 'public.living_model_save(${SIG})'::regprocedure`))[0];
  const probe = await save(OWNER, P1, 4, W(100), model(P1, { rooms: [{ id: 'after-cap' }] }));
  ok('17 the save function is SECURITY DEFINER with an empty search_path, and saves for a caller who holds no write privilege',
    f?.prosecdef === true && JSON.stringify(f?.proconfig) === JSON.stringify(['search_path=""']) && verdict(probe)?.saved === true && verdict(probe)?.revision === 5,
    `${JSON.stringify(f)} ${probe.err ?? JSON.stringify(verdict(probe))}`);
  const row = await theRow();
  const t = new Date(row?.updated_at ?? 0).getTime();
  ok('18 updated_at is the server clock, not the time inside the model (2001) and not the first save\'s',
    t > new Date(after).getTime() && new Date(row1.updated_at).getTime() >= new Date(before).getTime() && new Date(row1.updated_at).getTime() <= new Date(after).getTime() && new Date(row?.created_at).getTime() === new Date(row1.created_at).getTime(),
    `updated_at ${row?.updated_at}`);
  const wrong = await save(OWNER, P1, 5, W(101), model(P2));
  const notObj = await save(OWNER, P1, 5, W(102), '[1,2]');
  const noRooms = await save(OWNER, P1, 5, W(103), JSON.stringify({ version: 1, projectId: P1 }));
  const now = await theRow();
  ok('19 a model for another project, a model that is not an object and a model with no rooms array are refused',
    !wrong.ok && !notObj.ok && !noRooms.ok && now?.revision === 5,
    `${wrong.ok ? 'ran' : 'refused'} ${notObj.ok ? 'ran' : 'refused'} ${noRooms.ok ? 'ran' : 'refused'}`);
  await db.exec(`update public.living_models set schema_version = 2 where project_id = '${P1}'`);
  const old = await save(OWNER, P1, 5, W(104), model(P1, { rooms: [{ id: 'old-build' }] }), 1);
  const mid = await theRow();
  const newer = await save(OWNER, P1, 5, W(105), model(P1, { rooms: [{ id: 'new-build' }] }), 2);
  ok('20 a build with an older schema version is refused with code newer_schema; the same version saves',
    verdict(old)?.saved === false && verdict(old)?.code === 'newer_schema' && mid?.revision === 5 && verdict(newer)?.saved === true && verdict(newer)?.revision === 6,
    `${old.err ?? JSON.stringify(verdict(old))} | ${newer.err ?? JSON.stringify(verdict(newer))}`);
  await db.query(`select set_config('request.claimed_user', $1, false)`, [STRANGER]);
  const claim = await save(EDITOR, P1, 6, W(106), model(P1, { updatedBy: STRANGER, owner_id: STRANGER }), 2);
  await db.query(`select set_config('request.claimed_user', '', false)`);
  const now2 = await theRow();
  ok('22 the author is auth.uid(): nothing the caller sends names anyone else', verdict(claim)?.saved === true && now2?.updated_by === EDITOR && now2?.owner_id === OWNER, `${claim.err ?? JSON.stringify(verdict(claim))} by ${now2?.updated_by}`);
}

// ── a job id in capitals ──
{
  const UP = P3.toUpperCase();
  const s = await save(OWNER, P3, 0, W(200), JSON.stringify({ version: 1, projectId: UP, rooms: [{ id: 'caps' }], links: {}, updatedAt: '' }));
  const row = await theRow(P3);
  const other = await save(OWNER, P3, row?.revision ?? 1, W(201), JSON.stringify({ version: 1, projectId: P2.toUpperCase(), rooms: [], links: {}, updatedAt: '' }));
  ok('23 a model whose job id is written in capitals is this job\'s model (lower() on both sides), and another job\'s id in capitals is still refused',
    verdict(s)?.saved === true && row?.model?.projectId === UP && !other.ok,
    `${s.err ?? JSON.stringify(verdict(s))} | other ${other.ok ? 'ran' : 'refused'}`);
}

// ── no more than the app makes ──
{
  const at = (await theRow(P3))?.revision ?? 0;
  const room = (id, parts = {}) => ({ id, room: { walls: [], openings: [], objects: [], ...parts } });
  const many = (n) => Array.from({ length: n }, (_, i) => ({ id: `x${i}` }));
  const r61 = await save(OWNER, P3, at, W(210), model(P3, { rooms: Array.from({ length: 61 }, (_, i) => room(`r${i}`)) }));
  const walls = await save(OWNER, P3, at, W(211), model(P3, { rooms: [room('a', { walls: many(201) })] }));
  const openings = await save(OWNER, P3, at, W(212), model(P3, { rooms: [room('a', { openings: many(401) })] }));
  const objects = await save(OWNER, P3, at, W(213), model(P3, { rooms: [room('a', { objects: many(401) })] }));
  const mid = await theRow(P3);
  let direct = null;
  try { await db.query(`update public.living_models set model = $1::jsonb where project_id = '${P3}'`, [model(P3, { rooms: Array.from({ length: 61 }, (_, i) => room(`r${i}`)) })]); direct = 'ran'; } catch (e) { direct = String(e.message); }
  const full = await save(OWNER, P3, at, W(214), model(P3, { rooms: Array.from({ length: 60 }, (_, i) => room(`r${i}`, { walls: many(i === 0 ? 200 : 4), openings: many(i === 0 ? 400 : 1), objects: many(i === 0 ? 400 : 0) })) }));
  const codes = [r61, walls, openings, objects].map((x) => `${verdict(x)?.saved}/${verdict(x)?.code}/${verdict(x)?.what}`);
  ok('24 61 rooms, 201 walls, 401 doors and windows and 401 fixtures in a room are refused with code out_of_bounds and nothing is written; the table refuses 61 rooms too; 60 rooms at the limits save',
    codes.join() === 'false/out_of_bounds/rooms,false/out_of_bounds/walls,false/out_of_bounds/openings,false/out_of_bounds/objects'
      && mid?.revision === at && /living_models_model_rooms_check/.test(direct ?? '') && verdict(full)?.saved === true && verdict(full)?.revision === at + 1,
    `${codes.join(' ')} | direct: ${String(direct).slice(0, 70)} | full: ${full.err ?? JSON.stringify(verdict(full))}`);
}

// ── the revision a save landed at, and a save that was saved over ──
{
  const at = (await theRow(P3))?.revision ?? 0;
  const mine = await save(OWNER, P3, at, W(220), model(P3, { rooms: [{ id: 'mine' }] }));
  const theirs = await save(EDITOR, P3, at + 1, W(221), model(P3, { rooms: [{ id: 'theirs' }] }));
  const again = await save(OWNER, P3, at, W(220), model(P3, { rooms: [{ id: 'mine' }] }));
  const notMine = await save(VIEWER, P3, at, W(220), model(P3, { rooms: [{ id: 'mine' }] }));
  const asEditor = await save(EDITOR, P3, at, W(220), model(P3, { rooms: [{ id: 'mine' }] }));
  const row = await theRow(P3);
  const recent = Array.isArray(row?.recent_writes) ? row.recent_writes : [];
  const last2 = recent.slice(-2).map((x) => `${x.w}@${x.r}`).join(',');
  for (let i = 0; i < 9; i++) await save(OWNER, P3, at + 2 + i, W(230 + i), model(P3, { rooms: [{ id: `n${i}` }] }));
  const later = await theRow(P3);
  ok('25 a save answers with the revision it landed at; sent again after a teammate saved on top it answers saved (replay) with THAT revision and writes nothing; another account sending the same id is stale; the row keeps its last 8 saves',
    verdict(mine)?.saved === true && verdict(mine)?.revision === at + 1 && verdict(theirs)?.revision === at + 2
      && verdict(again)?.saved === true && verdict(again)?.replay === true && verdict(again)?.revision === at + 1 && verdict(again)?.head_revision === at + 2
      && !notMine.ok && verdict(asEditor)?.saved === false && verdict(asEditor)?.code === 'stale_revision'
      && row?.revision === at + 2 && JSON.stringify(row?.model?.rooms) === JSON.stringify([{ id: 'theirs' }])
      && last2 === `${W(220)}@${at + 1},${W(221)}@${at + 2}` && later?.recent_writes?.length === 8 && later.recent_writes[7].r === later.revision && later.recent_writes[7].w === later.last_write_id,
    `${again.err ?? JSON.stringify(verdict(again))} | editor ${asEditor.err ?? JSON.stringify(verdict(asEditor))} | recent ${last2} | kept ${later?.recent_writes?.length}`);
}

// ── removing the account copy ──
{
  const REMOVE = 'select public.living_model_remove($1::uuid) as r';
  const remove = (uid, project, role = 'authenticated') => tryRun(role, REMOVE, uid, [project]);
  await save(OWNER, P4, 0, W(300), model(P4, { rooms: [{ id: 'job-four' }] }));
  const before = await theRow(P3);
  const refused = [];
  for (const [who, uid] of [['a viewer', VIEWER], ['a field seat', FIELD], ['a stranger', STRANGER], ['an invited editor who has not accepted', PENDING]]) {
    const r = await remove(uid, P3);
    if (r.ok || !/permission denied/.test(r.err ?? '')) refused.push(who);
  }
  const anon = await remove('', P3, 'anon');
  const anonFn = (await rows(`select has_function_privilege('anon', 'public.living_model_remove(uuid)', 'execute') as x`))[0].x;
  const ghost = await remove(OWNER, GHOST.replace('dead', 'beef'));
  const still = await theRow(P3);
  const gone = await remove(EDITOR, P3);
  const after = await theRow(P3);
  const others = [await theRow(P2), await theRow(P4)];
  const twice = await remove(OWNER, P3);
  const f = (await rows(`select prosecdef, proconfig from pg_proc where oid = 'public.living_model_remove(uuid)'::regprocedure`))[0];
  ok('26 only the owner and editors remove the account copy: a viewer, a field seat, a stranger, an editor who has not accepted and anon are refused and nothing is deleted; an editor removes this job\'s row and no other; removing again answers removed:false',
    refused.length === 0 && !anon.ok && anonFn === false && !ghost.ok && still?.revision === before?.revision
      && verdict(gone)?.removed === true && verdict(gone)?.revision === before?.revision && after === null && others.every((x) => x !== null)
      && verdict(twice)?.removed === false && f?.prosecdef === true && JSON.stringify(f?.proconfig) === JSON.stringify(['search_path=""']),
    `refused wrongly: ${refused.join('; ') || 'none'} | anon ${anon.ok ? 'ran' : 'refused'} | gone ${gone.err ?? JSON.stringify(verdict(gone))} | row ${after ? 'still there' : 'gone'} | others ${others.map((x) => (x ? 'kept' : 'gone')).join(',')} | twice ${twice.err ?? JSON.stringify(verdict(twice))}`);

  const line = (await rows(`select last_revision, removed_by from public.living_model_removals where project_id = '${P3}'`))[0] ?? null;
  const stale = await save(OWNER, P3, before.revision, W(301), model(P3, { rooms: [{ id: 'late-save' }] }));
  const none = await theRow(P3);
  const fresh = await save(OWNER, P3, 0, W(302), model(P3, { rooms: [{ id: 'saved-again' }] }));
  const row = await theRow(P3);
  ok('27 a removal leaves a line (who, the revision reached) and no model; a save still on its way, based on the old revision, is refused and makes no row; the next first save starts ABOVE the old revision',
    line?.last_revision === before.revision && line?.removed_by === EDITOR
      && verdict(stale)?.saved === false && verdict(stale)?.code === 'stale_revision' && none === null
      && verdict(fresh)?.saved === true && verdict(fresh)?.revision === before.revision + 1 && row?.revision === before.revision + 1 && row?.recent_writes?.length === 1,
    `line ${JSON.stringify(line)} | stale ${stale.err ?? JSON.stringify(verdict(stale))} | fresh ${fresh.err ?? JSON.stringify(verdict(fresh))}`);

  const sel = await tryRun('authenticated', 'select * from public.living_model_removals', OWNER);
  const ins = await tryRun('authenticated', `insert into public.living_model_removals (project_id, last_revision) values ('${P4}', 99)`, OWNER);
  const del = await tryRun('authenticated', 'delete from public.living_model_removals', OWNER);
  const anonSel = await tryRun('anon', 'select * from public.living_model_removals');
  ok('28 no client reads or writes the removals table', !sel.ok && !ins.ok && !del.ok && !anonSel.ok, `select ${sel.ok ? 'ran' : 'refused'} insert ${ins.ok ? 'ran' : 'refused'} delete ${del.ok ? 'ran' : 'refused'} anon ${anonSel.ok ? 'ran' : 'refused'}`);
}

// ── deletions ──
{
  await db.exec(`delete from auth.users where id = '${EDITOR}'`);
  const now = await theRow();
  ok('21 deleting the account of the editor who saved last keeps the row, with updated_by NULL', now !== null && now.updated_by === null && now.revision === 7 && now.owner_id === OWNER, JSON.stringify(now && { by: now.updated_by, rev: now.revision }));
  let delErr = null;
  try { await db.exec(`delete from public.projects where id = '${P1}'`); } catch (e) { delErr = String(e.message); }
  const gone = await theRow();
  const other = await theRow(P2);
  ok('16 deleting the project deletes its model, and only its own', delErr === null && gone === null && other !== null, delErr ?? `row ${gone ? 'still there' : 'gone'}; other ${other ? 'kept' : 'gone'}`);
}

done();
