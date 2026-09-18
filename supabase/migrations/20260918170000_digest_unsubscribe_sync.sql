-- 20260918170000_digest_unsubscribe_sync.sql
-- The GC digest's unsubscribe and its in-app switch tell the same story.
--
-- ── WHY (audit 2026-09-18 #15) ───────────────────────────────────────────────
-- Two stores decide whether a GC digest goes out, and they never talked:
--   • email_unsubscribes — written by the footer link / List-Unsubscribe
--     header / Gmail one-click (the `unsubscribe` edge function);
--   • profiles.digest_channels.email (morning-digest) and
--     profiles.notification_preferences.daily_digest.email (daily-digest) —
--     written by the in-app settings screen.
-- The digests now check email_unsubscribes before every send (the edge-function
-- half of this fix). That alone leaves the settings screen saying "Email: on"
-- to someone who unsubscribed, and a switch that could never undo it: turning
-- it off and on again did not touch the suppression row, so the email stayed
-- stopped while the switch said it was running.
--
-- ── WHAT ─────────────────────────────────────────────────────────────────────
-- (A) Trigger: an unsubscribe for 'daily_digest' (or a global one, event_key
--     NULL, which stops the digest too) also turns the matching profile
--     preferences off, so the stored settings say what will actually happen.
-- (B) my_digest_email_suppression(): the signed-in user's own state —
--     'none' | 'digest' | 'all' — so the settings screen can show the truth and
--     say why the switch is off.
-- (C) resume_my_digest_email(): the switch's re-enable path. Clears ONLY the
--     'daily_digest' row, and only for the caller's own sign-in address; when
--     nothing suppresses the digest after that, it also undoes (A)'s
--     notification_preferences.daily_digest.email = false on the caller's row.
--     A global "unsubscribe from everything" is not lifted by a digest switch;
--     the function returns 'all' and the screen says so.
--
-- ── SECURITY ─────────────────────────────────────────────────────────────────
-- email_unsubscribes stays deny-all for the API roles (20260612230000). (B)
-- and (C) are SECURITY DEFINER with a pinned search_path and key on
-- auth.users.email for auth.uid() — the verified sign-in address — never on
-- profiles.email, which the user can edit: keyed on that, anyone could set
-- their profile email to a stranger's address and clear the stranger's
-- suppression (or probe whether it exists). (A) runs as a trigger only; its
-- EXECUTE is revoked from the API roles.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
--
-- Reverse path:
--   drop trigger if exists email_unsubscribes_sync_digest_prefs on public.email_unsubscribes;
--   drop function if exists public.email_unsubscribes_sync_digest_prefs();
--   drop function if exists public.resume_my_digest_email();
--   drop function if exists public.my_digest_email_suppression();

-- ── (A) unsubscribe → the stored preferences say "off" ──────────────────────
create or replace function public.email_unsubscribes_sync_digest_prefs()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.event_key is null or new.event_key = 'daily_digest' then
    update public.profiles p
       set digest_channels =
             (case when jsonb_typeof(p.digest_channels) = 'object'
                   then p.digest_channels
                   else '{"email": true, "in_app": true}'::jsonb end)
             || '{"email": false}'::jsonb,
           notification_preferences =
             case when jsonb_typeof(p.notification_preferences -> 'daily_digest') = 'object'
                  then jsonb_set(p.notification_preferences, '{daily_digest,email}', 'false'::jsonb)
                  else p.notification_preferences end
     where lower(p.email) = lower(new.email);
  end if;
  return null;
end
$$;

revoke execute on function public.email_unsubscribes_sync_digest_prefs() from public, anon, authenticated;

drop trigger if exists email_unsubscribes_sync_digest_prefs on public.email_unsubscribes;
create trigger email_unsubscribes_sync_digest_prefs
  after insert or update of email, event_key on public.email_unsubscribes
  for each row
  execute function public.email_unsubscribes_sync_digest_prefs();

-- ── (B) the caller's own suppression state ─────────────────────────────────
create or replace function public.my_digest_email_suppression()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with me as (
    select lower(u.email) as email from auth.users u where u.id = auth.uid()
  )
  select case
    when not exists (select 1 from me where me.email is not null) then 'none'
    when exists (select 1 from public.email_unsubscribes e join me on e.email = me.email
                  where e.event_key is null) then 'all'
    when exists (select 1 from public.email_unsubscribes e join me on e.email = me.email
                  where e.event_key = 'daily_digest') then 'digest'
    else 'none'
  end
$$;

revoke execute on function public.my_digest_email_suppression() from public, anon;
grant execute on function public.my_digest_email_suppression() to authenticated;

-- ── (C) the switch's re-enable path ────────────────────────────────────────
create or replace function public.resume_my_digest_email()
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_email text;
  v_state text;
begin
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  if v_email is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.email_unsubscribes
   where email = v_email
     and event_key = 'daily_digest';
  v_state := public.my_digest_email_suppression();
  -- (A) also wrote notification_preferences.daily_digest.email = false, and
  -- no screen writes that key back — so without this the digest stayed off
  -- after "Turn it on to start receiving it again". Only when nothing still
  -- suppresses it; the screen then writes digest_channels.email itself.
  if v_state = 'none' then
    update public.profiles p
       set notification_preferences =
             jsonb_set(p.notification_preferences, '{daily_digest,email}', 'true'::jsonb)
     where p.id = auth.uid()
       and jsonb_typeof(p.notification_preferences -> 'daily_digest') = 'object';
  end if;
  return v_state;
end
$$;

revoke execute on function public.resume_my_digest_email() from public, anon;
grant execute on function public.resume_my_digest_email() to authenticated;
