-- S1.2: seal-document v1 — signed contract PDF tamper-evidence.
-- Additive + idempotent. Reverse path documented in the commit message.
--
-- Adds a document_hash column on project_contracts (the signed_pdf_url
-- column already exists), creates a private secure-contracts Storage
-- bucket, and three owner-only RLS policies on storage.objects scoped to
-- that bucket via a path convention <user_id>/<contract_id>.pdf.
--
-- RLS form mirrors the live canonical pattern verified in pg_policies:
-- `to public` + an explicit `auth.role() = 'authenticated'` check inside
-- the predicate (matches branding_*, documents_* and the other sibling
-- bucket policies). No DELETE policy => effectively write-once for the
-- authenticated user; service role can still admin-side delete.

-- 1. document_hash column (nullable, additive).
alter table public.project_contracts
  add column if not exists document_hash text;

-- 2. Private bucket. owner-only access via RLS below.
insert into storage.buckets (id, name, public)
values ('secure-contracts', 'secure-contracts', false)
on conflict (id) do nothing;

-- 3. Owner-only RLS scoped to bucket_id='secure-contracts' and the first
-- path segment == auth.uid()::text. Mirrors the live branding_/documents_
-- canonical form (to public + auth.role()='authenticated' inside the predicate).
drop policy if exists secure_contracts_owner_select on storage.objects;
create policy secure_contracts_owner_select on storage.objects
  as permissive for select to public
  using (
    bucket_id = 'secure-contracts'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists secure_contracts_owner_insert on storage.objects;
create policy secure_contracts_owner_insert on storage.objects
  as permissive for insert to public
  with check (
    bucket_id = 'secure-contracts'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists secure_contracts_owner_update on storage.objects;
create policy secure_contracts_owner_update on storage.objects
  as permissive for update to public
  using (
    bucket_id = 'secure-contracts'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = (auth.uid())::text
  )
  with check (
    bucket_id = 'secure-contracts'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );
