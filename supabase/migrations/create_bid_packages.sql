-- bid_packages + bid_package_bids — the buyout module.
--
-- Buyout is the period after a GC wins a job and converts estimate
-- "carry" prices into actual signed subcontracts. The delta between
-- carry and signed amount is the GC's buyout savings — typically the
-- biggest margin lever on a residential project.
--
-- A BidPackage groups one or more estimate line items into a scope
-- the GC sends out to subs ("Plumbing rough-in", "Drywall hang &
-- finish"). Each package collects multiple BidPackageBid rows (one
-- per sub who quoted it). Awarding a bid creates a Commitment via
-- the existing commitments path and stamps awarded_bid_id +
-- awarded_commitment_id on the package.
--
-- RLS: owner-scoped. Both tables are private to the GC's user_id.
-- Subs see bids via the existing prequal / sub_portal flow, not here.

create table if not exists public.bid_packages (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  csi_division text,
  phase text,
  scope_description text,
  linked_estimate_item_ids jsonb default '[]'::jsonb,
  estimate_budget numeric not null default 0,
  status text not null default 'open',
  due_date timestamptz,
  required_by_date timestamptz,
  awarded_bid_id uuid,
  awarded_commitment_id uuid,
  buyout_savings numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bid_packages enable row level security;
drop policy if exists bid_packages_owner_all on public.bid_packages;
create policy bid_packages_owner_all on public.bid_packages
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists bid_packages_user_id_idx on public.bid_packages (user_id);
create index if not exists bid_packages_project_id_idx on public.bid_packages (user_id, project_id);
create index if not exists bid_packages_status_idx on public.bid_packages (user_id, status);

create table if not exists public.bid_package_bids (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  package_id uuid not null references public.bid_packages(id) on delete cascade,
  subcontractor_id uuid,
  vendor_name text,
  amount numeric not null default 0,
  includes text,
  excludes text,
  terms text,
  source text,
  status text not null default 'received',
  submitted_at timestamptz not null default now(),
  normalized_adjustment numeric,
  normalized_adjustment_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bid_package_bids enable row level security;
drop policy if exists bid_package_bids_owner_all on public.bid_package_bids;
create policy bid_package_bids_owner_all on public.bid_package_bids
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists bid_package_bids_user_id_idx on public.bid_package_bids (user_id);
create index if not exists bid_package_bids_package_id_idx on public.bid_package_bids (user_id, package_id);
-- Code-review #9: queries like "every bid I've received from this sub
-- across all projects" otherwise full-scan the table.
create index if not exists bid_package_bids_subcontractor_id_idx on public.bid_package_bids (user_id, subcontractor_id);
