# Narrow Day-One Onboarding to the Aha — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first-run flow drive a new contractor straight to the aha — seed a rate → price a bid off it → send it — with the paywall after the value.

**Architecture:** No new engine. Reorder `app/onboarding.tsx` so the rates (seed) step is terminal and hands off directly into `app/estimate-wizard.tsx` (`?onboarding=1`); the wizard, in onboarding mode, frames the moment and routes to `app/onboarding-paywall.tsx` after the bid is sent (or on leave). Import + size-band are cut from the day-one path. `completeOnboarding()` fires at the hand-off so nobody re-loops.

**Tech Stack:** React Native + Expo (Expo Router 6, typed routes), TS strict, `bun`. Change is routing/UI; verified by `npx tsc --noEmit`, `bun run ship-check`, and a driven first-run walk-through.

**Reference spec:** `docs/superpowers/specs/2026-08-06-onboarding-aha-narrowing-design.md`

---

## File structure
- **Modify** `app/onboarding.tsx` — cut import + size-band from the critical flow; make the rates step terminal; on commit/skip, `completeOnboarding()` + route to `/estimate-wizard?onboarding=1`; drop the terminal demo-seed; CTA copy → "Price your first bid →".
- **Modify** `app/estimate-wizard.tsx` — read `onboarding` param; show a framing banner; after `share()` (or on leave) in onboarding mode, `router.replace('/onboarding-paywall')`.
- **Reference** `app/onboarding-paywall.tsx` (dismiss → `/(tabs)/summary`, unchanged) and `app/persona-select.tsx` (contractor/both → `/onboarding`, unchanged).

---

## Task 1: Onboarding reorders to a seed-terminal that hands off to the wizard

**Files:** Modify `app/onboarding.tsx` (step machine; import step ~228/338/343; rates step ~231/354/365; `finishToHome` ~278-286; `handleRatesCommit` ~354; size-band/routing ~534/553; import ~619; rates ~700).

- [ ] **Step 1: Read the step machine.** Read `app/onboarding.tsx` — understand the `step` state values and their order (splash → preview → routing(size-band) → import → rates → finish), how `setStep` advances, and `finishToHome` (~278-286): it calls `completeOnboarding()` then `router.replace('/onboarding-paywall')`, and optionally seeds a demo. Note the rates commit (`handleRatesCommit` ~354, calls `addSeeds` then `finishToHome`) and the rates skip (~365).

- [ ] **Step 2: Cut size-band + import from the critical path.** Remove the **routing (size-band) step** and the **import step** from the step sequence so the flow is: splash → preview → **rates** (terminal). Do NOT delete the import/leads capability elsewhere in the app — only remove these two steps from the onboarding sequence. Where the old size-band value fed `finishToHome`'s demo-seed flavor, drop that dependency (see Step 4 — the terminal no longer demo-seeds). Keep the `onboarding_rates_*` track calls exactly as they are; the `onboarding_import_*` calls are removed with the step (they no longer fire on day one — acceptable, import is deferred). Confirm the preview's final card CTA now advances to the rates step.

- [ ] **Step 3: Add the hand-off route + CTA copy.** Add a helper for the terminal route so both commit and skip share it:
```ts
const goPriceFirstBid = useCallback(async () => {
  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  await completeOnboarding();                     // mark hasSeenOnboarding — no re-loop
  router.replace('/estimate-wizard?onboarding=1' as never);
}, [router]);
```
Change the rates step's **primary CTA** copy to **"Price your first bid →"** and its handler to: run `addSeeds(...)` (the existing commit) **then** `await goPriceFirstBid()` (instead of `finishToHome`). Change the **secondary/skip** control copy to **"I'll add rates later"** and its handler to `await goPriceFirstBid()` (no seeds — the wizard will price ungrounded; still routes into the arc). Keep the honest "rates you set — never counted as closed jobs" note.

- [ ] **Step 4: Drop the terminal demo-seed.** In the new terminal path (`goPriceFirstBid`), do NOT call `runDemoSeed`/`suggestedDemoFlavorForBand` — the user is about to make a real first estimate, and import (the thing demo-seed compensated for) is deferred. Remove the now-unused size-band → demo-flavor wiring if it's dead after Step 2 (rely on `npx tsc --noEmit` + a grep to confirm `suggestedDemoFlavorForBand`/`runDemoSeed` aren't referenced elsewhere before deleting; if referenced elsewhere, leave them).

- [ ] **Step 5: Typecheck + commit.**
Run: `npx tsc --noEmit` (zero errors).
```bash
git add app/onboarding.tsx
git commit -m "feat(onboarding): rates step is terminal and hands off to the first-bid wizard"
```

---

## Task 2: Estimate wizard — onboarding mode frames the moment and routes to the paywall

**Files:** Modify `app/estimate-wizard.tsx` (param read via `useLocalSearchParams`; `share()` ~449-475; result/share CTA ~1002; grounding ~289-317 unchanged).

- [ ] **Step 1: Read the onboarding param.** In `app/estimate-wizard.tsx`, read the `onboarding` search param (the file already uses `useLocalSearchParams`/`useGlobalSearchParams` for `projectId` etc. — follow that). Define `const isOnboarding = params.onboarding === '1';`.

- [ ] **Step 2: Framing banner.** When `isOnboarding`, render a light banner near the top of the wizard content: title **"Your first bid"**, subtitle **"Priced off your rate — send it when it looks right."** Use the file's existing card/banner styles + design tokens (no raw hex/fontSize). Do NOT alter the grounding logic — the wizard already grounds on the seeded rate (`costDb`/`groundingFacts`), so `used_learned_costs` is already correct. If the user skipped seeding, the existing grounding line already says "priced from market averages" — leave that honest behavior.

- [ ] **Step 3: Route to the paywall after send (onboarding mode only).** In `share()` (~449-475), after the existing `track(AnalyticsEvents.ESTIMATE_SHARED, …)` succeeds, add: `if (isOnboarding) router.replace('/onboarding-paywall' as never);`. This is the value-first paywall moment. Gate strictly on `isOnboarding` so normal wizard sharing is unaffected.

- [ ] **Step 4: Route to the paywall on leave (onboarding mode only).** So a user who generates but doesn't send (or backs out) still hits the paywall exactly once: when `isOnboarding` and the user leaves the wizard via its back/close control, `router.replace('/onboarding-paywall')` instead of the default back. Find the wizard's header back/close handler; when `isOnboarding`, override it to go to the paywall. (If the wizard has no custom back handler and relies on the native header, add a `Stack.Screen` `headerLeft`/`headerBackVisible` override or an in-content "Done" affordance that, in onboarding mode, routes to the paywall — pick the lightest option that guarantees the paywall shows once.) Do NOT change non-onboarding back behavior.

- [ ] **Step 5: Typecheck + commit.**
Run: `npx tsc --noEmit` (zero errors).
```bash
git add app/estimate-wizard.tsx
git commit -m "feat(onboarding): first-bid wizard frames the moment and routes to the value-first paywall"
```

---

## Task 3: Verify the arc end-to-end + ship-check

**Files:** none (verification), unless a fix is needed.

- [ ] **Step 1: Full ship-check.** Run `bun run ship-check` → green (typecheck + lint + validators; if `validate-activation-gating.ts` exists it must stay green). Fix anything flagged.

- [ ] **Step 2: Route-correctness read-through.** Confirm by reading:
  - `completeOnboarding()` fires exactly once, at the hand-off (`goPriceFirstBid`) — a mid-arc bail does not re-loop the intro (`hasSeenOnboarding` is set).
  - The paywall is reached exactly once per first run: via the wizard's send route OR its onboarding-mode leave route — never both, never zero. Trace the two paths.
  - Non-contractor personas (`client`/`property_manager`) still bypass this arc (`persona-select` routes them to home directly — unchanged).
  - Normal (non-onboarding) wizard usage is unaffected (`isOnboarding` false → no banner, no paywall route).

- [ ] **Step 3: Driven walk-through (sim/web, fresh state).** With a fresh account/local state, drive: signup → persona (contractor) → onboarding → the rates step shows **"Price your first bid →"** → seed one rate → lands in the wizard with the **"Your first bid"** banner and a grounded estimate → send → lands on the **paywall** → dismiss → home. Also verify the skip path ("I'll add rates later" → wizard → paywall) and the bail path (leave wizard → paywall once). Capture before/after where possible.

- [ ] **Step 4: Commit any fixes.**
```bash
git add -A && git commit -m "chore(onboarding): arc routing verified; ship-check green"
```

---

## Self-review — spec coverage
- Seed step terminal + hand-off into wizard (`?onboarding=1`), CTA "Price your first bid", `completeOnboarding` at hand-off → Task 1. ✓
- Import + size-band cut from day-one path (still reachable elsewhere); drop terminal demo-seed → Task 1. ✓
- Wizard onboarding-mode banner; route to paywall after send AND on leave (once) → Task 2. ✓
- Paywall value-first (after the aha); non-contractor personas + normal wizard unaffected → Tasks 2, 3. ✓
- Funnel events unchanged (`onboarding_rates_completed`, `estimate_generated[used_learned_costs]`, `estimate_shared`) → not moved/renamed (verify Task 3). ✓
- Edge cases (skip seed, bail, hasSeenOnboarding timing, personas, no-double-paywall) → Task 3 verification. ✓

No placeholders; route string `/estimate-wizard?onboarding=1`, param check `params.onboarding === '1'`, `isOnboarding`, and the paywall route `/onboarding-paywall` are consistent across Tasks 1–2. Large-file tasks start by reading the cited anchors before editing (the onboarding step machine and the wizard's param/share/back handlers are read first; target behavior + exact routes given in lieu of line-exact code for these 1200–2800-line files).
