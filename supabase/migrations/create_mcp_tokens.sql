-- mcp_tokens — personal access tokens that let a user connect Claude (or any
-- MCP client) to their MAGE ID data through the `mcp` edge function.
--
-- We store ONLY the SHA-256 hash of each token, never the raw value. The raw
-- token is shown to the user exactly once at creation time (in
-- app/connect-claude.tsx) and then is unrecoverable — same model as a GitHub
-- PAT. `token_prefix` keeps the first few visible characters so the user can
-- tell two tokens apart in the list without us ever storing the secret.
--
-- Revocation is non-destructive (revoked_at timestamp) so a token can be
-- killed instantly while keeping an audit row. The `mcp` server treats any
-- row with revoked_at IS NOT NULL as dead.

create table if not exists public.mcp_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token_hash   text not null unique,        -- sha256(raw token), hex
  token_prefix text not null,               -- e.g. "mage_mcp_AbCd" for display
  name         text,                        -- user-supplied label ("Claude Desktop")
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists mcp_tokens_user_idx on public.mcp_tokens(user_id);
create index if not exists mcp_tokens_hash_idx on public.mcp_tokens(token_hash);

alter table public.mcp_tokens enable row level security;

-- Users manage only their own tokens. The hash column is never selected by
-- the app (the connect-claude screen reads id/name/prefix/timestamps only),
-- and the `mcp` / `mcp-token` edge functions use the service role, which
-- bypasses RLS. So these policies just protect any direct client access.
drop policy if exists "mcp_tokens_select_own" on public.mcp_tokens;
create policy "mcp_tokens_select_own" on public.mcp_tokens
  for select using (auth.uid() = user_id);

drop policy if exists "mcp_tokens_insert_own" on public.mcp_tokens;
create policy "mcp_tokens_insert_own" on public.mcp_tokens
  for insert with check (auth.uid() = user_id);

drop policy if exists "mcp_tokens_update_own" on public.mcp_tokens;
create policy "mcp_tokens_update_own" on public.mcp_tokens
  for update using (auth.uid() = user_id);

drop policy if exists "mcp_tokens_delete_own" on public.mcp_tokens;
create policy "mcp_tokens_delete_own" on public.mcp_tokens
  for delete using (auth.uid() = user_id);
