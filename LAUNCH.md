# MAGE ID — Launch Checklist

Everything you need to take screenshots, test the app, and ship to the App Store.

---

## 1. Set up demo data (5 minutes)

The dev-seeder populates a realistic project with every wave 1-5 feature loaded. Use this for screenshots, demos, and walking through the app cold.

**Steps**:
1. Sign in as an OWNER account (the email must be in `utils/owner.ts`).
2. Open `https://app.mageid.app/dev-seeder` (or navigate manually — the screen is gated, regular users get bounced).
3. Tap **Load demo project**.
4. App auto-routes to the new project's detail screen.

**What gets created**:
- Project: "The Henderson Residence" — 3,200 sf brownstone renovation, $511,863 contract value, in_progress status, open-book mode
- Estimate · 5 invoices (paid / partial / sent / draft) · 1 approved change order
- 8 daily reports + AI homeowner summary published on the most recent
- 4 RFIs (open / answered / closed) · 6 punch items (open / in_progress / closed)
- 8 site photos · photo #2 has arrow + circle + text markup
- Signed contract · 6 payment milestones · 5 allowances
- 5 selection categories with chosen options (Bathroom Tile is over allowance — triggers Draft CO CTA)
- 4 lien waivers (received / signed / requested)
- Closeout binder status='sent' · custom note · maintenance schedule
- Client portal enabled with homeowner invite + Spanish-ready language toggle

**To wipe and reseed**: tap **Wipe all my projects** at the bottom of `/dev-seeder`, then Load again.

---

## 2. Screenshot shoot list

**Device**: iPhone 16 Pro Max simulator (or a 6.7" device) for App Store. Apple wants `6.7" Display` and optionally `6.5" Display` — both work from a 6.7" simulator, you just resize.

**Format**: 1290 × 2796 px (Pro Max). Save as PNG, 24-bit, no alpha.

**Background**: Solid `#F4EFE6` (cream) or white. Add a 1-line subtitle / headline overlay if you want App Store-style marketing screenshots.

### The 10 hero screens (in order)

Tap into the seeded "Henderson Residence" project, then capture:

| # | Screen | Where | Why it's the lead |
|---|---|---|---|
| 1 | **Project Detail — Money tile group** | project-detail, Money tab open | Status badges (Contract: Awaiting signature, Selections: 4 of 5 picked, Closeout Binder: Delivered, Lien Waivers: 1 pending) tell the whole story at a glance. The "what's next" hero. |
| 2 | **AI Selections (3-tier)** | Tap the Selections tile | Shows budget / on-target / premium tiers with brand + SKU. The Bathroom Tile category has the "Draft a Change Order for the $4,400 overage →" CTA visible. |
| 3 | **Contract — signed by both parties** | Tap the Contract tile | Headline visual: signed by both, payment milestones with paid/invoiced/pending status pills, allowances list. |
| 4 | **AI Homeowner Daily Digest** | Tap Daily Reports → most recent | The "Latest update" section showing the AI-generated plain-English summary in green PUBLISHED state. |
| 5 | **Closeout Binder — DELIVERED** | Tap the Closeout Binder tile | Status pill DELIVERED + timeline showing Finalized/Delivered dates + the personal note + maintenance schedule + Re-deliver CTA. |
| 6 | **Photo annotator with markup** | Photos tile → tap photo #2 (Primary bath rough-in) → tap "Edit markup" | Arrow + circle + "Hairline crack" text label visible on a real-looking site photo. |
| 7 | **Handover Checklist** | Tap the Handover Checklist tile | Hero card showing X of 8 done with progress bar. Mixed status — selections done, punch open, walkthrough not yet ticked. |
| 8 | **Lien Waivers list** | Tap the Lien Waivers tile | 4 waivers in different statuses, with the disclaimer banner about state-specific forms. |
| 9 | **Open Book / GMP transparency** | Project portal preview OR Reports → Open Book | Shows real budget vs committed vs actual by phase. The category-defining differentiator. |
| 10 | **Notifications inbox** | Top-right bell icon on home screen | Shows real client signals: contract signed · selection chosen · CO approved · sub invoice. Each tap deep-links to the actual record. |

### Optional but high-impact

- **Reports hub** (Discover → Reports) — WIP / Profit / A-R aging tabs
- **Client portal preview** (open the portal URL in browser) — shows what the homeowner sees, including the Latest Update hero panel and section cards in their language
- **Six-language picker** (Client Portal Setup → Homeowner's Language) — flags + endonyms grid
- **Voice-to-DFR preview card** (Daily Report → tap mic → after parsing) — shows "Here's what I heard" with weather, crew, work, materials parsed
- **Tutorial mid-walkthrough** (Settings → Show Tutorial → step 11 "Send a Contract") — shows the new wave 1-5 tutorial steps

### How to take the screenshots

**iOS simulator**:
```bash
# Boot simulator
xcrun simctl boot "iPhone 16 Pro Max"
open -a Simulator

# Take screenshot to Desktop
xcrun simctl io booted screenshot ~/Desktop/mageid-01.png
```

Or just use **Cmd+S** in the Simulator menu.

**Real device**: Side button + Volume Up. Then AirDrop to your Mac.

**Status bar**: For polished App Store shots, override the status bar to show 9:41, full battery, full signal:

```bash
xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
```

Reset with `xcrun simctl status_bar booted clear`.

---

## 3. Functional test plan

Run this before submitting. Each block is a **5-minute walkthrough**.

### Block A — First-run + onboarding (5 min)
- [ ] Wipe AsyncStorage (delete + reinstall app, or call the dev-only wipe).
- [ ] Sign up with a fresh email.
- [ ] Onboarding carousel: 7 slides advance with arrows + Skip works.
- [ ] Land on Summary tab (the post-Wave-1 default, not Your Projects).
- [ ] Auto-shown tutorial fires (10 core + 9 Wave 1-5 steps = 19 total).
- [ ] Walk through 3-4 tutorial steps; verify the deep links route correctly.
- [ ] Skip tutorial; close app; reopen — should NOT re-fire (gated by `mageid_tutorial_seen_v2`).

### Block B — Core CRUD (5 min)
- [ ] Tap + → New Project, fill in name + scope → save.
- [ ] Open the project → verify all 4 tile groups (Field Ops / Money / Documentation / People) render.
- [ ] Tap Schedule → drag-create a phase → verify it persists after back+forward.
- [ ] Tap Estimate → AI Sparkles → describe the job → verify line items populate.
- [ ] Tap Daily Reports → New → fill weather/crew/work → tap mic → dictate "today: 4 framers, no issues" → verify the preview card appears.

### Block C — Wave 1: Contract + Selections (5 min)
- [ ] Open the seeded "Henderson Residence" project.
- [ ] Tap Contract tile — verify status pill is SIGNED, both signatures visible, payment milestones show paid/invoiced/pending with correct colors.
- [ ] Back. Tap Selections tile — verify 5 categories. Bathroom Tile shows "Over allowance" banner with red Draft CO CTA. Tap it → verify the change-order screen opens with prefilled description and amount.
- [ ] Back. Tap one of the un-chosen categories → tap Generate AI options → verify 3 tiers appear with brand + SKU.

### Block D — Wave 2: Lien waivers + Q&A + Closeout binder (5 min)
- [ ] Tap Lien Waivers tile — verify 4 waivers render with status pills.
- [ ] Tap one in REQUESTED status → tap "Mark signed" → type a name → verify status flips to SIGNED with success haptic.
- [ ] Tap a SIGNED waiver → tap PDF → verify a branded PDF opens in browser/Files.
- [ ] Back. Tap Closeout Binder tile — verify status pill DELIVERED, timeline shows Finalized + Delivered dates, custom note renders, action bar shows PDF + Re-deliver.
- [ ] Tap Re-deliver → confirm in alert → verify haptic + toast.
- [ ] Back to Discover → Bid Discovery → tap any RFP → scroll to Pre-bid Q&A section → ask a question → verify it appears.

### Block E — Wave 3: Photo markup + Portal sections (5 min)
- [ ] Open a project → Photos tile → tap photo #2 (the one with the markup badge) → verify lightbox shows arrow + circle + text overlay on the photo.
- [ ] Tap "Edit markup" → in the annotator, draw a freehand line → tap Save → choose "Done" → verify back-nav to project.
- [ ] Re-tap the photo → verify the new markup persisted.
- [ ] Tap the Photo Markup workflow: tap markup-button → save → choose "Add to Punch List" → verify the punch form opens with photo attached.

### Block F — Wave 4: Homeowner digest + Handover (5 min)
- [ ] Open Daily Reports → most recent → scroll to "Homeowner update" section → verify summary text + PUBLISHED pill.
- [ ] Tap "Re-generate from notes" → verify spinner + new summary appears.
- [ ] Toggle PUBLISHED off and on → verify pill updates.
- [ ] Open Handover Checklist tile → verify hero shows "X of 8 done" with progress bar. Tap any open item → verify it routes to the relevant screen (selections, punch, etc.).
- [ ] Tap "Final walk-through completed" → verify it ticks with timestamp. Tap again → verify it un-ticks.

### Block G — Wave 5: Multi-language + Sub portal + Voice (5 min)
- [ ] Open Client Portal Setup → scroll to "Homeowner's Language" → tap Spanish → tap Save (top-right).
- [ ] Copy the portal URL → open in browser → verify portal renders in Spanish (section titles, latest update, chosen tier labels).
- [ ] Switch back to English; save again.
- [ ] Open a sub portal URL (Settings → Sub Portals → tap one to copy) → in browser → verify Punch list + Schedule slice + Commitments + Invoices all render.
- [ ] Daily Report → mic → dictate "8 guys today, drywall delivery, no issues" → verify preview card shows weather, crew summary, work, materials (if any).

### Block H — Connectors (5 min)
- [ ] Open the seeded contract → verify allowances list. Now create a NEW project and contract from scratch with allowances → save and send → verify selection categories auto-create from those allowances.
- [ ] Mark an invoice as paid → verify "Collect a lien waiver" CTA appears below AIA G702 → tap it → verify the New Waiver modal pre-fills sub name + amount + through-date.
- [ ] On the seeded project, deliver the closeout binder again → verify the "Mark project as closed?" alert.
- [ ] Tap a notification in the inbox → verify it routes to the actual record (contract / selections / CO etc.) not just the portal-setup screen.
- [ ] Project detail → verify Money group tiles all show their status badge (Contract / Selections / Closeout / Lien Waivers).

### Block I — Edge cases (5 min)
- [ ] Turn on **Airplane mode**. Create a daily report → save → verify it stays as draft locally. Turn off airplane mode → verify it syncs to Supabase.
- [ ] Delete a maintenance item from closeout binder → verify confirm dialog → cancel → verify item stays.
- [ ] Confirm dialogs on: lien waiver delete, closeout binder maintenance remove, contract milestone remove, daily report manpower/material remove.
- [ ] Notification preferences: toggle Push off for "Selection chosen" → verify the toggle reverts gracefully if the network call fails (try airplane mode mid-tap).
- [ ] Voice DFR → record a 30-second nonsense recording → verify the preview card surfaces what AI extracted (or surfaces a clean error).

---

## 4. Pre-flight readiness checklist

### App Store metadata
- [ ] **Name**: MAGE ID — Builder Tools (or whatever you've registered)
- [ ] **Subtitle**: "Plans · Estimates · Field · Money · Portal" (≤30 chars)
- [ ] **Categories**: Productivity (primary) · Business (secondary)
- [ ] **Keywords**: construction, contractor, builder, GC, estimating, daily report, change order, AIA G702, lien waiver, closeout, RFI, punch list, portal
- [ ] **Description**: lift from `marketing/index.html` hero + pillars
- [ ] **What's New**: 5 waves shipped — contracts, selections, lien waivers, closeout binder, AI homeowner digest, multi-language portal
- [ ] **Screenshots** (10 from shoot list above, sized 1290×2796)
- [ ] **App preview video** (optional but worth it — 30s of the workflow)
- [ ] **Privacy Policy URL**: `https://mageid.app/privacy.html` (already shipped)
- [ ] **Support URL**: `https://mageid.app/support.html` (already shipped)
- [ ] **Marketing URL**: `https://mageid.app/`

### iOS-specific
- [ ] Bundle ID: `com.mageid.app` ✓ (per CLAUDE.md)
- [ ] Team ID: `HKT2J284D2` ✓
- [ ] App Store Connect ascAppId: `6762229238` ✓
- [ ] App icon: 1024×1024 master in `assets/icon.png` (verify it's the up-to-date one)
- [ ] Splash screen renders the brand mark cleanly
- [ ] `app.json` `version` is bumped if you're submitting a new binary (vs. OTA)
- [ ] `eas build --platform ios --profile production --auto-submit` runs clean

### Privacy + permissions
- [ ] Camera (photo annotator, daily report photos): purpose string in `app.json`
- [ ] Microphone (voice-to-DFR): purpose string
- [ ] Location (photo geo-stamps): purpose string + "While in Use" only
- [ ] Push Notifications: `expo-notifications` configured
- [ ] **Privacy Manifest** (PrivacyInfo.xcprivacy) — required by Apple now. Lists the data types you collect (email, name, photos, location).
- [ ] Sign-in-with-Apple: required since you offer email sign-up. Verify it's wired.

### Tracking + analytics
- [ ] No third-party trackers (verify by grepping for analytics SDKs: `mixpanel`, `segment`, `firebase/analytics`, `amplitude`).
- [ ] Sentry / Bugsnag (if used): verify DSN is the production project, not staging.
- [ ] Supabase: verify the `EXPO_PUBLIC_SUPABASE_URL` env var points to production.

### Payments
- [ ] RevenueCat entitlements verified for Pro + Business
- [ ] Stripe Connect is in **live mode**, not test mode (check `lib/stripe.ts` or env vars)
- [ ] Tier gating works: a free user trying to access AI features shows the paywall

### Marketing site
- [ ] `mageid.app` deploys cleanly (Netlify / Vercel)
- [ ] All feature pages load (post-a-project, client-experience, financials, field, scheduling, bids, vs-competitors)
- [ ] No 404s on internal links (run `wget --spider --recursive --no-verbose mageid.app | grep '404'`)
- [ ] OG images render in a Twitter / iMessage preview test
- [ ] Apple Smart App Banner meta tag points to the right App Store ID

### Final smoke test on a real device
- [ ] Install the production binary on a fresh iPhone (not the dev build)
- [ ] Sign up, complete onboarding, run Block B + Block C from the test plan above
- [ ] Confirm push notifications actually deliver (sign a contract → see the push)
- [ ] Confirm portal URL opens cleanly in mobile Safari
- [ ] Confirm "Pay Now" button on a portal invoice opens Stripe checkout

---

## 5. The 10-minute pitch script

When you record an app preview video or do a live demo:

1. **(15s)** "I built MAGE ID for residential GCs running $1M-$30M projects who are stuck between Excel and a $12,000-a-year Procore subscription."
2. **(30s)** Open Henderson Residence. Show project-detail. "Every project gets four tile groups — Field, Money, Docs, People — and the status badges tell me what's blocking handover at a glance."
3. **(45s)** Tap Contract. "I built the contract in-app, sent it to the homeowner's portal, they signed, and the second they signed my phone pinged. No DocuSign subscription."
4. **(45s)** Tap Selections. "I set allowances, AI curates three options — budget, on-target, premium — with brand and SKU. The homeowner picked the gold-herringbone marble. It's over allowance, so the app pre-drafted a Change Order for the $4,400 overage."
5. **(30s)** Tap Daily Reports. "I write the technical log; AI rewrites it for the homeowner in plain English. Two-tap publish to their portal."
6. **(30s)** Tap Closeout Binder. "Auto-compiled at handover. Every paint color, every fixture brand, every sub contact. Lives in their portal forever."
7. **(20s)** Open the portal in the homeowner's language (Spanish). "The trades aren't monolingual. Six languages out of the box."
8. **(10s)** "Plans, estimates, field ops, financials — all in one app, on a phone you already carry."

Total ~3:45 — trim to 30s for App Store preview, 90s for marketing.

---

## 6. Ship it

```bash
# JS-only changes
eas update --branch production --message "Pre-launch polish"

# Native binary (only if you bumped expo.version or installed a new native module)
eas build --profile production --platform ios --auto-submit
```

Then in App Store Connect:
1. Add a new version (increment build number)
2. Upload screenshots from the shoot list
3. Set the What's New copy
4. Submit for review

Apple's review typically takes 24-72 hours. Be ready to respond if they ask for sign-in test credentials — create a `reviewer@mageid.app` account with the Henderson demo project pre-seeded for them.
