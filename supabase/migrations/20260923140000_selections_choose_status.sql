-- 20260923140000_selections_choose_status.sql — wave 5, lane closeout (#48, #137).
--
-- #48. A homeowner's pick in the portal never reached selection_categories.status.
-- portal_choose_selection flipped selection_options.is_chosen and wrote the audit
-- row, and nothing else. The GC's Selections card keys its overage line and its
-- "Draft a Change Order for the overage" button off status = 'exceeded', and the
-- late badge off 'chosen' / 'exceeded' — so a $620 pick on a $400 allowance read
-- as a green "Chosen" with no overage, and the $220 upgrade went unbilled. The
-- only writer of that status was the GC-side client (utils/selectionsEngine step
-- 3), which the portal never runs.
--
-- #137. The GC-side choose was three separate client writes: clear every other
-- option, set this one, then set the status. On one bar of signal the clear
-- could land and the set time out, leaving the category with NO chosen option —
-- the homeowner's earlier pick wiped and nothing saved in its place.
--
-- This migration:
--   1. re-issues portal_choose_selection from its LIVE body (read with
--      pg_get_functiondef on 2026-09-23 — identical to
--      20260904100800_portal_token_expiry_and_rotation.sql §4b: same token check
--      through portal_project_for_token, same category / option checks, same
--      audit insert, SECURITY DEFINER, search_path = public, same grants) and
--      adds, after the two option updates, the status write that mirrors
--      selectionsEngine's rule exactly: 'exceeded' only when the category has a
--      real budget (> 0) and the chosen option's total is over it, otherwise
--      'chosen'. The overage goes into the audit detail and the response
--      ({ ok, status, over }), so a later notification or outbox line can say
--      "picked $620 on Kitchen faucet, $220 over allowance". The category row is
--      locked first so a portal pick and a GC pick on the same category
--      serialize instead of interleaving their clear / set pairs.
--   2. adds gc_choose_selection(p_category_id, p_option_id) -> { ok, status, over }
--      (CONTRACT 20): the GC's choose in ONE transaction. Same editor rule as the
--      RLS update policy selcat_gc_update (auth.uid() = selection_categories.user_id,
--      read from pg_policies on 2026-09-23), then clear the others / set the
--      chosen one (chosen_by_role 'gc') / set the status. A failure anywhere
--      rolls the whole thing back, so the homeowner's pick survives a dropped
--      connection. chosen_by_role is always 'gc' here: an authenticated GC
--      cannot record a pick as the homeowner's — only the portal RPC can.
--   3. an idempotent backfill: any category that has a chosen option but whose
--      status disagrees with the rule (still 'pending' / 'browsing' after a
--      portal pick, or 'chosen' where the pick is over budget and vice versa)
--      is set from the same CASE. Production count on 2026-09-23: 0 rows
--      (2 categories, 6 options), so this is a no-op there today; it exists
--      for any pick made between now and the apply.
--
-- No notify here: CONTRACT 8 keeps fire_notify in AFTER triggers only.

-- ── 1. portal_choose_selection — live body + the category status ──────────────
create or replace function public.portal_choose_selection(p_portal_id text, p_category_id uuid, p_option_id uuid, p_access_token text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $fn$
declare
  v_project_id uuid;
  v_budget numeric;
  v_total numeric;
  v_status text;
  v_over numeric;
begin
  -- AUTH-F7: token + enabled + expiry in one place.
  v_project_id := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_project_id is null then
    raise exception 'selection_denied';
  end if;

  -- Existence check and row lock in one read: a GC pick on the same category
  -- (gc_choose_selection) waits for this transaction instead of interleaving.
  select coalesce(c.budget, 0) into v_budget
    from public.selection_categories c
   where c.id = p_category_id and c.project_id = v_project_id
   for update;
  if not found then
    raise exception 'selection_denied';
  end if;
  select coalesce(o.total, 0) into v_total
    from public.selection_options o
   where o.id = p_option_id and o.category_id = p_category_id;
  if not found then
    raise exception 'selection_denied';
  end if;

  update public.selection_options
     set is_chosen = false, chosen_at = null, chosen_by_role = null
   where category_id = p_category_id;
  update public.selection_options
     set is_chosen = true, chosen_at = now(), chosen_by_role = 'homeowner'
   where id = p_option_id and category_id = p_category_id;

  -- #48: utils/selectionsEngine's rule — over a REAL budget reads 'exceeded'.
  v_status := case when v_budget > 0 and v_total > v_budget then 'exceeded' else 'chosen' end;
  v_over := case when v_budget > 0 then greatest(v_total - v_budget, 0) else 0 end;
  update public.selection_categories c
     set status = v_status
   where c.id = p_category_id and c.project_id = v_project_id;

  insert into public.portal_decision_audit(portal_id, project_id, action, detail)
    values (p_portal_id, v_project_id, 'selection',
            jsonb_build_object('category', p_category_id, 'option', p_option_id,
                               'status', v_status, 'over', v_over));
  return jsonb_build_object('ok', true, 'status', v_status, 'over', v_over);
end; $fn$;

revoke execute on function public.portal_choose_selection(text, uuid, uuid, text) from public;
grant  execute on function public.portal_choose_selection(text, uuid, uuid, text) to anon, authenticated, service_role;

-- ── 2. gc_choose_selection — the GC's pick, atomic ────────────────────────────
create or replace function public.gc_choose_selection(p_category_id uuid, p_option_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_budget numeric;
  v_total numeric;
  v_status text;
  v_over numeric;
begin
  if v_uid is null then
    raise exception 'selection_denied' using errcode = '42501';
  end if;

  -- The RLS update policy's rule (selcat_gc_update: auth.uid() = user_id), read
  -- under a row lock so a concurrent portal pick serializes behind this one.
  select coalesce(c.budget, 0) into v_budget
    from public.selection_categories c
   where c.id = p_category_id and c.user_id = v_uid
   for update;
  if not found then
    raise exception 'selection_denied' using errcode = '42501';
  end if;
  select coalesce(o.total, 0) into v_total
    from public.selection_options o
   where o.id = p_option_id and o.category_id = p_category_id;
  if not found then
    raise exception 'selection_denied' using errcode = '42501';
  end if;

  update public.selection_options
     set is_chosen = false, chosen_at = null, chosen_by_role = null
   where category_id = p_category_id and id <> p_option_id;
  update public.selection_options
     set is_chosen = true, chosen_at = now(), chosen_by_role = 'gc'
   where id = p_option_id and category_id = p_category_id;

  v_status := case when v_budget > 0 and v_total > v_budget then 'exceeded' else 'chosen' end;
  v_over := case when v_budget > 0 then greatest(v_total - v_budget, 0) else 0 end;
  update public.selection_categories c
     set status = v_status
   where c.id = p_category_id;

  return jsonb_build_object('ok', true, 'status', v_status, 'over', v_over);
end; $fn$;

revoke execute on function public.gc_choose_selection(uuid, uuid) from public, anon;
grant  execute on function public.gc_choose_selection(uuid, uuid) to authenticated, service_role;

-- ── 3. backfill: status from the chosen option, idempotent ────────────────────
update public.selection_categories c
   set status = case when c.budget > 0 and o.total > c.budget then 'exceeded' else 'chosen' end
  from public.selection_options o
 where o.category_id = c.id
   and o.is_chosen
   and c.status is distinct from
       (case when c.budget > 0 and o.total > c.budget then 'exceeded' else 'chosen' end);
