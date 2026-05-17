-- Client financing (hosted-link MVP).
--
-- profiles.financing: GC-level FinancingConfig (jsonb), same pattern as
-- theme_colors. Absent/null ⇒ feature off.
alter table public.profiles
  add column if not exists financing jsonb;

-- financing_referrals: funnel attribution. id == the opaque refToken that
-- is the ONLY identifier placed in the outbound URL. Edge functions use
-- the service role (RLS-bypassing) and resolve rows by id; the GC sees
-- only their own rows.
create table if not exists public.financing_referrals (
  id text primary key,
  project_id uuid references public.projects(id) on delete cascade,
  gc_user_id uuid not null references auth.users(id) on delete cascade,
  partner_name text not null default '',
  amount_cents integer not null default 0,
  status text not null default 'created'
    check (status in ('created','clicked','prequalified','funded','declined')),
  source text not null default 'invoice'
    check (source in ('estimate','invoice','portal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.financing_referrals enable row level security;

-- The GC owns their referral rows (read + write). Homeowner is anonymous
-- and never queries this table directly — the edge functions use the
-- service role, which bypasses RLS.
drop policy if exists financing_referrals_owner_all on public.financing_referrals;
create policy financing_referrals_owner_all on public.financing_referrals
  for all to authenticated
  using (gc_user_id = auth.uid())
  with check (gc_user_id = auth.uid());

create index if not exists financing_referrals_gc_idx
  on public.financing_referrals (gc_user_id);
create index if not exists financing_referrals_project_idx
  on public.financing_referrals (project_id);
