# Final-push deploy runbook — branch `claude/final-push-fixes` (2026-09-04)

> DRAFT — sections marked TODO are filled in when the last review lands.
> Every step below is owner-gated: nothing in this runbook was applied by the
> session that wrote it. Production is `nteoqhcswappxxjlpvap`.

## 0. Order of operations (the gates that bite)

1. **Secrets first** (edge-function secrets, `supabase secrets set`):
   - `UNSUB_SECRET` — new. Without it `unsubscribe` 500s on every POST and the
     six token-minting functions (`daily-digest`, `homeowner-weekly-digest`,
     `invoice-dunning`, `morning-digest`, `notify`, `send-email`) throw on every
     send once deployed.
   - `SCHEDULE_ICAL_SECRET` — **unset in production today (proven by probe:
     the deployed `schedule-ical` accepts tokens minted from the public fallback
     literal).** The branch removes the fallback, so set it BEFORE deploying
     `schedule-ical` / `schedule-ical-url`. Rotation invalidates every existing
     calendar-subscription URL; users re-copy from the app.
   - Optional overrides: `GEMINI_TEXT_MODEL`, `GEMINI_VISION_MODEL`,
     `GEMINI_EMBED_MODEL` (defaults in `_shared/models.ts`).
2. **Migrations** — apply through the Supabase MCP `apply_migration` (never
   `supabase db push`; the tracker does not match local filenames). Order:
   - `20260904100000_notify_trigger_cron_secret.sql` (A1)
   - `20260904100100_pay_links_and_stripe_events.sql` (A2) — **HARD GATE:
     must be applied before `create-payment-link` / `stripe-webhook` deploy.**
     The new `stripe-webhook` names `pay_link_amount` in its credit UPDATE, so
     until the column exists EVERY `checkout.session.completed` fails to credit
     (PostgREST 400), and `create-payment-link`'s persist PATCH fails too, so
     new links never reach the row and are never retired. Until the column
     exists the client also hydrates `payLinkAmount` as undefined, which hides
     Copy/Share and re-mints on every Send — apply the migration, then deploy.
   - `20260904100200` → `100300` → `100400` → `100600` → `100700` → `100800` →
     `20260826130000_field_role.sql` → `20260904100900_field_role_reconcile.sql`
     (the whole set executed twice, cleanly, in a scratch Postgres loaded from
     `schema.sql`; 100800 also repairs the `portal_set_access_token` trigger,
     whose mint branch raises 42883 in production today because
     `gen_random_bytes` lives in schema `extensions`).
   - `20260904100950_portal_id_unique_and_frozen.sql` — LAST, after 100900
     (third-round BLOCKING fix: cross-tenant delete via a spoofed `portalId`).
     Unique partial index on `projects.client_portal->>'portalId'` (NULL and
     `''` excluded), and `projects_freeze_ownership_columns` now pins the
     portal id against non-owners as it pins `user_id`. Refuses to run over
     pre-existing duplicates (reports a count, never the ids — 0 duplicates
     and 0 empty ids live on 2026-09-05) and self-tests the trigger on a temp
     table under a simulated JWT. Independent of 100800 (touches neither the
     token trigger nor any RPC). Proven by reading against `schema.sql` and
     live catalog SELECTs; NOT executed in a scratch Postgres this session.
     Pair with the `delete-account` redeploy in step 4: the function now
     resolves portal ids server-side (`portalCollisions` in its response) and
     is safe on either schema state, so the two can land in either order.
   - After `100200` every NEW function needs an explicit `GRANT EXECUTE`
     (default EXECUTE for public/anon is revoked). A1/A2 files carry theirs.
   - Held (do NOT apply; see `supabase/migrations/held/README.md`):
     `20260826180000_portal_link_expiry_cron` (apply after
     `portal-link-expiry-notice` ships), `20260827120000_project_financials_drop_legacy`
     (phase 2, after the OTA is verified), `20260904101000_profiles_tax_rate_default_zero`
     (founder decision), `20260904101100_plan_sheets_private` (client work first).
3. **Static pages before functions** (Netlify, build-free deploy — builds are
   credit-paused; regenerate `marketing/dist/` from source first, it is stale):
   - `marketing/portal/index.html` must be live BEFORE `notify` deploys
     (homeowner `selection_chosen` / `contract_signed` now carry the portal
     token; the new `notify` refuses token-less anon calls with 403).
   - `marketing/unsubscribe/index.html` must be live with the seven
     unsubscribe-related functions (it now forwards the `t` token).
4. **Edge functions** — deploy from the repo root with the committed
   `supabase/config.toml` (it pins `verify_jwt` per function; deploying from
   inside a function directory breaks `../_shared` imports):
   - 32 directly modified: `ai analyze-drawings analyze-photos analyze-plan-code
     analyze-spec-book analyze-takeoff compare-drawings connect-onboarding
     connect-status convert-pdf-to-images create-payment-link create-rfp-checkout
     delete-account homeowner-weekly-digest import-schedule invoice-dunning notify
     plan-extract portal-ask-home portal-link-expiry-notice project-invite
     safety-detect-hazards safety-draft-incident safety-generate-jha scan-anything
     scan-credential schedule-ical schedule-ical-url send-email stripe-webhook
     transcribe-audio unsubscribe portal-mark-viewed` (`portal-ask-home` and
     `portal-mark-viewed` now authorise through `portal_project_for_token`,
     which exists in production today; they gain expiry enforcement once
     100800 lands).
   - 24 pulled in by changed `_shared` helpers: `auth-magic-link award-rfp
     claim-crew coi-expiry-watch construction-answer daily-digest
     fetch-external-data geocode-bids mcp mcp-token morning-digest
     notify-nearby-contractors og-image project-memory-embed project-memory-search
     public-lead-intake qbo-connect-start qbo-connect-status qbo-reconciler
     qbo-sync seal-document usage-status validate-portal-passcode widget-estimate`.
   - `portal-link-expiry-notice` is a FIRST-TIME deploy.
   - `config.toml` flips `verify_jwt` to false for `invoice-dunning`,
     `morning-digest`, `qbo-reconciler`, `portal-ask-home` (all `true` in prod
     today — every cron fire since July has 401'd; post-deploy check: the
     `UNAUTHORIZED_NO_AUTH_HEADER` rows in `net._http_response` stop).
   - Orphans in prod with no repo source: `sync-bids`, `fetch-material-price` —
     delete.
   - Stripe: the webhook endpoint must also listen on connected accounts
     (`create-payment-link` mints on the connected account).
5. **App** — `git push`, PR, merge; then `eas build --profile production
   --platform ios` (#15: every build #11–#14 predates the 09-02 App Store fixes
   and the native surface changed: dead native deps removed). Run
   `bun run test:native-surface` before the OTA (it exports the bundle and
   fails on undeclared native modules).
6. **Re-run the financials backfill as an UPSERT — immediately before the
   OTA.** One-off data repair through the Supabase MCP `execute_sql` (no
   migration file: it is re-runnable and belongs to no schema version).
   WHY: the phase-1 backfill (2026-09-02/03) copied `projects.*` money into
   `project_financials` ONCE, `ON CONFLICT DO NOTHING`, and only for rows that
   carried money at that moment. Every device still runs the pre-split build
   and writes `projects.*` ONLY, so each estimate created or changed since
   lives in `projects` and not in the fin row (or has no fin row at all). The
   new build's loader prefers the fin row (`financialPick`), so without this
   step the owner's own device would load the stale backfill-time estimate
   and its next edit would copy it back over `projects.estimate` — the
   owner's newer estimate gone. **The code guard covers only half of this.**
   B-3 holds money back when there is NO fin row and the legacy columns carry
   money (the editor sees the legacy value read-only). It does NOT fire when a
   fin row EXISTS but is stale: an editor already on the OTA loads the
   backfill-time value and their next edit — a rename is enough — writes it
   over the owner's newer `projects.estimate` on both tables. That population
   is exactly what this step drains, so run it before anyone is on the new
   build, not after.

   **Run it as the table owner** (a write, so the MCP must be write-enabled,
   or use the SQL editor; never `supabase db push`). RLS on
   `project_financials` is `enable`, not `force`, so an owner-role statement
   sees every tenant.

   ```sql
   -- Dry run: how many fin rows are missing or behind the projects row?
   select count(*) filter (where f.project_id is null)     as missing,
          count(*) filter (where f.project_id is not null) as behind
   from public.projects p
   left join public.project_financials f on f.project_id = p.id
   where (f.project_id is null
          and (p.estimate is not null or p.linked_estimate is not null
               or p.estimate_versions is not null or p.target_budget is not null))
      or (f.project_id is not null
          and (coalesce(p.updated_at, p.created_at, 'epoch'::timestamptz)
                 > coalesce(f.updated_at, 'epoch'::timestamptz)
               or f.user_id is distinct from p.user_id));

   -- Repair. projects.updated_at is trigger-stamped on every UPDATE
   -- (projects_updated_at → update_updated_at()); project_financials has no
   -- such trigger, so f.updated_at is whatever its last writer sent (the
   -- backfill copied p.updated_at, the app sends project.updatedAt, QBO sends
   -- now()). "p newer than f" therefore means a device moved the projects row
   -- after the fin row was written — including clearing an estimate, which is
   -- why the "behind" branch copies regardless of NULLs (and coalesces them:
   -- projects.updated_at is nullable, so a bare `>` skipped those rows and the
   -- verify step still read 0/0); the "missing" branch
   -- keeps the original backfill's carries-money test (no row for no money).
   -- user_id is reset to the owner's on purpose: the fin UPDATE policy admits
   -- editors and, unlike projects, nothing freezes that column.
   insert into public.project_financials
     (project_id, user_id, estimate, linked_estimate, estimate_versions, target_budget, created_at, updated_at)
   select p.id, p.user_id, p.estimate, p.linked_estimate, p.estimate_versions, p.target_budget,
          coalesce(p.created_at, now()), coalesce(p.updated_at, now())
   from public.projects p
   left join public.project_financials f on f.project_id = p.id
   where (f.project_id is null
          and (p.estimate is not null or p.linked_estimate is not null
               or p.estimate_versions is not null or p.target_budget is not null))
      or (f.project_id is not null
          and (coalesce(p.updated_at, p.created_at, 'epoch'::timestamptz)
                 > coalesce(f.updated_at, 'epoch'::timestamptz)
               -- a drifted user_id hides the project from the owner's own MCP
               -- and QBO views, which filter project_financials by user_id
               or f.user_id is distinct from p.user_id))
   on conflict (project_id) do update
     set user_id           = excluded.user_id,
         estimate          = excluded.estimate,
         linked_estimate   = excluded.linked_estimate,
         estimate_versions = excluded.estimate_versions,
         target_budget     = excluded.target_budget,
         updated_at        = excluded.updated_at
   where coalesce(project_financials.updated_at, 'epoch'::timestamptz)
           < excluded.updated_at
      or project_financials.user_id is distinct from excluded.user_id;

   -- Verify: the dry run now returns 0 / 0.
   ```

   **Measured 2026-09-06 (read-only):** 7 projects, 0 with a NULL
   `updated_at`, 0 missing fin rows, 0 behind, 0 with a drifted `user_id` — so
   the repair is a no-op *today*. Its value is entirely the window between now
   and the OTA: every pre-split device that saves an estimate in that window
   creates exactly the drift above. Re-run the dry run at deploy time rather
   than trusting this number.

   Residual window: a device that has not yet applied the OTA keeps writing
   `projects.*` after this runs (expo-updates applies a downloaded update on
   the NEXT launch). The repair is idempotent — re-run it once every device
   is on the new build, and once more right before the phase-2 column drop
   (`20260827120000_project_financials_drop_legacy`, held), which discards
   `projects.*` for good. Rows the new build touches will show as "behind"
   by a few hundred ms (server-stamped `projects.updated_at` vs the client
   timestamp the app sends to fin) — the copy is a no-op there, both tables
   already agree.
7. **OTA** — `eas update --branch production` (the channel is baked into the
   production build profile; see CLAUDE.md).
8. **Verify** — regenerate `supabase/schema.sql` from production, re-run
   `bun run ship-check`, correct `DEPLOY-VERIFIED-2026-09-02.md` (the
   `field` role and `can_access_project` rows).

**Known limitation to carry into phase 2**: the projects loader reads
`projects` and `project_financials` as two unranged `select('*')` calls. Past
PostgREST's max-rows cap the two pages need not cover the same project ids.
Today that fails safe (the owner falls back to the legacy columns, a
collaborator holds money back). After the phase-2 column drop it becomes
"money silently missing on load" — page both reads, or join them, before
applying `20260827120000_project_financials_drop_legacy`.

## 0b. Verified against live production while writing this runbook

- The PostgREST JSON-path alias the new `delete-account` resolver depends on
  (`select=id,portal_id:client_portal->>portalId`) was probed against the live
  REST endpoint with the public anon key: **HTTP 200** (RLS-filtered empty set),
  while a deliberately malformed operator returns **400 PGRST100**. The
  `client_portal->>portalId=in.(...)` filter form also returns 200. So the
  resolver parses; it does not need a post-deploy syntax probe.
- `SCHEDULE_ICAL_SECRET` is unset in production: a token derived from the public
  fallback literal was accepted by the deployed `schedule-ical`. Set it before
  deploying that function (see step 1).
- Four functions are deployed with `verify_jwt: true` that must be false
  (`morning-digest`, `invoice-dunning`, `qbo-reconciler`, `portal-ask-home`);
  `net._http_response` carries the resulting 401s.
- **PostgREST `.in()` splits a single value into several, and that was a live
  cross-tenant delete.** postgrest-js wraps any `.in()` value containing
  `,`, `(` or `)` in double quotes and escapes nothing inside them
  (`PostgrestFilterBuilder.ts`, identical in 2.39.7 — the version
  `delete-account` pins — and in 2.103.3); PostgREST then splits on the commas
  between quoted items and un-escapes `\"` inside them. Probed against live
  production on 2026-09-06 with the public anon key (read-only GETs on
  `city_coords`): `state=in.("TX","CA")` → 200 with **TX rows and CA rows**;
  `latitude=in.("AA\",\"BB")` → 400 naming the single value `AA","BB`;
  `state=in.("TX\",\"CA",CA)` → 200 with CA rows (escaped and plain items
  coexist, which is what defeated the portal-id resolver); `state=eq.TX","CA`
  → 200 `[]`, so **`.eq` does not split** — it appends `eq.${value}` verbatim.
  `delete-account` keyed two service-role deletes on `text` ids the caller
  minted (`sub_portal_links.id`, which has no default and whose INSERT policy
  checks only `user_id`; and `client_portal->>'portalId'`), so one crafted id
  erased another tenant's `sub_submitted_invoices` / `sub_portal_snapshots` /
  portal rows. Fixed on this branch: a charset gate (`SAFE_DELETE_KEY`,
  `/^[A-Za-z0-9._:-]{1,128}$/`) before any id becomes a filter value, `.eq`
  per id on the two text-keyed columns, and matching `CHECK` constraints in
  `20260904100950` (section 2b). **`delete-account` must be redeployed with
  that migration** — neither half depends on the other and they may land in
  either order, but a database carrying only one still carries the other
  half's risk. Live counts on 2026-09-06: `sub_portal_links` 0 rows,
  `projects` 7 rows / 3 portal ids (lengths 20, 24, 24) — **0 violations of
  the new charset on either table**, so both constraints validate on add.

## 1. Follow-ups deliberately NOT done on this branch (TODO: final list)
