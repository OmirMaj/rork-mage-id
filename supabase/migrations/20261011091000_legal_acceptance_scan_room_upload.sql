-- 20261011091000_legal_acceptance_scan_room_upload.sql — one more kind of
-- recorded acknowledgement: 'scan_room_upload' (lane LIVINGSYNC).
--
-- WHY. The Living Model asks before a room that came from a phone scan is sent
--   to the account for the first time ("This model includes a room you
--   scanned." with what is sent and what is not). His "Save to My Account" is a
--   yes that should be provable later: who, when, and the exact words. The
--   table for that exists (public.legal_acceptances, 20261010100000, applied in
--   production) and its one writer, public.record_my_legal_acceptance, takes a
--   kind from a closed list of four. This file makes the list five.
--
-- WHAT CHANGES. public.record_my_legal_acceptance is replaced by ITSELF with
--   one line different: the closed list of kinds gains 'scan_room_upload'.
--   Nothing else: the same arguments, the same checks, the same once-per-
--   (person, kind, version, words) rule, the same 400-row limit, the same
--   grants (re-stated below so a replace cannot loosen them). The table, its
--   policy and its keep trigger are not touched. scripts/pgq/
--   legal-acceptance-scan-room-upload.mjs compares the function text here with
--   the one in 20261010100000 and fails on any other difference.
--
-- WHAT A 'scan_room_upload' ROW SAYS. This account tapped "Save to My Account"
--   on that question: version (utils/legalAcceptanceCore SCAN_UPLOAD_VERSION)
--   and a SHA-256 of the title and body in the language he read (English or
--   Spanish; the two texts are archived under docs/legal/versions). The server
--   stamps who and when. ONE ROW PER PERSON PER WORDING: the unique index is
--   (user_id, kind, version, text_sha256), so the row is his FIRST yes to
--   these words. The app asks again for each scanned room added later; those
--   later answers are kept on the phone (the sync notes), not as more rows.
--   The row does not name the job or the room.
--
-- DEPLOY ORDER. After 20261010100000_legal_acceptances.sql (it is applied).
--   Independent of 20261011090000_living_models.sql: either may go first.
--   Before this file is applied the app's record of a yes is refused by the
--   server ("unknown kind") and stays on the phone, to be sent at a later app
--   start; saving the model does not wait for it. Apply through the Supabase
--   MCP apply_migration, never `supabase db push`.
--
-- VERIFY AFTER
--   select position('scan_room_upload' in prosrc) > 0, prosecdef, proconfig
--     from pg_proc where oid = 'public.record_my_legal_acceptance(text,text,text,text,text,text,bigint,text)'::regprocedure;   -- true, true, {search_path=""}
--   select has_function_privilege('anon', 'public.record_my_legal_acceptance(text,text,text,text,text,text,bigint,text)', 'execute'),          -- false
--          has_function_privilege('authenticated', 'public.record_my_legal_acceptance(text,text,text,text,text,text,bigint,text)', 'execute'); -- true
--
-- UNDO. Apply the function from 20261010100000_legal_acceptances.sql again
--   (the list of four). Rows already written with the new kind stay: a
--   recorded acknowledgement is never deleted.
--
-- PROOF. scripts/pgq/legal-acceptance-scan-room-upload.mjs applies
--   20261010100000 and then this file (twice) on PGlite and runs the cases;
--   `--all` plants each mutation and shows which cases go red.
--
-- Additive and idempotent.

do $pre$
begin
  if to_regclass('public.legal_acceptances') is null
     or to_regprocedure('public.record_my_legal_acceptance(text,text,text,text,text,text,bigint,text)') is null then
    raise exception '[scan_room_upload] public.legal_acceptances and its recorder are missing. Apply 20261010100000_legal_acceptances.sql first.';
  end if;
end
$pre$;

create or replace function public.record_my_legal_acceptance(
  p_kind text,
  p_version text,
  p_text_sha256 text,
  p_surface text,
  p_app_version text default null,
  p_platform text default null,
  p_delay_ms bigint default null,
  p_update_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_id bigint;
  v_at timestamptz;
  v_count integer;
  v_app text;
  v_platform text;
  v_delay bigint;
  v_update text;
begin
  if v_uid is null then
    raise exception 'record_my_legal_acceptance: not signed in' using errcode = '28000';
  end if;
  if p_kind is null or p_kind !~ '^[a-z][a-z0-9_]{1,39}$'
     or p_version is null or p_version !~ '^[A-Za-z0-9._-]{1,40}$'
     or p_text_sha256 is null or p_text_sha256 !~ '^[0-9a-f]{64}$'
     or p_surface is null or p_surface !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'record_my_legal_acceptance: kind, version, text hash and surface must be short identifiers' using errcode = '22023';
  end if;
  -- The kinds there are. A closed list, so a caller cannot fill the per-person
  -- limit below with made-up kinds and crowd out a real record.
  if p_kind not in ('terms', 'privacy', 'code_answer_ack', 'scan_ack', 'scan_room_upload') then
    raise exception 'record_my_legal_acceptance: unknown kind' using errcode = '22023';
  end if;
  -- The surfaces a signed-in account can claim. 'portal' and 'signing_link'
  -- belong to people with no account and are never written here.
  if p_surface in ('portal', 'signing_link') then
    raise exception 'record_my_legal_acceptance: that surface is not an account surface' using errcode = '22023';
  end if;

  -- Optional details are kept when they are well formed and dropped when not:
  -- an odd build string must never cost the record.
  if p_app_version is not null and p_app_version ~ '^[A-Za-z0-9._+() -]{1,40}$' then
    v_app := p_app_version;
  end if;
  if p_platform in ('ios', 'android', 'web') then
    v_platform := p_platform;
  end if;
  if p_update_id is not null and p_update_id ~ '^[A-Za-z0-9-]{1,64}$' then
    v_update := p_update_id;
  end if;
  if p_delay_ms is not null and p_delay_ms >= 0 then
    -- Capped at ten years.
    v_delay := least(p_delay_ms, 315360000000);
  end if;

  select a.id, a.accepted_at into v_id, v_at
    from public.legal_acceptances a
   where a.user_id = v_uid and a.kind = p_kind and a.version = p_version and a.text_sha256 = p_text_sha256;
  if found then
    return jsonb_build_object('ok', true, 'recorded', false, 'id', v_id, 'accepted_at', v_at);
  end if;

  select count(*) into v_count from public.legal_acceptances a where a.user_id = v_uid;
  if v_count >= 400 then
    return jsonb_build_object('ok', false, 'reason', 'limit');
  end if;

  insert into public.legal_acceptances
    (user_id, subject_hash, subject_kind, kind, version, text_sha256, surface, app_version, platform, update_id, accepted_at, reported_delay_ms)
  values
    (v_uid,
     pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('mageid:legal_acceptance:v1:' || v_uid::text, 'UTF8')), 'hex'),
     'account', p_kind, p_version, p_text_sha256, p_surface, v_app, v_platform, v_update,
     pg_catalog.clock_timestamp(), v_delay)
  on conflict (user_id, kind, version, text_sha256) where user_id is not null do nothing
  returning id, accepted_at into v_id, v_at;

  if v_id is null then
    -- Two calls at once: the other one wrote it.
    select a.id, a.accepted_at into v_id, v_at
      from public.legal_acceptances a
     where a.user_id = v_uid and a.kind = p_kind and a.version = p_version and a.text_sha256 = p_text_sha256;
    return jsonb_build_object('ok', true, 'recorded', false, 'id', v_id, 'accepted_at', v_at);
  end if;
  return jsonb_build_object('ok', true, 'recorded', true, 'id', v_id, 'accepted_at', v_at);
end
$function$;

revoke all on function public.record_my_legal_acceptance(text, text, text, text, text, text, bigint, text) from public, anon;
grant execute on function public.record_my_legal_acceptance(text, text, text, text, text, text, bigint, text) to authenticated;

do $$
declare
  v_src text;
  v_cfg text[];
  v_def boolean;
begin
  select p.prosrc, p.prosecdef, p.proconfig into v_src, v_def, v_cfg from pg_proc p
   where p.oid = 'public.record_my_legal_acceptance(text,text,text,text,text,text,bigint,text)'::regprocedure;
  if position('scan_room_upload' in v_src) = 0 then
    raise exception '[scan_room_upload] verify: the recorder does not take the new kind';
  end if;
  if position('p_kind not in (' in v_src) = 0 then
    raise exception '[scan_room_upload] verify: the recorder has no closed list of kinds';
  end if;
  if v_def is not true or v_cfg is null or not ('search_path=""' = any (v_cfg)) then
    raise exception '[scan_room_upload] verify: the recorder must be SECURITY DEFINER with an empty search_path';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_function_privilege('anon', 'public.record_my_legal_acceptance(text,text,text,text,text,text,bigint,text)', 'execute') then
    raise exception '[scan_room_upload] verify: anon can call the recorder';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and not has_function_privilege('authenticated', 'public.record_my_legal_acceptance(text,text,text,text,text,text,bigint,text)', 'execute') then
    raise exception '[scan_room_upload] verify: authenticated cannot call the recorder';
  end if;
end $$;

notify pgrst, 'reload schema';
