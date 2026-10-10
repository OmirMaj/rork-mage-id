// legal-acceptance-scan-room-upload.mjs — PGlite proof of
// 20261011091000_legal_acceptance_scan_room_upload.sql (lane LIVINGSYNC).
// Usage: [MUTATE=<n>] node scripts/pgq/legal-acceptance-scan-room-upload.mjs <worktree>   (one run)
//        node scripts/pgq/legal-acceptance-scan-room-upload.mjs <worktree> --all            (as written + every planted mutation)
// A plant softens the migration's own self-check to a notice where it would catch the plant at
// apply time, so the CASES below are what must go red.
//
// REAL: 20261010100000_legal_acceptances.sql (applied first, as in production) and the migration under proof.
// STUBS: the roles, auth.users and auth.uid() (scripts/pgq/_harness.mjs).
import { BASE_SQL, loadPGlite, makeKit, readMigration, replacer, runAll, worktreeArg } from './_harness.mjs';

const ROOT = worktreeArg('scripts/pgq/legal-acceptance-scan-room-upload.mjs');
const BASE_FILE = '20261010100000_legal_acceptances.sql';
const FILE = '20261011091000_legal_acceptance_scan_room_upload.sql';

if (process.argv[3] === '--all') {
  runAll(import.meta.url, ROOT, {
    1: ['3'],            // the new kind is not in the list: the yes is refused
    2: ['5'],            // the closed list removed: any kind is taken
    3: ['6'],            // anon may call the recorder after the replace
    4: ['7'],            // the recorder is no longer SECURITY DEFINER
    5: ['7'],            // the recorder's search_path is public
    6: ['4'],            // the once-per-wording rule removed from the copy: a second yes writes a second row
    7: ['8'],            // the copy takes the user id from a caller-shaped setting
    8: ['2'],            // the copy differs from the applied function by more than the list
  });
}

const BASE = readMigration(ROOT, BASE_FILE);
let MIG = readMigration(ROOT, FILE);
const MUTATE = Number(process.env.MUTATE || 0);
const rep = replacer(() => MIG, (v) => { MIG = v; }, MUTATE);
const noSelfCheck = () => rep("raise exception '[scan_room_upload] verify:", "raise notice '[scan_room_upload] verify:", true);
const SIG = 'text, text, text, text, text, text, bigint, text';
const LIST5 = "  if p_kind not in ('terms', 'privacy', 'code_answer_ack', 'scan_ack', 'scan_room_upload') then";
const LIST4 = "  if p_kind not in ('terms', 'privacy', 'code_answer_ack', 'scan_ack') then";
const DEFINER = "language plpgsql\nsecurity definer\nset search_path to ''\nas $function$\ndeclare\n  v_uid uuid";
switch (MUTATE) {
  case 0: break;
  case 1: rep(LIST5, LIST4); noSelfCheck(); break;
  case 2: rep(LIST5, '  if false then'); noSelfCheck(); break;
  case 3: rep(`revoke all on function public.record_my_legal_acceptance(${SIG}) from public, anon;`, `grant execute on function public.record_my_legal_acceptance(${SIG}) to anon;`); noSelfCheck(); break;
  case 4: rep(DEFINER, "language plpgsql\nset search_path to ''\nas $function$\ndeclare\n  v_uid uuid"); noSelfCheck(); break;
  case 5: rep(DEFINER, 'language plpgsql\nsecurity definer\nset search_path to public\nas $function$\ndeclare\n  v_uid uuid'); noSelfCheck(); break;
  case 6:
    rep("  if found then\n    return jsonb_build_object('ok', true, 'recorded', false, 'id', v_id, 'accepted_at', v_at);\n  end if;\n\n  select count(*)", '  select count(*)');
    rep('  on conflict (user_id, kind, version, text_sha256) where user_id is not null do nothing\n', '');
    break;
  case 7: rep('v_uid uuid := auth.uid();', "v_uid uuid := coalesce(nullif(current_setting('request.claimed_user', true), '')::uuid, auth.uid());"); break;
  case 8: rep('if v_count >= 400 then', 'if v_count >= 4000 then'); break;
  default: console.error('unknown MUTATE'); process.exit(2);
}
if (MUTATE) console.log(`(planted mutation M${MUTATE} applied)`);

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b2';
const H_EN = 'a'.repeat(64);
const H_ES = 'b'.repeat(64);

const PGlite = await loadPGlite();
const db = new PGlite();
await db.exec(BASE_SQL);
await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.test'), ('${B}', 'b@x.test');`);
const { ok, rows, tryRun, done } = makeKit(db);

// Production's order: the table and the recorder of four kinds are there first, with a row from before.
await db.exec(BASE);
const REC = (kind, version, hash) => `select public.record_my_legal_acceptance('${kind}', '${version}', '${hash}', 'in_app', null, 'ios', null, null) as r`;
const before = await tryRun('authenticated', REC('scan_room_upload', '1', H_EN), A);
const old = await tryRun('authenticated', REC('scan_ack', '1', H_EN), A);
// M6 drops the unique rule from the copy only; the index from the applied file would still stop a second row.
if (MUTATE === 6) await db.exec('drop index if exists public.legal_acceptances_once');
let applyErr = null;
try { await db.exec(MIG); await db.exec(MIG); } catch (e) { applyErr = e; }
ok('1 the migration applies cleanly on top of the applied one, twice (idempotent); before it the new kind is refused and writes nothing',
  applyErr === null && !before.ok && /unknown kind/.test(before.err ?? '') && old.ok,
  applyErr ? String(applyErr.message) : `before: ${before.ok ? 'ran' : before.err}`);
if (applyErr) done();

// The function here is the applied one with ONE line different.
{
  const cut = (text) => {
    const a = text.indexOf('create or replace function public.record_my_legal_acceptance(');
    const b = text.indexOf('$function$;', a);
    return a < 0 || b < 0 ? null : text.slice(a, b);
  };
  const was = cut(BASE);
  const now = cut(MIG);
  const same = was !== null && now !== null && was.split(LIST4).length === 2 && was.replace(LIST4, LIST5) === now;
  ok('2 the recorder in this file is the applied recorder with one line changed: the list of kinds', same, same ? '' : 'the two function texts differ by more than the list (or an anchor is gone)');
}

const yes = await tryRun('authenticated', REC('scan_room_upload', '1', H_EN), A);
const row = (await rows(`select user_id, kind, version, text_sha256, surface, platform, accepted_at from public.legal_acceptances where kind = 'scan_room_upload'`))[0] ?? null;
ok('3 a signed-in account records scan_room_upload: one row, his id, the version and the hash of the words, the server time',
  yes.ok && yes.rows[0].r?.ok === true && yes.rows[0].r?.recorded === true && row?.user_id === A && row?.version === '1' && row?.text_sha256 === H_EN && row?.surface === 'in_app' && row?.platform === 'ios' && !!row?.accepted_at,
  yes.err ?? JSON.stringify(yes.rows?.[0]?.r));

{
  const again = await tryRun('authenticated', REC('scan_room_upload', '1', H_EN), A);
  const es = await tryRun('authenticated', REC('scan_room_upload', '1', H_ES), A);
  const other = await tryRun('authenticated', REC('scan_room_upload', '1', H_EN), B);
  const n = (await rows(`select count(*)::int as n from public.legal_acceptances where kind = 'scan_room_upload'`))[0].n;
  ok('4 the same yes again writes nothing (one row per person per wording); the Spanish wording and another account each get their own row',
    again.ok && again.rows[0].r?.recorded === false && es.ok && es.rows[0].r?.recorded === true && other.ok && other.rows[0].r?.recorded === true && n === 3,
    `again ${again.err ?? JSON.stringify(again.rows?.[0]?.r)} rows ${n}`);
}

{
  const junk = await tryRun('authenticated', REC('made_up_kind', '1', H_EN), A);
  const real = [];
  for (const k of ['terms', 'privacy', 'code_answer_ack', 'scan_ack']) real.push((await tryRun('authenticated', REC(k, 'after-v1', H_ES), A)).ok);
  const n = (await rows(`select count(*)::int as n from public.legal_acceptances where kind = 'made_up_kind'`))[0].n;
  ok('5 the list is still closed: a made-up kind is refused and writes nothing, and the four kinds from before still record',
    !junk.ok && /unknown kind/.test(junk.err ?? '') && n === 0 && real.every(Boolean), `junk ${junk.ok ? 'ran' : junk.err} real ${real.join(',')}`);
}

{
  const call = await tryRun('anon', REC('scan_room_upload', '1', H_EN), '');
  const fn = (await rows(`select has_function_privilege('anon', 'public.record_my_legal_acceptance(${SIG})', 'execute') as a, has_function_privilege('authenticated', 'public.record_my_legal_acceptance(${SIG})', 'execute') as u`))[0];
  ok('6 anon still cannot call the recorder; a signed-in account can', !call.ok && fn.a === false && fn.u === true, `call ${call.ok ? 'ran' : 'refused'} ${JSON.stringify(fn)}`);
}

{
  const f = (await rows(`select prosecdef, proconfig from pg_proc where oid = 'public.record_my_legal_acceptance(${SIG})'::regprocedure`))[0];
  const ins = await tryRun('authenticated', `insert into public.legal_acceptances (user_id, subject_hash, kind, version, text_sha256, surface) values ('${A}', '${'c'.repeat(64)}', 'scan_room_upload', '9', '${H_EN}', 'in_app')`, A);
  ok('7 the recorder is still SECURITY DEFINER with an empty search_path, and still the only way in (a direct insert is refused)',
    f?.prosecdef === true && JSON.stringify(f?.proconfig) === JSON.stringify(['search_path=""']) && !ins.ok, `${JSON.stringify(f)} insert ${ins.ok ? 'ran' : 'refused'}`);
}

{
  await db.query(`select set_config('request.claimed_user', $1, false)`, [B]);
  const claim = await tryRun('authenticated', REC('scan_room_upload', '2', H_EN), A);
  await db.query(`select set_config('request.claimed_user', '', false)`);
  const who = (await rows(`select user_id from public.legal_acceptances where kind = 'scan_room_upload' and version = '2'`))[0]?.user_id ?? null;
  ok('8 the row is stamped with auth.uid(): nothing the caller sets names anyone else', claim.ok && who === A, `${claim.err ?? ''} by ${who}`);
}

done();
