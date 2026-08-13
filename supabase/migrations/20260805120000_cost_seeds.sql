-- ============================================================================
-- cost_seeds — the contractor's SELF-REPORTED rates, made durable.
--
-- Shipped 2026-08-03 (utils/costSeedCore + hooks/useCostSeeds + app/cost-seed),
-- cost seeding fixes the cold start: utils/costDatabase learns only from jobs
-- closed inside MAGE, so a twenty-year GC's day-one estimate was a beginner's.
-- Seeding lets them paste the rates they already know so their FIRST estimate
-- is priced from their own numbers.
--
-- ── WHY THIS TABLE EXISTS ───────────────────────────────────────────────────
-- V1 persisted seeds ONLY to AsyncStorage (`mageid_cost_seeds`). That means the
-- data the entire cost moat depends on did not survive a reinstall and never
-- reached a second device: a contractor who typed forty rates and then
-- reinstalled lost all forty, silently. A price book that evaporates is worse
-- than no price book, because they had already stopped double-checking it.
--
-- ── WHY THE PRIMARY KEY IS COMPOSITE ────────────────────────────────────────
-- THIS IS THE ONE THING THAT MUST NOT BE "FIXED" TO MATCH delay_events.
--
-- delay_events / change_orders / field_tickets use `id text PRIMARY KEY` because
-- their ids are client-generated UUIDs — globally unique by construction.
-- A SeededRate id is NOT a UUID. utils/costSeedCore.seedId derives it
-- deterministically from trade+unit:
--
--     seedId('Framing', 'SF')  ===  seedId('framing', 'sf')  ===  'seed-framing-sf'
--
-- That determinism is load-bearing: re-importing a corrected spreadsheet must
-- UPDATE the row rather than stack a duplicate (scripts/validate-cost-seed.ts
-- pins it). But it also means EVERY contractor who frames walls produces the
-- id 'seed-framing-sf'. With a single-column PK, the first GC to sync would
-- own that id globally and every other GC's insert would fail a duplicate-key
-- violation — which utils/offlineQueue.ts classifies as TERMINAL ("violates",
-- not a foreign key) and DISCARDS. The second contractor's framing rate would
-- be dropped on the floor with a toast and never retried.
--
-- So: PRIMARY KEY (user_id, id). The id is unique per contractor, which is
-- exactly the scope it was designed for.
--
-- Consequence for writes: hooks/useCostSeeds uses supabaseWrite('cost_seeds',
-- 'upsert', …), and PostgREST infers the ON CONFLICT target from this PK. The
-- upsert payload therefore MUST carry both user_id and id. A re-import of the
-- same trade+unit lands as ON CONFLICT DO UPDATE — a correction, not a
-- duplicate — which is the same semantic mergeSeeds() applies locally.
--
-- Deliberately NO second unique constraint on (user_id, lower(trade),
-- lower(unit)). It would be very slightly finer-grained than the id (seedKey
-- keeps punctuation, seedId collapses it, so 'Framing!' and 'Framing' share an
-- id but not a key) and any row pair that tripped it would hard-fail the write,
-- which the offline queue treats as terminal. Last-write-wins on the id is the
-- correct, non-destructive behaviour for that pathological pair.
--
-- ── WHY THERE IS NO SEPARATE user_id INDEX ──────────────────────────────────
-- delay_events needs delay_events_user_idx because its PK is (id) alone. Here
-- the PK index is already (user_id, id) with user_id leading, so it serves the
-- only query this table has ("all of my seeds") without a redundant index.
--
-- ── THE FIREWALL, RESTATED IN SQL ───────────────────────────────────────────
-- A seed is a CLAIM, not a MEASUREMENT. Nothing about persisting it may blur
-- that. In particular `reported_jobs` is the contractor's own "I've done this
-- 40 times" and is DISPLAY ONLY — it must never be summed into
-- CostBookEntry.jobCount or CostDatabase.jobsAnalyzed. The separation is
-- enforced in utils/costSeedCore (basis 'seeded', source 'seed', synthetic
-- `seed:` projectId, quantity 1, bidUnit 0); this table just stores the claim.
--
-- ── RLS SHAPE ───────────────────────────────────────────────────────────────
-- Mirrors 20260804120000_delay_events.sql exactly: owner-only on all four
-- commands, keyed on `auth.uid() = user_id`, `TO authenticated` (not TO PUBLIC
-- — a new table should not inherit change_orders' anon-evaluates-false
-- looseness). Deliberately NOT extended to collaborators: a GC's unit rates are
-- their margin. 20260803140000_collaborator_rls_field_tables.sql scoped
-- collaborator access to FIELD tables and explicitly excluded the financial
-- cluster; a price book belongs on that excluded side of the line.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cost_seeds (
  -- Deterministic, derived from trade+unit by utils/costSeedCore.seedId
  -- ('seed-framing-sf'). NOT a uuid. See the PK note above.
  id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The contractor's own scope label. Keyed against CostBookEntry as
  -- `lower(trade)|lower(unit)` so a seed lands on the same row a closed job for
  -- that scope would.
  trade text NOT NULL,
  -- Canonical display unit ('SF', 'LF', 'EA', …) — costSeedCore.canonicalSeedUnit
  -- has already folded 'sqft' / 'sq ft' / 'square feet' onto one label. Storing
  -- the raw typed token would break matching against takeoff lines.
  unit text NOT NULL,

  -- Dollars per unit, as the contractor states it. The CHECKs mirror
  -- costSeedCore's parser limits so a hand-crafted API call can't poison a
  -- price book the app's own parser would have rejected.
  rate numeric NOT NULL CHECK (rate > 0 AND rate <= 10000000),

  -- SELF-REPORTED job count. DISPLAY ONLY — never folded into jobCount.
  -- "I've done this 40 times" is not forty closed jobs in the ledger.
  reported_jobs integer CHECK (reported_jobs IS NULL OR (reported_jobs > 0 AND reported_jobs <= 500)),

  -- Self-reported as-of date, 'yyyy-mm-dd'. text (not date) for the same reason
  -- delay_events.first_observed_date is text: it is a plain calendar day the
  -- client already normalized, and a date column round-trips through the
  -- driver's timezone handling.
  as_of text,

  -- Leftover free text from the pasted row, kept so the review step can show
  -- what the rate was read from.
  note text,

  method text NOT NULL DEFAULT 'paste' CHECK (method IN ('paste', 'manual')),

  -- Effectively "last stated at" — costSeedCore.draftsToSeeds re-stamps this on
  -- every import, and hooks/useCostSeeds uses it to resolve a local-vs-server
  -- conflict the same way mergeSeeds does (the later statement wins).
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, id)
);

CREATE OR REPLACE FUNCTION public.cost_seeds_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS cost_seeds_updated_at ON public.cost_seeds;
CREATE TRIGGER cost_seeds_updated_at
  BEFORE UPDATE ON public.cost_seeds
  FOR EACH ROW
  EXECUTE FUNCTION public.cost_seeds_set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.cost_seeds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cost_seeds_select ON public.cost_seeds;
DROP POLICY IF EXISTS cost_seeds_insert ON public.cost_seeds;
DROP POLICY IF EXISTS cost_seeds_update ON public.cost_seeds;
DROP POLICY IF EXISTS cost_seeds_delete ON public.cost_seeds;

CREATE POLICY cost_seeds_select ON public.cost_seeds
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY cost_seeds_insert ON public.cost_seeds
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- UPDATE needs BOTH clauses. USING alone would let a caller re-key one of their
-- own rows onto another user_id; WITH CHECK closes that.
CREATE POLICY cost_seeds_update ON public.cost_seeds
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- supabaseWrite's delete is `.delete().eq('id', id)` with no user_id filter —
-- this policy is what scopes it to the caller's own row. Without it, one GC
-- deleting their 'seed-framing-sf' would delete everyone's.
CREATE POLICY cost_seeds_delete ON public.cost_seeds
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_seeds TO authenticated;

COMMENT ON TABLE public.cost_seeds IS
  'Cold-start cost seeds — rates the contractor STATED before they had closed-job '
  'history here. A claim, never a measurement: folded into the cost book as '
  'basis=seeded, quantity 1, bidUnit 0, under a synthetic seed: projectId, and '
  'excluded from jobCount / jobsAnalyzed / overallBidAccuracy.';
COMMENT ON COLUMN public.cost_seeds.id IS
  'Deterministic from trade+unit (costSeedCore.seedId) — NOT a uuid, and NOT '
  'globally unique. Unique only within a user_id, hence the composite PK.';
COMMENT ON COLUMN public.cost_seeds.reported_jobs IS
  'Self-reported. DISPLAY ONLY — never counted as jobs anywhere.';
COMMENT ON COLUMN public.cost_seeds.created_at IS
  'Last stated at — re-stamped on every import. Used as the local-vs-server '
  'conflict tiebreaker in hooks/useCostSeeds.';

-- ============================================================================
-- VERIFY AFTER APPLYING
--
-- 1. Columns:
--    select column_name, data_type, is_nullable, column_default
--    from information_schema.columns
--    where table_schema='public' and table_name='cost_seeds'
--    order by ordinal_position;
--
-- 2. The PK is COMPOSITE (this is the whole point — check it, don't assume):
--    select a.attname, i.indisprimary
--    from pg_index i
--    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
--    where i.indrelid = 'public.cost_seeds'::regclass and i.indisprimary;
--    -- expect exactly two rows: user_id and id.
--
-- 3. Exactly four policies, all owner-scoped, all TO authenticated:
--    select p.polname,
--           pg_get_expr(p.polqual, p.polrelid)      as using_expr,
--           pg_get_expr(p.polwithcheck, p.polrelid) as check_expr,
--           p.polroles::regrole[]                   as roles
--    from pg_policy p
--    join pg_class c on c.oid = p.polrelid
--    join pg_namespace n on n.oid = c.relnamespace and n.nspname='public'
--    where c.relname = 'cost_seeds' order by p.polname;
--
-- 4. THE COLLISION TEST — the reason the PK is composite. Sign in as user A,
--    seed "Framing / SF"; sign in as user B, seed "Framing / SF". Both rows
--    must exist (id 'seed-framing-sf' twice, different user_id) and each user
--    must see exactly ONE:
--    select user_id, id, trade, unit, rate from public.cost_seeds
--    where id = 'seed-framing-sf';
--
-- 5. Cross-tenant read returns zero rows. As user B:
--    select count(*) from public.cost_seeds;   -- expect 0 of A's seeds
--
-- 6. Re-import corrects rather than duplicates: change the Framing rate in
--    app/cost-seed and re-import. Row count stays 1; rate changes; updated_at
--    advances (the ON CONFLICT DO UPDATE path fires the BEFORE UPDATE trigger).
--
-- 7. The offline queue drains. BEFORE this migration every cost_seeds write
--    hits a PostgREST schema-cache miss, which utils/offlineQueue.ts classifies
--    as TRANSIENT and re-queues WITHOUT burning the retry budget — so seeding
--    works entirely out of AsyncStorage and nothing is lost, but nothing reaches
--    the server either. After applying, PostgREST needs its schema cache
--    refreshed (Supabase does this within ~a minute, or NOTIFY pgrst, 'reload
--    schema'), then foreground the app and confirm mageid_offline_queue empties
--    and the rows appear.
--
-- 8. The reinstall this table exists for: seed rates, confirm they land
--    server-side, delete + reinstall the app, sign in. The rates must be back
--    and still read "you set this rate" / 0 jobs — restored, not promoted.
-- ============================================================================
