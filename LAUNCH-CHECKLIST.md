# MAGE ID — Pre-Public-Test Launch Checklist

_Last verified against production (project `nteoqhcswappxxjlpvap`): **2026-08-08**, Claude Code audit._

**The code is ready for public testing.** Every code-addressable readiness item is already handled (see [Already handled](#already-handled--verified-in-code-no-action-needed)). What's left are owner-provisioning items — RevenueCat + Apple credentials and dashboards — that can't live in the repo. Do the ones marked **[BLOCKER]** and you're clear to invite testers.

---

## TL;DR

- [ ] **[BLOCKER]** [Wire the RevenueCat webhook](#1-wire-the-revenuecat--supabase-webhook-blocker) — _verified NOT set as of 2026-08-08 (endpoint returns "Server not configured")._
- [ ] **[BLOCKER — web only]** [Swap the sandbox web billing key](#2-real-production-web-billing-key-blocker--web-only) for the real one.
- [ ] **[iOS]** [Distribution](#3-ios-distribution) — TestFlight needs nothing extra; a public App Store listing needs the store listing + paid-apps agreement.
- [ ] _Optional:_ [OpenWeather key](#optional--not-blockers) (live weather), [Anthropic key](#optional--not-blockers) (turns on Construction Answers).

> If your public test is **iOS TestFlight only**, the only true blocker is #1 (so server-gated AI features unlock after purchase). #2 is web-only; TestFlight doesn't need the App Store public listing.

---

## 1. Wire the RevenueCat → Supabase webhook  **[BLOCKER]**

**Why it matters.** The tier is **server-authoritative**: a database trigger pins the `subscriptions.tier` column so a client can no longer self-grant a paid tier. The **only** thing that may elevate a user's tier is the `revenuecat-webhook` edge function (running under the service role). Without it configured, a purchase unlocks the *UI* (the app reads RevenueCat entitlements directly) but **every server-gated AI feature keeps seeing the buyer as `free` and returns 403** — because `requireTier` reads the `subscriptions` table, which the webhook is what writes.

**Status — verified 2026-08-08.** `revenuecat-webhook` is deployed and ACTIVE, but its secret is **not set**: a request to the endpoint returns `Server not configured (500)`. **This step is pending.**

**Do this:**

1. **Set two Edge Function secrets** (Supabase Dashboard → the project → **Edge Functions → Manage secrets → Add**, or the CLI — see [bottom](#how-to-set-an-edge-function-secret)):
   - `REVENUECAT_WEBHOOK_SECRET` — any strong random string you choose (e.g. `openssl rand -hex 32`). This is the shared secret the webhook authenticates against.
   - `REVENUECAT_SECRET_API_KEY` — your RevenueCat **secret** API key (`sk_…`), from RevenueCat → Project → **API keys**. The webhook uses it to read authoritative entitlements so the tier is never inferred from a single event.
2. **Point RevenueCat at the endpoint.** RevenueCat Dashboard → **Integrations → Webhooks → Add**:
   - **URL:** `https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/revenuecat-webhook`
   - **Authorization header value:** the **exact** `REVENUECAT_WEBHOOK_SECRET` from step 1.
3. **Verify it's live:** send a test event from the RC dashboard (expect `200`). As a quick sanity check, a no-auth `POST` to the URL should now return **`401 Unauthorized`** instead of `500 Server not configured`.

---

## 2. Real production web billing key  **[BLOCKER — web only]**

**Status — verified 2026-08-08.** `eas.json` ships a **sandbox** web key (`rcb_sb_…`) on both the `preview` and `production` profiles (lines 17 and 31). The iOS (`appl_…`) and Android (`goog_…`) keys are already the real production keys — so **this only affects web checkout** (`app.mageid.app`). On web, a sandbox key means a tester's purchase never touches real Stripe and never unlocks anything.

**Do this:**

1. RevenueCat → **Web Billing** → copy your production `rcb_…` key.
2. Replace **both** `rcb_sb_…` values in `eas.json` (`build.preview.env` and `build.production.env`, the `EXPO_PUBLIC_REVENUECAT_WEB_API_KEY` lines) with the real key.
3. Rebuild / redeploy the web bundle.

_(Skip entirely if the public test is iOS TestFlight only.)_

---

## 3. iOS distribution

- **TestFlight** — nothing extra. The binary and the `production` OTA channel are ready.
- **Public App Store** — complete the App Store Connect listing and accept the Paid Applications Agreement. Admin-only; nothing in code blocks it.

---

## Optional — not blockers

- **Live weather.** Add `EXPO_PUBLIC_OPENWEATHER_API_KEY` to the production `env` in `eas.json`. Without it, forecasts are **simulated** — and clearly labeled as such in-app (a `SimulatedWeatherNotice` + "SIMULATED FORECAST" headlines), so no tester is misled; they just won't see a real forecast. Free key: <https://openweathermap.org/api> (the "5 day / 3 hour" endpoint is free-tier).
- **Construction Answers (the "Ask" mode in Construction AI).** Set `ANTHROPIC_API_KEY` as a secret on the `construction-answer` edge function to turn it on. It's deployed but **inert by design** (agentic Claude runs cost real money per question; it's Business+-gated). Until the key is set it returns `not_configured` and the Ask mode shows "not available yet." Decide whether to enable it for the test or leave it off.

---

## Already handled — verified in code, no action needed

_(Audited 2026-08-08. Listed so nobody re-chases them.)_

- **Coming-soon stubs are hidden.** `HIRE_ENABLED = false` (`contexts/HireContext.tsx`) gates the "Direct Hire" tab **and** the "Messaging" entry off every nav surface (Discover tabs/cards + desktop sidebar). Testers can't reach the stubs.
- **Scheduler finish-day jump bug — fixed.** No today-stamp is written on first edit; the CPM engine never invents a `startDate`.
- **Simulated weather is surfaced loudly** wherever weather shows (schedule Today view, reschedule prompt/modal, delay log). Delay-day records built on simulated data are refused, so no fake evidence is written.
- **Crash safety.** Top-level `ErrorBoundary` (`app/_layout.tsx`) with a fallback that doesn't depend on the theme/provider stack — a render error shows a recoverable screen, not a white screen.
- **Empty states.** A zero-data account renders safely; the home screen offers "try a sample project."
- **AI features degrade gracefully.** Edge-function/tier errors surface friendly messages; no hangs or crashes.
- **Public share links** handle invalid/expired tokens cleanly.
- **`revenuecat-webhook` receiver is deployed + active** — it just needs the secret in step 1.

---

## How to set an Edge Function secret

- **Dashboard:** <https://supabase.com/dashboard/project/nteoqhcswappxxjlpvap> → **Edge Functions → Manage secrets → Add new secret**.
- **CLI:** `supabase secrets set REVENUECAT_WEBHOOK_SECRET=... REVENUECAT_SECRET_API_KEY=... --project-ref nteoqhcswappxxjlpvap` (requires `supabase login` with an access token).

Secrets take effect immediately for the next invocation — no redeploy needed.
