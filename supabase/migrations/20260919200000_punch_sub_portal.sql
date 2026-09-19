-- 20260919200000_punch_sub_portal.sql — wave 3, lane punch (#16, #17, #107, #109, #110)
--
-- FOUR THINGS, all about a punch item and the subcontractor it is on.
--
-- 1. punch_items.sub_note (#16). What the sub wrote when he marked an item
--    fixed from his portal. Its own column on purpose: rejection_note is the
--    GC's "sent back because…" and the app shows it as such; a sub's "done,
--    swapped the cover" must never read as a rejection.
--
-- 2. project_subcontractors(p_project_id) (#110). subcontractors RLS is
--    owner-only (auth.uid() = user_id), so a field hand walking the GC's job
--    loaded HIS OWN directory — usually empty, sometimes his own subs — and the
--    walk either saved a trade word or confidently assigned the GC's item to a
--    company the GC never hired. This returns the PROJECT OWNER's subs that are
--    assigned to that project, gated by can_access_project(.., 'field') (the
--    tier that may create or edit punch items), and ONLY the columns a picker
--    needs: id, company_name, trade, assigned_projects. No phone, email,
--    licence, COI, W-9 or notes — those are the GC's private file on the sub.
--
-- 3. sub_portal_get_snapshot now merges the LIVE punch list (#17, #107, #109).
--    The portal used to render the punch list frozen into the snapshot at the
--    moment the GC last opened that sub's setup screen: new items never showed,
--    closed ones never left. The stored snapshot is still returned (money,
--    schedule, contact), but its punchItems are REPLACED at read time by the
--    rows in punch_items right now, scoped exactly the way the app scopes them
--    (utils/subPortalSnapshot.ts punchItemBelongsToSub — an id is trusted only
--    while the row's name agrees with that sub's name; a legacy name-only row
--    matches by name). Each row carries its plan pin (planSheetId, sheetLabel,
--    pinX/pinY) and its durable photo storage path — never a device file:// —
--    plus the sub's own note. Sorted before the cap (on-you first, then
--    priority high→low, earliest due, oldest), with the uncapped count in
--    punchTotal so the page can say "Showing 60 of 75". punchLiveAt stamps it.
--    Money and schedule are NOT made live here: they are still as of the
--    snapshot's snapshotAt, and the page says so.
--
-- 4. sub_portal_mark_punch_ready(p_sub_portal_id, p_access_token, p_punch_id,
--    p_note) (#16). The sub had no way to say "fixed" — he phoned. Token-gated
--    exactly like sub_portal_get_snapshot (link enabled, non-empty equal token).
--    The item must be on this link's project, that project must belong to the
--    link's GC, and the item must be in this sub's scope by the SAME predicate
--    the read path publishes with — so "the item is on his published list" and
--    "he may mark it" are one rule by construction, legacy name-matched rows
--    included. open | in_progress → ready_for_review, updated_at = now(),
--    sub_note written; already ready_for_review is an idempotent ok; closed is
--    refused. The stored snapshot's entry is patched in the same transaction,
--    so a hash-less reload is consistent even before anything else runs.
--    Granted to anon (the page has no account).
--
--    The GC hears about it: an AFTER UPDATE trigger raises punch_marked_ready
--    {project_id, punch_item_id, sub_name} through public.fire_notify ONLY when
--    this RPC set the transaction-local flag mageid.punch_ready_sub — a GC
--    moving his own item to Ready for Review is not news to him. notify's case
--    and /punch-list route are built by the invoice-send-pay lane.
--
-- What this does NOT do (stated, not hidden):
--   * Photos are not rendered on the portal yet. project-photos is a private
--     bucket and Postgres cannot mint a storage signed URL; that needs a small
--     token-gated edge function. The path is carried so it can be added
--     without another snapshot change.
--   * A GC edit of the same item that was queued offline BEFORE the sub marked
--     it can land afterwards and write its old status back (the app's update
--     sends the whole row). Narrow; the sub_note survives because the app never
--     writes that column.
--
-- Read-only production check 2026-09-18: 0 sub_portal_links, 0
-- sub_portal_snapshots, punch_items status open=62 in_progress=1; no photo_uri
-- is a device URI; subcontractors.assigned_projects is a jsonb array of text.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF
-- EXISTS. Safe to run twice. Apply BEFORE the OTA that maps sub_note (the app
-- reads it; a missing column is simply absent from select('*')).

alter table public.punch_items add column if not exists sub_note text;

comment on column public.punch_items.sub_note is
  'The subcontractor''s note from his portal when he marked the item ready for review (sub_portal_mark_punch_ready). Never the GC''s rejection_note.';

-- ── The one scope predicate (mirrors utils/subPortalSnapshot.punchItemBelongsToSub)
create or replace function public.sub_portal_punch_belongs(
  p_assigned_sub text, p_assigned_sub_id text, p_sub_id text, p_sub_name text
) returns boolean
language sql
immutable
set search_path to ''
as $function$
  select case
    when coalesce(p_assigned_sub_id, '') <> '' and p_assigned_sub_id = p_sub_id
      then lower(btrim(coalesce(p_assigned_sub, ''))) = ''
        or lower(btrim(coalesce(p_assigned_sub, ''))) = lower(btrim(coalesce(p_sub_name, '')))
    else lower(btrim(coalesce(p_sub_name, ''))) <> ''
      and lower(btrim(coalesce(p_assigned_sub, ''))) = lower(btrim(coalesce(p_sub_name, '')))
  end;
$function$;

revoke execute on function public.sub_portal_punch_belongs(text, text, text, text) from public, anon, authenticated;

-- ── The live punch list for one link (internal; called by the token RPC) ────
-- Cap 60 — keep equal to SUB_PORTAL_PUNCH_CAP in utils/subPortalSnapshot.ts.
create or replace function public.sub_portal_live_punch(p_sub_portal_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_link record;
  v_sub record;
  v_items jsonb;
  v_total int;
begin
  select l.id, l.project_id, l.subcontractor_id, l.user_id
    into v_link
    from public.sub_portal_links l
   where l.id = p_sub_portal_id;
  if v_link.id is null then return null; end if;

  -- The link's GC must own the project it points at.
  if not exists (select 1 from public.projects p
                  where p.id::text = v_link.project_id and p.user_id = v_link.user_id) then
    return null;
  end if;

  select s.id::text as id, s.company_name
    into v_sub
    from public.subcontractors s
   where s.id::text = v_link.subcontractor_id and s.user_id = v_link.user_id;
  if v_sub.id is null then return null; end if;

  with scoped as (
    select pi.*
      from public.punch_items pi
     where pi.project_id::text = v_link.project_id
       and coalesce(pi.status, 'open') <> 'closed'
       and public.sub_portal_punch_belongs(pi.assigned_sub, pi.assigned_sub_id, v_sub.id, v_sub.company_name)
  ), ordered as (
    select sc.*,
           row_number() over (order by
             case when coalesce(sc.status, 'open') = 'ready_for_review' then 1 else 0 end,
             case sc.priority when 'high' then 0 when 'medium' then 1 when 'low' then 2 else 1 end,
             case when sc.due_date ~ '^\d{4}-\d{2}-\d{2}' then left(sc.due_date, 10) else '9999-12-31' end,
             sc.created_at nulls last,
             sc.id) as rn,
           count(*) over () as total
      from scoped sc
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', o.id::text,
           'description', o.description,
           'location', nullif(btrim(coalesce(o.location, '')), ''),
           'priority', o.priority,
           'status', coalesce(o.status, 'open'),
           'dueDate', nullif(btrim(coalesce(o.due_date, '')), ''),
           -- A durable storage path only. Anything with a scheme (file://,
           -- blob:, https://…) is not a path in project-photos.
           'photoStoragePath', case when coalesce(o.photo_uri, '') <> '' and o.photo_uri !~ '^[A-Za-z][A-Za-z0-9+.-]*:'
                                    then o.photo_uri end,
           'planSheetId', nullif(o.plan_sheet_id, ''),
           'sheetLabel', (select case
                                   when nullif(btrim(coalesce(ps.sheet_number, '')), '') is not null
                                    and nullif(btrim(coalesce(ps.name, '')), '') is not null
                                    and btrim(ps.sheet_number) <> btrim(ps.name)
                                     then btrim(ps.sheet_number) || ' · ' || btrim(ps.name)
                                   else coalesce(nullif(btrim(coalesce(ps.sheet_number, '')), ''),
                                                 nullif(btrim(coalesce(ps.name, '')), ''), 'Plan')
                                 end
                            from public.plan_sheets ps
                           where ps.id::text = o.plan_sheet_id
                             and ps.project_id::text = v_link.project_id
                           limit 1),
           'pinX', case when o.plan_sheet_id is not null then o.pin_x end,
           'pinY', case when o.plan_sheet_id is not null then o.pin_y end,
           'subNote', nullif(btrim(coalesce(o.sub_note, '')), '')
         )) order by o.rn), '[]'::jsonb),
         coalesce(max(o.total), 0)
    into v_items, v_total
    from ordered o
   where o.rn <= 60;

  return jsonb_build_object('items', v_items, 'total', v_total);
end;
$function$;

revoke execute on function public.sub_portal_live_punch(text) from public, anon, authenticated;

-- ── Token read, now with the live punch list ─────────────────────────────────
create or replace function public.sub_portal_get_snapshot(p_sub_portal_id text, p_access_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_snap jsonb;
  v_live jsonb;
begin
  if not exists (select 1 from public.sub_portal_links
                 where id = p_sub_portal_id and enabled = true
                   and coalesce(access_token, '') <> '' and access_token = p_access_token) then
    raise exception 'sub_portal_denied';
  end if;
  v_snap := (select snapshot from public.sub_portal_snapshots where sub_portal_id = p_sub_portal_id limit 1);
  if v_snap is null then return null; end if;
  v_live := public.sub_portal_live_punch(p_sub_portal_id);
  if v_live is null then
    -- The link's sub or project no longer resolves to this GC: publish no
    -- punch list rather than a frozen one.
    return (v_snap - 'punchItems' - 'punchTotal') || jsonb_build_object('punchLiveAt', now());
  end if;
  return v_snap
    || jsonb_build_object(
         'punchItems', v_live -> 'items',
         'punchTotal', v_live -> 'total',
         'punchLiveAt', now());
end;
$function$;

revoke execute on function public.sub_portal_get_snapshot(text, text) from public;
grant execute on function public.sub_portal_get_snapshot(text, text) to anon, authenticated, service_role;

-- ── The sub marks an item fixed ─────────────────────────────────────────────
create or replace function public.sub_portal_mark_punch_ready(
  p_sub_portal_id text, p_access_token text, p_punch_id text, p_note text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_link record;
  v_sub record;
  v_item record;
  v_pid uuid;
  v_note text := nullif(btrim(left(coalesce(p_note, ''), 1000)), '');
begin
  select id, project_id, subcontractor_id, user_id into v_link
    from public.sub_portal_links
   where id = p_sub_portal_id and enabled = true
     and coalesce(access_token, '') <> '' and access_token = p_access_token
   limit 1;
  if v_link.id is null then raise exception 'sub_portal_denied' using errcode = '42501'; end if;

  begin v_pid := p_punch_id::uuid; exception when others then
    raise exception 'punch_not_found' using errcode = 'P0002';
  end;

  select s.id::text as id, s.company_name into v_sub
    from public.subcontractors s
   where s.id::text = v_link.subcontractor_id and s.user_id = v_link.user_id;
  if v_sub.id is null then raise exception 'sub_portal_denied' using errcode = '42501'; end if;

  select pi.id, pi.project_id, pi.status, pi.assigned_sub, pi.assigned_sub_id into v_item
    from public.punch_items pi
    join public.projects p on p.id = pi.project_id and p.user_id = v_link.user_id
   where pi.id = v_pid
     and pi.project_id::text = v_link.project_id
   for update of pi;
  -- Not on this link's job, or not this GC's job: indistinguishable from
  -- "no such item" on purpose — the token must not probe other ids.
  if v_item.id is null
     or not public.sub_portal_punch_belongs(v_item.assigned_sub, v_item.assigned_sub_id, v_sub.id, v_sub.company_name) then
    raise exception 'punch_not_found' using errcode = 'P0002';
  end if;

  if coalesce(v_item.status, 'open') = 'ready_for_review' then
    return jsonb_build_object('ok', true, 'status', 'ready_for_review', 'already', true);
  end if;
  if coalesce(v_item.status, 'open') not in ('open', 'in_progress') then
    raise exception 'punch_not_open' using errcode = '22023';
  end if;

  -- Read by trg_notify_punch_marked_ready: this status change came from the
  -- sub, so the GC is told. Transaction-local.
  perform set_config('mageid.punch_ready_sub', coalesce(v_sub.company_name, ''), true);

  update public.punch_items
     set status = 'ready_for_review',
         sub_note = coalesce(v_note, sub_note),
         updated_at = now()
   where id = v_item.id;

  -- Keep the stored snapshot's entry in step (same transaction).
  update public.sub_portal_snapshots s
     set snapshot = jsonb_set(s.snapshot, '{punchItems}', (
           select coalesce(jsonb_agg(
                    case when e ->> 'id' = v_item.id::text
                         then e || jsonb_build_object('status', 'ready_for_review')
                                || case when v_note is not null then jsonb_build_object('subNote', v_note) else '{}'::jsonb end
                         else e end), '[]'::jsonb)
             from jsonb_array_elements(s.snapshot -> 'punchItems') e)),
         updated_at = now()
   where s.sub_portal_id = v_link.id
     and jsonb_typeof(s.snapshot -> 'punchItems') = 'array';

  return jsonb_build_object('ok', true, 'status', 'ready_for_review', 'already', false);
end;
$function$;

revoke execute on function public.sub_portal_mark_punch_ready(text, text, text, text) from public;
grant execute on function public.sub_portal_mark_punch_ready(text, text, text, text) to anon, authenticated, service_role;

-- ── The GC hears about it ───────────────────────────────────────────────────
create or replace function public.trg_notify_punch_marked_ready()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_sub text := current_setting('mageid.punch_ready_sub', true);
begin
  if coalesce(v_sub, '') = '' then return new; end if;
  perform public.fire_notify(
    'punch_marked_ready', 'punch_items', new.id::text,
    jsonb_build_object('project_id', new.project_id::text, 'punch_item_id', new.id::text, 'sub_name', v_sub));
  return new;
end;
$function$;

revoke execute on function public.trg_notify_punch_marked_ready() from public, anon, authenticated;

drop trigger if exists notify_punch_marked_ready on public.punch_items;
create trigger notify_punch_marked_ready
  after update of status on public.punch_items
  for each row
  when (new.status = 'ready_for_review' and old.status is distinct from new.status)
  execute function public.trg_notify_punch_marked_ready();

-- ── The GC's subs on a job, for his collaborators ───────────────────────────
create or replace function public.project_subcontractors(p_project_id text)
returns table (id uuid, company_name text, trade text, assigned_projects jsonb)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.can_access_project(p_project_id, 'field') then
    raise exception 'project_denied' using errcode = '42501';
  end if;
  return query
    select s.id, s.company_name, s.trade, s.assigned_projects
      from public.subcontractors s
      join public.projects p on p.id::text = p_project_id and s.user_id = p.user_id
     where jsonb_typeof(s.assigned_projects) = 'array'
       and s.assigned_projects ? p_project_id
     order by lower(s.company_name);
end;
$function$;

revoke execute on function public.project_subcontractors(text) from public, anon;
grant execute on function public.project_subcontractors(text) to authenticated, service_role;
