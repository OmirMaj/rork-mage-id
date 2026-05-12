# Phase 23 — Pre-launch audit

**Date:** 2026-05-12
**Goal:** Pre-launch readiness check before pushing marketing harder. Find anything that would embarrass the app or cost a paying user trust on day one.

Severity scoring:
- **P0** — blocks launch / loses trust on first use
- **P1** — visible quality bug, fix this week
- **P2** — polish, nice-to-have

---

## P0 — blocks launch (fix before marketing push)

### 1. `marketing/lead.html` form is broken for cold visitors
- **Where:** `marketing/lead.html:213` falls back to `gcSlug = 'mage-marketplace'` when no `?gc=` URL param is present.
- **What breaks:** `supabase/functions/lead-capture/index.ts:84-92` does a `profiles.public_slug` lookup and returns `slug_not_found` (404) if the slug doesn't resolve.
- **Impact:** Every cold visitor who fills out the marketing lead form gets *"We couldn't find that contractor. Try the main marketplace at mageid.app."* — leads die on submit, right before a marketing push.
- **Fix:** Either (a) treat the `mage-marketplace` slug as a special-cased queue server-side in `lead-capture/index.ts`, or (b) seed a `profiles` row with `public_slug = 'mage-marketplace'` that owns the inbound queue. Either change requires `supabase functions deploy lead-capture` (option a) or a SQL insert (option b) — neither is OTA-able.

### 2. ✅ Privacy Policy + Terms not linked from in-app Settings — **FIXED in Phase 23**
- **Was:** No `privacy`/`terms`/`legal` links in `app/(tabs)/settings/index.tsx`. The only in-app references were in `app/paywall.tsx:160-165`. Apple Guideline 5.1.1 requires privacy disclosure accessible from "within the app" — buried in the paywall doesn't reliably count.
- **Fix shipped:** New "LEGAL" section in Settings (just above DANGER ZONE) linking Privacy Policy, Terms of Service, and Do Not Sell My Info (CA). Opens in external browser via `Linking.openURL`.

---

## P1 — visible quality bug (fix this week)

### 3. Dark mode is 96% unmigrated
- **Where:** Only 6 of 154 `app/*.tsx` screens import `useThemedColors`. 136 screens (88%) still reference `Colors.text` / `Colors.background` / `Colors.surface` inside `StyleSheet.create`.
- **Why broken:** `constants/colors.ts:7-16`'s own header comment calls out that pattern as the broken one — `StyleSheet.create` captures values at module load, so theme toggles don't propagate after first render.
- **Impact:** Users who flip to dark mode see a half-broken UI — light cards on a dark page, white text on white, etc. If dark mode is advertised, this is a trust hit.
- **Recommendation:** Either (a) ship dark mode as "Settings → home + auth screens only, more coming" with explicit copy in the toggle, or (b) pull the toggle from Settings until coverage is higher. Don't ship as-is.

### 4. Marketing site headline ships all three A/B variants in DOM (FOUC risk)
- **Where:** `marketing/index.html` ships three `<h1 class="hero-title" data-ab-variant="…">` blocks with two hidden via `style="display:none"`.
- **Why risky:** Fine if the JS variant-picker runs reliably, but if anything goes wrong (script blocked, CSS race) a cold visitor sees three stacked headlines for an instant.
- **Verify:** Test on slow-3G + ad-blocker. If FOUC visible, ship with one as the default and `data-ab-variant` swap async.

### 5. Dead heavyweight deps in bundle
- **Where:** `package.json` ships `@trpc/client`, `@trpc/react-query`, `@trpc/server`, `@hono/trpc-server`, `superjson` with **zero imports** across `app/`, `contexts/`, `utils/`, `lib/`, `components/`, `hooks/`.
- **Confirmation:** CLAUDE.md states explicitly: "tRPC has never been wired in this repo."
- **Fix:** `bun remove @trpc/client @trpc/react-query @trpc/server @hono/trpc-server superjson` → `npx tsc --noEmit` → commit. Shrinks web bundle + APK.

### 6. ~400 `console.log` statements in production paths
- **Where:** `contexts/AuthContext.tsx` 53, `utils/aiService.ts` 30, `lib/supabase.ts` logs URL/key configuration on every cold start.
- **Why risky:** Sentry redaction (`app/_layout.tsx:74-115`) catches most PII leaks, but PostHog (once wired) + the device log don't get redacted. `[Auth] deleteAccount`, `[RC] Got customer info` run on real user devices.
- **Fix:** Wrap behind `if (__DEV__)` or replace with a debug logger that no-ops in production. 400+ logs also makes the app feel chatty in TestFlight reviews.

### 7. God Components — top 5 files
- `app/(tabs)/estimate/index.tsx` 5,301 LOC
- `app/project-detail.tsx` 3,754 LOC
- `app/(tabs)/schedule/index.tsx` 3,601 LOC
- `app/daily-report.tsx` 2,902 LOC
- `app/(tabs)/settings/index.tsx` 2,528 LOC
- **Why:** These re-render on any state change. Expect UI lag complaints + slow keyboard on these screens.
- **Fix:** Not a launch blocker. File a refactor ticket — split each by tab/section into siblings with their own state.

### 8. 196 `as any` / `@ts-ignore` / `@ts-nocheck` escapes
- **Where:** Across `app/` + `contexts/`. Strict mode is on per CLAUDE.md, so these are explicit holes.
- **Fix:** Sweep the obviously-fixable ones (`grep -rn "as any" app/ contexts/`). Some are unavoidable (RC types), but 196 is high.

### 9. Verify paywall trigger sites surface Apple required copy
- **Where:** `app/cash-flow.tsx:128` and similar screens render `<Paywall>` as a JSX component instead of pushing to `/paywall`. Sample of paywall sites looks correct (`useTierAccess` + early return), but `cash-flow.tsx` imports a local `Paywall` component that may not be the same as the modal at `app/paywall.tsx`.
- **Verify:** Both paths must surface the disclosure footer ("auto-renew", "Apple ID Subscriptions"). Apple requires that copy at the trigger site, not just in the dedicated paywall route.

---

## P2 — polish (nice-to-have)

### 10. Web fallback writes password to localStorage
- `contexts/AuthContext.tsx:264` writes the password to `window.localStorage` on web (SecureStore isn't available). For web, either don't store at all or use a crypto-wrapped form.

### 11. 5 TODO comments still in the tree
- `app/time-tracking.tsx:353` ("read from settings.branding.companyName")
- `app/sub-change-requests.tsx:7,98` (wiring incomplete)
- Low count, easy sweep.

### 12. Marketing AI claim may drift from runtime
- `marketing/index.html:71` claims "172 verbatim code sections across 8 major US metros". Verify this matches `permit-qa.tsx` runtime; if metro count drifted, you're making a checkable claim that will get checked.

### 13. Dead variable in home tab
- `app/(tabs)/(home)/index.tsx:82` has `void user; // user kept available for future per-tier gates`. Either wire it or remove the variable.

### 14. Marketing pricing structured data hardcodes USD
- `marketing/index.html:79+` ld+json Offer doesn't declare a region. Fine for v1, file a ticket if you ever expand abroad.

---

## Strengths (don't break these)

- **Tier gating architecture is genuinely solid** — `hooks/useTierAccess.ts` + server-side `supabase/functions/_shared/auth.ts` use parallel rank comparison; `MASTER_EMAILS` ↔ `OWNER_EMAILS` are in sync (`utils/owner.ts:24-28`, `_shared/auth.ts:106-109`).
- **Account deletion is properly implemented** — `contexts/AuthContext.tsx:485-515` invokes a server edge function, wipes local cache, clears session and query cache. Surfaced at `app/(tabs)/settings/index.tsx:1518`. Apple 5.1.1(v) compliant.
- **Sentry has aggressive PII redaction** — strips emails, JWTs, Stripe/Supabase/Anthropic keys, last-4 SSN. `sendDefaultPii:false`, `enableLogs:false`.
- **Paywall has the subscription disclosure copy in body** — `app/paywall.tsx:373` covers auto-renew, cancel via App Store/Play Store, charge on confirmation. Apple-ready.
- **iOS Info.plist permission strings are descriptive** — `app.json:23-26+` explain camera/photos/location/microphone in user terms, not boilerplate.
- **Lead-capture is consent-gated server-side** — `supabase/functions/lead-capture/index.ts:57-59` rejects without `consent_to_privacy_terms_at` ISO timestamp. CCPA-defensible.
- **Offline-first writes via `supabaseWrite`** — well-architected and consistent across providers.
- **Owner-tier override is logged loudly** — `contexts/SubscriptionContext.tsx:216-218` makes drift between owner & customer reality obvious in console.

---

## Recommended order before pushing marketing

1. **Today (10 min):** Decide on dark mode strategy (#3) — half-broken dark mode is worse than no dark mode.
2. **Today (30 min):** Fix lead.html → lead-capture pipeline (#1) — this loses every cold lead until fixed.
3. **This week (1 hr):** Strip `console.log` from production paths (#6) + drop dead tRPC deps (#5).
4. **This week (2 hr):** Verify paywall trigger sites have Apple disclosure copy (#9).
5. **Optional:** A/B test FOUC fix (#4) — only if you actually see flickering on a slow connection.

Everything else can wait until after launch.
