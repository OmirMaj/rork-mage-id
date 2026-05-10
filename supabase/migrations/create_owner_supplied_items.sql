-- owner_supplied_items — OFCI / OFOI tracking. The PM audit's #1
-- missing primitive vs. Procore + Buildertrend.
--
-- Why this isn't just a "type" field on Commitment or LinkedEstimateItem:
--   1. The GC isn't billing it — there's no GMP / fee to track.
--   2. The OWNER is the responsible party for ordering, paying, and
--      handling logistics. The GC only needs the receipt-side data
--      ("when can we install this?") and a closeout-binder finishes
--      entry ("what brand/model is the dishwasher?").
--   3. Status flow is supply-chain (planned → ordered → in_transit →
--      on_site → installed) rather than the contractual flow
--      Commitment uses (issued / received / paid / closed).
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.owner_supplied_items (
  id                   UUID PRIMARY KEY,
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id           UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  mode                 TEXT NOT NULL CHECK (mode IN ('OFCI', 'OFOI')),
  status               TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
                         'planned', 'ordered', 'in_transit', 'on_site', 'installed', 'cancelled'
                       )),
  description          TEXT NOT NULL,
  brand                TEXT,
  model                TEXT,
  sku                  TEXT,
  vendor               TEXT,
  cost_basis           NUMERIC(12, 2),
  need_by              DATE,
  delivery_at          TIMESTAMPTZ,
  installed_at         TIMESTAMPTZ,
  linked_task_id       UUID,
  linked_selection_id  UUID,
  photos               JSONB DEFAULT '[]'::jsonb,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owner_supplied_project_status
  ON public.owner_supplied_items (project_id, status);

CREATE INDEX IF NOT EXISTS idx_owner_supplied_user
  ON public.owner_supplied_items (user_id);

ALTER TABLE public.owner_supplied_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_supplied_select_own ON public.owner_supplied_items;
CREATE POLICY owner_supplied_select_own ON public.owner_supplied_items
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS owner_supplied_insert_own ON public.owner_supplied_items;
CREATE POLICY owner_supplied_insert_own ON public.owner_supplied_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS owner_supplied_update_own ON public.owner_supplied_items;
CREATE POLICY owner_supplied_update_own ON public.owner_supplied_items
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS owner_supplied_delete_own ON public.owner_supplied_items;
CREATE POLICY owner_supplied_delete_own ON public.owner_supplied_items
  FOR DELETE USING (auth.uid() = user_id);
