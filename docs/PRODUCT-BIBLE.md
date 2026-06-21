# MAGE ID — Product Bible

> The single source of truth for **what MAGE ID is, who it's for, why it wins, and how it's built.**
> Written to orient a new contributor (human or AI) from zero. If you're starting a fresh session, read this first, then `CLAUDE.md` for build/command specifics.
> Last major update: 2026-06 (post go-live finalization).

---

## 1. One-paragraph definition

**MAGE ID is an all-in-one operating system for small-to-mid residential and light-commercial general contractors and remodelers.** It runs the whole job lifecycle — lead → estimate → bid/proposal → contract → schedule → field execution → invoicing → closeout — on one mobile + web app (iOS primary, Android + web supported). What makes it different from the dozens of "construction management" tools is a **closed cost-learning loop and active margin defense**: it learns each contractor's *real* costs from their own completed jobs and uses that to price the next bid smarter and warn when a live job is bleeding margin. Competitors organize your job; MAGE ID protects your profit.

**The wedge line:** *"Everyone bids. We learn. Everyone organizes your job. We defend your margin."*

---

## 2. The moat (read this twice)

Across 24+ competitors (Procore → Handoff), **none ships a closed cost-learning loop or real margin intelligence.** Everyone prices off generic/catalog data or dead-ends at a quantity → Excel. MAGE's moat is three reinforcing loops:

1. **Cost-learning loop** — completed-job actuals (receipts, invoices, time, change orders) feed back into the estimate engine, so each bid is priced off *your* history, not a generic catalog. Features: Estimate Calibration, Estimate Accuracy ledger, Living Estimate, Cost Database, Win Optimizer.
2. **Margin defense** — the app continuously watches a live job's cost vs. plan and raises alerts before the margin is gone. Features: Margin Risk Score, Margin Erosion Alerts, Portfolio Margin, Job Costing dashboard, Cash-Flow forecaster.
3. **Production control (Lean)** — the Last Planner System + weather-aware scheduling keep the schedule honest, which is what actually protects the margin in the field. (Most SMB tools have a Gantt; almost none have pull planning or weather auto-reschedule.)

The moat is defensible because it runs on **the contractor's own data** — a competitor can copy a screen, not your job history.

---

## 3. Who it's for (ICP + personas)

**Primary ICP:** owner-operator and small-team **residential GCs / remodelers** (and light-commercial). The buyer is the owner or office manager; the daily users are the owner, a PM, and field crews/subs. iOS is the primary target (`ios.supportsTablet: false` — phone-first, no iPad design).

**Four personas the product serves (persona-select on first run):**
- **Contractor / GC** — the core paying user. Estimating, scheduling, job costing, subs, invoicing.
- **Subcontractor / trade** — free tier; sub portals, invoice submission, marketplace bidding. Subs being free seeds the marketplace supply side.
- **Homeowner / client** — read-only client portals, proposals, the public "request a quote" funnel (marketplace demand side).
- **Property Manager** — recurring-demand persona: managed properties + work orders dispatched to contractors (the `claude/beautiful-hypatia` branch work).

---

## 4. Competitive landscape (verified 2025–2026)

| Competitor | What they are | Where MAGE wins |
|---|---|---|
| **Procore** | Enterprise/commercial GC platform. New native Scheduling GA'd **Feb 17 2026**; its AI is **delay-impact prediction only** (an RFI/submittal flags a milestone risk) — **no generative scheduling, no pull planning.** No free tier; ACV pricing ($4.5k–$80k+/yr, $50–150k onboarding). Reviewers: "not viable for a small residential remodeler." | Different segment entirely. MAGE already does **generative scheduling from the estimate** + **Last Planner** + **weather auto-reschedule** — none of which Procore has for SMB, and its price/onboarding can't come down-market. |
| **Buildertrend** | Strongest SMB scheduling+comms, ~$299–399/mo. | Penalized for complexity, "too many clicks," clunky mobile, intrusive notifications, no cost-learning loop, no Last Planner. MAGE: opt-in notifications, cost intelligence, production control. |
| **JobTread** | Financial-ops-first SMB suite (~$49/mo). *Has* critical path since 2022 (common claim it doesn't is false). | Scheduling is secondary for them; no cost-learning loop / margin defense / Last Planner. |
| **Houzz Pro** | Design + lead-gen + light PM (~$499/mo top tier). **The real competitor on "AI schedule-from-estimate" (AutoMate)** — shipped, residential. | Houzz's scheduling is shallow; MAGE beats it on depth (CPM, EVM, Last Planner, weather) and the cost-learning moat. Houzz's threat is **distribution**, not features. |
| **Knowify** | Job-costing/estimating for trades. | Scheduling is the weak/"clunky" module; no production control or learning loop. |
| **CoConstruct** | **Dead for new buyers** — folded into Buildertrend, closed to signups. Don't benchmark as live. | — |
| **ServiceTitan / Procore / Autodesk** | Enterprise ceiling, not SMB rivals. | Out of segment. |
| **ALICE / nPlan / EHAB** | Enterprise AI scheduling (generative / delay-prediction / weather). Custom enterprise pricing, commercial/infrastructure only. | The SMB residential equivalent is an **open whitespace** — MAGE's weather auto-reschedule + generative-from-estimate bring this down-market. |
| **Handoff / AI estimators** | Generative AI estimating off **generic** pricing (publicly over-bid $7,500 to paint 8 doors). | MAGE prices off *your* actuals — "your prices, not an AI's imagination." |

**Strategic posture:** don't out-feature Procore's enterprise AI. **Own SMB residential** with the cost-learning loop + production control they structurally won't serve. The biggest real exposures are **distribution/marketing** and **measurement capture**, not features — see the growth playbook.

---

## 5. Feature map (grounded in the actual codebase)

MAGE has ~140 screens across 12 tab groups. Organized by domain:

### Estimating & cost intelligence (the moat)
- **Estimate Wizard** (`estimate-wizard`, AI, Pro) — AI estimate from a sentence/scope; assemblies; cost-DB pricing.
- **Cost Database** (`cost-database`) — the contractor's own price book; receipts post as actuals.
- **Estimate Calibration** (`estimate-calibration`) — cross-job bias correction: where your bids run high/low, and the fix.
- **Estimate Accuracy / Confidence** (`estimate-accuracy`, `estimate-confidence`) — accuracy ledger + per-estimate confidence.
- **Living Estimate** (`living-estimate`) — estimate that tracks against actuals as the job runs.
- **Win Optimizer** (`win-optimizer`) — the bid price that wins AND profits (expected-value curve over your win history).
- **Smart Proposal** (`smart-proposal`) — good/better/best tiers priced by the Win Optimizer; accept/decline trains the win curve (closes the learning loop).
- **Visual Takeoff** (`takeoff`, `area-takeoff`, `takeoff-estimate`) — on-screen quantity takeoff incl. **freehand lasso**; shoelace area/polyline-length engine; plan intelligence.
- **Plan Intelligence / Plan Viewer** (`plan-intelligence`, `plan-viewer`, `plans`) — AI reads the floor plan, learns your prices.

### Margin defense
- **Job Costing** (`job-costing`), **Budget Dashboard** (`budget-dashboard`), **Margin Risk** (`margin-risk`), **Margin Alerts** (`margin-alerts`), **Portfolio Margin** (`portfolio-margin`), **Cash Flow** (`cash-flow`), **Payment Predictions** (`payment-predictions`).
- **Material Receipts** (`material-receipt`) → post as job-cost actuals.

### Scheduling (the crown jewel — see §10)
- **Schedule Pro** (`schedule-pro`) — full CPM Gantt, two-pane web layout, baselines, EVM, anchors/constraints, resource calendars, closures, weather, AI.
- **Schedule Wizard** (`schedule-wizard`) + `autoScheduleFromEstimate` — **generative CPM schedule from the estimate** (the moat-linked AI scheduling).
- **Last Planner** (`last-planner`) — Lean production control: lookahead → constraints → weekly commitments → PPC reliability → crew dispatch.
- **Weather auto-reschedule** (`weatherReschedule.ts`) — rains-out weather-sensitive tasks, cascades the delay, logs delay-days.
- **Shared Schedule** (`shared-schedule`) — read-only schedule link for clients/subs.

### Field execution
- Daily Reports (`daily-report`), Punch List + AI Punch (`punch-list`, `ai-punch`, `punch-walk`), RFIs (`rfi`, `rfi-from-drawing`), Submittals (`submittal`, `extract-submittals`), Photos (`photo-annotator`, `photo-triage`, `shared-photos`), Time Tracking (`time-tracking`), Permits (`permits`), Equipment (`equipment`), OAC meetings (`oac-meeting`).

### Money & contracts
- Contracts (`contract`, e-sign), Change Orders (`change-order`), Invoices (`invoice`, `bill-from-estimate`), AIA Pay Apps (`aia-pay-app`), Lien Waivers (`lien-waivers`), Payments + Stripe Connect (`payments`, `payments-setup`), Buyout (`buyout`, `buyout-package`, `buyout-scope-gap`), QuickBooks sync (`qbo-setup`), Financing (Wisetack/Hearth redirect), 1099 export (`tax-1099-export`).

### Subs & marketplace
- Sub Portals (`sub-portal-setup`, `sub-portals`), Sub Scorecard (`sub-scorecard` — grades subs from real job-cost data), Prequal/COI (`prequal-manager`, `coi-vault`), Bid Leveling (`bid-leveling`).
- **Marketplace**: post jobs/RFPs (`post-job`, `post-rfp`, `nearby-rfps`, `my-rfps`), bid responses (`submit-bid-response`, `rfp-responses-review`), award (`award-rfp`).

### Client-facing & growth
- Client Portal (`client-portal-setup`, `client-view`, `client-update`, `client-messages`), Closeout Binder (`closeout-binder`), Warranties (`warranties`, `warranty-walk`), Selections (`selections`), Handover (`handover`).
- **Public lead funnel** (`public-profile-setup`, `public-lead-intake` fn) — "request a quote" from a public portfolio → lands as a Lead.
- **Growth badge** — "Built with MAGE ID — run your projects free" on free-tier client emails (estimate/contract/daily-report/warranty).

### AI
- **Ask MAGE** (`ask`) — business-wide AI Q&A. **Project Memory** (`project-memory`) — ask one project's own history (RFIs, daily reports, COs), cited; v2 uses pgvector semantic search with TF-IDF fallback. Drawing/photo/spec analysis (`drawing-analyzer`, `compare-drawings`, AI code check).
- **Connect Claude** (`connect-claude`) — MCP server exposing the contractor's data read-only to Claude/any MCP client (personal access tokens).

### Onboarding & data
- Persona select, onboarding (+ paywall), **bring-your-own-pipeline import** (`import-pipeline`, `data-import`), data export.

---

## 6. The three surfaces (each ships differently)

| Surface | What | Ships via |
|---|---|---|
| **App Store app** (iOS, `com.mageid.app`) | The primary native app. | `eas build --profile production --platform ios` → `eas submit`. JS-only changes after a build is live → **OTA** (`eas update --branch production`). Runtime version policy = `appVersion` (bumping `expo.version` forces a new native build). |
| **app.mageid.app** (web app) | Expo web export of the same app. | **Auto-builds on `git push main`** via Netlify (`expo export --platform web`, root `netlify.toml`). |
| **mageid.app** (marketing) | Static marketing site (`marketing/`), incl. public portfolios, pricing, privacy/terms, lead funnel. | Separate Netlify site (`marketing/netlify.toml`). Public portfolio pages are **hash-based share links** (`/builders/#d=<base64>`), not path slugs. |

Android (`app.mageid.android`) is supported but secondary.

---

## 7. Pricing & tier gating

Tiers (RevenueCat): **free**, **Pro $29/mo**, **Business $79/mo**, **Enterprise $150/mo**. Rank `free=0, pro=1, business=2, enterprise=3` — higher always satisfies lower.

- **Client gate:** `hooks/useTierAccess.ts` is the single source — `useTierAccess().{tier, isFree, canAccess(featureKey)}`. Never branch on raw RevenueCat entitlements.
- **Server gate:** `supabase/functions/_shared/auth.ts` `requireTier(req, ['pro','business'], 'feature')` (min-rank comparison).
- **Server-authoritative tier:** a DB trigger pins `subscriptions.tier`; the **only** thing that may elevate a tier is the `revenuecat-webhook` edge function after verifying the request came from RevenueCat. (So the RevenueCat webhook + its secrets MUST be configured or paid purchases won't unlock.)
- **Master accounts:** `utils/owner.ts` `OWNER_EMAILS` (client) / `_shared/auth.ts` `MASTER_EMAILS` (server) — keep IN SYNC.
- **AI caps:** daily text caps in `utils/aiRateLimiter.ts`; monthly vision/page caps in `_shared/auth.ts` `MONTHLY_CAPS`; must match `app/paywall.tsx` `AI_LIMITS`.

---

## 8. Architecture (the essentials)

- **Stack:** React Native + Expo (Expo Router 6, typed routes), New Architecture on. Package manager **bun** (scripts shell out to `bunx rork`). TypeScript strict.
- **Routing:** `app/_layout.tsx` is the single root — mounts the provider stack + declares every `Stack.Screen`. `app/(tabs)/_layout.tsx` = mobile tab bar; `components/DesktopSidebar.tsx` = web/desktop nav (keep both in sync).
- **Provider stack (order matters):** QueryClient → GestureHandler → ThemeLoader → **Auth** → Subscription (RevenueCat) → Project → Bids → Companies → Hire → Notification → OfflineSyncManager + the Stack. Contexts use `@nkzw/create-context-hook`. Anything below Auth gets the user.
- **State:** local/UI = zustand; server = `@tanstack/react-query` + Supabase; cross-screen domain state = the context providers; persistence = AsyncStorage (`buildwise_*` legacy core keys, `tertiary_*` newer sub-collections). **Note: the app does NOT use tRPC** (old docs lied; `lib/trpc.ts`/`backend/trpc/` don't exist).
- **Offline-first:** all Supabase writes go through `utils/offlineQueue.ts` `supabaseWrite` (optimistic local + enqueue + flush on reconnect via `OfflineSyncManager`). **Never call `supabase.from().insert/update/delete` directly from UI.**
- **Backend:** Supabase **edge functions** (Deno) are the primary backend (~50 of them: AI relays, vision, Stripe Connect, RevenueCat webhook, magic-link, notify fan-out, MCP, project-memory, lead intake, weather, etc.). `lib/supabase.ts` = anon-key client (RLS-protected). `backend/hono.ts` exists but is essentially unused at runtime.
- **Types:** `types/index.ts` is the single source of truth (252 types). Extend domain objects there first.
- **Path alias:** `@/*` → repo root.
- **Conventions:** icons = `lucide-react-native`; modal-in-screen pattern for long screens; haptics/local-auth/secure-store available; design tokens in `constants/` (lint nudges you off inline hex/fontSize literals).

---

## 9. Security posture (audited & hardened, 2026-06)

A full adversarial audit was run (attacker holding only the public anon key + one ordinary account). Result after remediation: **RLS on and `auth.uid()`-scoped on every data table; 0 RLS-disabled tables; 0 ERROR-level Supabase advisories.**

Fixes shipped:
- **Tier self-upgrade closed** — DB trigger pins `subscriptions.tier`; only the RevenueCat webhook can elevate.
- **Storage lockdown** — `plan-sheets` / `project-documents` / `sub-documents` scoped to owner (was cross-tenant readable — incl. sub W-9s/COIs).
- **IDOR fixes** — `convert-pdf-to-images`, `schedule-ical(-url)` ownership checks.
- **`email_unsubscribes`** — dropped anon `INSERT(true)`/`SELECT(true)` policies (global-suppression + PII-dump holes); all access is service-role now.
- **MCP token expiry**, **`search_path` pinned** on all SECURITY DEFINER functions, **`unsubscribe`** requires a signed token.

Known/deferred: leaked-password protection requires **Supabase Pro** (project is on Free — billing decision); `pg_net`/`vector` "extension in public" are INFO-level; the SECURITY DEFINER token/portal functions are intentionally anon-executable (that's how unauthenticated portals work).

---

## 10. Scheduling deep-dive (why it's best-in-class for SMB)

The scheduling stack is unusually deep for this segment and is a primary differentiator:
- **CPM engine** (`cpm.ts`) — forward/backward pass, ES/EF/LS/LF, total/free float, critical path, FS/SS/FF/SF dependencies + lag, anchors (MSP-style constraints), resource calendars, closures (`nonWorkingDates`).
- **Earned Value** (`scheduleEarnedValue.ts`), **schedule health score**, **baselines** (named), **What-If scenarios**, **resource leveling** (engine-ready).
- **Generative-from-estimate** (`autoScheduleFromEstimate.ts`) — AI builds a full CPM schedule (tasks, durations, dependencies, crew sizes, WBS) from the estimate. **Procore can't do this.**
- **Last Planner System** (`lastPlanner.ts`, `last-planner.tsx`) — lookahead (3-week, constraint-gated), weekly work plan (commit/kept/missed), **PPC** (target 80–85%), variance analysis, **crew dispatch** (push each crew their committed slice via email/share). Absent from all 5 SMB incumbents.
- **Weather auto-reschedule** (`weatherReschedule.ts`) — maps the forecast's non-workable days onto `isWeatherSensitive` tasks and propagates lost days through the dependency graph (edge-delay model: successors + project finish slip, authored durations stay honest); pins done/past work; writes a **delay-day log**. Open whitespace in SMB residential.
- Schedule sharing (read-only link), PDF + iCal export, audit log, voice → schedule mutations.

Model note: schedule uses abstract **day numbers** (`startDay`/`durationDays`) mapped to calendar dates via working-days; CPM is analysis (it doesn't auto-overwrite authored startDays).

---

## 11. Growth strategy (summary — full detail in `docs/growth-playbook.md`)

Solo-operator, avoid paid social, compounding channels:
1. **"Built with MAGE ID" viral loop** (shipped) — on the client-facing emails a free GC sends (estimate/contract/daily-report/warranty). Calendly/Loom mechanic; paid tiers remove the badge.
2. **Programmatic supply-seeding from public permit/license data** (BuildZoom's cold-start) — CSLB/DBPR free files, Socrata permits, Shovels.ai for turnkey.
3. **Own-brand "vs competitor" SEO pages + a free estimate/markup calculator** (data-backed; avoid empty doorway pages → Google scaled-content-abuse penalty).
4. **Capterra/G2/QuickBooks listings** (reviews ≈ peer recommendations; 67% of buyers prefer rep-free buying).
5. **Compliant cold email** (CAN-SPAM OK with address+opt-out; SMS/LinkedIn risky).
6. **Product-as-reward referral** (free months/credits, not cash — Dropbox lesson).

Reality: k-factor 0.15–0.7 and free→paid 3–5% are modest; the badge amplifies other channels. New-domain SEO is a 6–12 month asset.

---

## 12. What was built recently (the 2026-06 era)

Merged to main this era: Last Planner + crew dispatch; weather auto-reschedule + delay log; Project Memory v1 (TF-IDF) + v2 (pgvector); Property Manager persona + bring-your-own-pipeline; public lead funnel; Win Optimizer + Smart Proposal; Estimate Calibration; Plan Intelligence; Sub Performance Scorecard; material-receipt actuals; positioning/competitive docs; the growth badge; freehand takeoff lasso; the full security audit + hardening.

**Outstanding (owner actions, not code):**
- **RevenueCat webhook + Supabase secrets** (`REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_SECRET_API_KEY`) — *required* or paid purchases won't unlock tiers.
- **App Store:** accept the latest Apple **Program License Agreement** + **Paid Applications Agreement** (a 403/PLA error blocks submission until done), then `eas build --profile production --platform ios --auto-submit`, then complete the App Store Connect listing (privacy nutrition label, IAP products "Ready to Submit").
- **OTA** (`eas update --branch production`) for JS to already-installed 1.0.0 builds.
- RevenueCat **web** key in `eas.json` is sandbox (`rcb_sb_…`) — web purchases non-real until swapped.
- Device QA on new screens; Supabase Pro upgrade (unlocks leaked-password protection + removes Free-tier limits).

**Documented follow-ups:** real-weather (live `getForecastWithFallback` + project location) for the reschedule; conversational schedule agent; weather badge on PDF/static-portal surfaces; plan-sheets fully private + signed URLs.

---

## 13. Conventions & "don't break these"

- **Run before every ship:** `bun run typecheck` (strict, must be clean) and `bun run lint`. `bun run ship-check` runs typecheck + lint + validation suites.
- **Engine pattern:** build domain logic as a **pure module in `utils/`** + a throwaway harness in `scripts/verify-*.ts` (run with `bun`, **delete before commit**). See `lastPlanner.ts`, `crewDispatch.ts`, `weatherReschedule.ts`.
- **Never** push to `main` without permission; **never** call Supabase writes directly from UI (use the offline queue); **never** include the model identifier in commits/PRs/code.
- Keep app/server twins in sync: `useTierAccess`↔`requireTier`, `OWNER_EMAILS`↔`MASTER_EMAILS`, `utils/emailLayout.ts`↔`supabase/functions/_shared/email.ts`, mobile tab bar ↔ DesktopSidebar, AI caps across the three places.
- AsyncStorage keys: `buildwise_*` (legacy core, don't rename) / `tertiary_*` (newer).
- Edge functions deploy via the Supabase MCP (or `supabase functions deploy <name>`); migrations via `apply_migration`. Sandbox can't reach the prod Supabase host for runtime tests — rely on deploy success + review.

---

## 14. Glossary

- **Cost-learning loop** — actuals → estimate engine; the moat.
- **Last Planner System (LPS)** — Lean pull planning: should→can→will→did→learn; PPC = % of weekly commitments kept (target 80–85%).
- **Anchors** — MAGE's name for MS-Project-style schedule constraints (SNET/MSO/etc.).
- **PPC** — Percent Plan Complete.
- **Buyout** — converting estimate scope into sub commitments / POs.
- **Win Optimizer** — expected-value bid pricing over the contractor's win/loss history.
- **OTA** — over-the-air JS update via `eas update` (reaches installed builds at the same runtimeVersion).
- **The three surfaces** — App Store app, app.mageid.app (web app), mageid.app (marketing).

---

_This is a living document. When the product's thesis, moat, competitive position, or architecture materially changes, update this file — it's what future sessions read to get oriented fast._
