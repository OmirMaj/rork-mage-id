-- ============================================================================
-- building_access_rules + access_reservations — the constraint that is not on
-- the schedule.
--
-- WHY. On a fit-out in an occupied building the binding constraint is usually
-- the BUILDING, not the crew or the material: one freight elevator slot a
-- morning, a dock that takes one truck, a COI the property manager must hold
-- before anyone swings a hammer, badges that take a week.
--
-- None of that was modelled anywhere, so it failed the same way every time —
-- the truck arrives, no elevator is booked, and it leaves. public.deliveries
-- knew the date and nothing about whether the building would let it in.
--
-- ── WHY A GATE, NOT A LOG ───────────────────────────────────────────────────
-- These tables exist to be JOINED AGAINST deliveries, not browsed. The product
-- surface is utils/buildingAccess.findAccessConflicts(), which answers "which
-- of next week's loads have nowhere to land" — a reservation list nobody reads
-- would not have prevented a single turned-away truck.
--
-- ── WHY 'requested' IS ITS OWN STATUS ───────────────────────────────────────
-- Same reasoning as deliveries.confirmed: an email to the property manager is
-- not a booking. Collapsing requested into confirmed would tell a PM to send a
-- truck against a slot nobody granted.
--
-- ── RELATIONSHIPS ───────────────────────────────────────────────────────────
-- delivery_id is NULLABLE and carries NO foreign key, matching public.deliveries'
-- treatment of commitment_id: a slot is often booked for a morning before anyone
-- knows which load fills it, and deleting a delivery must not silently cancel a
-- building reservation that still exists in the building's system. A dangling id
-- fails to join, which is the correct degradation.
--
-- building_access_rules is keyed BY project_id rather than a surrogate id: a
-- project has exactly one set of building rules, and a surrogate key would
-- permit two contradictory rows with nothing to say which one gates the job.
--
-- Idempotent throughout.
-- ============================================================================

create table if not exists public.building_access_rules (
  -- The project IS the key. One building, one set of rules.
  project_id       uuid primary key references public.projects(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,

  building_contact text,
  building_phone   text,

  requires_freight_elevator boolean not null default false,
  requires_dock_reservation boolean not null default false,

  -- The BUILDING's copy of the COI, naming them as additional insured. Distinct
  -- from the GC's own policy in public.prequal_coi — same document, different
  -- holder, and it is the building's copy that stops work at the door.
  requires_coi_on_file      boolean not null default false,
  coi_on_file_at            date,

  requires_badging          boolean not null default false,
  -- Days the building takes to issue a badge. Scheduling a crew inside this
  -- window is a plan that cannot happen.
  badge_lead_time_days      integer check (badge_lead_time_days is null or badge_lead_time_days >= 0),

  work_hours                text,
  after_hours_requires_approval boolean not null default false,

  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.access_reservations (
  id            uuid primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,

  kind          text not null
                check (kind in ('freight_elevator','dock','after_hours','badging')),

  -- DATE, not timestamptz: a building grants a slot on a calendar day in its own
  -- timezone. Storing an instant would drift the booking a day either side of
  -- the date line, which is how you show up on the wrong morning.
  date          date not null,
  -- The granted window ("07:00-11:00"). NOT named `window` — reserved keyword
  -- in Postgres; see the note in 20260826200000_deliveries.sql.
  reservation_window text,

  status        text not null default 'requested'
                check (status in ('requested','confirmed','denied','cancelled')),
  -- The building's booking reference — what you quote at the loading dock.
  confirmation_ref text,

  -- Optional link to the load this slot exists for. See header: no FK, on purpose.
  delivery_id   uuid,

  requested_at  timestamptz,
  confirmed_at  timestamptz,
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The conflict query: open slots for a project, by day. Partial — settled rows
-- are not constraints and become the majority over a job's life.
create index if not exists access_reservations_open_idx
  on public.access_reservations (project_id, date)
  where status in ('requested','confirmed');

-- Resolving "is there a slot for THIS load", the per-delivery join.
create index if not exists access_reservations_delivery_idx
  on public.access_reservations (delivery_id)
  where delivery_id is not null;

alter table public.building_access_rules enable row level security;
alter table public.access_reservations   enable row level security;

-- Owner OR an accepted project collaborator, on the 'field' tier. Booking the
-- freight elevator is field work — the superintendent on site is the one who
-- calls the property manager, and a gate that forced them to ask the owner to
-- record it would simply not be used. Mirrors public.deliveries
-- (20260826200000) rather than the owner-only pattern used for financials.
drop policy if exists building_access_rules_collab_select on public.building_access_rules;
create policy building_access_rules_collab_select on public.building_access_rules
  for select to authenticated
  using (auth.uid() = user_id or public.can_access_project(project_id));

drop policy if exists building_access_rules_collab_insert on public.building_access_rules;
create policy building_access_rules_collab_insert on public.building_access_rules
  for insert to authenticated
  with check (auth.uid() = user_id and public.can_access_project(project_id, 'field'));

drop policy if exists building_access_rules_collab_update on public.building_access_rules;
create policy building_access_rules_collab_update on public.building_access_rules
  for update to authenticated
  using      (public.can_access_project(project_id, 'field'))
  with check (public.can_access_project(project_id, 'field'));

drop policy if exists building_access_rules_owner_delete on public.building_access_rules;
create policy building_access_rules_owner_delete on public.building_access_rules
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists access_reservations_collab_select on public.access_reservations;
create policy access_reservations_collab_select on public.access_reservations
  for select to authenticated
  using (auth.uid() = user_id or public.can_access_project(project_id));

drop policy if exists access_reservations_collab_insert on public.access_reservations;
create policy access_reservations_collab_insert on public.access_reservations
  for insert to authenticated
  with check (auth.uid() = user_id and public.can_access_project(project_id, 'field'));

drop policy if exists access_reservations_collab_update on public.access_reservations;
create policy access_reservations_collab_update on public.access_reservations
  for update to authenticated
  using      (public.can_access_project(project_id, 'field'))
  with check (public.can_access_project(project_id, 'field'));

drop policy if exists access_reservations_owner_delete on public.access_reservations;
create policy access_reservations_owner_delete on public.access_reservations
  for delete to authenticated
  using (auth.uid() = user_id);

comment on table public.building_access_rules is
  'What a building requires before work can happen (elevator/dock booking, COI on file, badging lead time, after-hours approval). One row per project. Joined against public.deliveries by utils/buildingAccess to surface loads with nowhere to land.';

comment on table public.access_reservations is
  'Freight elevator / dock / after-hours / badging slots requested from or granted by the building. A requested slot is NOT a booking — see utils/buildingAccess.';
