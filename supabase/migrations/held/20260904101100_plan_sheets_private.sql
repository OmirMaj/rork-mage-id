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
-- ── STATUS 2026-09-12 — the client + server half is BUILT, NOT YET LIVE ─────
-- The code half of all three preconditions is written and guarded on branch
-- claude/audit-fixes-2026-09-07. Nothing has been deployed, and this file stays
-- in held/ until the items under REMAINING are done.
--
--   1. DONE. utils/planSheetUrls.ts is the plan-sheets sibling of
--      resolvePhotoUrls / resolveProjectFileUrls: batched createSignedUrls
--      (24h TTL, matching the photo TTL — a minted url is an UNREVOCABLE bearer
--      token and the earlier 7 days bought nothing, since the plan share link
--      it was justified by already dies with its 24h photo urls), path recovery
--      from a legacy URL, and it returns an unresolvable input UNCHANGED so the
--      release that ships BEFORE this migration still renders legacy public
--      URLs. contexts/ProjectContext.tsx signs every plan_sheets row at its
--      single hydration point through the EXTRACTED, guard-executed mapper
--      planSheetRowUris, so all ~15 existing readers of `sheet.imageUri` keep
--      working untouched; the DB write is durablePlanSheetValue (the PATH) and
--      the local cache write is localPlanSheetValue (the path, or a device-local
--      capture that has nothing else). app/plans.tsx no longer persists a
--      public URL from either of its two import paths.
--   2. DONE IN CODE, DATA STILL OUTSTANDING. app/takeoff.tsx and
--      app/drawing-analyzer.tsx pass the real project id; the "Standalone"
--      option is gone (a blocked upload card says why), and
--      utils/pdfRenderClient.uploadAndRenderPdf REFUSES a projectId whose first
--      segment is not a uuid, before it uploads anything. Note this was already
--      dead server-side: convert-pdf-to-images has answered projectId 'tmp'
--      with 403 "project not owned by caller" ever since its IDOR guard landed,
--      so nothing new has reached tmp/ for some time. The objects ALREADY there
--      are the outstanding half — see REMAINING (c).
--   3. DONE, AND GOING FURTHER. convert-pdf-to-images no longer calls
--      getPublicUrl at all; the legacy `publicUrl` field it still returns for
--      one release is minted by _shared/planSheetBytes.mintLegacyViewUrl, which
--      returns a 7-day SIGNED url and refuses any value carrying
--      '/object/public/'. (7 days there and 24h on the client is deliberate:
--      that field spans a deploy window an old build cannot re-mint, while the
--      client re-mints on every app open.) The four analyzers
--      (analyze-takeoff / analyze-drawings / analyze-spec-book /
--      compare-drawings) now prefer `pagePaths` and read the bytes themselves
--      with the service role through _shared/planSheetBytes.ts — which
--      re-checks project membership, because the service role bypasses RLS and
--      "download whatever path you are sent" would have been a worse hole than
--      the SSRF surface it replaced. They still accept `pageUrls` for ONE
--      release so an installed build keeps working until the OTA lands.
--
--   Guards: scripts/validate-plan-sheet-urls.ts (97 assertions, client half —
--           including SOURCE assertions pinning the ProjectContext hydration,
--           insert, update and both cache writes, which a 5,000-line .tsx would
--           otherwise leave untested)
--           scripts/validate-plan-sheet-privacy.ts (73 assertions, server half
--           + a repo-wide scan that fails if getPublicUrl comes back on this
--           bucket, if ANY file that touches the bucket builds an
--           '/object/public/' url by hand, or if a caller passes a literal
--           projectId prefix).
--           Both are wired into package.json and the ship-check chain.
--
-- ── WHAT THIS MIGRATION DOES NOT BUY, and must not be described as buying ───
-- Construction drawings remain permanently and unauthenticatedly readable
-- through a PARALLEL bucket this file does not touch: `rfp-attachments` is
-- public, utils/storage.ts:uploadRfpAttachment returns getPublicUrl(), and
-- app/post-rfp.tsx writes those URLs into public_bids.drawing_urls, which
-- `public_bids_select … TO authenticated USING (true)` lets ANY signed-in
-- account enumerate. Filed as DB-F11b in
-- docs/audits/2026-09-03-final-push-audit.md. After applying this, the true
-- statement is "drawings are private FROM THE plan-sheets BUCKET" — not
-- "drawings are private".
--
-- ── REMAINING before this file may be applied ───────────────────────────────
--   (a) ORDER. Deploy the five edge functions FIRST (convert-pdf-to-images,
--       analyze-takeoff, analyze-drawings, analyze-spec-book, compare-drawings),
--       then publish the OTA, then WAIT for it to actually reach devices, and
--       only then apply this migration. A device still on the old build resolves
--       its sheets as public URLs; flipping the bucket first blanks the takeoff
--       and plan-viewer screens for every one of them. The client is written to
--       survive either deploy order, but NOT to survive a private bucket before
--       the OTA.
--   (b) RUN THE POLICY ENUMERATION AGAINST PRODUCTION FIRST. The drops below
--       name four policies taken from a 2026-09-04 snapshot. This project has
--       documented out-of-band database objects that no migration declares (the
--       can_access_project(text) overload — 20260826130000_field_role.sql:101).
--       A dashboard-created policy granting SELECT on bucket_id='plan-sheets'
--       to public/anon would survive every drop and keep anonymous reads alive
--       with the bucket reading "private". The do-block now raises on that, but
--       look before you apply:
--         select policyname, roles, cmd, qual from pg_policies
--          where schemaname='storage' and tablename='objects'
--            and coalesce(qual,'') like '%plan-sheets%';
--   (c) THE tmp/ OBJECTS. The do-block below counts them and raises a NOTICE.
--       They are unreadable by any client once this runs, because
--       can_access_project('tmp') is false and no policy can admit them. They
--       belong to real users' takeoffs. Decide per object: re-render under the
--       right project id, copy to <projectId>/… and repoint the plan_sheets row,
--       or delete. Founder's call — this migration does not touch them.
--       Until then they are world-readable RIGHT NOW; the code half closes
--       nothing on its own.
--   (d) OPTIONAL, NOT BLOCKING. Legacy plan_sheets rows still hold full public
--       URLs. The read path recovers the PATH from them and re-signs, so a
--       project-scoped legacy row keeps working after the flip with no data
--       repair at all. The exception is a legacy row under tmp/: the client
--       deliberately does NOT publish a storagePath for one (planSheetRowUris
--       gates on a uuid folder), so compare-drawings keeps taking the URL
--       fallback for it instead of 403ing — and after the flip that URL dies
--       with the object, per (c).
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
declare v_public boolean; v_tmp bigint; v_open bigint; v_names text;
begin
  select public into v_public from storage.buckets where id = 'plan-sheets';
  if v_public then
    raise exception '[101100] plan-sheets is still public';
  end if;

  -- FLIPPING THE BUCKET IS NOT THE SAME AS CLOSING ANONYMOUS READ.
  -- The drops above name four policies, taken from a 2026-09-04 snapshot that
  -- said "no storage.objects policy mentions plan-sheets at all". This project
  -- has documented OUT-OF-BAND database objects that no migration declares
  -- (the can_access_project(text) overload — see 20260826130000_field_role.sql).
  -- A policy created by hand in the dashboard granting SELECT on
  -- bucket_id = 'plan-sheets' to role public/anon would survive every drop
  -- above, and the bucket would read "private" while anonymous reads kept
  -- working, with no error anywhere. So enumerate, and refuse to finish.
  select count(*), string_agg(policyname, ', ')
    into v_open, v_names
    from pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and cmd in ('SELECT', 'ALL')
     and coalesce(qual, '') like '%plan-sheets%'
     and (roles && array['public','anon']::name[]);
  if v_open > 0 then
    raise exception '[101100] % permissive plan-sheets SELECT polic(y/ies) still grant public/anon: % — drop them, then re-run', v_open, v_names;
  end if;

  select count(*) into v_tmp from storage.objects
   where bucket_id = 'plan-sheets' and (storage.foldername(name))[1] = 'tmp';
  if v_tmp > 0 then
    raise notice '[101100] % plan-sheet object(s) still live under tmp/ and are now unreadable by any client — re-render them under a project id', v_tmp;
  end if;
  raise notice '[101100] plan-sheets is private, with a membership SELECT policy and no public/anon read';
end
$mig$;
