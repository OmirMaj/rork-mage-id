-- WIP Reporting: additive period-snapshot table.
-- Live WIP is computed on the fly from existing financial tables; only these
-- frozen snapshots persist. locked_at makes a period immutable at the app
-- layer (CPA/bank close). Scoped by user_id (matches every tertiary_* table);
-- company_id is stored for future company-wide roll-ups but RLS is on user_id.
CREATE TABLE IF NOT EXISTS public.wip_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT,
  period_end_date TEXT NOT NULL,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  portfolio_totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  locked_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wip_periods_user ON public.wip_periods(user_id);

CREATE TRIGGER wip_periods_updated_at BEFORE UPDATE ON public.wip_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.wip_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wip_periods_select_own" ON public.wip_periods
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "wip_periods_insert_own" ON public.wip_periods
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "wip_periods_update_own" ON public.wip_periods
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "wip_periods_delete_own" ON public.wip_periods
  FOR DELETE USING (auth.uid() = user_id);
