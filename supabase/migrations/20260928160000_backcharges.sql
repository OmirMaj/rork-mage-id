-- 20260928160000_backcharges.sql
--
-- public.backcharges — money a sub owes the GC (damage, cleanup, rework the GC
-- paid for), saved to the account instead of one phone.
--
-- WHY. Backcharges lived only in AsyncStorage (utils/backcharges.ts
-- BACKCHARGES_KEY = 'mageid_backcharges'). That key is under the mageid_
-- prefix, so the sign-out sweep deleted money the sub owed, and the web app
-- never saw a backcharge made on the phone. A record of money owed that
-- disappears is the fastest way to lose a GC's trust.
--
-- The client (hooks/useBackcharges.ts) keeps the device list as the instant,
-- offline copy and sends every add / apply / void through utils/offlineQueue
-- as an upsert of utils/backchargeRows.ts toRow(). It reads the account's rows
-- back and merges them (server wins, except for a row with a write still
-- waiting on that device).
--
-- DEPLOY ORDER: apply this BEFORE any OTA that contains the new hook. A client
-- upsert into a missing table is a terminal PostgREST refusal (42P01 /
-- PGRST205): the queue drops it and every backcharge lands under "Not saved".
--
-- ── RELATIONSHIPS ───────────────────────────────────────────────────────────
-- project_id → projects ON DELETE CASCADE: a deleted project takes its
--   backcharges with it (the owner deleted the job; nothing is left to bill).
-- sub_id is TEXT with NO foreign key: a deleted sub must never cascade money
--   away, and the app's sub ids are not all uuids (the subcontractors table is
--   not declared in this repo's migrations; legacy/fixture ids like 'sub-vega'
--   exist). A dangling id simply fails to join.
-- commitment_id is a nullable uuid with NO foreign key, like
--   public.deliveries (20260826200000): a deleted PO must not delete the
--   record of what the sub owes.
-- photo_id / punch_item_id / applied_invoice_id are text ids of app records
--   (ProjectPhoto, PunchItem, SubSubmittedInvoice). The device's local photo
--   URI is NOT stored — it is a path on one phone.
-- user_id → auth.users ON DELETE SET NULL (not CASCADE). It records who made
--   the backcharge. An editor who makes one on the OWNER'S project and later
--   deletes their account must not take the owner's money record with them:
--   supabase/functions/delete-account hands such rows over only for the tables
--   in COLLABORATOR_FIELD_TABLES, and this table is not in that list, so the
--   row stays with the project and loses only its author. Nothing reads
--   user_id to grant access (every policy below rides on project access), so
--   a null author changes no one's access.
--
-- ── WHO MAY READ AND WRITE MONEY ────────────────────────────────────────────
-- Owner and editor only: public.can_access_project(project_id, 'editor') for
-- SELECT, INSERT and UPDATE. Evidence:
--   * public.commitments — the sub money this deducts from — is owner-only
--     (commitments_owner_all, 20260518120000_rls_baseline.sql): no
--     collaborator reads a sub's contract value, so no collaborator below
--     editor should read what the sub owes against it;
--   * public.project_financials writes are 'editor' (20260826140000), and
--     'field' is excluded from every money read there;
--   * the client refuses the action to field and viewer seats
--     (utils/backcharges.ts BACKCHARGE_SEAT_FIELD "Backcharges are money, and
--     your role on this project doesn't include costs." / BACKCHARGE_SEAT_VIEWER).
-- INSERT also requires auth.uid() = user_id — the house shape of every
-- project-scoped table (20260826200000_deliveries.sql deliveries_collab_insert)
-- — so nobody can insert a money row attributed to another user.
-- No DELETE policy: a backcharge is voided, never deleted. The project cascade
-- still removes rows.
--
-- ── WHY A TRIGGER AND NOT ONLY POLICIES ─────────────────────────────────────
-- The queue sends `upsert(row)` → INSERT … ON CONFLICT (id) DO UPDATE SET
-- <every column in the payload>. The payload never carries user_id (toRow has
-- no userId parameter), but a policy cannot stop a hand-made request from
-- setting it. backcharges_guard() pins id, user_id, project_id and created_at
-- on every client UPDATE, stamps updated_at, and keeps a settled row settled:
-- the app only ever moves open → applied and open → void (markApplied and
-- voidOne in utils/backcharges.ts / hooks/useBackcharges.ts), so an applied or
-- void row never changes status again. A service-role session (auth.uid() is
-- null: the FK's ON DELETE SET NULL, support tooling) passes through untouched.
--
-- Idempotent: create … if not exists / or replace; every policy and trigger is
-- dropped first. Running it twice is a no-op.

-- ── a. precondition ─────────────────────────────────────────────────────────
do $pre$
begin
  if to_regprocedure('public.can_access_project(uuid,text)') is null then
    raise exception 'backcharges: public.can_access_project(uuid,text) is missing. Apply 20260826130000_field_role.sql first.';
  end if;
end
$pre$;

-- ── b. table ────────────────────────────────────────────────────────────────
create table if not exists public.backcharges (
  id                 uuid primary key,
  user_id            uuid default auth.uid() references auth.users(id) on delete set null,
  project_id         uuid not null references public.projects(id) on delete cascade,
  sub_id             text not null,
  sub_name           text not null default '',
  commitment_id      uuid,
  reason             text not null,
  amount_cents       bigint not null,
  basis              text not null,
  hours              numeric,
  rate_cents         bigint,
  photo_id           text,
  punch_item_id      text,
  status             text not null,
  applied_invoice_id text,
  applied_at         timestamptz,
  created_at         timestamptz not null,
  updated_at         timestamptz not null default now(),
  constraint backcharges_amount_positive   check (amount_cents > 0),
  constraint backcharges_basis_known       check (basis in ('typed','hours_x_rate')),
  constraint backcharges_hours_range       check (hours is null or (hours > 0 and hours <= 200)),
  constraint backcharges_rate_positive     check (rate_cents is null or rate_cents > 0),
  constraint backcharges_hours_x_rate_full check (basis <> 'hours_x_rate' or (hours is not null and rate_cents is not null)),
  constraint backcharges_status_known      check (status in ('open','applied','void')),
  constraint backcharges_applied_has_bill  check (status <> 'applied' or applied_invoice_id is not null),
  constraint backcharges_reason_present    check (length(btrim(reason)) > 0)
);

create index if not exists backcharges_project_sub_idx on public.backcharges (project_id, sub_id);
create index if not exists backcharges_user_idx on public.backcharges (user_id);

alter table public.backcharges enable row level security;

-- ── c. policies ─────────────────────────────────────────────────────────────
drop policy if exists backcharges_select on public.backcharges;
create policy backcharges_select on public.backcharges
  for select to authenticated
  using (public.can_access_project(project_id, 'editor'));

drop policy if exists backcharges_insert on public.backcharges;
create policy backcharges_insert on public.backcharges
  for insert to authenticated
  with check (auth.uid() = user_id and public.can_access_project(project_id, 'editor'));

drop policy if exists backcharges_update on public.backcharges;
create policy backcharges_update on public.backcharges
  for update to authenticated
  using      (public.can_access_project(project_id, 'editor'))
  with check (public.can_access_project(project_id, 'editor'));

-- No delete policy (see the header).
drop policy if exists backcharges_delete on public.backcharges;

-- ── d. grants ───────────────────────────────────────────────────────────────
-- The client role keeps exactly the three verbs it uses. TRUNCATE is not
-- subject to RLS, so it is revoked explicitly (20260926190000 hygiene).
revoke all on public.backcharges from anon, public;
revoke delete, truncate, trigger, references on public.backcharges from authenticated;
grant select, insert, update on public.backcharges to authenticated;

-- ── e. trigger ──────────────────────────────────────────────────────────────
-- Security INVOKER (no definer), search_path pinned.
create or replace function public.backcharges_guard()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    return new;
  end if;
  new.id         := old.id;
  new.user_id    := old.user_id;
  new.project_id := old.project_id;
  new.created_at := old.created_at;
  if old.status <> 'open' and new.status is distinct from old.status then
    raise exception 'backcharges: this backcharge is already %; its status cannot change', old.status
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

revoke execute on function public.backcharges_guard() from public, anon, authenticated;

drop trigger if exists backcharges_guard on public.backcharges;
create trigger backcharges_guard
  before update on public.backcharges
  for each row execute function public.backcharges_guard();

-- ── f. comments ─────────────────────────────────────────────────────────────
comment on table public.backcharges is
  'Backcharges against a sub (money the sub owes the GC). Written by hooks/useBackcharges.ts through utils/offlineQueue; owner/editor only (can_access_project editor); no delete policy (voided, never deleted); backcharges_guard pins id/user_id/project_id/created_at and keeps applied/void rows settled. See 20260928160000_backcharges.sql.';
