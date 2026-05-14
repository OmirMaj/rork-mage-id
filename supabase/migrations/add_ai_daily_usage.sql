-- add_ai_daily_usage.sql
--
-- Closes a production abuse vector that the user reported (May 2026):
-- "I use the AI sometimes and the settings shows I used a token, but I
-- reset the app and my tokens also go back to 0."
--
-- Pre-fix the daily AI quota lived in AsyncStorage only (see
-- utils/aiRateLimiter.ts). Force-quit + reopen kept it; reinstall /
-- "clear app data" wiped it back to 0. The server-side `ai_usage_counters`
-- table was monthly-only, so the per-day fairness UX ("X of Y today") had
-- no persistent backing. A determined user could reinstall daily to
-- repeatedly hit the daily ceiling.
--
-- This migration adds a per-(user, day) counter and the same
-- increment/get RPC shape the existing `ai_usage_*` functions use, so the
-- client can drop in `supabase.rpc(...)` calls in place of AsyncStorage
-- reads.
--
-- Server-side monthly caps in MONTHLY_CAPS already provided the hard
-- abuse ceiling — this migration's job is to make the DAILY counter
-- match reality so the Settings → AI Usage panel can't lie about how
-- much the user has actually consumed.

CREATE TABLE IF NOT EXISTS public.ai_daily_usage (
  user_id      uuid NOT NULL,
  usage_date   date NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  smart_count  integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, usage_date)
);

ALTER TABLE public.ai_daily_usage ENABLE ROW LEVEL SECURITY;

-- Owner-only read. Writes go through SECURITY DEFINER RPCs below, so
-- we don't need a write policy here — clients can't insert/update
-- directly, only via the function.
DROP POLICY IF EXISTS ai_daily_usage_owner_read ON public.ai_daily_usage;
CREATE POLICY ai_daily_usage_owner_read ON public.ai_daily_usage
  FOR SELECT
  USING (auth.uid() = user_id);

-- Increment today's row for the caller. tier = 'fast' or 'smart'.
-- Returns the post-increment (count, smart_count) so the client can
-- show the updated quota without a second round trip.
CREATE OR REPLACE FUNCTION public.ai_daily_usage_increment(
  p_user_id uuid,
  p_tier text DEFAULT 'fast'
)
RETURNS TABLE(count integer, smart_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_date date;
  v_smart_delta int;
BEGIN
  v_date := current_date;
  v_smart_delta := CASE WHEN p_tier = 'smart' THEN 1 ELSE 0 END;

  INSERT INTO ai_daily_usage (user_id, usage_date, count, smart_count, updated_at)
  VALUES (p_user_id, v_date, 1, v_smart_delta, now())
  ON CONFLICT (user_id, usage_date) DO UPDATE
    SET count = ai_daily_usage.count + 1,
        smart_count = ai_daily_usage.smart_count + v_smart_delta,
        updated_at = now();

  RETURN QUERY
    SELECT u.count, u.smart_count
      FROM ai_daily_usage u
     WHERE u.user_id = p_user_id
       AND u.usage_date = v_date
     LIMIT 1;
END;
$function$;

-- Read-only daily usage for the caller. Returns (0, 0) when no row
-- exists yet for today.
CREATE OR REPLACE FUNCTION public.ai_daily_usage_get(p_user_id uuid)
RETURNS TABLE(count integer, smart_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_date date;
BEGIN
  v_date := current_date;
  RETURN QUERY
    SELECT COALESCE(u.count, 0), COALESCE(u.smart_count, 0)
      FROM (SELECT 1) _
      LEFT JOIN ai_daily_usage u
        ON u.user_id = p_user_id
       AND u.usage_date = v_date;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ai_daily_usage_increment(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_daily_usage_get(uuid) TO authenticated, service_role;
