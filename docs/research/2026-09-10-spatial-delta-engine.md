# As-Built vs. As-Bid Delta Engine — Final Brief

**Date: 2026-09-10. Prepared for: MAGE ID founder. Read time: ~12 minutes.**

---

## VERDICT

**Don't build it. Not the five phases, and not the reduced "scan a room, get a priced change order" version either.**

Not because phone LiDAR is too inaccurate — that argument is weaker than it looks and I'll show you where it breaks. The reason is simpler and it's in your own repo: **Phase 4 has nothing to multiply by.** Your concept says "it references the electrician's unit rate." For subcontracted scope — most of a residential GC's cost — that rate does not exist in MAGE ID and cannot be derived from what you store. `types/index.ts:3231`: `SubSubmittedInvoiceLine { description: string; amount: number }`. No quantity. No unit. `Commitment` (`types/index.ts:2295`): `amount: number`, `description: string`. No quantity, no unit. A signed subcontract in your app is a lump sum with free text attached. `utils/costDatabase.ts:159–176` then does `actualUnit: cost / l.quantity` where `cost` falls back to the signed commitment and `l.quantity` is the **bid** quantity. So a subbed trade's "unit rate" in your cost book is *lump sum ÷ your own guess* — a quotient nobody agreed to.

Build the sensor and you get a variance engine that confidently multiplies a measured delta by a fabricated rate, and papers the result as a change order. The failure mode isn't noisy dollars. It's **negative margin, signed.**

Second reason: the parts of the concept that are genuinely buildable are already sold at or below your price. ArcSite includes an AR LiDAR room scanner from $30/mo and bundles takeoff + pricing + digital approvals at $129/mo ([arcsite.com/pricing](https://arcsite.com/pricing)). CompanyCam already ships LiDAR measurement plus signatures ([companycam.com/resources/classes/how-to-use-lidar-mode](https://companycam.com/resources/classes/how-to-use-lidar-mode)). Polycam and Twindo (formerly Canvas) give away the capture free. The capture-to-document pipeline is a commodity. **The only unclaimed thing in your concept is pricing off what this contractor's own jobs actually cost — and that needs a schema change, not a sensor.**

Third reason, and it's the one that reframes everything: the buyer for whom scan-to-dollars actually clears is **insurance restoration**, not residential remodel. Restoration has an agreed unit price book (Xactimate) and an adjuster obliged to accept a documented quantity. Remodel has a homeowner who must be *persuaded* and a sub whose price is a lump sum. magicplan has already repositioned to "Restoration workflow software" ([magicplan.app](https://www.magicplan.app/)). Your concept isn't wrong. **It's aimed at the one segment where its precondition — a mutually agreed unit price — doesn't exist.**

---

## Claims I am not going to repeat to you

An adversarial fact-check refuted these. If you hear them again, they're wrong:

- **"Nobody in this category turns scan into dollars."** False. Doxel's own product page markets "Instantly calculate cost vs. progress across trades and scopes" and earned-value tracking ([doxel.ai/product](https://doxel.ai/product)). Propeller Aero converts drone volumes into audit-ready quantity records for pay-app reconciliation. What nobody emits is a *contractual document* from a detected delta. That's a document-generation gap, not a business-model inversion.
- **"The category floor is $10,000/yr, so no incumbent will come down to kill you."** The $10,000 figure is real but it is OpenSpace's minimum only ([openspace.ai/smb-pricing-webpage](https://www.openspace.ai/smb-pricing-webpage)). ClearEdge3D prices EdgeWise Lite at $1,995/yr; DroneDeploy positions Progress AI at "a fraction of incumbent progress-tracking solutions." The real floor is roughly $2k/yr — *inside* your Enterprise ARPU, not 5.5x above it.
- **"Enterprise products need a human in the loop, so autonomy at $79 is a science project."** True of OpenSpace Track (24–48 hours, humans in the loop). False of the category: DroneDeploy Progress AI (2025-07-22) states "BIM and schedule are not required" and "Progress data in minutes, not days."
- **"Handoff already ingests LiDAR scans."** It does not. That came from a feature-*request* board post with 2 upvotes. Handoff's stated inputs are a typed scope, a photo, or a floor plan.
- **"iPhone LiDAR is ~2cm at 3m, 3–5cm at 3–4m."** Those numbers appear in no source. They were attributed to "independent testing" but trace to a marketing page for a product that sells LiDAR error correction, and the figures aren't even on that page. **Discard them.** Same for a "42:1 → 3:1 signal-to-noise" figure — fabricated.
- **"Multi-room scanning fails at room three."** That result is from a 2020 iPad Pro running a third-party app with no loop closure (ISPRS 2022). The paper itself blames the SLAM trajectory, not the sensor. Apple shipped MultiRoom in iOS 17 explicitly for "single-floor residential houses… one to four bedrooms, living room, kitchen, and dining room," up to 2,000 sq ft (WWDC23 session 10192).
- **"California and New York make a post-hoc change order unenforceable."** Overstated. B&P §7159(e)(3)(C) and §7159.6(c) both expressly preserve recovery "based upon legal or equitable remedies designed to prevent unjust enrichment." NY: unenforceable under GBL §771 but recoverable in quantum meruit (*Home Constr. Corp. v Beaury*, 2d Dept 2017). **The statute bars the writing from becoming part of the contract; it does not bar you from getting paid.** A timestamped contemporaneous record is exactly the evidence that wins that claim.
- **CompanyCam pricing.** Two sources disagree on whether $63/$129/$199 are monthly or annual-billing rates. Vendor page fetched 2026-09-10 shows Core $63 / Crew $129 / Scale $199 plus $29/user. **Treat the monthly/annual split as unresolved.** The load-bearing fact is unambiguous: LiDAR measurement is Scale-tier, and it already ships.

---

## Phase by phase

| Phase | Difficulty | Confidence in that read | Verdict |
|---|---|---|---|
| 1 — Spatial anchoring | Very hard, and no substrate exists | **High** (code evidence) | **Cut.** The true bottleneck. |
| 2 — Reality capture | Genuinely easy | **High** on feasibility, **low** on unit economics | **Don't build. Integrate if ever needed.** |
| 3 — Variance engine | Hard-to-impossible per trigger | **High** on clash and quantity, **medium** on schedule | **Cut all three.** |
| 4 — Financial translation | Blocked, and not by engineering | **High** (code evidence) | **Cut the auto-CO. Its multiplicand is the business.** |
| 5 — Visual compliance | ~90% already built, without a scanner | **High** | **Keep the idea. Drop the sensor. Decide retention first.** |

### Phase 1 — Spatial anchoring. This is the bottleneck.

Your app has no geometry to anchor to and no link between takeoff and money in *two* dimensions, let alone three.

- `types/index.ts:2863` — `PlanSheet` is `imageUri` + `width` + `height` + `pageNumber`, with the comment "MAGE treats plans as images (rendered from PDF upstream)." No wall, no slab, no elevation.
- `utils/takeoffGeometry.ts:14` — `NormPoint { x, y }`, normalized 0–1 across an image. No Z, no world frame.
- A repo-wide grep for `roomplan|arkit|lidar|point.?cloud|scenedepth|armeshanchor|scenekit|realitykit` across all `.ts`/`.tsx` returns **zero** hits.
- There is no `takeoffId` on an estimate line. Worse, your own code documents the historical break: `app/takeoff.tsx:340` — the old flow routed to the wizard with `fromTakeoff: '1'` "but the wizard side never consumed the flag so the takeoff data was silently dropped."

Phase 1 proposes adding a Z axis to a link that only recently started existing in X and Y.

And it runs against the market. The two funded 2025 entrants both shipped **model-free on purpose**: OpenSpace Track — "No, BIM is not required to use OpenSpace Track"; DroneDeploy — "BIM and schedule are not required, reducing setup dependencies." Asking a remodeler working from 2D PDFs to assign X/Y/Z per takeoff line is re-adding the requirement two better-capitalized competitors paid engineering to remove.

One structural point you cannot escape: Doxel can compute earned value in dollars *only because a BIM supplies the quantities and cost codes*. Phase 1 is the precondition for Phase 4, not an eccentric detour. Which means you cannot keep Phase 4's multiplication and cut the thing being multiplied. Cut Phase 1, and Phases 3 and 4 go with it.

**Note honestly: this is the one dimension of the research that returned nothing.** Every recommendation below rests on the code evidence above, not on external research into spatial anchoring, because none was produced.

### Phase 2 — Reality capture. The easy phase, and that's the problem.

Technically fine. RoomPlan handles residential room geometry natively; `expo-roomplan` exists (14 versions, MIT, single maintainer, created 2025-07-20, latest 1.3.1 on 2026-07-27 — with essentially all development in a six-week burst in Aug 2025 and then an eleven-month gap). Bus factor one, effectively dormant.

Four reasons not to:

1. **It's free elsewhere.** Twindo/Canvas is free to download, scan and measure, two free scans/month, export at no cost — you pay only for CAD conversion ([support.canvas.io/article/615](https://support.canvas.io/article/615)). Any pitch here has to beat free.
2. **Device gate is the Pro line, permanently.** iPhone 18 Pro lists a LiDAR Scanner; **iPhone Air — a current premium model — does not.** Six years in, Apple shows no sign of pushing it down the lineup. Your LiDAR-device share among your own users is **unknown** — no reliable figure exists and the "~23%" that circulated was two unrelated statistics multiplied together.
3. **It breaks your only write path.** `utils/offlineQueue.ts:19` — `data: Record<string, unknown>`, JSON in AsyncStorage, `MAX_QUEUE = 1000` with FIFO drop. Binary capture has no route through it. Phase 2 requires a second, unqueued upload path — breaking the offline-first invariant for the feature most likely to be used in a basement with no signal.
4. **The unit economics are unknown and cumulative.** Supabase Pro: 100 GB included then $0.0213/GB, 250 GB egress then $0.09/GB. Eight jobs × ~22 workdays ≈ 176 captures per customer per month, **accumulating forever against revenue that does not**. I could not verify a representative scan file size. At ~1 MB it's free; at ~200 MB it's ~35 GB/month/customer. **That single unmeasured number decides whether Phase 2 is affordable.** Measure it before you budget anything.

### Phase 3 — The variance engine. All three triggers fail, each differently.

**Spatial clash.** Requires a coordinated, federated MEP model. Your ICP has none. No product detects MEP clashes without one. Also, neither Apple enum can see MEP: `RoomPlan CapturedRoom.Object.Category` is exactly 16 cases (bathtub, bed, chair, dishwasher, fireplace, oven, refrigerator, sink, sofa, stairs, storage, stove, table, television, toilet, washerDryer); `ARMeshClassification` is exactly 8 (ceiling, door, floor, none, seat, table, wall, window). Detecting a duct is an ML labeling program you'd run yourself, not an integration. Cut.

**Quantity deviation.** The right yardstick is **ACI 117-10**, and it settles this decisively. Suspended-slab thickness tolerance: **−1/4 in** (§4.5.3). Slab-on-ground: average −3/8 in, individual −3/4 in (§4.5.4). Top-of-slab elevation ±3/4 in (§4.4.1). A quarter-inch tolerance is roughly an order of magnitude tighter than any published phone-LiDAR figure. Two more things kill your own concrete example specifically: those tolerances are **minus-only**, so a slab *thicker* than designed is not a tolerance deviation at all — it's a subgrade cost question (§4.4.5 sets fine grade at ±3/4 in), and the entitlement turns on who was responsible for grade. And LiDAR returns surfaces; after a pour there is one surface. ACI 117 §4.5.4.3 names the actual instruments: coring, or an impact-echo device. **Batch-ticket parsing beats any scan for this, and you can ship it with no sensor.**

Standing test for any future quantity trigger: name the contractual tolerance for the trade, compare it to the sensor's error, and if the sensor is coarser, the trigger fires on noise. Almost every residential trigger fails this.

**Schedule variance** ("expected framing in Zone B, scan detects empty space") is the only one with a pulse — a coarse presence/absence check tolerates centimetre error. But it needs Phase 1, and both 2025 entrants give it away model-free at a price you can't undercut.

**One correction in your favour on accuracy**, because you'll see it and think the case was cherry-picked: the honest picture is 1 cm to 10 cm depending on path length and whether the app does loop closure (Treccani, Adami & Fregonese, ISPRS Archives XLVIII-2/W8-2024, published 2024-12-14 — tested a building corridor and an urban street, i.e. drift-accumulating geometries). Single-room capture is the low-drift end. A UNB study reports ±3 cm horizontal / ±7 mm vertical on an iPhone 13 Pro over five 8-minute passes. Engineering.com's 2023 Canvas test measured 7/8 in on a 21 ft 11-1/8 in wall (0.33%). **Accuracy is not the reason to cut Phase 3.** Contractual tolerance and the missing multiplicand are.

### Phase 4 — Financial translation. The idea is the business; the mechanism is empty.

Covered in the verdict, plus two consequences you should hold onto:

**A sub's marginal price is not his base-contract average.** Twenty linear feet added after mobilization carries a return trip, a small-job premium, and zero competitive tension. Even with a perfect denominator, auto-filling a CO at the learned average **under-bills the homeowner relative to what the sub will bill you.** Any future version of this fills in the *quantity* and leaves the dollar to the GC after he gets the sub's number.

**Legally it's an evidence product, not a contract product.** Both CA §7159.6 and NY GBL §771 require the change order signed before the work; both preserve recovery anyway. So the auto-generated document is *evidence in a dispute*, which is a different promise sold differently. And the evidence itself is cheap to defend: a timestamped record clears FRE 901(a)/901(b)(9) at the modest Rule 104(b) threshold. What invites a Daubert/FRE 702 challenge is the app's **priced opinion** — "the delta is 12 LF, therefore $4,000." That is your app on the witness stand. Flag, don't figure — for liability reasons, not accuracy ones.

### Phase 5 — Visual compliance. Mostly built, and the sensor adds little.

Already shipping: `app/daily-report.tsx:816` calls `stampPhotoLocation()` from `utils/photoGeoStamp.ts`. And `types/index.ts:~4880` already documents the right grain — "A field ticket signed AT THE MOMENT THE WORK HAPPENS is what makes extra work billable," with signed content sealed as evidence. That is Phase 5's value, without a mesh.

Three corrections to the concept text:

- **TR8 is the NYC energy-code progress-inspection form** (NYCECC, Rule §5000-01 and §101-07) and **only a registered design professional may sign it.** A scan creates no standing. **TR1** is the special-inspections statement of responsibility covering BC Ch.17 items including steel bolting and firestopping — so you were half right. The real hook is NYC BC §1704.1.1.3 item 4: work "shall remain accessible and exposed for special inspection purposes until completion." But the buyer there is the owner's special inspection agency, not your GC.
- **NYC now runs Technical Reports through DOB NOW: Build.** The TR8 instruction sheet you'd be building against is revision 01/11 — a paper process from 2011.
- **You have no retention policy and this one is a real liability.** FRCP 37(e) sanctions loss of ESI "that should have been preserved in the anticipation or conduct of litigation." A repo-wide grep for `legal hold|litigation hold|retention polic|preserve.*evidence` returns **zero hits**, while `supabase/functions/delete-account/index.ts` recursively removes every object a user owns. A customer under a preservation duty who taps Delete Account gets an irreversible purge from a product that marketed the archive as indisputable. Also: a daily archive proves *when the GC first saw* a defect, which starts his own notice clock earlier than he'd like — `utils/noticeClock.ts:34` already models 7/14/21 days with `ASSUMED_NOTICE_PERIOD_DAYS = 7`. And a "permanent" record sold monthly is either deleted on churn (so it was never an audit trail) or stored forever on revenue that stopped.

---

## Incumbents, precisely — and what's left

| Vendor | What it already does | Price (as published) |
|---|---|---|
| **ArcSite** | AR LiDAR room scanner from Draw Pro; Takeoff; Estimates bundling pricing, proposals, digital approvals | Draw Pro $30/mo annual; Takeoff $99; **Estimates $129** |
| **CompanyCam** | LiDAR Mode measurement from photos (3–15 ft), room measurement + agreements/signatures on Scale | Core $63 / Crew $129 / **Scale $199**, +$29/user — *monthly vs annual unresolved* |
| **HOVER** | Photogrammetry (no LiDAR, any handset) → measured model → takeoff → estimate; documented interior LiDAR flow too | Per-project, roughly **$29–$139/job** plus a subscription tier — *exact ladder conflicts across sources, unverified* |
| **magicplan** | LiDAR scan → complete ESX with line items and quantities; built-in estimating on personalized price lists; **positioned for restoration** | Pay-per-project, 10/mo then **$40/project**; tier prices **unknown** |
| **Twindo (ex-Canvas)** | Phone scan → CAD, 1–2% *in the delivered CAD file* after paid processing; free capture and export | Free capture, 2 free scans/mo; CAD priced per sqft |
| **Polycam** | 3D room scanner, floor plans (iPhone Pro / iPad Pro 2021+) | Pro $26.99/mo or $199.99/yr |
| **Handoff** | AI estimates priced off **supplier catalogs** (Home Depot, Lowe's, 60M+ SKUs, ZIP-code labor). No LiDAR | Flex $119/mo annual ($149 monthly) → Scale $719/mo annual |
| **Doxel / Buildots / OpenSpace / DroneDeploy** | Automated installed-quantity and progress; Doxel computes cost-vs-progress. Enterprise | OpenSpace minimum $10,000; others unpublished |

**What is genuinely unclaimed: pricing off the contractor's own measured actuals.** Verified across every estimating product checked — Handoff prices off supplier catalogs; magicplan and ArcSite off hand-entered price lists; Xactimate off Verisk's published list; 1build sells "live construction costs on 68 million materials, labor, equipment and assemblies for every county in the US" as an API. Every one is a **list** — someone else's, or the contractor's own guess typed in. **Nobody closes the loop against what this contractor's completed jobs actually cost.** That is your moat, it needs no sensor, and right now it holds for materials (`materialReceipt.ts:192` uses the supplier's real invoice unit price) and self-perform labor — but **not** for subcontracted scope, which is most of the job.

Also worth knowing before you value this as a standalone line: Twindo, the specialist that has sold exactly the reduced version to remodelers since Occipital's structured-light days, reports roughly **$7.7M revenue and ~12,000 customers** after a $10M Series A-1 in January 2025 (company-reported, secondary source). Buildots raised **$166M total** and its May 2025 Series D valued it around **$300M** (Calcalist/CTech) — about 1.8x invested capital. Standalone variance analytics has consistently ended up inside a sensor or platform company: ClearEdge3D→Topcon (Feb 2018), Avvir→Hexagon (Oct 2022), PointFuse core IP→Autodesk (Mar 2024), Disperse→OpenSpace (Oct 2025).

---

## The ICP tension, answered directly

**The capture layer works at $79/mo. The variance layer and the archive do not.**

"Spatial computing can't reach a $79 remodeler" is empirically false. Apple *optimized* RoomPlan MultiRoom for exactly this customer — 1–4 bedrooms, single-floor residential, up to 2,000 sq ft. ArcSite sells a LiDAR scanner at $30/mo. HOVER claims 250k+ pros. magicplan and CompanyCam both ship it. Residential contractors demonstrably pay for phone-based measurement.

What cannot reach him is the other two things your concept requires:

1. **An authored 3D baseline.** He has no VDC staff, no coordinated model, and works from 2D PDFs. Phase 1 asks him to do the modeling work that Doxel's enterprise customers pay a BIM team for. That's not a price problem, it's a labor problem, and it doesn't get cheaper.
2. **A perpetual archive on a cancellable subscription.** Phase 5's promise is permanence; your revenue is monthly; your storage bill is cumulative and your delete-account path is recursive.

So the honest framing isn't "the idea is good, the market is wrong." It's **the idea has the wrong bottleneck.** It assumes the hard part is measuring reality. The hard part is having a price to multiply reality by.

---

## RECOMMENDED PATH

Nothing below needs a native module, so none of it exits the OTA path.

### Increment 0 — one week, mostly conversations. Gates the whole quarter.

Find out what fraction of residential change-order **dollars** a variance engine could ever detect.

Ship the cheap instrumentation: change `ChangeOrder.reason` (`types/index.ts:1320`) from `reason: string` to a required enum at capture — `owner_requested | concealed_condition | design_error_omission | quantity_variance | code_official | schedule_acceleration`. `changeAmount` already exists. Add a `takeoff_completed` event to `utils/analytics.ts` (there is currently **no takeoff event of any kind** — you don't measure whether Phase 0 ever happens).

But do not plan to answer the question from your own data. Your own audit (2026-08-04): **PostHog 180 days — 1 install, 57 marketing visitors, 2 project-creators, 0 paid conversions.** There is no denominator to query. So the actual experiment is: **get the last 20 change orders from five remodelers** — a photo of a CO log, a QuickBooks export, whatever they'll hand over — and categorize them by hand yourself.

**Kill criterion:** if `quantity_variance` plus the measurable slice of `concealed_condition` is under roughly 15% of CO dollars, Phases 2–4 have no market and **no accuracy argument can rescue them.** Also note what a scan structurally cannot see: rot behind drywall, an undersized header, knob-and-tube in a joist bay, missing blocking. LiDAR is a line-of-sight surface sensor; it sees the room *after* you opened it up, which is after you already knew. The money-generating residential change orders are invisible to the sensor by construction.

### Increment 1 — 2–3 weeks. The real moat hole.

Give the cost engine a true denominator for subcontracted scope.

1. Add `quantity` + `unit` to `SubSubmittedInvoiceLine` and to the subcontract schedule of values / `Commitment`. One schema change plus one extraction-prompt change for the invoice OCR path you already run.
2. Wire the existing `measuredQuantity` into the cost path. It's declared at `types/index.ts:4675` and used **only** in `components/TakeoffFieldVerifyButton.tsx` (lines 124, 132–133, 176) — captured, then discarded. `utils/costDatabase.ts` imports `estimateActuals`, `materialReceipt`, `costSeedCore`, `varianceDecomposition` and nothing else. **Your cheapest capture device for the moat is a text input.** A GC who types "actual: 560 LF" gives you a true denominator at full precision, with no device gate, no native module, no App Store review.
3. Fix the denominator-mixing bug while you're in there. Within one `trade|unit` bucket, `costDatabase.ts:232–235` takes a single quantity-weighted mean across samples with **incompatible denominators**: closed-job samples are dollars-per-*bid*-unit (`costDatabase.ts:174`), receipt samples are the supplier's true unit price (`materialReceipt.ts:192`), seeds are a typed true rate. Averaging those in one mean is a real defect. Separate the bases or tag and weight them.

**What this proves:** whether "we price off what your jobs actually cost" is true for the majority of the job, or only for materials and self-perform labor. **What it kills:** the moat claim as currently stated, if subbed rates turn out to be unlearnable even with quantity captured.

### Increment 2 — only if Increment 0 survives.

Phase 5's idea, implemented with photos: seal the existing geo-stamped daily-report photo into the field-ticket grain already documented at `types/index.ts:~4880`, tie it to the notice clock, and ship a **CA B&P §7159.6-compliant change-order form that captures a homeowner signature on site, before the work**. That is the statutorily correct instrument, it's a form and a signature pad, and it is worth more to a California remodeler than any variance engine. **Write the retention policy before you ship it.**

### What to skip permanently

Phase 1. Phase 3's clash and quantity triggers. Auto-priced change orders. Writing your own point-cloud pipeline — if you ever need capture, integrate ArcSite, Polycam or HOVER rather than building it.

---

## Open questions only you can answer

**1. Do you have customer access at all?** One install and zero conversions in 180 days means every feature debate is downstream of a distribution problem. *Cheapest experiment: the five CO logs in Increment 0. If you can't get five remodelers to send you a CO log, the sensor question is moot.*

**2. Which ICP?** Your own concept text describes a commercial GC, repeatedly: "a superintendent walks the site" (a remodeler with two crews has no superintendent); "the mechanical contractor ran a duct through where plumbing is scheduled" (federated MEP design, separate trade contractors, a coordination process); "20 linear feet of conduit… the electrician's unit rate" (conduit is largely a commercial artifact, and residential electricians rarely bid to published unit rates); TR1/TR8 (NYC DOB, commercial/multifamily). **This concept was written for a customer you don't have.** *Cheapest experiment: three calls with restoration contractors. Ask whether an Xactimate-adjacent scan-to-ESX tool would earn a subscription. If yes, that's a different company and it's a real one.*

**3. Are you willing to end the same-day OTA loop?** `runtimeVersion: appVersion` plus `newArchEnabled` means the first native scanning module means an App Store review per iteration, on a Fabric/TurboModule-compatible module, against a dormant single-maintainer package. *Cheapest experiment: install `expo-roomplan`, do one native build, count the hours. One day, and it prices the whole path.*

**4. Can you afford the storage?** *Cheapest experiment: capture one room with RoomPlan on your own phone and look at the file size. One hour. It's the single number that decides Phase 2's economics and nobody has it.*

**5. Are you willing to be the party who defends an accuracy number?** Apple publishes semantic detection metrics for RoomPlan (95% precision/recall for wall and window, 90% for door) but **never a dimensional accuracy spec** — how reliably it *finds* a wall, never how accurately it *measures* one. Every number you quote becomes your liability, backed by your own field testing. *Cheapest experiment: scan one kitchen, tape-measure five runs, compare. Half a day.*

**6. Does an incumbent already close the estimate → actual → next-estimate loop?** This is the one thing I could not resolve and it matters most to the fallback recommendation — Buildertrend's budget documentation returned HTTP 403. *Cheapest experiment: a Buildertrend trial, or one 20-minute call with a Buildertrend user asking whether it re-prices next quarter's estimates off last quarter's actuals. If it does, the moat is narrower than you think and you need to know this week.*

---

## Sources

**Verified, fetched 2026-09-10 unless dated otherwise**

- Apple RoomPlan research metrics — [machinelearning.apple.com/research/roomplan](https://machinelearning.apple.com/research/roomplan)
- Apple WWDC23 session 10192, "Explore enhancements to RoomPlan" — 2,000 sq ft / 186 m², 1–4 bedroom single-floor residential, 50 lux, ARWorldMap relocalization
- Apple developer docs — `CapturedRoom.Object.Category` (16 cases), `ARMeshClassification` (8 cases)
- OpenSpace SMB pricing, "Note our minimum price is $10,000" — [openspace.ai/smb-pricing-webpage](https://www.openspace.ai/smb-pricing-webpage); OpenSpace Track, "BIM is not required," 24–48 hours, humans in the loop — [openspace.ai/products/progress-tracking](https://www.openspace.ai/products/progress-tracking)
- DroneDeploy Progress AI, "BIM and schedule are not required," minutes not days — dronedeploy.com blog, 2025-07-22
- Doxel, "compares 360° video to BIM," "calculate cost vs. progress" — [doxel.ai/product](https://doxel.ai/product)
- ArcSite pricing — [arcsite.com/pricing](https://arcsite.com/pricing)
- CompanyCam LiDAR Mode — [companycam.com/resources/classes/how-to-use-lidar-mode](https://companycam.com/resources/classes/how-to-use-lidar-mode); pricing — [companycam.com/pricing](https://companycam.com/pricing)
- magicplan restoration positioning, ESX output, $40/project overage — [magicplan.app](https://www.magicplan.app/)
- Canvas/Twindo accuracy "within 1-2% … in your CAD file," thickness inferred not measured — [support.canvas.io/article/5](https://support.canvas.io/article/5); free tier and CAD pricing — [support.canvas.io/article/615](https://support.canvas.io/article/615)
- Handoff pricing and supplier-catalog cost basis — [handoff.ai/pricing](https://www.handoff.ai/pricing)
- 1build, 68M items, 3,000+ counties — [1build.com](https://www.1build.com/)
- Supabase Pro storage/egress overage — [supabase.com/pricing](https://supabase.com/pricing)
- FRCP 37(e) — [law.cornell.edu/rules/frcp/rule_37](https://www.law.cornell.edu/rules/frcp/rule_37); FRE 901 — [law.cornell.edu/rules/fre/rule_901](https://www.law.cornell.edu/rules/fre/rule_901)
- CA B&P §7159 and §7159.6 including savings clauses — [leginfo.legislature.ca.gov](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=7159)
- NY GBL §771; *Home Constr. Corp. v Beaury*, App Div 2d Dept 2017, docket 2014-06600
- ACI 117-10 §4.4.1, §4.4.5, §4.5.3, §4.5.4, §4.5.4.3
- NYC DOB TR8 instructions (rev 01/11) — [nyc.gov/assets/buildings/pdf/tr8ins_0916.pdf](https://www.nyc.gov/assets/buildings/pdf/tr8ins_0916.pdf); progress inspections and DOB NOW — [nyc.gov/site/buildings/codes/progress-inspections.page](https://www.nyc.gov/site/buildings/codes/progress-inspections.page)
- Treccani, Adami & Fregonese, ISPRS Archives XLVIII-2/W8-2024, 431 (published 2024-12-14) — 1 cm to 10 cm depending on loop closure
- Díaz-Vilariño et al., ISPRS 2022 — 40 cm two-room wall on a 2020 iPad Pro with a no-loop-closure app; 0.53 cm plane-fit RMSE over 737,008 points
- Luetzenburg et al., *Sci Rep* 11:22221 (2021) — ±1 cm small objects, ±10 cm coastal cliff, iPhone 12 Pro
- Engineering.com Canvas field test, 2023-01-05 — 7/8 in on 21 ft 11-1/8 in (0.33%)
- `expo-roomplan` — npm registry, 14 versions, single maintainer, created 2025-07-20, latest 1.3.1 on 2026-07-27

**Code, verified in this session at `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/`**

`types/index.ts:3231` (`SubSubmittedInvoiceLine`), `:2295` (`Commitment`), `:1320` (`ChangeOrder.reason`), `:2863` (`PlanSheet`), `:4675` (`measuredQuantity`), `:~4880` (sealed field-ticket rationale) · `utils/costDatabase.ts:159–176`, `:232–235`, imports at `:20–24` · `utils/materialReceipt.ts:188–194` · `utils/takeoffGeometry.ts:14` · `utils/offlineQueue.ts:6,19` · `utils/noticeClock.ts:34,41` · `utils/analytics.ts` (no takeoff event) · `components/TakeoffFieldVerifyButton.tsx:124,132–133,176` · `app/daily-report.tsx:43,816` · `app/takeoff.tsx:340`, `app/takeoff-estimate.tsx:19` (the dropped `fromTakeoff` flag) · `supabase/functions/delete-account/index.ts` · zero hits for `roomplan|arkit|lidar|point.?cloud|scenedepth|armeshanchor|scenekit|realitykit` across all `.ts`/`.tsx`; zero hits for `legal hold|litigation hold|retention polic`

**Explicitly UNVERIFIED — do not put these in a deck**

- Representative RoomPlan/USDZ scan file size. **Nobody measured it.** Phase 2's economics depend on it.
- HOVER's exact pricing ladder (sources conflict: $29/$59/$89, $29–$139, ~$25/job, Pro $99/mo vs $999/yr) and its "to-the-inch accuracy" claim (vendor marketing; one third-party contractor comparison put it at 2.6% variance)
- CompanyCam monthly vs annual rates
- magicplan tier prices (rendered dynamically, did not load)
- Polycam's "0.5 inch tolerance" claim — vendor marketing, no methodology
- Twindo's ~$7.7M revenue / ~12,000 customers — company-reported via secondary source
- Your LiDAR-capable device share among users — no reliable figure exists
- "70–80% subcontracted" — that comment in your repo (`crewPresence.ts:9`) is about fit-out, not residential remodel
- Bluetooth laser distance meters (Leica DISTO, Bosch GLM) — accuracy specs, BLE SDK availability, React Native feasibility all unchecked. **Worth one hour before anyone budgets for LiDAR**, since your contractors already own these
- Buildertrend's estimate→actual→next-estimate loop (HTTP 403). **Unresolved and it matters.**
- Any residential change-order size or frequency benchmark. **No primary source was obtained by anyone. The demand side of this concept is unsized.**
- Whether "scan-derived change order" is patented — only "unclaimed in shipping products" was verified

---

# Appendix — completeness critic

## GAP 1 (lead) — Phase 4 has no multiplicand for 70–80% of a residential GC's cost, and this is verifiable in his own code in five minutes. Nobody in five dimensions checked it.

Every dimension argued about whether the sensor can measure the delta. Nobody asked what the delta gets multiplied *by*. The founder's own words: "If the scan detects an extra 20 linear feet of conduit, it references **the electrician's unit rate**."

That rate does not exist in MAGE ID, and cannot, for subcontracted scope.

- `utils/costDatabase.ts` (~line 157): `const cost = l.hasActual ? l.actual : l.hasCommitment ? l.committed : 0;` with the comment *"Prefer real actuals; fall back to the signed commitment as the cost proxy for a closed job (a signed sub IS what that scope cost you)."* Then `actualUnit: cost / l.quantity`. So a subbed trade's "unit rate" is **signed lump sum ÷ bid quantity** — a quotient, not a price anyone agreed to per unit.
- `types/index.ts:3231`: `export interface SubSubmittedInvoiceLine { description: string; amount: number; }` — **no quantity, no unit.** The single largest cost category a residential GC has arrives in this app as free text and a dollar amount. There is no denominator to learn from and none to bill against.

Two consequences the founder needs, neither of which appears anywhere in the five dimensions:

1. **Phase 4 would systematically under-price its own output.** A sub's marginal price for 20 LF added after mobilization is not the average of his base contract — it carries a small-job premium, a return trip, and zero competitive tension. Auto-generating a CO at base-contract-average $/LF invoices the homeowner *less* than the electrician will bill the GC. The engine's failure mode is not "noisy dollars," it is "confidently negative margin, papered."
2. **It relocates the whole opportunity.** The moat claim is "we price off what *your* jobs actually cost." For self-perform labor and materials that is true today (`laborSamples.ts`, `materialReceipt.ts` → `receiptToCostSamples` uses the supplier's real invoice unit price). For subcontracted trades — most of the job — the app is learning `lump sum ÷ guess`. Adding `quantity` + `unit` to `SubSubmittedInvoiceLine` and to the subcontract SOV is a **schema change plus one extraction prompt**, and it fixes the moat's largest hole with no sensor, no native module, no App Store review, and no exit from the OTA path.

The `crewPresence.ts:9` comment in his own repo ("70-80% subcontracted") is written about fit-out, so treat that specific percentage as unverified for residential remodels — but the structural point holds for any GC who subs electrical, plumbing, HVAC and drywall.

## GAP 2 — Nobody checked whether Phase 0 ever happens. The telemetry to answer it is missing, and the founder's own audit says the denominator is one install.

Phase 1 begins "When a trade's takeoff is finalized in the app." Three checks:

- `utils/analytics.ts` event constants contain `estimate_generated`, `change_order_created`, `material_receipt_saved`, `cost_rates_seeded`, `photo_added`, `daily_report_created` — and **no takeoff event of any kind**. The product does not measure whether a takeoff is ever finalized.
- There is no `takeoffId` / `fromTakeoff` field linking a takeoff to an estimate line (repo-wide grep: zero hits; `LinkedEstimateItem` at `types/index.ts:1237` has `unit`, `quantity`, `csiDivision` — no takeoff provenance, no spatial anchor). The 2D takeoff isn't even wired to the money yet. Phase 1 proposes adding a Z axis to a link that does not exist in X and Y.
- His own path-to-billion audit (2026-08-04, recorded in `project_path_to_billion_phase1.md`): **PostHog 180 days — 1 install, 57 marketing visitors, 2 project-creators, 0 paid conversions.** The icp-fit dimension told him to check PostHog for LiDAR *device mix*. The more decisive PostHog fact is that there is no installed base to have a device mix.

**The one-day experiment that gates the quarter:** `ChangeOrder.reason` is `reason: string` — free text (`types/index.ts:1273–1290`). Change it to a required enum at capture — `owner_requested | concealed_condition | design_error_omission | quantity_variance | code_official | schedule_acceleration` — plus `changeAmount` already exists. Ship it OTA. A variance engine detects *only* `quantity_variance`, and arguably part of `concealed_condition`. If that slice is under ~15% of CO dollars in his own accounts, Phases 2–4 have no market and no accuracy argument can rescue them. Cost: one afternoon. Nobody proposed instrumenting the question; commercial-legal proposed querying data the schema cannot answer.

## GAP 3 — Failure mode nobody modelled: the permanent archive is discoverable, cuts against his customer, and creates a spoliation duty MAGE ID has no concept of.

All five dimensions framed the timestamped record as evidence *for* the contractor. It is symmetric evidence, and worse, it is a retention obligation.

FRCP 37(e), verbatim (law.cornell.edu/rules/frcp/rule_37, fetched 2026-09-10): *"If electronically stored information that should have been preserved in the anticipation or conduct of litigation is lost because a party failed to take reasonable steps to preserve it, and it cannot be restored or replaced through additional discovery, the court: (1) upon finding prejudice … may order measures no greater than necessary to cure the prejudice; or (2) only upon finding that the party acted with the intent to deprive another party of the information's use in the litigation may (A) presume that the lost information was unfavorable …"*

Against that: a repo-wide grep for `legal hold|litigation hold|retention polic|preserve.*evidence` across every `.ts/.tsx/.sql` returns **zero hits**, while `supabase/functions/delete-account/index.ts` recursively enumerates and `storage.from(bucket).remove(...)` every object a user owns. A customer under a preservation duty who hits Delete Account gets a clean, irreversible purge from a product that marketed the archive as "indisputable."

Three unmodelled items follow: (a) a daily scan archive proves *when the GC first saw* a defect — which starts his own 7/14/21-day notice clock (`utils/noticeClock.ts`) earlier than he will want to claim; (b) MAGE ID becomes a third-party subpoena target for a two-person company with no legal function; (c) Phase 5 promises a *permanent* record sold on a *monthly* subscription — if churn deletes it, it was never an audit trail; if it doesn't, he pays storage forever on revenue that stopped. Nobody costed the perpetuity.

## GAP 4 — Architecture: a mesh cannot travel this app's only write path, and the unit economics are cumulative against monthly revenue.

`utils/offlineQueue.ts`: `OfflineMutation.data: Record<string, unknown>`, persisted as JSON in AsyncStorage under `mageid_offline_queue`, `MAX_QUEUE = 1000`. Every Supabase write in the app is required to go through this (CLAUDE.md). **Binary capture has no route through it.** Phase 2 therefore requires a second, unqueued upload path — which is exactly the offline-first invariant the codebase is organised around, broken for the feature most likely to be used in a basement with no signal.

Supabase Pro (supabase.com/pricing, fetched 2026-09-10): 100 GB storage included, **then $0.0213/GB**; 250 GB egress, **then $0.09/GB**; cached egress $0.03/GB. I could not verify a representative on-device scan file size — treat any figure as unverified and measure it on day one — but the sensitivity is the finding: 8 concurrent jobs × ~22 workdays = ~176 captures/customer/month, **accumulating forever**. At ~1 MB/scan this is free; at ~200 MB/scan it is ~35 GB/month/customer, ~420 GB in year one, and the bill grows monotonically while the $79 does not. The single number that decides whether Phase 2 is affordable is a file size nobody measured.

## GAP 5 — Market nobody considered: the buyer for whom scan→dollars already clears is the insurance restoration channel, and the closest incumbent has already moved there.

magicplan (magicplan.app and /pricing, fetched 2026-09-10) is now positioned as **"Restoration workflow software."** Verbatim from its own pages: *"Everything you capture on site becomes a complete ESX: line items, quantities, and room breakdown"*; *"Built-in estimating with personalized price lists"*; LiDAR scan for iOS Pro devices; *"All features included — no add-ons"*; *"Unlimited users included — no extra fees"*; pay-per-project, 10 new projects/month with *"$40 per project"* overage. (The tier prices render dynamically and did not load — I do not have them; do not quote a number.)

Read that against prior-art's own finding that Propeller/aggregates works because there is "an unambiguous, directly observable, single-quantity measurement with an agreed unit price." Restoration has Xactimate's agreed price list and an adjuster who *must* accept a documented quantity. Residential remodel has a homeowner who must be *persuaded*, and a sub whose price is a lump sum. The scan-to-dollars concept is not wrong; it is aimed at the one buyer segment where the necessary precondition — a mutually agreed unit price book — does not exist. That is a market-selection error, not an accuracy error, and no dimension named it as such.

Also missed on the moat's flank: **1build** (1build.com, fetched 2026-09-10) sells *"live construction costs on 68 million materials, labor, equipment and assemblies for every county in the US"* as an API plus widget, 3,000+ counties. It is a list, not learned actuals — so it does not refute the moat — but it means "priced plausibly" is buyable off the shelf, which forces the differentiator to be specifically *his customer's own measured actuals*. Which loops back to Gap 1: the denominator.

## GAP 6 — Modality nobody searched: the measured *number*, not the mesh. It is already in the repo and already thrown away.

icp-fit verified that `measuredQuantity` exists (`types/index.ts:4675`) and appears only in `components/TakeoffFieldVerifyButton.tsx` — captured, then discarded before the cost path. Nobody drew the conclusion: **the cheapest capture device for the moat is a text input.** A GC who types "actual: 560 LF" gives the cost engine a true denominator at 100% of the precision the pricing brain needs, with zero device gate, zero native module, and zero App Store review. That is one form field and a wire into `costDatabase`, versus a quarter of geometry.

The adjacent hardware path — Bluetooth laser distance meters (Leica DISTO, Bosch GLM) that contractors already own, at millimetre-class accuracy — is the modality nobody in five dimensions searched. **I could not verify it:** the Leica model pages I tried returned 404 and this session's web-search budget was exhausted (200/200). Treat accuracy specs, BLE SDK availability, and React Native BLE feasibility as **unverified and worth one hour** before anyone budgets for LiDAR.

## GAP 7 — The dimension that would have answered the actual question returned nothing.

`baseline-problem` came back `research: null`. Phase 1 — spatial anchoring — is the precondition for Phases 3 and 4 (prior-art's own correction: *"You cannot keep the multiplication and throw away the thing being multiplied"*). It is the phase the founder's ICP is least equipped for, it is the phase with zero substrate in the codebase, and it is the only phase nobody researched. Every recommendation in the remaining four dimensions is therefore built on an unexamined foundation. Whatever else is done, that dimension needs re-running before a build decision, or Phase 1 must simply be cut on the code evidence already in hand.

## Bottom line, stated plainly

Cut Phases 1–4. The strongest single argument is not accuracy and not law — it is that **Phase 4 has nothing to multiply by** for the majority of a residential GC's cost, and fixing that requires a schema change, not a sensor. Keep Phase 5's *idea* (sealed, timestamped evidence) but implement it with the photo path that already exists (`utils/photoGeoStamp.ts`, already wired into `app/daily-report.tsx:816`) and the sealed field-ticket grain already documented in `types/index.ts:~4885` — and before shipping it, decide the retention policy, because a "permanent" record on a monthly subscription with a recursive delete-account purge is a liability, not a feature.

Order of work: (1) enum `ChangeOrder.reason` and query his own COs — one day, gates everything; (2) `quantity` + `unit` on sub invoices and subcontract SOV lines — the real moat hole; (3) wire the existing `measuredQuantity` into `costDatabase` — the measured denominator without a sensor; (4) instrument a takeoff-completed event so Phase 0 is at least observable. None of these requires a native build, so none of them leaves the OTA path.

**Explicitly unverified in this pass:** Buildertrend's budget page (HTTP 403) so the "does an incumbent already close the estimate→actual→next-estimate loop" test is *unresolved* and matters to the fallback recommendation; magicplan's actual tier prices; Leica/Bosch laser-meter accuracy and BLE SDK; representative scan file size; the 70–80%-subcontracted figure as applied to residential; any residential change-order size/frequency benchmark (no primary source obtained — the demand-side prize remains unsized by anyone, in any of the five dimensions).

Sources fetched 2026-09-10: [law.cornell.edu/rules/frcp/rule_37](https://www.law.cornell.edu/rules/frcp/rule_37), [supabase.com/pricing](https://supabase.com/pricing), [magicplan.app](https://www.magicplan.app/), [magicplan.app/pricing](https://www.magicplan.app/pricing), [1build.com](https://www.1build.com/). Code cited from `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/` — `utils/costDatabase.ts`, `utils/offlineQueue.ts`, `utils/analytics.ts`, `utils/materialReceipt.ts`, `types/index.ts`, `supabase/functions/delete-account/index.ts`. Founder's own PostHog figures from `/Users/omirmajeed/.claude/projects/-Users-omirmajeed-Desktop-MAGE-ID---CLAUDE/memory/project_path_to_billion_phase1.md` (audit dated 2026-08-04).
