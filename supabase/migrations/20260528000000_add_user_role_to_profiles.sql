-- Adds the user_role column to profiles so the app can branch between
-- the contractor experience (the original product) and the property-owner /
-- real-estate-client experience (post-RFP, hire, manage at arm's length).
--
-- 'both' covers users who genuinely wear both hats — a GC who also flips
-- houses on the side, or a property manager who self-performs small repairs.
-- The UI defaults them to contractor mode with a one-tap persona switch.
--
-- Grandfathering: any user who has already completed onboarding before this
-- migration is treated as a contractor (the only persona that existed prior
-- to this column). That way existing users don't get bounced to the new
-- persona-select screen on their next launch.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS user_role TEXT
  CHECK (user_role IN ('contractor', 'client', 'both'));

UPDATE public.profiles
  SET user_role = 'contractor'
  WHERE user_role IS NULL AND onboarding_complete = TRUE;
