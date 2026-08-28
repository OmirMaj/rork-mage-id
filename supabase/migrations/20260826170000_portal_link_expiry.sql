-- portal_snapshots — GC-chosen lifetime for the homeowner share link.
--
-- Today a portal link lives forever: portal_snapshots has no TTL at all, so
-- every URL a GC has ever texted is still live. The founder's ask is the
-- opposite of a hard cutover — the GC picks how long a link stays open, and
-- when it lapses they get told so they can send a fresh one.
--
-- Precedent is public.shared_schedule_snapshots
-- (20260520180100_shared_schedule_snapshots.sql), which carries
-- `expires_at timestamptz not null default (now() + interval '30 days')` and
-- a fetch RPC that filters on it. We copy the COLUMN, not the NOT NULL
-- DEFAULT — see below.
--
-- ── WHY expires_at IS NULLABLE, AND WHY NULL MEANS FOREVER ───────────────────
-- A `not null default (now() + interval '30 days')` would be evaluated for
-- every EXISTING row at ALTER time. That is a retro-expiry: every homeowner
-- portal already in the field would silently acquire a deadline nobody agreed
-- to, and the ones created more than 30 days ago... would still get now()+30
-- (the default is computed at backfill time, not from created_at) — so the
-- damage is not "old links die", it is "every link now dies on a date the GC
-- never chose and was never told about". Either way the GC finds out when the
-- homeowner texts "your link is broken" mid-build. That is a support incident
-- manufactured by a migration.
--
-- So: NULL is a first-class value meaning "never expires", and it is what
-- every pre-existing row keeps. Today's behaviour is preserved exactly, and
-- expiry only ever starts applying to a link the GC deliberately regenerated
-- with a duration attached. Opt-in, not opt-out.
--
-- Reverse path:
--   alter table public.portal_snapshots drop column if exists expires_at;
--   alter table public.portal_snapshots drop column if exists link_duration_days;

alter table public.portal_snapshots
  add column if not exists expires_at timestamptz;

-- What the GC picked (7 / 30 / 90). NULL = they chose "No expiry", or they
-- have never been asked — the two are indistinguishable here on purpose, and
-- both correctly resolve to "no deadline". The value is kept so regenerating a
-- link can reuse the preference instead of re-prompting, and so a future
-- notification can say "your 30-day link lapsed" rather than just "it lapsed".
alter table public.portal_snapshots
  add column if not exists link_duration_days integer;

comment on column public.portal_snapshots.expires_at is
  'When the share link stops being valid. NULL = never expires (the pre-2026-08-26 behaviour, and what every backfilled row keeps).';
comment on column public.portal_snapshots.link_duration_days is
  'Days the GC chose when they last generated this link. NULL = no expiry chosen. Reused as the default next time they regenerate.';

-- Guard the obvious data bug: a zero or negative duration would mint a link
-- that is expired the instant it is created. NOT VALID would let existing rows
-- skip the check, but there are no existing values to grandfather (the column
-- is new and entirely NULL), so a plain constraint is safe and honest.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'portal_snapshots_link_duration_days_positive'
       and conrelid = 'public.portal_snapshots'::regclass
  ) then
    alter table public.portal_snapshots
      add constraint portal_snapshots_link_duration_days_positive
      check (link_duration_days is null or link_duration_days > 0);
  end if;
end
$$;

-- Partial index: the only rows any expiry sweep, notification job or "which
-- links lapse this week" query cares about are the ones that HAVE a deadline.
-- Never-expiring portals are expected to stay the majority for a while (every
-- row that predates this migration is one), so keeping them out of the index
-- keeps it small and keeps writes to those rows off the index entirely.
--
-- `where expires_at is not null` is IMMUTABLE, so it is legal in a partial
-- index predicate — unlike `where expires_at > now()`, which is why the
-- shared_schedule_snapshots equivalent had to settle for a full index.
create index if not exists portal_snapshots_expires_at_idx
  on public.portal_snapshots (expires_at)
  where expires_at is not null;
