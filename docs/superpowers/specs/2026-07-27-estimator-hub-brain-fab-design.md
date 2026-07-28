# Design — Estimator Hub, Estimate Redesign & MAGE ID Brain FAB

**Date:** 2026-07-27
**Status:** Draft for review
**Scope:** Three coordinated workstreams from the phone-audit pass. Quick wins (#1 Take Photo in Photos, #2 mobile schedule label consistency) are already shipped to the working tree and are **out of scope** for this doc.

This spec covers three independent-but-related workstreams. They share the existing design language, and the Brain (workstream C) is surfaced inside the estimator (workstream B), so they are documented together. They can be **implemented and shipped in sequence** — A, then B, then C — each behind its own plan.

---

## Guiding principle: no AI slop

Every screen here reuses the app's **existing** design system and grounding model. We invent no new visual language and no new "chatbot." Concretely:

- Build on existing primitives: `Card`, `IconWrapper`, `Badge`, `Button`, `EyebrowLabel` (`components/ui/`), the `BrandBackdrop` gradient (`components/BrandBackdrop.tsx`), and the token sets in `constants/designTokens.ts` / `colors.ts` / `typography.ts`.
- Answers stay **deterministic and cited** — the existing One Mind engine (`utils/oneMind/`, `app/ask.tsx`) assembles fact blocks from real records and cites them as tappable chips. No free-form generation of numbers.
- Replace hardcoded values (e.g. `#FF6A1A`) with theme tokens so everything themes correctly.

---

## Workstream A — Master Estimate tab (hub)

### Problem

Estimating is spread across **11 routes** with **3 separate creation entry points** (Quick Wizard, Full Estimator, AI Takeoff) plus 4 analytics screens, reached inconsistently from `CreateMenu`, `DesktopSidebar`, and deep links. The Full Estimator tab is registered but hidden (`href: null`), so there is no single front door.

### Inventory (keep all; just give them one door)

| Purpose | Route | File |
|---|---|---|
| Quick Estimate wizard | `/estimate-wizard` | `app/estimate-wizard.tsx` |
| Full Estimator (line items) | `/(tabs)/estimate` | `app/(tabs)/estimate/index.tsx` (~5.7k lines) |
| AI PDF Takeoff | `/takeoff` | `app/takeoff.tsx` |
| Takeoff → priced estimate | `/takeoff-estimate` | `app/takeoff-estimate.tsx` |
| Visual/area takeoff | `/area-takeoff` | `app/area-takeoff.tsx` |
| Bid vs actual accuracy | `/estimate-accuracy` | `app/estimate-accuracy.tsx` |
| Estimate risk score | `/estimate-confidence` | `app/estimate-confidence.tsx` |
| Cross-job bias correction | `/estimate-calibration` | `app/estimate-calibration.tsx` |
| Projected margin at completion | `/living-estimate` | `app/living-estimate.tsx` |
| Invoice from estimate lines | `/bill-from-estimate` | `app/bill-from-estimate.tsx` |

### Design

Repurpose the **already-registered `estimate` tab** (currently `href: null`) as the visible **Estimate hub**, rather than adding a brand-new tab name:

1. **Move** the current heavy Full Estimator from `app/(tabs)/estimate/index.tsx` → `app/(tabs)/estimate/full.tsx` (route `/(tabs)/estimate/full`).
2. **New** `app/(tabs)/estimate/index.tsx` becomes the hub landing screen — a `BrandBackdrop` hero + a small grid of `Card`s:
   - **Create** group: *Quick Estimate* → `/estimate-wizard`, *AI Takeoff* → `/takeoff`, *Visual Takeoff* → `/area-takeoff`, *Full Estimator* → `/(tabs)/estimate/full`.
   - **Insights** group (one row of compact cards): *Accuracy*, *Risk / Confidence*, *Calibration*, *Living Estimate* → their existing routes.
3. **Tab registration** (`app/(tabs)/_layout.tsx`): flip `estimate` from `href: null` to a visible tab titled **"Estimate"** with a `Calculator` (lucide) icon, positioned between `(home)` and `discover`. Gate visibility by persona (visible for Contractor / Project Manager / Scheduler; hidden — `href: null` — for minimal personas like Homeowner, matching the existing `isMinimalPersona` pattern).
4. **Update entry points** to route into the hub: `components/DesktopSidebar.tsx` "Estimate" → hub; `components/CreateMenu.tsx` keeps the direct *Quick Estimate* / *AI Takeoff* shortcuts (fast paths) but they now also live in the hub. `app/(tabs)/discover/estimate.tsx` redirect → hub.

### Boundaries

- **Unit:** hub screen. **Does:** render entry cards, route out. **Depends on:** router, `useTierAccess`, persona. Owns no estimate state.
- The moved Full Estimator keeps its `MaterialCartContext` and all behavior byte-for-byte; only its file path/route changes.
- Deep links and existing routes to the sub-screens stay valid (no route deletions except the internal index→full move).

### Testing

- New `scripts/validate-estimate-hub.ts`: assert the hub's entry list maps every advertised destination to a real route string, and that persona gating returns the expected visible/hidden set. Add to `ship-check`.
- Manual: tab appears for Contractor; every card navigates; Full Estimator still loads with cart intact.

---

## Workstream B — Premium redesign of the estimate screens

### Problem

`app/estimate-wizard.tsx` and `app/(tabs)/estimate/*` look "dull and cheap": flat cart rows, hardcoded `#FF6A1A`, no depth/tinted-icon treatment, no press feedback, plain text toggles — while the rest of the app (login, `ProjectCard`, `ClientHome`) is polished.

### Design

Rebuild the estimate surfaces on the existing premium patterns — **adoption, not reinvention**:

- **Hero:** `BrandBackdrop` gradient behind the estimate total / wizard header.
- **Line items & cart rows:** `Card` + `IconWrapper` (trade/material icon in a soft-tinted square) instead of bare `TouchableOpacity` rows; `Badge` for tags/units; `Tokens.shadow.medium` on expanded sections.
- **Feedback:** spring press scale (Reanimated, the `ProjectCard` recipe) + haptics on cards.
- **Type:** `serifHeadline` (Fraunces) for section titles; `Type.*` sizes throughout; **remove hardcoded `#FF6A1A`** → `themeColors.accent`.
- **Brain inline (bridge to C):** as the user builds, surface per-line **risk/confidence** from the existing engine (`app/estimate-confidence.tsx` logic) as an inline `Badge` (e.g. "Underpriced vs your history"), and an estimate-level confidence chip — grounded in the user's own cost database, cited.

### Boundaries

- Purely presentational refactor of existing screens. **No change** to `MaterialCartContext`, pricing math, or persisted `Estimate` shape.
- Extract repeated row markup into a local `EstimateLineCard` component so the screen file shrinks and stays reasoning-sized.

### Testing

- `scripts/validate-app-slop.ts` already guards against hardcoded colors / off-token styling — run it; the redesign must pass it (this is our objective "no slop" gate).
- Snapshot/manual: wizard and full estimator render with new treatment; totals and math unchanged (existing estimate validators still green).

---

## Workstream C — MAGE ID Brain floating button (full replace)

### Problem

"AI" is scattered across **five** surfaces: two home cards (*Ask MAGE* → `/ask`, *MAGE Copilot* → `/copilot-hub`, in `app/(tabs)/(home)/index.tsx:530-575`), a 3-FAB speed-dial (`HomeFabStack` = `AICopilot` + `UniversalMicButton` + `HelpFab`, home only), standalone `AICopilot` FABs on `schedule` and `estimate`, and Cmd+K `UniversalSearch` (global, via `SearchContext`). The **Brain** (`utils/brainWatch.ts`, `hooks/useBrainWatch.ts`, One Mind) is the real intelligence; these are just inconsistent doors to it.

### Design

**One Brain FAB, app-wide, search-first**, replacing all of the above.

**New pieces:**
- `contexts/BrainContext.tsx` — global open/close + open-target state (`openBrain(mode?)`). Extends/replaces `SearchContext` (keep Cmd+K → `openBrain('search')`; migrate `mageid_recent_searches`).
- `components/brain/BrainFab.tsx` — single floating action button (reuse `AICopilot`'s geometry: `bottom: insets.bottom + 70 (+48 web)`, `right: 20`, 56pt), a distinct **Brain mark** (not the current generic `MageAIMark`). Auto-hides on scroll like the current FAB. Mounted **globally** in `app/_layout.tsx` (where `UniversalSearch` is today) so it's on every screen.
- `components/brain/BrainSurface.tsx` — the unified panel the FAB opens. **Search-first:** one autofocused input at top; typing runs both lanes live —
  - **Find:** feature registry (`utils/featureRegistry.ts`) + entity search (`hooks/useUniversalSearch.ts`) — exactly today's `UniversalSearch` behavior.
  - **Ask:** if the query reads as a question, run One Mind (`app/ask.tsx` / `utils/oneMind/`) and render cited fact-block chips inline.
  - **Voice:** mic affordance in the bar → existing `UniversalMicButton` capture.
  - **What needs you now:** below the empty-query state, the `useBrainWatch()` attention feed (top items, tappable → real screens) instead of only "recent searches."

**Removals (the "full replace"):**
- Delete the two home AI cards (`app/(tabs)/(home)/index.tsx:530-575`).
- Remove `HomeFabStack` from home and standalone `AICopilot` from `schedule` / `estimate` (their capabilities now live in the Brain surface). `HelpFab` capability folds into the surface (a "Help" affordance) or a settings entry — TBD-free decision: **fold Help into the Brain surface footer**.
- Replace the global `UniversalSearch` mount with `BrainSurface`.
- Keep `/ask` and `/copilot-hub` as **routes** (the surface can push to `/copilot-hub` for full voice workflow building); they are no longer primary entry points but remain reachable, so no capability is lost.

### Boundaries

- **Unit:** `BrainContext` (open/close state) — no UI. **Unit:** `BrainFab` (button only) → calls `openBrain`. **Unit:** `BrainSurface` (the panel) — composes existing search/ask/voice/watch modules; owns no new intelligence. Each is independently testable.
- The Brain **intelligence** layer (`brainWatch`, One Mind) is untouched — we only re-wire the UI doors to it.

### Testing

- Reuse `scripts/validate-feature-search.ts` (feature-registry lane unchanged).
- New `scripts/validate-brain-surface-routing.ts`: given a query classification (find vs ask vs voice), assert the surface dispatches to the correct lane, and that attention-feed items carry valid route strings. Add to `ship-check`.
- Manual: FAB visible on home / schedule / estimate / project-detail; Cmd+K still opens it; search, ask (cited), voice, and "what needs you" all work; no orphaned old FABs or home cards remain.

---

## Sequencing & risk

1. **A (hub)** — lowest risk, mostly routing + one file move. Ship first.
2. **B (redesign)** — presentational; gated by `validate-app-slop`. Ship second; benefits from A's hub existing.
3. **C (Brain FAB)** — highest blast radius (global mounts, deletions across home/schedule/estimate). Ship last, on its own plan, with careful before/after of every removed surface so nothing is silently dropped.

Each workstream gets its own implementation plan via the writing-plans skill after this design is approved.
