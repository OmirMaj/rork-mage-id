-- inspect-triggers.sql
--
-- Run this in the Supabase dashboard SQL Editor to verify which notify
-- triggers are actually deployed in your DB. Compare the output against
-- the triggers defined in `supabase/migrations/notify_triggers.sql`.
--
-- Why this exists: pre-audit (May 2026), source comments referenced
-- triggers like `public_bids_notify_nearby` and `notify_portal_message`
-- but no migration ever defined them. They may have been hand-created in
-- the dashboard (and are therefore live but invisible to source control)
-- or never created at all (in which case the homeowner-RFP fan-out path
-- is silently broken). This script tells you which.
--
-- Usage:
--   1. Open Supabase dashboard → SQL Editor → New Query
--   2. Paste this entire file
--   3. Run
--   4. Compare results against the table at the bottom of this file

-- ── 1. Triggers on the relevant tables ──────────────────────────────
SELECT
  event_object_schema || '.' || event_object_table AS target_table,
  trigger_name,
  action_timing || ' ' || event_manipulation AS fires_when,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND (
    event_object_table IN (
      'public_bids', 'portal_messages', 'budget_proposals',
      'change_orders', 'sub_invoices', 'subcontractor_invoices'
    )
    OR trigger_name LIKE 'notify_%'
    OR trigger_name LIKE '%_notify_%'
  )
ORDER BY target_table, trigger_name;

-- ── 2. Existence of helper trigger functions ────────────────────────
SELECT
  n.nspname || '.' || p.proname AS function_name,
  pg_get_function_result(p.oid) AS returns,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'fire_notify',
    'public_bids_notify_nearby_fn',
    'notify_portal_message_fn',
    'notify_budget_proposal_fn',
    'notify_co_approval_fn',
    'notify_sub_invoice_fn'
  )
ORDER BY p.proname;

-- ── 3. Tables referenced by the migration — confirm they exist ──────
SELECT
  table_name,
  CASE
    WHEN to_regclass('public.' || table_name) IS NOT NULL THEN '✅ exists'
    ELSE '❌ MISSING'
  END AS status
FROM (VALUES
  ('public_bids'),
  ('portal_messages'),
  ('budget_proposals'),
  ('change_orders'),
  ('sub_invoices'),
  ('subcontractor_invoices'),
  ('invoices')
) t(table_name);

-- ── 4. Cron jobs registered in pg_cron ──────────────────────────────
-- Confirms which scheduled functions are running. After applying
-- supabase/migrations/schedule_all_crons.sql you should see all 6:
-- daily-digest + coi-expiry-watch + fetch-external-data + geocode-bids +
-- homeowner-weekly-digest + morning-digest.
SELECT jobid, schedule, jobname, active
FROM cron.job
ORDER BY jobname;

-- ────────────────────────────────────────────────────────────────────
-- INTERPRETATION GUIDE
-- ────────────────────────────────────────────────────────────────────
--
-- Section 1 (triggers):
--   Expect these rows after running notify_triggers.sql migration:
--     public_bids        public_bids_notify_nearby   AFTER INSERT
--     portal_messages    notify_portal_message       AFTER INSERT     (only if table exists)
--     budget_proposals   notify_budget_proposal      AFTER INSERT     (only if table exists)
--     change_orders      notify_co_approval          AFTER UPDATE     (only if table exists)
--     sub_invoices       notify_sub_invoice          AFTER INSERT     (only if table exists)
--   If any row is missing, re-run the migration. If a `RAISE NOTICE`
--   says a table is missing, your schema uses a different name (e.g.
--   `subcontractor_invoices` instead of `sub_invoices`) — adjust the
--   migration's table name and re-run.
--
-- Section 2 (functions):
--   Expect:
--     fire_notify                    SECURITY DEFINER  (already there from earlier migration)
--     public_bids_notify_nearby_fn   SECURITY DEFINER  (added by notify_triggers.sql)
--     notify_portal_message_fn       SECURITY DEFINER  (added)
--     notify_budget_proposal_fn      SECURITY DEFINER  (added)
--     notify_co_approval_fn          SECURITY DEFINER  (added)
--     notify_sub_invoice_fn          SECURITY DEFINER  (added)
--
-- Section 3 (tables):
--   Use this to figure out which trigger statements actually fired vs.
--   skipped. Anything ❌ MISSING means the trigger was skipped — not a
--   bug if your schema doesn't use that table.
--
-- Section 4 (cron):
--   After schedule_all_crons.sql you should see 6 active jobs. If the
--   count is lower, re-run that migration.
--
-- ────────────────────────────────────────────────────────────────────
