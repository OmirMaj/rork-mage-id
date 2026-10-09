-- 20261010140000_rfp_attachments_flip.sql — the `rfp-attachments` bucket stops
-- being public (lane PROTECT-SERVER; audit DB-F11b). Part 2 of 2. Part 1,
-- 20261010120000_rfp_attachments_private.sql, is the read rule and its SELECT
-- policy and must already be applied; this file holds only the flip.
--
-- ██ DO NOT APPLY with the other files of this lane. This file refuses to run
-- ██ unless the same apply starts with
-- ██     set mageid.founder_ok_rfp_private = 'yes';
-- ██ so a catch-up apply of "every unapplied file" cannot flip the bucket.
--
-- PRECONDITIONS. All three, checked by a person, before the opt-in line is
-- typed. The file can check the second one only in part, and says so.
--   1. THE APP UPDATE HAS REACHED PHONES. The update that signs these links
--      (utils/rfpAttachmentUrls.ts) is published and installs still on an
--      older build are few enough to accept. After this file an old build
--      shows every posting photo blank and a tapped photo or drawing opens a
--      browser page saying the object was not found. Web gets the update at
--      once; a phone gets it the second time it is opened after the publish.
--   2. PRODUCTION'S storage.objects POLICIES HAVE BEEN READ, and none grants a
--      broad SELECT to authenticated (or public, or anon) without a bucket
--      filter. A policy such as `for select to authenticated using (true)`
--      would keep every object in this bucket readable by any signed-in
--      account with the bucket reading "private". Run, and read every row:
--        select policyname, cmd, roles, qual from pg_policies
--         where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'ALL');
--      This file refuses when it finds a SELECT or ALL policy whose condition
--      names no bucket at all (no `bucket_id` in it). It cannot judge a
--      condition that names a bucket loosely; that is why a person reads them.
--   3. THE AWARD PATH. Either the award-rfp edge function copies the posting's
--      files into the winner's own project-photos folder and no longer sends a
--      hero link, or it is re-confirmed on the day that there are zero awarded
--      postings:
--        select count(*) from public.public_bids where awarded_response_id is not null;   -- 0
--      (production 2026-10-09: 0). With awards and without the copy, a
--      collaborator on the winner's project sees the homeowner photos blank
--      and the links in the project description and the award email are dead.
--
-- WHAT CHANGES. storage.buckets `rfp-attachments` public = false. The permanent
--   public URLs stop working for everyone, signed in or not. Reading goes
--   through part 1's policy only.
--
-- WHAT EACH BUILD SEES AFTER THIS FILE.
--   A build with the app update: the owner, any signed-in account on an open
--     posting and the awarded bidder see photos and open drawings through
--     one-hour signed links, whichever form the row stores (the legacy public
--     URL or a bare path). Anyone else sees a blank photo and "Could Not Open".
--   A build without it: blank photos, dead links, on every posting. Posting a
--     new project still works. Nothing is lost and nothing crashes.
--   AFTER this file is applied, the next app update may change
--   utils/rfpAttachmentPath.ts RFP_ATTACHMENT_STORED_FORM to 'path'.
--
-- WHAT STAYS EXPOSED. Read part 1's header, WHAT STAYS EXPOSED AFTER BOTH
--   PARTS: any signed-in account still lists posting rows and reads the files
--   of OPEN postings, and a caller of the Storage API chooses its own link
--   lifetime.
--
-- VERIFY AFTER
--   select public from storage.buckets where id = 'rfp-attachments';                               -- false
--   -- with no sign-in, GET <project url>/storage/v1/object/public/rfp-attachments/<a live path>   -- 400 or 404, never 200
--
-- UNDO (puts the exposure back; only to recover from an early apply)
--   update storage.buckets set public = true where id = 'rfp-attachments';
--
-- PROOF. scripts/pgq/rfp-attachments-private.mjs (both parts, in order).
--
-- Idempotent.

-- ── self-guard ───────────────────────────────────────────────────────────────
do $g$
begin
  if coalesce(current_setting('mageid.founder_ok_rfp_private', true), '') <> 'yes' then
    raise exception 'held: rfp-attachments stays public until the three preconditions in this file''s header are met (the app update has reached phones; storage policies read; the award path)';
  end if;
end
$g$;

-- ── preconditions the database can see ───────────────────────────────────────
do $pre$
declare
  v_n bigint;
  v_names text;
begin
  -- Part 1 must be in place: flipping first would blank every photo for
  -- everyone, new builds included.
  if to_regprocedure('public.can_read_rfp_attachment(text)') is null
     or not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                     and policyname = 'rfp_attachments_read' and cmd = 'SELECT') then
    raise exception '[rfp_attachments_flip] part 1 (20261010120000_rfp_attachments_private.sql) is not applied: apply it first';
  end if;
  -- A read policy with no bucket filter reads this bucket too.
  select count(*), string_agg(policyname, ', ') into v_n, v_names
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('SELECT', 'ALL')
     and coalesce(qual, '') not like '%bucket_id%';
  if v_n > 0 then
    raise exception '[rfp_attachments_flip] % read polic(y/ies) on storage.objects name no bucket and would keep rfp-attachments readable: %. Narrow or drop them, then re-run', v_n, v_names;
  end if;
end
$pre$;

-- ── the flip ─────────────────────────────────────────────────────────────────
update storage.buckets set public = false where id = 'rfp-attachments' and public = true;

-- ── self-check ───────────────────────────────────────────────────────────────
do $mig$
declare
  v_public boolean;
  v_open bigint;
  v_names text;
begin
  select public into v_public from storage.buckets where id = 'rfp-attachments';
  if v_public is null then
    raise exception '[rfp_attachments_flip] verify: the rfp-attachments bucket does not exist';
  end if;
  if v_public then
    raise exception '[rfp_attachments_flip] verify: rfp-attachments is still public';
  end if;
  -- Flipping the bucket is not the same as closing anonymous read.
  select count(*), string_agg(policyname, ', ') into v_open, v_names
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('SELECT', 'ALL')
     and coalesce(qual, '') like '%rfp-attachments%'
     and (roles && array['public', 'anon']::name[]);
  if v_open > 0 then
    raise exception '[rfp_attachments_flip] verify: % polic(y/ies) still let public or anon read rfp-attachments: %. Drop them, then re-run', v_open, v_names;
  end if;
  raise notice '[rfp_attachments_flip] rfp-attachments is private; reading goes through rfp_attachments_read only';
end
$mig$;
