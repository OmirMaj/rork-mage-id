-- 20260923160000_crew_claim_freeze_and_schedule_presence.sql
--
-- Wave 5, crew lane. Two independent server-side fixes, both additive:
--
-- (1) #70 — a stale roster copy undid a worker's claim.
--     The GC's app writes the WHOLE crew_members row on every edit (CrewContext
--     updateCrewMember → toRow(next)). His copy can be hours old: the roster
--     is read once at launch and never refetched while the app stays alive.
--     So one tap on a project chip, from a copy taken before the worker
--     claimed, wrote back claimed_by_user_id = null, claimed_at = null and the
--     old claim_token — un-claiming the worker AND re-arming an invite link
--     that claim-crew had burned ("a spent token must never be re-redeemable").
--     A web tab loaded before an ID scan on the iPhone did the same to the
--     scan (id_verified back to false, masked number gone).
--
--     crew_freeze_ownership_columns only froze columns for NON-owners. This
--     rewrite keeps that block byte-for-byte and adds a second one that runs
--     for EVERY authenticated caller, owner included (CONTRACT 19):
--       • claimed_by_user_id / claimed_at: always restored from OLD. No client
--         path sets them — the only writer is the claim-crew edge function,
--         which runs as the service role (auth.uid() IS NULL, still free), as
--         does delete-account and the auth.users ON DELETE SET NULL cascade.
--       • claim_token: frozen once OLD.claimed_by_user_id is set (burned), and
--         while unclaimed it may only go NULL → value (startClaimInvite mints
--         one when there is none) — never back to null, never swapped for a
--         different token by a stale copy.
--       • id_* : the owner may change the ID fields only with a NEWER scan
--         (NEW.id_scanned_at strictly after OLD.id_scanned_at). A copy taken
--         before the scan carries an older or null id_scanned_at and is pinned.
--         "Remove ID" in app/crew.tsx writes a fresh id_scanned_at with the
--         fields cleared, so a deliberate clear still lands.
--       • once claimed, the worker owns his contact details and visibility
--         (phone, email, trades, is_public — the fields SelfEditCard edits):
--         the owner's write keeps them from OLD unless the owner IS the
--         claimer. app/crew.tsx locks those inputs for the GC and says why.
--
--     GUARD TRIGGER RULE: every pin is silent (NEW.col := OLD.col). A raise
--     would turn the replayed full-row write into a permanent offline-queue
--     failure and lose the legitimate change riding in the same row (the
--     project assignment he actually tapped).
--
--     Clock note: id_scanned_at is the scanning device's clock. A genuine
--     re-scan from a device whose clock runs behind the previous scan's is
--     pinned too; the next roster read shows the older scan, and he re-scans.
--
-- (2) #169 — schedule presence ran on a PUBLIC Realtime channel.
--     `schedule:<projectId>` needed only the anon key to join, and each peer
--     broadcast its email. hooks/useSchedulePresence.ts now joins with
--     `private: true`, which Realtime authorises through RLS on
--     realtime.messages. Production has RLS on realtime.messages and ZERO
--     policies there, so without the two policies below every private join is
--     refused and presence dies silently — APPLY THIS BEFORE THE OTA.
--     The check uses can_access_project(text, text): its text overload casts
--     inside an exception block and returns false on a junk topic, where a
--     `::uuid` cast in the policy would throw. Scoped to authenticated, to
--     topics starting 'schedule:' and to the presence / broadcast extensions,
--     so no other channel's behaviour changes (every other channel in the app
--     is still public, and public channels are not evaluated against these).

-- ── (1) crew_members ownership freeze ──────────────────────────────────────
-- Base: the LIVE definition (pg_get_functiondef, 2026-09-23) = the body in
-- 20260708130000_crew_members.sql. LANGUAGE plpgsql, SECURITY INVOKER, no
-- search_path (proconfig null) — all kept.
CREATE OR REPLACE FUNCTION public.crew_freeze_ownership_columns()
RETURNS TRIGGER AS $$
BEGIN
  -- Non-owner (the claimed worker editing his own row): unchanged.
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM OLD.user_id THEN
    NEW.user_id := OLD.user_id;
    NEW.claimed_by_user_id := OLD.claimed_by_user_id;
    NEW.claimed_at := OLD.claimed_at;
    NEW.claim_token := OLD.claim_token;
    NEW.id_verified := OLD.id_verified;
    NEW.id_type := OLD.id_type;
    NEW.id_masked_last4 := OLD.id_masked_last4;
    NEW.id_expiry := OLD.id_expiry;
    NEW.id_issuer := OLD.id_issuer;
    NEW.id_scanned_at := OLD.id_scanned_at;
    NEW.id_image_path := OLD.id_image_path;
    NEW.marketplace_profile_id := OLD.marketplace_profile_id;
    NEW.full_name := OLD.full_name;
    NEW.status := OLD.status;
    NEW.project_ids := OLD.project_ids;
  END IF;

  -- Every authenticated caller, owner included (#70, CONTRACT 19).
  IF auth.uid() IS NOT NULL THEN
    -- Claim state: written only by the service-role claim-crew function.
    NEW.claimed_by_user_id := OLD.claimed_by_user_id;
    NEW.claimed_at := OLD.claimed_at;

    -- Claim token: burned once claimed; while unclaimed, only NULL → value.
    IF OLD.claimed_by_user_id IS NOT NULL OR OLD.claim_token IS NOT NULL THEN
      NEW.claim_token := OLD.claim_token;
    END IF;

    -- ID fields: only a strictly newer scan may replace a recorded one.
    IF OLD.id_scanned_at IS NOT NULL
       AND NOT (NEW.id_scanned_at IS NOT NULL AND NEW.id_scanned_at > OLD.id_scanned_at) THEN
      NEW.id_verified := OLD.id_verified;
      NEW.id_type := OLD.id_type;
      NEW.id_masked_last4 := OLD.id_masked_last4;
      NEW.id_expiry := OLD.id_expiry;
      NEW.id_issuer := OLD.id_issuer;
      NEW.id_scanned_at := OLD.id_scanned_at;
      NEW.id_image_path := OLD.id_image_path;
    END IF;

    -- A claimed worker's own details: not the owner's to overwrite.
    IF OLD.claimed_by_user_id IS NOT NULL
       AND auth.uid() IS DISTINCT FROM OLD.claimed_by_user_id THEN
      NEW.phone := OLD.phone;
      NEW.email := OLD.email;
      NEW.trades := OLD.trades;
      NEW.is_public := OLD.is_public;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The trigger itself (crew_members_freeze_ownership, BEFORE UPDATE FOR EACH
-- ROW) already points at this function; CREATE OR REPLACE rebinds nothing.

-- ── (2) private schedule-presence channels ────────────────────────────────
DROP POLICY IF EXISTS schedule_presence_members_select ON realtime.messages;
CREATE POLICY schedule_presence_members_select ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.messages.extension IN ('presence', 'broadcast')
    AND realtime.topic() LIKE 'schedule:%'
    AND public.can_access_project(split_part(realtime.topic(), ':', 2)::text, 'viewer'::text)
  );

DROP POLICY IF EXISTS schedule_presence_members_insert ON realtime.messages;
CREATE POLICY schedule_presence_members_insert ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    realtime.messages.extension IN ('presence', 'broadcast')
    AND realtime.topic() LIKE 'schedule:%'
    AND public.can_access_project(split_part(realtime.topic(), ':', 2)::text, 'viewer'::text)
  );
