-- 20260707120000_punch_location.sql
-- Punch-item location tracking (P0 of the 2026-07-07 punchlist-location review).
--
-- Two things were being captured on the client and silently dropped on sync
-- because punch_items had no columns for them:
--   1. Plan-pin anchor — lets a punch item be pinned to a spot on a plan sheet
--      (the back-reference mirroring drawing_pins.linked_punch_item_id).
--   2. Photo GPS stamp — lat/long/accuracy/label captured on every punch save.
--
-- All additive + nullable. Existing rows keep NULL; no backfill needed.
--
-- Client (PunchItem, camelCase) → column (snake_case) mapping:
--   planSheetId                 → plan_sheet_id          (text)
--   pinX                        → pin_x                  (double precision, 0..1 normalized)
--   pinY                        → pin_y                  (double precision, 0..1 normalized)
--   photoLatitude               → photo_latitude         (double precision)
--   photoLongitude              → photo_longitude        (double precision)
--   photoLocationAccuracyMeters → photo_accuracy_meters  (double precision)
--   photoLocationLabel          → photo_location_label   (text)

ALTER TABLE public.punch_items
  ADD COLUMN IF NOT EXISTS plan_sheet_id         text,
  ADD COLUMN IF NOT EXISTS pin_x                 double precision,
  ADD COLUMN IF NOT EXISTS pin_y                 double precision,
  ADD COLUMN IF NOT EXISTS photo_latitude        double precision,
  ADD COLUMN IF NOT EXISTS photo_longitude       double precision,
  ADD COLUMN IF NOT EXISTS photo_accuracy_meters double precision,
  ADD COLUMN IF NOT EXISTS photo_location_label  text;
