-- ============================================================================
-- HELD — do not apply until the client resolves plan-sheet images through
-- signed URLs and writes under real project ids. See held/README.md.
--
-- plan-sheets: public bucket → private, membership SELECT.
--
-- Audit ID: DB-F11.
--
-- WHY. Construction drawings — the most sensitive document class in the
-- product — are served from a PUBLIC bucket by permanent, unsigned URLs:
--   • storage.buckets.plan-sheets public = true (live 2026-09-04)
--   • no storage.objects policy mentions plan-sheets at all (the policies in
--     add_pdf_render_buckets.sql used CREATE POLICY IF NOT EXISTS, which is
--     not Postgres syntax, so they never landed)
--   • supabase/functions/convert-pdf-to-images writes
--     plan-sheets/<projectId>/<id>-page-N.png with the service role and hands
--     back getPublicUrl(); the client persists that URL in
--     plan_sheets.image_uri (client-writable)
--   • app/takeoff.tsx passes projectId ?? 'tmp', and every one of the 7 live
--     objects sits under the shared tmp/ prefix
-- Anyone holding a URL can read the sheet forever: no expiry, no revocation
-- when the sheet is superseded or the project is deleted.
--
-- ── PRECONDITIONS (all three, or the takeoff screen goes blank) ─────────────
--   1. plan_sheets.image_uri is resolved at read time through
--      storage.from('plan-sheets').createSignedUrls(...) — the pattern
--      utils/storage.ts resolvePhotoUrls already implements for photos —
--      and the client persists the storage PATH, not the public URL.
--   2. app/takeoff.tsx passes the real project id; a membership policy on
--      folder[1] can never admit 'tmp' (can_access_project('tmp') → false),
--      so existing tmp/ objects become unreadable the moment the bucket is
--      private. Re-render or move them first.
--   3. convert-pdf-to-images returns storagePath (it already does) and the
--      client stops reading publicUrl.
--
-- Service-role writers (convert-pdf-to-images, delete-account) bypass RLS.
--
-- Idempotent.
-- ============================================================================

update storage.buckets set public = false where id = 'plan-sheets' and public = true;

-- Names from add_pdf_render_buckets.sql, in case that file is ever replayed
-- with corrected syntax.
drop policy if exists "plan-sheets public read" on storage.objects;
drop policy if exists "plan-sheets delete own" on storage.objects;

drop policy if exists plan_sheets_member_select on storage.objects;
create policy plan_sheets_member_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'plan-sheets'
    and public.can_access_project((storage.foldername(name))[1])
  );

drop policy if exists plan_sheets_owner_delete on storage.objects;
create policy plan_sheets_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'plan-sheets'
    and exists (
      -- `objects.name` qualified on purpose: a bare `name` here is projects.name.
      select 1 from public.projects p
       where p.id::text = (storage.foldername(objects.name))[1]
         and p.user_id = auth.uid()
    )
  );

do $mig$
declare v_public boolean; v_tmp bigint;
begin
  select public into v_public from storage.buckets where id = 'plan-sheets';
  if v_public then
    raise exception '[101100] plan-sheets is still public';
  end if;
  select count(*) into v_tmp from storage.objects
   where bucket_id = 'plan-sheets' and (storage.foldername(name))[1] = 'tmp';
  if v_tmp > 0 then
    raise notice '[101100] % plan-sheet object(s) still live under tmp/ and are now unreadable by any client — re-render them under a project id', v_tmp;
  end if;
  raise notice '[101100] plan-sheets is private with a membership SELECT policy';
end
$mig$;
