-- D1c — link a project_contracts row to the EstimateRevision a proposal was
-- generated from, + an informational kind discriminator. Additive, idempotent,
-- no rewrite/NOT NULL/default — safe on the live project_contracts table.
-- Applied via Supabase MCP apply_migration at ship time (independent of the
-- Netlify/H4 block). The portal + portal_sign_contract RPC ignore these
-- columns (model-agnostic); no RLS change (existing contracts_* policies cover
-- proposals — they are project_contracts rows).
alter table public.project_contracts add column if not exists proposal_revision_id uuid;
alter table public.project_contracts add column if not exists kind text;
