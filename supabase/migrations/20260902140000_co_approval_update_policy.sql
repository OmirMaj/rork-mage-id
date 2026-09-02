-- ============================================================================
-- change_order_approvals had RLS on and NO UPDATE policy, so the portal
-- approval reconciler's stamp write was default-denied.
--
-- Confirmed against production pg_policies on 2026-09-02: the table has exactly
-- two policies, "gc reads own CO approvals" (SELECT) and
-- "gc records client CO approval in own portal" (INSERT). Nothing else. RLS is
-- deny-by-default, so every UPDATE matched zero rows.
--
-- PostgREST does not error on that. It returns 200 with an empty result, so
-- hooks/usePortalApprovalReconciler.ts:73 awaited successfully and logged
-- nothing while synced_to_co_at was never written for any row, ever. The
-- reconciler's SELECT is `.is('synced_to_co_at', null) ... .limit(50)`, so the
-- same 50 oldest approvals occupied the window forever: past a contractor's
-- 50th lifetime portal decision, approval #51 onward was never reconciled — the
-- client e-signed the change order, the money was committed, and the CO sat at
-- 'pending' in the contractor's app permanently. Below that threshold, a GC who
-- reverted a client-approved CO had it silently re-flipped within 90 seconds.
--
-- WHY A POLICY AND NOT AN EDGE FUNCTION. The write is a GC stamping a row on
-- their own project with no privilege escalation and no cross-tenant read — the
-- same shape as "gc updates read receipts" on portal_messages, which is already
-- a plain authenticated UPDATE policy. Routing it through the service role
-- would add a network hop and a deploy surface to a write the caller is fully
-- entitled to make. The predicate below is byte-for-byte the predicate of the
-- table's existing SELECT policy, so read scope and write scope cannot drift.
-- ============================================================================


-- ── 1. the missing UPDATE policy ───────────────────────────────────────────
--
-- Predicate copied from "gc reads own CO approvals" (schema.sql:2675) so the
-- rows a GC can stamp are exactly the rows they can already see. WITH CHECK is
-- spelled out rather than left to default to USING: it is what stops the NEW
-- row being re-pointed at another tenant's project_id, and
-- scripts/validate-rls-write-leaks.ts exists because that omission has now been
-- made three times in this schema.

drop policy if exists "gc stamps own CO approvals" on public.change_order_approvals;
create policy "gc stamps own CO approvals"
  on public.change_order_approvals
  for update to authenticated
  using (
    project_id is not null
    and exists (
      select 1 from public.projects p
      where p.id::text = change_order_approvals.project_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    project_id is not null
    and exists (
      select 1 from public.projects p
      where p.id::text = change_order_approvals.project_id
        and p.user_id = auth.uid()
    )
  );


-- ── 2. freeze everything the stamp is not ──────────────────────────────────
--
-- The policy above is the table's first and only write-side grant, and it
-- grants the whole row. That matters more here than on an ordinary table:
-- change_order_approvals is the E-SIGN/UETA evidence record. It holds
-- signature_data, signature_hash, the verbatim consent_record, the server-side
-- document_hash and sealed_at, all written by the SECURITY DEFINER RPC
-- portal_submit_co_approval_signed (schema.sql:4659) after it re-derives and
-- verifies the hash itself. A signed record the counterparty can edit after the
-- fact is not evidence — a contractor could rewrite `decision` from 'declined'
-- to 'approved', or swap the client's signature, and the row would still carry
-- a valid-looking seal.
--
-- The reconciler only ever writes synced_to_co_at. Every other column is
-- pinned to its old value for any caller with a JWT. Same shape and same
-- reasoning as sub_invoice_freeze_columns and crew_freeze_ownership_columns.
--
-- auth.uid() IS NOT NULL guard: the anon portal RPCs are SECURITY DEFINER and
-- run with no JWT, and the service role must stay able to correct records.
-- Pinning silently rather than raising is deliberate and matches the two
-- triggers above: PostgREST clients routinely PATCH more columns than they
-- meant to, and an exception there would break the stamp we just unblocked.
--
-- Column list verified against production information_schema on 2026-09-02
-- (19 columns) — plpgsql is late-bound, so a typo here would fail at UPDATE
-- time on a real client signature rather than at CREATE time.
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
    -- synced_to_co_at is deliberately NOT pinned. It is the one column an
    -- authenticated GC is allowed to write, and the whole point of this file.
  end if;
  return new;
end;
$function$;

drop trigger if exists change_order_approvals_freeze_evidence on public.change_order_approvals;
create trigger change_order_approvals_freeze_evidence
  before update on public.change_order_approvals
  for each row execute function public.co_approval_freeze_evidence();


comment on policy "gc stamps own CO approvals" on public.change_order_approvals is
  'Lets the portal approval reconciler write synced_to_co_at. Predicate is identical to "gc reads own CO approvals" so write scope cannot drift from read scope. Everything except synced_to_co_at is pinned by trigger change_order_approvals_freeze_evidence — this table is the e-signature evidence record.';
