-- 20260924120500_clear_country_centroid_coords.sql — lane Q2 (weather location).
--
-- THE KANSAS BUG. A job saved with a blank address used to be written with the
-- literal location 'United States' (app/project-detail.tsx, the Schedule tab's
-- auto-created project, the lead converter, the voice creator). The client then
-- geocoded that string, Nominatim returned the country's centroid
-- (39.7837304, -100.445882, near Lebanon, Kansas), and every weather surface —
-- the Gantt, the Today card, Schedule Pro's reschedule prompt, the morning
-- digest — showed confident, unlabelled Kansas weather for jobs in Houston and
-- Brooklyn. Live on 2026-09-24: '1221 4 &5 punch' and 'Houston Phone Booth Ad'.
--
-- The client no longer writes the literal and never geocodes a country on its
-- own (utils/geocodeProject.ts isCountryOnlyLocation). This repair removes the
-- coordinates already stored for such rows, so the digest (which reads only
-- coordinates) and the jurisdiction lookup stop treating Kansas as the site.
--
-- SCOPE — exactly three columns, exactly these rows:
--   location_latitude, location_longitude, location_geocoded_at  →  NULL
--   WHERE the location, lower-cased with dots and repeated spaces removed, is
--   one of the country-only spellings utils/geocodeProject.ts COUNTRY_ONLY
--   lists, AND at least one of the three is still set.
-- The location text itself is left alone (the owner may still read it; the
-- app treats it as "no address"). No other column, table, or row is touched.
--
-- IDEMPOTENT: the second run matches no rows (the three columns are already
-- NULL), so it updates nothing. No trigger on projects reacts to these columns
-- (the BEFORE UPDATE triggers guard ownership, client_portal, payment terms,
-- digest stamps and schedule — none reads location_*; the one AFTER UPDATE
-- trigger, projects_portal_link_handover, fires only on status / closed_at),
-- and auth.uid() is NULL for a migration, which every owner-guard lets
-- through.

update public.projects
set location_latitude = null,
    location_longitude = null,
    location_geocoded_at = null
where regexp_replace(replace(lower(btrim(coalesce(location, ''))), '.', ''), '\s+', ' ', 'g') in (
    'united states',
    'united states of america',
    'the united states',
    'usa',
    'us',
    'america',
    'united states (us)'
  )
  and (location_latitude is not null
    or location_longitude is not null
    or location_geocoded_at is not null);
