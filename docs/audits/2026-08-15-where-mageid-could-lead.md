# Where MAGE ID could lead — market research

_2026-08-15. Confidence marked: **[V]** verified against a primary/vendor doc ·
**[C]** contractor voice · **[S]** survey · **[M]** vendor marketing._

## The honest finding first

**There is no large unclaimed category here.** Cost data as a product is a
proven dead end. Benchmarking needs scale we won't have for years and sits in an
active regulatory grey zone. Insurance and lending are taken or too early.
Takeoff is commoditised.

What *is* unclaimed is narrower and better:

> **Nobody in this market can tell a contractor how wrong they usually are.**

Measured rates with error bands, and a firewall that refuses to launder a guess
into a fact. It is the precondition for scope-change detection, contingency
pricing, calibrated margin alerts, and bonding-grade WIP. It works at **N=1
contractor, on day one, with no network effect required** — and its moat is
per-tenant switching cost, which is the right kind of moat for a pre-launch
company.

## The claim that survives scrutiny

Across ~15 products examined (Buildertrend, JobTread, CoConstruct, Houzz Pro,
Contractor Foreman, Knowify, Buildxact, UDA, Procore, STACK, Bolster, Handoff,
Clear Estimates, Xactimate, InEight, Zebel):

- **No small-GC product automatically updates estimating unit rates from closed-job
  actuals.** Every "historical cost" claim resolves to a static user catalog, an
  embedded third-party feed, or a manual copy action. **[V]**
- **Not one distinguishes an assumed rate from a measured one.** No sample size,
  no confidence, no variance. A rate typed once in 2021 renders identically to
  one confirmed across 40 jobs. **[V]**

The sharpest proof the loop is severed *by design*: **Procore's Labor
Productivity view computes actual production rate and its variance at cost-code
level** — and has no documented mechanism to push that into the Cost Catalog,
which is seeded from the **Craftsman book, "updated annually"** **[V]**. It
measures your real productivity daily and estimates off a book refreshed yearly.

> "Historical cost data" is the industry's most abused phrase. In every verified
> case it means *you* retype numbers from old jobs, or aggregate *market* history
> bought from a third party. Never that the software measured your unit cost.

Note the seed data is not the moat — **Contractor Foreman, Buildxact, STACK and
Bolster all resold one company's numbers (1build)**; Procore and others license
Craftsman; ProEst uses RSMeans **[V]**. Anyone can buy the market average.
Nobody can buy *your* actuals.

## The three opportunities, ranked

### 1. Provenance as the wedge into AI-skeptical estimating
*Near-term. Works at N=1. Largely surfacing what already exists.*

Trust, not capability, is the binding constraint on AI estimating:
- **Dodge/CMiC** (n=235 GCs, pub. Dec 2025) **[S]**: data accuracy is the #1 AI
  concern at **57%**; only **26%** rate their own data quality as high; 87%
  expect AI to transform the industry but **only 19% have adapted workflows**.
- r/GeneralContractor, 2026-03-06 **[C]**: *"I love the idea of AI estimates. But
  it only saves time if the estimate is correct… **If you want to go broke, rely
  on this for estimating.**"*

Build: per-line provenance in the UI (`measured (n=14, ±11%)` vs `seeded — never
verified`), a confidence report ranking guesses by dollar exposure, and a
client-facing variant that says "based on 12 of our completed jobs" without
exposing cost or markup.

**The window is closing.** Buildertrend acquired **BizJet AI on 2026-07-28** —
agent-native AI explicitly for cost estimating — and hired ex-Amazon/Google AI
leads **[V]**. Incumbents can't retrofit provenance onto years of comingled
catalog data, but a greenfield agent layer could be built with it.

### 2. Variance as the product — detect the change order, don't just author it
*The actual moat. 12–24 months. Also works at N=1.*

A measured cost book yields a **variance per cost code** — how wrong you usually
are on this kind of work. That enables three things nobody has:

1. **Scope-change detection.** Once you know your noise floor, an overrun beyond
   it stops being noise and becomes *"this activity was not in the basis."* A
   competitor seeded from Craftsman has no idea what its own error is, so it can
   only say "you're over budget" — useless as a claim, because it reads as *your*
   estimating mistake.
2. **Confidence-priced contingency**, per line instead of 10% on the bottom.
   High-confidence lines get thin contingency (win more); high-variance lines get
   fat contingency (stop bleeding).
3. **Calibrated margin alerts.** Sage and Foundation ship *static threshold*
   profit-fade alerts **[V]**. Calibrated means: this job is deviating from your
   historical pattern for this job type at this stage.

The money:
- **Houzz & Home 2026** (n=10,176 US renovating homeowners) **[S]**: 37% of
  renovations exceeded budget; **31% expanded scope mid-renovation**.
- **NAHB CODB 2026** (FY2024) **[S]**: average remodeler net margin **6.3%** on
  $2.7M revenue. **A one-point estimating improvement is a ~16% lift in net.**
- r/Contractor, 2025-11-25 **[C]**: *"I bid the job at 22k… should have charged
  38k. **I have underbid the past 3 big jobs in a row and I literally cannot
  afford another one.**"*
- r/Homebuilding, 2026-07-16, top comment **1,106 upvotes** **[C]**: *"The whole
  point of change orders is that everyone agrees BEFORE the change is made."*
  **An undocumented change order is worth zero.**

**Verified: no product detects that a change occurred.** All incumbents let you
*author* one; residential platforms trigger from allowance/selection overages — a
workflow rule, not detection **[V]**. Closest is **Trunk Tools' TrunkReview** (GA
2026-06-17, $40M Series B) — but it is drawing-to-drawing diff for commercial
**[V]**. Nothing infers out-of-scope work from field data.

The practitioner objection — *"scope interpretation requires judgment AI doesn't
have"* — is true if you're reading documents. **It is not true if you're comparing
measured cost behaviour against a measured baseline. That is the asymmetry.**

Critical UX constraint from the field: the flag must reach **the person who
writes change orders, not the person doing the work.** Undocumented changes
originate as crew-level informal requests and die there.

### 3. Financial-credibility artifacts — WIP, profit fade, bonding readiness
*Adjacent, high willingness-to-pay, light-commercial. Difficulty: low.*

- **The WIP schedule is the first document a surety underwriter pulls** **[V]** —
  and the cost book generates every field it needs as a byproduct.
- **"Profit fade" is the metric sureties watch, and its documented cause is
  "poor estimating or aggressive bidding up-front"** **[V]**. A contractor with a
  demonstrably low estimate variance has a lower risk profile — provably.
- **Many small contractors don't prepare WIP schedules at all** **[V]**.
- Precedent that carriers underwrite off PM data: **Shepherd**, $42M Series B
  2026-03-24, ingests live Procore/Autodesk/Samsara data **[V]**.

Counterweight, so we don't overclaim: the **Baldwin Group 2026 mid-year report**
says most contractors see **flat to low single-digit GL increases**, not a crisis
**[V]**. A widely-circulated "GL up 22%" blog contradicts the actual broker
report — **do not build a pitch on it.** The premium-relief angle is weak; the
**bonding-capacity** angle is strong, because it converts directly into revenue
the contractor otherwise cannot access.

## The timing window — this has a clock on it

- **Procore is publicly exiting SMB.** CFO, Q4 2025 call, 2026-02-12 **[V]**:
  *"Our total customer count growth is heavily impacted by our SMB customers…
  **This will be the final earnings we will be disclosing total customer
  count.**"* $100K+ ARR customers are now 66% of ARR.
- **Buildertrend is repricing on revenue and locking data in.** Contractor-reported
  **[C]**: $15–17K/yr for a 15-house builder; $1,400/mo for a 5–15 person
  design-build. Their own ToS, quoted in-thread **[V]**: *"Buildertrend will
  determine, **in its sole discretion**, the format, method, and manner in which
  any Customer Data is made available. Such access, if provided, **may be subject
  to applicable fees**."* One user leaving with 2,700 closed files was told there
  was no way to move any of it.
- **CoConstruct is terminal** — closed to new customers, projects addable only
  through **2027-03-31** **[V]**. That book is in motion now.

**"Your cost book is yours, exportable, forever" is a one-line answer to the
loudest complaint in the corpus.**

## Pricing — probably 3–5× underpriced at the top

| Comparable | Price | For |
|---|---|---|
| Handoff (AI estimating only) | **$149 / $299 / $899 per mo** | estimating |
| Togal.AI | $199–299/user/mo | takeoff |
| Knowify Advanced (job costing gated here) | $249/mo | PM + job costing |
| Buildertrend | ~$400–$1,400/mo reported | everything |
| **MAGE ID Enterprise** | **$150/mo** | everything + the cost book |

ServiceTitan is the analogue: **they sell the price book as the premium add-on**
(~71% subscription, ~24% usage-based fintech) **[V]**. Our measured cost book is
a strictly better version of that product, currently bundled into $79.

Pre-launch with no users is **the only free moment to re-tier.**

## Do NOT chase

1. **Selling cost data — already tried and abandoned.** **1build raised $19.5M**
   on "Plaid for construction cost data" and **is now Handoff** — same legal
   entity, repositioned into the app. `1build.com/pricing` 301s to
   `handoff.ai/pricing`; `/api` 404s; both flagship partners dropped the
   reference **[V]**. **The workflow captures 20–60× what the data does.**
   The floor is also free: Turner, Cumming, Mortenson, RLB, JLL all publish
   indices free **[V]**.
2. **Aggregated benchmarking, near-term.** Nobody sells pooled small-contractor
   actuals — **Verisk runs this at ~400,000 estimates/day and does not sell the
   output**, it monetises seats **[V]**. Plus an active regulatory grey zone: DOJ
   withdrew information-exchange safety zones 2023-02, the 2000 Competitor
   Collaboration Guidelines were withdrawn Dec 2024, and the replacement comment
   period closed **2026-05-21** **[V]**.
   **→ Do this instead, now:** put the standard *"perpetual, irrevocable right to
   generate de-identified and aggregated data"* clause in the ToS at launch.
   Boilerplate today, **impossible to retrofit across an installed base later.**
3. **AI takeoff as a differentiator.** 8+ vendors, every accuracy claim
   self-reported and unverified **[V]**. Ship it; don't market on it.
4. **Permitting.** PermitFlow raised **$54M Series B, 2025-12-02, ~$500M
   valuation** **[V]**. Integrate, don't compete — even with an Expeditor persona.
5. **Materials procurement.** Higharc **$95M Series C** June 2026; Field Materials
   shipped Pricing Intelligence GA 2026-02-17 **[V]**.
6. **Insurance/lending as a product.** Shepherd owns it with $67M.
7. **Commercial/enterprise PM.** Procore, Trunk Tools, Clearstory own it — which
   is exactly why the residential SMB lane is opening.

## The four risks that decide this

1. **Data sparsity dictates the architecture.** Median NAHB remodeler: **5
   employees, $1.7M revenue, 15 jobs over $10K/yr** **[S]**. At 15 jobs/year,
   *job-level* learning needs three years. **The unit of learning must be the
   COST CODE, not the job** — 15 jobs × ~80 lines ≈ 1,200 observations/yr gives
   the top 50–100 codes ~10–15 observations within 12–18 months.
2. **Cost-code canonicalisation is the load-bearing engineering problem.** Free-text
   line items never stack and the book never learns. Needs an enforced canonical
   taxonomy (NAHB chart of accounts is the residential spine) with AI mapping from
   the contractor's own vocabulary. **Get this wrong and all three opportunities
   fail silently.**
3. **Job-costing discipline gets abandoned** — *"if it is not working within 4 or
   5 months, some contractors give it up"* **[V]**. The first 90 days must deliver
   value *before* the loop closes, which argues for making the provenance
   /confidence report the day-one hook, since it works on seeded data.
4. **Field adoption is where construction software dies** **[C]**: *"The demo
   always shows an office person how they can save 10 seconds… Then in practice
   the field guy spends an extra 10 minutes."* The scope-change detector must
   extract signal from capture the crew was **already doing**.

## Methodological warning

r/Construction, r/Contractor and r/GeneralContractor are **heavily astroturfed**.
Direct evidence found: accounts praising a vendor with **U+2064 invisible
characters injected mid-word** to defeat brand-mention detection; one account
posting a **character-identical ~120-word testimonial four times**; a dozen
self-disclosed vendor accounts.

**Complaints in this corpus are far more trustworthy than recommendations.** The
Buildertrend complaints are credible; the praise for its replacements is not.

## Numbers NOT to cite

"98% of projects run over budget" (megaproject data), "$1.85T bad data"
(vendor-sponsored, global), "96% of contractors fail by year 10" (no primary
source). BLS puts construction five-year establishment survival near **48%** —
bad enough without inflation.
