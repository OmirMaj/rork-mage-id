# MAGE ID — Strategic Audit (Pre-TestFlight)

**Date:** 2026-05-14
**Companion to:** [2026-05-14-pre-testflight-ux-audit.md](./2026-05-14-pre-testflight-ux-audit.md) (the onboarding/workflow piece)
**Method:** 3 parallel research agents — competitive/pricing/wedge, in-app discoverability, visual polish.
**Lens:** "Billionaire mindset." Where does this app *win*? Where does it *leak* customers?

---

## TL;DR — the three bombshells

1. **We are dramatically underpriced.** Pro $29 / Business $79 / Enterprise $150 vs JobTread $199, Houzz Pro $249, Buildertrend $399–$1,099, Buildxact $199–$599, Bolster $299–$499. Same surface area — and in several spots better surface area — at **1/5 to 1/10 the cost.** ARPU is leaving $40–$80/seat/mo on the table.

2. **The wedge is real.** We have 5 features competitors don't (or do badly): AI Quick Estimate from a sentence, Drawing Analyzer + Compare + Spec Book Extract, AIA G702/G703 + Lien Waivers + Closeout Binder, the Marketplace Bids network, and Weather-aware scheduling. **Houzz Pro's AutoMate is the only real comp on AI — and they charge $249/mo.**

3. **The wedge features are invisible.** 7 of our highest-value features score **1/5 on discoverability** (essentially unreachable from a cold app open). Worst offenders: AI Punch from Photos, Compare Drawings, Spec Book Extract, In-app Contracts, Client Portal, Payment Predictions, **Sub Prequal (the Subs tab is literally `href: null` on mobile — entirely orphaned).**

---

## 1. Pricing position

**Sources:** [JobTread](https://www.jobtread.com/pricing), [Houzz Pro](https://www.houzz.com/houzz-pro/pricing), [Buildertrend](https://buildertrendpricing.com/), [Buildxact](https://www.buildxact.com/us/pricing/), [Knowify breakdown](https://projul.com/blog/knowify-pricing-breakdown/), [Bolster](https://www.bolsterbuilt.com/pricing).

| Competitor | Lowest tier | Mid tier | Top tier |
|---|---|---|---|
| **MAGE ID (today)** | Free | $29 Pro | $79 Business / $150 Enterprise |
| JobTread | — | $199/mo first seat + $20/seat | — (custom) |
| Houzz Pro | $79 Starter | **$249/mo Pro** | $399+ |
| Buildertrend | $399 Essential | $799 Advanced | $1,099 Complete |
| Buildxact | $199 Entry | $399 Pro | $599 Teams |
| Knowify | — | $300-500/mo | per-user adds |
| Bolster | $299 | $399 | $499 + $49/user |

**Implications:**
- A would-be customer doing a $249 Houzz Pro demo would see our $29 and think *"is this real?"*. That's a known conversion killer; price IS quality signal.
- We are 1/3 the price of the cheapest competitor (Buildxact Entry). Business at $79 is 1/5 of JobTread for materially overlapping value.
- This is a healthy *temporary* position to win trials, but leaves ARPU on the floor at scale.

---

## 2. Wedge features (money-makers competitors don't have)

| Feature | We have | Competitor coverage |
|---|---|---|
| **AI Quick Estimate from one sentence** | `components/AIQuickEstimate.tsx`, `app/estimate-wizard.tsx` | JobTread/Buildxact/Knowify: manual only. Houzz Pro AutoMate (2025): yes but $249. |
| **AI Takeoff + Compare Drawings + Spec Book Extract** | `supabase/functions/analyze-drawings`, `compare-drawings`, `analyze-spec-book` | Procore-class capability. Houzz: measurement-only. Buildertrend: none. |
| **AIA G702/G703 + Lien Waivers + Closeout Binder + Warranty Walk** | `app/aia-pay-app.tsx`, `app/lien-waivers.tsx`, `app/closeout-binder.tsx`, `app/warranty-walk.tsx` | Enterprise GC plumbing. JobTread doesn't ship it. Buildertrend Complete tier ($1,099) only. |
| **Marketplace Bids (post-RFP + nearby-RFP fan-out + AI Bid Scorer)** | `app/post-rfp.tsx`, `app/nearby-rfps.tsx`, `components/AIBidScorer.tsx`, `supabase/functions/notify-nearby-contractors` | None of the competitors have a built-in sub-sourcing marketplace. **Network-effect moat, not feature.** |
| **Weather-aware schedule + morning digest + EVM (CPI/SPI)** | `supabase/functions/morning-digest`, `WeatherAlert`, `app/cash-flow.tsx` | Competitors have schedules. None pair them with hyperlocal forecasts and earned-value math. |

---

## 3. Gaps vs competitors (what's leaking customers)

| Gap | Why it matters |
|---|---|
| **No native QuickBooks Online sync** | The #1 hard requirement for any GC > $500k revenue. They will not migrate without it. Knowify and JobTread lead with this. |
| **Per-user role granularity** | We have `owner / editor / viewer`. Competitors offer scope-by-project-and-module. Any 3-person+ crew objects to this. |
| **Per-crew-member resource leveling on the Gantt** | JobTread + Buildertrend let you drag a task onto a person and balance load. We have a Gantt but not resource leveling. |
| **Native e-signature with audit trail** | We have ContractSignature, but no DocuSign-grade signer flow. JobTread has it baked in. |
| **Time-tracking → payroll push (Gusto / QB Time / ADP)** | We have time tracking. Competitors push to payroll. The Knowify killer combo. |

---

## 4. Discoverability scores (mobile, cold open)

Bottom tabs are **Summary / Your Projects / Discover / Settings**. Anything that requires 4+ taps to reach is effectively invisible to a TestFlight tester.

| Score | Features |
|---|---|
| **4 (easy)** | Quick Estimate Wizard, Construction AI, MAGE ID Bids |
| **3 (findable)** | Daily Field Reports, RFIs, Stripe Connect, Cash Flow |
| **2 (buried)** | Pro Scheduler, AI Takeoff, AIA Pay Apps, Lien Waivers, Closeout Binder, Weekly Snapshot |
| **1 (invisible)** | Client Portal, Sub Prequal, Voice fill, AI Punch, Spec Book Extract, Compare Drawings, In-app Contracts, Payment Predictions |

**Critical bug found:** `app/(tabs)/_layout.tsx:209` — `href: null` on the Subs tab on mobile. **Sub Prequal is currently unreachable** without a deep link.

**Top hidden gems** (great features the user can't find):
1. AI Punch from Photos
2. Compare Drawings
3. Spec Book Extract
4. In-app Contracts (e-signed)
5. Sub Prequal packets

---

## 5. Visual polish issues (premium-feel pre-TestFlight)

Two screens **break dark mode entirely** because they use the static `Colors.X` instead of `useThemedStyles`:
- `app/(tabs)/mage-id-bids/index.tsx` (lines 451-564) — also: title is `subheadline` 18px while every other tab uses `largeTitle` 34px (literally half size)
- `app/(tabs)/equipment/index.tsx` (lines 287-625) — plus a naked icon-only empty state

Other premium-touch issues:
- **Project-detail's 24-color tile rainbow** (line 1293) defies the inline comment in Discover ("rainbow … color carried no meaning")
- **Discover overview** leaks `#1565C0` (blue Post Bid) and `#D97706` (amber Manage Work) — three competing oranges/blues right at the top
- **Summary tab** renders Total Budget and Outstanding in the same orange — the eye lands nowhere; Outstanding should be danger-tinted when positive
- **Tab headers use 4 different font weights** (900/800/700/700) — should be one recipe
- **Settings has hardcoded `#FF6A1A` and `#7C3AED`** instead of theme tokens (drift survives theme changes)
- **Spinners where skeletons would feel premium** on Summary + mage-id-bids

**What's already great** (don't touch):
- `app/(tabs)/discover/tools.tsx` — the NavRow tone-mapped iOS-Settings pattern is the template
- `components/EmptyState.tsx`, `components/ui/IconWrapper.tsx`
- `app/(tabs)/(home)/index.tsx` filter chips + Today on Site
- Project-detail's pageSheet modal + chevron-back nav pattern
- Settings profile hero

---

## 6. Punch list — ranked for ship

### P0 — ship this session (visible to every TestFlight tester, all low-risk)

| # | Fix | Impact |
|---|---|---|
| 1 | **Fix `mage-id-bids` dark mode** — convert to `useThemedStyles`, fix half-size title, restore brand-orange active chips | Tab literally broken in dark mode today |
| 2 | **Fix `equipment` dark mode + empty state** — convert to `useThemedStyles`, use `<EmptyState>` component | Same broken dark mode |
| 3 | **Unhide Subs tab on mobile** — flip `href: null` → real route, OR add Subs row to Discover Tools NETWORK section | Sub Prequal entirely unreachable today |
| 4 | **Add AI HUB section to Discover Tools** — AI Takeoff, AI Punch, Compare Drawings, Spec Book Extract | 4 hidden-gem features surfaced in 1 change |
| 5 | **Standardize tab header titles** — single recipe across (home), summary, discover, equipment, mage-id-bids | Hero typography is the first thing testers see on each tab |
| 6 | **Fix Discover's blue + amber leftovers** — Post Bid to accent, Manage Work to accent | Brand-color cleanup matching last commit |
| 7 | **Summary stat semantic colors** — Total Budget neutral, Outstanding `danger` when > 0 | Eye finally lands on the number that matters |
| 8 | **Settings hardcoded `#FF6A1A` / `#7C3AED` → theme tokens** | Drift fix; safe |

### P1 — next session (medium-effort, big strategic moves)

| # | Move | Why |
|---|---|---|
| 9 | **Onboarding checklist v2** — company info → first project → first estimate → Stripe Connect → first invoice (per [previous audit](./2026-05-14-pre-testflight-ux-audit.md)) | First-week activation funnel |
| 10 | **Proactive Stripe Connect home banner** when status = `none` and `projectCount ≥ 1` | Stop the reactive surprise alert |
| 11 | **Project-detail tile rainbow → group-tinted palette** | Tile grid stops looking like a sticker sheet |
| 12 | **Skeleton loading states** on Summary + mage-id-bids replacing the spinner | Premium-feel during fetch |

### P2 — strategic / business decisions (not engineering)

| # | Strategic move | Confidence |
|---|---|---|
| 13 | **Reprice Pro $29 → $39 with AI bundled** | High — A/B test recommended. Competitor anchor is $159–$249. ~34% ARPU lift expected. |
| 14 | **Free tier gets 1 free Quick Estimate / month forever** | High — get the magic moment in front of Free users, then meter |
| 15 | **Ship QuickBooks Online sync as $19/mo add-on** | High — unlocks the $500k+ revenue GC segment that won't even demo without it |
| 16 | **Marketing comparison page: "Houzz Pro's AI at 1/6 the price"** | High — wedge marketing weapon |
| 17 | **Per-user / per-project role granularity** | High — gates Business → Enterprise upgrades |

---

## 7. Strategic recommendation in one paragraph

We have the **product** of a $200/mo tool at a $29 price point. The 3 highest-ROI moves are: **(1)** ship the P0 polish + discoverability fixes so testers actually *see* the wedge features (8 changes, ~2 hours); **(2)** in the next month, bundle AI into a $39 Pro tier and put 1 free Quick Estimate/month on Free — this is the wedge marketing weapon; **(3)** ship QBO sync as a paid add-on before any other big feature, because it unlocks an entire upmarket segment. Everything else can wait.

---

## What I'll ship now if you green-light

The full P0 list (#1–#8). Estimate ~2 hours of focused work. One commit, one OTA, push to main.

After that, if you want, I can do P1 (#9–#12) in a follow-up.

Strategic moves #13–#17 are business decisions, not engineering, and need your call.

---

### Source references

- Strategic / pricing: [JobTread](https://www.jobtread.com/pricing), [Houzz Pro pricing](https://www.houzz.com/houzz-pro/pricing), [Buildertrend 2026](https://buildertrendpricing.com/), [Buildxact](https://www.buildxact.com/us/pricing/), [Knowify breakdown](https://projul.com/blog/knowify-pricing-breakdown/), [Bolster](https://www.bolsterbuilt.com/pricing), [Procore](https://www.procorepricing.com/)
- QBO integration norm: [JobTread QBO docs](https://www.jobtread.com/integrations/quickbooks-online)
- AI wedge benchmark: [Houzz Pro AutoMate](https://pro.houzz.com/pro-learn/blog/houzz-pro-puts-the-power-of-artificial-intelligence-to-work-for-you)
- Activation patterns: [Amplitude on activation rate](https://amplitude.com/explore/digital-analytics/what-is-activation-rate), [7% Retention Rule](https://amplitude.com/blog/7-percent-retention-rule)
- Adoption failure modes: [Remato — why crew abandon construction SaaS](https://remato.com/blog/mobile-first-construction-software-adoption/), [KPMG via Construction Dive](https://www.constructiondive.com/news/kpmg-report-construction-industry-slow-to-adopt-new-technology/426268/)
