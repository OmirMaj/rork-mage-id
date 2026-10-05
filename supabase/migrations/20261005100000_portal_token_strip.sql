-- ============================================================================
-- 20261005100000_portal_token_strip.sql — the client's portal key leaves the
-- project row (productDecision #82, founder's OK 2026-10-04).
-- Supersedes held/20260923171000_portal_token_strip.sql, which stays in held/
-- and is never applied (what changed, and why, is under "DIFFERENCES").
--
-- GATED. The first statement refuses unless the same apply starts with
--     set mageid.portal_key_fix_ready = 'yes';
-- so a catch-up apply of every "unapplied" repo file fails loudly instead of
-- running this before the edge functions below are deployed. Apply by hand
-- through the Supabase MCP `apply_migration`, never by a bulk push.
--
-- THE HOLE IT CLOSES.
--   projects_select admits every accepted collaborator (editor, viewer and the
--   field seat), and the SELECT grant covers the whole row. 20260923170000
--   moved the client's portal key into the owner-only table
--   public.portal_credentials but still MIRRORS it into
--   projects.client_portal->>'accessToken' for old builds. That key is the only
--   thing the client page's RPCs check — portal_submit_co_approval_signed
--   records the client's e-signature on a change order on the key alone. So
--   anyone who accepts an invite to a job with a client portal can read the
--   key from the project row and act as the client.
--
-- WHAT IT DOES, in order.
--   0. Refuses without the gate setting, and without portal_credentials
--      (20260923170000 must be applied first).
--   1. portal_set_access_token (BEFORE INSERT OR UPDATE on projects) stops
--      mirroring. It keeps the stored key for the row's portal id, mints one
--      when there is none (owner or service role only, as before), and removes
--      `accessToken` from every client_portal written from now on. A key that
--      arrives in a write is DISCARDED, never adopted.
--   2. portal_rotate_access_token ("Reset link") writes portal_credentials
--      only. Same signature, same owner-only rule, same audit row, same return.
--   3. portal_project_for_token, portal_project_for_token_any and
--      portal_get_owner_token read portal_credentials only (the transition
--      fallback to the row's copy goes).
--   4. ROTATES every key that is on a project row at this moment (3 in
--      production on 2026-09-23): a key that sat on a collaborator-readable row
--      for any length of time is treated as seen. The new key goes to
--      portal_credentials; each rotation is recorded in portal_decision_audit
--      (action 'token_rotated', by '20261005100000').
--   5. Removes `accessToken` from every projects.client_portal.
--   6. Mints a key for an enabled portal that has none anywhere (a job created
--      by award_rfp whose contractor has not saved it yet), so the next check
--      holds on every database.
--   7. Self-check: no row carries a key, every enabled portal has a credentials
--      row, the five functions are the ones in this file, and the grants on
--      portal_credentials and the two owner RPCs are what they must be.
--
-- WHAT BREAKS, FOR WHOM.
--   • Every client link already sent stops opening at the moment of the apply
--     (step 4). The client page shows its "this link no longer works — your
--     contractor may have reset the link" screen. Nothing the client did is
--     lost: approvals, messages and the published page are untouched. The owner
--     opens Client portal setup on each job and sends the link again (the
--     screen reads the new key through portal_get_owner_token); "Reset link"
--     there also works and hands back a fresh key.
--   • An accepted collaborator sees no change: the app already hides the key
--     from a collaborator's copy (stripPortalCredentials), and Client portal
--     setup already tells them only the owner can share the link.
--   • The passcode is NOT touched (see DIFFERENCES 1).
--
-- DEPLOY ORDER. Edge functions first, app second, this file last.
--   (a) homeowner-weekly-digest, invoice-dunning, notify and
--       portal-link-expiry-notice at the commit that reads the key through
--       _shared/portalLinks.ts `storedPortalKey` (portal_credentials, service
--       role). Deployed BEFORE this file they behave exactly as today (the
--       credentials row equals the row's copy). Not deployed, every e-mail they
--       send after this file goes out without the portal button (never with a
--       dead link: portalUrlFor returns null).
--   (b) The OTA (and the web deploy) whose project loader reads the owner's
--       keys from portal_credentials. Before it, an owner's phone still shows
--       and shares the link from Client portal setup, but change-order and
--       contract e-mails and the project page's portal card find no key and
--       say the link is not ready.
--   (c) This file.
--
-- REVERSE PATH. Nothing here drops data, and the old keys are not restorable
--   on purpose (they are compromised). To put the mirror back for old builds:
--   re-run section (1) of 20260923170000_rls_hardening.sql from
--   "create or replace function public.portal_set_access_token()" through
--   portal_get_owner_token's grants (the five functions, verbatim), then
--     update public.projects p
--        set client_portal = p.client_portal
--                            || jsonb_build_object('accessToken', pc.access_token)
--       from public.portal_credentials pc
--      where pc.project_id = p.id
--        and pc.portal_id = p.client_portal->>'portalId';
--   That re-opens the hole; the links sent after this file keep working.
--
-- VERIFY AFTER (production, read-only):
--   select count(*) from public.projects
--    where jsonb_typeof(client_portal) = 'object' and client_portal ? 'accessToken';      -- 0
--   select count(*) from public.projects p
--    where coalesce((p.client_portal->>'enabled')::boolean, false)
--      and nullif(p.client_portal->>'portalId', '') is not null
--      and not exists (select 1 from public.portal_credentials pc
--                       where pc.project_id = p.id
--                         and pc.portal_id = p.client_portal->>'portalId');               -- 0
--   select count(*) from public.portal_decision_audit
--    where action = 'token_rotated' and detail->>'by' = '20261005100000';                 -- the number of keys found on rows (3)
--   select p.proname, p.prosrc like '%jsonb_build_object(''accessToken''%' as mirrors
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('portal_set_access_token', 'portal_rotate_access_token');        -- mirrors = false, twice
--   Then, by hand: a link re-sent from Client portal setup opens the portal; a
--   link sent before the apply shows the "no longer works" screen.
--
-- DIFFERENCES from held/20260923171000 (each one is a defect that file had
-- against today's schema and code):
--   1. The PASSCODE stays on the row. The held file stripped it too, but
--      validate-portal-passcode (edge) and portal_sign_contract
--      (20260920060000) both read client_portal->>'passcode' and treat "none
--      stored" as "no passcode": stripping it would have switched every
--      passcode off without a word. The app also round-trips the passcode
--      through the row for the owner (Save refuses without it, the unsaved
--      banner compares it). The passcode is not the key: no RPC accepts it in
--      place of the key, and the screen calls it "an extra step, not a lock".
--      portal_credentials.passcode keeps following the row, as since 170000.
--   2. A key carried in a write is never adopted. The held trigger took
--      client_portal->>'accessToken' when the project had no credentials row
--      for that portal id — so a pre-rotation key could come back as the key
--      of a re-made portal. No build since the 2026-09-23 OTA sends the key.
--   3. The held post-condition raised when an enabled portal had no
--      credentials row. award_rfp creates exactly that (the homeowner's
--      session inserts the contractor's job; the trigger only writes
--      credentials for the owner or the service role), so one awarded job
--      would have aborted the whole apply. Step 6 mints for those first.
--   4. Rotation is driven by the exposure itself (a key present on a row), not
--      by an audit marker per project: a second run of this file finds no key
--      on any row and rotates nothing, including portals made in between. The
--      held file's re-run rotated every portal created since its first run.
--
-- Tested: PGlite, on the repo's own definitions of every function and trigger
-- that touches projects.client_portal (cut verbatim from the last migration
-- that defines each), applied twice, 14 planted mutations —
-- tools/pgq/portal-token-strip.mjs. Static pins:
-- scripts/validate-w5-rls-hardening-sql.ts ("#82 strip").
-- ============================================================================

-- ── 0. gate and precondition ───────────────────────────────────────────────
do $mig$
begin
  if coalesce(current_setting('mageid.portal_key_fix_ready', true), '') <> 'yes' then
    raise exception '[portal-key] held: deploy the four e-mail functions and ship the app first, then apply with "set mageid.portal_key_fix_ready = ''yes'';" as the first statement (see this file''s header)';
  end if;
  if to_regclass('public.portal_credentials') is null
     or to_regprocedure('public.portal_get_owner_token(uuid)') is null then
    raise exception '[portal-key] 20260923170000_rls_hardening.sql must be applied first (public.portal_credentials / portal_get_owner_token are missing)';
  end if;
end
$mig$;

-- ── 1. the token trigger: keep or mint in portal_credentials, never mirror ──
create or replace function public.portal_set_access_token()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $fn$
declare
  v_caller    uuid := auth.uid();
  v_owner     uuid;
  v_pid       text;
  v_cred_pid  text;
  v_cred_tok  text;
  v_may_write boolean;
  v_tok       text;
begin
  if new.client_portal is null or jsonb_typeof(new.client_portal) <> 'object' then
    return new;
  end if;

  v_pid := nullif(new.client_portal->>'portalId', '');

  if v_pid is not null then
    if tg_op = 'UPDATE' then
      v_owner := old.user_id;
    else
      -- An upsert's insert attempt: the owner is the STORED row's, never the
      -- one the caller wrote into NEW.
      select p.user_id into v_owner from public.projects p where p.id = new.id;
      v_owner := coalesce(v_owner, new.user_id);
    end if;
    v_may_write := v_caller is null or v_caller = v_owner;

    if v_may_write then
      select pc.portal_id, pc.access_token into v_cred_pid, v_cred_tok
        from public.portal_credentials pc where pc.project_id = new.id;

      -- The stored key for this portal id, else a new one. A key carried in
      -- the write is never read: it is removed below.
      v_tok := coalesce(
        case when v_cred_pid is not distinct from v_pid then nullif(v_cred_tok, '') end,
        encode(extensions.gen_random_bytes(24), 'hex'));

      if not exists (select 1 from public.projects p
                      where p.client_portal->>'portalId' = v_pid and p.id <> new.id) then
        -- A portal id no other project carries. Clear a stale credentials row
        -- still holding it so the unique index can't refuse this one; when
        -- another project DOES carry the id, skip —
        -- projects_client_portal_portal_id_uidx refuses the row itself.
        delete from public.portal_credentials
         where portal_id = v_pid and project_id <> new.id;
        insert into public.portal_credentials as pc
               (project_id, portal_id, access_token, passcode, rotated_at)
        values (new.id, v_pid, v_tok, nullif(new.client_portal->>'passcode', ''), null)
        on conflict (project_id) do update
           set portal_id    = excluded.portal_id,
               access_token = excluded.access_token,
               passcode     = excluded.passcode,
               rotated_at   = case when pc.access_token is distinct from excluded.access_token
                                   then now() else pc.rotated_at end;
      end if;
    end if;
  end if;

  -- THE STRIP: the key never rests on the row, whoever wrote it.
  new.client_portal := new.client_portal - 'accessToken';
  return new;
end;
$fn$;

comment on function public.portal_set_access_token() is
  'BEFORE INSERT OR UPDATE on projects (20261005100000, #82): keeps / mints the client portal key in portal_credentials (owner or service role only) and removes accessToken from client_portal on every write. A key carried in the write is discarded, never adopted. The passcode stays on the row and is copied to portal_credentials.';

-- ── 2. Reset link: credentials only ────────────────────────────────────────
create or replace function public.portal_rotate_access_token(p_project_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_owner uuid;
  v_portal jsonb;
  v_portal_id text;
  v_new text;
  v_stored text;
begin
  if auth.uid() is null then
    raise exception 'portal_rotate_denied' using errcode = '42501';
  end if;

  select user_id, client_portal into v_owner, v_portal
    from public.projects where id = p_project_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'portal_rotate_denied' using errcode = '42501';
  end if;

  v_portal_id := v_portal->>'portalId';
  if v_portal is null or coalesce(v_portal_id, '') = '' then
    raise exception 'portal_rotate_no_portal';
  end if;

  v_new := encode(extensions.gen_random_bytes(24), 'hex');

  delete from public.portal_credentials
   where portal_id = v_portal_id and project_id <> p_project_id;
  insert into public.portal_credentials as pc
         (project_id, portal_id, access_token, passcode, rotated_at)
  values (p_project_id, v_portal_id, v_new, nullif(v_portal->>'passcode', ''), now())
  on conflict (project_id) do update
     set portal_id = excluded.portal_id,
         access_token = excluded.access_token,
         rotated_at = now();

  select access_token into v_stored
    from public.portal_credentials where project_id = p_project_id;
  if v_stored is distinct from v_new then
    raise exception 'portal_rotate_failed: a trigger rewrote the token';
  end if;

  insert into public.portal_decision_audit(portal_id, project_id, action, detail)
    values (v_portal_id, p_project_id, 'token_rotated',
            jsonb_build_object('by', auth.uid(), 'at', now()));

  return v_new;
end; $function$;

revoke execute on function public.portal_rotate_access_token(uuid) from public, anon;
grant  execute on function public.portal_rotate_access_token(uuid) to authenticated, service_role;

-- ── 3. readers: credentials only ───────────────────────────────────────────
create or replace function public.portal_project_for_token(p_portal_id text, p_access_token text)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p.id from public.projects p
    join public.portal_credentials pc
      on pc.project_id = p.id and pc.portal_id = p_portal_id
   where p.client_portal->>'portalId' = p_portal_id
     and coalesce((p.client_portal->>'enabled')::boolean, false) = true
     and coalesce(pc.access_token, '') <> ''
     and pc.access_token = p_access_token
     and not exists (
       select 1 from public.portal_snapshots ps
        where ps.portal_id = p_portal_id
          and ps.expires_at is not null
          and ps.expires_at <= now()
     )
   limit 1;
$function$;

create or replace function public.portal_project_for_token_any(p_portal_id text, p_access_token text)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p.id from public.projects p
    join public.portal_credentials pc
      on pc.project_id = p.id and pc.portal_id = p_portal_id
   where p.client_portal->>'portalId' = p_portal_id
     and coalesce((p.client_portal->>'enabled')::boolean, false) = true
     and coalesce(pc.access_token, '') <> ''
     and pc.access_token = p_access_token
   limit 1;
$function$;

revoke execute on function public.portal_project_for_token(text, text)     from public, anon, authenticated;
revoke execute on function public.portal_project_for_token_any(text, text) from public, anon, authenticated;
grant  execute on function public.portal_project_for_token(text, text)     to service_role;
grant  execute on function public.portal_project_for_token_any(text, text) to service_role;

create or replace function public.portal_get_owner_token(p_project_id uuid)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $fn$
declare
  v_owner  uuid;
  v_portal jsonb;
  v_tok    text;
begin
  if auth.uid() is null then
    raise exception 'portal_token_denied' using errcode = '42501';
  end if;
  select user_id, client_portal into v_owner, v_portal
    from public.projects where id = p_project_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'portal_token_denied' using errcode = '42501';
  end if;
  select nullif(pc.access_token, '') into v_tok
    from public.portal_credentials pc
   where pc.project_id = p_project_id
     and pc.portal_id is not distinct from nullif(v_portal->>'portalId', '');
  return v_tok;
end;
$fn$;

comment on function public.portal_get_owner_token(uuid) is
  'The client portal key for the caller''s OWN project (20261005100000, #82): read from portal_credentials only; null when none exists, 42501 for anyone but the owner.';

revoke all on function public.portal_get_owner_token(uuid) from public, anon;
grant execute on function public.portal_get_owner_token(uuid) to authenticated, service_role;

-- ── 4. rotate every key that is on a row, 5. strip, 6. mint the missing ─────
-- Runs as the migration role (auth.uid() IS NULL — the trigger treats it as
-- the service role). A second run finds no key on any row: nothing rotates.
do $mig$
declare r record; v_new text; v_rot int := 0; v_strip int := 0; v_mint int := 0;
begin
  for r in
    select p.id, p.client_portal->>'portalId' as portal_id,
           nullif(p.client_portal->>'passcode', '') as passcode
      from public.projects p
     where jsonb_typeof(p.client_portal) = 'object'
       and nullif(p.client_portal->>'accessToken', '') is not null
       and nullif(p.client_portal->>'portalId', '') is not null
     order by p.id
  loop
    v_new := encode(extensions.gen_random_bytes(24), 'hex');
    delete from public.portal_credentials
     where portal_id = r.portal_id and project_id <> r.id;
    insert into public.portal_credentials as pc
           (project_id, portal_id, access_token, passcode, rotated_at)
    values (r.id, r.portal_id, v_new, r.passcode, now())
    on conflict (project_id) do update
       set portal_id    = excluded.portal_id,
           access_token = excluded.access_token,
           passcode     = excluded.passcode,
           rotated_at   = now();
    insert into public.portal_decision_audit(portal_id, project_id, action, detail)
      values (r.portal_id, r.id, 'token_rotated',
              jsonb_build_object('by', '20261005100000', 'at', now(),
                                 'why', 'the key was readable by collaborators on the project row (#82)'));
    v_rot := v_rot + 1;
  end loop;

  -- The trigger above strips too; the explicit expression makes the statement
  -- correct on its own.
  update public.projects
     set client_portal = client_portal - 'accessToken'
   where jsonb_typeof(client_portal) = 'object'
     and client_portal ? 'accessToken';
  get diagnostics v_strip = row_count;

  for r in
    select p.id, p.client_portal->>'portalId' as portal_id,
           nullif(p.client_portal->>'passcode', '') as passcode
      from public.projects p
     where jsonb_typeof(p.client_portal) = 'object'
       and coalesce((p.client_portal->>'enabled')::boolean, false)
       and nullif(p.client_portal->>'portalId', '') is not null
       and not exists (select 1 from public.portal_credentials pc
                        where pc.project_id = p.id
                          and pc.portal_id = p.client_portal->>'portalId')
     order by p.id
  loop
    delete from public.portal_credentials
     where portal_id = r.portal_id and project_id <> r.id;
    insert into public.portal_credentials as pc
           (project_id, portal_id, access_token, passcode, rotated_at)
    values (r.id, r.portal_id, encode(extensions.gen_random_bytes(24), 'hex'), r.passcode, null)
    on conflict (project_id) do update
       set portal_id    = excluded.portal_id,
           access_token = excluded.access_token,
           passcode     = excluded.passcode,
           rotated_at   = now();
    v_mint := v_mint + 1;
  end loop;

  raise notice '[portal-key] rotated % key(s) that were on a project row — every client link already sent must be sent again; stripped % row(s); minted % key(s) for portals that had none', v_rot, v_strip, v_mint;
end
$mig$;

comment on table public.portal_credentials is
  'The client portal key (access token; plus a copy of the passcode) for a project (20260923170000, #82). Owner-only SELECT; written only by portal_set_access_token (trigger, SECURITY DEFINER), portal_rotate_access_token and the service role. Since 20261005100000 the key is stored HERE ONLY: projects.client_portal carries no accessToken.';

-- ── 7. self-check ──────────────────────────────────────────────────────────
do $mig$
declare v_n int; v_src text;
begin
  select count(*) into v_n from public.projects
   where jsonb_typeof(client_portal) = 'object' and client_portal ? 'accessToken';
  if v_n > 0 then
    raise exception '[portal-key] verify: % projects row(s) still carry accessToken', v_n;
  end if;

  select count(*) into v_n from public.projects p
   where jsonb_typeof(p.client_portal) = 'object'
     and nullif(p.client_portal->>'portalId', '') is not null
     and coalesce((p.client_portal->>'enabled')::boolean, false)
     and not exists (select 1 from public.portal_credentials pc
                      where pc.project_id = p.id
                        and pc.portal_id = p.client_portal->>'portalId'
                        and coalesce(pc.access_token, '') <> '');
  if v_n > 0 then
    raise exception '[portal-key] verify: % enabled portal(s) have no portal_credentials row — their links would never resolve', v_n;
  end if;

  select p.prosrc into v_src from pg_catalog.pg_proc p
   where p.oid = 'public.portal_set_access_token()'::regprocedure;
  if v_src is null
     or v_src not like '%new.client_portal := new.client_portal - ''accessToken'';%'
     or v_src like '%jsonb_build_object(''accessToken''%'
     or v_src like '%client_portal->>''accessToken''%' then
    raise exception '[portal-key] verify: portal_set_access_token must strip accessToken on every write, never mirror it and never read one from the write';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger t
                  where t.tgrelid = 'public.projects'::regclass and not t.tgisinternal
                    and t.tgenabled <> 'D'
                    and t.tgfoid = 'public.portal_set_access_token()'::regprocedure
                    and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16) then
    raise exception '[portal-key] verify: no enabled BEFORE INSERT OR UPDATE trigger on public.projects calls portal_set_access_token';
  end if;

  for v_src in
    select p.prosrc from pg_catalog.pg_proc p
     where p.oid in ('public.portal_rotate_access_token(uuid)'::regprocedure,
                     'public.portal_project_for_token(text,text)'::regprocedure,
                     'public.portal_project_for_token_any(text,text)'::regprocedure,
                     'public.portal_get_owner_token(uuid)'::regprocedure)
  loop
    if v_src like '%accessToken%' then
      raise exception '[portal-key] verify: a portal key function still reads or writes client_portal.accessToken';
    end if;
  end loop;

  if has_table_privilege('anon', 'public.portal_credentials', 'select')
     or has_table_privilege('anon', 'public.portal_credentials', 'insert, update, delete')
     or has_table_privilege('authenticated', 'public.portal_credentials', 'insert, update, delete') then
    raise exception '[portal-key] verify: portal_credentials must not be readable by anon nor writable by anon / authenticated';
  end if;
  if not exists (select 1 from pg_catalog.pg_class c
                  where c.oid = 'public.portal_credentials'::regclass and c.relrowsecurity) then
    raise exception '[portal-key] verify: row level security must be on for portal_credentials';
  end if;
  select count(*) into v_n from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'portal_credentials';
  if v_n <> 1 or not exists (
       select 1 from pg_catalog.pg_policies
        where schemaname = 'public' and tablename = 'portal_credentials'
          and policyname = 'portal_credentials_owner_select' and cmd = 'SELECT'
          and qual like '%user_id = auth.uid()%') then
    raise exception '[portal-key] verify: portal_credentials must carry exactly one policy, the owner-only SELECT (found %)', v_n;
  end if;

  if has_function_privilege('anon', 'public.portal_get_owner_token(uuid)', 'execute')
     or has_function_privilege('anon', 'public.portal_rotate_access_token(uuid)', 'execute')
     or has_function_privilege('anon', 'public.portal_project_for_token(text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.portal_project_for_token(text,text)', 'execute')
     or has_function_privilege('anon', 'public.portal_project_for_token_any(text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.portal_project_for_token_any(text,text)', 'execute') then
    raise exception '[portal-key] verify: anon must not call the owner RPCs, and no client role may call portal_project_for_token(_any) directly';
  end if;
  if not has_function_privilege('authenticated', 'public.portal_get_owner_token(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.portal_rotate_access_token(uuid)', 'execute') then
    raise exception '[portal-key] verify: a signed-in owner must be able to call portal_get_owner_token and portal_rotate_access_token';
  end if;

  raise notice '[portal-key] the client portal key lives only in portal_credentials';
end
$mig$;
