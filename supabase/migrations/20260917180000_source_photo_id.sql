-- Punch items and RFIs remember which gallery photo they were raised from.
--
-- The photo annotator hands a photo (and the markup drawn on it) to "Create
-- RFI" / "Add to Punch List". Only the photo's URI was being kept, and that URI
-- matches the source photo on the capturing device alone: a punch photo is
-- re-uploaded under punch-<id> and every other device gets a signed URL for
-- THAT object; an RFI attachment is a file:// path or a per-session signed URL.
-- So on the office device, on web and for the sub, the circle around the
-- defect silently vanished. Keeping the id lets every device find the markup
-- (audit 2026-09-17 #12).
--
-- text, not uuid, and no foreign key, on purpose: a constraint violation is a
-- permanent failure in the offline queue, and losing the whole punch item/RFI
-- because a legacy non-uuid photo id or an already-deleted photo was
-- referenced is far worse than a dangling pointer (the reader falls back to
-- the URI match).
--
-- ORDERING — APPLY THIS BEFORE THE OTA THAT WRITES source_photo_id.
-- utils/offlineQueue.ts treats a missing column (PGRST204) as transient and
-- re-queues. The client writes the key ONLY on records raised from an
-- annotated photo (ProjectContext spreads it when set), so an early OTA stalls
-- those records alone rather than every punch/RFI write — but they stay
-- unsynced until this column exists.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
alter table public.punch_items add column if not exists source_photo_id text;
alter table public.rfis add column if not exists source_photo_id text;

comment on column public.punch_items.source_photo_id is
  'photos.id the item was raised from (photo annotator). Used to draw its markup on any device. Nullable; no FK by design.';
comment on column public.rfis.source_photo_id is
  'photos.id the first attachment was raised from (photo annotator). Used to draw its markup on any device. Nullable; no FK by design.';
