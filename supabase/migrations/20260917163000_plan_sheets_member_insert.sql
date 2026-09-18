-- 20260917163000_plan_sheets_member_insert.sql
--
-- Let a project EDITOR upload a plan-sheet image into that project's folder of
-- the `plan-sheets` bucket. INSERT only.
--
-- THE BUG IT CLOSES. A plan sheet added from a picture ("Import image" in
-- app/plans.tsx, and the punch walk's "add a floor plan" step) had no upload
-- path at all. The sheet was created with a device-local `file://` uri, and
-- ProjectContext correctly refuses to write a device-local uri to Postgres
-- (durablePlanSheetValue, audit DB-F11), so `plan_sheets.image_uri` landed as
-- ''. Only the phone that picked the image could ever show it, and only until
-- iOS purged the picker cache. Production on 2026-09-17: the founder's only
-- plan sheet (Watermark 9F, "IMG_1668") has an empty image_uri, so no plan can
-- be shown anywhere, which blocks pinning punch items to a plan.
--
-- The client now uploads the bytes FIRST (utils/planSheetImageUpload.ts) to
-- `plan-sheets/<projectId>/<imageId>.<jpg|png>` and only then creates the sheet
-- with that storage path. Until today only the service role
-- (convert-pdf-to-images) wrote to this bucket, and there is NO client INSERT
-- policy: the `CREATE POLICY IF NOT EXISTS` in add_pdf_render_buckets.sql is not
-- valid Postgres and never landed, 20260904100400 covers four other buckets,
-- 20260913230000 added SELECT only, and the held private-flip migration adds
-- SELECT and DELETE only. Without this policy every client upload is refused
-- with "new row violates row-level security policy", and the app says so
-- instead of creating an empty sheet.
--
-- THE MODEL is project_docs_insert (20260904100400) exactly: folder[1] is the
-- project id, checked through the TEXT overload of can_access_project, which
-- returns false for a non-uuid segment, so nothing can be planted under a
-- shared prefix such as the legacy `tmp/`. 'editor', not 'field': see the TIER
-- NOTE in 20260904100400 (a 'field' argument resolves through the helper's
-- `else true` arm in production).
--
-- NO UPDATE policy on purpose: the client uploads with upsert: false to a fresh
-- object name per attempt, so it never overwrites a drawing. NO DELETE policy
-- here either; that belongs to the held private-flip migration.
--
-- TO authenticated, not TO public: anon has no EXECUTE on can_access_project.
--
-- Independent of supabase/migrations/held/20260904101100_plan_sheets_private.sql
-- (the bucket stays public; this adds a write grant scoped by membership and
-- removes nothing). Idempotent. Reversible: drop the policy.

drop policy if exists plan_sheets_member_insert on storage.objects;
create policy plan_sheets_member_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'plan-sheets'
    and public.can_access_project((storage.foldername(name))[1], 'editor')
  );
