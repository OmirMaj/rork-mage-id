-- Phase 2 (Trust layer): "Verified pros only" RFP mode.
--
-- The single biggest churn driver for contractor lead marketplaces (Angi,
-- Thumbtack, HomeAdvisor — see the FTC case) is leads being blasted to every
-- contractor with no quality bar. This makes contractor verification genuinely
-- *valuable*: a homeowner can choose to have their RFP notified only to
-- verified contractors (companies.license_verified = true), and only verified
-- contractors may bid on it. Verification becomes a moat that retains good
-- contractors instead of a cosmetic badge.
--
-- Additive + NOT NULL with a default → safe and reversible (DROP COLUMN).

ALTER TABLE public.public_bids
  ADD COLUMN IF NOT EXISTS verified_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.public_bids.verified_only IS
  'When true, only verified contractors are notified about and may bid on this homeowner RFP. Counters the shared-lead-blast churn pattern by making contractor verification genuinely valuable.';
