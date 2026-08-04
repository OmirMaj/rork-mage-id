-- ============================================================================
-- delay_events — the row that ties a delay to its evidence.
--
-- ── WHY A TABLE AND NOT A JSONB ARRAY ON projects.schedule ──────────────────
-- The obvious cheap move is to hang a `delayEvents[]` array off the schedule
-- blob next to `weatherDelayLog`. That is the wrong call, and the reason is
-- already documented in this repo:
--
--   docs/superpowers/specs/2026-07-28-live-schedule-collaboration-design.md
--   describes projects.schedule as "two writers on one JSONB cell (whole-row
--   upsert, last-write-wins clobber)".
--
-- Evidence must not live behind last-write-wins. Two devices, or one
-- device and a stale bundle, and a carefully-provenanced delay record is
-- silently overwritten by whoever saves the schedule last. Nothing warns
-- anyone. (This is also a LIVE pre-existing bug for weatherDelayLog, which
-- does live in that cell — tracked separately as Phase 0.)
--
-- Three further reasons a row wins: a row can carry a per-row immutability
-- trigger; a row can be sealed independently; a row survives a schedule
-- delete.
--
-- ── RLS SHAPE ───────────────────────────────────────────────────────────────
-- Mirrors public.change_orders: owner-only on all four commands, keyed on
-- `auth.uid() = user_id`. Deliberately NOT extended to collaborators —
-- 20260803140000_collaborator_rls_field_tables.sql scoped collaborator access
-- to FIELD tables only and explicitly excluded the financial/contractual
-- cluster, because the roles are owner|editor|viewer with no field-vs-money
-- separation. A delay register is sensitive: it names causation, dollar
-- reservations, and the GC's own contractor_caused entries. It belongs on the
-- change_orders side of that line until a real 'field' role exists.
--
-- ── WHAT PHASE 1 DOES NOT DO ────────────────────────────────────────────────
-- No sealing RPC, no BEFORE UPDATE / BEFORE DELETE immutability trigger, no
-- content_hash computation. `sealed_at` and `content_hash` are declared here so
-- the row shape is stable and Phase 2 is an ALTER-free change, but NOTHING
-- writes them yet. Do not describe these rows as immutable or sealed.
--
-- ── ID TYPE ─────────────────────────────────────────────────────────────────
-- `id` is text, not uuid, matching change_orders / field_tickets: the client
-- generates the id offline (utils/offlineQueue replays the insert later) and
-- the app's generateUUID() is not guaranteed to be a v4 uuid on every
-- platform. project_id is text for the same reason.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.delay_events (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id text NOT NULL,

  -- Per-project sequential, rendered "DE-004". Same convention as
  -- field_tickets.number — independent of the change_orders sequence.
  number integer NOT NULL DEFAULT 1,

  cause text NOT NULL DEFAULT 'other'
    CHECK (cause IN (
      'weather', 'owner_directed_change', 'late_rfi_response',
      'differing_site_condition', 'owner_supplied_item',
      'permit_or_inspection', 'design_revision', 'contractor_caused', 'other'
    )),

  -- THE DATE THE GC FIRST KNEW. This starts the notice clock — not created_at.
  -- A GC logging Monday's washout on Wednesday must not get two free days
  -- against a condition-precedent notice window.
  first_observed_date text NOT NULL,
  -- When the causal condition ended, if it has.
  ended_date text,

  description text NOT NULL DEFAULT '',

  -- DelayEvidenceRef[] — POINTERS, never copies. {kind, id, capturedAt, note}.
  -- A copy is a second version of a fact that can drift from the first, and a
  -- record with two versions of one fact is worth less than one.
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Schedule task ids the GC ASSERTS were impacted. Critical-path status is
  -- NOT stored — it is derived from runCpm() at render time, because a stored
  -- flag goes stale the moment the schedule moves.
  impacted_task_ids jsonb NOT NULL DEFAULT '[]'::jsonb,

  claimed_days integer NOT NULL DEFAULT 0 CHECK (claimed_days >= 0),
  -- Days another delay ran concurrently, including one of the GC's own. The
  -- honest field: a register that cannot show an overlap is describing half a
  -- week.
  concurrent_days integer CHECK (concurrent_days IS NULL OR concurrent_days >= 0),

  -- DelayNotice[] — {id, kind, sentAt, method, recipient, daysRequested,
  -- reservedClaimDescription, reservedAmount, reservedDaysClaimed,
  -- portalMessageId, note}.
  --
  -- Two completeness rules live in utils/noticeClock.ts rather than as CHECKs,
  -- because they are per-element rules inside a JSON array and the app must be
  -- able to explain WHICH field is empty rather than surface a constraint
  -- violation:
  --   * a reservation of rights needs a named claim AND an amount;
  --   * an extension request records how many days were asked for.
  notices jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- DEFAULT 'unclassified' AND IT MUST STAY THAT WAY. The app may SUGGEST a
  -- classification from `cause`; the user sets it.
  classification text NOT NULL DEFAULT 'unclassified'
    CHECK (classification IN (
      'excusable_compensable', 'excusable_noncompensable',
      'nonexcusable', 'unclassified'
    )),

  -- The change order that resolved it, when one did. Closes the loop backwards
  -- from the CO to the cause — the direction the story is actually told. Kept
  -- as a plain text id (no FK) so a delay logged before its CO exists, or one
  -- whose CO was deleted, still stands as a record.
  change_order_id text,

  -- Append-only COAuditEntry[]. Third reuse of the shape (change_orders,
  -- field_tickets, here) — zero new concepts.
  audit_trail jsonb,

  -- PHASE 2 PLACEHOLDERS. Nothing writes these in Phase 1.
  sealed_at timestamptz,
  content_hash text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One event number per project. Catches the double-tap / two-device race that
-- would otherwise produce two "DE-004"s in the same register — a register with
-- duplicate numbers is worth less than one with a gap.
CREATE UNIQUE INDEX IF NOT EXISTS delay_events_project_number_idx
  ON public.delay_events(project_id, number);

CREATE INDEX IF NOT EXISTS delay_events_user_idx
  ON public.delay_events(user_id);

-- The register query: every delay on a job, oldest first (chronological is the
-- order the story is told in).
CREATE INDEX IF NOT EXISTS delay_events_project_idx
  ON public.delay_events(project_id, first_observed_date);

-- The notice-clock query: events with no notice recorded yet are the only ones
-- with a live deadline. Partial index keeps it cheap as the register grows.
CREATE INDEX IF NOT EXISTS delay_events_open_notice_idx
  ON public.delay_events(user_id, first_observed_date)
  WHERE notices = '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.delay_events_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS delay_events_updated_at ON public.delay_events;
CREATE TRIGGER delay_events_updated_at
  BEFORE UPDATE ON public.delay_events
  FOR EACH ROW
  EXECUTE FUNCTION public.delay_events_set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- `TO authenticated`, matching the tightening 20260803140000 applied to the
-- field tables. Every change_orders policy is TO PUBLIC (which includes anon)
-- and merely evaluates false for an anon caller; a new table should not
-- inherit that looseness.

ALTER TABLE public.delay_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delay_events_select ON public.delay_events;
DROP POLICY IF EXISTS delay_events_insert ON public.delay_events;
DROP POLICY IF EXISTS delay_events_update ON public.delay_events;
DROP POLICY IF EXISTS delay_events_delete ON public.delay_events;

CREATE POLICY delay_events_select ON public.delay_events
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY delay_events_insert ON public.delay_events
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY delay_events_update ON public.delay_events
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE is owner-only and, for now, unrestricted. This is a KNOWN GAP, not an
-- oversight: every sealed row in this product is still deletable by its owner,
-- and there is no hold concept anywhere. A BEFORE DELETE trigger is future
-- work. Until it ships, nothing may describe these rows as immutable.
CREATE POLICY delay_events_delete ON public.delay_events
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delay_events TO authenticated;

COMMENT ON TABLE public.delay_events IS
  'Delay register — the claim-defense spine. References the six evidence '
  'primitives via the evidence jsonb; never copies them. Deliberately a table '
  'and not a projects.schedule jsonb array, which is last-write-wins.';
COMMENT ON COLUMN public.delay_events.first_observed_date IS
  'The date the GC first knew. Starts the notice clock — NOT created_at.';
COMMENT ON COLUMN public.delay_events.classification IS
  'GC-entered. Defaults to unclassified; the app suggests but never concludes.';
COMMENT ON COLUMN public.delay_events.concurrent_days IS
  'Days another delay ran concurrently. Concurrency converts an excusable-'
  'compensable delay into excusable but non-compensable under the general US rule.';
COMMENT ON COLUMN public.delay_events.sealed_at IS
  'PHASE 2 PLACEHOLDER — nothing writes this yet. Not an immutability guarantee.';
COMMENT ON COLUMN public.delay_events.content_hash IS
  'PHASE 2 PLACEHOLDER — nothing writes this yet.';

-- ============================================================================
-- VERIFY AFTER APPLYING
--
-- 1. Table and columns:
--    select column_name, data_type, is_nullable, column_default
--    from information_schema.columns
--    where table_schema='public' and table_name='delay_events'
--    order by ordinal_position;
--
-- 2. Exactly four policies, all owner-scoped, all TO authenticated:
--    select p.polname,
--           pg_get_expr(p.polqual, p.polrelid)      as using_expr,
--           pg_get_expr(p.polwithcheck, p.polrelid) as check_expr,
--           p.polroles::regrole[]                   as roles
--    from pg_policy p
--    join pg_class c on c.oid = p.polrelid
--    join pg_namespace n on n.oid = c.relnamespace and n.nspname='public'
--    where c.relname = 'delay_events' order by p.polname;
--
-- 3. Cross-tenant read must return zero rows. Sign in as user B and:
--    select count(*) from public.delay_events;   -- expect 0 for A's events
--
-- 4. The offline queue drains. BEFORE this migration, every delay-event write
--    hits a PostgREST schema-cache miss, which utils/offlineQueue.ts classifies
--    as TRANSIENT and re-queues — so the feature works entirely out of
--    AsyncStorage and nothing is lost, but nothing reaches the server either.
--    After applying, PostgREST needs its schema cache refreshed (Supabase does
--    this within ~a minute, or NOTIFY pgrst, 'reload schema'), then foreground
--    the app and confirm mageid_offline_queue empties.
--
-- 5. Duplicate-number guard: insert two events with the same (project_id,
--    number) and confirm the second is rejected by
--    delay_events_project_number_idx.
-- ============================================================================
