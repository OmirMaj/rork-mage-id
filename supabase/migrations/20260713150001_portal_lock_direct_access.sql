-- 20260713150001_portal_lock_direct_access.sql  (PART 2 of 2 — BREAKING)
--
-- ⚠️ COORDINATED DEPLOY ONLY. Apply this in the SAME WINDOW as the portal +
-- sub-portal HTML redeploy (marketing/portal/index.html, marketing/sub-portal/
-- index.html). It removes the anon direct table access that the OLD HTML used;
-- the NEW HTML reads/writes through the PART 1 token-gated RPCs instead. Applying
-- this WITHOUT the HTML deploy will break every live client portal.
--
-- The authenticated GC app is UNAFFECTED: its owner-scoped policies
-- (portal_snapshots_owner_write / "gc reads own …") remain intact.

-- Revoke the OLD tokenless snapshot RPCs from anon/authenticated (a bypass — they
-- return the snapshot given only the guessable portalId). Nothing legitimate calls
-- them (the old HTML used direct REST; the new HTML uses portal_get_snapshot).
revoke execute on function public.get_portal_snapshot(text)     from anon, authenticated;
revoke execute on function public.get_sub_portal_snapshot(text) from anon, authenticated;

-- Reads: drop the USING(true) anon/authed SELECT policies + revoke the base anon
-- SELECT grant. The GC's own reads survive via the owner-scoped *_owner_write ALL
-- policies; anon now reads only via the token-gated portal_get_snapshot RPC.
drop policy if exists portal_snapshots_anon_read       on public.portal_snapshots;
drop policy if exists portal_snapshots_authed_read     on public.portal_snapshots;
drop policy if exists sub_portal_snapshots_anon_read   on public.sub_portal_snapshots;
drop policy if exists sub_portal_snapshots_authed_read on public.sub_portal_snapshots;
revoke select on public.portal_snapshots     from anon;
revoke select on public.sub_portal_snapshots from anon;

-- Writes: drop the anon INSERT policies (portalId-only forgery) + revoke the base
-- anon INSERT grants. Homeowner/sub now write via the PART 1 token-gated RPCs.
-- The GC's own insert/update policies ("gc …", *_owner_write) are untouched.
drop policy if exists "client submits CO approvals"            on public.change_order_approvals;
drop policy if exists "client posts messages to known portals"  on public.portal_messages;
drop policy if exists "portal can submit proposals"            on public.portal_budget_proposals;
drop policy if exists "subs submit invoices to known portals"   on public.sub_submitted_invoices;
revoke insert on public.change_order_approvals from anon;
revoke insert on public.portal_messages        from anon;
revoke insert on public.portal_budget_proposals from anon;
revoke insert on public.sub_submitted_invoices from anon;
