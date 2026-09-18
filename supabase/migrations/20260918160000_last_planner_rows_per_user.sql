-- ============================================================================
-- last_planner_commitments / _dispatches — one row per PERSON per natural key.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- 20260916150000 made these tables owner-only (every policy is
-- auth.uid() = user_id) but keyed them WITHOUT the owner: the primary key is
-- the client-derived id `${project}::${task}::${week}` and the natural keys are
-- UNIQUE(project_id, task_id, week_start) / UNIQUE(project_id, crew_key,
-- week_start). A shared project shows up in a collaborator's project list, so
-- his super can open /last-planner on the GC's job. When both commit the same
-- task for the same week, the second upsert (INSERT … ON CONFLICT (id) DO
-- UPDATE) lands on the first person's row, the UPDATE policy refuses it, and
-- Postgres answers "new row violates row-level security policy". The offline
-- queue treats that as terminal and drops it with a "couldn't be synced" toast;
-- his own SELECT never returns the other person's row, so every hydrate sees
-- his copy as never-synced and sends it again — rejected again, every load,
-- and (before the client fix in utils/lastPlanner.sendBackfillUntilUnsynced)
-- it blocked every row queued behind it from ever uploading.
--
-- ── THE FIX: THE OWNER IS PART OF THE ROW'S IDENTITY ────────────────────────
-- Primary key (user_id, id) and natural keys led by user_id. Each person's
-- rows stay theirs — the documented owner-only decision — and two people's
-- commitments on the same task and week can never collide.
--
-- Why the PRIMARY KEY and not the id string: supabase-js `.upsert()` with no
-- onConflict makes PostgREST use the table's primary-key columns, so ON
-- CONFLICT becomes (user_id, id) the moment this lands. Every row the client
-- writes already carries user_id (utils/lastPlanner.commitmentToRow /
-- dispatchToRow). So the clients already in the field are fixed by this
-- migration alone — no id re-key on device, no OTA gate, and the ids the
-- server returns are byte-identical to the ones the client derives, so the
-- hydrate merge keeps matching them.
--
-- last_planner_constraints is untouched: its ids are uuids minted on device
-- and cannot collide across people.
--
-- Idempotent: each step checks the catalog first, so running it twice is a
-- no-op. Existing rows are all valid under the new keys (the old keys were
-- strictly narrower), so no data moves.
-- ============================================================================

DO $keys$
DECLARE
  t text;
  natural_cols text;
  pk_def text;
BEGIN
  FOREACH t IN ARRAY ARRAY['last_planner_commitments', 'last_planner_dispatches']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    natural_cols := CASE t
      WHEN 'last_planner_commitments' THEN 'user_id, project_id, task_id, week_start'
      ELSE 'user_id, project_id, crew_key, week_start'
    END;

    SELECT pg_get_constraintdef(c.oid) INTO pk_def
      FROM pg_constraint c
     WHERE c.conrelid = ('public.' || t)::regclass AND c.contype = 'p';

    IF pk_def IS DISTINCT FROM 'PRIMARY KEY (user_id, id)' THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_pkey');
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY (user_id, id)', t, t || '_pkey');
    END IF;

    -- Drop-and-recreate is cheap and keeps the second run identical to the first.
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_natural_key');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (%s)', t, t || '_natural_key', natural_cols);
  END LOOP;
END
$keys$;

COMMENT ON TABLE public.last_planner_commitments IS
  'Last Planner weekly commitments — the PPC input. Primary key (user_id, id); '
  'id is derived from (project_id, task_id, week_start) so a replayed or '
  'two-device write upserts one row per person instead of double-counting PPC, '
  'and a collaborator committing the same task never collides with the owner.';

-- PostgREST must re-read the key before the next upsert picks its ON CONFLICT
-- target; Supabase reloads on DDL, this makes it explicit.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY AFTER APPLYING
--   select conrelid::regclass, conname, pg_get_constraintdef(oid)
--   from pg_constraint where conrelid::regclass::text in
--     ('last_planner_commitments','last_planner_dispatches') and contype in ('p','u');
--   → both pkeys PRIMARY KEY (user_id, id); both natural keys lead with user_id.
-- ============================================================================
