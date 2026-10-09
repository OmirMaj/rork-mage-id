// legal-acceptances.mjs — PGlite proof of 20261010100000_legal_acceptances.sql (lane PROTECT-SERVER).
// Usage: [MUTATE=<n>] node scripts/pgq/legal-acceptances.mjs <worktree>   (one run)
//        node scripts/pgq/legal-acceptances.mjs <worktree> --all            (as written + every planted mutation)
// A plant softens the migration's own self-check to a notice where it would catch the plant at
// apply time, so the CASES below are what must go red.
import { BASE_SQL, loadPGlite, makeKit, readMigration, replacer, runAll, worktreeArg } from './_harness.mjs';

const ROOT = worktreeArg('scripts/pgq/legal-acceptances.mjs');
const FILE = '20261010100000_legal_acceptances.sql';

if (process.argv[3] === '--all') {
  runAll(import.meta.url, ROOT, {
    1: ['6'],            // the client revoke removed: anon and authenticated hold every table privilege
    2: ['7', '8'],       // row level security never switched on: one account reads another's rows
    3: ['7', '8'],       // the read policy is `true`
    4: ['10'],           // the recorder takes the user id from an argument-shaped setting instead of auth.uid()
    5: ['12'],           // accepted_at is taken from the caller's delay (a client time)
    6: ['16', '17'],     // the keep trigger never created: rows can be changed and deleted
    7: ['19'],           // account deletion cascades instead of set null
    8: ['9'],            // anon may call the recorder
    9: ['21'],           // the recorder is not SECURITY DEFINER
    10: ['22'],          // the recorder's search_path is public
    11: ['13'],          // the once-per-version rule removed: a retry writes a second row
    12: ['20'],          // the deletion stamp is not written
    13: ['18'],          // the trigger lets any update through when user_id goes to NULL
    14: ['14'],          // the row cap removed
    15: ['25'],          // the closed list of kinds removed: junk kinds fill a person's limit
    16: ['4'],           // the update id is accepted and thrown away
    17: ['18'],          // the keep trigger lets update_id be rewritten at account deletion
  });
}

let MIG = readMigration(ROOT, FILE);
const MUTATE = Number(process.env.MUTATE || 0);
const rep = replacer(() => MIG, (v) => { MIG = v; }, MUTATE);
const noSelfCheck = () => rep("raise exception '[legal_acceptances] verify:", "raise notice '[legal_acceptances] verify:", true);
const SIG = 'text, text, text, text, text, text, bigint, text';
switch (MUTATE) {
  case 0: break;
  case 1: rep('revoke all on public.legal_acceptances from public, anon, authenticated, service_role;', ''); noSelfCheck(); break;
  case 2: rep('alter table public.legal_acceptances enable row level security;', ''); noSelfCheck(); break;
  case 3: rep('using (user_id = (select auth.uid()));', 'using (true);'); break;
  case 4: rep('v_uid uuid := auth.uid();', "v_uid uuid := coalesce(nullif(current_setting('request.claimed_user', true), '')::uuid, auth.uid());"); break;
  case 5: rep("     pg_catalog.clock_timestamp(), v_delay)", "     pg_catalog.clock_timestamp() - (coalesce(v_delay, 0)::double precision * interval '1 millisecond'), v_delay)"); break;
  case 6: rep('create trigger legal_acceptances_keep\n  before update or delete on public.legal_acceptances\n  for each row execute function public.legal_acceptances_keep();', ''); noSelfCheck(); break;
  case 7: rep('references auth.users(id) on delete set null', 'references auth.users(id) on delete cascade'); break;
  case 8: rep(`revoke all on function public.record_my_legal_acceptance(${SIG}) from public, anon;`, ''); noSelfCheck(); break;
  case 9: rep('language plpgsql\nsecurity definer\nset search_path to \'\'\nas $function$\ndeclare\n  v_uid uuid', 'language plpgsql\nset search_path to \'\'\nas $function$\ndeclare\n  v_uid uuid'); noSelfCheck(); break;
  case 10: rep('language plpgsql\nsecurity definer\nset search_path to \'\'\nas $function$\ndeclare\n  v_uid uuid', 'language plpgsql\nsecurity definer\nset search_path to public\nas $function$\ndeclare\n  v_uid uuid'); noSelfCheck(); break;
  case 11:
    rep('create unique index if not exists legal_acceptances_once\n  on public.legal_acceptances (user_id, kind, version, text_sha256) where user_id is not null;',
      'create index if not exists legal_acceptances_once\n  on public.legal_acceptances (user_id, kind, version, text_sha256) where user_id is not null;');
    rep("  if found then\n    return jsonb_build_object('ok', true, 'recorded', false, 'id', v_id, 'accepted_at', v_at);\n  end if;\n\n  select count(*)", '  select count(*)');
    rep('  on conflict (user_id, kind, version, text_sha256) where user_id is not null do nothing\n', '');
    break;
  case 12: rep('new.account_deleted_at := coalesce(old.account_deleted_at, pg_catalog.clock_timestamp());', ''); break;
  case 13: rep("     and new.id = old.id\n     and new.subject_hash is not distinct from old.subject_hash", '     and new.id = old.id'); rep('     and new.surface = old.surface\n', ''); rep('     and new.version = old.version\n', ''); break;
  case 14: rep('if v_count >= 400 then', 'if v_count >= 400000 then'); break;
  case 15: rep("  if p_kind not in ('terms', 'privacy', 'code_answer_ack', 'scan_ack') then", '  if false then'); break;
  case 16: rep('    v_update := p_update_id;\n', '    v_update := null;\n'); break;
  case 17: rep('     and new.update_id is not distinct from old.update_id\n', ''); break;
  default: console.error('unknown MUTATE'); process.exit(2);
}
if (MUTATE) console.log(`(planted mutation M${MUTATE} applied)`);

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b2';
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const UPD = '0198c5a2-7d3e-7b61-9f04-2c1d5e6f7a8b';   // an over-the-air update id

const PGlite = await loadPGlite();
const db = new PGlite();
await db.exec(BASE_SQL);
await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.test'), ('${B}', 'b@x.test');`);
const { ok, rows, tryRun, done } = makeKit(db);

let applyErr = null;
try { await db.exec(MIG); await db.exec(MIG); } catch (e) { applyErr = e; }
ok('1 the migration applies cleanly, twice (idempotent)', applyErr === null, applyErr ? String(applyErr.message) : '');
if (applyErr) done();

const REC = (kind = 'terms', version = '2026-05-12', hash = H1, surface = 'signup_email', extra = `'1.0.0 (18)', 'ios', null, '${UPD}'`) =>
  `select public.record_my_legal_acceptance('${kind}', '${version}', '${hash}', '${surface}', ${extra}) as r`;

const cols = (await rows(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'legal_acceptances' order by ordinal_position`)).map((r) => r.column_name);
const WANT = ['id', 'user_id', 'subject_hash', 'subject_kind', 'subject_ref', 'kind', 'version', 'text_sha256', 'surface', 'app_version', 'platform', 'update_id', 'accepted_at', 'reported_delay_ms', 'account_deleted_at'];
ok('2 the columns are exactly the list in the header (no IP, user agent, email or token column)', JSON.stringify(cols) === JSON.stringify(WANT), cols.join(','));

// ── the account path ──
const before = (await rows('select clock_timestamp() as t'))[0].t;
const a1 = await tryRun('authenticated', REC(), A);
const after = (await rows('select clock_timestamp() as t'))[0].t;
ok('3 a signed-in person records an acceptance (recorded: true)', a1.ok && a1.rows[0].r.ok === true && a1.rows[0].r.recorded === true, a1.err ?? JSON.stringify(a1.rows));
const row1 = (await rows(`select * from public.legal_acceptances where user_id = '${A}'`))[0] ?? {};
ok('4 the row is stamped with the caller, kind, version, words, surface, build, update id and platform',
  row1.update_id === UPD && row1.user_id === A && row1.kind === 'terms' && row1.version === '2026-05-12' && row1.text_sha256 === H1 && row1.surface === 'signup_email' && row1.app_version === '1.0.0 (18)' && row1.platform === 'ios' && row1.subject_kind === 'account',
  JSON.stringify(row1));
const wantHash = (await rows(`select encode(sha256(convert_to('mageid:legal_acceptance:v1:${A}', 'UTF8')), 'hex') as h`))[0].h;
ok('5 subject_hash is the SHA-256 of the fixed prefix and the account id (and is not the id)', row1.subject_hash === wantHash && row1.subject_hash !== A);

// ── clients hold no write privilege ──
{
  const privs = {};
  for (const role of ['anon', 'authenticated']) {
    privs[role] = (await rows(`select ${['select', 'insert', 'update', 'delete', 'truncate'].map((p) => `has_table_privilege('${role}', 'public.legal_acceptances', '${p}') as ${p}`).join(', ')}`))[0];
  }
  const anonSel = await tryRun('anon', 'select * from public.legal_acceptances');
  const ins = await tryRun('authenticated', `insert into public.legal_acceptances (user_id, subject_hash, kind, version, text_sha256, surface) values ('${A}', '${H1}', 'privacy', 'v', '${H1}', 'signup_email')`, A);
  const upd = await tryRun('authenticated', `update public.legal_acceptances set version = 'x'`, A);
  const del = await tryRun('authenticated', `delete from public.legal_acceptances`, A);
  ok('6 anon holds nothing; authenticated holds SELECT only and cannot insert, update or delete directly',
    Object.values(privs.anon).every((v) => v === false) && !anonSel.ok
    && privs.authenticated.select === true && !privs.authenticated.insert && !privs.authenticated.update && !privs.authenticated.delete && !privs.authenticated.truncate
    && !ins.ok && !upd.ok && !del.ok,
    JSON.stringify({ privs, anonSel: anonSel.ok, ins: ins.ok, upd: upd.ok, del: del.ok }));
}

// ── reads ──
await tryRun('authenticated', REC('privacy', '2026-10-04', H2), B);
const aSees = await tryRun('authenticated', 'select user_id from public.legal_acceptances', A);
const bSees = await tryRun('authenticated', 'select user_id from public.legal_acceptances', B);
ok('7 a person reads their own rows', aSees.ok && aSees.n === 1 && aSees.rows[0].user_id === A, JSON.stringify(aSees));
ok('8 and never another person\'s', bSees.ok && bSees.n === 1 && bSees.rows.every((r) => r.user_id === B), JSON.stringify(bSees));

const anonCall = await tryRun('anon', REC());
const signedOut = await tryRun('authenticated', REC(), '');
ok('9 anon cannot call the recorder, and a call with no signed-in user is refused',
  !anonCall.ok && /permission denied/i.test(anonCall.err) && !signedOut.ok && /not signed in/.test(signedOut.err), JSON.stringify({ anonCall, signedOut }));

// ── the caller cannot name someone else ──
{
  await db.query(`select set_config('request.claimed_user', $1, false)`, [B]);
  const r = await tryRun('authenticated', REC('code_answer_ack', '1', H1, 'in_app'), A);
  await db.query(`select set_config('request.claimed_user', '', false)`);
  const who = await rows(`select user_id from public.legal_acceptances where kind = 'code_answer_ack'`);
  ok('10 the user id comes from auth.uid() and nothing the caller can set', r.ok && who.length === 1 && who[0].user_id === A, JSON.stringify(who));
}

// ── time is the server's ──
ok('11 accepted_at is the server clock at the write', new Date(row1.accepted_at) >= new Date(before) && new Date(row1.accepted_at) <= new Date(after), `${row1.accepted_at}`);
{
  const t0 = (await rows('select clock_timestamp() as t'))[0].t;
  const r = await tryRun('authenticated', REC('scan_ack', '1', H1, 'in_app', `null, 'web', 86400000`), A);
  const row = (await rows(`select accepted_at, reported_delay_ms from public.legal_acceptances where kind = 'scan_ack'`))[0] ?? {};
  ok('12 a reported delay of a day is stored beside the time and does not move accepted_at',
    r.ok && Number(row.reported_delay_ms) === 86400000 && new Date(row.accepted_at) >= new Date(t0), JSON.stringify(row));
}

// ── once per (person, kind, version, words) ──
{
  const again = await tryRun('authenticated', REC('terms', '2026-05-12', H1, 'login_first'), A);
  const n = (await rows(`select count(*)::int as n, min(surface) as s from public.legal_acceptances where user_id = '${A}' and kind = 'terms' and version = '2026-05-12'`))[0];
  const newer = await tryRun('authenticated', REC('terms', '2026-11-01', H2, 'reaccept'), A);
  const n2 = (await rows(`select count(*)::int as n from public.legal_acceptances where user_id = '${A}' and kind = 'terms'`))[0].n;
  ok('13 a second call for the same version writes nothing (recorded: false, first surface kept); a new version writes a new row',
    again.ok && again.rows[0].r.recorded === false && n.n === 1 && n.s === 'signup_email' && newer.ok && newer.rows[0].r.recorded === true && n2 === 2,
    JSON.stringify({ again: again.rows ?? again.err, n, n2 }));
}
{
  // Fill B to the cap with direct inserts (as the table owner), then ask once more.
  await db.exec(`insert into public.legal_acceptances (user_id, subject_hash, kind, version, text_sha256, surface)
    select '${B}', '${H1}', 'terms', 'fill-' || g, '${H1}', 'in_app' from generate_series(1, 400) g`);
  const r = await tryRun('authenticated', REC('terms', 'one-more', H1, 'in_app'), B);
  ok('14 a person with 400 rows gets ok: false, reason limit, and no new row', r.ok && r.rows[0].r.ok === false && r.rows[0].r.reason === 'limit', JSON.stringify(r.rows ?? r.err));
}
{
  const bad = [
    REC('Terms & Conditions'), REC('terms', 'v 1; drop'), REC('terms', 'v1', 'nothex'), REC('terms', 'v1', H1, 'portal'), REC('terms', 'v1', H1, 'signing_link'),
  ];
  const res = [];
  for (const q of bad) res.push((await tryRun('authenticated', q, A)).ok);
  const odd = await tryRun('authenticated', REC('privacy', 'odd-build', H1, 'in_app', `E'<script>\\n', 'windows', -5, 'not an id!'`), A);
  const oddRow = (await rows(`select app_version, platform, reported_delay_ms, update_id from public.legal_acceptances where version = 'odd-build'`))[0] ?? {};
  ok('15 prose in kind, version, hash or a no-account surface is refused; an odd build string, update id, platform or delay is dropped and the record still lands',
    res.every((v) => v === false) && odd.ok && oddRow.update_id === null && oddRow.app_version === null && oddRow.platform === null && oddRow.reported_delay_ms === null, JSON.stringify({ res, odd: odd.err, oddRow }));
}

{
  const junk = [];
  for (let i = 0; i < 5; i++) junk.push((await tryRun('authenticated', REC(`junk_kind_${i}`, 'v1', H1, 'in_app'), A)).ok);
  const n = (await rows(`select count(*)::int as n from public.legal_acceptances where kind like 'junk%'`))[0].n;
  const real = [];
  for (const k of ['terms', 'privacy', 'code_answer_ack', 'scan_ack']) real.push((await tryRun('authenticated', REC(k, 'kinds-v1', H2, 'in_app'), A)).ok);
  ok('25 a kind outside the four the app has is refused and writes nothing (junk kinds cannot fill the limit); the four are accepted', junk.every((v) => v === false) && n === 0 && real.every((v) => v === true), JSON.stringify({ junk, n, real }));
}

// ── nothing is changed or removed, by anyone ──
{
  const sUpd = await tryRun('service_role', `update public.legal_acceptances set version = 'x' where user_id = '${A}'`);
  const oUpd = await tryRun(null, `update public.legal_acceptances set surface = 'reaccept' where user_id = '${A}'`);
  ok('16 a row cannot be changed: not by the service role, not by the table owner', !sUpd.ok && !oUpd.ok, JSON.stringify({ sUpd: sUpd.ok, oUpd: oUpd.ok }));
  const sDel = await tryRun('service_role', `delete from public.legal_acceptances where user_id = '${A}'`);
  await db.exec(`grant delete on public.legal_acceptances to service_role`);
  const sDel2 = await tryRun('service_role', `delete from public.legal_acceptances where user_id = '${A}'`);
  await db.exec(`revoke delete on public.legal_acceptances from service_role`);
  const left = (await rows(`select count(*)::int as n from public.legal_acceptances where user_id = '${A}'`))[0].n;
  ok('17 a row cannot be deleted by the service role, even if someone grants it DELETE (the trigger refuses)', !sDel.ok && !sDel2.ok && left >= 4, JSON.stringify({ sDel: sDel.err, sDel2: sDel2.err, left }));
  const sneaky = await tryRun(null, `update public.legal_acceptances set user_id = null, version = 'rewritten', surface = 'reaccept' where user_id = '${A}' and kind = 'scan_ack'`);
  const sneaky2 = await tryRun(null, `update public.legal_acceptances set user_id = null, update_id = 'another-bundle' where user_id = '${A}' and kind = 'scan_ack'`);
  ok('18 an update that nulls user_id AND changes anything else (the version, the surface, the update id) is refused', !sneaky.ok && !sneaky2.ok, JSON.stringify({ sneaky, sneaky2 }));
}

// ── account deletion ──
{
  const idsBefore = (await rows(`select id from public.legal_acceptances where user_id = '${A}' order by id`)).map((r) => String(r.id));
  const del = await tryRun('service_role', `delete from auth.users where id = '${A}'`);
  const kept = await rows(`select id, user_id, subject_hash, kind, version, account_deleted_at from public.legal_acceptances where subject_hash = '${wantHash}' order by id`);
  ok('19 deleting the account keeps every row, with user_id NULL and the marker unchanged',
    del.ok && kept.length === idsBefore.length && kept.length >= 4 && kept.every((r) => r.user_id === null && r.subject_hash === wantHash),
    JSON.stringify({ del: del.err, before: idsBefore.length, kept: kept.length }));
  ok('20 and the server stamps account_deleted_at on each', kept.length > 0 && kept.every((r) => r.account_deleted_at !== null), JSON.stringify(kept.slice(0, 2)));
}

// ── the function's own shape ──
{
  const f = (await rows(`select prosecdef, proconfig, (select rolname from pg_roles where oid = proowner) as owner from pg_proc where proname = 'record_my_legal_acceptance'`))[0];
  ok('21 the recorder is SECURITY DEFINER and not owned by a client role', f.prosecdef === true && !['anon', 'authenticated'].includes(f.owner), JSON.stringify(f));
  ok('22 the recorder\'s search_path is empty', Array.isArray(f.proconfig) && f.proconfig.includes('search_path=""'), JSON.stringify(f.proconfig));
  const sIns = await tryRun('service_role', `insert into public.legal_acceptances (user_id, subject_hash, kind, version, text_sha256, surface) values ('${B}', '${H1}', 'terms', 'forged', '${H1}', 'in_app')`);
  const sSel = await tryRun('service_role', 'select count(*)::int as n from public.legal_acceptances');
  ok('23 the service role reads every row and cannot insert one', !sIns.ok && sSel.ok && sSel.rows[0].n > 400, JSON.stringify({ sIns: sIns.ok, sSel: sSel.rows ?? sSel.err }));
  const bad1 = await tryRun(null, `insert into public.legal_acceptances (user_id, subject_kind, subject_ref, kind, version, text_sha256, surface) values (null, 'portal', 'tok en with spaces', 'terms', 'v1', '${H1}', 'portal')`);
  const bad2 = await tryRun(null, `insert into public.legal_acceptances (user_id, subject_hash, subject_kind, subject_ref, kind, version, text_sha256, surface) values ('${B}', '${H1}', 'account', 'portal-1', 'terms', 'v2', '${H1}', 'in_app')`);
  const good = await tryRun(null, `insert into public.legal_acceptances (user_id, subject_kind, subject_ref, kind, version, text_sha256, surface) values (null, 'portal', 'portal-1a2b3c4d-abc', 'terms', 'v1', '${H1}', 'portal')`);
  ok('24 a no-account row needs a token ID made of identifier characters and no account; an account row carries no token id', !bad1.ok && !bad2.ok && good.ok, JSON.stringify({ bad1: bad1.ok, bad2: bad2.ok, good: good.err }));
}
done();
