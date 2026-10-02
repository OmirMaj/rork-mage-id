-- 20261001150000_portal_message_attachments.sql — photos and PDFs in the
-- portal thread, both directions (track MSG, lane MSGDATA).
--
-- WHY
--   The contractor and the homeowner talk in the portal thread
--   (portal_messages) but cannot send each other a photo of the crack or the
--   signed PDF. Files must arrive WITH their message or not at all, and the
--   server must refuse any message whose files it cannot prove were uploaded:
--   "sent" may never mean "files still on the phone".
--
-- WHAT
--   a) a PRIVATE bucket `message-attachments`: 20 MB per file, JPEG / PNG /
--      WebP / PDF only (Storage enforces both on every upload path);
--   b) storage policies: SELECT and INSERT for the PROJECT OWNER only, keys
--      `<projectId>/<messageId>/<attachmentId>.<ext>`. No UPDATE, no DELETE,
--      no anon. The homeowner never touches Storage: the edge function
--      portal-message-files mints one signed upload URL per exact key and
--      signs her reads;
--   c) a guard that refuses to finish if any public/anon policy reaches this
--      bucket or the bucket reads public;
--   d) portal_messages.attachments jsonb, '[]' when none (one row, so the
--      message and its files appear together or not at all, and the existing
--      write path, offline queue, realtime echo, portal RPC and notify
--      trigger carry it unchanged);
--   e/f) a BEFORE INSERT OR UPDATE trigger that checks every named file
--      against storage.objects (exists, same size, same type, path exactly
--      <row project>/<row id>/<file id>.<ext>) and makes attachments
--      immutable once written;
--   g) least privilege on portal_messages: authenticated keeps SELECT and
--      INSERT, UPDATE only on read_by_gc, no DELETE; anon holds nothing;
--   h) portal_get_messages returns attachments WITHOUT the storage key;
--   i) the notify trigger carries attachment_count and attachment_kinds, so
--      the email says "2 photos attached" instead of quoting an empty body.
--
-- ORDER
--   Apply this BEFORE deploying portal-message-files, BEFORE redeploying
--   notify, BEFORE the MSGAPP OTA and the MSGPORTAL Netlify deploy. A text-only
--   message keeps working either side of it (the app omits `attachments` when
--   there are none).
--
-- ORPHANS
--   An object uploaded for a message that was never sent stays in the bucket
--   (no DELETE policy, by design). A later cron may sweep objects under a
--   message id that has no row after 7 days; not built here. delete-account
--   removes the whole project folder (PROJECT_KEYED_BUCKETS).
--
-- Idempotent: runs twice clean.
--
-- VERIFY AFTER
--   select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'message-attachments';
--   select policyname, roles, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects'
--     and (qual like '%message-attachments%' or with_check like '%message-attachments%');
--   select has_table_privilege('authenticated', 'public.portal_messages', 'UPDATE'),          -- false
--          has_column_privilege('authenticated', 'public.portal_messages', 'read_by_gc', 'UPDATE'), -- true
--          has_table_privilege('anon', 'public.portal_messages', 'SELECT');                  -- false
--   select tgname from pg_trigger where tgrelid = 'public.portal_messages'::regclass and not tgisinternal order by tgname;

-- ── a) the bucket ────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-attachments', 'message-attachments', false, 20971520,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── b) storage policies: the project owner only ──────────────────────────────
-- `objects.name`, QUALIFIED, everywhere: inside the EXISTS on projects a bare
-- `name` binds to projects.name ('Kitchen remodel'), not the object key, and
-- the owner clause silently never matches (20260904100400 note).
drop policy if exists message_attachments_owner_select on storage.objects;
create policy message_attachments_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and exists (
      select 1 from public.projects p
       where p.id::text = (storage.foldername(objects.name))[1]
         and p.user_id = auth.uid()
    )
  );

drop policy if exists message_attachments_owner_insert on storage.objects;
create policy message_attachments_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and array_length(storage.foldername(objects.name), 1) = 2
    and (storage.foldername(objects.name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.projects p
       where p.id::text = (storage.foldername(objects.name))[1]
         and p.user_id = auth.uid()
    )
  );

-- ── c) guard: nothing public reaches this bucket ─────────────────────────────
-- A policy created by hand in the dashboard for role public/anon would survive
-- every drop above (20260923181000's lesson), and the bucket would read private
-- while anonymous reads kept working. Enumerate, and refuse to finish.
do $$
declare
  v_open   int;
  v_names  text;
  v_public boolean;
begin
  select count(*), string_agg(policyname, ', ')
    into v_open, v_names
    from pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and permissive = 'PERMISSIVE'
     and (coalesce(qual, '') like '%message-attachments%' or coalesce(with_check, '') like '%message-attachments%')
     and (roles && array['public', 'anon']::name[]);
  if v_open > 0 then
    raise exception '[msgdata] % storage polic(y/ies) on message-attachments grant public/anon: % — drop them, then re-run', v_open, v_names;
  end if;
  select b.public into v_public from storage.buckets b where b.id = 'message-attachments';
  if v_public is distinct from false then
    raise exception '[msgdata] bucket message-attachments is not private (public = %)', v_public;
  end if;
end $$;

-- ── d) the column ────────────────────────────────────────────────────────────
alter table public.portal_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column public.portal_messages.attachments is
  'Photos/PDFs on this message ([{id,name,mime,size,kind,width?,height?,path}]), written only once the bytes are in the message-attachments bucket and checked by trg_validate_portal_msg_attachments.';

-- ── e) the check ─────────────────────────────────────────────────────────────
-- Every refusal raises the bare code (errcode 22023; immutability 42501) so
-- callers can map it; no user text is echoed. SECURITY DEFINER so it can read
-- storage.objects whoever inserts (the owner under RLS, the portal RPCs, the
-- edge function's service role); search_path '' with everything qualified.
create or replace function public.portal_message_attachments_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_len      int;
  v_el       jsonb;
  v_id       text;
  v_ids      text[] := array[]::text[];
  v_mime     text;
  v_ext      text;
  v_name     text;
  v_size     numeric;
  v_dim      text;
  v_dimval   numeric;
  v_path     text;
  v_obj_size bigint;
  v_obj_mime text;
  v_paths    text[] := array[]::text[];
  v_sizes    bigint[] := array[]::bigint[];
  v_mimes    text[] := array[]::text[];
  i          int;
begin
  if tg_op = 'UPDATE' then
    if new.attachments is distinct from old.attachments then
      raise exception 'attachments_immutable' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.attachments is null then
    new.attachments := '[]'::jsonb;
  end if;
  if pg_catalog.jsonb_typeof(new.attachments) <> 'array' then
    raise exception 'attachment_bad_key' using errcode = '22023';
  end if;
  v_len := pg_catalog.jsonb_array_length(new.attachments);
  if v_len > 10 then
    raise exception 'attachment_too_many' using errcode = '22023';
  end if;

  if v_len = 0 then
    if coalesce(new.body, '') !~ '[^[:space:]]' then
      raise exception 'message_empty' using errcode = '22023';
    end if;
    return new;
  end if;

  if new.project_id is null or pg_catalog.btrim(new.project_id) = '' then
    raise exception 'attachment_no_project' using errcode = '22023';
  end if;

  for v_el in select e from pg_catalog.jsonb_array_elements(new.attachments) as t(e) loop
    -- keys
    if pg_catalog.jsonb_typeof(v_el) <> 'object' or exists (
      select 1 from pg_catalog.jsonb_object_keys(v_el) as k(key)
       where k.key not in ('id', 'name', 'mime', 'size', 'kind', 'width', 'height', 'path')
    ) then
      raise exception 'attachment_bad_key' using errcode = '22023';
    end if;

    -- id: a lower-case uuid, unique within the row
    if pg_catalog.jsonb_typeof(v_el -> 'id') is distinct from 'string' then
      raise exception 'attachment_bad_id' using errcode = '22023';
    end if;
    v_id := v_el ->> 'id';
    if v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or v_id = any (v_ids) then
      raise exception 'attachment_bad_id' using errcode = '22023';
    end if;
    v_ids := v_ids || v_id;

    -- mime: the four the bucket accepts
    v_mime := case when pg_catalog.jsonb_typeof(v_el -> 'mime') = 'string' then v_el ->> 'mime' end;
    v_ext := case v_mime
               when 'image/jpeg' then 'jpg'
               when 'image/png' then 'png'
               when 'image/webp' then 'webp'
               when 'application/pdf' then 'pdf'
             end;
    if v_ext is null then
      raise exception 'attachment_bad_type' using errcode = '22023';
    end if;

    -- kind agrees with mime
    if pg_catalog.jsonb_typeof(v_el -> 'kind') is distinct from 'string'
       or (v_el ->> 'kind') <> (case when v_mime = 'application/pdf' then 'pdf' else 'image' end) then
      raise exception 'attachment_bad_kind' using errcode = '22023';
    end if;

    -- name: 1..200 characters, no slash, no backslash, no control character
    if pg_catalog.jsonb_typeof(v_el -> 'name') is distinct from 'string' then
      raise exception 'attachment_bad_name' using errcode = '22023';
    end if;
    v_name := v_el ->> 'name';
    if pg_catalog.char_length(v_name) < 1 or pg_catalog.char_length(v_name) > 200
       or pg_catalog.strpos(v_name, '/') > 0
       or pg_catalog.strpos(v_name, pg_catalog.chr(92)) > 0
       or v_name ~ '[[:cntrl:]]' then
      raise exception 'attachment_bad_name' using errcode = '22023';
    end if;

    -- size: an integer json number, 1..20971520
    if pg_catalog.jsonb_typeof(v_el -> 'size') is distinct from 'number' then
      raise exception 'attachment_bad_size' using errcode = '22023';
    end if;
    v_size := (v_el ->> 'size')::numeric;
    if v_size <> pg_catalog.trunc(v_size) or v_size < 1 or v_size > 20971520 then
      raise exception 'attachment_bad_size' using errcode = '22023';
    end if;

    -- width / height: absent, null, or integers 1..20000
    foreach v_dim in array array['width', 'height'] loop
      if pg_catalog.jsonb_typeof(v_el -> v_dim) is not null and pg_catalog.jsonb_typeof(v_el -> v_dim) <> 'null' then
        if pg_catalog.jsonb_typeof(v_el -> v_dim) <> 'number' then
          raise exception 'attachment_bad_size' using errcode = '22023';
        end if;
        v_dimval := (v_el ->> v_dim)::numeric;
        if v_dimval <> pg_catalog.trunc(v_dimval) or v_dimval < 1 or v_dimval > 20000 then
          raise exception 'attachment_bad_size' using errcode = '22023';
        end if;
      end if;
    end loop;

    -- path: exactly this row's project and id
    v_path := new.project_id || '/' || new.id::text || '/' || v_id || '.' || v_ext;
    if pg_catalog.jsonb_typeof(v_el -> 'path') is distinct from 'string' or (v_el ->> 'path') <> v_path then
      raise exception 'attachment_bad_path' using errcode = '22023';
    end if;
    v_paths := v_paths || v_path;
    v_sizes := v_sizes || v_size::bigint;
    v_mimes := v_mimes || v_mime;
  end loop;

  -- Every element is well formed; now the bytes: each file is in the bucket
  -- under exactly its path, with the same size and type.
  for i in 1 .. pg_catalog.array_length(v_paths, 1) loop
    select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
      into v_obj_size, v_obj_mime
      from storage.objects o
     where o.bucket_id = 'message-attachments'
       and o.name = v_paths[i]
     limit 1;
    if not found then
      raise exception 'attachment_not_uploaded' using errcode = '22023';
    end if;
    if v_obj_size is distinct from v_sizes[i] then
      raise exception 'attachment_size_mismatch' using errcode = '22023';
    end if;
    if v_obj_mime is distinct from v_mimes[i] then
      raise exception 'attachment_type_mismatch' using errcode = '22023';
    end if;
  end loop;

  return new;
end;
$fn$;

revoke execute on function public.portal_message_attachments_check() from public, anon, authenticated;

-- ── f) the trigger ───────────────────────────────────────────────────────────
-- BEFORE triggers fire in name order: trg_validate_… sorts after
-- trg_resolve_portal_msg_project ('v' > 'r'), so a client row posted by the
-- portal RPC has its project_id filled before the paths are checked. Column
-- defaults (new.id) are applied before any BEFORE trigger runs.
drop trigger if exists trg_validate_portal_msg_attachments on public.portal_messages;
create trigger trg_validate_portal_msg_attachments
  before insert or update on public.portal_messages
  for each row execute function public.portal_message_attachments_check();

-- ── g) least privilege on portal_messages ────────────────────────────────────
-- The only app UPDATE is the read receipt (hooks/usePortalThread.ts:
-- .update({ read_by_gc: true })); no app DELETE exists. portal_mark_messages_read
-- and notify run as owner / service role and are unaffected.
revoke update on public.portal_messages from authenticated;
grant  update (read_by_gc) on public.portal_messages to authenticated;
revoke delete on public.portal_messages from authenticated;
revoke all    on public.portal_messages from anon;
revoke truncate, trigger, references on public.portal_messages from anon, authenticated;
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on public.portal_messages from anon, authenticated';
  end if;
end $$;
grant select, insert on public.portal_messages to authenticated;   -- unchanged, stated
grant all on public.portal_messages to service_role;               -- unchanged, stated

do $$
begin
  raise notice '[msgdata] authenticated on portal_messages: select=% insert=% update(table)=% update(read_by_gc)=% update(body)=% delete=% | anon select=% insert=%',
    has_table_privilege('authenticated', 'public.portal_messages', 'SELECT'),
    has_table_privilege('authenticated', 'public.portal_messages', 'INSERT'),
    has_table_privilege('authenticated', 'public.portal_messages', 'UPDATE'),
    has_column_privilege('authenticated', 'public.portal_messages', 'read_by_gc', 'UPDATE'),
    has_column_privilege('authenticated', 'public.portal_messages', 'body', 'UPDATE'),
    has_table_privilege('authenticated', 'public.portal_messages', 'DELETE'),
    has_table_privilege('anon', 'public.portal_messages', 'SELECT'),
    has_table_privilege('anon', 'public.portal_messages', 'INSERT');
end $$;

-- ── h) the homeowner's read: attachments without the storage key ─────────────
-- Same signature, same gate (portal_project_for_token), same 'portal_denied'.
-- The page asks portal-message-files to sign by (messageId, attachmentId).
create or replace function public.portal_get_messages(p_portal_id text, p_access_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_pid uuid;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'portal_id', m.portal_id, 'author_type', m.author_type,
      'author_name', m.author_name, 'body', m.body, 'created_at', m.created_at,
      'attachments', (select coalesce(jsonb_agg(e - 'path'), '[]'::jsonb)
                        from jsonb_array_elements(m.attachments) e))
      order by m.created_at asc)
    from public.portal_messages m where m.portal_id = p_portal_id), '[]'::jsonb);
end; $$;

revoke execute on function public.portal_get_messages(text, text) from public;
grant execute on function public.portal_get_messages(text, text) to anon, authenticated, service_role;

-- ── i) notify carries the attachment summary ─────────────────────────────────
-- VERBATIM from 20260918140000_portal_reply_and_website_lead_notify.sql (both
-- branches, the nested projects check, search_path ''), plus attachment_count
-- and attachment_kinds in BOTH payloads. The trigger wiring
-- (notify_portal_message AFTER INSERT) is unchanged; only the body is replaced.
create or replace function public.trg_notify_portal_message()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if NEW.author_type = 'client' then
    perform public.fire_notify(
      'portal_message',
      'portal_messages',
      NEW.id::text,
      jsonb_build_object(
        'portal_id', NEW.portal_id,
        'project_id', NEW.project_id,
        'invite_id', NEW.invite_id,
        'author_type', NEW.author_type,
        'author_name', NEW.author_name,
        'body', NEW.body,
        'attachment_count', pg_catalog.jsonb_array_length(coalesce(NEW.attachments, '[]'::jsonb)),
        'attachment_kinds', (select coalesce(pg_catalog.jsonb_agg(e ->> 'kind'), '[]'::jsonb)
                               from pg_catalog.jsonb_array_elements(coalesce(NEW.attachments, '[]'::jsonb)) e)
      )
    );
  elsif NEW.author_type = 'gc'
        and nullif(btrim(coalesce(NEW.author_name, '')), '') is not null then
    -- Nested, not folded into the elsif: this function runs as the INVOKER,
    -- and the portal RPCs that write client rows run as roles without SELECT
    -- on projects; a projects reference in the shared condition would be
    -- permission-checked for them too. Only gc rows (the owner under RLS, or
    -- service_role) reach this read.
    if not exists (
      select 1 from public.projects p
      where p.id::text = NEW.project_id
        and p.client_portal ->> 'portalId' = NEW.portal_id
    ) then
      return NEW;
    end if;
    perform public.fire_notify(
      'portal_reply',
      'portal_messages',
      NEW.id::text,
      jsonb_build_object(
        'portal_id', NEW.portal_id,
        'project_id', NEW.project_id,
        'author_type', NEW.author_type,
        'author_name', NEW.author_name,
        'body', NEW.body,
        'attachment_count', pg_catalog.jsonb_array_length(coalesce(NEW.attachments, '[]'::jsonb)),
        'attachment_kinds', (select coalesce(pg_catalog.jsonb_agg(e ->> 'kind'), '[]'::jsonb)
                               from pg_catalog.jsonb_array_elements(coalesce(NEW.attachments, '[]'::jsonb)) e)
      )
    );
  end if;
  return NEW;
end;
$function$;

-- ── j) verify ────────────────────────────────────────────────────────────────
do $$
declare
  v_bucket record;
  v_pol    int;
  v_trg    text[];
begin
  select public, file_size_limit, allowed_mime_types into v_bucket
    from storage.buckets where id = 'message-attachments';
  if v_bucket is null or v_bucket.public is distinct from false or v_bucket.file_size_limit is distinct from 20971520
     or not (v_bucket.allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
             and v_bucket.allowed_mime_types <@ array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) then
    raise exception '[msgdata] verify: bucket message-attachments is not private with the 20 MB / 4-type limits';
  end if;

  select count(*) into v_pol from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('message_attachments_owner_select', 'message_attachments_owner_insert');
  if v_pol <> 2 then
    raise exception '[msgdata] verify: expected both owner storage policies, found %', v_pol;
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and permissive = 'PERMISSIVE'
       and (coalesce(qual, '') like '%message-attachments%' or coalesce(with_check, '') like '%message-attachments%')
       and (roles && array['public', 'anon']::name[])
  ) then
    raise exception '[msgdata] verify: a public/anon policy reaches message-attachments';
  end if;

  select array_agg(tgname::text order by tgname) into v_trg
    from pg_trigger
   where tgrelid = 'public.portal_messages'::regclass and not tgisinternal
     and tgname in ('trg_resolve_portal_msg_project', 'trg_validate_portal_msg_attachments');
  if v_trg is null or not ('trg_validate_portal_msg_attachments' = any (v_trg)) then
    raise exception '[msgdata] verify: trg_validate_portal_msg_attachments is missing';
  end if;
  if 'trg_resolve_portal_msg_project' = any (v_trg) and v_trg[1] <> 'trg_resolve_portal_msg_project' then
    raise exception '[msgdata] verify: the attachment check would fire before the project resolver';
  end if;

  if has_table_privilege('authenticated', 'public.portal_messages', 'UPDATE') then
    raise exception '[msgdata] verify: authenticated still holds table-wide UPDATE on portal_messages';
  end if;
  if not has_column_privilege('authenticated', 'public.portal_messages', 'read_by_gc', 'UPDATE') then
    raise exception '[msgdata] verify: authenticated lost UPDATE (read_by_gc) — read receipts would break';
  end if;

  raise notice '[msgdata] verified: bucket private 20 MB / 4 types, 2 owner policies, no public/anon policy, triggers %, authenticated UPDATE only on read_by_gc', v_trg;
end $$;
