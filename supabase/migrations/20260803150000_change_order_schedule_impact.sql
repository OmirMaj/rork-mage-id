-- ============================================================================
-- change_orders: persist the schedule-impact fields the app has always written.
--
-- FOUND WHILE WIRING CO → CPM REFLOW. Verified against production
-- information_schema: of the schedule-impact fields the client sends, ONLY
-- `audit_trail` exists. Neither `schedule_impact_days` nor
-- `schedule_impact_applied` is a real column.
--
-- Two consequences, both live today:
--
--   1. `scheduleImpactDays` — the "+8 days" a GC types on a change order —
--      HAS NEVER BEEN PERSISTED SERVER-SIDE. It lives in AsyncStorage only, so
--      it does not survive a reinstall and does not reach a second device. The
--      contractual schedule impact of every change order is, in effect, a local
--      note.
--
--   2. The client already sends `schedule_impact_applied` on CO update. Against
--      a table without that column PostgREST returns a schema-cache miss, which
--      utils/offlineQueue.ts deliberately classifies as TRANSIENT (so a genuine
--      cold cache doesn't burn the retry budget). The mutation therefore
--      re-queues forever: nothing is lost, nothing is ever written, and no error
--      surfaces to the user.
--
-- This is also why the reflow work hangs idempotency on `audit_trail` rather
-- than on `schedule_impact_applied` — audit_trail is the only one of the two
-- that actually round-trips. That stays true after this migration; the column
-- below is a convenience mirror, never the source of truth.
--
-- All four columns are nullable with no default → no table rewrite, no lock of
-- consequence on a table this size. Idempotent.
-- ============================================================================

-- The contractual schedule impact in working days, as entered/parsed on the CO.
alter table public.change_orders
  add column if not exists schedule_impact_days integer;

-- Convenience mirror of "the reflow has been applied". NOT authoritative —
-- utils/coScheduleReflowCore.ts checks the audit_trail marker first precisely
-- because that column is guaranteed to have synced.
alter table public.change_orders
  add column if not exists schedule_impact_applied boolean not null default false;

-- The AI-identified task ids (from AIChangeOrderImpact's affectedTasks[]) and
-- the task the GC actually picked to absorb the days. Stored so the anchor
-- survives a device swap — without them a fresh device falls back to
-- estimate-link matching or asks the user to place the days again.
alter table public.change_orders
  add column if not exists schedule_impact_task_ids jsonb;

alter table public.change_orders
  add column if not exists schedule_anchor_task_id text;

comment on column public.change_orders.schedule_impact_days is
  'Contractual schedule impact in working days. Was AsyncStorage-only before 20260803150000.';
comment on column public.change_orders.schedule_impact_applied is
  'Convenience mirror only. The authoritative "already reflowed" signal is the '
  'CO_REFLOW_ACTION entry in audit_trail — see utils/coScheduleReflowCore.ts.';

-- Approved-but-unapplied is the set project-detail lists as "place these days
-- on the schedule". Partial index keeps that lookup cheap without indexing
-- every historical CO.
create index if not exists change_orders_pending_reflow_idx
  on public.change_orders (project_id)
  where schedule_impact_applied = false and schedule_impact_days is not null;

-- ============================================================================
-- VERIFY AFTER APPLYING
--
-- 1. All four columns present:
--    select column_name, data_type, is_nullable, column_default
--    from information_schema.columns
--    where table_schema='public' and table_name='change_orders'
--      and column_name like 'schedule_%' order by column_name;
--
-- 2. The stuck writes drain. Before applying, an offline queue on a device that
--    edited a CO will hold re-queued mutations. After applying, PostgREST needs
--    its schema cache refreshed (Supabase does this automatically within ~a
--    minute, or NOTIFY pgrst, 'reload schema'). Then foreground the app and
--    confirm the queue empties — utils/offlineQueue.ts drains on foreground.
--
-- 3. Round-trip check: set a schedule impact on a CO, force-close the app,
--    reopen, and confirm the value survives. That is the behaviour that has
--    never worked.
-- ============================================================================
