-- Tracks user demand for not-yet-shipped integrations. Replaces the
-- "Notify me" Alert handler in app/integrations.tsx that previously
-- just popped a confirmation toast and dropped the request on the
-- floor. Now: every tap is a real row that the team can prioritize
-- against (sort by COUNT(*), filter by tier).
--
-- Schema notes:
--   - integration_id is the same string id from data/integrations.ts
--     (e.g. 'quickbooks', 'xero', 'docusign'), so we can JOIN against
--     the catalog when reporting.
--   - One row per (user_id, integration_id) pair — UPSERT semantics
--     enforced by the unique index. Re-tapping bumps requested_at +
--     count so we know who keeps asking.
--   - notes lets the user type a free-text reason the next time we
--     surface a "tell us why" prompt (not in v1; field reserved).
--
-- RLS: users can read + write their own rows only. Aggregate counts
-- are run server-side via service role.

CREATE TABLE IF NOT EXISTS public.integration_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  integration_id  TEXT NOT NULL,
  notes           TEXT,
  request_count   INTEGER NOT NULL DEFAULT 1,
  first_requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_requests_unique
  ON public.integration_requests (user_id, integration_id);

CREATE INDEX IF NOT EXISTS idx_integration_requests_integration
  ON public.integration_requests (integration_id);

ALTER TABLE public.integration_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integration_requests_select_own ON public.integration_requests;
CREATE POLICY integration_requests_select_own ON public.integration_requests
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS integration_requests_insert_own ON public.integration_requests;
CREATE POLICY integration_requests_insert_own ON public.integration_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS integration_requests_update_own ON public.integration_requests;
CREATE POLICY integration_requests_update_own ON public.integration_requests
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
