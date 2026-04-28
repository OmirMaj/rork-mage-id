-- portal_snapshots — server-side cache of the homeowner portal data
-- so the portal URL works even when the URL hash is missing or corrupt
-- (SMS truncation, copy-paste loss, very long snapshots, etc).
--
-- The portal_id is essentially an unguessable bearer token; anon SELECT
-- by exact id is the design intent. RLS on insert/update is gated to
-- the project owner (GC) so only they can refresh the cached snapshot.

create table if not exists public.portal_snapshots (
  portal_id text primary key,
  project_id uuid references public.projects(id) on delete cascade,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.portal_snapshots enable row level security;

-- Anon (no auth) can read by exact portal_id. Treats the portal_id as
-- a shareable token, same model as the URL-hash snapshot today.
drop policy if exists portal_snapshots_anon_read on public.portal_snapshots;
create policy portal_snapshots_anon_read on public.portal_snapshots
  for select to anon
  using (true);

-- Authenticated GC can also read (for debug / preview).
drop policy if exists portal_snapshots_authed_read on public.portal_snapshots;
create policy portal_snapshots_authed_read on public.portal_snapshots
  for select to authenticated
  using (true);

-- Only the project owner can write the cached snapshot for that project.
drop policy if exists portal_snapshots_owner_write on public.portal_snapshots;
create policy portal_snapshots_owner_write on public.portal_snapshots
  for all to authenticated
  using (project_id in (select id from public.projects where user_id = auth.uid()))
  with check (project_id in (select id from public.projects where user_id = auth.uid()));

create index if not exists portal_snapshots_project_id_idx on public.portal_snapshots (project_id);
