-- Adds break_started_at column to public.time_entries.
--
-- Pre-fix the break-start timestamp lived in a useRef in the screen
-- component (app/time-tracking.tsx). When the worker backgrounds or
-- force-quits the app during a break, the ref is gone, and on resume
-- the break duration was recorded as 0 minutes. Persisting on the row
-- makes break recovery cold-restart safe.
--
-- Run this after the original create_time_entries.sql (already applied).
-- Idempotent — uses IF NOT EXISTS.

ALTER TABLE IF EXISTS public.time_entries
  ADD COLUMN IF NOT EXISTS break_started_at timestamptz;
