-- Persist the daily-report incident (OSHA/safety) and per-task work-progress
-- fields that the app already writes to local storage but silently dropped on
-- the Supabase round-trip (they had no columns). jsonb, nullable, idempotent.
--
-- Applied to prod (nteoqhcswappxxjlpvap) 2026-07-14 via Supabase MCP
-- apply_migration (name: daily_reports_incident_workprogress). This file is the
-- committed record of that change; do NOT `supabase db push` (history diverged).
alter table public.daily_reports
  add column if not exists incident jsonb,
  add column if not exists work_progress jsonb;
