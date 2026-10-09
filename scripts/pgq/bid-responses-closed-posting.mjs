// bid-responses-closed-posting.mjs — PGlite proof of 20261010130000_bid_responses_closed_posting.sql (lane PROTECT-SERVER).
// Usage: [MUTATE=<n>] node scripts/pgq/bid-responses-closed-posting.mjs <worktree>
//        node scripts/pgq/bid-responses-closed-posting.mjs <worktree> --all
// The tables and the two bid_responses policies are production's (20260518120000_rls_baseline.sql).
import { BASE_SQL, loadPGlite, makeKit, readMigration, replacer, runAll, worktreeArg } from './_harness.mjs';

const ROOT = worktreeArg('scripts/pgq/bid-responses-closed-posting.mjs');
const FILE = '20261010130000_bid_responses_closed_posting.sql';

if (process.argv[3] === '--all') {
  runAll(import.meta.url, ROOT, {
    1: ['3', '4'],     // the posting is never read: a bid on a closed posting is a live bid
    2: ['4'],          // an awarded posting whose status still reads open takes a bid
    3: ['5'],          // the client's created_at is kept
    4: ['6'],          // the late bid is raised, not pinned: a replay of a landed bid becomes a refusal
    5: ['8'],          // the contractor can redate his own bid
    6: ['7'],          // the late bid is pinned to 'declined', which the homeowner can restore
  });
}

let MIG = readMigration(ROOT, FILE);
const MUTATE = Number(process.env.MUTATE || 0);
const rep = replacer(() => MIG, (v) => { MIG = v; }, MUTATE);
switch (MUTATE) {
  case 0: break;
  case 1: rep("    if found and (coalesce(v_post_status, '') <> 'open' or v_post_award is not null) then", '    if false then'); break;
  case 2: rep("(coalesce(v_post_status, '') <> 'open' or v_post_award is not null)", "(coalesce(v_post_status, '') <> 'open')"); break;
  case 3: rep('    new.created_at := pg_catalog.now();\n', ''); break;
  case 4: rep("      new.status := 'withdrawn';\n", "      raise exception 'This project is not taking bids' using errcode = '42501';\n"); break;
  case 5: rep('  if new.created_at is distinct from old.created_at then', '  if false then'); break;
  case 6: rep("      new.status := 'withdrawn';\n", "      new.status := 'declined';\n"); break;
  default: console.error('unknown MUTATE'); process.exit(2);
}
if (MUTATE) console.log(`(planted mutation M${MUTATE} applied)`);

const H = '00000000-0000-4000-8000-0000000000a1';   // homeowner
const C = '00000000-0000-4000-8000-0000000000c3';   // a contractor
const X = '00000000-0000-4000-8000-0000000000e5';   // a signed-in stranger
const OPEN = '11111111-1111-4111-8111-111111111111';
const CLOSED = '22222222-2222-4222-8222-222222222222';
const AWARDED_OPEN = '33333333-3333-4333-8333-333333333333'; // an award recorded, status never moved
const SOON = '44444444-4444-4444-8444-444444444444';         // open now; closes while a bid is replayed
const R1 = '66666666-6666-4666-8666-666666666601';
const R2 = '66666666-6666-4666-8666-666666666602';
const R3 = '66666666-6666-4666-8666-666666666603';
const R4 = '66666666-6666-4666-8666-666666666604';
const R5 = '66666666-6666-4666-8666-666666666605';

const SCHEMA = `
create table public.public_bids (id uuid primary key, user_id uuid, status text default 'open', awarded_response_id uuid, awarded_at timestamptz);
create table public.bid_responses (id uuid primary key default gen_random_uuid(), user_id uuid not null, bid_id uuid not null references public.public_bids(id) on delete cascade,
  status text default 'submitted', bid_amount numeric, awarded_project_id uuid, responded_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
alter table public.public_bids enable row level security;
alter table public.bid_responses enable row level security;
create policy public_bids_select on public.public_bids for select to authenticated using (true);
create policy bid_responses_own on public.bid_responses as permissive for all to public using ((auth.uid() = user_id));
create policy bid_responses_view on public.bid_responses as permissive for select to public using ((exists (select 1 from public.public_bids pb where ((pb.id = bid_responses.bid_id) and (pb.user_id = auth.uid())))));
create policy br_homeowner_update_status on public.bid_responses as permissive for update to public using ((exists (select 1 from public.public_bids pb where ((pb.id = bid_responses.bid_id) and (pb.user_id = auth.uid())))));
insert into auth.users (id, email) values ('${H}', 'h@x.test'), ('${C}', 'c@x.test'), ('${X}', 'x@x.test');
insert into public.public_bids (id, user_id, status, awarded_response_id, awarded_at) values
  ('${OPEN}', '${H}', 'open', null, null), ('${CLOSED}', '${H}', 'closed', null, null),
  ('${AWARDED_OPEN}', '${H}', 'open', gen_random_uuid(), now()), ('${SOON}', '${H}', 'open', null, null);
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
const row = async (id) => (await rows(`select status, awarded_project_id, responded_at, created_at, (created_at > now() - interval '1 minute') as fresh from public.bid_responses where id = '${id}'`))[0];
const bid = (id, uid, posting, extra = '', extraVals = '') => tryRun('authenticated', `insert into public.bid_responses (id, user_id, bid_id, status, bid_amount${extra}) values ('${id}', '${uid}', '${posting}', 'awarded', 100${extraVals})`, uid);

{
  const r = await bid(R1, C, OPEN, ', awarded_project_id', `, gen_random_uuid()`);
  const got = await row(R1);
  ok('2 a bid on an OPEN posting lands as submitted with no award link, whatever the client typed', r.ok && got?.status === 'submitted' && got.awarded_project_id === null, JSON.stringify({ r: r.err, got }));
}
{
  const r = await bid(R2, X, CLOSED);
  const got = await row(R2);
  ok('3 a bid on a CLOSED posting is stored as withdrawn (not refused, not live)', r.ok && got?.status === 'withdrawn', JSON.stringify({ r: r.err, got }));
}
{
  const r = await bid(R3, X, AWARDED_OPEN);
  const got = await row(R3);
  ok('4 a bid on a posting with an award recorded is stored as withdrawn even while its status reads open', r.ok && got?.status === 'withdrawn', JSON.stringify({ r: r.err, got }));
}
{
  const r = await bid(R4, C, SOON, ', created_at', `, '2001-01-01T00:00:00Z'`);
  const got = await row(R4);
  ok('5 the date of a bid is the server clock, not the one the client typed', r.ok && got?.fresh === true, JSON.stringify({ r: r.err, got }));
}
{
  // R4 landed while SOON was open. The posting closes; the phone replays the same insert.
  await db.exec(`update public.public_bids set status = 'closed' where id = '${SOON}'`);
  const replay = await bid(R4, C, SOON);
  const got = await row(R4);
  ok('6 a replay of a bid that already landed, after the posting closed, ends as a duplicate key (what the queue reads as saved) and the bid stays submitted',
    !replay.ok && /duplicate key|unique/i.test(replay.err) && got?.status === 'submitted', JSON.stringify({ replay: replay.err, got }));
}
{
  const own = await tryRun('authenticated', `update public.bid_responses set status = 'submitted' where id = '${R2}'`, X);
  const owner = await tryRun('authenticated', `update public.bid_responses set status = 'submitted' where id = '${R2}'`, H);
  const got = await row(R2);
  ok('7 nobody moves the late bid back to live: not the bidder, not the homeowner', !own.ok && !owner.ok && got?.status === 'withdrawn', JSON.stringify({ own: own.err ?? 'allowed', owner: owner.err ?? 'allowed', got }));
}
{
  const redate = await tryRun('authenticated', `update public.bid_responses set created_at = '2001-01-01T00:00:00Z' where id = '${R1}'`, C);
  const price = await tryRun('authenticated', `update public.bid_responses set bid_amount = 250 where id = '${R1}'`, C);
  ok('8 the contractor cannot redate his own bid, and can still change its price while it is submitted', !redate.ok && price.ok && price.affected === 1, JSON.stringify({ redate: redate.err ?? 'allowed', price: price.err }));
}
{
  const shortlist = await tryRun('authenticated', `update public.bid_responses set status = 'shortlisted', responded_at = now() where id = '${R1}'`, H);
  const tamper = await tryRun('authenticated', `update public.bid_responses set bid_amount = 1 where id = '${R1}'`, H);
  const withdraw = await tryRun('authenticated', `update public.bid_responses set status = 'withdrawn' where id = '${R1}'`, C);
  ok('9 the flows that exist still work: the homeowner shortlists (and cannot touch the price), the contractor withdraws', shortlist.ok && shortlist.affected === 1 && !tamper.ok && withdraw.ok && withdraw.affected === 1, JSON.stringify({ shortlist: shortlist.err, tamper: tamper.err ?? 'allowed', withdraw: withdraw.err }));
}
{
  await db.exec(`insert into public.bid_responses (id, user_id, bid_id, status, created_at) values ('${R5}', '${C}', '${CLOSED}', 'awarded', '2001-01-01T00:00:00Z')`);
  const got = (await rows(`select status, (created_at at time zone 'UTC')::date::text as d from public.bid_responses where id = '${R5}'`))[0];
  ok('10 the award path (a database session, the service role, a definer) is not policed', got.status === 'awarded' && got.d === '2001-01-01', JSON.stringify(got));
}
{
  const r = await tryRun('authenticated', `insert into public.bid_responses (user_id, bid_id) values ('${X}', '99999999-9999-4999-8999-999999999999')`, X);
  ok('11 a bid on a posting that does not exist is refused by the foreign key, as before', !r.ok && /foreign key/i.test(r.err), r.err ?? 'allowed');
  const call = await tryRun('authenticated', `select has_function_privilege('authenticated', 'public.bid_responses_guard()', 'execute') as y`, X);
  ok('12 a client cannot call the guard directly', call.ok && call.rows[0].y === false, JSON.stringify(call));
}
done();
