-- 20260726120000_autonomy_preferences.sql
-- Adds autonomy_preferences jsonb column to profiles.
-- Sibling of notification_preferences — same read/write pattern.
-- Shape v1: { pace_preapply?: boolean; leak_draft_co?: boolean }
-- Absent = ON: both v1 domains are draft-level, zero-blast-radius acts;
-- the earned gate is the real lock, the pref is the opt-out.
-- APPLIED via Supabase MCP (project nteoqhcswappxxjlpvap) — never db push.

alter table public.profiles
  add column if not exists autonomy_preferences jsonb not null default '{}'::jsonb;
