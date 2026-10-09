// rfp-attachments-private.mjs — PGlite proof of 20261009120000_rfp_attachments_private.sql (lane PROTECT-SERVER).
// Usage: [MUTATE=<n>] node scripts/pgq/rfp-attachments-private.mjs <worktree>
//        node scripts/pgq/rfp-attachments-private.mjs <worktree> --all
// PGlite has no Storage service: "anonymous GET of a public URL" is modelled by the bucket's
// `public` flag (Storage serves /object/public/ only when it is true) plus the SELECT policy
// (what /object/sign and /object/authenticated consult). The live check is in the header.
import { BASE_SQL, STORAGE_SQL, loadPGlite, makeKit, readMigration, replacer, runAll, worktreeArg } from './_harness.mjs';

const ROOT = worktreeArg('scripts/pgq/rfp-attachments-private.mjs');
const FILE = '20261009120000_rfp_attachments_private.sql';

if (process.argv[3] === '--all') {
  runAll(import.meta.url, ROOT, {
    1: ['3'],          // the bucket is never flipped
    2: ['5'],          // the policy is for public (anon reads)
    3: ['8'],          // the open-posting condition removed: a closed posting stays readable by any account
    4: ['10'],         // the posting-owner match removed: a folder named after someone else's posting opens
    5: ['11'],         // any three-segment name passes for a signed-in account
    6: ['2'],          // the self-guard removed: the file applies without the opt-in
    7: ['9'],          // a bidder loses access when the posting closes
    8: ['5'],          // anon may call the rule and the policy is for anon too
    9: ['12'],         // the owner's delete policy is dropped by the file
  });
}

let MIG = readMigration(ROOT, FILE);
const MUTATE = Number(process.env.MUTATE || 0);
const rep = replacer(() => MIG, (v) => { MIG = v; }, MUTATE);
const noSelfCheck = () => rep("raise exception '[rfp_attachments_private] verify:", "raise notice '[rfp_attachments_private] verify:", true);
switch (MUTATE) {
  case 0: break;
  case 1: rep("update storage.buckets set public = false where id = 'rfp-attachments' and public = true;", ''); noSelfCheck(); break;
  case 2: rep('for select to authenticated\n  using (\n    bucket_id = \'rfp-attachments\'', "for select to public\n  using (\n    bucket_id = 'rfp-attachments'"); rep('  if v_uid is null or p_name is null then\n    return false;\n  end if;', ''); rep('  if pg_catalog.lower(v_owner) = v_uid::text then\n    return true;\n  end if;', '  if v_uid is null then return true; end if;\n  if pg_catalog.lower(v_owner) = v_uid::text then\n    return true;\n  end if;'); rep('revoke all on function public.can_read_rfp_attachment(text) from public, anon;', ''); noSelfCheck(); break;
  case 3: rep("         b.status = 'open'\n         or exists", '         true\n         or exists'); break;
  case 4: rep('       and b.user_id = v_owner::uuid\n', ''); break;
  case 5: rep("  v_parts := pg_catalog.string_to_array(p_name, '/');", "  if pg_catalog.split_part(p_name, '/', 1) = v_uid::text then return true; end if;\n  v_parts := pg_catalog.string_to_array(p_name, '/');"); break;
  case 6: rep("    raise exception 'held: rfp-attachments stays public", "    raise notice 'held: rfp-attachments stays public"); break;
  case 7: rep("         b.status = 'open'\n         or exists (select 1 from public.bid_responses r where r.bid_id = b.id and r.user_id = v_uid)", "         b.status = 'open'"); break;
  case 8: rep('for select to authenticated\n  using (', 'for select to anon, authenticated\n  using ('); rep('  if v_uid is null or p_name is null then\n    return false;\n  end if;', '  if p_name is null then return false; end if;\n  if v_uid is null then return true; end if;'); rep('revoke all on function public.can_read_rfp_attachment(text) from public, anon;', ''); noSelfCheck(); break;
  case 9: rep('drop policy if exists rfp_attachments_read on storage.objects;', 'drop policy if exists rfp_attachments_read on storage.objects;\ndrop policy if exists rfp_attachments_owner_delete on storage.objects;'); break;
  default: console.error('unknown MUTATE'); process.exit(2);
}
if (MUTATE) console.log(`(planted mutation M${MUTATE} applied)`);

const H = '00000000-0000-4000-8000-0000000000a1';   // homeowner
const C = '00000000-0000-4000-8000-0000000000c3';   // a contractor with a bid on the closed posting
const X = '00000000-0000-4000-8000-0000000000e5';   // a signed-in stranger
const OPEN = '11111111-1111-4111-8111-111111111111';
const CLOSED = '22222222-2222-4222-8222-222222222222';
const DRAFT = '33333333-3333-4333-8333-333333333333'; // uploaded, never posted
const fOpen = `${H}/${OPEN}/1759900000000_kitchen.jpg`;
const fClosed = `${H}/${CLOSED}/1759900000001_plans.pdf`;
const fDraft = `${H}/${DRAFT}/1759900000002_draft.jpg`;
const fSpoof = `${X}/${CLOSED}/1759900000003_x.jpg`;  // X's own folder, named after H's posting
const fOdd = `${H}/loose.jpg`;

const SCHEMA = `
create table public.public_bids (id uuid primary key, user_id uuid, status text default 'open', photo_urls jsonb default '[]', drawing_urls jsonb default '[]', address_line text);
create table public.bid_responses (id uuid primary key default gen_random_uuid(), user_id uuid not null, bid_id uuid not null references public.public_bids(id) on delete cascade, status text default 'submitted');
alter table public.public_bids enable row level security;
alter table public.bid_responses enable row level security;
-- the held column revoke, as if applied: authenticated cannot read address_line, so a caller-rights rule that touched the table loosely would break
revoke all on public.public_bids from anon, authenticated;
grant select (id, status, photo_urls, drawing_urls) on public.public_bids to authenticated;
revoke all on public.bid_responses from anon, authenticated;
insert into auth.users (id, email) values ('${H}', 'h@x.test'), ('${C}', 'c@x.test'), ('${X}', 'x@x.test');
insert into public.public_bids (id, user_id, status) values ('${OPEN}', '${H}', 'open'), ('${CLOSED}', '${H}', 'closed');
insert into public.bid_responses (user_id, bid_id) values ('${C}', '${CLOSED}');
insert into storage.buckets (id, name, public) values ('rfp-attachments', 'rfp-attachments', true), ('project-photos', 'project-photos', false);
create policy rfp_attachments_owner_insert on storage.objects for insert to authenticated with check (bucket_id = 'rfp-attachments' and (storage.foldername(name))[1] = (auth.uid())::text);
create policy rfp_attachments_owner_update on storage.objects for update to authenticated using (bucket_id = 'rfp-attachments' and (storage.foldername(name))[1] = (auth.uid())::text);
create policy rfp_attachments_owner_delete on storage.objects for delete to authenticated using (bucket_id = 'rfp-attachments' and (storage.foldername(name))[1] = (auth.uid())::text);
insert into storage.objects (bucket_id, name, owner) values
  ('rfp-attachments', '${fOpen}', '${H}'), ('rfp-attachments', '${fClosed}', '${H}'), ('rfp-attachments', '${fDraft}', '${H}'),
  ('rfp-attachments', '${fSpoof}', '${X}'), ('rfp-attachments', '${fOdd}', '${H}'),
  ('project-photos', '${H}/${OPEN}/p.jpg', '${H}');
`;

const PGlite = await loadPGlite();
const db = new PGlite();
await db.exec(BASE_SQL);
await db.exec(STORAGE_SQL);
await db.exec(SCHEMA);
const { ok, rows, tryRun, done } = makeKit(db);

// ── the guard ──
let guardErr = null;
try { await db.exec(MIG); } catch (e) { guardErr = e; }
const stillPublic = (await rows(`select public from storage.buckets where id = 'rfp-attachments'`))[0].public;
ok('2 applied without the opt-in line the file refuses and changes nothing', guardErr !== null && /held: rfp-attachments stays public/.test(String(guardErr.message)) && stillPublic === true, guardErr ? '' : 'it applied');

let applyErr = null;
try { await db.exec(`set mageid.founder_ok_rfp_private = 'yes';\n${MIG}`); await db.exec(`set mageid.founder_ok_rfp_private = 'yes';\n${MIG}`); } catch (e) { applyErr = e; }
ok('1 with the opt-in line the migration applies cleanly, twice (idempotent)', applyErr === null, applyErr ? String(applyErr.message) : '');
if (applyErr) done();

ok('3 the bucket is private (Storage stops serving /object/public/ for it)', (await rows(`select public from storage.buckets where id = 'rfp-attachments'`))[0].public === false);
{
  const pol = await rows(`select policyname, cmd, roles::text[] as roles from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'`);
  ok('4 exactly one read policy names the bucket, for authenticated only', pol.length === 1 && pol[0].policyname === 'rfp_attachments_read' && JSON.stringify(pol[0].roles) === '["authenticated"]', JSON.stringify(pol));
}
const see = async (role, uid) => {
  const r = await tryRun(role, `select name from storage.objects where bucket_id = 'rfp-attachments' order by name`, uid);
  return r.ok ? r.rows.map((x) => x.name) : [`ERR ${r.err}`];
};
const anonSees = await see('anon', '');
const anonFn = await tryRun('anon', `select public.can_read_rfp_attachment('${fOpen}') as y`);
ok('5 anon reads no object and cannot call the rule', anonSees.length === 0 && !anonFn.ok, JSON.stringify({ anonSees, anonFn: anonFn.ok }));

const hSees = await see('authenticated', H);
ok('6 the homeowner reads everything in her own folder (open, closed and a draft with no posting)', [fOpen, fClosed, fDraft, fOdd].filter((f) => f !== fOdd).every((f) => hSees.includes(f)) && !hSees.includes(fSpoof), JSON.stringify(hSees));

const xSees = await see('authenticated', X);
ok('7 a signed-in contractor reads the files of an OPEN posting', xSees.includes(fOpen), JSON.stringify(xSees));
ok('8 and not the files of a CLOSED posting he has no bid on, nor a draft folder with no posting', !xSees.includes(fClosed) && !xSees.includes(fDraft), JSON.stringify(xSees));

const cSees = await see('authenticated', C);
ok('9 a contractor with a bid on the closed posting still reads its files (the winner keeps the photos)', cSees.includes(fClosed) && cSees.includes(fOpen) && !cSees.includes(fDraft), JSON.stringify(cSees));

ok('10 a folder under someone else\'s id named after the homeowner\'s posting opens for its uploader only (C, who has a bid on that posting, does not see it)',
  xSees.includes(fSpoof) && !cSees.includes(fSpoof) && !hSees.includes(fSpoof), JSON.stringify({ x: xSees.includes(fSpoof), c: cSees.includes(fSpoof) }));
ok('11 a name that is not <uuid>/<uuid>/<file> opens for nobody, its uploader included', !hSees.includes(fOdd) && !xSees.includes(fOdd) && !cSees.includes(fOdd));

{
  const del = await tryRun('authenticated', `delete from storage.objects where bucket_id = 'rfp-attachments' and name = '${fDraft}' returning name`, H);
  const delOther = await tryRun('authenticated', `delete from storage.objects where bucket_id = 'rfp-attachments' and name = '${fOpen}' returning name`, X);
  const ins = await tryRun('authenticated', `insert into storage.objects (bucket_id, name, owner) values ('rfp-attachments', '${H}/${OPEN}/1759900000009_new.jpg', '${H}')`, H);
  const insOther = await tryRun('authenticated', `insert into storage.objects (bucket_id, name, owner) values ('rfp-attachments', '${H}/${OPEN}/1759900000010_evil.jpg', '${X}')`, X);
  ok('12 the owner still uploads to and deletes from her own folder; nobody else does', del.ok && del.n === 1 && delOther.ok && delOther.n === 0 && ins.ok && !insOther.ok, JSON.stringify({ del: del.n ?? del.err, delOther: delOther.n, ins: ins.err, insOther: insOther.ok }));
}
{
  await db.exec(`update public.public_bids set status = 'closed' where id = '${OPEN}'`);
  const after = await see('authenticated', X);
  await db.exec(`delete from public.public_bids where id = '${CLOSED}'`);
  const cAfter = await see('authenticated', C);
  ok('13 closing a posting ends a stranger\'s access; deleting a posting ends a bidder\'s', !after.includes(fOpen) && !cAfter.includes(fClosed), JSON.stringify({ after, cAfter }));
  const other = await tryRun('authenticated', `select name from storage.objects where bucket_id = 'project-photos'`, H);
  ok('14 the policy admits nothing in any other bucket', other.ok && other.n === 0, JSON.stringify(other));
}
{
  const f = (await rows(`select prosecdef, proconfig from pg_proc where proname = 'can_read_rfp_attachment'`))[0];
  ok('15 the rule is SECURITY DEFINER with an empty search_path (it reads public_bids past the column revoke)', f.prosecdef === true && f.proconfig.includes('search_path=""'), JSON.stringify(f));
}
done();
