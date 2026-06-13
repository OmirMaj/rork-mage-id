-- Make subscriptions.tier server-authoritative.
--
-- SECURITY FIX (Critical). Before this migration, the client upserted its own
-- row into public.subscriptions (RLS only checked auth.uid() = user_id), and the
-- edge functions' requireTier() reads that same table to gate every paid
-- feature (_shared/auth.ts lookupTier). Net effect: ANY authenticated user could
--     update subscriptions set tier = 'business' where user_id = auth.uid();
-- and immediately unlock all paid features + inflated AI/vision caps for free.
--
-- The fix: only a trusted server identity (service_role — i.e. the RevenueCat
-- webhook, see supabase/functions/revenuecat-webhook) may set or change `tier`.
-- A BEFORE trigger neutralizes any tier value a normal (authenticated/anon)
-- caller tries to write:
--   * INSERT  -> tier is forced to 'free'
--   * UPDATE  -> tier is pinned to its existing value (no self-elevation,
--                and crucially no self-DOWNGRADE either, so a paying user whose
--                tier was already granted server-side keeps it even though the
--                client still upserts on launch).
-- service_role / direct DB connections (migrations, the SECURITY DEFINER
-- handle_new_user seed) are unaffected and may set tier freely.
--
-- This is intentionally safe for existing users: their current tier already
-- lives in the row, and UPDATE preserves it. New purchases are granted by the
-- service-role RevenueCat webhook. See docs/security/tier-authority-fix.md.

set check_function_bodies = off;

create or replace function public.enforce_subscription_tier_authority()
returns trigger
language plpgsql
-- SECURITY INVOKER on purpose: we only need to read the request role, not
-- elevate. auth.role() resolves the JWT role of the caller (or NULL for a
-- direct DB connection / definer context).
as $$
declare
  v_role text := auth.role();
begin
  -- Only constrain the two client-reachable roles. service_role, postgres,
  -- supabase_admin, and internal definer triggers (auth.role() IS NULL) are
  -- trusted to set tier.
  if v_role is distinct from 'authenticated' and v_role is distinct from 'anon' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.tier := 'free';
  elsif tg_op = 'UPDATE' then
    -- Pin tier to whatever the server last set it to.
    new.tier := old.tier;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_subscription_tier on public.subscriptions;
create trigger trg_enforce_subscription_tier
  before insert or update on public.subscriptions
  for each row
  execute function public.enforce_subscription_tier_authority();

-- Defense in depth: the original UPDATE policy had a USING clause but no
-- WITH CHECK, which allowed a row's user_id to be repointed on update. Pin both.
drop policy if exists subs_tier_update_own on public.subscriptions;
create policy subs_tier_update_own on public.subscriptions
  as permissive for update to public
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
