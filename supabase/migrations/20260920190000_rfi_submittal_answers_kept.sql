-- 20260920190000_rfi_submittal_answers_kept.sql — wave 4, lane rfi-core
--
-- What this fixes (audit 2026-09-19, findings #25 #26 #27 #92):
--
--   #25  He typed "use 2x10" offline on a copy read before the architect's
--        reply-link answer. The queued patch synced after the answer, and the
--        stale-write guard (20260919080000 §1) refused only an EMPTY response —
--        so his paraphrase replaced the architect's written answer and his
--        device time replaced its date. §1: in the stale branch, a reply-link
--        answer the writer never saw (its 'Response via portal' handoff is
--        missing from his copy) is not replaced by a different one; the answer
--        and its date stay, and his text is kept as a dated handoff note
--        'GC note (not saved over the architect answer): …' — neither is lost.
--        His own correction of his own answer (a second offline save, stale
--        stamp, no portal answer in between) still lands, as before.
--   #26  A cycle he logged offline ("Cycle 2 · Sent 9/15 · In review") synced
--        after the reviewer's reply-link verdict. The reply link had appended
--        Cycle 2 with sentDate NULL (it can't know the send day), the guard's
--        identity (cycleNumber + sentDate) did not match, and his cycle landed
--        as a phantom open Cycle 3 that flipped Approved back to In review.
--        §2: an open writer cycle (in_review, no returnDate, a sentDate) whose
--        ORIGINAL number equals a server cycle with a NULL sentDate is the same
--        round — it fills that cycle's sentDate (and reviewer / comments only
--        where the server's are empty) instead of appending, and
--        current_status stays the server's.
--   #27  "Close Cycle 2 → Approved" on a cycle the reviewer had already closed
--        through the reply link fell through to an APPEND: the round was
--        logged twice and his hand-typed stamp replaced the architect's.
--        §3: closesOpenCycle with nothing open answers
--        {success:false, error:'already_closed', cycle_number, status} and
--        writes nothing (CONTRACT 16; the client branch is ProjectContext's).
--   #92  A second answer through the same reply link replaced the first —
--        even on an RFI the GC had closed and built to — while the page
--        promised "the contractor will see all of them". §4: a closed / void
--        RFI refuses with {success:false, error:'rfi_closed'} before anything
--        is written (no rfis update, no pro_responses row, so no push); an
--        answer to an RFI that already has one is APPENDED under a dated,
--        named separator, never written over it. §5: get_rfi_by_token also
--        says is_closed so the page shows a closed banner and no form.
--
-- Same signatures, security and grants as production (read 2026-09-19:
-- the five function bodies match 20260919080000; guard fns execute only for
-- postgres/service_role, submittal_append_review_cycle for authenticated +
-- service_role, submit_pro_response / get_rfi_by_token for anon +
-- authenticated + service_role). CREATE OR REPLACE keeps each ACL; the grants
-- are restated anyway. Idempotent. No trigger changes (the triggers from
-- 20260919080000 call these functions by name). Apply BEFORE the OTA is not
-- required — the client reads error 'already_closed' / 'rfi_closed' only when
-- this is live, and old clients treat both as a generic refusal.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── §1. rfis: the stale-write guard, answer kept (#25) ───────────────────────
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
  v_gc_note text := null;
  v_portal_unseen boolean := false;
begin
  -- Contract rule 3: the writer named the row's current updated_at — it saw
  -- this exact row, so what it sends is deliberate.
  if NEW.updated_at is not distinct from OLD.updated_at then
    return NEW;
  end if;

  v_old_h := case when jsonb_typeof(OLD.handoffs) = 'array' then OLD.handoffs else '[]'::jsonb end;
  v_new_h := case when jsonb_typeof(NEW.handoffs) = 'array' then NEW.handoffs else '[]'::jsonb end;

  if coalesce(btrim(OLD.response), '') <> '' then
    if coalesce(btrim(NEW.response), '') = '' then
      NEW.response := OLD.response;
    elsif btrim(NEW.response) is distinct from btrim(OLD.response) then
      -- #25: the answer on record is kept ONLY when the architect gave it
      -- through the reply link and this writer never saw that: the server
      -- holds a 'Response via portal' / 'Revised answer via portal' handoff
      -- (submit_pro_response writes one on every answer to an RFI that is not
      -- closed) that the writer's copy lacks. Anything else — above all the
      -- GC correcting his OWN answer on a second offline save, which goes out
      -- with a device-clock stamp because the first save's stamp was never
      -- adopted — is his to change, and lands as before this wave.
      select exists (
        select 1 from jsonb_array_elements(v_old_h) o(e)
        where not v_new_h @> jsonb_build_array(o.e)
          and (coalesce(o.e ->> 'note', '') like 'Response via portal%'
               or coalesce(o.e ->> 'note', '') like 'Revised answer via portal%')
      ) into v_portal_unseen;
      if v_portal_unseen then
        -- His text is kept as a handoff note (below), never concatenated into
        -- response, which stays the architect's formal answer — and that
        -- answer keeps its own date: his device time is not when it was given.
        v_gc_note := btrim(NEW.response);
        NEW.response := OLD.response;
        if OLD.date_responded is not null then
          NEW.date_responded := OLD.date_responded;
        end if;
      end if;
    end if;
  end if;
  if OLD.date_responded is not null and NEW.date_responded is null then
    NEW.date_responded := OLD.date_responded;
  end if;
  if OLD.status in ('answered', 'closed') and NEW.status = 'open' then
    NEW.status := OLD.status;
    v_status_kept := true;
  end if;

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

  if v_gc_note is not null then
    -- toParty = where the ball already is, so the note moves nothing: hold
    -- time folds custody from toParty (utils/rfiHoldTime.ts).
    NEW.handoffs := (case when jsonb_typeof(NEW.handoffs) = 'array' then NEW.handoffs else '[]'::jsonb end)
      || jsonb_build_array(jsonb_build_object(
           -- Inlined, not public.mage_iso_now(): this trigger runs as the
           -- writer (authenticated), who has no EXECUTE on that helper.
           'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'fromParty', 'gc',
           'toParty', coalesce(nullif(NEW.ball_in_court, ''), nullif(OLD.ball_in_court, ''), 'gc'),
           'note', 'GC note (not saved over the architect answer): ' || v_gc_note));
  end if;

  return NEW;
end;
$function$;

-- ── §2. submittals: the stale-write guard, one round not two (#26) ───────────
create or replace function public.submittals_answer_guard_fn()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_old_c jsonb;
  v_new_c jsonb;
  v_added jsonb := '[]'::jsonb;
  v_missing boolean;
  v_max int;
  w record;
  v_hit int;
  v_s jsonb;
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

  for w in
    select n.e
    from jsonb_array_elements(v_new_c) with ordinality n(e, i)
    where not exists (
      select 1 from jsonb_array_elements(v_old_c) o(e)
      where (o.e -> 'cycleNumber') is not distinct from (n.e -> 'cycleNumber')
        and (o.e -> 'sentDate') is not distinct from (n.e -> 'sentDate')
    )
    order by n.i
  loop
    v_hit := null;
    -- #26: his open cycle (in review, not returned, sent on a known day) vs a
    -- reply-link cycle of the SAME original number with no sent day (the
    -- portal appended it — verdict or comments-only — when nothing was open on
    -- the server). Same round: fill the send day in place, don't append.
    if coalesce(w.e ->> 'status', '') = 'in_review'
       and coalesce(w.e ->> 'returnDate', '') = ''
       and coalesce(w.e ->> 'sentDate', '') <> ''
       and (w.e ->> 'cycleNumber') ~ '^[0-9]{1,6}$' then
      select max(o.i - 1)::int into v_hit
      from jsonb_array_elements(v_old_c) with ordinality o(e, i)
      where (o.e ->> 'cycleNumber') = (w.e ->> 'cycleNumber')
        and coalesce(o.e ->> 'sentDate', '') = ''
        and not v_new_c @> jsonb_build_array(o.e);
    end if;
    if v_hit is not null then
      v_s := v_old_c -> v_hit;
      v_s := v_s || jsonb_build_object('sentDate', w.e -> 'sentDate');
      if coalesce(btrim(v_s ->> 'reviewer'), '') = '' and coalesce(btrim(w.e ->> 'reviewer'), '') <> '' then
        v_s := v_s || jsonb_build_object('reviewer', w.e -> 'reviewer');
      end if;
      if coalesce(btrim(v_s ->> 'comments'), '') = '' and coalesce(btrim(w.e ->> 'comments'), '') <> '' then
        v_s := v_s || jsonb_build_object('comments', w.e -> 'comments');
      end if;
      v_old_c := jsonb_set(v_old_c, array[v_hit::text], v_s);
    else
      v_added := v_added || jsonb_build_array(
        jsonb_set(w.e, '{cycleNumber}', to_jsonb(v_max + jsonb_array_length(v_added) + 1)));
    end if;
  end loop;

  NEW.review_cycles := v_old_c || v_added;
  -- Only a cycle that is genuinely appended moves the status (#26 c).
  if jsonb_array_length(v_added) > 0 and coalesce(v_added -> -1 ->> 'status', '') <> '' then
    NEW.current_status := v_added -> -1 ->> 'status';
  else
    NEW.current_status := OLD.current_status;
  end if;
  return NEW;
end;
$function$;

-- ── §3. submittal_append_review_cycle: nothing open to close (#27) ───────────
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
  v_open boolean;
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
  v_open := v_last is not null
            and coalesce(v_last ->> 'status', '') = 'in_review'
            and coalesce(v_last ->> 'returnDate', '') = '';
  select coalesce(max((c.e ->> 'cycleNumber')::int), 0) into v_max
    from jsonb_array_elements(v_cycles) c(e)
   where (c.e ->> 'cycleNumber') ~ '^[0-9]{1,6}$';

  if coalesce((p_cycle ->> 'closesOpenCycle')::boolean, false) then
    if not v_open then
      -- #27: the reviewer already returned it (reply link) — appending would
      -- log the round twice and put his hand-typed stamp over theirs.
      return jsonb_build_object(
        'success', false, 'error', 'already_closed',
        'cycle_number', case when (v_last ->> 'cycleNumber') ~ '^[0-9]{1,6}$' then (v_last ->> 'cycleNumber')::int end,
        'status', v_last ->> 'status');
    end if;
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

-- ── §4. submit_pro_response: closed refuses, a second answer appends (#92) ───
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
  v_revision boolean := false;
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
    -- #92: the GC closed (or voided) it and built to the answer on record. The
    -- link still opens, but nothing is written — no rfis update and no
    -- pro_responses row, so no "answered" push either (CONTRACT 16).
    if coalesce(v_rfi.status, '') in ('closed', 'void') then
      return jsonb_build_object('success', false, 'error', 'rfi_closed');
    end if;
    v_revision := coalesce(btrim(v_rfi.response), '') <> '';

    update public.rfis
       set response = case
             -- #92: a second answer is added under a dated, named separator —
             -- the first stays word for word. date_responded stays the first
             -- answer's (turnaround is measured to it); the revision carries
             -- its own date in the separator.
             when v_revision then
               v_rfi.response || E'\n\n— Revised '
                 || to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC'
                 || coalesce(' by ' || v_name, '') || E' —\n' || trim(p_response_body)
             else trim(p_response_body) end,
           date_responded = coalesce(date_responded, v_now),
           status = 'answered',
           ball_in_court = case
             when coalesce(ball_in_court, '') = 'closed' then ball_in_court
             else 'gc' end,
           handoffs = case
             when coalesce(ball_in_court, '') = 'closed' then handoffs
             else (case when jsonb_typeof(handoffs) = 'array' then handoffs else '[]'::jsonb end)
                  || jsonb_build_array(jsonb_build_object(
                       'at', v_now,
                       'fromParty', coalesce(nullif(ball_in_court, ''), 'architect'),
                       'toParty', 'gc',
                       'note', (case when v_revision then 'Revised answer via portal' else 'Response via portal' end)
                               || coalesce(' (' || v_name || ')', '')))
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
         || case when v_sub.id is not null then jsonb_build_object('cycle_number', v_cycle_no) else '{}'::jsonb end
         || case when v_rfi.id is not null then jsonb_build_object('revision', v_revision) else '{}'::jsonb end;
end;
$function$;

grant execute on function public.submit_pro_response(uuid, text, text, text, text, text, text) to anon, authenticated, service_role;

-- ── §5. get_rfi_by_token + is_closed (#92) ───────────────────────────────────
-- 20260919080000 §8's body, plus 'is_closed' — the same rule §4 refuses on —
-- so the reply page shows a closed banner and no form instead of a form whose
-- submit is refused.
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
    'is_closed', coalesce(r.status, '') in ('closed', 'void'),
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
