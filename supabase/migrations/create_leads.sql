-- leads — CRM pipeline for homeowner inquiries.
--
-- Solo / small-team residential GCs lose deals in the cracks between
-- "lead came in" and "first response." This table is the single source
-- of truth so the FAB voice flow, the leads pipeline screen, and the
-- one-tap convert-to-project all see the same row.
--
-- Design notes:
--   - One row per lead. RLS is owner-scoped — leads belong to the GC's
--     user_id. No public exposure (homeowners never read this).
--   - `touches` is a JSONB array of {id, kind, body, occurredAt} — small,
--     append-only, fits inline rather than a separate table.
--   - `converted_project_id` points at projects.id when the lead is won
--     and converted into a Project. ON DELETE SET NULL so deleting a
--     project doesn't nuke the lead history.
--   - Indexes match the two queries we run a lot: list by stage, sort
--     by receivedAt desc.

create table if not exists public.leads (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  project_type text,
  project_type_mapped text,
  scope text,
  budget_min numeric,
  budget_max numeric,
  timeline text,
  source text not null default 'other',
  source_other text,
  stage text not null default 'new',
  score int,
  score_reason text,
  received_at timestamptz not null default now(),
  first_responded_at timestamptz,
  touches jsonb,
  converted_project_id uuid references public.projects(id) on delete set null,
  lost_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leads enable row level security;

drop policy if exists leads_owner_all on public.leads;
create policy leads_owner_all on public.leads
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists leads_user_id_idx on public.leads (user_id);
create index if not exists leads_stage_idx on public.leads (user_id, stage);
create index if not exists leads_received_at_idx on public.leads (user_id, received_at desc);
