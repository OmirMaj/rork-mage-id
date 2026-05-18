-- H4a — Forgeable-portal-write hardening.
-- Before: anon could PATCH /rest/v1/project_contracts?id=eq.<uuid> with only
-- the public anon key (no portal token), and the contracts_client_sign policy
-- had an empty WITH CHECK — a leaked contract UUID = forgeable binding
-- signature + arbitrary column write. Same anti-pattern on selection_options.
-- After: two SECURITY DEFINER RPCs are the only client write path; they scope
-- by the project's portalId (+ passcode when required), verify the row belongs
-- to that portal's project, and write only server-constructed columns. The
-- permissive anon UPDATE policies are dropped (GC auth.uid()=user_id policies
-- and anon SELECT policies are unchanged). Reversible: re-create the dropped
-- policies from 20260518120000_rls_baseline.sql if ever needed.

create or replace function public.portal_sign_contract(
  p_portal_id   text,
  p_contract_id uuid,
  p_signer_name text,
  p_passcode    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_portal     jsonb;
  v_status     text;
begin
  if p_signer_name is null or length(btrim(p_signer_name)) < 3 then
    raise exception 'sign_denied';
  end if;

  select id, client_portal
    into v_project_id, v_portal
    from projects
   where client_portal->>'portalId' = p_portal_id
     and coalesce((client_portal->>'enabled')::boolean, false) = true
   limit 1;

  if v_project_id is null then
    raise exception 'sign_denied';
  end if;

  if coalesce((v_portal->>'requirePasscode')::boolean, false) = true
     and coalesce(v_portal->>'passcode', '') <> '' then
    if p_passcode is null or p_passcode <> (v_portal->>'passcode') then
      raise exception 'sign_denied';
    end if;
  end if;

  select status into v_status
    from project_contracts
   where id = p_contract_id and project_id = v_project_id
   limit 1;

  if v_status is null or v_status <> 'sent' then
    raise exception 'sign_denied';
  end if;

  update project_contracts
     set homeowner_signature = jsonb_build_object(
           'name', btrim(p_signer_name), 'role', 'homeowner', 'signedAt', now()),
         status    = 'signed',
         signed_at = now()
   where id = p_contract_id and project_id = v_project_id and status = 'sent';

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.portal_sign_contract(text,uuid,text,text) from public;
grant execute on function public.portal_sign_contract(text,uuid,text,text) to anon, authenticated;

create or replace function public.portal_choose_selection(
  p_portal_id   text,
  p_category_id uuid,
  p_option_id   uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select id into v_project_id
    from projects
   where client_portal->>'portalId' = p_portal_id
     and coalesce((client_portal->>'enabled')::boolean, false) = true
   limit 1;

  if v_project_id is null then
    raise exception 'selection_denied';
  end if;

  if not exists (
    select 1 from selection_categories c
     where c.id = p_category_id and c.project_id = v_project_id
  ) then
    raise exception 'selection_denied';
  end if;

  if not exists (
    select 1 from selection_options
     where id = p_option_id and category_id = p_category_id
  ) then
    raise exception 'selection_denied';
  end if;

  update selection_options
     set is_chosen = false, chosen_at = null, chosen_by_role = null
   where category_id = p_category_id;

  update selection_options
     set is_chosen = true, chosen_at = now(), chosen_by_role = 'homeowner'
   where id = p_option_id and category_id = p_category_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.portal_choose_selection(text,uuid,uuid) from public;
grant execute on function public.portal_choose_selection(text,uuid,uuid) to anon, authenticated;

-- Remove the forgeable anon write paths. The RPCs above are now the only
-- client write route into these tables.
drop policy if exists "contracts_client_sign" on public.project_contracts;
drop policy if exists "selopt_client_choose"  on public.selection_options;
