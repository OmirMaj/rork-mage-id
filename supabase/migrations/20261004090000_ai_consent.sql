-- ============================================================================
-- profiles.ai_consent (+ _at, _version, _recorded_at) and set_my_ai_consent():
-- the ACCOUNT's answer to "Use AI features?" (App Store guideline 5.1.2(i)).
--
-- WHY. The answer used to live only on the phone (utils/aiConsentCore.ts). Two
-- server paths send a contractor's job records to Google Gemini with no tap in
-- the app: the Friday client recap (supabase/functions/homeowner-weekly-digest)
-- and Ask Your Home (supabase/functions/portal-ask-home). They now read
-- ai_consent through supabase/functions/_shared/aiConsent.ts and use AI only
-- when it is exactly 'granted'.
--
-- MEANING.
--   ai_consent             'granted' | 'declined' | NULL. NULL = the server was
--                          never told = NOT allowed. No backfill: the server
--                          cannot know what a phone was told.
--   ai_consent_at          when the person answered, in SERVER time: the moment
--                          the answer arrived minus how long ago the device
--                          says it was given. Used only to keep answers in order.
--   ai_consent_version     which version of the question was answered (2 = the
--                          first one that names the weekly recap and Ask Your
--                          Home). NULL when the writer did not say.
--   ai_consent_recorded_at when the server stored the current answer.
--
-- WHO CAN WRITE. Only public.set_my_ai_consent() (the signed-in person, his own
-- row) and the service role / a direct database session. A direct UPDATE or
-- INSERT of these four columns by role authenticated or anon is put back by the
-- trigger below, whatever RLS policies exist on profiles. So the order rules in
-- the function cannot be skipped, and nobody can set another person's answer.
--
-- ORDER RULES (set_my_ai_consent).
--   'declined' always lands.
--   'granted' lands only when the question version is 2 or later, the device
--   said how long ago it was given, and that moment is after the stored
--   'declined' (if there is one). A yes that sat on an offline phone while a
--   newer no arrived from another device is refused.
--
-- DEPLOY ORDER. Apply BEFORE the edge functions and BEFORE the app update. Safe
-- in every other order too: old app builds never name these columns; the new app
-- reads the column with a missing-column-tolerant select and does not call the
-- function while it is missing; the new edge functions treat a failed read as
-- "no AI".
--
-- ACCOUNT DELETION. profiles.id references auth.users(id) ON DELETE CASCADE, and
-- delete-account ends by deleting the auth.users row. delete-account also sets
-- 'declined' before its first delete, so a deletion that stops partway leaves no
-- yes behind.
--
-- Idempotent: a second run is a no-op.
--
-- Reverse path:
--   drop trigger if exists profiles_keep_ai_consent on public.profiles;
--   drop trigger if exists profiles_keep_ai_consent_on_insert on public.profiles;
--   drop function if exists public.profiles_keep_ai_consent();
--   drop function if exists public.set_my_ai_consent(text, bigint, integer);
--   (the columns can stay: nothing else reads them)
-- ============================================================================

alter table public.profiles add column if not exists ai_consent text;
alter table public.profiles add column if not exists ai_consent_at timestamptz;
alter table public.profiles add column if not exists ai_consent_version smallint;
alter table public.profiles add column if not exists ai_consent_recorded_at timestamptz;

-- Added separately (not inline on ADD COLUMN) so a re-run after the column
-- exists still gets the constraint, and a re-run with it present is a no-op.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_ai_consent_check' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_ai_consent_check
      check (ai_consent is null or ai_consent in ('granted', 'declined'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_ai_consent_time_check' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_ai_consent_time_check
      check (ai_consent is null or ai_consent_at is not null);
  end if;
end $$;

comment on column public.profiles.ai_consent is
  'The account''s answer to "Use AI features?": ''granted'' or ''declined''. NULL = never told = NOT allowed. Written only by public.set_my_ai_consent() and the service role; read by supabase/functions/_shared/aiConsent.ts, which allows AI only for the exact value ''granted''.';
comment on column public.profiles.ai_consent_at is
  'When the person gave the current answer, in server time (arrival minus the age the device reported). Orders answers; never null while ai_consent is set.';
comment on column public.profiles.ai_consent_version is
  'Version of the question the current answer was given to (2 = names the weekly client recap and Ask Your Home).';
comment on column public.profiles.ai_consent_recorded_at is
  'When the server stored the current answer.';

-- ── The guard: a client never writes these columns directly ─────────────────
-- Pins, never raises: a whole-row save that happens to name one of them keeps
-- its other columns. SECURITY INVOKER on purpose: current_user is the role the
-- statement runs as. Inside set_my_ai_consent() (SECURITY DEFINER) that is the
-- function's owner, so the function's own UPDATE passes.
create or replace function public.profiles_keep_ai_consent()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user in ('authenticated', 'anon') then
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
  end if;
  return new;
end
$function$;

revoke execute on function public.profiles_keep_ai_consent() from public, anon, authenticated;

drop trigger if exists profiles_keep_ai_consent on public.profiles;
create trigger profiles_keep_ai_consent
  before update of ai_consent, ai_consent_at, ai_consent_version, ai_consent_recorded_at
  on public.profiles
  for each row
  execute function public.profiles_keep_ai_consent();

drop trigger if exists profiles_keep_ai_consent_on_insert on public.profiles;
create trigger profiles_keep_ai_consent_on_insert
  before insert on public.profiles
  for each row
  when (new.ai_consent is not null or new.ai_consent_at is not null
        or new.ai_consent_version is not null or new.ai_consent_recorded_at is not null)
  execute function public.profiles_keep_ai_consent();

-- ── The one write path for a signed-in person ───────────────────────────────
-- p_age_ms: how long ago the person answered, measured on the device at the
-- moment it sends (0 for an answer given just now). NULL or negative = unknown.
-- An age, not a clock time, so a phone with a wrong clock cannot reorder answers.
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
begin
  if v_uid is null then
    raise exception 'set_my_ai_consent: not signed in' using errcode = '28000';
  end if;
  if p_answer is null or p_answer not in ('granted', 'declined') then
    raise exception 'set_my_ai_consent: the answer must be granted or declined' using errcode = '22023';
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
           ai_consent_version = p_version,
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
         ai_consent_version = p_version,
         ai_consent_recorded_at = v_now
   where id = v_uid;
  return jsonb_build_object('ok', true, 'applied', true, 'ai_consent', 'granted', 'ai_consent_at', v_new_at);
end
$function$;

revoke all on function public.set_my_ai_consent(text, bigint, integer) from public, anon;
grant execute on function public.set_my_ai_consent(text, bigint, integer) to authenticated;

-- Self-check: the shape the server gate and the app depend on.
do $$
declare
  n int;
begin
  select count(*) into n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'
     and is_nullable = 'YES' and column_default is null
     and ((column_name = 'ai_consent' and data_type = 'text')
       or (column_name = 'ai_consent_at' and data_type = 'timestamp with time zone')
       or (column_name = 'ai_consent_version' and data_type = 'smallint')
       or (column_name = 'ai_consent_recorded_at' and data_type = 'timestamp with time zone'));
  if n <> 4 then
    raise exception '[ai-consent] verify: the four ai_consent columns must exist on public.profiles, nullable, with no default; % of 4 match', n;
  end if;
  select count(*) into n from pg_constraint
   where conrelid = 'public.profiles'::regclass
     and conname in ('profiles_ai_consent_check', 'profiles_ai_consent_time_check');
  if n <> 2 then
    raise exception '[ai-consent] verify: both ai_consent constraints must exist; % of 2 found', n;
  end if;
  select count(*) into n from pg_trigger
   where tgrelid = 'public.profiles'::regclass and not tgisinternal
     and tgname in ('profiles_keep_ai_consent', 'profiles_keep_ai_consent_on_insert');
  if n <> 2 then
    raise exception '[ai-consent] verify: both profiles_keep_ai_consent triggers must exist; % of 2 found', n;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'set_my_ai_consent' and p.prosecdef
  ) then
    raise exception '[ai-consent] verify: public.set_my_ai_consent must exist and be SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', 'public.set_my_ai_consent(text, bigint, integer)', 'execute') then
    raise exception '[ai-consent] verify: anon must not be able to call set_my_ai_consent';
  end if;
  if not has_function_privilege('authenticated', 'public.set_my_ai_consent(text, bigint, integer)', 'execute') then
    raise exception '[ai-consent] verify: authenticated must be able to call set_my_ai_consent';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass) then
    raise exception '[ai-consent] verify: row level security is not enabled on public.profiles';
  end if;
end $$;

-- Reload PostgREST's schema cache so the columns and the function are usable now.
notify pgrst, 'reload schema';
