-- ============================================
-- MIGRATION: project_collaborators (normalized)
-- ============================================
-- Purpose: promote the embedded `projects.collaborators` JSONB array into
-- a first-class table so (a) invited users can be queried by email across
-- projects, (b) acceptance status / role changes are auditable, and (c)
-- we can RLS-protect read access per-row instead of per-parent-project.
--
-- Rollout plan (DO NOT RUN BLINDLY):
--   1. Apply this file in a STAGING project first. Verify data model.
--   2. Write a one-off backfill script that reads each row in
--      `public.projects`, unpacks its `collaborators` JSONB column, and
--      inserts one row per collaborator into `public.project_collaborators`.
--   3. Deploy an app update that READS from both locations (new table is
--      canonical, JSONB is fallback) and WRITES to the new table only.
--   4. After all clients have caught up (≥ 1 week), drop the JSONB column
--      in a follow-up migration. Not included here on purpose — the JSONB
--      column is still read by `ProjectContext.tsx` and removing it too
--      early breaks older builds still on the binary-baked channel.
--
-- RLS mirrors the projects-table pattern: user owns the rows they created.
-- A secondary policy lets a collaborator themself read the rows where their
-- own email matches the record (so invitees can see their assignments).

CREATE TABLE IF NOT EXISTS public.project_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'editor', 'viewer')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- An email can only collaborate once per project.
  CONSTRAINT project_collaborators_unique_per_project UNIQUE (project_id, email)
);

CREATE INDEX IF NOT EXISTS idx_project_collaborators_project
  ON public.project_collaborators(project_id);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_owner
  ON public.project_collaborators(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_email
  ON public.project_collaborators(LOWER(email));

-- Keep updated_at fresh on every write (reuses the helper defined earlier
-- in schema.sql — safe to call here because the function exists app-wide).
CREATE TRIGGER project_collaborators_updated_at
  BEFORE UPDATE ON public.project_collaborators
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Row Level Security
ALTER TABLE public.project_collaborators ENABLE ROW LEVEL SECURITY;

-- Project owner full control (matches how ProjectContext writes today).
CREATE POLICY "project_collaborators_owner_all"
  ON public.project_collaborators
  FOR ALL
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

-- Let an invited user see their own invitation rows across projects.
-- auth.email() is a Supabase-provided helper; if that's unavailable on your
-- instance, swap for: (SELECT email FROM auth.users WHERE id = auth.uid()).
CREATE POLICY "project_collaborators_invitee_select"
  ON public.project_collaborators
  FOR SELECT
  USING (LOWER(email) = LOWER(COALESCE(auth.email(), '')));

-- ============================================
-- Verification query (not executed — paste into SQL editor to confirm):
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name IN ('rfis', 'project_collaborators');
--
-- Expected: two rows. If 'rfis' is missing, re-apply schema.sql first.
-- ============================================
