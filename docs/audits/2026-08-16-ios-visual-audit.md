# iOS visual audit — 19 defects the test suite could not see

_2026-08-16. iPhone 17 Pro simulator, iOS 26.5. Report-only; nothing was fixed._

**402 automated tests found zero bugs. Looking at the running app found nineteen.**
That is the finding underneath all the others: mounting is not working. Every
defect below sits in a screen the smoke suite reports as green.

## P0 — the iOS build is broken, and it would break Release

`npx expo run:ios` and `xcodebuild` both fail the "Bundle React Native code and
images" phase:

```
/bin/sh: /Users/omirmajeed/Desktop/MAGE: No such file or directory
```

The Sentry wizard generated an **unquoted command substitution**, which
word-splits on the spaces in `MAGE ID - CLAUDE`:

```sh
/bin/sh `"$NODE_BINARY" --print "...sentry-xcode.sh"` `"$NODE_BINARY" --print "...react-native-xcode.sh"`
```

In **Debug** the phase is a no-op (`SKIP_BUNDLING=1`) so it only fails the
build — but the failure cancels later phases, so `Frameworks/` (hermes, React,
ReactNativeDependencies), the pod resource bundles and the `EXConstants.bundle`
manifest are never installed. **In Release this breaks bundling outright.**

Fix: quote the substitutions, or remove spaces from the directory name. There is
a leftover `sentry-wizard-installation-error-*.log` in the repo root from this.

## P0 — two defects in work shipped 2026-08-13/15 (regressions, mine)

### The punch-list status pipeline is DEAD CODE
`editingItem` is never assigned a real item anywhere in `app/punch-list.tsx` —
only `null` (L173) and a self-update (L622). Every path to the form calls
`resetForm()` first, and no row offers an Edit affordance (rows have Start /
Submit for Review / Close / Reject / Delete only).

So the `<StatusPipeline>` at L610 **never renders**. The fix that moved it out of
the list rows and into the edit sheet was correct about placement and wrong
about reachability — it moved the feature somewhere the user cannot go. The
smoke suite passed precisely because it never renders.

### The permit application pipeline is blank past approval
For `inspection_scheduled` / `inspection_passed` / `inspection_failed`, all three
application dots render empty with grey labels — it reads as a permit that was
never filed, next to "60d in pipeline".

Cause: `visualStageFor('permit', 'inspection_scheduled')` returns
`'inspection_scheduled'` unchanged, because that value is a side branch of
`permitInspection`, **not** of `permit`. It is therefore absent from the permit
stage list, `currentIdx === -1`, and nothing highlights.

Same root cause kills the **"Schedule inspection"** button on `approved`
permits: `nextStage` requires `currentIdx >= 0`.

The exhaustiveness guard did not catch this because it verifies every status is
*classified*, not that every status *renders* in the pipeline it is shown in.
That is a real gap in the guard.

## What is genuinely good (verified by eye)

- **The rate-provenance chip is the best-executed thing in the audit.** All three
  tones render on both surfaces and the hard rule holds *visually*:
  `MEASURED · 2 jobs` is a green success pill with a ruler; `YOU SET THIS` is a
  neutral grey outline pill with a pencil. Unmistakably different. Holds in dark
  mode. Drill-downs are honest — the seeded sheet says "MAGE ID has not measured
  this scope on any job here yet" and never cites a job count.
- **Client mode is clean** — switching `review.tsx` to Client removes every chip
  and all per-line rates.
- **The permits bug that was fixed IS fixed** — expired/denied/failed no longer
  render as "Approved", and the red side-branch badge appears correctly.
- **Both derived badges are correct.** COI genuinely uses the EARLIEST coverage
  (+120d / +18d / +200d → "Expires in 18d"). Warranty claim correctly overrides
  the date-derived status.

## Ranked defect list

| # | Screen | Defect |
|---|---|---|
| 1 | punch-list | `Open` and `In Progress` badges set foreground = background (`t.danger`/`t.danger`) → solid blobs, label and chevron invisible. **These badges are tappable to advance status.** |
| 2 | permits | Application pipeline blank past approval (above); "Schedule inspection" never appears |
| 3 | permits | Edit sheet overflows the top of the screen — no `maxHeight`, no top safe-area inset, and both pipelines sit OUTSIDE the inner `maxHeight: 520` ScrollView. Title drawn over the status-bar clock; on one permit the **X close button is entirely off-screen** and the badge is clipped by the Dynamic Island |
| 4 | punch-list | Reject and Delete buttons set icon+label colour equal to background → featureless red squares. Delete is on **every** row |
| 5 | global | The floating AI button overlaps content on essentially every screen — it obscured a "Denied" badge, GRAND TOTAL, **the final payment amount in the client-facing estimate**, "REVIEW NEEDED" in the COI vault, and warranty labels. No safe inset, no scroll-away |
| 6 | warranties | Delete button drawn on top of the category label on every card — "PLUMBI🗑G" |
| 7 | prequal | Review modal has **no side-branch badge** — a `needs_changes` packet anchors at Draft with a filled dot and a green "Ready for approval" banner. Same bug class as the permits fix, unfixed here. Three contradictory states across two screens |
| 8 | permits | Status dropdown draws options on top of the "PERMIT NUMBER" label; last option clipped away |
| 9 | OAC | Pipeline labels truncate at 5 stages — "Schedu… / In Progr… / Conclu… / Distribu…" |
| 10 | dark mode | Status pills keep light-mode backgrounds — near-white blocks glaring on black |
| 11 | punch-list | Dates rendered unformatted (`Due: {item.dueDate}`) — shows `2026-08-30`, or a full ISO timestamp from Supabase, while permits/warranties format properly |
| 12 | prequal | Raw ISO timestamp: "Expires 2026-12-14T22:57:36.841Z" |
| 13 | chip drill-down | Raw enum leaked: "Confidence — low" lowercase |
| 14 | estimate | **Review and Estimator showed different grand totals for the same cart** ($7,226 vs $7,366.65) until the Estimator was opened, then they agreed. Mechanism unconfirmed — Review appears to use persisted `baseBulkPrice`, the Estimator a regionally-adjusted price. Matters for an estimating product |
| 15 | punch-list | Filter chips clipped by the filter button |
| 16 | COI vault | "REVIEW NEEDED" on all four rows regardless of state, in the loudest amber — out-shouts the actual derived chip |
| 17 | OAC | Agenda says "0 of 2 covered" but lists no items (fixture-shape suspected, unconfirmed) |
| 18 | warranties | Summary tiles ignore "Claimed" — 4 warranties, tiles total 3 |
| 19 | prequal | One malformed packet kills the whole screen (`emrs.find is not a function`) — no error boundary; not a defect against valid data |

## Coverage — what was NOT checked

~12 of 183 routes. Punch-list pipeline unreachable in UI (verdict from code).
Permit `denied` sheet, OAC `distributed`/`draft`, prequal `rejected`/`expired`
not opened. **The `MEASURED` chips came from seeded receipts, not from
`computeEstimateActuals` on a closed project** — the closed-job branch was not
exercised. Anything needing live Supabase (bids, portal, Stripe, AI) 401'd under
a fabricated session. No physical device, no Android.

## The lesson worth keeping

The smoke suite is not wrong — it does exactly what it claims, and its own report
said so: *"mounting is not interacting."* But two of the defects above are in
code shipped days earlier with types, assertions and a guard all green. **Nothing
substitutes for opening the app and looking at it.**
