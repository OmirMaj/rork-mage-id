# 2026-05-21 — Web App UX Audit (app.mageid.app)

**Scope:** Web-specific UX audit of the Expo for Web build served at `app.mageid.app` (Netlify site `mageid-app`, `bd8356d7-...` → no, separate from marketing — confirmed via `netlify sites:list`). This audit is the **web counterpart** to `docs/workflow-audit-roadmap.md`, which covers UX patterns shared across iOS/Android/web. Items here are issues that surface only (or worst) on the web build.

**Method:** Live browser inspection via Chrome MCP (navigate + JS DOM queries) + code-side audit of `Platform.OS === 'web'` branches across `app/` (30 occurrences) and `components/DesktopSidebar.tsx`.

**Authentication note:** The audit ran against an authenticated session (cached cookies). Public flows (signup, magic-link) not walked — they need a clean profile or a fresh device profile to test cleanly.

**Total findings:** 14 (4 HIGH, 7 MEDIUM, 3 LOW). Most are quick to fix; none require new infrastructure.

---

## HIGH severity (real blockers / regressions)

### W1 — Document titles are identical on every route
**Evidence:** `document.title === "MAGE ID"` on `/`, `/paywall`, `/budget-dashboard`, `/settings`, all checked via JS in Chrome MCP. Browser tabs are indistinguishable; bookmarks all look identical; share-as-link previews are useless.

**Root cause:** `Stack.Screen options={{ title: 'X' }}` in `app/_layout.tsx` (lines 327-333+) sets the React Navigation in-app header title only. React Navigation does NOT propagate that to `document.title` on web — Expo Router web doesn't ship that bridge.

**Fix:** Add a `useDocumentTitle(name)` hook (or a `<DocumentHead title={...}>` component) that mirrors the Stack.Screen `title` into `document.title` when `Platform.OS === 'web'`. Wire one call per top-level screen (~20 screens with bookmarkable titles). Estimated effort: 1-2 hours.

### W2 — No `<h1>` on most routes (a11y + SEO)
**Evidence:** JS query `document.querySelector('h1')`:
- `/` → NONE
- `/paywall` → NONE
- `/budget-dashboard` → "Budget Dashboard" (the only one found)
- `/settings` → NONE

**Root cause:** React Native `<Text>` renders to `<div>` on web by default. There's no `accessibilityRole="header"` discipline that promotes a primary header to `<h1>`. The one exception (`/budget-dashboard`) likely uses an explicit `accessibilityRole` or a styled `<Text>` that happens to render as `<h1>`.

**Fix:** Define a `<ScreenTitle>` wrapper that, on web, renders as `<h1>` (via `accessibilityRole="header"` + `aria-level={1}`). Use it on every top-level route's primary title. Same ~20 screens as W1.

Impact when fixed:
- Reader-mode (Safari, Firefox) works
- Screen readers can announce page context
- SEO crawlers see proper document outline
- Browser bookmarks / share-API titles auto-populate sensibly

### W3 — Paywall route is broken on web (permanent loading splash)
**Evidence:** `/paywall` route loads the MAGE ID loading splash and never resolves. After 4+ seconds: `focusable: 1` (the splash itself), `h1: NONE`. The page never reaches the actual paywall content.

**Root cause:** `react-native-purchases` (RevenueCat) doesn't initialize on web — it's a native-only SDK. `app/paywall.tsx` likely awaits the package data before rendering, and on web that promise never resolves. The paywall is web-dead.

**Fix options:**
1. **Web-fallback paywall** — detect `Platform.OS === 'web'` in paywall.tsx and render a web-specific view that either: (a) shows the tier table read-only and deep-links the user to the iOS/Android app for purchase, or (b) integrates a Stripe Checkout fallback for web-only purchases (larger scope).
2. **Redirect to native CTA** — `Platform.OS === 'web' && <RedirectToAppStore />` — simpler, ships the friction to App Store / Play Store.

Either is shippable; pick based on whether web-paid signups are a viable revenue path (likely option 1, since most paid features need the native app anyway).

### W4 — Sidebar doesn't highlight active state on non-tab routes
**Evidence:** Visited `/settings` while sidebar showed "Projects" (the previous active item from `/`). No item in the sidebar visually indicates the user is on Settings. The active highlight only updates for tab-bar routes.

**Root cause:** `components/DesktopSidebar.tsx` likely compares `pathname` against a fixed list of tab routes, not against ALL sidebar items. Routes not in the tab list (Settings, Budget Dashboard, Cash Flow, etc.) never light up.

**Fix:** In DesktopSidebar, compare `pathname` against each sidebar item's `href` and apply active styles whenever they match (not just for tabs). Sidebar items already have their hrefs — just extend the active-test to all of them.

---

## MEDIUM severity (a11y + discoverability)

### W5 — No HTML5 semantic landmarks
**Evidence:** `document.querySelector('main, [role="main"]')` → `false` on every route. Same for `<nav>`, `<footer>`. The entire app is `<div>`-only.

**Impact:** Screen readers can't jump to main content. Keyboard "skip to content" links can't function. Browser reader mode falls back to heuristics. Lighthouse a11y won't score above 90.

**Fix:** Wrap the root view in `accessibilityRole="main"` (renders as `<main>` on web), the DesktopSidebar in `accessibilityRole="navigation"`, and any persistent footer in `accessibilityRole="contentinfo"`. Single-touch fix in `app/_layout.tsx` + `DesktopSidebar.tsx`.

### W6 — Very low focusable-element count
**Evidence:** JS count of `[tabindex]:not([tabindex="-1"]), button, a[href], input, select, textarea`:
- `/` → not measured but visually many; estimated `<10`
- `/paywall` → 1
- `/budget-dashboard` → 1
- `/settings` → (high — has toggles, but still uses `Pressable` which may not be tab-focusable)

**Root cause:** `Pressable` and `TouchableOpacity` from React Native don't always set `tabindex=0` on web. Buttons without proper focus markers are mouse-only.

**Fix:** Audit every top-level Pressable/TouchableOpacity and either: (a) add `accessibilityRole="button"` (which RN Web maps to `<button>` and gets focusability), or (b) use the `<Button>` from `@/components` if one exists with the right web defaults baked in.

### W7 — No `aria-label` coverage
**Evidence:** `/budget-dashboard` has 0 `[aria-label]` elements. Icon-only buttons (mic, AI star, notifications, sidebar collapse) are unlabeled for screen readers.

**Fix:** Every icon-only Pressable needs `accessibilityLabel="..."`. RN Web converts that to `aria-label`. Same audit pattern as W6.

### W8 — No meta description (HTML head)
**Evidence:** `document.querySelector('meta[name="description"]')` → `NONE`.

**Impact:** Social share previews (Twitter/iMessage/Slack) show no description. Search engines see only the title (which is also broken — see W1).

**Fix:** Add a default `<meta name="description">` to the web HTML template (likely `web/index.html` or wherever Expo generates the HTML root). Per-route descriptions would be nice but the static default already fixes the worst case.

### W9 — No theme-color meta
**Evidence:** `document.querySelector('meta[name="theme-color"]')` → `NONE`.

**Impact:** Browser chrome (URL bar, status bar on mobile web) doesn't tint to MAGE ID's amber/ink palette. App feels less native on web.

**Fix:** Add `<meta name="theme-color" content="#0B0D10">` (or amber, depending on theme) to the HTML template.

### W10 — No web manifest (no PWA install)
**Evidence:** `document.querySelector('link[rel="manifest"]')` → `NONE`.

**Impact:** Web users can't "Add to Home Screen" / "Install app" to get a standalone app-like experience. Bookmarking is the only option.

**Fix:** Add `web/manifest.webmanifest` with the app metadata (name, icons, theme_color, background_color, display: "standalone", start_url: "/"). Reference it via `<link rel="manifest" href="/manifest.webmanifest">`. Free upgrade — PWA is the modern web-app default.

### W11 — No structured data (JSON-LD)
**Evidence:** `document.querySelectorAll('script[type="application/ld+json"]').length === 0`.

**Impact:** Search engines can't understand the app's content surfaces. Mostly an SEO issue (less critical for an authenticated SaaS).

**Fix:** Less urgent. Could add a single Organization JSON-LD to the HTML template (logo + name + contact). Per-route JSON-LD is overkill for an auth-gated app.

---

## LOW severity (polish)

### W12 — Floating buttons overlap content
**Evidence:** Screenshot of `/`: the floating mic + AI star buttons (bottom-right) overlap with the "Active" projects label and project rows when scrolled to certain positions. On native they're isolated by safe-area; on web there's no safe-area padding.

**Fix:** Add web-specific safe-area padding (or absolute-position offsets) when `Platform.OS === 'web'`. The buttons should hover slightly higher to clear content.

### W13 — Responsive design not testable via Chrome MCP `resize_window`
**Observation (tooling, not app bug):** `mcp__Claude_in_Chrome__resize_window` resizes the OUTER window but doesn't propagate to the inner viewport (screenshots stay at 1512px wide). So I couldn't verify mobile-web UX at 375px-768px widths through the audit. Code-side: 8 `useWindowDimensions` callsites + DesktopSidebar's `Platform.OS === 'web'` branches suggest SOME responsive intent, but the actual rendered behavior at narrow widths is unverified.

**Fix:** Not actionable here. Either run Lighthouse mobile (which DOES emulate mobile viewport) for narrow-width verification, or open Chrome devtools manually.

### W14 — URL design is clean but Expo Router groups not human-readable
**Evidence:** `/(tabs)/settings` cleanly redirects to `/settings` ✓. But routes like `/aia-pay-app`, `/coi-vault`, `/punch-walk` are not bookmark-friendly for non-construction-jargon users. Not a real fix — these are domain-correct names — just noting that share-as-link URLs aren't self-describing to end clients.

---

## Strengths (what's working)

1. **DesktopSidebar exists and renders cleanly** — 377-line component with `Platform.OS === 'web'` branches for hover states + keyboard interaction. Visual quality matches the marketing site.
2. **Active route highlight works for tab routes** — Projects/Estimate/Schedule etc. all light up correctly.
3. **Right rail "Action Required"** — Submittals + COIs surfaced as a persistent action queue. Good cross-screen pattern.
4. **Empty states have copy + CTA** — "Build something" + "Create your first project" + "Try a sample project". Friendly + actionable.
5. **AI Usage progress bars on Settings** — visible quota visualization is rare in SaaS settings. Good.
6. **URL design is reasonable** — clean paths (`/settings`, `/budget-dashboard`), no `#` hashes, no query-string state for primary navigation.
7. **Cached session resumes correctly** — visited `app.mageid.app` cold, landed on authenticated home with proper data.
8. **30 `Platform.OS === 'web'` branches across `app/`** — decent web awareness, not just a "ship native and hope" port.

---

## Recommendations — prioritization

### Quick wins (2-4 hours total, all shippable in one batch)
- **W8 + W9 + W10**: meta description + theme-color + web manifest. Single edit to web HTML template + a manifest file. ~30 min.
- **W5**: semantic landmarks via accessibilityRole. 4 files touched. ~30 min.
- **W4**: sidebar active state. 1 file touched. ~20 min.

### Medium effort (3-5 hours)
- **W1**: per-route document.title via `useDocumentTitle` hook + wire into ~20 screens.
- **W2**: `<ScreenTitle>` component with `accessibilityRole="header"` + wire into ~20 screens.
- **W7 + W6**: accessibilityLabel pass + accessibilityRole="button" pass.

### Larger (own sub-project)
- **W3**: web paywall fix. Either web-fallback view or App Store redirect.

---

## What this audit did NOT cover

- **Mobile-web UX at <768px widths** — `resize_window` MCP tool didn't actually narrow the inner viewport; would need devtools-style emulation or a real mobile browser.
- **Auth flows** (signup, login, magic-link, password reset) — required a clean profile / logout flow which I didn't walk for cost / time reasons.
- **Full Lighthouse a11y / perf / SEO scores** on app.mageid.app — would be a useful follow-up since it'd quantify W5-W11 impact concretely.
- **Touch / keyboard / mouse interaction parity** beyond the focusable count — needs behavioral testing on real keyboard input.
- **Dark mode coverage on web** — Settings has an "Appearance" subscreen; didn't verify dark mode renders correctly on every route.
- **Performance metrics** (LCP, CLS, TBT) for the web app — would need a Lighthouse run.
- **Print stylesheets** — invoices/POs may be printed by GCs; the print preview is unaudited.
- **PWA install prompt** — N/A without a manifest (see W10).
- **Project hub (30 tile modal screens)** — those are mostly modal overlays which behave the same on native + web. Not web-specific.

---

## Cross-reference to prior audits

- **`docs/workflow-audit-roadmap.md`** — covers UX patterns shared across iOS/Android/web (StatusPipeline, carry-forward, progress indicator, voice/AI). Phases 2-5 still TODO there. This webapp-ux audit is a **separate axis** — both should run in parallel.
- **`docs/superpowers/audits/2026-05-20-app-audit-tier-abcd-findings.md`** — covered security/perimeter audit. No overlap with UX.
- **`docs/FEATURES.md`** — feature inventory. Useful for prioritizing which routes to fix W1/W2 on first (highest-traffic routes like home, projects, project-detail, schedule, estimate).
