# Audit fix — deferred backlog (P2 / P3 / opportunities)

Source: docs/audits/2026-07-14-tri-persona-audit.md (279 findings). The 94
P0/P1 non-opportunity findings were fixed on branch `claude/audit-fixes`
(6 commits, ship-check green). This file is the remaining **192** items —
polish (P2), nice-to-haves (P3), and net-new feature opportunities — left
for prioritized follow-up rather than rushed overnight.

**Totals:** 192 deferred — consistency: 45, add-opportunity: 31, ux: 27, missing-state: 26, bug: 22, a11y: 14, copy: 13, tier-gating: 12, performance: 2

## P2 — 120 items

### Auth, onboarding, paywall & account setup (7)
- **[copy] Lede says 'two sides / pick one' but the screen shows four persona cards** — `app/persona-select.tsx`
  - Fix: Rewrite the lede to acknowledge all four choices (e.g. 'Are you building, hiring, managing property, or a bit of everything?') or collapse the UI to genuinely two primary choices with the others as secondary. The 'two sides' framing is stale relative to the property_manager addition.
- **[copy] Password field placeholder says 'Minimum 6 characters' but validation requires 8** — `app/reset-password.tsx`
  - Fix: Change the placeholder to 'Minimum 8 characters' to match the validation and signup.tsx.
- **[tier-gating] Read-only Claude/MCP connection is completely ungated — a premium AI surface given to Free** — `app/connect-claude.tsx`
  - Fix: Decide the intended tier (likely Pro or Business) and gate the screen with useTierAccess like generative-setup.tsx does — either a Paywall component on entry or a locked state in settings. If it is intentionally free as an acquisition hook, add a comment documenting that so it doesn't read as a missed gate.
- **[consistency] Splash promises 'Free to try · $29/mo' but no trial is described and the only paywall shown defaults to annual/Business framing** — `app/onboarding.tsx`
  - Fix: Once onboarding-paywall is wired in, align the copy: if there's a real free trial, say its length; if free tier just has limited AI trials (3 lifetime quick estimates per aiRateLimiterCore), phrase it as 'Free forever, AI unlocks with Pro' rather than 'Free to try'.
- **[consistency] Forgot-password and validation errors mix Alert dialogs with the inline error banner** — `app/login.tsx`
  - Fix: Unify: route forgot-password success/guard through the same inline banner + magicLinkSuccess-style card pattern so returning users get consistent, non-modal feedback.
- **[missing-state] No guard against duplicate/repeat verification submissions and no already-verified state** — `app/get-verified.tsx`
  - Fix: Read verification/license state (from CompaniesContext or a contractor_licenses query) on mount and branch: show 'You're verified' or 'Review in progress (submitted X)' instead of the form when applicable; disable resubmission while a request is pending.
- **[missing-state] Reset-password only reads tokens from query params, but Supabase recovery links deliver them in the URL hash** — `app/reset-password.tsx`
  - Fix: Confirm the deep-link path actually rewrites hash tokens into query params before this screen mounts; if not, add hash-fragment parsing here (mirroring _layout's helper) and render a clear 'Invalid or expired link' state when no valid session can be established, instead of letting the user type into a dead form.

### Bidding, RFPs, marketplace, leads, proposals (6)
- **[missing-state] Draft is saved but never auto-restored — the button implies persistence it doesn't deliver** — `app/post-rfp.tsx`
  - Fix: Add the mount-time restore (read DRAFT_PREFIX + user.id, hydrate state, drop unresolved attachment URIs as the comment describes) or, if that's not shipping now, change the copy so it doesn't promise resumability the flow can't honor.
- **[ux] Post-a-Job is permanently disabled (HIRE_ENABLED=false) but still a visible Discover entry point** — `app/post-job.tsx`
  - Fix: Hide the /post-job entry point in Discover while HIRE_ENABLED is false (or convert it to a waitlist capture). When hiring ships, wire addJob to a real backend — 'saved to this device' is not a marketplace.
- **[consistency] FlatList renders an empty data array; all content lives in ListHeader/ListFooter** — `app/(tabs)/marketplace/index.tsx`
  - Fix: Either use a real ScrollView (honest about the intent) or feed the filtered array into FlatList's data prop with renderSupplierCard/renderListingCard as renderItem so virtualization actually works before the catalog grows.
- **[consistency] Tracked-bid state is device-local AsyncStorage only, and parses JSON two different ways** — `app/bid-detail.tsx`
  - Fix: Persist tracked-bid status through the same sync path as other cross-device state (or explicitly scope it as device-local in the UI). Replace the raw JSON.parse in saveTracking with safeJsonParse for consistency.
- **[add-opportunity] The strongest differentiator in the cluster is buried three taps deep in Discover** — `app/win-optimizer.tsx`
  - Fix: Surface Win Optimizer at the moment of pricing: add an 'Optimize price' affordance in submit-bid-response and a deep-link from a project/estimate's bid action. Every use also feeds the learning loop, compounding the moat. This is the single highest-leverage add for this cluster.
- **[missing-state] Owner can review bids but has no way to edit or close their own RFP** — `app/rfp-detail.tsx`
  - Fix: Add at least a 'Close RFP' action for the owner (sets status closed, stops new bids, notifies nothing) even before full edit lands. That's a small write and removes a real dead-end.

### Billing & payments (invoices, AIA pay apps, change orders, retention, lien waivers, 1099, contracts, Stripe) (6)
- **[missing-state] No pull-to-refresh or manual refresh on the payments dashboard** — `app/payments.tsx`
  - Fix: Add a RefreshControl to the ScrollView that re-syncs invoices from the server (or at minimum re-derives), so the "is it paid" moment has a natural gesture. This is the screen GCs will refresh most.
- **[tier-gating] 1099-NEC export has no tier gate and no owner-facing check, unlike the rest of the money suite** — `app/tax-1099-export.tsx`
  - Fix: Gate behind the appropriate tier (likely `subcontractor_management`/Business, since the data source is sub payments) with the standard Paywall, so tax export sits at the same monetization tier as the sub tooling it depends on.
- **[ux] Once an invoice is Sent, the entire line-item editor disappears with no read-only view of what was billed** — `app/invoice.tsx`
  - Fix: Add the "Void & reissue" action the lock comment promises — clone the invoice to a new draft, void/mark the original, and let them fix it. This closes the loop the code already acknowledges is missing and matches the QuickBooks/Xero behavior the team is targeting.
- **[add-opportunity] The whole cluster stacks 'early-access Q3 2026' revenue placeholders — none are live, so the differentiation is aspirational** — `app/aia-pay-app.tsx`
  - Fix: Prioritize shipping ONE of these to live (financing is closest — payments-setup.tsx already has a working referral config + disclosure engine). A single working "offer your client monthly payments, pre-filled from this invoice" flow turns three placeholder cards into a real retention/revenue wedge and validates the fintech-at-pay-moment thesis the whole cluster is built around.
- **[ux] Retention dashboard is read-only — the release action lives only inside individual invoices, forcing a two-screen hunt** — `app/retention.tsx`
  - Fix: Surface a "Release" button on each invoice row (or per-project) here that opens the same release modal logic, so the dashboard is actionable rather than purely informational. This is the natural place a GC does closeout.
- **[consistency] AIA pay app can be opened from Tools with no invoice, landing on a valid-but-confusing empty state** — `app/aia-pay-app.tsx`
  - Fix: For the Tools launcher, either scope these entries to a project picker before navigating, or add a small 'opens inside a project' hint on the NavRow so the flat-list tap doesn't feel broken. The in-screen EmptyState here is good; the issue is the entry point promising more than it delivers.

### Client-facing (portal setup, client view, messages, outbox, updates, selections, shared photos) (6)
- **[tier-gating] Weekly-update AI is Pro-gated but the entry CTA gives free users no signal until after they tap Draft** — `app/client-update.tsx`
  - Fix: Add a subtle 'Pro' badge on the 'Draft Weekly Update' CTA in setup and on the draft button, and when a free user lands, show the value + upgrade path proactively rather than as a post-tap error. Sell the moat before the wall.
- **[add-opportunity] The cost-learning moat is invisible in the portal — 'what changed the price' explains COs but never the estimate itself** — `app/client-view.tsx`
  - Fix: Add an optional AI 'Why this estimate' explainer to the Budget Summary (GC-toggleable, like other sections) that turns the estimate spine into plain-English homeowner reasoning. This is the highest-leverage differentiation add in the cluster — it makes the portal a trust machine, not just a dashboard.
- **[consistency] Two unrelated 'Messages' surfaces (Hire chat vs. portal thread) create a naming/navigation collision** — `app/messages.tsx`
  - Fix: Rename this screen (and its nav label) to 'Hire chat' or hide it entirely while HIRE_ENABLED is false, so 'Messages' unambiguously routes to the client thread that actually works.
- **[missing-state] Outbox has no loading state and can't be reached directly when a project has no client portal enabled** — `app/client-outbox.tsx`
  - Fix: Guard onSendAll when no portal/invites exist with a clear 'Set up the client portal first' path, and align the empty-state copy with the full set of sendable item kinds.
- **[tier-gating] AI selection curation (paid Gemini calls) has no visible client-side tier gate on this screen** — `app/selections.tsx`
  - Fix: Confirm curateSelectionsAI enforces requireTier server-side; regardless, add a client-side useTierAccess gate so free users get a clean upgrade prompt instead of a raw failure or silent cost, mirroring client-update.tsx.
- **[ux] 'Last updated' shows the viewer's local clock time, implying freshness even when data is stale** — `app/client-view.tsx`
  - Fix: Base 'Last updated' on the max updatedAt across the project's real records (project.updatedAt, latest DFR/photo/CO), not the viewer's render clock. Show 'Updated 3 days ago' honestly.

### Estimating: wizard, confidence, calibration, accuracy, scope (7)
- **[consistency] Scope Sheet 'not a project' state is a bare one-liner, unlike every sibling screen's rich EmptyState** — `app/scope-sheet.tsx`
  - Fix: Swap to the EmptyState component with an icon, a one-line 'why', and an 'Open Projects' action, matching the sibling screens.
- **[tier-gating] Three cost-learning screens gate on 'job_costing' but the Paywall brands them as distinct named features** — `app/estimate-accuracy.tsx`
  - Fix: Either add explicit FeatureKeys for these (mapped to 'pro') for honest gating and analytics, or align the Paywall feature label to say 'Job Costing' so the gate and the promise match. Low code, removes a latent consistency trap.
- **[missing-state] Free-trial budget is invisible until the user is blocked — no '2 free estimates left' cue** — `app/estimate-wizard.tsx`
  - Fix: Show remaining free trials on the Generate button (or a small chip on the entry CTA) via getFreeTrialsRemaining('aiEstimateWizard'). Turns an opaque wall into a value-metered funnel.
- **[copy] 'Padded' / 'Overpriced' framing may push GCs to under-bid against their own margin** — `app/estimate-confidence.tsx`
  - Fix: Neutralize the copy: 'Above your history' / 'Higher margin than usual' rather than 'Padded', and frame it as informational (headroom) not a defect. Keep underpriced as the risk flag.
- **[bug] Cancel on the loading overlay flips spinner off but the in-flight AI call still completes and can overwrite state** — `app/estimate-wizard.tsx`
  - Fix: Add a cancellation token (a ref bumped in cancelGenerate) and check it before setResult/updateProject/recordAIUsage, or thread an AbortSignal through mageAISmart. Otherwise 'Cancel' is cosmetic and can produce surprise writes + a burned free trial.
- **[consistency] Estimator header uses hardcoded Colors.* instead of themed colors, unlike the rest of the cluster** — `app/(tabs)/estimate/index.tsx`
  - Fix: Route the inline Colors.* usages through the themed color object (the file already builds themed styles via useThemedStyles). Verifiable diff; removes a theme-drift class of bug across the tab.
- **[add-opportunity] The Estimator's flagship AI entry points show no tier/trial signaling and no cost-learning hook** — `app/(tabs)/estimate/index.tsx`
  - Fix: Add lightweight tier/trial badges to the AI CTAs (consistent with Cost X-Ray's pre-check), and add one cost-learning insight strip in the Estimator header that deep-links to calibration/confidence — converting the busiest estimating screen into a moat showcase and an upsell surface.

### Field PM — daily reports, RFIs, submittals, permits, OAC, handover, closeout, work orders, receipts, time (5)
- **[consistency] Handover has no tier gate despite depending on Business/Pro-gated features it links out to** — `app/handover.tsx`
  - Fix: Either gate Handover at entry to match the features it orchestrates (likely business), or make the gating story deliberate and consistent across Handover/Closeout/Punch. Right now it's neither fully free nor fully gated.
- **[a11y] Distribute-minutes email loop interpolates attendee/action text into HTML without escaping** — `app/oac-meeting.tsx`
  - Fix: HTML-escape interpolated user/AI text (a tiny escapeHtml over description/ballInCourt/names) before templating, and be conservative with the markdown→HTML transform.
- **[missing-state] 'Post for bids' fires with no confirmation and immediately navigates away** — `app/work-order.tsx`
  - Fix: Add a brief confirm ('Post this to the marketplace for contractors to bid?') and/or defer the status flip to 'posted_for_bids' until the RFP is actually submitted on the post-rfp screen, so an abandoned post doesn't leave a misleading status.
- **[bug] New-RFI attachments from a prefill photo are saved, but the screen offers no way to view/add attachments** — `app/rfi.tsx`
  - Fix: Add an Attachments section (thumbnail strip + 'Add photo/plan' button) to the RFI form so attachments are visible and editable, closing the loop with the prefill flow and the send-email attachment path.
- **[missing-state] Submittal 'attachments' are always empty — no cut-sheet upload despite the whole feature being about routing a document** — `app/submittal.tsx`
  - Fix: Add a cut-sheet/document attach control (image or document picker) that populates attachments, and include those attachments in buildSubmittalEmailHtml/sendEmail the way rfi.tsx passes existingRFI.attachments.

### Field capture & AI (scan, photo annotator, photo triage, project memory) (7)
- **[ux] AI confidence per photo is captured but never shown, so the GC can't tell which calls to double-check** — `app/photo-triage.tsx`
  - Fix: Surface low-confidence entries visually (e.g. a subtle 'Low confidence — check this' badge when confidence < ~70, or sort/flag them to the top). It costs one conditional and materially improves the accept/override decision.
- **[ux] COI without a linked sub silently downgrades to file-only with no visible explanation** — `app/scan.tsx`
  - Fix: When docType is insurance_coi and there are no linkable subs, show an inline note ('No subs on this project yet — filing as a document. Add the sub to file it as compliance.') so the downgrade is explained rather than silent.
- **[bug] Text-label pill width is a rough character-count guess and clips or over-runs the canvas** — `app/photo-annotator.tsx`
  - Fix: Clamp the pill's right edge to canvasW (and shift the anchor left if x+len > w), or measure text properly; at minimum cap len so the pill never exceeds the canvas bounds.
- **[missing-state] Empty-history state is reachable and confusing — chat input stays fully active with zero records** — `app/project-memory.tsx`
  - Fix: When docs.length === 0, replace the suggestion chips with a short 'Start logging RFIs, daily reports, and change orders — they become searchable here' call-to-action (optionally linking to create a daily report), and hide the '0 records' phrasing.
- **[ux] Extracted invoice line items are dropped from review — the GC can't verify or edit them before they hit the Cost Database** — `app/scan.tsx`
  - Fix: For invoice docType, render the parsed line items (even read-only, or with editable qty/unitPrice) before Save, or route invoices through the existing material-receipt review UI (which already shows editable lines) instead of silently committing them as 'reviewed'.
- **[ux] Undo removes markups oldest-last but there is no redo and no per-item edit/delete** — `app/photo-annotator.tsx`
  - Fix: Add tap-to-select on an existing markup with a delete affordance (and ideally drag-to-reposition), or at minimum a redo. Individual-item delete is the highest-value addition given normalized coords already make hit-testing feasible.
- **[bug] Skipped/failed photo encodes are surfaced nowhere in the triage UI** — `app/photo-triage.tsx`
  - Fix: Read meta.skippedIndexes and, when non-empty, show a small notice ('N photo(s) couldn't be read and were skipped') above the review list, as the util's own docs intend.

### Financials (budget, job costing, cash flow, margin risk/alerts, WIP, portfolio, payment prediction) (7)
- **[consistency] Hardcoded hex risk colors bypass the theme system used everywhere else** — `app/payment-predictions.tsx`
  - Fix: Replace RISK_COLOR literals with themeColors.success / Colors.warning / themeColors.danger so the per-invoice left border matches the themed score bubble and honors dark mode.
- **[ux] 'Add Expected Payment' asks for 'Days from now' as a raw number instead of a date** — `app/cash-flow.tsx`
  - Fix: Use a date picker (or at least a MM/DD field) for expected payment date, matching how invoices display dueDate. Show the resolved date back to the user before saving.
- **[missing-state] AI forecast has no loading skeleton, no empty distinction, and no cap/error affordance beyond a generic alert** — `app/budget-dashboard.tsx`
  - Fix: Standardize the AI result/error/loading pattern across budget-dashboard, cash-flow, and payment-predictions: in-card error with retry, an 'AI-generated' footer, and a remaining-uses hint when near the cap.
- **[consistency] Commitment editor's 'Signed date' and 'Number' are free-text with no validation** — `app/job-costing.tsx`
  - Fix: Use a date picker for signedDate (the app already uses expo date patterns elsewhere) and validate/normalize before save. Generate commitment numbers from a monotonic counter, not Math.random, to avoid dup numbers on the same project.
- **[add-opportunity] Margin Alerts is a passive inbox — no push wiring surfaced, and the note only hints at it** — `app/margin-alerts.tsx`
  - Fix: Add an explicit 'Margin alert notifications: On/Off' control with a one-tap enable and a 'you'll be notified when a job crosses to high risk' confirmation. This is the retention loop; make it a feature, not a footnote.
- **[tier-gating] Portfolio Margin Board, Margin Risk, Margin Alerts, and Living Estimate are all gated at Pro on the SAME key ('job_costing'), diluting the Business tier** — `app/portfolio-margin.tsx`
  - Fix: Reconsider tier placement: keep per-project Living Estimate at Pro as the hook, but move the portfolio roll-up (portfolio-margin) and the predictive Margin Alerts/Risk suite to Business, matching WIP/EVM. Give each its own FeatureKey instead of overloading 'job_costing' so gating is legible and adjustable.
- **[bug] WIP report iterates ALL projects (including completed/archived) with no status filter** — `app/wip-report.tsx`
  - Fix: Filter to in_progress/estimated (as portfolio-margin.tsx does: status === 'estimated' || 'in_progress') or expose a status filter chip. At minimum rename the variable to match reality.

### Home dashboard, tab/sidebar nav shell, reports & notifications (7)
- **[consistency] 'Live Bid Databases' is a NY-only static list shown to every GC nationwide** — `app/(tabs)/discover/index.tsx`
  - Fix: Filter the source list by the GC's state (settings.branding/location) or at minimum lead with the national sources (SAM.gov, BidNet, Dodge, USASpending) and collapse the state-specific ones behind a 'More in your state' expander. Remove 'updated daily' since the app isn't refreshing anything — these are static links.
- **[performance] 'Clear all' fires N separate DELETE mutations instead of one bulk delete** — `app/notifications-inbox.tsx`
  - Fix: Add a bulk-dismiss path to useNotificationFeed (single .delete().in('id', ids) with one invalidation) and call it from handleClearAll, mirroring how markAllRead already batches into one .in() update.
- **[missing-state] Home has no error state for a failed projects load — a fetch failure looks identical to 'no projects'** — `app/(tabs)/(home)/index.tsx`
  - Fix: Surface an explicit error/offline state on Home when the projects query errored (distinct copy: 'Couldn't load your projects — pull to retry') so a transient failure never masquerades as an empty account.
- **[consistency] Several report/notification screens hardcode hex colors, bypassing the theme (dark-mode contrast risk)** — `app/reports.tsx`
  - Fix: Replace the module-level/inline hexes with themeColors tokens (t.success, t.danger, t.accent, t.textMuted, t.surfaceAlt for the unread wash). If a truly theme-agnostic tone is needed, source it from Colors.* constants consistently rather than raw literals.
- **[add-opportunity] The moat (cost-learning × vision) is invisible on the highest-traffic screen** — `app/(tabs)/(home)/index.tsx`
  - Fix: Add a rotating, dismissible 'moat' hero slot on Home (or fold into NextStepHero) that, for projects with photos, deep-links into Cost X-Ray ('Price what you can't see in this photo') and for projects with a schedule surfaces the 'why this date' explanation. Convert daily opens into moat impressions and Business upgrades.
- **[tier-gating] Cost X-Ray tile routes free users to a generic paywall instead of a value-first upsell** — `app/(tabs)/discover/index.tsx`
  - Fix: Route locked users to a Cost X-Ray teaser (a sample analyzed photo + 'here's what it caught, priced on your costs') that ends in the paywall, rather than dumping them on /paywall cold. Value-first is exactly what the activation-audit memory prescribes ('engine deeper than competitors but every surface hides it').
- **[bug] MoneyStrip 'Outstanding' and Summary 'outstanding' use different math than the Reports A/R total, so the two screens can disagree** — `app/(tabs)/summary/index.tsx`
  - Fix: Extract a single getOutstanding(invoices) helper (balance-based, ignoring the status enum) and use it in Summary, Reports, report-inbox, and Home so every surface shows the same outstanding total.

### Marketing COMPARE / competitor-alternative / audience pages (6)
- **[consistency] Both 'audience' routes load external Google Fonts, unlike the self-hosted marketing pages** — `architect/index.html + builders/index.html`
  - Fix: Self-host the same font stack the marketing pages use (or link the shared /styles.css) so the whole site renders from first-party assets. At minimum align the sans-serif family so architect/builders match the marketing brand.
- **[copy] Leftover deploy TODO comment shipped to a public, indexed page** — `builders/index.html (line 553)`
  - Fix: Remove the TODO before ship, and centralize the Supabase host/ref in one config constant reused by both builders/ and architect/ (which hardcodes the same project URL + anon key at lines 285-286) so a project change is a one-line edit.
- **[consistency] Onboarding story contradicts itself across the cluster: 'self-serve, paying in 90 seconds' vs 'we set up your cost database in a 15-minute call'** — `buildertrend-alternative.html (FAQ line 50/165, table line 103) vs compare/procore.html (line 189)`
  - Fix: Pick one framing and make it consistent: e.g. 'Start self-serve in minutes — and if you want, we'll import your pipeline and seed your cost database in a free 15-minute call.' Frame the call as optional white-glove, not a required onboarding step, on every page.
- **[copy] Competitor pricing is left vague ('several hundred dollars a month') — weakens the savings punch** — `All four competitor pages (compare hub line 47; buildertrend hero line 77; houzz table line 96; jobtread FAQ)`
  - Fix: Add a single cited range per competitor in the savings card (e.g. 'Buildertrend plans commonly reported at $X–$Y/mo¹ — a year of MAGE ID Pro is $348'), matching Procore's 'math in plain numbers' treatment. Keep the footnoted-directional hedge.
- **[add-opportunity] Compare hub is thin — four buttons and a CTA; it under-sells the moat before the click** — `compare/index.html`
  - Fix: Add a compact 'MAGE ID vs everyone' summary matrix (cost-learning Bid Confidence / live margin alerts / flat price / free tier as rows; the four competitors as columns, all showing MAGE's unique 'yes') plus one hero screenshot, reusing the .compare-table idiom already defined on the child pages.
- **[copy] Weather auto-reschedule is claimed as shipped in one place and 'on the roadmap' in another** — `compare/procore.html (row 'AI scheduling', line 165) + all pages' 'weather-aware reflow on the roadmap'`
  - Fix: Reconcile to the true state. If weather reflow is live, drop 'on the roadmap' everywhere; if it's roadmap, soften the Procore page's shipped-sounding moat card + comparison row to match. Consistency here protects the honesty positioning the pages otherwise earn.

### Marketing FEATURE pages (marketing/features/*.html — 11 pages: index explorer, 7 feature deep-dives, 3 vs-competitor pages) (6)
- **[consistency] Three different footer structures ship across the cluster** — `features/index.html vs bids/field/financials/scheduling/marketplace/post-a-project/vs-* footers`
  - Fix: Standardize on ONE footer partial across all feature pages (the four-column .footer-grid is the most complete). Include client-experience.html in the Product column everywhere so it isn't orphaned.
- **[bug] .pill class on the FY26 tag is undefined — renders as unstyled inline text** — `features/bids.html`
  - Fix: Use the existing .badge / .badge-soon class (already defined in styles.css and used correctly on scheduling.html for 'Soon' tags) instead of the nonexistent .pill.
- **[bug] styles.css cache-buster is out of sync — feature pages pin an older version than the Compare hub** — `features/* (whole cluster) vs compare/index.html`
  - Fix: Bump the ?v= query on every feature page to match the latest styles.css revision whenever the CSS changes, ideally via a build step so it can't drift.
- **[copy] Roadmap features are presented alongside shipped ones with inconsistent 'coming' labelling — trust risk** — `features/scheduling.html`
  - Fix: Audit each scheduling capability against what actually ships today and apply the Coming/Soon badge consistently. If DCMA 14-point is real, get a real screenshot; if it's roadmap, badge it like AI risk forecast.
- **[add-opportunity] The explorer buries the cost-learning moat — Bid Confidence / live-margin-alert never appears** — `features/index.html (explorer)`
  - Fix: Add a dedicated 'Bid Confidence / Cost Learning' beat to the explorer (or fold it into the Projects tab) that states plainly: prices learned from your own actuals, live margin, alert before a job loses money. This is the one thing that most differentiates MAGE and it's missing from the page most likely to be shared.
- **[consistency] Hard, specific numeric claims risk going stale and contradict each other across pages** — `features/vs-other-tools.html + vs-competitors.html`
  - Fix: Round soft/volatile counts ('2,900+ vetted subs') so they don't rot, and pick ONE canonical savings figure to repeat across all three vs-* pages so the story is internally consistent.

### Marketing LANDING funnel (4)
- **[bug] Margin-mode trap copy can display a confusing/edge-case string when margin ≥ 100%** — `calculator.html`
  - Fix: Guard the margin field to <100 with a friendly note ('margin must be under 100%'), and short-circuit the trap message for 0 inputs ('Enter your cost and target to see the gap'). The calculator's whole value is making the math feel trustworthy — an off-looking string undercuts that.
- **[consistency] FAQ answer claims a longer support list and '$400–$700/month' competitor cost that other pages state differently** — `demo.html`
  - Fix: Pick ONE competitor-cost figure (or a sourced range) and use it verbatim everywhere, and make every 'see pricing' link resolve to the same page. Consistency here is what makes the number believable.
- **[add-opportunity] Proof section has no social proof — the honest 'no testimonials yet' gap is the biggest conversion lever to fill** — `index.html`
  - Fix: As soon as one real GC will go on record, add a single specific, verifiable quote or number here ('cut buyout leakage $52K on a $1.1M job' beats any adjective). Even one concrete result outperforms the current all-adjectives founder paragraph. This is the highest-leverage ADD for the whole funnel.
- **[consistency] Playbook TOC section numbering is out of order and internally inconsistent (5, 5b, 6, 6b sequence)** — `playbook.html`
  - Fix: Renumber to a single monotonic sequence (make buyout its own numbered step in the right place, or clearly mark 5b/6b as 'bonus' sub-sections in both TOC and body in the same order the body renders). Match TOC order to DOM order.

### Marketing PRICING, access, support, legal, 404, client portals (4)
- **[consistency] access.html uses Space Grotesk while the rest of the site brand is Fraunces + JetBrains Mono** — `access.html`
  - Fix: Align access.html (and thanks.html, which shares the same minimal footer) with the canonical styles.css font stack and the standard site-footer used on pricing.html, so the funnel feels like one coherent brand.
- **[consistency] Free-tier client-portal messaging contradicts itself vs. the feature list** — `pricing.html`
  - Fix: Make the tier boundary explicit and consistent: add a muted 'Live client portal (Pro)' row to the Free card so it's unambiguous, and add a one-line tier note to the support.html client-portal guide ('Client portal is available on Pro and above').
- **[copy] Portal referral CTA sends prospects to the bare domain instead of a conversion page** — `portal/index.html`
  - Fix: Point the portal referral CTA at a purpose-built page (e.g. /pricing.html?ref=portal or a short 'built with MAGE ID' explainer) that converts the specific 'I saw this and want it' intent, and keep the ?ref=portal param so PostHog can attribute portal-sourced signups.
- **[a11y] Passcode gate and key portal controls are div/button soup with weak semantics and no error announcement** — `portal/index.html · sub-portal/index.html`
  - Fix: Add aria-live="polite" (or role="alert") to the gate .err element so incorrect-passcode feedback is announced, wrap the passcode form in a <form> with a submit handler, and normalize the JS-rendered section titles to real heading elements for a consistent document outline.

### Punch lists, punch/warranty walks, AI punch, warranties (6)
- **[missing-state] Due Date is free-text 'YYYY-MM-DD' with no validation and no picker — inconsistent with a jobsite one-handed flow** — `app/punch-list.tsx`
  - Fix: Replace the free-text due date with a native date picker (or quick chips: Today / +3d / +1wk), and format dueDate consistently on the card via a date formatter rather than echoing raw input.
- **[add-opportunity] AI Punch surfaces trade + confidence but throws away the cost-learning moat — no price estimate on found items** — `app/ai-punch.tsx`
  - Fix: For each reviewed item, call the same cost-learning lookup Cost X-Ray uses (keyed on trade/category) and show an optional estimated-cost chip on the review card and on the saved punch item. This is the single highest-leverage differentiator to add here — it makes AI Punch produce billable value, not just a task list.
- **[add-opportunity] No expiry reminder / notification wiring despite reminderDays being set — the retention hook is dormant** — `app/warranties.tsx`
  - Fix: Wire reminderDays into the NotificationProvider so an expiring_soon transition fires a local notification + a home-screen banner (like the 11-month walk banner), with a one-tap 'Email homeowner about renewal / inspection' action. Reuses the warranty-walk email plumbing already present.
- **[tier-gating] Email-to-homeowner has no failure detail and no Pro/Business gate distinction — silent-ish send with only isFree used for a growth badge** — `app/warranty-walk.tsx`
  - Fix: Add a catch around the send that surfaces an Alert on total failure, and confirm whether client-facing branded email should be tier-gated consistent with the rest of the portal/SendToClient surfaces. If free is intentional as a growth lever, keep it but make the failure path explicit.
- **[ux] Walk-mode session roll-up is lost on leaving the screen with no warning, and undo only works while still on-screen** — `app/punch-walk.tsx`
  - Fix: Either persist the session summary keyed to the walk so returning restores it, or show a lightweight confirm ('You captured N items — leave walk?') on back when session.length > 0. The items are safe; it's the review/undo context that's fragile.
- **[bug] handleSaveAll's per-item try/catch can never catch — handleSaveOne swallows its own errors, so failed counts are always 0** — `app/ai-punch.tsx`
  - Fix: Make handleSaveOne return a boolean/throw on the real skip conditions (blank description), and have handleSaveAll count those, so the carefully-built partial-success alert reflects reality. Otherwise remove the dead failure-reporting branch to avoid misleading maintenance.

### Safety (dashboard, JHA, hazards, incidents, inspections, OSHA, certs, toolbox, forms) (7)
- **[ux] Hub tile counts are ambiguous — Certifications shows only expiring, OSHA shows only recordable** — `app/safety.tsx`
  - Fix: Either make all tile counts totals (certifications.length, incidents.length) for consistency, or keep the risk-weighted counts but add a tiny qualifier on those two tiles ('3 expiring' / '2 recordable') so the number reads correctly. Consistency across the grid is the safer default.
- **[missing-state] Occurred / days-away date and number fields accept unvalidated input, unlike certifications** — `app/safety-incidents.tsx`
  - Fix: Reuse the same Date.parse guard from safety-certifications on occurredAt (and ideally the other date fields), and validate the day-count inputs are non-negative integers. This is a compliance surface where a silent bad date corrupts the OSHA log.
- **[bug] AI-detected hazard suggestions are dropped when editing, and the captured scan photo is never saved to the hazard** — `app/safety-hazards.tsx`
  - Fix: In applySuggestion call resetForm() (or explicitly setEditingHazard(null)) before opening the form so a suggestion always creates a new hazard. Persist the scanned photo (upload pickedUri or keep the URL) onto hazard.photoUrl so the log keeps the visual evidence.
- **[consistency] JHA delete button uses a solid danger fill while every other screen uses the danger-tint** — `app/safety-jha.tsx`
  - Fix: Change safety-jha deleteBtn to backgroundColor: themeColors.danger + '18' to match the shared pattern.
- **[ux] OSHA-recordable status is auto-classified but never previewed in the form** — `app/safety-incidents.tsx`
  - Fix: Add a live recordability chip in the OSHA-classification section that calls isOshaRecordable on the current form state (the helper is pure and already imported) — e.g. 'Will be recorded on OSHA 300' vs 'Not OSHA-recordable', mirroring the hazard risk preview.
- **[missing-state] Forms Library ships empty — no starter templates, so the AI/inspection flows have nothing to pull from** — `app/safety-forms.tsx`
  - Fix: Seed a handful of read-only starter templates (or a one-tap 'Add standard forms' action in the empty state) covering the common OSHA-adjacent checklists. This also makes the inspection template picker useful on day one and showcases the feature during trial.
- **[add-opportunity] Expiring-cert tracking has no notification hook — the whole value is 'get a heads-up before it lapses'** — `app/safety-certifications.tsx`
  - Fix: Wire expiring certifications into the existing notification system (local or push) with a lead-time reminder, and surface an at-a-glance 'expiring in 30 days' rollup on the Safety hub. Delivers on the copy and creates recurring re-engagement.

### Scheduling (Pro scheduler, import, review, wizard, shared, last-planner, classic tab) (7)
- **[consistency] Last Planner is gated on the wrong feature key and advertised without a lock in discover/tools** — `app/last-planner.tsx`
  - Fix: Introduce a purpose-named FeatureKey (e.g. 'last_planner') mapped to 'pro' so the gate reads honestly and can be re-tiered independently, and add a lock badge to the tools.tsx Last Planner row for sub-Pro users (mirror how other gated tools are badged).
- **[ux] Native CSV export dumps the first 600 characters into an Alert instead of a file** — `app/schedule-pro.tsx`
  - Fix: Write the CSV to FileSystem.cacheDirectory and open the native share sheet via expo-sharing (the .ics path in handleExportIcs already proves this pattern works). Never truncate export data into an Alert.
- **[bug] Sub-mode date range hardcodes a 5-day week, so shared dates can disagree with the GC's calendar** — `app/shared-schedule.tsx`
  - Fix: Include workingDaysPerWeek (and ideally nonWorkingDates) in buildSharePayload and thread it into taskDateRange, or render dates from the CPM's calendar-aware start/finish that the Pro screen already computes, rather than re-deriving them here with a hardcoded 5.
- **[missing-state] The AI draft is consumed one-shot with no re-entry — a reload or accidental back loses the whole generated schedule** — `app/schedule-review.tsx`
  - Fix: Persist the draft (AsyncStorage keyed by projectId) so it survives reload, and clear it only on accept/explicit discard. Add the same 'Overwrite existing schedule?' confirmation that schedule-wizard.onSavePressed already implements (line 206-221) before accept() clobbers an existing plan.
- **[a11y] Header action buttons and the AI/Undo/Redo/Export toolbar lack accessibility labels and are 14px icons** — `app/schedule-pro.tsx`
  - Fix: Add accessibilityRole='button' and a descriptive accessibilityLabel to HeaderBtn (and pass through disabled state via accessibilityState), and bump the hit target with hitSlop or larger padding to reach ~44px.
- **[missing-state] Import busy/error states are solid, but a successful import that maps zero real columns gives a confusing 'Nothing to import' with no diagnosis** — `app/schedule-import.tsx`
  - Fix: When importableCount === 0 but result.rows.length > 0, surface an explicit diagnostic ('We couldn't find a task-name column — rename your header to "Task" and re-import') instead of a silent disabled button. Show the rawColumns that WERE detected even when the title mapping failed.
- **[add-opportunity] The cost-learning moat is invisible in the scheduler — durations and crew sizes are presented as facts, not as learned/AI-explained values** — `app/schedule-pro.tsx`
  - Fix: Carry the rationale/assumption metadata from schedule-review into ScheduleTask and render it in TaskInspector (and as a subtle dot on assumed durations in the grid). Add a 'learned from N similar jobs' confidence hint so the scheduler visibly shows off the moat instead of looking like every other Gantt.

### Settings, Integrations (QBO), Data Import/Export, Equipment, Materials, Managed Property (6)
- **[consistency] Fully-mocked Integrations hub appears orphaned and duplicates the real QBO entry point** — `app/integrations.tsx`
  - Fix: Decide the hub's fate: if it's a roadmap placeholder, keep it unreachable and out of nav (current state is OK but risky); if it's meant to ship, wire the QuickBooks card to route into the real /qbo-setup and reflect live qboStatus instead of the mock, and remove the duplicate. At minimum add a code comment / route guard noting it's preview-only so it isn't accidentally linked.
- **[tier-gating] Free plan advertises 'Materials browser (view only)' but the app lets any tier add to cart** — `app/(tabs)/settings/index.tsx`
  - Fix: Pick one: if add-to-cart/estimate-building is genuinely a Pro feature, gate handleAddToCart behind a Paywall for Free tier; if browsing+carting is intentionally free (good for activation — let them feel the pricing engine), fix the plan copy to 'Materials browser + bulk pricing' and move the real Pro line to the estimate/markup step. Aligning copy to behavior removes a discoverable inconsistency.
- **[copy] 'LIVE PRICING' + 'updated in real-time' + Wi-Fi indicator overstate a deterministic client-side price jitter** — `app/(tabs)/materials/index.tsx`
  - Fix: Soften to defensible language: 'Regional pricing estimates' with 'Indicative — verify with your supplier before ordering', and drop the Wi-Fi/real-time framing until a real price source is wired. Keep the location multiplier (that's genuinely useful and honest). This protects the cost-learning moat's credibility rather than undermining it with theatre.
- **[missing-state] Multi-file export gives no way to re-share the batch and no progress for the ~5s closeout render** — `app/data-export.tsx`
  - Fix: Bundle multi-file exports into a single .zip (or share the containing folder) so 'Generate & share' always yields one shareable artifact — matches the 'hand it to your accountant' story. Add a lightweight progress line ('Rendering closeout PDF…') during the slow path so the button spinner reads as work, not a hang.
- **[bug] Editing equipment fields then navigating away loses changes with no dirty-state guard** — `app/equipment-detail.tsx`
  - Fix: Add a dirty-state check: if any edit field differs from equip, intercept back with an 'Discard changes?' Alert (or auto-save on blur like the branding auto-save pattern already used in Settings). For logUtilization, require a project selection (or clearly label 'General fleet, no project') so hours always attribute to a cost bucket.
- **[bug] 'Clear All Data' only deletes projects, leaving invoices/COs/RFIs/photos/equipment orphaned in storage** — `app/(tabs)/settings/index.tsx`
  - Fix: Make Clear All actually clear all: iterate the known tertiary_* keys and the equipment/contacts/subs stores (ideally via a single ProjectContext.clearAllData() so the in-memory state and storage stay consistent), or reword the confirmation/success copy to state exactly what it removes. Given it's in the DANGER ZONE, correctness matters most.

### Subs & crew: sub portals, scorecards, prequal, buyout, COI vault, companies, contacts, workers (10)
- **[consistency] company-detail belongs to the government-bid product, not the residential subs/crew cluster** — `app/company-detail.tsx`
  - Fix: Confirm whether the government-bid marketplace (companies, bid-detail, mage-id-bids) is a shipping surface. If it is, keep it but audit it as its own cluster with its own paywall story. If it's legacy/experimental, hide it from nav. It should not be evaluated as part of the residential subs workflow — mixing them dilutes the product focus.
- **[tier-gating] COI Vault gated on the semantically-wrong 'rfis_submittals' key** — `app/coi-vault.tsx`
  - Fix: Introduce a dedicated 'coi_vault' FeatureKey (or reuse 'prequal_coi' for consistency, since COI validation is squarely the same compliance job). Align COI Vault and Prequal to the same tier so the two Subs-tab banners tell one coherent upgrade story.
- **[consistency] Portal link ID is hand-rolled with Date.now() instead of the imported generateUUID; import is dead** — `app/sub-portal-setup.tsx`
  - Fix: Use generateUUID() for the portal link id (or append it), matching the rest of the app and hardening the public URL against slug guessing. Remove the import if you truly intend the composite id.
- **[missing-state] Subs list has no compliance-date validation, so 'Expired' status can be silently wrong** — `app/(tabs)/subs/index.tsx`
  - Fix: Add a date picker or strict format validation + an Invalid-Date guard in getComplianceStatus that surfaces 'Check date' rather than defaulting to Compliant. On a compliance-critical field, garbage-in must not read as green.
- **[bug] Invite uses raw mailto: with rork-app:// deep link that won't open on the sub's device** — `app/prequal-manager.tsx`
  - Fix: Send prequal invites through the same https://mageid.app universal-link + edge-function email path the sub portal uses, so the sub can open the form in a browser with no app installed. A rork-app:// scheme in an email to an un-onboarded sub is a dead link.
- **[tier-gating] Buyout dashboard (the marketed centerpiece) has no tier gate while its scope-gap sibling does** — `app/buyout.tsx`
  - Fix: Decide the buyout tier story deliberately: if buyout is a paid differentiator, gate the dashboard consistently with scope-gap/scorecard; if it's an intentional free hook that upsells via the metered AI leveling, document that and make the scope-gap gate match. Right now the inconsistency reads as an oversight.
- **[add-opportunity] Sub Scorecard is the moat but has no action from the grade and no entry point from a sub** — `app/sub-scorecard.tsx`
  - Fix: Add an action row per card (Invite to next buyout package / Open sub detail / Start prequal) and surface each sub's grade chip inline on the Subs list and sub detail modal. Turn the scorecard from a report into a decision surface — that's what converts the moat into retention.
- **[ux] Submit button disabled-look with 'Submit anyway' active is a confusing mixed signal** — `app/prequal-form.tsx`
  - Fix: Don't grey out a button that is tappable. Use a distinct secondary/outline style for 'Submit anyway' (active-looking, visually softer than the green pass state) so the affordance matches the action. Reserve the disabled style for the genuinely-blocked hardFail case.
- **[consistency] claim-crew uses legacy Colors and raw onPress text-as-link, off-pattern from the rest of the cluster** — `app/claim-crew.tsx`
  - Fix: Reskin claim-crew with the themed styles + a real styled button (accessibilityRole='button', 44pt target) and success/failure icons, matching prequal-form's ErrorState. It's the very first screen a claimed worker sees — it should feel finished.
- **[a11y] COI Vault hardcodes hex colors instead of theme tokens, breaking dark mode and consistency** — `app/coi-vault.tsx`
  - Fix: Replace the hardcoded hexes with themeColors tokens (success/danger/warning/textMuted/accent). This is the one screen in the cluster that ignores the theme system; aligning it fixes dark-mode contrast and visual consistency in one pass.

### Takeoff, area takeoff, cost database, Cost X-Ray (6)
- **[add-opportunity] The learned price book has no export/share — the single most valuable asset the app builds can't leave the app** — `cost-database.tsx`
  - Fix: Add an export (CSV + a branded PDF 'Your Cost Book') to the header. It's low effort over the already-aggregated db.entries, reinforces the moat message, and creates a shareable artifact that markets the product.
- **[ux] Numeric quantity/price inputs use decimal-pad with no Done/dismiss affordance — one-handed on iPhone the keyboard traps the user** — `takeoff.tsx (EditableRow) + takeoff-estimate.tsx (LineRow) + area-takeoff.tsx + cost-xray.tsx`
  - Fix: Add an InputAccessoryView 'Done' bar (iOS) or a keyboard-dismiss on scroll to the numeric editors, and confirm keyboardShouldPersistTaps='handled' on the scroll containers so tapping a Commit/Done button while the keyboard is up registers. This is a repeated pattern — fix once as a shared numeric-field component.
- **[add-opportunity] The takeoff summary never shows a dollar figure — the review screen quantifies LF/SF/EA but hides the number the GC actually cares about** — `takeoff.tsx`
  - Fix: Add a headline 'Rough value: $X–$Y' band to the summary card computed with the deterministic engine rater already written for takeoff-estimate — no extra AI call. It gives instant payoff, sharpens the moat story (priced off learned rates), and is a natural upsell surface for free users.
- **[missing-state] Cost X-Ray silently requires a project with a linked estimate but the entry point and picker never say so — accepted tells can vanish into just tasks** — `cost-xray.tsx`
  - Fix: Mark projects without a linkedEstimate in the picker ('no estimate — tasks only'), and if the currently-selected project has no estimate, show the caveat up front near the Scan CTA rather than in a terminal Alert after a paid scan. Don't display a contingency total in the apply bar that the target can't receive.
- **[ux] 'Add to estimate' is gated on a pre-existing cost-and-markup estimate, so the flagship loop-closer is invisible/dead for most in-progress projects** — `area-takeoff.tsx`
  - Fix: When there's no linkedEstimate, offer to seed one from this line ('Start an estimate with this line') instead of only explaining why the button is missing. The commitEstimatePatch/LinkedEstimate scaffolding is already imported here.
- **[bug] Overrides and rejections capture correction/training signal but 'edited' rows are re-analyzed fresh on every re-run — no visible sign the correction was learned** — `takeoff.tsx`
  - Fix: Either surface how many prior corrections informed this run ('applied N of your past fixes'), or at minimum warn on Run-again that manual edits will be discarded and offer to keep rejections. If corrections don't yet feed back into analysis at all, label the accuracy panel honestly so it doesn't imply live learning it isn't doing.

## P3 — 65 items

### Auth, onboarding, paywall & account setup (8)
- **[copy] Web paywall makes an unverifiable timing promise ('~30 seconds') and Enterprise failures diverge from Pro/Business** — `app/paywall.tsx`
  - Fix: Soften the web copy to 'usually within a minute' or 'shortly after sign-in.' For consistency, either give all three purchase handlers the help-friendly raw-message treatment or none; leaking err.message only for Enterprise is inconsistent.
- **[bug] Restore always routes to home and claims success even when nothing was restored** — `app/onboarding-paywall.tsx`
  - Fix: After restorePurchases(), check the returned/updated tier before claiming success — if tier is still 'free', show 'No active subscription found to restore' instead of 'Restored'.
- **[bug] Tier gate returns a Paywall before any hooks run in the default export — brittle vs React hook rules** — `app/generative-setup.tsx`
  - Fix: Keep hooks-then-return discipline explicit with a comment, or move the gate inside GenerativeSetupInner using a normal conditional render so all hooks always run. Low risk today, but worth hardening since it's the template other 'gated wizard' screens copy.
- **[missing-state] Pipeline import has no post-parse validation feedback or error state on addLead failure** — `app/onboarding.tsx`
  - Fix: Wrap the loop in try/catch; on partial failure, surface how many imported vs failed (e.g. an inline note or a toast) before navigating, and still proceed to home so the user isn't stuck.
- **[missing-state] Google/Apple signup failures are silently swallowed, same as login** — `app/signup.tsx`
  - Fix: Mirror the login fix: surface real (non-cancel) OAuth failures via setErrorMessage so the existing errorBanner renders.
- **[a11y] Freshly-minted token copy rows lack accessibility roles/labels and rely on tap-to-copy discoverability** — `app/connect-claude.tsx`
  - Fix: Add accessibilityRole='button' and accessibilityLabel='Copy connector URL' / 'Copy token' to the codeRow TouchableOpacities, and consider an explicit 'Copy' button label rather than icon-only for this critical one-time action.
- **[missing-state] Preview button is a web-only no-op on mobile with no visible disabled state** — `app/public-profile-setup.tsx`
  - Fix: On native, either open the publicUrl via Linking.openURL / an in-app browser, or hide/disable the Preview button so it doesn't present a dead control on the primary platform.
- **[add-opportunity] Onboarding routing captures job size but never asks for company/branding — the highest-value personalization is deferred to empty state** — `app/onboarding.tsx`
  - Fix: Add an optional lightweight 'What's your company called?' capture (name + optional logo) either as a 5th onboarding beat or a home-checklist item that the demo seed and first proposal read from, so the wow moment (a branded proposal) happens on day one.

### Bidding, RFPs, marketplace, leads, proposals (3)
- **[consistency] State picker only offers the first 10–15 US states** — `app/post-bid.tsx`
  - Fix: Render all US_STATES in the horizontal scroller (it already scrolls) or swap to a searchable picker. Same fix in both post-bid and post-job.
- **[consistency] 'Open leads' KPI counts won and lost leads, contradicting its label** — `app/leads.tsx`
  - Fix: Either relabel to 'Total leads' or compute open = total − won − lost so the number matches the word. The pieces (wonCount/lostCount) are already computed one block down.
- **[copy] Binding-estimate disclaimer may overstate legal commitment and could chill bidding** — `app/submit-bid-response.tsx`
  - Fix: Soften to reflect reality (e.g. 'This is a good-faith estimate; final pricing may adjust after a site walk') and align it with the site-visit toggle. Have someone confirm the intended legal posture before shipping absolute 'binding' copy.

### Billing & payments (invoices, AIA pay apps, change orders, retention, lien waivers, 1099, contracts, Stripe) (3)
- **[ux] "Manage on Stripe" opens the generic Express login root, not the GC's account** — `app/payments-setup.tsx`
  - Fix: Generate a Stripe Express login link server-side (createLoginLink on the connected account) and open that, so "Manage on Stripe" lands them directly in their own dashboard. Low effort, closes the last gap in an otherwise strong onboarding flow.
- **[consistency] Bill-from-estimate uses global settings.taxRate at draft time; downstream invoice pins its own — silent divergence if the setting changes** — `app/bill-from-estimate.tsx`
  - Fix: Minor: add a short comment mirroring invoice.tsx's tax-immutability rationale, and consider surfacing the tax rate (currently invisible until the next screen) so the GC sees the draft total is tax-inclusive before continuing. Not urgent — no incorrect number is produced today.
- **[ux] "Sign & send" is disabled until the payment schedule foots exactly, but the only fix offered wipes custom milestones to 25/25/25/25** — `app/contract.tsx`
  - Fix: Add a gentler rebalance option (e.g., "Apply $X difference to last milestone" or "Scale to fit") alongside the nuclear reset, so a small mismatch doesn't force losing a deliberate schedule.

### Client-facing (portal setup, client view, messages, outbox, updates, selections, shared photos) (3)
- **[add-opportunity] Shared-photos link is a great CompanyCam-killer wedge but has no capture-the-lead hook** — `app/shared-photos.tsx`
  - Fix: Add a soft, non-intrusive CTA for the viewer (e.g. 'Want progress alerts on this project? Enter your email') and a stronger 'Contractors: run your whole job like this' hook. This is free top-of-funnel every time a GC shares photos.
- **[bug] Dead style + orphaned diagnostic: snapshotSizeKb computed but never shown, sizeWarning style unused** — `app/client-portal-setup.tsx`
  - Fix: Delete snapshotSizeKb, the sizeWarning style, and portalLinkWithHash if truly unused, or gate them behind a debug flag. Keeps this critical file honest.
- **[a11y] Collapsible section headers and status colors lack accessibility state/labels** — `app/client-view.tsx`
  - Fix: Add accessibilityRole='button' + accessibilityState={{expanded}} + a label to SectionHeader, and ensure every color-coded status also reads its meaning to screen readers.

### Estimating: wizard, confidence, calibration, accuracy, scope (2)
- **[consistency] Wizard result view double-pads under a modal header it also declares** — `app/estimate-wizard.tsx`
  - Fix: Pick one: either headerShown:false + custom header like the sibling screens, or keep the native modal header and drop the manual insets.top padding. Also settle on a single stable title.
- **[ux] Living Estimate has no standalone empty entry — 'no margin basis' card is good, but there's no cross-link to build the estimate that would populate it** — `app/living-estimate.tsx`
  - Fix: Distinguish 'no estimate yet' (route to estimate-wizard/estimator) from 'estimate exists but flat, no markup' (route to Job Costing), so the CTA matches what's actually missing.

### Field PM — daily reports, RFIs, submittals, permits, OAC, handover, closeout, work orders, receipts, time (3)
- **[ux] Clock-out and break actions give no undo and clock-out only a blocking alert** — `app/time-tracking.tsx`
  - Fix: Offer an undo (e.g. a toast with 'Undo' for a few seconds, or a 'reopen' affordance on the just-created history entry), or a light confirm on clock-out. The nailIt/toast pattern already used elsewhere would fit.
- **[add-opportunity] Inspection dates are tracked but never turn into reminders — the obvious retention hook is missing** — `app/permits.tsx`
  - Fix: On save of a permit with status inspection_scheduled + a future inspectionDate, schedule a local notification (e.g. T-1 day and morning-of), reusing the notification plumbing time-tracking already uses. Cheap to build, high perceived value, reinforces the 'MAGE watches the calendar for you' story.
- **[missing-state] Audio upload is silently mobile-only and the transcribe endpoint has no timeout** — `app/oac-meeting.tsx`
  - Fix: Add an AbortController with a generous timeout (e.g. 90s) and a Cancel affordance on the uploading state, surfacing a retriable error on timeout.

### Field capture & AI (scan, photo annotator, photo triage, project memory) (2)
- **[a11y] Confidence percentage and doc-type badge lack accessibility labels and the confidence has no low-confidence treatment** — `app/scan.tsx`
  - Fix: Add an accessibilityLabel to the confidence badge ('AI confidence 41 percent') and apply a warning treatment (color + a 'double-check this' hint) below some threshold, so low-confidence auto-files invite scrutiny before Confirm & file.
- **[add-opportunity] No way to save, share, or turn a memory answer into an artifact — the insight evaporates** — `app/project-memory.tsx`
  - Fix: Add a long-press or trailing action on assistant bubbles to copy the answer and/or 'Use in change order / RFI / email to client', reusing the deep-link plumbing suggested for tappable citations.

### Financials (budget, job costing, cash flow, margin risk/alerts, WIP, portfolio, payment prediction) (3)
- **[performance] totalMonthlyExpenses silently ignores one-time expenses, so the 'Monthly Expenses' header can understate outflow** — `app/cash-flow.tsx`
  - Fix: Either exclude one-time items from the 'Monthly Expenses' list entirely (they're not monthly) or add a separate 'one-time' line so the header and the forecast agree on what's counted.
- **[a11y] Risk score conveyed almost entirely by color; band label present but factor bars are color-only** — `app/margin-risk.tsx`
  - Fix: Add a small text/severity tag or icon per factor row (High/Watch/Low) alongside the numeric risk, so severity survives without color — consistent with margin-alerts' severityLabel pattern which the breakdown lacks.
- **[consistency] Portfolio-margin and margin-alerts silently skip projects without a margin basis, with no count of what's excluded** — `app/portfolio-margin.tsx`
  - Fix: Show a small 'N projects hidden — add markup to include them' affordance that deep-links to the estimate, converting a confusing omission into an activation nudge.

### Home dashboard, tab/sidebar nav shell, reports & notifications (5)
- **[consistency] Large blocks of dead style + unused imports left in HomeScreen** — `app/(tabs)/(home)/index.tsx`
  - Fix: Delete the orphaned style keys and unused imports (a quick eslint no-unused-vars + a StyleSheet audit). Drop the getTotalOutstandingBalance destructure since it's never used.
- **[a11y] Activity feed rows and header spacer lack accessibility roles/labels; long-press action is undiscoverable** — `app/activity-feed.tsx`
  - Fix: Add accessibilityRole='button' + a descriptive accessibilityLabel to ActivityRow, and either surface a subtle '···' affordance for the action sheet or a first-run hint. Remove the dead empty* styles.
- **[ux] Dismiss and 'Clear all' delete notifications permanently with no undo** — `app/notifications-inbox.tsx`
  - Fix: Add a brief undo affordance (snackbar with Undo, restoring the row) on single dismiss, or switch dismiss to a soft-hide (set a dismissed_at) so the deep-link history isn't destroyed by an accidental tap.
- **[bug] Leftover console.log and 'v2' render marker ship in Discover** — `app/(tabs)/discover/index.tsx`
  - Fix: Remove the console.log (and the DiscoverScreen v1/v2 ambiguity if there's a stale component still around).
- **[consistency] Tab-bar badge and Home bell badge count different things, so the numbers rarely match** — `app/(tabs)/_layout.tsx`
  - Fix: Differentiate them visually/semantically — e.g. keep the bell for notifications and move the SmartInbox work-queue count onto a labeled inline element rather than a bare tab-bar number, or unify the two concepts so the counts reconcile.

### Marketing COMPARE / competitor-alternative / audience pages (3)
- **[a11y] Decorative marquee and logo alt handling are fine, but screenshot data-labels aren't announced** — `buildertrend/jobtread/houzz-pro alternative pages (screenshot sections)`
  - Fix: Fold the data-label meaning into the alt text (or add a visually-hidden caption span) so screen-reader users get the same 'Priced to win / Live margin' framing sighted users get from the badge.
- **[consistency] Footer column differs between the compare hub and the child pages** — `compare/index.html (footer 'For Clients') vs alternative pages (footer 'Product')`
  - Fix: Standardize one footer across the whole compare cluster. Prefer the 'Product' variant (or add both columns) so the calculator.html lead magnet is one click from every comparison page, including the hub.
- **[consistency] Three alternative pages omit the 16x16 and 512x512 favicon links the hub/Procore pages include** — `buildertrend-alternative.html (line 21) + jobtread/houzz-pro (line 21)`
  - Fix: Copy the full four-line favicon block from the hub into the three alternative pages so all comparison pages share identical icon coverage.

### Marketing FEATURE pages (marketing/features/*.html — 11 pages: index explorer, 7 feature deep-dives, 3 vs-competitor pages) (3)
- **[tier-gating] Explorer CTA cites Pro $29 / Business $79 but omits Enterprise and the free-tier limit clarity** — `features/index.html`
  - Fix: Align the free-tier description ('first project free' vs 'free tier') to one consistent phrasing across the explorer, vs-* pages, and pricing.html so the offer is unambiguous at the CTA.
- **[consistency] Metro count and pricing-freshness claims conflict with sibling pages** — `features/marketplace.html`
  - Fix: Reconcile the materials-pricing story: either the 9-metro/weekly framing is the truth (then temper '20,000+ regional / live' elsewhere) or coverage is broader (then update marketplace.html). One consistent claim across the cluster.
- **[a11y] Explorer CTA duplicates .ex-panel.is-active outside the tablist, and decorative emoji/marquee are handled well but the CTA panel is always-on inside a tab container** — `features/index.html`
  - Fix: Give the CTA its own class instead of borrowing .ex-panel.is-active, so tab-panel styling and tab logic aren't coupled to a non-panel element.

### Marketing LANDING funnel (2)
- **[add-opportunity] Video tutorial cards ship no VideoObject schema and, once real, will miss video rich results** — `demo.html`
  - Fix: When videos go live, add VideoObject schema per clip (the duration/title/description are already in the DOM to populate it). Cheap SEO win for a page explicitly built to rank on 'how it works' searches.
- **[a11y] Load-bearing supporting claims live only in aria-hidden decorative marquees** — `index.html`
  - Fix: Low priority: confirm each marquee claim also appears in real body copy (most do). No compliance action needed; just ensure nothing load-bearing lives ONLY in aria-hidden marquee text.

### Marketing PRICING, access, support, legal, 404, client portals (2)
- **[consistency] 404 page uses a self-contained inline theme and font stack that diverges from styles.css and the brand** — `404.html`
  - Fix: Either import styles.css for consistency or, if a standalone 404 is intentional for reliability, align its color vars and font stack to the canonical brand. Verify /calculator.html and /playbook.html resolve (they're also linked from the 404's 'Where to next?' list).
- **[add-opportunity] No social proof / competitor-capture anchor on the pricing page** — `pricing.html`
  - Fix: Add one concrete trust element near the tier grid (a short GC quote or an aggregate stat) and a direct 'See how we compare to [named competitor]' CTA into the /compare/ pages, so pricing doubles as a competitor-capture funnel rather than a category-level pitch.

### Punch lists, punch/warranty walks, AI punch, warranties (2)
- **[consistency] Warranty card exposes no way to reach the claim flow despite claims/'Claimed' status being first-class in the model** — `app/warranties.tsx`
  - Fix: Add a 'File / view claims' affordance in the edit modal (count badge on the card when claims exist) wiring to addWarrantyClaim, or remove the 'Claimed' status from the UI until the claim flow exists so the surface matches the model.
- **[a11y] Primary tap-to-advance status badge and delete targets are sub-44pt; several caption-size interactions rely on color** — `app/punch-list.tsx`
  - Fix: Bump the tap-to-advance status badge and delete targets toward 44pt (or add hitSlop), verify caption-size textMuted meets contrast, and extend the existing accessibilityLabel pattern to the delete and On-plan chips.

### Safety (dashboard, JHA, hazards, incidents, inspections, OSHA, certs, toolbox, forms) (6)
- **[ux] Hazards render in raw insertion order — no risk-first sort despite the empty-state promising it** — `app/safety-hazards.tsx`
  - Fix: Sort items by riskScore descending (open before closed) before mapping, matching the copy. A secondary sort on status keeps closed/mitigated items from crowding the top.
- **[bug] AI incident draft overwrites description/location with empty strings when the model omits them** — `app/safety-incidents.tsx`
  - Fix: Only overwrite when the AI actually returned a non-empty value: setDescription(prev => json.data.description?.trim() ? json.data.description : prev), same for location.
- **[ux] Add-sign-off modal can render behind/over the open edit modal and lacks keyboard avoidance** — `app/safety-jha.tsx`
  - Fix: Wrap the sign-off card in KeyboardAvoidingView like the other modals, and ensure the sign-off trigger from a card doesn't leave the edit modal mounted underneath (open sign-off only from a single, unambiguous entry point or dismiss the edit modal first).
- **[ux] Advancing hazard/incident status by tapping the chip gives no confirmation and can't be undone easily** — `app/safety-hazards.tsx`
  - Fix: Add a brief confirmation/toast ('Marked Mitigated') and consider making status advancement explicit inside the edit form (where a full picker already exists) rather than a single tap on the list chip, or at least enlarge the hit target and add an accessibilityHint describing the cycle.
- **[missing-state] Inspection with only N/A items reports a score with no denominator context, and template-derived items can't be re-synced** — `app/safety-inspections.tsx`
  - Fix: Show pass/fail out of scored (non-N/A) items in the chip or subtitle so the % has context, and guard the empty/all-N/A case with a neutral label ('Not scored'). Optionally surface the source template name on the inspection card.
- **[bug] Select-field options split on comma strips legitimate values and can't represent an option containing a comma** — `app/safety-forms.tsx`
  - Fix: Filter empties live in updateFieldRow, and/or move select options to an add-a-row editor (like attendees/corrective-actions elsewhere) instead of a comma-joined string, so each option is a discrete input.

### Scheduling (Pro scheduler, import, review, wizard, shared, last-planner, classic tab) (5)
- **[ux] Wizard step 2 lets you edit task names but not durations or dependencies — the timeline you preview is uneditable** — `app/schedule-wizard.tsx`
  - Fix: Add inline duration steppers (and ideally a phase picker) to the TasksStep rows so the previewed timeline reflects reality before save. This is cheap and removes the 'I have to redo everything in Pro' frustration.
- **[consistency] 'Review at week-end' button is available immediately, undercutting the loop's own instruction** — `app/last-planner.tsx`
  - Fix: Disable or de-emphasize 'Review at week-end' until weekStart is in the past (or the task's window has closed), and neutralize the button border color so it doesn't imply a 'kept' default. Consider a gentle 'week not over yet — reviewing early' hint.
- **[copy] Header KPI says 'finish day 42' — a raw day-number GCs don't think in** — `app/schedule-pro.tsx`
  - Fix: Render the finish as a calendar date (projectStartDate + working-day offset via the addWorkingDays helper already imported) with the day-number as secondary, e.g. 'finishes Aug 22 (day 42)'. Apply the same fix to shared-schedule's header sub.
- **[consistency] Import screen uses raw Alert confirmations while the rest of the scheduler moved to styled toasts (nailIt/oops)** — `app/schedule-import.tsx`
  - Fix: Standardize the destructive replace-confirmation on a single in-app confirm component across the scheduling cluster (the wizard, import, and pro screens all implement their own Alert variants). Low priority, but it's the kind of inconsistency that reads as 'vibe-coded' under a polish audit.
- **[missing-state] Snapshot fetch has loading/error states but no retry, and a network blip strands the sub on a dead-end** — `app/shared-schedule.tsx`
  - Fix: Add a 'Try again' button that re-triggers the fetch effect (bump a retry counter in deps), and replace the 'Home' CTA in the shared/sub context with guidance to contact the sender, since an external sub has no home to go to.

### Settings, Integrations (QBO), Data Import/Export, Equipment, Materials, Managed Property (4)
- **[consistency] 'Saving…' indicator only ever shows under the 'client' group, so sub/marketplace toggles feel unconfirmed** — `app/notifications-settings.tsx`
  - Fix: Either move the 'Saving…' hint to a single fixed location (e.g. under the hero or a toast) that reflects the global saving state, or render it under whichever group contains the toggled key. Minor, but it's an inconsistency in an otherwise carefully-built optimistic-save flow.
- **[consistency] Equipment tab mixes hardcoded module-level Colors with the theme system, risking dark-mode contrast** — `app/(tabs)/equipment/index.tsx`
  - Fix: Route status/stat colors through the themeColors (t.success/t.info/t.danger/t.warning) and t.surfaceAlt/t.line for fills, matching the equipment-detail.tsx and rest-of-app pattern. Keeps the fleet screen consistent across themes.
- **[consistency] Work-order and priority status colors are hardcoded hex, ignoring the app's theme tokens** — `app/managed-property.tsx`
  - Fix: Map these to themeColors (t.accent, t.info, t.danger, t.success, t.warning, t.textMuted) or add semantic tokens for work-order statuses so the property/work-order surface honors theme + dark mode like the surrounding screens.
- **[add-opportunity] Pipeline paste-import is a strong cold-start play but doesn't lean on the AI moat or dedupe against existing leads** — `app/import-pipeline.tsx`
  - Fix: Add an AI-assisted parse fallback (send the raw blob to the text-AI relay when regex confidence is low) to make the 'any order' promise real and show off the moat at the exact activation moment; and dedupe paste drafts against existing lead names the same way contacts-mode already does, flagging 'already in pipeline' rows instead of silently duplicating.

### Subs & crew: sub portals, scorecards, prequal, buyout, COI vault, companies, contacts, workers (2)
- **[ux] Award happy-path dialog says '±$X over/savings' but the confirm copy can misread on overrun** — `app/buyout-package.tsx`
  - Fix: Make the Award button reflect over/under budget (e.g. amber when total > estimateBudget) so the color story is coherent: red total = amber award, not green award. Small change, but this is the one irreversible action (creates a Commitment) so the signal must be unambiguous.
- **[add-opportunity] Three stacked full-width compliance banners push the actual sub list below the fold** — `app/(tabs)/subs/index.tsx`
  - Fix: Collapse the three banners into a single 'Compliance & portals' entry (or a compact segmented row / horizontal chips) so the sub list rises above the fold. Consider showing the banners only when relevant (e.g. hide COI Vault promo once COIs exist), matching the conditional-banner pattern already used well in coi-vault.tsx and prequal-manager.tsx.

### Takeoff, area takeoff, cost database, Cost X-Ray (4)
- **[consistency] Summary tiles ignore rejected rows for LF/SF/doors/windows but the AI's own 'Building SF' tile does not — mixed sources of truth in one card** — `takeoff.tsx (ResultView summary tiles)`
  - Fix: Either label the Building SF tile as an independent AI estimate (subtitle 'AI whole-building estimate — not a sum of rows') or drop it from the interactive tile grid so all headline numbers share one behavior.
- **[a11y] Trace/undo/clear/freehand canvas tools and Kind/Mode toggles lack accessibility labels and some fall below the 44pt touch target** — `area-takeoff.tsx`
  - Fix: Add accessibilityRole='button' + descriptive accessibilityLabel to KindBtn, ModeBtn, and the Undo/Clear/Freehand tools, and ensure each hits a 44x44 target. Low effort, and this is the screen where precise taps matter most.
- **[copy] Model picker labels 'Sonnet 4.6' and 'Sonnet 4.5' inconsistently, and taglines make accuracy claims that read as marketing not fact** — `takeoff.tsx (model picker) vs marketing/reality`
  - Fix: Make the display name match the model version actually invoked (align 'Sonnet 4.6' vs 'claude-sonnet-4-5'), and soften the accuracy taglines to observable behavior ('reads stamped/marked-up scans more reliably') rather than an unranked 'highest accuracy' superlative.
- **[ux] Edited qty/$unit on a tell doesn't visibly change the band until you tap Done, and the 'Allowance' field in the editor duplicates the number already shown above it** — `cost-xray.tsx`
  - Fix: Drop the duplicate 'Allowance' readout inside the editor (the live bandExpected above already reflects edits), or visually tie them so it's clear they're the same number updating together.

---

## Flagged real-build items (surfaced during the fix pass)

These need real engineering (new tables/migrations, shared-hook contracts, or
asset capture) — deliberately NOT rushed overnight:

- **Estimate calibration cross-device** (`estimate-calibration`): add a per-user
  `estimate_calibration` table + RLS (mirror `tertiary_*`), route
  `useEstimateCalibration` writes through `offlineQueue.supabaseWrite`, hydrate
  from server, and make the wizard actually READ applied factors (it never has).
  Copy was made truthful in the meantime.
- **usePortalThread loading/error states** (`client-messages`/`client-view`):
  shared hook returns `[]` on fetch error; expose `isLoading`/`isError` so screens
  render a skeleton + "couldn't load, retry" distinct from true-empty. Pull-to-
  refresh added as interim.
- **RFP browse distance filter** (`mage-id-bids`): `.limit(200)` by posted_date can
  drop nearer RFPs; real fix is server-side PostGIS distance filtering.
- **Lossless data import** (`data-import`): `importData` only restores
  projects/contacts/subs; 10 other collections are exported but not re-imported.
  Copy made honest; finish the importer in `utils/dataImport.ts` + ProjectContext.
- **Scheduler `totalDurationDays` unit reconciliation**: `schedule/index.tsx`
  (:322/:1094) + `ScheduleShareSheet.tsx` (:64/:115) treat it as a working-day
  count and re-expand via `addWorkingDays`, but schedule-pro stores it as the
  weekend-aware calendar-finish index. Pre-existing latent inconsistency in moat
  code — reconcile carefully with the CPM validators, not overnight.
- **CO email/PDF tax alignment**: on-screen CO now shows sales tax, but
  `utils/emailService.ts buildChangeOrderEmailHtml` + `utils/aiaForms.ts` G714
  still render pre-tax — add optional `taxAmount`/`totalWithTax` params.
- **bid_responses cap in FEATURE_LIMITS**: `submit-bid-response` free/pro monthly
  cap (3) is a local const; promote into `hooks/useTierAccess.ts FEATURE_LIMITS`
  (and add server enforcement) for a single source of truth.
- **Dedicated feature keys**: `permits_inspections` (permits currently rides
  `job_costing`); consider a `paymentPredictions` server-floored AIFeature.
- **Marketing screenshot capture** (owner/simulator): remaining `.phone-ph`
  placeholders on `features/field.html` + `financials.html` need real screens —
  no matching asset exists in `/screenshots/screens/`.
- **Marketing shared CSS polish**: `.footer-brand`/`.footer-nav`/`.footer-copy`
  have no rules in `styles.css` (render acceptably via element selectors).

## Owner decisions needed (not auto-applied)

- **Onboarding paywall routing** (`onboarding-paywall`): the screen is built but
  ORPHANED — nothing routes to it (`_layout.tsx` sends new users to `/onboarding`,
  `onboarding.tsx finishToHome` goes straight home). Wiring it in (route free-tier
  users through it after onboarding, with the 3-day re-show the screen already
  stamps) is a monetization vs. value-first-activation decision — left for you.
  Its pricing/feature copy WAS corrected regardless.

## Monetization changes applied (please confirm intent)

Features that were previously open and are now tier-gated per the audit:
- `permits.tsx` → Pro (job_costing)
- `contract.tsx` → Pro (client_portal)
- `photo-triage.tsx` / `photo-annotator.tsx` → Pro (photo_documentation)
- `payment-predictions.tsx` → Pro (cash_flow_forecaster)
- `punch-walk.tsx` / `ai-punch.tsx` → Business (punch_list_closeout)
- `reports.tsx` WIP tab → Business (wip_reporting), exports hard-blocked
- `sub-portals.tsx` → Business teaser; `qbo-setup.tsx` → Business (matches server)
- `submit-bid-response` → free/Pro monthly cap of 3

## Owner-gated next steps (I did NOT do these while you slept)

1. Review + merge `claude/audit-fixes` (6 commits) to `main`.
2. OTA: `eas update --branch production` (JS-only, runtime 1.0.0 unchanged).
3. Marketing deploy: Netlify (build-paused) via `netlify deploy --dir` + PAT.
4. Also still pending from prior sessions: merge `claude/marketing-motion`,
   the staged portal-RLS Part-2 migration + coordinated Netlify HTML deploy.
