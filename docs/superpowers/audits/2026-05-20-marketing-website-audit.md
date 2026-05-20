# 2026-05-20 — Marketing Website Audit

**Scope:** `marketing/` directory — the Netlify-hosted static site at `mageid.app`, separate from the React Native mobile app at `app.mageid.app`. Includes the homeowner portal (`marketing/portal/index.html` 5,393 lines), sub portal (`marketing/sub-portal/index.html` 1,357 lines), 10 landing pages (index, pricing, demo, playbook, access, privacy, terms, support, do-not-sell, thanks), 4 segmented subdirs (architect, builders, features, preferences), and supporting assets.

**Total findings:** 12 (1 HIGH, 4 MEDIUM, 5 LOW, 2 OBSERVATION). Plus 8 concrete "what we could add" recommendations.

**Methodology:** read-only controller inspection of HTML/CSS/JS + Netlify config + live structure. No browser-render testing performed inline (recommend Lighthouse + axe-core in a follow-up).

---

## Strengths (what's working)

1. **Strong SEO baseline.** Comprehensive Open Graph + Twitter Card meta (`index.html:10-23`). Theme color, favicons across sizes, Apple touch icon. Single `<h1>` per page (verified across all 10 landing pages). All `<img>` tags have `alt` attributes (100% coverage on the landing pages).
2. **PostHog analytics wired** (`index.html:45+`) with `capture_pageview` + `capture_pageleave` + `autocapture: false`. Same project as the mobile app — unified funnel from marketing pageview → app install → paywall_viewed → purchase.
3. **A/B testing infrastructure** on the hero headline (`index.html:103, 108, 113` — `data-ab-variant="control" | "A" | "B"`). Good growth-engineering hygiene.
4. **Honeypot field** on Formspree submissions (`index.html:537` + `access.html:206` — `_gotcha` hidden input). Resists basic spam bots.
5. **Defer-loaded scripts** (`motion.js`, `nav-mobile.js`). Doesn't block render. PostHog is async-loaded via dynamic `<script>` injection.
6. **Mobile responsive.** 4 media queries in `landing.css`, 7 in `styles.css`, 2 in `sub-portal`, 14 in `portal`. Reasonable coverage.
7. **`noindex` on portal pages.** Both `portal/index.html:6` + `sub-portal/index.html:6` have `<meta name="robots" content="noindex" />`. Correct — these are token-gated pages.
8. **`esc()` helper correctly implemented** in both portal pages (`portal/index.html:2543`, `sub-portal/index.html:768`). Escapes the 5 dangerous HTML chars (`&<>"'`) properly. Used at most `innerHTML` injection sites.
9. **Supabase + PostHog keys correctly anon-only.** The hardcoded keys (sub-portal:1276, etc.) are public-by-design — RLS perimeter does the actual gating.
10. **Email lifecycle infrastructure.** Separate `/preferences/` + `/unsubscribe/` subdirs — looks like proper transactional email preference management.
11. **Legal pages present.** `/privacy.html`, `/terms.html`, `/do-not-sell.html`. CCPA "do-not-sell" page is a real compliance signal.
12. **Audience segmentation.** Separate landing pages for `/builders/` + `/architect/` — sophisticated marketing site.

---

## Findings

### HIGH

| # | Severity | Location | Finding |
|---|---|---|---|
| **M1** | **HIGH** | `marketing/netlify.toml` | **No security HTTP headers configured.** Missing: `Content-Security-Policy` (CSP), `Strict-Transport-Security` (HSTS), `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. For a site that handles unauthenticated Supabase API calls (portal_sign_contract, portal_choose_selection, sub invoice submission) + payment redirects + form submissions, this is a real exposure. **CSP especially** would harden the `innerHTML` surfaces on the portal pages against XSS even if `esc()` is ever bypassed. Adding security headers is a single `[[headers]]` block in `netlify.toml` — ~20 lines, zero blast radius, ships in next Netlify deploy. |

### MEDIUM

| # | Severity | Location | Finding |
|---|---|---|---|
| M2 | MEDIUM | `marketing/sub-portal/index.html:828, 857, 916, 956, 966, 975, 993, 1010, 1043` + `portal/index.html:3194, 3800, 3801` | **`innerHTML` used at ~12+ sites; verify every one passes user data through `esc()`.** Spot-checked sites (titleEl, w, sec, etc.) all use `esc()` correctly, but the full inventory needs a careful walk. Any `innerHTML = '<div>' + userControlledString + '</div>'` without `esc()` is XSS. Recommend a per-call audit + ESLint plugin if/when this becomes a CI-checked surface. |
| M3 | MEDIUM | `marketing/_redirects` | **SPA-style fallback `/* /index.html 200` masks 404s as 200s.** Bots, deep-link errors, and typo'd URLs all serve the marketing landing page as a 200 OK. Two problems: (a) bad SEO — search engines won't know to drop dead URLs from the index; (b) bad UX — users typing `mageid.app/featurez` (typo) see the homepage and may think the page they expected just doesn't exist when it might. Fix: change to `404` status, add a custom `404.html` page with a friendly "not found" + back-to-home CTA. |
| M4 | MEDIUM | `marketing/` overall | **No `sitemap.xml` and no `robots.txt`.** Google + Bing have to discover the site by following links. Adding both is ~30 lines of static XML / plain text. With segmented landing pages (`/builders/`, `/architect/`, `/features/*`), a sitemap especially helps the long tail get indexed. |
| M5 | MEDIUM | All HTML pages, Google Fonts link | **No Subresource Integrity (SRI) on the Google Fonts stylesheet.** If `fonts.googleapis.com` were compromised (low probability but nonzero), arbitrary CSS would inject into every marketing page. Best practice: SRI hashes on third-party stylesheets/scripts. Trade-off: SRI hashes require regenerating the link whenever Google updates the font CSS (rarely happens, but breaks the build when it does). For static-site marketing pages, the risk-reward favors adding SRI. |

### LOW

| # | Severity | Location | Finding |
|---|---|---|---|
| L1 | LOW | All landing pages | **No favicon.ico fallback.** Have PNG favicons in multiple sizes but no classic `favicon.ico`. Some older browsers + RSS readers + bookmark indexers still expect `favicon.ico` at the root. Trivial to add. |
| L2 | LOW | `marketing/index.html` (entire site) | **PostHog inline script is ~3KB of minified JS in `<head>`.** Adds to first-render byte count. Consider pulling out to `/posthog-init.js` with `defer` so the `<head>` stays lean. Saves ~30ms TTFB on slow networks. |
| L3 | LOW | All forms | **Forms post directly to Formspree (`formspree.io/f/mblabgzr`).** No CRM/database tracking on the controller side beyond PostHog page events. If a lead fills the form, the only record is in Formspree's inbox + PostHog `form_submitted` event. No deduplication, no follow-up automation, no CRM. Workable for early stage but worth replacing with a direct Supabase write or HubSpot/Salesforce integration as volume grows. |
| L4 | LOW | All form fields | **No client-side input validation visible in the HTML.** No `required`, no `type="email"`, no `pattern=`. Formspree validates server-side, so this is a UX issue not a security one — users can submit empty/invalid forms and get a server-side error instead of inline feedback. |
| L5 | LOW | `marketing/index.html` + others | **Limited social-proof on the homepage.** No testimonials section visible in headline grep. No "as featured in [TechCrunch/etc.]" logos. No customer count ("Used by 200+ GCs"). For a B2B sales funnel, social proof is the #1 conversion lever. |

### OBSERVATION

| # | Severity | Location | Finding |
|---|---|---|---|
| O1 | OBSERVATION | `marketing/index.html` (overall) | **Hero A/B variants** are statically toggled via `style="display:none"`. Means PostHog needs to handle the assignment client-side. Verify the feature flag is wired so users see ONE variant consistently across page loads (not flicker on refresh). Recommend testing the variant assignment in PostHog dashboard. |
| O2 | OBSERVATION | Page sizes (`index.html` 34KB, `playbook.html` 41KB, `pricing.html` 20KB, `demo.html` 34KB) | **Pages are CSS-heavy.** Each landing page embeds its own `<style>` block (e.g. pricing.html has 90+ lines of `.tier-card` styling inline). This is fine for a 10-page site, but as you grow, consolidating into `/landing.css` + `/styles.css` saves bandwidth on multi-page sessions. |

---

## What we could add or change (recommendations)

### Quick wins (1-2 hours each)

1. **Add security headers to `netlify.toml`.** Closes M1. Concrete config:
   ```toml
   [[headers]]
     for = "/*"
     [headers.values]
       X-Frame-Options = "DENY"
       X-Content-Type-Options = "nosniff"
       Referrer-Policy = "strict-origin-when-cross-origin"
       Permissions-Policy = "camera=(), microphone=(), geolocation=()"
       Strict-Transport-Security = "max-age=63072000; includeSubDomains; preload"
       Content-Security-Policy = "default-src 'self'; script-src 'self' 'unsafe-inline' https://us.i.posthog.com https://us-assets.i.posthog.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://nteoqhcswappxxjlpvap.supabase.co https://us.i.posthog.com https://us-assets.i.posthog.com https://formspree.io;"
   ```
   The `'unsafe-inline'` for scripts is needed for the PostHog snippet; can be tightened later with nonces. The `connect-src` whitelist explicitly allows Supabase + PostHog + Formspree. CSP becomes the primary defense-in-depth layer behind `esc()`.

2. **Add `robots.txt` + `sitemap.xml`.** Closes M4. ~30 lines of static content. Crawler-discoverable from `/robots.txt`.

3. **Change `_redirects` to use status 404 + custom 404 page.** Closes M3. Stop returning 200 for unknown paths.

4. **Add `favicon.ico` to `assets/`.** Closes L1.

5. **Add `required` + `type="email"` + `inputmode` + `autocomplete` attributes to all form fields.** Closes L4. ~5-line change across forms.

### Conversion / content gaps

6. **Add a testimonials / case-studies section to the homepage.** Closes L5. Even 3 quoted GC quotes with photos + company names lifts B2B SaaS conversion by 15-30% per industry benchmarks. Could pull from real beta users once you have them.

7. **Add a logo wall.** "Used by GCs building projects in [city/state]" — even early-stage, just listing 5-10 named customers builds trust. Pattern: muted grayscale logos in a row beneath the hero.

8. **Add a competitor comparison page.** `/vs/buildertrend.html`, `/vs/companycam.html`, `/vs/procore.html`. Even short pages comparing pricing + features capture massive organic search traffic ("buildertrend vs procore"). Each page is 1-2 hours of work and adds long-tail SEO.

9. **Add a "Free Trial" path distinct from "Request Access."** Today the funnel is request-access → Formspree → manual approval. That's high-friction for self-service signups. If RevenueCat's free tier is the actual entry point, the homepage CTA should be "Download free" pointing to App Store + Play Store badges, not "Request access." Reserve "Request access" for the gated Enterprise pathway.

10. **Add App Store + Play Store badges.** The mobile app is the product — its install badges should be the second-most-prominent CTA after the headline form (or the primary, per #9). Apple has official SVG badges; Google Play has the same. Adds trust + reduces friction.

11. **Add a "What's new" / changelog page.** Marketing sites that publish a changelog (Linear, Vercel, Notion) signal active development. With the recent S1.x and v2.x ship cadence, MAGE ID has plenty to share. `/changelog.html` + monthly updates would be a real signal to prospective customers.

12. **Add an ROI calculator.** Construction GCs love numbers. "How much do you save vs Buildertrend?" with sliders for project count + sub count + hours-saved → shows annual ROI. Lead-magnet adjacent; captures email when user wants to save/email the result.

### Performance / polish

13. **Inline above-the-fold CSS, defer the rest.** Embed `landing.css`'s hero + nav rules inline in `<head>`; load the rest with `<link rel="preload" as="style" onload="this.rel='stylesheet'">`. Significant Lighthouse FCP/LCP improvement.

14. **Add `Cache-Control` headers in `netlify.toml`.** Currently relying on Netlify defaults. Explicit headers — `max-age=31536000, immutable` for `/assets/*` + `max-age=300` for HTML — improve repeat-visit perf.

15. **Run Lighthouse on every page.** Some pages (`playbook.html` at 41KB) may have render-blocking inline styles or unused CSS. A quick PR-level Lighthouse audit would surface concrete numbers.

### Trust / compliance

16. **Add a security/compliance page.** `/security.html` — describes Supabase RLS, AES-at-rest, HTTPS-everywhere, no data sold (covered in do-not-sell but worth its own page). For B2B prospects, security is increasingly a gate. A one-page transparency statement (data we collect, where it's stored, who has access) builds trust at zero marketing cost.

17. **Add a status page.** `/status.html` or `status.mageid.app`. Even a manually-updated one ("Last incident: Dec 4 — Supabase outage, 22min, resolved") shows operational maturity. Status pages are an underrated trust signal for B2B SaaS.

18. **Set up a `/blog/` or `/posts/` subdomain.** Long-form content (construction industry insights, tips, case studies) is the #1 organic SEO driver. Even one blog post per month — "How GCs are saving 10 hours/week with mobile schedules" — accumulates link equity over time.

---

## Recommended prioritization

If you want to ship **the highest-leverage subset** without breaking anything:

1. **Today (1-2 hour PR):** Quick wins #1-5 (security headers, robots.txt, sitemap, 404 page, favicon, form attrs)
2. **This week (~half-day):** Quick wins #5 (form polish) + #10 (App Store badges) + #6 (testimonials)
3. **Next sprint:** #8 (competitor comparison pages), #9 (free trial CTA restructure), #11 (changelog)
4. **Quarter:** #12 (ROI calculator), #16 (security page), #17 (status page), #18 (blog)

The #1 priority is **M1 (security headers)** — it's a HIGH severity finding with a trivial fix. Should ship before any other marketing work.

---

## What this audit did NOT cover

- **Browser-render testing** (Lighthouse, axe-core a11y, real-device perf) — needs the actual hosted site at `mageid.app`, not just local file inspection
- **Conversion funnel data** — PostHog events exist but I didn't query them; would need access to the PostHog project to see drop-off rates
- **Existing CSP if any** at the Netlify dashboard level (config-as-code in netlify.toml has none, but the dashboard might have manual overrides)
- **Logged-in user experience** on `app.mageid.app` (different deploy target, separate audit)
- **Email templates** sent via Resend (not part of the static site)
- **The portal pages' end-to-end functional flows** — the RLS perimeter audit earlier this session verified the DB-layer access, but the client-side flows (passcode entry, signature capture, invoice submission) deserve their own behavioral test pass
- **Competitive analysis** — what features/pages do Buildertrend, CompanyCam, Procore have that we don't?
