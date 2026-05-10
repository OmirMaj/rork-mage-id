-- QuickBooks Online OAuth connection state. One row per (user_id,
-- realmId) — a single GC could in principle connect multiple QBO
-- companies, e.g. a parent + sub-entity. Most won't, but the unique
-- index lets the schema handle it without breaking.
--
-- Tokens are stored server-side only. The mobile client never sees
-- the access_token directly — instead it asks the qbo-api-proxy edge
-- function to make calls on its behalf. Same trust model as
-- Stripe Connect: secrets stay on the server.
--
-- Token shape (Intuit OAuth 2.0):
--   - access_token: opaque bearer, ~1h expiry. Refreshed via the
--     refresh_token before every call when expires_at < now() + 5m.
--   - refresh_token: opaque, 100-day expiry (Intuit policy). When
--     it expires the user re-authorizes — we can't recover.
--   - realmId: the QBO company id. Required on every API call.
--   - scope: comma-joined list of granted scopes (com.intuit.quickbooks.accounting
--     is the standard one; we may add com.intuit.quickbooks.payment later).
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.quickbooks_connections (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  realm_id           TEXT NOT NULL,
  access_token       TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  refresh_token      TEXT NOT NULL,
  refresh_token_expires_at TIMESTAMPTZ,
  scope              TEXT,
  /** Sandbox or production. Sandbox uses sandbox-quickbooks.api.intuit.com
   *  while production uses quickbooks.api.intuit.com. We persist this so
   *  the API proxy can route requests to the correct host. */
  environment        TEXT NOT NULL DEFAULT 'production'
    CHECK (environment IN ('sandbox', 'production')),
  /** ISO timestamp at which we last successfully called any QBO endpoint
   *  for this connection. Surfaces in the UI as "Last sync: 2 min ago"
   *  so the user knows the integration is healthy. */
  last_used_at       TIMESTAMPTZ,
  /** Optional company display name — the GC's QBO company name. We
   *  fetch CompanyInfo right after token exchange to populate this so
   *  the Settings screen can show "Connected to: Acme Construction LLC"
   *  rather than just an opaque realm id. */
  company_name       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One connection per (user, realm). Re-authorizing the SAME company
-- updates the existing row instead of inserting a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_qbo_connections_user_realm
  ON public.quickbooks_connections (user_id, realm_id);

CREATE INDEX IF NOT EXISTS idx_qbo_connections_user
  ON public.quickbooks_connections (user_id);

ALTER TABLE public.quickbooks_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qbo_select_own ON public.quickbooks_connections;
CREATE POLICY qbo_select_own ON public.quickbooks_connections
  FOR SELECT USING (auth.uid() = user_id);

-- INSERT / UPDATE / DELETE go through the service-role from edge
-- functions — the client never writes tokens directly.
DROP POLICY IF EXISTS qbo_no_client_write ON public.quickbooks_connections;
CREATE POLICY qbo_no_client_write ON public.quickbooks_connections
  FOR ALL USING (false) WITH CHECK (false);

-- ── Pending OAuth state ────────────────────────────────────────
-- Anti-CSRF: when the client kicks off OAuth we generate a random
-- state token, persist it here, and the callback edge function only
-- accepts the auth code if the state matches and is < 10 minutes
-- old. Without this an attacker could craft a callback URL that
-- assigns their QBO company to a victim's account.
--
-- We don't reference auth.users here because the OAuth start
-- happens on the unauthenticated leg of a deep-link round trip
-- (the user is signed in to the app but the browser is not).
-- The state token IS the bearer; binding to user_id at this stage
-- adds no security and complicates the redirect URL.

CREATE TABLE IF NOT EXISTS public.quickbooks_oauth_state (
  state              TEXT PRIMARY KEY,
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_to        TEXT,  -- in-app destination after success
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);

CREATE INDEX IF NOT EXISTS idx_qbo_oauth_state_user
  ON public.quickbooks_oauth_state (user_id);

ALTER TABLE public.quickbooks_oauth_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qbo_state_select_own ON public.quickbooks_oauth_state;
CREATE POLICY qbo_state_select_own ON public.quickbooks_oauth_state
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS qbo_state_no_client_write ON public.quickbooks_oauth_state;
CREATE POLICY qbo_state_no_client_write ON public.quickbooks_oauth_state
  FOR ALL USING (false) WITH CHECK (false);
