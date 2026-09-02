-- ============================================================================
-- Four write-side tenant-isolation leaks. All confirmed against production on
-- 2026-09-02, all reachable with nothing but the anon key that ships inside the
-- app bundle (lib/supabase.ts).
--
-- The common shape in three of the four: a policy or trigger that checks
-- ownership on the way IN but not on the way OUT. USING is evaluated against
-- the OLD row and WITH CHECK against the NEW one, so a WITH CHECK that omits
-- the ownership predicate lets the caller REWRITE the row into another tenant.
-- The row passes on the way in because they legitimately own it, and passes on
-- the way out because nothing re-checks who owns it any more.
--
-- Enumerated exhaustively rather than fixed case by case: a scan of pg_policies
-- for UPDATE/ALL policies whose `qual` references auth.uid() but whose
-- `with_check` does not returned EXACTLY the two below. There is no third
-- instance today; scripts/validate-rls-write-leaks.ts keeps it that way.
-- ============================================================================


-- ── 1. grant_rfp_post_credit is executable by anon ─────────────────────────
--
-- SECURITY DEFINER, and its body inserts into rfp_post_payments and upserts
-- rfp_post_credits for WHATEVER p_user it is handed. It consults no caller
-- identity at all — no auth.uid() comparison, no token, no cron secret.
--
-- Production confirmed has_function_privilege('anon', ..., 'EXECUTE') = true.
-- The anon key is hardcoded in the shipped bundle, so anyone could POST to
-- /rest/v1/rpc/grant_rfp_post_credit and grant themselves unlimited paid RFP
-- post credits — or write payment rows attributed to another user's id.
--
-- The creating migration (20260729161000_rfp_post_idempotent.sql:47-48) already
-- REVOKED this. The revoke did not survive — most likely a later CREATE OR
-- REPLACE re-applied the default PUBLIC EXECUTE grant that Postgres gives every
-- new function. That is exactly why the in-body guard below exists as well: an
-- ACL is a thing that can silently drift back, a RAISE is not.

revoke all on function public.grant_rfp_post_credit(uuid, text, integer)
  from public, anon, authenticated;

-- Defence in depth. If the grant ever reappears, the function still refuses.
-- Only the service role (edge functions, which is where a confirmed payment is
-- actually verified) may call it.
-- Body reproduced EXACTLY from production (schema.sql:4205) with ONE statement
-- added: the caller check. Everything else — the boolean return, the
-- session_id conflict key, the credits / lifetime_purchased columns and the
-- `if not found then return false` early exit that makes a replayed session id
-- idempotent — is unchanged. Rewriting a function body from a description is
-- how you silently break its callers.
create or replace function public.grant_rfp_post_credit(
  p_user uuid, p_session text, p_n integer default 1
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- ADDED: caller check, first statement. Without it this function trusts
  -- p_user completely and anyone holding the anon key can credit any account.
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'grant_rfp_post_credit: forbidden'
      using errcode = '42501';
  end if;

  insert into public.rfp_post_payments (session_id, user_id)
  values (p_session, p_user)
  on conflict (session_id) do nothing;
  if not found then
    return false;
  end if;
  insert into public.rfp_post_credits (user_id, credits, lifetime_purchased, updated_at)
  values (p_user, p_n, p_n, now())
  on conflict (user_id) do update
    set credits = public.rfp_post_credits.credits + excluded.credits,
        lifetime_purchased = public.rfp_post_credits.lifetime_purchased + excluded.credits,
        updated_at = now();
  return true;
end;
$function$;

revoke all on function public.grant_rfp_post_credit(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.grant_rfp_post_credit(uuid, text, integer)
  to service_role;


-- ── 2. An invited editor could steal the whole project ─────────────────────
--
-- projects_update is
--   USING      (auth.uid() = user_id OR is_project_collaborator(id,'editor'))
--   WITH CHECK (auth.uid() = user_id OR is_project_collaborator(id,'editor'))
--
-- An accepted 'editor' collaborator passes USING via the second disjunct, then
-- sets user_id to their own uid — which satisfies the FIRST disjunct of
-- WITH CHECK. The row is now theirs. The original owner loses SELECT (every
-- other policy keys on user_id) and cannot get it back.
--
-- This cannot be fixed in the policy: the owner disjunct is always satisfiable
-- by the very row the attacker is writing. The column has to be frozen.
-- Modelled on the existing crew_freeze_ownership_columns trigger.
--
-- auth.uid() IS NOT NULL guard: service-role and edge-function writes have no
-- JWT, and legitimately need to reassign (ownership transfer, support fixes).

create or replace function public.projects_freeze_ownership_columns()
returns trigger
language plpgsql
as $function$
begin
  if auth.uid() is not null and auth.uid() is distinct from old.user_id then
    -- Not the owner (so: a collaborator). Ownership is not theirs to change.
    -- Silently pinning beats raising: an editor editing a project legitimately
    -- sends the whole row back, and their ordinary edits must keep working.
    --
    -- ONLY user_id is frozen. An earlier draft also pinned `access_token`,
    -- which does not exist on this table — the portal credential lives inside
    -- the client_portal jsonb, and plpgsql is late-bound so that would have
    -- failed at UPDATE time rather than at CREATE time. client_portal is left
    -- writable deliberately: an editor legitimately manages portal invites, and
    -- narrowing it needs its own analysis rather than a guess bundled in here.
    new.user_id := old.user_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists projects_freeze_ownership on public.projects;
create trigger projects_freeze_ownership
  before update on public.projects
  for each row execute function public.projects_freeze_ownership_columns();


-- ── 3. sub_submitted_invoices: WITH CHECK dropped the ownership test ───────
--
-- USING correctly requires the row's sub_portal_id to belong to a portal the
-- caller owns. WITH CHECK was only `status = ANY (...)`, so the NEW row was
-- never re-checked: sub_portal_id, project_id, commitment_id and amount could
-- all be rewritten, pushing a money row into another tenant. This UPDATE is the
-- table's only write policy, so it was the entire write surface.

drop policy if exists "gc updates sub invoices for own portals" on public.sub_submitted_invoices;
create policy "gc updates sub invoices for own portals"
  on public.sub_submitted_invoices
  for update to authenticated
  using (
    exists (
      select 1 from public.sub_portal_links spl
      where spl.id = sub_submitted_invoices.sub_portal_id
        and spl.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.sub_portal_links spl
      where spl.id = sub_submitted_invoices.sub_portal_id
        and spl.user_id = auth.uid()
    )
    and status = any (array['submitted','approved','rejected','paid'])
  );

-- The GC only ever changes status and notes_from_gc from the app, so the
-- identity and money columns are frozen outright. The policy above already
-- blocks cross-tenant moves; this also stops an in-tenant amount rewrite.
create or replace function public.sub_invoice_freeze_columns()
returns trigger
language plpgsql
as $function$
begin
  if auth.uid() is not null then
    new.sub_portal_id := old.sub_portal_id;
    new.project_id    := old.project_id;
    new.commitment_id := old.commitment_id;
    new.amount        := old.amount;
  end if;
  return new;
end;
$function$;

drop trigger if exists sub_submitted_invoices_freeze on public.sub_submitted_invoices;
create trigger sub_submitted_invoices_freeze
  before update on public.sub_submitted_invoices
  for each row execute function public.sub_invoice_freeze_columns();


-- ── 4. portal_budget_proposals: the identical mistake ──────────────────────
--
-- USING requires the proposal's project to be owned by the caller; WITH CHECK
-- was only the status allowlist. project_id could therefore be rewritten to any
-- other tenant's project uuid. The one guard on that column,
-- trg_resolve_portal_project_id, is BEFORE INSERT only and never fires here.

drop policy if exists "gc can update own proposals" on public.portal_budget_proposals;
create policy "gc can update own proposals"
  on public.portal_budget_proposals
  for update to authenticated
  using (
    project_id is not null
    and exists (
      select 1 from public.projects p
      where p.id::text = portal_budget_proposals.project_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    project_id is not null
    and exists (
      select 1 from public.projects p
      where p.id::text = portal_budget_proposals.project_id
        and p.user_id = auth.uid()
    )
    and status = any (array['pending','accepted','declined'])
  );

-- Belt and braces, same reasoning as the sub-invoice freeze: the column is not
-- something an UPDATE has any business changing.
create or replace function public.portal_proposal_freeze_project()
returns trigger
language plpgsql
as $function$
begin
  if auth.uid() is not null then
    new.project_id := old.project_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists portal_budget_proposals_freeze on public.portal_budget_proposals;
create trigger portal_budget_proposals_freeze
  before update on public.portal_budget_proposals
  for each row execute function public.portal_proposal_freeze_project();


comment on function public.grant_rfp_post_credit(uuid, text, integer) is
  'service_role ONLY. SECURITY DEFINER with no caller identity in its arguments — it credits whatever p_user it is handed. The REVOKE in its creating migration did not survive a later CREATE OR REPLACE, which is why the in-body auth.role() check exists too. See scripts/validate-rls-write-leaks.ts.';
