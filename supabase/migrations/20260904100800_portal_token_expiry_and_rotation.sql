-- ============================================================================
-- Portal links: expiry enforced at the choke point, and a way to rotate them.
--
-- Audit IDs: AUTH-F7 (expiry is cosmetic), AUTH-F8 (a leaked link cannot be
--            revoked or rotated), 06-auth-tenancy-portal-privacy.md O2.
--
-- WHY (F7). 20260826170000 gave portal_snapshots an expires_at and
-- 20260826190000 made portal_get_snapshot_v2 honour it — but v2 is the ONLY
-- reader that does. portal_project_for_token, the helper every other portal
-- RPC authorises through (messages, budget proposals, CO approvals signed and
-- unsigned), has no expiry clause; and portal_sign_contract /
-- portal_choose_selection do not call it at all — they re-implement the token
-- compare against projects directly. So on day 30 of a "7-day link" the
-- homeowner can still e-sign a change order, post messages and pick
-- selections. The GC was told the link lapsed; the database disagreed.
--
-- WHY (F8). portal_set_access_token only fills an EMPTY token, and on UPDATE
-- reuses old.client_portal->>'accessToken'. No UI or RPC ever writes a new
-- one, so a forwarded link cannot be cut off: disable + re-enable hands the
-- same key back. Rotation needs a server-side path that the owner alone can
-- call.
--
-- WHAT CHANGES
--   1. portal_project_for_token_any — the token + enabled check, expiry-
--      agnostic, INTERNAL (postgres / service_role only). Exists so v2 can
--      keep telling "expired" apart from "denied" without re-implementing the
--      token compare; that distinction is what the portal page's "This link
--      has expired" screen is built on.
--   2. portal_project_for_token — EXACT current body (schema.sql:4896-4908)
--      plus one clause: a portal whose snapshot has a past expires_at is
--      refused. NULL expires_at still means "never" (every pre-08-26 row).
--      Callers that pick this up for free: portal_get_snapshot (v1),
--      portal_get_messages, portal_post_message, portal_submit_budget_proposal,
--      portal_submit_co_approval, portal_submit_co_approval_signed, and the
--      portal-ask-home edge function.
--   3. portal_get_snapshot_v2 — same body as today, authorising through (1)
--      so its 'expired' envelope keeps working (through (2) it would raise
--      portal_denied first and the page would show the generic fallback).
--   4. portal_sign_contract / portal_choose_selection — authorise through (2).
--      Everything after the authorisation is byte-for-byte the current body,
--      including the passcode check in sign_contract (DB-F3 is a separate
--      item and is NOT changed here).
--   5. portal_rotate_access_token(p_project_id) — owner-only, mints a fresh
--      192-bit token, writes it, verifies the write, audits it, returns it.
--   6. portal_set_access_token (the trigger) — same body, gen_random_bytes
--      schema-qualified, so its mint branch stops raising 42883. See THE
--      TRIGGER below for why that is not a side note.
--
-- ── THE TRIGGER, READ BEFORE TRUSTING THE RPC ────────────────────────────────
-- portal_set_access_token (BEFORE INSERT OR UPDATE ON projects) does:
--     if new.client_portal ? 'portalId'
--        and coalesce(new.client_portal->>'accessToken','') = ''
--     then new.accessToken := coalesce(old.accessToken (on UPDATE), gen_random_bytes)
-- i.e. it re-injects the OLD token only when the NEW value is EMPTY. A
-- non-empty fresh token passes through untouched, so the RPC does not need
-- to disable the trigger — it writes a non-empty value and then RE-READS the
-- row and raises if the stored token is not the one it minted, so a future
-- change to that trigger cannot silently undo a rotation.
--
-- ITS MINT BRANCH IS BROKEN IN PRODUCTION, AND IT IS EXERCISED (review
-- 2026-09-05; an earlier draft of this header claimed the opposite). The
-- trigger runs under `search_path = pg_catalog, public` (live proconfig) and
-- calls gen_random_bytes unqualified, but pgcrypto lives in `extensions` on
-- this project — so the first write of a token-less enabled portal raises
-- 42883 "function gen_random_bytes(integer) does not exist" and the WHOLE
-- projects upsert is rejected, not just the token (reproduced in a scratch
-- Postgres loaded from schema.sql). That write happens on every first enable:
-- app/client-portal-setup.tsx seeds `portal` from DEFAULT_PORTAL with no
-- accessToken (:245-257), and handleSave (:508-516) pushes it through
-- updateProject → syncProjectToSupabase as the whole client_portal jsonb.
-- What masks it is the client-side heal effect (:371-388): once the local
-- copy is enabled-without-token it mints a token ON THE CLIENT and writes
-- again, and that second write passes the trigger untouched — which is why
-- 0 of the 3 enabled portals live are token-less. Section 6 below replaces
-- the trigger body with the same logic and a schema-qualified
-- extensions.gen_random_bytes; section 5 (the RPC) already qualified it.
--
-- ── AUTH-F8 IS NOT CLOSED FOR USERS BY THIS FILE ─────────────────────────────
-- The RPC exists and is proven (owner-only, old token dead, audit row). Two
-- things stop it from being a feature:
--   1. Nothing calls it. There is no "Regenerate link" action in
--      app/client-portal-setup.tsx or anywhere else (repo grep 2026-09-05).
--   2. Rotation is UNDONE by the next project sync. ProjectContext.
--      syncProjectToSupabase writes the WHOLE client_portal jsonb from local
--      state (contexts/ProjectContext.tsx:2006-2008, the owner upsert). Local
--      state still holds the OLD token, it is non-empty, the trigger keeps it,
--      and the old link works again — reproduced in scratch (rotate, push the
--      stale jsonb, old token re-accepted).
-- Record AUTH-F8 as "server side ready", not closed.
--
-- THE CLIENT FOLLOW-UP (not in this file; contexts/ProjectContext.tsx and
-- app/client-portal-setup.tsx):
--   a. Stop sending `accessToken` inside `client_portal` on the owner upsert
--      (omit the key). The trigger then re-injects the STORED token on every
--      UPDATE (proven in scratch: a push without the key leaves a rotated
--      token in place) and mints one on first enable.
--   b. Retire the client-side heal mint (:371-388) — under (a) it would only
--      re-introduce a client-chosen token.
--   c. Read the token back instead of inventing it: the owner load path
--      already returns client_portal unstripped (ProjectContext.tsx:643
--      strips credentials for collaborators only), and the RPC returns the
--      fresh one — set it in local state and republish the snapshot / share
--      URL. Then "Regenerate link" = RPC → local state → republish.
-- (a) is only viable AFTER section 6 is applied: without it the first-enable
-- write always hits the mint branch, and there is no client token left to
-- mask the 42883.
--
-- Sub-portal links (sub_portal_links.access_token) need no RPC: the table is
-- owner-only under RLS with no freeze trigger on that column, so the app can
-- rotate with a plain UPDATE ... set access_token = <fresh>.
--
-- Idempotent: CREATE OR REPLACE throughout; grants restated.
-- ============================================================================

-- ── 1. token + enabled, expiry-agnostic (internal) ──────────────────────────
create or replace function public.portal_project_for_token_any(p_portal_id text, p_access_token text)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $fn$
  select id from public.projects
   where client_portal->>'portalId' = p_portal_id
     and coalesce((client_portal->>'enabled')::boolean, false) = true
     and coalesce(client_portal->>'accessToken','') <> ''
     and client_portal->>'accessToken' = p_access_token
   limit 1;
$fn$;

revoke execute on function public.portal_project_for_token_any(text, text) from public, anon, authenticated;
grant  execute on function public.portal_project_for_token_any(text, text) to service_role;

-- ── 2. the choke point: token + enabled + NOT expired ───────────────────────
create or replace function public.portal_project_for_token(p_portal_id text, p_access_token text)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $fn$
  select id from public.projects
   where client_portal->>'portalId' = p_portal_id
     and coalesce((client_portal->>'enabled')::boolean, false) = true
     and coalesce(client_portal->>'accessToken','') <> ''
     and client_portal->>'accessToken' = p_access_token
     -- AUTH-F7: a link the GC gave a lifetime is refused everywhere once it
     -- lapses. NULL expires_at = never expires (the pre-2026-08-26 default).
     and not exists (
       select 1 from public.portal_snapshots ps
        where ps.portal_id = p_portal_id
          and ps.expires_at is not null
          and ps.expires_at <= now()
     )
   limit 1;
$fn$;

revoke execute on function public.portal_project_for_token(text, text) from public, anon, authenticated;
grant  execute on function public.portal_project_for_token(text, text) to service_role;

-- ── 3. v2 keeps its "expired" envelope ──────────────────────────────────────
-- Body identical to 20260826190000 except that it authorises through the
-- expiry-agnostic helper, so an expired-but-valid token still gets
-- { status: 'expired', expiresAt } and the portal page renders its dated
-- "This link has expired" screen instead of the generic fallback.
create or replace function public.portal_get_snapshot_v2(p_portal_id text, p_access_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $fn$
declare
  v_pid uuid;
  v_snapshot jsonb;
  v_expires_at timestamptz;
  v_found boolean := false;
begin
  v_pid := public.portal_project_for_token_any(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  select ps.snapshot, ps.expires_at, true
    into v_snapshot, v_expires_at, v_found
    from public.portal_snapshots ps
   where ps.portal_id = p_portal_id
   limit 1;
  if not v_found then
    return jsonb_build_object('status', 'not_published');
  end if;
  if v_expires_at is not null and v_expires_at <= now() then
    return jsonb_build_object('status', 'expired', 'expiresAt', v_expires_at);
  end if;
  return jsonb_build_object(
    'status', 'ok',
    'snapshot', v_snapshot,
    'expiresAt', v_expires_at
  );
end; $fn$;

revoke execute on function public.portal_get_snapshot_v2(text, text) from public;
grant  execute on function public.portal_get_snapshot_v2(text, text) to anon, authenticated, service_role;

-- ── 4a. portal_sign_contract through the choke point ────────────────────────
create or replace function public.portal_sign_contract(p_portal_id text, p_contract_id uuid, p_signer_name text, p_passcode text DEFAULT NULL::text, p_access_token text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $fn$
declare v_project_id uuid; v_portal jsonb; v_status text;
begin
  -- AUTH-F7: token + enabled + expiry in one place. A NULL token cannot
  -- match, so the old `p_access_token is null` arm is covered.
  v_project_id := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_project_id is null then
    raise exception 'sign_denied';
  end if;
  select client_portal into v_portal from public.projects where id = v_project_id;

  if p_signer_name is null or length(btrim(p_signer_name)) < 3 then
    raise exception 'sign_denied';
  end if;

  if p_passcode is not null
     and coalesce(v_portal->>'passcode','') <> ''
     and p_passcode <> (v_portal->>'passcode') then
    raise exception 'sign_denied';
  end if;

  select status into v_status from public.project_contracts
   where id = p_contract_id and project_id = v_project_id limit 1;
  if v_status is null or v_status <> 'sent' then
    raise exception 'sign_denied';
  end if;

  update public.project_contracts
     set homeowner_signature = jsonb_build_object('name', btrim(p_signer_name), 'role','homeowner','signedAt', now()),
         status = 'signed', signed_at = now()
   where id = p_contract_id and project_id = v_project_id and status = 'sent';

  insert into public.portal_decision_audit(portal_id, project_id, action, detail)
    values (p_portal_id, v_project_id, 'sign',
            jsonb_build_object('contract', p_contract_id, 'signer', btrim(p_signer_name)));
  return jsonb_build_object('ok', true);
end; $fn$;

revoke execute on function public.portal_sign_contract(text, uuid, text, text, text) from public;
grant  execute on function public.portal_sign_contract(text, uuid, text, text, text) to anon, authenticated, service_role;

-- ── 4b. portal_choose_selection through the choke point ─────────────────────
create or replace function public.portal_choose_selection(p_portal_id text, p_category_id uuid, p_option_id uuid, p_access_token text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $fn$
declare v_project_id uuid;
begin
  -- AUTH-F7: token + enabled + expiry in one place.
  v_project_id := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_project_id is null then
    raise exception 'selection_denied';
  end if;

  if not exists (select 1 from public.selection_categories c
                  where c.id = p_category_id and c.project_id = v_project_id) then
    raise exception 'selection_denied';
  end if;
  if not exists (select 1 from public.selection_options
                  where id = p_option_id and category_id = p_category_id) then
    raise exception 'selection_denied';
  end if;

  update public.selection_options
     set is_chosen = false, chosen_at = null, chosen_by_role = null
   where category_id = p_category_id;
  update public.selection_options
     set is_chosen = true, chosen_at = now(), chosen_by_role = 'homeowner'
   where id = p_option_id and category_id = p_category_id;

  insert into public.portal_decision_audit(portal_id, project_id, action, detail)
    values (p_portal_id, v_project_id, 'selection',
            jsonb_build_object('category', p_category_id, 'option', p_option_id));
  return jsonb_build_object('ok', true);
end; $fn$;

revoke execute on function public.portal_choose_selection(text, uuid, uuid, text) from public;
grant  execute on function public.portal_choose_selection(text, uuid, uuid, text) to anon, authenticated, service_role;

-- ── 5. owner-only rotation (AUTH-F8) ────────────────────────────────────────
create or replace function public.portal_rotate_access_token(p_project_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $fn$
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
  -- Same answer for "not yours" and "does not exist": no oracle.
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'portal_rotate_denied' using errcode = '42501';
  end if;

  v_portal_id := v_portal->>'portalId';
  if v_portal is null or coalesce(v_portal_id, '') = '' then
    raise exception 'portal_rotate_no_portal';
  end if;

  -- 24 random bytes = 192 bits, the same strength as the trigger's own mint
  -- and the sub_portal_links default. pgcrypto lives in `extensions` here.
  v_new := encode(extensions.gen_random_bytes(24), 'hex');

  update public.projects
     set client_portal = client_portal || jsonb_build_object('accessToken', v_new)
   where id = p_project_id and user_id = auth.uid();

  -- Verify the write survived the BEFORE UPDATE triggers (see header).
  select client_portal->>'accessToken' into v_stored
    from public.projects where id = p_project_id;
  if v_stored is distinct from v_new then
    raise exception 'portal_rotate_failed: a trigger rewrote the token';
  end if;

  insert into public.portal_decision_audit(portal_id, project_id, action, detail)
    values (v_portal_id, p_project_id, 'token_rotated',
            jsonb_build_object('by', auth.uid(), 'at', now()));

  return v_new;
end; $fn$;

revoke execute on function public.portal_rotate_access_token(uuid) from public, anon;
grant  execute on function public.portal_rotate_access_token(uuid) to authenticated, service_role;

comment on function public.portal_rotate_access_token(uuid) is
  'Owner-only: mints and stores a fresh 192-bit client-portal access token and returns it (AUTH-F8, 20260904100800). The caller MUST replace clientPortal.accessToken in local state before the next project sync, or the old token is pushed back.';

-- ── 6. the trigger's mint branch ────────────────────────────────────────────
-- Body identical to schema.sql (portal_set_access_token) except that
-- gen_random_bytes is schema-qualified. search_path stays `pg_catalog,
-- public` on purpose — a narrow path is the point of setting one on a
-- trigger — so the qualified call is what makes the mint branch resolvable.
-- The trigger is SECURITY INVOKER; anon, authenticated and service_role all
-- hold USAGE on `extensions` and EXECUTE on gen_random_bytes ({=X}, read
-- live 2026-09-05), so the call resolves for every writer of projects.
-- CREATE OR REPLACE keeps the function's OID, so trg_portal_access_token
-- stays bound to it.
create or replace function public.portal_set_access_token()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $fn$
begin
  if new.client_portal is not null
     and new.client_portal ? 'portalId'
     and coalesce(new.client_portal->>'accessToken','') = '' then
    new.client_portal := new.client_portal || jsonb_build_object(
      'accessToken',
      coalesce(
        case when tg_op = 'UPDATE' then nullif(old.client_portal->>'accessToken','') else null end,
        encode(extensions.gen_random_bytes(24),'hex')));
  end if;
  return new;
end; $fn$;

-- ── Post-conditions ─────────────────────────────────────────────────────────
do $mig$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.portal_project_for_token(text,text)'::regprocedure);
  if position('expires_at' in v_def) = 0 then
    raise exception '[100800] portal_project_for_token carries no expiry clause';
  end if;
  v_def := pg_get_functiondef('public.portal_sign_contract(text,uuid,text,text,text)'::regprocedure);
  if position('portal_project_for_token(' in v_def) = 0 then
    raise exception '[100800] portal_sign_contract does not authorise through the choke point';
  end if;
  v_def := pg_get_functiondef('public.portal_choose_selection(text,uuid,uuid,text)'::regprocedure);
  if position('portal_project_for_token(' in v_def) = 0 then
    raise exception '[100800] portal_choose_selection does not authorise through the choke point';
  end if;
  if has_function_privilege('anon', 'public.portal_rotate_access_token(uuid)', 'EXECUTE') then
    raise exception '[100800] anon can execute portal_rotate_access_token';
  end if;
  if not has_function_privilege('authenticated', 'public.portal_rotate_access_token(uuid)', 'EXECUTE') then
    raise exception '[100800] authenticated cannot execute portal_rotate_access_token';
  end if;
  if has_function_privilege('anon', 'public.portal_project_for_token_any(text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_project_for_token(text,text)', 'EXECUTE') then
    raise exception '[100800] the token helpers must not be anon-executable';
  end if;
  if not has_function_privilege('anon', 'public.portal_get_snapshot_v2(text,text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.portal_sign_contract(text,uuid,text,text,text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.portal_choose_selection(text,uuid,uuid,text)', 'EXECUTE') then
    raise exception '[100800] a portal RPC lost its anon grant — the static portal would break';
  end if;
  -- Section 6: the trigger can actually mint.
  if to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception '[100800] extensions.gen_random_bytes(integer) is not installed — pgcrypto has moved; the trigger and the rotation RPC both qualify that schema';
  end if;
  v_def := pg_get_functiondef('public.portal_set_access_token()'::regprocedure);
  if position('extensions.gen_random_bytes' in v_def) = 0 then
    raise exception '[100800] portal_set_access_token still calls gen_random_bytes unqualified — its mint branch raises 42883 under search_path = pg_catalog, public';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_portal_access_token'
                    and tgrelid = 'public.projects'::regclass
                    and tgfoid = 'public.portal_set_access_token()'::regprocedure) then
    raise exception '[100800] trg_portal_access_token is not bound to portal_set_access_token on public.projects';
  end if;
  raise notice '[100800] portal expiry is enforced at the choke point; rotation RPC installed; trigger mint branch resolvable';
end
$mig$;
