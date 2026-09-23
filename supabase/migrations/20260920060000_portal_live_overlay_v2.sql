-- 20260920060000_portal_live_overlay_v2.sql — wave 4, lane portal-server
-- (#13, #14, #20, #65, #71 = #132; carries #12, #28, #83 = #135)
--
-- The homeowner portal is a snapshot the GC's app publishes, laid over with
-- live rows on every read (portal_overlay_live, 20260919030000). That overlay
-- could only take things away. Five things the homeowner does or sees were
-- still frozen at the GC's last publish, and each one told the homeowner
-- something false:
--
-- 1. THE CONTRACT (#13, #65, carry #12). portal_sign_contract flipped the row
--    to 'signed' and the page reloaded 2.2 s later — onto the same snapshot,
--    still 'sent' with needsSignature true. The Sign box came back; a second
--    tap got sign_denied and the copy "ask your contractor to re-send your
--    link". And a contract sent on a job already In progress never reached the
--    snapshot at all (no tracked write marks the job for a publish). Now the
--    overlay reads the job's ACTIVE contract — the one live row (not
--    superseded, not void) the 20260918200000 unique index allows — and:
--      - sent / signed  -> the contract block carries its LIVE id, status,
--        contractValue, title, needsSignature (sent and no homeowner
--        signature), and once signed homeownerSignerName / homeownerSignedAt /
--        homeownerSignatureMethod ('portal' | 'in_person' | 'paper'). The
--        signature's evidencePath and drawn strokes are never copied out.
--      - no snapshot block (or one for a different contract) -> a minimal
--        block with contentPending: true. The terms are published by the GC's
--        device, which resolves the payment schedule to the cent; the server
--        cannot, so it never invents them. The page shows the contract but no
--        sign box until the device publishes (portal-page).
--        A block for the SAME contract id is never marked contentPending,
--        whatever shape its terms take: whether they are on the page is the
--        page's check, not this function's. (Round 1 stamped contentPending
--        on any block without a `content` object, which would have locked
--        signing on every existing snapshot and on a builder that publishes
--        #64's terms as flat keys.)
--      - draft / void / none -> the block and the 'contract' decision go.
--    The 'contract' ownerDecision stays only while needsSignature is true and
--    the block is not contentPending.
--    portal_sign_contract locks the row and answers {ok:true, already:true}
--    for a contract that is already signed — any method — instead of
--    sign_denied (after the token and passcode checks, so it is no oracle).
--    A portal signature now records method 'portal'.
--
-- 2. SELECTIONS (#13). portal_choose_selection writes selection_options; the
--    overlay never read it, so the pick vanished on reload and the category
--    stayed "waiting on you". Now options[].isChosen comes from
--    selection_options, the category reads 'chosen', and a picked category
--    leaves ownerDecisions.
--
-- 3. CHANGE-ORDER DECISIONS (#71 = #132). The CO RPCs accepted a decision on
--    a CO that already had one, from a second phone or browser (localStorage
--    was the only guard), and the reconciler then flipped a signed CO to
--    Rejected. Now both RPCs:
--      - lock the change_orders row (two taps at once serialize);
--      - look for a decision recorded for the CURRENT send. The send is named
--        by change_order_approvals.send_stamp (new column) =
--        portal_co_send_stamp(portal_state) = "<sentVersion>@<sentAt>" — the
--        pair the app's sendToClientPortal bumps on every Send. A stamped row
--        is matched by EQUALITY, never by clock, so a skewed device clock
--        cannot reopen a decided CO or block a re-sent one.
--        ONE CLOCK-BASED FALLBACK: a row with send_stamp null — a row from
--        before this migration, or the in-person approval app/client-view.tsx
--        inserts on the GC's device (it does not stamp) — counts when the
--        server's created_at is at or after portal_state.sentAt, which the
--        GC's DEVICE clock wrote (or when there is no sentAt). A device clock
--        running fast can hide such a decision (the CO reopens for a portal
--        decision); one running slow can let an in-person decision from an
--        EARLIER send close a re-sent CO. Production had 0 approval rows
--        (2026-09-19), so today this only reaches future in-person inserts;
--        stamping send_stamp on client-view's insert (portal-page's file)
--        would leave the fallback to legacy rows only;
--      - if one exists, or the CO's live status is no longer pending
--        (utils/portalOwnerCore PENDING_CO_STATUSES), answer
--        {ok:true, recorded:false, decision, signer_name, sealed_at} and
--        append nothing;
--      - otherwise record the decision (and, for the signed RPC, the sealed
--        audit entry). change_orders.status is NOT written: the GC's
--        reconciler (hooks/usePortalApprovalReconciler) flips it, which is
--        what runs the app's approval side effects — the "place these days"
--        schedule marker and its local notification, and fireGradingEvent —
--        in ProjectContext.updateChangeOrder (becameApproved needs the local
--        status to change). A server-side flip would reach the app through
--        realtime first and silently skip all three.
--    The unique index change_order_approvals_one_per_send (project_id,
--    change_order_id, send_stamp) is the backstop; it includes the send stamp,
--    so a CO the GC revises and re-sends can be decided again. The sealed
--    audit actions keep their names (CONTRACT 7). The overlay closes a decided
--    CO from the approval row whatever change_orders.status says, shows the
--    decision as its status while the row is still pending, and adds
--    clientDecision {decision, signerName, sealedAt} — so every device drops
--    the buttons at once without the status write.
--    WHAT IT GIVES UP: the GC's own CO list reads 'submitted' until the
--    reconciler runs on his device; and a stale queued GC edit can still
--    overwrite status (the app keeps its own status for offline edits) — the
--    reconciler's conflict rule (portal-page) covers what reaches the app.
--
-- 4. PHOTOS (#14). Photos were published as file:// URIs only the GC's phone
--    can open, or 24-hour signed links. The bucket is private and plpgsql
--    cannot mint Storage URLs, so a new edge function (signed-media-urls)
--    signs them per read by photo id. The overlay's part: a photo's url
--    survives only when it is http(s) (a legacy public link); every other
--    value (file:, blob:, data:, a bare path) is removed and the page asks
--    signed-media-urls for the id. The hero is matched by project.heroPhotoId
--    (by uri only for a snapshot built before it); a recalled hero, or a
--    legacy non-http hero, falls back to the newest shared photo's id.
--
-- 5. THE LATEST UPDATE (#20). The overlay ordered published summaries by the
--    UTC day and labelled them with it, so an update saved at 8:30 pm EDT
--    showed under tomorrow. Now it orders by the full instant (a bare day is
--    read as its noon, the app's dayOrInstantDate rule; a malformed value
--    never throws) and labels in the snapshot's timeZone (validated, else
--    UTC). latestUpdate also carries `day` (YYYY-MM-DD in that zone) so the
--    page can format it in the viewer's language.
--
-- CARRIES (built here because this lane is portal_overlay_live's only
-- redefiner):
--   #83 / #135 — while a bank payment is in flight (pay_pending_at under 10
--     days old — the dunning hold, utils/billingFlowCore.PAYMENT_PENDING_HOLD_MS)
--     an invoice / AIA card gets paymentProcessing {since, amount} and NO
--     payLinkUrl, and an invoice decision the pending amount covers leaves
--     ownerDecisions. The columns come from 20260920020000 (money-ledger), but
--     they are read through to_jsonb(row) so this file compiles and runs with
--     or without it. Apply 02 FIRST all the same (POST-CHAIN order).
--   #28 — an RFI card shows the LIVE rfis.number (the server renumbers a
--     phone's guess), not the frozen one.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
-- CREATE OR REPLACE (signatures and grants unchanged) / REVOKE / GRANT.

-- ── 0. The send stamp on a CO decision ───────────────────────────────────────

alter table public.change_order_approvals add column if not exists send_stamp text;

comment on column public.change_order_approvals.send_stamp is
  'portal_co_send_stamp(change_orders.portal_state) at the time of the decision: "<sentVersion>@<sentAt>". One decision per (project_id, change_order_id, send_stamp) — a re-sent CO gets a new stamp and can be decided again. Written only by the portal CO RPCs; pinned by co_approval_freeze_evidence.';

-- The e-signature evidence record: the send it answered is evidence too.
-- Same body as 20260902140000 plus send_stamp.
create or replace function public.co_approval_freeze_evidence()
returns trigger
language plpgsql
as $function$
begin
  if auth.uid() is not null then
    new.id               := old.id;
    new.portal_id        := old.portal_id;
    new.project_id       := old.project_id;
    new.invite_id        := old.invite_id;
    new.change_order_id  := old.change_order_id;
    new.decision         := old.decision;
    new.signer_name      := old.signer_name;
    new.signer_email     := old.signer_email;
    new.signature_data   := old.signature_data;
    new.note             := old.note;
    new.user_agent       := old.user_agent;
    new.created_at       := old.created_at;
    new.signature_hash   := old.signature_hash;
    new.consent_record   := old.consent_record;
    new.document_hash    := old.document_hash;
    new.consent_version  := old.consent_version;
    new.consent_accepted := old.consent_accepted;
    new.sealed_at        := old.sealed_at;
    new.send_stamp       := old.send_stamp;
    -- synced_to_co_at is deliberately NOT pinned. It is the one column an
    -- authenticated GC is allowed to write (the portal reconciler's stamp).
  end if;
  return new;
end;
$function$;

-- Backstop for the row lock below. Includes the send stamp (a re-sent CO is a
-- new decision). Production: 0 approval rows, 0 duplicate pairs (2026-09-19,
-- read-only aggregate), so it builds cleanly; legacy null-stamp rows are
-- outside it.
create unique index if not exists change_order_approvals_one_per_send
  on public.change_order_approvals (project_id, change_order_id, send_stamp)
  where send_stamp is not null;

-- ── 1. Helpers (overlay + RPCs only; no client role may call them) ─────────

-- A text that may or may not be an ISO instant or a bare day. Never throws.
create or replace function public.portal_try_timestamptz(p text)
returns timestamptz
language plpgsql
stable  -- a text→timestamptz cast reads the session TimeZone: not immutable
set search_path to 'public'
as $$
begin
  if p is null or length(btrim(p)) = 0 or length(p) > 40 then return null; end if;
  -- A bare calendar day is that day's noon UTC — utils/calendarDate
  -- dayOrInstantDate, so the server picks the same report the app picks.
  if btrim(p) ~ '^\d{4}-\d{2}-\d{2}$' then return (btrim(p) || 'T12:00:00Z')::timestamptz; end if;
  if btrim(p) !~ '^\d{4}-\d{2}-\d{2}[T ]' then return null; end if;
  return btrim(p)::timestamptz;
exception when others then
  return null;
end $$;

-- An IANA zone name the snapshot claims, or UTC. Never throws.
create or replace function public.portal_safe_time_zone(p text)
returns text
language plpgsql
stable
set search_path to 'public'
as $$
declare v_probe timestamp;
begin
  if p is null or length(p) > 64 or p !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$' then
    return 'UTC';
  end if;
  v_probe := now() at time zone p;
  return p;
exception when others then
  return 'UTC';
end $$;

-- Which Send of a CO a decision answers. portal_state carries sentVersion
-- (+1 on every Send) and sentAt (the Send's instant); a CO with no
-- portal_state is shared by default and has one, unnamed, send.
create or replace function public.portal_co_send_stamp(p_ps jsonb)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when p_ps is null or jsonb_typeof(p_ps) <> 'object' then 'unsent'
    else coalesce(nullif(p_ps->>'sentVersion', ''), '0') || '@' || coalesce(p_ps->>'sentAt', '')
  end
$$;

-- The decision recorded for the CO's CURRENT send (the first one, if a
-- pre-migration pair slipped through), as {id, decision, signer_name,
-- sealed_at, document_hash}, or null.
create or replace function public.portal_co_decision_for_send(p_pid uuid, p_co_id text, p_ps jsonb)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
           'id', a.id,
           'decision', a.decision,
           'signer_name', a.signer_name,
           'sealed_at', to_char(coalesce(a.sealed_at, a.created_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'document_hash', a.document_hash)
    from public.change_order_approvals a
   where a.project_id = p_pid::text
     and a.change_order_id = btrim(p_co_id)
     and (a.send_stamp = public.portal_co_send_stamp(p_ps)
          or (a.send_stamp is null
              and (public.portal_try_timestamptz(p_ps->>'sentAt') is null
                   or a.created_at >= public.portal_try_timestamptz(p_ps->>'sentAt'))))
   order by a.created_at asc, a.id asc
   limit 1
$$;

revoke all on function public.portal_try_timestamptz(text) from public, anon, authenticated;
revoke all on function public.portal_safe_time_zone(text) from public, anon, authenticated;
revoke all on function public.portal_co_send_stamp(jsonb) from public, anon, authenticated;
revoke all on function public.portal_co_decision_for_send(uuid, text, jsonb) from public, anon, authenticated;

-- ── 2. Contract signing answers "already signed" ─────────────────────────────

create or replace function public.portal_sign_contract(
  p_portal_id text, p_contract_id uuid, p_signer_name text,
  p_passcode text default null::text, p_access_token text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_project_id uuid; v_portal jsonb; v_status text; v_sig jsonb;
begin
  v_project_id := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_project_id is null then
    raise exception 'sign_denied';
  end if;
  select client_portal into v_portal from public.projects where id = v_project_id;

  if p_passcode is not null
     and coalesce(v_portal->>'passcode','') <> ''
     and p_passcode <> (v_portal->>'passcode') then
    raise exception 'sign_denied';
  end if;

  -- Row lock: a second device signing at the same moment waits here, then
  -- reads 'signed' below.
  select status, homeowner_signature into v_status, v_sig
    from public.project_contracts
   where id = p_contract_id and project_id = v_project_id
   for update;
  if not found then
    raise exception 'sign_denied';
  end if;
  -- Already signed — on this portal, on another device, in person or on
  -- paper (#13 / #65): not a bad link. The caller holds a valid token, so
  -- this tells them nothing they could not read from the snapshot.
  if v_status = 'signed'
     or (v_sig is not null and jsonb_typeof(v_sig) = 'object' and length(btrim(coalesce(v_sig->>'name', ''))) > 0) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if v_status is null or v_status <> 'sent' then
    raise exception 'sign_denied';
  end if;

  if p_signer_name is null or length(btrim(p_signer_name)) < 3 then
    raise exception 'sign_denied';
  end if;
  -- Integration round 1: a signature binds the terms the homeowner was SHOWN,
  -- and the portal shows them only from the GC's published block for THIS
  -- contract (the overlay marks anything else contentPending with no Sign
  -- box). A call without that block — an older page, or a hand-made request —
  -- is refused, never recorded against terms nobody published. Checked after
  -- the token, passcode and already-signed answers, so it is no oracle.
  if not exists (
       select 1 from public.portal_snapshots ps
        where ps.portal_id = p_portal_id
          and jsonb_typeof(ps.snapshot->'contract') = 'object'
          and (ps.snapshot->'contract'->>'id') = p_contract_id::text) then
    raise exception 'contract_terms_pending';
  end if;

  update public.project_contracts
     set homeowner_signature = jsonb_build_object('name', btrim(p_signer_name), 'role','homeowner',
                                                  'signedAt', now(), 'method', 'portal'),
         status = 'signed', signed_at = now()
   where id = p_contract_id and project_id = v_project_id and status = 'sent';

  insert into public.portal_decision_audit(portal_id, project_id, action, detail)
    values (p_portal_id, v_project_id, 'sign',
            jsonb_build_object('contract', p_contract_id, 'signer', btrim(p_signer_name)));
  return jsonb_build_object('ok', true);
end; $function$;

-- ── 3. One decision per send of a change order (#71 = #132) ──────────────────

create or replace function public.portal_submit_co_approval(
  p_portal_id text, p_access_token text, p_change_order_id text,
  p_decision text, p_signer_name text, p_note text, p_user_agent text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pid uuid; v_id uuid; v_ps jsonb; v_status text; v_prior jsonb;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  if p_decision is null or p_decision not in ('approved', 'declined') then raise exception 'portal_denied'; end if;
  if p_change_order_id is null or length(btrim(p_change_order_id)) = 0 then raise exception 'portal_denied'; end if;
  -- THIS project's CO (flat portal_denied — no probing other ids), locked so
  -- two submissions for it serialize.
  select c.portal_state, c.status into v_ps, v_status from public.change_orders c
   where c.id::text = btrim(p_change_order_id) and c.project_id = v_pid
   for update;
  if not found then raise exception 'portal_denied'; end if;
  if not public.portal_state_is_shared(v_ps) then raise exception 'co_not_shared'; end if;

  v_prior := public.portal_co_decision_for_send(v_pid, p_change_order_id, v_ps);
  if v_prior is not null then
    return jsonb_build_object('ok', true, 'recorded', false,
      'decision', v_prior->>'decision', 'signer_name', v_prior->>'signer_name',
      'sealed_at', v_prior->>'sealed_at', 'id', v_prior->>'id');
  end if;
  if lower(coalesce(v_status, '')) not in ('submitted', 'pending', 'under_review', 'review') then
    return jsonb_build_object('ok', true, 'recorded', false,
      'decision', case lower(coalesce(v_status, '')) when 'approved' then 'approved'
                                                     when 'rejected' then 'declined'
                                                     else lower(coalesce(v_status, '')) end,
      'signer_name', null, 'sealed_at', null);
  end if;

  insert into public.change_order_approvals(
      portal_id, project_id, change_order_id, decision, signer_name, note, user_agent, send_stamp)
    values (p_portal_id, v_pid::text, btrim(p_change_order_id), p_decision,
            left(coalesce(nullif(btrim(p_signer_name), ''), 'Client'), 200),
            left(coalesce(p_note, ''), 2000),
            left(coalesce(p_user_agent, ''), 200),
            public.portal_co_send_stamp(v_ps))
    returning id into v_id;
  -- change_orders.status is deliberately NOT written here (see the header,
  -- item 3): the GC's reconciler flips it so the app's approval side effects
  -- run. The overlay already closes the CO from this row.
  return jsonb_build_object('ok', true, 'recorded', true, 'id', v_id);
end; $$;

create or replace function public.portal_submit_co_approval_signed(
  p_portal_id        text,
  p_access_token     text,
  p_change_order_id  text,
  p_decision         text,
  p_signer_name      text,
  p_note             text,
  p_user_agent       text,
  p_signature_data   text,
  p_signature_hash   text,
  p_consent_record   text,
  p_client_hash      text,
  p_consent_version  text,
  p_consent_accepted boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_pid          uuid;
  v_id           uuid;
  v_server_hash  text;
  v_now          timestamptz := now();
  v_audit        jsonb;
  v_ps           jsonb;
  v_status       text;
  v_prior        jsonb;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  if p_decision is null or p_decision not in ('approved', 'declined') then raise exception 'portal_denied'; end if;
  if p_change_order_id is null or length(btrim(p_change_order_id)) = 0 then raise exception 'portal_denied'; end if;
  select c.portal_state, c.status into v_ps, v_status from public.change_orders c
   where c.id::text = btrim(p_change_order_id) and c.project_id = v_pid
   for update;
  if not found then raise exception 'portal_denied'; end if;
  if not public.portal_state_is_shared(v_ps) then raise exception 'co_not_shared'; end if;

  -- Already decided for this send — on any device — or no longer in the
  -- owner's court: say what stands, record nothing (#71 / #132).
  v_prior := public.portal_co_decision_for_send(v_pid, p_change_order_id, v_ps);
  if v_prior is not null then
    return jsonb_build_object('ok', true, 'recorded', false,
      'decision', v_prior->>'decision', 'signer_name', v_prior->>'signer_name',
      'sealed_at', v_prior->>'sealed_at', 'id', v_prior->>'id',
      'document_hash', v_prior->>'document_hash');
  end if;
  if lower(coalesce(v_status, '')) not in ('submitted', 'pending', 'under_review', 'review') then
    return jsonb_build_object('ok', true, 'recorded', false,
      'decision', case lower(coalesce(v_status, '')) when 'approved' then 'approved'
                                                     when 'rejected' then 'declined'
                                                     else lower(coalesce(v_status, '')) end,
      'signer_name', null, 'sealed_at', null);
  end if;

  if p_decision = 'approved' then
    if coalesce(p_consent_accepted, false) is not true then raise exception 'esign_consent_required'; end if;
    if p_signature_data is null or length(btrim(p_signature_data)) = 0 then raise exception 'esign_signature_required'; end if;
    if p_signer_name is null or length(btrim(p_signer_name)) < 3 then raise exception 'esign_signer_name_required'; end if;
    if p_consent_record is null or length(btrim(p_consent_record)) = 0 then raise exception 'esign_record_required'; end if;
  else
    if p_note is null or length(btrim(p_note)) = 0 then raise exception 'decline_reason_required'; end if;
  end if;

  if p_consent_record is not null and length(p_consent_record) > 0 then
    v_server_hash := encode(digest(p_consent_record, 'sha256'), 'hex');
    if p_client_hash is not null and length(p_client_hash) = 64
       and lower(p_client_hash) <> lower(v_server_hash) then
      raise exception 'hash_mismatch';
    end if;
  end if;

  insert into public.change_order_approvals(
      portal_id, project_id, change_order_id, decision, signer_name, note, user_agent,
      signature_data, signature_hash, consent_record, document_hash,
      consent_version, consent_accepted, sealed_at, send_stamp)
    values (
      p_portal_id, v_pid::text, btrim(p_change_order_id), p_decision,
      left(coalesce(nullif(btrim(p_signer_name), ''), 'Client'), 200),
      left(coalesce(p_note, ''), 2000),
      left(coalesce(p_user_agent, ''), 200),
      left(coalesce(p_signature_data, ''), 200000),
      nullif(left(coalesce(p_signature_hash, ''), 64), ''),
      p_consent_record,
      v_server_hash,
      left(coalesce(p_consent_version, ''), 40),
      coalesce(p_consent_accepted, false),
      v_now,
      public.portal_co_send_stamp(v_ps))
    returning id into v_id;

  -- CONTRACT 7: the sealed action names are frozen.
  v_audit := jsonb_build_object(
    'id',        v_id::text,
    'action',    case when p_decision = 'approved' then 'client_signed_via_portal' else 'client_declined_via_portal' end,
    'actor',     left(coalesce(nullif(btrim(p_signer_name), ''), 'Client'), 200),
    'timestamp', to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'detail',    case
                   when p_decision = 'approved' then
                     'Electronically signed via the client portal (E-SIGN/UETA consent '
                     || coalesce(nullif(btrim(p_consent_version), ''), 'unversioned')
                     || ', record SHA-256 ' || coalesce(left(v_server_hash, 16), 'n/a') || '…).'
                   else
                     'Declined via the client portal. Reason: ' || left(coalesce(btrim(p_note), '(none given)'), 500)
                 end
  );

  -- The sealed audit entry only. change_orders.status stays pending for the
  -- GC's reconciler to flip (header, item 3); every device's overlay closes
  -- the CO from the approval row inserted above, in this same transaction.
  update public.change_orders
     set audit_trail = coalesce(audit_trail, '[]'::jsonb) || jsonb_build_array(v_audit),
         updated_at  = v_now
   where id::text = btrim(p_change_order_id)
     and project_id = v_pid;

  return jsonb_build_object(
    'ok', true,
    'recorded', true,
    'id', v_id,
    'document_hash', v_server_hash,
    'sealed_at', v_now
  );
end $$;

grant execute on function public.portal_submit_co_approval(
  text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.portal_submit_co_approval_signed(
  text, text, text, text, text, text, text, text, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.portal_sign_contract(text, uuid, text, text, text) to anon, authenticated;

-- ── 4. The live overlay ──────────────────────────────────────────────────────

create or replace function public.portal_overlay_live(p_pid uuid, p_snapshot jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_snap    jsonb := p_snapshot;
  v_secs    jsonb;
  v_out     jsonb;
  v_el      jsonb;
  v_opt     jsonb;
  v_opts    jsonb;
  v_found   boolean;
  -- invoice row
  v_paid    numeric;
  v_status  text;
  v_url     text;
  v_amt     numeric;
  v_ps      jsonb;
  v_ltype   text;
  v_num     integer;
  v_pend_at timestamptz;
  v_pend_amt numeric;
  -- figures
  v_snap_paid numeric;
  v_snap_bal  numeric;
  v_bal       numeric;
  v_total     numeric;
  v_dpaid     numeric := 0;
  v_dbal      numeric := 0;
  v_dinv      numeric := 0;
  v_dret      numeric := 0;
  v_settled   text[] := '{}';
  v_dropped   text[] := '{}';
  v_covered   text[] := '{}';   -- invoices a bank payment in flight covers
  v_picked    text[] := '{}';   -- selection categories with a live pick
  -- ownerDecisions: live balance per kept invoice id, and COs that have left
  -- the owner's court (decided on any device, signed, declined, voided).
  v_inv_bal   jsonb := '{}'::jsonb;
  v_co_closed text[] := '{}';
  v_decision  jsonb;
  v_paid_at   timestamptz;
  v_any       boolean;
  v_shared    boolean;
  -- contract
  v_contract  jsonb;
  v_c_id      uuid;
  v_c_status  text;
  v_c_value   numeric;
  v_c_title   text;
  v_c_sig     jsonb;
  v_c_signed_at timestamptz;
  v_c_open    boolean := false;
  v_c_same_block boolean := false;
  -- selections
  v_chosen    text;
  v_has_opts  boolean;
  v_opt_total numeric;
  v_cat_budget numeric;
  -- hero
  v_hero      text;
  v_hero_id   text;
  v_recalled  boolean;
  -- latest update
  v_sum       text;
  v_date      text;
  v_upd       timestamptz;
  v_label     text;
  v_tz        text;
  v_ts        timestamptz;
  v_day       date;
begin
  if v_snap is null or jsonb_typeof(v_snap) <> 'object' then return v_snap; end if;
  v_secs := v_snap->'sections';

  if v_secs is not null and jsonb_typeof(v_secs) = 'object' then

    -- Invoices ---------------------------------------------------------------
    if jsonb_typeof(v_secs->'invoices') = 'array' then
      v_out := '[]'::jsonb;
      for v_el in select value from jsonb_array_elements(v_secs->'invoices') loop
        if jsonb_typeof(v_el) <> 'object' then v_out := v_out || jsonb_build_array(v_el); continue; end if;
        v_found := false;
        -- pay_pending_* through to_jsonb(row): present once 20260920020000 is
        -- applied, null (never an error) before it.
        select coalesce(i.amount_paid, 0), i.status, i.pay_link_url, i.pay_link_amount, i.portal_state,
               public.portal_try_timestamptz(to_jsonb(i)->>'pay_pending_at'),
               case when (to_jsonb(i)->>'pay_pending_amount') ~ '^-?\d+(\.\d+)?$'
                    then (to_jsonb(i)->>'pay_pending_amount')::numeric end,
               true
          into v_paid, v_status, v_url, v_amt, v_ps, v_pend_at, v_pend_amt, v_found
          from public.invoices i
         where i.id::text = v_el->>'id' and i.project_id = p_pid;
        if not coalesce(v_found, false) then
          -- No live row to vouch for a link: never offer one. (Kept: a publish
          -- can outrun the insert queue.)
          v_out := v_out || jsonb_build_array(v_el - 'payLinkUrl' - 'paymentProcessing');
          continue;
        end if;
        v_found := false;
        v_total := case when jsonb_typeof(v_el->'total') = 'number' then (v_el->>'total')::numeric else null end;
        v_snap_bal := case when jsonb_typeof(v_el->'balance') = 'number' then (v_el->>'balance')::numeric else null end;
        v_snap_paid := case when jsonb_typeof(v_el->'amountPaid') = 'number' then (v_el->>'amountPaid')::numeric else null end;

        -- Recalled (by the owner or an editor, from any device): the card
        -- leaves, and so does its share of the budget bar's billed figures.
        -- Paid to date is over EVERY invoice, so money received on it still
        -- moves that leg.
        if not public.portal_state_is_shared(v_ps) then
          v_dropped := v_dropped || (v_el->>'id');
          if v_snap_paid is not null then v_dpaid := v_dpaid + (v_paid - v_snap_paid); end if;
          if coalesce(v_el->>'status', '') <> 'draft' then
            if v_snap_bal is not null then v_dbal := v_dbal - v_snap_bal; end if;
            if v_total is not null then v_dinv := v_dinv - v_total; end if;
            if jsonb_typeof(v_el->'retentionHeld') = 'number' then
              v_dret := v_dret - (v_el->>'retentionHeld')::numeric;
            end if;
          end if;
          continue;
        end if;

        if v_snap_bal is not null and v_snap_paid is not null then
          v_bal := greatest(0, round(v_snap_bal + v_snap_paid - v_paid, 2));
          v_dpaid := v_dpaid + (v_paid - v_snap_paid);
          v_dbal := v_dbal + (v_bal - v_snap_bal);
          v_el := v_el || jsonb_build_object('amountPaid', v_paid, 'balance', v_bal);
          if v_bal <= 0.01 and coalesce(v_total, 0) > 0 then
            v_el := v_el || jsonb_build_object('effectiveStatus', 'paid');
            v_settled := v_settled || (v_el->>'id');
          elsif v_paid > 0 then
            v_el := v_el || jsonb_build_object('effectiveStatus', 'partially_paid');
          elsif coalesce(v_el->>'effectiveStatus', '') in ('paid', 'partially_paid') then
            -- Money went BACK (a full refund, a lost dispute).
            v_el := v_el - 'effectiveStatus';
          end if;
        else
          v_bal := v_snap_bal;
        end if;
        if v_bal is not null then
          v_inv_bal := v_inv_bal || jsonb_build_object(v_el->>'id', v_bal);
        end if;
        if v_status is not null then
          if v_bal is not null and v_bal > 0.01 and v_paid <= 0
             and v_status in ('paid', 'partially_paid') then
            v_status := 'sent';
          end if;
          v_el := v_el || jsonb_build_object('status', v_status);
        end if;
        -- #83 / #135: a bank payment in flight (the dunning hold's 10 days).
        -- Stripe killed the single-use link when the session completed; the
        -- card says "processing" and offers no Pay button.
        if v_pend_at is not null and v_pend_at > now() - interval '10 days'
           and (v_bal is null or v_bal > 0.01) then
          v_el := (v_el - 'payLinkUrl') || jsonb_build_object('paymentProcessing', jsonb_build_object(
            'since', to_char(v_pend_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'amount', v_pend_amt));
          if v_pend_amt is null or v_bal is null or v_pend_amt >= v_bal - 0.01 then
            v_covered := v_covered || (v_el->>'id');
          end if;
        else
          v_el := v_el - 'paymentProcessing';
          -- MONEY-F2 on live figures: a link shows only while it was minted
          -- for exactly what is owed now, on a shared, non-draft invoice.
          if v_url is not null and v_amt is not null and v_bal is not null and v_bal > 0
             and abs(v_amt - v_bal) <= 0.01
             and coalesce(v_status, '') <> 'draft' then
            v_el := v_el || jsonb_build_object('payLinkUrl', v_url);
          else
            v_el := v_el - 'payLinkUrl';
          end if;
        end if;
        v_out := v_out || jsonb_build_array(v_el);
      end loop;
      if jsonb_array_length(v_out) = 0 then
        v_secs := v_secs - 'invoices';
      else
        v_secs := jsonb_set(v_secs, '{invoices}', v_out);
      end if;
    end if;

    -- The budget bar moves by exactly the money that moved (and loses what
    -- was recalled).
    if jsonb_typeof(v_secs->'budget') = 'object' then
      if v_dpaid <> 0 and jsonb_typeof(v_secs->'budget'->'paidToDate') = 'number' then
        v_secs := jsonb_set(v_secs, '{budget,paidToDate}',
          to_jsonb(round((v_secs->'budget'->>'paidToDate')::numeric + v_dpaid, 2)));
      end if;
      if v_dbal <> 0 and jsonb_typeof(v_secs->'budget'->'outstanding') = 'number' then
        v_secs := jsonb_set(v_secs, '{budget,outstanding}',
          to_jsonb(greatest(0, round((v_secs->'budget'->>'outstanding')::numeric + v_dbal, 2))));
      end if;
      if v_dinv <> 0 and jsonb_typeof(v_secs->'budget'->'invoicedToDate') = 'number' then
        v_secs := jsonb_set(v_secs, '{budget,invoicedToDate}',
          to_jsonb(greatest(0, round((v_secs->'budget'->>'invoicedToDate')::numeric + v_dinv, 2))));
      end if;
      if v_dret <> 0 and jsonb_typeof(v_secs->'budget'->'retentionHeld') = 'number' then
        v_secs := jsonb_set(v_secs, '{budget,retentionHeld}',
          to_jsonb(greatest(0, round((v_secs->'budget'->>'retentionHeld')::numeric + v_dret, 2))));
      end if;
    end if;

    -- AIA pay applications ---------------------------------------------------
    if jsonb_typeof(v_secs->'aiaPayApps') = 'array' then
      v_out := '[]'::jsonb;
      for v_el in select value from jsonb_array_elements(v_secs->'aiaPayApps') loop
        if jsonb_typeof(v_el) <> 'object' then v_out := v_out || jsonb_build_array(v_el); continue; end if;
        v_found := false;
        select a.paid_at, a.pay_link_url, a.portal_state,
               public.portal_try_timestamptz(to_jsonb(a)->>'pay_pending_at'),
               case when (to_jsonb(a)->>'pay_pending_amount') ~ '^-?\d+(\.\d+)?$'
                    then (to_jsonb(a)->>'pay_pending_amount')::numeric end,
               true
          into v_paid_at, v_url, v_ps, v_pend_at, v_pend_amt, v_found
          from public.aia_pay_apps a
         where a.id::text = v_el->>'id' and a.project_id = p_pid;
        if coalesce(v_found, false) and not public.portal_state_is_shared(v_ps) then
          v_dropped := v_dropped || (v_el->>'id');
          continue;
        end if;
        v_el := v_el - 'paymentProcessing';
        if coalesce(v_found, false) and v_paid_at is not null then
          v_el := (v_el - 'payLinkUrl')
            || jsonb_build_object('paidAt', to_char(v_paid_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
        elsif coalesce(v_found, false) and v_pend_at is not null and v_pend_at > now() - interval '10 days' then
          v_el := (v_el - 'payLinkUrl') || jsonb_build_object('paymentProcessing', jsonb_build_object(
            'since', to_char(v_pend_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'amount', v_pend_amt));
        elsif not coalesce(v_found, false)
           or v_url is null
           or v_url is distinct from (v_el->>'payLinkUrl')
           or (v_el->>'invoiceId') = any(v_settled) then
          v_el := v_el - 'payLinkUrl';
        end if;
        v_found := false;
        v_out := v_out || jsonb_build_array(v_el);
      end loop;
      if jsonb_array_length(v_out) = 0 then
        v_secs := v_secs - 'aiaPayApps';
      else
        v_secs := jsonb_set(v_secs, '{aiaPayApps}', v_out);
      end if;
    end if;

    -- Change orders ----------------------------------------------------------
    if jsonb_typeof(v_secs->'changeOrders') = 'array' then
      v_out := '[]'::jsonb;
      for v_el in select value from jsonb_array_elements(v_secs->'changeOrders') loop
        if jsonb_typeof(v_el) <> 'object' then continue; end if;
        v_found := false;
        select c.status, c.portal_state, true into v_status, v_ps, v_found
          from public.change_orders c
         where c.id::text = v_el->>'id' and c.project_id = p_pid;
        -- Deleted, or recalled / back to draft: gone from the portal (#44).
        if not coalesce(v_found, false) or not public.portal_state_is_shared(v_ps) then
          v_dropped := v_dropped || (v_el->>'id');
          v_found := false;
          continue;
        end if;
        v_found := false;
        -- A decision recorded for THIS send, on any device (#71 / #132): the
        -- CO is closed whatever change_orders.status says, and every device
        -- renders the same "signed by / declined by" state.
        v_decision := public.portal_co_decision_for_send(p_pid, v_el->>'id', v_ps);
        v_el := v_el - 'clientDecision';
        if v_decision is not null then
          v_co_closed := v_co_closed || (v_el->>'id');
          v_el := v_el || jsonb_build_object('clientDecision', jsonb_build_object(
            'decision', v_decision->>'decision',
            'signerName', v_decision->>'signer_name',
            'sealedAt', v_decision->>'sealed_at'));
          -- The live status wins once the GC has moved it on (voided it); a
          -- still-pending status reads as the decision.
          if lower(coalesce(v_status, '')) in ('', 'submitted', 'pending', 'under_review', 'review') then
            v_status := case when v_decision->>'decision' = 'approved' then 'approved' else 'rejected' end;
          end if;
        end if;
        if v_status is not null and length(v_status) > 0 then
          v_el := v_el || jsonb_build_object('status', v_status);
          -- utils/portalOwnerCore PENDING_CO_STATUSES
          if lower(v_status) not in ('submitted', 'pending', 'under_review', 'review') then
            v_co_closed := v_co_closed || (v_el->>'id');
          end if;
        end if;
        v_out := v_out || jsonb_build_array(v_el);
      end loop;
      if jsonb_array_length(v_out) = 0 then
        v_secs := v_secs - 'changeOrders';
      else
        v_secs := jsonb_set(v_secs, '{changeOrders}', v_out);
      end if;
    end if;

    -- Daily reports ----------------------------------------------------------
    if jsonb_typeof(v_secs->'dailyReports') = 'array' then
      v_out := '[]'::jsonb;
      for v_el in select value from jsonb_array_elements(v_secs->'dailyReports') loop
        if jsonb_typeof(v_el) <> 'object' then v_out := v_out || jsonb_build_array(v_el); continue; end if;
        v_found := false;
        select d.portal_state, true into v_ps, v_found
          from public.daily_reports d
         where d.id::text = v_el->>'id' and d.project_id = p_pid;
        if coalesce(v_found, false) and not public.portal_state_is_shared(v_ps) then
          v_found := false;
          continue;
        end if;
        v_found := false;
        v_out := v_out || jsonb_build_array(v_el);
      end loop;
      if jsonb_array_length(v_out) = 0 then
        v_secs := v_secs - 'dailyReports';
      else
        v_secs := jsonb_set(v_secs, '{dailyReports}', v_out);
      end if;
    end if;

    -- Photos -----------------------------------------------------------------
    -- Matched by id (by url for a snapshot built before photos carried one);
    -- dropped when a matching row exists and none is shared. #14: only an
    -- http(s) url survives — a file:// / blob: / data: value or a bare bucket
    -- path renders nowhere but the GC's phone. The page asks signed-media-urls
    -- for the id instead; an entry with neither an id nor an http url is gone.
    if jsonb_typeof(v_secs->'photos') = 'array' then
      v_out := '[]'::jsonb;
      for v_el in select value from jsonb_array_elements(v_secs->'photos') loop
        if jsonb_typeof(v_el) <> 'object' then continue; end if;
        if jsonb_typeof(v_el->'id') = 'string' then
          select count(*) > 0, coalesce(bool_or(public.portal_state_is_shared(ph.portal_state)), false)
            into v_any, v_shared
            from public.photos ph
           where ph.id::text = v_el->>'id' and ph.project_id = p_pid;
        else
          select count(*) > 0, coalesce(bool_or(public.portal_state_is_shared(ph.portal_state)), false)
            into v_any, v_shared
            from public.photos ph
           where ph.uri = v_el->>'url' and ph.project_id = p_pid;
        end if;
        if v_any and not v_shared then continue; end if;
        if coalesce(v_el->>'url', '') !~* '^https?://' then
          v_el := v_el - 'url';
        end if;
        -- (coalesce: jsonb_typeof of a missing key is NULL, and NULL <> 'string'
        -- would keep the entry.)
        if coalesce(jsonb_typeof(v_el->'id'), '') <> 'string' and not (v_el ? 'url') then continue; end if;
        v_out := v_out || jsonb_build_array(v_el);
      end loop;
      if jsonb_array_length(v_out) = 0 then
        v_secs := v_secs - 'photos';
      else
        v_secs := jsonb_set(v_secs, '{photos}', v_out);
      end if;
    end if;

    -- Punch list (no portal_state: the builder publishes open formal items) --
    if jsonb_typeof(v_secs->'punchList') = 'array' then
      v_out := '[]'::jsonb;
      for v_el in select value from jsonb_array_elements(v_secs->'punchList') loop
        if jsonb_typeof(v_el) <> 'object' then v_out := v_out || jsonb_build_array(v_el); continue; end if;
        v_found := false;
        select pi.status, pi.list_type, true into v_status, v_ltype, v_found
          from public.punch_items pi
         where pi.id::text = v_el->>'id' and pi.project_id = p_pid;
        if coalesce(v_found, false) then
          v_found := false;
          if coalesce(v_status, '') not in ('open', 'in_progress', 'ready_for_review')
             or coalesce(v_ltype, 'punch') <> 'punch' then
            continue;
          end if;
          v_el := v_el || jsonb_build_object('status', v_status);
        end if;
        v_out := v_out || jsonb_build_array(v_el);
      end loop;
      if jsonb_array_length(v_out) = 0 then
        v_secs := v_secs - 'punchList';
      else
        v_secs := jsonb_set(v_secs, '{punchList}', v_out);
      end if;
    end if;

    -- RFIs -------------------------------------------------------------------
    -- #28: the number is the SERVER's (rfis_assign_number renumbers a phone's
    -- guess), so a card frozen with the guess reads the live one.
    if jsonb_typeof(v_secs->'rfis') = 'array' then
      v_out := '[]'::jsonb;
      for v_el in select value from jsonb_array_elements(v_secs->'rfis') loop
        if jsonb_typeof(v_el) <> 'object' then v_out := v_out || jsonb_build_array(v_el); continue; end if;
        v_found := false;
        select r.status, r.portal_state, r.number, true into v_status, v_ps, v_num, v_found
          from public.rfis r
         where r.id::text = v_el->>'id' and r.project_id = p_pid;
        if coalesce(v_found, false) then
          v_found := false;
          if not public.portal_state_is_shared(v_ps) then continue; end if;
          if v_status is not null then v_el := v_el || jsonb_build_object('status', v_status); end if;
          if v_num is not null then v_el := v_el || jsonb_build_object('number', v_num); end if;
        end if;
        v_out := v_out || jsonb_build_array(v_el);
      end loop;
      if jsonb_array_length(v_out) = 0 then
        v_secs := v_secs - 'rfis';
      else
        v_secs := jsonb_set(v_secs, '{rfis}', v_out);
      end if;
    end if;

    v_snap := jsonb_set(v_snap, '{sections}', v_secs);
  end if;

  -- Selections (top level) ---------------------------------------------------
  -- Recalled categories leave; a live pick (portal_choose_selection writes
  -- selection_options, never the snapshot) sets options[].isChosen and the
  -- category's status, and the category leaves "waiting on you" (#13).
  if jsonb_typeof(v_snap->'selections') = 'array' then
    v_out := '[]'::jsonb;
    for v_el in select value from jsonb_array_elements(v_snap->'selections') loop
      if jsonb_typeof(v_el) <> 'object' then v_out := v_out || jsonb_build_array(v_el); continue; end if;
      v_found := false;
      select s.portal_state, coalesce(s.budget, 0), true into v_ps, v_cat_budget, v_found
        from public.selection_categories s
       where s.id::text = v_el->>'id' and s.project_id = p_pid;
      if coalesce(v_found, false) and not public.portal_state_is_shared(v_ps) then
        v_found := false;
        v_dropped := v_dropped || (v_el->>'id');
        continue;
      end if;
      if coalesce(v_found, false) then
        v_chosen := null;
        v_opt_total := null;
        select o.id::text, o.total into v_chosen, v_opt_total
          from public.selection_options o
         where o.category_id::text = v_el->>'id' and o.is_chosen
         order by o.chosen_at desc nulls last, o.created_at desc
         limit 1;
        select count(*) > 0 into v_has_opts
          from public.selection_options o
         where o.category_id::text = v_el->>'id';
        if v_has_opts and jsonb_typeof(v_el->'options') = 'array' then
          v_opts := '[]'::jsonb;
          for v_opt in select value from jsonb_array_elements(v_el->'options') loop
            if jsonb_typeof(v_opt) = 'object' then
              v_opt := v_opt || jsonb_build_object('isChosen', (v_opt->>'id') is not distinct from v_chosen);
            end if;
            v_opts := v_opts || jsonb_build_array(v_opt);
          end loop;
          v_el := jsonb_set(v_el, '{options}', v_opts);
        end if;
        if v_chosen is not null then
          v_picked := v_picked || (v_el->>'id');
          -- utils/selectionsEngine's rule: over a real budget reads 'exceeded'.
          v_el := v_el || jsonb_build_object('status',
            case when v_cat_budget > 0 and coalesce(v_opt_total, 0) > v_cat_budget
                 then 'exceeded' else 'chosen' end);
        elsif v_has_opts and coalesce(v_el->>'status', '') in ('chosen', 'exceeded') then
          -- The pick was cleared since the publish: open again.
          v_el := v_el || jsonb_build_object('status', 'browsing');
        end if;
      end if;
      v_found := false;
      v_out := v_out || jsonb_build_array(v_el);
    end loop;
    v_snap := jsonb_set(v_snap, '{selections}', v_out);
  end if;

  -- Contract (#13, #65, carry #12) ---------------------------------------------
  -- The job's ACTIVE contract: not superseded and not void — the one live row
  -- project_contracts_one_live_per_project (20260918200000) allows. (The app's
  -- loadActiveContract may land on a void row first; the builder then
  -- publishes nothing, which is what "no live row" gives here too.)
  select pc.id, pc.status, pc.contract_value, pc.title, pc.homeowner_signature, pc.signed_at
    into v_c_id, v_c_status, v_c_value, v_c_title, v_c_sig, v_c_signed_at
    from public.project_contracts pc
   where pc.project_id = p_pid and pc.superseded_by is null and pc.status <> 'void'
   order by pc.version desc, pc.created_at desc
   limit 1;
  if v_c_id is null or coalesce(v_c_status, '') not in ('sent', 'signed') then
    -- Draft, void or none: nothing to review or sign.
    v_snap := v_snap - 'contract';
  else
    v_c_same_block := jsonb_typeof(v_snap->'contract') = 'object'
                      and (v_snap->'contract'->>'id') = v_c_id::text;
    if v_c_same_block then
      v_contract := v_snap->'contract';
    else
      -- No block, or one for another contract: its content is not this
      -- contract's terms.
      v_contract := '{}'::jsonb;
    end if;
    if v_c_sig is not null and jsonb_typeof(v_c_sig) = 'object'
       and length(btrim(coalesce(v_c_sig->>'name', ''))) > 0 then
      v_c_status := 'signed';
    end if;
    v_c_open := v_c_status = 'sent';
    v_contract := v_contract
      - 'evidencePath' - 'signaturePaths' - 'homeownerSignature'
      - 'homeownerSignerName' - 'homeownerSignedAt' - 'homeownerSignatureMethod'
      || jsonb_build_object(
           'id', v_c_id::text,
           'status', v_c_status,
           'contractValue', coalesce(v_c_value, 0),
           'title', coalesce(v_c_title, 'Construction Agreement'),
           'needsSignature', v_c_open);
    if v_c_status = 'signed' then
      -- Only these three facts leave the signature object — never its
      -- evidencePath (a private secure-contracts path) or drawn strokes.
      v_contract := v_contract || jsonb_strip_nulls(jsonb_build_object(
        'homeownerSignerName', nullif(btrim(coalesce(v_c_sig->>'name', '')), ''),
        'homeownerSignedAt', coalesce(
          to_char(v_c_signed_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          v_c_sig->>'signedAt'),
        'homeownerSignatureMethod', case when (v_c_sig->>'method') in ('portal', 'in_person', 'paper')
                                         then v_c_sig->>'method' end));
    end if;
    if v_c_same_block then
      -- The device published this contract: never pending, whatever shape the
      -- terms take (a `content` object or flat keys) — the page decides
      -- whether they are there.
      v_contract := v_contract - 'contentPending';
    else
      -- No block for this contract: the page shows it but no sign box until
      -- the GC's device publishes the terms, so it is not yet "waiting on
      -- you" either.
      -- needsSignature goes false WITH it (integration round 1): it was built
      -- above while v_c_open still read 'sent', and a page that draws the
      -- Sign box on status 'sent' + needsSignature (the ab5bab13 page still
      -- in browsers during the deploy) would offer to sign terms nobody has
      -- seen. portal_sign_contract refuses that case too.
      v_contract := v_contract || jsonb_build_object('contentPending', true, 'needsSignature', false);
      v_c_open := false;
    end if;
    v_snap := v_snap || jsonb_build_object('contract', v_contract);
  end if;

  -- What's waiting on the owner: never a decision on something withdrawn,
  -- paid, covered by a bank payment in flight, picked, decided on another
  -- device, or a contract that no longer needs a signature — and an invoice
  -- decision's amount is the LIVE balance. Order is kept (the builder's rank).
  if jsonb_typeof(v_snap->'ownerDecisions') = 'array' then
    select coalesce(jsonb_agg(
             case when jsonb_typeof(e.value) = 'object'
                   and coalesce(e.value->>'kind', '') = 'invoice'
                   and jsonb_typeof(v_inv_bal->(e.value->>'id')) = 'number'
                  then e.value || jsonb_build_object('amount', v_inv_bal->(e.value->>'id'))
                  else e.value end
             order by e.ord), '[]'::jsonb) into v_out
      from jsonb_array_elements(v_snap->'ownerDecisions') with ordinality as e(value, ord)
     where not (coalesce(e.value->>'id', '') = any(v_dropped))
       and not (coalesce(e.value->>'kind', '') = 'invoice' and coalesce(e.value->>'id', '') = any(v_settled))
       and not (coalesce(e.value->>'kind', '') = 'invoice' and coalesce(e.value->>'id', '') = any(v_covered))
       and not (coalesce(e.value->>'kind', '') = 'invoice'
                and jsonb_typeof(v_inv_bal->(e.value->>'id')) = 'number'
                and (v_inv_bal->>(e.value->>'id'))::numeric <= 0.01)
       and not (coalesce(e.value->>'kind', '') = 'change_order' and coalesce(e.value->>'id', '') = any(v_co_closed))
       and not (coalesce(e.value->>'kind', '') = 'selection' and coalesce(e.value->>'id', '') = any(v_picked))
       and not (coalesce(e.value->>'kind', '') = 'contract' and not v_c_open);
    v_snap := jsonb_set(v_snap, '{ownerDecisions}', v_out);
  end if;

  -- The hero image (#14) -------------------------------------------------------
  -- Matched by heroPhotoId; a snapshot from before it by uri. Recalled (a
  -- matching row, none shared) — or a legacy hero that is not an http(s) url —
  -- falls back to the newest shared photo, which is sections.photos[0] (the
  -- builder's hero is that list's first entry).
  if jsonb_typeof(v_snap->'project') = 'object' then
    v_hero_id := case when jsonb_typeof(v_snap->'project'->'heroPhotoId') = 'string'
                      then v_snap->'project'->>'heroPhotoId' end;
    v_hero := case when jsonb_typeof(v_snap->'project'->'heroPhotoUrl') = 'string'
                   then v_snap->'project'->>'heroPhotoUrl' end;
    v_recalled := false;
    if v_hero_id is not null then
      select count(*) > 0, coalesce(bool_or(public.portal_state_is_shared(ph.portal_state)), false)
        into v_any, v_shared
        from public.photos ph
       where ph.id::text = v_hero_id and ph.project_id = p_pid;
      v_recalled := v_any and not v_shared;
    elsif v_hero is not null then
      select count(*) > 0, coalesce(bool_or(public.portal_state_is_shared(ph.portal_state)), false)
        into v_any, v_shared
        from public.photos ph
       where ph.uri = v_hero and ph.project_id = p_pid;
      v_recalled := (v_any and not v_shared) or v_hero !~* '^https?://';
    end if;
    if v_recalled then
      v_hero_id := case when jsonb_typeof(v_snap->'sections'->'photos'->0->'id') = 'string'
                        then v_snap->'sections'->'photos'->0->>'id' end;
      v_hero := case when coalesce(v_snap->'sections'->'photos'->0->>'url', '') ~* '^https?://'
                     then v_snap->'sections'->'photos'->0->>'url' end;
    elsif coalesce(v_hero, '') !~* '^https?://' then
      v_hero := null;
    end if;
    v_snap := jsonb_set(v_snap, '{project}',
      ((v_snap->'project') - 'heroPhotoId' - 'heroPhotoUrl')
      || case when v_hero_id is not null then jsonb_build_object('heroPhotoId', v_hero_id) else '{}'::jsonb end
      || case when v_hero is not null then jsonb_build_object('heroPhotoUrl', v_hero) else '{}'::jsonb end);
  end if;

  -- The newest PUBLISHED homeowner update (#20) --------------------------------
  -- By the full instant (a bare day is its noon — dayOrInstantDate), never
  -- the UTC day; labelled in the owner's zone.
  v_tz := public.portal_safe_time_zone(v_snap->>'timeZone');
  select d.homeowner_summary, d.date, d.updated_at
    into v_sum, v_date, v_upd
    from public.daily_reports d
   where d.project_id = p_pid
     and coalesce(d.homeowner_summary_published, false)
     and length(btrim(coalesce(d.homeowner_summary, ''))) > 0
   order by public.portal_try_timestamptz(d.date) desc nulls last, d.updated_at desc nulls last
   limit 1;
  if v_sum is null then
    v_snap := v_snap - 'latestUpdate';
  else
    v_ts := public.portal_try_timestamptz(v_date);
    v_day := null;
    if btrim(coalesce(v_date, '')) ~ '^\d{4}-\d{2}-\d{2}$' and v_ts is not null then
      v_day := btrim(v_date)::date;
    elsif v_ts is not null then
      v_day := (v_ts at time zone v_tz)::date;
    end if;
    if (v_snap->'latestUpdate'->>'summary') is not distinct from v_sum
       and jsonb_typeof(v_snap->'latestUpdate'->'dateLabel') = 'string' then
      -- The owner's device labelled it in his language and zone.
      v_label := v_snap->'latestUpdate'->>'dateLabel';
    elsif v_day is not null then
      v_label := to_char(v_day, 'FMDay, FMMonth FMDD');
    else
      v_label := v_date;
    end if;
    v_snap := v_snap || jsonb_build_object('latestUpdate', jsonb_strip_nulls(jsonb_build_object(
      'dateLabel', v_label,
      'day', to_char(v_day, 'YYYY-MM-DD'),
      'summary', v_sum,
      'publishedAt', coalesce(to_char(v_upd at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), v_date)
    )));
  end if;

  return v_snap;
end $$;

revoke all on function public.portal_overlay_live(uuid, jsonb) from public, anon, authenticated;
