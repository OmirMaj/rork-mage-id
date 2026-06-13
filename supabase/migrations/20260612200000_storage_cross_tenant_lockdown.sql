-- SECURITY FIX (audit 2026-06-12). Three storage buckets only checked
-- bucket_id (not ownership), exposing cross-tenant documents. The other 7
-- buckets correctly scope by owner / folder; these three did not.
--
--   plan-sheets       (public bucket) had a `public`-role SELECT listing
--                     policy -> anyone with the anon key could ENUMERATE every
--                     user's floor plans. We drop the listing policy (object
--                     reads still work via the unguessable public URL; making
--                     the bucket fully private + signed URLs is a follow-up).
--   project-documents (was public + authenticated SELECT/UPDATE/DELETE with no
--                     owner check; currently empty/unused) -> made private and
--                     scoped to the uploader.
--   sub-documents     (authenticated ALL with no owner check) held W-9s / COIs
--                     (tax IDs + insurance PII) readable by ANY logged-in user.
--                     Scoped reads/writes to the uploader (owner).
--
-- Reads/updates/deletes are owner-only (owner = auth.uid()); inserts stay
-- permissive-to-authenticated so existing upload flows keep working (the W-9
-- path is "<subId>/...", not "<uid>/...", so we scope by `owner`, not folder).
-- Applied to production via MCP on 2026-06-12; this file is the record.

-- ── sub-documents ──────────────────────────────────────────────────────
drop policy if exists sub_documents_owner_all on storage.objects;
create policy sub_documents_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'sub-documents');
create policy sub_documents_select on storage.objects
  for select to authenticated using (bucket_id = 'sub-documents' and owner = auth.uid());
create policy sub_documents_update on storage.objects
  for update to authenticated
  using (bucket_id = 'sub-documents' and owner = auth.uid())
  with check (bucket_id = 'sub-documents' and owner = auth.uid());
create policy sub_documents_delete on storage.objects
  for delete to authenticated using (bucket_id = 'sub-documents' and owner = auth.uid());

-- ── project-documents ──────────────────────────────────────────────────
update storage.buckets set public = false where id = 'project-documents';
drop policy if exists project_docs_authenticated_insert on storage.objects;
drop policy if exists project_docs_authenticated_update on storage.objects;
drop policy if exists project_docs_authenticated_delete on storage.objects;
create policy project_docs_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'project-documents');
create policy project_docs_select on storage.objects
  for select to authenticated using (bucket_id = 'project-documents' and owner = auth.uid());
create policy project_docs_update on storage.objects
  for update to authenticated
  using (bucket_id = 'project-documents' and owner = auth.uid())
  with check (bucket_id = 'project-documents' and owner = auth.uid());
create policy project_docs_delete on storage.objects
  for delete to authenticated using (bucket_id = 'project-documents' and owner = auth.uid());

-- ── plan-sheets: kill bucket enumeration ───────────────────────────────
drop policy if exists plan_sheets_public_select on storage.objects;
