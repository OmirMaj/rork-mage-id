-- 20260919140000_dfr_portal_publish_owner.sql — wave 3, lane dfr-screen (#116)
--
-- TWO THINGS about a daily report a field seat files.
--
-- 1. WHO DECIDES WHAT THE HOMEOWNER SEES. daily_reports_collab_update admits
--    every 'field' collaborator, and the row carries the two columns the
--    homeowner portal reads: homeowner_summary_published (the "Latest update"
--    card — portal_overlay_live reads the newest published summary LIVE) and
--    portal_state (whether the report itself is shared). So a foreman could put
--    words in front of the homeowner with no GC review, from the app or with
--    his own token against PostgREST. The app now disables both controls for
--    field and viewer seats ("The project owner decides what the homeowner
--    sees"); this trigger is the server half, so a UI-only rule can't be
--    bypassed.
--
--    Rule: only the project OWNER or an EDITOR (can_access_project(..,'editor'),
--    the same tier the app's canPublishToClient uses) may change
--      - homeowner_summary_published,
--      - portal_state,
--      - homeowner_summary while the row is (or was) published — editing the
--        text of a published update changes what the homeowner reads.
--
--    NEUTRALISED, NOT RAISED — deliberately. utils/offlineQueue sends the WHOLE
--    report as one update, and treats a refused write as terminal (or retries
--    it to exhaustion): raising here would throw away the foreman's entire day
--    — crew, work, photos, an injury — because one flag rode along. So for a
--    field/viewer caller those columns keep their OLD values and the rest of
--    his report saves. The current app never sends such a change (the controls
--    are disabled), so this only ever meets a pre-OTA build or a hand-rolled
--    request; neither gets to publish.
--
--    INSERT by a field seat: homeowner_summary_published is forced false, and
--    portal_state is forced to draft when the OWNER turned auto-share of daily
--    reports off (client_portal.autoShare.dailyReports = false) — the same rule
--    the app's initialPortalState applies, so a foreman's report is shared
--    exactly when the owner's setting says it is, never because his device said
--    so.
--
--    Read-only production check 2026-09-18: 9 daily_reports rows, 0 written by
--    anyone other than the project owner — nothing existing is affected.
--
-- 2. THE GC HEARS THAT A FIELD REPORT WAS FILED. No notification mentioned
--    daily reports, so the GC found his foreman's report only by opening the
--    project. An INSERT whose user_id is not the project owner raises
--    'field_report_filed' {project_id, report_id, author_name} through
--    public.fire_notify (pg_net + the cron secret; it swallows its own failures,
--    so a notification problem can never roll back the report). notify's case
--    and the /daily-report?projectId=&reportId= route are built by the
--    invoice-send-pay lane; notify accepts the event only from this trigger
--    path (SERVICE_ONLY_EVENTS). The owner's own reports never notify him.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS. Safe to run twice.
-- No column is added; deploy order relative to the OTA does not matter.

create or replace function public.trg_daily_reports_portal_owner()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_publisher boolean;
  v_auto jsonb;
begin
  -- The service role (edge functions, repairs) is not a collaborator and is
  -- trusted, exactly as RLS trusts it.
  if auth.uid() is null then
    return NEW;
  end if;

  v_publisher := public.can_access_project(NEW.project_id, 'editor');
  if v_publisher then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    NEW.homeowner_summary_published := false;
    select p.client_portal -> 'autoShare' into v_auto
      from public.projects p where p.id = NEW.project_id;
    -- Anything that is not EXPLICITLY draft is forced to draft — including a
    -- missing / JSON-null portal_state, which the app's isShared() (and the
    -- server's portal_state_is_shared) read as SHARED. A hand-rolled insert
    -- that simply omits the column must not publish (integration critic
    -- server, round 1).
    if coalesce(v_auto ->> 'dailyReports', '') = 'false'
       and coalesce(NEW.portal_state ->> 'status', '') <> 'draft' then
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

drop trigger if exists daily_reports_portal_owner on public.daily_reports;
create trigger daily_reports_portal_owner
  before insert or update on public.daily_reports
  for each row execute function public.trg_daily_reports_portal_owner();

create or replace function public.trg_notify_field_report_filed()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_owner uuid;
  v_author text;
begin
  select p.user_id into v_owner from public.projects p where p.id = NEW.project_id;
  -- No project (orphan) or the owner's own report: nobody to tell.
  if v_owner is null or v_owner = NEW.user_id then
    return NEW;
  end if;
  -- profiles has no full_name column (CONTRACT-F1). The e-mail address is NOT
  -- used as a fallback: notify prints this name in a push, and "Your field
  -- team" is better than a stranger's address on a lock screen.
  select coalesce(nullif(btrim(pr.name), ''), nullif(btrim(pr.contact_name), ''))
    into v_author
    from public.profiles pr where pr.id = NEW.user_id;
  perform public.fire_notify(
    'field_report_filed',
    'daily_reports',
    NEW.id::text,
    jsonb_build_object(
      'project_id', NEW.project_id,
      'report_id', NEW.id,
      'author_name', v_author
    )
  );
  return NEW;
end;
$function$;

drop trigger if exists notify_field_report_filed on public.daily_reports;
create trigger notify_field_report_filed
  after insert on public.daily_reports
  for each row execute function public.trg_notify_field_report_filed();

-- Trigger functions only; nobody calls them directly.
revoke execute on function public.trg_daily_reports_portal_owner() from public, anon, authenticated;
revoke execute on function public.trg_notify_field_report_filed() from public, anon, authenticated;
