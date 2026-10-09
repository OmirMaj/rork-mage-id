// scripts/pgq/signature-provenance.proof.mjs
// PGlite proof of supabase/migrations/20261010090000_signature_provenance.sql.
//
//   PGLITE_DIR=<folder outside the repo> node scripts/pgq/signature-provenance.proof.mjs
//   NO_MUTATIONS=1 ...   the checks only (faster)
//
// WHAT RUNS, in order, on one database per run:
//   1. Supabase's roles, auth.uid() and default privileges (lib.mjs).
//   2. The two tables CUT OUT OF supabase/schema.sql (production's shape) with
//      their primary keys, checks and foreign keys. No migration creates them.
//   3. The REAL earlier objects, verbatim from the repo:
//        20260518120000  the baseline policies of both tables (all but "client submits CO
//                        approvals", which 20260713150001 drops)
//        20260713150001  "gc records client CO approval in own portal" and the
//                        anon INSERT revoke (those two statements)
//        20260902140000  whole file: "gc stamps own CO approvals", the freeze trigger
//        20260919030000  portal_state_is_shared
//        20261005100000  portal_project_for_token
//        20260920060000  sections 0 to 3: send_stamp, the freeze function, the
//                        helpers, portal_submit_co_approval and _signed
//        20260908120200  whole file: the signing columns and functions
//        20260923130000  sections 1 to 6: lien_waivers_protect_signature, the
//                        notify trigger, the owner-only policies, the signing functions
//        schema.sql      resolve_co_approval_project, trg_notify_co_approval,
//                        update_updated_at_column and their triggers
//   4. Rows written BEFORE the new file, through those real paths.
//   5. The new file, TWICE. Then every check. Then the new file a third time.
//   Then the same checks with ONE guard removed at a time (planted mutations).
//
// STUBS, and what was substituted:
//   - public.projects, public.change_orders, public.profiles,
//     public.portal_credentials, public.portal_snapshots: only the columns the
//     real functions read. projects has owner-only row level security.
//   - public.fire_notify writes a row to a log table instead of calling the
//     notify edge function, so the real notify triggers are seen to fire.
//   - pgcrypto comes from PGlite's own contrib build, in schema "extensions".
//   - A request's role: the proof does `set role anon|authenticated|service_role`
//     and sets request.jwt.claim.sub itself; on Supabase PostgREST does both.
//     Inside a SECURITY DEFINER function current_user becomes the function's
//     owner in PGlite as in Postgres (the owner is "postgres" here, as in
//     production), which is the fact the new triggers rest on.
//   - "reporting": an invented role with every privilege on both tables and
//     BYPASSRLS, standing for any role created later.
import { createHash } from 'node:crypto';
import { loadPGlite, loadContrib, migration, repoFile, SUPABASE_BASE, openDb, recorder, swap, between, judge } from './lib.mjs';

const PGlite = await loadPGlite();
const pgcrypto = await loadContrib('pgcrypto');
const MIG = migration('20261010090000_signature_provenance.sql');
const sha = (s) => createHash('sha256').update(s).digest('hex');

// ── the real objects, cut from the repo ─────────────────────────────────────
const SCHEMA = repoFile('supabase/schema.sql');
const cut = (re, label) => { const m = re.exec(SCHEMA); if (!m) throw new Error(`schema.sql: ${label} not found`); return m[0]; };
const table = (name) => cut(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`), `table ${name}`);
const constraints = (name) => SCHEMA.split('\n').filter((l) => l.startsWith(`ALTER TABLE ONLY public.${name} ADD CONSTRAINT`)).join('\n');
const fn = (name) => cut(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)[\\s\\S]*?\\$function\\$\\n;`), `function ${name}`);
const trg = (name) => cut(new RegExp(`CREATE TRIGGER ${name} [^\\n]*;`), `trigger ${name}`);

const BASELINE = migration('20260518120000_rls_baseline.sql');
const policyLines = (tbl) => BASELINE.split('\n').reduce((acc, line, i, all) => {
  // a baseline policy is "drop policy ... on public.<tbl>;" then one statement ending in ";"
  if (line.startsWith('drop policy if exists') && line.endsWith(`on public.${tbl};`)) {
    let j = i + 1; const out = [line];
    while (j < all.length) { out.push(all[j]); if (all[j].trimEnd().endsWith(';')) break; j++; }
    // "client submits CO approvals" needs is_published_portal() and is dropped by 20260713150001: left out.
    if (!out.join('\n').includes('is_published_portal')) acc.push(out.join('\n'));
  }
  return acc;
}, []).join('\n');

const LOCK = migration('20260713150001_portal_lock_direct_access.sql');
const OVERLAY1 = migration('20260919030000_client_portal_live_overlay.sql');
const OVERLAY2 = migration('20260920060000_portal_live_overlay_v2.sql');
const STRIP = migration('20261005100000_portal_token_strip.sql');
const LIEN2 = migration('20260923130000_lien_prequal_hardening.sql');

const REAL = [
  ['tables from schema.sql', `
    ${table('change_order_approvals')}
    ${constraints('change_order_approvals')}
    ${table('lien_waivers')}
    ${constraints('lien_waivers')}
    alter table public.change_order_approvals enable row level security;
    alter table public.lien_waivers enable row level security;`],
  ['baseline policies', `${policyLines('change_order_approvals')}\n${policyLines('lien_waivers')}`],
  ['20260713150001 (the two statements for change_order_approvals)', `
    drop policy if exists "client submits CO approvals" on public.change_order_approvals;
    revoke insert on public.change_order_approvals from anon;
    ${between(LOCK, 'create policy "gc records client CO approval in own portal"', 'create policy "gc records client message in own portal"', '20260713150001')}`],
  ['20260902140000 whole', migration('20260902140000_co_approval_update_policy.sql')],
  ['20260919030000 portal_state_is_shared', between(OVERLAY1, 'create or replace function public.portal_state_is_shared(p_ps jsonb)', 'create or replace function public.portal_overlay_live(', '20260919030000')],
  ['20261005100000 portal_project_for_token', between(STRIP, 'create or replace function public.portal_project_for_token(p_portal_id text, p_access_token text)', 'create or replace function public.portal_project_for_token_any(', '20261005100000')],
  ['20260920060000 sections 0 to 3', between(OVERLAY2, '-- ── 0. The send stamp on a CO decision', '-- ── 4. The live overlay', '20260920060000')],
  ['schema.sql triggers on change_order_approvals', `
    ${fn('resolve_co_approval_project')}
    ${fn('trg_notify_co_approval')}
    ${trg('trg_resolve_co_approval_project')}
    ${trg('notify_co_approval')}
    ${trg('change_order_approvals_freeze')}`],
  ['20260908120200 whole', migration('20260908120200_lien_waiver_signing.sql')],
  ['20260923130000 sections 1 to 6', between(LIEN2, '-- ── 1. the voided token', '-- ── 7. BEFORE UPDATE guard on prequal_packets', '20260923130000')],
  ['schema.sql trigger on lien_waivers', `${fn('update_updated_at_column')}\n${trg('lien_waivers_updated_at')}`],
];

const STUBS = `
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create role reporting bypassrls;
grant usage on schema public, auth to reporting;
grant execute on function auth.uid() to reporting;

create table public.projects (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '', client_portal jsonb);
alter table public.projects enable row level security;
create policy projects_owner on public.projects for all to public using (user_id = auth.uid()) with check (user_id = auth.uid());
create table public.profiles (id uuid primary key, company_name text);
create table public.change_orders (
  id uuid primary key default gen_random_uuid(), project_id uuid not null, status text, portal_state jsonb,
  audit_trail jsonb, updated_at timestamptz);
create table public.portal_credentials (project_id uuid, portal_id text, access_token text);
create table public.portal_snapshots (portal_id text, expires_at timestamptz, snapshot jsonb);
create table public.notify_log (event text, source_table text, source_id text, at timestamptz default now());
create or replace function public.fire_notify(p_event text, p_source_table text, p_source_id text, p_payload jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
begin insert into public.notify_log (event, source_table, source_id) values (p_event, p_source_table, p_source_id); end $$;
`;

const A = '11111111-1111-1111-1111-111111111111';   // a contractor
const B = '22222222-2222-2222-2222-222222222222';   // another contractor
const PA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TOK = 'portal-token-for-project-a-0123456789';
const CO = (n) => `c0000000-0000-0000-0000-00000000000${n}`;
const W = (n) => `d0000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const WTOK = (n) => `waiver-token-${String(n).padStart(2, '0')}-0123456789abcdefghij`;
const CONSENT = 'I agree to sign this change order electronically.';

async function battery(sql) {
  const { ok, pass, fail } = recorder();
  const { db, as, root } = await openDb(PGlite, { extensions: { pgcrypto } });
  const one = async (q, params = []) => (await root(q, params)).rows[0];
  const approval = (coId) => one(`select id, recorded_via, created_at, abs(extract(epoch from (now() - created_at))) < 300 as fresh, project_id, document_hash, signer_name, synced_to_co_at
                                    from public.change_order_approvals where change_order_id = $1 order by created_at desc limit 1`, [coId]);
  const waiver = (id) => one(`select id, status, signed_via, signed_at, sub_signature, sign_token, voided_sign_token, notes from public.lien_waivers where id = $1`, [id]);
  const logged = async (event) => (await one(`select count(*)::int as n from public.notify_log where event = $1`, [event]))?.n;

  // The writers, written the way the app and the two pages send them.
  const portalSigned = (role, uid, coId, name = 'Dana Client') => as(role, uid,
    `select public.portal_submit_co_approval_signed($1,$2,$3,'approved',$4,null,'proof-agent','M0 0L1 1',$5,$6,$7,'v1',true) as r`,
    ['portal-a', TOK, coId, name, sha('sig'), CONSENT, sha(CONSENT)]);
  const portalPlain = (role, uid, coId) => as(role, uid,
    `select public.portal_submit_co_approval($1,$2,$3,'approved','Dana Client','ok','proof-agent') as r`, ['portal-a', TOK, coId]);
  // app/client-view.tsx insertCODecision: the columns it sends, plus whatever `extra` forges.
  const clientViewInsert = (role, uid, coId, extra = {}) => {
    const row = {
      portal_id: 'portal-a', project_id: PA, invite_id: null, change_order_id: coId, decision: 'approved',
      signer_name: 'Typed By The Contractor', signer_email: null, note: null, signature_data: 'M0 0L2 2',
      signature_hash: sha('phone-sig'), consent_record: CONSENT, document_hash: sha('phone-doc'),
      consent_version: 'v1', consent_accepted: true, sealed_at: '2026-10-09T10:00:00Z', send_stamp: 'unsent', ...extra,
    };
    const cols = Object.keys(row);
    return as(role, uid, `insert into public.change_order_approvals (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map((c) => row[c]));
  };
  // utils/lienWaiverEngine.ts createLienWaiverChecked
  const createWaiver = (uid, id, extra = {}) => {
    const row = { id, project_id: PA, user_id: uid, waiver_type: 'conditional_partial', sub_name: 'Sub Co', sub_email: 'sub@example.com', through_date: '2026-09-30', paid_amount: 1000, status: 'requested', notes: '', ...extra };
    const cols = Object.keys(row);
    return as('authenticated', uid, `insert into public.lien_waivers (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map((c) => row[c]));
  };
  // requestLienWaiverSignature
  const requestSig = (uid, id, n) => as('authenticated', uid,
    `update public.lien_waivers set sign_token = $2, sign_requested_at = now(), sign_document_html = '<p>waiver</p>', sign_form_meta = '{}'::jsonb, status = 'requested'
      where id = $1 and signed_at is null and status <> 'voided'`, [id, WTOK(n)]);
  // marketing/lien-waiver/index.html -> lien_waiver_submit_signature
  const pageSign = (role, uid, id, n) => as(role, uid,
    `select public.lien_waiver_submit_signature($1,$2,'Sam Sub','Owner','M0 0L3 3','I consent','v1',true,'proof-agent') as r`, [id, WTOK(n)]);
  // recordPaperLienWaiver
  const paper = (uid, id, extra = '') => as('authenticated', uid,
    `update public.lien_waivers set status = 'signed', signed_at = now(), sub_signature = $2::jsonb, updated_at = now()${extra} where id = $1 and signed_at is null`,
    [id, JSON.stringify({ name: 'Sub Co', role: 'gc', signedAt: '2026-10-09T10:00:00Z' })]);
  // updateLienWaiverStatus
  const setStatus = (uid, id, status) => as('authenticated', uid, `update public.lien_waivers set status = $2, updated_at = now() where id = $1`, [id, status]);

  try {
    await db.exec(SUPABASE_BASE);
    await db.exec(STUBS);
    for (const [label, text] of REAL) {
      try { await db.exec(text); } catch (e) { ok('SETUP', false, `${label}: ${e.message}`); return { pass, fail }; }
    }
    await db.exec(`
      grant all on public.change_order_approvals, public.lien_waivers to reporting;
      insert into auth.users (id) values ('${A}'), ('${B}');
      insert into public.profiles (id, company_name) values ('${A}', 'Alder Builders'), ('${B}', 'Birch Builders');
      insert into public.projects (id, user_id, name, client_portal) values
        ('${PA}', '${A}', 'Alder', '{"portalId":"portal-a","enabled":true}'), ('${PB}', '${B}', 'Birch', '{"portalId":"portal-b","enabled":true}');
      insert into public.portal_credentials (project_id, portal_id, access_token) values ('${PA}', 'portal-a', '${TOK}');
      insert into public.change_orders (id, project_id, status) select ('c0000000-0000-0000-0000-00000000000' || g)::uuid, '${PA}', 'pending' from generate_series(0, 9) g;`);

    // ── rows written BEFORE the new file, through the real paths ─────────────
    const pre = [];
    pre.push(await portalSigned('anon', null, CO(0)));                       // a client signed in the portal
    pre.push(await clientViewInsert('authenticated', A, CO(9)));             // the contractor's client view
    pre.push(await createWaiver(A, W(1)), await requestSig(A, W(1), 1), await pageSign('anon', null, W(1), 1));  // signed on the page
    pre.push(await createWaiver(A, W(2)), await paper(A, W(2)));             // a paper record
    pre.push(await createWaiver(A, W(3)), await requestSig(A, W(3), 3));     // requested, not yet signed
    const preErr = pre.find((r) => r.err);
    const preSigned = (await one(`select count(*)::int as n from public.lien_waivers where status = 'signed' and signed_at is not null`))?.n;
    const preApprovals = (await one(`select count(*)::int as n from public.change_order_approvals`))?.n;
    ok('S00', !preErr && preSigned === 2 && preApprovals === 2,
      preErr ? `a real path failed BEFORE the new file: ${preErr.err.message}` : 'the real paths work before the new file');
    if (preErr) return { pass, fail };

    try { await db.exec(sql); await db.exec(sql); ok('S01', true, 'the file applies twice and its self-check passes both times'); }
    catch (e) { ok('S01', false, `apply refused: ${e.message}`); return { pass, fail }; }

    // S02: every row that existed is not known.
    const s2 = await one(`select (select count(*)::int from public.change_order_approvals where recorded_via is not null) as co,
                                 (select count(*)::int from public.lien_waivers where signed_via is not null) as lw,
                                 (select count(*)::int from public.change_order_approvals) as co_all, (select count(*)::int from public.lien_waivers) as lw_all`);
    ok('S02', s2?.co === 0 && s2?.lw === 0 && s2?.co_all === 2 && s2?.lw_all === 3, JSON.stringify(s2));

    // S03: the two columns are nullable text with no default.
    const s3 = (await root(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
                             where table_schema = 'public' and column_name in ('recorded_via', 'signed_via') order by 1`)).rows;
    ok('S03', s3.length === 2 && s3.every((c) => c.data_type === 'text' && c.is_nullable === 'YES' && c.column_default === null), JSON.stringify(s3));

    // ── change_order_approvals ───────────────────────────────────────────────
    // S04: the client's page (anon key, portal token, the signed function) is marked 'portal_function'.
    const n4 = await logged('co_approval');
    const c4 = await portalSigned('anon', null, CO(1));
    const r4 = await approval(CO(1));
    ok('S04', !c4.err && c4.rows[0]?.r?.recorded === true && r4?.recorded_via === 'portal_function' && r4?.fresh === true
      && r4?.document_hash === sha(CONSENT) && (await logged('co_approval')) === n4 + 1, c4.err?.message ?? JSON.stringify(r4));

    // S05: the page's older fallback function is marked the same.
    const c5 = await portalPlain('anon', null, CO(2));
    const r5 = await approval(CO(2));
    ok('S05', !c5.err && r5?.recorded_via === 'portal_function', c5.err?.message ?? JSON.stringify(r5));

    // S06: the app's client view still saves, and is marked 'contractor_account'.
    const n6 = await logged('co_approval');
    const c6 = await clientViewInsert('authenticated', A, CO(3));
    const r6 = await approval(CO(3));
    ok('S06', !c6.err && r6?.recorded_via === 'contractor_account' && r6?.signer_name === 'Typed By The Contractor' && r6?.document_hash === sha('phone-doc')
      && (await logged('co_approval')) === n6 + 1, c6.err?.message ?? JSON.stringify(r6));

    // S07: a contractor who sends recorded_via = 'portal_function' is still marked 'contractor_account'.
    const c7 = await clientViewInsert('authenticated', A, CO(4), { recorded_via: 'portal_function', project_id: null });
    const r7 = await approval(CO(4));
    ok('S07', !c7.err && r7?.recorded_via === 'contractor_account' && r7?.project_id === PA, c7.err?.message ?? JSON.stringify(r7));

    // S08: a contractor who sends a back-dated created_at gets the server's time.
    const c8 = await clientViewInsert('authenticated', A, CO(5), { created_at: '2020-01-01T00:00:00Z', recorded_via: 'portal_function' });
    const r8 = await approval(CO(5));
    ok('S08', !c8.err && r8?.fresh === true && r8?.recorded_via === 'contractor_account', c8.err?.message ?? JSON.stringify(r8));

    // S09: recorded_via cannot be changed by UPDATE: not by the contractor, the service role, the owner or a later role.
    const u9 = [
      await as('authenticated', A, `update public.change_order_approvals set recorded_via = 'portal_function' where change_order_id = $1`, [CO(3)]),
      await as('authenticated', A, `update public.change_order_approvals set recorded_via = null where change_order_id = $1`, [CO(1)]),
      await as('service_role', null, `update public.change_order_approvals set recorded_via = 'portal_function' where change_order_id = $1`, [CO(3)]),
      await as('reporting', null, `update public.change_order_approvals set recorded_via = 'portal_function' where change_order_id = $1`, [CO(4)]),
      await root(`update public.change_order_approvals set recorded_via = 'portal_function' where change_order_id = $1`, [CO(5)]),
      await root(`update public.change_order_approvals set recorded_via = 'portal_function' where change_order_id = $1`, [CO(0)]),
    ];
    const v9 = await Promise.all([CO(3), CO(1), CO(4), CO(5), CO(0)].map(async (c) => (await approval(c))?.recorded_via));
    ok('S09', u9.every((u) => !u.err) && JSON.stringify(v9) === JSON.stringify(['contractor_account', 'portal_function', 'contractor_account', 'contractor_account', null]),
      `${u9.map((u) => u.err?.message ?? 'ok').join(' | ')} -> ${JSON.stringify(v9)}`);

    // S10: the reconciler's stamp still lands (the one column the app may update), on a new row and on an old one.
    const c10a = await as('authenticated', A, `update public.change_order_approvals set synced_to_co_at = now() where change_order_id = $1`, [CO(1)]);
    const c10b = await as('authenticated', A, `update public.change_order_approvals set synced_to_co_at = now() where change_order_id = $1`, [CO(0)]);
    const r10a = await approval(CO(1)); const r10b = await approval(CO(0));
    ok('S10', !c10a.err && c10a.n === 1 && !c10b.err && c10b.n === 1 && !!r10a?.synced_to_co_at && !!r10b?.synced_to_co_at
      && r10a?.recorded_via === 'portal_function' && r10b?.recorded_via === null, `${c10a.err?.message ?? c10a.n} ${c10b.err?.message ?? c10b.n} ${JSON.stringify([r10a?.recorded_via, r10b?.recorded_via])}`);

    // S11: anon cannot write the table directly.
    const before11 = await one(`select count(*)::int as n, md5(string_agg(id::text || coalesce(recorded_via, '-') || decision, ',' order by id)) as h from public.change_order_approvals`);
    const c11a = await clientViewInsert('anon', null, CO(6), { recorded_via: 'portal_function' });
    const c11b = await as('anon', null, `update public.change_order_approvals set decision = 'declined', recorded_via = 'portal_function'`);
    const c11c = await as('anon', null, `delete from public.change_order_approvals`);
    const after11 = await one(`select count(*)::int as n, md5(string_agg(id::text || coalesce(recorded_via, '-') || decision, ',' order by id)) as h from public.change_order_approvals`);
    ok('S11', !!c11a.err && (!!c11b.err || c11b.n === 0) && (!!c11c.err || c11c.n === 0) && before11?.h === after11?.h,
      `insert: ${c11a.err?.message ?? 'LANDED'} | update: ${c11b.err?.message ?? c11b.n} | delete: ${c11c.err?.message ?? c11c.n}`);

    // S12: a signed-in account calling the portal function is not the anonymous page: 'contractor_account'.
    const c12 = await portalSigned('authenticated', A, CO(6), 'Signed In Caller');
    const r12 = await approval(CO(6));
    ok('S12', !c12.err && r12?.recorded_via === 'contractor_account', c12.err?.message ?? JSON.stringify(r12));

    // S13: the service role, outside the signing path, is never given the marker (not known), and gets the server's time.
    const c13 = await clientViewInsert('service_role', null, CO(7), { recorded_via: 'portal_function', created_at: '2020-01-01T00:00:00Z' });
    const r13 = await approval(CO(7));
    ok('S13', !c13.err && r13?.recorded_via === null && r13?.fresh === true, c13.err?.message ?? JSON.stringify(r13));

    // S14: a role created later, with every privilege, is a client.
    const c14 = await clientViewInsert('reporting', null, CO(8), { recorded_via: 'portal_function', created_at: '2020-01-01T00:00:00Z' });
    const r14 = await approval(CO(8));
    ok('S14', !c14.err && r14?.recorded_via === 'contractor_account' && r14?.fresh === true, c14.err?.message ?? JSON.stringify(r14));

    // S15: another account still cannot record an approval in this contractor's portal.
    const c15 = await clientViewInsert('authenticated', B, CO(8), { send_stamp: 'other' });
    ok('S15', /row-level security/.test(c15.err?.message ?? ''), c15.err?.message ?? 'LANDED');

    // ── lien_waivers ─────────────────────────────────────────────────────────
    // S20: a new waiver saves and is unmarked, even when the insert sends signed_via = 'signing_page'.
    const c20a = await createWaiver(A, W(10));
    const c20b = await createWaiver(A, W(11), { signed_via: 'signing_page' });
    ok('S20', !c20a.err && !c20b.err && (await waiver(W(10)))?.signed_via === null && (await waiver(W(11)))?.signed_via === null,
      `${c20a.err?.message ?? 'ok'} | ${c20b.err?.message ?? 'ok'} -> ${(await waiver(W(11)))?.signed_via}`);

    // S21: sending the signing link still works and marks nothing.
    const c21 = await requestSig(A, W(10), 10);
    const r21 = await waiver(W(10));
    ok('S21', !c21.err && c21.n === 1 && r21?.sign_token === WTOK(10) && r21?.signed_via === null, c21.err?.message ?? JSON.stringify(r21));

    // S22: the sub signs on the signing page (anon key, token): 'signing_page', and the contractor is told.
    const n22 = await logged('lien_waiver_signed');
    const c22 = await pageSign('anon', null, W(10), 10);
    const r22 = await waiver(W(10));
    ok('S22', !c22.err && c22.rows[0]?.r?.already_signed === false && r22?.status === 'signed' && r22?.signed_via === 'signing_page'
      && r22?.sub_signature?.role === 'sub' && (await logged('lien_waiver_signed')) === n22 + 1, c22.err?.message ?? JSON.stringify(r22));

    // S23: the contractor records a paper waiver: it saves, and is marked for what it is.
    const c23 = await paper(A, W(11));
    const r23 = await waiver(W(11));
    ok('S23', !c23.err && c23.n === 1 && r23?.status === 'signed' && r23?.sub_signature?.role === 'gc' && r23?.signed_via === 'contractor_account',
      c23.err?.message ?? JSON.stringify(r23));

    // S24: Mark received still works on both, and moves neither marker.
    const c24a = await setStatus(A, W(10), 'received'); const c24b = await setStatus(A, W(11), 'received');
    const r24a = await waiver(W(10)); const r24b = await waiver(W(11));
    ok('S24', !c24a.err && !c24b.err && r24a?.status === 'received' && r24b?.status === 'received'
      && r24a?.signed_via === 'signing_page' && r24b?.signed_via === 'contractor_account', `${JSON.stringify([r24a?.status, r24a?.signed_via, r24b?.status, r24b?.signed_via])}`);

    // S25: a contractor writing sub_signature / signed_at directly cannot write 'signing_page': update, insert and upsert.
    const forged = JSON.stringify({ name: 'Sam Sub', role: 'sub', signedAt: '2026-10-09T10:00:00Z' });
    await createWaiver(A, W(12));
    const c25a = await as('authenticated', A, `update public.lien_waivers set status = 'signed', signed_at = now(), sub_signature = $2::jsonb, signed_via = 'signing_page' where id = $1`, [W(12), forged]);
    const c25b = await createWaiver(A, W(13), { status: 'signed', signed_at: '2026-10-09T10:00:00Z', sub_signature: forged, signed_via: 'signing_page' });
    await createWaiver(A, W(14));
    // saveLienWaiver: an upsert on id carrying the signature columns.
    const c25c = await as('authenticated', A,
      `insert into public.lien_waivers (id, project_id, user_id, waiver_type, sub_name, through_date, paid_amount, status, notes, sub_signature, signed_at, signed_via)
       values ($1, $2, $3, 'conditional_partial', 'Sub Co', '2026-09-30', 1000, 'signed', '', $4::jsonb, now(), 'signing_page')
       on conflict (id) do update set status = excluded.status, sub_signature = excluded.sub_signature, signed_at = excluded.signed_at, signed_via = excluded.signed_via`, [W(14), PA, A, forged]);
    const v25 = [(await waiver(W(12)))?.signed_via, (await waiver(W(13)))?.signed_via, (await waiver(W(14)))?.signed_via];
    ok('S25', !c25a.err && !c25b.err && !c25c.err && v25.every((v) => v === 'contractor_account'), `${[c25a, c25b, c25c].map((c) => c.err?.message ?? 'ok').join(' | ')} -> ${JSON.stringify(v25)}`);

    // S26: once set, signed_via is pinned for every role.
    const u26 = [
      await as('authenticated', A, `update public.lien_waivers set signed_via = 'signing_page' where id = $1`, [W(11)]),
      await as('authenticated', A, `update public.lien_waivers set signed_via = null, notes = 'x' where id = $1`, [W(10)]),
      await as('authenticated', A, `update public.lien_waivers set signed_via = 'contractor_account' where id = $1`, [W(10)]),
      await as('service_role', null, `update public.lien_waivers set signed_via = 'signing_page' where id = $1`, [W(12)]),
      await as('reporting', null, `update public.lien_waivers set signed_via = 'signing_page' where id = $1`, [W(13)]),
      await root(`update public.lien_waivers set signed_via = 'signing_page' where id = $1`, [W(14)]),
    ];
    const v26 = await Promise.all([W(11), W(10), W(12), W(13), W(14)].map(async (id) => (await waiver(id))?.signed_via));
    ok('S26', u26.every((u) => !u.err) && JSON.stringify(v26) === JSON.stringify(['contractor_account', 'signing_page', 'contractor_account', 'contractor_account', 'contractor_account'])
      && (await waiver(W(10)))?.notes === 'x', `${u26.map((u) => u.err?.message ?? 'ok').join(' | ')} -> ${JSON.stringify(v26)}`);

    // S27: a contractor who sets signed_via alone, on an unsigned row, sets nothing.
    await createWaiver(A, W(15));
    const c27 = await as('authenticated', A, `update public.lien_waivers set signed_via = 'signing_page', notes = 'tried' where id = $1`, [W(15)]);
    const r27 = await waiver(W(15));
    ok('S27', !c27.err && r27?.notes === 'tried' && r27?.signed_via === null, c27.err?.message ?? JSON.stringify(r27));

    // S28: a signed-in account calling the signing function is not the anonymous page: 'contractor_account'.
    const c28a = await requestSig(A, W(15), 15);
    const c28 = await pageSign('authenticated', A, W(15), 15);
    const r28 = await waiver(W(15));
    ok('S28', !c28a.err && !c28.err && r28?.status === 'signed' && r28?.signed_via === 'contractor_account', c28.err?.message ?? JSON.stringify(r28));

    // S29: anon cannot write the table directly.
    const before29 = await one(`select count(*)::int as n, md5(string_agg(id::text || status || coalesce(signed_via, '-') || coalesce(signed_at::text, '-'), ',' order by id)) as h from public.lien_waivers`);
    const c29a = await as('anon', null, `insert into public.lien_waivers (project_id, user_id, waiver_type, sub_name, through_date, signed_at, signed_via) values ($1, $2, 'conditional_partial', 'x', '2026-09-30', now(), 'signing_page')`, [PA, A]);
    const c29b = await as('anon', null, `update public.lien_waivers set signed_at = now(), signed_via = 'signing_page', status = 'signed'`);
    const c29c = await as('anon', null, `delete from public.lien_waivers`);
    const after29 = await one(`select count(*)::int as n, md5(string_agg(id::text || status || coalesce(signed_via, '-') || coalesce(signed_at::text, '-'), ',' order by id)) as h from public.lien_waivers`);
    ok('S29', !!c29a.err && (!!c29b.err || c29b.n === 0) && (!!c29c.err || c29c.n === 0) && before29?.h === after29?.h,
      `insert: ${c29a.err?.message ?? 'LANDED'} | update: ${c29b.err?.message ?? c29b.n} | delete: ${c29c.err?.message ?? c29c.n}`);

    // S30: the service role writing a signature outside the signing path is not known; a later role is a client.
    await createWaiver(A, W(16)); await createWaiver(A, W(17));
    const c30a = await as('service_role', null, `update public.lien_waivers set status = 'signed', signed_at = now(), sub_signature = $2::jsonb, signed_via = 'signing_page' where id = $1`, [W(16), forged]);
    const c30b = await as('reporting', null, `update public.lien_waivers set status = 'signed', signed_at = now(), sub_signature = $2::jsonb, signed_via = 'signing_page' where id = $1`, [W(17), forged]);
    const v30 = [(await waiver(W(16)))?.signed_via, (await waiver(W(17)))?.signed_via];
    ok('S30', !c30a.err && !c30b.err && v30[0] === null && v30[1] === 'contractor_account', `${c30a.err?.message ?? 'ok'} | ${c30b.err?.message ?? 'ok'} -> ${JSON.stringify(v30)}`);

    // S31: Void and delete still work.
    await createWaiver(A, W(18)); await requestSig(A, W(18), 18);
    const c31a = await setStatus(A, W(18), 'voided');
    const r31 = await waiver(W(18));
    const c31b = await as('authenticated', A, `delete from public.lien_waivers where id = $1`, [W(18)]);
    const c31c = await as('service_role', null, `delete from public.change_order_approvals where change_order_id = $1`, [CO(7)]);
    ok('S31', !c31a.err && r31?.status === 'voided' && r31?.sign_token === null && r31?.voided_sign_token === WTOK(18) && r31?.signed_via === null
      && !c31b.err && c31b.n === 1 && !c31c.err && c31c.n === 1, `${c31a.err?.message ?? ''} ${JSON.stringify(r31)} ${c31b.err?.message ?? c31b.n} ${c31c.err?.message ?? c31c.n}`);

    // ── rows from before the file ────────────────────────────────────────────
    // S32: a waiver signed before the file stays not known through every later write: Mark received, a stale
    // app save that carries a different signature (the older guard puts the real one back first), a touch
    // by the database owner. The paper record from before the file likewise.
    const sig32 = (await waiver(W(1)))?.sub_signature;
    const u32 = [
      await setStatus(A, W(1), 'received'),
      await as('authenticated', A, `update public.lien_waivers set sub_signature = $2::jsonb, signed_at = now(), signed_via = 'signing_page', notes = 'stale save' where id = $1`, [W(1), forged]),
      await root(`update public.lien_waivers set notes = 'owner touch' where id = $1`, [W(1)]),
      await setStatus(A, W(2), 'received'),
      await root(`update public.lien_waivers set notes = 'owner touch' where id = $1`, [W(2)]),
    ];
    const r32a = await waiver(W(1)); const r32b = await waiver(W(2));
    ok('S32', u32.every((u) => !u.err) && r32a?.signed_via === null && r32b?.signed_via === null && r32a?.notes === 'owner touch'
      && JSON.stringify(r32a?.sub_signature) === JSON.stringify(sig32), `${u32.map((u) => u.err?.message ?? 'ok').join(' | ')} -> ${JSON.stringify([r32a?.signed_via, r32b?.signed_via])}`);

    // S33: a waiver requested before the file and signed on the page after it is a new signature: 'signing_page'.
    const c33 = await pageSign('anon', null, W(3), 3);
    ok('S33', !c33.err && (await waiver(W(3)))?.signed_via === 'signing_page', c33.err?.message ?? JSON.stringify(await waiver(W(3))));

    // S34: approvals from before the file stay not known (one from the portal, one from the client view).
    const v34 = [(await approval(CO(0)))?.recorded_via, (await approval(CO(9)))?.recorded_via];
    ok('S34', v34[0] === null && v34[1] === null, JSON.stringify(v34));

    // ── the preflight ────────────────────────────────────────────────────────
    // SP1: a fourth SECURITY DEFINER function that writes one of the tables: the apply is refused by the preflight.
    await root(`create function public.sneaky_approve(p text) returns void language sql security definer set search_path to 'public' as $f$
                  insert into public.change_order_approvals (portal_id, change_order_id, decision) values ('portal-a', p, 'approved') $f$`);
    let sp1 = '';
    try { await db.exec(sql); sp1 = 'APPLIED'; } catch (e) { sp1 = e.message; }
    await root(`drop function public.sneaky_approve(text)`);
    ok('SP1', /preflight/.test(sp1) && /sneaky_approve/.test(sp1), sp1);

    // SP2: a signing function owned by a role a request can run as: refused by the preflight.
    await root(`alter function public.lien_waiver_submit_signature(uuid,text,text,text,text,text,text,boolean,text) owner to authenticated`);
    let sp2 = '';
    try { await db.exec(sql); sp2 = 'APPLIED'; } catch (e) { sp2 = e.message; }
    await root(`alter function public.lien_waiver_submit_signature(uuid,text,text,text,text,text,text,boolean,text) owner to postgres`);
    ok('SP2', /preflight/.test(sp2) && /a role a request can run as/.test(sp2), sp2);

    // S40: a third apply, with rows of every kind on file, changes no marker and marks no old row.
    const snap = async () => (await one(`select md5(coalesce((select string_agg(id::text || coalesce(recorded_via, '-') || created_at::text, ',' order by id) from public.change_order_approvals), '')
                                              || coalesce((select string_agg(id::text || coalesce(signed_via, '-'), ',' order by id) from public.lien_waivers), '')) as h`))?.h;
    const before40 = await snap();
    let e40 = '';
    try { await db.exec(sql); } catch (e) { e40 = e.message; }
    ok('S40', e40 === '' && before40 === (await snap()) && (await approval(CO(0)))?.recorded_via === null && (await waiver(W(2)))?.signed_via === null, e40 || 'no marker moved');
  } catch (e) {
    ok('CRASH', false, e.message);
  } finally {
    await db.close();
  }
  return { pass, fail };
}

// The file's own self-check, softened so a planted fault reaches the checks.
const soften = (s) => s.split("raise exception '[signature-provenance] verify:").join("raise notice '[signature-provenance] verify:");
/** Edit only the text of one of the two trigger functions. */
const inFn = (src, name, edit) => {
  const start = src.indexOf(`create or replace function public.${name}()`);
  const end = src.indexOf(`revoke all on function public.${name}() from public;`, start);
  if (start < 0 || end < 0) throw new Error(`function ${name}: anchors not found`);
  return src.slice(0, start) + edit(src.slice(start, end)) + src.slice(end);
};
const CO_FN = 'co_approval_provenance';
const LW_FN = 'lien_waivers_signed_via';
const NAMED = "current_user in ('service_role', 'postgres', 'supabase_admin')";

const MUTATIONS = [
  { what: 'created_at is no longer forced to the server clock', red: ['S08'],
    edit: (s) => soften(inFn(s, CO_FN, (f) => swap(f, '  new.created_at := pg_catalog.now();\n', ''))) },
  { what: 'the marker trusts what the request sent (a client keeps its own recorded_via)', red: ['S07', 'S08'],
    edit: (s) => soften(inFn(s, CO_FN, (f) => swap(f, "    -- Everyone else is a client, whatever the request sent.\n    new.recorded_via := 'contractor_account';", "    new.recorded_via := coalesce(new.recorded_via, 'contractor_account');"))) },
  { what: 'recorded_via is no longer pinned on UPDATE', red: ['S09'],
    edit: (s) => soften(inFn(s, CO_FN, (f) => swap(f, '    new.recorded_via := old.recorded_via;\n    return new;', '    return new;'))) },
  { what: 'the same, with the self-check left as written: the apply itself must be refused', red: ['S01'],
    edit: (s) => inFn(s, CO_FN, (f) => swap(f, '    new.recorded_via := old.recorded_via;\n    return new;', '    return new;')) },
  { what: 'a signed-in account calling the portal function earns the marker', red: ['S12'],
    edit: (s) => inFn(s, CO_FN, (f) => swap(f, '    if v_signed_in then', '    if false then')) },
  { what: 'the service role earns the marker', red: ['S13'],
    edit: (s) => inFn(s, CO_FN, (f) => swap(f, '    -- The server, outside the signing path: not known. Never the marker.\n    new.recorded_via := null;', "    new.recorded_via := 'portal_function';")) },
  { what: 'every server role earns the marker (the looked-up owner test widened to the three named roles)', red: ['S13'],
    edit: (s) => soften(inFn(s, CO_FN, (f) => swap(f, '  if v_owner is not null and current_user = v_owner then', `  if ${NAMED} then`))) },
  { what: 'the deny-list is back in the change order trigger: only two named roles are clients', red: ['S14'],
    edit: (s) => soften(inFn(s, CO_FN, (f) => swap(f, `  if ${NAMED} then\n    v_server := true;\n  end if;`, "  if current_user not in ('authenticated', 'anon') then\n    v_server := true;\n  end if;"))) },
  { what: 'the change order trigger looks up a function that is not the signing function', red: ['S04', 'S05'],
    edit: (s) => soften(inFn(s, CO_FN, (f) => swap(f, "pg_catalog.to_regprocedure('public.portal_submit_co_approval_signed(text,text,text,text,text,text,text,text,text,text,text,text,boolean)')", "pg_catalog.to_regprocedure('public.portal_co_send_stamp(jsonb)')"))) },
  { what: 'anon may insert approvals directly', red: ['S11'],
    edit: (s) => s + "\ngrant insert on public.change_order_approvals to anon;\ndrop policy if exists planted_anon on public.change_order_approvals;\ncreate policy planted_anon on public.change_order_approvals for insert to anon with check (true);\n" },
  { what: 'the new column has a default, so every old row is marked', red: ['S02', 'S34'],
    edit: (s) => soften(swap(s, 'alter table public.change_order_approvals add column if not exists recorded_via text;', "alter table public.change_order_approvals add column if not exists recorded_via text default 'portal_function';")) },
  // A plain UPDATE here changes nothing (run and seen): the trigger itself keeps an already signed row
  // unmarked. A backfill has to switch the trigger off first, so that is what is planted.
  { what: 'the file backfills old waivers', red: ['S02'],
    edit: (s) => swap(s, "-- The API learns the two new columns.", "alter table public.lien_waivers disable trigger lien_waivers_signed_via;\nupdate public.lien_waivers set signed_via = 'signing_page' where signed_at is not null and sub_signature->>'role' = 'sub' and signed_via is null;\nalter table public.lien_waivers enable trigger lien_waivers_signed_via;") },
  { what: 'a waiver update keeps the signed_via the request sent', red: ['S27'],
    edit: (s) => inFn(s, LW_FN, (f) => swap(f, '  new.signed_via := null;\n  if v_page then', '  if v_page then')) },
  { what: 'a waiver insert keeps the signed_via the request sent', red: ['S20'],
    edit: (s) => inFn(s, LW_FN, (f) => swap(f, "      new.signed_via := 'contractor_account';\n    else\n      new.signed_via := null;\n    end if;\n    return new;", "      new.signed_via := 'contractor_account';\n    end if;\n    return new;")) },
  { what: 'signed_via is no longer pinned once set', red: ['S26'],
    edit: (s) => soften(inFn(s, LW_FN, (f) => swap(f, "  if tg_op = 'UPDATE' and old.signed_via is not null then", '  if false then'))) },
  { what: 'a signed-in account calling the signing function earns the marker', red: ['S28'],
    edit: (s) => inFn(s, LW_FN, (f) => swap(f, '    if not v_signed_in then\n      v_page := true;', '    if true then\n      v_page := true;')) },
  { what: 'a signature written by the contractor is left unmarked', red: ['S23', 'S25'],
    edit: (s) => soften(inFn(s, LW_FN, (f) => swap(f, "      new.signed_via := 'contractor_account';\n    end if;\n  end if;\n  return new;", "      new.signed_via := null;\n    end if;\n  end if;\n  return new;"))) },
  { what: 'a client who writes a signature earns signing_page', red: ['S23', 'S25'],
    edit: (s) => soften(inFn(s, LW_FN, (f) => swap(f, "      new.signed_via := 'contractor_account';\n    end if;\n  end if;\n  return new;", "      new.signed_via := 'signing_page';\n    end if;\n  end if;\n  return new;"))) },
  { what: 'any touch by the signing path marks an already signed row (old rows upgraded)', red: ['S32'],
    edit: (s) => soften(inFn(s, LW_FN, (f) => swap(f, '    if old.signed_at is null and new.signed_at is not null then', '    if new.signed_at is not null then'))) },
  { what: 'the service role earns signing_page on waivers', red: ['S30'],
    edit: (s) => soften(inFn(s, LW_FN, (f) => swap(f, `  elsif ${NAMED} then\n    v_server := true;`, `  elsif ${NAMED} then\n    v_page := true;`))) },
  { what: 'the deny-list is back in the waiver trigger: a later role is not a client', red: ['S30'],
    edit: (s) => soften(inFn(s, LW_FN, (f) => swap(f, `  elsif ${NAMED} then\n    v_server := true;`, "  elsif current_user not in ('authenticated', 'anon') then\n    v_server := true;"))) },
  // (A function that is not SECURITY DEFINER: another definer function of the same owner would look up the same role.)
  { what: 'the waiver trigger looks up a function that is not the signing function', red: ['S22', 'S33'],
    edit: (s) => soften(inFn(s, LW_FN, (f) => swap(f, "pg_catalog.to_regprocedure('public.lien_waiver_submit_signature(uuid,text,text,text,text,text,text,boolean,text)')", "pg_catalog.to_regprocedure('public.update_updated_at_column()')"))) },
  { what: 'the preflight no longer refuses an unknown SECURITY DEFINER writer', red: ['SP1'],
    edit: (s) => swap(s, "     and p.prosrc ~* '(insert\\s+into|update)\\s+(public\\.)?(change_order_approvals|lien_waivers)\\M'\n     and p.oid not in (", "     and false\n     and p.oid not in (") },
  { what: 'the preflight accepts a signing function owned by a role a request can run as', red: ['SP2'],
    edit: (s) => swap(s, "    if v_owner in ('authenticated', 'anon', 'authenticator') then", '    if false then') },
];

process.exit(await judge('signature-provenance', MIG, battery, MUTATIONS));
