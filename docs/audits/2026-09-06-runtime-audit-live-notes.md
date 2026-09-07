# Live findings — driven on the founder's production account, Release build, 2026-09-06

## VERIFIED WORKING (not findings — proof the branch does what it claims)

**Retention netting is live and correct.** Houston Phone Booth Ad invoice #1:
total_due 81,264.625, retention_amount 4,063.23, paid 0.
- gross outstanding = 81,264.63
- net outstanding    = 77,201.39
The app's Summary shows "$77201" and "$77K outstanding". It is using the NET
figure. Before this branch that line was gross. MONEY-F5 confirmed on real data.

**Portfolio outstanding reconciles.** Excluding the "Sample —" demo project:
77,201.39 (Houston) + (-128.88) (Henderson #1 overpaid) = 77,072.51 -> "$77K". Correct.

**Date math correct.** Houston due 2026-08-26, today 2026-09-06 = 11 days. The
app says "11d overdue". Correct.

**Code Check address + AHJ grounding works both ways.**
- Brooklyn, NY -> "Grounded on New York City Department of Buildings — NYC
  Construction Codes (2022). Adoption checked 2026-09-06. Code sections are
  still model recall." Correctly picks NYC's own DOB and code over New York
  State's, which is the entire point.
- Chicago, IL (deliberately not in the table) -> "No adoption record for this
  jurisdiction — this answer is model recall, not a code lookup. Verify the
  governing edition with the local building department."

**Release build runs.** First successful Release launch since the iOS build fix.

## FINDINGS

### P0 — infinite render loop crashes the app
Granting the location permission on the Construction AI screen immediately hit
the error boundary: "Maximum update depth exceeded ... React limits the number
of nested updates to prevent infinite loops." Screenshot
runtime-audit/60_CRASH-max-update-depth.png. "Try Again" recovered.
A contractor granting location for the first time — which the app asks for on
its own — sees the app break. Under diagnosis; cause and whether this branch
introduced it is the open question.

### P1 — money is stored with sub-cent precision
2 of 5 invoices have a `total_due` that is not a whole number of cents, and 1
has a sub-cent `retention_amount`:
  total_due        81264.625
  retention_amount 4063.2312500000003
  total_due        48698.04825
`4063.2312500000003` is a float artifact, not an amount. Consequences: the
invoice total billed to a client is not a representable amount of money; any
sum of these drifts; and a paid-in-full check can miss by fractions of a cent
(Henderson #1 is recorded as paid 48,826.93 against a total of 48,698.04825,
i.e. overpaid by 128.88, and still reads "paid").
Money should be rounded to cents at the point it is computed and stored.

### P2 — an overpayment on one invoice reduces reported outstanding on another
Henderson #1 is overpaid by 128.88 and carries outstanding_net = -128.88. The
portfolio "outstanding" total nets that credit against money genuinely owed on
a different invoice, understating what is owed by 128.88. Defensible for a
portfolio figure, wrong if read as "what my clients owe me". Worth a decision,
not necessarily a fix.

### Note — pay_link_amount is absent in production
Confirms migration 20260904100100 is unapplied, consistent with the runbook's
hard gate. Until it lands, the client hydrates payLinkAmount as undefined,
which hides Copy/Share and re-mints on every Send.
