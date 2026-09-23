-- held/20260923171000_portal_token_strip.sql — HELD. Do not apply yet.
--
-- Wave 5, rls-hardening lane, #82 part 2 (productDecision #82). Closes the
-- hole 20260923170000 only narrowed: the homeowner portal key (accessToken,
-- passcode) is still MIRRORED into projects.client_portal, which every
-- accepted collaborator — a field-seat foreman included — can SELECT, and the
-- key is all portal_submit_co_approval_signed checks before recording the
-- homeowner's e-signature on a change order.
--
-- WHAT IT DOES
--   1. Re-creates portal_set_access_token as a STRIP: the key goes to
--      portal_credentials only, and accessToken / passcode are removed from
--      every client_portal written from now on (an old build's write
--      included; its passcode is captured into portal_credentials first).
--   2. portal_rotate_access_token writes portal_credentials only.
--   3. portal_project_for_token(_any) and portal_get_owner_token read
--      portal_credentials only (the transition fallback to the blob goes).
--   4. Backfills any portal row still missing a credentials row, strips
--      accessToken / passcode from every projects.client_portal.
--   5. ROTATES every live portal key (3 in production on 2026-09-23). A key
--      that sat on a collaborator-readable row for any length of time is
--      treated as seen. Every link the GC has already sent stops working; he
--      re-shares from Client Portal setup (which reads the new key through
--      portal_get_owner_token).
--
-- PRECONDITIONS — all of them, in order (founder's OK required: productDecision #82)
--   (a) 20260923170000_rls_hardening.sql is applied (portal_credentials,
--       portal_get_owner_token, the owner-only client_portal trigger).
--   (b) The wave-5 OTA is live AND has reached devices: w5-join-core's owner
--       upsert no longer sends accessToken, and w5-join-screens'
--       client-portal-setup reads the key through
--       supabase.rpc('portal_get_owner_token', { p_project_id }). A build from
--       before that OTA reads the key off the row: after this strip it shows
--       "link pending" until the app updates (its token-heal write is
--       harmless — the trigger keeps the stored key).
--   (c) Every edge function that reads the key or passcode off
--       projects.client_portal reads portal_credentials instead (service
--       role) and is DEPLOYED: supabase/functions/_shared/portalLinks.ts
--       (portalUrlFor — used by homeowner-weekly-digest, invoice-dunning,
--       notify, portal-link-expiry-notice) and validate-portal-passcode
--       (reads client_portal.passcode). Without this, digest / dunning /
--       expiry e-mails go out with no working link and a passcode-protected
--       portal can't be unlocked. grep -rn "accessToken\|passcode"
--       supabase/functions before applying — expect only portal_credentials
--       reads and request-body fields.
--   (d) The founder knows the rotation in step 5 breaks every homeowner link
--       already sent, and will re-share from the app.
--
-- VERIFY AFTER (production, read-only):
--   • as a collaborator JWT: GET /rest/v1/projects?select=client_portal has
--     no accessToken / passcode on any row;
--   • select count(*) from projects where client_portal ?| array['accessToken','passcode'] → 0;
--   • a freshly re-shared owner link opens the portal and
--     portal_submit_co_approval_signed accepts it; an old link is refused.
--
-- Tested: PGlite, on top of 20260923170000, applied twice
-- (scratchpad w5rls_pg/w5_rls_hardening.mjs, "held" section).

-- ── 1. the token trigger becomes a strip ───────────────────────────────────
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
  v_cred_pass text;
  v_may_write boolean;
  v_tok       text;
  v_pass      text;
begin
  if new.client_portal is null or jsonb_typeof(new.client_portal) <> 'object' then
    return new;
  end if;
  if not (new.client_portal ? 'portalId') then
    new.client_portal := new.client_portal - 'accessToken' - 'passcode';
    return new;
  end if;

  v_pid := nullif(new.client_portal->>'portalId', '');

  if tg_op = 'UPDATE' then
    v_owner := old.user_id;
  else
    select p.user_id into v_owner from public.projects p where p.id = new.id;
    v_owner := coalesce(v_owner, new.user_id);
  end if;
  v_may_write := v_caller is null or v_caller = v_owner;

  if v_may_write and v_pid is not null then
    select pc.portal_id, pc.access_token, pc.passcode into v_cred_pid, v_cred_tok, v_cred_pass
      from public.portal_credentials pc where pc.project_id = new.id;

    v_tok := coalesce(
      case when v_cred_pid is not distinct from v_pid then nullif(v_cred_tok, '') end,
      nullif(new.client_portal->>'accessToken', ''),
      encode(extensions.gen_random_bytes(24), 'hex'));
    -- The passcode is still set in the owner's Client Portal setup and rides
    -- in his write; capture it, and keep the stored one when the write has
    -- none (every write after this strip, bar one from the setup screen).
    v_pass := case when new.client_portal ? 'passcode'
                   then nullif(new.client_portal->>'passcode', '')
                   else v_cred_pass end;

    if not exists (select 1 from public.projects p
                    where p.client_portal->>'portalId' = v_pid and p.id <> new.id) then
      delete from public.portal_credentials
       where portal_id = v_pid and project_id <> new.id;
      insert into public.portal_credentials as pc
             (project_id, portal_id, access_token, passcode, rotated_at)
      values (new.id, v_pid, v_tok, v_pass, null)
      on conflict (project_id) do update
         set portal_id    = excluded.portal_id,
             access_token = excluded.access_token,
             passcode     = excluded.passcode,
             rotated_at   = case when pc.access_token is distinct from excluded.access_token
                                 then now() else pc.rotated_at end;
    end if;
  end if;

  new.client_portal := new.client_portal - 'accessToken' - 'passcode';
  return new;
end;
$fn$;

comment on function public.portal_set_access_token() is
  'BEFORE INSERT OR UPDATE on projects (held/20260923171000, #82): keeps / mints the portal key in portal_credentials (owner or service role only) and strips accessToken / passcode from client_portal on every write.';

-- ── 2. rotation: credentials only ──────────────────────────────────────────
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
  values (p_project_id, v_portal_id, v_new, null, now())
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

-- ── 4. backfill stragglers, then strip every row ───────────────────────────
insert into public.portal_credentials (project_id, portal_id, access_token, passcode, rotated_at)
select p.id,
       p.client_portal->>'portalId',
       p.client_portal->>'accessToken',
       nullif(p.client_portal->>'passcode', ''),
       null
  from public.projects p
 where jsonb_typeof(p.client_portal) = 'object'
   and nullif(p.client_portal->>'portalId', '') is not null
   and nullif(p.client_portal->>'accessToken', '') is not null
on conflict (project_id) do nothing;

-- The trigger above strips; the explicit expression makes the statement
-- correct on its own too. Runs as the migration role (auth.uid() IS NULL).
update public.projects
   set client_portal = client_portal - 'accessToken' - 'passcode'
 where jsonb_typeof(client_portal) = 'object'
   and client_portal ?| array['accessToken', 'passcode'];

-- ── 5. rotate every live key once ──────────────────────────────────────────
-- Once: a re-run (this file applied twice) must not rotate again, so only
-- keys not already rotated by THIS file are touched (marked in the audit).
do $mig$
declare r record; v_new text; v_n int := 0;
begin
  for r in
    select pc.project_id, pc.portal_id
      from public.portal_credentials pc
     where pc.portal_id is not null
       and not exists (select 1 from public.portal_decision_audit a
                        where a.project_id = pc.project_id
                          and a.action = 'token_rotated'
                          and a.detail->>'by' = 'held/20260923171000')
  loop
    v_new := encode(extensions.gen_random_bytes(24), 'hex');
    update public.portal_credentials
       set access_token = v_new, rotated_at = now()
     where project_id = r.project_id;
    insert into public.portal_decision_audit(portal_id, project_id, action, detail)
      values (r.portal_id, r.project_id, 'token_rotated',
              jsonb_build_object('by', 'held/20260923171000', 'at', now(),
                                 'why', 'key was readable by collaborators before the strip (#82)'));
    v_n := v_n + 1;
  end loop;
  raise notice '[171000] rotated % portal key(s) — every homeowner link already sent must be re-shared', v_n;
end
$mig$;

-- ── post-conditions ────────────────────────────────────────────────────────
do $mig$
declare v_left int; v_missing int;
begin
  select count(*) into v_left from public.projects
   where jsonb_typeof(client_portal) = 'object'
     and client_portal ?| array['accessToken', 'passcode'];
  if v_left > 0 then
    raise exception '[171000] % projects row(s) still carry accessToken / passcode', v_left;
  end if;
  select count(*) into v_missing from public.projects p
   where nullif(p.client_portal->>'portalId', '') is not null
     and coalesce((p.client_portal->>'enabled')::boolean, false)
     and not exists (select 1 from public.portal_credentials pc
                      where pc.project_id = p.id and pc.portal_id = p.client_portal->>'portalId');
  if v_missing > 0 then
    raise exception '[171000] % enabled portal(s) have no portal_credentials row — their links would stop resolving', v_missing;
  end if;
  raise notice '[171000] portal keys live only in portal_credentials';
end
$mig$;
