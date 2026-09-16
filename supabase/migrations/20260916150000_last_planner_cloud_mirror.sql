-- ============================================================================
-- last_planner_* — a server copy of the Last Planner loop.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- Constraints, weekly commitments (kept / missed + variance reason — the input
-- to PPC) and crew-dispatch receipts lived ONLY in the AsyncStorage key
-- `mageid_last_planner`. That key is under the `mageid_` prefix, so
-- AuthContext.wipeLocalUserCache removes it on every sign-out and tenant
-- switch, and nothing existed to restore it from. PPC — the number that shows
-- an owner or a GC whether the crews do what they say — was one logout, one new
-- phone, or one account switch from permanently gone. And because it never left
-- the device, a commitment meeting run on app.mageid.app left the phone's This
-- Week tab empty on site, so the kept/missed step never happened.
--
-- ── ONE ROW PER NATURAL KEY ─────────────────────────────────────────────────
-- A commitment has no id of its own: it IS (project, task, week). A dispatch
-- IS (project, crew, week). If each write minted a fresh id, an offline-queue
-- replay or the same week edited on laptop and phone would create a second
-- row, and computePpc (utils/lastPlanner.ts) would count the commitment twice
-- — a wrong PPC shown to a GC as fact, which is worse than a missing one.
--
-- So the client DERIVES the id from the natural key
-- (utils/lastPlanner.commitmentRowId / dispatchRowId), every write is an upsert
-- on that primary key (utils/offlineQueue.supabaseWrite 'upsert'), and the
-- natural key carries its own UNIQUE constraint as well, so a client that ever
-- derived ids differently fails loudly instead of double-counting quietly.
--
-- ── ID TYPES ────────────────────────────────────────────────────────────────
-- text, matching delay_events / change_orders: ids are generated offline and
-- project ids are client-generated text.
--
-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Owner-only on all four commands, TO authenticated — the delay_events shape.
-- Not yet extended to collaborators: the planner is the GC's own record, and a
-- field role that should see it is a product decision, not a default.
--
-- ── DELETES ARE TOMBSTONES ──────────────────────────────────────────────────
-- `deleted_at` rather than a row delete, so a second device can tell "deleted
-- elsewhere" from "never synced" when it reconciles. The client honours it on
-- read; nothing in the app sets it today.
--
-- ── ORDER OF OPERATIONS ─────────────────────────────────────────────────────
-- APPLY THIS BEFORE ANY OTA THAT SHIPS THE MIRROR. Before it exists, every
-- write hits a PostgREST schema-cache miss that utils/offlineQueue.ts treats as
-- TRANSIENT and re-queues: nothing is lost, nothing syncs, and each checkbox
-- tap sits in mageid_offline_queue until this lands. The screen reads through
-- a try/catch and keeps working from AsyncStorage in the meantime.
-- ============================================================================

-- ── Constraints (the make-ready log) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.last_planner_constraints (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  task_id text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN (
      'materials', 'labor', 'equipment', 'permit', 'design_info',
      'prior_work', 'inspection', 'selection', 'access', 'other'
    )),
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cleared')),
  -- yyyy-mm-dd the constraint must clear by. text, not date: the client stores
  -- exactly what the GC picked and must round-trip it byte-for-byte.
  need_by text,
  owner text,
  -- The client's own createdAt — when the constraint was logged, which may be
  -- long before an offline device first reached the server.
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS last_planner_constraints_user_idx
  ON public.last_planner_constraints(user_id);
CREATE INDEX IF NOT EXISTS last_planner_constraints_project_idx
  ON public.last_planner_constraints(project_id);

-- ── Weekly commitments (WILL / DID / LEARN — the PPC input) ─────────────────
CREATE TABLE IF NOT EXISTS public.last_planner_commitments (
  -- Derived: `${project_id}::${task_id}::${week_start}`.
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  task_id text NOT NULL,
  -- ISO Monday of the committed week.
  week_start date NOT NULL,
  committed boolean NOT NULL DEFAULT false,
  outcome text CHECK (outcome IS NULL OR outcome IN ('done', 'missed')),
  variance_reason text CHECK (variance_reason IS NULL OR variance_reason IN (
    'prereq', 'materials', 'labor', 'weather', 'rework',
    'owner_decision', 'permit', 'inspection', 'scope_change', 'other'
  )),
  note text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT last_planner_commitments_natural_key UNIQUE (project_id, task_id, week_start)
);

CREATE INDEX IF NOT EXISTS last_planner_commitments_user_idx
  ON public.last_planner_commitments(user_id);

-- ── Crew dispatch receipts ("sent" state) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.last_planner_dispatches (
  -- Derived: `${project_id}::${crew_key}::${week_start}`.
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  crew_key text NOT NULL,
  week_start date NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'share')),
  sent_at timestamptz NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT last_planner_dispatches_natural_key UNIQUE (project_id, crew_key, week_start)
);

CREATE INDEX IF NOT EXISTS last_planner_dispatches_user_idx
  ON public.last_planner_dispatches(user_id);

-- ── updated_at ──────────────────────────────────────────────────────────────
-- search_path pinned: an unpinned trigger function is the Supabase advisor's
-- function_search_path_mutable warning, and it costs nothing to close.
CREATE OR REPLACE FUNCTION public.last_planner_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $body$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS last_planner_constraints_updated_at ON public.last_planner_constraints;
CREATE TRIGGER last_planner_constraints_updated_at
  BEFORE UPDATE ON public.last_planner_constraints
  FOR EACH ROW EXECUTE FUNCTION public.last_planner_set_updated_at();

DROP TRIGGER IF EXISTS last_planner_commitments_updated_at ON public.last_planner_commitments;
CREATE TRIGGER last_planner_commitments_updated_at
  BEFORE UPDATE ON public.last_planner_commitments
  FOR EACH ROW EXECUTE FUNCTION public.last_planner_set_updated_at();

DROP TRIGGER IF EXISTS last_planner_dispatches_updated_at ON public.last_planner_dispatches;
CREATE TRIGGER last_planner_dispatches_updated_at
  BEFORE UPDATE ON public.last_planner_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.last_planner_set_updated_at();

-- ── RLS (owner-only, TO authenticated) ──────────────────────────────────────
ALTER TABLE public.last_planner_constraints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.last_planner_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.last_planner_dispatches ENABLE ROW LEVEL SECURITY;

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['last_planner_constraints', 'last_planner_commitments', 'last_planner_dispatches']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() = user_id)', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (auth.uid() = user_id)', t || '_delete', t);

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END
$rls$;

COMMENT ON TABLE public.last_planner_commitments IS
  'Last Planner weekly commitments — the PPC input. id is derived from '
  '(project_id, task_id, week_start) so a replayed or two-device write upserts '
  'one row instead of double-counting PPC.';

-- ============================================================================
-- VERIFY AFTER APPLYING
--
-- 1. Twelve policies, all owner-scoped, all TO authenticated:
--    select c.relname, p.polname, pg_get_expr(p.polqual, p.polrelid),
--           pg_get_expr(p.polwithcheck, p.polrelid), p.polroles::regrole[]
--    from pg_policy p join pg_class c on c.oid = p.polrelid
--    where c.relname like 'last_planner_%' order by 1, 2;
--
-- 2. Natural-key guard: insert two commitments with the same
--    (project_id, task_id, week_start) and DIFFERENT ids — the second must be
--    rejected by last_planner_commitments_natural_key.
--
-- 3. Cross-tenant read returns zero rows. As user B:
--    select count(*) from public.last_planner_commitments;  -- 0 for A's rows
--
-- 4. The queue drains. NOTIFY pgrst, 'reload schema' (or wait ~a minute), open
--    Last Planner on a device that had queued writes, and confirm
--    mageid_offline_queue empties and the rows appear here.
-- ============================================================================
