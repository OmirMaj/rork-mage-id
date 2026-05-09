-- Workers table — the GC's crew roster. Pre-fix the clock-in modal in
-- app/time-tracking.tsx pulled from a hardcoded mock list ("Carlos Mendez
-- / James Williams / Mike Thompson"). That mock was the single most
-- demo-screaming artifact in the app — every customer who clocked in saw
-- the same fake names. This table is the real backing store; the
-- useWorkers hook (mirrors useTimeEntries) provides offline-first CRUD.
--
-- Scope:
--   - Per-org scoped via user_id on the GC's row. RLS limits reads to
--     the GC + their collaborators (collaborator wiring left as a
--     follow-up; v1 is GC-only).
--   - active flag lets the GC archive a worker without losing
--     historical time-entries that reference worker_id.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.workers (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  trade           TEXT,
  hourly_rate     NUMERIC(10, 2),
  phone           TEXT,
  email           TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  -- Optional sub-association — if this worker is employed by a
  -- subcontractor, link them here so payroll / scorecard can roll up.
  subcontractor_id UUID,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workers_user_id_active
  ON public.workers (user_id, active);

CREATE INDEX IF NOT EXISTS idx_workers_user_id_name
  ON public.workers (user_id, name);

ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workers_select_own ON public.workers;
CREATE POLICY workers_select_own ON public.workers
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS workers_insert_own ON public.workers;
CREATE POLICY workers_insert_own ON public.workers
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS workers_update_own ON public.workers;
CREATE POLICY workers_update_own ON public.workers
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS workers_delete_own ON public.workers;
CREATE POLICY workers_delete_own ON public.workers
  FOR DELETE
  USING (auth.uid() = user_id);
