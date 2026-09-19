-- 20260919110000_change_orders_owner_insert_and_tax_freeze.sql
--
-- Two change-order fixes from the 2026-09 workflow audit.
--
-- 1) #41 — A change order written by an invited collaborator never reached the
--    GC. Both INSERT policies only checked `auth.uid() = user_id`, so a Pro
--    foreman's CO went in under HIS user_id, and every SELECT policy
--    (`auth.uid() = user_id`) hides it from the project owner forever: lost
--    billable scope with no error anywhere. Until financial collaboration
--    exists (a founder decision), only the PROJECT OWNER creates change orders.
--    The app blocks collaborators before this (app/change-order.tsx role gate);
--    this is the server half, so a stale client cannot orphan a CO either.
--
--    There are TWO permissive insert policies (change_orders_insert and the
--    duplicate co_insert_own). Permissive policies OR together, so tightening
--    one alone does nothing: both are replaced with the same owner check.
--
--    Pre-check run read-only on production 2026-09-18: 4 change orders,
--    0 whose user_id differs from their project's owner, 0 with a missing
--    project, 0 project_collaborators rows — the tighter check rejects no
--    existing row and no backfill is needed.
--
-- 2) #131 — The CO screen promises "the total you approve matches what gets
--    invoiced" while the email and portal showed only the pre-tax amount, and
--    the tax itself was read live from settings on every render. The sales-tax
--    rate, tax amount and tax-inclusive total are now FROZEN on the CO when it
--    is sent, so the screen, email, portal and invoice read one number even if
--    the rate changes later. prior_approved_changes_total (#129) is the AIA
--    G701 "net change by previously authorized change orders" row, frozen the
--    same way. All four are nullable: a CO saved before this has none, and the
--    readers fall back to what they did before rather than inventing a zero.
--    The client mapper that writes them is contexts/ProjectContext.tsx
--    (context lane) — these columns must exist BEFORE that OTA, because
--    utils/offlineQueue treats an unknown column as a terminal write error.

-- ── 1. Owner-only insert ────────────────────────────────────────────────────
drop policy if exists change_orders_insert on public.change_orders;
drop policy if exists co_insert_own on public.change_orders;

create policy change_orders_insert on public.change_orders
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.projects p
      where p.id = change_orders.project_id
        and p.user_id = auth.uid()
    )
  );

-- The duplicate is recreated with the SAME check rather than dropped, so a
-- later migration that references it by name (none today) still finds it, and
-- the pair can never again disagree.
create policy co_insert_own on public.change_orders
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.projects p
      where p.id = change_orders.project_id
        and p.user_id = auth.uid()
    )
  );

-- ── 2. Frozen tax + prior-approved total ────────────────────────────────────
alter table public.change_orders add column if not exists tax_rate_pct numeric;
alter table public.change_orders add column if not exists tax_amount numeric(12,2);
alter table public.change_orders add column if not exists total_with_tax numeric(12,2);
alter table public.change_orders add column if not exists prior_approved_changes_total numeric(12,2);

comment on column public.change_orders.tax_rate_pct is
  'Sales-tax percent frozen when the CO was sent (null = sent before 2026-09-19 or never sent).';
comment on column public.change_orders.tax_amount is
  'Sales tax on change_amount at tax_rate_pct, frozen on send, rounded to cents.';
comment on column public.change_orders.total_with_tax is
  'change_amount + tax_amount, frozen on send — the figure the client approves.';
comment on column public.change_orders.prior_approved_changes_total is
  'Net change by approved COs numbered below this one (AIA G701 row), frozen on save.';
