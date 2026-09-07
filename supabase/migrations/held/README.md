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
| `20260904101100_plan_sheets_private.sql` | DB-F11: `plan-sheets` is a PUBLIC bucket served by permanent unsigned URLs under a shared `tmp/` prefix. Flipping it private breaks every `plan_sheets.image_uri` the client resolves as a public URL, and every object today lives under `tmp/` where no membership policy can reach it. | The client resolves plan-sheet images through `createSignedUrls` (as `resolvePhotoUrls` does), `app/takeoff.tsx` passes the real project id instead of `'tmp'`, and `convert-pdf-to-images` persists `storagePath` rather than `publicUrl`. |

## How to apply one

1. `git mv supabase/migrations/held/<file> supabase/migrations/<file>`
2. Apply it the way the 09-02 / 09-03 batches were applied — through the
   Supabase MCP `apply_migration` (project `nteoqhcswappxxjlpvap`) — or via
   `supabase db push` **only after** the tracker repair described in
   `DEPLOY-VERIFIED-2026-09-02.md` (the tracker does not match the local
   filenames; an unrepaired push replays the whole history).
3. Regenerate `supabase/schema.sql` from production and re-run `bun run ship-check`;
   several guards read that file as production truth.
