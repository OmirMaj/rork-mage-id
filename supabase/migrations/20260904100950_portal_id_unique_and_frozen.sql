-- ============================================================================
-- Client-portal ids: unique across projects, and frozen against non-owners.
--
-- Review 2026-09-05 (third round), BLOCKING: cross-tenant delete through a
-- spoofed portalId. Pairs with the delete-account edge function change in the
-- same branch; see "THE OTHER HALF" below.
--
-- WHY. projects.client_portal is a jsonb the OWNER writes wholesale
-- (contexts/ProjectContext.tsx, the owner upsert sends the whole blob) and the
-- portal id inside it is minted on the client (app/client-portal-setup.tsx).
-- Nothing in the database says a portalId belongs to exactly one project:
-- there is no unique constraint on it, and projects_freeze_ownership_columns
-- pins user_id only. The id is also in every homeowner link, so it is not a
-- secret. Put the three together:
--   1. read a victim's portalId out of any link they ever sent;
--   2. PATCH it into your own project's client_portal (projects_update admits
--      the owner and any editor collaborator);
--   3. call the delete-account edge function. Its step 2a keys the
--      portal_messages / change_order_approvals (e-signed rows) /
--      portal_budget_proposals / portal_decision_audit / portal_snapshots
--      deletes on the portalIds read from the caller's OWN projects, runs them
--      under the service role, and answers success: true.
--
-- THE OTHER HALF. supabase/functions/delete-account now resolves every claimed
-- portal id back to the projects that carry it and drops any id that resolves
-- to another tenant's project (its `resolvePortalIds`, counted in the response
-- as `portalCollisions`). That holds on any schema state. This file makes the
-- spoof impossible to WRITE in the first place, by anyone, through any client.
--
-- AND A SECOND ROUTE TO THE SAME PLACE (review 2026-09-06, BLOCKING). The
-- ownership question above is not the only one. A caller who spoofs NOBODY —
-- who mints an id that is unique, unclaimed and unambiguously their own — can
-- still reach another tenant's rows if that id CONTAINS `","`, because
-- postgrest-js splices an `.in()` value into the query string inside unescaped
-- double quotes and PostgREST splits it back into two filter values. Neither
-- the unique index nor the freeze trigger sees anything wrong with such an id.
-- Section 2b adds the missing question — what may an id contain — as a CHECK
-- on both tables that carry one, and delete-account gates every id on the same
-- character class before it becomes a filter value. Full write-up in section
-- 2b and in that function's SAFE_DELETE_KEY.
--
-- LIVE ON 2026-09-05 (read-only SELECTs, project nteoqhcswappxxjlpvap):
-- 7 projects; 3 carry a portalId, all 3 enabled; 0 duplicate ids; 0 empty-
-- string ids; every non-null client_portal is a jsonb object; no index on
-- client_portal exists; the BEFORE UPDATE ROW triggers on projects fire in the
-- order projects_freeze_ownership, projects_updated_at, trg_portal_access_token.
--
-- WHAT CHANGES
--   1. projects_client_portal_portal_id_uidx — a UNIQUE partial index on
--      (client_portal->>'portalId'). Two projects can no longer carry the same
--      id whoever writes them: the spoofing PATCH and the spoofing INSERT both
--      fail with 23505. Creation is GUARDED (section 1): if duplicates already
--      exist the file raises with the COUNT and never the ids. Without the
--      guard the raise would be Postgres's own
--      `Key ((client_portal ->> 'portalId'))=(portal-…) is duplicated`, which
--      would put a victim's link id into the migration log.
--      The predicate excludes '' as well as NULL. The finding's DDL said
--      `is not null`; '' is the placeholder DEFAULT_PORTAL carries
--      (app/client-portal-setup.tsx:135) before the real id is minted at :255.
--      Zero rows hold it today, and a placeholder must never be able to make a
--      SECOND project's save fail with 23505 — which utils/offlineQueue would
--      class terminal and drop on the floor. delete-account already discards
--      '' (`.filter(Boolean)`), so excluding it costs the guard nothing.
--   2. projects_freeze_ownership_columns — same guard as today (auth.uid()
--      present and not the row's owner), same `new.user_id := old.user_id`,
--      PLUS: a non-owner update cannot change client_portal->>'portalId'. If
--      the row had an id it is put back (the rest of the non-owner's blob is
--      kept — with ONE exception, named under NOT QUITE "AS BEFORE" below);
--      if it had none, the id the non-owner tried to mint is stripped.
--   3. Two CHECK constraints pinning what an id may CONTAIN, not just which
--      row may hold it — section 2b. Uniqueness and the freeze answer "whose
--      id is this"; neither answers "is this string safe to put in a query",
--      and the second question turned out to be the live one. See section 2b.
--      The OWNER path is untouched, so first enable (the owner upsert carrying
--      a fresh id) keeps working, and so does portal_rotate_access_token from
--      20260904100800 (owner-only; it rewrites accessToken and never the id,
--      so even under the guard `is distinct from` is false and nothing is
--      reset). Service-role writes (auth.uid() is null) are untouched, which
--      is what delete-account and the crons rely on.
--      Trigger order on the same event is alphabetical by name, so
--      projects_freeze_ownership fires BEFORE trg_portal_access_token: a
--      stripped id never reaches the token trigger's mint branch (it keys on
--      `new.client_portal ? 'portalId'`), and a restored id meets the stored
--      token exactly as before. Section 5 asserts that order.
--
-- NOT QUITE "AS BEFORE" (review 2026-09-06). Section 3's inner comment used
-- to say "everything else in the blob passes through as it did before this
-- file". That is true for every non-owner write EXCEPT one: setting
-- client_portal to NULL (or to any jsonb that is not an object) on a row that
-- HAD an id. Before this file that write landed verbatim and the column
-- became NULL. Now the else-branch rebuilds the blob from '{}', so the row
-- ends as {"portalId": <old id>} — and because projects_freeze_ownership
-- fires first, the token trigger then sees `? 'portalId'` with no accessToken
-- and re-injects the OLD one, so the stored value is
-- {"portalId": <old>, "accessToken": <old>}. Self-test (c) asserts exactly
-- this, and it is the intended outcome (a non-owner must not be able to free
-- a frozen id by nulling the column). What it is NOT is a no-op: the
-- non-owner's write silently discards every OTHER portal setting the row
-- carried — enabled, invites, passcode, the showX flags. The portal does not
-- become reachable, because the choke point requires
-- `coalesce((client_portal->>'enabled')::boolean, false) = true` and the
-- rebuilt blob has no `enabled` key; a non-owner nulling the column therefore
-- disables the portal and strips its settings while keeping the id and token.
-- The owner re-enables through the setup screen.
--
-- SIDE EFFECT WORTH NAMING. portal_project_for_token — and
-- portal_project_for_token_any once 100800 lands, and the older in-function
-- lookups in portal_sign_contract / portal_choose_selection before it — all
-- end in `limit 1` over `client_portal->>'portalId' = p_portal_id`. Until now
-- that `limit 1` was doing work: with two projects on one id the choke point
-- would have answered with whichever row the planner met first. After section
-- 2 the predicate is provably single-row and the `limit 1` is decoration.
--
-- ORDER. Apply after 20260904100900. Independent of 100800: this file does not
-- touch portal_set_access_token or any RPC, and is correct on either side of
-- it. The index is built WITHOUT `concurrently` on purpose — the Supabase MCP
-- applies a migration inside a transaction, where CONCURRENTLY is not allowed,
-- and the table has seven rows. Section 2b also touches a SECOND table,
-- sub_portal_links (0 rows in production on 2026-09-06), and its constraint is
-- validated on add — instant at this size, an ACCESS EXCLUSIVE lock and a
-- seq scan at any other. Every expression in section 2b was rehearsed as a
-- read-only SELECT against production on 2026-09-06 (0 violations on both
-- tables, neither constraint present yet); the file itself was NOT executed.
--
-- Redeploy supabase/functions/delete-account with this migration. Neither half
-- depends on the other — the function is safe on a database without these
-- constraints, and the constraints are correct under the old function — so
-- they can land in either order, but a database with only one half is still
-- carrying the other half's risk surface.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE, and an explicit pg_constraint
-- probe in section 2b, where ADD CONSTRAINT has no IF NOT EXISTS), and
-- self-testing: section 4 exercises the new trigger body on a TEMP table under
-- a simulated JWT — no production row is written — and section 5 checks the
-- catalog, including that both section-2b constraints exist AND are validated.
-- ============================================================================

-- ── 1. Duplicate guard: the count, never the ids ────────────────────────────
do $mig$
declare v_ids int; v_rows int;
begin
  select count(*), coalesce(sum(n), 0) into v_ids, v_rows
    from (select client_portal->>'portalId' as pid, count(*) as n
            from public.projects
           where nullif(client_portal->>'portalId', '') is not null
           group by 1
          having count(*) > 1) d;
  if v_ids > 0 then
    raise exception '[100950] % portalId value(s) are shared by % projects, so the unique index cannot be built. Find them with `select client_portal->>''portalId'', count(*) from public.projects group by 1 having count(*) > 1`, then on the LATER project disable and re-enable the client portal through the app (the setup screen mints a fresh id; never hand-edit the JSON) and re-run this file. The ids are deliberately not printed here.', v_ids, v_rows;
  end if;
  raise notice '[100950] no duplicate portalIds — building the unique index';
end
$mig$;

-- ── 2. One project per portal id ────────────────────────────────────────────
create unique index if not exists projects_client_portal_portal_id_uidx
  on public.projects ((client_portal->>'portalId'))
  where nullif(client_portal->>'portalId', '') is not null;

comment on index public.projects_client_portal_portal_id_uidx is
  'One project per client-portal id (20260904100950). Closes the spoofed-portalId cross-tenant delete in delete-account and makes the portal_project_for_token lookup provably single-row. Empty-string ids (the client placeholder) are excluded on purpose.';

-- ── 2b. What an id may CONTAIN (review 2026-09-06, BLOCKING) ────────────────
-- Section 2 and section 3 both answer "WHOSE id is this". Neither answers
-- "is this string safe to put in a query", and that was the live hole.
--
-- postgrest-js builds an `.in()` filter by wrapping any value containing a
-- PostgREST reserved character (`[,()]`) in double quotes and escaping
-- NOTHING inside them; PostgREST then splits on the commas between quoted
-- items and un-escapes `\"` inside them. So a SINGLE id can become TWO filter
-- values. Probed live against this project on 2026-09-06 with the public anon
-- key: `state=in.("TX","CA")` returned TX rows AND CA rows, while
-- `state=eq.TX","CA` returned nothing (`eq.` is appended verbatim and does
-- not split). Run under the service role, in a DELETE, that is a
-- cross-tenant erase — and two paths reached it without any spoofing at all:
--
--   • sub_portal_links.id is `text NOT NULL` with NO default, minted on the
--     client, and its INSERT policy ("gc writes own sub portal links") checks
--     only `user_id = auth.uid()`. Nothing constrained the VALUE, so a caller
--     could insert a row that was genuinely, uniquely theirs whose id was
--     `x","<victim sub_portal_id>` — and delete-account's
--     `sub_portal_id=in.(…)` split it. A PRIMARY KEY is a statement about
--     identity, not about encoding.
--   • the same trick, in its escaped form, walked past the portal-id
--     resolver: `x\",\"<victim>` un-escapes to `x","<victim>`, so a second
--     project of the attacker's own resolved the first one's id back to an
--     owned project and the resolver kept it. Both strings are distinct, so
--     section 2's unique index is satisfied, and both writes are by the
--     OWNER, so section 3's freeze never fires. Only a charset check stops it.
--
-- The class matches every id the app mints — uuids,
-- `portal-<8 hex>-<base36 ms>` (app/client-portal-setup.tsx:255,
-- app/project-detail.tsx:3895, app/dev-seeder.tsx:265) and
-- `sub-portal-<6>-<6>-<base36 ms>` (app/sub-portal-setup.tsx:175) — and
-- excludes `,` `(` `)` `"` `\` and whitespace, which is every character the
-- splice needs. It is the same literal as SAFE_DELETE_KEY in
-- supabase/functions/delete-account/index.ts, and Postgres's `~` and
-- JavaScript's RegExp agree on all of it (both were run against the same
-- table of cases on 2026-09-06, including the trailing-newline form, which
-- both reject).
--
-- The projects CHECK admits NULL (no portal) and '' (DEFAULT_PORTAL's
-- placeholder, app/client-portal-setup.tsx:135) so it cannot make a save fail
-- that used to succeed for any shape the app writes today. It DOES newly
-- reject a portalId that is a jsonb object or array (`->>` renders those with
-- braces and quotes) — deliberate: delete-account's gate drops those too, and
-- a write that produces one is a bug wherever it comes from.
--
-- GUARDED, like section 1: the counts are checked first and the raise carries
-- only how many. Live on 2026-09-06 (read-only SELECTs): sub_portal_links has
-- 0 rows, so 0 violations; projects has 7 rows of which 3 carry a portalId
-- (lengths 20, 24, 24, all `string`-typed, all matching) and 4 carry a NULL
-- client_portal — 0 violations. Both constraints validate against every
-- existing row, so neither needs NOT VALID.
do $mig$
declare v_spl int; v_proj int;
begin
  select count(*) into v_spl from public.sub_portal_links
   where id !~ '^[A-Za-z0-9._:-]{1,128}$';
  if v_spl > 0 then
    raise exception '[100950] % sub_portal_links row(s) hold an id outside [A-Za-z0-9._:-]{1,128}, so the CHECK cannot be added. Find them with `select id from public.sub_portal_links where id !~ ''^[A-Za-z0-9._:-]{1,128}$''`, delete the link through the app and re-issue it, then re-run this file. An id that fails this test is a query-splice payload; it is deliberately not printed here.', v_spl;
  end if;

  select count(*) into v_proj from public.projects
   where nullif(client_portal->>'portalId', '') is not null
     and client_portal->>'portalId' !~ '^[A-Za-z0-9._:-]{1,128}$';
  if v_proj > 0 then
    raise exception '[100950] % project(s) hold a client_portal->>''portalId'' outside [A-Za-z0-9._:-]{1,128}, so the CHECK cannot be added. Disable and re-enable the client portal on those projects through the app (the setup screen mints a fresh id; never hand-edit the JSON) and re-run this file. The values are deliberately not printed here.', v_proj;
  end if;

  raise notice '[100950] no id violates the delete-key charset — adding the CHECK constraints';
end
$mig$;

-- ADD CONSTRAINT has no IF NOT EXISTS, so the idempotence is explicit.
do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'sub_portal_links_id_charset'
                    and conrelid = 'public.sub_portal_links'::regclass) then
    alter table public.sub_portal_links
      add constraint sub_portal_links_id_charset
      check (id ~ '^[A-Za-z0-9._:-]{1,128}$');
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'projects_client_portal_portal_id_charset'
                    and conrelid = 'public.projects'::regclass) then
    alter table public.projects
      add constraint projects_client_portal_portal_id_charset
      check (client_portal->>'portalId' is null
             or client_portal->>'portalId' = ''
             or client_portal->>'portalId' ~ '^[A-Za-z0-9._:-]{1,128}$');
  end if;
end
$mig$;

comment on constraint sub_portal_links_id_charset on public.sub_portal_links is
  'A sub-portal id is client-minted text with no default and its INSERT policy checks only user_id; this pins what the value may CONTAIN (20260904100950). Without it an owner could mint an id holding `","` and split a PostgREST `.in()` filter into two values — a cross-tenant delete under the service role in delete-account.';

comment on constraint projects_client_portal_portal_id_charset on public.projects is
  'Same charset gate as sub_portal_links_id_charset, on the client-written portal id (20260904100950). NULL and the '''' placeholder are admitted so no save that succeeds today starts failing.';

-- ── 3. The freeze trigger: user_id AND the portal id ────────────────────────
-- Body identical to schema.sql except for the inner IF. CREATE OR REPLACE
-- keeps the function's OID, so projects_freeze_ownership stays bound to it.
create or replace function public.projects_freeze_ownership_columns()
 returns trigger
 language plpgsql
as $fn$
begin
  if auth.uid() is not null and auth.uid() is distinct from old.user_id then
    new.user_id := old.user_id;
    -- 20260904100950: the portal id is an ownership column too. A non-owner
    -- (an editor collaborator — projects_update admits them) can neither move
    -- this project onto another tenant's id nor mint one. Everything else in
    -- the blob passes through as it did before this file, WITH ONE EXCEPTION:
    -- a non-owner write of NULL (or of any non-object jsonb) to a row that
    -- HAD an id used to land verbatim and is now rebuilt from '{}' as
    -- {"portalId": <old>}, which the token trigger then completes to
    -- {"portalId": <old>, "accessToken": <old>}. See NOT QUITE "AS BEFORE" in
    -- the header: the id is deliberately not freeable this way, but the
    -- non-owner's write does drop every other portal setting on the row.
    if (new.client_portal->>'portalId') is distinct from (old.client_portal->>'portalId') then
      if old.client_portal->>'portalId' is null then
        if jsonb_typeof(new.client_portal) = 'object' then
          new.client_portal := new.client_portal - 'portalId';
        end if;
      else
        new.client_portal := (case when jsonb_typeof(new.client_portal) = 'object'
                                   then new.client_portal else '{}'::jsonb end)
                             || jsonb_build_object('portalId', old.client_portal->>'portalId');
      end if;
    end if;
  end if;
  return new;
end;
$fn$;

comment on function public.projects_freeze_ownership_columns() is
  'BEFORE UPDATE on projects: a writer who is not the row''s owner (auth.uid() set and different from user_id) cannot change user_id or client_portal->>''portalId'' (20260904100950). Owner and service-role writes are untouched.';

-- ── 4. Self-test on a TEMP table under a simulated JWT ──────────────────────
-- auth.uid() reads request.jwt.claim.sub, then request.jwt.claims->>'sub'
-- (live definition 2026-09-05). Both are set, transaction-locally, and both
-- are cleared again before this block ends. No row in public.projects is
-- touched: the trigger function is attached to a temp table of the same shape.
do $mig$
declare
  v_owner    uuid := gen_random_uuid();
  v_intruder uuid := gen_random_uuid();
  v_out      jsonb;
  v_uid      uuid;
begin
  drop table if exists pg_temp.projects_freeze_probe;
  create temp table projects_freeze_probe (id int primary key, user_id uuid not null, client_portal jsonb);
  create trigger probe_freeze before update on projects_freeze_probe
    for each row execute function public.projects_freeze_ownership_columns();
  insert into projects_freeze_probe values
    (1, v_owner, jsonb_build_object('portalId', 'portal-owner-1', 'enabled', true, 'showPhotos', true)),
    (2, v_owner, jsonb_build_object('enabled', false));

  -- (a) the OWNER may change the id: first enable / re-mint.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  if auth.uid() is distinct from v_owner then
    raise exception '[100950] self-test: auth.uid() does not read request.jwt.claim.sub — the simulated JWT is not taking effect; re-read auth.uid() before trusting this file';
  end if;
  update projects_freeze_probe set client_portal = client_portal || '{"portalId":"portal-owner-2"}' where id = 1;
  select client_portal into v_out from projects_freeze_probe where id = 1;
  if v_out->>'portalId' is distinct from 'portal-owner-2' then
    raise exception '[100950] self-test (a): the OWNER could not change the portal id — first enable would break';
  end if;

  -- (b) a non-owner cannot move the row onto another id; the rest lands.
  perform set_config('request.jwt.claim.sub', v_intruder::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_intruder)::text, true);
  update projects_freeze_probe
     set client_portal = client_portal || '{"portalId":"portal-victim","showPhotos":false}'
   where id = 1;
  select client_portal into v_out from projects_freeze_probe where id = 1;
  if v_out->>'portalId' is distinct from 'portal-owner-2' then
    raise exception '[100950] self-test (b): a non-owner changed the portal id (got %)', v_out->>'portalId';
  end if;
  if (v_out->>'showPhotos')::boolean is distinct from false then
    raise exception '[100950] self-test (b): the non-owner''s other fields were lost — the reset must touch portalId only';
  end if;

  -- (c) a non-owner cannot free the id by nulling the blob.
  update projects_freeze_probe set client_portal = null where id = 1;
  select client_portal into v_out from projects_freeze_probe where id = 1;
  if v_out->>'portalId' is distinct from 'portal-owner-2' then
    raise exception '[100950] self-test (c): a non-owner freed the portal id by nulling client_portal';
  end if;

  -- (d) a non-owner cannot mint an id where there was none; the rest lands.
  update projects_freeze_probe
     set client_portal = '{"portalId":"portal-minted","enabled":true}'::jsonb
   where id = 2;
  select client_portal into v_out from projects_freeze_probe where id = 2;
  if v_out ? 'portalId' then
    raise exception '[100950] self-test (d): a non-owner minted a portal id on a project that had none';
  end if;
  if (v_out->>'enabled')::boolean is distinct from true then
    raise exception '[100950] self-test (d): the non-owner''s other fields were lost — only portalId may be stripped';
  end if;

  -- (e) user_id is still frozen for a non-owner (the original body, unchanged).
  update projects_freeze_probe set user_id = v_intruder where id = 1;
  select user_id into v_uid from projects_freeze_probe where id = 1;
  if v_uid is distinct from v_owner then
    raise exception '[100950] self-test (e): a non-owner re-owned the row — the user_id reset was lost';
  end if;

  -- (f) no JWT (service role, crons, this migration): untouched.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  if auth.uid() is not null then
    raise exception '[100950] self-test: the simulated JWT did not clear';
  end if;
  update projects_freeze_probe set client_portal = client_portal || '{"portalId":"portal-service"}' where id = 1;
  select client_portal into v_out from projects_freeze_probe where id = 1;
  if v_out->>'portalId' is distinct from 'portal-service' then
    raise exception '[100950] self-test (f): a service-role write was rewritten — delete-account and the crons would break';
  end if;

  drop table projects_freeze_probe;
  raise notice '[100950] freeze trigger self-test passed: owner may set; non-owner cannot change, free or mint; user_id still frozen; service role untouched';
end
$mig$;

-- ── 5. Post-conditions ──────────────────────────────────────────────────────
do $mig$
declare v_def text; v_idx text; v_first text;
begin
  select indexdef into v_idx from pg_indexes
   where schemaname = 'public' and tablename = 'projects'
     and indexname = 'projects_client_portal_portal_id_uidx';
  if v_idx is null then
    raise exception '[100950] projects_client_portal_portal_id_uidx is missing';
  end if;
  if position('UNIQUE' in v_idx) = 0
     or position('portalId' in v_idx) = 0
     or position('WHERE' in v_idx) = 0 then
    raise exception '[100950] projects_client_portal_portal_id_uidx exists but is not the unique partial expression index this file defines: %', v_idx;
  end if;

  v_def := pg_get_functiondef('public.projects_freeze_ownership_columns()'::regprocedure);
  if position('new.user_id := old.user_id' in v_def) = 0 then
    raise exception '[100950] projects_freeze_ownership_columns lost the user_id reset';
  end if;
  if position('portalId' in v_def) = 0 then
    raise exception '[100950] projects_freeze_ownership_columns does not freeze the portal id';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname = 'projects_freeze_ownership'
                    and tgrelid = 'public.projects'::regclass
                    and tgfoid = 'public.projects_freeze_ownership_columns()'::regprocedure) then
    raise exception '[100950] projects_freeze_ownership is not bound to projects_freeze_ownership_columns on public.projects';
  end if;

  -- Same-event triggers fire in name order; the freeze must precede the
  -- token trigger so a stripped id never reaches its mint branch.
  -- tgtype bits: 1 = ROW, 2 = BEFORE, 16 = UPDATE.
  select tgname into v_first from pg_trigger
   where tgrelid = 'public.projects'::regclass and not tgisinternal
     and (tgtype & 1) = 1 and (tgtype & 2) = 2 and (tgtype & 16) = 16
   order by tgname
   limit 1;
  if v_first is distinct from 'projects_freeze_ownership' then
    raise exception '[100950] expected projects_freeze_ownership to be the first BEFORE UPDATE ROW trigger on projects, found %', v_first;
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.projects'::regclass and tgname = 'trg_portal_access_token') then
    raise exception '[100950] trg_portal_access_token is missing from public.projects — the token mint / re-inject path is gone';
  end if;

  -- Section 2b. Both constraints must exist AND be validated (convalidated),
  -- because an unvalidated CHECK admits every row that is already there.
  if not exists (select 1 from pg_constraint
                  where conname = 'sub_portal_links_id_charset'
                    and conrelid = 'public.sub_portal_links'::regclass
                    and contype = 'c' and convalidated) then
    raise exception '[100950] sub_portal_links_id_charset is missing or not validated — a client-minted id can still carry a PostgREST `.in()` splice';
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'projects_client_portal_portal_id_charset'
                    and conrelid = 'public.projects'::regclass
                    and contype = 'c' and convalidated) then
    raise exception '[100950] projects_client_portal_portal_id_charset is missing or not validated';
  end if;

  raise notice '[100950] portal ids are unique across projects, frozen against non-owners, and charset-gated on both tables';
end
$mig$;
