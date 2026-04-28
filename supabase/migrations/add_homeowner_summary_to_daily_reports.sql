-- Add homeowner-friendly summary columns to daily_reports.
--
-- The GC writes a technical daily report; we run an AI generator over
-- the manpower / work / weather / issues fields to produce a 2-4
-- sentence narrative the homeowner can actually read. The GC reviews,
-- can edit, then flips homeowner_summary_published=true to push it to
-- the portal as the "Latest update" panel.
--
-- Idempotent — safe to run multiple times.

alter table public.daily_reports
  add column if not exists homeowner_summary text,
  add column if not exists homeowner_summary_generated_at timestamptz,
  add column if not exists homeowner_summary_published boolean not null default false;

-- Optional: a partial index so the portal-snapshot lookup ("most recent
-- published summary for this project") stays fast even with thousands
-- of historical reports per project.
create index if not exists daily_reports_published_summary_idx
  on public.daily_reports (project_id, date desc)
  where homeowner_summary_published = true;
