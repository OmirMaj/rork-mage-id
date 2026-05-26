-- 20260525120000_ai_feature_daily_usage.sql
--
-- Per-(user, feature, day) daily counter that backs the client-side daily
-- caps on the Construction AI screen — Code Check, Project Roadmap, and
-- Plan Review (app/(tabs)/construction-ai/index.tsx).
--
-- Root cause this closes: that screen calls
--     supabase.rpc('ai_usage_daily_get'      , { p_user_id, p_feature })
--     supabase.rpc('ai_usage_daily_increment', { p_user_id, p_feature })
-- and parses the result as a scalar integer. No such functions existed.
-- The only daily functions were the GLOBAL ai_daily_usage_get/increment
-- (note the reversed word order) used by utils/aiRateLimiter.ts — those are
-- keyed per (user, day) with NO feature dimension and RETURN TABLE(...), not
-- a scalar. So PostgREST answered every call with PGRST202 (function not
-- found); the client swallowed it and read 0, so the per-feature DAILY caps
-- (FEATURE_LIMITS.*_daily in hooks/useTierAccess.ts) never enforced.
--
-- The hard abuse ceiling was unaffected — edge functions enforce MONTHLY
-- caps (MONTHLY_CAPS in supabase/functions/_shared/auth.ts) and the text
-- relay enforces ai_text. This migration restores the per-feature DAILY UX
-- cap with ZERO client changes (the client already calls these exact names).
--
-- Table is named ai_feature_daily_usage (not ai_usage_daily) on purpose, to
-- avoid sitting one word-transposition away from the existing global
-- ai_daily_usage table — that near-collision is what produced the bug.

CREATE TABLE IF NOT EXISTS public.ai_feature_daily_usage (
  user_id    uuid        NOT NULL,
  usage_date date        NOT NULL,
  feature    text        NOT NULL,
  count      integer     NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, usage_date, feature)
);

ALTER TABLE public.ai_feature_daily_usage ENABLE ROW LEVEL SECURITY;

-- Owner-only read. Writes go through the SECURITY DEFINER RPC below, so no
-- write policy is needed — clients can't insert/update directly, only via
-- the function. Mirrors the ai_daily_usage owner-read pattern.
DROP POLICY IF EXISTS ai_feature_daily_usage_owner_read ON public.ai_feature_daily_usage;
CREATE POLICY ai_feature_daily_usage_owner_read ON public.ai_feature_daily_usage
  FOR SELECT
  USING (auth.uid() = user_id);

-- Read today's count for (caller, feature). Returns 0 when no row exists yet.
-- DROP first because a prior hand-applied variant with a different return
-- type (e.g. RETURNS TABLE) can't be swapped via CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.ai_usage_daily_get(uuid, text);
CREATE OR REPLACE FUNCTION public.ai_usage_daily_get(
  p_user_id uuid,
  p_feature text
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid;
  v_count integer;
BEGIN
  -- End users (JWT present) are pinned to their own id so a forged
  -- p_user_id can't read another user's counter or dodge their own cap by
  -- passing a random uuid. service_role (auth.uid() null) may act for any
  -- user, which the edge functions rely on.
  v_uid := COALESCE(auth.uid(), p_user_id);

  SELECT count INTO v_count
    FROM ai_feature_daily_usage
   WHERE user_id = v_uid
     AND usage_date = current_date
     AND feature = p_feature
   LIMIT 1;

  RETURN COALESCE(v_count, 0);
END;
$function$;

-- Increment today's count for (caller, feature) by 1 and return the new
-- value, so the client gets the post-increment number in one round trip.
DROP FUNCTION IF EXISTS public.ai_usage_daily_increment(uuid, text);
CREATE OR REPLACE FUNCTION public.ai_usage_daily_increment(
  p_user_id uuid,
  p_feature text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid;
  v_count integer;
BEGIN
  v_uid := COALESCE(auth.uid(), p_user_id);

  INSERT INTO ai_feature_daily_usage (user_id, usage_date, feature, count, updated_at)
  VALUES (v_uid, current_date, p_feature, 1, now())
  ON CONFLICT (user_id, usage_date, feature) DO UPDATE
    SET count = ai_feature_daily_usage.count + 1,
        updated_at = now()
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ai_usage_daily_get(uuid, text)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_usage_daily_increment(uuid, text) TO authenticated, service_role;
