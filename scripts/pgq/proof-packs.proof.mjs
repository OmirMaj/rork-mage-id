// scripts/pgq/proof-packs.proof.mjs
// PGlite proof of supabase/migrations/20261009120000_proof_packs.sql (the
// fingerprint record of a Pay Period Record).
//
//   PGLITE_DIR=<folder outside the repo> node scripts/pgq/proof-packs.proof.mjs
//   NO_MUTATIONS=1 ...   the checks only (faster)
//
// WHAT RUNS. The migration file VERBATIM, applied TWICE (so it is re-runnable
// and its self-check passes both times), on a database with the roles anon /
// authenticated / service_role, auth.uid() read from the JWT claim, Supabase's
// default privileges, auth.users, and a minimal public.projects (id, user_id:
// the two columns the migration reads). Then every check below. Then the same
// checks against the file with ONE guard removed at a time: each planted
// mutation names the checks that must go red, and is caught only if they do.
//
// STUBS: the roles, auth.uid(), the default privileges, public.projects. The
// table, policy, trigger and four functions under test are the migration's own.
// Where a mutation would be stopped by the file's own self-check at apply
// time, the self-check is softened (raise -> notice) for that run so the
// BEHAVIOUR is what catches it; two more mutations leave the self-check as
// written and must be refused at apply.
import { createHash } from 'node:crypto';
import { loadPGlite, migration, SUPABASE_BASE, openDb, recorder, swap, judge } from './lib.mjs';

const PGlite = await loadPGlite();
const MIG = migration('20261009120000_proof_packs.sql');

const sha = (s) => createHash('sha256').update(s).digest('hex');
// The same rule as utils/proofPack/fingerprint.ts checkCodeOf: the first 50
// bits of the hash in Crockford base 32, five and five.
const CROCK = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function checkCodeJs(h) {
  let bits = '';
  for (const ch of h.slice(0, 13)) bits += parseInt(ch, 16).toString(2).padStart(4, '0');
  bits = bits.slice(0, 50);
  let out = '';
  for (let i = 0; i < 50; i += 5) out += CROCK[parseInt(bits.slice(i, i + 5), 2)];
  return out.slice(0, 5) + '-' + out.slice(5);
}

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const PA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';   // A's project
const PA2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';  // A's second project
const PB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';   // B's project
const H1 = sha('one'); const H2 = sha('two'); const H3 = sha('three');
const F1 = sha('file-1'); const F2 = sha('file-2');

async function battery(sql) {
  const { ok, pass, fail } = recorder();
  const { db, as, root } = await openDb(PGlite);
  try {
    await db.exec(SUPABASE_BASE);
    await db.exec(`
      create table public.projects (id uuid primary key default gen_random_uuid(), user_id uuid not null, name text not null default '');
      insert into auth.users (id) values ('${A}'), ('${B}');
      insert into public.projects (id, user_id, name) values ('${PA}', '${A}', 'Alder'), ('${PA2}', '${A}', 'Ash'), ('${PB}', '${B}', 'Birch');`);
    try { await db.exec(sql); await db.exec(sql); ok('P01', true, 'the file applies twice and its self-check passes both times'); }
    catch (e) { ok('P01', false, `apply refused: ${e.message}`); return { pass, fail }; }

    const create = (role, uid, pid, hash, x = {}) => as(role, uid,
      `select public.proof_pack_create_v1($1,$2,$3,$4,$5,$6,$7,$8) as r`,
      [pid, x.kind ?? 'pay_app', x.payId ?? 'app-1', hash, x.items ?? 7, x.left ?? 1, x.initial ?? ' henderson', x.city ?? 'Baltimore']);
    const count = async (where, params = []) => (await root(`select count(*)::int as n from public.proof_packs where ${where}`, params)).rows[0]?.n;

    // P02: the owner creates; the code is made on the server from the hash.
    const c2 = await create('authenticated', A, PA, H1);
    const r2 = c2.rows[0]?.r;
    ok('P02', !c2.err && r2?.content_hash === H1 && r2?.check_code === checkCodeJs(H1) && !!r2?.created_at && r2?.pdf_hash === null,
      c2.err?.message ?? JSON.stringify(r2));

    // P03: the stored time is the server's now(); the caller has no way to send one.
    const c3 = (await root(`select abs(extract(epoch from (now() - created_at))) < 120 as fresh from public.proof_packs where content_hash = $1`, [H1])).rows[0];
    const args = (await root(`select pg_get_function_identity_arguments('public.proof_pack_create_v1(text,text,text,text,integer,integer,text,text)'::regprocedure) as a`)).rows[0]?.a ?? '';
    ok('P03', c3?.fresh === true && !/created_at|check_code/.test(args), `${JSON.stringify(c3)} args: ${args}`);

    // P04: the same hash again returns the row on file, not a second one.
    const c4 = await create('authenticated', A, PA, H1);
    ok('P04', !c4.err && c4.rows[0]?.r?.id === r2?.id && c4.rows[0]?.r?.created_at === r2?.created_at && (await count('content_hash = $1', [H1])) === 1,
      c4.err?.message ?? `rows ${await count('content_hash = $1', [H1])}`);

    // P05: someone who does not own the project is refused; so is a project that does not exist.
    const c5a = await create('authenticated', B, PA, H2);
    const c5b = await create('authenticated', A, 'cccccccc-cccc-cccc-cccc-cccccccccccc', H2);
    const c5c = await create('authenticated', A, 'not-a-uuid', H2);
    ok('P05', /not_project_owner/.test(c5a.err?.message ?? '') && /not_project_owner/.test(c5b.err?.message ?? '')
      && /bad_project/.test(c5c.err?.message ?? '') && (await count('content_hash = $1', [H2])) === 0,
      `${c5a.err?.message} | ${c5b.err?.message} | ${c5c.err?.message}`);

    // P06: a hash that is not 64 hex, a bad pay kind and a negative count are each refused by name.
    const c6a = await create('authenticated', A, PA, 'abc');
    const c6b = await create('authenticated', A, PA, H2, { kind: 'estimate' });
    const c6c = await create('authenticated', A, PA, H2, { left: -1 });
    const c6d = await create('authenticated', A, PA, H2.toUpperCase());
    ok('P06', /bad_hash/.test(c6a.err?.message ?? '') && /bad_pay_kind/.test(c6b.err?.message ?? '') && /bad_count/.test(c6c.err?.message ?? '')
      && !c6d.err && c6d.rows[0]?.r?.content_hash === H2, `${c6a.err?.message} | ${c6b.err?.message} | ${c6c.err?.message} | ${c6d.err?.message}`);
    const idH2 = c6d.rows[0]?.r?.id;

    // P07: a signed-in account cannot insert, update or delete the table directly.
    const c7a = await as('authenticated', A, `insert into public.proof_packs (user_id, project_id, pay_kind, pay_id, content_hash, check_code, item_count, left_out_count) values ($1,$2,'pay_app','x',$3,'00000-00000',1,0)`, [A, PA, H3]);
    const c7b = await as('authenticated', A, `update public.proof_packs set item_count = 99 where content_hash = $1`, [H1]);
    const c7c = await as('authenticated', A, `delete from public.proof_packs where content_hash = $1`, [H1]);
    const st7 = (await root(`select item_count from public.proof_packs where content_hash = $1`, [H1])).rows[0];
    ok('P07', !!c7a.err && !!c7b.err && !!c7c.err && st7?.item_count === 7 && (await count('content_hash = $1', [H3])) === 0,
      `${c7a.err?.message} | ${c7b.err?.message} | ${c7c.err?.message} | ${JSON.stringify(st7)}`);

    // P08: anon cannot read the table.
    const c8 = await as('anon', null, `select content_hash from public.proof_packs`);
    ok('P08', /permission denied/.test(c8.err?.message ?? ''), c8.err?.message ?? `read ${c8.rows.length} rows`);

    // P09: anon cannot write the table directly, and cannot run either function.
    const c9a = await as('anon', null, `insert into public.proof_packs (user_id, project_id, pay_kind, pay_id, content_hash, check_code, item_count, left_out_count) values ($1,$2,'pay_app','x',$3,'00000-00000',1,0)`, [A, PA, H3]);
    const c9b = await as('anon', null, `update public.proof_packs set item_count = 98`);
    const c9c = await as('anon', null, `delete from public.proof_packs`);
    const c9d = await as('anon', null, `select public.proof_pack_create_v1($1,'pay_app','x',$2,1,0,'','') as r`, [PA, H3]);
    const c9e = await as('anon', null, `select public.proof_pack_attach_pdf_v1($1,$2) as r`, [r2?.id, F2]);
    ok('P09', [c9a, c9b, c9c, c9d, c9e].every((c) => /permission denied/.test(c.err?.message ?? '')) && (await count('content_hash = $1', [H3])) === 0,
      [c9a, c9b, c9c, c9d, c9e].map((c) => c.err?.message ?? 'NO ERROR').join(' | '));

    // P10: the owner reads their rows; another account reads none of them.
    const c10a = await as('authenticated', A, `select content_hash from public.proof_packs`);
    const c10b = await as('authenticated', B, `select content_hash from public.proof_packs`);
    ok('P10', !c10a.err && c10a.rows.length === 2 && !c10b.err && c10b.rows.length === 0, `A reads ${c10a.rows.length}, B reads ${c10b.rows.length}`);

    // P11: the file fingerprint attaches once; a second one does not replace it.
    const c11a = await as('authenticated', A, `select public.proof_pack_attach_pdf_v1($1,$2) as r`, [r2?.id, F1]);
    const c11b = await as('authenticated', A, `select public.proof_pack_attach_pdf_v1($1,$2) as r`, [r2?.id, F2]);
    const st11 = (await root(`select pdf_hash from public.proof_packs where id = $1`, [r2?.id])).rows[0];
    ok('P11', !c11a.err && c11a.rows[0]?.r?.pdf_hash === F1 && c11a.rows[0]?.r?.attached_now === true
      && c11b.rows[0]?.r?.pdf_hash === F1 && c11b.rows[0]?.r?.attached_now === false && st11?.pdf_hash === F1,
      `${c11a.err?.message} | ${c11b.err?.message ?? JSON.stringify(c11b.rows[0]?.r)}`);

    // P12: another account cannot attach to a row it does not own.
    const c12 = await as('authenticated', B, `select public.proof_pack_attach_pdf_v1($1,$2) as r`, [idH2, F2]);
    const st12 = (await root(`select pdf_hash from public.proof_packs where id = $1`, [idH2])).rows[0];
    ok('P12', /not_found/.test(c12.err?.message ?? '') && st12?.pdf_hash === null, `${c12.err?.message} | ${JSON.stringify(st12)}`);

    // P13: the trigger holds even for the table's owner (a definer function gone wrong).
    const c13a = await root(`update public.proof_packs set content_hash = $2 where content_hash = $1`, [H1, H3]);
    ok('P13a', /cannot be changed/.test(c13a.err?.message ?? ''), c13a.err?.message ?? 'no error');
    const c13b = await root(`update public.proof_packs set pdf_hash = $2, pdf_attached_at = now() where content_hash = $1`, [H1, F2]);
    ok('P13b', /attached once/.test(c13b.err?.message ?? ''), c13b.err?.message ?? 'no error');
    const c13c = await root(`delete from public.proof_packs where content_hash = $1`, [H1]);
    ok('P13c', /cannot be deleted/.test(c13c.err?.message ?? ''), c13c.err?.message ?? 'no error');

    // P14: the server's check code equals the JavaScript rule on 200 hashes and the two ends.
    let diff = 0;
    const probes = [...Array.from({ length: 200 }, (_, i) => sha('probe-' + i)), '0'.repeat(64), 'f'.repeat(64)];
    for (const h of probes) { if ((await root(`select public.proof_pack_check_code($1) as c`, [h])).rows[0]?.c !== checkCodeJs(h)) diff++; }
    const c14n = (await root(`select public.proof_pack_check_code('xyz') as c`)).rows[0]?.c;
    ok('P14', diff === 0 && c14n === null, `${diff} of ${probes.length} differ; a non-hash gives ${c14n}`);

    // P15: the two fields a public page would show are trimmed: one upper-case letter, 80 characters.
    const c15 = await create('authenticated', B, PB, H3, { initial: '  birch tower', city: ' ' + 'x'.repeat(200) });
    const st15 = (await root(`select project_initial, char_length(city) as n from public.proof_packs where content_hash = $1`, [H3])).rows[0];
    ok('P15', !c15.err && st15?.project_initial === 'B' && st15?.n === 80, c15.err?.message ?? JSON.stringify(st15));

    // P16: the table carries no column for money, a name or an address.
    const cols = (await root(`select column_name from information_schema.columns where table_schema='public' and table_name='proof_packs' order by 1`)).rows.map((r) => r.column_name);
    const want = ['check_code', 'city', 'content_hash', 'created_at', 'id', 'item_count', 'left_out_count', 'pay_id', 'pay_kind', 'pdf_attached_at', 'pdf_hash', 'project_id', 'project_initial', 'user_id'];
    ok('P16', JSON.stringify(cols) === JSON.stringify(want), cols.join(','));

    // The cap. Rows are seeded by the table's owner (the cap lives in the
    // function, so only calls to the function are refused).
    const seed = (uid, pid, n, tag) => root(
      `insert into public.proof_packs (user_id, project_id, pay_kind, pay_id, content_hash, check_code, item_count, left_out_count)
       select $1::uuid, $2::uuid, 'pay_app', 'seed', h, public.proof_pack_check_code(h), 1, 0
         from (select encode(sha256(($4 || g)::bytea), 'hex') as h from generate_series(1, $3::int) g) s`, [uid, pid, n, tag]);

    // P17: one project holds 400. A has 2 rows on PA; seed to 399; the 400th lands, the 401st is refused, nothing is written.
    const s17 = await seed(A, PA, 397, 'pa-');
    const before17 = await count('user_id = $1 and project_id = $2', [A, PA]);
    const c17a = await create('authenticated', A, PA, sha('cap-400'));
    const c17b = await create('authenticated', A, PA, sha('cap-401'));
    ok('P17', !s17.err && before17 === 399 && !c17a.err && !!c17a.rows[0]?.r?.id
      && /proof_pack_project_limit/.test(c17b.err?.message ?? '') && (await count('user_id = $1 and project_id = $2', [A, PA])) === 400,
      `seed ${s17.err?.message ?? 'ok'}; before ${before17}; 400th ${c17a.err?.message ?? 'ok'}; 401st ${c17b.err?.message ?? 'NOT REFUSED'}`);

    // P18: a fingerprint already on file is returned at the cap: it is not a new row and is not counted.
    const c18 = await create('authenticated', A, PA, H1);
    ok('P18', !c18.err && c18.rows[0]?.r?.id === r2?.id && (await count('user_id = $1 and project_id = $2', [A, PA])) === 400,
      c18.err?.message ?? JSON.stringify(c18.rows[0]?.r));

    // P19: the full project does not stop the account's other project.
    const c19 = await create('authenticated', A, PA2, sha('other-project'));
    ok('P19', !c19.err && !!c19.rows[0]?.r?.id, c19.err?.message ?? 'ok');

    // P20: one account holds 5,000. A has 401; seed PA2-side rows on ids no project needs
    // (project_id has no foreign key) to 4,999; the 5,000th lands, the next is refused.
    const s20 = await seed(A, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 4598, 'acct-');
    const before20 = await count('user_id = $1', [A]);
    const c20a = await create('authenticated', A, PA2, sha('acct-5000'));
    const c20b = await create('authenticated', A, PA2, sha('acct-5001'));
    const c20c = await create('authenticated', A, PA2, sha('other-project'));
    ok('P20', !s20.err && before20 === 4999 && !c20a.err && /proof_pack_account_limit/.test(c20b.err?.message ?? '')
      && !c20c.err && c20c.rows[0]?.r?.id === c19.rows[0]?.r?.id && (await count('user_id = $1', [A])) === 5000,
      `before ${before20}; 5000th ${c20a.err?.message ?? 'ok'}; 5001st ${c20b.err?.message ?? 'NOT REFUSED'}; repeat ${c20c.err?.message ?? 'ok'}`);

    // P21: another account is not held back by A's full account.
    const c21 = await create('authenticated', B, PB, sha('b-two'));
    ok('P21', !c21.err && !!c21.rows[0]?.r?.id, c21.err?.message ?? 'ok');

    // P22: deleting the account removes its records (the cascade passes the trigger); the service role can delete too.
    const c22 = await root(`delete from auth.users where id = $1`, [B]);
    const c22b = await as('service_role', null, `delete from public.proof_packs where content_hash = $1`, [sha('cap-400')]);
    ok('P22', !c22.err && (await count('user_id = $1', [B])) === 0 && !c22b.err && c22b.n === 1, `${c22.err?.message ?? ''} ${c22b.err?.message ?? ''}`);
  } catch (e) {
    ok('CRASH', false, e.message);
  } finally {
    await db.close();
  }
  return { pass, fail };
}

// The file's own self-check, softened so a planted fault reaches the checks.
const soften = (s) => s.split("raise exception '[proof_packs] verify:").join("raise notice '[proof_packs] verify:");

const MUTATIONS = [
  { what: 'anyone signed in may create on any project', red: ['P05'],
    edit: (s) => soften(swap(s, '  if not exists (select 1 from public.projects p where p.id = v_pid and p.user_id = v_me) then', '  if false then')) },
  { what: 'every account reads every row', red: ['P10'],
    edit: (s) => soften(swap(s, '  using (user_id = auth.uid());', '  using (true);')) },
  { what: 'the app may write the table directly', red: ['P07'],
    edit: (s) => soften(swap(s, 'grant select on public.proof_packs to authenticated;', 'grant select, insert, update, delete on public.proof_packs to authenticated;\ndrop policy if exists proof_packs_x on public.proof_packs;\ncreate policy proof_packs_x on public.proof_packs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());')) },
  { what: 'the same, with the self-check left as written: the apply itself must be refused', red: ['P01'],
    edit: (s) => swap(s, 'grant select on public.proof_packs to authenticated;', 'grant select, insert, update, delete on public.proof_packs to authenticated;') },
  { what: 'anon may read the table', red: ['P08'],
    edit: (s) => soften(swap(s, 'grant select on public.proof_packs to authenticated;', 'grant select on public.proof_packs to authenticated, anon;\ndrop policy if exists proof_packs_y on public.proof_packs;\ncreate policy proof_packs_y on public.proof_packs for select to anon using (true);')) },
  { what: 'anon may write the table and run the create function', red: ['P09'],
    edit: (s) => soften(swap(swap(s, 'grant select on public.proof_packs to authenticated;', 'grant select on public.proof_packs to authenticated;\ngrant insert, update, delete on public.proof_packs to anon;'),
      'revoke execute on function public.proof_pack_create_v1(text, text, text, text, int, int, text, text) from public, anon;', '')) },
  { what: 'the trigger no longer pins the fingerprint', red: ['P13a'],
    edit: (s) => swap(s, '     or new.content_hash is distinct from old.content_hash\n', '') },
  { what: 'the file fingerprint can be replaced through the function', red: ['P11'],
    edit: (s) => soften(swap(swap(s, '   where pp.id = p_id and pp.user_id = v_me and pp.pdf_hash is null;', '   where pp.id = p_id and pp.user_id = v_me;'),
      '  if old.pdf_hash is null and old.pdf_attached_at is null\n     and new.pdf_hash is not null', '  if new.pdf_hash is not null')) },
  { what: 'the trigger lets a file fingerprint be attached twice', red: ['P13b'],
    edit: (s) => swap(s, '  if old.pdf_hash is null and old.pdf_attached_at is null\n     and new.pdf_hash is not null', '  if new.pdf_hash is not null') },
  { what: 'anyone may delete a record', red: ['P13c'],
    edit: (s) => swap(s, "    if current_user = 'service_role' or pg_trigger_depth() > 1 then", '    if true then') },
  { what: 'the check code keeps the wrong bits', red: ['P02', 'P14'],
    edit: (s) => swap(s, '::bit(64)::bigint) >> 2;', '::bit(64)::bigint) >> 3;') },
  { what: 'a repeat of a fingerprint makes a second row or an error (both idempotency layers removed, and the unique key)', red: ['P04'],
    edit: (s) => swap(swap(swap(swap(s, '  if found then\n    return jsonb_build_object(', '  if false then\n    return jsonb_build_object('),
      '  on conflict on constraint proof_packs_user_hash_key do nothing;', '  ;'),
      '  constraint proof_packs_user_hash_key unique (user_id, content_hash),\n', ''),
      "    raise exception '[proof_packs] verify: the unique constraint on (user_id, content_hash) is missing';", "    raise notice 'softened';") },
  { what: 'a repeat of a fingerprint is counted against the cap', red: ['P18'],
    edit: (s) => swap(s, '  if found then\n    return jsonb_build_object(', '  if false then\n    return jsonb_build_object(') },
  { what: 'a hash that is not 64 hex reaches the insert', red: ['P06'],
    edit: (s) => swap(s, "  if v_hash !~ '^[0-9a-f]{64}$' then\n    raise exception 'bad_hash' using errcode = '22023';\n  end if;\n  if p_pay_kind", '  if p_pay_kind') },
  { what: 'the project initial is stored as typed', red: ['P15'],
    edit: (s) => swap(s, "    upper(left(btrim(coalesce(p_project_initial, '')), 1)),", "    left(btrim(coalesce(p_project_initial, '')), 1),") },
  { what: 'the stored time is not the server clock', red: ['P03'],
    edit: (s) => soften(swap(s, "    left(btrim(coalesce(p_city, '')), 80),\n    now()\n  )", "    left(btrim(coalesce(p_city, '')), 80),\n    now() - interval '30 days'\n  )")) },
  { what: 'the per-project cap is gone', red: ['P17'],
    edit: (s) => soften(swap(s, 'and pp.project_id = v_pid) >= 400 then', 'and pp.project_id = v_pid) >= 400000 then')) },
  { what: 'the same, with the self-check left as written: the apply itself must be refused', red: ['P01'],
    edit: (s) => swap(s, 'and pp.project_id = v_pid) >= 400 then', 'and pp.project_id = v_pid) >= 400000 then') },
  { what: 'the per-account cap is gone', red: ['P20'],
    edit: (s) => soften(swap(s, 'pp where pp.user_id = v_me) >= 5000 then', 'pp where pp.user_id = v_me) >= 5000000 then')) },
  { what: 'the cap counts every account together', red: ['P21'],
    edit: (s) => soften(swap(s, '(select count(*) from public.proof_packs pp where pp.user_id = v_me) >= 5000 then', '(select count(*) from public.proof_packs pp where pp.user_id = v_me or true) >= 5000 then')) },
];

process.exit(await judge('proof-packs', MIG, battery, MUTATIONS));
