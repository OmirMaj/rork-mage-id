-- 20261010110000_signed_record_tombstones.sql — proof that a signed record
-- existed, kept when the account that held it is deleted (lane PROTECT-SERVER;
-- build list item 6a).
--
-- WHY. supabase/functions/delete-account removes a contractor's whole account.
--   With it go records that somebody ELSE signed: the client's change order
--   approvals (deleted by name), and through foreign keys the subcontractor's
--   lien waivers, the homeowner's signed contract, the owner's rep's signed
--   field tickets, certified pay applications and sealed punch records. After
--   that nothing shows the record ever existed. A contractor in a dispute can
--   erase the other side's proof by deleting his account, and the other side
--   cannot even show that something was erased.
--
--   What to KEEP of those records is a legal policy choice and is not made
--   here (docs/legal/account-deletion-and-signed-records.md lays out the
--   options). This file changes nothing about what is deleted. It adds one
--   thing: before the deletion starts, one small row per signed record, so
--   that "a signed record existed and was deleted with the account on this
--   date" stays provable.
--
-- WHAT IS KEPT, SAID PLAINLY. A tombstone is pseudonymous data, not "no
--   personal data": it holds no name, email, signature, amount or address, but
--   it does hold a one-way hash of the signed row (content_sha256), the hash
--   the record itself carried, the record's own id, and a hash of the deleted
--   account's id (account_hash). None of these can be turned back into a
--   person, but someone who already holds the account id or a copy of the
--   signed row can recompute the hash and find these rows, so they are about
--   an identifiable person in the hands of anyone with that other record.
--   The Privacy Policy has to say they are kept
--   (docs/legal/privacy-policy-versus-code.md, row 2 and row 19).
--
-- WHAT A ROW MEANS. One signed record was about to be deleted with an account.
--     record_kind      co_approval | lien_waiver | project_contract |
--                      field_ticket | aia_pay_app | punch_seal
--     record_id        the record's own id (a uuid or an app-minted id).
--     counterparty_ref for a change order approval, the client portal's ID
--                      (never its access key). NULL for the rest: a lien
--                      waiver's signing link is keyed by the waiver id, which
--                      is record_id already.
--     signed_at        when the record says it was signed (its own column).
--     content_sha256   SHA-256 of the whole row as it stood, as JSON text, with
--                      the lien waiver's signing key left out. Anyone holding a
--                      copy of the row can recompute it; the row cannot be
--                      rebuilt from it.
--     stored_hash      the hash the record itself carried, where it had one
--                      (document_hash, manifest_hash). A signer's own copy of
--                      the signed document matches this.
--     account_hash     SHA-256 of 'mageid:legal_acceptance:v1:' || the deleted
--                      account's id: the same marker public.legal_acceptances
--                      keeps, so the two can be read together.
--     tombstoned_at    the server clock when this row was written, at the START
--                      of the deletion run. If the run stopped before it
--                      deleted anything, the record still exists; a tombstone
--                      proves deletion only together with the record's absence.
--   NOT IN A ROW: a name, an email, a signature image, an amount, a project
--   name, an address, a token. IN A ROW, and pseudonymous: the two hashes, the
--   record id, the portal id and the account hash (see WHAT IS KEPT above).
--
-- WHO WRITES. public.tombstone_signed_records(user id, project ids, portal
--   ids): SECURITY DEFINER, empty search_path, callable by the service role
--   only. delete-account calls it once, after it has read which projects and
--   portals the account owns and before its first write. One row per (kind,
--   record): a second run adds nothing. Each kind is read in its own block, so
--   a table that is not there (or a column that moved) costs that kind and is
--   named in the answer, never the rest.
-- WHO READS. The service role and the SQL editor. No client: row level
--   security is on with no policy, and anon and authenticated hold nothing.
-- NOTHING IS CHANGED OR REMOVED: a trigger refuses every UPDATE, and every
--   DELETE except from a direct database session. How long these are kept is
--   counsel's call; there is no retention job.
--
-- NOT COVERED, on purpose: change_order_approvals and lien_waivers themselves
--   are not touched (another lane owns their triggers and columns), and
--   proof_packs / proposal_approvals are not read (the first is another lane's,
--   the second is in a held migration).
--
-- DEPLOY ORDER. Apply this, THEN deploy delete-account. The reverse order is
--   safe: the function treats "tombstone_signed_records does not exist" as
--   "not yet", logs it, and deletes exactly as it does today. Apply through the
--   Supabase MCP apply_migration, never `supabase db push`.
--
-- VERIFY AFTER
--   select relrowsecurity from pg_class where oid = 'public.signed_record_tombstones'::regclass;      -- true
--   select count(*) from pg_policies where tablename = 'signed_record_tombstones';                     -- 0
--   select has_table_privilege('anon', 'public.signed_record_tombstones', 'select'),                   -- false
--          has_table_privilege('authenticated', 'public.signed_record_tombstones', 'select'),          -- false
--          has_table_privilege('service_role', 'public.signed_record_tombstones', 'select'),           -- true
--          has_table_privilege('service_role', 'public.signed_record_tombstones', 'insert');           -- false
--   select has_function_privilege('anon', 'public.tombstone_signed_records(uuid,text[],text[])', 'execute'),           -- false
--          has_function_privilege('authenticated', 'public.tombstone_signed_records(uuid,text[],text[])', 'execute'),  -- false
--          has_function_privilege('service_role', 'public.tombstone_signed_records(uuid,text[],text[])', 'execute');   -- true
--   -- a dry look at what an account would leave (writes nothing):
--   select count(*) from public.change_order_approvals a join public.projects p on p.id::text = a.project_id where p.user_id = '<uid>';
--
-- UNDO (by hand; deploy the previous delete-account first or its call fails quietly)
--   drop function if exists public.tombstone_signed_records(uuid, text[], text[]);
--   drop table if exists public.signed_record_tombstones;
--   drop function if exists public.signed_record_tombstones_keep();
--
-- PROOF. scripts/pgq/signed-record-tombstones.mjs.
--
-- Additive and idempotent.

-- ── 1. the table ─────────────────────────────────────────────────────────────
create table if not exists public.signed_record_tombstones (
  id               bigint generated always as identity primary key,
  record_kind      text not null,
  record_id        text not null,
  counterparty_ref text,
  signed_at        timestamptz,
  content_sha256   text not null,
  stored_hash      text,
  account_hash     text not null,
  reason           text not null default 'account_deleted',
  tombstoned_at    timestamptz not null default now(),
  constraint signed_record_tombstones_kind_check check (record_kind in ('co_approval', 'lien_waiver', 'project_contract', 'field_ticket', 'aia_pay_app', 'punch_seal')),
  constraint signed_record_tombstones_id_check check (length(record_id) between 1 and 200),
  constraint signed_record_tombstones_ref_check check (counterparty_ref is null or counterparty_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  constraint signed_record_tombstones_content_check check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint signed_record_tombstones_stored_check check (stored_hash is null or stored_hash ~ '^[0-9A-Fa-f]{16,128}$'),
  constraint signed_record_tombstones_account_check check (account_hash ~ '^[0-9a-f]{64}$'),
  constraint signed_record_tombstones_reason_check check (reason in ('account_deleted')),
  constraint signed_record_tombstones_once unique (record_kind, record_id)
);

comment on table public.signed_record_tombstones is
  'One row per signed record that was about to be deleted with an account: kind, id, times, a one-way hash of the signed row and a hash of the account id. No name, email, signature or amount. Pseudonymous: someone holding the account id or a copy of the row can recompute the hash and match it. Written by tombstone_signed_records() from delete-account. Service role reads; nobody changes or deletes.';

create index if not exists idx_signed_record_tombstones_account on public.signed_record_tombstones (account_hash);
create index if not exists idx_signed_record_tombstones_ref on public.signed_record_tombstones (counterparty_ref) where counterparty_ref is not null;

-- ── 2. nothing is changed or removed ─────────────────────────────────────────
create or replace function public.signed_record_tombstones_keep()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' and current_user in ('postgres', 'supabase_admin') then
    return old;
  end if;
  raise exception 'signed_record_tombstones: a tombstone is never changed or deleted' using errcode = '42501';
end
$function$;

revoke execute on function public.signed_record_tombstones_keep() from public, anon, authenticated;

drop trigger if exists signed_record_tombstones_keep on public.signed_record_tombstones;
create trigger signed_record_tombstones_keep
  before update or delete on public.signed_record_tombstones
  for each row execute function public.signed_record_tombstones_keep();

-- ── 3. locks: the service role reads; the function is the only writer ────────
alter table public.signed_record_tombstones enable row level security;
-- NO policies on purpose.
revoke all on public.signed_record_tombstones from public, anon, authenticated, service_role;
grant select on public.signed_record_tombstones to service_role;

-- ── 4. the one writer ────────────────────────────────────────────────────────
-- p_project_ids / p_portal_ids are the lists delete-account already resolved
-- and charset-checked (the account's own projects; portal ids that resolve only
-- to those projects). They arrive as bound array arguments, not as a spliced
-- filter. The function re-checks that every project it is handed belongs to
-- p_user_id, so a wrong list can never tombstone another account's records.
create or replace function public.tombstone_signed_records(
  p_user_id uuid,
  p_project_ids text[] default '{}',
  p_portal_ids text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account text;
  v_projects text[] := '{}';
  v_portals text[] := '{}';
  v_counts jsonb := '{}'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_n integer;
  v_total integer := 0;
begin
  if p_user_id is null then
    raise exception 'tombstone_signed_records: a user id is required' using errcode = '22023';
  end if;
  v_account := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('mageid:legal_acceptance:v1:' || p_user_id::text, 'UTF8')), 'hex');

  -- Only projects this account owns. An id that is not one of his is dropped.
  if pg_catalog.to_regclass('public.projects') is not null and coalesce(pg_catalog.array_length(p_project_ids, 1), 0) > 0 then
    select coalesce(pg_catalog.array_agg(p.id::text), '{}') into v_projects
      from public.projects p
     where p.user_id = p_user_id and p.id::text = any (p_project_ids);
  end if;
  -- Only portal ids that sit on one of those projects and on nobody else's.
  if pg_catalog.to_regclass('public.projects') is not null and coalesce(pg_catalog.array_length(p_portal_ids, 1), 0) > 0 then
    select coalesce(pg_catalog.array_agg(distinct x.pid), '{}') into v_portals
      from pg_catalog.unnest(p_portal_ids) as x(pid)
     where x.pid ~ '^[A-Za-z0-9._:-]{1,128}$'
       and exists (select 1 from public.projects p where p.client_portal->>'portalId' = x.pid and p.user_id = p_user_id)
       and not exists (select 1 from public.projects p where p.client_portal->>'portalId' = x.pid and p.user_id is distinct from p_user_id);
  end if;

  -- 4a. The client's change order approvals (delete-account deletes these by
  --     portal id and by project id; the table has no user column).
  begin
    if pg_catalog.to_regclass('public.change_order_approvals') is null then
      v_skipped := v_skipped || pg_catalog.to_jsonb('co_approval: no table'::text);
    else
      insert into public.signed_record_tombstones (record_kind, record_id, counterparty_ref, signed_at, content_sha256, stored_hash, account_hash)
      select 'co_approval', a.id::text,
             case when a.portal_id ~ '^[A-Za-z0-9._:-]{1,128}$' then a.portal_id end,
             coalesce(a.sealed_at, a.created_at),
             pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(a)::text, 'UTF8')), 'hex'),
             case when a.document_hash ~ '^[0-9A-Fa-f]{16,128}$' then a.document_hash end,
             v_account
        from public.change_order_approvals a
       where a.project_id = any (v_projects) or a.portal_id = any (v_portals)
      on conflict (record_kind, record_id) do nothing;
      get diagnostics v_n = row_count;
      v_counts := v_counts || pg_catalog.jsonb_build_object('co_approval', v_n); v_total := v_total + v_n;
    end if;
  exception when others then
    v_skipped := v_skipped || pg_catalog.to_jsonb(('co_approval: ' || sqlstate)::text);
  end;

  -- 4b. Signed lien waivers (cascade from the project and from the account).
  begin
    if pg_catalog.to_regclass('public.lien_waivers') is null then
      v_skipped := v_skipped || pg_catalog.to_jsonb('lien_waiver: no table'::text);
    else
      insert into public.signed_record_tombstones (record_kind, record_id, signed_at, content_sha256, account_hash)
      select 'lien_waiver', w.id::text, w.signed_at,
             pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((pg_catalog.to_jsonb(w) - 'sign_token')::text, 'UTF8')), 'hex'),
             v_account
        from public.lien_waivers w
       where (w.user_id = p_user_id or w.project_id::text = any (v_projects))
         and (w.signed_at is not null or w.sub_signature is not null)
      on conflict (record_kind, record_id) do nothing;
      get diagnostics v_n = row_count;
      v_counts := v_counts || pg_catalog.jsonb_build_object('lien_waiver', v_n); v_total := v_total + v_n;
    end if;
  exception when others then
    v_skipped := v_skipped || pg_catalog.to_jsonb(('lien_waiver: ' || sqlstate)::text);
  end;

  -- 4c. Contracts and proposals either side has signed.
  begin
    if pg_catalog.to_regclass('public.project_contracts') is null then
      v_skipped := v_skipped || pg_catalog.to_jsonb('project_contract: no table'::text);
    else
      insert into public.signed_record_tombstones (record_kind, record_id, signed_at, content_sha256, stored_hash, account_hash)
      select 'project_contract', c.id::text, c.signed_at,
             pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(c)::text, 'UTF8')), 'hex'),
             case when c.document_hash ~ '^[0-9A-Fa-f]{16,128}$' then c.document_hash end,
             v_account
        from public.project_contracts c
       where (c.user_id = p_user_id or c.project_id::text = any (v_projects))
         and (c.signed_at is not null or c.homeowner_signature is not null or c.gc_signature is not null)
      on conflict (record_kind, record_id) do nothing;
      get diagnostics v_n = row_count;
      v_counts := v_counts || pg_catalog.jsonb_build_object('project_contract', v_n); v_total := v_total + v_n;
    end if;
  exception when others then
    v_skipped := v_skipped || pg_catalog.to_jsonb(('project_contract: ' || sqlstate)::text);
  end;

  -- 4d. Field tickets the owner's rep authorized, on this account's OWN
  --     projects. Tickets he wrote on someone else's job are handed to that
  --     job's owner by delete-account, not deleted, so they get no tombstone.
  begin
    if pg_catalog.to_regclass('public.field_tickets') is null then
      v_skipped := v_skipped || pg_catalog.to_jsonb('field_ticket: no table'::text);
    else
      insert into public.signed_record_tombstones (record_kind, record_id, signed_at, content_sha256, account_hash)
      select 'field_ticket', t.id::text, t.updated_at,
             pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(t)::text, 'UTF8')), 'hex'),
             v_account
        from public.field_tickets t
       where t.user_id = p_user_id and t.project_id::text = any (v_projects)
         and t."authorization" is not null and pg_catalog.jsonb_typeof(t."authorization") = 'object'
         and pg_catalog.length(t.id::text) between 1 and 200
      on conflict (record_kind, record_id) do nothing;
      get diagnostics v_n = row_count;
      v_counts := v_counts || pg_catalog.jsonb_build_object('field_ticket', v_n); v_total := v_total + v_n;
    end if;
  exception when others then
    v_skipped := v_skipped || pg_catalog.to_jsonb(('field_ticket: ' || sqlstate)::text);
  end;

  -- 4e. Pay applications that carry a certification.
  begin
    if pg_catalog.to_regclass('public.aia_pay_apps') is null then
      v_skipped := v_skipped || pg_catalog.to_jsonb('aia_pay_app: no table'::text);
    else
      insert into public.signed_record_tombstones (record_kind, record_id, signed_at, content_sha256, account_hash)
      select 'aia_pay_app', a.id::text, a.certified_at,
             pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(a)::text, 'UTF8')), 'hex'),
             v_account
        from public.aia_pay_apps a
       where (a.user_id = p_user_id or a.project_id::text = any (v_projects))
         and a.certified_at is not null
      on conflict (record_kind, record_id) do nothing;
      get diagnostics v_n = row_count;
      v_counts := v_counts || pg_catalog.jsonb_build_object('aia_pay_app', v_n); v_total := v_total + v_n;
    end if;
  exception when others then
    v_skipped := v_skipped || pg_catalog.to_jsonb(('aia_pay_app: ' || sqlstate)::text);
  end;

  -- 4f. Sealed final punch records (signed in person on the contractor's phone).
  begin
    if pg_catalog.to_regclass('public.punch_seals') is null then
      v_skipped := v_skipped || pg_catalog.to_jsonb('punch_seal: no table'::text);
    else
      insert into public.signed_record_tombstones (record_kind, record_id, signed_at, content_sha256, stored_hash, account_hash)
      select 'punch_seal', s.id::text, s.sealed_at,
             pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(s)::text, 'UTF8')), 'hex'),
             case when s.manifest_hash ~ '^[0-9A-Fa-f]{16,128}$' then s.manifest_hash end,
             v_account
        from public.punch_seals s
       where s.user_id = p_user_id
      on conflict (record_kind, record_id) do nothing;
      get diagnostics v_n = row_count;
      v_counts := v_counts || pg_catalog.jsonb_build_object('punch_seal', v_n); v_total := v_total + v_n;
    end if;
  exception when others then
    v_skipped := v_skipped || pg_catalog.to_jsonb(('punch_seal: ' || sqlstate)::text);
  end;

  return pg_catalog.jsonb_build_object('ok', true, 'written', v_total, 'by_kind', v_counts, 'skipped', v_skipped);
end
$function$;

revoke all on function public.tombstone_signed_records(uuid, text[], text[]) from public, anon, authenticated;
grant execute on function public.tombstone_signed_records(uuid, text[], text[]) to service_role;

-- ── self-check ───────────────────────────────────────────────────────────────
do $$
declare
  v_role text;
  v_priv text;
  v_def boolean;
  v_cfg text[];
begin
  if not (select relrowsecurity from pg_class where oid = 'public.signed_record_tombstones'::regclass) then
    raise exception '[signed_record_tombstones] verify: row level security is off';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'signed_record_tombstones') then
    raise exception '[signed_record_tombstones] verify: the table has a policy; it must have none';
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      foreach v_priv in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
        if has_table_privilege(v_role, 'public.signed_record_tombstones', v_priv) then
          raise exception '[signed_record_tombstones] verify: % holds % on the table', v_role, v_priv;
        end if;
      end loop;
      if has_function_privilege(v_role, 'public.tombstone_signed_records(uuid,text[],text[])', 'execute') then
        raise exception '[signed_record_tombstones] verify: % can call the writer', v_role;
      end if;
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    if has_table_privilege('service_role', 'public.signed_record_tombstones', 'insert')
       or has_table_privilege('service_role', 'public.signed_record_tombstones', 'update')
       or has_table_privilege('service_role', 'public.signed_record_tombstones', 'delete') then
      raise exception '[signed_record_tombstones] verify: the service role must hold select only on the table';
    end if;
    if not has_function_privilege('service_role', 'public.tombstone_signed_records(uuid,text[],text[])', 'execute') then
      raise exception '[signed_record_tombstones] verify: the service role cannot call the writer';
    end if;
  end if;
  select p.prosecdef, p.proconfig into v_def, v_cfg from pg_proc p
   where p.oid = 'public.tombstone_signed_records(uuid,text[],text[])'::regprocedure;
  if v_def is not true or v_cfg is null or not ('search_path=""' = any (v_cfg)) then
    raise exception '[signed_record_tombstones] verify: the writer must be SECURITY DEFINER with an empty search_path';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.signed_record_tombstones'::regclass
                  and tgname = 'signed_record_tombstones_keep' and not tgisinternal and tgenabled <> 'D') then
    raise exception '[signed_record_tombstones] verify: the keep trigger is missing or disabled';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'signed_record_tombstones'
                and column_name in ('signer_name', 'signer_email', 'name', 'email', 'signature_data', 'user_id', 'amount', 'token', 'ip', 'user_agent')) then
    raise exception '[signed_record_tombstones] verify: the table has a column that names a person or holds content';
  end if;
end $$;

notify pgrst, 'reload schema';
