-- ============================================================================
-- cost_seeds.deleted_at — make a delete survive the merge.
--
-- FOLLOW-UP TO 20260805120000_cost_seeds.sql, WHICH IS ALREADY APPLIED.
-- public.cost_seeds exists in production, so the column arrives as its own
-- append-only file. Do not fold this into the original migration: the deployed
-- database has already run that one and will never run it again.
--
-- ── WHY A SOFT DELETE ───────────────────────────────────────────────────────
-- hooks/useCostSeeds reconciles local and server by UNION — a row present on
-- either side is kept, because a plain server-wins refetch would revert an edit
-- still sitting in the offline queue. A union has no way to express absence:
--
--   1. contractor deletes their Framing rate; it goes from the local cache and
--      a delete is queued
--   2. the screen refocuses before the queue drains. The refetch still sees the
--      row server-side, the union re-adds it, and it is persisted locally again
--   3. the queued delete finally lands. Now the row is gone server-side but
--      present locally — so the backfill helpfully upserts it BACK
--
-- The rate the contractor deleted returns, on every device, forever. A hard
-- delete cannot be reconciled against a copy that has not heard about it yet;
-- a tombstone can, because it is itself a row that can win a merge.
--
-- utils/costSeedCore.activeSeeds hides tombstones from every consumer, and
-- pruneTombstones drops them after 180 days — long past any offline window
-- that could still be holding a live copy to resurrect.
--
-- ── WHY NOT NOT NULL ────────────────────────────────────────────────────────
-- Every existing row is live. A NOT NULL column would need a default, and any
-- non-null default would tombstone the whole table on the way in.
-- ============================================================================

ALTER TABLE public.cost_seeds
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.cost_seeds.deleted_at IS
  'Soft-delete tombstone. NULL = live. Set = the contractor removed this rate; '
  'the row is kept so the delete can beat a stale copy on another device that '
  'has not synced yet (a hard delete is indistinguishable from "never seen it" '
  'in the union merge hooks/useCostSeeds does). Hidden from consumers by '
  'costSeedCore.activeSeeds; pruned after 180 days by pruneTombstones.';

-- ============================================================================
-- VERIFY AFTER APPLYING
--
-- 1. The column is there and nullable:
--    select column_name, data_type, is_nullable
--    from information_schema.columns
--    where table_schema='public' and table_name='cost_seeds'
--      and column_name='deleted_at';
--    -- expect: deleted_at | timestamp with time zone | YES
--
-- 2. Nothing was tombstoned by the migration itself:
--    select count(*) from public.cost_seeds where deleted_at is not null;
--    -- expect 0
--
-- 3. THE BUG THIS FIXES, end to end. Seed a rate, let it sync, delete it, then
--    force a refetch (background/foreground the app) BEFORE the queue drains:
--    the rate must stay gone. Then confirm server-side:
--    select id, rate, deleted_at from public.cost_seeds where id='seed-framing-sf';
--    -- expect exactly one row, deleted_at NOT NULL
--
-- 4. Cross-device: delete on device A, foreground device B. The rate must
--    disappear on B rather than being pushed back up by B's backfill.
--
-- 5. Re-stating a deleted rate revives it (the new statement is newer than the
--    tombstone, so it wins the merge): re-add Framing in app/cost-seed and
--    confirm deleted_at goes back to NULL.
-- ============================================================================
