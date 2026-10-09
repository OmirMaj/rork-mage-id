-- 20261009120000_proof_packs.sql — the fingerprint record of a Proof of Work Package
-- (Big Bets, Bet 3, Phase 1, lane PROOFPACK).
--
-- NOT APPLIED. Written and proven on PGlite only (the proof script is
-- pgq/proof-packs.mjs in the session scratchpad; it runs this file verbatim,
-- twice, and 12 planted mutations). Apply it the usual way (Supabase MCP
-- apply_migration, never `supabase db push`) after the lane's review.
--
-- WHAT THIS STORES. One row per package a contractor makes: the SHA-256 of the
-- package's canonical data, the short check code derived from it, how many
-- records it lists and how many the contractor left out, the SERVER's time, and
-- (once, later) the SHA-256 of the PDF file the phone made. Nothing else. The
-- package itself (client name, address, amounts, photos) is never uploaded: it
-- stays on the contractor's device and in the PDF they hand over.
--
-- WHY A NEW TABLE. The two sealing records the repo already has do not fit
-- without bending:
--   - "seal-document v1" (20260519180000) is a column on project_contracts and
--     an edge function that only accepts a contract id.
--   - punch_seals (20261002150000) is one row per project (project_id unique),
--     needs a signer and an in-person method, and is written by seal-punch.
-- This table copies punch_seals' shape for the parts that are the same: server
-- clock, 64-hex check, select-only for the owner, an immutability trigger that
-- raises, and one PDF hash that can be attached exactly once.
--
-- WHO WRITES. Nobody writes the table directly. Two SECURITY DEFINER functions:
--   proof_pack_create_v1      the PROJECT OWNER only (projects.user_id = auth.uid());
--                             the time is now(), the check code is derived here
--                             from the hash (never taken from the caller), and
--                             the same hash from the same account returns the
--                             row already on file instead of a second one.
--   proof_pack_attach_pdf_v1  the row's owner, once, while pdf_hash is null.
--
-- WHAT A FUTURE PUBLIC CHECK PAGE WOULD READ (designed, NOT built here): by
-- check code, exactly created_at, project_initial, city, content_hash and
-- pdf_hash. No amount, no name, no address, no project id. `project_initial`
-- and `city` exist only for that page and are capped at 1 and 80 characters.
--
-- Account deletion: user_id cascades from auth.users, so deleting the account
-- removes its fingerprint records (the trigger lets a cascade through).
-- project_id deliberately has NO foreign key: deleting a project must not
-- silently remove the record a reader may still ask about.

create table if not exists public.proof_packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  pay_kind text not null check (pay_kind in ('pay_app', 'invoice')),
  pay_id text not null check (length(pay_id) between 1 and 200),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  check_code text not null check (check_code ~ '^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$'),
  item_count int not null check (item_count >= 0),
  left_out_count int not null check (left_out_count >= 0),
  project_initial text not null default '' check (char_length(project_initial) <= 1),
  city text not null default '' check (char_length(city) <= 80),
  created_at timestamptz not null default now(),
  pdf_hash text check (pdf_hash is null or pdf_hash ~ '^[0-9a-f]{64}$'),
  pdf_attached_at timestamptz,
  constraint proof_packs_user_hash_key unique (user_id, content_hash),
  constraint proof_packs_pdf_pair check ((pdf_hash is null) = (pdf_attached_at is null))
);

create index if not exists proof_packs_user_project_idx on public.proof_packs (user_id, project_id);
create index if not exists proof_packs_check_code_idx on public.proof_packs (check_code);

comment on table public.proof_packs is
  'Fingerprint records of Proof of Work Packages. Written only by proof_pack_create_v1 / proof_pack_attach_pdf_v1; immutable except a one-time PDF hash attach (proof_packs_immutable). Holds no amount, name or address.';

alter table public.proof_packs enable row level security;

drop policy if exists proof_packs_owner_select on public.proof_packs;
create policy proof_packs_owner_select on public.proof_packs
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.proof_packs from public, anon, authenticated;
grant select on public.proof_packs to authenticated;
grant all on public.proof_packs to service_role;

-- ── The check code: the first 50 bits of the hash in Crockford base 32 ──────
-- The same rule as utils/proofPack/fingerprint.ts checkCodeOf, pinned equal on
-- probes by the PGlite proof and by scripts/validate-proof-pack.ts.
create or replace function public.proof_pack_check_code(p_hash text)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bits bigint;
  v_out text := '';
  i int;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  -- 13 hex characters are 52 bits; drop the last 2 to keep 50.
  v_bits := (('x' || lpad(substr(p_hash, 1, 13), 16, '0'))::bit(64)::bigint) >> 2;
  for i in 0..9 loop
    v_out := v_out || substr(v_alphabet, (((v_bits >> (45 - 5 * i)) & 31)::int) + 1, 1);
  end loop;
  return substr(v_out, 1, 5) || '-' || substr(v_out, 6, 5);
end;
$function$;

revoke execute on function public.proof_pack_check_code(text) from public, anon;
grant execute on function public.proof_pack_check_code(text) to authenticated, service_role;

-- ── Immutable, except one PDF hash attached once ────────────────────────────
create or replace function public.proof_packs_immutable()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    -- Account deletion (the auth.users cascade) and the service role only.
    if current_user = 'service_role' or pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'proof_packs: a fingerprint record cannot be deleted' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.project_id is distinct from old.project_id
     or new.pay_kind is distinct from old.pay_kind
     or new.pay_id is distinct from old.pay_id
     or new.content_hash is distinct from old.content_hash
     or new.check_code is distinct from old.check_code
     or new.item_count is distinct from old.item_count
     or new.left_out_count is distinct from old.left_out_count
     or new.project_initial is distinct from old.project_initial
     or new.city is distinct from old.city
     or new.created_at is distinct from old.created_at then
    raise exception 'proof_packs: a fingerprint record cannot be changed' using errcode = '42501';
  end if;
  if old.pdf_hash is null and old.pdf_attached_at is null
     and new.pdf_hash is not null and new.pdf_attached_at is not null then
    return new;
  end if;
  raise exception 'proof_packs: the file fingerprint is attached once' using errcode = '42501';
end;
$function$;

revoke execute on function public.proof_packs_immutable() from public, anon, authenticated;

drop trigger if exists proof_packs_immutable on public.proof_packs;
create trigger proof_packs_immutable
  before update or delete on public.proof_packs
  for each row
  execute function public.proof_packs_immutable();

-- ── Create: the project owner, the server's clock ───────────────────────────
create or replace function public.proof_pack_create_v1(
  p_project_id text,
  p_pay_kind text,
  p_pay_id text,
  p_content_hash text,
  p_item_count int,
  p_left_out_count int,
  p_project_initial text default '',
  p_city text default ''
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_me uuid := auth.uid();
  v_pid uuid;
  v_hash text := lower(coalesce(p_content_hash, ''));
  v_row public.proof_packs%rowtype;
begin
  if v_me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  begin
    v_pid := p_project_id::uuid;
  exception when others then
    raise exception 'bad_project' using errcode = '22023';
  end;
  if not exists (select 1 from public.projects p where p.id = v_pid and p.user_id = v_me) then
    -- One answer for "no such project" and "not yours": never an oracle.
    raise exception 'not_project_owner' using errcode = '42501';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'bad_hash' using errcode = '22023';
  end if;
  if p_pay_kind is null or p_pay_kind not in ('pay_app', 'invoice') then
    raise exception 'bad_pay_kind' using errcode = '22023';
  end if;
  if p_pay_id is null or length(p_pay_id) not between 1 and 200 then
    raise exception 'bad_pay_id' using errcode = '22023';
  end if;
  if p_item_count is null or p_item_count < 0 or p_left_out_count is null or p_left_out_count < 0 then
    raise exception 'bad_count' using errcode = '22023';
  end if;

  insert into public.proof_packs (
    user_id, project_id, pay_kind, pay_id, content_hash, check_code,
    item_count, left_out_count, project_initial, city, created_at
  ) values (
    v_me, v_pid, p_pay_kind, p_pay_id, v_hash, public.proof_pack_check_code(v_hash),
    p_item_count, p_left_out_count,
    upper(left(btrim(coalesce(p_project_initial, '')), 1)),
    left(btrim(coalesce(p_city, '')), 80),
    now()
  )
  on conflict on constraint proof_packs_user_hash_key do nothing;

  select * into v_row from public.proof_packs pp where pp.user_id = v_me and pp.content_hash = v_hash;
  return jsonb_build_object(
    'id', v_row.id,
    'content_hash', v_row.content_hash,
    'check_code', v_row.check_code,
    'created_at', v_row.created_at,
    'pdf_hash', v_row.pdf_hash
  );
end;
$function$;

revoke execute on function public.proof_pack_create_v1(text, text, text, text, int, int, text, text) from public, anon;
grant execute on function public.proof_pack_create_v1(text, text, text, text, int, int, text, text) to authenticated, service_role;

-- ── Attach the PDF file's fingerprint: the owner, once ──────────────────────
create or replace function public.proof_pack_attach_pdf_v1(p_id uuid, p_pdf_hash text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_me uuid := auth.uid();
  v_hash text := lower(coalesce(p_pdf_hash, ''));
  v_row public.proof_packs%rowtype;
begin
  if v_me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'bad_hash' using errcode = '22023';
  end if;
  update public.proof_packs pp
     set pdf_hash = v_hash, pdf_attached_at = now()
   where pp.id = p_id and pp.user_id = v_me and pp.pdf_hash is null;
  select * into v_row from public.proof_packs pp where pp.id = p_id and pp.user_id = v_me;
  if not found then
    raise exception 'not_found' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'pdf_hash', v_row.pdf_hash,
    'pdf_attached_at', v_row.pdf_attached_at,
    'attached_now', v_row.pdf_hash = v_hash
  );
end;
$function$;

revoke execute on function public.proof_pack_attach_pdf_v1(uuid, text) from public, anon;
grant execute on function public.proof_pack_attach_pdf_v1(uuid, text) to authenticated, service_role;
