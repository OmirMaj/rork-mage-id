# Handoff — money wave → WIP, AIA and screen owners (2026-09-11)

Written by the **money loop** wave (contract, billing ledgers, QuickBooks, AP,
1099). Everything below is a change in a file this wave does not own. Each item
states what was verified, in which file, and what the receiving wave has to do.

---

## 1. WIP wave — tax-inclusive billings against a pre-tax contract

**Status when checked: ALREADY FIXED in your uncommitted work. No action, only
confirmation — and one place the fix has not reached.**

The finding as filed: `utils/financialReports.ts` summed `inv.totalDue`
(subtotal **plus** tax) into `billedToDate`, while `contractValue` resolves
through `deriveOriginalContractWithSource` to `linkedEstimate.grandTotal`, which
is `baseTotal + markupTotal` and carries no tax term at all
(`utils/estimateCommit.ts`). Sales tax on every billing therefore appeared as
phantom **overbilling** in the over/under columns and suppressed `unbilled` —
the first line a surety underwriter reads.

What the working tree now does (`utils/wip.ts`, `suggestBillingsWithSource`):

```
billedToDate: issued.reduce((sum, i) => sum + ((i.totalDue ?? 0) - (i.taxAmount ?? 0)), 0)
```

and `utils/financialReports.ts` reads `billings.billedToDate` rather than
summing invoices itself. That is the correct basis and it matches the two
places this repo had already fixed by name — `MONEY-05` for retainage in the
same file, and `PORTAL-01` in `utils/portalSnapshot.ts` ("tax-INCLUSIVE cash
subtracted from a PRE-TAX contract").

**What is still open, and it is yours:** `paidToDate` on the same rows is still
a raw `inv.amountPaid` sum, which is CASH and therefore tax-INCLUSIVE, and it
is compared against the same pre-tax contract in the columns beneath it. The
comment beside it names the pay-app limitation but not the tax basis. Decide
whether the WIP schedule's "paid" column should be grossed-up-comparable or
stated as cash and excluded from the contract-basis arithmetic — but decide it,
because right now one column on that schedule is on a different basis from the
one above it.

---

## 2. AIA wave — `utils/portalSnapshot.ts`

### 2a. `paidToDate` — FIXED AT THE SOURCE, verify nothing else depended on it

`utils/projectFinancials.getPaidToDate` had **no draft filter** — the only
billing aggregation in that file without one — and `portalSnapshot.ts` calls it
on the unfiltered `invoices` array at the top of the block whose own comment
promises "ONE population for every 'what is owed' figure". A payment recorded
against a draft therefore counted as **paid** on the homeowner's portal while
being excluded from invoiced-to-date and outstanding: the money bar could not
foot against itself.

Measured, `getPaidToDate([sent $40,000 paid, draft $15,000 paid])`:

```
before: 55000   (portal printed paid 55,000 against invoiced 40,000)
after:  40000
```

`getPaidToDate` now filters drafts, so `portalSnapshot.ts:655` is correct
without being edited. **Your job is only to confirm** that no snapshot field
wanted the old draft-inclusive behaviour, and to consider passing
`billedInvoices` explicitly so the population is visible at the call site
rather than implied by the callee.

### 2b. G703 column E attribution and the new milestone key

`deriveMilestoneInvoiceLine` (`utils/billingFlowCore.ts`) now stamps
`sourceEstimateItemId: 'milestone:<id>'`. `utils/aiaBilling.ts` attributes
column E by

```
li.sourceEstimateItemId ? li.sourceEstimateItemId === key : li.name === item.name
```

so a milestone line that previously fell through to the **name** branch now
takes the **key** branch and matches nothing. In practice this changes nothing
— a milestone line is named "Deposit (signing)" and never matched an SOV row by
name — but it is a real behaviour change in your file and you should decide
whether a milestone billing ought to be prorated into the G703 the same way
`/bill-from-estimate` now prorates it (see §4).

---

## 3. `app/invoice.tsx` — the prefill parser drops line keys

`app/contract.tsx` hands a milestone line to `/invoice` through the
`prefillLines` URL param. That screen's parser rebuilds each line from
`name / description / quantity / unit / unitPrice` only:

```ts
const parsed = safeJsonParse<{ name?; description?; quantity?; unit?; unitPrice? }[]>(prefillLines, []);
return parsed.map(li => ({ id: createId('ili'), name: …, quantity: …, unitPrice: …, total: … }));
```

so `sourceEstimateItemId` never reaches the persisted invoice. `app/change-order.tsx`
already documents this and routes CO billing around it for the same reason.

The milestone ledger this wave built therefore runs on
`Invoice.sourceMilestoneId` (which `app/invoice.tsx` **does** stamp, at
creation, from the `milestoneId` param) — see `billedAgainstMilestones`, which
counts both populations and explains why.

**The follow-up:** widen that parser to carry `sourceEstimateItemId` and
`billedPercent` through. Once it does, the key becomes the primary path, the
per-line milestone attribution becomes exact instead of whole-invoice, and
`app/change-order.tsx` can stop routing around it.

---

## 4. `app/tax-1099-export.tsx` — three lines to make the fix reach the CPA

`utils/tax1099Export.buildTax1099Dataset` now accepts an optional
`gcRecordedPayments: GcRecordedSubPayment[]`, and
`gcRecordedSubPaymentsFromReceipts(receipts, commitments)` builds it from
material receipts linked to a **subcontract** commitment. Omitting the argument
reproduces today's behaviour exactly (pinned by a guard), so nothing is broken
by not wiring it — but nothing is fixed either, and the thing not fixed is the
1099 for every sub paid by check.

Measured on a sub paid $18,000 in March and $12,000 in September, by check:

```
BEFORE  totalPaid 0        1099 Required: No
AFTER   totalPaid 30000    1099 Required: Yes   (gcRecordedPaid 30000)
```

The wiring:

```ts
import {
  gcRecordedSubPaymentsFromReceipts, coverageNoteFor,
} from '@/utils/tax1099Export';
const { receipts } = useMaterialReceipts();          // already a hook in this app
…
const rows = buildTax1099Dataset({
  year, subcontractors, commitments, subSubmittedInvoices: subInvoices,
  gcRecordedPayments: gcRecordedSubPaymentsFromReceipts(receipts, commitments),
});
```

…and render `coverageNoteFor(rows)` in place of the bare `COVERAGE_NOTE`
constant. That is not optional garnish, it is the point of the second constant:

**EVERY STRING IN THIS EXPORT DESCRIBES THE RUN THAT PRODUCED IT.** The first
cut of this change rewrote `COVERAGE_NOTE`, the CSV `Total Paid` heading and
the "no payments this year" note to describe GC-recorded bills as counted,
while this screen stayed unwired — so the live export told a CPA in writing
that it counted bills recorded against a subcontract and, in the same document,
printed *"no bills recorded against a subcontract either"* for a sub who had
them. That is strictly worse than the narrow sentence it replaced, on a
deliverable with an IRS deadline. All three strings are now derived:

* `COVERAGE_NOTE` — portal invoices only. What this screen renders today.
* `COVERAGE_NOTE_WITH_RECORDED_BILLS` / `coverageNoteFor(rows)` — the widened
  sentence, returned only when some row actually carries `gcRecordedPaid > 0`.
* the CSV `Total Paid` heading widens itself from the rows, and the
  "nothing this year" note only mentions recorded bills when
  `gcRecordedPayments` was actually supplied.

`scripts/validate-tax-1099.ts` pins both worlds, and it also asserts that
**this screen may not render the widened sentence unless it passes the
argument** — so wiring the three lines and forgetting `coverageNoteFor` will
fail the build, and so will the reverse.

Also surface the new `Tax1099Row.gcRecordedPaid` on screen the way the CSV does
— the basis is the **document date**, not the date the check cleared, and every
row that uses it says so in `notes`. Do not blend it into the headline without
carrying that sentence.

One more consequence of leaving it unwired: `app/material-receipt.tsx`'s
commitment-picker help text no longer mentions the 1099 at all. Once this
screen is wired, that sentence can honestly say a linked sub bill reaches the
export — and `scripts/validate-tax-1099.ts` will let it, because the assertion
is conditional on `gcRecordedPayments` appearing in this file.

---

## 5. `app/scan.tsx` — a scanned sub invoice still becomes an unlinked receipt

`utils/scanRouting.ts` maps every `invoice` to `{ folder: 'financials',
recordKind: 'cost' }`, and `app/scan.tsx` then builds the receipt itself and
calls `addReceipt` directly — it never opens `app/material-receipt.tsx`, so the
commitment picker this wave widened is not on that path.

`utils/jobCostEngine.ts` books an UNLINKED receipt as direct cost. Measured, on
a job with a $20,000 subcontract and a $6,000 bill from that same sub:

```
unlinked receipt : projectedFinal 26000   (the bill AND the full subcontract)
linked receipt   : projectedFinal 20000
```

**The follow-up:** after a scan classifies as `invoice`, offer the project's
open commitments before saving — defaulting to an unambiguous match of the
extracted `vendor` against `Commitment.vendorName` — or route the review step
through `app/material-receipt.tsx`, which now offers subcontracts as well as
POs and explains what the link does.

---

## 6. `Commitment.paidToDate` — still server-only, deliberately

`types/index.ts` documents `paidToDate` as "never mutate from client", and its
only writer is the `recompute_commitment_paid_to_date` trigger on
`sub_submitted_invoices`, which has **no INSERT policy** for a GC.

A GC-recorded bill therefore buys the commitment down inside the job-cost
engine and reaches the 1099 export (§4), but does **not** move that column —
so cash flow's committed-outflow forecast and the AP reconciliation still do
not see it. `app/material-receipt.tsx` now says exactly that in the picker
rather than implying otherwise.

Closing it properly needs a schema change this wave could not make: a GC INSERT
policy on `sub_submitted_invoices` scoped to portals the GC owns (mirroring the
SELECT policy's `sub_portal_links.user_id = auth.uid()` predicate, plus a path
for commitments with no portal at all), with a provenance flag so the export
and the audit trail can tell a GC-entered bill from a sub-submitted one.

---

## 7. `utils/projectFinancials.getContractValue` — resolver available, not adopted

`resolveContractSum(project, contract)` is the shared, pure, testable answer to
"what is the contract sum, and which source produced it": the **signed**
contract when one exists with a usable value, the estimate otherwise, with the
source labelled. `app/client-view.tsx` is wired to it — the homeowner-facing
surface, fixed first because it printed the estimate as the contract value on
the same page that links to the signed PDF.

Still on `effectiveEstimateTotal` and not this wave's to change:
`app/change-order.tsx` (the figure recited on the CO document),
`utils/aiaBilling.ts` (G702 original contract sum),
`utils/wip.deriveOriginalContractWithSource` (seven branches, none of them the
signed contract — a `signed_contract` `WipSource` label is the natural
addition, and it is exactly the provenance a surety wants),
`utils/projectFinancials.getContractValue` itself (sync, and its callers do not
hold a contract).

---

## 8. `app/job-costing.tsx` — one property makes the buyout row-repair live

`computeJobCost` gained an optional `subcontractors?: { id; companyName? }[]`
input. It exists because `subcontractorId` is the ONLY structured link
`CommitmentEditor.handleSave` writes for a subcontract — that function sets
`vendorName` only for a purchase order, and writes neither `csiDivision` nor
`linkedEstimateItems` (its own comment at the call site says so). Without the
roster, the buyout matcher inside the engine can only fire on purchase orders
and on seeded data.

**No caller passes it today.** This screen already destructures
`subcontractors` from `useProjects()` for its own editor, so it is one property
on the existing call:

```ts
computeJobCost({ project, commitments, changeOrders, subcontractors, …costSources });
```

Measured on the world fixture with a subcontract shaped exactly as `handleSave`
builds it (a `subcontractorId`, a typed phase, nothing else):

```
without the roster   Electrical — Unbudgeted, budget $0, committed $22,600
                     beside  subcontractor — budget $41,000, committed $0
with the roster      Electrical — on track, budget $22,600, committed $22,600
```

The project HEADLINE is correct either way — the uncommitted floor is taken
once over the whole job, so `variance` is $0.00 on that fixture with or without
the roster, where HEAD reported `+$22,600` on a job that was exactly on budget.
The roster only repairs the ROWS. The other four call sites
(`utils/financialReports.ts` ×2, `utils/marginRiskScore.ts`,
`utils/livingEstimate.ts`, `utils/portalSnapshot.ts`) would each need the
project's subcontractor list threaded to them and are lower value — the rows
they read are not rendered.

Two consequences of the headline change worth knowing before you touch this
screen:

* `summary.projectedFinal` is **no longer** `Σ byPhase.projectedFinal`. It is
  the smaller of the two whenever a commitment is bucketed away from its
  budget. Never re-derive the headline by summing the rows.
* Genuinely unbudgeted spend (a permit fee on an estimate with no permits line)
  is now absorbed by the job's remaining uncommitted budget rather than added
  on top, until that budget runs out. It is still named as Unbudgeted in the
  drill-down. `scripts/validate-job-cost-variance.ts` was updated for this:
  the Henderson fixture now reads "Over by $1.0K" instead of "Over by $49K",
  because the old figure counted one $49,000 payment as both a payment and as
  budget still to be bought out. The SIGN — over is positive, painted danger —
  is unchanged and still asserted.

---

## 9. `app/invoice.tsx` — no overpayment ceiling (F9 / verifier C7)

`handleMarkPaid` validates only `amt > 0` and then does
`amountPaid = amountPaid + amt` with no ceiling. `netBalanceDue` floors the
result at zero, so the excess vanishes from the balance and persists in
`amountPaid` — and `getPaidToDate` drives the homeowner portal's "Paid to
date". Typing `50000` for `5000` leaves that document permanently $45,000 high.

This wave hardened the DOWNSTREAM consequence rather than the hole:
`supabase/functions/_shared/qbo-mapping/payment.ts` now caps the applied amount
at the QuickBooks balance and books the remainder as unapplied customer credit
(executably guarded — see MONEY-QBO-1 case F). The entry-side warn is still
yours: warn, do not block, showing the retention-net balance and asking to
confirm.

---

## 10. `utils/closeoutPacketGenerator.ts:88` — counts draft invoices as billed
(F10 / verifier C8)

```ts
const totalInvoiced = invoices.reduce((s, i) => s + (i.totalDue ?? 0), 0);
```

No status filter, on the Financial Summary a homeowner or lender reads, while
the retention lines directly beneath it use the correct `effectiveRetentionHeld`.
Every sibling aggregation in the app excludes drafts (`utils/wip.ts` DEFINITION
1, `utils/financialReports.ts:148`, `utils/projectFinancials.getInvoicedToDate`,
`utils/portalSnapshot.ts:668`). The fix is to import `getInvoicedToDate` from
`utils/projectFinancials.ts` rather than re-expressing the predicate — that
function already filters drafts and is guarded.

---

## 11. `app/area-takeoff.tsx` and `app/plan-intelligence.tsx` — `lineTotal`
means two different things (F4 / verifier C4)

Both append a `LinkedEstimateItem` whose `lineTotal` is the raw **cost**
(`markup: 0`) while bumping `grandTotal` by that cost **plus** its share of
markup, and both persist through `commitEstimatePatch`. `Σ items.lineTotal`
then no longer equals `grandTotal`, which is the invariant
`app/(tabs)/estimate/full.tsx` honours and which every billing surface assumes.

This wave could not fix the writers (not its files) but stopped the screen from
lying about the consequence: `/bill-from-estimate` now runs
`sovFootingShortfall(Σ row lineTotal, effectiveEstimateTotal(project))` and
renders a banner (`testID="sov-footing"`) when the schedule under-foots the
contract, the same discipline `utils/aiaBilling.reconcileAIASov` already
applies on the AIA screen. Measured on the world fixture plus a $40,000 Visual
Takeoff addition at an 18% markup ratio:

```
Σ lineTotal 170,052.00     grandTotal 202,371.89     shortfall 32,319.89
```

Before, the screen billed every row to 100% and printed "Remaining $0.00" over
that gap. The real fix is still to make the two writers emit the marked-up line
total, plus a guard asserting `|Σ items.lineTotal − grandTotal| ≤ $0.01` across
every `LinkedEstimate` construction path.

---

## 12. `utils/portalSnapshot.ts` — the anon portal cannot see the contract sum

`app/client-view.tsx` resolves the contract sum through
`resolveContractSum(project, contractQ.data)`, but `contractQ` is keyed to the
LOCAL project and `enabled: !!localProject?.id`. An anon portal visitor runs in
snapshot mode, so the query never fires and the resolver always answers
`estimate` — on the same page whose Documents list carries the signed contract
PDF, which the snapshot builds at publish time.

The screen no longer asserts an absence it did not verify (it says "if you have
signed an agreement, the sum on it is the one that governs — open it under
Documents" whenever it could not check), and that state is pinned by a guard.
The real fix is yours: carry the contract sum **and its source** into the
published snapshot at build time, and hand them to `resolveContractSum` — or
expose them on the hydrated portal object so the client view can prefer them
over the estimate. Until then the homeowner sees the estimate with an honest
caption instead of the signed figure.
