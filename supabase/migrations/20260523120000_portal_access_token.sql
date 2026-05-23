-- H4b — accessToken gate on client BINDING decisions (sign contract, choose
-- selection). Follows H4a (20260518120100), which scoped these to portalId +
-- enabled; but portalId is low-entropy (portal-<8hex>-<base36 timestamp>), so
-- knowing it sufficed to act. After: each binding decision requires a 192-bit
-- accessToken stored in projects.client_portal.accessToken and supplied via the
-- share-link ?t= param. Reads (snapshot fetch, messages) are intentionally
-- unchanged. Successful decisions are audited (failures use raise, which would
-- roll back an audit row, so only successes are logged).
--
-- Deferred (separate fast-follow): token-gating the non-binding budget proposal
-- (still on the H4a-era anon insert + is_published_portal gate), and a
-- high-entropy portalId for new portals (reads are intentionally open here).
--
-- Reversible:
--   drop trigger trg_portal_access_token on public.projects;
--   drop function public.portal_set_access_token();
--   drop table public.portal_decision_audit;
--   then restore the prior portal_sign_contract(text,uuid,text,text) and
--   portal_choose_selection(text,uuid,uuid) bodies from 20260518120100.
--   (Backfilled accessToken values in client_portal are harmless if left.)

-- 1) Backfill accessToken for existing portals that lack one.
update public.projects
   set client_portal = client_portal || jsonb_build_object('accessToken', encode(gen_random_bytes(24),'hex'))
 where client_portal ? 'portalId'
   and coalesce(client_portal->>'accessToken','') = '';

-- 2) Sticky trigger — ensure/preserve a token on every portal write. Guard OLD
--    access with TG_OP (OLD is NULL on INSERT). The token is generated once and
--    preserved across app writes that overwrite client_portal wholesale.
create or replace function public.portal_set_access_token()
returns trigger language plpgsql as $$
begin
  if new.client_portal is not null
     and new.client_portal ? 'portalId'
     and coalesce(new.client_portal->>'accessToken','') = '' then
    new.client_portal := new.client_portal || jsonb_build_object(
      'accessToken',
      coalesce(
        case when tg_op = 'UPDATE' then nullif(old.client_portal->>'accessToken','') else null end,
        encode(gen_random_bytes(24),'hex')));
  end if;
  return new;
end; $$;

drop trigger if exists trg_portal_access_token on public.projects;
create trigger trg_portal_access_token
  before insert or update on public.projects
  for each row execute function public.portal_set_access_token();

-- 3) Audit of successful decisions (forensics: who signed/chose, when).
create table if not exists public.portal_decision_audit (
  id uuid primary key default gen_random_uuid(),
  portal_id text not null,
  project_id uuid,
  action text not null,            -- 'sign' | 'selection'
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_portal_audit_portal_time
  on public.portal_decision_audit (portal_id, created_at desc);
alter table public.portal_decision_audit enable row level security;
drop policy if exists "gc reads own portal audit" on public.portal_decision_audit;
create policy "gc reads own portal audit" on public.portal_decision_audit
  for select to authenticated
  using (project_id is not null and exists (
    select 1 from public.projects p
     where p.id = portal_decision_audit.project_id and p.user_id = auth.uid()));
-- No anon/insert policy: rows are written only by the SECURITY DEFINER RPCs below
-- (which bypass RLS). No anon read.

-- 4) portal_sign_contract — token-required (drop old 4-arg first so no un-gated
--    overload remains). Keeps all H4a checks; audits on success.
drop function if exists public.portal_sign_contract(text,uuid,text,text);
create or replace function public.portal_sign_contract(
  p_portal_id text, p_contract_id uuid, p_signer_name text,
  p_passcode text default null, p_access_token text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_project_id uuid; v_portal jsonb; v_status text;
begin
  select id, client_portal into v_project_id, v_portal from public.projects
   where client_portal->>'portalId' = p_portal_id
     and coalesce((client_portal->>'enabled')::boolean,false) = true
   limit 1;

  -- access-token gate (the new boundary; signing token-required immediately)
  if v_project_id is null
     or p_access_token is null
     or coalesce(v_portal->>'accessToken','') = ''
     or p_access_token <> (v_portal->>'accessToken') then
    raise exception 'sign_denied';
  end if;

  if p_signer_name is null or length(btrim(p_signer_name)) < 3 then
    raise exception 'sign_denied';
  end if;

  -- optional passcode second factor (unchanged H4a semantics)
  if p_passcode is not null
     and coalesce(v_portal->>'passcode','') <> ''
     and p_passcode <> (v_portal->>'passcode') then
    raise exception 'sign_denied';
  end if;

  select status into v_status from public.project_contracts
   where id = p_contract_id and project_id = v_project_id limit 1;
  if v_status is null or v_status <> 'sent' then
    raise exception 'sign_denied';
  end if;

  update public.project_contracts
     set homeowner_signature = jsonb_build_object('name', btrim(p_signer_name), 'role','homeowner','signedAt', now()),
         status = 'signed', signed_at = now()
   where id = p_contract_id and project_id = v_project_id and status = 'sent';

  insert into public.portal_decision_audit(portal_id, project_id, action, detail)
    values (p_portal_id, v_project_id, 'sign',
            jsonb_build_object('contract', p_contract_id, 'signer', btrim(p_signer_name)));
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.portal_sign_contract(text,uuid,text,text,text) from public;
grant execute on function public.portal_sign_contract(text,uuid,text,text,text) to anon, authenticated;

-- 5) portal_choose_selection — token-required (drop old 3-arg first).
drop function if exists public.portal_choose_selection(text,uuid,uuid);
create or replace function public.portal_choose_selection(
  p_portal_id text, p_category_id uuid, p_option_id uuid, p_access_token text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_project_id uuid; v_portal jsonb;
begin
  select id, client_portal into v_project_id, v_portal from public.projects
   where client_portal->>'portalId' = p_portal_id
     and coalesce((client_portal->>'enabled')::boolean,false) = true
   limit 1;

  if v_project_id is null
     or p_access_token is null
     or coalesce(v_portal->>'accessToken','') = ''
     or p_access_token <> (v_portal->>'accessToken') then
    raise exception 'selection_denied';
  end if;

  if not exists (select 1 from public.selection_categories c
                  where c.id = p_category_id and c.project_id = v_project_id) then
    raise exception 'selection_denied';
  end if;
  if not exists (select 1 from public.selection_options
                  where id = p_option_id and category_id = p_category_id) then
    raise exception 'selection_denied';
  end if;

  update public.selection_options
     set is_chosen = false, chosen_at = null, chosen_by_role = null
   where category_id = p_category_id;
  update public.selection_options
     set is_chosen = true, chosen_at = now(), chosen_by_role = 'homeowner'
   where id = p_option_id and category_id = p_category_id;

  insert into public.portal_decision_audit(portal_id, project_id, action, detail)
    values (p_portal_id, v_project_id, 'selection',
            jsonb_build_object('category', p_category_id, 'option', p_option_id));
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.portal_choose_selection(text,uuid,uuid,text) from public;
grant execute on function public.portal_choose_selection(text,uuid,uuid,text) to anon, authenticated;
