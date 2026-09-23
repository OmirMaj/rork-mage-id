-- 20260923230000_photos_geo_stamp.sql — wave 5, lane photo-ai, audit #65.
--
-- A gallery photo's GPS stamp (utils/photoGeoStamp.ts) had no column to land
-- in. ProjectPhoto has declared latitude / longitude / locationAccuracyMeters /
-- locationLabel since the stamper shipped, but public.photos never grew them
-- (production columns, read 2026-09-23: id, user_id, project_id, uri,
-- timestamp, location, tag, linked_task_id, linked_task_name, markup,
-- created_at, portal_state). So the stamp lived only in this phone's cache,
-- the next foreground re-read (rows mapped from the server) overwrote it, and
-- the web app never saw it. punch_items has carried the same four facts as
-- photo_latitude / photo_longitude / photo_accuracy_meters /
-- photo_location_label since 20260707120000; this mirrors them, same types.
--
-- CONTRACT 18: photos.latitude, longitude, location_accuracy_meters,
-- location_label <-> ProjectPhoto.latitude, longitude, locationAccuracyMeters,
-- locationLabel. The client mapper (contexts/ProjectContext.tsx — insert,
-- update and read) is w5-join-core's; app/daily-report.tsx's gallery mirror is
-- w5-join-screens'.
--
-- ORDER IS A HARD GATE: apply BEFORE the OTA that writes these fields.
-- PostgREST refuses an insert / update naming an unknown column, and the
-- offline queue would then drop the WHOLE photo write — the punch_location
-- trap again.
--
-- All four nullable, no default, no backfill: a photo taken without a fix (or
-- before this) simply has none. Adding nullable columns rewrites nothing, and
-- RLS needs no change (every photos policy is row-level; no column grant list
-- exists on the table). No live function inserts into photos positionally
-- (checked: no public function body matches `into photos`).
--
-- Re-runnable: `add column if not exists`.

alter table public.photos
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location_accuracy_meters double precision,
  add column if not exists location_label text;

comment on column public.photos.latitude is
  'GPS latitude stamped when the photo was taken (utils/photoGeoStamp.ts). Null when permission was denied or no fix arrived in 3 s.';
comment on column public.photos.longitude is
  'GPS longitude stamped when the photo was taken (utils/photoGeoStamp.ts).';
comment on column public.photos.location_accuracy_meters is
  'OS-reported accuracy of the stamped fix, in meters.';
comment on column public.photos.location_label is
  'Reverse-geocoded label of the stamped fix (or "<lat>, <lng>" when offline). Distinct from photos.location, the free-text label he types.';
