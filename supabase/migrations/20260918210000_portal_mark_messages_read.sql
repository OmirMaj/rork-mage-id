-- Portal read receipts for the CLIENT side (audit round 2, notifications-email
-- handoff 6).
--
-- notify's portal_reply batching skips an email when this address was emailed
-- about this portal in the last 15 minutes AND that message is still unread in
-- the portal (portal_messages.read_by_client). Nothing ever set read_by_client
-- on a GC message — the portal page reads the thread through the token RPC
-- portal_get_messages, which is STABLE and writes nothing — so every GC message
-- stayed "unread" forever and the batching was a plain 15-minute throttle: a
-- client who had already read the first reply was not emailed about the second.
--
-- This RPC is the write half. Same gate as portal_get_messages (the portal id
-- + its access token, resolved by portal_project_for_token, which also honours
-- expiry and rotation), and it can only ever flip read_by_client on the GC's
-- messages of THAT portal to true. It returns the number of rows it marked.
-- The portal page calls it after it paints a live thread.

create or replace function public.portal_mark_messages_read(p_portal_id text, p_access_token text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_pid uuid; v_n integer;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  update public.portal_messages m
     set read_by_client = true
   where m.portal_id = p_portal_id
     and m.author_type = 'gc'
     and m.read_by_client is not true;
  get diagnostics v_n = row_count;
  return v_n;
end; $function$;

-- Same ACL as the other portal token RPCs (20260904100200 §4): no bare PUBLIC.
revoke execute on function public.portal_mark_messages_read(text, text) from public;
grant execute on function public.portal_mark_messages_read(text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

-- Verify after apply:
--   select has_function_privilege('anon', 'public.portal_mark_messages_read(text,text)', 'execute');  -- true
--   select proacl from pg_proc where proname = 'portal_mark_messages_read';  -- no '=X/' (PUBLIC) entry
