// signed-record-tombstones.mjs — PGlite proof of 20261010110000_signed_record_tombstones.sql (lane PROTECT-SERVER).
// Usage: [MUTATE=<n>] node scripts/pgq/signed-record-tombstones.mjs <worktree>
//        node scripts/pgq/signed-record-tombstones.mjs <worktree> --all
import { BASE_SQL, loadPGlite, makeKit, readMigration, replacer, runAll, worktreeArg } from './_harness.mjs';

const ROOT = worktreeArg('scripts/pgq/signed-record-tombstones.mjs');
const FILE = '20261010110000_signed_record_tombstones.sql';

if (process.argv[3] === '--all') {
  runAll(import.meta.url, ROOT, {
    1: ['4'],          // the client revoke removed
    2: ['5'],          // a client may call the writer
    3: ['9'],          // the ownership re-check on project ids removed: another account's approvals are tombstoned
    4: ['10'],         // the portal re-check removed: a portal id on someone else's project is accepted
    5: ['12'],         // the lien waiver's signing key is hashed in (and the hash can be used to test a guessed key)
    6: ['13'],         // unsigned waivers and contracts are tombstoned too
    7: ['14'],         // the once-per-record rule removed: a retry doubles the rows
    8: ['15'],         // the keep trigger never created
    9: ['7'],          // a personal column (signer_name) is copied into the tombstone's reference
    10: ['16'],        // one missing table stops every kind (the per-kind blocks removed for lien waivers)
    11: ['11'],        // field tickets on other owners' jobs (handed over, not deleted) are tombstoned
  });
}

let MIG = readMigration(ROOT, FILE);
const MUTATE = Number(process.env.MUTATE || 0);
const rep = replacer(() => MIG, (v) => { MIG = v; }, MUTATE);
const noSelfCheck = () => rep("raise exception '[signed_record_tombstones] verify:", "raise notice '[signed_record_tombstones] verify:", true);
switch (MUTATE) {
  case 0: break;
  case 1: rep('revoke all on public.signed_record_tombstones from public, anon, authenticated, service_role;', 'revoke all on public.signed_record_tombstones from service_role;'); noSelfCheck(); break;
  case 2: rep('revoke all on function public.tombstone_signed_records(uuid, text[], text[]) from public, anon, authenticated;', ''); noSelfCheck(); break;
  case 3: rep("     where p.user_id = p_user_id and p.id::text = any (p_project_ids);", "     where p.id::text = any (p_project_ids);"); break;
  case 4: rep("       and not exists (select 1 from public.projects p where p.client_portal->>'portalId' = x.pid and p.user_id is distinct from p_user_id);", ';'); rep("       and exists (select 1 from public.projects p where p.client_portal->>'portalId' = x.pid and p.user_id = p_user_id)\n", ''); break;
  case 5: rep("(pg_catalog.to_jsonb(w) - 'sign_token')::text", 'pg_catalog.to_jsonb(w)::text'); break;
  case 6: rep('         and (w.signed_at is not null or w.sub_signature is not null)\n', ''); rep('         and (c.signed_at is not null or c.homeowner_signature is not null or c.gc_signature is not null)\n', ''); break;
  case 7:
    rep('  constraint signed_record_tombstones_once unique (record_kind, record_id)\n', '  constraint signed_record_tombstones_once check (true)\n');
    rep('      on conflict (record_kind, record_id) do nothing;', ';', true);
    break;
  case 8: rep('create trigger signed_record_tombstones_keep\n  before update or delete on public.signed_record_tombstones\n  for each row execute function public.signed_record_tombstones_keep();', ''); noSelfCheck(); break;
  case 9:
    rep("constraint signed_record_tombstones_ref_check check (counterparty_ref is null or counterparty_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),", 'constraint signed_record_tombstones_ref_check check (true),');
    rep("             case when a.portal_id ~ '^[A-Za-z0-9._:-]{1,128}$' then a.portal_id end,", '             a.signer_name,');
    break;
  case 10:
    rep("  begin\n    if pg_catalog.to_regclass('public.lien_waivers') is null then\n      v_skipped := v_skipped || pg_catalog.to_jsonb('lien_waiver: no table'::text);\n    else", '  begin\n    if false then null;\n    else');
    rep("  exception when others then\n    v_skipped := v_skipped || pg_catalog.to_jsonb(('lien_waiver: ' || sqlstate)::text);\n  end;", '  end;');
    break;
  case 11: rep('       where t.user_id = p_user_id and t.project_id::text = any (v_projects)\n', '       where t.user_id = p_user_id\n'); break;
  default: console.error('unknown MUTATE'); process.exit(2);
}
if (MUTATE) console.log(`(planted mutation M${MUTATE} applied)`);

const A = '00000000-0000-4000-8000-0000000000a1';   // the account being deleted
const B = '00000000-0000-4000-8000-0000000000b2';   // someone else
const PA = '11111111-1111-4111-8111-111111111111';  // A's project
const PA2 = '11111111-1111-4111-8111-222222222222'; // A's second project, no portal
const PB = '22222222-2222-4222-8222-222222222222';  // B's project
const DOC = 'd'.repeat(64);

const SCHEMA = `
create table public.projects (id uuid primary key, user_id uuid references auth.users(id) on delete cascade, name text, client_portal jsonb);
create table public.change_order_approvals (id uuid primary key default gen_random_uuid(), portal_id text not null, project_id text, change_order_id text not null,
  decision text not null, signer_name text, signer_email text, signature_data text, created_at timestamptz not null default now(), document_hash text, sealed_at timestamptz);
create table public.lien_waivers (id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, sub_name text not null, paid_amount numeric, sub_signature jsonb, signed_at timestamptz, sign_token text);
create table public.project_contracts (id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, gc_signature jsonb, homeowner_signature jsonb, signed_at timestamptz, document_hash text);
create table public.field_tickets (id text primary key, user_id uuid not null references auth.users(id) on delete cascade, project_id text not null, "authorization" jsonb, updated_at timestamptz not null default now());
create table public.aia_pay_apps (id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, project_id uuid not null references public.projects(id) on delete cascade, certified_at timestamptz);
create table public.punch_seals (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, project_id text not null, sealed_at timestamptz not null default now(), signer_name text, manifest_hash text);
insert into auth.users (id, email) values ('${A}', 'a@x.test'), ('${B}', 'b@x.test');
insert into public.projects values ('${PA}', '${A}', 'Henderson Kitchen', '{"portalId":"portal-aaaa1111-k1"}'), ('${PA2}', '${A}', 'Second', null), ('${PB}', '${B}', 'Other', '{"portalId":"portal-bbbb2222-k2"}');
insert into public.change_order_approvals (portal_id, project_id, change_order_id, decision, signer_name, signer_email, signature_data, document_hash, sealed_at) values
  ('portal-aaaa1111-k1', '${PA}', 'co-1', 'approved', 'Jane Homeowner', 'jane@x.test', 'data:image/png;base64,AAAA', '${DOC}', '2026-09-01T10:00:00Z'),
  ('portal-aaaa1111-k1', null,    'co-2', 'declined', 'Jane Homeowner', 'jane@x.test', null, null, null),
  ('portal-bbbb2222-k2', '${PB}', 'co-9', 'approved', 'Bob Client', 'bob@x.test', 'data:image/png;base64,BBBB', null, '2026-09-02T10:00:00Z');
insert into public.lien_waivers (project_id, user_id, sub_name, paid_amount, sub_signature, signed_at, sign_token) values
  ('${PA}', '${A}', 'Acme Electric', 4200, '{"name":"Sam Sub","role":"sub"}', '2026-09-03T10:00:00Z', 'tok-secret-0123456789abcdef0123456789abcdef'),
  ('${PA}', '${A}', 'Unsigned Plumbing', 900, null, null, 'tok-unsigned-0123456789abcdef0123456789abcd'),
  ('${PB}', '${B}', 'Other Sub', 100, '{"name":"X"}', '2026-09-03T10:00:00Z', null);
insert into public.project_contracts (project_id, user_id, gc_signature, homeowner_signature, signed_at, document_hash) values
  ('${PA}', '${A}', '{"name":"GC"}', '{"name":"Jane Homeowner"}', '2026-08-01T10:00:00Z', '${DOC}'),
  ('${PA2}', '${A}', null, null, null, null);
insert into public.field_tickets (id, user_id, project_id, "authorization") values
  ('ft-own', '${A}', '${PA}', '{"name":"Owner Rep","signedAt":"2026-09-04T10:00:00Z"}'),
  ('ft-draft', '${A}', '${PA}', null),
  ('ft-on-b', '${A}', '${PB}', '{"name":"B Rep"}');
insert into public.aia_pay_apps values ('33333333-3333-4333-8333-333333333333', '${A}', '${PA}', '2026-09-05T10:00:00Z'), ('33333333-3333-4333-8333-444444444444', '${A}', '${PA}', null);
insert into public.punch_seals (user_id, project_id, signer_name, manifest_hash) values ('${A}', '${PA}', 'Jane Homeowner', '${'e'.repeat(64)}');
`;

const PGlite = await loadPGlite();
const db = new PGlite();
await db.exec(BASE_SQL);
await db.exec(SCHEMA);
const { ok, rows, tryRun, done } = makeKit(db);

let applyErr = null;
try { await db.exec(MIG); await db.exec(MIG); } catch (e) { applyErr = e; }
ok('1 the migration applies cleanly, twice (idempotent)', applyErr === null, applyErr ? String(applyErr.message) : '');
if (applyErr) done();

const CALL = (uid, projects, portals) => `select public.tombstone_signed_records('${uid}', array[${projects.map((p) => `'${p}'`).join(',')}]::text[], array[${portals.map((p) => `'${p}'`).join(',')}]::text[]) as r`;

const cols = (await rows(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'signed_record_tombstones' order by ordinal_position`)).map((r) => r.column_name);
ok('2 the columns are kind, id, reference, times and hashes only',
  JSON.stringify(cols) === JSON.stringify(['id', 'record_kind', 'record_id', 'counterparty_ref', 'signed_at', 'content_sha256', 'stored_hash', 'account_hash', 'reason', 'tombstoned_at']), cols.join(','));
ok('3 row level security is on with no policy',
  (await rows(`select relrowsecurity as r from pg_class where oid = 'public.signed_record_tombstones'::regclass`))[0].r === true
  && (await rows(`select count(*)::int as n from pg_policies where tablename = 'signed_record_tombstones'`))[0].n === 0);
{
  const res = {};
  for (const [role, uid] of [['anon', ''], ['authenticated', A]]) {
    const sel = await tryRun(role, 'select * from public.signed_record_tombstones', uid);
    const ins = await tryRun(role, `insert into public.signed_record_tombstones (record_kind, record_id, content_sha256, account_hash) values ('punch_seal', 'x', '${DOC}', '${DOC}')`, uid);
    res[role] = { sel: sel.ok, ins: ins.ok };
  }
  ok('4 anon and authenticated cannot read or write the table', Object.values(res).every((r) => !r.sel && !r.ins), JSON.stringify(res));
  const c1 = await tryRun('anon', CALL(A, [PA], []));
  const c2 = await tryRun('authenticated', CALL(A, [PA], []), A);
  ok('5 anon and authenticated cannot call the writer (not even for their own account)', !c1.ok && !c2.ok, JSON.stringify({ c1: c1.ok, c2: c2.ok }));
}

// ── the run delete-account makes: A's projects and A's portal id ──
const run = await tryRun('service_role', CALL(A, [PA, PA2], ['portal-aaaa1111-k1']));
const t = await rows('select * from public.signed_record_tombstones order by record_kind, record_id');
const byKind = (k) => t.filter((r) => r.record_kind === k);
ok('6 the service role writes one tombstone per signed record of the account: 2 approvals, 1 waiver, 1 contract, 1 field ticket, 1 pay app, 1 seal',
  run.ok && run.rows[0].r.ok === true && run.rows[0].r.written === 7
  && byKind('co_approval').length === 2 && byKind('lien_waiver').length === 1 && byKind('project_contract').length === 1
  && byKind('field_ticket').length === 1 && byKind('aia_pay_app').length === 1 && byKind('punch_seal').length === 1,
  run.err ?? JSON.stringify(run.rows[0].r));
{
  const dump = JSON.stringify(t);
  const personal = ['Jane', 'Homeowner', 'jane@x.test', 'Sam Sub', 'Acme', 'Henderson', 'base64', 'Owner Rep', 'tok-secret', '4200', A];
  const leaked = personal.filter((p) => dump.includes(p));
  ok('7 no tombstone carries a name, an email, a signature, an amount, a project name, a token or the account id', leaked.length === 0, leaked.join(','));
}
{
  const co = byKind('co_approval').find((r) => r.stored_hash === DOC);
  const want = (await rows(`select encode(sha256(convert_to('mageid:legal_acceptance:v1:${A}', 'UTF8')), 'hex') as h`))[0].h;
  const rehash = (await rows(`select encode(sha256(convert_to(to_jsonb(a)::text, 'UTF8')), 'hex') as h from public.change_order_approvals a where change_order_id = 'co-1'`))[0].h;
  ok('8 an approval\'s tombstone carries the portal id, the sealed time, the record\'s own document hash, a recomputable row hash and the account marker',
    !!co && co.counterparty_ref === 'portal-aaaa1111-k1' && new Date(co.signed_at).toISOString() === '2026-09-01T10:00:00.000Z'
    && co.content_sha256 === rehash && t.every((r) => r.account_hash === want) && t.every((r) => r.reason === 'account_deleted'),
    JSON.stringify(co));
}

// ── a wrong list never reaches another account ──
{
  const r = await tryRun('service_role', CALL(A, [PA, PB], []));
  const leaked = await rows(`select t.record_id from public.signed_record_tombstones t join public.change_order_approvals a on a.id::text = t.record_id where a.change_order_id = 'co-9'`);
  const lw = await rows(`select t.record_id from public.signed_record_tombstones t join public.lien_waivers w on w.id::text = t.record_id where w.user_id = '${B}'`);
  ok('9 a project id that is not the account\'s is dropped: B\'s approval and waiver get no tombstone', r.ok && leaked.length === 0 && lw.length === 0, JSON.stringify({ leaked, lw }));
  const r2 = await tryRun('service_role', CALL(A, [PA], ['portal-bbbb2222-k2', 'x","portal-bbbb2222-k2']));
  const leaked2 = await rows(`select t.record_id from public.signed_record_tombstones t join public.change_order_approvals a on a.id::text = t.record_id where a.change_order_id = 'co-9'`);
  ok('10 a portal id that sits on someone else\'s project (or is not an identifier) is dropped', r2.ok && leaked2.length === 0, JSON.stringify(leaked2));
}
ok('11 a field ticket the account wrote on someone else\'s job (handed over, not deleted) gets no tombstone, nor does an unauthorized draft',
  !t.some((r) => r.record_id === 'ft-on-b' || r.record_id === 'ft-draft') && (await rows(`select 1 from public.signed_record_tombstones where record_id in ('ft-on-b', 'ft-draft')`)).length === 0);
{
  const lw = byKind('lien_waiver')[0];
  const withTok = (await rows(`select encode(sha256(convert_to(to_jsonb(w)::text, 'UTF8')), 'hex') as h from public.lien_waivers w where sub_name = 'Acme Electric'`))[0].h;
  const without = (await rows(`select encode(sha256(convert_to((to_jsonb(w) - 'sign_token')::text, 'UTF8')), 'hex') as h from public.lien_waivers w where sub_name = 'Acme Electric'`))[0].h;
  ok('12 a lien waiver\'s row hash leaves the signing key out', !!lw && lw.content_sha256 === without && lw.content_sha256 !== withTok && lw.counterparty_ref === null, JSON.stringify(lw));
}
ok('13 an unsigned waiver, an unsigned contract and an uncertified pay app get no tombstone',
  byKind('lien_waiver').length === 1 && byKind('project_contract').length === 1 && byKind('aia_pay_app').length === 1
  && (await rows(`select count(*)::int as n from public.signed_record_tombstones where record_kind in ('lien_waiver', 'project_contract', 'aia_pay_app')`))[0].n === 3);
{
  const again = await tryRun('service_role', CALL(A, [PA, PA2], ['portal-aaaa1111-k1']));
  const n = (await rows('select count(*)::int as n from public.signed_record_tombstones'))[0].n;
  ok('14 a second run (a retried deletion) writes nothing new', again.ok && again.rows[0].r.written === 0 && n === 7, JSON.stringify({ r: again.rows?.[0]?.r ?? again.err, n }));
}
{
  const upd = await tryRun('service_role', `update public.signed_record_tombstones set signed_at = now()`);
  const oUpd = await tryRun(null, `update public.signed_record_tombstones set record_id = 'x'`);
  await db.exec('grant delete on public.signed_record_tombstones to service_role');
  const del = await tryRun('service_role', `delete from public.signed_record_tombstones`);
  await db.exec('revoke delete on public.signed_record_tombstones from service_role');
  const sIns = await tryRun('service_role', `insert into public.signed_record_tombstones (record_kind, record_id, content_sha256, account_hash) values ('punch_seal', 'forged', '${DOC}', '${DOC}')`);
  ok('15 a tombstone cannot be changed or deleted (even with a DELETE grant), and the service role cannot insert one directly',
    !upd.ok && !oUpd.ok && !del.ok && !sIns.ok && (await rows('select count(*)::int as n from public.signed_record_tombstones'))[0].n === 7,
    JSON.stringify({ upd: upd.ok, oUpd: oUpd.ok, del: del.err, sIns: sIns.ok }));
}

// ── a table that is not there costs that kind only ──
{
  const db2 = new PGlite();
  await db2.exec(BASE_SQL);
  await db2.exec(SCHEMA);
  await db2.exec('drop table public.lien_waivers; alter table public.project_contracts drop column document_hash;');
  let err = null;
  try { await db2.exec(MIG); } catch (e) { err = e; }
  let r = null;
  try { r = (await db2.query(CALL(A, [PA, PA2], ['portal-aaaa1111-k1']))).rows[0].r; } catch (e) { err = e; }
  const n = err ? -1 : (await db2.query(`select count(*)::int as n from public.signed_record_tombstones where record_kind = 'co_approval'`)).rows[0].n;
  ok('16 with lien_waivers missing and a contract column gone, the other kinds are still written and the two are named as skipped',
    !err && r && r.ok === true && n === 2 && r.skipped.some((s) => s.startsWith('lien_waiver')) && r.skipped.some((s) => s.startsWith('project_contract')) && r.written === 5,
    err ? String(err.message) : JSON.stringify(r));
}

// ── the reason it exists: the records go, the tombstones stay ──
{
  await db.exec(`delete from public.change_order_approvals where project_id = '${PA}' or portal_id = 'portal-aaaa1111-k1'`);
  const del = await tryRun('service_role', `delete from auth.users where id = '${A}'`);
  const gone = (await rows(`select (select count(*) from public.lien_waivers where user_id = '${A}')::int as lw, (select count(*) from public.project_contracts where user_id = '${A}')::int as pc, (select count(*) from public.punch_seals where user_id = '${A}')::int as ps`))[0];
  const kept = (await rows('select count(*)::int as n from public.signed_record_tombstones'))[0].n;
  ok('17 after the account is deleted the signed records are gone (as today) and all seven tombstones remain', del.ok && gone.lw === 0 && gone.pc === 0 && gone.ps === 0 && kept === 7, JSON.stringify({ del: del.err, gone, kept }));
}
done();
