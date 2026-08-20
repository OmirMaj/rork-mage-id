-- Schema backfill for five production tables whose CREATE TABLE DDL existed
-- NOWHERE in git (only RLS migrations referenced them). START-HERE flagged two
-- as "unrecoverable if production is lost." Reconstructed 2026-08-19 by
-- introspecting production (nteoqhcswappxxjlpvap) — columns, PK/FK/CHECK,
-- indexes, RLS + policies. Fully idempotent (IF NOT EXISTS / DROP+CREATE), so
-- it is a no-op against the live DB and rebuilds the schema on a fresh one.

-- ── contractor_licenses (user-scoped; optional subcontractor link) ───────────
CREATE TABLE IF NOT EXISTS public.contractor_licenses (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  license_number text,
  license_type text NOT NULL,
  jurisdiction text NOT NULL,
  issued_date date,
  expires_date date NOT NULL,
  document_uri text,
  subcontractor_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contractor_licenses_user_expires ON public.contractor_licenses (user_id, expires_date);
CREATE INDEX IF NOT EXISTS idx_contractor_licenses_user_type ON public.contractor_licenses (user_id, license_type);

-- ── delivery_receipts (project-scoped) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.delivery_receipts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  date date NOT NULL,
  supplier text NOT NULL,
  po_number text,
  commitment_id uuid,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  bol_photo_uri text,
  signature_photo_uri text,
  has_damage boolean NOT NULL DEFAULT false,
  damage_notes text,
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delivery_receipts_project_date ON public.delivery_receipts (project_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_receipts_supplier ON public.delivery_receipts (user_id, supplier);
CREATE INDEX IF NOT EXISTS idx_delivery_receipts_user ON public.delivery_receipts (user_id);

-- ── draw_periods (project-scoped; draw/funding schedule) ─────────────────────
CREATE TABLE IF NOT EXISTS public.draw_periods (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  number integer NOT NULL,
  label text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status = ANY (ARRAY['open','submitted','approved','funded','closed'])),
  aia_pay_app_id uuid,
  invoice_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  lien_waiver_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  amount_requested numeric(12,2),
  amount_approved numeric(12,2),
  amount_funded numeric(12,2),
  submitted_at timestamptz,
  approved_at timestamptz,
  funded_at timestamptz,
  closed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_draw_periods_project_number ON public.draw_periods (project_id, number);
CREATE INDEX IF NOT EXISTS idx_draw_periods_user_status ON public.draw_periods (user_id, status);

-- ── owner_supplied_items (project-scoped; OFCI/OFOI) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.owner_supplied_items (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode = ANY (ARRAY['OFCI','OFOI'])),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status = ANY (ARRAY['planned','ordered','in_transit','on_site','installed','cancelled'])),
  description text NOT NULL,
  brand text,
  model text,
  sku text,
  vendor text,
  cost_basis numeric(12,2),
  need_by date,
  delivery_at timestamptz,
  installed_at timestamptz,
  linked_task_id uuid,
  linked_selection_id uuid,
  photos jsonb DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_owner_supplied_project_status ON public.owner_supplied_items (project_id, status);
CREATE INDEX IF NOT EXISTS idx_owner_supplied_user ON public.owner_supplied_items (user_id);

-- ── permit_templates (user-scoped reusable permit presets) ───────────────────
CREATE TABLE IF NOT EXISTS public.permit_templates (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type = ANY (ARRAY['building','electrical','plumbing','mechanical','demolition','grading','fire','occupancy','special_inspection','other'])),
  jurisdiction text NOT NULL,
  scope_template text,
  typical_fee numeric(10,2),
  phase text,
  special_inspection_category text,
  notes text,
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_permit_templates_type_juris ON public.permit_templates (user_id, type, jurisdiction);
CREATE INDEX IF NOT EXISTS idx_permit_templates_user ON public.permit_templates (user_id, last_used_at DESC NULLS LAST);

-- ── RLS: every table is owner-scoped (auth.uid() = user_id) ──────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contractor_licenses','delivery_receipts','draw_periods','owner_supplied_items','permit_templates'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_select_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_insert_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_update_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_delete_own', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO public USING (auth.uid() = user_id)', t||'_select_own', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO public WITH CHECK (auth.uid() = user_id)', t||'_insert_own', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO public USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t||'_update_own', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO public USING (auth.uid() = user_id)', t||'_delete_own', t);
  END LOOP;
END $$;
