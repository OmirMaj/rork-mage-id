-- ============================================================================
-- Wave 5 · coi-subs — the subcontractor fields that vanished at the next read,
-- a renewal-safe COI reminder marker, and a server copy of material receipts.
--
-- APPLY BEFORE THE OTA. PostgREST rejects an update that names a column the
-- table does not have ('could not find the column … in the schema cache'), and
-- once w5-join-core maps the new Subcontractor fields, EVERY subcontractor save
-- names them. Before this lands the offline queue re-queues those writes as a
-- schema-cache miss (nothing lost, nothing synced) — the same trap the
-- profiles.license_state migration documents. material_receipts likewise:
-- before it exists every receipt write is re-queued and the read falls back to
-- the device copy.
--
-- ── 1 · subcontractors: 1099 + verification + W-9 (audit #27, CONTRACT 17) ──
-- The Subs form has captured legal name and TIN last-4, 'Mark verified' stamps
-- for licence and COI, and an uploaded W-9's storage path — and none of them
-- had a column. The next server read rebuilt the sub from the row and they were
-- gone: year-end 1099 export said 'TIN missing', the badges read 'Not
-- verified', the W-9 button offered 'Pick W-9 PDF' again. The existing owner
-- RLS (subcontractors_* / subs_*_own: auth.uid() = user_id) covers the new
-- columns; no policy changes. licence_state is NOT added: the form never sets
-- it (sharpening).
--
-- tax_id_last4 carries a CHECK (exactly four digits or null). The form now
-- refuses anything else before saving, but a device may still hold a partial
-- value typed before this (the input stripped non-digits and capped at 4, so
-- '12' was possible) — and a queued update carrying it would be REFUSED whole by
-- the CHECK, taking the rest of the edit with it (the offline queue turns a
-- raise into a permanent failure). So a BEFORE trigger pins an invalid value
-- silently — on UPDATE to the value already stored (NEW.col := OLD.col, the
-- house rule for guard triggers: a stale '12' replayed from an old device's
-- queue must not wipe a valid '1234' typed since), on INSERT to NULL (nothing
-- to keep) — and the CHECK stays as the contract's guarantee that nothing else
-- can land there. A deliberate clear (NULL or blank) still clears.
--
-- ── 2 · subcontractors.coi_last_warned_for (audit #28) ──────────────────────
-- coi-expiry-watch writes the coi_expiry each warning was for, next to the two
-- existing markers, and treats a different coi_expiry as a fresh 30 / 14 / 7
-- day cycle. No backfill: production has 0 rows with a marker (2026-09-23).
--
-- ── 3 · material_receipts (audit #25, CONTRACT 16) ──────────────────────────
-- Material receipts lived only in AsyncStorage under `mageid_material_receipts`,
-- which the sign-out sweep deletes; the web budget dashboard and job costing on
-- another device never counted them. hooks/useMaterialReceipts now upserts
-- every add / edit / delete here through the offline queue and merges this
-- copy on read. Same shape as the Property Manager mirror (20260918180000):
--   • id text — generated on the device, possibly offline; QuickBooks-sourced
--     receipts use a deterministic 'qbo-<type>-<id>-<line>' id, so replaying a
--     re-materialized line is an idempotent upsert;
--   • payload jsonb — the whole MaterialReceipt as the app holds it;
--   • updated_at is the CLIENT's (no trigger rewrites it: the device merge picks
--     the newer copy by the updatedAt each device stamped);
--   • deletes are tombstones (deleted_at), so a second device drops its copy
--     instead of uploading it back;
--   • project_id / commitment_id are plain text with NO foreign key — a receipt
--     and its project can reach the server in either order from the queue.
-- RLS owner-only on all four commands, TO authenticated; anon has nothing.
-- ============================================================================

-- ── 1 + 2 · subcontractors columns ──────────────────────────────────────────
ALTER TABLE public.subcontractors
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS tax_id_last4 text
    CONSTRAINT subcontractors_tax_id_last4_check
    CHECK (tax_id_last4 IS NULL OR tax_id_last4 ~ '^[0-9]{4}$'),
  ADD COLUMN IF NOT EXISTS license_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS coi_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS w9_doc_path text,
  ADD COLUMN IF NOT EXISTS coi_last_warned_for text;

CREATE OR REPLACE FUNCTION public.subcontractors_sanitize_tax_id_last4()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  -- NULL or blank → NULL (a deliberate clear). Anything else that is not
  -- exactly four digits is pinned silently rather than raised — see the header
  -- (a raise would lose the whole queued edit): an UPDATE keeps what is
  -- stored, an INSERT has nothing to keep and gets NULL.
  IF NEW.tax_id_last4 IS NOT NULL THEN
    NEW.tax_id_last4 := btrim(NEW.tax_id_last4);
    IF NEW.tax_id_last4 = '' THEN
      NEW.tax_id_last4 := NULL;
    ELSIF NEW.tax_id_last4 !~ '^[0-9]{4}$' THEN
      IF TG_OP = 'UPDATE' THEN
        NEW.tax_id_last4 := OLD.tax_id_last4;
      ELSE
        NEW.tax_id_last4 := NULL;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS subcontractors_sanitize_tax_id_last4 ON public.subcontractors;
CREATE TRIGGER subcontractors_sanitize_tax_id_last4
  BEFORE INSERT OR UPDATE OF tax_id_last4 ON public.subcontractors
  FOR EACH ROW EXECUTE FUNCTION public.subcontractors_sanitize_tax_id_last4();

REVOKE ALL ON FUNCTION public.subcontractors_sanitize_tax_id_last4() FROM PUBLIC, anon, authenticated;

-- ── 3 · material_receipts ───────────────────────────────────────────────────
-- The key is (user_id, id), not id alone. Receipt ids are client-made and
-- NOT globally unique: a QuickBooks-sourced receipt's id is
-- `qbo-<type>-<qbo_id>-<line>` (utils/qbo/qboCostMap.ts), and qbo_id is
-- QuickBooks' per-company sequential number — two contractors on QuickBooks
-- both have a 'qbo-Purchase-1-1'. With a global key the second one's upsert
-- lands on the first one's row, RLS refuses it (42501), his receipt never
-- reaches the server and Retry fails forever. PostgREST's upsert with no
-- on_conflict conflicts on the primary key, and every row carries user_id, so
-- the app's write needs no change.
CREATE TABLE IF NOT EXISTS public.material_receipts (
  id text NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id text,
  commitment_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (user_id, id)
);

-- A database that ran an earlier draft of this file has PRIMARY KEY (id);
-- move it to (user_id, id). Production had no material_receipts table when
-- this was written (2026-09-23), so there this is a no-op.
DO $pk$
DECLARE
  v_con text;
  v_cols text;
BEGIN
  SELECT c.conname,
         string_agg(a.attname, ',' ORDER BY array_position(c.conkey, a.attnum))
    INTO v_con, v_cols
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'public.material_receipts'::regclass AND c.contype = 'p'
   GROUP BY c.conname;
  IF v_cols IS DISTINCT FROM 'user_id,id' THEN
    IF v_con IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.material_receipts DROP CONSTRAINT %I', v_con);
    END IF;
    ALTER TABLE public.material_receipts ADD PRIMARY KEY (user_id, id);
  END IF;
END
$pk$;

CREATE INDEX IF NOT EXISTS material_receipts_user_idx ON public.material_receipts(user_id);
CREATE INDEX IF NOT EXISTS material_receipts_project_idx
  ON public.material_receipts(project_id) WHERE project_id IS NOT NULL;

ALTER TABLE public.material_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS material_receipts_select ON public.material_receipts;
DROP POLICY IF EXISTS material_receipts_insert ON public.material_receipts;
DROP POLICY IF EXISTS material_receipts_update ON public.material_receipts;
DROP POLICY IF EXISTS material_receipts_delete ON public.material_receipts;

CREATE POLICY material_receipts_select ON public.material_receipts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY material_receipts_insert ON public.material_receipts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY material_receipts_update ON public.material_receipts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY material_receipts_delete ON public.material_receipts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

REVOKE ALL ON public.material_receipts FROM anon;
REVOKE ALL ON public.material_receipts FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_receipts TO authenticated;
GRANT ALL ON public.material_receipts TO service_role;

-- ============================================================================
-- VERIFY AFTER APPLYING
-- 1. select column_name from information_schema.columns
--      where table_schema='public' and table_name='subcontractors'
--        and column_name in ('legal_name','tax_id_last4','license_verified_at',
--          'coi_verified_at','w9_doc_path','coi_last_warned_for');     → 6 rows
-- 2. update public.subcontractors set tax_id_last4 = '12' where id = <own>;
--    over a stored '1234' → succeeds, the rest of the edit lands and
--    tax_id_last4 stays '1234'; set it to '' → NULL (a deliberate clear).
-- 3. Four material_receipts policies, owner-scoped, TO authenticated; as user
--    B, select count(*) from material_receipts → 0 of A's rows; an insert with
--    user_id = A is rejected; anon select → permission denied. A and B can
--    each hold a row with the same id (the key is (user_id, id)):
--    select pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.material_receipts'::regclass and contype = 'p';
--    → PRIMARY KEY (user_id, id)
-- 4. NOTIFY pgrst, 'reload schema'; save a material receipt on a device and
--    see it on app.mageid.app's budget dashboard.
-- ============================================================================
