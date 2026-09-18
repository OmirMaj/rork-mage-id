-- ============================================================================
-- managed_properties + work_orders — a server copy of the Property Manager
-- portfolio.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- contexts/PropertyContext.tsx kept a PM's buildings and every open repair
-- (title, priority, budget, who it was assigned to) ONLY in AsyncStorage under
-- `mageid_managed_properties` / `mageid_work_orders`. Both are under the
-- `mageid_` prefix, so AuthContext.wipeLocalUserCache removes them on every
-- sign-out and on the next account's sign-in — and nothing existed to restore
-- them from. A manager with three buildings and eight open work orders signed
-- out once and came back to "Add your first property". The settings sign-out
-- prompt could not warn him either: it counts the offline queue, and
-- local-only records never enter it. The portfolio also never reached
-- app.mageid.app or a second phone — and a PM is exactly the user who works
-- from a desk and a phone.
--
-- Same shape as the Last Planner mirror (20260916150000): the client upserts
-- every change through utils/offlineQueue (so a change made offline is in the
-- queue the sign-out prompt DOES count), and rehydrates from these tables on
-- every sign-in (utils/propertyMirror.mergePortfolio). After this, the sweep
-- removes a cache, not the record.
--
-- ── ID TYPES ────────────────────────────────────────────────────────────────
-- text: ids are generated on the device (generateUUID), possibly offline.
-- rfp_id is uuid because it points at public_bids.id.
--
-- ── updated_at IS THE CLIENT'S ──────────────────────────────────────────────
-- No trigger rewrites updated_at. The merge on the device picks the newer copy
-- by comparing the updatedAt each device stamped; a server-side now() would
-- make a queued offline edit look newer than a later edit made on the laptop.
--
-- ── DELETES ARE TOMBSTONES ──────────────────────────────────────────────────
-- Deleting a property or work order upserts it with deleted_at set, so a
-- second device can tell "deleted on the laptop" from "never synced" and
-- drops its copy instead of uploading it back.
--
-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Owner-only on all four commands, TO authenticated — the last_planner_*
-- shape. Staff access is a product decision, not a default.
--
-- ── ORDER OF OPERATIONS ─────────────────────────────────────────────────────
-- Apply BEFORE the OTA that ships the mirror. Before it exists every write is
-- a PostgREST schema-cache miss that offlineQueue re-queues (nothing lost,
-- nothing synced), and the read falls back to the device copy.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.managed_properties (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  address text,
  property_type text,
  units integer CHECK (units IS NULL OR units >= 0),
  owner_name text,
  owner_phone text,
  owner_email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS managed_properties_user_idx
  ON public.managed_properties(user_id);

CREATE TABLE IF NOT EXISTS public.work_orders (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- No FK: a work order and its property may reach the server in either
  -- order from the offline queue, and a tombstoned property keeps its row.
  property_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  description text,
  category text,
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'emergency')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'posted_for_bids', 'assigned', 'in_progress', 'done', 'cancelled')),
  -- Money to the cent.
  budget numeric(12, 2),
  assigned_contact_id text,
  assigned_contact_name text,
  assigned_at timestamptz,
  linked_lead_id text,
  -- The public_bids row the PM posted this work order as, once post-rfp
  -- returns it. No FK so a withdrawn RFP does not block the work order.
  rfp_id uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS work_orders_user_idx ON public.work_orders(user_id);
CREATE INDEX IF NOT EXISTS work_orders_property_idx ON public.work_orders(property_id);
CREATE INDEX IF NOT EXISTS work_orders_rfp_idx ON public.work_orders(rfp_id) WHERE rfp_id IS NOT NULL;

ALTER TABLE public.managed_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['managed_properties', 'work_orders']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() = user_id)', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (auth.uid() = user_id)', t || '_delete', t);

    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END
$rls$;

-- ============================================================================
-- VERIFY AFTER APPLYING
-- 1. Eight policies, all owner-scoped, TO authenticated:
--    select c.relname, p.polname, pg_get_expr(p.polqual, p.polrelid)
--    from pg_policy p join pg_class c on c.oid = p.polrelid
--    where c.relname in ('managed_properties', 'work_orders') order by 1, 2;
-- 2. As user B, select count(*) from public.work_orders → 0 of A's rows;
--    an insert with user_id = A is rejected.
-- 3. NOTIFY pgrst, 'reload schema'; open the PM home on a device with queued
--    writes and confirm mageid_offline_queue drains.
-- ============================================================================
