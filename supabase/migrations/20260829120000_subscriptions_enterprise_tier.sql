-- ============================================================================
-- subscriptions.tier — allow 'enterprise'.
--
-- WHY. The CHECK constraint was written as
--     CHECK (tier = ANY (ARRAY['free','pro','business']))
-- while the app has shipped a FOURTH tier the whole time:
--   • contexts/SubscriptionContext.tsx:120 resolves the 'enterprise' entitlement
--   • utils/featureTiers.ts:109 types requiredTier as
--     'free' | 'pro' | 'business' | 'enterprise'
--   • CLAUDE.md prices it at $150/mo
--
-- So the RevenueCat webhook, on an Enterprise purchase, wrote tier='enterprise'
-- and Postgres rejected it with 23514. The webhook's failure is not surfaced to
-- the buyer, so the outcome was: a customer pays $150/month, their subscription
-- row never records the tier, and every server-side requireTier() check treats
-- them as FREE. They are charged and get nothing, and nothing in the product
-- says why.
--
-- This is the same shape as notification_outbox.recipient_kind (a value the app
-- writes that the schema forbids, with the rejection swallowed) — the third
-- instance found in this codebase. scripts/validate-outbox-contract.ts guards
-- that one; the general lesson is that a CHECK constraint is a contract the
-- client half must be held to.
--
-- Idempotent: drops the old constraint by name and recreates it widened.
-- ============================================================================

alter table public.subscriptions
  drop constraint if exists subscriptions_tier_check;

alter table public.subscriptions
  add constraint subscriptions_tier_check
  check (tier = any (array['free'::text, 'pro'::text, 'business'::text, 'enterprise'::text]));

comment on constraint subscriptions_tier_check on public.subscriptions is
  'Must stay in sync with the SubscriptionTier union in types/ and the entitlement names RevenueCat grants. A tier the app can produce but this constraint forbids means a paying customer is silently downgraded to free.';
