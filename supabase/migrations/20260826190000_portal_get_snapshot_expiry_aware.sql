-- portal_get_snapshot_v2 — an expiry-aware read for the homeowner portal.
--
-- WHY. 20260826170000 gave portal_snapshots an `expires_at`, and
-- app/client-portal-setup.tsx writes it on every publish — but NOTHING on the
-- read side ever looks at it. portal_get_snapshot (20260713150000) selects the
-- `snapshot` column and returns it, full stop. So today a "7-day link" keeps
-- serving content forever: the GC picks a lifetime, the UI tells them the link
-- lapsed, the cron emails them that it lapsed, and the link still opens. The
-- expiry feature is, at the read boundary, decorative.
--
-- It also means a caller cannot TELL an expired link from a wrong one. Both
-- come back as "nothing here", so the portal has to guess, and guessing wrong
-- is how a missing row ends up being reported to a homeowner as "expired" (and
-- vice versa). The whole point of distinguishing the two is that they have
-- different next steps.
--
-- ── WHY A NEW FUNCTION INSTEAD OF EDITING portal_get_snapshot ────────────────
-- marketing/portal/index.html calls portal_get_snapshot by name. Changing that
-- function's return shape in place would break every live browser portal the
-- instant this migration lands, unless the HTML ships in the same window —
-- exactly the coordinated-deploy trap documented at the top of
-- 20260713150001_portal_lock_direct_access.sql. This migration is therefore
-- purely ADDITIVE: a new function, a new grant, nothing dropped or altered. The
-- old RPC keeps working unchanged for the HTML portal; callers move over one at
-- a time. (Follow-up: point the browser portal at v2 and retire v1.)
--
-- Token gate is identical to v1 — portal_project_for_token checks the 192-bit
-- client_portal.accessToken and that the portal is enabled. Expiry is checked
-- AFTER the token, so this cannot be used to probe which portalIds exist.
--
-- Reverse path:
--   drop function if exists public.portal_get_snapshot_v2(text, text);

create or replace function public.portal_get_snapshot_v2(p_portal_id text, p_access_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_pid uuid;
  v_snapshot jsonb;
  v_expires_at timestamptz;
  v_found boolean := false;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;

  select ps.snapshot, ps.expires_at, true
    into v_snapshot, v_expires_at, v_found
    from public.portal_snapshots ps
   where ps.portal_id = p_portal_id
   limit 1;

  -- Token is good and the portal is live, but the GC has never published to it.
  -- Distinct from "expired" and distinct from "denied": the homeowner's next
  -- step is to wait, not to ask for a new link.
  if not v_found then
    return jsonb_build_object('status', 'not_published');
  end if;

  -- NULL expires_at means "never expires" and is the majority state (every row
  -- predating the expiry migration keeps it). Only a real deadline in the past
  -- withholds the payload — and it MUST withhold it, or "expired" is just a
  -- label on content we handed over anyway.
  if v_expires_at is not null and v_expires_at <= now() then
    return jsonb_build_object('status', 'expired', 'expiresAt', v_expires_at);
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'snapshot', v_snapshot,
    'expiresAt', v_expires_at
  );
end; $$;

grant execute on function public.portal_get_snapshot_v2(text, text) to anon, authenticated;
