-- 20260920110000_safety_incident_realtime_notify.sql — wave 4, lane safety (#119)
--
-- A FOREMAN'S INJURY REPORT NEVER REACHED AN OPEN GC SCREEN. SafetyContext
-- read safety_incidents once per sign-in, and nothing told the GC a case had
-- been filed on his job: no push, no email, no inbox row. He found it after a
-- relaunch, if he looked.
--
-- 1. REALTIME. safety_incidents joins the supabase_realtime publication, so
--    SafetyContext's INSERT/UPDATE listener fires. It does NOT splice the
--    payload in: it re-reads the table, so the mergeLocalOnly / queued-write
--    rules still decide what is shown. Realtime's postgres_changes applies each
--    subscriber's RLS (20260919130000: author OR project owner), so this shows
--    nobody a case they could not already SELECT. Read-only production check
--    2026-09-19: the table is not yet a member.
--
-- 2. NOTIFY THE OWNER. An INSERT whose author (user_id) is not the project's
--    owner raises 'safety_incident_filed' {project_id, incident_id,
--    author_name, severity} through public.fire_notify (pg_net + the cron
--    secret; it swallows its own failures, so a notification problem can never
--    roll back the case). NO PHI rides in the payload: no description, no
--    worker names, no body part — the push lands on a lock screen and the
--    outbox row is read by the inbox and the digests. The GC opens the case in
--    the app, where RLS decides who reads it. notify accepts this event only
--    from a trusted caller (SERVICE_ONLY_EVENTS). The owner's own cases never
--    notify him.
--
--    profiles has no full_name column (CONTRACT-F1); the e-mail address is not
--    used as a fallback (same rule as trg_notify_field_report_filed).
--
-- Read-only production check 2026-09-19: safety_incidents has 0 rows and one
-- trigger (safety_incidents_updated_at); fire_notify(text,text,text,jsonb)
-- exists. Idempotent: membership is checked, CREATE OR REPLACE + DROP TRIGGER
-- IF EXISTS. Order vs the OTA does not matter (the app also re-reads on
-- foreground and screen focus).

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found — nothing to do';
    return;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'safety_incidents'
  ) then
    execute 'alter publication supabase_realtime add table public.safety_incidents';
  end if;
end
$$;

create or replace function public.trg_notify_safety_incident_filed()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_owner uuid;
  v_author text;
begin
  if NEW.project_id is null then
    return NEW;
  end if;
  select p.user_id into v_owner from public.projects p where p.id = NEW.project_id;
  -- No project (orphan) or the owner's own case: nobody to tell.
  if v_owner is null or v_owner = NEW.user_id then
    return NEW;
  end if;
  select coalesce(nullif(btrim(pr.name), ''), nullif(btrim(pr.contact_name), ''))
    into v_author
    from public.profiles pr where pr.id = NEW.user_id;
  perform public.fire_notify(
    'safety_incident_filed',
    'safety_incidents',
    NEW.id::text,
    jsonb_build_object(
      'project_id', NEW.project_id,
      'incident_id', NEW.id,
      'author_name', v_author,
      'severity', NEW.severity
    )
  );
  return NEW;
end;
$function$;

drop trigger if exists notify_safety_incident_filed on public.safety_incidents;
create trigger notify_safety_incident_filed
  after insert on public.safety_incidents
  for each row execute function public.trg_notify_safety_incident_filed();

-- Trigger function only; nobody calls it directly.
revoke execute on function public.trg_notify_safety_incident_filed() from public, anon, authenticated;
