-- Adds the push-token column to profiles. The mobile app's
-- NotificationContext writes this on every authenticated render (when
-- Expo returns a token); the notify edge function reads it to fan out
-- pushes for portal_message, budget_proposal, co_approval, sub_invoice,
-- bid_question_answered, and the morning digest.
--
-- Pre-fix the writes from NotificationContext were silently failing
-- because this column wasn't tracked in migrations; if it had been
-- removed from a fresh DB the entire push pipeline would have been
-- dead-on-arrival even though the client was registering correctly.
--
-- Idempotent — safe to re-run on environments where the column was
-- added by hand earlier.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS push_token TEXT,
  ADD COLUMN IF NOT EXISTS push_token_platform TEXT
    CHECK (push_token_platform IN ('ios', 'android', 'web') OR push_token_platform IS NULL),
  ADD COLUMN IF NOT EXISTS push_token_updated_at TIMESTAMPTZ;

-- Index for the notify function's lookup pattern. The function reads
-- push_token by user id, so the existing PK on id already covers it,
-- but the platform column is queried independently when we want to
-- target only iOS or only Android (e.g. iOS-only feature flags).
CREATE INDEX IF NOT EXISTS idx_profiles_push_token_platform
  ON public.profiles (push_token_platform)
  WHERE push_token IS NOT NULL;
