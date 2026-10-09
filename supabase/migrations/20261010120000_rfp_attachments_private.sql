-- 20261010120000_rfp_attachments_private.sql — WHO MAY READ a homeowner's
-- posting photos and drawings (lane PROTECT-SERVER; build list item 11, audit
-- DB-F11b). Part 1 of 2: the read rule and its SELECT policy. This file does
-- NOT flip the bucket. Part 2, 20261010140000_rfp_attachments_flip.sql, holds
-- only `public = false`, behind the founder opt-in line.
--
-- NO GATE ON THIS FILE. A SELECT policy on a bucket that is still public adds
--   no exposure (a public bucket already serves every object to anyone) and
--   takes nothing away. What it adds is that the Storage signing call starts
--   to work for the people the rule admits, so the app can sign links BEFORE
--   the bucket is flipped. Apply it together with 20261010100000,
--   20261010110000 and 20261010130000.
--
-- WHY. A homeowner who posts a project uploads photos of the inside of the
--   house and, often, the drawings. They go to the `rfp-attachments` bucket,
--   which is PUBLIC (production 2026-10-09: public = true, 9 objects; insert,
--   update and delete policies by owner folder, and no select policy because a
--   public bucket needs none). The app stores each file's permanent public URL
--   in public_bids.photo_urls / drawing_urls. public_bids_select is `TO
--   authenticated USING (true)`, so any signed-in account, including one made a
--   minute ago, can list every posting's URLs through the API whether or not a
--   screen shows them (RFP_BROWSE_ENABLED = false hides one screen, not the
--   table). And each URL opens for anyone on the internet, signed in or not,
--   for as long as the object exists: no expiry, and closing the posting does
--   not turn it off.
--
-- THE RULE: public.can_read_rfp_attachment(object name). For a signed-in
--   account only, and for a name shaped <owner id>/<posting id>/<file>, it
--   admits exactly:
--     - the person whose folder it is;
--     - while the posting that folder belongs to is OPEN (status = 'open' and
--       no award recorded): any signed-in account. "Contractor" here means ANY
--       signed-in account, because sign-up is self-serve and nothing verifies
--       a trade. This is the marketplace's own rule, not a new one: an open
--       posting is shown to every signed-in account by public_bids_select.
--     - once the posting is NOT open (closed, awarded, or any other status):
--       only the awarded bidder, meaning the account that owns the response
--       the posting names in awarded_response_id, and only while that response
--       still reads 'awarded' and was created no later than the award.
--   Nobody else: not anon; not a signed-in account once the posting is closed
--   or deleted; not a folder with no posting row; not a bidder who was
--   declined, who withdrew, or who was never awarded.
--   A BID ROW BY ITSELF OPENS NOTHING. The first draft of this rule admitted
--   anyone with a bid_responses row on the posting. bid_responses_own is FOR
--   ALL with USING (auth.uid() = user_id), so any signed-in account can insert
--   a bid on any posting id, closed ones included; one inserted row would have
--   opened a closed posting's files. Only an award does now, and an award is
--   written by award_rfp alone (the posting's owner, through a definer;
--   bid_responses_guard refuses 'awarded' from a client and
--   public_bids_keep_award keeps the award columns server-owned).
--   20261010130000_bid_responses_closed_posting.sql separately stops a new bid
--   on a posting that is not open from counting as a bid at all.
--   The function is SECURITY DEFINER with an empty search_path, so it reads
--   public_bids and bid_responses whatever column grants those tables have
--   (the held column revoke on public_bids does not affect it), and it answers
--   a yes or no about one object name, nothing else.
--
-- THE POLICY: rfp_attachments_read, FOR SELECT TO authenticated, the bucket
--   filter and the rule. The insert / update / delete policies (owner folder)
--   are left as they are.
--
-- THE APP SIDE. utils/rfpAttachmentUrls.ts turns every stored value (the
--   legacy public URL, or a bare path) into a path and asks Storage for a
--   signed link good for one hour. Every screen that shows a posting photo or
--   opens a drawing uses it (scripts/validate-rfp-attachments-private.ts scans
--   for readers). Until part 2 is applied, a new upload still STORES the
--   legacy public URL (utils/rfpAttachmentPath.ts RFP_ATTACHMENT_STORED_FORM),
--   because that is the one value a phone on an old build can render.
--   The path rule is supabase/functions/_shared/storagePath.ts
--   RFP_ATTACHMENT_PATH (<uuid>/<uuid>/<digits>_<name>), mirrored in the client
--   module and pinned equal by the validator.
--
-- DEPLOY ORDER, and what each build sees at each step.
--   Step 0, today. Bucket public, no read policy. Every build renders the
--     stored public URL.
--   Step 1, either order: this file is applied; the app update is published.
--     - This file applied, app update not yet on a phone (an OLD build):
--       nothing changes for it. It renders the stored public URL, which still
--       opens because the bucket is still public.
--     - App update on a phone, this file not applied yet (a NEW build): the
--       signing call is refused (no read policy), and the resolver falls back
--       to the stored public URL, which still opens. Photos show.
--     - Both: a NEW build shows signed one-hour links for everyone the rule
--       admits. An OLD build still renders the public URL. New postings made
--       by a NEW build store the public URL, so an OLD build renders those
--       too, and an award in this window copies public URLs into the winner's
--       project and the award email exactly as it does today.
--   Step 2, part 2 (20261010140000), ONLY after its preconditions. The bucket
--     goes private.
--     - NEW build: no change for the owner, for any signed-in account on an
--       open posting, and for the awarded bidder. Everyone else gets the
--       "Could Not Open" state and a blank photo.
--     - OLD build: every posting photo renders blank and a tapped photo or
--       drawing opens a browser page saying the object was not found. Posting
--       still works. Nothing is lost; the phone is fixed when it updates.
--   Step 3, a later app update, after part 2: RFP_ATTACHMENT_STORED_FORM
--     becomes 'path', so new rows stop carrying a URL at all. Both stored
--     forms keep resolving on every new build, before and after.
--
-- WHAT STAYS EXPOSED AFTER BOTH PARTS (told plainly; see also
--   docs/legal/privacy-policy-versus-code.md, "Posting photos and drawings").
--   - Any signed-in account can still LIST every posting row (title, scope,
--     city, and the stored file values) through public_bids_select, and can
--     still READ THE FILES OF EVERY OPEN POSTING. Sign-up is self-serve, so
--     "signed-in account" is anyone with an email address. The flip removes
--     the anonymous, permanent link; it does not make an open posting private.
--   - A caller of the Storage API chooses the lifetime of the link it signs.
--     The app asks for one hour; someone calling the API directly with their
--     own session can ask for years, for any object the rule admits them to at
--     that moment, and that link outlives the posting's close.
--   - A link signed before a posting closed works until it expires.
--   - plan-sheets is still a public bucket. Its own gated file,
--     20260923181000_plan_sheets_private.sql, was never applied.
--   - The street address and email are behind get_rfp_private only once the
--     held column revoke is applied.
--   PROPOSED NEXT TIGHTENING (not built): either narrow public_bids_select so
--   a posting row is visible only to its owner, its bidders and accounts in
--   the posting's area that hold a verified contractor profile; or keep the
--   rows visible and hide the FILES until a contractor is verified (the read
--   rule gains "and the caller has a verified profile" on the open branch).
--   And to take the lifetime choice away, serve files through an edge function
--   that signs for a fixed short time and drop the client SELECT policy.
--
-- WHAT A COLLABORATOR SEES, and the award email. award_rfp copies the
--   posting's stored values into the winner's project (photos.uri, and links
--   inside the project description) and hands the first photo to the award-rfp
--   edge function as heroPhotoUrl. The app's photo loader signs those for the
--   WINNER. A collaborator on the winner's project is not admitted by the rule
--   and sees those photos blank after part 2, and the links in the description
--   and the email are dead for everyone after part 2. The real fix is for
--   award-rfp to copy the files into the winner's own project-photos folder
--   and to drop the hero link; it is a precondition of part 2.
--
-- VERIFY AFTER
--   select policyname, cmd, roles from pg_policies where schemaname = 'storage' and tablename = 'objects'
--     and (coalesce(qual, '') || coalesce(with_check, '')) like '%rfp-attachments%' order by 1;     -- 4 rows: owner delete / insert / update + rfp_attachments_read (SELECT, {authenticated})
--   select has_function_privilege('anon', 'public.can_read_rfp_attachment(text)', 'execute');      -- false
--   select prosecdef, proconfig from pg_proc where proname = 'can_read_rfp_attachment';            -- true, {search_path=""}
--   select public from storage.buckets where id = 'rfp-attachments';                               -- still true: this file does not flip it
--
-- UNDO
--   drop policy if exists rfp_attachments_read on storage.objects;
--   drop function if exists public.can_read_rfp_attachment(text);
--   (With the bucket still public this only stops the signing call; the app
--   falls back to the stored public URL.)
--
-- PROOF. scripts/pgq/rfp-attachments-private.mjs (both parts, in order).
--
-- Idempotent.

-- ── 1. who may read one object ───────────────────────────────────────────────
create or replace function public.can_read_rfp_attachment(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_parts text[];
  v_owner text;
  v_bid text;
begin
  if v_uid is null or p_name is null then
    return false;
  end if;
  -- <owner uuid>/<posting uuid>/<file>: exactly three segments, the first two
  -- uuids. Anything else is nobody's.
  v_parts := pg_catalog.string_to_array(p_name, '/');
  if pg_catalog.array_length(v_parts, 1) is distinct from 3 then
    return false;
  end if;
  v_owner := v_parts[1];
  v_bid := v_parts[2];
  if v_owner !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     or v_bid !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     or v_parts[3] = '' then
    return false;
  end if;
  -- The person whose folder it is (a draft upload has no posting row yet).
  if pg_catalog.lower(v_owner) = v_uid::text then
    return true;
  end if;
  -- Someone else: only through the posting this folder belongs to. The posting
  -- must be that owner's (a folder named after another person's posting id
  -- opens nothing).
  --   OPEN (status 'open', no award recorded): any signed-in account.
  --   NOT OPEN: only the account that owns the awarded response, while that
  --   response still reads 'awarded' and was created no later than the award.
  --   A bid row by itself opens nothing (anyone can insert one).
  return exists (
    select 1
      from public.public_bids b
     where b.id = v_bid::uuid
       and b.user_id = v_owner::uuid
       and (
         (b.status = 'open' and b.awarded_response_id is null)
         or exists (
           select 1
             from public.bid_responses r
            where r.id = b.awarded_response_id
              and r.bid_id = b.id
              and r.user_id = v_uid
              and r.status = 'awarded'
              and (r.created_at is null or b.awarded_at is null or r.created_at <= b.awarded_at)
         )
       )
  );
end
$function$;

revoke all on function public.can_read_rfp_attachment(text) from public, anon;
grant execute on function public.can_read_rfp_attachment(text) to authenticated, service_role;

-- ── 2. the read policy (the flip is part 2) ────────────────────────────────────────
drop policy if exists rfp_attachments_read on storage.objects;
create policy rfp_attachments_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'rfp-attachments'
    -- `objects.name` qualified on purpose.
    and public.can_read_rfp_attachment(objects.name)
  );

-- ── self-check ───────────────────────────────────────────────────────────────
do $mig$
declare
  v_public boolean;
  v_open bigint;
  v_names text;
  v_def boolean;
  v_cfg text[];
begin
  select public into v_public from storage.buckets where id = 'rfp-attachments';
  if v_public is null then
    raise exception '[rfp_attachments_private] verify: the rfp-attachments bucket does not exist';
  end if;
  -- A read policy made by hand in the dashboard that grants SELECT on this
  -- bucket to public or anon would keep it open once part 2 flips the bucket.
  select count(*), string_agg(policyname, ', ') into v_open, v_names
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('SELECT', 'ALL')
     and coalesce(qual, '') like '%rfp-attachments%'
     and (roles && array['public', 'anon']::name[]);
  if v_open > 0 then
    raise exception '[rfp_attachments_private] verify: % polic(y/ies) still let public or anon read rfp-attachments: %. Drop them, then re-run', v_open, v_names;
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'ALL')
         and coalesce(qual, '') like '%rfp-attachments%') <> 1 then
    raise exception '[rfp_attachments_private] verify: exactly one read policy must name rfp-attachments (rfp_attachments_read)';
  end if;
  select p.prosecdef, p.proconfig into v_def, v_cfg from pg_proc p
   where p.oid = 'public.can_read_rfp_attachment(text)'::regprocedure;
  if v_def is not true or v_cfg is null or not ('search_path=""' = any (v_cfg)) then
    raise exception '[rfp_attachments_private] verify: can_read_rfp_attachment must be SECURITY DEFINER with an empty search_path';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_function_privilege('anon', 'public.can_read_rfp_attachment(text)', 'execute') then
    raise exception '[rfp_attachments_private] verify: anon can call can_read_rfp_attachment';
  end if;
  raise notice '[rfp_attachments_private] one read policy on rfp-attachments, signed-in accounts only; the bucket is %', case when v_public then 'still public (part 2 flips it)' else 'private' end;
end
$mig$;
