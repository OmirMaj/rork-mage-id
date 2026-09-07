# Post-fix verification — the fixes, running (2026-09-07)

A Debug build of the branch, on an iPhone 17 Pro simulator, signed into the
production account. This is the counterpart to
`docs/audits/2026-09-06-runtime-audit.md`: that document is what was wrong, this
one is what the same screens do now.

## Confirmed on screen

- **NAV-01, the P0.** Materials is headed **"REFERENCE PRICE BOOK"**, not "LIVE
  PRICING". It reads *"List prices · April 2026 · 4 months old · adjusted for
  Mid-Atlantic"* and carries *"Not a live feed — confirm with your supplier
  before you bid."* The pulsing green dot, the wall-clock "Prices updated" stamp
  and "Pull to refresh" are gone. The market is disclosed (**+22%**, resolved
  from the account's own "New York" profile) rather than a silent nationwide
  New York City multiplier.
- **AI-3 / VIS-01.** The Construction AI segmented control fits: Code Check,
  Project Roadmap, Plan Review and Ask all render in full, no clipping and no
  icon drawn over a label.
- **AI-2 / NAV-04 / VIS-11.** No location prompt appeared anywhere during a full
  sweep of ten tabs plus five deep-linked screens. The mount-effect request is
  gone; the remaining call sites fire only from a user gesture.
- **NAV-03.** `nearby-rfps` now says *"Browsing nearby projects is coming
  soon"*. The GPS control is not rendered, so it no longer asks for a permission
  the feature cannot use, and the empty state no longer blames the user's
  location.
- **NAV-10 / VIS-09.** Home reads *"2 jobs have no log for today"* — the
  arithmetically impossible "40 working days in the last 30" is gone.

## The crash: NOT reproduced, and NOT proven fixed

The "Maximum update depth exceeded" crash from 2026-09-06 (MISS-02) did not
recur under: a ten-tab sweep, Construction AI, nearby-rfps, post-rfp,
discover/bids, a location grant delivered while every one of those screens was
mounted, and repeated foreground transitions. Metro logged no React error.

That is evidence, not proof. What can be said precisely:

- The **trigger** is gone. The crash followed an unsolicited OS permission
  prompt raised by a mount effect on a list screen. No screen does that now.
- The **underlying loop** was never identified. Granting the permission and
  forcing foregrounds no longer loops, but the original cause was never pinned,
  so it cannot be called fixed.
- The evidence that would settle it still exists and is still unread: the root
  ErrorBoundary forwards to Sentry, which is live in production, and the event
  from 2026-09-06 carries React's component stack naming the looping component,
  with a session replay. It is at **mage-id.sentry.io**, project
  `react-native`, search "Maximum update depth". The repo's `SENTRY_AUTH_TOKEN`
  is scoped for source-map upload and returns 403 on the issues API, so this
  needs a person with Sentry access — about a minute of work.

Two related defects WERE found and fixed while chasing it, both with tests:
the app-foreground listener could throw on a non-string `AppState.currentState`
and kill the offline-queue drain on resume; and `app/(tabs)/materials/index.tsx`
still carried the exact shape of the July 2026 loop (a callback writing state
that was one of its own dependencies, keyed on by an interval and an AppState
listener).

## Not verified

Anything behind a flow that needs typing or a multi-step gesture — recording a
payment, releasing retention, generating an invoice PDF. The money changes are
covered by unit fixtures and by read-only checks against the production rows,
not by a driven end-to-end run.

## Second pass — the money flows, driven (2026-09-07)

The first pass could not reach anything behind a gesture. This one did, and it
both confirmed the money fixes and caught one the fixes had introduced.

**MISS-04, retainage basis — fixed, on the real invoice.** Houston #1 renders:
Subtotal $75,595.00 · Tax (7.5%) $5,669.63 · Contract Total $81,264.63 ·
**Retention Held (5% of work completed) −$3,779.75**, with the basis spelled out
underneath: *"5% of $75,595.00 completed work · sales tax is not held"*. The
stored column still holds the old tax-inclusive $4,063.23; the screen no longer
believes it.

**MONEY-01, the Payments hero — fixed.** Reads **$48,827 Received, "Amount
paid, before fees"** (it read $47,167), and **$77,485 Pending, "Excludes $3,780
retention held"**. Fees on MAGE-processed payments show $0.00 with the reason
stated: *"1 card payment was recorded by hand. MAGE did not process it, so its
processor fee is unknown and none is deducted above."* The false "Stripe" badge
is gone from a payment MAGE never touched.

**SCHED-NO-ANCHOR / MISS-01 — fixed, and disclosed.** Summary carries a card
naming both undated schedules — *"2 schedules have no start date … not counted
above"* — with a control to set one, instead of silently anchoring them to
today or to the project's creation date.

**MONEY-04 / VIS-15 — fixed.** The greeting reads "Good morning, Omir" rather
than clipping to "O…".

**PORTAL-01 — fixed, verified against the stored snapshots.** The Henderson
snapshot still carries the buggy `pctComplete: 102`, but the page no longer
reads it: progress is derived from the schedule tasks, duration-weighted and
clamped. Computed against the live rows — Henderson has 0 of 20 tasks carrying
progress, so it now reads "not reported yet" instead of 102%; Watermark 9F has
4 of 19 and reads a genuine 45%; Houston reads not-reported. Legacy snapshots
are handled explicitly, including the case where an old `progressPct: 0` meant
"nobody ever updated this" rather than "not started".

### The defect this pass found

Summary's overdue row said **$77,201** while the invoice said **$77,484.88** —
same invoice, $283.48 apart, because the editor recomputed retainage on work
value and every shared reader still trusted the stored column. Chasing it
turned up two worse ones that no screen would have shown: `invoice-dunning`
would have emailed the client a FINAL NOTICE for $77,201.39 against a pay link
charging $77,484.88, and `mcp` answered questions with a figure no surface
displayed. Fixed by moving the rule into one place on both client and server.

Two `validate-portal-owner` fixtures had asserted 10% of the tax-INCLUSIVE
total — the guards had agreed with the bug. Corrected, with one left holding a
deliberately stale stored figure so it proves the reader ignores it.
