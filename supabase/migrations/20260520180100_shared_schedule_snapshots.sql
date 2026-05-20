-- Item 6 — Shared-schedule Supabase-snapshot URL fallback
--
-- See docs/superpowers/specs/2026-05-20-item6-shared-schedule-snapshot-fallback-design.md
-- for the full design.
--
-- Extends v2.3 P1 (ShareTokenTooLargeError) — turns the typed throw
-- into a graceful fallback: write the snapshot to this table, use a
-- short row-id token (`s=` URL param) instead of the full base64
-- payload (`t=` URL param).
--
-- Security: URL-IS-the-secret. UUID = ~122 bits entropy.
-- TTL-bounded leak window (30 days default).
-- Owner-only writes via RLS. Anon + authenticated reads via the
-- fetch_shared_schedule SECURITY DEFINER RPC which enforces expires_at.
--
-- Reverse path:
--   drop function fetch_shared_schedule(uuid);
--   drop table shared_schedule_snapshots cascade;

create table public.shared_schedule_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  payload jsonb not null,
  task_count int not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  last_accessed_at timestamptz
);

create index shared_schedule_snapshots_user_idx
  on public.shared_schedule_snapshots (user_id, created_at desc);

-- Plain (non-partial) index on expires_at — used by future cleanup jobs
-- to find rows past TTL. now() can't be in a partial index predicate
-- (must be IMMUTABLE per postgres rules); the full index is fine.
create index shared_schedule_snapshots_expires_idx
  on public.shared_schedule_snapshots (expires_at);

alter table public.shared_schedule_snapshots enable row level security;

create policy shared_schedule_snapshots_owner_write
  on public.shared_schedule_snapshots
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.fetch_shared_schedule(
  snapshot_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  select id, payload, expires_at
    into rec
    from shared_schedule_snapshots
   where id = snapshot_id
     and expires_at > now()
   limit 1;
  if not found then
    return null;
  end if;
  begin
    update shared_schedule_snapshots
       set last_accessed_at = now()
     where id = snapshot_id;
  exception when others then
    null;
  end;
  return rec.payload;
end;
$$;

revoke all on function public.fetch_shared_schedule(uuid) from public;
grant execute on function public.fetch_shared_schedule(uuid) to anon, authenticated;
