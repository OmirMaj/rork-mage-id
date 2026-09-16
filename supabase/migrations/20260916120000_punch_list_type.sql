-- 20260916120000_punch_list_type.sql
-- Two lists, one table: the formal PUNCH list vs the internal CREW list.
--
-- A finishing punch of 100+ items is really two lists with very different
-- weight:
--   'punch' — the formal punch list the owner / client / architect walks and
--             holds the builder to. Rendered in the client portal
--             (utils/portalSnapshot.ts).
--   'crew'  — touch-ups, cleanup, "while you're in there" items the builder's
--             own crew and subs handle. INTERNAL — excluded from the client
--             portal snapshot. (The sub portal still shows a sub the crew items
--             assigned to them; that is their work.)
--
-- Client (PunchItem, camelCase) → column (snake_case) mapping:
--   listType → list_type (text, 'punch' | 'crew', NOT NULL DEFAULT 'punch')
--
-- BACKFILL. NOT NULL + DEFAULT 'punch' stamps every existing row as a formal
-- punch item in this one statement. That is the only safe direction: nothing
-- already on a client's portal may disappear because of this change.
--
-- ORDERING — APPLY THIS BEFORE ANY OTA THAT WRITES list_type.
-- utils/offlineQueue.ts treats a missing column (PostgREST PGRST204) as
-- transient and re-queues the write without burning retries. So an OTA that
-- lands first would not LOSE punch items — it would STALL every punch_items
-- insert and update in the queue, on every device, until this column exists.
-- On a walk day that reads as "my punch list isn't syncing".
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, and the CHECK is added only when
-- pg_constraint does not already have it, so re-running is safe.

ALTER TABLE public.punch_items
  ADD COLUMN IF NOT EXISTS list_type text NOT NULL DEFAULT 'punch';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'punch_items_list_type_check'
       AND conrelid = 'public.punch_items'::regclass
  ) THEN
    ALTER TABLE public.punch_items
      ADD CONSTRAINT punch_items_list_type_check
      CHECK (list_type IN ('punch', 'crew'));
  END IF;
END
$$;

COMMENT ON COLUMN public.punch_items.list_type IS
  'punch = formal punch list (shown in the client portal); crew = internal crew list (never shown to the client). Default punch.';
