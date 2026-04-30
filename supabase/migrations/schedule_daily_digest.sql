-- Schedule daily-digest at 13:00 UTC = 8 AM EST / 5 AM PST. Most US
-- contractors are EST/CST so the digest lands just before the workday
-- starts. The edge function is idempotent (won't re-send a digest
-- already sent today, queries notification_outbox for the marker row),
-- so cron retries are safe.
--
-- Why no auth header: the function is deployed with verify_jwt = false
-- and only does idempotent good — fires opt-in digest emails. Worst
-- case an external caller triggers it once a day; the idempotency
-- guard prevents duplicate sends. Adding a shared-secret header is
-- defense in depth that we can layer in later if abuse appears.
--
-- Requires:
--   - pg_cron extension (Supabase Pro+)
--   - pg_net extension (default)

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Make this migration idempotent — unschedule first if the job already
-- exists, then re-schedule.
DO $$
BEGIN
  PERFORM cron.unschedule('daily-digest');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'daily-digest',
  '0 13 * * *',
  $cronbody$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/daily-digest',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cronbody$
);
