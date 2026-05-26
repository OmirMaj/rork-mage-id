-- 20260526120200_qbo_reconciler_cron.sql
-- Schedule qbo-reconciler every 30 minutes. Uses the existing cron-secret
-- pattern from 20260523130000_cron_secret_guard.sql — cron.schedule upserts
-- by jobname, and the secret subquery runs each fire.

select cron.schedule('qbo-reconciler-every-30m', '*/30 * * * *', $j$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/qbo-reconciler',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select secret from private.cron_auth limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$j$);
