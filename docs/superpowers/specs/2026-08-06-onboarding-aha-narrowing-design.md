# Narrow Day-One Onboarding to the Aha (Design Spec)

_Date: 2026-08-06. Phase 2 activation thread ("prove it converts"). Make the first-run flow drive a new contractor straight to the aha the funnel measures — seed a rate → price a bid off their own numbers → send it — with the paywall AFTER the value, not before._

## Goal & exit condition

**A new contractor's day-one path climaxes in the aha: they seed a rate, immediately price their first bid off it (`used_learned_costs=true`), and send it — before any paywall.** Success = the activation funnel (built in Phase 2) actually lights up because the flow *leads* users to `estimate_generated[used_learned_costs=true]` → `estimate_shared`, instead of seeding then dumping them on a paywall/home to find the estimate themselves.

## Current state (the disconnect — verified)

The pieces exist but aren't connected:
- Onboarding (`app/onboarding.tsx`) already has a **seed-rates step** (fires `onboarding_rates_*`) and an **import step**, but they sit between 5 preview cards + a size-band question, and both are skippable.
- The **estimate wizard already grounds on seeded rates** (`app/estimate-wizard.tsx` `costDb`/`groundingFacts`/`estimateGroundingProps` ~289-317, 387) → fires `estimate_generated` with `used_learned_costs=true`; **share already fires** `estimate_shared` (~449-475).
- But onboarding ends by routing to the **paywall, then home** (`finishToHome` ~278-286: `completeOnboarding()` → `router.replace('/onboarding-paywall')`). The estimate is then only offered as a *separate, later, skippable* nudge via the home `OnboardingChecklist` (`components/OnboardingChecklist.tsx`, item `'tryit'` → `/estimate-wizard`).
- Net: a new user seeds a rate and is **dumped on the paywall/home** — the aha is scattered and optional, and the paywall arrives *before* the "wow" (contradicting onboarding's own copy: *"See the wow before anything asks you to upgrade"*).

## Decisions (locked)

1. **Approach: connect existing steps into one aha arc.** Reuse the seed step + wizard + share; reroute so seeding hands off directly into the wizard, then send. No new engine, no new dedicated flow.
2. **Paywall after the aha (value-first).** The onboarding-paywall moves to *after* the first-bid attempt, honoring "wow before upgrade."

## The narrowed arc

```
signup → persona-select (contractor/both)
  → onboarding: splash → preview cards  (lean intro, kept)
  → SEED A RATE            (existing rates step — now the climax)
  → PRICE YOUR FIRST BID   (estimate-wizard ?onboarding=1, grounded on the seed)
  → SEND IT                (share → estimate_shared)
  → paywall (value-first)  → home
```

Cut from the day-one critical path: the **size-band question** and the **import step** (both remain reachable in-app later; import via the existing data-import/leads screens, size-band via a sensible default). The lean splash + preview cards stay (they motivate).

## Changes (concentrated in 3 surfaces; engines untouched)

### A. `app/onboarding.tsx` — reorder to the aha, hand off to the wizard
- **Remove the size-band (routing) step and the import step from the critical flow.** Keep splash + preview. The **rates step becomes the terminal onboarding step.** (Default the demo-seed flavor that size-band used to pick to `'medium'`, which is already `finishToHome`'s fallback when band is null.)
- **Rates step CTA → "Price your first bid →".** On commit (`handleRatesCommit` ~354, after `addSeeds`), instead of `finishToHome`: call `completeOnboarding()` (mark `hasSeenOnboarding`, so no re-loop) and **`router.replace('/estimate-wizard?onboarding=1')`**.
- A secondary, de-emphasized **"I'll add rates later"** still routes into the wizard in onboarding mode (an ungrounded first estimate is still valuable; the funnel simply won't count it as the aha) — same `completeOnboarding()` + `/estimate-wizard?onboarding=1`. Keep the honest "rates you set — never counted as closed jobs" note.
- The `finishToHome` demo-seed behavior (seed a demo project when the user imported no real clients) is no longer needed on this path since import is deferred; drop the demo-seed from the onboarding terminal (the user is about to make a *real* first estimate). Keep `completeOnboarding()`.

### B. `app/estimate-wizard.tsx` — onboarding mode: frame it, and route to the paywall after send
- Read the `onboarding` search param. When `onboarding=1`:
  - Show a light **framing banner**: *"Your first bid — priced off your rate."* (When the user has ≥1 seeded rate, the wizard already grounds on it; the banner just names the moment. Use the existing grounding/`BrainCard` honesty — if they skipped seeding, the banner/grounding says "priced from market averages" as it does today.)
  - After the estimate is generated **and the user sends it** (`share()` → `estimate_shared`, ~449-475), **route to `/onboarding-paywall`** (the value-first paywall). 
  - If the user leaves the wizard in onboarding mode without sending (back/close), route to `/onboarding-paywall` as well (so the paywall shows exactly once, after the aha-attempt), then it hands to home. Gate all of this on `onboarding=1` so normal wizard usage is unaffected.

### C. `app/onboarding-paywall.tsx` / routing — paywall shows once, after the arc
- The paywall is now reached from the wizard's onboarding-mode exit (post-send or on leave), not from `onboarding.tsx`. Its existing dismiss (`handleClose` → `/(tabs)/summary`) is unchanged.
- Ensure a user who bails entirely (e.g., closes the wizard) still passes through the paywall once via the wizard's onboarding-mode exit route above. No separate home-entry paywall gate is added (avoids double-show); the wizard-exit route is the single funnel to the paywall for first-run.

### Safety net (unchanged, keeps working)
- The home `OnboardingChecklist` still nudges "price your first bid" for anyone who didn't complete the aha in the guided session — it already flips `triedWowFeature` when `estimateCount>0`. It remains the catch-all after day one.

## Instrumentation (already built — this makes it fire)
No new events. The arc is designed to drive the Phase-2 funnel: `user_signed_up → project_created(is_first_project) → onboarding_rates_completed/cost_rates_seeded → estimate_generated[used_learned_costs=true] → estimate_shared`. The narrowing's success metric is the seed→aha and aha→shared conversion on the existing **Activation** dashboard.

## Non-goals / deferred
- No change to the estimate/grounding engine, the paywall's offering, or the funnel events.
- Import and size-band are *deferred from day one*, not deleted — they stay reachable in-app.
- Not building a new bespoke 3-step guided UI (rejected Approach B).
- The value-first-landing marketing thread and Phase 3 remain separate.

## Edge cases
- **Skipped seeding:** still routes into the wizard (ungrounded first estimate); not the aha but still value; paywall after.
- **Bail from wizard:** routes through the paywall once, then home; the checklist re-nudges.
- **`hasSeenOnboarding` timing:** set at the hand-off into the wizard, so a mid-arc bail doesn't re-loop the intro on next launch.
- **Returning / client / property-manager personas:** unaffected — `persona-select` already routes non-contractors straight to home (`completeOnboarding` + `/(tabs)/(home)`); only contractor/both enter this arc.
- **No estimate wizard access (tier/gating):** the quick estimate wizard is the free "wow" path (per onboarding copy) — confirm it's reachable pre-paywall on day one; if gated, the banner/flow must not dead-end (route to paywall/home gracefully).

## Testing & ship discipline
- `bun run ship-check` green (typecheck + lint + validators). If an onboarding/activation validator exists (`validate-activation-gating.ts`), keep it green; add a small pure check only if a genuine contract emerges (e.g., a `nextAfterOnboardingSeed()` router helper).
- Mostly routing/UI: verify by reading + `tsc`, and drive the first-run flow in the sim/web (fresh account/local state) to confirm seed → wizard(grounded) → send → paywall → home.
- Keep the funnel events firing at the same points (don't move/rename `onboarding_rates_completed`, `estimate_generated`, `estimate_shared`).

## Risks
- **Routing correctness** across the arc (onboarding → wizard → paywall → home) with `hasSeenOnboarding` set at the right moment — the highest-risk seam; must not leave a user stuck or re-looped, and must not double-show the paywall.
- **Deferring import/size-band** must not orphan their capability — confirm both remain reachable elsewhere before removing from onboarding.
- **Wizard onboarding-mode** must not leak into normal wizard usage (strictly gate on `onboarding=1`).
