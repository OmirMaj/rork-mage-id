-- 20260713130000_pin_ai_usage_rpcs_to_authuid.sql
--
-- Close a cross-user quota-abuse + usage-leak hole in the AI usage RPCs.
--
-- These SEVEN SECURITY DEFINER functions are GRANTed to `authenticated` and used
-- `p_user_id` VERBATIM. Because SECURITY DEFINER bypasses the owner-only RLS on
-- ai_usage_counters / ai_daily_usage, any signed-in user could call them with
-- ANOTHER user's uuid:
--
-- NOTE ON PROD DIVERGENCE: the repo migration 20260525120000 defines
-- ai_usage_daily_get/increment WITH the pin and reading ai_feature_daily_usage,
-- but the LIVE prod functions (verified via pg_get_functiondef on
-- nteoqhcswappxxjlpvap, 2026-07-13) are UNPINNED and read/write the monthly
-- ai_usage_counters table keyed by CURRENT_DATE. This migration pins ALL SEVEN
-- unpinned prod functions, faithfully PRESERVING each prod body (including the
-- ai_usage_daily_* CURRENT_DATE behavior) and adding ONLY the security pin — it
-- deliberately does NOT "fix" that pre-existing divergence, which is a separate
-- concern. All five monthly/daily bodies below were confirmed byte-equivalent to
-- the deployed prod definitions before the pin was added.
--   • ai_usage_increment(victim, 'ai_text', 2147483647) → instantly max out the
--     victim's monthly cap so the relay 429s them for the rest of the month (a
--     silent denial-of-service on a paying user's AI).
--   • ai_usage_get / ai_usage_summary / ai_daily_usage_get(victim) → read any
--     user's usage (privacy leak).
--   • ai_daily_usage_increment(victim) → inflate a victim's daily fairness meter.
--
-- Fix = the SAME pin the newer ai_usage_daily_* functions already use
-- (20260525120000): v_uid := COALESCE(auth.uid(), p_user_id). For an end user
-- (JWT present) auth.uid() forces their own id, so a forged p_user_id is
-- ignored. Edge functions call via service_role (auth.uid() null) → falls
-- through to p_user_id, which is the server-VERIFIED user id — so the metering
-- edge path is unchanged. Every client caller already passes its own id, so the
-- pin is transparent to them. Signatures/return types/grants are unchanged.

-- ── Monthly counters (ai_usage_counters) ──────────────────────────────────
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
  v_uid   uuid;
  v_month date;
  v_count int;
  v_amount int;
BEGIN
  v_uid := COALESCE(auth.uid(), p_user_id);
  v_month := date_trunc('month', NOW())::date;
  v_amount := GREATEST(COALESCE(p_amount, 1), 1);

  INSERT INTO ai_usage_counters (user_id, month_bucket, feature, count)
  VALUES (v_uid, v_month, p_feature, v_amount)
  ON CONFLICT (user_id, month_bucket, feature) DO UPDATE
    SET count = ai_usage_counters.count + v_amount
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$function$;

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
  v_uid   uuid;
  v_month date;
  v_count int;
BEGIN
  v_uid := COALESCE(auth.uid(), p_user_id);
  v_month := date_trunc('month', NOW())::date;
  SELECT count INTO v_count
    FROM ai_usage_counters
   WHERE user_id = v_uid
     AND month_bucket = v_month
     AND feature = p_feature
   LIMIT 1;
  RETURN COALESCE(v_count, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ai_usage_summary(p_user_id uuid)
RETURNS TABLE(feature text, used integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid;
  v_month date;
BEGIN
  v_uid := COALESCE(auth.uid(), p_user_id);
  v_month := date_trunc('month', NOW())::date;
  RETURN QUERY
    SELECT u.feature, u.count
      FROM ai_usage_counters u
     WHERE u.user_id = v_uid
       AND u.month_bucket = v_month;
END;
$function$;

-- ── Daily counters (ai_daily_usage) ───────────────────────────────────────
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
  v_uid   uuid;
  v_date  date;
  v_smart_delta int;
BEGIN
  v_uid := COALESCE(auth.uid(), p_user_id);
  v_date := current_date;
  v_smart_delta := CASE WHEN p_tier = 'smart' THEN 1 ELSE 0 END;

  INSERT INTO ai_daily_usage (user_id, usage_date, count, smart_count, updated_at)
  VALUES (v_uid, v_date, 1, v_smart_delta, now())
  ON CONFLICT (user_id, usage_date) DO UPDATE
    SET count = ai_daily_usage.count + 1,
        smart_count = ai_daily_usage.smart_count + v_smart_delta,
        updated_at = now();

  RETURN QUERY
    SELECT u.count, u.smart_count
      FROM ai_daily_usage u
     WHERE u.user_id = v_uid
       AND u.usage_date = v_date
     LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ai_daily_usage_get(p_user_id uuid)
RETURNS TABLE(count integer, smart_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid;
  v_date date;
BEGIN
  v_uid := COALESCE(auth.uid(), p_user_id);
  v_date := current_date;
  RETURN QUERY
    SELECT COALESCE(u.count, 0), COALESCE(u.smart_count, 0)
      FROM (SELECT 1) _
      LEFT JOIN ai_daily_usage u
        ON u.user_id = v_uid
       AND u.usage_date = v_date;
END;
$function$;

-- ── Per-feature daily counters (ai_usage_daily_*) ─────────────────────────
-- Prod's deployed versions diverge from repo 20260525120000: they read/write
-- the monthly ai_usage_counters table keyed by CURRENT_DATE (not
-- ai_feature_daily_usage). We preserve that exact behavior and add ONLY the pin.
CREATE OR REPLACE FUNCTION public.ai_usage_daily_get(
  p_user_id uuid,
  p_feature text
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT count FROM ai_usage_counters
      WHERE user_id = COALESCE(auth.uid(), p_user_id)
        AND feature = p_feature
        AND month_bucket = CURRENT_DATE),
    0
  );
$function$;

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
  v_today date;
  v_count int;
BEGIN
  v_uid := COALESCE(auth.uid(), p_user_id);
  v_today := CURRENT_DATE;
  INSERT INTO ai_usage_counters (user_id, month_bucket, feature, count)
  VALUES (v_uid, v_today, p_feature, 1)
  ON CONFLICT (user_id, month_bucket, feature) DO UPDATE
    SET count = ai_usage_counters.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$function$;

-- ── Revoke anon ───────────────────────────────────────────────────────────
-- The COALESCE(auth.uid(), p_user_id) pin forces an AUTHENTICATED caller to
-- their own id, but an ANON caller (public anon key) also has a null auth.uid(),
-- so the COALESCE would fall through to p_user_id and let anon forge a victim id.
-- These counters are only ever written for an authenticated user (client passes
-- its session) or by service_role edge functions; the AI relay itself rejects
-- anon, so nothing legitimately calls these anonymously. Revoke anon to close
-- the anon-forge vector. (authenticated + service_role grants stay.)
REVOKE EXECUTE ON FUNCTION public.ai_usage_increment(uuid, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ai_usage_get(uuid, text)                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.ai_usage_summary(uuid)                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.ai_daily_usage_increment(uuid, text)     FROM anon;
REVOKE EXECUTE ON FUNCTION public.ai_daily_usage_get(uuid)                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.ai_usage_daily_get(uuid, text)           FROM anon;
REVOKE EXECUTE ON FUNCTION public.ai_usage_daily_increment(uuid, text)     FROM anon;
