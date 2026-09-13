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
| `20260904101100_plan_sheets_private.sql` | DB-F11: `plan-sheets` is a PUBLIC bucket served by permanent unsigned URLs under a shared `tmp/` prefix. Flipping it private breaks every `plan_sheets.image_uri` the client resolves as a public URL, and every object today lives under `tmp/` where no membership policy can reach it. **All three code preconditions are now MET on `claude/audit-fixes-2026-09-07` and nothing is deployed** — `utils/planSheetUrls.ts` signs at read time (24h, the photo TTL) and `ProjectContext` persists the PATH through the extracted, guard-executed mappers; `takeoff`/`drawing-analyzer` pass a real project id and `uploadAndRenderPdf` refuses a non-project prefix; `convert-pdf-to-images` no longer calls `getPublicUrl` and the four analyzers read bytes by path with the service role (accepting `pageUrls` for one release). Guarded by `test:plan-sheet-urls` (97) + `test:plan-sheet-privacy` (73). **Scope caveat:** this does NOT make drawings private — `rfp-attachments` is a second public bucket serving permanent unsigned drawing URLs that any signed-in account can enumerate off `public_bids.drawing_urls` (filed as DB-F11b). | Three things left, in this order: (1) deploy the 5 edge functions, publish the OTA, and let it REACH devices — a device on the old build resolves sheets as public URLs and a private bucket blanks its takeoff and plan-viewer screens; (2) run the `pg_policies` enumeration in the file's header (b) against production — the migration drops four policies BY NAME off a week-old snapshot, and an out-of-band policy granting public/anon SELECT would survive it silently (the do-block now raises, but look first); (3) deal with the ~7 live objects under `tmp/`, which no membership policy can ever admit (re-render under the right project id, repoint the row, or delete — founder's call). The file's own header has the detail. |

## How to apply one

1. `git mv supabase/migrations/held/<file> supabase/migrations/<file>`
2. Apply it the way the 09-02 / 09-03 batches were applied — through the
   Supabase MCP `apply_migration` (project `nteoqhcswappxxjlpvap`) — or via
   `supabase db push` **only after** the tracker repair described in
   `DEPLOY-VERIFIED-2026-09-02.md` (the tracker does not match the local
   filenames; an unrepaired push replays the whole history).
3. Regenerate `supabase/schema.sql` from production and re-run `bun run ship-check`;
   several guards read that file as production truth.
