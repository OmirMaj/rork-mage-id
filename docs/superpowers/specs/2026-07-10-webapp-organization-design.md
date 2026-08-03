# Web App Organization & Polish — Design Spec

**Date:** 2026-07-10
**Status:** Directions approved → spec for review. Implementation is **phased**; each phase becomes its own implementation plan + PR.
**Surface:** The **web / desktop** build of the Expo app (`app.mageid.app`) — secondary but supported. Mobile is out of scope.
**Ship path:** OTA-safe throughout (JS + styling only; no native modules).
**Grounding:** the 2026-07-10 web-app UX audit (6-agent codebase read + polish research).

---

## 1. Problem

The web app "gets lost easily" and reads as "vibe-codey." The audit found **two root causes**, not a hundred cosmetic ones:

1. **No wayfinding scaffold.** The desktop shell (`app/(tabs)/_layout.tsx`) drops routed content into a bare `flex:1` view with **no breadcrumb / context bar** and (previously) no max-width. Three levels deep — a change-order, an RFI, a `project-detail` tile-modal — nothing on screen says which project you're in or how to climb back. Worse, `project-detail` sections open as full-screen **modals with a tiny "Back"** instead of real routes, so browser-back, deep-links, and bookmarks break.
2. **Accreted visual inconsistency.** `constants/colors.ts` ships **three unreconciled palettes** (Apple-HIG `Colors` blues/purples, editorial ink/amber/cream `Theme`, a hardcoded slate sidebar). Two header components render the page title in **two different typefaces** (Fraunces serif vs. sans). The type scale has ~10 near-identical sizes and 8 radii — no real hierarchy, mismatched card corners. That combination reads as "assembled by an AI over many prompts."

---

## 2. Goals / Non-Goals

**Goals:** make the web app feel organized, professional, and navigable — a clear location model, one coherent visual system, calmer information density.
**Non-Goals:** mobile redesign (the mobile tab bar and phone layouts are unchanged), feature/behavior changes, backend changes, new native modules.

---

## 3. Design — phased workstreams

### Phase 0 — Content width — ✅ DONE (commit a50b480)
Routed tab content is now wrapped in a centered column capped at the responsive hook's `contentMaxWidth` (1400 on desktop); extra viewport width becomes symmetric margin. **Remaining in this theme (folded into Phase 1):** the same constraint for **root-route** screens that render outside the tab shell (`project-detail`, `schedule-pro`, `change-order`, `rfi`, `aia-pay-app`, …) — delivered via the shared shell wrapper introduced in Phase 1 so the fix is universal and per-screen `maxWidth` overrides (e.g. project-detail's 1200 cap) are removed.

### Phase 1 — Wayfinding: shell context bar + breadcrumbs
**Problem:** no persistent "where am I / how do I go up" affordance; root routes have no shared shell at all.
**Design:**
- New `components/Breadcrumbs.tsx` — derives the trail from `usePathname()` + the active project from `useCoreData()`: `Home / [Project] / [Section] / [Screen]`. Every segment but the last is a `TouchableOpacity` that `router.push()`es up a level. Middle-truncate long project names; always keep root + leaf.
- New shared `components/AppShell.tsx` (or `ContentColumn`) that renders: the fixed-height context/breadcrumb bar + the centered max-width column (from Phase 0). Mounted once in `app/(tabs)/_layout.tsx` **and** wrapped around root routes so deep routes inherit both the bar and the width constraint instead of re-implementing local headers.
- Wire the existing ⌘K `openSearch` into the bar as a visible command-palette affordance.
**Key files:** `app/(tabs)/_layout.tsx`, new `components/Breadcrumbs.tsx`, new `components/AppShell.tsx`, `hooks/useResponsiveLayout.ts`, root-route screens.
**Testing:** pure-fn `scripts/validate-breadcrumbs.ts` over the trail-derivation function (pathname + project → segments/links).

### Phase 2 — Navigation semantics
**Problem:** the project-scoped sidebar groups route to **global** screens (the rail can't answer "where am I"); 22 routes are hidden behind `href:null`; `project-detail` tile modals nest 3–4 deep with broken browser-back.
**Design:**
- **Project-scope the sidebar groups** (OVERVIEW / FIELD OPS / FINANCIALS / CLIENT): gate on a selected project (dim/disable when none), route with the active project id, and show the project name as the group anchor — so the rail signposts location and gives the breadcrumb a real root.
- **Convert the highest-traffic `project-detail` tiles** (Invoices, RFIs, Change Orders) from `activeTile` full-screen modals into **real Stack routes**, so browser-back, deep-linking, bookmarking, and the Phase-1 breadcrumbs all work. Lower-traffic tiles can migrate later.
- **Surface the useful hidden routes** (construction-ai, estimate, schedule, marketplace, …) under a new "AI & Tools" sidebar group instead of deep-link-only.
**Key files:** `components/DesktopSidebar.tsx`, `app/project-detail.tsx`, `app/_layout.tsx` (new Stack routes), `app/(tabs)/_layout.tsx`.
**Risk:** routing behavior change — must preserve params/state and existing deep links; handle the no-project-selected state gracefully. **Highest effort / highest risk phase.**

### Phase 3 — Design-system consolidation
**Problem:** three palettes, two title typefaces, bloated type/radius scales.
**Design:**
- **One palette.** Adopt the editorial `Theme` as the single source of truth. Map `Colors.info` / `#007AFF` → `Theme.info`; retire `Colors.purple` / `#5856D6` and raw system greens for status; **retint the sidebar** to a dark variant of the *same* palette (deep ink from `Theme.dark.bg` `#0B0D10` / surface) with named tokens (`navSurface`, `navItemMuted`, `navItemActive`, `navItemHovered`) replacing inline `rgba(255,255,255,x)` / `#1C1C1E` in `DesktopSidebar.tsx`. Grep web screens for `Colors.info|Colors.purple|#007AFF|#5856D6` and route through `useTheme()`.
- **One header, one title typeface.** Consolidate `PageHeader.tsx` and `FeatureHeader.tsx` into one component and commit to a single title typeface (Fraunces serif — the brand). Reconcile the size hierarchy deliberately: `PageHeader` uses `serifTitle` (28) while `FeatureHeader` uses `title2` (22); pick the intended tier(s) — likely a serif token at the workflow-header size so the typeface unifies without an unwanted size jump across RFI/CO/Invoice/AIA screens.
- **Tighter scales via aliasing (no call-site churn).** Collapse `typography.ts` to ~6 real steps (13 caption / 15 body / 17 headline / 22 title / 28 / 34) and alias `bodyCompact`/`subhead`/`subheadline`/`callout` onto them. In `designTokens.ts`, pick 2 canonical radii (`control` = 8, `card` = 12) and alias 10/14/16/18 onto them so every card corner matches without touching ~740 call sites.
**Key files:** `constants/colors.ts`, `constants/typography.ts`, `constants/designTokens.ts`, `components/DesktopSidebar.tsx`, `components/PageHeader.tsx`, `components/FeatureHeader.tsx`, `hooks/useTheme.ts`.
**Risk:** palette / radius / type-size changes are **app-wide and visual** → require visual QA on a logged-in session (see §5).

### Phase 4 — Off-happy-path states
**Problem:** 61 screens use bare `ActivityIndicator`, only 51 reference `EmptyState`; dense screens show text-only empties with no CTA (e.g. estimate "No items in this estimate yet"). A generic spinner + missing empty state is the fastest "unfinished/AI" tell.
**Design:**
- Replace bare `ActivityIndicator` with a **skeleton** that mirrors the incoming layout, shown only when load > 500 ms.
- Route every empty view through the existing `EmptyState` component (icon + one-line explanation + a primary CTA where one is unambiguous). Includes the estimate empties.
- Errors get a specific message + a **retry** affordance.
**Key files:** `components/EmptyState.tsx`, a new `components/Skeleton.tsx`, plus a per-screen sweep (`app/(tabs)/estimate/index.tsx`, `app/(tabs)/(home)/index.tsx`, `app/schedule-pro.tsx`, …). Mechanical but broad; split into sub-PRs by area.

### Phase 5 — Information density
**Problem:** grids of identical cards with no focal point; `schedule-pro` crams 17+ toolbar actions in one row and stacks 3–4 alert banners; leftover `fontWeight` 700/800 on body text means nothing reads as emphasized.
**Design:**
- Introduce **one focal element per grid** (a single "what needs attention" row / hero metric above a quieter tile grid), ranked by spacing + weight + a divider — not N equal tiles.
- Group `schedule-pro`'s toolbar into **View / Actions / Tools** clusters with separators; consolidate the stacked alert banners (EarnedValue, Cleanup, SubUpdates, Weather) into **one collapsible notifications zone**.
- Sweep web body text for leftover `fontWeight` 700/800 → demote to 400/500, reserving 600/700 for the single loudest thing per row.
**Key files:** `app/project-detail.tsx`, `app/schedule-pro.tsx`, `app/(tabs)/discover/index.tsx`, `constants/typography.ts`.

---

## 4. Sequencing

Recommended order: **0 (done) → 3 → 1 → 2 → 4 → 5.**
- Phase 3 (design-system) + Phase 0 deliver the fastest, most visible "less vibe-codey" wins.
- Phases 1–2 deliver "stops getting lost" but carry the routing risk, so they follow once the visual system is coherent.
- Phases 4–5 are broad but mechanical and can be sub-divided.

Each phase is independent enough to be **its own implementation plan and PR**; do not bundle them.

---

## 5. Cross-cutting risks & the verification constraint

- **Visual verification:** the author (Claude) **cannot authenticate to the web app** (won't enter credentials), so app-wide *visual* changes — palette, radius, type-size, header typeface, toolbar restructure — must be reviewed by the user on their logged-in session before merge. Every such PR should call this out explicitly and default to owner-gated merge.
- **Routing changes (Phase 2)** must preserve params/state and existing deep links; add the no-project-selected empty state.
- **Aliasing over value-collapse:** wherever possible, consolidate scales by aliasing existing token names to canonical values rather than editing hundreds of call sites — smaller diffs, easier review.

---

## 6. Testing

No jest in the repo → verification is pure-function validators wired into `ship-check`, plus `tsc --noEmit`, `lint`, and per-phase visual QA on the user's session:
- `scripts/validate-breadcrumbs.ts` — trail derivation (Phase 1).
- `tsc` + `lint` clean on every phase.
- Visual QA checklist per phase (screens touched), reviewed by the owner.

---

## 7. Out of scope
Mobile / phone redesign, feature or behavior changes, backend, new native modules, and any non-web surface.
