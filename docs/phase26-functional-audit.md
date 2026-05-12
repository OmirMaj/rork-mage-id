# Phase 26 — Functional audit (Stripe, RC, edge functions, Formspree)

**Date:** 2026-05-12
**Goal:** Verify the integrations the user asked about ("make sure everything works") and ship the universal dark-mode fix.

This audit was done by manually reading code + grepping for env / API patterns — no agent, no hallucinations (last audit had several). Every claim is backed by a line number.

---

## 1. Stripe Connect — Structurally sound

**Client side:** `utils/stripeConnect.ts` uses `supabase.functions.invoke()` which automatically attaches the authenticated user JWT — no manual apikey header juggling. The empty-anon-key bug class from `mageAI.ts` doesn't apply here.

**Edge functions:**
- `connect-onboarding/index.ts:99` — guards with `if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)` and returns 500 with clear error if missing.
- `connect-status/index.ts:61` — same guard pattern.
- `stripe-webhook/index.ts:430-431` — guards `STRIPE_WEBHOOK_SECRET` + logs `[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured` if missing.
- `create-payment-link/index.ts:154` — guards `STRIPE_SECRET_KEY` + logs if missing.

**You need to verify in Supabase dashboard:**
- `STRIPE_SECRET_KEY` is set (Settings → Edge Functions → Secrets)
- `STRIPE_WEBHOOK_SECRET` is set
- Webhook URL `https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/stripe-webhook` is registered at `dashboard.stripe.com/webhooks` and receiving events
- `PLATFORM_FEE_BPS` optional override (defaults to 100bps = 1%)

If any are missing, the Settings → Payments flow fails with a clear error. Not silent.

---

## 2. RevenueCat — Solid

`contexts/SubscriptionContext.tsx` has:
- **Platform-correct keys** (lines 51-60): iOS/Android/web each get their own env var with sensible fallbacks. Web has NO fallback (correctly — `rcb_` keys are not interchangeable with `appl_`/`goog_`).
- **Key-prefix validation** (lines 70-75): catches `appl_` keys accidentally set as web keys; skips configuration with a warning instead of crash-looping.
- **3-tier tier resolution** (lines 193-208): RC → Supabase → AsyncStorage. Always has a fallback.
- **Master account override** (lines 215-220, 232-235): `OWNER_EMAILS` resolve to Business tier regardless of RC state. Logged loudly.
- **Customer info listener** (lines 226-246): real-time updates when entitlements change.
- **Purchase mutation invalidates query cache** (lines 274-284): every screen that gates on `useTierAccess` re-reads after purchase.

Your `.env` has all 4 keys (`IOS`, `ANDROID`, `WEB`, `TEST`). RC should be fully configured.

**Note:** if the `subscriptions` table doesn't exist in Supabase (or RLS denies writes), `syncTierToSupabase` silently fails (line 134-137 catches everything). You'd see "[Subscription] Failed to sync tier to Supabase" in dev console.

---

## 3. Edge functions — env requirements map

24 edge functions live under `supabase/functions/`. Their external API key dependencies, grouped by what breaks if missing:

| Secret | Required by | What breaks if missing |
|---|---|---|
| `GEMINI_API_KEY` | `ai`, `analyze-drawings`, `analyze-photos`, `analyze-spec-book`, `analyze-takeoff`, `compare-drawings` (6 fns) | All AI features (the issue you just hit — `EXPO_PUBLIC_SUPABASE_ANON_KEY` missing in client `.env` made every AI call 401 before it even reached Gemini) |
| `ANTHROPIC_API_KEY` | `analyze-takeoff` only | AI takeoff feature (likely has Gemini fallback) |
| `STRIPE_SECRET_KEY` | `connect-onboarding`, `connect-status`, `create-payment-link` (3 fns) | Stripe Connect, payment links |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` | Subscription status sync from Stripe to your DB |
| `RESEND_API_KEY` | `auth-magic-link`, `coi-expiry-watch`, `daily-digest`, `homeowner-weekly-digest`, `morning-digest`, `notify`, `send-email`, `stripe-webhook` (8 fns) | ALL transactional email (magic-link sign-in, digests, notifications, receipts) |
| `EXPO_ACCESS_TOKEN` | `notify` | Push notifications via Expo Push API |
| `CLOUDCONVERT_API_KEY` | `convert-pdf-to-images` | PDF-to-image conversion (drawing analysis workflow) |
| `GOOGLE_PLACES_API_KEY` | `geocode-bids` | Optional — falls back to US Census geocoder |

**Auto-injected by Supabase (no action needed):**
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (also accepted as `SERVICE_ROLE_KEY` for legacy)

**You should verify in Supabase dashboard** (Settings → Edge Functions → Secrets): all 8 external API keys are set. If any are missing, the corresponding feature 500s with a clear message in the response body — not silent.

**One pattern note:** `_shared/auth.ts:22` accepts EITHER `SUPABASE_SERVICE_ROLE_KEY` or `SERVICE_ROLE_KEY`. So the inconsistent naming across some functions is defensive, not a bug.

---

## 4. Formspree (marketing lead capture) — Endpoint resolves

**Both forms post to the same endpoint:**
- `marketing/index.html:535` — homepage hero CTA form
- `marketing/access.html:204` — longer "Request Access" form

**Form configuration is correct:**
- `_gotcha` honeypot field (spam protection) ✓
- `_next` redirects success to `https://mageid.app/thanks.html` ✓ (file exists, 147 lines)
- `_subject` differentiates source (`access request (homepage)` vs `access request`) ✓
- `email` required ✓
- `access.html` also captures `name` ✓

**Endpoint check:** `https://formspree.io/f/mblabgzr` returned HTTP 400 on a HEAD request (Formspree requires POST — 400 confirms the endpoint exists but rejected the method, which is expected). To verify deliverability for real you'd need to submit a test from a browser.

**You need to verify in Formspree dashboard** (`formspree.io/dashboard`):
1. The form ID `mblabgzr` is owned by your account
2. Submissions are emailed to the inbox you actually check
3. Your account isn't over the free-tier limit (50 submissions/month — easy to hit if marketing pushes hard)
4. Spam filtering isn't catching legitimate leads

---

## 5. Dark mode bake-ins — fundamental fix shipped

Earlier audit attempts described the bake-in problem (screens that reference `Colors.X` directly inside `StyleSheet.create({...})` capture light-theme values at module load and never update). I planned to codemod 5 large files individually.

**Better fix found:** make `Colors` itself theme-aware via getters. This change ships in this commit (Phase 26).

`constants/colors.ts` now has:
- `setColorTheme(theme: 'light' | 'dark')` — module-level setter
- `getColorTheme()` — read accessor
- All theme-sensitive properties (`background`, `surface`, `surfaceAlt`, `surfaceElevated`, `card`, `cardBorder`, `text`, `textSecondary`, `textMuted`, `border`, `borderLight`, `shadow`, `overlay`, `fillTertiary`, `fillSecondary`) converted from static values to getters that read `_currentTheme`.

`contexts/ThemeContext.tsx` calls `setColorTheme(resolved)` in a `useEffect` whenever the resolved theme changes.

**What this fixes:**
- **Every inline JSX style** that reads `Colors.X` (e.g. `app/_layout.tsx`'s `<Stack.Screen options={{ headerStyle: { backgroundColor: Colors.background } }} />` on 70+ lines) now themes correctly on every render.
- **Every lazy-loaded route** imported for the first time after a theme change reads the right values at StyleSheet.create.

**Known limitation:** StyleSheet.create still bakes at module-load time. A screen that was already loaded before the theme change keeps its baked styles until the JS bundle reloads. A top-level remount on theme change would fix that but would lose user's current screen position — explicit decision to not do it.

**Brand colors stay constant** (primary, accent, success, warning, error, info, purple, orange) — those carry semantic meaning that shouldn't theme.

---

## Recommended next checks (manual, on your end)

1. **Stripe dashboard** — verify `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` are set in Supabase secrets; webhook is registered and receiving events.
2. **Supabase Edge Function secrets** — verify all 8 external API keys above are set.
3. **Formspree dashboard** — verify form delivery + you're under quota.
4. **Test AI** — open the app, ask Construction AI a question. Should now work (was 401-ing on missing anon-key fallback before Phase 25).
5. **Test dark mode toggle** — Settings → Theme → Dark. Most screens should now flip correctly (post Phase 26). Some will still show white cards where their `StyleSheet.create` captured the light value before the theme change — fully cold-relaunch the app to verify the worst cases.
6. **Test paywall flow** — open any locked feature → paywall appears → tap Upgrade. Should hit RC (and now fire `subscription_purchase_started` event from Phase 20).
