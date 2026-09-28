-- ============================================================================
-- preferred_language on profiles, subcontractors, crew_members and contacts —
-- which language a person reads (docs/I18N.md §5 and §9).
--
-- ── ORDER: APPLY THIS MIGRATION BEFORE THE OTA THAT CONTAINS ────────────────
-- ── components/LanguageProfileSync.tsx. ─────────────────────────────────────
-- LanguageProfileSync SELECTs profiles.preferred_language on sign-in and, when
-- the user picks a language in Settings, writes it through the offline queue
-- as a single-column update (supabaseWrite('profiles','update',{ id,
-- preferred_language })). The READ tolerates a missing column (PostgREST
-- 42703 / PGRST204 → "do nothing", utils/languageSyncCore.ts). The WRITE must
-- never ship first: a PGRST204 on an update is classed as transient by
-- utils/offlineQueue.ts, so the write would sit in the queue until this lands.
-- (The Settings language row is hidden today — i18n/flags.ts
-- LANGUAGE_PICKER_ENABLED = false — so no client can make that write yet, but
-- the order still holds.) Apply, verify the four columns and the four CHECKs
-- exist and PostgREST's schema cache has reloaded (the NOTIFY below), THEN
-- publish the update.
--
-- WHY. Spanish (docs/I18N.md). A foreman who picks Spanish on one phone must
-- get Spanish on the next one, so the choice lives on the account
-- (profiles), not only in the device's mageid_language cache. The three other
-- tables hold the RECIPIENT's language for text we send outside the account —
-- a sub's lineup text, a crew invite, a contact's email (i18n/recipient.ts).
-- The client maps preferred_language ⇄ preferredLanguage in a later phase;
-- nothing reads the three recipient columns yet.
--
-- TYPES. text, nullable, NO default, one CHECK per table:
--   preferred_language is null or preferred_language in ('en','es')
-- NULL means "not told us" — a different fact from 'en'. For a recipient it
-- falls back to English (i18n/recipient.ts: outsiders default to English and
-- we never guess a language from a name); for a profile it keeps whatever the
-- device already has. Only the two exact lower-case codes are valid: the
-- client parses strictly (i18n/types.ts parseStoredLang), and the 'xx'
-- pseudo-locale is never written anywhere.
--
-- RLS. None added or changed: every one of these tables already has row
-- policies, and new columns inherit them.
--
-- GRANTS. None added. The tables' existing TABLE-level grants cover new
-- columns (no repo migration grants these tables column by column). The
-- orchestrator must confirm that in prod with a read-only query BEFORE and
-- AFTER applying — information_schema.role_table_grants and
-- information_schema.column_privileges for anon, authenticated and any field
-- role (field_role's missing grants bit the 2026-09 deploy) on the four
-- tables — and confirm authenticated can SELECT and UPDATE
-- profiles.preferred_language.
--
-- Idempotent throughout: a second run is a no-op.
-- ============================================================================

alter table public.profiles       add column if not exists preferred_language text;
alter table public.subcontractors add column if not exists preferred_language text;
alter table public.crew_members   add column if not exists preferred_language text;
alter table public.contacts       add column if not exists preferred_language text;

-- Each CHECK is added separately (not inline on ADD COLUMN) so a re-run after
-- the column exists still gets the constraint, and a re-run with it present
-- is a no-op.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_preferred_language_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_preferred_language_check
      check (preferred_language is null or preferred_language in ('en', 'es'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'subcontractors_preferred_language_check'
      and conrelid = 'public.subcontractors'::regclass
  ) then
    alter table public.subcontractors
      add constraint subcontractors_preferred_language_check
      check (preferred_language is null or preferred_language in ('en', 'es'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'crew_members_preferred_language_check'
      and conrelid = 'public.crew_members'::regclass
  ) then
    alter table public.crew_members
      add constraint crew_members_preferred_language_check
      check (preferred_language is null or preferred_language in ('en', 'es'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'contacts_preferred_language_check'
      and conrelid = 'public.contacts'::regclass
  ) then
    alter table public.contacts
      add constraint contacts_preferred_language_check
      check (preferred_language is null or preferred_language in ('en', 'es'));
  end if;
end $$;

comment on column public.profiles.preferred_language is
  'The user''s app language: ''en'' or ''es''. NULL = not told (the device keeps its own choice). Read and written by components/LanguageProfileSync.tsx.';
comment on column public.subcontractors.preferred_language is
  'The language to use for text sent to this sub: ''en'' or ''es''. NULL = not told (English). See i18n/recipient.ts.';
comment on column public.crew_members.preferred_language is
  'The language to use for text sent to this crew member: ''en'' or ''es''. NULL = not told (English). See i18n/recipient.ts.';
comment on column public.contacts.preferred_language is
  'The language to use for text sent to this contact: ''en'' or ''es''. NULL = not told (English). See i18n/recipient.ts.';

-- Reload PostgREST's schema cache so the columns are readable and writable
-- immediately.
notify pgrst, 'reload schema';
