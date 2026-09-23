-- 20260923130000_lien_prequal_hardening.sql
--
-- Wave 5 · lane lien-prequal. Findings #29, #31, #24, #111, #114 (server half).
--
-- APPLY ORDER: AFTER the notify edge function ships the two new events
-- ('lien_waiver_signed', 'prequal_submitted' — w5-join-server). The two AFTER
-- triggers below call public.fire_notify with those event names; applied first,
-- notify would answer "unknown event" for every signature until it deploys.
-- (fire_notify swallows its own errors and each call here sits in an exception
-- block, so the row write never fails either way — the order only decides
-- whether the GC hears about it.)
--
-- Every function redefined here is based on the LIVE definition read from
-- production on 2026-09-22 (pg_get_functiondef), which is byte-for-byte the
-- body in 20260908120200_lien_waiver_signing.sql / 20260520180000_prequal_token_rpcs.sql.
-- Signatures, SECURITY DEFINER, search_path and grants are unchanged.
--
-- ── WHAT THIS DOES ──────────────────────────────────────────────────────────
--
-- 1. lien_waivers.voided_sign_token (new, nullable). When a waiver is voided
--    its signing token is MOVED here: the live column is cleared (the link can
--    never sign again, even on a late offline void — #114), while the signing
--    page can still find the row and say "This waiver was voided by the
--    contractor" instead of "This link no longer works… open the most recent
--    email", which would send the sub looking for an email that was never sent.
--
-- 2. lien_waivers_protect_signature — BEFORE UPDATE (#31, #114):
--      • NEW.status = 'voided' → sign_token moves to voided_sign_token. For
--        EVERY caller, so a void queued offline and synced late still kills
--        the link.
--      • Once OLD.signed_at is set, a direct write from a signed-in client
--        (current_user = 'authenticated') keeps OLD.sub_signature and
--        OLD.signed_at, and never lets the status fall back to 'requested' —
--        SILENTLY. Never RAISE: a stale full-row upsert queued
--        by an old build would become a permanent failure in the offline queue.
--        The client's `.is('signed_at', null)` filter is what tells the GC his
--        paper record lost the race; this is the backstop for every other
--        writer. The service role and the SECURITY DEFINER signing RPC (which
--        runs as its owner, not 'authenticated') are untouched.
--
-- 3. trg_notify_lien_waiver_signed — AFTER UPDATE OF signed_at (#31, CONTRACT 8)
--    fires 'lien_waiver_signed' when a row goes from unsigned to signed, except
--    for the GC's own paper record (sub_signature->>'role' = 'gc'). From a
--    TRIGGER, never from the RPC body: fire_notify raises 42501 at
--    pg_trigger_depth() = 0, and inside an exception block that refusal would
--    silently lose every event.
--
-- 4. lw_gc_insert / lw_gc_update require the caller to OWN the project (#29,
--    productDecision #29 interim — lien waivers are owner-only). A collaborator
--    used to insert waivers under his own user_id on the GC's job: invisible to
--    the GC, and the sub's signing page named the collaborator's company.
--    Production had 0 such orphan rows on 2026-09-22 (1 waiver in total).
--
-- 5. lien_waiver_get_for_signing — company_name comes from the PROJECT OWNER's
--    profile, not the waiver's user_id; a voided waiver is found through its
--    voided_sign_token and returned with status 'voided' (the page already
--    renders that state).
--
-- 6. lien_waiver_submit_signature — raises 'lien_waiver_voided' for a voided
--    waiver (after the FOR UPDATE lock, before the already-signed check), both
--    for a row voided before this migration (token still live) and one whose
--    token moved to voided_sign_token.
--
-- 7. prequal_packets_protect_submission — BEFORE UPDATE (#24 backstop). For a
--    direct write from a signed-in client once the sub has submitted
--    (OLD.submitted_at not null), an EMPTY incoming financials / safety /
--    insurance / licenses / criteria / w9_on_file / w9_doc_path / submitted_at
--    keeps the stored value — silently, same reason as (2). That is exactly the
--    shape of the stale review write (#24: the GC's pre-submission copy spread
--    over the row). A renewal (#32: status back to 'invited' with a NEW token)
--    is allowed to clear submitted_at. The SECURITY DEFINER RPC paths run as
--    their owner and are unaffected.
--
-- 8. trg_notify_prequal_submitted — AFTER UPDATE OF status (#111, CONTRACT 8)
--    fires 'prequal_submitted' when a packet becomes 'submitted'. A resubmission
--    after needs_changes fires it again — intended; that is a new submission.
--
-- 9. submit_prequal_packet stops writing `criteria` (#114). The pass/fail bar
--    is the GC's; a sub holding the link could set minCglPerOccurrence = 0 and
--    come back green. The 9-argument signature is kept so every deployed form
--    still binds; p_criteria is accepted and ignored.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP … IF EXISTS.
-- Reversible: drop the four new triggers and their functions, the column, and
-- re-run 20260908120200 / 20260520180000 / the rls_baseline lw_gc_* policies.

-- ── 1. the voided token's resting place ─────────────────────────────────────
alter table public.lien_waivers
  add column if not exists voided_sign_token text;

-- ── 2. BEFORE UPDATE guard on lien_waivers ──────────────────────────────────
create or replace function public.lien_waivers_protect_signature()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- A void is final for a signed-in client. saveLienWaiver upserts the status
  -- its card last showed, so a stale card on another device (loaded before the
  -- void) would put the release back to 'requested' — the link stays dead
  -- (the token moved to voided_sign_token) but the GC's list would show it
  -- awaiting signature again. Pinned silently, like the signed rows below: a
  -- raise would strand the queued write and lose its other edits. The app has
  -- no un-void; the service role and SECURITY DEFINER RPCs are unaffected.
  -- This runs FIRST so the void branch below re-kills any sign_token the
  -- stale copy carried back in.
  if old.status = 'voided'
     and auth.uid() is not null
     and current_user = 'authenticated' then
    new.status := old.status;
  end if;

  -- A void kills the signing link for every caller, late offline voids
  -- included. The token is kept (not destroyed) so the signing page can tell
  -- the sub the contractor voided it.
  if new.status = 'voided' and coalesce(new.sign_token, old.sign_token) is not null then
    new.voided_sign_token := coalesce(new.voided_sign_token, new.sign_token, old.sign_token);
    new.sign_token := null;
  end if;

  -- A signed release is never rewritten by a signed-in client. current_user is
  -- 'authenticated' for a PostgREST write from the app, and the function owner
  -- inside a SECURITY DEFINER RPC — so the signing RPC and the service role are
  -- free, and every app write (a stale queued upsert from an old build, a paper
  -- record that lost the race) keeps the signature that is on file.
  if old.signed_at is not null
     and auth.uid() is not null
     and current_user = 'authenticated' then
    new.sub_signature := old.sub_signature;
    new.signed_at := old.signed_at;
    -- …and a signed release is never knocked back to 'requested' by a stale
    -- card (saveLienWaiver's upsert writes the status the card last showed).
    -- 'received' and 'voided' still land: those are real decisions.
    if new.status = 'requested' then
      new.status := old.status;
    end if;
  end if;

  return new;
end; $function$;

drop trigger if exists lien_waivers_protect_signature on public.lien_waivers;
create trigger lien_waivers_protect_signature
  before update on public.lien_waivers
  for each row execute function public.lien_waivers_protect_signature();

-- ── 3. notify: a sub signed ─────────────────────────────────────────────────
create or replace function public.notify_lien_waiver_signed_fn()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Exception block: a notify failure must never undo a signature.
  begin
    perform public.fire_notify(
      'lien_waiver_signed',
      'lien_waivers',
      new.id::text,
      jsonb_build_object(
        'user_id',    new.user_id,
        'project_id', new.project_id,
        'waiver_id',  new.id,
        'sub_name',   new.sub_signature->>'name'
      )
    );
  exception when others then
    raise warning 'notify_lien_waiver_signed_fn: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end; $function$;

revoke all on function public.notify_lien_waiver_signed_fn() from public;

drop trigger if exists trg_notify_lien_waiver_signed on public.lien_waivers;
create trigger trg_notify_lien_waiver_signed
  after update of signed_at on public.lien_waivers
  for each row
  when (old.signed_at is null
        and new.signed_at is not null
        -- the GC's own paper record is not news to the GC
        and coalesce(new.sub_signature->>'role', '') <> 'gc')
  execute function public.notify_lien_waiver_signed_fn();

-- ── 4. owner-only writes (productDecision #29 interim) ──────────────────────
-- Same roles as the baseline (to public); the ownership term is added.
drop policy if exists lw_gc_insert on public.lien_waivers;
create policy lw_gc_insert on public.lien_waivers as permissive for insert to public
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

drop policy if exists lw_gc_update on public.lien_waivers;
create policy lw_gc_update on public.lien_waivers as permissive for update to public
  using (
    auth.uid() = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  )
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

-- ── 5. read: what the signing page is allowed to see ────────────────────────
create or replace function public.lien_waiver_get_for_signing(
  p_waiver_id    uuid,
  p_access_token text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_w record; v_proj_name text; v_owner uuid; v_company text;
begin
  if p_access_token is null or length(p_access_token) < 32 then
    raise exception 'lien_waiver_denied';
  end if;

  -- The live token, or — for a waiver the GC voided — the token the void
  -- retired, so the page can say it was voided rather than "link replaced".
  select * into v_w from public.lien_waivers
    where id = p_waiver_id
      and (
        (coalesce(sign_token, '') <> '' and sign_token = p_access_token)
        or (status = 'voided' and coalesce(voided_sign_token, '') <> '' and voided_sign_token = p_access_token)
      )
    limit 1;
  if v_w is null then raise exception 'lien_waiver_denied'; end if;

  select name, user_id into v_proj_name, v_owner from public.projects where id = v_w.project_id limit 1;
  -- The PROJECT OWNER's company (#29): the waiver's user_id could be a
  -- collaborator's on rows written before lw_gc_insert checked ownership.
  select company_name into v_company from public.profiles where id = coalesce(v_owner, v_w.user_id) limit 1;

  return jsonb_build_object(
    'ok', true,
    'id',              v_w.id,
    'status',          v_w.status,
    'signed_at',       v_w.signed_at,
    'sub_name',        v_w.sub_name,
    'paid_amount',     v_w.paid_amount,
    'through_date',    v_w.through_date,
    'waiver_type',     v_w.waiver_type,
    'project_name',    coalesce(v_proj_name, ''),
    'company_name',    coalesce(v_company, ''),
    'waiver_title',     coalesce(v_w.sign_form_meta->>'waiver_title', ''),
    'statute_citation', coalesce(v_w.sign_form_meta->>'statute_citation', ''),
    'state_name',       coalesce(v_w.sign_form_meta->>'state_name', ''),
    -- A voided waiver shows no document: there is nothing to sign.
    'document_html',   case when v_w.status = 'voided' then '' else coalesce(v_w.sign_document_html, '') end
  );
end; $function$;

-- ── 6. write: refuse a voided waiver ────────────────────────────────────────
create or replace function public.lien_waiver_submit_signature(
  p_waiver_id       uuid,
  p_access_token    text,
  p_signer_name     text,
  p_signer_title    text,
  p_signature_paths text,
  p_consent_record  text,
  p_consent_version text,
  p_consent_accepted boolean,
  p_user_agent      text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_w record; v_now timestamptz := now();
begin
  if p_access_token is null or length(p_access_token) < 32 then
    raise exception 'lien_waiver_denied';
  end if;
  if p_consent_accepted is not true then
    raise exception 'lien_waiver_consent_required';
  end if;
  if p_signer_name is null or length(trim(p_signer_name)) = 0 then
    raise exception 'lien_waiver_signer_required';
  end if;

  select * into v_w from public.lien_waivers
    where id = p_waiver_id
      and coalesce(sign_token, '') <> ''
      and sign_token = p_access_token
    limit 1
    for update;
  if v_w is null then
    -- A token the void retired: say voided, not "link replaced".
    if exists (select 1 from public.lien_waivers
                where id = p_waiver_id and status = 'voided'
                  and coalesce(voided_sign_token, '') <> ''
                  and voided_sign_token = p_access_token) then
      raise exception 'lien_waiver_voided';
    end if;
    raise exception 'lien_waiver_denied';
  end if;

  -- #114: the GC cancelled this release. Checked after the lock (a void and a
  -- signature racing serialize here) and before the signed check.
  if v_w.status = 'voided' then
    raise exception 'lien_waiver_voided';
  end if;

  if v_w.signed_at is not null then
    return jsonb_build_object('ok', true, 'already_signed', true, 'signed_at', v_w.signed_at);
  end if;

  update public.lien_waivers
     set sub_signature = jsonb_build_object(
           'name',            left(trim(p_signer_name), 200),
           'title',           left(coalesce(p_signer_title, ''), 120),
           'role',            'sub',
           'signedAt',        v_now,
           'signaturePaths',  left(coalesce(p_signature_paths, ''), 200000),
           'consentRecord',   left(coalesce(p_consent_record, ''), 4000),
           'consentVersion',  left(coalesce(p_consent_version, ''), 64),
           'consentAccepted', true,
           'userAgent',       left(coalesce(p_user_agent, ''), 500)
         ),
         signed_at  = v_now,
         status     = 'signed',
         updated_at = v_now
   where id = v_w.id;

  -- The GC hears about it through trg_notify_lien_waiver_signed (AFTER UPDATE
  -- OF signed_at) — never from here: fire_notify refuses a non-trigger caller.
  return jsonb_build_object('ok', true, 'already_signed', false, 'signed_at', v_now);
end; $function$;

-- CREATE OR REPLACE keeps the existing ACL; restated so a fresh database
-- matches production.
revoke all on function public.lien_waiver_get_for_signing(uuid, text) from public;
revoke all on function public.lien_waiver_submit_signature(uuid, text, text, text, text, text, text, boolean, text) from public;
grant execute on function public.lien_waiver_get_for_signing(uuid, text) to anon, authenticated;
grant execute on function public.lien_waiver_submit_signature(uuid, text, text, text, text, text, text, boolean, text) to anon, authenticated;

-- ── 7. BEFORE UPDATE guard on prequal_packets ───────────────────────────────
create or replace function public.prequal_packets_protect_submission()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare v_renewal boolean;
begin
  if old.submitted_at is null
     or auth.uid() is null
     or current_user <> 'authenticated' then
    return new;
  end if;

  -- #32: a renewal re-invites with a NEW token and clears the old decision.
  v_renewal := new.status = 'invited' and new.invite_token is distinct from old.invite_token;

  if new.financials is null or new.financials = '{}'::jsonb then new.financials := old.financials; end if;
  if new.safety     is null or new.safety     = '{}'::jsonb then new.safety     := old.safety;     end if;
  if new.insurance  is null or new.insurance  = '{}'::jsonb then new.insurance  := old.insurance;  end if;
  if new.criteria   is null or new.criteria   = '{}'::jsonb then new.criteria   := old.criteria;   end if;
  if new.licenses   is null or new.licenses   = '[]'::jsonb then new.licenses   := old.licenses;   end if;
  if new.w9_on_file is distinct from true and old.w9_on_file then new.w9_on_file := old.w9_on_file; end if;
  if new.w9_doc_path is null then new.w9_doc_path := old.w9_doc_path; end if;
  if new.submitted_at is null and not v_renewal then new.submitted_at := old.submitted_at; end if;

  return new;
end; $function$;

drop trigger if exists prequal_packets_protect_submission on public.prequal_packets;
create trigger prequal_packets_protect_submission
  before update on public.prequal_packets
  for each row execute function public.prequal_packets_protect_submission();

-- ── 8. notify: a sub submitted ──────────────────────────────────────────────
create or replace function public.notify_prequal_submitted_fn()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_sub_name text;
begin
  begin
    -- prequal_packets carries no company name; the GC's roster row does.
    -- subcontractor_id is text, subcontractors.id is uuid — compared as text so
    -- a malformed id finds nothing instead of raising.
    select s.company_name into v_sub_name
      from public.subcontractors s
     where s.id::text = new.subcontractor_id
       and s.user_id = new.user_id
     limit 1;
    perform public.fire_notify(
      'prequal_submitted',
      'prequal_packets',
      new.id::text,
      jsonb_build_object(
        'user_id',   new.user_id,
        'packet_id', new.id,
        'sub_name',  v_sub_name
      )
    );
  exception when others then
    raise warning 'notify_prequal_submitted_fn: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end; $function$;

revoke all on function public.notify_prequal_submitted_fn() from public;

drop trigger if exists trg_notify_prequal_submitted on public.prequal_packets;
create trigger trg_notify_prequal_submitted
  after update of status on public.prequal_packets
  for each row
  when (new.status = 'submitted' and old.status is distinct from 'submitted')
  execute function public.notify_prequal_submitted_fn();

-- ── 9. submit_prequal_packet no longer writes criteria ──────────────────────
create or replace function public.submit_prequal_packet(
  p_token text,
  p_criteria jsonb,
  p_financials jsonb,
  p_safety jsonb,
  p_insurance jsonb,
  p_licenses jsonb,
  p_w9_on_file boolean,
  p_w9_doc_path text,
  p_status text
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count int;
begin
  -- p_criteria is accepted and IGNORED (#114): the stored criteria are the
  -- GC's and stay authoritative. Kept in the signature so every deployed
  -- prequal-form still binds.
  update prequal_packets
     set financials    = p_financials,
         safety        = p_safety,
         insurance     = p_insurance,
         licenses      = p_licenses,
         w9_on_file    = p_w9_on_file,
         w9_doc_path   = p_w9_doc_path,
         status        = case
           when p_status = 'submitted' and status in ('draft', 'invited', 'needs_changes')
             then 'submitted'
           else status
         end,
         submitted_at  = case
           when p_status = 'submitted' and submitted_at is null
             then now()
           else submitted_at
         end,
         updated_at    = now()
   where invite_token = p_token
     and (expires_at is null or expires_at > now())
     and status != 'approved';

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$function$;

revoke all on function public.submit_prequal_packet(
  text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, text, text
) from public;
grant execute on function public.submit_prequal_packet(
  text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, text, text
) to anon, authenticated;
