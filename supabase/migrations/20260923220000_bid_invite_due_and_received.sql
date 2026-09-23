-- 20260923220000_bid_invite_due_and_received.sql
--
-- Wave 5, lane buyout. Three changes to invitation to bid
-- (20260908120000_bid_package_invites.sql), none of which edits that file.
--
-- APPLY ORDER: AFTER the notify edge function that knows 'bid_invite_received'
-- is deployed (w5-join-server) — the same rule as 20260923130000. Applied
-- first, every bid a sub files in the gap gets an unknown-event answer and the
-- GC is never told (the row write itself is safe: the trigger's call sits in
-- an exception block). The ship runs migrations before functions, so deploy
-- notify first, or apply this file and 130000 after the function step.
--
-- ── 1. #99 — the sub who gets the link by TEXT never sees the bid due date ──
-- The app recommends texting the link ("subs answer a text far more often than
-- an email") and the page it opens showed scope, package and CSI, but no date:
-- bid_invite_get did not return bid_packages.due_date. Only the email carried
-- "Bids due". It now returns `bids_due_on`, a plain calendar day.
--
-- WHY A DAY AND NOT THE INSTANT. due_date is timestamptz. The app writes the
-- picked day at local noon (app/buyout.tsx, DatePickerModal) and reads it back
-- by its first ten characters (utils/calendarDate.parseCalendarDay) — i.e. by
-- the UTC calendar day. `to_char(due_date at time zone 'UTC', 'YYYY-MM-DD')`
-- is that same day, so the page names the day the GC sees on his screen
-- rather than that instant re-projected into the sub's own time zone (which
-- moves it a day for anyone far enough west). NULL when no date is set — the
-- page then shows nothing, never the link's expiry.
--
-- Kept from the live definition (pg_get_functiondef, 2026-09-23): SECURITY
-- DEFINER, `set search_path to 'public'`, the ≥16-char token floor, every
-- existing key, and EXECUTE for anon + authenticated only. Still no
-- estimate_budget: the GC's own number in front of the people bidding against
-- it anchors every bid just under it.
--
-- ── 2. #15 — nothing told the GC a sub had filed his number ──────────────────
-- bid_invite_submit stamps responded_at and returns; no trigger existed on
-- bid_package_invites (production pg_trigger, 2026-09-23), so the GC found
-- bids only by reopening each package. trg_notify_bid_invite_received fires
-- once per invite — AFTER UPDATE OF responded_at, only on NULL → NOT NULL — and
-- hands `notify` ids only. notify (w5-join-server) loads the package name, the
-- sub and the amount server-side with the service role and escapes every
-- sub-supplied field; nothing the anonymous bidder typed rides in the payload.
--
-- CONTRACT 8: notify events from SQL come ONLY from AFTER trigger functions
-- calling public.fire_notify, which refuses (42501) when pg_trigger_depth() = 0.
-- This is such a trigger. The call is wrapped in its own exception block so a
-- notify failure can never roll back the sub's submit — his number is the
-- thing that must land.
--
-- DEPLOY ORDER: apply AFTER the notify function ships the
-- 'bid_invite_received' case, or the first filed bid posts an unknown event.
--
-- ── 3. #92 (optional half) — a deleted bid left its invite pointing at nothing
-- Deleting a sub-filed bid kept bid_package_invites.bid_id aimed at a row that
-- no longer exists, so the invite list said "their number is in the matrix
-- below" over an empty matrix. An AFTER DELETE trigger on bid_package_bids
-- clears the link and marks the invite 'bid_deleted'. responded_at is NOT
-- reset: the link stays closed (the sub's page keeps saying his bid is in), and
-- re-inviting already mints a fresh link through splitAlreadyInvited.
--
-- Idempotent: CREATE OR REPLACE / DROP TRIGGER IF EXISTS. Reversible: drop the
-- two triggers and their functions, and re-run 20260908120000's bid_invite_get.
--
-- Verify after apply:
--   select pg_get_functiondef('public.bid_invite_get(text)'::regprocedure);  -- has bids_due_on
--   select tgname, pg_get_triggerdef(oid) from pg_trigger
--    where tgname in ('trg_notify_bid_invite_received', 'trg_bid_package_bids_clear_invite');

-- ── 1. bid_invite_get + bids_due_on ─────────────────────────────────────────
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

  select name, csi_division, phase, scope_description, project_id, due_date
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
    'already_responded', v_inv.responded_at is not null,
    'bids_due_on',       to_char(v_pkg.due_date at time zone 'UTC', 'YYYY-MM-DD')
  );
end; $function$;

revoke all on function public.bid_invite_get(text) from public;
grant execute on function public.bid_invite_get(text) to anon, authenticated;

-- ── 2. tell the GC a sub filed his number ───────────────────────────────────
create or replace function public.notify_bid_invite_received()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    perform public.fire_notify(
      'bid_invite_received',
      'bid_package_invites',
      new.id::text,
      jsonb_build_object(
        'user_id',    new.user_id,
        'package_id', new.package_id,
        'invite_id',  new.id,
        'bid_id',     new.bid_id
      )
    );
  exception when others then
    -- Never let a notification failure roll back the sub's submit.
    raise notice 'notify_bid_invite_received failed: %', sqlerrm;
  end;
  return null;
end; $function$;

revoke all on function public.notify_bid_invite_received() from public, anon, authenticated;

drop trigger if exists trg_notify_bid_invite_received on public.bid_package_invites;
create trigger trg_notify_bid_invite_received
  after update of responded_at on public.bid_package_invites
  for each row
  when (old.responded_at is null and new.responded_at is not null)
  execute function public.notify_bid_invite_received();

-- ── 3. a deleted bid releases its invite's link ─────────────────────────────
create or replace function public.bid_package_bids_clear_invite()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    update public.bid_package_invites
       set bid_id = null, status = 'bid_deleted', updated_at = now()
     where bid_id = old.id;
  exception when others then
    -- The GC's delete is the action; a stale pointer is only a display issue.
    raise notice 'bid_package_bids_clear_invite failed: %', sqlerrm;
  end;
  return null;
end; $function$;

revoke all on function public.bid_package_bids_clear_invite() from public, anon, authenticated;

drop trigger if exists trg_bid_package_bids_clear_invite on public.bid_package_bids;
create trigger trg_bid_package_bids_clear_invite
  after delete on public.bid_package_bids
  for each row
  execute function public.bid_package_bids_clear_invite();
