-- 20260511_webhook_endpoints.sql
--
-- Outbound webhook system: stores user-managed webhook destinations
-- and signing secrets so MAGE ID can fire on key events (invoice_paid,
-- rfi_answered, project_created, subscription_purchased, etc.) into
-- the user's chosen receiver (Zapier, Make, n8n, custom server).
--
-- Why this exists: Procore advertises "500+ integrations". With one
-- webhook endpoint pointed at a Zapier hook URL, the user gets access
-- to 6,000+ Zapier-compatible apps at $0 cost.

create table if not exists public.webhook_endpoints (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  url         text not null check (url like 'https://%'),
  label       text not null default 'Unnamed webhook',
  -- HMAC-SHA256 signing secret. Receiver verifies the X-MAGE-Signature
  -- header to confirm the payload originated from MAGE ID and wasn't
  -- tampered with. Generated client-side on create; never displayed
  -- after first reveal.
  signing_secret text not null,
  -- Subset of supported event kinds this endpoint cares about.
  -- NULL = subscribe to all event kinds.
  event_filter text[] null,
  enabled     boolean not null default true,
  -- Diagnostics
  last_fired_at  timestamptz null,
  last_status    int null,
  last_error     text null,
  fire_count     int not null default 0,
  fail_count     int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists webhook_endpoints_user_idx on public.webhook_endpoints(user_id);

-- RLS: only the owner can see / mutate their endpoints. The edge
-- function uses the service role to fire.
alter table public.webhook_endpoints enable row level security;

create policy "webhook_endpoints_read_own" on public.webhook_endpoints
  for select to authenticated using (auth.uid() = user_id);

create policy "webhook_endpoints_insert_own" on public.webhook_endpoints
  for insert to authenticated with check (auth.uid() = user_id);

create policy "webhook_endpoints_update_own" on public.webhook_endpoints
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "webhook_endpoints_delete_own" on public.webhook_endpoints
  for delete to authenticated using (auth.uid() = user_id);

comment on table public.webhook_endpoints is
  'User-managed outbound webhook destinations. Edge function webhook-dispatch reads enabled endpoints and POSTs event payloads with HMAC signature.';

comment on column public.webhook_endpoints.signing_secret is
  'HMAC-SHA256 secret. Receivers verify X-MAGE-Signature: sha256=<hex(hmac(secret, raw_body))>. Stored plaintext — these are low-stakes shared secrets, not user passwords.';
