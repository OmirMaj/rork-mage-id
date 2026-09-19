-- ============================================================================
-- 20260919190000_weekly_digest_stamps_server_owned.sql
--
-- The homeowner weekly digest's two send stamps become SERVER-OWNED.
--
-- Why (leftovers review, 2026-09-18): homeowner-weekly-digest stamps
-- projects.client_portal.weeklyDigest.lastSentAt after every real send and
-- .finalSentAt after the one-time "project complete" email. Both stamps are
-- its only guards: lastSentAt stops a cron retry double-sending the week,
-- finalSentAt stops "This is the last weekly update you'll get for it" going
-- out again. But client_portal is a client-owned JSON blob: the app's owner
-- upsert (ProjectContext) sends `client_portal: project.clientPortal` whole,
-- and client-portal-setup rewrites weeklyDigest as { ...local, enabled }. A
-- device holding a copy from before the Friday run (a web tab left open, a
-- project write queued offline and flushed afterwards) erases the stamps on
-- its next save, so the next Friday sends the "last update" again — every
-- week until closed_at + 30 days.
--
-- The rule (the simplest provable one): only a writer WITHOUT a user id — the
-- edge function's service role, or a direct database session — may change
-- these two keys. For any signed-in writer (auth.uid() is not null: the owner
-- or a collaborator through PostgREST) the stored values are put back:
--   * old had a stamp  -> new carries old's value (erasure or rewrite undone);
--   * old had no stamp -> the key is removed (the app cannot forge one).
-- The rest of weeklyDigest (enabled, hour) stays the app's. The function's
-- own "reopened job: drop finalSentAt" reset is a service-role write, so it
-- still works.
--
-- The same "auth.uid() is not null" test projects_freeze_ownership_columns
-- uses. Production (read-only, 2026-09-18): 0 projects carry either stamp
-- and 0 client_portal / weeklyDigest values that are not objects, so nothing
-- existing changes.
--
-- Trigger order is alphabetical among BEFORE UPDATE triggers:
-- projects_freeze_ownership (portalId) -> projects_keep_proposal_payment_terms
-- (proposalPaymentTerms) -> projects_keep_weekly_digest_stamps (this) ->
-- projects_updated_at -> trg_portal_access_token (accessToken). Each touches a
-- different key and merges into new.client_portal, so the order is harmless.
--
-- Idempotent throughout.
-- ============================================================================

create or replace function public.projects_keep_weekly_digest_stamps() returns trigger
  language plpgsql
  set search_path to 'pg_catalog', 'public'
as $fn$
declare
  old_wd jsonb;
  new_wd jsonb;
  k text;
begin
  -- Service role / direct session: the digest function owns the stamps.
  if auth.uid() is null then
    return new;
  end if;
  -- A cleared or non-object portal is the app's call (disabling the portal);
  -- there is nothing to carry a stamp on.
  if new.client_portal is null or jsonb_typeof(new.client_portal) <> 'object' then
    return new;
  end if;

  old_wd := case when jsonb_typeof(old.client_portal) = 'object'
                  and jsonb_typeof(old.client_portal -> 'weeklyDigest') = 'object'
                 then old.client_portal -> 'weeklyDigest' else '{}'::jsonb end;
  new_wd := case when jsonb_typeof(new.client_portal -> 'weeklyDigest') = 'object'
                 then new.client_portal -> 'weeklyDigest' else '{}'::jsonb end;

  foreach k in array array['lastSentAt', 'finalSentAt'] loop
    if old_wd ? k then
      new_wd := new_wd || jsonb_build_object(k, old_wd -> k);
    else
      new_wd := new_wd - k;
    end if;
  end loop;

  -- Leave an absent weeklyDigest absent when there is nothing to keep, so a
  -- save never invents the key.
  if new_wd = '{}'::jsonb and not (new.client_portal ? 'weeklyDigest') then
    return new;
  end if;
  new.client_portal := new.client_portal || jsonb_build_object('weeklyDigest', new_wd);
  return new;
end $fn$;

-- Invoked by the trigger machinery only.
revoke execute on function public.projects_keep_weekly_digest_stamps() from public, anon, authenticated;

drop trigger if exists projects_keep_weekly_digest_stamps on public.projects;
create trigger projects_keep_weekly_digest_stamps before update on public.projects
  for each row execute function public.projects_keep_weekly_digest_stamps();
