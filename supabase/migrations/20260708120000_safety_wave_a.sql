-- 20260708120000_safety_wave_a.sql
-- Safety Management — Wave A tables (JHAs, Toolbox Talks, Incidents, Hazards).
--
-- All additive. RLS scoped to the owning user (auth.uid() = user_id), mirroring
-- punch_items. JSONB columns hold the nested arrays the client owns as a unit
-- (steps, sign_offs, attendees, people_involved, corrective_actions). Apply to
-- PROD before the OTA that writes these tables — same PGRST204 gate discipline
-- as 20260707120000_punch_location.sql (an OTA that writes a column the live
-- schema lacks fails silently in supabaseWrite).

-- ── JHAs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.jhas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  trade TEXT DEFAULT '',
  task_description TEXT DEFAULT '',
  date TEXT DEFAULT '',
  steps JSONB DEFAULT '[]'::JSONB,
  required_ppe JSONB DEFAULT '[]'::JSONB,
  sign_offs JSONB DEFAULT '[]'::JSONB,
  plan_sheet_id TEXT,
  pin_x DOUBLE PRECISION,
  pin_y DOUBLE PRECISION,
  ai_generated BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jhas_project ON public.jhas(project_id);
ALTER TABLE public.jhas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jhas_select_own" ON public.jhas FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "jhas_insert_own" ON public.jhas FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "jhas_update_own" ON public.jhas FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "jhas_delete_own" ON public.jhas FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER jhas_updated_at BEFORE UPDATE ON public.jhas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Toolbox Talks ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.toolbox_talks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  date TEXT DEFAULT '',
  presenter TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  attachment_url TEXT,
  attendees JSONB DEFAULT '[]'::JSONB,
  ai_topic_source TEXT CHECK (ai_topic_source IN ('incident', 'hazard', 'weather', 'manual')),
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_toolbox_talks_project ON public.toolbox_talks(project_id);
ALTER TABLE public.toolbox_talks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "toolbox_select_own" ON public.toolbox_talks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "toolbox_insert_own" ON public.toolbox_talks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "toolbox_update_own" ON public.toolbox_talks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "toolbox_delete_own" ON public.toolbox_talks FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER toolbox_talks_updated_at BEFORE UPDATE ON public.toolbox_talks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Safety Incidents ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.safety_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('injury', 'near_miss', 'property', 'environmental')),
  severity TEXT DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  occurred_at TEXT DEFAULT '',
  description TEXT DEFAULT '',
  location TEXT DEFAULT '',
  plan_sheet_id TEXT,
  pin_x DOUBLE PRECISION,
  pin_y DOUBLE PRECISION,
  people_involved JSONB DEFAULT '[]'::JSONB,
  photo_urls JSONB DEFAULT '[]'::JSONB,
  corrective_actions JSONB DEFAULT '[]'::JSONB,
  treatment TEXT DEFAULT 'none' CHECK (treatment IN ('none', 'first_aid', 'medical_beyond_first_aid')),
  days_away INTEGER DEFAULT 0,
  restricted_duty BOOLEAN DEFAULT FALSE,
  lost_consciousness BOOLEAN DEFAULT FALSE,
  fatality BOOLEAN DEFAULT FALSE,
  osha_recordable BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'closed')),
  reported_by TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_project ON public.safety_incidents(project_id);
ALTER TABLE public.safety_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incidents_select_own" ON public.safety_incidents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "incidents_insert_own" ON public.safety_incidents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "incidents_update_own" ON public.safety_incidents FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "incidents_delete_own" ON public.safety_incidents FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER safety_incidents_updated_at BEFORE UPDATE ON public.safety_incidents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Hazards ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hazards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  location TEXT DEFAULT '',
  photo_url TEXT,
  severity INTEGER DEFAULT 1 CHECK (severity BETWEEN 1 AND 5),
  likelihood INTEGER DEFAULT 1 CHECK (likelihood BETWEEN 1 AND 5),
  risk_score INTEGER DEFAULT 1,
  plan_sheet_id TEXT,
  pin_x DOUBLE PRECISION,
  pin_y DOUBLE PRECISION,
  assigned_to TEXT,
  due_date TEXT,
  corrective_action TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'mitigated', 'closed')),
  source_inspection_id TEXT,
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hazards_project ON public.hazards(project_id);
ALTER TABLE public.hazards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hazards_select_own" ON public.hazards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "hazards_insert_own" ON public.hazards FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "hazards_update_own" ON public.hazards FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "hazards_delete_own" ON public.hazards FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER hazards_updated_at BEFORE UPDATE ON public.hazards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
