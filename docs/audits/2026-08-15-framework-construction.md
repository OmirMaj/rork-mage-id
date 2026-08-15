# Framework (framework.construction) — competitive audit

_2026-08-15. Verified by loading the site directly; see "trust notes" for what
could NOT be verified._

## Bottom line

1. **Their estimating has no memory of your actual jobs.** Estimates come from
   takeoff quantities plus unit rates "drawn from credible professional sources"
   — i.e. published/AI rates. There is no closed-job feedback loop anywhere in
   the product. MAGE ID's learning cost book plus the stated-vs-measured
   firewall is a real wedge, and their own copy is the exact failure mode that
   firewall exists to prevent.
2. **The entire field and owner surface is unoccupied.** Responsive web only —
   no native app, no offline, no daily reports, no punch, no photo capture, no
   homeowner portal. Their personas are Developers, Executives, Operations,
   Estimators, Consultants. No homeowner, no sub, no field crew.
3. **They have solved the AI-cost problem we have not.** Pricing is per member
   per month with explicit token budgets (8M / 16M / 75M) and **$6 per 1M
   tokens overage**. Our flat $29/$79 with AI estimating carries uncapped COGS.

## Trust notes — read before acting on any Framework research

- **Name collision.** `framework.construction` (Kyle Parry, US, launched 2025)
  is NOT `frameworkai.ca` (Canadian, pre-launch, prequal/CCDC forms). Search
  engines conflate them constantly. Discard frameworkai.ca hits.
- **The "independent reviews" are almost certainly not independent.** The two
  most prominent third-party reviews (exchange.construction, Jan 23 2026;
  essential.construction, Jan 22 2026) are both by the same author, "builderkp",
  and **both domains are linked from framework.construction's own footer**.
  Parry founded Essential Construction. No disclosure on either. Treat the
  praise as marketing; the criticisms are more credible but ~7 months stale.
- **No genuinely independent coverage exists** — no Product Hunt, no HN, no
  G2/Capterra, no analyst teardown. Notable for a product claiming AECOM and PCL
  logos. Those logos are plausibly individual self-serve seats, not accounts.
- `/features/`, `/capabilities/`, `/blog/` all 404. Some detail below came from
  search summaries rather than a direct page read.

## Pricing (public, specific)

Per member / month. 7-day trial, card charged day 7.

| Tier | Monthly | Projects | AI tokens/mo |
|---|---|---|---|
| Hobby | $0 | 1 active | limited |
| Starter | $24 | 3 active | 8M |
| Pro | $40 | unlimited | 16M (2× rate) |
| Plus | $148 | unlimited | 75M (9× rate) |

Overage **$6 / 1M tokens**. No enterprise tier, no SSO or SOC 2 mentioned.

The ladder gates on **AI consumption, not features** — editors, registries,
takeoffs and schedules are not gated above Starter. This is a usage-metered AI
product wearing a SaaS-tier costume, and they are open about it.

## What is worth stealing

- **Citation-to-source-page as the trust primitive.** Every AI answer carries a
  click-through to the exact page of the source PDF. Our analog is obvious and
  currently unclaimed: every AI-estimated line should tap through to *the
  specific closed jobs* that produced the rate.
- **Live-linked quantities.** Type `/` in an estimate cell, link a measurement —
  the quantity locks and **auto-updates when the drawing changes**. Kills the
  "we revised the plans and forgot to reprice" error. Our version is more
  valuable: link estimate lines to *field actuals* so variance surfaces during
  the job, not at closeout.
- **Scale calibration with three fallbacks** — auto-detect from title block,
  standard-scale dropdown, or two-point known distance. Most tools offer one and
  fail badly. This is what decides whether a GC finishes their first takeoff.
- **Cost code tagged at the measurement, not the estimate line.** Classified
  once at capture, division derived automatically, grid groups and subtotals for
  free. Cheap to adopt now, expensive to retrofit.
- **Editable AI memory.** Memory Files are AI-written but user-correctable —
  turns the AI's beliefs from a black box into an inspectable artifact.
- **Plan → approve → act.** Multi-step agent work stops for human approval
  before executing. Correct default for anything touching money.
- **AI asks clarifying questions** when a request is ambiguous — shipped as a
  headline feature, not an afterthought.
- **Public share pages** — read-only, no login. The lowest-friction way to get a
  document in front of an outsider.
- **Copy discipline.** "From drawings to answers in minutes" is concrete and
  modest. Even their own review says it "accelerates rather than replaces".

## What they do NOT do — our opening

No native app · no offline · no daily reports / punch / photos / time tracking ·
no homeowner or client portal · **no cost book or closed-job learning** · no
accounting integration · no Procore/Autodesk · PDF only (no CAD/Revit/BIM) · no
change-order workflow (despite having RFI + submittal registries) · no permit
tracking at all (our Expeditor persona is entirely unserved) · nothing for small
residential GCs — no allowances, selections, or progress draws.

## Where we need a sharper answer

1. **AI estimating looks identical from outside.** Both produce plausible line
   items with plausible numbers. The only real difference is rate provenance —
   and it is invisible on a landing page or a screenshot. **Make provenance
   visible on the row or the differentiator does not exist commercially.**
2. **RFIs/submittals.** Their office-side registry (auto-numbering, external
   routing via public forms) is more complete than ours. Compete on offline
   capture and lifecycle, not on registry features.
3. **Price comparison will get made.** Their Pro is $40/member with unlimited
   projects; ours is $29. Fine either way, but our AI cost exposure is real and
   theirs is engineered around.

## Ranked recommendations

1. **Put rate provenance on the estimate row** — a chip reading `MEASURED · 7
   jobs` vs `STATED` vs `PUBLISHED`, tapping through to the underlying jobs with
   date range and variance. Enforces the firewall, differentiates in a
   screenshot, and is the most defensible thing we own. The provenance enum
   already exists; this is a chip plus a drill-down.
2. **Solve AI cost exposure before launch.** Meter with a visible budget, but
   **not in tokens** — GCs don't think in tokens. Meter in "AI estimates per
   month" or "documents analyzed".
3. **Plan → approve → act before any AI estimate**, showing the assumptions it
   intends to use. Cheap; prevents the expensive failure.
4. **Clarifying questions before generating an estimate.** Worth more to us than
   to them — an estimate built on unstated assumptions is actively dangerous.
5. **No-login read-only share link as the homeowner portal's first rung.** The
   client-facing mode that hides costs/markups is most of the work already.
6. **Tag cost codes at capture, derive downstream.** Schema-level; do it
   pre-launch.
7. **Live-link estimate lines to field actuals.** Turns the firewall from a
   constraint into a flywheel. Real effort, but it is what makes the cost book
   work.
8. Shared saved prompts ("Skills") — park until Business tier has real teams.
9. **Publish a dated changelog.** Theirs does a lot of trust work for a company
   with no funding disclosure and no independent coverage.

## Deliberately avoid

- **Document-intelligence chat over specs.** Their core, expensive to do well,
  and small residential GCs have far fewer PDFs than a PCL project team. A
  distraction dressed as table stakes.
- **A Gantt with critical path.** Enormous surface; a small GC's Scheduler needs
  crew dispatch and sequencing, not CPM.
- **Their rate language.** "Unit rates drawn from credible professional sources"
  is exactly the unverifiable provenance claim our firewall exists to prevent —
  and a liability posture if a GC bids off it.
- **Founder-authored reviews on owned domains.** They do this on at least two
  sites with no disclosure. Short-term SEO, real downside in an industry where
  GCs talk to each other.
- **Going web-only or PDF-only.** That is the gap we walk through.
