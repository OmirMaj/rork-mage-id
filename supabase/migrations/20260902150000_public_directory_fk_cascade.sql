-- ============================================================================
-- public directory → auth.users: SET NULL becomes CASCADE.
--
-- WHY. Four FKs to auth.users were declared ON DELETE SET NULL (verified
-- against production 2026-09-02: pg_constraint.confdeltype = 'n'):
--     public_bids_user_id_fkey        companies_user_id_fkey
--     worker_profiles_user_id_fkey    job_listings_user_id_fkey
--
-- Unlike NO ACTION these do not BLOCK auth.admin.deleteUser — they do
-- something worse. The delete NULLs user_id and leaves the row standing, and
-- every DELETE policy on these tables is `using (auth.uid() = user_id)`, which
-- can never match NULL. The row becomes permanently undeletable by anyone
-- through the API — not the user, not support, not the app — while SELECT
-- stays wide open (public_bids_select and companies_select are `using (true)`).
--
-- What that meant in practice: a homeowner posts a renovation RFP through
-- app/post-rfp.tsx, which writes address_line, latitude, longitude,
-- contact_email, scope_description, photo_urls (interior photos of their
-- house) and drawing_urls into public_bids. They then delete their MAGE ID
-- account. The listing stayed live and browsable by every contractor on the
-- platform forever — app/nearby-rfps.tsx filters only on is_homeowner_rfp and
-- status — and only a manual service-role SQL delete could remove it. That is
-- a GDPR/CCPA erasure failure and an Apple 5.1.1(v) failure.
--
-- supabase/functions/delete-account now deletes these rows explicitly before
-- the auth delete. This migration is the BACKSTOP: it makes the database
-- enforce what the function intends, so the same bug cannot return through a
-- different code path (an admin console delete, a support script, a future
-- refactor). Same reasoning as 20260902120000_collaborator_fk_cascade.sql.
--
-- Scraped government bids in public_bids carry user_id NULL and are untouched
-- by either path. public_bids' own children are already ON DELETE CASCADE
-- (bid_questions_bid_id_fkey, bid_responses_bid_id_fkey), so the chain
-- completes; bid_responses_proposer_company_id_fkey stays SET NULL because a
-- bid submitted to someone else's project is their record, not the departing
-- company's.
--
-- NOT CHANGED, DELIBERATELY: crew_members_claimed_by_user_id_fkey is the fifth
-- SET NULL FK to auth.users and stays SET NULL. That row belongs to the GC who
-- created the worker record, not to the person who redeemed the claim link —
-- cascading it would delete a stranger's crew roster. delete-account releases
-- the claim instead (claimed_by_user_id and claimed_at both nulled) so the GC
-- can re-issue the invite.
--
-- Idempotent: drops by name, then recreates.
-- ============================================================================

alter table public.public_bids
  drop constraint if exists public_bids_user_id_fkey;

alter table public.public_bids
  add constraint public_bids_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.companies
  drop constraint if exists companies_user_id_fkey;

alter table public.companies
  add constraint companies_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.worker_profiles
  drop constraint if exists worker_profiles_user_id_fkey;

alter table public.worker_profiles
  add constraint worker_profiles_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.job_listings
  drop constraint if exists job_listings_user_id_fkey;

alter table public.job_listings
  add constraint job_listings_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

comment on constraint public_bids_user_id_fkey on public.public_bids is
  'ON DELETE CASCADE is load-bearing: with SET NULL, deleting a homeowner left their RFP — street address, GPS coordinates, contact email and interior photos of their house — live, publicly browsable, and undeletable by anyone through the API, because public_bids_delete is using (auth.uid() = user_id) and user_id was now NULL. See scripts/validate-account-deletion-storage.ts.';
