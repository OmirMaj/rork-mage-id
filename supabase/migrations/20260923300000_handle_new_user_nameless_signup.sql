-- 20260923300000_handle_new_user_nameless_signup.sql — hotfix
--
-- WHY. A new customer tried to sign up with "Email me a sign-in link" and saw
-- "Edge Function returned a non-2xx status code". auth-magic-link calls
-- auth.admin.generateLink, which creates the auth.users row; the
-- on_auth_user_created trigger (public.handle_new_user) then inserts the
-- profile with name = raw_user_meta_data->>'name'. An email-link signup carries
-- no name, so that is an explicit NULL — which overrides the column's '' default
-- and violates profiles.name NOT NULL. Postgres logged "null value in column
-- "name" of relation "profiles" violates not-null constraint" and GoTrue
-- answered "Database error saving new user" (500) for every email-link signup
-- (seen 2026-09-22 22:04 UTC and 2026-09-23 00:04-00:05 UTC). Apple / Google
-- signups pass a name and were unaffected.
--
-- WHAT. Same function, same trigger, same SECURITY DEFINER + search_path '';
-- the name falls back to full_name, then to '' (the column default), and the
-- email to '' so a provider that sends no email can never hit email's NOT NULL
-- either. ON CONFLICT DO NOTHING kept. Idempotent: CREATE OR REPLACE only.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      nullif(btrim(new.raw_user_meta_data->>'name'), ''),
      nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
      ''
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;
