# MAGE ID — Architecture Summary

*Generated 2026-08-03 against commit `e71fb94`. Every claim below was checked against the code or the production database. Where something is broken, unapplied, or unreachable, it says so.*

---

## Read this first

**Status: pre-launch.** No real users. Row counts are dev/demo scale. Breaking changes need no grandfathering.

**Two corrections to figures in circulation:**

| Claim | Reality | How verified |
|---|---|---|
| "103 tables" | **101** base tables in `public`, all 101 RLS-enabled. No views, no matviews. | `pg_class` count, `relkind='r'` |
| "61 edge functions" | **60** deployable functions + `_shared/` (shared code, not a function) | `ls supabase/functions/` |

**Shipped in the last two days** (`2c082db` → `e71fb94`, 2026-08-02/03): native file upload zero-byte fix, photo upload queue (bytes finally reach `project-photos`), superseded-drawing warnings, takeoff priced from your own rates, cost seeding, T&M field tickets, portal CO e-signature, plain-English draw request, milestone→invoice billing flow, "MAGE found $X" recovered-value card, and the marketing `/brain/` page. `bun run ship-check` = 128 chained steps (typecheck, lint, 126 validators), 3,147 assertions passing.

**Written but NOT applied — the product has code paths that will fail until these ship:**

| Artifact | State | Consequence |
|---|---|---|
| `supabase/migrations/20260803120000_invoice_milestone_link.sql` | not applied | invoice-side half of the double-bill guard is inert (milestone side still holds) |
| `supabase/migrations/create_field_tickets.sql` | not applied | no `field_tickets` table exists in prod; T&M tickets are AsyncStorage-only |
| `supabase/migrations/20260803120500_portal_co_esignature.sql` | not applied | portal CO signature columns missing |
| `supabase/functions/invoice-dunning` | deployed at v4, but the **current source is undeployed** (changed in `dc6d584`) | "Send reminder now" will fail |

Last applied migration: `20260730142849 public_price_index`.

---

## 1. Database — 101 tables, 11 clusters

Postgres 17.6 on Supabase project `nteoqhcswappxxjlpvap` (`mageid-production`, us-east-2). RLS is on for every table. Schema of record: `supabase/schema.sql` (1,485 lines, 133 `CREATE POLICY` statements) plus **128 applied migrations**. Note the local `supabase/migrations/` directory holds only **84** `.sql` files — a chunk of production history was applied out-of-band and has no file in the repo, so the directory is not a replayable record of the database.

### The shape of the graph

Almost everything hangs off `projects` — **34 tables carry a `project_id` FK to `projects.id`** (plus `leads.converted_project_id`), and that is the only real join spine. Secondary chains are shallow:

- `plan_sheets` → `drawing_pins`, `plan_markups`, `plan_calibrations`
- `public_bids` → `bid_responses`, `bid_questions`
- `bid_packages` → `bid_package_bids`
- `selection_categories` → `selection_options`
- `conversations` → `conversation_participants`, `messages`
- `rfis` / `submittals` → `pro_responses`

Large domain objects are **jsonb columns on `projects`**, not tables: `estimate`, `schedule`, `linked_estimate`, `scope`, `estimate_versions`, `client_portal`, `target_budget`, `handover_checklist`, `collaborators`, `primary_contact`. This matters for RLS (see below) and means the schedule/estimate engines operate on documents, not rows.

### Clusters

| Cluster | Tables | Populated | Empty |
|---|---|---|---|
| **Core project** (16) | `projects` 7, `profiles` 29, `contacts` 17, `oac_meetings` 4, `permits` 4, `selection_options` 6, `selection_categories` 2, `project_contracts` 1, `leads` 1 | 9 | `project_collaborators`, `permit_templates`, `closeout_binders`, `warranties`, `owner_supplied_items`, `scan_records`, `comm_events` |
| **Financial** (15) | `subscriptions` 23, `invoices` 5, `change_orders` 4, `lien_waivers` 1, `qbo_connections` 1 | 5 | `aia_pay_apps`, `draw_periods`, `commitments`, `wip_periods`, `financing_referrals`, `qbo_cost_lines`, `rate_overrides`, `estimate_versions`, `rfp_post_credits`, `rfp_post_payments` |
| **Field execution** (12) | `equipment` 13, `photos` 9, `daily_reports` 8, `time_entries` 2 | 4 | `punch_items`, `workers`, `crew_members`, `delivery_receipts`, `plan_sheets`, `drawing_pins`, `plan_markups`, `plan_calibrations` |
| **Safety** (7) | `certifications` 12, `safety_inspections` 3 | 2 | `jhas`, `toolbox_talks`, `safety_incidents`, `hazards`, `safety_templates` |
| **Docs / RFI** (3) | `rfis` 3, `submittals` 2 | 2 | `pro_responses` |
| **Portal / client** (7) | `portal_messages` 10, `portal_snapshots` 3, `email_unsubscribes` 1 | 3 | `portal_budget_proposals`, `change_order_approvals`, `portal_decision_audit`, `shared_schedule_snapshots` |
| **Sub / network** (10) | `subcontractors` 17, `cois` 10 | 2 | `sub_portal_links`, `sub_portal_snapshots`, `sub_submitted_invoices`, `sub_change_requests`, `prequal_packets`, `contractor_licenses`, `bid_packages`, `bid_package_bids` |
| **Marketplace** (11) | `public_bids` 3, `feature_interest` 2 | 2 | `companies`, `bid_responses`, `bid_questions`, `job_listings`, `worker_profiles`, `conversations`, `conversation_participants`, `messages`, `user_tracked_bids` |
| **Reference / cache** (11) | `cached_companies` 1869, `city_coords` 1338, `cached_jobs` 410, `zip_cost_factors` 386, `cached_bids` 266, `materials_pricing` 236, `labor_rates` 120 | 7 | `material_prices`, `assemblies`, `price_alerts`, `cost_benchmark_samples` |
| **AI / brain** (4) | `ai_usage_counters` 13, `ai_daily_usage` 12, `brain_predictions` 3 | 3 | `memory_embeddings` (pgvector) |
| **Infra** (5) | `notification_outbox` 105, `rate_limit_counters` 15, `app_config` 3, `geocode_run_lock` 1 | 4 | `mcp_tokens` |

**Read the empty column as a maturity signal.** The whole marketplace lane (`companies`, `job_listings`, `worker_profiles`, `conversations`, `messages`) is empty because it is feature-flagged off (§4). Safety, sub-portal, prequal, WIP, commitments and AIA pay apps are built but have never been exercised with real data. The only tables with meaningful volume are the **scraped/reference caches** — which is the correct shape for a pre-launch cost-learning product, and also the honest answer to "how much does the brain know": almost nothing yet.

### The RLS model — and the one hole

**The policy shape is `auth.uid() = user_id`, almost everywhere.** `supabase/schema.sql` declares 133 policies and the literal string `auth.uid() = user_id` appears 105 times in it. The exceptions:

| Exception | Where | Shape |
|---|---|---|
| `profiles` | `schema.sql:765-767` | `auth.uid() = id` |
| Shared reference data | `schema.sql:932, 1068, 1089, 1110, 1131` | `auth.role() = 'authenticated'` on `materials_pricing`, `material_prices`, `labor_rates`, `assemblies`, `zip_cost_factors` — read-only, non-tenant data |
| Marketplace feed | `schema.sql:876, 882, 887, 893` | `auth.role() = 'authenticated'` on `public_bids`, `companies`, `job_listings`, `worker_profiles` |
| Messaging | `schema.sql:903-918` | participant sub-select on `conversations` / `messages` |
| Storage buckets | `schema.sql:945-996` | `foldername(name)[1] = auth.uid()` — per-user folder prefix |
| Portal | all direct anon read policies **dropped** (`20260721043510_portal_rls_drop_defanged_client_read_policies`); portal reads go through token-checked RPCs only |

**The gap — collaborators can read the schedule and nothing else.**

`20260728140000_project_collaborators.sql` added a `SECURITY DEFINER` helper `is_project_collaborator(pid uuid, min_role text default 'viewer')` (line 35) and applied it to exactly two policies:

```sql
create policy projects_select on public.projects
  for select to authenticated
  using (auth.uid() = user_id or public.is_project_collaborator(id));          -- line 64

create policy projects_update on public.projects
  for update to authenticated
  using      (auth.uid() = user_id or public.is_project_collaborator(id, 'editor'))
  with check (auth.uid() = user_id or public.is_project_collaborator(id, 'editor')); -- lines 68-69
```

`is_project_collaborator` appears **nowhere else in the repo**, and a live check against `pg_policies` confirms it: **exactly two policies in the entire database reference it, both on `projects`.** Every sub-table is still owner-only: `change_orders` (`schema.sql:776`), `rfis` (`:842`), `submittals` (`:848`), `daily_reports`, `invoices`, `punch_items`, `photos`.

Because the schedule lives in `projects.schedule` (jsonb), extending `projects` RLS was sufficient for the schedule feature — and *only* the schedule feature. An invited editor who accepts, signs in, and opens any other screen gets **zero rows**. This was a deliberate Phase-1 scope decision (`docs/superpowers/specs/2026-07-28-live-schedule-collaboration-design.md:119`) and is documented as the highest-value open task (`docs/superpowers/specs/2026-08-02-product-audit-design.md:185-217`).

Two consequences worth naming:

- **No field-only role.** An `editor` collaborator reading `projects.estimate` sees every markup line. There is no way to invite a foreman without exposing margin.
- **No seats.** Tier is keyed to a single `user_id` in `subscriptions`. There is no company account and no seat billing. Collaboration is per-project invites gated at **Pro** (`schedule_collaboration`).

**Locked-down surfaces worth knowing about:** `rate_limit_counters` and `app_config` reads are revoked from clients; `ai_usage_increment` / rate-limit RPCs have `EXECUTE` revoked from `public`/`anon`/`authenticated` (four migrations on 2026-07-21); certified AIA pay apps are immutable (`20260728120000_lock_certified_aia_pay_apps`); every function has a pinned `search_path`.

---

## 2. Backend — what actually exists

> **Correction up front: there is no Python/FastAPI backend, and never has been.** The only `.py` file in the repo is `scripts/generate_bundles.py`, a context-packing build script. There is zero FastAPI, Flask, Django, or uvicorn anywhere. (For the same reason, ignore any doc claiming tRPC — `lib/trpc.ts` and `backend/trpc/` do not exist.)

The backend is **Supabase Postgres + 60 Deno edge functions** under `supabase/functions/`. Plus one vestige:

**`backend/hono.ts`** — 17 lines, a Hono app with `GET /` (health) and `app.route("/email", …)` proxying to `backend/routes/send-email.ts` (Resend). **Nothing imports it.** It is not mounted in `app.json`, `netlify.toml`, or any app code. Treat it as dead.

### The shared auth layer — `supabase/functions/_shared/auth.ts`

`requireTier(req, allowed: Tier[], _featureName: string)` (line 102) is the server-side gate. Order of operations:

1. Requires **both** an `Authorization: Bearer <user JWT>` and a non-trivial `apikey` header — a forged JWT without the platform anon key is rejected (line 113).
2. **Cryptographically verifies** the JWT via GoTrue `/auth/v1/user` (`verifyUserToken`, `_shared/verifyUser.ts:43`). Never a claims decode. Rejects if `role !== 'authenticated'` (line 126).
3. `MASTER_EMAILS` (line 88) — `omirmajeed2000@gmail.com`, `support@mageid.app` — get `business` regardless of RevenueCat. Must stay in sync with `utils/owner.ts:24` `OWNER_EMAILS` (same two addresses; currently in sync).
4. **Min-rank comparison** (lines 152-153): `{free:0, pro:1, business:2, enterprise:3}`, compared against `Math.min(...allowed)`. So `['pro','business']` means "pro or higher" and enterprise passes automatically. The comment records why: exact-match `includes()` used to 403 new enterprise subscribers on every vision feature.

`MONTHLY_CAPS` (line 292) is the per-tier vision/AI ceiling, e.g.:

| Feature | free | pro | business | enterprise |
|---|---|---|---|---|
| `analyze_drawings` | 0 | 15 | 50 | 100 |
| `analyze_photos` | 0 | 50 | 150 | 200 |
| `takeoff_pages` | 0 | 30 | 100 | 300 |
| `ai_text` | 150 | 900 | 2400 | 4500 |
| `plan_extract` | 0 | 0 | 100 | 300 |
| `project_memory` (per doc) | 0 | 50,000 | 200,000 | 600,000 |

Metering **fails closed**: `aiUsageIncrement` / `aiUsageGet` return `Number.MAX_SAFE_INTEGER` on RPC error, not `0` — an outage denies rather than uncaps. `rateLimitCount()` (hourly buckets) deliberately fails **open** at `-1`. `scripts/validate-edge-security.ts` pins both behaviours.

Other `_shared` modules: `cronAuth.ts` (`x-cron-secret` validated against a SECURITY DEFINER RPC so the secret never leaves the DB), `email.ts` (661 lines — the whole transactional email system: Resend send with 429 backoff, RFC 8058 List-Unsubscribe, FNV-1a unsubscribe tokens with constant-time verify), `urlGuard.ts` (SSRF defence — HTTPS-only, own-Supabase-host-only, private/link-local IP denial), `embeddings.ts` (Gemini `text-embedding-004`, 768-dim), `mcpToken.ts`, `qbo.ts` (+ `qbo-mapping/`), `verifyUser.ts`.

### The 60 functions, by purpose

| Group | Functions |
|---|---|
| **AI / vision** (17) | `ai` (text relay), `analyze-drawings`, `analyze-photos`, `analyze-plan-code`, `analyze-spec-book`, `analyze-takeoff`, `compare-drawings`, `plan-extract`, `convert-pdf-to-images`, `scan-anything`, `scan-credential`, `transcribe-audio`, `safety-generate-jha`, `safety-detect-hazards`, `safety-draft-incident`, `project-memory-embed`, `project-memory-search` |
| **Payments / Stripe** (5) | `create-payment-link`, `stripe-webhook`, `create-rfp-checkout`, `connect-onboarding`, `connect-status` |
| **Portal RPCs** (5) | `portal-ask-home`, `portal-mark-viewed`, `validate-portal-passcode`, `widget-estimate`, `seal-document` |
| **Notifications / email** (7) | `notify` (single dispatcher, 14+ event types), `send-email`, `unsubscribe`, `daily-digest`, `morning-digest`, `homeowner-weekly-digest`, `invoice-dunning` |
| **QuickBooks** (5) | `qbo-connect-start`, `qbo-connect-callback`, `qbo-connect-status`, `qbo-sync`, `qbo-reconciler` |
| **Cron / scheduled** (7) | `daily-digest`, `morning-digest`, `homeowner-weekly-digest`, `coi-expiry-watch`, `invoice-dunning`, `qbo-reconciler`, `geocode-bids` |
| **Auth / account** (5) | `auth-magic-link`, `delete-account`, `project-invite`, `mcp-token`, `mcp` |
| **Marketplace / public** (6) | `award-rfp`, `public-lead-intake`, `public-cost-index`, `notify-nearby-contractors`, `claim-crew`, `revenuecat-webhook` |
| **Misc** (5) | `og-image`, `fetch-external-data`, `import-schedule`, `schedule-ical`, `schedule-ical-url`, `financing-redirect`, `financing-callback` |

### Service-role usage — where the ownership check *is* the security boundary

**37 of the 60 functions reference `SUPABASE_SERVICE_ROLE_KEY`.** A service-role client **bypasses RLS entirely**, so in those functions the hand-written ownership check is the only thing standing between a signed-in stranger and someone else's data.

The pattern in use, and why each is defensible:

| Reason for service role | Functions | The load-bearing check |
|---|---|---|
| No user JWT exists (cron) | `daily-digest`, `morning-digest`, `homeowner-weekly-digest`, `coi-expiry-watch`, `qbo-reconciler`, `invoice-dunning` | `x-cron-secret` → `verify_cron_secret` RPC |
| No user JWT exists (portal) | `portal-ask-home`, `portal-mark-viewed`, `validate-portal-passcode`, `widget-estimate` | constant-time portal access-token compare + per-portal and per-IP rate limits |
| No user JWT exists (public) | `public-lead-intake` | `gc_user_for_company_slug()` RPC + `lead:ip:` / `lead:slug:` rate limits |
| Signed webhook | `stripe-webhook`, `revenuecat-webhook` | HMAC signature verification |
| Deliberate cross-tenant write | `award-rfp`, `project-invite` | `verifyUser()` first, then an explicit owner check (`callerOwnsProject`) |
| Convenience over the user's own rows | `create-payment-link`, `connect-*`, `qbo-*`, `mcp`, `seal-document`, `send-email`, `schedule-ical*`, `geocode-bids`, `claim-crew`, `financing-*` | `.eq('user_id', <verified uid>)` on every query |

**A live example of why this matters**, from the last commit (`dc6d584`): wiring an in-app "Send reminder now" path into the cron-only `invoice-dunning` opened a real hole — the service-role client would happily email *anyone's* client. The fix is `supabase/functions/invoice-dunning/index.ts:486-489`:

```ts
// Ownership gate for the in-app path. The service-role client bypasses …
if (caller && invoice.user_id !== caller.id) { … }
```

That check is the entire authorization for that path. There is no RLS behind it.

Two validators pin this class of invariant: `scripts/validate-edge-security.ts` (fail-closed metering, `og-image` DNS-level SSRF guard with `redirect:"manual"`, project-memory caps + rate limits, lead-intake limits) and `scripts/validate-portal-security.ts` (the portal HTML must call `/rest/v1/rpc/*` with `p_access_token` and must **never** touch `/rest/v1/portal_snapshots` etc. directly).

### AI providers

| Provider | Model | Used by |
|---|---|---|
| Google Gemini | `gemini-2.5-flash` | default for all 16 vision/text functions |
| Google Gemini | `gemini-2.5-pro` | Business/Enterprise upgrade in `analyze-drawings`, `analyze-takeoff`, `analyze-spec-book`, `compare-drawings` |
| Google Gemini | `text-embedding-004` (768-dim) | `_shared/embeddings.ts` → `memory_embeddings` (pgvector) |
| Anthropic | `claude-sonnet-4-5` | `analyze-takeoff` only, top-tier, falls back to `gemini-2.5-pro` if `ANTHROPIC_API_KEY` is unset |

**Two orphan functions are live in production with no source in this repo:** `sync-bids` (v23) and `fetch-material-price` (v21). Nothing can redeploy or audit them from here.

---

## 3. Frontend

React Native / Expo, **Expo Router 6 with `experiments.typedRoutes` on**. iOS primary (`ios.supportsTablet: false`), Android + web supported. Bundle `com.mageid.app`. Deep-link scheme `mageid://` (single source: `utils/deepLinkScheme.ts`); web origin `https://app.mageid.app/`.

| Surface | Count |
|---|---|
| Route files under `app/` | 199 |
| `Stack.Screen` declarations in `app/_layout.tsx` | 154 (17 with `presentation: 'modal'`) |
| Components | 217 across 14 subdirectories |
| Utils | 355 |
| Hooks | 41 |
| Contexts | 15 |
| Validators in `scripts/` | 125 `validate-*.ts` (+ `test-cpm.ts`) |
| `types/index.ts` | 4,514 lines — the single source of truth for domain types |

### `app/_layout.tsx` — one root, 1,511 lines

Every route in the app is declared here as a `Stack.Screen`. The provider stack, verified top-down (lines 1454-1510):

```
ErrorBoundary
└── QueryClientProvider              staleTime 5min, networkMode 'offlineFirst'
    └── GestureHandlerRootView
        └── ThemeLoader              reads mageid_theme from AsyncStorage before first paint
            └── ThemeProvider
                └── AuthProvider     ← everything below this sees the user
                    └── SubscriptionProvider   (RevenueCat; needs the auth user)
                        └── ProjectProvider    (the core data context)
                            └── ScanProvider
                              └── WipProvider
                                └── CrewProvider
                                  └── SafetyProvider
                                    └── PropertyProvider
                                      └── MaterialCartProvider
                                        └── BidsProvider
                                          └── CompaniesProvider
                                            └── HireProvider
                                              └── NotificationProvider
                                                └── SearchProvider
                                                    ├── MagicLinkHandler
                                                    ├── AnalyticsManager
                                                    ├── OfflineSyncManager
                                                    ├── MarginAlertManager
                                                    ├── RootLayoutNav  (the Stack)
                                                    ├── BrainSurface
                                                    ├── SearchHotkeyListener
                                                    ├── AlertHost      ← must stay mounted
                                                    ├── NailItToastHost
                                                    └── ConfettiHost
```

**Why the order matters:** contexts are built with `@nkzw/create-context-hook`. Anything below `AuthProvider` can read the current user; anything above cannot. `SubscriptionProvider` sits directly under `Auth` because RevenueCat identification needs the user id. `ProjectProvider` sits under `Subscription` because tier gating affects what it loads. The singleton hosts (`AlertHost`, `NailItToastHost`, `ConfettiHost`, `BrainSurface`) sit *inside* every provider so they can read theme + data, and *outside* the Stack so they survive navigation.

Also in the root: Sentry (production only, 10% traces, session replay), `BrandSplash` (a full-screen overlay above the hydrating app, not a blocking gate), and `MagicLinkHandler` which pulls `access_token`/`refresh_token` out of the URL fragment and redeems via `supabase.auth.setSession()`.

### Two navigation surfaces that must stay in sync

**`app/(tabs)/_layout.tsx`** — two rendering branches on `layout.showSidebar` (line 118). On desktop it renders `Tabs` with `tabBarStyle: { display: 'none' }` and lets the sidebar drive; on mobile it renders the real tab bar (lines 194-247):

| Visible on mobile (4) | Hidden with `href: null` (9) |
|---|---|
| `summary`, `(home)`, `discover`, `settings` | `estimate`, `materials`, `schedule`, `marketplace`, `subs`, `equipment`, `mage-id-bids`, `construction-ai` |

`isMinimalPersona` (`userRole === 'client'` or `'property_manager'`, line 102) nulls `summary` and `discover` as well — collapsing to **Home + Settings**. The `(home)` tab carries the attention badge from `useBrainWatch()`, which is deliberately the same number the Brain Watch card and the Summary hero pill show (it used to be the Smart Inbox row count, so three surfaces disagreed).

**`components/DesktopSidebar.tsx`** — the wide-screen rail, and the *real* nav. ~86 items in eight collapsible sections: Workspace, Find Work, Network, Overview, Field Ops, Financials, Client, Account. `app/_layout.tsx:213-226` holds a `DESKTOP_SHELL_EXEMPT` set so auth/onboarding/modal/full-takeover routes render full-bleed without the rail.

**The drift is real and structural.** The sidebar exposes ~86 destinations; the tab bar exposes 5. Most of the product is only reachable on desktop or via Cmd-K. The 2026-08-02 audit found two fully-built features (`home-passport`, `widget-setup`) that were reachable *only* through Cmd-K search until they were added to the sidebar in that pass.

### Cmd-K — `utils/featureRegistry.ts`

333 lines, 102 `FeatureEntry` records shaped `{ id, title, synonyms[], route, requires?, icon, group, persona? }`:

```ts
{ id: 'judges', title: 'Bid Advisor',
  synonyms: ['bid', 'judges', 'bid scoring', 'should i bid', 'go no go'],
  route: '/judges', requires: 'bid_scoring', icon: 'Scale', group: 'find-work' }
```

`components/UniversalSearch.tsx` is a two-lane palette: **features** (synchronous token match, ranked title-prefix 5 → synonym-exact 4 → title-word 3 → synonym-start 2 → contains 1, multi-token AND, tier-locked entries badged rather than hidden) and **entities** (debounced 150 ms substring scan over `ProjectContext` — projects, contacts, RFIs, invoices — capped at 50, recency-boosted). Empty state shows a popular shortlist plus the last 5 from `mageid_recent_searches`. `SearchHotkeyListener` binds Cmd-K/Ctrl-K on web.

`scripts/validate-feature-search.ts` enforces the parity that keeps this honest: unique ids, lowercase synonyms, `requires` must be a real `FeatureKey`, **every route must resolve to a real file under `app/`**, and **every `DesktopSidebar` route must exist in the registry** (with a narrow `SIDEBAR_EXEMPT` for the `HIRE_ENABLED`-gated entries). Add a sidebar item without registering it and ship-check fails.

### State — four stores, and one that isn't there

| Layer | Mechanism |
|---|---|
| **Server / remote** | `@tanstack/react-query` + `lib/supabase.ts`. 41 hooks in `hooks/`. `staleTime` 5 min, `networkMode: 'offlineFirst'`, retry skips `TypeError: Failed to fetch` |
| **Cross-screen domain** | the 15 contexts, via `@nkzw/create-context-hook` |
| **Persistence** | `AsyncStorage`, every key namespaced `mageid_*` |
| **Local / UI** | **zustand is a declared dependency (`package.json:198`) with zero imports anywhere in the source tree.** Component-local UI state is plain `useState`. Any doc claiming "zustand for local UI" — including `CLAUDE.md` — is describing an intent, not the code. |

**`LOCAL_USER_CACHE_KEYS` (`contexts/AuthContext.tsx:31-76`)** is the cross-tenant guard. ~48 `mageid_*` keys — projects, invoices, change orders, DFRs, punch items, photos, RFIs, submittals, COIs, permits, field tickets, cost seeds, the brain ledger, the schedule draft, recent searches — wiped on logout, on account delete, and **on every successful sign-in**. The last one is the important case: on a shared device, User B signs in and gets a clean slate rather than User A's cached rows during the window before Supabase hydrates. **Any new per-user `mageid_*` key that isn't added here leaks across tenants.**

**Offline-first writes (`utils/offlineQueue.ts`).** Nothing in the UI calls `supabase.from(...).insert/update/delete` directly. Everything goes through the queue: optimistic local mutation → enqueue `{table, operation, data, retryCount}` → `OfflineSyncManager` (`app/_layout.tsx:359-447`) drains on startup, on foreground, and on a self-rescheduling backoff (5 s → 5 min cap). Max 1,000 queued mutations (FIFO drop), max 5 retries each. Network errors and schema-cache misses re-queue without burning retry budget; JWT/permission/RLS errors are terminal. A re-entrancy guard returns the in-flight promise so overlapping drains can't double-insert. Photos use a **separate** queue (`utils/photoUploadQueue.ts`, concurrency 2) because multi-MB bodies must not enter an AsyncStorage-backed text queue.

**Component organisation.** `components/` has 14 subdirectories that map to product areas rather than to widget types: `ui/`, `home/`, `schedule/` (+ `schedule/tabs`, `schedule/mobile`), `estimate/`, `plans/`, `subs/`, `brain/`, `copilot/`, `judges/`, `passport/`, `collaborators/`, `summary/`, `animations/`, `icons/`. Flat top-level files are the cross-cutting ones (`InfoBubble`, `Paywall`, `DesktopSidebar`, `UniversalSearch`, `SignaturePad`).

---

## 4. Active modules — what's real, what isn't

Tier keys come from `utils/featureTiers.ts` — **33 keys total: 16 Pro, 15 Business, 2 free.** There is no `enterprise` requirement in the table; enterprise is a rank, not a gate. `hooks/useTierAccess.ts` is the only client-side gate (do not branch on raw RevenueCat entitlements).

| Module | Entry point | Core logic | Gate | Maturity |
|---|---|---|---|---|
| **Estimating / takeoff** | `app/estimate-wizard.tsx` (1,685), `app/takeoff.tsx` (2,369), `app/takeoff-estimate.tsx` | `utils/costDatabase.ts`, `utils/estimateAssemblies.ts`, `utils/takeoffPricing.ts`, `utils/takeoffGeometry.ts`, `utils/estimateCalibration.ts` | `ai_estimate_wizard` Pro | Real. Grounding is the weak point — see cost seeding below. |
| **Cost seeding** | `app/cost-seed.tsx` (712) | `utils/costSeedCore.ts`, `hooks/useCostSeeds.ts` | `job_costing` Pro | Shipped 2026-08-03. **Reaches only 5 of 16 cost-book consumers** — Cost X-Ray and the copilot still see an empty book. **AsyncStorage-only, no Supabase table** — seeds do not survive a reinstall. |
| **Scheduling** | `app/schedule-pro.tsx` (2,208), `app/schedule-wizard.tsx` (2,871), `app/(tabs)/schedule/` | `utils/cpm.ts` (forward/backward pass, float, **resource leveling at :810**), `utils/scheduleEngine.ts`, `utils/scheduleRebase.ts`, `utils/scheduleHealthScore.ts`, `utils/scheduleEarnedValue.ts`, `utils/scheduleMerge.ts` | `schedule_import`, `schedule_scenarios`, `schedule_collaboration` — all Pro | The deepest module in the app. CPM, float, leveling (engine + preview/apply UI), baselines, lag/lead per dependency, iCal export, .mpp/.xer import. |
| **Bidding & marketplace** | `app/post-bid.tsx`, `app/bid-detail.tsx`, `app/auto-bids.tsx`, `app/(tabs)/mage-id-bids/` | `utils/bidLevelingEngine.ts`, `utils/bidQuestionsEngine.ts`, `utils/bidHistoryFacts.ts` | `unlimited_bid_responses`, `bid_scoring` — Business | Feed is populated from scraped caches. `auto-bids.tsx` is **registered with zero inbound navigation**. |
| **Job costing & WIP** | `app/job-costing.tsx`, `app/budget-dashboard.tsx`, `app/wip-report.tsx`, `app/cost-xray.tsx` | `utils/costDatabase.ts`, `utils/estimateActuals.ts`, `utils/profitLeak/*` | `job_costing` Pro; `full_budget_dashboard`, `wip_reporting`, `cost_xray` Business | Engines are pinned by validators. `wip_periods` and `commitments` are empty. |
| **Invoicing / AIA / billing** | `app/invoice.tsx` (2,021), `app/aia-pay-app.tsx` (1,149), `app/bill-from-estimate.tsx` | `utils/aiaBilling.ts`, `utils/invoiceBilling.ts`, `utils/invoiceReminders.ts`, `utils/stripe.ts`, `utils/stripeConnect.ts` | `aia_pay_app`, `change_orders_invoicing` — Pro | Milestone→invoice link shipped 2026-08-03 but its **migration is unapplied**, so the invoice-side double-bill guard is inert. |
| **Client portal** | `app/client-portal-setup.tsx` (1,504), `app/client-view.tsx` (1,815) | `utils/portalSnapshot.ts`, `utils/portalOwnerCore.ts`, `utils/portalLanguages.ts` | `client_portal` Pro | Reads go through token-checked RPCs only. CO e-signature shipped 2026-08-03; **migration unapplied**. **Portal photos are still broken** — `portalSnapshot.ts` bakes `photo.uri`, which on the GC's device is a local `file://`. |
| **Subcontractor mgmt** | `app/sub-portal-setup.tsx`, `app/prequal-manager.tsx`, `app/coi-vault.tsx`, `app/sub-scorecard.tsx` | `utils/subNetwork.ts`, `utils/prequalEngine.ts`, `utils/subScorecard.ts`, `utils/subOverpaymentGuard.ts` | `subcontractor_management` Business, `prequal_coi` Pro | `subcontractors` 17 and `cois` 10 are the only populated tables; sub-portal / prequal / change-request tables are all 0. `app/sub-profile.tsx` is **registered with zero inbound navigation** — a sub has no path to their own profile. |
| **Safety** | `app/safety.tsx` hub → `safety-jha`, `safety-toolbox`, `safety-incidents`, `safety-hazards`, `safety-inspections`, `safety-certifications`, `safety-osha` | `utils/safety/*`, `contexts/SafetyContext.tsx` | `safety_management` Business | Fully built, four dedicated validators, three AI edge functions. Only `certifications` (12) and `safety_inspections` (3) have any data. |
| **Field execution** | `app/daily-report.tsx` (3,165), `app/time-tracking.tsx`, `app/field-ticket.tsx` (1,585), `app/crew.tsx`, `app/photo-triage.tsx` | `utils/fieldTicketCore.ts`, `utils/photoUploadCore.ts`, `utils/photoUploadQueue.ts`, `utils/voiceDFRParser.ts`, `utils/crewScan.ts` | `photo_documentation` Pro, `crew_management` Business | Photo upload fixed 2026-08-02 (bytes reach `project-photos`; deterministic path `<uid>/<projectId>/<recordId>.<ext>`; private bucket + signed URLs at read time). T&M field tickets shipped 2026-08-03 but **`create_field_tickets.sql` is unapplied** — local storage only. |
| **Docs / RFI / plans** | `app/rfi.tsx` (1,169), `app/submittal.tsx`, `app/plans.tsx`, `app/plan-viewer.tsx` (1,235), `app/compare-drawings.tsx` | `utils/planRevisionCore.ts`, `utils/planCodeReviewer.ts` | `rfis_submittals` Business, `plan_markup` Pro | Superseded-drawing warning shipped 2026-08-02 (50 assertions, mutation-tested). **`plan_viewer` is an orphan key** — nothing reads it; `plan-viewer.tsx` deliberately gates on `plan_markup` (Pro) instead. |
| **The brain** | `app/track-record.tsx`, `app/business.tsx`, `components/brain/BrainSurface.tsx` + `BrainFab` + `BrainCard`, `components/home/*Card.tsx` | `utils/brain/` (12 modules): `predictionLedger(.Core)`, `gradingBus`, `gradePredictions`, `accuracyReport`, `autonomyGate`, `didForYou`, `leakCoDraft`, `trackRecord`, `resolveOutcomes`, `estimateSnapshot` | `brain_accuracy`, `portfolio_margin` — Business | The loop is real: predictions are written to `brain_predictions`, graded on outcome resolution, accuracy feeds `autonomyGate` thresholds, and `didForYou` + `recoveredValue` surface the receipts. **3 rows in `brain_predictions`.** The engine is complete; the evidence base is empty. |

### Flagged off, orphaned, or half-wired

**`HIRE_ENABLED = false` (`contexts/HireContext.tsx:26`)** — the whole direct-hire / messaging subsystem. The comment is candid: "Post Job is a write-only dead end, listings never surface back, and applications/messages don't reliably persist." Eight files consume the flag to hide entry points (`post-job`, `job-detail`, `worker-detail`, `messages`, `discover/hire`, `discover/index`, `DesktopSidebar`, `utils/crew/surfacing`).

**But the flag is never read inside `HireContext.tsx` itself.** It is defined at line 26 and referenced nowhere else in that file. So on every app launch, for every signed-in user, the provider still runs its react-query fetches against `job_listings`, `worker_profiles`, `conversations` and `messages`, and still opens a Supabase Realtime channel (`realtime-messages-${userId}`, line 204) whenever a conversation exists — for a subsystem no user can reach. All four tables are at 0 rows, so it currently costs four empty round-trips per launch, but the wiring is live.

**Other known-broken or stranded things** (all verified against current source):

| Thing | State |
|---|---|
| Lookahead weather | `components/schedule/LookaheadView.tsx:195` calls `getSimulatedForecast()` **unconditionally** — it never attempts a real API, and `utils/weatherService.ts:25` ignores its `_region` param. Nothing in the UI labels it simulated, and weather-driven reschedules write to `weatherDelayLog`. |
| CO → schedule reflow | `app/change-order.tsx:694` still promises "these days extend the project schedule automatically." Approval only bumps `totalDurationDays` / `criticalPathDays` / `bufferDays`. **No task's `startDay` moves; CPM is never re-run.** `AIChangeOrderImpact` already computes `affectedTasks[]` and the result is discarded. |
| `ScheduleTask.subscribers[]` | Editable in `components/schedule/TaskInspector.tsx:113-126`. **No code ever reads the list.** A GC entering a sub's phone number gets nothing. |
| `/portfolio-margin` | `REQUIRED_TIER.portfolio_margin = 'business'` (`featureTiers.ts:101`), but the only nav path is via `app/business.tsx`, gated `brain_accuracy: 'business'` — so the two agree now, but the audit's Pro-reachability complaint stands for anyone who thinks it's a Pro feature. |
| `app/closeout-binder.tsx` | No tier gate at all, despite `punch_list_closeout: 'business'`. |
| `app/last-planner.tsx` | 759 lines of real constraint log + PPC, reachable only from the Tools tab. |
| `components/ClientPaywall.tsx` | `TODO(billing)` — flipped off pending real billing wiring. |
| Signed-URL time bombs | `branding` and `documents` buckets still persist 7-day signed URLs (the trap the photo fix avoided). |
| Runtime verification | **Nobody has run the app** against the last two days of work. It is typecheck + lint + 3,147 validator assertions + reading. |

---

## 5. UI/UX — the minimalist system, and the validator that enforces it

Three token files plus one validator constitute the design system. The validator is the part that makes it stick.

### `scripts/validate-app-slop.ts` — the taste rulebook, codified

114 lines, pure `node:fs`, three checks. It exists because a generic-AI-app aesthetic kept creeping back in, and a convention nobody enforces is a convention nobody follows.

| Check | Scope | What it bans | Why |
|---|---|---|---|
| **1. No emoji-as-icons** | `app/`, `components/`, `constants/` | `/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u` — pictographic emoji, dingbats, variation selectors (line 85) | An emoji in place of an icon is the single loudest tell of an AI-generated app. The range is deliberately narrow: ASCII arrows, check marks, `×` and `•` still pass. |
| **2. No purple/pink/violet hex** | `app/`, `components/` | 13 literals: `#8B5CF6 #7C3AED #A78BFA #9333EA #A855F7 #6366F1 #6D28D9 #4F46E5 #818CF8 #EC4899 #F472B6 #C026D3 #7E22CE` (lines 94-97) | These are the Tailwind-default violet/fuchsia ramp — the palette every LLM reaches for. MAGE is amber `#FF6A1A` on warm neutrals. `constants/` is exempt so `Colors.purple` (Apple system `#5856D6`) can exist as a real semantic token. |
| **3. No `"Inter"` font token** | `app/`, `components/`, `constants/` | `/["']Inter["']/` (line 107) | Same reason. The regex is anchored to the quoted token so `Interaction`, `interface`, `Interval` pass. MAGE ships **Fraunces** (serif display) + **JetBrains Mono** (micro labels) + system sans. |

One more anti-hype rule lives in `scripts/validate-recovered-value.ts:149` — `ok('headline has no hype punctuation', !h.includes('!'))`. The house voice is: **state the number, never exclaim.** "MAGE found $4,240" — not "You saved $4,240! 🎉"

### `constants/typography.ts` — the `Type` scale

The file's own header records the audit that produced it: *23 distinct fontSize values across 5,400+ occurrences with no scale; `fontWeight: '700'` used 1,058 times and `'800'` another 378 — "body text was bold by default, which means nothing was emphasized. Boldness is currency; we'd spent it all."*

Four weights only — `400` body (≈90% of text), `500` soft emphasis, `600` headings, `700` display/CTA. Apple HIG ladder: `largeTitle` 34 → `title1` 28 → `title2` 22 → `title3` 20 → `headline`/`body` 17 → `callout` 16 → `subheadline` 18 → `subhead` 15 → `bodyCompact` 14 → `footnote` 13 → `caption1` 12 → `caption2` 11. Plus `eyebrow` (11/700/1.4 tracking/uppercase), three `serif*` display tokens (Fraunces 700), and three `mono*` micro-label tokens (JetBrains Mono, 0.14-0.18em tracking).

`bodyCompact` (14) and `subheadline` (18) were promoted to first-class tokens rather than pretended away, because 532 and 107 inline uses respectively already existed. That is the right instinct: name what the codebase actually does.

### `constants/designTokens.ts` — the `Tokens` barrel

Same origin note: *30+ borderRadius values and dozens of unique shadow recipes across 200+ files. The polished bar is 6-8 fontSizes, 2 radii per surface, and 3 shadow tiers across the whole app.*

| Token | Values |
|---|---|
| `Spacing` | 4-pt grid — `hairline` 2, `xxs` 4, `xs` 8, `sm` 12, `md` 16, `lg` 20, `xl` 24, `2xl` 32, `3xl` 40, `4xl` 56 |
| `Radius` | `xs` 6, `sm` 8, `md` 10, `card` 12, `lg` 14, `panel` 16, `xl` 18, `2xl` 24, `full` 999 |
| `continuousCorners` | `{ borderCurve: 'continuous' }` on iOS, no-op elsewhere — the squircle. Spread onto every Pressable. |
| `Shadow` | exactly three: `subtle` (resting), `medium` (pressed/hover), `heavy` (modals). Web renders the same tiers via `boxShadow`. |
| `Motion` | `micro` 120 ms, `base` 280, `page` 350, `slow` 500; ease-out for entries, ease-in for exits, **never linear**; Reanimated springs `snap` / `settled` / `heavy` |
| `TouchTarget` | `min` 44 (HIG floor), `comfortable` 48, `large` 56 |
| `IconSize` | four paired size+stroke: `micro` 12@2.2, `small` 14@2.0, `default` 18@1.8, `large` 24@2.0 |

### `constants/colors.ts` — two color systems, one of which you should use

**Use `ThemeColors` via `useTheme()`.** `Theme.light` / `Theme.dark` (lines 243-292) is the 19-token palette every migrated screen reads: `bg`, `surface`, `surfaceAlt`, `text`, `textSecondary`, `textMuted`, `line`, `accent`, `accentHot`, `accentSoft`, `accentLabel`, `success`, `successSoft`, `warningSoft`, `warningLabel`, `dangerSoft`, `dangerLabel`, `danger`, `info`.

Light is warm — `bg #FBF8F2`, `surface #FFFFFF`, `text #2B3038`. Dark is ink — `bg #0B0D10`, `surface #14181D`, `text #F4EFE6`. Accent is MAGE amber `#FF6A1A` in both. The `*Label` tokens exist purely for contrast: `warningLabel` moved `#E65100 → #B84A00` and `dangerLabel` `#C84038 → #B93A32` because at caption sizes on a soft fill the originals sat at ~3.4:1 and ~4.3:1 — under AA (lines 259-267).

**The legacy `Colors` object** (line 90) is theme-aware via getters — `get surface() { return _currentTheme === 'dark' ? '#14181D' : '#FFFFFF' }` — a retrofit so unmigrated screens reading `Colors.surface` inline stop showing white cards in dark mode. It does **not** fix `StyleSheet.create` calls that bake at module load. Don't add new consumers.

Two semantic palettes live here too: `statusFills` (Gantt bar fills — solid, not translucent, so a bar reads at any zoom; `barLabelColorFor()` picks black/white per fill brightness) and `tradeColors` (12 trades, saturation-matched for dark-mode contrast, with brand amber anchoring `general`).

### The conventions

| Convention | Where | Notes |
|---|---|---|
| **`useThemedStyles(makeStyles)`** | `hooks/useThemedStyles.ts:16` — used in **334 files** | `const styles = useThemedStyles(makeStyles)` with `const makeStyles = (t: ThemeColors) => StyleSheet.create({…})`. Memoised per resolved theme. This is *the* styling pattern. |
| **Icons** | `lucide-react-native` (340 files) + **20 bespoke `Mage*` glyphs** in `components/icons/glyphs.tsx` | `MageProject MageDiscover MageSummary MageRFI MageSubmittal MagePayApp MageChangeOrder MageTakeoff MageSchedule MageEstimate MageMargin MagePlans MageCostDb MageMaterials MageEquipment MagePunch MageInvoice MageDailyReport MageContract MageCOI`, plus `MageAIMark` — the one proprietary AI mark (A-frame + I-beam + amber spark) that replaces the Sparkles/Wand2/Zap/Bot cliché — and `MageIcon`, a wrapper that pins stroke + size. |
| **`showAlert` replaces `Alert.alert`** | `utils/alert.ts:59` — 147 files converted, 5 raw `Alert.alert` remain | react-native-web ships `class Alert { static alert() {} }` — a literal no-op. 664 call sites did nothing on web: confirmations never appeared, destructive actions silently proceeded. Native delegates to the real RN Alert unchanged; web dispatches to `<AlertHost/>`. `showPrompt` also fixes Android, where `Alert.prompt` is iOS-only. Pinned by `scripts/validate-alert-shim.ts`, which fails the build if a raw call site creeps back. |
| **`InfoBubble` for jargon** | `components/InfoBubble.tsx` + `constants/glossary.ts` | `<InfoBubble term="change_order" />` — a tappable `?` that opens a "What it is / Why it matters" modal. **Renders nothing if there's nothing to explain** (line 46). Pinned by `scripts/validate-glossary.ts` (every entry needs a non-empty `what` > 20 chars and a `why`). Only 4 files use it — under-adopted. |
| **Modal-in-screen for long screens** | `app/project-detail.tsx` (4,980 lines) is the reference | A tile grid opens section modals with a `ChevronLeft` back button, rather than one endless scroll. 17 of the 154 root routes are `presentation: 'modal'`. |
| **Self-hiding cards** | `components/home/RecoveredCard.tsx:52`, `MorningBriefCard`, `WeekCloseCard`, `ReadyToBillCard`, `brain/BrainFab` | `if (recovered.count === 0) return null;` — render nothing rather than an empty state. The comment says why: *"a card that says '$0 recovered' on day one teaches the user to ignore it forever."* |
| **Anti-hype copy** | everywhere | State the number. `formatMoney(recovered.total)` under an eyebrow reading `Found by MAGE · last 90 days`. No exclamation marks (pinned), no "Amazing!", no confetti-by-default. When there is no data, the copy says so — `app/cost-seed.tsx:247-250` tells the user a seeded rate is "you set this," never counted as a closed job, before they type anything. |

### Canonical screen — `app/cost-seed.tsx`

Header comment states the purpose and the honest limitation; tier gate before anything renders; `headerShown: false` with a hand-rolled back/eyebrow/title header; `useThemedStyles` + `Type` + `Tokens` throughout.

```tsx
export default function CostSeedScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  // Gated on job_costing (Pro) — the same key that gates its sibling screen,
  // app/cost-database. Seeding IS cost-book work; it belongs at the same price.
  if (!canAccess('job_costing')) {
    return <Paywall visible feature="Seed Your Rates" requiredTier="pro" onClose={() => router.back()} />;
  }
  return <CostSeedInner />;
}

function CostSeedInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { isDesktop } = useResponsiveLayout();
  // …
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}
          hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Cost Database · MAGE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>Seed your rates</Text>
        </View>
        <View style={styles.headerBtn} />{/* spacer keeps the title optically centred */}
      </View>
      {/* KeyboardAvoidingView → ScrollView(padding 16, paddingBottom 48 + insets.bottom) */}
```

Note the small disciplines: `hitSlop={12}` on a 22 px icon to reach the 44 pt floor; `accessibilityRole` + `accessibilityLabel` on every touchable; an empty spacer `View` rather than a magic-number offset; `isDesktop && styles.contentDesktop` for the responsive max-width.

### Canonical card — `components/home/RecoveredCard.tsx`

```tsx
export default function RecoveredCard() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { changeOrders, projects } = useProjects();

  const recovered = useMemo(() => computeRecoveredValue(projects, changeOrders,
    { windowDays: WINDOW_DAYS, nowISO: new Date().toISOString() }), [projects, changeOrders]);

  // Nothing earned yet → render nothing. See the header note.
  if (recovered.count === 0) return null;

  return (
    <View style={styles.card} testID="recovered-card">
      <View style={styles.header}>
        <MageAIMark size={15} color={colors.accent} />
        <Text style={styles.eyebrow}>Found by MAGE · last 90 days</Text>
      </View>
      <View style={styles.moneyRow}>
        <TrendingUp size={20} color={colors.success} strokeWidth={2.25} />
        <Text style={styles.money}>{formatMoney(recovered.total)}</Text>
      </View>
      <Text style={styles.sub}>
        billed from {recovered.count} change order{recovered.count === 1 ? '' : 's'} MAGE drafted off
        your job-site notes — approved and signed by your client.
      </Text>
      {/* …up to 3 rows, then "+N more" */}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: t.surface,
    borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.panel,       // 16
    padding: Tokens.spacing.md,              // 16
    marginBottom: Tokens.spacing.md,
  },
  eyebrow: { ...Type.caption1, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.9 },
  money:   { ...Type.title1, color: t.text },
  sub:     { ...Type.footnote, color: t.textSecondary, marginTop: 4, lineHeight: 19 },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9,
             borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line },
});
```

Everything the system asks for, in 140 lines: one border + one radius token, no shadow (it's a resting card), hairline separators, `Type` spread rather than inline `fontSize`, semantic color only, a proprietary mark instead of a Sparkles emoji, a rolling 90-day window (*"a lifetime total only ever grows, which makes it noise"*), and a hard `return null` when there is nothing true to say.

---

## Appendix — the honest ledger

**Where the code and the docs disagree.** These were found while writing this and are corrected above, not written around:

1. `CLAUDE.md` says "**Local/UI: zustand stores**." There are none. The dependency is installed and unused.
2. The provider stack in `CLAUDE.md` lists 8 providers. There are **16**, and `ThemeProvider`, `ScanProvider`, `WipProvider`, `CrewProvider`, `SafetyProvider`, `PropertyProvider`, `MaterialCartProvider` and `SearchProvider` are missing from it.
3. "103 tables" → **101**. "61 edge functions" → **60** + `_shared`.
4. `invoice-dunning` is not *undeployed* — v4 is live. The **current source** is undeployed, which is worse in one specific way: the deployed version predates the ownership check at `index.ts:486`.
5. Two edge functions run in production with **no source in this repo**: `sync-bids`, `fetch-material-price`.
6. **128 migrations are applied in production; `supabase/migrations/` holds 84 files.** The directory is not a replayable history of the database. Anyone reasoning about schema from the repo alone will be reasoning about a subset.

**The three things that would most improve this architecture, in order** (unchanged from the 2026-08-02 audit, none yet done):

1. **Extend collaborator RLS to sub-tables** — one reviewed migration per table with a verification query each. Multi-user is advertised and currently inoperable beyond the schedule.
2. **Persist cost seeds to Postgres and wire the remaining 11 of 16 cost-book consumers.** The moat's input data currently lives in AsyncStorage and does not survive a reinstall.
3. **Stop writing fiction.** Label or suppress the simulated weather before it reaches `weatherDelayLog`, and either implement the CO→schedule reflow or delete the sentence at `change-order.tsx:694` that promises it.
