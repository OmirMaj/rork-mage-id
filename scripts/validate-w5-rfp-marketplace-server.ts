// scripts/validate-w5-rfp-marketplace-server.ts — the marketplace's database
// rules after audit wave 5 (2026-09-23):
//   #12  a homeowner could PATCH a contractor's bid_amount with her own JWT and
//        then award it (award_rfp read the tampered figure into target_budget
//        and the award email); a contractor could set his own bid 'awarded'.
//   #13/#86 every signed-in account could read every homeowner RFP's street
//        address, exact pin and email; the duplicate bids_select_all policy
//        meant narrowing public_bids_select alone would change nothing.
//
// Static: it reads the two migrations. The behaviour is executed in PGlite
// (scratchpad w5rfp_pg/w5_rfp_marketplace.mjs, both files run twice): homeowner
// PATCH of bid_amount / user_id refused, 'shortlisted' allowed, 'awarded'
// refused, contractor 'awarded' refused, award after a tamper writes the
// original amount, the five columns unreadable after 101000 while the safe
// list, the bid_responses / bid_questions policies and post-rfp's INSERT work.
//
// Run: bun run scripts/validate-w5-rfp-marketplace-server.ts

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
/** SQL with -- comments removed, so a header that QUOTES a rule never counts. */
const sqlCode = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

const PRE = 'supabase/migrations/20260923100000_rfp_marketplace_hardening.sql';
// 101000 must not ship before the OTA (an old build's select('*') and Review
// bids' address_line read would fail outright), so it is parked under held/:
// the only place a bulk apply of supabase/migrations/*.sql cannot reach.
const POST = 'supabase/migrations/held/20260923101000_public_bids_private_columns.sql';
const pre = sqlCode(read(PRE));
const post = sqlCode(read(POST));

console.log('\n#12 — a bid is the contractor\'s; the award is the server\'s');
const guard = pre.slice(pre.indexOf('create or replace function public.bid_responses_guard()'), pre.indexOf('revoke execute on function public.bid_responses_guard()'));
ok('bid_responses_guard exists and is a BEFORE INSERT OR UPDATE trigger',
  guard.length > 0 && /create trigger bid_responses_guard\s+before insert or update on public\.bid_responses/.test(pre));
ok('it lets the service role, a postgres-owned definer (award_rfp) and migrations through',
  /v_uid is null/.test(guard) && /auth\.role\(\), ''\) = 'service_role'/.test(guard)
  && /current_user in \('postgres', 'supabase_admin', 'service_role'\)/.test(guard));
ok('the poster may change only status / responded_at / updated_at (every other column compared)',
  /v_frozen text\[\] := array\['status', 'responded_at', 'updated_at'\]/.test(guard)
  && /\(to_jsonb\(new\) - v_frozen\) is distinct from \(to_jsonb\(old\) - v_frozen\)/.test(guard));
ok('the poster may set only submitted / shortlisted / declined — never awarded',
  /new\.status not in \('submitted', 'shortlisted', 'declined'\)/.test(guard) && !/'awarded'\s*\)\s*then\s*return/.test(guard));
ok('the poster cannot change a bid already awarded or withdrawn',
  /coalesce\(old\.status, 'submitted'\) in \('awarded', 'withdrawn'\)/.test(guard));
ok('the contractor cannot change user_id / bid_id / awarded_project_id',
  /new\.user_id is distinct from old\.user_id/.test(guard) && /new\.bid_id is distinct from old\.bid_id/.test(guard)
  && /new\.awarded_project_id is distinct from old\.awarded_project_id/.test(guard));
ok('the contractor may change status only to withdraw a live bid',
  /not \(new\.status = 'withdrawn' and coalesce\(old\.status, 'submitted'\) in \('submitted', 'shortlisted'\)\)/.test(guard));
ok('the contractor cannot re-price once the homeowner acted (status <> submitted)',
  /new\.bid_amount is distinct from old\.bid_amount\s+and coalesce\(old\.status, 'submitted'\) <> 'submitted'/.test(guard));
ok('an UPDATE tamper raises 42501 (the caller is told); an INSERT is pinned, not raised',
  (guard.match(/errcode = '42501'/g) ?? []).length >= 5
  && /if tg_op = 'INSERT' then\s+[\s\S]*?new\.status := 'submitted';\s+new\.awarded_project_id := null;\s+new\.responded_at := null;\s+return new;/.test(guard));
ok('anon loses UPDATE on bid_responses', /revoke update on public\.bid_responses from anon;/.test(pre));

const award = pre.slice(pre.indexOf('create or replace function public.award_rfp('));
ok('award_rfp is redefined here, same signature, SECURITY DEFINER, search_path public',
  /create or replace function public\.award_rfp\(p_homeowner_id uuid, p_bid_id uuid, p_response_id uuid\)\s+returns jsonb\s+language plpgsql\s+security definer\s+set search_path to 'public'/.test(award));
ok('award_rfp reads the winner\'s status and refuses anything but submitted / shortlisted',
  /SELECT id, bid_id, user_id, status, company_name, bid_amount/.test(award)
  && /IF v_winner\.status IS NULL OR v_winner\.status NOT IN \('submitted', 'shortlisted'\) THEN\s+RAISE EXCEPTION/.test(award));
ok('award_rfp still takes the amount from the stored bid, to the cent',
  /round\(v_winner\.bid_amount::numeric, 2\)/.test(award));
ok('award_rfp stays service-role only',
  /revoke execute on function public\.award_rfp\(uuid, uuid, uuid\) from public, anon, authenticated;/.test(pre)
  && /grant\s+execute on function public\.award_rfp\(uuid, uuid, uuid\) to service_role;/.test(pre)
  && !/grant\s+execute on function public\.award_rfp\([^)]*\) to (anon|authenticated)/.test(pre));
// The newest award_rfp definition in the repo must be this one (a later file
// would silently undo the status check).
const migs = readdirSync(join(ROOT, 'supabase/migrations')).filter(f => /^\d{14}_.*\.sql$/.test(f)).sort();
const awardMigs = migs.filter(f => /create or replace function public\.award_rfp\(/i.test(read(`supabase/migrations/${f}`)));
ok('20260923100000 is the newest award_rfp definition', awardMigs[awardMigs.length - 1] === PRE.split('/').pop(), awardMigs.join(', '));

const keep = pre.slice(pre.indexOf('create or replace function public.public_bids_keep_award()'), pre.indexOf('revoke execute on function public.public_bids_keep_award()'));
ok('public_bids award columns are pinned for a signed-in caller (silently) and an awarded post stays closed',
  /new\.awarded_response_id := old\.awarded_response_id;/.test(keep) && /new\.awarded_at := old\.awarded_at;/.test(keep)
  && /if old\.awarded_response_id is not null then\s+new\.status := old\.status;/.test(keep)
  && /create trigger public_bids_keep_award\s+before insert or update on public\.public_bids/.test(pre));

console.log('\n#13/#86 — the private fields go to two people');
ok('lat_coarse / lng_coarse added, trigger-filled at 2 decimals, backfilled',
  /add column if not exists lat_coarse numeric/.test(pre) && /add column if not exists lng_coarse numeric/.test(pre)
  && /new\.lat_coarse := case when new\.latitude is null then null else round\(new\.latitude::numeric, 2\) end;/.test(pre)
  && /create trigger public_bids_coarse_location\s+before insert or update on public\.public_bids/.test(pre)
  && /update public\.public_bids\s+set lat_coarse = round\(latitude::numeric, 2\)/.test(pre));
const priv = pre.slice(pre.indexOf('create or replace function public.get_rfp_private('), pre.indexOf('revoke execute on function public.get_rfp_private('));
ok('get_rfp_private(p_bid_id uuid) returns jsonb, SECURITY DEFINER, search_path pinned',
  /public\.get_rfp_private\(p_bid_id uuid\)\s+returns jsonb[\s\S]*?security definer\s+set search_path = pg_catalog, public/.test(priv));
ok('…only to the poster or the owner of the awarded response',
  /v_bid\.user_id is distinct from v_uid/.test(priv)
  && /r\.id = v_bid\.awarded_response_id\s+and r\.user_id = v_uid/.test(priv)
  && /errcode = '42501'/.test(priv));
ok('…with exactly the CONTRACT 14 keys',
  /'address_line',\s+v_bid\.address_line/.test(priv) && /'latitude',\s+v_bid\.latitude/.test(priv)
  && /'longitude',\s+v_bid\.longitude/.test(priv) && /'contact_email', v_bid\.contact_email/.test(priv));
ok('get_rfp_private is revoked from public/anon and granted to authenticated',
  /revoke execute on function public\.get_rfp_private\(uuid\) from public, anon;/.test(pre)
  && /grant execute on function public\.get_rfp_private\(uuid\) to authenticated;/.test(pre));
const contacts = pre.slice(pre.indexOf('create or replace function public.get_bid_contacts('), pre.indexOf('revoke execute on function public.get_bid_contacts('));
ok('get_bid_contacts never returns a homeowner RFP\'s contact to anyone but its poster',
  /\(b\.is_homeowner_rfp is not true or b\.user_id = auth\.uid\(\)\)/.test(contacts) && /auth\.uid\(\) is not null/.test(contacts)
  && /security definer/.test(contacts)
  && /revoke execute on function public\.get_bid_contacts\(uuid\[\]\) from public, anon;/.test(pre));
ok('the duplicate permissive bids_select_all is dropped', /drop policy if exists bids_select_all on public\.public_bids;/.test(pre));
ok('100000 revokes no SELECT (that waits for the OTA — an old build\'s select(\'*\') would fail)',
  !/revoke select/i.test(pre));

console.log('\n#86 — 101000 (after the OTA): the five columns are revoked for real');
ok('table-level SELECT is revoked from anon and authenticated (a column revoke alone bites nothing)',
  /revoke select on public\.public_bids from anon, authenticated;/.test(post));
ok('SELECT is re-granted to authenticated on every column except the five, read from the catalog',
  /c\.column_name not in \('address_line', 'latitude', 'longitude', 'contact_email', 'posted_by'\)/.test(post)
  && /grant select \(%s\) on public\.public_bids to authenticated/.test(post));
ok('and any explicit column grant on the five is revoked too',
  /revoke select \(address_line, latitude, longitude, contact_email, posted_by\)\s+on public\.public_bids from anon, authenticated;/.test(post));
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
ok('101000 sorts after 100000 (the RPCs it depends on exist first)', base(POST) > base(PRE));
ok('101000 is held (not in the top-level folder a bulk apply sweeps)',
  existsSync(join(ROOT, POST))
  && !existsSync(join(ROOT, 'supabase/migrations/20260923101000_public_bids_private_columns.sql')));
ok('held/README.md lists 101000 with its apply-after-OTA precondition',
  /20260923101000_public_bids_private_columns\.sql[^\n]*\|[^\n]*OTA/.test(read('supabase/migrations/held/README.md')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
