-- ============================================================================
-- project_collaborators → auth.users: NO ACTION becomes CASCADE.
--
-- WHY. Both FKs from project_collaborators to auth.users were declared
-- ON DELETE NO ACTION:
--     project_collaborators_user_id_fkey
--     project_collaborators_invited_by_fkey
-- (verified against production: pg_constraint.confdeltype = 'a' for both, and
-- they are the ONLY two such constraints referencing auth.users.)
--
-- supabase/functions/delete-account deletes 33 tables of rows and the user's
-- Storage objects, and THEN calls auth.admin.deleteUser. Those are separate,
-- non-transactional calls with no rollback. A user who was invited onto someone
-- else's project — a Project Manager or Expeditor, two of the five shipped
-- personas, which exist precisely to be invited — still had a referencing row
-- at that point, so Postgres raised 23503.
--
-- The outcome: their projects, invoices, daily reports, photos, RFIs, punch
-- items and files were permanently destroyed, the call returned 500, and they
-- were left signed in to a gutted account that could not be recovered or
-- re-deleted. Apple exercises account deletion during review, so it was also a
-- 5.1.1(v) rejection.
--
-- The edge function now clears these rows explicitly before the auth delete.
-- This migration is the BACKSTOP: it makes the database enforce what the
-- function intends, so the same bug cannot return through a different code
-- path (an admin console delete, a support script, a future refactor).
--
-- CASCADE is the right verb for both columns:
--   user_id     — the membership belongs to the departing user.
--   invited_by  — NOT NULL, so the row cannot be preserved with the inviter
--                 nulled out. Deleting it matches what the edge function does,
--                 and the invitee loses access to a project whose owner is
--                 leaving anyway.
--
-- Idempotent: drops by name, then recreates.
-- ============================================================================

alter table public.project_collaborators
  drop constraint if exists project_collaborators_user_id_fkey;

alter table public.project_collaborators
  add constraint project_collaborators_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.project_collaborators
  drop constraint if exists project_collaborators_invited_by_fkey;

alter table public.project_collaborators
  add constraint project_collaborators_invited_by_fkey
  foreign key (invited_by) references auth.users(id) on delete cascade;

comment on constraint project_collaborators_user_id_fkey on public.project_collaborators is
  'ON DELETE CASCADE is load-bearing: with NO ACTION, deleting an invited user raised 23503 AFTER supabase/functions/delete-account had already destroyed their rows and Storage objects. See scripts/validate-account-deletion.ts.';
