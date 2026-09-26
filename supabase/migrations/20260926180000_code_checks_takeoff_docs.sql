-- 20260926180000_code_checks_takeoff_docs.sql
--
-- Cloud sync for two things that lived only on one device until now:
--   * public.code_checks  — the saved code checks per job (utils/codeThread),
--                           one row per saved check, the whole record as jsonb;
--   * public.takeoff_docs — the desktop takeoff's conditions + measurements,
--                           ONE doc per job (id = project_id::text).
--
-- The client writes both through utils/offlineQueue (supabaseWriteDetailed
-- upserts) and merges the account copy with the device copy on read
-- (utils/codeThread/syncMerge.ts, utils/takeoff/takeoffDocMerge.ts).
--
-- DEPLOY ORDER: apply this BEFORE the OTA that writes these tables. A client
-- upsert into a missing table is a terminal PostgREST refusal (42P01 /
-- PGRST205): the offline queue drops it and the "Not saved" ledger fills up.
--
-- Idempotent: every create is `if not exists` / `or replace`, every policy and
-- trigger is dropped first. Running it twice is a no-op.

-- ── a. preconditions ────────────────────────────────────────────────────────
do $pre$
declare
  v_src text;
begin
  if to_regprocedure('public.can_access_project(uuid,text)') is null then
    raise exception 'code_checks/takeoff_docs: public.can_access_project(uuid,text) is missing. Apply 20260826130000_field_role.sql first.';
  end if;
  select p.prosrc into v_src
    from pg_proc p
   where p.oid = to_regprocedure('public.can_access_project(uuid,text)');
  if v_src is null or position('when ''field''' in v_src) = 0 then
    raise exception 'code_checks/takeoff_docs: public.can_access_project(uuid,text) has no field tier. Apply 20260826130000_field_role.sql first.';
  end if;
  if to_regprocedure('public.collab_freeze_ownership()') is null then
    raise exception 'code_checks/takeoff_docs: public.collab_freeze_ownership() is missing. Apply 20260923170000_rls_hardening.sql first.';
  end if;
end
$pre$;

-- ── b. tables ───────────────────────────────────────────────────────────────
create table if not exists public.code_checks (
  id text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  -- user_id cascades on the author's auth delete. That is safe ONLY together
  -- with supabase/functions/delete-account step 2-0 (COLLABORATOR_FIELD_TABLES
  -- lists code_checks), which hands a departing collaborator's rows on another
  -- owner's job to that owner BEFORE the auth delete runs.
  user_id uuid not null references auth.users(id) on delete cascade,
  record jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(id) between 1 and 128),
  check (jsonb_typeof(record) = 'object'),
  check (octet_length(record::text) <= 262144)
);

create index if not exists code_checks_project_updated_idx
  on public.code_checks (project_id, updated_at desc);

create table if not exists public.takeoff_docs (
  id text primary key,  -- = project_id::text, one doc per job
  project_id uuid not null unique references public.projects(id) on delete cascade,
  -- user_id cascades on the author's auth delete. That is safe ONLY together
  -- with supabase/functions/delete-account step 2-0 (COLLABORATOR_FIELD_TABLES
  -- lists takeoff_docs): one row holds the WHOLE job's takeoff, so an editor
  -- who pushed it first and then deleted his account would otherwise take the
  -- owner's takeoff with him.
  user_id uuid not null references auth.users(id) on delete cascade,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (id = project_id::text),
  check (jsonb_typeof(doc) = 'object'),
  check (octet_length(doc::text) <= 2097152)
);

-- ── c. RLS (the 20260803140000 field-table shape) ───────────────────────────
alter table public.code_checks enable row level security;
alter table public.takeoff_docs enable row level security;

-- code_checks: 'field' tier, mirroring punch_items_collab_insert/_update
-- (20260826130000 §3). A foreman may save a code check on a job he works.
drop policy if exists code_checks_collab_select on public.code_checks;
create policy code_checks_collab_select on public.code_checks
  for select to authenticated
  using (
    auth.uid() = user_id
    or public.can_access_project(project_id)
  );

drop policy if exists code_checks_collab_insert on public.code_checks;
create policy code_checks_collab_insert on public.code_checks
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and public.can_access_project(project_id, 'field')
  );

drop policy if exists code_checks_collab_update on public.code_checks;
create policy code_checks_collab_update on public.code_checks
  for update to authenticated
  using      (public.can_access_project(project_id, 'field'))
  with check (public.can_access_project(project_id, 'field'));

drop policy if exists code_checks_collab_delete on public.code_checks;
create policy code_checks_collab_delete on public.code_checks
  for delete to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
  );

-- takeoff_docs: 'editor' tier. The takeoff prices the estimate; a field or
-- viewer seat keeps its edits on its own browser (the client seat gate in
-- utils/takeoffCloudSync.ts uses exactly this tier).
drop policy if exists takeoff_docs_collab_select on public.takeoff_docs;
create policy takeoff_docs_collab_select on public.takeoff_docs
  for select to authenticated
  using (
    auth.uid() = user_id
    or public.can_access_project(project_id)
  );

drop policy if exists takeoff_docs_collab_insert on public.takeoff_docs;
create policy takeoff_docs_collab_insert on public.takeoff_docs
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and public.can_access_project(project_id, 'editor')
  );

drop policy if exists takeoff_docs_collab_update on public.takeoff_docs;
create policy takeoff_docs_collab_update on public.takeoff_docs
  for update to authenticated
  using      (public.can_access_project(project_id, 'editor'))
  with check (public.can_access_project(project_id, 'editor'));

drop policy if exists takeoff_docs_collab_delete on public.takeoff_docs;
create policy takeoff_docs_collab_delete on public.takeoff_docs
  for delete to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
  );

-- ── d. grants ───────────────────────────────────────────────────────────────
revoke all on public.code_checks, public.takeoff_docs from anon, public;
grant select, insert, update, delete on public.code_checks, public.takeoff_docs to authenticated;

-- ── e. triggers ─────────────────────────────────────────────────────────────
-- Keep-newest: an update carrying an OLDER updated_at is a silent no-op (never
-- an error, so the offline queue does not park it). created_at never moves.
-- The client pushes a stamp that is monotonic over the last server stamp it
-- read (utils/syncSeat.ts nextPushStamp) and verifies the stamp after a push.
-- delete-account's handover changes only user_id with updated_at unchanged,
-- so it passes.
create or replace function public.sync_keep_newest()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.updated_at < old.updated_at then
    return null;
  end if;
  new.created_at := old.created_at;
  return new;
end;
$fn$;

-- aa_ sorts before ab_: ownership is frozen first, then the stamp decides.
drop trigger if exists aa_collab_freeze_ownership on public.code_checks;
create trigger aa_collab_freeze_ownership
  before update on public.code_checks
  for each row execute function public.collab_freeze_ownership();

drop trigger if exists aa_collab_freeze_ownership on public.takeoff_docs;
create trigger aa_collab_freeze_ownership
  before update on public.takeoff_docs
  for each row execute function public.collab_freeze_ownership();

drop trigger if exists ab_sync_keep_newest on public.code_checks;
create trigger ab_sync_keep_newest
  before update on public.code_checks
  for each row execute function public.sync_keep_newest();

drop trigger if exists ab_sync_keep_newest on public.takeoff_docs;
create trigger ab_sync_keep_newest
  before update on public.takeoff_docs
  for each row execute function public.sync_keep_newest();

-- ── f. comments ─────────────────────────────────────────────────────────────
comment on table public.code_checks is
  'Saved code checks, one row per check (record = the whole CodeCheckRecord). The client writes it through utils/offlineQueue and merges it with the device copy (utils/codeThread/syncMerge.ts). Sign-out erases only the device copy. delete-account hands a departing collaborator''s rows on another owner''s job to the project owner (COLLABORATOR_FIELD_TABLES).';

comment on table public.takeoff_docs is
  'The desktop takeoff (conditions + measurements), one doc per job (id = project_id::text). The client writes it through utils/offlineQueue and merges it with the device copy (utils/takeoff/takeoffDocMerge.ts). Sign-out erases only the device copy. delete-account hands a departing collaborator''s rows on another owner''s job to the project owner (COLLABORATOR_FIELD_TABLES).';

comment on function public.sync_keep_newest() is
  'BEFORE UPDATE (trigger ab_sync_keep_newest) on code_checks and takeoff_docs (20260926180000): an update with an older updated_at is silently ignored; created_at never moves.';
