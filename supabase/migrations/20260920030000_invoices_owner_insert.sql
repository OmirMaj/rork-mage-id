-- 20260920030000_invoices_owner_insert.sql — wave 4, lane invoice-send (#38)
--
-- WHY: an invited editor or viewer could invoice the GC's client from the
-- GC's job. The row went in under HIS user_id (the only check was
-- auth.uid() = user_id), so:
--   * the GC never saw it — every invoices SELECT policy is own-rows only;
--   * its Stripe Pay link was minted on the collaborator's Connect account,
--     so the homeowner's money landed in the collaborator's bank;
--   * invoice-dunning (service role) then chased the homeowner under the
--     GC's company name with that same Pay button.
-- #41 closed exactly this for change orders (20260919110000). Until financial
-- collaboration exists (a founder decision), only the PROJECT OWNER creates
-- invoices on a project. The app blocks collaborators first (app/invoice.tsx
-- and app/bill-from-estimate.tsx role gates); this is the server half, so a
-- stale client, or a write queued offline by an older build, cannot either.
-- utils/offlineQueue drops the refused queued insert with its reason in the
-- "Not saved" ledger rather than silently.
--
-- There are TWO permissive INSERT policies (invoices_insert and the duplicate
-- inv_insert_own). Permissive policies OR together, so tightening one alone
-- changes nothing — both are replaced, with the same check.
--
-- `project_id IS NULL` stays allowed for the sender's own rows: the column is
-- nullable and a project-less invoice bills nobody else's client.
--
-- Production, read-only before writing this (2026-09-19): 5 invoices, 0 whose
-- user_id differs from their project's owner, 0 with no project, 0 orphaned —
-- nothing existing is affected (INSERT policies never re-check stored rows).
--
-- UPDATE (review round 1): the insert rule alone could be walked around —
-- insert a project-less invoice (allowed), then UPDATE project_id onto the
-- GC's job, because both UPDATE policies (invoices_update and the duplicate
-- inv_update_own) were USING auth.uid() = user_id with no WITH CHECK, so the
-- new row was checked only for ownership of the row. Both now carry the same
-- project-owner WITH CHECK. USING is unchanged (he still edits his own rows);
-- a row that already sits on his own job passes, so no existing edit breaks —
-- production had 0 invoices off their project owner's account (re-counted
-- read-only 2026-09-19: 5 total, 0 non-owner). SECURITY DEFINER RPCs
-- (invoice_append_payment) and the service role are unaffected.
--
-- SELECT / DELETE are unchanged. Re-runnable: drop-if-exists then create.

drop policy if exists invoices_insert on public.invoices;
drop policy if exists inv_insert_own on public.invoices;

create policy invoices_insert on public.invoices
  for insert
  with check (
    auth.uid() = user_id
    and (
      project_id is null
      or exists (
        select 1 from public.projects p
        where p.id = invoices.project_id
          and p.user_id = auth.uid()
      )
    )
  );

create policy inv_insert_own on public.invoices
  for insert
  with check (
    auth.uid() = user_id
    and (
      project_id is null
      or exists (
        select 1 from public.projects p
        where p.id = invoices.project_id
          and p.user_id = auth.uid()
      )
    )
  );

drop policy if exists invoices_update on public.invoices;
drop policy if exists inv_update_own on public.invoices;

create policy invoices_update on public.invoices
  for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      project_id is null
      or exists (
        select 1 from public.projects p
        where p.id = invoices.project_id
          and p.user_id = auth.uid()
      )
    )
  );

create policy inv_update_own on public.invoices
  for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      project_id is null
      or exists (
        select 1 from public.projects p
        where p.id = invoices.project_id
          and p.user_id = auth.uid()
      )
    )
  );
