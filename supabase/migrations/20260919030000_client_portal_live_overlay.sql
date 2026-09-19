-- 20260919030000_client_portal_live_overlay.sql — wave 3, lane client-portal
-- (#23, #40, #44, #48)
--
-- FOUR THINGS, all about the homeowner portal reading something other than
-- the truth.
--
-- 1. co_append_audit(p_co_id, p_entries) — #40. change_orders.audit_trail was
--    written WHOLE from the GC's device on every updateChangeOrder, so the
--    sealed e-signature entry portal_submit_co_approval_signed appends on the
--    server was erased by the next edit from a session loaded before the
--    signature (the portal reconciler did it within 90 seconds, every time).
--    This appends only entries whose id is not already in the trail, in one
--    UPDATE, so nothing the server holds can be lost. SECURITY DEFINER with
--    the same owner rule as change_orders' own policies (user_id = auth.uid()).
--    The app switches to it in ProjectContext (context-money-portal handoff).
--
-- 2. portal_submit_co_approval(_signed) — #44. Both inserted an approval (and
--    the signed one sealed a signature onto the CO) for ANY change-order id
--    the caller sent, including one the GC had RECALLED or never sent — a
--    stale snapshot or an old #d= link kept a withdrawn CO signable. Now:
--      - the CO must belong to the token's project (the held migration's
--        Section 3 check, brought forward — flat portal_denied), and
--      - its portal_state must be absent/null or 'sent' — the app's
--        isShared() rule — else 'co_not_shared', which the portal page words
--        as "withdrawn by your builder".
--    Read-only production check 2026-09-18: 0 approvals total, 0 orphan
--    approvals, 0 approvals on unshared COs, 0 sealed approvals missing from
--    their CO's trail — nothing is rejected retroactively and no repair of
--    past trails is needed. (Should one ever be needed: every sealed entry is
--    rebuildable from change_order_approvals — id, signer_name, sealed_at,
--    document_hash.)
--    NOTE FOR THE HELD MIGRATION: held/20260913120000 Section 3 CREATE OR
--    REPLACEs these same two functions WITHOUT the co_not_shared clause.
--    Before it is applied, its two bodies must gain the portal_state check
--    below, or applying it silently re-opens #44.
--
-- 3. portal_overlay_live(p_pid, p_snapshot) — #48 and #23. The portal is a
--    snapshot the GC's app republishes, so after a Stripe payment the
--    homeowner kept seeing "Balance due" and a Pay button that lands on
--    Stripe's "already used" page until the GC next opened the project — and
--    a collaborator's device can never republish at all (portal_snapshots is
--    owner-only). The READ path now lays the live rows over the stored
--    snapshot, so the page is right even if nobody opens the app:
--      invoices     amountPaid / status live; balance moved by exactly the
--                   money received since the build (the app's balance is
--                   linear in amountPaid — utils/invoiceBilling.netBalanceDue);
--                   effectiveStatus paid / partially_paid from that; the Pay
--                   link only while the LIVE link was minted for exactly the
--                   live balance (the app's MONEY-F2 gate). budget
--                   paidToDate / outstanding move by the same deltas.
--      aiaPayApps   paid_at live; the Pay link only while the live row still
--                   carries that link, it is unpaid, and its invoice is not
--                   settled.
--      changeOrders status live; a CO the GC recalled (portal_state not sent)
--                   or deleted is dropped — the portal never offers a
--                   signature on it.
--      latestUpdate the newest PUBLISHED homeowner summary from daily_reports
--                   (#23 field seats: an editor's published update reaches
--                   the portal without the owner's device). dateLabel keeps
--                   the app's localized label when the summary is unchanged,
--                   else an English "Friday, April 26".
--    RECALL IS LIVE, whoever made it (integration critic money-portal, round
--    1). An accepted editor may send and recall (projectContextPure.
--    portalWriteRefusal), but only the OWNER's device republishes, and only
--    for writes made on that device — so a recall from the foreman's phone
--    used to sit on the homeowner's page until the GC happened to edit that
--    job. One rule now covers every portal_state-bearing section: a snapshot
--    element whose LIVE row carries a portal_state that is not null / 'sent'
--    (the app's isShared) is dropped on read —
--      invoices (and their share of the budget bar), aiaPayApps,
--      changeOrders, dailyReports, photos (by id; by uri for a snapshot built
--      before photos carried an id — and the hero photo with them), rfis,
--      selections; and ownerDecisions whose item was dropped or settled,
--      or whose CO is no longer pending — an invoice decision carries the
--      live balance.
--    punchList has no portal_state: an item closed live (or moved to the crew
--    list) leaves, and its status is read live.
--    WHAT IT GIVES UP: an element with NO live row is kept (the CO section
--    excepted, as before) — a publish can outrun the insert queue, and
--    hiding a just-sent report is worse than showing a deleted one until the
--    owner's next publish. And a NEWLY sent item still waits for the owner's
--    publish (the overlay can only take away; it never builds a card) — the
--    editor's send toast says so.
--    Because the overlay reads live rows, a stale app copy that republishes
--    older pay-link state is corrected on every read (#48 sharpening 2).
--    Not exposed: execute is revoked from every client role; only the two
--    SECURITY DEFINER getters call it.
--
-- Idempotent: every statement is CREATE OR REPLACE / GRANT / REVOKE. Safe to
-- run twice. No table or column is added. Deploy any time before or after the
-- OTA — the app reads nothing new from it; co_append_audit is only called once
-- the context-money-portal change ships (deploy this first).

-- ── 1. co_append_audit ───────────────────────────────────────────────────────

create or replace function public.co_append_audit(p_co_id uuid, p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trail jsonb;
  v_new jsonb := '[]'::jsonb;
  v_ids text[];
  v_el jsonb;
begin
  if auth.uid() is null then raise exception 'co_denied' using errcode = '42501'; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'co_audit_bad_entries' using errcode = '22023';
  end if;
  if jsonb_array_length(p_entries) > 50 then
    raise exception 'co_audit_too_many' using errcode = '22023';
  end if;

  -- Row lock: two appends for one CO serialize, so neither misses the other.
  select coalesce(c.audit_trail, '[]'::jsonb) into v_trail
    from public.change_orders c
   where c.id = p_co_id and c.user_id = auth.uid()
   for update;
  if not found then raise exception 'co_denied' using errcode = '42501'; end if;
  if jsonb_typeof(v_trail) <> 'array' then v_trail := '[]'::jsonb; end if;

  select coalesce(array_agg(e->>'id'), '{}') into v_ids
    from jsonb_array_elements(v_trail) e
   where jsonb_typeof(e) = 'object';

  for v_el in select value from jsonb_array_elements(p_entries) loop
    -- Only well-formed entries (an object with a non-empty string id), each
    -- id once — already in the trail, or earlier in this same batch, is skipped.
    if jsonb_typeof(v_el) = 'object'
       and jsonb_typeof(v_el->'id') = 'string'
       and length(btrim(v_el->>'id')) > 0
       and not ((v_el->>'id') = any(v_ids)) then
      v_new := v_new || jsonb_build_array(v_el);
      v_ids := v_ids || (v_el->>'id');
    end if;
  end loop;

  if jsonb_array_length(v_new) > 0 then
    update public.change_orders
       set audit_trail = v_trail || v_new,
           updated_at = now()
     where id = p_co_id;
  end if;
  return jsonb_build_object('ok', true, 'appended', jsonb_array_length(v_new));
end $$;

revoke all on function public.co_append_audit(uuid, jsonb) from public, anon;
grant execute on function public.co_append_audit(uuid, jsonb) to authenticated;

-- ── 2. The CO approval RPCs refuse a CO that is not this portal's, or not shared ──

create or replace function public.portal_submit_co_approval(
  p_portal_id text, p_access_token text, p_change_order_id text,
  p_decision text, p_signer_name text, p_note text, p_user_agent text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pid uuid; v_id uuid; v_ps jsonb;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  if p_decision is null or p_decision not in ('approved', 'declined') then raise exception 'portal_denied'; end if;
  if p_change_order_id is null or length(btrim(p_change_order_id)) = 0 then raise exception 'portal_denied'; end if;
  -- The change order must be THIS project's (flat portal_denied: whether a
  -- uuid exists elsewhere is not something a link-holder gets to probe) ...
  select c.portal_state into v_ps from public.change_orders c
   where c.id::text = btrim(p_change_order_id) and c.project_id = v_pid;
  if not found then raise exception 'portal_denied'; end if;
  -- ... and still SHARED — the app's isShared(): no state, or 'sent'.
  if v_ps is not null and jsonb_typeof(v_ps) <> 'null'
     and coalesce(v_ps->>'status', '') <> 'sent' then
    raise exception 'co_not_shared';
  end if;
  insert into public.change_order_approvals(
      portal_id, project_id, change_order_id, decision, signer_name, note, user_agent)
    values (p_portal_id, v_pid::text, btrim(p_change_order_id), p_decision,
            left(coalesce(nullif(btrim(p_signer_name), ''), 'Client'), 200),
            left(coalesce(p_note, ''), 2000),
            left(coalesce(p_user_agent, ''), 200))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
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
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  if p_decision is null or p_decision not in ('approved', 'declined') then raise exception 'portal_denied'; end if;
  if p_change_order_id is null or length(btrim(p_change_order_id)) = 0 then raise exception 'portal_denied'; end if;
  select c.portal_state into v_ps from public.change_orders c
   where c.id::text = btrim(p_change_order_id) and c.project_id = v_pid;
  if not found then raise exception 'portal_denied'; end if;
  if v_ps is not null and jsonb_typeof(v_ps) <> 'null'
     and coalesce(v_ps->>'status', '') <> 'sent' then
    raise exception 'co_not_shared';
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
      consent_version, consent_accepted, sealed_at)
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
      v_now)
    returning id into v_id;

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

  update public.change_orders
     set audit_trail = coalesce(audit_trail, '[]'::jsonb) || jsonb_build_array(v_audit),
         updated_at  = v_now
   where id::text = btrim(p_change_order_id)
     and project_id = v_pid;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'document_hash', v_server_hash,
    'sealed_at', v_now
  );
end $$;

grant execute on function public.portal_submit_co_approval(
  text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.portal_submit_co_approval_signed(
  text, text, text, text, text, text, text, text, text, text, text, text, boolean) to anon, authenticated;

-- ── 3. The live overlay on the portal's read path ─────────────────────────────

-- The app's isShared(): no portal_state, or status 'sent'. One definition for
-- every section below (and nothing else may call it).
create or replace function public.portal_state_is_shared(p_ps jsonb)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select p_ps is null or jsonb_typeof(p_ps) = 'null' or coalesce(p_ps->>'status', '') = 'sent'
$$;

revoke all on function public.portal_state_is_shared(jsonb) from public, anon, authenticated;

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
  v_found   boolean;
  -- invoice row
  v_paid    numeric;
  v_status  text;
  v_url     text;
  v_amt     numeric;
  v_ps      jsonb;
  v_ltype   text;
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
  -- ownerDecisions: live balance per kept invoice id, and COs whose live
  -- status has left the owner's court (signed, declined, voided).
  v_inv_bal   jsonb := '{}'::jsonb;
  v_co_closed text[] := '{}';
  v_paid_at   timestamptz;
  v_any       boolean;
  v_shared    boolean;
  -- latest update
  v_sum       text;
  v_date      text;
  v_upd       timestamptz;
  v_label     text;
  v_hero      text;
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
        select coalesce(i.amount_paid, 0), i.status, i.pay_link_url, i.pay_link_amount, i.portal_state, true
          into v_paid, v_status, v_url, v_amt, v_ps, v_found
          from public.invoices i
         where i.id::text = v_el->>'id' and i.project_id = p_pid;
        if not coalesce(v_found, false) then
          -- No live row to vouch for a link: never offer one. (Kept: a publish
          -- can outrun the insert queue — see the header.)
          v_out := v_out || jsonb_build_array(v_el - 'payLinkUrl');
          continue;
        end if;
        v_found := false;
        v_total := case when jsonb_typeof(v_el->'total') = 'number' then (v_el->>'total')::numeric else null end;
        v_snap_bal := case when jsonb_typeof(v_el->'balance') = 'number' then (v_el->>'balance')::numeric else null end;
        v_snap_paid := case when jsonb_typeof(v_el->'amountPaid') = 'number' then (v_el->>'amountPaid')::numeric else null end;

        -- Recalled (by the owner or an editor, from any device): the card
        -- leaves, and so does its share of the budget bar's billed figures —
        -- the builder's billedInvoices is isShared() and not draft. Paid to
        -- date is over EVERY invoice (getPaidToDate), so money received on
        -- it still moves that leg.
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
            -- Money went BACK (a full refund, a lost dispute): the snapshot's
            -- "Paid" pill no longer describes a card with a reopened balance.
            -- The portal falls back to the live stored status.
            v_el := v_el - 'effectiveStatus';
          end if;
        else
          v_bal := v_snap_bal;
        end if;
        if v_bal is not null then
          v_inv_bal := v_inv_bal || jsonb_build_object(v_el->>'id', v_bal);
        end if;
        if v_status is not null then
          -- A reopened balance never reads as the stored word 'paid'.
          if v_bal is not null and v_bal > 0.01 and v_paid <= 0
             and v_status in ('paid', 'partially_paid') then
            v_status := 'sent';
          end if;
          v_el := v_el || jsonb_build_object('status', v_status);
        end if;
        -- MONEY-F2 on live figures: a link shows only while it was minted for
        -- exactly what is owed now, on a shared, non-draft invoice.
        if v_url is not null and v_amt is not null and v_bal is not null and v_bal > 0
           and abs(v_amt - v_bal) <= 0.01
           and coalesce(v_status, '') <> 'draft' then
          v_el := v_el || jsonb_build_object('payLinkUrl', v_url);
        else
          v_el := v_el - 'payLinkUrl';
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
        select a.paid_at, a.pay_link_url, a.portal_state, true into v_paid_at, v_url, v_ps, v_found
          from public.aia_pay_apps a
         where a.id::text = v_el->>'id' and a.project_id = p_pid;
        if coalesce(v_found, false) and not public.portal_state_is_shared(v_ps) then
          v_dropped := v_dropped || (v_el->>'id');
          continue;
        end if;
        if coalesce(v_found, false) and v_paid_at is not null then
          v_el := (v_el - 'payLinkUrl')
            || jsonb_build_object('paidAt', to_char(v_paid_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
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
        if v_status is not null then
          v_el := v_el || jsonb_build_object('status', v_status);
          -- The same set as utils/portalOwnerCore PENDING_CO_STATUSES: once
          -- the homeowner signed / declined or the GC voided it, the CO card
          -- stays (with its live status) but it is no longer a decision.
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
    -- Matched by id; a snapshot built before photos carried one is matched by
    -- its url (the builder reads the stored uri LIVE — portalLiveOverrides).
    -- Dropped only when a matching row exists and none of them is shared.
    if jsonb_typeof(v_secs->'photos') = 'array' then
      v_out := '[]'::jsonb;
      for v_el in select value from jsonb_array_elements(v_secs->'photos') loop
        if jsonb_typeof(v_el) <> 'object' then v_out := v_out || jsonb_build_array(v_el); continue; end if;
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
    if jsonb_typeof(v_secs->'rfis') = 'array' then
      v_out := '[]'::jsonb;
      for v_el in select value from jsonb_array_elements(v_secs->'rfis') loop
        if jsonb_typeof(v_el) <> 'object' then v_out := v_out || jsonb_build_array(v_el); continue; end if;
        v_found := false;
        select r.status, r.portal_state, true into v_status, v_ps, v_found
          from public.rfis r
         where r.id::text = v_el->>'id' and r.project_id = p_pid;
        if coalesce(v_found, false) then
          v_found := false;
          if not public.portal_state_is_shared(v_ps) then continue; end if;
          if v_status is not null then v_el := v_el || jsonb_build_object('status', v_status); end if;
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
  if jsonb_typeof(v_snap->'selections') = 'array' then
    v_out := '[]'::jsonb;
    for v_el in select value from jsonb_array_elements(v_snap->'selections') loop
      if jsonb_typeof(v_el) <> 'object' then v_out := v_out || jsonb_build_array(v_el); continue; end if;
      v_found := false;
      select s.portal_state, true into v_ps, v_found
        from public.selection_categories s
       where s.id::text = v_el->>'id' and s.project_id = p_pid;
      if coalesce(v_found, false) and not public.portal_state_is_shared(v_ps) then
        v_found := false;
        v_dropped := v_dropped || (v_el->>'id');
        continue;
      end if;
      v_found := false;
      v_out := v_out || jsonb_build_array(v_el);
    end loop;
    v_snap := jsonb_set(v_snap, '{selections}', v_out);
  end if;

  -- What's waiting on the owner: never a decision on something withdrawn,
  -- never "pay invoice N" once it is paid, never "sign CO N" once it is
  -- signed / declined / voided — and an invoice decision's amount is the LIVE
  -- balance, the same figure its card now shows. This list is the portal's
  -- headline card ("What's waiting on you"), built at publish time from the
  -- same rows the passes above correct. Decision ids are the item ids
  -- (utils/portalOwnerCore.buildOwnerDecisions). Order is kept: the builder's
  -- rank is severity + kind, neither of which a payment changes.
  if jsonb_typeof(v_snap->'ownerDecisions') = 'array'
     and (cardinality(v_dropped) > 0 or cardinality(v_settled) > 0
          or cardinality(v_co_closed) > 0 or v_inv_bal <> '{}'::jsonb) then
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
       and not (coalesce(e.value->>'kind', '') = 'invoice'
                and jsonb_typeof(v_inv_bal->(e.value->>'id')) = 'number'
                and (v_inv_bal->>(e.value->>'id'))::numeric <= 0.01)
       and not (coalesce(e.value->>'kind', '') = 'change_order' and coalesce(e.value->>'id', '') = any(v_co_closed));
    v_snap := jsonb_set(v_snap, '{ownerDecisions}', v_out);
  end if;

  -- The hero image is the newest shared photo: never one recalled since.
  v_hero := v_snap->'project'->>'heroPhotoUrl';
  if v_hero is not null then
    select count(*) > 0, coalesce(bool_or(public.portal_state_is_shared(ph.portal_state)), false)
      into v_any, v_shared
      from public.photos ph
     where ph.uri = v_hero and ph.project_id = p_pid;
    if v_any and not v_shared then
      if jsonb_typeof(v_snap->'sections'->'photos') = 'array'
         and jsonb_typeof(v_snap->'sections'->'photos'->0->'url') = 'string'
         and length(v_snap->'sections'->'photos'->0->>'url') > 0 then
        v_snap := jsonb_set(v_snap, '{project,heroPhotoUrl}', v_snap->'sections'->'photos'->0->'url');
      else
        v_snap := jsonb_set(v_snap, '{project}', (v_snap->'project') - 'heroPhotoUrl');
      end if;
    end if;
  end if;

  -- The newest PUBLISHED homeowner update --------------------------------------
  select d.homeowner_summary, d.date, d.updated_at
    into v_sum, v_date, v_upd
    from public.daily_reports d
   where d.project_id = p_pid
     and coalesce(d.homeowner_summary_published, false)
     and length(btrim(coalesce(d.homeowner_summary, ''))) > 0
   order by left(d.date, 10) desc, d.updated_at desc nulls last
   limit 1;
  if v_sum is null then
    v_snap := v_snap - 'latestUpdate';
  else
    if (v_snap->'latestUpdate'->>'summary') is not distinct from v_sum
       and jsonb_typeof(v_snap->'latestUpdate'->'dateLabel') = 'string' then
      v_label := v_snap->'latestUpdate'->>'dateLabel';
    elsif left(v_date, 10) ~ '^\d{4}-\d{2}-\d{2}$' then
      begin
        v_label := to_char(left(v_date, 10)::date, 'FMDay, FMMonth FMDD');
      exception when others then
        v_label := v_date;
      end;
    else
      v_label := v_date;
    end if;
    v_snap := v_snap || jsonb_build_object('latestUpdate', jsonb_build_object(
      'dateLabel', v_label,
      'summary', v_sum,
      'publishedAt', coalesce(to_char(v_upd at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), v_date)
    ));
  end if;

  return v_snap;
end $$;

revoke all on function public.portal_overlay_live(uuid, jsonb) from public, anon, authenticated;

create or replace function public.portal_get_snapshot_v2(p_portal_id text, p_access_token text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_pid uuid;
  v_snapshot jsonb;
  v_expires_at timestamptz;
  v_found boolean := false;
begin
  v_pid := public.portal_project_for_token_any(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  select ps.snapshot, ps.expires_at, true
    into v_snapshot, v_expires_at, v_found
    from public.portal_snapshots ps
   where ps.portal_id = p_portal_id
   limit 1;
  if not v_found then
    return jsonb_build_object('status', 'not_published');
  end if;
  if v_expires_at is not null and v_expires_at <= now() then
    return jsonb_build_object('status', 'expired', 'expiresAt', v_expires_at);
  end if;
  return jsonb_build_object(
    'status', 'ok',
    'snapshot', public.portal_overlay_live(v_pid, v_snapshot),
    'expiresAt', v_expires_at
  );
end; $$;

create or replace function public.portal_get_snapshot(p_portal_id text, p_access_token text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare v_pid uuid;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  return public.portal_overlay_live(v_pid,
    (select snapshot from public.portal_snapshots where portal_id = p_portal_id limit 1));
end; $$;

grant execute on function public.portal_get_snapshot_v2(text, text) to anon, authenticated;
grant execute on function public.portal_get_snapshot(text, text) to anon, authenticated;
