-- Live Schedule Collaboration Phase 2: enable Realtime on projects.
--
-- The schedule lives as a JSONB column on projects. To broadcast a peer's
-- schedule edit live, projects must be in the supabase_realtime publication
-- (it wasn't). Collaborators already receive the whole project row by design
-- (Phase 1 RLS), so this exposes no new fields. Reversible:
--   alter publication supabase_realtime drop table public.projects;
--
-- Idempotent: only adds the table if not already published.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'projects'
  ) then
    alter publication supabase_realtime add table public.projects;
  end if;
end $$;
