-- create_time_entries.sql
--
-- Real backend for the Crew Time Tracking feature. Pre-audit (May 2026)
-- the screen at app/time-tracking.tsx was MOCK_TIME_ENTRIES with local
-- React state — clock-ins didn't persist past navigation. Now: a real
-- table + RLS + the same offline-queue pattern used for invoices/COs.
--
-- Schema mirrors the TypeScript `TimeEntry` interface in types/index.ts.
-- One row per worker-shift (clock-in → clock-out). Lifecycle:
--   1. Worker clocks in → INSERT row with status='clocked_in', clock_in=now()
--   2. Worker takes a break → UPDATE status='break'
--   3. Worker resumes → UPDATE status='clocked_in', breakMinutes accrued
--   4. Worker clocks out → UPDATE status='clocked_out', clock_out=now(),
--      total_hours computed
--
-- The total_hours and overtime_hours fields are stored (not derived) so
-- payroll exports stay correct even if the timezone or break-rounding
-- policy changes. The app computes them on clock-out and writes them.

CREATE TABLE IF NOT EXISTS public.time_entries (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  project_name text NOT NULL,

  -- Worker can be a sub user, an employee, or just a tracked name. We
  -- don't FK to a users table because subs and field workers may not
  -- have Supabase accounts.
  worker_id text NOT NULL,
  worker_name text NOT NULL,
  trade text NOT NULL DEFAULT '',

  -- ISO timestamps. clock_out is null while still on-shift.
  clock_in timestamptz NOT NULL,
  clock_out timestamptz,

  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  -- Set when status flips to 'break', cleared on resume. Persisting it
  -- means the break duration survives an app force-quit — pre-fix the
  -- break-start lived in a useRef in the screen component, lost on
  -- remount, and resume always recorded zero minutes.
  break_started_at timestamptz,

  -- Stored, not derived — see header comment.
  total_hours numeric(6,2) NOT NULL DEFAULT 0 CHECK (total_hours >= 0),
  overtime_hours numeric(6,2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),

  status text NOT NULL DEFAULT 'clocked_in'
    CHECK (status IN ('clocked_in', 'clocked_out', 'break')),

  notes text,
  gps_lat double precision,
  gps_lng double precision,
  -- date stored as 'YYYY-MM-DD' string for easy day-bucketing without
  -- timezone math. Set on the GC's local timezone at clock-in time.
  date text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS time_entries_user_idx
  ON public.time_entries(user_id);

CREATE INDEX IF NOT EXISTS time_entries_project_date_idx
  ON public.time_entries(project_id, date);

CREATE INDEX IF NOT EXISTS time_entries_status_idx
  ON public.time_entries(user_id, status);

-- updated_at auto-bump on UPDATE
CREATE OR REPLACE FUNCTION public.time_entries_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS time_entries_updated_at ON public.time_entries;
CREATE TRIGGER time_entries_updated_at
  BEFORE UPDATE ON public.time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.time_entries_set_updated_at();

-- RLS — users can only see/manipulate their own time entries (the GC's).
-- Sub workers don't directly access this table; the GC's app records
-- their hours.
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS "Users can view their own time entries" ON public.time_entries;
DROP POLICY IF EXISTS "Users can insert their own time entries" ON public.time_entries;
DROP POLICY IF EXISTS "Users can update their own time entries" ON public.time_entries;
DROP POLICY IF EXISTS "Users can delete their own time entries" ON public.time_entries;

CREATE POLICY "Users can view their own time entries"
  ON public.time_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own time entries"
  ON public.time_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own time entries"
  ON public.time_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own time entries"
  ON public.time_entries FOR DELETE
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO authenticated;
