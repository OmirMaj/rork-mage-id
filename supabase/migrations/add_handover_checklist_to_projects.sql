-- Add the handover-checklist JSONB column to projects.
--
-- Used by the closeout-day flow (app/handover.tsx). Stores manual
-- check timestamps for items that aren't computed from project data
-- (final walk-through, key transfer). Shape:
--   { "walkthrough": "2025-08-12T15:33:00Z", "keys": "..." }
--
-- Idempotent — safe to re-apply.

alter table public.projects
  add column if not exists handover_checklist jsonb not null default '{}'::jsonb;
