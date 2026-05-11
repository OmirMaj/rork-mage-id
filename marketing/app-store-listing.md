# MAGE ID — App Store Listing Draft

Last updated: May 2026

This is the full content package for App Store Connect. Use it as the
source of truth. The app store JSON is generated from this when
submitting.

---

## Name (30 char max)
```
MAGE ID
```
*7 chars. Locks the brand at the top. No tagline in the name — leave
that to the subtitle which Apple ranks higher anyway.*

## Subtitle (30 char max)
```
Construction PM with AI permits
```
*30 chars exactly. This is the highest-impact line — Apple shows it
prominently and weights it heavily for keyword search. We pack
"construction", "PM", "AI", "permits" into the 30 chars.*

**Alternates if A/B testing:**
- `Permit AI · Estimates · Invoices` (32 — drop a char)
- `Field PM. AI permit research.` (28)
- `Construction OS for small GCs` (29)

## Promotional Text (170 char max — can be updated without re-review)
```
The only construction PM app with an AI permit agent that quotes actual code. 172 sections across NYC, LA, Chicago, Houston, Miami, Phoenix, Seattle, SF.
```
*170 chars exactly. Use this slot for what's new + the marquee
differentiator. It can be updated weekly without a new build review.*

## Description (4,000 char max)
```
MAGE ID is the operating system for residential and small-commercial general contractors. Plans, estimates, daily field reports, AIA pay applications, scheduling, and a live client portal — replaced a dozen tools with one app that lives in your pocket.

═══ THE AI PERMIT AGENT NOBODY ELSE HAS ═══
Ask permit questions in plain English. The agent quotes verbatim code text with section citations.

— 172 hand-curated code sections
— 8 major US metros: NYC, LA, Chicago, Houston, Miami, Phoenix, Seattle, San Francisco
— Local laws covered: NYC LL97 carbon caps, LL11/FISP facade inspections, Miami-Dade post-Surfside recert, SF AB-112 all-electric, LA Mansionization, Phoenix stucco lath, Seattle SEC, Houston Ch. 19 floodplain
— Every answer cites the section number and links to the .gov source

═══ THE PROFESSIONAL TOOLS YOU'D PAY $1,000/MONTH FOR ═══
— AI quantity takeoff — reads architectural PDFs, produces editable LF/SF/EA quantities with confidence per row and source-page tracing
— AI estimating with regional price points across 20,000+ items
— AIA G702/G703 pay applications, auto-populated
— Phase-based Gantt with weather-aware schedule risk forecasting
— Daily field reports with voice capture
— RFIs, submittals, change orders, punch lists
— Cash flow forecasting and EVM
— Public bid discovery from SAM.gov
— Free client portal homeowners actually open

═══ FREE FOR YOUR FIRST PROJECT. $29/MO FOR PRO. ═══
Pro $29/mo, Business $79/mo, Enterprise $150/mo. Flat pricing, no per-user fees. Your subs use it free. Cancel anytime.

═══ BUILT MOBILE-FIRST FOR THE TRUCK, NOT THE BACK OFFICE ═══
Voice-first daily reports captured between trades. Photo + GPS-stamped field documentation. Offline-first so the app keeps working at the back of an unfinished basement with no signal. Built for hands-on owners running 3-30 projects a year — not enterprise PM teams with project engineers.

═══ HOW WE COMPARE ═══
— Enterprise PM platforms: $375+/mo, built for ENR-400 commercial GCs. We're 1/30th the price for the residential workflow.
— Residential PM market leaders: $299–$900/mo with per-seat fees on top. We're $29/mo flat with AI permits + AI takeoff built in.
— Other residential-tier apps: similar pricing tier, none ship an embedded AI permit agent.

═══ WHO IT'S FOR ═══
Residential general contractors. Custom home builders. Design-build firms. Small-commercial GCs. Remodelers. ADU specialists. Anyone running 3-30 projects/year with annual volume between $500K and $30M.

═══ PRIVACY ═══
Your project data never leaves your account. We don't sell data, don't run ads, don't share with brokers. RLS-protected Supabase backend. Encrypted at rest. iCloud-safe.

Get started in 5 minutes. Free first project. No demo call required.
```
*~3,400 chars. Leaves room for App Store reviewer notes.*

## Keywords (100 char max, comma-separated, no spaces after commas)
```
construction,contractor,builder,estimate,invoice,bid,project,management,permit,AIA,GC,scheduling,RFI
```
*99 chars. Cover the head terms a small GC searches. Apple already
indexes the title + subtitle, so don't repeat them here.*

**Alternates ranked by search volume estimate:**
1. `construction,contractor,builder,permit,AIA,estimate,invoice,bid,GC,scheduling` (78 chars — leaves room for trending terms)
2. `construction,contractor,subcontractor,permit,DOB,AIA,RFI,punchlist,estimate` (75 chars)
3. `residential,remodel,homebuilder,permit,AIA,estimate,takeoff,scheduling,RFI` (75 chars — residential-niche)

Pick one. Run for 60 days, swap based on what App Store Connect's
Search Ads keyword report shows.

## What's New (4,000 char max — per release)
```
v1.1 — Permit Q&A is here

NEW: Permit Q&A AI agent
— Ask DOB, building code, zoning, and Local Law questions in plain English
— 172 hand-curated code sections across NYC, LA, Chicago, Houston, Miami, Phoenix, Seattle, SF
— Verbatim quotes with section citations — no AI hallucinations
— Free on Pro tier

NEW: Mobile-first hero photo on Home
— Most recent jobsite photo shows on the Home tab with a brand-serif overlay
— Tap to jump straight into that project

NEW: Tools tab inside Discover
— Approvals, OAC actions, Cash flow, Compliance hub, Permit calendar, Permit leads, Bid analytics, 1099-NEC export — all in one place

POLISH: Brand refresh
— Fraunces serif headings throughout
— Cleaner color system with semantic accents
— Permit-stamp aesthetic in the AI agent screen

Fixes:
— OTA channel routing
— Web shell SEO + PWA manifest so shared app links preview correctly
```

## Privacy nutrition label

**Data linked to user:**
- Identifiers — user ID, device ID (RevenueCat + Sentry)
- Purchases — subscription tier
- User content — project files, photos, daily reports (stored in your account, never sold)
- Diagnostics — crash reports (Sentry)
- Usage data — feature events (PostHog, anonymized)

**Data NOT collected:**
- Browsing history
- Search history
- Other contacts on device
- Location history (only used for photo GPS at moment of capture, not tracked)
- Health & fitness data
- Sensitive info (race, ethnicity, sexual orientation, etc.)

**Data NOT linked to user:**
- Aggregated usage analytics (PostHog cohort data)

---

## Screenshot specs

**iPhone 6.7" (iPhone 14 Pro Max / 15 Pro Max) — 1290×2796**

Need 6 screenshots, in this order (App Store ranks them left-to-right):

1. **HERO** — DailyHeroPhoto on Home tab with Fraunces overlay. Headline overlay: "Construction PM. Mobile-first."
2. **PERMIT Q&A** — Permit Q&A chat showing a real NYC LL97 question + answer with code citation visible. Headline: "Ask the code. Get the section number back."
3. **DASHBOARD** — Summary tab showing portfolio stats + A/R aging strip. Headline: "Bird's-eye view of every job."
4. **AI TAKEOFF** — Plan viewer with quantity rows + confidence indicators. Headline: "AI reads your drawings."
5. **AIA PAY APP** — G702 cover sheet with auto-populated values. Headline: "Pay apps in 5 minutes, not 5 hours."
6. **TOOLS** — Tools tab showing the section-grouped list with semantic colors. Headline: "Every workflow in one place."

**iPhone 6.5" (iPhone 11 Pro Max) — 1242×2688** — same 6 screenshots scaled

**iPhone 5.5" (iPhone 8 Plus) — 1242×2208** — same 6 screenshots scaled (Apple now allows iPad/iPhone Plus aliases of the 6.7" so we can ship just the 6.7" set)

**Type spec for screenshot overlays:**
- Headline font: Fraunces 700 Bold, italic accent word in amber #FF6A1A
- Body font: Inter 600 Semibold, color #F4EFE6
- Background: 16:9 photo or dark ink panel #0B0D10

## Support URL
```
https://mageid.app/support.html
```

## Marketing URL
```
https://mageid.app/
```

## Privacy Policy URL
```
https://mageid.app/privacy.html
```

## App Category
Primary: **Business**
Secondary: **Productivity**

## Age Rating
**4+** — no restricted content. Standard business app.

## Pricing tier
**Free** (with in-app purchases via RevenueCat).

In-app purchase products to register in App Store Connect:
- `com.mageid.pro.monthly` — Pro, $29/mo
- `com.mageid.pro.annual` — Pro, $290/yr (save $58, ~17%)
- `com.mageid.business.monthly` — Business, $79/mo
- `com.mageid.business.annual` — Business, $790/yr
- `com.mageid.enterprise.monthly` — Enterprise, $150/mo
- `com.mageid.enterprise.annual` — Enterprise, $1,500/yr

## TestFlight beta description (4,000 char max)

```
Welcome to MAGE ID — the operating system for residential and small-commercial GCs.

You're testing the beta. A few things to know:

1. WHAT'S NEW IN THIS BUILD
The Permit Q&A AI agent is now live. Tap Discover → AI Hub → "Permit Q&A agent" or use the action rail on Home. Ask permit/code questions in plain English; the agent quotes verbatim code with section citations.

2. WHAT TO TRY
— Create a project (or tap "Try a sample project" in the empty state)
— Open the Permit Q&A agent and ask: "Can I extend my roof in Brooklyn?"
— Run an AI takeoff on a PDF plan set (Tools → AI takeoff)
— Send a daily field report using voice capture (the mic button on Home)
— Generate an AIA pay app from invoiced work

3. WHERE TO REPORT BUGS
TestFlight feedback (the easiest path) — long-press the app icon, "Send Beta Feedback". Include a screenshot if visual.

4. KNOWN ISSUES
— Voice capture may stumble on names with apostrophes (fix landing this week)
— Permit Q&A first response on cold launch can take 6-8 seconds; subsequent answers are sub-second from cache
— Schedule Gantt drag-to-reschedule needs polish on iPad

5. THANK YOU
This is hard to build. Your feedback shapes what ships to the App Store. Send us anything — typos, weird flows, dumb interactions, "wouldn't it be cool if".

— Omir + the MAGE ID team
omirmajeed2000@gmail.com
```

---

## Submission checklist

- [ ] Build uploaded to App Store Connect via EAS Submit
- [ ] All 6 screenshots produced (Fraunces + amber overlay)
- [ ] App icon 1024×1024 finalized
- [ ] All 6 IAP products registered + agreements signed
- [ ] Privacy nutrition label completed
- [ ] App review notes written (with test login credentials)
- [ ] Marketing URL → mageid.app live with PR merged
- [ ] Support URL responsive within 24h
- [ ] Privacy policy reviewed
- [ ] Export Compliance answered (`ITSAppUsesNonExemptEncryption: false` already set in app.json)
- [ ] Demographic age rating questionnaire answered
- [ ] Pricing tier set to Free
- [ ] Localization: English (U.S.) only for v1
- [ ] Submit for review

## Post-submission

- Apple review usually takes 24-48h
- First rejections are commonly about IAP misconfig, missing privacy URL, or screenshot text overlays that "look like UI" — review the Common Rejections list
- If approved: schedule release for 7am PT on a Tuesday so the launch tweet lands during business hours

---

## A/B test ideas (post-launch)

When you have install volume:

1. **Title swap**: `MAGE ID` vs `MAGE — Construction PM`
2. **Subtitle swap**: 3 variants ranked by perceived install-to-trial conversion
3. **First screenshot swap**: DailyHeroPhoto vs Permit Q&A
4. **Promotional text swap**: lead with marquee feature vs lead with price

A/B is only meaningful at ≥1,000 store views/week per variant. Don't run it before you have install volume.
