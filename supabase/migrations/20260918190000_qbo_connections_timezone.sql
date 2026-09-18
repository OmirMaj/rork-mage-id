-- ============================================================================
-- qbo_connections.timezone — the GC's IANA time zone, for QuickBooks dates.
--
-- Audit #98 (post-ship money-qbo). MAGE stores payment dates and invoice
-- issue/due dates as INSTANTS, and qbo-mapping sent QuickBooks the UTC day of
-- each one. A Pay-link payment at 9:30 pm EDT on Sep 30 is 01:30Z on Oct 1, so
-- QuickBooks booked it in October — a Dec 31 evening payment in the next tax
-- year on a cash basis; for a West Coast GC every payment after 5 pm moved.
-- Stripe runs server-side with no device clock, so the day has to be computed
-- where MAGE sends to QuickBooks, in the company's zone.
--
-- Written by qbo-sync (kind 'connection') from the device's
-- Intl.DateTimeFormat().resolvedOptions().timeZone when qbo-setup opens; read
-- by qbo-mapping/payment.ts and invoice.ts (qboDay). NULL = not registered
-- yet: the mappers fall back to the UTC day, the old behaviour, rather than
-- guessing a zone.
--
-- The table stays service-role only (DB-F10, 20260904100300): this adds a
-- column and touches no policy or grant; the checks below re-assert both.
--
-- Idempotent.
-- ============================================================================

alter table public.qbo_connections add column if not exists timezone text;

alter table public.qbo_connections drop constraint if exists qbo_connections_timezone_shape;
alter table public.qbo_connections add constraint qbo_connections_timezone_shape
  check (timezone is null or (char_length(timezone) between 1 and 64 and timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$'));

comment on column public.qbo_connections.timezone is
  'IANA zone of the GC''s device (qbo-sync kind connection). qbo-mapping sends QuickBooks this zone''s calendar day for an instant; NULL = UTC day (audit #98, 20260918190000).';

do $mig$
declare n int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'qbo_connections' and column_name = 'timezone') then
    raise exception '[190000] qbo_connections.timezone missing';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'qbo_connections';
  if n > 0 then
    raise exception '[190000] qbo_connections has % policy(ies) — it must stay service-role only', n;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and has_table_privilege('authenticated', 'public.qbo_connections', 'SELECT') then
    raise exception '[190000] authenticated holds SELECT on qbo_connections';
  end if;
  raise notice '[190000] qbo_connections.timezone ready';
end
$mig$;
