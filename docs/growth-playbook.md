# MAGE ID — Automated Growth Playbook

_Research-backed acquisition strategy for a lean, solo operator. Generated from a 5-angle deep-research pass (permit/license data, programmatic SEO, product-led/viral loops, cold email, contractor-discovery channels), cross-verified across independent sources. Confidence + source notes are inline; treat vendor-blog percentages as directional, not audited._

## The core insight

Contractors buy software the way they hire subs: **peer word-of-mouth and reviews, not ads.**
- ~85% of software buyers trust online reviews as much as personal recommendations (Gartner Digital Markets).
- 67% of B2B buyers now prefer a **rep-free** buying experience, up from 61% a year prior (Gartner, 2026).

So the goal is not to "advertise" — it's to build systems where **trust and exposure happen automatically** before anyone talks to you. Every tactic below is ranked on **leverage × low cost × automatability × reuse of what MAGE already has** (Resend email infra, client/sub portals, the marketplace, magic links, public portfolio pages, edge functions, the merged public-lead-funnel).

---

## Tier 1 — Build first (highest leverage, lowest drain)

### 1. "Built with MAGE ID" viral loop on client-facing surfaces ⭐ #1
The Calendly/Loom/Typeform mechanic. Highest leverage because the audience is exactly your next customers and the marginal cost is ~zero.

- **What:** every proposal, estimate, invoice, client portal, daily-report/photo share, and schedule link a contractor sends to *their* homeowner/sub carries a subtle "Built with MAGE ID — run your projects free →" badge linking to signup.
- **Why it fits MAGE:** all these surfaces already exist (portals, proposals, invoices, magic-link shares, public portfolio pages). Recipients are homeowners (→ marketplace demand) and subs/other GCs (→ users).
- **Mechanics that matter (High confidence):**
  - Badge must be on the surface sent to *their* clients, not internal screens.
  - **Gate removal behind a paid tier** — the badge is the "price" of free (Loom/Typeform both remove branding on paid).
  - Only compounds on **high-frequency** surfaces (invoices/portal messages > one-time contracts).
- **Expected:** realistic B2B viral coefficient (k) is 0.15–0.7; k≈0.3 means every 10 users bring ~3 more, permanently lowering CAC. Typeform-class loops ≈ 0.5. (k>1 is rare/temporary — this amplifies other channels, it is not standalone exponential growth.)
- **Audience:** all four (homeowners, subs, GCs, switchers who see it on competitors' jobs).
- **Effort:** a dev task inside the app. Days.
- _Sources: openviewpartners.com (Calendly/Typeform PLG), marketergems.com (Loom), visible.vc + saxifrage.xyz (k-factor 0.15–0.7)._

### 2. Programmatic supply-seeding from public permit + license data
Exactly how BuildZoom cold-started: ingested every US licensed contractor from public records → useful directory before anyone signed up → facilitated >$1.5B in projects (2024) → acquired by Block Renovation (2025).

- **What:** auto-ingest public **building-permit feeds** (a GC who just pulled a permit = active job = high intent) and **state license boards** to (a) pre-populate marketplace contractor/sub profiles so the marketplace is useful day one, and (b) feed a permit-triggered outreach sequence.
- **Data sources (verified):**
  - **CSLB (California)** and **DBPR (Florida)** publish *free, downloadable* bulk license files — start here.
  - Permits: free **city/county open-data portals** (Socrata / Tyler Data & Insights — SF `data.sfgov.org`, Austin `data.austintexas.gov`, etc.; SODA API, often no key at low volume) for ~$0; or **Shovels.ai** (~$599/mo+, sales-gated) for turnkey nationwide data with ~2.3M+ already-enriched contractor contacts.
  - **Texas has no statewide GC license** — use permits / city registration there; license signal works only for trades (electrical/plumbing/HVAC).
- **Trigger pipeline:** new permit/license → diff vs prior snapshot → enrich contact → personalized email ("Saw you pulled a permit for [project type] in [city]…").
- **Audience:** GCs/remodelers + subs (marketplace supply side).
- **Effort:** edge-function + cron work; reuses Resend + the public-lead-funnel pattern. Free-data path ≈ $0 but needs per-city onboarding; Shovels buys time for ~$600/mo.
- _Sources: canvasbusinessmodel.com + prnewswire.com (BuildZoom), shovels.ai/api, web.cslb.ca.gov DataPortal, www2.myfloridalicense.com public-records, dev.socrata.com, permitflow.com (TX licensing)._

### 3. Own-brand comparison pages + a free data-backed calculator (SEO)
- **"MAGE ID vs Buildertrend / vs JobTread / vs Houzz Pro" pages:** comparison pages convert ~5–10% vs ~1–2% generic organic (3–5×). "BigCo vs BigCo" is saturated, but *your brand* vs an incumbent is **uncontested** — rank #1 trivially, capture switchers mid-decision.
- **Free estimate/markup/margin calculator:** interactive tools opt-in far higher than static lead magnets, double as link-bait, and map directly onto MAGE's estimating feature (calculator output → "save this estimate, create a free account"). Houzz/Angi already run public cost calculators that rank — demand is proven.
- ⚠️ **Guardrail (High confidence):** do **not** mass-generate empty "[city] construction software" doorway pages — that's Google's "scaled content abuse" (March 2024 policy, now part of core ranking) and can suppress the whole domain. Each page needs real per-page value (real local cost data, working calculator). The calculator is what de-risks programmatic pages.
- **Reality check:** new domain = **6–12 months** to compounding traffic; only 1.74% of new pages reach top-10 in year one (Ahrefs). Head terms unreachable year one — go long-tail ("vs [incumbent]", "[city] [trade] cost", calculator queries).
- **Audience:** switchers + homeowners (cost guides) + GCs.
- _Sources: getpassionfruit.com + poweredbysearch.com (comparison-page conversion), houzz.com/cost-guides (live), developers.google.com/search/blog 2024 spam policy, seosherpa.com + Ahrefs (ranking timelines)._

---

## Tier 2 — High value, runs alongside

### 4. Get listed where contractors already research (free/cheap, fast trust)
- **Capterra / G2 / GetApp / Software Advice** = one network (~9M monthly visits, ~200M annual buyers, >75% SMB — exact ICP). **Free listings exist**; paid is PPC (~$500/mo min, ~$2+/click) or CPL (~$30–100/lead). Being listed *with reviews* matters because reviews ≈ peer recommendations. (G2 acquired the Capterra/SoftwareAdvice/GetApp network from Gartner, closed Feb 2026.)
- **QuickBooks App Store:** free listing; QuickBooks integration is a *top stated buying requirement* (kills double-entry). Free distribution.
- **Seed reviews:** automate an in-app post-milestone prompt asking happy users to review (buyers weight reviews <6 months old).
- _Sources: gartner.com/en/digital-markets (review trust), reechee.io + demandgenreport.com (network economics), quickbooks.intuit.com/app-marketplace._

### 5. Compliant cold email (the "email" instinct — it's viable)
- **Legal (verified):** CAN-SPAM **permits** cold B2B email with no opt-in — needs a real physical address + working opt-out + honest headers. Honor opt-outs within 10 business days; max penalty ~$53k/email. (SMS and LinkedIn automation are the risky ones — cold SMS needs 10DLC + opt-in under TCPA at $500–1,500/text; LinkedIn automation risks permanent bans. Lead with email.)
- **Infra discipline:** separate sending domains (`trymageid.com`, not the root), ~3 inboxes/domain, **20–30 sends/inbox/day**, SPF/DKIM/DMARC, 4–6 week warmup, complaint rate <0.3%. Tools: Instantly/Smartlead (~$37–97/mo) + Clay/Apollo (data) + ZeroBounce/NeverBounce (verify). **~$150–400/mo** all-in.
- **The truth:** list quality + targeting beats clever copy. Pairs perfectly with #2 — permit/license data *is* your list; "you just pulled a permit" *is* the personalization.
- **Expected:** general B2B ~3–9% reply, ~0.4–3% → meeting; budget several thousand verified sends/month for ~10 meetings. Contractor-specific numbers are undocumented — your first 1–2k sends are the experiment.
- _Sources: termly.io (CAN-SPAM), powerdmarc.com (Google/Yahoo 2024 rules), topo.io (sending limits), callhub.io (10DLC/TCPA), litemail.ai (tool pricing)._

### 6. Product-as-reward double-sided referral
- Double-sided rewards drive materially higher participation than referrer-only; **make the reward = more of your own product** (free months / seats / AI credits), not cash — cheap for a solo founder and self-selects for fit (Dropbox's lesson: ~3,900% growth in 15 months, peaking ~35% of daily signups, reward = free storage at ~zero marginal cost).
- Operationalize *inside onboarding/UI/email*, prompted at high-engagement moments — not a one-off campaign. Tool: Rewardful (Stripe-native, ~$49/mo).
- _Sources: growsurf.com + referralrock.com (Dropbox), viral-loops.com (double-sided benchmarks), rewardful.com._

---

## 90-day solo rollout

| Weeks | Focus | Drain |
|---|---|---|
| **1–2** | Ship the **"Built with MAGE ID" badge** (free tier shows it, paid removes it) across proposals/invoices/portals. Claim free **Capterra/G2/GetApp + QuickBooks** listings. Stand up `trymageid.com` + inboxes and **start 4–6 wk warmup**. | Low |
| **3–5** | Scaffold the **permit/license ingester** (CSLB + DBPR free files + 2–3 Socrata cities) → seed marketplace profiles + build the suppression-safe outreach list. Ship a **free markup/estimate calculator** on the marketing site. | Med |
| **6–8** | Launch **permit-triggered cold email** (inboxes now warmed) to GCs/subs. Publish **"MAGE vs Buildertrend / JobTread / Houzz Pro"** pages + 3–5 data-backed cost guides. Add the in-app **review-request** prompt. | Med |
| **9–12** | Add the **double-sided referral** (reward = free months / AI credits). Measure k-factor, reply→meeting, calculator→signup. Double down on what works. | Low-Med |

**Monthly cost at full tilt:** ~$200–600 (cold-email stack + optionally Shovels + referral tool) — vs. the open-ended bleed of paid social, with assets that **compound** instead of stopping the day you stop paying.

---

## Compliance guardrails (quick reference)

- **Cold email:** CAN-SPAM compliant = physical postal address + working opt-out (honored ≤10 business days) + truthful headers/subject. Geo-limit to US; suppress EU (GDPR) / Canada (CASL — stricter, needs consent before first send).
- **Deliverability:** SPF + DKIM + DMARC mandatory (Google/Yahoo Feb 2024). Keep spam complaints <0.1% (never >0.3%). Send from a separate domain, not the root.
- **SMS:** requires A2P 10DLC registration + proof of opt-in (TCPA). Reserve for warm/opted-in follow-up, not cold prospecting.
- **LinkedIn:** automation violates ToS; 2025 enforcement tightened (Apollo/Seamless integrations restricted). Use manually/lightly.
- **Scraping:** prefer official public-records downloads/APIs (CSLB, DBPR, Socrata) — explicitly public record. Scraping a commercial site against its ToS (e.g., BuildZoom) is the higher-risk path (CFAA defensible post-_hiQ v. LinkedIn_, but ToS/contract claims remain).

## Honest caveats

- k-factor (0.15–0.7) and free→paid (3–5%) are **modest** — the badge loop amplifies other channels; it's not standalone exponential growth.
- Most conversion percentages come from **marketing-vendor blogs** (directionally right, individually optimistic). The hard, primary-sourced facts: Google's spam policy, Ahrefs' "1.74% of new pages rank top-10 in year one," CAN-SPAM/TCPA law, and the Capterra/G2 network economics.
- **No audited construction-SaaS-specific funnel numbers exist publicly** — treat your first cohort as the benchmark generator.
- The two best-evidenced channels are also the cheapest and most automatable: the **branded viral loop** and **getting listed where contractors already research**.

---

_Built by [Claude Code](https://claude.com/claude-code) — deep-research synthesis, 2026-06._
