-- CRON auth guard — close the verify_jwt=false public-invocation gap on the 7
-- pg_cron-driven edge functions (coi-expiry-watch, daily-digest,
-- fetch-external-data, geocode-bids, homeowner-weekly-digest, invoice-dunning,
-- morning-digest). Before: anyone with the URL could POST and trigger mass
-- emails / data jobs (bounded only by each fn's per-day dedupe). After: the
-- cron passes a 256-bit shared secret in the x-cron-secret header; each
-- function validates it via verify_cron_secret() before doing work. The two
-- dual-path fns (morning-digest, homeowner-weekly-digest) ALSO still accept an
-- authenticated user JWT for their in-app preview / recap buttons.
--
-- The secret lives in private.cron_auth (never in the PostgREST search path).
-- The cron reads it directly (postgres role); edge functions validate via the
-- SECURITY DEFINER verify_cron_secret() RPC with the service role — the secret
-- value never leaves the DB, only a boolean is returned.
--
-- Ordering note: this migration makes the crons SEND the header. The functions
-- don't REQUIRE it until their guarded versions are deployed — so applying this
-- first is non-breaking (old function versions ignore the extra header).
--
-- Reversible:
--   -- restore the prior cron commands (drop the x-cron-secret header), then:
--   drop function public.verify_cron_secret(text);
--   drop table private.cron_auth;   -- and: drop schema private (if now empty)

-- 1) Secret store — private schema is not exposed via PostgREST.
create schema if not exists private;
create table if not exists private.cron_auth (
  id int primary key default 1 check (id = 1),
  secret text not null
);
insert into private.cron_auth (id, secret)
  values (1, encode(gen_random_bytes(32), 'hex'))
  on conflict (id) do nothing;
-- pg_cron jobs run as the postgres role; ensure it can read the secret.
grant usage on schema private to postgres;
grant select on private.cron_auth to postgres;

-- 2) Boolean validator for edge functions. SECURITY DEFINER so it can read the
--    private table; returns only true/false. Service-role only (never anon).
create or replace function public.verify_cron_secret(p_secret text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from private.cron_auth where secret = p_secret);
$$;
revoke all on function public.verify_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_cron_secret(text) to service_role;

-- 3) Re-schedule the 7 live cron jobs to send the secret. Names / schedules /
--    bodies / timeouts preserved exactly; only the header set changes.
--    cron.schedule upserts by jobname; the secret subquery runs each fire.
select cron.schedule('coi-expiry-watch-daily', '0 13 * * *', $j$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/coi-expiry-watch',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select secret from private.cron_auth limit 1)),
    body := '{"all": true}'::jsonb,
    timeout_milliseconds := 240000
  );
$j$);

select cron.schedule('daily-digest', '0 13 * * *', $j$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select secret from private.cron_auth limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$j$);

select cron.schedule('fetch-external-data-schedule', '0 6,12,18,22 * * *', $j$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/fetch-external-data',
    headers := jsonb_build_object(
      'Authorization','Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type','application/json',
      'x-cron-secret',(select secret from private.cron_auth limit 1)
    ),
    body := '{}'::jsonb
  );
$j$);

select cron.schedule('geocode-bids', '0 8 * * *', $j$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/geocode-bids',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select secret from private.cron_auth limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$j$);

select cron.schedule('homeowner-weekly-digest-friday', '0 21 * * 5', $j$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/homeowner-weekly-digest',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select secret from private.cron_auth limit 1)),
    body := '{"all": true}'::jsonb,
    timeout_milliseconds := 240000
  );
$j$);

select cron.schedule('invoice-dunning', '0 15 * * *', $j$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/invoice-dunning',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select secret from private.cron_auth limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$j$);

select cron.schedule('morning-digest-hourly', '5 * * * *', $j$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/morning-digest',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select secret from private.cron_auth limit 1)),
    body := '{"all": true}'::jsonb,
    timeout_milliseconds := 180000
  );
$j$);
