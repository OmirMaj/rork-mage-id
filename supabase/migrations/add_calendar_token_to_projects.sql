-- Calendar subscription token. The ics-feed edge function uses this to
-- gate access to a project's live ICS feed — anyone with the token can
-- subscribe; rotating the token revokes all subscribers.
--
-- Pre-fix the only ICS export path was a one-time file download
-- (utils/icsGenerator.ts:exportProjectIcs). Subscribers had to
-- re-download every time the schedule changed; in practice they
-- stopped checking and the calendar drifted out of sync.
--
-- The token is a UUID — unguessable without server access, doesn't
-- need extra entropy. Stored alongside the project so the same row
-- update (rotate) revokes the old URL.
--
-- Idempotent.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS calendar_token UUID DEFAULT gen_random_uuid();

-- Backfill any pre-existing rows that ended up with NULL because the
-- column was added without a default in an earlier migration.
UPDATE public.projects
   SET calendar_token = gen_random_uuid()
 WHERE calendar_token IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_calendar_token
  ON public.projects (calendar_token);
