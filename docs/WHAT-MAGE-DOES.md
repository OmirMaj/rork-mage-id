# MAGE ID — What The App Does

> **Purpose of this document.** A complete, accurate description of what the MAGE ID app does today, written so a reviewer (e.g. a fresh Claude with no repo access) can reason about **gaps** — missing capabilities a construction-management app for general contractors should have, incomplete or dead-end flows, competitive blind spots, and where "live" features may be shallow. Status tags (`live` / `gated` / `partial` / `local-only`) reflect the actual codebase, not marketing. When you spot something that *sounds* built, assume it's real unless tagged otherwise.

---

## 1. What it is

**MAGE ID** is an all-in-one, mobile-first operating system for **small-to-mid residential and light-commercial general contractors** (GCs). It runs the whole job — estimate → schedule → build → bill → close out — with an AI layer ("MAGE Brain") on top, and a distinguishing focus on **protecting the contractor's profit margin**.

**Platform:** React Native / Expo, **iOS-primary** (phone-first, no iPad layout), Android + web secondary (web at `app.mageid.app`). Offline-first.

**Who it's for (personas):**
- **Contractor / GC** — the primary paying user.
- **Subcontractor / trade** — free tier; prequal, sub-portal, marketplace bidding.
- **Homeowner / client** — read-only (or action-capable) portals; marketplace demand side.
- **Property Manager** — recurring work-order demand persona.

## 2. The thesis / moat

MAGE's differentiator is a **cost-learning loop**: it learns each contractor's *real* costs from their own completed jobs and uses that to (a) price the next bid smarter and (b) warn when a live job is bleeding margin. Three reinforcing loops:
1. **Cost-learning** — job actuals (receipts, invoices, labor hours) feed the estimate/cost engine.
2. **Margin defense** — live job cost vs. plan produces real-time margin-risk alerts.
3. **Production control** — a genuine CPM engine + Last Planner + weather-aware scheduling keep the schedule honest.

The framing: *competitors organize the job; MAGE protects the profit.* Defensible because it runs on the contractor's own job history, which a competitor can't copy.

## 3. Subscription tiers

| Tier | Price | Includes (delta) |
|---|---|---|
| **Free** | $0 | Unlimited projects, manual estimates, manual daily reports, client portal (basic) |
| **Pro** | $29/mo | AI Cost Estimator, AI Takeoff (PDF→LF/SF), AI Schedule Builder, Voice-to-Report, AI Photo Triage/Punch, Cash Flow + EVM, AIA G702/G703, Change Orders + Invoicing, Equipment, branded Client Portal, **0% Stripe processing markup** |
| **Business** | $79/mo | Pro + Subcontractor Management, Punch/Closeout, RFIs & Submittals, full Budget Dashboard, Plan Viewer w/ sheet pinning |
| **Enterprise** | $150/mo | Business + much higher AI caps (≈150 requests/day, 40 advanced AI/day, 100 drawing analyses/mo, 200 photo, 300 PDF-takeoff pages, etc.), Claude Sonnet for takeoff |

Gating is enforced **client-side** (`useTierAccess().canAccess`) *and* **server-side** (`requireTier` in edge functions, min-rank so a higher tier satisfies a lower requirement). Per-tier **AI usage caps** (daily text, daily advanced, monthly vision) are enforced with server+local monotonic counters.

## 4. Platform & architecture (brief)

- **RN + Expo** (Expo Router 6, typed routes, New Architecture on). **bun** package manager. TypeScript strict.
- **State:** local UI = `useState`/`useReducer`; server = React Query + Supabase (anon key, RLS-protected). No tRPC.
- **Offline-first:** every write goes through a bounded FIFO **offline queue** (optimistic mutate → enqueue → flush on reconnect). UI never calls Supabase writes directly.
- **Backend:** ~50 Supabase **edge functions** (Deno) — AI relays, vision, Stripe Connect, RevenueCat webhook, magic-link, MCP server, project-memory (pgvector), weather, email, etc.
- **Domain types:** `types/index.ts` is the single source (~250 types).
- **Persistence:** AsyncStorage under `mageid_*` prefix; tenant-boundary wipe by prefix sweep.

---

## 5. Feature inventory (by area)

> Nearly everything below is `live`. Exceptions are tagged.

### Estimating & Cost Intelligence (the moat)
Assembly estimator (164 assemblies, material DB, labor rates, productivity factors) · AI Estimate Wizard (free-text scope → full estimate) · estimate versioning & immutable revision history · visual + freehand-lasso takeoff (LF/SF/EA/CY) · AI drawing analyzer & **compare-drawings** (revision diff → CO/RFI) · plan intelligence (dimensions/fixtures/finishes from plans) · **contractor's own cost database** (seeded from job actuals) · estimate **calibration** (cross-job over/under bias) · estimate accuracy ledger · **living estimate** (auto-tracks actuals) · **Win Optimizer** (price for win-prob × margin over win/loss history) · **Smart Proposal** (good/better/best) · Quick Quote · bill-from-estimate.

### Scheduling & Production Control (crown jewel)
**Real CPM engine** (forward/backward pass, ES/EF/LS/LF, total & free float, critical path, cycle detection, FS/SS/FF/SF deps with lag, resource leveling) · **Schedule Pro** two-pane Gantt (web/tablet) with **undo/redo** · AI **generative scheduler** from estimate (WBS, durations, deps, crew, rationale) · MSP-style anchor constraints (SNLT/FNLT/MSO/MFO) · **Last Planner System** (3-week lookahead, constraint gating, weekly work plan, PPC) · **crew dispatch** · **weather auto-reschedule** (forecast → non-workable days → dependency ripple) · named **baselines** + as-planned/as-built diff · scenario/what-if · task checklists · WBS roll-ups · resource calendars · **Earned Value (EVM)** (PV/EV/AC/SV/CV/CPI/SPI/EAC) · schedule health A–F score · shared read-only schedule link + iCal · xlsx/csv import · audit log · voice-to-schedule. *(Sub collaborator updates on shared schedules: `local-only`.)*

### Field Ops, Daily Reports & Photos
Daily field report (manpower, weather, incidents, toolbox talks, progress) + templates · time tracking (clock in/out, breaks, OT) · **punch list** (status/priority/photos) + **AI punch walk** (voice + photo→punch) + trade templates · **AI photo triage** (progress/problem/punch/reference) · photo annotator (markup) · shared photo timeline (tokenized, no login) · bulk photo gallery. *(Photos upload through a queue to Supabase storage — a prior silent-data-loss bug is fixed + guarded.)*

### Financial Management & Invoicing
Invoicing (line items, partial payments, tax) · bill-from-estimate · payment terms + **3-stage dunning** · **Stripe pay links** (first-send auto-generates a hosted payment page; webhook auto-reconciles) · **Stripe Connect** express onboarding (tier-based processing markup) · **AIA G702/G703** (correct SOV, this-period vs stored, retainage split) + companion AIA suite (G704/706/707/714/A401) · retainage release model · **Change Orders** (full approval workflow, multi-role approvers, AI impact analysis) · **Job Costing** (per-phase budget/committed/actual, EAC, overcommit warnings; variance correctly labels *over* as danger) · **Budget Dashboard** · **Margin Risk & Alerts** (real-time erosion, per-project risk score, proactive notifications) · **portfolio margin** · **Cash Flow Forecaster** (weekly, payment-terms timing, running balance, animated chart) · AI payment predictions · **WIP report** · profit-leak history · 1099 export · **lien waivers** (4 types + vault + e-sign).

### Subcontractor Management & Marketplace
Buyout dashboard · **bid-leveling matrix** · bid-questions engine · **prequal engine** (CGL, workers-comp, CG 20 10/20 37 endorsements, COI expiry, W-9) + renewal buckets (60/30/7/expired) · **magic-link prequal form** (no-login) · **COI vault & validator** · sub directory + **state license verification** · sub performance scorecard (from real job-cost data) · **sub portal** (no-login: scoped commitments, invoice submission, overpayment guard) · award-time risk gate (COI/prequal blockers, named override) · **RFP marketplace** (post RFP → subs bid → award creates commitment) · nearby-RFPs (sub view) · my-RFPs.

### Contracts, Approvals & E-Signature
Project contract lifecycle (draft/sent/signed/void) · **contract from estimate** (freeze price/scope) · **dual e-signature** (in-app pad, typed name, timestamp, SVG path) · versioning/superseded · **payment milestones** (triggers, %/amount) · **contract allowances** + **AI-curated selections** (options within allowance, homeowner picks, auto-deduct) · signed PDF with SHA-256 tamper hash.

### Client Portal (homeowner-facing)
Standalone web portal (`mageid.app`), GC-configured (toggle exactly what shows, optional passcode). Client sees timeline, budget (fixed / GMP / cost-plus modes), **photo timeline**, read-only schedule, **invoices + 1-tap Stripe pay**, **1-tap CO approve/deny**, **counter-sign contract**, **browse & pick selections** (allowance auto-deduct), **2-way messaging**. **6-language i18n**. Base64URL snapshot in URL for instant load.

### Project Docs & Closeout
**RFIs** (open/answered/closed/void, ball-in-court GC/architect/engineer/owner/sub, overdue clock, **hold-time analysis**) · **Submittals** (multi-round review cycles) + **AI spec-book extraction** · **OAC meeting minutes** (sectioned agenda auto-built from project state incl. RFI latency, action items) · **auto-compiled closeout binder** (punch/warranties/COI/waivers/selections/contract) · handover checklist · **11-month warranty walk** reminder · warranties + claims.

### Safety & Compliance
Incident reports (severity levels, OSHA 301/300A compatible) · toolbox talks · **JHA** (hazard/task matrix) · hazards log · safety inspections · certifications (OSHA 30/first-aid/CPR renewal tracking) · COI vault + prequal.

### Crew & Time
Crew roster (pay rate, W-9/I-9 storage) · **ID scan** (license/passport → structured data) · time tracking + entry detail (photos, opt-in GPS) · crew dispatch from Last Planner. *(Worker-profile / job-listing **Hire marketplace**: `gated` off — see §7.)*

### AI Brain / Copilot (~25 capabilities)
**Ask MAGE** (business-wide Q&A with citations) · **Project Memory** (per-project history Q&A, pgvector semantic + TF-IDF fallback) · drawing analyzer · compare-drawings · photo triage/→punch/→daily-report/→RFI · spec-book extraction · quick-estimate AI · living-estimate cost prediction · generative scheduler · schedule health check · bid scoring · CO impact AI · homeowner-friendly DFR summary · DOB/building-code lookup · plan intelligence · estimate calibration · Win Optimizer · **Connect Claude** (MCP server exposing the contractor's data read-only to Claude/any MCP client via personal access tokens) · construction-code answers (code check, permit roadmap, ADA, zoning, egress). *(Construction-answers feature depends on `ANTHROPIC_API_KEY` being deployed.)*

### Marketplace & Growth
**Public bid feed (SAM.gov)** (federal/state/municipal, geocoded, trade-filtered) · homeowner RFP marketplace · contractor sub-RFP · lead intake (voice + light CRM) · **public company profile** + **public project portfolio** (photos, URL) · public lead funnel ("request a quote" → Lead) · **"Built with MAGE ID" viral badge** on free-tier client emails. *(Referral program: `local-only`/future.)*

### Documents & Plans
Plan viewer (PDF/image, zoom) + **pin-drop markup & sketch** · multi-file plans library · project file storage (any type, folders/tags) · **PDF generation** (contract, invoice, G702/AIA, schedule, closeout) · selectively-shared docs to client.

### Analytics & Reporting
Portfolio dashboard · weekly snapshot · **universal search** (all entities, deep-link) · project-wide activity feed · WIP report · cash-flow forecast · A/R aging · margin trend.

### Onboarding & First-Run
Persona select · 2-screen onboarding wizard · **auto-seeded sample project** · interactive tutorial · **Next-Step Hero** (contextual "what to do next" on home) · onboarding paywall (after first real project) · onboarding-specialist booking (Calendly).

### Auth & User Management
Email/password · **native Google + Apple sign-in** · **magic link** · **biometric login** · password reset · **server-side account deletion** (GDPR/CCPA) · multi-project · **project collaborators** (owner/editor/viewer). *(Multi-user conflict resolution: `partial` — last-write-wins today.)*

### Notifications & Email
Expo push (opt-in per event) · Resend email (branded, **RFC 8058 one-click unsubscribe** + compliance table) · dunning · **daily digest** (location-aware sunrise) + weekly snapshot · in-app notification center.

---

## 6. What's deliberately **gated OFF** for launch

These exist in code but are intentionally disabled — treat as *product decisions*, not bugs:

- **Direct-Hire / in-app Messaging marketplace** (`HIRE_ENABLED = false`) — post-job/listings/applications/chat aren't wired to a real backend; "Post Job" is a write-only dead end. Multiple screens show "coming soon."
- **Paid per-RFP posting** (`RFP_PAID_POST_ENABLED = false`) — the one-off "pay per project" button is off until server-enforced Stripe billing exists (was a bypassable local credit). Homeowners see only subscription + free paths.
- **QuickBooks / Xero / FreshBooks / DocuSign / Procore etc. integrations** — the Integrations screen is **preview-only / mock** (no real OAuth/sync). A QBO OAuth stub exists but isn't complete.
- **Marketplace fintech perks** (supplier marketplace, inter-GC referral exchange, sub-bid network) — listed as "early access," not fully operational.
- **Client financing (Wisetack) & invoice factoring** — "early access"; redirect/callback edge functions exist but no partner is live.
- **COI/insurance marketplace matching** — vault + prequal are live; marketplace matching is deferred.

## 7. Integrations & real status

| Integration | Status |
|---|---|
| **Stripe / Stripe Connect** | Live (payments, pay links, tier-based processing markup) |
| **Supabase** | Live (backend, RLS, edge functions, magic-link auth) |
| **Google Gemini** | Live (default AI: takeoff, vision, drawing/spec analysis) |
| **Anthropic Claude Sonnet** | Live for Enterprise PDF takeoff (needs `ANTHROPIC_API_KEY` secret) |
| **RevenueCat** | Integrated, **but the production webhook secret is UNSET** → paid purchases don't unlock server-gated features (paid tiers effectively read as free server-side until configured) |
| **OpenWeather** | Integrated, **but no key configured** → weather is *simulated*; simulated days are tagged and the delay log **refuses** them (honest by design) |
| **Resend** | Live (email) · **Sentry** live (errors) · **Expo Push** live |
| **DocuSign / QuickBooks / Xero / Square / PayPal / Zelle / Home Depot Pro** | Mock / coming-soon (Integrations screen only) |

## 8. Honest caveats a reviewer should know

- **Not yet on the App Store publicly** — pre-launch. Web build auto-deploys.
- **RevenueCat webhook secret unset** → server-side tier unlock is currently non-functional (a config gap, not a code gap).
- **Weather is simulated** until an OpenWeather key is added.
- **Sub/OAC-meeting/plan-sheet/some collaboration data is `local-only`** (AsyncStorage, no cross-device/web sync yet).
- **Multi-user conflict handling is last-write-wins** (fine for single-operator; a gap for true team concurrency).
- **A native "premium visual tier"** (frosted glass, 60fps shared-element transitions, gesture sheets) is designed but not shipped; JS-only changes ship over-the-air.

## 9. Domain objects (the data model)

Project, Estimate (+ revisions, assemblies, cost samples), Invoice (+ payments), ChangeOrder, RFI, Submittal (+ review cycles), Commitment (PO), Contract (+ signatures, milestones, allowances, selections), DailyFieldReport, PunchItem, Photo, Permit, Warranty (+ claims), Lien Waiver, OACMeeting, Delay Event, Prequal Packet, Certification (COI), Company/Sub, Lead, Bid/RFP + Bid Responses, Crew Member, Time Entry, AIA Pay App, Schedule (tasks, deps, baselines, constraints), Notification, Portal Message.

---

## 10. Suggested gap-analysis lenses (for the reviewer)

When looking for gaps, consider:
- **Completeness of "live" flows** — does each feature go end-to-end, or dead-end (e.g., generated but not sendable, computed but not surfaced)?
- **Team / multi-user** — the app is single-operator-strong; where does real collaboration break (conflict resolution, real-time, roles)?
- **Cross-device / web parity** — what's `local-only` and therefore lost on reinstall or invisible on web/portal?
- **The gated subsystems** — Hire marketplace, real accounting sync (QuickBooks), financing — are these table-stakes for the target GC, and what's the cost of them being off?
- **Compliance/legal depth** — lien waivers cover ~38 states generically; AIA forms; are there jurisdiction gaps?
- **Notifications & follow-through** — are all the "should nudge" moments actually wired (e.g., payment-failure notifications are a known TODO)?
- **Onboarding-to-value** — how fast does a new GC get to a real bid / real margin insight?
