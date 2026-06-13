# App Store Connect — metadata copy

Drop these into **App Store Connect → My Apps → MAGE ID → Distribution → iOS App → Version Information**. All character counts include spaces; counts are App Store Connect's own limits as of 2026.

---

## Subtitle (30 chars)

```
AI that protects your margin
```

(28 chars · 2 free) — leads with the moat (margin defense), the one thing no competitor does.

**Alternates** if you want to test:
- `Your prices. Your margin. AI.` (29)
- `GC ops, AI takeoff & pay apps` (29 — prior subtitle)
- `The GC's pocket back office` (27)
- `Built for builders, on iPhone` (29)

---

## Promotional text (170 chars · updateable without re-submission)

```
NEW · Your estimate now learns from every job you close — and warns you before a job loses money. The only GC app that prices from YOUR costs, not a generic catalog.
```

(162 chars · 8 free) — the moat as the freshest hook. This is the single highest-leverage field: it updates WITHOUT re-submitting the build, so keep it pointed at the differentiator.

Use this slot for the freshest hook — change it whenever you ship something new. It's the ONLY editable field that updates without re-submitting the build.

---

## App description (4000 char limit · ~3500 used)

```
MAGE ID is the operating system for general contractors — built for the residential and small-commercial GC running $1M–$30M jobs from the truck, not the corner office.

Plans, estimates, daily reports, change orders, AIA pay applications, schedule, and a live homeowner portal — replaced a dozen apps with one that lives on your phone. Voice-driven everything. AI where it actually saves you hours. Built mobile-first because that's where the job is.

THE DIFFERENCE — IT LEARNS WHAT YOUR JOBS REALLY COST
Other apps price your bid off a generic catalog (Home Depot, regional averages). MAGE learns from your own closed jobs — every estimate gets sharper — and watches your margin live, warning you before a job loses money. Bid from your reality, not an AI's guess.

WHAT'S INSIDE
• Cost Database — your unit prices, learned from every job you close, so your next bid is priced from your reality.
• Margin Intelligence — live projected margin, a per-job risk score, and alerts before one bleeds.
• AI Drawing Analyzer — drop a PDF of plans, get a priced line-item estimate in 30–60 seconds, powered by Gemini Vision. Standard for fast turnarounds; Pro Estimator depth (Business tier) for ambiguous schedules.
• AI Quantity Takeoff — measures linear feet, square feet, doors, windows, fixtures, and bulk materials right off the sheet. Edit, verify in the field, route into a buyout package.
• AI Spec-Match — match takeoff callout codes against the architect's spec book in one tap.
• Plans & Markup — calibrate scale, drop pins, link RFIs / photos / punch items to drawing locations. Offline-first.
• AIA G702/G703 Pay Apps — the schedule of values, retention math, change-order roll-up, and e-sign export. One screen, one tap.
• Change Orders — pricing, markup, approval trail. Owner signs in the portal; trail lives forever.
• Schedule with DCMA 14-point Health — the federal-grade schedule assessment that P6 and Asta Powerproject ship as a paid module, built in.
• Field Ops — voice-to-log daily reports, geo-stamped photos, RFI + punch pipelines, all offline-capable.
• Cash Flow Dashboard — budget vs actual, by cost code, live. Know which job is making money.
• Live Homeowner Portal — AI Daily Digest in plain English, six languages (EN/ES/PT/ZH/VI/FR), e-sign for contracts and selections. Zero app to install.
• Open-Book / GMP Mode — flip a project to Open Book and the homeowner sees actual cost vs commitment, not just billed amount.
• Marketplace — homeowners post projects, verified contractors bid. Optional inbound channel.
• Universal Voice Form Fill — tap mic, speak, AI fills RFIs, COs, punch items, invoices, submittals, new leads.

PRICING
• Free — try every flow with sample data, ship one project to your client portal.
• Pro ($29/mo) — owner-operator GC, all 8 stack tools, AI takeoff at Standard depth.
• Business ($79/mo) — small office, unlimited projects, Pro Estimator AI depth, priority queue.

No per-seat fees. No implementation cost. No sales call required. Cancel anytime in the App Store.

WHO THIS IS FOR
• Residential GCs ($1M–$30M annual revenue)
• Custom-home builders running 4–20 active projects
• Design-build firms where the owner is still on a ladder twice a week
• Small-commercial GCs who want one tool that handles plans → pay → portal

If you have an office manager doing your AIA pay apps in Excel, this app is built for you. If you have a $50M+ shop with a full back office, you'll outgrow it — go talk to Procore.

PRIVACY
Project data lives on your device first, syncs to your team. Homeowner sees only what you publish to the portal. No data sold to third parties. End-to-end encrypted in transit, RLS-protected at rest.

SUPPORT
Tap Help in Settings — direct line to a real person. Reply within 4 business hours. iOS-first; Android and web supported.

Built by a GC who got tired of switching between twelve tabs.
```

(~3,900 chars · ~100 free — re-verify the count in App Store Connect; `•`/`—`/`→` each count as one character there, not multiple bytes. Now leads with the moat: Cost Database + Margin Intelligence.)

---

## Keywords (100 chars · comma-separated)

```
GC,contractor,AIA pay app,takeoff,estimate,schedule,RFI,daily report,job cost,margin,cost database
```

(98 chars · 2 free) — swapped `blueprint` + `punch list` for high-intent differentiator terms `margin` and `cost database` (the moat); "plans"/"punch" are already indexed via the description.

**Why these:** GC and contractor are the highest-intent terms. AIA pay app is unusually specific — anyone searching it is a high-intent buyer. Takeoff, estimate, schedule, RFI, punch list, daily report, blueprint, job cost cover every tool in the stack we replace. Skip generic words like "construction" — too competitive, and Apple already indexes the description for those.

**Don't include:**
- Brand names of competitors (Apple rejects these)
- "Free" or "best" (Apple strips these)
- Plurals (Apple matches stems automatically)

---

## What's New (4000 chars · updated per release)

### Version 1.0.x — current release

```
What's new in this update:

• AI Drawing Analyzer — drop a PDF of plans, get a priced estimate in under a minute. Available to Pro and Business tiers.
• AI Quantity Takeoff — measures dimensions and schedules off the sheet, ready to route into a buyout package.
• Spec-Match — match callouts against the architect's spec book in one tap.
• Schedule Pro — DCMA 14-point assessment built in. The federal-grade schedule check that P6 charges for, included.
• Subcontractor schedule portal — subs add daily progress through a portal slug, no app install required.
• AIA G702/G703 generator — one screen for schedule of values, retainage, change orders, and e-sign export.
• Open Book mode — flip a project to GMP/Open Book, homeowner sees actual cost vs commitment.
• Onboarding redesign — three-step flow lands you in your first project under 30 seconds.
• Premium UI pass — squircle corners, iOS-native typography, tighter spacing, and motion that feels alive.
• Pull-to-refresh wired across the home tab.
• A11y pass — VoiceOver labels added to 290+ icon-only buttons.

Plus 2,400+ small polish improvements: type system locked to a 12-step scale, color tokens consolidated, skeleton previews on AI flows, and 40+ bug fixes from the field.
```

(1,165 chars · 2,835 free)

---

## Version-bump cadence

You don't need to bump `expo.version` for any of these JS-only changes — push them via OTA on the production channel. Bump the version (and re-submit to Apple) only when:
- Adding a native module
- Changing entitlements (camera, location, etc.)
- Major UX overhauls warranting a marketing push

Per CLAUDE.md, runtime version is `appVersion`-locked, so you can ship 50 OTA updates against the same `1.0.x` build.

---

## Screenshots checklist (you'll do these later)

- 6.5" (iPhone 14 Pro Max / 15 Pro Max) — required for App Store Connect
- 6.7" — required separate set
- 12.9" iPad — NOT required since `ios.supportsTablet: false`

Recommended set (10 screenshots, in this order):
1. **Hero — Plans + AI estimate** "Drop a PDF. Get a priced estimate in 60 seconds." (Drawing Analyzer review screen)
2. **Home tab** "Every project. One tap away." (showing 3-4 active projects with budget bars)
3. **Takeoff result** "Quantities measured off the sheet." (showing a takeoff with verified rows highlighted)
4. **Schedule Gantt** "Critical path on your phone." (with red highlight on critical-path tasks)
5. **DCMA scoreboard** "Schedule health, federal-grade." (with the 14 checks listed)
6. **AIA pay app** "G702/G703. One screen." (showing pay app generator)
7. **Cash flow dashboard** "Know which job is making money." (showing budget vs actual chart)
8. **Daily report** "Voice-to-log. 30 seconds." (showing voice modal mid-record)
9. **Client portal preview** "Six languages. Zero app." (showing portal as homeowner sees it)
10. **Onboarding step 2** "Built for residential GCs." (showing the band picker)

Use Apple's "Preview Builder" inside Connect or generate via your phone with screenshot-cropping tools. Do NOT use marketing mockups — App Store guidelines require screenshots to reflect actual app UI.

---

## App Preview video (15-30 sec, optional but converts ~25% better)

If you record one, lead with:
- 0:00–0:03 — phone unlocking, MAGE icon, opening
- 0:03–0:08 — drag a PDF onto Drawing Analyzer, watch it analyze
- 0:08–0:15 — scroll through priced result
- 0:15–0:22 — flip to Schedule, show DCMA check
- 0:22–0:30 — open client portal as homeowner, end on the e-sign screen

No voiceover. Music optional. Captions hard-coded.
