-- CONFIRMED LIVE (2026-07-21): anon could execute these SECURITY DEFINER AI-usage
-- RPCs with an arbitrary p_user_id (verified: anon POST /rpc/ai_daily_usage_get
-- returned HTTP 200). Their pin is v_uid := COALESCE(auth.uid(), p_user_id); for an
-- anon caller auth.uid() is null, so p_user_id is honored — letting an
-- unauthenticated attacker EXHAUST any user's AI quota (DoS) via ai_usage_increment
-- and READ any user's usage via the _get/_summary variants.
--
-- APPLIED TO PROD 2026-07-21 via MCP apply_migration (ledger 20260721150148).
-- Repo record only — do NOT `supabase db push`.
--
-- The 2026-07-14 migration `revoke_anon_ai_usage_rpcs` tried to fix this but ran
-- `REVOKE EXECUTE ... FROM anon` while EXECUTE was still granted to PUBLIC (the
-- Postgres default for functions), so anon kept access via PUBLIC. Revoke from
-- PUBLIC — removes anon while leaving the explicit authenticated + service_role
-- grants intact (the edge `ai` fn calls these via service_role; the pin keeps
-- authenticated-direct calls scoped to the caller's own uid). Post-fix: anon
-- POST /rpc/ai_usage_increment -> HTTP 401 permission denied.
revoke execute on function public.ai_daily_usage_get(uuid) from public;
revoke execute on function public.ai_daily_usage_increment(uuid, text) from public;
revoke execute on function public.ai_usage_daily_get(uuid, text) from public;
revoke execute on function public.ai_usage_daily_increment(uuid, text) from public;
revoke execute on function public.ai_usage_get(uuid, text) from public;
revoke execute on function public.ai_usage_increment(uuid, text, integer) from public;
revoke execute on function public.ai_usage_summary(uuid) from public;
