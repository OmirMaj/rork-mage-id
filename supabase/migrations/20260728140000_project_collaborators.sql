-- Live Schedule Collaboration — Phase 1: multi-user project access.
--
-- Extends single-owner projects to "owner OR accepted collaborator". A new
-- project_collaborators table holds invites/roles; a SECURITY-DEFINER helper
-- keeps the projects RLS non-recursive. INSERT/DELETE stay owner-only.
--
-- Spec: docs/superpowers/specs/2026-07-28-live-schedule-collaboration-design.md
-- Prod projects policies at author time (verified via pg_policies): duplicate
-- variants exist per command (projects_select + projects_select_own, etc.), so
-- we drop BOTH SELECT/UPDATE variants and consolidate into one collaborator-
-- aware policy each. Owner-only INSERT/DELETE policies are left untouched.
--
-- Idempotent where practical: create-if-not-exists + drop-if-exists + or-replace.

-- ── table ────────────────────────────────────────────────────────────────────
create table if not exists public.project_collaborators (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  invited_email text not null,
  user_id       uuid references auth.users(id),
  role          text not null check (role in ('owner','editor','viewer')),
  status        text not null default 'pending' check (status in ('pending','accepted','revoked')),
  invite_token  text unique,
  invited_by    uuid not null references auth.users(id),
  invited_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  unique (project_id, invited_email)
);
create index if not exists idx_project_collaborators_project on public.project_collaborators(project_id);
create index if not exists idx_project_collaborators_user    on public.project_collaborators(user_id);

alter table public.project_collaborators enable row level security;

-- ── membership helper (non-recursive; used by projects policies) ──────────────
create or replace function public.is_project_collaborator(pid uuid, min_role text default 'viewer')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_collaborators pc
    where pc.project_id = pid
      and pc.user_id = auth.uid()
      and pc.status = 'accepted'
      and case min_role
            when 'editor' then pc.role in ('owner','editor')
            else true
          end
  );
$$;

-- ── projects: add the collaborator path to SELECT + UPDATE ────────────────────
-- Drop both existing variants per command, then create one consolidated policy.
drop policy if exists projects_select      on public.projects;
drop policy if exists projects_select_own  on public.projects;
drop policy if exists projects_update      on public.projects;
drop policy if exists projects_update_own  on public.projects;

create policy projects_select on public.projects
  for select to authenticated
  using (auth.uid() = user_id or public.is_project_collaborator(id));

create policy projects_update on public.projects
  for update to authenticated
  using      (auth.uid() = user_id or public.is_project_collaborator(id, 'editor'))
  with check (auth.uid() = user_id or public.is_project_collaborator(id, 'editor'));

-- INSERT and DELETE remain owner-only — their existing policies are unchanged.

-- ── project_collaborators RLS ─────────────────────────────────────────────────
-- Owner of the parent project manages the collaborator list.
drop policy if exists pc_owner_all on public.project_collaborators;
create policy pc_owner_all on public.project_collaborators
  for all to authenticated
  using      (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));

-- An invitee can see only their own invite row (by matched user_id, or by the
-- email on their JWT before they've accepted). Accept/revoke themselves runs
-- through the service-role project-invite edge function, which bypasses RLS.
drop policy if exists pc_invitee_read on public.project_collaborators;
create policy pc_invitee_read on public.project_collaborators
  for select to authenticated
  using (user_id = auth.uid() or lower(invited_email) = lower(auth.jwt() ->> 'email'));
