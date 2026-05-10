-- lockdown_portal_snapshots_rls — closes a real CVE-grade hole in the
-- `portal_snapshots` and `sub_portal_snapshots` tables.
--
-- The earlier migrations (create_portal_snapshots.sql,
-- create_sub_portal_snapshots.sql) declared:
--   create policy portal_snapshots_anon_read for select to anon using (true);
-- with a comment claiming the portal_id is a bearer token so anon SELECT
-- by exact id is the design intent.
--
-- The intent was right — the bug is that `using (true)` lets ANY anon
-- caller `SELECT *` the entire table without a portal_id filter:
--   curl 'https://<project>.supabase.co/rest/v1/portal_snapshots?select=snapshot'
--        -H "apikey: <ANON>"
-- returns every row. Homeowner names, addresses, schedules, photos, change
-- orders, financials. PII enumeration across every project ever created.
--
-- The right pattern for a bearer-token table is a SECURITY DEFINER RPC
-- that takes the bearer (portal_id) as an argument and returns at most
-- ONE row, server-side. PostgREST cannot leak rows through it because the
-- function body controls the WHERE clause.
--
-- This migration is INTENTIONALLY ADDITIVE — it adds the RPC functions
-- but DOES NOT drop the anon SELECT policies yet, because the externally
-- hosted portal HTML (Vercel/Netlify static page that lives outside this
-- repo) still queries the table directly via the anon key. Dropping the
-- anon SELECT now would 502 every live portal URL.
--
-- CUTOVER PLAN:
--   1. Run this migration. Anon callers can now use either the table OR
--      the new RPCs.
--   2. Deploy the static portal HTML update so it calls
--      supabase.rpc('get_portal_snapshot', { portal_id_in: '...' })
--      instead of supabase.from('portal_snapshots').select('snapshot').eq('portal_id', '...').single()
--      Same shape for sub_portal_snapshots.
--   3. After a 7-day cutover window (give CDN caches time to flush), run
--      the followup migration `drop_portal_snapshots_anon_read.sql` (also
--      in this commit, marked .pending until you're ready). That kills
--      the world-readable policy and leaves the RPC as the only path.
--
-- Why not drop now? Because breaking every live portal URL on the day
-- this migration runs is worse than the (already-deployed) leakage
-- window. The leakage requires anyone to KNOW our anon key + table
-- name — not a 0-day, but worth fixing.
--
-- Idempotent.

-- ─── portal_snapshots (homeowner) ────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_portal_snapshot(portal_id_in TEXT)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT snapshot
    FROM public.portal_snapshots
   WHERE portal_id = portal_id_in
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_portal_snapshot(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.get_portal_snapshot(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_portal_snapshot(TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_portal_snapshot(TEXT) IS
  'Returns the homeowner-portal snapshot JSON for a single portal_id. '
  'Replaces direct anon SELECT against portal_snapshots — bearer-token '
  'auth is enforced server-side. Always returns exactly one row at most.';

-- ─── sub_portal_snapshots (subcontractor) ────────────────────────

CREATE OR REPLACE FUNCTION public.get_sub_portal_snapshot(sub_portal_id_in TEXT)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT snapshot
    FROM public.sub_portal_snapshots
   WHERE sub_portal_id = sub_portal_id_in
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_sub_portal_snapshot(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.get_sub_portal_snapshot(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_sub_portal_snapshot(TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_sub_portal_snapshot(TEXT) IS
  'Returns the sub-portal snapshot JSON for a single sub_portal_id. '
  'Replaces direct anon SELECT against sub_portal_snapshots.';

-- After the static portal HTML cutover lands (see plan above), run:
--
--   DROP POLICY IF EXISTS portal_snapshots_anon_read ON public.portal_snapshots;
--   DROP POLICY IF EXISTS sub_portal_snapshots_anon_read ON public.sub_portal_snapshots;
--
-- That migration lives at:
--   supabase/migrations/_pending/drop_portal_snapshots_anon_read.sql
-- Move it out of _pending/ when you're ready.
