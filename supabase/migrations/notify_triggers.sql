-- AFTER INSERT triggers that drive the notify fan-out.
--
-- Pre-audit (May 2026), source comments referenced these triggers but no
-- migration ever defined them. The biggest user-visible consequence: a
-- homeowner posts an RFP, sees the success alert "contractors near you
-- will be notified", and silently nothing happens. This file fixes that
-- for the most-impactful trigger (public_bids_notify_nearby) and stubs
-- the remaining four with TODOs that need the operator's schema review.
--
-- Why stubs vs. ship-ready: I (the audit author) confirmed via
-- supabase/functions/notify/index.ts that the dispatcher expects
-- `{event, source_table, source_id, payload}` — but I don't have
-- visibility into whether the relevant tables (`portal_messages`,
-- `budget_proposals`, `change_orders`, `sub_invoices`) exist with the
-- exact column names below. Wrapping each in `to_regclass` so the
-- migration is non-destructive: missing tables skip silently, present
-- ones get the trigger.
--
-- The fire_notify() helper already exists (per grant_fire_notify_to_anon)
-- and takes (url text, key text, body text). It does the pg_net call.
-- For the homeowner-RFP path we POST direct to notify-nearby-contractors.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── 1. public_bids_notify_nearby ──────────────────────────────────────
-- The flagship missing trigger. Without this, every homeowner-posted RFP
-- silently fails to fan out, despite the app showing a success alert.

CREATE OR REPLACE FUNCTION public.public_bids_notify_nearby_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $body$
BEGIN
  -- Only fire for homeowner RFPs. Public/govt bids come in via the
  -- fetch-external-data cron and don't need a near-me fan-out.
  IF NEW.is_homeowner_rfp IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/notify-nearby-contractors',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('record', to_jsonb(NEW)),
    timeout_milliseconds := 30000
  );
  RETURN NEW;
END;
$body$;

DO $$
BEGIN
  IF to_regclass('public.public_bids') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS public_bids_notify_nearby ON public.public_bids;
    CREATE TRIGGER public_bids_notify_nearby
      AFTER INSERT ON public.public_bids
      FOR EACH ROW
      EXECUTE FUNCTION public.public_bids_notify_nearby_fn();
  ELSE
    RAISE NOTICE 'public_bids table missing; skipping public_bids_notify_nearby trigger';
  END IF;
END $$;

-- ── 2-5. Other notify triggers (best-effort, schema-defensive) ────────
--
-- These attach to user-action tables that drive the notify dispatcher.
-- Each is wrapped in a to_regclass guard so it skips cleanly if the
-- table doesn't exist on this DB. If your schema uses different column
-- names than the ones below, copy the pattern and adjust.

-- 2. portal_messages → notify('portal_message')
CREATE OR REPLACE FUNCTION public.notify_portal_message_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $body$
BEGIN
  PERFORM net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/notify',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'event', 'portal_message',
      'source_table', 'portal_messages',
      'source_id', NEW.id::text,
      'payload', to_jsonb(NEW)
    ),
    timeout_milliseconds := 20000
  );
  RETURN NEW;
END;
$body$;

DO $$
BEGIN
  IF to_regclass('public.portal_messages') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS notify_portal_message ON public.portal_messages;
    CREATE TRIGGER notify_portal_message
      AFTER INSERT ON public.portal_messages
      FOR EACH ROW
      EXECUTE FUNCTION public.notify_portal_message_fn();
  ELSE
    RAISE NOTICE 'portal_messages table missing; skipping notify_portal_message trigger';
  END IF;
END $$;

-- 3. budget_proposals → notify('budget_proposal')
CREATE OR REPLACE FUNCTION public.notify_budget_proposal_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $body$
BEGIN
  PERFORM net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/notify',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'event', 'budget_proposal',
      'source_table', 'budget_proposals',
      'source_id', NEW.id::text,
      'payload', to_jsonb(NEW)
    ),
    timeout_milliseconds := 20000
  );
  RETURN NEW;
END;
$body$;

DO $$
BEGIN
  IF to_regclass('public.budget_proposals') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS notify_budget_proposal ON public.budget_proposals;
    CREATE TRIGGER notify_budget_proposal
      AFTER INSERT ON public.budget_proposals
      FOR EACH ROW
      EXECUTE FUNCTION public.notify_budget_proposal_fn();
  ELSE
    RAISE NOTICE 'budget_proposals table missing; skipping notify_budget_proposal trigger';
  END IF;
END $$;

-- 4. change_orders → notify('co_approval') when status flips to 'approved'
CREATE OR REPLACE FUNCTION public.notify_co_approval_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $body$
BEGIN
  -- Only fire when status TRANSITIONS to approved (not on every update of
  -- an already-approved row). Saves the dispatcher from flooding on
  -- field-edit bumps after approval.
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status <> 'approved') THEN
    PERFORM net.http_post(
      url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/notify',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object(
        'event', 'co_approval',
        'source_table', 'change_orders',
        'source_id', NEW.id::text,
        'payload', to_jsonb(NEW)
      ),
      timeout_milliseconds := 20000
    );
  END IF;
  RETURN NEW;
END;
$body$;

DO $$
BEGIN
  IF to_regclass('public.change_orders') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS notify_co_approval ON public.change_orders;
    CREATE TRIGGER notify_co_approval
      AFTER UPDATE ON public.change_orders
      FOR EACH ROW
      EXECUTE FUNCTION public.notify_co_approval_fn();
  ELSE
    RAISE NOTICE 'change_orders table missing; skipping notify_co_approval trigger';
  END IF;
END $$;

-- 5. sub_invoices → notify('sub_invoice_submitted')
-- Adjust the table name if your schema uses `subcontractor_invoices` or
-- the same `invoices` table with a `submitted_by_sub` flag.
CREATE OR REPLACE FUNCTION public.notify_sub_invoice_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $body$
BEGIN
  PERFORM net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/notify',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'event', 'sub_invoice_submitted',
      'source_table', 'sub_invoices',
      'source_id', NEW.id::text,
      'payload', to_jsonb(NEW)
    ),
    timeout_milliseconds := 20000
  );
  RETURN NEW;
END;
$body$;

DO $$
BEGIN
  IF to_regclass('public.sub_invoices') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS notify_sub_invoice ON public.sub_invoices;
    CREATE TRIGGER notify_sub_invoice
      AFTER INSERT ON public.sub_invoices
      FOR EACH ROW
      EXECUTE FUNCTION public.notify_sub_invoice_fn();
  ELSE
    RAISE NOTICE 'sub_invoices table missing; skipping notify_sub_invoice trigger';
  END IF;
END $$;
