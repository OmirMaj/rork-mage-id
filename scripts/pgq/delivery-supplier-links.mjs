// delivery-supplier-links.mjs — PGlite proof of 20261013090000_delivery_supplier_links.sql (lane DELIVERIES-2):
// the link table, who can read and write it, and the two functions the no-account page calls
// (the answer lands on the link row and NOWHERE else; anon holds nothing on the table).
// Usage: [MUTATE=<n>] node scripts/pgq/delivery-supplier-links.mjs <worktree>   (one run)
//        node scripts/pgq/delivery-supplier-links.mjs <worktree> --all            (as written + every planted mutation)
// A plant softens the migration's own self-check to a notice where it would catch the plant at
// apply time, so the CASES below are what must go red.
//
// REAL: the migration; the whole of 20260826200000_deliveries.sql; and public.can_access_project(uuid, text)
// cut out of 20260826130000_field_role.sql at run time (a missing anchor stops the proof).
// STUBS: the roles, auth.users, auth.uid(), and small versions of public.projects and public.project_collaborators.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BASE_SQL, loadPGlite, makeKit, readMigration, replacer, runAll, worktreeArg } from './_harness.mjs';

const ROOT = worktreeArg('scripts/pgq/delivery-supplier-links.mjs');
const FILE = '20261013090000_delivery_supplier_links.sql';

if (process.argv[3] === '--all') {
  runAll(import.meta.url, ROOT, {
    1: ['4'],          // the table revoke removed: anon reads every link and token
    2: ['9'],          // update is granted on every column: a signed-in client forges the answer
    3: ['7'],          // the insert policy does not check the delivery is on that project
    4: ['6'],          // the select policy opened to `true`: a stranger reads another firm's link
    5: ['13'],         // the answer also writes the delivery's supplier date
    6: ['14'],         // the closed check removed: an arrived delivery still takes an answer
    7: ['15'],         // the answer cap removed: a 21st answer lands
    8: ['16c'],        // the date window removed: a date years away is stored
    9: ['16d'],        // the tracking pattern removed: free text is stored as a tracking number
    10: ['16a'],       // the name is not required
    11: ['17'],        // control characters are not cleaned out of the answer
    12: ['18'],        // the view returns the whole delivery row
    13: ['19'],        // a function is SECURITY INVOKER: anon cannot use the link at all
    14: ['8'],         // the delete policy opened to the viewer seat
    15: ['16e'],       // the length caps removed
    16: ['12'],        // a new answer does not clear "seen"
    17: ['20'],        // turning the link off keeps the row: the old token still works
  });
}

let MIG = readMigration(ROOT, FILE);
const MUTATE = Number(process.env.MUTATE || 0);
const rep = replacer(() => MIG, (v) => { MIG = v; }, MUTATE);
const noSelfCheck = () => rep("raise exception '[delivery_supplier_links] verify:", "raise notice '[delivery_supplier_links] verify:", true);
const END = "notify pgrst, 'reload schema';";
switch (MUTATE) {
  case 0: break;
  case 1: rep('revoke all on public.delivery_supplier_links from anon, authenticated, public;', 'revoke all on public.delivery_supplier_links from authenticated, public;\ngrant select on public.delivery_supplier_links to anon;\ndrop policy if exists dsl_anon on public.delivery_supplier_links;\ncreate policy dsl_anon on public.delivery_supplier_links for select to anon using (true);'); noSelfCheck(); break;
  case 2: rep('grant update (shown, reply_seen_at) on public.delivery_supplier_links to authenticated;', 'grant update on public.delivery_supplier_links to authenticated;'); noSelfCheck(); break;
  case 3: rep("\n    and exists (select 1 from public.deliveries d where d.id = delivery_id and d.project_id = delivery_supplier_links.project_id)", ''); break;
  case 4: rep('  using (auth.uid() = user_id or public.can_access_project(project_id));', '  using (true);'); break;
  case 5: rep("  return jsonb_build_object('ok', true);", "  update public.deliveries set expected_date = coalesce(p_date, expected_date), status = 'confirmed' where id = v_link.delivery_id;\n  return jsonb_build_object('ok', true);"); break;
  case 6: rep("  if coalesce(v_status, 'cancelled') in ('delivered', 'cancelled') then\n    return jsonb_build_object('ok', false, 'reason', 'closed');\n  end if;", ''); break;
  case 7: rep("  if v_link.reply_count >= 20 then\n    return jsonb_build_object('ok', false, 'reason', 'too_many');\n  end if;", ''); rep('  check (reply_count between 0 and 20);', '  check (true);'); break;
  case 8: rep('  if p_date is not null and (p_date < current_date - 1 or p_date > current_date + 730) then', '  if false then'); break;
  case 9: rep("  if v_tracking is not null and v_tracking !~ '^[A-Za-z0-9][A-Za-z0-9 -]{3,59}$' then", '  if false then'); break;
  case 10: rep('  if v_name is null or char_length(v_name) < 2 then', '  if false then'); break;
  case 11: rep("  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), '');", "  v_note text := nullif(coalesce(p_note, ''), '');"); break;
  case 12: rep("    'shown', v_link.shown,", "    'shown', v_link.shown, 'delivery', (select to_jsonb(d) from public.deliveries d where d.id = v_link.delivery_id),"); break;
  case 13: rep("language plpgsql\nstable\nsecurity definer", "language plpgsql\nstable\nsecurity invoker"); noSelfCheck(); break;
  case 14: rep("  for delete to authenticated\n  using (public.can_access_project(project_id, 'field'));", '  for delete to authenticated\n  using (public.can_access_project(project_id));'); break;
  case 15: rep("  if char_length(v_name) > 80 or char_length(coalesce(v_window, '')) > 40\n     or char_length(coalesce(v_carrier, '')) > 40 or char_length(coalesce(v_note, '')) > 300 then", '  if false then'); break;
  case 16: rep('         reply_at = now(),\n         reply_seen_at = null', '         reply_at = now()'); break;
  case 17: rep(END, `create or replace function public.dsl_keep() returns trigger language plpgsql as $t$ begin return null; end $t$;\ndrop trigger if exists dsl_keep on public.delivery_supplier_links;\ncreate trigger dsl_keep before delete on public.delivery_supplier_links for each row execute function public.dsl_keep();\n${END}`); break;
  default: console.error('unknown MUTATE'); process.exit(2);
}
if (MUTATE) console.log(`(planted mutation M${MUTATE} applied)`);

const DELIVERIES = readMigration(ROOT, '20260826200000_deliveries.sql');
const FIELD_ROLE = readFileSync(path.join(ROOT, 'supabase/migrations/20260826130000_field_role.sql'), 'utf8');
const START = "create or replace function public.can_access_project(pid uuid, min_role text default 'viewer')";
const at = FIELD_ROLE.indexOf(START);
const end = at < 0 ? -1 : FIELD_ROLE.indexOf('$$;', at);
if (at < 0 || end < 0) { console.error('anchor not found: can_access_project(uuid, text) in 20260826130000_field_role.sql'); process.exit(3); }
const CAN_ACCESS = FIELD_ROLE.slice(at, end + 3);

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const FIELD = '00000000-0000-4000-8000-0000000000d4';
const VIEWER = '00000000-0000-4000-8000-0000000000c3';
const STRANGER = '00000000-0000-4000-8000-0000000000e5';
const P1 = '10000000-0000-4000-8000-000000000001';
const P2 = '10000000-0000-4000-8000-000000000002';
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
const sorted = (o) => JSON.stringify(Object.entries(o ?? {}).sort(([x], [y]) => (x < y ? -1 : 1)));

const DELIV = (id, uid, project, status = 'scheduled') =>
  `insert into public.deliveries (id, user_id, project_id, description, supplier, expected_date, status, notes, created_at, updated_at)
   values ('${id}', '${uid}', '${project}', '14 Windows', 'Northside Glass', '2026-11-12', '${status}', 'PRIVATE NOTE 4830', now(), now())`;
for (const [id, uid, p, st] of [[D(1), OWNER, P1], [D(2), OWNER, P1], [D(3), STRANGER, P2], [D(4), OWNER, P1, 'delivered'], [D(5), OWNER, P1], [D(6), OWNER, P1]]) {
  const r = await tryRun('authenticated', DELIV(id, uid, p, st), uid);
  if (!r.ok) { console.error('fixture delivery not written: ' + r.err); process.exit(3); }
}
const deliveriesBefore = JSON.stringify(await rows(`select * from public.deliveries order by id`));

let applyErr = null;
try { await db.exec(MIG); await db.exec(MIG); } catch (e) { applyErr = e; }
ok('1 the migration applies cleanly, twice (idempotent)', applyErr === null, applyErr ? String(applyErr.message) : '');
if (applyErr) done();

const SHOWN = JSON.stringify({ company: 'Example Builders', description: '14 Windows', supplier: 'Northside Glass', neededBy: '2026-11-13' });
const LINK = (delivery, project, uid) => `insert into public.delivery_supplier_links (delivery_id, project_id, user_id, shown) values ('${delivery}', '${project}', '${uid}', $1::jsonb) returning token`;
const made = await tryRun('authenticated', LINK(D(1), P1, OWNER), OWNER, [SHOWN]);
const T1 = made.rows?.[0]?.token;
ok('2 the owner makes a link; the database makes the token', made.ok && /^[0-9a-f-]{36}$/.test(String(T1)), made.err ?? '');
const fieldMade = await tryRun('authenticated', LINK(D(2), P1, FIELD), FIELD, [SHOWN]);
const viewerMade = await tryRun('authenticated', LINK(D(5), P1, VIEWER), VIEWER, [SHOWN]);
const strangerMade = await tryRun('authenticated', LINK(D(5), P1, STRANGER), STRANGER, [SHOWN]);
ok('3 a field seat makes a link; a viewer and a stranger cannot', fieldMade.ok && !viewerMade.ok && !strangerMade.ok, `field ${fieldMade.ok} viewer ${viewerMade.ok} stranger ${strangerMade.ok}`);

const anonRead = await tryRun('anon', `select token from public.delivery_supplier_links`);
const anonWrite = await tryRun('anon', `update public.delivery_supplier_links set reply_seen_at = now()`);
const anonDel = await tryRun('anon', `delete from public.delivery_supplier_links`);
ok('4 anon holds nothing on the table: no read, no update, no delete', !anonRead.ok && !anonWrite.ok && !anonDel.ok, `read ${anonRead.ok ? anonRead.n + ' rows' : 'refused'} update ${anonWrite.ok} delete ${anonDel.ok}`);

const ownChosenToken = await tryRun('authenticated', `insert into public.delivery_supplier_links (delivery_id, project_id, user_id, shown, token) values ('${D(5)}', '${P1}', '${OWNER}', $1::jsonb, '11111111-1111-4111-8111-111111111111')`, OWNER, [SHOWN]);
ok('5 a signed-in client cannot choose the token', !ownChosenToken.ok, ownChosenToken.ok ? 'insert with a chosen token landed' : '');

const strangerRead = await tryRun('authenticated', `select token from public.delivery_supplier_links`, STRANGER);
const viewerRead = await tryRun('authenticated', `select token from public.delivery_supplier_links`, VIEWER);
ok('6 a stranger reads no link; a viewer on the job reads the job\'s links', strangerRead.ok && strangerRead.n === 0 && viewerRead.ok && viewerRead.n === 2, `stranger ${strangerRead.n} viewer ${viewerRead.n}`);

const crossProject = await tryRun('authenticated', LINK(D(3), P1, OWNER), OWNER, [SHOWN]);
ok('7 a link cannot be made for a delivery that is on another job', !crossProject.ok, crossProject.ok ? 'a link to another firm\'s delivery was made under the caller\'s own job' : '');

const viewerDel = await tryRun('authenticated', `delete from public.delivery_supplier_links where delivery_id = '${D(2)}'`, VIEWER);
const strangerDel = await tryRun('authenticated', `delete from public.delivery_supplier_links where delivery_id = '${D(2)}'`, STRANGER);
const stillThere = (await rows(`select count(*)::int as n from public.delivery_supplier_links where delivery_id = '${D(2)}'`))[0].n;
ok('8 a viewer and a stranger cannot turn a link off', stillThere === 1, `viewer affected ${viewerDel.affected ?? viewerDel.err} stranger affected ${strangerDel.affected ?? strangerDel.err}`);

const forge = await tryRun('authenticated', `update public.delivery_supplier_links set reply = '{"date":"2026-01-01","name":"Forged"}'::jsonb where delivery_id = '${D(1)}'`, OWNER);
const forgeCount = await tryRun('authenticated', `update public.delivery_supplier_links set reply_count = 0 where delivery_id = '${D(1)}'`, OWNER);
const reToken = await tryRun('authenticated', `update public.delivery_supplier_links set token = gen_random_uuid() where delivery_id = '${D(1)}'`, OWNER);
ok('9 a signed-in client cannot write the answer, its count or the token', !forge.ok && !forgeCount.ok && !reToken.ok, `reply ${forge.ok} count ${forgeCount.ok} token ${reToken.ok}`);

const view = await tryRun('anon', `select public.delivery_link_view('${T1}') as v`);
const v = view.rows?.[0]?.v;
ok('10 the page reads the link with the token: found, open, and exactly what the person chose to show', view.ok && v?.found === true && v?.open === true && sorted(v?.shown) === sorted(JSON.parse(SHOWN)) && (v?.reply ?? null) === null, JSON.stringify(v));
const unknown = await tryRun('anon', `select public.delivery_link_view('99999999-9999-4999-8999-999999999999') as v`);
const nullTok = await tryRun('anon', `select public.delivery_link_view(null) as v`);
ok('11 an unknown or missing token gets found: false and nothing else', unknown.rows?.[0]?.v?.found === false && Object.keys(unknown.rows[0].v).length === 1 && nullTok.rows?.[0]?.v?.found === false && Object.keys(nullTok.rows[0].v).length === 1, JSON.stringify(unknown.rows?.[0]?.v));

const REPLY = (tok, args) => `select public.delivery_link_reply('${tok}', ${args}) as r`;
const seenFirst = await tryRun('authenticated', `update public.delivery_supplier_links set reply_seen_at = now() where delivery_id = '${D(1)}'`, OWNER);
const first = await tryRun('anon', REPLY(T1, `current_date + 20, '7 to 11 AM', '1Z 999 AA1 01 2345 6784', 'UPS Freight', 'Dana at Northside', 'Two pallets'`));
const link1 = (await rows(`select reply, reply_count, reply_seen_at, reply_at from public.delivery_supplier_links where delivery_id = '${D(1)}'`))[0];
ok('12 the supplier answers: the answer is on the link row, counted, and marked not yet seen',
  seenFirst.ok && first.ok && first.rows[0].r.ok === true && link1.reply?.name === 'Dana at Northside' && link1.reply?.tracking === '1Z 999 AA1 01 2345 6784' && link1.reply?.window === '7 to 11 AM'
    && /^\d{4}-\d{2}-\d{2}$/.test(link1.reply?.date ?? '') && link1.reply_count === 1 && link1.reply_seen_at === null && link1.reply_at !== null,
  JSON.stringify({ r: first.rows?.[0]?.r ?? first.err, link1 }));

const deliveriesAfter = JSON.stringify(await rows(`select * from public.deliveries order by id`));
ok('13 the answer changed NOTHING on any delivery: not the supplier date, not the status, not a note', deliveriesAfter === deliveriesBefore, deliveriesAfter === deliveriesBefore ? '' : 'public.deliveries differs after an answer');

const closedLink = await tryRun('authenticated', LINK(D(4), P1, OWNER), OWNER, [SHOWN]);
const T4 = closedLink.rows?.[0]?.token;
const closedView = await tryRun('anon', `select public.delivery_link_view('${T4}') as v`);
const closedReply = await tryRun('anon', REPLY(T4, `current_date + 3, null, null, null, 'Dana', null`));
ok('14 a delivery that has arrived: the page says closed and takes no answer', closedView.rows?.[0]?.v?.open === false && closedReply.rows?.[0]?.r?.ok === false && closedReply.rows?.[0]?.r?.reason === 'closed', JSON.stringify([closedView.rows?.[0]?.v, closedReply.rows?.[0]?.r ?? closedReply.err]));

const T2 = fieldMade.rows?.[0]?.token;
let last = null;
for (let i = 0; i < 21; i++) last = await tryRun('anon', REPLY(T2, `current_date + 5, null, null, null, 'Dana', 'try ${i}'`));
const count2 = (await rows(`select reply_count from public.delivery_supplier_links where delivery_id = '${D(2)}'`))[0]?.reply_count;
ok('15 a link takes 20 answers and no more', count2 === 20 && last.rows?.[0]?.r?.reason === 'too_many', `count ${count2}, 21st ${JSON.stringify(last.rows?.[0]?.r ?? last.err)}`);

const l5 = await tryRun('authenticated', LINK(D(5), P1, OWNER), OWNER, [SHOWN]);
const T5 = l5.rows?.[0]?.token;
const reason = async (args) => { const r = await tryRun('anon', REPLY(T5, args)); return r.ok ? (r.rows[0].r.ok ? 'ok' : r.rows[0].r.reason) : 'error: ' + r.err; };
ok('16a an answer with no name is refused', (await reason(`current_date + 5, null, null, null, ' ', null`)) === 'name');
ok('16b an answer with neither a date nor a tracking number is refused', (await reason(`null, '7 AM', null, 'UPS', 'Dana', 'soon'`)) === 'nothing');
ok('16c a date more than two years away, or before yesterday, is refused', (await reason(`current_date + 900, null, null, null, 'Dana', null`)) === 'date' && (await reason(`current_date - 30, null, null, null, 'Dana', null`)) === 'date');
ok('16d a tracking number that is not letters, digits, spaces and dashes is refused', (await reason(`null, null, '<script>alert(1)</script>', null, 'Dana', null`)) === 'tracking' && (await reason(`null, null, 'http://evil.example/x', null, 'Dana', null`)) === 'tracking');
ok('16e an over-long name, window, carrier or note is refused', (await reason(`current_date + 5, null, null, null, '${'n'.repeat(81)}', null`)) === 'too_long' && (await reason(`current_date + 5, null, null, null, 'Dana', '${'x'.repeat(301)}'`)) === 'too_long' && (await reason(`current_date + 5, '${'w'.repeat(41)}', null, null, 'Dana', null`)) === 'too_long');
const none5 = (await rows(`select reply, reply_count from public.delivery_supplier_links where delivery_id = '${D(5)}'`))[0];
ok('16f a refused answer stores nothing and is not counted', none5.reply === null && none5.reply_count === 0, JSON.stringify(none5));

const ctl = await tryRun('anon', `select public.delivery_link_reply('${T5}', current_date + 5, null, null, null, 'Dana', E'line one\\nline two\\ttabbed\\u0007') as r`);
const note5 = (await rows(`select reply ->> 'note' as note from public.delivery_supplier_links where delivery_id = '${D(5)}'`))[0]?.note;
ok('17 line breaks and control characters in the answer become single spaces', ctl.ok && note5 === 'line one line two tabbed', JSON.stringify(note5));

const whole = JSON.stringify((await tryRun('anon', `select public.delivery_link_view('${T1}') as v`)).rows?.[0]?.v ?? {});
ok('18 the page is told nothing from the delivery row: no note, no id, no project, no owner', !/PRIVATE NOTE|4830|notes|user_id|project_id|30000000-|10000000-|00000000-/.test(whole), whole.slice(0, 200));

const fns = await rows(`select p.proname, p.prosecdef as definer, coalesce(array_to_string(p.proconfig, ','), '') as config,
    has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('public', p.oid, 'execute') as pub, p.prosrc as src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('delivery_link_view', 'delivery_link_reply') order by 1`);
const replySrc = fns.find((f) => f.proname === 'delivery_link_reply')?.src ?? '';
ok('19 both functions are SECURITY DEFINER with an empty search_path, callable by anon, not by PUBLIC; the answer function writes one table and calls nothing',
  fns.length === 2 && fns.every((f) => f.definer === true && /search_path=(""|)$/.test(f.config) && f.anon === true && f.pub === false)
    && (replySrc.match(/\bupdate\s+public\.[a-z_]+/g) ?? []).every((u) => u.endsWith('delivery_supplier_links')) && !/\b(insert|delete|perform|notify|pg_notify|net\.|http)\b/i.test(replySrc),
  fns.map((f) => `${f.proname}: definer ${f.definer} config ${f.config} anon ${f.anon} public ${f.pub}`).join('; '));

const off = await tryRun('authenticated', `delete from public.delivery_supplier_links where delivery_id = '${D(1)}'`, OWNER);
const afterOff = await tryRun('anon', `select public.delivery_link_view('${T1}') as v`);
const replyOff = await tryRun('anon', REPLY(T1, `current_date + 5, null, null, null, 'Dana', null`));
const again = await tryRun('authenticated', LINK(D(1), P1, OWNER), OWNER, [SHOWN]);
ok('20 turning the link off kills the token; a new link for the same delivery gets a new one', off.ok && afterOff.rows?.[0]?.v?.found === false && replyOff.rows?.[0]?.r?.reason === 'not_found' && again.ok && again.rows[0].token !== T1,
  JSON.stringify([afterOff.rows?.[0]?.v, replyOff.rows?.[0]?.r, again.ok ? again.rows[0].token !== T1 : again.err]));

const big = await tryRun('authenticated', LINK(D(6), P1, OWNER), OWNER, [JSON.stringify({ description: 'x'.repeat(2100) })]);
const arr = await tryRun('authenticated', LINK(D(6), P1, OWNER), OWNER, ['[1,2]']);
ok('21 what the link shows is an object of at most 2,000 bytes', !big.ok && !arr.ok, `big ${big.ok} array ${arr.ok}`);

await tryRun('service_role', `delete from public.deliveries where id = '${D(5)}'`);
const gone = (await rows(`select count(*)::int as n from public.delivery_supplier_links where delivery_id = '${D(5)}'`))[0].n;
ok('22 the link goes with its delivery', gone === 0, `rows left ${gone}`);

done();
