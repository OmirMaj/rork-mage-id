-- drop_portal_snapshots_anon_read — the cutover step that closes the
-- portal_snapshots PII-enumeration hole.
--
-- Pending until: every static portal page (homeowner + sub) is updated
-- to call the RPC functions added in lockdown_portal_snapshots_rls.sql.
--
-- Steps before running this:
--   1. Verify the static portal HTML deployed on Vercel / Netlify /
--      whatever host is now using
--        supabase.rpc('get_portal_snapshot', { portal_id_in: id })
--      instead of
--        supabase.from('portal_snapshots').select('snapshot').eq('portal_id', id).single()
--   2. Same swap for sub_portal_snapshots → get_sub_portal_snapshot.
--   3. Wait at least 7 days from CDN deploy so caches fully flush.
--   4. Test: open a portal URL, confirm snapshot loads. Open another
--      portal URL on a different project, confirm THAT snapshot loads.
--      Then open the second URL while signed in to the first project's
--      account — confirm you only see what the URL grants.
--
-- After all four are green, MOVE this file into supabase/migrations/
-- and apply.

DROP POLICY IF EXISTS portal_snapshots_anon_read ON public.portal_snapshots;
DROP POLICY IF EXISTS sub_portal_snapshots_anon_read ON public.sub_portal_snapshots;

-- Authenticated read policies are preserved — those are scoped to the
-- GC themselves and only used for in-app preview / debug.

COMMENT ON TABLE public.portal_snapshots IS
  'Homeowner portal snapshots. Read via get_portal_snapshot(portal_id) RPC '
  '(bearer-token semantics enforced server-side). Direct anon SELECT was '
  'removed in drop_portal_snapshots_anon_read.sql.';

COMMENT ON TABLE public.sub_portal_snapshots IS
  'Sub portal snapshots. Read via get_sub_portal_snapshot(sub_portal_id) RPC. '
  'Direct anon SELECT removed.';
