-- ============================================================================
-- Function EXECUTE hygiene: default privileges + a reviewed grant matrix.
--
-- Audit IDs: DB-F9 (default privileges), DB-F8 / EDGE-F13 (cost_benchmark_stats),
--            DB-F13 / CONTRACT-F4 / AUTH-F15 (submit_sub_change_request),
--            02-security-database.md "Unauthenticated reach → RPC".
--
-- WHY. pg_default_acl (read live 2026-09-04) grants EXECUTE to anon and
-- authenticated on every function the `postgres` role creates in `public`:
--     {postgres=X,anon=X,authenticated=X,service_role=X}
-- so every SECURITY DEFINER helper is callable through PostgREST by anyone
-- holding the anon key that ships inside the app bundle, unless a migration
-- remembers to revoke it. That default is how grant_rfp_post_credit came back
-- (closed 09-02), how can_view_project_financials shipped on 09-03 with a
-- PUBLIC grant, and how portal_mark_item_viewed — a function with NO caller
-- check at all — has been forgeable since it was created: anyone with two
-- uuids can stamp "client viewed" on another tenant's invoice.
--
-- This migration (1) turns the default off at the root — globally, in
-- `public`, and in `storage`, which carries the same provisioning-time entry —
-- (2) applies a reviewed per-function matrix, (3) drops one dead function.
--
-- ── WORKFLOW CHANGE — READ BEFORE WRITING THE NEXT FUNCTION ─────────────────
-- After this file every NEW function in `public` is executable only by its
-- owner and service_role. A function the app or a static page must call
-- needs an explicit
--     grant execute on function public.f(...) to authenticated;   -- app
--     grant execute on function public.f(...) to anon, authenticated; -- token-gated portal/architect/prequal RPCs
-- Forgetting the grant fails loudly (42501 on first call) instead of silently
-- exposing the function. That is the intended trade.
--
-- CREATE OR REPLACE FUNCTION keeps an existing function's ACL (Postgres:
-- "the ownership and permissions of the function are not changed"), so the
-- default-privilege change does not touch existing grants by itself; the
-- targeted statements below do.
--
-- ── THE MATRIX (every non-trigger function anon could execute on 2026-09-04,
--    from pg_proc / has_function_privilege, decided one by one) ──────────────
--
-- KEEP anon + authenticated — a static page calls it with the anon key
-- (marketing/portal, marketing/sub-portal, marketing/architect) and/or the
-- body verifies a token / uuid before doing anything:
--   portal_get_snapshot            portal v1 fallback; token via portal_project_for_token
--   portal_get_snapshot_v2         portal; token
--   portal_get_messages            portal; token
--   portal_post_message            portal; token
--   portal_submit_budget_proposal  portal; token
--   portal_submit_co_approval      portal; token
--   portal_submit_co_approval_signed portal; token
--   portal_choose_selection        portal; token (choke point after 20260904100800)
--   portal_sign_contract           portal; token (choke point after 20260904100800)
--   sub_portal_get_snapshot        sub-portal page; sub_portal_links.access_token
--   sub_portal_submit_invoice      sub-portal page; access_token
--   get_rfi_by_token               architect page; rfis.share_token uuid
--   get_submittal_by_token         architect page; submittals.share_token uuid
--   submit_pro_response            architect page; share_token uuid
--   lookup_prequal_packet_by_token app/prequal-form.tsx runs for a sub with no
--                                  account (anon key); invite_token verified
--   submit_prequal_packet          same page; invite_token + expiry verified
--   fetch_shared_schedule          app/shared-schedule.tsx, anonymous viewer;
--                                  uuid snapshot id + 30-day expiry
--   public_cost_index              supabase/functions/public-cost-index calls it
--                                  WITH THE ANON KEY on purpose; opt-in filtered
--                                  and k-anonymised
--
-- REVOKE anon (keep authenticated) — the app calls it signed in; anonymously
-- it is either useless or a leak:
--   consume_rfp_post_credit        utils/clientPricing.ts; no-op without auth.uid()
--   cost_benchmark_stats           hooks/useCostBenchmark.ts:78 (signed in);
--                                  DB-F8 / EDGE-F13: the cost book's aggregate
--                                  was readable without an account. The
--                                  public_index_opt_in question is a product
--                                  call and is NOT changed here.
--   is_project_collaborator        RLS helper; every policy that calls it is
--   can_view_project_financials    TO authenticated, so anon never evaluates
--                                  them and the grant only served probing
--
-- REVOKE anon + authenticated (keep service_role) — no caller check in the
-- body, or the only callers are edge functions holding the service role:
--   portal_mark_item_viewed        only portal-mark-viewed (service role); DB-F9
--   gc_for_portal / gc_for_sub_portal  NO caller anywhere (repo grep 2026-09-05
--                                  over app/, utils/, hooks/, components/, lib/,
--                                  marketing/, supabase/functions/ — an earlier
--                                  draft of this line credited notify, which
--                                  does not call them). Anonymously: portal id →
--                                  GC uuid oracle. Locked to service_role rather
--                                  than dropped; a DROP is a separate decision
--   gc_user_for_company_slug       only public-lead-intake + widget-estimate
--                                  (service role); anonymously a uid-enumeration
--                                  primitive
--   is_published_portal / is_published_sub_portal  NO caller anywhere (repo grep
--                                  2026-09-04: two historical migrations and the
--                                  audit docs mention them, nothing calls them)
--   is_email_unsubscribed          SECURITY INVOKER; only _shared/email.ts, notify,
--                                  unsubscribe call it, all with the service role.
--                                  Under anon RLS it always answers "not
--                                  unsubscribed", so the grant was wrong AND useless
--
-- DROP:
--   submit_sub_change_request      references sub_portal_links.sub_portal_id and
--                                  .sub_name, neither of which exists (42703 on
--                                  every call); no caller in app/, utils/, hooks/,
--                                  marketing/, supabase/functions/. Anon-executable
--                                  and token-free — if someone "fixed" the column
--                                  it would become a token-bypassing write.
--                                  The orphan sub_change_requests TABLE is left in
--                                  place (CONTRACT-F5 lists it for the founder).
--
-- NOT TOUCHED:
--   fire_notify                    revoked by 20260904100000_notify_trigger_cron_secret.sql
--   trigger functions with =X      unreachable ("trigger functions can only be
--                                  called as triggers"); left alone
--   award_rfp, grant_rfp_post_credit, get_portal_snapshot (legacy),
--   get_sub_portal_snapshot, match_project_memory, portal_project_for_token,
--   rate_limit_increment, verify_cron_secret, ai_*  — already locked
--   can_access_project (both overloads) — already authenticated + service_role
--
-- Idempotent: REVOKE / GRANT / DROP IF EXISTS are repeatable; a function that
-- does not exist in the target database is skipped with a NOTICE.
-- ============================================================================


-- ── 1. Turn the default off at the root (DB-F9) ─────────────────────────────
-- Functions this role creates in `public` from now on start with
-- {owner=X, service_role=X} and nothing else.
--
-- TWO STATEMENTS, AND THE ORDER OF EXPLANATION MATTERS. Postgres computes a
-- new function's ACL as: the hard-wired default ({=X, owner=X} — PUBLIC may
-- execute) — REPLACED by a GLOBAL pg_default_acl entry if one exists — then
-- MERGED with the per-schema entry (get_user_default_acl, aclchk.c). A
-- per-schema REVOKE therefore cannot take away what the hard-wired default
-- gives: it can only undo a previous per-schema GRANT. That is exactly what
-- the docs say ("you cannot revoke privileges per-schema if they are granted
-- globally, either by default or …") and it was PROVEN on 2026-09-04 by
-- applying an earlier draft of this file to a scratch Postgres loaded from
-- schema.sql: the per-schema revoke alone left every new function with
-- `=X/postgres`. So:
--   (a) the GLOBAL form removes PUBLIC's hard-wired EXECUTE;
--   (b) the per-schema form removes the anon/authenticated grants that
--       Supabase's provisioning added per schema.
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- The global form also covers functions postgres creates in `extensions`
-- (a `create extension … with schema extensions` run from the dashboard).
-- Extension functions are meant to be callable by everyone, so give that
-- schema its PUBLIC default back explicitly. Per-schema grants merge on top
-- of the global entry, which is the one direction that does work.
alter default privileges for role postgres in schema extensions
  grant execute on functions to public;

-- `storage` carries the same provisioning-time per-schema entry for postgres
-- ({anon,authenticated,service_role}=X on functions — pg_default_acl read
-- live 2026-09-05). Nothing of ours lives there: postgres owns 0 functions in
-- storage and has no CREATE on the schema (owner supabase_admin), so the
-- entry is inert today. It is revoked anyway so that if postgres ever gains
-- CREATE there — a helper for a storage policy is the obvious candidate — a
-- new function starts out {owner, service_role}, the same trade as `public`.
-- The statement itself does not need CREATE on the schema: Postgres accepts
-- ALTER DEFAULT PRIVILEGES … IN SCHEMA for a target role without it (proven
-- on 15.x in a scratch Postgres 2026-09-05; production is 17.6).
alter default privileges for role postgres in schema storage
  revoke execute on functions from public, anon, authenticated;

-- The same default exists for supabase_admin (Supabase's own provisioning
-- role). Changing another role's defaults requires membership of that role;
-- `postgres` is not a member (verified live: pg_has_role = false), so this is
-- attempted and reported rather than allowed to abort the migration. Every
-- application function is owned by `postgres`, so the postgres entry above is
-- the one that matters.
do $mig$
begin
  execute 'alter default privileges for role supabase_admin '
       || 'revoke execute on functions from public, anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public '
       || 'revoke execute on functions from public, anon, authenticated';
  raise notice '[100200] supabase_admin default EXECUTE revoked';
exception when insufficient_privilege then
  raise notice '[100200] cannot alter supabase_admin defaults as % (not a member); '
               'application functions are owned by postgres, whose default is fixed above',
               current_user;
end
$mig$;


-- ── 2. service_role only ────────────────────────────────────────────────────
do $mig$
declare
  f text;
  fns text[] := array[
    'public.portal_mark_item_viewed(text,text,text,timestamptz)',
    'public.gc_for_portal(text)',
    'public.gc_for_sub_portal(text)',
    'public.gc_user_for_company_slug(text)',
    'public.is_published_portal(text)',
    'public.is_published_sub_portal(text)',
    'public.is_email_unsubscribed(text,text)'
  ];
begin
  foreach f in array fns loop
    if to_regprocedure(f) is null then
      raise notice '[100200] % not present — skipped', f;
      continue;
    end if;
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$mig$;


-- ── 3. authenticated only (the app calls these signed in) ───────────────────
do $mig$
declare
  f text;
  fns text[] := array[
    'public.consume_rfp_post_credit()',
    'public.cost_benchmark_stats(text,text,text)',
    'public.is_project_collaborator(uuid,text)',
    'public.can_view_project_financials(uuid)'
  ];
begin
  foreach f in array fns loop
    if to_regprocedure(f) is null then
      raise notice '[100200] % not present — skipped', f;
      continue;
    end if;
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$mig$;


-- ── 4. anon + authenticated, made EXPLICIT ──────────────────────────────────
-- Fourteen of these carried the bare PUBLIC grant (`=X`). PUBLIC includes
-- every role in the cluster; the grant is rewritten as the two roles that
-- actually need it so the ACL says what it means.
do $mig$
declare
  f text;
  fns text[] := array[
    'public.portal_get_snapshot(text,text)',
    'public.portal_get_snapshot_v2(text,text)',
    'public.portal_get_messages(text,text)',
    'public.portal_post_message(text,text,text,text)',
    'public.portal_submit_budget_proposal(text,text,numeric,text,text)',
    'public.portal_submit_co_approval(text,text,text,text,text,text,text)',
    'public.portal_submit_co_approval_signed(text,text,text,text,text,text,text,text,text,text,text,text,boolean)',
    'public.portal_choose_selection(text,uuid,uuid,text)',
    'public.portal_sign_contract(text,uuid,text,text,text)',
    'public.sub_portal_get_snapshot(text,text)',
    'public.sub_portal_submit_invoice(text,text,text,numeric,numeric,text,jsonb,text,text,text)',
    'public.get_rfi_by_token(uuid)',
    'public.get_submittal_by_token(uuid)',
    'public.submit_pro_response(uuid,text,text,text,text,text,text)',
    'public.lookup_prequal_packet_by_token(text)',
    'public.submit_prequal_packet(text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,text,text)',
    'public.fetch_shared_schedule(uuid)',
    'public.public_cost_index(text,text,text)'
  ];
begin
  foreach f in array fns loop
    if to_regprocedure(f) is null then
      raise notice '[100200] % not present — skipped', f;
      continue;
    end if;
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end
$mig$;


-- ── 5. the dead, broken, anon-executable RPC (DB-F13 / CONTRACT-F4) ─────────
drop function if exists public.submit_sub_change_request(text, text, numeric, integer, jsonb, text);


-- ── 6. Post-conditions — fail loudly if the matrix did not land ─────────────
do $mig$
declare
  f text;
  must_not_anon text[] := array[
    'public.portal_mark_item_viewed(text,text,text,timestamptz)',
    'public.gc_for_portal(text)',
    'public.gc_user_for_company_slug(text)',
    'public.cost_benchmark_stats(text,text,text)',
    'public.consume_rfp_post_credit()'
  ];
  must_not_authenticated text[] := array[
    'public.portal_mark_item_viewed(text,text,text,timestamptz)',
    'public.gc_for_portal(text)',
    'public.gc_user_for_company_slug(text)'
  ];
  must_anon text[] := array[
    'public.portal_get_snapshot_v2(text,text)',
    'public.sub_portal_get_snapshot(text,text)',
    'public.get_rfi_by_token(uuid)'
  ];
begin
  foreach f in array must_not_anon loop
    if to_regprocedure(f) is not null and has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '[100200] anon can still execute %', f;
    end if;
  end loop;
  foreach f in array must_not_authenticated loop
    if to_regprocedure(f) is not null and has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '[100200] authenticated can still execute %', f;
    end if;
  end loop;
  foreach f in array must_anon loop
    if to_regprocedure(f) is not null and not has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '[100200] anon lost EXECUTE on % — the static portal/architect pages would break', f;
    end if;
  end loop;
  if to_regprocedure('public.submit_sub_change_request(text,text,numeric,integer,jsonb,text)') is not null then
    raise exception '[100200] submit_sub_change_request still exists';
  end if;

  -- The default itself, tested the only way that cannot lie: create a
  -- throwaway function under the new defaults and read its ACL. Printing
  -- pg_default_acl would have passed the per-schema-only draft of this file.
  execute 'create function public.__acl_probe_100200() returns int language sql as $p$ select 1 $p$';
  begin
    if has_function_privilege('anon', 'public.__acl_probe_100200()', 'EXECUTE') then
      raise exception '[100200] a NEW function is still anon-executable — the default did not change';
    end if;
    if has_function_privilege('authenticated', 'public.__acl_probe_100200()', 'EXECUTE') then
      raise exception '[100200] a NEW function is still authenticated-executable — the default did not change';
    end if;
    if not has_function_privilege('service_role', 'public.__acl_probe_100200()', 'EXECUTE') then
      raise exception '[100200] a NEW function lost service_role EXECUTE — edge functions would break';
    end if;
    -- grantee 0 is PUBLIC in aclexplode(); a substring test on the ACL text
    -- would also match the owner's own `postgres=X` entry.
    if exists (
      select 1 from pg_proc p, aclexplode(p.proacl) a
       where p.oid = 'public.__acl_probe_100200()'::regprocedure
         and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      raise exception '[100200] a NEW function still carries the bare PUBLIC grant (=X)';
    end if;
  exception when others then
    execute 'drop function if exists public.__acl_probe_100200()';
    raise;
  end;
  execute 'drop function public.__acl_probe_100200()';

  -- storage: read the per-schema entry itself. In production postgres cannot
  -- create a probe function there (no CREATE on the schema), and the
  -- per-schema entry is exactly what the statement above rewrites, so the
  -- row is a faithful witness here; the global interplay that made reading
  -- pg_default_acl insufficient for `public` is already covered by the probe
  -- function above.
  if exists (
    select 1
      from pg_default_acl d
      join pg_roles r on r.oid = d.defaclrole
      join pg_namespace n on n.oid = d.defaclnamespace,
           aclexplode(d.defaclacl) a
     where r.rolname = 'postgres' and n.nspname = 'storage' and d.defaclobjtype = 'f'
       and a.privilege_type = 'EXECUTE'
       and (a.grantee = 0
            or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))
  ) then
    raise exception '[100200] postgres''s default EXECUTE in schema storage still reaches PUBLIC / anon / authenticated';
  end if;
  -- Where a probe IS possible (a scratch database, or a future production
  -- where postgres has CREATE on storage), test it the way that cannot lie.
  if has_schema_privilege(current_user, 'storage', 'CREATE') then
    execute 'create function storage.__acl_probe_100200() returns int language sql as $p$ select 1 $p$';
    begin
      if has_function_privilege('anon', 'storage.__acl_probe_100200()', 'EXECUTE')
         or has_function_privilege('authenticated', 'storage.__acl_probe_100200()', 'EXECUTE') then
        raise exception '[100200] a NEW function in storage is still anon/authenticated-executable';
      end if;
      if not has_function_privilege('service_role', 'storage.__acl_probe_100200()', 'EXECUTE') then
        raise exception '[100200] a NEW function in storage lost service_role EXECUTE';
      end if;
    exception when others then
      execute 'drop function if exists storage.__acl_probe_100200()';
      raise;
    end;
    execute 'drop function storage.__acl_probe_100200()';
  else
    raise notice '[100200] % has no CREATE on schema storage — the storage default is inert and was verified from pg_default_acl only', current_user;
  end if;
  raise notice '[100200] post-conditions hold: new functions default to {owner, service_role} only (public and storage)';
end
$mig$;
