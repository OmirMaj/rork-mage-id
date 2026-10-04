# App Store Connect — listing copy + demo script (launch-ready)

Profit-first ASO, aligned with the homepage rewrite ("Win the bid. Keep the profit."). Paste into **App Store Connect → My Apps → MAGE ID → iOS App → [version] → App Information / Version Information**. Char counts are approximate — **re-verify in App Store Connect**, which counts `•`/`—`/`→` as one character each.

**Submit reference:** app `6762229238` · team `HKT2J284D2` · bundle `com.mageid.app` · Support URL `https://mageid.app/support` · Marketing URL `https://mageid.app` · Privacy Policy URL `https://mageid.app/privacy` · Terms of Use `https://mageid.app/terms`.

**Terms of Use / EULA (guideline 3.1.2):** MAGE ID uses Apple's standard EULA. An app that sells auto-renewing subscriptions must still show a working Terms of Use link in the App Store listing, so the description below ends with the `Terms of Use:` line. Leave App Store Connect's custom EULA field empty. `marketing/terms.html` covers auto-renewal and Apple's terms.

**Build:** submit **build 18** (cut from main after the 2026-10-03 App Store wave: green icon and splash, location "Always" strings removed). Never submit build 17.

---

## App Name (30 chars)

```
MAGE ID: Contractor Estimates
```
(29) — keeps the brand first, then the highest-intent keyword phrase.

**Alternates to test:**
- `MAGE ID — Bids & Job Costing` (28)
- `MAGE ID: Estimate & Margin` (26)

---

## Subtitle (30 chars)

```
Estimate, job cost & margin
```
(27) — three high-intent keywords; "margin" is the differentiator no competitor owns.

**Alternates:**
- `Bids, job costing & margin` (26)
- `AI that protects your margin` (28)

---

## Promotional text (170 chars · editable WITHOUT re-submitting the build)

```
Win the bid — then keep the profit. MAGE learns your real costs from past jobs and warns you before a live job loses margin. The only app that prices from YOUR numbers.
```
(167) — the single highest-leverage field: it updates without a new build, so keep it pointed at the moat and refresh it whenever you ship something new.

---

## App description (4000 char limit · first 3 lines are what's visible "above the fold")

```
Win the bid. Keep the profit.

MAGE ID is the margin-protection app for residential general contractors and remodelers. Unlike tools that just organize your job, MAGE learns your real costs from finished jobs, prices your next bid off your own numbers, and warns you the moment a live job starts bleeding margin.

Most contractors don't lose money on bad jobs — they lose it on good jobs they bid wrong. MAGE is built to stop that.

ESTIMATE & WIN
• Cost Database — your unit prices, learned from every job you close, so your next bid is priced from your reality, not a generic catalog.
• AI estimate from a sentence or a plan PDF — drop drawings, get priced line items in under a minute.
• AI Quantity Takeoff — measures linear feet, square feet, doors, windows, and bulk materials off the sheet; verify in the field.
• Smart Proposals — good/better/best tiers, priced to win, that train on whether you actually win.

PROTECT YOUR MARGIN
• Margin Risk score — a live, per-job read that flags erosion early, so you defend profit during the job, not after.
• Job costing & cash flow — budget vs. actual by cost code, live. Know which job is making money.
• A schedule that holds — critical path, plus weather auto-reschedule and Last Planner pull planning, because a slipped schedule is a blown margin.

RUN THE FIELD
• Voice-to-log daily reports, geo-stamped photos, RFIs, submittals, and punch lists — all offline-capable.
• Plans & markup — calibrate scale, drop pins, link photos and RFIs to drawing locations.

GET PAID
• AIA-style G702/G703 pay apps — schedule of values, retention, change-order roll-up, e-sign export. One screen.
• Change orders with an approval trail; invoicing with Stripe; lien waivers built in.

YOUR CLIENT, KEPT IN THE LOOP
• Live homeowner portal — AI daily digest in plain English (six languages), contract & selection e-sign, zero app to install.

ONE FLAT PRICE — SUBS ARE FREE
• Free — ship your first project, try every flow.
• Pro ($29/mo) — owner-operator GC.
• Business ($79/mo) — small office, deeper AI.
• Enterprise ($150/mo) — for larger teams.
No per-seat fees. No implementation cost. No sales call. Cancel anytime in the App Store.

WHO IT'S FOR
Residential GCs, remodelers, custom-home builders, and small-commercial GCs running 4–20 jobs — the owner who's still on a ladder twice a week. If you run a $50M+ shop with a full back office, you'll outgrow this; go talk to the enterprise tools.

PRIVACY
Your data is row-level scoped to your account and encrypted in transit and at rest. The homeowner sees only what you publish to the portal. We don't sell your personal information.

SUPPORT
Tap Help in Settings for a real person. Works on iPhone and the web.

Terms of Use: https://mageid.app/terms
Privacy Policy: https://mageid.app/privacy
```
(~2,800 chars — comfortably under 4,000; re-verify in ASC.)

---

## Keywords (100 chars · comma-separated, no spaces after commas)

```
contractor,estimate,takeoff,job costing,margin,remodel,builder,invoice,schedule,bid,AIA pay app,WIP
```
(≈99) — highest-intent terms; "margin" + "job costing" + "AIA pay app" are the differentiator/buyer-intent terms. Apple stems plurals and indexes the description, so we skip generic "construction."

**Don't include:** competitor brand names (Apple rejects), "free"/"best" (stripped), plurals (auto-stemmed).

---

## What's New (4000 chars · per release)

### Version 1.0.0 — launch
```
Welcome to MAGE ID — the app that helps you win the bid and keep the profit.

• Cost-learning estimates — your finished jobs teach MAGE your real prices, so every bid gets sharper.
• Margin Risk — a live score that warns you before a job loses money.
• AI estimate from a sentence or a plan PDF, plus on-screen quantity takeoff.
• Scheduling with critical path, weather auto-reschedule, and Last Planner pull planning.
• AIA-style G702/G703 pay apps, change orders, invoicing, and lien waivers.
• Voice-to-log daily reports, RFIs, punch lists — offline-first.
• Live homeowner portal with a plain-English daily digest in six languages.
• One flat price. Subcontractors are free. No per-seat fees.

Questions or feedback? Tap Help in Settings — a real person replies.
```

---

## Privacy Nutrition Label (App Store Connect → App Privacy)

Declare these to match the privacy policy at mageid.app/privacy (updated 2026-10-03 with Location, Voice recordings, Crash reports and session replay, AI providers and Purchases sections). For each, Apple asks: collected? linked to identity? used for tracking?

**Tracking: No.** We do not track across other companies' apps or websites, and there is no ad SDK, so answer "No" to "Do you or your third-party partners use data for tracking?" and "Used for Tracking: No" on every row below.

| Apple data type | Collected | Linked to user | Purpose | Where it comes from |
|---|---|---|---|---|
| Contact Info → Name, Email Address | Yes | Yes | App Functionality | Sign-up, profile |
| Contact Info → Phone Number | Yes | Yes | App Functionality | Your company profile phone (shown on estimates, invoices and the portal) |
| Contact Info → Physical Address | Yes | Yes | App Functionality | Your company profile office address (shown on estimates, invoices and the portal) |
| Contact Info → Other User Contact Info | Yes | Yes | App Functionality | Client / subcontractor / crew phone numbers and addresses you enter |
| Health & Fitness → Health | Yes | Yes | App Functionality | Safety incident reports: injury, injury description, treatment (first aid / medical), OSHA illness type |
| Location → Precise Location | Yes | Yes | App Functionality | GPS stamp on jobsite photos, field-verified takeoff rows and signed field tickets, only when allowed and only on a tap (when-in-use only; never in the background) |
| User Content → Photos or Videos | Yes | Yes | App Functionality | Jobsite photos, plan sheets |
| User Content → Audio Data | Yes | Yes | App Functionality | Voice dictation and meeting audio, sent for transcription (Rork speech-to-text), not stored on our servers |
| User Content → Other User Content | Yes | Yes | App Functionality | Projects, estimates, invoices, daily reports, RFIs, documents, AI prompts (sent to Google Gemini / Anthropic Claude); card numbers never reach us (Stripe / Apple) |
| Identifiers → User ID | Yes | Yes | App Functionality, Analytics | Account ID (also keys PostHog events and RevenueCat) |
| Purchases → Purchase History | Yes | Yes | App Functionality | Subscription status via RevenueCat / App Store |
| Usage Data → Product Interaction | Yes | Yes | Analytics | PostHog events |
| Diagnostics → Crash Data | Yes | Yes | App Functionality | Sentry crash reports (IP collection off, no `Sentry.setUser`, but each report carries recent console log lines that can include an email) |
| Diagnostics → Performance Data | Yes | Yes | App Functionality | Sentry traces (10% sample), which can carry the same log breadcrumbs |
| Diagnostics → Other Diagnostic Data | Yes | Yes | App Functionality | Sentry session replay: every error session + 10% of sessions, all text / images / graphics masked on device; replays carry the same log breadcrumbs |

"Linked to user: Yes" on the three Sentry rows is the conservative answer to what the code does today. `app/_layout.tsx` sets `sendDefaultPii: false` and never calls `Sentry.setUser`, but `enableLogs: false` only turns off the separate Sentry Logs product: @sentry/react-native 7.2.0 still adds `breadcrumbsIntegration()` with `console: true` and `xhr: true` by default, so recent console.log/warn lines and request URLs ride along on every error event, and the codebase logs emails in `[Auth]` / `[RC]` / `[Subscription]` lines (the `_layout.tsx` comment says so). The policy discloses this. These rows may go back to "No" only after `Sentry.init` passes `Sentry.breadcrumbsIntegration({ console: false })` (owner of `app/_layout.tsx`) and the logs are checked, and nobody has added `Sentry.setUser`.

Processors to keep consistent with the policy: Supabase, Stripe, RevenueCat, PostHog, Resend, Sentry, Apple/Google, Google (Gemini) and Anthropic (Claude) for in-app AI, Rork for speech-to-text. **Account deletion** is in-app (Settings → Delete Account) — Apple requires this and it's already wired.

---

## App Preview video (App Store · 15–30 sec, optional — converts ~25% better)
No voiceover; captions hard-coded; lead with the moat.
- 0:00–0:04 — open app → a Margin Risk alert on a live job ("This job is slipping.")
- 0:04–0:12 — Estimate Wizard → cost database → priced estimate built from *your* numbers
- 0:12–0:20 — Schedule: rain hits, weather auto-reschedule moves the job
- 0:20–0:30 — AIA pay app / portal e-sign → end on the pricing card ("Free to start")

---

## 90-second demo video (for the /demo marketing page) — §4
Record on your phone or screen — authenticity beats polish. No fancy production needed.

| Time | Say this | Show this |
|---|---|---|
| 0:00–0:10 | "Most contractors don't lose money on bad jobs — they lose it on good jobs they bid wrong. Here's how MAGE stops that." | App home, then a Margin Risk alert |
| 0:10–0:35 | "I describe the job, and MAGE builds the estimate off MY real costs from past jobs — not a generic catalog." | Estimate Wizard → cost database → estimate |
| 0:35–1:00 | "Once the job's running, MAGE watches every dollar. The second margin starts slipping, it tells me — while I can still fix it." | Margin Risk score + an erosion alert |
| 1:00–1:20 | "Weather reshuffles the schedule automatically, so a rained-out week doesn't blow my margin." | Weather auto-reschedule on the Gantt |
| 1:20–1:30 | "One flat price, subs are free, first project's on us. Link below." | Pricing + CTA card |

---

## Screenshots checklist (App Store requires real UI — not marketing mockups)
- 6.5" and 6.7" iPhone sets required. No iPad (`ios.supportsTablet: false`).

Recommended 10, in order — lead with the moat:
1. **Margin Risk alert** — "Find out a job's slipping while you can still fix it."
2. **Estimate from your cost database** — "Bid off your real costs, not a catalog."
3. **AI estimate from a plan PDF** — "Priced estimate in under a minute."
4. **Quantity takeoff** — "Measured off the sheet."
5. **Schedule + weather reschedule** — "Rain moves the job for you."
6. **Cash-flow dashboard** — "Know which job is making money."
7. **AIA-style pay app** — "AIA-style G702/G703, one screen."
8. **Daily report (voice)** — "Voice-to-log in 30 seconds."
9. **Client portal** — "Six languages. Zero app to install."
10. **Pricing/onboarding** — "Free to start. Subs free."

Generate from the real app (phone screenshots or Apple's Preview Builder). App Store guidelines require screenshots reflect actual UI. Capture them from **build 18 on an iPhone**. For shot 9, show the portal as the iPhone app presents it (publishing / previewing the portal), not the web portal page in a browser: a screenshot of something that isn't the iOS app fails 2.3.3. Skip any desktop-only screen (the DCMA schedule check is desktop-only on iPhone).

---

## Version-bump cadence
Runtime version is `appVersion`-locked, so ship JS-only changes via OTA on the `production` channel against the same `1.0.x` build. Bump `expo.version` + re-submit only for: new native modules, entitlement changes, or a major UX overhaul worth a marketing push.
