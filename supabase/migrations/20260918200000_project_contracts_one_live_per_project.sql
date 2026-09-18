-- One live contract per job (audit #30).
--
-- The contract screen read a FAILED load (no signal on site) as "this job has
-- no contract" and seeded a fresh draft; signing it once back online inserted
-- a second version-1 row with superseded_by null. fetchActiveContract orders
-- by version and takes one, so which contract the screen, the client portal
-- and the billing ledger saw was arbitrary — the homeowner could be sent a
-- second contract to sign and deposit milestones billed twice across the two.
--
-- The app now refuses that insert (utils/contractEngine.saveContractDetailed
-- re-reads the live contract first). This index is the backstop for the race
-- a client read cannot close — two devices inserting at once. "Live" = not
-- superseded by a later version and not void: a void contract may be replaced
-- by a new one, and nothing in the app writes a superseding version today, so
-- no existing flow ever holds two live rows even transiently.
--
-- Production had 0 violating projects when this was written (1 row total), so
-- it builds cleanly; a violation would fail the build loudly rather than pick
-- a winner silently.
create unique index if not exists project_contracts_one_live_per_project
  on public.project_contracts (project_id)
  where superseded_by is null and status <> 'void';
