-- sub_portal_snapshots — server-side cache of the sub portal data so
-- the sub portal URL works even when the URL hash is missing or
-- corrupt (SMS truncation, copy-paste, very long snapshots).
--
-- Same model as portal_snapshots: portal_id is treated as a bearer
-- token; anon SELECT by exact id is the design intent. Writes are
-- gated to the project owner via RLS.

create table if not exists public.sub_portal_snapshots (
  sub_portal_id text primary key,
  project_id uuid references public.projects(id) on delete cascade,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.sub_portal_snapshots enable row level security;

drop policy if exists sub_portal_snapshots_anon_read on public.sub_portal_snapshots;
create policy sub_portal_snapshots_anon_read on public.sub_portal_snapshots
  for select to anon
  using (true);

drop policy if exists sub_portal_snapshots_authed_read on public.sub_portal_snapshots;
create policy sub_portal_snapshots_authed_read on public.sub_portal_snapshots
  for select to authenticated
  using (true);

drop policy if exists sub_portal_snapshots_owner_write on public.sub_portal_snapshots;
create policy sub_portal_snapshots_owner_write on public.sub_portal_snapshots
  for all to authenticated
  using (project_id in (select id from public.projects where user_id = auth.uid()))
  with check (project_id in (select id from public.projects where user_id = auth.uid()));

create index if not exists sub_portal_snapshots_project_id_idx on public.sub_portal_snapshots (project_id);
