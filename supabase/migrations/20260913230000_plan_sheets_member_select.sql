-- 20260913230000_plan_sheets_member_select.sql
--
-- The membership SELECT policy for the `plan-sheets` bucket — and ONLY that.
--
-- WHY THIS EXISTS SEPARATELY FROM THE HELD MIGRATION.
-- `supabase/migrations/held/20260904101100_plan_sheets_private.sql` does three
-- things: it flips the bucket private, adds this SELECT policy plus an owner
-- DELETE policy, and then refuses to finish if any public/anon read survives.
-- Only the middle piece is safe to apply today, and the OTA of 2026-09-13
-- needs it.
--
-- THE BUG IT CLOSES. Commit 42aaf946 moved plan sheets to the durable-path
-- pattern: `plan_sheets.image_uri` now stores a bare storage key and the client
-- mints a short-lived signed URL at read time (utils/planSheetUrls.ts). But
-- signing is an authenticated operation checked against RLS, and production had
-- 33 policies on `storage.objects` with NOT ONE naming `plan-sheets` — verified
-- 2026-09-13. So `createSignedUrls` failed for every path, `resolvePlanSheetUrls`
-- (which never throws) omitted the entry, and the caller was left holding the
-- bare key. Handed to `<Image source={{uri}}>` that renders nothing: an imported
-- plan set showed once off the render response and was blank on every launch
-- after. This policy is what makes the signing succeed.
--
-- WHY NOT ALSO FLIP THE BUCKET PRIVATE, which is the actual security fix.
-- Because it would be a data regression on the same day. Rows written before
-- 42aaf946 still hold legacy PERMANENT PUBLIC URLs, and those render today only
-- because the bucket is public. Flipping it kills them, so old plan sheets would
-- go blank at exactly the moment new ones started working. The flip belongs with
-- a backfill that converts those legacy URLs to storage paths — which is why the
-- held migration stays held, and why its own guard block is not reproduced here:
-- that block asserts the bucket is private, which is deliberately still false.
--
-- SECURITY POSTURE, STATED PLAINLY: unchanged. The bucket is public before and
-- after. This migration only ADDS a read grant to `authenticated` scoped by
-- project membership; it removes nothing and widens nothing that public read
-- did not already allow. It is strictly a step toward the held migration, and
-- the held migration drops and recreates this same policy by name, so applying
-- it later is idempotent over this.
--
-- The one-argument call resolves: `can_access_project(pid text, min_role text
-- DEFAULT 'viewer')` — both overloads carry the default (verified in production
-- 2026-09-13), and `(storage.foldername(name))[1]` is text, so the text overload
-- is chosen without a cast.
--
-- Idempotent. Reversible: drop the policy.

drop policy if exists plan_sheets_member_select on storage.objects;
create policy plan_sheets_member_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'plan-sheets'
    and public.can_access_project((storage.foldername(name))[1])
  );
