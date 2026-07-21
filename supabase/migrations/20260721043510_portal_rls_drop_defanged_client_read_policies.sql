-- Portal RLS hygiene (docs/security/2026-07-13-portal-rls-exposure.md, "Part A").
--
-- APPLIED TO PROD 2026-07-21 via Supabase MCP apply_migration (ledger version
-- 20260721043510). This file is the repo record — do NOT `supabase db push`
-- (divergent history; prod is managed via MCP apply_migration).
--
-- These {public} "client read when portal enabled" policies LOOK like an anon
-- cross-tenant leak, but were DEFANGED in production: their USING clause is
-- EXISTS(SELECT 1 FROM projects ... enabled), and that subquery runs under the
-- caller's RLS on `projects`. Anon cannot read `projects`, so the EXISTS is
-- always false and anon got zero rows (verified 2026-07-21 via live anon REST:
-- GET /project_contracts, /selection_categories, /selection_options,
-- /closeout_binders all returned content-range */0 BEFORE this migration).
--
-- Removed as defense-in-depth, NOT to close an active leak: the portal reads
-- these tables ONLY through the portal_get_snapshot SECURITY DEFINER RPC
-- (verified: no direct REST select in marketing/portal/index.html), and GC
-- owners keep full access via the *_gc_* policies. Dropping them removes a
-- latent footgun — a future anon-readable `projects` policy would otherwise
-- silently turn these into real contract/signature/IP cross-tenant leaks.
drop policy if exists contracts_client_select on public.project_contracts;
drop policy if exists selcat_client_select    on public.selection_categories;
drop policy if exists selopt_client_select    on public.selection_options;
drop policy if exists cb_client_read          on public.closeout_binders;

-- Revoke the now-unused anon table-level SELECT (belt-and-suspenders; the portal
-- uses SECURITY DEFINER RPCs, GC uses the authenticated role — neither needs
-- this). After this, an anon REST read returns HTTP 401 "permission denied".
revoke select on public.project_contracts    from anon;
revoke select on public.selection_categories from anon;
revoke select on public.selection_options    from anon;
revoke select on public.closeout_binders     from anon;
