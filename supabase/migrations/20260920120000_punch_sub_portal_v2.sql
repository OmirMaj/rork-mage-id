-- 20260920120000_punch_sub_portal_v2.sql — wave 4, lane punch-sub-portal
--   (#46 = #53 = #140, #47 = #55, #49, #50, #52; carries #3, #51, #56)
--
-- Never edits 20260919200000 (applied); every function below is CREATE OR
-- REPLACE with the same signature and the same grants/revokes.
--
-- 1. punch_items.rejected_at (CONTRACT 12) — THE reject signal. A real reject
--    is an update whose NEW.rejected_at is later than OLD.rejected_at (or
--    OLD's is null). Why not the other columns:
--      * rejection_note: app/punch-list.tsx always writes
--        `note || 'Rejected — needs rework'`, so a second reject with the
--        default (or the same words) leaves it unchanged — indistinguishable
--        from a stale whole-row resend of the first one.
--      * updated_at: the client stamps it at edit time and punch_items_updated_at
--        overwrites it with now() anyway.
--    The app stamps rejected_at = now() on every GC move out of Review to
--    open / in_progress (punch-gc lane), and sends it ONLY with a reject
--    (context-records lane).
--
-- 2. punch_items_guard — BEFORE UPDATE, SECURITY INVOKER (it reads
--    current_user), search_path ''. It acts on CLIENT roles only
--    (current_user in ('authenticated','anon')):
--      * service_role passes: delete-account's handover
--        (supabase/functions/delete-account/index.ts, step 1) moves user_id to
--        the project owner — pinning it there would leave those rows under the
--        leaver's uid for step 2c to delete.
--      * SECURITY DEFINER RPCs pass: inside one, current_user is the function
--        owner, so sub_portal_mark_punch_ready still writes sub_note. PostgREST
--        cannot forge that — a REST request always runs as anon/authenticated.
--    For a client role:
--      a. #52 user_id and sub_note are pinned. user_id is the creator (the
--         creator-or-owner delete rule rests on it; the app never changes it
--         after insert). sub_note is the SUB's words (the app never writes it),
--         so a field collaborator can no longer PATCH "done, per Rivera" in.
--      b. #46/#53/#140 a row the sub marked ready_for_review cannot be moved
--         back to open / in_progress except by a REAL reject. Anything else —
--         the GC's edit from a copy loaded before the sub's mark, an edit he
--         queued offline that morning, a bulk room assign, a sub rename — keeps
--         OLD status, closed_at, rejection_note and rejected_at and lets every
--         other column land. NEUTRALISE, never raise: a raise would strand the
--         queued write as a terminal failure and lose the GC's other edits with
--         it.
--         Pre-OTA builds send the whole row with no rejected_at, so a reject
--         they queued is neutralised too: the GC sees Ready for Review after
--         the refetch and rejects again. Visible, not silent. (The wave-3
--         header called the stale-status revert "narrow" and offline-only; it
--         was neither — it happened online from any stale copy. That caveat is
--         retired: this guard is the fix.)
--      c. rejected_at never moves backwards or to null from a client (a stale
--         resend must not reset the clock the next real reject is measured by).
--    For every role (the RPC never changes either input, so its own update
--    never trips this):
--      d. #47/#55 sub_note is cleared on a real reject (the sub's "done" note
--         belonged to the round the GC just sent back) and on a REASSIGNMENT,
--         i.e. the sub really changed: both ids set and different, or (at
--         least one id empty) the lower/trimmed assigned_sub name changed.
--         Linking a name-only item to the SAME sub's id, or dropping the id
--         while the name stays, is NOT a reassignment (the app's edit form
--         seeds the id from the name, so an ordinary save does exactly that),
--         and neither is a rename that keeps assigned_sub_id. rejection_note is NEVER cleared: subScorecard /
--         subNetwork read it as the sub's rework history.
--
-- 3. #52 punch_items_collab_delete: the creator branch now also needs
--    can_access_project(project_id, 'field') — a collaborator removed from the
--    job loses delete rights on the items he raised. SELECT is unchanged
--    (founder decision pending: should a removed collaborator keep reading his
--    own items?). Production 2026-09-19: 63 punch_items, 0 created by anyone but
--    the project owner, 0 whose creator lacks field access — nothing changes
--    for an existing row.
--    The same unchecked creator branch exists on the DELETE and SELECT
--    policies of daily_reports, drawing_pins, field_tickets, permits, photos,
--    plan_calibrations, plan_markups, plan_sheets, rfis, submittals and
--    time_entries (20260803140000); not changed here (reported).
--
-- 4. sub_portal_live_punch:
--      * #47/#55 gcNote — the GC's reason, ONLY on rows back on the sub
--        (open / in_progress). The page words the app's default
--        'Rejected — needs rework' as "no reason given".
--      * #56 a location of 'Unspecified' (any case) is no location; the
--        'Plan' literal in sheetLabel is gone — an unnamed or missing sheet is
--        null and the page says "sheet not available" instead of inventing one.
--
-- 5. sub_portal_get_snapshot (#50): a denied read raises sub_portal_denied
--    with errcode 42501 (PostgREST answers 401/403, not a generic 400), so the
--    page can tell "link turned off" from "no signal".
--
-- 6. sub_portal_mark_punch_ready:
--      * #47/#55 sub_note = v_note (not coalesce): a mark with no note clears
--        last round's words; the stored snapshot's subNote follows (the key is
--        removed when null) and its gcNote goes (the item is back on the GC).
--      * #49 the already-in-Review branch SAVES a new note (and patches the
--        snapshot) instead of dropping it, without a second push (the flag is
--        not set). Answer: {ok, status, already, note_added}.
--
-- 7. #51 punch_marked_ready payload adds description, location and sub_note
--    (CONTRACT 10); punch-gc builds the notify side.
--
-- 8. #3 punch_items.due_date gets DEFAULT '' (NOT NULL, no default today): an
--    insert from an older build that omits the column saves with a blank due
--    date instead of failing 23502. Production: 0 null due dates.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP … IF EXISTS.
-- Apply BEFORE the OTA (the app writes rejected_at) and before the sub-portal
-- page deploy (the page reads gcNote / note_added / 42501; it tolerates their
-- absence).

alter table public.punch_items add column if not exists rejected_at timestamptz;

comment on column public.punch_items.rejected_at is
  'When the GC last sent the item back (Reject / move out of Review). A later value than the stored one is the ONLY thing that may move a ready_for_review row back to open/in_progress (punch_items_guard).';

alter table public.punch_items alter column due_date set default '';

-- ── The guard ────────────────────────────────────────────────────────────────
create or replace function public.punch_items_guard()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_real_reject boolean := new.rejected_at is not null
                           and (old.rejected_at is null or new.rejected_at > old.rejected_at);
  v_old_id text := nullif(btrim(coalesce(old.assigned_sub_id, '')), '');
  v_new_id text := nullif(btrim(coalesce(new.assigned_sub_id, '')), '');
  v_reassigned boolean;
begin
  if current_user in ('authenticated', 'anon') then
    -- a. the creator and the sub's words are not the client's to rewrite.
    new.user_id := old.user_id;
    new.sub_note := old.sub_note;

    -- b. only a real reject takes an item out of Review back onto the sub.
    if coalesce(old.status, 'open') = 'ready_for_review'
       and new.status in ('open', 'in_progress')
       and not v_real_reject then
      new.status := old.status;
      new.closed_at := old.closed_at;
      new.rejection_note := old.rejection_note;
      new.rejected_at := old.rejected_at;
    end if;

    -- c. the reject clock never runs backwards from a client.
    if not v_real_reject then
      new.rejected_at := old.rejected_at;
    end if;
  end if;

  -- d. last round's note goes with a real reject or a new sub.
  -- Only a real change of sub: both ids known and different, or — when either
  -- id is missing — a different normalised name. Linking/dropping the id on
  -- the same named sub keeps his note.
  v_reassigned := case
    when v_old_id is not null and v_new_id is not null then v_old_id <> v_new_id
    else lower(btrim(coalesce(old.assigned_sub, ''))) <> lower(btrim(coalesce(new.assigned_sub, '')))
  end;
  if v_real_reject or v_reassigned then
    new.sub_note := null;
  end if;

  return new;
end;
$function$;

revoke execute on function public.punch_items_guard() from public, anon, authenticated;

-- Name sorts before punch_items_updated_at (same-event BEFORE triggers fire in
-- name order); the guard does not read updated_at, so the order is not
-- load-bearing, only tidy.
drop trigger if exists punch_items_guard on public.punch_items;
create trigger punch_items_guard
  before update on public.punch_items
  for each row
  execute function public.punch_items_guard();

-- ── #52 delete: the creator branch needs current field access ───────────────
drop policy if exists punch_items_collab_delete on public.punch_items;
create policy punch_items_collab_delete on public.punch_items
  for delete to authenticated
  using (
    (auth.uid() = user_id and public.can_access_project(project_id, 'field'::text))
    or exists (select 1 from public.projects p
                where p.id::text = punch_items.project_id::text and p.user_id = auth.uid())
  );

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
           -- 'Unspecified' is the walk's "no room given" placeholder, not a room.
           'location', case when lower(btrim(coalesce(o.location, ''))) in ('', 'unspecified') then null
                            else btrim(o.location) end,
           'priority', o.priority,
           'status', coalesce(o.status, 'open'),
           'dueDate', nullif(btrim(coalesce(o.due_date, '')), ''),
           -- A durable storage path only. Anything with a scheme (file://,
           -- blob:, https://…) is not a path in project-photos.
           'photoStoragePath', case when coalesce(o.photo_uri, '') <> '' and o.photo_uri !~ '^[A-Za-z][A-Za-z0-9+.-]*:'
                                    then o.photo_uri end,
           'planSheetId', nullif(o.plan_sheet_id, ''),
           -- No 'Plan' fallback: an unnamed or unsynced sheet is null, and the
           -- page says the sheet is not available instead of inventing a name.
           'sheetLabel', (select case
                                   when nullif(btrim(coalesce(ps.sheet_number, '')), '') is not null
                                    and nullif(btrim(coalesce(ps.name, '')), '') is not null
                                    and btrim(ps.sheet_number) <> btrim(ps.name)
                                     then btrim(ps.sheet_number) || ' · ' || btrim(ps.name)
                                   else coalesce(nullif(btrim(coalesce(ps.sheet_number, '')), ''),
                                                 nullif(btrim(coalesce(ps.name, '')), ''))
                                 end
                            from public.plan_sheets ps
                           where ps.id::text = o.plan_sheet_id
                             and ps.project_id::text = v_link.project_id
                           limit 1),
           'pinX', case when o.plan_sheet_id is not null then o.pin_x end,
           'pinY', case when o.plan_sheet_id is not null then o.pin_y end,
           'subNote', nullif(btrim(coalesce(o.sub_note, '')), ''),
           -- The GC's reason, only while the item is back on the sub.
           'gcNote', case when coalesce(o.status, 'open') in ('open', 'in_progress')
                          then nullif(btrim(coalesce(o.rejection_note, '')), '') end
         )) order by o.rn), '[]'::jsonb),
         coalesce(max(o.total), 0)
    into v_items, v_total
    from ordered o
   where o.rn <= 60;

  return jsonb_build_object('items', v_items, 'total', v_total);
end;
$function$;

revoke execute on function public.sub_portal_live_punch(text) from public, anon, authenticated;

-- ── Token read: a denial is 42501, not a generic error ──────────────────────
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
    raise exception 'sub_portal_denied' using errcode = '42501';
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

  select pi.id, pi.project_id, pi.status, pi.assigned_sub, pi.assigned_sub_id, pi.sub_note into v_item
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
    -- #49 Already in Review (a colleague marked it, a lost response, the GC
    -- moved it): a NEW note is still his to add — save it rather than drop it
    -- while the page says "sent". No flag, so no second "ready" push.
    -- note_added means "this note is now with the GC": a resend of the SAME
    -- note (the first answer was lost or timed out) is already stored, so it
    -- answers true without a write.
    if v_note is not null and v_note is not distinct from v_item.sub_note then
      return jsonb_build_object('ok', true, 'status', 'ready_for_review', 'already', true, 'note_added', true);
    end if;
    if v_note is not null then
      update public.punch_items
         set sub_note = v_note,
             updated_at = now()
       where id = v_item.id;
      update public.sub_portal_snapshots s
         set snapshot = jsonb_set(s.snapshot, '{punchItems}', (
               select coalesce(jsonb_agg(
                        case when e ->> 'id' = v_item.id::text
                             then e || jsonb_build_object('subNote', v_note)
                             else e end), '[]'::jsonb)
                 from jsonb_array_elements(s.snapshot -> 'punchItems') e)),
             updated_at = now()
       where s.sub_portal_id = v_link.id
         and jsonb_typeof(s.snapshot -> 'punchItems') = 'array';
      return jsonb_build_object('ok', true, 'status', 'ready_for_review', 'already', true, 'note_added', true);
    end if;
    return jsonb_build_object('ok', true, 'status', 'ready_for_review', 'already', true, 'note_added', false);
  end if;
  if coalesce(v_item.status, 'open') not in ('open', 'in_progress') then
    raise exception 'punch_not_open' using errcode = '22023';
  end if;

  -- Read by trg_notify_punch_marked_ready: this status change came from the
  -- sub, so the GC is told. Transaction-local.
  perform set_config('mageid.punch_ready_sub', coalesce(v_sub.company_name, ''), true);

  -- sub_note = v_note, not coalesce: a mark with no note must not resurrect
  -- the note from the round the GC already sent back.
  update public.punch_items
     set status = 'ready_for_review',
         sub_note = v_note,
         updated_at = now()
   where id = v_item.id;

  -- Keep the stored snapshot's entry in step (same transaction): subNote is
  -- this round's note or absent, and the GC's reason goes with the round.
  update public.sub_portal_snapshots s
     set snapshot = jsonb_set(s.snapshot, '{punchItems}', (
           select coalesce(jsonb_agg(
                    case when e ->> 'id' = v_item.id::text
                         then (e - 'subNote' - 'gcNote') || jsonb_build_object('status', 'ready_for_review')
                                || case when v_note is not null then jsonb_build_object('subNote', v_note) else '{}'::jsonb end
                         else e end), '[]'::jsonb)
             from jsonb_array_elements(s.snapshot -> 'punchItems') e)),
         updated_at = now()
   where s.sub_portal_id = v_link.id
     and jsonb_typeof(s.snapshot -> 'punchItems') = 'array';

  return jsonb_build_object('ok', true, 'status', 'ready_for_review', 'already', false, 'note_added', v_note is not null);
end;
$function$;

revoke execute on function public.sub_portal_mark_punch_ready(text, text, text, text) from public;
grant execute on function public.sub_portal_mark_punch_ready(text, text, text, text) to anon, authenticated, service_role;

-- ── The GC hears about it — now with which item (#51, CONTRACT 10) ──────────
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
    jsonb_build_object(
      'project_id', new.project_id::text,
      'punch_item_id', new.id::text,
      'sub_name', v_sub,
      'description', left(coalesce(new.description, ''), 300),
      'location', case when lower(btrim(coalesce(new.location, ''))) in ('', 'unspecified') then null
                       else left(btrim(new.location), 120) end,
      'sub_note', left(nullif(btrim(coalesce(new.sub_note, '')), ''), 500)));
  return new;
end;
$function$;

revoke execute on function public.trg_notify_punch_marked_ready() from public, anon, authenticated;
