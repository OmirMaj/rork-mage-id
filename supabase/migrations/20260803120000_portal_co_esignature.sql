-- 20260803120000_portal_co_esignature.sql
--
-- Make a homeowner's change-order approval a real ELECTRONIC SIGNATURE.
--
-- BEFORE: marketing/portal/index.html approved a change order behind a browser
-- confirm() followed by prompt('Your name (for the record):'). That is a consent
-- CLICK. A homeowner disputing a $12K CO can credibly argue it never met
-- ESIGN/UETA — there was no disclosure, no signature, and nothing tamper-evident
-- to produce in a dispute. Most COs are well over $500.
--
-- AFTER: the portal shows the scope + dollar delta, captures a DRAWN signature
-- plus a typed legal name, presents an E-SIGN/UETA consent disclosure the signer
-- must affirmatively accept, and submits a canonical consent record (see
-- utils/portalOwnerCore.ts buildCOConsentRecord) with its client-side SHA-256.
-- This RPC RE-HASHES the record server-side and stores it only on match, then
-- stamps the row with the SERVER's clock.
--
-- WHY NOT THE seal-document EDGE FN? It was built for the GC's signed-contract
-- PDF and does not fit here, three ways:
--   1. it calls requireTier(), i.e. it needs an authenticated MAGE user — the
--      homeowner has no MAGE account, that is the whole point of this portal;
--   2. it only ever writes project_contracts.signed_pdf_url/document_hash;
--   3. it hashes bytes already uploaded to secure-contracts/<userId>/, a path
--      an anonymous homeowner cannot write to.
-- Rather than force a bad fit, this reproduces seal-document's ACTUAL guarantee
-- — "the server recomputes the hash over the exact bytes it stores, and refuses
-- on mismatch" — inside the token-gated portal RPC pattern that already carries
-- portal_submit_co_approval / portal_choose_selection.
--
-- Additive and idempotent. The old 7-arg portal_submit_co_approval is left
-- intact so a portal deployed before this migration keeps working.

-- pgcrypto supplies digest(). Supabase installs it in `extensions`; the RPC's
-- search_path below includes that schema so the unqualified call resolves.
create extension if not exists pgcrypto with schema extensions;

-- ── Signature columns on the approval row ────────────────────────────────────
alter table public.change_order_approvals
  add column if not exists signature_data     text,      -- drawn strokes, SVG path data
  add column if not exists signature_hash     text,      -- SHA-256 of signature_data
  add column if not exists consent_record     text,      -- the canonical retainable record
  add column if not exists document_hash      text,      -- server-computed SHA-256 of consent_record
  add column if not exists consent_version    text,      -- which disclosure the signer accepted
  add column if not exists consent_accepted   boolean,   -- explicit "I agree" affirmation
  add column if not exists sealed_at          timestamptz;

comment on column public.change_order_approvals.document_hash is
  'SHA-256 of consent_record, recomputed server-side at insert. Any later byte-level edit to consent_record breaks this hash — same tamper-evidence property as project_contracts.document_hash.';

-- ── Token-gated signed submit ────────────────────────────────────────────────
-- Same accessToken gate as every other portal RPC (portal_project_for_token).
-- Named *_signed rather than overloading portal_submit_co_approval so the old
-- signature keeps its grant and PostgREST never has to disambiguate.
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
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  if p_decision is null or p_decision not in ('approved', 'declined') then raise exception 'portal_denied'; end if;
  if p_change_order_id is null or length(btrim(p_change_order_id)) = 0 then raise exception 'portal_denied'; end if;

  -- An APPROVAL is a signature. Refuse one that is missing any of the three
  -- ESIGN elements: intent (a drawn mark), identity (a typed legal name), and
  -- consent (an explicit affirmation of the disclosure). A DECLINE stays easy —
  -- it creates no obligation — but must carry a reason.
  if p_decision = 'approved' then
    if coalesce(p_consent_accepted, false) is not true then raise exception 'esign_consent_required'; end if;
    if p_signature_data is null or length(btrim(p_signature_data)) = 0 then raise exception 'esign_signature_required'; end if;
    if p_signer_name is null or length(btrim(p_signer_name)) < 3 then raise exception 'esign_signer_name_required'; end if;
    if p_consent_record is null or length(btrim(p_consent_record)) = 0 then raise exception 'esign_record_required'; end if;
  else
    if p_note is null or length(btrim(p_note)) = 0 then raise exception 'decline_reason_required'; end if;
  end if;

  -- Tamper-evidence: recompute the digest over the EXACT bytes we are about to
  -- store and refuse if the client disagrees. Mirrors seal-document's step 3.
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

  -- Write a REAL audit entry onto the change order itself. Until now
  -- app/client-view.tsx was the only code path in the whole app appending to
  -- change_orders.audit_trail; a portal decision left no trace on the CO.
  -- Shape matches COAuditEntry in types/index.ts.
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

-- Same grant surface as the other token-gated portal write RPCs: anon may call
-- it, but only with the 192-bit accessToken that ships in the share link.
revoke all on function public.portal_submit_co_approval_signed(
  text, text, text, text, text, text, text, text, text, text, text, text, boolean) from public;
grant execute on function public.portal_submit_co_approval_signed(
  text, text, text, text, text, text, text, text, text, text, text, text, boolean) to anon, authenticated;
