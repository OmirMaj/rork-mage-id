-- ============================================================================
-- HELD — do not apply until the founder decides and B1's client fix is live.
-- See supabase/migrations/held/README.md.
--
-- profiles.tax_rate: default 7.5 → 0.
--
-- Audit IDs: MONEY-F3 (P0) / RT-R3.
--
-- WHY. A tax rate of 0 % saved in Settings comes back as 7.5 % on every
-- synced load, and 7.5 % is then applied to every invoice, progress bill and
-- change-order preview. Three things conspire:
--   1. contexts/ProjectContext.tsx:649   Number(data.tax_rate) || 7.5
--      (0 is falsy, so a real 0 becomes 7.5)              ← B1 fixes this
--   2. DEFAULT_SETTINGS.taxRate = 7.5 on the client        ← B1 / product call
--   3. profiles.tax_rate DEFAULT 7.5 in the database       ← THIS FILE
-- Live 2026-09-04: 30 of 30 profiles hold exactly 7.5 — the column default —
-- and 5 of 5 invoices carry tax. No profile has ever been written with a
-- different value, so "the default" and "the contractor chose 7.5" are
-- indistinguishable in the data.
--
-- ── WHY IT IS HELD ───────────────────────────────────────────────────────────
-- • Applied before B1's null-check ships, the app would read 0 and coerce it
--   straight back to 7.5 on every load; the column change would be invisible
--   and the next audit would call it a lie.
-- • The backfill below rewrites 30 live rows. Whether a contractor who never
--   touched the setting should be at 0 % (and prompted) or stay at 7.5 % is a
--   product decision, not a bug fix. It is left commented out on purpose.
--
-- Idempotent: SET DEFAULT is repeatable; the backfill is guarded by its WHERE.
-- ============================================================================

alter table public.profiles alter column tax_rate set default 0;

comment on column public.profiles.tax_rate is
  'Sales-tax rate in percent applied to invoices. Default 0 since 20260904101000 (MONEY-F3); the app must treat 0 as a real value, never as "unset".';

-- FOUNDER DECISION — uncomment to move every profile still at the OLD default
-- to the new one. All 30 live rows match this predicate today (2026-09-04),
-- so this is a full backfill, not a cleanup of a few strays. If the product
-- answer is "prompt during onboarding instead", leave this commented out and
-- let the prompt write the value.
--
-- update public.profiles set tax_rate = 0 where tax_rate = 7.5;
