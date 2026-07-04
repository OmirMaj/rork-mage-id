# Value-First Activation — Design Spec

**Date:** 2026-07-01
**Status:** Approved design, ready for implementation plan
**Thread:** 1 of 4 from the app/marketing/onboarding audit (the other three — *Reveal the moat in-app*, *Estimating → margin pricing*, *Marketing coherence + proof* — are queued as separate specs.)

---

## Problem

MAGE's engine is deeper than its competitors, but **the premium "wow" is locked behind a wall the user hits *before* they feel any value.** Concretely, and confirmed in code:

- **Voice capture** — the marquee field feature — opens a full paywall on the *first* tap (`components/UniversalMicButton.tsx:96`, `app/daily-report.tsx:868/945`), even though the gating table already marks `voice_commands: 'free'` (`hooks/useTierAccess.ts:93`). The surface contradicts its own config.
- **AI estimate wizard** — the headline value action on the onboarding checklist — routes to a hard `Paywall` (`app/estimate-wizard.tsx:63`) before a free user ever produces one estimate.
- **Onboarding never teaches the moat.** The preview cards cover Instant Bid / takeoff / EVM / voice but never the cost-learning loop the product bible calls the entire wedge.
- **The activation checklist opens with admin** (`components/OnboardingChecklist.tsx`: "Add your company info" is #1; "Build your first estimate" is #3 and routes into the paywall; "Connect Stripe" is #4).
- **A likely-dead paywall gate** adds confusion (`app/_layout.tsx:337` `shouldShowOnboardingPaywallGate` is chicken-and-egg: it only fires once `firstSeenIso` is stamped, but that stamp is only written by the paywall screen, which nothing routes to).

The infrastructure to do this *right* already exists but is unused on these features: `utils/aiRateLimiter.ts` has a `freeLifetimeCap` model explicitly designed so "a free user can DEMO the magic features once or twice" — already applied to `quickEstimate`/`scheduleBuilder`/`estimateValidation` (3 free lifetime each).

## Goal

Turn "wow behind the wall" into **"feel it, *then* the wall."** A brand-new contractor should experience each premium feature a few times, learn *why* it's special (the moat), and hit an upgrade prompt only after the value has landed — all through one consistent gating path, not scattered hard walls.

## Decisions (locked)

1. **Free-tier model: metered taste.** Free users get a few *lifetime* uses of each wow feature, then a wall. (Not a reverse trial; not full freemium.)
2. **Auth timing: frictionless auth up front, value behind it.** Keep one-tap Apple/Google first; do *not* build a guest-mode / local-state migration. Remove email-signup friction instead.
3. **Scope: Approach B + two grafts** (checklist reorder; park the dead paywall gate). Explicitly *not* in scope: guest mode, gate-screen cuts, paywall re-skin, the marketing site.

---

## Architecture — one metered gate, not scattered walls

Every premium action flows through the **single existing path**:

```
const gate = await checkAILimit(feature, tier)   // {allowed, reason, message}
if (!gate.allowed) return showUpgradeSheet(gate)  // unified sheet, uses gate.message
... run the action ...
await recordAIUsage(feature)                      // increment ONLY on success
```

The ad-hoc `isProOrAbove` hard walls on these features are **deleted** in favor of this path. Metering increments only after the action succeeds, so a cancelled or failed attempt never burns a trial.

### Feature registry additions (`utils/aiRateLimiter.ts`)

Add three entries to the feature-config map, mirroring the existing `quickEstimate` shape:

| feature key | `freeLifetimeCap` | replaces (hard wall removed) |
|---|---|---|
| `voiceCapture` | **3** | `UniversalMicButton.tsx:96`, `daily-report.tsx:868/945` |
| `aiEstimateWizard` | **2** | `estimate-wizard.tsx:63` full-screen `Paywall` |
| `aiTakeoff` | **1** | takeoff hard gate |

Caps chosen to let each wow land without bleeding money on free-riders; tunable in one place. Lifetime counts persist in the existing `mage_ai_lifetime` AsyncStorage key — no new store, no migration.

### One upgrade moment — `<UpgradeSheet>`

Replace the several current upgrade UIs (full-screen `Paywall`, `openPaywall`, `isLocked` overlays) with a single `components/UpgradeSheet.tsx`, driven by the `{reason, message}` `checkAILimit` **already returns** (e.g. *"You've used your 3 free Voice Captures. Go Pro for unlimited."*). Copy is framed as **earned** ("you've now seen what this does"), never punitive. The existing `Paywall` component is still reachable from Settings/explicit upgrade CTAs; `UpgradeSheet` is specifically the *post-value* trial-exhausted moment.

---

## Value-first onboarding (behind now-frictionless auth)

### Auth friction removal (`app/signup.tsx`)

- Drop the **confirm-password** field.
- Email signup no longer **blocks** on the "check your inbox" round-trip mid-flow: the user enters onboarding immediately and email is **verified in the background** (non-blocking). One-tap Apple/Google is unchanged and remains the promoted path.

### Land into value

The demo-seed **sample project** (already built) is present on first home so the projects tab is never a dead end. (If the user *imports* their pipeline, also seed/keep one sample project so home isn't empty — closes the audit's "import leaves home empty" gap.)

### Teach the moat

Replace one generic onboarding preview card with the flywheel story — *"Every job you finish makes your next bid smarter"* (Bid Confidence) — and make the first checklist action a real **metered-free** wow rather than a paywall.

### Checklist reorder (graft 1 — `components/OnboardingChecklist.tsx`)

| # | New order | Was |
|---|---|---|
| 1 | **Try it: voice capture *or* an AI estimate** (metered-free) | "Add company info" |
| 2 | Create your first project | "Create your first project" |
| 3 | Add your company info | "Build your first estimate" → paywall |
| 4 | Connect Stripe *(surfaced only at a real "send invoice" moment)* | "Connect Stripe" |
| 5 | Send your first invoice | "Send your first invoice" |

### Park the dead paywall gate (graft 2 — `app/_layout.tsx`)

Remove the dead `shouldShowOnboardingPaywallGate` wiring (kill the confusion). Keep `app/onboarding-paywall.tsx` parked on disk. A real post-value paywall *show* is a later, data-informed decision (Approach C).

---

## Design language (patterns from recent.design)

Selective, brand-consistent grafts that elevate the exact surfaces this spec touches. They reuse the existing premium serif system — **no** construction clipart.

1. **Card Onboarding UI (progressive disclosure).** The onboarding preview becomes a **swipeable card stack** that reveals the moat one beat at a time and ends on a live "try it" card, instead of a static list.
2. **Thinking States (designed feedback, not spinners).** The AI-estimate and voice "generating" wait becomes a **labeled thinking sequence** — *"Reading your scope… pricing from **your** history… checking your margin…"* — so wait-time *teaches the moat while it works*. Applies to the estimate wizard and `UniversalMicButton` parse step.
3. **Frozen / glass-morphism upgrade moment.** `UpgradeSheet` renders as **frosted glass over the result the user just produced** — the wow sits blurred behind the wall, so they see exactly what upgrading keeps. Reinforces "earned, not punitive."
4. **Typography-as-design.** Moat-teaching headlines lean into the existing serif; consistent with brand, no new visual vocabulary.

---

## Data & state

- Lifetime counts: existing `mage_ai_lifetime` key; three new feature keys. No migration.
- **To verify during build:** whether a free `maxProjects: 1` cap actually exists in code, or is only a marketing claim. The "1 free project + client portal" promise needs a real gate; if absent, add it to `FEATURE_LIMITS` and enforce at project creation.
- Increment-on-success is the invariant that keeps trials fair.

## Error handling

- If `checkAILimit` / storage read fails, **fail open to the action** for a signed-in user (don't wall someone out due to a storage hiccup) but do not increment — a lost read should never *cost* a trial or *block* value.
- Background email verification failure surfaces a non-blocking banner ("Confirm your email to secure your account"), never a modal that ejects the user.

## Testing

- **Unit (`utils/aiRateLimiter`):** `checkAILimit` returns `lifetime_cap` after N successful `recordAIUsage` calls for each new feature; a cancelled action does not increment; fail-open behavior on storage error.
- **Manual (fresh install):** voice works free 3× then shows `UpgradeSheet`; estimate wizard 2×; takeoff 1×; onboarding checklist order correct; the "try it" step runs free; email signup has no confirm-password and does not eject to inbox; sample project present on first home.

## Out of scope (queued separately)

Guest mode; onboarding gate-screen reduction; paywall visual re-skin; all marketing-site work; the other three audit threads.
