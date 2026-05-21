# 2026-05-21 — Session Follow-up TODO

**Source session:** 2026-05-20 → 2026-05-21 audit + fix sweep.
**Audit docs in scope:** marketing-website, Tier A/B/C/D, state-machine/realtime/Connect, webapp-ux.

This doc maps **every loose end** from that session — what's done, what's queued, what's blocking, and the minimum verification a future session needs to do. Single source of truth so nothing falls off the radar.

---

## 🔴 NEW HIGH-severity findings caught during close-out audit

Item 3 of the session close-out (audit of the 11 previously-unaudited edge fns) surfaced more bugs. **None of these were known at the start of close-out.**

### F1 — Cron / digest / notify functions all `verify_jwt: false` with NO in-code caller check (HIGH × 6)

Confirmed via `mcp__supabase__list_edge_functions` against project `nteoqhcswappxxjlpvap`:

| Function | verify_jwt | What it does if anonymously triggered |
|---|---|---|
| `invoice-dunning` | **false** | Body `{all: true}` → blasts dunning emails to EVERY overdue invoice's client. Body `{invoiceId: X}` → triggers dunning on any invoice id. **HIGH — phishing-grade email blast vector.** |
| `daily-digest` | **false** | Iterates opted-in GCs, sends each a daily summary email. Anon-callable = mass email any time. |
| `morning-digest` | **false** | Same pattern. Plus uses `GEMINI_API_KEY` (cost-bypass on every trigger). |
| `homeowner-weekly-digest` | **false** | Same pattern. Plus `GEMINI_API_KEY` and `RESEND_API_KEY` cost on every trigger. |
| `notify` | **false** | Source comment claims "verify_jwt is on" (line 220) but deployed without. Anyone can POST arbitrary JSONB and trigger downstream email/push notifications. Largest single function (963 LOC) so attack surface is wide. |
| `notify-nearby-contractors` | **false** | Trigger-fired endpoint; anon caller can submit fake `record: PublicBidRow` to fan out to all contractors. Spam vector. |
| `fetch-external-data` | **false** | Cron job. Effect on misuse unknown without deep read. |

**Recommended fix (sub-project, ~3-4 hours):**
1. Add a `CRON_SECRET` env var in Supabase Edge Function secrets.
2. Add an `x-cron-secret` header check at the top of each of the 4 cron-style fns (daily-digest, morning-digest, homeowner-weekly-digest, invoice-dunning, fetch-external-data, coi-expiry-watch).
3. Update the `pg_cron` SQL invocations to pass the header.
4. For `notify` and `notify-nearby-contractors` — these are trigger-fired by Postgres' `fire_notify` helper. Two options: (a) gate with `CRON_SECRET` and update fire_notify to pass the header, OR (b) leave anon-callable but add a payload-validation layer that refuses callers whose claimed-from-userId doesn't exist in the DB.

**Why this is a real fix-pass, not a quick fix:** all 6 functions deploy together, env var needs configuring, pg_cron SQL has to be updated, and you need to test that the legitimate cron-job + Postgres-trigger paths still fire correctly.

### F2 — Netlify GitHub auto-deploy regressed security headers (RESOLVED for now)

**What happened:** sometime between 15:10 UTC (when my manual deploy verified headers live) and 16:22 UTC (when an auto-deploy ran for commit `a609961`), the live mageid.app lost ALL custom security headers (CSP, X-Frame-Options, Permissions-Policy, Referrer-Policy, custom HSTS). The auto-deploy claimed to use the same commit as my manual deploy, but somehow produced a different bundle without the headers.

**Confirmed via comparison:**
- My manual deploy `6a0f30dda2dc616902304123` — headers present at unique-deploy URL (still works)
- Auto-deploy `6a0f30f67478dd00084fabc5` — headers ABSENT (current state)
- Both for commit `a609961` (so the source is correct).

**Resolved during close-out:** Restored deploy `6a0f30dda2dc616902304123` via `POST /sites/{id}/deploys/{deploy_id}/restore`. Headers are live again. Cost: zero (restore is metadata-only, no build).

**Root cause hypothesis:** Netlify auto-deploys for the `mageid-marketing` site read the **repo-root `netlify.toml`** rather than `marketing/netlify.toml`, even though the site's "Base directory" is set to `marketing`. The repo-root netlify.toml is for the `app.mageid.app` site and has NO security headers + a different redirect rule (SPA fallback for /index.html). Manual `netlify deploy --dir=dist` from inside `marketing/dist/` correctly picks up `marketing/netlify.toml`.

**Permanent fix recommendations (pick one):**
1. **Disable GitHub auto-deploy on `mageid-marketing` site** in the Netlify dashboard (Site settings → Build & deploy → Continuous deployment → Stop builds). Then every push lands in git, no auto-deploy fires, and you manually deploy with `netlify deploy --dir=marketing/dist --prod` from CLI when ready. This is the cleanest fix given the credit-pause situation anyway.
2. **Move security headers from `marketing/netlify.toml` to `marketing/_headers`** (Netlify's path-based header file format). The `_headers` file gets rsync'd into `dist/` and is read by Netlify regardless of which netlify.toml wins config-precedence.
3. **Restructure repos** — separate the marketing site to its own GitHub repo so there's no netlify.toml ambiguity.

**Until one of those ships:** every git push to main triggers another auto-deploy that will strip headers again. To restore after each: `POST /api/v1/sites/bd8356d7-81ea-4baf-a628-9ae75bcddc61/deploys/6a0f30dda2dc616902304123/restore`.

### F3 — `+html.tsx` did not render in Expo Web SPA mode (LOW)

Item 1 of close-out: ran `npx expo export --platform web` locally. Result: `dist/manifest.webmanifest` shipped (good), `dist/favicon.ico` shipped (good), but `dist/index.html` does NOT include my custom meta tags, theme-color, manifest link, or OG tags from `app/+html.tsx`. The default Expo Web template was used instead.

**Root cause:** `+html.tsx` is only honored when `app.json` has `web.output: "static"` or `"server"`. Current config is `web.output: <undefined>` (defaults to `"single"` = SPA mode), and SPA mode ignores `+html.tsx`.

**Recommended fix (small, ~1-hour spike):**
1. In a test branch, set `app.json` → `expo.web.output: "static"`.
2. Run `npx expo export --platform web` and verify `dist/index.html` now has the meta tags.
3. Test the SSG output by opening `dist/index.html` in a browser AND by deploying to a Netlify branch preview.
4. Watch for any RN component that fails during SSG (typically things that access window/localStorage at render time — wrap in `typeof window !== 'undefined'` guards).
5. If SSG succeeds, ship to mageid-app site.

**Alternative if SSG breaks:** keep SPA mode + add a post-export script that injects the meta tags into `dist/index.html` after build. Hacky but works.

---

## 🟡 Known deferrals from earlier in the session (still pending)

### D1 — DB-side state-machine RLS enforcement (sub-project)

Per audit `2026-05-21-state-machine-realtime-connect-audit.md` (#28.3 OBS): all the money-doc locks (invoice, AIA, CO, contract) are UI-only. A determined user / stale UI bundle / direct API call can bypass.

**Durable fix:** add RLS check constraints on `invoices`, `aia_pay_apps`, `change_orders` that refuse UPDATE when the row is in a terminal status:

```sql
create policy invoices_owner_update_unlocked on public.invoices
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id AND status NOT IN ('paid'));
```

Plus an explicit admin-override pathway for support cases.

**Effort:** brainstorm session → schema spec → migration plan → deploy with rollback path. ~4-6 hours.

### D2 — AsyncStorage zod-validation layer (structural)

Per `2026-05-20-app-audit-tier-abcd-findings.md` (C1 OBS): naive `JSON.parse(stored) as T` casts exist in offlineQueue, aiRateLimiter, project context, etc. A schema change between app versions can land typed garbage in memory.

**Fix:** wrap every AsyncStorage.getItem in a zod schema validator. On invalid data, drop or migrate.

**Effort:** sub-project, ~6-10 hours.

### D3 — Long-tail W2 bespoke title screens

PageHeader + FeatureHeader now use h1 semantics (shipped in OTA). But screens with bespoke title rendering still use `<Text>` → `<div>`:
- `app/aia-pay-app.tsx` hero card title
- `app/invoice.tsx` hero card title
- `app/paywall.tsx` native hero (web is fixed)
- `app/onboarding.tsx` step titles

**Fix:** mechanical — add `accessibilityRole="header"` + `aria-level={1 as never}` to each. ~5 min per screen.

### D4 — Sidebar scroll-to-active (was W4)

Reclassified from "active state broken" to "active item below fold." Real fix: add `ScrollView.scrollTo(activeItemY)` on pathname change.

**Effort:** ~30 min.

### D5 — JSON-LD structured data (was W11)

Low value for authed app. Skip unless growing /pricing or /demo pages need it.

### D6 — Mobile-web responsive testing (was W13)

Couldn't verify via Chrome MCP `resize_window` (tooling limitation). Best alternative: run Lighthouse mobile against the deployed site once it's stable; manually open Chrome DevTools at mobile presets.

### D7 — Stripe Checkout web purchase path (real W3 v2)

Current W3 fix is read-only deflect-to-app-store. A true web-purchase path requires:
- New Stripe Products for the Pro/Business/Enterprise plans
- Web-purchase Stripe Checkout session creator (new edge fn)
- Stripe webhook handler for `checkout.session.completed` mapping web-purchases to MAGE entitlements
- RevenueCat sync (so a web purchase shows up in the native app too)
- Whether to allow web-purchase at all (Apple takes 30% on iOS purchases; web Stripe is 2.9%+0.30 — but Apple may decline iOS app updates that mention web-purchase off-platform per their guidelines)

**Effort:** real sub-project, brainstorm + spec needed. ~1-2 weeks of focused work.

---

## 🟢 Behavioral verifications to do on real devices (your side)

After the OTA propagates (~30s from publish):

| Screen | What to check | Pass criterion |
|---|---|---|
| Home (`/`) | Browser tab title | Should read "Projects · MAGE ID" |
| Settings | Browser tab title | "Settings · MAGE ID" |
| Budget Dashboard | Browser tab title | "Budget dashboard · MAGE ID" |
| Paywall (web) | Visit `https://app.mageid.app/paywall` | Loads read-only tier table + App Store / Play Store CTAs (no more permanent loading splash) |
| AIA pay-app (iOS) | Open a pay-app that's been "Generated" (has payLinkUrl) | Amber banner at top reads "Period #N locked", edits refused with Alert |
| AIA pay-app (iOS) | Open a DRAFT pay-app (no payLinkUrl) | Fully editable, no banner |
| Invoice (iOS) | Open a SENT invoice (status='sent') | Line items + retention picker + delete-item buttons disabled |
| Invoice (iOS) | Open a DRAFT invoice | Fully editable |
| DesktopSidebar (web) | Tab through items with keyboard | Each gets visible focus ring + Enter activates |
| DesktopSidebar (web) | Screen reader (VoiceOver/NVDA) | Items announced as "Settings, button, current page" etc. |
| Floating FABs (web) | Scroll to bottom of `/(home)` projects list | Mic + AI star FABs no longer overlap content |
| Stripe Connect | Connect a Stripe account from /payments-setup | Still works (the userId-ownership fix shipped earlier shouldn't break legitimate flow) |
| Stripe Connect | Disconnect from Stripe dashboard | Webhook now nulls out stripe_account_id + flips charges_enabled to false (was: stale until manual) |

## 🟢 Operational monitoring (your side, next 24h)

- **Sentry / Supabase logs** — watch for new 401/403 spikes after the edge fn ownership fixes. False-positives would mean my fix is too strict.
- **PostHog `marketing_404` events** — confirm the 404 page is firing analytics correctly when someone hits a dead URL.
- **Netlify billing** — `/teams/omirmajeed2000/billing` — see if add-on credit usage is on track.
- **Revoke the Netlify PAT** `nfp_A5R7kqd...` at https://app.netlify.com/user/applications. It was used for 4-5 deploys + the restore today. Mint a fresh one for next session.

---

## What was done this session (recap)

8 audit docs:
- 2026-05-20-marketing-website-audit.md
- 2026-05-20-app-audit-tier-abcd-findings.md
- 2026-05-20-deep-audit-5-subsystems.md
- 2026-05-20-session-end-audit.md
- 2026-05-21-state-machine-realtime-connect-audit.md
- 2026-05-21-webapp-ux-audit.md
- This doc

19 fix commits (across marketing, edge fns, app code, infra). Listed in chronological order via `git log --oneline 41bb68e..main`.

3 deploys to live infra:
- **mageid.app** (Netlify) — security headers, 404, robots, sitemap, favicon, form polish, CSP fix. Currently restored via `restoreSiteDeploy` to `6a0f30dd...`.
- **Supabase edge fns** — `ai` (v32), `create-payment-link` (v22), `connect-onboarding` (v10), `connect-status` (v9), `send-email` (v19), `stripe-webhook` (v15).
- **EAS OTA production** — update group `9a42ea35-1616-4659-930d-6a91b501cf12` covering AIA lock, invoice lock, paywall web fallback, doc titles, h1 semantics, sidebar a11y, FAB clearance.

5 audit-finding bugs fixed + deployed:
- Tier A.AI1 (text relay caps)
- Tier D.E1 (create-payment-link ownership)
- Tier D.E2 (send-email impersonation)
- Tier D.E3/E4 (connect-onboarding + connect-status)
- #30.4 (account.application.deauthorized webhook handler)

6 audit-finding bugs fixed + held for OTA (now shipped):
- #28.1 (AIA isLocked)
- #28.2 (invoice lock tightening)
- W1, W2, W3, W5, W6, W7, W12 (webapp UX)

1 marketing-CSP regression caught + fixed mid-session (added jsdelivr + unpkg to script-src).

---

## TL;DR for the next session

1. **High-priority** — Implement the CRON_SECRET fix on 6 edge fns (F1). That closes the email-blast vector.
2. **Medium-priority** — Disable Netlify GitHub auto-deploy on `mageid-marketing` (F2) to prevent header regression.
3. **Sub-projects** — DB-side state-machine enforcement (D1), AsyncStorage zod layer (D2), Stripe Checkout web purchase (D7).
4. **Polish (mechanical)** — long-tail W2 title screens (D3), sidebar scroll-to-active (D4), `output: "static"` for +html.tsx (F3).
5. **Verify** — walk the behavioral checklist on real devices after OTA propagates.
6. **Don't forget** — revoke Netlify PAT.
