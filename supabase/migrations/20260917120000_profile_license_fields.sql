-- ============================================================================
-- profiles.license_state / profiles.license_expiry — the contractor's OWN
-- licence, as its own facts.
--
-- ── ORDER: APPLY THIS MIGRATION BEFORE THE OTA THAT WRITES THESE COLUMNS. ───
-- contexts/ProjectContext.tsx saves settings as ONE profiles update carrying
-- every settings field (company name, address, licence number, tax rate,
-- contingency, digest, financing …). Once the client sends license_state /
-- license_expiry, a server without these columns answers PGRST204 ("Could not
-- find the 'license_state' column") for the WHOLE update, which
-- utils/offlineQueue.ts classes as transient and re-queues — so every settings
-- save from every updated device stops reaching the server until this lands.
-- Apply, verify both columns exist (and PostgREST's schema cache has
-- reloaded — the NOTIFY below), THEN publish the update.
--
-- WHY. The 2026-09-16 screen-audit fix gave the bid licence gate
-- (utils/bidDocumentIdentity.ts — CA/FL/AZ statutes put the licence number on
-- the bid) an answer to "which state licenses you?", but CompanyBranding had
-- no state field, so the answer was stored on profiles.location — the PRICING
-- market. Two different facts in one column: picking a California metro in
-- Materials switched on California's licence-number block, and a contractor
-- licensed in one state who prices in another could not say so. The licence
-- now has its own column; the gate reads it first, then the address state,
-- then the market (kept as a fallback so accounts that answered through the
-- market yesterday keep their gate). No backfill: copying location's state
-- into license_state would turn yesterday's inference into a recorded answer
-- the contractor never gave, and the fallback already covers those accounts.
--
-- TYPES.
--   license_state   text, NULL or a two-letter upper-case code. The client
--                   only ever sends what utils/codeJurisdiction.normalizeState
--                   produced (licenceStateColumnValue) — a CHECK violation is
--                   TERMINAL in the offline queue and would drop the whole
--                   settings update, so the client normaliser and this CHECK
--                   must agree. The CHECK is shape-only on purpose: the
--                   authoritative state list lives in codeJurisdiction.ts, and
--                   a second copy here would drift.
--   license_expiry  date. A licence expires on a calendar day, not an instant.
--                   profiles has no other calendar-day column to match (its
--                   dates are timestamptz instants); subcontractors.
--                   license_expiry is legacy free text with '' defaults, which
--                   is exactly the shape that lets "12/31" or "2026-02-30" in.
--                   PostgREST returns a date as a bare 'YYYY-MM-DD', which
--                   utils/calendarDate reads without a timezone shift.
-- Both nullable, no defaults: NULL means "the contractor has not told us",
-- a different fact from any value.
--
-- RLS. None added or changed: profiles already restricts SELECT / INSERT /
-- UPDATE to auth.uid() = id, and new columns inherit the row policies.
--
-- Idempotent throughout.
-- ============================================================================

alter table public.profiles
  add column if not exists license_state  text,
  add column if not exists license_expiry date;

-- The CHECK is added separately (not inline on ADD COLUMN) so a re-run after
-- the column exists still gets the constraint, and a re-run with it present
-- is a no-op.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_license_state_format'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_license_state_format
      check (license_state is null or license_state ~ '^[A-Z]{2}$');
  end if;
end $$;

comment on column public.profiles.license_state is
  'Two-letter USPS code of the state that issued the contractor''s own licence. NULL = not told. Distinct from location (pricing market). Read by utils/bidDocumentIdentity.ts.';
comment on column public.profiles.license_expiry is
  'Calendar day the contractor''s own licence expires. NULL = not told. Written by app/get-verified.tsx.';

-- Reload PostgREST's schema cache so the columns are writable immediately.
notify pgrst, 'reload schema';
