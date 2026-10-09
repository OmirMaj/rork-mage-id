-- 20261010130000_bid_responses_closed_posting.sql — a posting that is not open
-- takes no new bid (lane PROTECT-SERVER; security review finding 1).
--
-- WHY. bid_responses_own is FOR ALL with USING (auth.uid() = user_id) and no
--   WITH CHECK of its own, so any signed-in account can insert a bid on ANY
--   posting id, and bid_responses_guard (20260923100000) never looked at the
--   posting. A bid could be placed on a closed or awarded posting, and a bid
--   could carry any created_at the client typed. Nothing reads a late bid as
--   access any more (20261010120000 admits only the awarded bidder once a
--   posting is closed); this file stops the late bid from counting as a bid.
--
-- WHAT CHANGES. bid_responses_guard, rebuilt from the body in 20260923100000
--   with three additions and nothing removed:
--     1. INSERT by a signed-in client: created_at is the server's clock.
--     2. INSERT by a signed-in client on a posting that is not open (status
--        other than 'open', or an award already recorded): the row is stored
--        with status 'withdrawn'. PINNED, NOT RAISED, the way this guard
--        already treats a bad insert: the contractor app queues the insert
--        offline, and a replay of a bid that already landed runs this trigger
--        again before the duplicate-key answer; a raise there would turn "it
--        is already saved" into a failure notice. 'withdrawn' is terminal: the
--        homeowner cannot restore it, the contractor cannot move it, award_rfp
--        refuses it, and the bid-history facts leave it out.
--     3. UPDATE by the contractor on his own bid: created_at cannot change
--        (the homeowner's branch already freezes every column but the status).
--   The service role, award_rfp and a direct database session pass untouched,
--   as before.
--
-- EVERY WRITER OF bid_responses, read before this was written.
--   app/submit-bid-response.tsx    INSERT through the offline queue, status
--                                  'submitted', an explicit id, no created_at.
--                                  Reached only from app/rfp-detail.tsx, whose
--                                  bid button needs an open posting. Unchanged
--                                  on an open posting. On a posting that closed
--                                  while the insert sat in the queue, the row
--                                  now lands as 'withdrawn' instead of as a
--                                  live bid on a closed posting.
--   app/rfp-responses-review.tsx   UPDATE by the homeowner: status and
--                                  responded_at only. Unchanged.
--   award_rfp (definer)            UPDATE to 'awarded' / 'declined'. Bypasses
--                                  the guard as before.
--   supabase/functions/delete-account, the service role. Bypasses the guard.
--   No other client code inserts, updates or deletes this table.
--
-- DEPLOY ORDER. Any time; no app change depends on it. Apply with the other
--   files of this lane, through the Supabase MCP apply_migration, never
--   `supabase db push`. Depends on: 20260923100000 (the guard and its trigger).
--
-- VERIFY AFTER
--   select pg_get_functiondef('public.bid_responses_guard()'::regprocedure) like '%v_post_status%';   -- true
--   select tgenabled from pg_trigger where tgrelid = 'public.bid_responses'::regclass and tgname = 'bid_responses_guard';   -- O
--   select has_function_privilege('authenticated', 'public.bid_responses_guard()', 'execute');        -- false
--
-- UNDO. Re-run section 1a of 20260923100000_rfp_marketplace_hardening.sql.
--
-- PROOF. scripts/pgq/bid-responses-closed-posting.mjs.
--
-- Idempotent.

create or replace function public.bid_responses_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_frozen text[] := array['status', 'responded_at', 'updated_at'];
  v_post_status text;
  v_post_award uuid;
begin
  -- The service role (edge functions), award_rfp (a definer owned by postgres)
  -- and migrations are the award path; only a signed-in client is policed.
  if v_uid is null
     or coalesce(auth.role(), '') = 'service_role'
     or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A new bid is always a plain submission. Pinned, not raised: the
    -- contractor app queues this insert offline and a raise would turn a
    -- replay into a permanent failure.
    new.status := 'submitted';
    new.awarded_project_id := null;
    new.responded_at := null;
    -- When the bid arrived is the server's to say (a client could otherwise
    -- date a bid before the posting closed).
    new.created_at := pg_catalog.now();
    -- A posting that is not open takes no new bid. Pinned to 'withdrawn', not
    -- raised, for the reason above: a replay of a bid that already landed
    -- reaches this line again after the posting has closed, and must still end
    -- as "already there" (23505), never as a refusal. 'withdrawn' is the one
    -- status nobody can move a bid out of: not the contractor, not the
    -- homeowner, not award_rfp. A posting this caller cannot see is left to
    -- the foreign key.
    select b.status, b.awarded_response_id into v_post_status, v_post_award
      from public.public_bids b
     where b.id = new.bid_id;
    if found and (coalesce(v_post_status, '') <> 'open' or v_post_award is not null) then
      new.status := 'withdrawn';
    end if;
    return new;
  end if;

  if v_uid is distinct from old.user_id then
    -- The RFP poster (RLS lets no one else through): a status decision only.
    if (to_jsonb(new) - v_frozen) is distinct from (to_jsonb(old) - v_frozen) then
      raise exception 'Only the bid''s status can be changed by the homeowner'
        using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      if coalesce(old.status, 'submitted') in ('awarded', 'withdrawn') then
        raise exception 'This bid is % and can''t be changed', old.status
          using errcode = '42501';
      end if;
      if new.status is null or new.status not in ('submitted', 'shortlisted', 'declined') then
        raise exception 'A bid can only be shortlisted, declined or restored here - awarding goes through the award'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  -- The contractor, on his own bid.
  if new.user_id is distinct from old.user_id
     or new.bid_id is distinct from old.bid_id
     or new.awarded_project_id is distinct from old.awarded_project_id then
    raise exception 'A bid''s owner, RFP and award link can''t be changed'
      using errcode = '42501';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'A bid''s date can''t be changed'
      using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not (new.status = 'withdrawn' and coalesce(old.status, 'submitted') in ('submitted', 'shortlisted')) then
    raise exception 'You can only withdraw your own bid - the homeowner decides the rest'
      using errcode = '42501';
  end if;
  if new.bid_amount is distinct from old.bid_amount
     and coalesce(old.status, 'submitted') <> 'submitted' then
    raise exception 'The price can''t change after the homeowner has acted on this bid'
      using errcode = '42501';
  end if;
  return new;
end
$$;

revoke execute on function public.bid_responses_guard() from public, anon, authenticated;

drop trigger if exists bid_responses_guard on public.bid_responses;
create trigger bid_responses_guard
  before insert or update on public.bid_responses
  for each row execute function public.bid_responses_guard();

-- ── self-check ───────────────────────────────────────────────────────────────
do $mig$
begin
  -- The columns the guard reads must exist (a plpgsql body is not checked until it runs).
  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and ((table_name = 'public_bids' and column_name in ('id', 'user_id', 'status', 'awarded_response_id', 'awarded_at'))
           or (table_name = 'bid_responses' and column_name in ('id', 'bid_id', 'user_id', 'status', 'created_at')))) <> 10 then
    raise exception '[bid_responses_closed_posting] verify: public_bids or bid_responses is missing a column this file reads';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.bid_responses'::regclass
                  and tgname = 'bid_responses_guard' and not tgisinternal and tgenabled <> 'D') then
    raise exception '[bid_responses_closed_posting] verify: the guard trigger is missing or disabled';
  end if;
  if pg_get_functiondef('public.bid_responses_guard()'::regprocedure) not like '%v_post_status%' then
    raise exception '[bid_responses_closed_posting] verify: the guard does not read the posting';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and has_function_privilege('authenticated', 'public.bid_responses_guard()', 'execute') then
    raise exception '[bid_responses_closed_posting] verify: a client can call the guard directly';
  end if;
end
$mig$;
