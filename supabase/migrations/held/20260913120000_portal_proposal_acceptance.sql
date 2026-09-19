-- ============================================================================
-- HELD — do not apply until the portal build that calls this RPC is deployed.
-- See held/README.md.
--
-- The client portal's third write path: ACCEPT (or decline) the proposal.
--
-- WHY. MAGE's five no-account token portals are read-only snapshots with
-- exactly two write paths — approve a change order, and pay an invoice through
-- a Stripe link. Jobber's Client Hub ($29-49/mo), Housecall Pro ($59) and
-- Zuper all let a homeowner approve the QUOTE, which is the decision that
-- starts the job and the one a remodeler waits on. This adds it, reusing the
-- change-order e-signature machinery (20260803120500_portal_co_esignature.sql)
-- rather than inventing a second one: drawn signature, typed legal name,
-- affirmative consent against a versioned disclosure, a canonical retainable
-- record, and a server-recomputed SHA-256 that must match the client's.
--
-- ── THE THREAT MODEL THIS FILE IS WRITTEN AGAINST ───────────────────────────
-- A portal is authenticated by a 192-bit token in a link and nothing else.
-- Anyone holding the link can call this function, and EVERY byte it receives
-- is attacker-controlled. A change order at least exists as a row the server
-- can look up; a proposal is a projection of an estimate that lives in
-- `project_financials.linked_estimate`, so there is no row to join to. If this
-- function trusted the browser for the price, a link-holder could seal an
-- acceptance of "$1.00" — or of $900,000 — against their contractor's job.
--
-- So it trusts the browser for NOTHING material. Every material term is read
-- back out of `portal_snapshots.snapshot->'proposal'` — the row the
-- contractor's own device published — and the client's only role is to PROVE
-- it saw that same document:
--
--   1. the accessToken resolves to a project, or the call dies (same
--      portal_project_for_token gate as every other portal RPC);
--   2. the snapshot row for that portal is read, and its project_id must be
--      that same project;
--   3. the snapshot must actually carry a proposal, and its id must equal the
--      one the client submitted;
--   4. the server hashes ITS OWN copy of `proposal.documentText`, and the
--      client's echoed hash must equal it. A contractor who re-priced the job
--      since the page loaded invalidates every stale signature, by
--      construction;
--   5. the signed consent record must itself carry that server-computed digest
--      on its own line, so the retained record is bound to the published
--      document and not merely accompanied by it;
--   6. the consent record is re-hashed server-side and refused on mismatch
--      (the seal-document guarantee, same as the CO path);
--   7. the dollar figure stored on the acceptance is taken from the SNAPSHOT,
--      never from the request;
--   8. (2026-09-17) the published proposal must be record version
--      `proposal-esign-2` with confirmed payment terms. An esign-1 proposal
--      carries MAGE's placeholder 10% deposit, and a pending one carries no
--      schedule at all; neither is something a homeowner may sign;
--   9. (2026-09-17) the accepted proposal object is stored on the row
--      (`proposal_snapshot`) and a trigger on `portal_snapshots` pins it, so
--      no later push — a stale device, an old build, a changed setting — can
--      replace the text an accepted signature's hash was computed over.
--
-- Step 3 is the one the 2026-09 audit found missing on the change-order path:
-- portal_submit_co_approval / _signed insert an approval row for ANY
-- p_change_order_id, without ever confirming that change order belongs to the
-- token's project. 20260919030000_client_portal_live_overlay.sql closes that
-- (with the co_not_shared rule); Section 3 below is superseded and empty.
--
-- ── ERROR SURFACE (deliberate) ──────────────────────────────────────────────
-- Anything that could be used to probe what exists behind a token raises the
-- flat `portal_denied`: a bad token, a portal with no snapshot, a snapshot
-- with no proposal, a proposal id that does not match. The only distinct codes
-- are ones that describe the CALLER'S OWN submission and reveal nothing about
-- the tenant: the three missing ESIGN elements, a missing decline reason, a
-- consent-record hash mismatch, `proposal_superseded` — which tells a
-- homeowner holding a stale page to reload, and tells an attacker only that
-- the bytes they hold are not current, which they already knew — and
-- `proposal_already_accepted`, raised only on a DECLINE filed after an
-- acceptance, which tells a link-holder something every holder of that link
-- can already read off the page.
--
-- An ACCEPTANCE that arrives second does not raise. It returns
-- {ok, already:true, recorded:false, signer_name, sealed_at, …} so the page
-- can say "this was already accepted on <date> by <name>, and what you just
-- signed was not recorded". That sentence is the whole reason the field is
-- there: the row is not written, and a page that celebrates anyway has taken
-- a signature and thrown it away.
--
-- ── PRECONDITIONS ───────────────────────────────────────────────────────────
--   1. marketing/portal/index.html carrying the acceptance flow is deployed to
--      mageid.app. Applying first is harmless (the function is simply never
--      called); deploying the page first is not — every acceptance 404s.
--   2. An OTA carrying snapshot v12 has reached the contractor's device AND
--      that device has re-pushed its portal snapshot. `proposal` is written by
--      buildPortalSnapshot; until a v12 snapshot lands in `portal_snapshots`,
--      step 3 above finds no proposal and every acceptance is denied. This is
--      the correct failure (a signature with nothing to bind to must not be
--      recorded) but it means the feature is dark until the snapshot rolls.
--   3. Section 3 (the change-order ownership check) is SUPERSEDED by
--      20260919030000 and no longer creates anything. Still, before applying,
--      run the query in its header against production: if any existing change_order_approvals row references a
--      change order that does not belong to its project_id, that is either the
--      bug firing or a data-repair job, and it wants looking at first.
--   4. (2026-09-17, Direction B) The esign-2 portal page is deployed to
--      mageid.app: `var PROPOSAL_ESIGN_VERSION = 'proposal-esign-2'` in
--      marketing/portal/index.html. An esign-1 page would build consent records
--      this RPC refuses (step 8), and it still draws Accept on esign-1
--      proposals.
--   5. (2026-09-17) proposal-esign-1 rows in portal_snapshots are at or near
--      zero — i.e. the OTA stamping esign-2 has reached the devices that
--      publish proposals and they have re-pushed. Until then those portals are
--      read-only (correct, but dark). Check with:
--
--        select count(*) filter (where snapshot->'proposal'->>'version' = 'proposal-esign-1') as esign_1,
--               count(*) filter (where snapshot->'proposal'->>'version' = 'proposal-esign-2') as esign_2,
--               count(*) filter (where (snapshot->'proposal'->>'paymentTermsPending') = 'true') as pending
--          from public.portal_snapshots
--         where snapshot ? 'proposal';
--
--   6. (2026-09-17) This file carries the Direction B edits: the
--      `proposal_snapshot` column and its freeze pin, `for update` on the
--      snapshot read, the esign-2 / pending refusal, and the
--      `portal_snapshots_pin_accepted_proposal` trigger (section 2b). A copy of
--      this file without them must not be applied — an acceptance could then
--      be rewritten by the next snapshot push.
--   7. (2026-09-17, integration round 2) The ACCEPTED STAMP on the projects row
--      is protected too, not only the snapshot. hooks/useClientDocumentGate's
--      first-answer auto-stamp calls nextProposalStamp with acceptance 'none'
--      and reads `existing` from the DEVICE's project cache, so a stale device
--      can overwrite projects.client_portal->'proposalPaymentTerms' on a
--      proposal that was already accepted: section 2b's pin guards
--      portal_snapshots only, and projects_keep_proposal_payment_terms restores
--      the key only when it is ABSENT, not when it changes. contract.tsx seeds
--      from that stamp and client-portal-setup prints it in the locked row.
--      Before applying, ship ONE of:
--        (a) a projects BEFORE UPDATE trigger that keeps the old
--            client_portal->'proposalPaymentTerms' whenever an accepted
--            proposal_approvals row exists for the project, or
--        (b) an auto-stamp that skips a project whose SERVER row already
--            carries a stamp (read it, don't trust the cache).
--      Without it an accepted proposal's signed terms and the contract seeded
--      from them can silently diverge.
--
-- NO DATA PRECONDITION for sections 1-2: `proposal_approvals` is a new table,
-- so the one-acceptance-per-PORTAL unique index cannot fail on existing rows,
-- and the `drop index` ahead of it names only this file's own index. That
-- index is portal-wide on purpose — the proposal id is the estimate id and the
-- app rotates it on every re-link, so a per-proposal index would let a
-- contractor's re-save unlock a second acceptance at a second price.
--
-- Additive. Section 3 is superseded (it creates nothing; see its header).
-- ============================================================================

-- pgcrypto supplies digest(). Supabase installs it in `extensions`; the search
-- paths below include that schema so the unqualified call resolves.
create extension if not exists pgcrypto with schema extensions;

-- ── 1. Where an acceptance lands ────────────────────────────────────────────
create table if not exists public.proposal_approvals (
  id                     uuid primary key default gen_random_uuid(),
  portal_id              text not null,
  -- Resolved from the accessToken, never accepted from the request.
  project_id             uuid not null references public.projects(id) on delete cascade,
  -- The estimate id the published snapshot carried.
  proposal_id            text not null,
  decision               text not null check (decision in ('accepted', 'declined')),
  signer_name            text,
  -- Decline reason. An acceptance carries no note.
  note                   text,
  user_agent             text,
  signature_data         text,
  signature_hash         text,
  consent_record         text,
  -- SHA-256 of consent_record, recomputed server-side at insert.
  document_hash          text,
  -- SHA-256 of the PUBLISHED proposal.documentText, computed server-side from
  -- the snapshot row. This is what makes the signature specific to a document.
  proposal_document_hash text,
  -- The price accepted, read out of the snapshot. NOT the client's figure.
  proposal_total         numeric,
  consent_version        text,
  consent_accepted       boolean,
  sealed_at              timestamptz,
  created_at             timestamptz not null default now(),
  -- The one column an authenticated GC may write (see the freeze trigger).
  acknowledged_at        timestamptz,
  -- The exact published proposal object this acceptance read (documentText
  -- included). portal_snapshots_pin_accepted_proposal re-publishes it on every
  -- later push, so proposal_document_hash can always be reproduced from the
  -- live row — whichever build, device or stale state wrote last.
  proposal_snapshot      jsonb
);
-- An earlier copy of this file never reached production, but a dev database
-- may hold one: `create table if not exists` would not add the column there.
alter table public.proposal_approvals add column if not exists proposal_snapshot jsonb;

comment on column public.proposal_approvals.proposal_total is
  'The accepted price, read from portal_snapshots.snapshot->''proposal''->>''total'' at insert. Never taken from the request body: the caller is anyone holding the share link.';
comment on column public.proposal_approvals.proposal_snapshot is
  'The published proposal object (snapshot->''proposal'') the acceptance was checked against, stored at insert. Pinned by the freeze trigger, and re-imposed on portal_snapshots by portal_snapshots_pin_accepted_proposal.';
comment on column public.proposal_approvals.proposal_document_hash is
  'SHA-256 of the published proposal.documentText, computed server-side. The consent record must carry this digest on its own line, so the retained record is bound to the exact document the contractor published.';

create index if not exists proposal_approvals_project_idx
  on public.proposal_approvals (project_id, created_at desc);
create index if not exists proposal_approvals_unacked_idx
  on public.proposal_approvals (project_id, created_at)
  where acknowledged_at is null;

-- ONE ACCEPTANCE PER PORTAL. Not per (portal_id, proposal_id), which is what
-- this was until 2026-09-13 and which does not hold: the proposal id is the
-- estimate id, and app/(tabs)/estimate/full.tsx buildLinkedEstimate stamps a
-- fresh `generateUUID()` on EVERY link and every merge. So a contractor who
-- re-saves the estimate rotates the id, and a per-proposal index would have
-- allowed a SECOND acceptance, at a second price, with nothing in the table
-- saying which one superseded which.
--
-- One job, one acceptance. A re-priced proposal after an acceptance is a
-- change order or a new agreement, not a second signature on the same portal.
-- Declines are not capped by the index — but see the RPC: once an acceptance
-- exists, a decline is refused, because a "Proposal declined" row landing on
-- top of an accepted job is a signal a contractor would stop work on.
-- Dropped by name first: `create ... if not exists` on a name that already
-- exists is a NO-OP, so re-applying an earlier copy of this file that built
-- the same name over (portal_id, proposal_id) would silently leave the weaker
-- index in place.
drop index if exists public.proposal_approvals_one_acceptance;
create unique index proposal_approvals_one_acceptance
  on public.proposal_approvals (portal_id)
  where decision = 'accepted';

alter table public.proposal_approvals enable row level security;

-- Same reach as "gc reads own CO approvals" — deliberately not broader. If
-- collaborators should see these, that is a separate, reviewed decision.
drop policy if exists "gc reads own proposal approvals" on public.proposal_approvals;
create policy "gc reads own proposal approvals" on public.proposal_approvals
  for select to authenticated
  using (exists (select 1 from public.projects p
                  where p.id = proposal_approvals.project_id
                    and p.user_id = auth.uid()));

drop policy if exists "gc acknowledges own proposal approvals" on public.proposal_approvals;
create policy "gc acknowledges own proposal approvals" on public.proposal_approvals
  for update to authenticated
  using (exists (select 1 from public.projects p
                  where p.id = proposal_approvals.project_id
                    and p.user_id = auth.uid()))
  with check (exists (select 1 from public.projects p
                       where p.id = proposal_approvals.project_id
                         and p.user_id = auth.uid()));

-- The evidence is evidence. Mirrors co_approval_freeze_evidence(): an
-- authenticated GC may stamp acknowledged_at and nothing else, so a signed
-- record cannot be edited after the fact by the party it binds.
create or replace function public.proposal_approval_freeze_evidence()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    new.id                     := old.id;
    new.portal_id              := old.portal_id;
    new.project_id             := old.project_id;
    new.proposal_id            := old.proposal_id;
    new.decision               := old.decision;
    new.signer_name            := old.signer_name;
    new.note                   := old.note;
    new.user_agent             := old.user_agent;
    new.signature_data         := old.signature_data;
    new.signature_hash         := old.signature_hash;
    new.consent_record         := old.consent_record;
    new.document_hash          := old.document_hash;
    new.proposal_document_hash := old.proposal_document_hash;
    new.proposal_total         := old.proposal_total;
    new.consent_version        := old.consent_version;
    new.consent_accepted       := old.consent_accepted;
    new.sealed_at              := old.sealed_at;
    new.created_at             := old.created_at;
    new.proposal_snapshot      := old.proposal_snapshot;
    -- acknowledged_at is deliberately NOT pinned. It is the whole point.
  end if;
  return new;
end $$;

drop trigger if exists proposal_approvals_freeze on public.proposal_approvals;
create trigger proposal_approvals_freeze
  before update on public.proposal_approvals
  for each row execute function public.proposal_approval_freeze_evidence();

revoke all on public.proposal_approvals from anon;
grant select, update on public.proposal_approvals to authenticated;

-- ── 2. The token-gated acceptance ───────────────────────────────────────────
create or replace function public.portal_submit_proposal_approval_signed(
  p_portal_id              text,
  p_access_token           text,
  p_proposal_id            text,
  p_proposal_document_hash text,
  p_decision               text,
  p_signer_name            text,
  p_note                   text,
  p_user_agent             text,
  p_signature_data         text,
  p_signature_hash         text,
  p_consent_record         text,
  p_client_hash            text,
  p_consent_version        text,
  p_consent_accepted       boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_pid          uuid;
  v_snap_pid     uuid;
  v_proposal     jsonb;
  v_doc          text;
  v_doc_hash     text;
  v_total        numeric;
  v_claimed_total numeric;
  v_server_hash  text;
  v_now          timestamptz := now();
  v_id           uuid;
  v_existing     public.proposal_approvals%rowtype;
begin
  -- (1) the token, exactly as every other portal RPC gates.
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;

  if p_decision is null or p_decision not in ('accepted', 'declined') then
    raise exception 'portal_denied';
  end if;
  if p_proposal_id is null or length(btrim(p_proposal_id)) = 0 then
    raise exception 'portal_denied';
  end if;

  -- (2) the contractor's own published copy. project_id is nullable on this
  -- table for historical rows, so a null is tolerated but a MISMATCH is not:
  -- a snapshot row that belongs to another project must never be read here
  -- even if a portal_id somehow collided.
  --
  -- FOR UPDATE: the snapshot row stays locked until this transaction ends, so
  -- a contractor's push cannot land between the hash check below and the
  -- insert — the text checked is the text stored in proposal_snapshot.
  select ps.project_id, ps.snapshot->'proposal'
    into v_snap_pid, v_proposal
    from public.portal_snapshots ps
   where ps.portal_id = p_portal_id
   limit 1
   for update;

  if v_snap_pid is not null and v_snap_pid <> v_pid then raise exception 'portal_denied'; end if;
  if v_proposal is null or jsonb_typeof(v_proposal) <> 'object' then raise exception 'portal_denied'; end if;

  -- (3) OWNERSHIP. The proposal being signed must be the proposal this portal
  -- published. This is the check the change-order path was missing.
  if coalesce(v_proposal->>'id', '') <> btrim(p_proposal_id) then
    raise exception 'proposal_superseded';
  end if;

  v_doc := v_proposal->>'documentText';
  if v_doc is null or length(btrim(v_doc)) = 0 then raise exception 'portal_denied'; end if;

  -- (8) ONLY A PROPOSAL WITH THE CONTRACTOR'S OWN CONFIRMED TERMS. Line 2 of
  -- the canonical text is the record version (utils/portalSnapshot
  -- buildProposalDocumentText). proposal-esign-1 printed MAGE's placeholder
  -- 10% deposit, which an old app build may still be pushing; a pending
  -- proposal has no payment schedule at all. Both are refused with the same
  -- "reload" code a re-priced proposal gets — the page draws no Accept on
  -- either, so only a stale page or a hand-rolled call lands here.
  if split_part(v_doc, E'\n', 2) is distinct from 'version: proposal-esign-2'
     or coalesce(v_proposal->>'paymentTermsPending', '') = 'true' then
    raise exception 'proposal_superseded';
  end if;

  -- The money is the SERVER'S, read out of the published snapshot. Nothing in
  -- the request body is allowed to set it — this is the figure that is stored
  -- and the figure the consent record is checked against below.
  v_total := nullif(v_proposal->>'total', '')::numeric;
  if v_total is null or v_total <= 0 then raise exception 'portal_denied'; end if;

  -- (4) the client must prove it rendered THIS document.
  v_doc_hash := encode(digest(v_doc, 'sha256'), 'hex');
  if p_proposal_document_hash is null
     or lower(btrim(p_proposal_document_hash)) <> v_doc_hash then
    raise exception 'proposal_superseded';
  end if;

  -- ESIGN elements. An acceptance is a signature and needs all three: intent
  -- (a drawn mark), identity (a typed legal name), consent (an explicit
  -- affirmation). A decline stays one step — it creates no obligation — but
  -- must say why, because that is the message the contractor acts on.
  if p_decision = 'accepted' then
    if coalesce(p_consent_accepted, false) is not true then raise exception 'esign_consent_required'; end if;
    if p_signature_data is null or length(btrim(p_signature_data)) = 0 then raise exception 'esign_signature_required'; end if;
    if p_signer_name is null or length(btrim(p_signer_name)) < 3 then raise exception 'esign_signer_name_required'; end if;
    if p_consent_record is null or length(btrim(p_consent_record)) = 0 then raise exception 'esign_record_required'; end if;
  else
    if p_note is null or length(btrim(p_note)) = 0 then raise exception 'decline_reason_required'; end if;
  end if;

  -- (5) the retained record must be bound to the published document, not
  -- merely submitted alongside it. Full-line match: a prefix match would
  -- accept '<hash>DEADBEEF'.
  --
  -- Three things are checked, not one. The digest binds the TERMS, but the
  -- record is the artifact a homeowner and a contractor would put in front of
  -- somebody in a dispute, so the record must not be able to SAY something the
  -- server did not agree to. Without the total check a link-holder could sign
  -- a record reading "proposal_total_usd: 1.00" against a $400,000 proposal:
  -- the row would store the server's figure, but the retained record — the
  -- part with a signature on it — would read $1.
  if p_consent_record is not null and length(btrim(p_consent_record)) > 0 then
    if strpos(p_consent_record, E'\nproposal_document_sha256: ' || v_doc_hash || E'\n') = 0 then
      raise exception 'proposal_superseded';
    end if;
    if strpos(p_consent_record, E'\nproposal_id: ' || btrim(p_proposal_id) || E'\n') = 0 then
      raise exception 'proposal_superseded';
    end if;
    -- Parsed and compared as a NUMBER, not as formatted text: to_char and
    -- JavaScript's toFixed(2) agreeing on every value is not a thing worth
    -- betting a refusal on, and a spurious refusal is a homeowner who cannot
    -- accept their proposal.
    v_claimed_total := nullif(
      substring(p_consent_record from E'\nproposal_total_usd: ([0-9]+\\.[0-9]{2})\n'), '')::numeric;
    if v_claimed_total is null or v_total is null or v_claimed_total <> v_total then
      raise exception 'proposal_superseded';
    end if;

    -- (6) tamper-evidence, identical to the CO path: re-hash the exact bytes
    -- about to be stored and refuse if the client disagrees.
    v_server_hash := encode(digest(p_consent_record, 'sha256'), 'hex');
    if p_client_hash is not null and length(p_client_hash) = 64
       and lower(p_client_hash) <> lower(v_server_hash) then
      raise exception 'hash_mismatch';
    end if;
  end if;

  -- ── ONE ACCEPTANCE PER PORTAL, and it wins ────────────────────────────────
  --
  -- Scoped to portal_id, NOT to (portal_id, proposal_id): the proposal id is
  -- the estimate id and the app rotates it on every re-link, so a per-proposal
  -- check would let a second signature at a second price through.
  --
  -- The answer carries who signed and when, and says `recorded: false`, so the
  -- page can tell a SECOND PERSON the truth. Before 2026-09-13 it returned a
  -- bare {ok, already} and the portal ran its whole success path on it —
  -- confetti, "Accepted by <the second person's name>", and the FIRST signer's
  -- record hash presented as their receipt — for a signature that was stored
  -- nowhere. A signature taken and discarded while the page says it is sealed
  -- is worse than no acceptance flow at all.
  select * into v_existing from public.proposal_approvals
   where portal_id = p_portal_id and decision = 'accepted'
   limit 1;
  if found then
    -- A decline after an acceptance is refused outright. The client orders
    -- these `created_at desc` and shows the top one, so a later decline row
    -- would read "Proposal declined" on a job the client already accepted.
    if p_decision = 'declined' then raise exception 'proposal_already_accepted'; end if;
    return jsonb_build_object(
      'ok', true, 'already', true, 'recorded', false,
      'id', v_existing.id,
      'decision', 'accepted',
      'accepted_proposal_id', v_existing.proposal_id,
      'signer_name', v_existing.signer_name,
      'proposal_total', v_existing.proposal_total,
      'document_hash', v_existing.document_hash,
      'sealed_at', v_existing.sealed_at);
  end if;

  begin
    insert into public.proposal_approvals(
        portal_id, project_id, proposal_id, decision, signer_name, note, user_agent,
        signature_data, signature_hash, consent_record, document_hash,
        proposal_document_hash, proposal_total, consent_version, consent_accepted, sealed_at,
        proposal_snapshot)
      values (
        p_portal_id, v_pid, btrim(p_proposal_id), p_decision,
        left(coalesce(nullif(btrim(p_signer_name), ''), 'Client'), 200),
        left(coalesce(p_note, ''), 2000),
        left(coalesce(p_user_agent, ''), 200),
        left(coalesce(p_signature_data, ''), 200000),
        nullif(left(coalesce(p_signature_hash, ''), 64), ''),
        p_consent_record,
        v_server_hash,
        v_doc_hash,
        v_total,
        left(coalesce(p_consent_version, ''), 40),
        coalesce(p_consent_accepted, false),
        v_now,
        v_proposal)
      returning id into v_id;
  exception when unique_violation then
    -- Lost the race against a concurrent acceptance. Same answer as above —
    -- but only if the row we lost to is actually there. A unique_violation
    -- from anywhere else must not be swallowed into a cheerful 'ok'.
    select * into v_existing from public.proposal_approvals
     where portal_id = p_portal_id and decision = 'accepted'
     limit 1;
    if not found then raise; end if;
    return jsonb_build_object(
      'ok', true, 'already', true, 'recorded', false,
      'id', v_existing.id,
      'decision', 'accepted',
      'accepted_proposal_id', v_existing.proposal_id,
      'signer_name', v_existing.signer_name,
      'proposal_total', v_existing.proposal_total,
      'document_hash', v_existing.document_hash,
      'sealed_at', v_existing.sealed_at);
  end;

  -- A visible trace on the project's own decision log, the way the CO path
  -- appends to change_orders.audit_trail. A proposal has no row of its own to
  -- write onto, so portal_decision_audit is where it goes.
  insert into public.portal_decision_audit(portal_id, project_id, action, detail)
    values (
      p_portal_id, v_pid,
      case when p_decision = 'accepted' then 'proposal_accepted_via_portal'
           else 'proposal_declined_via_portal' end,
      jsonb_build_object(
        'proposal_id', btrim(p_proposal_id),
        'approval_id', v_id,
        'signer_name', left(coalesce(nullif(btrim(p_signer_name), ''), 'Client'), 200),
        'proposal_total', v_total,
        'proposal_document_sha256', v_doc_hash,
        'consent_version', left(coalesce(p_consent_version, ''), 40),
        'record_sha256', v_server_hash,
        'at', to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));

  -- `recorded` is the field the page branches on: true here (this call created
  -- the row) and false on every `already` return above. Without it the portal
  -- cannot tell "your signature is sealed" from "someone else's already was".
  return jsonb_build_object(
    'ok', true,
    'recorded', true,
    'id', v_id,
    'decision', p_decision,
    'document_hash', v_server_hash,
    'proposal_total', v_total,
    'sealed_at', v_now
  );
end $$;

-- New functions in `public` carry no default EXECUTE after
-- 20260904100200_default_privileges_and_function_grants.sql, so the grant is
-- explicit. anon is required: the homeowner has no MAGE account — that is the
-- point of this portal — and the accessToken is the whole authorization.
revoke all on function public.portal_submit_proposal_approval_signed(
  text, text, text, text, text, text, text, text, text, text, text, text, text, boolean) from public;
grant execute on function public.portal_submit_proposal_approval_signed(
  text, text, text, text, text, text, text, text, text, text, text, text, text, boolean)
  to anon, authenticated, service_role;

-- ── 2b. An accepted proposal stays published exactly as accepted ────────────
--
-- The acceptance hash is over the proposal text in portal_snapshots. Two app
-- writers push that row (the rich push from portal setup and the lite push on
-- every project open), from any device and any build, and they rebuild the
-- proposal from the project as it is NOW. The client refuses to re-stamp an
-- accepted proposal's terms, but a client check is only as current as the
-- device holding it. So the server holds the line: once an acceptance exists
-- for a portal, any incoming snapshot that carries a proposal has it replaced
-- with the accepted `proposal_snapshot`.
--
-- Removing the proposal is still allowed (a contract was sent, the job is
-- complete, the switch was turned off): the accepted text stays in
-- proposal_approvals, and a portal with no proposal asks nobody to sign.
-- SECURITY DEFINER because the pushing GC's RLS reach on proposal_approvals is
-- select-only on his own projects, and the pin must hold for any writer.
create or replace function public.portal_snapshots_pin_accepted_proposal()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $fn$
declare
  v_accepted jsonb;
begin
  if new.snapshot is null or jsonb_typeof(new.snapshot) is distinct from 'object' then return new; end if;
  if jsonb_typeof(new.snapshot -> 'proposal') is distinct from 'object' then return new; end if;
  select pa.proposal_snapshot into v_accepted
    from public.proposal_approvals pa
   where pa.portal_id = new.portal_id
     and pa.decision = 'accepted'
     and pa.proposal_snapshot is not null
   order by pa.created_at
   limit 1;
  if v_accepted is not null and jsonb_typeof(v_accepted) = 'object' then
    new.snapshot := jsonb_set(new.snapshot, '{proposal}', v_accepted);
  end if;
  return new;
end $fn$;

revoke execute on function public.portal_snapshots_pin_accepted_proposal() from public, anon, authenticated;

drop trigger if exists portal_snapshots_pin_accepted_proposal on public.portal_snapshots;
create trigger portal_snapshots_pin_accepted_proposal
  before insert or update on public.portal_snapshots
  for each row execute function public.portal_snapshots_pin_accepted_proposal();

-- ── 3. Close the same hole on the change-order path — SUPERSEDED ────────────
--
-- 2026-09-18 (wave 3 post-chain): this section's two CREATE OR REPLACEs were
-- REMOVED from this file. 20260919030000_client_portal_live_overlay.sql ships
-- the same change-order ownership check (flat portal_denied) PLUS the
-- co_not_shared rule (#44: a recalled or never-sent CO is not signable), and
-- it is applied before the OTA. Re-creating the two functions here, without
-- co_not_shared, would silently re-open #44 whichever order the two files are
-- applied in. Sections 1-2 (proposal acceptance) are unchanged. The original
-- text of this section is below for the record; the orphan query still
-- belongs in the pre-apply checklist.
--
--
-- THE BUG. Both portal_submit_co_approval (20260713150000) and
-- portal_submit_co_approval_signed (20260803120500) insert an approval row for
-- whatever p_change_order_id the caller sends, having verified only that the
-- token is good for SOME project. The follow-up UPDATE is scoped
-- `and project_id = v_pid`, so the audit trail of a foreign change order is
-- safe — but the APPROVAL ROW is not: it is written with the token's
-- project_id and a foreign change_order_id, and
-- hooks/usePortalApprovalReconciler.ts then matches it against the GC's change
-- orders BY ID ALONE (`changeOrders.find(c => c.id === row.change_order_id)`),
-- with no project comparison, and flips that change order to `approved`.
-- A link-holder for one small job could, with a change-order id from a bigger
-- job at the same contractor, get it approved.
--
-- THE FIX. Confirm the change order belongs to the token's project before
-- anything is written. Both functions keep their signatures, their names and
-- their grants; only the check is added. The reconciler should ALSO compare
-- project_id — defence in depth, and it is the layer that decides — but that
-- is a client change and does not belong in a migration.
--
-- BEFORE APPLYING, look for rows the bug may already have produced:
--
--   select a.id, a.portal_id, a.project_id, a.change_order_id, a.created_at
--     from public.change_order_approvals a
--     left join public.change_orders c
--       on c.id::text = a.change_order_id
--      and c.project_id::text = a.project_id
--    where a.project_id is not null
--      and c.id is null
--    order by a.created_at desc;
--
-- Rows returned are approvals whose change order does not belong to the
-- project they were recorded against. Expect zero. Anything else wants
-- reading before this is applied — and note the same query returns rows for
-- the benign case where the change order was simply deleted, so check the
-- change_orders history before concluding anything.

-- (The two function bodies that followed were removed — see above.)
