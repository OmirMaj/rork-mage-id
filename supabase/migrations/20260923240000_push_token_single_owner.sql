-- 20260923240000_push_token_single_owner.sql
-- A phone's push token belongs to ONE account: the last one that registered it.
--
-- ── WHY (audit 2026-09-23 #44) ───────────────────────────────────────────────
-- An Expo push token identifies a DEVICE, not a person. When a GC signs out
-- and his foreman (or PM) signs in on the same phone, NotificationContext
-- writes the same token onto the second profile — and nothing ever cleared it
-- from the first. Every sender that addresses profiles.push_token (notify's
-- GC events: "client paid", CO decisions, portal messages; morning-digest's
-- brief with job names and task counts; bidQuestionsEngine) kept pushing the
-- first account's business to a phone that account no longer used, on top of
-- the new user's own pushes. (invoice-dunning sends no pushes — the original
-- repro named it wrongly; it emails the client.) Production on 2026-09-23:
-- 3 profiles held a token, all three the SAME token.
--
-- ── WHAT ─────────────────────────────────────────────────────────────────────
-- (1) One-time repair: every token held by more than one profile is kept only
--     on its most recent holder — coalesce(push_token_updated_at, updated_at),
--     ties broken by id so exactly one row wins — and cleared (token, platform,
--     updated-at) on the rest. The count is RAISE NOTICE'd.
-- (2) profiles_push_token_uniq: a partial unique index, so the invariant is
--     enforced by the database, not only by the trigger. Created AFTER (1) —
--     the repair is what makes it creatable.
-- (3) public.profiles_claim_push_token(): when a profile's push_token becomes
--     a non-null value (UPDATE) or a profile is created with one (INSERT —
--     profiles_insert lets a signed-in user insert his own row, and the
--     offline queue replays upserts), every OTHER profile holding that token
--     loses it. BEFORE row triggers, so the other holders are cleared before
--     this row's index entry is checked: a second account claiming a phone's
--     token succeeds and leaves exactly one holder, instead of failing on (2).
--     SECURITY DEFINER because RLS (profiles_update: auth.uid() = id) would
--     otherwise stop the caller from touching the other profiles.
--
-- It never raises: a guard that raises turns the offline queue's replayed
-- token write into a permanent failure (the #85 / #31 lesson). The nested
-- UPDATE writes NULL tokens, which the trigger's WHEN clause skips, so it
-- cannot recurse.
--
-- Not here (wave-4 files, handed to the join): the sign-out flush nulling the
-- caller's own token while the session is still live (AuthContext), and the
-- push switch's toggle-off doing the same (notifications-settings). Offline
-- sign-outs still leave the token behind; this trigger clears it the moment
-- the next account on that phone registers.
--
-- Idempotent: the repair is a no-op on a clean table; CREATE ... IF NOT EXISTS,
-- CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
--
-- Reverse path:
--   drop trigger if exists profiles_claim_push_token on public.profiles;
--   drop trigger if exists profiles_claim_push_token_on_insert on public.profiles;
--   drop function if exists public.profiles_claim_push_token();
--   drop index if exists public.profiles_push_token_uniq;
--   (the repair is not reversed: the cleared rows were the stale holders)

-- ── (1) one-time repair ─────────────────────────────────────────────────────
do $$
declare
  v_cleared integer;
begin
  with ranked as (
    select id,
           row_number() over (
             partition by push_token
             order by coalesce(push_token_updated_at, updated_at) desc nulls last, id desc
           ) as rn
      from public.profiles
     where push_token is not null
  )
  update public.profiles p
     set push_token = null,
         push_token_platform = null,
         push_token_updated_at = null
    from ranked r
   where r.id = p.id
     and r.rn > 1;
  get diagnostics v_cleared = row_count;
  raise notice 'push_token_single_owner: cleared a shared push token from % stale profile(s)', v_cleared;
end
$$;

-- ── (2) the invariant ───────────────────────────────────────────────────────
create unique index if not exists profiles_push_token_uniq
  on public.profiles (push_token)
  where push_token is not null;

-- ── (3) the claim ───────────────────────────────────────────────────────────
create or replace function public.profiles_claim_push_token()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- The WHEN clauses guarantee NEW.push_token is non-null here; checked again
  -- so the function is safe if it is ever attached without them.
  if new.push_token is not null then
    update public.profiles
       set push_token = null,
           push_token_platform = null,
           push_token_updated_at = null
     where push_token = new.push_token
       and id <> new.id;
  end if;
  return new;
end
$$;

revoke execute on function public.profiles_claim_push_token() from public, anon, authenticated;

drop trigger if exists profiles_claim_push_token on public.profiles;
create trigger profiles_claim_push_token
  before update of push_token on public.profiles
  for each row
  when (new.push_token is not null and new.push_token is distinct from old.push_token)
  execute function public.profiles_claim_push_token();

drop trigger if exists profiles_claim_push_token_on_insert on public.profiles;
create trigger profiles_claim_push_token_on_insert
  before insert on public.profiles
  for each row
  when (new.push_token is not null)
  execute function public.profiles_claim_push_token();
