-- 20260919080000_rfi_submittal_integrity.sql — wave 3, lane rfi-core
--
-- What this fixes (audit 2026-09-18, findings #55 #56 #77 #147 #148):
--
--   #55  The architect answers RFI #4 through mageid.app/architect at 10am. The
--        GC's phone still holds the 7am copy (no realtime, no foreground refetch
--        for rfis). He opens the RFI to link a task and taps Update: the app
--        writes the WHOLE row from its stale copy — response NULL, status
--        'open', date_responded NULL — and the architect's answer is gone.
--        Submittals lose the architect's 'Approved as Noted' cycle the same way
--        (the app rewrites review_cycles + current_status from its copy).
--        §1/§2: a BEFORE UPDATE guard that refuses those regressions.
--   #56  The reply portal promised the GC a notification that nothing sent, and
--        an answered RFI kept 'Ball in court: Architect'. §5 hands the ball back
--        and appends the handoff; §6 raises notify 'pro_response_received'.
--   #147 A portal answer APPENDED a second cycle (sent = returned = now())
--        instead of closing the in_review cycle 'Send to Reviewer' opened; a
--        NULL action code wrote a 'returned' in_review cycle. §5 closes the open
--        cycle in place (keeping its sentDate); §7 is the append-only RPC the app
--        uses for its own cycles, numbered on the server.
--   #148 Two devices (the GC's offline phone + the web app, or a foreman) each
--        created 'RFI #7'. §3 numbers every insert on the server under a
--        per-project lock and ignores the client's guess; §4 adds the unique
--        (project_id, number) index as a backstop only after that.
--   #77  §8: get_rfi_by_token also returns the drawing pins linked to the RFI,
--        so the reply page can circle the marked location on the attached sheet.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CLIENT WRITE CONTRACT (context-integrator's patch-only updateRFI /
-- updateSubmittal MUST match this; app/rfi.tsx + app/submittal.tsx already send
-- only the fields he changed):
--
--   1. A client UPDATE of rfis / submittals that names any GUARDED column MUST
--      also name updated_at. Guarded columns:
--        rfis:       response, date_responded, status, ball_in_court, handoffs
--        submittals: review_cycles, current_status
--   2. updated_at = anything other than the row's CURRENT server value (the
--      normal case: the client's now()) → the write is treated as possibly
--      stale and the guard applies:
--        rfis   • a non-empty response is never replaced by NULL / ''
--               • a non-null date_responded is never replaced by NULL
--               • status never moves answered/closed → open
--               • handoffs are append-only: every entry the server has is kept,
--                 entries the writer added are appended after them
--               • if the writer had not seen the server's latest handoff (or its
--                 status regression was refused), ball_in_court follows the
--                 server (or the writer's own newest appended handoff)
--        submittals
--               • review_cycles are append-only: every cycle the server has is
--                 kept as the server has it; a cycle the writer added (identity
--                 = cycleNumber + sentDate not on the server) is appended and
--                 renumbered after the server's highest cycleNumber
--               • current_status follows the server unless the writer appended
--                 a cycle, in which case it is that cycle's status
--      Every other column in the write lands as sent. Nothing raises: a stale
--      write is coerced, never refused, so utils/offlineQueue never sees a
--      terminal error or an immortal retry from this guard.
--   3. updated_at = the row's CURRENT server value (the updated_at the form was
--      loaded with, straight from the server read) → a deliberate edit by
--      someone who saw the current row: the guard steps aside, so a GC can
--      reopen an answered RFI or clear a response on purpose. update_updated_at
--      still stamps now() afterwards (this guard sorts before it: 'rfis_answer…'
--      < 'rfis_updated_at').
--   4. An UPDATE that does not name updated_at at all leaves NEW.updated_at =
--      OLD.updated_at and is therefore treated as (3). That is why rule 1 says a
--      write naming a guarded column MUST name updated_at; a write that names no
--      guarded column cannot regress one and needs nothing.
--   5. INSERTs: `number` is assigned by the server (§3) — whatever the client
--      sends is ignored. The client must show the record as '(pending #)' until
--      it has read the server's number back (app/rfi.tsx does; the refetch that
--      adopts it into the provider is context-integrator's #55 carry).
--   6. New submittal review cycles go through
--        submittal_append_review_cycle(p_submittal_id uuid, p_cycle jsonb)
--      (§7), never by writing review_cycles. p_cycle is a SubmittalReviewCycle
--      without cycleNumber: { reviewer, status, sentDate?, returnDate?,
--      comments?, closesOpenCycle? }. It returns { success, cycle_number } or
--      { success:false, error }.
--
-- Production facts read before writing this (read-only, 2026-09-18):
--   rfis 3 rows / submittals 2 rows; 0 duplicate (project_id, number) pairs in
--   either; 0 pro_responses; 0 submittals carrying the open-cycle + same-second
--   duplicate pair #147 describes (nothing to repair). Only triggers on the two
--   tables: rfis_updated_at / submittals_updated_at (update_updated_at).
--   rfis.handoffs jsonb and rfis.ball_in_court text exist. submit_pro_response,
--   get_rfi_by_token and get_submittal_by_token exist only in production and
--   supabase/schema.sql — §5 and §8 restate them in full. app_config.notify_url
--   is set, so fire_notify reaches notify.
--
-- Idempotent: every statement is CREATE OR REPLACE / DROP … IF EXISTS / IF NOT
-- EXISTS; the §4 renumber is a no-op when there are no duplicates.
-- Apply BEFORE the OTA. No edge function changes (notify already carries the
-- pro_response_received case and route — invoice-send-pay, wave 3).
-- ─────────────────────────────────────────────────────────────────────────────

-- ISO-8601 UTC with milliseconds, the shape JavaScript's toISOString() writes.
-- now()::text ('2026-09-18 12:00:00.123+00') is NOT reliably parsed by Hermes'
-- Date, so a portal-written returnDate rendered 'Invalid Date' on iPhone.
create or replace function public.mage_iso_now()
returns text
language sql
stable
set search_path to ''
as $$ select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;
revoke execute on function public.mage_iso_now() from public, anon, authenticated;

-- ── §1. rfis: the stale-write guard (#55) ────────────────────────────────────
create or replace function public.rfis_answer_guard_fn()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_old_h jsonb;
  v_new_h jsonb;
  v_added jsonb;
  v_missing boolean;
  v_status_kept boolean := false;
begin
  -- Contract rule 3: the writer named the row's current updated_at — it saw
  -- this exact row, so what it sends is deliberate.
  if NEW.updated_at is not distinct from OLD.updated_at then
    return NEW;
  end if;

  if coalesce(btrim(OLD.response), '') <> '' and coalesce(btrim(NEW.response), '') = '' then
    NEW.response := OLD.response;
  end if;
  if OLD.date_responded is not null and NEW.date_responded is null then
    NEW.date_responded := OLD.date_responded;
  end if;
  if OLD.status in ('answered', 'closed') and NEW.status = 'open' then
    NEW.status := OLD.status;
    v_status_kept := true;
  end if;

  v_old_h := case when jsonb_typeof(OLD.handoffs) = 'array' then OLD.handoffs else '[]'::jsonb end;
  v_new_h := case when jsonb_typeof(NEW.handoffs) = 'array' then NEW.handoffs else '[]'::jsonb end;
  select exists (
    select 1 from jsonb_array_elements(v_old_h) o(e)
    where not v_new_h @> jsonb_build_array(o.e)
  ) into v_missing;

  if v_missing then
    -- The writer never saw at least one handoff the server holds (e.g. the
    -- portal's 'Response via portal'). Keep the server's chain, append only
    -- what the writer genuinely added, and let the ball follow the chain.
    select coalesce(jsonb_agg(n.e order by n.i), '[]'::jsonb) into v_added
    from jsonb_array_elements(v_new_h) with ordinality n(e, i)
    where not v_old_h @> jsonb_build_array(n.e);
    NEW.handoffs := v_old_h || v_added;
    if jsonb_array_length(v_added) > 0 and coalesce(v_added -> -1 ->> 'toParty', '') <> '' then
      NEW.ball_in_court := v_added -> -1 ->> 'toParty';
    else
      NEW.ball_in_court := OLD.ball_in_court;
    end if;
  elsif v_status_kept then
    NEW.ball_in_court := OLD.ball_in_court;
  end if;

  return NEW;
end;
$function$;

drop trigger if exists rfis_answer_guard on public.rfis;
-- Name sorts BEFORE rfis_updated_at (same-event triggers fire alphabetically),
-- so this still sees the updated_at the client sent, not now().
create trigger rfis_answer_guard
  before update on public.rfis
  for each row execute function public.rfis_answer_guard_fn();

-- ── §2. submittals: the stale-write guard (#55) ──────────────────────────────
create or replace function public.submittals_answer_guard_fn()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_old_c jsonb;
  v_new_c jsonb;
  v_added jsonb;
  v_missing boolean;
  v_max int;
begin
  if NEW.updated_at is not distinct from OLD.updated_at then
    return NEW;
  end if;

  v_old_c := case when jsonb_typeof(OLD.review_cycles) = 'array' then OLD.review_cycles else '[]'::jsonb end;
  v_new_c := case when jsonb_typeof(NEW.review_cycles) = 'array' then NEW.review_cycles else '[]'::jsonb end;
  select exists (
    select 1 from jsonb_array_elements(v_old_c) o(e)
    where not v_new_c @> jsonb_build_array(o.e)
  ) into v_missing;
  if not v_missing then
    return NEW;
  end if;

  -- Stale writer. A cycle is "the same cycle" when cycleNumber AND sentDate
  -- match: the portal closes a cycle in place and keeps its sentDate, so the
  -- writer's older copy of it is recognised and dropped (the server's wins),
  -- while a cycle the writer really added has a sentDate the server lacks.
  select coalesce(max((o.e ->> 'cycleNumber')::int), 0) into v_max
  from jsonb_array_elements(v_old_c) o(e)
  where (o.e ->> 'cycleNumber') ~ '^[0-9]{1,6}$';

  select coalesce(jsonb_agg(jsonb_set(a.e, '{cycleNumber}', to_jsonb(v_max + a.rn)) order by a.rn), '[]'::jsonb)
    into v_added
  from (
    select n.e, (row_number() over (order by n.i))::int as rn
    from jsonb_array_elements(v_new_c) with ordinality n(e, i)
    where not exists (
      select 1 from jsonb_array_elements(v_old_c) o(e)
      where (o.e -> 'cycleNumber') is not distinct from (n.e -> 'cycleNumber')
        and (o.e -> 'sentDate') is not distinct from (n.e -> 'sentDate')
    )
  ) a;

  NEW.review_cycles := v_old_c || v_added;
  if jsonb_array_length(v_added) > 0 and coalesce(v_added -> -1 ->> 'status', '') <> '' then
    NEW.current_status := v_added -> -1 ->> 'status';
  else
    NEW.current_status := OLD.current_status;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists submittals_answer_guard on public.submittals;
create trigger submittals_answer_guard
  before update on public.submittals
  for each row execute function public.submittals_answer_guard_fn();

-- ── §3. Server-assigned numbers (#148) ───────────────────────────────────────
-- SECURITY DEFINER: the max must see every row of the project, including rows
-- a field collaborator's RLS would hide from him. The lock is per (table,
-- project), so two inserts on the same job serialize and never share a number.
create or replace function public.rfis_assign_number_fn()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform pg_advisory_xact_lock(hashtext('rfis'), hashtext(NEW.project_id::text));
  select coalesce(max(r.number), 0) + 1 into NEW.number
  from public.rfis r where r.project_id = NEW.project_id;
  return NEW;
end;
$function$;

create or replace function public.submittals_assign_number_fn()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform pg_advisory_xact_lock(hashtext('submittals'), hashtext(NEW.project_id::text));
  select coalesce(max(s.number), 0) + 1 into NEW.number
  from public.submittals s where s.project_id = NEW.project_id;
  return NEW;
end;
$function$;

revoke execute on function public.rfis_assign_number_fn() from public, anon, authenticated;
revoke execute on function public.submittals_assign_number_fn() from public, anon, authenticated;

drop trigger if exists rfis_assign_number on public.rfis;
create trigger rfis_assign_number
  before insert on public.rfis
  for each row execute function public.rfis_assign_number_fn();

drop trigger if exists submittals_assign_number on public.submittals;
create trigger submittals_assign_number
  before insert on public.submittals
  for each row execute function public.submittals_assign_number_fn();

-- ── §4. Unique (project_id, number) — the backstop, after §3 ─────────────────
-- Production has 0 duplicates today. Any that exist where this runs are
-- renumbered deterministically: the oldest (created_at, id) keeps its number,
-- each later one moves to the project's next free number.
do $renumber$
declare
  r record;
begin
  for r in
    select id, project_id from (
      select id, project_id,
             row_number() over (partition by project_id, number order by created_at nulls last, id) as rn
      from public.rfis
    ) d where d.rn > 1 order by project_id, id
  loop
    update public.rfis
       set number = (select coalesce(max(x.number), 0) + 1 from public.rfis x where x.project_id = r.project_id)
     where id = r.id;
  end loop;
  for r in
    select id, project_id from (
      select id, project_id,
             row_number() over (partition by project_id, number order by created_at nulls last, id) as rn
      from public.submittals
    ) d where d.rn > 1 order by project_id, id
  loop
    update public.submittals
       set number = (select coalesce(max(x.number), 0) + 1 from public.submittals x where x.project_id = r.project_id)
     where id = r.id;
  end loop;
end
$renumber$;

create unique index if not exists rfis_project_number_key on public.rfis (project_id, number);
create unique index if not exists submittals_project_number_key on public.submittals (project_id, number);

-- ── §5. submit_pro_response (#56, #147) ──────────────────────────────────────
-- Same signature, grants and return shape as production. Changes:
--   • the parent row is locked (FOR UPDATE) before it is read and written;
--   • RFI: ball back to the GC with an RFIHandoff-shaped entry, unless the RFI
--     is closed/void (never reopened);
--   • submittal: an action code CLOSES the open in_review cycle in place
--     (keeping its sentDate); a new cycle is appended only when none is open,
--     with sentDate NULL (the GC's send date is unknown, not now()); a NULL
--     action code records the comments and closes nothing;
--   • the parent is written first, then pro_responses — whose AFTER INSERT
--     trigger (§6) raises the notification with the row already updated.
create or replace function public.submit_pro_response(
  p_token uuid, p_doc_type text, p_responder_name text, p_responder_email text,
  p_responder_role text, p_response_body text, p_action_code text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rfi public.rfis%rowtype;
  v_sub public.submittals%rowtype;
  v_response_id uuid;
  v_now text := public.mage_iso_now();
  v_name text := nullif(trim(p_responder_name), '');
  v_code text := nullif(trim(coalesce(p_action_code, '')), '');
  v_cycles jsonb;
  v_len int;
  v_last jsonb;
  v_open boolean;
  v_max int;
  v_cycle_no int;
  v_reviewer text;
begin
  if p_token is null then
    return jsonb_build_object('success', false, 'error', 'Missing token');
  end if;
  if p_response_body is null or length(trim(p_response_body)) < 2 then
    return jsonb_build_object('success', false, 'error', 'Response is too short');
  end if;

  if p_doc_type = 'rfi' then
    select * into v_rfi from public.rfis where share_token = p_token limit 1 for update;
    if v_rfi.id is null then
      return jsonb_build_object('success', false, 'error', 'Invalid or expired link');
    end if;

    update public.rfis
       set response = trim(p_response_body),
           date_responded = coalesce(date_responded, v_now),
           status = case when status in ('closed', 'void') then status else 'answered' end,
           ball_in_court = case
             when coalesce(ball_in_court, '') = 'closed' or status in ('closed', 'void') then ball_in_court
             else 'gc' end,
           handoffs = case
             when coalesce(ball_in_court, '') = 'closed' or status in ('closed', 'void') then handoffs
             else (case when jsonb_typeof(handoffs) = 'array' then handoffs else '[]'::jsonb end)
                  || jsonb_build_array(jsonb_build_object(
                       'at', v_now,
                       'fromParty', coalesce(nullif(ball_in_court, ''), 'architect'),
                       'toParty', 'gc',
                       'note', 'Response via portal' || coalesce(' (' || v_name || ')', '')))
             end
     where id = v_rfi.id;

  elsif p_doc_type = 'submittal' then
    select * into v_sub from public.submittals where share_token = p_token limit 1 for update;
    if v_sub.id is null then
      return jsonb_build_object('success', false, 'error', 'Invalid or expired link');
    end if;
    -- 'in_review' is not a verdict: it is accepted (older pages sent it) and
    -- treated as no code — comments only.
    if v_code is not null and v_code not in ('approved', 'approved_as_noted', 'revise_resubmit', 'rejected', 'in_review') then
      return jsonb_build_object('success', false, 'error', 'Invalid action code');
    end if;
    if v_code = 'in_review' then v_code := null; end if;

    v_cycles := case when jsonb_typeof(v_sub.review_cycles) = 'array' then v_sub.review_cycles else '[]'::jsonb end;
    v_len := jsonb_array_length(v_cycles);
    v_last := case when v_len > 0 then v_cycles -> (v_len - 1) else null end;
    v_open := v_last is not null
              and coalesce(v_last ->> 'status', '') = 'in_review'
              and coalesce(v_last ->> 'returnDate', '') = '';
    select coalesce(max((c.e ->> 'cycleNumber')::int), 0) into v_max
      from jsonb_array_elements(v_cycles) c(e)
     where (c.e ->> 'cycleNumber') ~ '^[0-9]{1,6}$';
    v_reviewer := coalesce(v_name, nullif(trim(p_responder_email), ''), nullif(v_last ->> 'reviewer', ''), 'External reviewer');

    if v_open then
      v_cycle_no := coalesce(case when (v_last ->> 'cycleNumber') ~ '^[0-9]{1,6}$' then (v_last ->> 'cycleNumber')::int end, v_len);
      if v_code is null then
        -- Comments without a verdict: recorded on the open cycle, which stays open.
        v_last := v_last || jsonb_build_object(
          'comments', coalesce(nullif(v_last ->> 'comments', '') || E'\n\n', '') || trim(p_response_body));
      else
        v_last := v_last || jsonb_build_object(
          'returnDate', v_now, 'status', v_code, 'comments', trim(p_response_body),
          'reviewer', coalesce(v_name, nullif(v_last ->> 'reviewer', ''), v_reviewer));
      end if;
      v_cycles := jsonb_set(v_cycles, array[(v_len - 1)::text], v_last);
    else
      v_cycle_no := v_max + 1;
      v_cycles := v_cycles || jsonb_build_array(
        case when v_code is null then
          -- No verdict and nothing open: the reviewer has it in review.
          jsonb_build_object('cycleNumber', v_cycle_no, 'sentDate', null, 'reviewer', v_reviewer,
                             'status', 'in_review', 'comments', trim(p_response_body))
        else
          jsonb_build_object('cycleNumber', v_cycle_no, 'sentDate', null, 'returnDate', v_now,
                             'reviewer', v_reviewer, 'status', v_code, 'comments', trim(p_response_body))
        end);
    end if;

    update public.submittals
       set review_cycles = v_cycles,
           current_status = coalesce(v_code, current_status)
     where id = v_sub.id;
  else
    return jsonb_build_object('success', false, 'error', 'Invalid doc type');
  end if;

  insert into public.pro_responses (
    rfi_id, submittal_id, share_token,
    responder_name, responder_email, responder_role,
    response_body, action_code
  ) values (
    v_rfi.id, v_sub.id, p_token,
    v_name,
    nullif(trim(p_responder_email), ''),
    nullif(trim(p_responder_role), ''),
    trim(p_response_body),
    v_code
  )
  returning id into v_response_id;

  return jsonb_build_object('success', true, 'response_id', v_response_id)
         || case when v_sub.id is not null then jsonb_build_object('cycle_number', v_cycle_no) else '{}'::jsonb end;
end;
$function$;

grant execute on function public.submit_pro_response(uuid, text, text, text, text, text, text) to anon, authenticated, service_role;

-- ── §6. The GC hears about it (#56) ──────────────────────────────────────────
-- fire_notify only runs from a trigger (pg_trigger_depth() > 0) — that is the
-- point: the event is SERVICE-ONLY in notify, raised with the cron secret.
-- Payload is the cross-chain contract: {project_id, kind, item_id, number,
-- responder_name, action_code}; notify resolves the project owner from
-- project_id and routes /rfi or /submittal (routes.ts, invoice-send-pay).
create or replace function public.trg_notify_pro_response()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_project uuid;
  v_number int;
  v_kind text;
  v_item uuid;
begin
  if NEW.rfi_id is not null then
    select r.project_id, r.number into v_project, v_number from public.rfis r where r.id = NEW.rfi_id;
    v_kind := 'rfi'; v_item := NEW.rfi_id;
  elsif NEW.submittal_id is not null then
    select s.project_id, s.number into v_project, v_number from public.submittals s where s.id = NEW.submittal_id;
    v_kind := 'submittal'; v_item := NEW.submittal_id;
  end if;
  if v_project is null then
    return NEW;
  end if;
  perform public.fire_notify(
    'pro_response_received',
    'pro_responses',
    NEW.id::text,
    jsonb_build_object(
      'project_id', v_project,
      'kind', v_kind,
      'item_id', v_item,
      'number', v_number,
      'responder_name', NEW.responder_name,
      'action_code', NEW.action_code
    )
  );
  return NEW;
end;
$function$;

revoke execute on function public.trg_notify_pro_response() from public, anon, authenticated;

drop trigger if exists notify_pro_response on public.pro_responses;
create trigger notify_pro_response
  after insert on public.pro_responses
  for each row execute function public.trg_notify_pro_response();

-- ── §7. submittal_append_review_cycle (#55 c, #147) ──────────────────────────
-- SECURITY INVOKER: the caller's RLS decides (submittals_collab_update needs a
-- field seat or better). Appends under a row lock with the number computed
-- here, so two devices never both write 'Cycle 2' and neither overwrites a
-- cycle the portal closed. closesOpenCycle:true fills the open in_review cycle
-- in place (returnDate/status/comments/reviewer, sentDate kept) instead.
create or replace function public.submittal_append_review_cycle(p_submittal_id uuid, p_cycle jsonb)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_cycles jsonb;
  v_found boolean := false;
  v_len int;
  v_last jsonb;
  v_status text := p_cycle ->> 'status';
  v_max int;
  v_no int;
  v_entry jsonb;
begin
  if p_submittal_id is null or jsonb_typeof(p_cycle) is distinct from 'object' then
    return jsonb_build_object('success', false, 'error', 'bad_request');
  end if;
  if v_status is null or v_status not in ('pending', 'in_review', 'approved', 'approved_as_noted', 'revise_resubmit', 'rejected') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  if coalesce(btrim(p_cycle ->> 'reviewer'), '') = '' then
    return jsonb_build_object('success', false, 'error', 'reviewer_required');
  end if;

  select case when jsonb_typeof(s.review_cycles) = 'array' then s.review_cycles else '[]'::jsonb end, true
    into v_cycles, v_found
    from public.submittals s where s.id = p_submittal_id
    for update;
  if not coalesce(v_found, false) then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;

  v_len := jsonb_array_length(v_cycles);
  v_last := case when v_len > 0 then v_cycles -> (v_len - 1) else null end;
  select coalesce(max((c.e ->> 'cycleNumber')::int), 0) into v_max
    from jsonb_array_elements(v_cycles) c(e)
   where (c.e ->> 'cycleNumber') ~ '^[0-9]{1,6}$';

  if coalesce((p_cycle ->> 'closesOpenCycle')::boolean, false)
     and v_last is not null
     and coalesce(v_last ->> 'status', '') = 'in_review'
     and coalesce(v_last ->> 'returnDate', '') = '' then
    v_no := coalesce(case when (v_last ->> 'cycleNumber') ~ '^[0-9]{1,6}$' then (v_last ->> 'cycleNumber')::int end, v_len);
    v_entry := v_last || jsonb_strip_nulls(jsonb_build_object(
      'returnDate', p_cycle -> 'returnDate', 'status', to_jsonb(v_status),
      'comments', p_cycle -> 'comments', 'reviewer', p_cycle -> 'reviewer'));
    v_cycles := jsonb_set(v_cycles, array[(v_len - 1)::text], v_entry);
  else
    v_no := v_max + 1;
    v_entry := (p_cycle - 'closesOpenCycle' - 'cycleNumber') || jsonb_build_object('cycleNumber', v_no);
    v_cycles := v_cycles || jsonb_build_array(v_entry);
  end if;

  update public.submittals
     set review_cycles = v_cycles, current_status = v_status
   where id = p_submittal_id;

  return jsonb_build_object('success', true, 'cycle_number', v_no);
end;
$function$;

revoke execute on function public.submittal_append_review_cycle(uuid, jsonb) from public, anon;
grant execute on function public.submittal_append_review_cycle(uuid, jsonb) to authenticated, service_role;

-- ── §8. get_rfi_by_token + the pin the RFI was raised from (#77) ─────────────
-- Production's body, plus 'pin_marks': the drawing pins linked to this RFI
-- (x/y normalised 0–1 on the sheet image, and the sheet's stored image path),
-- so the reply page can circle the spot on the attached sheet. The path is the
-- same object key the page's signed attachment URL already carries.
create or replace function public.get_rfi_by_token(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
begin
  if p_token is null then
    return jsonb_build_object('error', 'Missing token');
  end if;

  select jsonb_build_object(
    'id', r.id,
    'number', r.number,
    'subject', r.subject,
    'question', r.question,
    'submitted_by', r.submitted_by,
    'assigned_to', r.assigned_to,
    'date_submitted', r.date_submitted,
    'date_required', r.date_required,
    'priority', r.priority,
    'status', r.status,
    'linked_drawing', r.linked_drawing,
    'attachments', r.attachments,
    'project_name', p.name,
    'project_location', p.location,
    -- CONTRACT-F1: profiles has no full_name column.
    'company_name', coalesce(
      nullif(btrim(prof.company_name), ''),
      nullif(btrim(prof.contact_name), ''),
      nullif(btrim(prof.name), ''),
      'MAGE ID'),
    'company_email', prof.email,
    'has_existing_response', (r.response is not null and length(trim(r.response)) > 0),
    'pin_marks', coalesce((
      select jsonb_agg(jsonb_build_object('x', dp.x, 'y', dp.y, 'sheet_path', ps.image_uri) order by dp.created_at)
      from public.drawing_pins dp
      join public.plan_sheets ps on ps.id = dp.plan_sheet_id
      where dp.linked_rfi_id = r.id
        and dp.x between 0 and 1 and dp.y between 0 and 1
    ), '[]'::jsonb)
  )
  into v_result
  from public.rfis r
  left join public.projects p on p.id = r.project_id
  left join public.profiles prof on prof.id = r.user_id
  where r.share_token = p_token
  limit 1;

  if v_result is null then
    return jsonb_build_object('error', 'Invalid or expired link');
  end if;
  return v_result;
end;
$function$;

grant execute on function public.get_rfi_by_token(uuid) to anon, authenticated, service_role;
