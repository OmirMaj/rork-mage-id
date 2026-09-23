# Held migrations — do NOT apply these yet

Every file in this directory is a real, reviewed migration whose **precondition
is not met**. Each file's own header states the precondition. Parking a file
here is the only reliable way to keep it out of a bulk apply:

- `supabase db push` and `supabase migration list` read `supabase/migrations/*.sql`
  only — they do not recurse into subdirectories — so a held file cannot be
  swept up by a push (`DEPLOY-VERIFIED-2026-09-02.md` step 2 used to do this with
  `mv … /tmp/`, which is easy to forget to reverse).
- `scripts/validate-sql-identifiers.ts` scans the same top level, so a held
  file is not linted until it is moved back.

The coordinator moves files here. Nothing under `held/` is referenced by any
guard, so moving a file back up is the only step needed to "un-hold" it.

| File | Why it is held | Apply when |
|---|---|---|
| `20260827120000_project_financials_drop_legacy.sql` *(moved here by the coordinator)* | Phase 2 of the financials split: drops `estimate`, `linked_estimate`, `estimate_versions`, `target_budget` off `projects`. Every installed build still reads those columns; applying it renders every estimate empty on those devices. | The OTA carrying the `project_financials` read/write path is live and an estimate has been opened and verified on a real device (its header lists three preconditions). |
| `20260826180000_portal_link_expiry_cron.sql` *(moved here by the coordinator)* | Schedules two pg_cron jobs that call the `portal-link-expiry-notice` edge function, which is not deployed. Applying it produces a silent stream of failing runs recorded as "succeeded". | After that edge function ships (with `--no-verify-jwt`, per `supabase/config.toml`). |
| `20260904101000_profiles_tax_rate_default_zero.sql` | MONEY-F3 / RT-R3: `profiles.tax_rate DEFAULT 7.5` is why a 0 % tax rate comes back as 7.5 %. Changing the default is a product decision, and all 30 live profiles sit at the old default, indistinguishable from a deliberate 7.5. | The founder decides between `0` and an onboarding prompt, AND B1's client fix (`Number(data.tax_rate) || 7.5` → a null-check) is live — otherwise the app re-coerces 0 back to 7.5 on every load. |
| `20260913120000_portal_proposal_acceptance.sql` | Adds the portal's proposal-acceptance table + RPC, and documents the missing change-order ownership check on the two live `portal_submit_co_approval*` functions — **Section 3 is now empty (2026-09-18): 20260919030000 ships that check plus `co_not_shared` (#44), and re-creating the two functions here would have dropped `co_not_shared`.** The acceptance RPC reads the published proposal out of `portal_snapshots`, so it denies every acceptance until a snapshot **v12** row exists — which needs the OTA on the contractor's device AND a re-push. **Direction B (2026-09-17) edited it before it was ever applied:** it now refuses any proposal that is not record version `proposal-esign-2` with confirmed payment terms (an esign-1 proposal prints MAGE's placeholder 10% deposit), stores the accepted proposal in `proposal_approvals.proposal_snapshot` under a `for update` read, and a new `portal_snapshots_pin_accepted_proposal` trigger re-imposes that accepted proposal on every later snapshot push. | After `marketing/portal/index.html` at **esign-2** is deployed AND the OTA stamping esign-2 has reached devices and re-pushed (the header's precondition 5 query: esign-1 proposal rows at or near zero). Run the `change_order_approvals` orphan query in the file's Section 3 header against production first; expect zero rows. Never apply a copy of the file without the Direction B edits (precondition 6). |
| `20260923171000_portal_token_strip.sql` *(wave 5, rls-hardening, #82)* | 20260923170000 moved the homeowner portal key into the owner-only `portal_credentials` table but still **mirrors** it into `projects.client_portal`, which every accepted collaborator can read — so a field-seat foreman can still read the key and e-sign change orders as the homeowner. This file stops the mirror, strips `accessToken` / `passcode` from every row, reads the key only from `portal_credentials`, and **rotates every live key** (3 in production on 2026-09-23), which breaks every homeowner link already sent. Until it is applied: don't invite collaborators to the 3 portal-enabled jobs. | The founder says yes (productDecision #82) AND, in order: (1) `20260923170000_rls_hardening.sql` is applied; (2) the wave-5 OTA — owner upsert without `accessToken`, Client Portal setup reading the key through `portal_get_owner_token` — has reached devices (an older build shows "link pending" until it updates); (3) `_shared/portalLinks.ts` (digest, dunning, notify, link-expiry e-mails) and `validate-portal-passcode` read `portal_credentials` instead of `client_portal` and are deployed; (4) the founder is ready to re-share every portal link. The file's header has the verify-after queries. |

## Moved OUT of held/, still NOT applied

| File | Why it left held/ | Apply when |
|---|---|---|
| `../20260923181000_plan_sheets_private.sql` *(was `held/20260904101100_plan_sheets_private.sql`; wave 5, benchmark-financing, #83)* | DB-F11: `plan-sheets` is a PUBLIC bucket, so any sheet whose path someone ever held downloads forever with no sign-in. Every code precondition is met and live, and two of the data checks are done (production 2026-09-23: the only plan-sheets policies are `plan_sheets_member_select` / `_insert`, both `authenticated`; all 3 `plan_sheets` rows store bare paths). It was moved up so the repo carries the filename production will record — the body is byte-identical, only a header was added. **It is still gated** and is applied only by hand through the Supabase MCP `apply_migration`, never by a bulk push. **Scope caveat:** already-signed URLs live until they expire (24 h client, up to 7 days for `mintLegacyViewUrl`), and `rfp-attachments` is a second public bucket serving drawings (DB-F11b). | ALL of: (1) the founder says yes (productDecision #83); (2) the 7 orphaned `tmp/` objects (2026-05-07, owner NULL, no `plan_sheets` row) are deleted **through the Storage API**, not SQL; (3) wave 4's signed-media-urls and the architect page are live; (4) the OTA with `utils/planSheetUrls` has reached devices. The file's header has the verify-after queries. |

## How to apply one

1. `git mv supabase/migrations/held/<file> supabase/migrations/<file>`
2. Apply it the way the 09-02 / 09-03 batches were applied — through the
   Supabase MCP `apply_migration` (project `nteoqhcswappxxjlpvap`) — or via
   `supabase db push` **only after** the tracker repair described in
   `DEPLOY-VERIFIED-2026-09-02.md` (the tracker does not match the local
   filenames; an unrepaired push replays the whole history).
3. Regenerate `supabase/schema.sql` from production and re-run `bun run ship-check`;
   several guards read that file as production truth.
