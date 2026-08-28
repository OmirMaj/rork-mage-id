-- ============================================================================
-- deliveries — what is DUE on site, not just what arrived.
--
-- WHY. public.delivery_receipts already records that a delivery HAPPENED (BOL
-- photo, signature, damage notes). Nothing records that one was EXPECTED.
-- public.commitments carries amount / change_amount / paid_to_date /
-- signed_date and no date the material is meant to land, so the app could not
-- answer either Monday-morning question:
--
--     "What is arriving this week?"     — the look-ahead
--     "What was supposed to be here?"   — the chase
--
-- A missed delivery is not a purchasing problem. Material that does not land is
-- a crew standing around, and that cost surfaces as LABOUR, not as a late PO —
-- which is precisely why it goes unnoticed until payroll.
--
-- ── WHY 'confirmed' IS ITS OWN STATUS ───────────────────────────────────────
-- A date typed off a quote is a guess; a date the supplier confirmed is
-- something you can staff a crew around. Collapsing the two would make the
-- look-ahead lie in the most expensive direction — telling a PM to bring people
-- in for a day that was never real. utils/deliverySchedule surfaces anything
-- unconfirmed inside a 5-day window for chasing.
--
-- ── RELATIONSHIPS ───────────────────────────────────────────────────────────
-- commitment_id is NULLABLE and carries NO foreign key, deliberately: plenty of
-- material is ordered before anyone writes a commitment, and a deleted PO must
-- not cascade away the record that a delivery is still coming. A dangling id
-- simply fails to join, which is the correct degradation.
--
-- receipt_id links to the delivery_receipts row once it lands, so the schedule
-- and the receiving log are the same story rather than two.
--
-- Idempotent throughout.
-- ============================================================================

create table if not exists public.deliveries (
  id            uuid primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,

  description   text not null,
  supplier      text not null,
  commitment_id uuid,
  po_number     text,

  -- The date it is expected on site. DATE, not timestamptz: a delivery lands on
  -- a calendar day in the site's own timezone, and storing an instant would
  -- make "due today" flip a day either side of the date line.
  expected_date date not null,
  -- Arrival window when the supplier or building gives one ("07:00-11:00").
  -- In an occupied building the dock slot is often the real constraint.
  --
  -- NOT named `window`: that is a RESERVED keyword in Postgres (it heads the
  -- WINDOW clause), so an unquoted `window text` is a syntax error and a quoted
  -- "window" would have to stay quoted in every query anyone ever writes
  -- against this table. The prefix is cheaper than that trap.
  delivery_window text,

  status        text not null default 'scheduled'
                check (status in ('scheduled','confirmed','delivered','cancelled')),
  confirmed_at  timestamptz,
  delivered_at  timestamptz,
  receipt_id    uuid,

  location      text,
  received_by   text,
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- "What is coming, soonest first" — the look-ahead query. Partial: settled rows
-- are not work and are the majority over a project's life.
create index if not exists deliveries_open_expected_idx
  on public.deliveries (user_id, expected_date)
  where status in ('scheduled','confirmed');

create index if not exists deliveries_project_idx
  on public.deliveries (project_id, expected_date);

alter table public.deliveries enable row level security;

-- Owner OR an accepted project collaborator. Deliveries are FIELD work — the
-- foreman receiving the load needs to see and update them — so this follows the
-- collaborator pattern from 20260803140000, not the owner-only pattern used for
-- financial tables. Writes use the 'field' tier so a field collaborator can
-- actually mark a load received (see 20260826130000_field_role.sql).
drop policy if exists deliveries_collab_select on public.deliveries;
create policy deliveries_collab_select on public.deliveries
  for select to authenticated
  using (auth.uid() = user_id or public.can_access_project(project_id));

drop policy if exists deliveries_collab_insert on public.deliveries;
create policy deliveries_collab_insert on public.deliveries
  for insert to authenticated
  with check (auth.uid() = user_id and public.can_access_project(project_id, 'field'));

drop policy if exists deliveries_collab_update on public.deliveries;
create policy deliveries_collab_update on public.deliveries
  for update to authenticated
  using      (public.can_access_project(project_id, 'field'))
  with check (public.can_access_project(project_id, 'field'));

drop policy if exists deliveries_owner_delete on public.deliveries;
create policy deliveries_owner_delete on public.deliveries
  for delete to authenticated
  using (auth.uid() = user_id);

comment on table public.deliveries is
  'Scheduled/expected deliveries. Pairs with delivery_receipts (what actually arrived). Drives the look-ahead and the late-delivery chase in utils/deliverySchedule.';
