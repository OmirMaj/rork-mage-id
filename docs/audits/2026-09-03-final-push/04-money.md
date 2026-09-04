# Money correctness — final-push audit — 2026-09-03

Domain: every computation that becomes a dollar figure a contractor bills, pays, reports, or bids on.
Method: read every money path end to end (engine → screen → row → webhook → portal HTML), traced with
worked numbers, then checked live exposure with SELECT-only aggregates against production
(`nteoqhcswappxxjlpvap`). No repo writes, no DDL/DML, no simulator run.

## Scope covered (files/paths actually read; commands run)

Engines (read in full): `utils/jobCostEngine.ts`, `utils/aiaBilling.ts`, `utils/invoiceBilling.ts`,
`utils/billingFlowCore.ts`, `utils/cashFlowEngine.ts`, `utils/financialReports.ts`,
`utils/projectFinancials.ts`, `utils/wip.ts`, `utils/wipExport.ts`, `utils/livingEstimate.ts`,
`utils/estimateCommit.ts`, `utils/estimateActuals.ts`, `utils/estimateCalibration.ts`,
`utils/applyCalibration.ts`, `utils/tax1099Export.ts`, `utils/lienWaiverEngine.ts`,
`utils/subOverpaymentGuard.ts`, `utils/materialReceipt.ts`, `utils/laborBurdenModel.ts`,
`utils/laborSamples.ts`, `utils/varianceDecomposition.ts`, `utils/costTruth.ts`, `utils/clientPricing.ts`,
`utils/financing.ts`, `utils/formatters.ts`, `utils/qboSync.ts`.
Screens (targeted reads of every money line): `app/invoice.tsx`, `app/bill-from-estimate.tsx`,
`app/aia-pay-app.tsx`, `app/change-order.tsx`, `app/retention.tsx`, `app/tax-1099-export.tsx`,
`app/cash-flow.tsx`, `app/wip-report.tsx`, `app/job-costing.tsx`, `app/budget-dashboard.tsx`,
`app/payments.tsx`, `app/payments-setup.tsx`, `app/paywall.tsx`, `app/quick-quote.tsx`,
`app/smart-proposal.tsx`, `app/takeoff-estimate.tsx`, `app/estimate-wizard.tsx`, `app/lien-waivers.tsx`,
`app/sub-portal-setup.tsx`, `app/(tabs)/estimate/full.tsx` (totals block 880–1060),
`app/(tabs)/settings/index.tsx` (tax input/save), `app/project-detail.tsx` (legacy estimate writers).
Data layer: `contexts/ProjectContext.tsx` (settings load/save, invoice/CO/AIA row mappers, auto-paid flip,
outstanding helper), `hooks/useSubSubmittedInvoices.ts`, `hooks/useTimeEntries.ts`, `hooks/useLaborRates.ts`,
`hooks/useWeekClose.ts`, `utils/weekClose/composeWeekClose.ts`, `utils/portalSnapshot.ts`,
`utils/subPortalSnapshot.ts`, `utils/pdfGenerator.ts` (invoice block), `utils/emailService.ts`,
`utils/contractEngine.ts`, `utils/proposalBuilder.ts`, `utils/winOptimizer.ts`,
`utils/judges/computeBidVerdict.ts`, `utils/scheduleEarnedValue.ts`, `utils/fieldTicketCore.ts`,
`utils/costDatabase.ts` / `utils/costSeedCore.ts` (provenance), `types/index.ts` (all money types).
Backend: `supabase/functions/stripe-webhook/index.ts`, `create-payment-link/index.ts`,
`create-rfp-checkout/index.ts`, `invoice-dunning/index.ts`, `qbo-sync/index.ts`, `qbo-reconciler/index.ts`,
`_shared/qbo-mapping/{invoice,payment,item,financials}.ts`; `supabase/schema.sql` (invoices,
aia_pay_apps, sub_submitted_invoices, commitments, profiles, `recompute_commitment_paid_to_date`,
`sub_portal_submit_invoice`, `freeze_certified_aia_pay_app`).
Client-facing HTML: `marketing/portal/index.html` (invoice + AIA Pay buttons, balances),
`marketing/sub-portal/index.html` (invoice submit form).
Prior audits: `docs/audits/2026-08-31-medium-sweep.md`, `docs/audits/2026-09-02-launch-readiness.md`,
`docs/START-HERE.md` banner. Validators skimmed: `scripts/validate-job-cost-variance.ts`,
`scripts/validate-estimate-cost-basis.ts`, `scripts/validate-sub-overpayment.ts`.
Commands: `git log` on money files; `grep` sweeps for `totalDue - amountPaid`, `computeJobCost(`,
`snapshotTotals`, fee copy, markup/margin math; five read-only SQL aggregates (results quoted inline).

Verified-and-not-re-reported: sweep #13 (sub overpayment guard) — `computeSubOverpayment` at
`app/sub-portal-setup.tsx:74-118` correctly subtracts the in-hand invoice from the rollup. Sweep #1/#8/#4/#28
fixes are present. No markup-vs-margin conflation found in copy or math (`winOptimizer`, `judges`,
`livingEstimate`, `typeMargin` all label ratios correctly). Stated-vs-measured provenance propagates
through `costDatabase` (`basis`, `provenance`, `tradesSeededOnly`) — the firewall holds at the aggregate.

## Findings (ranked; most severe first)

### F1 — [P0] [CONFIRMED] AIA pay apps lose `totals` and `payLinkUrl` on the server round-trip: the second pay app of a project crashes on open, WIP "billed to date" reads $0 for every project with a pay app, and the AIA Pay link is never persisted
- Where: `contexts/ProjectContext.tsx:4360` (writer), `contexts/ProjectContext.tsx:1818` (reader, `1798-1828` mapper),
  `supabase/schema.sql:207-236` (`aia_pay_apps` has `snapshot_totals`, `paid_at`, `certified_at`; no `pay_link_url`),
  `types/index.ts:1556-1605` (`SavedAIAPayApp.totals`, `payLinkUrl`), consumers `app/aia-pay-app.tsx:170`,
  `utils/wip.ts:232-236`, `hooks/useWeekClose.ts:180-186`, `utils/portalSnapshot.ts:609-615`.
- Evidence:
  - writer: `snapshot_totals: (a as unknown as { snapshotTotals?: unknown }).snapshotTotals ?? null,` — the app object
    carries `totals` (built at `app/aia-pay-app.tsx:341-349`), never `snapshotTotals`, so **null is written**.
  - reader: `...(r.snapshot_totals ? { snapshotTotals: r.snapshot_totals } : {}),` — nothing ever sets `totals`,
    `payLinkUrl`, `payLinkId` or `paidAt`; then `await saveLocal(AIA_PAY_APPS_KEY, mapped)` replaces the local copy.
  - consumer: `lessPreviousCertificates: priorAIA.totals.totalEarnedLessRetainage || 0,` (unguarded).
  - `wip.ts:232-236`: `if (payApps.length > 0) { ... return latest.totals?.totalCompletedAndStored ?? 0; }` — short-circuits
    before the invoice fallback.
  - `git log -S snapshotTotals` → introduced in `8c8a5af8`; no validator references `snapshot_totals`.
  - Live: `select count(*), count(snapshot_totals) from aia_pay_apps` → `0, 0` (latent; nobody has saved one yet).
- Failure scenario: GC saves Pay App #1 (totals.totalEarnedLessRetainage $45,000; Stripe link attached). Row lands with
  `snapshot_totals = null`. Next launch hydrates → every SavedAIAPayApp has `totals === undefined`, `payLinkUrl === undefined`.
  (a) Opening "Generate AIA G702/G703" from invoice #2 enters the carry-forward branch (`priorAIA.lines.length > 0` is true)
  and throws `TypeError: cannot read 'totalEarnedLessRetainage' of undefined` inside the seeding effect — the AIA screen
  is dead for that project from the second period on. (b) WIP report / week-close: `suggestBilledToDate` returns 0, so a
  $550,000 job at 40% cost-complete reads earned $220,000, billed $0, **underbilling $220,000**; the week-close card says
  "$220,000 unbilled". (c) The AIA Pay button disappears from the next portal publish while the Stripe link stays live
  (see F2), and `paid_at` can never reach the app (see F16).
- Fix: writer `snapshot_totals: a.totals ?? null`; add `pay_link_url`/`pay_link_id` columns and write them; reader maps
  `totals: r.snapshot_totals ?? computeAIATotals(row)`, `payLinkUrl`, `payLinkId`, `paidAt: r.paid_at`; guard `:170` with
  `priorAIA.totals?.totalEarnedLessRetainage ?? 0`; add a write→read round-trip validator for `aia_pay_apps` like the one
  that closed the `portal_state` loss.
- Effort: S

### F2 — [P0] [CONFIRMED] Stripe Payment Links are reusable and never deactivated; after a net-of-retention payment the client portal shows "Pay $10,000" against a link that charges $90,000 — a one-tap double charge
- Where: `supabase/functions/create-payment-link/index.ts:397-420` (no `restrictions`), `supabase/functions/stripe-webhook/index.ts:299-329`
  (credits `amount_total`, never deactivates the link or clears `pay_link_url`), `utils/portalSnapshot.ts:556-576`
  (`balance = max(0, total − amountPaid)`, `payLinkUrl` passed unconditionally), `marketing/portal/index.html:4171-4179,
  4515-4516, 4581-4584` (invoice: `canPay = payLinkUrl && !isPaid && balance > 0`, button "Pay ${balance}"),
  `4218-4219, 4703-4707` (AIA: `canPay = !!a.payLinkUrl && currentPaymentDue > 0`, no paid state at all),
  `app/invoice.tsx:502-526` (link minted for `balanceDue` = net of retention), `app/invoice.tsx:843-844` and
  `stripe-webhook:303` (`paid` only when `amountPaid >= totalDue` gross).
- Evidence: `linkParams = { line_items, custom_text, metadata, billing_address_collection, allow_promotion_codes: true,
  after_completion }` — no `restrictions[completed_sessions][limit]`, no `active:false` anywhere; webhook idempotency is
  per `session.id` (`stripe-${session.id}`), and every pay of a link creates a new session.
- Failure scenario (worked): Invoice #7 subtotal $93,023.26 + tax 7.5% $6,976.74 = totalDue $100,000, retention 10% $10,000
  → balanceDue $90,000 → Payment Link minted for $90,000. Client pays → webhook: `amount_paid 90,000`, status
  `partially_paid` (90,000 < 99,999.99). Portal regenerates: `balance = 10,000`, `canPay` true → drawer button
  "Pay $10,000.00 now" → opens the same link → Stripe charges **$90,000** again → webhook appends a second payment,
  `amount_paid 180,000`, status `paid`, receipt "Paid in full". AIA variant: the pay app's "Pay $45,000" button stays live
  forever (no paid check), so an architect who re-opens the portal can pay it twice.
- Fix: (1) create links with `restrictions: { completed_sessions: { limit: 1 } }`; (2) in `handleCheckoutCompleted`
  `POST /v1/payment_links/{id}` `active=false` on the connected account and null `pay_link_url`/`pay_link_id` on the
  invoice; (3) persist `pay_link_amount` and have the snapshot/portal show Pay only when `balance === payLinkAmount`;
  (4) for AIA, hydrate `paid_at` (F1) and gate on it.
- Effort: S (link+webhook) / M (portal gating)

### F3 — [P0] [CONFIRMED] A sales-tax rate of 0% saved in Settings comes back as 7.5% on every synced load, and 7.5% is the default applied to every invoice, progress bill and CO tax preview
- Where: `contexts/ProjectContext.tsx:649` (`taxRate: Number(data.tax_rate) || 7.5`), `:650` (same for contingency `|| 10`),
  `:178-181` (`DEFAULT_SETTINGS.taxRate: 7.5`), `supabase/schema.sql:1432` (`profiles.tax_rate numeric DEFAULT 7.5`),
  `app/(tabs)/settings/index.tsx:290-293` (accepts 0–30), consumers `app/invoice.tsx:330-332`,
  `app/bill-from-estimate.tsx:214-216`, `app/change-order.tsx:234-236`.
- Evidence: settings query at `:643-671` prefers the server row and then `await saveLocal(SETTINGS_KEY, s)` — the coerced
  7.5 overwrites the device copy too. Live: `select tax_rate, count(*) from profiles` → `7.5: 30` (every account);
  `invoices: total 5, taxed 5`.
- Failure scenario: A Texas residential remodeler (lump-sum contracts, no sales tax billed to the homeowner) sets Sales Tax
  Rate to 0 → `tax_rate = 0` persists → relaunch → `Number(0) || 7.5` → 7.5 → next invoice: subtotal $40,000, "Tax (7.5%)
  $3,000", totalDue $43,000, Stripe link $43,000. The client is charged $3,000 of tax that does not exist, and the GC
  cannot turn it off. Today the same 7.5% is silently on every invoice of every account.
- Fix: `taxRate: data.tax_rate == null ? DEFAULT_SETTINGS.taxRate : Number(data.tax_rate)` (and contingency); default to
  0 with an onboarding prompt ("Do you charge sales tax on invoices? Rate?"), and render the Tax row only when > 0.
- Effort: S

### F4 — [P0] [CONFIRMED] 1099-NEC export flags "1099 Required" at $600 for 2026 (federal threshold for payments made after 12/31/2025 is $2,000), and its "Total Paid" counts retention the sub never received
- Where: `utils/tax1099Export.ts:81` (`const required = t.paid >= 600;`), `:86`, `:3-4`, `:27`; `app/tax-1099-export.tsx:4, 181`
  (copy "paid ≥ $600"), `:47-50` (default year = current year after March → **2026 today**), `:127-130` (2026 selectable),
  `:70` (select omits `paid_on`); basis `utils/tax1099Export.ts:58-67` (`t.paid += inv.amount`, date
  `paidAt || reviewedAt || createdAt`); `marketing/sub-portal/index.html:695-703, 1174-1196` ("Total amount" and
  "Retainage held" are separate fields, amount is gross); `supabase/schema.sql:5365-5392` (RPC stores both).
- Failure scenario (worked): 2026 export: a sub paid $1,500 → row "1099 Required: Yes" (wrong under P.L. 119-21 §70433,
  IRC §6041(a) as amended: $2,000 for payments after 12/31/2025, inflation-indexed after 2026). Sub invoice $10,000 with
  $1,000 retainage held, marked paid in Dec 2026 → "Total Paid $10,000.00" (cash actually paid $9,000). Check cut
  12/30/2026 (`paid_on`) but logged 1/3/2027 (`paid_at`) → reported in 2027.
- Fix: `thresholdForYear(y) = y >= 2026 ? 2000 : 600` (constant table, shown in the CSV header/notes); count
  `amount − (retentionAmount ?? 0)` and add retention when its release is recorded; date by `paidOn ?? paidAt`; fetch `paid_on`.
- Effort: S

### F5 — [P1] [CONFIRMED] Eighteen "outstanding" computations use `totalDue − amountPaid` (gross of held retention), so retention the contract lets the client hold is reported as owed and overdue — on the A/R aging report, the home strip, the client portal, the PDF, the Stripe receipt and the client's weekly email — and a retention invoice can never reach `paid`
- Where (gross): `contexts/ProjectContext.tsx:2539` (→ summary `MoneyStrip` OUTSTANDING, `app/(tabs)/summary/index.tsx:254`);
  `utils/financialReports.ts:280-281` (A/R aging + CSV `:366-377`); `utils/projectFinancials.ts:69-73, 181, 187-190`;
  `utils/portalSnapshot.ts:559` (→ portal "Balance due"/"Pay $X" `marketing/portal/index.html:4171-4179, 4548, 4584`);
  `utils/pdfGenerator.ts:923`; `supabase/functions/stripe-webhook/index.ts:303, 414-417` (receipt "Balance remaining");
  `utils/weeklyClientUpdate.ts:66`; `utils/weekClose/composeWeekClose.ts:213, 231`; `components/CashFlowAlerts.tsx:73`;
  `components/NextStepHero.tsx:120`; `utils/brainWatch.ts:116`; `app/report-inbox.tsx:150`;
  `utils/portfolio/clientBook.ts:195-200`; `components/AICopilot.tsx:119`; `utils/aiService.ts:931`;
  `app/payments.tsx:106, 274`; `app/cash-flow.tsx:834`; `app/project-detail.tsx:2857`.
  Status gates: `app/invoice.tsx:843-844`, `contexts/ProjectContext.tsx:2459-2466`, `stripe-webhook:303`,
  `utils/projectFinancials.ts:97-98`. Correct reference already in the repo: `utils/invoiceBilling.ts:54-58`
  (`netBalanceDue`, used by `cashFlowEngine:212`, `invoice-dunning:311-316`, `invoice.tsx:338-339`, the invoice email).
- Evidence: `totalDue = subtotal + taxAmount` (`invoice.tsx:332`) is gross; `netPayable = totalDue − retentionPending`
  (`:338`). `getEffectiveInvoiceStatus`: `if (invoice.amountPaid >= invoice.totalDue ...) return 'paid'`.
- Failure scenario (worked): the $100,000 / 10% invoice above; client pays $90,000 on day 20 (everything asked). A/R aging:
  "Outstanding $10,000 — 0-30 → 31-60 days past due", exported to the bank; home strip "OUTSTANDING $10,000" in red;
  portal "Balance due $10,000"; Stripe receipt "Partially paid — Balance remaining $10,000"; weekly client email
  `balance: 10000`; week-close "Invoice #7 $10,000 — 45d overdue"; the invoice shows "Partially Paid" and "Record Payment"
  until retention is released *and* re-collected. Dunning (repo version) is the only surface that nets correctly.
- Fix: export `invoiceOutstanding(inv) = netBalanceDue(inv)` and `invoiceIsSettled(inv) = amountPaid >= netPayable − 0.01`
  from `invoiceBilling.ts`; replace the 18 call sites; flip `status = 'paid'` on settled-net with a separate `retentionOpen`
  flag; add a guard script that fails on `totalDue - ` / `totalDue - (` outside `invoiceBilling.ts` (same pattern as
  `test:storage-hygiene`).
- Effort: M

### F6 — [P1] [CONFIRMED] The invoice PDF prints "Retainage −$X" and then a "Total Due" that does not subtract it; the emailed amount and the Pay button use the net figure
- Where: `utils/pdfGenerator.ts:958-975` (rows Subtotal, Tax, `Retainage −`, then `Total Due ${inv.totalDue}`, `balance =
  max(0, totalDue − amountPaid)` at `:923`); `utils/emailService.ts:534-551` (email says `${totalDue} due` where the caller
  passes `amountDueNow` = net, `app/invoice.tsx:565-575`).
- Failure scenario (worked): Subtotal $93,023.26 + Tax $6,976.74 − Retainage $10,000.00 → printed **Total Due $100,000.00**;
  the covering email says "$90,000 due" and the Pay button charges $90,000. After the $90,000 payment the PDF prints
  "Balance due $10,000.00". The client reads two different amounts on the same send.
- Fix: after the Retainage row print "Net payable this invoice" = `netPayable`, compute the balance with `netBalanceDue`,
  and keep the gross as "Contract value billed this period".
- Effort: S

### F7 — [P1] [CONFIRMED] "Release Retention" has two contradictory meanings, and the cash-flow forecast counts a released amount up to three times
- Where: `app/invoice.tsx:1043-1071` (writes `retentionReleased` only; never `amountPaid`), `:1755-1815` (modal collects a
  payment Method — Check/ACH/Card/Cash — implying "paid"), `utils/cashFlowEngine.ts:64-79` (`getEffectiveStartingBalance`
  adds `retentionReleases[].amount` as cash received), `:212` (`netBalanceDue` treats released retention as collectible →
  forecast income), consumers `app/cash-flow.tsx:229`, `hooks/useMorningBrief.ts:80`, `utils/oneMind/factBlocks.ts:609`.
- Failure scenario (worked): bank balance set $50,000 on Jan 1. Feb 1 the GC releases $10,000 (Method: Check). Effective
  starting balance → $60,000 (release counted as cash) **and** week-0 income `netBalanceDue = 100,000 − 0 − 90,000 =
  $10,000` (release counted as receivable) → runway $70,000. The client's check arrives and the GC records the $10,000
  payment → starting balance $70,000 → runway $80,000 for $10,000 of money; the morning brief and the AI cash facts
  repeat it.
- Fix: pick one meaning. Recommended: release = "now collectible" — keep the forecast, drop the release from
  `getEffectiveStartingBalance`, remove the Method chips, and mint a retention pay link. (Alternative: release = "paid" —
  append an `InvoicePayment` in `handleReleaseRetention` and exclude released retention from `netBalanceDue`.)
- Effort: S

### F8 — [P1] [CONFIRMED] The platform payment fee is stated four different ways to users and none matches what the edge function charges
- Where: `supabase/functions/create-payment-link/index.ts:116-145` (code: free 0 bps, **pro 30**, business 50, enterprise 40,
  unknown tier 50), `:387-390` (applied as `application_fee_amount`); `app/paywall.tsx:128` ("Stripe payment processing markup
  — free 1.0%, **pro 0%**, business 0.5%, enterprise 0.4%", rendered at `:541-560`); `app/payments-setup.tsx:350-351, 466-467`
  ("A 1% platform fee … 2.9% + 30¢", stat "Platform fee 1%"); `app/payments.tsx:26-34, 83-84, 113-115, 332` (net-after-fees
  computed at 1% + 2.9% + 30¢ for every tier); `utils/stripe.ts:40-42` ("Pro: 0 bps").
- Failure scenario (worked): Pro GC, $10,000 invoice paid by card. Stripe keeps $290.30; the platform takes $30 (30 bps) →
  GC nets $9,679.70. The plan table they bought under says 0%; Payments Setup says 1%; the Payments screen shows
  net $9,609.70 (−$70 wrong) and "Est. Fees (1% + 2.9% + 30¢)". A Business GC is told 0.5% on one screen and 1% on
  another. A free user on a build that omits `userTier` pays 50 bps while the paywall says 1% and the code says 0.
- Fix: one `PLATFORM_FEE_BPS` table (`utils/platformFees.ts`) mirrored in the edge function with a validator diff; render
  paywall/payments-setup/payments net figures from the caller's tier; decide Pro = 0 or 30 and say so once.
- Effort: S

### F9 — [P1] [CONFIRMED] QuickBooks push sends invoices without sales tax and ignores the progress percentage; payments are pushed tax-inclusive; the reconciler writes `amount_paid` from QBO's ex-tax total with `status = 'paid'`
- Where: `supabase/functions/_shared/qbo-mapping/invoice.ts:36-69` (`Amount: li.total` per line, no `TxnTaxDetail`, no
  `progressPercent` scaling), `payment.ts:24-29` (`TotalAmt: pay.amount`), `supabase/functions/qbo-reconciler/index.ts:193-231`
  (`amount_paid: qInv.TotalAmt, status: "paid"`); invoice rows store unscaled line totals for native progress invoices
  (`app/invoice.tsx:311-322` scales only the subtotal; `:359-362` persists `lineItems` + `progressPercent`).
  Live: `qbo_synced 0` (Business+ feature; nobody synced yet).
- Failure scenario (worked): 30% native progress invoice on $100,000 of lines: MAGE subtotal $30,000 + tax $2,250 =
  $32,250; QBO receives a $100,000 invoice with no tax. Client pays $32,250 → QBO payment $32,250 against $100,000 →
  QBO A/R shows $67,750 open on a job MAGE says is current. Reverse direction: full invoice $10,000 + $750 tax pushed as
  $10,000; marked paid in QBO → MAGE `amount_paid 10,000`, `status paid`, and the A/R aging report lists it with
  "Outstanding $750" (the report skips only drafts).
- Fix: push `Amount: billedAmountForLine(li, inv, anyPreScaled)` (already exported from `utils/invoiceBilling.ts`) and a
  `TxnTaxDetail` (or a tax-code line) for `tax_amount`; reconciler sets `amount_paid = local total_due` when `Balance == 0`.
- Effort: M

### F10 — [P1] [CONFIRMED] WIP "original contract" is read from the newest change order, whose `originalContractValue` already includes every earlier approved CO, so earlier COs are counted twice in the revised contract
- Where: `utils/wip.ts:94-112` (`changeOrders[0]?.originalContractValue`), `contexts/ProjectContext.tsx:2401-2403`
  (`getChangeOrdersForProject` sorts `createdAt` DESC → newest first), `app/change-order.tsx:117-124` (`originalContractValue =
  grandTotal + Σ other approved COs` at save time), callers `app/wip-report.tsx:139-157`, `hooks/useWeekClose.ts:166-176`.
  Live: `projects_with_2plus_approved_cos 0` (first real job with two COs hits it).
- Failure scenario (worked): estimate $500,000; CO#1 +$20,000 approved; CO#2 +$30,000 approved later. `changeOrders[0]` =
  CO#2 → `originalContractValue $520,000` → `revisedContract = 520,000 + 50,000 = $570,000` (true $550,000). Est. gross
  profit +$20,000, earned revenue at 40% $228,000 vs $220,000, underbilling overstated by $8,000, `deriveEstimatedCost`'s CO
  cost ratio understated — on the schedule a surety underwrites. A pay app (precedence 1) hides it only if one exists.
- Fix: `Math.min(...changeOrders.map(co => co.originalContractValue).filter(v => v > 0))`, or derive from
  `effectiveEstimateTotal(project)` directly; add a two-CO fixture to `scripts/validate-wip.ts`.
- Effort: S

### F11 — [P1] [CONFIRMED] REGRESSION/UNCLOSED (sweep #2 partial): Living Estimate's buyout driver and the job-cost "overcommitted" check still compare at-cost commitments to the marked-up `lineTotal`
- Where: `utils/livingEstimate.ts:125-128` (`estimatedCost = Σ item?.lineTotal`), `utils/jobCostEngine.ts:327-331`
  (`linkedTotal = Σ item?.lineTotal`); the closed fix is only in `utils/estimateActuals.ts:150-153, 179`. The sweep's own fix
  plan (`docs/audits/2026-08-31-medium-sweep.md:41`) names "livingEstimate.buyoutVariance's estimatedCost" and its impact
  note names `jobCostEngine`'s overcommitted check; neither was changed.
- Failure scenario (worked): estimate line cost $10,000, 15% markup → `lineTotal $11,500`. Sub signed at exactly cost
  ($10,000). Living Estimate: buyoutVariance −$1,500 → driver "Favorable buyout — subs signed $1.5K under estimate"
  (+$1,500), and because `projectedCost` is on the cost basis the residual driver shows "Cost growth −$1,500" — two fake
  offsetting drivers on a job with zero movement. Job Costing: a sub signed at $11,700 (17% over cost) is not flagged
  overcommitted until it exceeds $11,730.
- Fix: `(item.unitPrice ?? 0) * (item.quantity ?? 0)` at both sites; add an at-cost-buyout fixture to
  `scripts/validate-estimate-cost-basis.ts` asserting `drivers.length === 0` and `overcommitted.length === 1`.
- Effort: S

### F12 — [P1] [CONFIRMED] Five screens run the job-cost engine with different inputs: only Job Costing feeds material receipts and crew labor, so Living Estimate, Reports (WIP + Profit), Margin Risk and the portal open-book show a different EAC for the same project — contradicting the engine's stated invariant
- Where: `app/job-costing.tsx:99-119` (passes `receipts, timeEntries, laborRates`); `utils/livingEstimate.ts:252`,
  `utils/financialReports.ts:92, 189`, `utils/marginRiskScore.ts:89`, `utils/portalSnapshot.ts:826` (omit them);
  `utils/livingEstimate.ts:18-25` ("the SAME EAC the Job Costing screen shows, so the two screens never contradict each
  other"); `hooks/useWeekClose.ts:174-176` uses a third definition (`suggestCostToDate` = paid-to-date + receipts).
- Failure scenario (worked): $20,000 of snapped supplier receipts and $15,000 of clocked self-perform labor on a job.
  Job Costing: projectedFinal +$35,000, banner "Projecting $35K over budget". Living Estimate (same tap away): margin
  "healthy", no cost-growth driver. Reports → Profit: health green. Portal open-book: cost excludes both. Margin alerts
  never fire.
- Fix: build one `JobCostInput` bundle in `ProjectContext` (or a `useJobCostInputs(projectId)` hook) and pass it to every
  engine; make `receipts`/`timeEntries`/`laborRates` required parameters so a caller cannot silently omit them.
- Effort: M

### F13 — [P1] [CONFIRMED] The Reports-hub WIP "Unbilled" column is identically zero by construction
- Where: `utils/financialReports.ts:99-110` (`percentComplete = billed / revised`, `earned = revised × pct`,
  `unbilled = max(0, earned − billed)`), exported at `:339, 346` ("Unbilled" CSV column).
- Failure scenario (worked): revised $550,000, billed $220,000 → 40% → earned $220,000 → unbilled $0. Billed $600,000 →
  capped 100% → earned $550,000 → unbilled $0. No input can make the column non-zero; a banker reading it concludes the
  contractor is never underbilled. (The dedicated `app/wip-report.tsx` engine is correct; the Reports hub is not.)
- Fix: derive `percentComplete` from cost (`job.actual / job.projectedFinal`) or schedule progress, matching `utils/wip.ts`;
  or remove the column.
- Effort: S

### F14 — [P1] [CONFIRMED] Bill-from-Estimate lines keep the pre-markup unit price and inflate the quantity so the row foots — the client is invoiced for more units than the contract scope
- Where: `app/bill-from-estimate.tsx:124-125, 150-151` (`unitPrice = usesBulk ? bulkPrice : unitPrice` = cost;
  `lineTotal = item.lineTotal` = sell), `:273-281` (`qty = billAmount / unitPrice`); contrast the native editor fix at
  `app/invoice.tsx:236-245` (`markupInclusiveUnitPrice`).
- Failure scenario (worked): 100 sf tile @ $10.00 cost, 15% markup → estimate line 100 sf @ $11.50 = $1,150. Bill 100% →
  invoice line "**115 sf** @ $10.00 = $1,150.00"; bill 50% of remaining → "57.5 sf @ $10.00 = $575.00 — 50% of remaining".
  The PDF, portal and QBO (Qty/UnitPrice pushed verbatim) all show a quantity 15% above scope.
- Fix: `unitPrice: markupInclusiveUnitPrice(item.lineTotal, item.quantity, effectivePrice)` and `quantity = r.quantity × pct/100`.
- Effort: S

### F15 — [P1] [CONFIRMED] The G703 Schedule of Values is seeded from the source invoice's line totals, so it changes every period, excludes change orders and tax, and carry-forward produces >100% lines with negative balance-to-finish (distinct from the known `thisPeriod = scheduledValue` decision)
- Where: `utils/aiaBilling.ts:138-147` (`scheduledValue: li.total` from `invoice.lineItems`), `:134-136` (Line 1–3 from the
  estimate + COs), `:183-189` (per-line % and H = C − G); `app/aia-pay-app.tsx:158-166` (carry-forward D from the prior app,
  matched by itemNo, into a C column derived from a *different* invoice); `app/bill-from-estimate.tsx:281-283` (bill-from-
  estimate `total` is the billed portion); entry from any invoice `app/invoice.tsx:1611-1624`.
- Failure scenario (worked): estimate line $100,000. App #1 from a 30% bill-from-estimate invoice: C $30,000, E $30,000
  (100%). App #2 from the next invoice (50% of remaining = $35,000): C $35,000, D $30,000 (carried), E $35,000 → G $65,000,
  **186% complete, H −$30,000**, retainage on $65,000; G703 total C $35,000 vs Line 3 $100,000 — the first check an
  architect makes. Same billing, two amounts due: pay app $83,721 (pre-tax, less retainage) vs invoice net $90,000.
- Fix: store the SOV on the project (seeded once from `linkedEstimate.items` `lineTotal` + one line per approved CO,
  editable), keep it stable across periods, and use the invoice only to fill column E; reconcile tax handling with the
  invoice (either bill tax as an SOV line or state the pay app is pre-tax on the cover).
- Effort: M

### F16 — [P1] [CONFIRMED] An AIA pay app paid through Stripe never reconciles to its source invoice, so dunning, A/R, cash flow and the home strip keep chasing a bill the owner already paid
- Where: `supabase/functions/stripe-webhook/index.ts:240-265` (`handleAiaPayAppCompleted` flips only `aia_pay_apps.paid_at`),
  `types/index.ts:1558` (`SavedAIAPayApp.invoiceId` exists), `contexts/ProjectContext.tsx:1798-1828` (never maps `paid_at`),
  `supabase/functions/invoice-dunning/index.ts:311-338` (nets retention but reads only the invoice row).
- Failure scenario (worked): Invoice #3 $50,000 (10% retention) → Pay App #1 currentPaymentDue $45,000 → owner pays via the
  portal → `paid_at` set; Invoice #3 stays `sent`, `amount_paid 0` → day 14: "FINAL NOTICE — $45,000 overdue" emailed to the
  owner who paid; A/R aging, week-close and the summary strip show $45,000 outstanding; the cash-flow runway expects it again.
- Fix: in `handleAiaPayAppCompleted` read `invoice_id` and apply the invoice path's payment record/`amount_paid`/status
  update (idempotent by session id); hydrate `paidAt` (F1) and show it on the pay app.
- Effort: S

### F17 — [P2] [CONFIRMED] Refunds, disputes and failed payments never reach the invoice
- Where: `supabase/functions/stripe-webhook/index.ts:510-651` (handled: `checkout.session.completed`, `account.updated`,
  `account.application.deauthorized`; `payment_intent.payment_failed` only logs with a TODO at `:583`); no
  `charge.refunded`, `charge.dispute.*`, `checkout.session.async_payment_failed`.
- Failure scenario: client pays $9,000; GC refunds $2,000 from the Stripe dashboard → invoice stays `paid` at $9,000;
  the cash-flow starting balance still includes $9,000; QBO (if synced) shows the full payment. A chargeback leaves
  "Paid in full" on the invoice and the portal.
- Fix: handle `charge.refunded` (append a negative payment, recompute `amount_paid`/status) and `charge.dispute.created/closed`
  (flag the invoice, notify the GC); turn the payment_failed log into a notification.
- Effort: M

### F18 — [P2] [CONFIRMED] A deductive (credit) change order shows without a sign on the CO screen while the PDF prints it correctly
- Where: `app/change-order.tsx:1225-1227` (`formatCurrency` uses `Math.abs`), `:617-636` (`{changeAmount >= 0 ? '+' : ''}`
  prefix only for positives); PDF `utils/pdfGenerator.ts:892` prints the sign.
- Failure scenario: CO −$5,000 → "This CO (Subtotal) $5,000.00" (green), "Sales Tax $375.00", "CO Total (incl. tax) $5,375.00";
  the emailed PDF says −$5,000. The homeowner approves a number the screen showed as a charge.
- Fix: `{changeAmount >= 0 ? '+' : '−'}` (three places).
- Effort: S

### F19 — [P2] [CONFIRMED] Overtime hours are computed but never priced — job-cost labor actuals and the learned labor rate book OT at straight time
- Where: `hooks/useTimeEntries.ts:111-119` (`overtimeHours = max(0, totalHours − 8)`), `utils/jobCostEngine.ts:305-310`
  (`laborActual += e.totalHours × rate`), `utils/laborSamples.ts:74-123` (`actualUnit = rate`, hours summed); no consumer of
  `overtimeHours` applies a multiplier (repo-wide grep).
- Failure scenario (worked): 10-hour day at a $50 loaded rate → $500 booked; true cost at 1.5× OT = 8 × $50 + 2 × $75 = $550.
  Every OT day understates self-perform actuals by the premium, and the cost book learns a $/hr that a crew on overtime
  never achieves.
- Fix: `cost = (totalHours − overtimeHours) × rate + overtimeHours × rate × otMultiplier` with a per-GC multiplier (default 1.5)
  in `useLaborRates`.
- Effort: S

## ADD / CONNECT / DO BETTER (ranked by leverage)

### O1 — Retainage as a first-class receivable — leverage: retention is 5–10% of every progress bill and today it has no lifecycle; the GC cannot bill it, the client cannot pay it, and nine surfaces misreport it (F5–F7) — evidence of the gap: `app/invoice.tsx:1043-1071` (release writes a number, creates no invoice, no pay link, no portal item), `app/retention.tsx:51-86` (held/released/pending only), `marketing/portal/index.html` (no retention item to pay) — sketch: a `retention_receivable` state per invoice (held → releasable → billed → collected) with a one-tap "Bill released retention" that creates a retention invoice + Stripe link, feeds the A/R aging as its own bucket ("Retainage held — not due"), and the cash-flow forecast as a dated item once billed.

### O2 — Accounts payable into the cash-flow forecast — leverage: the runway screen exists for the "can I make payroll Friday" call, but the biggest outflow a GC has (approved sub invoices, committed-but-unbilled sub balances, material receipts on terms) is not in it — evidence of the gap: `utils/cashFlowEngine.ts:270-282` (expenses are only the manually typed recurring `CashFlowExpense` list), `supabase/schema.sql:5196-5225` (`paid_to_date` counts *approved* as paid), `utils/wip.ts:128-135` — sketch: project approved sub invoices at their due date (net of retention held) and open commitment balances at schedule milestones as expense items; show an AP aging next to A/R.

### O3 — Sales-tax taxability by line and jurisdiction — leverage: one global percent on the whole subtotal (labor included) is wrong for most US construction billing and is currently forced on at 7.5% (F3) — evidence of the gap: `app/invoice.tsx:330-332`, `types/index.ts:1436-1451` (`InvoiceLineItem` has no `taxable`), `utils/proposalBuilder.ts:126-130` — sketch: `taxable: boolean` per line (materials default on, labor default off, configurable), a per-project rate with a state hint, tax shown only when > 0, and the same flags carried into COs and QBO tax codes.

### O4 — A real, stable Schedule of Values shared by AIA billing, Bill-from-Estimate and WIP — leverage: fixes F15 at the root and makes progress billing from schedule % (which `app/aia-pay-app.tsx:225-238` already does per line) meaningful — evidence of the gap: `utils/aiaBilling.ts:138-147`, `utils/wip.ts:214-238` (single-source billed-to-date rule), `app/bill-from-estimate.tsx:119-185` — sketch: `project.sov[]` seeded from the estimate + COs, edited once, referenced by SOV line id from invoice lines and pay-app lines; earned revenue for WIP from Σ(SOV line × % complete).

### O5 — Cost-to-complete by productivity, on real actuals — leverage: the EAC is "committed plus uncommitted" only; the EVM screen has CPI but its actual cost is derived from *client* payments — evidence of the gap: `utils/scheduleEarnedValue.ts:57-78, 147-150` (`computeActualCostFromInvoices` = Σ `amountPaid`), `utils/jobCostEngine.ts:11-18` — sketch: feed EVM AC from the job-cost bundle (receipts + priced labor incl. OT + sub paid-to-date), expose ETC = (BAC − EV) / CPI beside the committed EAC, and flag when the two diverge by > 5%.

### O6 — Complete the Stripe money loop — leverage: every dollar collected in-app runs through these rails — evidence of the gap: `create-payment-link/index.ts:397-420` (card-only default: no `payment_method_types`, so a $50,000 draw costs $1,450.30 in card fees where ACH would cost $5–$8 capped), no single-use restriction (F2), no refund/dispute handling (F17), no partial payment (Payment Links are fixed-amount) — sketch: Checkout Sessions with `us_bank_account` enabled and `custom_amount` bounded by the net balance, single-use, webhook handlers for refunds/disputes, and a `pay_link_amount` on the invoice.

### O7 — Credits, unapplied cash and overpayment — leverage: production already holds an invoice with `amount_paid > total_due` (1 of 5) and there is no home for it — evidence of the gap: `app/invoice.tsx:834-857` (no cap on recorded payment), `types/index.ts:1472-1500` (no credit memo / negative line), `app/change-order.tsx:267-281` (credits only via COs) — sketch: credit memo entity, "apply overpayment to next invoice", and a warning at record time.

## Appendix — lower-severity notes (one line each with file:line)
- Invoice numbers restart per project (`app/invoice.tsx:186-191`, `app/bill-from-estimate.tsx:98`); QBO `DocNumber = String(inv.number)` (`qbo-mapping/invoice.ts:64`) will collide across projects — prod already has 1 duplicate number per user. P3 LIKELY.
- Retention is computed on the tax-inclusive total (`app/invoice.tsx:335`) while the AIA form withholds on pre-tax work; pick one and say it on the invoice. P3.
- Financing block/illustrative monthly uses gross `totalDue` (`app/invoice.tsx:553, 557`) while the Pay button uses net. P3.
- `create-payment-link` trusts the client-sent tier; the comment (`:103-105`) prices the spoof at "$10 on $100k" — at Business it is $500 per $100,000 invoice. Move the tier lookup server-side (one `subscriptions` read). P3.
- Unknown/missing tier defaults to 50 bps (`create-payment-link/index.ts:116-118`) — a free user on a stale build pays the Business rate. P3.
- `suggestCostToDate` sums `receipt.total` (tax-inclusive, `utils/wip.ts:133`) while `jobCostEngine` sums receipt line totals (`:282`, ex-tax) — the same receipt is two different numbers on two screens. P3.
- `smart-proposal.tsx:59-61` treats a `globalMarkup` of exactly 1 as a fraction → prefills 100% markup. P3.
- Legacy `project.estimate` billing paths use `materials` only (`app/invoice.tsx:249-258`, `app/bill-from-estimate.tsx:109-110, 157-184`) — labor/permits/contingency unbillable; only seed/demo projects still carry the legacy shape (no live producer found). P3.
- `getEffectiveInvoiceStatus` never returns `overdue` for a partially paid invoice (`utils/projectFinancials.ts:97-103`). P3.
- "Record Payment" accepts any amount (`app/invoice.tsx:834-857`); prod has 1 invoice with `amount_paid > total_due`. P3.
- `commitments.paid_to_date` includes *approved* invoices (`schema.sql:5216-5221`) but every consumer labels it "paid" (`utils/estimateActuals.ts:17`, `app/sub-portal-setup.tsx`); the sub portal itself uses `status = 'paid'` only (`utils/subPortalSnapshot.ts:157-165`) — GC and sub see different "paid to date". P3.
- Takeoff "Append" blends the markup ratio over labor/assemblies priced at 0% (`app/takeoff-estimate.tsx:534-544`) so appended material lines get a lower markup than the estimator applies. P3.
- AIA screen headline "Advance $X on this pay app today" = `currentPaymentDue × 0.9` with no partner live (`app/aia-pay-app.tsx:785`) — a fabricated advance rate on a money screen (the 08-31 sweep removed the other fabricated numbers). P3.
- `allow_promotion_codes: true` on invoice Payment Links (`create-payment-link/index.ts:412`) lets any promo code in the GC's Stripe account discount an invoice at checkout. P3.
- `qbo-reconciler` stamps synthesized QBO payments with today's date (`:216-220`), so `getEffectiveStartingBalance` counts them if the balance was set earlier. P3.
- `tax1099Export.ts:60` falls back to `createdAt` for the payment year; `paid_on` is the field that answers "which year". (Folded into F4.)

## What I could not verify (and how it could be)
- Stripe dashboard state: whether the webhook endpoint listens to **connected-account** events (required for `checkout.session.completed` from a Payment Link created with `Stripe-Account`); if it does not, no Stripe payment has ever marked an invoice paid. Check Developers → Webhooks → "Listen to events on Connected accounts"; the live `stripe-webhook` logs would show it.
- Whether `PLATFORM_FEE_BPS_*` secrets override the code defaults in production (secrets are not readable here) — `supabase secrets list` shows names.
- Deployed edge-function sources vs repo (`START-HERE` says 13 functions + `award-rfp` are undeployed; `invoice-dunning` in prod still chases gross retention) — `supabase functions download` into a scratchpad directory and diff.
- `restrictions[completed_sessions][limit]` acceptance on `Stripe-Version: 2024-06-20` — documented since API 2023-08-16; confirm in the Stripe API reference before relying on it (deactivating the link in the webhook works regardless).
- The $2,000 1099-NEC threshold for 2026 payments is statutory (P.L. 119-21 §70433); IRS inflation-indexing for 2027+ and any transition guidance should be confirmed by the GC's CPA before the 2026 filing season.
- No device or simulator run: every finding is traced statically and by worked arithmetic; the F1 crash and F2 double charge should be reproduced on a device (F1: save a pay app, relaunch, open AIA from another invoice; F2: test-mode link paid twice) before shipping the fixes.
