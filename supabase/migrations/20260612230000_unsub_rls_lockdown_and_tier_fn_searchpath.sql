-- SECURITY hardening (audit follow-up, round 2). Applied to prod via MCP;
-- this file is the record.
--
-- 1) Pin search_path on enforce_subscription_tier_authority(). This BEFORE
--    trigger pins subscriptions.tier (the server-authoritative-tier fix in
--    20260612200844). It was added AFTER the first pin migration
--    (20260612210000) and so still tripped function_search_path_mutable. The
--    body only references auth.role() (schema-qualified) + NEW/OLD, so pinning
--    is non-breaking.
alter function public.enforce_subscription_tier_authority()
  set search_path = pg_catalog, public;

-- 2) Lock down email_unsubscribes. It carried two always-true policies for the
--    anon + authenticated roles:
--      email_unsubscribes_insert_anyone  WITH CHECK (true)
--      email_unsubscribes_select_anyone  USING (true)
--    The public anon key ships in the app bundle AND the marketing
--    preferences/unsubscribe pages, so both were directly reachable:
--      - INSERT(true): anyone could POST /rest/v1/email_unsubscribes with
--        {email:<victim>, event_key:null} to globally suppress an arbitrary
--        address's mail — the TABLE-LEVEL twin of the global-suppression hole
--        closed in the `unsubscribe` edge function (which now requires a signed
--        token). The table path bypassed that fix entirely.
--      - SELECT(true): anyone could GET /rest/v1/email_unsubscribes and dump
--        every email address that ever unsubscribed (PII leak).
--    Every legitimate read/write already flows through the `unsubscribe` edge
--    function and the `is_email_unsubscribed` RPC, both of which use the SERVICE
--    ROLE (bypasses RLS). The app and both marketing pages call the edge
--    function, never the table directly (verified by grep). Dropping these
--    policies leaves RLS enabled with no anon/authenticated grant => deny-all
--    for the public roles; the service role is unaffected.
drop policy if exists email_unsubscribes_insert_anyone on public.email_unsubscribes;
drop policy if exists email_unsubscribes_select_anyone on public.email_unsubscribes;
