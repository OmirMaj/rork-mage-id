# Code health, dependencies, configuration hygiene, test posture — final-push audit — 2026-09-03

## Scope covered (files/paths actually read; commands run)

Read in full: `CLAUDE.md`, `docs/START-HERE.md` (banner + gotchas), `package.json`, `.gitignore`, `tsconfig.json`,
`eslint.config.js`, `babel.config.js`, `metro.config.js`, `jest.config.js`, `eas.json`, `app.json`, `netlify.toml`,
`DEPLOY-NOW.sql` (header, §20260826150000, §20260826180000, §20260829120000), `DEPLOY-RUNBOOK.md`,
`DEPLOY-VERIFIED-2026-09-02.md`, `REPAIR-HISTORY.sh`, `Untitled.base`, `Untitled.canvas`, `.verb.md`, `LAUNCH.md` (head),
`lib/supabase.ts`, `backend/hono.ts`, `backend/routes/send-email.ts`, `utils/subOverpaymentGuard.ts`,
`utils/formatters.ts:40-62`, `scripts/validate-sub-overpayment.ts` (header), `scripts/validate-guard-coverage.ts` (header),
`scripts/validate-formatters.ts` (header), all 14 `__tests__/smoke/*.test.ts*` headers, `.claude/launch.json`,
`.claude/settings.json`, on-disk `ios/MAGEID/Info.plist`, `ios/MAGEID/MAGEID.entitlements`, `ios/MAGEID.xcodeproj/project.pbxproj`
(version keys), `.env` / `.env.local` (key NAMES and value lengths only). Targeted line ranges in
`contexts/SubscriptionContext.tsx`, `contexts/AuthContext.tsx`, `utils/offlineQueue.ts`, `app/change-order.tsx`,
`app/sub-portal-setup.tsx`, `app/client-view.tsx`, `app/invoice.tsx`, `app/win-optimizer.tsx`, `app/smart-proposal.tsx`,
`utils/proposalBuilder.ts`, `utils/contractEngine.ts`, `utils/lienWaiverEngine.ts`, `utils/selectionsEngine.ts`,
`utils/closeoutBinderEngine.ts`, `utils/bidQuestionsEngine.ts`, `hooks/useCostSeeds.ts`, `hooks/useCostBenchmark.ts`,
`supabase/functions/create-payment-link/index.ts:255-292`, `supabase/functions/_shared/qbo-mapping/financials.ts`,
`supabase/migrations/20260826150000_history_audit_reconciliation.sql:54`, `20260826180000_portal_link_expiry_cron.sql`.

Commands run (all read-only; tool runs against scratchpad copies of the lockfiles): `git ls-files` counts,
`git ls-files --error-unmatch` per root file, `git log` on the deploy files, `git rev-list --count origin/main..HEAD` (113),
`npm audit --omit=dev --json` (against `package-lock.json`), `bun audit` (against `bun.lock`), `npx expo-doctor`,
`npx expo install --check`, `npx knip --no-progress --reporter compact`, `npx tsc --noEmit`, `bun run lint`,
`npx jest --config jest.config.js --ci --silent`, scratchpad scripts for dependency import counts, importer verification,
catch-block classification, executing-test coverage per module; `/usr/bin/grep` inventories. Production, SELECT-only via
Supabase MCP `execute_sql`: `cron.job`, `information_schema.columns`, `pg_indexes`, `pg_constraint`,
`supabase_migrations.schema_migrations`; `list_edge_functions` for deployed slugs + `verify_jwt`. Web: Expo SDK 54 `expo-av`
page, Expo "Using Bun" + iOS build-process pages, Supabase CLI config reference (`functions.<name>.verify_jwt`).

Verification results (claims in the docs, re-run today): `tsc` 0 errors; `expo lint` 0 errors / **2,931 warnings**;
jest **465/465 passed in 14 suites**, 187 routes discovered; `expo install --check` "Dependencies are up to date";
`expo-doctor` **16/18 — fails "Check for lock file" and "duplicate native module (expo-constants)"**; 205 validators on disk,
205 referenced by a `test:*` script, 209 unique `ship-check` steps, 0 dark guards.

---

## Findings (ranked; most severe first)

### F1 — [P1] [CONFIRMED] Both documented deploy paths apply two of the three "deliberately held back" changes — the portal-link-expiry cron (against an undeployed function) and `cost_seeds.deleted_at` (do-not-touch)
- Where: `DEPLOY-NOW.sql:625` and `:637` (`cron.schedule('portal-link-expiry-notice-am' …)` / `-pm`), `DEPLOY-NOW.sql:441`
  (`alter table public.cost_seeds add column if not exists deleted_at timestamptz;`), `DEPLOY-RUNBOOK.md:43-45`
  ("## 2 · Apply the 10 migrations … Paste `DEPLOY-NOW.sql` into the Supabase SQL editor and run it"), `DEPLOY-RUNBOOK.md:56`
  (verify query expects `cost_seed_fix` = true), `DEPLOY-VERIFIED-2026-09-02.md:170-172`
  (`mv …drop_legacy.sql /tmp/ && supabase db push`), `supabase/migrations/20260826180000_portal_link_expiry_cron.sql`
  (3× `cron.schedule`), `supabase/migrations/20260826150000_history_audit_reconciliation.sql:54` (the same `alter table cost_seeds`).
- Evidence: `DEPLOY-NOW.sql:1-11` — "paste-ready deploy, regenerated 2026-08-29 … 12 migrations … EXCLUDED: ..._drop_legacy.sql"
  — it excludes phase 2 only. Production today (SELECT): `cron.job` has 8 jobs and **no** `portal-link-expiry-notice-*`;
  `cost_seeds.deleted_at` = **false**; `private.cron_auth` = **true** (so the jobs would fire with a valid secret);
  `portal-link-expiry-notice` is the one repo function **not** deployed (`list_edge_functions`). Tracker: **none of the 17 local
  migrations ≥ `20260826120000` is registered** (they were applied under MCP-generated versions `20260902184034…20260903205215`),
  so `supabase db push` replays all of them — idempotent for the rest, but it executes the cron file and line 54 of `20260826150000`.
  `DEPLOY-RUNBOOK.md:17` still says "10 migrations"; the SQL header says 12; the runbook's own step 3 deploys
  `portal-link-expiry-notice` but its step 2 schedules the cron first.
- Failure scenario: founder follows either runbook → two pg_cron jobs POST twice daily to a 404 (or, after F2, a 401) forever with
  nothing surfaced; `cost_seeds` gains a column under a standing do-not-touch instruction (and the queued cost-seed deletes drain —
  a behaviour change nobody signed off).
- Fix: delete `DEPLOY-NOW.sql` and `DEPLOY-RUNBOOK.md` (superseded — `DEPLOY-VERIFIED` is the runbook) or stamp both
  `SUPERSEDED 2026-09-02` and strip §20260826180000 + line 441; move `20260826180000_portal_link_expiry_cron.sql` out with
  phase 2 in `DEPLOY-VERIFIED` §2 and split line 54 out of `20260826150000` into its own held file; run
  `supabase migration repair --status applied` for the 16 already-applied versions so `db push` stops replaying them.
- Effort: S

### F2 — [P1] [CONFIRMED] The runbook's edge-function redeploy command turns JWT verification back ON for four public functions (Stripe webhook included) and deploys the cron target so its cron calls are rejected
- Where: `DEPLOY-VERIFIED-2026-09-02.md:217-219` (`supabase functions deploy construction-answer mcp qbo-sync qbo-reconciler
  project-invite portal-link-expiry-notice notify seal-document stripe-webhook import-schedule award-rfp --project-ref …`),
  `DEPLOY-RUNBOOK.md:72` (same shape); **no `supabase/config.toml` exists in the repo**; `docs/security/tier-authority-fix.md:67`
  (`supabase functions deploy revenuecat-webhook --no-verify-jwt` — the team already uses the flag elsewhere).
- Evidence: `list_edge_functions` today: `stripe-webhook`, `notify`, `seal-document`, `mcp` are ACTIVE with `verify_jwt: false`
  (22 of 63 deployed functions are `false`). Supabase config reference, `functions.<name>.verify_jwt`: default **`true`** —
  "By default, when you deploy your Edge Functions or serve them locally, it will reject requests without a valid JWT in the
  Authorization header. Setting this configuration changes the default behavior." Neither command passes `--no-verify-jwt`, and
  with no `config.toml` there is nothing to change the default. `20260826180000_portal_link_expiry_cron.sql` posts with
  `x-cron-secret` only (no JWT).
- Failure scenario: after step 4, Stripe's webhook POST (no Supabase JWT) is rejected at the gateway → payment-link payments never
  flip invoices to paid; `notify` fan-out and portal `seal-document` return 401; `portal-link-expiry-notice` is deployed with
  `verify_jwt=true`, so when the cron is finally scheduled it fails twice daily — the exact "silent stream of failing runs" the
  banner warns about, now with the function deployed. All of it silent (`net.http_post` result is not checked).
- Fix: add `supabase/config.toml` with `[functions.<slug>] verify_jwt = false` for the 22 public slugs (fetch-external-data,
  stripe-webhook, notify, notify-nearby-contractors, unsubscribe, daily-digest, geocode-bids, auth-magic-link,
  homeowner-weekly-digest, coi-expiry-watch, schedule-ical, financing-redirect, financing-callback, seal-document,
  qbo-connect-callback, portal-mark-viewed, mcp-token, mcp, revenuecat-webhook, public-lead-intake, public-cost-index,
  widget-estimate) plus `portal-link-expiry-notice`; add a validator that fails if any function reading `x-cron-secret`,
  `stripe-signature`, or a portal token lacks that entry; amend both runbook commands.
- Effort: S

### F3 — [P2] [CONFIRMED] Two lockfiles; `package-lock.json` is a 4½-month-old snapshot of a different dependency tree, `expo-doctor` fails on it, and EAS's precedence between them is undocumented
- Where: `package-lock.json` (tracked, mtime 2026-04-16, 547 KB, contains `@hono/trpc-server` ×3 and `@trpc/*`), `bun.lock`
  (tracked, 2026-08-22), `package.json` (2026-09-02), `netlify.toml:13` (explicit `bun install`).
- Evidence: `expo-doctor`: "✖ Check for lock file — Multiple lock files detected (package-lock.json, bun.lock). This may result in
  unexpected behavior in CI environments, such as EAS Build, which infer the package manager from the lock file." Expo's Bun guide:
  "Make sure to delete any lockfiles generated by other package managers." The iOS build-process page only states
  "Run `npm install` … (or `yarn install` if yarn.lock exists)" — no bun/npm tie-break is published.
  `npm audit --omit=dev` against the stale lock: 38 vulnerabilities (2 critical, 17 high) — for packages the app no longer has.
  `bun audit` against `bun.lock` (the real tree): 81 (2 critical, 39 high, 35 moderate, 5 low); every critical/high is
  build-time transitive (`tar@7.5.13`, `shell-quote@1.8.3`, `undici@6.25.0`, `@xmldom/xmldom@0.8.12`, `js-yaml`, `brace-expansion`,
  `postcss`, `browserslist`, `ws`) except two that reach the runtime bundle: `hono@4.12.14` (direct, 21 advisories incl. HIGH
  GHSA-88fw-hqm2-52qc "CORS Middleware reflects any Origin with credentials" — the unmounted `backend/hono.ts:8` uses exactly
  `app.use("*", cors())`; see F6) and `nanoid@3.3.11` via `@react-navigation/core` (3 HIGH advisories require attacker-controlled
  `size` args — not reachable from app input). `node_modules` additionally holds **40 top-level packages absent from `bun.lock`**
  (`@trpc/*`, `@hono/trpc-server`, `ai`, `@anthropic-ai/sdk`, `react-native-maps`, `posthog-react-native`, …; 0 source imports) and
  a duplicate `expo-constants@18.0.14` under `expo-asset/node_modules` (the second `expo-doctor` failure).
- Failure scenario: an EAS or CI machine that resolves the npm lock installs April's tree (Expo-53-era `@expo/cli`, tRPC packages),
  and the build either fails or ships a bundle no one has tested; a teammate running `npm install` locally "fixes" it by
  regenerating the wrong lock.
- Fix: `git rm package-lock.json`; `rm -rf node_modules && bun install --frozen-lockfile`; `bun update` for the transitive
  advisories; drop `hono` (F6). Add `package-lock.json` to `.gitignore`.
- Effort: S

### F4 — [P2] [CONFIRMED] `expo-av` is deprecated in SDK 54 and removed in SDK 55; voice capture depends on it
- Where: `components/VoiceCaptureModal.tsx:120,134,140,144,213` (`Audio.setAudioModeAsync`, `Audio.requestPermissionsAsync`,
  `new Audio.Recording()`); `package.json` `"expo-av": "~16.0.8"`; `expo-audio` / `expo-video` not installed.
- Evidence: Expo SDK 54 docs — "The `Video` and `Audio` APIs from `expo-av` have now been deprecated and replaced by improved
  versions in `expo-video` and `expo-audio`. … `expo-av` is not receiving patches and will be removed in SDK 55."
- Failure scenario: the next SDK bump (a native rebuild is already pending for the scheme rename) removes the module; the Copilot
  voice entry — the flagship — stops compiling, and any audio-session bug found before then gets no upstream fix.
- Fix: migrate the one file to `expo-audio` (`useAudioRecorder` / `setAudioModeAsync` / `requestRecordingPermissionsAsync`),
  remove `expo-av`. Single-file change; `transcribe-audio` contract unchanged.
- Effort: M

### F5 — [P2] [LIKELY] Money is formatted by 60 separate helpers; five of the app-side copies drop the sign, and a credit change order renders without its minus
- Where: `app/change-order.tsx:1225` (`function formatCurrency(n) { return '$' + Math.abs(n).toLocaleString(…) }`), used at
  `:620` (`{changeAmount >= 0 ? '+' : ''}{formatCurrency(changeAmount)}`), `:628`, `:634`, and `:1211`
  (`moneyLine={\`Commits ${formatCurrency(reflowPreviewCO.changeAmount)} to the contract.\`}`); the same `Math.abs` copy in
  `app/invoice.tsx:83`, `app/retention.tsx:26`, `app/budget-dashboard.tsx:38`, `app/payment-predictions.tsx:27`. Canonical,
  sign-correct: `utils/formatters.ts:43 formatMoney` (`return num < 0 ? '-' + formatted : formatted`).
- Evidence: 60 definitions named `money|formatCurrency|formatMoney|fmtMoney` across `app/ components/ utils/ hooks/` (list in
  appendix); 33 date-formatter definitions; `markupToPercent` is byte-identical in `app/win-optimizer.tsx:54` and
  `app/smart-proposal.tsx:59` while `utils/proposalBuilder.ts:158 normalizeMarkup` normalises the other way (fraction, not
  percent). `changeAmount` is `lineItems.reduce((sum, item) => sum + item.total, 0)` (`:220`) and prices come from
  `parseFloat(newItemPrice) || 0` (`:268`), so a negative price makes a negative CO; credit COs are a recognised case
  (`app/change-order.tsx:233` "Sign-aware for credit COs", `utils/recoveredValue.ts:145`).
- Failure scenario: a −$5,000 credit CO shows "$5,000" (no sign, no "+") beside a +$5,000 one, and its schedule-reflow preview
  says "Commits $5,000 to the contract." — the homeowner-facing number is the wrong direction.
- Unverified link: the iOS `keyboardType="numeric"` pad has no minus key; the confirmed entry paths for a negative price are web,
  Android, and paste. Not traced: whether an estimate-linked removal can produce a negative `item.total` on iOS without typing.
- Fix: replace the five `Math.abs` copies with `formatMoney`/`formatMoney(n, 2)`; add an ESLint `no-restricted-syntax` selector
  `FunctionDeclaration[id.name=/^(money|formatCurrency|fmtMoney|formatMoney)$/]` outside `utils/formatters.ts` so the count can only
  go down.
- Effort: S (fix) / M (consolidation)

### F6 — [P2] [CONFIRMED] Dead code: 20 files (3,289 lines) with zero importers, including a second sub-overpayment guard and an unmounted Hono backend that keeps a vulnerable direct dependency alive
- Where: `utils/subOverpaymentGuard.ts` (0 importers; exports `checkSubInvoiceOverpayment`, `buildOverpaymentMessage`);
  `backend/hono.ts` + `backend/routes/send-email.ts` (0 importers; only consumers of `hono`); `components/AICopilot.tsx`
  (+ its sole dependent `components/MageCraneBuild.tsx`), `components/CashFlowAlerts.tsx`, `components/CashFlowGlance.tsx`,
  `components/IconButton.tsx`, `components/MageBootScreen.tsx`, `components/MageBuildScene.tsx`, `components/PipelineHeroChart.tsx`,
  `components/animations/SawCutReveal.tsx`, `components/schedule/SwipeableTaskCard.tsx`, `components/ui/Input.tsx`,
  `hooks/useDocumentTitle.ts`, `utils/estimateAssemblies.ts`, `utils/scheduleLoeEngine.ts`, `utils/useWebEnhancements.ts`,
  `mocks/jobs.ts`, `mocks/timeTracking.ts`, `mocks/workers.ts`. Zero-import dependencies: `zustand`, `@stardazed/streams-text-encoding`,
  `@ungap/structured-clone` (also a transitive dep of `expo`, so harmless but redundant), `hono`.
- Evidence: knip "Unused files (124)" filtered by a scratchpad importer scan over `app components utils contexts hooks lib constants
  types plugins mocks backend scripts __tests__ app.json` — the 20 above have 0 importers anywhere (knip's `supabase/functions/*`
  and `plugins/*` hits are Deno entry points / `app.json` plugins — false positives; `components/StatusPill.tsx` has 9 importers —
  false positive). `scripts/validate-sub-overpayment.ts:33-36` tests the *shipped* guard by extracting
  `app/sub-portal-setup.tsx` between sentinels; the `utils/` guard is a diverging duplicate (client-side sum vs. server rollup).
  knip also reports 158 unused exports (e.g. `utils/projectFinancials.ts: getPaidToDate, getInvoicedToDate, summarizeProjectFinancials`,
  `utils/offlineQueue.ts: addToOfflineQueue`, `lib/supabase.ts: supabaseGuard`, `contexts/SubscriptionContext.tsx: useSubscriptionGate`,
  `utils/aiaBilling.ts: buildAIAPayAppHtml`) and 27 duplicate `named + default` exports. `react-native-worklets@0.5.1` is
  **not** dead: it is the required peer (`0.5 - 0.8`) of the transitive `react-native-reanimated@4.1.7` that `expo-router` pulls —
  keep it pinned (build #12 crashed on exactly this pairing).
- Failure scenario: the next engineer finds `utils/subOverpaymentGuard.ts`, wires it, and reintroduces the client-side-sum semantics
  the validator was written to retire; `hono` keeps surfacing in every audit as a HIGH.
- Fix: one commit — `git rm` the 20 files and `backend/`; `bun remove hono zustand @stardazed/streams-text-encoding @ungap/structured-clone`;
  add `npx knip` (with `supabase/functions/**` and `plugins/**` as entry points) to `ship-check` as a warning step.
- Effort: S

### F7 — [P2] [CONFIRMED] Edge-function drift: two production functions have no source in git, and several were deployed from a different working tree
- Where: production `list_edge_functions`: `sync-bids` (v23, `verify_jwt: true`) and `fetch-material-price` (v21) are ACTIVE; the
  repo has 62 function dirs and neither exists; 0 references to either slug in `app/ components/ utils/ contexts/ hooks/`.
  Entrypoints `source/index.ts` (not `source/supabase/functions/<name>/index.ts`) for `schedule-ical`, `schedule-ical-url`,
  `portal-mark-viewed`, `transcribe-audio`; `construction-answer` deployed from `source/functions/…`.
- Evidence: scratchpad diff of the 63 deployed slugs vs `supabase/functions/*/` — deployed-only: `fetch-material-price`,
  `sync-bids`; repo-only: `portal-link-expiry-notice`.
- Failure scenario: a project restore or an accidental delete loses two functions nobody can rebuild; a `supabase functions deploy`
  from the wrong cwd silently ships a different bundle than the one the guards checked (`validate-edge-typecheck` reads the repo).
- Fix: `supabase functions download sync-bids fetch-material-price` **into a scratchpad**, decide keep-or-delete, commit or delete;
  add a `validate-edge-inventory` guard that compares `supabase functions list --project-ref …` to the directory (allow-list the
  intentional gap).
- Effort: S

### F8 — [P2] [LIKELY] Build-path env drift: laptop-exported OTAs inline a live OpenWeather key that EAS-built binaries and the docs say does not exist; 6 of the 10 `EXPO_PUBLIC_*` vars the code reads are absent from `eas.json`
- Where: `.env` (gitignored) keys: `EXPO_PUBLIC_REVENUECAT_{IOS,TEST,ANDROID,WEB}_API_KEY`, **`EXPO_PUBLIC_OPENWEATHER_API_KEY`
  (32-char value)**; `eas.json:9-14,23-27` (RevenueCat keys only); code reads `EXPO_PUBLIC_SUPABASE_URL` ×6,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` ×4, `EXPO_PUBLIC_OPENWEATHER_API_KEY` (`utils/weatherService.ts:183`), `EXPO_PUBLIC_POSTHOG_KEY/HOST`
  (`utils/posthog.ts:20-21`), `EXPO_PUBLIC_PROJECT_ID` (`utils/notifications.ts:56`).
- Evidence: `expo-doctor`'s own run printed "env: load .env.local .env / env: export EXPO_PUBLIC_OPENWEATHER_API_KEY …" —
  `expo export` (what `eas update` runs) inlines these at bundle time (`CLAUDE.md` "inlined into the bundle by Metro at build time").
  The brief and `START-HERE` record "no OpenWeather key (simulated weather is labeled…)". The Supabase anon JWT is hardcoded as a
  fallback in **four** files (`lib/supabase.ts:16-17`, `app/sub-portal-setup.tsx:40-43`, `app/client-portal-setup.tsx:66-67`,
  `app/project-detail.tsx:105-106`) despite `lib/supabase.ts:8-10` "Other modules MUST import SUPABASE_URL / SUPABASE_ANON_KEY
  from here rather than reading process.env directly"; `.env` has no Supabase vars at all, so every build relies on the fallbacks.
- Failure scenario: an OTA published from this Mac shows live forecasts and writes real `weatherDelayLog` rows; the same runtime
  version built on EAS (or an OTA from any other machine) shows "SIMULATED WEATHER" and refuses the delay log — two behaviours for
  one `runtimeVersion`, and the recorded decision is true of only one of them. The OpenWeather key ships in the public bundle
  (known caveat, now confirmed to be live in laptop exports). Unverified link: whether the last production OTA was exported with
  this `.env` present (the file is dated 2026-08-04, before the recent OTAs).
- Fix: put every `EXPO_PUBLIC_*` the code reads into `eas.json` env (or EAS secrets) — explicitly empty where the decision is
  "off" — so all build paths agree; collapse the four anon-key copies to one import; add a 20-line guard that lists
  `process.env.EXPO_PUBLIC_*` reads vs `eas.json` keys.
- Effort: S

### F9 — [P2] [CONFIRMED] Offline-first is not true for five document engines — 24 direct writes bypass `supabaseWrite` and return `null` offline
- Where: `utils/contractEngine.ts:297` (upsert), `:372` (update `payment_schedule`), `utils/lienWaiverEngine.ts:108` (upsert),
  `utils/selectionsEngine.ts:159,201,220,230`, `utils/closeoutBinderEngine.ts:120`, `utils/bidQuestionsEngine.ts:68,116`;
  plus `hooks/useCostBenchmark.ts:70` (`void supabase.from('cost_benchmark_samples').upsert(...)` inside a `try` that cannot catch a
  promise rejection) and the token-based portal paths (`hooks/usePortalThread.ts:151`, `app/client-view.tsx:741` — legitimately
  anon, no queue possible).
- Evidence: 176 `supabaseWrite(` call sites vs 24 direct `.from(...).insert/upsert/update/delete(` sites (multi-line form) + 12
  single-line. The engine sites do consume `error` (`if (error || !data) { console.warn(...); return null; }`) — so this is not a
  swallowed error, it is an online-only write path under a `CLAUDE.md` rule that says "All Supabase writes go through
  `utils/offlineQueue.ts` … always go through the queue".
- Failure scenario: on a jobsite without signal, "mark milestone invoiced" (`markMilestoneInvoiced` → `'failed'`), a lien-waiver
  save, or a selection choice returns `null`; whether the user sees anything depends on each caller (`app/invoice.tsx:392-406` does
  show "Milestone not marked as billed"; the selections and lien-waiver callers were not traced).
- Fix: route the 24 sites through `supabaseWrite` (they are plain row upserts), or annotate the five engines `ONLINE_ONLY` and add
  a validator that whitelists exactly them so new direct writes fail the build.
- Effort: M

### F10 — [P2] [CONFIRMED] The offline queue's own enqueue failure drops the write with a `console.log`
- Where: `utils/offlineQueue.ts:103-124` — `addToOfflineQueue`: `await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue))`
  inside `try { … } catch (err) { console.log('[OfflineQueue] Failed to queue mutation:', err); }`.
- Evidence: four lines earlier the cap-exceeded path calls `notifyDroppedWrites(...)` (toast + Sentry); the enqueue-failure path
  calls neither and does not rethrow, so `supabaseWrite`'s optimistic local mutation stands with nothing queued. On web
  `AsyncStorage` is `window.localStorage` (quota ~5 MB; `MAX_QUEUE` entries with photo payloads can exceed it).
- Failure scenario: the user sees the edit applied locally; it never reaches the server and nobody is told — the exact
  "silent success" class the brief names.
- Fix: in the catch, `notifyDroppedWrites(1, [mutation.table], 'enqueue failed')` and rethrow so `supabaseWrite` can surface it.
- Effort: S

### F11 — [P2] [CONFIRMED] Test posture: the sync engine, dunning, AIA billing and the tenant wipe have zero executing tests; 37 guards are regex-on-source
- Where: `scripts/validate-*.ts` (205 files: **168 import real code, 37 only `readFileSync` the source, 4 use sentinel extraction**);
  `__tests__/` (465 tests, 14 suites) imports exactly **8** `@/utils|hooks|contexts` modules
  (`automation/inspectionResultToScheduleWork`, `automation/roadmapToScheduleWork`, `costSeedCore`, `safety/pruneDeletedProject`,
  `scheduleEngine`, `workflowPipelines`, `MaterialCartContext`, `ThemeContext`).
- Evidence: executing importers per module — `offlineQueue` **0**, `aiaBilling` **0**, `billingFlowCore` **0** (the dunning stage
  logic behind the live "FINAL NOTICE on retention" harm), `projectFinancials` **0**, `localCacheKeys` **0** (tenant boundary),
  `contractEngine`/`lienWaiverEngine`/`selectionsEngine` **0**, `aiRateLimiter` **0**, `owner` **0**, `subOverpaymentGuard` **0**,
  `varianceDecomposition` **0**; `jobCostEngine` 2, `invoiceBilling` 1, `calendarDate` 2, `featureTiers` 6, `cpm` 8.
  Text-only guards for exactly the bug classes that reached production: `validate-offline-group-abort`, `validate-co-approval-sync`,
  `validate-storage-hygiene`, `validate-rls-write-leaks`, `validate-paywall-tiers`, `validate-project-financials-split`,
  `validate-outbox-contract`, `validate-sub-overpayment` (sentinel). A regex guard passes when the code is renamed around it —
  the "guard that names files goes blind" class `START-HERE` already documents.
- Failure scenario: a refactor of `supabaseWrite`'s transient/terminal classification (`:293-311`, `:452`) can flip PGRST205 to
  terminal and every offline write is discarded on reconnect; no test executes that branch.
- Fix: the ten tests below (each names the pure function and the assertion).
- Effort: M

### F12 — [P3] [CONFIRMED] Type-escape and lint debt, with hotspots
- Where/Evidence (source dirs `app components utils contexts hooks lib constants types backend supabase/functions plugins`):
  `as any` **352** (`app/project-detail.tsx` 60, `components/schedule/InteractiveGantt.tsx` 19, `app/(tabs)/settings/index.tsx` 17,
  `app/(tabs)/schedule/index.tsx` 12, `app/bid-detail.tsx` 10); `: any` **124** (InteractiveGantt 15, `utils/mageAI.ts` 11,
  `GridPane.tsx` 9, `app/closeout-binder.tsx` 9, `supabase/functions/construction-answer/index.ts` 7); `as unknown as` **88**
  (`utils/demoSeed.ts` 15, `utils/brain/trackRecord.ts` 7, `utils/brain/resolveOutcomes.ts` 7); `@ts-ignore` **3**
  (`app/plans.tsx:28`, `app/_layout.tsx:1330,1332`), `@ts-expect-error` **2**, `@ts-nocheck` 0; `eslint-disable` **51**
  (30 `react-hooks/exhaustive-deps`, 17 `no-require-imports`, 2 `no-explicit-any`); TODO/FIXME **3** (`app/oac-meeting.tsx:208`,
  `components/ClientPaywall.tsx:77`, `supabase/functions/stripe-webhook/index.ts:583` "notify the contractor that a client tried
  but failed"). `expo lint`: 0 errors, **2,931 warnings** — 2,273 `no-restricted-syntax` (design-token literals), 342
  `no-unused-vars` (`settings/index.tsx` 27, `components/Tutorial.tsx` 19), 118 `no-console`, 99 `exhaustive-deps`
  (`app/(tabs)/estimate/full.tsx` 16, `weekly-snapshot.tsx` 7, `schedule/index.tsx` 7), 68 `import/first` (`app/(tabs)/(home)/index.tsx` 23),
  16 `import/no-duplicates`. `console.log` **477** (421 app-side, 53 in edge functions; `app/_layout.tsx` 12,
  `discover/companies.tsx` 10). Empty `catch {}` **189** (20 on money/sync/auth paths — all inspected; benign: toast/Sentry/
  localStorage/brain-ledger "G4" writes), log-only catches **146** (40 sensitive; the consequential one is F10).
  PII in logs: `Sentry.init` has `sendDefaultPii: false`, `enableLogs: false` (`app/_layout.tsx:151,158`); the only field-level
  print is a business phone at `app/(tabs)/discover/companies.tsx:80`; `validate-auth-log-pii` guards the auth path.
- Fix: raise `no-unused-vars` to error (342 → 0 is mechanical), keep the token rule as warning, and ban new `as any` in
  `utils/` via `no-explicit-any: error` scoped to `utils/**` (11 hits today).
- Effort: M

### F13 — [P3] [CONFIRMED] 15 files over 2,000 lines (33 more between 1,000 and 2,000) — the three largest have ready seams
- Where: `app/(tabs)/estimate/full.tsx` 5,984 · `contexts/ProjectContext.tsx` 5,697 · `app/project-detail.tsx` 5,170 ·
  `types/index.ts` 4,851 · `app/(tabs)/schedule/index.tsx` 3,988 · `app/daily-report.tsx` 3,326 ·
  `components/schedule/InteractiveGantt.tsx` 3,059 · `app/schedule-wizard.tsx` 2,792 · `app/(tabs)/settings/index.tsx` 2,710 ·
  `app/(tabs)/construction-ai/index.tsx` 2,644 · `app/takeoff.tsx` 2,374 · `app/schedule-pro.tsx` 2,360 ·
  `components/schedule/GridPane.tsx` 2,217 · `app/invoice.tsx` 2,129 · `app/client-view.tsx` 2,095.
- Seams: `project-detail.tsx` already gates every section on `activeTile === '<key>'` (the smoke suite addresses sections by
  `?tile=`), so each block lifts to `components/project-detail/<Section>.tsx` with the same `SectionKey`; `ProjectContext.tsx`
  is one provider over ~12 sub-collections that each already have a `hooks/use*` twin — split the reducers per collection and
  keep the context as composition; `estimate/full.tsx` has the `EstimateDivisionTable`/`EstimateTotalsBar`/… components extracted
  already — the remaining 5,984 lines are the modal bodies (`showSaveModal`, review, share), each a natural file.
- Effort: L (do it one file per PR, behind the route smoke test)

### F14 — [P3] [CONFIRMED] Root junk and tracked strays
- Where (all tracked): `Untitled.base` (39 bytes, Obsidian), `Untitled.canvas` (`{}`), `.verb.md` (0 bytes),
  `MAGE_ID_3-Year_Business_Projection.docx` + `.xlsx` (business docs in the source root), `LAUNCH.md` (2026-04-28, superseded by
  `LAUNCH-CHECKLIST.md`), `expo-env.d.ts` (tracked although `.gitignore:41` lists it), `android/drawable-xxxhdpi/ic_launcher_foreground.png`
  (the only tracked file under the ignored `android/`), `REPAIR-HISTORY.sh` (marks 60 pre-08-05 versions applied; the 17 later
  local versions are still unregistered — see F1 — so it no longer makes `db push` safe by itself). `ios/` and `dist/` are **not**
  tracked (0 files) — no Info.plist drift risk via git; the on-disk `ios/MAGEID/Info.plist` matches `app.json` on bundle id,
  version 1.0.0, all six usage strings, `ITSAppUsesNonExemptEncryption=false`, and carries the `mageid` + `com.mageid.app` +
  Google URL schemes; its entitlements file has `aps-environment: development` (local-build only; EAS remote credentials own release).
- Fix: `git rm` the six junk files; `git rm --cached` the two strays; extend `REPAIR-HISTORY.sh` per F1.
- Effort: S

### F15 — [P3] [CONFIRMED] Seven edge functions hand-decode the JWT payload while `_shared/verifyUser.ts` exists
- Where: `supabase/functions/{project-invite,connect-onboarding,schedule-ical-url,create-payment-link,connect-status,send-email,create-rfp-checkout}/index.ts`
  (`JSON.parse(atob(b64))` on `parts[1]`, e.g. `create-payment-link/index.ts:272-279`); 7 functions import `_shared/verifyUser`,
  32 import `_shared/auth`.
- Evidence: all seven are deployed with `verify_jwt: true`, so the gateway checks the signature first (defence-in-depth gap, not an
  open hole — the same class `DEPLOY-VERIFIED` recorded for `award-rfp`). Filed here as a duplicate-implementation finding; the
  security auditor owns the exposure call.
- Fix: replace the 7 decoders with `verifyUser(req)`; add the pattern `atob(` + `parts[1]` to `validate-edge-security`.
- Effort: S

---

## ADD / CONNECT / DO BETTER (ranked by leverage)

### O1 — Config-as-code for edge-function auth — leverage: it is the difference between "deploy" and "break Stripe" — evidence of the gap: no `supabase/config.toml`; `DEPLOY-VERIFIED-2026-09-02.md:217`; production has 22 `verify_jwt=false` functions recorded nowhere in git — sketch: commit `supabase/config.toml` with a `[functions.<slug>]` block per public function; `validate-edge-auth-config.ts` fails if a function that reads `x-cron-secret` / `stripe-signature` / `X-RevenueCat-Signature` / a portal token has no `verify_jwt = false`, and if any function with `verify_jwt = false` lacks its own auth check (`validate-edge-security` already knows the list of self-authenticating functions).

### O2 — One money formatter, enforced — leverage: every screen a GC reads a number on — evidence: 60 definitions, five sign-dropping (`F5`), 33 date formatters, two `markupToPercent` + one `normalizeMarkup` with opposite conventions — sketch: `utils/formatters.ts` grows `formatMoney(n, {decimals, sign:'auto'|'always'})` and `formatCalendarDay` is the only date formatter; an ESLint `no-restricted-syntax` selector forbids local definitions; a validator asserts `formatMoney(-1234.5,2) === '-$1,234.50'` and that `app/**` contains zero `Math.abs(n).toLocaleString` money strings.

### O3 — One cleanup commit before launch — leverage: makes `expo-doctor` green and removes the recurring audit noise — evidence: F3, F6, F14 — sketch: `git rm package-lock.json DEPLOY-NOW.sql DEPLOY-RUNBOOK.md Untitled.* .verb.md LAUNCH.md *.docx *.xlsx backend/ <20 dead files>`; `bun remove hono zustand @stardazed/streams-text-encoding @ungap/structured-clone`; `rm -rf node_modules && bun install --frozen-lockfile`; `expo-doctor` and `knip` become `ship-check` steps (knip as a warning with the Deno entry points configured).

### O4 — Migrate `VoiceCaptureModal` to `expo-audio` now, while it is one file — leverage: voice is the Copilot front door and SDK 55 removes `expo-av` — evidence: F4 — sketch: `useAudioRecorder(RecordingPresets.HIGH_QUALITY)`, `setAudioModeAsync({ allowsRecording })`, keep the `transcribe-audio` upload contract; verify on device (the sim cannot record).

### O5 — Make the sync engine executable in a test — leverage: offline writes are the product's promise to the jobsite and the class of bug the simulator keeps finding — evidence: `offlineQueue` 0 executing tests; `validate-offline-group-abort` is text-only — sketch: `__tests__/sync/offline-queue.test.ts` with the existing `__tests__/mocks/supabase.ts` returning scripted `{error:{code}}` per call; assert queue state after `processOfflineQueue()` for PGRST205 (kept, `retryCount` unchanged), 23514 (dropped + `notifyDroppedWrites` called), network throw (kept), FK 23503 (kept), success (removed) — five cases, ~80 lines.

### O6 — Split the three 5,000-line files along the seams they already have — leverage: every launch-week fix lands in one of them (`project-detail.tsx` has 60 `as any`, `estimate/full.tsx` 16 `exhaustive-deps` suppressions) — evidence: F13 — sketch: one PR per file, section components keyed by the same `SectionKey`/`?tile=` the smoke suite uses, so `project-detail-tile-sections.test.tsx` is the regression net.

### O7 — Env-parity guard — leverage: the app must behave the same whether the bundle came from EAS or a laptop — evidence: F8 — sketch: `validate-env-parity.ts` lists every `process.env.EXPO_PUBLIC_*` read in `app components utils contexts hooks lib` and fails unless each key appears in `eas.json` `build.production.env` (value may be empty) or in an explicit `FALLBACK_SAFE` allow-list with the fallback's file:line.

---

## The ten most valuable tests to write next (function under test → assertion)

1. `utils/offlineQueue.ts processOfflineQueue` with a scripted `supabase` mock → an entry whose write returns `{error:{code:'PGRST205'}}` is still in the queue with `retryCount` unchanged; `{code:'23514'}` is removed and `notifyDroppedWrites` is called once with its table; a thrown network error keeps it. (Today: 0 executing tests on the sync engine.)
2. `utils/offlineQueue.ts addToOfflineQueue` with `AsyncStorage.setItem` rejecting → the promise rejects (or `notifyDroppedWrites` fires); pins the F10 fix.
3. `utils/billingFlowCore.ts reminderEligibility / targetDunningStage / daysOverdue` → an invoice whose only unpaid balance is held retention is never eligible for any dunning stage; `daysOverdue` counts from the due date, not the issue date; stages advance monotonically. (The live "FINAL NOTICE on retention" harm has no executing test.)
4. `utils/aiaBilling.ts computeAIATotals` → for a 3-line schedule of values with 10% retainage and one prior certificate, total completed − retainage − previous = current payment due; `thisPeriod = scheduledValue` (the recorded decision) is asserted explicitly so a change is a conscious one.
5. `utils/localCacheKeys.ts selectTenantKeysToWipe` → given `['mageid_projects','mage_bids','buildwise_projects','tertiary_rfis','sb-nteoqhcswappxxjlpvap-auth-token','rc_customer','post-rfp:draft:1']` returns exactly the five app keys and never the `sb-*-auth-token`; `isAppStorageKey('sb-x-auth-token') === false`. (`validate-storage-hygiene` is text-only.)
6. `contexts/SubscriptionContext.tsx tierFromCustomerInfo` (export it or move to `utils/tier.ts`) → active `{pro, business}` resolves `'business'`; active `{enterprise}` → `'enterprise'`; expired-only → `'free'`; and `utils/featureTiers.ts tierMeetsRequirement('enterprise','business') === true`, `('pro','business') === false` — with a parity assertion that the client rank table equals `supabase/functions/_shared/auth.ts` `TIER_RANK`.
7. `utils/formatters.ts formatMoney(-1234.5, 2) === '-$1,234.50'`, `formatMoney(null) === '$0'`, plus a source assertion that no file under `app/` defines `function money|formatCurrency|fmtMoney` (F5).
8. `utils/calendarDate.ts parseCalendarDay('2026-03-08')` executed under `TZ=Pacific/Honolulu`, `TZ=UTC`, `TZ=Asia/Tokyo` (the validator re-run with `TZ` set) → local midnight of the 8th in all three; `formatCalendarDay(parseCalendarDay(x)) === x`. (The deploy doc lists "negative UTC offset" as unproven.)
9. `utils/invoiceBilling.ts netBalanceDue` → gross 10,000, retention 1,000, paid 9,000 → 0 (never negative); `markupInclusiveUnitPrice(0, 0, 42) === 42` (no division by zero); `progressSubtotal` on a 0% line is 0.
10. `hooks/useCostSeeds.ts` merge (`pruneTombstones` + the UNION) → a local tombstone for seed `S` plus a server row `S` without `deleted_at` stays deleted locally and is not resurrected; documents the consequence of the held-back `cost_seeds.deleted_at` decision so the founder's call is visible in the test log.

---

## Appendix — lower-severity notes (one line each with file:line)

- `DEPLOY-RUNBOOK.md:17` "10 migrations" vs `DEPLOY-NOW.sql:3` "12 migrations" vs `DEPLOY-VERIFIED` (17 files ≥ 08-26): three counts, one directory.
- `REPAIR-HISTORY.sh:21-80` marks 60 versions applied; production tracker also lacks all 17 versions ≥ `20260826120000` — `supabase migration list --linked` will still show them pending after the script runs.
- `package.json` `ship-check` is a single 209-step `&&` chain (~9 KB); `validate-guard-coverage` keeps it honest but every new guard edits a 9 KB line — a `scripts/ship-check.ts` runner reading a manifest would make diffs reviewable.
- `jest.config.js:36-52` anchors `.claude/` correctly; `.claude/launch.json` still carries a `rork start -p 3lwkqnydboi5oec35hm3z` config (`name: "web"`) beside `expo-web`/`expo-native` — the Rork-era entry is a stale launcher.
- `metro.config.js` and `jest.config.js` both special-case `tslib` (documented); knip flags `tslib` as an unlisted dependency in both — add it to `devDependencies` so the resolution is explicit.
- `constants/materials.ts:437 function formatMoney(value: number): number` — a rounding helper named like a formatter.
- `hooks/useCostBenchmark.ts:70` and `:140` — `void supabase.from('cost_benchmark_samples').upsert(...)` inside `try/catch`: the catch can never fire on a promise rejection; the upsert bypasses the queue.
- `contexts/SubscriptionContext.tsx:181-198` — a failed `subscriptions` read resolves `null` and the tier falls back to RevenueCat → local cache → `'free'`; a transient DB error on a web session (no RC) downgrades the UI silently (tier-gating auditor's domain).
- `app/(tabs)/discover/hire.tsx:162`, `companies.tsx:184` log `process.env.EXPO_PUBLIC_SUPABASE_URL?.substring(0, 40)` — always `undefined` today (var not set; `lib/supabase.ts` fallback is what runs).
- `eas.json` preview/production `env` carry no `EXPO_PUBLIC_SUPABASE_*`; the hardcoded fallback in `lib/supabase.ts:16-17` is the only reason builds work — the `CLAUDE.md` env table's "If missing: No backend at all" is false.
- `app.json` has no `ios.buildNumber`; `eas.json` `autoIncrement: true` with `appVersionSource: "remote"` — fine, but the on-disk `ios/` project says `CURRENT_PROJECT_VERSION = 1` / `MARKETING_VERSION = 1.0`, so a local `expo run:ios --configuration Release` would submit 1.0 (1) — do not archive locally.
- `expo-doctor` duplicate `expo-constants@18.0.14` under `expo-asset/node_modules` — install corruption; cleared by F3's reinstall.
- knip: `@babel/core` and `@expo/ngrok` flagged unused — false positives (babel-preset-expo peer; `--tunnel`).
- `types/index.ts` (4,851 lines) exports 122 types nothing imports (knip "Unused exported types") — the domain-type file has grown a graveyard.
- 27 components export the same symbol as both named and default (`components/ui/Button.tsx`, `Card.tsx`, …) — pick one; `hooks/useTierAccess.ts` default export is unused.
- `supabase/functions/*/index.ts`: 53 `console.log` — edge logs are retained by Supabase; `create-payment-link/index.ts` logs no PII on inspection, `send-email/index.ts` (repo copy) logs the recipient address at `backend/routes/send-email.ts:29` (dead path).
- `git status` at session start showed `supabase/schema.sql` modified; by the end it was committed (`acaeb273`) — fine, but note the MD5 claim in its header predates that commit.

## What I could not verify (and how it could be)

- **EAS lockfile precedence** when both `bun.lock` and `package-lock.json` exist — not published on docs.expo.dev (checked "Using Bun", iOS/Android build process, EAS JSON pages). Verify by reading the "Install dependencies" step of the last successful EAS build log (`eas build:view <id>`): it names the package manager. Until then, F3 stands on `expo-doctor`'s failure and Expo's "delete any lockfiles generated by other package managers".
- **Whether the last production OTA carried the OpenWeather key** (F8) — `eas update:view` on the latest production update and grep the exported bundle for `openweathermap.org` + a 32-hex key adjacent to it; or check Sentry/PostHog for `source:'live'` weather events.
- **iOS entry of a negative CO line price** (F5) — on device: paste "-500" into the unit-price field of a new change order; on web/Android type it. The display defect itself is CONFIRMED from the code.
- **`supabase functions deploy` resetting `verify_jwt`** (F2) — asserted from the config reference's stated default and the CLI flag semantics, not by executing a deploy. A zero-risk confirmation: `supabase functions deploy og-image --project-ref … --dry-run` does not exist, so instead run the redeploy on a throwaway function (`supabase functions new tmp-probe; deploy; list; deploy --no-verify-jwt; list; delete`) and watch the flag flip.
- **Callers' UX for the online-only engines** (F9) — traced `app/invoice.tsx:392-406` (honest message); `selectionsEngine`/`lienWaiverEngine` callers not traced. Grep `saveLienWaiver(`/`chooseOption(` call sites and check the `null` branch.
- **Runtime reachability of the `nanoid` advisories** — asserted from the advisory text (negative/zero `size`); `@react-navigation/core` calls `nanoid()` with no argument.
