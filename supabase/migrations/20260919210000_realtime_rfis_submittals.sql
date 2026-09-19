-- 20260919210000_realtime_rfis_submittals.sql — wave 3, lane context-integrator
--
-- #56: contexts/NotificationContext.tsx now listens for UPDATEs on public.rfis
-- and public.submittals (filtered to the GC's own rows) so the architect's
-- reply-portal answer reaches an open phone without a relaunch. Postgres only
-- sends those changes for tables in the supabase_realtime publication, and in
-- production (read-only check, 2026-09-18) neither table is in it — the
-- listeners would stay silent. This adds both.
--
-- Realtime's postgres_changes still applies each subscriber's RLS, so this
-- exposes nothing a user could not already SELECT. Idempotent: each table is
-- added only when it is not already a member. Order vs the OTA does not matter
-- (without it the app falls back to the foreground refetch).

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found — nothing to do';
    return;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rfis'
  ) then
    execute 'alter publication supabase_realtime add table public.rfis';
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'submittals'
  ) then
    execute 'alter publication supabase_realtime add table public.submittals';
  end if;
end
$$;
