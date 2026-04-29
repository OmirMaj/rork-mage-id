-- Grant EXECUTE on fire_notify() to anon + authenticated.
--
-- Several AFTER-INSERT triggers — notify_portal_message, notify_budget_proposal,
-- notify_co_approval, notify_sub_invoice, public_bids_notify_nearby — call
-- fire_notify() to fan out a webhook on user actions that come from the
-- homeowner portal / sub portal (anon) and the GC's app (authenticated).
--
-- The trigger functions themselves are SECURITY INVOKER (they keep the
-- caller's identity so RLS still applies on row reads inside the trigger).
-- That means the caller — anon or authenticated — must hold EXECUTE on
-- fire_notify, or the entire INSERT fails with 42501 "permission denied
-- for function fire_notify".
--
-- fire_notify itself is SECURITY DEFINER and only POSTs to the configured
-- notify_url with the configured notify_key. It does not expose any data
-- the caller couldn't already write, so granting EXECUTE here is safe.
--
-- Symptom this fixes: "Couldn't reach the server" alert in the homeowner
-- portal when the client tries to send a message.

grant execute on function public.fire_notify(text, text, text, jsonb)
  to anon, authenticated;
