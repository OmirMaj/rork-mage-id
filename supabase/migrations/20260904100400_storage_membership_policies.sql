-- ============================================================================
-- Storage: project membership instead of "whoever uploaded it".
--
-- Audit IDs: DB-F5 (collaborator photos / files invisible to the GC) and the
-- 02-security-database.md appendix (bucket-only INSERT policies on
-- project-documents, sub-documents and worker-ids let any signed-in user plant
-- an object in any project's or sub's folder).
--
-- Live storage.objects policies read 2026-09-04:
--   project_photos_select / _upload / _delete   folder[1] = auth.uid()
--   project_docs_select / _update / _delete     owner = auth.uid()
--   project_docs_insert                         bucket_id only
--   sub_documents_insert, worker_ids_insert     bucket_id only
--
-- WHY. The app writes
--   project-photos/<uid>/<projectId>/<photoId>.jpg   (utils/photoUploadCore.ts
--                                                     buildPhotoStoragePath)
--   project-documents/<projectId>/<folder>/<file>    (utils/projectFiles.ts,
--                                                     utils/projectDocuments.ts
--                                                     daily-reports/<id>.pdf)
--   sub-documents/<subcontractorId>/w9-<ts>.<ext>    (app/(tabs)/subs/index.tsx)
--   worker-ids/<uid>/<crewMemberId>/<ts>.jpg         (utils/storage.ts)
--
-- With the uploader-bound SELECT, an editor's photo lands at
-- <editorUid>/<projectId>/… and the owner's createSignedUrls for that path
-- fails the policy; utils/storage.ts resolvePhotoUrls "never throws", so the
-- tile is silently blank. Project Files (owner = auth.uid()) never lists a
-- collaborator's upload at all. The rows are visible (photos_collab_select),
-- the bytes are not. Latent today (0 collaborators, 0 photo objects, 2
-- document objects both under a project-id folder), and it is the main path
-- of the collaboration feature.
--
-- THE MODEL. Every bucket whose path carries a project id is gated on
-- membership of THAT project, through the same helper the table policies use:
--   public.can_access_project(pid text, min_role text)  — the TEXT overload,
--   which casts safely (a non-uuid segment returns false) and delegates to the
--   uuid one, so the tiers can never disagree.
--
--   project-photos    SELECT  member of folder[2]                   (any role)
--                     INSERT  folder[1] = uploader AND editor of folder[2]
--                     DELETE  uploader's own folder OR the project OWNER —
--                             mirrors photos_collab_delete exactly, so a row
--                             delete and its object delete agree
--   project-documents SELECT  member of folder[1]                   (any role)
--                     INSERT / UPDATE / DELETE  editor of folder[1]
--                             (UPDATE is needed: daily-report PDFs are written
--                             with upsert: true)
--   sub-documents     INSERT  folder[1] must be a subcontractor the caller OWNS
--                             (subcontractors.user_id = auth.uid()); SELECT /
--                             UPDATE / DELETE stay owner = auth.uid() — the
--                             sub roster is company-private, not per project
--   worker-ids        INSERT  folder[1] = auth.uid()  (the only shape the app
--                             writes); SELECT / UPDATE / DELETE unchanged
--
-- TIER NOTE. INSERT / UPDATE use the 'editor' tier because the 'field' tier
-- does not exist in production yet (DB-F2): passing 'field' today resolves
-- through can_access_project's `else true` arm, i.e. ANY accepted collaborator
-- including a read-only viewer. 20260904100900_field_role_reconcile.sql moves
-- photos INSERT and documents INSERT/UPDATE to 'field' once the branch exists.
--
-- CLIENT CONTRACT (review 2026-09-05). project_photos_upload now requires the
-- projects ROW: can_access_project(folder[2], …) is false until the row
-- exists and is the caller's (or shared with them). The policy it replaces
-- (folder[1] = auth.uid()) needed nothing but the JWT. A photo taken on a
-- project created offline can therefore reach Storage BEFORE the project
-- upsert has flushed, and the upload is refused with a storage RLS 403
-- ("new row violates row-level security policy"). That refusal is TRANSIENT
-- while the project upsert is still queued: the photo upload queue must treat
-- it as retryable — re-attempt after the next offline-queue flush — not as a
-- terminal drop. The client half (utils/photoUploadQueue.ts, with the queue
-- in utils/offlineQueue.ts) is tracked separately from this file; the policy
-- is correct as written and does not change for it.
--
-- All new policies are TO authenticated (not TO public + auth.role() check):
-- anon has no EXECUTE on can_access_project, and SQL does not promise
-- short-circuit evaluation, so a TO public policy could raise 42501 for an
-- anonymous request instead of simply denying it.
--
-- Unchanged: branding, documents, pdf-uploads, profiles, rfp-attachments,
-- secure-contracts (all folder[1] = auth.uid() by design; no project segment).
-- plan-sheets has no policies and is PUBLIC; that is DB-F11 and lives in
-- migrations/held/20260904101100_plan_sheets_private.sql until the client
-- resolves image_uri through signed URLs.
--
-- Service-role writers (convert-pdf-to-images, seal-document, delete-account)
-- bypass RLS and are unaffected.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY throughout.
-- ============================================================================

-- ── project-photos ──────────────────────────────────────────────────────────
drop policy if exists project_photos_select on storage.objects;
create policy project_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-photos'
    and public.can_access_project((storage.foldername(name))[2])
  );

drop policy if exists project_photos_upload on storage.objects;
create policy project_photos_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.can_access_project((storage.foldername(name))[2], 'editor')
  );

drop policy if exists project_photos_delete on storage.objects;
create policy project_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      -- `objects.name`, QUALIFIED: inside this subquery a bare `name`
      -- resolves to projects.name ('Kitchen remodel'), not the object path,
      -- and the owner clause silently never matches. Caught by executing the
      -- file against a scratch Postgres loaded from schema.sql (2026-09-04).
      or exists (
        select 1 from public.projects p
         where p.id::text = (storage.foldername(objects.name))[2]
           and p.user_id = auth.uid()
      )
    )
  );

-- ── project-documents ───────────────────────────────────────────────────────
drop policy if exists project_docs_select on storage.objects;
create policy project_docs_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-documents'
    and public.can_access_project((storage.foldername(name))[1])
  );

drop policy if exists project_docs_insert on storage.objects;
create policy project_docs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-documents'
    and public.can_access_project((storage.foldername(name))[1], 'editor')
  );

drop policy if exists project_docs_update on storage.objects;
create policy project_docs_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-documents'
    and public.can_access_project((storage.foldername(name))[1], 'editor')
  )
  with check (
    bucket_id = 'project-documents'
    and public.can_access_project((storage.foldername(name))[1], 'editor')
  );

drop policy if exists project_docs_delete on storage.objects;
create policy project_docs_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-documents'
    and public.can_access_project((storage.foldername(name))[1], 'editor')
  );

-- ── sub-documents: INSERT bound to a subcontractor the caller owns ──────────
drop policy if exists sub_documents_insert on storage.objects;
create policy sub_documents_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sub-documents'
    and exists (
      select 1 from public.subcontractors s
       where s.id::text = (storage.foldername(objects.name))[1]
         and s.user_id = auth.uid()
    )
  );

-- ── worker-ids: INSERT bound to the uploader's own folder ───────────────────
drop policy if exists worker_ids_insert on storage.objects;
create policy worker_ids_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'worker-ids'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Post-conditions ─────────────────────────────────────────────────────────
do $mig$
declare
  p record;
  expected text[][] := array[
    ['project_photos_select', 'SELECT'],
    ['project_photos_upload', 'INSERT'],
    ['project_photos_delete', 'DELETE'],
    ['project_docs_select',   'SELECT'],
    ['project_docs_insert',   'INSERT'],
    ['project_docs_update',   'UPDATE'],
    ['project_docs_delete',   'DELETE'],
    ['sub_documents_insert',  'INSERT'],
    ['worker_ids_insert',     'INSERT']
  ];
  i int;
  body text;
begin
  for i in 1 .. array_length(expected, 1) loop
    select policyname, cmd, coalesce(qual, '') || coalesce(with_check, '') as expr
      into p
      from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = expected[i][1];
    if p.policyname is null or p.cmd <> expected[i][2] then
      raise exception '[100400] storage policy % (%) is missing or has the wrong command', expected[i][1], expected[i][2];
    end if;
    body := p.expr;
    if expected[i][1] like 'project_%' and expected[i][1] <> 'project_photos_delete'
       and position('can_access_project' in body) = 0 then
      raise exception '[100400] storage policy % is not membership-based', expected[i][1];
    end if;
  end loop;
  -- The bucket-only INSERT shape must be gone from every bucket the app writes.
  if exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and cmd = 'INSERT'
       and with_check ~ '^\(bucket_id = ''[a-z-]+''::text\)$'
  ) then
    raise exception '[100400] a bucket-only INSERT policy remains on storage.objects';
  end if;
  raise notice '[100400] storage membership policies in place';
end
$mig$;
