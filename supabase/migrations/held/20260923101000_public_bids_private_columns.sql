-- 20260923101000_public_bids_private_columns.sql
--
-- Wave 5, lane rfp-marketplace, finding #13/#86 - second half.
--
-- ██ APPLY ONLY AFTER THE WAVE-5 OTA HAS REACHED DEVICES, and after
-- ██ 20260923100000_rfp_marketplace_hardening.sql.
-- A build from before the OTA reads public_bids with select('*')
-- (contexts/BidsContext.tsx) and the poster's address_line
-- (app/rfp-responses-review.tsx). Postgres refuses a WHOLE query that names a
-- column the role cannot read, so on those builds the bid feed would fall back
-- to its device cache and Review bids would stop loading. The OTA'd client
-- selects explicit safe columns everywhere and reads the private fields through
-- get_rfp_private / get_bid_contacts (100000).
--
-- WHAT: every signed-in account could read every homeowner RFP's street
-- address, exact map pin and email (public_bids_select `TO authenticated USING
-- (true)`). RLS is per row, so the columns go: table-level SELECT is revoked
-- from anon and authenticated and SELECT is re-granted on every column EXCEPT
-- address_line, latitude, longitude, contact_email and posted_by. (A column
-- REVOKE alone does nothing while the table-level grant stands - column
-- privileges only bite once it is gone.) Other accounts keep the city, state
-- and lat_coarse / lng_coarse (~1 km); the poster and the awarded contractor
-- read the exact fields through get_rfp_private.
--
-- The column list is read from the catalog at apply time, so a column added
-- between now and then is granted too - only the five named ones are held back.
-- A column added AFTER this runs needs its own `grant select (col)`.
--
-- Not affected: INSERT / UPDATE / DELETE grants (post-rfp still inserts the
-- private columns; RLS still limits writes to the owner), the service role,
-- SECURITY DEFINER readers (award_rfp, the notify-nearby trigger), and the RLS
-- policies of bid_responses / bid_questions, which read only id, user_id,
-- is_homeowner_rfp and status of public_bids.
--
-- Idempotent. Tested twice in PGlite: scratchpad w5rfp_pg/w5_rfp_marketplace.mjs.
-- Reverse path:
--   grant select on public.public_bids to anon, authenticated;

revoke select on public.public_bids from anon, authenticated;

do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'public_bids'
     and c.column_name not in ('address_line', 'latitude', 'longitude', 'contact_email', 'posted_by');
  execute format('grant select (%s) on public.public_bids to authenticated', v_cols);
end
$$;

-- Column grants can also exist from an earlier explicit grant; make sure none
-- of the five survive for either client role.
revoke select (address_line, latitude, longitude, contact_email, posted_by)
  on public.public_bids from anon, authenticated;
