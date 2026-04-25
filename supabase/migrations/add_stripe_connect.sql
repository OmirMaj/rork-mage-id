-- add_stripe_connect.sql
--
-- Stripe Connect Express integration. Each contractor (GC) connects their
-- own Stripe Express account through a hosted onboarding flow; once
-- connected, every invoice payment link they generate routes the money
-- to their account directly (not the platform's). MAGE ID takes a 1%
-- application fee per payment as platform revenue.
--
-- Columns added to public.profiles:
--   stripe_account_id            — Express account id (acct_xxx). NULL until they start onboarding.
--   stripe_charges_enabled       — true once Stripe says the account can accept charges (KYC + bank linked).
--   stripe_details_submitted     — true once the GC finishes the hosted onboarding flow (may still be pending verification).
--   stripe_payouts_enabled       — true once payouts to their bank are enabled.
--   stripe_account_country       — defaults to US; set at account creation time.
--   stripe_connect_started_at    — when the GC first kicked off onboarding (helps surface "complete your setup" nudges).
--   stripe_connect_updated_at    — last time the webhook updated these fields. Used to throttle status polls.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_account_id           TEXT,
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_details_submitted    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_account_country      TEXT DEFAULT 'US',
  ADD COLUMN IF NOT EXISTS stripe_connect_started_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_connect_updated_at   TIMESTAMPTZ;

-- Lookup index — webhook receives account_id and needs to find the
-- corresponding profile fast. Without this, account.updated webhooks
-- table-scan as you grow.
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_account_id
  ON public.profiles(stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;
