# MAGE ID — Marketing Site Audit (2026-07-07)

37-page audit (6 reviewers + synthesis). 66 findings.

## Overall

Content and structure are strong, but the site is mid-rebrand and the amber transition is incomplete: the majority of the 37 pages still carry green-build screenshots, Space-Grotesk-as-serif headings, glassmorphism, and stray green/purple accents. Two clusters need urgent attention: (1) a handful of factual/pricing contradictions on the core-conversion pages that actively mislead buyers, and (2) a large volume of brand-consistency drift that all traces back to a few shared files (styles.css, landing.css) and the screenshot generator. Most of the volume is fixable centrally.

## Site-wide issues (fix centrally)

- 1. STALE GREEN-BRAND SCREENSHOTS (known headline): every embedded /screenshots/screens/*.png is from the outdated green build and must be re-captured in the amber (#FF6A1A) brand. Affects index, pricing, playbook, all feature pages, all four compare detail pages, and the moat 'Bid Confidence proof' image (index 18-budget-evm.png) that specifically undercuts the differentiator by showing green UI. Filenames can stay identical so no HTML edits are needed after re-capture.
- 2. ROOT CAUSE of the stale look: screenshots/Marketing Screenshots.html and app-store-screenshots/builder.html bake in the WRONG fonts (Inter + Instrument Serif instead of Fraunces + Space Grotesk + JetBrains Mono) and GREEN presets (#0e3d28 / #7ed4a3 / #0e1a14) plus an off-token orange (#ff6b35 vs brand #FF6A1A). Fixing the generator is a prerequisite to regenerating clean screenshots.
- 3. SPACE-GROTESK-AS-SERIF headings instead of Fraunces: the most pervasive brand defect. Display headings declare font-family:'Space Grotesk',(Georgia,)serif across index (moat), playbook, access, thanks, features/index, features/vs-* pages, all four legal pages, 404, and the persona/portal pages. Where Space Grotesk is loaded it renders in the body font; where it isn't (personas, 404) it falls back to Times/Georgia. Fix: point heading selectors at var(--ff-serif).
- 4. GLASSMORPHISM on the sticky nav, site-wide: styles.css (lines 74-75) and landing.css (lines 105-106) apply backdrop-filter: saturate(180%) blur(18px), which the brand explicitly bans. One central edit removes it from every page; replace with a solid/near-solid ink background + hairline bottom border. The portal has ~15 additional backdrop-filter uses to clean up.
- 5. OFF-BRAND GREEN accents throughout: #22C55E (thanks success icon, playbook voice-result, do-not-sell .ok-card), #1E8E4A (features/client-experience eyebrows, all compare .compare-yes cells, preferences/unsubscribe toggles), and #7ed4a3 in the generator. Brand is amber/ink/cream with no green. Recolor to amber tints; also fix vs-other-tools legend text that literally says 'Green = full support'.
- 6. OFF-BRAND PURPLE accents: #805AD5 plan-pin (index/landing.css:738) and #6644AB portal 'selection' activity icon (portal:342). No purple exists in the amber palette; recolor to amber/neutral.
- 7. WRONG/UNUSED font loading: Inter is loaded but unused on index, access, thanks, features/index, and is applied as the actual body font on the persona pages and 404 (a forbidden brand font). Meanwhile Space Grotesk often arrives only via a slower chained CSS @import, and Fraunces is loaded on persona/404 pages but never referenced. Standardize every page's Google Fonts link to load the Fraunces + Space Grotesk + JetBrains Mono trio and drop Inter.
- 8. DECORATIVE MULTI-STOP GRADIENTS vs the flat-surface brand: pricing featured tier/stack cards, calculator CTA, compare savings-card (ink-to-ink), and the 404 clipped-text gradient. Replace with flat tinted surfaces + 1px amber hairline borders.
- 9. INCONSISTENT NAV/FOOTER across page groups: homepage omits Features/Support and never links standalone /pricing.html; compare/index.html nav diverges from its four detail pages; the four legal pages each expose a different nav link set; and several feature-page footers drop the .html extension on /privacy and /terms. Standardize nav item set, footer markup/tagline, and link extensions site-wide.
- 10. EMPTY PHONE-FRAME PLACEHOLDERS render as blank shells with caption-only: field.html (6 frames), financials.html (5), bids.html (3), scheduling.html (2). Either capture the missing amber screenshots or remove the empty frames until assets exist.

## HIGH (factual / misleading)

### pricing.html (line 393) and index.html (line 611) — Enterprise PDF cap comparison '(vs 150)' is factually wrong — Business is 100
- **Fix:** Change '(vs 150)' to '(vs 100)' on both lines to match the canonical paywall AI_LIMITS table (Business = 100 PDF takeoff pages/mo); consider relabeling 'PDF conversions' to 'PDF takeoff pages' to match paywall wording. All four other Enterprise deltas on the card are correct — only this row is off.

### demo.html (line 767) — Free tier described as 'up to 2 projects' — contradicts the 1-project limit everywhere else
- **Fix:** Change 'up to 2 projects' to 'one active project' to match index.html (line 550) and pricing.html (line 313). The '2' actually refers to Community bids/mo, not projects.

### demo.html (line 791) — Annual prices ($348 Pro / $948 Business) show no discount, contradicting the pricing page's '2 months free'
- **Fix:** Reconcile the annual numbers. $348/$948 = flat 12x monthly; pricing.html (line 472) promises ~2 months free (~$288 Pro / ~$792 Business). Update demo.html to the discounted annual totals so the two pages agree.

### builders/index.html, architect/index.html, portal/index.html, sub-portal/index.html — Persona/portal pages render headings in Times/Georgia — Space Grotesk is never loaded and Fraunces is loaded but never referenced
- **Fix:** Update the Google Fonts link on all four to load Fraunces + Space Grotesk + JetBrains Mono; set headings to var(--ff-serif) (Fraunces) and body to Space Grotesk; remove the unused Inter body font and the bare unloaded 'Space Grotesk', serif fallbacks. Currently none of the three brand fonts render as intended.

### 404.html — 404 page uses stale gold accent + gradient and broken font stack
- **Fix:** Replace --accent #E7C77B (old gold) with #FF6A1A and make the big '404' a flat amber fill instead of a two-stop gold clipped-text gradient; load Fraunces + Space Grotesk (or just link /styles.css) so the display type stops falling back to Georgia and drop Inter. This is the only self-styled marketing page not pulling the shared amber tokens.

## MEDIUM

### demo.html (line 768) vs index.html / access.html — Launch story is internally inconsistent: 'sign up in the App Store' vs pre-launch TestFlight vs web-only
- **Fix:** Pick one launch narrative. index.html removed its App Store badge and routes CTAs to app.mageid.app while access.html pitches a pre-launch TestFlight invite; align demo.html (e.g. 'start free on the web at app.mageid.app') and access.html to one story.

### demo.html (video frames, click handler lines 842-852) — Homepage 'See how it works (90 sec)' CTA dead-ends on a 'coming soon' placeholder
- **Fix:** Either embed the real videos or soften the homepage/demo copy (e.g. 'Book a live walkthrough') so the advertised 90-second and 15-minute tours don't resolve to 'Walkthrough videos coming soon.'

### privacy.html (line 90) vs terms.html (line 105) vs do-not-sell.html (line 69) — AI sub-processor named inconsistently across legal pages (compliance risk)
- **Fix:** Privacy says 'Google (Gemini)', terms/do-not-sell say 'Anthropic'. Per product docs the app uses Anthropic (Claude). Standardize the named AI sub-processor(s) identically across all three legal pages.

### unsubscribe/index.html (lines 123, 128) — Support email conflict: support@mageid.app vs site-wide help@mageid.app
- **Fix:** Change both unsubscribe mailto links to help@mageid.app to match privacy/terms/support/do-not-sell; support@ may not even be monitored.

### preferences/index.html (lines 254-255) — Preference toggle checkboxes have no accessible name
- **Fix:** The category label sits in a sibling div outside the <label>. Add aria-label (the item's label text) to each generated <input>, or associate via id + aria-labelledby, so screen-reader users know which notification they're toggling.

### demo.html (lines 842-852) — Demo video 'play' placeholders are non-keyboard-accessible clickable divs
- **Fix:** Convert the .video-placeholder divs to <button> (or add role='button' tabindex='0' + keydown handling) with an accessible label like 'Play the 90-second tour.'

### features/index.html (lines 239-248) — Blue accent callout breaks the amber-only palette
- **Fix:** Recolor .ex-callout (used on Voice, Leads, Schedule, Buyout, Portals tabs) from blue #0D6CB1/#4FA8E8 to amber: background rgba(255,106,26,0.10), border-left #FF6A1A, strong color var(--amber).

### compare/index.html (lines 31-37) — Compare hub nav diverges from its four detail pages
- **Fix:** Make the hub's nav match the detail pages (add /features/ and /support.html, drop the inline bare 'Start free' link) so primary navigation is consistent across the group.

### builders/index.html (head, lines 4-14) — Public builder-portfolio page missing description, OG image/description, and Twitter card
- **Fix:** It is indexable/shareable (no noindex) but has only title/canonical/og:type/og:title. Add meta description, og:description, og:image, og:url, and twitter:card/title/image so shared portfolio links get a rich preview.

### do-not-sell.html (lines 37-38) — Green .ok-card reassurance box on an amber page
- **Fix:** Recolor .ok-card from green (#22C55E) to the amber tint used by support.html's .contact-card (rgba(255,106,26,0.06/0.20), strong #FF6A1A).

## LOW

- access.html H1/H2 use Space Grotesk instead of var(--ff-serif) (Fraunces).
- thanks.html success checkmark is green (#22C55E) — recolor to amber; h1 also uses Space Grotesk not Fraunces.
- index.html moat headings (.moat-h, .moat-card h3) use Space Grotesk not Fraunces — the differentiator hero copy.
- playbook.html headings use Space Grotesk and .pb-voice-result uses green success accents — switch to Fraunces + amber.
- pricing.html tier/stack card gradients and calculator.html CTA gradient — flatten to tinted surface + amber hairline.
- calculator.html is fully self-styled (system fonts, no Fraunces/Space Grotesk, no shared nav/footer) and defines an unused --red var — load brand fonts and add shared nav/footer.
- access.html missing twitter:card and og:image:width/height — add to match index.html.
- features/index.html canonical (index.html form) and og:url (directory form) disagree — standardize to /features/.
- Feature-page footers (bids, field, financials, marketplace, scheduling) drop the .html on /privacy and /terms — standardize to /privacy.html, /terms.html.
- features/vs-* section headings (.savings-headline, .pricing-card h2, .table-stakes h3) use Space Grotesk-as-serif — switch to Fraunces; leave numeric stat values.
- compare detail pages: .savings-headline uses Space Grotesk, .savings-card uses an ink-to-ink gradient, and .compare-yes uses green #1E8E4A — Fraunces + flat fill + amber/neutral positive.
- portal/index.html 'selection' activity icon is purple #6644AB — recolor to amber/info.
- builders/index.html canonical uses /builders/index.html not clean /builders/; lead-btn-primary has a gold #d98b00 fallback instead of #FF6A1A.
- Lightbox enlarged image (builders line 366, portal line 2382) has permanently empty alt — set lbImg.alt = caption on open.
- architect/index.html uses native alert() for validation/submit errors — replace with the existing inline .form-status/.helper-banner pattern.
- Persona hero sections layer decorative amber radial-gradient glows (builders, portal, sub-portal) against the flat brand — flatten or document as an intentional exception.
- landing.css badge-new (#7BE09C green) and plan-pin punch (#38A169 green) / photo (#805AD5 purple) are off-amber — retone.
- Legal pages: styles.css cache-buster is split/stale (?v=2026-05-04 vs 2026-05-12; file modified 2026-07-07) — bump all to one current value.
- Legal/utility page nav link sets differ per page (privacy/terms/support/do-not-sell) — standardize to one set (Home, Privacy, Terms, Support).
- preferences/unsubscribe use green success color and Georgia headings — at minimum swap success green to amber even if keeping web-font-free.
- index.html nav/footer omit Features and Support and never link standalone /pricing.html — standardize the nav item set and footer tagline across pages.
- icon-preview.html: internal WIP dev-note page (first-person build notes, names product 'MAGE-AI') is served publicly at /icon-preview.html — remove from the deployed site or strip the notes and correct the name.

## Recommended sequence

1. 1. FIX THE SCREENSHOT GENERATORS FIRST (screenshots/Marketing Screenshots.html + app-store-screenshots/builder.html): swap Inter/Instrument Serif for the Fraunces + Space Grotesk + JetBrains Mono trio and replace all green presets (#0e3d28/#7ed4a3/#0e1a14) and #ff6b35 with amber #FF6A1A / ink / cream. This is the root cause; do it before regenerating anything.
1. 2. RE-CAPTURE all app screenshots in the amber build (headline item). Keep filenames identical so no HTML edits are needed. Prioritize the moat 'Bid Confidence proof' (index 18-budget-evm.png) since a green image there directly undercuts the pitch.
1. 3. FIX THE FACTUAL/PRICING CONTRADICTIONS (fast, high conversion impact, no design work): pricing/index '(vs 150)'->'(vs 100)', demo Free '2 projects'->'one active project', demo annual prices, plus the legal AI-vendor and support-email inconsistencies.
1. 4. CENTRAL CSS SWEEP in styles.css + landing.css: remove backdrop-filter (glassmorphism) from the nav, repoint Space-Grotesk-as-serif heading selectors to var(--ff-serif), and recolor shared green/purple accents and decorative gradients to amber/flat. One edit here clears the bulk of the brand drift across all pages.
1. 5. PER-PAGE FONT-LOADING FIXES for pages that self-manage fonts (persona/portal pages, 404, legal pages, features/index, calculator): load the correct trio, drop Inter, fix the gold #E7C77B on 404. These render visibly broken (Times/Georgia) today.
1. 6. FILL OR REMOVE the empty phone-frame placeholders (field 6, financials 5, bids 3, scheduling 2) once amber screenshots exist.
1. 7. STANDARDIZE nav/footer across groups (homepage, compare hub, legal pages) and normalize /privacy.html and /terms.html link extensions.
1. 8. ACCESSIBILITY PASS: preference-toggle labels, demo video button semantics, lightbox alt text, architect alert() replacement.
1. 9. SEO/META + HYGIENE cleanup: builders OG/Twitter tags, access twitter cards, canonical forms, cache-buster values, and remove the public icon-preview.html WIP page.

---
## All findings by page

- **[high/brand] 404.html:** 404 page uses stale gold accent + decorative gradient instead of amber — Replace --accent value with #FF6A1A, and make .code a flat amber fill (color: #FF6A1A) rather than a gold gradient, matching the flat/hairline brand.
- **[high/brand] 404.html:** 404 loads Inter + Fraunces but renders Georgia fallback; wrong font stack — Load Fraunces + Space Grotesk + JetBrains Mono (or just link /styles.css), set body to Space Grotesk and the big 404/h1 to Fraunces (var(--ff-serif)); drop Inter entirely.
- **[medium/brand] access.html:** H1/H2 use 'Space Grotesk' (body font) instead of Fraunces display serif — Change these to font-family: var(--ff-serif) so headings render in Fraunces.
- **[low/seo] access.html:** Missing Twitter Card tags and OG image dimensions — Add the twitter:card=summary_large_image + twitter:title/description/image tags and og:image:width/height (1200×630), matching index.html.
- **[medium/brand] app-store-screenshots/builder.html:** App Store screenshot builder uses Inter for all body copy instead of Space Grotesk — Add `Space Grotesk` to the Google Fonts link on line 8 and replace the `'Inter', system-ui, sans-serif` stacks with `'Space Grotesk', ...`. Keep Fraunces for headlines and JetBrains Mono for code.
- **[low/markup] architect/index.html:** Reviewer portal uses native alert() dialogs for validation and submit errors — Replace the alert() calls with an inline styled error/status element (the page already has `.helper-banner`/error styling patterns to reuse) so validation and submit failures stay in-brand and non-blocking.
- **[medium/seo] builders/index.html:** Public builder-portfolio page is missing meta description, OG image/description, and Twitter card — Add a `<meta name="description">`, `og:description`, an `og:image` (brand card or hero fallback), `og:url`, and `twitter:card`/`twitter:title`/`twitter:image` to builders/index.html head. The JS can override og:title/description per-project after load.
- **[low/seo] builders/index.html:** Canonical points to /builders/index.html instead of the clean /builders/ URL — Change canonical to `https://mageid.app/builders/` to match the served URL (and other pages' convention).
- **[low/brand] builders/index.html:** Lead-form primary button has a gold (#d98b00) fallback instead of amber — Change the fallback to the brand value: `var(--amber, #FF6A1A)`.
- **[high/brand] builders/index.html, architect/index.html, portal/index.html, sub-portal/index.html:** Wrong fonts: pages load Inter+Fraunces but render headings in Times/Georgia serif, not the brand type — Update the Google Fonts link on all four pages to load Fraunces + Space Grotesk + JetBrains Mono (matching styles.css line 7). Set display/heading rules to `font-family: 'Fraunces', Georgia, serif` and body to `font-family: 'Space Grotesk', -apple-system, sans-serif`. Remove the unused Inter reference and the unloaded bare `'Space Grotesk', serif` heading fallbacks.
- **[low/a11y] builders/index.html, portal/index.html:** Lightbox enlarged image has a permanently empty alt attribute — In the lightbox open handler set `lbImg.alt = p.caption || 'Project photo'` alongside `lbImg.src` so the enlarged image carries the caption as its accessible name.
- **[low/brand] builders/index.html, portal/index.html, sub-portal/index.html:** Decorative amber radial-gradient glows on dark hero surfaces conflict with the flat brand — If strict brand consistency is wanted, replace the radial-glow ::before layers with a flat `var(--ink)` fill (optionally a single hairline amber accent). If the glow is an intentional exception for hero surfaces, keep it consistent across all pages and document it — currently it reads as leftover from an earlier style.
- **[low/brand] calculator.html:** Standalone tool uses system fonts (no Fraunces/Space Grotesk) and has no site nav/footer — Load Fraunces (headings) + Space Grotesk (body) and add the shared nav/footer for consistency; remove the unused --red var.
- **[medium/brand] compare/index.html:** Compare-hub nav diverges from the four detail pages — Make compare/index.html's <nav class="links"> match the detail pages: add /features/ and /support.html and drop the inline 'Start free' link (the hero/CTA band already covers Start free).
- **[medium/brand] compare/procore.html:** Sticky nav still uses glassmorphism (backdrop-filter blur) — banned by current brand — In styles.css remove the `backdrop-filter` / `-webkit-backdrop-filter` declarations on header.nav and use a solid ink background (e.g. `background: #0B0D10;` or the ink token) with the existing hairline bottom border.
- **[low/brand] compare/procore.html:** Large display headlines use Space Grotesk instead of the Fraunces display serif — Point these display headlines at the Fraunces token: change to `font-family: var(--ff-serif)` (or `'Fraunces', Georgia, serif`). Confirm whether the numeric hero-stat-value is intentionally grotesk before changing it.
- **[low/brand] compare/procore.html:** Comparison 'yes' cells use a green (#1E8E4A) that reads as leftover green-brand — Recolor `.compare-yes` to an on-brand treatment — amber (#FF6A1A) or ink weight with a checkmark glyph — or a muted brand-neutral positive; drop the green hex.
- **[low/brand] compare/procore.html:** savings-card uses a decorative multi-stop dark gradient — Flatten to a single ink fill (e.g. `background:#0B0D10`) for the savings card, matching the flat-surface direction.
- **[low/images] compare/procore.html:** Four detail pages embed stale green-build app screenshots — Re-capture these eight screens from the current amber build and replace in /screenshots/screens/ (filenames can stay the same so no HTML edits are needed).
- **[high/content] demo.html:** FAQ says Free tier is "up to 2 projects" — contradicts 1-project everywhere else — Change "up to 2 projects" to "one active project" to match the pricing page and homepage.
- **[high/content] demo.html:** Annual prices ($348 Pro / $948 Business) show NO discount, contradicting pricing page's "2 months free" — Reconcile the annual numbers. If annual = ~2 months free, demo should read ~$288/yr (Pro) and ~$792/yr (Business), not $348/$948.
- **[medium/content] demo.html:** Launch-state inconsistent: "sign up in the App Store" vs TestFlight pre-launch vs web-only — Pick one launch story. If not yet on the App Store, change demo's "sign up in the App Store" to "start free on the web at app.mageid.app" and align access.html/playbook wording.
- **[medium/content] demo.html:** Homepage's "See how it works (90 sec)" leads to a non-existent video (placeholder only) — Either embed the real videos or soften the homepage/demo copy (e.g. "Book a live walkthrough") until videos exist, so the CTA doesn't dead-end on "coming soon."
- **[medium/a11y] demo.html:** Video "play" placeholders are non-keyboard-accessible clickable divs — Make the placeholders <button> elements (or add role="button" tabindex="0" + keydown handling) and give each an accessible label like "Play the 90-second tour."
- **[medium/brand] do-not-sell.html:** Green .ok-card reassurance box on an amber-brand page — Recolor .ok-card to the amber tint (rgba(255,106,26,0.06/0.20)) and set the strong color to #FF6A1A (or neutral cream).
- **[low/images] features/bids.html:** Three empty phone-frame placeholders — Add screenshots or remove the empty frames.
- **[low/links] features/bids.html:** Footer Privacy/Terms links drop the .html extension inconsistently — Standardize all footers to /privacy.html and /terms.html to match the nav and the rest of the site.
- **[medium/brand] features/client-experience.html:** Green (#1E8E4A) success color used across the group contradicts amber brand — Recolor #1E8E4A to var(--amber) (or a neutral positive that isn't green) across .compare-yes and the client-experience visual eyebrows; update the vs-other-tools legend text that currently says 'Green = full support'.
- **[medium/images] features/field.html:** Six of seven phone frames are empty placeholders — page renders as mostly empty mockups — Capture and insert the six missing screenshots (in the amber brand build), or drop the empty frames until assets exist.
- **[medium/images] features/financials.html:** Five empty phone-frame placeholders with no image — Add the five missing screenshots or remove the empty frames.
- **[high/brand] features/index.html:** Display headings use Space Grotesk (sans) instead of Fraunces serif — Replace `'Space Grotesk', serif` with `var(--ff-serif)` (Fraunces) on ex-hero h1, ex-panel h2, ex-section h3, and ex-mini-card h4. Leave body/mono uses alone.
- **[medium/brand] features/index.html:** Loads non-brand Inter font; brand set is Fraunces/Space Grotesk/JetBrains Mono only — Remove `&family=Inter:...` from the line-28 Google Fonts URL and change the .ex-voice::before font-family to var(--ff-sans) (Space Grotesk) or var(--ff-mono).
- **[medium/brand] features/index.html:** Blue accent callout breaks the amber-only palette — Recolor .ex-callout to amber: background rgba(255,106,26,0.10), border-left #FF6A1A, and strong color var(--amber).
- **[medium/brand] features/index.html:** Glassmorphism backdrop-filter on the sticky nav (shared styles.css) — affects every feature page — In styles.css, remove the two backdrop-filter declarations and use a solid `background: var(--ink)` (or an opaque rgba near 1.0) on header.nav.
- **[low/images] features/index.html:** Every feature page depends on stale green-brand screenshots (known re-capture) — Re-capture all embedded screenshots from the current amber (#FF6A1A) build; no page-specific fix beyond swapping the PNGs.
- **[low/seo] features/index.html:** canonical and og:url disagree on the features hub URL form — Make both use the directory form https://mageid.app/features/ (matches how the page is linked in nav).
- **[low/images] features/scheduling.html:** Two empty phone-frame placeholders — Add screenshots or remove the empty frames.
- **[low/brand] features/vs-competitors.html:** Section headings use Space Grotesk-as-serif rather than Fraunces — Switch the heading selectors (.savings-headline, .pricing-card h2, .table-stakes h3) to var(--ff-serif); leave the numeric stat-value classes as-is.
- **[low/content] icon-preview.html:** Internal WIP dev-note page is deployed publicly with off-name product copy — Remove icon-preview.html from the deployed site (or move it out of the web root / block via netlify redirect). If it must stay, strip the first-person dev notes and correct 'MAGE-AI' to 'MAGE ID'.
- **[high/content] index.html:** Enterprise PDF cap comparison "(vs 150)" is wrong — Business is 100 — Change "(vs 150)" to "(vs 100)" on line 611.
- **[medium/brand] index.html:** Moat section headings use 'Space Grotesk' not Fraunces — Change .moat-h and .moat-card h3 to font-family: var(--ff-serif) (Fraunces).
- **[medium/brand] index.html:** Purple plan-pin color (#805AD5) in Plans mockup — Change #805AD5 to the amber accent (or an ink/cream neutral) in landing.css:738.
- **[medium/brand] index.html:** Glassmorphism (backdrop-filter blur) on the nav bar, site-wide — Remove the backdrop-filter/-webkit-backdrop-filter declarations and use a solid ink background with a hairline bottom border on .nav.
- **[low/brand] index.html:** Primary nav/footer inconsistent with the rest of the site; no link to /pricing.html — Standardize the nav item set and footer markup/tagline across pages; add a Features/Support link and point Pricing to /pricing.html (or keep anchor but also expose the page).
- **[low/markup] index.html:** Inter font loaded but unused; Space Grotesk only arrives via CSS @import — Drop Inter from the font <link> and add Space Grotesk to it (or preload it); on playbook, replace 'Inter' with var(--ff-sans) or load Inter.
- **[low/images] index.html:** Leans on stale GREEN-brand screenshots — Re-capture both in the current amber brand; the moat proof image especially undercuts the 'Bid Confidence' pitch when it shows green UI.
- **[low/brand] landing.css:** Purple and green accent colors in the phone-mockup pins/badges (non-amber) — Recolor the plan-pin kinds to amber tints/tones (e.g. amber for one, a neutral fog/ink for the others) so the mock reflects the amber-only accent system; consider retoning badge-new to an amber/neutral treatment.
- **[medium/brand] playbook.html:** Headings use 'Space Grotesk' + green #22C55E success accents — Switch heading font-family to var(--ff-serif); recolor the .pb-voice-result success accent from green to amber.
- **[low/images] playbook.html:** Uses stale green-build screenshots — Re-capture in the current amber brand.
- **[medium/brand] portal/index.html:** Leftover glassmorphism (backdrop-filter blur) throughout the portal, incl. a saturate/blur sticky bar — Remove `backdrop-filter` / `-webkit-backdrop-filter` from surface and bar elements; use solid `var(--surface)` / `var(--ink)` fills with `--shadow-md` and 1px `--bone-2` borders. Blur on full-screen modal backdrops (lightbox/drawer) can stay if desired, but drop it from content surfaces and any sticky nav.
- **[low/brand] portal/index.html:** Off-brand purple accent color on the 'selection' activity icon — Recolor the selection activity icon to an on-brand hue — e.g. `--amber` (#FF6A1A) with a low-opacity tint, or `--info` blue — so no purple appears in the category legend.
- **[medium/a11y] preferences/index.html:** Preference toggle checkboxes have no accessible name — Add `aria-label` (e.g. the item's e.label) to each generated <input>, or associate the .label text via id + aria-labelledby.
- **[low/brand] preferences/index.html:** Utility pages use green success color and Georgia headings, off the brand palette — If keeping web-font-free, at minimum swap the success/toggle-on green to amber (#FF6A1A); optionally load Fraunces/Space Grotesk to match the marketing brand.
- **[high/content] pricing.html:** Enterprise PDF cap comparison "(vs 150)" is wrong — Business is 100 — Change "(vs 150)" to "(vs 100)" on line 393, and consider relabeling "PDF conversions" to "PDF takeoff pages" to match the paywall wording.
- **[low/brand] pricing.html:** Decorative multi-stop gradients on tier/stack cards — Replace the gradients with a flat tinted surface (e.g. rgba(255,106,26,0.06)) plus a 1px amber hairline border.
- **[low/images] pricing.html:** Feature-row screenshot is stale green build — Re-capture in amber brand.
- **[medium/content] privacy.html:** AI subprocessor named inconsistently across legal pages (Gemini vs Anthropic) — Standardize the named AI sub-processor(s) across privacy/terms/do-not-sell — align privacy.html to Anthropic (or list the full accurate vendor set on all three identically).
- **[medium/brand] privacy.html:** Legal page display headings hardcode Space Grotesk instead of Fraunces — Change `.legal h1`/`.legal h2` font-family to var(--ff-serif) (Fraunces) across all four legal pages.
- **[low/markup] privacy.html:** Stale, inconsistent styles.css cache-buster across legal pages — Bump all four pages to a single current `?v=` (e.g. 2026-07-07) whenever styles.css changes.
- **[high/brand] screenshots/Marketing Screenshots.html:** Screenshot generator loads the WRONG brand fonts (Inter + Instrument Serif) — Swap the Google Fonts link and body font-family to `Fraunces` + `Space Grotesk` + `JetBrains Mono` (mirror the @import at the top of landing.css/styles.css). Then update the hero components (app-store-heroes.jsx / social-heroes.jsx) to use Fraunces for titles and Space Grotesk for body.
- **[high/brand] screenshots/Marketing Screenshots.html:** GREEN brand colors hardcoded into screenshot presets — Replace all `#0e3d28` / `#7ed4a3` / `#0e1a14` preset values with the brand tokens: amber accent `#FF6A1A`, ink `#0B0D10`, cream `#F4EFE6` (light) / `#fff` (dark). Regenerate the affected artboards.
- **[medium/brand] screenshots/Marketing Screenshots.html:** Off-brand orange hex (#ff6b35) used instead of the amber token #FF6A1A — Replace every `#ff6b35` with `#FF6A1A` (or `#FF8533` where the hotter hover tone is intended).
- **[medium/brand] styles.css:** Glassmorphism (backdrop-filter blur) on the sticky nav — site-wide — Remove `backdrop-filter` / `-webkit-backdrop-filter` from `header.nav` (styles.css) and `.nav` / `.nav.is-scrolled` (landing.css); use a solid or near-solid flat `rgba(11,13,16,0.92+)` background with a hairline bottom border instead.
- **[low/brand] support.html:** Legal/utility page nav link sets are inconsistent with each other — Standardize the legal/utility header to one consistent set (e.g. Home, Privacy, Terms, Support) across all four pages.
- **[medium/brand] thanks.html:** Green success icon (#22C55E) is off-brand + H1 uses Space Grotesk not Fraunces — Recolor the icon to amber (rgba(255,106,26,0.15) bg, #FF6A1A stroke) and change the h1 to var(--ff-serif).
- **[medium/content] unsubscribe/index.html:** Support email support@mageid.app conflicts with help@mageid.app used site-wide — Change both unsubscribe mailto links to help@mageid.app to match the rest of the site.
