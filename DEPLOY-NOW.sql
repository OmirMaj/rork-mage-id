-- ============================================================
-- MAGE ID — paste-ready deploy, regenerated 2026-08-28
-- 11 migrations, in order. All idempotent.
--   1. AP payment reconciliation
--   2. field role (unblocks the Field invite)
--   3. project_financials split (phase 1)
--   4. history reconciliation   <- cost_seeds.deleted_at LIVE BUG
--   5. RFI sub attribution + custody chain  <- LIVE DATA LOSS
--   6. portal link expiry columns
--   7. portal expiry cron
--   8. portal_get_snapshot_v2 (expiry-aware)
--   9. deliveries (scheduled/expected loads)
--  10. building access rules + reservations
--  11. delivery_receipts.delivery_id  <- receiving now writes this table
-- EXCLUDED: ..._drop_legacy.sql (phase 2 — after the OTA)
-- ============================================================

-- ─── 20260826120000_ap_payment_reconciliation ───
-- AP payment reconciliation — how a sub invoice actually got paid.
--
-- "Mark paid" was a bare status flip: the row said `paid` and stamped paid_at
-- (when the GC TAPPED the button), but recorded nothing about the payment
-- itself. So the check written from the bank and the invoice closed in MAGE
-- were two disconnected facts — nothing to reconcile against a bank statement,
-- and no answer to "which check paid this?" three months later at tax time.
--
-- MAGE deliberately does NOT move money (that would make it a payment
-- processor — see docs/audits/2026-08-26-moat-fixes.md, decision #5, founder
-- chose reconciliation-only). These columns record the payment the GC made
-- ELSEWHERE, so paid-vs-owed reconciles and the 1099/audit trail is real.
--
--   payment_method    — 'check' | 'ach' | 'card' | 'cash' | 'other'
--   payment_reference — check number, ACH trace, confirmation code
--   paid_on           — the DATE money actually left the account. Distinct from
--                       paid_at (when the GC recorded it in the app); a check
--                       written Friday and logged Monday must reconcile to
--                       Friday's bank statement, not Monday's.
--
-- Additive, idempotent, nullable, no default → no table rewrite, safe on the
-- live sub_submitted_invoices table. Existing paid rows stay valid and simply
-- read as "unreconciled" until the GC fills the detail in.
alter table public.sub_submitted_invoices add column if not exists payment_method text;
alter table public.sub_submitted_invoices add column if not exists payment_reference text;
alter table public.sub_submitted_invoices add column if not exists paid_on date;

-- Constrain the method vocabulary so the client and any future 1099 export
-- agree on spelling. NOT VALID so the check applies to new/updated rows without
-- scanning (and failing on) any legacy value already in the table.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sub_submitted_invoices_payment_method_check'
  ) then
    alter table public.sub_submitted_invoices
      add constraint sub_submitted_invoices_payment_method_check
      check (payment_method is null or payment_method in ('check','ach','card','cash','other'))
      not valid;
  end if;
end $$;

-- "Which payments landed in this bank period?" — the reconciliation query.
-- Partial: only paid, reconciled rows carry a date.
create index if not exists sub_submitted_invoices_paid_on_idx
  on public.sub_submitted_invoices (paid_on)
  where paid_on is not null;

-- ─── 20260826130000_field_role ───
-- ============================================================================
-- The 'field' collaborator role — server side.
--
-- WHY. 20260803140000_collaborator_rls_field_tables.sql shipped collaborator
-- RLS for field tables only and said so in its own header:
--
--     "Financial tables … are INTENTIONALLY NOT INCLUDED. There is currently
--      no role that separates field access from financial access … it should
--      be unlocked by a real 'field' role rather than by widening 'editor'."
--
-- This is that role. A foreman or sub gets the operational job — schedule,
-- daily reports, photos, RFIs, punch, time — and never the money.
--
-- ── THE BLOCKER THIS FIXES ──────────────────────────────────────────────────
-- The client already ships a 'field' option in the invite UI (utils/
-- roleBlinding.ts, CollaboratorsManager). It could not work: role carries
-- CHECK (role in ('owner','editor','viewer')), so every field invite was
-- rejected by the database, and the project-invite edge function rejected it
-- again with a 400. Both are fixed here / alongside.
--
-- ── ROLE TIERS ──────────────────────────────────────────────────────────────
-- can_access_project(pid, min_role) gains a middle tier:
--
--     'editor'  → owner, editor            (unchanged — real editing)
--     'field'   → owner, editor, field     (NEW — logging field work)
--     'viewer'  → any accepted collaborator (default, unchanged)
--
-- Field-table WRITE policies move from the 'editor' tier to the 'field' tier.
-- Without that a foreman could open a daily report and not save it, which is
-- the entire point of the role.
--
-- ── WHAT THIS DOES **NOT** FIX — READ THIS ──────────────────────────────────
-- Financial TABLES are already safe. Verified against live pg_policies on
-- 2026-08-26: invoices, change_orders, commitments, aia_pay_apps, lien_waivers,
-- draw_periods and wip_periods are ALL owner-only (auth.uid() = user_id). No
-- collaborator of any role — including editor and viewer — can read them.
--
-- The residual leak is the projects ROW. Field users need projects.schedule,
-- and projects_select is `auth.uid() = user_id OR is_project_collaborator(id)`,
-- so a field collaborator can read the whole row — including the financial
-- jsonb columns estimate, linked_estimate, target_budget, estimate_versions.
--
-- Postgres RLS is ROW-level. It cannot blind columns, and column GRANTs apply
-- per database role (every app user is `authenticated`), so they cannot
-- distinguish one collaborator from another. Closing this needs EITHER:
--   (a) splitting those jsonb columns into a project_financials table with its
--       own owner+editor policy, or
--   (b) denying field users projects_select and serving them a safe view.
-- Both change the core project read path and are a founder decision, tracked
-- in docs/audits/2026-08-26-moat-fixes.md.
--
-- Until then: the client blinds financials for field users (utils/roleBlinding,
-- fails closed), which stops the in-app case. A field user who bypasses the app
-- and calls PostgREST directly with their own token can still read those
-- columns. That is the honest boundary today.
--
-- WRITE access to projects is NOT affected: projects_update already requires
-- the 'editor' tier, so a field user cannot overwrite the estimate jsonb.
--
-- Idempotent throughout.
-- ============================================================================

-- ── 1. Allow the role to exist ──────────────────────────────────────────────
alter table public.project_collaborators
  drop constraint if exists project_collaborators_role_check;
alter table public.project_collaborators
  add constraint project_collaborators_role_check
  check (role in ('owner','editor','viewer','field'));

-- ── 2. Teach the access helpers the new tier ────────────────────────────────
create or replace function public.can_access_project(pid uuid, min_role text default 'viewer')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- the project owner
    exists (
      select 1 from public.projects p
      where p.id = pid and p.user_id = auth.uid()
    )
    -- …or an accepted collaborator at or above the required tier
    or exists (
      select 1 from public.project_collaborators pc
      where pc.project_id = pid
        and pc.user_id = auth.uid()
        and pc.status = 'accepted'
        and case min_role
              when 'editor' then pc.role in ('owner','editor')
              -- 'field' = may log field work. Deliberately EXCLUDES 'viewer':
              -- a viewer is read-only by definition, so letting them write
              -- field data here would silently widen that role.
              when 'field'  then pc.role in ('owner','editor','field')
              else true
            end
    );
$$;

-- TEXT overload. time_entries.project_id and field_tickets.project_id are TEXT,
-- not uuid, so policies on those tables resolve to this signature. It exists in
-- production but was created OUT OF BAND — no migration in this repo declares
-- it, which the 2026-08-26 migration-history audit surfaced. Without it, this
-- file (and 20260803140000) raise 42883 on those two tables when replayed into
-- a FRESH database, because Postgres has no implicit text->uuid cast.
--
-- Declared here so the repo is self-sufficient. It is a thin delegating wrapper:
-- it casts and forwards, so the 'field' tier added above flows through it
-- automatically and the two signatures can never disagree.
create or replace function public.can_access_project(pid text, min_role text default 'viewer')
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare u uuid;
begin
  begin u := pid::uuid; exception when others then return false; end;
  return public.can_access_project(u, min_role);
end;
$$;

create or replace function public.is_project_collaborator(pid uuid, min_role text default 'viewer')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_collaborators pc
    where pc.project_id = pid
      and pc.user_id = auth.uid()
      and pc.status = 'accepted'
      and case min_role
            when 'editor' then pc.role in ('owner','editor')
            when 'field'  then pc.role in ('owner','editor','field')
            else true
          end
  );
$$;

-- ── 3. Let field users actually SAVE field work ─────────────────────────────
-- Move INSERT/UPDATE on the field tables from the 'editor' tier to 'field'.
-- SELECT already uses the default (any accepted collaborator) and is unchanged.
do $$
declare
  t text;
  -- ALL 12 tables that actually carry *_collab_* policies in production,
  -- verified against pg_policies on 2026-08-26. The first draft listed only 8
  -- and silently left drawing_pins, plan_markups, plan_calibrations and
  -- field_tickets on the 'editor' tier — a foreman would have been unable to
  -- drop a plan pin or file a field ticket, which is most of the job.
  field_tables text[] := array[
    'daily_reports','photos','punch_items','rfis','submittals',
    'permits','plan_sheets','time_entries',
    'drawing_pins','plan_markups','plan_calibrations','field_tickets'
  ];
begin
  foreach t in array field_tables loop
    -- Skip cleanly if a table isn't present in this environment.
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I', t || '_collab_insert', t);
    execute format($f$
      create policy %1$I on public.%2$I
        for insert to authenticated
        with check (
          auth.uid() = user_id
          and public.can_access_project(project_id, 'field')
        );
    $f$, t || '_collab_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_collab_update', t);
    execute format($f$
      create policy %1$I on public.%2$I
        for update to authenticated
        using      (public.can_access_project(project_id, 'field'))
        with check (public.can_access_project(project_id, 'field'));
    $f$, t || '_collab_update', t);
  end loop;
end $$;

comment on constraint project_collaborators_role_check on public.project_collaborators is
  'owner|editor|viewer|field. field = operational access (schedule, daily reports, photos, RFIs, punch, time) with financials blinded client-side; see 20260826130000_field_role.sql for the residual projects-row caveat.';

-- ─── 20260826140000_project_financials_split ───
-- ============================================================================
-- project_financials — take the money off the projects row.
--
-- WHY. 20260826130000_field_role.sql shipped the 'field' collaborator role but
-- documented a residual leak it could not close:
--
--     Field users need projects.schedule, and projects_select is
--     `auth.uid() = user_id OR is_project_collaborator(id)`, so a field
--     collaborator can read the WHOLE row — including estimate,
--     linked_estimate, target_budget, estimate_versions.
--
-- Postgres RLS is ROW-level; it cannot blind columns, and column GRANTs apply
-- per database role (every app user is `authenticated`). The only real fix is
-- to stop storing the money on a row that field users are allowed to read.
-- This is that split.
--
-- ── PHASE 1 OF 2. THIS MIGRATION DOES NOT YET CLOSE THE LEAK. ───────────────
-- It creates the table, backfills it, and locks it down — but deliberately
-- LEAVES the four legacy columns on projects so an older build that still
-- reads them keeps working. A client that reads projects.estimate and finds
-- the column gone would render every estimate as blank, which looks exactly
-- like data loss.
--
-- Sequence:
--   1. apply THIS migration              (table exists, backfilled, secured)
--   2. ship the OTA                      (client reads/writes the new table)
--   3. verify on device
--   4. apply ..._project_financials_drop_legacy.sql  → LEAK ACTUALLY CLOSES
--
-- Until step 4, the client dual-writes both places so either build is correct
-- and step 4 stays a safe, boring column drop.
--
-- ── WHO CAN SEE MONEY ───────────────────────────────────────────────────────
-- SELECT  owner, editor, viewer      (a viewer is read-only but DOES see
--                                     financials — that is the role's point)
-- WRITE   owner, editor              (mirrors projects_update)
-- DELETE  owner
-- 'field' appears in none of them. That is the whole exercise.
--
-- `scope` is deliberately NOT moved: scope-of-work is operational, and the
-- field crew needs it.
--
-- Idempotent throughout.
-- ============================================================================

create table if not exists public.project_financials (
  project_id        uuid primary key references public.projects(id) on delete cascade,
  -- Mirrors projects.user_id so the owner check never has to join.
  user_id           uuid not null references auth.users(id) on delete cascade,
  estimate          jsonb,
  linked_estimate   jsonb,
  estimate_versions jsonb,
  target_budget     jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists project_financials_user_id_idx
  on public.project_financials (user_id);

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Only rows that actually carry money. ON CONFLICT DO NOTHING so re-running
-- never clobbers data the app has already written to the new table.
insert into public.project_financials
  (project_id, user_id, estimate, linked_estimate, estimate_versions, target_budget, created_at, updated_at)
select p.id, p.user_id, p.estimate, p.linked_estimate, p.estimate_versions, p.target_budget,
       coalesce(p.created_at, now()), coalesce(p.updated_at, now())
from public.projects p
where p.estimate is not null
   or p.linked_estimate is not null
   or p.estimate_versions is not null
   or p.target_budget is not null
on conflict (project_id) do nothing;

-- ── Who may see the money ───────────────────────────────────────────────────
-- Everything EXCEPT 'field'. Kept as its own function (rather than reusing
-- can_access_project) because this is a different question — "may see money"
-- is not a rung on the edit ladder, and folding it in would make a future
-- widening of the ladder silently widen financial access too.
create or replace function public.can_view_project_financials(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.projects p
      where p.id = pid and p.user_id = auth.uid()
    )
    or exists (
      select 1 from public.project_collaborators pc
      where pc.project_id = pid
        and pc.user_id = auth.uid()
        and pc.status = 'accepted'
        and pc.role in ('owner','editor','viewer')   -- 'field' excluded
    );
$$;

alter table public.project_financials enable row level security;

drop policy if exists project_financials_select on public.project_financials;
create policy project_financials_select on public.project_financials
  for select to authenticated
  using (public.can_view_project_financials(project_id));

drop policy if exists project_financials_insert on public.project_financials;
create policy project_financials_insert on public.project_financials
  for insert to authenticated
  with check (public.can_access_project(project_id, 'editor'));

drop policy if exists project_financials_update on public.project_financials;
create policy project_financials_update on public.project_financials
  for update to authenticated
  using      (public.can_access_project(project_id, 'editor'))
  with check (public.can_access_project(project_id, 'editor'));

drop policy if exists project_financials_delete on public.project_financials;
create policy project_financials_delete on public.project_financials
  for delete to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
  );

comment on table public.project_financials is
  'Money split off the projects row so field collaborators cannot read it (RLS is row-level and cannot blind columns). SELECT = owner/editor/viewer; field excluded. See 20260826140000_project_financials_split.sql.';

-- ─── 20260826150000_history_audit_reconciliation ───
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

-- ─── 20260826160000_rfi_sub_attribution ───
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

-- ─── 20260826170000_portal_link_expiry ───
-- portal_snapshots — GC-chosen lifetime for the homeowner share link.
--
-- Today a portal link lives forever: portal_snapshots has no TTL at all, so
-- every URL a GC has ever texted is still live. The founder's ask is the
-- opposite of a hard cutover — the GC picks how long a link stays open, and
-- when it lapses they get told so they can send a fresh one.
--
-- Precedent is public.shared_schedule_snapshots
-- (20260520180100_shared_schedule_snapshots.sql), which carries
-- `expires_at timestamptz not null default (now() + interval '30 days')` and
-- a fetch RPC that filters on it. We copy the COLUMN, not the NOT NULL
-- DEFAULT — see below.
--
-- ── WHY expires_at IS NULLABLE, AND WHY NULL MEANS FOREVER ───────────────────
-- A `not null default (now() + interval '30 days')` would be evaluated for
-- every EXISTING row at ALTER time. That is a retro-expiry: every homeowner
-- portal already in the field would silently acquire a deadline nobody agreed
-- to, and the ones created more than 30 days ago... would still get now()+30
-- (the default is computed at backfill time, not from created_at) — so the
-- damage is not "old links die", it is "every link now dies on a date the GC
-- never chose and was never told about". Either way the GC finds out when the
-- homeowner texts "your link is broken" mid-build. That is a support incident
-- manufactured by a migration.
--
-- So: NULL is a first-class value meaning "never expires", and it is what
-- every pre-existing row keeps. Today's behaviour is preserved exactly, and
-- expiry only ever starts applying to a link the GC deliberately regenerated
-- with a duration attached. Opt-in, not opt-out.
--
-- Reverse path:
--   alter table public.portal_snapshots drop column if exists expires_at;
--   alter table public.portal_snapshots drop column if exists link_duration_days;

alter table public.portal_snapshots
  add column if not exists expires_at timestamptz;

-- What the GC picked (7 / 30 / 90). NULL = they chose "No expiry", or they
-- have never been asked — the two are indistinguishable here on purpose, and
-- both correctly resolve to "no deadline". The value is kept so regenerating a
-- link can reuse the preference instead of re-prompting, and so a future
-- notification can say "your 30-day link lapsed" rather than just "it lapsed".
alter table public.portal_snapshots
  add column if not exists link_duration_days integer;

comment on column public.portal_snapshots.expires_at is
  'When the share link stops being valid. NULL = never expires (the pre-2026-08-26 behaviour, and what every backfilled row keeps).';
comment on column public.portal_snapshots.link_duration_days is
  'Days the GC chose when they last generated this link. NULL = no expiry chosen. Reused as the default next time they regenerate.';

-- Guard the obvious data bug: a zero or negative duration would mint a link
-- that is expired the instant it is created. NOT VALID would let existing rows
-- skip the check, but there are no existing values to grandfather (the column
-- is new and entirely NULL), so a plain constraint is safe and honest.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'portal_snapshots_link_duration_days_positive'
       and conrelid = 'public.portal_snapshots'::regclass
  ) then
    alter table public.portal_snapshots
      add constraint portal_snapshots_link_duration_days_positive
      check (link_duration_days is null or link_duration_days > 0);
  end if;
end
$$;

-- Partial index: the only rows any expiry sweep, notification job or "which
-- links lapse this week" query cares about are the ones that HAVE a deadline.
-- Never-expiring portals are expected to stay the majority for a while (every
-- row that predates this migration is one), so keeping them out of the index
-- keeps it small and keeps writes to those rows off the index entirely.
--
-- `where expires_at is not null` is IMMUTABLE, so it is legal in a partial
-- index predicate — unlike `where expires_at > now()`, which is why the
-- shared_schedule_snapshots equivalent had to settle for a full index.
create index if not exists portal_snapshots_expires_at_idx
  on public.portal_snapshots (expires_at)
  where expires_at is not null;

-- ─── 20260826180000_portal_link_expiry_cron ───
-- Schedule the portal-link expiry watcher.
--
-- WHY. A client portal link is the GC's face to their customer. When it lapses
-- the person who discovers it is the CLIENT — they tap a link from an email,
-- hit a wall, and have to chase the contractor. The GC learns their portal is
-- broken through an irritated customer, which is the worst possible channel.
--
-- This warns the GC while the link still works (3 days out) and again once it
-- has lapsed, so they can re-share first. Mirrors coi-expiry-watch, which does
-- the same job for insurance certificates.
--
-- TWICE DAILY, not hourly: the notice is "your link expires in 3 days", not a
-- real-time signal. The function's own 20-hour per-portal cooldown means the
-- second run is almost always a no-op — it exists so a GC who publishes a
-- short-lived link in the afternoon is still caught the same day.
--
-- Sends the shared cron secret in x-cron-secret; the function validates it via
-- verify_cron_secret() (see supabase/functions/_shared/cronAuth.ts) so the
-- secret value never leaves the database. There is deliberately NO
-- authenticated-user path on this function: a user-triggered run would fan out
-- across every GC's portals.
--
-- cron.schedule upserts by jobname, so re-running this migration is safe.

select cron.schedule('portal-link-expiry-notice-am', '0 14 * * *', $j$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/portal-link-expiry-notice',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select secret from private.cron_auth limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$j$);

select cron.schedule('portal-link-expiry-notice-pm', '0 22 * * *', $j$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/portal-link-expiry-notice',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select secret from private.cron_auth limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$j$);

-- ─── 20260826190000_portal_get_snapshot_expiry_aware ───
-- portal_get_snapshot_v2 — an expiry-aware read for the homeowner portal.
--
-- WHY. 20260826170000 gave portal_snapshots an `expires_at`, and
-- app/client-portal-setup.tsx writes it on every publish — but NOTHING on the
-- read side ever looks at it. portal_get_snapshot (20260713150000) selects the
-- `snapshot` column and returns it, full stop. So today a "7-day link" keeps
-- serving content forever: the GC picks a lifetime, the UI tells them the link
-- lapsed, the cron emails them that it lapsed, and the link still opens. The
-- expiry feature is, at the read boundary, decorative.
--
-- It also means a caller cannot TELL an expired link from a wrong one. Both
-- come back as "nothing here", so the portal has to guess, and guessing wrong
-- is how a missing row ends up being reported to a homeowner as "expired" (and
-- vice versa). The whole point of distinguishing the two is that they have
-- different next steps.
--
-- ── WHY A NEW FUNCTION INSTEAD OF EDITING portal_get_snapshot ────────────────
-- marketing/portal/index.html calls portal_get_snapshot by name. Changing that
-- function's return shape in place would break every live browser portal the
-- instant this migration lands, unless the HTML ships in the same window —
-- exactly the coordinated-deploy trap documented at the top of
-- 20260713150001_portal_lock_direct_access.sql. This migration is therefore
-- purely ADDITIVE: a new function, a new grant, nothing dropped or altered. The
-- old RPC keeps working unchanged for the HTML portal; callers move over one at
-- a time. (Follow-up: point the browser portal at v2 and retire v1.)
--
-- Token gate is identical to v1 — portal_project_for_token checks the 192-bit
-- client_portal.accessToken and that the portal is enabled. Expiry is checked
-- AFTER the token, so this cannot be used to probe which portalIds exist.
--
-- Reverse path:
--   drop function if exists public.portal_get_snapshot_v2(text, text);

create or replace function public.portal_get_snapshot_v2(p_portal_id text, p_access_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_pid uuid;
  v_snapshot jsonb;
  v_expires_at timestamptz;
  v_found boolean := false;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;

  select ps.snapshot, ps.expires_at, true
    into v_snapshot, v_expires_at, v_found
    from public.portal_snapshots ps
   where ps.portal_id = p_portal_id
   limit 1;

  -- Token is good and the portal is live, but the GC has never published to it.
  -- Distinct from "expired" and distinct from "denied": the homeowner's next
  -- step is to wait, not to ask for a new link.
  if not v_found then
    return jsonb_build_object('status', 'not_published');
  end if;

  -- NULL expires_at means "never expires" and is the majority state (every row
  -- predating the expiry migration keeps it). Only a real deadline in the past
  -- withholds the payload — and it MUST withhold it, or "expired" is just a
  -- label on content we handed over anyway.
  if v_expires_at is not null and v_expires_at <= now() then
    return jsonb_build_object('status', 'expired', 'expiresAt', v_expires_at);
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'snapshot', v_snapshot,
    'expiresAt', v_expires_at
  );
end; $$;

grant execute on function public.portal_get_snapshot_v2(text, text) to anon, authenticated;

-- ─── 20260826200000_deliveries ───
-- ============================================================================
-- deliveries — what is DUE on site, not just what arrived.
--
-- WHY. public.delivery_receipts already records that a delivery HAPPENED (BOL
-- photo, signature, damage notes). Nothing records that one was EXPECTED.
-- public.commitments carries amount / change_amount / paid_to_date /
-- signed_date and no date the material is meant to land, so the app could not
-- answer either Monday-morning question:
--
--     "What is arriving this week?"     — the look-ahead
--     "What was supposed to be here?"   — the chase
--
-- A missed delivery is not a purchasing problem. Material that does not land is
-- a crew standing around, and that cost surfaces as LABOUR, not as a late PO —
-- which is precisely why it goes unnoticed until payroll.
--
-- ── WHY 'confirmed' IS ITS OWN STATUS ───────────────────────────────────────
-- A date typed off a quote is a guess; a date the supplier confirmed is
-- something you can staff a crew around. Collapsing the two would make the
-- look-ahead lie in the most expensive direction — telling a PM to bring people
-- in for a day that was never real. utils/deliverySchedule surfaces anything
-- unconfirmed inside a 5-day window for chasing.
--
-- ── RELATIONSHIPS ───────────────────────────────────────────────────────────
-- commitment_id is NULLABLE and carries NO foreign key, deliberately: plenty of
-- material is ordered before anyone writes a commitment, and a deleted PO must
-- not cascade away the record that a delivery is still coming. A dangling id
-- simply fails to join, which is the correct degradation.
--
-- receipt_id links to the delivery_receipts row once it lands, so the schedule
-- and the receiving log are the same story rather than two.
--
-- Idempotent throughout.
-- ============================================================================

create table if not exists public.deliveries (
  id            uuid primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,

  description   text not null,
  supplier      text not null,
  commitment_id uuid,
  po_number     text,

  -- The date it is expected on site. DATE, not timestamptz: a delivery lands on
  -- a calendar day in the site's own timezone, and storing an instant would
  -- make "due today" flip a day either side of the date line.
  expected_date date not null,
  -- Arrival window when the supplier or building gives one ("07:00-11:00").
  -- In an occupied building the dock slot is often the real constraint.
  --
  -- NOT named `window`: that is a RESERVED keyword in Postgres (it heads the
  -- WINDOW clause), so an unquoted `window text` is a syntax error and a quoted
  -- "window" would have to stay quoted in every query anyone ever writes
  -- against this table. The prefix is cheaper than that trap.
  delivery_window text,

  status        text not null default 'scheduled'
                check (status in ('scheduled','confirmed','delivered','cancelled')),
  confirmed_at  timestamptz,
  delivered_at  timestamptz,
  receipt_id    uuid,

  location      text,
  received_by   text,
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- "What is coming, soonest first" — the look-ahead query. Partial: settled rows
-- are not work and are the majority over a project's life.
create index if not exists deliveries_open_expected_idx
  on public.deliveries (user_id, expected_date)
  where status in ('scheduled','confirmed');

create index if not exists deliveries_project_idx
  on public.deliveries (project_id, expected_date);

alter table public.deliveries enable row level security;

-- Owner OR an accepted project collaborator. Deliveries are FIELD work — the
-- foreman receiving the load needs to see and update them — so this follows the
-- collaborator pattern from 20260803140000, not the owner-only pattern used for
-- financial tables. Writes use the 'field' tier so a field collaborator can
-- actually mark a load received (see 20260826130000_field_role.sql).
drop policy if exists deliveries_collab_select on public.deliveries;
create policy deliveries_collab_select on public.deliveries
  for select to authenticated
  using (auth.uid() = user_id or public.can_access_project(project_id));

drop policy if exists deliveries_collab_insert on public.deliveries;
create policy deliveries_collab_insert on public.deliveries
  for insert to authenticated
  with check (auth.uid() = user_id and public.can_access_project(project_id, 'field'));

drop policy if exists deliveries_collab_update on public.deliveries;
create policy deliveries_collab_update on public.deliveries
  for update to authenticated
  using      (public.can_access_project(project_id, 'field'))
  with check (public.can_access_project(project_id, 'field'));

drop policy if exists deliveries_owner_delete on public.deliveries;
create policy deliveries_owner_delete on public.deliveries
  for delete to authenticated
  using (auth.uid() = user_id);

comment on table public.deliveries is
  'Scheduled/expected deliveries. Pairs with delivery_receipts (what actually arrived). Drives the look-ahead and the late-delivery chase in utils/deliverySchedule.';

-- ─── 20260827130000_building_access ───
-- ============================================================================
-- building_access_rules + access_reservations — the constraint that is not on
-- the schedule.
--
-- WHY. On a fit-out in an occupied building the binding constraint is usually
-- the BUILDING, not the crew or the material: one freight elevator slot a
-- morning, a dock that takes one truck, a COI the property manager must hold
-- before anyone swings a hammer, badges that take a week.
--
-- None of that was modelled anywhere, so it failed the same way every time —
-- the truck arrives, no elevator is booked, and it leaves. public.deliveries
-- knew the date and nothing about whether the building would let it in.
--
-- ── WHY A GATE, NOT A LOG ───────────────────────────────────────────────────
-- These tables exist to be JOINED AGAINST deliveries, not browsed. The product
-- surface is utils/buildingAccess.findAccessConflicts(), which answers "which
-- of next week's loads have nowhere to land" — a reservation list nobody reads
-- would not have prevented a single turned-away truck.
--
-- ── WHY 'requested' IS ITS OWN STATUS ───────────────────────────────────────
-- Same reasoning as deliveries.confirmed: an email to the property manager is
-- not a booking. Collapsing requested into confirmed would tell a PM to send a
-- truck against a slot nobody granted.
--
-- ── RELATIONSHIPS ───────────────────────────────────────────────────────────
-- delivery_id is NULLABLE and carries NO foreign key, matching public.deliveries'
-- treatment of commitment_id: a slot is often booked for a morning before anyone
-- knows which load fills it, and deleting a delivery must not silently cancel a
-- building reservation that still exists in the building's system. A dangling id
-- fails to join, which is the correct degradation.
--
-- building_access_rules is keyed BY project_id rather than a surrogate id: a
-- project has exactly one set of building rules, and a surrogate key would
-- permit two contradictory rows with nothing to say which one gates the job.
--
-- Idempotent throughout.
-- ============================================================================

create table if not exists public.building_access_rules (
  -- The project IS the key. One building, one set of rules.
  project_id       uuid primary key references public.projects(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,

  building_contact text,
  building_phone   text,

  requires_freight_elevator boolean not null default false,
  requires_dock_reservation boolean not null default false,

  -- The BUILDING's copy of the COI, naming them as additional insured. Distinct
  -- from the GC's own policy in public.prequal_coi — same document, different
  -- holder, and it is the building's copy that stops work at the door.
  requires_coi_on_file      boolean not null default false,
  coi_on_file_at            date,

  requires_badging          boolean not null default false,
  -- Days the building takes to issue a badge. Scheduling a crew inside this
  -- window is a plan that cannot happen.
  badge_lead_time_days      integer check (badge_lead_time_days is null or badge_lead_time_days >= 0),

  work_hours                text,
  after_hours_requires_approval boolean not null default false,

  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.access_reservations (
  id            uuid primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,

  kind          text not null
                check (kind in ('freight_elevator','dock','after_hours','badging')),

  -- DATE, not timestamptz: a building grants a slot on a calendar day in its own
  -- timezone. Storing an instant would drift the booking a day either side of
  -- the date line, which is how you show up on the wrong morning.
  date          date not null,
  -- The granted window ("07:00-11:00"). NOT named `window` — reserved keyword
  -- in Postgres; see the note in 20260826200000_deliveries.sql.
  reservation_window text,

  status        text not null default 'requested'
                check (status in ('requested','confirmed','denied','cancelled')),
  -- The building's booking reference — what you quote at the loading dock.
  confirmation_ref text,

  -- Optional link to the load this slot exists for. See header: no FK, on purpose.
  delivery_id   uuid,

  requested_at  timestamptz,
  confirmed_at  timestamptz,
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The conflict query: open slots for a project, by day. Partial — settled rows
-- are not constraints and become the majority over a job's life.
create index if not exists access_reservations_open_idx
  on public.access_reservations (project_id, date)
  where status in ('requested','confirmed');

-- Resolving "is there a slot for THIS load", the per-delivery join.
create index if not exists access_reservations_delivery_idx
  on public.access_reservations (delivery_id)
  where delivery_id is not null;

alter table public.building_access_rules enable row level security;
alter table public.access_reservations   enable row level security;

-- Owner OR an accepted project collaborator, on the 'field' tier. Booking the
-- freight elevator is field work — the superintendent on site is the one who
-- calls the property manager, and a gate that forced them to ask the owner to
-- record it would simply not be used. Mirrors public.deliveries
-- (20260826200000) rather than the owner-only pattern used for financials.
drop policy if exists building_access_rules_collab_select on public.building_access_rules;
create policy building_access_rules_collab_select on public.building_access_rules
  for select to authenticated
  using (auth.uid() = user_id or public.can_access_project(project_id));

drop policy if exists building_access_rules_collab_insert on public.building_access_rules;
create policy building_access_rules_collab_insert on public.building_access_rules
  for insert to authenticated
  with check (auth.uid() = user_id and public.can_access_project(project_id, 'field'));

drop policy if exists building_access_rules_collab_update on public.building_access_rules;
create policy building_access_rules_collab_update on public.building_access_rules
  for update to authenticated
  using      (public.can_access_project(project_id, 'field'))
  with check (public.can_access_project(project_id, 'field'));

drop policy if exists building_access_rules_owner_delete on public.building_access_rules;
create policy building_access_rules_owner_delete on public.building_access_rules
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists access_reservations_collab_select on public.access_reservations;
create policy access_reservations_collab_select on public.access_reservations
  for select to authenticated
  using (auth.uid() = user_id or public.can_access_project(project_id));

drop policy if exists access_reservations_collab_insert on public.access_reservations;
create policy access_reservations_collab_insert on public.access_reservations
  for insert to authenticated
  with check (auth.uid() = user_id and public.can_access_project(project_id, 'field'));

drop policy if exists access_reservations_collab_update on public.access_reservations;
create policy access_reservations_collab_update on public.access_reservations
  for update to authenticated
  using      (public.can_access_project(project_id, 'field'))
  with check (public.can_access_project(project_id, 'field'));

drop policy if exists access_reservations_owner_delete on public.access_reservations;
create policy access_reservations_owner_delete on public.access_reservations
  for delete to authenticated
  using (auth.uid() = user_id);

comment on table public.building_access_rules is
  'What a building requires before work can happen (elevator/dock booking, COI on file, badging lead time, after-hours approval). One row per project. Joined against public.deliveries by utils/buildingAccess to surface loads with nowhere to land.';

comment on table public.access_reservations is
  'Freight elevator / dock / after-hours / badging slots requested from or granted by the building. A requested slot is NOT a booking — see utils/buildingAccess.';

-- ─── 20260828120000_delivery_receipt_link ───
-- ============================================================================
-- delivery_receipts.delivery_id — join the promise to the witness statement.
--
-- WHY. public.delivery_receipts has existed since the rls_baseline migration and
-- NO CODE HAS EVER TOUCHED IT. Every reference to it in this repo was a comment
-- describing a capability that was never built — including comments written
-- while building public.deliveries, which asserted the receipt side was live
-- because the table was there. A schema is not a feature.
--
-- Receiving is now built (app/deliveries.tsx ReceiveSheet), and it needs the one
-- column that lets a receipt point back at the delivery it closes out.
--
-- ── WHY NULLABLE, AND WHY NO FOREIGN KEY ────────────────────────────────────
-- Material turns up that nobody scheduled. A receipt with no delivery_id is a
-- perfectly good witness statement — it records that a load landed, who signed,
-- and whether anything was broken — and refusing to store it would push the
-- super back to a photo in their camera roll.
--
-- No FK, matching deliveries.commitment_id and deliveries.receipt_id: deleting a
-- delivery must not cascade away the evidence that something arrived, least of
-- all when that evidence is the basis of a damage claim. A dangling id simply
-- fails to join, which is the correct degradation.
--
-- Idempotent.
-- ============================================================================

alter table public.delivery_receipts
  add column if not exists delivery_id uuid;

-- "Which receipt closed this delivery" — the per-delivery lookup. Partial:
-- unscheduled material is common and those rows never participate in the join.
create index if not exists delivery_receipts_delivery_idx
  on public.delivery_receipts (delivery_id)
  where delivery_id is not null;

comment on column public.delivery_receipts.delivery_id is
  'The public.deliveries row this receipt closes out. NULL for material that arrived unscheduled. No FK on purpose — deleting a delivery must not destroy the record that something was received, or the damage evidence attached to it.';

