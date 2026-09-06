-- ============================================================================
-- Architect / pro reply links: the two lookup RPCs select a column that does
-- not exist, so every "reply via portal" link ever emailed has failed.
--
-- Audit ID: CONTRACT-F1 (P1, confirmed by live probe:
--   ERROR 42703: column prof.full_name does not exist
--   CONTEXT: PL/pgSQL function get_rfi_by_token(uuid) line 9).
--
-- WHY. marketing/architect/index.html calls get_rfi_by_token /
-- get_submittal_by_token with the anon key (the architect has no account).
-- Both bodies build `'company_name', COALESCE(prof.full_name, 'MAGE ID')`.
-- profiles has no full_name column — it has name, contact_name and
-- company_name (verified live 2026-09-04) — so the SELECT raises before a
-- single row is returned, the page renders "Could not load this document."
-- and no architect can ever answer an RFI or review a submittal. Neither
-- function exists in any file under supabase/migrations; they lived only in
-- production, which is why the column drift was never caught.
--
-- THE FIX. Both bodies reproduced EXACTLY from supabase/schema.sql
-- (:4424-4463 and :4484-4519) with ONE expression changed:
--     COALESCE(prof.full_name, 'MAGE ID')
--  →  COALESCE(NULLIF(btrim(prof.company_name), ''),
--              NULLIF(btrim(prof.contact_name), ''),
--              NULLIF(btrim(prof.name), ''),
--              'MAGE ID')
-- NULLIF is deliberate: company_name and contact_name DEFAULT '' (not NULL),
-- so a bare COALESCE would return an empty string for every profile that has
-- not filled the field in, and the architect page would show a blank header
-- instead of the fallback.
--
-- GRANTS. CREATE OR REPLACE keeps the existing ACL ("the ownership and
-- permissions of the function are not changed" — Postgres docs), so the
-- anon/authenticated grants survive this file. They are re-granted explicitly
-- anyway: after 20260904100200 the default no longer hands them out, and an
-- explicit grant is the only thing that makes the intent survive a future
-- DROP + CREATE.
--
-- Idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_rfi_by_token(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('error', 'Missing token');
  END IF;

  SELECT jsonb_build_object(
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
    'company_name', COALESCE(
      NULLIF(btrim(prof.company_name), ''),
      NULLIF(btrim(prof.contact_name), ''),
      NULLIF(btrim(prof.name), ''),
      'MAGE ID'),
    'company_email', prof.email,
    'has_existing_response', (r.response IS NOT NULL AND length(trim(r.response)) > 0)
  )
  INTO v_result
  FROM public.rfis r
  LEFT JOIN public.projects p ON p.id = r.project_id
  LEFT JOIN public.profiles prof ON prof.id = r.user_id
  WHERE r.share_token = p_token
  LIMIT 1;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('error', 'Invalid or expired link');
  END IF;
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_submittal_by_token(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('error', 'Missing token');
  END IF;

  SELECT jsonb_build_object(
    'id', s.id,
    'number', s.number,
    'title', s.title,
    'spec_section', s.spec_section,
    'submitted_by', s.submitted_by,
    'submitted_date', s.submitted_date,
    'required_date', s.required_date,
    'review_cycles', s.review_cycles,
    'current_status', s.current_status,
    'attachments', s.attachments,
    'project_name', p.name,
    'project_location', p.location,
    -- CONTRACT-F1: profiles has no full_name column.
    'company_name', COALESCE(
      NULLIF(btrim(prof.company_name), ''),
      NULLIF(btrim(prof.contact_name), ''),
      NULLIF(btrim(prof.name), ''),
      'MAGE ID'),
    'company_email', prof.email
  )
  INTO v_result
  FROM public.submittals s
  LEFT JOIN public.projects p ON p.id = s.project_id
  LEFT JOIN public.profiles prof ON prof.id = s.user_id
  WHERE s.share_token = p_token
  LIMIT 1;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('error', 'Invalid or expired link');
  END IF;
  RETURN v_result;
END;
$fn$;

revoke execute on function public.get_rfi_by_token(uuid)       from public;
revoke execute on function public.get_submittal_by_token(uuid) from public;
grant  execute on function public.get_rfi_by_token(uuid)       to anon, authenticated, service_role;
grant  execute on function public.get_submittal_by_token(uuid) to anon, authenticated, service_role;

-- Post-condition: the pure-SELECT probe that failed in the audit must now run.
-- A random uuid matches nothing, so the answer is the "Invalid or expired
-- link" object — the point is that it ANSWERS instead of raising 42703.
do $mig$
declare r jsonb;
begin
  r := public.get_rfi_by_token('00000000-0000-0000-0000-000000000000'::uuid);
  if r is null or r->>'error' is null then
    raise exception '[100600] get_rfi_by_token did not return the not-found object: %', r;
  end if;
  r := public.get_submittal_by_token('00000000-0000-0000-0000-000000000000'::uuid);
  if r is null or r->>'error' is null then
    raise exception '[100600] get_submittal_by_token did not return the not-found object: %', r;
  end if;
  if not has_function_privilege('anon', 'public.get_rfi_by_token(uuid)', 'EXECUTE') then
    raise exception '[100600] anon lost EXECUTE on get_rfi_by_token — the architect page would break';
  end if;
  raise notice '[100600] architect reply RPCs execute again';
end
$mig$;
