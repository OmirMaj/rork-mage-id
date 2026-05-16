-- 20260515000000_enforce_free_tier_project_cap.sql
--
-- Free-tier project cap (3 projects). Pro / Business = unlimited.
--
-- HISTORY / WHY THIS FILE EXISTS:
--   The `enforce_free_tier_project_cap` function + its trigger were
--   originally created directly against the hosted database (dashboard
--   or an uncommitted MCP migration) and were NEVER checked in. Because
--   the rule lived only in prod, it couldn't be code-reviewed — and a
--   real data-lockout bug shipped undetected (see below). This file
--   makes the DB rule version-controlled and is the source of truth
--   going forward. Always add DB triggers/policies via a committed
--   migration, never the dashboard.
--
-- THE BUG THIS FIXES:
--   The app persists every project — create AND edit — through
--   `supabase.from('projects').upsert()`, i.e. INSERT ... ON CONFLICT
--   DO UPDATE (see contexts/ProjectContext.tsx syncProjectToSupabase →
--   utils/offlineQueue.ts). Postgres fires BEFORE INSERT row-level
--   triggers on EVERY upsert, even when the row already exists and the
--   statement resolves to an UPDATE. The original cap function counted
--   ALL of the user's projects — including the row being edited — so a
--   free user sitting at exactly 3 projects could no longer save an
--   edit to ANY of them (scope, status, schedule, portal toggles, the
--   geocode write-back — all blocked). Hard data lockout, reproduced
--   against a real free account before the fix.
--
-- THE FIX:
--   The cap is about CREATING a 4th project, not TOUCHING the first
--   three. Short-circuit (RETURN NEW) when a project row with NEW.id
--   already exists — that's an upsert-as-update of an existing project,
--   not a new one. Genuine new-project inserts still hit the count
--   check and are still capped at 3 for free tier.

CREATE OR REPLACE FUNCTION public.enforce_free_tier_project_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tier text;
  v_count int;
BEGIN
  -- Upsert-as-update of an existing project must never be capped.
  -- Only the creation of a genuinely new project counts against the
  -- free-tier limit. Cheap primary-key existence check.
  IF EXISTS (SELECT 1 FROM projects WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Pull the user's current tier. Fail OPEN (allow insert) if the
  -- subscriptions row is missing — we'd rather risk an extra free
  -- project than block a legitimate paid user mid-flow.
  SELECT tier INTO v_tier
  FROM subscriptions
  WHERE user_id = NEW.user_id
    AND (end_date IS NULL OR end_date > NOW())
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_tier IS NULL THEN
    v_tier := 'free';
  END IF;

  -- Pro and Business get unlimited projects.
  IF v_tier IN ('pro', 'business') THEN
    RETURN NEW;
  END IF;

  -- Free tier: 3 projects max. Count existing rows for this user.
  SELECT COUNT(*) INTO v_count
  FROM projects
  WHERE user_id = NEW.user_id;

  IF v_count >= 3 THEN
    RAISE EXCEPTION 'Free tier is limited to 3 active projects. Upgrade to Pro for unlimited projects.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- PG14+ supports CREATE OR REPLACE TRIGGER; the DB is Postgres 17.
-- Idempotent so this migration can be re-run safely.
CREATE OR REPLACE TRIGGER enforce_free_tier_project_cap_trigger
  BEFORE INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION enforce_free_tier_project_cap();
