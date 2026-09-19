-- 20260919090000_submittal_intake_columns.sql — wave 3, lane `submittals`.
--
-- WHY (audit 2026-09, #60 and #144):
--   #144  The submittal screen's "Linked Schedule Task" picker saved nothing:
--         the Submittal type had no field for it and the table no column, so
--         the link was gone on reopen. The rfis table has carried
--         linked_task_id since 20260819160000; submittals now do too.
--   #60   The spec-book import showed each item's submittal type, trade,
--         source pages and estimated lead on the review screen and then threw
--         them away on save, so the log lost the page reference he needs to
--         check the spec. And its Required Date was upload day + 14/30 — a
--         guess. It is now either blank or DERIVED from a schedule task's start
--         less the lead, and required_date_source records which, so the screen
--         can say where a date came from.
--
-- COLUMNS (all nullable, no default — an existing row reads exactly as before):
--   linked_task_id        text   schedule task ids are client-generated
--                                strings, not guaranteed uuids (the rfis column
--                                is uuid; a uuid here would refuse a non-uuid
--                                id and utils/offlineQueue treats that refusal
--                                as terminal — the write would be dropped).
--   submittal_type        text   'Product Data', 'Shop Drawings', …
--   trade                 text
--   source_pages          jsonb  array of 1-based page numbers in the spec PDF
--   lead_days             int    estimated days before install (AI)
--   required_date_source  text   'schedule' | 'manual'
--
-- The two CHECKs only admit what the client writes, and NULL. Production
-- (read-only, 2026-09-18): 2 submittal rows, none carrying these columns, so
-- nothing existing can violate them. They are added NOT VALID then validated,
-- so a re-run is a no-op and a large table would not hold a long lock.
--
-- CLIENT CONTRACT for context-integrator's submittal mapper (it maps only
-- these six; the read maps them back):
--   linkedTaskId        ↔ linked_task_id        (undefined → null when cleared)
--   submittalType       ↔ submittal_type
--   trade               ↔ trade
--   sourcePages         ↔ source_pages          (number[])
--   leadDays            ↔ lead_days             (integer ≥ 0)
--   requiredDateSource  ↔ required_date_source  ('schedule' | 'manual')
-- Existing columns required_date / submitted_date stay text NOT NULL; the
-- client now writes '' for "not set" / "not sent", which both accept.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; constraints guarded by name.
-- Apply via MCP apply_migration BEFORE the OTA that writes these columns.

alter table public.submittals add column if not exists linked_task_id text;
alter table public.submittals add column if not exists submittal_type text;
alter table public.submittals add column if not exists trade text;
alter table public.submittals add column if not exists source_pages jsonb;
alter table public.submittals add column if not exists lead_days int;
alter table public.submittals add column if not exists required_date_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.submittals'::regclass
       and conname = 'submittals_required_date_source_check'
  ) then
    alter table public.submittals
      add constraint submittals_required_date_source_check
      check (required_date_source is null or required_date_source in ('schedule', 'manual')) not valid;
    alter table public.submittals validate constraint submittals_required_date_source_check;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.submittals'::regclass
       and conname = 'submittals_source_pages_array_check'
  ) then
    alter table public.submittals
      add constraint submittals_source_pages_array_check
      check (source_pages is null or jsonb_typeof(source_pages) = 'array') not valid;
    alter table public.submittals validate constraint submittals_source_pages_array_check;
  end if;
end
$$;

comment on column public.submittals.linked_task_id is
  'Schedule task this submittal gates (client task id, text). Written by app/submittal.tsx and the spec-book import.';
comment on column public.submittals.lead_days is
  'Estimated days before installation the architect wants it in hand (AI, from the spec book). Not a deadline.';
comment on column public.submittals.required_date_source is
  '''schedule'' = task start less lead_days; ''manual'' = typed by the GC; NULL = legacy/unset.';
