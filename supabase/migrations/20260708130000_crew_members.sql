-- 20260708130000_crew_members.sql
-- Worker Profile — CrewMember roster. Additive, company-scoped.
--
-- RLS: a row is visible to its owning GC (auth.uid() = user_id) AND, once
-- claimed, to the claiming worker (auth.uid() = claimed_by_user_id). Only the
-- GC can INSERT (user_id = auth.uid()); the GC OR the claimed worker can
-- UPDATE; only the GC can DELETE. Mirrors the punch_items/jhas ownership
-- pattern (20260708120000_safety_wave_a.sql) plus the claimed-worker overlay.
-- Because that overlay widens UPDATE beyond a single owner, a BEFORE-UPDATE
-- trigger (crew_freeze_ownership_columns) freezes user_id/claimed_by_user_id
-- for non-owner callers so the claimed worker cannot hijack ownership.
--
-- Apply to PROD BEFORE the OTA that writes this table (PGRST204 gate — an OTA
-- writing a column the live schema lacks fails silently in supabaseWrite).
--
-- SEPARATE OWNER STEP (not in this migration): create the PRIVATE storage
-- bucket `worker-ids` for opt-in retained raw ID images (path-only refs). See
-- docs/deploy/2026-07-08-crew-worker-ids-bucket.md.

CREATE TABLE IF NOT EXISTS public.crew_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  trades JSONB DEFAULT '[]'::JSONB,
  phone TEXT,
  email TEXT,
  photo_url TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  -- ID verification (extract-then-purge default: masked/derived fields only)
  id_verified BOOLEAN DEFAULT FALSE,
  id_type TEXT CHECK (id_type IN ('drivers_license', 'state_id', 'passport', 'other')),
  id_masked_last4 TEXT,
  id_expiry TEXT,
  id_issuer TEXT,
  id_scanned_at TIMESTAMPTZ,
  -- Present ONLY on opt-in retain: a PATH in the private worker-ids bucket.
  id_image_path TEXT,
  -- Claim (hybrid ownership)
  claim_token TEXT UNIQUE,
  claimed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  is_public BOOLEAN DEFAULT FALSE,
  marketplace_profile_id UUID,
  project_ids JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crew_members_user ON public.crew_members(user_id);
CREATE INDEX IF NOT EXISTS idx_crew_members_claimed ON public.crew_members(claimed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_crew_members_claim_token ON public.crew_members(claim_token);

ALTER TABLE public.crew_members ENABLE ROW LEVEL SECURITY;

-- SELECT: owning GC or the claimed worker.
CREATE POLICY "crew_select_own_or_claimed" ON public.crew_members
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() = claimed_by_user_id);
-- INSERT: only the owning GC.
CREATE POLICY "crew_insert_own" ON public.crew_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);
-- UPDATE: owning GC or the claimed worker (self-edit path is not tier-gated).
-- WITH CHECK re-validates the NEW row so an update cannot move a row outside
-- owner-or-claimed visibility. CRITICAL: WITH CHECK alone does NOT stop a
-- claimed worker from hijacking ownership — they could set user_id = auth.uid()
-- and the NEW row would still satisfy the OR clause, silently dropping the row
-- out of the GC's user_id-scoped SELECT/UPDATE/DELETE policies (compliance
-- roster). The crew_freeze_ownership_columns BEFORE-UPDATE trigger below closes
-- that by freezing user_id + claimed_by_user_id for any authenticated caller
-- who is not the owning GC. Service-role / trusted-backend writes
-- (auth.uid() IS NULL) are exempt and bypass RLS as usual.
CREATE POLICY "crew_update_own_or_claimed" ON public.crew_members
  FOR UPDATE
  USING (auth.uid() = user_id OR auth.uid() = claimed_by_user_id)
  WITH CHECK (auth.uid() = user_id OR auth.uid() = claimed_by_user_id);
-- DELETE: only the owning GC.
CREATE POLICY "crew_delete_own" ON public.crew_members
  FOR DELETE USING (auth.uid() = user_id);

-- Freeze ownership columns against a claimed worker's self-edit. A BEFORE
-- trigger's NEW row is what RLS WITH CHECK ultimately validates, so restoring
-- user_id/claimed_by_user_id here defeats the USING-clause escalation while
-- leaving the worker's legitimate self-edits (phone, email, certs, own ID
-- scan) untouched.
CREATE OR REPLACE FUNCTION public.crew_freeze_ownership_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM OLD.user_id THEN
    NEW.user_id := OLD.user_id;
    NEW.claimed_by_user_id := OLD.claimed_by_user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crew_members_freeze_ownership BEFORE UPDATE ON public.crew_members
  FOR EACH ROW EXECUTE FUNCTION public.crew_freeze_ownership_columns();

CREATE TRIGGER crew_members_updated_at BEFORE UPDATE ON public.crew_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
