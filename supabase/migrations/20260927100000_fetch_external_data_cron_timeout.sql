-- 20260927100000_fetch_external_data_cron_timeout.sql
--
-- SUPA-H1 (health lane NOTIFYOPS, 2026-09-27).
--
-- The fetch-external-data cron job called net.http_post with no
-- timeout_milliseconds, so pg_net used its 5 s default. The function takes
-- 8-16 s (SAM.gov pages + Adzuna + the weekly Places sweep), and
-- net._http_response recorded 'Timeout of 5000 ms reached' (2026-09-26 22:00):
-- the caller gave up before the answer, so nothing on the database side ever
-- saw whether a run succeeded.
--
-- This re-schedules the SAME job name and schedule with the SAME body as the
-- live job (read from cron.job on 2026-09-27; it matches
-- 20260523130000_cron_secret_guard.sql byte for byte: the service-role key is
-- read with current_setting and the cron secret from private.cron_auth, no
-- literal secret anywhere) and adds timeout_milliseconds := 30000.
--
-- Idempotent: cron.schedule on an existing jobname updates that job in place
-- (pg_cron >= 1.3), so running this twice leaves one job.

select cron.schedule('fetch-external-data-schedule', '0 6,12,18,22 * * *', $j$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/fetch-external-data',
    headers := jsonb_build_object(
      'Authorization','Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type','application/json',
      'x-cron-secret',(select secret from private.cron_auth limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$j$);
