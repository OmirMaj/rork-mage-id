-- D1b-2 — GC-authored rate-override cost-book store. Additive, idempotent,
-- own-rows RLS (mirrors commitments_owner_all). Applied via Supabase MCP
-- apply_migration at ship (Netlify-independent), BEFORE the OTA.
create table if not exists public.rate_overrides (
  id uuid primary key,
  user_id uuid not null,
  kind text not null,
  override_key text not null,
  value numeric not null,
  label text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.rate_overrides enable row level security;
drop policy if exists rate_overrides_owner_all on public.rate_overrides;
create policy rate_overrides_owner_all on public.rate_overrides as permissive for all to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
