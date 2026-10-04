-- 20261004120000_project_people.sql
--
-- "Who is on this project" (lane WHOSERVER): the list of people on a shared
-- project, and a "has it open" signal. Spec: whoson-specs/SPEC.md, section 2.4.
-- Ships DARK: the client flag WHOS_ON_ENABLED is false, so nothing calls any of
-- this until the founder turns it on. Applying the file changes nothing a user
-- can see, with ONE exception that is live from the moment of the apply and
-- does not wait for the flag: the two guards (see THE TWO GUARDS below).
--
-- WHAT A ROW MEANS.
--   profiles.share_presence      the account's own answer to "Show when you have
--                                a project open?". NULL = not asked yet, false =
--                                no, true = yes. Only true stores or shows
--                                anything about that person's activity. There is
--                                no default and no backfill.
--   profiles.share_presence_at   when that answer was last written.
--   project_presence (project_id, user_id)
--                                one row per person per project: the last time
--                                the server heard that this account's device had
--                                a screen of this project in front (last_seen_at,
--                                always the server clock), and whether a leave
--                                has arrived since (is_open). It is a claim made
--                                by a client holding that account's session. It
--                                is not proof that anyone is working.
--
-- WHO WRITES. Nobody but the two callable functions and the two erase triggers
--   below, all SECURITY DEFINER. project_presence has row level security ON, NO
--   policies and no client privilege, so a client can neither read nor write it.
--   project_people(p, 'open')    upserts the CALLER's own row (identity is
--                                auth.uid(), never a parameter), only when the
--                                caller answered yes AND somebody other than the
--                                owner is on the project; at most one write per
--                                10 seconds per person per project.
--   project_people(p, 'closed')  clears is_open on the caller's own row. It
--                                leaves last_seen_at alone: a leave is not a
--                                sighting.
--   project_people(p, anything)  from a caller whose answer is not yes deletes
--                                that caller's row for the project, if one is
--                                there (see ERASE).
--   set_share_presence(p_on)     writes the caller's own answer.
--
-- WHO READS. project_people(p, ...) only, gated by can_access_project(p,'viewer').
--   project owner       his own row plus every ACCEPTED team member, once per
--                       account: the name and company that account typed on its
--                       own profile (never an email), role, the email he invited,
--                       the joined date, and, for people who answered yes, "open"
--                       and "last seen". An account holding two accepted rows on
--                       the project (the roster's key is the invited email, not
--                       the account) is shown by its most recent acceptance.
--   accepted member     exactly two rows: the owner and himself. Never another
--                       team member's row, never a count, never an email, never
--                       a last-seen time. He sees one thing about the owner's
--                       activity: whether the owner has it open (if the owner
--                       answered yes).
--   anyone else         zero rows. "No access" and "no such project" are the same
--                       answer on purpose. anon has no EXECUTE.
--   The open column is a number of seconds or NULL. It is never false: "not
--   open" and "not known" are one answer to every viewer.
--   Nothing about a plan or a payment is joined, selected or returned.
--
-- THE TWO GUARDS (new rules on two existing tables). The read above trusts two
--   facts as proof that an account is on a project by its own doing: an accepted
--   roster row that names the account, and projects.user_id for the owner.
--   Before this file a client could forge both, for any account id it knew, and
--   the read would then have handed it that account's name and company, and its
--   "open" (and, on the first route, "last seen") on that project once that
--   account had answered yes and opened the project that appeared in its list.
--   Both routes were reproduced on PGlite against the repo's real policies:
--     1. policy pc_owner_all (20260728140000) lets a project owner write roster
--        rows directly as `authenticated`: create a project, insert an
--        "accepted" row for the other account;
--     2. policy projects_update lets a project owner who also holds an accepted
--        editor invite to himself set projects.user_id to the other account
--        (projects_freeze_ownership, 20260902130000, stops a NON-owner only):
--        the other account becomes "the owner", and the attacker, still an
--        accepted team member, is shown the owner row.
--   One rule closes both: ONLY THE SERVER PUTS A PERSON ON A PROJECT.
--   WHO THE SERVER IS. Both guards name who may, never who may not (the same
--   allow-list as profiles_keep_ai_consent, 20261004100000_ai_consent_hardening.sql):
--     - service_role: the edge functions (project-invite is the one writer of
--       the roster; delete-account deletes from it);
--     - postgres and supabase_admin: the SQL editor, a migration, a restore,
--       and every SECURITY DEFINER function those roles own (inside one,
--       current_user is its owner);
--     - the role that owns public.project_people(text, text), this file's own
--       definer function. It is looked up at the write, not assumed: on a
--       database whose migrations run as some other role, that role and the
--       definer functions it owns are the server too. The lookup cannot raise
--       (a missing function is NULL, anything else is caught); when it cannot
--       tell, the caller is a client.
--   EVERYONE ELSE IS A CLIENT: the two roles PostgREST gives a request today
--   (authenticated, anon), and any role created later (a reporting role, an
--   integration role), whatever grants or policies it is given on the two
--   tables, and any SECURITY DEFINER function such a role owns. A guard that
--   named the two client roles instead would let that third role through.
--   zz_whoson_guard_roster (project_collaborators). A client can never
--     - write the person on a roster row (insert with a user_id, or change it),
--     - make a row accepted (insert it accepted, or move its status to accepted),
--     - move a row to another project.
--     Each is refused with 42501. The project-invite edge function (service
--     role) is the one writer of those three, and it checks the caller's login
--     email against the invited one before it accepts. What an owner may still
--     write directly is unchanged: an invite that names no account, a role, a
--     revoke, a delete.
--   aa_whoson_guard_project_owner (projects). A client can never change
--     projects.user_id: the value is put back, silently, exactly as
--     projects_freeze_ownership already does for a non-owner (a 42501 on this
--     table is classed terminal by the app's offline queue, utils/offlineQueue.ts,
--     which would drop a whole project save; a pin cannot). Every other column
--     is untouched, and a save that leaves the owner alone (every save the app
--     makes) is passed on its first line: no lookup, nothing pinned. A support
--     reassignment through the service role or the SQL editor still works.
--   The app never does either thing: it only reads the roster (invite, accept,
--   revoke, role change and leave all go through the edge function), and every
--   project save sends the owner's own id. No app version is affected.
--   Every writer in the repo was read, and the proof runs each one's statement
--   as the role it runs as: project-invite's five writes (invite upsert,
--   accept, leave, revoke, role change) and delete-account's delete, as the
--   service role; a definer function, owned by the role that applied it and
--   called by a signed-in account, that updates a project row without touching
--   its owner (the shape of portal_rotate_access_token and
--   field_update_schedule_tasks, the only two SQL functions that update
--   public.projects); the app's own project save; the deletion of a login and
--   of a project (the foreign keys cascade as deletes, and neither guard fires
--   on a delete). No SQL function and no trigger in the repo writes a roster
--   row or a project's owner.
--   Not covered, on purpose: the invited email and the accepted date on a row
--   stay the owner's to edit directly. They are shown to the owner only.
--   Rows that already exist are not re-checked. Before the feature is switched
--   on, read production once (it should return no row that nobody can explain):
--     select pc.project_id, pc.invited_email, u.email
--       from public.project_collaborators pc join auth.users u on u.id = pc.user_id
--      where pc.status = 'accepted' and lower(u.email) <> lower(pc.invited_email);
--   BEFORE APPLYING, read production twice more (read-only). The guards arm at
--   the apply, so what they will call a client must be known first:
--     select distinct r.rolname
--       from pg_proc p join pg_roles r on r.oid = p.proowner
--      where p.pronamespace = 'public'::regnamespace and p.prosecdef;
--       -- expected: postgres (supabase_admin is also on the list). A definer
--       -- function owned by any other role is a client to both guards.
--     select distinct grantee from information_schema.role_table_grants
--      where table_schema = 'public' and table_name in ('projects', 'project_collaborators')
--        and privilege_type in ('INSERT', 'UPDATE');
--       -- expected: anon, authenticated, postgres, service_role. Any other
--       -- grantee can still write what an owner may; it can no longer put a
--       -- person on a project or change who owns one.
--
-- ERASE. A person's rows are deleted
--   - when his answer changes, in either direction, by any path (trigger on
--     profiles; a mark that raced a switch-off must not come back on switch-on);
--   - when he stops being on the project: revoked, left, or the roster row is
--     deleted (trigger on project_collaborators). The trigger keeps one rule: a
--     row survives only if a mark from that person would be accepted right now,
--     so the owner's own row also goes when the last team member leaves;
--   - with the login or the project (foreign keys, on delete cascade);
--   - after 90 days without a sighting (pg_cron job whoson-presence-purge).
--   One race is left, and it is bounded, not closed: a mark already in flight
--   when its person switches sharing off can commit after the erase. That row is
--   returned to nobody (the read tests the answer, not the row), is deleted by
--   that person's next call for the project and by the same daily job, and never
--   comes back on switch-on. A row lock on profiles inside the mark would close
--   it, at the price of a lock-order cycle with the account-deletion cascade
--   (reasoned, not measured); this was chosen instead.
--
-- DEPLOY ORDER. Apply this BEFORE the OTA that turns the feature on, and before
--   redeploying delete-account with 'project_presence' in USER_SCOPED_TABLES.
--   The client tolerates the reverse (the read errors, nothing renders). Apply
--   through the Supabase MCP apply_migration, never `supabase db push`.
--   Depends on: public.can_access_project(uuid, text) (20260826130000_field_role.sql),
--   public.projects, public.project_collaborators, public.profiles.
--
-- VERIFY AFTER
--   select relrowsecurity from pg_class where oid = 'public.project_presence'::regclass;        -- true
--   select count(*) from pg_policies where schemaname = 'public' and tablename = 'project_presence'; -- 0
--   select has_table_privilege('authenticated', 'public.project_presence', 'select'),            -- false
--          has_table_privilege('authenticated', 'public.project_presence', 'insert'),            -- false
--          has_table_privilege('anon',          'public.project_presence', 'select'),            -- false
--          has_function_privilege('anon',          'public.project_people(text, text)',  'execute'), -- false
--          has_function_privilege('authenticated', 'public.project_people(text, text)',  'execute'), -- true
--          has_function_privilege('anon',          'public.set_share_presence(boolean)', 'execute'), -- false
--          has_function_privilege('authenticated', 'public.set_share_presence(boolean)', 'execute'); -- true
--   select provolatile, prosecdef from pg_proc where oid = 'public.project_people(text, text)'::regprocedure; -- v, true
--   select column_name, is_nullable, column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'profiles' and column_name like 'share_presence%';
--     -- two rows, both YES / null
--   select has_column_privilege('authenticated', 'public.profiles', 'share_presence', 'select'); -- true
--     -- (if false the Settings row stays hidden; the Team-section switch still works through the RPC)
--   select tgname from pg_trigger where tgname like '%whoson_%' and not tgisinternal order by 1; -- four rows:
--     -- aa_whoson_guard_project_owner, whoson_forget_on_choice, whoson_forget_on_roster, zz_whoson_guard_roster
--   select proname, prosecdef from pg_proc where proname like 'whoson_guard_%';                  -- two rows, both false
--     -- (a guard reads current_user; as a definer it would see its owner and guard nothing)
--   select proname,
--          position('current_user in (''service_role'', ''postgres'', ''supabase_admin'')' in prosrc) > 0 as allow_list,
--          position('''authenticated''' in prosrc) + position('''anon''' in prosrc) as client_names
--     from pg_proc where proname like 'whoson_guard_%';                                          -- two rows, both true / 0
--   select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner
--    where p.oid = 'public.project_people(text, text)'::regprocedure;                            -- postgres
--     -- (the fourth role both guards pass; it must never be a role a request can run as)
--   select jobname, schedule from cron.job where jobname = 'whoson-presence-purge';              -- one row, 17 8 * * *
--
-- UNDO (by hand, only if the feature is withdrawn)
--   select cron.unschedule('whoson-presence-purge');
--   drop trigger if exists whoson_forget_on_roster on public.project_collaborators;
--   drop trigger if exists whoson_forget_on_choice on public.profiles;
--   drop function if exists public.project_people(text, text), public.set_share_presence(boolean),
--                           public.whoson_forget_on_roster(), public.whoson_forget_on_choice();
--   (the two guards are worth keeping whatever happens to the feature; to remove them too:
--    drop trigger if exists zz_whoson_guard_roster on public.project_collaborators;
--    drop trigger if exists aa_whoson_guard_project_owner on public.projects;
--    drop function if exists public.whoson_guard_roster(), public.whoson_guard_project_owner();)
--   drop table if exists public.project_presence;
--   alter table public.profiles drop column if exists share_presence, drop column if exists share_presence_at;
--
-- PROOF. scratchpad/pgq/project-people.mjs runs this file twice on PGlite
-- against the real project_collaborators and can_access_project definitions and
-- prints every case of SPEC.md section 5, then the allow-list: every writer as
-- the role it runs as (S, R), a third role with every table privilege and a
-- definer function that role owns (A), and the looked-up owner, present,
-- replaced and missing (L). Its planted mutation 37 restores the deny-list and
-- turns those cases red. scripts/validate-whoson-server.ts pins the text.
--
-- Idempotent: add column / create table / create index if not exists, create or
-- replace function, drop trigger if exists, cron.schedule upserts by job name,
-- and grants that are no-ops the second time.
-- Section 9 of SPEC.md lists the read-only production checks to make first; one
-- matters more now: the triggers already on project_collaborators and on
-- projects. BEFORE row triggers fire in name order; zz_whoson_guard_roster must
-- be the last one on its table and aa_whoson_guard_project_owner the first.

-- ── 1. the account's own choice ──────────────────────────────────────────────
-- NULL = not asked yet: nothing stored, nothing shown. No default, no backfill.
alter table public.profiles
  add column if not exists share_presence    boolean,
  add column if not exists share_presence_at timestamptz;

-- ── 2. last seen: one row per (project, person) ──────────────────────────────
create table if not exists public.project_presence (
  project_id   uuid not null references public.projects(id) on delete cascade,
  user_id      uuid not null references auth.users(id)     on delete cascade,
  last_seen_at timestamptz not null default now(),
  is_open      boolean     not null default true,
  constraint project_presence_pkey primary key (project_id, user_id)
);
create index if not exists idx_project_presence_user on public.project_presence(user_id);
-- No index on last_seen_at: it changes on every mark, and an index there would
-- turn each one from a heap-only update into an index write. The daily purge
-- reads a table of one small row per (project, person).

alter table public.project_presence enable row level security;
-- NO policies on purpose: no client reads or writes this table.
revoke all on public.project_presence from public, anon, authenticated;
grant select, insert, update, delete on public.project_presence to service_role;

-- ── 3. read + mark, one call ─────────────────────────────────────────────────
-- VOLATILE: PostgREST runs a stable function in a read-only transaction, and the
-- mark would fail with "cannot execute INSERT in a read-only transaction".
--
-- The function returns columns named user_id, role and last_seen_at, which are
-- also table columns. Every column reference below is alias-qualified, the upsert
-- names its constraint instead of its columns, and #variable_conflict use_column
-- is the second lock: an unqualified user_id raises "column reference is
-- ambiguous" at RUN time, not at create time.
create or replace function public.project_people(p_project_id text, p_mark text default 'none')
returns table (
  user_id uuid, kind text, role text,
  display_name text, company_name text,
  is_self boolean, invited_by_viewer boolean,
  invited_email text, joined_at timestamptz,
  open_expires_s integer, last_seen_at timestamptz, seen_age_s integer,
  shares_presence boolean
)
language plpgsql volatile security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_me       uuid := auth.uid();
  v_pid      uuid;
  v_owner    uuid;
  v_is_owner boolean;
  v_yes      boolean;
  v_shared   boolean;
  v_win      constant interval := interval '150 seconds';
  -- characters a name never needs and a spoof might: C0/C1 controls, zero-width
  -- and bidirectional-override marks, the byte-order mark
  v_strip    constant text := '[[:cntrl:]\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]';
begin
  if v_me is null then return; end if;
  -- junk id: zero rows, never a throw
  begin v_pid := p_project_id::uuid; exception when others then return; end;
  if v_pid is null then return; end if;
  if not public.can_access_project(v_pid, 'viewer') then return; end if;
  select p.user_id into v_owner from public.projects p where p.id = v_pid;   -- uuid = uuid: the primary key
  if v_owner is null then return; end if;
  v_is_owner := (v_owner = v_me);

  -- The caller must have said yes. NULL (not asked) and false both store nothing.
  v_yes := exists (select 1 from public.profiles f where f.id = v_me and f.share_presence is true);
  if not v_yes then
    -- ...and keep nothing: a mark that was in flight while the caller switched
    -- sharing off can land after the erase. Any later call from that person,
    -- whatever p_mark says, removes what it left on this project. Skipped in a
    -- read-only transaction (a GET through PostgREST), where even a DELETE of
    -- zero rows is an error: a plain read must never fail because of this.
    if current_setting('transaction_read_only') = 'off' then
      delete from public.project_presence pp where pp.project_id = v_pid and pp.user_id = v_me;
    end if;
  elsif p_mark = 'open' then
    -- somebody other than the owner must be on the project, or there is no one to show it to
    v_shared := (not v_is_owner) or exists (
      select 1 from public.project_collaborators pc
       where pc.project_id = v_pid and pc.status = 'accepted'
         and pc.user_id is not null and pc.user_id <> v_owner);
    if v_shared then
      insert into public.project_presence as pp (project_id, user_id, last_seen_at, is_open)
      values (v_pid, v_me, now(), true)
      on conflict on constraint project_presence_pkey do update
        set last_seen_at = now(), is_open = true
        where pp.is_open is false
           or pp.last_seen_at < now() - interval '10 seconds';   -- a looping client writes once per 10 s at most
    end if;
  elsif p_mark = 'closed' then
    -- a leave only ever removes a claim. last_seen_at is left alone: a leave is
    -- not a sighting.
    update public.project_presence pp set is_open = false
     where pp.project_id = v_pid and pp.user_id = v_me and pp.is_open;
  end if;

  return query
  with ppl as (
    select v_owner as uid, 'owner'::text as kind, 'owner'::text as role,
           null::text as email, null::timestamptz as joined_at, null::uuid as invited_by
    union all
    -- One row per ACCOUNT. The roster's key is (project, invited email), so an
    -- account that changed its login email and accepted a second invite holds
    -- two accepted rows; its most recent acceptance is the one shown.
    (select distinct on (pc.user_id)
            pc.user_id, 'member'::text, pc.role, pc.invited_email, pc.accepted_at, pc.invited_by
      from public.project_collaborators pc
     where pc.project_id = v_pid and pc.status = 'accepted' and pc.user_id is not null
       and pc.user_id <> v_owner                       -- an owner who invited himself is not listed twice
       and (v_is_owner or pc.user_id = v_me)           -- D1: a team member never receives another team member's row
     order by pc.user_id, pc.accepted_at desc nulls last, pc.id)
  ),
  shown as (
    select x.uid, x.kind, x.role, x.email, x.joined_at, x.invited_by,
           pf.share_presence as shares,
           -- what the account typed about itself, on one line: whitespace runs
           -- (newlines and tabs included) become one space, then the characters
           -- of v_strip are removed. Only the first 400 characters are read: the
           -- value is the other person's to set, and the owner's read must stay cheap
           btrim(regexp_replace(regexp_replace(regexp_replace(
             left(coalesce(pf.contact_name, ''), 400), '[[:space:]]+', ' ', 'g'), v_strip, '', 'g'), ' {2,}', ' ', 'g')) as nm,
           btrim(regexp_replace(regexp_replace(regexp_replace(
             left(coalesce(pf.company_name, ''), 400), '[[:space:]]+', ' ', 'g'), v_strip, '', 'g'), ' {2,}', ' ', 'g')) as co,
           pp.is_open as is_open, pp.last_seen_at as seen_at
      from ppl x
      left join public.profiles pf on pf.id = x.uid
      left join public.project_presence pp on pp.project_id = v_pid and pp.user_id = x.uid
  )
  select
    s.uid as user_id,
    s.kind as kind,
    s.role as role,
    -- never an email (an at sign, ASCII or full-width, drops the whole value), 80 characters at most
    case when s.nm !~ '[@\uFF20\uFE6B]' then nullif(rtrim(left(s.nm, 80)), '') end as display_name,
    case when s.co !~ '[@\uFF20\uFE6B]' then nullif(rtrim(left(s.co, 80)), '') end as company_name,
    (s.uid = v_me) as is_self,
    coalesce(s.invited_by = v_me, false) as invited_by_viewer,
    case when v_is_owner then s.email end as invited_email,
    s.joined_at as joined_at,
    -- a number or NULL. Never false: "not open" and "not known" are one answer to every viewer.
    case when s.shares is true and s.uid <> v_me
              and s.is_open and s.seen_at > now() - v_win
         then greatest(1, ceil(extract(epoch from (s.seen_at + v_win - now())))::integer) end as open_expires_s,
    case when v_is_owner and s.uid <> v_me and s.shares is true then s.seen_at end as last_seen_at,
    -- seen_at is tested by name: greatest() skips a NULL, so without the test a
    -- person who said yes and never opened the project would read as "0 s ago"
    case when v_is_owner and s.uid <> v_me and s.shares is true and s.seen_at is not null
         then greatest(0, floor(extract(epoch from (now() - s.seen_at)))::integer) end as seen_age_s,
    case when s.uid = v_me then s.shares end as shares_presence
  from shown s
  order by (s.kind = 'owner') desc, s.joined_at nulls last, s.uid;
end $$;

-- ── 4. the choice ────────────────────────────────────────────────────────────
-- Returns what is now STORED, read back from the row, so a caller can never be
-- told "saved" about a write that did not land. An account with no profiles row
-- gets an error, not a quiet yes.
create or replace function public.set_share_presence(p_on boolean)
returns boolean
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_stored boolean;
begin
  if v_me is null or p_on is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.profiles f
     set share_presence = p_on, share_presence_at = now()
   where f.id = v_me
  returning f.share_presence into v_stored;
  if not found then
    raise exception 'no profile row for this account' using errcode = 'P0002';
  end if;
  return v_stored;
end $$;

-- ── 5. erase on ANY change of the choice ─────────────────────────────────────
-- Whatever path changed it: the function above, or a direct PATCH of the caller's
-- own profiles row. Both directions: a mark that raced a switch-off can leave a
-- row behind, and it must not come back when sharing is turned on.
create or replace function public.whoson_forget_on_choice() returns trigger
language plpgsql security definer set search_path = public
as $$ begin
  delete from public.project_presence pp where pp.user_id = new.id;
  return null;
end $$;
drop trigger if exists whoson_forget_on_choice on public.profiles;
create trigger whoson_forget_on_choice
  after update of share_presence on public.profiles
  for each row when (old.share_presence is distinct from new.share_presence)
  execute function public.whoson_forget_on_choice();

-- ── 6. erase when a person leaves or is removed ──────────────────────────────
-- SECURITY DEFINER is required: the owner may write project_collaborators
-- directly under pc_owner_all, as `authenticated`, which has no privilege on
-- project_presence. Without definer his write would fail.
--
-- One rule, the same one the mark uses: after a roster row changes or goes, a
-- presence row of that project survives only if a mark from its person would be
-- accepted right now. For the owner that means somebody else is still on the
-- project; for anyone else it means an accepted roster row. So a revoke or a
-- leave removes that person's row, the last person leaving removes the owner's
-- row too, and revoking an owner's invite to himself removes nothing while
-- others remain. NEW is never read, so UPDATE and DELETE share one body.
create or replace function public.whoson_forget_on_roster() returns trigger
language plpgsql security definer set search_path = public
as $$ begin
  if old.user_id is null then return null; end if;      -- an invite nobody accepted names no person
  delete from public.project_presence pp
   where pp.project_id = old.project_id
     and not (case
       when exists (select 1 from public.projects p where p.id = pp.project_id and p.user_id = pp.user_id)
       then exists (select 1 from public.project_collaborators pc
                     where pc.project_id = pp.project_id and pc.status = 'accepted'
                       and pc.user_id is not null and pc.user_id <> pp.user_id)
       else exists (select 1 from public.project_collaborators pc
                     where pc.project_id = pp.project_id and pc.status = 'accepted'
                       and pc.user_id = pp.user_id)
     end);
  return null;
end $$;
drop trigger if exists whoson_forget_on_roster on public.project_collaborators;
create trigger whoson_forget_on_roster
  after update of status, user_id or delete on public.project_collaborators
  for each row execute function public.whoson_forget_on_roster();

-- ── 7. only the server puts a person on a project ────────────────────────────
-- See THE TWO GUARDS in the header. Both functions are SECURITY INVOKER on
-- purpose, and must stay so: the rule reads current_user, which inside a definer
-- function is the function's owner, and the guard would then guard nothing.
-- Both open with the same allow-list, written the same way in each (the
-- self-check at the foot of the file and scripts/validate-whoson-server.ts hold
-- the two copies equal): three named server roles, then the owner of
-- public.project_people(text, text), looked up inside a block that cannot
-- raise. Neither body names a client role: a role nobody has created yet is a
-- client by default. The allow-list is not a shared helper function on purpose:
-- a trigger calls a helper as the writing role, which would then need EXECUTE
-- on it, and a missing grant would fail every project save.
-- Firing a trigger needs no EXECUTE privilege, so the revoke in section 9 does
-- not disarm either.
--
-- 7a. the roster. The trigger is named zz_ so that it fires LAST among the
-- BEFORE row triggers (they fire in name order) and judges the row as it will
-- be stored.
create or replace function public.whoson_guard_roster() returns trigger
language plpgsql security invoker set search_path = public
as $$
declare
  v_server name;
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then return new; end if;
  begin
    select ro.rolname into v_server
      from pg_catalog.pg_proc fn
      join pg_catalog.pg_roles ro on ro.oid = fn.proowner
     where fn.oid = pg_catalog.to_regprocedure('public.project_people(text,text)');
  exception when others then
    v_server := null;
  end;
  if v_server is not null and current_user = v_server then return new; end if;
  if tg_op = 'INSERT' then
    if new.user_id is not null or new.status = 'accepted' then
      raise exception 'only the server can put a person on a project' using errcode = '42501';
    end if;
  elsif new.user_id is distinct from old.user_id
     or new.project_id is distinct from old.project_id
     or (new.status = 'accepted' and old.status is distinct from 'accepted') then
    raise exception 'only the server can put a person on a project' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists zz_whoson_guard_roster on public.project_collaborators;
create trigger zz_whoson_guard_roster
  before insert or update on public.project_collaborators
  for each row execute function public.whoson_guard_roster();

-- 7b. the owner. A pin, not a raise (see the header). Named aa_ so that it fires
-- FIRST: every other BEFORE trigger on projects then decides from the real
-- owner (the house prefix, as in aa_collab_freeze_ownership).
-- The first line passes a write that leaves the owner alone, whoever makes it:
-- putting back a value that did not change is a no-op, so the app's ordinary
-- save (every one sends the owner's own id) never reaches the lookup.
create or replace function public.whoson_guard_project_owner() returns trigger
language plpgsql security invoker set search_path = public
as $$
declare
  v_server name;
begin
  if new.user_id is not distinct from old.user_id then return new; end if;
  if current_user in ('service_role', 'postgres', 'supabase_admin') then return new; end if;
  begin
    select ro.rolname into v_server
      from pg_catalog.pg_proc fn
      join pg_catalog.pg_roles ro on ro.oid = fn.proowner
     where fn.oid = pg_catalog.to_regprocedure('public.project_people(text,text)');
  exception when others then
    v_server := null;
  end;
  if v_server is not null and current_user = v_server then return new; end if;
  new.user_id := old.user_id;
  return new;
end $$;
drop trigger if exists aa_whoson_guard_project_owner on public.projects;
create trigger aa_whoson_guard_project_owner
  before update on public.projects
  for each row execute function public.whoson_guard_project_owner();

-- ── 8. retention: 90 days ────────────────────────────────────────────────────
-- Plain SQL, no edge function, no secret. Guarded so a database without pg_cron
-- (PGlite, a fresh local one) applies the file cleanly. cron.schedule upserts by
-- job name. The second clause is the daily backstop for the race the header
-- describes under ERASE: a row whose person's answer is not yes is deleted whatever its age.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('whoson-presence-purge', '17 8 * * *',
      $j$ delete from public.project_presence pp
           where pp.last_seen_at < now() - interval '90 days'
              or not exists (select 1 from public.profiles f
                              where f.id = pp.user_id and f.share_presence is true) $j$);
  end if;
end $$;

-- ── 9. grants, stated (default EXECUTE is revoked on a rebuilt DB, 20260904100200) ─
revoke all on function public.project_people(text, text)     from public, anon;
revoke all on function public.set_share_presence(boolean)    from public, anon;
revoke all on function public.whoson_forget_on_choice()      from public, anon, authenticated;
revoke all on function public.whoson_forget_on_roster()      from public, anon, authenticated;
revoke all on function public.whoson_guard_roster()          from public, anon, authenticated;
revoke all on function public.whoson_guard_project_owner()   from public, anon, authenticated;
grant execute on function public.project_people(text, text)  to authenticated, service_role;
grant execute on function public.set_share_presence(boolean) to authenticated, service_role;

-- ── self-check ───────────────────────────────────────────────────────────────
-- Fail the apply, not a later request, if the locks did not land as written.
do $$
declare
  v_guard  text;
  v_src    text;
  v_server name;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.project_presence'::regclass) then
    raise exception '[whoson] verify: row level security is off on project_presence';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_presence') then
    raise exception '[whoson] verify: project_presence has a policy; it must have none';
  end if;
  if has_any_column_privilege('authenticated', 'public.project_presence', 'select, insert, update')
     or has_table_privilege('authenticated', 'public.project_presence', 'delete, truncate')
     or has_any_column_privilege('anon', 'public.project_presence', 'select, insert, update')
     or has_table_privilege('anon', 'public.project_presence', 'delete, truncate') then
    raise exception '[whoson] verify: a client role holds a privilege on project_presence';
  end if;
  if has_function_privilege('anon', 'public.project_people(text, text)', 'execute')
     or has_function_privilege('anon', 'public.set_share_presence(boolean)', 'execute') then
    raise exception '[whoson] verify: anon can execute a whoson function';
  end if;
  if not has_function_privilege('authenticated', 'public.project_people(text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_share_presence(boolean)', 'execute') then
    raise exception '[whoson] verify: authenticated cannot execute a whoson function';
  end if;
  if has_function_privilege('authenticated', 'public.whoson_forget_on_choice()', 'execute')
     or has_function_privilege('authenticated', 'public.whoson_forget_on_roster()', 'execute')
     or has_function_privilege('authenticated', 'public.whoson_guard_roster()', 'execute')
     or has_function_privilege('authenticated', 'public.whoson_guard_project_owner()', 'execute') then
    raise exception '[whoson] verify: a client role can execute a whoson trigger function';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.whoson_guard_roster()'::regprocedure)
     or (select prosecdef from pg_proc where oid = 'public.whoson_guard_project_owner()'::regprocedure) then
    raise exception '[whoson] verify: a guard is security definer; it would see its owner as current_user and guard nothing';
  end if;
  -- Both guards are the allow-list: the three server roles and the looked-up
  -- owner, and no client role by name (a role named there is a deny-list again).
  foreach v_guard in array array['public.whoson_guard_roster()', 'public.whoson_guard_project_owner()'] loop
    select p.prosrc into v_src from pg_proc p where p.oid = v_guard::regprocedure;
    if position('if current_user in (''service_role'', ''postgres'', ''supabase_admin'') then return new; end if;' in v_src) = 0
       or position('if v_server is not null and current_user = v_server then return new; end if;' in v_src) = 0
       or position('pg_catalog.to_regprocedure(''public.project_people(text,text)'')' in v_src) = 0
       or position('''authenticated''' in v_src) > 0
       or position('''anon''' in v_src) > 0 then
      raise exception '[whoson] verify: % must be the allow-list (service_role, postgres, supabase_admin, the owner of project_people) and name no client role', v_guard;
    end if;
  end loop;
  -- The fourth role both guards pass is whoever owns project_people.
  select r.rolname into v_server
    from pg_proc p join pg_roles r on r.oid = p.proowner
   where p.oid = 'public.project_people(text, text)'::regprocedure and p.prosecdef;
  if v_server is null then
    raise exception '[whoson] verify: public.project_people(text, text) must exist and be SECURITY DEFINER; both guards look its owner up';
  end if;
  if v_server in ('authenticated', 'anon', 'authenticator') then
    raise exception '[whoson] verify: public.project_people is owned by %, a role a request can run as: both guards would let that role put a person on a project', v_server;
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.projects'::regclass and t.tgname = 'aa_whoson_guard_project_owner'
                    and not t.tgisinternal and t.tgenabled <> 'D'
                    and t.tgfoid = 'public.whoson_guard_project_owner()'::regprocedure
                    and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16 and t.tgattr = ''::int2vector) then
    raise exception '[whoson] verify: the owner guard is not armed before every update on projects';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.project_collaborators'::regclass and t.tgname = 'zz_whoson_guard_roster'
                    and not t.tgisinternal and t.tgenabled <> 'D'
                    and t.tgfoid = 'public.whoson_guard_roster()'::regprocedure
                    and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16 and t.tgattr = ''::int2vector) then
    raise exception '[whoson] verify: the roster guard is not armed before insert and update on project_collaborators';
  end if;
  if (select provolatile from pg_proc where oid = 'public.project_people(text, text)'::regprocedure) <> 'v' then
    raise exception '[whoson] verify: project_people is not volatile; the mark would fail under PostgREST';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name in ('share_presence', 'share_presence_at')
         and is_nullable = 'YES' and column_default is null) <> 2 then
    raise exception '[whoson] verify: share_presence must be nullable with no default (NULL = not asked)';
  end if;
end;
$$;

notify pgrst, 'reload schema';
