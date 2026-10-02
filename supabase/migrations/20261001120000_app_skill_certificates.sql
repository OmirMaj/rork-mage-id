-- 20261001120000_app_skill_certificates.sql
--
-- public.app_skill_certificates: one row per app-skills check a person passed
-- (track LEARN, lane LEARNCERT).
--
-- WHAT A ROW MEANS. The person passed a short check on using one part of the
-- MAGE ID app, after practising its tutorial. It is NOT a trade, safety or
-- license credential, and it shares nothing with the worker certifications in
-- public.certifications (20260708180000_safety_wave_b.sql). The holder name is
-- whatever the account holder typed: MAGE ID does not check identity.
--
-- WHO WRITES. Only the skill-certificate-award edge function, with the service
-- role, after it graded the answer sheet itself against
-- supabase/functions/_shared/skillQuizKey.generated.ts. A client cannot mint a
-- certificate: authenticated has no INSERT or UPDATE grant and there is no
-- insert / update policy. The checks below repeat the pass rule (80 percent,
-- integer math, utils/learn/topics.ts PASS_PCT) so even a buggy server write
-- cannot store a failing score.
--
-- WHO READS. The owner, through RLS (select own). The public verify page reads
-- one row by its check code through skill-certificate-verify (service role),
-- which returns the name, the skill, the date and the score, never user_id.
--
-- DELETE. A person may remove a certificate from their profile (delete own).
-- Deleting the row also kills its verify link. The account-deletion cascade
-- (user_id ... on delete cascade) removes every row with the login.
--
-- REVOKE (support, by hand, ONLY at the holder's request — the verify page then
-- says "This certificate was removed by its owner.", so it must stay true):
--   update public.app_skill_certificates set revoked_at = now() where verify_code = 'XXXXXXXXXXXX';
--
-- DEPLOY ORDER: apply this BEFORE deploying skill-certificate-award (the award
-- would 500 on a missing table) and before the OTA that ships the skills screens.
--
-- VERIFY AFTER
--   select relrowsecurity from pg_class where oid = 'public.app_skill_certificates'::regclass;   -- true
--   select policyname, roles, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'app_skill_certificates' order by policyname;
--     -- exactly two, both {authenticated}: app_skill_certificates_delete_own DELETE, app_skill_certificates_select_own SELECT
--   select has_table_privilege('authenticated', 'public.app_skill_certificates', 'SELECT'),       -- true
--          has_table_privilege('authenticated', 'public.app_skill_certificates', 'DELETE'),       -- true
--          has_any_column_privilege('authenticated', 'public.app_skill_certificates', 'INSERT'),  -- false
--          has_any_column_privilege('authenticated', 'public.app_skill_certificates', 'UPDATE'),  -- false
--          has_table_privilege('authenticated', 'public.app_skill_certificates', 'TRUNCATE'),     -- false
--          has_table_privilege('anon', 'public.app_skill_certificates', 'SELECT');                -- false
--   select conname from pg_constraint where conrelid = 'public.app_skill_certificates'::regclass order by conname;
--     -- includes app_skill_certificates_correct_range, app_skill_certificates_one_per_version, app_skill_certificates_pass
--
-- Idempotent: create ... if not exists, drop policy if exists, and grants that
-- are no-ops the second time.

create table if not exists public.app_skill_certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null check (topic in (
    'daily-report-voice',
    'punch-walk',
    'invoice-to-self',
    'schedule-say-it',
    'estimate-first',
    'takeoff-to-estimate',
    'construction-ai-ask',
    'change-order-draft',
    'pay-app-period',
    'field-ticket-log',
    'time-clock-in',
    'punch-list-close',
    'ask-your-plans',
    'contract-from-estimate',
    'closeout-binder'
  )),
  quiz_version integer not null check (quiz_version >= 1),
  correct integer not null,
  total integer not null check (total between 3 and 5),
  holder_name text not null check (
    char_length(btrim(holder_name)) between 2 and 80
    and position('@' in holder_name) = 0
    and holder_name !~ '[[:cntrl:]]'
  ),
  verify_code text not null unique check (verify_code ~ '^[A-HJ-NP-Z2-9]{12}$'),
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint app_skill_certificates_correct_range check (correct between 0 and total),
  constraint app_skill_certificates_pass check (correct * 100 >= 80 * total),
  constraint app_skill_certificates_one_per_version unique (user_id, topic, quiz_version)
);

create index if not exists app_skill_certificates_user_issued_idx
  on public.app_skill_certificates (user_id, issued_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.app_skill_certificates enable row level security;

drop policy if exists app_skill_certificates_select_own on public.app_skill_certificates;
create policy app_skill_certificates_select_own on public.app_skill_certificates
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists app_skill_certificates_delete_own on public.app_skill_certificates;
create policy app_skill_certificates_delete_own on public.app_skill_certificates
  for delete to authenticated
  using (auth.uid() = user_id);

-- No insert or update policy: the award function (service role) is the only writer.
drop policy if exists app_skill_certificates_insert on public.app_skill_certificates;
drop policy if exists app_skill_certificates_update on public.app_skill_certificates;

-- ── grants ───────────────────────────────────────────────────────────────────
-- The client role keeps exactly the two verbs it uses. TRUNCATE is not subject
-- to RLS, so it is revoked explicitly (20260926190000 hygiene). service_role
-- keeps its full rights (the award and verify functions).
revoke all on public.app_skill_certificates from anon, public;
revoke insert, update, truncate, trigger, references on public.app_skill_certificates from authenticated;
grant select, delete on public.app_skill_certificates to authenticated;

-- Postgres 17+ (prod is 17.6): MAINTAIN lets LOCK TABLE ignore RLS. Older
-- servers (PGlite) have no MAINTAIN and skip it.
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on public.app_skill_certificates from authenticated';
  end if;
end;
$$;

-- ── self-check ───────────────────────────────────────────────────────────────
-- Fail the apply, not a later request, if the grants did not land as written.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_skill_certificates'::regclass) then
    raise exception '[learncert] verify: row level security is off on app_skill_certificates';
  end if;
  if has_table_privilege('authenticated', 'public.app_skill_certificates', 'insert')
     or has_table_privilege('authenticated', 'public.app_skill_certificates', 'update')
     or has_table_privilege('authenticated', 'public.app_skill_certificates', 'truncate') then
    raise exception '[learncert] verify: authenticated can still insert, update or truncate app_skill_certificates';
  end if;
  -- A column grant (grant update (holder_name) ...) is invisible to
  -- has_table_privilege; has_any_column_privilege sees it.
  if has_any_column_privilege('authenticated', 'public.app_skill_certificates', 'insert')
     or has_any_column_privilege('authenticated', 'public.app_skill_certificates', 'update') then
    raise exception '[learncert] verify: authenticated holds a column insert or update grant on app_skill_certificates';
  end if;
  if has_table_privilege('anon', 'public.app_skill_certificates', 'select') then
    raise exception '[learncert] verify: anon can still read app_skill_certificates';
  end if;
end;
$$;
