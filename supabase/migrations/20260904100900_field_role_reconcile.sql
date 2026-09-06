-- ============================================================================
-- Field role — reconcile 20260826130000_field_role.sql with today's schema.
--
-- Audit ID: DB-F2 (the 'field' role does not exist in production although the
-- deploy record says its migration "IS applied").
--
-- ── RE-VERIFICATION OF THE 08-26 FILE AGAINST schema.sql (2026-09-04) ───────
-- The 08-26 file was checked before the 09-02 / 09-03 batches changed
-- policies. Compared line by line against the regenerated schema.sql:
--   • constraint name  project_collaborators_role_check       — present, live
--     definition is still owner|editor|viewer (pg_get_constraintdef);
--   • the 12 policy pairs it drops and recreates
--     (daily_reports, photos, punch_items, rfis, submittals, permits,
--     plan_sheets, time_entries, drawing_pins, plan_markups,
--     plan_calibrations, field_tickets) × (_collab_insert, _collab_update)
--     — all 24 exist under exactly those names and still read
--     can_access_project(project_id, 'editor');
--   • can_access_project(pid uuid, min_role text) — live body is the
--     pre-field version (`when 'editor' … else true`); the uuid overload is
--     LANGUAGE sql, the text overload LANGUAGE plpgsql and delegating, both
--     matching the file's CREATE OR REPLACE signatures;
--   • is_project_collaborator(pid uuid, min_role text) — same shape.
-- Verdict: the 08-26 file APPLIES CLEANLY AS WRITTEN. Nothing it touches has
-- moved. The three tables added on 09-03 (access_reservations,
-- building_access_rules, deliveries) already pass 'field' and need no change —
-- the branch the 08-26 file adds is what makes those six policies correct.
--
-- ── WHAT THIS FILE ADDS (the only deltas) ───────────────────────────────────
-- 1. A precondition: it REFUSES to run unless the 08-26 file has landed. Its
--    own policies pass 'field', and without the branch 'field' resolves
--    through `else true` — any accepted collaborator, viewers included —
--    which is the exact DB-F2 inversion.
-- 2. The storage tiers introduced by 20260904100400_storage_membership_
--    policies.sql. That file had to use 'editor' for photo INSERT and
--    document INSERT/UPDATE because 'field' did not exist yet. A foreman on
--    the field tier can then insert the photos ROW (photos_collab_insert →
--    'field') but not the photo BYTES, and can save a daily report but not
--    its PDF — half the role. This moves those three storage policies to
--    'field', matching photos_collab_insert / daily_reports_collab_*.
--    DELETE stays at 'editor' (photos) / project-owner-or-uploader.
--
-- Not done here: redeploying supabase/functions/project-invite (deployed v1
-- still rejects 'field') and correcting DEPLOY-VERIFIED-2026-09-02.md:107 —
-- both are owner-gated / doc steps outside a migration.
--
-- Idempotent.
-- ============================================================================

-- ── 1. Precondition: the branch and the role must already exist ─────────────
do $mig$
declare v_def text; v_check text;
begin
  v_def := pg_get_functiondef('public.can_access_project(uuid,text)'::regprocedure);
  if position('when ''field''' in v_def) = 0 then
    raise exception '[100900] can_access_project(uuid,text) has no ''field'' tier. Apply supabase/migrations/20260826130000_field_role.sql FIRST (DB-F2), then re-run this file. Applying this file alone would let every collaborator, viewers included, write field data.';
  end if;
  v_def := pg_get_functiondef('public.is_project_collaborator(uuid,text)'::regprocedure);
  if position('when ''field''' in v_def) = 0 then
    raise exception '[100900] is_project_collaborator(uuid,text) has no ''field'' tier — the 08-26 file is only half applied';
  end if;
  select pg_get_constraintdef(oid) into v_check
    from pg_constraint
   where conname = 'project_collaborators_role_check'
     and conrelid = 'public.project_collaborators'::regclass;
  if v_check is null or position('''field''' in v_check) = 0 then
    raise exception '[100900] project_collaborators_role_check does not accept ''field'' — apply 20260826130000_field_role.sql first';
  end if;
  raise notice '[100900] field tier present in both helpers and the CHECK — proceeding';
end
$mig$;

-- ── 2. Storage write tiers: editor → field ──────────────────────────────────
do $mig$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'project_photos_select') then
    raise notice '[100900] 20260904100400_storage_membership_policies.sql has not been applied — the INSERT/UPDATE policies below are created at the field tier, but SELECT/DELETE remain as they were. Apply 100400 as well.';
  end if;
end
$mig$;

drop policy if exists project_photos_upload on storage.objects;
create policy project_photos_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.can_access_project((storage.foldername(name))[2], 'field')
  );

drop policy if exists project_docs_insert on storage.objects;
create policy project_docs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-documents'
    and public.can_access_project((storage.foldername(name))[1], 'field')
  );

drop policy if exists project_docs_update on storage.objects;
create policy project_docs_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-documents'
    and public.can_access_project((storage.foldername(name))[1], 'field')
  )
  with check (
    bucket_id = 'project-documents'
    and public.can_access_project((storage.foldername(name))[1], 'field')
  );

-- ── Post-conditions ─────────────────────────────────────────────────────────
do $mig$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('project_photos_upload', 'project_docs_insert', 'project_docs_update')
     and coalesce(with_check, '') like '%''field''%';
  if n <> 3 then
    raise exception '[100900] expected 3 storage write policies on the field tier, found %', n;
  end if;
  raise notice '[100900] storage write tiers reconciled with the field role';
end
$mig$;
