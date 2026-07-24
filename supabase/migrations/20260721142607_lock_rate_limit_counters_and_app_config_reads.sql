-- Lock two server-only operational tables that were world-readable via a
-- `FOR SELECT using(true)` policy. Found by the 2026-07-21 anon-probe sweep
-- (docs/security/2026-07-21-anon-read-audit.md).
--
-- APPLIED TO PROD 2026-07-21 via Supabase MCP apply_migration (ledger version
-- 20260721142607). Repo record only — do NOT `supabase db push`.
--
-- rate_limit_counters.scope embeds magic-link requester EMAILS + IP addresses and
-- portal ids (verified live: an anon REST GET returned rows with scopes like
-- 'magiclink:email:…' and 'magiclink:ip:<ipv4>'). Any unauthenticated caller could
-- harvest them — a low/medium privacy leak that grows with usage.
--
-- app_config holds server-side config (edge-fn URLs today; an empty 'notify_key'
-- secret slot tomorrow). Neither table is read by any client/authenticated path:
-- rate limiting goes through the rate_limit_increment RPC and notifications through
-- notify/index.ts, BOTH using the service_role key (which bypasses RLS). Removing
-- anon/authenticated read is therefore transparent to them. Post-fix: anon REST
-- read of either table returns HTTP 401 "permission denied".
drop policy if exists rate_limit_counters_select   on public.rate_limit_counters;
drop policy if exists app_config_read_authenticated on public.app_config;
revoke select on public.rate_limit_counters from anon, authenticated;
revoke select on public.app_config          from anon, authenticated;
