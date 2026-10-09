-- ============================================================================
-- 20261010090000_signature_provenance.sql
-- Signature provenance: the database writes down HOW a signature row got
-- there, in a column no client can set.
--
-- NOT APPLIED. Written and proven on PGlite only. The proof is in the repo:
--   scripts/pgq/signature-provenance.proof.mjs (scripts/pgq/README.md has the
--   one command). It builds the two tables in production's shape, applies the
--   real earlier migrations that write them, applies this file twice, runs
--   every writer listed below as the role it really runs as, then removes one
--   guard at a time and checks that a named check goes red.
--   Apply through the Supabase MCP apply_migration, never `supabase db push`.
--
-- WHY. The Pay Period Record prints a label next to each record. "Signed" has
--   to rest on something the server knows. Today it cannot: a contractor's own
--   signed-in account may insert a change_order_approvals row (the in-app
--   client view, with a hash computed on the phone) and may write
--   lien_waivers.sub_signature / signed_at (the paper record). Those rows look
--   the same as the ones a client or a sub made on the token-gated pages.
--   After this file each new signature carries a marker the writer cannot
--   choose:
--     change_order_approvals.recorded_via   'portal_function' | 'contractor_account' | NULL
--     lien_waivers.signed_via               'signing_page'    | 'contractor_account' | NULL
--   The app already reads these exact strings (utils/proofPack/store.ts):
--   'portal_function' and 'signing_page' may earn the Signed label, anything
--   else, NULL included, does not.
--
-- WHAT THIS FILE DOES. Additive only.
--   1. Two nullable text columns, no default. Every row that exists today
--      stays NULL, which reads "not known". Nothing is backfilled, now or later.
--   2. public.co_approval_provenance(), a trigger function, and the trigger
--      change_order_approvals_provenance (BEFORE INSERT OR UPDATE):
--        INSERT  created_at is set to the server's now() for every writer,
--                whatever was sent. recorded_via is set by who is writing,
--                whatever was sent (rule below).
--        UPDATE  recorded_via is put back to the stored value, for every role.
--   3. public.lien_waivers_signed_via(), a trigger function, and the trigger
--      lien_waivers_signed_via (BEFORE INSERT OR UPDATE):
--        signed_via is decided here on every write, whatever was sent. Once it
--        holds a value it is put back to that value on every later write, for
--        every role.
--   Neither function raises. A write that worked before this file works after
--   it and stores the same values in every other column (created_at on a
--   client's own insert is the one exception: it is now the server's time).
--   No function under supabase/functions and no existing SQL function changes:
--   the marker is derived from WHO is writing, so no writer has to send it.
--
-- HOW THE REAL SIGNING PATHS WRITE (read in the repo, not assumed).
--   Change orders. The client's page (marketing/portal/index.html:7748, and
--   the older fallback at :7175) calls PostgREST with the public anon key and
--   the portal token. The two functions it calls are SECURITY DEFINER SQL
--   functions, not edge functions and not the service role:
--     public.portal_submit_co_approval_signed(13 args)  20260920060000:383, insert at :457
--     public.portal_submit_co_approval(7 args)          20260920060000:337, insert at :369
--   Inside a SECURITY DEFINER function current_user is the function's OWNER
--   (postgres in production). So the INSERT arrives as that owner, with no
--   signed-in user (the anon key carries no user id: auth.uid() is null).
--   Lien waivers. The sub's page (marketing/lien-waiver/index.html:600) calls
--     public.lien_waiver_submit_signature(9 args)       20260923130000:258, update at :313
--   the same way: anon key, token in the arguments, SECURITY DEFINER. Its
--   UPDATE arrives as the function's owner with no signed-in user.
--
-- THE RULE (the same shape in both functions; the allow-list of
--   20261005110000_guard_allowlists.sql, read first).
--     THE SIGNING PATH: current_user is the looked-up owner of the signing
--       function (which must be SECURITY DEFINER), AND no signed-in user is on
--       the request. The owner is looked up at the write, inside a block that
--       cannot raise; if it cannot be told, nobody is the signing path.
--     THE REST OF THE SERVER: service_role, postgres, supabase_admin when they
--       are not that owner (an edge function, a repair). Never given a marker:
--       the row stays NULL, "not known". No edge function writes a signature
--       on either table today.
--     EVERYONE ELSE IS A CLIENT: the roles a request runs as today, any role
--       created later whatever it is granted, and ALSO the signing function
--       itself when a signed-in account calls it (a signed-in account is not
--       the anonymous page). No function body names a client role.
--   change_order_approvals, INSERT:
--       the signing path      recorded_via = 'portal_function'
--       the rest of the server recorded_via = NULL
--       a client              recorded_via = 'contractor_account'
--   lien_waivers:
--       INSERT, a client, with sub_signature or signed_at   'contractor_account'
--       INSERT, anything else                               NULL (the signing
--         function never inserts, so no insert earns 'signing_page')
--       UPDATE, marker already set                          kept as it is
--       UPDATE, the signing path, signed_at goes from empty to set   'signing_page'
--       UPDATE, a client, puts a new non-empty value in sub_signature or signed_at
--                                                           'contractor_account'
--       UPDATE, anything else                               stays NULL
--
-- WHAT THE MARKER PROVES, AND WHAT IT DOES NOT. Say this plainly wherever the
--   label is explained.
--     It proves the row was written by the token-gated function, on the
--     server's clock, with the consent record hashed on the server, by a
--     request that carried no signed-in account. A contractor's app cannot
--     produce it.
--     It does NOT prove who held the link. The contractor makes the portal
--     link and the waiver link and can open either one in a browser like
--     anyone else. No trigger can tell that apart from the client opening it.
--     It does NOT tell a direct SQL write by the database owner (the SQL
--     editor) from the function: both are the function's owner with no
--     signed-in user. That is the one account that could also drop the trigger.
--     portal_submit_co_approval (the 7-argument fallback) earns
--     'portal_function' too, and stores no signature image. The app must keep
--     asking for the signature fields as well as the marker.
--
-- EVERY WRITER OF THE TWO TABLES (grepped in supabase/migrations,
--   supabase/functions, app, utils, contexts, components, hooks, marketing,
--   lib, public; file:line) AND HOW EACH IS MARKED.
--   change_order_approvals
--     W1  portal_submit_co_approval_signed  20260920060000:383 (insert :457),
--         called by marketing/portal/index.html:7748 (anon key)
--                                              -> 'portal_function'
--     W2  portal_submit_co_approval         20260920060000:337 (insert :369),
--         called by marketing/portal/index.html:7175 (anon key, fallback)
--                                              -> 'portal_function'
--         (earlier bodies of W1 / W2, same signatures, replaced:
--         20260713150000:73, 20260803120500:54, 20260919030000:154 and :184)
--     W3  app/client-view.tsx:813-816, insertCODecision: the contractor's
--         signed-in account, under the policy "gc records client CO approval
--         in own portal" (20260713150001:49). It sends a phone-computed
--         document_hash and sealed_at.          -> 'contractor_account';
--         created_at is the server's. Nothing else it sends is changed.
--     W4  hooks/usePortalApprovalReconciler.ts:186-188, stampSynced: UPDATE of
--         synced_to_co_at under "gc stamps own CO approvals" (20260902140000:39)
--                                              -> marker untouched (pinned)
--     W5  supabase/functions/delete-account/index.ts:241-242: DELETE as
--         service_role                         -> not a write of the marker;
--         this file adds no DELETE trigger
--     Triggers already on the table: trg_resolve_co_approval_project (BEFORE
--     INSERT, fills project_id; supabase/schema.sql:3662), notify_co_approval
--     (AFTER INSERT; schema.sql:3661), co_approval_freeze_evidence (BEFORE
--     UPDATE; 20260902140000:87, body restated 20260920060000:137; the trigger
--     is change_order_approvals_freeze_evidence in the migration and
--     change_order_approvals_freeze in schema.sql). None reads or writes
--     recorded_via. The freeze function is NOT edited: it pins only for a
--     request with a signed-in user, and the marker must be pinned for all.
--     Readers only: hooks/usePortalThread.ts:150, app/client-view.tsx:847,
--     utils/proofPack/store.ts:233, portal_co_decision_for_send
--     (20260920060000:233). anon holds no INSERT (20260713150001:41).
--   lien_waivers
--     L1  lien_waiver_submit_signature  20260923130000:258 (update :313; first
--         written 20260908120200:178), called by
--         marketing/lien-waiver/index.html:600 (anon key)
--                                              -> 'signing_page'
--     L2  utils/lienWaiverEngine.ts:336 recordPaperLienWaiver (update :341),
--         from app/lien-waivers.tsx:699: the contractor records a paper
--         original, sub_signature {role:'gc'} and signed_at from the phone
--                                              -> 'contractor_account'
--     L3  utils/lienWaiverEngine.ts:111 saveLienWaiver (upsert :146), from
--         app/lien-waivers.tsx:507, app/dev-seeder.tsx:643 and
--         app/dev-flagship-seeder.tsx:1267. It sends the signature columns
--         only when its copy has them.          -> 'contractor_account' when it
--         puts a new signature on the row; otherwise the marker is untouched
--     L4  utils/lienWaiverEngine.ts:253 createLienWaiverChecked (insert :262),
--         from app/lien-waivers.tsx:404: no signature columns
--                                              -> NULL
--     L5  utils/lienWaiverEngine.ts:296 updateLienWaiverStatus (update :303),
--         from app/lien-waivers.tsx:627: Mark received, Void
--                                              -> marker untouched
--     L6  utils/lienWaiverEngine.ts:550 requestLienWaiverSignature (update
--         :598), from app/lien-waivers.tsx:522: the signing token and document
--                                              -> marker untouched
--     L7  utils/lienWaiverEngine.ts:165 deleteLienWaiver (:167); the cascades
--         from auth.users and public.projects (schema.sql:2388-2389)
--                                              -> deletes; no DELETE trigger here
--     Triggers already on the table: lien_waivers_protect_signature (BEFORE
--     UPDATE; 20260923130000:92, :142), trg_notify_lien_waiver_signed (AFTER
--     UPDATE OF signed_at; :176), lien_waivers_updated_at (BEFORE UPDATE;
--     schema.sql:3679). None reads or writes signed_via. BEFORE triggers fire
--     in name order, so lien_waivers_protect_signature runs before
--     lien_waivers_signed_via: a stale app write over a signed row has already
--     been put back when this trigger compares old and new, so a row signed
--     before this file is not marked by it.
--     Readers only: supabase/functions/notify/index.ts:989,
--     lien_waiver_get_for_signing (20260923130000:207),
--     utils/lienWaiverEngine.ts:100, :219, :240, :640,
--     utils/proofPack/store.ts:347.
--
-- WHAT BEHAVES DIFFERENTLY AFTER APPLYING (all of it).
--   a. change_order_approvals.created_at on a row a client inserts is the
--      server's time even if the request sent one. The app does not send it
--      (app/client-view.tsx:815-838), so nothing the app does changes.
--   b. A direct INSERT by the database owner or the service role that carries
--      its own created_at (a hand repair, a logical copy of rows) also gets
--      now(). To copy rows with their times, run the copy with
--      session_replication_role = replica (pg_restore --disable-triggers does
--      this), which skips these triggers and keeps the columns as copied.
--   c. Nothing else. No write is refused, no other column is touched.
--
-- BEFORE APPLYING, read production (read-only; Supabase MCP execute_sql).
--   select p.oid::regprocedure as fn, r.rolname as owner, p.prosecdef
--     from pg_proc p join pg_roles r on r.oid = p.proowner
--    where p.pronamespace = 'public'::regnamespace
--      and p.proname in ('portal_submit_co_approval_signed', 'portal_submit_co_approval', 'lien_waiver_submit_signature');
--   -- expected: three rows, owner postgres, prosecdef true.
--   select p.oid::regprocedure as fn, r.rolname as owner
--     from pg_proc p join pg_roles r on r.oid = p.proowner
--    where p.pronamespace = 'public'::regnamespace and p.prosecdef
--      and p.prosrc ~* '(insert\s+into|update)\s+(public\.)?(change_order_approvals|lien_waivers)\M';
--   -- expected: the same three. The preflight below refuses the apply if there
--   -- is a fourth: it would run as the same owner and earn the marker.
--   select c.relname, t.tgname, p.proname, t.tgenabled
--     from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
--    where not t.tgisinternal
--      and c.oid in ('public.change_order_approvals'::regclass, 'public.lien_waivers'::regclass)
--    order by 1, 2;
--   -- expected: the triggers named above and nothing else.
--
-- DEPLOY ORDER. After 20260920060000 and 20260923130000 (this file refuses to
--   run without their functions). Before or after any edge function deploy and
--   any app version: an app that does not know the columns never reads them,
--   and the app that does falls back when they are missing.
--   Idempotent: a second run changes nothing.
--
-- VERIFY AFTER
--   select table_name, column_name, is_nullable, column_default from information_schema.columns
--    where table_schema = 'public'
--      and (table_name, column_name) in (('change_order_approvals', 'recorded_via'), ('lien_waivers', 'signed_via'));
--   -- two rows, YES, null.
--   select count(*) filter (where recorded_via is not null) from public.change_order_approvals;
--   select count(*) filter (where signed_via is not null) from public.lien_waivers;
--   -- 0 and 0 straight after the apply: no existing row was marked.
--   Then one real write of each kind, watched: approve a change order from a
--   portal link in a private browser window (recorded_via = 'portal_function'),
--   approve one in the app's client view ('contractor_account'), sign a waiver
--   from its emailed link ('signing_page'), record a paper waiver in the app
--   ('contractor_account'), mark a waiver received (marker unchanged).
--
-- REVERSE PATH (exact; removes everything this file creates, touches nothing else).
--   drop trigger if exists change_order_approvals_provenance on public.change_order_approvals;
--   drop trigger if exists lien_waivers_signed_via on public.lien_waivers;
--   drop function if exists public.co_approval_provenance();
--   drop function if exists public.lien_waivers_signed_via();
--   alter table public.change_order_approvals drop column if exists recorded_via;
--   alter table public.lien_waivers drop column if exists signed_via;
--   notify pgrst, 'reload schema';
--   Dropping the columns loses the markers written since the apply. To stop
--   marking but keep what was written, run only the first four lines.
-- ============================================================================

-- ── preflight: refuse BEFORE anything is added ──────────────────────────────
do $$
declare
  f        record;
  v_owner  name;
  v_bad    text;
begin
  if to_regclass('public.change_order_approvals') is null or to_regclass('public.lien_waivers') is null then
    raise exception '[signature-provenance] preflight: change_order_approvals or lien_waivers is missing. Nothing was changed';
  end if;
  if to_regprocedure('public.portal_submit_co_approval_signed(text,text,text,text,text,text,text,text,text,text,text,text,boolean)') is null
     or to_regprocedure('public.lien_waiver_submit_signature(uuid,text,text,text,text,text,text,boolean,text)') is null then
    raise exception '[signature-provenance] preflight: apply 20260920060000 and 20260923130000 first: a signing function this file looks up is missing. Nothing was changed';
  end if;

  -- The signing functions: SECURITY DEFINER, and owned by a role no request can run as.
  for f in
    select * from (values
      ('public.portal_submit_co_approval_signed(text,text,text,text,text,text,text,text,text,text,text,text,boolean)'),
      ('public.portal_submit_co_approval(text,text,text,text,text,text,text)'),
      ('public.lien_waiver_submit_signature(uuid,text,text,text,text,text,text,boolean,text)')
    ) as t(fn)
  loop
    continue when to_regprocedure(f.fn) is null;  -- only the 7-argument fallback may be absent
    v_owner := null;
    select r.rolname into v_owner
      from pg_proc p join pg_roles r on r.oid = p.proowner
     where p.oid = f.fn::regprocedure and p.prosecdef;
    if v_owner is null then
      raise exception '[signature-provenance] preflight: % must be SECURITY DEFINER: the marker is given to its owner. Nothing was changed', f.fn;
    end if;
    if v_owner in ('authenticated', 'anon', 'authenticator') then
      raise exception '[signature-provenance] preflight: % is owned by %, a role a request can run as: every request would earn the marker. Nothing was changed', f.fn, v_owner;
    end if;
  end loop;

  -- The two change order functions must have one owner: the trigger looks up one of them.
  if to_regprocedure('public.portal_submit_co_approval(text,text,text,text,text,text,text)') is not null
     and (select proowner from pg_proc where oid = 'public.portal_submit_co_approval(text,text,text,text,text,text,text)'::regprocedure)
         is distinct from
         (select proowner from pg_proc where oid = 'public.portal_submit_co_approval_signed(text,text,text,text,text,text,text,text,text,text,text,text,boolean)'::regprocedure) then
    raise exception '[signature-provenance] preflight: portal_submit_co_approval and portal_submit_co_approval_signed have different owners. Nothing was changed';
  end if;

  -- Any OTHER SECURITY DEFINER function that writes either table would run as
  -- an owner too and could earn the marker for a row no signing page made.
  -- The repo has none. Refuse rather than mark such rows.
  select string_agg(p.oid::regprocedure::text || ' (owner ' || r.rolname || ')', ', ' order by p.oid::regprocedure::text) into v_bad
    from pg_proc p
    join pg_roles r on r.oid = p.proowner
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and p.prosrc ~* '(insert\s+into|update)\s+(public\.)?(change_order_approvals|lien_waivers)\M'
     and p.oid not in (
       'public.portal_submit_co_approval_signed(text,text,text,text,text,text,text,text,text,text,text,text,boolean)'::regprocedure::oid,
       coalesce(to_regprocedure('public.portal_submit_co_approval(text,text,text,text,text,text,text)')::oid, 0::oid),
       'public.lien_waiver_submit_signature(uuid,text,text,text,text,text,text,boolean,text)'::regprocedure::oid);
  if v_bad is not null then
    raise exception '[signature-provenance] preflight: these SECURITY DEFINER functions also write change_order_approvals or lien_waivers and are not signing paths this file knows: %. Nothing was changed: read them first', v_bad;
  end if;
end $$;

-- ── 1. the two columns: nullable, no default, nothing backfilled ────────────
alter table public.change_order_approvals add column if not exists recorded_via text;
alter table public.lien_waivers           add column if not exists signed_via   text;

comment on column public.change_order_approvals.recorded_via is
  'How the row was written, set only by trigger change_order_approvals_provenance from the writing role: portal_function (the token-gated portal function, no signed-in account), contractor_account (any client write, the in-app client view included), NULL (not known: written before 20261010090000, or by the server outside the signing path). Never backfilled. Cannot be set or changed by a client.';
comment on column public.lien_waivers.signed_via is
  'How the signature was written, set only by trigger lien_waivers_signed_via from the writing role: signing_page (lien_waiver_submit_signature, no signed-in account), contractor_account (the contractor''s account wrote sub_signature or signed_at, a paper record included), NULL (unsigned, or not known: signed before 20261010090000). Never backfilled. Pinned once set.';

-- Both functions stay SECURITY INVOKER: the rule reads current_user, which
-- inside a definer function is that function's owner. As a definer function a
-- trigger would always see its own owner and tell nobody apart. The allow-list
-- is written out in each, not shared through a helper: a trigger calls a
-- helper as the writing role, which would then need EXECUTE on it, and a
-- missing grant would fail every save of the table.

-- ── 2. change_order_approvals: the server's clock, and who wrote the row ────
create or replace function public.co_approval_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner     name;
  v_signed_in boolean := true;
  v_server    boolean := false;
begin
  -- After the insert the marker never moves, for any role.
  if tg_op = 'UPDATE' then
    new.recorded_via := old.recorded_via;
    return new;
  end if;

  -- The time a decision was recorded is the server's, whatever was sent.
  new.created_at := pg_catalog.now();

  -- Who owns the signing function. Cannot fail; unknown means nobody.
  begin
    select ro.rolname into v_owner
      from pg_catalog.pg_proc fn
      join pg_catalog.pg_roles ro on ro.oid = fn.proowner
     where fn.oid = pg_catalog.to_regprocedure('public.portal_submit_co_approval_signed(text,text,text,text,text,text,text,text,text,text,text,text,boolean)')
       and fn.prosecdef;
  exception when others then
    v_owner := null;
  end;
  -- Is a signed-in account on the request. Cannot fail; unknown means yes.
  begin
    v_signed_in := auth.uid() is not null;
  exception when others then
    v_signed_in := true;
  end;

  if v_owner is not null and current_user = v_owner then
    -- The portal function. A signed-in account calling it is not the
    -- anonymous client page, so it is marked as a client.
    if v_signed_in then
      new.recorded_via := 'contractor_account';
    else
      new.recorded_via := 'portal_function';
    end if;
    return new;
  end if;

  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    v_server := true;
  end if;

  if v_server then
    -- The server, outside the signing path: not known. Never the marker.
    new.recorded_via := null;
  else
    -- Everyone else is a client, whatever the request sent.
    new.recorded_via := 'contractor_account';
  end if;
  return new;
end
$$;

revoke all on function public.co_approval_provenance() from public;

drop trigger if exists change_order_approvals_provenance on public.change_order_approvals;
create trigger change_order_approvals_provenance
  before insert or update on public.change_order_approvals
  for each row execute function public.co_approval_provenance();

-- ── 3. lien_waivers: who wrote the signature ────────────────────────────────
create or replace function public.lien_waivers_signed_via()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner     name;
  v_signed_in boolean := true;
  v_page      boolean := false;
  v_server    boolean := false;
  v_new_sig   boolean := new.sub_signature is not null and new.sub_signature <> 'null'::jsonb;
begin
  -- Once written the marker never moves, for any role.
  if tg_op = 'UPDATE' and old.signed_via is not null then
    new.signed_via := old.signed_via;
    return new;
  end if;

  -- Who owns the signing function. Cannot fail; unknown means nobody.
  begin
    select ro.rolname into v_owner
      from pg_catalog.pg_proc fn
      join pg_catalog.pg_roles ro on ro.oid = fn.proowner
     where fn.oid = pg_catalog.to_regprocedure('public.lien_waiver_submit_signature(uuid,text,text,text,text,text,text,boolean,text)')
       and fn.prosecdef;
  exception when others then
    v_owner := null;
  end;
  -- Is a signed-in account on the request. Cannot fail; unknown means yes.
  begin
    v_signed_in := auth.uid() is not null;
  exception when others then
    v_signed_in := true;
  end;

  if v_owner is not null and current_user = v_owner then
    -- The signing function. A signed-in account calling it is not the
    -- anonymous signing page, so it is treated as a client below.
    if not v_signed_in then
      v_page := true;
    end if;
  elsif current_user in ('service_role', 'postgres', 'supabase_admin') then
    v_server := true;
  end if;

  if tg_op = 'INSERT' then
    -- The signing page never inserts a row, so no insert is 'signing_page'.
    if not v_page and not v_server and (v_new_sig or new.signed_at is not null) then
      new.signed_via := 'contractor_account';
    else
      new.signed_via := null;
    end if;
    return new;
  end if;

  -- UPDATE of a row whose marker is still empty. Start from empty: whatever
  -- the request sent for signed_via is dropped.
  new.signed_via := null;
  if v_page then
    -- Exactly what lien_waiver_submit_signature does: an unsigned row is signed.
    if old.signed_at is null and new.signed_at is not null then
      new.signed_via := 'signing_page';
    end if;
  elsif not v_server then
    -- A client put a signature or a signed time on the row (a paper record
    -- included). A row signed before this file, written back unchanged, is
    -- not touched: it stays not known.
    if (new.signed_at is not null and new.signed_at is distinct from old.signed_at)
       or (v_new_sig and new.sub_signature is distinct from old.sub_signature) then
      new.signed_via := 'contractor_account';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.lien_waivers_signed_via() from public;

drop trigger if exists lien_waivers_signed_via on public.lien_waivers;
create trigger lien_waivers_signed_via
  before insert or update on public.lien_waivers
  for each row execute function public.lien_waivers_signed_via();

-- ── self-check ───────────────────────────────────────────────────────────────
-- Fail the apply, not a later signature, if a piece did not land as written.
do $$
declare
  g      record;
  v_src  text;
  v_bad  text;
begin
  for g in
    select * from (values
      ('public.co_approval_provenance()',   'public.change_order_approvals', 'change_order_approvals', 'recorded_via', 'change_order_approvals_provenance',
       'public.portal_submit_co_approval_signed(text,text,text,text,text,text,text,text,text,text,text,text,boolean)'),
      ('public.lien_waivers_signed_via()',  'public.lien_waivers',           'lien_waivers',           'signed_via',   'lien_waivers_signed_via',
       'public.lien_waiver_submit_signature(uuid,text,text,text,text,text,text,boolean,text)')
    ) as t(fn, tbl, tbl_name, col, trg, server_fn)
  loop
    -- The column: text, nullable, no default (a default would mark old rows).
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = g.tbl_name and column_name = g.col
                      and data_type = 'text' and is_nullable = 'YES' and column_default is null) then
      raise exception '[signature-provenance] verify: %.% must be a nullable text column with no default', g.tbl, g.col;
    end if;

    -- The function: SECURITY INVOKER, the owner lookup, the signed-in test, the named server roles, no client role by name.
    v_src := null;
    select p.prosrc into v_src from pg_proc p where p.oid = g.fn::regprocedure and not p.prosecdef;
    if v_src is null then
      raise exception '[signature-provenance] verify: % must exist and be SECURITY INVOKER (as a definer it would see its own owner as current_user and mark every row the same)', g.fn;
    end if;
    if position('pg_catalog.to_regprocedure(''' || g.server_fn || ''')' in v_src) = 0
       or position('and fn.prosecdef;' in v_src) = 0
       or position('if v_owner is not null and current_user = v_owner then' in v_src) = 0
       or position('v_signed_in := auth.uid() is not null;' in v_src) = 0
       or position('current_user in (''service_role'', ''postgres'', ''supabase_admin'')' in v_src) = 0
       or position('''authenticated''' in v_src) > 0
       or position('''anon''' in v_src) > 0
       or v_src ~* 'current_user\s+not\s+in|current_user\s*(<>|!=)'
       or v_src ~* '\mraise\M' then
      raise exception '[signature-provenance] verify: % must look up the owner of %, test for a signed-in account, name the three server roles, name no client role and never raise', g.fn, g.server_fn;
    end if;
    -- The pin: the stored marker is put back, and nothing a request sends is kept.
    if position('new.' || g.col || ' := old.' || g.col || ';' in v_src) = 0
       or v_src ~* ('new\.' || g.col || '\s*:=\s*new\.')
       or v_src ~* ('coalesce\s*\(\s*new\.' || g.col) then
      raise exception '[signature-provenance] verify: % must put % back on update and never keep what a request sent', g.fn, g.col;
    end if;

    -- The trigger: there, enabled, before insert or update, each row, every column.
    -- pg_trigger.tgtype: 1 row, 2 before, 4 insert, 16 update.
    if not exists (select 1 from pg_trigger t
                    where t.tgrelid = g.tbl::regclass and t.tgname = g.trg
                      and not t.tgisinternal and t.tgenabled <> 'D'
                      and t.tgfoid = g.fn::regprocedure
                      and (t.tgtype & 31) = 23 and t.tgattr = ''::int2vector) then
      raise exception '[signature-provenance] verify: trigger % on % is missing, disabled, or does not fire before every insert and update', g.trg, g.tbl;
    end if;

    -- No other trigger on the table writes the marker.
    v_bad := null;
    select string_agg(t.tgname, ', ' order by t.tgname) into v_bad
      from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where t.tgrelid = g.tbl::regclass and not t.tgisinternal and t.tgname <> g.trg
       and p.prosrc ~* ('\m' || g.col || '\M');
    if v_bad is not null then
      raise exception '[signature-provenance] verify: another trigger on % names %: %', g.tbl, g.col, v_bad;
    end if;

    -- The looked-up signing function: still SECURITY DEFINER, owned by a role no request can run as.
    if not exists (select 1 from pg_proc p join pg_roles r on r.oid = p.proowner
                    where p.oid = g.server_fn::regprocedure and p.prosecdef
                      and r.rolname not in ('authenticated', 'anon', 'authenticator')) then
      raise exception '[signature-provenance] verify: % must be SECURITY DEFINER and owned by a role no request can run as', g.server_fn;
    end if;
  end loop;

  -- change_order_approvals: the insert sets the server clock for every writer.
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.co_approval_provenance()'::regprocedure;
  if position('new.created_at := pg_catalog.now();' in v_src) = 0
     or position('new.recorded_via := ''portal_function'';' in v_src) = 0
     or position('new.recorded_via := ''contractor_account'';' in v_src) = 0 then
    raise exception '[signature-provenance] verify: co_approval_provenance lost the server clock or one of its two markers';
  end if;

  -- lien_waivers: the two markers and the unsigned-to-signed test.
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.lien_waivers_signed_via()'::regprocedure;
  if position('new.signed_via := ''signing_page'';' in v_src) = 0
     or position('new.signed_via := ''contractor_account'';' in v_src) = 0
     or position('if old.signed_at is null and new.signed_at is not null then' in v_src) = 0 then
    raise exception '[signature-provenance] verify: lien_waivers_signed_via lost one of its two markers or the unsigned-to-signed test';
  end if;
end $$;

-- The API learns the two new columns.
notify pgrst, 'reload schema';
