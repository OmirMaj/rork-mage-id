-- ============================================================================
-- project_financials — the contract terms: delivery mode, GMP cap, contractor
-- fee, retainage.
--
-- ── ORDER: APPLY THIS MIGRATION BEFORE THE OTA THAT WRITES THESE COLUMNS. ───
-- utils/offlineQueue.ts classes a PostgREST schema-cache miss (PGRST204,
-- "Could not find the 'gmp_cap' column") as TRANSIENT and re-queues it. The
-- project_financials upsert is ONE write that also carries estimate /
-- linked_estimate / estimate_versions / target_budget, so on a device that has
-- set any contract term, an OTA landing first would park that job's estimate
-- edits in the queue until this migration is applied. Nothing is lost, but the
-- money silently stops reaching the server. Apply, verify the columns exist,
-- THEN publish the update.
--
-- WHY. types/index.ts has declared Project.contractMode / gmpCap /
-- contractorFeePercent / contractorFeeAmount for months and two shipped
-- readers consume them — utils/portalSnapshot.ts builds the client portal's
-- open-book / GMP transparency block from them, and utils/wip.ts falls back to
-- the GMP cap as the contract value under the provenance label "GMP cap you
-- entered in project setup". No column ever existed, so no screen could set
-- them and a seeded value was wiped by the next server load. Project.
-- retainagePercent (+ its `assumed` flag) had the same shape: the invoice
-- screen asks the GC once, stores it on the project, and the next fetch threw
-- the answer away, so he was asked again on every device and every reload.
--
-- WHY project_financials AND NOT projects. These are money. 20260826140000
-- moved every money column off `projects` because RLS is row-level and cannot
-- blind a column: a 'field' collaborator must read projects.schedule, so
-- anything on that row is readable by the foreman. The four legacy money
-- columns still sit on `projects` only for an older build's sake (the held
-- phase-2 drop removes them); nothing older reads these new terms, so there is
-- no legacy copy to keep in step and no reason to open a new leak that the
-- phase-2 drop would not even close. project_financials already carries the
-- right policies — SELECT owner/editor/viewer, WRITE owner/editor, field
-- excluded — so no policy changes here.
--
-- CHECK CONSTRAINTS mirror the TypeScript unions and ranges exactly
-- (scripts/validate-project-contract-terms.ts holds them to parity):
--   contract_mode            'fixed' | 'cost_plus' | 'gmp' | 'open_book'
--   gmp_cap                  >= 0
--   contractor_fee_percent   0..100
--   contractor_fee_amount    >= 0
--   retainage_percent        0..100 (utils/retainageSource.isRecordedRetainageRate)
-- Deliberately NO cross-column rule (e.g. "percent XOR amount", "cap only when
-- gmp"). The client sends only the terms a device actually knows — an
-- unconfirmed term is omitted, not nulled — so a merged row can briefly hold a
-- combination no single device chose. A violation is TERMINAL in the offline
-- queue and would drop the whole upsert, estimate included. The edit screen
-- enforces the combinations instead.
--
-- All columns nullable, no defaults: NULL means "nobody has told us", which is
-- a different fact from 0 (see Project.retainagePercent).
--
-- Idempotent throughout.
-- ============================================================================

alter table public.project_financials
  add column if not exists contract_mode             text,
  add column if not exists gmp_cap                   numeric,
  add column if not exists contractor_fee_percent    numeric,
  add column if not exists contractor_fee_amount     numeric,
  add column if not exists retainage_percent         numeric,
  add column if not exists retainage_percent_assumed boolean;

-- Drop-and-add keeps a re-run idempotent AND lets a later edit of the allowed
-- set land by re-running this file's shape in a new migration.
alter table public.project_financials
  drop constraint if exists project_financials_contract_mode_check;
alter table public.project_financials
  add constraint project_financials_contract_mode_check
  check (contract_mode is null or contract_mode in ('fixed', 'cost_plus', 'gmp', 'open_book'));

alter table public.project_financials
  drop constraint if exists project_financials_gmp_cap_check;
alter table public.project_financials
  add constraint project_financials_gmp_cap_check
  check (gmp_cap is null or gmp_cap >= 0);

alter table public.project_financials
  drop constraint if exists project_financials_contractor_fee_percent_check;
alter table public.project_financials
  add constraint project_financials_contractor_fee_percent_check
  check (contractor_fee_percent is null or (contractor_fee_percent >= 0 and contractor_fee_percent <= 100));

alter table public.project_financials
  drop constraint if exists project_financials_contractor_fee_amount_check;
alter table public.project_financials
  add constraint project_financials_contractor_fee_amount_check
  check (contractor_fee_amount is null or contractor_fee_amount >= 0);

alter table public.project_financials
  drop constraint if exists project_financials_retainage_percent_check;
alter table public.project_financials
  add constraint project_financials_retainage_percent_check
  check (retainage_percent is null or (retainage_percent >= 0 and retainage_percent <= 100));

comment on column public.project_financials.contract_mode is
  'Contract delivery model: fixed | cost_plus | gmp | open_book. Drives the client portal transparency block (utils/portalSnapshot.ts). NULL = never set. See 20260917110000_project_contract_terms.sql.';
comment on column public.project_financials.gmp_cap is
  'Guaranteed Maximum Price the GC entered. utils/wip.ts reads it as a contract-value fallback. NULL = not a GMP job / not entered.';
comment on column public.project_financials.retainage_percent is
  'Retainage the contract holds back, percent of work value. NULL = never asked (NOT 0). Read through utils/retainageSource.resolveRetainagePercent.';
comment on column public.project_financials.retainage_percent_assumed is
  'True when retainage_percent was carried from earlier paperwork rather than read off the contract; the UI labels it as carried.';

-- PostgREST caches the schema; without this the new columns 400 (PGRST204)
-- until its next reload, which the offline queue would re-queue in the meantime.
notify pgrst, 'reload schema';
