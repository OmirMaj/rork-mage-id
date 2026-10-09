-- 20261010100000_legal_acceptances.sql — a saved record of every acceptance
-- and acknowledgement (lane PROTECT-SERVER; build list items 1, 2, 3 and 15).
--
-- WHY. Nothing recorded that anyone agreed to the Terms of Service or the
--   Privacy Policy: one sentence under one button, and no row anywhere. The
--   code-answer notice was saved only on the phone. Every limit in the Terms
--   rests on being able to say who agreed, to which words, and when.
--
-- WHAT A ROW MEANS. One person accepted or acknowledged one document, at one
--   version, once. For 'terms' and 'privacy' precisely: this account signed in
--   or created itself ON A SCREEN THAT DISPLAYED the sentence naming both
--   documents, at these versions, or tapped "I Agree" on the re-acceptance
--   sheet. The app writes a row from nowhere else: not from a screen that does
--   not show the sentence in that build (one constant per screen in
--   utils/legalAcceptanceCore.ts; the login screen's is false until its
--   sentence ships), never from an email link (a confirmation, a sign-in
--   link, a password reset), never from a restored session, and, once the
--   re-acceptance gate is on, never from an existing account's sign-in. The
--   database cannot see a screen; the surface column says which path wrote
--   the row, and scripts/validate-legal-acceptance.ts holds the app to this.
--     user_id        the signed-in account, stamped from auth.uid() inside the
--                    function (a caller cannot name anyone else). Set NULL by
--                    the foreign key when the account is deleted: the record
--                    that an agreement happened stays, the person does not.
--     subject_hash   SHA-256 of 'mageid:legal_acceptance:v1:' || user_id, hex.
--                    Written at insert, never changed. It is the marker that
--                    survives account deletion: it cannot be turned back into
--                    an account id (the id is 122 random bits), but someone
--                    holding the id from another record can recompute it and
--                    find these rows. NULL for a no-account row.
--     subject_kind   'account' today. 'portal' and 'signing_link' are reserved
--                    for people with no account (see TOKEN FLOWS below).
--     subject_ref    for a no-account row: the portal's or signing link's ID,
--                    never the secret token. NULL for an account row.
--     kind           what was accepted: 'terms', 'privacy', 'code_answer_ack',
--                    'scan_ack'. The function accepts these four and no
--                    other, so junk kinds cannot use up a person's 400 rows.
--                    A new kind is one line in the function (a new migration).
--     version        the document version the app showed (utils/legalAcceptance
--                    TERMS_VERSION and friends).
--     text_sha256    SHA-256 (hex) of the exact words shown, so "which words"
--                    has an answer even after the page changes.
--     surface        where: signup_email, signup_apple, signup_google,
--                    login_first, reaccept, in_app (and portal, signing_link
--                    later).
--     app_version, platform   the build and ios / android / web.
--     update_id      the over-the-air update the phone was running when it
--                    SENT the row (expo-updates' update id), NULL for the
--                    bundle built into the binary and for web. With
--                    app_version it says which bundle, so which screens and
--                    which words. A row noted offline and sent after an update
--                    carries the sender's id; reported_delay_ms shows the gap.
--     accepted_at    THE SERVER'S CLOCK when the row was written. Never a time
--                    the phone sent.
--     reported_delay_ms  how long the phone says passed between the tap and
--                    this write (an offline phone sends late). The phone's
--                    claim, kept apart from accepted_at on purpose; NULL when
--                    the phone sent none. accepted_at minus this is the phone's
--                    account of when; accepted_at alone is what the server saw.
--     account_deleted_at  stamped by the server at the moment the foreign key
--                    removes user_id. NULL while the account exists.
--   NOT IN A ROW, EVER: an IP address, a user agent, an email, a name. (The
--   e-signature flow stores a user agent for a portal signer on
--   change_order_approvals.user_agent and no IP anywhere; nothing in the app
--   stores either for a signed-in account, so this table does not start.)
--
-- WHO WRITES. The signed-in person, for themselves only, through
--   public.record_my_legal_acceptance(kind, version, text hash, surface, app
--   version, platform, delay, update id): SECURITY DEFINER, empty search_path, user id from
--   auth.uid(), time from the server. One row per (person, kind, version, text
--   hash): a second call answers ok with recorded = false and writes nothing,
--   so a retry or a queued replay is harmless. At most 400 rows per person.
--   No client holds INSERT, UPDATE or DELETE on the table.
-- WHO READS. A signed-in person reads their own rows (one SELECT policy,
--   user_id = auth.uid()). The service role reads all and writes nothing (an
--   edge function cannot mint an acceptance); the SQL editor reads all. anon
--   holds nothing: no table privilege, no function.
-- NOTHING IS EVER CHANGED OR REMOVED. A trigger refuses every UPDATE except the
--   one the foreign key makes at account deletion (user_id to NULL, nothing
--   else different), and every DELETE except from a direct database session
--   (postgres, supabase_admin). The service role cannot delete either: there is
--   no retention job, and the period these rows are kept for is counsel's call.
--
-- ACCOUNT DELETION. supabase/functions/delete-account does NOT list this table
--   and must not: the auth.users delete in its step 4 fires ON DELETE SET NULL,
--   the trigger stamps account_deleted_at, and the row stays with subject_hash.
--   scripts/validate-account-deletion.ts carries the table as deliberately kept.
--
-- TOKEN FLOWS (designed, NOT built here). A homeowner on the portal or a sub on
--   a signing link has no account. Their acceptance belongs inside the function
--   that already checks their token (portal_submit_co_approval_signed, the lien
--   waiver signing function): after its own token check it inserts a row here
--   with subject_kind 'portal' or 'signing_link', subject_ref = the portal id
--   or the waiver id, and user_id NULL. Those two functions belong to the
--   signature-provenance lane, so this file adds the columns and the constraint
--   and leaves the insert to that lane. anon never gets a function of its own
--   on this table: a bare "record an acceptance for this id" function would let
--   anyone write rows for a portal they have only seen the id of.
--
-- DEPLOY ORDER. Apply this BEFORE the app update, or together with it. The
--   app does not break either way: it records best effort, treats a missing
--   function as "not yet", keeps the owed record on the phone and sends it
--   later; no sign-in waits on it or fails because of it. But until this file
--   is applied the only copy of an acceptance is on one phone, and it is lost
--   if the app is deleted or the phone is replaced. The owed record does
--   survive sign-out and another person signing in on the same phone (it is
--   kept through the tenant wipe, keyed by its owner). Apply through the
--   Supabase MCP apply_migration, never `supabase db push`.
--   Depends on: auth.users.
--
-- VERIFY AFTER
--   select relrowsecurity from pg_class where oid = 'public.legal_acceptances'::regclass;       -- true
--   select policyname, cmd, roles from pg_policies where tablename = 'legal_acceptances';        -- one row: legal_acceptances_read_own, SELECT, {authenticated}
--   select has_table_privilege('anon', 'public.legal_acceptances', 'select'),                    -- false
--          has_table_privilege('authenticated', 'public.legal_acceptances', 'select'),           -- true
--          has_table_privilege('authenticated', 'public.legal_acceptances', 'insert'),           -- false
--          has_table_privilege('authenticated', 'public.legal_acceptances', 'update'),           -- false
--          has_table_privilege('authenticated', 'public.legal_acceptances', 'delete');           -- false
--   select has_function_privilege('anon', 'public.record_my_legal_acceptance(text,text,text,text,text,text,bigint,text)', 'execute'),          -- false
--          has_function_privilege('authenticated', 'public.record_my_legal_acceptance(text,text,text,text,text,text,bigint,text)', 'execute'); -- true
--   select prosecdef, proconfig from pg_proc where proname = 'record_my_legal_acceptance';       -- true, {search_path=""}
--   -- after the app update, signed in once:
--   select kind, version, surface, platform, accepted_at from public.legal_acceptances order by id desc limit 4;
--
-- UNDO (by hand, only if the record is withdrawn; the rows are the proof, so
--   export them first)
--   drop function if exists public.record_my_legal_acceptance(text, text, text, text, text, text, bigint, text);
--   drop table if exists public.legal_acceptances;
--   drop function if exists public.legal_acceptances_keep();
--
-- PROOF. scripts/pgq/legal-acceptances.mjs applies this file twice on PGlite
--   and runs the cases; `--all` plants each mutation and shows which cases go
--   red. scripts/validate-legal-acceptance.ts pins this file's text.
--
-- Additive and idempotent.

-- ── 1. the table ─────────────────────────────────────────────────────────────
create table if not exists public.legal_acceptances (
  id                 bigint generated always as identity primary key,
  user_id            uuid references auth.users(id) on delete set null,
  subject_hash       text,
  subject_kind       text not null default 'account',
  subject_ref        text,
  kind               text not null,
  version            text not null,
  text_sha256        text not null,
  surface            text not null,
  app_version        text,
  platform           text,
  update_id          text,
  accepted_at        timestamptz not null default now(),
  reported_delay_ms  bigint,
  account_deleted_at timestamptz,
  -- Identifiers, not prose.
  constraint legal_acceptances_kind_check        check (kind    ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint legal_acceptances_version_check     check (version ~ '^[A-Za-z0-9._-]{1,40}$'),
  constraint legal_acceptances_text_check        check (text_sha256 ~ '^[0-9a-f]{64}$'),
  constraint legal_acceptances_surface_check     check (surface ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint legal_acceptances_app_version_check check (app_version is null or app_version ~ '^[A-Za-z0-9._+() -]{1,40}$'),
  constraint legal_acceptances_platform_check    check (platform is null or platform in ('ios', 'android', 'web')),
  constraint legal_acceptances_update_id_check   check (update_id is null or update_id ~ '^[A-Za-z0-9-]{1,64}$'),
  constraint legal_acceptances_delay_check       check (reported_delay_ms is null or reported_delay_ms >= 0),
  constraint legal_acceptances_subject_hash_check check (subject_hash is null or subject_hash ~ '^[0-9a-f]{64}$'),
  constraint legal_acceptances_subject_kind_check check (subject_kind in ('account', 'portal', 'signing_link')),
  -- An account row carries the marker and no token id; a no-account row carries
  -- the token's ID (never the token: bounded, identifier characters only) and
  -- never an account.
  constraint legal_acceptances_subject_check check (
    (subject_kind = 'account' and subject_ref is null and subject_hash is not null)
    or (subject_kind <> 'account' and user_id is null and subject_hash is null
        and subject_ref is not null and subject_ref ~ '^[A-Za-z0-9._:-]{1,128}$')
  )
);

comment on table public.legal_acceptances is
  'One row per acceptance or acknowledgement (Terms, Privacy Policy, code-answer notice, scan notice): who, which version, a SHA-256 of the words shown, the server time, the surface. Insert-only through record_my_legal_acceptance(). Kept when the account is deleted, with user_id NULL and subject_hash as the marker.';
comment on column public.legal_acceptances.accepted_at is
  'The server clock when the row was written. Never a client time.';
comment on column public.legal_acceptances.reported_delay_ms is
  'What the phone says passed between the tap and this write. The phone''s claim; accepted_at is the server''s.';

-- One row per (person, kind, version, words). The function relies on it.
create unique index if not exists legal_acceptances_once
  on public.legal_acceptances (user_id, kind, version, text_sha256) where user_id is not null;
create index if not exists idx_legal_acceptances_subject_hash on public.legal_acceptances (subject_hash) where subject_hash is not null;
create index if not exists idx_legal_acceptances_subject_ref  on public.legal_acceptances (subject_kind, subject_ref) where subject_ref is not null;

-- ── 2. nothing is changed or removed ─────────────────────────────────────────
create or replace function public.legal_acceptances_keep()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    if current_user in ('postgres', 'supabase_admin') then
      return old;
    end if;
    raise exception 'legal_acceptances: a recorded acceptance is never deleted' using errcode = '42501';
  end if;
  -- UPDATE. The one change allowed is the foreign key's own, at account
  -- deletion: user_id goes to NULL and nothing else differs. The server stamps
  -- when. Whoever runs the statement, that is the only shape that passes.
  if old.user_id is not null and new.user_id is null
     and new.id = old.id
     and new.subject_hash is not distinct from old.subject_hash
     and new.subject_kind = old.subject_kind
     and new.subject_ref is not distinct from old.subject_ref
     and new.kind = old.kind
     and new.version = old.version
     and new.text_sha256 = old.text_sha256
     and new.surface = old.surface
     and new.app_version is not distinct from old.app_version
     and new.platform is not distinct from old.platform
     and new.update_id is not distinct from old.update_id
     and new.accepted_at = old.accepted_at
     and new.reported_delay_ms is not distinct from old.reported_delay_ms
     and new.account_deleted_at is not distinct from old.account_deleted_at
  then
    new.account_deleted_at := coalesce(old.account_deleted_at, pg_catalog.clock_timestamp());
    return new;
  end if;
  raise exception 'legal_acceptances: a recorded acceptance is never changed' using errcode = '42501';
end
$function$;

revoke execute on function public.legal_acceptances_keep() from public, anon, authenticated;

drop trigger if exists legal_acceptances_keep on public.legal_acceptances;
create trigger legal_acceptances_keep
  before update or delete on public.legal_acceptances
  for each row execute function public.legal_acceptances_keep();

-- ── 3. locks ─────────────────────────────────────────────────────────────────
alter table public.legal_acceptances enable row level security;
revoke all on public.legal_acceptances from public, anon, authenticated, service_role;
grant select on public.legal_acceptances to authenticated;
grant select on public.legal_acceptances to service_role;

drop policy if exists legal_acceptances_read_own on public.legal_acceptances;
create policy legal_acceptances_read_own on public.legal_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ── 4. the one writer ────────────────────────────────────────────────────────
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
  if p_kind not in ('terms', 'privacy', 'code_answer_ack', 'scan_ack') then
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

-- ── self-check ───────────────────────────────────────────────────────────────
do $$
declare
  v_role text;
  v_priv text;
  v_cfg text[];
  v_def boolean;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.legal_acceptances'::regclass) then
    raise exception '[legal_acceptances] verify: row level security is off';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'legal_acceptances') <> 1
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'legal_acceptances'
                     and policyname = 'legal_acceptances_read_own' and cmd = 'SELECT') then
    raise exception '[legal_acceptances] verify: the table must have exactly one policy, the own-rows SELECT';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    foreach v_priv in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege('anon', 'public.legal_acceptances', v_priv) then
        raise exception '[legal_acceptances] verify: anon holds % on the table', v_priv;
      end if;
    end loop;
    if has_function_privilege('anon', 'public.record_my_legal_acceptance(text,text,text,text,text,text,bigint,text)', 'execute') then
      raise exception '[legal_acceptances] verify: anon can call the recorder';
    end if;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach v_priv in array array['insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege('authenticated', 'public.legal_acceptances', v_priv) then
        raise exception '[legal_acceptances] verify: authenticated holds % on the table', v_priv;
      end if;
    end loop;
    if not has_function_privilege('authenticated', 'public.record_my_legal_acceptance(text,text,text,text,text,text,bigint,text)', 'execute') then
      raise exception '[legal_acceptances] verify: authenticated cannot call the recorder';
    end if;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    if has_table_privilege('service_role', 'public.legal_acceptances', 'delete')
       or has_table_privilege('service_role', 'public.legal_acceptances', 'update')
       or has_table_privilege('service_role', 'public.legal_acceptances', 'insert') then
      raise exception '[legal_acceptances] verify: the service role must hold select only';
    end if;
  end if;
  select p.prosecdef, p.proconfig into v_def, v_cfg from pg_proc p
   where p.oid = 'public.record_my_legal_acceptance(text,text,text,text,text,text,bigint,text)'::regprocedure;
  if v_def is not true or v_cfg is null or not ('search_path=""' = any (v_cfg)) then
    raise exception '[legal_acceptances] verify: the recorder must be SECURITY DEFINER with an empty search_path';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.legal_acceptances'::regclass
                  and tgname = 'legal_acceptances_keep' and not tgisinternal and tgenabled <> 'D') then
    raise exception '[legal_acceptances] verify: the keep trigger is missing or disabled';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'legal_acceptances'
                and column_name in ('ip', 'ip_address', 'user_agent', 'email', 'name', 'token', 'access_token')) then
    raise exception '[legal_acceptances] verify: the table has a personal-data or secret column';
  end if;
end $$;

notify pgrst, 'reload schema';
