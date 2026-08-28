-- ============================================================================
-- The 'field' collaborator role — server side.
--
-- WHY. 20260803140000_collaborator_rls_field_tables.sql shipped collaborator
-- RLS for field tables only and said so in its own header:
--
--     "Financial tables … are INTENTIONALLY NOT INCLUDED. There is currently
--      no role that separates field access from financial access … it should
--      be unlocked by a real 'field' role rather than by widening 'editor'."
--
-- This is that role. A foreman or sub gets the operational job — schedule,
-- daily reports, photos, RFIs, punch, time — and never the money.
--
-- ── THE BLOCKER THIS FIXES ──────────────────────────────────────────────────
-- The client already ships a 'field' option in the invite UI (utils/
-- roleBlinding.ts, CollaboratorsManager). It could not work: role carries
-- CHECK (role in ('owner','editor','viewer')), so every field invite was
-- rejected by the database, and the project-invite edge function rejected it
-- again with a 400. Both are fixed here / alongside.
--
-- ── ROLE TIERS ──────────────────────────────────────────────────────────────
-- can_access_project(pid, min_role) gains a middle tier:
--
--     'editor'  → owner, editor            (unchanged — real editing)
--     'field'   → owner, editor, field     (NEW — logging field work)
--     'viewer'  → any accepted collaborator (default, unchanged)
--
-- Field-table WRITE policies move from the 'editor' tier to the 'field' tier.
-- Without that a foreman could open a daily report and not save it, which is
-- the entire point of the role.
--
-- ── WHAT THIS DOES **NOT** FIX — READ THIS ──────────────────────────────────
-- Financial TABLES are already safe. Verified against live pg_policies on
-- 2026-08-26: invoices, change_orders, commitments, aia_pay_apps, lien_waivers,
-- draw_periods and wip_periods are ALL owner-only (auth.uid() = user_id). No
-- collaborator of any role — including editor and viewer — can read them.
--
-- The residual leak is the projects ROW. Field users need projects.schedule,
-- and projects_select is `auth.uid() = user_id OR is_project_collaborator(id)`,
-- so a field collaborator can read the whole row — including the financial
-- jsonb columns estimate, linked_estimate, target_budget, estimate_versions.
--
-- Postgres RLS is ROW-level. It cannot blind columns, and column GRANTs apply
-- per database role (every app user is `authenticated`), so they cannot
-- distinguish one collaborator from another. Closing this needs EITHER:
--   (a) splitting those jsonb columns into a project_financials table with its
--       own owner+editor policy, or
--   (b) denying field users projects_select and serving them a safe view.
-- Both change the core project read path and are a founder decision, tracked
-- in docs/audits/2026-08-26-moat-fixes.md.
--
-- Until then: the client blinds financials for field users (utils/roleBlinding,
-- fails closed), which stops the in-app case. A field user who bypasses the app
-- and calls PostgREST directly with their own token can still read those
-- columns. That is the honest boundary today.
--
-- WRITE access to projects is NOT affected: projects_update already requires
-- the 'editor' tier, so a field user cannot overwrite the estimate jsonb.
--
-- Idempotent throughout.
-- ============================================================================

-- ── 1. Allow the role to exist ──────────────────────────────────────────────
alter table public.project_collaborators
  drop constraint if exists project_collaborators_role_check;
alter table public.project_collaborators
  add constraint project_collaborators_role_check
  check (role in ('owner','editor','viewer','field'));

-- ── 2. Teach the access helpers the new tier ────────────────────────────────
create or replace function public.can_access_project(pid uuid, min_role text default 'viewer')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- the project owner
    exists (
      select 1 from public.projects p
      where p.id = pid and p.user_id = auth.uid()
    )
    -- …or an accepted collaborator at or above the required tier
    or exists (
      select 1 from public.project_collaborators pc
      where pc.project_id = pid
        and pc.user_id = auth.uid()
        and pc.status = 'accepted'
        and case min_role
              when 'editor' then pc.role in ('owner','editor')
              -- 'field' = may log field work. Deliberately EXCLUDES 'viewer':
              -- a viewer is read-only by definition, so letting them write
              -- field data here would silently widen that role.
              when 'field'  then pc.role in ('owner','editor','field')
              else true
            end
    );
$$;

-- TEXT overload. time_entries.project_id and field_tickets.project_id are TEXT,
-- not uuid, so policies on those tables resolve to this signature. It exists in
-- production but was created OUT OF BAND — no migration in this repo declares
-- it, which the 2026-08-26 migration-history audit surfaced. Without it, this
-- file (and 20260803140000) raise 42883 on those two tables when replayed into
-- a FRESH database, because Postgres has no implicit text->uuid cast.
--
-- Declared here so the repo is self-sufficient. It is a thin delegating wrapper:
-- it casts and forwards, so the 'field' tier added above flows through it
-- automatically and the two signatures can never disagree.
create or replace function public.can_access_project(pid text, min_role text default 'viewer')
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare u uuid;
begin
  begin u := pid::uuid; exception when others then return false; end;
  return public.can_access_project(u, min_role);
end;
$$;

create or replace function public.is_project_collaborator(pid uuid, min_role text default 'viewer')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_collaborators pc
    where pc.project_id = pid
      and pc.user_id = auth.uid()
      and pc.status = 'accepted'
      and case min_role
            when 'editor' then pc.role in ('owner','editor')
            when 'field'  then pc.role in ('owner','editor','field')
            else true
          end
  );
$$;

-- ── 3. Let field users actually SAVE field work ─────────────────────────────
-- Move INSERT/UPDATE on the field tables from the 'editor' tier to 'field'.
-- SELECT already uses the default (any accepted collaborator) and is unchanged.
do $$
declare
  t text;
  -- ALL 12 tables that actually carry *_collab_* policies in production,
  -- verified against pg_policies on 2026-08-26. The first draft listed only 8
  -- and silently left drawing_pins, plan_markups, plan_calibrations and
  -- field_tickets on the 'editor' tier — a foreman would have been unable to
  -- drop a plan pin or file a field ticket, which is most of the job.
  field_tables text[] := array[
    'daily_reports','photos','punch_items','rfis','submittals',
    'permits','plan_sheets','time_entries',
    'drawing_pins','plan_markups','plan_calibrations','field_tickets'
  ];
begin
  foreach t in array field_tables loop
    -- Skip cleanly if a table isn't present in this environment.
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I', t || '_collab_insert', t);
    execute format($f$
      create policy %1$I on public.%2$I
        for insert to authenticated
        with check (
          auth.uid() = user_id
          and public.can_access_project(project_id, 'field')
        );
    $f$, t || '_collab_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_collab_update', t);
    execute format($f$
      create policy %1$I on public.%2$I
        for update to authenticated
        using      (public.can_access_project(project_id, 'field'))
        with check (public.can_access_project(project_id, 'field'));
    $f$, t || '_collab_update', t);
  end loop;
end $$;

comment on constraint project_collaborators_role_check on public.project_collaborators is
  'owner|editor|viewer|field. field = operational access (schedule, daily reports, photos, RFIs, punch, time) with financials blinded client-side; see 20260826130000_field_role.sql for the residual projects-row caveat.';
