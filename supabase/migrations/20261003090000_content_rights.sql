-- 20261003090000_content_rights.sql — close the public read on the two retired
-- third-party caches (lane CRSERVER, contentfix 2026-10-03).
--
-- WHY. contentfix-specs/RIGHTS-VERDICT.md: cached_companies holds Google Places
-- business listings (names, addresses, ratings) that Google's Maps Platform
-- terms forbid storing at all, and cached_jobs holds Adzuna listings the app
-- never shows. Both were readable by ANYONE holding the public anon key
-- (rls_baseline.sql: anon_read_companies / anon_read_jobs, SELECT to anon,
-- authenticated using (true)). fetch-external-data no longer writes either
-- table. This migration closes the read for every client role; service_role
-- (the edge functions and the cleanup SQL) keeps full access through its own
-- grants and BYPASSRLS. RLS stays enabled on both tables.
--
-- NO DATA IS DELETED HERE. The one-off purge (both tables emptied, the Google
-- rows in city_coords deleted, the Google coordinates on cached_bids nulled) is
-- docs/ops/2026-10-03-content-rights-cleanup.sql, run by hand after deploy.
--
-- Old app builds still query cached_companies on Discover > Companies (hidden
-- in the new build by COMPANIES_DIRECTORY_ENABLED = false). After this they get
-- a permission error, which that screen already shows as its error state.
--
-- VERIFY AFTER (proven on PGlite: scratchpad/pgq/content-rights.mjs)
--   select policyname, roles, cmd from pg_policies
--    where schemaname = 'public' and tablename in ('cached_companies', 'cached_jobs');
--     -- 0 rows
--   select has_table_privilege('anon', 'public.cached_companies', 'SELECT'),            -- false
--          has_table_privilege('authenticated', 'public.cached_companies', 'SELECT'),   -- false
--          has_table_privilege('anon', 'public.cached_jobs', 'SELECT'),                 -- false
--          has_table_privilege('authenticated', 'public.cached_jobs', 'SELECT'),        -- false
--          has_table_privilege('service_role', 'public.cached_companies', 'SELECT'),    -- true
--          has_table_privilege('service_role', 'public.cached_jobs', 'SELECT');         -- true
--   select relname, relrowsecurity from pg_class
--    where oid in ('public.cached_companies'::regclass, 'public.cached_jobs'::regclass);
--     -- both true
--   -- and live: GET /rest/v1/cached_companies?select=id&limit=1 with the anon key
--   -- answers 401 / 42501 (permission denied), not 200 [].
--
-- Idempotent: DROP POLICY IF EXISTS, a catalog-driven drop of any other client
-- SELECT policy, REVOKE (a no-op when already revoked). Safe to apply before or
-- after the function deploy.

-- ── 1. the two known public read policies ─────────────────────────────────
drop policy if exists anon_read_companies on public.cached_companies;
drop policy if exists anon_read_jobs on public.cached_jobs;

-- ── 2. any other policy that lets a client role read either table ─────────
-- (a SELECT or ALL policy for anon, authenticated or public added outside the
-- repo). service_role-only policies are left alone.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('cached_companies', 'cached_jobs')
       and cmd in ('SELECT', 'ALL')
       and roles && array['anon', 'authenticated', 'public']::name[]
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end
$$;

-- ── 3. grants: no client role can read (or write) either table ────────────
-- Supabase's default privileges grant every new public table to anon and
-- authenticated; RLS was the only thing between them and these rows. Revoke
-- ALL (a superset of SELECT): no client ever wrote here either.
revoke all on table public.cached_companies from anon, authenticated, public;
revoke all on table public.cached_jobs from anon, authenticated, public;
grant all on table public.cached_companies to service_role;
grant all on table public.cached_jobs to service_role;

alter table public.cached_companies enable row level security;
alter table public.cached_jobs enable row level security;

-- ── 4. self-check: refuse to commit a half-closed state ───────────────────
do $$
declare
  t text;
  r text;
begin
  foreach t in array array['public.cached_companies', 'public.cached_jobs'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_table_privilege(r, t, 'SELECT') then
        raise exception '[content-rights] verify: % can still SELECT %', r, t;
      end if;
    end loop;
    if not has_table_privilege('service_role', t, 'SELECT') then
      raise exception '[content-rights] verify: service_role lost SELECT on %', t;
    end if;
  end loop;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('cached_companies', 'cached_jobs')
       and cmd in ('SELECT', 'ALL')
       and roles && array['anon', 'authenticated', 'public']::name[]
  ) then
    raise exception '[content-rights] verify: a client read policy remains on cached_companies / cached_jobs';
  end if;
end
$$;
