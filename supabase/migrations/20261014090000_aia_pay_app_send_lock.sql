-- 20261014090000_aia_pay_app_send_lock.sql — a pay application that was
-- certified and sent is frozen by the DATABASE even when no Stripe pay link was
-- made (lane PAYAPP-1c, Easier Pay Applications).
--
-- WHY. public.aia_pay_apps is frozen by trg_freeze_certified_aia_pay_app once
--   `certified_at` is set, and `certified_at` is stamped only by the
--   create-payment-link function when a Stripe link is minted
--   (20260728120000, 20260911090000). A contractor without Stripe certifies,
--   sends the PDF, and the row behind it stays editable. The app has kept its
--   own lock for that case since PAYAPP-1: at certify it writes
--   `sentLockedAt` into the row's snapshot sidecar
--   (snapshot_totals -> '__mageCertificate' ->> 'sentLockedAt',
--   utils/payApp/sendLock.ts). That is the app's word only: an older build, a
--   second device with a stale copy, or a direct write could still change the
--   figures of a document that went out. This file makes the database hold the
--   same line.
--
-- WHAT IS ADDED
--   public.aia_pay_apps.sent_locked_at  timestamptz, nullable, no default, no
--     backfill. THE SERVER'S OWN STAMP. It is set by the trigger below, to the
--     server's clock, the first time a row is written carrying the app's
--     `sentLockedAt` sidecar. It is never taken from the client: whatever a
--     client sends in this column is thrown away.
--   public.aia_pay_app_stamp_send_lock()  trigger function, SECURITY INVOKER,
--     search_path empty. BEFORE INSERT OR UPDATE on public.aia_pay_apps:
--       - not yet stamped, and the row being written carries the sidecar
--         stamp (a non-blank string): sent_locked_at := now();
--       - not yet stamped, no sidecar stamp: sent_locked_at stays NULL;
--       - already stamped: sent_locked_at keeps its value, whatever was sent,
--         and a sidecar stamp that arrives with a different time is set back
--         to the first one (a certify sent twice because the first answer was
--         lost is then the same record, not a refused change).
--     It reads and writes nothing but the row in hand.
--   public.freeze_certified_aia_pay_app() is REPLACED by the same function with
--     four changes:
--       (1) a row is frozen when certified_at IS NOT NULL (as before) OR
--           sent_locked_at IS NOT NULL (new);
--       (2) on a row frozen by sent_locked_at alone, `certified_at` may be set
--           ONCE (NULL to a value). That is "Add a Pay Button" later: Stripe
--           is connected after the send, create-payment-link mints a link and
--           stamps certified_at. (The column is not restricted to the service
--           role, here or before: the row's owner could set it too.) Once set
--           it is immutable, as before.
--       (3) the seven TEXT columns compare an empty string and NULL as the
--           same value. The app reads '' back as "not set" and writes NULL
--           (utils/projectContextPure.ts str / savedToAiaRow), so on a job with
--           no address or no description its own re-save of a frozen row was
--           refused, and with it the architect's certificate response and the
--           Pay button added later. This applies to pay-link rows too.
--       (4) id, user_id and project_id are frozen with the rest: a frozen row
--           cannot be moved to another job or given another id.
--     Otherwise unchanged: the same frozen columns, and the same three
--     architect's-certificate fields left writable inside the snapshot.
--
-- WHAT STAYS WRITABLE ON A FROZEN ROW (unchanged): the pay link columns, the
--   payment columns, portal_state, notes, updated_at, and the architect's
--   certificate response (amountCertified, certifiedDate,
--   certifiedExplanation). A re-save of the SAME record passes (proved with
--   the app's own upsert shape, a certify sent twice, and '' against NULL).
--
-- WHAT THIS DOES NOT DO. It contacts nobody, moves no money, and does not
--   decide that an application is correct. It does not change who may read
--   or write the table (no policy and no grant is touched). It does not stop a
--   DELETE: the owner can still delete a frozen row, exactly as he can delete
--   one with a pay link today (a guard on delete is a separate change).
--
-- ROWS ALREADY IN THE TABLE. A row that already carries the app's sidecar
--   stamp is stamped by this file (one UPDATE that sets updated_at to itself;
--   no other column changes). Every other row is left exactly as it is.
--
-- THERE IS NO UNLOCK BY UPDATE. Like a row with a pay link, a sent row's
--   figures are revised by billing the next period. No UPDATE clears the
--   stamp, the service role's included. Releasing an application stamped by
--   mistake is hand work: disable both triggers, null the column and remove
--   the sidecar key, enable them again; a device that still holds the stamped
--   copy will write the stamp back on its next save.
--
-- APP SIDE. No app change is needed for the lock to hold: the app already
--   writes the sidecar stamp at certify (owner preview while
--   PAY_APP_EASY_ENABLED is false, everyone once it is on) and already treats
--   it as a lock. A build from before PAYAPP-1 never writes the sidecar key,
--   so it stamps nothing; if such a build re-saves a row a newer build
--   stamped, it drops the key and the write is refused, which is the lock
--   doing its work against a stale copy.
--
-- KNOWN LIMITS (owed, not in this file)
--   - The account-deletion tombstones (20261010110000) still key on
--     certified_at only, so a row frozen by the send alone gets none.
--   - payLinkBalance does not yet vouch for the balance of a send-locked row
--     when a Pay button is added later.
--   - A queued write refused by the freeze is retried five times and dropped
--     (utils/offlineQueue.ts reads the message, not the code).
--   - If a certify is sent twice and a FIGURE was edited between the two, the
--     second is refused: the server holds the first.
--
-- DEPLOY ORDER. Any. Apply through the Supabase MCP apply_migration, never
--   `supabase db push`. Depends on 20260728120000 and 20260911090000.
--
-- VERIFY AFTER
--   select column_name, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'aia_pay_apps' and column_name = 'sent_locked_at';  -- sent_locked_at, YES
--   select tgname from pg_trigger where tgrelid = 'public.aia_pay_apps'::regclass and not tgisinternal order by 1;
--     -- aia_pay_apps_pending_guard, trg_aia_pay_app_stamp_send_lock, trg_freeze_certified_aia_pay_app
--   select count(*) filter (where sent_locked_at is not null) as stamped,
--          count(*) filter (where sent_locked_at is null and jsonb_typeof(snapshot_totals #> '{__mageCertificate,sentLockedAt}') = 'string') as missed
--     from public.aia_pay_apps;   -- missed = 0
--
-- UNDO (by hand)
--   drop trigger if exists trg_aia_pay_app_stamp_send_lock on public.aia_pay_apps;
--   drop function if exists public.aia_pay_app_stamp_send_lock();
--   (re-create freeze_certified_aia_pay_app from 20260911090000_aia_certificate_response_writable.sql)
--   alter table public.aia_pay_apps drop column if exists sent_locked_at;

alter table public.aia_pay_apps add column if not exists sent_locked_at timestamptz;

create or replace function public.aia_pay_app_stamp_send_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_path constant text[] := array['__mageCertificate', 'sentLockedAt'];
  v_sidecar text;
begin
  -- Only a non-blank STRING counts, which is what the app writes and what the app reads as locked.
  v_sidecar := case
    when jsonb_typeof(new.snapshot_totals) = 'object' and jsonb_typeof(new.snapshot_totals #> v_path) = 'string'
      then nullif(btrim(new.snapshot_totals #>> v_path), '')
    else null end;
  if tg_op = 'UPDATE' and old.sent_locked_at is not null then
    -- Stamped once, by the server. Nothing a client sends moves or clears it.
    new.sent_locked_at := old.sent_locked_at;
    -- A certify that is sent twice (the first answer was lost on the way back) carries a later time in the
    -- sidecar. The first one is kept, so the same figures are taken again instead of refused. A write with NO
    -- sidecar stamp is left as it is, and the freeze refuses it.
    if v_sidecar is not null and jsonb_typeof(old.snapshot_totals #> v_path) = 'string' then
      new.snapshot_totals := jsonb_set(new.snapshot_totals, v_path, old.snapshot_totals #> v_path);
    end if;
    return new;
  end if;
  -- The server's clock, not the app's: the sidecar only says THAT it was sent.
  new.sent_locked_at := case when v_sidecar is not null then now() else null end;
  return new;
end
$fn$;

revoke all on function public.aia_pay_app_stamp_send_lock() from public, anon, authenticated;

drop trigger if exists trg_aia_pay_app_stamp_send_lock on public.aia_pay_apps;
create trigger trg_aia_pay_app_stamp_send_lock
  before insert or update on public.aia_pay_apps
  for each row execute function public.aia_pay_app_stamp_send_lock();

create or replace function public.freeze_certified_aia_pay_app()
returns trigger
language plpgsql
as $$
declare
  old_frozen jsonb;
  new_frozen jsonb;
begin
  if old.certified_at is not null or old.sent_locked_at is not null then
    old_frozen := (to_jsonb(old.snapshot_totals)
                     #- '{__mageCertificate,amountCertified}'
                     #- '{__mageCertificate,certifiedDate}'
                     #- '{__mageCertificate,certifiedExplanation}');
    new_frozen := (to_jsonb(new.snapshot_totals)
                     #- '{__mageCertificate,amountCertified}'
                     #- '{__mageCertificate,certifiedDate}'
                     #- '{__mageCertificate,certifiedExplanation}');

    if ( new.id                         is distinct from old.id
      or new.user_id                    is distinct from old.user_id
      or new.project_id                 is distinct from old.project_id
      or new.application_number         is distinct from old.application_number
      or new.application_date           is distinct from old.application_date
      or new.period_to                  is distinct from old.period_to
      or new.contract_date              is distinct from old.contract_date
      or new.original_contract_sum      is distinct from old.original_contract_sum
      or new.net_change_by_co           is distinct from old.net_change_by_co
      or new.contract_sum_to_date       is distinct from old.contract_sum_to_date
      or new.retainage_percent          is distinct from old.retainage_percent
      or new.less_previous_certificates is distinct from old.less_previous_certificates
      or new.lines                      is distinct from old.lines
      or new_frozen                     is distinct from old_frozen
      or coalesce(new.owner_name, '') is distinct from coalesce(old.owner_name, '')
      or coalesce(new.contractor_name, '') is distinct from coalesce(old.contractor_name, '')
      or coalesce(new.architect_name, '') is distinct from coalesce(old.architect_name, '')
      or coalesce(new.project_name, '') is distinct from coalesce(old.project_name, '')
      or coalesce(new.project_location, '') is distinct from coalesce(old.project_location, '')
      or coalesce(new.contract_for_description, '') is distinct from coalesce(old.contract_for_description, '')
      or coalesce(new.invoice_id, '') is distinct from coalesce(old.invoice_id, '')
      -- certified_at is immutable once set. On a row frozen by the send alone it may be set once
      -- (a pay link added later); it can never be cleared or moved.
      or (old.certified_at is not null and new.certified_at is distinct from old.certified_at)
    ) then
      raise exception
        'AIA pay application %/% is certified (sent for payment); its financial fields are immutable. Create the next application period instead.',
        old.project_id, old.application_number
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- The freeze trigger itself is unchanged; re-created so this file stands on its own.
drop trigger if exists trg_freeze_certified_aia_pay_app on public.aia_pay_apps;
create trigger trg_freeze_certified_aia_pay_app
  before update on public.aia_pay_apps
  for each row execute function public.freeze_certified_aia_pay_app();

-- Rows that ALREADY carry the app's stamp (certified in the owner preview before the server knew about it) are
-- stamped now. Nothing on them changes: the write sets updated_at to itself, and the trigger above does the rest.
-- Without this such a row would stay open until its next write, and that write could be the one that changes it.
update public.aia_pay_apps
   set updated_at = updated_at
 where sent_locked_at is null
   and jsonb_typeof(snapshot_totals) = 'object'
   and jsonb_typeof(snapshot_totals #> '{__mageCertificate,sentLockedAt}') = 'string'
   and nullif(btrim(snapshot_totals #>> '{__mageCertificate,sentLockedAt}'), '') is not null;

do $verify$
declare
  v_def text := pg_get_functiondef('public.freeze_certified_aia_pay_app()'::regprocedure);
begin
  if position('old.sent_locked_at is not null' in v_def) = 0
     or position('__mageCertificate,certifiedExplanation' in v_def) = 0 then
    raise exception '[aia_pay_app_send_lock] verify: the freeze function lost the send lock or the certificate exemption';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.aia_pay_apps'::regclass and not tgisinternal
        and tgname in ('trg_aia_pay_app_stamp_send_lock', 'trg_freeze_certified_aia_pay_app')) <> 2 then
    raise exception '[aia_pay_app_send_lock] verify: a trigger is missing';
  end if;
  if has_function_privilege('anon', 'public.aia_pay_app_stamp_send_lock()', 'execute')
     or has_function_privilege('authenticated', 'public.aia_pay_app_stamp_send_lock()', 'execute') then
    raise exception '[aia_pay_app_send_lock] verify: the stamp function is callable by a client';
  end if;
end;
$verify$;

notify pgrst, 'reload schema';
