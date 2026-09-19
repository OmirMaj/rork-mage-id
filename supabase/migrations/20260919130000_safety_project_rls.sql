-- ============================================================================
-- Safety records reach the project owner (wave 3, safety lane: #82 / #170).
--
-- WHAT THIS FIXES
-- safety_incidents, jhas, toolbox_talks, hazards and safety_inspections all
-- shipped with OWN-ROW-ONLY policies (verified against live pg_policies
-- 2026-09-18: `auth.uid() = user_id` for every command; safety_inspections has
-- one ALL policy with the same test). 20260803140000 made the other field
-- tables project-scoped and left these five out.
--
-- So when a GC invites a foreman and the foreman reports an injury (from the
-- daily report, or from /safety-incidents, which the collaborator gate opens
-- for him), the row is stamped with the FOREMAN's user_id and the GC's own
-- read never returns it. His Incidents list, the hub count and his OSHA 300
-- all miss the case, while the foreman's screen says it was filed.
--
-- ── THE RULE ────────────────────────────────────────────────────────────────
--   SELECT  the row's author, OR the owner of the row's project.
--           A collaborator sees ONLY the rows he wrote himself. This is NOT the
--           field-table rule (every accepted collaborator reads every row): an
--           incident carries workers' names and injury detail, and 29 CFR
--           1904.29(b)(6)-(9) privacy cases make "the whole crew can read the
--           injury log" a real harm. The same rule is applied to the other four
--           tables so there is one safety rule to reason about; widening JHA /
--           toolbox / hazard reads to the crew is a later, separate decision.
--   INSERT  stamped with the caller's own user_id AND on a project he owns or
--           has ACCEPTED access to at 'field' or above (viewers write nothing).
--           Before this, any signed-in user could file a row against ANY
--           project id; the author test alone never checked the project.
--   UPDATE  the author, or the project owner (so the GC can move a foreman's
--           case to investigating / closed). The new row must still sit on a
--           project the author can write, or be the owner's.
--   DELETE  the project OWNER only. Destroying a safety record is not a crew
--           act; OSHA-recordable cases must be kept five years (1904.33) and
--           the app refuses to delete those at all. The app disables Delete
--           for collaborators with the reason, so no queued delete is refused.
--
-- The author clause is kept ORed into SELECT/UPDATE. Every column here is
-- NOT NULL today (0 null project_id rows in production), but a row with no
-- project stays readable by the person who wrote it, as before.
--
-- `public.can_access_project(pid, 'field')` is the helper 20260803140000 wrote
-- and 20260826130000_field_role widened (owner OR accepted owner/editor/field).
-- It has a uuid and a text overload in production; safety_inspections keys
-- project_id as TEXT, the other four as UUID, so each table gets the matching
-- owner test below and the right overload resolves by type.
--
-- PRE-APPLY COUNT (read-only, production, 2026-09-18): safety_incidents 0,
-- jhas 0, toolbox_talks 0, hazards 0, safety_inspections 4 rows — all four
-- authored by the owner of a project id that no longer exists (deleted
-- projects; no FK). They stay readable to their author (author clause); no
-- existing row is hidden from anyone who can see it today.
--
-- Idempotent: every policy on the five tables is dropped first (enumerated from
-- pg_policy, so a historical duplicate name cannot survive), then recreated.
-- ============================================================================

do $mig$
declare
  t text;
  pid_type text;
  owner_test text;
  safety_tables text[] := array[
    'safety_incidents',
    'jhas',
    'toolbox_talks',
    'hazards',
    'safety_inspections'
  ];
begin
  foreach t in array safety_tables loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'skipping %: table does not exist', t;
      continue;
    end if;

    select data_type into pid_type
      from information_schema.columns
     where table_schema = 'public' and table_name = t and column_name = 'project_id';

    -- The owner of the row's project. A text project_id compares as text so
    -- a malformed id is simply "no project", never a cast error mid-policy.
    if pid_type = 'uuid' then
      owner_test := format(
        'exists (select 1 from public.projects p where p.id = %I.project_id and p.user_id = auth.uid())', t);
    else
      owner_test := format(
        'exists (select 1 from public.projects p where p.id::text = %I.project_id and p.user_id = auth.uid())', t);
    end if;

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
        using (auth.uid() = user_id or %3$s);
    $p$, t || '_safety_select', t, owner_test);

    execute format($p$
      create policy %1$I on public.%2$I
        for insert to authenticated
        with check (
          auth.uid() = user_id
          and (project_id is null or public.can_access_project(project_id, 'field'))
        );
    $p$, t || '_safety_insert', t);

    execute format($p$
      create policy %1$I on public.%2$I
        for update to authenticated
        using (auth.uid() = user_id or %3$s)
        with check (
          %3$s
          or (auth.uid() = user_id
              and (project_id is null or public.can_access_project(project_id, 'field')))
        );
    $p$, t || '_safety_update', t, owner_test);

    execute format($p$
      create policy %1$I on public.%2$I
        for delete to authenticated
        using (%3$s or (project_id is null and auth.uid() = user_id));
    $p$, t || '_safety_delete', t, owner_test);

    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I(project_id)', 'idx_' || t || '_project', t);
    raise notice 'safety RLS applied to %', t;
  end loop;
end
$mig$;

-- ============================================================================
-- VERIFY AFTER APPLYING
-- 1. Exactly four *_safety_* policies per table, nothing else:
--    select c.relname, count(*), string_agg(p.polname, ', ' order by p.polname)
--    from pg_policy p join pg_class c on c.oid = p.polrelid
--    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
--    where c.relname in ('safety_incidents','jhas','toolbox_talks','hazards','safety_inspections')
--    group by 1 order by 1;
-- 2. Two accounts: GC owns P and invites F as 'field'; F accepts.
--    F inserts an incident on P            -> ok, stamped F
--    GC selects safety_incidents           -> sees F's case      <- the bug
--    F selects                             -> sees ONLY his own case
--    GC updates F's case status            -> ok
--    F deletes his case                    -> 0 rows (owner-only)
--    F inserts on a project he is not on   -> denied
-- ============================================================================
