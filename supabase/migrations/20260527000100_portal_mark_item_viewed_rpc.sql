-- 20260527000100_portal_mark_item_viewed_rpc.sql
-- SECURITY DEFINER RPC called by the portal-mark-viewed edge fn (service
-- role). Writes portal_state.viewedAt across 9 item tables uniformly via
-- a table-name allowlist + format(). Only sets viewedAt when currently
-- null (first-view-only).
--
-- viewedAt key uses camelCase to match all other portal_state / jsonb
-- conventions in this codebase (see 20260523120000_portal_access_token.sql:
-- accessToken, portalId, signedAt).

create or replace function public.portal_mark_item_viewed(
  p_table_name text,
  p_item_id    text,
  p_project_id text,
  p_now        timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q text;
begin
  -- Table-name allowlist — prevents SQL injection via format()'s %I path
  -- placeholder. Only these 9 tables can be updated through this RPC.
  if p_table_name not in (
    'change_orders','invoices','aia_pay_apps','rfis','submittals',
    'daily_reports','photos','selection_categories','warranties'
  ) then
    raise exception 'invalid table %', p_table_name;
  end if;

  q := format($q$
    update public.%I
    set portal_state = jsonb_set(
      coalesce(portal_state, '{}'::jsonb),
      '{viewedAt}',
      to_jsonb(%L::timestamptz),
      true
    )
    where id::text = %L
      and project_id::text = %L
      and (portal_state is null
           or not (portal_state ? 'viewedAt')
           or portal_state->>'viewedAt' is null)
  $q$, p_table_name, p_now, p_item_id, p_project_id);
  execute q;
end $$;

-- Service-role-only grant: the edge fn calls via service role key.
-- Anon/authenticated callers have no path to this function.
grant execute on function public.portal_mark_item_viewed(text, text, text, timestamptz)
  to service_role;
