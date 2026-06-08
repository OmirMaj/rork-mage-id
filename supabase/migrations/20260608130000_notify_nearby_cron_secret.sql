-- Gate notify-nearby-contractors behind the cron shared secret.
--
-- SECURITY FIX (Medium). The public_bids AFTER INSERT trigger
-- (public_bids_notify_nearby_fn) POSTed to the notify-nearby-contractors edge
-- function with NO auth header, so the function — which fans push + email to the
-- ENTIRE matched contractor network — was reachable by anyone who could reach
-- the URL, and it trusted the caller-supplied `record` (forge title/scope/budget
-- → phishing blast).
--
-- Fix: send the same 256-bit x-cron-secret the cron jobs use (stored in
-- private.cron_auth by 20260523130000_cron_secret_guard), and pass only the row
-- id. The edge function now requires that secret (isValidCron) and re-reads the
-- authoritative RFP row from the DB by id.
--
-- SECURITY DEFINER (unchanged) lets the trigger read private.cron_auth.

create or replace function public.public_bids_notify_nearby_fn()
returns trigger
language plpgsql
security definer
as $body$
begin
  -- Only fire for homeowner RFPs. Public/govt bids come in via the
  -- fetch-external-data cron and don't need a near-me fan-out.
  if NEW.is_homeowner_rfp is not true then
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/notify-nearby-contractors',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select secret from private.cron_auth limit 1)
    ),
    -- Only the id — the function re-reads the authoritative row itself.
    body := jsonb_build_object('record', jsonb_build_object('id', NEW.id)),
    timeout_milliseconds := 30000
  );
  return NEW;
end;
$body$;
