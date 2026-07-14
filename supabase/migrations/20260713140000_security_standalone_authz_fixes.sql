-- 20260713140000_security_standalone_authz_fixes.sql
--
-- Standalone authorization fixes from the 2026-07-13 full-app security audit.
-- Each is verified against LIVE prod (nteoqhcswappxxjlpvap) and breaks no
-- legitimate path, because the app talks to the award-rfp / project-memory-search
-- EDGE FUNCTIONS (which invoke these RPCs with the service_role key) and NEVER
-- calls the RPCs directly (verified: app/rfp-responses-review.tsx uses
-- supabase.functions.invoke('award-rfp'); no app code calls match_project_memory).
-- messages_select already enforces correct per-conversation read scoping. Every
-- change here is reversible (re-GRANT / re-CREATE the dropped policy).

-- ── 1. messages: drop the tautological cross-tenant SELECT policy ──────────────
-- msg_select_convo's EXISTS predicate is `cp.conversation_id = cp.conversation_id`
-- (always true; never correlates to messages.conversation_id), so once a user is a
-- participant in ANY conversation it lets them read EVERY message of EVERY tenant.
-- The correct sibling policy messages_select scopes reads via
-- conversations.participant_ids @> auth.uid(), so dropping this loses no
-- legitimate access. (messages table is empty today — this is latent-but-armed.)
drop policy if exists msg_select_convo on public.messages;

-- Also drop the redundant weak INSERT policy. msg_insert_auth only checks
-- auth.role()='authenticated', which (OR'd with the correct policy) lets a user
-- insert a message with a SPOOFED sender_id. messages_insert
-- (with_check auth.uid() = sender_id) is correct and covers every legit insert.
drop policy if exists msg_insert_auth on public.messages;

-- ── 2. match_project_memory: revoke the direct anon/authenticated/PUBLIC grant ─
-- SECURITY DEFINER + client-supplied p_user_id with NO auth.uid() pin means anyone
-- holding the public anon key can read ANY user's project-memory embeddings
-- (cross-user IDOR). The only legitimate caller is the project-memory-search edge
-- function, which invokes via the service_role key. Strip every non-service grant
-- (prod had drifted to also grant anon + PUBLIC).
revoke execute on function public.match_project_memory(uuid, text, text, integer) from anon;
revoke execute on function public.match_project_memory(uuid, text, text, integer) from authenticated;
revoke execute on function public.match_project_memory(uuid, text, text, integer) from public;

-- ── 3. award_rfp: close the RFP-hijack hole ────────────────────────────────────
-- award_rfp is SECURITY DEFINER and trusts the CLIENT-SUPPLIED p_homeowner_id
-- (it compares v_bid.user_id to p_homeowner_id, never to auth.uid()). Any
-- authenticated user could POST directly to /rest/v1/rpc/award_rfp with a victim's
-- owner id + their own forged bid_response and steal the RFP/lead into their own
-- account, force-closing the victim's RFP and auto-declining every real bidder
-- (3 open RFPs exploitable today).
--
-- Defense-in-depth: pin inside the function so a JWT-bearing (direct) caller can
-- only award their OWN RFP. When the award-rfp edge function calls via service_role
-- auth.uid() is NULL, so the guard is skipped and the existing p_homeowner_id check
-- applies — and the edge function set p_homeowner_id to the VERIFIED homeowner id
-- (verifyUser → /auth/v1/user). Body is otherwise byte-identical to the live def.
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
  v_portal_id  UUID := gen_random_uuid();
  v_now        TIMESTAMPTZ := NOW();
BEGIN
  -- 1. Verify the bid exists, the caller owns it, the bid is open + a
  --    homeowner RFP, and it isn't already awarded.
  SELECT id, user_id, status, title, scope_description, city, state,
         photo_urls, drawing_urls, awarded_response_id
    INTO v_bid
    FROM public.public_bids WHERE id = p_bid_id;
  IF v_bid IS NULL THEN
    RAISE EXCEPTION 'RFP not found';
  END IF;
  IF v_bid.user_id IS DISTINCT FROM p_homeowner_id THEN
    RAISE EXCEPTION 'Not your RFP';
  END IF;
  -- Defense-in-depth pin: when a JWT is present (a direct authenticated caller),
  -- the caller MUST be the RFP owner. service_role (edge function) has a null
  -- auth.uid() and falls through to the verified p_homeowner_id check above.
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

  -- 3. Create project in the winner's account, populated with the
  --    homeowner's data + a fresh client_portal record.
  INSERT INTO public.projects (
    id, user_id, name, type, location, square_footage, quality, description,
    status, client_portal
  ) VALUES (
    v_project_id, v_winner.user_id,
    v_bid.title, 'awarded_rfp',
    COALESCE(NULLIF(CONCAT_WS(', ', v_bid.city, v_bid.state), ''), ''),
    0, 'standard',
    COALESCE(v_bid.scope_description, ''),
    'in_progress',
    jsonb_build_object(
      'enabled', TRUE,
      'portalId', v_portal_id::text,
      'requirePasscode', FALSE,
      'welcomeMessage', 'Welcome! This portal is for the project we just awarded.',
      'coApprovalEnabled', TRUE,
      'sections', jsonb_build_object(
        'schedule', TRUE, 'budget', TRUE, 'invoices', TRUE,
        'changeOrders', TRUE, 'photos', TRUE, 'dailyReports', TRUE,
        'rfis', TRUE, 'documents', TRUE
      ),
      'invites', jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text,
        'name', '',
        'email', '',
        'status', 'pending',
        'createdAt', v_now
      ))
    )
  );

  -- 4. Mark winner as awarded + record project link.
  UPDATE public.bid_responses
    SET status='awarded', awarded_project_id=v_project_id, responded_at=v_now
    WHERE id = p_response_id;

  -- 5. Decline all other open responses on this RFP.
  UPDATE public.bid_responses
    SET status='declined', responded_at=v_now
    WHERE bid_id=p_bid_id
      AND id <> p_response_id
      AND status IN ('submitted','shortlisted');

  -- 6. Close the bid.
  UPDATE public.public_bids
    SET status='closed', awarded_response_id=p_response_id, awarded_at=v_now
    WHERE id=p_bid_id;

  RETURN jsonb_build_object(
    'success',         TRUE,
    'projectId',       v_project_id,
    'portalId',        v_portal_id,
    'winnerUserId',    v_winner.user_id,
    'winnerEmail',     v_winner.proposer_email,
    'projectName',     v_bid.title
  );
END
$function$;

-- Primary fix: only the edge function (service_role) legitimately calls this RPC;
-- the app uses supabase.functions.invoke('award-rfp'). Revoke the direct
-- authenticated grant so the PostgREST attack path (forged p_homeowner_id) is gone.
revoke execute on function public.award_rfp(uuid, uuid, uuid) from authenticated;

-- ── 4. Free-tier project cap: add enterprise + align free cap to the client ────
-- Bug 1 (correctness): the unlimited allow-list omits 'enterprise', so a paying
-- Enterprise subscriber falls into the free branch and is wrongly capped.
-- Bug 2 (monetization integrity): the server allowed 3 while the client gate
-- (hooks/useTierAccess.ts maxProjects.free = 1, counting only non-sample projects)
-- allows 1 real project. A modified client / direct REST insert could create 3.
-- Align the server to the client's expressed limit: 1 REAL (non-"Sample — ")
-- project, and treat 'enterprise' as unlimited. Body otherwise identical to live.
create or replace function public.enforce_free_tier_project_cap()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_tier text;
  v_count int;
BEGIN
  -- Upsert-as-update of an existing project must never be capped.
  IF EXISTS (SELECT 1 FROM projects WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Pull the user's current tier. Fail OPEN (allow insert) if the subscriptions
  -- row is missing — we'd rather risk an extra free project than block a paid user.
  SELECT tier INTO v_tier
  FROM subscriptions
  WHERE user_id = NEW.user_id
    AND (end_date IS NULL OR end_date > NOW())
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_tier IS NULL THEN
    v_tier := 'free';
  END IF;

  -- Pro, Business, and Enterprise get unlimited projects.
  IF v_tier IN ('pro', 'business', 'enterprise') THEN
    RETURN NEW;
  END IF;

  -- Free tier: 1 REAL project (matches hooks/useTierAccess.ts realProjectCount,
  -- which excludes the onboarding "Sample — " seed). Count existing real rows.
  SELECT COUNT(*) INTO v_count
  FROM projects
  WHERE user_id = NEW.user_id
    AND name NOT LIKE 'Sample — %';

  IF v_count >= 1 THEN
    RAISE EXCEPTION 'Free tier is limited to 1 project. Upgrade to Pro for unlimited projects.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;
