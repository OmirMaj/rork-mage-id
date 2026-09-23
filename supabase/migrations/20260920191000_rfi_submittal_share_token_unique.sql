-- Wave 4 integration (docs-team-server lens): one reply link, one record.
--
-- #30 made the device mint rfis/submittals.share_token (so an RFI raised
-- offline carries its reply link from the first second). Neither column was
-- unique: idx_rfis_share_token / idx_submittals_share_token are plain btree.
-- get_rfi_by_token, submit_pro_response and signed-media-urls all resolve a
-- link with `where share_token = <token> limit 1`, so anyone holding a
-- reply-link token (the architect's email) who also has a MAGE ID account
-- could insert his OWN RFI carrying the same token — rfis_collab_insert checks
-- only user_id and field access — and which row the link then answers is
-- undefined: the architect's next answer could land in the copy.
--
-- A unique partial index makes that insert (or an UPDATE to a taken token)
-- fail loudly with 23505 instead of splitting a link. Honest devices mint
-- random UUIDs (mintShareToken), so they never collide.
--
-- Production, read-only before writing this (2026-09-22): rfis 3 rows / 3
-- distinct tokens, submittals 2 rows / 2 distinct — both indexes build.
-- The old non-unique indexes are left in place (redundant, harmless at this
-- size); nothing else changes. Safe to run twice.

create unique index if not exists rfis_share_token_key
  on public.rfis (share_token)
  where share_token is not null;

create unique index if not exists submittals_share_token_key
  on public.submittals (share_token)
  where share_token is not null;
