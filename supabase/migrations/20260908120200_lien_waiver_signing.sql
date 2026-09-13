-- 20260908120200_lien_waiver_signing.sql
--
-- Audit 2026-09-07, worth-doing #23 — the lien-waiver request-and-sign loop.
--
-- THE PROBLEM. `app/lien-waivers.tsx` captured `subEmail` and sent nothing with
-- it. The GC typed the subcontractor's name himself and the row was stored with
-- `role: 'gc'`, which the PDF then rendered as the sub's signature — a
-- contractor signing his own subcontractor's release. Meanwhile
-- `marketing/features/index.html` told the world subs "receive an email and
-- sign digitally", which nothing in the product did.
--
-- WHAT THIS ADDS. Three columns on `lien_waivers` and the two SECURITY DEFINER
-- RPCs the static signing page calls. The client half is already written and
-- degrades honestly without this migration: `requestLienWaiverSignature`
-- returns `not_provisioned` on a 42703/PGRST204 rather than claiming a send
-- (utils/lienWaiverEngine.ts), so applying this is what switches the loop on
-- and nothing before it is broken by its absence.
--
-- THE TOKEN, NOT THE ID, IS WHAT AUTHORISES. A waiver id alone must open
-- nothing — ids appear in logs, in support threads and in a GC's own screen.
-- Both RPCs take `p_access_token` and compare it against the stored column
-- before doing anything, and both raise the same opaque error on every failure
-- so a caller cannot tell "no such waiver" from "wrong token".
--
-- THE DOCUMENT IS SEALED AT REQUEST TIME. `sign_document_html` holds the exact
-- bytes the sub is asked to sign, written when the link is sent. This is what
-- makes the signature mean something: the document cannot later be regenerated
-- differently by a change to the GC's branding, the project address, or the
-- rendering code. The signing page reads THAT column, never a fresh render.
--
-- Modelled on public.portal_submit_co_approval_signed (schema.sql:5034), which
-- is this repo's existing e-signature path: the same token compare, the same
-- consent record, the same left(coalesce(…)) clamps on every text column.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF
-- EXISTS. Reversible: drop the two functions and the three columns; the table
-- and its existing owner policy are untouched.
--
-- Verify after apply:
--   select column_name from information_schema.columns
--     where table_name = 'lien_waivers' and column_name like 'sign_%';
--   -- expect: sign_token, sign_requested_at, sign_document_html, sign_form_meta
--   select proname, prosecdef from pg_proc where proname like 'lien_waiver_%';
--   -- expect prosecdef = true for both
--   -- as anon, a bogus token must RAISE, not return a row:
--   select public.lien_waiver_get_for_signing(
--     '00000000-0000-0000-0000-000000000000'::uuid, 'not-a-real-token');
--   -- expect: lien_waiver_denied

-- ── 1. the three columns ────────────────────────────────────────────────────
alter table public.lien_waivers
  add column if not exists sign_token         text,
  add column if not exists sign_requested_at  timestamptz,
  add column if not exists sign_document_html text,
  -- The form's IDENTITY, sealed with the document: {waiver_title,
  -- statute_citation, state_name}. Sealed rather than derived because the
  -- statutory form table lives in TypeScript (utils/lienWaiverForms.ts), and a
  -- second copy of it in SQL is a second source of truth that drifts — the
  -- exact failure this codebase keeps hitting. It is also the honest choice:
  -- the sub is told which statute the document follows, and that claim must be
  -- the one that was true when the document was sealed, not whatever the table
  -- says on the day they open the link.
  add column if not exists sign_form_meta     jsonb;

-- Unique only where present: most rows never enter the sign loop, and a NULL
-- token must not collide with another NULL token.
create unique index if not exists lien_waivers_sign_token_key
  on public.lien_waivers (sign_token)
  where sign_token is not null;

-- ── 2. read: what the signing page is allowed to see ────────────────────────
-- Returns the SEALED document plus the handful of facts the page renders in its
-- own chrome. Deliberately NOT the whole row: `user_id`, `commitment_id`,
-- `invoice_id` and `notes` are the GC's internal bookkeeping and none of them
-- belong in front of a subcontractor.
create or replace function public.lien_waiver_get_for_signing(
  p_waiver_id    uuid,
  p_access_token text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_w record; v_proj_name text; v_company text;
begin
  if p_access_token is null or length(p_access_token) < 32 then
    raise exception 'lien_waiver_denied';
  end if;

  select * into v_w from public.lien_waivers
    where id = p_waiver_id
      and coalesce(sign_token, '') <> ''
      and sign_token = p_access_token
    limit 1;
  if v_w is null then raise exception 'lien_waiver_denied'; end if;

  select name into v_proj_name from public.projects where id = v_w.project_id limit 1;
  -- The GC's company name, for "X is asking you to sign this". Read from the
  -- OWNER's profile rather than passed in, so the page cannot be made to
  -- display a name the account does not actually have.
  select company_name into v_company from public.profiles where id = v_w.user_id limit 1;

  return jsonb_build_object(
    'ok', true,
    'id',              v_w.id,
    'status',          v_w.status,
    'signed_at',       v_w.signed_at,
    'sub_name',        v_w.sub_name,
    'paid_amount',     v_w.paid_amount,
    'through_date',    v_w.through_date,
    'waiver_type',     v_w.waiver_type,
    'project_name',    coalesce(v_proj_name, ''),
    'company_name',    coalesce(v_company, ''),
    -- Sealed form identity. The signing page renders these three in its own
    -- chrome (title, and a "<state> statutory form · <citation>" eyebrow);
    -- absent, it falls back to a bare "Lien waiver" with no citation, which
    -- would under-state a document whose whole point is that it follows a
    -- specific statute.
    'waiver_title',     coalesce(v_w.sign_form_meta->>'waiver_title', ''),
    'statute_citation', coalesce(v_w.sign_form_meta->>'statute_citation', ''),
    'state_name',       coalesce(v_w.sign_form_meta->>'state_name', ''),
    -- The sealed bytes. The page renders THIS, never a fresh build.
    'document_html',   coalesce(v_w.sign_document_html, '')
  );
end; $function$;

-- ── 3. write: the one narrow signature the token buys ───────────────────────
create or replace function public.lien_waiver_submit_signature(
  p_waiver_id       uuid,
  p_access_token    text,
  p_signer_name     text,
  p_signer_title    text,
  p_signature_paths text,
  p_consent_record  text,
  p_consent_version text,
  p_consent_accepted boolean,
  p_user_agent      text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_w record; v_now timestamptz := now();
begin
  if p_access_token is null or length(p_access_token) < 32 then
    raise exception 'lien_waiver_denied';
  end if;
  -- E-SIGN: an unchecked consent box is not a signature. Refusing here rather
  -- than storing an unconsented row keeps the table free of signatures whose
  -- enforceability the product would have to argue about later.
  if p_consent_accepted is not true then
    raise exception 'lien_waiver_consent_required';
  end if;
  if p_signer_name is null or length(trim(p_signer_name)) = 0 then
    raise exception 'lien_waiver_signer_required';
  end if;

  -- Lock the row for the transaction. Without it a double submit — a sub
  -- tapping Sign twice on a slow connection — races the already-signed check
  -- below and overwrites the first signature's timestamp and consent record.
  select * into v_w from public.lien_waivers
    where id = p_waiver_id
      and coalesce(sign_token, '') <> ''
      and sign_token = p_access_token
    limit 1
    for update;
  if v_w is null then raise exception 'lien_waiver_denied'; end if;

  -- Already signed is a SUCCESS for an idempotent retry and a refusal for a
  -- different signer. Either way the stored signature is never replaced: the
  -- first one is the one that was made against the sealed document.
  if v_w.signed_at is not null then
    return jsonb_build_object('ok', true, 'already_signed', true, 'signed_at', v_w.signed_at);
  end if;

  update public.lien_waivers
     set sub_signature = jsonb_build_object(
           'name',            left(trim(p_signer_name), 200),
           'title',           left(coalesce(p_signer_title, ''), 120),
           -- 'sub' — the subcontractor signed this themselves. The GC-recorded
           -- paper path writes 'gc' from the app and never reaches here. The
           -- two are different legal facts and the PDF renders them
           -- differently (utils/lienWaiverDocument.ts).
           'role',            'sub',
           'signedAt',        v_now,
           'signaturePaths',  left(coalesce(p_signature_paths, ''), 200000),
           'consentRecord',   left(coalesce(p_consent_record, ''), 4000),
           'consentVersion',  left(coalesce(p_consent_version, ''), 64),
           'consentAccepted', true,
           'userAgent',       left(coalesce(p_user_agent, ''), 500)
         ),
         signed_at  = v_now,
         status     = 'signed',
         updated_at = v_now
   where id = v_w.id;

  return jsonb_build_object('ok', true, 'already_signed', false, 'signed_at', v_now);
end; $function$;

-- ── 4. grants ───────────────────────────────────────────────────────────────
-- The subcontractor holds no session, so these must be reachable by `anon`.
-- Both are SECURITY DEFINER and both begin by trading a >= 32-char token for a
-- single row; neither trusts an id from the caller on its own. `lien_waivers`
-- keeps its existing owner-only RLS untouched — the RPCs run as their owner,
-- which is the whole reason a table nobody but the GC can read can still accept
-- one narrow write from someone with no account.
revoke all on function public.lien_waiver_get_for_signing(uuid, text) from public;
revoke all on function public.lien_waiver_submit_signature(uuid, text, text, text, text, text, text, boolean, text) from public;
grant execute on function public.lien_waiver_get_for_signing(uuid, text) to anon, authenticated;
grant execute on function public.lien_waiver_submit_signature(uuid, text, text, text, text, text, text, boolean, text) to anon, authenticated;
