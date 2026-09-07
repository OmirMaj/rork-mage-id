-- ============================================================================
-- qbo_connections: no client access at all.
--
-- Audit ID: DB-F10.
--
-- WHY. qbo_connections holds the QuickBooks OAuth access_token and
-- refresh_token in clear text. The policy
--     qbo_connections_owner FOR ALL TO public USING (auth.uid() = user_id)
-- let a user read their own row through PostgREST with their own JWT — which
-- means a stolen or XSS-exposed session on app.mageid.app could issue
--     GET /rest/v1/qbo_connections?select=realm_id,access_token,refresh_token
-- and walk away with a long-lived refresh token for the contractor's books.
--
-- No client code needs the table (grep of app/ hooks/ contexts/ utils/
-- components/ lib/ on 2026-09-04: zero references). The only readers and
-- writers are edge functions — qbo-connect-callback, qbo-reconciler,
-- _shared/qbo.ts — and they use the service role, which bypasses RLS.
--
-- Two locks, deliberately redundant:
--   1. drop the policy — with RLS enabled and no policy, every non-bypass
--      role sees nothing;
--   2. revoke the table grants from anon/authenticated — so a future
--      "helpful" policy cannot reopen the tokens without a grant as well.
--
-- If the app ever needs connection STATUS, expose a view without the token
-- columns and grant that instead.
--
-- Idempotent.
-- ============================================================================

drop policy if exists qbo_connections_owner on public.qbo_connections;

alter table public.qbo_connections enable row level security;

revoke all on table public.qbo_connections from public, anon, authenticated;

comment on table public.qbo_connections is
  'QuickBooks OAuth grant per user. Service-role only: no RLS policy and no anon/authenticated grant (DB-F10, 20260904100300). Tokens are secrets, not user data.';

do $mig$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'qbo_connections';
  if n > 0 then
    raise exception '[100300] qbo_connections still has % policy(ies)', n;
  end if;
  if has_table_privilege('authenticated', 'public.qbo_connections', 'SELECT') then
    raise exception '[100300] authenticated still holds SELECT on qbo_connections';
  end if;
  raise notice '[100300] qbo_connections is service-role only';
end
$mig$;
