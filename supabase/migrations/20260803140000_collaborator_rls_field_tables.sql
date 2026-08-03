-- ============================================================================
-- Collaborator RLS — FIELD tables only.
--
-- WHAT THIS FIXES
-- 20260728140000_project_collaborators.sql shipped a real invite system
-- (project_collaborators, is_project_collaborator(), the project-invite edge
-- function, accept flow) but applied the helper to exactly TWO policies, both
-- on public.projects. Verified against live pg_policies: two, nowhere else.
--
-- Because the schedule lives in projects.schedule (jsonb), that was enough for
-- the schedule feature AND ONLY THAT FEATURE. An invited editor who accepts,
-- signs in, and opens any other screen gets ZERO ROWS. Multi-user is advertised
-- and is inoperable beyond the Gantt.
--
-- ── SCOPE: FIELD ONLY. THIS IS DELIBERATE. ──────────────────────────────────
-- Financial tables (invoices, change_orders, commitments, aia_pay_apps,
-- lien_waivers, draw_periods, wip_periods) are INTENTIONALLY NOT INCLUDED.
--
-- There is currently no role that separates field access from financial
-- access — the roles are owner | editor | viewer. An `editor` already reads
-- projects.estimate, which carries every markup line. Extending RLS to the
-- financial cluster would mean a foreman invited to log daily reports can read
-- the margin on every job. Foremen talk to subs. That is a business risk, not
-- a technical one, and it should be unlocked by a real 'field' role rather
-- than by widening 'editor'.
--
-- Ship this to make collaboration actually work; add the financial cluster
-- with the role that makes it safe.
--
-- ── THE TRAP THIS MIGRATION AVOIDS ──────────────────────────────────────────
-- Every table here carries BOTH user_id and project_id, and the existing
-- policies key on `auth.uid() = user_id`.
--
-- If a collaborator inserts a daily report, that row's user_id is the
-- COLLABORATOR's id. Under the old policy the PROJECT OWNER would no longer
-- match it — the owner would stop seeing rows on their own job. So the read
-- path must be project-scoped, not author-scoped:
--
--     owner-of-parent-project  OR  accepted collaborator  OR  row author
--
-- can_access_project() below folds the first two together so there is one
-- function to reason about instead of two overlapping ones.
--
-- ── DUPLICATE POLICIES ──────────────────────────────────────────────────────
-- Several tables carry two permissive policies per command (daily_reports has
-- both `daily_reports_select` and `dfr_select_own`; photos, rfis, submittals,
-- punch_items likewise). Postgres ORs permissive policies, so the pair is
-- redundant rather than harmful — but patching only one leaves a second,
-- narrower policy that future readers will misread as the effective rule.
-- Both variants are dropped and replaced by one consolidated policy per
-- command, exactly as 20260728140000 did for projects.
--
-- ── ROLE SCOPE CHANGE — REVIEW THIS ─────────────────────────────────────────
-- Verified against live pg_policy: EVERY existing policy on these tables has
-- polroles = {0}, i.e. `TO PUBLIC` — which includes `anon`. That is not a leak
-- today, because each one also requires `auth.uid() = user_id` and an anon
-- caller has no uid, so the predicate is false. But it is loose by default.
--
-- The policies below are `TO authenticated`. That is a deliberate TIGHTENING:
-- after this migration, anon has no policy on these tables at all rather than
-- a policy that happens to evaluate false.
--
-- Confirmed safe for the two paths that read these tables without a user JWT:
--   * service-role edge functions bypass RLS entirely (unaffected)
--   * the client portal reads via SECURITY DEFINER RPCs (also bypass)
-- If a future anon path needs one of these tables, it must go through an RPC,
-- which is the pattern 20260721043510 already established for the portal.
--
-- Idempotent: every drop is IF EXISTS, every create follows its drop.
-- Additive to reachability only — no policy here grants access that the
-- project owner did not already have.
-- ============================================================================

-- ── One helper: owner OR accepted collaborator ──────────────────────────────
-- SECURITY DEFINER so it can read project_collaborators/projects without the
-- caller needing rights on them (and without recursing through their RLS).
-- STABLE so the planner can hoist it out of per-row evaluation.
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
    -- …or an accepted collaborator at or above the required role
    or exists (
      select 1 from public.project_collaborators pc
      where pc.project_id = pid
        and pc.user_id = auth.uid()
        and pc.status = 'accepted'
        and case min_role
              when 'editor' then pc.role in ('owner','editor')
              else true
            end
    );
$$;

comment on function public.can_access_project(uuid, text) is
  'True when auth.uid() owns the project OR is an accepted collaborator at >= min_role. '
  'Use this for project-scoped child tables; is_project_collaborator() alone EXCLUDES the owner.';

revoke all on function public.can_access_project(uuid, text) from public, anon;
grant execute on function public.can_access_project(uuid, text) to authenticated;

-- ── The field tables ────────────────────────────────────────────────────────
-- SELECT  : anyone who can access the project (viewer+), plus the row author.
-- INSERT  : editor+ on the project, and the row must be stamped with the
--           caller's own user_id — an editor cannot author rows as someone else.
-- UPDATE  : editor+ on the project.
-- DELETE  : project OWNER only, or the row's own author. Deliberately tighter
--           than UPDATE: destroying field evidence is not an editor-grade act.

do $mig$
declare
  t text;
  field_tables text[] := array[
    'daily_reports',
    'photos',
    'punch_items',
    'rfis',
    'submittals',
    'plan_sheets',
    'drawing_pins',
    'plan_markups',
    'plan_calibrations',
    'permits',
    'time_entries',
    'field_tickets'      -- created by create_field_tickets.sql; skipped if absent
  ];
begin
  foreach t in array field_tables loop
    -- create_field_tickets.sql may not have been applied yet. Skip rather than
    -- fail the whole migration; re-running after it lands picks the table up.
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'skipping %: table does not exist yet', t;
      continue;
    end if;

    -- Drop EVERY existing policy on the table. Several carry two permissive
    -- policies per command under different historical names; enumerating them
    -- by hand would silently miss one. This is safe because the four policies
    -- created below cover all four commands.
    execute (
      select coalesce(string_agg(format('drop policy if exists %I on public.%I;', polname, t), ' '), '')
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relname = t
    );

    execute format($p$
      create policy %1$I on public.%2$I
        for select to authenticated
        using (
          auth.uid() = user_id
          or public.can_access_project(project_id)
        );
    $p$, t || '_collab_select', t);

    execute format($p$
      create policy %1$I on public.%2$I
        for insert to authenticated
        with check (
          auth.uid() = user_id
          and public.can_access_project(project_id, 'editor')
        );
    $p$, t || '_collab_insert', t);

    execute format($p$
      create policy %1$I on public.%2$I
        for update to authenticated
        using      (public.can_access_project(project_id, 'editor'))
        with check (public.can_access_project(project_id, 'editor'));
    $p$, t || '_collab_update', t);

    -- DELETE stays narrow: the project owner, or whoever wrote the row.
    execute format($p$
      create policy %1$I on public.%2$I
        for delete to authenticated
        using (
          auth.uid() = user_id
          or exists (
            select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid()
          )
        );
    $p$, t || '_collab_delete', t);

    raise notice 'collaborator RLS applied to %', t;
  end loop;
end
$mig$;

-- ── Indexes the policy predicates lean on ───────────────────────────────────
-- can_access_project() runs a lookup per row. project_collaborators already has
-- idx_project_collaborators_project / _user from 20260728140000. Make sure the
-- child tables can find their project quickly too.
create index if not exists idx_daily_reports_project    on public.daily_reports(project_id);
create index if not exists idx_photos_project           on public.photos(project_id);
create index if not exists idx_punch_items_project      on public.punch_items(project_id);
create index if not exists idx_rfis_project             on public.rfis(project_id);
create index if not exists idx_submittals_project       on public.submittals(project_id);
create index if not exists idx_plan_sheets_project      on public.plan_sheets(project_id);
create index if not exists idx_permits_project          on public.permits(project_id);
create index if not exists idx_time_entries_project     on public.time_entries(project_id);

-- ============================================================================
-- VERIFY AFTER APPLYING — run each of these and read the result.
--
-- 1. Every field table should report exactly 4 policies, all *_collab_*:
--
--    select c.relname, count(*) as policies,
--           string_agg(p.polname, ', ' order by p.polname) as names
--    from pg_policy p
--    join pg_class c on c.oid = p.polrelid
--    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
--    where c.relname in ('daily_reports','photos','punch_items','rfis','submittals',
--                        'plan_sheets','drawing_pins','plan_markups','plan_calibrations',
--                        'permits','time_entries','field_tickets')
--    group by c.relname order by c.relname;
--
-- 2. The FINANCIAL cluster must still be owner-only — this migration must not
--    have touched it. Expect zero rows:
--
--    select c.relname, p.polname
--    from pg_policy p
--    join pg_class c on c.oid = p.polrelid
--    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
--    where c.relname in ('invoices','change_orders','commitments','aia_pay_apps',
--                        'lien_waivers','draw_periods','wip_periods')
--      and pg_get_expr(p.polqual, p.polrelid) ilike '%can_access_project%';
--
-- 3. Behavioural check with two real accounts (do this before trusting it):
--      a. Owner A creates a project and a daily report.
--      b. A invites B as 'editor'; B accepts.
--      c. As B: select from daily_reports  → A's report is visible.
--      d. As B: insert a daily report      → succeeds, stamped with B's user_id.
--      e. As A: select from daily_reports  → B's report is visible.   ← the trap
--      f. As B: select from invoices       → ZERO rows.               ← the scope
--      g. As B: delete A's daily report    → denied.
--      h. Revoke B, then as B: select      → zero rows everywhere.
-- ============================================================================
