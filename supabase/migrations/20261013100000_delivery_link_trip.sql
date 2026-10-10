-- 20261013100000_delivery_link_trip.sql — three taps on the supplier link:
-- Loaded, On The Way, Arrived (lane DELIVERIES-2, the Supplier Link, part 2).
--
-- WHY. The founder asked to see the truck on its way. A real position needs
--   the driver's location (a paid map service, and a person being tracked: a
--   lawyer first). This file adds the honest, free version: whoever holds the
--   supplier link taps where the load is, and the contractor's app shows the
--   truck at that stop, with who tapped it and when. It is the supplier's word.
--   Nothing here knows where a truck is.
--
-- WHAT IS ADDED
--   public.delivery_supplier_links.trip   jsonb object, at most 1,000 bytes, or
--     NULL. {"loaded": "<when>", "on_the_way": "<when>", "arrived": "<when>",
--     "name": "<who tapped last>", "from": "<where it is coming from>"}.
--     "from" is WORDS A PERSON TYPED on the page (a yard, a town), at most 120
--     characters. It is not a reading from any device: nothing here asks for,
--     receives or stores a position. Each step's time is written ONCE, the first
--     time that step (or a later one) is tapped. Written ONLY by
--     delivery_link_step. No column grant is given for it, so a signed-in
--     client cannot write it (the table's update grant is reply_seen_at alone).
--   public.delivery_link_step(p_token uuid, p_step text, p_name text,
--       p_from text default null) returns jsonb
--     SECURITY DEFINER, search_path empty. Returns {"ok": true, "trip": {...}}
--     or {"ok": false, "reason"} with reason one of: not_found, closed, name,
--     step, too_long, back.
--       - p_step is 'loaded', 'on_the_way' or 'arrived'.
--       - FORWARD ONLY. A step earlier than one already tapped is refused
--         ('back'). Tapping the step the load is already at changes nothing and
--         is ok. Tapping a later step also stamps any step skipped over with
--         the same time, so the strip never shows a gap.
--       - p_from, when given, replaces "from" (also on a tap of the step the
--         load is already at, so a typo can be corrected).
--   public.delivery_link_view(uuid) is replaced by the same function with one
--     more key in its answer: "trip".
--
-- WHAT A TAP DOES NOT DO. It writes ONE column of ONE row: the link's `trip`.
--   "Arrived" does NOT mark the delivery received: public.deliveries is not
--   touched, and receiving stays a thing a person on the job does. It moves no
--   task, sends no message, raises no notification and calls nothing. It reads
--   no location and stores none.
--
-- WHO WRITES / WHO READS. Unchanged from 20261013090000: anon holds nothing on
--   the table and can only call the functions with a token; field seats read
--   the row (so they read `trip`); nobody signed in can write `trip`.
--
-- DEPLOY ORDER. After 20261013090000_delivery_supplier_links.sql. Either order
--   of this file and the app or page update is safe: an app that asks for the
--   `trip` column before it exists gets an error on its one read and keeps the
--   whole Supplier Link section closed; a page that calls delivery_link_step
--   before it exists shows "That did not go through".
--   Apply through the Supabase MCP apply_migration, never `supabase db push`.
--
-- VERIFY AFTER
--   select column_name, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'delivery_supplier_links' and column_name = 'trip';  -- trip, YES
--   select has_column_privilege('authenticated', 'public.delivery_supplier_links', 'trip', 'update'),
--          has_function_privilege('anon', 'public.delivery_link_step(uuid, text, text, text)', 'execute');     -- false, true
--
-- UNDO (by hand)
--   drop function if exists public.delivery_link_step(uuid, text, text, text);
--   alter table public.delivery_supplier_links drop column if exists trip;
--   (and re-create delivery_link_view from 20261013090000)

alter table public.delivery_supplier_links add column if not exists trip jsonb;
alter table public.delivery_supplier_links drop constraint if exists dsl_trip_check;
alter table public.delivery_supplier_links add constraint dsl_trip_check
  check (trip is null or (jsonb_typeof(trip) = 'object' and octet_length(trip::text) <= 1000));

create or replace function public.delivery_link_view(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_link public.delivery_supplier_links%rowtype;
  v_status text;
begin
  if p_token is null then
    return jsonb_build_object('found', false);
  end if;
  select * into v_link from public.delivery_supplier_links where token = p_token limit 1;
  if v_link.delivery_id is null then
    return jsonb_build_object('found', false);
  end if;
  select d.status into v_status from public.deliveries d where d.id = v_link.delivery_id;
  return jsonb_build_object(
    'found', true,
    'open', coalesce(v_status, 'cancelled') not in ('delivered', 'cancelled'),
    'shown', v_link.shown,
    'reply', v_link.reply,
    'trip', v_link.trip
  );
end;
$function$;

create or replace function public.delivery_link_step(p_token uuid, p_step text, p_name text, p_from text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_link public.delivery_supplier_links%rowtype;
  v_status text;
  v_name text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), '');
  v_from text := nullif(btrim(regexp_replace(coalesce(p_from, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), '');
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_trip jsonb;
  v_want int;
  v_at int;
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into v_link from public.delivery_supplier_links where token = p_token limit 1 for update;
  if v_link.delivery_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select d.status into v_status from public.deliveries d where d.id = v_link.delivery_id;
  if coalesce(v_status, 'cancelled') in ('delivered', 'cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if v_name is null or char_length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'name');
  end if;
  if char_length(v_name) > 80 or char_length(coalesce(v_from, '')) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'too_long');
  end if;
  v_want := case p_step when 'loaded' then 1 when 'on_the_way' then 2 when 'arrived' then 3 else 0 end;
  if v_want = 0 then
    return jsonb_build_object('ok', false, 'reason', 'step');
  end if;

  v_trip := case when jsonb_typeof(v_link.trip) = 'object' then v_link.trip else '{}'::jsonb end;
  v_at := case when v_trip ? 'arrived' then 3 when v_trip ? 'on_the_way' then 2 when v_trip ? 'loaded' then 1 else 0 end;
  if v_want < v_at then
    return jsonb_build_object('ok', false, 'reason', 'back');
  end if;
  if v_want = v_at and (v_from is null or v_from is not distinct from (v_trip ->> 'from')) then
    return jsonb_build_object('ok', true, 'trip', v_trip);
  end if;

  -- Each step's time is written once. A step skipped over takes the same time, so there is never a gap.
  if v_want >= 1 and not (v_trip ? 'loaded') then v_trip := v_trip || jsonb_build_object('loaded', v_now); end if;
  if v_want >= 2 and not (v_trip ? 'on_the_way') then v_trip := v_trip || jsonb_build_object('on_the_way', v_now); end if;
  if v_want >= 3 and not (v_trip ? 'arrived') then v_trip := v_trip || jsonb_build_object('arrived', v_now); end if;
  v_trip := v_trip || jsonb_build_object('name', v_name);
  if v_from is not null then v_trip := v_trip || jsonb_build_object('from', v_from); end if;

  update public.delivery_supplier_links set trip = v_trip where delivery_id = v_link.delivery_id;
  return jsonb_build_object('ok', true, 'trip', v_trip);
end;
$function$;

revoke all on function public.delivery_link_step(uuid, text, text, text) from public;
grant execute on function public.delivery_link_step(uuid, text, text, text) to anon, authenticated, service_role;
revoke all on function public.delivery_link_view(uuid) from public;
grant execute on function public.delivery_link_view(uuid) to anon, authenticated, service_role;

do $verify$
declare
  v_bad int;
begin
  if has_column_privilege('authenticated', 'public.delivery_supplier_links', 'trip', 'update')
     or has_column_privilege('authenticated', 'public.delivery_supplier_links', 'trip', 'insert')
     or has_table_privilege('anon', 'public.delivery_supplier_links', 'select') then
    raise exception '[delivery_link_trip] verify: a client can write the trip, or anon reads the table';
  end if;
  select count(*) into v_bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('delivery_link_view', 'delivery_link_step')
     and (not p.prosecdef or p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path=')));
  if v_bad > 0 then
    raise exception '[delivery_link_trip] verify: a link function is not SECURITY DEFINER with an empty search_path';
  end if;
end;
$verify$;

notify pgrst, 'reload schema';
