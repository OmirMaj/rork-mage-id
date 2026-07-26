-- 20260726120100_qbo_cost_lines.sql
-- Staging table for QBO Purchase/Bill line pulls before GC confirmation.
-- G11: staged rows reach job costs ONLY through explicit per-line confirmation.
-- APPLIED via Supabase MCP (project nteoqhcswappxxjlpvap) — never db push.

create table public.qbo_cost_lines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  qbo_type text not null check (qbo_type in ('purchase','bill')),
  qbo_id text not null,          -- QBO entity Id
  qbo_line_id text not null default '',
  doc_number text,
  vendor text,
  txn_date date,
  amount numeric not null,
  description text,
  account_name text,
  qbo_customer_ref text,         -- line-level CustomerRef.value when present
  project_id text,               -- resolved via projects.qbo_customer_id; null = needs assignment
  status text not null default 'staged' check (status in ('staged','confirmed','rejected')),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, qbo_type, qbo_id, qbo_line_id)
);

alter table public.qbo_cost_lines enable row level security;

create policy qbo_cost_lines_owner on public.qbo_cost_lines
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index qbo_cost_lines_user_status on public.qbo_cost_lines (user_id, status);

-- Per-entity cost-pull cursors, separate from the invoice-pull's last_sync_at
-- (sharing would skip cost history on first run since the invoice pull already
-- advances it). TWO columns because Purchase and Bill are independently
-- paginated queries: a single shared cursor advances past the unpulled
-- backlog of whichever entity returned a full page whenever the other
-- entity has newer rows (first-run backfill silently drops history).
alter table public.qbo_connections
  add column if not exists purchase_pull_last_at timestamptz,
  add column if not exists bill_pull_last_at timestamptz;
