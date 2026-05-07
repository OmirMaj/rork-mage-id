-- add_ai_usage_page_metering.sql
--
-- Page-based metering for AI features that scale with PDF page count.
--
-- Pre-fix the `ai_usage_increment` SQL function hardcoded `+ 1` per call,
-- so a user uploading a 100-page hospital plan set was charged 1 unit of
-- `convert_pdf` quota — same as a kitchen renovation. Sonnet 4.6 / Gemini
-- Pro per-takeoff cost varies 20× depending on page count, so this was
-- both unfair to small projects and abusable on large ones.
--
-- This migration:
--   1. Extends `ai_usage_increment` to accept an optional `p_amount` arg
--      (default 1, so existing call sites keep working) and adds the
--      amount to the monthly bucket atomically.
--   2. Adds `ai_usage_get` — read the current month's count for a
--      (user, feature) pair without incrementing. Used by the new
--      `usage-status` edge function that powers the "X of Y pages
--      remaining this month" badge in the upload UI.
--
-- Both functions share the same SECURITY DEFINER + search_path pin as
-- the original to prevent search-path hijacking by a malicious caller.

-- 1. Extend the increment function (drop required because changing the
--    signature isn't backward-compatible at the function level — existing
--    edge functions still calling the 2-arg form work via the new
--    function's default arg).

DROP FUNCTION IF EXISTS public.ai_usage_increment(uuid, text);
DROP FUNCTION IF EXISTS public.ai_usage_increment(uuid, text, integer);

CREATE OR REPLACE FUNCTION public.ai_usage_increment(
  p_user_id uuid,
  p_feature text,
  p_amount  integer DEFAULT 1
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_month date;
  v_count int;
  v_amount int;
BEGIN
  v_month := date_trunc('month', NOW())::date;
  -- Defensive: never let a forged-zero/negative argument unwind the
  -- counter or stall a request. Always charge at least 1.
  v_amount := GREATEST(COALESCE(p_amount, 1), 1);

  INSERT INTO ai_usage_counters (user_id, month_bucket, feature, count)
  VALUES (p_user_id, v_month, p_feature, v_amount)
  ON CONFLICT (user_id, month_bucket, feature) DO UPDATE
    SET count = ai_usage_counters.count + v_amount
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$function$;

-- 2. Read-without-increment. Returns 0 when no row exists yet for the
--    current month — so the client/edge can compare `used + pageCount`
--    against `cap` BEFORE running an expensive job.

CREATE OR REPLACE FUNCTION public.ai_usage_get(
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
  v_month date;
  v_count int;
BEGIN
  v_month := date_trunc('month', NOW())::date;
  SELECT count INTO v_count
    FROM ai_usage_counters
   WHERE user_id = p_user_id
     AND month_bucket = v_month
     AND feature = p_feature
   LIMIT 1;
  RETURN COALESCE(v_count, 0);
END;
$function$;

-- 3. Summary helper — return ALL features used this month in one round
--    trip. Used by Settings → AI Usage panel to render the per-feature
--    progress bars. Saves N+1 round trips if the panel grows over time.

CREATE OR REPLACE FUNCTION public.ai_usage_summary(p_user_id uuid)
RETURNS TABLE(feature text, used integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_month date;
BEGIN
  v_month := date_trunc('month', NOW())::date;
  RETURN QUERY
    SELECT u.feature, u.count
      FROM ai_usage_counters u
     WHERE u.user_id = p_user_id
       AND u.month_bucket = v_month;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ai_usage_increment(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_usage_get(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_usage_summary(uuid) TO authenticated, service_role;
