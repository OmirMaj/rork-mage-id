-- 20261009120000_rfp_attachments_private.sql — homeowner photos and drawings
-- stop being public (lane PROTECT-SERVER; build list item 11, audit DB-F11b).
--
-- ██ DO NOT APPLY until the app update that signs these links has REACHED
-- ██ phones (see DEPLOY ORDER). Applied early, every installed build shows
-- ██ blank photos and dead drawing links on every posting. This file refuses to
-- ██ run unless the same apply starts with
-- ██     set mageid.founder_ok_rfp_private = 'yes';
-- ██ so a catch-up apply of "every unapplied file" cannot flip the bucket.
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
-- WHAT CHANGES.
--   1. storage.buckets `rfp-attachments` public = false. The permanent public
--      URLs stop working for everyone.
--   2. One SELECT policy on storage.objects for the bucket, for signed-in
--      accounts only, admitting exactly:
--        - the person whose folder it is (<their id>/<posting id>/<file>);
--        - a contractor, while the posting that folder belongs to is OPEN
--          (the marketplace's own rule: an open posting is shown to signed-in
--          contractors, public_bids_select);
--        - a contractor who has a bid on that posting, at any status of the
--          posting (so the winner keeps the photos after award closes it, and
--          a bidder can still open what he priced).
--      Nobody else: not anon, not a signed-in account once the posting is
--      closed or deleted, not for a folder with no posting row.
--      The rule lives in public.can_read_rfp_attachment(object name): SECURITY
--      DEFINER with an empty search_path, so it reads public_bids and
--      bid_responses whatever column grants those tables have (the held column
--      revoke on public_bids does not affect it), and it answers a yes or no
--      about one object name, nothing else.
--   3. The insert / update / delete policies (owner folder) are left as they are.
--
-- THE APP SIDE (ships first, over the air). utils/rfpAttachmentUrls.ts turns
--   every stored value (a legacy public URL, or a bare path) into a path and
--   asks Storage for a signed link good for one hour; app/rfp-detail.tsx,
--   app/my-rfps.tsx, app/nearby-rfps.tsx and the project photo loader show
--   only that. While the bucket is still public and has no select policy, the
--   signing call is refused and the resolver hands back the stored URL, which
--   still works: so the update is correct BEFORE this file is applied and after.
--   The path rule is supabase/functions/_shared/storagePath.ts
--   RFP_ATTACHMENT_PATH (<uuid>/<uuid>/<digits>_<name>), mirrored in the client
--   module and pinned equal by scripts/validate-rfp-attachments-private.ts.
--
-- DEPLOY ORDER.
--   1. Publish the app update (OTA) that carries utils/rfpAttachmentUrls.ts.
--   2. WAIT until it has reached phones (the same wait the plan-sheets flip
--      needs). Web gets it at once.
--   3. Apply this file by hand through the Supabase MCP apply_migration with
--      `set mageid.founder_ok_rfp_private = 'yes';` as the first line. Never
--      `supabase db push`.
--   WHAT BREAKS FOR A PHONE STILL ON AN OLD BUILD after step 3: every posting's
--   photos render blank (My Projects Posted, Nearby, the posting page), and
--   tapping a photo or a drawing opens a browser page that says the object was
--   not found. Posting a new project still works (uploads go through the owner
--   insert policy); its photos are blank on that phone too. Nothing is lost and
--   nothing crashes; the phone is fixed the moment it takes the update.
--   WHAT STAYS BROKEN EVEN ON A NEW BUILD, and is a follow-up: award_rfp copies
--   the posting's URLs into the winner's project (photos.uri, and links inside
--   the project description). The app's photo loader signs those for the
--   WINNER (he has a bid on the posting). A collaborator on the winner's
--   project is not admitted by the policy and sees those homeowner photos
--   blank, and the links in the description text are dead for everyone. The
--   real fix is for award-rfp to copy the files into the winner's own
--   project-photos folder; that is a server change of its own.
--
-- WHAT THIS DOES NOT CLOSE.
--   - A link that was signed before a posting closed works until it expires
--     (one hour).
--   - plan-sheets is still a public bucket. Its own gated file,
--     20260923181000_plan_sheets_private.sql, was never applied (production
--     2026-10-09: not in the applied list; public = true; 11 objects, 7 under
--     tmp/). It needs founder decision #83 and those 7 objects deleted through
--     the Storage API first; it is not folded in here because its preconditions
--     are different.
--   - Any signed-in account can still read a posting's ROW (title, scope,
--     city). The street address and email are behind get_rfp_private once the
--     held column revoke is applied.
--
-- VERIFY AFTER
--   select public from storage.buckets where id = 'rfp-attachments';                               -- false
--   select policyname, cmd, roles from pg_policies where schemaname = 'storage' and tablename = 'objects'
--     and (coalesce(qual, '') || coalesce(with_check, '')) like '%rfp-attachments%' order by 1;     -- 4 rows: owner delete / insert / update + rfp_attachments_read (SELECT, {authenticated})
--   select has_function_privilege('anon', 'public.can_read_rfp_attachment(text)', 'execute');      -- false
--   -- with no sign-in, GET <project url>/storage/v1/object/public/rfp-attachments/<a live path>   -- 400 or 404, never 200
--
-- UNDO (puts the exposure back; only to recover from an early apply)
--   update storage.buckets set public = true where id = 'rfp-attachments';
--   drop policy if exists rfp_attachments_read on storage.objects;
--   drop function if exists public.can_read_rfp_attachment(text);
--
-- PROOF. scripts/pgq/rfp-attachments-private.mjs.
--
-- Idempotent.

-- ── self-guard ───────────────────────────────────────────────────────────────
do $g$
begin
  if coalesce(current_setting('mageid.founder_ok_rfp_private', true), '') <> 'yes' then
    raise exception 'held: rfp-attachments stays public until the app update that signs its links has reached phones (see this file''s header, DEPLOY ORDER)';
  end if;
end
$g$;

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
  -- opens nothing), and either open or one the caller has a bid on.
  return exists (
    select 1
      from public.public_bids b
     where b.id = v_bid::uuid
       and b.user_id = v_owner::uuid
       and (
         b.status = 'open'
         or exists (select 1 from public.bid_responses r where r.bid_id = b.id and r.user_id = v_uid)
       )
  );
end
$function$;

revoke all on function public.can_read_rfp_attachment(text) from public, anon;
grant execute on function public.can_read_rfp_attachment(text) to authenticated, service_role;

-- ── 2. the read policy, then the flip ────────────────────────────────────────
drop policy if exists rfp_attachments_read on storage.objects;
create policy rfp_attachments_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'rfp-attachments'
    -- `objects.name` qualified on purpose.
    and public.can_read_rfp_attachment(objects.name)
  );

update storage.buckets set public = false where id = 'rfp-attachments' and public = true;

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
  if v_public then
    raise exception '[rfp_attachments_private] verify: rfp-attachments is still public';
  end if;
  -- Flipping the bucket is not the same as closing anonymous read: a policy
  -- made by hand in the dashboard that grants SELECT on this bucket to public
  -- or anon would keep it open with the bucket reading "private".
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
  raise notice '[rfp_attachments_private] rfp-attachments is private; one read policy, signed-in accounts only';
end
$mig$;
