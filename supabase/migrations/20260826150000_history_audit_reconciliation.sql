-- ============================================================================
-- Reconciliation — the real gaps found by the 2026-08-26 migration-history audit.
--
-- A 65-agent audit compared every local migration against the live schema, then
-- had a skeptic independently try to refute each "already applied" verdict. Most
-- migrations were genuinely applied. This file closes the two findings that were
-- REAL objects missing from production, and documents the two that were not.
--
-- ── FIXED HERE ──────────────────────────────────────────────────────────────
-- 1. delay_events_open_notice_idx  (from 20260804120000_delay_events.sql)
--    The delay_events table was created by a hand-revised variant of that file
--    and is otherwise byte-perfect — but this partial index never made it.
--    It backs the notice-clock query ("open delay events with no notice served
--    yet"), which is the whole point of the feature: an unserved notice is a
--    contractual clock running against the GC. Without the index that query
--    degrades to a full scan.
--
-- 2. cost_seeds.deleted_at  (from 20260812093000_cost_seeds_soft_delete.sql)
--    THIS IS A LIVE BUG, not housekeeping. hooks/useCostSeeds.ts writes a
--    soft-delete tombstone to this column and its own header says: "the founder
--    applies it; migrations are deliberately not auto-run … until deleted_at
--    exists, an upsert carrying it hits a PostgREST schema-cache miss, which
--    offlineQueue classifies as TRANSIENT and re-queues UNCHANGED."
--    Net effect today: every cost-seed deletion is sitting in the offline queue,
--    correct on-device but never reaching the server. Adding the column drains
--    that queue on its own — no manual data fix needed.
--
--    NOTE FOR THE FOUNDER: this touches cost_seeds. The standing instruction is
--    not to MODIFY 20260805120000_cost_seeds.sql, and this does not — it applies
--    that migration's documented follow-up, which the app is explicitly waiting
--    on. Skip this block if you would rather apply it yourself.
--
-- ── DELIBERATELY NOT "FIXED" ────────────────────────────────────────────────
-- • owner_supplied_items policies. The audit flagged four as absent, but they
--   exist under shorter names (owner_supplied_select_own, not
--   owner_supplied_items_select_own) with identical predicates. The table IS
--   protected. Renaming live RLS to satisfy a naming convention would be churn
--   on a security surface for zero benefit.
-- • 20260525120000_ai_feature_daily_usage.sql. Its table exists nowhere and
--   NOTHING in the codebase references it — superseded by ai_daily_usage /
--   ai_usage_counters. Creating an unused table to satisfy history would be
--   worse than leaving it. Recommend retiring that file instead; not done here
--   because deleting a migration is the founder's call.
--
-- Idempotent.
-- ============================================================================

-- ── 1. The notice-clock index ───────────────────────────────────────────────
create index if not exists delay_events_open_notice_idx
  on public.delay_events (user_id, first_observed_date)
  where notices = '[]'::jsonb;

-- ── 2. cost_seeds soft-delete tombstone ─────────────────────────────────────
alter table public.cost_seeds add column if not exists deleted_at timestamptz;

comment on column public.cost_seeds.deleted_at is
  'Soft-delete tombstone. A delete is a tombstone, not a removal, so the local/server UNION merge cannot resurrect a row the GC deleted on another device. Written by hooks/useCostSeeds.ts.';
