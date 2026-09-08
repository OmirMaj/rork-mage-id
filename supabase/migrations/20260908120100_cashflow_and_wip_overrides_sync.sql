-- 20260908120100_cashflow_and_wip_overrides_sync.sql
--
-- Audit 2026-09-07, Do-next #12 — two pieces of financial state that live only
-- on the device that typed them, while the bank-facing document they produce
-- syncs to the server.
--
-- THE FAILURE, concretely. A GC sits at his laptop and types $340,000 of
-- self-performed labor into the WIP cost-to-date override, because the app's
-- automatic figure (subs + materials) does not know what his own crews cost.
-- The override is written to AsyncStorage under `mageid_wip_cost_overrides_<uid>`
-- (app/wip-report.tsx:51) and nowhere else. Later he opens WIP on his PHONE,
-- where that map is empty, and the screen silently falls back to the
-- subs-plus-materials lower bound. He freezes the period and exports it. The
-- locked period DOES sync (contexts/WipContext.tsx, `mageid_wip_periods` →
-- server), so what reaches the surety is a schedule that quietly reverted to a
-- number he already corrected — and nothing on the screen said so.
--
-- The same shape holds for cash flow: utils/cashFlowStorage.ts keeps the
-- starting balance, the expense list, expected payments, payment terms and
-- daily overhead in `mage_cashflow_data`, device-only. A GC who sets it up on
-- the laptop opens the phone to a $0 starting balance on the one screen whose
-- entire purpose is answering "can I make payroll on Friday".
--
-- WHAT THIS MIGRATION DOES. Gives both a server home, owner-scoped by RLS, so
-- the client can read-through on load and write-through on change via the
-- normal utils/offlineQueue.ts path.
--
-- THE MERGE MODEL, stated plainly because it is a real limitation:
--
--   * `wip_cost_overrides` is ONE ROW PER PROJECT. That is deliberate. The
--     device-local shape is a single Record<projectId, number> blob, and
--     syncing it as a blob would mean the last device to save wins for EVERY
--     project — so correcting Henderson on the phone would wipe the Ridgeline
--     override typed on the laptop an hour earlier. Per-project rows merge.
--
--   * `cash_flow_settings` keeps `expenses` and `expected_payments` as jsonb,
--     which IS last-writer-wins on those two lists. Splitting them into rows is
--     the better model and is not done here: it would be a rewrite of
--     utils/cashFlowStorage.ts rather than a sync. This is still strictly
--     better than device-only — the failure it closes is an EMPTY second
--     device, not a merge conflict — but a GC editing the expense list on two
--     devices at once will lose one side's edits, and the client should not
--     pretend otherwise. Do not describe this column as merged.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS before CREATE.
-- Reversible: drop both tables. Nothing else references them; the AsyncStorage
-- path keeps working on its own if the client half is never shipped.
--
-- Verify after apply:
--   select tablename, policyname, cmd from pg_policies
--     where tablename in ('cash_flow_settings','wip_cost_overrides');
--   -- as anon, both must be invisible:
--   select count(*) from public.cash_flow_settings;   -- expect 0 rows / denied
--   -- as the owner, a round-trip must survive a re-login on another device.

-- ── 1. cash flow setup ──────────────────────────────────────────────────────
create table if not exists public.cash_flow_settings (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  starting_balance     numeric not null default 0,
  -- The instant the balance was last set. Invoice payments dated AFTER this get
  -- added to the effective balance, so the GC is not re-typing his bank balance
  -- every time a check clears (utils/cashFlowStorage.ts documents the rule).
  -- A timestamptz, not a date: it is an instant, not a calendar day.
  balance_as_of        timestamptz,
  expenses             jsonb not null default '[]'::jsonb,
  expected_payments    jsonb not null default '[]'::jsonb,
  default_payment_terms text not null default 'net_30',
  daily_overhead_cost  numeric not null default 0,
  setup_complete       boolean not null default false,
  updated_at           timestamptz not null default now()
);

alter table public.cash_flow_settings enable row level security;

drop policy if exists cash_flow_settings_owner_all on public.cash_flow_settings;
create policy cash_flow_settings_owner_all on public.cash_flow_settings
  as permissive for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── 2. WIP cost-to-date overrides ───────────────────────────────────────────
-- One row per project, not one blob per user — see the merge note in the header.
create table if not exists public.wip_cost_overrides (
  user_id      uuid not null references auth.users(id) on delete cascade,
  project_id   uuid not null,
  -- COST, not revenue. This is what the job has cost the GC to date, including
  -- his own crews' labor, which is precisely the part the automatic figure
  -- (subs + materials + receipts) cannot see. Naming it here because this repo
  -- has been bitten by an `actual` that was quietly a revenue number.
  cost_to_date numeric not null,
  updated_at   timestamptz not null default now(),
  primary key (user_id, project_id)
);

alter table public.wip_cost_overrides enable row level security;

drop policy if exists wip_cost_overrides_owner_all on public.wip_cost_overrides;
create policy wip_cost_overrides_owner_all on public.wip_cost_overrides
  as permissive for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists wip_cost_overrides_user_id_idx
  on public.wip_cost_overrides using btree (user_id);
