-- 20261002170000_jurisdiction_answers.sql
--
-- public.jurisdiction_answers: what a building department told the GC (lane
-- PPASK, Permit Path).
--
-- WHAT A ROW MEANS. Permit Path could not answer a question for one
-- jurisdiction (a Long Island town's survey rule, say), so the GC asked the
-- department by email or phone, and saved what they said: the answer in their
-- words, the day, who said it (name, title), how (phone, email, counter,
-- website, letter, other), an optional https link, and which questions it
-- answers (question_ids, 1 to 20 ids from the question packs). From then on
-- that answer shows as "Department said · <date> · <who>" on every route in
-- that jurisdiction (jurisdiction_key: 'NYC' or a PermitOffice key such as
-- 'NY:3605934000'). It is never "verified"; it stays one person's dated
-- statement, and after 365 days the app asks the GC to ask again.
--
-- WHO WRITES. The GC, from the app, through the offline write path
-- (utils/offlineQueue.ts supabaseWrite / supabaseWriteDetailed). The row id is
-- generated on the device, so a save made offline lands later with the same id
-- (a re-send meets its own primary key and the queue reads that as landed).
-- Column grants: INSERT of every content column, never user_id (it defaults
-- to auth.uid() and the policies check it), created_at or updated_at (the
-- trigger stamps both). The app never edits a saved answer (delete, then save
-- again, so the record of what was said on a date stays intact); the UPDATE
-- policy and grant exist for a later correction flow, and the trigger refuses
-- any change of owner or jurisdiction. DELETE own rows.
--
-- WHO READS. The owner only (select own, RLS). anon has no privilege at all.
--
-- WHY NO SHARE COLUMN. A saved answer is private in v1 (PLAN F3). Sharing an
-- answer with other GCs is a later, explicit, per-answer opt-in, added by its
-- own migration with its own policy. Nothing here can be read by anyone else.
--
-- PROJECT LINK. project_id is optional (the job the GC was on when he asked).
-- Insert and update both require that project to be his own
-- (projects.user_id, supabase/schema.sql), the same form as
-- 20261002161000_job_fact_links.sql. Deleting the project keeps the answer
-- (on delete set null): the department's answer is about the jurisdiction.
--
-- DEPLOY ORDER: apply this BEFORE the OTA that ships the Permit Path ask flow.
-- Without the table the offline queue holds every save and keeps retrying it.
--
-- VERIFY AFTER
--   select relrowsecurity from pg_class where oid = 'public.jurisdiction_answers'::regclass;   -- true
--   select policyname, roles, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'jurisdiction_answers' order by policyname;
--     -- exactly four, all {authenticated}: jurisdiction_answers_delete_own DELETE,
--     -- jurisdiction_answers_insert_own INSERT, jurisdiction_answers_select_own SELECT,
--     -- jurisdiction_answers_update_own UPDATE
--   select has_table_privilege('authenticated', 'public.jurisdiction_answers', 'SELECT'),                  -- true
--          has_table_privilege('authenticated', 'public.jurisdiction_answers', 'DELETE'),                  -- true
--          has_column_privilege('authenticated', 'public.jurisdiction_answers', 'answer_text', 'INSERT'),  -- true
--          has_column_privilege('authenticated', 'public.jurisdiction_answers', 'user_id', 'INSERT'),      -- false
--          has_column_privilege('authenticated', 'public.jurisdiction_answers', 'user_id', 'UPDATE'),      -- false
--          has_column_privilege('authenticated', 'public.jurisdiction_answers', 'created_at', 'INSERT'),   -- false
--          has_table_privilege('authenticated', 'public.jurisdiction_answers', 'TRUNCATE'),                -- false
--          has_any_column_privilege('anon', 'public.jurisdiction_answers', 'SELECT'),                      -- false
--          has_any_column_privilege('anon', 'public.jurisdiction_answers', 'INSERT');                      -- false
--   anon probe (no user JWT):
--     curl -s -o /dev/null -w '%{http_code}' "$SUPABASE_URL/rest/v1/jurisdiction_answers?select=id&limit=1" \
--       -H "apikey: $ANON_KEY"      -- 401 (permission denied for table), or 200 with []
--
-- Idempotent: create ... if not exists / or replace, drop policy / trigger if
-- exists, and grants that are no-ops the second time.

-- ── table ────────────────────────────────────────────────────────────────────
create table if not exists public.jurisdiction_answers (
  id uuid primary key,                         -- client-generated (offline)
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  jurisdiction_key text not null
    check (jurisdiction_key ~ '^(NYC|NY:[0-9]{7,10}|NJ:[0-9]{4}|CT:[A-Za-z0-9_-]{1,40}|MD:[0-9]{5})$'),
  jurisdiction_name text not null check (char_length(jurisdiction_name) between 1 and 200),
  question_ids text[] not null
    check (cardinality(question_ids) between 1 and 20)
    -- every id is a pack id ('li.survey'). The ids are joined with a comma,
    -- which no id may contain, so the pattern sees each one whole (an id with a
    -- space or an empty id fails); array_to_string skips nulls, so nulls are
    -- refused separately
    check (array_position(question_ids, null) is null and
           array_to_string(question_ids, ',') ~ '^[A-Za-z0-9_.:-]{1,80}(,[A-Za-z0-9_.:-]{1,80})*$'),
  question_text text not null check (char_length(question_text) between 1 and 2000),
  answer_text text not null check (char_length(answer_text) between 1 and 4000),
  answered_on date not null check (answered_on <= (now() at time zone 'America/New_York')::date + 1),
  said_by_name text check (char_length(said_by_name) <= 120),
  said_by_role text check (char_length(said_by_role) <= 120),
  channel text not null check (channel in ('phone','email','counter','website','letter','other')),
  source_url text check (source_url is null or (source_url ~ '^https://' and char_length(source_url) <= 2000)),
  project_id uuid references public.projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jurisdiction_answers_user_key_idx
  on public.jurisdiction_answers (user_id, jurisdiction_key);

-- ── trigger: server-owned dates, fixed owner and jurisdiction ───────────────
create or replace function public.jurisdiction_answers_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE
  if new.user_id is distinct from old.user_id then
    raise exception 'jurisdiction_answers: the owner of an answer is fixed' using errcode = '42501';
  end if;
  if new.jurisdiction_key is distinct from old.jurisdiction_key then
    raise exception 'jurisdiction_answers: an answer cannot move to another jurisdiction' using errcode = '42501';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists jurisdiction_answers_guard on public.jurisdiction_answers;
create trigger jurisdiction_answers_guard
  before insert or update on public.jurisdiction_answers
  for each row execute function public.jurisdiction_answers_guard();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.jurisdiction_answers enable row level security;

drop policy if exists jurisdiction_answers_select_own on public.jurisdiction_answers;
create policy jurisdiction_answers_select_own on public.jurisdiction_answers
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists jurisdiction_answers_insert_own on public.jurisdiction_answers;
create policy jurisdiction_answers_insert_own on public.jurisdiction_answers
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and (project_id is null
         or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  );

drop policy if exists jurisdiction_answers_update_own on public.jurisdiction_answers;
create policy jurisdiction_answers_update_own on public.jurisdiction_answers
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (project_id is null
         or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  );

drop policy if exists jurisdiction_answers_delete_own on public.jurisdiction_answers;
create policy jurisdiction_answers_delete_own on public.jurisdiction_answers
  for delete to authenticated
  using (auth.uid() = user_id);

-- ── grants ───────────────────────────────────────────────────────────────────
-- Column grants: the client writes the content columns only. TRUNCATE is not
-- subject to RLS, so it is revoked explicitly (20260926190000 hygiene).
revoke all on public.jurisdiction_answers from anon, public;
revoke all on public.jurisdiction_answers from authenticated;
grant select, delete on public.jurisdiction_answers to authenticated;
grant insert (id, jurisdiction_key, jurisdiction_name, question_ids, question_text, answer_text,
              answered_on, said_by_name, said_by_role, channel, source_url, project_id)
  on public.jurisdiction_answers to authenticated;
grant update (jurisdiction_name, question_ids, question_text, answer_text, answered_on,
              said_by_name, said_by_role, channel, source_url, project_id, jurisdiction_key)
  on public.jurisdiction_answers to authenticated;
grant all on public.jurisdiction_answers to service_role;

-- Postgres 17+ (prod is 17.6): MAINTAIN lets LOCK TABLE ignore RLS. Older
-- servers (PGlite) have no MAINTAIN and skip it.
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on public.jurisdiction_answers from authenticated';
  end if;
end;
$$;

-- ── self-check ───────────────────────────────────────────────────────────────
-- Fail the apply, not a later request, if the grants did not land as written.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.jurisdiction_answers'::regclass) then
    raise exception '[ppask] verify: row level security is off on jurisdiction_answers';
  end if;
  if has_table_privilege('authenticated', 'public.jurisdiction_answers', 'insert')
     or has_table_privilege('authenticated', 'public.jurisdiction_answers', 'update')
     or has_table_privilege('authenticated', 'public.jurisdiction_answers', 'truncate') then
    raise exception '[ppask] verify: authenticated holds a table-wide insert, update or truncate on jurisdiction_answers';
  end if;
  if has_column_privilege('authenticated', 'public.jurisdiction_answers', 'user_id', 'insert')
     or has_column_privilege('authenticated', 'public.jurisdiction_answers', 'user_id', 'update')
     or has_column_privilege('authenticated', 'public.jurisdiction_answers', 'id', 'update')
     or has_column_privilege('authenticated', 'public.jurisdiction_answers', 'created_at', 'insert')
     or has_column_privilege('authenticated', 'public.jurisdiction_answers', 'created_at', 'update')
     or has_column_privilege('authenticated', 'public.jurisdiction_answers', 'updated_at', 'insert')
     or has_column_privilege('authenticated', 'public.jurisdiction_answers', 'updated_at', 'update') then
    raise exception '[ppask] verify: authenticated can write a server-owned column of jurisdiction_answers';
  end if;
  if has_any_column_privilege('anon', 'public.jurisdiction_answers', 'select')
     or has_any_column_privilege('anon', 'public.jurisdiction_answers', 'insert')
     or has_any_column_privilege('anon', 'public.jurisdiction_answers', 'update')
     or has_table_privilege('anon', 'public.jurisdiction_answers', 'delete') then
    raise exception '[ppask] verify: anon holds a privilege on jurisdiction_answers';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'jurisdiction_answers') <> 4 then
    raise exception '[ppask] verify: jurisdiction_answers should carry exactly four policies';
  end if;
end;
$$;
