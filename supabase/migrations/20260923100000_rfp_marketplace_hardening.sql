-- 20260923100000_rfp_marketplace_hardening.sql
--
-- Wave 5, lane rfp-marketplace (findings #12, #13/#86). ADDITIVE: apply BEFORE
-- the OTA. The column revoke that finishes #86 is the separate file
-- held/20260923101000_public_bids_private_columns.sql, applied only AFTER the OTA
-- has reached devices (a pre-OTA client still reads public_bids with select('*'),
-- and Postgres refuses a whole query that names one revoked column). It is
-- parked under held/ so a bulk apply of this wave cannot land it early.
--
-- ── 1. #12 - a homeowner could rewrite a contractor's bid, then award it ─────
-- br_homeowner_update_status lets the RFP poster UPDATE any bid_responses row
-- on her RFP with no column limit and no WITH CHECK. With her own JWT she could
-- PATCH bid_amount from 48500 to 4850 and then award: award_rfp reads
-- bid_amount at award time, so the contractor's new project got target_budget
-- 4850 ("the price the homeowner accepted") and award-rfp emailed him that
-- figure as the contract value. bid_responses_own (ALL, auth.uid() = user_id)
-- separately let a contractor set his own row to 'awarded'.
--
-- Fix, in the database so no OTA is needed:
--   * bid_responses_guard (BEFORE INSERT OR UPDATE). It acts only for a
--     signed-in caller that is not the service role and not a definer running
--     as postgres - so award_rfp (SECURITY DEFINER, called by the award-rfp
--     edge function with the service key) and the dashboard stay free.
--       - the RFP poster (anyone but the row owner that RLS lets through) may
--         change only status / responded_at / updated_at, only to 'submitted',
--         'shortlisted' or 'declined', and never on a row already 'awarded' or
--         'withdrawn'. Everything else - bid_amount, user_id, bid_id,
--         company_name, awarded_project_id, the proposer's contact - is frozen.
--       - the contractor (row owner) may not change user_id, bid_id or
--         awarded_project_id, may change status only to withdraw his own live
--         bid, and may not change bid_amount once the homeowner has acted on
--         it (status <> 'submitted').
--       - an INSERT by a signed-in caller is pinned (silently, so an offline
--         replay never becomes a permanent failure) to status 'submitted' with
--         no award link and no responded_at.
--     An UPDATE tamper RAISES (42501): the caller must be told, and the app's
--     own writes never trip it (the review screen writes only status +
--     responded_at; the contractor app only inserts).
--   * award_rfp refuses a response whose status is not 'submitted' or
--     'shortlisted'. Rebuilt from the LIVE body (20260918120000, read back with
--     pg_get_functiondef on 2026-09-23 - identical); same signature, SECURITY
--     DEFINER, search_path 'public', grants (service_role only).
--   * public_bids_keep_award (BEFORE UPDATE): a signed-in caller cannot write
--     awarded_response_id / awarded_at, and once a post is awarded cannot move
--     its status off 'closed' - so an award cannot be reset and run twice.
--     Pinned silently (the owner's other edits still go through).
--   * REVOKE UPDATE ON bid_responses FROM anon.
--
-- ── 2. #13/#86 - homeowner street address, map pin and email were readable by
--       every signed-in account ─────────────────────────────────────────────
-- public_bids_select is `TO authenticated USING (true)` (and bids_select_all
-- duplicates it), so GET /rest/v1/public_bids?select=address_line,latitude,
-- longitude,contact_email returned every homeowner's address and email to a
-- throwaway signup. Production 2026-09-23: 4 rows, 3 homeowner RFPs, 0 awarded,
-- bid_responses empty.
--   * lat_coarse / lng_coarse: the post's coordinates rounded to 2 decimals
--     (about 1 km), filled by public_bids_coarse_location on every insert and
--     update and backfilled here. The nearby feed sorts on these.
--   * get_rfp_private(p_bid_id uuid) -> jsonb { address_line, latitude,
--     longitude, contact_email }: SECURITY DEFINER, returned only to the poster
--     or to the owner of the awarded response (CONTRACT 14). Anyone else gets
--     42501; an unknown id gets NULL.
--   * get_bid_contacts(p_bid_ids uuid[]) -> (id, posted_by, contact_email):
--     the Posted by / Email of a NON-homeowner post (an agency bid or a
--     contractor's own post, which exist to be contacted), plus the caller's own
--     posts. Once 101000 revokes posted_by / contact_email from the table, this
--     is how the bid feed keeps its Email button for those rows. A homeowner
--     RFP's contact is never returned to anyone but its poster.
--   * DROP POLICY bids_select_all - permissive policies OR together, so it had
--     to go before any narrower SELECT rule could mean anything.
-- The server readers (notify-nearby-contractors, award_rfp, award-rfp,
-- delete-account, notify) run as the service role or as a definer and keep
-- reading the exact columns.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS). Tested
-- twice in PGlite: scratchpad w5rfp_pg/w5_rfp_marketplace.mjs.
-- Reverse path:
--   drop trigger if exists bid_responses_guard on public.bid_responses;
--   drop function if exists public.bid_responses_guard();
--   drop trigger if exists public_bids_keep_award on public.public_bids;
--   drop function if exists public.public_bids_keep_award();
--   drop trigger if exists public_bids_coarse_location on public.public_bids;
--   drop function if exists public.public_bids_coarse_location();
--   drop function if exists public.get_rfp_private(uuid);
--   drop function if exists public.get_bid_contacts(uuid[]);
--   re-run 20260918120000 for award_rfp; grant update on public.bid_responses to anon;
--   create policy bids_select_all on public.public_bids for select using (auth.role() = 'authenticated');

-- ── 1a. bid_responses guard ──────────────────────────────────────────────────
create or replace function public.bid_responses_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_frozen text[] := array['status', 'responded_at', 'updated_at'];
begin
  -- The service role (edge functions), award_rfp (a definer owned by postgres)
  -- and migrations are the award path; only a signed-in client is policed.
  if v_uid is null
     or coalesce(auth.role(), '') = 'service_role'
     or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A new bid is always a plain submission. Pinned, not raised: the
    -- contractor app queues this insert offline and a raise would turn a
    -- replay into a permanent failure.
    new.status := 'submitted';
    new.awarded_project_id := null;
    new.responded_at := null;
    return new;
  end if;

  if v_uid is distinct from old.user_id then
    -- The RFP poster (RLS lets no one else through): a status decision only.
    if (to_jsonb(new) - v_frozen) is distinct from (to_jsonb(old) - v_frozen) then
      raise exception 'Only the bid''s status can be changed by the homeowner'
        using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      if coalesce(old.status, 'submitted') in ('awarded', 'withdrawn') then
        raise exception 'This bid is % and can''t be changed', old.status
          using errcode = '42501';
      end if;
      if new.status is null or new.status not in ('submitted', 'shortlisted', 'declined') then
        raise exception 'A bid can only be shortlisted, declined or restored here - awarding goes through the award'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  -- The contractor, on his own bid.
  if new.user_id is distinct from old.user_id
     or new.bid_id is distinct from old.bid_id
     or new.awarded_project_id is distinct from old.awarded_project_id then
    raise exception 'A bid''s owner, RFP and award link can''t be changed'
      using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not (new.status = 'withdrawn' and coalesce(old.status, 'submitted') in ('submitted', 'shortlisted')) then
    raise exception 'You can only withdraw your own bid - the homeowner decides the rest'
      using errcode = '42501';
  end if;
  if new.bid_amount is distinct from old.bid_amount
     and coalesce(old.status, 'submitted') <> 'submitted' then
    raise exception 'The price can''t change after the homeowner has acted on this bid'
      using errcode = '42501';
  end if;
  return new;
end
$$;

revoke execute on function public.bid_responses_guard() from public, anon, authenticated;

drop trigger if exists bid_responses_guard on public.bid_responses;
create trigger bid_responses_guard
  before insert or update on public.bid_responses
  for each row execute function public.bid_responses_guard();

revoke update on public.bid_responses from anon;

-- ── 1b. public_bids: the award columns are server-owned ─────────────────────
create or replace function public.public_bids_keep_award()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.awarded_response_id := null;
    new.awarded_at := null;
    return new;
  end if;
  new.awarded_response_id := old.awarded_response_id;
  new.awarded_at := old.awarded_at;
  if old.awarded_response_id is not null then
    new.status := old.status;
  end if;
  return new;
end
$$;

revoke execute on function public.public_bids_keep_award() from public, anon, authenticated;

drop trigger if exists public_bids_keep_award on public.public_bids;
create trigger public_bids_keep_award
  before insert or update on public.public_bids
  for each row execute function public.public_bids_keep_award();

-- ── 2a. coarse location ─────────────────────────────────────────────────────
alter table public.public_bids
  add column if not exists lat_coarse numeric,
  add column if not exists lng_coarse numeric;

comment on column public.public_bids.lat_coarse is
  'latitude rounded to 2 decimals (~1 km) - the only location other accounts may read. Server-filled (public_bids_coarse_location).';
comment on column public.public_bids.lng_coarse is
  'longitude rounded to 2 decimals (~1 km) - the only location other accounts may read. Server-filled (public_bids_coarse_location).';

create or replace function public.public_bids_coarse_location()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.lat_coarse := case when new.latitude is null then null else round(new.latitude::numeric, 2) end;
  new.lng_coarse := case when new.longitude is null then null else round(new.longitude::numeric, 2) end;
  return new;
end
$$;

revoke execute on function public.public_bids_coarse_location() from public, anon, authenticated;

drop trigger if exists public_bids_coarse_location on public.public_bids;
create trigger public_bids_coarse_location
  before insert or update on public.public_bids
  for each row execute function public.public_bids_coarse_location();

update public.public_bids
   set lat_coarse = round(latitude::numeric, 2),
       lng_coarse = round(longitude::numeric, 2)
 where (latitude is not null or longitude is not null)
   and (lat_coarse is distinct from round(latitude::numeric, 2)
        or lng_coarse is distinct from round(longitude::numeric, 2));

-- ── 2b. the private fields, to the two people entitled to them ──────────────
create or replace function public.get_rfp_private(p_bid_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_bid record;
begin
  if v_uid is null then
    raise exception 'Sign in to read this post' using errcode = '42501';
  end if;
  select b.id, b.user_id, b.address_line, b.latitude, b.longitude, b.contact_email, b.awarded_response_id
    into v_bid
    from public.public_bids b
   where b.id = p_bid_id;
  if not found then
    return null;
  end if;
  if v_bid.user_id is distinct from v_uid
     and not exists (
       select 1 from public.bid_responses r
        where r.id = v_bid.awarded_response_id
          and r.user_id = v_uid
     ) then
    raise exception 'Only the poster and the awarded contractor can see this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'address_line',  v_bid.address_line,
    'latitude',      v_bid.latitude,
    'longitude',     v_bid.longitude,
    'contact_email', v_bid.contact_email
  );
end
$$;

revoke execute on function public.get_rfp_private(uuid) from public, anon;
grant execute on function public.get_rfp_private(uuid) to authenticated;

create or replace function public.get_bid_contacts(p_bid_ids uuid[])
returns table (id uuid, posted_by text, contact_email text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select b.id, b.posted_by, b.contact_email
    from public.public_bids b
   where auth.uid() is not null
     and b.id = any (p_bid_ids[1:1000])
     and (b.is_homeowner_rfp is not true or b.user_id = auth.uid())
$$;

revoke execute on function public.get_bid_contacts(uuid[]) from public, anon;
grant execute on function public.get_bid_contacts(uuid[]) to authenticated;

-- ── 2c. the duplicate permissive SELECT policy ──────────────────────────────
drop policy if exists bids_select_all on public.public_bids;

-- ── 1c. award_rfp: only a live bid can be awarded ───────────────────────────
create or replace function public.award_rfp(p_homeowner_id uuid, p_bid_id uuid, p_response_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_bid     RECORD;
  v_winner  RECORD;
  v_project_id UUID := gen_random_uuid();
  v_invite_id  TEXT := gen_random_uuid()::text;
  v_now        TIMESTAMPTZ := NOW();
  -- Same shape the app mints (client-portal-setup: portal-<id8>-<ts36>); hex
  -- epoch-ms here, which the portalId CHECK ([A-Za-z0-9._:-]) accepts.
  v_portal_id  TEXT;
  v_auth_email TEXT;
  v_auth_name  TEXT;
  v_email      TEXT;
  v_name       TEXT;
  v_location   TEXT;
  v_amount     NUMERIC;
  v_desc       TEXT;
  v_drawings   TEXT := '';
  v_url        TEXT;
  v_hero       TEXT;
BEGIN
  -- 1. Verify the bid exists, the caller owns it, and it isn't awarded.
  SELECT id, user_id, status, title, scope_description, city, state,
         address_line, latitude, longitude, contact_email, posted_by,
         desired_start, photo_urls, drawing_urls, awarded_response_id
    INTO v_bid
    FROM public.public_bids WHERE id = p_bid_id;
  IF v_bid IS NULL THEN
    RAISE EXCEPTION 'RFP not found';
  END IF;
  IF v_bid.user_id IS DISTINCT FROM p_homeowner_id THEN
    RAISE EXCEPTION 'Not your RFP';
  END IF;
  -- Defense-in-depth: a JWT-bearing (direct) caller must be the RFP owner.
  -- service_role (edge function) has null auth.uid() and falls through to the
  -- verified p_homeowner_id check above.
  IF auth.uid() IS NOT NULL AND v_bid.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not your RFP';
  END IF;
  IF v_bid.awarded_response_id IS NOT NULL THEN
    RAISE EXCEPTION 'RFP already awarded';
  END IF;

  -- 2. Verify the response belongs to this bid.
  SELECT id, bid_id, user_id, status, company_name, bid_amount, estimate_summary,
         proposer_email, proposer_phone
    INTO v_winner
    FROM public.bid_responses WHERE id = p_response_id;
  IF v_winner IS NULL THEN
    RAISE EXCEPTION 'Response not found';
  END IF;
  IF v_winner.bid_id IS DISTINCT FROM p_bid_id THEN
    RAISE EXCEPTION 'Response does not belong to this RFP';
  END IF;
  -- Wave 5 #12: only a live bid can be awarded. A withdrawn bid, one the
  -- homeowner declined, and a row somebody already stamped 'awarded' outside
  -- this function are all refused - the award path is this function alone.
  IF v_winner.status IS NULL OR v_winner.status NOT IN ('submitted', 'shortlisted') THEN
    RAISE EXCEPTION 'This bid is no longer open for award (status: %)', COALESCE(v_winner.status, 'none');
  END IF;

  -- 3. What the homeowner already gave us.
  SELECT u.email, NULLIF(btrim(u.raw_user_meta_data->>'name'), '')
    INTO v_auth_email, v_auth_name
    FROM auth.users u WHERE u.id = p_homeowner_id;
  v_email := COALESCE(
    NULLIF(btrim(v_bid.contact_email), ''),
    CASE WHEN position('@' in COALESCE(v_bid.posted_by, '')) > 1 THEN btrim(v_bid.posted_by) END,
    NULLIF(btrim(v_auth_email), ''),
    '');
  v_name := COALESCE(v_auth_name, '');

  -- The street address first. NULLIF on each half: CONCAT_WS skips NULLs but
  -- not '' — a post with no parsed state used to store "Austin, ".
  v_location := COALESCE(
    NULLIF(btrim(v_bid.address_line), ''),
    NULLIF(CONCAT_WS(', ', NULLIF(btrim(v_bid.city), ''), NULLIF(btrim(v_bid.state), '')), ''),
    '');

  -- Money to the cent. A missing or non-positive bid sets no budget rather
  -- than a $0 one — $0 would read as a price.
  v_amount := CASE WHEN v_winner.bid_amount IS NOT NULL AND v_winner.bid_amount > 0
                   THEN round(v_winner.bid_amount::numeric, 2) END;

  IF jsonb_typeof(v_bid.drawing_urls) = 'array' THEN
    FOR v_url IN SELECT btrim(x) FROM jsonb_array_elements_text(v_bid.drawing_urls) AS x LOOP
      IF v_url <> '' THEN
        v_drawings := v_drawings || E'\n- ' || v_url;
      END IF;
    END LOOP;
  END IF;

  v_desc := COALESCE(NULLIF(btrim(v_bid.scope_description), ''), '');
  IF NULLIF(btrim(v_winner.estimate_summary), '') IS NOT NULL THEN
    v_desc := v_desc
      || CASE WHEN v_desc = '' THEN '' ELSE E'\n\n' END
      || 'Your winning bid'
      || CASE WHEN v_amount IS NOT NULL THEN ' ($' || to_char(v_amount, 'FM999,999,999,990.00') || ')' ELSE '' END
      || E':\n' || btrim(v_winner.estimate_summary);
  END IF;
  IF v_drawings <> '' THEN
    v_desc := v_desc
      || CASE WHEN v_desc = '' THEN '' ELSE E'\n\n' END
      || 'Drawings the homeowner attached:' || v_drawings;
  END IF;

  v_portal_id := 'portal-' || left(v_project_id::text, 8) || '-'
    || to_hex((extract(epoch from v_now) * 1000)::bigint);

  -- 4. Create the project in the winner's account.
  INSERT INTO public.projects (
    id, user_id, name, type, location, square_footage, quality, description,
    status, location_latitude, location_longitude, location_geocoded_at,
    target_budget, primary_contact, lead_source, target_timeline_notes,
    client_portal
  ) VALUES (
    v_project_id, v_winner.user_id,
    v_bid.title, 'awarded_rfp',
    v_location,
    0, 'standard',
    v_desc,
    'in_progress',
    v_bid.latitude::double precision,
    v_bid.longitude::double precision,
    CASE WHEN v_bid.latitude IS NOT NULL AND v_bid.longitude IS NOT NULL THEN v_now END,
    CASE WHEN v_amount IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object(
      'amount',     v_amount,
      'setAt',      to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'setBy',      'client',
      'clientName', NULLIF(v_name, ''),
      'note',       'The price the homeowner accepted when awarding this job on MAGE ID.'
    )) END,
    CASE WHEN v_email <> '' OR v_name <> '' THEN jsonb_strip_nulls(jsonb_build_object(
      'name',  NULLIF(v_name, ''),
      'email', NULLIF(v_email, '')
    )) END,
    'mage_bids',
    CASE WHEN NULLIF(btrim(v_bid.desired_start), '') IS NOT NULL
         THEN 'Homeowner''s desired start: ' || btrim(v_bid.desired_start) END,
    jsonb_build_object(
      'enabled', TRUE,
      'portalId', v_portal_id,
      'requirePasscode', FALSE,
      'welcomeMessage', 'Welcome! This portal is for the project we just awarded.',
      'coApprovalEnabled', TRUE,
      'sections', jsonb_build_object(
        'schedule', TRUE, 'budget', TRUE, 'invoices', TRUE,
        'changeOrders', TRUE, 'photos', TRUE, 'dailyReports', TRUE,
        'rfis', TRUE, 'documents', TRUE
      ),
      'invites', jsonb_build_array(jsonb_build_object(
        'id', v_invite_id,
        'name', v_name,
        'email', v_email,
        'status', 'pending',
        'createdAt', v_now
      ))
    )
  );

  -- 5. The homeowner's pictures, on the new project. Photos always; drawings
  --    only when they are images (a PDF in the photo grid renders blank — the
  --    description above links every drawing instead). uri is the public
  --    rfp-attachments URL; the photo loader passes non-path values through.
  IF jsonb_typeof(v_bid.photo_urls) = 'array' THEN
    INSERT INTO public.photos (user_id, project_id, uri, "timestamp", tag)
    SELECT v_winner.user_id, v_project_id, btrim(x),
           to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'Homeowner photo'
      FROM jsonb_array_elements_text(v_bid.photo_urls) WITH ORDINALITY AS t(x, n)
     WHERE btrim(x) <> ''
     ORDER BY n;
    SELECT NULLIF(btrim(v_bid.photo_urls->>0), '') INTO v_hero;
  END IF;
  IF jsonb_typeof(v_bid.drawing_urls) = 'array' THEN
    INSERT INTO public.photos (user_id, project_id, uri, "timestamp", tag)
    SELECT v_winner.user_id, v_project_id, btrim(x),
           to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'Homeowner drawing'
      FROM jsonb_array_elements_text(v_bid.drawing_urls) WITH ORDINALITY AS t(x, n)
     WHERE split_part(btrim(x), '?', 1) ~* '\.(jpe?g|png|webp|gif|heic|heif)$'
     ORDER BY n;
  END IF;

  -- 6. Mark winner as awarded + record project link.
  UPDATE public.bid_responses
    SET status='awarded', awarded_project_id=v_project_id, responded_at=v_now
    WHERE id = p_response_id;

  -- 7. Decline all other open responses on this RFP.
  UPDATE public.bid_responses
    SET status='declined', responded_at=v_now
    WHERE bid_id=p_bid_id
      AND id <> p_response_id
      AND status IN ('submitted','shortlisted');

  -- 8. Close the bid.
  UPDATE public.public_bids
    SET status='closed', awarded_response_id=p_response_id, awarded_at=v_now
    WHERE id=p_bid_id;

  RETURN jsonb_build_object(
    'success',         TRUE,
    'projectId',       v_project_id,
    'portalId',        v_portal_id,
    'inviteId',        v_invite_id,
    'winnerUserId',    v_winner.user_id,
    'winnerEmail',     v_winner.proposer_email,
    'companyName',     v_winner.company_name,
    'projectName',     v_bid.title,
    'homeownerEmail',  NULLIF(v_email, ''),
    'contractValue',   v_amount,
    'heroPhotoUrl',    v_hero
  );
END
$function$;
revoke execute on function public.award_rfp(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.award_rfp(uuid, uuid, uuid) to service_role;
