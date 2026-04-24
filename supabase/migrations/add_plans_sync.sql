-- ============================================
-- MIGRATION: plan sheets + pins + markups + calibrations
-- ============================================
-- Purpose: promote four related domains from AsyncStorage-only to full
-- Supabase-synced tables so plan markups survive device reinstalls and
-- cross-device edits stay consistent.
--
-- Tables created (all owner-scoped; no cross-user sharing yet):
--   plan_sheets         — one row per drawing page (image uri + metadata)
--   drawing_pins        — normalized (x, y) pins dropped on a sheet
--   plan_markups        — freehand / shape annotations
--   plan_calibrations   — scale reference (2 points + real distance)
--
-- Write path: `contexts/ProjectContext.tsx` now calls `supabaseWrite()`
-- alongside the existing AsyncStorage persist for each of these. Writes
-- fall through the offline queue (`utils/offlineQueue.ts`), so airplane-mode
-- edits replay when connectivity returns.
--
-- RLS pattern mirrors `photos` / `rfis`: user can fully manage their own
-- rows via `user_id = auth.uid()`. Collaborators don't get plan access
-- yet — tracked as a follow-up when the collaborators table goes live.
--
-- Apply order: this depends on `projects` already existing. Safe to run
-- after `schema.sql` and `add_project_collaborators.sql`.

-- --------------------------------------------
-- plan_sheets
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.plan_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  sheet_number TEXT,
  image_uri TEXT NOT NULL,
  page_number INTEGER,
  width NUMERIC,
  height NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_sheets_project ON public.plan_sheets(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_sheets_user ON public.plan_sheets(user_id);

CREATE TRIGGER plan_sheets_updated_at
  BEFORE UPDATE ON public.plan_sheets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.plan_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan_sheets_all_own" ON public.plan_sheets
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- --------------------------------------------
-- drawing_pins
-- --------------------------------------------
-- `kind` is checked here so a rogue client can't stash arbitrary strings
-- that break the UI switch on pin type. Matches the DrawingPinKind union
-- in types/index.ts.
CREATE TABLE IF NOT EXISTS public.drawing_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  plan_sheet_id UUID NOT NULL REFERENCES public.plan_sheets(id) ON DELETE CASCADE,
  x NUMERIC NOT NULL,
  y NUMERIC NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('note', 'photo', 'punch', 'rfi')),
  label TEXT,
  color TEXT,
  linked_photo_id UUID,
  linked_punch_item_id UUID,
  linked_rfi_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drawing_pins_sheet ON public.drawing_pins(plan_sheet_id);
CREATE INDEX IF NOT EXISTS idx_drawing_pins_project ON public.drawing_pins(project_id);
CREATE INDEX IF NOT EXISTS idx_drawing_pins_user ON public.drawing_pins(user_id);

CREATE TRIGGER drawing_pins_updated_at
  BEFORE UPDATE ON public.drawing_pins
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.drawing_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drawing_pins_all_own" ON public.drawing_pins
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- --------------------------------------------
-- plan_markups
-- --------------------------------------------
-- `points` stores the polyline/shape geometry as normalized [0..1] {x,y}
-- objects. Using JSONB keeps the write path cheap (one row per markup)
-- and avoids an N+1 on read for freehand strokes with many points.
CREATE TABLE IF NOT EXISTS public.plan_markups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  plan_sheet_id UUID NOT NULL REFERENCES public.plan_sheets(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('arrow', 'rectangle', 'circle', 'freehand', 'text')),
  color TEXT NOT NULL DEFAULT '#FF0000',
  stroke_width NUMERIC,
  points JSONB NOT NULL DEFAULT '[]'::JSONB,
  text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_markups_sheet ON public.plan_markups(plan_sheet_id);
CREATE INDEX IF NOT EXISTS idx_plan_markups_project ON public.plan_markups(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_markups_user ON public.plan_markups(user_id);

ALTER TABLE public.plan_markups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan_markups_all_own" ON public.plan_markups
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- --------------------------------------------
-- plan_calibrations
-- --------------------------------------------
-- One calibration per sheet (enforced via UNIQUE on plan_sheet_id). The
-- client `upsertPlanCalibration` helper replaces the row when it exists,
-- so the UNIQUE constraint doubles as a data-shape guarantee.
CREATE TABLE IF NOT EXISTS public.plan_calibrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  plan_sheet_id UUID NOT NULL UNIQUE REFERENCES public.plan_sheets(id) ON DELETE CASCADE,
  p1 JSONB NOT NULL,
  p2 JSONB NOT NULL,
  real_distance_ft NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_calibrations_sheet ON public.plan_calibrations(plan_sheet_id);
CREATE INDEX IF NOT EXISTS idx_plan_calibrations_user ON public.plan_calibrations(user_id);

ALTER TABLE public.plan_calibrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan_calibrations_all_own" ON public.plan_calibrations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================
-- Verification query (paste into SQL Editor after apply):
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN ('plan_sheets', 'drawing_pins', 'plan_markups', 'plan_calibrations');
--
-- Expected: four rows.
-- ============================================
