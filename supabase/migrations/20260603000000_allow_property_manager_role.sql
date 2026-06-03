-- Extends profiles.user_role to allow the 'property_manager' persona — the
-- recurring-demand / portfolio-maintenance experience (managed properties +
-- work orders that get dispatched to contractors).
--
-- The original column (20260528000000) constrained user_role to
-- ('contractor','client','both'). We drop that CHECK and re-add it with the
-- new value included. Additive and reversible; no data is touched.
--
-- NULL stays valid (a brand-new user before persona-select). CHECK passes on
-- NULL implicitly, but we keep the IN-list semantics identical to the
-- original migration for clarity.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_user_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_user_role_check
  CHECK (user_role IN ('contractor', 'client', 'both', 'property_manager'));
