-- SECURITY hardening (audit follow-up): MCP personal-access tokens never
-- expired. A column DEFAULT auto-expires every NEW token in 1 year with no
-- change to the mint path; the `mcp` reader enforces it (see
-- supabase/functions/mcp/index.ts userForToken: expires_at is null OR > now).
-- Existing rows keep NULL (grandfathered). Applied to prod via MCP.

alter table public.mcp_tokens
  add column if not exists expires_at timestamptz default (now() + interval '1 year');
