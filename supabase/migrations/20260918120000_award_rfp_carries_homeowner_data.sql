-- 20260918120000_award_rfp_carries_homeowner_data.sql
--
-- award_rfp now hands the winning contractor what the homeowner already gave.
--
-- ── WHAT WAS WRONG (audit round 2, findings #7 / #19) ────────────────────────
-- post-rfp writes the homeowner's street address, lat/lng, email, photos,
-- drawings, budget and desired start into public_bids. The award then built
-- the contractor's new project from title + city/state + scope and nothing
-- else:
--   • location was CONCAT_WS(city, state) — "Austin, TX". address_line was
--     never even SELECTed, so he had no street address to drive to (and the
--     Home Passport filed the job under the city).
--   • bid_amount — the figure the homeowner confirmed twice ("Award $48,500")
--     — was read into v_winner and thrown away. No target_budget, so the new
--     job showed $0 everywhere a price belongs.
--   • photo_urls and drawing_urls were read into v_bid and thrown away, while
--     the rfp_awarded email told him the project had "their drawings, photos".
--   • contact_email was never read. primary_contact stayed empty and the
--     seeded portal invite was {name:'', email:''} — the weekly digest skips
--     it (it needs an '@') and he had no way to reach the client.
--   • the portalId was a bare uuid instead of the portal-<id8>-<ts> shape the
--     app mints everywhere else.
--
-- ── WHAT THIS DOES ───────────────────────────────────────────────────────────
-- Same checks, same transaction, same four writes (project, winner, losers,
-- bid). The project INSERT now carries:
--   location            = address_line, falling back to "city, state"
--   location_latitude/longitude (+ geocoded_at) from the post's own geocode
--   target_budget       = {amount: bid_amount to the cent, setBy:'client'} —
--                         the homeowner accepted exactly that number, and
--                         setBy 'client' is what the portal-budget flow uses
--                         for a figure the client proposed
--   primary_contact     = the homeowner's name + email
--   lead_source         = 'mage_bids' (an existing LeadSource value)
--   target_timeline_notes = the desired start the homeowner typed
--   description         = scope, then the winner's own estimate summary, then
--                         a link to every drawing (PDF drawings have no other
--                         home on a project: plan_sheets holds page images)
-- and it files every photo — plus every drawing that is an image — into
-- public.photos on the new project, owned by the winner, tagged so he can
-- tell the homeowner's pictures from his own.
--
-- The invite is seeded with the homeowner's email (public_bids.contact_email,
-- else posted_by when it is an address, else auth.users.email) and name
-- (auth.users.raw_user_meta_data->>'name', the key AuthContext writes).
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────
-- It does not hand the homeowner a portal link. trg_portal_access_token
-- mints the accessToken on this INSERT, so a URL could be built — but the
-- homeowner portal reads a published snapshot (portal_get_snapshot_v2), and
-- none exists until the contractor opens client-portal-setup. A link returned
-- here would open on "not published yet". The app therefore tells the
-- homeowner the contractor will send it, and the invite now carries the email
-- he needs to do that.
--
-- The return value gains the facts the notify template already reads
-- (contract_value, hero_photo_url) and what the award screen needs to say
-- who will be contacted (homeownerEmail, companyName). Existing keys keep
-- their names; award-rfp only reads keys it knows.
--
-- Idempotent: CREATE OR REPLACE + REVOKE/GRANT. Signature unchanged, so the
-- 20260713140000 grant lock carries over; it is restated below anyway.
-- Reverse path: re-run section 3 of 20260713140000_security_standalone_authz_fixes.sql.
-- Test: scratchpad pgtest/award_rfp_carry.mjs (PGlite, file executed twice);
-- static guard: scripts/validate-rfp-marketplace-honesty.ts.

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
  SELECT id, bid_id, user_id, company_name, bid_amount, estimate_summary,
         proposer_email, proposer_phone
    INTO v_winner
    FROM public.bid_responses WHERE id = p_response_id;
  IF v_winner IS NULL THEN
    RAISE EXCEPTION 'Response not found';
  END IF;
  IF v_winner.bid_id IS DISTINCT FROM p_bid_id THEN
    RAISE EXCEPTION 'Response does not belong to this RFP';
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
