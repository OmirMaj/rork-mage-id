-- 20260708180000_safety_wave_b.sql
-- Safety Management — Wave B (compliance layer): inspections/audits,
-- certifications tracking, and the reusable forms library.
--
-- Extends the Wave A safety tables (jhas, toolbox_talks, safety_incidents,
-- hazards). All additive. Apply BEFORE the OTA that writes these tables.
--
-- Scoping:
--   safety_inspections — project-scoped, owned by the GC (user_id).
--   certifications     — COMPANY-scoped; person-anchored via worker_id
--                        (→ crew_members.id, built by the Worker Profile feature)
--                        with holder_name as a display fallback; owned by user_id;
--                        NO project.
--   safety_templates   — COMPANY-scoped forms library; owned by user_id.

-- Shared updated_at bump used by all three tables.
CREATE OR REPLACE FUNCTION public.safety_wave_b_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$body$;

-- ── safety_inspections ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.safety_inspections (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  template_id text,
  title text NOT NULL DEFAULT '',
  date text NOT NULL DEFAULT '',
  inspector text NOT NULL DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  score numeric(4,3) NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'complete' CHECK (status IN ('draft','complete')),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS safety_inspections_user_idx ON public.safety_inspections(user_id);
CREATE INDEX IF NOT EXISTS safety_inspections_project_idx ON public.safety_inspections(project_id);
ALTER TABLE public.safety_inspections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "safety_inspections_all_own" ON public.safety_inspections;
CREATE POLICY "safety_inspections_all_own" ON public.safety_inspections
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS safety_inspections_updated_at ON public.safety_inspections;
CREATE TRIGGER safety_inspections_updated_at
  BEFORE UPDATE ON public.safety_inspections
  FOR EACH ROW EXECUTE FUNCTION public.safety_wave_b_set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.safety_inspections TO authenticated;

-- ── certifications ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.certifications (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  worker_id text,               -- → crew_members.id (person anchor); nullable, cert may predate the roster entry. NO FK: keeps the offline queue from failing when a cert syncs before its CrewMember row.
  holder_name text,             -- display fallback when worker_id is null (nullable now that CrewMember is the anchor)
  sub_id text,
  type text NOT NULL DEFAULT '',
  issued_date text,
  expires_date text,
  document_url text,
  status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','expiring','expired')),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS certifications_user_idx ON public.certifications(user_id);
CREATE INDEX IF NOT EXISTS certifications_worker_idx ON public.certifications(worker_id);
CREATE INDEX IF NOT EXISTS certifications_sub_idx ON public.certifications(sub_id);
ALTER TABLE public.certifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "certifications_all_own" ON public.certifications;
CREATE POLICY "certifications_all_own" ON public.certifications
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS certifications_updated_at ON public.certifications;
CREATE TRIGGER certifications_updated_at
  BEFORE UPDATE ON public.certifications
  FOR EACH ROW EXECUTE FUNCTION public.safety_wave_b_set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certifications TO authenticated;

-- ── safety_templates ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.safety_templates (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'general' CHECK (category IN ('jha','inspection','general')),
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS safety_templates_user_idx ON public.safety_templates(user_id);
ALTER TABLE public.safety_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "safety_templates_all_own" ON public.safety_templates;
CREATE POLICY "safety_templates_all_own" ON public.safety_templates
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS safety_templates_updated_at ON public.safety_templates;
CREATE TRIGGER safety_templates_updated_at
  BEFORE UPDATE ON public.safety_templates
  FOR EACH ROW EXECUTE FUNCTION public.safety_wave_b_set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.safety_templates TO authenticated;
