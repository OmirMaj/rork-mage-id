-- 20260511_inbound_leads.sql
--
-- Inbound leads captured from the GC's hosted public profile +
-- lead-capture form on the marketing site. When a homeowner finds
-- a GC and submits the contact form, a row lands here and the GC
-- gets a notification.

create table if not exists public.inbound_leads (
  id            uuid primary key default gen_random_uuid(),
  -- The GC user this lead is for. Resolved at insert time from
  -- the slug → user_id lookup (see lead-capture edge function).
  gc_user_id    uuid not null references auth.users(id) on delete cascade,
  -- Verbatim GC slug at submission time (the slug may change later).
  gc_slug       text not null,
  -- Contact info from the form
  name          text not null,
  email         text not null,
  phone         text null,
  -- Free-form project description
  project_summary text not null,
  -- Optional structured fields
  budget_band   text null, -- 'under_50k' | '50k_100k' | '100k_250k' | '250k_plus' | 'unknown'
  zip_code      text null,
  preferred_contact text null, -- 'email' | 'phone' | 'either'
  -- Source tracking
  source        text not null default 'marketing_form', -- 'marketing_form' | 'embed' | 'api'
  referrer      text null,
  utm_source    text null,
  utm_medium    text null,
  utm_campaign  text null,
  -- Status — GC moves through these as they work the lead.
  status        text not null default 'new', -- 'new' | 'contacted' | 'qualified' | 'won' | 'lost'
  status_note   text null,
  created_at    timestamptz not null default now()
);

create index if not exists inbound_leads_gc_idx on public.inbound_leads(gc_user_id, created_at desc);
create index if not exists inbound_leads_status_idx on public.inbound_leads(status);

alter table public.inbound_leads enable row level security;

-- RLS: only the GC the lead is for can read / update. Inserts are
-- done by the lead-capture edge function with service role.
create policy "inbound_leads_read_own" on public.inbound_leads
  for select to authenticated using (auth.uid() = gc_user_id);

create policy "inbound_leads_update_own" on public.inbound_leads
  for update to authenticated using (auth.uid() = gc_user_id) with check (auth.uid() = gc_user_id);

comment on table public.inbound_leads is
  'Homeowner-submitted leads from the GC public profile + marketing-site lead-capture form. Inserts go through the lead-capture edge function which resolves slug → user_id + fires webhooks/notifications.';
