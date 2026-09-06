-- 20260904100000_notify_trigger_cron_secret.sql
--
-- Audit 2026-09-03 — EDGE-F3 / DB-F1 / OPS-F2: every trigger-driven GC
-- notification (portal message, budget proposal, CO approval, sub invoice
-- submitted / reviewed) has been silently dropped since April. The triggers
-- reach the `notify` edge function through public.fire_notify, which sends
--     Authorization: Bearer <app_config.notify_key>
-- and that row has been the EMPTY STRING since the migration that seeded it
-- (20260426183337). notify treats an empty bearer as an anonymous caller and
-- refuses those events with HTTP 200 {ok:false, reason:'event_not_anon_allowed'};
-- pg_net is fire-and-forget and fire_notify swallows errors, so nothing ever
-- recorded the drop.
--
-- FIX: authenticate the trigger path the way public_bids_notify_nearby_fn
-- already does — the pg_cron shared secret in the x-cron-secret header
-- (private.cron_auth, migration 20260523130000_cron_secret_guard). The notify
-- function (supabase/functions/notify/index.ts) treats a valid cron secret as a
-- privileged caller from the same change (isValidCron). Either half can be
-- applied first: the path is dead today and each half alone leaves it exactly
-- as dead — only both together turn it on. No app_config change is needed
-- (notify_url stays; notify_key is simply no longer read).
--
-- ALSO IN THIS MIGRATION
--   * fire_notify refuses direct calls (pg_trigger_depth() = 0). It must stay
--     EXECUTE-able by `authenticated`: the trg_notify_* trigger functions are
--     SECURITY INVOKER and run as whoever wrote the row, and the GC app writes
--     portal_messages (hooks/usePortalThread.ts, contexts/ProjectContext.tsx)
--     and updates sub_submitted_invoices (hooks/useSubSubmittedInvoices.ts)
--     directly — grant_fire_notify_to_anon.sql exists for exactly that 42501.
--     Without the depth guard that grant would let anyone holding the anon key
--     POST /rest/v1/rpc/fire_notify and reach notify as a PRIVILEGED caller
--     (any event, any recipient) the moment the cron secret is attached.
--   * `anon` loses EXECUTE. No anon INSERT/UPDATE policy exists on any of the
--     four trigger tables (20260713150001_portal_lock_direct_access dropped
--     them; verified live 2026-09-04), the portal pages write through
--     SECURITY DEFINER RPCs (portal_post_message, portal_submit_co_approval,
--     portal_submit_budget_proposal, sub_portal_submit_invoice — the trigger
--     then runs as their owner), so a trigger never runs as anon. No app code
--     calls .rpc('fire_notify') (grep utils/ hooks/ app/ marketing/ 2026-09-04).
--   * portal_messages: the live trigger was the older notify_portal_message_fn
--     (no credential; fires for GC-authored rows too; ships to_jsonb(NEW)). It
--     now runs trg_notify_portal_message, which fires only for author_type =
--     'client' and sends exactly the keys notify reads (portal_id, project_id,
--     invite_id, author_type, author_name, body). notify_portal_message_fn is
--     rewritten to the same behaviour and kept only so an environment where the
--     trigger still points at it behaves identically; drop it once every
--     environment has the trigger switch.
--   * notify_budget_proposal_fn / notify_sub_invoice_fn — the previous
--     generation of the portal_budget_proposals / sub_submitted_invoices
--     trigger functions (POST to notify with no credential at all) — are
--     dropped (step 5). Nothing has pointed at them since the trg_notify_*
--     switch (pg_trigger has no row with either as tgfoid; verified live
--     2026-09-04), and an unattached trigger function is only a way to
--     re-attach the unauthenticated path by mistake (review 2026-09-04,
--     advisory 6).
--
-- Idempotent: CREATE OR REPLACE / DROP TRIGGER IF EXISTS / DROP FUNCTION IF
-- EXISTS / REVOKE + GRANT.
-- Reversible: re-create fire_notify from supabase/schema.sql @ af1cda45 and
-- re-point the trigger at notify_portal_message_fn; the two dropped legacy
-- functions are in the same file (schema.sql:4664 and :4710 @ af1cda45).
--
-- Verify after apply:
--   select proname, prosecdef from pg_proc where proname in ('fire_notify','trg_notify_portal_message');
--   select tgname, tgfoid::regproc from pg_trigger
--     where tgrelid = 'public.portal_messages'::regclass and not tgisinternal;
--   select proname from pg_proc
--     where proname in ('notify_budget_proposal_fn', 'notify_sub_invoice_fn');  -- expect 0 rows
--   -- then post a client message through the homeowner portal and expect a
--   -- notification_outbox row with event_type = 'portal_message' within ~5 s,
--   -- and a 2xx row in net._http_response for /functions/v1/notify.

-- ── 1. fire_notify: x-cron-secret instead of the empty bearer ───────────────
create or replace function public.fire_notify(p_event text, p_source_table text, p_source_id text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_url text;
  v_secret text;
begin
  -- Only triggers may call this. A direct POST /rest/v1/rpc/fire_notify would
  -- otherwise reach notify carrying the cron secret, i.e. fully privileged.
  if pg_trigger_depth() = 0 then
    raise exception 'fire_notify may only be called from a trigger'
      using errcode = '42501';
  end if;

  begin
    select value into v_url from public.app_config where key = 'notify_url';
    if v_url is null or v_url = '' then
      raise notice 'fire_notify: notify_url not configured';
      return;
    end if;

    -- Same credential public_bids_notify_nearby_fn sends; validated by notify
    -- through verify_cron_secret(). The value never leaves the database.
    select secret into v_secret from private.cron_auth limit 1;
    if v_secret is null or v_secret = '' then
      raise notice 'fire_notify: cron secret not configured (private.cron_auth)';
      return;
    end if;

    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', v_secret
      ),
      body := jsonb_build_object(
        'event', p_event,
        'source_table', p_source_table,
        'source_id', p_source_id,
        'payload', p_payload
      ),
      timeout_milliseconds := 20000
    );
  exception when others then
    -- Never let a notification failure roll back the row that caused it.
    raise notice 'fire_notify failed: %', sqlerrm;
  end;
end;
$function$;

revoke execute on function public.fire_notify(text, text, text, jsonb) from public, anon;
grant execute on function public.fire_notify(text, text, text, jsonb) to authenticated, service_role;

-- ── 2. trg_notify_portal_message: the trigger function that should be live ──
-- Identical to the definition already in production (supabase/schema.sql);
-- re-stated so this migration is self-contained on any environment.
create or replace function public.trg_notify_portal_message()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if NEW.author_type = 'client' then
    perform public.fire_notify(
      'portal_message',
      'portal_messages',
      NEW.id::text,
      jsonb_build_object(
        'portal_id', NEW.portal_id,
        'project_id', NEW.project_id,
        'invite_id', NEW.invite_id,
        'author_type', NEW.author_type,
        'author_name', NEW.author_name,
        'body', NEW.body
      )
    );
  end if;
  return NEW;
end;
$function$;

-- ── 3. notify_portal_message_fn: rewritten, no longer attached after step 4 ─
-- Used to POST to notify with headers '{"Content-Type": "application/json"}'
-- (no credential) for every row. Now delegates to fire_notify (cron secret,
-- client-authored rows only) so it is safe wherever it is still attached.
create or replace function public.notify_portal_message_fn()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if NEW.author_type = 'client' then
    perform public.fire_notify(
      'portal_message',
      'portal_messages',
      NEW.id::text,
      jsonb_build_object(
        'portal_id', NEW.portal_id,
        'project_id', NEW.project_id,
        'invite_id', NEW.invite_id,
        'author_type', NEW.author_type,
        'author_name', NEW.author_name,
        'body', NEW.body
      )
    );
  end if;
  return NEW;
end;
$function$;

-- ── 4. portal_messages: switch the live trigger ────────────────────────────
drop trigger if exists notify_portal_message on public.portal_messages;
create trigger notify_portal_message
  after insert on public.portal_messages
  for each row execute function public.trg_notify_portal_message();

-- ── 5. legacy, unattached, credential-less trigger functions: drop ──────────
-- Both are zero-argument `returns trigger` functions (pg_proc, 2026-09-04) and
-- no trigger references either one. Deliberately no CASCADE: an environment
-- where one IS still attached fails loudly here instead of silently losing
-- its trigger — re-point that trigger at the trg_notify_* function first.
drop function if exists public.notify_budget_proposal_fn();
drop function if exists public.notify_sub_invoice_fn();
