-- 20261013090000_delivery_supplier_links.sql — a link a contractor hands a
-- supplier, with no account, to give a delivery date and a tracking number
-- (lane DELIVERIES-2, the Supplier Link).
--
-- WHY. A delivery's supplier date is typed by the contractor after a phone
--   call. The founder asked for a link the supplier opens to put in the date
--   and the truck's tracking number themselves. This file adds the ONE table
--   that holds such a link and the supplier's answer, and the TWO functions the
--   no-account page (marketing/delivery/index.html) calls. The app side is
--   DELIVERY_SUPPLIER_LINK_ENABLED = false (owner preview).
--
-- WHAT IS ADDED
--   public.delivery_supplier_links, at most one row per delivery:
--     delivery_id   uuid, the key. ON DELETE CASCADE from public.deliveries.
--     project_id    uuid, ON DELETE CASCADE from public.projects.
--     user_id       uuid, the account that made the link. ON DELETE CASCADE
--                   from auth.users.
--     token         uuid, unique, made by the database (gen_random_uuid()).
--                   The link is https://mageid.app/delivery/?t=<token>. Turning
--                   a link off DELETES the row, so the old token stops working
--                   and a new link gets a new token.
--     shown         jsonb object, at most 2,000 bytes as text. EXACTLY what the
--                   page shows the supplier, written by the app when the person
--                   makes the link, after they have seen it: the contractor's
--                   company name, what is coming, the supplier's name, and the
--                   day it is needed on site (if the person chose to show it).
--                   No price, no client name, no address, no other delivery.
--     made_at       timestamptz.
--     reply         jsonb object, at most 2,000 bytes, or NULL. The supplier's
--                   latest answer: {"date","window","tracking","carrier",
--                   "name","note","at"}. Written ONLY by delivery_link_reply.
--     reply_count   integer, 0 to 20. How many answers the link has taken.
--     reply_at      timestamptz of the latest answer.
--     reply_seen_at timestamptz. Set by the contractor's app when a person has
--                   looked at the answer.
--   public.delivery_link_view(p_token uuid) returns jsonb
--     What the page shows. SECURITY DEFINER, search_path empty, STABLE. Returns
--     {"found": false} for an unknown token, else {"found": true, "open",
--     "shown", "reply"}. "open" is false once the delivery has arrived or been
--     cancelled. It returns NOTHING from public.deliveries but that yes or no.
--   public.delivery_link_reply(p_token uuid, p_date date, p_window text,
--       p_tracking text, p_carrier text, p_name text, p_note text) returns jsonb
--     Records the supplier's answer on the link row. SECURITY DEFINER,
--     search_path empty. Returns {"ok": true} or {"ok": false, "reason"} with
--     reason one of: not_found, closed, too_many, name, nothing, date,
--     tracking, too_long.
--
-- WHAT THE ANSWER DOES NOT DO. delivery_link_reply writes ONE row of ONE table:
--   the link row. It does NOT change public.deliveries: not the supplier date,
--   not the status, not the date history, not the promise. It moves no task,
--   sends no message, raises no notification and calls nothing. The
--   contractor's app shows the answer the next time it loads, and a PERSON
--   chooses to use the date (that is then an ordinary save of the delivery,
--   recorded as "the supplier said so" with the note of how).
--
-- WHO WRITES / WHO READS
--   anon: NO privilege on the table. anon can only call the two functions, and
--     a function only ever touches the row whose token it was handed.
--   authenticated, through row level security:
--     read    the row's maker, or anyone who can access the project.
--     insert  the caller as user_id, with field access to the project, for a
--             delivery that is on that same project.
--     update  field access to the project; and by a column grant ONLY `shown`
--             and `reply_seen_at`. The token, the answer and its count cannot
--             be written from a signed-in client at all.
--     delete  field access to the project (turning the link off).
--   The functions are EXECUTE for anon and authenticated, revoked from PUBLIC.
--
-- ACCOUNT DELETION AND EXPORT. Every row goes with its delivery, its project
--   or its maker (three cascades). The answer holds a name and a note the
--   supplier typed; they go with the row.
--
-- DEPLOY ORDER. Apply this BEFORE the page is published and before the app
--   section is opened. With the table missing the app's one read of it fails
--   and the section stays closed; with the page missing a link 404s. Nothing
--   is queued offline for this table: making, turning off and marking seen are
--   online-only actions.
--   Apply through the Supabase MCP apply_migration, never `supabase db push`.
--   Depends on: public.deliveries (20260826200000), public.projects,
--   public.can_access_project(uuid, text) (20260826130000_field_role.sql).
--
-- VERIFY AFTER
--   select count(*) from public.delivery_supplier_links;                 -- 0
--   select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'delivery_supplier_links' order by 1;
--     -- dsl_delete DELETE, dsl_insert INSERT, dsl_select SELECT, dsl_update UPDATE
--   select has_table_privilege('anon', 'public.delivery_supplier_links', 'select');   -- false
--   select has_function_privilege('anon', 'public.delivery_link_view(uuid)', 'execute'),
--          has_function_privilege('anon', 'public.delivery_link_reply(uuid, date, text, text, text, text, text)', 'execute');  -- true, true
--
-- UNDO (by hand)
--   drop function if exists public.delivery_link_reply(uuid, date, text, text, text, text, text);
--   drop function if exists public.delivery_link_view(uuid);
--   drop table if exists public.delivery_supplier_links;

create table if not exists public.delivery_supplier_links (
  delivery_id   uuid primary key references public.deliveries(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  token         uuid not null unique default gen_random_uuid(),
  shown         jsonb not null,
  made_at       timestamptz not null default now(),
  reply         jsonb,
  reply_count   integer not null default 0,
  reply_at      timestamptz,
  reply_seen_at timestamptz
);

alter table public.delivery_supplier_links drop constraint if exists dsl_shown_check;
alter table public.delivery_supplier_links add constraint dsl_shown_check
  check (jsonb_typeof(shown) = 'object' and octet_length(shown::text) <= 2000);
alter table public.delivery_supplier_links drop constraint if exists dsl_reply_check;
alter table public.delivery_supplier_links add constraint dsl_reply_check
  check (reply is null or (jsonb_typeof(reply) = 'object' and octet_length(reply::text) <= 2000));
alter table public.delivery_supplier_links drop constraint if exists dsl_reply_count_check;
alter table public.delivery_supplier_links add constraint dsl_reply_count_check
  check (reply_count between 0 and 20);

create index if not exists delivery_supplier_links_project_idx
  on public.delivery_supplier_links (project_id);

alter table public.delivery_supplier_links enable row level security;

drop policy if exists dsl_select on public.delivery_supplier_links;
create policy dsl_select on public.delivery_supplier_links
  for select to authenticated
  using (auth.uid() = user_id or public.can_access_project(project_id));

drop policy if exists dsl_insert on public.delivery_supplier_links;
create policy dsl_insert on public.delivery_supplier_links
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and public.can_access_project(project_id, 'field')
    and exists (select 1 from public.deliveries d where d.id = delivery_id and d.project_id = delivery_supplier_links.project_id)
  );

drop policy if exists dsl_update on public.delivery_supplier_links;
create policy dsl_update on public.delivery_supplier_links
  for update to authenticated
  using      (public.can_access_project(project_id, 'field'))
  with check (public.can_access_project(project_id, 'field'));

drop policy if exists dsl_delete on public.delivery_supplier_links;
create policy dsl_delete on public.delivery_supplier_links
  for delete to authenticated
  using (public.can_access_project(project_id, 'field'));

-- Production grants every new public table to the client roles by default.
-- Take all of it back, then give exactly what the header says.
revoke all on public.delivery_supplier_links from anon, authenticated, public;
grant select, delete on public.delivery_supplier_links to authenticated;
grant insert (delivery_id, project_id, user_id, shown) on public.delivery_supplier_links to authenticated;
grant update (shown, reply_seen_at) on public.delivery_supplier_links to authenticated;
grant all on public.delivery_supplier_links to service_role;

comment on table public.delivery_supplier_links is
  'One no-account link per delivery for the supplier to give a date and a tracking number. The answer sits here; it never changes public.deliveries. Lane DELIVERIES-2.';

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
    'reply', v_link.reply
  );
end;
$function$;

create or replace function public.delivery_link_reply(
  p_token uuid, p_date date, p_window text, p_tracking text, p_carrier text, p_name text, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_link public.delivery_supplier_links%rowtype;
  v_status text;
  -- Line breaks and other control characters become one space; runs of spaces close up.
  v_name text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), '');
  v_window text := nullif(btrim(regexp_replace(coalesce(p_window, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), '');
  v_tracking text := nullif(btrim(regexp_replace(coalesce(p_tracking, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), '');
  v_carrier text := nullif(btrim(regexp_replace(coalesce(p_carrier, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), '');
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), '');
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
  if v_link.reply_count >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  if v_name is null or char_length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'name');
  end if;
  if p_date is null and v_tracking is null then
    return jsonb_build_object('ok', false, 'reason', 'nothing');
  end if;
  if p_date is not null and (p_date < current_date - 1 or p_date > current_date + 730) then
    return jsonb_build_object('ok', false, 'reason', 'date');
  end if;
  if v_tracking is not null and v_tracking !~ '^[A-Za-z0-9][A-Za-z0-9 -]{3,59}$' then
    return jsonb_build_object('ok', false, 'reason', 'tracking');
  end if;
  if char_length(v_name) > 80 or char_length(coalesce(v_window, '')) > 40
     or char_length(coalesce(v_carrier, '')) > 40 or char_length(coalesce(v_note, '')) > 300 then
    return jsonb_build_object('ok', false, 'reason', 'too_long');
  end if;

  update public.delivery_supplier_links
     set reply = jsonb_strip_nulls(jsonb_build_object(
           'date', to_char(p_date, 'YYYY-MM-DD'),
           'window', v_window,
           'tracking', v_tracking,
           'carrier', v_carrier,
           'name', v_name,
           'note', v_note,
           'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
         reply_count = reply_count + 1,
         reply_at = now(),
         reply_seen_at = null
   where delivery_id = v_link.delivery_id;
  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.delivery_link_view(uuid) from public;
revoke all on function public.delivery_link_reply(uuid, date, text, text, text, text, text) from public;
grant execute on function public.delivery_link_view(uuid) to anon, authenticated, service_role;
grant execute on function public.delivery_link_reply(uuid, date, text, text, text, text, text) to anon, authenticated, service_role;

-- Self-check: refuse to finish if the table is open to anon, the policies are
-- not the four above, or a function is not SECURITY DEFINER with an empty path.
do $verify$
declare
  v_policies text;
  v_bad int;
begin
  if has_table_privilege('anon', 'public.delivery_supplier_links', 'select')
     or has_table_privilege('anon', 'public.delivery_supplier_links', 'insert')
     or has_table_privilege('anon', 'public.delivery_supplier_links', 'update')
     or has_table_privilege('anon', 'public.delivery_supplier_links', 'delete') then
    raise exception '[delivery_supplier_links] verify: anon holds a privilege on the table';
  end if;
  if has_column_privilege('authenticated', 'public.delivery_supplier_links', 'reply', 'update')
     or has_column_privilege('authenticated', 'public.delivery_supplier_links', 'token', 'update')
     or has_column_privilege('authenticated', 'public.delivery_supplier_links', 'reply_count', 'update')
     or has_column_privilege('authenticated', 'public.delivery_supplier_links', 'reply', 'insert')
     or has_column_privilege('authenticated', 'public.delivery_supplier_links', 'token', 'insert') then
    raise exception '[delivery_supplier_links] verify: a signed-in client can write the token or the answer';
  end if;
  select string_agg(policyname || ':' || cmd, ',' order by policyname) into v_policies
    from pg_policies where schemaname = 'public' and tablename = 'delivery_supplier_links';
  if v_policies is distinct from 'dsl_delete:DELETE,dsl_insert:INSERT,dsl_select:SELECT,dsl_update:UPDATE' then
    raise exception '[delivery_supplier_links] verify: policies are %', v_policies;
  end if;
  select count(*) into v_bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('delivery_link_view', 'delivery_link_reply')
     and (not p.prosecdef or p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path=')));
  if v_bad > 0 then
    raise exception '[delivery_supplier_links] verify: a link function is not SECURITY DEFINER with an empty search_path';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.delivery_supplier_links'::regclass) then
    raise exception '[delivery_supplier_links] verify: row level security is off';
  end if;
end;
$verify$;

notify pgrst, 'reload schema';
