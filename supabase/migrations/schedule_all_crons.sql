-- Schedule the rest of the cron-driven edge functions.
--
-- Pre-audit (May 2026), only daily-digest had a real cron migration. Five
-- other functions (coi-expiry-watch, fetch-external-data, geocode-bids,
-- homeowner-weekly-digest, morning-digest) carried "scheduled by cron"
-- claims in their source comments but no migration ever scheduled them.
-- Without this file, those features are silently broken — the homeowner
-- weekly digest, the morning briefing email, the COI-expiry watcher, the
-- bid feed sync, and the bid-geocoder all just don't run.
--
-- All schedules are idempotent — they unschedule the named job first, then
-- re-create it. Re-running this migration is safe.
--
-- All schedules POST to the matching edge function with an empty body. The
-- functions deploy with verify_jwt = false (or do their own header check)
-- so they accept the unauthenticated cron call. Each function is itself
-- idempotent (checks notification_outbox or its own dedupe table) so a
-- duplicate cron fire won't double-send.
--
-- Requires:
--   - pg_cron extension (Supabase Pro+)
--   - pg_net extension (default)

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── helper: unschedule then re-schedule ────────────────────────────────
-- Wrapped in a DO block per job so that a missing prior job doesn't fail
-- the whole migration (cron.unschedule throws on unknown name).

-- 1. coi-expiry-watch — daily at 14:00 UTC (9 AM EST). Emails GCs whose
--    sub COIs expire within 30 days. Idempotent via per-sub-per-day key.
DO $$ BEGIN PERFORM cron.unschedule('coi-expiry-watch'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'coi-expiry-watch',
  '0 14 * * *',
  $cronbody$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/coi-expiry-watch',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cronbody$
);

-- 2. fetch-external-data — every 6 hours. Pulls federal/state/private
--    bid feeds into the cached_bids table. The function comment claims
--    "4×/day" so 6h cadence matches.
DO $$ BEGIN PERFORM cron.unschedule('fetch-external-data'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'fetch-external-data',
  '0 */6 * * *',
  $cronbody$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/fetch-external-data',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cronbody$
);

-- 3. geocode-bids — every hour. Backfills lat/lng on cached_bids rows
--    that have an address but no coords yet. Cheap, idempotent.
DO $$ BEGIN PERFORM cron.unschedule('geocode-bids'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'geocode-bids',
  '15 * * * *',
  $cronbody$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/geocode-bids',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cronbody$
);

-- 4. homeowner-weekly-digest — Fridays at 16:00 UTC (11 AM EST / 8 AM
--    PST). Emails homeowners a weekly project recap. Function dedupes
--    against notification_outbox so a duplicate Friday fire is safe.
DO $$ BEGIN PERFORM cron.unschedule('homeowner-weekly-digest'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'homeowner-weekly-digest',
  '0 16 * * 5',
  $cronbody$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/homeowner-weekly-digest',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"all": true}'::jsonb,
    timeout_milliseconds := 90000
  );
  $cronbody$
);

-- 5. morning-digest — every 30 minutes. The function itself looks at each
--    user's preferred local-time slot (e.g. 7:30 AM in their timezone) and
--    only sends when the current 30-min window matches. Heavy fan-out is
--    inside the function; cron just keeps the heartbeat going.
DO $$ BEGIN PERFORM cron.unschedule('morning-digest'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'morning-digest',
  '*/30 * * * *',
  $cronbody$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/morning-digest',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cronbody$
);

-- 6. invoice-dunning — daily at 15:00 UTC (10 AM EST). Emails the project
--    client an escalating reminder on each overdue, still-owed invoice.
--    Idempotent via per-invoice dunning_stage; empty body = process all.
DO $$ BEGIN PERFORM cron.unschedule('invoice-dunning'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'invoice-dunning',
  '0 15 * * *',
  $cronbody$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/invoice-dunning',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cronbody$
);

-- 7. qbo-reconciler — every 30 min. Re-pushes stuck invoices and pulls
--    QBO payment state back into MAGE (with voided-invoice guard).
DO $$ BEGIN PERFORM cron.unschedule('qbo-reconciler-every-30m'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
select cron.schedule('qbo-reconciler-every-30m', '*/30 * * * *', $j$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/qbo-reconciler',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select secret from private.cron_auth limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$j$);
