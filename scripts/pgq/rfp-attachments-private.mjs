// rfp-attachments-private.mjs — PGlite proof of the two rfp-attachments files (lane PROTECT-SERVER):
//   part 1  20261010120000_rfp_attachments_private.sql   the read rule and its SELECT policy, no gate
//   part 2  20261010140000_rfp_attachments_flip.sql      public = false, behind the founder opt-in line
// Usage: [MUTATE=<n>] node scripts/pgq/rfp-attachments-private.mjs <worktree>
//        node scripts/pgq/rfp-attachments-private.mjs <worktree> --all
// PGlite has no Storage service: "anonymous GET of a public URL" is modelled by the bucket's
// `public` flag (Storage serves /object/public/ only when it is true) plus the SELECT policy
// (what /object/sign and /object/authenticated consult). The live check is in the header.
import { BASE_SQL, STORAGE_SQL, loadPGlite, makeKit, readMigration, replacer, runAll, worktreeArg } from './_harness.mjs';

const ROOT = worktreeArg('scripts/pgq/rfp-attachments-private.mjs');
const FILE = '20261010120000_rfp_attachments_private.sql';
const FLIP_FILE = '20261010140000_rfp_attachments_flip.sql';

if (process.argv[3] === '--all') {
  runAll(import.meta.url, ROOT, {
    1: ['3'],          // part 2 never flips the bucket
    2: ['5'],          // the policy is for public (anon reads)
    3: ['17', '13'],   // the open-posting condition removed: a closed posting stays readable by any account
    4: ['10'],         // the posting-owner match removed: a folder named after someone else's posting opens
    5: ['11'],         // any three-segment name passes for a signed-in account
    6: ['2'],          // part 2's self-guard removed: it applies without the opt-in
    7: ['9'],          // the awarded bidder loses access when the posting closes
    8: ['5'],          // anon may call the rule and the policy is for anon too
    9: ['12'],         // the owner's delete policy is dropped by the file
    10: ['17', '18'],  // the first draft's rule: any bid row on the posting opens it
    11: ['19'],        // the awarded response need not still read 'awarded'
    12: ['21'],        // a response created after the award counts
    13: ['16'],        // part 2 no longer needs part 1
    14: ['22'],        // part 2 no longer refuses a read policy with no bucket filter
    15: ['1'],         // part 1 flips the bucket by itself
  });
}

let MIG = readMigration(ROOT, FILE);
let FLIP = readMigration(ROOT, FLIP_FILE);
const MUTATE = Number(process.env.MUTATE || 0);
const rep = replacer(() => MIG, (v) => { MIG = v; }, MUTATE);
const repFlip = replacer(() => FLIP, (v) => { FLIP = v; }, MUTATE);
const noSelfCheck = () => rep("raise exception '[rfp_attachments_private] verify:", "raise notice '[rfp_attachments_private] verify:", true);
const noFlipCheck = () => repFlip("raise exception '[rfp_attachments_flip] verify:", "raise notice '[rfp_attachments_flip] verify:", true);
const OPEN_COND = "         (b.status = 'open' and b.awarded_response_id is null)\n";
switch (MUTATE) {
  case 0: break;
  case 1: repFlip("update storage.buckets set public = false where id = 'rfp-attachments' and public = true;", ''); noFlipCheck(); break;
  case 2: rep('for select to authenticated\n  using (\n    bucket_id = \'rfp-attachments\'', "for select to public\n  using (\n    bucket_id = 'rfp-attachments'"); rep('  if v_uid is null or p_name is null then\n    return false;\n  end if;', ''); rep('  if pg_catalog.lower(v_owner) = v_uid::text then\n    return true;\n  end if;', '  if v_uid is null then return true; end if;\n  if pg_catalog.lower(v_owner) = v_uid::text then\n    return true;\n  end if;'); rep('revoke all on function public.can_read_rfp_attachment(text) from public, anon;', ''); noSelfCheck(); noFlipCheck(); break;
  case 3: rep(OPEN_COND, '         true\n'); break;
  case 4: rep('       and b.user_id = v_owner::uuid\n', ''); break;
  case 5: rep("  v_parts := pg_catalog.string_to_array(p_name, '/');", "  if pg_catalog.split_part(p_name, '/', 1) = v_uid::text then return true; end if;\n  v_parts := pg_catalog.string_to_array(p_name, '/');"); break;
  case 6: repFlip("    raise exception 'held: rfp-attachments stays public", "    raise notice 'held: rfp-attachments stays public"); break;
  case 7: rep("            where r.id = b.awarded_response_id\n", "            where false and r.id = b.awarded_response_id\n"); break;
  case 8: rep('for select to authenticated\n  using (', 'for select to anon, authenticated\n  using ('); rep('  if v_uid is null or p_name is null then\n    return false;\n  end if;', '  if p_name is null then return false; end if;\n  if v_uid is null then return true; end if;'); rep('revoke all on function public.can_read_rfp_attachment(text) from public, anon;', ''); noSelfCheck(); noFlipCheck(); break;
  case 9: rep('drop policy if exists rfp_attachments_read on storage.objects;', 'drop policy if exists rfp_attachments_read on storage.objects;\ndrop policy if exists rfp_attachments_owner_delete on storage.objects;'); break;
  case 10: rep("            where r.id = b.awarded_response_id\n              and r.bid_id = b.id\n              and r.user_id = v_uid\n              and r.status = 'awarded'\n", "            where r.bid_id = b.id\n              and r.user_id = v_uid\n"); break;
  case 11: rep("              and r.status = 'awarded'\n", ''); break;
  case 12: rep("              and (r.created_at is null or b.awarded_at is null or r.created_at <= b.awarded_at)\n", ''); break;
  case 13: repFlip("  if to_regprocedure('public.can_read_rfp_attachment(text)') is null\n     or not exists (", "  if false and not exists ("); break;
  case 14: repFlip("     and coalesce(qual, '') not like '%bucket_id%';", "     and false;"); break;
  case 15: rep('-- ── self-check ─', "update storage.buckets set public = false where id = 'rfp-attachments';\n-- ── self-check ─"); break;
  default: console.error('unknown MUTATE'); process.exit(2);
}
if (MUTATE) console.log(`(planted mutation M${MUTATE} applied)`);

const H = '00000000-0000-4000-8000-0000000000a1';   // homeowner
const W = '00000000-0000-4000-8000-0000000000b2';   // the awarded bidder on the closed posting
const C = '00000000-0000-4000-8000-0000000000c3';   // a declined bidder on the closed posting
const D = '00000000-0000-4000-8000-0000000000d4';   // a bidder who withdrew from the closed posting
const X = '00000000-0000-4000-8000-0000000000e5';   // a signed-in stranger: bids on the closed posting AFTER it closed
const L = '00000000-0000-4000-8000-0000000000f6';   // named as awarded on LATE, but his response is dated after the award
const U = '00000000-0000-4000-8000-0000000000a7';   // named as awarded on UNDONE, but his response no longer reads 'awarded'
const OPEN = '11111111-1111-4111-8111-111111111111';
const CLOSED = '22222222-2222-4222-8222-222222222222';
const DRAFT = '33333333-3333-4333-8333-333333333333'; // uploaded, never posted
const LATE = '44444444-4444-4444-8444-444444444444';
const UNDONE = '55555555-5555-4555-8555-555555555555';
const RW = '66666666-6666-4666-8666-666666666601';
const RL = '66666666-6666-4666-8666-666666666602';
const RU = '66666666-6666-4666-8666-666666666603';
const fOpen = `${H}/${OPEN}/1759900000000_kitchen.jpg`;
const fClosed = `${H}/${CLOSED}/1759900000001_plans.pdf`;
const fDraft = `${H}/${DRAFT}/1759900000002_draft.jpg`;
const fSpoof = `${X}/${CLOSED}/1759900000003_x.jpg`;  // X's own folder, named after H's posting
const fLate = `${H}/${LATE}/1759900000004_late.jpg`;
const fUndone = `${H}/${UNDONE}/1759900000005_undone.jpg`;
const fOdd = `${H}/loose.jpg`;

const SCHEMA = `
create table public.public_bids (id uuid primary key, user_id uuid, status text default 'open', awarded_response_id uuid, awarded_at timestamptz, photo_urls jsonb default '[]', drawing_urls jsonb default '[]', address_line text);
create table public.bid_responses (id uuid primary key default gen_random_uuid(), user_id uuid not null, bid_id uuid not null references public.public_bids(id) on delete cascade, status text default 'submitted', created_at timestamptz default now());
alter table public.public_bids enable row level security;
alter table public.bid_responses enable row level security;
-- the held column revoke, as if applied: authenticated cannot read address_line, so a caller-rights rule that touched the table loosely would break
revoke all on public.public_bids from anon, authenticated;
grant select (id, status, photo_urls, drawing_urls) on public.public_bids to authenticated;
revoke all on public.bid_responses from anon, authenticated;
insert into auth.users (id, email) values ('${H}', 'h@x.test'), ('${W}', 'w@x.test'), ('${C}', 'c@x.test'), ('${D}', 'd@x.test'), ('${X}', 'x@x.test'), ('${L}', 'l@x.test'), ('${U}', 'u@x.test');
insert into public.public_bids (id, user_id, status, awarded_response_id, awarded_at) values
  ('${OPEN}', '${H}', 'open', null, null),
  ('${CLOSED}', '${H}', 'closed', '${RW}', now() - interval '1 day'),
  ('${LATE}', '${H}', 'closed', '${RL}', now() - interval '1 day'),
  ('${UNDONE}', '${H}', 'closed', '${RU}', now() - interval '1 day');
insert into public.bid_responses (id, user_id, bid_id, status, created_at) values
  ('${RW}', '${W}', '${CLOSED}', 'awarded', now() - interval '3 days'),
  (gen_random_uuid(), '${C}', '${CLOSED}', 'declined', now() - interval '3 days'),
  (gen_random_uuid(), '${D}', '${CLOSED}', 'withdrawn', now() - interval '3 days'),
  -- the attack: a bid placed after the close, dated before it, still reading 'submitted' (as if the bid guard were not there)
  (gen_random_uuid(), '${X}', '${CLOSED}', 'submitted', now() - interval '5 days'),
  ('${RL}', '${L}', '${LATE}', 'awarded', now()),
  ('${RU}', '${U}', '${UNDONE}', 'declined', now() - interval '3 days');
insert into storage.buckets (id, name, public) values ('rfp-attachments', 'rfp-attachments', true), ('project-photos', 'project-photos', false);
create policy rfp_attachments_owner_insert on storage.objects for insert to authenticated with check (bucket_id = 'rfp-attachments' and (storage.foldername(name))[1] = (auth.uid())::text);
create policy rfp_attachments_owner_update on storage.objects for update to authenticated using (bucket_id = 'rfp-attachments' and (storage.foldername(name))[1] = (auth.uid())::text);
create policy rfp_attachments_owner_delete on storage.objects for delete to authenticated using (bucket_id = 'rfp-attachments' and (storage.foldername(name))[1] = (auth.uid())::text);
insert into storage.objects (bucket_id, name, owner) values
  ('rfp-attachments', '${fOpen}', '${H}'), ('rfp-attachments', '${fClosed}', '${H}'), ('rfp-attachments', '${fDraft}', '${H}'),
  ('rfp-attachments', '${fSpoof}', '${X}'), ('rfp-attachments', '${fOdd}', '${H}'),
  ('rfp-attachments', '${fLate}', '${H}'), ('rfp-attachments', '${fUndone}', '${H}'),
  ('project-photos', '${H}/${OPEN}/p.jpg', '${H}');
`;

const PGlite = await loadPGlite();
const db = new PGlite();
await db.exec(BASE_SQL);
await db.exec(STORAGE_SQL);
await db.exec(SCHEMA);
const { ok, rows, tryRun, done } = makeKit(db);
const OPT = `set mageid.founder_ok_rfp_private = 'yes';\n`;
const isPublic = async () => (await rows(`select public from storage.buckets where id = 'rfp-attachments'`))[0].public;
const see = async (role, uid) => {
  const r = await tryRun(role, `select name from storage.objects where bucket_id = 'rfp-attachments' order by name`, uid);
  return r.ok ? r.rows.map((x) => x.name) : [`ERR ${r.err}`];
};

// ── part 2 before part 1 ──
{
  let err = null;
  try { await db.exec(OPT + FLIP); } catch (e) { err = e; }
  await db.exec(`reset mageid.founder_ok_rfp_private`);
  ok('16 part 2 refuses, opt-in and all, while part 1 is not applied (flipping first would blank every photo)', err !== null && /part 1 .* is not applied/.test(String(err.message)) && (await isPublic()) === true, err ? String(err.message).slice(0, 80) : 'it applied');
}

// ── part 1: no gate, no flip ──
let applyErr = null;
try { await db.exec(MIG); await db.exec(MIG); } catch (e) { applyErr = e; }
ok('1 part 1 applies cleanly with no opt-in line, twice (idempotent), and leaves the bucket public', applyErr === null && (await isPublic()) === true, applyErr ? String(applyErr.message) : ((await isPublic()) ? '' : 'the bucket was flipped'));
if (applyErr) done();
{
  const xMid = await see('authenticated', X);
  const anonMid = await see('anon', '');
  ok('20 between the parts the rule already answers (signing works for an open posting; anon still has no policy)', xMid.includes(fOpen) && !xMid.includes(fClosed) && anonMid.length === 0, JSON.stringify({ xMid, anonMid }));
}

// ── part 2: the guard, the preconditions, the flip ──
{
  let guardErr = null;
  try { await db.exec(FLIP); } catch (e) { guardErr = e; }
  ok('2 part 2 applied without the opt-in line refuses and changes nothing', guardErr !== null && /held: rfp-attachments stays public/.test(String(guardErr.message)) && (await isPublic()) === true, guardErr ? '' : 'it applied');
}
{
  await db.exec(`create policy everything_readable on storage.objects for select to authenticated using (true)`);
  let err = null;
  try { await db.exec(OPT + FLIP); } catch (e) { err = e; }
  await db.exec(`reset mageid.founder_ok_rfp_private`);
  ok('22 part 2 refuses while a read policy on storage.objects names no bucket (it would keep the bucket readable)', err !== null && /name no bucket/.test(String(err.message)) && (await isPublic()) === true, err ? String(err.message).slice(0, 80) : 'it applied');
  await db.exec(`drop policy everything_readable on storage.objects`);
}
let flipErr = null;
try { await db.exec(OPT + FLIP); await db.exec(OPT + FLIP); } catch (e) { flipErr = e; }
ok('23 with the opt-in line and the preconditions met, part 2 applies cleanly, twice', flipErr === null, flipErr ? String(flipErr.message) : '');
if (flipErr) done();

ok('3 the bucket is private (Storage stops serving /object/public/ for it)', (await isPublic()) === false);
{
  const pol = await rows(`select policyname, cmd, roles::text[] as roles from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'`);
  ok('4 exactly one read policy names the bucket, for authenticated only', pol.length === 1 && pol[0].policyname === 'rfp_attachments_read' && JSON.stringify(pol[0].roles) === '["authenticated"]', JSON.stringify(pol));
}
const anonSees = await see('anon', '');
const anonFn = await tryRun('anon', `select public.can_read_rfp_attachment('${fOpen}') as y`);
ok('5 anon reads no object and cannot call the rule', anonSees.length === 0 && !anonFn.ok, JSON.stringify({ anonSees, anonFn: anonFn.ok }));

const hSees = await see('authenticated', H);
ok('6 the homeowner reads everything in her own folder (open, closed and a draft with no posting)', [fOpen, fClosed, fDraft, fLate, fUndone].every((f) => hSees.includes(f)) && !hSees.includes(fSpoof), JSON.stringify(hSees));

const xSees = await see('authenticated', X);
ok('7 any signed-in account reads the files of an OPEN posting', xSees.includes(fOpen), JSON.stringify(xSees));
ok('8 and not a draft folder with no posting', !xSees.includes(fDraft), JSON.stringify(xSees));

const wSees = await see('authenticated', W);
ok('9 the awarded bidder still reads the closed posting\'s files (the winner keeps the photos)', wSees.includes(fClosed) && wSees.includes(fOpen) && !wSees.includes(fDraft) && !wSees.includes(fLate), JSON.stringify(wSees));

ok('17 a stranger who bid on the posting AFTER it closed (row dated before the close, status submitted) cannot read its files', !xSees.includes(fClosed), JSON.stringify(xSees));
{
  const cSees = await see('authenticated', C);
  const dSees = await see('authenticated', D);
  ok('18 a declined bidder and a withdrawn bidder cannot read a closed posting\'s files', !cSees.includes(fClosed) && !dSees.includes(fClosed) && cSees.includes(fOpen), JSON.stringify({ c: cSees.includes(fClosed), d: dSees.includes(fClosed) }));
}
{
  const uSees = await see('authenticated', U);
  ok('19 a response the posting names as awarded but that no longer reads \'awarded\' opens nothing', !uSees.includes(fUndone), JSON.stringify(uSees));
  const lSees = await see('authenticated', L);
  ok('21 a response named as awarded but created after the award opens nothing', !lSees.includes(fLate), JSON.stringify(lSees));
}

ok('10 a folder under someone else\'s id named after the homeowner\'s posting opens for its uploader only (the winner does not see it)',
  xSees.includes(fSpoof) && !wSees.includes(fSpoof) && !hSees.includes(fSpoof), JSON.stringify({ x: xSees.includes(fSpoof), w: wSees.includes(fSpoof) }));
ok('11 a name that is not <uuid>/<uuid>/<file> opens for nobody, its uploader included', !hSees.includes(fOdd) && !xSees.includes(fOdd) && !wSees.includes(fOdd));

{
  const del = await tryRun('authenticated', `delete from storage.objects where bucket_id = 'rfp-attachments' and name = '${fDraft}' returning name`, H);
  const delOther = await tryRun('authenticated', `delete from storage.objects where bucket_id = 'rfp-attachments' and name = '${fOpen}' returning name`, X);
  const ins = await tryRun('authenticated', `insert into storage.objects (bucket_id, name, owner) values ('rfp-attachments', '${H}/${OPEN}/1759900000009_new.jpg', '${H}')`, H);
  const insOther = await tryRun('authenticated', `insert into storage.objects (bucket_id, name, owner) values ('rfp-attachments', '${H}/${OPEN}/1759900000010_evil.jpg', '${X}')`, X);
  ok('12 the owner still uploads to and deletes from her own folder; nobody else does', del.ok && del.n === 1 && delOther.ok && delOther.n === 0 && ins.ok && !insOther.ok, JSON.stringify({ del: del.n ?? del.err, delOther: delOther.n, ins: ins.err, insOther: insOther.ok }));
}
{
  // The posting closes with no award; X then places a bid on it.
  await db.exec(`update public.public_bids set status = 'closed' where id = '${OPEN}'`);
  await db.exec(`insert into public.bid_responses (user_id, bid_id, status) values ('${X}', '${OPEN}', 'submitted')`);
  const after = await see('authenticated', X);
  await db.exec(`delete from public.public_bids where id = '${CLOSED}'`);
  const wAfter = await see('authenticated', W);
  ok('13 closing a posting ends a stranger\'s access, bid or no bid; deleting a posting ends the winner\'s', !after.includes(fOpen) && !wAfter.includes(fClosed), JSON.stringify({ after, wAfter }));
  const other = await tryRun('authenticated', `select name from storage.objects where bucket_id = 'project-photos'`, H);
  ok('14 the policy admits nothing in any other bucket', other.ok && other.n === 0, JSON.stringify(other));
}
{
  const f = (await rows(`select prosecdef, proconfig from pg_proc where proname = 'can_read_rfp_attachment'`))[0];
  ok('15 the rule is SECURITY DEFINER with an empty search_path (it reads public_bids past the column revoke)', f.prosecdef === true && f.proconfig.includes('search_path=""'), JSON.stringify(f));
}
done();
