-- 20260919010000_invoice_bill_to.sql — wave 3, lane invoice-send-pay (#47)
--
-- WHY. Automatic payment reminders (invoice-dunning) went only to the project's
-- FIRST client-portal invitee. The address the GC actually emailed the invoice
-- to (the owner's AP desk, the lender's draw admin) lived only in the Send
-- sheet's component state and was never stored — so a FINAL NOTICE could go to
-- the homeowner's spouse or the architect, and a project with no portal got no
-- reminder at all, every day, with nothing telling the GC.
--
-- WHAT. Two nullable text columns on invoices, written by the app when a send
-- succeeds (app/invoice.tsx → ProjectContext.updateInvoice → offline queue).
-- invoice-dunning prefers bill_to_email and falls back to the portal invitee,
-- and checks the unsubscribe list on whichever address it uses.
--
-- DELIBERATELY NO CHECK CONSTRAINT. The column rides the SAME update as the
-- invoice's flip to 'sent'; utils/offlineQueue treats a constraint violation as
-- terminal and would drop that whole write — the invoice would stay a draft on
-- the server for an email the client already has. The app trims; the server
-- only ever reads an address containing '@'.
--
-- DEPLOY ORDER: before the OTA whose ProjectContext maps billToEmail →
-- bill_to_email (an unknown column is a terminal queue error), and before the
-- invoice-dunning deploy is ideal — although invoice-dunning retries its select
-- without these columns if they are missing, so either order keeps reminders
-- running. Grants: invoices is granted at table level, so new columns inherit.
-- Idempotent: safe to run twice.

alter table public.invoices add column if not exists bill_to_email text;
alter table public.invoices add column if not exists bill_to_name text;

comment on column public.invoices.bill_to_email is
  'Address the GC emailed this invoice to (set on a successful send). invoice-dunning reminds this address first, the first portal invitee only as a fallback.';
comment on column public.invoices.bill_to_name is
  'Name of the billing contact the invoice was sent to, when the GC gave one.';
