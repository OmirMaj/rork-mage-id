-- 20260916140000_portal_link_until_handover.sql
-- Homeowner portal links stay open UNTIL HANDOVER, then close 30 days later.
--
-- ── WHAT ─────────────────────────────────────────────────────────────────────
-- public.portal_snapshots.link_duration_days NULL now means UNTIL HANDOVER
-- (it used to mean "No expiry"). For those rows the DATABASE owns expires_at:
--   • project not closed          → expires_at = NULL (the link is open)
--   • project status = 'closed'   → expires_at = coalesce(closed_at, now()) + 30 days
--   • project reopened            → expires_at = NULL again
-- Rows with a fixed duration (7 / 30 / 90) are never touched: the GC chose that
-- date and closeout does not move it.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
-- The founder: "the links always expire". A 30-day default killed a portal
-- made at kickoff halfway through a months-long job. The decision is that a
-- link lives for the whole job, however long it runs, and closes itself 30
-- days after closeout — long enough for the final invoice, closeout binder
-- and punch sign-off, and not a credential that opens a finished job forever.
-- A GC who chose "No expiry" before today is on until-handover now; the "never"
-- option is retired. Every production portal is NULL, so every one of them
-- moves to until-handover with no data rewrite (and none is closed today).
--
-- 'completed' is NOT handover. Work can be substantially complete while the
-- final invoice and punch sign-off are still going through the portal. Only
-- 'closed' (set with closed_at by app/closeout-binder.tsx) closes the link.
--
-- ── ONE RULE, SHARED WITH THE APP ────────────────────────────────────────────
-- utils/portalLinkExpiry.ts expiresAtForPolicy is the app's copy of
-- public.portal_link_expiry_for_policy below; scripts/validate-portal-link-
-- expiry.ts pins both. They must agree because app/client-portal-setup.tsx
-- upserts expires_at on EVERY snapshot refresh — two different rules would
-- overwrite each other on every refresh.
--
-- And because a phone can be stale (offline, not yet refetched after another
-- device closed the job), the database does not trust the app's value for an
-- until-handover row: trigger (B) recomputes it on every write to
-- portal_snapshots. The app sending null for a closed job cannot reopen it,
-- and the app sending a date for an open job cannot close it.
--
-- ── SECURITY ─────────────────────────────────────────────────────────────────
-- Nothing here changes who can read what. Expiry is still enforced by
-- portal_project_for_token / portal_get_snapshot_v2 (20260904100800); this
-- only decides the date they compare against. The functions are SECURITY
-- DEFINER so the recompute works whoever writes the row (owner or an RLS-
-- permitted collaborator) — they read one project's status/closed_at and
-- write only expires_at on that project's own snapshots. search_path is
-- pinned and every relation is schema-qualified. Trigger functions cannot be
-- called over PostgREST, and EXECUTE is revoked from the API roles anyway.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS. Safe to
-- re-run. Apply order: independent of any OTA — an app that still pushes the
-- old values is corrected by trigger (B).
--
-- Reverse path:
--   drop trigger if exists projects_portal_link_handover on public.projects;
--   drop trigger if exists portal_snapshots_link_expiry_policy on public.portal_snapshots;
--   drop function if exists public.portal_link_handover_sync();
--   drop function if exists public.portal_snapshots_apply_link_policy();
--   drop function if exists public.portal_link_expiry_for_policy(text, timestamptz, timestamptz);
--   (NULL link_duration_days would then read as "no expiry" again.)

-- ── the rule ────────────────────────────────────────────────────────────────
-- Until-handover expiry for a project in `p_status` closed at `p_closed_at`.
-- p_current is the date the row already carries: when a closed project has no
-- closed_at, the first stamp (now() + 30 days at the transition) is kept
-- rather than re-stamped, so later snapshot writes do not slide the deadline
-- forward forever. The app's resolver does the same.
create or replace function public.portal_link_expiry_for_policy(
  p_status text,
  p_closed_at timestamptz,
  p_current timestamptz
)
returns timestamptz
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
    when p_status is distinct from 'closed' then null
    when p_closed_at is not null then p_closed_at + interval '30 days'
    else coalesce(p_current, now() + interval '30 days')
  end
$$;

revoke execute on function public.portal_link_expiry_for_policy(text, timestamptz, timestamptz)
  from public, anon, authenticated;

comment on function public.portal_link_expiry_for_policy(text, timestamptz, timestamptz) is
  'Until-handover portal link expiry: NULL while the project is open; closed_at + 30 days once status = closed. Mirrored by utils/portalLinkExpiry.ts expiresAtForPolicy.';

-- ── (A) the project changes state ───────────────────────────────────────────
-- Fires only when status or closed_at actually changed (WHEN clause below), so
-- the many ordinary project saves (schedule, estimate, portal settings) never
-- touch portal_snapshots.
create or replace function public.portal_link_handover_sync()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'closed' then
    -- Closed (or closed_at corrected while closed): the link closes 30 days
    -- after closeout. A re-close with no closed_at re-stamps from now() — a
    -- fresh handover gets a fresh grace period.
    update public.portal_snapshots
       set expires_at = coalesce(new.closed_at, now()) + interval '30 days'
     where project_id = new.id
       and link_duration_days is null;
  elsif old.status = 'closed' then
    -- Reopened (warranty call-back, a closeout done by mistake): the link
    -- reopens with the job.
    update public.portal_snapshots
       set expires_at = null
     where project_id = new.id
       and link_duration_days is null;
  end if;
  return null;
end
$$;

revoke execute on function public.portal_link_handover_sync() from public, anon, authenticated;

drop trigger if exists projects_portal_link_handover on public.projects;
create trigger projects_portal_link_handover
  after update of status, closed_at on public.projects
  for each row
  when (old.status is distinct from new.status or old.closed_at is distinct from new.closed_at)
  execute function public.portal_link_handover_sync();

-- ── (B) a snapshot row is written ───────────────────────────────────────────
-- The setup screen upserts expires_at with every snapshot refresh. For an
-- until-handover row the value it sends is replaced with the rule's answer
-- against the project as the database sees it. On INSERT there is no prior
-- stamp to keep; on UPDATE the prior stamp (old.expires_at) is kept for a
-- closed project without closed_at, not the phone's value.
--
-- Also runs when trigger (A) updates the row: (A) has already set the rule's
-- answer, and (B) arrives at the same one, except for a closed project with
-- no closed_at — where (A) sets now()+30 deliberately, so (B) keeps the value
-- (A) just wrote rather than the pre-transition one. See the new.expires_at
-- branch: a statement coming from (A) is detected by pg_trigger_depth() > 1.
create or replace function public.portal_snapshots_apply_link_policy()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
  v_closed_at timestamptz;
  v_current timestamptz;
begin
  if new.link_duration_days is not null then
    return new; -- fixed duration: the GC's own date, untouched
  end if;
  if new.project_id is null then
    return new; -- no project to read a status from; leave the row as written
  end if;

  select p.status, p.closed_at
    into v_status, v_closed_at
    from public.projects p
   where p.id = new.project_id;

  if not found then
    return new;
  end if;

  if pg_trigger_depth() > 1 then
    v_current := new.expires_at;               -- written by (A) just now
  elsif tg_op = 'UPDATE' and old.link_duration_days is null then
    v_current := old.expires_at;               -- the existing handover stamp
  else
    v_current := null;                         -- insert, or switching from a fixed duration
  end if;

  new.expires_at := public.portal_link_expiry_for_policy(v_status, v_closed_at, v_current);
  return new;
end
$$;

revoke execute on function public.portal_snapshots_apply_link_policy() from public, anon, authenticated;

drop trigger if exists portal_snapshots_link_expiry_policy on public.portal_snapshots;
create trigger portal_snapshots_link_expiry_policy
  before insert or update on public.portal_snapshots
  for each row
  execute function public.portal_snapshots_apply_link_policy();

-- ── one-time backfill ───────────────────────────────────────────────────────
-- Bring every existing until-handover row in line with the rule, so a project
-- that is ALREADY closed gets its closing date and an open one carries none.
-- Production has no closed project today; this must still be right on any
-- database. The no-op SET fires trigger (B), which computes the value — the
-- rule lives in one function, not re-typed here. Only rows whose value would
-- change are updated.
update public.portal_snapshots ps
   set expires_at = ps.expires_at
  from public.projects p
 where p.id = ps.project_id
   and ps.link_duration_days is null
   and ps.expires_at is distinct from
       public.portal_link_expiry_for_policy(p.status, p.closed_at, ps.expires_at);

comment on column public.portal_snapshots.link_duration_days is
  'Days the GC chose for a fixed-lifetime link (7 / 30 / 90). NULL = UNTIL HANDOVER: open while the project is open, expires 30 days after it is closed (status = closed); expires_at is maintained by trigger portal_snapshots_link_expiry_policy. Before 2026-09-16 NULL meant "no expiry".';
comment on column public.portal_snapshots.expires_at is
  'When the share link stops being valid. NULL = open. For link_duration_days NULL (until handover) this is computed by the database from the project''s status/closed_at; for a fixed duration it is the date the GC generated.';
