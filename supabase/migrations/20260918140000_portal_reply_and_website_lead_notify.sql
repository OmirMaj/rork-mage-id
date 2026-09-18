-- Two notifications nothing was sending (audit round 2, wave 2).
--
-- #16 — the homeowner is told when the GC answers. trg_notify_portal_message
-- fired only for author_type = 'client', so a GC reply written from
-- app/client-messages.tsx reached nobody unless the homeowner happened to have
-- the portal open — while marketing/preferences/index.html promised a
-- "portal_message" email "when your client or contractor sends a message".
-- A 'gc' row now raises 'portal_reply'; notify resolves the addressee (the
-- invite on the newest client-authored row, else every invite), batches a burst
-- inside 15 minutes, honours the homeowner's unsubscribe and logs the send as a
-- recipient_kind 'client' outbox row. The client branch is unchanged.
--
-- #9 — a website lead pings the GC. public-lead-intake (the "Request a quote"
-- form) and widget-estimate (the Instant Estimate widget) insert into leads
-- with the service key and returned; nothing called notify, so the lead sat in
-- Pipeline until he next opened it, already "waiting 14h" in red. The alert
-- lives here, on the table, so both functions and any future website source are
-- covered by one rule: source = 'website', stage 'new', written by the service
-- role. A lead the GC types in himself (the app writes as `authenticated`) is
-- his own and never pings him, whatever source he picks.
--
-- Cross-tenant guard (integration review, 2026-09-18). The production INSERT
-- policy "gc inserts own portal messages" only checked that project_id was the
-- caller's own project — never that portal_id belonged to that project — and
-- notify resolves the project portal-first. Raising 'portal_reply' on that
-- policy would have let any signed-in GC make MAGE email ANOTHER contractor's
-- homeowner, branded as that contractor, with the attacker's text (and the
-- spoofed row sat in the victim's portal thread, invisible to the victim GC).
-- Three locks, any one of which stops the email:
--   1. the policies below bind portal_id to the caller's project on INSERT and
--      UPDATE (also closes the older thread-injection hole);
--   2. the trigger raises portal_reply only when the row's project owns the
--      portal it names;
--   3. notify's portal_reply branch re-checks payload.project_id === the
--      portal-resolved project (skipped_portal_mismatch).
-- Production had 0 gc rows whose project does not own their portal when this
-- was written, so the tightened policies strand nothing.
--
-- System notices (sendToClientPortal / recallFromClientPortal / batch send)
-- carry no author_name and do NOT raise portal_reply: the portal snapshot is
-- republished only from project-detail / client-portal-setup (#23, #44 open),
-- so an email written from Home or the Client Outbox could point at a portal
-- that does not show the item yet — or still shows a recalled CO as signable.
-- Only a message a person wrote in the thread (author_name set) emails.
--
-- Both go through public.fire_notify (pg_net + the cron secret; it refuses
-- direct calls and swallows its own failures, so a notification problem can
-- never roll back the message or the lead). notify refuses both events from
-- anything but that trigger path (SERVICE_ONLY_EVENTS).

-- Lock 1: a GC row must name the portal of the project it is filed under.
drop policy if exists "gc inserts own portal messages" on public.portal_messages;
create policy "gc inserts own portal messages" on public.portal_messages
  for insert to authenticated
  with check (
    author_type = 'gc'
    and project_id is not null
    and exists (
      select 1 from public.projects p
      where p.id::text = portal_messages.project_id
        and p.user_id = auth.uid()
        and p.client_portal ->> 'portalId' = portal_messages.portal_id
    )
  );

-- UPDATE had no WITH CHECK, so its USING (project owned) was the only check:
-- a GC could re-point one of his own rows at another contractor's portal_id.
-- Read receipts (the only app update) always name the project's own portal.
drop policy if exists "gc updates read receipts" on public.portal_messages;
create policy "gc updates read receipts" on public.portal_messages
  for update to authenticated
  using (
    project_id is not null
    and exists (
      select 1 from public.projects p
      where p.id::text = portal_messages.project_id and p.user_id = auth.uid()
    )
  )
  with check (
    project_id is not null
    and exists (
      select 1 from public.projects p
      where p.id::text = portal_messages.project_id
        and p.user_id = auth.uid()
        and p.client_portal ->> 'portalId' = portal_messages.portal_id
    )
  );

-- Lock 2 is in the gc branch below (project must own the portal).
create or replace function public.trg_notify_portal_message()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if NEW.author_type = 'client' then
    perform public.fire_notify(
      'portal_message',
      'portal_messages',
      NEW.id::text,
      jsonb_build_object(
        'portal_id', NEW.portal_id,
        'project_id', NEW.project_id,
        'invite_id', NEW.invite_id,
        'author_type', NEW.author_type,
        'author_name', NEW.author_name,
        'body', NEW.body
      )
    );
  elsif NEW.author_type = 'gc'
        and nullif(btrim(coalesce(NEW.author_name, '')), '') is not null then
    -- Nested, not folded into the elsif: this function runs as the INVOKER,
    -- and the portal RPCs that write client rows run as roles without SELECT
    -- on projects; a projects reference in the shared condition would be
    -- permission-checked for them too. Only gc rows (the owner under RLS, or
    -- service_role) reach this read.
    if not exists (
      select 1 from public.projects p
      where p.id::text = NEW.project_id
        and p.client_portal ->> 'portalId' = NEW.portal_id
    ) then
      return NEW;
    end if;
    perform public.fire_notify(
      'portal_reply',
      'portal_messages',
      NEW.id::text,
      jsonb_build_object(
        'portal_id', NEW.portal_id,
        'project_id', NEW.project_id,
        'author_type', NEW.author_type,
        'author_name', NEW.author_name,
        'body', NEW.body
      )
    );
  end if;
  return NEW;
end;
$function$;

create or replace function public.trg_notify_website_lead()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_role text := current_user;
begin
  -- PostgREST switches to the JWT's role, so a service-key insert runs as
  -- service_role; the claim is the belt to that brace.
  begin
    v_role := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', v_role);
  exception when others then
    v_role := current_user;
  end;
  if NEW.source = 'website'
     and coalesce(NEW.stage, 'new') = 'new'
     and (v_role = 'service_role' or current_user = 'service_role') then
    perform public.fire_notify(
      'lead_received',
      'leads',
      NEW.id::text,
      jsonb_build_object(
        'lead_id', NEW.id,
        'gc_user_id', NEW.user_id,
        'name', NEW.name,
        'phone', NEW.phone,
        'email', NEW.email,
        'project_type', NEW.project_type,
        'scope', left(NEW.scope, 1500),
        'budget_min', NEW.budget_min,
        'budget_max', NEW.budget_max
      )
    );
  end if;
  return NEW;
end;
$function$;

drop trigger if exists notify_website_lead on public.leads;
create trigger notify_website_lead
  after insert on public.leads
  for each row execute function public.trg_notify_website_lead();
