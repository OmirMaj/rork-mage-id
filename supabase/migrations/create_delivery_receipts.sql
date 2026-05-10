-- delivery_receipts — structured material-delivery records.
--
-- Pre-fix the Daily Field Report's `materialsDelivered` was just
-- `string[]` — "20 sheets drywall" with no supplier, no qty/unit
-- split, no PO link, no BOL photo, no signature, no damage flag.
-- Super audit flagged this as a discovery deal-breaker for
-- material-heavy residential GCs vs. Procore / Buildertrend / Raken.
--
-- Items live as JSONB on the parent row (rather than a separate
-- table) because:
--   1. Most receipts are 1-5 lines — a join table would be overkill.
--   2. Items are atomic with the receipt — no cross-receipt query
--      pattern justifies the JOIN.
--   3. AsyncStorage round-trips a single JSON blob cheaper than a
--      multi-table reconcile in the offline queue.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.delivery_receipts (
  id                  UUID PRIMARY KEY,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  date                DATE NOT NULL,
  supplier            TEXT NOT NULL,
  po_number           TEXT,
  commitment_id       UUID,
  items               JSONB NOT NULL DEFAULT '[]'::jsonb,
  bol_photo_uri       TEXT,
  signature_photo_uri TEXT,
  has_damage          BOOLEAN NOT NULL DEFAULT FALSE,
  damage_notes        TEXT,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by         TEXT NOT NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_receipts_project_date
  ON public.delivery_receipts (project_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_receipts_user
  ON public.delivery_receipts (user_id);

CREATE INDEX IF NOT EXISTS idx_delivery_receipts_supplier
  ON public.delivery_receipts (user_id, supplier);

ALTER TABLE public.delivery_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delivery_receipts_select_own ON public.delivery_receipts;
CREATE POLICY delivery_receipts_select_own ON public.delivery_receipts
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS delivery_receipts_insert_own ON public.delivery_receipts;
CREATE POLICY delivery_receipts_insert_own ON public.delivery_receipts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS delivery_receipts_update_own ON public.delivery_receipts;
CREATE POLICY delivery_receipts_update_own ON public.delivery_receipts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS delivery_receipts_delete_own ON public.delivery_receipts;
CREATE POLICY delivery_receipts_delete_own ON public.delivery_receipts
  FOR DELETE USING (auth.uid() = user_id);
