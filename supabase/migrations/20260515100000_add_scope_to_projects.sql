-- 20260515100000_add_scope_to_projects.sql
-- Structured project scope captured on the free Project Scope screen.
-- jsonb (not separate columns) so it round-trips 1:1 with the
-- ProjectScope TS interface and the Estimate Wizard answers. Nullable;
-- existing rows keep NULL until the GC fills scope.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS scope jsonb;
