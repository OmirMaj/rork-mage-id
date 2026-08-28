#!/usr/bin/env bash
# Repair Supabase migration history — generated 2026-08-26.
#
# WHY: 69 local migrations had no entry in the remote history table, so
# `supabase db push` wanted to replay the entire schema (including cost_seeds,
# which is off-limits, and rls_baseline, which drops/recreates policies).
#
# These 60 were verified present in the live schema by a 65-agent audit, then
# each APPLIED verdict was independently re-checked by a skeptic agent trying
# to refute it. Only verdicts that survived refutation are listed here.
#
# DELIBERATELY EXCLUDED (do NOT mark these applied):
#   20260525120000_ai_feature_daily_usage   NOT APPLIED - table absent (name-collision trap)
#   20260812093000_cost_seeds_soft_delete   NOT APPLIED - cost_seeds.deleted_at absent
#   20260804120000_delay_events             PARTIAL - missing delay_events_open_notice_idx
#   20260819160000_orphaned_tables_backfill PARTIAL - 4 owner_supplied_items policies absent
#   20260803140000_collaborator_rls_field_tables  REFUTED - a hand-revised variant was
#     applied as remote entry 20260803193952; this exact file never ran
#
# Run from the repo root. Safe to re-run.
set -euo pipefail

supabase migration repair --status applied 20260512000000
supabase migration repair --status applied 20260515000000
supabase migration repair --status applied 20260515100000
supabase migration repair --status applied 20260517090000
supabase migration repair --status applied 20260517120000
supabase migration repair --status applied 20260518120000
supabase migration repair --status applied 20260518120100
supabase migration repair --status applied 20260518140000
supabase migration repair --status applied 20260518150000
supabase migration repair --status applied 20260518160000
supabase migration repair --status applied 20260519180000
supabase migration repair --status applied 20260520180000
supabase migration repair --status applied 20260520180100
supabase migration repair --status applied 20260523120000
supabase migration repair --status applied 20260523130000
supabase migration repair --status applied 20260526120000
supabase migration repair --status applied 20260526120100
supabase migration repair --status applied 20260526120200
supabase migration repair --status applied 20260527000000
supabase migration repair --status applied 20260527000100
supabase migration repair --status applied 20260528000000
supabase migration repair --status applied 20260531000000
supabase migration repair --status applied 20260603000000
supabase migration repair --status applied 20260608000000
supabase migration repair --status applied 20260608010000
supabase migration repair --status applied 20260608120000
supabase migration repair --status applied 20260608130000
supabase migration repair --status applied 20260612200000
supabase migration repair --status applied 20260612210000
supabase migration repair --status applied 20260612210100
supabase migration repair --status applied 20260612230000
supabase migration repair --status applied 20260707120000
supabase migration repair --status applied 20260708120000
supabase migration repair --status applied 20260708130000
supabase migration repair --status applied 20260708180000
supabase migration repair --status applied 20260708190000
supabase migration repair --status applied 20260709120000
supabase migration repair --status applied 20260713120000
supabase migration repair --status applied 20260713130000
supabase migration repair --status applied 20260713140000
supabase migration repair --status applied 20260713140001
supabase migration repair --status applied 20260713150000
supabase migration repair --status applied 20260713150001
supabase migration repair --status applied 20260714160000
supabase migration repair --status applied 20260714161000
supabase migration repair --status applied 20260725120000
supabase migration repair --status applied 20260726120000
supabase migration repair --status applied 20260726120100
supabase migration repair --status applied 20260728120000
supabase migration repair --status applied 20260728140000
supabase migration repair --status applied 20260729120000
supabase migration repair --status applied 20260729160000
supabase migration repair --status applied 20260729161000
supabase migration repair --status applied 20260729180000
supabase migration repair --status applied 20260730120000
supabase migration repair --status applied 20260803110000
supabase migration repair --status applied 20260803120000
supabase migration repair --status applied 20260803120500
supabase migration repair --status applied 20260803150000
supabase migration repair --status applied 20260805120000

echo
echo 'Done. Now verify only the intended migrations remain pending:'
echo '  supabase migration list --linked'
