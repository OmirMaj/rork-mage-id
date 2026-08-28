-- ============================================================================
-- RFI sub attribution — WHICH sub is sitting on this question.
--
-- utils/rfiHoldTime has always split RFI custody per side and reported
-- `subDays` — how long the sub side held it. What was missing was identity:
-- `rfis.assigned_to` is free text (a name someone typed), and the handoff log
-- records only ROLES ('gc' | 'architect' | 'sub' | …). So the app could say a
-- sub sat on an RFI for nine days and not say which sub.
--
-- That made a real signal unusable twice over:
--   • the sub scorecard had no RFI factor at all, because it could not
--     attribute the delay to a scorecard row;
--   • a delay claim citing sub-side hold time had no name attached to it.
--
-- With this column, utils/subScorecard gains an `rfi_responsiveness` factor
-- (mean sub-side hold, zero-at 10 days, minimum 2 measurable RFIs).
--
-- Nullable on purpose and forever:
--   • an RFI to an architect, engineer or owner has no sub;
--   • every row that predates this column keeps working and simply scores
--     nobody — the factor reports applicable:false rather than inventing a
--     neutral value.
--
-- No FK to subcontractors: sub rows are user-scoped and can be deleted, and a
-- deleted sub must not cascade-delete or block an RFI that is part of the
-- project record. A dangling id just fails to match any scorecard row, which
-- is the correct degradation.
--
-- Additive, idempotent, nullable, no default → no table rewrite.
-- ============================================================================

alter table public.rfis add column if not exists assigned_sub_id text;

-- ── THE CUSTODY CHAIN ITSELF WAS NEVER PERSISTED ────────────────────────────
-- Found by the 2026-08-26 capability audit, and it is worse than a gap.
--
-- RFI.ballInCourt and RFI.handoffs[] are the whole basis of hold-time
-- accounting — utils/rfiHoldTime replays the handoff chain to work out who sat
-- on a question and for how long. Neither column existed in ANY migration, and
-- neither write path in ProjectContext sent them.
--
-- The read path then made it destructive rather than merely lossy: rfisQuery
-- maps server rows (with no ballInCourt/handoffs), then saveLocal()s that
-- stripped result over the AsyncStorage cache. So a GC could log a full
-- custody chain, and the next sync would erase it — locally as well as
-- server-side. Every RFI came back `measurable:false`, which reads as "no
-- delay" rather than "we lost the evidence".
--
-- That silently disarmed: the RFI latency figures, any delay claim resting on
-- owner-side hold time, and (as of the same day) the rfi_responsiveness factor
-- on the sub scorecard.
--
-- jsonb for handoffs mirrors how submittals store review_cycles and change
-- orders store audit_trail — an append-only log read as a whole, never queried
-- field-by-field.
alter table public.rfis add column if not exists ball_in_court text;
alter table public.rfis add column if not exists handoffs jsonb;

comment on column public.rfis.ball_in_court is
  'Who currently holds this RFI: gc | architect | engineer | owner | sub | closed. Drives utils/rfiHoldTime and the "waiting on" surfaces.';
comment on column public.rfis.handoffs is
  'Append-only custody log (RFIHandoff[]): at / fromParty / toParty / note / byUserId / byUserName. Replayed by utils/rfiHoldTime to attribute hold days per side. Without it every RFI reads as unmeasurable.';

comment on column public.rfis.assigned_sub_id is
  'Subcontractor.id this RFI sits with when ball_in_court = ''sub''. Nullable: architect/owner RFIs and legacy rows have none and score no sub. Feeds the rfi_responsiveness factor in utils/subScorecard.';

-- "Which RFIs is this sub holding?" — the scorecard and any sub-facing view.
-- Partial: most RFIs never go to a sub.
create index if not exists rfis_assigned_sub_id_idx
  on public.rfis (assigned_sub_id)
  where assigned_sub_id is not null;
