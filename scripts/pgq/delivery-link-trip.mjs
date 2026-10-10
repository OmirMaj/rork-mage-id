// delivery-link-trip.mjs — PGlite proof of 20261013100000_delivery_link_trip.sql (lane DELIVERIES-2, part 2):
// the three taps on the supplier link. A tap writes ONE column of the link row, forward only, each time once,
// and never touches a delivery ("Arrived" does not mark anything received).
// Usage: [MUTATE=<n>] node scripts/pgq/delivery-link-trip.mjs <worktree>   |   ... <worktree> --all
//
// REAL: this migration; 20261013090000_delivery_supplier_links.sql and 20260826200000_deliveries.sql, applied first
// exactly as on disk; public.can_access_project(uuid, text) cut out of 20260826130000_field_role.sql.
// STUBS: the roles, auth.users, auth.uid(), small public.projects and public.project_collaborators.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BASE_SQL, loadPGlite, makeKit, readMigration, replacer, runAll, worktreeArg } from './_harness.mjs';

const ROOT = worktreeArg('scripts/pgq/delivery-link-trip.mjs');
const FILE = '20261013100000_delivery_link_trip.sql';

if (process.argv[3] === '--all') {
  runAll(import.meta.url, ROOT, {
    1: ['6'],        // "Arrived" also marks the delivery received
    2: ['7'],        // going back is allowed: a later step is erased
    3: ['5'],        // a step's time is rewritten on every tap
    4: ['8a'],       // the name is not required
    5: ['9'],        // a closed delivery still takes a tap
    6: ['10'],       // a signed-in client is granted the trip column
    7: ['4'],        // a skipped step is left without a time
    8: ['8b'],       // any text is taken as a step
    9: ['11'],       // the step function is SECURITY INVOKER: anon cannot use it
    10: ['3'],       // the view does not return the trip
    11: ['13'],      // Coming From is not cleaned or capped
    12: ['13b'],     // Coming From can be left off a later tap and is then erased
  });
}

let MIG = readMigration(ROOT, FILE);
const MUTATE = Number(process.env.MUTATE || 0);
const rep = replacer(() => MIG, (v) => { MIG = v; }, MUTATE);
const noSelfCheck = () => rep("raise exception '[delivery_link_trip] verify:", "raise notice '[delivery_link_trip] verify:", true);
const END = "notify pgrst, 'reload schema';";
switch (MUTATE) {
  case 0: break;
  case 1: rep('  update public.delivery_supplier_links set trip = v_trip where delivery_id = v_link.delivery_id;', "  update public.delivery_supplier_links set trip = v_trip where delivery_id = v_link.delivery_id;\n  if v_want = 3 then update public.deliveries set status = 'delivered', delivered_at = now() where id = v_link.delivery_id; end if;"); break;
  case 2: rep("  if v_want < v_at then\n    return jsonb_build_object('ok', false, 'reason', 'back');\n  end if;", "  if v_want < v_at then v_trip := v_trip - 'arrived' - 'on_the_way'; v_at := 0; end if;"); break;
  case 3: rep("  if v_want >= 1 and not (v_trip ? 'loaded') then", '  if v_want >= 1 then'); break;
  case 4: rep('  if v_name is null or char_length(v_name) < 2 then', '  if false then'); break;
  case 5: rep("  if coalesce(v_status, 'cancelled') in ('delivered', 'cancelled') then\n    return jsonb_build_object('ok', false, 'reason', 'closed');\n  end if;\n  if v_name is null", "  if v_name is null"); break;
  case 6: rep(END, `grant update (trip) on public.delivery_supplier_links to authenticated;\n${END}`); noSelfCheck(); break;
  case 7: rep("  if v_want >= 2 and not (v_trip ? 'on_the_way') then", "  if v_want = 2 and not (v_trip ? 'on_the_way') then"); break;
  case 8: rep("  v_want := case p_step when 'loaded' then 1 when 'on_the_way' then 2 when 'arrived' then 3 else 0 end;", "  v_want := case p_step when 'loaded' then 1 when 'on_the_way' then 2 when 'arrived' then 3 else 1 end;"); break;
  case 9: rep("returns jsonb\nlanguage plpgsql\nsecurity definer\nset search_path = ''\nas $function$\ndeclare\n  v_link public.delivery_supplier_links%rowtype;\n  v_status text;\n  v_name", "returns jsonb\nlanguage plpgsql\nsecurity invoker\nset search_path = ''\nas $function$\ndeclare\n  v_link public.delivery_supplier_links%rowtype;\n  v_status text;\n  v_name"); noSelfCheck(); break;
  case 10: rep("    'reply', v_link.reply,\n    'trip', v_link.trip", "    'reply', v_link.reply"); break;
  case 11: rep("  v_from text := nullif(btrim(regexp_replace(coalesce(p_from, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), '');", "  v_from text := nullif(p_from, '');"); rep(" or char_length(coalesce(v_from, '')) > 120 then", ' then'); break;
  case 12: rep("  if v_from is not null then v_trip := v_trip || jsonb_build_object('from', v_from); end if;", "  v_trip := (v_trip - 'from') || jsonb_strip_nulls(jsonb_build_object('from', v_from));"); break;
  default: console.error('unknown MUTATE'); process.exit(2);
}
if (MUTATE) console.log(`(planted mutation M${MUTATE} applied)`);

const DELIVERIES = readMigration(ROOT, '20260826200000_deliveries.sql');
const LINKS = readMigration(ROOT, '20261013090000_delivery_supplier_links.sql');
const FIELD_ROLE = readFileSync(path.join(ROOT, 'supabase/migrations/20260826130000_field_role.sql'), 'utf8');
const START = "create or replace function public.can_access_project(pid uuid, min_role text default 'viewer')";
const at = FIELD_ROLE.indexOf(START);
const end = at < 0 ? -1 : FIELD_ROLE.indexOf('$$;', at);
if (at < 0 || end < 0) { console.error('anchor not found: can_access_project(uuid, text)'); process.exit(3); }

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const P1 = '10000000-0000-4000-8000-000000000001';
const D = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const PGlite = await loadPGlite();
const db = new PGlite();
await db.exec(BASE_SQL);
await db.exec(`
insert into auth.users (id, email) values ('${OWNER}', 'owner@x.test');
create table public.projects (id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, name text);
create table public.project_collaborators (id bigint generated always as identity primary key, project_id uuid not null references public.projects(id) on delete cascade, user_id uuid references auth.users(id) on delete cascade, role text not null, status text not null);
insert into public.projects (id, user_id, name) values ('${P1}', '${OWNER}', 'Job one');
${FIELD_ROLE.slice(at, end + 3)}
grant execute on function public.can_access_project(uuid, text) to authenticated, service_role;
`);
await db.exec(DELIVERIES);
await db.exec(LINKS);
const { ok, rows, tryRun, done } = makeKit(db);

const SHOWN = JSON.stringify({ company: 'Example Builders', description: '14 Windows', supplier: 'Northside Glass' });
const tokens = {};
for (const [n, status] of [[1, 'scheduled'], [2, 'scheduled'], [3, 'delivered'], [4, 'scheduled']]) {
  const d = await tryRun('authenticated', `insert into public.deliveries (id, user_id, project_id, description, supplier, expected_date, status, created_at, updated_at) values ('${D(n)}', '${OWNER}', '${P1}', '14 Windows', 'Northside Glass', '2026-11-12', '${status}', now(), now())`, OWNER);
  const l = await tryRun('authenticated', `insert into public.delivery_supplier_links (delivery_id, project_id, user_id, shown) values ('${D(n)}', '${P1}', '${OWNER}', $1::jsonb) returning token`, OWNER, [SHOWN]);
  if (!d.ok || !l.ok) { console.error('fixture not written: ' + (d.err ?? l.err)); process.exit(3); }
  tokens[n] = l.rows[0].token;
}
// An answer already on link 1, from before this migration: it must survive.
await tryRun('anon', `select public.delivery_link_reply('${tokens[1]}', current_date + 9, null, 'PRO 4471', null, 'Dana', null)`);
const linkBefore = JSON.stringify(await rows(`select delivery_id, token, shown, reply, reply_count from public.delivery_supplier_links order by delivery_id`));
const deliveriesBefore = JSON.stringify(await rows(`select * from public.deliveries order by id`));

let applyErr = null;
try { await db.exec(MIG); await db.exec(MIG); } catch (e) { applyErr = e; }
ok('1 the migration applies cleanly, twice (idempotent)', applyErr === null, applyErr ? String(applyErr.message) : '');
if (applyErr) done();

const linkAfter = JSON.stringify(await rows(`select delivery_id, token, shown, reply, reply_count from public.delivery_supplier_links order by delivery_id`));
const tripNull = (await rows(`select count(*)::int as n from public.delivery_supplier_links where trip is not null`))[0].n;
ok('2 every link from before is untouched: same token, same answer, and no trip', linkAfter === linkBefore && tripNull === 0);

const STEP = (n, step, name = `'Dana'`) => tryRun('anon', `select public.delivery_link_step('${tokens[n]}', ${step}, ${name}) as r`);
const loaded = await STEP(1, `'loaded'`);
const view = (await tryRun('anon', `select public.delivery_link_view('${tokens[1]}') as v`)).rows?.[0]?.v;
ok('3 a tap of Loaded is stored, and the page reads it back with the answer still there', loaded.ok && loaded.rows[0].r.ok === true && /^\d{4}-\d{2}-\d{2}T/.test(view?.trip?.loaded ?? '') && view?.trip?.name === 'Dana' && view?.reply?.tracking === 'PRO 4471' && !('on_the_way' in (view?.trip ?? {})), JSON.stringify(view));

const jump = await STEP(2, `'arrived'`, `'Sam'`);
const t2 = (await rows(`select trip from public.delivery_supplier_links where delivery_id = '${D(2)}'`))[0].trip;
ok('4 tapping Arrived first stamps the two steps skipped over with the same time: no gap', jump.ok && jump.rows[0].r.ok === true && !!t2.loaded && t2.loaded === t2.on_the_way && t2.on_the_way === t2.arrived, JSON.stringify(t2));

await db.exec(`update public.delivery_supplier_links set trip = jsonb_set(trip, '{loaded}', '"2026-01-01T00:00:00Z"') where delivery_id = '${D(1)}'`);
const again = await STEP(1, `'loaded'`, `'Someone Else'`);
const onWay = await STEP(1, `'on_the_way'`, `'Lee'`);
const t1 = (await rows(`select trip from public.delivery_supplier_links where delivery_id = '${D(1)}'`))[0].trip;
ok('5 a step\'s time is written once: tapping it again changes nothing, and a later tap keeps the earlier time', again.rows?.[0]?.r?.ok === true && t1.loaded === '2026-01-01T00:00:00Z' && !!t1.on_the_way && t1.name === 'Lee', JSON.stringify(t1));

const deliveriesAfter = JSON.stringify(await rows(`select * from public.deliveries order by id`));
ok('6 no tap changed any delivery: Arrived did not mark anything received', deliveriesAfter === deliveriesBefore);

const back = await STEP(2, `'loaded'`);
const t2b = (await rows(`select trip from public.delivery_supplier_links where delivery_id = '${D(2)}'`))[0].trip;
ok('7 forward only: a tap of an earlier step is refused and erases nothing', back.rows?.[0]?.r?.ok === false && back.rows[0].r.reason === 'back' && JSON.stringify(t2b) === JSON.stringify(t2), JSON.stringify([back.rows?.[0]?.r, t2b]));

const noName = await STEP(4, `'loaded'`, `' '`);
const longName = await STEP(4, `'loaded'`, `'${'n'.repeat(81)}'`);
ok('8a a tap with no name, or an over-long one, is refused', noName.rows?.[0]?.r?.reason === 'name' && longName.rows?.[0]?.r?.reason === 'too_long', JSON.stringify([noName.rows?.[0]?.r, longName.rows?.[0]?.r]));
const junk = await STEP(4, `'delivered'`);
const nullStep = await STEP(4, `null`);
const t4 = (await rows(`select trip from public.delivery_supplier_links where delivery_id = '${D(4)}'`))[0].trip;
ok('8b anything that is not one of the three steps is refused and stores nothing', junk.rows?.[0]?.r?.reason === 'step' && nullStep.rows?.[0]?.r?.reason === 'step' && t4 === null, JSON.stringify([junk.rows?.[0]?.r, t4]));

const closed = await STEP(3, `'on_the_way'`);
const unknown = await tryRun('anon', `select public.delivery_link_step('99999999-9999-4999-8999-999999999999', 'loaded', 'Dana') as r`);
ok('9 a delivery that has arrived or a link that does not exist takes no tap', closed.rows?.[0]?.r?.reason === 'closed' && unknown.rows?.[0]?.r?.reason === 'not_found', JSON.stringify([closed.rows?.[0]?.r, unknown.rows?.[0]?.r]));

const forge = await tryRun('authenticated', `update public.delivery_supplier_links set trip = '{"arrived":"2026-01-01T00:00:00Z","name":"Forged"}'::jsonb where delivery_id = '${D(4)}'`, OWNER);
const forgeInsert = await tryRun('authenticated', `insert into public.delivery_supplier_links (delivery_id, project_id, user_id, shown, trip) values ('${D(9)}', '${P1}', '${OWNER}', $1::jsonb, '{}'::jsonb)`, OWNER, [SHOWN]);
const anonRead = await tryRun('anon', `select trip from public.delivery_supplier_links`);
const ownerRead = await tryRun('authenticated', `select trip from public.delivery_supplier_links where delivery_id = '${D(1)}'`, OWNER);
ok('10 a signed-in client cannot write the trip but the job\'s field seats read it; anon still reads nothing', !forge.ok && !forgeInsert.ok && !anonRead.ok && ownerRead.ok && !!ownerRead.rows?.[0]?.trip?.on_the_way, `update ${forge.ok} insert ${forgeInsert.ok} anon ${anonRead.ok} owner ${ownerRead.ok}`);

const fns = await rows(`select p.proname, p.prosecdef as definer, coalesce(array_to_string(p.proconfig, ','), '') as config, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('public', p.oid, 'execute') as pub, p.prosrc as src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('delivery_link_view', 'delivery_link_step') order by 1`);
const stepSrc = fns.find((f) => f.proname === 'delivery_link_step')?.src ?? '';
const anonStep = await STEP(4, `'loaded'`);
ok('11 both functions are SECURITY DEFINER with an empty search_path, callable by anon and not by PUBLIC; the step function writes one table and calls nothing',
  fns.length === 2 && fns.every((f) => f.definer === true && /search_path=(""|)$/.test(f.config) && f.anon === true && f.pub === false) && anonStep.ok && anonStep.rows[0].r.ok === true
    && (stepSrc.match(/\bupdate\s+public\.[a-z_]+/g) ?? []).every((u) => u.endsWith('delivery_supplier_links')) && !/\b(insert|delete|perform|notify|pg_notify|net\.|http)\b/i.test(stepSrc),
  fns.map((f) => `${f.proname}: definer ${f.definer} anon ${f.anon} public ${f.pub}`).join('; ') + ` anon call ${anonStep.ok ? JSON.stringify(anonStep.rows[0].r.ok) : anonStep.err}`);

{
  const d5 = await tryRun('authenticated', `insert into public.deliveries (id, user_id, project_id, description, supplier, expected_date, status, created_at, updated_at) values ('${D(5)}', '${OWNER}', '${P1}', 'Tile', 'Yard', '2026-11-12', 'scheduled', now(), now())`, OWNER);
  const l5 = await tryRun('authenticated', `insert into public.delivery_supplier_links (delivery_id, project_id, user_id, shown) values ('${D(5)}', '${P1}', '${OWNER}', $1::jsonb) returning token`, OWNER, [SHOWN]);
  const T5 = l5.rows?.[0]?.token;
  const call = (args) => tryRun('anon', `select public.delivery_link_step('${T5}', ${args}) as r`);
  const withFrom = await call(`'loaded', 'Dana', E'  Sample Stone Yard,\n Red Hook,   Brooklyn '`);
  const tooLong = await call(`'on_the_way', 'Dana', '${'y'.repeat(121)}'`);
  const t5 = (await rows(`select trip from public.delivery_supplier_links where delivery_id = '${D(5)}'`))[0]?.trip;
  ok('13 Coming From is words someone typed: cleaned, at most 120 characters, and an over-long one stores nothing', d5.ok && withFrom.rows?.[0]?.r?.ok === true && t5?.from === 'Sample Stone Yard, Red Hook, Brooklyn' && tooLong.rows?.[0]?.r?.reason === 'too_long' && !('on_the_way' in t5), JSON.stringify([withFrom.rows?.[0]?.r ?? withFrom.err, tooLong.rows?.[0]?.r, t5]));
  const later = await call(`'on_the_way', 'Lee'`);
  const fixed = await call(`'on_the_way', 'Lee', 'Sample Stone Yard, Gowanus, Brooklyn'`);
  const t5b = (await rows(`select trip from public.delivery_supplier_links where delivery_id = '${D(5)}'`))[0]?.trip;
  ok('13b a later tap without Coming From keeps it, and a tap at the same step can correct it', later.rows?.[0]?.r?.trip?.from === 'Sample Stone Yard, Red Hook, Brooklyn' && fixed.rows?.[0]?.r?.ok === true && t5b?.from === 'Sample Stone Yard, Gowanus, Brooklyn' && !!t5b?.on_the_way && !('arrived' in t5b), JSON.stringify([later.rows?.[0]?.r, t5b]));
  const keys = Object.keys(t5b ?? {}).sort().join(',');
  ok('13c the trip holds the three times, a name and Coming From, and no other key: no position of any kind', keys === 'from,loaded,name,on_the_way', keys);
}

const big = await tryRun('service_role', `update public.delivery_supplier_links set trip = jsonb_build_object('name', repeat('x', 1200)) where delivery_id = '${D(4)}'`);
ok('12 the trip column is an object of at most 1,000 bytes', !big.ok);

done();
