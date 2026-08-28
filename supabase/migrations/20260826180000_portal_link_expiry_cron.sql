-- Schedule the portal-link expiry watcher.
--
-- WHY. A client portal link is the GC's face to their customer. When it lapses
-- the person who discovers it is the CLIENT — they tap a link from an email,
-- hit a wall, and have to chase the contractor. The GC learns their portal is
-- broken through an irritated customer, which is the worst possible channel.
--
-- This warns the GC while the link still works (3 days out) and again once it
-- has lapsed, so they can re-share first. Mirrors coi-expiry-watch, which does
-- the same job for insurance certificates.
--
-- TWICE DAILY, not hourly: the notice is "your link expires in 3 days", not a
-- real-time signal. The function's own 20-hour per-portal cooldown means the
-- second run is almost always a no-op — it exists so a GC who publishes a
-- short-lived link in the afternoon is still caught the same day.
--
-- Sends the shared cron secret in x-cron-secret; the function validates it via
-- verify_cron_secret() (see supabase/functions/_shared/cronAuth.ts) so the
-- secret value never leaves the database. There is deliberately NO
-- authenticated-user path on this function: a user-triggered run would fan out
-- across every GC's portals.
--
-- cron.schedule upserts by jobname, so re-running this migration is safe.

select cron.schedule('portal-link-expiry-notice-am', '0 14 * * *', $j$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/portal-link-expiry-notice',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select secret from private.cron_auth limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$j$);

select cron.schedule('portal-link-expiry-notice-pm', '0 22 * * *', $j$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/portal-link-expiry-notice',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select secret from private.cron_auth limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$j$);
