-- 20260908120000_bid_package_invites.sql
--
-- Audit 2026-09-07, worth-doing #24 — invitation to bid.
--
-- THE PROBLEM. `addBidPackageBid` has exactly two callers, both forms in
-- app/buyout-package.tsx, so every competing bid in the buyout matrix is typed
-- by the GC from a PDF or an email. Twelve packages × three bids = 36 hand
-- entries before the levelling differentiator has anything to level. And it
-- could not have been otherwise: `bid_package_bids` carries one RLS policy,
--
--     bid_package_bids_owner_all … USING (user_id = auth.uid())
--
-- so a subcontractor — who has no account, no JWT and no row in auth.users —
-- can never write one. Meanwhile app/buyout-package.tsx tells the GC "Send the
-- RFQ to more subs before awarding" on a screen with no send.
--
-- THE SHAPE OF THE FIX. The same one the homeowner portal already uses for
-- change-order e-signature and the sub portal uses for invoice submission: a
-- random token stored on an owner-scoped row, and a SECURITY DEFINER function
-- that trades that token for exactly one narrow write. The sub never gets a
-- session, never gets the anon key's reach, and cannot read or write anything
-- the token does not name. `bid_package_bids` keeps its owner-only policy
-- untouched — the RPC writes as the function owner, and stamps `user_id` from
-- the invite row, never from anything the caller sends.
--
-- Modelled directly on public.sub_portal_submit_invoice (schema.sql:5365): the
-- token compare, the `raise exception '<domain>_denied'` on every failure so a
-- caller cannot distinguish "no such invite" from "wrong token", the
-- left(coalesce(…)) clamps on every text column, and the numeric sanity bound.
--
-- WHAT IS DELIBERATELY NOT HERE
--   * No email send. The GC's app calls the `notify` edge function with the
--     invite URL, the same way every other outbound message leaves this
--     product. A migration that sent mail would be a second, invisible mail
--     path.
--   * No `anon` SELECT on bid_packages. `bid_invite_get` returns the four
--     scope fields a bidder needs and nothing else — not the estimate budget,
--     which is the GC's number and would anchor every bid he receives.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF
-- EXISTS before CREATE POLICY.
-- Reversible: drop the two functions and the table; nothing outside this file
-- references either, and bid_package_bids is unchanged.
--
-- Verify after apply:
--   select tablename, policyname from pg_policies where tablename = 'bid_package_invites';
--   select proname, prosecdef from pg_proc where proname like 'bid_invite%';
--   -- expect prosecdef = true for both
--   -- then, as anon, a bogus token must raise rather than return:
--   select public.bid_invite_get('not-a-real-token');   -- expect: bid_invite_denied

-- ── 1. the invite row ───────────────────────────────────────────────────────
create table if not exists public.bid_package_invites (
  id            uuid primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  package_id    uuid not null references public.bid_packages(id) on delete cascade,
  project_id    uuid not null,
  -- Who it went to. Kept so the buyout screen can show "invited, no response"
  -- without a second table, and so a re-send targets the same address.
  sub_name      text,
  sub_email     text not null,
  subcontractor_id uuid,
  -- The credential. Unique so a collision is a constraint error rather than
  -- two subs sharing a bid slot; long enough that guessing is not a strategy.
  invite_token  text not null unique,
  status        text not null default 'sent',
  expires_at    timestamptz,
  responded_at  timestamptz,
  bid_id        uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists bid_package_invites_user_id_idx
  on public.bid_package_invites using btree (user_id);
create index if not exists bid_package_invites_package_id_idx
  on public.bid_package_invites using btree (user_id, package_id);

alter table public.bid_package_invites enable row level security;

-- The GC owns his invites. `anon` gets NOTHING here — the token path runs
-- through the two SECURITY DEFINER functions below, which is the whole point:
-- a leaked anon key must not become a way to enumerate who was invited to bid
-- on what, which is competitively sensitive on its own.
drop policy if exists bid_package_invites_owner_all on public.bid_package_invites;
create policy bid_package_invites_owner_all on public.bid_package_invites
  as permissive for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── 2. read: what the bidder is allowed to see ──────────────────────────────
-- Returns the scope and nothing that would anchor the bid. `estimate_budget`
-- is the GC's own number; handing it to the people bidding against it would
-- make every bid land just under it.
create or replace function public.bid_invite_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_inv record; v_pkg record; v_proj_name text;
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'bid_invite_denied';
  end if;

  select * into v_inv from public.bid_package_invites
    where invite_token = p_token
      and (expires_at is null or expires_at > now())
    limit 1;
  if v_inv is null then raise exception 'bid_invite_denied'; end if;

  select name, csi_division, phase, scope_description, project_id
    into v_pkg from public.bid_packages where id = v_inv.package_id limit 1;
  if v_pkg is null then raise exception 'bid_invite_denied'; end if;

  -- The project's name only. Not its budget, address, client or margin.
  select name into v_proj_name from public.projects where id = v_pkg.project_id limit 1;

  return jsonb_build_object(
    'ok', true,
    'package_name',      v_pkg.name,
    'csi_division',      v_pkg.csi_division,
    'phase',             v_pkg.phase,
    'scope_description', v_pkg.scope_description,
    'project_name',      coalesce(v_proj_name, ''),
    'sub_name',          coalesce(v_inv.sub_name, ''),
    'status',            v_inv.status,
    'already_responded', v_inv.responded_at is not null
  );
end; $function$;

-- ── 3. write: the one narrow insert the token buys ──────────────────────────
create or replace function public.bid_invite_submit(
  p_token       text,
  p_vendor_name text,
  p_amount      numeric,
  p_includes    text,
  p_excludes    text,
  p_terms       text,
  p_notes       text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_inv record; v_bid_id uuid;
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'bid_invite_denied';
  end if;

  -- Lock the invite row for the length of the transaction. Without this, a
  -- double-submit (a sub tapping "Send" twice on a slow connection) races
  -- through the responded_at check below and files two bids on one invite,
  -- which shows up in the buyout matrix as a phantom second bidder.
  select * into v_inv from public.bid_package_invites
    where invite_token = p_token
      and (expires_at is null or expires_at > now())
    limit 1
    for update;
  if v_inv is null then raise exception 'bid_invite_denied'; end if;
  if v_inv.responded_at is not null then raise exception 'bid_invite_already_submitted'; end if;

  if p_amount is null or p_amount <= 0 or p_amount >= 1e9 then
    raise exception 'bid_invite_denied';
  end if;

  -- `user_id` comes from the INVITE, never from the caller. This is the line
  -- that lets an owner-scoped table accept a write from someone with no
  -- account, without widening the policy for everyone else.
  insert into public.bid_package_bids(
      id, user_id, package_id, subcontractor_id, vendor_name, amount,
      includes, excludes, terms, source, status, submitted_at, notes)
    values (
      gen_random_uuid(), v_inv.user_id, v_inv.package_id, v_inv.subcontractor_id,
      left(coalesce(nullif(trim(p_vendor_name), ''), coalesce(v_inv.sub_name, 'Invited bidder')), 200),
      p_amount,
      left(coalesce(p_includes, ''), 4000),
      left(coalesce(p_excludes, ''), 4000),
      left(coalesce(p_terms, ''), 2000),
      'invited',
      'received',
      now(),
      left(coalesce(p_notes, ''), 2000))
    returning id into v_bid_id;

  update public.bid_package_invites
     set status = 'submitted', responded_at = now(), bid_id = v_bid_id, updated_at = now()
   where id = v_inv.id;

  return jsonb_build_object('ok', true, 'bid_id', v_bid_id);
end; $function$;

-- ── 4. grants ───────────────────────────────────────────────────────────────
-- The bidder holds no session, so these must be reachable by `anon`. Both are
-- SECURITY DEFINER and both begin by trading a ≥16-char token for a single
-- row; neither takes an id from the caller.
revoke all on function public.bid_invite_get(text) from public;
revoke all on function public.bid_invite_submit(text, text, numeric, text, text, text, text) from public;
grant execute on function public.bid_invite_get(text) to anon, authenticated;
grant execute on function public.bid_invite_submit(text, text, numeric, text, text, text, text) to anon, authenticated;
