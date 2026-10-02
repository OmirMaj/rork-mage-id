-- 20261002150000_punch_seals.sql — the sealed final punch (lane SEAL).
--
-- The last punch walk ends in ONE immutable record: every formal punch item
-- closed with an after photo, the client's acceptance signed in person, a
-- server-computed SHA-256 over the record, and later a PDF whose hash is
-- verified once. It certifies "these items were closed as of this date". It is
-- not a warranty, not a lien release, and it releases no retainage.
--
-- WHO WRITES WHAT
--   punch_seals      only the seal-punch edge function (service role). No client
--                    insert, update or delete policy exists, and the grants are
--                    SELECT only. RAISE is correct in its trigger: the offline
--                    queue never writes this table, so nothing replays into it.
--   punch_items      after_photo_uri / after_photo_taken_at come from the app
--                    (queued, like photo_uri). seal_id comes ONLY from the edge
--                    function. A sealed row's content is PINNED to its old
--                    values, never refused: a RAISE on a table the offline queue
--                    writes turns a replayed update into a permanent failure that
--                    gets dropped (20260803110000_create_field_tickets.sql:13-18),
--                    so the pin pattern of punch_items_guard is used instead.
--   storage          bucket punch-seals (private): owner-folder SELECT and INSERT
--                    only. No UPDATE or DELETE policy, so the stored PDF cannot
--                    be overwritten by a client (uploads go with upsert:false).
--                    The sealed after-photo copies are written by the service role.
--
-- VERIFY AFTER (proven on PGlite at integration)
--   select relrowsecurity from pg_class where oid = 'public.punch_seals'::regclass;   -- true
--   select policyname, roles, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'punch_seals' order by policyname;
--     -- exactly one: punch_seals_owner_select {authenticated} SELECT
--   select has_table_privilege('authenticated', 'public.punch_seals', 'SELECT'),   -- true
--          has_table_privilege('authenticated', 'public.punch_seals', 'INSERT'),   -- false
--          has_table_privilege('authenticated', 'public.punch_seals', 'UPDATE'),   -- false
--          has_table_privilege('authenticated', 'public.punch_seals', 'DELETE'),   -- false
--          has_table_privilege('anon', 'public.punch_seals', 'SELECT');            -- false
--   select tgname from pg_trigger
--    where tgname in ('punch_seals_immutable', 'punch_items_seal_pin') order by tgname;
--     -- punch_items_seal_pin, punch_seals_immutable
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'punch_items'
--      and column_name in ('after_photo_uri', 'after_photo_taken_at', 'seal_id') order by column_name;
--     -- after_photo_taken_at, after_photo_uri, seal_id
--   select id, public from storage.buckets where id = 'punch-seals';   -- punch-seals | false
--   select policyname, cmd from pg_policies
--    where schemaname = 'storage' and tablename = 'objects' and policyname like 'punch_seals_%' order by policyname;
--     -- punch_seals_owner_insert INSERT, punch_seals_owner_select SELECT (no UPDATE, no DELETE)
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP … IF EXISTS. Apply BEFORE
-- deploying seal-punch, and both before the OTA that ships app/punch-seal.tsx.

-- ── 1. punch_items: the after photo and the seal pointer ───────────────────
alter table public.punch_items add column if not exists after_photo_uri text;
alter table public.punch_items add column if not exists after_photo_taken_at timestamptz;
alter table public.punch_items add column if not exists seal_id uuid;

comment on column public.punch_items.after_photo_uri is
  'project-photos storage path of the photo taken after the item was fixed (<uid>/<projectId>/punch-<id>-after.<ext>).';
comment on column public.punch_items.seal_id is
  'punch_seals.id once the item is in a sealed final punch. Set only by seal-punch (service role); a sealed row''s content is pinned by punch_items_seal_pin.';

-- ── 2. punch_seals ──────────────────────────────────────────────────────────
create table if not exists public.punch_seals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- One seal per project (founder Q2): callbacks are new items, not a new seal.
  project_id text not null unique,
  sealed_at timestamptz not null default now(),
  item_count int not null check (item_count > 0),
  manifest jsonb not null,
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  signer_name text not null check (length(btrim(signer_name)) >= 2),
  signer_role text not null,
  method text not null check (method = 'in_person'),
  signature_paths jsonb not null,
  consent_version text not null,
  pdf_path text,
  pdf_hash text check (pdf_hash is null or pdf_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists punch_seals_user_id_idx on public.punch_seals (user_id);

comment on table public.punch_seals is
  'Sealed final punch records. Written only by the seal-punch edge function; immutable except a one-time PDF attach (punch_seals_immutable).';

-- ── 3. RLS and grants: the owner reads his own; nobody writes from a client ─
alter table public.punch_seals enable row level security;

drop policy if exists punch_seals_owner_select on public.punch_seals;
create policy punch_seals_owner_select on public.punch_seals
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.punch_seals from public, anon, authenticated;
grant select on public.punch_seals to authenticated;
grant all on public.punch_seals to service_role;

-- ── 4. Immutable, bar one PDF attach ─────────────────────────────────────────
create or replace function public.punch_seals_immutable()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    -- delete-account (service role) erases the user's seals. pg_trigger_depth()
    -- > 1 is the ON DELETE CASCADE from auth.users, which runs inside the
    -- foreign key's own trigger: an auth user deletion must never be blocked.
    if current_user = 'service_role' or pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'punch_seals: a sealed record cannot be deleted' using errcode = '42501';
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.project_id is distinct from old.project_id
     or new.sealed_at is distinct from old.sealed_at
     or new.item_count is distinct from old.item_count
     or new.manifest is distinct from old.manifest
     or new.manifest_hash is distinct from old.manifest_hash
     or new.signer_name is distinct from old.signer_name
     or new.signer_role is distinct from old.signer_role
     or new.method is distinct from old.method
     or new.signature_paths is distinct from old.signature_paths
     or new.consent_version is distinct from old.consent_version then
    raise exception 'punch_seals: a sealed record cannot be changed' using errcode = '42501';
  end if;

  -- The one allowed change: the PDF path and its hash, NULL to a value,
  -- together, once.
  if old.pdf_path is null and old.pdf_hash is null
     and new.pdf_path is not null and new.pdf_hash is not null then
    return new;
  end if;
  raise exception 'punch_seals: the PDF copy is attached once, path and hash together' using errcode = '42501';
end;
$function$;

revoke execute on function public.punch_seals_immutable() from public, anon, authenticated;

drop trigger if exists punch_seals_immutable on public.punch_seals;
create trigger punch_seals_immutable
  before update or delete on public.punch_seals
  for each row
  execute function public.punch_seals_immutable();

-- ── 5. punch_items: a client never sets seal_id; a sealed row is pinned ─────
-- Separate from punch_items_guard (which it runs after: same-event BEFORE
-- triggers fire in name order, guard < seal_pin < updated_at). Pins, never
-- raises (see the header). DELETE of a sealed row by a client is skipped.
create or replace function public.punch_items_seal_pin()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    if old.seal_id is not null and current_user in ('authenticated', 'anon') then
      return null;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      new.seal_id := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if current_user in ('authenticated', 'anon') then
    new.seal_id := old.seal_id;
  end if;
  if old.seal_id is not null then
    new.seal_id := old.seal_id;
    new.description := old.description;
    new.location := old.location;
    new.status := old.status;
    new.closed_at := old.closed_at;
    new.list_type := old.list_type;
    new.after_photo_uri := old.after_photo_uri;
    new.after_photo_taken_at := old.after_photo_taken_at;
    new.photo_uri := old.photo_uri;
  end if;
  return new;
end;
$function$;

revoke execute on function public.punch_items_seal_pin() from public, anon, authenticated;

drop trigger if exists punch_items_seal_pin on public.punch_items;
create trigger punch_items_seal_pin
  before insert or update or delete on public.punch_items
  for each row
  execute function public.punch_items_seal_pin();

-- ── 6. Storage: punch-seals, private, owner folder, write-once ──────────────
insert into storage.buckets (id, name, public)
values ('punch-seals', 'punch-seals', false)
on conflict (id) do nothing;

drop policy if exists punch_seals_owner_select on storage.objects;
create policy punch_seals_owner_select on storage.objects
  as permissive for select to public
  using (
    bucket_id = 'punch-seals'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists punch_seals_owner_insert on storage.objects;
create policy punch_seals_owner_insert on storage.objects
  as permissive for insert to public
  with check (
    bucket_id = 'punch-seals'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );
-- Deliberately no UPDATE and no DELETE policy on bucket 'punch-seals'.
