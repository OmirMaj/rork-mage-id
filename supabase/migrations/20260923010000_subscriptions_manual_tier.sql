-- ============================================================================
-- subscriptions.manual_tier / tier_source — a plan MAGE ID turns on by hand
-- can no longer be lowered by a RevenueCat event.            (audit wave 5, #2)
--
-- WHY. Paid plans are not self-serve yet (marketing/pricing.html: "we cannot
-- take your card today … we will turn Pro on for you"). The founder grants a
-- plan by setting subscriptions.tier with the service key. Two things then
-- took it away again:
--   1. the app resolved RevenueCat first, so a hand-granted customer with no
--      store entitlement read as Free on the iPhone (fixed client-side in
--      contexts/SubscriptionContext.tsx resolveTier — the higher of the two);
--   2. supabase/functions/revenuecat-webhook wrote RevenueCat's tier over the
--      row on ANY later event for that user (a TestFlight sandbox purchase, an
--      alias, a transfer) — 'free', for a customer who never bought in a store.
--      "Leave rows with no revenuecat_customer_id alone" is not a fix: the
--      webhook's own upsert fills that column on its first event.
--
-- WHAT.
--   manual_tier  null | 'pro' | 'business' | 'enterprise' — the floor a hand
--                grant sets. The webhook writes tier = max(RevenueCat, manual);
--                this trigger floors tier at manual_tier on EVERY write as well,
--                so no writer (another function, a console edit that forgot)
--                can undercut a grant. To end a grant, clear manual_tier in the
--                same UPDATE that lowers tier.
--   tier_source  'revenuecat' | 'manual' — derived from manual_tier by the
--                trigger on every write (manual iff manual_tier is set) and
--                backstopped by a CHECK, so the two can never disagree. The
--                app reads it to label a plan "turned on by MAGE ID" instead
--                of sending him to an App Store page with nothing on it (#176).
--   Both are service-role-only: enforce_subscription_tier_authority, which
--   already pins tier for the authenticated/anon roles, now pins these too
--   (INSERT forces null/'revenuecat', UPDATE keeps OLD). Without that a client
--   could set manual_tier = 'enterprise' on his own row and the webhook would
--   dutifully floor him there.
--
-- REBUILT FROM THE LIVE DEFINITION (pg_get_functiondef, 2026-09-22), not from
-- 20260608120000's text alone: 20260612230000 pinned the function afterwards
-- with ALTER FUNCTION … SET search_path = pg_catalog, public, and a CREATE OR
-- REPLACE without a SET clause would silently drop that setting (the
-- function_search_path_mutable advisory would come back). The SET clause is
-- therefore written inline below. SECURITY INVOKER is unchanged (no SECURITY
-- DEFINER — the body only reads auth.role() and NEW/OLD). No newer definition
-- exists in the main checkout's migrations (grepped 2026-09-22).
--
-- BACKFILL (productDecision #2, interim). A row counts as a hand grant BY
-- CONSTRUCTION when it is paid and has never been linked to RevenueCat
-- (revenuecat_customer_id IS NULL): only a service-role write can put a paid
-- tier there. Those rows get manual_tier = tier, tier_source = 'manual'.
-- Production at 2026-09-22: 2 non-free rows — 1 matches (business, no RC
-- link), 1 does not (business, RC-linked: row id 42293213-7ee7-46da-a673-
-- 6295073cfdad). The second is left for the founder to confirm; if it is a
-- hand grant too, run:
--     update public.subscriptions set manual_tier = tier where id = '<id>';
-- (the trigger sets tier_source). A NEW hand grant is the same one statement:
--     update public.subscriptions set tier = 'pro', manual_tier = 'pro' where user_id = '<uid>';
-- Idempotent: every statement can run twice.
-- ============================================================================

alter table public.subscriptions add column if not exists manual_tier text;
alter table public.subscriptions add column if not exists tier_source text not null default 'revenuecat';

alter table public.subscriptions drop constraint if exists subscriptions_manual_tier_check;
alter table public.subscriptions
  add constraint subscriptions_manual_tier_check
  check (manual_tier is null or manual_tier = any (array['pro'::text, 'business'::text, 'enterprise'::text]));

alter table public.subscriptions drop constraint if exists subscriptions_tier_source_check;
alter table public.subscriptions
  add constraint subscriptions_tier_source_check
  check (tier_source = any (array['revenuecat'::text, 'manual'::text]));

-- The backfill must run before the pairing CHECK below (the rows it touches
-- are the only ones that would need tier_source = 'manual').
update public.subscriptions
   set manual_tier = tier,
       tier_source = 'manual'
 where tier is not null
   and tier <> 'free'
   and revenuecat_customer_id is null
   and manual_tier is null;

alter table public.subscriptions drop constraint if exists subscriptions_manual_tier_source_pair_check;
alter table public.subscriptions
  add constraint subscriptions_manual_tier_source_pair_check
  check ((manual_tier is null) = (tier_source = 'revenuecat'));

comment on column public.subscriptions.manual_tier is
  'A plan MAGE ID turned on by hand. Service-role only. tier is never written below it (trigger + revenuecat-webhook). Clear it in the same UPDATE that ends the grant.';
comment on column public.subscriptions.tier_source is
  '''manual'' iff manual_tier is set (CHECK). Service-role only. Read by the app to route a cancel to email instead of a store page.';

create or replace function public.enforce_subscription_tier_authority()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_role text := auth.role();
  v_rank constant jsonb := '{"free":0,"pro":1,"business":2,"enterprise":3}';
begin
  if v_role is not distinct from 'authenticated' or v_role is not distinct from 'anon' then
    -- Client roles can set none of the three server-authoritative columns.
    if tg_op = 'INSERT' then
      new.tier := 'free';
      new.manual_tier := null;
      new.tier_source := 'revenuecat';
    elsif tg_op = 'UPDATE' then
      new.tier := old.tier;
      new.manual_tier := old.manual_tier;
      new.tier_source := old.tier_source;
    end if;
  end if;

  -- Every writer, service role included: tier_source follows manual_tier (so
  -- a grant is one column to set, and the pairing CHECK can never trip on a
  -- console edit), and tier never drops below the hand grant.
  new.tier_source := case when new.manual_tier is null then 'revenuecat' else 'manual' end;
  if new.manual_tier is not null
     and coalesce((v_rank ->> coalesce(new.tier, 'free'))::int, 0) < (v_rank ->> new.manual_tier)::int then
    new.tier := new.manual_tier;
  end if;

  return new;
end;
$function$;

-- Printed on apply so the backfill's reach is visible without a follow-up
-- query. Counts only — never an email.
do $$
declare
  v_manual int;
  v_unconfirmed int;
begin
  select count(*) into v_manual from public.subscriptions where tier_source = 'manual';
  select count(*) into v_unconfirmed from public.subscriptions
   where tier is not null and tier <> 'free' and manual_tier is null;
  raise notice 'subscriptions: % hand-granted (manual_tier set); % paid rows left for the founder to confirm', v_manual, v_unconfirmed;
end $$;
