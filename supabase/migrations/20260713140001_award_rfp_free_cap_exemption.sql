-- 20260713140001_award_rfp_free_cap_exemption.sql
--
-- Adversarial-review follow-up to 20260713140000. award_rfp INSERTs the awarded
-- project into the WINNING contractor's account (type='awarded_rfp'); that insert
-- fires enforce_free_tier_project_cap against the winner. If the winner is
-- free-tier and already at their 1-project cap, the whole award transaction would
-- abort with an opaque error. A contractor who WON a marketplace job should never
-- be blocked from receiving it — exempt awarded projects from the free cap.
-- (Latent today: 0 bid_responses; pre-existing at the old cap of 3, this migration
-- only tightened the free cap to 1, widening the window — so close it now.)
--
-- Body is identical to the live 20260713140000 trigger + the awarded_rfp exemption.

create or replace function public.enforce_free_tier_project_cap()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_tier text;
  v_count int;
BEGIN
  IF EXISTS (SELECT 1 FROM projects WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- A project created by winning a marketplace RFP is never capped — the winner
  -- earned it. award_rfp sets type='awarded_rfp' on the inserted project.
  IF NEW.type = 'awarded_rfp' THEN
    RETURN NEW;
  END IF;

  SELECT tier INTO v_tier
  FROM subscriptions
  WHERE user_id = NEW.user_id
    AND (end_date IS NULL OR end_date > NOW())
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_tier IS NULL THEN
    v_tier := 'free';
  END IF;

  IF v_tier IN ('pro', 'business', 'enterprise') THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM projects
  WHERE user_id = NEW.user_id
    AND name NOT LIKE 'Sample — %';

  IF v_count >= 1 THEN
    RAISE EXCEPTION 'Free tier is limited to 1 project. Upgrade to Pro for unlimited projects.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;
