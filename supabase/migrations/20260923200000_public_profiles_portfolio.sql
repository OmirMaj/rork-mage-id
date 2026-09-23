-- ============================================================================
-- 20260923200000_public_profiles_portfolio.sql  (audit wave 5, lane portfolio:
-- #47 / #75 / #77 / #78 / #81, CONTRACT 12)
--
-- The public project page at mageid.app/builders/<company>/<project> is built
-- entirely from the snapshot in its #d= hash. Two things a link can't carry
-- need the server:
--
--  1. WHETHER THE BUILDER STILL WANTS IT UP. The setup screen said "you can
--     unpublish anytime", but switching Publish off only changed a field on
--     his phone. Every link he had texted or posted kept rendering the job,
--     with the client's address, the contract value and his quote form. Now
--     each page has a public_profiles row. Its id (`pid`) rides in the
--     snapshot, and the page calls the anon RPC public_profile_status(pid)
--     before it renders. A row that is disabled or missing means "taken down".
--     The app writes the row through the offline queue when he flips the
--     switch.
--
--  2. PHOTOS THAT STILL LOAD NEXT WEEK. The snapshot carried ProjectPhoto.uri:
--     a file:// path on the phone that took the photo, or a 24-hour signed URL.
--     On Share / Copy / Preview the app now copies each chosen photo (and a
--     data:/file: logo) into the public `portfolio` bucket at
--     <uid>/<projectId>/<photoId>.jpg and links to getPublicUrl().
--
-- THE ROW ID IS DERIVED, NOT RANDOM. id = first 16 bytes of
-- sha256('mageid-portfolio:v1:<owner uid>:<project id>') as a uuid. The app
-- computes the same value (utils/publicProfileSnapshot.ts publicProfileIdFor).
-- project.publicProfile is device-local, so a random id stored there would
-- be lost to a second phone or a reinstall, and he could never take the page
-- down again. The BEFORE INSERT trigger derives the id from the INSERTING
-- user's uid, so nobody can pre-create the row behind someone else's page.
--
-- GUARD RULE (wave-5 plan): columns a replayed client write must not change
-- (id, owner_id, project_id) are pinned SILENTLY (NEW.col := OLD.col). The
-- offline queue turns a raise into a permanent failure.
--
-- WHAT IT GIVES UP: links made before this ships carry no pid and can never be
-- recalled. The setup screen says so. Switching Publish off also deletes that
-- job's copies from the bucket (utils/portfolioPublish.ts
-- removePortfolioCopies). That is a best-effort storage call, not a queued
-- write, so if he unpublishes offline the copies answer at their URLs until he
-- next opens the screen online. The page itself is down either way, because
-- the row write IS queued.
--
-- Idempotent: safe to run twice.
-- ============================================================================

-- ── id derivation (shared by the trigger; the app mirrors it) ────────────────
create or replace function public.public_profile_id_for(p_owner uuid, p_project_id text)
returns uuid
language sql
immutable
set search_path = pg_catalog, public
as $$
  select encode(
    substring(sha256(convert_to('mageid-portfolio:v1:' || p_owner::text || ':' || p_project_id, 'UTF8')) from 1 for 16),
    'hex')::uuid
$$;
-- Supabase's default privileges grant EXECUTE on new functions to anon
-- explicitly, so revoking from PUBLIC alone would leave it.
revoke all on function public.public_profile_id_for(uuid, text) from public, anon;
grant execute on function public.public_profile_id_for(uuid, text) to authenticated, service_role;

-- ── table ────────────────────────────────────────────────────────────────────
create table if not exists public.public_profiles (
  id          uuid primary key default gen_random_uuid(),
  -- CASCADE: deleting the account deletes its page flags (the pages then read
  -- "taken down"). The bucket's copies are removed by delete-account
  -- (USER_KEYED_BUCKETS, handed to the join lane).
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id  text not null,
  enabled     boolean not null,
  revoked_at  timestamptz,
  updated_at  timestamptz
);
create unique index if not exists public_profiles_owner_project_key
  on public.public_profiles (owner_id, project_id);

alter table public.public_profiles enable row level security;

-- Owner-only. anon reads nothing from the table. The page learns only
-- `enabled`, through public_profile_status below.
drop policy if exists public_profiles_owner_select on public.public_profiles;
create policy public_profiles_owner_select on public.public_profiles
  for select to authenticated using (owner_id = auth.uid());
drop policy if exists public_profiles_owner_insert on public.public_profiles;
create policy public_profiles_owner_insert on public.public_profiles
  for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists public_profiles_owner_update on public.public_profiles;
create policy public_profiles_owner_update on public.public_profiles
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists public_profiles_owner_delete on public.public_profiles;
create policy public_profiles_owner_delete on public.public_profiles
  for delete to authenticated using (owner_id = auth.uid());

revoke all on public.public_profiles from anon, public;
grant select, insert, update, delete on public.public_profiles to authenticated;
grant all on public.public_profiles to service_role;

-- ── guard trigger ────────────────────────────────────────────────────────────
create or replace function public.public_profiles_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    -- The writer is the owner. A client-sent owner_id is ignored.
    if auth.uid() is not null then
      new.owner_id := auth.uid();
    end if;
    new.id := public.public_profile_id_for(new.owner_id, new.project_id);
    new.revoked_at := case when new.enabled then null else coalesce(new.revoked_at, now()) end;
  else
    new.id := old.id;
    new.owner_id := old.owner_id;
    new.project_id := old.project_id;
    new.revoked_at := case
      when new.enabled then null
      when old.enabled = false and old.revoked_at is not null then old.revoked_at
      else now()
    end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists public_profiles_guard on public.public_profiles;
create trigger public_profiles_guard
  before insert or update on public.public_profiles
  for each row execute function public.public_profiles_guard();
revoke all on function public.public_profiles_guard() from public, anon, authenticated;

-- ── the page's check (anon) ──────────────────────────────────────────────────
-- Returns { "enabled": boolean } and nothing else. A missing row, a disabled
-- row, or a row whose job is gone from its owner's account all read false.
create or replace function public.public_profile_status(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object('enabled', coalesce((
    select pp.enabled
      from public.public_profiles pp
     where pp.id = p_id
       and exists (
         select 1 from public.projects p
          where p.id::text = pp.project_id
            and p.user_id = pp.owner_id
       )
  ), false))
$$;
revoke all on function public.public_profile_status(uuid) from public;
grant execute on function public.public_profile_status(uuid) to anon, authenticated, service_role;

-- ── the portfolio bucket ─────────────────────────────────────────────────────
-- Public read: the page is public by design and its photo URLs sit on his
-- website indefinitely. Writes only under the writer's own uid folder, into
-- 'branding' or a job he owns (see the INSERT policy). Images
-- only, 10 MB each (the largest project photo in production is 4.8 MB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portfolio', 'portfolio', true, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- SELECT is the owner's own folder only. The public URL (/object/public/…)
-- doesn't go through RLS, and no anon policy means the bucket can't be listed.
-- The owner's SELECT is what storage needs for an upsert and for a copy's
-- existence check.
drop policy if exists portfolio_owner_select on storage.objects;
create policy portfolio_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'portfolio' and (storage.foldername(name))[1] = auth.uid()::text);
-- INSERT / UPDATE also need the second folder to be 'branding' (his logo) or
-- a job HE owns (projects.user_id = auth.uid()). An invited collaborator can
-- read the owner's private photos (project_photos_select is
-- can_access_project), so without this he could copy the owner's client
-- photos into a PUBLIC folder under his own uid, where the owner can neither
-- see nor remove them. The app gates publishing to the owner as well
-- (app/public-profile-setup.tsx); this is the server's half. It also refuses
-- copies for a job whose projects row hasn't synced yet, whose page would read
-- "taken down" anyway (public_profile_status joins projects the same way).
-- objects.name is qualified inside the subquery: public.projects has its own
-- `name` column, and a bare `name` there binds to p.name (the job's title).
drop policy if exists portfolio_owner_insert on storage.objects;
create policy portfolio_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'portfolio'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      (storage.foldername(name))[2] = 'branding'
      or exists (
        select 1 from public.projects p
         where p.id::text = (storage.foldername(objects.name))[2]
           and p.user_id = auth.uid()
      )
    )
  );
drop policy if exists portfolio_owner_update on storage.objects;
create policy portfolio_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'portfolio' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (
    bucket_id = 'portfolio'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      (storage.foldername(name))[2] = 'branding'
      or exists (
        select 1 from public.projects p
         where p.id::text = (storage.foldername(objects.name))[2]
           and p.user_id = auth.uid()
      )
    )
  );
drop policy if exists portfolio_owner_delete on storage.objects;
create policy portfolio_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'portfolio' and (storage.foldername(name))[1] = auth.uid()::text);
