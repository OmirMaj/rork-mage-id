-- ============================================================================
-- project_financials — take the money off the projects row.
--
-- WHY. 20260826130000_field_role.sql shipped the 'field' collaborator role but
-- documented a residual leak it could not close:
--
--     Field users need projects.schedule, and projects_select is
--     `auth.uid() = user_id OR is_project_collaborator(id)`, so a field
--     collaborator can read the WHOLE row — including estimate,
--     linked_estimate, target_budget, estimate_versions.
--
-- Postgres RLS is ROW-level; it cannot blind columns, and column GRANTs apply
-- per database role (every app user is `authenticated`). The only real fix is
-- to stop storing the money on a row that field users are allowed to read.
-- This is that split.
--
-- ── PHASE 1 OF 2. THIS MIGRATION DOES NOT YET CLOSE THE LEAK. ───────────────
-- It creates the table, backfills it, and locks it down — but deliberately
-- LEAVES the four legacy columns on projects so an older build that still
-- reads them keeps working. A client that reads projects.estimate and finds
-- the column gone would render every estimate as blank, which looks exactly
-- like data loss.
--
-- Sequence:
--   1. apply THIS migration              (table exists, backfilled, secured)
--   2. ship the OTA                      (client reads/writes the new table)
--   3. verify on device
--   4. apply ..._project_financials_drop_legacy.sql  → LEAK ACTUALLY CLOSES
--
-- Until step 4, the client dual-writes both places so either build is correct
-- and step 4 stays a safe, boring column drop.
--
-- ── WHO CAN SEE MONEY ───────────────────────────────────────────────────────
-- SELECT  owner, editor, viewer      (a viewer is read-only but DOES see
--                                     financials — that is the role's point)
-- WRITE   owner, editor              (mirrors projects_update)
-- DELETE  owner
-- 'field' appears in none of them. That is the whole exercise.
--
-- `scope` is deliberately NOT moved: scope-of-work is operational, and the
-- field crew needs it.
--
-- Idempotent throughout.
-- ============================================================================

create table if not exists public.project_financials (
  project_id        uuid primary key references public.projects(id) on delete cascade,
  -- Mirrors projects.user_id so the owner check never has to join.
  user_id           uuid not null references auth.users(id) on delete cascade,
  estimate          jsonb,
  linked_estimate   jsonb,
  estimate_versions jsonb,
  target_budget     jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists project_financials_user_id_idx
  on public.project_financials (user_id);

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Only rows that actually carry money. ON CONFLICT DO NOTHING so re-running
-- never clobbers data the app has already written to the new table.
insert into public.project_financials
  (project_id, user_id, estimate, linked_estimate, estimate_versions, target_budget, created_at, updated_at)
select p.id, p.user_id, p.estimate, p.linked_estimate, p.estimate_versions, p.target_budget,
       coalesce(p.created_at, now()), coalesce(p.updated_at, now())
from public.projects p
where p.estimate is not null
   or p.linked_estimate is not null
   or p.estimate_versions is not null
   or p.target_budget is not null
on conflict (project_id) do nothing;

-- ── Who may see the money ───────────────────────────────────────────────────
-- Everything EXCEPT 'field'. Kept as its own function (rather than reusing
-- can_access_project) because this is a different question — "may see money"
-- is not a rung on the edit ladder, and folding it in would make a future
-- widening of the ladder silently widen financial access too.
create or replace function public.can_view_project_financials(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.projects p
      where p.id = pid and p.user_id = auth.uid()
    )
    or exists (
      select 1 from public.project_collaborators pc
      where pc.project_id = pid
        and pc.user_id = auth.uid()
        and pc.status = 'accepted'
        and pc.role in ('owner','editor','viewer')   -- 'field' excluded
    );
$$;

alter table public.project_financials enable row level security;

drop policy if exists project_financials_select on public.project_financials;
create policy project_financials_select on public.project_financials
  for select to authenticated
  using (public.can_view_project_financials(project_id));

drop policy if exists project_financials_insert on public.project_financials;
create policy project_financials_insert on public.project_financials
  for insert to authenticated
  with check (public.can_access_project(project_id, 'editor'));

drop policy if exists project_financials_update on public.project_financials;
create policy project_financials_update on public.project_financials
  for update to authenticated
  using      (public.can_access_project(project_id, 'editor'))
  with check (public.can_access_project(project_id, 'editor'));

drop policy if exists project_financials_delete on public.project_financials;
create policy project_financials_delete on public.project_financials
  for delete to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
  );

comment on table public.project_financials is
  'Money split off the projects row so field collaborators cannot read it (RLS is row-level and cannot blind columns). SELECT = owner/editor/viewer; field excluded. See 20260826140000_project_financials_split.sql.';
