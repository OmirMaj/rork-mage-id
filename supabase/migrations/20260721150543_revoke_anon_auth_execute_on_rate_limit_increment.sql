-- Follow-up to 20260721150432: that migration revoked from PUBLIC, but
-- rate_limit_increment carries EXPLICIT anon=X + authenticated=X grants
-- (acl: postgres=X | anon=X | authenticated=X | service_role=X), so anon could
-- still execute it (verified: anon POST /rpc/rate_limit_increment returned 200).
--
-- APPLIED TO PROD 2026-07-21 via MCP apply_migration (ledger 20260721150543).
-- Repo record only — do NOT `supabase db push`.
--
-- It is server-only — called solely by edge functions (notify, auth-magic-link,
-- _shared/auth.ts) via service_role; no client code references it. Revoke the
-- explicit anon + authenticated grants so an unauthenticated attacker can no longer
-- inflate a victim's rate-limit counter to lock them out of login / their portal.
-- Post-fix: anon POST /rpc/rate_limit_increment -> HTTP 401 permission denied;
-- service_role retains its explicit grant (edge-function rate limiting unaffected).
revoke execute on function public.rate_limit_increment(text) from anon;
revoke execute on function public.rate_limit_increment(text) from authenticated;
