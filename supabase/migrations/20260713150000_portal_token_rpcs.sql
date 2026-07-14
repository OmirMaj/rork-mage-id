-- 20260713150000_portal_token_rpcs.sql  (PART 1 of 2 — ADDITIVE, safe to apply now)
--
-- Token-gated SECURITY DEFINER RPCs for the client + sub portals, from the
-- 2026-07-13 audit. ROOT CAUSE: portal reads/writes trusted the guessable
-- portalId, not the 192-bit client_portal.accessToken, so anon could dump every
-- tenant's snapshot (a LIVE leak) and forge homeowner CO approvals / messages /
-- budget proposals and fake sub invoices.
--
-- This PART 1 is purely ADDITIVE (new functions, a new nullable-by-default column,
-- new grants) — it changes NO existing behavior, so it is safe to apply and test
-- ahead of the coordinated portal deploy. PART 2
-- (20260713150001_portal_lock_direct_access.sql) drops the old anon table access
-- and MUST be applied in the SAME WINDOW as the portal/sub-portal HTML redeploy,
-- because the HTML switches to these RPCs at the same time.
--
-- Token check mirrors the existing portal_sign_contract / portal_choose_selection
-- pattern exactly (accessToken = client_portal->>'accessToken', portal enabled).

-- Internal validator — called only by the SECURITY DEFINER RPCs below (which run
-- as the owner), so it needs no anon grant.
create or replace function public.portal_project_for_token(p_portal_id text, p_access_token text)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select id from public.projects
   where client_portal->>'portalId' = p_portal_id
     and coalesce((client_portal->>'enabled')::boolean, false) = true
     and coalesce(client_portal->>'accessToken','') <> ''
     and client_portal->>'accessToken' = p_access_token
   limit 1;
$$;
revoke execute on function public.portal_project_for_token(text, text) from anon, authenticated, public;

-- ── Client portal — token-gated READS ────────────────────────────────────────
create or replace function public.portal_get_snapshot(p_portal_id text, p_access_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_pid uuid;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  return (select snapshot from public.portal_snapshots where portal_id = p_portal_id limit 1);
end; $$;

create or replace function public.portal_get_messages(p_portal_id text, p_access_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_pid uuid;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'portal_id', m.portal_id, 'author_type', m.author_type,
      'author_name', m.author_name, 'body', m.body, 'created_at', m.created_at)
      order by m.created_at asc)
    from public.portal_messages m where m.portal_id = p_portal_id), '[]'::jsonb);
end; $$;

-- ── Client portal — token-gated WRITES ═══════════════════════════════════════
create or replace function public.portal_post_message(
  p_portal_id text, p_access_token text, p_body text, p_author_name text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pid uuid; v_id uuid;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  if p_body is null or length(btrim(p_body)) = 0 then raise exception 'portal_denied'; end if;
  insert into public.portal_messages(portal_id, project_id, author_type, author_name, body)
    values (p_portal_id, v_pid::text, 'client',
            left(coalesce(nullif(btrim(p_author_name), ''), 'Client'), 120),
            left(btrim(p_body), 4000))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;

create or replace function public.portal_submit_co_approval(
  p_portal_id text, p_access_token text, p_change_order_id text,
  p_decision text, p_signer_name text, p_note text, p_user_agent text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pid uuid; v_id uuid;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  if p_decision is null or p_decision not in ('approved', 'declined') then raise exception 'portal_denied'; end if;
  if p_change_order_id is null or length(btrim(p_change_order_id)) = 0 then raise exception 'portal_denied'; end if;
  insert into public.change_order_approvals(
      portal_id, project_id, change_order_id, decision, signer_name, note, user_agent)
    values (p_portal_id, v_pid::text, btrim(p_change_order_id), p_decision,
            left(coalesce(nullif(btrim(p_signer_name), ''), 'Client'), 200),
            left(coalesce(p_note, ''), 2000),
            left(coalesce(p_user_agent, ''), 200))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;

create or replace function public.portal_submit_budget_proposal(
  p_portal_id text, p_access_token text, p_amount numeric, p_note text, p_proposer_name text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pid uuid; v_id uuid;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  if p_amount is null or p_amount <= 0 or p_amount >= 1e9 then raise exception 'portal_denied'; end if;
  insert into public.portal_budget_proposals(portal_id, project_id, amount, note, proposer_name, status)
    values (p_portal_id, v_pid::text, p_amount,
            left(coalesce(p_note, ''), 2000),
            left(coalesce(p_proposer_name, ''), 200), 'pending')
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;

-- ── Sub-portal — add a real per-link secret, then token-gated read + submit ═══
-- 0 rows in prod today; the volatile default gives each future link a unique
-- 192-bit token. Existing app upserts omit the column, so the default applies.
alter table public.sub_portal_links
  add column if not exists access_token text not null default encode(gen_random_bytes(24), 'hex');

create or replace function public.sub_portal_get_snapshot(p_sub_portal_id text, p_access_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.sub_portal_links
                 where id = p_sub_portal_id and enabled = true
                   and coalesce(access_token, '') <> '' and access_token = p_access_token) then
    raise exception 'sub_portal_denied';
  end if;
  return (select snapshot from public.sub_portal_snapshots where sub_portal_id = p_sub_portal_id limit 1);
end; $$;

create or replace function public.sub_portal_submit_invoice(
  p_sub_portal_id text, p_access_token text, p_invoice_number text, p_amount numeric,
  p_retention_amount numeric, p_description text, p_line_items jsonb,
  p_commitment_id text, p_submitted_by_name text, p_submitted_by_email text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_link record; v_id uuid;
begin
  select id, project_id, subcontractor_id into v_link from public.sub_portal_links
    where id = p_sub_portal_id and enabled = true
      and coalesce(access_token, '') <> '' and access_token = p_access_token
    limit 1;
  if v_link is null then raise exception 'sub_portal_denied'; end if;
  if p_amount is null or p_amount <= 0 or p_amount >= 1e9 then raise exception 'sub_portal_denied'; end if;
  insert into public.sub_submitted_invoices(
      sub_portal_id, project_id, subcontractor_id, commitment_id, invoice_number, amount, retention_amount,
      description, line_items, status, submitted_by_name, submitted_by_email)
    values (p_sub_portal_id, v_link.project_id, v_link.subcontractor_id,
            nullif(left(coalesce(p_commitment_id, ''), 200), ''),
            left(coalesce(p_invoice_number, ''), 80), p_amount,
            greatest(0, coalesce(p_retention_amount, 0)),
            left(coalesce(p_description, ''), 500),
            coalesce(p_line_items, '[]'::jsonb), 'submitted',
            left(coalesce(p_submitted_by_name, ''), 120),
            left(coalesce(p_submitted_by_email, ''), 200))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;

-- ── Grants: anon may call ONLY the token-gated RPCs ══════════════════════════
grant execute on function public.portal_get_snapshot(text, text)            to anon, authenticated;
grant execute on function public.portal_get_messages(text, text)            to anon, authenticated;
grant execute on function public.portal_post_message(text, text, text, text) to anon, authenticated;
grant execute on function public.portal_submit_co_approval(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.portal_submit_budget_proposal(text, text, numeric, text, text) to anon, authenticated;
grant execute on function public.sub_portal_get_snapshot(text, text)        to anon, authenticated;
grant execute on function public.sub_portal_submit_invoice(text, text, text, numeric, numeric, text, jsonb, text, text, text) to anon, authenticated;
