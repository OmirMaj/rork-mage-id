-- 20260923040000_project_cap_on_rename.sql — audit wave 5, #156 (+ #1, #127)
--
-- WHY. The free plan's one-project cap (enforce_free_tier_project_cap) ran
-- BEFORE INSERT only and exempts demo rows by name ('Sample — %'). A free user
-- could therefore make any number of 'Sample — Job A', 'Sample — Job B' rows
-- (typed in New Project, or by duplicating a sample) and rename each one to a
-- real job afterwards: the rename is an UPDATE, which nothing checked. The
-- trigger now also fires on UPDATE OF name and polices the one moment that
-- matters — a row that stops being a sample.
--
-- WHAT. The function is restated from the LIVE body (20260922100000, read back
-- with pg_get_functiondef on 2026-09-23: SECURITY DEFINER, search_path
-- 'public', the is_master_account early return). Changes:
--
--   1. A NEW.name that is a sample is always allowed, on INSERT and UPDATE.
--      Samples never count, so creating one cannot take him over the cap; the
--      old body refused a free user at the cap who seeded the demo project.
--   2. INSERT keeps the upsert-as-update early return and the awarded_rfp
--      exemption — but the exemption is now honoured only when the insert is
--      NOT the winner's own session (auth.uid() is null — service role — or
--      differs from NEW.user_id). award_rfp runs SECURITY DEFINER under the
--      homeowner's session (or the award-rfp edge function's service role) and
--      inserts user_id = the winner, so the award itself still passes; a free
--      client POSTing its own row with type 'awarded_rfp' is capped like any
--      other insert.
--   3. UPDATE returns NEW unless OLD.name is a sample and NEW.name is not. No
--      awarded_rfp exemption on UPDATE. The owner is OLD.user_id (ownership
--      columns are pinned by projects_freeze_ownership, which fires after this
--      trigger alphabetically, so NEW.user_id is not trusted here).
--      At the cap the UPDATE is NOT refused: the name is PINNED
--      (NEW.name := OLD.name) and the rest of the row lands. The app sends
--      `name` on every project write (ProjectContext builds the same base row
--      for the owner upsert and the shared PATCH), so a refused rename would
--      leave the phone's name different from the server's and every later
--      write of that job - schedule, status, estimate, closeout - would be
--      refused with it, retried and then dropped by the offline queue. The
--      house rule for guard triggers a replayed client write can hit: pin
--      silently. The next server-first load puts the sample name back on the
--      phone; the client rename gate (project-detail) says why beforehand.
--   4. The count is EXACTLY the live rule on both paths — the owner's rows whose
--      name is not a sample, with NO type filter (an awarded-RFP job he owns
--      counts once it exists: productDecision #127) — plus `id <> NEW.id`.
--   5. The INSERT refusal is unchanged: check_violation (23514), message
--      starting 'Free tier is limited to 1 project' (CONTRACT 21 — the client's
--      queue classification keys on that text). Only INSERT raises; a new row
--      the server won't take must be reported, and it carries no other edit.
--
-- The trigger is re-created as BEFORE INSERT OR UPDATE OF name. An
-- INSERT … ON CONFLICT DO UPDATE that renames a sample fires the UPDATE branch
-- too, so an upsert cannot launder the rename: its name is pinned while its
-- other columns land.
--
-- Idempotent: CREATE OR REPLACE function + CREATE OR REPLACE TRIGGER (PG14+).
-- Grants and ownership are kept by CREATE OR REPLACE.

create or replace function public.enforce_free_tier_project_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner uuid;
  v_tier text;
  v_count int;
begin
  -- (1) A sample is never counted, so making or keeping one is always allowed.
  if coalesce(NEW.name, '') like 'Sample — %' then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    -- (3) Only a row that STOPS being a sample is checked.
    if coalesce(OLD.name, '') not like 'Sample — %' then
      return NEW;
    end if;
    v_owner := OLD.user_id;
  else
    -- Upsert-as-update: the row already exists, this insert is not a new job.
    if exists (select 1 from projects where id = NEW.id) then
      return NEW;
    end if;

    -- (2) award_rfp's insert for the winner (homeowner session or service
    -- role). The winner's own session cannot claim the exemption.
    if NEW.type = 'awarded_rfp'
       and (auth.uid() is null or auth.uid() is distinct from NEW.user_id) then
      return NEW;
    end if;
    v_owner := NEW.user_id;
  end if;

  -- The same master override requireTier and the app apply.
  if public.is_master_account(v_owner) then
    return NEW;
  end if;

  select tier into v_tier
  from subscriptions
  where user_id = v_owner
    and (end_date is null or end_date > now())
  order by updated_at desc
  limit 1;

  if v_tier is null then
    v_tier := 'free';
  end if;

  if v_tier in ('pro', 'business', 'enterprise') then
    return NEW;
  end if;

  -- (4) The live count: every non-sample row he owns, awarded jobs included.
  select count(*) into v_count
  from projects
  where user_id = v_owner
    and name not like 'Sample — %'
    and id <> NEW.id;

  if v_count >= 1 then
    if TG_OP = 'UPDATE' then
      -- (3) Pin, don't raise: keep the sample name, let the rest of the write
      -- land (a raise here would poison every later write of this job).
      NEW.name := OLD.name;
      return NEW;
    end if;
    raise exception 'Free tier is limited to 1 project. Upgrade to Pro for unlimited projects.'
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$function$;

create or replace trigger enforce_free_tier_project_cap_trigger
  before insert or update of name on public.projects
  for each row
  execute function public.enforce_free_tier_project_cap();
