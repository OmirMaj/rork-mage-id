-- ============================================================================
-- project_financials — PHASE 2: drop the legacy money columns off projects.
--
-- THIS is the migration that actually closes the field-role leak. Until it
-- runs, a field collaborator can still read estimate / linked_estimate /
-- estimate_versions / target_budget straight off the projects row, because
-- projects_select lets them see the row at all (they need projects.schedule).
--
-- ── DO NOT APPLY THIS UNTIL ALL OF THESE ARE TRUE ───────────────────────────
--   1. 20260826140000_project_financials_split.sql has been applied
--   2. the OTA carrying the project_financials read/write path is LIVE
--   3. you have opened the app and confirmed estimates/budgets still render
--
-- Applying it against an OLDER build is the failure mode this phasing exists
-- to prevent: that build reads projects.estimate, finds nothing, and renders
-- every estimate as empty — indistinguishable from data loss to the user.
--
-- ── SAFETY NET ──────────────────────────────────────────────────────────────
-- The guard below REFUSES to drop anything if a project still carries money
-- that never made it into project_financials. Better to fail loudly and be
-- re-run after a backfill than to drop a column that was the only copy.
-- ============================================================================

do $$
declare
  orphaned bigint;
begin
  select count(*) into orphaned
  from public.projects p
  where (p.estimate is not null
      or p.linked_estimate is not null
      or p.estimate_versions is not null
      or p.target_budget is not null)
    and not exists (
      select 1 from public.project_financials f where f.project_id = p.id
    );

  if orphaned > 0 then
    raise exception
      'REFUSING TO DROP: % project(s) still hold financial data with no project_financials row. Re-run the backfill in 20260826140000_project_financials_split.sql first.', orphaned;
  end if;
end $$;

-- Top up anything the app wrote to projects after the phase-1 backfill ran
-- (i.e. an older build still dual-writing, or writing only the legacy path).
insert into public.project_financials
  (project_id, user_id, estimate, linked_estimate, estimate_versions, target_budget, created_at, updated_at)
select p.id, p.user_id, p.estimate, p.linked_estimate, p.estimate_versions, p.target_budget,
       coalesce(p.created_at, now()), coalesce(p.updated_at, now())
from public.projects p
where p.estimate is not null
   or p.linked_estimate is not null
   or p.estimate_versions is not null
   or p.target_budget is not null
on conflict (project_id) do update set
  -- Only fill columns that are still empty on the new table. Never overwrite a
  -- value the new client already wrote with a staler legacy one.
  estimate          = coalesce(public.project_financials.estimate,          excluded.estimate),
  linked_estimate   = coalesce(public.project_financials.linked_estimate,   excluded.linked_estimate),
  estimate_versions = coalesce(public.project_financials.estimate_versions, excluded.estimate_versions),
  target_budget     = coalesce(public.project_financials.target_budget,     excluded.target_budget),
  updated_at        = now();

alter table public.projects drop column if exists estimate;
alter table public.projects drop column if exists linked_estimate;
alter table public.projects drop column if exists estimate_versions;
alter table public.projects drop column if exists target_budget;
