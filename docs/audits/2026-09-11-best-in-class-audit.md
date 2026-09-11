# Best-in-class audit — 2026-09-11

Six deep audits of the app's professional surfaces, each one adversarially
verified by a second agent that was told to **refute** it. 12 agents, 0 errors.

The question each auditor was given was not "does this work" but **"is this the
best implementation of this feature that a professional in this trade could
buy"** — measured against the actual form, the actual accounting standard, the
actual scheduling method, and the competitor that ships it today.

The question each verifier was given was: *find the invented standard, the
overstated blast radius, the citation that does not survive being looked up.*

## Why the verify layer is the important half

| | raw | after verification |
|---|---|---|
| blockers | 19 | **14** (5 downgraded, 4 upgraded into the tier, 9 new ones found) |
| majors | 58 | 61 |
| standards cited | — | **28 invented or overstated** |
| findings refuted outright | — | **42** |
| findings the auditors MISSED | — | **48**, including 7 of the 14 final blockers |

Read that last row twice. **Half the blockers in this document were found by the
agent whose job was to tear the audit down, not by the audit.** The verifiers
fetched AIA's own published PDFs and diffed them, rendered the app's HTML through
headless Chrome, re-ran the shipped engines on fixtures, and re-mounted screens.
That is the layer that turns an audit into something you can act on.

Three examples of the verify layer earning its cost:

- The AIA auditor said the G702 face requires `PAGE 1 OF ___ PAGES`. The verifier
  pulled AIA's own preview PDFs for G702-1992, G703-1992 and G703S-2017 and found
  **no such field on any of them** — it is a pre-1992 feature. Acting on the
  finding would have added a field the current form does not have.
- The WIP auditor's whole competitive section rested on "Buildertrend and JobTread
  have no WIP schedule at any price." **Both ship one** — Buildertrend documents
  it in its own help centre, JobTread shipped it as a dated product update in
  October 2023. Telling a solo founder his moat is a feature his rivals shipped
  three years ago is as dangerous as inventing a standard.
- The CPM auditor said folding near-critical tasks into the critical set deviates
  from P6. **Oracle's own documentation gives "Total Float less than or equal to"
  a user-specified value as one of exactly two supported methods.** The app is
  P6-conformant; the finding would have removed a behaviour P6 ships.

---

# THE FOURTEEN BLOCKERS, RANKED

Ranked by: does a professional get a **wrong number they will act on**, or find
they **cannot do the job at all**.

## 1. The AIA pay application's two money fields cannot accept a typed number

**Found by the verifier. Confirmed independently.**

`app/aia-pay-app.tsx:896` and `:909`:

```tsx
value={line.thisPeriod.toFixed(2)}
value={line.materialsPresentlyStored.toFixed(2)}
```

Controlled `TextInput`s whose value is re-derived from numeric state on every
keystroke. Type `4`, `5`, `0`, `0` and you get `'4.00'`, `'4.00'`, `'4.00'`,
`'4.00'`. The GC types 4500 and the certificate records **$4.00**.

These are the **only two `value={…toFixed(2)}` TextInput bindings in the entire
app** — `grep -rn 'value={.*toFixed(2)}' app/ components/` returns nothing else.
Every other money field in the product uses raw string state
(`app/invoice.tsx:1531`, `:2128`). The flagship billing document is the one
screen that got it wrong.

This also reframes the "stored materials reset to zero every period" finding:
column F has no quick-% buttons, so stored materials are not merely reset —
**they cannot be entered in the first place beyond a single digit.**

*Caveat carried from the verifier, honestly:* verified against the controlled-value
contract in the test renderer, not on a device. RN forces native text back to
`value` and preserves the caret's offset-from-end, which is the mechanism. **One
device check before the fix wave.**

## 2. No working purchase path exists on any channel

This outranks every marketing finding and was missed by the marketing auditor.

- **App Store:** `itunes.apple.com/lookup?id=6762229238` → `resultCount 0`.
  `?bundleId=com.mageid.app` → `resultCount 0`. The app is not listed.
- **Web:** `eas.json` carries `EXPO_PUBLIC_REVENUECAT_WEB_API_KEY = "rcb_sb_…"`
  in **both** the preview and production profiles.

`contexts/SubscriptionContext.tsx:78-94` documents this exact trap in its own
words — `'rcb_sb_…'.startsWith('rcb_')` is `true`, so a sandbox key passes the
only pre-flight the file had and configures cleanly; offerings load, the paywall
renders, and the one thing that never happens is a charge. Line 118: *"A sandbox
key in a RELEASE build is not a warning, it is a broken till."*

The guard was written. `eas.json` was never fixed.

Every CTA on the marketing site — "Start free", "$29/mo Pro", "Paying in 90
seconds", `pricing.html:337`'s `?plan=pro&trial=14` — points at a register that
cannot take money. **The 0-conversions-in-180-days number is not evidence about a
market.** `scripts/validate-release-keys.ts` is wired into ship-check and is RED
by design until the production web key is pasted.

## 3. `/reports` calls both money engines without the one argument its own documentation says must never be omitted

`app/reports.tsx:66-67`:

```ts
computeWIPReport(projects, invoices, changeOrders, commitments)
computeProfitReport(projects, invoices, changeOrders, commitments)
```

No `costSources`. `utils/financialReports.ts:290-297` says verbatim:

> *pass it and `costToDate` is the engine's full ACTUAL (commitment payments +
> material receipts + priced crew hours + equipment days + permit fees); omit it
> and every one of those but the commitment payments is missing, which shows as
> margin the job has not earned. The health chip is derived from that margin, so
> **an omitted argument paints a bleeding job green.***

Those two lines are the **only production call sites.**
`scripts/validate-money-definitions.ts:248-249` tests `bare` against `wired` —
the repo knows the difference and the screen ships bare.

Compounding: `commitment.paidToDate` has no client writer at all (its only
producer is a trigger on `sub_submitted_invoices`), so for any GC without a sub
portal, cost-to-date on the Profit tab is **$0**. And the Profit tab is the
**default tab for every free and Pro user** (`app/reports.tsx:63`).

## 4. The QuickBooks push posts progress billings at full value, automatically

`supabase/functions/_shared/qbo-mapping/invoice.ts:36-70` builds the QBO invoice
from `Amount: li.total` per line and nothing else. `subtotal`, `tax_amount` and
`total_due` are selected at `:9` and never used; `progress_percent` is never read.

But `utils/invoiceBilling.ts:132-151` documents that a native-editor progress
invoice stores the **full** line total and scales once at the invoice level. So a
**30% progress billing of $30,000 posts to QuickBooks as a $100,000 invoice.**
`payment.ts:26-30` then applies the real MAGE payment against it, leaving a
permanent phantom receivable. Retainage is never withheld and never booked to a
retainage receivable, so a 10% held invoice sits open in QBO by the retainage
forever.

Every invoice add/edit triggers this (`contexts/ProjectContext.tsx:2759`, `:2836`).
This is the $79 Business feature that **writes into the GC's actual books.**

## 5. One reopen mints a second live Stripe link and moves the WIP contract baseline

*Upgraded from major. The auditor scored it on a wrong column D alone.*

The full chain, traced by the verifier:

1. `app/aia-pay-app.tsx:186` filters out only this invoice's record → `priorAIA` is App #5
2. `:218` sets `applicationNumber = 6`
3. `savedForThisAppNumber` (`:272-275`) matches on applicationNumber, finds nothing
4. → `isLocked` (`:279`) is **false**, defeating the edit-after-send guard
5. → `handleSave` (`:441-467`) **mints a second live Stripe payment link for already-certified money**
6. → a phantom App #6 record is written (`ProjectContext.tsx:4681-4693`)
7. → `getAIAPayAppsForProject` sorts `applicationNumber` DESC (`:4704`), so the phantom becomes `payApps[0]`
8. → `payApps[0]?.originalContractSum` is the **first branch** of `deriveOriginalContractWithSource` (`utils/wip.ts:402-405`)

One reopen-and-save on a multi-period job produces a **duplicate payable** AND
**moves the contract value on the schedule a surety reads.**

The auditor separately declared "no WIP consumer of pay apps exists" — which is
how it missed step 8. `app/wip-report.tsx:186/:380/:383` is the refutation.

## 6. Two billing ledgers run against one contract, and the default contract creates both

*Upgraded from major. The most under-rated item in the set — the only finding
that causes a GC to **over-bill a homeowner**.*

- `defaultPaymentSchedule` (`utils/contractEngine.ts:120-129`) seeds 25/25/25/25 on **every** contract
- `app/contract.tsx` puts "Create invoice" (`:241`) and "Create first invoice" → `/bill-from-estimate` (`:1011`) **on one screen**
- `deriveMilestoneInvoiceLine` (`utils/billingFlowCore.ts:186-205`) deliberately omits any estimate key
- The verifier re-rendered `/bill-from-estimate` and confirmed the hero prints **"Contract $130,052.00 · Already billed $0.00 · Remaining $130,052.00"** over 25/50/75/100% quick-fill buttons

A GC who bills the deposit milestone and then quick-fills 100% **bills 125% of
the contract**, and nothing anywhere cross-guards it.

## 7. Any partial payment on a closed job replaces the contract sum as the learned cost

*Upgraded from major, and re-scoped — the auditor filed this as "retainage makes
the rate low by the retention percentage." Retainage is the mild case.*

`utils/estimateActuals.ts:199` — `hasActual` is literally `actual > 0`.
`utils/costDatabase.ts:159` prefers `l.actual` over `l.committed` with **no
proximity test whatsoever**.

The verifier ran the common residential case: a closed roofing job, $12,000
signed, 30 SQ at a true $400/SQ, one 10% mobilization deposit paid.

- `buildCostDatabase` learns **$40.00/SQ**
- stamps the sample `basis: 'actual'` → the screen prints "actual"
- computes `bidBias` −0.90
- `app/cost-database.tsx:263-269` renders **in GREEN with a downward arrow: "You bid this ~90% over actual cost"**

**A 10× error presented as good news**, on the screen that is the entire moat.

And it is downstream of the headline KPI: `overallBidAccuracy`
(`utils/costDatabase.ts:311-316`) reads **10%** on an account whose estimating
was perfect.

## 8. Estimate Confidence is inverted by markup

*Confirmed. Population narrowed by the verifier from "essentially every estimate"
to "estimates built in the cart" — the default markup is 15%
(`contexts/MaterialCartContext.tsx:68`), not the 18% cited, and every AI path
(wizard, copilot, drawing-analyzer) writes `markup: 0` with `lineTotal` = pure cost.*

`utils/estimateConfidence.ts:92-93` divides `lineTotal` (which carries markup on
the cart path) by quantity and compares it to `suggestedRate`, which is **true
cost**. Reproduced:

- priced at $2.00 cost + 20% markup → `bidUnit` 2.40 → flagged **'overpriced'**, score **0**
- priced at $1.6667 — **17% BELOW cost** — + 20% markup → `bidUnit` 2.00 → flagged **'aligned'**, score **100**

`app/estimate-confidence.tsx:164-167` renders **"Well-backed estimate"** over the
loss-making bid. `DEVIATION_THRESHOLD` is 0.1 and the default markup is 15%, so
on a cart-built estimate **every line with history is flagged** — uniformly wrong.

## 9. Calibration measures in-progress jobs and tells the GC to cut his prices

`utils/estimateCalibration.ts:126` iterates every project with **no status
filter**; `:133` gates on `hasActual` = `actual > 0`; `:149` is
`bias = actual / estimated`.

Reproduced: one **active** project, a $10,000 tile line, $3,000 paid →
bias 0.3 → *"You over-estimate Tile by 70% across 1 job… Suggested correction:
×0.80."*

Seven consumers, all unfiltered — including `components/AIEstimateValidator.tsx:51`,
which the auditor missed. `utils/costDatabase.ts:149` does `if (!isClosed(project)) continue;`
— so **the price book and the calibrator answer "what is your bid bias" from
different populations.**

## 10. `computeWIPReport` never reads AIA pay applications

**Missed entirely by the WIP audit.** Its signature is
`(projects, invoices, changeOrders, commitments, costSources)` and `billedToDate`
is invoices-only (`utils/financialReports.ts:149-150`).

Measured: a job billed through a saved pay application with $350,000 cumulative
Total Completed and Stored reads **Billed $350,000 on `/wip-report` and $0 on the
`/reports` WIP tab**, its CSV and its PDF.

For a GC using the app's flagship AIA progress billing — the feature the whole
$29-vs-$99 pitch rests on — the `/reports` WIP schedule reports **zero billings**
and therefore **invents underbilling equal to earned revenue**. A wrong number on
a bank document. This is a fifth parity axis nobody has enumerated.

## 11. An overrun job now reports exactly 100% complete, by construction

*Upgraded from major — and **my own fix made it universal**.*

With `costIncurred` now passed at both call sites (the parity fix I landed
mid-audit), `EAC = costToDate` on every overrun job. So:

```
percentComplete = costToDate / totalEstimatedCost = 1.0   ← by construction
costToComplete  = 0                                        ← by construction
backlog         = 0                                        ← by construction
```

Measured: contract $550,000, $620,000 incurred → percentComplete 1, earned
revenue $550,000, costToComplete $0, backlog $0 **on both schedules**.

**The engine now forecasts that every overrun job will incur zero further cost.**

The verifier also grounded the fix: a surety WIP template source names *"the
estimated cost to complete, updated by the person actually running the job"* as a
required column, and *"inaccurate cost-to-complete estimates"* as the first of
three failures that sink construction accounting. There is no per-period ETC
input anywhere in the product.

## 12. The two schedules disagree on the CONTRACT, and the parity guard cannot see it

*Upgraded from major, and re-aimed — the auditor led with the cost axis (which I
fixed); the contract axis buried inside it is the live one.*

Measured against the shipped functions:

| | `/wip-report` | `/reports` |
|---|---|---|
| job with a saved pay app (`originalContractSum` $700,000) | **$700,000** / 42.9% margin | **$550,000** / 27.3% |
| target-budget-only job | **$900,000** / 100% margin | **$0** / 0% |

A 15.6-point divergence and then a total one, **on the revenue side** — and it is
not one of the four axes `scripts/validate-wip-parity.ts` enumerates, so the
guard is structurally blind to it.

## 13. The Pro grid prints Start/Finish on a different day-number scale from the engine that computed them

**Confirmed to the day.** Fixture A(10)→B(5)→C(5) FS, 5-day week, Mon 2026-03-02:

| task | engine | grid |
|---|---|---|
| A | Mar 2 → Mar 13 | Mar 2 → **Mar 17** |
| B | Mar 16 → Mar 20 | **Mar 20 → Mar 26** |
| C | Mar 23 → Mar 27 | **Mar 31 → Apr 6** |

**The verifier corrected the fix, which matters more than the finding.** The
auditor put the defect in the renderer and proposed migrating every stored
`startDay` to the calendar scale — which would also require migrating
`baselineStartDay`/`baselineEndDay` and every persisted baseline row.

The root cause is in the **engine**: `forwardPass` does
`const pins = Math.max(1, task.startDay || 1)` (`utils/cpm.ts:534`, `:543`), and
`startDay` is a **working** ordinal everywhere it is written. The engine ingests
it as a calendar index, so **every pinned task is scheduled earlier than authored
before a single pixel is drawn** (type Mon Mar 16 → stores startDay 11 → engine
plans Thu Mar 12).

The cheap correct fix is the opposite direction: `cpm.es/ef` are **already**
calendar indices, so render them as plain calendar dates (2 lines in
`GridPane.renderDate`), drive the Gantt bar from `cpm.es/ef`, and convert
working-ordinal → calendar index **once**, at the `pins` line. **No data migration.**

The auditor also put three *correct* consumers in the defect column
(`getTaskDateRange`, the CSV export, `icsGenerator`) — sending a fixer at those
would break three things that work.

## 14. `isCriticalPath` is a stale, LLM-guessed flag — and it is what the client sees

**The biggest CPM miss.** The live CPM result is **never written back** to
`ScheduleTask.isCriticalPath` anywhere in schedule-pro. The flag is set by:

- the AI generator — `utils/autoScheduleFromEstimate.ts:85` literally instructs the model *"Mark tasks on the longest chain as isCriticalPath: true"*
- template/seed code that hard-codes it (`app/(tabs)/schedule/index.tsx:964, 978, 990, 1007`)

Only `utils/coScheduleReflowCore.ts:586` ever refreshes it from a real CPM run.

It is **read** by `utils/portalSnapshot.ts:632` (the client portal),
`utils/pdfGenerator.ts:536/558/576/1615` (the schedule PDF),
`utils/printableGanttHtml.ts:153` (the red bars on the printable one-pager),
`utils/icsGenerator.ts:177` ("On critical path" in the calendar invite), and
`utils/oacEngine.ts:96` / `utils/aiService.ts:818,834` (AI risk reasoning).

**On every surface a client, a sub, or the AI sees, "the critical path" is
whatever a language model or a template author guessed** — not what the engine
computed. For a product whose headline is *real critical-path scheduling, not a
Gantt with dependencies*, this undercuts the claim exactly where it is sold.

---

# THE HONEST OTHER HALF: what these audits got wrong

The verifiers found **28 invented or overstated standards** and **42 refutable
claims**. These are the ones that would have cost real work:

### Standards that do not exist
- **`PAGE 1 OF ___ PAGES` on the G702.** Not on G702-1992, G703-1992 or G703S-2017 — checked against AIA's own published PDFs. It is a **pre-1992** feature.
- **"Column I can never be negative."** Column I is **RETAINAGE**. Column H is Balance to Finish. The audit's own excellent-list had it right.
- **"On a G703, column G can never exceed column C."** True as trade practice; the form prints no such rule.
- **"P6 keeps critical and near-critical distinct."** Backwards. Oracle documents "Total Float less than or equal to [a user value]" as one of exactly two supported methods. `isCritical = tf <= threshold` **is P6-conformant.**
- **"ASC 606-10-55-21 REQUIRES excluding uninstalled materials."** The guidance is **conditional** on four criteria. A lumber drop typically does not qualify; a cabinet package typically does. Build it — but not as an unconditional rule.
- **"ASC 606 loss recognition"** in proposed marketing copy. ASC 606 contains **no onerous-contract provision** — it is **ASC 605-35**. The *code* gets this right (`utils/wip.ts:139-141`); the marketing copy would have put the wrong cite in front of the one reader it was written to impress.
- **"AIA A201 §9.3.1 fixes 5–10% retainage."** §9.3.1 is Applications for Payment. Retainage is set in the **Owner–Contractor Agreement** (A101 §5.1.7/§5.1.8) and negotiated per contract.
- **"The standard surety WIP columns are [17 items]."** Foundation Software's own field guide says *"there's no single universal format."* Measured against the sourced list, the CSV is missing **two** columns, not four-plus.
- **FTC Endorsement Guides** (16 CFR 255) cited for an animated chart. Those govern testimonials. The applicable doctrine is the **FTC Policy Statement Regarding Advertising Substantiation**.

### Competitive claims that are false
- **"Buildertrend and JobTread have no WIP schedule at any price."** Both ship one. Buildertrend documents Earned Revenue and Over/Under Billing in its own help centre; JobTread shipped a Dynamic WIP Report in **October 2023**.
- **"Contractor Foreman's WIP is a spreadsheet export."** It documents an in-app WIP report using the **same cost-to-cost method** MAGE uses.
- **"Knowify at $99 has no per-line retainage."** Knowify's own docs describe per-line G703 column I retainage, auto-generated SOVs, stored materials, **and retainage-release reminders** — which is the thing MAGE lacks. On retainage release Knowify is **ahead**.
- **"Buildertrend and JobTread ship none of this [CPM]."** Contractor Foreman markets Gantt charts "powered by CPM", critical-path tracking and baseline comparison at ~$49/mo.
- The proposed marketing H1 **"Everyone else charges $99 to $199"** — Contractor Foreman Basic is **$49**. The same report says so one screen earlier.

### Findings that inverted under scrutiny
- **"Every CO makes an over-budget job look better."** The opposite. `budget += changeAmount` raises budget and `uncommittedRemainder` raises `projectedFinal` by the identical dollar, so `variance` is **unchanged**. Downgraded major → minor.
- **"Flat price for your whole company is false — the product meters seats."** There are **no per-seat fees at all**. `utils/seatModel.ts:63` sets `SEAT_OVERAGE_BILLING_ENABLED = false`, and `project-invite/index.ts:220` only seat-checks **billable** roles, so field invites bypass it at every tier. "Subs free" is literally true. The real defect is an **undisclosed 2-admin cap on Pro**. Blocker → major.
- **"The codebase asserts the G702 text is not copyrighted."** No such assertion exists — `aiaForms.ts:5` is scoped by the list at `:12-17` (G704/706/706A/707/714). The **verbatim fact survives** (character-identical to AIA's own preview, diffed with `pdftotext`); the self-incrimination does not.
- **"Summary bars are short by the weekends their children span."** They are **too long**, not short — and only across gaps between children. The two errors cancel in the single-child case.

### One correction of my own, over the verifier

The cost-learning verifier called the seeded-rates-in-the-public-benchmark issue
its "biggest miss" and described the upsert as unconditionally reaching
`public.public_cost_index`. **It is gated.**
`supabase/migrations/20260730120000_public_price_index.sql:44` filters on
`s.public_index_opt_in`, which **defaults FALSE**.

The defect is real and the one-line fix is the same — but its scope is *"any
contractor who opts in publishes their un-measured guesses as if they were paid
rates"*, not *"every contractor already does."* `app/cost-database.tsx:84-86`
builds `benchInputs` with **no provenance filter**, so the moment the toggle goes
on, seeded guesses (`jobCount 0`) are aggregated into a k-anonymised median that
`utils/costTruth.ts:7` sells to every other contractor as *"real paid rates, not
catalog averages."*

---

# WHAT IS GENUINELY EXCELLENT

The verifiers were told to attack this section too, and most of it held.

**The AIA engine.** The G702 face is **line-for-line correct** against AIA's own
G702-1992 preview — all nine lines, including the 5a/5b split and Balance to
Finish = Line 3 − Line 6. The G703 reproduces columns A–I **including the
unlettered % (G÷C) column between G and H** — the verifier rendered AIA's sample
page to check. Per-line cent-rounded retainage foots to G702 line 5 **by
construction**. The verifier's word: *"the arithmetic is genuinely good — better
than I expected and better than most software that charges ten times more."*

**The loss provision.** `utils/wip.ts:144-147` books the **entire** forecast loss
rather than pro-rating it, per-contract, not netted. The verifier hunted this
hardest and found it clean against ASC 605-35-25-46 (four independent sources).

**The provenance instrumentation.** `reconcileAIASov`, the `sovBasis` note, the
retainage-source note, `wipSourceLabel`'s `hasOwnProperty` guard, the
`describePortfolioCostBasis` overspend sentence. The verifier: *"this
instrumentation has no competitor equivalent."*

**The seed firewall — from the seed side.** Seeds get quantity 1, bidUnit 0 and a
`seed:` projectId; `jobCount` excludes them; `rateProvenance` refuses a MEASURED
chip at jobCount 0; both AI grounding paths name a seeded rate as self-reported.
The one breach is the publish path above.

**Citation discipline.** The WIP verifier spot-checked **45 line references**
against the HEAD blob and found the worst drift to be **two lines**. Its comment:
*"unusually good for an audit of this size and it is worth saying."*

---

# MARKETING: what to actually do

The site's problem is not that it under-sells. It is that **five of its loudest
claims are false**, and the true story it is not telling is stronger.

**Delete first (all trivial):**
1. The animated `+38%` accuracy curve (`index.html:986` — `textContent='+'+Math.round(k*38)+'%'`) and "by job 50, MAGE prices like your best estimator." Zero substantiation. The page's own other figures carry careful "Example figures" labels; this one carries none.
2. "Published, in the App Store" / "Self-serve App Store install" (`features/vs-competitors.html:251`, `:420`; `compare/procore.html:90`, `:228`). **Do not** replace it with the auditor's proposed "open it in a browser and start" — that ships a *second* false distribution claim on top of the one you are removing. `access.html` and `thanks.html` already carry honest TestFlight copy.
3. "Priority support + named CSM" (`pricing.html:383`, `:406`). There is one person.
4. "Live material pricing from local suppliers… nine major metros" (`features/financials.html:168`, `:174`). There are 10 static regions and 20 city adjustments, and "nine" matches nothing.
5. The DCMA "14-point" claim as currently framed — **but not the way the auditor suggested.**

**Fix the numbers:** four different annual prices across five pages ($288, $299, $348, "~$24/mo effective") and three different "stack you're replacing" totals ($360–920, $360–910, $396–703).

**The replacement claims that are TRUE and stronger than what is there now:**

- *Live material prices, the day you snap the receipt.* `utils/costDatabase.ts:183-196` folds scanned supplier invoices into the price book keyed the same way as closed-job samples — its own comment says *"no wait for project closeout."* The auditor's proposed replacement ("Day one: regional cost factors / Job two onward: your own closed jobs") **understates the product by a full job cycle.**
- *WIP at $79 against Knowify's at $329.* Knowify's Core plan ($99, 1 user) does **not** include WIP — it starts at Advanced, $329/mo annual. The "WIP is sold at the Pro price but gated at Business" finding becomes a **positive argument** rather than a retreat.
- *"AIA-style" costs nothing competitively.* Contractor Foreman's own pricing page labels the feature **"AIA Style Invoicing (G702 and G703)"**. The largest published-price competitor already uses the exact hedge. Ship the disclaimer the product already carries (`utils/aiaBilling.ts:937`) — marketing has zero instances of "AIA-style".
- *Add the three DCMA checks instead of softening the claim.* The four unimplemented checks are #4 Relationship Types, #7 Negative Float, #9 Invalid Dates, #13 CPLI. **Every one is computable from data the app already holds** — #4 needs only `DependencyLink.type` (`cpm.ts:48`), #7 is `totalFloat < 0` (`cpm.ts:56`, where `isCritical` is already `totalFloat <= 0`), #9 needs only date comparisons, #13 needs a baseline finish that #14 BEI already requires. The auditor's proposed excuse — *"the four we don't run need data a residential schedule usually doesn't carry"* — is **the most dangerous line in that report**: it tells a federal scheduler something false AND tells the founder three nearly-free checks are impractical.

**Do NOT ship the proposed one-line position.** *"MAGE ID is the only construction
app that does AIA-style progress billing, a bank-ready WIP schedule and a real
critical path for $29 a month"* is an exhaustive negative claim across a category
holding 866 products on Capterra alone. Replacing five unsubstantiated claims
with a new unverifiable "only" is not an improvement. The checkable version:
**"The cheapest published plan with AIA-style G702/G703 we could find is $105 for
three users. Ours is $29."**

**Two marketing defects the auditor missed:**
- A **free-tier user cannot invite a sub at all.** `CollaboratorsManager.tsx:47` puts `if (!canAccess('schedule_collaboration')) → /paywall` **before the role is consulted**, so it fires for role `'field'` too. The server would allow it; the client never sends the request. Meanwhile `index.html:792` answers *"Do my subs really use it for free?"* with **"Yes."**
- `?trial=999` renders **"999-day free trial"** inside the paid app. `utils/signupIntent.ts:20` has no upper clamp and `app/paywall.tsx:420/458/496` render it directly.

---

# Method

Workflow `wf_200c10e4-99f`. Six area audits, each followed by an adversarial
verification pass whose brief was to refute. Verifiers fetched AIA's published
form PDFs and diffed with `pdftotext`, rendered `buildAIAPayAppHtml` through
headless Chrome with `--print-to-pdf`, re-ran shipped engines on fixtures,
re-mounted screens through the route harness, and checked competitor pricing
against vendor pages on 2026-09-11.

Severity bar: **blocker** = a professional gets a wrong number they will act on,
or cannot do the job at all.

**This document is an audit. Nothing in it has been fixed** except WIP finding 1
(the cost-at-completion parity bug), which was mine and which I closed during the
run — `app/wip-report.tsx:409` now passes `costIncurred`, pinned by a call-site
completeness check in `scripts/validate-money-basis-parity.ts`.
