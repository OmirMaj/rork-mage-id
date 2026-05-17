-- Estimate versioning: immutable milestone-driven revision history,
-- stored as a jsonb array on the project (same pattern as linked_estimate).
alter table public.projects
  add column if not exists estimate_versions jsonb;
