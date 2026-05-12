-- 20260512000000_feature_interest.sql — Phase 27.
-- Captures users opting in to be notified when a feature ships.
-- Used by the scheduler "Coming soon" stub tabs (Calendar, Workload,
-- Timeline) and any future "Notify me" CTA.

create table public.feature_interest (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  event_key   text not null,
  created_at  timestamptz default now(),
  unique (user_id, event_key)
);

create index feature_interest_event_idx on public.feature_interest(event_key);

alter table public.feature_interest enable row level security;

create policy "users select own interest"
  on public.feature_interest for select
  using (auth.uid() = user_id);

create policy "users insert own interest"
  on public.feature_interest for insert
  with check (auth.uid() = user_id);

create policy "users delete own interest"
  on public.feature_interest for delete
  using (auth.uid() = user_id);
