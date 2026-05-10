-- draw_periods + sub_change_requests — PM audit's #2 and #4 missing
-- workflow primitives.
--
-- draw_periods: ties together the AIA pay app + sub invoices + lien
-- waivers for ONE billing cycle. Lender-facing ritual every loan-
-- funded residential job runs monthly. Pre-fix the GC tracked these
-- siblings independently with no "this is for THIS draw" grouping.
--
-- sub_change_requests: lightweight inbox for sub-initiated extras.
-- Sub portal posts a request with photo + price; GC reviews and
-- approves into a ChangeOrder draft (or rejects). Pre-fix subs had
-- to call/text the GC who re-typed everything into the CO form.
--
-- Idempotent.

-- ─── draw_periods ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.draw_periods (
  id                UUID PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id        UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  number            INTEGER NOT NULL,
  label             TEXT NOT NULL,
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                      'open', 'submitted', 'approved', 'funded', 'closed'
                    )),
  aia_pay_app_id    UUID,
  invoice_ids       JSONB NOT NULL DEFAULT '[]'::jsonb,
  lien_waiver_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  amount_requested  NUMERIC(12, 2),
  amount_approved   NUMERIC(12, 2),
  amount_funded     NUMERIC(12, 2),
  submitted_at      TIMESTAMPTZ,
  approved_at       TIMESTAMPTZ,
  funded_at         TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_draw_periods_project_number
  ON public.draw_periods (project_id, number);

CREATE INDEX IF NOT EXISTS idx_draw_periods_user_status
  ON public.draw_periods (user_id, status);

ALTER TABLE public.draw_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS draw_periods_select_own ON public.draw_periods;
CREATE POLICY draw_periods_select_own ON public.draw_periods
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS draw_periods_insert_own ON public.draw_periods;
CREATE POLICY draw_periods_insert_own ON public.draw_periods
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS draw_periods_update_own ON public.draw_periods;
CREATE POLICY draw_periods_update_own ON public.draw_periods
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS draw_periods_delete_own ON public.draw_periods;
CREATE POLICY draw_periods_delete_own ON public.draw_periods
  FOR DELETE USING (auth.uid() = user_id);

-- ─── sub_change_requests ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sub_change_requests (
  id                          UUID PRIMARY KEY,
  user_id                     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id                  UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  sub_portal_id               TEXT NOT NULL,
  sub_name                    TEXT NOT NULL,
  description                 TEXT NOT NULL,
  amount                      NUMERIC(12, 2) NOT NULL,
  schedule_impact_days        INTEGER,
  photos                      JSONB DEFAULT '[]'::jsonb,
  notes                       TEXT,
  status                      TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
                                'submitted', 'approved', 'rejected', 'needs_revision'
                              )),
  resulting_change_order_id   UUID,
  review_notes                TEXT,
  submitted_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at                 TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_change_requests_user_status
  ON public.sub_change_requests (user_id, status);

CREATE INDEX IF NOT EXISTS idx_sub_change_requests_project
  ON public.sub_change_requests (project_id);

CREATE INDEX IF NOT EXISTS idx_sub_change_requests_sub_portal
  ON public.sub_change_requests (sub_portal_id);

ALTER TABLE public.sub_change_requests ENABLE ROW LEVEL SECURITY;

-- GC reads: their own rows.
DROP POLICY IF EXISTS sub_change_requests_select_own ON public.sub_change_requests;
CREATE POLICY sub_change_requests_select_own ON public.sub_change_requests
  FOR SELECT USING (auth.uid() = user_id);

-- GC writes: own rows.
DROP POLICY IF EXISTS sub_change_requests_update_own ON public.sub_change_requests;
CREATE POLICY sub_change_requests_update_own ON public.sub_change_requests
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS sub_change_requests_delete_own ON public.sub_change_requests;
CREATE POLICY sub_change_requests_delete_own ON public.sub_change_requests
  FOR DELETE USING (auth.uid() = user_id);

-- Sub-side INSERTs go through a SECURITY DEFINER RPC that takes the
-- sub_portal_id as a bearer token and writes on behalf of the
-- project's owner. The same pattern as portal_snapshots — direct
-- anon writes are blocked.
DROP POLICY IF EXISTS sub_change_requests_no_anon_write ON public.sub_change_requests;
CREATE POLICY sub_change_requests_no_anon_write ON public.sub_change_requests
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.submit_sub_change_request(
  sub_portal_id_in TEXT,
  description_in   TEXT,
  amount_in        NUMERIC,
  schedule_impact_days_in INTEGER DEFAULT NULL,
  photos_in        JSONB DEFAULT '[]'::jsonb,
  notes_in         TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_project_id UUID;
  v_user_id    UUID;
  v_sub_name   TEXT;
  v_request_id UUID;
BEGIN
  -- Resolve the sub portal link → project + sub name + GC user.
  SELECT spl.project_id, p.user_id, COALESCE(spl.sub_name, 'Sub')
    INTO v_project_id, v_user_id, v_sub_name
    FROM public.sub_portal_links spl
    JOIN public.projects p ON p.id = spl.project_id
   WHERE spl.sub_portal_id = sub_portal_id_in
   LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Invalid sub portal token';
  END IF;

  v_request_id := gen_random_uuid();

  INSERT INTO public.sub_change_requests (
    id, user_id, project_id, sub_portal_id, sub_name,
    description, amount, schedule_impact_days, photos, notes,
    status, submitted_at
  ) VALUES (
    v_request_id, v_user_id, v_project_id, sub_portal_id_in, v_sub_name,
    description_in, amount_in, schedule_impact_days_in, photos_in, notes_in,
    'submitted', NOW()
  );

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_sub_change_request(TEXT, TEXT, NUMERIC, INTEGER, JSONB, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_sub_change_request(TEXT, TEXT, NUMERIC, INTEGER, JSONB, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_sub_change_request(TEXT, TEXT, NUMERIC, INTEGER, JSONB, TEXT) TO authenticated;
