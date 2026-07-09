-- scan_records: audit log of Scan-Anything captures. Additive, owner-scoped.
CREATE TABLE IF NOT EXISTS public.scan_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  file_path TEXT NOT NULL DEFAULT '',
  record_kind TEXT NOT NULL DEFAULT 'file_only',
  linked_record_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scan_records_user ON public.scan_records(user_id);
CREATE INDEX IF NOT EXISTS idx_scan_records_project ON public.scan_records(project_id);
ALTER TABLE public.scan_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan_records_select_own" ON public.scan_records FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "scan_records_insert_own" ON public.scan_records FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "scan_records_update_own" ON public.scan_records FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "scan_records_delete_own" ON public.scan_records FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER scan_records_updated_at BEFORE UPDATE ON public.scan_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
