-- SECURITY hardening (audit follow-up): pin search_path on the 8 functions
-- flagged function_search_path_mutable. Prevents a caller prepending a malicious
-- schema to shadow unqualified references (matters most for the SECURITY DEFINER
-- notify triggers). Bodies already qualify cross-schema refs (net.http_post,
-- private.cron_auth), so this is non-breaking. Applied to prod via MCP.

alter function public.time_entries_set_updated_at() set search_path = pg_catalog, public;
alter function public.set_updated_at() set search_path = pg_catalog, public;
alter function public.portal_set_access_token() set search_path = pg_catalog, public;
alter function public.is_email_unsubscribed(text, text) set search_path = pg_catalog, public;
alter function public.notify_portal_message_fn() set search_path = pg_catalog, public;
alter function public.notify_budget_proposal_fn() set search_path = pg_catalog, public;
alter function public.notify_sub_invoice_fn() set search_path = pg_catalog, public;
alter function public.public_bids_notify_nearby_fn() set search_path = pg_catalog, public;
