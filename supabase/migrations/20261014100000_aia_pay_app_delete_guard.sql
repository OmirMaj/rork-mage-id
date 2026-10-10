-- 20261014100000_aia_pay_app_delete_guard.sql — a pay application that is
-- frozen (a Stripe pay link was made, or it was certified and sent without
-- one) cannot be deleted by a client (lane PAYAPP-1d).
--
-- WHY. trg_freeze_certified_aia_pay_app refuses a change to a frozen row's
--   figures, but it is a BEFORE UPDATE trigger. The row's owner could still
--   DELETE the row and insert a new one under the same id with other figures:
--   the lock held against an edit and not against a replacement
--   (20261014090000 states this as a known limit).
--
-- WHAT IS ADDED
--   public.aia_pay_app_guard_frozen_delete()  trigger function, SECURITY
--     INVOKER, search_path empty. BEFORE DELETE on public.aia_pay_apps, per
--     row. It refuses the delete when BOTH of these hold:
--       - the row is frozen: certified_at IS NOT NULL OR sent_locked_at IS NOT NULL;
--       - the delete runs as a client role (current_user is authenticated or anon).
--     Otherwise the delete goes ahead.
--
-- WHAT STILL DELETES A FROZEN ROW, ON PURPOSE
--   - Deleting the whole job: public.projects -> aia_pay_apps is ON DELETE
--     CASCADE, and Postgres runs a cascade as the OWNER of the table it
--     deletes from, not as the client, so current_user is not a client role
--     there. A contractor can still remove a job and everything on it.
--   - Deleting the account: the delete-account function runs as the service
--     role, and auth.users -> aia_pay_apps is ON DELETE CASCADE.
--   - The service role and the database owner, for support work by hand.
--   So this is a guard against deleting ONE sent application out from under
--   its job. It is not a retention rule: it does not keep a record alive past
--   its job or its account.
--
-- KNOWN LIMIT. Because deleting the job must keep working, an owner can still
--   delete the whole job, make a job again under the same id, and insert an
--   application under the old row id with other figures. Closing that needs a
--   record of the ids that left (a tombstone written when a frozen row goes by
--   cascade, and an insert that refuses a tombstoned id); it is not in this
--   file. TRUNCATE does not fire this trigger either: no client role holds
--   TRUNCATE on the table, and the self-check below refuses to finish if one
--   ever does.
--
-- WHAT THIS DOES NOT DO. It changes no row, no policy and no table grant
--   (it revokes EXECUTE on its own new function, nothing else). A draft (not
--   frozen) is deleted exactly as before.
--
-- APP SIDE. No screen offers "delete" for a pay application. The one delete the
--   app sends by itself is housekeeping: when a save replaces an OLDER record
--   of the same period held under a different id (contexts/ProjectContext.tsx,
--   "displaced"), it deletes the older one. From this change on the app does
--   not send that delete for a record it knows is locked (utils/payApp/
--   sendLock.ts keepsItsServerRow). An OLDER build still sends it, and here it
--   is refused: both records stay on the server, which is the intent (before
--   this file the sent record was silently removed). What that older build
--   shows: online, a "Couldn't save" toast and a "Not saved" line for that
--   delete whose Retry cannot succeed until it is discarded; if the delete was
--   queued offline, the refusal says "violates", which the queue reads as
--   final, so it is dropped at once and not retried.
--
-- SAME PATTERN AS public.punch_seals (20261002150000): current_user tells a
--   client's own statement from the service role and from a cascade.
--
-- DEPLOY ORDER. After 20261014090000_aia_pay_app_send_lock.sql (it reads
--   sent_locked_at). Apply through the Supabase MCP apply_migration, never
--   `supabase db push`.
--
-- VERIFY AFTER
--   select tgname, tgtype from pg_trigger where tgrelid = 'public.aia_pay_apps'::regclass and not tgisinternal order by 1;
--     -- adds trg_aia_pay_app_guard_frozen_delete (tgtype 11: row, before, delete)
--   select has_function_privilege('authenticated', 'public.aia_pay_app_guard_frozen_delete()', 'execute');  -- false
--
-- UNDO (by hand)
--   drop trigger if exists trg_aia_pay_app_guard_frozen_delete on public.aia_pay_apps;
--   drop function if exists public.aia_pay_app_guard_frozen_delete();

do $pre$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'aia_pay_apps' and column_name = 'sent_locked_at') then
    raise exception '[aia_pay_app_delete_guard] apply 20261014090000_aia_pay_app_send_lock.sql first (sent_locked_at is missing)';
  end if;
end;
$pre$;

create or replace function public.aia_pay_app_guard_frozen_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  if (old.certified_at is not null or old.sent_locked_at is not null)
     and current_user in ('authenticated', 'anon') then
    raise exception
      'AIA pay application %/% is certified (sent for payment) and cannot be deleted: that violates its send lock. Bill the next period to revise it.',
      old.project_id, old.application_number
      using errcode = 'check_violation';
  end if;
  return old;
end
$fn$;

revoke all on function public.aia_pay_app_guard_frozen_delete() from public, anon, authenticated;

drop trigger if exists trg_aia_pay_app_guard_frozen_delete on public.aia_pay_apps;
create trigger trg_aia_pay_app_guard_frozen_delete
  before delete on public.aia_pay_apps
  for each row execute function public.aia_pay_app_guard_frozen_delete();

do $verify$
begin
  if (select count(*) from pg_trigger where tgrelid = 'public.aia_pay_apps'::regclass and not tgisinternal
        and tgname = 'trg_aia_pay_app_guard_frozen_delete' and tgtype = 11 and tgenabled = 'O') <> 1 then
    raise exception '[aia_pay_app_delete_guard] verify: the delete guard is missing, disabled, or is not BEFORE DELETE per row';
  end if;
  -- The two facts the design rests on. A cascade passes because Postgres runs it as the table's owner, so the
  -- owner must not be a client role; and TRUNCATE does not fire a row trigger, so no client role may hold it.
  if (select relowner::regrole::text from pg_class where oid = 'public.aia_pay_apps'::regclass) in ('authenticated', 'anon') then
    raise exception '[aia_pay_app_delete_guard] verify: public.aia_pay_apps is owned by a client role, so deleting a job would be refused';
  end if;
  if has_table_privilege('authenticated', 'public.aia_pay_apps', 'TRUNCATE')
     or has_table_privilege('anon', 'public.aia_pay_apps', 'TRUNCATE') then
    raise exception '[aia_pay_app_delete_guard] verify: a client role holds TRUNCATE on public.aia_pay_apps, which goes around the guard';
  end if;
  if has_function_privilege('anon', 'public.aia_pay_app_guard_frozen_delete()', 'execute')
     or has_function_privilege('authenticated', 'public.aia_pay_app_guard_frozen_delete()', 'execute') then
    raise exception '[aia_pay_app_delete_guard] verify: the guard function is callable by a client';
  end if;
end;
$verify$;
