-- 20260924160600_project_type_other.sql — fixq lane Q6 (project types).
--
-- The founder ran a whole-house repipe and no project-type box fit it ("maybe
-- add 'Other' section?"). The app now has an 'other' type whose meaning is
-- the contractor's own words ("Whole-house repipe"), shown on the job list,
-- PDFs and the client portal instead of the word "other".
--
-- projects.type needs NO change: it is `text NOT NULL` with no CHECK and no
-- enum (read live 2026-09-24; the only CHECKs on projects are
-- projects_status_check and projects_client_portal_portal_id_charset), and
-- award_rfp already writes the off-union 'awarded_rfp'. Only the words need a
-- home.
--
-- CONTRACT: projects.project_type_other <-> Project.projectTypeOther
-- (types/index.ts). Written by contexts/ProjectContext.tsx's owner upsert /
-- shared PATCH base row and utils/projectContextPure.ts
-- localOnlyProjectInsertRow through utils/projectTypes.ts
-- projectTypeOtherColumn — his words when type = 'other', NULL otherwise —
-- and read back through projectTypeOtherFromRow.
--
-- ORDER IS A HARD GATE: apply BEFORE the OTA that sends this column. Every
-- project write from the new client names it (NULL for ordinary jobs), and
-- PostgREST refuses a write naming an unknown column — the offline queue would
-- then fail the WHOLE project upsert for every job, the punch_location trap
-- again.
--
-- The CHECK mirrors the client cap (PROJECT_TYPE_OTHER_MAX = 60, applied
-- before every write), so it can only refuse a value the app never sends.
-- Deliberately no CHECK tying it to type = 'other': an old client that has
-- not taken the OTA replays whole rows without this column and never touches
-- it, and a CHECK that fired on a type change from another path (voice, the
-- copilot, award_rfp) would fail those writes outright; the client already
-- sends NULL whenever the type is not 'other'.
--
-- Nullable, no default, no backfill: nothing existing is an 'other' job.
-- Adding a nullable column rewrites nothing. RLS needs no change (every
-- projects policy is row-level; there is no column grant list on projects,
-- and ProjectContext reads select('*')). No live function inserts into
-- projects positionally (award_rfp names its columns).
--
-- Re-runnable: `add column if not exists`, and the constraint is dropped
-- before it is added.

alter table public.projects
  add column if not exists project_type_other text;

alter table public.projects
  drop constraint if exists projects_project_type_other_len;

alter table public.projects
  add constraint projects_project_type_other_len
  check (project_type_other is null or char_length(project_type_other) <= 60);

comment on column public.projects.project_type_other is
  'The contractor''s own words for a job typed ''other'' (e.g. "Whole-house repipe"). Shown instead of the word "other" on the job list, PDFs and the client portal. NULL for every other type (the client sends NULL unless type = ''other''). <= 60 chars, the client cap (utils/projectTypes.ts PROJECT_TYPE_OTHER_MAX).';
