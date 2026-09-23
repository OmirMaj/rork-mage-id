-- 20260922100000_master_account_project_cap.sql — hotfix (wave 5 audit, blocker #1)
--
-- WHY. enforce_free_tier_project_cap (BEFORE INSERT on projects) decides the
-- tier from subscriptions.tier alone. The master accounts get Business from an
-- email override that lives in two other places — utils/owner.ts OWNER_EMAILS
-- (the app) and supabase/functions/_shared/auth.ts MASTER_EMAILS (requireTier)
-- — but never reached this trigger. The founder's own subscriptions row says
-- 'free', so the app told him "Business, unlimited projects" while the database
-- refused every new job after his first: the insert failed with 'Free tier is
-- limited to 1 project', the offline queue gave up after its retries, and the
-- job (and everything filed under it) existed only on his phone.
--
-- WHAT. One SQL copy of the master list, public.is_master_account(uuid), read
-- from auth.users by id (SECURITY DEFINER; nobody else may call it). The cap
-- function is restated exactly as production has it, plus one early return for
-- a master account. THREE lists must now stay in sync: OWNER_EMAILS,
-- MASTER_EMAILS and is_master_account below.
--
-- Idempotent: CREATE OR REPLACE only. The trigger itself is unchanged (it calls
-- the function by name).

create or replace function public.is_master_account(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from auth.users u
     where u.id = p_user_id
       and lower(btrim(coalesce(u.email, ''))) in ('omirmajeed2000@gmail.com', 'support@mageid.app')
  )
$$;

revoke all on function public.is_master_account(uuid) from public, anon, authenticated;

create or replace function public.enforce_free_tier_project_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tier text;
  v_count int;
begin
  if exists (select 1 from projects where id = NEW.id) then
    return NEW;
  end if;

  if NEW.type = 'awarded_rfp' then
    return NEW;
  end if;

  -- The same master override requireTier and the app apply.
  if public.is_master_account(NEW.user_id) then
    return NEW;
  end if;

  select tier into v_tier
  from subscriptions
  where user_id = NEW.user_id
    and (end_date is null or end_date > now())
  order by updated_at desc
  limit 1;

  if v_tier is null then
    v_tier := 'free';
  end if;

  if v_tier in ('pro', 'business', 'enterprise') then
    return NEW;
  end if;

  select count(*) into v_count
  from projects
  where user_id = NEW.user_id
    and name not like 'Sample — %';

  if v_count >= 1 then
    raise exception 'Free tier is limited to 1 project. Upgrade to Pro for unlimited projects.'
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$function$;
