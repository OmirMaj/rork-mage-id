-- 20260926190000_table_grant_hygiene.sql
--
-- WHY. The `public` schema's default privileges (as read from prod on
-- 2026-09-26) hand `anon` and `authenticated` ALL on every table `postgres`
-- creates. So every older table (punch_items, deliveries, field_tickets, …)
-- grants both client roles TRUNCATE, TRIGGER and REFERENCES. PostgREST exposes
-- none of the three, but TRUNCATE is not subject to row level security: a
-- client role must never hold it. 20260926181000 already did this for the two
-- newest tables (code_checks, takeoff_docs, and only for `authenticated`);
-- this does it for every table in the schema and stops new tables getting it.
--
-- WHAT IT DOES.
--   a) For every ordinary and partitioned table in schema public (pg_class
--      relkind 'r' / 'p' — partitions included), revokes TRUNCATE, TRIGGER and
--      REFERENCES from anon and authenticated. Each table is its own step: a
--      table the migration role cannot revoke on is reported by name in a
--      NOTICE, never skipped silently, and a closing NOTICE gives the counts
--      (revoked / could not revoke / still held afterwards).
--   b) ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public revokes the
--      same three verbs, so a table created later does not get them back.
--   On Postgres 17+ (prod is 17.6) MAINTAIN (VACUUM / ANALYZE / LOCK TABLE /
--   REFRESH) is revoked too, in both passes: no client role needs it, and
--   LOCK TABLE ignores RLS. Older servers (PGlite) have no MAINTAIN and skip it.
--
-- WHAT IT DOES NOT DO.
--   - SELECT / INSERT / UPDATE / DELETE are untouched on every table (RLS
--     gates those; changing them is out of scope).
--   - service_role is untouched, and so is every other role.
--   - Views, materialized views, sequences, functions, and the storage, auth
--     and every other schema are untouched.
--   - Default privileges of roles other than postgres (e.g. supabase_admin)
--     are untouched.
--
-- Idempotent: revoking a privilege that is not held is a no-op, so running it
-- twice changes nothing the second time.

do $$
declare
  t record;
  n_tables  int := 0;
  n_revoked int := 0;
  n_failed  int := 0;
  n_left    int := 0;
  verbs     text := case when current_setting('server_version_num')::int >= 170000
                         then 'truncate, trigger, references, maintain'
                         else 'truncate, trigger, references' end;
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'table_grant_hygiene: role anon or authenticated does not exist — no table revokes run';
    return;
  end if;

  for t in
    select n.nspname, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
     order by c.relname
  loop
    n_tables := n_tables + 1;
    begin
      execute format(
        'revoke %s on table %I.%I from anon, authenticated',
        verbs, t.nspname, t.relname
      );
      n_revoked := n_revoked + 1;
    exception when others then
      n_failed := n_failed + 1;
      raise notice 'table_grant_hygiene: could not revoke on %.%: % (%)', t.nspname, t.relname, sqlerrm, sqlstate;
    end;
  end loop;

  -- What is still held afterwards (e.g. granted by a role other than the one
  -- running this) — counted and named, never assumed gone.
  for t in
    select n.nspname, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and (
         has_table_privilege('anon', c.oid, 'TRUNCATE')
         or has_table_privilege('anon', c.oid, 'TRIGGER')
         or has_table_privilege('anon', c.oid, 'REFERENCES')
         or has_table_privilege('authenticated', c.oid, 'TRUNCATE')
         or has_table_privilege('authenticated', c.oid, 'TRIGGER')
         or has_table_privilege('authenticated', c.oid, 'REFERENCES')
       )
     order by c.relname
  loop
    n_left := n_left + 1;
    raise notice 'table_grant_hygiene: anon/authenticated still hold truncate/trigger/references on %.%', t.nspname, t.relname;
  end loop;

  raise notice 'table_grant_hygiene: % public tables; revoked on %, could not revoke on %, still held on %',
    n_tables, n_revoked, n_failed, n_left;
end
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'postgres') then
    raise notice 'table_grant_hygiene: role postgres does not exist — default privileges left as they are';
    return;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'table_grant_hygiene: role anon or authenticated does not exist — default privileges left as they are';
    return;
  end if;
  if current_setting('server_version_num')::int >= 170000 then
    execute 'alter default privileges for role postgres in schema public revoke truncate, trigger, references, maintain on tables from anon, authenticated';
  else
    alter default privileges for role postgres in schema public
      revoke truncate, trigger, references on tables from anon, authenticated;
  end if;
  raise notice 'table_grant_hygiene: default privileges for role postgres in schema public no longer grant truncate/trigger/references to anon, authenticated';
end
$$;
