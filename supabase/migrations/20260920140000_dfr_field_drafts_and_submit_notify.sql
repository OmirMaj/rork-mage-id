-- 20260920140000_dfr_field_drafts_and_submit_notify.sql — wave 4, lane dfr
-- (#59/#133, #60, #22)
--
-- THREE THINGS about what a field seat's work puts in front of the homeowner,
-- and when the GC hears about it.
--
-- 1. A FOREMAN'S DAILY REPORT LANDS AS A DRAFT (#59/#133 — founder decision
--    pending; this is the interim he was offered). The GC's push said "Review
--    it before anything goes to the homeowner" and the email said "Nothing
--    reaches the homeowner until you decide it should" — but 20260919140000
--    forced a field seat's INSERT to draft only when the owner had EXPLICITLY
--    turned auto-share of daily reports off. All 7 production projects have no
--    autoShare key, so every foreman's report (even a half-written Save Draft)
--    was inserted as shared and fed the portal and the Friday digest with no
--    review. Now: an INSERT by a caller who is not the owner or an editor gets
--    portal_state {status:'draft'} whatever autoShare says. The owner's and an
--    editor's own reports keep auto-share exactly as before ("Daily reports as
--    I save them" is the GC's setting for HIS reports). The UPDATE branch is
--    unchanged: a field seat's edit keeps OLD.portal_state, so the GC's send
--    from the report or the Outbox is the only thing that publishes it.
--
-- 2. PHOTOS AND RFIs GET THE SAME OWNER/EDITOR RULE (#22, security).
--    photos_collab_update / rfis_collab_update admit every 'field'
--    collaborator for USING and WITH CHECK, and no trigger guarded
--    portal_state — so a foreman with his own token could PATCH
--    {"portal_state":{"status":"recalled"}} onto the GC's photo (the live
--    overlay drops it from the homeowner's page on the next read) or 'sent'
--    onto a photo the GC kept back. The app refuses field seats
--    (portalWriteRefusal); this is the server half. One function,
--    trg_portal_state_owner, on both tables:
--      - service role (auth.uid() null)          → untouched
--      - owner / editor (can_access_project(..,'editor')) → untouched
--      - field / viewer UPDATE → NEW.portal_state := OLD.portal_state
--        (NEUTRALISED, NOT RAISED: offlineQueue sends the whole row, and a
--        raise would throw away his photo markup or RFI edit with the flag)
--      - field / viewer INSERT → {status:'draft'} unless already exactly
--        draft. A missing / JSON-null portal_state reads as SHARED
--        (portal_state_is_shared), so an insert that just omits the column
--        must not publish. For photos this also covers the DFR-mirrored
--        photos (#59: "the report and its photos"); RFIs are draft-first in
--        the app already.
--    rfis_answer_guard / rfis_assign_number are independent of this trigger
--    (neither reads or writes portal_state), so their firing order relative
--    to rfis_portal_owner is harmless. The architect's token RPC runs as anon
--    (auth.uid() null) and passes.
--
--    Read-only production check 2026-09-22 before writing this: photos 10
--    rows, rfis 3, daily_reports 9 — 0 rows on any of them written by anyone
--    other than the project owner. Nothing existing changes.
--
-- 3. "DAILY REPORT FILED" FIRES ON SUBMIT, NOT ON THE FIRST SAVE DRAFT (#60).
--    The trigger was AFTER INSERT, so a foreman's 7 am Save Draft (or the
--    silent draft the delay-event handoff writes) told the GC "filed today's
--    report", and his real 4 pm Submit — an UPDATE of status to 'sent' — told
--    him nothing. Now AFTER INSERT OR UPDATE OF status, WHEN NEW.status =
--    'sent', and the body skips an UPDATE whose OLD.status was already 'sent'
--    (the offline queue sends every column on every update, so `UPDATE OF
--    status` alone fires on unrelated edits — the OLD/NEW test is what stops
--    repeats). An insert that already carries 'sent' (the queue squashing the
--    insert and the flip) notifies once. recalled → sent notifies again,
--    which is a real re-submission. Owner's own reports still never notify.
--
--    Payload (CONTRACT 10): {project_id, report_id, author_name, report_date,
--    portal_status}, plus in_weekly_digest (read only by notify's copy).
--      report_date   — the report's CALENDAR DAY, 'YYYY-MM-DD'. The column
--                      holds an ISO instant (every production row does), so
--                      the day is read in the recipient GC's own zone
--                      (profiles.digest_timezone, the zone his digests use);
--                      a bare day passes through untouched. NULL when neither
--                      parses — notify then says "a daily report", never a
--                      guessed day.
--      portal_status — what the HOMEOWNER CAN SEE NOW, not the raw column:
--                      'sent' only when the report is shared AND the job's
--                      portal is on AND it shows daily reports; otherwise
--                      'draft' (nothing reached the homeowner). The copy
--                      branches on it: 'sent' => "It's already on the
--                      homeowner's portal…"; 'draft' => "Review it before
--                      anything goes to the homeowner."
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS. Safe to run twice.
-- The applied 20260919140000 is not edited. No column is added. Deploy notify
-- (the copy that reads report_date / portal_status) with or before this.

-- ── 1. daily_reports: a field seat's INSERT is always a draft ───────────────
create or replace function public.trg_daily_reports_portal_owner()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- The service role (edge functions, repairs) is not a collaborator and is
  -- trusted, exactly as RLS trusts it.
  if auth.uid() is null then
    return NEW;
  end if;

  if public.can_access_project(NEW.project_id, 'editor') then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    NEW.homeowner_summary_published := false;
    -- #59/#133: draft whatever autoShare says — the GC reviews a field seat's
    -- report before anything reaches the homeowner. Anything that is not
    -- EXPLICITLY draft is forced, including a missing / JSON-null
    -- portal_state (which portal_state_is_shared reads as SHARED).
    if coalesce(NEW.portal_state ->> 'status', '') <> 'draft' then
      NEW.portal_state := jsonb_build_object('status', 'draft');
    end if;
    return NEW;
  end if;

  -- UPDATE by a field / viewer seat: keep what the owner decided.
  if coalesce(OLD.homeowner_summary_published, false)
     or coalesce(NEW.homeowner_summary_published, false) then
    NEW.homeowner_summary := OLD.homeowner_summary;
    NEW.homeowner_summary_generated_at := OLD.homeowner_summary_generated_at;
  end if;
  NEW.homeowner_summary_published := OLD.homeowner_summary_published;
  NEW.portal_state := OLD.portal_state;
  return NEW;
end;
$function$;

-- (The trigger itself is unchanged — restated so this file stands alone.)
drop trigger if exists daily_reports_portal_owner on public.daily_reports;
create trigger daily_reports_portal_owner
  before insert or update on public.daily_reports
  for each row execute function public.trg_daily_reports_portal_owner();

-- ── 2. photos + rfis: only the owner or an editor decides portal_state ──────
create or replace function public.trg_portal_state_owner()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null then
    return NEW;
  end if;
  if public.can_access_project(NEW.project_id, 'editor') then
    return NEW;
  end if;
  if TG_OP = 'INSERT' then
    if coalesce(NEW.portal_state ->> 'status', '') <> 'draft' then
      NEW.portal_state := jsonb_build_object('status', 'draft');
    end if;
    return NEW;
  end if;
  NEW.portal_state := OLD.portal_state;
  return NEW;
end;
$function$;

drop trigger if exists photos_portal_owner on public.photos;
create trigger photos_portal_owner
  before insert or update on public.photos
  for each row execute function public.trg_portal_state_owner();

drop trigger if exists rfis_portal_owner on public.rfis;
create trigger rfis_portal_owner
  before insert or update on public.rfis
  for each row execute function public.trg_portal_state_owner();

-- ── 3. field_report_filed on the transition to 'sent' ───────────────────────
create or replace function public.trg_notify_field_report_filed()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_owner uuid;
  v_author text;
  v_portal jsonb;
  v_tz text;
  v_day text;
  v_raw text := btrim(coalesce(NEW.date, ''));
  v_shared boolean;
  v_visible boolean;
begin
  -- Edge-triggered: an UPDATE that was already 'sent' is an edit, not a
  -- submission (the WHEN clause only guarantees NEW.status = 'sent').
  if TG_OP = 'UPDATE' and OLD.status is not distinct from 'sent' then
    return NEW;
  end if;

  select p.user_id, p.client_portal into v_owner, v_portal
    from public.projects p where p.id = NEW.project_id;
  -- No project (orphan), the owner's own report, or the owner submitting a
  -- foreman's draft himself (the actor, not the author: since this fires on
  -- the flip to 'sent', the updater can be the GC — telling him "<foreman>
  -- filed the report" about his own tap is noise). A service-role caller has
  -- no auth.uid() (NULL), so a server-side submit still notifies.
  if v_owner is null or v_owner = NEW.user_id or v_owner = auth.uid() then
    return NEW;
  end if;
  -- profiles has no full_name column (CONTRACT-F1). The e-mail address is NOT
  -- used as a fallback: notify prints this name in a push.
  select coalesce(nullif(btrim(pr.name), ''), nullif(btrim(pr.contact_name), ''))
    into v_author
    from public.profiles pr where pr.id = NEW.user_id;

  -- The report's calendar day. A bare day is already one; an instant is read
  -- in the recipient GC's zone. Anything unparseable (or a bad zone name) is
  -- NULL — the notification must never fail the submit, and never guess.
  if v_raw ~ '^\d{4}-\d{2}-\d{2}$' then
    v_day := v_raw;
  elsif v_raw <> '' then
    select nullif(btrim(pr.digest_timezone), '') into v_tz
      from public.profiles pr where pr.id = v_owner;
    begin
      v_day := to_char((v_raw::timestamptz) at time zone coalesce(v_tz, 'America/New_York'), 'YYYY-MM-DD');
    exception when others then
      v_day := null;
    end;
  end if;

  -- What the homeowner can see NOW (not the raw column): shared (NULL /
  -- JSON-null / 'sent' — the portal_state_is_shared rule, inlined) AND the
  -- job's portal is on AND it shows daily reports.
  v_shared := NEW.portal_state is null or jsonb_typeof(NEW.portal_state) = 'null'
              or coalesce(NEW.portal_state ->> 'status', '') = 'sent';
  v_visible := v_shared
               and coalesce(v_portal ->> 'enabled', '') = 'true'
               and coalesce(v_portal ->> 'showDailyReports', '') = 'true';

  perform public.fire_notify(
    'field_report_filed',
    'daily_reports',
    NEW.id::text,
    jsonb_build_object(
      'project_id', NEW.project_id,
      'report_id', NEW.id,
      'author_name', v_author,
      'report_date', v_day,
      'portal_status', case when v_visible then 'sent' else 'draft' end,
      'in_weekly_digest', v_visible and coalesce(v_portal -> 'weeklyDigest' ->> 'enabled', '') = 'true'
    )
  );
  return NEW;
end;
$function$;

drop trigger if exists notify_field_report_filed on public.daily_reports;
create trigger notify_field_report_filed
  after insert or update of status on public.daily_reports
  for each row
  when (NEW.status = 'sent')
  execute function public.trg_notify_field_report_filed();

-- Trigger functions only; nobody calls them directly.
revoke execute on function public.trg_daily_reports_portal_owner() from public, anon, authenticated;
revoke execute on function public.trg_portal_state_owner() from public, anon, authenticated;
revoke execute on function public.trg_notify_field_report_filed() from public, anon, authenticated;
