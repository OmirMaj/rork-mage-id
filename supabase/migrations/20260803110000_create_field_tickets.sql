-- create_field_tickets.sql
--
-- Backend for the T&M / extra-work field ticket (app/field-ticket.tsx).
-- Unbilled extra work is the largest single source of lost revenue for a GC:
-- the super notices out-of-scope work at 2pm, nobody signs anything, and at
-- closeout the owner denies it happened. A ticket signed on site at the moment
-- the work happens is what makes it billable.
--
-- Schema mirrors the TypeScript `FieldTicket` interface in types/index.ts.
-- Writes arrive through utils/offlineQueue.ts `supabaseWrite`, so a jobsite
-- with no signal captures the ticket locally and drains later.
--
-- IMMUTABILITY: enforcement lives in the app (ProjectContext.updateFieldTicket
-- refuses content edits once status leaves 'draft'; see
-- utils/fieldTicketCore.sealedFieldTicketViolations). It is deliberately NOT a
-- DB trigger — the offline queue replays UPDATEs that may legitimately arrive
-- after the seal (photo storage_path backfill, the conversion stamp), and a
-- hard trigger would classify those as permanent failures and drop them.
--
-- PHOTOS: `photos` holds the same JSON shape the app uses, with `uri` set to
-- the project-photos STORAGE PATH — never a file:// URI. The bytes ride
-- utils/photoUploadQueue.ts.

CREATE TABLE IF NOT EXISTS public.field_tickets (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id text NOT NULL,

  -- Per-project sequential ticket number, rendered "T&M-007". Independent of
  -- the change_orders.number sequence: a CO number is client-facing and must
  -- not be burned on a ticket that never gets signed.
  number integer NOT NULL DEFAULT 1,

  -- The day the extra work was performed (may predate created_at when the
  -- super writes the ticket up that evening).
  date text NOT NULL,

  work_description text NOT NULL DEFAULT '',
  -- Why it sits outside the contract. This is the billability argument and it
  -- carries straight onto the change order's `reason`.
  reason_extra text NOT NULL DEFAULT '',

  -- Back-link when the ticket was started from a daily report.
  source_daily_report_id text,

  -- Cost detail as JSON arrays, matching FieldTicketLaborRow /
  -- FieldTicketMaterialRow / FieldTicketEquipmentRow. Rates and unit costs are
  -- OPTIONAL inside these rows on purpose: the owner's rep signs for hours and
  -- quantities, the office attaches money afterward.
  labor jsonb NOT NULL DEFAULT '[]'::jsonb,
  materials jsonb NOT NULL DEFAULT '[]'::jsonb,
  equipment jsonb NOT NULL DEFAULT '[]'::jsonb,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,

  markup_percent numeric(6,2) NOT NULL DEFAULT 0 CHECK (markup_percent >= 0),

  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'signed', 'converted', 'void')),

  -- FieldTicketAuthorization: { name, title, role, signedAt, signaturePaths[],
  -- latitude, longitude, locationLabel }. NULL until someone signs.
  -- QUOTED: `authorization` is a RESERVED WORD in Postgres. Unquoted this
  -- fails with `syntax error at or near "authorization"`. PostgREST quotes
  -- identifiers itself, so the app payload key stays `authorization`.
  "authorization" jsonb,

  -- Set exactly once, when a change order is built from this ticket.
  converted_change_order_id text,
  converted_at timestamptz,

  -- Append-only COAuditEntry[]. The matching dedupe marker lives on the
  -- CREATED change order's audit_trail (action='converted_from_field_ticket',
  -- detail=<this id>), which is what stops a double-bill after a cache wipe.
  audit_trail jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_tickets_user_idx
  ON public.field_tickets(user_id);

CREATE INDEX IF NOT EXISTS field_tickets_project_idx
  ON public.field_tickets(project_id, date DESC);

-- The "what have I signed but not yet billed?" query — the money question.
CREATE INDEX IF NOT EXISTS field_tickets_unbilled_idx
  ON public.field_tickets(user_id, status)
  WHERE status = 'signed';

CREATE OR REPLACE FUNCTION public.field_tickets_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS field_tickets_updated_at ON public.field_tickets;
CREATE TRIGGER field_tickets_updated_at
  BEFORE UPDATE ON public.field_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.field_tickets_set_updated_at();

-- RLS — the GC owns their tickets. The owner's rep signs on the GC's device;
-- they never get a row in this table.
ALTER TABLE public.field_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own field tickets" ON public.field_tickets;
DROP POLICY IF EXISTS "Users can insert their own field tickets" ON public.field_tickets;
DROP POLICY IF EXISTS "Users can update their own field tickets" ON public.field_tickets;
DROP POLICY IF EXISTS "Users can delete their own field tickets" ON public.field_tickets;

CREATE POLICY "Users can view their own field tickets"
  ON public.field_tickets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own field tickets"
  ON public.field_tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own field tickets"
  ON public.field_tickets FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own field tickets"
  ON public.field_tickets FOR DELETE
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.field_tickets TO authenticated;
