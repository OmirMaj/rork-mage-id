-- 20260526120000_qbo_connections.sql
-- One QBO Online connection per MAGE user. Tokens are sensitive; RLS owner-only.

create table if not exists public.qbo_connections (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  realm_id         text not null,
  environment      text not null check (environment in ('sandbox','production')) default 'production',
  access_token     text not null,
  refresh_token    text not null,
  access_expires_at timestamptz not null,
  company_name     text,
  status           text not null default 'connected'
                     check (status in ('connecting','connected','reauth_required','error','disconnected')),
  last_sync_at     timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.qbo_connections enable row level security;

drop policy if exists qbo_connections_owner on public.qbo_connections;
create policy qbo_connections_owner on public.qbo_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at sticky trigger — reuses the canonical shared helper.
drop trigger if exists trg_qbo_connections_touch on public.qbo_connections;
create trigger trg_qbo_connections_touch
  before update on public.qbo_connections
  for each row execute function public.update_updated_at_column();
