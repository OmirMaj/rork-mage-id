-- 20260923170000_rls_hardening.sql
--
-- Wave 5, rls-hardening lane (chain C). Five server-side fixes, all additive,
-- all applied BEFORE the OTA. Every definition below that replaces a live one
-- was based on production's pg_get_functiondef / pg_policies read on
-- 2026-09-23 (proconfig, SECURITY DEFINER / INVOKER and ACLs kept; CREATE OR
-- REPLACE keeps the existing grants). No wave-4 migration redefines any object
-- touched here: wave 4's 20260920060000 CALLS portal_project_for_token (its
-- signature and meaning are unchanged), and its 20260920140000 / 20260920120000
-- triggers are left alone — section 2 is ordered to run BEFORE them.
--
-- GUARD TRIGGER RULE (every section): a trigger that protects columns from a
-- replayed client write pins them silently (NEW.col := OLD.col). A raise turns
-- the offline queue's replayed full-row write into a permanent failure and
-- loses the legitimate change riding in the same row. The only raises are the
-- ones the caller must be told about: #61's delete refusal and #181's
-- participant freeze (no client path ever writes participant_ids on update).
--
-- (1) #82  — the homeowner portal key moves to an owner-only table.
-- (2) #85  — a field seat can no longer take ownership of the GC's rows, and a
--            signed T&M ticket's content is sealed on the server.
-- (3) #179 — a field seat can overwrite project documents only under
--            daily-reports/ (the DFR PDF re-save), nowhere else.
-- (4) #181 — only people already in a Hire conversation can join it, read it
--            or post into it.
-- (5) #61  — a job with injury / near-miss records can't be deleted by a
--            signed-in caller (the OSHA 300 log keeps them 5 years).
--
-- Tests: PGlite, every section, run twice in a row against production-shaped
-- stubs — scratchpad w5rls_pg/w5_rls_hardening.mjs (see
-- scripts/validate-w5-rls-hardening-sql.ts for the static half).


-- ════════════════════════════════════════════════════════════════════════════
-- (1) #82 · portal_credentials — the homeowner's key off the shared row
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY. projects_select admits every accepted collaborator (field seats
-- included), and the table-level SELECT grant covers client_portal. That blob
-- carried accessToken, and accessToken is the ONLY thing the anon portal RPCs
-- check before recording a homeowner's e-signature on a change order. A
-- foreman could read it and sign as the client. The client strips it
-- (stripPortalCredentials) but PostgREST returns it to anyone who asks.
--
-- WHAT THIS FILE DOES (the productDecision #82 interim):
--   • public.portal_credentials(project_id pk, portal_id unique, access_token,
--     passcode, rotated_at) — RLS on, SELECT for the project owner only, no
--     INSERT / UPDATE / DELETE for authenticated. It is written only by the
--     SECURITY DEFINER token trigger, the rotate RPC and the service role.
--   • backfill from client_portal->>'accessToken' / 'passcode'.
--   • portal_set_access_token keeps / mints the token IN portal_credentials
--     (the credentials row is authoritative for the owner's writes) and, until
--     the held strip, still MIRRORS it into client_portal so builds from
--     before this OTA keep building portal links.
--   • portal_project_for_token(_any) and portal_rotate_access_token read /
--     write portal_credentials first (falling back to client_portal for a
--     project with no credentials row, during the transition only).
--   • portal_get_owner_token(p_project_id) — the owner's getter for Client
--     Portal setup (w5-join-screens switches readServerPortalToken to it).
--   • projects_keep_owner_client_portal: a non-owner's write to client_portal
--     is silently dropped (OLD kept), so an editor can neither switch the
--     portal nor plant a key he knows.
--
-- WHAT IT DOES NOT DO. The key stays mirrored on the projects row, so the hole
-- is only CLOSED by the held strip (held/20260923171000_portal_token_strip.sql),
-- which waits for the founder's OK after this OTA has reached devices. Until
-- then: don't invite collaborators to the 3 portal-enabled jobs. No column
-- REVOKE on client_portal — ProjectContext loads projects with select('*'),
-- and `*` fails for everyone once a single column is ungranted.

create table if not exists public.portal_credentials (
  -- DEFERRABLE: the token trigger runs BEFORE INSERT on projects, so on a
  -- brand-new project it writes this row before the parent exists. The check
  -- runs at commit, when it does (or the whole statement has failed anyway).
  -- ON DELETE CASCADE itself is never deferred.
  project_id  uuid primary key references public.projects(id) on delete cascade deferrable initially deferred,
  portal_id   text unique,
  access_token text not null,
  passcode    text,
  rotated_at  timestamptz
);

comment on table public.portal_credentials is
  'The homeowner portal key (access token + passcode) for a project (20260923170000, #82). Owner-only SELECT; written only by portal_set_access_token (trigger, SECURITY DEFINER), portal_rotate_access_token and the service role. projects.client_portal still mirrors the token until held/20260923171000 strips it.';

alter table public.portal_credentials enable row level security;

revoke all on public.portal_credentials from public, anon, authenticated;
grant select on public.portal_credentials to authenticated;
grant all on public.portal_credentials to service_role;

drop policy if exists portal_credentials_owner_select on public.portal_credentials;
create policy portal_credentials_owner_select on public.portal_credentials
  for select to authenticated
  using (exists (
    select 1 from public.projects p
     where p.id = portal_credentials.project_id
       and p.user_id = auth.uid()
  ));

-- Backfill. Only rows that carry a real portal id (the '' placeholder is left
-- to the trigger) — production: 3 rows with a token, 3 with a portalId, 0
-- passcodes, 0 tokens without a portalId (read 2026-09-23).
insert into public.portal_credentials (project_id, portal_id, access_token, passcode, rotated_at)
select p.id,
       p.client_portal->>'portalId',
       p.client_portal->>'accessToken',
       nullif(p.client_portal->>'passcode', ''),
       null
  from public.projects p
 where jsonb_typeof(p.client_portal) = 'object'
   and nullif(p.client_portal->>'portalId', '') is not null
   and nullif(p.client_portal->>'accessToken', '') is not null
on conflict (project_id) do nothing;

-- A non-owner's client_portal write keeps OLD. Runs after
-- projects_freeze_ownership (which already pins the portal id) and BEFORE
-- trg_portal_access_token (BEFORE triggers fire in name order: 'projects_k…'
-- < 'trg_…'), so the token trigger only ever sees an owner-approved blob.
-- Service-role writes (auth.uid() IS NULL — homeowner-weekly-digest, repairs)
-- and SECURITY DEFINER RPCs that don't touch client_portal (a field seat's
-- field_update_schedule_tasks) are unaffected.
create or replace function public.projects_keep_owner_client_portal()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $fn$
begin
  if auth.uid() is not null and auth.uid() is distinct from old.user_id then
    new.client_portal := old.client_portal;
  end if;
  return new;
end;
$fn$;

comment on function public.projects_keep_owner_client_portal() is
  'BEFORE UPDATE on projects (20260923170000, #82): a signed-in caller who is not the owner cannot change client_portal at all — the write is kept silently (the offline queue replays whole rows), so an editor can neither switch the homeowner portal nor plant an access token he knows.';

drop trigger if exists projects_keep_owner_client_portal on public.projects;
create trigger projects_keep_owner_client_portal
  before update on public.projects
  for each row execute function public.projects_keep_owner_client_portal();

-- The token trigger. Was SECURITY INVOKER and wrote only the blob; it now has
-- to write portal_credentials, which authenticated cannot, so it is DEFINER
-- with its search_path kept. Who may write the credentials row: the service
-- role, or the OWNER as stored (on an upsert's insert attempt the existing
-- row's owner, never NEW.user_id).
create or replace function public.portal_set_access_token()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $fn$
declare
  v_caller    uuid := auth.uid();
  v_owner     uuid;
  v_pid       text;
  v_cred_pid  text;
  v_cred_tok  text;
  v_may_write boolean;
  v_tok       text;
begin
  if new.client_portal is null
     or jsonb_typeof(new.client_portal) <> 'object'
     or not (new.client_portal ? 'portalId') then
    return new;
  end if;

  v_pid := nullif(new.client_portal->>'portalId', '');

  if tg_op = 'UPDATE' then
    v_owner := old.user_id;
  else
    select p.user_id into v_owner from public.projects p where p.id = new.id;
    v_owner := coalesce(v_owner, new.user_id);
  end if;
  v_may_write := v_caller is null or v_caller = v_owner;

  if v_pid is not null then
    select pc.portal_id, pc.access_token into v_cred_pid, v_cred_tok
      from public.portal_credentials pc where pc.project_id = new.id;
  end if;

  if v_may_write then
    -- The credentials row wins for this portal id: an owner's stale copy can
    -- no longer undo a rotation. A new portal id (re-minted portal) starts
    -- from the blob, as before.
    v_tok := coalesce(
      case when v_cred_pid is not distinct from v_pid then nullif(v_cred_tok, '') end,
      nullif(new.client_portal->>'accessToken', ''),
      case when tg_op = 'UPDATE' then nullif(old.client_portal->>'accessToken', '') end,
      encode(extensions.gen_random_bytes(24), 'hex'));
  else
    -- Not the owner (only reachable on an upsert's insert attempt — updates
    -- by non-owners arrive here with OLD's blob): never pull the stored key
    -- into NEW, never mint.
    v_tok := coalesce(
      nullif(new.client_portal->>'accessToken', ''),
      case when tg_op = 'UPDATE' then nullif(old.client_portal->>'accessToken', '') end);
  end if;

  if v_may_write and v_pid is not null
     and not exists (select 1 from public.projects p
                      where p.client_portal->>'portalId' = v_pid and p.id <> new.id) then
    -- A portal id no other project carries. Clear a stale credentials row
    -- still holding it (its project re-minted or dropped its portal) so the
    -- unique index can't refuse this one; when another project DOES carry the
    -- id, skip — projects_client_portal_portal_id_uidx refuses the row itself.
    delete from public.portal_credentials
     where portal_id = v_pid and project_id <> new.id;
    insert into public.portal_credentials as pc
           (project_id, portal_id, access_token, passcode, rotated_at)
    values (new.id, v_pid, v_tok, nullif(new.client_portal->>'passcode', ''), null)
    on conflict (project_id) do update
       set portal_id    = excluded.portal_id,
           access_token = excluded.access_token,
           passcode     = excluded.passcode,
           rotated_at   = case when pc.access_token is distinct from excluded.access_token
                               then now() else pc.rotated_at end;
  end if;

  -- TRANSITION MIRROR: builds from before this OTA read the token off the row.
  -- held/20260923171000 replaces this with a strip.
  if v_tok is not null then
    new.client_portal := new.client_portal || jsonb_build_object('accessToken', v_tok);
  end if;
  return new;
end;
$fn$;

comment on function public.portal_set_access_token() is
  'BEFORE INSERT OR UPDATE on projects (20260923170000, #82): keeps / mints the portal access token in portal_credentials (owner or service role only) and, until held/20260923171000, mirrors it into client_portal for pre-OTA builds.';

-- The token check. Same signature, same STABLE SQL, same expiry rule; the key
-- now comes from portal_credentials, falling back to the blob only for a
-- project that has no credentials row yet.
create or replace function public.portal_project_for_token(p_portal_id text, p_access_token text)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p.id from public.projects p
    left join public.portal_credentials pc
           on pc.project_id = p.id and pc.portal_id = p_portal_id
   where p.client_portal->>'portalId' = p_portal_id
     and coalesce((p.client_portal->>'enabled')::boolean, false) = true
     and coalesce(nullif(pc.access_token, ''), p.client_portal->>'accessToken', '') <> ''
     and coalesce(nullif(pc.access_token, ''), p.client_portal->>'accessToken') = p_access_token
     and not exists (
       select 1 from public.portal_snapshots ps
        where ps.portal_id = p_portal_id
          and ps.expires_at is not null
          and ps.expires_at <= now()
     )
   limit 1;
$function$;

create or replace function public.portal_project_for_token_any(p_portal_id text, p_access_token text)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p.id from public.projects p
    left join public.portal_credentials pc
           on pc.project_id = p.id and pc.portal_id = p_portal_id
   where p.client_portal->>'portalId' = p_portal_id
     and coalesce((p.client_portal->>'enabled')::boolean, false) = true
     and coalesce(nullif(pc.access_token, ''), p.client_portal->>'accessToken', '') <> ''
     and coalesce(nullif(pc.access_token, ''), p.client_portal->>'accessToken') = p_access_token
   limit 1;
$function$;

-- Rotation. Writes the credentials row FIRST (the token trigger treats it as
-- authoritative), then the transition mirror, and verifies both.
create or replace function public.portal_rotate_access_token(p_project_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_owner uuid;
  v_portal jsonb;
  v_portal_id text;
  v_new text;
  v_stored text;
  v_mirror text;
begin
  if auth.uid() is null then
    raise exception 'portal_rotate_denied' using errcode = '42501';
  end if;

  select user_id, client_portal into v_owner, v_portal
    from public.projects where id = p_project_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'portal_rotate_denied' using errcode = '42501';
  end if;

  v_portal_id := v_portal->>'portalId';
  if v_portal is null or coalesce(v_portal_id, '') = '' then
    raise exception 'portal_rotate_no_portal';
  end if;

  v_new := encode(extensions.gen_random_bytes(24), 'hex');

  delete from public.portal_credentials
   where portal_id = v_portal_id and project_id <> p_project_id;
  insert into public.portal_credentials as pc
         (project_id, portal_id, access_token, passcode, rotated_at)
  values (p_project_id, v_portal_id, v_new, nullif(v_portal->>'passcode', ''), now())
  on conflict (project_id) do update
     set portal_id = excluded.portal_id,
         access_token = excluded.access_token,
         rotated_at = now();

  -- TRANSITION MIRROR (dropped by held/20260923171000).
  update public.projects
     set client_portal = client_portal || jsonb_build_object('accessToken', v_new)
   where id = p_project_id and user_id = auth.uid();

  select access_token into v_stored
    from public.portal_credentials where project_id = p_project_id;
  select client_portal->>'accessToken' into v_mirror
    from public.projects where id = p_project_id;
  if v_stored is distinct from v_new or v_mirror is distinct from v_new then
    raise exception 'portal_rotate_failed: a trigger rewrote the token';
  end if;

  insert into public.portal_decision_audit(portal_id, project_id, action, detail)
    values (v_portal_id, p_project_id, 'token_rotated',
            jsonb_build_object('by', auth.uid(), 'at', now()));

  return v_new;
end; $function$;

-- The owner's getter (CONTRACT 13). null = this project has no portal key yet;
-- anyone but the owner is refused (42501), never told whether one exists.
create or replace function public.portal_get_owner_token(p_project_id uuid)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $fn$
declare
  v_owner  uuid;
  v_portal jsonb;
  v_tok    text;
begin
  if auth.uid() is null then
    raise exception 'portal_token_denied' using errcode = '42501';
  end if;
  select user_id, client_portal into v_owner, v_portal
    from public.projects where id = p_project_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'portal_token_denied' using errcode = '42501';
  end if;
  select nullif(pc.access_token, '') into v_tok
    from public.portal_credentials pc
   where pc.project_id = p_project_id
     and pc.portal_id is not distinct from nullif(v_portal->>'portalId', '');
  return coalesce(v_tok, nullif(v_portal->>'accessToken', ''));
end;
$fn$;

comment on function public.portal_get_owner_token(uuid) is
  'The homeowner portal access token for the caller''s OWN project (20260923170000, #82): null when none exists, 42501 for anyone but the owner. Client Portal setup reads it here instead of from projects.client_portal.';

revoke all on function public.portal_get_owner_token(uuid) from public, anon;
grant execute on function public.portal_get_owner_token(uuid) to authenticated, service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- (2) #85 · collaborator rows: ownership frozen, signed tickets sealed
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY. Every *_collab_update policy checks can_access_project(project_id,
-- 'field') on USING and WITH CHECK and nothing else, and the matching delete
-- policies admit the row's user_id. So a field seat could PATCH the GC's row
-- to user_id = himself and then DELETE it — time entries off payroll, RFIs,
-- daily reports, signed T&M tickets, photos. The "creator or owner can delete"
-- rule only held in the UI.
--
-- collab_freeze_ownership: when the caller is signed in and is not the owner
-- of the row's project (decided from OLD.project_id, never NEW), user_id,
-- project_id and created_at are kept from OLD. Silent (GUARD TRIGGER RULE) —
-- fieldTicketRow sends user_id on every update, so a raise would refuse every
-- foreman edit of a GC ticket; pinned, those edits land and the ownership
-- transfer doesn't. The owner and the service role pass through.
--
-- The trigger is named aa_collab_freeze_ownership on every table: BEFORE
-- triggers fire in name order, and wave 4's photos_portal_owner /
-- rfis_portal_owner / daily_reports_portal_owner (20260920140000) decide
-- ownership from can_access_project(NEW.project_id, 'editor'). project_id must
-- be restored BEFORE they run, or a seat could retarget a row at his own
-- project and pass their check.
--
-- Attached to every public table with a *_collab_update policy EXCEPT
-- punch_items (wave 4's punch_items_guard owns it). Production 2026-09-23:
-- access_reservations, building_access_rules, daily_reports, deliveries,
-- drawing_pins, field_tickets, permits, photos, plan_calibrations,
-- plan_markups, plan_sheets, rfis, submittals, time_entries. field_tickets and
-- time_entries key project_id as TEXT; the cast below handles both.
--
-- NOT CHANGED, deliberately: time_entries_collab_update still lets a field
-- seat edit another worker's shift hours (foremen close each other's shifts —
-- #99 / #106). Only ownership is frozen.

create or replace function public.collab_freeze_ownership()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $fn$
declare
  v_pid   uuid;
  v_owner uuid;
begin
  if auth.uid() is null then
    return new;
  end if;
  begin
    v_pid := (old.project_id)::text::uuid;
  exception when others then
    v_pid := null;
  end;
  if v_pid is not null then
    select p.user_id into v_owner from public.projects p where p.id = v_pid;
  end if;
  if v_owner is not null and v_owner = auth.uid() then
    return new;
  end if;
  new.user_id    := old.user_id;
  new.project_id := old.project_id;
  new.created_at := old.created_at;
  return new;
end;
$fn$;

comment on function public.collab_freeze_ownership() is
  'BEFORE UPDATE (trigger aa_collab_freeze_ownership) on every *_collab_update table (20260923170000, #85): a signed-in caller who does not own OLD.project_id''s project cannot change user_id, project_id or created_at — kept silently from OLD. Owner and service role pass.';

do $mig$
declare
  r record;
  v_cols int;
begin
  for r in
    select distinct pol.tablename
      from pg_policies pol
     where pol.schemaname = 'public'
       and pol.policyname like '%\_collab\_update'
       and pol.tablename <> 'punch_items'
     order by pol.tablename
  loop
    select count(*) into v_cols
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = r.tablename
       and c.column_name in ('user_id', 'project_id', 'created_at');
    if v_cols <> 3 then
      raise exception '[170000] public.% has a *_collab_update policy but not all of user_id / project_id / created_at — extend collab_freeze_ownership() for it before applying', r.tablename;
    end if;
    execute format('drop trigger if exists aa_collab_freeze_ownership on public.%I', r.tablename);
    execute format('create trigger aa_collab_freeze_ownership before update on public.%I for each row execute function public.collab_freeze_ownership()', r.tablename);
  end loop;
end
$mig$;

-- field_tickets seal. Once a ticket leaves 'draft' the owner's rep has signed
-- for a set of hours and quantities; ProjectContext.updateFieldTicket refuses
-- to move them (sealedFieldTicketViolations), but only in the app. This is the
-- same rule on the server, for EVERY signed-in caller, owner included:
--   • work_description, reason_extra, date, markup_percent, authorization:
--     kept from OLD.
--   • labor / materials / equipment: kept from OLD unless the change is
--     PRICE-ONLY (same rows, same order, every key equal except labor.rate /
--     materials.unitCost / equipment.rate — SEALED_FIELD_TICKET_PRICE_FIELDS)
--     AND the caller is the owner or an editor (fieldTicketPricingBlockReason:
--     "Pricing is done in the office"). The office pricing a signed ticket is
--     the app's own feature; a field seat's copy is kept.
--   • photos: kept from OLD unless the change is the upload queue's backfill —
--     same rows, same order, only uri / storagePath / localUri moved
--     (ticketPhotoRows writes uri = storagePath once the bytes land).
--   • status may move (signed → converted / void) but never back to 'draft',
--     which would reopen everything above for a second write.
--   • converted_change_order_id, converted_at, audit_trail, updated_at pass.
-- Named aa_field_tickets_seal so it runs right after aa_collab_freeze_ownership.

create or replace function public.field_ticket_rows_same_except(p_old jsonb, p_new jsonb, p_keys text[])
 returns boolean
 language sql
 immutable
 set search_path to 'pg_catalog'
as $fn$
  select case
    when p_old is null or p_new is null then p_old is not distinct from p_new
    when jsonb_typeof(p_old) <> 'array' or jsonb_typeof(p_new) <> 'array' then p_old = p_new
    when jsonb_array_length(p_old) <> jsonb_array_length(p_new) then false
    else not exists (
      select 1
        from jsonb_array_elements(p_old) with ordinality as o(v, i)
        join jsonb_array_elements(p_new) with ordinality as n(v, i) on n.i = o.i
       where (case when jsonb_typeof(o.v) = 'object' then o.v - p_keys else o.v end)
             is distinct from
             (case when jsonb_typeof(n.v) = 'object' then n.v - p_keys else n.v end)
    )
  end
$fn$;

comment on function public.field_ticket_rows_same_except(jsonb, jsonb, text[]) is
  'True when two jsonb row arrays hold the same rows in the same order, equal in every key except p_keys (20260923170000, #85 — the server twin of fieldTicketCore.isPricingOnlyRowChange).';

create or replace function public.field_tickets_seal()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $fn$
declare
  v_can_price boolean;
begin
  if auth.uid() is null then
    return new;
  end if;
  if old.status is null or old.status = 'draft' then
    return new;
  end if;

  new.work_description := old.work_description;
  new.reason_extra     := old.reason_extra;
  new.date             := old.date;
  new.markup_percent   := old.markup_percent;
  new."authorization"  := old."authorization";

  v_can_price := public.can_access_project(old.project_id, 'editor');
  if not (v_can_price and public.field_ticket_rows_same_except(old.labor, new.labor, array['rate'])) then
    new.labor := old.labor;
  end if;
  if not (v_can_price and public.field_ticket_rows_same_except(old.materials, new.materials, array['unitCost'])) then
    new.materials := old.materials;
  end if;
  if not (v_can_price and public.field_ticket_rows_same_except(old.equipment, new.equipment, array['rate'])) then
    new.equipment := old.equipment;
  end if;
  if not public.field_ticket_rows_same_except(old.photos, new.photos, array['uri', 'storagePath', 'localUri']) then
    new.photos := old.photos;
  end if;
  if new.status is null or new.status = 'draft' then
    new.status := old.status;
  end if;
  return new;
end;
$fn$;

comment on function public.field_tickets_seal() is
  'BEFORE UPDATE (trigger aa_field_tickets_seal) on field_tickets (20260923170000, #85): once status <> ''draft'' the signed content is kept from OLD for every signed-in caller — price-only labor/materials/equipment changes by the owner or an editor and the photo upload backfill are the only content moves let through; status never returns to draft.';

drop trigger if exists aa_field_tickets_seal on public.field_tickets;
create trigger aa_field_tickets_seal
  before update on public.field_tickets
  for each row execute function public.field_tickets_seal();

-- Post-condition: every *_collab_update table (bar punch_items) carries the
-- freeze, and the fourteen production tables are all among them.
do $mig$
declare
  v_missing text;
  v_expected text[] := array['access_reservations', 'building_access_rules', 'daily_reports',
    'deliveries', 'drawing_pins', 'field_tickets', 'permits', 'photos', 'plan_calibrations',
    'plan_markups', 'plan_sheets', 'rfis', 'submittals', 'time_entries'];
begin
  select string_agg(t.tablename, ', ') into v_missing
    from (select distinct tablename from pg_policies
           where schemaname = 'public' and policyname like '%\_collab\_update'
             and tablename <> 'punch_items') t
   where not exists (select 1 from pg_trigger tg
                      where tg.tgrelid = format('public.%I', t.tablename)::regclass
                        and tg.tgname = 'aa_collab_freeze_ownership' and not tg.tgisinternal);
  if v_missing is not null then
    raise exception '[170000] aa_collab_freeze_ownership missing on: %', v_missing;
  end if;
  select string_agg(e, ', ') into v_missing
    from unnest(v_expected) e
   where to_regclass(format('public.%I', e)) is not null
     and not exists (select 1 from pg_trigger tg
                      where tg.tgrelid = to_regclass(format('public.%I', e))
                        and tg.tgname = 'aa_collab_freeze_ownership' and not tg.tgisinternal);
  if v_missing is not null then
    raise exception '[170000] expected collab tables without the ownership freeze (did their *_collab_update policy get renamed?): %', v_missing;
  end if;
  if exists (select 1 from pg_trigger tg where tg.tgrelid = to_regclass('public.punch_items')
              and tg.tgname = 'aa_collab_freeze_ownership') then
    raise exception '[170000] punch_items must stay with wave 4''s punch_items_guard';
  end if;
  raise notice '[170000] ownership freeze attached to every collab table';
end
$mig$;


-- ════════════════════════════════════════════════════════════════════════════
-- (3) #179 · project documents: field seats overwrite only daily-reports/
-- ════════════════════════════════════════════════════════════════════════════
--
-- The live policy (20260904100900_field_role_reconcile.sql ~:100-110) let any
-- field seat UPDATE any object under the job's prefix: an upsert over the
-- GC's contract / plan / permit / closeout / financial upload or a submittal
-- attachment replaced the file behind the GC's saved link, and a storage MOVE
-- (same UPDATE policy) could rename a file away — a delete the delete policy
-- ('editor') forbids. 100900 raised the tier for one reason: a foreman
-- re-saving a daily report PDF at <pid>/daily-reports/<reportId>.pdf with
-- upsert: true. That keeps working, including over a report the GC started.
-- The same rule sits on USING and WITH CHECK so a move can't land outside
-- daily-reports/. INSERT stays 'field' (a foreman still adds new files;
-- utils/projectFiles uploads with upsert: false).

drop policy if exists project_docs_update on storage.objects;
create policy project_docs_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-documents'
    and (
      public.can_access_project((storage.foldername(name))[1], 'editor')
      or ((storage.foldername(name))[2] = 'daily-reports'
          and public.can_access_project((storage.foldername(name))[1], 'field'))
    )
  )
  with check (
    bucket_id = 'project-documents'
    and (
      public.can_access_project((storage.foldername(name))[1], 'editor')
      or ((storage.foldername(name))[2] = 'daily-reports'
          and public.can_access_project((storage.foldername(name))[1], 'field'))
    )
  );

do $mig$
declare v_q text; v_c text;
begin
  select qual, with_check into v_q, v_c from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname = 'project_docs_update';
  if v_q is null or v_c is null then
    raise exception '[170000] project_docs_update is missing its USING or WITH CHECK';
  end if;
  if position('''editor''' in v_q) = 0 or position('daily-reports' in v_q) = 0
     or position('''editor''' in v_c) = 0 or position('daily-reports' in v_c) = 0 then
    raise exception '[170000] project_docs_update must be editor-anywhere / field-only-under-daily-reports on BOTH clauses';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'storage' and tablename = 'objects'
                and policyname = 'project_docs_insert'
                and position('''field''' in coalesce(with_check, '')) = 0) then
    raise exception '[170000] project_docs_insert should still be on the field tier';
  end if;
  raise notice '[170000] project_docs_update scoped: field seats overwrite only daily-reports/';
end
$mig$;


-- ════════════════════════════════════════════════════════════════════════════
-- (4) #181 · Hire conversations: membership can't be self-granted
-- ════════════════════════════════════════════════════════════════════════════
--
-- cp_insert_self let anyone insert a conversation_participants row for any
-- conversation id; convo_select_participant / convo_update_participant then
-- trusted that table, and neither UPDATE policy had a WITH CHECK, so the
-- intruder could append himself to participant_ids and read every message.
-- messages_insert checked only sender_id, so anyone could post into any id.
--
-- contexts/HireContext.tsx (read 2026-09-23): startConversation inserts the
-- conversations row with participant_ids, then one conversation_participants
-- row PER participant (other people's rows too — the old self-only policy
-- refused those), then the first message; sendMessage inserts a message and
-- updates last_message / last_message_time only. Nothing writes participant_ids
-- after insert. So:
--   • cp_insert_participant: a row only when BOTH the caller and the row's
--     user_id are already in that conversation's participant_ids.
--   • convo_select_participant / convo_update_participant dropped: the
--     participant_ids policies cover every real participant.
--   • conversations_update gets a WITH CHECK, scoped to authenticated.
--   • conversations_freeze_participants: participant_ids can't change for a
--     signed-in caller (raise — no client path does it); participant_names
--     is pinned silently.
--   • messages_insert: sender is the caller AND the caller is a participant,
--     scoped to authenticated.
-- Production 2026-09-23: 0 conversations, 0 participants rows, 0 messages;
-- HIRE_ENABLED is off. Ships before it is turned on. HireContext needs no
-- change.

drop policy if exists cp_insert_self on public.conversation_participants;
drop policy if exists cp_insert_participant on public.conversation_participants;
create policy cp_insert_participant on public.conversation_participants
  for insert to authenticated
  with check (exists (
    select 1 from public.conversations c
     where c.id = conversation_participants.conversation_id
       and (auth.uid())::text in (select jsonb_array_elements_text(c.participant_ids))
       and (conversation_participants.user_id)::text in (select jsonb_array_elements_text(c.participant_ids))
  ));

drop policy if exists convo_select_participant on public.conversations;
drop policy if exists convo_update_participant on public.conversations;

drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations
  for update to authenticated
  using ((auth.uid())::text in (select jsonb_array_elements_text(conversations.participant_ids)))
  with check ((auth.uid())::text in (select jsonb_array_elements_text(conversations.participant_ids)));

create or replace function public.conversations_freeze_participants()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $fn$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.participant_ids is distinct from old.participant_ids then
    raise exception 'conversation_participants_frozen'
      using errcode = '42501',
            hint = 'Who is in a conversation is set when it starts.';
  end if;
  new.participant_names := old.participant_names;
  return new;
end;
$fn$;

comment on function public.conversations_freeze_participants() is
  'BEFORE UPDATE on conversations (20260923170000, #181): participant_ids never changes for a signed-in caller (42501); participant_names is kept silently. The service role passes.';

drop trigger if exists conversations_freeze_participants on public.conversations;
create trigger conversations_freeze_participants
  before update on public.conversations
  for each row execute function public.conversations_freeze_participants();

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.conversations c
       where c.id = messages.conversation_id
         and (auth.uid())::text in (select jsonb_array_elements_text(c.participant_ids))
    )
  );

do $mig$
begin
  if exists (select 1 from pg_policies where schemaname = 'public'
              and policyname in ('cp_insert_self', 'convo_select_participant', 'convo_update_participant')) then
    raise exception '[170000] a self-granting Hire policy survived';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversations'
              and cmd = 'UPDATE' and with_check is null) then
    raise exception '[170000] a conversations UPDATE policy has no WITH CHECK';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages'
                  and policyname = 'messages_insert' and with_check like '%participant_ids%') then
    raise exception '[170000] messages_insert does not require the sender to be a participant';
  end if;
  raise notice '[170000] Hire conversation membership locked';
end
$mig$;


-- ════════════════════════════════════════════════════════════════════════════
-- (5) #61 · a job with safety incidents can't be deleted by a signed-in caller
-- ════════════════════════════════════════════════════════════════════════════
--
-- safety_incidents.project_id is ON DELETE CASCADE (20260708120000:70; prod
-- confdeltype 'c'), so deleting a finished job erased its injury and
-- near-miss records and they dropped off the OSHA 300 / 300A screens — records
-- OSHA says are kept for 5 years. A BEFORE DELETE trigger refuses the delete
-- for a signed-in caller while any incident exists for the job (CONTRACT 22):
--   errcode 23001 (restrict_violation), message 'project_has_safety_records',
--   DETAIL 'incidents=<n>'.
-- NEVER 23503: wave 4's offline queue reads 23503 as a missing parent
-- (isParentMissingRefusal) and would keep retrying.
-- auth.uid() IS NULL passes — the service role, delete-account's explicit
-- projects delete and the auth.users cascade from auth.admin.deleteUser must
-- keep working, or account deletion (an App Store requirement) fails for
-- anyone with an incident. So: deleting an ACCOUNT still erases its incidents
-- (and safety_incidents.user_id is itself ON DELETE CASCADE on auth.users —
-- a foreman who deletes his account takes the incidents he filed with him).
-- Not changed here; flagged to the founder.
-- JHAs, toolbox talks and hazards keep cascading. The FK is left as it is:
-- RESTRICT would also refuse the service-role account deletion.
-- The client half (refuse before any local wipe, the delete-confirm copy, the
-- queue restoring the job on a 23001) is w5-join-core / w5-join-screens.
-- Production 2026-09-23: 0 incidents, so nothing is blocked today.

create or replace function public.projects_keep_safety_records()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $fn$
declare
  v_n int;
begin
  if auth.uid() is null then
    return old;
  end if;
  select count(*) into v_n from public.safety_incidents si where si.project_id = old.id;
  if v_n > 0 then
    raise exception 'project_has_safety_records'
      using errcode = '23001',
            detail  = format('incidents=%s', v_n),
            hint    = 'Mark the job Closed instead: injury and near-miss records stay on the OSHA 300 log for 5 years.';
  end if;
  return old;
end;
$fn$;

comment on function public.projects_keep_safety_records() is
  'BEFORE DELETE on projects (20260923170000, #61): a signed-in caller cannot delete a project that has safety_incidents rows — 23001 project_has_safety_records, DETAIL incidents=<n>. The service role / account deletion (auth.uid() IS NULL) passes.';

drop trigger if exists projects_keep_safety_records on public.projects;
create trigger projects_keep_safety_records
  before delete on public.projects
  for each row execute function public.projects_keep_safety_records();

-- Post-conditions for (1) and (5).
do $mig$
declare v_rows int; v_creds int;
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.projects'::regclass
                  and tgname = 'projects_keep_safety_records' and not tgisinternal) then
    raise exception '[170000] projects_keep_safety_records is not attached';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.projects'::regclass
                  and tgname = 'projects_keep_owner_client_portal' and not tgisinternal) then
    raise exception '[170000] projects_keep_owner_client_portal is not attached';
  end if;
  select count(*) into v_rows from public.projects
   where jsonb_typeof(client_portal) = 'object'
     and nullif(client_portal->>'portalId', '') is not null
     and nullif(client_portal->>'accessToken', '') is not null;
  select count(*) into v_creds from public.portal_credentials pc
    join public.projects p on p.id = pc.project_id
   where pc.portal_id = p.client_portal->>'portalId';
  if v_creds < v_rows then
    raise exception '[170000] % portal row(s) carry a key but only % have a portal_credentials row', v_rows, v_creds;
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'portal_credentials'
                and grantee in ('anon', 'authenticated')
                and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')) then
    raise exception '[170000] portal_credentials must not be writable by anon / authenticated';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'portal_credentials'
                and grantee = 'anon') then
    raise exception '[170000] portal_credentials must not be readable by anon';
  end if;
  raise notice '[170000] portal key backfilled (% row(s)); job delete keeps OSHA records', v_creds;
end
$mig$;
