-- ============================================================================
-- AI consent hardening: the guard on profiles.ai_consent becomes an ALLOW-list,
-- and a question version outside smallint can no longer make an answer raise.
-- Follows 20261004090000_ai_consent.sql (the four columns, the two triggers and
-- public.set_my_ai_consent). Apply that one first; this file refuses to run
-- without it.
--
-- WHAT CHANGES.
--   1. public.profiles_keep_ai_consent() (the trigger function behind both
--      guard triggers; the triggers themselves are not touched). It used to pin
--      the four columns for two named roles, 'authenticated' and 'anon'. A role
--      added later (a reporting role, an integration role) that was given
--      UPDATE on public.profiles would have written the answer directly, past
--      every order rule. It now pins the four columns for EVERY role except the
--      ones that must write them:
--        - the owner of public.set_my_ai_consent(text, bigint, integer). That
--          function is SECURITY DEFINER, so inside it current_user is its owner
--          and its own UPDATE has to pass. The owner is looked up, not assumed.
--        - service_role: supabase/functions/delete-account switches AI off with
--          a direct UPDATE before its first delete, and support uses it.
--        - postgres and supabase_admin: a direct database session (the SQL
--          editor, a migration, a restore).
--   2. public.set_my_ai_consent(text, bigint, integer). ai_consent_version is a
--      smallint and p_version is an integer, so a version above 32767 made the
--      UPDATE raise "smallint out of range", and a 'declined' was lost: the one
--      answer that must always land. The version is now stored only when it is
--      between 0 and 32767, otherwise NULL, on both branches. Nothing else in
--      the function changes: a no always lands, the later of two no's is kept,
--      a yes needs question version 2 or later, a time, and to be newer than
--      the stored no.
--
-- WHO CAN WRITE THE FOUR COLUMNS AFTER THIS.
--   The signed-in person, through set_my_ai_consent(), on his own row.
--   service_role, postgres, supabase_admin, and the function's owner, directly.
--   Nobody else, whatever grants or RLS policies exist on public.profiles: the
--   write succeeds, the other columns are saved, and these four keep their
--   stored values (or are emptied on an INSERT).
--
-- DEPLOY ORDER. After 20261004090000. Before or after the edge functions and
-- before or after any app version: no column, signature, grant or return shape
-- changes, so every caller that worked before works the same.
--
-- Idempotent: a second run is a no-op.
--
-- Reverse path: run the two "create or replace function" statements of
-- 20261004090000_ai_consent.sql again (they restore the two-role guard and the
-- unclamped version).
-- ============================================================================

-- Refuse to run on a database that does not have the first migration.
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name in ('ai_consent', 'ai_consent_at', 'ai_consent_version', 'ai_consent_recorded_at')) <> 4
     or to_regprocedure('public.set_my_ai_consent(text,bigint,integer)') is null
     or to_regprocedure('public.profiles_keep_ai_consent()') is null
  then
    raise exception '[ai-consent-hardening] apply 20261004090000_ai_consent.sql first: the ai_consent columns, public.set_my_ai_consent or public.profiles_keep_ai_consent is missing';
  end if;
end $$;

-- ── 1. The guard: an allow-list ─────────────────────────────────────────────
-- Pins, never raises: a whole-row save that happens to name one of the four
-- columns keeps its other columns. SECURITY INVOKER on purpose: current_user is
-- the role the statement runs as. The owner lookup cannot raise either (a
-- missing function is NULL, and anything else is caught): when it cannot tell,
-- the columns are pinned.
create or replace function public.profiles_keep_ai_consent()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_owner name;
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  begin
    select r.rolname into v_owner
      from pg_catalog.pg_proc p
      join pg_catalog.pg_roles r on r.oid = p.proowner
     where p.oid = pg_catalog.to_regprocedure('public.set_my_ai_consent(text,bigint,integer)');
  exception when others then
    v_owner := null;
  end;
  if v_owner is not null and current_user = v_owner then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.ai_consent := null;
    new.ai_consent_at := null;
    new.ai_consent_version := null;
    new.ai_consent_recorded_at := null;
  else
    new.ai_consent := old.ai_consent;
    new.ai_consent_at := old.ai_consent_at;
    new.ai_consent_version := old.ai_consent_version;
    new.ai_consent_recorded_at := old.ai_consent_recorded_at;
  end if;
  return new;
end
$function$;

revoke execute on function public.profiles_keep_ai_consent() from public, anon, authenticated;

-- ── 2. The one write path for a signed-in person ────────────────────────────
-- The same function as 20261004090000, with one change: the version that is
-- stored (v_version) is p_version only when it fits the smallint column.
create or replace function public.set_my_ai_consent(
  p_answer text,
  p_age_ms bigint default null,
  p_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz;
  v_at timestamptz;
  v_new_at timestamptz;
  v_old text;
  v_old_at timestamptz;
  v_version smallint;
begin
  if v_uid is null then
    raise exception 'set_my_ai_consent: not signed in' using errcode = '28000';
  end if;
  if p_answer is null or p_answer not in ('granted', 'declined') then
    raise exception 'set_my_ai_consent: the answer must be granted or declined' using errcode = '22023';
  end if;

  -- The version that is stored. Outside 0..32767 (the column is a smallint) it
  -- is stored as NULL, never raised on: a no always lands.
  if p_version is not null and p_version between 0 and 32767 then
    v_version := p_version;
  end if;

  select p.ai_consent, p.ai_consent_at into v_old, v_old_at
    from public.profiles p
   where p.id = v_uid
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_profile');
  end if;

  -- Taken after the row lock, so two calls for one account are stamped in the
  -- order they are applied.
  v_now := clock_timestamp();
  if p_age_ms is not null and p_age_ms >= 0 then
    -- Capped at ten years so a nonsense age cannot overflow the timestamp.
    v_at := v_now - (least(p_age_ms, 315360000000)::double precision * interval '1 millisecond');
  end if;

  if p_answer = 'declined' then
    -- A no always lands. Keep the LATER of two no's: a yes must beat the newest.
    v_new_at := coalesce(v_at, v_now);
    if v_old = 'declined' and v_old_at is not null and v_old_at > v_new_at then
      v_new_at := v_old_at;
    end if;
    update public.profiles
       set ai_consent = 'declined',
           ai_consent_at = v_new_at,
           ai_consent_version = v_version,
           ai_consent_recorded_at = v_now
     where id = v_uid;
    return jsonb_build_object('ok', true, 'applied', true, 'ai_consent', 'declined', 'ai_consent_at', v_new_at);
  end if;

  -- 'granted'
  if p_version is null or p_version < 2 then
    return jsonb_build_object('ok', true, 'applied', false, 'reason', 'old_question',
                              'ai_consent', v_old, 'ai_consent_at', v_old_at);
  end if;
  if v_at is null then
    return jsonb_build_object('ok', true, 'applied', false, 'reason', 'no_time',
                              'ai_consent', v_old, 'ai_consent_at', v_old_at);
  end if;
  if v_old = 'declined' and (v_old_at is null or v_at <= v_old_at) then
    return jsonb_build_object('ok', true, 'applied', false, 'reason', 'stale',
                              'ai_consent', v_old, 'ai_consent_at', v_old_at);
  end if;
  v_new_at := v_at;
  if v_old = 'granted' and v_old_at is not null and v_old_at > v_at then
    v_new_at := v_old_at;
  end if;
  update public.profiles
     set ai_consent = 'granted',
         ai_consent_at = v_new_at,
         ai_consent_version = v_version,
         ai_consent_recorded_at = v_now
   where id = v_uid;
  return jsonb_build_object('ok', true, 'applied', true, 'ai_consent', 'granted', 'ai_consent_at', v_new_at);
end
$function$;

revoke all on function public.set_my_ai_consent(text, bigint, integer) from public, anon;
grant execute on function public.set_my_ai_consent(text, bigint, integer) to authenticated;

-- Self-check: the shape the two changes depend on.
do $$
declare
  n int;
  v_src text;
  v_owner name;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'profiles_keep_ai_consent' and not p.prosecdef;
  if v_src is null then
    raise exception '[ai-consent-hardening] verify: public.profiles_keep_ai_consent must exist and be SECURITY INVOKER';
  end if;
  if position('current_user in (''service_role'', ''postgres'', ''supabase_admin'')' in v_src) = 0
     or position('current_user = v_owner' in v_src) = 0
     or position('current_user in (''authenticated'', ''anon'')' in v_src) > 0 then
    raise exception '[ai-consent-hardening] verify: the guard must be the allow-list (service_role, postgres, supabase_admin, the function owner), not the two-role list';
  end if;
  select count(*) into n from pg_trigger
   where tgrelid = 'public.profiles'::regclass and not tgisinternal and tgenabled <> 'D'
     and tgfoid = 'public.profiles_keep_ai_consent()'::regprocedure
     and tgname in ('profiles_keep_ai_consent', 'profiles_keep_ai_consent_on_insert');
  if n <> 2 then
    raise exception '[ai-consent-hardening] verify: both profiles_keep_ai_consent triggers must exist, be enabled and call the guard; % of 2 found', n;
  end if;
  select r.rolname into v_owner
    from pg_proc p join pg_roles r on r.oid = p.proowner
   where p.oid = 'public.set_my_ai_consent(text,bigint,integer)'::regprocedure and p.prosecdef;
  if v_owner is null then
    raise exception '[ai-consent-hardening] verify: public.set_my_ai_consent(text, bigint, integer) must exist and be SECURITY DEFINER';
  end if;
  if v_owner in ('authenticated', 'anon') then
    raise exception '[ai-consent-hardening] verify: public.set_my_ai_consent is owned by %, a client role: the guard would let that role write the columns directly', v_owner;
  end if;
  if has_function_privilege('anon', 'public.set_my_ai_consent(text, bigint, integer)', 'execute') then
    raise exception '[ai-consent-hardening] verify: anon must not be able to call set_my_ai_consent';
  end if;
  if not has_function_privilege('authenticated', 'public.set_my_ai_consent(text, bigint, integer)', 'execute') then
    raise exception '[ai-consent-hardening] verify: authenticated must be able to call set_my_ai_consent';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'ai_consent_version' and data_type = 'smallint'
  ) then
    raise exception '[ai-consent-hardening] verify: public.profiles.ai_consent_version must still be a smallint (the stored version is clamped to it)';
  end if;
end $$;

-- Reload PostgREST's schema cache.
notify pgrst, 'reload schema';
