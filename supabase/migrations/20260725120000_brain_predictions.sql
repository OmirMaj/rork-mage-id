-- 20260725120000_brain_predictions.sql — Brain v3 outcome-learning ledger.
-- APPLIED to prod via Supabase MCP apply_migration 2026-07-25 (verified: RLS on,
-- owner policy, partial open-index + subject index). Repo record.
create table public.brain_predictions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id text,
  kind text not null check (kind in (
    'pace_suggestion_applied','delay_ripple_applied','leak_flag',
    'estimate_confidence_snapshot','judges_verdict','instant_bid_sent',
    'bid_score','leveling_adjustment')),
  subject_id text not null,
  payload jsonb not null default '{}'::jsonb,
  predicted_at timestamptz not null default now(),
  resolved_at timestamptz,
  outcome jsonb
);
alter table public.brain_predictions enable row level security;
create policy brain_predictions_owner on public.brain_predictions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index brain_predictions_user_kind_open
  on public.brain_predictions (user_id, kind) where resolved_at is null;
create index brain_predictions_user_subject
  on public.brain_predictions (user_id, kind, subject_id);
