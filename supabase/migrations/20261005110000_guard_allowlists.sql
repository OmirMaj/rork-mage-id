-- ============================================================================
-- 20261005110000_guard_allowlists.sql
-- Five column guards stop naming who may NOT write and name who MAY.
--
-- WHAT. Four applied migrations protect columns with trigger functions that
--   act on "a client", and each spelled a client as two role names:
--   current_user in ('authenticated', 'anon'). Every other role passed. That
--   is a deny-list: a role created later (a reporting role, an integration
--   role, a second API role) that is given INSERT / UPDATE / DELETE on the
--   table is not on it, so it would write straight past the guard.
--   This file replaces the five function bodies. Each now opens by deciding
--   whether the writing role is THE SERVER (an allow-list, below) and treats
--   every other role exactly as it treated authenticated and anon before.
--   Nothing else moves: the same columns are pinned, the same rows are
--   neutralised, nothing raises that did not raise, the triggers themselves,
--   their order, the functions' owners, grants, SECURITY INVOKER and
--   search_path are not touched (create or replace keeps owner and ACL).
--   scripts/validate-w5-rls-hardening-sql.ts holds each new body equal to the
--   old one with only the role test swapped.
--
--     function (table)                          first written in
--     public.invoices_ledger_guard()            20260920020000_invoice_payment_ledger.sql
--       (invoices, before update)
--     public.aia_pay_apps_pending_guard()       20260920020000_invoice_payment_ledger.sql
--       (aia_pay_apps, before update)
--     public.change_orders_keep_number_fn()     20260920050000_change_order_numbers.sql
--       (change_orders, before update)
--     public.punch_items_guard()                20260920120000_punch_sub_portal_v2.sql
--       (punch_items, before update)
--     public.punch_items_seal_pin()             20261002150000_punch_seals.sql
--       (punch_items, before insert / update / delete)
--   No later migration redefines any of the five (grepped); these are built on
--   those definitions.
--   Not changed, on purpose: public.punch_seals_immutable() (same file as the
--   seal pin). Its one role test, on DELETE, already names who may
--   (service_role, or the auth.users cascade); every other role is refused.
--   Not changed, and still to do: two guards of 20260923130000_lien_prequal_hardening.sql
--   test one client role by name (lien_waivers_protect_signature,
--   prequal_packets_protect_submission). Same weakness, other tables, their
--   own writers to read first. The validator lists them; the list may only shrink.
--
-- THE ALLOW-LIST, the same in all five and the same as
--   profiles_keep_ai_consent (20261004100000_ai_consent_hardening.sql) and the
--   two whoson guards (20261004120000_project_people.sql):
--     - service_role: the edge functions;
--     - postgres and supabase_admin: the SQL editor, a migration, a restore, a
--       foreign-key cascade on a table those roles own, and every SECURITY
--       DEFINER function those roles own (inside one, current_user is its
--       owner);
--     - the role that owns one named SECURITY DEFINER function, the guard's
--       own server-side writer. It is looked up at the write, not assumed: on
--       a database whose migrations ran as some other role, that role and the
--       definer functions it owns are the server too. The lookup cannot raise
--       (a missing function is NULL, anything else is caught); when it cannot
--       tell, the writer is a client.
--   EVERYONE ELSE IS A CLIENT: the two roles PostgREST gives a request today,
--   the role PostgREST logs in as, and any role created later, whatever grants
--   or policies it is given, and any SECURITY DEFINER function such a role
--   owns. No body below names a client role.
--
-- WHO PASSES, PER GUARD (every writer in the repo was read; file:line).
--   1. invoices_ledger_guard. Looked-up owner: public.invoice_append_payment(uuid, jsonb).
--      Must pass, because they have already computed the ledger themselves:
--        - invoice_append_payment (20260920020000:144, SECURITY DEFINER; the
--          app's queued 'rpc' op and stripe-webhook/index.ts:554 both call it):
--          runs as its owner. (Run and seen: its own UPDATE comes out the
--          same even when the guard treats it as a client, because the guard's
--          merge of old + one new entry is what it wrote. The pass matters
--          for a direct write by that owner, not for the append.)
--        - stripe-webhook (service_role): the pending bank-payment marker and
--          its clears (index.ts:579, :946, :959), paid / refund / dispute
--          writes (:597, :1168);
--        - qbo-sync, qbo-reconciler, _shared/qbo-mapping (service_role, svc()
--          in _shared/qbo.ts:32): payments entries' QuickBooks ids
--          (qbo-sync/index.ts:53, qbo-reconciler/index.ts:115,
--          _shared/qbo-mapping/payment.ts:225), sync status, voids;
--        - invoice-dunning (service_role, index.ts:700): dunning markers;
--        - portal_mark_item_viewed (20260527000100:11, SECURITY DEFINER, called
--          by the portal-mark-viewed edge function): runs as its owner; it
--          writes portal_state only, which the guard never touches;
--        - delete-account (service_role): deletes (the guard is UPDATE only).
--      Everyone else: the pending marker is put back, the ledger only grows by
--      entry id, amount_paid is the ledger sum, a sent / partially_paid / paid
--      status follows the money. The app (authenticated) is in this group
--      today and stays in it.
--   2. aia_pay_apps_pending_guard. Looked-up owner: public.invoice_append_payment(uuid, jsonb)
--      (the role that applied the ledger migration; no definer function writes
--      the marker on this table).
--      Must pass: stripe-webhook (service_role) stamping and clearing the
--      marker (index.ts:894, :959, :1055). portal_mark_item_viewed writes
--      portal_state only. Everyone else: the three pay_pending_* columns are
--      put back.
--   3. change_orders_keep_number_fn. Looked-up owner: public.change_orders_assign_number_fn()
--      (the definer trigger function of the same file).
--      Must pass: a repair as service_role or in the SQL editor, and the
--      renumber loop of 20260920050000:113 (runs as the role applying it).
--      No edge function and no SQL function in the repo changes a number on
--      UPDATE: portal_submit_co_approval / _signed (20260920060000:337, :383)
--      and portal_mark_item_viewed write status, portal_state and the audit
--      trail. Everyone else: number is put back.
--   4. punch_items_guard. Looked-up owner: public.sub_portal_mark_punch_ready(text, text, text, text).
--      Must pass:
--        - sub_portal_mark_punch_ready (20260920120000:318, SECURITY DEFINER,
--          called by anon from the sub's page): it writes sub_note, the one
--          column no client may write. If its owner were not passed the sub's
--          "done" note would be dropped without an error;
--        - delete-account (service_role, index.ts:868): the handover moves
--          user_id to the project owner;
--        - seal-punch (service_role, index.ts:283): writes seal_id only.
--      Everyone else: user_id and sub_note are put back, a row in Review goes
--      back onto the sub only by a real reject, the reject clock never runs
--      backwards. Rule d (sub_note cleared on a real reject or a new sub) is
--      for every role, as before.
--   5. punch_items_seal_pin. Looked-up owner: public.sub_portal_mark_punch_ready(text, text, text, text)
--      (the only SQL function that writes punch_items).
--      Must pass:
--        - seal-punch (service_role, index.ts:283): the one writer of seal_id;
--        - delete-account (service_role, index.ts:959-998): deletes sealed rows;
--        - the foreign-key cascades from auth.users and public.projects: a
--          cascade's DELETE runs as the OWNER of public.punch_items, whoever
--          started it. That owner must be on the list, or a sealed row would
--          be skipped by a cascade. The preflight refuses the apply if not.
--      Everyone else: seal_id is emptied on INSERT and put back on UPDATE, and
--      a DELETE of a sealed row is skipped. A sealed row's content is pinned
--      for every role, as before.
--
-- THE RISK OF APPLYING, AND WHAT RULES IT OUT. Before this file every role but
--   two passed; after it only the roles above pass. The one way this breaks a
--   write that works today: a legitimate writer that runs as a role NOT on the
--   list. It would not error. Its write would be treated as a client's: a sub's
--   note dropped (4), a seal_id not set or a sealed row not deleted (5), a
--   webhook's pending marker not stamped or a refund's ledger edit merged away
--   (1, 2), a repair's renumber put back (3). In the repo there is no such
--   writer: every writer is service_role, a function owned by the role that
--   applied the migrations, or a cascade on a table that role owns. Production
--   is the thing to read, so:
--     a. the preflight at the top of this file REFUSES THE APPLY, before any
--        function is replaced, when a SECURITY DEFINER function in public that
--        names one of the four tables is owned by a role the table's guard
--        would call a client, when one of the four tables is owned by such a
--        role, or when a looked-up function is owned by a role a request can
--        run as;
--     b. the read-only queries below show the same facts, and three the
--        preflight cannot see (the cron jobs, which roles hold write grants,
--        and whether production's five functions are still the repo's text),
--        BEFORE anything is applied.
--
-- BEFORE APPLYING, read production (read-only; Supabase MCP execute_sql).
--   B1. the five functions are still what the repo says (nobody edited them in
--       the SQL editor), are SECURITY INVOKER, and still hold the deny-list:
--     select p.proname, p.prosecdef, md5(p.prosrc) as body_md5,
--            position('''authenticated'', ''anon''' in p.prosrc) > 0 as deny_list
--       from pg_proc p
--      where p.pronamespace = 'public'::regnamespace
--        and p.proname in ('invoices_ledger_guard', 'aia_pay_apps_pending_guard',
--                          'change_orders_keep_number_fn', 'punch_items_guard', 'punch_items_seal_pin')
--      order by 1;
--     -- expected: five rows, prosecdef false, deny_list true, and
--     --   aia_pay_apps_pending_guard    317bf56b9b550cf0a5660b56a78a39a9
--     --   change_orders_keep_number_fn  ab0796d13540a025a3846cbf8ac296ef
--     --   invoices_ledger_guard         cce186bc1ce86b5ca57f0248b17c8c97
--     --   punch_items_guard             72d77d9a54f6606c345e8aee51e87803
--     --   punch_items_seal_pin          085a96a850f739b7f8eaf68bf81a30bb
--     -- A different md5 means production's function is not the repo's: stop
--     -- and read it (select prosrc) before replacing it.
--   B2. who owns the SECURITY DEFINER functions (inside one, current_user is
--       its owner):
--     select r.rolname, count(*) as definer_functions
--       from pg_proc p join pg_roles r on r.oid = p.proowner
--      where p.pronamespace = 'public'::regnamespace and p.prosecdef
--      group by 1 order by 1;
--     -- expected: one row, postgres (supabase_admin is also on the list).
--     select p.oid::regprocedure as fn, r.rolname as owner, p.prosecdef
--       from pg_proc p join pg_roles r on r.oid = p.proowner
--      where p.oid in ('public.invoice_append_payment(uuid,jsonb)'::regprocedure,
--                      'public.change_orders_assign_number_fn()'::regprocedure,
--                      'public.sub_portal_mark_punch_ready(text,text,text,text)'::regprocedure,
--                      'public.portal_mark_item_viewed(text,text,text,timestamptz)'::regprocedure);
--     -- expected: four rows, owner postgres, prosecdef true.
--   B3. who owns the four tables (a foreign-key cascade writes as the owner):
--     select c.relname, r.rolname as owner
--       from pg_class c join pg_roles r on r.oid = c.relowner
--      where c.oid in ('public.invoices'::regclass, 'public.aia_pay_apps'::regclass,
--                      'public.change_orders'::regclass, 'public.punch_items'::regclass);
--     -- expected: four rows, postgres.
--   B4. which roles can write the four tables at all:
--     select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as can
--       from information_schema.role_table_grants
--      where table_schema = 'public'
--        and table_name in ('invoices', 'aia_pay_apps', 'change_orders', 'punch_items')
--        and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
--      group by 1, 2 order by 1, 2;
--     -- expected grantees: anon, authenticated, postgres, service_role. Any
--     -- other grantee is the role this file is about: find out what writes as
--     -- it BEFORE applying. If it is a real writer of a guarded column, it is
--     -- stopped by this file and must be moved to service_role first.
--     select rolname, rolsuper, rolbypassrls, rolcanlogin from pg_roles
--      where rolname !~ '^pg_' order by 1;
--     -- the roles that exist. Supabase's own (anon, authenticated,
--     -- authenticator, dashboard_user, pgbouncer, postgres, service_role,
--     -- supabase_admin, supabase_auth_admin, supabase_storage_admin, ...) are
--     -- expected; a role nobody can name is not.
--   B5. which role each cron job runs as, and that none writes the four tables
--       in SQL (every job in the repo is an http call to an edge function, or
--       a purge of another table):
--     select jobid, jobname, username, active,
--            command ~* '\m(invoices|aia_pay_apps|change_orders|punch_items)\M' as names_a_guarded_table
--       from cron.job order by jobname;
--     -- expected: username postgres on every row, names_a_guarded_table false.
--   B6. the triggers on the four tables (nothing unknown writes them):
--     select c.relname, t.tgname, p.proname, p.prosecdef, t.tgenabled
--       from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
--      where not t.tgisinternal
--        and c.oid in ('public.invoices'::regclass, 'public.aia_pay_apps'::regclass,
--                      'public.change_orders'::regclass, 'public.punch_items'::regclass)
--      order by 1, 2;
--
-- DEPLOY ORDER. After the four migrations above (this file refuses to run
--   without them). Before or after any edge function deploy and any app
--   version: no column, signature, grant, trigger or return shape changes.
--   Apply through the Supabase MCP apply_migration, never `supabase db push`.
--   Idempotent: a second run is a no-op.
--
-- VERIFY AFTER
--   select p.proname, p.prosecdef, md5(p.prosrc) as body_md5,
--          position('current_user in (''service_role'', ''postgres'', ''supabase_admin'')' in p.prosrc) > 0 as allow_list,
--          position('''authenticated''' in p.prosrc) + position('''anon''' in p.prosrc) as client_names
--     from pg_proc p
--    where p.pronamespace = 'public'::regnamespace
--      and p.proname in ('invoices_ledger_guard', 'aia_pay_apps_pending_guard',
--                        'change_orders_keep_number_fn', 'punch_items_guard', 'punch_items_seal_pin')
--    order by 1;
--   -- five rows, prosecdef false, allow_list true, client_names 0, and
--   --   aia_pay_apps_pending_guard    f54afe0cba146c84e4343238349e8471
--   --   change_orders_keep_number_fn  9da983aa9b5289cbe29895b131785f68
--   --   invoices_ledger_guard         3e3f1acb2c0e8f1e16d11282af7c13b7
--   --   punch_items_guard             8ada6a3cb0a9f1aae53f65e1d6deaa72
--   --   punch_items_seal_pin          3dd9df086f17755647841a110b371bde
--   select c.relname, t.tgname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where t.tgname in ('invoices_ledger_guard', 'aia_pay_apps_pending_guard', 'change_orders_keep_number',
--                       'punch_items_guard', 'punch_items_seal_pin') and not t.tgisinternal order by 1, 2;
--   -- five rows, tgenabled O (the triggers were not touched).
--   Then one real write of each kind, watched in the app: record a payment on
--   an invoice (the balance moves), mark a punch item ready from a sub link
--   with a note (the note shows in the app), edit a change order (its number
--   stays).
--
-- REVERSE PATH. Run again, as written, the five "create or replace function"
--   statements of the four files named above (each restores its two-role
--   test). Nothing else needs undoing: this file creates no object.
--
-- PROVEN on PGlite (scratchpad pgq/guard-allowlists.mjs): the four files and
--   this one, twice, on production-shaped tables; every writer above run as
--   the role it runs as; authenticated and anon stopped as before; an invented
--   third role with every table privilege stopped; planted mutations.
-- ============================================================================

-- ── preflight: refuse BEFORE anything is replaced ───────────────────────────
-- One row per guard: the function, the table it guards (and its bare name), the
-- trigger that calls it, the trigger's event bits (pg_trigger.tgtype: 2 before,
-- 4 insert, 8 delete, 16 update), and the definer function whose owner it looks
-- up. The same six-column list is repeated in the self-check at the foot.
do $$
declare
  g        record;
  v_owner  name;
  v_bad    text;
begin
  if to_regprocedure('public.invoices_ledger_guard()') is null
     or to_regprocedure('public.aia_pay_apps_pending_guard()') is null
     or to_regprocedure('public.change_orders_keep_number_fn()') is null
     or to_regprocedure('public.punch_items_guard()') is null
     or to_regprocedure('public.punch_items_seal_pin()') is null
     or to_regprocedure('public.invoice_append_payment(uuid,jsonb)') is null
     or to_regprocedure('public.change_orders_assign_number_fn()') is null
     or to_regprocedure('public.sub_portal_mark_punch_ready(text,text,text,text)') is null
  then
    raise exception '[guard-allowlists] apply 20260920020000, 20260920050000, 20260920120000 and 20261002150000 first: a guard function or the server function it looks up is missing';
  end if;

  for g in
    select * from (values
      ('public.invoices_ledger_guard()',        'public.invoices',      'invoices',      'invoices_ledger_guard',      18, 'public.invoice_append_payment(uuid,jsonb)'),
      ('public.aia_pay_apps_pending_guard()',   'public.aia_pay_apps',  'aia_pay_apps',  'aia_pay_apps_pending_guard', 18, 'public.invoice_append_payment(uuid,jsonb)'),
      ('public.change_orders_keep_number_fn()', 'public.change_orders', 'change_orders', 'change_orders_keep_number',  18, 'public.change_orders_assign_number_fn()'),
      ('public.punch_items_guard()',            'public.punch_items',   'punch_items',   'punch_items_guard',          18, 'public.sub_portal_mark_punch_ready(text,text,text,text)'),
      ('public.punch_items_seal_pin()',         'public.punch_items',   'punch_items',   'punch_items_seal_pin',       30, 'public.sub_portal_mark_punch_ready(text,text,text,text)')
    ) as t(fn, tbl, tbl_name, trg, bits, server_fn)
  loop
    -- The fourth role the guard will pass is whoever owns its server function.
    select r.rolname into v_owner
      from pg_proc p join pg_roles r on r.oid = p.proowner
     where p.oid = g.server_fn::regprocedure and p.prosecdef;
    if v_owner is null then
      raise exception '[guard-allowlists] preflight: % must be SECURITY DEFINER; % looks its owner up. Nothing was changed', g.server_fn, g.fn;
    end if;
    if v_owner in ('authenticated', 'anon', 'authenticator') then
      raise exception '[guard-allowlists] preflight: % is owned by %, a role a request can run as: % would let that role through. Nothing was changed', g.server_fn, v_owner, g.fn;
    end if;

    -- A foreign-key cascade writes the table as the table's owner. If that
    -- role is not the server, a cascade would be treated as a client.
    v_bad := null;
    select r.rolname into v_bad
      from pg_class c join pg_roles r on r.oid = c.relowner
     where c.oid = g.tbl::regclass
       and r.rolname not in ('service_role', 'postgres', 'supabase_admin', v_owner);
    if v_bad is not null then
      raise exception '[guard-allowlists] preflight: % is owned by %, which % would treat as a client: a foreign-key cascade on that table runs as its owner. Nothing was changed', g.tbl, v_bad, g.fn;
    end if;

    -- A SECURITY DEFINER function that names the table writes it as its owner.
    -- Before this file any owner passed; refuse rather than turn one into a client.
    select string_agg(p.oid::regprocedure::text || ' (owner ' || r.rolname || ')', ', ' order by p.oid::regprocedure::text) into v_bad
      from pg_proc p
      join pg_roles r on r.oid = p.proowner
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.prosecdef
       and p.prosrc ~* ('\m' || g.tbl_name || '\M')
       and r.rolname not in ('service_role', 'postgres', 'supabase_admin', v_owner);
    if v_bad is not null then
      raise exception '[guard-allowlists] preflight: % would treat these SECURITY DEFINER functions as clients, and they name %: %. Nothing was changed: read them, then give them the server''s owner', g.fn, g.tbl, v_bad;
    end if;
  end loop;
end $$;

-- All five open the same way (the self-check and the validator hold the five
-- copies equal): three named server roles, then the owner of one definer
-- function, looked up inside a block that cannot raise. The allow-list is not
-- a shared helper function on purpose: a trigger calls a helper as the writing
-- role, which would then need EXECUTE on it, and a missing grant would fail
-- every save of the table. All five stay SECURITY INVOKER: the rule reads
-- current_user, which inside a definer function is the function's owner.

-- ── 1. invoices: no app write can shrink the ledger ─────────────────────────
create or replace function public.invoices_ledger_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_server boolean := false;
  v_owner name;
  v_old jsonb;
  v_new jsonb;
  v_merged jsonb;
  v_ids text[];
  v_el jsonb;
  v_paid numeric;
  v_net numeric;
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    v_server := true;
  else
    begin
      select ro.rolname into v_owner
        from pg_catalog.pg_proc fn
        join pg_catalog.pg_roles ro on ro.oid = fn.proowner
       where fn.oid = pg_catalog.to_regprocedure('public.invoice_append_payment(uuid,jsonb)');
    exception when others then
      v_owner := null;
    end;
    if v_owner is not null and current_user = v_owner then
      v_server := true;
    end if;
  end if;

  -- The server only. invoice_append_payment runs as its owner and the webhook
  -- as service_role; both have already computed the ledger themselves.
  if v_server then
    return new;
  end if;

  -- The pending bank-payment marker is the webhook's alone.
  new.pay_pending_at := old.pay_pending_at;
  new.pay_pending_amount := old.pay_pending_amount;
  new.pay_pending_session := old.pay_pending_session;

  if new.payments is distinct from old.payments or new.amount_paid is distinct from old.amount_paid then
    v_old := case when jsonb_typeof(old.payments) = 'array' then old.payments else '[]'::jsonb end;
    v_new := case when jsonb_typeof(new.payments) = 'array' then new.payments else '[]'::jsonb end;
    -- Union by id: every entry the server holds stays exactly as it is; an
    -- entry only the device has (a check recorded offline) is added.
    v_merged := v_old;
    select coalesce(array_agg(e ->> 'id'), '{}') into v_ids
      from jsonb_array_elements(v_old) e
     where jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'id') = 'string';
    for v_el in select value from jsonb_array_elements(v_new) loop
      if jsonb_typeof(v_el) = 'object' and jsonb_typeof(v_el -> 'id') = 'string'
         and length(btrim(v_el ->> 'id')) > 0
         and not ((v_el ->> 'id') = any (v_ids)) then
        v_merged := v_merged || jsonb_build_array(v_el);
        v_ids := v_ids || (v_el ->> 'id');
      end if;
    end loop;
    new.payments := v_merged;
    v_paid := greatest(0, public.invoice_ledger_sum(v_merged));
    new.amount_paid := v_paid;
    v_net := public.invoice_net_payable(new.total_due, new.subtotal, new.retention_percent,
                                        new.retention_amount, new.retention_released);
    -- The device's status was computed from its stale balance; the money decides.
    new.status := public.invoice_settlement_status(old.status, v_paid, v_net);
  elsif new.status is distinct from old.status and new.status in ('sent', 'partially_paid', 'paid') then
    -- A status-only write (a retention release re-opening the invoice, Mark
    -- sent) is judged against the SERVER's ledger, not the device's copy.
    v_net := public.invoice_net_payable(new.total_due, new.subtotal, new.retention_percent,
                                        new.retention_amount, new.retention_released);
    new.status := public.invoice_settlement_status(new.status, coalesce(new.amount_paid, 0), v_net);
  end if;
  return new;
end
$$;

-- ── 2. aia_pay_apps: the pending marker is the webhook's alone ──────────────
create or replace function public.aia_pay_apps_pending_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_server boolean := false;
  v_owner name;
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    v_server := true;
  else
    begin
      select ro.rolname into v_owner
        from pg_catalog.pg_proc fn
        join pg_catalog.pg_roles ro on ro.oid = fn.proowner
       where fn.oid = pg_catalog.to_regprocedure('public.invoice_append_payment(uuid,jsonb)');
    exception when others then
      v_owner := null;
    end;
    if v_owner is not null and current_user = v_owner then
      v_server := true;
    end if;
  end if;

  if not v_server then
    new.pay_pending_at := old.pay_pending_at;
    new.pay_pending_amount := old.pay_pending_amount;
    new.pay_pending_session := old.pay_pending_session;
  end if;
  return new;
end
$$;

-- ── 3. change_orders: only the server moves a number after insert ───────────
create or replace function public.change_orders_keep_number_fn()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_server boolean := false;
  v_owner name;
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    v_server := true;
  else
    begin
      select ro.rolname into v_owner
        from pg_catalog.pg_proc fn
        join pg_catalog.pg_roles ro on ro.oid = fn.proowner
       where fn.oid = pg_catalog.to_regprocedure('public.change_orders_assign_number_fn()');
    exception when others then
      v_owner := null;
    end;
    if v_owner is not null and current_user = v_owner then
      v_server := true;
    end if;
  end if;

  if not v_server and NEW.number is distinct from OLD.number then
    NEW.number := OLD.number;
  end if;
  return NEW;
end;
$function$;

-- ── 4. punch_items: the creator, the sub's words, Review, the reject clock ──
create or replace function public.punch_items_guard()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_server boolean := false;
  v_owner name;
  v_real_reject boolean := new.rejected_at is not null
                           and (old.rejected_at is null or new.rejected_at > old.rejected_at);
  v_old_id text := nullif(btrim(coalesce(old.assigned_sub_id, '')), '');
  v_new_id text := nullif(btrim(coalesce(new.assigned_sub_id, '')), '');
  v_reassigned boolean;
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    v_server := true;
  else
    begin
      select ro.rolname into v_owner
        from pg_catalog.pg_proc fn
        join pg_catalog.pg_roles ro on ro.oid = fn.proowner
       where fn.oid = pg_catalog.to_regprocedure('public.sub_portal_mark_punch_ready(text,text,text,text)');
    exception when others then
      v_owner := null;
    end;
    if v_owner is not null and current_user = v_owner then
      v_server := true;
    end if;
  end if;

  if not v_server then
    -- a. the creator and the sub's words are not the client's to rewrite.
    new.user_id := old.user_id;
    new.sub_note := old.sub_note;

    -- b. only a real reject takes an item out of Review back onto the sub.
    if coalesce(old.status, 'open') = 'ready_for_review'
       and new.status in ('open', 'in_progress')
       and not v_real_reject then
      new.status := old.status;
      new.closed_at := old.closed_at;
      new.rejection_note := old.rejection_note;
      new.rejected_at := old.rejected_at;
    end if;

    -- c. the reject clock never runs backwards from a client.
    if not v_real_reject then
      new.rejected_at := old.rejected_at;
    end if;
  end if;

  -- d. last round's note goes with a real reject or a new sub.
  -- Only a real change of sub: both ids known and different, or — when either
  -- id is missing — a different normalised name. Linking/dropping the id on
  -- the same named sub keeps his note.
  v_reassigned := case
    when v_old_id is not null and v_new_id is not null then v_old_id <> v_new_id
    else lower(btrim(coalesce(old.assigned_sub, ''))) <> lower(btrim(coalesce(new.assigned_sub, '')))
  end;
  if v_real_reject or v_reassigned then
    new.sub_note := null;
  end if;

  return new;
end;
$function$;

-- ── 5. punch_items: only the server sets seal_id; a sealed row is pinned ────
create or replace function public.punch_items_seal_pin()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_server boolean := false;
  v_owner name;
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    v_server := true;
  else
    begin
      select ro.rolname into v_owner
        from pg_catalog.pg_proc fn
        join pg_catalog.pg_roles ro on ro.oid = fn.proowner
       where fn.oid = pg_catalog.to_regprocedure('public.sub_portal_mark_punch_ready(text,text,text,text)');
    exception when others then
      v_owner := null;
    end;
    if v_owner is not null and current_user = v_owner then
      v_server := true;
    end if;
  end if;

  if tg_op = 'DELETE' then
    if old.seal_id is not null and not v_server then
      return null;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if not v_server then
      new.seal_id := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if not v_server then
    new.seal_id := old.seal_id;
  end if;
  if old.seal_id is not null then
    new.seal_id := old.seal_id;
    new.description := old.description;
    new.location := old.location;
    new.status := old.status;
    new.closed_at := old.closed_at;
    new.list_type := old.list_type;
    new.after_photo_uri := old.after_photo_uri;
    new.after_photo_taken_at := old.after_photo_taken_at;
    new.photo_uri := old.photo_uri;
  end if;
  return new;
end;
$function$;

-- ── self-check ───────────────────────────────────────────────────────────────
-- Fail the apply, not a later write, if a guard did not land as written.
do $$
declare
  g      record;
  v_src  text;
begin
  for g in
    select * from (values
      ('public.invoices_ledger_guard()',        'public.invoices',      'invoices',      'invoices_ledger_guard',      18, 'public.invoice_append_payment(uuid,jsonb)'),
      ('public.aia_pay_apps_pending_guard()',   'public.aia_pay_apps',  'aia_pay_apps',  'aia_pay_apps_pending_guard', 18, 'public.invoice_append_payment(uuid,jsonb)'),
      ('public.change_orders_keep_number_fn()', 'public.change_orders', 'change_orders', 'change_orders_keep_number',  18, 'public.change_orders_assign_number_fn()'),
      ('public.punch_items_guard()',            'public.punch_items',   'punch_items',   'punch_items_guard',          18, 'public.sub_portal_mark_punch_ready(text,text,text,text)'),
      ('public.punch_items_seal_pin()',         'public.punch_items',   'punch_items',   'punch_items_seal_pin',       30, 'public.sub_portal_mark_punch_ready(text,text,text,text)')
    ) as t(fn, tbl, tbl_name, trg, bits, server_fn)
  loop
    -- The guard: SECURITY INVOKER, the allow-list, its own lookup, no client role by name.
    v_src := null;
    select p.prosrc into v_src from pg_proc p where p.oid = g.fn::regprocedure and not p.prosecdef;
    if v_src is null then
      raise exception '[guard-allowlists] verify: % must exist and be SECURITY INVOKER (as a definer it would see its owner as current_user and guard nothing)', g.fn;
    end if;
    if position('current_user in (''service_role'', ''postgres'', ''supabase_admin'')' in v_src) = 0
       or position('v_owner is not null and current_user = v_owner' in v_src) = 0
       or position('pg_catalog.to_regprocedure(''' || g.server_fn || ''')' in v_src) = 0
       or position('''authenticated''' in v_src) > 0
       or position('''anon''' in v_src) > 0
       or v_src ~* 'current_user\s+not\s+in|current_user\s*(<>|!=)' then
      raise exception '[guard-allowlists] verify: % must be the allow-list (service_role, postgres, supabase_admin, the owner of %) and name no client role: a guard that still names the deny-list lets every later role through', g.fn, g.server_fn;
    end if;

    -- The trigger was not touched: still there, enabled, before, row, same events, every column.
    if not exists (select 1 from pg_trigger t
                    where t.tgrelid = g.tbl::regclass and t.tgname = g.trg
                      and not t.tgisinternal and t.tgenabled <> 'D'
                      and t.tgfoid = g.fn::regprocedure
                      and (t.tgtype & 31) = (g.bits | 1) and t.tgattr = ''::int2vector) then
      raise exception '[guard-allowlists] verify: trigger % on % is missing, disabled, or no longer fires as it did', g.trg, g.tbl;
    end if;
  end loop;
end $$;

-- Reload PostgREST's schema cache (no signature changed; harmless).
notify pgrst, 'reload schema';
