# MAGE ID — P3 Features Audit

**Date:** 2026-05-14
**Companions:** [pre-testflight-ux-audit](./2026-05-14-pre-testflight-ux-audit.md) (onboarding), [strategic-audit](./2026-05-14-strategic-audit.md) (pricing + discoverability + polish)
**Method:** 2 parallel research agents — granular feature matrix vs 6 competitors + 2026 construction-tech trends + Reddit/Twitter contractor-complaint scan.
**Lens:** Features specifically. What do JobTread / Houzz Pro / Buildertrend / Buildxact / Knowify / CompanyCam ship that we don't? Where do we already win? What would tip a switching customer over the edge?

---

## TL;DR — the inversion

**We thought we were the cheap option with a wedge. The data says we're the *most-featured* option that happens to be cheap.** Across 10 feature categories, MAGE ID wins on **5** (AI breadth, CPM scheduling, AIA G702/G703, payment prediction, multilingual client portal), is at parity on **4** (CRM, DFR, field tools, reporting), and loses on **1** (real integrations — QBO/DocuSign/Google Calendar are mock UIs today).

The implication for TestFlight: marketing copy that's anchored on "$29 starting price" is *underselling the product*. The actual story is "Procore-class CPM + Knowify-class AIA + best-in-class AI breadth — at 1/6 the price of any competitor." Lead with the features, mention the price last.

---

## Where we already win (don't talk about price first)

| # | Wedge | Why it's a wedge |
|---|---|---|
| 1 | **CPM with float + cycle detection + resource calendars** | Buildertrend's Gantt is drag-drop only. We're closer to Primavera than to Buildertrend. EVM (CPI/SPI) on top of it is unheard of in solo-GC software. |
| 2 | **Native AIA G702/G703 with retainage on stored + completed materials** | JobTread requires QuickBooks for this. Knowify charges $149/mo just for AIA. We bundle it. |
| 3 | **Voice parsers for every domain object** (Lead, RFI, CO, Submittal, Punch, Invoice, DFR, Estimate-line, Bid) | CompanyCam ships voice for DFR only. We ship 9. |
| 4 | **AI Payment Prediction** (per-invoice on-time probability + 7/14/30-day inflow forecast) | Nobody else ships this. |
| 5 | **Multilingual client portal with magic-link + auto weekly digest** (en/es/pt/zh/vi/fr) | Buildertrend portal is English-first, login-required. We meet homeowners where they are. |

---

## Where we lose (industry table-stakes we need)

1. **Real QuickBooks Online two-way sync** — **#1 dealbreaker in every competitor review**. Today it's a mock UI card. Block on this for any GC > $500k revenue.
2. **Estimate assemblies / cost catalog** — JobTread + Knowify win deals on this. We have line items but no rollup ("Bathroom rough-in" = N items at one click).
3. **Real DocuSign** (or Adobe Sign) integration — internal signatures don't fly with lenders + owner's reps on commercial work.
4. **Real Google Calendar push** for the schedule — Buildertrend ships, ours is a shell.
5. **A/R aging report screen** — data is there, no dedicated view; bookkeepers expect it.

---

## What the 2026 trends say

Five trends our agent identified as worth riding in the next 6 months:

1. **AI-generated weekly client updates.** Contractors spend 2-3 hours/week writing them; clients call when they slip. Feature: Friday-morning push notification — *"Tap to send this week's update to the Henderson project"* — with a pre-drafted paragraph quoting our own DFRs + a 6-photo collage + signed change orders + planned work. One tap, sent via the existing `PortalMessage` table. CompanyCam ships this — we don't.
2. **Voice-first field capture in field conditions.** Gloves + sun + truck noise. Hold-to-talk on DFR/PunchItem/RFI screens that parses *"framing crew off-site by 10, drywall delivery delayed to Thursday, owner wants pendants centered over the island"* into 3 structured records on 3 different screens. Plus an outdoor mode toggle with 56pt touch targets and a high-contrast palette.
3. **AI photo auto-tagging + progress %.** OpenSpace / DroneDeploy / Cupix detect installed work and compute % complete from photos. Their pricing locks out solo GCs. We have the infra — vision edge function + photo upload pipeline — and could ship 80%-accurate progress detection that beats human memory at 9 pm.
4. **One-tap lien waiver + payment-contingent collection.** When an Invoice is marked paid (Stripe Connect already wired), auto-generate the conditional waiver PDF, send via SMS link to the sub, lock the next pay-app until they sign. Compounds the Stripe Connect moat.
5. **Embedded LLM "field copilot" tied to project context.** Floating mic button on every project screen answers *"what was the spec on the kitchen tile in the Henderson job?"* from that project's RFIs, submittals, COs, and DFRs. Retrieval over the existing `tertiary_*` tables. No net-new schema.

---

## The loudest contractor complaints (Reddit / Contractor Talk / r/contractor)

Ranked by frequency of mention:

1. **"Estimate → invoice with margin live the whole way."** Buildertrend/Procore force re-entry and bury margin. Solvable with a single Estimate→Invoice→Margin lockstep flow.
2. **"Searchable project-tied text-message archive."** Crews live in iMessage/WhatsApp; nothing ties to the job. Feature: SMS-to-project ingestion via a Twilio number → logs to project timeline.
3. **"Subcontractor scheduling the sub can actually see."** Magic-link day-view per sub, no signup, "confirm you'll be there" + auto-reminder the night before.
4. **"Punch list with location pins, not just lists."** Tap a floorplan, drop a punch item. We have `PunchItem` + `DrawingPin` but no pin-on-plan UX wired for punch.
5. **"Data export they can trust."** The loudest BuilderTrend complaint: *"once it's in, you can't get it out."* One-click "Export Everything" (CSV + photo ZIP with project IDs preserved). This is a *switching-IN* feature — put it in marketing copy.

---

## Innovation moats (would create a switching cost)

| Moat | What it is | Why it locks in |
|---|---|---|
| **Project Memory** | Every photo, DFR, RFI, CO, message indexed into a vector store per project. User asks *"show me everything tile-related on Henderson"* or *"when did the framer say he'd be done?"* and gets answers from the project's own history. | Switching software = losing 2 years of searchable history. CompanyCam's 115% net retention is exactly this loop (just dumber — only photos). |
| **Owner Channel** | A branded, no-login web link per project for the homeowner. Weekly auto-update lands there, COs signable, photo gallery, payment portal. | The homeowner's only memory of the build lives there. They'll recommend the next contractor. |
| **One-tap insurance/warranty packet** | End-of-job, single PDF with every photo (geo + time stamped), every RFI/submittal, every signed CO, every lien waiver, every spec. | Sells the homeowner on the build. Protects the GC on warranty calls 18 months later. Nobody ships this well — 3-day build that earns the renewal. |

---

## Pre-launch polish — "this is serious software" in 30 seconds

Three small features that say *"actual engineers built this"* the moment a TestFlight tester opens the app:

1. **App-icon long-press → "New jobsite photo"** that opens directly to the camera with the most-recently-active project pre-selected. Photo saves offline to that project. This is the CompanyCam magic moment and it's a Quick-Action plist entry + offline-queue hook.
2. **Persistent offline-sync pill** at the top — *"3 changes queued · syncing in 12s"* — with a light haptic when sync completes. `expo-haptics` already wired. Single component that screams "serious."
3. **Real onboarding seed** — after sign-up, drop a fully-populated *"Sample Project — Maple Street Kitchen"* with 3 DFRs, 8 photos, a signed CO, an open RFI, a generated weekly update. Tester sees in 10 seconds what the app does at month 3, not what an empty DB looks like. (We have `utils/demoSeed.ts` — already half built.)

---

## Punch list — ranked for action

### TIER A — ship-now quick wins (each ≤ 1 day, all ship-able this session if you greenlight)

| # | Fix | Effort | What it does |
|---|---|---|---|
| 1 | **Profit-margin pill on every project card** on home tab | 2 hrs | `projectFinancials.ts` already computes it. Color chip next to status. Visible Day-1 KPI. |
| 2 | **A/R aging tile** on reports.tsx (0-30 / 31-60 / 61-90 / 90+) | 4 hrs | Pure UI over existing `Invoice[]` data. Bookkeepers expect this view. |
| 3 | **Schedule → .ics export** wired into a "Add to Calendar" button on schedule-pro | 1 hr | `utils/icsGenerator.ts` already exists. Sidesteps mock Google Calendar OAuth. |
| 4 | **Real demo-seed onboarding** — auto-drop "Sample Project — Maple Street Kitchen" with DFRs, photos, CO, RFI on first sign-up | 4 hrs | `demoSeed.ts` exists. Auto-run on first login. Eliminates the empty-dashboard problem. |
| 5 | **Persistent offline-sync pill** with haptic on completion | 3 hrs | Premium-feel signal. Reads as "serious engineering." |
| 6 | **Assembly stubs** — 8-10 hardcoded `EstimateAssembly` presets selectable in estimate-wizard | 6 hrs | Closes the JobTread/Knowify estimating gap for the TestFlight demo. |
| 7 | **App-icon long-press → camera shortcut** | 3 hrs | iOS Quick Action plist + offline-queue hook. CompanyCam-level magic. |
| 8 | **Read-only photo timeline link** — magic-link route shows photo gallery only | 6 hrs | Mimics CompanyCam Project Timeline. Visible TestFlight wow moment. |

### TIER B — bigger features (1-3 days each)

| # | Feature | Why |
|---|---|---|
| 9 | **AI Weekly Client Update — auto-draft + 1-tap send** | Trend #1 — competitors are racing to ship this. We have `weeklyClientUpdate.ts` already started. |
| 10 | **Field Copilot** — floating mic button on every project screen, answers questions using project's RFIs/COs/DFRs/photos via RAG | Moat #2. Sells the AI breadth we have. |
| 11 | **Punch-on-plan** — wire `DrawingPin` to PunchItem so you can drop a punch on a floorplan | Top-5 contractor complaint. Real differentiator. |
| 12 | **One-tap end-of-job warranty packet** | Moat #3. 3-day build. Earns the renewal. |
| 13 | **AI photo auto-tag + progress %** — when a photo uploads, edge function classifies and stamps the photo + auto-suggests a punch/DFR entry | Trend #3. Procore-class capability at solo-GC price. |

### TIER C — big strategic features (need real engineering or business decisions)

| # | Feature | Why |
|---|---|---|
| 14 | **Real QuickBooks Online sync** | The #1 missing must-have. Unlocks the $500k+ revenue GC segment. ~1 week. |
| 15 | **Real DocuSign integration** | Required for lenders and owner's reps on commercial work. ~3 days. |
| 16 | **Project Memory vector store** | Moat #1. ~2 weeks (vector store infra + retrieval edge fn + UI). |
| 17 | **SMS-to-project ingestion** via Twilio | Top-2 contractor complaint. ~3 days (Twilio inbound + parser). |
| 18 | **Sub magic-link scheduling** — passwordless day-view per sub | Top-3 contractor complaint. ~4 days. |

---

## Recommended ship sequence

**Right now (this session, ~1 day):** Tier A #1-#5 + #7. Six quick wins that change the TestFlight first-5-minutes impression. Each is low-risk, no business decisions, just engineering.

**Next session (~1 day):** Tier A #6 (assemblies) + #8 (photo timeline) — slightly bigger but visible.

**Following week (~3-4 days):** Tier B #9 (AI weekly update) + #11 (punch-on-plan). Two genuinely new features that close named gaps competitors charge $79-$249/mo for.

**Strategic, your call:** Tier C — QBO sync is the single biggest revenue unlock. Project Memory is the single biggest moat. Both need ≥1 week.

---

## Bottom line

We are NOT a cheap-features startup. We are a **feature-leading** startup that happens to be cheap. The marketing copy + the onboarding + the comparison page all need to flip to reflect that. The product can carry the price.

Six features ship-able tonight would close the "looks unfinished" gap for TestFlight. Two more this week would close the "missing what JobTread has" gap. The actual lock-in plays (Project Memory + Owner Channel + Warranty Packet) are 2-4 weeks of work each but the payoff is generational retention.

---

### Source references

**Competitive feature data:** [JobTread vs Buildertrend](https://constructionbids.ai/blog/jobtread-vs-buildertrend-comparison), [Houzz Pro AutoMate](https://pro.houzz.com/for-pros/takeoff), [Buildertrend 2026 review](https://advancetec.co.uk/buildertrend-software-review-2026-features-integrations-pricing-pros-cons-for-modern-builders/), [Buildxact features](https://www.buildxact.com/us/features/construction-scheduling-software/), [Knowify AIA billing](https://knowify.com/aia-billing/), [CompanyCam features](https://companycam.com/features)

**2026 trends + contractor research:** [Autodesk 2026 AI trends](https://www.autodesk.com/blogs/construction/2026-ai-trends-25-experts-share-insights/), [CompanyCam AI reporting tools](https://companycam.com/resources/blog/4-ai-tools-that-generate-reports-without-typing-a-word), [Audio FastFill voice capture](https://www.fulcrumapp.com/blog/audio-fastfill-field-data-capture-using-voice-dictation/), [Siteline lien waiver](https://www.siteline.com/feature/lien-waiver-management-software), [OpenSpace visual intelligence](https://www.openspace.ai/), [DroneDeploy AI progress](https://www.dronedeploy.com/blog/ai-construction-software-that-tracks-progress-without-adding-work), [Six Construction Tech Startups Raise $126M](https://www.constructionowners.com/news/contech-startups-raise-126m)

**Contractor wishlist (Reddit / Contractor Talk / Davron):** [Why Reddit is Wrong (RemodelFin)](https://remodelfin.com/guides/remodeling-software-reddit-consensus/), [BuilderTrend price hike thread](https://www.contractortalk.com/threads/buildertrend-price-hike.447579/), [Construction software data migration](https://projul.com/blog/construction-software-data-migration-guide/), [Best Construction Apps Crews Like (Davron)](https://www.davron.net/best-construction-apps-crews-like-using/), [Field worker app design (Tinderhouse)](https://tinderhouse.com/field-worker-app-development)
