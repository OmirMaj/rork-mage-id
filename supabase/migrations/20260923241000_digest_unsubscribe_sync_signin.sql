-- 20260923241000_digest_unsubscribe_sync_signin.sql
-- The digest unsubscribe → preferences sync matches the SIGN-IN address.
--
-- ── WHY (audit 2026-09-23 #130) ─────────────────────────────────────────────
-- 20260918170000 made three paths agree about the GC digest's email:
--   (A) email_unsubscribes_sync_digest_prefs — an unsubscribe row turns the
--       stored digest email preference off;
--   (B) my_digest_email_suppression / (C) resume_my_digest_email — the app
--       switch's state and its re-enable path.
-- (B) and (C) key on auth.users.email for auth.uid(). (A) matched
-- lower(profiles.email) — the Company Profile address, which the digests were
-- also sending to. Wave 5 moves both digests to the sign-in address
-- (_shared/email.ts pickDigestRecipient), so (A) must match the same address or
-- an unsubscribe from the digest's own link would stop the email (the digests
-- check email_unsubscribes) while leaving the stored preference saying "on".
--
-- ── WHAT ─────────────────────────────────────────────────────────────────────
-- (A) re-created, body otherwise unchanged: the profiles it updates are those
-- whose auth.users.email matches the unsubscribed address — or, for an account
-- with NO sign-in address (the only case in which the digests fall back to the
-- Company Profile email), whose profiles.email matches. That is exactly the
-- address pickDigestRecipient sends to, so send, sync and resume use one
-- address. profiles.email stays the company contact / reply-to.
--
-- Kept from the live definition (pg_get_functiondef, 2026-09-23): SECURITY
-- DEFINER, search_path = pg_catalog, public, EXECUTE revoked from the API roles
-- (postgres + service_role only), the AFTER INSERT OR UPDATE OF email,
-- event_key trigger. (B) and (C) are unchanged and not touched here.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
--
-- Reverse path: re-run section (A) of 20260918170000_digest_unsubscribe_sync.sql.

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
      from auth.users u
     where u.id = p.id
       and (
             lower(u.email) = lower(new.email)
             -- No sign-in address: the digests send to the company email.
             or (coalesce(btrim(u.email), '') = '' and lower(p.email) = lower(new.email))
           );
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
