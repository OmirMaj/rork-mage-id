-- docs/ops/2026-10-03-content-rights-cleanup.sql — ONE-OFF data purge for the
-- content-rights fix (lane CRSERVER, contentfix 2026-10-03). NOT a migration:
-- run it by hand, once, in production (project nteoqhcswappxxjlpvap) through
-- execute_sql, section by section, reading each preview before its write.
--
-- WHY (contentfix-specs/RIGHTS-VERDICT.md):
--   cached_companies  Google Places business listings (2,056 rows on
--                     2026-10-02). Google's Maps Platform terms forbid storing
--                     names, addresses and ratings at all. All rows go.
--   city_coords       1,237 rows with source 'google_places_textsearch' kept
--                     with no expiry; Google allows 30 days at most. The 101
--                     'nominatim' (OpenStreetMap, ODbL) rows stay.
--   cached_bids       coordinates copied from those Google rows onto bids.
--                     Nulled; geocode-bids re-fills them from OpenStreetMap.
--   cached_jobs       Adzuna listings (423 rows), never shown in the app.
--                     Adzuna's terms ask for its data to be removed when you
--                     stop. All rows go.
--
-- ORDER (the orchestrator's deploy order):
--   1. deploy fetch-external-data and geocode-bids (they no longer write any
--      Google or Adzuna data, and read only 'nominatim' city_coords rows);
--   2. apply 20261003090000_content_rights.sql (any time; it deletes nothing);
--   3. THEN run this file. Running it before step 1 lets the next cron run
--      write fresh Google rows straight back.
--
-- HOW city_coords RECORDS ITS SOURCE. city_coords.source is a text column
-- (supabase/schema.sql: source text DEFAULT 'google_geocoding'). Values seen:
-- 'google_places_textsearch' (geocode-bids' Google path), 'nominatim'
-- (OpenStreetMap). The column DEFAULT is 'google_geocoding', so a row written
-- without a source (the old inline Google geocoder in fetch-external-data)
-- reads 'google_geocoding'. A NULL source has no provenance at all. So the
-- safe rule is: ONLY source = 'nominatim' is OpenStreetMap; every other value,
-- NULL included, is treated as Google and deleted. Deleting a row that was in
-- fact OSM costs one free Nominatim lookup later; keeping a Google row is the
-- breach.
--
-- HOW A BID'S COORDINATES ARE JUDGED. A bid only ever got coordinates by
-- copying a city_coords row (fetch-external-data's preload, geocode-bids'
-- hydrate/fetch). So a bid keeps its coordinates ONLY when a 'nominatim'
-- city_coords row for the same (city, state) carries exactly the same
-- latitude and longitude. Anything else — a Google row, no row at all, a
-- mismatch — is nulled. Nulling is harmless: geocode-bids re-geocodes every
-- bid with latitude NULL through OpenStreetMap on its next runs.
--
-- Each write is preceded by a SELECT count(*) preview. Expected previews on
-- 2026-10-02 figures: ~2,056 companies, a few dozen bids at most (114 bids in
-- total), ~1,237 city_coords rows, ~423 jobs. If a preview is wildly off,
-- stop and look before running the write.

-- ════════════════════════════════════════════════════════════════════════
-- 1. cached_companies — every row (Google Places listings)
-- ════════════════════════════════════════════════════════════════════════
select count(*) as cached_companies_rows_to_delete from public.cached_companies;

delete from public.cached_companies;

-- ════════════════════════════════════════════════════════════════════════
-- 2. cached_bids — null every coordinate not provably from OpenStreetMap
--    (run BEFORE section 3; the rule only reads 'nominatim' rows, which
--    section 3 keeps, so the order is for readability, not correctness)
-- ════════════════════════════════════════════════════════════════════════
select count(*) as cached_bids_coordinates_to_null
  from public.cached_bids b
 where (b.latitude is not null or b.longitude is not null)
   and not exists (
     select 1 from public.city_coords c
      where c.city = b.city and c.state = b.state
        and c.source = 'nominatim'
        and c.latitude = b.latitude and c.longitude = b.longitude
   );

update public.cached_bids b
   set latitude = null, longitude = null
 where (b.latitude is not null or b.longitude is not null)
   and not exists (
     select 1 from public.city_coords c
      where c.city = b.city and c.state = b.state
        and c.source = 'nominatim'
        and c.latitude = b.latitude and c.longitude = b.longitude
   );

-- ════════════════════════════════════════════════════════════════════════
-- 3. city_coords — every row whose source is not 'nominatim' (NULL included)
-- ════════════════════════════════════════════════════════════════════════
select coalesce(source, '(null)') as source, count(*) as rows
  from public.city_coords
 group by 1 order by 1;
select count(*) as city_coords_rows_to_delete
  from public.city_coords
 where source is distinct from 'nominatim';

delete from public.city_coords where source is distinct from 'nominatim';

-- ════════════════════════════════════════════════════════════════════════
-- 4. cached_jobs — every row (Adzuna listings)
-- ════════════════════════════════════════════════════════════════════════
select count(*) as cached_jobs_rows_to_delete from public.cached_jobs;

delete from public.cached_jobs;

-- ════════════════════════════════════════════════════════════════════════
-- VERIFY AFTER (every line should read as commented)
-- ════════════════════════════════════════════════════════════════════════
select count(*) from public.cached_companies;                                     -- 0
select count(*) from public.cached_jobs;                                          -- 0
select count(*) from public.city_coords where source is distinct from 'nominatim'; -- 0
select count(*) from public.city_coords where source = 'nominatim';               -- unchanged (~101)
select count(*) from public.cached_bids b
 where b.latitude is not null
   and not exists (select 1 from public.city_coords c
                    where c.city = b.city and c.state = b.state and c.source = 'nominatim'
                      and c.latitude = b.latitude and c.longitude = b.longitude);  -- 0

-- ════════════════════════════════════════════════════════════════════════
-- 5. selection_options.image_url — READ ONLY. A COUNT, NOT A PURGE.
--    og-image no longer fetches any photo (no retailer permission; Pexels
--    needed a credit the app never showed), and app/selections.tsx stops
--    asking (PRODUCT_PHOTOS_ENABLED = false). But photos fetched BEFORE this
--    change are still stored and still shown, in the app and the client
--    portal. The verdict counted Pexels images only (0), not retailer
--    og:image photos. Run this count before submission: if it is not 0, take
--    the number to the founder; nulling those rows is HIS call and is not
--    written in this file.
-- ════════════════════════════════════════════════════════════════════════
select count(*) as stored_product_photos,
       count(*) filter (where image_url ilike '%pexels%') as from_pexels
  from public.selection_options
 where image_url is not null and image_url <> '';
--
-- AFTER THIS FILE (dashboard, not SQL): remove the edge-function secrets that
-- no code reads any more — GOOGLE_PLACES_API_KEY, ADZUNA_APP_ID, ADZUNA_APP_KEY,
-- PEXELS_API_KEY (repo grep 2026-10-03: no function reads them). The Places API
-- can then be disabled on that Google Cloud key if nothing outside this repo uses it.
