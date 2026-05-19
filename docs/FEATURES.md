# MAGE ID — Feature Sheet (Research Brief)

> **Purpose:** A complete, code-grounded inventory of the MAGE ID app for external deeper research (competitive / market / strategy). Generated from the actual shipped code at production `main` (worktree `p0-on-main` @ `4faf94b`, 2026‑05‑19), not from marketing. **The "Maturity & What's NOT Built" section near the end is the single most important part for honest research — read it.**

---

## 1. What MAGE ID is

A mobile‑first **construction management operating system for general contractors** — primarily the solo / small residential & light‑commercial GC. React Native / Expo app (iOS primary, Android + web), Supabase backend, RevenueCat‑gated subscription tiers. Positions against both thin "photo + invoice" apps (CompanyCam/Jobber) and heavy enterprise PM (Procore/Buildertrend): "engine depth a $10/mo app can't ship, in your pocket."

**Scale of surface:** ~60 routes/screens, a 30‑section project hub, ~190 domain types, ~80 RLS‑protected Postgres tables, 32 Supabase edge functions, 7 scheduled jobs, a standalone homeowner web portal, a sub portal, and a marketing site.

---

## 2. Tech stack & architecture

- **Client:** React Native + Expo Router 6 (typed routes), TypeScript strict, New Architecture on. Bundle IDs `com.mageid.app` (iOS, primary, no iPad), `app.mageid.android`. Web supported (secondary).
- **State:** zustand (UI), @tanstack/react-query (server), `@nkzw/create-context-hook` context providers. `ProjectContext` is split into 7 contexts (CoreData / Financials / Field / Precon / Docs / StableActions / CrossDomain) for render isolation; plus Auth, Subscription, Bids, Companies, Hire, Notification, Theme, MaterialCart.
- **Backend:** Supabase — Postgres + RLS (anon key, RLS‑enforced), Deno edge functions, pg_cron/pg_net. No tRPC (a tiny unused Hono proxy exists but is not the runtime backend).
- **Offline‑first:** all writes go through an optimistic bounded offline queue (`utils/offlineQueue.ts`), flushed on reconnect.
- **Distribution:** EAS — OTA JS updates on `production`/`preview` channels (runtime‑version policy = `appVersion`; native build only on version bump). Deep‑link scheme `rork-app://`; homeowner portal served at `mageid.app` via Netlify.
- **AI:** server‑side relays to Google Gemini (2.5 flash/pro) and Anthropic Claude (Sonnet 4.5 for Enterprise takeoff), metered + tier‑gated.

---

## 3. Feature taxonomy

### 3.1 Onboarding & first‑run
2‑screen onboarding → auto‑seeded sample project → home with a "where do I start" hero (`NextStepHero`), an onboarding checklist, and a re‑openable interactive tutorial. Post‑onboarding paywall (gesture‑locked) re‑shows only after a real (non‑sample) project exists. Auth: email/password, Google & Apple native sign‑in, magic link (branded email), biometric login, password reset, server‑side account deletion (Apple 5.1.1(v)).

### 3.2 Project lifecycle & hub
`project-detail.tsx` is a tile‑grid hub opening **30 section modals**: linked estimate, materials, labor, summary, schedule, notes, collaborators, change orders, invoices, daily reports, punch list, RFIs, submittals, OAC meetings, budget, photos, client portal, communications, activity, calendar, plans, permits, contract, selections, lien waivers, closeout binder, handover, time tracking, project files, scope. Cross‑project surfaces: portfolio dashboard, weekly snapshot, report inbox (search all artifacts), activity feed, notifications inbox, smart inbox.

### 3.3 Estimating — **deep**
Assembly estimator (`estimate/index.tsx`, the largest screen): 164 assembly items, full material DB, labor rates (crew/output/wage‑type), productivity & sq‑ft cost references, 7+ templates, regional/ZIP pricing factors. User‑authored **custom assemblies** and **rate overrides** (own labor $/hr, material unit price). **Estimate versioning**: immutable revision snapshots with typed change reasons, per‑CSI‑division diff, undoable restore; single source of truth (`effectiveEstimateTotal`). AI quick‑estimate wizard, quantity takeoff (LF/SF/EA/CY), AI estimate from a drawing, AI revision‑diff (drawing compare → CO/RFI).

### 3.4 Scheduling / CPM — **deep (genuine CPM)**
Real critical‑path engine (`utils/cpm.ts`): forward/backward pass, ES/EF/LS/LF, total & free float, FS/SS/FF/SF + lag, cycle detection, topo sort, **resource leveling**, **anchor constraints** (SNLT/FNLT/MSO/MFO with drift reporting), target‑finish negative float. Reflow‑from‑actuals, named/multi baselines + baseline diff, weather‑ripple, fragnets/LOE/resource calendars, A–F schedule health score, AI auto‑schedule from estimate, Gantt UI, public read‑only shared schedule (tokenized URL), iCal feed.

### 3.5 Financials — **deep**
- **Invoicing:** create/send, first‑send Stripe pay‑link, partial payments, bill‑from‑estimate, dunning (3‑stage automated reminders).
- **AIA billing:** correct **G702/G703** with SOV, this‑period/stored materials, **retainage split (completed vs stored)**, current‑payment‑due less prior certificates; plus G704/G706/G706A/G707/G714/A401 form suite.
- **Change orders:** approval workflow + audit, budget bump propagation.
- **EVM:** BAC/PV/EV/AC/SV/CV/CPI/SPI/EAC/ETC/VAC (correct formulas).
- **Cash flow:** weekly forecast with payment‑terms timing, CO‑aware projected income (confidence tiers), recurring expenses, running balance.
- **Job costing:** per‑phase budget/committed/actual, EAC per phase, overcommit detection.
- Also: retainage release model, lien waivers (5 types), 1099 export, payment‑prediction (AI), WIP/profit/A‑R‑aging reports, **Stripe Connect** (Express onboarding, server‑side pay links, signature‑verified webhook reconcile, tier‑based processing markup 1.0%→0.4%).

### 3.6 Subcontractor management — **engine deep, enforcement partly decorative (see §8)**
Buyout dashboard (savings KPI), bid‑leveling matrix + bid‑questions engine, **prequal engine** (`utils/prequalEngine.ts`: CGL occ/agg, workers‑comp, CG 20 10/20 37 endorsements, COI expiry blocker/advisory, W‑9, EMR safety, years‑in‑business; renewal buckets 60/30/7/expired), COI vault/validator, sub directory with state‑license‑board verification, magic‑link sub prequal form (no login). Award‑time risk gate on buyout (COI/prequal blockers → named, dated, two‑step acknowledged override recorded on the commitment).

### 3.7 Field ops — **deep**
Daily field reports (manpower/weather/incident/toolbox‑talk/work‑progress + AI homeowner summary), time tracking (breaks), punch list + voice "punch walk" + AI photos→punch, photo triage (AI classifier), photo annotator (markup), public photo timeline (tokenized), plans library + pin‑drop plan markup/calibration, permit & special‑inspection tracker.

### 3.8 Project docs
RFIs (ball‑in‑court + overdue clock), submittals (review cycles) + AI spec‑book extraction, OAC meetings (agenda/action items), contracts (proposal from a frozen estimate revision, milestone schedule, dual e‑signature, versioning), selections/allowances (AI), auto‑compiled closeout binder, handover‑day checklist, 11‑month warranty walk + claims.

### 3.9 Homeowner client portal — **deep**
Standalone static page at `mageid.app` (base64url snapshot in URL + Supabase fallback; GC toggles exactly what's shown; optional server‑validated passcode). Client can: view a live project timeline, browse a **photo timeline with lightbox** (day‑grouped, prev/next nav), see schedule/budget/invoices, **pay an invoice** (Stripe hosted link), **1‑tap approve change orders**, **counter‑sign the contract**, **choose selections/allowances**, **2‑way message the GC**, in 6 languages. Hardened write path: SECURITY DEFINER RPCs scoped by enabled portal ID (no raw anon writes).

### 3.10 Subcontractor portal
GC‑configured no‑login link (Business‑tier): sub sees scoped commitments (contract/paid/balance), submits invoices, sees GC review state, assigned punch items + their schedule slice. GC side has an overpayment guard (blocks paying past commitment + COs, override‑able).

### 3.11 Marketplace & business development
Public‑bid feed (SAM.gov federal/state/municipal, geocoded), homeowner‑RFP marketplace (post RFP, nearby‑contractor fan‑out, bid responses, atomic award), hire marketplace (job/worker listings + Supabase Realtime chat), voice lead intake + lightweight CRM, company/public profiles, materials catalog, equipment tracking + utilization, supplier marketplace, "Discover" hub.

### 3.12 AI features (the AI surface)
~25 catalogued AI capabilities behind a server relay + rate limiter: cost estimating, takeoff, schedule build, drawing→estimate, drawing revision compare, photo triage/→punch/→DFR/→RFI, spec‑book extraction, DFR & homeowner‑summary generation, bid scoring, CO impact, a construction "Copilot", DOB/building‑code check. Vendor‑tiered (Gemini flash → Gemini pro → Claude Sonnet 4.5 for Enterprise). **Per‑tier metering**, server+local monotonic merge (closes reinstall‑abuse), structured paywall deep‑link reasons.

### 3.13 Cross‑cutting
**Offline‑first** bounded queue (1000 FIFO, 5 retries, terminal‑error drop, ordered, bounded concurrency). **Notifications/email**: Expo push + Resend, branded templates, RFC 8058 one‑click List‑Unsubscribe + `email_unsubscribes` compliance, pre‑send unsubscribe guard. **Universal search** across all entities + deep‑link any entity. **Theming** (light/dark/system).

---

## 4. Subscription tiers & monetization

RevenueCat IAP. Product IDs `com.mageid.<tier>.<period>`; entitlements `pro`/`business`/`enterprise`; rank free=0/pro=1/business=2/enterprise=3 (higher satisfies lower). Master‑email override forces Business. Server‑side `requireTier` mirrors the client gate (rank‑based, fail‑safe to free).

| | **Free $0** | **Pro $29/mo** | **Business $79/mo** | **Enterprise $150/mo** |
|---|---|---|---|---|
| Projects, manual estimates, manual daily reports | ✓ | ✓ | ✓ | ✓ |
| AI estimator/takeoff/schedule, voice‑to‑report, AI photo triage, cash flow + EVM, AIA G702/703, change orders + invoicing, equipment, **client portal** | — | ✓ | ✓ | ✓ |
| Subcontractor mgmt, punch/closeout, RFIs & submittals, full budget dashboard, plan viewer | — | — | ✓ | ✓ |
| AI/day · advanced/day · drawings/mo · photos/mo | 5·—·—·— | 30·6·15·50 | 80·18·50·150 | 150·40·100·200 |
| Stripe processing markup | 1.0% | 0% | 0.5% | 0.4% |

**Note for research:** Enterprise has **identical features** to Business — its only differentiator is higher AI caps (stated in the paywall). Fintech perks shown as "Early access" (financing/factoring/payouts/sub‑bid network/COI marketplace) are aspirational, not shipped.

---

## 5. Integrations — real vs stub

- **Real:** Supabase (DB/auth/edge), RevenueCat (IAP), Stripe Connect (Express onboarding, pay links, signature‑verified webhook), Resend (transactional + digest email, unsubscribe compliance), Expo Push, Google & Apple sign‑in, CloudConvert (PDF→image), Gemini + Claude (AI), SAM.gov / Adzuna / Google Places (cached external data), iCal feed, weather.
- **Stub / "PREVIEW" (no OAuth, no sync):** `app/integrations.tsx` is entirely mock — QuickBooks, Xero, FreshBooks, Square, DocuSign all show a waitlist alert. Procore/Buildertrend/PlanGrid "Coming Soon." Material‑vendor "integrations" (Home Depot/Lowe's/Ferguson) are plain web links.
- **Dormant (infra without partner):** financing — `financing-redirect`/`financing-callback` edge functions exist but fail‑closed (no partner, no secret); MAGE is explicitly "not a lender." No financing CTA is surfaced anywhere in the app or portal.

---

## 6. Backend & infrastructure (summary)

32 Deno edge functions: AI text relay + 5 vision functions, Stripe (connect‑onboarding/status, create‑payment‑link, stripe‑webhook), email (send‑email, notify, unsubscribe, magic‑link), RFP award, nearby‑contractor fan‑out, account deletion, portal passcode validation, iCal. **7 scheduled jobs** (pg_cron): COI‑expiry watch (daily), invoice dunning (daily), homeowner weekly digest (Fri), GC daily digest, per‑user morning digest (30‑min slots), external‑data fetch (6h), bid geocoding (hourly). ~80 RLS‑protected tables. Server tier enforcement with per‑tier/feature monthly caps backed by SQL RPCs. Portal contract‑forgery vector closed via SECURITY DEFINER RPCs + dropped permissive anon policies (H4 hardening).

---

## 7. Platforms & distribution

iOS primary (`com.mageid.app`, phone‑only), Android (`app.mageid.android`), web secondary. EAS OTA on `production`/`preview` channels; JS‑only changes ship without an app‑store review (runtime policy `appVersion`). Homeowner portal is a static page deployed to `mageid.app` via Netlify (currently published via a build‑credit‑independent direct‑deploy path).

---

## 8. Maturity, known gaps & what is explicitly NOT built (READ THIS)

Internal audits (2026‑05‑16 launch‑readiness/orientation, 2026‑05‑17 feature‑depth, 2026‑05‑19 consolidated re‑audit) are blunt; for honest research, treat the following as ground truth:

**Genuinely deep & real (research these as the actual product):** CPM scheduling (float/leveling/anchors/weather‑ripple), AIA G702/G703 + retainage + partial payments + form suite, the assembly estimator + estimate versioning/diff, EVM (CPI/SPI/EAC), job costing, the offline‑first queue, the prequal/COI engine, the realtime homeowner portal with true 2‑way messaging and 1‑tap CO approval, Stripe Connect payments.

**Thin / decorative / soft (audit's words: "demos like a 9, protects/delivers like a 4"):**
- Sub‑risk *enforcement* was historically decorative — the COI/prequal/lien engines compute correctly but a recent fix added a real award‑time risk gate; payment‑path and per‑project hard policy enforcement remain future work.
- Phase attribution for job‑cost/EVM is best‑effort string‑matching on estimate `category` / CO `description` (math is correct; tagging is soft).
- Contract e‑signature stores a signature stroke string, not a rendered/legally‑formatted signed PDF.
- The project hub is a large filing‑cabinet of tiles (orientation friction for new users — partly mitigated by recent first‑run wiring fixes).

**Explicitly NOT built (do not research as if it exists):**
- **Financing / funding / factoring / capital advances** — does not exist as a user feature. Edge‑function infra is dormant; MAGE is not a lender; no CTA anywhere. (The app's owner specifically flagged this confusion; the audit's decision was to NOT surface it pre‑launch.)
- **Accounting sync (QuickBooks/Xero/etc.)** — preview/waitlist only, no OAuth, no data sync.
- **Enterprise‑tier feature differentiation** — none beyond higher AI usage caps.
- Material‑vendor live ordering, Procore/Buildertrend/PlanGrid integrations — "coming soon" placeholders.

**Stage:** Pre‑broad‑TestFlight. The 2026‑05‑19 consolidated re‑audit returned **GO** (zero launch‑blockers; type‑check clean); prior launch‑gate items (first‑send pay button, first‑run de‑clutter, estimate→project wiring, dead routes, silent client‑message loss, the H4 portal security hole) are verified fixed. Open items are product decisions, not defects: free‑tier feature‑wall framing for testers, and whether to gate the dormant financing infra.

---

## 9. Suggested angles for deeper (Gemini) research

1. **Competitive positioning:** MAGE's "engine depth on mobile" vs CompanyCam/Jobber (thin, high adoption) and Procore/Buildertrend (deep, heavy, expensive) — is the solo/residential GC segment willing to pay $29–$79/mo for AIA/EVM/CPM depth in a phone app?
2. **Pricing:** Is the Free→Pro→Business→Enterprise ladder coherent given Enterprise = Business + higher AI caps only? What do comparable tools charge for AIA billing / CPM / client portal?
3. **The AI angle:** ~25 AI features with metered tiers — competitive AI feature/limit benchmarking vs Buildertrend AI, Knowify, Beam AI, etc.
4. **The honest gap:** the "decorative sub‑risk / no financing / no accounting sync" reality vs how competitors monetize compliance, lien waivers, and embedded fintech — is the unbuilt fintech a real wedge or a distraction?
5. **Go‑to‑market:** invite‑gated access + TestFlight; activation benchmarks for construction software (time‑to‑first‑value, onboarding completion) — the audits cite Hick's Law / the jam study; validate against current 2025–2026 SaaS onboarding data.

---

*Generated 2026‑05‑19 from `main` @ `4faf94b` via a 4‑way parallel code audit. Every claim is grounded in shipped source; the §8 honesty section deliberately separates real product from marketed‑but‑unbuilt so downstream research targets reality.*
